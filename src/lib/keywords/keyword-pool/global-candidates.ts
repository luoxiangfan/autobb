import { logger } from '@/lib/common/server'
import type { PoolKeywordData } from '@/lib/keywords/offer-pool'
import { getDatabase } from '@/lib/db'
import { getLanguageName, normalizeCountryCode, normalizeLanguageCode } from '@/lib/common/server'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import {
  getPureBrandKeywords,
  containsPureBrand,
  isPureBrandKeyword,
} from '@/lib/keywords/brand/brand-keyword-utils'
import {
  getTemplateGarbageReason,
  isBrandConcatenation,
} from '@/lib/keywords/keyword-quality-filter'
import { DEFAULTS } from '@/lib/keywords/keyword-constants'
import { isLanguageScriptMismatch } from './shared/language-gates'
import { buildBrandLikePattern } from './shared/brand-utils'

async function getGlobalKeywordCandidates(params: {
  brandName: string
  targetCountry: string
  targetLanguage: string
  category?: string
  limit?: number
}): Promise<PoolKeywordData[]> {
  const { brandName, targetCountry, targetLanguage, limit = DEFAULTS.maxKeywords } = params
  const pureBrandKeywords = getPureBrandKeywords(brandName)
  if (!targetCountry || pureBrandKeywords.length === 0) return []

  const languageCode = normalizeLanguageCode(targetLanguage || 'en')
  const languageName = getLanguageName(languageCode)
  const languageCandidates = Array.from(
    new Set(
      [languageCode, languageName, targetLanguage]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  )
  const normalizedCountry = normalizeCountryCode(targetCountry)
  const countryCandidates = Array.from(
    new Set(
      [normalizedCountry, targetCountry, targetCountry?.toUpperCase?.()]
        .filter((value): value is string => Boolean(value && value.trim()))
        .map((value) => value.trim().toUpperCase())
    )
  )
  if (countryCandidates.length === 0) return []

  const patterns = pureBrandKeywords
    .map(buildBrandLikePattern)
    .filter((p): p is string => Boolean(p))

  if (patterns.length === 0) return []

  const db = await getDatabase()
  const countryPlaceholders = countryCandidates.map(() => '?').join(', ')
  const languagePlaceholders = languageCandidates.map(() => '?').join(', ')
  const clauses = patterns.map(() => 'LOWER(keyword) LIKE ?').join(' OR ')

  try {
    const rows = (await db.query(
      `SELECT keyword, search_volume, competition_level, avg_cpc_micros
       FROM global_keywords
       WHERE country IN (${countryPlaceholders}) AND language IN (${languagePlaceholders}) AND (${clauses})
       ORDER BY search_volume DESC
       LIMIT ?`,
      [...countryCandidates, ...languageCandidates, ...patterns, limit]
    )) as Array<{
      keyword: string
      search_volume: number | string | null
      competition_level?: string | null
      avg_cpc_micros?: number | string | null
    }>

    const candidates = new Map<string, PoolKeywordData>()
    let scriptFilteredCount = 0
    let templateFilteredCount = 0
    for (const row of rows) {
      const canonical = normalizeGoogleAdsKeyword(row.keyword)
      if (!canonical) continue

      if (isLanguageScriptMismatch(canonical, targetLanguage, pureBrandKeywords)) {
        scriptFilteredCount++
        continue
      }

      const templateGarbageReason = getTemplateGarbageReason(canonical)
      if (templateGarbageReason) {
        templateFilteredCount++
        continue
      }

      const searchVolume = Number(row.search_volume) || 0
      const isConcatenatedBrand = searchVolume > 0 && isBrandConcatenation(canonical, brandName)
      if (!containsPureBrand(canonical, pureBrandKeywords) && !isConcatenatedBrand) continue

      const avgCpcMicros = Number(row.avg_cpc_micros) || 0
      const isPureBrand = isPureBrandKeyword(canonical, pureBrandKeywords)
      const matchType = isPureBrand ? 'EXACT' : 'PHRASE'

      const existing = candidates.get(canonical)
      if (!existing || searchVolume > existing.searchVolume) {
        candidates.set(canonical, {
          keyword: canonical,
          searchVolume,
          competition: row.competition_level || 'UNKNOWN',
          competitionIndex: 0,
          lowTopPageBid: avgCpcMicros / 1_000_000,
          highTopPageBid: avgCpcMicros / 1_000_000,
          source: 'GLOBAL_KEYWORDS',
          matchType,
          isPureBrand,
        })
      }
    }

    if (candidates.size > 0) {
      logger.debug(`   📦 全局关键词库命中: ${candidates.size} 个`)
    }
    if (scriptFilteredCount > 0) {
      logger.debug(`   🌐 语言脚本过滤: 移除 ${scriptFilteredCount} 个与目标语言不匹配的全局关键词`)
    }
    if (templateFilteredCount > 0) {
      logger.debug(`   🧹 模板垃圾词过滤: 移除 ${templateFilteredCount} 个全局关键词候选`)
    }

    return Array.from(candidates.values())
  } catch (error: any) {
    console.warn(`   ⚠️ 全局关键词库查询失败: ${error.message}`)
    return []
  }
}

function mergeGlobalCandidates(params: {
  allKeywords: Map<string, PoolKeywordData>
  candidates: PoolKeywordData[]
  pureBrandKeywords: string[]
  brandName: string
}): { added: number; updated: number } {
  const { allKeywords, candidates, pureBrandKeywords, brandName } = params
  let added = 0
  let updated = 0

  for (const kw of candidates) {
    const canonical = normalizeGoogleAdsKeyword(kw.keyword)
    if (!canonical) continue
    const isConcatenatedBrand =
      (kw.searchVolume || 0) > 0 && isBrandConcatenation(canonical, brandName)
    if (!containsPureBrand(canonical, pureBrandKeywords) && !isConcatenatedBrand) continue

    const existing = allKeywords.get(canonical)
    const isPureBrand = isPureBrandKeyword(canonical, pureBrandKeywords)
    const matchType = isPureBrand ? 'EXACT' : 'PHRASE'
    const candidate = {
      ...kw,
      keyword: canonical,
      matchType: kw.matchType || matchType,
      isPureBrand: kw.isPureBrand ?? isPureBrand,
      source: kw.source || 'GLOBAL_KEYWORDS',
    }

    if (!existing) {
      allKeywords.set(canonical, candidate)
      added++
      continue
    }

    if ((existing.searchVolume || 0) === 0 && (candidate.searchVolume || 0) > 0) {
      allKeywords.set(canonical, {
        ...existing,
        ...candidate,
        source: existing.source || candidate.source,
      })
      updated++
    }
  }

  return { added, updated }
}

export { getGlobalKeywordCandidates, mergeGlobalCandidates }
