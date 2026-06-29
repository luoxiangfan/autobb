import type { Task } from '@/lib/queue/types'
import { removePendingQueueTasksByDomainIds } from '@/lib/queue/remove-pending-by-domain-ids'
import { pauseUrlSwapTargetsByTaskId } from './url-swap-targets'
import { pauseUrlSwapSitelinkTargetsByTaskId } from './url-swap-sitelink-targets'

function extractUrlSwapTaskId(task: Task): string | null {
  if (!task || task.type !== 'url-swap') return null
  const id = (task.data as any)?.taskId
  if (id === null || id === undefined) return null
  const normalized = String(id).trim()
  return normalized || null
}

/**
 * 暂停换链 Campaign 目标与 Sitelink 子目标（不含任务主表 status 变更）。
 */
export async function suspendUrlSwapTaskChildTargets(taskId: string): Promise<void> {
  await pauseUrlSwapTargetsByTaskId(taskId)
  await pauseUrlSwapSitelinkTargetsByTaskId(taskId)
}

export async function removePendingUrlSwapQueueTasksByTaskIds(
  taskIds: Array<string | number>,
  userId?: number
): Promise<{ removedCount: number; scannedCount: number }> {
  return removePendingQueueTasksByDomainIds({
    taskIds,
    userId,
    extractDomainTaskId: extractUrlSwapTaskId,
    logLabel: 'url-swap',
  })
}

/**
 * 暂停子目标并清理队列中待执行的换链任务（Sitelink 更新在同一次 url-swap 执行内完成）。
 */
export async function suspendUrlSwapTaskExecution(
  taskId: string,
  userId?: number
): Promise<{ removedCount: number; scannedCount: number }> {
  await suspendUrlSwapTaskChildTargets(taskId)
  return removePendingUrlSwapQueueTasksByTaskIds([taskId], userId)
}
