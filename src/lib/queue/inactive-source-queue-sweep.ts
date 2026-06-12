/**
 * 定时清理：补点击任务已暂停、换链接任务已禁用时，移除队列中仍挂起的对应任务。
 * 兜底 pause/disable 路径未调用 queue-cleanup 或清理失败留下的脏数据。
 */
import { getDatabase } from '@/lib/db'
import { notDeletedClause } from '@/lib/db-helpers'
import { removePendingClickFarmQueueTasksByTaskIds } from '@/lib/click-farm/queue-cleanup'
import { removePendingUrlSwapQueueTasksByTaskIds } from '@/lib/url-swap/queue-cleanup'

const DEFAULT_MAX_IDS = 3000

export async function sweepPendingQueueTasksForInactiveClickFarmAndUrlSwap(options?: {
  maxIdsPerSource?: number
}): Promise<{
  pausedClickFarmIds: number
  disabledUrlSwapIds: number
  clickFarmQueueRemoved: number
  urlSwapQueueRemoved: number
  clickFarmQueueScanned: number
  urlSwapQueueScanned: number
}> {
  const db = await getDatabase()
  const limit = Math.max(
    1,
    Math.min(Number(options?.maxIdsPerSource ?? DEFAULT_MAX_IDS) || DEFAULT_MAX_IDS, 10_000)
  )
  const taskNotDeleted = notDeletedClause('t')

  const pausedRows = await db.query<{ id: string | number }>(
    `SELECT t.id
     FROM click_farm_tasks t
     WHERE t.status = 'paused'
       AND ${taskNotDeleted}
     LIMIT ?`,
    [limit]
  )
  const disabledRows = await db.query<{ id: string | number }>(
    `SELECT t.id
     FROM url_swap_tasks t
     WHERE t.status = 'disabled'
     LIMIT ?`,
    [limit]
  )

  const pausedClickFarmIds = (pausedRows || []).map((r) => String(r.id).trim()).filter(Boolean)
  const disabledUrlSwapIds = (disabledRows || []).map((r) => String(r.id).trim()).filter(Boolean)

  let clickFarmQueueRemoved = 0
  let urlSwapQueueRemoved = 0
  let clickFarmQueueScanned = 0
  let urlSwapQueueScanned = 0

  if (pausedClickFarmIds.length > 0) {
    const r = await removePendingClickFarmQueueTasksByTaskIds(pausedClickFarmIds)
    clickFarmQueueRemoved = r.removedCount
    clickFarmQueueScanned = r.scannedCount
  }

  if (disabledUrlSwapIds.length > 0) {
    const r = await removePendingUrlSwapQueueTasksByTaskIds(disabledUrlSwapIds)
    urlSwapQueueRemoved = r.removedCount
    urlSwapQueueScanned = r.scannedCount
  }

  return {
    pausedClickFarmIds: pausedClickFarmIds.length,
    disabledUrlSwapIds: disabledUrlSwapIds.length,
    clickFarmQueueRemoved,
    urlSwapQueueRemoved,
    clickFarmQueueScanned,
    urlSwapQueueScanned,
  }
}
