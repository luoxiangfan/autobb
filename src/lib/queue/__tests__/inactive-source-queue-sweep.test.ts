import { beforeEach, describe, expect, it, vi } from 'vitest'

const removeClickFarm = vi.fn(async () => ({ removedCount: 0, scannedCount: 0 }))
const removeUrlSwap = vi.fn(async () => ({ removedCount: 0, scannedCount: 0 }))

vi.mock('@/lib/click-farm/queue-cleanup', () => ({
  removePendingClickFarmQueueTasksByTaskIds: removeClickFarm,
}))
vi.mock('@/lib/url-swap/queue-cleanup', () => ({
  removePendingUrlSwapQueueTasksByTaskIds: removeUrlSwap,
}))

const query = vi.fn()

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'sqlite',
    query: query,
  })),
}))

describe('sweepPendingQueueTasksForInactiveClickFarmAndUrlSwap', () => {
  beforeEach(() => {
    removeClickFarm.mockReset()
    removeUrlSwap.mockReset()
    query.mockReset()
  })

  it('invokes queue cleanup for paused click-farm and disabled url-swap ids', async () => {
    query.mockImplementation(async (sql: string) => {
      if (String(sql).includes('click_farm_tasks')) {
        return [{ id: 'cf-1' }, { id: 'cf-2' }]
      }
      if (String(sql).includes('url_swap_tasks')) {
        return [{ id: 'us-9' }]
      }
      return []
    })
    removeClickFarm.mockResolvedValue({ removedCount: 2, scannedCount: 10 })
    removeUrlSwap.mockResolvedValue({ removedCount: 1, scannedCount: 4 })

    const { sweepPendingQueueTasksForInactiveClickFarmAndUrlSwap } = await import(
      '../inactive-source-queue-sweep'
    )
    const result = await sweepPendingQueueTasksForInactiveClickFarmAndUrlSwap()

    expect(removeClickFarm).toHaveBeenCalledWith(['cf-1', 'cf-2'])
    expect(removeUrlSwap).toHaveBeenCalledWith(['us-9'])
    expect(result).toMatchObject({
      pausedClickFarmIds: 2,
      disabledUrlSwapIds: 1,
      clickFarmQueueRemoved: 2,
      urlSwapQueueRemoved: 1,
      clickFarmQueueScanned: 10,
      urlSwapQueueScanned: 4,
    })
  })

  it('skips cleanup helpers when no ids', async () => {
    query.mockResolvedValue([])
    const { sweepPendingQueueTasksForInactiveClickFarmAndUrlSwap } = await import(
      '../inactive-source-queue-sweep'
    )
    await sweepPendingQueueTasksForInactiveClickFarmAndUrlSwap()

    expect(removeClickFarm).not.toHaveBeenCalled()
    expect(removeUrlSwap).not.toHaveBeenCalled()
  })
})
