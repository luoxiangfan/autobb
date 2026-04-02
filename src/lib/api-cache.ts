/**
 * API响应缓存工具
 * 使用内存缓存减少重复计算和数据库查询
 */
import { invalidateCampaignReadCache } from '@/lib/campaigns-read-cache'

interface CacheEntry<T> {
  data: T
  timestamp: number
  expiresAt: number
}

class ApiCache {
  private cache: Map<string, CacheEntry<any>> = new Map()
  private inFlight: Map<string, Promise<any>> = new Map()
  private defaultTTL: number = 5 * 60 * 1000 // 默认5分钟
  // ⚡ P0性能优化: 添加LRU缓存限制，防止内存泄漏
  private maxSize: number = 1000 // 最大1000条缓存
  private accessOrder: string[] = [] // LRU访问顺序跟踪

  /**
   * 获取缓存数据
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key)

    if (!entry) {
      return null
    }

    // 检查是否过期
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      this.removeFromAccessOrder(key)
      return null
    }

    // 更新LRU访问顺序
    this.updateAccessOrder(key)

    return entry.data as T
  }

  /**
   * 设置缓存数据
   */
  set<T>(key: string, data: T, ttl?: number): void {
    // 如果超过maxSize，删除最旧的条目(LRU驱逐)
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictOldest()
    }

    const actualTTL = ttl || this.defaultTTL
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + actualTTL,
    }
    this.cache.set(key, entry)

    // 更新LRU访问顺序
    this.updateAccessOrder(key)
  }

  /**
   * 更新LRU访问顺序
   */
  private updateAccessOrder(key: string): void {
    // 从旧位置移除
    this.removeFromAccessOrder(key)
    // 添加到末尾（最近访问）
    this.accessOrder.push(key)
  }

  /**
   * 从访问顺序中移除key
   */
  private removeFromAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key)
    if (index > -1) {
      this.accessOrder.splice(index, 1)
    }
  }

  /**
   * 驱逐最旧的缓存条目
   */
  private evictOldest(): void {
    if (this.accessOrder.length === 0) return

    const oldestKey = this.accessOrder.shift()
    if (oldestKey) {
      this.cache.delete(oldestKey)
    }
  }

  /**
   * 删除缓存数据
   */
  delete(key: string): void {
    this.cache.delete(key)
    this.removeFromAccessOrder(key)
  }

  /**
   * 按前缀删除多个缓存
   */
  deleteByPrefix(prefix: string): void {
    const keysToDelete: string[] = []
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key)
      }
    }
    keysToDelete.forEach((key) => {
      this.cache.delete(key)
      this.removeFromAccessOrder(key)
    })
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear()
    this.accessOrder = []
  }

  /**
   * 获取缓存统计
   */
  getStats(): {
    totalKeys: number
    validKeys: number
    expiredKeys: number
  } {
    let validKeys = 0
    let expiredKeys = 0
    const now = Date.now()

    for (const entry of this.cache.values()) {
      if (now <= entry.expiresAt) {
        validKeys++
      } else {
        expiredKeys++
      }
    }

    return {
      totalKeys: this.cache.size,
      validKeys,
      expiredKeys,
    }
  }

  /**
   * 清理过期缓存
   */
  cleanup(): void {
    const now = Date.now()
    const keysToDelete: string[] = []

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        keysToDelete.push(key)
      }
    }

    keysToDelete.forEach((key) => {
      this.cache.delete(key)
      this.removeFromAccessOrder(key)
    })
  }

  /**
   * 获取或设置缓存（带回调函数）
   */
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    // 尝试从缓存获取
    const cached = this.get<T>(key)
    if (cached !== null) {
      return cached
    }

    // 缓存未命中，避免并发请求打爆同一计算
    const inflight = this.inFlight.get(key)
    if (inflight) {
      return await inflight
    }

    const fetchPromise = (async () => {
      const data = await fetchFn()
      this.set(key, data, ttl)
      return data
    })()

    this.inFlight.set(key, fetchPromise)
    try {
      return await fetchPromise
    } finally {
      this.inFlight.delete(key)
    }
  }
}

// 导出单例实例
export const apiCache = new ApiCache()

// 定期清理过期缓存（每10分钟）
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    apiCache.cleanup()
  }, 10 * 60 * 1000)
}

/**
 * 生成缓存键
 */
export function generateCacheKey(
  prefix: string,
  userId: number,
  params?: Record<string, any>
): string {
  const paramStr = params ? JSON.stringify(params) : ''
  return `${prefix}:user:${userId}:${paramStr}`
}

/**
 * 用户相关数据缓存失效
 */
export function invalidateUserCache(userId: number): void {
  apiCache.deleteByPrefix(`user:${userId}`)
  apiCache.deleteByPrefix(`:user:${userId}:`)
}

/**
 * Offer相关缓存失效
 */
export function invalidateOfferCache(userId: number, offerId?: number): void {
  if (offerId) {
    apiCache.deleteByPrefix(`offer:${offerId}`)
  }
  apiCache.deleteByPrefix(`offers:user:${userId}`)
  void invalidateCampaignReadCache(userId)
  invalidateDashboardCache(userId)
}

/**
 * Creative相关缓存失效
 */
export function invalidateCreativeCache(userId: number, creativeId?: number): void {
  if (creativeId) {
    apiCache.deleteByPrefix(`creative:${creativeId}`)
  }
  apiCache.deleteByPrefix(`creatives:user:${userId}`)
  apiCache.deleteByPrefix(`dashboard:user:${userId}`)
}

/**
 * Dashboard缓存失效
 */
export function invalidateDashboardCache(userId: number): void {
  apiCache.deleteByPrefix(`dashboard:user:${userId}`)
  apiCache.deleteByPrefix(`dashboard-summary:user:${userId}`)
  apiCache.deleteByPrefix(`kpis:user:${userId}`)
  apiCache.deleteByPrefix(`trends:user:${userId}`)
  apiCache.deleteByPrefix(`insights:user:${userId}`)
  void invalidateCampaignReadCache(userId)
}
