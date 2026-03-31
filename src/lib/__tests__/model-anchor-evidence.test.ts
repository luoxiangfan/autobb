import { describe, expect, it } from 'vitest'

import { hasModelAnchorEvidenceFromOffer, hasModelAnchorInText } from '../model-anchor-evidence'

describe('hasModelAnchorEvidenceFromOffer', () => {
  it('does not treat family-marker marketing fragments as model anchors in plain text', () => {
    expect(hasModelAnchorInText('Ringconn Gen World’s')).toBe(false)
    expect(hasModelAnchorInText('World’s First Smart Ring')).toBe(false)
  })

  it('keeps legitimate family-marker suffix forms as model anchors', () => {
    expect(hasModelAnchorInText('Ringconn Gen 2')).toBe(true)
    expect(hasModelAnchorInText('Xbox Series S')).toBe(true)
    expect(hasModelAnchorInText('Tesla Model Y')).toBe(true)
  })

  it('does not treat dimension-axis fragments as model anchors', () => {
    expect(hasModelAnchorInText('Dreo 14.37"D')).toBe(false)
    expect(hasModelAnchorInText('Dreo 17.32"W')).toBe(false)
    expect(hasModelAnchorInText('Dreo 28.13"H')).toBe(false)
    expect(hasModelAnchorInText('Dreo AC516S')).toBe(true)
  })

  it('detects model anchors from store_product_links when other offer fields are empty', () => {
    const hasEvidence = hasModelAnchorEvidenceFromOffer({
      product_name: '',
      extracted_keywords: '',
      extracted_headlines: '',
      extracted_descriptions: '',
      offer_name: '',
      category: '',
      brand_description: '',
      unique_selling_points: '',
      product_highlights: '',
      scraped_data: null,
      store_product_links: JSON.stringify([
        {
          title: 'BrandX robot vacuum',
          url: 'https://example.com/products/brandx-x200-pro-robot-vacuum?ref=ads',
        },
      ]),
    })

    expect(hasEvidence).toBe(true)
  })

  it('returns false when store_product_links do not carry model-like signals', () => {
    const hasEvidence = hasModelAnchorEvidenceFromOffer({
      product_name: '',
      extracted_keywords: '',
      extracted_headlines: '',
      extracted_descriptions: '',
      offer_name: '',
      category: '',
      brand_description: '',
      unique_selling_points: '',
      product_highlights: '',
      scraped_data: null,
      store_product_links: JSON.stringify([
        {
          title: 'BrandX Official Store',
          url: 'https://example.com/store/brandx-official-shop',
        },
      ]),
    })

    expect(hasEvidence).toBe(false)
  })

  it('does not treat identifier-style ASIN tokens from scraped data and urls as model anchors', () => {
    const hasEvidence = hasModelAnchorEvidenceFromOffer({
      product_name: 'Novilla king size mattress',
      extracted_keywords: '',
      extracted_headlines: '',
      extracted_descriptions: '',
      offer_name: '',
      category: 'Mattresses',
      brand_description: '',
      unique_selling_points: '',
      product_highlights: '',
      final_url: 'https://www.amazon.com/dp/B0CJJ9SB4Y?tag=abc',
      url: 'https://www.amazon.com/dp/B0CJJ9SB4Y',
      scraped_data: JSON.stringify({
        asin: 'B0CJJ9SB4Y',
      }),
      store_product_links: null,
    })

    expect(hasEvidence).toBe(false)
  })

  it('does not treat measurement-only tokens as model anchors', () => {
    const hasEvidence = hasModelAnchorEvidenceFromOffer({
      product_name: 'BrandX 10 inch memory foam mattress',
      extracted_keywords: '',
      extracted_headlines: '',
      extracted_descriptions: '',
      offer_name: '',
      category: 'Mattresses',
      brand_description: '',
      unique_selling_points: '',
      product_highlights: '',
      final_url: '',
      url: '',
      scraped_data: JSON.stringify({
        technicalDetails: {
          Size: '10 inch',
          Height: '10 inch',
        },
      }),
      store_product_links: null,
    })

    expect(hasEvidence).toBe(false)
  })
})
