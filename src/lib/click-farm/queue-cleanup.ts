import type { Task } from '@/lib/queue/types'
import { removePendingQueueTasksByDomainIds } from '@/lib/queue/remove-pending-by-domain-ids'

function extractClickFarmTaskId(task: Task): string | null {
  if (!task) return null
  const type = task.type
  if (type !== 'click-farm' && type !== 'click-farm-trigger' && type !== 'click-farm-batch') {
    return null
  }

  const data = task.data as any
  const id = type === 'click-farm' ? data?.taskId : data?.clickFarmTaskId
  if (id === null || id === undefined) return null
  const normalized = String(id).trim()
  return normalized || null
}

export async function removePendingClickFarmQueueTasksByTaskIds(
  taskIds: Array<string | number>,
  userId?: number
): Promise<{ removedCount: number; scannedCount: number }> {
  return removePendingQueueTasksByDomainIds({
    taskIds,
    userId,
    extractDomainTaskId: extractClickFarmTaskId,
    logLabel: 'click-farm',
  })
}
