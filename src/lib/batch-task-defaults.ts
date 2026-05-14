/**
 * 批量开启任务与单 Offer 弹窗「创建」流程共用的默认参数
 * （补点击：每日 10、06:00–24:00、不限期、均衡分布、无 Referer；换链：自动、24h、不限期）
 */
import { balanceDistribution } from '@/lib/click-farm/distribution'
import { getDateInTimezone, getTimezoneByCountry } from '@/lib/timezone-utils'

/** 与 `BatchStartOfferTarget` 形状一致，避免与 `batch-start-tasks` 循环依赖 */
export type BatchOfferTargetForDefaults = {
  offerId: number
  targetCountry?: string | null
}

export const BATCH_CLICK_FARM_TASK_DEFAULTS = {
  dailyClickCount: 10,
  startTime: '06:00',
  endTime: '24:00',
  durationDays: 9999,
} as const

export const BATCH_CLICK_FARM_REFERER_DEFAULT = { type: 'none' as const }

export const BATCH_URL_SWAP_TASK_DEFAULTS = {
  swapMode: 'auto' as const,
  swapIntervalMinutes: 1440,
  durationDays: -1,
} as const

export function batchDefaultBalancedHourlyDistribution(): number[] {
  return balanceDistribution(
    BATCH_CLICK_FARM_TASK_DEFAULTS.dailyClickCount,
    BATCH_CLICK_FARM_TASK_DEFAULTS.startTime,
    BATCH_CLICK_FARM_TASK_DEFAULTS.endTime,
  )
}

/** 与 batch-start-tasks 中每 Offer 的补点击配置一致 */
export function getBatchClickFarmRuntimeConfig(offer: BatchOfferTargetForDefaults, now: Date) {
  const timezone = getTimezoneByCountry(offer.targetCountry || 'US')
  const scheduledStartDate = getDateInTimezone(now, timezone)
  return {
    timezone,
    dailyClickCount: BATCH_CLICK_FARM_TASK_DEFAULTS.dailyClickCount,
    startTime: BATCH_CLICK_FARM_TASK_DEFAULTS.startTime,
    endTime: BATCH_CLICK_FARM_TASK_DEFAULTS.endTime,
    durationDays: BATCH_CLICK_FARM_TASK_DEFAULTS.durationDays,
    scheduledStartDate,
    hourlyDistribution: batchDefaultBalancedHourlyDistribution(),
    refererConfig: BATCH_CLICK_FARM_REFERER_DEFAULT,
  }
}
