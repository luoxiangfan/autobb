import { describe, expect, it } from 'vitest'
import {
  findAffiliateLinkForSitelinkFinalUrl,
  findStoreProductLinkIndexForSitelinkFinalUrl,
  sitelinkLandingKeysMatch,
} from '@/lib/url-swap/sitelink-affiliate-matching'

describe('sitelinkLandingKeysMatch', () => {
  it('matches Amazon product pages by ASIN even when paths differ', () => {
    expect(
      sitelinkLandingKeysMatch(
        'https://www.amazon.com/dp/B0CZ9GF4VY',
        'https://www.amazon.com/gp/product/B0CZ9GF4VY/ref=abc'
      )
    ).toBe(true)
  })

  it('matches non-Amazon pages by normalized origin + pathname', () => {
    expect(
      sitelinkLandingKeysMatch(
        'https://shop.example.com/products/widget/',
        'https://shop.example.com/products/widget'
      )
    ).toBe(true)
  })
})

describe('normalizeAffiliateLinkKey', () => {
  it('normalizes protocol and trailing slash for promo link lookup', async () => {
    const { normalizeAffiliateLinkKey } = await import('@/lib/url-swap/sitelink-affiliate-matching')
    expect(normalizeAffiliateLinkKey('https://pboost.me/r2aECf1tv/')).toBe('pboost.me/r2aECf1tv')
    expect(normalizeAffiliateLinkKey('http://www.pboost.me/r2aECf1tv')).toBe('pboost.me/r2aECf1tv')
  })
})

describe('findStoreProductLinkIndexForSitelinkFinalUrl', () => {
  it('finds the store_product_links index by resolved landing page', () => {
    const resolvedLinks = [
      {
        affiliateLink: 'https://pboost.me/V2aE0bkta',
        finalUrl: 'https://www.amazon.com/dp/B0OTHER111',
      },
      {
        affiliateLink: 'https://pboost.me/r2aECf1tv',
        finalUrl: 'https://www.amazon.com/dp/B0CZ9GF4VY',
      },
    ]

    expect(
      findStoreProductLinkIndexForSitelinkFinalUrl(
        'https://www.amazon.com/dp/B0CZ9GF4VY',
        resolvedLinks
      )
    ).toBe(1)

    expect(
      findAffiliateLinkForSitelinkFinalUrl('https://www.amazon.com/dp/B0CZ9GF4VY', resolvedLinks)
    ).toBe('https://pboost.me/r2aECf1tv')
  })
})
