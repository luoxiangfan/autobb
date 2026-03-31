import type { Task } from '@/lib/queue/types'
import { refreshOpenclawDailyReportSnapshot } from '@/lib/openclaw/reports'

export type OpenclawAffiliateSyncTaskData = {
  userId: number
  date?: string
  syncMode?: 'incremental' | 'realtime'
  trigger?: 'cron' | 'manual' | 'retry'
}

export async function executeOpenclawAffiliateSync(task: Task<OpenclawAffiliateSyncTaskData>) {
  const data = task.data
  if (!data?.userId) {
    throw new Error('任务参数不完整')
  }

  const report = await refreshOpenclawDailyReportSnapshot({
    userId: data.userId,
    date: data.date,
  })

  return {
    success: true,
    userId: data.userId,
    date: report.date,
    syncMode: data.syncMode || 'incremental',
    trigger: data.trigger || 'cron',
  }
}
