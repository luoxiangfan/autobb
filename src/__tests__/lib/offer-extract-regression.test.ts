/**
 * Offer 提取收敛 — 4 条快测 + 相关回归
 * 见 docs/offer-extract-api.md
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

const offerDbFns = vi.hoisted(() => ({
  findOfferById: vi.fn(),
  updateOffer: vi.fn(),
}))

vi.mock('@/lib/offers/offers', () => ({
  findOfferById: offerDbFns.findOfferById,
  updateOffer: offerDbFns.updateOffer,
}))

vi.mock('@/lib/common/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/common/server')>()
  return {
    ...actual,
    invalidateOfferCache: vi.fn(),
  }
})

import { normalizeOfferExtractRequestBody, invalidateOfferCache } from '@/lib/common/server'
import {
  resolveExtractionModeInput,
  resolveExtractPageInput,
  applyOfferUpdateFromBody,
  OfferExtractRequestError,
  parseNewOfferExtractRequest,
  validateExistingOfferForExtraction,
} from '@/lib/offers/server'
import { findOfferById, updateOffer } from '@/lib/offers/offers'

const mockOffer = {
  id: 1,
  user_id: 10,
  brand: 'Acme',
  affiliate_link: 'https://example.com/old',
  url: 'https://example.com/old',
  page_type: 'product',
  store_product_links: null,
} as any

describe('offer-extract regression (4 quick checks)', () => {
  describe('1. stores URL without page_type → store', () => {
    it('parseNewOfferExtractRequest infers store', () => {
      const parsed = parseNewOfferExtractRequest({
        affiliate_link: 'https://www.amazon.com/stores/page/ABC',
        target_country: 'US',
      })
      expect(parsed.pageType).toBe('store')
    })

    it('normalizer leaves page_type empty and resolve infers store', () => {
      const normalized =
        normalizeOfferExtractRequestBody({
          affiliate_link: 'https://www.amazon.com/stores/page/ABC',
          target_country: 'US',
        }) || {}

      expect(normalized.page_type).toBeUndefined()

      const pageInput = resolveExtractPageInput({
        pageType: normalized.page_type,
        affiliateLink: String(normalized.affiliate_link),
        storeProductLinks: normalized.store_product_links,
      })

      expect(pageInput).toEqual({ pageType: 'store', storeProductLinks: [] })
    })
  })

  describe('2. commission_payout only "30" stays bare', () => {
    it('parseNewOfferExtractRequest keeps payout without $ prefix', () => {
      const parsed = parseNewOfferExtractRequest({
        affiliate_link: 'https://aff.example.com/track',
        target_country: 'US',
        commission_payout: '30',
      })
      expect(parsed.commissionPayout).toBe('30')
    })

    it('strict normalizer keeps payout without $ prefix', () => {
      const normalized =
        normalizeOfferExtractRequestBody(
          {
            affiliate_link: 'https://aff.example.com/track',
            target_country: 'US',
            commission_payout: '30',
          },
          { strictMonetization: true }
        ) || {}

      expect(normalized.commission_payout).toBe('30')
    })
  })

  describe('3. invalid extraction_mode on PUT body → 400', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      vi.mocked(findOfferById).mockResolvedValue(mockOffer)
    })

    it('applyOfferUpdateFromBody rejects bogus extraction_mode', async () => {
      const result = await applyOfferUpdateFromBody(1, 10, { extraction_mode: 'bogus' })

      expect(result).toEqual({
        error: '无效的提取模式，可选：fast、balanced、original',
        status: 400,
      })
      expect(updateOffer).not.toHaveBeenCalled()
    })
  })

  describe('4. CSV invalid extraction_mode → skip', () => {
    it('resolveExtractionModeInput returns null for bogus', () => {
      expect(resolveExtractionModeInput('bogus')).toBeNull()
      expect(resolveExtractionModeInput('fast')).toBe('fast')
    })
  })
})

describe('additional regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(updateOffer).mockImplementation(async (id, userId) => {
      invalidateOfferCache(userId, id)
      return mockOffer
    })
    vi.mocked(findOfferById).mockResolvedValue(mockOffer)
  })

  it('invalid extraction_mode is removed from normalizer output', () => {
    const normalized =
      normalizeOfferExtractRequestBody({
        affiliate_link: 'https://aff.example.com',
        target_country: 'US',
        extraction_mode: 'bogus',
      }) || {}

    expect(normalized.extraction_mode).toBeUndefined()
  })

  it('infers store page_type when PUT only updates affiliate_link to stores URL', async () => {
    await applyOfferUpdateFromBody(1, 10, {
      affiliate_link: 'https://www.amazon.com/stores/page/XYZ',
    })

    expect(updateOffer).toHaveBeenCalledWith(1, 10, expect.objectContaining({ page_type: 'store' }))
    expect(invalidateOfferCache).toHaveBeenCalledWith(10, 1)
  })

  it('strictMonetization throws on conflicting commission fields', () => {
    expect(() =>
      parseNewOfferExtractRequest({
        affiliate_link: 'https://aff.example.com',
        target_country: 'US',
        commission_type: 'percent',
        commission_value: '7.5',
        commission_payout: '$7.5',
      })
    ).toThrow(OfferExtractRequestError)
  })

  it('validateExistingOfferForExtraction rejects empty target_country', () => {
    expect(() =>
      validateExistingOfferForExtraction({
        affiliate_link: 'https://example.com',
        target_country: '  ',
      })
    ).toThrow(OfferExtractRequestError)
  })
})
