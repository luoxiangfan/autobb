import { describe, expect, it, vi } from 'vitest'

vi.mock('axios', () => {
  return {
    default: {
      create: vi.fn(),
    },
  }
})

describe('resolveAffiliateLinkWithHttp (Amazon 5xx)', () => {
  it('accepts Amazon 503 as resolved final URL after meta refresh', async () => {
    const axios = await import('axios')
    const { resolveAffiliateLinkWithHttp } = await import('./url-resolver-http')

    const affiliateLink = 'https://yeahpromos.com/index/index/openurlproduct?track=abc&pid=100001'
    const amazonUrl =
      'https://www.amazon.com/dp/B07W1Z6KS4?maas=maas_adg_api_593282031371378202_static_12_113&ref_=aa_maas&tag=maas'

    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        headers: { refresh: `0;url=${amazonUrl}` },
      })
      .mockResolvedValueOnce({
        status: 503,
        headers: {},
      })

    vi.mocked(axios.default.create).mockReturnValue({ request, get: vi.fn() } as any)

    const result = await resolveAffiliateLinkWithHttp(affiliateLink, undefined, 10)
    expect(result.finalUrl).toBe('https://www.amazon.com/dp/B07W1Z6KS4')
    expect(result.finalUrlSuffix).toContain('maas=')
    expect(result.statusCode).toBe(503)
    expect(result.redirectCount).toBe(1)
  })
})

