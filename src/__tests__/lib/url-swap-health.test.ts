import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  exec: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => dbFns),
  parseJsonField: (_value: unknown, fallback: unknown) => fallback,
}))

vi.mock('@/lib/url-swap/alerts/notifications', () => ({
  notifySwapError: vi.fn(async () => {}),
  notifyUrlSwapTaskPaused: vi.fn(async () => {}),
}))

import { getUrlSwapHealth } from '@/lib/url-swap/alerts/monitoring'

describe('getUrlSwapHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries only non-deleted tasks and excludes soft-deleted rows from alerts', async () => {
    dbFns.query.mockResolvedValue([
      {
        id: 'active-task',
        status: 'enabled',
        total_swaps: 10,
        failed_swaps: 8,
        success_swaps: 2,
        swap_interval_minutes: 60,
        is_deleted: false,
        deleted_at: null,
        swap_history: '[]',
      },
    ])

    const health = await getUrlSwapHealth()

    expect(dbFns.query).toHaveBeenCalledWith(
      expect.stringContaining('(is_deleted IS NOT TRUE) AND deleted_at IS NULL')
    )
    expect(health.stats.total).toBe(1)
    expect(health.alerts.some((alert) => alert.taskId === 'active-task')).toBe(true)
    expect(health.alerts.some((alert) => alert.taskId === 'deleted-task')).toBe(false)
  })

  it('returns empty alerts when all tasks are soft-deleted', async () => {
    dbFns.query.mockResolvedValue([])

    const health = await getUrlSwapHealth()

    expect(health.stats.total).toBe(0)
    expect(health.alerts).toEqual([])
    expect(health.overall).toBe('healthy')
  })
})
