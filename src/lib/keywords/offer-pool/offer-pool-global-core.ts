/**
 * 全局核心关键词补充逻辑
 */

import { logger } from '@/lib/common/server'
import { getDatabase } from '../../db'

import { type Offer } from '../../offers/server'

import { getKeywordSearchVolumesForPlannerContext } from '@/lib/google-ads/accounts/auth/index'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'

import { containsPureBrand, getPureBrandKeywords } from '../server'
import { filterKeywordQuality, calculateSearchVolumeThreshold } from '../server'
import { getMinContextTokenMatchesForKeywordQualityFilter } from '../server'
import { isInvalidKeyword } from '../planner/keyword-invalid-filter'
import {
  getBrandCoreKeywords,
  refreshBrandCoreKeywordCache,
  updateBrandCoreKeywordSearchVolumes,
} from '../server'
import { filterCreativeKeywordsByOfferContextDetailed } from '../server'

import { getLanguageName, normalizeCountryCode, normalizeLanguageCode } from '../../common/server'

import { type PoolKeywordData, type StoreKeywordBuckets } from './types'

import {
  calculateBalanceScore,
  recalculateStoreBucketStatistics,
  resolveOfferPageType,
} from './keyword-clustering'

import { extractCategorySignalsFromScrapedData } from './offer-pool-scraped-signals'

// 全局核心关键词补充逻辑

const GLOBAL_CORE_PROMO_PRICE_PATTERNS =
  /\b(discount|sale|deal|coupon|promo|code|offer|clearance|price|cost|cheap|affordable|budget)\b/i
const GLOBAL_CORE_MODEL_PATTERNS = /\b(s\d+|q\d+|s7|s8|q5|q7|max|ultra|pro(?!\s*store))\b/i
const GLOBAL_CORE_REVIEW_PATTERNS = /\b(review|rating|testimonial|feedback|comment|opinion)\b/i
const GLOBAL_CORE_TRUST_PATTERNS =
  /\b(review|reviews|rating|ratings|testimonial|testimonials|feedback|support|customer\s*service|warranty|guarantee|refund|return|secure|security|privacy|trusted|trust)\b/i
const GLOBAL_CORE_GEO_PATTERNS =
  /\b(locations?|near\s+me|delivery|shipping|local|store\s+finder)\b/i
const GLOBAL_CORE_TRANSACTIONAL_PATTERNS =
  /\b(buy|best|price|sale|deal|discount|coupon|promo|offer|shop|official|professional)\b/i
const GLOBAL_CORE_SEARCH_VOLUME_TTL_DAYS = 30
const GLOBAL_CORE_BRAND_PREFIX_MIN_VOLUME = 100

const GLOBAL_CORE_NON_ANCHOR_TOKENS = new Set([
  'best',
  'buy',
  'sale',
  'deal',
  'discount',
  'coupon',
  'promo',
  'offer',
  'price',
  'cost',
  'cheap',
  'affordable',
  'official',
  'shop',
  'store',
  'online',
  'home',
  'kitchen',
  'professional',
  'high',
  'speed',
  'small',
  'mini',
  'portable',
  'personal',
  'top',
  'new',
  'quality',
  'premium',
  'amazon',
  'for',
  'with',
  'and',
  'the',
  'a',
  'an',
])

function normalizeGlobalCoreToken(token: string): string {
  const raw = String(token || '')
    .toLowerCase()
    .trim()
  if (!raw) return ''
  if (raw.endsWith('ies') && raw.length > 4) return `${raw.slice(0, -3)}y`
  if (raw.endsWith('es') && raw.length > 4) return raw.slice(0, -2)
  if (raw.endsWith('s') && raw.length > 3 && !raw.endsWith('ss')) return raw.slice(0, -1)
  return raw
}

function tokenizeGlobalCore(text: string): string[] {
  const normalized = normalizeGoogleAdsKeyword(text)
  if (!normalized) return []
  return normalized.split(/\s+/).map(normalizeGlobalCoreToken).filter(Boolean)
}

