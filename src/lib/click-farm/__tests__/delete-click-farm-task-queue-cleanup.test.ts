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

const removePendingClickFarmQueueTasksByTaskIds = vi.fn(async () => ({ removedCount: 1, scannedCount: 2 }))
vi.mock('@/lib/click-farm/queue-cleanup', () => ({
  removePendingClickFarmQueueTasksByTaskIds,
}))

describe('deleteClickFarmTask queue cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    exec.mockResolvedValue({ changes: 1 })
    removePendingClickFarmQueueTasksByTaskIds.mockResolvedValue({ removedCount: 1, scannedCount: 2 })
  })

  it('removes pending queue tasks for deleted click-farm task', async () => {
    const { deleteClickFarmTask } = await import('../../click-farm')

    await deleteClickFarmTask('cf-task-1001', 8)

    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec.mock.calls[0][0]).toContain('UPDATE click_farm_tasks')
    expect(exec.mock.calls[0][1]).toEqual(['cf-task-1001', 8])
    expect(removePendingClickFarmQueueTasksByTaskIds).toHaveBeenCalledWith(['cf-task-1001'], 8)
  })
})
