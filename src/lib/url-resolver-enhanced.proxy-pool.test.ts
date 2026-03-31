import { describe, expect, it } from 'vitest'

import { ProxyPoolManager } from './url-resolver-enhanced'

describe('ProxyPoolManager failure classification', () => {
  it('treats HTTP status code errors as temporary failures', async () => {
    const pool = new ProxyPoolManager()
    const proxyUrl = 'https://proxy-provider.example/api?cc=US'

    await pool.loadProxies([
      {
        country: 'US',
        url: proxyUrl,
        is_default: true,
      },
    ])

    pool.recordFailure(proxyUrl, 'HTTP请求失败: 状态码 503')

    const info = pool.getProxyInfo('US')
    expect(info.proxy?.temporaryFailureCount).toBe(1)
    expect(info.proxy?.permanentFailureCount).toBe(0)
  })
})

describe('ProxyPoolManager country alias matching', () => {
  it('treats UK proxy as available for GB target', async () => {
    const pool = new ProxyPoolManager()

    await pool.loadProxies([
      {
        country: 'UK',
        url: 'https://proxy-provider.example/api?cc=UK',
        is_default: true,
      },
    ])

    expect(pool.hasProxyForCountry('GB')).toBe(true)
    expect(pool.hasProxyForCountry('UK')).toBe(true)
  })

  it('marks alias country proxy as target-country match', async () => {
    const pool = new ProxyPoolManager()
    const ukProxyUrl = 'https://proxy-provider.example/api?cc=UK'

    await pool.loadProxies([
      {
        country: 'UK',
        url: ukProxyUrl,
        is_default: true,
      },
      {
        country: 'US',
        url: 'https://proxy-provider.example/api?cc=US',
        is_default: false,
      },
    ])

    const best = pool.getBestProxyForCountry('GB')
    const info = pool.getProxyInfo('GB')

    expect(best?.url).toBe(ukProxyUrl)
    expect(info.isTargetCountryMatch).toBe(true)
    expect(info.usedCountry).toBe('UK')
  })
})
