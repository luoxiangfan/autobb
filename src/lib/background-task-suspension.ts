import { getDatabase } from '@/lib/db'
import { boolParam, nowFunc, toBool } from '@/lib/db-helpers'
import { getBackgroundQueueManager, getQueueManager } from '@/lib/queue'
import { ALL_TASK_TYPES, type TaskType } from '@/lib/queue/types'
import { pauseUrlSwapTargetsByUserIds } from '@/lib/url-swap'
import { clearUserExecutionEligibilityCache } from '@/lib/user-execution-eligibility'

// 队列止血默认覆盖所有用户任务类型；通过 userId 维度删除，不影响系统任务（userId<=0）。
export const USER_SUSPENDED_TASK_TYPES: TaskType[] = [...ALL_TASK_TYPES]

export type UserSuspensionReason = 'manual_disable' | 'package_expired' | 'daily_sweep'

function isExpired(packageExpiresAt: string | null | undefined, now: Date): boolean {
  if (!packageExpiresAt) return false
  const expiry = new Date(packageExpiresAt)
  if (!Number.isFinite(expiry.getTime())) return true
  return expiry.getTime() < now.getTime()
}

async function purgeUserPendingQueueTasks(
  userId: number,
  types: TaskType[]
): Promise<number> {
  const queueManagers = [getQueueManager(), getBackgroundQueueManager()]
  let removedCount = 0

  for (const queue of queueManagers) {
    try {
      const result = await queue.purgePendingTasksByUserAndTypes(userId, types)
      removedCount += result.removedCount
    } catch (error: any) {
      console.warn(
        `[user-task-suspension] purge pending tasks failed (userId=${userId}, prefix=${queue.getConfig().redisKeyPrefix || 'memory'}):`,
        error?.message || String(error)
      )
    }
  }

  return removedCount
}

export async function suspendUserBackgroundTasks(
  userId: number,
  opts: { reason: UserSuspensionReason; purgeQueue?: boolean }
): Promise<{
  clickFarmStopped: number
  urlSwapDisabled: number
  queuePurged: number
}> {
  const db = await getDatabase()
  const nowSql = nowFunc(db.type)

  const clickFarmStopped = (
    await db.exec(
      `
        UPDATE click_farm_tasks
        SET status = 'stopped',
            updated_at = ${nowSql}
        WHERE user_id = ?
          AND status IN ('pending', 'running', 'paused')
          AND IS_DELETED_FALSE
      `,
      [userId]
    )
  ).changes

  const urlSwapNotDeletedCondition =
    db.type === 'postgres'
      ? '(is_deleted = FALSE OR is_deleted IS NULL)'
      : '(is_deleted = 0 OR is_deleted IS NULL)'

  const urlSwapDisabled = (
    await db.exec(
      `
        UPDATE url_swap_tasks
        SET status = 'disabled',
            updated_at = ${nowSql}
        WHERE user_id = ?
          AND status = 'enabled'
          AND ${urlSwapNotDeletedCondition}
      `,
      [userId]
    )
  ).changes
  await pauseUrlSwapTargetsByUserIds([userId])

  const purgeQueue = opts.purgeQueue ?? true
  let queuePurged = 0

  if (purgeQueue) {
    queuePurged = await purgeUserPendingQueueTasks(userId, USER_SUSPENDED_TASK_TYPES)
  }

  clearUserExecutionEligibilityCache(userId)

  return { clickFarmStopped, urlSwapDisabled, queuePurged }
}

export async function suspendBackgroundTasksForInactiveOrExpiredUsers(opts?: {
  purgeQueue?: boolean
}): Promise<{
  affectedUserIds: number[]
  clickFarmStopped: number
  urlSwapDisabled: number
  queuePurged: number
}> {
  const db = await getDatabase()
  const now = new Date()

  // 仅拉取“可能不合规”的用户：is_active=false 或 package_expires_at 不为空（后续在应用层判断是否过期）
  const candidates = await db.query<{
    id: number
    is_active: any
    package_expires_at: string | null
  }>(
    `
      SELECT id, is_active, package_expires_at
      FROM users
      WHERE is_active = ?
         OR package_expires_at IS NOT NULL
    `,
    [boolParam(false, db.type)]
  )

  const affectedUserIds = Array.from(
    new Set(
      candidates
        .filter((u) => !toBool(u.is_active) || isExpired(u.package_expires_at, now))
        .map((u) => u.id)
    )
  )

  if (affectedUserIds.length === 0) {
    return { affectedUserIds: [], clickFarmStopped: 0, urlSwapDisabled: 0, queuePurged: 0 }
  }

  const placeholders = affectedUserIds.map(() => '?').join(', ')
  const nowSql = nowFunc(db.type)

  const clickFarmStopped = (
    await db.exec(
      `
        UPDATE click_farm_tasks
        SET status = 'stopped',
            updated_at = ${nowSql}
        WHERE user_id IN (${placeholders})
          AND status IN ('pending', 'running', 'paused')
          AND IS_DELETED_FALSE
      `,
      [...affectedUserIds]
    )
  ).changes

  const urlSwapNotDeletedCondition =
    db.type === 'postgres'
      ? '(is_deleted = FALSE OR is_deleted IS NULL)'
      : '(is_deleted = 0 OR is_deleted IS NULL)'

  const urlSwapDisabled = (
    await db.exec(
      `
        UPDATE url_swap_tasks
        SET status = 'disabled',
            updated_at = ${nowSql}
        WHERE user_id IN (${placeholders})
          AND status = 'enabled'
          AND ${urlSwapNotDeletedCondition}
      `,
      [...affectedUserIds]
    )
  ).changes
  await pauseUrlSwapTargetsByUserIds(affectedUserIds)

  const purgeQueue = opts?.purgeQueue ?? true
  let queuePurged = 0
  if (purgeQueue) {
    for (const userId of affectedUserIds) {
      queuePurged += await purgeUserPendingQueueTasks(userId, USER_SUSPENDED_TASK_TYPES)
    }
  }

  for (const userId of affectedUserIds) {
    clearUserExecutionEligibilityCache(userId)
  }

  return { affectedUserIds, clickFarmStopped, urlSwapDisabled, queuePurged }
}
