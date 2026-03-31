export type CreativeTaskErrorCategory =
  | 'validation'
  | 'data'
  | 'config'
  | 'upstream'
  | 'network'
  | 'auth'
  | 'system'

export interface CreativeTaskErrorPayload {
  code: string
  category: CreativeTaskErrorCategory
  message: string
  userMessage: string
  retryable: boolean
  details?: Record<string, unknown> | null
}

const DEFAULT_ERROR_CODE = 'CREATIVE_TASK_UNKNOWN'
const DEFAULT_ERROR_CATEGORY: CreativeTaskErrorCategory = 'system'
const DEFAULT_ERROR_MESSAGE = '任务失败'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    return trimmed
  }
  return null
}

function pickBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === 'boolean') return value
  }
  return null
}

function normalizeCategory(value: unknown): CreativeTaskErrorCategory | null {
  const normalized = String(value || '').trim().toLowerCase()
  if (
    normalized === 'validation'
    || normalized === 'data'
    || normalized === 'config'
    || normalized === 'upstream'
    || normalized === 'network'
    || normalized === 'auth'
    || normalized === 'system'
  ) {
    return normalized
  }
  return null
}

function isNetworkLikeMessage(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('network')
    || lower.includes('failed to fetch')
    || lower.includes('fetch failed')
    || lower.includes('timeout')
    || lower.includes('econn')
    || lower.includes('etimedout')
    || lower.includes('sse timeout')
    || lower.includes('网络连接')
    || lower.includes('连接超时')
  )
}

function inferFromMessage(message: string): Omit<CreativeTaskErrorPayload, 'details'> {
  if (message.includes('关键词AI语义分类失败') && message.includes('status code 400')) {
    return {
      code: 'CREATIVE_KEYWORD_CLUSTERING_UPSTREAM_400',
      category: 'upstream',
      message,
      userMessage: '关键词语义分类服务返回 400，可能是 AI 中转服务模型路由不兼容。请切换 Gemini 模型或检查中转配置后重试。',
      retryable: true,
    }
  }

  if (message.includes('关键词池创建失败')) {
    return {
      code: 'CREATIVE_KEYWORD_POOL_BUILD_FAILED',
      category: 'upstream',
      message,
      userMessage: '关键词池创建失败，建议稍后重试；若持续失败，请检查 AI 服务商与模型配置。',
      retryable: true,
    }
  }

  if (message.includes('无可用关键词') || message.includes('请先生成关键词')) {
    return {
      code: 'CREATIVE_KEYWORD_POOL_EMPTY',
      category: 'data',
      message,
      userMessage: '当前 Offer 缺少可用关键词，建议先回到 Offer 详情页检查并补全抓取数据。',
      retryable: false,
    }
  }

  if (message.includes('Offer信息抓取失败') || message.includes('网站数据抓取失败')) {
    return {
      code: 'CREATIVE_OFFER_SCRAPE_FAILED',
      category: 'data',
      message,
      userMessage: '网站数据抓取失败，无法生成创意。请先修复抓取后再重试。',
      retryable: false,
    }
  }

  if (
    message.includes('Google Ads API 配置')
    || message.includes('Developer Token')
    || message.includes('Refresh Token')
    || message.includes('Customer ID')
    || message.includes('MCC Customer ID')
  ) {
    return {
      code: 'GOOGLE_ADS_CONFIG_INCOMPLETE',
      category: 'config',
      message,
      userMessage: 'Google Ads API 配置不完整，请先在设置页补齐后再重试。',
      retryable: false,
    }
  }

  if (message.includes('Task not found') || message.includes('任务不存在') || message.includes('已过期')) {
    return {
      code: 'CREATIVE_TASK_NOT_FOUND',
      category: 'validation',
      message,
      userMessage: '任务不存在或已过期',
      retryable: false,
    }
  }

  if (message.includes('未授权') || message.includes('Unauthorized') || message.includes('登录已过期')) {
    return {
      code: 'AUTH_REQUIRED',
      category: 'auth',
      message,
      userMessage: '登录状态已失效，请重新登录后再试。',
      retryable: false,
    }
  }

  if (message.includes('SSE timeout')) {
    return {
      code: 'CREATIVE_TASK_STREAM_TIMEOUT',
      category: 'network',
      message,
      userMessage: '实时连接超时，任务可能仍在后台运行。请刷新查看最新状态。',
      retryable: true,
    }
  }

  if (isNetworkLikeMessage(message)) {
    return {
      code: 'CREATIVE_TASK_NETWORK_ERROR',
      category: 'network',
      message,
      userMessage: '网络连接异常，请检查网络后重试。',
      retryable: true,
    }
  }

  if (message.includes('已生成全部3种创意类型') || message.includes('创意配额')) {
    return {
      code: 'CREATIVE_QUOTA_REACHED',
      category: 'validation',
      message,
      userMessage: '该 Offer 已达到创意类型上限，请删除一个类型后再生成。',
      retryable: false,
    }
  }

  return {
    code: DEFAULT_ERROR_CODE,
    category: DEFAULT_ERROR_CATEGORY,
    message,
    userMessage: message || DEFAULT_ERROR_MESSAGE,
    retryable: false,
  }
}

