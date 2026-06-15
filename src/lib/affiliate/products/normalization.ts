import type {
  AffiliateCommissionRateMode,
  AffiliateLandingPageType,
  AffiliatePlatform,
  AffiliateProductLifecycleStatus,
  AffiliateProductStatusFilter,
} from './types'
import { normalizePlatformValue, normalizeUrl } from './parsing'

export function normalizeAffiliateProductStatusFilter(
  value: unknown
): AffiliateProductStatusFilter {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
  if (raw === 'active' || raw === 'invalid' || raw === 'sync_missing' || raw === 'unknown') {
    return raw
  }
  return 'all'
}

export function normalizeAffiliateLandingPageTypeFilter(
  value: unknown
): AffiliateLandingPageType | 'all' {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
  if (
    raw === 'amazon_product' ||
    raw === 'amazon_store' ||
    raw === 'independent_product' ||
    raw === 'independent_store' ||
    raw === 'unknown'
  ) {
    return raw
  }
  return 'all'
}

export function resolveAffiliateProductLifecycleStatus(
  value: unknown
): AffiliateProductLifecycleStatus {
  if (
    value === 'active' ||
    value === 'invalid' ||
    value === 'sync_missing' ||
    value === 'unknown'
  ) {
    return value
  }
  return 'unknown'
}

export function normalizeTriStateBool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value > 0

  const raw = String(value).trim().toLowerCase()
  if (!raw) return null
  if (raw === '1' || raw === 'true' || raw === 'yes') return true
  if (raw === '0' || raw === 'false' || raw === 'no') return false
  return null
}

export function normalizeCommissionRateMode(value: unknown): AffiliateCommissionRateMode | null {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
  if (!raw) return null
  if (raw === 'amount') return 'amount'
  if (raw === 'rate' || raw === 'percent' || raw === 'percentage') return 'percent'
  return null
}

const CONFIRMED_INVALID_STATUS_TOKENS = new Set<string>([
  'offline',
  'inactive',
  'disabled',
  'removed',
  'invalid',
  'out_of_stock',
  'sold_out',
  'unavailable',
])

const CONFIRMED_INVALID_STATUS_KEYWORDS = [
  'offline',
  'inactive',
  'disabled',
  'removed',
  'invalid',
  'out of stock',
  'out-of-stock',
  'sold out',
  'unavailable',
  '失效',
  '下架',
  '缺货',
  '无库存',
  '不可用',
]

export function normalizeStatusToken(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

export function resolveConfirmedInvalidFromSignals(input: {
  advertStatus?: unknown
  status?: unknown
  availability?: unknown
  stockStatus?: unknown
  joinStatus?: unknown
  isAvailable?: unknown
  inStock?: unknown
  isOos?: unknown
}): boolean {
  const advertStatus = String(input.advertStatus ?? '').trim()
  if (advertStatus === '0') return true

  const statusTokens = [
    normalizeStatusToken(input.status),
    normalizeStatusToken(input.availability),
    normalizeStatusToken(input.stockStatus),
  ].filter(Boolean)

  if (statusTokens.some((token) => CONFIRMED_INVALID_STATUS_TOKENS.has(token))) {
    return true
  }

  const joinStatusText = String(input.joinStatus || '')
    .trim()
    .toLowerCase()
  if (joinStatusText) {
    if (CONFIRMED_INVALID_STATUS_KEYWORDS.some((keyword) => joinStatusText.includes(keyword))) {
      return true
    }
  }

  const isAvailable = normalizeTriStateBool(input.isAvailable)
  if (isAvailable === false) return true

  const inStock = normalizeTriStateBool(input.inStock)
  if (inStock === false) return true

  const isOos = normalizeTriStateBool(input.isOos)
  if (isOos === true) return true

  return false
}

export function detectAffiliateLandingPageType(params: {
  asin?: string | null
  productUrl?: string | null
  promoLink?: string | null
  shortPromoLink?: string | null
}): AffiliateLandingPageType {
  if (params.asin && String(params.asin).trim()) {
    return 'amazon_product'
  }

  const candidateUrls = [params.productUrl, params.shortPromoLink, params.promoLink]

  let parsedUrl: URL | null = null
  for (const value of candidateUrls) {
    const normalized = normalizeUrl(value)
    if (!normalized) continue
    try {
      parsedUrl = new URL(normalized)
      break
    } catch {
      continue
    }
  }

  if (!parsedUrl) return 'unknown'

  const hostname = parsedUrl.hostname.toLowerCase()
  const pathname = parsedUrl.pathname.toLowerCase()
  const isAmazonDomain = hostname.includes('amazon.')

  if (isAmazonDomain) {
    if (
      pathname.includes('/stores/') ||
      pathname.includes('/store/') ||
      pathname.includes('/storefront/')
    ) {
      return 'amazon_store'
    }

    if (pathname.includes('/dp/') || pathname.includes('/gp/product/')) {
      return 'amazon_product'
    }
  }

  const isIndependentProduct =
    pathname.includes('/products/') ||
    pathname.includes('/product/') ||
    pathname.includes('/p/') ||
    pathname.includes('/item/')

  if (isIndependentProduct) {
    return 'independent_product'
  }

  const isIndependentStore =
    pathname === '/' ||
    pathname === '' ||
    pathname.includes('/collections') ||
    pathname.includes('/shop') ||
    pathname.includes('/store')

  if (isIndependentStore) {
    return 'independent_store'
  }

  return 'unknown'
}

export function normalizeAffiliatePlatform(value: unknown): AffiliatePlatform | null {
  return normalizePlatformValue(value)
}
