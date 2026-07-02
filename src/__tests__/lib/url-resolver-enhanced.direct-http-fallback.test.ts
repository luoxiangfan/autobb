import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { initializeProxyPoolMock, resolveAffiliateLinkWithHttpMock } = vi.hoisted(() => ({
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
  resolveAffiliateLinkWithHttpMock: vi.fn(),
}))

vi.mock('@/lib/offers/offer-utils', () => ({
  initializeProxyPool: initializeProxyPoolMock,
}))

vi.mock('@/lib/scraping/resolver-domains', () => ({
  getOptimalResolver: vi.fn(() => 'http'),
  extractDomain: vi.fn(() => 'yeahpromos.com'),
}))

vi.mock('@/lib/scraping/url-resolver-http', () => ({
  resolveAffiliateLinkWithHttp: resolveAffiliateLinkWithHttpMock,
  extractEmbeddedTargetUrl: vi.fn(() => null),
}))

vi.mock('@/lib/scraping/url-resolver-playwright', () => ({
  resolveAffiliateLinkWithPlaywright: vi.fn(),
}))

import { clearProxyPool, resolveAffiliateLink } from '@/lib/scraping'

describe('resolveAffiliateLink direct HTTP fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearProxyPool()
    vi.stubEnv('AFFILIATE_RESOLVE_DIRECT_FIRST', 'true')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('resolves yeahpromos via direct HTTP before touching proxy', async () => {
    resolveAffiliateLinkWithHttpMock.mockResolvedValueOnce({
      finalUrl: 'https://www.amazon.com/stores/page/ABC',
      finalUrlSuffix: 'tag=abc',
      redirectChain: [
        'https://yeahpromos.com/index/index/openurl?track=abc',
        'https://www.amazon.com/stores/page/ABC?tag=abc',
      ],
      redirectCount: 1,
      statusCode: 200,
    })

    const result = await resolveAffiliateLink(
      'https://yeahpromos.com/index/index/openurl?track=abc&url=',
      {
        targetCountry: 'US',
        userId: 7,
        skipCache: true,
        retryConfig: { maxRetries: 0 },
      }
    )

    expect(result.finalUrl).toBe('https://www.amazon.com/stores/page/ABC')
    expect(resolveAffiliateLinkWithHttpMock).toHaveBeenCalledTimes(1)
    expect(resolveAffiliateLinkWithHttpMock.mock.calls[0][1]).toBeUndefined()
  })

  it('falls back to direct HTTP when proxy request hits EPROTO', async () => {
    resolveAffiliateLinkWithHttpMock
      .mockRejectedValueOnce(new Error('HTTP请求超时或网络错误: read ECONNRESET'))
      .mockRejectedValueOnce(
        new Error(
          'HTTP请求超时或网络错误: write EPROTO wrong version number:../deps/openssl/ssl/record/methods/tlsany_meth.c:77:'
        )
      )
      .mockResolvedValueOnce({
        finalUrl: 'https://www.amazon.com/dp/B001',
        finalUrlSuffix: 'tag=abc',
        redirectChain: [
          'https://yeahpromos.com/index/index/openurl?track=abc',
          'https://www.amazon.com/dp/B001?tag=abc',
        ],
        redirectCount: 1,
        statusCode: 200,
      })

    const result = await resolveAffiliateLink(
      'https://yeahpromos.com/index/index/openurl?track=abc&url=',
      {
        targetCountry: 'US',
        userId: 7,
        skipCache: true,
        retryConfig: { maxRetries: 0 },
      }
    )

    expect(result.finalUrl).toBe('https://www.amazon.com/dp/B001')
    expect(resolveAffiliateLinkWithHttpMock).toHaveBeenCalledTimes(3)
    expect(resolveAffiliateLinkWithHttpMock.mock.calls[0][1]).toBeUndefined()
    expect(resolveAffiliateLinkWithHttpMock.mock.calls[1][1]).toBe(
      'https://proxy-provider.example/api?cc=US'
    )
    expect(resolveAffiliateLinkWithHttpMock.mock.calls[2][1]).toBeUndefined()
  })

  it('skips direct-first when AFFILIATE_RESOLVE_DIRECT_FIRST=false', async () => {
    vi.stubEnv('AFFILIATE_RESOLVE_DIRECT_FIRST', 'false')
    resolveAffiliateLinkWithHttpMock.mockResolvedValueOnce({
      finalUrl: 'https://www.amazon.com/stores/page/ABC',
      finalUrlSuffix: 'tag=abc',
      redirectChain: [
        'https://yeahpromos.com/index/index/openurl?track=abc',
        'https://www.amazon.com/stores/page/ABC?tag=abc',
      ],
      redirectCount: 1,
      statusCode: 200,
    })

    const result = await resolveAffiliateLink(
      'https://yeahpromos.com/index/index/openurl?track=abc&url=',
      {
        targetCountry: 'US',
        userId: 7,
        skipCache: true,
        retryConfig: { maxRetries: 0 },
      }
    )

    expect(result.finalUrl).toBe('https://www.amazon.com/stores/page/ABC')
    expect(resolveAffiliateLinkWithHttpMock).toHaveBeenCalledTimes(1)
    expect(resolveAffiliateLinkWithHttpMock.mock.calls[0][1]).toBe(
      'https://proxy-provider.example/api?cc=US'
    )
  })
})
