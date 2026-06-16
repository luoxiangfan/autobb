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

import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { zErr } from '@/lib/common/server'
import { getDatabase } from '@/lib/db'
import { getQueueManager } from '@/lib/queue'
import {
  createCreativeGenerationAuthCache,
  clearCreativeGenerationAuthCache,
  validateGoogleAdsConfigForCreativeGeneration,
  type CreativeGenerationAuthCache,
} from '@/lib/google-ads/accounts/auth/index'
import type { AdCreativeTaskData } from '@/lib/queue/executors/ad-creative-executor'
import { toDbJsonObjectField } from '@/lib/db'
import {
  CREATIVE_GENERATION_MODE_INVALID_MESSAGE,
  resolveCreativeGenerationRuntime,
} from '@/lib/creatives/server'
import { getAvailableBuckets } from '@/lib/keywords/offer-pool'
import { normalizeSingleCreativeSelection } from '@/lib/creatives/server'

export const maxDuration = 60

type NormalizedCreativeBucket = 'A' | 'B' | 'D'
const BATCH_FORCE_GENERATE_ON_QUALITY_GATE_DEFAULT = true
const BATCH_QUALITY_GATE_BYPASS_REASON = 'offers_batch_auto_bypass_quality_gate'

type BatchEnqueueStats = {
  requested: number
  enqueued: number
  skipped: number
  failed: number
  skipReasons: {
    notFoundOrNoAccess: number
    scrapeNotReady: number
    taskAlreadyRunning: number
    quotaFull: number
    googleAdsConfigIncomplete: number
  }
}

function formatBatchSkipReasonParts(stats: BatchEnqueueStats): string[] {
  const parts: string[] = []
  const reasons = stats.skipReasons
  if (reasons.notFoundOrNoAccess > 0) {
    parts.push(`${reasons.notFoundOrNoAccess} 个 Offer 不存在或无权限`)
  }
  if (reasons.scrapeNotReady > 0) {
    parts.push(`${reasons.scrapeNotReady} 个 Offer 抓取未完成`)
  }
  if (reasons.taskAlreadyRunning > 0) {
    parts.push(`${reasons.taskAlreadyRunning} 个 Offer 已有进行中的创意任务`)
  }
  if (reasons.quotaFull > 0) {
    parts.push(`${reasons.quotaFull} 个 Offer 创意槽位已满或指定类型不可用`)
  }
  if (reasons.googleAdsConfigIncomplete > 0) {
    parts.push(`${reasons.googleAdsConfigIncomplete} 个 Offer 的 Google Ads 账号配置不完整`)
  }
  if (stats.failed > 0) {
    parts.push(`${stats.failed} 个 Offer 入队失败`)
  }
  return parts
}

function buildBatchEnqueueWarning(stats: BatchEnqueueStats): string | undefined {
  if (stats.enqueued > 0 || stats.requested === 0) {
    return undefined
  }

  const parts = formatBatchSkipReasonParts(stats)
  if (parts.length === 0) {
    return '用户级 Google Ads 配置已通过，但未入队任何创意生成任务'
  }

  return `用户级 Google Ads 配置已通过，但未入队任何创意生成任务：${parts.join('；')}`
}

function buildBatchPartialSkipWarning(stats: BatchEnqueueStats): string | undefined {
  if (stats.enqueued === 0 || stats.skipped === 0) {
    return undefined
  }

  const parts = formatBatchSkipReasonParts(stats)
  if (parts.length === 0) {
    return `已入队 ${stats.enqueued} 个任务，${stats.skipped} 个 Offer 已跳过`
  }

  return `已入队 ${stats.enqueued} 个任务；${stats.skipped} 个 Offer 已跳过：${parts.join('；')}`
}

const requestSchema = z.object({
  offerIds: z
    .array(z.number().int(zErr.int).positive(zErr.positiveInt))
    .min(1, zErr.minItems(1))
    .max(50, zErr.maxItems(50)),
  bucket: z.unknown().optional(),
  creativeType: z.unknown().optional(),
  forceGenerateOnQualityGate: z.boolean().optional(),
})

