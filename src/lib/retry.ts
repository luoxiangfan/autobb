/**
 * 通用错误重试工具
 *
 * 功能：
 * - 指数退避重试策略
 * - 可配置重试次数和延迟
 * - 支持自定义错误判断
 * - 详细的重试日志
 */

export interface RetryOptions {
  /**
   * 最大重试次数 (默认: 3)
   */
  maxRetries?: number

  /**
   * 初始延迟时间(ms) (默认: 1000)
   */
  initialDelay?: number

  /**
   * 延迟倍数 (默认: 2，指数退避)
   */
  delayMultiplier?: number

  /**
   * 最大延迟时间(ms) (默认: 30000)
   */
  maxDelay?: number

  /**
   * 判断是否应该重试的函数
   * 返回true表示应该重试，false表示不重试
   */
  shouldRetry?: (error: any, attempt: number) => boolean

  /**
   * 重试前的回调函数
   */
  onRetry?: (error: any, attempt: number, delay: number) => void

  /**
   * 操作名称（用于日志）
   */
  operationName?: string
}

/**
 * 执行带重试的异步操作
 *
 * @template T 返回值类型
 * @param fn 要执行的异步函数
 * @param options 重试选项
 * @returns Promise<T>
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   async () => {
 *     return await apiClient.call()
 *   },
 *   {
 *     maxRetries: 3,
 *     initialDelay: 1000,
 *     operationName: 'API Call'
 *   }
 * )
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    delayMultiplier = 2,
    maxDelay = 30000,
    shouldRetry = defaultShouldRetry,
    onRetry,
    operationName = 'Operation'
  } = options

  let lastError: any

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error: any) {
      lastError = error

      // 最后一次尝试失败
      if (attempt === maxRetries) {
        console.error(`${operationName} 失败 (所有重试已用尽):`, error)
        break
      }

      // 判断是否应该重试
      if (!shouldRetry(error, attempt)) {
        console.error(`${operationName} 失败 (不可重试错误):`, error)
        break
      }

      // 计算延迟时间（指数退避）
      const delay = Math.min(initialDelay * Math.pow(delayMultiplier, attempt), maxDelay)

      console.warn(
        `${operationName} 失败 (尝试 ${attempt + 1}/${maxRetries}), ${delay}ms 后重试:`,
        error.message || error
      )

      // 调用重试回调
      if (onRetry) {
        onRetry(error, attempt + 1, delay)
      }

      // 等待后重试
      await sleep(delay)
    }
  }

  throw lastError
}

/**
 * 默认的重试判断函数
 * - 网络错误：重试
 * - 服务器错误 (500-599)：重试
 * - 速率限制错误 (429)：重试
 * - 客户端错误 (400-499，除429外)：不重试
 */
function defaultShouldRetry(error: any, attempt: number): boolean {
  // 网络错误
  if (
    error.code === 'ECONNRESET' ||
    error.code === 'ETIMEDOUT' ||
    error.code === 'ECONNREFUSED' ||
    error.message?.includes('network') ||
    error.message?.includes('timeout')
  ) {
    return true
  }

  // HTTP状态码判断
  if (error.status || error.statusCode) {
    const status = error.status || error.statusCode

    // 速率限制
    if (status === 429) {
      return true
    }

    // 服务器错误
    if (status >= 500 && status < 600) {
      return true
    }

    // 客户端错误（一般不重试）
    if (status >= 400 && status < 500) {
      return false
    }
  }

  // Google Ads API特定错误
  if (error.message?.includes('RATE_EXCEEDED')) {
    return true
  }

  if (error.message?.includes('INTERNAL_ERROR')) {
    return true
  }

  // 默认重试
  return true
}

/**
 * 延迟函数
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 批量重试包装器
 * 对数组中的每个元素执行带重试的操作
 *
 * @example
 * ```typescript
 * const results = await withBatchRetry(
 *   items,
 *   async (item) => await processItem(item),
 *   { maxRetries: 2 }
 * )
 * ```
 */
export async function withBatchRetry<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  options: RetryOptions = {}
): Promise<Array<{ success: boolean; result?: R; error?: any; item: T }>> {
  const results: Array<{ success: boolean; result?: R; error?: any; item: T }> = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]

    try {
      const result = await withRetry(
        () => fn(item, i),
        {
          ...options,
          operationName: `${options.operationName || 'Batch Operation'} [${i + 1}/${items.length}]`
        }
      )

      results.push({
        success: true,
        result,
        item
      })
    } catch (error) {
      results.push({
        success: false,
        error,
        item
      })
    }
  }

  return results
}

/**
 * 指数退避计算器
 * 用于自定义重试逻辑
 */
export function calculateBackoffDelay(
  attempt: number,
  initialDelay: number = 1000,
  multiplier: number = 2,
  maxDelay: number = 30000
): number {
  return Math.min(initialDelay * Math.pow(multiplier, attempt), maxDelay)
}

/**
 * 带超时的重试
 *
 * @example
 * ```typescript
 * const result = await withRetryAndTimeout(
 *   async () => await apiCall(),
 *   { maxRetries: 3 },
 *   5000  // 5秒超时
 * )
 * ```
 */
export async function withRetryAndTimeout<T>(
  fn: () => Promise<T>,
  retryOptions: RetryOptions = {},
  timeoutMs: number = 30000
): Promise<T> {
  return withRetry(
    async () => {
      return Promise.race([
        fn(),
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`Operation timeout after ${timeoutMs}ms`)), timeoutMs)
        )
      ])
    },
    retryOptions
  )
}
