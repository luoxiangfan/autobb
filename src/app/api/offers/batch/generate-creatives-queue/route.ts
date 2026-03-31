/**
 * POST /api/offers/batch/generate-creatives-queue
 *
 * 批量将广告创意生成任务加入队列（每个Offer最多入队1个任务）
 *
 * 规则：
 * - 单次最多50个Offer
 * - 仅处理 scrape_status = 'completed' 的Offer；pending/in_progress/failed 跳过
 * - 若该Offer已存在 pending/running 的创意任务，则跳过
 * - 若该Offer已生成满3种类型（A/B/D），则跳过
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { getQueueManager } from '@/lib/queue'
import { getGoogleAdsConfig } from '@/lib/keyword-planner'
import { getUserAuthType } from '@/lib/google-ads-oauth'
import type { AdCreativeTaskData } from '@/lib/queue/executors/ad-creative-executor'
import { toDbJsonObjectField } from '@/lib/json-field'
import { AD_CREATIVE_MAX_AUTO_RETRIES } from '@/lib/ad-creative-quality-loop'
import { getAvailableBuckets } from '@/lib/offer-keyword-pool'
import {
  deriveCanonicalCreativeType,
} from '@/lib/creative-type'
import { extractModelAnchorTextsFromScrapedData } from '@/lib/model-anchor-evidence'
import { normalizeSingleCreativeSelection } from '@/lib/creative-request-normalizer'

export const maxDuration = 60

type NormalizedCreativeBucket = 'A' | 'B' | 'D'
const BATCH_FORCE_GENERATE_ON_QUALITY_GATE = true
const BATCH_QUALITY_GATE_BYPASS_REASON = 'offers_batch_auto_bypass_quality_gate'

const requestSchema = z.object({
  offerIds: z.array(z.number().int().positive()).min(1).max(50),
  bucket: z.unknown().optional(),
  creativeType: z.unknown().optional(),
})

export async function POST(request: NextRequest) {
  const db = getDatabase()
  const queue = getQueueManager()
  const parentRequestId = request.headers.get('x-request-id') || undefined
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  try {
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: '请先登录' },
        { status: 401 }
      )
    }
    const userIdNum = parseInt(userId, 10)

    const body = await request.json()
    const parsed = requestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', message: 'offerIds参数无效（1~50个数字ID）' },
        { status: 400 }
      )
    }

    const offerIds = Array.from(new Set(parsed.data.offerIds))
    const hasExplicitCreativeType = parsed.data.creativeType !== undefined
      && parsed.data.creativeType !== null
      && String(parsed.data.creativeType).trim() !== ''
    const normalizedSelection = normalizeSingleCreativeSelection({
      creativeType: parsed.data.creativeType,
      bucket: parsed.data.bucket,
      hasExplicitCreativeType,
      hasExplicitBucket: parsed.data.bucket !== undefined,
    })
    const bucketSelection = normalizedSelection.bucketSelection
    const requestedBucket = normalizedSelection.requestedBucket
    const requestedBucketFromCreativeType = normalizedSelection.bucketFromCreativeType

    if (normalizedSelection.errorCode === 'invalid-creative-type') {
      return NextResponse.json(
        {
          error: 'Invalid creativeType',
          message: 'creativeType 仅支持 brand_intent / model_intent / product_intent（兼容旧值：brand_focus / model_focus / brand_product）',
        },
        { status: 400 }
      )
    }

    if (normalizedSelection.errorCode === 'invalid-bucket') {
      return NextResponse.json(
        {
          error: 'Invalid bucket',
          message: 'bucket 仅支持 A / B / D（兼容旧值：C→B，S→D）',
        },
        { status: 400 }
      )
    }

    if (normalizedSelection.errorCode === 'creative-type-bucket-conflict') {
      return NextResponse.json(
        {
          error: 'creativeType-bucket-conflict',
          message: 'creativeType 与 bucket 不一致，请传入同一创意类型对应的槽位',
        },
        { status: 400 }
      )
    }

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

    // 统一校验 Google Ads API 配置（用户级），避免逐Offer失败
    const auth = await getUserAuthType(userIdNum)
    try {
      const googleAdsConfig = await getGoogleAdsConfig(
        userIdNum,
        auth.authType,
        auth.serviceAccountId
      )

      const isConfigComplete = auth.authType === 'service_account'
        ? !!(googleAdsConfig?.developerToken && googleAdsConfig?.customerId)
        : !!(googleAdsConfig?.developerToken && googleAdsConfig?.refreshToken && googleAdsConfig?.customerId)

      if (!isConfigComplete) {
        return NextResponse.json(
          {
            error: '广告创意生成需要完整的 Google Ads API 配置',
            details: auth.authType === 'service_account'
              ? '请前往【设置】→【服务账号配置】页面检查服务账号配置，确保 Developer Token 和 MCC Customer ID 已正确配置。'
              : '请前往【设置】页面配置 Google Ads API 凭证（Developer Token、Refresh Token、Customer ID）以启用关键词搜索量查询功能。',
            missingFields: auth.authType === 'service_account'
              ? [
                  !googleAdsConfig?.developerToken && 'Developer Token',
                  !googleAdsConfig?.customerId && 'MCC Customer ID',
                ].filter(Boolean)
              : [
                  !googleAdsConfig?.developerToken && 'Developer Token',
                  !googleAdsConfig?.refreshToken && 'Refresh Token / OAuth',
                  !googleAdsConfig?.customerId && 'Customer ID',
                ].filter(Boolean),
            authType: auth.authType,
          },
          { status: 400 }
        )
      }
    } catch (error: any) {
      console.error('[BatchCreativeGeneration] Failed to check Google Ads config:', error)
      // 不阻止任务继续（允许降级运行，但会记录警告）
    }

    // 1) 批量读取Offer状态（只处理当前用户且未删除）
    const placeholders = offerIds.map(() => '?').join(',')
    const notDeletedCondition = db.type === 'postgres'
      ? '(is_deleted = false OR is_deleted IS NULL)'
      : '(is_deleted = 0 OR is_deleted IS NULL)'

    const offers = await db.query<{
      id: number
      scrape_status: string | null
      product_name: string | null
      extracted_keywords: string | null
      extracted_headlines: string | null
      brand_description: string | null
      unique_selling_points: string | null
      product_highlights: string | null
      extracted_descriptions: string | null
      offer_name: string | null
      category: string | null
      scraped_data: string | null
    }>(
      `SELECT id, scrape_status, product_name, extracted_keywords, extracted_headlines,
              brand_description, unique_selling_points, product_highlights, extracted_descriptions,
              offer_name, category, scraped_data
       FROM offers
       WHERE user_id = ? AND id IN (${placeholders}) AND ${notDeletedCondition}`,
      [userIdNum, ...offerIds]
    )
    const offersById = new Map(offers.map(o => [o.id, o]))

    // 2) 查询是否已有 pending/running 的创意任务
    const activeTasks = await db.query<{ offer_id: number }>(
      `SELECT DISTINCT offer_id
       FROM creative_tasks
       WHERE user_id = ? AND offer_id IN (${placeholders}) AND status IN ('pending', 'running')`,
      [userIdNum, ...offerIds]
    )
    const offersWithActiveTask = new Set(activeTasks.map(t => t.offer_id))

    // 3) 逐Offer入队（符合规则的才入队）
    const stats = {
      requested: offerIds.length,
      enqueued: 0,
      skipped: 0,
      failed: 0,
      skipReasons: {
        notFoundOrNoAccess: 0,
        scrapeNotReady: 0,
        taskAlreadyRunning: 0,
        quotaFull: 0,
      }
    }

    const taskIds: string[] = []

    for (const offerId of offerIds) {
      const offer = offersById.get(offerId)
      if (!offer) {
        stats.skipped++
        stats.skipReasons.notFoundOrNoAccess++
        continue
      }

      const scrapeStatus = String(offer.scrape_status || '').toLowerCase()
      if (scrapeStatus !== 'completed') {
        stats.skipped++
        stats.skipReasons.scrapeNotReady++
        continue
      }

      if (offersWithActiveTask.has(offerId)) {
        stats.skipped++
        stats.skipReasons.taskAlreadyRunning++
        continue
      }

      const availableBuckets = await getAvailableBuckets(offerId)
      if (availableBuckets.length === 0) {
        stats.skipped++
        stats.skipReasons.quotaFull++
        continue
      }

      let requestedType: NormalizedCreativeBucket | null = requestedBucketFromCreativeType || requestedBucket
      if (!requestedBucketFromCreativeType && bucketSelection.legacyModelHint && requestedBucket === 'B') {
        const scrapedModelTexts = extractModelAnchorTextsFromScrapedData(offer.scraped_data)
        const normalizedLegacyType = deriveCanonicalCreativeType({
          keywordBucket: bucketSelection.rawBucket,
          keywords: [
            offer.product_name,
            offer.extracted_keywords,
            ...scrapedModelTexts,
          ],
          headlines: [offer.extracted_headlines],
          descriptions: [
            offer.brand_description,
            offer.unique_selling_points,
            offer.product_highlights,
            offer.extracted_descriptions,
          ],
          theme: [offer.offer_name, offer.category],
        })
        requestedType = normalizedLegacyType === 'model_intent' ? 'B' : 'D'
        if (requestedType === 'D') {
          console.warn(
            `[BatchCreativeGeneration] Offer ${offerId}: legacy bucket ${bucketSelection.rawBucket} fallback to D/product_intent because no verifiable model anchor evidence was found`
          )
        }
      }

      if (requestedType && !availableBuckets.includes(requestedType)) {
        stats.skipped++
        stats.skipReasons.quotaFull++
        continue
      }

      const selectedBucket = requestedType || availableBuckets[0]

      const taskId = crypto.randomUUID()
      try {
        await db.exec(
          `INSERT INTO creative_tasks (
            id, user_id, offer_id, status, stage, progress, message,
            max_retries, target_rating, created_at, updated_at
          ) VALUES (?, ?, ?, 'pending', 'init', 0, '准备开始生成...', ?, ?, ${nowFunc}, ${nowFunc})`,
          [taskId, userIdNum, offerId, AD_CREATIVE_MAX_AUTO_RETRIES, 'GOOD']
        )

        const taskData: AdCreativeTaskData = {
          offerId,
          maxRetries: AD_CREATIVE_MAX_AUTO_RETRIES,
          targetRating: 'GOOD',
          bucket: selectedBucket,
          synthetic: false,
          forceGenerateOnQualityGate: BATCH_FORCE_GENERATE_ON_QUALITY_GATE,
          qualityGateBypassReason: BATCH_QUALITY_GATE_BYPASS_REASON,
        }

        await queue.enqueue('ad-creative', taskData, userIdNum, {
          parentRequestId,
          priority: 'high',
          taskId,
          maxRetries: 0,
        })

        stats.enqueued++
        taskIds.push(taskId)
      } catch (error: any) {
        stats.failed++
        console.error(`[BatchCreativeGeneration] Enqueue failed (offerId=${offerId}):`, error?.message || error)
        // 不中断批量：尽力将任务标记为失败（若记录已插入）
        try {
          await db.exec(
            `UPDATE creative_tasks
             SET status = 'failed', message = ?, error = ?, completed_at = ${nowFunc}, updated_at = ${nowFunc}
             WHERE id = ? AND user_id = ?`,
            [
              error?.message || '任务入队失败',
              toDbJsonObjectField(
                { message: error?.message || String(error), stack: error?.stack },
                db.type,
                { message: error?.message || String(error) }
              ),
              taskId,
              userIdNum,
            ]
          )
        } catch (markError) {
          console.error('[BatchCreativeGeneration] Failed to mark task as failed:', markError)
        }
      }
    }

    return NextResponse.json({
      success: true,
      requestedCount: stats.requested,
      enqueuedCount: stats.enqueued,
      skippedCount: stats.skipped,
      failedCount: stats.failed,
      skipReasons: stats.skipReasons,
      taskIds,
    })
  } catch (error: any) {
    console.error('[BatchCreativeGeneration] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error', message: error?.message || '批量创建失败' },
      { status: 500 }
    )
  }
}
