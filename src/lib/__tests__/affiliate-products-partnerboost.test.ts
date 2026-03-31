import { describe, expect, it } from 'vitest'
import {
  __testOnly,
  detectAffiliateLandingPageType,
  extractPartnerboostDtcProductsPayload,
  extractPartnerboostProductsPayload,
  normalizePartnerboostStatusCode,
  resolvePartnerboostCountryCode,
  resolvePartnerboostPromoLinks,
} from '@/lib/affiliate-products'

describe('normalizePartnerboostStatusCode', () => {
  it('supports number and string status code', () => {
    expect(normalizePartnerboostStatusCode(0)).toBe(0)
    expect(normalizePartnerboostStatusCode('0')).toBe(0)
    expect(normalizePartnerboostStatusCode('200')).toBe(200)
  })

  it('returns null for invalid or empty value', () => {
    expect(normalizePartnerboostStatusCode(undefined)).toBeNull()
    expect(normalizePartnerboostStatusCode(null)).toBeNull()
    expect(normalizePartnerboostStatusCode('')).toBeNull()
    expect(normalizePartnerboostStatusCode('ERROR')).toBeNull()
  })
})

describe('isPartnerboostRateLimited', () => {
  it('detects HTTP 429 and PB status code 1002', () => {
    expect(__testOnly.isPartnerboostRateLimited(null, '', 429)).toBe(true)
    expect(__testOnly.isPartnerboostRateLimited(1002, '')).toBe(true)
  })

  it('detects message-based rate-limit signals', () => {
    expect(__testOnly.isPartnerboostRateLimited(1, 'Too many request')).toBe(true)
    expect(__testOnly.isPartnerboostRateLimited(1, 'rate limit exceeded')).toBe(true)
  })

  it('returns false for non-rate-limit cases', () => {
    expect(__testOnly.isPartnerboostRateLimited(0, 'success')).toBe(false)
    expect(__testOnly.isPartnerboostRateLimited(1001, 'user not exist')).toBe(false)
  })
})

describe('isPartnerboostRateLimitError', () => {
  it('detects wrapped 429 error messages', () => {
    const error = new Error('PartnerBoost 推广链接拉取失败 (429): {"status":{"code":1002,"msg":"Too many request"},"data":null}')
    expect(__testOnly.isPartnerboostRateLimitError(error)).toBe(true)
  })

  it('returns false for non-rate-limit errors', () => {
    const error = new Error('PartnerBoost 商品拉取失败: user not exist')
    expect(__testOnly.isPartnerboostRateLimitError(error)).toBe(false)
  })
})

describe('isPartnerboostTransientError', () => {
  it('detects HTTP 5xx gateway errors', () => {
    const error = new Error('PartnerBoost 商品拉取失败 (502): <html><title>502 Bad Gateway</title></html>')
    expect(__testOnly.isPartnerboostTransientError(error)).toBe(true)
  })

  it('detects common network transport failures', () => {
    const error = new Error('fetch failed: ECONNRESET')
    expect(__testOnly.isPartnerboostTransientError(error)).toBe(true)
  })

  it('returns false for normal business errors', () => {
    const error = new Error('PartnerBoost 商品拉取失败: user not exist')
    expect(__testOnly.isPartnerboostTransientError(error)).toBe(false)
  })
})

describe('calculateExponentialBackoffDelay', () => {
  it('grows exponentially and caps at max delay', () => {
    expect(__testOnly.calculateExponentialBackoffDelay(0, 800, 12000)).toBe(0)
    expect(__testOnly.calculateExponentialBackoffDelay(1, 800, 12000)).toBe(800)
    expect(__testOnly.calculateExponentialBackoffDelay(2, 800, 12000)).toBe(1600)
    expect(__testOnly.calculateExponentialBackoffDelay(5, 800, 12000)).toBe(12000)
  })
})

describe('resolveSyncMaxPages', () => {
  it('returns null when no positive limit is provided', () => {
    expect(__testOnly.resolveSyncMaxPages(undefined, null, 20000)).toBeNull()
    expect(__testOnly.resolveSyncMaxPages(0, null, 20000)).toBeNull()
    expect(__testOnly.resolveSyncMaxPages(-1, null, 20000)).toBeNull()
  })

  it('uses fallback when requested value is missing', () => {
    expect(__testOnly.resolveSyncMaxPages(undefined, 1, 20000)).toBe(1)
    expect(__testOnly.resolveSyncMaxPages(undefined, 500, 20000)).toBe(500)
  })

  it('prioritizes requested value and clamps to max allowed', () => {
    expect(__testOnly.resolveSyncMaxPages(20, 500, 20000)).toBe(20)
    expect(__testOnly.resolveSyncMaxPages(50000, 500, 20000)).toBe(20000)
  })
})

