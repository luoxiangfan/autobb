/**
 * Google Ads 广告系列同步任务执行器
 *
 * 负责执行从队列中获取的同步任务
 * 调用同步服务实际执行同步逻辑
 */

import { getDatabase } from '../../db'
import type { Task } from '../types'
import { syncCampaignsFromGoogleAds } from '../../google-ads-campaign-sync'
import { createRiskAlert } from '../../risk-alerts'

/**
 * Google Ads 广告系列同步任务数据
 */
export interface GoogleAdsCampaignSyncTaskData {
  userId: number
  syncType: 'manual' | 'auto'
  customerId?: string
  dryRun?: boolean
}

/**
 * 执行 Google Ads 广告系列同步任务
 */
export async function executeGoogleAdsCampaignSyncTask(
  task: Task<GoogleAdsCampaignSyncTaskData>
): Promise<{
  success: boolean
  syncedCount: number
  createdOffersCount: number
  skippedOffersCount: number
  error?: string
}> {
  const startTime = Date.now()
  const startedAt = new Date().toISOString()
  // const { userId, syncType, customerId, dryRun } = taskData
  const { id: taskId, data: taskData, userId } = task
  const { syncType, customerId, dryRun } = taskData
  let syncLogId: number | null = null
  
  console.log(
    `▶️  [GoogleAdsSyncExecutor] 开始执行同步任务：${taskId}, 用户 #${userId}, 类型：${syncType}`
  )

  const db = await getDatabase()

  try {
    // 🔧 优化：同步开始时写入 running 状态的记录
    try {
      const logResult = await db.exec(
        `INSERT INTO sync_logs (user_id, sync_type, status, record_count, duration_ms, started_at, completed_at, is_manual)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, 'google_ads_campaign_sync', 'running', 0, 0, startedAt, null, false]  // is_manual=false（自动触发）
      )
      // 🔧 获取插入的 ID（支持 PostgreSQL 和 SQLite）
      syncLogId = logResult.lastInsertRowid || null
      console.log(`📝 [GoogleAdsSyncExecutor] 创建同步日志记录 ID: ${syncLogId}`)
    } catch (logError) {
      console.error(`❌ [GoogleAdsSyncExecutor] 创建初始同步日志失败:`, logError)
    }

    // 1. 执行同步
    const result = await syncCampaignsFromGoogleAds(userId, {
      customerId,
      dryRun,
    })

    const duration = Date.now() - startTime
    const completedAt = new Date().toISOString()

    // 🔧 优化：同步完成后更新记录（而不是插入新记录）
    if (syncLogId !== null) {
      try {
        await db.exec(
          `UPDATE sync_logs 
           SET status = ?, 
               record_count = ?, 
               duration_ms = ?, 
               completed_at = ?
           WHERE id = ?`,
          [result.errors.length > 0 ? 'partial' : 'success', result.syncedCount, duration, completedAt, syncLogId]
        )
        console.log(`📝 [GoogleAdsSyncExecutor] 更新同步日志记录 ID: ${syncLogId}`)
      } catch (logError) {
        console.error(`❌ [GoogleAdsSyncExecutor] 更新同步日志失败:`, logError)
      }
    } else {
      // 兜底：如果没有获取到 ID，则插入新记录（保持原有逻辑）
      try {
        await db.exec(
          `INSERT INTO sync_logs (user_id, sync_type, status, record_count, duration_ms, started_at, completed_at, is_manual)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [userId, 'google_ads_campaign_sync', result.errors.length > 0 ? 'partial' : 'success', 
           result.syncedCount, duration, startedAt, completedAt, false]  // is_manual=false
        )
        console.log(`📝 [GoogleAdsSyncExecutor] 同步日志已记录（fallback）：${taskId}`)
      } catch (logError) {
        console.error(`❌ [GoogleAdsSyncExecutor] 记录同步日志失败:`, logError)
      }
    }

    // 3. 如果有错误，创建风险预警
    if (result.errors.length > 0) {
      try {
        const errorMessage = result.errors
          .slice(0, 3)
          .map(e => `${e.campaignName}: ${e.error}`)
          .join('; ')

        await createRiskAlert(
          userId,
          'google_ads_sync_failed',
          'warning',
          `Google Ads 广告系列同步失败 (${result.errors.length}个错误)`,
          errorMessage,
          {
            resourceType: 'campaign',
            resourceId: undefined,
          }
        )
        console.log(`⚠️  [GoogleAdsSyncExecutor] 风险预警已创建：${taskId}`)
      } catch (alertError) {
        console.error(`❌ [GoogleAdsSyncExecutor] 创建风险预警失败:`, alertError)
      }
    }

    // 4. 输出统计信息
    console.log(
      `✅ [GoogleAdsSyncExecutor] 同步任务完成：${taskId}`,
      {
        duration: `${duration}ms`,
        synced: result.syncedCount,
        created: result.createdOffersCount,
        updated: result.updatedOffersCount,
        skipped: result.skippedOffersCount,
        errors: result.errors.length,
      }
    )

    return {
      success: result.errors.length === 0,
      syncedCount: result.syncedCount,
      createdOffersCount: result.createdOffersCount,
      skippedOffersCount: result.skippedOffersCount,
    }
  } catch (error: any) {
    const duration = Date.now() - startTime
    const completedAt = new Date().toISOString()
    const errorMessage = error.message || '未知错误'

    console.error(
      `❌ [GoogleAdsSyncExecutor] 同步任务失败：${taskId}`,
      error
    )

    // 🔧 优化：同步失败时更新记录
    if (syncLogId !== null) {
      try {
        await db.exec(
          `UPDATE sync_logs 
           SET status = ?, 
               record_count = ?, 
               duration_ms = ?, 
               completed_at = ?,
               error_message = ?
           WHERE id = ?`,
          ['failed', 0, duration, completedAt, errorMessage, syncLogId]
        )
        console.log(`📝 [GoogleAdsSyncExecutor] 更新同步日志记录 ID: ${syncLogId} (failed)`);
      } catch (logError) {
        console.error(`❌ [GoogleAdsSyncExecutor] 更新同步日志失败:`, logError)
      }
    } else {
      // 兜底：如果没有获取到 ID，则插入新记录（保持原有逻辑）
      try {
        await db.exec(
          `INSERT INTO sync_logs (user_id, sync_type, status, record_count, duration_ms, started_at, completed_at, is_manual)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [userId, 'google_ads_campaign_sync', 'failed', 0, duration, startedAt, completedAt, false]  // is_manual=false
        )
      } catch (logError) {
        console.error(`❌ [GoogleAdsSyncExecutor] 记录失败日志失败:`, logError)
      }
    }

    // 创建风险预警
    try {
      await createRiskAlert(
        userId,
        'google_ads_sync_failed',
        'warning',
        'Google Ads 广告系列同步失败',
        errorMessage,
        {
          resourceType: 'campaign',
          resourceId: undefined,
        }
      )
    } catch (alertError) {
      console.error(`❌ [GoogleAdsSyncExecutor] 创建风险预警失败:`, alertError)
    }

    return {
      success: false,
      syncedCount: 0,
      createdOffersCount: 0,
      skippedOffersCount: 0,
      error: errorMessage,
    }
  }
}
