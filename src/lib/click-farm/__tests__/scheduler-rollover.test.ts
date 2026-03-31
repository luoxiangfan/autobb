import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateNextRunAt } from '../scheduler'
import type { ClickFarmTask } from '../click-farm-types'

function createTask(overrides: Partial<ClickFarmTask> = {}): ClickFarmTask {
  return {
    id: 'rollover-task',
    user_id: 1,
    offer_id: 1,
    daily_click_count: 1,
    start_time: '00:00',
    end_time: '24:00',
    duration_days: 14,
    scheduled_start_date: '2026-03-18',
    hourly_distribution: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    status: 'running',
    pause_reason: null,
    pause_message: null,
    paused_at: null,
    progress: 0,
    total_clicks: 0,
    success_clicks: 0,
    failed_clicks: 0,
    daily_history: [],
    timezone: 'America/New_York',
    is_deleted: false,
    deleted_at: null,
    started_at: '2026-03-18T16:24:32.257Z',
    completed_at: null,
    next_run_at: null,
    created_at: '2026-03-18T15:29:45.232Z',
    updated_at: '2026-03-18T15:29:45.232Z',
    ...overrides
  }
}

describe('click-farm scheduler rollover', () => {
  const originalTz = process.env.TZ

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env.TZ = originalTz
  })

  it('computes next_run_at on next day when current hour is 23', () => {
    process.env.TZ = 'Asia/Shanghai'
    vi.setSystemTime(new Date('2026-03-23T03:30:00.000Z')) // 纽约时间 2026-03-22 23:30

    const nextRun = generateNextRunAt('America/New_York', createTask())

    expect(nextRun.toISOString()).toBe('2026-03-23T04:00:00.000Z') // 纽约时间 2026-03-23 00:00
    expect(nextRun.getTime()).toBeGreaterThan(Date.now())
  })
})
