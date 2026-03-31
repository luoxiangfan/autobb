/**
 * 统一的API错误处理工具
 *
 * 用于处理前端API请求中的各种错误情况，特别是服务重启期间的非JSON响应
 */

export interface ApiErrorResult {
  success: false
  error: string
  userMessage: string
}

export interface ApiSuccessResult<T> {
  success: true
  data: T
}

export type ApiResult<T> = ApiSuccessResult<T> | ApiErrorResult

/**
 * 安全地解析JSON响应
 * 处理服务重启期间负载均衡器返回的非JSON响应（如 "no healthy upstream"）
 */
export async function safeJsonParse<T = any>(response: Response): Promise<ApiResult<T>> {
  try {
    // 首先检查响应状态
    if (!response.ok) {
      // 尝试读取响应文本
      const text = await response.text()

      // 检查是否是负载均衡器的错误响应
      if (text.includes('no healthy upstream') || text.includes('502 Bad Gateway') || text.includes('503 Service')) {
        return {
          success: false,
          error: 'SERVICE_UNAVAILABLE',
          userMessage: '服务正在重启中，请稍后重试'
        }
      }

      // 尝试解析为JSON错误
      try {
        const errorData = JSON.parse(text)
        return {
          success: false,
          error: errorData.error || 'API_ERROR',
          userMessage: errorData.message || `请求失败 (${response.status})`
        }
      } catch {
        // 无法解析为JSON，返回原始文本
        return {
          success: false,
          error: 'UNKNOWN_ERROR',
          userMessage: `服务异常 (${response.status})`
        }
      }
    }

    // 响应成功，解析JSON
    const text = await response.text()

    // 空响应处理
    if (!text || text.trim() === '') {
      return {
        success: false,
        error: 'EMPTY_RESPONSE',
        userMessage: '服务返回空响应'
      }
    }

    try {
      const data = JSON.parse(text)
      return {
        success: true,
        data
      }
    } catch (parseError) {
      // JSON解析失败，可能是HTML错误页面
      if (text.includes('<html') || text.includes('<!DOCTYPE')) {
        return {
          success: false,
          error: 'HTML_RESPONSE',
          userMessage: '服务返回了错误页面，请稍后重试'
        }
      }

      return {
        success: false,
        error: 'INVALID_JSON',
        userMessage: '服务返回数据格式错误'
      }
    }
  } catch (error) {
    // 网络错误或其他异常
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      return {
        success: false,
        error: 'NETWORK_ERROR',
        userMessage: '网络连接失败，请检查网络'
      }
    }

    return {
      success: false,
      error: 'UNKNOWN_ERROR',
      userMessage: '请求发生未知错误'
    }
  }
}

/**
 * 带重试机制的API请求
 * 用于处理服务重启期间的临时性错误
 */
export async function fetchWithRetry<T = any>(
  url: string,
  options?: RequestInit,
  retryConfig?: {
    maxRetries?: number
    retryDelay?: number
    retryOnErrors?: string[]
  }
): Promise<ApiResult<T>> {
  const {
    maxRetries = 2,
    retryDelay = 1000,
    retryOnErrors = ['SERVICE_UNAVAILABLE', 'NETWORK_ERROR', 'HTML_RESPONSE']
  } = retryConfig || {}

  let lastError: ApiErrorResult | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options)
      const result = await safeJsonParse<T>(response)

      // 成功，直接返回
      if (result.success) {
        return result
      }

      // 检查是否需要重试
      if (attempt < maxRetries && retryOnErrors.includes(result.error)) {
        lastError = result
        await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)))
        continue
      }

      // 不需要重试或已达到最大重试次数
      return result
    } catch (error) {
      lastError = {
        success: false,
        error: 'FETCH_ERROR',
        userMessage: '请求失败，请稍后重试'
      }

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)))
        continue
      }
    }
  }

  return lastError!
}

/**
 * 用户友好的错误消息映射
 */
export const ERROR_MESSAGES: Record<string, string> = {
  SERVICE_UNAVAILABLE: '服务正在重启中，请稍后重试',
  NETWORK_ERROR: '网络连接失败，请检查网络',
  HTML_RESPONSE: '服务返回了错误页面，请稍后重试',
  INVALID_JSON: '服务返回数据格式错误',
  EMPTY_RESPONSE: '服务返回空响应',
  UNKNOWN_ERROR: '请求发生未知错误',
  FETCH_ERROR: '请求失败，请稍后重试'
}

/**
 * 获取用户友好的错误消息
 */
export function getUserFriendlyError(error: string): string {
  return ERROR_MESSAGES[error] || '请求失败，请稍后重试'
}