function buildGlobalCoreAnchorTokens(offer: Offer): Set<string> {
  const brandTokens = new Set(
    getPureBrandKeywords(offer.brand || '').flatMap((item) => tokenizeGlobalCore(item))
  )
  const categorySignals = extractCategorySignalsFromScrapedData(offer.scraped_data)
  const sourceTexts = [
    String(offer.category || ''),
    String(offer.product_name || ''),
    ...categorySignals,
  ]
  const tokens = new Set<string>()
  for (const text of sourceTexts) {
    for (const token of tokenizeGlobalCore(text)) {
      if (token.length < 3) continue
      if (brandTokens.has(token)) continue
      if (GLOBAL_CORE_NON_ANCHOR_TOKENS.has(token)) continue
      tokens.add(token)
    }
  }
  return tokens
}

function keywordHitsGlobalCoreAnchors(keyword: string, anchorTokens: Set<string>): boolean {
  if (anchorTokens.size === 0) return true
  const tokens = tokenizeGlobalCore(keyword)
  return tokens.some((token) => anchorTokens.has(token))
}

function isHighIntentGlobalCoreKeyword(keyword: string): boolean {
  if (!keyword) return false
  if (
    GLOBAL_CORE_TRANSACTIONAL_PATTERNS.test(keyword) ||
    GLOBAL_CORE_PROMO_PRICE_PATTERNS.test(keyword) ||
    GLOBAL_CORE_MODEL_PATTERNS.test(keyword) ||
    GLOBAL_CORE_TRUST_PATTERNS.test(keyword) ||
    GLOBAL_CORE_REVIEW_PATTERNS.test(keyword)
  ) {
    return true
  }
  // 对于词组型关键词（>=2词）视为可投放意图，后续仍会受“高搜索量+品类锚点”双门禁约束。
  return tokenizeGlobalCore(keyword).length >= 2
}

export function composeGlobalCoreBrandedKeyword(
  keyword: string,
  brandName: string,
  maxWords: number = 5
): string | null {
  const normalizedBrand = normalizeGoogleAdsKeyword(brandName)
  const normalizedKeyword = normalizeGoogleAdsKeyword(keyword)
  if (!normalizedBrand || !normalizedKeyword) return null

  const brandTokens = normalizedBrand.split(/\s+/).filter(Boolean)
  const keywordTokens = normalizedKeyword.split(/\s+/).filter(Boolean)
  if (brandTokens.length === 0 || keywordTokens.length === 0) return null

  const remainder: string[] = []
  for (let i = 0; i < keywordTokens.length; ) {
    let matchesBrand = true
    for (let j = 0; j < brandTokens.length; j += 1) {
      if (keywordTokens[i + j] !== brandTokens[j]) {
        matchesBrand = false
        break
      }
    }

    if (matchesBrand) {
      i += brandTokens.length
      continue
    }

    remainder.push(keywordTokens[i])
    i += 1
  }

  const combined = [...brandTokens, ...remainder]
  if (combined.length < 2 || combined.length > maxWords) return null
  return combined.join(' ')
}

