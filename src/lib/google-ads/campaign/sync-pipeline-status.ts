import { getDatabase } from '@/lib/db'
import { utcNowIso } from '@/lib/db'
import {
  getBackgroundQueueManager,
  getQueueManager,
  getQueueManagerForTaskType,
  isBackgroundQueueSplitEnabled,
} from '@/lib/queue'
import type { Task } from '@/lib/queue/types'
import { googleAdsSyncLogger } from '../common/logger'

export const GOOGLE_ADS_CAMPAIGN_SYNC_TASK_TYPE = '@/lib/google-ads/campaign/sync' as const
export const GOOGLE_ADS_CAMPAIGN_SYNC_LOG_TYPE = 'google_ads_campaign_sync' as const

/* * 超过该时长仍为 running 的日志会被自动标为 failed */
const DEFAULT_STALE_RUNNING_LOG_MINUTES = 45
/* * 该时长内的 running 日志视为「仍在同步」，调度器不会重复入队 */
const DEFAULT_ACTIVE_RUNNING_LOG_MINUTES = 30
/* * pending 任务超过该时长仍未 dequeue（无 startedAt）则视为僵尸任务并清理 */
const DEFAULT_STALE_PENDING_SYNC_TASK_MS = 120_000

function parsePositiveIntEnv(raw: string | undefined, defaultValue: number): number {
  if (raw === undefined) return defaultValue
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue
  return parsed
}

function startedAtSqlField(): string {
  return 'started_at::timestamptz'
}

function staleRunningThresholdSql(minutes: number): string {
  return `(CURRENT_TIMESTAMP - INTERVAL '${minutes} minutes')`
}

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
    googleAdsSyncLogger.warn('queue_stats_unavailable', {}, e)
    return { pending: 0, running: 0 }
  }
}

function matchGoogleAdsCampaignSyncTaskForUser(userId: number) {
  return (task: Task) =>
    task.type === GOOGLE_ADS_CAMPAIGN_SYNC_TASK_TYPE && Number(task.userId) === userId
}

async function listGoogleAdsCampaignSyncTasksForUser(
  userId: number
): Promise<{ pending: Task[]; running: Task[] }> {
  const matchUser = matchGoogleAdsCampaignSyncTaskForUser(userId)
  const pending: Task[] = []
  const running: Task[] = []

  const coreQueueManager = getQueueManager()
  await coreQueueManager.ensureInitialized()
  const [corePendingTasks, coreRunningTasks] = await Promise.all([
    coreQueueManager.getPendingTasksForType(GOOGLE_ADS_CAMPAIGN_SYNC_TASK_TYPE),
    coreQueueManager.getRunningTasks(),
  ])
  pending.push(...corePendingTasks.filter((t) => matchUser(t) && t.status === 'pending'))
  running.push(...coreRunningTasks.filter((t) => matchUser(t) && t.status === 'running'))

  if (isBackgroundQueueSplitEnabled()) {
    const backgroundQueueManager = getBackgroundQueueManager()
    await backgroundQueueManager.ensureInitialized()
    const [bgPendingTasks, bgRunningTasks] = await Promise.all([
      backgroundQueueManager.getPendingTasksForType(GOOGLE_ADS_CAMPAIGN_SYNC_TASK_TYPE),
      backgroundQueueManager.getRunningTasks(),
    ])
    pending.push(...bgPendingTasks.filter((t) => matchUser(t) && t.status === 'pending'))
    running.push(...bgRunningTasks.filter((t) => matchUser(t) && t.status === 'running'))
  }

  return { pending, running }
}

/**
 * 指定用户在 core + background 队列中的 google-ads-campaign-sync 待处理/执行中任务数。
 */
export async function getGoogleAdsCampaignSyncQueueCountsForUser(
  userId: number
): Promise<{ pending: number; running: number }> {
  try {
    const { pending, running } = await listGoogleAdsCampaignSyncTasksForUser(userId)
    return { pending: pending.length, running: running.length }
  } catch (e) {
    googleAdsSyncLogger.warn('queue_stats_unavailable_for_user', { userId }, e)
    return { pending: 0, running: 0 }
  }
}

async function removeGoogleAdsCampaignSyncTaskFromQueues(taskId: string): Promise<boolean> {
  let removed = false
  const coreQueueManager = getQueueManager()
  await coreQueueManager.ensureInitialized()
  if (await coreQueueManager.removeTask(taskId)) {
    removed = true
  }
  if (isBackgroundQueueSplitEnabled()) {
    const backgroundQueueManager = getBackgroundQueueManager()
    await backgroundQueueManager.ensureInitialized()
    if (await backgroundQueueManager.removeTask(taskId)) {
      removed = true
    }
  }
  return removed
}

