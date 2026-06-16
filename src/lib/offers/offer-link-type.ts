import { detectPageType } from '@/lib/offers/offer-utils'

export type OfferLinkType = 'product' | 'store'

function normalizeOfferLinkType(value: unknown): OfferLinkType | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (normalized === 'product' || normalized === 'store') return normalized
  return null
}

function parseOfferScrapedData(raw: unknown): any {
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
  const hasStoreName =
    typeof (scrapedData as any).storeName === 'string' &&
    (scrapedData as any).storeName.trim().length > 0
  const hasDeep = Boolean((scrapedData as any).deepScrapeResults)

  if (hasStoreName || hasDeep || productsLen >= 2) return 'store'
  return null
}

/** 从推广链接 / final URL 推断 page_type（广告系列同步、批量导入等无 scraped_data 场景） */
export function inferPageTypeFromUrls(params: {
  url?: string | null
  finalUrl?: string | null
}): OfferLinkType {
  for (const candidate of [params.finalUrl, params.url]) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue
    const detected = detectPageType(candidate.trim())
    if (detected.isAmazonStore || detected.isIndependentStore) return 'store'
    if (detected.isAmazonProductPage) return 'product'
  }

  const link = (params.finalUrl || params.url || '').trim().toLowerCase()
  if (!link) return 'product'
  if (link.includes('/stores/') || link.includes('/store/')) return 'store'
  return 'product'
}

export function resolveOfferLinkType(
  input: {
    page_type?: unknown
    scraped_data?: unknown
  },
  options?: {
    allowProductOverrideByDerivedStore?: boolean
  }
): OfferLinkType {
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