function adaptGlobalCoreKeywordsWithBrandPrefix(params: {
  offer: Offer
  keywords: PoolKeywordData[]
  enforceBrandContainment: boolean
}): {
  keywords: PoolKeywordData[]
  stats: {
    nonBrandInput: number
    brandedFromNonBrand: number
    droppedLowVolume: number
    droppedLowIntent: number
    droppedNoAnchor: number
    droppedComposeFailed: number
    droppedDuplicate: number
    highVolumeThreshold: number
  }
} {
  const { offer, keywords, enforceBrandContainment } = params
  const pureBrandKeywords = getPureBrandKeywords(offer.brand || '')
  const anchorTokens = buildGlobalCoreAnchorTokens(offer)
  const canonicalBrand = normalizeGoogleAdsKeyword(offer.brand || '')

  const nonBrandCandidates = keywords.filter(
    (item) => !containsPureBrand(item.keyword, pureBrandKeywords)
  )
  const positiveVolumes = nonBrandCandidates
    .map((item) => Number(item.searchVolume || 0))
    .filter((volume) => volume > 0)
  const dynamicThreshold =
    positiveVolumes.length > 0
      ? Math.max(
          GLOBAL_CORE_BRAND_PREFIX_MIN_VOLUME,
          calculateSearchVolumeThreshold(positiveVolumes, GLOBAL_CORE_BRAND_PREFIX_MIN_VOLUME)
        )
      : Number.POSITIVE_INFINITY

  const seenNorm = new Set<string>()
  const adapted: PoolKeywordData[] = []
  let brandedFromNonBrand = 0
  let droppedLowVolume = 0
  let droppedLowIntent = 0
  let droppedNoAnchor = 0
  let droppedComposeFailed = 0
  let droppedDuplicate = 0

  for (const item of keywords) {
    const originalNorm = normalizeGoogleAdsKeyword(item.keyword)
    if (!originalNorm) continue
    const hasBrand = containsPureBrand(item.keyword, pureBrandKeywords)

    const pushIfUnique = (next: PoolKeywordData): boolean => {
      const norm = normalizeGoogleAdsKeyword(next.keyword)
      if (!norm) return false
      if (seenNorm.has(norm)) return false
      seenNorm.add(norm)
      adapted.push(next)
      return true
    }

    // 品牌词直接保留（仍受后续严格过滤）
    if (hasBrand) {
      if (!pushIfUnique(item)) droppedDuplicate += 1
      continue
    }

    if (!enforceBrandContainment || !canonicalBrand || pureBrandKeywords.length === 0) {
      if (!pushIfUnique(item)) droppedDuplicate += 1
      continue
    }

    const volume = Number(item.searchVolume || 0)
    if (!(volume >= dynamicThreshold)) {
      droppedLowVolume += 1
      continue
    }

    if (!isHighIntentGlobalCoreKeyword(item.keyword)) {
      droppedLowIntent += 1
      continue
    }

    if (!keywordHitsGlobalCoreAnchors(item.keyword, anchorTokens)) {
      droppedNoAnchor += 1
      continue
    }

    const branded = composeGlobalCoreBrandedKeyword(item.keyword, canonicalBrand, 5)
    if (!branded) {
      droppedComposeFailed += 1
      continue
    }

    // � 品牌前置后的关键词不应继承原始搜索量
    const next: PoolKeywordData = {
      ...item,
      keyword: branded,
      source: 'GLOBAL_CORE_BRANDED',
      matchType: 'PHRASE',
      searchVolume: 0, // 品牌前置后的关键词需要重新查询真实搜索量
    }

    if (pushIfUnique(next)) {
      brandedFromNonBrand += 1
    } else {
      droppedDuplicate += 1
    }
  }

  return {
    keywords: adapted,
    stats: {
      nonBrandInput: nonBrandCandidates.length,
      brandedFromNonBrand,
      droppedLowVolume,
      droppedLowIntent,
      droppedNoAnchor,
      droppedComposeFailed,
      droppedDuplicate,
      highVolumeThreshold: Number.isFinite(dynamicThreshold) ? dynamicThreshold : -1,
    },
  }
}

export function buildExistingKeywordNormSet(lists: PoolKeywordData[][]): Set<string> {
  const set = new Set<string>()
  for (const list of lists) {
    for (const kw of list) {
      const norm = normalizeGoogleAdsKeyword(kw.keyword)
      if (norm) set.add(norm)
    }
  }
  return set
}

