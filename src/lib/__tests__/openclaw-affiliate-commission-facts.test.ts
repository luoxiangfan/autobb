import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    query: hoisted.dbQueryMock,
  })),
}))

import { affiliateCommissionFactsCoverRawRange } from '@/lib/openclaw/affiliate-commission-facts'

describe('affiliateCommissionFactsCoverRawRange', () => {
  beforeEach(() => {
    hoisted.dbQueryMock.mockReset()
  })

  it('returns false when raw dates exist without matching rebuilt facts', async () => {
    hoisted.dbQueryMock
      .mockResolvedValueOnce([
        { user_id: 1, report_date: '2026-05-01', max_updated_at: '2026-06-02T09:00:00.000Z' },
        { user_id: 1, report_date: '2026-05-10', max_updated_at: '2026-06-02T09:00:00.000Z' },
      ])
      .mockResolvedValueOnce([
        { user_id: 1, report_date: '2026-05-10', max_rebuilt_at: '2026-06-02T10:00:00.000Z' },
      ])

    await expect(
      affiliateCommissionFactsCoverRawRange({
        userIds: [1],
        startDate: '2026-05-01',
        endDate: '2026-05-31',
        platform: 'all',
        minRebuiltAt: '2026-06-02T00:00:00.000Z',
      })
    ).resolves.toBe(false)
  })

  it('returns true when every raw date has fresh rebuilt facts', async () => {
    hoisted.dbQueryMock
      .mockResolvedValueOnce([
        { user_id: 1, report_date: '2026-05-01', max_updated_at: '2026-06-02T09:00:00.000Z' },
        { user_id: 1, report_date: '2026-05-10', max_updated_at: '2026-06-02T09:00:00.000Z' },
      ])
      .mockResolvedValueOnce([
        { user_id: 1, report_date: '2026-05-01', max_rebuilt_at: '2026-06-02T10:00:00.000Z' },
        { user_id: 1, report_date: '2026-05-10', max_rebuilt_at: '2026-06-02T10:00:00.000Z' },
      ])

    await expect(
      affiliateCommissionFactsCoverRawRange({
        userIds: [1],
        startDate: '2026-05-01',
        endDate: '2026-05-31',
        platform: 'all',
        minRebuiltAt: '2026-06-02T00:00:00.000Z',
      })
    ).resolves.toBe(true)
  })
})
