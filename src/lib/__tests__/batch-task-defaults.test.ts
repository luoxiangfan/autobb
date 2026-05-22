import { describe, expect, it } from 'vitest'
import {
  batchDefaultBalancedHourlyDistribution,
  BATCH_CLICK_FARM_TASK_DEFAULTS,
  BATCH_URL_SWAP_TASK_DEFAULTS,
  isClickFarmTaskUsingBatchDefaults,
  isUrlSwapTaskUsingBatchDefaults,
} from '@/lib/batch-task-defaults'

describe('isClickFarmTaskUsingBatchDefaults', () => {
  it('matches batch default click-farm configuration', () => {
    expect(
      isClickFarmTaskUsingBatchDefaults({
        daily_click_count: BATCH_CLICK_FARM_TASK_DEFAULTS.dailyClickCount,
        start_time: BATCH_CLICK_FARM_TASK_DEFAULTS.startTime,
        end_time: BATCH_CLICK_FARM_TASK_DEFAULTS.endTime,
        duration_days: BATCH_CLICK_FARM_TASK_DEFAULTS.durationDays,
        hourly_distribution: batchDefaultBalancedHourlyDistribution(),
        referer_config: { type: 'none' },
      })
    ).toBe(true)
  })

  it('rejects non-default daily click count', () => {
    expect(
      isClickFarmTaskUsingBatchDefaults({
        daily_click_count: 20,
        start_time: BATCH_CLICK_FARM_TASK_DEFAULTS.startTime,
        end_time: BATCH_CLICK_FARM_TASK_DEFAULTS.endTime,
        duration_days: BATCH_CLICK_FARM_TASK_DEFAULTS.durationDays,
        hourly_distribution: batchDefaultBalancedHourlyDistribution(),
        referer_config: null,
      })
    ).toBe(false)
  })
})

describe('isUrlSwapTaskUsingBatchDefaults', () => {
  it('matches batch default url-swap configuration', () => {
    expect(
      isUrlSwapTaskUsingBatchDefaults({
        swap_mode: BATCH_URL_SWAP_TASK_DEFAULTS.swapMode,
        swap_interval_minutes: BATCH_URL_SWAP_TASK_DEFAULTS.swapIntervalMinutes,
        duration_days: BATCH_URL_SWAP_TASK_DEFAULTS.durationDays,
      })
    ).toBe(true)
  })
})
