import { describe, expect, it, vi, beforeEach } from 'vitest'

const dbMocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  exec: vi.fn(),
}))

const queueMocks = vi.hoisted(() => ({
  getPendingTasksForType: vi.fn(),
  getRunningTasks: vi.fn(),
  ensureInitialized: vi.fn(),
  removeTask: vi.fn(),
  cleanupZombieTasks: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    queryOne: dbMocks.queryOne,
    exec: dbMocks.exec,
  })),
  utcNowIso: vi.fn(() => '2026-07-02T01:00:00.000Z'),
}))

vi.mock('@/lib/queue', () => ({
  getQueueManager: vi.fn(() => ({
    ensureInitialized: queueMocks.ensureInitialized,
    getPendingTasksForType: queueMocks.getPendingTasksForType,
    getRunningTasks: queueMocks.getRunningTasks,
    removeTask: queueMocks.removeTask,
    cleanupZombieTasks: queueMocks.cleanupZombieTasks,
  })),
}))

import {
  PERFORMANCE_SYNC_TASK_TYPE,
  getPerformanceSyncQueueCountsForUser,
  markStalePerformanceSyncLogs,
  preparePerformanceSyncScheduling,
  reconcileStalePerformanceSyncPendingTasks,
  userHasActivePerformanceSyncWork,
} from '@/lib/campaign/performance-sync-pipeline-status'

describe('@/lib/campaign/performance-sync-pipeline-status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queueMocks.getPendingTasksForType.mockResolvedValue([])
    queueMocks.getRunningTasks.mockResolvedValue([])
    queueMocks.removeTask.mockResolvedValue(true)
    queueMocks.cleanupZombieTasks.mockResolvedValue({ cleaned: 0, details: '' })
    dbMocks.queryOne.mockResolvedValue(null)
    dbMocks.exec.mockResolvedValue({ changes: 2 })
  })

  it('userHasActivePerformanceSyncWork returns active when queue has pending tasks', async () => {
    queueMocks.getPendingTasksForType.mockResolvedValue([
      { type: PERFORMANCE_SYNC_TASK_TYPE, userId: 2, status: 'pending' },
    ])

    const result = await userHasActivePerformanceSyncWork(2)

    expect(result.active).toBe(true)
    expect(result.reason).toBe('queue')
    expect(result.pending).toBe(1)
    expect(dbMocks.queryOne).not.toHaveBeenCalled()
  })

  it('userHasActivePerformanceSyncWork returns active when recent running sync_log exists', async () => {
    dbMocks.queryOne.mockResolvedValue({ id: 99 })

    const result = await userHasActivePerformanceSyncWork(2)

    expect(result.active).toBe(true)
    expect(result.reason).toBe('sync_log')
    const sql = String(dbMocks.queryOne.mock.calls[0][0])
    expect(sql).toContain("sync_type IN ('auto', 'manual')")
    expect(dbMocks.queryOne.mock.calls[0][1]).toEqual([2])
  })

  it('markStalePerformanceSyncLogs updates stale running rows', async () => {
    const closed = await markStalePerformanceSyncLogs({ userId: 2, staleMinutes: 45 })

    expect(closed).toBe(2)
    const sql = String(dbMocks.exec.mock.calls[0][0])
    expect(sql).toContain("status = 'failed'")
    expect(sql).toContain("sync_type IN ('auto', 'manual')")
    expect(dbMocks.exec.mock.calls[0][1][2]).toBe(2)
  })

  it('getPerformanceSyncQueueCountsForUser only counts pending/running tasks for user', async () => {
    queueMocks.getPendingTasksForType.mockResolvedValue([
      { id: 'a', type: PERFORMANCE_SYNC_TASK_TYPE, userId: 2, status: 'pending' },
      { id: 'b', type: PERFORMANCE_SYNC_TASK_TYPE, userId: 3, status: 'pending' },
      { id: 'c', type: PERFORMANCE_SYNC_TASK_TYPE, userId: 2, status: 'completed' },
    ])
    queueMocks.getRunningTasks.mockResolvedValue([
      { id: 'd', type: PERFORMANCE_SYNC_TASK_TYPE, userId: 2, status: 'running' },
    ])

    const result = await getPerformanceSyncQueueCountsForUser(2)

    expect(result).toEqual({ pending: 1, running: 1 })
  })

  it('reconcileStalePerformanceSyncPendingTasks removes pending tasks superseded by completed sync_log', async () => {
    queueMocks.getPendingTasksForType.mockResolvedValue([
      {
        id: 'stale-1',
        type: PERFORMANCE_SYNC_TASK_TYPE,
        userId: 2,
        status: 'pending',
        createdAt: 1_000,
      },
    ])
    dbMocks.queryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ completed_at: '2026-07-02T01:00:00.000Z' })

    const result = await reconcileStalePerformanceSyncPendingTasks(2)

    expect(result.removed).toBe(1)
    expect(queueMocks.removeTask).toHaveBeenCalledWith('stale-1')
  })

  it('reconcileStalePerformanceSyncPendingTasks removes never-started pending tasks after timeout', async () => {
    const staleCreatedAt = Date.now() - 31 * 60 * 1000
    queueMocks.getPendingTasksForType.mockResolvedValue([
      {
        id: 'stale-timeout',
        type: PERFORMANCE_SYNC_TASK_TYPE,
        userId: 2,
        status: 'pending',
        createdAt: staleCreatedAt,
      },
    ])
    dbMocks.queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    const result = await reconcileStalePerformanceSyncPendingTasks(2)

    expect(result.removed).toBe(1)
    expect(queueMocks.removeTask).toHaveBeenCalledWith('stale-timeout')
  })

  it('reconcileStalePerformanceSyncPendingTasks keeps recent pending tasks', async () => {
    queueMocks.getPendingTasksForType.mockResolvedValue([
      {
        id: 'fresh-pending',
        type: PERFORMANCE_SYNC_TASK_TYPE,
        userId: 2,
        status: 'pending',
        createdAt: Date.now() - 5 * 60 * 1000,
      },
    ])
    dbMocks.queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    const result = await reconcileStalePerformanceSyncPendingTasks(2)

    expect(result.removed).toBe(0)
    expect(queueMocks.removeTask).not.toHaveBeenCalled()
  })

  it('preparePerformanceSyncScheduling runs log cleanup, zombie cleanup, and pending reconcile', async () => {
    queueMocks.getPendingTasksForType.mockResolvedValue([
      {
        id: 'stale-timeout',
        type: PERFORMANCE_SYNC_TASK_TYPE,
        userId: 2,
        status: 'pending',
        createdAt: Date.now() - 31 * 60 * 1000,
      },
    ])
    queueMocks.cleanupZombieTasks.mockResolvedValue({ cleaned: 1, details: 'task-1' })
    dbMocks.queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    const result = await preparePerformanceSyncScheduling([2])

    expect(result.staleLogsClosed).toBe(2)
    expect(result.staleRunningTasksCleaned).toBe(1)
    expect(result.stalePendingRemoved).toBe(1)
    expect(queueMocks.cleanupZombieTasks).toHaveBeenCalledWith('runtime')
  })
})
