import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { parsePositiveIntegerOfferId } from '@/lib/offers/server'

/**
 * GET /api/offers/:id/google-ads-ids
 * 返回Offer关联的Google Ads Customer ID / Campaign ID（从本地数据库获取，不依赖Google Ads API）
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: 'Unauthorized', message: '请先登录' }, { status: 401 })
    }
    const userIdNum = authResult.user.userId
    const offerId = parsePositiveIntegerOfferId(params.id)
    if (!offerId) {
      return NextResponse.json({ error: 'Offer ID无效' }, { status: 400 })
    }
    const db = await getDatabase()

    // 验证Offer是否存在且属于该用户
    const offer = await db.queryOne(`SELECT id FROM offers WHERE id = ? AND user_id = ?`, [
      offerId,
      userIdNum,
    ])
    if (!offer) {
      return NextResponse.json({ error: 'Offer 不存在' }, { status: 404 })
    }

    // campaigns.is_deleted 为 BOOLEAN
    const isDeletedCheck = 'c.is_deleted = FALSE'

    const row = (await db.queryOne(
      `
        SELECT
          gaa.customer_id as customer_id,
          c.google_campaign_id as google_campaign_id,
          c.campaign_id as campaign_id
        FROM campaigns c
        LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
        WHERE c.offer_id = ? AND c.user_id = ?
          AND ${isDeletedCheck}
          AND c.status != 'REMOVED'
          AND (
            (c.google_campaign_id IS NOT NULL AND c.google_campaign_id != '')
            OR (c.campaign_id IS NOT NULL AND c.campaign_id != '')
          )
        ORDER BY c.created_at DESC
        LIMIT 1
      `,
      [offerId, userIdNum]
    )) as any

    const googleCustomerId = row?.customer_id || null
    const googleCampaignId = row?.google_campaign_id || row?.campaign_id || null

    return NextResponse.json({
      success: true,
      data: {
        googleCustomerId,
        googleCampaignId,
      },
    })
  } catch (error: any) {
    console.error('获取Offer关联Google Ads信息失败:', error)
    return NextResponse.json(
      { error: error.message || '获取Offer关联Google Ads信息失败' },
      { status: 500 }
    )
  }
}