export function resolveBrandCoreKeywordSourceMeta(
  sourceMask: string | null | undefined
): Pick<PoolKeywordData, 'source' | 'sourceType' | 'sourceSubtype' | 'rawSource' | 'derivedTags'> {
  const normalizedTokens = new Set(
    String(sourceMask || '')
      .split('|')
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean)
  )

  const hasSearchTerm = normalizedTokens.has('search_term')
  const hasKeywordPerf = normalizedTokens.has('keyword_perf')

  if (hasSearchTerm) {
    return {
      source: 'SEARCH_TERM',
      sourceType: 'SEARCH_TERM',
      sourceSubtype: 'SEARCH_TERM',
      rawSource: 'SEARCH_TERM',
      derivedTags: hasKeywordPerf
        ? ['BRAND_CORE', 'KEYWORD_PERF', 'GLOBAL_CORE']
        : ['BRAND_CORE', 'GLOBAL_CORE'],
    }
  }

  return {
    source: 'GLOBAL_CORE',
    sourceType: 'GLOBAL_CORE',
    sourceSubtype: 'GLOBAL_CORE',
    rawSource: 'GLOBAL_KEYWORDS',
    derivedTags: hasKeywordPerf ? ['BRAND_CORE', 'KEYWORD_PERF'] : ['BRAND_CORE'],
  }
}

export function selectBucketForProduct(keyword: string): 'A' | 'B' | 'C' | 'D' {
  if (GLOBAL_CORE_PROMO_PRICE_PATTERNS.test(keyword)) return 'D'
  if (GLOBAL_CORE_MODEL_PATTERNS.test(keyword)) return 'A'
  return 'B'
}

export function selectBucketForStore(keyword: string): 'A' | 'B' | 'C' | 'D' | 'S' {
  if (GLOBAL_CORE_PROMO_PRICE_PATTERNS.test(keyword) || GLOBAL_CORE_GEO_PATTERNS.test(keyword))
    return 'S'
  if (GLOBAL_CORE_TRUST_PATTERNS.test(keyword) || GLOBAL_CORE_REVIEW_PATTERNS.test(keyword))
    return 'D'
  return 'B'
}

function pushUniqueKeyword(list: string[], keyword: string): void {
  const norm = normalizeGoogleAdsKeyword(keyword)
  if (!norm) return
  const exists = list.some((item) => normalizeGoogleAdsKeyword(item) === norm)
  if (!exists) list.push(keyword)
}

export function buildGlobalCoreQualityFilterContext(offer: Offer): {
  categoryContext?: string
  minContextTokenMatches: number
} {
  const pageType = resolveOfferPageType(offer)
  const categorySignals = extractCategorySignalsFromScrapedData(offer.scraped_data)
  const categoryContext = [offer.category, ...categorySignals]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')

  return {
    categoryContext: categoryContext || undefined,
    minContextTokenMatches: getMinContextTokenMatchesForKeywordQualityFilter({
      pageType,
    }),
  }
}

