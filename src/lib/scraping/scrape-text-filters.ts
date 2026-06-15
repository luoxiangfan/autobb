/**
 * Shared text filters for scraped page content.
 *
 * Goal: prevent navigation/account boilerplate leaking into product/store fields
 * (e.g. "About Me", "Saved Addresses", "Order History", "Log Out").
 */

export function normalizeScrapedTextLine(input: string): string {
  return input
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const EXACT_NAV_LABELS = new Set<string>([
  'about me',
  'saved addresses',
  'order history',
  'log out',
  'logout',
  'sign in',
  'signin',
  'log in',
  'login',
  'my account',
  'account',
  'addresses',
  'orders',
  'wishlist',
  'help',
  'store locator',
  'stores',
  'close',
  'menu',
  'search',
  'cart',
  'checkout',
  'returns',
  'privacy policy',
  'terms of service',
  'back to top',
  // Generic global navigation labels frequently scraped as "features"
  'products',
  'all products',
  'shop all',
  'collections',
  'new arrivals',
  'new releases',
  'support',
  'customer support',
  'customer service',
  'contact us',
  'faq',
])

export function isLikelyNavigationLabel(input: unknown): boolean {
  if (typeof input !== 'string') return false
  const normalized = normalizeScrapedTextLine(input)
  if (!normalized) return false

  const lower = normalized.toLowerCase()
  if (EXACT_NAV_LABELS.has(lower)) return true

  // Pattern-based matches (keep conservative; only obvious nav/account items)
  if (/\b(log\s*out|sign\s*in|log\s*in|my\s*account|order\s*history)\b/i.test(lower)) return true
  if (/\b(saved\s*addresses|address\s*book)\b/i.test(lower)) return true
  if (/^sort\s+by\b/i.test(lower)) return true
  if (/^(all\s+)?products\b/i.test(lower)) return true
  if (/^(new\s+arrivals|new\s+releases)\b/i.test(lower)) return true
  if (/^(customer\s+)?support\b/i.test(lower)) return true

  return false
}

export function filterNavigationLabels(lines: unknown): string[] {
  if (!Array.isArray(lines)) return []
  return lines
    .filter((v): v is string => typeof v === 'string')
    .map(normalizeScrapedTextLine)
    .filter((v) => v.length > 0)
    .filter((v) => !isLikelyNavigationLabel(v))
}
