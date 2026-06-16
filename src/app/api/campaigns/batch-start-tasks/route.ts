import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { batchStartTasksForOffers } from '@/lib/campaign/server'
import {
  buildBatchStartTasksHttpParts,
  coerceBatchStartTaskFlag,
  logBatchStartTasksHttpOutcome,
  normalizeBatchStartClientRequestId,
  parseBatchStartRequestBody,
} from '@/lib/campaign/server'

/**
 * POST /api/campaigns/batch-start-tasks
 * 批量开启广告系列关联 Offer 的补点击和换链任务
 *
 * 公共配置：
 * - 补点击：每日点击数 10、开始日期（当前日期）、时间段 - 白天 (06:00-24:00)、持续时长（不限期）、Referer 类型（留空）、时间分布曲线（均衡分布）
 * - 换链接：换链方式（方式一：自动访问推广链接解析）、换链间隔（24 小时）、任务持续（不限期）
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const parsed = await parseBatchStartRequestBody(request)
    if (!parsed.ok) {
      return parsed.response
    }
    const body = parsed.body
    const clientRequestId = normalizeBatchStartClientRequestId(body.clientRequestId)
    const enableClickFarm = coerceBatchStartTaskFlag(body.enableClickFarm, true)
    const enableUrlSwap = coerceBatchStartTaskFlag(body.enableUrlSwap, true)
    const { campaignIds } = body as { campaignIds?: unknown }

    if (!enableClickFarm && !enableUrlSwap) {
      return NextResponse.json({ error: '请至少选择一种任务类型' }, { status: 400 })
    }

    const normalizedCampaignIds = Array.isArray(campaignIds)
      ? Array.from(
          new Set(
            campaignIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
          )
        )
      : []

    if (normalizedCampaignIds.length === 0) {
      return NextResponse.json({ error: '请选择至少一个广告系列' }, { status: 400 })
    }

    const db = await getDatabase()

    // 查询广告系列关联的 Offer
    const campaignIdPlaceholders = normalizedCampaignIds.map(() => '?').join(',')
    const campaigns = (await db.query(
      `
      SELECT DISTINCT o.id as offer_id, o.target_country
      FROM campaigns c
      INNER JOIN offers o ON c.offer_id = o.id
      WHERE c.id IN (${campaignIdPlaceholders}) AND c.user_id = ? AND c.is_deleted = FALSE
        AND o.is_deleted = FALSE
    `,
      [...normalizedCampaignIds, userId]
    )) as Array<{
      offer_id: number
      target_country: string
    }>

    if (campaigns.length === 0) {
      return NextResponse.json({ error: '未找到有效的广告系列或 Offer' }, { status: 404 })
    }

    const requestedIdsCount = normalizedCampaignIds.length
    const matchedOfferCount = campaigns.length

    const result = await batchStartTasksForOffers({
      userId,
      offers: campaigns.map((campaign) => ({
        offerId: campaign.offer_id,
        targetCountry: campaign.target_country,
      })),
      enableClickFarm,
      enableUrlSwap,
    })

    const { status, message, data } = buildBatchStartTasksHttpParts({
      result,
      requestedIdsCount,
      matchedOfferCount,
      selectionIdKind: 'campaign',
      clientRequestId,
    })

    logBatchStartTasksHttpOutcome('campaigns', userId, status, data)

    return NextResponse.json(
      {
        success: result.success,
        partialSuccess: result.partialSuccess,
        message,
        data,
      },
      { status }
    )
  } catch (error: any) {
    console.error('批量开启任务失败:', error)
    return NextResponse.json({ error: error.message || '批量开启任务失败' }, { status: 500 })
  }
}
