import { describe, expect, it } from 'vitest'

import type { Offer } from '../offers'
import { __testOnly } from '../offer-keyword-pool'

describe('offer-keyword-pool store_product_links fallback', () => {
  it('extracts store product names from link payload', () => {
    const names = __testOnly.extractStoreProductNamesFromLinks(JSON.stringify([
      'https://example.com/products/eufy-x10-pro-omni-robot-vacuum?utm=ads',
      {
        title: 'Eufy S1 Pro Robot Vacuum',
        productUrl: 'https://example.com/item?model=X10%20Pro%20Omni',
      },
    ]))

    expect(names).toContain('eufy x10 pro omni robot vacuum')
    expect(names).toContain('Eufy S1 Pro Robot Vacuum')
    expect(names).toContain('X10 Pro Omni')
  })

  it('wires store_product_links names into verified hot-product keyword extraction', async () => {
    const offer = {
      brand: 'Eufy',
      category: 'Robot Vacuum',
      product_name: null,
      product_highlights: null,
      unique_selling_points: null,
      scraped_data: null,
      review_analysis: null,
      target_country: 'US',
      target_language: 'en',
      final_url: 'https://example.com/store/eufy',
      url: 'https://example.com/store/eufy',
      store_product_links: JSON.stringify([
        'https://example.com/products/eufy-x10-pro-omni-robot-vacuum',
      ]),
    } as Offer

    const verified = await __testOnly.buildVerifiedSourceKeywordData(offer)
    const hotProductKeywords = verified.HOT_PRODUCT_AGGREGATE.map(item => item.keyword.toLowerCase())

    expect(hotProductKeywords.some(keyword => keyword.includes('x10 pro'))).toBe(true)
  })

  it('keeps explicit product page_type in keyword-pool resolution when scraped data disagrees', () => {
    const pageType = __testOnly.resolveOfferPageType({
      page_type: 'product',
      scraped_data: JSON.stringify({
        pageType: 'store',
        products: [{ title: 'item1' }, { title: 'item2' }],
      }),
    } as any)

    expect(pageType).toBe('product')
  })

  it('injects structured model/spec/cert keywords into PARAM_EXTRACT for productized expansion', async () => {
    const offer = {
      id: 1234,
      brand: 'Waterdrop',
      category: 'Reverse Osmosis',
      product_name: 'Waterdrop G3P800 Reverse Osmosis System 800 GPD NSF/ANSI 58',
      product_highlights: null,
      unique_selling_points: null,
      scraped_data: null,
      review_analysis: null,
      target_country: 'US',
      target_language: 'en',
      final_url: 'https://example.com/products/waterdrop-g3p800',
      url: 'https://example.com/products/waterdrop-g3p800',
      store_product_links: null,
    } as Offer

    const verified = await __testOnly.buildVerifiedSourceKeywordData(offer)
    const paramKeywords = verified.PARAM_EXTRACT.map(item => item.keyword.toLowerCase())

    expect(paramKeywords.some(keyword => keyword.includes('g3p800'))).toBe(true)
    expect(paramKeywords.some(keyword => keyword.includes('800 gpd'))).toBe(true)
    expect(paramKeywords.some(keyword => keyword.includes('nsf ansi 58'))).toBe(true)
  })

  it('applies target-language purification while preserving neutral model/spec tokens', async () => {
    const offer = {
      id: 2233,
      brand: 'Waterdrop',
      category: 'Reverse Osmosis',
      product_name: 'Waterdrop Kaufen X10 1200 GPD Reverse Osmosis System',
      product_highlights: null,
      unique_selling_points: null,
      scraped_data: null,
      review_analysis: null,
      target_country: 'IT',
      target_language: 'it',
      final_url: 'https://example.com/products/waterdrop-x10',
      url: 'https://example.com/products/waterdrop-x10',
      store_product_links: null,
    } as Offer

    const verified = await __testOnly.buildVerifiedSourceKeywordData(offer)
    const paramKeywords = verified.PARAM_EXTRACT.map(item => item.keyword.toLowerCase())

    expect(paramKeywords.some(keyword => keyword.includes('x10'))).toBe(true)
    expect(paramKeywords.some(keyword => keyword.includes('1200 gpd'))).toBe(true)
    expect(paramKeywords.some(keyword => keyword.includes('kaufen'))).toBe(false)
  })
})
