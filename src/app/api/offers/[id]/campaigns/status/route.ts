import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { offerOccupyingCampaignWhereClause } from '@/lib/campaign/server'
import { parsePositiveIntegerOfferId } from '@/lib/offers/server'

/**
 * GET /api/offers/:id/campaigns/status?campaignId=:campaignId
 * 获取单个campaign的创建状态（用于轮询）
 *
 * 响应格式:
 * {
 *   "campaign": {
 *     "id": number,
 *     "offer_id": number,
 *     "creation_status": "pending" | "synced" | "failed",
 *     "creation_error": string | null,
 *     "google_campaign_id": string | null
 *   }
 * }
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const { id } = params
    const offerId = parsePositiveIntegerOfferId(id)
    if (!offerId) {
      return NextResponse.json({ error: 'Offer ID无效' }, { status: 400 })
    }
    const campaignId = request.nextUrl.searchParams.get('campaignId')

    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
    }
    const userId = authResult.user.userId

    if (!campaignId) {
      // 向后兼容：某些 OpenClaw 流程会遗漏 campaignId，返回仍占用槽位的 Campaign 状态
      const db = await getDatabase()
      const numericUserId = userId
      const occupyingWhere = offerOccupyingCampaignWhereClause()
      const latestCampaign = (await db.queryOne(
        `SELECT
          id,
          offer_id,
          creation_status,
          creation_error,
          COALESCE(NULLIF(TRIM(google_campaign_id), ''), NULLIF(TRIM(campaign_id), '')) AS google_campaign_id
        FROM campaigns
        WHERE ${occupyingWhere}
        ORDER BY updated_at DESC, id DESC
        LIMIT 1`,
        [offerId, numericUserId]
      )) as any

      if (!latestCampaign) {
        return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
      }

      return NextResponse.json({
        success: true,
        warning: 'campaignId 参数缺失，已返回该Offer最新Campaign状态',
        campaign: {
          id: latestCampaign.id,
          offer_id: latestCampaign.offer_id,
          creation_status: latestCampaign.creation_status,
          creation_error: latestCampaign.creation_error,
          google_campaign_id: latestCampaign.google_campaign_id,
        },
      })
    }

    const parsedCampaignId = parsePositiveIntegerOfferId(campaignId)
    if (!parsedCampaignId) {
      return NextResponse.json({ error: 'Campaign ID无效' }, { status: 400 })
    }

    // 从数据库查询campaign状态
    const db = await getDatabase()
    const campaign = (await db.queryOne(
      `SELECT
        id,
        offer_id,
        creation_status,
        creation_error,
        COALESCE(NULLIF(TRIM(google_campaign_id), ''), NULLIF(TRIM(campaign_id), '')) AS google_campaign_id
      FROM campaigns
      WHERE id = ? AND offer_id = ? AND user_id = ?`,
      [parsedCampaignId, offerId, userId]
    )) as any

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      campaign: {
        id: campaign.id,
        offer_id: campaign.offer_id,
        creation_status: campaign.creation_status,
        creation_error: campaign.creation_error,
        google_campaign_id: campaign.google_campaign_id,
      },
    })
  } catch (error: any) {
    console.error('获取Campaign状态失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取Campaign状态失败',
      },
      { status: 500 }
    )
  }
}
