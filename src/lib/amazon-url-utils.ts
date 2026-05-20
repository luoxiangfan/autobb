const AMAZON_NON_STORE_SINGLE_SEGMENTS = new Set([
  's',
  'gp',
  'ap',
  'hz',
  'b',
  'deals',
  'best-sellers',
  'bestsellers',
  'new-releases',
  'gift-cards',
  'registries',
  'wishlist',
  'cart',
  'buy',
  'events',
  'stores',
  'store',
  'storefront',
  'brands',
  'music',
  'video',
  'photos',
  'live',
])

function normalizePathname(pathname: string): string {
  const normalized = pathname.toLowerCase().replace(/\/+$/, '')
  return normalized || '/'
}

function getPathSegments(pathname: string): string[] {
  return normalizePathname(pathname).split('/').filter(Boolean)
}

export function isAmazonHostname(hostname: string): boolean {
  return hostname.toLowerCase().includes('amazon.')
}

export function isAmazonVanityStorePath(pathname: string): boolean {
  const normalized = normalizePathname(pathname)
  if (normalized === '/') return false

  const segments = getPathSegments(normalized)
  if (segments.length !== 1) return false

  const [segment] = segments
  if (!segment || AMAZON_NON_STORE_SINGLE_SEGMENTS.has(segment)) return false
  if (segment.includes('.')) return false
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(segment)) return false
  if (/^[a-z0-9]{10}$/.test(segment)) return false

  return true
}

export function isAmazonStorePath(pathname: string): boolean {
  const normalized = normalizePathname(pathname)
  return normalized.includes('/stores/')
    || normalized.includes('/store/')
    || normalized.includes('/storefront/')
    || isAmazonVanityStorePath(normalized)
}

export function isAmazonProductPath(pathname: string): boolean {
  const normalized = normalizePathname(pathname)
  return normalized.includes('/dp/') || normalized.includes('/gp/product/')
}

export function detectAmazonPageTypeFromUrl(url: string): 'store' | 'product' | 'unknown' {
  try {
    const parsedUrl = new URL(url)
    if (!isAmazonHostname(parsedUrl.hostname)) return 'unknown'
    if (isAmazonStorePath(parsedUrl.pathname)) return 'store'
    if (isAmazonProductPath(parsedUrl.pathname)) return 'product'
    return 'product'
  } catch {
    return 'unknown'
  }
}

export function extractAmazonStoreSlugFromUrl(url: string): string | null {
  try {
    const parsedUrl = new URL(url)
    if (!isAmazonHostname(parsedUrl.hostname)) return null

    const segments = getPathSegments(parsedUrl.pathname)
    if (segments.length === 1 && isAmazonVanityStorePath(parsedUrl.pathname)) {
      return decodeURIComponent(segments[0])
    }

    const [prefix, slug] = segments
    if (!prefix || !slug) return null
    if (!['stores', 'store', 'storefront'].includes(prefix)) return null
    if (slug === 'page') return null

    return decodeURIComponent(slug)
  } catch {
    return null
  }
}