export function filterGlobalCoreKeywordsByOfferContext(params: {
  offer: Offer
  keywords: PoolKeywordData[]
  scope: 'product' | 'store'
}): PoolKeywordData[] {
  const { offer, keywords, scope } = params
  if (keywords.length === 0) return keywords

  const { categoryContext, minContextTokenMatches } = buildGlobalCoreQualityFilterContext(offer)
  const enforceBrandContainment = String(offer.brand || '').trim().length > 0
  // GLOBAL_CORE 是跨Offer聚合词源，必须启用品类相关性门禁，避免跨品类词污染创意关键词。
  const effectiveMinContextTokenMatches = Math.max(1, minContextTokenMatches)

  // 第1层：先做相关性预过滤（允许非品牌候选进入后续“品牌前置改写”）
  const preFiltered = filterKeywordQuality(keywords, {
    brandName: offer.brand,
    category: categoryContext,
    productName: offer.product_name || undefined,
    targetCountry: offer.target_country || undefined,
    targetLanguage: offer.target_language || undefined,
    productUrl: offer.final_url || offer.url || undefined,
    minWordCount: 1,
    maxWordCount: 8,
    mustContainBrand: false,
    minContextTokenMatches: effectiveMinContextTokenMatches,
  })

  // 第2层：把“高意图+高搜索量”的非品牌词改写为品牌前置词（参考 title/about 补词机制）
  const adapted = adaptGlobalCoreKeywordsWithBrandPrefix({
    offer,
    keywords: preFiltered.filtered,
    enforceBrandContainment,
  })

  // 第3层：严格收口（最终进入创意的 GLOBAL_CORE 词必须含品牌词）
  const strictFiltered = filterKeywordQuality(adapted.keywords, {
    brandName: offer.brand,
    category: categoryContext,
    productName: offer.product_name || undefined,
    targetCountry: offer.target_country || undefined,
    targetLanguage: offer.target_language || undefined,
    productUrl: offer.final_url || offer.url || undefined,
    minWordCount: 1,
    maxWordCount: 8,
    mustContainBrand: enforceBrandContainment,
    minContextTokenMatches: effectiveMinContextTokenMatches,
  })
  let finalFiltered = strictFiltered.filtered
  let intentTighteningRemoved = 0

  // 对 product scope 的 GLOBAL_CORE 词再走一层 product_intent 收紧，尽量在词池阶段就拦截跨品类品牌词。
  if (scope === 'product' && finalFiltered.length > 0) {
    const intentTightened = filterCreativeKeywordsByOfferContextDetailed({
      offer: {
        brand: offer.brand,
        category: offer.category,
        product_name: offer.product_name,
        offer_name: offer.offer_name,
        target_country: offer.target_country,
        target_language: offer.target_language,
        final_url: offer.final_url,
        url: offer.url,
        page_type: offer.page_type,
        scraped_data: offer.scraped_data,
      },
      keywordsWithVolume: finalFiltered,
      scopeLabel: `GLOBAL_CORE:${scope}:strict_intent`,
      creativeType: 'product_intent',
    })
    intentTighteningRemoved = Math.max(0, finalFiltered.length - intentTightened.keywords.length)
    finalFiltered = intentTightened.keywords
  }

  if (
    preFiltered.removed.length > 0 ||
    strictFiltered.removed.length > 0 ||
    adapted.stats.brandedFromNonBrand > 0 ||
    intentTighteningRemoved > 0
  ) {
    const contextRemoved = strictFiltered.removed.filter((item) =>
      item.reason.includes('与商品无关')
    ).length
    const brandRemoved = strictFiltered.removed.filter((item) =>
      item.reason.includes('不含纯品牌词')
    ).length
    const preContextRemoved = preFiltered.removed.filter((item) =>
      item.reason.includes('与商品无关')
    ).length
    logger.debug(
      `🧹 GLOBAL_CORE(${scope}) 过滤链路: ${keywords.length} → 预过滤${preFiltered.filtered.length} → 改写${adapted.keywords.length} → 收口${strictFiltered.filtered.length} → 意图收紧${finalFiltered.length} ` +
        `(预过滤移除 ${preFiltered.removed.length}/上下文${preContextRemoved}; 改写 ${adapted.stats.brandedFromNonBrand} 条, 高量阈值 ${adapted.stats.highVolumeThreshold === -1 ? 'N/A' : adapted.stats.highVolumeThreshold}; ` +
        `收口移除 ${strictFiltered.removed.length}/无品牌${brandRemoved}/上下文${contextRemoved}; 意图收紧移除 ${intentTighteningRemoved})`
    )
  }

  return finalFiltered
}

