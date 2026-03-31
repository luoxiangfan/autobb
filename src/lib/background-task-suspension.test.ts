import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(),
}))

vi.mock('@/lib/queue', () => ({
  getQueueManager: vi.fn(),
  getBackgroundQueueManager: vi.fn(),
}))

import { getDatabase } from '@/lib/db'
import { getBackgroundQueueManager, getQueueManager } from '@/lib/queue'
import {
  suspendBackgroundTasksForInactiveOrExpiredUsers,
  suspendUserBackgroundTasks,
  USER_SUSPENDED_TASK_TYPES,
} from '@/lib/background-task-suspension'

describe('background-task-suspension', () => {
  const exec = vi.fn()
  const query = vi.fn()

  const coreQueue = {
    purgePendingTasksByUserAndTypes: vi.fn(),
    getConfig: vi.fn(() => ({ redisKeyPrefix: 'queue:' })),
  }

  const bgQueue = {
    purgePendingTasksByUserAndTypes: vi.fn(),
    getConfig: vi.fn(() => ({ redisKeyPrefix: 'queue:bg:' })),
  }

  beforeEach(() => {
    vi.resetAllMocks()

    exec.mockReset()
    query.mockReset()

    vi.mocked(getDatabase).mockReturnValue({
      type: 'sqlite',
      exec,
      query,
      queryOne: vi.fn(),
      transaction: vi.fn(),
      close: vi.fn(),
    } as any)

    vi.mocked(getQueueManager).mockReturnValue(coreQueue as any)
    vi.mocked(getBackgroundQueueManager).mockReturnValue(bgQueue as any)
  })

  it('covers all user task types for queue purge', () => {
    expect(USER_SUSPENDED_TASK_TYPES).toContain('click-farm')
    expect(USER_SUSPENDED_TASK_TYPES).toContain('url-swap')
    expect(USER_SUSPENDED_TASK_TYPES).toContain('openclaw-strategy')
    expect(USER_SUSPENDED_TASK_TYPES).toContain('sync')
    expect(USER_SUSPENDED_TASK_TYPES).toContain('offer-extraction')
  })

  it('suspendUserBackgroundTasks stops click-farm, disables url-swap, and purges both queues', async () => {
    exec
      .mockResolvedValueOnce({ changes: 2 }) // click-farm
      .mockResolvedValueOnce({ changes: 3 }) // url-swap
      .mockResolvedValueOnce({ changes: 4 }) // url-swap targets

    coreQueue.purgePendingTasksByUserAndTypes.mockResolvedValueOnce({
      removedCount: 5,
      removedTaskIds: ['a'],
    })
    bgQueue.purgePendingTasksByUserAndTypes.mockResolvedValueOnce({
      removedCount: 7,
      removedTaskIds: ['b'],
    })

    const result = await suspendUserBackgroundTasks(42, { reason: 'manual_disable', purgeQueue: true })

    expect(exec).toHaveBeenCalledTimes(3)
    expect(exec.mock.calls[0][0]).toContain('UPDATE click_farm_tasks')
    expect(exec.mock.calls[0][1]).toEqual([42])
    expect(exec.mock.calls[1][0]).toContain('UPDATE url_swap_tasks')
    expect(exec.mock.calls[1][1]).toEqual([42])
    expect(exec.mock.calls[2][0]).toContain('UPDATE url_swap_task_targets')
    expect(exec.mock.calls[2][1]).toEqual([expect.any(String), 42])

    expect(coreQueue.purgePendingTasksByUserAndTypes).toHaveBeenCalledWith(42, USER_SUSPENDED_TASK_TYPES)
    expect(bgQueue.purgePendingTasksByUserAndTypes).toHaveBeenCalledWith(42, USER_SUSPENDED_TASK_TYPES)

    expect(result).toEqual({
      clickFarmStopped: 2,
      urlSwapDisabled: 3,
      queuePurged: 12,
    })
  })

  it('suspendBackgroundTasksForInactiveOrExpiredUsers targets inactive+expired users and keeps tasks paused', async () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    const future = new Date(Date.now() + 60_000).toISOString()

    query.mockResolvedValueOnce([
      { id: 1, is_active: 0, package_expires_at: null }, // inactive
      { id: 2, is_active: 1, package_expires_at: past }, // expired
      { id: 3, is_active: 1, package_expires_at: future }, // ok
      { id: 4, is_active: 1, package_expires_at: 'not-a-date' }, // treat as expired
    ])

    exec
      .mockResolvedValueOnce({ changes: 10 }) // bulk stop click-farm
      .mockResolvedValueOnce({ changes: 20 }) // bulk disable url-swap
      .mockResolvedValueOnce({ changes: 30 }) // bulk pause url-swap targets

    coreQueue.purgePendingTasksByUserAndTypes.mockResolvedValue({ removedCount: 1, removedTaskIds: [] })
    bgQueue.purgePendingTasksByUserAndTypes.mockResolvedValue({ removedCount: 2, removedTaskIds: [] })

    const result = await suspendBackgroundTasksForInactiveOrExpiredUsers({ purgeQueue: true })

    expect(result.affectedUserIds.sort()).toEqual([1, 2, 4])
    expect(result.clickFarmStopped).toBe(10)
    expect(result.urlSwapDisabled).toBe(20)
    expect(result.queuePurged).toBe(9) // (1+2) * 3 users

    expect(exec).toHaveBeenCalledTimes(3)
    expect(exec.mock.calls[0][0]).toContain('UPDATE click_farm_tasks')
    expect(exec.mock.calls[0][1]).toEqual([1, 2, 4])
    expect(exec.mock.calls[1][0]).toContain('UPDATE url_swap_tasks')
    expect(exec.mock.calls[1][1]).toEqual([1, 2, 4])
    expect(exec.mock.calls[2][0]).toContain('UPDATE url_swap_task_targets')
    expect(exec.mock.calls[2][1]).toEqual([expect.any(String), 1, 2, 4])

    expect(coreQueue.purgePendingTasksByUserAndTypes).toHaveBeenCalledTimes(3)
    expect(bgQueue.purgePendingTasksByUserAndTypes).toHaveBeenCalledTimes(3)
  })
})
