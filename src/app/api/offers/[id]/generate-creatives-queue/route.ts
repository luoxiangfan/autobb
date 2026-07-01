/**
 * POST /api/offers/:id/generate-creatives-queue
 *
 * 将广告创意生成任务加入队列
 * 返回taskId供前端轮询进度
 */

import { withAuth } from '@/lib/auth'
import { findOfferById } from '@/lib/offers/server'
import { getQueueManager } from '@/lib/queue'
import { getDatabase } from '@/lib/db'
import { createError } from '@/lib/common/server'
import { validateGoogleAdsConfigForCreativeGeneration } from '@/lib/google-ads/accounts/auth/index'
import {
  clearCreativeGenerationAuthCache,
  createCreativeGenerationAuthCache,
} from '@/lib/google-ads/accounts/auth/creative-generation-auth'
import { getAvailableBuckets } from '@/lib/keywords/offer-pool'
import type { AdCreativeTaskData } from '@/lib/queue/executors/ad-creative-executor'
import {
  CREATIVE_GENERATION_MODE_INVALID_MESSAGE,
  CREATIVE_QUEUE_JSON_HEADERS,
  createQueueErrorResponse,
  normalizeCreativeTaskError,
  normalizeSingleCreativeSelection,
  resolveCreativeGenerationRuntime,
  resolveCreativeSelectionQueueError,
  resolveGoogleAdsConfigQueueError,
  toCreativeTaskErrorResponseFields,
} from '@/lib/creatives/server'
import { parsePositiveIntegerOfferId } from '@/lib/offers/server'

export const POST = withAuth(async (request, user, context) => {
  const offerId = parsePositiveIntegerOfferId(context?.params?.id)
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

  const userId = user.userId
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
    synthetic = false,
    coverage = false,
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
  const requestedBucket = normalizedSelection.requestedBucket
  const requestedBucketFromCreativeType = normalizedSelection.bucketFromCreativeType
  const normalizedCoverage = Boolean(coverage || synthetic)

  const selectionError = resolveCreativeSelectionQueueError(normalizedSelection)
  if (selectionError) {
    return createQueueErrorResponse(selectionError)
  }

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

    const googleAdsConfigError = resolveGoogleAdsConfigQueueError({
      authValidation,
      userId,
    })
    if (googleAdsConfigError) {
      return createQueueErrorResponse(googleAdsConfigError)
    }

    const availableBuckets = await getAvailableBuckets(offerId)
    const requestedType: 'A' | 'B' | 'D' | null =
      requestedBucketFromCreativeType || requestedBucket || (normalizedCoverage ? 'D' : null)

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
          headers: CREATIVE_QUEUE_JSON_HEADERS,
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
          headers: CREATIVE_QUEUE_JSON_HEADERS,
        }
      )
    }

    const db = getDatabase()
    const queue = getQueueManager()

    const taskId = crypto.randomUUID()
    await db.exec(
      `INSERT INTO creative_tasks (
        id, user_id, offer_id, status, stage, progress, message,
        max_retries, target_rating, generation_mode, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', 'init', 0, '准备开始生成...', ?, ?, ?, NOW(), NOW())`,
      [taskId, userId, offerId, normalizedMaxRetries, normalizedTargetRating, generationMode]
    )

    const taskData: AdCreativeTaskData = {
      offerId: offerId,
      maxRetries: normalizedMaxRetries,
      targetRating: normalizedTargetRating,
      generationMode,
      coverage: normalizedCoverage,
      synthetic: normalizedCoverage,
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
      maxRetries: 0,
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
        headers: CREATIVE_QUEUE_JSON_HEADERS,
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
})
