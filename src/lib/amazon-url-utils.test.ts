import { describe, expect, it } from 'vitest'
import {
  detectAmazonPageTypeFromUrl,
  extractAmazonStoreSlugFromUrl,
  isAmazonHostname,
  isAmazonProductPath,
  isAmazonStorePath,
  isAmazonVanityStorePath,
} from './amazon-url-utils'

describe('amazon-url-utils', () => {
  it('detects Amazon hostnames', () => {
    expect(isAmazonHostname('www.amazon.com')).toBe(true)
    expect(isAmazonHostname('www.amazon.co.uk')).toBe(true)
    expect(isAmazonHostname('example.com')).toBe(false)
  })

  it('recognizes canonical store paths and vanity storefront slugs', () => {
    expect(isAmazonStorePath('/stores/acme-brand/page/ABC')).toBe(true)
    expect(isAmazonStorePath('/store/acme-brand')).toBe(true)
    expect(isAmazonVanityStorePath('/acme-brand')).toBe(true)
    expect(isAmazonVanityStorePath('/dp/B012345678')).toBe(false)
    expect(isAmazonVanityStorePath('/s')).toBe(false)
    expect(isAmazonVanityStorePath('/b012345678')).toBe(false)
  })

  it('recognizes product paths', () => {
    expect(isAmazonProductPath('/dp/B012345678')).toBe(true)
    expect(isAmazonProductPath('/gp/product/B012345678')).toBe(true)
  })

  it('extracts store slug from /stores/ and vanity URLs', () => {
    expect(extractAmazonStoreSlugFromUrl('https://www.amazon.com/stores/acme-brand/page/ABC')).toBe('acme-brand')
    expect(extractAmazonStoreSlugFromUrl('https://www.amazon.com/acme-brand')).toBe('acme-brand')
    expect(extractAmazonStoreSlugFromUrl('https://www.amazon.com/dp/B012345678')).toBeNull()
  })

  it('classifies page type from URL when page_type is absent', () => {
    expect(detectAmazonPageTypeFromUrl('https://www.amazon.com/stores/acme-brand/page/ABC')).toBe('store')
    expect(detectAmazonPageTypeFromUrl('https://www.amazon.com/acme-brand')).toBe('store')
    expect(detectAmazonPageTypeFromUrl('https://www.amazon.com/dp/B012345678')).toBe('product')
    expect(detectAmazonPageTypeFromUrl('https://example.com/store')).toBe('unknown')
  })
})
