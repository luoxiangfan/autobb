import { logger } from '@/lib/common/structured-logger'

function isQueueVerboseLog(): boolean {
  const v = (process.env.QUEUE_VERBOSE_LOG ?? '').trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

/**
 * 队列诊断/任务生命周期日志：默认 debug，QUEUE_VERBOSE_LOG=true 时升为 info。
 */
export function queueVerboseLog(msg: string, fields: Record<string, unknown> = {}): void {
  if (isQueueVerboseLog()) {
    logger.info(msg, fields)
  } else {
    logger.debug(msg, fields)
  }
}
