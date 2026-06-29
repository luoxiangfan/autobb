import { beforeEach, describe, expect, it, vi } from 'vitest'

const scrapingFns = vi.hoisted(() => ({
  resolveAffiliateLink: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
  query: vi.fn(),
}))

vi.mock('@/lib/scraping', () => ({
  resolveAffiliateLink: scrapingFns.resolveAffiliateLink,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => dbFns),
}))

import { resolveStoreProductLinkFinalUrls } from '@/lib/url-swap/resolve-store-product-link-finals'

describe('resolveStoreProductLinkFinalUrls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.queryOne.mockResolvedValue({
      scraped_data: JSON.stringify({
        supplementalProducts: [
          {
            sourceAffiliateLink: 'https://pboost.me/r2aECf1tv',
            finalUrl: 'https://www.amazon.com/dp/B0CZ9GF4VY',
          },
          {
            sourceAffiliateLink: 'https://pboost.me/V2aE0bkta',
            finalUrl: 'https://www.amazon.com/dp/B0OTHER111',
          },
        ],
      }),
    })
    dbFns.query.mockResolvedValue([])
    scrapingFns.resolveAffiliateLink.mockResolvedValue({
      finalUrl: 'https://should-not-be-used.com',
    })
  })

  it('prefers supplementalProducts cached final URLs over live resolution', async () => {
    const resolved = await resolveStoreProductLinkFinalUrls({
      storeProductLinks: ['https://pboost.me/r2aECf1tv', 'https://pboost.me/V2aE0bkta'],
      targetCountry: 'US',
      userId: 1,
      offerId: 10,
      skipCache: false,
    })

    expect(resolved).toEqual([
      {
        affiliateLink: 'https://pboost.me/r2aECf1tv',
        finalUrl: 'https://www.amazon.com/dp/B0CZ9GF4VY',
      },
      {
        affiliateLink: 'https://pboost.me/V2aE0bkta',
        finalUrl: 'https://www.amazon.com/dp/B0OTHER111',
      },
    ])
    expect(scrapingFns.resolveAffiliateLink).not.toHaveBeenCalled()
  })
})
