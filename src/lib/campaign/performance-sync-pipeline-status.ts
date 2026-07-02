import { getDatabase } from '@/lib/db'
import { utcNowIso } from '@/lib/db'
import { getQueueManager } from '@/lib/queue'
import type { Task } from '@/lib/queue/types'
import { logger } from '@/lib/common/server'

export const PERFORMANCE_SYNC_TASK_TYPE = 'sync' as const
export const PERFORMANCE_SYNC_LOG_TYPES = ['auto', 'manual'] as const

const DEFAULT_STALE_RUNNING_LOG_MINUTES = 45
const DEFAULT_ACTIVE_RUNNING_LOG_MINUTES = 30
// Scheduler 默认每 5 分钟检查一次；pending 未消费阈值须明显长于检查周期，避免反复清队再入队
const DEFAULT_STALE_PENDING_SYNC_TASK_MS = 30 * 60 * 1000

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

function performanceSyncLogTypeSql(): string {
  return "sync_type IN ('auto', 'manual')"
}

function matchPerformanceSyncTaskForUser(userId: number) {
  return (task: Task) => task.type === PERFORMANCE_SYNC_TASK_TYPE && Number(task.userId) === userId
}

async function listPerformanceSyncTasksForUser(
  userId: number
): Promise<{ pending: Task[]; running: Task[] }> {
  const matchUser = matchPerformanceSyncTaskForUser(userId)
  const coreQueueManager = getQueueManager()
  await coreQueueManager.ensureInitialized()
  const [corePendingTasks, coreRunningTasks] = await Promise.all([
    coreQueueManager.getPendingTasksForType(PERFORMANCE_SYNC_TASK_TYPE),
    coreQueueManager.getRunningTasks(),
  ])

  return {
    pending: corePendingTasks.filter((t) => matchUser(t) && t.status === 'pending'),
    running: coreRunningTasks.filter((t) => matchUser(t) && t.status === 'running'),
  }
}

export async function getPerformanceSyncQueueCountsForUser(
  userId: number
): Promise<{ pending: number; running: number }> {
  try {
    const { pending, running } = await listPerformanceSyncTasksForUser(userId)
    return { pending: pending.length, running: running.length }
  } catch (error) {
    logger.warn('[performance-sync] queue_stats_unavailable_for_user', { userId, error })
    return { pending: 0, running: 0 }
  }
}

async function removePerformanceSyncTaskFromQueue(taskId: string): Promise<boolean> {
  const coreQueueManager = getQueueManager()
  await coreQueueManager.ensureInitialized()
  return coreQueueManager.removeTask(taskId)
}

/**
 * 移除已被 sync_logs 覆盖或长期未执行的 pending 性能同步任务（Scheduler 重复入队 / Web Worker 未消费残留）。
 * 仅在该用户无 running 队列任务且无近期 running 日志时执行。
 */
async function getLastAutoPerformanceSyncCompletedMs(userId: number): Promise<number | null> {
  const db = await getDatabase()
  const lastCompleted = (await db.queryOne(
    `
      SELECT completed_at
      FROM sync_logs
      WHERE user_id = ?
        AND sync_type = 'auto'
        AND status IN ('success', 'partial')
        AND completed_at IS NOT NULL
      ORDER BY completed_at DESC
      LIMIT 1
    `,
    [userId]
  )) as { completed_at: string } | null

  if (!lastCompleted?.completed_at) {
    return null
  }

  const completedAtMs = Date.parse(lastCompleted.completed_at)
  return Number.isFinite(completedAtMs) ? completedAtMs : null
}

/**
 * 调度间隔锚点：上次 auto 成功完成时间与队列中 sync 任务（pending/running）时间的较晚者。
 * 用于 settings 中的 data_sync_interval_hours，避免仅看 completed_at 时在 Web 未消费队列任务的情况下重复入队。
 */
export async function getPerformanceSyncIntervalAnchorMs(userId: number): Promise<number | null> {
  const anchors: number[] = []

  const completedMs = await getLastAutoPerformanceSyncCompletedMs(userId)
  if (completedMs !== null) {
    anchors.push(completedMs)
  }

  const { pending, running } = await listPerformanceSyncTasksForUser(userId)
  for (const task of [...pending, ...running]) {
    const taskMs = task.startedAt ?? task.createdAt
    if (Number.isFinite(taskMs) && taskMs > 0) {
      anchors.push(taskMs)
    }
  }

  return anchors.length > 0 ? Math.max(...anchors) : null
}

