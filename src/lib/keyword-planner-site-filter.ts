/**
 * Keyword Planner "Enter a site to filter unrelated keywords" helper.
 *
 * We pass an origin-level URL (scheme + host) to reduce page-level bias.
 * Some marketplace domains are excluded because site filtering tends to introduce
 * platform-generic keywords rather than brand-relevant ones.
 */

const MARKETPLACE_HOST_PATTERNS: RegExp[] = [
  /(^|\.)amazon\./i,
  /(^|\.)ebay\./i,
  /(^|\.)walmart\./i,
  /(^|\.)aliexpress\./i,
  /(^|\.)temu\./i,
  /(^|\.)etsy\./i,
]

function isMarketplaceHostname(hostname: string): boolean {
  const h = (hostname || '').toLowerCase()
  return MARKETPLACE_HOST_PATTERNS.some(re => re.test(h))
}

function normalizeUrlCandidate(inputUrl: string): string {
  const trimmed = inputUrl.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  return `https://${trimmed}`
}

export function getKeywordPlannerSiteFilterUrl(inputUrl: string | undefined | null): string | undefined {
  if (!inputUrl) return undefined

  try {
    const url = new URL(normalizeUrlCandidate(inputUrl))
    const hostname = url.hostname.toLowerCase()

    if (isMarketplaceHostname(hostname)) {
      return undefined
    }

    return url.origin
  } catch {
    return undefined
  }
}

function safeParseJsonObject(value: string | null | undefined): Record<string, any> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, any>) : null
  } catch {
    return null
  }
}

/**
 * Prefer a non-marketplace official site (if previously resolved) when the offer URL is a marketplace.
 */
export function getKeywordPlannerSiteFilterUrlForOffer(offer: {
  final_url?: string | null
  url?: string | null
  extraction_metadata?: string | null
}): string | undefined {
  const direct = getKeywordPlannerSiteFilterUrl(offer?.final_url || offer?.url)
  if (direct) return direct

  const meta = safeParseJsonObject(offer?.extraction_metadata)
  const origin = typeof meta?.brandOfficialSite?.origin === 'string' ? meta.brandOfficialSite.origin.trim() : ''
  if (origin) {
    const parsed = getKeywordPlannerSiteFilterUrl(origin)
    if (parsed) return parsed
  }

  const officialUrl = typeof meta?.brandSearchSupplement?.officialSite?.url === 'string'
    ? meta.brandSearchSupplement.officialSite.url.trim()
    : ''
  if (officialUrl) return getKeywordPlannerSiteFilterUrl(officialUrl)

  return undefined
}

/**
 * Get a URL seed for Keyword Planner to filter unrelated keywords.
 *
 * Preferred:
 * - Non-marketplace origin (scheme + host)
 * - Brand official site origin (from extraction_metadata)
 *
 * Fallback (optional):
 * - Marketplace product page URL (full URL) when no official site is available.
 *
 * This helps disambiguate short/ambiguous brands (e.g. "Rove") to reduce unrelated ideas.
 */
export function getKeywordPlannerUrlSeedForOffer(
  offer: {
    final_url?: string | null
    url?: string | null
    extraction_metadata?: string | null
  },
  options?: { allowMarketplaceProductUrl?: boolean }
): string | undefined {
  const site = getKeywordPlannerSiteFilterUrlForOffer(offer)
  if (site) return site

  if (!options?.allowMarketplaceProductUrl) return undefined

  const raw = offer?.final_url || offer?.url
  if (!raw) return undefined

  try {
    const url = new URL(normalizeUrlCandidate(raw))
    if (!isMarketplaceHostname(url.hostname)) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}
