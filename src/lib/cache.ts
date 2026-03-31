/**
 * 内存缓存工具
 *
 * 功能：
 * - 为AI创意生成、Google Ads API等提供缓存
 * - 支持TTL（过期时间）
 * - 支持缓存键生成
 * - 自动清理过期缓存
 * - 支持缓存统计
 */

export interface CacheEntry<T> {
  value: T
  expiresAt: number
  createdAt: number
  hits: number
}

export interface CacheStats {
  totalEntries: number
  hits: number
  misses: number
  hitRate: number
  totalSize: number
}

/**
 * 通用内存缓存类
 */
export class MemoryCache<T = any> {
  private cache: Map<string, CacheEntry<T>> = new Map()
  private defaultTTL: number
  private maxSize: number
  private hits: number = 0
  private misses: number = 0
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor(defaultTTL: number = 3600000, maxSize: number = 1000) {
    this.defaultTTL = defaultTTL // 默认1小时
    this.maxSize = maxSize

    // 启动定期清理过期缓存（每5分钟）
    this.startCleanup()
  }

  /**
   * 设置缓存
   */
  set(key: string, value: T, ttl?: number): void {
    const expiresAt = Date.now() + (ttl || this.defaultTTL)

    // 如果缓存已满，删除最旧的条目
    if (this.cache.size >= this.maxSize) {
      this.evictOldest()
    }

    this.cache.set(key, {
      value,
      expiresAt,
      createdAt: Date.now(),
      hits: 0
    })
  }

  /**
   * 获取缓存
   */
  get(key: string): T | null {
    const entry = this.cache.get(key)

    if (!entry) {
      this.misses++
      return null
    }

    // 检查是否过期
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      this.misses++
      return null
    }

    // 命中统计
    entry.hits++
    this.hits++

    return entry.value
  }

  /**
   * 检查缓存是否存在且未过期
   */
  has(key: string): boolean {
    const entry = this.cache.get(key)

    if (!entry) {
      return false
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return false
    }

    return true
  }

  /**
   * 删除缓存
   */
  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear()
    this.hits = 0
    this.misses = 0
  }

  /**
   * 获取缓存统计
   */
  getStats(): CacheStats {
    const totalRequests = this.hits + this.misses
    const hitRate = totalRequests > 0 ? this.hits / totalRequests : 0

    return {
      totalEntries: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: Math.round(hitRate * 100) / 100,
      totalSize: this.cache.size
    }
  }

  /**
   * 清理过期缓存
   */
  private cleanup(): void {
    const now = Date.now()
    let cleanedCount = 0

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key)
        cleanedCount++
      }
    }

    if (cleanedCount > 0) {
      console.log(`[Cache] 清理了 ${cleanedCount} 个过期缓存条目`)
    }
  }

  /**
   * 启动定期清理
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, 300000) // 每5分钟清理一次
  }

  /**
   * 停止定期清理
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  /**
   * 驱逐最旧的缓存条目
   */
  private evictOldest(): void {
    let oldestKey: string | null = null
    let oldestTime = Infinity

    for (const [key, entry] of this.cache.entries()) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey)
      console.log(`[Cache] 驱逐最旧缓存: ${oldestKey}`)
    }
  }
}

/**
 * AI创意生成缓存键生成器
 */
export function generateCreativeCacheKey(
  offerId: number,
  options?: {
    theme?: string
    referencePerformance?: any
  }
): string {
  const parts = [`offer_${offerId}`]

  if (options?.theme) {
    parts.push(`theme_${options.theme}`)
  }

  if (options?.referencePerformance) {
    // 简化性能数据作为缓存键的一部分
    const perfKey = JSON.stringify(options.referencePerformance)
      .replace(/\s/g, '')
      .substring(0, 50)
    parts.push(`perf_${perfKey}`)
  }

  return `creative_${parts.join('_')}`
}

/**
 * Google Ads API缓存键生成器
 */
export function generateGadsApiCacheKey(
  operation: string,
  customerId: string,
  params?: Record<string, any>
): string {
  const parts = [`customer_${customerId}`, `op_${operation}`]

  if (params) {
    const paramKey = JSON.stringify(params)
      .replace(/\s/g, '')
      .substring(0, 100)
    parts.push(`params_${paramKey}`)
  }

  return `gads_${parts.join('_')}`
}

/**
 * URL解析缓存键生成器
 */
export function generateUrlCacheKey(
  url: string,
  targetCountry?: string
): string {
  const urlHash = url.length > 100 ? url.substring(0, 100) : url
  const country = targetCountry || 'default'

  return `url_${country}_${urlHash}`
}

// ========== 全局缓存实例 ==========

/**
 * AI创意生成缓存（1小时TTL，最多500个条目）
 */
export const creativeCache = new MemoryCache(3600000, 500)

/**
 * Google Ads API缓存（30分钟TTL，最多1000个条目）
 */
export const gadsApiCache = new MemoryCache(1800000, 1000)

/**
 * URL解析缓存（24小时TTL，最多200个条目）
 */
export const urlCache = new MemoryCache(86400000, 200)

/**
 * 获取所有缓存的统计信息
 */
export function getAllCacheStats() {
  return {
    creative: creativeCache.getStats(),
    gadsApi: gadsApiCache.getStats(),
    url: urlCache.getStats()
  }
}

/**
 * 清空所有缓存
 */
export function clearAllCaches() {
  creativeCache.clear()
  gadsApiCache.clear()
  urlCache.clear()
  console.log('[Cache] 已清空所有缓存')
}
