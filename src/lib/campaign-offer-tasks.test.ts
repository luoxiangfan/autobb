import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  query: vi.fn(),
  exec: vi.fn(),
}))

const queueCleanupFns = vi.hoisted(() => ({
  removePendingClickFarmQueueTasksByTaskIds: vi.fn(),
  removePendingUrlSwapQueueTasksByTaskIds: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    query: dbFns.query,
    exec: dbFns.exec,
    transaction: async (fn: () => Promise<unknown>) => fn(),
  })),
}))

vi.mock('@/lib/click-farm/queue-cleanup', () => ({
  removePendingClickFarmQueueTasksByTaskIds:
    queueCleanupFns.removePendingClickFarmQueueTasksByTaskIds,
}))

vi.mock('@/lib/url-swap/queue-cleanup', () => ({
  removePendingUrlSwapQueueTasksByTaskIds: queueCleanupFns.removePendingUrlSwapQueueTasksByTaskIds,
}))

import {
  campaignOfferTaskActions,
  pauseOfferTasks,
  pauseOfferTasksBatch,
} from '@/lib/campaign-offer-tasks'

describe('pauseOfferTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.exec.mockResolvedValue({ changes: 0 })
    queueCleanupFns.removePendingClickFarmQueueTasksByTaskIds.mockResolvedValue({
      removedCount: 2,
      scannedCount: 10,
    })
    queueCleanupFns.removePendingUrlSwapQueueTasksByTaskIds.mockResolvedValue({
      removedCount: 1,
      scannedCount: 8,
    })
  })

  it('uses UPDATE ... RETURNING ids for precise queue cleanup', async () => {
    dbFns.query
      .mockResolvedValueOnce([{ id: 'cf-2' }, { id: 'cf-1' }])
      .mockResolvedValueOnce([{ id: 'us-2' }, { id: 'us-1' }])

    const result = await pauseOfferTasks(123, 7)

    expect(dbFns.exec).not.toHaveBeenCalled()
    expect(queueCleanupFns.removePendingClickFarmQueueTasksByTaskIds).toHaveBeenCalledWith(
      ['cf-1', 'cf-2'],
      7
    )
    expect(queueCleanupFns.removePendingUrlSwapQueueTasksByTaskIds).toHaveBeenCalledWith(
      ['us-1', 'us-2'],
      7
    )
    expect(result).toEqual({
      clickFarmTaskPaused: true,
      clickFarmTaskId: 'cf-1',
      clickFarmTaskCount: 2,
      urlSwapTaskDisabled: true,
      urlSwapTaskId: 'us-1',
      urlSwapTaskCount: 2,
    })
  })

  it('only disables url swap tasks in enabled or error status', async () => {
    dbFns.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'us-1' }])

    await pauseOfferTasks(123, 7)

    const urlSwapUpdateSql = String(dbFns.query.mock.calls[1][0] || '')
    expect(urlSwapUpdateSql).toContain("status IN ('enabled', 'error')")
    expect(urlSwapUpdateSql).not.toContain("status != 'disabled'")
  })

  it('returns no-op when returning has no matched rows', async () => {
    dbFns.query.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    const result = await pauseOfferTasks(123, 7)

    expect(dbFns.exec).not.toHaveBeenCalled()
    expect(queueCleanupFns.removePendingClickFarmQueueTasksByTaskIds).not.toHaveBeenCalled()
    expect(queueCleanupFns.removePendingUrlSwapQueueTasksByTaskIds).not.toHaveBeenCalled()
    expect(result).toEqual({
      clickFarmTaskPaused: false,
      clickFarmTaskCount: 0,
      urlSwapTaskDisabled: false,
      urlSwapTaskCount: 0,
    })
  })
})

