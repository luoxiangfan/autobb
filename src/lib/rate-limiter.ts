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

function cleanupExpiredEntries(): number {
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
function getActiveEntriesCount(): number {
  return rateLimitStore.size
}

// 定期清理过期条目（每5分钟）
setInterval(
  () => {
    cleanupExpiredEntries()
  },
  5 * 60 * 1000
)

// 监控：当条目数量过多时触发清理
setInterval(() => {
  const count = getActiveEntriesCount()
  if (count > 10000) {
    console.warn(`[RateLimiter] High memory usage: ${count} active entries`)
    cleanupExpiredEntries()
  }
}, 60 * 1000)
