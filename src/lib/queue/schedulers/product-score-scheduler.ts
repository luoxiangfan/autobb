/**
 * 商品推荐指数计算调度器
 *
 * 功能:
 * - 每天凌晨2点自动计算所有商品的推荐指数
 * - 监听商品同步完成事件,自动触发评分更新
 */

import { getQueueManagerForTaskType } from '../queue-routing'
import type { ProductScoreCalculationTaskData } from '../executors/product-score-calculation-executor'
import {
  findExistingProductScoreTask,
  markProductScoreRequeueNeeded,
} from '@/lib/product-score-coordination'
import {
  isProductScoreCalculationPaused,
  ProductScoreCalculationPausedError,
} from '@/lib/product-score-control'

/**
 * 调度商品推荐指数计算任务
 *
 * @param userId 用户ID
 * @param options 调度选项
 */
export async function scheduleProductScoreCalculation(
  userId: number,
  options?: {
    productIds?: number[]
    forceRecalculate?: boolean
    allowWhenPaused?: boolean
    batchSize?: number
    includeSeasonalityAnalysis?: boolean
    trigger?: 'manual' | 'schedule' | 'sync-complete'
    priority?: 'high' | 'normal' | 'low'
  }
): Promise<string> {
  const paused = await isProductScoreCalculationPaused(userId)
  const canBypassPause = paused
    && options?.allowWhenPaused === true
    && Array.isArray(options?.productIds)
    && options.productIds.length > 0

  if (paused && !canBypassPause) {
    throw new ProductScoreCalculationPausedError('推荐指数计算已暂停，暂不接收新任务')
  }

  const queue = await getQueueManagerForTaskType('product-score-calculation')
  const taskData: ProductScoreCalculationTaskData = {
    userId,
    productIds: options?.productIds,
    forceRecalculate: options?.forceRecalculate ?? false,
    allowWhenPaused: canBypassPause,
    batchSize: options?.batchSize ?? 100,
    includeSeasonalityAnalysis: options?.includeSeasonalityAnalysis ?? true,
    trigger: options?.trigger ?? 'manual'
  }

  const existingTask = await findExistingProductScoreTask(queue, userId)
  if (existingTask) {
    if (existingTask.status === 'running') {
      await markProductScoreRequeueNeeded(userId, {
        includeSeasonalityAnalysis: taskData.includeSeasonalityAnalysis,
        forceRecalculate: taskData.forceRecalculate,
        allowWhenPaused: taskData.allowWhenPaused,
        trigger: taskData.trigger,
        productIds: taskData.productIds,
      })
    }

    console.log(
      `[ProductScoreScheduler] 用户${userId}已存在任务 ${existingTask.id}，本次请求已合并`
    )
    return existingTask.id
  }

  const taskId = await queue.enqueue(
    'product-score-calculation',
    taskData,
    userId,
    {
      priority: options?.priority ?? 'normal'
    }
  )

  console.log(`[ProductScoreScheduler] 已调度任务 ${taskId} (用户: ${userId}, 触发: ${taskData.trigger})`)

  return taskId
}

/**
 * 批量调度多个用户的商品推荐指数计算
 *
 * @param userIds 用户ID列表
 * @param options 调度选项
 */
export async function scheduleProductScoreCalculationForUsers(
  userIds: number[],
  options?: {
    forceRecalculate?: boolean
    batchSize?: number
    includeSeasonalityAnalysis?: boolean
    trigger?: 'manual' | 'schedule' | 'sync-complete'
  }
): Promise<string[]> {
  const taskIds: string[] = []

  for (const userId of userIds) {
    try {
      const taskId = await scheduleProductScoreCalculation(userId, options)
      taskIds.push(taskId)
    } catch (error) {
      console.error(`[ProductScoreScheduler] 调度用户${userId}的任务失败:`, error)
    }
  }

  return taskIds
}

/**
 * 定时任务: 每天凌晨2点自动计算所有用户的商品推荐指数
 *
 * 使用方法:
 * 1. 在cron系统中配置: 0 2 * * * (每天凌晨2点)
 * 2. 或在init-queue.ts中注册定时任务
 */
export async function scheduleDailyProductScoreCalculation(): Promise<void> {
  console.log('[ProductScoreScheduler] 开始每日商品推荐指数计算任务')

  try {
    // 查询所有启用商品管理功能的用户
    const { getDatabase } = await import('@/lib/db')
    const db = await getDatabase()

    // 查询有商品数据的用户
    const users = await db.query<{ user_id: number; product_count: number }>(
      `SELECT user_id, COUNT(*) as product_count
       FROM affiliate_products
       GROUP BY user_id
       HAVING product_count > 0`
    )

    console.log(`[ProductScoreScheduler] 找到${users.length}个用户需要计算`)

    // 批量调度任务
    const taskIds = await scheduleProductScoreCalculationForUsers(
      users.map((u: any) => u.user_id),
      {
        forceRecalculate: false, // 只计算未计算过的商品
        batchSize: 100,
        includeSeasonalityAnalysis: true,
        trigger: 'schedule'
      }
    )

    console.log(`[ProductScoreScheduler] 已调度${taskIds.length}个任务`)
  } catch (error) {
    console.error('[ProductScoreScheduler] 每日任务调度失败:', error)
    throw error
  }
}

/**
 * 商品同步完成后触发评分计算
 *
 * @param userId 用户ID
 * @param syncedProductIds 同步的商品ID列表(可选)
 */
export async function scheduleProductScoreAfterSync(
  userId: number,
  syncedProductIds?: number[]
): Promise<string> {
  console.log(`[ProductScoreScheduler] 商品同步完成,触发评分计算 (用户: ${userId})`)

  return await scheduleProductScoreCalculation(userId, {
    productIds: syncedProductIds,
    forceRecalculate: true, // 同步后强制重新计算
    batchSize: 100,
    includeSeasonalityAnalysis: true,
    trigger: 'sync-complete',
    priority: 'normal'
  })
}