export function normalizeCreativeTaskError(
  raw: unknown,
  fallbackMessage: string = DEFAULT_ERROR_MESSAGE
): CreativeTaskErrorPayload {
  if (raw instanceof Error) {
    const inferred = inferFromMessage(raw.message || fallbackMessage)
    const errorLike = raw as Error & { code?: unknown; category?: unknown; userMessage?: unknown; retryable?: unknown; details?: unknown }
    return {
      code: pickString(errorLike.code, inferred.code) || inferred.code,
      category: normalizeCategory(errorLike.category) || inferred.category,
      message: pickString(raw.message, inferred.message, fallbackMessage) || fallbackMessage,
      userMessage: pickString(errorLike.userMessage, inferred.userMessage, raw.message, fallbackMessage) || fallbackMessage,
      retryable: pickBoolean(errorLike.retryable, inferred.retryable) ?? inferred.retryable,
      details: asRecord(errorLike.details),
    }
  }

  const rawString = typeof raw === 'string' ? raw.trim() : null
  const rawObject = asRecord(raw)
  const nestedError = asRecord(rawObject?.error)
  const structuredError = asRecord(rawObject?.structuredError)
  const candidate = structuredError || nestedError || rawObject

  const inferred = inferFromMessage(
    pickString(
      candidate?.message,
      rawObject?.message,
      rawObject?.error,
      rawObject?.userMessage,
      rawString,
      fallbackMessage
    ) || fallbackMessage
  )

  const details = asRecord(candidate?.details)
    || asRecord(rawObject?.errorDetails)
    || asRecord(rawObject?.details)
    || null

  return {
    code: pickString(rawObject?.errorCode, candidate?.code, inferred.code) || inferred.code || DEFAULT_ERROR_CODE,
    category: normalizeCategory(rawObject?.errorCategory) || normalizeCategory(candidate?.category) || inferred.category || DEFAULT_ERROR_CATEGORY,
    message: pickString(candidate?.message, rawObject?.message, rawObject?.error, rawString, inferred.message, fallbackMessage) || fallbackMessage,
    userMessage: pickString(
      rawObject?.errorUserMessage,
      candidate?.userMessage,
      rawObject?.userMessage,
      rawString,
      inferred.userMessage,
      candidate?.message,
      rawObject?.message,
      fallbackMessage
    ) || fallbackMessage,
    retryable: pickBoolean(rawObject?.errorRetryable, candidate?.retryable, inferred.retryable) ?? inferred.retryable,
    details,
  }
}

export function toCreativeTaskErrorResponseFields(error: CreativeTaskErrorPayload): Record<string, unknown> {
  return {
    errorCode: error.code,
    errorCategory: error.category,
    errorUserMessage: error.userMessage,
    errorRetryable: error.retryable,
    structuredError: error,
  }
}
