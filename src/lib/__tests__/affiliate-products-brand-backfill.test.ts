import { describe, it, expect, beforeEach, vi } from 'vitest'
import { backfillOfferProductLinkForPublishedCampaign } from '@/lib/affiliate-products'
import { getDatabase } from '@/lib/db'

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(),
}))

describe('backfillOfferProductLinkForPublishedCampaign - brand matching', () => {
  const mockDb = {
    type: 'sqlite' as const,
    queryOne: vi.fn(),
    query: vi.fn(),
    exec: vi.fn(),
  }

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getDatabase).mockResolvedValue(mockDb as any)
  })

  it('should link offer to product via brand matching when ASIN match fails', async () => {
    // No existing link
    mockDb.queryOne.mockResolvedValueOnce(null)

    // Offer with ASIN in URL
    mockDb.queryOne.mockResolvedValueOnce({
      id: 100,
      url: 'https://www.amazon.com/dp/B0C7GYLKPM',
      final_url: null,
      affiliate_link: null,
    })

    // Brand query for ASIN B0C7GYLKPM returns "novilla"
    mockDb.query.mockResolvedValueOnce([{ brand: 'Novilla' }])

    // Product rows with brand "novilla" but different promo_link
    mockDb.query.mockResolvedValueOnce([
      {
        id: 200,
        asin: 'B0DIFFERENT',
        brand: 'Novilla',
        promo_link: 'https://partnerboost.com/xyz123',
        short_promo_link: null,
        product_url: null,
      },
    ])

    // Mock recordAffiliateProductOfferLink
    mockDb.exec.mockResolvedValueOnce(undefined)

    const result = await backfillOfferProductLinkForPublishedCampaign({
      userId: 1,
      offerId: 100,
    })

    expect(result.linked).toBe(true)
    expect(result.productId).toBe(200)
    expect(result.reason).toBe('linked_by_brand')
    expect(result.signals.brandCount).toBe(1)
    expect(result.candidates.brandProductIds).toEqual([200])
  })

  it('should not link when multiple products match the same brand', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null)
    mockDb.queryOne.mockResolvedValueOnce({
      id: 100,
      url: 'https://www.amazon.com/dp/B0C7GYLKPM',
      final_url: null,
      affiliate_link: null,
    })

    mockDb.query.mockResolvedValueOnce([{ brand: 'Novilla' }])
    mockDb.query.mockResolvedValueOnce([
      {
        id: 200,
        asin: 'B0PROD1',
        brand: 'Novilla',
        promo_link: 'https://partnerboost.com/link1',
        short_promo_link: null,
        product_url: null,
      },
      {
        id: 201,
        asin: 'B0PROD2',
        brand: 'Novilla',
        promo_link: 'https://partnerboost.com/link2',
        short_promo_link: null,
        product_url: null,
      },
    ])

    const result = await backfillOfferProductLinkForPublishedCampaign({
      userId: 1,
      offerId: 100,
    })

    expect(result.linked).toBe(false)
    expect(result.reason).toBe('ambiguous_brand')
    expect(result.candidates.brandProductIds).toEqual([200, 201])
  })

  it('should prefer ASIN match over brand match', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null)
    mockDb.queryOne.mockResolvedValueOnce({
      id: 100,
      url: 'https://www.amazon.com/dp/B0C7GYLKPM',
      final_url: null,
      affiliate_link: null,
    })

    mockDb.query.mockResolvedValueOnce([{ brand: 'Novilla' }])
    mockDb.query.mockResolvedValueOnce([
      {
        id: 200,
        asin: 'B0C7GYLKPM',
        brand: 'Novilla',
        promo_link: 'https://partnerboost.com/exact',
        short_promo_link: null,
        product_url: null,
      },
      {
        id: 201,
        asin: 'B0OTHER',
        brand: 'Novilla',
        promo_link: 'https://partnerboost.com/other',
        short_promo_link: null,
        product_url: null,
      },
    ])

    mockDb.exec.mockResolvedValueOnce(undefined)

    const result = await backfillOfferProductLinkForPublishedCampaign({
      userId: 1,
      offerId: 100,
    })

    expect(result.linked).toBe(true)
    expect(result.productId).toBe(200)
    expect(result.reason).toBe('linked_by_asin')
  })
})
