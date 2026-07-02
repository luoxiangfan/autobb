import { describe, expect, it } from 'vitest'
import {
  isAffiliatePlatformResolveLink,
  isProxyTransportError,
} from '@/lib/scraping/affiliate-direct-http-fallback'

describe('affiliate-direct-http-fallback', () => {
  it('detects yeahpromos and pboost affiliate resolve links', () => {
    expect(
      isAffiliatePlatformResolveLink('https://yeahpromos.com/index/index/openurl?track=abc&url=')
    ).toBe(true)
    expect(isAffiliatePlatformResolveLink('https://pboost.me/r1SVwn8xk')).toBe(true)
    expect(isAffiliatePlatformResolveLink('https://www.amazon.com/dp/B001')).toBe(false)
  })

  it('detects proxy transport errors including EPROTO and ERR_CONNECTION_RESET', () => {
    expect(
      isProxyTransportError(
        new Error(
          'HTTP请求超时或网络错误: write EPROTO wrong version number:../deps/openssl/ssl/record/methods/tlsany_meth.c:77:'
        )
      )
    ).toBe(true)
    expect(
      isProxyTransportError(
        new Error(
          'Playwright解析失败: page.goto: net::ERR_CONNECTION_RESET at https://pboost.me/w2a8u6ot'
        )
      )
    ).toBe(true)
    expect(isProxyTransportError(new Error('推广链接已失效：Invalid Link'))).toBe(false)
  })
})