describe('pauseOfferTasksBatch', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('runs with bounded concurrency and keeps result order', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const spy = vi
      .spyOn(campaignOfferTaskActions, 'pauseOfferTasks')
      .mockImplementation(async (offerId: number) => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, offerId % 2 === 0 ? 20 : 10))
        inFlight -= 1
        return {
          clickFarmTaskPaused: true,
          clickFarmTaskCount: 1,
          urlSwapTaskDisabled: false,
          urlSwapTaskCount: 0,
        }
      })

    try {
      const offerIds = [101, 102, 103, 104, 105]
      const result = await pauseOfferTasksBatch(offerIds, 7)
      expect(maxInFlight).toBeLessThanOrEqual(3)
      expect(result.map((item) => item.offerId)).toEqual(offerIds)
      expect(result.every((item) => item.result.clickFarmTaskPaused)).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  it('uses env-configured concurrency with bounds', async () => {
    vi.stubEnv('PAUSE_OFFER_TASKS_BATCH_CONCURRENCY', '2')
    let inFlight = 0
    let maxInFlight = 0
    const spy = vi
      .spyOn(campaignOfferTaskActions, 'pauseOfferTasks')
      .mockImplementation(async () => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 15))
        inFlight -= 1
        return {
          clickFarmTaskPaused: true,
          clickFarmTaskCount: 1,
          urlSwapTaskDisabled: false,
          urlSwapTaskCount: 0,
        }
      })

    try {
      await pauseOfferTasksBatch([1, 2, 3, 4], 7)
      expect(maxInFlight).toBeLessThanOrEqual(2)
    } finally {
      spy.mockRestore()
    }
  })

  it('falls back to environment default when env value is invalid', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('PAUSE_OFFER_TASKS_BATCH_CONCURRENCY', 'invalid')
    let inFlight = 0
    let maxInFlight = 0
    const spy = vi
      .spyOn(campaignOfferTaskActions, 'pauseOfferTasks')
      .mockImplementation(async () => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 15))
        inFlight -= 1
        return {
          clickFarmTaskPaused: true,
          clickFarmTaskCount: 1,
          urlSwapTaskDisabled: false,
          urlSwapTaskCount: 0,
        }
      })

    try {
      await pauseOfferTasksBatch([1, 2, 3, 4], 7)
      expect(maxInFlight).toBeLessThanOrEqual(2)
    } finally {
      spy.mockRestore()
    }
  })

  it('falls back to environment default when env value is empty string', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('PAUSE_OFFER_TASKS_BATCH_CONCURRENCY', '   ')
    let inFlight = 0
    let maxInFlight = 0
    const spy = vi
      .spyOn(campaignOfferTaskActions, 'pauseOfferTasks')
      .mockImplementation(async () => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 15))
        inFlight -= 1
        return {
          clickFarmTaskPaused: true,
          clickFarmTaskCount: 1,
          urlSwapTaskDisabled: false,
          urlSwapTaskCount: 0,
        }
      })

    try {
      await pauseOfferTasksBatch([1, 2, 3, 4], 7)
      expect(maxInFlight).toBeLessThanOrEqual(2)
    } finally {
      spy.mockRestore()
    }
  })

  it('uses environment-based defaults when env override is absent', async () => {
    const spy = vi
      .spyOn(campaignOfferTaskActions, 'pauseOfferTasks')
      .mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15))
        return {
          clickFarmTaskPaused: true,
          clickFarmTaskCount: 1,
          urlSwapTaskDisabled: false,
          urlSwapTaskCount: 0,
        }
      })

    try {
      vi.stubEnv('NODE_ENV', 'development')
      let inFlightDev = 0
      let maxInFlightDev = 0
      spy.mockImplementation(async () => {
        inFlightDev += 1
        maxInFlightDev = Math.max(maxInFlightDev, inFlightDev)
        await new Promise((resolve) => setTimeout(resolve, 15))
        inFlightDev -= 1
        return {
          clickFarmTaskPaused: true,
          clickFarmTaskCount: 1,
          urlSwapTaskDisabled: false,
          urlSwapTaskCount: 0,
        }
      })
      await pauseOfferTasksBatch([1, 2, 3, 4], 7)
      expect(maxInFlightDev).toBeLessThanOrEqual(2)

      vi.stubEnv('NODE_ENV', 'production')
      let inFlightProd = 0
      let maxInFlightProd = 0
      spy.mockImplementation(async () => {
        inFlightProd += 1
        maxInFlightProd = Math.max(maxInFlightProd, inFlightProd)
        await new Promise((resolve) => setTimeout(resolve, 15))
        inFlightProd -= 1
        return {
          clickFarmTaskPaused: true,
          clickFarmTaskCount: 1,
          urlSwapTaskDisabled: false,
          urlSwapTaskCount: 0,
        }
      })
      await pauseOfferTasksBatch([11, 12, 13, 14, 15], 7)
      expect(maxInFlightProd).toBeLessThanOrEqual(3)
      expect(maxInFlightProd).toBeGreaterThanOrEqual(3)
    } finally {
      spy.mockRestore()
    }
  })

  it('records per-offer errors without failing whole batch', async () => {
    const spy = vi
      .spyOn(campaignOfferTaskActions, 'pauseOfferTasks')
      .mockImplementation(async (offerId: number) => {
        if (offerId === 202) throw new Error('forced failure')
        return {
          clickFarmTaskPaused: false,
          clickFarmTaskCount: 0,
          urlSwapTaskDisabled: true,
          urlSwapTaskCount: 1,
        }
      })

    try {
      const result = await pauseOfferTasksBatch([201, 202, 203], 7)
      expect(result).toEqual([
        {
          offerId: 201,
          result: {
            clickFarmTaskPaused: false,
            clickFarmTaskCount: 0,
            urlSwapTaskDisabled: true,
            urlSwapTaskCount: 1,
          },
        },
        {
          offerId: 202,
          result: {
            clickFarmTaskPaused: false,
            clickFarmTaskCount: 0,
            urlSwapTaskDisabled: false,
            urlSwapTaskCount: 0,
          },
          error: 'forced failure',
        },
        {
          offerId: 203,
          result: {
            clickFarmTaskPaused: false,
            clickFarmTaskCount: 0,
            urlSwapTaskDisabled: true,
            urlSwapTaskCount: 1,
          },
        },
      ])
    } finally {
      spy.mockRestore()
    }
  })
})
