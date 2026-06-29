/**
 * Resolve store_product_links to final landing URLs for Sitelink ↔ affiliate pairing.
 */
import { getDatabase } from '@/lib/db'
import { initializeProxyPool } from '@/lib/offers/server'
import type { SupplementalProductResult } from '@/lib/offers/offer-supplemental-product-types'
import { resolveAffiliateLinkForUrlSwap } from './url-swap-resolve-config'
import {
  normalizeAffiliateLinkKey,
  type ResolvedStoreProductLink,
} from './sitelink-affiliate-matching'

function parseSupplementalProductsFromScrapedData(raw: unknown): SupplementalProductResult[] {
  if (!raw) return []
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!parsed || typeof parsed !== 'object') return []
  const supplemental = (parsed as { supplementalProducts?: unknown }).supplementalProducts
  if (!Array.isArray(supplemental)) return []
  return supplemental.filter(
    (item): item is SupplementalProductResult =>
      Boolean(item) &&
      typeof item === 'object' &&
      typeof (item as SupplementalProductResult).sourceAffiliateLink === 'string'
  )
}

function extractPartnerboostLinkFromRawJson(raw: unknown): string | null {
  if (!raw) return null
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!parsed || typeof parsed !== 'object') return null
  const link = (parsed as { partnerboost_link?: unknown }).partnerboost_link
  return typeof link === 'string' && link.trim() ? link.trim() : null
}

async function loadSupplementalFinalUrlMap(params: {
  offerId: number
  userId: number
}): Promise<Map<string, string>> {
  const db = await getDatabase()
  const row = await db.queryOne<{ scraped_data: unknown }>(
    `
    SELECT scraped_data
    FROM offers
    WHERE id = ? AND user_id = ?
      AND (is_deleted = false OR is_deleted IS NULL)
  `,
    [params.offerId, params.userId]
  )
  if (!row?.scraped_data) return new Map()

  const map = new Map<string, string>()
  for (const item of parseSupplementalProductsFromScrapedData(row.scraped_data)) {
    const affiliateKey = normalizeAffiliateLinkKey(item.sourceAffiliateLink)
    const finalUrl = item.finalUrl?.trim()
    if (!affiliateKey || !finalUrl || item.error) continue
    map.set(affiliateKey, finalUrl)
  }
  return map
}

async function loadAffiliateProductFinalUrlMap(params: {
  userId: number
  storeProductLinks: string[]
}): Promise<Map<string, string>> {
  const wanted = new Set(
    params.storeProductLinks.map((link) => normalizeAffiliateLinkKey(link)).filter(Boolean)
  )
  if (wanted.size === 0) return new Map()

  const db = await getDatabase()
  const rows = await db.query<{
    product_url: string | null
    short_promo_link: string | null
    promo_link: string | null
    asin: string | null
    raw_json: string | null
  }>(
    `
    SELECT product_url, short_promo_link, promo_link, asin, raw_json
    FROM affiliate_products
    WHERE user_id = ?
  `,
    [params.userId]
  )

  const map = new Map<string, string>()
  for (const row of rows) {
    const finalUrl =
      row.product_url?.trim() ||
      (row.asin?.trim() ? `https://www.amazon.com/dp/${row.asin.trim()}` : null)
    if (!finalUrl) continue

    const promoCandidates = [
      row.short_promo_link,
      row.promo_link,
      extractPartnerboostLinkFromRawJson(row.raw_json),
    ]
    for (const promoLink of promoCandidates) {
      const key = normalizeAffiliateLinkKey(promoLink || '')
      if (key && wanted.has(key)) {
        map.set(key, finalUrl)
      }
    }
  }

  return map
}

