import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  query: vi.fn(),
  exec: vi.fn(),
}))

const queueCleanupFns = vi.hoisted(() => ({
  removePendingClickFarmQueueTasksByTaskIds: vi.fn(),
  removePendingUrlSwapQueueTasksByTaskIds: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'sqlite',
    query: dbFns.query,
    exec: dbFns.exec,
    transaction: async (fn: () => Promise<unknown>) => fn(),
  })),
}))

vi.mock('@/lib/click-farm/queue-cleanup', () => ({
  removePendingClickFarmQueueTasksByTaskIds:
    queueCleanupFns.removePendingClickFarmQueueTasksByTaskIds,
}))

vi.mock('@/lib/url-swap/queue-cleanup', () => ({
  removePendingUrlSwapQueueTasksByTaskIds:
    queueCleanupFns.removePendingUrlSwapQueueTasksByTaskIds,
}))

import { pauseOfferTasks } from '@/lib/campaign-offer-tasks'

describe('pauseOfferTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.exec.mockResolvedValue({ changes: 1 })
    queueCleanupFns.removePendingClickFarmQueueTasksByTaskIds.mockResolvedValue({
      removedCount: 2,
      scannedCount: 10,
    })
    queueCleanupFns.removePendingUrlSwapQueueTasksByTaskIds.mockResolvedValue({
      removedCount: 1,
      scannedCount: 8,
    })
  })

  it('pauses all active tasks for the offer', async () => {
    dbFns.query
      .mockResolvedValueOnce([{ id: 'cf-1' }, { id: 'cf-2' }])
      .mockResolvedValueOnce([{ id: 'us-1' }])

    const result = await pauseOfferTasks(123, 7)

    expect(dbFns.exec).toHaveBeenCalledTimes(2)
    expect(queueCleanupFns.removePendingClickFarmQueueTasksByTaskIds).toHaveBeenCalledWith(
      ['cf-1', 'cf-2'],
      7
    )
    expect(queueCleanupFns.removePendingUrlSwapQueueTasksByTaskIds).toHaveBeenCalledWith(
      ['us-1'],
      7
    )
    expect(result).toEqual({
      clickFarmTaskPaused: true,
      clickFarmTaskId: 'cf-1',
      clickFarmTaskCount: 2,
      urlSwapTaskDisabled: true,
      urlSwapTaskId: 'us-1',
      urlSwapTaskCount: 1,
    })
  })

  it('only disables url swap tasks in enabled or error status', async () => {
    dbFns.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'us-1' }])

    await pauseOfferTasks(123, 7)

    const urlSwapSelectSql = String(dbFns.query.mock.calls[1][0] || '')
    const urlSwapUpdateSql = String(dbFns.exec.mock.calls[0][0] || '')

    expect(urlSwapSelectSql).toContain("status IN ('enabled', 'error')")
    expect(urlSwapUpdateSql).toContain("status IN ('enabled', 'error')")
    expect(urlSwapSelectSql).not.toContain("status != 'disabled'")
    expect(urlSwapUpdateSql).not.toContain("status != 'disabled'")
  })

  it('returns no-op when no tasks need update', async () => {
    dbFns.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const result = await pauseOfferTasks(123, 7)

    expect(dbFns.exec).not.toHaveBeenCalled()
    expect(queueCleanupFns.removePendingClickFarmQueueTasksByTaskIds).not.toHaveBeenCalled()
    expect(queueCleanupFns.removePendingUrlSwapQueueTasksByTaskIds).not.toHaveBeenCalled()
    expect(result).toEqual({
      clickFarmTaskPaused: false,
      clickFarmTaskCount: 0,
      urlSwapTaskDisabled: false,
      urlSwapTaskCount: 0,
    })
  })
})
