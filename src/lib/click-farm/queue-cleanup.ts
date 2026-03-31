import { getBackgroundQueueManager, getQueueManager } from '@/lib/queue/unified-queue-manager'
import type { Task } from '@/lib/queue/types'
import type { UnifiedQueueManager } from '@/lib/queue/unified-queue-manager'

function getQueueManagers(): UnifiedQueueManager[] {
  const coreQueue = getQueueManager()
  const bgQueue = getBackgroundQueueManager()
  if (coreQueue === bgQueue) return [coreQueue]
  return [coreQueue, bgQueue]
}

function extractClickFarmTaskId(task: Task): string | null {
  if (!task) return null
  const type = task.type
  if (type !== 'click-farm' && type !== 'click-farm-trigger' && type !== 'click-farm-batch') {
    return null
  }

  const data = task.data as any
  const id = type === 'click-farm'
    ? data?.taskId
    : data?.clickFarmTaskId
  if (id === null || id === undefined) return null
  const normalized = String(id).trim()
  return normalized || null
}

export async function removePendingClickFarmQueueTasksByTaskIds(
  taskIds: Array<string | number>,
  userId?: number
): Promise<{ removedCount: number; scannedCount: number }> {
  const normalizedIds = new Set(
    taskIds
      .map((id) => String(id).trim())
      .filter(Boolean)
  )

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
        if (typeof userId === 'number' && pendingTask.userId !== userId) continue
        const clickFarmTaskId = extractClickFarmTaskId(pendingTask)
        if (!clickFarmTaskId || !normalizedIds.has(clickFarmTaskId)) continue

        const removed = await queue.removeTask(pendingTask.id)
        if (removed) removedCount += 1
      }
    } catch (error: any) {
      console.warn('[click-farm] 清理队列任务失败:', error?.message || error)
    }
  }

  return { removedCount, scannedCount }
}
