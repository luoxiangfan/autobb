import type { Task } from '@/lib/queue/types'
import { removePendingQueueTasksByDomainIds } from '@/lib/queue/remove-pending-by-domain-ids'

function extractUrlSwapTaskId(task: Task): string | null {
  if (!task || task.type !== 'url-swap') return null
  const id = (task.data as any)?.taskId
  if (id === null || id === undefined) return null
  const normalized = String(id).trim()
  return normalized || null
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
