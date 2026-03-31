import { fetchBrandSearchSupplement } from './google-brand-search'
import { getProxyUrlForCountry } from './settings'
import { updateOfferExtractionMetadata } from './offers'

export interface BrandOfficialSite {
  url: string
  origin: string
  query: string
  resolvedAt: string
  source: 'google_serp' | 'cached' | 'heuristic'
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

function tryGetBrandOfficialSiteFromMetadata(extractionMetadata: string | null | undefined): BrandOfficialSite | null {
  const meta = safeParseJsonObject(extractionMetadata)
  if (!meta) return null

  const direct = meta.brandOfficialSite
  if (direct && typeof direct === 'object') {
    const url = typeof direct.url === 'string' ? direct.url.trim() : ''
    const origin = typeof direct.origin === 'string' ? direct.origin.trim() : ''
    const query = typeof direct.query === 'string' ? direct.query.trim() : ''
    if (url && origin && query) {
      return {
        url,
        origin,
        query,
        resolvedAt: typeof direct.resolvedAt === 'string' ? direct.resolvedAt : new Date().toISOString(),
        source: direct.source === 'google_serp' || direct.source === 'cached' ? direct.source : 'cached',
      }
    }
  }

  const maybeSupplementUrl = meta?.brandSearchSupplement?.officialSite?.url
  if (typeof maybeSupplementUrl === 'string' && maybeSupplementUrl.trim()) {
    try {
      const url = maybeSupplementUrl.trim()
      const origin = new URL(url).origin
      return {
        url,
        origin,
        query: typeof meta?.brandSearchSupplement?.query === 'string' ? meta.brandSearchSupplement.query : 'unknown',
        resolvedAt: typeof meta?.brandSearchSupplement?.searchedAt === 'string' ? meta.brandSearchSupplement.searchedAt : new Date().toISOString(),
        source: 'cached',
      }
    } catch {
      return null
    }
  }

  return null
}

function isMarketplaceHost(hostname: string): boolean {
  const h = (hostname || '').toLowerCase()
  return (
    /(^|\.)amazon\./i.test(h) ||
    /(^|\.)ebay\./i.test(h) ||
    /(^|\.)walmart\./i.test(h) ||
    /(^|\.)aliexpress\./i.test(h) ||
    /(^|\.)temu\./i.test(h) ||
    /(^|\.)etsy\./i.test(h)
  )
}

function normalizeTokens(input: string): string[] {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return []

  const stop = new Set([
    'the', 'a', 'an', 'and', 'or', 'for', 'with', 'to', 'of', 'in', 'on', 'by',
    'official', 'store', 'shop', 'website', 'site', 'online',
  ])

  const tokens = cleaned
    .split(' ')
    .map(t => t.trim())
    .filter(Boolean)
    .filter(t => t.length >= 3)
    .filter(t => !stop.has(t))

  return Array.from(new Set(tokens))
}

function buildBrandOfficialSiteQuery(params: {
  brand: string
  category?: string | null
  productName?: string | null
}): string {
  const brand = params.brand.trim()
  const brandTokens = new Set(normalizeTokens(brand))

  // Combine category + productName (productName gets higher weight) to reduce ambiguity.
  // Example: "Rove" + "On-Dash Cameras" + "Dash Cam" => query should include "dash cam".
  const hintTokens = [
    ...normalizeTokens(params.productName || ''),
    ...normalizeTokens(params.category || ''),
  ].filter(t => !brandTokens.has(t))
  const hint = hintTokens.slice(0, 4).join(' ')

  // Prefer "brand + category" to reduce ambiguity; fall back to brand-only if no usable hint.
  return hint ? `${brand} ${hint}` : brand
}

function normalizeDomainLabel(input: string): string {
  return (input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

function buildOfficialSiteHeuristicCandidates(params: {
  brand: string
  category?: string | null
  productName?: string | null
}): Array<{ url: string; scoreHint: number; queryHint: string }> {
  const brandLabel = normalizeDomainLabel(params.brand)
  if (!brandLabel) return []

  const tokens = [
    ...normalizeTokens(params.productName || ''),
    ...normalizeTokens(params.category || ''),
  ]

  const tokenSet = new Set(tokens)
  const hints: string[] = []

  // Special-case common compound terms.
  if ((tokenSet.has('dash') && (tokenSet.has('cam') || tokenSet.has('camera'))) || tokenSet.has('dashcam')) {
    hints.push('dashcam')
  }

  // Fall back to a small allowlist of high-signal product words.
  const allow = [
    'dashcam', 'camera', 'vacuum', 'robot', 'cleaner', 'security', 'doorbell',
    'headlights', 'led', 'charger', 'tracker', 'sensor', 'monitor',
  ]
  for (const t of tokens) {
    if (allow.includes(t)) hints.push(t)
  }

  const uniqHints = Array.from(new Set(hints)).slice(0, 4)
  const out: Array<{ url: string; scoreHint: number; queryHint: string }> = []

  for (const hint of uniqHints) {
    const domain = `${brandLabel}${hint}.com`
    out.push({
      url: `https://www.${domain}/`,
      scoreHint: 10,
      queryHint: `${params.brand} ${hint}`,
    })
    out.push({
      url: `https://${domain}/`,
      scoreHint: 9,
      queryHint: `${params.brand} ${hint}`,
    })
  }

  // Also try the bare brand domain as a last resort.
  const brandDomain = `${brandLabel}.com`
  out.push({ url: `https://www.${brandDomain}/`, scoreHint: 3, queryHint: params.brand })
  out.push({ url: `https://${brandDomain}/`, scoreHint: 2, queryHint: params.brand })

  return out
}

async function readTextUpTo(response: Response, maxBytes: number): Promise<string> {
  try {
    const body = response.body
    if (!body) return ''

    const reader = body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0

    while (received < maxBytes) {
      const { done, value } = await reader.read()
      if (done || !value) break
      chunks.push(value)
      received += value.byteLength
      if (received >= maxBytes) break
    }

    reader.releaseLock()
    const all = Buffer.concat(chunks.map(u => Buffer.from(u)))
    return all.toString('utf8')
  } catch {
    return ''
  }
}

async function tryResolveOfficialSiteByHeuristic(params: {
  brand: string
  category?: string | null
  productName?: string | null
}): Promise<{ url: string; origin: string; queryHint: string } | null> {
  const candidates = buildOfficialSiteHeuristicCandidates(params)
  if (candidates.length === 0) return null

  const brandKey = normalizeDomainLabel(params.brand)
  const contextTokens = new Set([
    ...normalizeTokens(params.productName || ''),
    ...normalizeTokens(params.category || ''),
  ])
  contextTokens.delete(brandKey)

  for (const candidate of candidates) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    try {
      const res = await fetch(candidate.url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          // Best-effort: hint server to return small HTML
          'user-agent': 'Mozilla/5.0 (compatible; AutoAdsBot/1.0)',
          'accept': 'text/html,application/xhtml+xml',
          'range': 'bytes=0-65535',
        },
      })

      if (!res.ok || res.status >= 400) continue

      const finalUrl = res.url || candidate.url
      let origin: string
      try {
        origin = new URL(finalUrl).origin
      } catch {
        continue
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase()
      if (contentType && !contentType.includes('text/html')) {
        continue
      }

      const html = (await readTextUpTo(res, 96 * 1024)).toLowerCase()
      if (!html) continue

      // Strict validation to reduce false positives:
      // - Must mention the brand
      // - Must mention at least one context token (e.g. "dash", "camera", "vacuum")
      if (brandKey && !html.includes(brandKey)) continue

      const hasContext = Array.from(contextTokens).some(t => t && html.includes(t))
      if (!hasContext) continue

      return { url: finalUrl, origin, queryHint: candidate.queryHint }
    } catch {
      // continue
    } finally {
      clearTimeout(timeout)
    }
  }

  return null
}

export async function ensureOfferBrandOfficialSite(params: {
  offerId: number
  userId: number
  brand: string
  targetCountry: string
  finalUrl?: string | null
  url?: string | null
  category?: string | null
  productName?: string | null
  extractionMetadata?: string | null
}): Promise<BrandOfficialSite | null> {
  const cached = tryGetBrandOfficialSiteFromMetadata(params.extractionMetadata)
  if (cached?.origin) return cached

  const primaryUrl = params.finalUrl || params.url || ''
  const needForMarketplace = (() => {
    try {
      const host = new URL(primaryUrl).hostname
      return isMarketplaceHost(host)
    } catch {
      return false
    }
  })()
  if (!needForMarketplace) return null

  const proxyApiUrl = await getProxyUrlForCountry(params.targetCountry, params.userId)

  const query = buildBrandOfficialSiteQuery({
    brand: params.brand,
    category: params.category,
    productName: params.productName,
  })

  let officialUrl: string | undefined
  let origin: string | undefined
  let resolvedQuery: string = query
  let supplement: Awaited<ReturnType<typeof fetchBrandSearchSupplement>> | null = null
  let source: BrandOfficialSite['source'] = 'google_serp'

  // Preferred path: Google SERP via proxy (best-effort).
  if (proxyApiUrl) {
    supplement = await fetchBrandSearchSupplement({
      brandName: params.brand,
      query,
      targetCountry: params.targetCountry,
      proxyApiUrl,
      maxProxyRetries: 1,
    })

    officialUrl = supplement?.officialSite?.url?.trim()
    if (supplement?.query) resolvedQuery = supplement.query
    if (officialUrl) {
      try {
        origin = new URL(officialUrl).origin
      } catch {
        officialUrl = undefined
      }
    }

    if (!officialUrl || !origin) {
      // Fall back to heuristic when SERP didn't yield an official site.
      const guess = await tryResolveOfficialSiteByHeuristic({
        brand: params.brand,
        category: params.category,
        productName: params.productName,
      })
      if (guess?.origin) {
        officialUrl = guess.url
        origin = guess.origin
        resolvedQuery = guess.queryHint || resolvedQuery
        source = 'heuristic'
      }
    }
  } else {
    // If proxy isn't configured, try heuristic resolution instead of giving up.
    const guess = await tryResolveOfficialSiteByHeuristic({
      brand: params.brand,
      category: params.category,
      productName: params.productName,
    })
    if (guess?.origin) {
      officialUrl = guess.url
      origin = guess.origin
      resolvedQuery = guess.queryHint || resolvedQuery
      source = 'heuristic'
    } else {
      return null
    }
  }

  if (!officialUrl || !origin) return null

  const existing = safeParseJsonObject(params.extractionMetadata) || {}
  const resolvedAt = new Date().toISOString()

  const brandOfficialSite: BrandOfficialSite = {
    url: officialUrl,
    origin,
    query: resolvedQuery,
    resolvedAt,
    source,
  }

  const minimizedSupplement = supplement
    ? {
        query: supplement?.query || resolvedQuery,
        targetCountry: params.targetCountry,
        searchedAt: supplement?.searchedAt || resolvedAt,
        officialSite: supplement?.officialSite || { url: officialUrl },
      }
    : null

  const merged = {
    ...existing,
    brandOfficialSite,
    // Keep backward compatibility: store an "officialSite" entry even when resolved heuristically.
    brandSearchSupplement: minimizedSupplement ||
      existing.brandSearchSupplement || {
        query: resolvedQuery,
        targetCountry: params.targetCountry,
        searchedAt: resolvedAt,
        officialSite: { url: officialUrl },
      },
  }

  const mergedString = JSON.stringify(merged)
  await updateOfferExtractionMetadata(params.offerId, params.userId, mergedString)

  return brandOfficialSite
}
