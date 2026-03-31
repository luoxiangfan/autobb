import { beforeEach, describe, expect, it, vi } from 'vitest'

const exec = vi.fn(async () => ({ changes: 1 }))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    exec,
    query: vi.fn(async () => []),
    queryOne: vi.fn(async () => null),
    type: 'postgres',
  })),
}))

const removePendingUrlSwapQueueTasksByTaskIds = vi.fn(async () => ({ removedCount: 1, scannedCount: 2 }))
vi.mock('@/lib/url-swap/queue-cleanup', () => ({
  removePendingUrlSwapQueueTasksByTaskIds,
}))

describe('disableUrlSwapTask queue cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    exec.mockResolvedValue({ changes: 1 })
    removePendingUrlSwapQueueTasksByTaskIds.mockResolvedValue({ removedCount: 1, scannedCount: 2 })
  })

  it('removes pending queue tasks for disabled url-swap task', async () => {
    const { disableUrlSwapTask } = await import('../../url-swap')

    await disableUrlSwapTask('us-task-1001', 8)

    expect(exec).toHaveBeenCalledTimes(2)
    expect(exec.mock.calls[0][0]).toContain('UPDATE url_swap_tasks')
    expect(exec.mock.calls[1][0]).toContain('UPDATE url_swap_task_targets')
    expect(removePendingUrlSwapQueueTasksByTaskIds).toHaveBeenCalledWith(['us-task-1001'], 8)
  })
})
