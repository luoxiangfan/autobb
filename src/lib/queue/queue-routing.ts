import type { TaskType } from './types'
import { isBackgroundTaskType } from './task-category'
import { getBackgroundQueueManager, getQueueManager } from './unified-queue-manager'
import type { UnifiedQueueManager } from './unified-queue-manager'
import { logger } from '@/lib/structured-logger'

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])

function isEnvTrue(value?: string | null): boolean {
  if (!value) return false
  return TRUE_VALUES.has(value.toLowerCase())
}

let splitDecisionLogged = false
let splitMisconfigLogged = false

export function getQueueRoutingDiagnostics() {
  const splitFlag = isEnvTrue(process.env.QUEUE_SPLIT_BACKGROUND)
  const backgroundWorker = isEnvTrue(process.env.QUEUE_BACKGROUND_WORKER)
  const redisUrlPresent = Boolean(process.env.REDIS_URL && process.env.REDIS_URL.trim())
  const splitEnabled = splitFlag && redisUrlPresent

  return {
    splitFlag,
    splitEnabled,
    redisUrlPresent,
    backgroundWorker,
  }
}

export function isBackgroundQueueSplitEnabled(): boolean {
  const diagnostics = getQueueRoutingDiagnostics()

  if (!splitDecisionLogged) {
    splitDecisionLogged = true
    logger.info('queue_split_status', diagnostics)
  }

  if (diagnostics.splitFlag && !diagnostics.redisUrlPresent && !splitMisconfigLogged) {
    splitMisconfigLogged = true
    logger.error('queue_split_misconfig', {
      message: 'QUEUE_SPLIT_BACKGROUND=true but REDIS_URL is missing in this process',
      ...diagnostics,
    })
  }

  // 拆分队列依赖 Redis 做进程间共享；未配置 REDIS_URL 时退回单队列（避免内存队列跨进程丢任务）
  return diagnostics.splitEnabled
}

export function getQueueManagerForTaskType(type: TaskType): UnifiedQueueManager {
  const diagnostics = getQueueRoutingDiagnostics()

  if (isBackgroundTaskType(type)) {
    if (isBackgroundQueueSplitEnabled()) {
      if (!diagnostics.backgroundWorker) {
        // 非 background-worker 进程仅负责入队，不应自动启动后台消费循环。
        return getBackgroundQueueManager({ autoStartOnEnqueue: false })
      }
      return getBackgroundQueueManager()
    }

    if (diagnostics.splitFlag) {
      logger.warn('queue_split_fallback_to_core', {
        taskType: type,
        ...diagnostics,
      })
    }
  }

  return getQueueManager()
}
