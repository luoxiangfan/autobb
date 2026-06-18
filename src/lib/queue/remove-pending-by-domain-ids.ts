import { getBackgroundQueueManager, getQueueManager } from '@/lib/queue'
import type { Task } from '@/lib/queue/types'
import type { UnifiedQueueManager } from '@/lib/queue'

function getQueueManagers(): UnifiedQueueManager[] {
  const coreQueue = getQueueManager()
  const bgQueue = getBackgroundQueueManager()
  if (coreQueue === bgQueue) return [coreQueue]
  return [coreQueue, bgQueue]
}

export type RemovePendingByDomainIdsOptions = {
  taskIds: Array<string | number>
  userId?: number
  extractDomainTaskId: (task: Task) => string | null
  logLabel: string
}

export async function removePendingQueueTasksByDomainIds(
  options: RemovePendingByDomainIdsOptions
): Promise<{ removedCount: number; scannedCount: number }> {
  const normalizedIds = new Set(options.taskIds.map((id) => String(id).trim()).filter(Boolean))

  if (normalizedIds.size === 0) {
    return { removedCount: 0, scannedCount: 0 }
  }

  let removedCount = 0
  let scannedCount = 0

  for (const queue of getQueueManagers()) {
    try {
      await queue.ensureInitialized()
      const pendingTasks = await queue.getPendingTasks()
      scannedCount += pendingTasks.length

      for (const pendingTask of pendingTasks) {
        if (typeof options.userId === 'number' && pendingTask.userId !== options.userId) {
          continue
        }
        const domainTaskId = options.extractDomainTaskId(pendingTask)
        if (!domainTaskId || !normalizedIds.has(domainTaskId)) continue

        const removed = await queue.removeTask(pendingTask.id)
        if (removed) removedCount += 1
      }
    } catch (error: any) {
      console.warn(`[${options.logLabel}] 清理队列任务失败:`, error?.message || error)
    }
  }

  return { removedCount, scannedCount }
}
