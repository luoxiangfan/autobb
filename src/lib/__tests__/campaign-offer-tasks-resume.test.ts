import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
}))

const batchStartFns = vi.hoisted(() => ({
  batchStartTasksForOffers: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    queryOne: dbFns.queryOne,
  })),
}))

vi.mock('@/lib/batch-start-tasks', () => ({
  batchStartTasksForOffers: batchStartFns.batchStartTasksForOffers,
}))

import { resumeOfferTasksOnCampaignEnable } from '@/lib/campaign-offer-tasks'

describe('resumeOfferTasksOnCampaignEnable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.queryOne.mockResolvedValue({ target_country: 'US' })
    batchStartFns.batchStartTasksForOffers.mockResolvedValue({
      success: true,
      partialSuccess: false,
      requestedCount: 1,
      processedOfferCount: 1,
      failedOfferCount: 0,
      failedItemsByType: { clickFarm: 0, urlSwap: 0, general: 0 },
      clickFarmTasksCreated: 0,
      clickFarmTasksUpdated: 1,
      urlSwapTasksCreated: 1,
      urlSwapTasksUpdated: 0,
      errors: [],
    })
  })

  it('loads offer country and starts tasks with batch defaults', async () => {
    const result = await resumeOfferTasksOnCampaignEnable(123, 7)

    expect(dbFns.queryOne).toHaveBeenCalled()
    expect(batchStartFns.batchStartTasksForOffers).toHaveBeenCalledWith({
      userId: 7,
      offers: [{ offerId: 123, targetCountry: 'US' }],
      enableClickFarm: true,
      enableUrlSwap: true,
    })
    expect(result).toEqual({
      success: true,
      partialSuccess: false,
      clickFarmTasksCreated: 0,
      clickFarmTasksUpdated: 1,
      urlSwapTasksCreated: 1,
      urlSwapTasksUpdated: 0,
      errors: [],
    })
  })
})
