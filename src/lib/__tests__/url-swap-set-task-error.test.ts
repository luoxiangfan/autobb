/**
 * Url Swap setTaskError 行为测试
 * - 单次失败：保持 enabled
 * - 连续3次失败：进入 error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let mockDb: any
let setTaskError: typeof import('../url-swap/url-swap-task-lifecycle').setTaskError

vi.mock('../db', () => ({
  getDatabase: () => mockDb,
}))

vi.mock('../url-swap/alerts/urgent-alerts', () => ({
  syncUrlSwapUrgentRiskAlert: vi.fn().mockResolvedValue(undefined),
  resolveUrlSwapUrgentRiskAlertsForOffer: vi.fn().mockResolvedValue(undefined),
}))

describe('setTaskError', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-08T00:00:00.000Z'))

    mockDb = {
      queryOne: vi.fn(),
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
    }
  })

  beforeEach(async () => {
    vi.resetModules()
    ;({ setTaskError } = await import('../url-swap/url-swap-task-lifecycle'))
  }, 30_000)

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('单次失败不会进入 error（保持 enabled）', async () => {
    mockDb.queryOne.mockResolvedValueOnce({
      consecutive_failures: 0,
      failed_swaps: 0,
      total_swaps: 0,
      swap_interval_minutes: 1440,
      user_id: 1,
      offer_id: 10,
      offer_name: 'Test Offer',
    })

    await setTaskError('task-1', 'boom', 'link_resolution')

    expect(mockDb.exec).toHaveBeenCalledTimes(1)
    const [_sql, params] = mockDb.exec.mock.calls[0]
    expect(params[0]).toBe('enabled')
    expect(params[3]).toBe(1)
  })

  it('连续3次失败进入 error', async () => {
    mockDb.queryOne.mockResolvedValueOnce({
      consecutive_failures: 2,
      failed_swaps: 2,
      total_swaps: 2,
      swap_interval_minutes: 1440,
      user_id: 1,
      offer_id: 10,
      offer_name: 'Test Offer',
    })

    await setTaskError('task-1', 'boom', 'google_ads_api')

    expect(mockDb.exec).toHaveBeenCalledTimes(1)
    const [_sql, params] = mockDb.exec.mock.calls[0]
    expect(params[0]).toBe('error')
    expect(params[3]).toBe(3)
  })
})