export async function POST(request: NextRequest) {
  const db = getDatabase()
  const queue = getQueueManager()
  const parentRequestId = request.headers.get('x-request-id') || undefined
  const nowFunc = 'NOW()'
  let authCache: CreativeGenerationAuthCache | undefined

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
    const { runtime, invalidMode } = resolveCreativeGenerationRuntime(body)
    if (invalidMode) {
      return NextResponse.json(
        {
          error: 'Invalid generationMode',
          message: CREATIVE_GENERATION_MODE_INVALID_MESSAGE,
        },
        { status: 400 }
      )
    }
    const { mode: generationMode, maxRetries: batchMaxRetries } = runtime
    const forceGenerateOnQualityGate =
      parsed.data.forceGenerateOnQualityGate ?? BATCH_FORCE_GENERATE_ON_QUALITY_GATE_DEFAULT
    const hasExplicitCreativeType =
      parsed.data.creativeType !== undefined &&
      parsed.data.creativeType !== null &&
      String(parsed.data.creativeType).trim() !== ''
    const normalizedSelection = normalizeSingleCreativeSelection({
      creativeType: parsed.data.creativeType,
      bucket: parsed.data.bucket,
      hasExplicitCreativeType,
      hasExplicitBucket: parsed.data.bucket !== undefined,
    })
    const requestedBucket = normalizedSelection.requestedBucket
    const requestedBucketFromCreativeType = normalizedSelection.bucketFromCreativeType

    if (normalizedSelection.errorCode === 'invalid-creative-type') {
      return NextResponse.json(
        {
          error: 'Invalid creativeType',
          message:
            'creativeType 仅支持 brand_intent / model_intent / product_intent（兼容旧值：brand_focus / model_focus / brand_product）',
        },
        { status: 400 }
      )
    }

    if (normalizedSelection.errorCode === 'invalid-bucket') {
      return NextResponse.json(
        {
          error: 'Invalid bucket',
          message: 'bucket 仅支持 A / B / D',
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

    authCache = createCreativeGenerationAuthCache()
    try {
      const userAuth = await validateGoogleAdsConfigForCreativeGeneration(
        userIdNum,
        undefined,
        authCache
      )
      if (!userAuth.ok) {
        const isNotConfigured = !userAuth.missingFields || userAuth.missingFields.length === 0
        if (isNotConfigured) {
          return NextResponse.json(
            {
              error: '广告创意生成需要完整的 Google Ads API 配置',
              message: userAuth.message,
              errorCode: 'CREATIVE_GOOGLE_ADS_NOT_CONFIGURED',
            },
            { status: 400 }
          )
        }
        return NextResponse.json(
          {
            error: '广告创意生成需要完整的 Google Ads API 配置',
            message: userAuth.message,
            details:
              userAuth.authType === 'service_account'
                ? '请前往【设置】→【服务账号配置】页面检查服务账号配置。'
                : '请前往【设置】页面配置 Google Ads API 凭证。',
          },
          { status: 400 }
        )
      }
    } catch (error: any) {
      console.error(
        `[BatchCreativeGeneration] User-level Google Ads config check failed (userId=${userIdNum}):`,
        error?.message || error
      )
      return NextResponse.json(
        {
          error: '广告创意生成需要完整的 Google Ads API 配置',
          message: error?.message || 'Google Ads 配置校验失败',
        },
        { status: 500 }
      )
    }

    // 1) 批量读取Offer状态（只处理当前用户且未删除）
    const placeholders = offerIds.map(() => '?').join(',')
    const notDeletedCondition = '(is_deleted = false OR is_deleted IS NULL)'

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
    const offersById = new Map(offers.map((o) => [o.id, o]))

    // 2) 查询是否已有 pending/running 的创意任务
    const activeTasks = await db.query<{ offer_id: number }>(
      `SELECT DISTINCT offer_id
       FROM creative_tasks
       WHERE user_id = ? AND offer_id IN (${placeholders}) AND status IN ('pending', 'running')`,
      [userIdNum, ...offerIds]
    )
    const offersWithActiveTask = new Set(activeTasks.map((t) => t.offer_id))

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
        googleAdsConfigIncomplete: 0,
      },
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

      try {
        const authValidation = await validateGoogleAdsConfigForCreativeGeneration(
          userIdNum,
          offerId,
          authCache
        )
        if (!authValidation.ok) {
          stats.skipped++
          stats.skipReasons.googleAdsConfigIncomplete++
          continue
        }
      } catch (error: any) {
        console.error(
          `[BatchCreativeGeneration] Google Ads config check failed (offerId=${offerId}):`,
          error?.message || error
        )
        stats.skipped++
        stats.skipReasons.googleAdsConfigIncomplete++
        continue
      }

      const requestedType: NormalizedCreativeBucket | null =
        requestedBucketFromCreativeType || requestedBucket

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
            max_retries, target_rating, generation_mode, created_at, updated_at
          ) VALUES (?, ?, ?, 'pending', 'init', 0, '准备开始生成...', ?, ?, ?, ${nowFunc}, ${nowFunc})`,
          [taskId, userIdNum, offerId, batchMaxRetries, 'GOOD', generationMode]
        )

        const taskData: AdCreativeTaskData = {
          offerId,
          maxRetries: batchMaxRetries,
          targetRating: 'GOOD',
          generationMode,
          bucket: selectedBucket,
          synthetic: false,
          forceGenerateOnQualityGate,
          ...(forceGenerateOnQualityGate
            ? { qualityGateBypassReason: BATCH_QUALITY_GATE_BYPASS_REASON }
            : {}),
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
        console.error(
          `[BatchCreativeGeneration] Enqueue failed (offerId=${offerId}):`,
          error?.message || error
        )
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

    const warning = buildBatchEnqueueWarning(stats)
    const partialWarning = buildBatchPartialSkipWarning(stats)

    return NextResponse.json({
      success: true,
      generationMode,
      requestedCount: stats.requested,
      enqueuedCount: stats.enqueued,
      skippedCount: stats.skipped,
      failedCount: stats.failed,
      skipReasons: stats.skipReasons,
      taskIds,
      ...(warning ? { warning } : {}),
      ...(partialWarning ? { partialWarning } : {}),
    })
  } catch (error: any) {
    console.error('[BatchCreativeGeneration] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error', message: error?.message || '批量创建失败' },
      { status: 500 }
    )
  } finally {
    if (authCache) {
      clearCreativeGenerationAuthCache(authCache)
    }
  }
}