describe('assertPartnerboostAsinRequestLimit', () => {
  it('accepts up to 50 ASINs', () => {
    const asins = Array.from({ length: 50 }, (_, index) => `B0TEST${String(index).padStart(4, '0')}`)
    expect(() => __testOnly.assertPartnerboostAsinRequestLimit(asins)).not.toThrow()
  })

  it('rejects requests over 50 ASINs', () => {
    const asins = Array.from({ length: 51 }, (_, index) => `B0TEST${String(index).padStart(4, '0')}`)
    expect(() => __testOnly.assertPartnerboostAsinRequestLimit(asins)).toThrow(/maximum of 50 elements/)
  })
})

describe('extractPartnerboostProductsPayload', () => {
  it('extracts products from object list and reads has_more flag', () => {
    const payload = {
      status: { code: '0', msg: 'success' },
      data: {
        list: {
          first: { product_id: 'p1', asin: 'B000000001' },
          second: { product_id: 'p2', asin: 'B000000002' },
        },
        has_more: '1',
      },
    }

    const extracted = extractPartnerboostProductsPayload(payload)

    expect(extracted.products).toHaveLength(2)
    expect(extracted.hasMore).toBe(true)
  })

  it('supports hasMore fallback and false-like flag values', () => {
    const payload = {
      status: { code: 0, msg: 'success' },
      data: {
        list: [{ product_id: 'p3' }],
        hasMore: '0',
      },
    }

    const extracted = extractPartnerboostProductsPayload(payload)

    expect(extracted.products).toHaveLength(1)
    expect(extracted.hasMore).toBe(false)
  })
})

describe('extractPartnerboostDtcProductsPayload', () => {
  it('uses total field to determine hasMore', () => {
    const extracted = extractPartnerboostDtcProductsPayload({
      payload: {
        status: { code: 0, msg: 'success' },
        data: {
          total: '3',
          list: [{ creative_id: '1' }, { creative_id: '2' }],
        },
      },
      page: 1,
      pageSize: 2,
    })

    expect(extracted.products).toHaveLength(2)
    expect(extracted.hasMore).toBe(true)
  })

  it('falls back to list length when total is missing', () => {
    const extracted = extractPartnerboostDtcProductsPayload({
      payload: {
        status: { code: 0, msg: 'success' },
        data: {
          list: [{ creative_id: '1' }],
        },
      },
      page: 1,
      pageSize: 2,
    })

    expect(extracted.products).toHaveLength(1)
    expect(extracted.hasMore).toBe(false)
  })
})

describe('resolvePartnerboostPromoLinks', () => {
  it('prefers partnerboost short link', () => {
    const resolved = resolvePartnerboostPromoLinks({
      productIdLink: 'https://amazon.example/product',
      asinLink: 'https://amazon.example/asin',
      asinPartnerboostLink: 'https://pboost.me/short',
    })

    expect(resolved.shortPromoLink).toBe('https://pboost.me/short')
    expect(resolved.promoLink).toBe('https://pboost.me/short')
  })

  it('falls back to ASIN link then product-id link', () => {
    const fromAsin = resolvePartnerboostPromoLinks({
      productIdLink: 'https://amazon.example/product',
      asinLink: 'https://amazon.example/asin',
      asinPartnerboostLink: '',
    })
    expect(fromAsin.shortPromoLink).toBeNull()
    expect(fromAsin.promoLink).toBe('https://amazon.example/asin')

    const fromProductId = resolvePartnerboostPromoLinks({
      productIdLink: 'https://amazon.example/product',
      asinLink: '',
      asinPartnerboostLink: '',
    })
    expect(fromProductId.shortPromoLink).toBeNull()
    expect(fromProductId.promoLink).toBe('https://amazon.example/product')
  })

  it('uses short link when ASIN lookup returns partnerboost_link', () => {
    const resolved = resolvePartnerboostPromoLinks({
      productIdLink: 'https://www.amazon.com/dp/B000000001?tag=long',
      asinLink: 'https://www.amazon.com/dp/B000000001?tag=asin-long',
      asinPartnerboostLink: 'https://pboost.me/abc123',
    })

    expect(resolved.shortPromoLink).toBe('https://pboost.me/abc123')
    expect(resolved.promoLink).toBe('https://pboost.me/abc123')
  })

  it('prefers product-level short link over asin long link', () => {
    const resolved = resolvePartnerboostPromoLinks({
      productIdLink: 'https://pboost.me/product-short-1',
      asinLink: 'https://www.amazon.com/dp/B000000001?tag=asin-long',
      asinPartnerboostLink: '',
    })

    expect(resolved.shortPromoLink).toBe('https://pboost.me/product-short-1')
    expect(resolved.promoLink).toBe('https://pboost.me/product-short-1')
  })
})

