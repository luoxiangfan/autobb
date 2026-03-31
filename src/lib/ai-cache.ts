/**
 * AI结果缓存管理器
 *
 * 支持的缓存后端：
 * 1. Redis (推荐，生产环境)
 * 2. Memory (开发/测试，降级方案)
 *
 * 缓存策略：
 * - 评论分析：7天TTL
 * - 竞品分析：3天TTL
 * - 关键词生成：不缓存（实时性要求高）
 *
 * 预期收益：
 * - 评论分析命中率：40-50% → 节省$880/年
 * - 竞品分析命中率：30-40% → 节省$240/年
 *
 * 环境隔离（2025-12-10优化为方案3）：
 * - 使用结构化REDIS_PREFIX_CONFIG配置
 * - 统一的cache命名空间
 * - 格式：autoads:{NODE_ENV}:cache:ai:{operationType}:{version}:{hash}
 */

import { getRedisClient } from './redis-client'
import { REDIS_PREFIX_CONFIG } from './config'

export interface CacheOptions {
  ttl?: number // 缓存时间（秒），默认使用operationType的默认TTL
  forceRefresh?: boolean // 强制刷新，跳过缓存
  version?: string // 缓存版本号（用于失效旧缓存）
}

export interface CacheStats {
  hits: number
  misses: number
  hitRate: number
  totalSavings: number // 估算节省的成本
}

/**
 * 缓存配置（按operationType）
 */
const CACHE_CONFIG: Record<
  string,
  { ttl: number; enabled: boolean; avgCost: number }
> = {
  review_analysis: {
    ttl: 7 * 24 * 60 * 60, // 7天（秒）
    enabled: true,
    avgCost: 0.08, // 平均成本
  },
  competitor_analysis: {
    ttl: 3 * 24 * 60 * 60, // 3天（秒）
    enabled: true,
    avgCost: 0.05,
  },
  product_score_combined_analysis: {
    ttl: 30 * 24 * 60 * 60, // 30天（按月份+商品身份拆key）
    enabled: true,
    avgCost: 0.025,
  },
  // 不缓存的操作
  keyword_generation: {
    ttl: 0,
    enabled: false,
    avgCost: 0.02,
  },
  ad_creative_generation_main: {
    ttl: 0,
    enabled: false,
    avgCost: 0.04,
  },
}

/**
 * 生成缓存键
 *
 * 格式：{cache_prefix}ai:{operationType}:{version}:{contentHash}
 * 例如：autoads:development:cache:ai:review_analysis:v1:abc123
 */
function generateCacheKey(
  operationType: string,
  contentHash: string,
  version: string = 'v1'
): string {
  return `${REDIS_PREFIX_CONFIG.cache}ai:${operationType}:${version}:${contentHash}`
}

/**
 * 简单哈希函数（用于生成内容哈希）
 */
function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // 转换为32位整数
  }
  return Math.abs(hash).toString(36)
}

/**
 * AI缓存管理器类
 */
export class AICacheManager {
  private stats: Map<string, CacheStats> = new Map()
  private memoryCache: Map<string, { value: unknown; expireAt: number }> =
    new Map()

  /**
   * 获取Redis客户端（如果可用）
   */
  private getRedis() {
    return getRedisClient()
  }

  /**
   * 从内存缓存获取
   */
  private getFromMemory<T>(key: string): T | null {
    const cached = this.memoryCache.get(key)
    if (!cached) return null

    // 检查是否过期
    if (Date.now() > cached.expireAt) {
      this.memoryCache.delete(key)
      return null
    }

    return cached.value as T
  }

  /**
   * 存储到内存缓存
   */
  private setToMemory<T>(key: string, value: T, ttlSeconds: number): void {
    const expireAt = Date.now() + ttlSeconds * 1000
    this.memoryCache.set(key, { value, expireAt })

    // 清理过期项（简单实现）
    if (this.memoryCache.size > 1000) {
      const now = Date.now()
      for (const [k, v] of this.memoryCache.entries()) {
        if (now > v.expireAt) {
          this.memoryCache.delete(k)
        }
      }
    }
  }

