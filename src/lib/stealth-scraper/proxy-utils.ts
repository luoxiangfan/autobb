/**
 * Proxy Utilities
 *
 * Proxy connection detection, retry logic, and backoff strategies
 */

import { getPlaywrightPool } from '../playwright-pool'

/**
 * 🔥 P1优化：判断是否为代理连接错误（全局可用）
 */
export function isProxyConnectionError(error: Error): boolean {
  const msg = error.message || ''

  // 🔒 HTTP 407 代理认证失败（2026-01-26 新增）
  // 这是代理凭证过期或无效的明确信号
  if (msg.includes('407') || msg.includes('Proxy Authentication Required')) {
    console.warn('⚠️ HTTP 407: 代理认证失败，凭证可能已过期')
    return true
  }

  // 明确的代理连接错误（保留）
  if (msg.includes('Proxy connection ended') ||
      msg.includes('net::ERR_PROXY') ||
      msg.includes('ERR_TUNNEL_CONNECTION_FAILED')) {
    return true
  }

  // 🔥 HTTP2协议错误：在代理链路/中间跳转域名上高频出现，通常换代理即可恢复
  if (msg.includes('ERR_HTTP2_PROTOCOL_ERROR') || msg.includes('net::ERR_HTTP2_PROTOCOL_ERROR')) {
    return true
  }

  // TCP连接错误（但需要包含proxy关键词才算代理问题）
  if ((msg.includes('ECONNRESET') || msg.includes('ECONNREFUSED')) &&
      msg.toLowerCase().includes('proxy')) {
    return true
  }

  // ETIMEDOUT只在明确与代理相关时才算代理错误
  if (msg.includes('ETIMEDOUT') && msg.toLowerCase().includes('proxy')) {
    return true
  }

  // 🔥 新增：ERR_EMPTY_RESPONSE 通常表示服务器立即拒绝代理连接
  // Amazon检测到代理IP后会快速关闭连接，返回空响应
  // 这种情况必须立即换代理，重试同一代理必定失败
  if (msg.includes('ERR_EMPTY_RESPONSE')) {
    return true  // 服务器拒绝 = 代理被封或被标记
  }

  // 🔥 新增：page.goto超时很可能是代理IP被封禁
  // Amazon和短链接服务会立即封禁代理IP，导致page.goto永远无法完成
  // 这种情况下应该立即换代理，而不是用同一代理重试
  if (msg.includes('page.goto: Timeout') && msg.includes('exceeded')) {
    // page.goto 超时通常意味着代理链路/目标站点对该代理“卡死”(challenge/握手/中间链路不兼容)；
    // URL解析阶段宁可快速换代理，也不要复用同一实例反复超时。
    return true
  }

  // 🔥 新增：net::ERR_TIMED_OUT 格式的超时错误
  // Playwright错误格式: "page.goto: net::ERR_TIMED_OUT at https://pboost.me/aOqlvu0"
  if (msg.includes('net::ERR_TIMED_OUT') && msg.includes('page.goto:')) {
    // 对于所有page.goto的ERR_TIMED_OUT错误，都应该认为是代理被封
    // 因为正常网络超时不会以这种格式出现
    return true
  }

  // 超时错误需要更明确的代理关键词
  if (msg.includes('Timeout') &&
      (msg.includes('proxy') || msg.includes('tunnel') || msg.includes('CONNECT'))) {
    return true
  }

  return false
}

/**
 * 🔥 P1优化：带代理换新重试的执行包装器
 * 当代理连接失败时，清理连接池并获取新代理重试
 *
 * @param fn - 需要执行的异步函数
 * @param maxProxyRetries - 最大代理重试次数（默认2）
 * @param operationName - 操作名称（用于日志）
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
        console.log(`🔄 ${operationName} - 代理重试 ${proxyAttempt}/${maxProxyRetries}，清理连接池...`)
        const pool = getPlaywrightPool()
        await pool.clearIdleInstances()
        // 短暂延迟后重试
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

      return await fn()
    } catch (error: any) {
      lastError = error
      console.error(`❌ ${operationName} 尝试 ${proxyAttempt + 1} 失败: ${error.message?.substring(0, 100)}`)

      // 如果是代理连接错误，尝试换新代理
      if (isProxyConnectionError(error) && proxyAttempt < maxProxyRetries) {
        console.log(`🔄 检测到代理连接问题，准备换新代理重试...`)
        continue
      }

      // 其他错误或已用尽重试次数
      throw error
    }
  }

  throw lastError || new Error(`${operationName}失败：已用尽所有代理重试`)
}

/**
 * Exponential backoff retry logic
 * 🔥 P1优化：添加代理连接失败的快速失败逻辑
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

      // 🔥 不重试的错误类型：
      // 1. HTTP 404/403 错误（页面不存在/被禁止）
      // 2. 代理连接失败（需要换代理，重试同一个代理无意义）
      if (errorMsg.includes('404') || errorMsg.includes('403')) {
        console.log(`❌ HTTP错误，不重试: ${errorMsg}`)
        throw error
      }

      // 🔥 P1优化：代理连接失败时快速失败，不进行无效重试
      // 因为retryWithBackoff使用同一个browserResult（同一代理），重试是无效的
      // 使用统一的isProxyConnectionError()函数判断
      if (isProxyConnectionError(error)) {
        console.log(`❌ 代理连接失败，跳过无效重试: ${errorMsg.substring(0, 100)}`)
        throw error
      }

      // Calculate exponential backoff delay
      const delay = baseDelay * Math.pow(2, attempt)
      const jitter = Math.random() * 1000 // Add jitter

      console.log(`Retry attempt ${attempt + 1}/${maxRetries}, waiting ${delay + jitter}ms...`)
      await new Promise(resolve => setTimeout(resolve, delay + jitter))
    }
  }

  throw lastError || new Error('Max retries exceeded')
}
