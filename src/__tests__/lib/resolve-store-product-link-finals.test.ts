import { beforeEach, describe, expect, it, vi } from 'vitest'

const proxyFns = vi.hoisted(() => ({
  initializeProxyPool: vi.fn(),
}))

const resolveFns = vi.hoisted(() => ({
  resolveAffiliateLinkForUrlSwap: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
  query: vi.fn(),
}))

vi.mock('@/lib/offers/server', () => ({
  initializeProxyPool: proxyFns.initializeProxyPool,
}))

vi.mock('@/lib/url-swap/url-swap-resolve-config', () => ({
  resolveAffiliateLinkForUrlSwap: resolveFns.resolveAffiliateLinkForUrlSwap,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => dbFns),
}))

import { resolveStoreProductLinkFinalUrls } from '@/lib/url-swap/resolve-store-product-link-finals'

describe('resolveStoreProductLinkFinalUrls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    proxyFns.initializeProxyPool.mockResolvedValue(undefined)
    dbFns.queryOne.mockResolvedValue({ scraped_data: null })
    dbFns.query.mockResolvedValue([])
    resolveFns.resolveAffiliateLinkForUrlSwap.mockResolvedValue({
      finalUrl: 'https://should-not-be-used.com',
    })
  })

  it('prefers supplementalProducts cached final URLs over live resolution', async () => {
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

    const resolved = await resolveStoreProductLinkFinalUrls({
      storeProductLinks: ['https://pboost.me/r2aECf1tv', 'https://pboost.me/V2aE0bkta'],
      targetCountry: 'US',
      userId: 1,
      offerId: 10,
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
    expect(proxyFns.initializeProxyPool).not.toHaveBeenCalled()
    expect(resolveFns.resolveAffiliateLinkForUrlSwap).not.toHaveBeenCalled()
  })

  it('uses affiliate_products mapping when scraped_data is null', async () => {
    dbFns.query
      .mockResolvedValueOnce([
        {
          product_url: 'https://www.amazon.com/dp/B0CZ9GF4VY',
          short_promo_link: 'https://pboost.me/r2aECf1tv',
          promo_link: null,
          asin: 'B0CZ9GF4VY',
          raw_json: null,
        },
      ])
      .mockResolvedValueOnce([])

    const resolved = await resolveStoreProductLinkFinalUrls({
      storeProductLinks: ['https://pboost.me/r2aECf1tv'],
      targetCountry: 'US',
      userId: 1,
      offerId: 10,
    })

    expect(resolved).toEqual([
      {
        affiliateLink: 'https://pboost.me/r2aECf1tv',
        finalUrl: 'https://www.amazon.com/dp/B0CZ9GF4VY',
      },
    ])
    expect(proxyFns.initializeProxyPool).not.toHaveBeenCalled()
    expect(resolveFns.resolveAffiliateLinkForUrlSwap).not.toHaveBeenCalled()
  })

  it('initializes proxy pool and resolves live links when no cached mapping exists', async () => {
    resolveFns.resolveAffiliateLinkForUrlSwap.mockResolvedValue({
      finalUrl: 'https://www.amazon.com/dp/B0CZ9GF4VY',
    })

    const resolved = await resolveStoreProductLinkFinalUrls({
      storeProductLinks: ['https://pboost.me/r2aECf1tv'],
      targetCountry: 'US',
      userId: 1,
      offerId: 10,
    })

    expect(proxyFns.initializeProxyPool).toHaveBeenCalledWith(1, 'US')
    expect(resolveFns.resolveAffiliateLinkForUrlSwap).toHaveBeenCalledWith({
      affiliateLink: 'https://pboost.me/r2aECf1tv',
      targetCountry: 'US',
      userId: 1,
    })
    expect(resolved[0].finalUrl).toBe('https://www.amazon.com/dp/B0CZ9GF4VY')
  })
})
