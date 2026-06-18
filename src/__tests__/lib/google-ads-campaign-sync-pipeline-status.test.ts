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
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    queryOne: dbMocks.queryOne,
    exec: dbMocks.exec,
  })),
  utcNowIso: vi.fn(() => '2026-06-16T08:50:08.453Z'),
}))

vi.mock('@/lib/queue', () => ({
  getQueueManager: vi.fn(() => ({
    ensureInitialized: queueMocks.ensureInitialized,
    getPendingTasksForType: queueMocks.getPendingTasksForType,
    getRunningTasks: queueMocks.getRunningTasks,
    removeTask: queueMocks.removeTask,
  })),
  getBackgroundQueueManager: vi.fn(),
  isBackgroundQueueSplitEnabled: vi.fn(() => false),
  getQueueManagerForTaskType: vi.fn(() => ({
    ensureInitialized: queueMocks.ensureInitialized,
    enqueue: vi.fn(),
  })),
}))

import {
  GOOGLE_ADS_CAMPAIGN_SYNC_LOG_TYPE,
  GOOGLE_ADS_CAMPAIGN_SYNC_TASK_TYPE,
  getGoogleAdsCampaignSyncQueueCountsForUser,
  markStaleGoogleAdsCampaignSyncLogs,
  reconcileStaleGoogleAdsCampaignSyncPendingTasks,
  userHasActiveGoogleAdsCampaignSyncWork,
} from '@/lib/google-ads/campaign/sync-pipeline-status'

describe('@/lib/google-ads/campaign/sync-pipeline-status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queueMocks.getPendingTasksForType.mockResolvedValue([])
    queueMocks.getRunningTasks.mockResolvedValue([])
    queueMocks.removeTask.mockResolvedValue(true)
    dbMocks.queryOne.mockResolvedValue(null)
    dbMocks.exec.mockResolvedValue({ changes: 2 })
  })

  it('userHasActiveGoogleAdsCampaignSyncWork returns active when queue has pending tasks', async () => {
    queueMocks.getPendingTasksForType.mockResolvedValue([
      { type: GOOGLE_ADS_CAMPAIGN_SYNC_TASK_TYPE, userId: 2, status: 'pending' },
    ])

    const result = await userHasActiveGoogleAdsCampaignSyncWork(2)

    expect(result.active).toBe(true)
    expect(result.reason).toBe('queue')
    expect(result.pending).toBe(1)
    expect(dbMocks.queryOne).not.toHaveBeenCalled()
  })

  it('userHasActiveGoogleAdsCampaignSyncWork returns active when recent running sync_log exists', async () => {
    dbMocks.queryOne.mockResolvedValue({ id: 99 })

    const result = await userHasActiveGoogleAdsCampaignSyncWork(2)

    expect(result.active).toBe(true)
    expect(result.reason).toBe('sync_log')
    const sql = String(dbMocks.queryOne.mock.calls[0][0])
    expect(sql).toContain('sync_type = ?')
    expect(dbMocks.queryOne.mock.calls[0][1]).toEqual([2, GOOGLE_ADS_CAMPAIGN_SYNC_LOG_TYPE])
  })

  it('markStaleGoogleAdsCampaignSyncLogs updates stale running rows', async () => {
    const closed = await markStaleGoogleAdsCampaignSyncLogs({ userId: 2, staleMinutes: 45 })

    expect(closed).toBe(2)
    const sql = String(dbMocks.exec.mock.calls[0][0])
    expect(sql).toContain("status = 'failed'")
    expect(sql).toContain('sync_type = ?')
    expect(dbMocks.exec.mock.calls[0][1][2]).toBe(GOOGLE_ADS_CAMPAIGN_SYNC_LOG_TYPE)
    expect(dbMocks.exec.mock.calls[0][1][3]).toBe(2)
  })

  it('getGoogleAdsCampaignSyncQueueCountsForUser only counts pending/running tasks for user', async () => {
    queueMocks.getPendingTasksForType.mockResolvedValue([
      { id: 'a', type: GOOGLE_ADS_CAMPAIGN_SYNC_TASK_TYPE, userId: 2, status: 'pending' },
      { id: 'b', type: GOOGLE_ADS_CAMPAIGN_SYNC_TASK_TYPE, userId: 3, status: 'pending' },
      { id: 'c', type: GOOGLE_ADS_CAMPAIGN_SYNC_TASK_TYPE, userId: 2, status: 'completed' },
    ])
    queueMocks.getRunningTasks.mockResolvedValue([
      { id: 'd', type: GOOGLE_ADS_CAMPAIGN_SYNC_TASK_TYPE, userId: 2, status: 'running' },
    ])

    const result = await getGoogleAdsCampaignSyncQueueCountsForUser(2)

    expect(result).toEqual({ pending: 1, running: 1 })
  })

  it('reconcileStaleGoogleAdsCampaignSyncPendingTasks removes pending tasks superseded by completed sync_log', async () => {
    queueMocks.getPendingTasksForType.mockResolvedValue([
      {
        id: 'stale-1',
        type: GOOGLE_ADS_CAMPAIGN_SYNC_TASK_TYPE,
        userId: 2,
        status: 'pending',
        createdAt: 1_000,
      },
    ])
    dbMocks.queryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ completed_at: '2026-06-16T08:50:08.453Z' })

    const result = await reconcileStaleGoogleAdsCampaignSyncPendingTasks(2)

    expect(result.removed).toBe(1)
    expect(queueMocks.removeTask).toHaveBeenCalledWith('stale-1')
  })

  it('reconcileStaleGoogleAdsCampaignSyncPendingTasks removes never-started pending tasks after timeout', async () => {
    const staleCreatedAt = Date.now() - 130_000
    queueMocks.getPendingTasksForType.mockResolvedValue([
      {
        id: 'stale-timeout',
        type: GOOGLE_ADS_CAMPAIGN_SYNC_TASK_TYPE,
        userId: 2,
        status: 'pending',
        createdAt: staleCreatedAt,
      },
    ])
    dbMocks.queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    const result = await reconcileStaleGoogleAdsCampaignSyncPendingTasks(2)

    expect(result.removed).toBe(1)
    expect(queueMocks.removeTask).toHaveBeenCalledWith('stale-timeout')
  })
})