  /**
   * 获取缓存
   *
   * @param operationType - 操作类型
   * @param contentKey - 内容标识（如product URL）
   * @param options - 缓存选项
   * @returns 缓存的结果或null
   */
  async get<T>(
    operationType: string,
    contentKey: string,
    options: CacheOptions = {}
  ): Promise<T | null> {
    // 检查是否启用缓存
    const config = CACHE_CONFIG[operationType]
    if (!config || !config.enabled || options.forceRefresh) {
      this.recordMiss(operationType)
      return null
    }

    try {
      const cacheKey = generateCacheKey(
        operationType,
        simpleHash(contentKey),
        options.version
      )

      const redis = this.getRedis()

      // 优先使用Redis
      if (redis && redis.status === 'ready') {
        const cached = await redis.get(cacheKey)
        if (cached) {
          const parsed = JSON.parse(cached) as T
          this.recordHit(operationType, config.avgCost)
          console.log(
            `✅ 缓存命中(Redis): ${operationType} (节省成本: ¥${config.avgCost.toFixed(4)})`
          )
          return parsed
        }
      } else {
        // 降级到内存缓存
        const cached = this.getFromMemory<T>(cacheKey)
        if (cached) {
          this.recordHit(operationType, config.avgCost)
          console.log(
            `✅ 缓存命中(Memory): ${operationType} (节省成本: ¥${config.avgCost.toFixed(4)})`
          )
          return cached
        }
      }

      this.recordMiss(operationType)
      return null
    } catch (error) {
      console.warn(`缓存读取失败: ${operationType}`, error)
      this.recordMiss(operationType)
      return null
    }
  }

  /**
   * 设置缓存
   *
   * @param operationType - 操作类型
   * @param contentKey - 内容标识
   * @param value - 缓存值
   * @param options - 缓存选项
   */
  async set<T>(
    operationType: string,
    contentKey: string,
    value: T,
    options: CacheOptions = {}
  ): Promise<void> {
    const config = CACHE_CONFIG[operationType]
    if (!config || !config.enabled) {
      return // 不缓存
    }

    try {
      const cacheKey = generateCacheKey(
        operationType,
        simpleHash(contentKey),
        options.version
      )
      const ttl = options.ttl || config.ttl

      const redis = this.getRedis()

      // 优先使用Redis
      if (redis && redis.status === 'ready') {
        await redis.set(cacheKey, JSON.stringify(value), 'EX', ttl)
        console.log(
          `💾 缓存已设置(Redis): ${operationType} (TTL: ${(ttl / 60 / 60).toFixed(1)}小时)`
        )
      } else {
        // 降级到内存缓存
        this.setToMemory(cacheKey, value, ttl)
        console.log(
          `💾 缓存已设置(Memory): ${operationType} (TTL: ${(ttl / 60 / 60).toFixed(1)}小时)`
        )
      }
    } catch (error) {
      console.warn(`缓存写入失败: ${operationType}`, error)
    }
  }

  /**
   * 删除缓存
   */
  async delete(
    operationType: string,
    contentKey: string,
    options: CacheOptions = {}
  ): Promise<void> {
    try {
      const cacheKey = generateCacheKey(
        operationType,
        simpleHash(contentKey),
        options.version
      )

      const redis = this.getRedis()
      if (redis && redis.status === 'ready') {
        await redis.del(cacheKey)
      }

      this.memoryCache.delete(cacheKey)
      console.log(`🗑️ 缓存已删除: ${operationType}`)
    } catch (error) {
      console.warn(`缓存删除失败: ${operationType}`, error)
    }
  }