export async function reconcileStalePerformanceSyncPendingTasks(
  userId: number,
  options?: { minStaleMs?: number }
): Promise<{ removed: number }> {
  const { running } = await getPerformanceSyncQueueCountsForUser(userId)
  if (running > 0) {
    return { removed: 0 }
  }

  const db = await getDatabase()
  const startedAtField = startedAtSqlField()
  const activeLogThreshold = staleRunningThresholdSql(
    parsePositiveIntEnv(
      process.env.PERFORMANCE_SYNC_LOG_ACTIVE_MINUTES,
      DEFAULT_ACTIVE_RUNNING_LOG_MINUTES
    )
  )

  const runningLog = (await db.queryOne(
    `
      SELECT id
      FROM sync_logs
      WHERE user_id = ?
        AND ${performanceSyncLogTypeSql()}
        AND status = 'running'
        AND ${startedAtField} >= ${activeLogThreshold}
      LIMIT 1
    `,
    [userId]
  )) as { id: number } | null

  if (runningLog) {
    return { removed: 0 }
  }

  const lastCompleted = (await db.queryOne(
    `
      SELECT completed_at
      FROM sync_logs
      WHERE user_id = ?
        AND ${performanceSyncLogTypeSql()}
        AND status IN ('success', 'partial', 'failed')
        AND completed_at IS NOT NULL
      ORDER BY completed_at DESC
      LIMIT 1
    `,
    [userId]
  )) as { completed_at: string } | null

  const completedAtMs = lastCompleted?.completed_at
    ? Date.parse(lastCompleted.completed_at)
    : Number.NaN
  const hasValidCompletedAt = Number.isFinite(completedAtMs)

  const envStalePendingMs = parsePositiveIntEnv(
    process.env.PERFORMANCE_SYNC_STALE_PENDING_MS,
    DEFAULT_STALE_PENDING_SYNC_TASK_MS
  )
  const stalePendingMs = Math.max(envStalePendingMs, options?.minStaleMs ?? 0)
  const now = Date.now()

  const { pending } = await listPerformanceSyncTasksForUser(userId)
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
    if (await removePerformanceSyncTaskFromQueue(task.id)) {
      removed++
    }
  }

  if (removed > 0) {
    logger.info('[performance-sync] reconciled_stale_pending_sync_tasks', {
      userId,
      removed,
      stalePendingMs,
    })
  }

  return { removed }
}

/**
 * 将长时间未结束的 running 性能同步日志标记为 failed，避免调度器长期误判为进行中。
 */
export async function markStalePerformanceSyncLogs(options?: {
  userId?: number
  staleMinutes?: number
}): Promise<number> {
  const db = await getDatabase()
  const staleMinutes =
    options?.staleMinutes ??
    parsePositiveIntEnv(
      process.env.PERFORMANCE_SYNC_LOG_STALE_MINUTES,
      DEFAULT_STALE_RUNNING_LOG_MINUTES
    )
  const startedAtField = startedAtSqlField()
  const threshold = staleRunningThresholdSql(staleMinutes)
  const completedAt = utcNowIso()
  const errorMessage = '同步未正常结束（超时自动关闭）'
  const durationExpr = `CAST(EXTRACT(EPOCH FROM (NOW() - ${startedAtField})) * 1000 AS INTEGER)`

  const params: unknown[] = [completedAt, errorMessage]
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
        AND ${performanceSyncLogTypeSql()}
        AND ${startedAtField} < ${threshold}
        ${userFilter}
    `,
    params
  )

  return result.changes ?? 0
}

export async function userHasActivePerformanceSyncWork(userId: number): Promise<{
  active: boolean
  reason?: 'queue' | 'sync_log'
  pending: number
  running: number
}> {
  const { pending, running } = await getPerformanceSyncQueueCountsForUser(userId)
  if (pending + running > 0) {
    return { active: true, reason: 'queue', pending, running }
  }

  const db = await getDatabase()
  const startedAtField = startedAtSqlField()
  const activeLogThreshold = staleRunningThresholdSql(
    parsePositiveIntEnv(
      process.env.PERFORMANCE_SYNC_LOG_ACTIVE_MINUTES,
      DEFAULT_ACTIVE_RUNNING_LOG_MINUTES
    )
  )

  const runningLog = (await db.queryOne(
    `
      SELECT id
      FROM sync_logs
      WHERE user_id = ?
        AND ${performanceSyncLogTypeSql()}
        AND status = 'running'
        AND ${startedAtField} >= ${activeLogThreshold}
      LIMIT 1
    `,
    [userId]
  )) as { id: number } | null

  if (runningLog) {
    return { active: true, reason: 'sync_log', pending, running }
  }

  return { active: false, pending, running }
}

/**
 * 调度器入队前：清理僵尸 sync_logs 与超时 running 队列任务（不触碰 pending，pending 由 per-user 间隔逻辑处理）。
 */
export async function preparePerformanceSyncQueueHealth(): Promise<{
  staleLogsClosed: number
  staleRunningTasksCleaned: number
}> {
  const staleLogsClosed = await markStalePerformanceSyncLogs()

  const queue = getQueueManager()
  await queue.ensureInitialized()
  const zombieCleanup = await queue.cleanupZombieTasks('runtime')

  return {
    staleLogsClosed,
    staleRunningTasksCleaned: zombieCleanup.cleaned,
  }
}
