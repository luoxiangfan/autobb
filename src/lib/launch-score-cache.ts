/**
 * Launch Score 缓存管理
 * 缓存有效期：5分钟
 */

interface LaunchScoreCache {
  data: any
  timestamp: number
  creativeId: number
}

const CACHE_DURATION = 5 * 60 * 1000 // 5分钟

// 使用Map存储缓存（按offerId索引）
const cache = new Map<number, LaunchScoreCache>()

/**
 * 获取缓存的Launch Score
 */
export function getCachedLaunchScore(offerId: number, creativeId: number): any | null {
  const cached = cache.get(offerId)

  if (!cached) {
    return null
  }

  // 检查Creative ID是否匹配
  if (cached.creativeId !== creativeId) {
    return null
  }

  // 检查是否过期
  const now = Date.now()
  if (now - cached.timestamp > CACHE_DURATION) {
    cache.delete(offerId)
    return null
  }

  return cached.data
}

/**
 * 设置Launch Score缓存
 */
export function setCachedLaunchScore(offerId: number, creativeId: number, data: any): void {
  cache.set(offerId, {
    data,
    creativeId,
    timestamp: Date.now(),
  })
}

/**
 * 清除特定Offer的缓存
 */
export function clearCachedLaunchScore(offerId: number): void {
  cache.delete(offerId)
}

/**
 * 清除所有缓存
 */
export function clearAllCaches(): void {
  cache.clear()
}

/**
 * 获取缓存统计信息
 */
export function getCacheStats(): {
  total: number
  valid: number
  expired: number
} {
  const now = Date.now()
  let valid = 0
  let expired = 0

  cache.forEach((cached) => {
    if (now - cached.timestamp > CACHE_DURATION) {
      expired++
    } else {
      valid++
    }
  })

  return {
    total: cache.size,
    valid,
    expired,
  }
}
