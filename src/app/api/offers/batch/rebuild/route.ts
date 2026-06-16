/**
 * POST /api/offers/batch/rebuild
 *
 * 批量重建 Offer（与单条 rebuild 共用 createOfferExtractionTaskForExistingOffer）
 */

import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { zErr } from '@/lib/common/server'
import { getDatabase } from '@/lib/db'
import { findOfferById } from '@/lib/offers/server'
import { deleteKeywordPool } from '@/lib/offer-keyword-pool'
import {
  enqueueExistingOfferExtractionAndMarkQueued,
  findOfferIdsWithActiveExtractionTasks,
  isOfferScrapeStatusBusy,
} from '@/lib/offers/server'
import { normalizeOfferExtractionMode } from '@/lib/offers/server'

export const maxDuration = 120

const requestSchema = z.object({
  offerIds: z
    .array(z.number().int(zErr.int).positive(zErr.positiveInt))
    .min(1, zErr.minItems(1))
    .max(50, zErr.maxItems(50)),
})

interface OfferRow {
  id: number
}

export async function POST(request: NextRequest) {
  const db = getDatabase()
  const parentRequestId = request.headers.get('x-request-id') || undefined

  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: 'Unauthorized', message: '请先登录' }, { status: 401 })
    }
    const userIdNum = authResult.user.userId

    const body = await request.json()
    const parsed = requestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', message: 'offerIds参数无效（1~50个数字ID）' },
        { status: 400 }
      )
    }

    const offerIds = Array.from(new Set(parsed.data.offerIds))
    if (offerIds.length === 0) {
      return NextResponse.json(
        { error: 'Invalid request', message: '请选择Offer' },
        { status: 400 }
      )
    }
    if (offerIds.length > 50) {
      return NextResponse.json(
        { error: 'Too many offers', message: '单次最多支持50个Offer' },
        { status: 400 }
      )
    }

    const notDeletedCondition = "(is_deleted IS NULL OR is_deleted::text IN ('0', 'f', 'false'))"

    const placeholders = offerIds.map(() => '?').join(',')
    const offers = await db.query<OfferRow>(
      `SELECT id FROM offers WHERE id IN (${placeholders}) AND user_id = ? AND ${notDeletedCondition}`,
      [...offerIds, userIdNum]
    )

    if (!offers || offers.length === 0) {
      return NextResponse.json(
        { error: 'Not found', message: '未找到可重建的Offer' },
        { status: 404 }
      )
    }

    const offerIdList = offers.map((o) => o.id)
    const busyOfferIds = await findOfferIdsWithActiveExtractionTasks(offerIdList)

    let enqueuedCount = 0
    let skippedCount = 0
    let failedCount = 0
    const taskIds: string[] = []
    const errors: Array<{ offerId: number; reason: string }> = []

    for (const { id: offerId } of offers) {
      try {
        if (busyOfferIds.has(offerId)) {
          skippedCount++
          continue
        }

        const offer = await findOfferById(offerId, userIdNum)
        if (!offer) {
          errors.push({ offerId, reason: 'Offer不存在或无权限' })
          skippedCount++
          continue
        }

        if (isOfferScrapeStatusBusy(offer.scrape_status)) {
          skippedCount++
          continue
        }

        const { taskId } = await enqueueExistingOfferExtractionAndMarkQueued({
          offer,
          userId: userIdNum,
          offerId,
          extractionMode: normalizeOfferExtractionMode(offer.extraction_mode),
          parentRequestId,
        })

        try {
          await deleteKeywordPool(offerId)
        } catch {
          // 入队成功后再删关键词池
        }

        taskIds.push(taskId)
        enqueuedCount++
      } catch (error: any) {
        console.error(`❌ Offer ${offerId} 重建失败:`, error)
        errors.push({ offerId, reason: error.message || '未知错误' })
        failedCount++
      }
    }

    return NextResponse.json({
      success: true,
      enqueuedCount,
      skippedCount,
      failedCount,
      taskIds,
      errors: errors.length > 0 ? errors : undefined,
      message: `已为 ${enqueuedCount} 个Offer创建重建任务${skippedCount > 0 ? `，跳过 ${skippedCount} 个` : ''}${failedCount > 0 ? `，失败 ${failedCount} 个` : ''}`,
    })
  } catch (error: any) {
    console.error('❌ 批量重建Offer失败:', error)
    return NextResponse.json(
      { error: 'Internal server error', message: error.message || '批量重建Offer失败' },
      { status: 500 }
    )
  }
}
