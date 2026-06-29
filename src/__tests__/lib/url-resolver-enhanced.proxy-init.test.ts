import { beforeEach, describe, expect, it, vi } from 'vitest'

const { initializeProxyPoolMock } = vi.hoisted(() => ({
  initializeProxyPoolMock: vi.fn(async (userId: number) => {
    const { getProxyPool } = await import('@/lib/scraping')
    await getProxyPool(userId).loadProxies([
      {
        url: 'https://proxy-provider.example/api?cc=US',
        country: 'US',
        is_default: true,
      },
    ])
  }),
}))

vi.mock('@/lib/offers/offer-utils', () => ({
  initializeProxyPool: initializeProxyPoolMock,
}))

vi.mock('@/lib/scraping/resolver-domains', () => ({
  getOptimalResolver: vi.fn(() => 'http'),
  extractDomain: vi.fn(() => 'example.com'),
}))

vi.mock('@/lib/scraping/url-resolver-http', () => ({
  resolveAffiliateLinkWithHttp: vi.fn(async () => ({
    finalUrl: 'https://example.com/final',
    finalUrlSuffix: 'x=1',
    redirectChain: ['https://aff.example/start', 'https://example.com/final?x=1'],
    redirectCount: 1,
    statusCode: 200,
  })),
  extractEmbeddedTargetUrl: vi.fn(() => null),
}))

import { clearProxyPool, resolveAffiliateLink } from '@/lib/scraping'

describe('resolveAffiliateLink proxy pool initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearProxyPool()
  })

  it('loads user proxy pool via initializeProxyPool before resolving', async () => {
    await resolveAffiliateLink('https://aff.example/start', {
      targetCountry: 'US',
      userId: 42,
      skipCache: true,
    })

    expect(initializeProxyPoolMock).toHaveBeenCalledWith(42, 'US')
  })
})
