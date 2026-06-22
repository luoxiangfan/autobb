import { describe, expect, it } from 'vitest'
import { mapOfferToGetResponse } from '@/lib/offers/offer-display-mapper'
import type { Offer } from '@/lib/offers/offers'

function baseOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 1,
    user_id: 1,
    url: 'https://example.com',
    brand: 'Acme',
    offer_name: 'Acme Offer',
    category: 'Gadgets',
    target_country: 'US',
    target_language: 'en',
    affiliate_link: 'https://aff.example.com',
    brand_description: 'Stored brand description',
    unique_selling_points: 'USP stored',
    product_highlights: 'Highlights stored',
    target_audience: 'Everyone',
    final_url: 'https://shop.example.com',
    final_url_suffix: 'a=1',
    product_price: '99.00',
    commission_payout: '10',
    commission_type: 'percent',
    commission_value: '10',
    commission_currency: 'USD',
    page_type: 'product',
    store_product_links: null,
    scrape_status: 'completed',
    scrape_error: null,
    scraped_at: '2026-01-01T00:00:00.000Z',
    scraped_data: null,
    review_analysis: null,
    competitor_analysis: null,
    is_active: true,
    extraction_mode: 'original',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Offer
}

describe('mapOfferToGetResponse', () => {
  it('maps core offer fields for API response', () => {
    const mapped = mapOfferToGetResponse(baseOffer())

    expect(mapped.id).toBe(1)
    expect(mapped.offerName).toBe('Acme Offer')
    expect(mapped.pageType).toBe('product')
    expect(mapped.isActive).toBe(true)
    expect(mapped.extractionMode).toBe('original')
  })

  it('infers store page type from scraped_data when page_type is product', () => {
    const mapped = mapOfferToGetResponse(
      baseOffer({
        page_type: 'product',
        scraped_data: JSON.stringify({
          storeName: 'Brand Store',
          products: [{ name: 'A' }, { name: 'B' }],
        }),
      })
    )

    expect(mapped.pageType).toBe('store')
  })

  it('derives store descriptions from scraped_data when stored fields are near-duplicates', () => {
    const duplicate = 'Same marketing copy repeated for USP and highlights.'
    const mapped = mapOfferToGetResponse(
      baseOffer({
        page_type: 'store',
        unique_selling_points: duplicate,
        product_highlights: duplicate,
        scraped_data: JSON.stringify({
          pageType: 'store',
          storeDescription: 'Official brand store with curated products.',
        }),
      })
    )

    expect(mapped.pageType).toBe('store')
    expect(mapped.brandDescription).toContain('Official brand store')
  })
})
