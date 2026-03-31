/**
 * 速率限制器 - 防止API滥用和DoS攻击
 *
 * 实现方案：基于内存的滑动窗口速率限制
 * 适用场景：单实例部署（Monorepo单容器架构）
 *
 * 如需水平扩展，建议迁移到Redis实现
 */

interface RateLimitEntry {
  count: number // 当前窗口内的请求计数
  resetAt: number // 窗口重置时间（时间戳）
}

// 内存存储：identifier -> RateLimitEntry
const rateLimitStore = new Map<string, RateLimitEntry>()

// 速率限制配置
const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1分钟窗口
const MAX_REQUESTS_PER_WINDOW = 5 // 每个窗口最多5次请求

/**
 * 检查速率限制
 *
 * @param identifier 唯一标识符（如 "ip:192.168.1.1" 或 "user:admin"）
 * @throws {Error} 如果超过速率限制，抛出包含剩余时间的错误
 */
export function checkRateLimit(identifier: string): void {
  const now = Date.now()
  const entry = rateLimitStore.get(identifier)

  if (!entry || now > entry.resetAt) {
    // 新窗口或窗口已过期，重置计数
    rateLimitStore.set(identifier, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    })
    return
  }

  if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
    const secondsRemaining = Math.ceil((entry.resetAt - now) / 1000)
    throw new Error(`请求过于频繁，请在${secondsRemaining}秒后重试`)
  }

  // 增加计数
  entry.count++
}

/**
 * 获取剩余请求次数（可选功能，用于前端显示）
 */
export function getRemainingRequests(identifier: string): {
  remaining: number
  resetAt: number
} {
  const entry = rateLimitStore.get(identifier)
  const now = Date.now()

  if (!entry || now > entry.resetAt) {
    return {
      remaining: MAX_REQUESTS_PER_WINDOW,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    }
  }

  return {
    remaining: Math.max(0, MAX_REQUESTS_PER_WINDOW - entry.count),
    resetAt: entry.resetAt,
  }
}

/**
 * 手动重置速率限制（管理员功能或测试用）
 */
export function resetRateLimit(identifier: string): void {
  rateLimitStore.delete(identifier)
}

/**
 * 清理过期条目（防止内存泄漏）
 *
 * 建议定期调用（如每5分钟）或在达到一定数量时触发
 */
export function cleanupExpiredEntries(): number {
  const now = Date.now()
  let cleanedCount = 0

  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key)
      cleanedCount++
    }
  }

  if (cleanedCount > 0) {
    console.log(`[RateLimiter] Cleaned up ${cleanedCount} expired entries`)
  }

  return cleanedCount
}

/**
 * 获取当前活跃的速率限制条目数量（监控用）
 */
export function getActiveEntriesCount(): number {
  return rateLimitStore.size
}

/**
 * 组合多个标识符检查速率限制
 *
 * 示例: checkMultipleRateLimits('192.168.1.1', 'admin')
 * 将同时检查 IP 级别和用户级别的速率限制
 */
export function checkMultipleRateLimits(...identifiers: string[]): void {
  for (const identifier of identifiers) {
    checkRateLimit(identifier)
  }
}

// 定期清理过期条目（每5分钟）
setInterval(() => {
  cleanupExpiredEntries()
}, 5 * 60 * 1000)

// 监控：当条目数量过多时触发清理
setInterval(() => {
  const count = getActiveEntriesCount()
  if (count > 10000) {
    console.warn(`[RateLimiter] High memory usage: ${count} active entries`)
    cleanupExpiredEntries()
  }
}, 60 * 1000)
