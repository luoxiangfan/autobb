/**
 * 前端错误处理工具
 *
 * 功能：
 * - 解析后端返回的错误响应（基于errors.ts错误码系统）
 * - 提供用户友好的错误消息
 * - 支持中英文
 * - 提供错误重试建议
 */

export interface ErrorResponse {
  error: {
    code: string
    message: string
    details?: any
    timestamp: string
  }
}

export interface ParsedError {
  code: string
  message: string
  userMessage: string
  details?: any
  timestamp: string
  canRetry: boolean
  retryDelay?: number
  suggestedAction?: string
}

/**
 * 解析API错误响应
 *
 * @param response Fetch Response对象
 * @returns ParsedError对象，如果不是错误响应则返回null
 */
export async function parseErrorResponse(
  response: Response
): Promise<ParsedError | null> {
  if (response.ok) {
    return null
  }

  try {
    const data = await response.json()

    // 检查是否是新的错误码格式
    if (data.error && data.error.code) {
      return parseStructuredError(data as ErrorResponse)
    }

    // 向后兼容：旧的错误格式
    return parseLegacyError(data, response.status)
  } catch (error) {
    // JSON解析失败，返回通用错误
    return {
      code: 'UNKNOWN_ERROR',
      message: `HTTP ${response.status}: ${response.statusText}`,
      userMessage: getUserFriendlyMessage('UNKNOWN_ERROR'),
      timestamp: new Date().toISOString(),
      canRetry: response.status >= 500,
      suggestedAction: response.status >= 500 ? '服务器错误，请稍后重试' : '请检查输入数据'
    }
  }
}

/**
 * 解析结构化错误响应（新格式）
 */
function parseStructuredError(errorResponse: ErrorResponse): ParsedError {
  const { code, message, details, timestamp } = errorResponse.error

  return {
    code,
    message,
    userMessage: getUserFriendlyMessage(code, details),
    details,
    timestamp,
    canRetry: shouldRetry(code),
    retryDelay: getRetryDelay(code),
    suggestedAction: getSuggestedAction(code, details)
  }
}

/**
 * 解析旧格式错误响应（向后兼容）
 */
function parseLegacyError(data: any, status: number): ParsedError {
  const message = data.error || data.message || '未知错误'

  return {
    code: `LEGACY_${status}`,
    message,
    userMessage: message,
    details: data.details,
    timestamp: new Date().toISOString(),
    canRetry: status >= 500,
    suggestedAction: data.suggestion
  }
}

/**
 * 获取用户友好的错误消息
 *
 * 根据错误码返回更友好的中文提示
 */
function getUserFriendlyMessage(code: string, details?: any): string {
  const messages: Record<string, string> = {
    // 认证错误 (1xxx)
    'AUTH_1001': '请先登录后再进行操作',
    'AUTH_1002': '登录已过期，请重新登录',
    'AUTH_1003': '登录凭证无效，请重新登录',

    // 权限错误 (2xxx)
    'PERM_2001': '您没有权限执行此操作',
    'PERM_2002': '您没有权限访问此资源',

    // Offer错误 (3xxx)
    'OFFER_3001': '找不到该Offer，可能已被删除或您无权访问',
    'OFFER_3002': '请先完成Offer数据抓取后再进行此操作',
    'OFFER_3003': 'Offer创建失败，请检查输入数据后重试',
    'OFFER_3004': 'Offer更新失败，请稍后重试',

    // Google Ads错误 (4xxx)
    'GADS_4001': 'Google Ads操作失败，请检查账号授权',
    'GADS_4002': '请求过于频繁，请稍后再试',
    'GADS_4003': 'Google Ads账号未激活或不存在',
    'GADS_4004': 'Google Ads授权已过期，请重新授权',

    // 创意错误 (5xxx)
    'CREA_5001': '找不到该广告创意',
    'CREA_5002': 'AI广告创意生成失败，请检查AI配置或稍后重试',
    'CREA_5003': details?.round
      ? `第${details.round}轮已生成${details.current}个创意，已达到上限（${details.limit}个）`
      : '广告创意生成次数已达上限',
    'CREA_5004': 'AI配置未设置，请前往设置页面配置Gemini API',

    // 广告系列错误 (6xxx)
    'CAMP_6001': '找不到该广告系列',
    'CAMP_6002': '广告系列创建失败，请检查配置后重试',
    'CAMP_6003': '广告系列更新失败，请稍后重试',

    // 同步错误 (7xxx)
    'SYNC_7001': '数据同步失败，请稍后重试',
    'SYNC_7002': '同步配置错误，请检查设置',

    // 系统错误 (8xxx)
    'SYS_8001': '系统内部错误，请稍后重试',
    'SYS_8002': '数据库操作失败，请稍后重试',
    'SYS_8003': '外部服务暂时不可用，请稍后重试',

    // 验证错误 (9xxx)
    'VAL_9001': details?.fields
      ? `缺少必填字段：${details.fields.join(', ')}`
      : '缺少必填字段',
    'VAL_9002': details?.field
      ? `参数 ${details.field} 无效`
      : '参数验证失败',
    'VAL_9003': '数据格式错误，请检查输入',

    // URL解析错误 (10xxx)
    'URL_10001': '推广链接解析失败，请检查链接是否有效',
    'URL_10002': '代理服务不可用，请检查代理配置',

    // 代理错误 (11xxx)
    'PROXY_11001': '未配置代理，请先在设置页面配置代理URL',
    'PROXY_11002': '所有代理都不可用，请检查代理配置',

    // 默认
    'UNKNOWN_ERROR': '操作失败，请稍后重试'
  }

  return messages[code] || messages['UNKNOWN_ERROR']
}

