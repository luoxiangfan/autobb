/**
 * API: 暂停Offer的所有已存在广告系列
 *
 * POST /api/offers/[id]/pause-campaigns
 *
 * 功能：
 * - 查询指定Offer的所有已启用广告系列
 * - 调用Google Ads API批量暂停
 * - 更新数据库中的广告系列状态
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { updateGoogleAdsCampaignStatus } from '@/lib/google-ads-api'
import { getDecryptedCredentials } from '@/lib/google-ads-accounts'
import { getUserAuthType } from '@/lib/google-ads-oauth'
import { applyCampaignTransition } from '@/lib/campaign-state-machine'

interface RouteContext {
  params: {
    id: string
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const offerId = parseInt(context.params.id)

    if (isNaN(offerId)) {
      return NextResponse.json(
        { error: '无效的Offer ID' },
        { status: 400 }
      )
    }

    const db = await getDatabase()

    // 1. 获取Offer信息和用户ID
    const offer = await db.queryOne(`
      SELECT id, user_id, offer_name
      FROM offers
      WHERE id = ?
    `, [offerId]) as { id: number; user_id: number; offer_name: string } | undefined

    if (!offer) {
      return NextResponse.json(
        { error: 'Offer不存在' },
        { status: 404 }
      )
    }

    // 2. 查询该Offer的所有已启用广告系列
    const campaigns = await db.query(`
      SELECT
        c.id,
        c.campaign_id,
        c.campaign_name,
        c.google_ads_account_id,
        c.google_campaign_id,
        c.status
      FROM campaigns c
      WHERE c.offer_id = ?
        AND c.user_id = ?
        AND c.status = 'ENABLED'
        AND c.google_campaign_id IS NOT NULL
      ORDER BY c.created_at DESC
    `, [offerId, offer.user_id]) as Array<{
      id: number
      campaign_id: string | null
      campaign_name: string
      google_ads_account_id: number
      google_campaign_id: string
      status: string
    }>

    if (campaigns.length === 0) {
      return NextResponse.json({
        success: true,
        message: '没有需要暂停的广告系列',
        pausedCount: 0,
        campaigns: []
      })
    }

    // 3. 按Google Ads账号分组
    const campaignsByAccount = campaigns.reduce((acc, campaign) => {
      const accountId = campaign.google_ads_account_id
      if (!acc[accountId]) {
        acc[accountId] = []
      }
      acc[accountId].push(campaign)
      return acc
    }, {} as Record<number, typeof campaigns>)

    const results: Array<{
      campaignId: number
      campaignName: string
      success: boolean
      error?: string
    }> = []

    let pausedCount = 0
    let errorCount = 0

    // 获取用户认证类型
    const auth = await getUserAuthType(offer.user_id)

    // 4. 按账号批量暂停广告系列
    for (const [accountIdStr, accountCampaigns] of Object.entries(campaignsByAccount)) {
      const accountId = parseInt(accountIdStr)

      try {
        // 获取Google Ads账号凭证
        const accountCredentials = await getDecryptedCredentials(accountId, offer.user_id)

        if (!accountCredentials) {
          // 账号凭证不存在，标记失败
          accountCampaigns.forEach(campaign => {
            results.push({
              campaignId: campaign.id,
              campaignName: campaign.campaign_name,
              success: false,
              error: 'Google Ads账号凭证不存在'
            })
            errorCount++
          })
          continue
        }

        // 服务账号模式不需要 refreshToken
        if (auth.authType === 'oauth' && !accountCredentials.refreshToken) {
          accountCampaigns.forEach(campaign => {
            results.push({
              campaignId: campaign.id,
              campaignName: campaign.campaign_name,
              success: false,
              error: 'Google Ads账号认证信息缺失（需要OAuth）'
            })
            errorCount++
          })
          continue
        }

        // 批量暂停该账号下的所有广告系列
        for (const campaign of accountCampaigns) {
          try {
            // 调用Google Ads API暂停广告系列
            await updateGoogleAdsCampaignStatus({
              customerId: accountCredentials.customerId,
              refreshToken: accountCredentials.refreshToken || '',
              campaignId: campaign.google_campaign_id,
              status: 'PAUSED',
              accountId: accountId,
              userId: offer.user_id,
              authType: auth.authType,
              serviceAccountId: auth.serviceAccountId
            })

            // 更新数据库状态
            await applyCampaignTransition({
              userId: offer.user_id,
              campaignId: campaign.id,
              action: 'PAUSE_OLD_CAMPAIGNS',
            })

            results.push({
              campaignId: campaign.id,
              campaignName: campaign.campaign_name,
              success: true
            })

            pausedCount++
          } catch (error: any) {
            console.error(`暂停广告系列失败 (Campaign ID: ${campaign.id}):`, error)

            results.push({
              campaignId: campaign.id,
              campaignName: campaign.campaign_name,
              success: false,
              error: error.message || '暂停失败'
            })

            errorCount++
          }
        }
      } catch (error: any) {
        console.error(`获取账号凭证失败 (Account ID: ${accountId}):`, error)

        // 该账号下所有广告系列都标记为失败
        accountCampaigns.forEach(campaign => {
          results.push({
            campaignId: campaign.id,
            campaignName: campaign.campaign_name,
            success: false,
            error: `账号凭证错误: ${error.message}`
          })
          errorCount++
        })
      }
    }

    // 5. 返回结果
    return NextResponse.json({
      success: errorCount === 0,
      message: `已暂停 ${pausedCount} 个广告系列${errorCount > 0 ? `，${errorCount} 个失败` : ''}`,
      pausedCount: pausedCount,
      errorCount: errorCount,
      totalCount: campaigns.length,
      campaigns: results
    })

  } catch (error: any) {
    console.error('暂停广告系列API错误:', error)
    return NextResponse.json(
      {
        error: '暂停广告系列失败',
        message: error.message
      },
      { status: 500 }
    )
  }
}
