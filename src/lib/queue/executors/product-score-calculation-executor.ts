/**
 * 商品推荐指数计算任务执行器
 *
 * 功能:
 * - 批量计算商品推荐指数
 * - 支持全量计算和增量计算
 * - 支持季节性分析(可选)
 */

import { createHash } from 'crypto'
import type { Task } from '@/lib/queue/types'
import { getDatabase } from '@/lib/db'
import { nowFunc } from '@/lib/db-helpers'
import { getQueueManagerForTaskType } from '@/lib/queue/queue-routing'
import {
  calculateHybridProductRecommendationScores,
} from '@/lib/product-recommendation-scoring'
import type { AffiliateProduct } from '@/lib/affiliate-products'
import {
  batchGetCachedProductRecommendationScores,
  cacheProductRecommendationScore,
  type CachedRecommendationScore,
} from '@/lib/product-score-cache'
import {
  acquireProductScoreExecutionMutex,
  consumeProductScoreRequeueRequest,
  findExistingProductScoreTask,
  markProductScoreRequeueNeeded,
} from '@/lib/product-score-coordination'
import { isProductScoreCalculationPaused } from '@/lib/product-score-control'

export type ProductScoreCalculationTaskData = {
  userId: number
  productIds?: number[] // 指定商品ID列表(可选)
  forceRecalculate?: boolean // 强制重新计算
  allowWhenPaused?: boolean // 全局暂停时允许执行（仅限带productIds的手动任务）
  batchSize?: number // 批次大小
  includeSeasonalityAnalysis?: boolean // 是否包含季节性分析
  trigger?: 'manual' | 'schedule' | 'sync-complete' // 触发来源
}

const PRODUCT_SCORE_AI_RERANK_TOP_K_MANUAL_DEFAULT = 10
const PRODUCT_SCORE_AI_RERANK_TOP_K_BACKGROUND_DEFAULT = 3
const PRODUCT_SCORE_VALIDITY_DAYS = 30

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback

  return parsed
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeFingerprintText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function normalizeFingerprintNumber(value: unknown): string {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toFixed(4) : ''
}

function normalizeAllowedCountries(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => normalizeFingerprintText(item))
        .filter(Boolean)
        .sort()
        .join(',')
    }
  } catch {
    // ignore parse errors and fall back to normalized raw text
  }

  return normalizeFingerprintText(value)
}

function buildProductScoreInputFingerprint(product: AffiliateProduct): string {
  const payload = [
    normalizeFingerprintText(product.asin),
    normalizeFingerprintText(product.product_name),
    normalizeFingerprintText(product.brand),
    normalizeFingerprintText(product.product_url),
    normalizeFingerprintText(product.promo_link),
    normalizeFingerprintText(product.short_promo_link),
    normalizeAllowedCountries(product.allowed_countries_json),
    normalizeFingerprintNumber(product.price_amount),
    normalizeFingerprintNumber(product.review_count),
    normalizeFingerprintNumber(product.commission_rate),
    normalizeFingerprintNumber(product.commission_amount),
    product.is_blacklisted ? '1' : '0',
    product.is_confirmed_invalid ? '1' : '0',
  ].join('|')

  return createHash('sha1').update(payload).digest('hex')
}

function isCachedScoreReusable(
  product: AffiliateProduct,
  cachedScore: CachedRecommendationScore,
  inputFingerprint: string
): boolean {
  if (cachedScore.inputFingerprint) {
    return cachedScore.inputFingerprint === inputFingerprint
  }

  const cacheCalculatedAtMs = parseTimestampMs(cachedScore.scoreCalculatedAt) ?? cachedScore.cachedAt
  if (!Number.isFinite(cacheCalculatedAtMs)) return false

  const lastSyncedAtMs = parseTimestampMs(product.last_synced_at as unknown)
  if (lastSyncedAtMs && cacheCalculatedAtMs < lastSyncedAtMs) {
    return false
  }

  return true
}

/**
 * 商品推荐指数计算执行器
 */
