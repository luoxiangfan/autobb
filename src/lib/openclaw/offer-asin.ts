/**
 * Extract Amazon ASIN from offer URL fields (shared by offers table + commission report).
 */
export function normalizeOfferAsin(value: unknown): string | null {
  const text = String(value || '').trim().toUpperCase()
  if (!text) return null
  const cleaned = text.replace(/[^A-Z0-9]/g, '')
  if (!cleaned) return null
  return cleaned.length > 10 ? cleaned.slice(0, 10) : cleaned
}

function decodeUrlCandidate(text: string): string[] {
  const candidates = [text.toUpperCase()]
  if (/%[0-9A-Fa-f]{2}/.test(text)) {
    try {
      candidates.push(decodeURIComponent(text).toUpperCase())
    } catch {
      // ignore malformed percent-encoding
    }
  }
  return candidates
}

const ASIN_PATTERN = /\b(B[A-Z0-9]{9})\b/g

export function extractAsinFromOfferUrls(url: unknown, finalUrl: unknown): string | null {
  // Prefer final_url: it is the resolved landing page after redirects.
  for (const value of [finalUrl, url]) {
    const text = String(value ?? '').trim()
    if (!text) continue

    for (const candidate of decodeUrlCandidate(text)) {
      const matches = candidate.matchAll(ASIN_PATTERN)
      for (const match of matches) {
        const asin = normalizeOfferAsin(match[1])
        if (asin) return asin
      }
    }
  }

  return null
}
