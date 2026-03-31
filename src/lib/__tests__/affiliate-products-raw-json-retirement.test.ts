import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

function createMockDb(params?: {
  queryOne?: ReturnType<typeof vi.fn>
  exec?: ReturnType<typeof vi.fn>
}) {
  return {
    type: 'postgres' as const,
    query: vi.fn().mockResolvedValue([]),
    queryOne: params?.queryOne || vi.fn(),
    exec: params?.exec || vi.fn().mockResolvedValue({ changes: 0 }),
    transaction: async (fn: () => Promise<unknown>) => await fn(),
    close: async () => {},
  }
}

describe('runAffiliateProductsRawJsonRetirementMaintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('no-ops when retirement control table is missing', async () => {
    const queryOne = vi.fn().mockRejectedValue(new Error('relation "affiliate_product_raw_json_retirement" does not exist'))
    const db = createMockDb({ queryOne })
    dbFns.getDatabase.mockResolvedValue(db)

    const { runAffiliateProductsRawJsonRetirementMaintenance } = await import('@/lib/affiliate-products')

    await expect(runAffiliateProductsRawJsonRetirementMaintenance()).resolves.toBeUndefined()
    expect(queryOne).toHaveBeenCalledTimes(1)
    expect(db.exec).not.toHaveBeenCalled()
  })

  it('clears raw_json in batches when cleanup is pending', async () => {
    const queryOne = vi.fn()
      .mockResolvedValueOnce({
        drop_after_at: '2099-01-01T00:00:00.000Z',
        cleanup_completed_at: null,
        raw_json_drop_completed_at: null,
      })
      .mockResolvedValueOnce({ exists: true })
      .mockResolvedValueOnce({ exists: true })
    const exec = vi.fn().mockResolvedValue({ changes: 128 })
    const db = createMockDb({ queryOne, exec })
    dbFns.getDatabase.mockResolvedValue(db)

    const { runAffiliateProductsRawJsonRetirementMaintenance } = await import('@/lib/affiliate-products')

    await runAffiliateProductsRawJsonRetirementMaintenance({ batchSize: 500 })

    expect(exec).toHaveBeenCalledTimes(1)
    expect(String(exec.mock.calls[0]?.[0] || '')).toContain('SET raw_json = NULL')
    expect(String(exec.mock.calls[0]?.[0] || '')).toContain('WITH target AS')
  })

  it('drops raw_json column after drop_after_at deadline', async () => {
    const queryOne = vi.fn()
      .mockResolvedValueOnce({
        drop_after_at: '2020-01-01T00:00:00.000Z',
        cleanup_completed_at: '2019-12-31T00:00:00.000Z',
        raw_json_drop_completed_at: null,
      })
      .mockResolvedValueOnce({ exists: true })
      .mockResolvedValueOnce({ acquired: true })
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: false })
    const exec = vi.fn()
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 1 })
    const db = createMockDb({ queryOne, exec })
    dbFns.getDatabase.mockResolvedValue(db)

    const { runAffiliateProductsRawJsonRetirementMaintenance } = await import('@/lib/affiliate-products')

    await runAffiliateProductsRawJsonRetirementMaintenance({ allowDropOutsideWindow: true })

    expect(exec).toHaveBeenCalledTimes(5)
    expect(exec.mock.calls.some((call) => String(call[0] || '').includes("SET LOCAL lock_timeout"))).toBe(true)
    expect(exec.mock.calls.some((call) => String(call[0] || '').includes("SET LOCAL statement_timeout"))).toBe(true)
    expect(exec.mock.calls.some((call) => String(call[0] || '').includes('ALTER TABLE affiliate_products DROP COLUMN IF EXISTS raw_json'))).toBe(true)
  })

  it('defers raw_json drop outside low-traffic window', async () => {
    const queryOne = vi.fn()
      .mockResolvedValueOnce({
        drop_after_at: '2020-01-01T00:00:00.000Z',
        cleanup_completed_at: '2019-12-31T00:00:00.000Z',
        raw_json_drop_completed_at: null,
      })
      .mockResolvedValueOnce({ exists: true })
      .mockResolvedValueOnce({ exists: true })
    const exec = vi.fn().mockResolvedValue({ changes: 1 })
    const db = createMockDb({ queryOne, exec })
    dbFns.getDatabase.mockResolvedValue(db)

    const { runAffiliateProductsRawJsonRetirementMaintenance } = await import('@/lib/affiliate-products')

    await runAffiliateProductsRawJsonRetirementMaintenance({
      now: new Date('2026-01-01T00:00:00.000Z'),
      allowDropOutsideWindow: false,
    })

    expect(exec).toHaveBeenCalledTimes(0)
  })
})
