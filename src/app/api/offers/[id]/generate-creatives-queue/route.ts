/**
 * POST /api/offers/:id/generate-creatives-queue
 *
 * 将广告创意生成任务加入队列
 * 返回taskId供前端轮询进度
 */

import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { findOfferById } from '@/lib/offers'
import { getQueueManager } from '@/lib/queue'
import { getDatabase } from '@/lib/db'
import { createError } from '@/lib/errors'
import { validateGoogleAdsConfigForCreativeGeneration } from '@/lib/google-ads/accounts/auth/index'
import {
  clearCreativeGenerationAuthCache,
  createCreativeGenerationAuthCache,
} from '@/lib/google-ads/accounts/auth/creative-generation-auth'
import { getAvailableBuckets } from '@/lib/offer-keyword-pool'
import type { AdCreativeTaskData } from '@/lib/queue/executors/ad-creative-executor'
import {
  CREATIVE_GENERATION_MODE_INVALID_MESSAGE,
  resolveCreativeGenerationRuntime,
} from '@/lib/ad-creative-generation-mode'
import { deriveCanonicalCreativeType } from '@/lib/creative-type'
import { extractModelAnchorTextsFromScrapedData } from '@/lib/model-anchor-evidence'
import { normalizeSingleCreativeSelection } from '@/lib/creative-request-normalizer'
import {
  normalizeCreativeTaskError,
  toCreativeTaskErrorResponseFields,
  type CreativeTaskErrorCategory,
} from '@/lib/creative-task-error'
import { parsePositiveIntegerOfferId } from '@/lib/parse-offer-id'

