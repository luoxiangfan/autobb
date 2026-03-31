import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateAffiliateSyncConfig } from '@/lib/affiliate-sync-validation'

describe('validateAffiliateSyncConfig partnerboost', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('uses get_fba_products endpoint for partnerboost validation', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify({
        status: { code: 0, msg: 'success' },
        data: { list: [] },
      })),
    } as any)

    const result = await validateAffiliateSyncConfig({
      partnerboostToken: 'pb-token',
    })

    expect(result.valid).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/datafeed/get_fba_products')

    const body = JSON.parse(String((init as RequestInit).body))
    expect(body).toMatchObject({
      token: 'pb-token',
      page_size: 1,
      page: 1,
      default_filter: 0,
      country_code: 'US',
    })
  })

  it('returns partnerboost status message when permission denied', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify({
        status: { code: 1003, msg: 'no permission' },
        data: null,
      })),
    } as any)

    const result = await validateAffiliateSyncConfig({
      partnerboostToken: 'pb-token',
    })

    expect(result.valid).toBe(false)
    expect(result.message).toContain('PartnerBoost 验证失败：no permission')
  })
})