export async function injectGlobalCoreKeywordsForProduct(params: {
  offer: Offer
  userId: number
  brandKeywords: PoolKeywordData[]
  bucketAData: PoolKeywordData[]
  bucketBData: PoolKeywordData[]
  bucketCData: PoolKeywordData[]
  bucketDData: PoolKeywordData[]
  statistics: { totalKeywords: number; balanceScore: number }
}): Promise<{
  bucketAData: PoolKeywordData[]
  bucketBData: PoolKeywordData[]
  bucketCData: PoolKeywordData[]
  bucketDData: PoolKeywordData[]
  statistics: { totalKeywords: number; balanceScore: number }
}> {
  const {
    offer,
    userId,
    brandKeywords,
    bucketAData,
    bucketBData,
    bucketCData,
    bucketDData,
    statistics,
  } = params

  const coreKeywords = await getBrandCoreKeywords(
    offer.brand,
    offer.target_country,
    offer.target_language || 'en'
  )
  if (coreKeywords.length === 0) {
    return {
      bucketAData,
      bucketBData,
      bucketCData,
      bucketDData,
      statistics,
    }
  }

  const existingSet = buildExistingKeywordNormSet([
    brandKeywords,
    bucketAData,
    bucketBData,
    bucketCData,
    bucketDData,
  ])

  const addedKeywords: PoolKeywordData[] = []
  const coreCandidates: PoolKeywordData[] = []
  const candidateNormSet = new Set<string>()

  for (const core of coreKeywords) {
    const keywordText = core.keywordDisplay?.trim() || core.keywordNorm
    if (!keywordText) continue
    const keywordNorm = normalizeGoogleAdsKeyword(keywordText)
    if (!keywordNorm || isInvalidKeyword(keywordNorm)) continue
    if (candidateNormSet.has(keywordNorm)) continue
    candidateNormSet.add(keywordNorm)

    const sourceMeta = resolveBrandCoreKeywordSourceMeta(core.sourceMask)
    coreCandidates.push({
      keyword: keywordText,
      searchVolume: Number(core.searchVolume || 0),
      source: sourceMeta.source,
      sourceType: sourceMeta.sourceType,
      sourceSubtype: sourceMeta.sourceSubtype,
      rawSource: sourceMeta.rawSource,
      derivedTags: sourceMeta.derivedTags,
      matchType: 'PHRASE',
    })
  }

  const filteredCoreCandidates = filterGlobalCoreKeywordsByOfferContext({
    offer,
    keywords: coreCandidates,
    scope: 'product',
  })

  for (const newKeyword of filteredCoreCandidates) {
    const keywordNorm = normalizeGoogleAdsKeyword(newKeyword.keyword)
    if (!keywordNorm) continue
    if (existingSet.has(keywordNorm)) continue

    const bucket = selectBucketForProduct(newKeyword.keyword)
    if (bucket === 'A') bucketAData.push(newKeyword)
    else if (bucket === 'D') bucketDData.push(newKeyword)
    else if (bucket === 'C') bucketCData.push(newKeyword)
    else bucketBData.push(newKeyword)

    existingSet.add(keywordNorm)
    addedKeywords.push(newKeyword)
  }

  await hydrateGlobalCoreKeywordSearchVolumes(addedKeywords, offer, userId)

  const counts = [bucketAData.length, bucketBData.length, bucketCData.length, bucketDData.length]
  return {
    bucketAData,
    bucketBData,
    bucketCData,
    bucketDData,
    statistics: {
      totalKeywords: counts.reduce((a, b) => a + b, 0),
      balanceScore: calculateBalanceScore(counts),
    },
  }
}

