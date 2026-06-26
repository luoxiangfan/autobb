/**
 * Sync 任务执行器
 *
 * 负责执行Google Ads数据同步任务，包括
 * 从Google Ads API拉取性能数据
 * 存储到 PostgreSQL
 * 自动重试机制
 * 任务状态追踪
 *
 * 替换原有的 SyncScheduler
 * 优势：支持并发控制、任务恢复、失败重试
 */

import { logger } from '@/lib/common/server'
import type { Task, TaskExecutor } from '../types'
import { dataSyncService } from '@/lib/campaign/server'
import type { SyncLog } from '@/lib/campaign/server'
import { assertUserExecutionAllowed } from '@/lib/campaign/server'

/**
 * Sync 任务数据接口
 */
export interface SyncTaskData {
  userId: number
  syncType: 'manual' | 'auto'
  googleAdsAccountId?: number // 可选，指定特定账户
  startDate?: string // 可选，同步开始日期（YYYY-MM-DD）
  endDate?: string // 可选，同步结束日期（YYYY-MM-DD）
}

/**
 * 创建 Sync 任务执行器
 */
export function createSyncExecutor(): TaskExecutor<SyncTaskData> {
  return async (task: Task<SyncTaskData>) => {
    const { userId, syncType, googleAdsAccountId, startDate, endDate } = task.data

    logger.debug(`🔄 [SyncExecutor] 开始同步任务: 用户 #${userId}, 类型: ${syncType}`)
    logger.debug(
      `   账户ID: ${googleAdsAccountId || '全部'}, 期间: ${startDate || '默认'} - ${endDate || '默认'}`
    )

    try {
      await assertUserExecutionAllowed(userId, { source: `sync:${task.id}` })

      // 调用现有的数据同步服务
      // 注意：现有服务会处理所有账户的同步，不需要传入特定账户ID
      const syncLog: SyncLog = await dataSyncService.syncPerformanceData(userId, syncType)

      logger.debug(
        `✅ [SyncExecutor] 同步任务完成: 用户 #${userId}, 记录数: ${syncLog.recordCount}, 耗时: ${syncLog.durationMs}ms`
      )

      return syncLog
    } catch (error: any) {
      console.error(`❌ [SyncExecutor] 同步任务失败: 用户 #${userId}`, error.message)
      throw error
    }
  }
}
