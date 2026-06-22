import { describe, expect, it } from 'vitest'
import {
  applyStoreProductLinksToCreativeSitelinks,
  parseOfferStoreProductLinks,
} from '@/lib/creatives/sitelink-store-product-links'

describe('parseOfferStoreProductLinks', () => {
  it('returns links only for store page_type', () => {
    expect(
      parseOfferStoreProductLinks({
        page_type: 'store',
        store_product_links: ['https://aff.example/a', 'https://aff.example/b'],
      })
    ).toEqual(['https://aff.example/a', 'https://aff.example/b'])

    expect(
      parseOfferStoreProductLinks({
        page_type: 'product',
        store_product_links: ['https://aff.example/a'],
      })
    ).toEqual([])
  })
})

describe('applyStoreProductLinksToCreativeSitelinks', () => {
  it('binds affiliate links by index and keeps extra sitelinks on fallback url', () => {
    const result = applyStoreProductLinksToCreativeSitelinks(
      [
        { text: 'Series A', url: '/' },
        { text: 'Series B', url: '/' },
        { text: 'Shop All', url: '/' },
      ],
      ['https://aff.example/a', 'https://aff.example/b'],
      'https://shop.example.com/store'
    )

    expect(result[0].sourceAffiliateLink).toBe('https://aff.example/a')
    expect(result[0].url).toBe('https://shop.example.com/store')
    expect(result[1].sourceAffiliateLink).toBe('https://aff.example/b')
    expect(result[2].sourceAffiliateLink).toBeUndefined()
    expect(result[2].url).toBe('https://shop.example.com/store')
  })
})