/**
 * 判断错误是否可重试
 */
function shouldRetry(code: string): boolean {
  // 系统错误、同步错误、外部服务错误可重试
  const retryablePrefixes = ['SYS_', 'SYNC_', 'GADS_4002', 'URL_10002', 'PROXY_11002']

  return retryablePrefixes.some(prefix => code.startsWith(prefix) || code === prefix)
}

/**
 * 获取重试延迟（毫秒）
 */
function getRetryDelay(code: string): number | undefined {
  if (!shouldRetry(code)) {
    return undefined
  }

  // 速率限制错误延迟更长
  if (code === 'GADS_4002') {
    return 30000 // 30秒
  }

  // 其他可重试错误默认3秒
  return 3000
}

/**
 * 获取建议操作
 */
function getSuggestedAction(code: string, details?: any): string | undefined {
  const actions: Record<string, string> = {
    'AUTH_1001': '请点击登录按钮重新登录',
    'AUTH_1002': '请刷新页面重新登录',
    'CREA_5004': '请前往设置页面配置AI引擎',
    'GADS_4003': '请前往Google Ads设置页面添加或激活账号',
    'GADS_4004': '请重新授权Google Ads账号',
    'GADS_4002': '请等待30秒后重试',
    'PROXY_11001': '请前往设置页面配置代理URL',
    'VAL_9001': '请检查并填写所有必填字段',
    'VAL_9002': '请修正输入数据后重试'
  }

  // 检查details中是否有redirect或suggestion
  if (details?.redirect) {
    return `请前往 ${details.redirect} 页面`
  }

  if (details?.suggestion) {
    return details.suggestion
  }

  return actions[code]
}

/**
 * 快捷函数：从Fetch Response直接获取用户消息
 *
 * @param response Fetch Response对象
 * @returns 用户友好的错误消息，如果成功则返回null
 */
export async function getErrorMessage(
  response: Response
): Promise<string | null> {
  const parsedError = await parseErrorResponse(response)

  if (!parsedError) {
    return null
  }

  return parsedError.userMessage
}

/**
 * 错误重试辅助函数
 *
 * @param fn 要执行的异步函数
 * @param maxRetries 最大重试次数
 * @returns 执行结果
 */
export async function withAutoRetry<T>(
  fn: () => Promise<Response>,
  maxRetries: number = 3
): Promise<Response> {
  let lastError: ParsedError | null = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fn()
    const parsedError = await parseErrorResponse(response)

    if (!parsedError) {
      // 成功，直接返回
      return response
    }

    lastError = parsedError

    if (!parsedError.canRetry) {
      // 不可重试错误，直接返回
      return response
    }

    if (attempt < maxRetries - 1) {
      // 等待后重试
      const delay = parsedError.retryDelay || 3000
      console.log(
        `尝试 ${attempt + 1}/${maxRetries} 失败 (${parsedError.code}), ${delay}ms 后重试...`
      )
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  // 所有重试都失败，返回最后一次响应
  throw new Error(lastError?.userMessage || '请求失败')
}

/**
 * 显示错误通知（需要配合UI库使用）
 *
 * @param error ParsedError对象
 * @param toast Toast通知函数（例如react-hot-toast）
 */
export function showErrorNotification(
  error: ParsedError,
  toast?: (message: string, options?: any) => void
) {
  if (!toast) {
    console.error('Error:', error)
    return
  }

  const message = error.userMessage

  const options: any = {
    duration: error.canRetry ? 5000 : 4000,
    style: {
      background: '#EF4444',
      color: '#fff'
    }
  }

  // 添加重试建议
  if (error.suggestedAction) {
    toast(`${message}\n${error.suggestedAction}`, options)
  } else {
    toast(message, options)
  }
}
