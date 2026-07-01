/**
 * Offer 提取性能启发式（按提取模式读取配置）
 */

import {
  getDefaultOfferExtractionMode,
  getOfferExtractionModeProfile,
  type OfferExtractionMode,
} from '@/lib/offers/server'
import { isLikelyInvalidBrandName } from '@/lib/scraping'

function looksLikeIndependentProductDetailUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    if (!pathname || pathname === '/') return false
    return /\/(products?|product|item|goods)\//.test(pathname) || /\/p\/[a-z0-9]/.test(pathname)
  } catch {
    return false
  }
}

function hasIndependentReviewSignals(record: Record<string, unknown>): boolean {
  const structuredReviews = record.reviews
  if (Array.isArray(structuredReviews) && structuredReviews.length > 0) return true

  const topReviews = record.topReviews
  if (Array.isArray(topReviews) && topReviews.length > 0) return true

  const ratingRaw = record.rating
  const ratingValue =
    typeof ratingRaw === 'string'
      ? Number.parseFloat(ratingRaw.replace(/[^0-9.]/g, ''))
      : typeof ratingRaw === 'number'
        ? ratingRaw
        : Number.NaN
  if (Number.isFinite(ratingValue) && ratingValue > 0) return true

  const reviewCountRaw = record.reviewCount
  const reviewCountValue =
    typeof reviewCountRaw === 'string'
      ? Number.parseInt(reviewCountRaw.replace(/[^0-9]/g, ''), 10)
      : typeof reviewCountRaw === 'number'
        ? reviewCountRaw
        : Number.NaN
  return Number.isFinite(reviewCountValue) && reviewCountValue > 0
}

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
        reviews?: unknown[] | null
        topReviews?: unknown[] | null
        rating?: string | number | null
        reviewCount?: string | number | null
        specifications?: Record<string, unknown> | null
      }
    | null
    | undefined,
  targetUrl?: string
): boolean {
  if (!data) return true
  if (hasMinimalIndependentProductBaseline(data)) return false

  const record = data as unknown as Record<string, unknown>
  const hasProductName = hasNonEmptyStringField(record, 'productName')
  const hasBrand =
    hasNonEmptyStringField(record, 'brandName') &&
    !isLikelyInvalidBrandName(String(record.brandName))
  const hasImages = hasNonEmptyStringArrayField(record, 'imageUrls')
  const hasFeatureContent = hasNonEmptyStringArrayField(record, 'productFeatures')
  const hasDescription =
    hasNonEmptyStringField(record, 'productDescription') &&
    String(record.productDescription).trim().length >= 80
  const hasReviewSignals = hasIndependentReviewSignals(record)
  const specifications = record.specifications
  const hasSpecifications =
    !!specifications && typeof specifications === 'object' && Object.keys(specifications).length > 0

  if (!hasProductName || !hasBrand || !hasImages) return true

  const likelyProductDetailUrl = looksLikeIndependentProductDetailUrl(targetUrl)
  if (likelyProductDetailUrl && !hasReviewSignals) return true

  return !hasFeatureContent && !hasReviewSignals && !hasSpecifications && !hasDescription
}
