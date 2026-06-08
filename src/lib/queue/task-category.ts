import type { TaskType } from './types'

// “非核心任务”通常是后台/定时/批量类型，失败不一定代表用户主流程不可用。
// 管理台上用于区分核心任务的SLA风险。
const BACKGROUND_TASK_TYPES: ReadonlySet<TaskType> = new Set([
  'click-farm-trigger',
  'click-farm-batch',
  'click-farm',
  'url-swap',
  'openclaw-strategy',
  'affiliate-product-sync',
  'openclaw-command',
  'openclaw-affiliate-sync',
  'openclaw-report-send',
  'product-score-calculation',
  'google-ads-campaign-sync',
])

/** 完成/失败后从队列存储立即移除，避免 Redis tasks hash / 内存膨胀 */
const EPHEMERAL_TASK_TYPES: ReadonlySet<TaskType> = new Set([
  'click-farm',
  'click-farm-trigger',
  'click-farm-batch',
  'google-ads-campaign-sync',
])

export function isEphemeralTaskType(type: TaskType | string): boolean {
  return EPHEMERAL_TASK_TYPES.has(type as TaskType)
}

export function isBackgroundTaskType(type: TaskType | string): boolean {
  return BACKGROUND_TASK_TYPES.has(type as TaskType)
}
