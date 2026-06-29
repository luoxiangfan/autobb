import { beforeEach, describe, expect, it, vi } from 'vitest'

const { initializeProxyPoolMock, loadOfferStoreProductLinksMock, resolveStoreSitelinksMock } =
  vi.hoisted(() => ({
    initializeProxyPoolMock: vi.fn(async () => {}),
    loadOfferStoreProductLinksMock: vi.fn(async () => ({
      pageType: 'store',
      storeProductLinks: ['https://aff.example/product-1'],
    })),
    resolveStoreSitelinksMock: vi.fn(async () => [
      { text: 'Hot Item', url: 'https://www.amazon.com/dp/B001', finalUrlSuffix: 'tag=abc' },
    ]),
  }))

vi.mock('@/lib/offers/server', () => ({
  initializeProxyPool: initializeProxyPoolMock,
}))

vi.mock('@/lib/url-swap/url-swap-sitelink-targets', () => ({
  loadOfferStoreProductLinksForUrlSwap: loadOfferStoreProductLinksMock,
  syncUrlSwapSitelinkTargetsAfterPublish: vi.fn(),
}))

vi.mock('@/lib/creatives/sitelink-store-product-links', () => ({
  resolveStoreProductSitelinksForPublish: resolveStoreSitelinksMock,
}))

import { resolveFormattedStoreSitelinksForPublish } from '@/lib/queue/executors/campaign-publish-executor'

describe('resolveFormattedStoreSitelinksForPublish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes proxy pool before resolving store product sitelinks', async () => {
    const callOrder: string[] = []

    initializeProxyPoolMock.mockImplementation(async () => {
      callOrder.push('initializeProxyPool')
    })
    resolveStoreSitelinksMock.mockImplementation(async () => {
      callOrder.push('resolveStoreProductSitelinksForPublish')
      return [{ text: 'Hot Item', url: 'https://www.amazon.com/dp/B001' }]
    })

    const inputSitelinks = [{ text: 'Hot Item', url: 'https://store.example/' }]

    const resolved = await resolveFormattedStoreSitelinksForPublish({
      offerId: 10,
      userId: 7,
      targetCountry: 'US',
      formattedSitelinks: inputSitelinks,
      fallbackUrl: 'https://store.example/',
    })

    expect(initializeProxyPoolMock).toHaveBeenCalledWith(7, 'US')
    expect(loadOfferStoreProductLinksMock).toHaveBeenCalledWith(10, 7)
    expect(resolveStoreSitelinksMock).toHaveBeenCalled()
    expect(callOrder).toEqual(['initializeProxyPool', 'resolveStoreProductSitelinksForPublish'])
    expect(resolved[0]?.url).toBe('https://www.amazon.com/dp/B001')
  })

  it('skips sitelink resolution for non-store offers', async () => {
    loadOfferStoreProductLinksMock.mockResolvedValueOnce({
      pageType: 'product',
      storeProductLinks: [],
    })

    const inputSitelinks = [{ text: 'Shop', url: 'https://store.example/' }]
    const resolved = await resolveFormattedStoreSitelinksForPublish({
      offerId: 10,
      userId: 7,
      targetCountry: 'US',
      formattedSitelinks: inputSitelinks,
      fallbackUrl: 'https://store.example/',
    })

    expect(initializeProxyPoolMock).toHaveBeenCalledWith(7, 'US')
    expect(resolveStoreSitelinksMock).not.toHaveBeenCalled()
    expect(resolved).toEqual(inputSitelinks)
  })
})
