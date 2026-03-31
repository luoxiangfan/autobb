import type { Task } from '../types'
import type { ClickFarmTriggerTaskData } from '@/lib/click-farm/queue-task-types'
import { triggerTaskScheduling } from '@/lib/click-farm/click-farm-scheduler-trigger'

export async function executeClickFarmTriggerTask(
  task: Task<ClickFarmTriggerTaskData>
): Promise<{ status: string; message?: string; clickCount?: number }> {
  const clickFarmTaskId = String(task.data?.clickFarmTaskId || '').trim()
  if (!clickFarmTaskId) {
    return { status: 'skipped', message: 'missing clickFarmTaskId' }
  }

  const result = await triggerTaskScheduling(clickFarmTaskId, {
    parentRequestId: task.parentRequestId,
  })
  return {
    status: result.status,
    message: result.message,
    clickCount: result.clickCount,
  }
}
