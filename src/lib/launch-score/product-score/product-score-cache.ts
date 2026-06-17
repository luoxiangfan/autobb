/**
 * 商品推荐指数Redis缓存
 *
 * 功能:
 * - 缓存商品推荐指数数据
 * - 用户级别隔离
 * - 自动失效机制
 */

import { REDIS_PREFIX_CONFIG } from '@/lib/common/server'
import { getRedisClient } from '@/lib/common/server'

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
 * 缓存单个商品的推荐指数
 */
export async function cacheProductRecommendationScore(
  userId: number,
  productId: number,
  score: CachedRecommendationScore
): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) {
      console.warn('[ProductScoreCache] Redis不可用,跳过缓存')
      return
    }

    const key = getProductScoreKey(userId, productId)
    const data = {
      ...score,
      cachedAt: Date.now(),
    }

    await redis.setex(key, RECOMMENDATION_SCORE_TTL_SECONDS, JSON.stringify(data))
    console.log(`[ProductScoreCache] 已缓存商品${productId}的推荐指数 (用户${userId})`)
  } catch (error) {
    console.error('[ProductScoreCache] 缓存失败:', error)
    // 缓存失败不影响主流程
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
    const redis = getRedisClient()
    if (!redis || productIds.length === 0) {
      return result
    }

    const keys = productIds.map((id) => getProductScoreKey(userId, id))
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

    console.log(
      `[ProductScoreCache] 批量查询: ${productIds.length}个商品, 命中${result.size}个 (用户${userId})`
    )
    return result
  } catch (error) {
    console.error('[ProductScoreCache] 批量读取缓存失败:', error)
    return result
  }
}
