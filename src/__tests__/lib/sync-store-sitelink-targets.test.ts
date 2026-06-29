import { beforeEach, describe, expect, it, vi } from 'vitest'

const sitelinkFns = vi.hoisted(() => ({
  loadOfferStoreProductLinksForUrlSwap: vi.fn(),
  getActiveUrlSwapSitelinkTargets: vi.fn(),
}))

const queryFns = vi.hoisted(() => ({
  getUrlSwapTaskByOfferId: vi.fn(),
}))

const backfillFns = vi.hoisted(() => ({
  backfillUrlSwapSitelinkTargets: vi.fn(),
}))

vi.mock('@/lib/url-swap/url-swap-sitelink-targets', () => ({
  loadOfferStoreProductLinksForUrlSwap: sitelinkFns.loadOfferStoreProductLinksForUrlSwap,
  getActiveUrlSwapSitelinkTargets: sitelinkFns.getActiveUrlSwapSitelinkTargets,
}))

vi.mock('@/lib/url-swap/url-swap-queries', () => ({
  getUrlSwapTaskByOfferId: queryFns.getUrlSwapTaskByOfferId,
}))

vi.mock('@/lib/url-swap/backfill-sitelink-targets', () => ({
  backfillUrlSwapSitelinkTargets: backfillFns.backfillUrlSwapSitelinkTargets,
}))

import { syncStoreSitelinkTargetsForOffer } from '@/lib/url-swap/sync-store-sitelink-targets'

describe('syncStoreSitelinkTargetsForOffer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sitelinkFns.loadOfferStoreProductLinksForUrlSwap.mockResolvedValue({
      pageType: 'store',
      storeProductLinks: ['https://example.com/a'],
    })
    queryFns.getUrlSwapTaskByOfferId.mockResolvedValue({ id: 'task-1' })
    sitelinkFns.getActiveUrlSwapSitelinkTargets.mockResolvedValue([])
    backfillFns.backfillUrlSwapSitelinkTargets.mockResolvedValue({
      upsertedMappings: 2,
      errors: [],
    })
  })

  it('skips non-store offers', async () => {
    sitelinkFns.loadOfferStoreProductLinksForUrlSwap.mockResolvedValue({
      pageType: 'product',
      storeProductLinks: [],
    })

    const result = await syncStoreSitelinkTargetsForOffer(10, 1)

    expect(result.skipped).toBe(true)
    expect(result.upserted).toBe(0)
    expect(backfillFns.backfillUrlSwapSitelinkTargets).not.toHaveBeenCalled()
  })

  it('skips when sitelink targets already exist', async () => {
    sitelinkFns.getActiveUrlSwapSitelinkTargets.mockResolvedValue([{ id: 'existing' }])

    const result = await syncStoreSitelinkTargetsForOffer(10, 1)

    expect(result.skipped).toBe(true)
    expect(backfillFns.backfillUrlSwapSitelinkTargets).not.toHaveBeenCalled()
  })

  it('backfills mappings for store offers without existing targets', async () => {
    const result = await syncStoreSitelinkTargetsForOffer(10, 1)

    expect(result.skipped).toBe(false)
    expect(result.upserted).toBe(2)
    expect(backfillFns.backfillUrlSwapSitelinkTargets).toHaveBeenCalledWith({
      offerId: 10,
      userId: 1,
      dryRun: false,
    })
  })
})
