import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/offers/:id/google-ads-ids
 * 返回Offer关联的Google Ads Customer ID / Campaign ID（从本地数据库获取，不依赖Google Ads API）
 */
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const offerId = parseInt(params.id, 10)
    if (Number.isNaN(offerId)) {
      return NextResponse.json({ error: '无效的 Offer ID' }, { status: 400 })
    }

    const userIdNum = parseInt(userId, 10)
    const db = await getDatabase()

    // 验证Offer是否存在且属于该用户
    const offer = await db.queryOne(`SELECT id FROM offers WHERE id = ? AND user_id = ?`, [offerId, userIdNum])
    if (!offer) {
      return NextResponse.json({ error: 'Offer 不存在' }, { status: 404 })
    }

    // campaigns 表兼容 SQLite(INTEGER 0/1) / PostgreSQL(BOOLEAN)
    const isDeletedCheck = db.type === 'postgres' ? 'c.is_deleted = FALSE' : 'c.is_deleted = 0'

    const row = await db.queryOne(
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
    ) as any

    const googleCustomerId = row?.customer_id || null
    const googleCampaignId = (row?.google_campaign_id || row?.campaign_id) || null

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

