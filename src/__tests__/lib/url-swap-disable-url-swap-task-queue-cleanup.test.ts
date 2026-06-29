import { beforeEach, describe, expect, it, vi } from 'vitest'

const exec = vi.fn(async () => ({ changes: 2 }))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    exec,
    query: vi.fn(async () => []),
    queryOne: vi.fn(async () => null),
  })),
}))

const suspendUrlSwapTaskExecution = vi.fn(async () => ({
  removedCount: 1,
  scannedCount: 2,
}))
vi.mock('@/lib/url-swap/queue-cleanup', () => ({
  suspendUrlSwapTaskExecution,
}))

describe('disableUrlSwapTask child target suspension', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    exec.mockResolvedValue({ changes: 1 })
    suspendUrlSwapTaskExecution.mockResolvedValue({ removedCount: 1, scannedCount: 2 })
  })

  it('suspends campaign/sitelink child targets and clears queue when disabled', async () => {
    const { disableUrlSwapTask } = await import('@/lib/url-swap')

    await disableUrlSwapTask('us-task-1001', 8)

    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec.mock.calls[0][0]).toContain('UPDATE url_swap_tasks')
    expect(suspendUrlSwapTaskExecution).toHaveBeenCalledWith('us-task-1001', 8)
  })
})
