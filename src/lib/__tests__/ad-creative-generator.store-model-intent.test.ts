import { describe, expect, it } from 'vitest'

import { evaluateStoreModelIntentReadiness } from '../ad-creative-generator'

describe('evaluateStoreModelIntentReadiness', () => {
  it('passes when store model intent has verified hot products with model anchors', () => {
    const readiness = evaluateStoreModelIntentReadiness({
      bucket: 'B',
      linkType: 'store',
      scrapedData: {
        deepScrapeResults: {
          topProducts: [
            { productData: { productName: 'Eufy X10 Pro Omni Robot Vacuum' } },
            { productData: { productName: 'Eufy X8 Pro Robot Vacuum' } },
          ],
        },
      },
      brandAnalysis: null,
    })

    expect(readiness.isReady).toBe(true)
    expect(readiness.verifiedHotProducts).toContain('Eufy X10 Pro Omni Robot Vacuum')
    expect(readiness.hotProductModelAnchors).toContain('Eufy X10 Pro Omni Robot Vacuum')
  })

  it('fails when store model intent has no verified hot products', () => {
    const readiness = evaluateStoreModelIntentReadiness({
      bucket: 'B',
      linkType: 'store',
      scrapedData: {},
      brandAnalysis: null,
    })

    expect(readiness.isReady).toBe(false)
    expect(readiness.reason).toContain('未获取到可验证的热门商品')
  })

  it('fails when hot products exist but no model or series anchors can be verified', () => {
    const readiness = evaluateStoreModelIntentReadiness({
      bucket: 'B',
      linkType: 'store',
      scrapedData: {
        products: [
          { name: 'Eufy Robot Vacuum Cleaner' },
          { name: 'Eufy Smart Vacuum Cleaner' },
        ],
      },
      brandAnalysis: {
        hotProducts: [
          { name: 'Eufy Home Cleaning Collection' },
        ],
      },
    })

    expect(readiness.isReady).toBe(false)
    expect(readiness.verifiedHotProducts.length).toBeGreaterThan(0)
    expect(readiness.reason).toContain('未提取到可验证的型号/产品族锚点')
  })

  it('accepts store model intent when hot product specs or variants expose model anchors', () => {
    const readiness = evaluateStoreModelIntentReadiness({
      bucket: 'B',
      linkType: 'store',
      scrapedData: {
        deepScrapeResults: {
          topProducts: [
            {
              productData: {
                productName: 'Eufy Robot Vacuum Cleaner',
                specifications: {
                  Model: 'X10 Pro Omni',
                },
                variants: [
                  { name: 'X10 Pro Omni Black' },
                ],
              },
            },
          ],
        },
      },
      brandAnalysis: null,
    })

    expect(readiness.isReady).toBe(true)
    expect(readiness.verifiedHotProducts).toContain('Eufy Robot Vacuum Cleaner')
    expect(readiness.hotProductModelAnchors.some((anchor) => anchor.includes('X10 Pro'))).toBe(true)
  })

  it('falls back to store_product_links when scraped hot product sources are empty', () => {
    const readiness = evaluateStoreModelIntentReadiness({
      bucket: 'B',
      linkType: 'store',
      scrapedData: {},
      brandAnalysis: null,
      storeProductLinks: JSON.stringify([
        'https://example.com/products/eufy-x10-pro-omni-robot-vacuum',
        'https://example.com/products/eufy-x8-pro-robot-vacuum',
      ]),
    })

    expect(readiness.isReady).toBe(true)
    expect(readiness.evidenceSources).toContain('offer.store_product_links')
    expect(readiness.verifiedHotProducts.length).toBeGreaterThan(0)
    expect(readiness.hotProductModelAnchors.some((anchor) => /x10 pro omni/i.test(anchor))).toBe(true)
  })

  it('keeps only top3 verified hot products by default', () => {
    const readiness = evaluateStoreModelIntentReadiness({
      bucket: 'B',
      linkType: 'store',
      scrapedData: {
        deepScrapeResults: {
          topProducts: [
            { productData: { productName: 'Acme S10 Pro Vacuum' } },
            { productData: { productName: 'Acme S20 Pro Vacuum' } },
            { productData: { productName: 'Acme S30 Pro Vacuum' } },
            { productData: { productName: 'Acme S40 Pro Vacuum' } },
            { productData: { productName: 'Acme S50 Pro Vacuum' } },
          ],
        },
      },
      brandAnalysis: null,
    })

    expect(readiness.isReady).toBe(true)
    expect(readiness.verifiedHotProducts.length).toBe(3)
  })

  it('skips validation for non-store or non-model-intent creatives', () => {
    const readiness = evaluateStoreModelIntentReadiness({
      bucket: 'A',
      linkType: 'product',
      scrapedData: {},
      brandAnalysis: null,
    })

    expect(readiness.isReady).toBe(true)
    expect(readiness.verifiedHotProducts).toEqual([])
  })
})
