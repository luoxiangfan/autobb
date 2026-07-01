import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pauseOfferTasksBatch } from '@/lib/campaign/server'

const dbFns = vi.hoisted(() => ({
  query: vi.fn(),
  exec: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    query: dbFns.query,
    exec: dbFns.exec,
    transaction: dbFns.transaction,
  })),
}))

vi.mock('@/lib/click-farm/queue-cleanup', () => ({
  removePendingClickFarmQueueTasksByTaskIds: vi.fn(async () => {}),
}))

vi.mock('@/lib/url-swap/queue-cleanup', () => ({
  removePendingUrlSwapQueueTasksByTaskIds: vi.fn(async () => {}),
}))

describe('pauseOfferTasksBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.exec.mockResolvedValue({ changes: 0 })
    dbFns.transaction.mockImplementation(async (fn: () => Promise<unknown>) => fn())
    dbFns.query.mockImplementation(async (_sql: string, params?: any[]) => {
      const offerId = Number(params?.[3] ?? 0)
      if (offerId === 2) {
        throw new Error('db query failed for offer 2')
      }
      return []
    })
  })

  it('includes error field when one offer fails', async () => {
    const results = await pauseOfferTasksBatch([1, 2], 7)

    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({
      offerId: 1,
      result: {
        clickFarmTaskPaused: false,
        clickFarmTaskCount: 0,
        urlSwapTaskDisabled: false,
        urlSwapTaskCount: 0,
      },
    })

    expect(results[1]).toEqual({
      offerId: 2,
      result: {
        clickFarmTaskPaused: false,
        clickFarmTaskCount: 0,
        urlSwapTaskDisabled: false,
        urlSwapTaskCount: 0,
      },
      error: 'db query failed for offer 2',
    })
  })
})
