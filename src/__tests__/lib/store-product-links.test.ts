import { describe, expect, it } from 'vitest'
import {
  MAX_STORE_PRODUCT_LINKS,
  normalizeStoreProductLinkList,
  storeProductLinksTypeError,
} from '@/lib/offers/store-product-links'

describe('store-product-links', () => {
  it('caps normalized links at MAX_STORE_PRODUCT_LINKS', () => {
    const links = Array.from({ length: 8 }, (_, index) => `https://example.com/item-${index + 1}`)
    expect(normalizeStoreProductLinkList(links)).toHaveLength(MAX_STORE_PRODUCT_LINKS)
    expect(normalizeStoreProductLinkList(links)[0]).toBe('https://example.com/item-1')
    expect(normalizeStoreProductLinkList(links)[5]).toBe('https://example.com/item-6')
  })

  it('deduplicates and trims links', () => {
    expect(
      normalizeStoreProductLinkList([
        ' https://example.com/a ',
        'https://example.com/a',
        '',
        'https://example.com/b',
      ])
    ).toEqual(['https://example.com/a', 'https://example.com/b'])
  })

  it('builds type error message from constant', () => {
    expect(storeProductLinksTypeError()).toContain(String(MAX_STORE_PRODUCT_LINKS))
  })
})