export async function executeProductScoreCalculation(
  task: Task<ProductScoreCalculationTaskData>
): Promise<void> {
  const {
    userId,
    productIds,
    forceRecalculate = false,
    allowWhenPaused = false,
    batchSize = 100,
    includeSeasonalityAnalysis = true,
    trigger = 'manual'
  } = task.data
  const aiRerankTopK = trigger === 'manual'
    ? parsePositiveIntEnv('PRODUCT_SCORE_AI_RERANK_TOP_K_MANUAL', PRODUCT_SCORE_AI_RERANK_TOP_K_MANUAL_DEFAULT)
    : parsePositiveIntEnv('PRODUCT_SCORE_AI_RERANK_TOP_K_BACKGROUND', PRODUCT_SCORE_AI_RERANK_TOP_K_BACKGROUND_DEFAULT)

  console.log(`[ProductScoreCalculation] 开始执行任务 ${task.id}`)
  console.log(`[ProductScoreCalculation] 用户: ${userId}, 触发: ${trigger}, 批次大小: ${batchSize}, aiRerankTopK: ${aiRerankTopK}`)

  const db = await getDatabase()
  const startTime = Date.now()
  const nowSql = nowFunc(db.type)
  const queue = await getQueueManagerForTaskType('product-score-calculation')
  const lockTtlMs = Math.max(queue.getConfig().taskTimeout || 900000, 15 * 60 * 1000) + 5 * 60 * 1000
  const executionMutex = await acquireProductScoreExecutionMutex(userId, task.id, lockTtlMs)

  if (!executionMutex.acquired) {
    await markProductScoreRequeueNeeded(userId, {
      includeSeasonalityAnalysis,
      forceRecalculate,
      allowWhenPaused,
      trigger,
      productIds,
    })
    console.warn(
      `[ProductScoreCalculation] 用户${userId}已有运行中的评分任务，本任务 ${task.id} 跳过并合并`
    )
    return
  }

  const refreshTimer = setInterval(() => {
    executionMutex.refresh().catch((error) => {
      console.warn(
        `[ProductScoreCalculation] 刷新用户${userId}互斥锁失败:`,
        error
      )
    })
  }, Math.max(30_000, Math.floor(lockTtlMs / 3)))
  refreshTimer.unref?.()

  try {
    const paused = await isProductScoreCalculationPaused(userId)
    if (paused && !allowWhenPaused) {
      console.log(`[ProductScoreCalculation] 用户${userId}已暂停推荐指数计算，任务 ${task.id} 直接结束`)
      return
    }

    // 构建查询条件
    let whereClause = 'user_id = ?'
    const params: any[] = [userId]

    if (productIds && productIds.length > 0) {
      // 指定商品ID列表
      const placeholders = productIds.map(() => '?').join(',')
      whereClause += ` AND id IN (${placeholders})`
      params.push(...productIds)
    }

    if (!forceRecalculate) {
      const legacyAmazonMisclassifiedWhere = `(
        NULLIF(TRIM(COALESCE(asin, '')), '') IS NOT NULL
        AND TRIM(COALESCE(product_url, '')) = ''
        AND COALESCE(recommendation_reasons, '') LIKE '%非Amazon落地页,信任度相对较低%'
      )`

      // 默认仅计算未算分或“上次计算已超过30天”的商品，避免重复计算
      if (db.type === 'postgres') {
        whereClause += ` AND (
          recommendation_score IS NULL
          OR score_calculated_at IS NULL
          OR score_calculated_at < (NOW() - INTERVAL '${PRODUCT_SCORE_VALIDITY_DAYS} days')
          OR ${legacyAmazonMisclassifiedWhere}
        )`
      } else {
        whereClause += ` AND (
          recommendation_score IS NULL
          OR score_calculated_at IS NULL
          OR datetime(score_calculated_at) < datetime('now', '-${PRODUCT_SCORE_VALIDITY_DAYS} days')
          OR ${legacyAmazonMisclassifiedWhere}
        )`
      }
    }

    // 查询需要计算的商品
    const products = await db.query<AffiliateProduct>(
      `SELECT * FROM affiliate_products WHERE ${whereClause} LIMIT ?`,
      [...params, batchSize]
    )

    if (products.length === 0) {
      console.log(`[ProductScoreCalculation] 没有需要计算的商品`)
    } else {
      console.log(`[ProductScoreCalculation] 找到${products.length}个商品需要计算`)
    }

    let successCount = 0
    let failedCount = 0
    const failedProducts: Array<{ id: number; error: string }> = []

    if (products.length > 0) {
      const cachedScores = new Map<number, CachedRecommendationScore>()
      const productsToCalculate: AffiliateProduct[] = []

      if (!forceRecalculate) {
        const cachedByProductId = await batchGetCachedProductRecommendationScores(
          userId,
          products.map((product) => product.id)
        )

        for (const product of products) {
          const inputFingerprint = buildProductScoreInputFingerprint(product)
          const cached = cachedByProductId.get(product.id)
          if (cached && isCachedScoreReusable(product, cached, inputFingerprint)) {
            cachedScores.set(product.id, cached)
            continue
          }
          productsToCalculate.push(product)
        }
      } else {
        productsToCalculate.push(...products)
      }

      if (cachedScores.size > 0) {
        console.log(
          `[ProductScoreCalculation] 命中推荐指数缓存 ${cachedScores.size} 个，跳过对应AI计算`
        )
      }

      let hybridResults: Awaited<ReturnType<typeof calculateHybridProductRecommendationScores>> = {
        results: [],
        summary: {
          totalProducts: productsToCalculate.length,
          aiCandidates: 0,
          aiCompleted: 0,
          ruleOnly: productsToCalculate.length,
        },
      }

      if (productsToCalculate.length > 0) {
        hybridResults = await calculateHybridProductRecommendationScores(productsToCalculate, userId, {
          includeSeasonalityAnalysis,
          aiRerankTopK,
        })

        console.log(
          `[ProductScoreCalculation] 混合精排完成: 规则粗排 ${hybridResults.summary.totalProducts}, ` +
          `AI候选 ${hybridResults.summary.aiCandidates}, AI完成 ${hybridResults.summary.aiCompleted}, ` +
          `规则直出 ${hybridResults.summary.ruleOnly}`
        )
      } else {
        console.log('[ProductScoreCalculation] 当前批次全部命中缓存，无需触发AI精排')
      }

      const resultByProductId = new Map(
        hybridResults.results.map((item) => [item.productId, item])
      )

      for (const product of products) {
        const cached = cachedScores.get(product.id)
        if (cached) {
          try {
            const now = new Date().toISOString()
            const inputFingerprint = buildProductScoreInputFingerprint(product)
            await db.exec(
              `UPDATE affiliate_products
               SET recommendation_score = ?,
                   recommendation_reasons = ?,
                   seasonality_score = ?,
                   product_analysis = ?,
                   score_calculated_at = ${nowSql},
                   updated_at = ${nowSql}
               WHERE id = ?`,
              [
                cached.recommendationScore,
                JSON.stringify(cached.recommendationReasons || []),
                cached.seasonalityScore || null,
                cached.productAnalysis ? JSON.stringify(cached.productAnalysis) : null,
                product.id,
              ]
            )

            cacheProductRecommendationScore(userId, product.id, {
              recommendationScore: cached.recommendationScore,
              recommendationReasons: cached.recommendationReasons || [],
              seasonalityScore: cached.seasonalityScore || null,
              productAnalysis: cached.productAnalysis || null,
              scoreCalculatedAt: now,
              inputFingerprint,
              cachedAt: Date.now(),
            }).catch((err) => {
              console.warn(`[ProductScoreCalculation] 刷新缓存商品${product.id}失败:`, err)
            })

            successCount++
            console.log(
              `[ProductScoreCalculation] ✅ 商品${product.id}: ${cached.recommendationScore}星 [缓存复用]`
            )
          } catch (error: any) {
            failedCount++
            failedProducts.push({
              id: product.id,
              error: error.message,
            })
            console.error(`[ProductScoreCalculation] ❌ 商品${product.id}缓存回填失败:`, error.message)
          }
          continue
        }

        const result = resultByProductId.get(product.id)
        if (!result?.score) {
          failedCount++
          failedProducts.push({
            id: product.id,
            error: result?.error || '评分结果为空',
          })
          console.error(
            `[ProductScoreCalculation] ❌ 商品${product.id}计算失败: ${result?.error || '评分结果为空'}`
          )
          continue
        }

        try {
          const score = result.score
          const now = new Date().toISOString()
          const inputFingerprint = buildProductScoreInputFingerprint(product)
          await db.exec(
            `UPDATE affiliate_products
             SET recommendation_score = ?,
                 recommendation_reasons = ?,
                 seasonality_score = ?,
                 seasonality_analysis = ?,
                 product_analysis = ?,
                 score_calculated_at = ${nowSql},
                 updated_at = ${nowSql}
             WHERE id = ?`,
            [
              score.starRating,
              JSON.stringify(score.reasons),
              score.seasonalityAnalysis?.score || null,
              score.seasonalityAnalysis ? JSON.stringify(score.seasonalityAnalysis) : null,
              score.productAnalysis ? JSON.stringify(score.productAnalysis) : null,
              product.id
            ]
          )

          cacheProductRecommendationScore(userId, product.id, {
            recommendationScore: score.starRating,
            recommendationReasons: score.reasons,
            seasonalityScore: score.seasonalityAnalysis?.score || null,
            productAnalysis: score.productAnalysis || null,
            scoreCalculatedAt: now,
            inputFingerprint,
            cachedAt: Date.now()
          }).catch(err => {
            console.warn(`[ProductScoreCalculation] 缓存商品${product.id}失败:`, err)
          })

          successCount++
          console.log(
            `[ProductScoreCalculation] ✅ 商品${product.id}: ${score.starRating}星 (${score.totalScore.toFixed(1)}分)` +
            `${result.usedAI ? ' [AI精排]' : ' [规则粗排]'}`
          )
        } catch (error: any) {
          failedCount++
          failedProducts.push({
            id: product.id,
            error: error.message
          })
          console.error(`[ProductScoreCalculation] ❌ 商品${product.id}计算失败:`, error.message)
        }
      }
    }

    const processingTime = Date.now() - startTime

    console.log(`[ProductScoreCalculation] 任务完成`)
    console.log(`[ProductScoreCalculation] 成功: ${successCount}, 失败: ${failedCount}`)
    console.log(`[ProductScoreCalculation] 耗时: ${(processingTime / 1000).toFixed(2)}秒`)

    if (failedCount > 0) {
      console.warn(`[ProductScoreCalculation] 失败商品列表:`, failedProducts)
    }

    // 续跑机制：无指定 productIds 且非 force 模式下，按批次持续推进，直到清空待计算集合
    const shouldScheduleContinuation = !productIds
      && !forceRecalculate
      && products.length >= batchSize
      && successCount > 0

    const deferredRequest = await consumeProductScoreRequeueRequest(userId)
    const followUpAllowWhenPaused = allowWhenPaused || Boolean(deferredRequest?.allowWhenPaused)
    const pausedBeforeFollowUp = followUpAllowWhenPaused
      ? false
      : await isProductScoreCalculationPaused(userId)
    const shouldScheduleFollowUp = shouldScheduleContinuation || !!deferredRequest

    if (shouldScheduleFollowUp && !pausedBeforeFollowUp) {
      try {
        const existingTask = await findExistingProductScoreTask(queue, userId, task.id)
        if (existingTask && existingTask.status === 'pending') {
          console.log(
            `[ProductScoreCalculation] 已存在后续任务 ${existingTask.id}，跳过重复续跑`
          )
        } else {
          const nextTaskId = await queue.enqueue(
            'product-score-calculation',
            {
              userId,
              forceRecalculate: deferredRequest?.forceFullRescore ?? false,
              allowWhenPaused: followUpAllowWhenPaused,
              batchSize,
              includeSeasonalityAnalysis:
                includeSeasonalityAnalysis || Boolean(deferredRequest?.includeSeasonalityAnalysis),
              trigger: deferredRequest?.trigger || trigger,
            },
            userId,
            {
              priority: 'normal',
            }
          )
          console.log(`[ProductScoreCalculation] 已续跑入队: ${nextTaskId}`)
        }
      } catch (enqueueError: any) {
        await markProductScoreRequeueNeeded(userId, {
          includeSeasonalityAnalysis:
            includeSeasonalityAnalysis || Boolean(deferredRequest?.includeSeasonalityAnalysis),
          forceRecalculate: deferredRequest?.forceFullRescore ?? false,
          allowWhenPaused: followUpAllowWhenPaused,
          trigger: deferredRequest?.trigger || trigger,
        }).catch(() => {})
        console.warn(
          `[ProductScoreCalculation] 续跑任务入队失败: ${enqueueError?.message || enqueueError}`
        )
      }
    } else if (shouldScheduleFollowUp && pausedBeforeFollowUp) {
      console.log(`[ProductScoreCalculation] 用户${userId}已暂停推荐指数计算，跳过续跑入队`)
    }
  } catch (error: any) {
    console.error(`[ProductScoreCalculation] 任务执行失败:`, error)
    throw error
  } finally {
    clearInterval(refreshTimer)
    await executionMutex.release().catch((error) => {
      console.warn(
        `[ProductScoreCalculation] 释放用户${userId}互斥锁失败:`,
        error
      )
    })
  }
}
