import { describe, expect, it } from 'vitest'
import {
  accumulateTriggerAllOutcome,
  type TriggerAllPendingTasksResult,
} from '@/lib/click-farm/click-farm-scheduler-trigger'

function emptyTotals(): TriggerAllPendingTasksResult {
  return { processed: 0, queued: 0, paused: 0, skipped: 0, skipReasons: {} }
}

describe('accumulateTriggerAllOutcome', () => {
  it('counts queued clicks and skip reasons separately', () => {
    const totals = emptyTotals()

    accumulateTriggerAllOutcome(totals, {
      taskId: '1',
      status: 'queued',
      clickCount: 5,
    })
    accumulateTriggerAllOutcome(totals, {
      taskId: '2',
      status: 'skipped',
      reason: 'outside_time_range',
    })
    accumulateTriggerAllOutcome(totals, {
      taskId: '3',
      status: 'skipped',
      reason: 'outside_time_range',
    })
    accumulateTriggerAllOutcome(totals, {
      taskId: '4',
      status: 'paused',
    })

    expect(totals).toEqual({
      processed: 4,
      queued: 5,
      paused: 1,
      skipped: 2,
      skipReasons: { outside_time_range: 2 },
    })
  })

  it('falls back to status when reason is missing', () => {
    const totals = emptyTotals()

    accumulateTriggerAllOutcome(totals, {
      taskId: '9',
      status: 'error',
      reason: 'schedule_error',
    })

    expect(totals.skipReasons).toEqual({ schedule_error: 1 })
  })
})
