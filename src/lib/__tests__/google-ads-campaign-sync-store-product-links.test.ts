import { describe, expect, it } from 'vitest'
import {
  extractStoreProductLinksFromCampaignConfig,
  parseOfferStoreProductLinksColumn,
  serializeStoreProductLinks,
  storeProductLinksEqual,
} from '@/lib/google-ads/campaign/sync/store-product-links'

describe('google-ads-campaign-sync/store-product-links', () => {
  it('extracts product page URLs from sitelinks', () => {
    const links = extractStoreProductLinksFromCampaignConfig({
      sitelinks: [
        { text: 'Product A', url: 'https://www.amazon.com/dp/B001' },
        { text: 'Store Home', url: 'https://www.amazon.com/stores/acme/page/ABC' },
        { text: 'Product B', url: 'https://brand.example.com/products/widget' },
      ],
    })

    expect(links).toEqual([
      'https://www.amazon.com/dp/B001',
      'https://brand.example.com/products/widget',
    ])
  })

  it('caps extracted links at MAX_STORE_PRODUCT_LINKS', () => {
    const links = extractStoreProductLinksFromCampaignConfig({
      sitelinks: Array.from({ length: 8 }, (_, index) => ({
        text: `Item ${index + 1}`,
        url: `https://www.amazon.com/dp/B00000000${index}`,
      })),
    })

    expect(links).toHaveLength(6)
  })

  it('serializes and parses offer store_product_links column values', () => {
    const serialized = serializeStoreProductLinks([
      'https://www.amazon.com/dp/B001',
      'https://www.amazon.com/dp/B002',
    ])
    expect(serialized).toBe(
      JSON.stringify(['https://www.amazon.com/dp/B001', 'https://www.amazon.com/dp/B002'])
    )
    expect(parseOfferStoreProductLinksColumn(serialized)).toEqual([
      'https://www.amazon.com/dp/B001',
      'https://www.amazon.com/dp/B002',
    ])
  })

  it('compares normalized store product link arrays', () => {
    expect(
      storeProductLinksEqual(['https://www.amazon.com/dp/B001'], ['https://www.amazon.com/dp/B001'])
    ).toBe(true)
    expect(
      storeProductLinksEqual(['https://www.amazon.com/dp/B001'], ['https://www.amazon.com/dp/B002'])
    ).toBe(false)
  })
})