async function loadOpenclawAffiliateProductFinalUrlMap(params: {
  userId: number
  storeProductLinks: string[]
}): Promise<Map<string, string>> {
  const wanted = new Set(
    params.storeProductLinks.map((link) => normalizeAffiliateLinkKey(link)).filter(Boolean)
  )
  if (wanted.size === 0) return new Map()

  const db = await getDatabase()
  const rows = await db.query<{
    product_url: string | null
    tracking_url: string | null
    asin: string | null
  }>(
    `
    SELECT product_url, tracking_url, asin
    FROM openclaw_affiliate_products
    WHERE user_id = ?
  `,
    [params.userId]
  )

  const map = new Map<string, string>()
  for (const row of rows) {
    const finalUrl =
      row.product_url?.trim() ||
      (row.asin?.trim() ? `https://www.amazon.com/dp/${row.asin.trim()}` : null)
    if (!finalUrl) continue

    const key = normalizeAffiliateLinkKey(row.tracking_url || '')
    if (key && wanted.has(key)) {
      map.set(key, finalUrl)
    }
  }

  return map
}

async function ensureProxyPoolForStoreLinkResolution(
  userId: number,
  targetCountry: string
): Promise<boolean> {
  try {
    await initializeProxyPool(userId, targetCountry)
    return true
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[url-swap] 无法初始化代理池，跳过 store_product_links 实时解析: ${message}`)
    return false
  }
}

function needsLiveStoreLinkResolution(
  affiliateLink: string,
  maps: Array<Map<string, string>>
): boolean {
  const affiliateKey = normalizeAffiliateLinkKey(affiliateLink)
  if (!affiliateKey) return false
  return !maps.some((map) => map.has(affiliateKey))
}

export async function resolveStoreProductLinkFinalUrls(params: {
  storeProductLinks: string[]
  targetCountry: string
  userId: number
  offerId?: number
}): Promise<ResolvedStoreProductLink[]> {
  const supplementalMap =
    params.offerId !== undefined
      ? await loadSupplementalFinalUrlMap({ offerId: params.offerId, userId: params.userId })
      : new Map<string, string>()
  const affiliateProductMap = await loadAffiliateProductFinalUrlMap({
    userId: params.userId,
    storeProductLinks: params.storeProductLinks,
  })
  const openclawProductMap = await loadOpenclawAffiliateProductFinalUrlMap({
    userId: params.userId,
    storeProductLinks: params.storeProductLinks,
  })

  const staticMaps = [supplementalMap, affiliateProductMap, openclawProductMap]
  const needsLiveResolution = params.storeProductLinks.some((link) =>
    needsLiveStoreLinkResolution(link, staticMaps)
  )
  const proxyReady = needsLiveResolution
    ? await ensureProxyPoolForStoreLinkResolution(params.userId, params.targetCountry)
    : false

  const resolved: ResolvedStoreProductLink[] = []

  for (const affiliateLink of params.storeProductLinks) {
    const trimmed = affiliateLink.trim()
    if (!trimmed) {
      resolved.push({ affiliateLink: trimmed, finalUrl: null })
      continue
    }

    const affiliateKey = normalizeAffiliateLinkKey(trimmed)
    const cachedFinalUrl =
      supplementalMap.get(affiliateKey) ||
      affiliateProductMap.get(affiliateKey) ||
      openclawProductMap.get(affiliateKey)
    if (cachedFinalUrl) {
      resolved.push({ affiliateLink: trimmed, finalUrl: cachedFinalUrl })
      continue
    }

    if (!proxyReady) {
      resolved.push({ affiliateLink: trimmed, finalUrl: null })
      continue
    }

    try {
      const parsed = await resolveAffiliateLinkForUrlSwap({
        affiliateLink: trimmed,
        targetCountry: params.targetCountry,
        userId: params.userId,
      })
      resolved.push({
        affiliateLink: trimmed,
        finalUrl: parsed.finalUrl || null,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[url-swap] store_product_links 解析失败: link=${trimmed}, error=${message}`)
      resolved.push({ affiliateLink: trimmed, finalUrl: null })
    }
  }

  return resolved
}
