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
    const parsed = new URL(trimmed)
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase()
    const path = parsed.pathname.replace(/\/$/, '') || ''
    return `${host}${path}`
  } catch {
    return trimmed
  }
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