export async function injectGlobalCoreKeywordsForStore(params: {
  offer: Offer
  userId: number
  brandKeywords: PoolKeywordData[]
  storeBuckets: StoreKeywordBuckets
  bucketAData: PoolKeywordData[]
  bucketBData: PoolKeywordData[]
  bucketCData: PoolKeywordData[]
  bucketDData: PoolKeywordData[]
  bucketSData: PoolKeywordData[]
}): Promise<{
  bucketAData: PoolKeywordData[]
  bucketBData: PoolKeywordData[]
  bucketCData: PoolKeywordData[]
  bucketDData: PoolKeywordData[]
  bucketSData: PoolKeywordData[]
}> {
  const {
    offer,
    userId,
    brandKeywords,
    storeBuckets,
    bucketAData,
    bucketBData,
    bucketCData,
    bucketDData,
    bucketSData,
  } = params

  const coreKeywords = await getBrandCoreKeywords(
    offer.brand,
    offer.target_country,
    offer.target_language || 'en'
  )
  if (coreKeywords.length === 0) {
    return {
      bucketAData,
      bucketBData,
      bucketCData,
      bucketDData,
      bucketSData,
    }
  }

  const existingSet = buildExistingKeywordNormSet([
    brandKeywords,
    bucketAData,
    bucketBData,
    bucketCData,
    bucketDData,
    bucketSData,
  ])

  const addedKeywords: PoolKeywordData[] = []
  const coreCandidates: PoolKeywordData[] = []
  const candidateNormSet = new Set<string>()

  for (const core of coreKeywords) {
    const keywordText = core.keywordDisplay?.trim() || core.keywordNorm
    if (!keywordText) continue
    const keywordNorm = normalizeGoogleAdsKeyword(keywordText)
    if (!keywordNorm || isInvalidKeyword(keywordNorm)) continue
    if (candidateNormSet.has(keywordNorm)) continue
    candidateNormSet.add(keywordNorm)

    const sourceMeta = resolveBrandCoreKeywordSourceMeta(core.sourceMask)
    coreCandidates.push({
      keyword: keywordText,
      searchVolume: Number(core.searchVolume || 0),
      source: sourceMeta.source,
      sourceType: sourceMeta.sourceType,
      sourceSubtype: sourceMeta.sourceSubtype,
      rawSource: sourceMeta.rawSource,
      derivedTags: sourceMeta.derivedTags,
      matchType: 'PHRASE',
    })
  }

  const filteredCoreCandidates = filterGlobalCoreKeywordsByOfferContext({
    offer,
    keywords: coreCandidates,
    scope: 'store',
  })

  for (const newKeyword of filteredCoreCandidates) {
    const keywordNorm = normalizeGoogleAdsKeyword(newKeyword.keyword)
    if (!keywordNorm) continue
    if (existingSet.has(keywordNorm)) continue

    const bucket = selectBucketForStore(newKeyword.keyword)
    if (bucket === 'S') {
      bucketSData.push(newKeyword)
      pushUniqueKeyword(storeBuckets.bucketS.keywords, newKeyword.keyword)
    } else if (bucket === 'D') {
      bucketDData.push(newKeyword)
      pushUniqueKeyword(storeBuckets.bucketD.keywords, newKeyword.keyword)
    } else if (bucket === 'C') {
      bucketCData.push(newKeyword)
      pushUniqueKeyword(storeBuckets.bucketC.keywords, newKeyword.keyword)
    } else if (bucket === 'A') {
      bucketAData.push(newKeyword)
      pushUniqueKeyword(storeBuckets.bucketA.keywords, newKeyword.keyword)
    } else {
      bucketBData.push(newKeyword)
      pushUniqueKeyword(storeBuckets.bucketB.keywords, newKeyword.keyword)
    }

    existingSet.add(keywordNorm)
    addedKeywords.push(newKeyword)
  }

  await hydrateGlobalCoreKeywordSearchVolumes(addedKeywords, offer, userId)
  recalculateStoreBucketStatistics(storeBuckets)

  return {
    bucketAData,
    bucketBData,
    bucketCData,
    bucketDData,
    bucketSData,
  }
}

