/**
 * 批量开启任务与单 Offer 弹窗「创建」流程共用的默认参数
 * （补点击：每日 10、06:00–24:00、不限期、均衡分布、无 Referer；换链：自动、24h、不限期）
 */
import { balanceDistribution } from '@/lib/click-farm/distribution'
import { getDateInTimezone, getTimezoneByCountry } from '@/lib/common'

/** 与 `BatchStartOfferTarget` 形状一致，避免与 `batch-start-tasks` 循环依赖 */
export type BatchOfferTargetForDefaults = {
  offerId: number
  targetCountry?: string | null
}

export const BATCH_CLICK_FARM_TASK_DEFAULTS: {
  dailyClickCount: number
  startTime: string
  endTime: string
  durationDays: number
} = {
  dailyClickCount: 10,
  startTime: '06:00',
  endTime: '24:00',
  durationDays: 9999,
}

const BATCH_CLICK_FARM_REFERER_DEFAULT = { type: 'none' as const }

export const BATCH_URL_SWAP_TASK_DEFAULTS: {
  swapMode: 'auto' | 'manual'
  swapIntervalMinutes: number
  durationDays: number
} = {
  swapMode: 'auto',
  swapIntervalMinutes: 1440,
  durationDays: -1,
}

export function batchDefaultBalancedHourlyDistribution(): number[] {
  return balanceDistribution(
    BATCH_CLICK_FARM_TASK_DEFAULTS.dailyClickCount,
    BATCH_CLICK_FARM_TASK_DEFAULTS.startTime,
    BATCH_CLICK_FARM_TASK_DEFAULTS.endTime
  )
}

/** 与 batch-start-tasks 中每 Offer 的补点击配置一致 */
function hourlyDistributionsEqual(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function parseRefererType(referer: { type?: string } | string | null | undefined): string | null {
  if (!referer) return null
  if (typeof referer === 'string') {
    try {
      const parsed = JSON.parse(referer) as { type?: string }
      return parsed?.type ? String(parsed.type) : null
    } catch {
      return null
    }
  }
  return referer.type ? String(referer.type) : null
}

export function isClickFarmTaskUsingBatchDefaults(task: {
  daily_click_count: number
  start_time: string
  end_time: string
  duration_days: number
  hourly_distribution: number[] | string | null | undefined
  referer_config?: { type?: string } | string | null
}): boolean {
  const hourlyDistribution = Array.isArray(task.hourly_distribution) ? task.hourly_distribution : []
  const refererType = parseRefererType(task.referer_config)

  return (
    task.daily_click_count === BATCH_CLICK_FARM_TASK_DEFAULTS.dailyClickCount &&
    task.start_time === BATCH_CLICK_FARM_TASK_DEFAULTS.startTime &&
    task.end_time === BATCH_CLICK_FARM_TASK_DEFAULTS.endTime &&
    task.duration_days === BATCH_CLICK_FARM_TASK_DEFAULTS.durationDays &&
    hourlyDistributionsEqual(hourlyDistribution, batchDefaultBalancedHourlyDistribution()) &&
    (refererType === null || refererType === 'none')
  )
}

export function isUrlSwapTaskUsingBatchDefaults(task: {
  swap_mode: string
  swap_interval_minutes: number
  duration_days: number
}): boolean {
  const swapMode = String(task.swap_mode || '')
    .trim()
    .toLowerCase()
  return (
    swapMode === BATCH_URL_SWAP_TASK_DEFAULTS.swapMode &&
    task.swap_interval_minutes === BATCH_URL_SWAP_TASK_DEFAULTS.swapIntervalMinutes &&
    task.duration_days === BATCH_URL_SWAP_TASK_DEFAULTS.durationDays
  )
}

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
