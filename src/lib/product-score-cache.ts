/**
 * 商品推荐指数Redis缓存
 *
 * 功能:
 * - 缓存商品推荐指数数据
 * - 用户级别隔离
 * - 自动失效机制
 */

import { REDIS_PREFIX_CONFIG } from '@/lib/config'
import { getRedisClient } from '@/lib/redis'

// 缓存TTL: 24小时
const RECOMMENDATION_SCORE_TTL_SECONDS = 24 * 60 * 60

/**
 * 推荐指数缓存数据结构
 */
export interface CachedRecommendationScore {
  recommendationScore: number // 星级评分 (1.0-5.0)
  recommendationReasons: string[] // 推荐理由
  seasonalityScore: number | null // 季节性评分
  productAnalysis: any | null // 商品AI分析结果
  scoreCalculatedAt: string // 计算时间
  inputFingerprint?: string // 评分输入指纹（用于判断同步后是否可复用）
  cachedAt: number // 缓存时间戳
}

/**
 * 获取单个商品推荐指数的缓存key
 */
function getProductScoreKey(userId: number, productId: number): string {
  return `${REDIS_PREFIX_CONFIG.cache}product-score:user:${userId}:product:${productId}`
}

/**
 * 获取用户所有商品推荐指数的缓存key模式
 */
function getProductScorePattern(userId: number): string {
  return `${REDIS_PREFIX_CONFIG.cache}product-score:user:${userId}:product:*`
}

/**
 * 获取批量商品推荐指数的缓存key
 */
function getBatchScoreKey(userId: number, productIds: number[]): string {
  const sortedIds = [...productIds].sort((a, b) => a - b).join(',')
  return `${REDIS_PREFIX_CONFIG.cache}product-score:user:${userId}:batch:${sortedIds}`
}

/**
 * 缓存单个商品的推荐指数
 */
export async function cacheProductRecommendationScore(
  userId: number,
  productId: number,
  score: CachedRecommendationScore
): Promise<void> {
  try {
    const redis = await getRedisClient()
    if (!redis) {
      console.warn('[ProductScoreCache] Redis不可用,跳过缓存')
      return
    }

    const key = getProductScoreKey(userId, productId)
    const data = {
      ...score,
      cachedAt: Date.now()
    }

    await redis.setex(key, RECOMMENDATION_SCORE_TTL_SECONDS, JSON.stringify(data))
    console.log(`[ProductScoreCache] 已缓存商品${productId}的推荐指数 (用户${userId})`)
  } catch (error) {
    console.error('[ProductScoreCache] 缓存失败:', error)
    // 缓存失败不影响主流程
  }
}

/**
 * 批量缓存商品推荐指数
 */
export async function batchCacheProductRecommendationScores(
  userId: number,
  scores: Map<number, CachedRecommendationScore>
): Promise<void> {
  try {
    const redis = await getRedisClient()
    if (!redis) {
      console.warn('[ProductScoreCache] Redis不可用,跳过缓存')
      return
    }

    const pipeline = redis.pipeline()
    const now = Date.now()

    for (const [productId, score] of scores.entries()) {
      const key = getProductScoreKey(userId, productId)
      const data = {
        ...score,
        cachedAt: now
      }
      pipeline.setex(key, RECOMMENDATION_SCORE_TTL_SECONDS, JSON.stringify(data))
    }

    await pipeline.exec()
    console.log(`[ProductScoreCache] 已批量缓存${scores.size}个商品的推荐指数 (用户${userId})`)
  } catch (error) {
    console.error('[ProductScoreCache] 批量缓存失败:', error)
    // 缓存失败不影响主流程
  }
}

/**
 * 获取单个商品的推荐指数缓存
 */
export async function getCachedProductRecommendationScore(
  userId: number,
  productId: number
): Promise<CachedRecommendationScore | null> {
  try {
    const redis = await getRedisClient()
    if (!redis) {
      return null
    }

    const key = getProductScoreKey(userId, productId)
    const data = await redis.get(key)

    if (!data) {
      return null
    }

    const parsed = JSON.parse(data) as CachedRecommendationScore
    console.log(`[ProductScoreCache] 命中缓存: 商品${productId} (用户${userId})`)
    return parsed
  } catch (error) {
    console.error('[ProductScoreCache] 读取缓存失败:', error)
    return null
  }
}

/**
 * 批量获取商品推荐指数缓存
 */
