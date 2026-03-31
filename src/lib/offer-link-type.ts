export type OfferLinkType = 'product' | 'store'

function normalizeOfferLinkType(value: unknown): OfferLinkType | null {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'product' || normalized === 'store') return normalized
  return null
}

export function parseOfferScrapedData(raw: unknown): any {
  if (!raw) return null
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
  return typeof raw === 'object' ? raw : null
}

export function deriveOfferLinkTypeFromScrapedData(scrapedData: any): OfferLinkType | null {
  if (!scrapedData || typeof scrapedData !== 'object') return null

  const explicit = normalizeOfferLinkType((scrapedData as any).pageType)
  if (explicit) return explicit

  const productsLen = Array.isArray((scrapedData as any).products)
    ? (scrapedData as any).products.length
    : 0
  const hasStoreName = typeof (scrapedData as any).storeName === 'string'
    && (scrapedData as any).storeName.trim().length > 0
  const hasDeep = Boolean((scrapedData as any).deepScrapeResults)

  if (hasStoreName || hasDeep || productsLen >= 2) return 'store'
  return null
}

export function resolveOfferLinkType(input: {
  page_type?: unknown
  scraped_data?: unknown
}, options?: {
  allowProductOverrideByDerivedStore?: boolean
}): OfferLinkType {
  const explicit = normalizeOfferLinkType(input.page_type)
  const scrapedData = parseOfferScrapedData(input.scraped_data)
  const derived = deriveOfferLinkTypeFromScrapedData(scrapedData)

  if (explicit === 'store') return 'store'
  if (explicit === 'product') {
    if (options?.allowProductOverrideByDerivedStore) {
      return derived === 'store' ? 'store' : 'product'
    }
    return 'product'
  }

  return derived || 'product'
}

