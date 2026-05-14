import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { batchStartTasksForOffers } from '@/lib/batch-start-tasks'
import {
  buildBatchStartTasksApiData,
  logBatchStartTasksHttpOutcome,
  normalizeBatchStartClientRequestId,
} from '@/lib/batch-start-tasks-route-helpers'

/**
 * POST /api/offers/batch-start-tasks
 * 批量开启 Offer 的补点击和换链任务
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
    const body = await request.json()
    const clientRequestId = normalizeBatchStartClientRequestId(body?.clientRequestId)
    const { offerIds, enableClickFarm = true, enableUrlSwap = true } = body

    if (!enableClickFarm && !enableUrlSwap) {
      return NextResponse.json(
        { error: '请至少选择一种任务类型' },
        { status: 400 }
      )
    }

    const normalizedOfferIds = Array.isArray(offerIds)
      ? Array.from(
          new Set(
            offerIds
              .map((id) => Number(id))
              .filter((id) => Number.isInteger(id) && id > 0)
          )
        )
      : []

    if (normalizedOfferIds.length === 0) {
      return NextResponse.json(
        { error: '请选择至少一个 Offer' },
        { status: 400 }
      )
    }

    const db = await getDatabase()

    // 查询 Offer 信息
    const offerIdPlaceholders = normalizedOfferIds.map(() => '?').join(',')
    const offers = await db.query(`
      SELECT id, target_country
      FROM offers
      WHERE id IN (${offerIdPlaceholders}) AND user_id = ? AND IS_DELETED_FALSE
    `, [...normalizedOfferIds, userId]) as Array<{
      id: number
      target_country: string
    }>

    if (offers.length === 0) {
      return NextResponse.json(
        { error: '未找到有效的 Offer' },
        { status: 404 }
      )
    }

    const requestedIdsCount = normalizedOfferIds.length
    const matchedOfferCount = offers.length

    const result = await batchStartTasksForOffers({
      userId,
      offers: offers.map((offer) => ({
        offerId: offer.id,
        targetCountry: offer.target_country,
      })),
      enableClickFarm,
      enableUrlSwap,
    })

    const completedClickFarm = result.clickFarmTasksCreated + result.clickFarmTasksUpdated
    const completedUrlSwap = result.urlSwapTasksCreated + result.urlSwapTasksUpdated
    const status = result.success ? 200 : result.partialSuccess ? 207 : 500
    const message = result.success
      ? `成功处理 ${completedClickFarm} 个补点击任务和 ${completedUrlSwap} 个换链接任务`
      : result.partialSuccess
        ? `部分成功：已处理 ${completedClickFarm} 个补点击任务和 ${completedUrlSwap} 个换链接任务，失败 ${result.failedOfferCount} 个 Offer`
        : '批量开启任务失败'

    const data = buildBatchStartTasksApiData(result, requestedIdsCount, matchedOfferCount, clientRequestId)

    logBatchStartTasksHttpOutcome('offers', userId, status, {
      clientRequestId,
      requestedIdsCount,
      matchedOfferCount,
      partialSuccess: result.partialSuccess,
      failedOfferCount: result.failedOfferCount,
      failedOperationCount: result.errors.length,
    })

    return NextResponse.json({
      success: result.success,
      partialSuccess: result.partialSuccess,
      message,
      data,
    }, { status })
  } catch (error: any) {
    console.error('批量开启任务失败:', error)
    return NextResponse.json(
      { error: error.message || '批量开启任务失败' },
      { status: 500 }
    )
  }
}

