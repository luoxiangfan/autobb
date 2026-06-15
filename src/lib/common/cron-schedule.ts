import { CronJob, validateCronExpression as validateCronExpressionResult } from 'cron'

export type ScheduledCronJob = CronJob

const scheduledJobs = new Set<CronJob>()

export function validateCronExpression(expression: string): boolean {
  return validateCronExpressionResult(expression).valid
}

export function scheduleCronJob(
  cronExpression: string,
  onTick: () => void | Promise<void>,
  options?: { timeZone?: string }
): CronJob {
  const job = CronJob.from({
    cronTime: cronExpression,
    onTick: () => {
      void Promise.resolve(onTick()).catch((error) => {
        console.error('[cron] scheduled task failed:', error)
      })
    },
    start: true,
    timeZone: options?.timeZone,
  })
  scheduledJobs.add(job)
  return job
}

export function stopScheduledCronJob(job: CronJob): void {
  job.stop()
  scheduledJobs.delete(job)
}

export function stopAllScheduledCronJobs(): void {
  for (const job of scheduledJobs) {
    try {
      job.stop()
    } catch (error) {
      console.error('[cron] failed to stop scheduled task:', error)
    }
  }
  scheduledJobs.clear()
}
