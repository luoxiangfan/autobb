export type ClickFarmRefererConfig = {
  type: 'none' | 'random' | 'specific' | 'custom'
  referer?: string
}

export type ClickFarmTriggerTaskData = {
  clickFarmTaskId: string
  source?: 'manual' | 'create' | 'update' | 'scheduler'
}

export type ClickFarmBatchTaskData = {
  clickFarmTaskId: string
  offerId: number
  url: string
  proxyUrl: string
  timezone: string
  targetDate: string
  targetHour: number
  totalClicks: number
  dispatchedClicks: number
  batchSize?: number
  // 仅用于队列延迟执行（映射到 notBefore）
  scheduledAt?: string
  refererConfig?: ClickFarmRefererConfig
}
