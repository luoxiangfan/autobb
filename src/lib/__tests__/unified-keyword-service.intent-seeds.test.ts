import { describe, expect, it } from 'vitest'

import {
  buildIntentAwareSeedPool,
  extractVerifiedKeywordSourcePool,
} from '../unified-keyword-service'

describe('buildIntentAwareSeedPool', () => {
  it('aggregates recurring product-line seeds from store products', () => {
    const result = buildIntentAwareSeedPool({
      brand: 'Eufy',
      category: 'Robot Vacuum',
      productTitle: 'Eufy X10 Pro Omni Robot Vacuum',
      scrapedData: JSON.stringify({
        products: [
          { title: 'Eufy X10 Pro Omni Robot Vacuum' },
          { title: 'Eufy X10 Pro Omni Vacuum Cleaner' },
          { title: 'Eufy X8 Pro Robot Vacuum' },
          { title: 'Eufy X8 Pro Vacuum Cleaner' },
        ],
      }),
    })

    expect(result.brandOrientedSeeds).toContain('Eufy X10 Pro')
    expect(result.allSeeds).toContain('eufy x10 pro')
    expect(result.featureOrientedSeeds).toContain('eufy x10 pro')
  })

  it('extracts verified title/about/param/page keywords from real page signals', () => {
    const sourcePool = extractVerifiedKeywordSourcePool({
      brand: 'Eufy',
      category: 'Robot Vacuum',
      productTitle: 'Eufy X10 Pro Omni Robot Vacuum',
      productFeatures: 'Self-empty station; pet hair cleaning',
      scrapedData: JSON.stringify({
        rawProductTitle: 'Eufy X10 Pro Omni Robot Vacuum',
        rawAboutThisItem: ['Self-empty station', 'Pet hair cleaning'],
        specifications: {
          Model: 'X10 Pro Omni',
          Suction: '8000Pa',
        },
      }),
      reviewAnalysis: JSON.stringify({
        customerUseCases: ['pet hair cleaning', 'whole home cleaning'],
      }),
    })

    expect(sourcePool.titleKeywords).toContain('Eufy X10 Pro')
    expect(sourcePool.aboutKeywords).toContain('Eufy self empty station')
    expect(sourcePool.paramKeywords).toContain('Eufy X10 Pro')
    expect(sourcePool.pageKeywords).toContain('Eufy pet hair cleaning')
  })

  it('extracts model anchors from hot product specs even when hot product names are generic', () => {
    const sourcePool = extractVerifiedKeywordSourcePool({
      brand: 'Eufy',
      category: 'Robot Vacuum',
      scrapedData: JSON.stringify({
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
      }),
    })

    expect(sourcePool.hotProductNames).toContain('Eufy Robot Vacuum Cleaner')
    expect(sourcePool.paramKeywords.some((keyword) => keyword.includes('X10 Pro'))).toBe(true)
  })

  it('does not keep identifier anchors from structured asin-like fields', () => {
    const sourcePool = extractVerifiedKeywordSourcePool({
      brand: 'Novilla',
      category: 'Mattress',
      productTitle: 'Novilla King Size Mattress',
      scrapedData: JSON.stringify({
        asin: 'B0CJJ9SB4Y',
      }),
    })

    expect(sourcePool.paramKeywords.some((keyword) => /b0cjj9sb4y/i.test(keyword))).toBe(false)
  })

  it('does not turn opaque parameter model identifiers into branded seed keywords', () => {
    const sourcePool = extractVerifiedKeywordSourcePool({
      brand: 'Novilla',
      category: 'Mattress',
      productTitle: 'Novilla King Size Mattress, 10 Inch Memory Foam Mattress',
      scrapedData: JSON.stringify({
        rawProductTitle: 'Novilla King Size Mattress, 10 Inch Memory Foam Mattress',
        technicalDetails: {
          'Model Name': 'N-M01035',
          'Model Number': 'NAMM10KWV12',
          Size: 'King',
        },
      }),
    })

    expect(sourcePool.paramKeywords.some((keyword) => /m01035|namm10kwv12/i.test(keyword))).toBe(false)
  })
})
