import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mockDb: any

vi.mock('../db', () => ({
  getDatabase: () => mockDb,
}))

describe('url-swap progress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-12T00:00:00.000Z'))

    mockDb = {
      type: 'sqlite',
      queryOne: vi.fn(),
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('computes progress from started_at and duration_days', async () => {
    const { getUrlSwapTaskById } = await import('../url-swap')

    mockDb.queryOne.mockResolvedValueOnce({
      id: 'task-1',
      user_id: 1,
      offer_id: 448,
      swap_interval_minutes: 30,
      enabled: 1,
      duration_days: 30,
      google_customer_id: null,
      google_campaign_id: null,
      current_final_url: null,
      current_final_url_suffix: null,
      progress: 0,
      total_swaps: 10,
      success_swaps: 10,
      failed_swaps: 0,
      url_changed_count: 10,
      swap_history: '[]',
      status: 'enabled',
      error_message: null,
      error_at: null,
      started_at: '2026-01-06T00:00:00.000Z',
      completed_at: null,
      next_swap_at: '2026-01-12T00:30:00.000Z',
      is_deleted: 0,
      deleted_at: null,
      created_at: '2026-01-06T00:00:00.000Z',
      updated_at: '2026-01-12T00:00:00.000Z',
      consecutive_failures: 0,
    })

    const task = await getUrlSwapTaskById('task-1', 1)
    expect(task?.progress).toBe(20) // 6/30 days -> 20%
  })

  it('returns 100 for completed tasks', async () => {
    const { getUrlSwapTaskById } = await import('../url-swap')

    mockDb.queryOne.mockResolvedValueOnce({
      id: 'task-1',
      user_id: 1,
      offer_id: 448,
      swap_interval_minutes: 30,
      enabled: 1,
      duration_days: 30,
      google_customer_id: null,
      google_campaign_id: null,
      current_final_url: null,
      current_final_url_suffix: null,
      progress: 0,
      total_swaps: 10,
      success_swaps: 10,
      failed_swaps: 0,
      url_changed_count: 10,
      swap_history: '[]',
      status: 'completed',
      error_message: null,
      error_at: null,
      started_at: '2026-01-06T00:00:00.000Z',
      completed_at: '2026-01-10T00:00:00.000Z',
      next_swap_at: null,
      is_deleted: 0,
      deleted_at: null,
      created_at: '2026-01-06T00:00:00.000Z',
      updated_at: '2026-01-10T00:00:00.000Z',
      consecutive_failures: 0,
    })

    const task = await getUrlSwapTaskById('task-1', 1)
    expect(task?.progress).toBe(100)
  })
})

