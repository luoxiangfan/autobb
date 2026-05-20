import { NextRequest, NextResponse } from 'next/server'
import { deleteKeywordPool } from '@/lib/offer-keyword-pool'
import { convertPriorityToEnum } from '@/lib/queue/executors'
import {
  assertOfferAvailableForExtractionEnqueue,
  enqueueExistingOfferExtractionAndMarkQueued,
} from '@/lib/offer-extraction-task'
import {
  getExtractionModeFromRequestBody,
  normalizeOfferExtractionMode,
} from '@/lib/offer-extraction-mode'
import { applyOfferUpdateFromBody, pickOfferUpdateBody } from '@/lib/offer-update-from-body'
import { offerExtractApiErrorBody } from '@/lib/offer-extract-request'

/**
 * POST /api/offers/:id/scrape
 *
 * @deprecated 请使用 POST /api/offers/:id/rebuild。本接口已转发至 offer-extraction 队列。
 * 请求体可与 rebuild 相同，先合并保存 Offer 字段再入队。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const offerIdNum = parseInt(params.id, 10)

  if (isNaN(offerIdNum)) {
    return NextResponse.json(
      { error: 'Invalid request', message: 'Invalid offer ID' },
      { status: 400 }
    )
  }

  try {
    const userId = request.headers.get('x-user-id')
    const parentRequestId = request.headers.get('x-request-id') || undefined
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: '请先登录' },
        { status: 401 }
      )
    }

    const userIdNum = parseInt(userId, 10)

    let requestBody: unknown = {}
    let priority: number | undefined
    try {
      requestBody = await request.json()
      if (requestBody && typeof requestBody === 'object' && 'priority' in requestBody) {
        const p = (requestBody as { priority?: unknown }).priority
        if (typeof p === 'number') priority = p
      }
    } catch {
      // empty body
    }

    const modeFromBody = getExtractionModeFromRequestBody(requestBody)
    if ('invalid' in modeFromBody && modeFromBody.invalid) {
      return NextResponse.json(
        {
          error: 'Invalid data',
          message: '无效的提取模式，可选：fast、balanced、original',
        },
        { status: 400 }
      )
    }

    const applyResult = await applyOfferUpdateFromBody(offerIdNum, userIdNum, requestBody)
    if ('error' in applyResult) {
      return NextResponse.json(
        {
          error: applyResult.status === 404 ? 'Not found' : 'Invalid data',
          message: applyResult.error,
        },
        { status: applyResult.status }
      )
    }

    const offer = applyResult.offer
    const extractionMode = ('mode' in modeFromBody ? modeFromBody.mode : undefined)
      ?? normalizeOfferExtractionMode(offer.extraction_mode)

    const pickedUpdate = pickOfferUpdateBody(requestBody)
    const extractionModePersistedByApply = Boolean(
      pickedUpdate
      && (pickedUpdate.extraction_mode !== undefined || pickedUpdate.extractionMode !== undefined)
    )

    await assertOfferAvailableForExtractionEnqueue(offer)

    const { taskId } = await enqueueExistingOfferExtractionAndMarkQueued({
      offer,
      userId: userIdNum,
      offerId: offerIdNum,
      extractionMode,
      parentRequestId,
      priority: convertPriorityToEnum(priority),
      skipExtractionModePersist: extractionModePersistedByApply,
    })

    try {
      await deleteKeywordPool(offerIdNum)
    } catch {
      // 入队成功后再删关键词池
    }

    console.warn(
      `[DEPRECATED] POST /api/offers/${offerIdNum}/scrape → offer-extraction task ${taskId}`
    )

    return NextResponse.json({
      success: true,
      message: '提取任务已加入队列（scrape 接口已废弃，内部使用 offer-extraction）',
      taskId,
      extractionMode,
      deprecated: true,
      replacement: `/api/offers/${offerIdNum}/rebuild`,
    })
  } catch (error: unknown) {
    const apiError = offerExtractApiErrorBody(error, 'Invalid data')
    if (apiError) {
      return NextResponse.json(
        { error: apiError.error, message: apiError.message },
        { status: apiError.status }
      )
    }

    console.error('触发抓取失败:', error)
    const message = error instanceof Error ? error.message : '触发抓取失败'

    if (message.includes('队列已满')) {
      return NextResponse.json(
        { error: '系统繁忙', message: '系统繁忙，请稍后重试' },
        { status: 503 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error', message },
      { status: 500 }
    )
  }
}
