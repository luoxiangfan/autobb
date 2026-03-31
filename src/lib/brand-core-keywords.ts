import { getDatabase } from './db'
import { nowFunc } from './db-helpers'
import { REDIS_PREFIX_CONFIG } from './config'
import { getRedisClient } from './redis'
import { normalizeCountryCode, normalizeLanguageCode } from './language-country-codes'

export interface BrandCoreKeyword {
  keywordNorm: string
  keywordDisplay: string | null
  searchVolume: number
  sourceMask: string
  impressionsTotal: number
  clicksTotal: number
  lastSeenAt: string | null
}

const BRAND_CORE_CACHE_TTL_SECONDS = 12 * 60 * 60

export function normalizeBrandKey(brand: string): string {
  if (!brand || typeof brand !== 'string') return ''
  const trimmed = brand.trim().toLowerCase()
  if (!trimmed) return ''
  return trimmed
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

export function buildBrandCoreCacheKey(
  brandKey: string,
  country: string,
  language: string
): string {
  return `${REDIS_PREFIX_CONFIG.cache}brand:core:${brandKey}:${country}:${language}`
}

async function readBrandCoreCache(
  brandKey: string,
  country: string,
  language: string
): Promise<BrandCoreKeyword[] | null> {
  try {
    const client = getRedisClient()
    const key = buildBrandCoreCacheKey(brandKey, country, language)
    const cached = await client.get(key)
    if (!cached) return null
    return JSON.parse(cached) as BrandCoreKeyword[]
  } catch (error: any) {
    console.warn(`[BrandCore] Redis读取失败: ${error?.message || String(error)}`)
    return null
  }
}

async function writeBrandCoreCache(
  brandKey: string,
  country: string,
  language: string,
  keywords: BrandCoreKeyword[]
): Promise<void> {
  try {
    const client = getRedisClient()
    const key = buildBrandCoreCacheKey(brandKey, country, language)
    await client.setex(key, BRAND_CORE_CACHE_TTL_SECONDS, JSON.stringify(keywords))
  } catch (error: any) {
    console.warn(`[BrandCore] Redis写入失败: ${error?.message || String(error)}`)
  }
}

export async function getBrandCoreKeywordsByKey(
  brandKey: string,
  country: string,
  language: string
): Promise<BrandCoreKeyword[]> {
  const normalizedBrandKey = normalizeBrandKey(brandKey)
  if (!normalizedBrandKey) return []

  const normalizedCountry = normalizeCountryCode(country || 'US')
  const normalizedLanguage = normalizeLanguageCode(language || 'en')

  const cached = await readBrandCoreCache(normalizedBrandKey, normalizedCountry, normalizedLanguage)
  if (cached) return cached

  const db = await getDatabase()
  const rows = await db.query(
    `
    SELECT
      keyword_norm,
      keyword_display,
      search_volume,
      source_mask,
      impressions_total,
      clicks_total,
      last_seen_at
    FROM brand_core_keywords
    WHERE brand_key = ? AND target_country = ? AND target_language = ?
    ORDER BY clicks_total DESC, impressions_total DESC, keyword_norm ASC
  `,
    [normalizedBrandKey, normalizedCountry, normalizedLanguage]
  ) as Array<{
    keyword_norm: string
    keyword_display: string | null
    search_volume: number | null
    source_mask: string
    impressions_total: number
    clicks_total: number
    last_seen_at: string | null
  }>

  const keywords: BrandCoreKeyword[] = rows.map(row => ({
    keywordNorm: row.keyword_norm,
    keywordDisplay: row.keyword_display,
    searchVolume: Number(row.search_volume || 0),
    sourceMask: row.source_mask,
    impressionsTotal: Number(row.impressions_total || 0),
    clicksTotal: Number(row.clicks_total || 0),
    lastSeenAt: row.last_seen_at || null,
  }))

  await writeBrandCoreCache(normalizedBrandKey, normalizedCountry, normalizedLanguage, keywords)
  return keywords
}

export async function getBrandCoreKeywords(
  brand: string,
  country: string,
  language: string
): Promise<BrandCoreKeyword[]> {
  const brandKey = normalizeBrandKey(brand)
  return getBrandCoreKeywordsByKey(brandKey, country, language)
}

export async function refreshBrandCoreKeywordCache(
  brandKey: string,
  country: string,
  language: string
): Promise<BrandCoreKeyword[]> {
  const normalizedBrandKey = normalizeBrandKey(brandKey)
  if (!normalizedBrandKey) return []

  const normalizedCountry = normalizeCountryCode(country || 'US')
  const normalizedLanguage = normalizeLanguageCode(language || 'en')

  const db = await getDatabase()
  const rows = await db.query(
    `
    SELECT
      keyword_norm,
      keyword_display,
      search_volume,
      source_mask,
      impressions_total,
      clicks_total,
      last_seen_at
    FROM brand_core_keywords
    WHERE brand_key = ? AND target_country = ? AND target_language = ?
    ORDER BY clicks_total DESC, impressions_total DESC, keyword_norm ASC
  `,
    [normalizedBrandKey, normalizedCountry, normalizedLanguage]
  ) as Array<{
    keyword_norm: string
    keyword_display: string | null
    search_volume: number | null
    source_mask: string
    impressions_total: number
    clicks_total: number
    last_seen_at: string | null
  }>

  const keywords: BrandCoreKeyword[] = rows.map(row => ({
    keywordNorm: row.keyword_norm,
    keywordDisplay: row.keyword_display,
    searchVolume: Number(row.search_volume || 0),
    sourceMask: row.source_mask,
    impressionsTotal: Number(row.impressions_total || 0),
    clicksTotal: Number(row.clicks_total || 0),
    lastSeenAt: row.last_seen_at || null,
  }))

  await writeBrandCoreCache(normalizedBrandKey, normalizedCountry, normalizedLanguage, keywords)
  return keywords
}

export async function updateBrandCoreKeywordSearchVolumes(
  brandKey: string,
  country: string,
  language: string,
  updates: Array<{ keywordNorm: string; searchVolume: number }>
): Promise<void> {
  if (updates.length === 0) return

  const normalizedBrandKey = normalizeBrandKey(brandKey)
  if (!normalizedBrandKey) return

  const normalizedCountry = normalizeCountryCode(country || 'US')
  const normalizedLanguage = normalizeLanguageCode(language || 'en')

  const db = await getDatabase()
  const updatedAt = nowFunc(db.type)

  await db.transaction(async () => {
    for (const update of updates) {
      const keywordNorm = update.keywordNorm
      if (!keywordNorm) continue
      await db.exec(
        `
        UPDATE brand_core_keywords
        SET search_volume = ?, updated_at = ${updatedAt}
        WHERE brand_key = ? AND target_country = ? AND target_language = ? AND keyword_norm = ?
      `,
        [update.searchVolume, normalizedBrandKey, normalizedCountry, normalizedLanguage, keywordNorm]
      )
    }
  })
}