/**
 * 移除已被 sync_logs 覆盖或长期未执行的 pending 同步任务（重复入队 / Worker 未消费残留）。
 * 仅在该用户无 running 队列任务且无 running 日志时执行。
 */
export async function reconcileStaleGoogleAdsCampaignSyncPendingTasks(
  userId: number
): Promise<{ removed: number }> {
  const { running } = await getGoogleAdsCampaignSyncQueueCountsForUser(userId)
  if (running > 0) {
    return { removed: 0 }
  }

  const db = await getDatabase()
  const startedAtField = startedAtSqlField()
  const activeLogThreshold = staleRunningThresholdSql(
    parsePositiveIntEnv(
      process.env.GOOGLE_ADS_SYNC_LOG_ACTIVE_MINUTES,
      DEFAULT_ACTIVE_RUNNING_LOG_MINUTES
    )
  )

  const runningLog = (await db.queryOne(
    `
      SELECT id
      FROM sync_logs
      WHERE user_id = ?
        AND sync_type = ?
        AND status = 'running'
        AND ${startedAtField} >= ${activeLogThreshold}
      LIMIT 1
    `,
    [userId, GOOGLE_ADS_CAMPAIGN_SYNC_LOG_TYPE]
  )) as { id: number } | null

  if (runningLog) {
    return { removed: 0 }
  }

  const lastCompleted = (await db.queryOne(
    `
      SELECT completed_at
      FROM sync_logs
      WHERE user_id = ?
        AND sync_type = ?
        AND status IN ('success', 'partial', 'failed')
        AND completed_at IS NOT NULL
      ORDER BY completed_at DESC
      LIMIT 1
    `,
    [userId, GOOGLE_ADS_CAMPAIGN_SYNC_LOG_TYPE]
  )) as { completed_at: string } | null

  const completedAtMs = lastCompleted?.completed_at
    ? Date.parse(lastCompleted.completed_at)
    : Number.NaN
  const hasValidCompletedAt = Number.isFinite(completedAtMs)

  const stalePendingMs = parsePositiveIntEnv(
    process.env.GOOGLE_ADS_SYNC_STALE_PENDING_MS,
    DEFAULT_STALE_PENDING_SYNC_TASK_MS
  )
  const now = Date.now()

  const { pending } = await listGoogleAdsCampaignSyncTasksForUser(userId)
  if (pending.length === 0) {
    return { removed: 0 }
  }

  let removed = 0
  for (const task of pending) {
    const supersededByCompletedLog = hasValidCompletedAt && completedAtMs >= task.createdAt
    const neverStartedStale = !task.startedAt && now - task.createdAt >= stalePendingMs
    if (!supersededByCompletedLog && !neverStartedStale) {
      continue
    }
    if (await removeGoogleAdsCampaignSyncTaskFromQueues(task.id)) {
      removed++
    }
  }

  if (removed > 0) {
    googleAdsSyncLogger.info('reconciled_stale_pending_sync_tasks', {
      userId,
      removed,
      stalePendingMs,
    })
  }

  return { removed }
}

/**
 * 用户是否仍有进行中的 Google Ads 广告系列同步（队列任务或近期 sync_logs running）。
 */
export async function userHasActiveGoogleAdsCampaignSyncWork(userId: number): Promise<{
  active: boolean
  reason?: 'queue' | 'sync_log'
  pending: number
  running: number
}> {
  const { pending, running } = await getGoogleAdsCampaignSyncQueueCountsForUser(userId)
  if (pending + running > 0) {
    return { active: true, reason: 'queue', pending, running }
  }

  const db = await getDatabase()
  const startedAtField = startedAtSqlField()
  const activeLogThreshold = staleRunningThresholdSql(
    parsePositiveIntEnv(
      process.env.GOOGLE_ADS_SYNC_LOG_ACTIVE_MINUTES,
      DEFAULT_ACTIVE_RUNNING_LOG_MINUTES
    )
  )

  const runningLog = (await db.queryOne(
    `
      SELECT id
      FROM sync_logs
      WHERE user_id = ?
        AND sync_type = ?
        AND status = 'running'
        AND ${startedAtField} >= ${activeLogThreshold}
      LIMIT 1
    `,
    [userId, GOOGLE_ADS_CAMPAIGN_SYNC_LOG_TYPE]
  )) as { id: number } | null

  if (runningLog) {
    return { active: true, reason: 'sync_log', pending, running }
  }

  return { active: false, pending, running }
}

/**
 * 将长时间未结束的 running 同步日志标记为 failed，避免调度器与 UI 长期误判为进行中。
 */
