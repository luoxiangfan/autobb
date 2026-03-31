import { isLikelyInvalidBrandName } from './brand-name-utils'

function normalizeBrandNameLight(brand: string): string {
  const trimmed = String(brand || '').trim()
  if (!trimmed) return trimmed

  // Keep common all-caps abbreviations (subset of offer-utils normalization).
  const ABBREVIATIONS = new Set([
    'IBM', 'HP', 'LG', 'BMW', 'ASUS', 'DELL', 'AMD', 'AT&T',
    'USA', 'UK', 'EU', 'NASA', 'FBI', 'CIA', 'DVD', 'LCD',
    'LED', 'USB', 'GPS', 'API', 'SEO', 'CEO', 'CTO', 'CFO',
  ])

  if (ABBREVIATIONS.has(trimmed.toUpperCase())) return trimmed.toUpperCase()

  return trimmed
    .split(/\s+/)
    .map((word) => {
      if (!word) return word
      if (ABBREVIATIONS.has(word.toUpperCase())) return word.toUpperCase()
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

function extractBrandFromAmazonStoreHref(href: string): string | null {
  const raw = href.trim()
  if (!raw) return null

  const m =
    raw.match(/\/stores\/([^\/?#]+)(?:\/|$)/i) ||
    raw.match(/amazon\.[a-z.]+\/stores\/([^\/?#]+)(?:\/|$)/i)

  if (!m?.[1]) return null
  const decoded = decodeURIComponent(m[1])
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-+_]+/g, ' ')
    .trim()

  if (!decoded) return null
  const normalized = normalizeBrandNameLight(decoded)
  return isLikelyInvalidBrandName(normalized) ? null : normalized
}

function normalizeBrandCompareKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function looksLikeBylineBoilerplate(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true

  if (/^(consulter|consultez|visitez|visiter|visit|besuchen|besuche|visita|bezoek|odwiedź)\b/i.test(trimmed)) {
    return true
  }
  if (/^(store|shop|boutique|magasin|tienda|negozio|loja|winkel|sklep)$/i.test(trimmed)) {
    return true
  }
  return false
}

function resolveBylineBrandConflict(params: {
  fromText: string | null
  fromHref: string | null
}): string | null {
  const { fromText, fromHref } = params
  if (!fromText && !fromHref) return null
  if (!fromText) return fromHref
  if (!fromHref) return fromText

  const textKey = normalizeBrandCompareKey(fromText)
  const hrefKey = normalizeBrandCompareKey(fromHref)

  if (!textKey) return fromHref
  if (!hrefKey) return fromText

  if (looksLikeBylineBoilerplate(fromText)) return fromHref

  if (textKey === hrefKey) return fromText

  // If href is a storefront slug extension of visible brand text
  // (e.g. "HoneywellAirComfort" vs "Honeywell"), prefer visible text.
  if (hrefKey.startsWith(textKey)) return fromText
  if (textKey.startsWith(hrefKey)) return fromHref

  // In ambiguous conflicts, prefer what users actually see on page.
  return fromText
}

function stripBylineBoilerplate(text: string): string {
  let brand = text.trim()
  if (!brand) return ''

  // Common patterns across Amazon locales (keep this tolerant to partial markup).
  brand = brand
    // English
    .replace(/^Visit(?:\s+the)?\b\s*/i, '')
    // German
    .replace(/^Besuchen(?:\s+Sie)?(?:\s+(den|die|das))?\b\s*/i, '')
    .replace(/^Besuche(?:\s+(den|die|das))?\b\s*/i, '')
    // French
    .replace(/^Visitez(?:\s+(la|le|les))?\b\s*/i, '')
    .replace(/^Visiter(?:\s+(la|le|les))?\b\s*/i, '')
    .replace(/^Consulter(?:\s+(la|le|les))?\b\s*/i, '')
    .replace(/^Consultez(?:\s+(la|le|les))?\b\s*/i, '')
    // Italian
    .replace(/^Visita(?:\s+(lo|il|la|le|i|gli))?\b\s*/i, '')
    // Spanish
    .replace(/^Visita(?:\s+(la|el))?\b\s*/i, '')
    // Dutch
    .replace(/^Bezoek(?:\s+de)?\b\s*/i, '')
    // Polish
    .replace(/^Odwiedź\b\s*/i, '')
    // Generic "Brand:" label
    .replace(/^(Brand|Marke|Marca|Marque|Merk|Marka)\s*[:：]\s*/i, '')
    .trim()

  if (!brand) return ''

  // Drop leading articles / prepositions that may remain after partial stripping.
  brand = brand.replace(/^(the|a|an|den|die|das|der|la|le|les|lo|il|el|de|di|da|du|von|van)\b\s*/i, '').trim()

  // Strip store suffixes (e.g. "Comfyer-Store", "Comfyer Store").
  brand = brand
    .replace(/^(Store|Shop|Boutique|Magasin|Tienda|Negozio|Loja|Winkel|Sklep)\s+(de\s+|du\s+|da\s+|di\s+)?/i, '')
    .replace(/-(Store|Shop|Boutique|Magasin|Tienda|Negozio|Loja|Winkel|Sklep)\b$/i, '')
    .replace(/\s+(Store|Shop|Boutique|Magasin|Tienda|Negozio|Loja|Winkel|Sklep)\b$/i, '')
    .trim()

  // Avoid generic storefront words being treated as brand names.
  if (/^(Store|Shop|Boutique|Magasin|Tienda|Negozio|Loja|Winkel|Sklep)$/i.test(brand)) {
    return ''
  }

  return brand
}

/**
 * Extract a brand name from Amazon byline ("Visit the Brand Store", "Besuchen Sie den Brand-Store", etc.)
 * while guarding against locale boilerplate leaking as a brand (e.g. "Besuchen").
 */
export function extractAmazonBrandFromByline(params: {
  bylineText?: string | null
  bylineHref?: string | null
}): string | null {
  const bylineText = typeof params.bylineText === 'string' ? params.bylineText : ''
  const cleaned = stripBylineBoilerplate(bylineText)
  const fromText = (() => {
    if (!cleaned) return null
    const normalized = normalizeBrandNameLight(cleaned)
    return isLikelyInvalidBrandName(normalized) ? null : normalized
  })()

  const bylineHref = typeof params.bylineHref === 'string' ? params.bylineHref.trim() : ''
  const fromHref = bylineHref ? extractBrandFromAmazonStoreHref(bylineHref) : null

  return resolveBylineBrandConflict({ fromText, fromHref })
}
