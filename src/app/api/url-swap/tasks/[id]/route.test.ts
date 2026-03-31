import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DELETE } from './route'

const dbFns = vi.hoisted(() => ({
  exec: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
}))

const queueCleanupFns = vi.hoisted(() => ({
  removePendingUrlSwapQueueTasksByTaskIds: vi.fn(async () => ({ removedCount: 1, scannedCount: 3 })),
}))

const urlSwapFns = vi.hoisted(() => ({
  getUrlSwapTaskById: vi.fn(async () => ({ id: 'us-task-1', user_id: 1, status: 'enabled' })),
  getUrlSwapTaskStats: vi.fn(async () => ({})),
  updateUrlSwapTask: vi.fn(async () => ({})),
  getUrlSwapTaskTargets: vi.fn(async () => []),
}))

vi.mock('@/lib/url-swap', () => ({
  getUrlSwapTaskById: urlSwapFns.getUrlSwapTaskById,
  getUrlSwapTaskStats: urlSwapFns.getUrlSwapTaskStats,
  updateUrlSwapTask: urlSwapFns.updateUrlSwapTask,
  getUrlSwapTaskTargets: urlSwapFns.getUrlSwapTaskTargets,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'postgres',
    exec: dbFns.exec,
    query: dbFns.query,
    queryOne: dbFns.queryOne,
  })),
}))

vi.mock('@/lib/url-swap/queue-cleanup', () => ({
  removePendingUrlSwapQueueTasksByTaskIds: queueCleanupFns.removePendingUrlSwapQueueTasksByTaskIds,
}))

vi.mock('@/lib/url-swap-scheduler', () => ({
  triggerUrlSwapScheduling: vi.fn(async () => {}),
}))

describe('DELETE /api/url-swap/tasks/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    urlSwapFns.getUrlSwapTaskById.mockResolvedValue({ id: 'us-task-1', user_id: 1, status: 'enabled' })
    dbFns.exec.mockResolvedValue({ changes: 1 })
    queueCleanupFns.removePendingUrlSwapQueueTasksByTaskIds.mockResolvedValue({ removedCount: 1, scannedCount: 3 })
  })

  it('cleans url-swap queue by task id when deleting task', async () => {
    const req = new NextRequest('http://localhost/api/url-swap/tasks/us-task-1', {
      method: 'DELETE',
      headers: { 'x-user-id': '1' },
    })

    const res = await DELETE(req, { params: Promise.resolve({ id: 'us-task-1' }) })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(dbFns.exec).toHaveBeenCalledTimes(1)
    expect(dbFns.exec).toHaveBeenCalledWith(expect.stringContaining('UPDATE url_swap_tasks'), expect.any(Array))
    expect(queueCleanupFns.removePendingUrlSwapQueueTasksByTaskIds).toHaveBeenCalledWith(['us-task-1'], 1)
  })
})
