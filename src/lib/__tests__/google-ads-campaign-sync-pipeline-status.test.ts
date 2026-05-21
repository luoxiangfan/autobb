import { describe, expect, it, vi, beforeEach } from 'vitest'

const dbMocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  exec: vi.fn(),
}))

const queueMocks = vi.hoisted(() => ({
  getPendingTasksForType: vi.fn(),
  getRunningTasks: vi.fn(),
  ensureInitialized: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'postgres',
    queryOne: dbMocks.queryOne,
    exec: dbMocks.exec,
  })),
}))

vi.mock('@/lib/queue', () => ({
  getQueueManager: vi.fn(() => ({
    ensureInitialized: queueMocks.ensureInitialized,
    getPendingTasksForType: queueMocks.getPendingTasksForType,
    getRunningTasks: queueMocks.getRunningTasks,
  })),
  getBackgroundQueueManager: vi.fn(),
  isBackgroundQueueSplitEnabled: vi.fn(() => false),
}))

import {
  GOOGLE_ADS_CAMPAIGN_SYNC_LOG_TYPE,
  GOOGLE_ADS_CAMPAIGN_SYNC_TASK_TYPE,
  markStaleGoogleAdsCampaignSyncLogs,
  userHasActiveGoogleAdsCampaignSyncWork,
} from '@/lib/google-ads-campaign-sync-pipeline-status'

describe('google-ads-campaign-sync-pipeline-status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queueMocks.getPendingTasksForType.mockResolvedValue([])
    queueMocks.getRunningTasks.mockResolvedValue([])
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
    expect(dbMocks.queryOne.mock.calls[0][1]).toEqual([
      2,
      GOOGLE_ADS_CAMPAIGN_SYNC_LOG_TYPE,
    ])
  })

  it('markStaleGoogleAdsCampaignSyncLogs updates stale running rows', async () => {
    const closed = await markStaleGoogleAdsCampaignSyncLogs({ userId: 2, staleMinutes: 45 })

    expect(closed).toBe(2)
    const sql = String(dbMocks.exec.mock.calls[0][0])
    expect(sql).toContain("status = 'failed'")
    expect(sql).toContain('sync_type = ?')
    expect(dbMocks.exec.mock.calls[0][1][2]).toBe(2)
    expect(dbMocks.exec.mock.calls[0][1][3]).toBe(GOOGLE_ADS_CAMPAIGN_SYNC_LOG_TYPE)
  })
})
