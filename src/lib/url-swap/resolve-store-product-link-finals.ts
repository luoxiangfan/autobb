/**
 * Resolve store_product_links to final landing URLs for Sitelink ↔ affiliate pairing.
 */
import { resolveAffiliateLink } from '@/lib/scraping'
import type { ResolvedStoreProductLink } from './sitelink-affiliate-matching'

export async function resolveStoreProductLinkFinalUrls(params: {
  storeProductLinks: string[]
  targetCountry: string
  userId: number
  skipCache?: boolean
}): Promise<ResolvedStoreProductLink[]> {
  const resolved: ResolvedStoreProductLink[] = []

  for (const affiliateLink of params.storeProductLinks) {
    const trimmed = affiliateLink.trim()
    if (!trimmed) {
      resolved.push({ affiliateLink: trimmed, finalUrl: null })
      continue
    }

    try {
      const parsed = await resolveAffiliateLink(trimmed, {
        targetCountry: params.targetCountry,
        userId: params.userId,
        skipCache: params.skipCache ?? false,
      })
      resolved.push({
        affiliateLink: trimmed,
        finalUrl: parsed.finalUrl || null,
      })
    } catch {
      resolved.push({ affiliateLink: trimmed, finalUrl: null })
    }
  }

  return resolved
}
