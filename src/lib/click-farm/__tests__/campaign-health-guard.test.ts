import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  removePendingClickFarmQueueTasksByTaskIds: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: mocks.getDatabase,
}))

vi.mock('@/lib/click-farm/queue-cleanup', () => ({
  removePendingClickFarmQueueTasksByTaskIds: mocks.removePendingClickFarmQueueTasksByTaskIds,
}))

import {
  hasEnabledCampaignForOffer,
  pauseClickFarmTasksWithoutEnabledCampaign,
} from '@/lib/click-farm/campaign-health-guard'

describe('click-farm campaign health guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('detects enabled campaign by user + offer', async () => {
    const db = {
      type: 'postgres',
      queryOne: vi.fn(async () => ({ id: 77 })),
      query: vi.fn(),
      exec: vi.fn(),
    }

    mocks.getDatabase.mockResolvedValue(db)

    const hasEnabled = await hasEnabledCampaignForOffer({
      userId: 1,
      offerId: 3343,
    })

    expect(hasEnabled).toBe(true)
    expect(db.queryOne).toHaveBeenCalledTimes(1)
  })

  it('returns task ids only in dry-run mode', async () => {
    const db = {
      type: 'postgres',
      queryOne: vi.fn(),
      query: vi.fn(async () => ([
        { id: 'task-1', user_id: 1, offer_id: 3343, status: 'running' },
        { id: 'task-2', user_id: 2, offer_id: 998, status: 'pending' },
      ])),
      exec: vi.fn(),
    }

    mocks.getDatabase.mockResolvedValue(db)
    mocks.removePendingClickFarmQueueTasksByTaskIds.mockResolvedValue({ removedCount: 0, scannedCount: 0 })

    const result = await pauseClickFarmTasksWithoutEnabledCampaign({ dryRun: true })

    expect(result).toEqual({
      scanned: 2,
      paused: 0,
      queueRemoved: 0,
      queueScanned: 0,
      taskIds: ['task-1', 'task-2'],
    })
    expect(db.exec).not.toHaveBeenCalled()
    expect(mocks.removePendingClickFarmQueueTasksByTaskIds).not.toHaveBeenCalled()
  })

  it('pauses tasks and cleans pending queue in apply mode', async () => {
    const db = {
      type: 'postgres',
      queryOne: vi.fn(),
      query: vi.fn(async () => ([
        { id: 'task-10', user_id: 1, offer_id: 3343, status: 'running' },
        { id: 'task-11', user_id: 1, offer_id: 3343, status: 'pending' },
      ])),
      exec: vi.fn(async () => ({ changes: 1 })),
    }

    mocks.getDatabase.mockResolvedValue(db)
    mocks.removePendingClickFarmQueueTasksByTaskIds.mockResolvedValue({ removedCount: 3, scannedCount: 12 })

    const result = await pauseClickFarmTasksWithoutEnabledCampaign({ dryRun: false })

    expect(result).toEqual({
      scanned: 2,
      paused: 2,
      queueRemoved: 3,
      queueScanned: 12,
      taskIds: ['task-10', 'task-11'],
    })
    expect(db.exec).toHaveBeenCalledTimes(2)
    expect(mocks.removePendingClickFarmQueueTasksByTaskIds).toHaveBeenCalledWith(['task-10', 'task-11'])
  })
})