export async function batchGetCachedProductRecommendationScores(
  userId: number,
  productIds: number[]
): Promise<Map<number, CachedRecommendationScore>> {
  const result = new Map<number, CachedRecommendationScore>()

  try {
    const redis = await getRedisClient()
    if (!redis || productIds.length === 0) {
      return result
    }

    const keys = productIds.map(id => getProductScoreKey(userId, id))
    const values = await redis.mget(...keys)

    for (let i = 0; i < productIds.length; i++) {
      const value = values[i]
      if (value) {
        try {
          const parsed = JSON.parse(value) as CachedRecommendationScore
          result.set(productIds[i], parsed)
        } catch (error) {
          console.error(`[ProductScoreCache] 解析缓存失败: 商品${productIds[i]}`, error)
        }
      }
    }

    console.log(`[ProductScoreCache] 批量查询: ${productIds.length}个商品, 命中${result.size}个 (用户${userId})`)
    return result
  } catch (error) {
    console.error('[ProductScoreCache] 批量读取缓存失败:', error)
    return result
  }
}

/**
 * 清除单个商品的推荐指数缓存
 */
export async function invalidateProductRecommendationScore(
  userId: number,
  productId: number
): Promise<void> {
  try {
    const redis = await getRedisClient()
    if (!redis) {
      return
    }

    const key = getProductScoreKey(userId, productId)
    await redis.del(key)
    console.log(`[ProductScoreCache] 已清除商品${productId}的缓存 (用户${userId})`)
  } catch (error) {
    console.error('[ProductScoreCache] 清除缓存失败:', error)
  }
}

/**
 * 批量清除商品推荐指数缓存
 */
export async function batchInvalidateProductRecommendationScores(
  userId: number,
  productIds: number[]
): Promise<void> {
  try {
    const redis = await getRedisClient()
    if (!redis || productIds.length === 0) {
      return
    }

    const keys = productIds.map(id => getProductScoreKey(userId, id))
    await redis.del(...keys)
    console.log(`[ProductScoreCache] 已批量清除${productIds.length}个商品的缓存 (用户${userId})`)
  } catch (error) {
    console.error('[ProductScoreCache] 批量清除缓存失败:', error)
  }
}

/**
 * 清除用户所有商品的推荐指数缓存
 */
export async function invalidateAllProductRecommendationScores(userId: number): Promise<void> {
  try {
    const redis = await getRedisClient()
    if (!redis) {
      return
    }

    const pattern = getProductScorePattern(userId)
    let cursor = '0'
    let deletedCount = 0

    do {
      const [newCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = newCursor

      if (keys.length > 0) {
        await redis.del(...keys)
        deletedCount += keys.length
      }
    } while (cursor !== '0')

    console.log(`[ProductScoreCache] 已清除用户${userId}的所有商品缓存 (共${deletedCount}个)`)
  } catch (error) {
    console.error('[ProductScoreCache] 清除所有缓存失败:', error)
  }
}

/**
 * 获取缓存统计信息
 */
export async function getProductScoreCacheStats(userId: number): Promise<{
  totalCached: number
  oldestCacheTime: number | null
  newestCacheTime: number | null
}> {
  try {
    const redis = await getRedisClient()
    if (!redis) {
      return { totalCached: 0, oldestCacheTime: null, newestCacheTime: null }
    }

    const pattern = getProductScorePattern(userId)
    let cursor = '0'
    let totalCached = 0
    let oldestCacheTime: number | null = null
    let newestCacheTime: number | null = null

    do {
      const [newCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = newCursor
      totalCached += keys.length

      if (keys.length > 0) {
        const values = await redis.mget(...keys)
        for (const value of values) {
          if (value) {
            try {
              const parsed = JSON.parse(value) as CachedRecommendationScore
              if (oldestCacheTime === null || parsed.cachedAt < oldestCacheTime) {
                oldestCacheTime = parsed.cachedAt
              }
              if (newestCacheTime === null || parsed.cachedAt > newestCacheTime) {
                newestCacheTime = parsed.cachedAt
              }
            } catch (error) {
              // 忽略解析错误
            }
          }
        }
      }
    } while (cursor !== '0')

    return { totalCached, oldestCacheTime, newestCacheTime }
  } catch (error) {
    console.error('[ProductScoreCache] 获取缓存统计失败:', error)
    return { totalCached: 0, oldestCacheTime: null, newestCacheTime: null }
  }
}
