/**
 * Google Ads 广告系列同步任务执行器
 *
 * 负责执行从队列中获取的同步任务
 * 调用同步服务实际执行同步逻辑
 */

import { getDatabase } from '../../db'
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
  taskId: string,
  taskData: GoogleAdsCampaignSyncTaskData
): Promise<{
  success: boolean
  syncedCount: number
  createdOffersCount: number
  skippedOffersCount: number
  error?: string
}> {
  const startTime = Date.now()
  const { userId, syncType, customerId, dryRun } = taskData

  console.log(
    `▶️  [GoogleAdsSyncExecutor] 开始执行同步任务：${taskId}, 用户 #${userId}, 类型：${syncType}`
  )

  const db = await getDatabase()

  try {
    // 1. 执行同步
    const result = await syncCampaignsFromGoogleAds(userId, {
      customerId,
      dryRun,
    })

    const duration = Date.now() - startTime

    // 2. 记录同步日志
    try {
      await db.exec(
        `INSERT INTO sync_logs (user_id, sync_type, status, record_count, duration_ms, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, 'google_ads_campaign_sync', result.errors.length > 0 ? 'partial' : 'success', 
         result.syncedCount, duration, new Date().toISOString(), new Date().toISOString()]
      )
      console.log(`📝 [GoogleAdsSyncExecutor] 同步日志已记录：${taskId}`)
    } catch (logError) {
      console.error(`❌ [GoogleAdsSyncExecutor] 记录同步日志失败:`, logError)
    }

    // 3. 如果有错误，创建风险预警
    if (result.errors.length > 0) {
      try {
        const errorMessage = result.errors
          .slice(0, 3)
          .map(e => `${e.campaignName}: ${e.error}`)
          .join('; ')

        await createRiskAlert({
          userId,
          alertType: 'google_ads_sync_failed',
          severity: result.errors.length > 5 ? 'high' : 'medium',
          title: `Google Ads 广告系列同步失败 (${result.errors.length}个错误)`,
          message: errorMessage,
          resourceType: 'google_ads_account',
          resourceId: null,
        })
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
    const errorMessage = error.message || '未知错误'

    console.error(
      `❌ [GoogleAdsSyncExecutor] 同步任务失败：${taskId}`,
      error
    )

    // 记录失败日志
    try {
      await db.exec(
        `INSERT INTO sync_logs (user_id, sync_type, status, record_count, duration_ms, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, 'google_ads_campaign_sync', 'failed', 0, duration, new Date().toISOString(), new Date().toISOString()]
      )
    } catch (logError) {
      console.error(`❌ [GoogleAdsSyncExecutor] 记录失败日志失败:`, logError)
    }

    // 创建风险预警
    try {
      await createRiskAlert({
        userId,
        alertType: 'google_ads_sync_failed',
        severity: 'high',
        title: 'Google Ads 广告系列同步失败',
        message: errorMessage,
        resourceType: 'google_ads_account',
        resourceId: null,
      })
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
