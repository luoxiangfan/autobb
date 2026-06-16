/**
 * Proxy Utilities
 *
 * Proxy retry logic and backoff strategies for stealth browser scraping.
 */

import { getPlaywrightPool } from '../playwright-pool'
import { isProxyConnectionError } from '../proxy-connection-errors'

export { isProxyConnectionError } from '../proxy-connection-errors'

/**
 * 🔥 P1优化：带代理换新重试的执行包装器
 * 当代理连接失败时，清理连接池并获取新代理重试
 */
export async function withProxyRetry<T>(
  fn: () => Promise<T>,
  maxProxyRetries: number = 2,
  operationName: string = '操作'
): Promise<T> {
  let lastError: Error | undefined

  for (let proxyAttempt = 0; proxyAttempt <= maxProxyRetries; proxyAttempt++) {
    try {
      if (proxyAttempt > 0) {
        console.log(
          `🔄 ${operationName} - 代理重试 ${proxyAttempt}/${maxProxyRetries}，清理连接池...`
        )
        const pool = getPlaywrightPool()
        await pool.clearIdleInstances()
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }

      return await fn()
    } catch (error: any) {
      lastError = error
      console.error(
        `❌ ${operationName} 尝试 ${proxyAttempt + 1} 失败: ${error.message?.substring(0, 100)}`
      )

      if (isProxyConnectionError(error) && proxyAttempt < maxProxyRetries) {
        console.log(`🔄 检测到代理连接问题，准备换新代理重试...`)
        continue
      }

      throw error
    }
  }

  throw lastError || new Error(`${operationName}失败：已用尽所有代理重试`)
}

/**
 * Exponential backoff retry logic
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error: any) {
      lastError = error
      const errorMsg = error.message || ''

      if (errorMsg.includes('404') || errorMsg.includes('403')) {
        console.log(`❌ HTTP错误，不重试: ${errorMsg}`)
        throw error
      }

      if (isProxyConnectionError(error)) {
        console.log(`❌ 代理连接失败，跳过无效重试: ${errorMsg.substring(0, 100)}`)
        throw error
      }

      const delay = baseDelay * Math.pow(2, attempt)
      const jitter = Math.random() * 1000

      console.log(`Retry attempt ${attempt + 1}/${maxRetries}, waiting ${delay + jitter}ms...`)
      await new Promise((resolve) => setTimeout(resolve, delay + jitter))
    }
  }

  throw lastError || new Error('Max retries exceeded')
}
