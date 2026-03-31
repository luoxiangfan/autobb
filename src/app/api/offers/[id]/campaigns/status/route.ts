import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

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

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params
    const campaignId = request.nextUrl.searchParams.get('campaignId')

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    if (!campaignId) {
      // 向后兼容：某些OpenClaw流程会遗漏campaignId，兜底返回该Offer最新Campaign状态
      const db = await getDatabase()
      const latestCampaign = await db.queryOne(
        `SELECT
          id,
          offer_id,
          creation_status,
          creation_error,
          google_campaign_id
        FROM campaigns
        WHERE offer_id = ? AND user_id = ?
        ORDER BY created_at DESC
        LIMIT 1`,
        [parseInt(id), parseInt(userId)]
      ) as any

      if (!latestCampaign) {
        return NextResponse.json(
          { error: 'Campaign not found' },
          { status: 404 }
        )
      }

      return NextResponse.json({
        success: true,
        warning: 'campaignId 参数缺失，已返回该Offer最新Campaign状态',
        campaign: {
          id: latestCampaign.id,
          offer_id: latestCampaign.offer_id,
          creation_status: latestCampaign.creation_status,
          creation_error: latestCampaign.creation_error,
          google_campaign_id: latestCampaign.google_campaign_id
        }
      })
    }

    // 从数据库查询campaign状态
    const db = await getDatabase()
    const campaign = await db.queryOne(
      `SELECT
        id,
        offer_id,
        creation_status,
        creation_error,
        google_campaign_id
      FROM campaigns
      WHERE id = ? AND offer_id = ? AND user_id = ?`,
      [parseInt(campaignId), parseInt(id), parseInt(userId)]
    ) as any

    if (!campaign) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      campaign: {
        id: campaign.id,
        offer_id: campaign.offer_id,
        creation_status: campaign.creation_status,
        creation_error: campaign.creation_error,
        google_campaign_id: campaign.google_campaign_id
      }
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
