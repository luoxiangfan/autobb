import { describe, expect, it } from 'vitest'
import {
  getOfferDeepScrapeTopN,
  hasMinimalIndependentProductBaseline,
  hasSufficientExtractedReviewsForAnalysis,
  shouldFallbackToRenderedIndependentProductForOffer,
  shouldRunPlaywrightCompetitorDeepScrape,
  shouldRunPlaywrightReviewDeepScrape,
  shouldRunCompetitorDetailScrapingInAi,
  shouldSkipAmazonCompetitorExtractionOnExtract,
} from '@/lib/offers/server'

describe('offer-extraction-performance', () => {
  it('uses mode-specific deep scrape counts', () => {
    expect(getOfferDeepScrapeTopN('fast')).toBe(3)
    expect(getOfferDeepScrapeTopN('balanced')).toBe(4)
    expect(getOfferDeepScrapeTopN('original')).toBe(5)
  })

  it('detects sufficient extracted reviews', () => {
    expect(hasSufficientExtractedReviewsForAnalysis({ topReviews: ['a', 'b', 'c'] }, 'fast')).toBe(
      true
    )
    expect(hasSufficientExtractedReviewsForAnalysis({ topReviews: ['a'] }, 'fast')).toBe(false)
  })

  it('mode-specific AI scrape gates', () => {
    expect(shouldRunPlaywrightReviewDeepScrape({ topReviews: ['a', 'b', 'c'] }, true, 'fast')).toBe(
      false
    )
    expect(shouldRunPlaywrightReviewDeepScrape({ topReviews: [] }, true, 'fast')).toBe(true)
    expect(shouldRunPlaywrightCompetitorDeepScrape({ relatedAsins: [] }, true, 'fast')).toBe(false)
    expect(shouldRunPlaywrightCompetitorDeepScrape({ relatedAsins: [] }, true, 'original')).toBe(
      true
    )
    expect(shouldRunCompetitorDetailScrapingInAi(true, 'fast')).toBe(false)
    expect(shouldRunCompetitorDetailScrapingInAi(true, 'balanced')).toBe(true)
    expect(shouldSkipAmazonCompetitorExtractionOnExtract('balanced')).toBe(false)
  })

  it('skips independent playwright when baseline fields exist in fast mode', () => {
    const baseline = {
      productName: 'Widget Pro',
      brandName: 'Acme',
      productPrice: '$29',
      imageUrls: ['https://example.com/a.jpg'],
    }
    expect(hasMinimalIndependentProductBaseline(baseline)).toBe(true)
    expect(
      shouldFallbackToRenderedIndependentProductForOffer(
        baseline,
        'https://shop.com/products/widget'
      )
    ).toBe(false)
  })
})
