import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDateInTimezone } from '../../timezone-utils'

let mockDb: any

vi.mock('../../db', () => ({
  getDatabase: () => mockDb,
}))

function buildHourlyBreakdown(actualAtHour0: number): Array<{ target: number; actual: number; success: number; failed: number }> {
  return Array.from({ length: 24 }, (_, hour) => ({
    target: 0,
    actual: hour === 0 ? actualAtHour0 : 0,
    success: 0,
    failed: 0,
  }))
}

describe('getHourlyDistribution JSONB compatibility', () => {
  beforeEach(() => {
    mockDb = {
      type: 'postgres',
      query: vi.fn(),
    }
  })

  it('supports native jsonb array/object payloads', async () => {
    const { getHourlyDistribution } = await import('../../click-farm')
    const todayInTaskTimezone = getDateInTimezone(new Date(), 'America/New_York')
    const distribution = Array.from({ length: 24 }, (_, hour) => (hour === 0 ? 3 : 0))

    mockDb.query.mockResolvedValueOnce([
      {
        hourly_distribution: distribution,
        timezone: 'America/New_York',
        daily_history: [
          {
            date: todayInTaskTimezone,
            hourly_breakdown: buildHourlyBreakdown(2),
          },
        ],
      },
    ])

    const result = await getHourlyDistribution(1)

    expect(result.hourlyConfigured[0]).toBe(3)
    expect(result.hourlyActual[0]).toBe(2)
  })

  it('keeps compatibility with legacy json string payloads', async () => {
    const { getHourlyDistribution } = await import('../../click-farm')
    const todayInTaskTimezone = getDateInTimezone(new Date(), 'America/New_York')
    const distribution = Array.from({ length: 24 }, (_, hour) => (hour === 0 ? 4 : 0))

    mockDb.query.mockResolvedValueOnce([
      {
        hourly_distribution: JSON.stringify(distribution),
        timezone: 'America/New_York',
        daily_history: JSON.stringify([
          {
            date: todayInTaskTimezone,
            hourly_breakdown: buildHourlyBreakdown(1),
          },
        ]),
      },
    ])

    const result = await getHourlyDistribution(1)

    expect(result.hourlyConfigured[0]).toBe(4)
    expect(result.hourlyActual[0]).toBe(1)
  })
})
