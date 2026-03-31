import { describe, expect, it } from 'vitest'
import { getRemainingHourlyClicks } from '../click-farm-scheduler-trigger'

describe('click-farm trigger hourly cap', () => {
  it('returns zero when current hour target is already reached', () => {
    const remaining = getRemainingHourlyClicks(
      {
        daily_history: [
          {
            date: '2026-03-22',
            target: 50,
            actual: 50,
            success: 50,
            failed: 0,
            hourly_breakdown: Array.from({ length: 24 }, (_, hour) => ({
              target: hour === 23 ? 3 : 0,
              actual: hour === 23 ? 3 : 0,
              success: hour === 23 ? 3 : 0,
              failed: 0
            }))
          }
        ] as any
      },
      {
        targetDate: '2026-03-22',
        currentHour: 23,
        plannedClicks: 3
      }
    )

    expect(remaining).toBe(0)
  })

  it('returns remaining clicks when current hour only partially executed', () => {
    const remaining = getRemainingHourlyClicks(
      {
        daily_history: [
          {
            date: '2026-03-22',
            target: 50,
            actual: 48,
            success: 48,
            failed: 0,
            hourly_breakdown: Array.from({ length: 24 }, (_, hour) => ({
              target: hour === 23 ? 3 : 0,
              actual: hour === 23 ? 1 : 0,
              success: hour === 23 ? 1 : 0,
              failed: 0
            }))
          }
        ] as any
      },
      {
        targetDate: '2026-03-22',
        currentHour: 23,
        plannedClicks: 3
      }
    )

    expect(remaining).toBe(2)
  })
})