type QueueErrorResponseInput = {
  status: number
  error: string
  message?: string
  details?: unknown
  errorCode?: string
  errorCategory?: CreativeTaskErrorCategory
  retryable?: boolean
  userMessage?: string
  extra?: Record<string, unknown>
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

function toStructuredDetails(details: unknown): Record<string, unknown> | null {
  if (!details) return null
  if (typeof details === 'object' && !Array.isArray(details)) {
    return details as Record<string, unknown>
  }
  if (Array.isArray(details)) {
    return { items: details }
  }
  if (typeof details === 'string') {
    return { message: details }
  }
  return null
}

function createQueueErrorResponse(input: QueueErrorResponseInput): Response {
  const normalizedError = normalizeCreativeTaskError(
    {
      code: input.errorCode,
      category: input.errorCategory,
      message: input.message || input.error,
      userMessage: input.userMessage || input.message || input.error,
      retryable: input.retryable ?? false,
      details: toStructuredDetails(input.details),
    },
    input.message || input.error
  )

  return new Response(
    JSON.stringify({
      error: input.error,
      message: normalizedError.userMessage,
      details: input.details ?? null,
      ...toCreativeTaskErrorResponseFields(normalizedError),
      ...(input.extra || {}),
    }),
    {
      status: input.status,
      headers: JSON_HEADERS,
    }
  )
}

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const offerId = parsePositiveIntegerOfferId(params.id)
  if (!offerId) {
    return createQueueErrorResponse({
      status: 400,
      error: 'Invalid offer ID',
      message: 'Invalid offer ID',
      errorCode: 'INVALID_OFFER_ID',
      errorCategory: 'validation',
      retryable: false,
    })
  }

  // 验证用户身份
  const authResult = await verifyAuth(request)
  if (!authResult.authenticated || !authResult.user) {
    return NextResponse.json({ error: authResult.error || '未授权' }, { status: 401 })
  }
  const userId = authResult.user.userId
  const parentRequestId = request.headers.get('x-request-id') || undefined
  if (!userId) {
    return createQueueErrorResponse({
      status: 401,
      error: '未授权',
      message: '未授权',
      errorCode: 'AUTH_REQUIRED',
      errorCategory: 'auth',
      retryable: false,
      userMessage: '登录状态已失效，请重新登录后再试。',
    })
  }

  const body = await request.json()
  const {
    synthetic = false, // 🔧 向后兼容：旧版“综合创意”标记（KISS-3类型方案中不再生成S桶）
    coverage = false, // ✅ 新命名：coverage 模式，本质仍映射到 D / product_intent
    bucket,
    creativeType,
    forceGenerate,
    force_generate,
    forceGenerateReason,
    force_generate_reason,
  } = body
  const { runtime, invalidMode } = resolveCreativeGenerationRuntime(body)
  if (invalidMode) {
    return createQueueErrorResponse({
      status: 400,
      error: 'Invalid generationMode',
      message: CREATIVE_GENERATION_MODE_INVALID_MESSAGE,
      errorCode: 'CREATIVE_GENERATION_MODE_INVALID',
      errorCategory: 'validation',
      retryable: false,
    })
  }
  const { mode: generationMode, maxRetries: normalizedMaxRetries } = runtime
  const normalizedTargetRating: AdCreativeTaskData['targetRating'] = 'GOOD'
  const forceGenerateOnQualityGate = forceGenerate === true || force_generate === true
  const normalizedForceGenerateReason = forceGenerateOnQualityGate
    ? String(forceGenerateReason || force_generate_reason || '')
        .trim()
        .slice(0, 240)
    : ''
  const hasExplicitCreativeType =
    creativeType !== undefined && creativeType !== null && String(creativeType).trim() !== ''
  const normalizedSelection = normalizeSingleCreativeSelection({
    creativeType,
    bucket,
    hasExplicitCreativeType,
    hasExplicitBucket: bucket !== undefined,
  })
  const bucketSelection = normalizedSelection.bucketSelection
  const requestedBucket = normalizedSelection.requestedBucket
  const requestedBucketFromCreativeType = normalizedSelection.bucketFromCreativeType
  const normalizedCoverage = Boolean(coverage || synthetic)

  if (normalizedSelection.errorCode === 'invalid-creative-type') {
    return createQueueErrorResponse({
      status: 400,
      error: 'Invalid creativeType',
      message:
        'creativeType 仅支持 brand_intent / model_intent / product_intent（兼容旧值：brand_focus / model_focus / brand_product）',
      errorCode: 'CREATIVE_TYPE_INVALID',
      errorCategory: 'validation',
      retryable: false,
    })
  }

  if (normalizedSelection.errorCode === 'invalid-bucket') {
    return createQueueErrorResponse({
      status: 400,
      error: 'Invalid bucket',
      message: 'bucket 仅支持 A / B / D（兼容旧值：C→B，S→D）',
      errorCode: 'CREATIVE_BUCKET_INVALID',
      errorCategory: 'validation',
      retryable: false,
    })
  }

  if (normalizedSelection.errorCode === 'creative-type-bucket-conflict') {
    return createQueueErrorResponse({
      status: 400,
      error: 'creativeType-bucket-conflict',
      message: 'creativeType 与 bucket 不一致，请传入同一创意类型对应的槽位',
      errorCode: 'CREATIVE_TYPE_BUCKET_CONFLICT',
      errorCategory: 'validation',
      retryable: false,
    })
  }

  // 验证Offer存在
  const offer = await findOfferById(offerId, userId)
  if (!offer) {
    return createQueueErrorResponse({
      status: 404,
      error: 'Offer不存在或无权访问',
      message: 'Offer不存在或无权访问',
      errorCode: 'OFFER_NOT_FOUND',
      errorCategory: 'validation',
      retryable: false,
    })
  }

  if (offer.scrape_status === 'failed') {
    return createQueueErrorResponse({
      status: 400,
      error: 'Offer信息抓取失败，请重新抓取',
      message: 'Offer信息抓取失败，请重新抓取',
      errorCode: 'CREATIVE_OFFER_SCRAPE_FAILED',
      errorCategory: 'data',
      retryable: false,
    })
  }

  // 2. 验证 Google Ads API 配置并入队（Offer linked SA + prepare/heal）
  const authCache = createCreativeGenerationAuthCache()
  try {
    let authValidation
    try {
      authValidation = await validateGoogleAdsConfigForCreativeGeneration(
        userId,
        offer.id,
        authCache
      )
    } catch (error: any) {
      console.error('[CreativeGeneration] Failed to check Google Ads config:', error)
      return createQueueErrorResponse({
        status: 400,
        error: '广告创意生成需要完整的 Google Ads API 配置',
        message: error?.message || 'Google Ads 配置校验失败',
        errorCode: 'GOOGLE_ADS_CONFIG_CHECK_FAILED',
        errorCategory: 'config',
        retryable: false,
      })
    }
    if (!authValidation.ok) {
      const isNotConfigured =
        !authValidation.missingFields || authValidation.missingFields.length === 0
      if (isNotConfigured) {
        console.warn(`[CreativeGeneration] User ${userId} has no configured Google Ads auth`)
        return createQueueErrorResponse({
          status: 400,
          error: '广告创意生成需要完整的 Google Ads API 配置',
          message: authValidation.message,
          errorCode: 'CREATIVE_GOOGLE_ADS_NOT_CONFIGURED',
          errorCategory: 'config',
          retryable: false,
        })
      }

      console.warn(
        `[CreativeGeneration] User ${userId} has incomplete Google Ads config (authType: ${authValidation.authType})`
      )
      const details =
        authValidation.authType === 'service_account'
          ? '请前往【设置】→【服务账号配置】页面检查服务账号配置，确保 Developer Token 和 MCC Customer ID 已正确配置。'
          : '请前往【设置】页面配置 Google Ads API 凭证（Developer Token、Refresh Token、Customer ID）以启用关键词搜索量查询功能。'
      return createQueueErrorResponse({
        status: 400,
        error: authValidation.message,
        message: authValidation.message,
        details,
        errorCode: 'GOOGLE_ADS_CONFIG_INCOMPLETE',
        errorCategory: 'config',
        retryable: false,
        extra: {
          missingFields: authValidation.missingFields,
          authType: authValidation.authType,
        },
      })
    }

    const availableBuckets = await getAvailableBuckets(offerId)
    let requestedType: 'A' | 'B' | 'D' | null =
      requestedBucketFromCreativeType || requestedBucket || (normalizedCoverage ? 'D' : null)
    if (
      !requestedBucketFromCreativeType &&
      bucketSelection.legacyModelHint &&
      normalizedSelection.bucketSelection.normalizedBucket === 'B'
    ) {
      const offerAny = offer as any
      const scrapedModelTexts = extractModelAnchorTextsFromScrapedData(offerAny.scraped_data)
      const normalizedLegacyType = deriveCanonicalCreativeType({
        keywordBucket: bucketSelection.rawBucket,
        keywords: [offerAny.product_name, offerAny.extracted_keywords, ...scrapedModelTexts],
        headlines: [offerAny.extracted_headlines],
        descriptions: [
          offerAny.brand_description,
          offerAny.unique_selling_points,
          offerAny.product_highlights,
          offerAny.extracted_descriptions,
        ],
        theme: [offerAny.offer_name, offerAny.category],
      })

      if (normalizedLegacyType !== 'model_intent') {
        console.warn(
          `[CreativeGeneration] Offer ${offerId}: legacy bucket ${bucketSelection.rawBucket} fallback to D/product_intent because no verifiable model anchor evidence was found`
        )
      }
      requestedType = normalizedLegacyType === 'model_intent' ? 'B' : 'D'
    }

    const usedTypeCount = 3 - availableBuckets.length

    if (requestedType && !availableBuckets.includes(requestedType)) {
      const error = createError.creativeQuotaExceeded({
        round: 1,
        current: usedTypeCount,
        limit: 3,
      })
      const message = `该Offer已生成桶${requestedType}类型创意。为保持仅3个类型创意，请先删除该类型后再生成。`
      const structuredError = normalizeCreativeTaskError(
        {
          code: error.code,
          category: 'validation',
          message,
          userMessage: message,
          retryable: false,
        },
        message
      )
      return new Response(
        JSON.stringify({
          ...error.toJSON(),
          message,
          ...toCreativeTaskErrorResponseFields(structuredError),
        }),
        {
          status: error.httpStatus,
          headers: JSON_HEADERS,
        }
      )
    }

    if (availableBuckets.length === 0) {
      const error = createError.creativeQuotaExceeded({
        round: 1,
        current: usedTypeCount,
        limit: 3,
      })
      const errorJson = error.toJSON()
      const quotaMessage =
        errorJson?.error?.message || '该Offer已生成全部3种创意类型（A/B/D），无需继续生成。'
      const structuredError = normalizeCreativeTaskError(
        {
          code: error.code,
          category: 'validation',
          message: quotaMessage,
          userMessage: quotaMessage,
          retryable: false,
          details: errorJson?.error?.details || null,
        },
        quotaMessage
      )
      return new Response(
        JSON.stringify({
          ...errorJson,
          ...toCreativeTaskErrorResponseFields(structuredError),
        }),
        {
          status: error.httpStatus,
          headers: JSON_HEADERS,
        }
      )
    }

    const db = getDatabase()
    const queue = getQueueManager()

    // 创建creative_tasks记录
    const taskId = crypto.randomUUID()
    await db.exec(
      `INSERT INTO creative_tasks (
        id, user_id, offer_id, status, stage, progress, message,
        max_retries, target_rating, generation_mode, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', 'init', 0, '准备开始生成...', ?, ?, ?, NOW(), NOW())`,
      [taskId, userId, offerId, normalizedMaxRetries, normalizedTargetRating, generationMode]
    )

    // 将任务加入队列
    const taskData: AdCreativeTaskData = {
      offerId: offerId,
      maxRetries: normalizedMaxRetries,
      targetRating: normalizedTargetRating,
      generationMode,
      coverage: normalizedCoverage,
      synthetic: normalizedCoverage, // 双写旧字段，确保旧执行器/半部署状态仍映射为 D
      bucket: requestedType || undefined,
      ...(forceGenerateOnQualityGate
        ? {
            forceGenerateOnQualityGate: true,
            qualityGateBypassReason:
              normalizedForceGenerateReason || 'user_confirmed_from_quality_gate_modal',
          }
        : {}),
    }

    await queue.enqueue('ad-creative', taskData, userId, {
      parentRequestId,
      priority: 'high',
      taskId,
      maxRetries: 0, // 禁用队列重试，由执行器内部控制多轮生成
    })

    console.log(`🚀 创意生成任务已入队: ${taskId}`)

    return new Response(
      JSON.stringify({
        taskId,
        bucket: requestedType || undefined,
        generationMode,
      }),
      {
        status: 200,
        headers: JSON_HEADERS,
      }
    )
  } catch (error: any) {
    console.error('创意生成任务入队失败:', error)
    return createQueueErrorResponse({
      status: 500,
      error: error?.message || '创意生成任务入队失败',
      message: error?.message || '创意生成任务入队失败',
      errorCode: 'CREATIVE_TASK_ENQUEUE_FAILED',
      errorCategory: 'system',
      retryable: true,
    })
  } finally {
    clearCreativeGenerationAuthCache(authCache)
  }
}
