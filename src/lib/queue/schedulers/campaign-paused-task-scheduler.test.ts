import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  query: vi.fn(),
}))

const offerTaskFns = vi.hoisted(() => ({
  pauseOfferTasksBatch: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'sqlite',
    query: dbFns.query,
  })),
}))

vi.mock('@/lib/campaign-offer-tasks', () => ({
  pauseOfferTasksBatch: offerTaskFns.pauseOfferTasksBatch,
}))

describe('CampaignPausedTaskScheduler.getStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps new counters at zero when no paused campaigns', async () => {
    dbFns.query.mockResolvedValueOnce([])

    const { CampaignPausedTaskScheduler } = await import('./campaign-paused-task-scheduler')
    const scheduler = new CampaignPausedTaskScheduler()

    await (scheduler as any).checkAndPauseTasks()
    const status = scheduler.getStatus()

    expect(status.lastCheckResult).toEqual({
      totalPausedCampaigns: 0,
      totalPausedOfferPairs: 0,
      totalOffersProcessed: 0,
      totalOffersAttempted: 0,
      totalOffersSucceeded: 0,
      totalOffersFailed: 0,
      totalOffersChanged: 0,
      totalOffersNoop: 0,
      clickFarmTasksPaused: 0,
      urlSwapTasksDisabled: 0,
      errors: 0,
    })
    expect(status.lastCheckAt).toBeTypeOf('string')
  })

  it('reports attempted/succeeded/failed after batch execution', async () => {
    dbFns.query.mockResolvedValueOnce([
      { user_id: 7, offer_id: 101, total_paused_campaigns: 3 },
      { user_id: 7, offer_id: 102, total_paused_campaigns: 3 },
    ])
    offerTaskFns.pauseOfferTasksBatch.mockResolvedValueOnce([
      {
        offerId: 101,
        result: {
          clickFarmTaskPaused: true,
          clickFarmTaskCount: 1,
          urlSwapTaskDisabled: false,
          urlSwapTaskCount: 0,
        },
      },
      {
        offerId: 102,
        result: {
          clickFarmTaskPaused: false,
          clickFarmTaskCount: 0,
          urlSwapTaskDisabled: false,
          urlSwapTaskCount: 0,
        },
        error: 'queue unavailable',
      },
    ])

    const { CampaignPausedTaskScheduler } = await import('./campaign-paused-task-scheduler')
    const scheduler = new CampaignPausedTaskScheduler()

    await (scheduler as any).checkAndPauseTasks()
    const status = scheduler.getStatus()

    expect(status.lastCheckResult).toEqual({
      totalPausedCampaigns: 3,
      totalPausedOfferPairs: 2,
      totalOffersProcessed: 2,
      totalOffersAttempted: 2,
      totalOffersSucceeded: 1,
      totalOffersFailed: 1,
      totalOffersChanged: 1,
      totalOffersNoop: 0,
      clickFarmTasksPaused: 1,
      urlSwapTasksDisabled: 0,
      errors: 1,
    })
  })
})
