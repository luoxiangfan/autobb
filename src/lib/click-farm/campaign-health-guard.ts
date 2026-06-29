import { getDatabase } from '@/lib/db'
import { removePendingClickFarmQueueTasksByTaskIds } from '@/lib/click-farm/queue-cleanup'

export { hasEnabledCampaignForOffer } from '@/lib/campaign/campaign-health-guard'

type ClickFarmTaskCandidate = {
  id: string
  user_id: number
  offer_id: number
  status: string
}

async function findClickFarmTasksWithoutEnabledCampaign(params: {
  userId?: number
  limit?: number
  db?: Awaited<ReturnType<typeof getDatabase>>
}): Promise<ClickFarmTaskCandidate[]> {
  const db = params.db || (await getDatabase())
  const limit = Math.max(1, Math.min(Number(params.limit || 200), 1000))

  const whereParts = [
    `t.status IN ('pending', 'running')`,
    `(t.is_deleted = false OR t.is_deleted IS NULL)`,
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
           AND (c.is_deleted = false OR c.is_deleted IS NULL)
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
  const message =
    params?.pauseMessage || '未检测到可用Campaign，系统自动暂停，请先发布广告后重启任务'

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
           paused_at = NOW(),
           updated_at = NOW()
       WHERE id = ?
         AND user_id = ?
         AND status IN ('pending', 'running')
         AND (is_deleted = false OR is_deleted IS NULL)`,
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