  /**
   * 批量删除缓存（按operationType）
   */
  async deleteByOperationType(operationType: string): Promise<void> {
    try {
      const redis = this.getRedis()
      if (redis && redis.status === 'ready') {
        const pattern = `${REDIS_PREFIX_CONFIG.cache}ai:${operationType}:*`
        const stream = redis.scanStream({
          match: pattern,
          count: 100,
        })

        stream.on('data', async (keys: string[]) => {
          if (keys.length > 0) {
            await redis.del(...keys)
          }
        })

        stream.on('end', () => {
          console.log(`🗑️ 批量删除缓存完成: ${pattern}`)
        })
      }

      // 清理内存缓存
      const prefix = `${REDIS_PREFIX_CONFIG.cache}ai:${operationType}:`
      for (const key of this.memoryCache.keys()) {
        if (key.startsWith(prefix)) {
          this.memoryCache.delete(key)
        }
      }
    } catch (error) {
      console.warn(`批量删除缓存失败: ${operationType}`, error)
    }
  }

  /**
   * 记录缓存命中
   */
  private recordHit(operationType: string, costSaved: number) {
    const stats = this.stats.get(operationType) || {
      hits: 0,
      misses: 0,
      hitRate: 0,
      totalSavings: 0,
    }
    stats.hits++
    stats.totalSavings += costSaved
    this.updateHitRate(stats)
    this.stats.set(operationType, stats)
  }

  /**
   * 记录缓存未命中
   */
  private recordMiss(operationType: string) {
    const stats = this.stats.get(operationType) || {
      hits: 0,
      misses: 0,
      hitRate: 0,
      totalSavings: 0,
    }
    stats.misses++
    this.updateHitRate(stats)
    this.stats.set(operationType, stats)
  }

  /**
   * 更新命中率
   */
  private updateHitRate(stats: CacheStats) {
    const total = stats.hits + stats.misses
    stats.hitRate = total > 0 ? stats.hits / total : 0
  }

  /**
   * 获取统计信息
   */
  getStats(operationType?: string): Map<string, CacheStats> | CacheStats | null {
    if (operationType) {
      return this.stats.get(operationType) || null
    }
    return this.stats
  }

  /**
   * 打印统计报告
   */
  printStats() {
    console.log('\n📊 AI缓存统计报告:\n')
    this.stats.forEach((stats, operationType) => {
      console.log(`${operationType}:`)
      console.log(`  命中: ${stats.hits}`)
      console.log(`  未命中: ${stats.misses}`)
      console.log(`  命中率: ${(stats.hitRate * 100).toFixed(1)}%`)
      console.log(`  节省成本: ¥${stats.totalSavings.toFixed(4)}\n`)
    })
  }
}

/**
 * 全局缓存管理器实例
 */
export const aiCache = new AICacheManager()

/**
 * 便捷函数：带缓存的AI调用包装器
 *
 * @param operationType - 操作类型
 * @param contentKey - 内容标识
 * @param aiFunction - AI调用函数
 * @param options - 缓存选项
 * @returns AI结果（来自缓存或新调用）
 */
export async function withCache<T>(
  operationType: string,
  contentKey: string,
  aiFunction: () => Promise<T>,
  options: CacheOptions = {}
): Promise<T> {
  // 尝试从缓存获取
  const cached = await aiCache.get<T>(operationType, contentKey, options)
  if (cached !== null) {
    return cached
  }

  // 缓存未命中，执行AI调用
  const result = await aiFunction()

  // 存储到缓存
  await aiCache.set(operationType, contentKey, result, options)

  return result
}

/**
 * 示例：使用缓存包装器
 */
export async function exampleUsage() {
  // 示例1：评论分析
  const productUrl = 'https://amazon.com/product/B123'
  const reviewAnalysis = await withCache(
    'review_analysis',
    productUrl,
    async () => {
      // 实际的AI调用
      return {
        sentiment: 'positive',
        keywords: ['great', 'quality', 'recommend'],
        rating: 4.5,
      }
    }
  )

  console.log('评论分析结果:', reviewAnalysis)

  // 示例2：强制刷新
  const freshAnalysis = await withCache(
    'review_analysis',
    productUrl,
    async () => {
      return { sentiment: 'positive', keywords: [], rating: 4.5 }
    },
    { forceRefresh: true } // 跳过缓存
  )

  console.log('强制刷新结果:', freshAnalysis)

  // 打印统计
  aiCache.printStats()
}
