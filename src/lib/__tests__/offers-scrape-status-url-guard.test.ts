import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mockDb: any
let updateOfferScrapeStatus: typeof import('../offers').updateOfferScrapeStatus

const mockInvalidateOfferCache = vi.fn()

vi.mock('../db', () => ({
  getDatabase: () => mockDb,
}))

vi.mock('../api-cache', () => ({
  invalidateOfferCache: mockInvalidateOfferCache,
}))

vi.mock('../offer-utils', () => ({
  generateOfferName: vi.fn(),
  getTargetLanguage: vi.fn(() => 'English'),
  isOfferNameUnique: vi.fn().mockResolvedValue(true),
  normalizeBrandName: (v: string) => v,
  normalizeOfferTargetCountry: (v: string) => String(v || '').toUpperCase() || 'US',
  validateBrandName: () => ({ valid: true as const }),
}))

vi.mock('../brand-name-utils', () => ({
  deriveBrandFromProductTitle: vi.fn(() => null),
  isLikelyInvalidBrandName: vi.fn(() => false),
}))

describe('updateOfferScrapeStatus final_url guard', () => {
  beforeEach(async () => {
    mockDb = {
      queryOne: vi.fn().mockResolvedValue({
        offer_name: 'KicksCrew_US_01',
        target_country: 'US',
        url: null,
        final_url: null,
      }),
      exec: vi.fn().mockResolvedValue({ changes: 1 }),
    }

    mockInvalidateOfferCache.mockReset()
    vi.resetModules()
    ;({ updateOfferScrapeStatus } = await import('../offers'))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('drops invalid null-slash url/final_url and suffix', async () => {
    await updateOfferScrapeStatus(5107, 1, 'completed', undefined, {
      url: 'null/',
      final_url: 'null/',
      final_url_suffix: 'x=1',
      scraped_data: JSON.stringify({
        finalUrl: 'null/',
        finalUrlSuffix: 'x=1',
      }),
      page_type: 'store',
    })

    expect(mockDb.exec).toHaveBeenCalledTimes(1)
    const [, params] = mockDb.exec.mock.calls[0]
    expect(params[3]).toBeNull() // url
    expect(params[4]).toBeNull() // final_url
    expect(params[5]).toBeNull() // final_url_suffix
  })

  it('persists valid https final_url and suffix', async () => {
    await updateOfferScrapeStatus(5107, 1, 'completed', undefined, {
      url: 'https://www.kickscrew.com/?x=1',
      final_url: 'https://www.kickscrew.com/',
      final_url_suffix: 'x=1',
      scraped_data: JSON.stringify({
        finalUrl: 'https://www.kickscrew.com/',
        finalUrlSuffix: 'x=1',
      }),
      page_type: 'store',
    })

    expect(mockDb.exec).toHaveBeenCalledTimes(1)
    const [, params] = mockDb.exec.mock.calls[0]
    expect(params[3]).toBe('https://www.kickscrew.com/')
    expect(params[4]).toBe('https://www.kickscrew.com/')
    expect(params[5]).toBe('x=1')
  })

  it('updates asin when scrape completes with Amazon final_url', async () => {
    await updateOfferScrapeStatus(5107, 1, 'completed', undefined, {
      final_url: 'https://www.amazon.com/dp/B0CJJ9SB4Y?tag=abc',
      page_type: 'product',
    })

    expect(mockDb.exec).toHaveBeenCalledTimes(1)
    const [sql, params] = mockDb.exec.mock.calls[0]
    expect(sql).toContain('asin = ?')
    expect(params[6]).toBe('B0CJJ9SB4Y')
  })
})
