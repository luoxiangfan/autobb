/**
 * 商品推荐指数计算调度器
 *
 * 功能
 * 每天凌晨2点自动计算所有商品的推荐指数
 * 监听商品同步完成事件,自动触发评分更新
 */

import { logger } from '@/lib/common/server'
import { getQueueManagerForTaskType } from '../queue-routing'
import type { ProductScoreCalculationTaskData } from '../executors/product-score-calculation-executor'
import {
  findExistingProductScoreTask,
  markProductScoreRequeueNeeded,
} from '@/lib/launch-score/server'
import {
  isProductScoreCalculationPaused,
  ProductScoreCalculationPausedError,
} from '@/lib/launch-score/server'

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
  const canBypassPause =
    paused &&
    options?.allowWhenPaused === true &&
    Array.isArray(options?.productIds) &&
    options.productIds.length > 0

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
    trigger: options?.trigger ?? 'manual',
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

    logger.debug(
      `[ProductScoreScheduler] 用户${userId}已存在任务 ${existingTask.id}，本次请求已合并`
    )
    return existingTask.id
  }

  const taskId = await queue.enqueue('product-score-calculation', taskData, userId, {
    priority: options?.priority ?? 'normal',
  })

  logger.debug(
    `[ProductScoreScheduler] 已调度任务 ${taskId} (用户: ${userId}, 触发: ${taskData.trigger})`
  )

  return taskId
}
