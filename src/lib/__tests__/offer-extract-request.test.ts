/**
 * offer-extract-request 单元测试（含 scrape/rebuild 前置校验）
 */

import { describe, expect, it } from 'vitest'
import {
  OfferExtractRequestError,
  offerExtractApiErrorBody,
  parseNewOfferExtractRequest,
  resolveValidatedTargetCountry,
  validateExistingOfferForExtraction,
} from '../offers/server'

describe('resolveValidatedTargetCountry', () => {
  it('normalizes UK to GB', () => {
    expect(resolveValidatedTargetCountry('UK')).toBe('GB')
  })

  it('rejects whitespace-only input', () => {
    expect(() => resolveValidatedTargetCountry('  ')).toThrow(OfferExtractRequestError)
  })
})

describe('validateExistingOfferForExtraction', () => {
  it('returns affiliate and target country when valid', () => {
    expect(
      validateExistingOfferForExtraction({
        affiliate_link: 'https://example.com/p',
        target_country: 'US',
      })
    ).toEqual({
      affiliateLink: 'https://example.com/p',
      targetCountry: 'US',
    })
  })

  it('falls back to url when affiliate_link missing', () => {
    expect(
      validateExistingOfferForExtraction({
        url: 'https://example.com/from-url',
        target_country: 'UK',
      })
    ).toEqual({
      affiliateLink: 'https://example.com/from-url',
      targetCountry: 'GB',
    })
  })

  it('throws when affiliate link missing', () => {
    expect(() =>
      validateExistingOfferForExtraction({
        target_country: 'US',
      })
    ).toThrow(OfferExtractRequestError)

    try {
      validateExistingOfferForExtraction({ target_country: 'US' })
    } catch (error) {
      expect(error).toBeInstanceOf(OfferExtractRequestError)
      expect((error as OfferExtractRequestError).status).toBe(400)
      expect((error as OfferExtractRequestError).message).toContain('推广链接')
    }
  })

  it('throws when target_country missing (scrape/rebuild parity)', () => {
    try {
      validateExistingOfferForExtraction({
        affiliate_link: 'https://example.com/p',
        target_country: '',
      })
    } catch (error) {
      expect(error).toBeInstanceOf(OfferExtractRequestError)
      expect((error as OfferExtractRequestError).status).toBe(400)
      expect((error as OfferExtractRequestError).message).toContain('推广国家')
    }
  })
})

describe('parseNewOfferExtractRequest', () => {
  it('parses stores URL without page_type as store', () => {
    const parsed = parseNewOfferExtractRequest({
      affiliate_link: 'https://www.amazon.com/stores/page/ABC',
      target_country: 'US',
    })

    expect(parsed.pageType).toBe('store')
    expect(parsed.storeProductLinks).toBeUndefined()
    expect(parsed.affiliateLink).toContain('amazon.com')
  })

  it('keeps bare commission_payout as 30', () => {
    const parsed = parseNewOfferExtractRequest({
      affiliate_link: 'https://aff.example.com/track',
      target_country: 'US',
      commission_payout: '30',
    })

    expect(parsed.commissionPayout).toBe('30')
    expect(parsed.commissionType).toBeUndefined()
  })

  it('rejects invalid extraction_mode', () => {
    expect(() =>
      parseNewOfferExtractRequest({
        affiliate_link: 'https://aff.example.com',
        target_country: 'US',
        extraction_mode: 'bogus',
      })
    ).toThrow(OfferExtractRequestError)
  })

  it('defaults empty target_country to US via extract normalizer', () => {
    const parsed = parseNewOfferExtractRequest({
      affiliate_link: 'https://aff.example.com',
      target_country: '',
    })

    expect(parsed.targetCountry).toBe('US')
  })

  it('formats amount commission when numericCommissionMode is amount', () => {
    const parsed = parseNewOfferExtractRequest(
      {
        affiliate_link: 'https://aff.example.com',
        target_country: 'US',
        commission_payout: '105.00',
      },
      { numericCommissionMode: 'amount' }
    )

    expect(parsed.commissionPayout).toBe('$105')
    expect(parsed.commissionType).toBe('amount')
  })

  it('infers store from store_product_links without page_type', () => {
    const parsed = parseNewOfferExtractRequest({
      affiliate_link: 'https://example.com/item',
      target_country: 'US',
      store_product_links: ['https://amazon.com/dp/B001'],
    })

    expect(parsed.pageType).toBe('store')
    expect(parsed.storeProductLinks).toEqual(['https://amazon.com/dp/B001'])
  })
})

describe('offerExtractApiErrorBody', () => {
  it('maps 409 to Conflict', () => {
    expect(offerExtractApiErrorBody(new OfferExtractRequestError(409, 'busy'))).toEqual({
      status: 409,
      error: 'Conflict',
      message: 'busy',
    })
  })
})
