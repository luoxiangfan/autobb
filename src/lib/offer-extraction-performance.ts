/**
 * Offer 提取性能启发式（按提取模式读取配置）
 */

import {
  getDefaultOfferExtractionMode,
  getOfferExtractionModeProfile,
  type OfferExtractionMode,
} from '@/lib/offer-extraction-mode'

function profileFor(mode?: OfferExtractionMode | string | null) {
  return getOfferExtractionModeProfile(mode ?? getDefaultOfferExtractionMode())
}

function countNonEmptyStrings(items: unknown): number {
  if (!Array.isArray(items)) return 0
  return items.filter((item) => typeof item === 'string' && item.trim().length > 0).length
}

export function getOfferDeepScrapeTopN(mode?: OfferExtractionMode | string | null): number {
  return profileFor(mode).deepScrapeTopN
}

export function getOfferDeepScrapeConcurrency(mode?: OfferExtractionMode | string | null): number {
  return profileFor(mode).deepScrapeConcurrency
}

export function getOfferProductLightScrapeTimeoutMs(
  mode?: OfferExtractionMode | string | null
): number {
  return profileFor(mode).lightScrapeTimeoutMs
}

export function getOfferAmazonProductMaxProxyRetries(
  mode?: OfferExtractionMode | string | null
): number {
  return profileFor(mode).amazonMaxProxyRetries
}

export function shouldSkipAmazonCompetitorExtractionOnExtract(
  mode?: OfferExtractionMode | string | null
): boolean {
  return profileFor(mode).skipAmazonCompetitorExtraction
}

export function getAmazonScrapeOptionsForMode(mode?: OfferExtractionMode | string | null): {
  fastMode: boolean
  waitMs: number
  maxNoJsRetries: number
} {
  const profile = profileFor(mode)
  return {
    fastMode: profile.amazonFastScrape,
    waitMs: profile.amazonWaitMs,
    maxNoJsRetries: profile.amazonMaxNoJsRetries,
  }
}

export function hasSufficientExtractedReviewsForAnalysis(
  extractResult: unknown,
  mode?: OfferExtractionMode | string | null
): boolean {
  if (!extractResult || typeof extractResult !== 'object') return false
  const data = extractResult as Record<string, unknown>
  const profile = profileFor(mode)

  if (countNonEmptyStrings(data.topReviews) >= profile.minTopReviewsToSkipReviewDeepScrape)
    return true
  if (
    countNonEmptyStrings(data.reviewHighlights) >= profile.minReviewHighlightsToSkipReviewDeepScrape
  ) {
    return true
  }

  const structuredReviews = data.reviews
  if (
    Array.isArray(structuredReviews) &&
    structuredReviews.length >= profile.minStructuredReviewsToSkipReviewDeepScrape
  ) {
    return true
  }

  const deepResults = data.deepScrapeResults as { aggregatedReviews?: unknown } | undefined
  if (
    countNonEmptyStrings(deepResults?.aggregatedReviews) >=
    profile.minStructuredReviewsToSkipReviewDeepScrape
  ) {
    return true
  }

  return false
}

export function shouldRunPlaywrightReviewDeepScrape(
  extractResult: unknown,
  enablePlaywrightDeepScraping?: boolean,
  mode?: OfferExtractionMode | string | null
): boolean {
  const profile = profileFor(mode)
  if (!enablePlaywrightDeepScraping) return false
  if (!profile.aiPlaywrightDeepScrapeEnabled) return false
  if (hasSufficientExtractedReviewsForAnalysis(extractResult, mode)) return false
  return true
}

export function shouldRunPlaywrightCompetitorDeepScrape(
  extractResult: unknown,
  enablePlaywrightDeepScraping?: boolean,
  mode?: OfferExtractionMode | string | null
): boolean {
  const profile = profileFor(mode)
  if (!enablePlaywrightDeepScraping) return false
  if (!profile.aiPlaywrightCompetitorDeepScrape) return false
  if (!extractResult || typeof extractResult !== 'object') return true
  const data = extractResult as Record<string, unknown>
  const relatedAsins = data.relatedAsins
  if (Array.isArray(relatedAsins) && relatedAsins.length > 0) return false
  return true
}

export function shouldRunCompetitorDetailScrapingInAi(
  enableCompetitorAnalysis?: boolean,
  mode?: OfferExtractionMode | string | null
): boolean {
  if (!enableCompetitorAnalysis) return false
  return profileFor(mode).aiCompetitorDetailScrape
}

export function getOfferProductReviewDeepScrapeLimit(
  mode?: OfferExtractionMode | string | null
): number {
  return profileFor(mode).reviewDeepScrapeLimit
}

export function getOfferAiCompetitorDetailLimit(
  mode?: OfferExtractionMode | string | null
): number {
  return profileFor(mode).aiCompetitorDetailLimit
}

export function hasMinimalIndependentProductBaseline(
  data:
    | {
        productName?: string | null
        brandName?: string | null
        productPrice?: string | null
        imageUrls?: string[] | null
      }
    | null
    | undefined
): boolean {
  if (!data) return false
  const hasProductName = typeof data.productName === 'string' && data.productName.trim().length > 0
  const hasBrand = typeof data.brandName === 'string' && data.brandName.trim().length > 0
  const hasPrice = typeof data.productPrice === 'string' && data.productPrice.trim().length > 0
  const hasImages =
    Array.isArray(data.imageUrls) &&
    data.imageUrls.some((item) => typeof item === 'string' && item.trim().length > 0)
  return hasProductName && hasBrand && (hasPrice || hasImages)
}

function hasNonEmptyStringField(data: Record<string, unknown>, key: string): boolean {
  const value = data[key]
  return typeof value === 'string' && value.trim().length > 0
}

function hasNonEmptyStringArrayField(data: Record<string, unknown>, key: string): boolean {
  const value = data[key]
  return (
    Array.isArray(value) && value.some((item) => typeof item === 'string' && item.trim().length > 0)
  )
}

export function shouldFallbackToRenderedIndependentProductForOffer(
  data:
    | {
        productName?: string | null
        brandName?: string | null
        productPrice?: string | null
        imageUrls?: string[] | null
        productFeatures?: string[] | null
        productDescription?: string | null
      }
    | null
    | undefined,
  targetUrl?: string
): boolean {
  if (!data) return true
  if (hasMinimalIndependentProductBaseline(data)) return false

  const record = data as unknown as Record<string, unknown>
  const hasProductName = hasNonEmptyStringField(record, 'productName')
  const hasBrand = hasNonEmptyStringField(record, 'brandName')
  const hasImages = hasNonEmptyStringArrayField(record, 'imageUrls')
  const hasFeatureContent = hasNonEmptyStringArrayField(record, 'productFeatures')
  const hasDescription =
    hasNonEmptyStringField(record, 'productDescription') &&
    (record.productDescription as string).trim().length >= 80

  if (!hasProductName) return true
  if (!hasBrand) return true
  if (!hasImages) return true

  const likelyProductDetailUrl = (() => {
    if (!targetUrl) return false
    try {
      const pathname = new URL(targetUrl).pathname.toLowerCase()
      if (!pathname || pathname === '/') return false
      return /\/(products?|product|item|goods)\//.test(pathname) || /\/p\/[a-z0-9]/.test(pathname)
    } catch {
      return false
    }
  })()

  if (likelyProductDetailUrl && !hasFeatureContent && !hasDescription) return true
  return false
}