async function hydrateGlobalCoreKeywordSearchVolumes(
  keywords: PoolKeywordData[],
  offer: Offer,
  userId: number
): Promise<void> {
  if (keywords.length === 0) return

  try {
    const country = normalizeCountryCode(offer.target_country || 'US')
    const languageCode = normalizeLanguageCode(offer.target_language || 'en')
    const languageName = getLanguageName(languageCode)
    const languageCandidates = Array.from(
      new Set(
        [languageCode, languageName, offer.target_language]
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      )
    )

    const keywordMap = new Map<string, PoolKeywordData>()
    for (const kw of keywords) {
      const norm = normalizeGoogleAdsKeyword(kw.keyword)
      if (!norm) continue
      if (!keywordMap.has(norm)) keywordMap.set(norm, kw)
    }

    const normalizedKeywords = Array.from(keywordMap.keys())
    if (normalizedKeywords.length === 0) return

    const db = await getDatabase()
    const placeholders = normalizedKeywords.map(() => '?').join(',')
    const languagePlaceholders = languageCandidates.map(() => '?').join(',')
    const rows = (await db.query(
      `
      SELECT keyword, search_volume, competition_level, avg_cpc_micros, cached_at
      FROM global_keywords
      WHERE keyword IN (${placeholders})
        AND country = ?
        AND language IN (${languagePlaceholders})
    `,
      [...normalizedKeywords, country, ...languageCandidates]
    )) as Array<{
      keyword: string
      search_volume: number | null
      competition_level: string | null
      avg_cpc_micros: number | null
      cached_at: string | Date | null
    }>

    const cutoffMs = Date.now() - GLOBAL_CORE_SEARCH_VOLUME_TTL_DAYS * 24 * 60 * 60 * 1000
    const staleNorms = new Set<string>()
    const volumeUpdates = new Map<string, number>()

    const seenNorms = new Set<string>()
    for (const row of rows) {
      const norm = normalizeGoogleAdsKeyword(row.keyword)
      if (!norm) continue
      seenNorms.add(norm)
      const kw = keywordMap.get(norm)
      if (!kw) continue

      const cachedAtValue = row.cached_at
      const cachedAtMs =
        cachedAtValue instanceof Date
          ? cachedAtValue.getTime()
          : Date.parse(String(cachedAtValue || ''))
      const isFresh = Number.isFinite(cachedAtMs) && cachedAtMs >= cutoffMs

      if (isFresh) {
        kw.searchVolume = Number(row.search_volume || 0)
        if (row.competition_level) kw.competition = row.competition_level
        const avgCpc = Number(row.avg_cpc_micros || 0) / 1_000_000
        if (avgCpc > 0) {
          kw.lowTopPageBid = avgCpc
          kw.highTopPageBid = avgCpc
        }
        volumeUpdates.set(norm, kw.searchVolume || 0)
      } else {
        staleNorms.add(norm)
      }
    }

    for (const norm of normalizedKeywords) {
      if (!seenNorms.has(norm)) staleNorms.add(norm)
    }

    if (staleNorms.size > 0) {
      const refreshKeywords = Array.from(staleNorms)
        .map((norm) => keywordMap.get(norm)?.keyword)
        .filter((kw): kw is string => Boolean(kw))

      const volumeResult = await getKeywordSearchVolumesForPlannerContext({
        userId,
        offerId: offer.id,
        keywords: refreshKeywords,
        country,
        language: languageCode,
      })

      if (!volumeResult.ok && refreshKeywords.length > 0) {
        console.warn(
          `[offer-keyword-pool] ${volumeResult.message}，跳过 ${refreshKeywords.length} 个过期关键词的搜索量刷新 (userId=${userId})`
        )
      }

      if (volumeResult.ok && refreshKeywords.length > 0) {
        const volumes = volumeResult.volumes

        for (const vol of volumes) {
          const norm = normalizeGoogleAdsKeyword(vol.keyword)
          if (!norm) continue
          const kw = keywordMap.get(norm)
          if (!kw) continue

          kw.searchVolume = vol.avgMonthlySearches || 0
          kw.competition = vol.competition || kw.competition
          kw.competitionIndex = vol.competitionIndex || kw.competitionIndex
          kw.lowTopPageBid = vol.lowTopPageBid || kw.lowTopPageBid
          kw.highTopPageBid = vol.highTopPageBid || kw.highTopPageBid
          volumeUpdates.set(norm, kw.searchVolume || 0)
        }
      }
    }

    if (volumeUpdates.size > 0) {
      const updates = Array.from(volumeUpdates.entries()).map(([keywordNorm, searchVolume]) => ({
        keywordNorm,
        searchVolume,
      }))
      await updateBrandCoreKeywordSearchVolumes(offer.brand, country, languageCode, updates)
      await refreshBrandCoreKeywordCache(offer.brand, country, languageCode)
    }
  } catch (error: any) {
    console.warn(`⚠️ 全局核心关键词搜索量补齐失败: ${error?.message || String(error)}`)
  }
}
