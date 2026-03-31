import { describe, it, expect } from 'vitest'
import { load } from 'cheerio'
import { normalizeBrandName } from '@/lib/offer-utils'
import { refineBrandNameForLandingPage } from '@/lib/landing-page-scrape-utils'

describe('normalizeBrandName', () => {
  it('normalizes BJ’s/BJ\'s/bjs to "BJs"', () => {
    expect(normalizeBrandName('bjs')).toBe('BJs')
    expect(normalizeBrandName("BJ's")).toBe('BJs')
    expect(normalizeBrandName('BJ’S')).toBe('BJs')
    expect(normalizeBrandName("BJ’S")).toBe('BJs')
    expect(normalizeBrandName("BJ'S")).toBe('BJs')
    expect(normalizeBrandName('BJs')).toBe('BJs')
  })
})

describe('refineBrandNameForLandingPage', () => {
  it('prefers the domain brand for bjs.com membership pages', () => {
    const html = '<html><head><title>Join BJs Wholesale Club</title></head><body></body></html>'
    const $ = load(html)

    const refined = refineBrandNameForLandingPage({
      url: 'https://www.bjs.com/membership/clubCardEnroll',
      $,
      productName: null,
      currentBrandName: "BJ's Wholesale Club",
    })

    expect(refined).toBe('BJs')
  })
})
