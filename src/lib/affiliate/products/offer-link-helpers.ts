import type { DatabaseAdapter } from '@/lib/db'
import type { AffiliateProduct } from './types'
import {
  normalizeAsin,
  normalizeUrl,
  parseAllowedCountries,
  resolvePartnerboostCountryCode,
  roundTo2,
} from './parsing'
import { DEFAULT_PB_COUNTRY_CODE } from './constants'
import {
  fetchPartnerboostShortPromoLinkByAsin,
  fetchPartnerboostShortPromoLinksByAsins,
} from './platform-fetch'

export function chooseOfferUrl(product: AffiliateProduct): string | null {
  const candidateUrls = [
    normalizeUrl(product.product_url),
    normalizeUrl(product.short_promo_link),
    normalizeUrl(product.promo_link),
    product.asin ? `https://www.amazon.com/dp/${product.asin}` : null,
  ]

  for (const url of candidateUrls) {
    if (!url) continue
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return url
      }
    } catch {
      continue
    }
  }

  return null
}

export async function resolveOfferAffiliateLinkForProduct(params: {
  db: DatabaseAdapter
  userId: number
  product: AffiliateProduct
  targetCountry: string
}): Promise<string | null> {
  const existingShort = normalizeUrl(params.product.short_promo_link)
  if (existingShort) return existingShort

  const existingPromo = normalizeUrl(params.product.promo_link)
  if (params.product.platform !== 'partnerboost') {
    return existingPromo
  }

  const asin = normalizeAsin(params.product.asin)
  if (!asin) {
    return existingPromo
  }

  try {
    const fetchedShort = await fetchPartnerboostShortPromoLinkByAsin({
      userId: params.userId,
      asin,
      targetCountry: params.targetCountry,
    })
    if (!fetchedShort) {
      return existingPromo
    }

    await params.db.exec(
      `
        UPDATE affiliate_products
        SET short_promo_link = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `,
      [fetchedShort, new Date().toISOString(), params.product.id, params.userId]
    )

    return fetchedShort
  } catch (error: any) {
    console.warn(
      `[affiliate-products] fallback to promo_link when fetching short link failed (productId=${params.product.id}, asin=${asin}): ${error?.message || error}`
    )
    return existingPromo
  }
}

export async function hydratePartnerboostShortLinksForRows(params: {
  db: DatabaseAdapter
  userId: number
  rows: Array<AffiliateProduct>
}): Promise<void> {
  const candidates = params.rows.filter((row) => {
    if (row.platform !== 'partnerboost') return false
    if (normalizeUrl(row.short_promo_link)) return false
    return Boolean(normalizeAsin(row.asin))
  })
  if (candidates.length === 0) return

  const countryAsinsMap = new Map<string, Set<string>>()
  for (const row of candidates) {
    const asin = normalizeAsin(row.asin)
    if (!asin) continue
    const preferredCountry =
      parseAllowedCountries(row.allowed_countries_json)[0] || DEFAULT_PB_COUNTRY_CODE
    const country = resolvePartnerboostCountryCode(preferredCountry, DEFAULT_PB_COUNTRY_CODE)
    if (!countryAsinsMap.has(country)) {
      countryAsinsMap.set(country, new Set<string>())
    }
    countryAsinsMap.get(country)!.add(asin)
  }

  const shortByAsin = new Map<string, string>()
  for (const [country, asinSet] of countryAsinsMap.entries()) {
    const fetched = await fetchPartnerboostShortPromoLinksByAsins({
      userId: params.userId,
      asins: Array.from(asinSet),
      targetCountry: country,
    })

    for (const [asin, shortLink] of fetched.entries()) {
      if (!shortByAsin.has(asin)) {
        shortByAsin.set(asin, shortLink)
      }
    }
  }
  if (shortByAsin.size === 0) return

  const updates: Array<{ id: number; shortLink: string }> = []
  for (const row of candidates) {
    const asin = normalizeAsin(row.asin)
    if (!asin) continue
    const shortLink = shortByAsin.get(asin)
    if (!shortLink) continue
    row.short_promo_link = shortLink
    updates.push({
      id: Number(row.id),
      shortLink,
    })
  }
  if (updates.length === 0) return

  const nowIso = new Date().toISOString()
  for (const update of updates) {
    if (!Number.isFinite(update.id) || update.id <= 0) continue
    await params.db.exec(
      `
        UPDATE affiliate_products
        SET short_promo_link = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `,
      [update.shortLink, nowIso, update.id, params.userId]
    )
  }
}

export function formatPriceForOffer(product: AffiliateProduct): string | undefined {
  if (product.price_amount === null || product.price_amount === undefined) return undefined
  if (product.price_currency) {
    return `${String(product.price_currency).toUpperCase()} ${product.price_amount}`
  }
  return `${product.price_amount}`
}

export function formatCommissionForOffer(product: AffiliateProduct): string | undefined {
  if (product.commission_rate === null || product.commission_rate === undefined) return undefined
  return `${roundTo2(product.commission_rate)}%`
}
