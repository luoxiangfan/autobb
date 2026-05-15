import { getDatabase } from '@/lib/db'
import {
  getBackgroundQueueManager,
  getQueueManager,
  isBackgroundQueueSplitEnabled,
} from '@/lib/queue'

export const GOOGLE_ADS_CAMPAIGN_SYNC_TASK_TYPE = 'google-ads-campaign-sync' as const

/**
 * 合并 core + background 队列中 google-ads-campaign-sync 的待处理与执行中数量。
 * pending 来自各队列 pending 索引（与 getStats().byType 不同：后者含已完成未清理任务）。
 */
export async function getGoogleAdsCampaignSyncQueueCounts(): Promise<{
  pending: number
  running: number
}> {
  try {
    const coreQueueManager = getQueueManager()
    await coreQueueManager.ensureInitialized()
    const [corePendingTasks, coreStats] = await Promise.all([
      coreQueueManager.getPendingTasksForType(GOOGLE_ADS_CAMPAIGN_SYNC_TASK_TYPE),
      coreQueueManager.getStats(),
    ])
    let pending = corePendingTasks.filter((t) => t.status === 'pending').length
    let running = coreStats.byTypeRunning?.[GOOGLE_ADS_CAMPAIGN_SYNC_TASK_TYPE] ?? 0

    if (isBackgroundQueueSplitEnabled()) {
      const backgroundQueueManager = getBackgroundQueueManager()
      await backgroundQueueManager.ensureInitialized()
      const [bgPendingTasks, bgStats] = await Promise.all([
        backgroundQueueManager.getPendingTasksForType(GOOGLE_ADS_CAMPAIGN_SYNC_TASK_TYPE),
        backgroundQueueManager.getStats(),
      ])
      pending += bgPendingTasks.filter((t) => t.status === 'pending').length
      running += bgStats.byTypeRunning?.[GOOGLE_ADS_CAMPAIGN_SYNC_TASK_TYPE] ?? 0
    }

    return { pending, running }
  } catch (e) {
    console.warn('[google-ads-campaign-sync-pipeline] queue stats unavailable:', e)
    return { pending: 0, running: 0 }
  }
}

/**
 * 全局「Google Ads 广告系列同步管线」是否仍忙（队列 + 任意用户 sync_logs running）
 */
export async function getGoogleAdsCampaignSyncPipelineSnapshot(): Promise<{
  busy: boolean
  pending: number
  running: number
}> {
  const { pending, running } = await getGoogleAdsCampaignSyncQueueCounts()
  const db = await getDatabase()

  const runningCheck = "status = 'running'"
  const timeThreshold =
    db.type === 'postgres'
      ? "(CURRENT_TIMESTAMP - INTERVAL '30 minutes')"
      : "datetime('now', '-30 minutes')"
  const startedAtField =
    db.type === 'postgres' ? 'started_at::timestamptz' : 'started_at'

  const runningSync = (await db.queryOne(
    `
      SELECT sync_type
      FROM sync_logs
      WHERE ${runningCheck}
        AND ${startedAtField} >= ${timeThreshold}
      ORDER BY ${startedAtField} DESC
      LIMIT 1
    `
  )) as { sync_type: string } | null

  const logBusy = runningSync?.sync_type === 'google_ads_campaign_sync'
  const busy = pending + running > 0 || logBusy

  return { busy, pending, running }
}
