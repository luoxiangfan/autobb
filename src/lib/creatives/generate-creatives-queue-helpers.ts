import {
  normalizeCreativeTaskError,
  toCreativeTaskErrorResponseFields,
  type CreativeTaskErrorCategory,
} from './creative-task-error'
import type {
  CreativeSelectionErrorCode,
  NormalizeSingleCreativeSelectionResult,
} from './creative-request-normalizer'
import type { CreativeGenerationGoogleAdsValidationResult } from '@/lib/google-ads/accounts/auth/types'

export type QueueErrorResponseInput = {
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

export type CreativeSelectionErrorPayload = {
  error: string
  message: string
  errorCode: string
  errorCategory: 'validation'
  retryable: false
}

const CREATIVE_SELECTION_ERROR_PAYLOADS: Record<
  CreativeSelectionErrorCode,
  CreativeSelectionErrorPayload
> = {
  'invalid-creative-type': {
    error: 'Invalid creativeType',
    message:
      'creativeType 仅支持 brand_intent / model_intent / product_intent（兼容旧值：brand_focus / model_focus / brand_product）',
    errorCode: 'CREATIVE_TYPE_INVALID',
    errorCategory: 'validation',
    retryable: false,
  },
  'invalid-bucket': {
    error: 'Invalid bucket',
    message: 'bucket 仅支持 A / B / D',
    errorCode: 'CREATIVE_BUCKET_INVALID',
    errorCategory: 'validation',
    retryable: false,
  },
  'creative-type-bucket-conflict': {
    error: 'creativeType-bucket-conflict',
    message: 'creativeType 与 bucket 不一致，请传入同一创意类型对应的槽位',
    errorCode: 'CREATIVE_TYPE_BUCKET_CONFLICT',
    errorCategory: 'validation',
    retryable: false,
  },
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

export function resolveCreativeSelectionQueueError(
  selection: Pick<NormalizeSingleCreativeSelectionResult, 'errorCode'>
): QueueErrorResponseInput | null {
  if (!selection.errorCode) return null
  return {
    status: 400,
    ...CREATIVE_SELECTION_ERROR_PAYLOADS[selection.errorCode],
  }
}

export function resolveCreativeSelectionJsonError(
  selection: Pick<NormalizeSingleCreativeSelectionResult, 'errorCode'>
): { status: number; body: CreativeSelectionErrorPayload } | null {
  if (!selection.errorCode) return null
  return {
    status: 400,
    body: CREATIVE_SELECTION_ERROR_PAYLOADS[selection.errorCode],
  }
}

export function createQueueErrorResponse(input: QueueErrorResponseInput): Response {
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

export function resolveGoogleAdsConfigQueueError(params: {
  authValidation: CreativeGenerationGoogleAdsValidationResult
  userId: number
}): QueueErrorResponseInput | null {
  const { authValidation, userId } = params
  if (authValidation.ok) return null

  const isNotConfigured = !authValidation.missingFields || authValidation.missingFields.length === 0
  if (isNotConfigured) {
    console.warn(`[CreativeGeneration] User ${userId} has no configured Google Ads auth`)
    return {
      status: 400,
      error: '广告创意生成需要完整的 Google Ads API 配置',
      message: authValidation.message,
      errorCode: 'CREATIVE_GOOGLE_ADS_NOT_CONFIGURED',
      errorCategory: 'config',
      retryable: false,
    }
  }

  console.warn(
    `[CreativeGeneration] User ${userId} has incomplete Google Ads config (authType: ${authValidation.authType})`
  )
  const details =
    authValidation.authType === 'service_account'
      ? '请前往【设置】→【服务账号配置】页面检查服务账号配置，确保 Developer Token 和 MCC Customer ID 已正确配置。'
      : '请前往【设置】页面配置 Google Ads API 凭证（Developer Token、Refresh Token、Customer ID）以启用关键词搜索量查询功能。'
  return {
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
  }
}

export function resolveGoogleAdsConfigJsonError(params: {
  authValidation: CreativeGenerationGoogleAdsValidationResult
}): { status: number; body: Record<string, unknown> } | null {
  const { authValidation } = params
  if (authValidation.ok) return null

  const isNotConfigured = !authValidation.missingFields || authValidation.missingFields.length === 0
  if (isNotConfigured) {
    return {
      status: 400,
      body: {
        error: '广告创意生成需要完整的 Google Ads API 配置',
        message: authValidation.message,
        errorCode: 'CREATIVE_GOOGLE_ADS_NOT_CONFIGURED',
      },
    }
  }

  return {
    status: 400,
    body: {
      error: '广告创意生成需要完整的 Google Ads API 配置',
      message: authValidation.message,
      details:
        authValidation.authType === 'service_account'
          ? '请前往【设置】→【服务账号配置】页面检查服务账号配置。'
          : '请前往【设置】页面配置 Google Ads API 凭证。',
    },
  }
}

export { JSON_HEADERS as CREATIVE_QUEUE_JSON_HEADERS }
