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
import { executeGoogleAdsCampaignRemoteActions } from '@/lib/google-ads-campaign-remote-actions'
import { applyCampaignTransition } from '@/lib/campaign-state-machine'
import { parsePositiveIntegerOfferId } from '@/lib/parse-offer-id'

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
    const offerId = parsePositiveIntegerOfferId(context.params.id)
    if (!offerId) {
      return NextResponse.json(
        { error: '无效的Offer ID' },
        { status: 400 }
      )
    }

    const db = await getDatabase()

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

    const campaignMetaByGoogleId = new Map<
      string,
      { id: number; campaign_name: string }
    >()
    for (const campaign of campaigns) {
      campaignMetaByGoogleId.set(campaign.google_campaign_id, {
        id: campaign.id,
        campaign_name: campaign.campaign_name,
      })
    }

    for (const [accountIdStr, accountCampaigns] of Object.entries(campaignsByAccount)) {
      const accountId = parseInt(accountIdStr, 10)

      try {
        const adsAccountRow = await db.queryOne<{
          customer_id: string | null
          parent_mcc_id: string | null
          service_account_id: string | null
        }>(
          `SELECT customer_id, parent_mcc_id, service_account_id
           FROM google_ads_accounts WHERE id = ? AND user_id = ? LIMIT 1`,
          [accountId, offer.user_id]
        )

        if (!adsAccountRow?.customer_id) {
          accountCampaigns.forEach((campaign) => {
            results.push({
              campaignId: campaign.id,
              campaignName: campaign.campaign_name,
              success: false,
              error: 'Google Ads账号凭证不存在',
            })
            errorCount++
          })
          continue
        }

        const summary = await executeGoogleAdsCampaignRemoteActions({
          userId: offer.user_id,
          adsAccount: {
            id: accountId,
            customer_id: adsAccountRow.customer_id,
            parent_mcc_id: adsAccountRow.parent_mcc_id,
            service_account_id: adsAccountRow.service_account_id,
            is_active: true,
            is_deleted: false,
          },
          campaigns: accountCampaigns.map((campaign) => ({
            google_campaign_id: campaign.google_campaign_id,
          })),
          shouldRemove: false,
          logPrefix: '[pause-campaigns]',
          skipAccountEligibilityCheck: true,
          onCampaignOutcome: async ({ campaignId, outcome, reason }) => {
            const meta = campaignMetaByGoogleId.get(campaignId)
            if (!meta) return

            if (outcome === 'PAUSED') {
              await applyCampaignTransition({
                userId: offer.user_id,
                campaignId: meta.id,
                action: 'PAUSE_OLD_CAMPAIGNS',
              })
              results.push({
                campaignId: meta.id,
                campaignName: meta.campaign_name,
                success: true,
              })
              pausedCount++
              return
            }

            if (outcome === 'FAILED') {
              results.push({
                campaignId: meta.id,
                campaignName: meta.campaign_name,
                success: false,
                error: reason || '暂停失败',
              })
              errorCount++
            }
          },
        })

        if (summary.skipReason === 'CREDENTIALS_MISSING') {
          const accountError =
            summary.failures.find((item) => item.campaignId === '*')?.reason ||
            'Google Ads 认证信息缺失'
          accountCampaigns.forEach((campaign) => {
            results.push({
              campaignId: campaign.id,
              campaignName: campaign.campaign_name,
              success: false,
              error: accountError,
            })
            errorCount++
          })
        }
      } catch (error: any) {
        console.error(`获取账号信息失败 (Account ID: ${accountId}):`, error)
        accountCampaigns.forEach((campaign) => {
          results.push({
            campaignId: campaign.id,
            campaignName: campaign.campaign_name,
            success: false,
            error: `账号处理错误: ${error.message}`,
          })
          errorCount++
        })
      }
    }

    return NextResponse.json({
      success: errorCount === 0,
      message: `已暂停 ${pausedCount} 个广告系列${errorCount > 0 ? `，${errorCount} 个失败` : ''}`,
      pausedCount,
      errorCount,
      totalCount: campaigns.length,
      campaigns: results,
    })
  } catch (error: any) {
    console.error('暂停广告系列API错误:', error)
    return NextResponse.json(
      {
        error: '暂停广告系列失败',
        message: error.message,
      },
      { status: 500 }
    )
  }
}
