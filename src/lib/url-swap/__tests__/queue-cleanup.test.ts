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

describe('removePendingUrlSwapQueueTasksByTaskIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureInitializedCore.mockResolvedValue(undefined)
    ensureInitializedBg.mockResolvedValue(undefined)
    getPendingTasksCore.mockResolvedValue([])
    getPendingTasksBg.mockResolvedValue([])
    removeTaskCore.mockResolvedValue(true)
    removeTaskBg.mockResolvedValue(true)
  })

  it('removes matching url-swap pending tasks in both core and background queues', async () => {
    getPendingTasksCore.mockResolvedValue([
      {
        id: 'core-1',
        type: 'url-swap',
        userId: 10,
        data: { taskId: 'us-1' },
      },
      {
        id: 'core-2',
        type: 'click-farm',
        userId: 10,
        data: { taskId: 'us-1' },
      },
    ])
    getPendingTasksBg.mockResolvedValue([
      {
        id: 'bg-1',
        type: 'url-swap',
        userId: 10,
        data: { taskId: 'us-1' },
      },
      {
        id: 'bg-2',
        type: 'url-swap',
        userId: 11,
        data: { taskId: 'us-1' },
      },
      {
        id: 'bg-3',
        type: 'url-swap',
        userId: 10,
        data: { taskId: 'us-2' },
      },
    ])

    const { removePendingUrlSwapQueueTasksByTaskIds } = await import('../queue-cleanup')
    const result = await removePendingUrlSwapQueueTasksByTaskIds(['us-1'], 10)

    expect(removeTaskCore).toHaveBeenCalledTimes(1)
    expect(removeTaskCore).toHaveBeenCalledWith('core-1')
    expect(removeTaskBg).toHaveBeenCalledTimes(1)
    expect(removeTaskBg).toHaveBeenCalledWith('bg-1')
    expect(result).toEqual({ removedCount: 2, scannedCount: 5 })
  })

  it('ignores empty task ids input', async () => {
    const { removePendingUrlSwapQueueTasksByTaskIds } = await import('../queue-cleanup')
    const result = await removePendingUrlSwapQueueTasksByTaskIds(['', '   '])

    expect(result).toEqual({ removedCount: 0, scannedCount: 0 })
    expect(getPendingTasksCore).not.toHaveBeenCalled()
    expect(getPendingTasksBg).not.toHaveBeenCalled()
  })
})