export async function markStaleGoogleAdsCampaignSyncLogs(options?: {
  userId?: number
  staleMinutes?: number
}): Promise<number> {
  const db = await getDatabase()
  const staleMinutes =
    options?.staleMinutes ??
    parsePositiveIntEnv(
      process.env.GOOGLE_ADS_SYNC_LOG_STALE_MINUTES,
      DEFAULT_STALE_RUNNING_LOG_MINUTES
    )
  const startedAtField = startedAtSqlField()
  const threshold = staleRunningThresholdSql(staleMinutes)
  const completedAt = utcNowIso()
  const errorMessage = '同步未正常结束（超时自动关闭）'

  const durationExpr = `CAST(EXTRACT(EPOCH FROM (NOW() - ${startedAtField})) * 1000 AS INTEGER)`

  const params: unknown[] = [completedAt, errorMessage, GOOGLE_ADS_CAMPAIGN_SYNC_LOG_TYPE]
  let userFilter = ''
  if (options?.userId !== undefined) {
    userFilter = ' AND user_id = ?'
    params.push(options.userId)
  }

  const result = await db.exec(
    `
      UPDATE sync_logs
      SET status = 'failed',
          completed_at = ?,
          error_message = ?,
          duration_ms = ${durationExpr}
      WHERE status = 'running'
        AND sync_type = ?
        AND ${startedAtField} < ${threshold}
        ${userFilter}
    `,
    params
  )

  return result.changes ?? 0
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
  const logBusy = await hasGlobalGoogleAdsCampaignSyncRunningLog()
  const busy = pending + running > 0 || logBusy

  return { busy, pending, running }
}

/**
 * 指定用户的 Google Ads 广告系列同步管线是否仍忙（供 status-v2 / SSE 使用）。
 */
export async function getGoogleAdsCampaignSyncPipelineSnapshotForUser(userId: number): Promise<{
  busy: boolean
  pending: number
  running: number
}> {
  await reconcileStaleGoogleAdsCampaignSyncPendingTasks(userId)
  const { pending, running } = await getGoogleAdsCampaignSyncQueueCountsForUser(userId)
  const logBusy = await hasUserGoogleAdsCampaignSyncRunningLog(userId)
  const busy = pending + running > 0 || logBusy

  return { busy, pending, running }
}

async function hasGlobalGoogleAdsCampaignSyncRunningLog(): Promise<boolean> {
  const db = await getDatabase()
  const startedAtField = startedAtSqlField()
  const timeThreshold = staleRunningThresholdSql(30)

  const runningSync = (await db.queryOne(
    `
      SELECT sync_type
      FROM sync_logs
      WHERE status = 'running'
        AND sync_type = ?
        AND ${startedAtField} >= ${timeThreshold}
      ORDER BY ${startedAtField} DESC
      LIMIT 1
    `,
    [GOOGLE_ADS_CAMPAIGN_SYNC_LOG_TYPE]
  )) as { sync_type: string } | null

  return runningSync?.sync_type === GOOGLE_ADS_CAMPAIGN_SYNC_LOG_TYPE
}

async function hasUserGoogleAdsCampaignSyncRunningLog(userId: number): Promise<boolean> {
  const db = await getDatabase()
  const startedAtField = startedAtSqlField()
  const timeThreshold = staleRunningThresholdSql(
    parsePositiveIntEnv(
      process.env.GOOGLE_ADS_SYNC_LOG_ACTIVE_MINUTES,
      DEFAULT_ACTIVE_RUNNING_LOG_MINUTES
    )
  )

  const runningSync = (await db.queryOne(
    `
      SELECT id
      FROM sync_logs
      WHERE user_id = ?
        AND sync_type = ?
        AND status = 'running'
        AND ${startedAtField} >= ${timeThreshold}
      LIMIT 1
    `,
    [userId, GOOGLE_ADS_CAMPAIGN_SYNC_LOG_TYPE]
  )) as { id: number } | null

  return Boolean(runningSync)
}

/* * 为指定用户入队 Google Ads 广告系列同步（手动触发入口复用） */
export async function enqueueGoogleAdsCampaignSyncForUser(
  userId: number,
  options: {
    syncType?: 'manual' | 'auto'
    customerId?: string
    dryRun?: boolean
  } = {}
): Promise<string> {
  const queue = getQueueManagerForTaskType(GOOGLE_ADS_CAMPAIGN_SYNC_TASK_TYPE)
  const taskId = await queue.enqueue(
    GOOGLE_ADS_CAMPAIGN_SYNC_TASK_TYPE,
    {
      userId,
      syncType: options.syncType || 'manual',
      customerId: options.customerId,
      dryRun: options.dryRun,
    },
    userId,
    {
      priority: options.syncType === 'auto' ? 'normal' : 'high',
      maxRetries: 3,
    }
  )
  return taskId
}
