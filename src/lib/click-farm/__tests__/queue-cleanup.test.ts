import { beforeEach, describe, expect, it, vi } from 'vitest'

const ensureInitializedCore = vi.fn(async () => {})
const ensureInitializedBg = vi.fn(async () => {})
const getPendingTasksCore = vi.fn(async () => [])
const getPendingTasksBg = vi.fn(async () => [])
const removeTaskCore = vi.fn(async () => true)
const removeTaskBg = vi.fn(async () => true)

const coreQueue = {
  ensureInitialized: ensureInitializedCore,
  getPendingTasks: getPendingTasksCore,
  removeTask: removeTaskCore,
}

const bgQueue = {
  ensureInitialized: ensureInitializedBg,
  getPendingTasks: getPendingTasksBg,
  removeTask: removeTaskBg,
}

vi.mock('@/lib/queue/unified-queue-manager', () => ({
  getQueueManager: vi.fn(() => coreQueue),
  getBackgroundQueueManager: vi.fn(() => bgQueue),
}))

describe('removePendingClickFarmQueueTasksByTaskIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureInitializedCore.mockResolvedValue(undefined)
    ensureInitializedBg.mockResolvedValue(undefined)
    getPendingTasksCore.mockResolvedValue([])
    getPendingTasksBg.mockResolvedValue([])
    removeTaskCore.mockResolvedValue(true)
    removeTaskBg.mockResolvedValue(true)
  })

  it('removes matching click-farm pending tasks in both core and background queues', async () => {
    getPendingTasksCore.mockResolvedValue([
      {
        id: 'core-1',
        type: 'click-farm',
        userId: 10,
        data: { taskId: 'cf-1' },
      },
      {
        id: 'core-2',
        type: 'url-swap',
        userId: 10,
        data: { taskId: 'cf-1' },
      },
    ])
    getPendingTasksBg.mockResolvedValue([
      {
        id: 'bg-1',
        type: 'click-farm',
        userId: 10,
        data: { taskId: 'cf-1' },
      },
      {
        id: 'bg-2',
        type: 'click-farm',
        userId: 11,
        data: { taskId: 'cf-1' },
      },
      {
        id: 'bg-3',
        type: 'click-farm',
        userId: 10,
        data: { taskId: 'cf-2' },
      },
    ])

    const { removePendingClickFarmQueueTasksByTaskIds } = await import('../queue-cleanup')
    const result = await removePendingClickFarmQueueTasksByTaskIds(['cf-1'], 10)

    expect(removeTaskCore).toHaveBeenCalledTimes(1)
    expect(removeTaskCore).toHaveBeenCalledWith('core-1')
    expect(removeTaskBg).toHaveBeenCalledTimes(1)
    expect(removeTaskBg).toHaveBeenCalledWith('bg-1')
    expect(result).toEqual({ removedCount: 2, scannedCount: 5 })
  })

  it('ignores empty task ids input', async () => {
    const { removePendingClickFarmQueueTasksByTaskIds } = await import('../queue-cleanup')
    const result = await removePendingClickFarmQueueTasksByTaskIds(['', '   '])

    expect(result).toEqual({ removedCount: 0, scannedCount: 0 })
    expect(getPendingTasksCore).not.toHaveBeenCalled()
    expect(getPendingTasksBg).not.toHaveBeenCalled()
  })
})

