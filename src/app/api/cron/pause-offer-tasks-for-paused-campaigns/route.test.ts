import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/cron/pause-offer-tasks-for-paused-campaigns/route'

const dbFns = vi.hoisted(() => ({
  query: vi.fn(),
  exec: vi.fn(),
}))

const offerTaskFns = vi.hoisted(() => ({
  pauseOfferTasksBatch: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'sqlite',
    query: dbFns.query,
    exec: dbFns.exec,
  })),
}))

vi.mock('@/lib/campaign-offer-tasks', () => ({
  pauseOfferTasksBatch: offerTaskFns.pauseOfferTasksBatch,
}))

describe('POST /api/cron/pause-offer-tasks-for-paused-campaigns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.exec.mockResolvedValue({ changes: 1 })
  })

  it('returns zero summary with new fields when no paused campaigns', async () => {
    dbFns.query.mockResolvedValueOnce([])

    const req = new NextRequest('http://localhost/api/cron/pause-offer-tasks-for-paused-campaigns', {
      method: 'POST',
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.summary).toEqual({
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
  })

  it('returns attempted/succeeded/failed counters from batch results', async () => {
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

    const req = new NextRequest('http://localhost/api/cron/pause-offer-tasks-for-paused-campaigns', {
      method: 'POST',
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(offerTaskFns.pauseOfferTasksBatch).toHaveBeenCalledWith(
      [101, 102],
      7,
      'campaign_paused_cron',
      '定时检测：关联广告系列已暂停，自动暂停任务'
    )
    expect(data.summary).toMatchObject({
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
    expect(data.details[0]).toMatchObject({
      userId: 7,
      offerIds: [101, 102],
      offersAttempted: 2,
      offersSucceeded: 1,
      offersFailed: 1,
      offersChanged: 1,
      offersNoop: 0,
      clickFarmTasksPaused: 1,
      urlSwapTasksDisabled: 0,
    })
  })
})
