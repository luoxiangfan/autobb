/**
 * Match store_product_links affiliate URLs to Google Ads Sitelink landing pages.
 */
import { extractAsinFromOfferUrls } from '@/lib/openclaw/offers/offer-asin'

export interface ResolvedStoreProductLink {
  affiliateLink: string
  finalUrl: string | null
}

export function normalizeAffiliateLinkKey(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''

  try {
    const parsed = new URL(trimmed, 'https://yeahpromos.com')
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase()
    const path = parsed.pathname.replace(/\/$/, '') || ''
    const track = extractYeahpromosTrackKey(trimmed)
    if (track) {
      return `${host}${path}?track=${track.toLowerCase()}`
    }
    return `${host}${path}`
  } catch {
    return trimmed
  }
}

export function extractYeahpromosTrackKey(url: string): string | null {
  try {
    const parsed = new URL(url.trim(), 'https://yeahpromos.com')
    if (!parsed.hostname.toLowerCase().includes('yeahpromos.com')) return null
    const track = parsed.searchParams.get('track')?.trim()
    return track || null
  } catch {
    return null
  }
}

export function affiliatePromoLinksMatch(a: string, b: string): boolean {
  const trackA = extractYeahpromosTrackKey(a)
  const trackB = extractYeahpromosTrackKey(b)
  if (trackA && trackB) {
    return trackA.toLowerCase() === trackB.toLowerCase()
  }

  const keyA = normalizeAffiliateLinkKey(a)
  const keyB = normalizeAffiliateLinkKey(b)
  return Boolean(keyA && keyB && keyA === keyB)
}

export function findStoreProductLinkIndexByAffiliateKey(
  affiliateLink: string | null | undefined,
  storeProductLinks: string[]
): number {
  const trimmed = affiliateLink?.trim()
  if (!trimmed) return -1

  for (let index = 0; index < storeProductLinks.length; index++) {
    if (affiliatePromoLinksMatch(trimmed, storeProductLinks[index])) {
      return index
    }
  }
  return -1
}

export interface SitelinkTargetStoreMapping {
  affiliateLink: string
  finalUrl: string | null
  sortIndex: number
}

export function resolveSitelinkTargetStoreMapping(
  target: {
    affiliate_link?: string | null
    current_final_url?: string | null
    sort_index?: number | null
  },
  storeProductLinks: string[],
  resolvedLinks: ResolvedStoreProductLink[]
): SitelinkTargetStoreMapping | null {
  const landingIndex = findStoreProductLinkIndexForSitelinkFinalUrl(
    target.current_final_url,
    resolvedLinks
  )
  const affiliateKeyIndex = findStoreProductLinkIndexByAffiliateKey(
    target.affiliate_link,
    storeProductLinks
  )

  const buildMapping = (index: number): SitelinkTargetStoreMapping | null => {
    const affiliateLink = storeProductLinks[index]?.trim() || ''
    if (!affiliateLink) return null
    return {
      affiliateLink,
      finalUrl: resolvedLinks[index]?.finalUrl?.trim() || target.current_final_url?.trim() || null,
      sortIndex: index,
    }
  }

  if (landingIndex >= 0 && affiliateKeyIndex >= 0 && landingIndex !== affiliateKeyIndex) {
    if (extractYeahpromosTrackKey(target.affiliate_link || '')) {
      return buildMapping(affiliateKeyIndex)
    }
    return buildMapping(landingIndex)
  }

  if (affiliateKeyIndex >= 0) {
    return buildMapping(affiliateKeyIndex)
  }

  if (landingIndex >= 0) {
    return buildMapping(landingIndex)
  }

  const sortIndex = target.sort_index ?? -1
  if (sortIndex >= 0 && sortIndex < storeProductLinks.length) {
    return buildMapping(sortIndex)
  }

  return null
}

export function normalizeSitelinkLandingUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim()
  if (!trimmed) return null

  try {
    const parsed = new URL(trimmed)
    const pathname = parsed.pathname.replace(/\/$/, '') || '/'
    return `${parsed.origin}${pathname}`.toLowerCase()
  } catch {
    return trimmed.toLowerCase()
  }
}

export function sitelinkLandingKeysMatch(
  sitelinkFinalUrl: string | null | undefined,
  affiliateResolvedFinalUrl: string | null | undefined
): boolean {
  const sitelinkAsin = extractAsinFromOfferUrls(sitelinkFinalUrl, null)
  const affiliateAsin = extractAsinFromOfferUrls(affiliateResolvedFinalUrl, null)
  if (sitelinkAsin && affiliateAsin) {
    return sitelinkAsin === affiliateAsin
  }

  const sitelinkBase = normalizeSitelinkLandingUrl(sitelinkFinalUrl)
  const affiliateBase = normalizeSitelinkLandingUrl(affiliateResolvedFinalUrl)
  return Boolean(sitelinkBase && affiliateBase && sitelinkBase === affiliateBase)
}

export function findStoreProductLinkIndexForSitelinkFinalUrl(
  sitelinkFinalUrl: string | null | undefined,
  resolvedLinks: ResolvedStoreProductLink[]
): number {
  for (let index = 0; index < resolvedLinks.length; index++) {
    if (sitelinkLandingKeysMatch(sitelinkFinalUrl, resolvedLinks[index].finalUrl)) {
      return index
    }
  }
  return -1
}

export function findAffiliateLinkForSitelinkFinalUrl(
  sitelinkFinalUrl: string | null | undefined,
  resolvedLinks: ResolvedStoreProductLink[]
): string | null {
  const index = findStoreProductLinkIndexForSitelinkFinalUrl(sitelinkFinalUrl, resolvedLinks)
  if (index < 0) return null
  return resolvedLinks[index]?.affiliateLink?.trim() || null
}
