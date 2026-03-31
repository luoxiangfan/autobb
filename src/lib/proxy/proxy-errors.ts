/**
 * 代理错误类型定义
 * 用于区分不同类型的错误，以便实施智能重试策略
 */

/**
 * 代理错误基类
 */
export class ProxyError extends Error {
  /** 是否应该重试 */
  retryable: boolean
  /** 错误代码 */
  code: string

  constructor(message: string, retryable: boolean, code: string) {
    super(message)
    this.name = 'ProxyError'
    this.retryable = retryable
    this.code = code
  }
}

/**
 * 网络错误（临时性，应该重试）
 * 例如：连接超时、DNS解析失败、网络不可达
 */
export class ProxyNetworkError extends ProxyError {
  constructor(message: string) {
    super(message, true, 'NETWORK_ERROR')
    this.name = 'ProxyNetworkError'
  }
}

/**
 * HTTP错误（根据状态码判断是否重试）
 */
export class ProxyHttpError extends ProxyError {
  statusCode: number

  constructor(statusCode: number, message?: string) {
    // 5xx 服务端错误应该重试，4xx 客户端错误不应重试
    const retryable = statusCode >= 500 && statusCode < 600
    super(
      message || `HTTP ${statusCode}`,
      retryable,
      `HTTP_${statusCode}`
    )
    this.name = 'ProxyHttpError'
    this.statusCode = statusCode
  }
}

/**
 * 格式错误（可能是配额/服务问题，应该重试）
 * 注意：格式错误可能是临时的API响应异常，而非真正的格式问题
 * 例如：API返回错误消息而非代理IP
 */
export class ProxyFormatError extends ProxyError {
  actualContent: string
  expectedFormat: string

  constructor(message: string, actualContent: string, expectedFormat: string = 'host:port:username:password') {
    // 格式错误标记为可重试，因为可能是API临时返回了错误消息
    super(message, true, 'FORMAT_ERROR')
    this.name = 'ProxyFormatError'
    this.actualContent = actualContent
    this.expectedFormat = expectedFormat
  }
}

/**
 * 配额错误（持续性，不应重试）
 * 例如：代理配额用完、账户欠费
 */
export class ProxyQuotaError extends ProxyError {
  constructor(message: string) {
    super(message, false, 'QUOTA_ERROR')
    this.name = 'ProxyQuotaError'
  }
}

/**
 * 认证错误（持续性，不应重试）
 * 例如：用户名密码错误、API key无效
 */
export class ProxyAuthError extends ProxyError {
  constructor(message: string) {
    super(message, false, 'AUTH_ERROR')
    this.name = 'ProxyAuthError'
  }
}

/**
 * 服务不可用错误（可能恢复，应该重试）
 * 例如：特定国家代理池暂时无可用IP
 */
export class ProxyUnavailableError extends ProxyError {
  country?: string

  constructor(message: string, country?: string) {
    super(message, true, 'UNAVAILABLE')
    this.name = 'ProxyUnavailableError'
    this.country = country
  }
}

/**
 * Provider业务错误（持续性，不应重试）
 * 例如：账户异常、风控冻结、需要联系客服处理
 */
export class ProxyProviderBusinessError extends ProxyError {
  provider: string
  statusCode?: number

  constructor(provider: string, message: string, statusCode?: number) {
    super(message, false, 'PROVIDER_BUSINESS_ERROR')
    this.name = 'ProxyProviderBusinessError'
    this.provider = provider
    this.statusCode = statusCode
  }
}

/**
 * 健康检查失败（可能恢复，应该重试）
 * 代理IP获取成功但连接测试失败
 */
export class ProxyHealthCheckError extends ProxyError {
  proxyAddress: string

  constructor(message: string, proxyAddress: string) {
    super(message, true, 'HEALTH_CHECK_FAILED')
    this.name = 'ProxyHealthCheckError'
    this.proxyAddress = proxyAddress
  }
}

/**
 * 智能错误分析：从错误消息或响应内容推断错误类型
 */
export function analyzeProxyError(error: any, responseContent?: string): ProxyError {
  const errorMessage = error?.message || String(error)
  const lowerMessage = errorMessage.toLowerCase()

  // 1. 网络错误
  if (
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('enotfound') ||
    lowerMessage.includes('network') ||
    lowerMessage.includes('dns')
  ) {
    return new ProxyNetworkError(errorMessage)
  }

  // 2. HTTP错误
  const httpMatch = errorMessage.match(/HTTP\s+(\d+)/)
  if (httpMatch) {
    const statusCode = parseInt(httpMatch[1], 10)
    return new ProxyHttpError(statusCode, errorMessage)
  }

  // 3. 配额错误（分析响应内容）
  if (responseContent) {
    const lowerContent = responseContent.toLowerCase()
    if (
      lowerContent.includes('quota') ||
      lowerContent.includes('limit exceeded') ||
      lowerContent.includes('insufficient balance') ||
      lowerContent.includes('no credit') ||
      lowerContent.includes('配额') ||
      lowerContent.includes('余额不足')
    ) {
      return new ProxyQuotaError(`代理配额不足: ${responseContent.substring(0, 200)}`)
    }

    // 4. 认证错误
    if (
      lowerContent.includes('unauthorized') ||
      lowerContent.includes('authentication failed') ||
      lowerContent.includes('invalid credentials') ||
      lowerContent.includes('认证失败') ||
      lowerContent.includes('用户名或密码错误')
    ) {
      return new ProxyAuthError(`代理认证失败: ${responseContent.substring(0, 200)}`)
    }

    // 5. 服务不可用
    if (
      lowerContent.includes('no available') ||
      lowerContent.includes('temporarily unavailable') ||
      lowerContent.includes('暂不可用') ||
      lowerContent.includes('无可用')
    ) {
      return new ProxyUnavailableError(`代理服务暂不可用: ${responseContent.substring(0, 200)}`)
    }
  }

  // 6. 格式错误
  if (
    lowerMessage.includes('format') ||
    lowerMessage.includes('parse') ||
    lowerMessage.includes('invalid proxy') ||
    lowerMessage.includes('格式错误')
  ) {
    return new ProxyFormatError(
      errorMessage,
      responseContent || errorMessage
    )
  }

  // 7. 健康检查错误
  if (lowerMessage.includes('health check') || lowerMessage.includes('健康检查')) {
    return new ProxyHealthCheckError(errorMessage, 'unknown')
  }

  // 默认：返回通用错误（可重试）
  return new ProxyError(errorMessage, true, 'UNKNOWN')
}

/**
 * 判断错误是否应该重试
 */
export function shouldRetry(error: any): boolean {
  if (error instanceof ProxyError) {
    return error.retryable
  }
  // 未知错误默认重试
  return true
}

/**
 * 获取推荐的重试延迟时间（毫秒）
 * 使用指数退避策略
 */
export function getRetryDelay(attempt: number, error: ProxyError): number {
  // 基础延迟时间
  let baseDelay = 1000

  // 根据错误类型调整延迟
  if (error instanceof ProxyNetworkError) {
    baseDelay = 2000 // 网络错误等久一点
  } else if (error instanceof ProxyHealthCheckError) {
    baseDelay = 3000 // 健康检查失败等更久
  } else if (error instanceof ProxyFormatError) {
    baseDelay = 1500 // 格式错误稍微等一下
  }

  // 指数退避：delay = baseDelay * attempt
  return baseDelay * attempt
}
