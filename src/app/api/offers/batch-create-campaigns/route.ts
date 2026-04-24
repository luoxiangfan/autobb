import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { createCampaign } from '@/lib/campaigns'

/**
 * POST /api/offers/batch-create-campaigns
 * 批量为 Offer 创建广告系列
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const body = await request.json()
    const { 
      offerIds, 
      googleAdsAccountId,
      campaignConfig 
    } = body

    if (!offerIds || !Array.isArray(offerIds) || offerIds.length === 0) {
      return NextResponse.json(
        { error: '请选择至少一个 Offer' },
        { status: 400 }
      )
    }

    if (!googleAdsAccountId) {
      return NextResponse.json(
        { error: '请选择 Google Ads 账号' },
        { status: 400 }
      )
    }

    const db = await getDatabase()

    // 验证 Google Ads 账号存在且属于当前用户
    const adsAccount = await db.queryOne(`
      SELECT id, customer_id, account_name, is_active, is_deleted
      FROM google_ads_accounts
      WHERE id = ? AND user_id = ?
    `, [googleAdsAccountId, userId]) as {
      id: number
      customer_id: string
      account_name: string
      is_active: number | boolean
      is_deleted: number | boolean
    } | undefined

    if (!adsAccount) {
      return NextResponse.json(
        { error: 'Google Ads 账号不存在或无权访问' },
        { status: 404 }
      )
    }

    const isActive = adsAccount.is_active === true || adsAccount.is_active === 1
    const isDeleted = adsAccount.is_deleted === true || adsAccount.is_deleted === 1

    if (!isActive || isDeleted) {
      return NextResponse.json(
        { error: 'Google Ads 账号已禁用或删除' },
        { status: 400 }
      )
    }

    const result = {
      success: true,
      created: 0,
      skipped: 0,
      errors: [] as Array<{ offerId: number; error: string }>,
    }
    const isDeletedFalse = db.type === 'postgres' ? 'FALSE' : '0'
    // 批量创建广告系列
    for (const offerId of offerIds) {
      try {
        // 检查 Offer 是否存在且属于当前用户
        const offer = await db.queryOne(`
          SELECT id, offer_name, brand
          FROM offers
          WHERE id = ? AND user_id = ? AND is_deleted = ${isDeletedFalse}
        `, [offerId, userId])

        if (!offer) {
          result.errors.push({
            offerId,
            error: 'Offer 不存在或无权访问',
          })
          continue
        }

        // 检查是否已有活跃的广告系列
        const existingCampaign = await db.queryOne(`
          SELECT id FROM campaigns
          WHERE offer_id = ? AND user_id = ? AND is_deleted = ${isDeletedFalse}
        `, [offerId, userId])

        if (existingCampaign) {
          result.skipped++
          continue
        }

        // 创建广告系列
        const campaignName = campaignConfig?.campaignName || `${offer.brand || offer.offer_name}_Campaign`
        
        await createCampaign({
          userId: userId,
          offerId,
          googleAdsAccountId,
          campaignName,
          budgetAmount: campaignConfig?.budgetAmount || 50,
          budgetType: campaignConfig?.budgetType || 'DAILY',
          targetCpa: campaignConfig?.targetCpa || null,
          maxCpc: campaignConfig?.maxCpc || null,
          status: campaignConfig?.status || 'PAUSED',
        })

        result.created++
      } catch (error: any) {
        result.errors.push({
          offerId,
          error: error.message,
        })
        console.error(`[Batch Create Campaigns] Error for offer ${offerId}:`, error)
      }
    }

    return NextResponse.json({
      success: true,
      message: `成功创建 ${result.created} 个广告系列，跳过 ${result.skipped} 个（已有活跃广告系列）`,
      data: result,
    })
  } catch (error: any) {
    console.error('批量创建广告系列失败:', error)
    return NextResponse.json(
      { error: error.message || '批量创建失败' },
      { status: 500 }
    )
  }
}
