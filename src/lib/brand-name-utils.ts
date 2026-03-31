/**
 * Brand name resolution helpers.
 *
 * Goal: avoid persisting UI/locale boilerplate words (e.g. "Besuchen") as brand names,
 * and provide a deterministic fallback using product titles when needed.
 */

const INVALID_SINGLE_TOKEN_BRANDS = new Set([
  // German
  'besuchen',
  // English
  'visit',
  // French
  'visitez',
  'visiter',
  'consulter',
  'consultez',
  // Italian / Spanish
  'visita',
  // Dutch
  'bezoek',
  // Polish
  'odwiedź',
  // Generic labels that occasionally leak from selectors
  'brand',
  'marke',
  'marca',
  'marque',
  'merk',
  'marka',
  'store',
  'shop',
  'boutique',
  'magasin',
])

const GENERIC_TITLE_FIRST_WORDS = new Set([
  'the', 'a', 'an',
  'new', 'best',
  // Often an adjective on landing pages, not a brand.
  'smart',
  // DE
  'der', 'die', 'das',
])

export function isLikelyInvalidBrandName(candidate: string | null | undefined): boolean {
  if (!candidate) return true
  const trimmed = candidate.trim()
  if (!trimmed) return true

  const lower = trimmed.toLowerCase()
  if (INVALID_SINGLE_TOKEN_BRANDS.has(lower)) return true

  // Block/anti-bot pages often leak as "brand" from <title>.
  // Treat these as invalid brands so we can fallback to domain-based brand or user input.
  if (/access\s+denied/i.test(trimmed)) return true
  if (/forbidden/i.test(trimmed)) return true
  if (/not\s+found/i.test(trimmed)) return true
  if (/service\s+unavailable/i.test(trimmed)) return true
  if (/attention\s+required/i.test(trimmed)) return true // Cloudflare
  if (/just\s+a\s+moment/i.test(trimmed)) return true // Cloudflare challenge
  if (/verify\s+you\s+are\s+human/i.test(trimmed)) return true
  if (/enable\s+cookies/i.test(trimmed)) return true
  if (/\bcaptcha\b/i.test(trimmed)) return true

  // Locale boilerplate fragments that can appear alone when markup is partially missing.
  if (/^besuchen(\s+sie)?(\s+(den|die|das))?$/i.test(trimmed)) return true
  if (/^visit(\s+the)?$/i.test(trimmed)) return true
  if (/^visitez(\s+(la|le|les))?$/i.test(trimmed)) return true
  if (/^visita(\s+(la|el|lo|il))?$/i.test(trimmed)) return true
  if (/^visiter(\s+(la|le|les))?$/i.test(trimmed)) return true
  if (/^consulter(\s+(la|le|les))?$/i.test(trimmed)) return true
  if (/^consultez(\s+(la|le|les))?$/i.test(trimmed)) return true
  if (/^(consulter|consultez|visiter|visitez)\s+(la|le|les)\s+(boutique|magasin|store|shop)$/i.test(trimmed)) return true

  return false
}

export function deriveBrandFromProductTitle(productTitle: string | null | undefined): string | null {
  if (!productTitle) return null
  const title = productTitle.trim()
  if (!title) return null

  // Prefer leading all-caps token (very common on Amazon product titles).
  const upperCaseMatch = title.match(/^([A-Z][A-Z0-9&-]{2,})(?:\s|$)/)
  if (upperCaseMatch?.[1]) {
    const token = upperCaseMatch[1].trim()
    if (!GENERIC_TITLE_FIRST_WORDS.has(token.toLowerCase())) return token
  }

  // Fallback: leading TitleCase token.
  const firstWordMatch = title.match(/^([A-Z][a-z][a-z0-9&-]{1,})(?:\s|$)/)
  if (firstWordMatch?.[1]) {
    const token = firstWordMatch[1].trim()
    if (!GENERIC_TITLE_FIRST_WORDS.has(token.toLowerCase())) return token
  }

  return null
}
