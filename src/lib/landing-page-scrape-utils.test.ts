import { describe, expect, it, vi } from 'vitest'
import { load } from 'cheerio'

// 避免 native bcrypt 二进制在测试环境的架构不匹配导致整套用例无法加载
vi.mock('bcrypt', () => ({
  default: {
    hash: async () => 'mock-hash',
    compare: async () => true,
  },
  hash: async () => 'mock-hash',
  compare: async () => true,
}))

describe('landing-page-scrape-utils (presell/int funnels)', () => {
  it('treats /int* and /checkout as presell-style urls', async () => {
    const { isPresellStyleUrl } = await import('./landing-page-scrape-utils')
    expect(isPresellStyleUrl('https://offer.happybirdy.co/wuzutech/smartbirdfeeder/en/us/int1')).toBe(true)
    expect(isPresellStyleUrl('https://offer.wuzutech.com/wuzutech/herzp1smartring/en/us/v2/checkout')).toBe(true)
  })

  it('extracts product name from "Brand - Product" title on funnel pages', async () => {
    const { extractLandingProductName } = await import('./landing-page-scrape-utils')
    const html = `
      <html>
        <head><title>Happy Birdy - Smart Bird Feeder</title></head>
        <body><h1>The Smart Bird Feeder That Brings Nature to You</h1></body>
      </html>
    `
    const $ = load(html)
    const name = extractLandingProductName($, 'https://offer.happybirdy.co/wuzutech/smartbirdfeeder/en/us/int1')
    expect(name).toBe('Smart Bird Feeder')
  })

  it('prefers domain-derived brand over path slug when current brand is missing', async () => {
    const { refineBrandNameForLandingPage } = await import('./landing-page-scrape-utils')
    const $ = load('<html><head><title>Some Page</title></head><body></body></html>')
    const refined = refineBrandNameForLandingPage({
      url: 'https://offer.happybirdy.co/wuzutech/smartbirdfeeder/en/us/int1',
      $,
      productName: null,
      currentBrandName: null,
    })
    expect(refined).toBe('Happybirdy')
  })
})
