import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  exec: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'postgres',
    query: dbFns.query,
    queryOne: dbFns.queryOne,
    exec: dbFns.exec,
    transaction: async (fn: () => Promise<unknown>) => await fn(),
    close: async () => {},
  })),
}))

describe('getLatestFailedAffiliateProductSyncRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.query.mockResolvedValue([])
    dbFns.exec.mockResolvedValue({ changes: 0 })
  })

  it('returns null when no failed cursor run exists', async () => {
    dbFns.queryOne.mockResolvedValueOnce(null)

    const { getLatestFailedAffiliateProductSyncRun } = await import('@/lib/affiliate-products')
    const result = await getLatestFailedAffiliateProductSyncRun({
      userId: 1,
      platform: 'yeahpromos',
      mode: 'platform',
    })

    expect(result).toBeNull()
    expect(dbFns.queryOne).toHaveBeenCalledTimes(1)
  })

  it('returns failed run when there is no newer completed run', async () => {
    dbFns.queryOne
      .mockResolvedValueOnce({
        id: 109,
        user_id: 1,
        platform: 'yeahpromos',
        mode: 'platform',
        status: 'failed',
        trigger_source: 'manual',
        total_items: 54600,
        created_count: 53843,
        updated_count: 757,
        failed_count: 1,
        cursor_page: 64,
        cursor_scope: 'amazon.de',
        processed_batches: 478,
        last_heartbeat_at: null,
        error_message: 'session expired',
        started_at: '2026-02-28T00:00:00.000Z',
        completed_at: '2026-02-28T00:30:00.000Z',
        created_at: '2026-02-28T00:00:00.000Z',
        updated_at: '2026-02-28T00:30:00.000Z',
      })
      .mockResolvedValueOnce(null)

    const { getLatestFailedAffiliateProductSyncRun } = await import('@/lib/affiliate-products')
    const result = await getLatestFailedAffiliateProductSyncRun({
      userId: 1,
      platform: 'yeahpromos',
      mode: 'platform',
    })

    expect(result).toMatchObject({
      id: 109,
      cursor_page: 64,
      cursor_scope: 'amazon.de',
      status: 'failed',
    })
    expect(dbFns.queryOne).toHaveBeenCalledTimes(2)
  })

  it('returns null when a newer completed run exists', async () => {
    dbFns.queryOne
      .mockResolvedValueOnce({
        id: 109,
        user_id: 1,
        platform: 'yeahpromos',
        mode: 'platform',
        status: 'failed',
        trigger_source: 'manual',
        total_items: 54600,
        created_count: 53843,
        updated_count: 757,
        failed_count: 1,
        cursor_page: 64,
        cursor_scope: 'amazon.de',
        processed_batches: 478,
        last_heartbeat_at: null,
        error_message: 'session expired',
        started_at: '2026-02-28T00:00:00.000Z',
        completed_at: '2026-02-28T00:30:00.000Z',
        created_at: '2026-02-28T00:00:00.000Z',
        updated_at: '2026-02-28T00:30:00.000Z',
      })
      .mockResolvedValueOnce({ id: 112 })

    const { getLatestFailedAffiliateProductSyncRun } = await import('@/lib/affiliate-products')
    const result = await getLatestFailedAffiliateProductSyncRun({
      userId: 1,
      platform: 'yeahpromos',
      mode: 'platform',
    })

    expect(result).toBeNull()
    expect(dbFns.queryOne).toHaveBeenCalledTimes(2)
    const secondCallArgs = dbFns.queryOne.mock.calls[1]?.[1] || []
    expect(secondCallArgs).toEqual([1, 'yeahpromos', 'platform', 109])
  })
})