describe('resolvePartnerboostCountryCode', () => {
  it('returns uppercase country when configured', () => {
    expect(resolvePartnerboostCountryCode('ca')).toBe('CA')
    expect(resolvePartnerboostCountryCode(' us ')).toBe('US')
  })

  it('falls back to provided fallback value', () => {
    expect(resolvePartnerboostCountryCode('', 'gb')).toBe('GB')
    expect(resolvePartnerboostCountryCode(undefined, 'jp')).toBe('JP')
  })

  it('falls back to US when both are empty', () => {
    expect(resolvePartnerboostCountryCode('')).toBe('US')
    expect(resolvePartnerboostCountryCode(undefined, '')).toBe('US')
  })
})

describe('resolvePartnerboostFullSyncCountrySequence', () => {
  it('uses the expected full-sync country order', () => {
    expect(__testOnly.resolvePartnerboostFullSyncCountrySequence()).toEqual([
      'US',
      'MX',
      'CA',
      'DE',
      'UK',
      'ES',
      'FR',
      'IT',
    ])
  })
})

describe('dedupeNormalizedProducts', () => {
  it('merges allowed countries for duplicate partnerboost mids', () => {
    const deduped = __testOnly.dedupeNormalizedProducts([
      {
        platform: 'partnerboost',
        mid: 'p1',
        asin: 'B000000001',
        brand: 'Brand',
        productName: 'Demo',
        productUrl: 'https://example.com/p1',
        promoLink: null,
        shortPromoLink: null,
        allowedCountries: ['US'],
        priceAmount: 12,
        priceCurrency: 'USD',
        commissionRate: 10,
        commissionAmount: 1.2,
        commissionRateMode: 'percent',
        reviewCount: 100,
        isDeepLink: null,
        isConfirmedInvalid: false,
      },
      {
        platform: 'partnerboost',
        mid: 'p1',
        asin: 'B000000001',
        brand: 'Brand',
        productName: 'Demo',
        productUrl: 'https://example.com/p1',
        promoLink: 'https://pboost.me/p1',
        shortPromoLink: 'https://pboost.me/p1',
        allowedCountries: ['DE'],
        priceAmount: 12,
        priceCurrency: 'USD',
        commissionRate: 10,
        commissionAmount: 1.2,
        commissionRateMode: 'percent',
        reviewCount: 100,
        isDeepLink: null,
        isConfirmedInvalid: false,
      },
    ])

    expect(deduped).toHaveLength(1)
    expect(deduped[0].allowedCountries.sort()).toEqual(['DE', 'US'])
    expect(deduped[0].promoLink).toBe('https://pboost.me/p1')
    expect(deduped[0].shortPromoLink).toBe('https://pboost.me/p1')
  })
})

describe('detectAffiliateLandingPageType', () => {
  it('returns amazon_product when asin exists', () => {
    expect(detectAffiliateLandingPageType({ asin: 'B0ABC12345' })).toBe('amazon_product')
  })

  it('returns amazon_store for amazon store url', () => {
    expect(detectAffiliateLandingPageType({ productUrl: 'https://www.amazon.com/stores/page/ABC123' })).toBe('amazon_store')
  })

  it('returns independent_product for product-like path', () => {
    expect(detectAffiliateLandingPageType({ productUrl: 'https://brand.example.com/products/camera-x1' })).toBe('independent_product')
  })

  it('returns independent_store for root path', () => {
    expect(detectAffiliateLandingPageType({ productUrl: 'https://brand.example.com/' })).toBe('independent_store')
  })

  it('returns unknown when no valid signal', () => {
    expect(detectAffiliateLandingPageType({})).toBe('unknown')
  })
})
