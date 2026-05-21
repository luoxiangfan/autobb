/**
 * POST /api/offers/[id]/rebuild
 *
 * 重建 Offer：可选先合并保存表单字段，再入队 offer-extraction
 */

import { NextRequest, NextResponse } from 'next/server'
import { deleteKeywordPool } from '@/lib/offer-keyword-pool'
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

export const maxDuration = 120

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const parentRequestId = req.headers.get('x-request-id') || undefined
  const offerId = parseInt(params.id, 10)

  if (isNaN(offerId)) {
    return NextResponse.json(
      { error: 'Invalid request', message: 'Invalid offer ID' },
      { status: 400 }
    )
  }

  try {
    const userId = req.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: '请先登录' },
        { status: 401 }
      )
    }
    const userIdNum = parseInt(userId, 10)

    let requestBody: unknown = {}
    try {
      requestBody = await req.json()
    } catch {
      // empty body is fine
    }

    const modeFromBody = getExtractionModeFromRequestBody(requestBody)
    if ('invalid' in modeFromBody && modeFromBody.invalid) {
      return NextResponse.json(
        {
          error: 'Invalid data',
          message: '无效的提取模式，可选：fast（快速）、balanced（均衡）、original（标准）',
        },
        { status: 400 }
      )
    }

    const applyResult = await applyOfferUpdateFromBody(offerId, userIdNum, requestBody)
    if ('error' in applyResult) {
      return NextResponse.json(
        { error: applyResult.status === 404 ? 'Not found' : 'Invalid data', message: applyResult.error },
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
      offerId,
      extractionMode,
      parentRequestId,
      skipExtractionModePersist: extractionModePersistedByApply,
    })

    try {
      await deleteKeywordPool(offerId)
    } catch {
      // 入队成功后再删关键词池
    }

    return NextResponse.json({
      success: true,
      taskId,
      offerId,
      extractionMode,
      message: 'Offer重建任务已创建，正在后台处理',
    })
  } catch (error: unknown) {
    const apiError = offerExtractApiErrorBody(error, 'Invalid data')
    if (apiError) {
      return NextResponse.json(
        { error: apiError.error, message: apiError.message },
        { status: apiError.status }
      )
    }

    console.error(`❌ 重建Offer失败 (offerId=${offerId}):`, error)
    const message = error instanceof Error ? error.message : '重建Offer失败'

    if (message.includes('队列已满')) {
      return NextResponse.json(
        { error: '系统繁忙', message: '系统繁忙，请稍后重试' },
        { status: 503 }
      )
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        message,
      },
      { status: 500 }
    )
  }
}
