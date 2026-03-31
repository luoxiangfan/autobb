import { getDatabase, type DatabaseAdapter } from '@/lib/db'
import { removePendingClickFarmQueueTasksByTaskIds } from '@/lib/click-farm/queue-cleanup'

type ClickFarmTaskCandidate = {
  id: string
  user_id: number
  offer_id: number
  status: string
}

function taskNotDeletedClause(dbType: DatabaseAdapter['type'], alias: string): string {
  if (dbType === 'postgres') {
    return `(${alias}.is_deleted = false OR ${alias}.is_deleted IS NULL)`
  }
  return `(${alias}.is_deleted = 0 OR ${alias}.is_deleted IS NULL)`
}

export async function hasEnabledCampaignForOffer(params: {
  userId: number
  offerId: number
  db?: DatabaseAdapter
}): Promise<boolean> {
  const db = params.db || await getDatabase()
  const campaignNotDeleted = taskNotDeletedClause(db.type, 'c')

  const row = await db.queryOne(
    `SELECT c.id
     FROM campaigns c
     WHERE c.user_id = ?
       AND c.offer_id = ?
       AND c.status = 'ENABLED'
       AND ${campaignNotDeleted}
     ORDER BY c.updated_at DESC
     LIMIT 1`,
    [params.userId, params.offerId]
  )

  return Boolean((row as any)?.id)
}

export async function findClickFarmTasksWithoutEnabledCampaign(params: {
  userId?: number
  limit?: number
  db?: DatabaseAdapter
}): Promise<ClickFarmTaskCandidate[]> {
  const db = params.db || await getDatabase()
  const limit = Math.max(1, Math.min(Number(params.limit || 200), 1000))
  const taskNotDeleted = taskNotDeletedClause(db.type, 't')
  const campaignNotDeleted = taskNotDeletedClause(db.type, 'c')

  const whereParts = [
    `t.status IN ('pending', 'running')`,
    taskNotDeleted,
  ]
  const queryParams: Array<string | number> = []

  if (typeof params.userId === 'number') {
    whereParts.push('t.user_id = ?')
    queryParams.push(params.userId)
  }

  const rows = await db.query<ClickFarmTaskCandidate>(
    `SELECT t.id, t.user_id, t.offer_id, t.status
     FROM click_farm_tasks t
     WHERE ${whereParts.join(' AND ')}
       AND NOT EXISTS (
         SELECT 1
         FROM campaigns c
         WHERE c.user_id = t.user_id
           AND c.offer_id = t.offer_id
           AND c.status = 'ENABLED'
           AND ${campaignNotDeleted}
       )
     ORDER BY t.updated_at DESC
     LIMIT ?`,
    [...queryParams, limit]
  )

  return rows
}

export async function pauseClickFarmTasksWithoutEnabledCampaign(params?: {
  userId?: number
  limit?: number
  dryRun?: boolean
  pauseMessage?: string
}): Promise<{
  scanned: number
  paused: number
  queueRemoved: number
  queueScanned: number
  taskIds: string[]
}> {
  const db = await getDatabase()
  const dryRun = params?.dryRun === true
  const message = params?.pauseMessage || '未检测到可用Campaign，系统自动暂停，请先发布广告后重启任务'
  const taskNotDeleted = taskNotDeletedClause(db.type, 'click_farm_tasks')
  const nowSql = db.type === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"

  const tasks = await findClickFarmTasksWithoutEnabledCampaign({
    userId: params?.userId,
    limit: params?.limit,
    db,
  })

  if (dryRun || tasks.length === 0) {
    return {
      scanned: tasks.length,
      paused: 0,
      queueRemoved: 0,
      queueScanned: 0,
      taskIds: tasks.map((task) => String(task.id)),
    }
  }

  const pausedTaskIds: string[] = []

  for (const task of tasks) {
    const result = await db.exec(
      `UPDATE click_farm_tasks
       SET status = 'paused',
           pause_reason = ?,
           pause_message = ?,
           paused_at = ${nowSql},
           updated_at = ${nowSql}
       WHERE id = ?
         AND user_id = ?
         AND status IN ('pending', 'running')
         AND ${taskNotDeleted}`,
      ['no_campaign', message, task.id, task.user_id]
    )

    if ((result?.changes || 0) > 0) {
      pausedTaskIds.push(String(task.id))
    }
  }

  const cleanup = await removePendingClickFarmQueueTasksByTaskIds(pausedTaskIds)

  return {
    scanned: tasks.length,
    paused: pausedTaskIds.length,
    queueRemoved: cleanup.removedCount,
    queueScanned: cleanup.scannedCount,
    taskIds: pausedTaskIds,
  }
}
