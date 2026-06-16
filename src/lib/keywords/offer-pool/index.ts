/**
 * Offer 级关键词池服务 v1.0
 *
 * 核心功能：
 * 1. 生成 Offer 级关键词池（一次生成多次复用）
 * 2. 纯品牌词共享 + 语义分桶独占
 * 3. AI 语义聚类（品牌商品锚点/商品需求场景/功能规格）
 * 4. 支持 3 个差异化创意生成（品牌意图 / 商品型号/产品族意图 / 商品需求意图）
 *
 * 关键词分层策略：
 * - 共享层：纯品牌词（仅品牌名本身，如 "eufy"）
 * - 独占层：语义分桶（内部 raw buckets，供 A/B/D 创意槽位重组）
 *
 * @see docs/Offer 级广告创意优化方案.md
 */

import { getDatabase } from '../../db'
import { generateContent } from '../../ai/server'
import { repairJsonText } from '../../ai/server'
import { loadPrompt, interpolateTemplate } from '../../ai/server'
import { findOfferById, type Offer } from '../../offers/server'
import { recordTokenUsage, estimateTokenCost } from '../../ai/server'
import {
  getKeywordSearchVolumesForPlannerContext,
  loadKeywordPoolExpandCredentialsForOffer,
  type KeywordPoolExpandLoadResult,
  type KeywordPoolPreparedExpand,
  type KeywordPlannerPreparedSession,
} from '@/lib/google-ads/accounts/auth/index'
import { extractVerifiedKeywordSourcePool } from '../server'
import { containsPureBrand, getPureBrandKeywords, isPureBrandKeyword } from '../server'
import {
  filterKeywordQuality,
  generateFilterReport,
  calculateSearchVolumeThreshold,
  detectPlatformsInKeyword,
  extractPlatformFromUrl,
} from '../server'
import { getMinContextTokenMatchesForKeywordQualityFilter } from '../server'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { isInvalidKeyword } from '../keyword-invalid-filter'
import {
  getBrandCoreKeywords,
  refreshBrandCoreKeywordCache,
  updateBrandCoreKeywordSearchVolumes,
} from '../server'
import { getLanguageName, normalizeCountryCode, normalizeLanguageCode } from '../../common/server'
import { DEFAULTS } from '../server'
import { parseJsonField, toDbJsonArrayField } from '../../db'
import { analyzeKeywordLanguageCompatibility } from '../server'
import {
  deriveCanonicalCreativeType,
  getCreativeTypeForBucketSlot,
  hasModelAnchorEvidence,
  mapCreativeTypeToBucketSlot,
  normalizeCanonicalCreativeType,
  normalizeKeywordPoolBucketQuery,
  type CanonicalCreativeType,
  type CreativeBucketSlot,
} from '../../creatives/server'
import {
  DEFAULT_COVERAGE_KEYWORD_CONFIG,
  DEFAULT_PRODUCT_CLUSTER_BUCKETS,
  DEFAULT_STORE_CLUSTER_BUCKETS,
  type BucketType,
  type CoverageKeywordConfig,
  type GetKeywordsOptions,
  type GetKeywordsResult,
  type KeywordBuckets,
  type KeywordPoolProgressReporter,
  type OfferKeywordPool,
  type PoolKeywordData,
  type StoreKeywordBuckets,
} from './types'
export type {
  BucketCreativeOptions,
  BucketType,
  ClusteringStrategy,
  CoverageKeywordConfig,
  GetKeywordsOptions,
  GetKeywordsResult,
  KeywordBuckets,
  OfferKeywordPool,
  PoolKeywordData,
  StoreKeywordBuckets,
  SyntheticKeywordConfig,
} from './types'
export {
  DEFAULT_COVERAGE_KEYWORD_CONFIG,
  DEFAULT_PRODUCT_CLUSTER_BUCKETS,
  DEFAULT_STORE_CLUSTER_BUCKETS,
} from './types'
export { clusterKeywordsByIntent } from './keyword-clustering'
export { determineClusteringStrategy } from './clustering-strategy'
import { filterCreativeKeywordsByOfferContextDetailed } from '../server'
import {
  createPlannerNonBrandPolicy,
  type PlannerDecision,
  type PlannerNonBrandPolicy,
} from '../server'
import {
  buildUntrustedInputGuardrail,
  sanitizePromptBlockValue,
  sanitizePromptInlineValue,
  type InputReview,
} from '../../ai/server'

import {
  calculateBalanceScore,
  clusterKeywordsByIntent,
  ensureMinimumBucketKeywords,
  extractFirstJsonObject,
  getKeywordSourcePriority,
  hasCommercialIntentForProductRelaxedRetention,
  hasSearchVolumeUnavailableFlag,
  KEYWORD_CLUSTERING_INPUT_LIMIT,
  MIN_NON_BRAND_KEYWORDS_PER_PRODUCT_BUCKET,
  MIN_NON_BRAND_KEYWORDS_PER_STORE_BUCKET,
  prioritizeBrandKeywordsFirst,
  prioritizeBucketKeywords,
  prioritizeKeywordsForClustering,
  recalculateStoreBucketStatistics,
  resolveOfferPageType,
  SEED_INFO_QUERY_PATTERNS,
  SEED_MAX_WORD_COUNT,
} from './keyword-clustering'
import {
  applyOfferContextToCanonicalKeywords,
  buildCanonicalBucketKeywords,
  getComprehensiveKeywordsForPool,
  getPoolPureBrandKeywords,
  isPureBrandPoolKeyword,
  mergeKeywordDataLists,
} from './canonical-bucket-view'

// ============================================
// 全局核心关键词补充逻辑
// ============================================

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

    // 🐛 修复(2026-03-14): 品牌前置后的关键词不应继承原始搜索量
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

function buildExistingKeywordNormSet(lists: PoolKeywordData[][]): Set<string> {
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

function selectBucketForProduct(keyword: string): 'A' | 'B' | 'C' | 'D' {
  if (GLOBAL_CORE_PROMO_PRICE_PATTERNS.test(keyword)) return 'D'
  if (GLOBAL_CORE_MODEL_PATTERNS.test(keyword)) return 'A'
  return 'B'
}

function selectBucketForStore(keyword: string): 'A' | 'B' | 'C' | 'D' | 'S' {
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

function buildGlobalCoreQualityFilterContext(offer: Offer): {
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

function filterGlobalCoreKeywordsByOfferContext(params: {
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
    console.log(
      `🧹 GLOBAL_CORE(${scope}) 过滤链路: ${keywords.length} → 预过滤${preFiltered.filtered.length} → 改写${adapted.keywords.length} → 收口${strictFiltered.filtered.length} → 意图收紧${finalFiltered.length} ` +
        `(预过滤移除 ${preFiltered.removed.length}/上下文${preContextRemoved}; 改写 ${adapted.stats.brandedFromNonBrand} 条, 高量阈值 ${adapted.stats.highVolumeThreshold === -1 ? 'N/A' : adapted.stats.highVolumeThreshold}; ` +
        `收口移除 ${strictFiltered.removed.length}/无品牌${brandRemoved}/上下文${contextRemoved}; 意图收紧移除 ${intentTighteningRemoved})`
    )
  }

  return finalFiltered
}

async function injectGlobalCoreKeywordsForProduct(params: {
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

async function injectGlobalCoreKeywordsForStore(params: {
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

// ============================================
// 纯品牌词识别
// ============================================

function inferDefaultKeywordMatchType(
  keyword: string,
  pureBrandKeywords: string[]
): 'EXACT' | 'PHRASE' {
  return isPureBrandKeyword(keyword, pureBrandKeywords) ? 'EXACT' : 'PHRASE'
}

/**
 * 分离纯品牌词和非品牌词
 *
 * @param keywords - 所有关键词列表
 * @param brandName - 品牌名称
 * @returns 分离结果：纯品牌词 + 非品牌词
 */
export function separateBrandKeywords(
  keywords: string[],
  brandName: string
): { brandKeywords: string[]; nonBrandKeywords: string[] } {
  const brandKeywords: string[] = []
  const nonBrandKeywords: string[] = []
  const pureBrandKeywords = getPureBrandKeywords(brandName)

  for (const keyword of keywords) {
    if (isPureBrandKeyword(keyword, pureBrandKeywords)) {
      brandKeywords.push(keyword)
    } else {
      nonBrandKeywords.push(keyword)
    }
  }

  console.log(
    `🏷️ 纯品牌词分离: ${brandKeywords.length} 个纯品牌词, ${nonBrandKeywords.length} 个非品牌词`
  )
  console.log(`   纯品牌词: ${brandKeywords.join(', ') || '(无)'}`)

  return { brandKeywords, nonBrandKeywords }
}

// 🔧 2026-03-26: 保持 AI 聚类优先；当上游不可用时允许确定性分桶降级，避免创意流程被硬阻断。

// ============================================
// 关键词池数据库操作
// ============================================

function serializeKeywordArrayForDb(data: unknown): unknown {
  return toDbJsonArrayField(data, [])
}

function parseKeywordArrayFromDb(data: unknown): unknown[] {
  return parseJsonField<unknown[]>(data, [])
}

const KEYWORD_CLUSTERING_PROMPT_ID = 'keyword_intent_clustering'
const KEYWORD_CLUSTERING_PROMPT_VERSION_FALLBACK = 'v4.19'

async function resolveActivePromptVersion(
  db: Awaited<ReturnType<typeof getDatabase>>,
  promptId: string,
  fallbackVersion: string
): Promise<string> {
  try {
    const isActiveCondition = 'is_active = TRUE'
    const activePrompt = await db.queryOne<{ version: string }>(
      `SELECT version
       FROM prompt_versions
       WHERE prompt_id = ? AND ${isActiveCondition}
       ORDER BY created_at DESC
       LIMIT 1`,
      [promptId]
    )

    return activePrompt?.version || fallbackVersion
  } catch (error: any) {
    console.warn(
      `[resolveActivePromptVersion] Failed to resolve active version for ${promptId}:`,
      error?.message || error
    )
    return fallbackVersion
  }
}

/**
 * 保存关键词池到数据库
 */
export async function saveKeywordPool(
  offerId: number,
  userId: number,
  brandKeywords: string[],
  buckets: KeywordBuckets,
  model?: string,
  promptVersion?: string
): Promise<OfferKeywordPool> {
  const db = await getDatabase()
  const resolvedPromptVersion =
    promptVersion ||
    (await resolveActivePromptVersion(
      db,
      KEYWORD_CLUSTERING_PROMPT_ID,
      KEYWORD_CLUSTERING_PROMPT_VERSION_FALLBACK
    ))

  const totalKeywords =
    brandKeywords.length +
    buckets.bucketA.keywords.length +
    buckets.bucketB.keywords.length +
    buckets.bucketC.keywords.length +
    buckets.bucketD.keywords.length

  // 检查是否已存在
  const existing = await db.queryOne<{ id: number }>(
    'SELECT id FROM offer_keyword_pools WHERE offer_id = ?',
    [offerId]
  )

  // 🔥 2025-12-16修复：使用统一的JSON序列化函数
  const brandKwJson = serializeKeywordArrayForDb(brandKeywords)
  const bucketAJson = serializeKeywordArrayForDb(buckets.bucketA.keywords)
  const bucketBJson = serializeKeywordArrayForDb(buckets.bucketB.keywords)
  const bucketCJson = serializeKeywordArrayForDb(buckets.bucketC.keywords)
  const bucketDJson = serializeKeywordArrayForDb(buckets.bucketD.keywords)
  console.log(`📊 保存关键词池:`)
  console.log(`   brand_keywords: ${brandKeywords.length}个 → ${typeof brandKwJson}`)
  console.log(`   bucket_a: ${buckets.bucketA.keywords.length}个`)
  console.log(`   bucket_b: ${buckets.bucketB.keywords.length}个`)
  console.log(`   bucket_c: ${buckets.bucketC.keywords.length}个`)
  console.log(`   bucket_d: ${buckets.bucketD.keywords.length}个`)

  if (existing) {
    // 更新现有记录
    await db.exec(
      `UPDATE offer_keyword_pools SET
        brand_keywords = ?,
        bucket_a_keywords = ?,
        bucket_b_keywords = ?,
        bucket_c_keywords = ?,
        bucket_d_keywords = ?,
        bucket_a_intent = ?,
        bucket_b_intent = ?,
        bucket_c_intent = ?,
        bucket_d_intent = ?,
        total_keywords = ?,
        clustering_model = ?,
        clustering_prompt_version = ?,
        balance_score = ?,
        updated_at = ${'NOW()'}
      WHERE offer_id = ?`,
      [
        brandKwJson,
        bucketAJson,
        bucketBJson,
        bucketCJson,
        bucketDJson,
        buckets.bucketA.intent,
        buckets.bucketB.intent,
        buckets.bucketC.intent,
        buckets.bucketD.intent,
        totalKeywords,
        model || null,
        resolvedPromptVersion,
        buckets.statistics.balanceScore,
        offerId,
      ]
    )

    console.log(`✅ 关键词池已更新: Offer #${offerId}`)
    return getKeywordPoolByOfferId(offerId) as Promise<OfferKeywordPool>
  }

  // 创建新记录
  const result = await db.exec(
    `INSERT INTO offer_keyword_pools (
      offer_id, user_id,
      brand_keywords,
      bucket_a_keywords, bucket_b_keywords, bucket_c_keywords, bucket_d_keywords,
      bucket_a_intent, bucket_b_intent, bucket_c_intent, bucket_d_intent,
      total_keywords, clustering_model, clustering_prompt_version, balance_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      offerId,
      userId,
      brandKwJson,
      bucketAJson,
      bucketBJson,
      bucketCJson,
      bucketDJson,
      buckets.bucketA.intent,
      buckets.bucketB.intent,
      buckets.bucketC.intent,
      buckets.bucketD.intent,
      totalKeywords,
      model || null,
      resolvedPromptVersion,
      buckets.statistics.balanceScore,
    ]
  )

  console.log(`✅ 关键词池已创建: Offer #${offerId}, ID #${result.lastInsertRowid}`)
  return getKeywordPoolByOfferId(offerId) as Promise<OfferKeywordPool>
}

/**
 * 🆕 保存关键词池（PoolKeywordData[] 版本）
 * 🔥 2025-12-22: 添加bucketD支持
 * 🆕 v4.16: 支持店铺链接的5桶存储
 */
async function saveKeywordPoolWithData(
  offerId: number,
  userId: number,
  brandKeywords: PoolKeywordData[],
  buckets: {
    bucketA: { intent: string; keywords: PoolKeywordData[] }
    bucketB: { intent: string; keywords: PoolKeywordData[] }
    bucketC: { intent: string; keywords: PoolKeywordData[] }
    bucketD: { intent: string; keywords: PoolKeywordData[] }
    statistics: { totalKeywords: number; balanceScore: number }
  },
  pageType: 'product' | 'store' = 'product',
  storeBuckets?: StoreKeywordBuckets, // 🆕 v4.16: 店铺桶数据（可选）
  storeBucketData?: {
    bucketA: PoolKeywordData[]
    bucketB: PoolKeywordData[]
    bucketC: PoolKeywordData[]
    bucketD: PoolKeywordData[]
    bucketS: PoolKeywordData[]
  }
): Promise<OfferKeywordPool> {
  const db = await getDatabase()
  const clusteringPromptVersion = await resolveActivePromptVersion(
    db,
    KEYWORD_CLUSTERING_PROMPT_ID,
    KEYWORD_CLUSTERING_PROMPT_VERSION_FALLBACK
  )

  const brandKwJson = serializeKeywordArrayForDb(brandKeywords)
  const bucketAJson = serializeKeywordArrayForDb(buckets.bucketA.keywords)
  const bucketBJson = serializeKeywordArrayForDb(buckets.bucketB.keywords)
  const bucketCJson = serializeKeywordArrayForDb(buckets.bucketC.keywords)
  const bucketDJson = serializeKeywordArrayForDb(buckets.bucketD.keywords)
  const emptyArrayJson = serializeKeywordArrayForDb([])
  // 🆕 v4.16: 店铺分桶JSON（优先保存带搜索量的数据）
  const storeBucketAJson = storeBucketData
    ? serializeKeywordArrayForDb(storeBucketData.bucketA)
    : storeBuckets
      ? serializeKeywordArrayForDb(storeBuckets.bucketA.keywords)
      : emptyArrayJson
  const storeBucketBJson = storeBucketData
    ? serializeKeywordArrayForDb(storeBucketData.bucketB)
    : storeBuckets
      ? serializeKeywordArrayForDb(storeBuckets.bucketB.keywords)
      : emptyArrayJson
  const storeBucketCJson = storeBucketData
    ? serializeKeywordArrayForDb(storeBucketData.bucketC)
    : storeBuckets
      ? serializeKeywordArrayForDb(storeBuckets.bucketC.keywords)
      : emptyArrayJson
  const storeBucketDJson = storeBucketData
    ? serializeKeywordArrayForDb(storeBucketData.bucketD)
    : storeBuckets
      ? serializeKeywordArrayForDb(storeBuckets.bucketD.keywords)
      : emptyArrayJson
  const storeBucketSJson = storeBucketData
    ? serializeKeywordArrayForDb(storeBucketData.bucketS)
    : storeBuckets
      ? serializeKeywordArrayForDb(storeBuckets.bucketS.keywords)
      : emptyArrayJson

  const totalKeywords =
    brandKeywords.length +
    buckets.bucketA.keywords.length +
    buckets.bucketB.keywords.length +
    buckets.bucketC.keywords.length +
    buckets.bucketD.keywords.length

  // 检查是否已存在
  const existing = await db.queryOne<{ id: number }>(
    'SELECT id FROM offer_keyword_pools WHERE offer_id = ?',
    [offerId]
  )

  // 🆕 v4.16: 店铺分桶意图
  const storeBucketAIntent = storeBuckets?.bucketA.intent || DEFAULT_STORE_CLUSTER_BUCKETS.A.intent
  const storeBucketBIntent = storeBuckets?.bucketB.intent || DEFAULT_STORE_CLUSTER_BUCKETS.B.intent
  const storeBucketCIntent = storeBuckets?.bucketC.intent || DEFAULT_STORE_CLUSTER_BUCKETS.C.intent
  const storeBucketDIntent = storeBuckets?.bucketD.intent || DEFAULT_STORE_CLUSTER_BUCKETS.D.intent
  const storeBucketSIntent = storeBuckets?.bucketS.intent || DEFAULT_STORE_CLUSTER_BUCKETS.S.intent

  if (existing) {
    // 🆕 v4.16: 更新现有记录（包含店铺分桶）
    const updateFields = [
      'brand_keywords = ?',
      'bucket_a_keywords = ?',
      'bucket_b_keywords = ?',
      'bucket_c_keywords = ?',
      'bucket_d_keywords = ?',
      'bucket_a_intent = ?',
      'bucket_b_intent = ?',
      'bucket_c_intent = ?',
      'bucket_d_intent = ?',
      'total_keywords = ?',
      'clustering_model = ?',
      'clustering_prompt_version = ?',
      'balance_score = ?',
      'link_type = ?',
      'store_bucket_a_keywords = ?',
      'store_bucket_b_keywords = ?',
      'store_bucket_c_keywords = ?',
      'store_bucket_d_keywords = ?',
      'store_bucket_s_keywords = ?',
      'store_bucket_a_intent = ?',
      'store_bucket_b_intent = ?',
      'store_bucket_c_intent = ?',
      'store_bucket_d_intent = ?',
      'store_bucket_s_intent = ?',
      `updated_at = ${'NOW()'}`,
    ]

    const updateValues = [
      brandKwJson,
      bucketAJson,
      bucketBJson,
      bucketCJson,
      bucketDJson,
      buckets.bucketA.intent,
      buckets.bucketB.intent,
      buckets.bucketC.intent,
      buckets.bucketD.intent,
      totalKeywords,
      'gemini', // model
      clusteringPromptVersion,
      buckets.statistics.balanceScore,
      pageType,
      storeBucketAJson,
      storeBucketBJson,
      storeBucketCJson,
      storeBucketDJson,
      storeBucketSJson,
      storeBucketAIntent,
      storeBucketBIntent,
      storeBucketCIntent,
      storeBucketDIntent,
      storeBucketSIntent,
      offerId,
    ]

    await db.exec(
      `UPDATE offer_keyword_pools SET ${updateFields.join(', ')} WHERE offer_id = ?`,
      updateValues
    )

    console.log(`✅ 关键词池已更新: Offer #${offerId} (${pageType}链接)`)
    return getKeywordPoolByOfferId(offerId) as Promise<OfferKeywordPool>
  }

  // 🆕 v4.16: 创建新记录（包含店铺分桶）
  const insertFields = [
    'offer_id',
    'user_id',
    'brand_keywords',
    'bucket_a_keywords',
    'bucket_b_keywords',
    'bucket_c_keywords',
    'bucket_d_keywords',
    'bucket_a_intent',
    'bucket_b_intent',
    'bucket_c_intent',
    'bucket_d_intent',
    'total_keywords',
    'clustering_model',
    'clustering_prompt_version',
    'balance_score',
    'link_type',
    'store_bucket_a_keywords',
    'store_bucket_b_keywords',
    'store_bucket_c_keywords',
    'store_bucket_d_keywords',
    'store_bucket_s_keywords',
    'store_bucket_a_intent',
    'store_bucket_b_intent',
    'store_bucket_c_intent',
    'store_bucket_d_intent',
    'store_bucket_s_intent',
  ]

  const insertValues = [
    offerId,
    userId,
    brandKwJson,
    bucketAJson,
    bucketBJson,
    bucketCJson,
    bucketDJson,
    buckets.bucketA.intent,
    buckets.bucketB.intent,
    buckets.bucketC.intent,
    buckets.bucketD.intent,
    totalKeywords,
    'gemini',
    clusteringPromptVersion,
    buckets.statistics.balanceScore,
    pageType,
    storeBucketAJson,
    storeBucketBJson,
    storeBucketCJson,
    storeBucketDJson,
    storeBucketSJson,
    storeBucketAIntent,
    storeBucketBIntent,
    storeBucketCIntent,
    storeBucketDIntent,
    storeBucketSIntent,
  ]

  const placeholders = insertFields.map(() => '?').join(', ')

  const result = await db.exec(
    `INSERT INTO offer_keyword_pools (${insertFields.join(', ')}) VALUES (${placeholders})`,
    insertValues
  )

  console.log(
    `✅ 关键词池已创建: Offer #${offerId}, ID #${result.lastInsertRowid} (${pageType}链接, 店铺5桶: ${storeBuckets ? '是' : '否'})`
  )
  return getKeywordPoolByOfferId(offerId) as Promise<OfferKeywordPool>
}

function extractCategorySignalsFromScrapedData(scrapedData: string | null | undefined): string[] {
  if (!scrapedData) return []

  try {
    const parsed = JSON.parse(scrapedData)
    if (!parsed || typeof parsed !== 'object') return []

    const candidates: string[] = []
    const push = (value: unknown) => {
      if (typeof value !== 'string') return
      const trimmed = value.trim()
      if (trimmed) candidates.push(trimmed)
    }

    push((parsed as any).productCategory)
    push((parsed as any).category)

    const primaryCategories = (parsed as any)?.productCategories?.primaryCategories
    if (Array.isArray(primaryCategories)) {
      for (const item of primaryCategories) {
        push(item?.name)
      }
    }

    const breadcrumbs = (parsed as any)?.breadcrumbs
    if (Array.isArray(breadcrumbs)) {
      for (const item of breadcrumbs) {
        push(item)
      }
    }

    if (candidates.length === 0) return []
    return Array.from(new Set(candidates))
  } catch {
    return []
  }
}

const STRUCTURED_MODEL_TOKEN_RE = /\b[A-Z]{1,4}[- ]?\d{2,6}[A-Z0-9-]{0,8}\b/g
const STRUCTURED_SPEC_TOKEN_RE =
  /\b\d{2,5}\s?(?:gpd|btu|mah|wh|w|kw|v|psi|db|hz|khz|mhz|ghz|mm|cm|inch|in|ft|l|ml|kg|lb|lbs)\b/gi
const STRUCTURED_CERT_TOKEN_RE =
  /\b(?:nsf\s*\/?\s*ansi\s*\d{1,3}|nsf\s*\d{1,3}|ansi\s*\d{1,3}|etl|ul|fcc|ce|rohs)\b/gi
const STRUCTURED_PRODUCT_CORE_STOPWORDS = new Set([
  'for',
  'with',
  'without',
  'and',
  'the',
  'new',
  'best',
  'official',
  'store',
  'system',
  'model',
  'series',
  'version',
  'kit',
  'set',
  'pack',
])
const TARGET_LANGUAGE_TRANSLATION_MAX_BATCH_SIZE = 24
const TARGET_LANGUAGE_TRANSLATION_NEUTRAL_TOKENS = new Set([
  'nsf',
  'ansi',
  'etl',
  'ul',
  'fcc',
  'ce',
  'rohs',
  'gpd',
  'btu',
  'mah',
  'wh',
  'w',
  'kw',
  'v',
  'psi',
  'db',
  'hz',
  'khz',
  'mhz',
  'ghz',
  'mm',
  'cm',
  'inch',
  'in',
  'ft',
  'l',
  'ml',
  'kg',
  'lb',
  'lbs',
])

function parseBooleanFeatureFlag(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return fallback
}

function splitIntoChunks<T>(items: T[], size: number): T[][] {
  const chunkSize = Math.max(1, Math.floor(size))
  const chunks: T[][] = []
  for (let start = 0; start < items.length; start += chunkSize) {
    chunks.push(items.slice(start, start + chunkSize))
  }
  return chunks
}

function buildTranslationPrompt(params: {
  promptTemplate: string
  targetLanguage: string
  keywords: string[]
}): string {
  const reviewedInputs: InputReview[] = []
  const numbered = params.keywords.map((keyword, index) => `${index}. ${keyword}`).join('\n')

  const variables = {
    targetLanguage: sanitizePromptInlineValue(
      reviewedInputs,
      'keyword_translation_target_language',
      params.targetLanguage,
      40,
      'English'
    ),
    keywordsBlock: sanitizePromptBlockValue(
      reviewedInputs,
      'keyword_translation_keywords',
      numbered,
      4000,
      '0. keyword'
    ),
  }

  return interpolateTemplate(params.promptTemplate, {
    inputGuardrail: buildUntrustedInputGuardrail(reviewedInputs),
    ...variables,
  })
}

function parseTranslationResponse(text: string): Array<{ index: number; keyword: string }> {
  const parseRawJson = (rawText: string): any => {
    return JSON.parse(rawText)
  }

  const parseCandidates = [text]
  const firstJson = extractFirstJsonObject(text)
  if (firstJson) parseCandidates.push(firstJson)

  let parsed: any = null
  for (const candidate of parseCandidates) {
    try {
      parsed = parseRawJson(candidate)
      break
    } catch {
      try {
        parsed = parseRawJson(repairJsonText(candidate))
        break
      } catch {
        // Ignore and continue trying the next candidate.
      }
    }
  }

  if (!parsed || typeof parsed !== 'object') return []
  const translations = Array.isArray((parsed as any).translations)
    ? (parsed as any).translations
    : []

  return translations
    .map((item: any) => ({
      index: Number(item?.index),
      keyword: String(item?.keyword || '').trim(),
    }))
    .filter(
      (item: { index: number; keyword: string }) =>
        Number.isInteger(item.index) && item.index >= 0 && item.keyword.length > 0
    )
}

function buildTranslationNeutralTokenSet(pureBrandKeywords: string[]): Set<string> {
  const out = new Set<string>(TARGET_LANGUAGE_TRANSLATION_NEUTRAL_TOKENS)
  for (const brandKeyword of pureBrandKeywords) {
    const normalized = normalizeGoogleAdsKeyword(brandKeyword) || ''
    if (!normalized) continue
    for (const token of normalized.split(/\s+/).filter(Boolean)) {
      out.add(token)
    }
  }
  return out
}

function isNeutralTokenForTranslation(token: string, neutralTokens: Set<string>): boolean {
  if (!token) return true
  if (neutralTokens.has(token)) return true
  if (/^\d+$/.test(token)) return true
  if (/^[a-z]*\d+[a-z0-9-]*$/i.test(token)) return true
  if (/^\d+[a-z]{1,4}$/i.test(token)) return true
  return false
}

function shouldAttemptTranslationForKeyword(params: {
  keyword: string
  pureBrandKeywords: string[]
}): boolean {
  const normalized = normalizeGoogleAdsKeyword(params.keyword)
  if (!normalized) return false
  if (isPureBrandKeyword(normalized, params.pureBrandKeywords)) return false

  const neutralTokens = buildTranslationNeutralTokenSet(params.pureBrandKeywords)
  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return false

  const hasNonNeutralToken = tokens.some(
    (token) => !isNeutralTokenForTranslation(token, neutralTokens)
  )
  return hasNonNeutralToken
}

async function translateKeywordsToTargetLanguage(params: {
  userId?: number
  targetLanguage?: string | null
  keywords: string[]
}): Promise<Map<string, string>> {
  const userId = Number(params.userId)
  const targetLanguage = String(params.targetLanguage || '').trim()
  const translationEnabled = parseBooleanFeatureFlag(
    process.env.OFFER_KEYWORD_TARGET_LANGUAGE_TRANSLATION_ENABLED,
    true
  )
  const out = new Map<string, string>()

  if (!translationEnabled || !Number.isFinite(userId) || userId <= 0) return out
  if (!targetLanguage || params.keywords.length === 0) return out
  const promptTemplate = await loadPrompt('keyword_translation_normalization')

  for (const chunk of splitIntoChunks(
    params.keywords,
    TARGET_LANGUAGE_TRANSLATION_MAX_BATCH_SIZE
  )) {
    const uniqueChunkKeywords = Array.from(
      new Set(chunk.map((keyword) => String(keyword || '').trim()).filter(Boolean))
    )
    if (uniqueChunkKeywords.length === 0) continue

    try {
      const aiResponse = await generateContent(
        {
          operationType: 'keyword_translation_normalization',
          prompt: buildTranslationPrompt({
            promptTemplate,
            targetLanguage,
            keywords: uniqueChunkKeywords,
          }),
          temperature: 0.1,
          maxOutputTokens: 2048,
          responseSchema: {
            type: 'OBJECT',
            properties: {
              translations: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    index: { type: 'INTEGER' },
                    keyword: { type: 'STRING' },
                  },
                  required: ['index', 'keyword'],
                },
              },
            },
            required: ['translations'],
          },
          responseMimeType: 'application/json',
        },
        userId
      )

      if (aiResponse.usage) {
        const cost = estimateTokenCost(
          aiResponse.model,
          aiResponse.usage.inputTokens,
          aiResponse.usage.outputTokens
        )
        await recordTokenUsage({
          userId,
          model: aiResponse.model,
          operationType: 'keyword_translation_normalization',
          inputTokens: aiResponse.usage.inputTokens,
          outputTokens: aiResponse.usage.outputTokens,
          totalTokens: aiResponse.usage.totalTokens,
          cost,
          apiType: aiResponse.apiType,
        })
      }

      const parsed = parseTranslationResponse(aiResponse.text)
      for (const item of parsed) {
        const sourceKeyword = uniqueChunkKeywords[item.index]
        if (!sourceKeyword) continue
        const translated = String(item.keyword || '').trim()
        if (!translated) continue
        out.set(sourceKeyword, translated)
      }
    } catch (error: any) {
      console.warn(
        `[VerifiedSource] 目标语翻译失败，回退为语言过滤: ${error?.message || String(error)}`
      )
    }
  }

  return out
}

async function normalizeKeywordTermsByTargetLanguage(params: {
  userId?: number
  keywords: string[]
  targetLanguage?: string | null
  pureBrandKeywords: string[]
}): Promise<{ keywords: string[]; removed: number; translated: number }> {
  const out: string[] = []
  const seen = new Set<string>()
  let removed = 0
  let translated = 0
  const candidatesNeedingTranslation: string[] = []

  for (const rawKeyword of params.keywords) {
    const raw = String(rawKeyword || '').trim()
    const normalized = normalizeGoogleAdsKeyword(raw)
    if (!raw || !normalized) continue

    const compatibility = analyzeKeywordLanguageCompatibility({
      keyword: raw,
      targetLanguage: params.targetLanguage || undefined,
      pureBrandKeywords: params.pureBrandKeywords,
    })
    if (compatibility.hardReject) {
      if (
        shouldAttemptTranslationForKeyword({
          keyword: raw,
          pureBrandKeywords: params.pureBrandKeywords,
        })
      ) {
        candidatesNeedingTranslation.push(raw)
        continue
      }
      removed += 1
      continue
    }

    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(raw)
  }

  if (candidatesNeedingTranslation.length > 0) {
    const translatedKeywordMap = await translateKeywordsToTargetLanguage({
      userId: params.userId,
      targetLanguage: params.targetLanguage,
      keywords: candidatesNeedingTranslation,
    })

    for (const sourceKeyword of candidatesNeedingTranslation) {
      const candidate = translatedKeywordMap.get(sourceKeyword) || sourceKeyword
      const normalizedCandidate = normalizeGoogleAdsKeyword(candidate)
      if (!normalizedCandidate) {
        removed += 1
        continue
      }

      const candidateCompatibility = analyzeKeywordLanguageCompatibility({
        keyword: candidate,
        targetLanguage: params.targetLanguage || undefined,
        pureBrandKeywords: params.pureBrandKeywords,
      })
      if (candidateCompatibility.hardReject) {
        removed += 1
        continue
      }

      if (seen.has(normalizedCandidate)) continue
      seen.add(normalizedCandidate)
      out.push(candidate)
      if (normalizeGoogleAdsKeyword(sourceKeyword) !== normalizedCandidate) {
        translated += 1
      }
    }
  }

  return { keywords: out, removed, translated }
}

function collectStructuredExpansionSourceTexts(offer: Offer): string[] {
  const scrapedData = parseJsonField<Record<string, unknown>>(offer.scraped_data, {})
  const extractedHeadlines = parseJsonField<unknown[]>((offer as any).extracted_headlines, [])
  const extractedDescriptions = parseJsonField<unknown[]>((offer as any).extracted_descriptions, [])

  const values: string[] = []
  const push = (value: unknown) => {
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (!trimmed) return
    values.push(trimmed)
  }
  const pushList = (value: unknown, limit: number = 8) => {
    if (!Array.isArray(value)) return
    value.slice(0, limit).forEach((item) => push(item))
  }

  push(offer.product_name)
  push((offer as any).product_title)
  push(offer.category)
  push(offer.product_highlights)
  push(offer.unique_selling_points)
  push((scrapedData as any)?.rawProductTitle)
  push((scrapedData as any)?.productName)
  push((scrapedData as any)?.title)
  pushList((scrapedData as any)?.aboutThisItem, 6)
  pushList((scrapedData as any)?.features, 6)
  pushList((scrapedData as any)?.highlights, 6)
  pushList((scrapedData as any)?.productHighlights, 6)
  pushList(extractedHeadlines, 8)
  pushList(extractedDescriptions, 4)

  return Array.from(new Set(values))
}

function extractStructuredEntitiesFromTexts(texts: string[]): {
  modelTokens: string[]
  specTokens: string[]
  certTokens: string[]
} {
  const modelTokens = new Set<string>()
  const specTokens = new Set<string>()
  const certTokens = new Set<string>()

  for (const text of texts) {
    const rawText = String(text || '')
    if (!rawText) continue

    const modelMatches = rawText.match(STRUCTURED_MODEL_TOKEN_RE) || []
    for (const match of modelMatches) {
      const normalized = match.replace(/[\s-]+/g, '').toLowerCase()
      if (!normalized) continue
      if (!/[a-z]/i.test(normalized) || !/\d/.test(normalized)) continue
      modelTokens.add(normalized)
    }

    const specMatches = rawText.match(STRUCTURED_SPEC_TOKEN_RE) || []
    for (const match of specMatches) {
      const unitMatch = match.match(/(\d{2,5})\s*([a-z]+)/i)
      if (!unitMatch) continue
      const normalized = `${unitMatch[1]} ${unitMatch[2].toLowerCase()}`
      specTokens.add(normalized)
    }

    const certMatches = rawText.match(STRUCTURED_CERT_TOKEN_RE) || []
    for (const match of certMatches) {
      const normalized = match.toLowerCase().replace(/[\/]+/g, ' ').replace(/\s+/g, ' ').trim()
      if (!normalized) continue
      certTokens.add(normalized)
    }
  }

  return {
    modelTokens: Array.from(modelTokens),
    specTokens: Array.from(specTokens),
    certTokens: Array.from(certTokens),
  }
}

function buildStructuredProductCorePhrase(offer: Offer): string {
  const pureBrandTokens = new Set(
    getPureBrandKeywords(offer.brand || '')
      .flatMap((item) => normalizeGoogleAdsKeyword(item)?.split(/\s+/) || [])
      .filter(Boolean)
  )
  const tokens = (
    normalizeGoogleAdsKeyword(
      [
        String(offer.product_name || ''),
        String((offer as any).product_title || ''),
        String(offer.category || ''),
      ].join(' ')
    ) || ''
  )
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.length >= 3)
    .filter((item) => !pureBrandTokens.has(item))
    .filter((item) => !STRUCTURED_PRODUCT_CORE_STOPWORDS.has(item))
    .filter((item) => !/^\d+$/.test(item))

  if (tokens.length === 0) return ''
  return Array.from(new Set(tokens)).slice(0, 3).join(' ')
}

function buildStructuredModelSpecExpansionKeywords(params: {
  offer: Offer
  pureBrandKeywords: string[]
}): string[] {
  const brand = normalizeGoogleAdsKeyword(params.offer.brand || '')
  if (!brand) return []

  const sourceTexts = collectStructuredExpansionSourceTexts(params.offer)
  const entities = extractStructuredEntitiesFromTexts(sourceTexts)
  if (
    entities.modelTokens.length === 0 &&
    entities.specTokens.length === 0 &&
    entities.certTokens.length === 0
  ) {
    return []
  }

  const productCorePhrase = buildStructuredProductCorePhrase(params.offer)
  const out: string[] = []
  const seen = new Set<string>()
  const push = (...segments: string[]) => {
    const normalized = normalizeGoogleAdsKeyword(segments.filter(Boolean).join(' '))
    if (!normalized) return
    const tokenCount = normalized.split(/\s+/).filter(Boolean).length
    if (tokenCount < 2 || tokenCount > 8) return
    if (seen.has(normalized)) return
    seen.add(normalized)
    out.push(normalized)
  }

  for (const model of entities.modelTokens.slice(0, 10)) {
    push(brand, model)
    if (productCorePhrase) push(brand, productCorePhrase, model)
  }

  for (const spec of entities.specTokens.slice(0, 10)) {
    push(brand, spec)
    if (productCorePhrase) push(brand, productCorePhrase, spec)
    for (const model of entities.modelTokens.slice(0, 4)) {
      push(brand, model, spec)
    }
  }

  for (const cert of entities.certTokens.slice(0, 6)) {
    push(brand, cert)
    if (productCorePhrase) push(brand, productCorePhrase, cert)
    for (const model of entities.modelTokens.slice(0, 3)) {
      push(brand, model, cert)
    }
  }

  return out.slice(0, 24)
}

type VerifiedSourceKeywordMap = {
  TITLE_EXTRACT: PoolKeywordData[]
  ABOUT_EXTRACT: PoolKeywordData[]
  PARAM_EXTRACT: PoolKeywordData[]
  HOT_PRODUCT_AGGREGATE: PoolKeywordData[]
  PAGE_EXTRACT: PoolKeywordData[]
}

const STORE_PRODUCT_LINK_NAME_FIELDS = [
  'name',
  'title',
  'productName',
  'product_name',
  'model',
  'series',
  'variant',
  'sku',
] as const

const STORE_PRODUCT_LINK_URL_FIELDS = ['url', 'link', 'href', 'productUrl', 'productLink'] as const

const STORE_PRODUCT_LINK_QUERY_NAME_KEYS = new Set([
  'name',
  'title',
  'product',
  'product_name',
  'productname',
  'model',
  'series',
  'variant',
  'sku',
])

const STORE_PRODUCT_LINK_NOISE_SEGMENTS = new Set([
  'index',
  'openurl',
  'openurlproduct',
  'redirect',
  'go',
  'click',
  'track',
  'tracking',
  'router',
  'landing',
  'jump',
  'visit',
])

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function normalizeStoreProductNameCandidate(value: string): string {
  return value
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[_+\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeStoreProductLinksInput(storeProductLinks: unknown): unknown[] {
  if (!storeProductLinks) return []

  if (Array.isArray(storeProductLinks)) return storeProductLinks

  if (typeof storeProductLinks === 'string') {
    const trimmed = storeProductLinks.trim()
    if (!trimmed) return []
    try {
      return normalizeStoreProductLinksInput(JSON.parse(trimmed))
    } catch {
      return [trimmed]
    }
  }

  if (typeof storeProductLinks === 'object') {
    const record = storeProductLinks as Record<string, unknown>
    if (Array.isArray(record.links)) return record.links
    if (Array.isArray(record.products)) return record.products
    return [record]
  }

  return []
}

function extractStoreProductNameCandidatesFromUrl(urlLike: string): string[] {
  const trimmed = urlLike.trim()
  if (!trimmed) return []

  const candidates: string[] = []
  const pushCandidate = (value: string) => {
    const normalized = normalizeStoreProductNameCandidate(value)
    if (!normalized) return
    if (candidates.includes(normalized)) return
    candidates.push(normalized)
  }

  try {
    const parsed = new URL(trimmed)
    const pathSegments = parsed.pathname
      .split('/')
      .map((segment) => normalizeStoreProductNameCandidate(safeDecodeUriComponent(segment)))
      .filter(Boolean)

    for (let i = pathSegments.length - 1; i >= 0; i -= 1) {
      const segment = pathSegments[i]
      if (/^(p|dp|gp|product|products|item|items|store|shop)$/i.test(segment)) continue
      if (STORE_PRODUCT_LINK_NOISE_SEGMENTS.has(segment.toLowerCase())) continue
      if (/^openurl[a-z0-9_]*$/i.test(segment)) continue
      pushCandidate(segment)
      break
    }

    for (const [key, value] of parsed.searchParams.entries()) {
      if (!STORE_PRODUCT_LINK_QUERY_NAME_KEYS.has(key.toLowerCase())) continue
      const decodedValue = safeDecodeUriComponent(value)
      if (STORE_PRODUCT_LINK_NOISE_SEGMENTS.has(decodedValue.toLowerCase())) continue
      if (/^openurl[a-z0-9_]*$/i.test(decodedValue)) continue
      pushCandidate(decodedValue)
    }
  } catch {
    if (!/^https?:\/\//i.test(trimmed)) {
      pushCandidate(safeDecodeUriComponent(trimmed))
    }
  }

  return candidates
}

function extractStoreProductNamesFromLinks(storeProductLinks: unknown): string[] {
  const candidates: string[] = []
  const pushCandidate = (value: unknown) => {
    if (typeof value !== 'string') return
    const normalized = normalizeStoreProductNameCandidate(value)
    if (!normalized) return
    if (candidates.includes(normalized)) return
    candidates.push(normalized)
  }

  const items = normalizeStoreProductLinksInput(storeProductLinks)
  for (const item of items) {
    if (typeof item === 'string') {
      const trimmedItem = item.trim()
      if (!trimmedItem) continue
      const urlCandidates = extractStoreProductNameCandidatesFromUrl(trimmedItem)
      if (urlCandidates.length > 0) {
        for (const candidate of urlCandidates) pushCandidate(candidate)
      } else if (!/^https?:\/\//i.test(trimmedItem)) {
        pushCandidate(trimmedItem)
      }
      continue
    }

    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>

    for (const key of STORE_PRODUCT_LINK_NAME_FIELDS) {
      pushCandidate(record[key])
    }

    for (const key of STORE_PRODUCT_LINK_URL_FIELDS) {
      const urlValue = record[key]
      if (typeof urlValue !== 'string') continue
      for (const candidate of extractStoreProductNameCandidatesFromUrl(urlValue)) {
        pushCandidate(candidate)
      }
    }
  }

  return candidates
}

function emptyVerifiedSourceKeywordMap(): VerifiedSourceKeywordMap {
  return {
    TITLE_EXTRACT: [],
    ABOUT_EXTRACT: [],
    PARAM_EXTRACT: [],
    HOT_PRODUCT_AGGREGATE: [],
    PAGE_EXTRACT: [],
  }
}

type VerifiedSourceNormalizationKey = keyof VerifiedSourceKeywordMap | 'STRUCTURED_EXPANSION'

type NormalizedKeywordTermsResult = Awaited<
  ReturnType<typeof normalizeKeywordTermsByTargetLanguage>
>

function createEmptyNormalizedKeywordTermsResult(): NormalizedKeywordTermsResult {
  return {
    keywords: [],
    removed: 0,
    translated: 0,
  }
}

function createEmptyVerifiedSourceNormalizationMap(): Record<
  VerifiedSourceNormalizationKey,
  NormalizedKeywordTermsResult
> {
  return {
    TITLE_EXTRACT: createEmptyNormalizedKeywordTermsResult(),
    ABOUT_EXTRACT: createEmptyNormalizedKeywordTermsResult(),
    PARAM_EXTRACT: createEmptyNormalizedKeywordTermsResult(),
    HOT_PRODUCT_AGGREGATE: createEmptyNormalizedKeywordTermsResult(),
    PAGE_EXTRACT: createEmptyNormalizedKeywordTermsResult(),
    STRUCTURED_EXPANSION: createEmptyNormalizedKeywordTermsResult(),
  }
}

async function normalizeVerifiedSourceKeywordEntriesByTargetLanguage(params: {
  userId?: number
  targetLanguage?: string
  pureBrandKeywords: string[]
  entries: Array<{
    key: VerifiedSourceNormalizationKey
    keywords: string[]
  }>
}): Promise<Record<VerifiedSourceNormalizationKey, NormalizedKeywordTermsResult>> {
  const normalizedByKey = createEmptyVerifiedSourceNormalizationMap()
  for (const entry of params.entries) {
    normalizedByKey[entry.key] = await normalizeKeywordTermsByTargetLanguage({
      userId: params.userId,
      keywords: entry.keywords,
      targetLanguage: params.targetLanguage,
      pureBrandKeywords: params.pureBrandKeywords,
    })
  }
  return normalizedByKey
}

function sumVerifiedSourceNormalizationMetric(
  normalizedByKey: Record<VerifiedSourceNormalizationKey, NormalizedKeywordTermsResult>,
  field: 'removed' | 'translated'
): number {
  return Object.values(normalizedByKey).reduce((sum, item) => sum + Number(item[field] || 0), 0)
}

async function buildVerifiedSourceKeywordData(
  offer: Offer,
  userId?: number
): Promise<VerifiedSourceKeywordMap> {
  const brand = String(offer.brand || '').trim()
  if (!brand) return emptyVerifiedSourceKeywordMap()
  const storeProductNames = extractStoreProductNamesFromLinks(offer.store_product_links)

  const productFeatures = [offer.product_highlights, offer.unique_selling_points]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('; ')

  const sourcePool = extractVerifiedKeywordSourcePool({
    brand,
    category: offer.category,
    productTitle: offer.product_name || undefined,
    productFeatures: productFeatures || undefined,
    scrapedData: offer.scraped_data || undefined,
    reviewAnalysis: offer.review_analysis || undefined,
    brandAnalysis: (offer as any).brand_analysis || undefined,
    storeProductNames,
  })

  const pureBrandKeywords = getPureBrandKeywords(brand)
  const targetLanguage = String(offer.target_language || '').trim() || undefined

  const structuredExpansionKeywordsRaw = buildStructuredModelSpecExpansionKeywords({
    offer,
    pureBrandKeywords,
  })
  const normalizedByKey = await normalizeVerifiedSourceKeywordEntriesByTargetLanguage({
    userId,
    targetLanguage,
    pureBrandKeywords,
    entries: [
      { key: 'TITLE_EXTRACT', keywords: sourcePool.titleKeywords },
      { key: 'ABOUT_EXTRACT', keywords: sourcePool.aboutKeywords },
      { key: 'PARAM_EXTRACT', keywords: sourcePool.paramKeywords },
      { key: 'HOT_PRODUCT_AGGREGATE', keywords: sourcePool.hotProductKeywords },
      { key: 'PAGE_EXTRACT', keywords: sourcePool.pageKeywords },
      { key: 'STRUCTURED_EXPANSION', keywords: structuredExpansionKeywordsRaw },
    ],
  })
  const languageRemovedCount = sumVerifiedSourceNormalizationMetric(normalizedByKey, 'removed')
  if (languageRemovedCount > 0) {
    console.log(
      `[VerifiedSource] 目标语净化移除 ${languageRemovedCount} 个候选词 (offer=${offer.id}, target=${targetLanguage || 'n/a'})`
    )
  }
  const translatedCount = sumVerifiedSourceNormalizationMetric(normalizedByKey, 'translated')
  if (translatedCount > 0) {
    console.log(
      `[VerifiedSource] 目标语净化翻译 ${translatedCount} 个候选词 (offer=${offer.id}, target=${targetLanguage || 'n/a'})`
    )
  }
  if (normalizedByKey.STRUCTURED_EXPANSION.keywords.length > 0) {
    console.log(
      `[VerifiedSource] 商品化扩词注入 ${normalizedByKey.STRUCTURED_EXPANSION.keywords.length} 个型号/规格/认证候选 (offer=${offer.id})`
    )
  }

  const createKeywordData = (
    keywords: string[],
    source: keyof VerifiedSourceKeywordMap
  ): PoolKeywordData[] => {
    const map = new Map<string, PoolKeywordData>()
    for (const keyword of keywords) {
      const normalized = normalizeGoogleAdsKeyword(keyword)
      if (!normalized || isInvalidKeyword(normalized)) continue
      if (map.has(normalized)) continue
      map.set(normalized, {
        keyword,
        searchVolume: 0,
        source,
        matchType: hasModelAnchorEvidence({ keywords: [keyword] })
          ? 'EXACT'
          : inferDefaultKeywordMatchType(keyword, pureBrandKeywords),
        relevanceScore:
          source === 'HOT_PRODUCT_AGGREGATE'
            ? 0.98
            : source === 'PARAM_EXTRACT'
              ? 0.96
              : source === 'TITLE_EXTRACT'
                ? 0.94
                : source === 'ABOUT_EXTRACT'
                  ? 0.92
                  : 0.9,
        qualityTier: 'HIGH',
      })
    }
    return Array.from(map.values())
  }

  const candidateMap: VerifiedSourceKeywordMap = {
    TITLE_EXTRACT: createKeywordData(normalizedByKey.TITLE_EXTRACT.keywords, 'TITLE_EXTRACT'),
    ABOUT_EXTRACT: createKeywordData(normalizedByKey.ABOUT_EXTRACT.keywords, 'ABOUT_EXTRACT'),
    PARAM_EXTRACT: createKeywordData(
      [...normalizedByKey.PARAM_EXTRACT.keywords, ...normalizedByKey.STRUCTURED_EXPANSION.keywords],
      'PARAM_EXTRACT'
    ),
    HOT_PRODUCT_AGGREGATE: createKeywordData(
      normalizedByKey.HOT_PRODUCT_AGGREGATE.keywords,
      'HOT_PRODUCT_AGGREGATE'
    ),
    PAGE_EXTRACT: createKeywordData(normalizedByKey.PAGE_EXTRACT.keywords, 'PAGE_EXTRACT'),
  }

  const allCandidates = Object.values(candidateMap).flat()
  if (allCandidates.length === 0) return candidateMap

  const { categoryContext, minContextTokenMatches } = buildGlobalCoreQualityFilterContext(offer)
  const filtered = filterKeywordQuality(allCandidates, {
    brandName: offer.brand,
    category: categoryContext,
    productName: offer.product_name || undefined,
    targetCountry: offer.target_country || undefined,
    targetLanguage: offer.target_language || undefined,
    productUrl: offer.final_url || offer.url || undefined,
    minWordCount: 1,
    maxWordCount: 8,
    mustContainBrand: pureBrandKeywords.length > 0,
    minContextTokenMatches: Math.max(1, minContextTokenMatches),
    contextMismatchMode: 'soft',
  })

  const result = emptyVerifiedSourceKeywordMap()
  for (const item of filtered.filtered) {
    const source = String(item.source || '').toUpperCase() as keyof VerifiedSourceKeywordMap
    if (!Object.prototype.hasOwnProperty.call(result, source)) continue
    result[source].push(item)
  }

  return {
    TITLE_EXTRACT: prioritizeBucketKeywords(result.TITLE_EXTRACT),
    ABOUT_EXTRACT: prioritizeBucketKeywords(result.ABOUT_EXTRACT),
    PARAM_EXTRACT: prioritizeBucketKeywords(result.PARAM_EXTRACT),
    HOT_PRODUCT_AGGREGATE: prioritizeBucketKeywords(result.HOT_PRODUCT_AGGREGATE),
    PAGE_EXTRACT: prioritizeBucketKeywords(result.PAGE_EXTRACT),
  }
}

function appendVerifiedKeywordsToBucket(params: {
  current: PoolKeywordData[]
  additions: PoolKeywordData[]
  usedNorms: Set<string>
}): PoolKeywordData[] {
  const map = new Map<string, PoolKeywordData>()

  for (const item of params.current) {
    const normalized = normalizeGoogleAdsKeyword(item.keyword)
    if (!normalized) continue
    map.set(normalized, item)
    params.usedNorms.add(normalized)
  }

  for (const item of params.additions) {
    const normalized = normalizeGoogleAdsKeyword(item.keyword)
    if (!normalized) continue

    const existing = map.get(normalized)
    if (existing) {
      const existingPriority = getKeywordSourcePriority(existing.source)
      const nextPriority = getKeywordSourcePriority(item.source)
      if ((existing.searchVolume || 0) <= 0 && nextPriority < existingPriority) {
        map.set(normalized, {
          ...existing,
          source: item.source,
          matchType: item.matchType || existing.matchType,
          relevanceScore: Math.max(existing.relevanceScore || 0, item.relevanceScore || 0),
          qualityTier: existing.qualityTier || item.qualityTier,
        })
      }
      continue
    }

    if (params.usedNorms.has(normalized)) continue
    map.set(normalized, item)
    params.usedNorms.add(normalized)
  }

  return prioritizeBucketKeywords(Array.from(map.values()))
}

/**
 * 🆕 解析关键词数组（向后兼容）
 * 处理新格式 PoolKeywordData[] 和旧格式 string[]
 */
function normalizeParsedPoolKeywordItem(raw: unknown): PoolKeywordData | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const partialItem = item as Partial<PoolKeywordData>
  const keyword = String(item.keyword || '').trim()
  if (!keyword) return null

  const rawSource = String(item.source || '').trim()
  const rawSourceType = String(item.sourceType || '').trim()
  const rawSourceSubtype = String(item.sourceSubtype || '').trim()
  const numericSearchVolume = Number(item.searchVolume || 0)
  const searchVolume = Number.isFinite(numericSearchVolume) ? numericSearchVolume : 0
  const matchType = String(item.matchType || '')
    .trim()
    .toUpperCase()
  const normalizedMatchType =
    matchType === 'EXACT' || matchType === 'PHRASE' || matchType === 'BROAD'
      ? (matchType as 'EXACT' | 'PHRASE' | 'BROAD')
      : 'PHRASE'
  const hasExplicitSourceMetadata = Boolean(rawSource || rawSourceType || rawSourceSubtype)
  if (hasExplicitSourceMetadata) {
    const source = rawSource || 'KEYWORD_POOL'
    const sourceType = rawSourceType || rawSourceSubtype || source
    const sourceSubtype = rawSourceSubtype || rawSourceType || sourceType
    return {
      ...partialItem,
      keyword,
      searchVolume,
      source,
      sourceType,
      sourceSubtype,
      matchType: normalizedMatchType,
    }
  }

  const source = 'KEYWORD_POOL'
  const sourceType = 'KEYWORD_POOL'
  const sourceSubtype = 'KEYWORD_POOL'

  return {
    ...partialItem,
    keyword,
    searchVolume,
    source,
    sourceType,
    sourceSubtype,
    matchType: normalizedMatchType,
  }
}

function parseKeywordArray(data: unknown): PoolKeywordData[] {
  const parsed = parseKeywordArrayFromDb(data)

  if (!Array.isArray(parsed) || parsed.length === 0) return []

  // 新格式：PoolKeywordData[]
  if (typeof parsed[0] === 'object' && parsed[0] !== null && 'keyword' in parsed[0]) {
    return parsed
      .map((item) => normalizeParsedPoolKeywordItem(item))
      .filter((item): item is PoolKeywordData => Boolean(item))
  }

  // 旧格式：string[] - 转换为 PoolKeywordData[]
  return parsed
    .map((kw: unknown) => (typeof kw === 'string' ? kw : ''))
    .filter((kw) => kw.length > 0)
    .map((kw) => ({
      keyword: kw,
      searchVolume: 0,
      source: 'LEGACY',
      matchType: 'PHRASE',
    }))
}

/**
 * 根据 Offer ID 获取关键词池
 * 🆕 v4.16: 添加店铺分桶字段解析
 */
export async function getKeywordPoolByOfferId(offerId: number): Promise<OfferKeywordPool | null> {
  const db = await getDatabase()

  const row = await db.queryOne<any>('SELECT * FROM offer_keyword_pools WHERE offer_id = ?', [
    offerId,
  ])

  if (!row) return null

  // 🔥 2025-12-16升级：使用parseKeywordArray处理新旧格式
  // 🔥 2025-12-22：添加bucketDKeywords和bucketDIntent
  // 🔥 2025-12-24：添加店铺分桶字段
  return {
    id: row.id,
    offerId: row.offer_id,
    userId: row.user_id,
    brandKeywords: parseKeywordArray(row.brand_keywords),
    bucketAKeywords: parseKeywordArray(row.bucket_a_keywords),
    bucketBKeywords: parseKeywordArray(row.bucket_b_keywords),
    bucketCKeywords: parseKeywordArray(row.bucket_c_keywords),
    bucketDKeywords: parseKeywordArray(row.bucket_d_keywords ?? []),
    bucketAIntent: row.bucket_a_intent || DEFAULT_PRODUCT_CLUSTER_BUCKETS.A.intent,
    bucketBIntent: row.bucket_b_intent || DEFAULT_PRODUCT_CLUSTER_BUCKETS.B.intent,
    bucketCIntent: row.bucket_c_intent || DEFAULT_PRODUCT_CLUSTER_BUCKETS.C.intent,
    bucketDIntent: row.bucket_d_intent || DEFAULT_PRODUCT_CLUSTER_BUCKETS.D.intent,
    // 🆕 v4.16: 店铺分桶字段
    storeBucketAKeywords: parseKeywordArray(row.store_bucket_a_keywords ?? []),
    storeBucketBKeywords: parseKeywordArray(row.store_bucket_b_keywords ?? []),
    storeBucketCKeywords: parseKeywordArray(row.store_bucket_c_keywords ?? []),
    storeBucketDKeywords: parseKeywordArray(row.store_bucket_d_keywords ?? []),
    storeBucketSKeywords: parseKeywordArray(row.store_bucket_s_keywords ?? []),
    storeBucketAIntent: row.store_bucket_a_intent || DEFAULT_STORE_CLUSTER_BUCKETS.A.intent,
    storeBucketBIntent: row.store_bucket_b_intent || DEFAULT_STORE_CLUSTER_BUCKETS.B.intent,
    storeBucketCIntent: row.store_bucket_c_intent || DEFAULT_STORE_CLUSTER_BUCKETS.C.intent,
    storeBucketDIntent: row.store_bucket_d_intent || DEFAULT_STORE_CLUSTER_BUCKETS.D.intent,
    storeBucketSIntent: row.store_bucket_s_intent || DEFAULT_STORE_CLUSTER_BUCKETS.S.intent,
    linkType: row.link_type || 'product',
    totalKeywords: row.total_keywords,
    clusteringModel: row.clustering_model,
    clusteringPromptVersion: row.clustering_prompt_version,
    balanceScore: row.balance_score,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * 删除关键词池
 */
export async function deleteKeywordPool(offerId: number): Promise<void> {
  const db = await getDatabase()
  const existing = await db.queryOne<{ id: number }>(
    'SELECT id FROM offer_keyword_pools WHERE offer_id = ?',
    [offerId]
  )

  if (!existing) {
    console.log(`ℹ️ 关键词池不存在: Offer #${offerId}`)
    return
  }

  let cleared = 0
  await db.transaction(async () => {
    const clearResult = await db.exec(
      'UPDATE ad_creatives SET keyword_pool_id = NULL WHERE offer_id = ? AND keyword_pool_id = ?',
      [offerId, existing.id]
    )
    cleared = clearResult.changes
    await db.exec('DELETE FROM offer_keyword_pools WHERE id = ?', [existing.id])
  })

  console.log(`🗑️ 关键词池已删除: Offer #${offerId} (清理创意引用: ${cleared})`)
}

// ============================================
// 主要流程
// ============================================

/**
 * 生成 Offer 级关键词池（主入口）
 *
 * @param offerId - Offer ID
 * @param userId - 用户 ID
 * @param allKeywords - 所有关键词列表（可选，如不提供则从现有创意提取）
 * @returns 关键词池
 */
export async function generateOfferKeywordPool(
  offerId: number,
  userId: number,
  allKeywords?: string[],
  progress?: KeywordPoolProgressReporter,
  preparedExpand?: KeywordPoolExpandLoadResult
): Promise<OfferKeywordPool> {
  console.log(`\n📦 开始生成 Offer #${offerId} 的关键词池`)
  await progress?.({ phase: 'seed-volume', message: '开始生成关键词池' })

  // 1. 获取 Offer 信息
  const offer = await findOfferById(offerId, userId)
  if (!offer) {
    throw new Error(`Offer #${offerId} 不存在`)
  }
  const pureBrandKeywordsForOffer = getPureBrandKeywords(offer.brand || '')
  const pageType = resolveOfferPageType(offer)
  const verifiedSourceKeywords = await buildVerifiedSourceKeywordData(offer, userId)
  let allowPlannerNonBrand = false
  let plannerNonBrandPolicy: PlannerNonBrandPolicy = createPlannerNonBrandPolicy({
    pageType,
    enabled: allowPlannerNonBrand,
  })
  const plannerMinSearchVolume = pageType === 'store' ? DEFAULTS.minSearchVolume : undefined

  // 单次 prepare：关键词池扩展与搜索量查询共用
  let customerId: string | undefined
  let refreshToken: string | undefined
  let accountId: number | undefined
  let clientId: string | undefined
  let clientSecret: string | undefined
  let developerToken: string | undefined
  let authType: 'oauth' | 'service_account' = 'oauth'
  let plannerSession: KeywordPlannerPreparedSession | undefined
  let linkedServiceAccountId: string | null | undefined

  if (preparedExpand?.ok) {
    authType = preparedExpand.creds.authType
    customerId = preparedExpand.creds.customerId
    refreshToken = preparedExpand.creds.refreshToken
    accountId = preparedExpand.creds.accountId
    clientId = preparedExpand.creds.clientId
    clientSecret = preparedExpand.creds.clientSecret
    developerToken = preparedExpand.creds.developerToken
    linkedServiceAccountId = preparedExpand.creds.linkedServiceAccountId
    plannerSession = preparedExpand.plannerSession
  } else {
    try {
      const expandLoad = await loadKeywordPoolExpandCredentialsForOffer(userId, offer.id)
      if (!expandLoad.ok) {
        console.warn(
          `⚠️ Keyword Planner 扩展认证不可用（prepare 失败），将回退初始种子词 (offerId=${offer.id}, userId=${userId})`
        )
      } else {
        authType = expandLoad.creds.authType
        customerId = expandLoad.creds.customerId
        refreshToken = expandLoad.creds.refreshToken
        accountId = expandLoad.creds.accountId
        clientId = expandLoad.creds.clientId
        clientSecret = expandLoad.creds.clientSecret
        developerToken = expandLoad.creds.developerToken
        linkedServiceAccountId = expandLoad.creds.linkedServiceAccountId
        plannerSession = expandLoad.plannerSession
      }
    } catch (error) {
      console.warn('⚠️ 无法获取Google Ads凭证，跳过关键词扩展:', (error as Error).message)
    }
  }

  // 1.5 Marketplace场景：尽量补全“品牌官网”，用于Keyword Planner的站点过滤（best-effort）
  try {
    const { ensureOfferBrandOfficialSite } = await import('../../offers/offer-official-site')
    const official = await ensureOfferBrandOfficialSite({
      offerId: offer.id,
      userId,
      brand: offer.brand,
      targetCountry: offer.target_country,
      finalUrl: offer.final_url,
      url: offer.url,
      category: offer.category,
      productName: offer.product_name,
      extractionMetadata: offer.extraction_metadata,
    })

    if (official?.origin) {
      const existing = (() => {
        try {
          return offer.extraction_metadata ? JSON.parse(offer.extraction_metadata) : {}
        } catch {
          return {}
        }
      })()
      offer.extraction_metadata = JSON.stringify({ ...existing, brandOfficialSite: official })
      console.log(`🌐 已补全品牌官网(origin): ${official.origin}`)
    }
  } catch (e: any) {
    console.warn(`⚠️ 品牌官网补全失败（不影响关键词池生成）: ${e?.message || String(e)}`)
  }

  // 2. 提取初始关键词（保留 searchVolume）
  let initialKeywords: PoolKeywordData[]
  if (allKeywords) {
    // 🔧 修复(2026-01-21): 如果提供了关键词列表，查询搜索量而不是硬编码为 0
    console.log(`📊 查询 ${allKeywords.length} 个提供的关键词的搜索量...`)

    try {
      await progress?.({ phase: 'seed-volume', message: `初始关键词搜索量查询中` })
      const volumeProgress = progress
        ? (info: { message: string; current?: number; total?: number }) =>
            progress({
              phase: 'seed-volume',
              current: info.current,
              total: info.total,
              message: `初始关键词搜索量 ${info.current ?? 0}/${info.total ?? 0}`,
            })
        : undefined

      const volumeResult = await getKeywordSearchVolumesForPlannerContext({
        userId,
        offerId,
        keywords: allKeywords,
        country: offer.target_country,
        language: offer.target_language || 'en',
        plannerSession,
        onProgress: volumeProgress,
      })
      if (!volumeResult.ok) {
        throw new Error(volumeResult.message)
      }
      const volumes = volumeResult.volumes

      initialKeywords = volumes.map((v) => ({
        keyword: v.keyword,
        searchVolume: v.avgMonthlySearches || 0,
        competition: v.competition,
        competitionIndex: v.competitionIndex,
        lowTopPageBid: v.lowTopPageBid,
        highTopPageBid: v.highTopPageBid,
        source: 'PROVIDED',
        matchType: inferDefaultKeywordMatchType(v.keyword, pureBrandKeywordsForOffer),
      }))

      const withVolume = initialKeywords.filter((kw) => kw.searchVolume > 0).length
      console.log(`✅ 搜索量查询完成: ${withVolume}/${allKeywords.length} 个关键词有搜索量`)
    } catch (error) {
      console.warn(`⚠️ 搜索量查询失败，使用默认值 0: ${error}`)
      // 降级处理：使用默认值
      initialKeywords = allKeywords.map((kw) => ({
        keyword: kw,
        searchVolume: 0,
        source: 'PROVIDED',
        matchType: inferDefaultKeywordMatchType(kw, pureBrandKeywordsForOffer),
      }))
    }
  } else {
    initialKeywords = await extractKeywordsFromOffer(offerId, userId, progress, plannerSession)
  }

  if (initialKeywords.length === 0) {
    throw new Error('无可用关键词，请先生成关键词')
  }

  console.log(`📝 初始关键词数: ${initialKeywords.length}`)

  // 2.5 🔧 修复(2025-12-24): 优化种子词过滤策略
  // 核心问题: 52→12个种子词过滤率太高，导致关键词扩展不足
  const beforeFilterCount = initialKeywords.length
  const offerPlatform = extractPlatformFromUrl(offer.final_url || offer.url || '')

  // 🆕 先提取长尾种子词中的有价值短语
  const extractedSeeds: PoolKeywordData[] = []
  for (const kw of initialKeywords) {
    const wordCount = kw.keyword.trim().split(/\s+/).length
    if (wordCount > SEED_MAX_WORD_COUNT) {
      // 从长尾词中提取2-4个单词的短语
      const words = kw.keyword.trim().split(/\s+/)
      const brand = offer.brand.toLowerCase()

      for (let i = 0; i < words.length - 1; i++) {
        for (let len = 2; len <= Math.min(4, words.length - i); len++) {
          const phrase = words.slice(i, i + len).join(' ')
          const phraseLower = phrase.toLowerCase()

          // 只提取包含品牌名的短语
          if (phraseLower.includes(brand)) {
            extractedSeeds.push({
              ...kw,
              keyword: phrase,
            })
          }
        }
      }
    }
  }

  // 应用过滤条件
  initialKeywords = initialKeywords.filter((kw) => {
    const keyword = kw.keyword.trim()
    const wordCount = keyword.split(/\s+/).length

    // 过滤条件1：长度限制（与最终质量过滤对齐，≤8个单词）
    if (wordCount > SEED_MAX_WORD_COUNT) {
      console.log(
        `   ⊗ 种子词长度过滤: "${keyword}" (${wordCount}个单词, 限制≤${SEED_MAX_WORD_COUNT})`
      )
      return false
    }

    // 过滤条件2：排除低质量词
    // 🔥 2025-12-24优化: 只过滤明确的低质量词，保留高转化词
    const invalidPatterns = [
      // 购买渠道（保留store/shop/amazon/ebay，因为这些是正常购买渠道）
      'near me',
      'official',
      // 低转化查询类
      'history',
      'tracker',
      'locator',
      'review',
      'compare',
      // 过时年份
      '2023',
      '2022',
      '2021',
      'black friday',
      'prime day',
      // ✅ 保留: 'store', 'shop', 'amazon', 'ebay' - 店铺/销售渠道词
      // ✅ 保留: 'discount', 'sale', 'deal', 'code', 'coupon' - 商品需求扩展词
      // ✅ 保留: 'price', 'cost', 'cheap', 'affordable', 'budget' - 高转化词
      // ✅ 保留: '2024', '2025' - 当前年份
    ]
    const keywordLower = keyword.toLowerCase()
    const hasInvalidPattern = invalidPatterns.some((pattern) => keywordLower.includes(pattern))
    if (hasInvalidPattern) {
      const matchedPattern = invalidPatterns.find((p) => keywordLower.includes(p))
      console.log(`   ⊗ 种子词无效模式过滤: "${keyword}" (包含: ${matchedPattern})`)
      return false
    }

    // 过滤条件3：明显信息查询/素材查询词（高概率低转化）
    const matchedInfoPattern = SEED_INFO_QUERY_PATTERNS.find((pattern) =>
      keywordLower.includes(pattern)
    )
    if (matchedInfoPattern) {
      console.log(`   ⊗ 种子词信息查询过滤: "${keyword}" (包含: ${matchedInfoPattern})`)
      return false
    }

    // 过滤条件4：跨平台噪音词（关键词平台与目标落地页平台不一致）
    if (offerPlatform) {
      const keywordPlatforms = detectPlatformsInKeyword(keywordLower)
      const mismatchedPlatforms = keywordPlatforms.filter((platform) => platform !== offerPlatform)
      if (mismatchedPlatforms.length > 0) {
        console.log(
          `   ⊗ 种子词平台冲突过滤: "${keyword}" (关键词平台: ${mismatchedPlatforms.join('/')}, 目标平台: ${offerPlatform})`
        )
        return false
      }
    }

    return true
  })

  // 合并提取的短语种子词（去重）
  const seenPhrases = new Set(initialKeywords.map((k) => k.keyword.toLowerCase()))
  let addedCount = 0
  extractedSeeds.forEach((seed) => {
    if (!seenPhrases.has(seed.keyword.toLowerCase())) {
      initialKeywords.push(seed)
      seenPhrases.add(seed.keyword.toLowerCase())
      addedCount++
    }
  })

  if (addedCount > 0) {
    console.log(`   ✅ 从长尾种子词中提取: ${addedCount} 个短语种子词`)
  }

  if (beforeFilterCount !== initialKeywords.length) {
    console.log(`📊 种子词质量过滤: ${beforeFilterCount} → ${initialKeywords.length}`)
  }

  // 3. 🆕 全量扩展（v2.0：根据认证类型分发）
  const { expandAllKeywords, filterKeywords } = await import('../server')

  const plannerDecision: PlannerDecision = {
    allowNonBrandFromPlanner: allowPlannerNonBrand,
    volumeUnavailableFromPlanner: false,
    nonBrandPolicy: plannerNonBrandPolicy,
  }
  const expandedKeywords = await expandAllKeywords(
    initialKeywords,
    offer.brand,
    offer.category || '',
    offer.target_country,
    offer.target_language || 'en',
    authType, // 🔥 2025-12-29 新增：认证类型
    offer, // 🔥 2025-12-29 新增：Offer信息（服务账号模式需要）
    userId,
    customerId,
    refreshToken,
    accountId,
    clientId,
    clientSecret,
    developerToken,
    progress,
    plannerMinSearchVolume,
    plannerNonBrandPolicy,
    plannerDecision,
    linkedServiceAccountId,
    plannerSession
  )
  plannerNonBrandPolicy = plannerDecision.nonBrandPolicy || plannerNonBrandPolicy
  allowPlannerNonBrand = plannerDecision.allowNonBrandFromPlanner ?? allowPlannerNonBrand

  // 4. 🆕 智能过滤（竞品+品类+搜索量+地理位置）
  const filteredKeywords = filterKeywords(
    expandedKeywords,
    offer.brand,
    offer.category || '',
    offer.target_country, // 🔧 修复(2025-12-17): 传递目标国家进行地理过滤
    offer.product_name,
    {
      allowNonBrandFromPlanner: plannerNonBrandPolicy,
      // KISS: 品牌门禁统一交给 filterKeywordQuality，预过滤阶段只做轻量裁剪
      applyBrandGate: false,
    }
  )

  console.log(`📝 第一次过滤后关键词数: ${filteredKeywords.length}`)

  // 🆕 2025-12-27: 关键词质量过滤
  // 过滤品牌变体词（如 eurekaddl）和语义查询词（如 significato）
  const pageTypeForContextFilter = resolveOfferPageType(offer)
  const pureBrandKeywordsForFilter = getPureBrandKeywords(offer.brand || '')
  const categorySignals = extractCategorySignalsFromScrapedData(offer.scraped_data)
  const categoryContext = [offer.category, ...categorySignals].filter(Boolean).join(' ')
  const baseContextMatches = getMinContextTokenMatchesForKeywordQualityFilter({
    pageType: pageTypeForContextFilter,
  })
  const effectiveContextMatches = baseContextMatches

  const qualityFiltered = filterKeywordQuality(filteredKeywords, {
    brandName: offer.brand,
    category: categoryContext || undefined,
    productName: offer.product_name || undefined,
    targetCountry: offer.target_country || undefined,
    targetLanguage: offer.target_language || undefined,
    productUrl: offer.final_url || offer.url || undefined,
    minWordCount: 1,
    maxWordCount: 8,
    // 🔒 全量强制：最终关键词必须包含“纯品牌词”（不拼接造词）
    mustContainBrand: pureBrandKeywordsForFilter.length > 0,
    allowNonBrandFromPlanner: plannerNonBrandPolicy,
    // 过滤歧义品牌的无关主题（例如 rove beetle / rove concept）
    minContextTokenMatches: effectiveContextMatches,
    contextMismatchMode: 'soft',
  })

  // 生成过滤报告
  const filterReport = generateFilterReport(filteredKeywords.length, qualityFiltered.removed)
  console.log(filterReport)

  // 使用过滤后的关键词
  let finalFilteredKeywords = qualityFiltered.filtered

  // 产品页放宽策略（仅在严格过滤导致词池接近“纯品牌词独占”时触发）：
  // 在保持上下文/语义过滤前提下，回补少量高意图非纯品牌词，避免关键词池坍缩为单词。
  if (pageTypeForContextFilter === 'product' && pureBrandKeywordsForFilter.length > 0) {
    const strictNonPureCount = finalFilteredKeywords.filter(
      (kw) => !isPureBrandKeyword(kw.keyword, pureBrandKeywordsForFilter)
    ).length

    if (strictNonPureCount < 3) {
      const relaxedQualityFiltered = filterKeywordQuality(filteredKeywords, {
        brandName: offer.brand,
        category: categoryContext || undefined,
        productName: offer.product_name || undefined,
        targetCountry: offer.target_country || undefined,
        targetLanguage: offer.target_language || undefined,
        productUrl: offer.final_url || offer.url || undefined,
        minWordCount: 1,
        maxWordCount: 8,
        mustContainBrand: false,
        allowNonBrandFromPlanner: plannerNonBrandPolicy,
        minContextTokenMatches: effectiveContextMatches,
        contextMismatchMode: 'soft',
      })

      const existingNormSet = new Set(
        finalFilteredKeywords.map((item) => normalizeGoogleAdsKeyword(item.keyword)).filter(Boolean)
      )

      const relaxedSeenSet = new Set<string>()
      const relaxedCandidates = prioritizeKeywordsForClustering(
        relaxedQualityFiltered.filtered
          .map((kw): PoolKeywordData | null => {
            if (isPureBrandKeyword(kw.keyword, pureBrandKeywordsForFilter)) return null
            if (
              !hasCommercialIntentForProductRelaxedRetention(
                kw.keyword,
                offer.target_language || 'en'
              )
            ) {
              return null
            }

            // 参考 title/about 补词：把高意图非品牌词统一改写为“品牌前置”形式，避免品牌词重复并限制词长。
            const brandedKeyword = composeGlobalCoreBrandedKeyword(kw.keyword, offer.brand || '', 5)
            if (!brandedKeyword) return null

            const norm = normalizeGoogleAdsKeyword(brandedKeyword)
            if (!norm || existingNormSet.has(norm) || relaxedSeenSet.has(norm)) return null
            relaxedSeenSet.add(norm)

            return {
              ...kw,
              keyword: brandedKeyword,
              source: 'PRODUCT_RELAX_BRANDED',
              sourceType: 'PRODUCT_RELAX_BRANDED',
              sourceSubtype: 'PURE_BRAND_PREFIX_REWRITE',
              rawSource:
                String(
                  (kw as any).rawSource ||
                    (kw as any).sourceSubtype ||
                    (kw as any).sourceType ||
                    kw.source ||
                    'KEYWORD_POOL'
                ).trim() || 'KEYWORD_POOL',
              derivedTags: Array.from(
                new Set([
                  ...(((kw as any).derivedTags || []) as string[]),
                  'PRODUCT_RELAX_BRANDED',
                  'PURE_BRAND_PREFIX_REWRITE',
                ])
              ),
              matchType: 'PHRASE',
            }
          })
          .filter((kw): kw is PoolKeywordData => kw !== null)
      )

      const rescueLimit = Math.max(8, Math.min(30, Math.floor(filteredKeywords.length * 0.2)))
      const rescuedKeywords = relaxedCandidates.slice(0, rescueLimit)

      if (rescuedKeywords.length > 0) {
        finalFilteredKeywords = [...finalFilteredKeywords, ...rescuedKeywords]
        console.log(
          `🧩 product页放宽补齐: +${rescuedKeywords.length} 个高意图词(品牌前置改写) ` +
            `(strict_non_pure=${strictNonPureCount}, relaxed_candidates=${relaxedCandidates.length})`
        )
      } else {
        console.log(`ℹ️ product页放宽补齐未命中可用词 (strict_non_pure=${strictNonPureCount})`)
      }
    }
  }

  // 🔒 有真实搜索量数据时，移除非纯品牌的0搜索量关键词
  const hasAnyVolume = finalFilteredKeywords.some((kw) => kw.searchVolume > 0)
  const volumeUnavailable =
    plannerDecision.volumeUnavailableFromPlanner ||
    hasSearchVolumeUnavailableFlag(finalFilteredKeywords)
  if (hasAnyVolume && !volumeUnavailable) {
    const beforeVolumeFilter = finalFilteredKeywords.length
    finalFilteredKeywords = finalFilteredKeywords.filter(
      (kw) => kw.searchVolume > 0 || isPureBrandKeyword(kw.keyword, pureBrandKeywordsForFilter)
    )
    if (beforeVolumeFilter !== finalFilteredKeywords.length) {
      console.log(
        `📉 搜索量过滤(保留纯品牌): ${beforeVolumeFilter} → ${finalFilteredKeywords.length}`
      )
    }
  } else if (hasAnyVolume && volumeUnavailable) {
    console.log('⚠️ 搜索量数据不可用（Planner 权限受限），跳过非纯品牌 0 搜索量关键词强制移除')
  }

  // 约束：最终关键词顺序始终前置纯品牌词，避免后续截断时品牌词被挤压
  finalFilteredKeywords = prioritizeBrandKeywordsFirst(
    finalFilteredKeywords,
    pureBrandKeywordsForFilter
  )

  console.log(`📝 最终过滤后关键词数: ${finalFilteredKeywords.length}`)
  await progress?.({ phase: 'filter', message: '关键词过滤完成' })

  // 5. 分离纯品牌词和非品牌词
  const keywordStrings = finalFilteredKeywords.map((kw) => kw.keyword)
  let { brandKeywords: brandKwStrings, nonBrandKeywords: nonBrandKwStrings } =
    separateBrandKeywords(keywordStrings, offer.brand)

  // ✅ 确保所有纯品牌词都被纳入（如 "dr mercola" + "mercola"）
  if (pureBrandKeywordsForFilter.length > 0) {
    const brandKwNormalized = new Set(
      brandKwStrings.map((k) => normalizeGoogleAdsKeyword(k)).filter(Boolean)
    )
    const missingPureBrands = pureBrandKeywordsForFilter.filter((kw) => {
      const normalized = normalizeGoogleAdsKeyword(kw)
      return normalized && !brandKwNormalized.has(normalized)
    })

    if (missingPureBrands.length > 0) {
      brandKwStrings.push(...missingPureBrands)
      const missingNormalized = new Set(
        missingPureBrands.map((k) => normalizeGoogleAdsKeyword(k)).filter(Boolean)
      )
      nonBrandKwStrings = nonBrandKwStrings.filter((k) => {
        const normalized = normalizeGoogleAdsKeyword(k)
        return normalized ? !missingNormalized.has(normalized) : true
      })
      console.log(`✅ 补充纯品牌词: ${missingPureBrands.join(', ')}`)
    }
  }

  // 🔧 防御性兜底：如果未识别到任何纯品牌词，强制注入标准化后的品牌词
  // 典型场景：Keyword Planner 不返回 seed 本身，且品牌含标点（如 "Dr. Mercola" → "dr mercola"）
  if (brandKwStrings.length === 0) {
    const canonicalBrand = normalizeGoogleAdsKeyword(offer.brand || '')
    if (canonicalBrand) {
      console.warn(`⚠️ 未识别到纯品牌词，自动注入: "${canonicalBrand}"`)
      brandKwStrings = [canonicalBrand]
      nonBrandKwStrings = nonBrandKwStrings.filter(
        (k) => normalizeGoogleAdsKeyword(k) !== canonicalBrand
      )
    }
  }

  // 转换回 PoolKeywordData[]
  let brandKeywordsData = finalFilteredKeywords.filter((kw) => brandKwStrings.includes(kw.keyword))
  let nonBrandKeywordsData = finalFilteredKeywords.filter((kw) =>
    nonBrandKwStrings.includes(kw.keyword)
  )

  // 如果注入的品牌词不在 finalFilteredKeywords 中，补一个最小元数据对象，保证 brand_keywords 不为空
  if (brandKeywordsData.length === 0 && brandKwStrings.length > 0) {
    brandKeywordsData = brandKwStrings.map((keyword) => ({
      keyword,
      searchVolume: 0,
      source: 'BRAND_SEED',
      matchType: 'EXACT' as const,
      isPureBrand: true,
    }))
  }

  // 🆕 聚类输入硬上限：按来源优先级 + 搜索量 选 Top N
  if (nonBrandKeywordsData.length > KEYWORD_CLUSTERING_INPUT_LIMIT) {
    const prioritized = prioritizeKeywordsForClustering(nonBrandKeywordsData)
    const capped = prioritized.slice(0, KEYWORD_CLUSTERING_INPUT_LIMIT)
    const cappedSet = new Set(capped.map((item) => item.keyword))
    nonBrandKeywordsData = nonBrandKeywordsData.filter((item) => cappedSet.has(item.keyword))
    nonBrandKwStrings = capped.map((item) => item.keyword)
    console.log(
      `✂️ 聚类输入裁剪: ${prioritized.length} → ${capped.length} (Top ${KEYWORD_CLUSTERING_INPUT_LIMIT} by source+volume)`
    )
  }

  // 🔧 强化：补齐/更新纯品牌词的真实搜索量（优先使用缓存/Keyword Planner）
  if (pureBrandKeywordsForFilter.length > 0) {
    const brandKeywordMap = new Map<string, PoolKeywordData>()
    for (const kw of brandKeywordsData) {
      const normalized = normalizeGoogleAdsKeyword(kw.keyword)
      if (!normalized) continue
      brandKeywordMap.set(normalized, kw)
    }

    const needsBrandVolume = pureBrandKeywordsForFilter.some((kw) => {
      const normalized = normalizeGoogleAdsKeyword(kw)
      if (!normalized) return false
      const existing = brandKeywordMap.get(normalized)
      return !existing || (existing.searchVolume || 0) === 0
    })

    if (needsBrandVolume) {
      try {
        await progress?.({ phase: 'seed-volume', message: '品牌词搜索量查询中' })
        const volumeProgress = progress
          ? (info: { message: string; current?: number; total?: number }) =>
              progress({
                phase: 'seed-volume',
                current: info.current,
                total: info.total,
                message: `品牌词搜索量 ${info.current ?? 0}/${info.total ?? 0}`,
              })
          : undefined
        const volumeResult = await getKeywordSearchVolumesForPlannerContext({
          userId,
          offerId,
          keywords: pureBrandKeywordsForFilter,
          country: offer.target_country,
          language: offer.target_language || 'en',
          plannerSession,
          onProgress: volumeProgress,
        })
        if (!volumeResult.ok) {
          throw new Error(volumeResult.message)
        }
        const volumes = volumeResult.volumes

        volumes.forEach((vol) => {
          const normalized = normalizeGoogleAdsKeyword(vol.keyword)
          if (!normalized) return
          const existing = brandKeywordMap.get(normalized)
          const nextVolume =
            vol.avgMonthlySearches > 0 ? vol.avgMonthlySearches : existing?.searchVolume || 0

          brandKeywordMap.set(normalized, {
            keyword: normalized,
            searchVolume: nextVolume,
            competition: vol.competition || existing?.competition || 'UNKNOWN',
            competitionIndex: vol.competitionIndex || existing?.competitionIndex || 0,
            lowTopPageBid: vol.lowTopPageBid || existing?.lowTopPageBid || 0,
            highTopPageBid: vol.highTopPageBid || existing?.highTopPageBid || 0,
            source: existing?.source || 'BRAND_SEED',
            matchType: 'EXACT',
            isPureBrand: true,
          })
        })
      } catch (error: any) {
        console.warn(`⚠️ 纯品牌词搜索量查询失败: ${error.message}`)
      }
    }

    // 确保缺失的纯品牌词也被注入（即使搜索量未知）
    for (const kw of pureBrandKeywordsForFilter) {
      const normalized = normalizeGoogleAdsKeyword(kw)
      if (!normalized) continue
      if (!brandKeywordMap.has(normalized)) {
        brandKeywordMap.set(normalized, {
          keyword: normalized,
          searchVolume: 0,
          source: 'BRAND_SEED',
          matchType: 'EXACT',
          isPureBrand: true,
        })
      }
    }

    brandKeywordsData = Array.from(brandKeywordMap.values())
  }

  // 🆕 v4.16: 确定页面类型
  console.log(`📊 页面类型: ${pageType}`)

  // 6. AI 语义聚类（传递国家和语言参数用于查询商品需求扩展词搜索量）
  // 🆕 v4.16: 传递 pageType 参数
  await progress?.({ phase: 'cluster', message: '语义聚类准备中' })
  const buckets = await clusterKeywordsByIntent(
    nonBrandKwStrings,
    offer.brand,
    offer.category,
    userId,
    offer.target_country, // 🔥 2025-12-23 新增：传递目标国家
    offer.target_language || 'en', // 🔥 2025-12-23 新增：传递目标语言
    pageType, // 🆕 v4.16: 传递页面类型
    progress
  )

  // 🆕 v4.16: 根据页面类型处理不同的桶结构
  if (pageType === 'store') {
    // 店铺链接：处理5个桶
    const storeBuckets = buckets as StoreKeywordBuckets

    // 7. 将 PoolKeywordData 映射到桶中
    // 🔧 修复(2026-01-21): 只保留在 nonBrandKeywordsData 中有搜索量数据的关键词
    const nonBrandMap = new Map<string, PoolKeywordData>()
    for (const k of nonBrandKeywordsData) {
      const key = normalizeGoogleAdsKeyword(k.keyword)
      if (!key) continue
      const existing = nonBrandMap.get(key)
      const existingVol = existing?.searchVolume || 0
      const currentVol = k.searchVolume || 0
      if (!existing || currentVol > existingVol) {
        nonBrandMap.set(key, k)
      }
    }

    const mapAndFilterKeywords = (kwList: string[]): PoolKeywordData[] => {
      const mapped = kwList
        .map((kw) => {
          const key = normalizeGoogleAdsKeyword(kw)
          return key ? nonBrandMap.get(key) : undefined
        })
        .filter((kw): kw is PoolKeywordData => kw !== undefined)
      return prioritizeBucketKeywords(mapped)
    }

    let storeBucketAData = mapAndFilterKeywords(storeBuckets.bucketA.keywords)
    let storeBucketBData = mapAndFilterKeywords(storeBuckets.bucketB.keywords)
    let storeBucketCData = mapAndFilterKeywords(storeBuckets.bucketC.keywords)
    let storeBucketDData = mapAndFilterKeywords(storeBuckets.bucketD.keywords)
    let storeBucketSData = mapAndFilterKeywords(storeBuckets.bucketS.keywords)
    const mappedStoreCount =
      storeBucketAData.length +
      storeBucketBData.length +
      storeBucketCData.length +
      storeBucketDData.length +
      storeBucketSData.length

    const storeUsedNorms = buildExistingKeywordNormSet([
      brandKeywordsData,
      storeBucketAData,
      storeBucketBData,
      storeBucketCData,
      storeBucketDData,
      storeBucketSData,
    ])
    storeBucketAData = appendVerifiedKeywordsToBucket({
      current: storeBucketAData,
      additions: verifiedSourceKeywords.TITLE_EXTRACT,
      usedNorms: storeUsedNorms,
    })
    storeBucketCData = appendVerifiedKeywordsToBucket({
      current: storeBucketCData,
      additions: [
        ...verifiedSourceKeywords.PARAM_EXTRACT,
        ...verifiedSourceKeywords.HOT_PRODUCT_AGGREGATE,
      ],
      usedNorms: storeUsedNorms,
    })
    storeBucketBData = appendVerifiedKeywordsToBucket({
      current: storeBucketBData,
      additions: verifiedSourceKeywords.ABOUT_EXTRACT,
      usedNorms: storeUsedNorms,
    })
    storeBucketSData = appendVerifiedKeywordsToBucket({
      current: storeBucketSData,
      additions: verifiedSourceKeywords.PAGE_EXTRACT,
      usedNorms: storeUsedNorms,
    })
    const verifiedStoreAdds =
      storeBucketAData.length +
      storeBucketBData.length +
      storeBucketCData.length +
      storeBucketDData.length +
      storeBucketSData.length -
      mappedStoreCount

    // 记录过滤掉的关键词数量
    const originalCount =
      storeBuckets.bucketA.keywords.length +
      storeBuckets.bucketB.keywords.length +
      storeBuckets.bucketC.keywords.length +
      storeBuckets.bucketD.keywords.length +
      storeBuckets.bucketS.keywords.length
    const filteredCount = mappedStoreCount
    if (originalCount !== filteredCount) {
      console.log(
        `ℹ️ 店铺关键词映射过滤: ${originalCount} → ${filteredCount} (过滤掉 ${originalCount - filteredCount} 个无搜索量数据的关键词)`
      )
    }
    if (verifiedStoreAdds > 0) {
      console.log(
        `🧩 店铺真实来源补词: +${verifiedStoreAdds} (title:${verifiedSourceKeywords.TITLE_EXTRACT.length}, about:${verifiedSourceKeywords.ABOUT_EXTRACT.length}, param:${verifiedSourceKeywords.PARAM_EXTRACT.length}, hot:${verifiedSourceKeywords.HOT_PRODUCT_AGGREGATE.length}, page:${verifiedSourceKeywords.PAGE_EXTRACT.length})`
      )
    }

    const storeBucketMinRetainAdds = ensureMinimumBucketKeywords({
      bucketEntries: [
        { name: 'A', keywords: storeBucketAData },
        { name: 'B', keywords: storeBucketBData },
        { name: 'C', keywords: storeBucketCData },
        { name: 'D', keywords: storeBucketDData },
        { name: 'S', keywords: storeBucketSData },
      ],
      reserveKeywords: nonBrandKeywordsData,
      minPerBucket: MIN_NON_BRAND_KEYWORDS_PER_STORE_BUCKET,
    })
    const totalStoreRetainAdds = Object.values(storeBucketMinRetainAdds).reduce(
      (sum, value) => sum + value,
      0
    )
    if (totalStoreRetainAdds > 0) {
      console.log(
        `🛟 店铺桶最小保留补齐: +${totalStoreRetainAdds} (A:${storeBucketMinRetainAdds.A || 0}, B:${storeBucketMinRetainAdds.B || 0}, C:${storeBucketMinRetainAdds.C || 0}, D:${storeBucketMinRetainAdds.D || 0}, S:${storeBucketMinRetainAdds.S || 0})`
      )
    }

    // 8. 补充品牌全局核心关键词（不破坏原流程）
    const injectedStore = await injectGlobalCoreKeywordsForStore({
      offer,
      userId,
      brandKeywords: brandKeywordsData,
      storeBuckets,
      bucketAData: storeBucketAData,
      bucketBData: storeBucketBData,
      bucketCData: storeBucketCData,
      bucketDData: storeBucketDData,
      bucketSData: storeBucketSData,
    })

    storeBucketAData = injectedStore.bucketAData
    storeBucketBData = injectedStore.bucketBData
    storeBucketCData = injectedStore.bucketCData
    storeBucketDData = injectedStore.bucketDData
    storeBucketSData = injectedStore.bucketSData

    // 9. 保存到数据库（包含店铺分桶）
    await progress?.({ phase: 'save', message: '保存关键词池' })
    const pool = await saveKeywordPoolWithData(
      offerId,
      userId,
      brandKeywordsData,
      {
        bucketA: { intent: storeBuckets.bucketA.intent, keywords: storeBucketAData },
        bucketB: { intent: storeBuckets.bucketB.intent, keywords: storeBucketBData },
        bucketC: { intent: storeBuckets.bucketC.intent, keywords: storeBucketCData },
        bucketD: { intent: storeBuckets.bucketD.intent, keywords: storeBucketDData },
        statistics: storeBuckets.statistics,
      },
      pageType, // 🆕 v4.16: 传递页面类型
      storeBuckets, // 🆕 v4.16: 传递店铺桶数据
      {
        bucketA: storeBucketAData,
        bucketB: storeBucketBData,
        bucketC: storeBucketCData,
        bucketD: storeBucketDData,
        bucketS: storeBucketSData,
      }
    )

    return pool
  } else {
    // 产品链接：处理4个桶（原逻辑）
    const productBuckets = buckets as KeywordBuckets

    // 7. 将 PoolKeywordData 映射到桶中
    // 🔧 修复(2026-01-21): 只保留在 nonBrandKeywordsData 中有搜索量数据的关键词
    // 避免保留 AI 生成但无真实搜索量的模板化关键词
    const nonBrandMap = new Map<string, PoolKeywordData>()
    for (const k of nonBrandKeywordsData) {
      const key = normalizeGoogleAdsKeyword(k.keyword)
      if (!key) continue
      const existing = nonBrandMap.get(key)
      const existingVol = existing?.searchVolume || 0
      const currentVol = k.searchVolume || 0
      if (!existing || currentVol > existingVol) {
        nonBrandMap.set(key, k)
      }
    }

    const mapAndFilterKeywords = (kwList: string[]): PoolKeywordData[] => {
      const mapped = kwList
        .map((kw) => {
          const key = normalizeGoogleAdsKeyword(kw)
          return key ? nonBrandMap.get(key) : undefined
        })
        .filter((kw): kw is PoolKeywordData => kw !== undefined)
      return prioritizeBucketKeywords(mapped)
    }

    let bucketAData = mapAndFilterKeywords(productBuckets.bucketA.keywords)
    let bucketBData = mapAndFilterKeywords(productBuckets.bucketB.keywords)
    let bucketCData = mapAndFilterKeywords(productBuckets.bucketC.keywords)
    let bucketDData = mapAndFilterKeywords(productBuckets.bucketD.keywords)
    const mappedProductCount =
      bucketAData.length + bucketBData.length + bucketCData.length + bucketDData.length

    const productUsedNorms = buildExistingKeywordNormSet([
      brandKeywordsData,
      bucketAData,
      bucketBData,
      bucketCData,
      bucketDData,
    ])
    bucketAData = appendVerifiedKeywordsToBucket({
      current: bucketAData,
      additions: verifiedSourceKeywords.TITLE_EXTRACT,
      usedNorms: productUsedNorms,
    })
    bucketCData = appendVerifiedKeywordsToBucket({
      current: bucketCData,
      additions: [
        ...verifiedSourceKeywords.PARAM_EXTRACT,
        ...verifiedSourceKeywords.HOT_PRODUCT_AGGREGATE,
      ],
      usedNorms: productUsedNorms,
    })
    bucketBData = appendVerifiedKeywordsToBucket({
      current: bucketBData,
      additions: verifiedSourceKeywords.ABOUT_EXTRACT,
      usedNorms: productUsedNorms,
    })
    bucketDData = appendVerifiedKeywordsToBucket({
      current: bucketDData,
      additions: verifiedSourceKeywords.PAGE_EXTRACT,
      usedNorms: productUsedNorms,
    })
    const verifiedProductAdds =
      bucketAData.length +
      bucketBData.length +
      bucketCData.length +
      bucketDData.length -
      mappedProductCount

    // 记录过滤掉的关键词数量
    const originalCount =
      productBuckets.bucketA.keywords.length +
      productBuckets.bucketB.keywords.length +
      productBuckets.bucketC.keywords.length +
      productBuckets.bucketD.keywords.length
    const filteredCount = mappedProductCount
    if (originalCount !== filteredCount) {
      console.log(
        `ℹ️ 关键词映射过滤: ${originalCount} → ${filteredCount} (过滤掉 ${originalCount - filteredCount} 个无搜索量数据的关键词)`
      )
    }
    if (verifiedProductAdds > 0) {
      console.log(
        `🧩 产品真实来源补词: +${verifiedProductAdds} (title:${verifiedSourceKeywords.TITLE_EXTRACT.length}, about:${verifiedSourceKeywords.ABOUT_EXTRACT.length}, param:${verifiedSourceKeywords.PARAM_EXTRACT.length}, hot:${verifiedSourceKeywords.HOT_PRODUCT_AGGREGATE.length}, page:${verifiedSourceKeywords.PAGE_EXTRACT.length})`
      )
    }

    const productBucketMinRetainAdds = ensureMinimumBucketKeywords({
      bucketEntries: [
        { name: 'A', keywords: bucketAData },
        { name: 'B', keywords: bucketBData },
        { name: 'C', keywords: bucketCData },
        { name: 'D', keywords: bucketDData },
      ],
      reserveKeywords: nonBrandKeywordsData,
      minPerBucket: MIN_NON_BRAND_KEYWORDS_PER_PRODUCT_BUCKET,
    })
    const totalProductRetainAdds = Object.values(productBucketMinRetainAdds).reduce(
      (sum, value) => sum + value,
      0
    )
    if (totalProductRetainAdds > 0) {
      console.log(
        `🛟 产品桶最小保留补齐: +${totalProductRetainAdds} (A:${productBucketMinRetainAdds.A || 0}, B:${productBucketMinRetainAdds.B || 0}, C:${productBucketMinRetainAdds.C || 0}, D:${productBucketMinRetainAdds.D || 0})`
      )
    }

    // 8. 补充品牌全局核心关键词（不破坏原流程）
    const injectedProduct = await injectGlobalCoreKeywordsForProduct({
      offer,
      userId,
      brandKeywords: brandKeywordsData,
      bucketAData,
      bucketBData,
      bucketCData,
      bucketDData,
      statistics: productBuckets.statistics,
    })

    bucketAData = injectedProduct.bucketAData
    bucketBData = injectedProduct.bucketBData
    bucketCData = injectedProduct.bucketCData
    bucketDData = injectedProduct.bucketDData

    // 9. 保存到数据库
    await progress?.({ phase: 'save', message: '保存关键词池' })
    const pool = await saveKeywordPoolWithData(
      offerId,
      userId,
      brandKeywordsData,
      {
        bucketA: { intent: productBuckets.bucketA.intent, keywords: bucketAData },
        bucketB: { intent: productBuckets.bucketB.intent, keywords: bucketBData },
        bucketC: { intent: productBuckets.bucketC.intent, keywords: bucketCData },
        bucketD: { intent: productBuckets.bucketD.intent, keywords: bucketDData },
        statistics: injectedProduct.statistics,
      },
      pageType // 🆕 v4.16: 传递页面类型
    )

    return pool
  }
}

/**
 * 获取或创建关键词池
 *
 * @param offerId - Offer ID
 * @param userId - 用户 ID
 * @param forceRegenerate - 是否强制重新生成
 * @returns 关键词池
 */
export async function getOrCreateKeywordPool(
  offerId: number,
  userId: number,
  forceRegenerate: boolean = false,
  progress?: KeywordPoolProgressReporter,
  preparedExpand?: KeywordPoolExpandLoadResult
): Promise<OfferKeywordPool> {
  // 检查现有池
  if (!forceRegenerate) {
    const existing = await getKeywordPoolByOfferId(offerId)
    if (existing) {
      console.log(`✅ 使用现有关键词池: Offer #${offerId}`)
      return existing
    }
  }

  // 生成新池
  return generateOfferKeywordPool(offerId, userId, undefined, progress, preparedExpand)
}

/**
 * 创意生成前解析关键词池：单次 prepare，建池时复用；池已存在则不再在池内 prepare。
 */
export async function resolveKeywordPoolForCreativeGeneration(
  offerId: number,
  userId: number,
  options?: {
    forceRegenerate?: boolean
    progress?: KeywordPoolProgressReporter
  }
): Promise<{
  pool: OfferKeywordPool
  plannerSession?: KeywordPlannerPreparedSession
  preparedExpand?: KeywordPoolPreparedExpand
}> {
  const expandLoad = await loadKeywordPoolExpandCredentialsForOffer(userId, offerId)
  const preparedExpand = expandLoad.ok ? expandLoad : undefined
  const plannerSession = preparedExpand?.plannerSession

  if (!options?.forceRegenerate) {
    const existing = await getKeywordPoolByOfferId(offerId)
    if (existing) {
      return { pool: existing, plannerSession, preparedExpand }
    }
  }

  const pool = await generateOfferKeywordPool(
    offerId,
    userId,
    undefined,
    options?.progress,
    preparedExpand
  )
  return { pool, plannerSession, preparedExpand }
}

type PromoteKeywordInput = {
  text?: string
  keyword?: string
  matchType?: string
  searchVolume?: number
}

type PromoteKeywordsToOfferKeywordPoolResult = {
  promotedCount: number
  skippedCount: number
  poolCreated: boolean
  poolUpdated: boolean
}

const PROMOTED_KEYWORD_PLATFORM_PATTERN = /\b(amazon|walmart|ebay|etsy|aliexpress|temu|shopee)\b/i
const PROMOTED_KEYWORD_INFO_QUERY_PATTERN =
  /\b(what is|meaning|tutorial|guide|manual|how to|instructions?)\b/i
const PROMOTED_KEYWORD_COMPARE_PATTERN = /\b(review|reviews|comparison|compare|vs|versus)\b/i

function normalizePromotionKeywordMatchType(
  rawMatchType: unknown,
  keyword: string,
  pureBrandKeywords: string[]
): 'EXACT' | 'PHRASE' | 'BROAD' {
  const normalized = String(rawMatchType || '')
    .trim()
    .toUpperCase()
  if (normalized === 'EXACT' || normalized === 'PHRASE' || normalized === 'BROAD') {
    return normalized as 'EXACT' | 'PHRASE' | 'BROAD'
  }
  return inferDefaultKeywordMatchType(keyword, pureBrandKeywords)
}

export async function promoteKeywordsToOfferKeywordPool(params: {
  offerId: number
  userId: number
  keywords: PromoteKeywordInput[]
  source?: string
  sourceType?: string
  sourceSubtype?: string
  rawSource?: string
  reason?: string
}): Promise<PromoteKeywordsToOfferKeywordPoolResult> {
  const source =
    String(params.source || 'SEARCH_TERM')
      .trim()
      .toUpperCase() || 'SEARCH_TERM'
  const sourceType =
    String(params.sourceType || source)
      .trim()
      .toUpperCase() || source
  const sourceSubtype =
    String(params.sourceSubtype || sourceType)
      .trim()
      .toUpperCase() || sourceType
  const rawSource =
    String(params.rawSource || source)
      .trim()
      .toUpperCase() || source

  if (!Array.isArray(params.keywords) || params.keywords.length === 0) {
    return { promotedCount: 0, skippedCount: 0, poolCreated: false, poolUpdated: false }
  }

  const offer = await findOfferById(params.offerId, params.userId)
  if (!offer) {
    return {
      promotedCount: 0,
      skippedCount: params.keywords.length,
      poolCreated: false,
      poolUpdated: false,
    }
  }

  const pageType = resolveOfferPageType(offer)
  const pureBrandKeywords = getPureBrandKeywords(offer.brand || '')
  const seen = new Set<string>()
  const promotedCandidates: PoolKeywordData[] = []
  let skippedCount = 0

  for (const item of params.keywords) {
    const rawText = String(item?.text || item?.keyword || '').trim()
    const normalizedKeyword = normalizeGoogleAdsKeyword(rawText)
    if (!normalizedKeyword) {
      skippedCount += 1
      continue
    }
    if (seen.has(normalizedKeyword)) continue
    seen.add(normalizedKeyword)

    if (normalizedKeyword.length < 2 || normalizedKeyword.length > 80) {
      skippedCount += 1
      continue
    }
    if (isInvalidKeyword(normalizedKeyword)) {
      skippedCount += 1
      continue
    }
    if (PROMOTED_KEYWORD_PLATFORM_PATTERN.test(normalizedKeyword)) {
      skippedCount += 1
      continue
    }
    if (PROMOTED_KEYWORD_INFO_QUERY_PATTERN.test(normalizedKeyword)) {
      skippedCount += 1
      continue
    }
    if (PROMOTED_KEYWORD_COMPARE_PATTERN.test(normalizedKeyword)) {
      skippedCount += 1
      continue
    }
    if (pureBrandKeywords.length > 0 && !containsPureBrand(normalizedKeyword, pureBrandKeywords)) {
      skippedCount += 1
      continue
    }

    promotedCandidates.push({
      keyword: normalizedKeyword,
      searchVolume: Math.max(0, Number(item?.searchVolume || 0) || 0),
      source,
      sourceType,
      sourceSubtype,
      rawSource,
      matchType: normalizePromotionKeywordMatchType(
        item?.matchType,
        normalizedKeyword,
        pureBrandKeywords
      ),
      isPureBrand: isPureBrandKeyword(normalizedKeyword, pureBrandKeywords),
      derivedTags: ['STRATEGY_PROMOTED'],
    })
  }

  if (promotedCandidates.length === 0) {
    return { promotedCount: 0, skippedCount, poolCreated: false, poolUpdated: false }
  }

  const bucketAdds = {
    brand: [] as PoolKeywordData[],
    productA: [] as PoolKeywordData[],
    productB: [] as PoolKeywordData[],
    productC: [] as PoolKeywordData[],
    productD: [] as PoolKeywordData[],
    storeA: [] as PoolKeywordData[],
    storeB: [] as PoolKeywordData[],
    storeC: [] as PoolKeywordData[],
    storeD: [] as PoolKeywordData[],
    storeS: [] as PoolKeywordData[],
  }

  for (const candidate of promotedCandidates) {
    if (candidate.isPureBrand) {
      bucketAdds.brand.push(candidate)
      continue
    }

    const productBucket = selectBucketForProduct(candidate.keyword)
    if (productBucket === 'A') bucketAdds.productA.push(candidate)
    else if (productBucket === 'B') bucketAdds.productB.push(candidate)
    else if (productBucket === 'C') bucketAdds.productC.push(candidate)
    else bucketAdds.productD.push(candidate)

    const storeBucket = selectBucketForStore(candidate.keyword)
    if (storeBucket === 'A') bucketAdds.storeA.push(candidate)
    else if (storeBucket === 'B') bucketAdds.storeB.push(candidate)
    else if (storeBucket === 'C') bucketAdds.storeC.push(candidate)
    else if (storeBucket === 'D') bucketAdds.storeD.push(candidate)
    else bucketAdds.storeS.push(candidate)
  }

  const existing = await getKeywordPoolByOfferId(params.offerId)
  if (!existing) {
    const brandKeywords = mergeKeywordDataLists([bucketAdds.brand])
    const bucketAKeywords = mergeKeywordDataLists([bucketAdds.productA])
    const bucketBKeywords = mergeKeywordDataLists([bucketAdds.productB])
    const bucketCKeywords = mergeKeywordDataLists([bucketAdds.productC])
    const bucketDKeywords = mergeKeywordDataLists([bucketAdds.productD])

    const storeBucketAKeywords = mergeKeywordDataLists([bucketAdds.storeA])
    const storeBucketBKeywords = mergeKeywordDataLists([bucketAdds.storeB])
    const storeBucketCKeywords = mergeKeywordDataLists([bucketAdds.storeC])
    const storeBucketDKeywords = mergeKeywordDataLists([bucketAdds.storeD])
    const storeBucketSKeywords = mergeKeywordDataLists([bucketAdds.storeS])

    const storeBuckets: StoreKeywordBuckets = {
      bucketA: {
        ...DEFAULT_STORE_CLUSTER_BUCKETS.A,
        keywords: storeBucketAKeywords.map((item) => item.keyword),
      },
      bucketB: {
        ...DEFAULT_STORE_CLUSTER_BUCKETS.B,
        keywords: storeBucketBKeywords.map((item) => item.keyword),
      },
      bucketC: {
        ...DEFAULT_STORE_CLUSTER_BUCKETS.C,
        keywords: storeBucketCKeywords.map((item) => item.keyword),
      },
      bucketD: {
        ...DEFAULT_STORE_CLUSTER_BUCKETS.D,
        keywords: storeBucketDKeywords.map((item) => item.keyword),
      },
      bucketS: {
        ...DEFAULT_STORE_CLUSTER_BUCKETS.S,
        keywords: storeBucketSKeywords.map((item) => item.keyword),
      },
      statistics: {
        totalKeywords:
          storeBucketAKeywords.length +
          storeBucketBKeywords.length +
          storeBucketCKeywords.length +
          storeBucketDKeywords.length +
          storeBucketSKeywords.length,
        bucketACount: storeBucketAKeywords.length,
        bucketBCount: storeBucketBKeywords.length,
        bucketCCount: storeBucketCKeywords.length,
        bucketDCount: storeBucketDKeywords.length,
        bucketSCount: storeBucketSKeywords.length,
        balanceScore: calculateBalanceScore([
          storeBucketAKeywords.length,
          storeBucketBKeywords.length,
          storeBucketCKeywords.length,
          storeBucketDKeywords.length,
          storeBucketSKeywords.length,
        ]),
      },
    }

    await saveKeywordPoolWithData(
      params.offerId,
      params.userId,
      brandKeywords,
      {
        bucketA: { intent: DEFAULT_PRODUCT_CLUSTER_BUCKETS.A.intent, keywords: bucketAKeywords },
        bucketB: { intent: DEFAULT_PRODUCT_CLUSTER_BUCKETS.B.intent, keywords: bucketBKeywords },
        bucketC: { intent: DEFAULT_PRODUCT_CLUSTER_BUCKETS.C.intent, keywords: bucketCKeywords },
        bucketD: { intent: DEFAULT_PRODUCT_CLUSTER_BUCKETS.D.intent, keywords: bucketDKeywords },
        statistics: {
          totalKeywords:
            brandKeywords.length +
            bucketAKeywords.length +
            bucketBKeywords.length +
            bucketCKeywords.length +
            bucketDKeywords.length,
          balanceScore: calculateBalanceScore([
            bucketAKeywords.length,
            bucketBKeywords.length,
            bucketCKeywords.length,
            bucketDKeywords.length,
          ]),
        },
      },
      pageType,
      storeBuckets,
      {
        bucketA: storeBucketAKeywords,
        bucketB: storeBucketBKeywords,
        bucketC: storeBucketCKeywords,
        bucketD: storeBucketDKeywords,
        bucketS: storeBucketSKeywords,
      }
    )

    console.log(
      `[KeywordPoolPromotion] offer=${params.offerId} created=true promoted=${promotedCandidates.length} skipped=${skippedCount} reason=${params.reason || 'campaign_keywords_add'}`
    )
    return {
      promotedCount: promotedCandidates.length,
      skippedCount,
      poolCreated: true,
      poolUpdated: false,
    }
  }

  const nextBrandKeywords = mergeKeywordDataLists([existing.brandKeywords, bucketAdds.brand])
  const nextBucketAKeywords = mergeKeywordDataLists([existing.bucketAKeywords, bucketAdds.productA])
  const nextBucketBKeywords = mergeKeywordDataLists([existing.bucketBKeywords, bucketAdds.productB])
  const nextBucketCKeywords = mergeKeywordDataLists([existing.bucketCKeywords, bucketAdds.productC])
  const nextBucketDKeywords = mergeKeywordDataLists([existing.bucketDKeywords, bucketAdds.productD])
  const nextStoreBucketAKeywords = mergeKeywordDataLists([
    existing.storeBucketAKeywords,
    bucketAdds.storeA,
  ])
  const nextStoreBucketBKeywords = mergeKeywordDataLists([
    existing.storeBucketBKeywords,
    bucketAdds.storeB,
  ])
  const nextStoreBucketCKeywords = mergeKeywordDataLists([
    existing.storeBucketCKeywords,
    bucketAdds.storeC,
  ])
  const nextStoreBucketDKeywords = mergeKeywordDataLists([
    existing.storeBucketDKeywords,
    bucketAdds.storeD,
  ])
  const nextStoreBucketSKeywords = mergeKeywordDataLists([
    existing.storeBucketSKeywords,
    bucketAdds.storeS,
  ])
  const nextTotalKeywords =
    nextBrandKeywords.length +
    nextBucketAKeywords.length +
    nextBucketBKeywords.length +
    nextBucketCKeywords.length +
    nextBucketDKeywords.length
  const nextBalanceScore = calculateBalanceScore([
    nextBucketAKeywords.length,
    nextBucketBKeywords.length,
    nextBucketCKeywords.length,
    nextBucketDKeywords.length,
  ])

  const db = await getDatabase()
  await db.exec(
    `
      UPDATE offer_keyword_pools
      SET brand_keywords = ?,
          bucket_a_keywords = ?,
          bucket_b_keywords = ?,
          bucket_c_keywords = ?,
          bucket_d_keywords = ?,
          store_bucket_a_keywords = ?,
          store_bucket_b_keywords = ?,
          store_bucket_c_keywords = ?,
          store_bucket_d_keywords = ?,
          store_bucket_s_keywords = ?,
          total_keywords = ?,
          balance_score = ?,
          updated_at = ${'NOW()'}
      WHERE offer_id = ?
        AND user_id = ?
    `,
    [
      serializeKeywordArrayForDb(nextBrandKeywords),
      serializeKeywordArrayForDb(nextBucketAKeywords),
      serializeKeywordArrayForDb(nextBucketBKeywords),
      serializeKeywordArrayForDb(nextBucketCKeywords),
      serializeKeywordArrayForDb(nextBucketDKeywords),
      serializeKeywordArrayForDb(nextStoreBucketAKeywords),
      serializeKeywordArrayForDb(nextStoreBucketBKeywords),
      serializeKeywordArrayForDb(nextStoreBucketCKeywords),
      serializeKeywordArrayForDb(nextStoreBucketDKeywords),
      serializeKeywordArrayForDb(nextStoreBucketSKeywords),
      nextTotalKeywords,
      nextBalanceScore,
      params.offerId,
      params.userId,
    ]
  )

  console.log(
    `[KeywordPoolPromotion] offer=${params.offerId} created=false promoted=${promotedCandidates.length} skipped=${skippedCount} reason=${params.reason || 'campaign_keywords_add'}`
  )
  return {
    promotedCount: promotedCandidates.length,
    skippedCount,
    poolCreated: false,
    poolUpdated: true,
  }
}

/**
 * 从 Offer 现有数据提取关键词
 * 🔥 2025-12-16升级：返回 PoolKeywordData[]，保留完整元数据
 */
async function extractKeywordsFromOffer(
  offerId: number,
  userId: number,
  progress?: KeywordPoolProgressReporter,
  plannerSession?: KeywordPlannerPreparedSession
): Promise<PoolKeywordData[]> {
  const db = await getDatabase()
  const offerBrandRow = await db.queryOne<{ brand: string | null }>(
    'SELECT brand FROM offers WHERE id = ? AND user_id = ?',
    [offerId, userId]
  )
  const pureBrandKeywords = getPureBrandKeywords(offerBrandRow?.brand || '')
  const keywordMap = new Map<string, PoolKeywordData>()

  const normalizeKeywordMatchType = (
    rawMatchType: unknown,
    keyword: string
  ): 'EXACT' | 'PHRASE' | 'BROAD' => {
    const normalized = typeof rawMatchType === 'string' ? rawMatchType.trim().toUpperCase() : ''
    if (normalized === 'EXACT' || normalized === 'PHRASE' || normalized === 'BROAD') {
      return normalized as 'EXACT' | 'PHRASE' | 'BROAD'
    }
    return inferDefaultKeywordMatchType(keyword, pureBrandKeywords)
  }

  const addKeywordData = (kw: PoolKeywordData) => {
    const keyword = kw?.keyword?.trim()
    if (!keyword) return
    if (keywordMap.has(keyword)) return
    keywordMap.set(keyword, kw)
  }

  const addKeywordString = (keyword: string, source: string) => {
    const normalized = keyword?.trim()
    if (!normalized) return
    // 🔒 关键词质量校验（2026-01-26）：过滤无效关键词
    if (isInvalidKeyword(normalized)) {
      console.warn(
        `[extractKeywordsFromOffer] ⚠️ 过滤无效关键词: "${normalized}" (source: ${source})`
      )
      return
    }
    addKeywordData({
      keyword: normalized,
      searchVolume: 0,
      source,
      matchType: inferDefaultKeywordMatchType(normalized, pureBrandKeywords),
    })
  }

  const addKeywordsFromJson = (raw: unknown, source: string) => {
    if (raw == null) return

    let parsed: unknown = raw
    if (typeof raw === 'string') {
      if (raw.trim() === '') return
      try {
        parsed = JSON.parse(raw)
      } catch {
        return
      }
    }

    if (!Array.isArray(parsed)) return

    for (const item of parsed) {
      if (typeof item === 'string') {
        addKeywordString(item, source)
        continue
      }
      if (item && typeof item === 'object') {
        const keyword = (item as any).keyword || (item as any).text
        if (typeof keyword === 'string') {
          // 🔒 关键词质量校验（2026-01-26）
          if (isInvalidKeyword(keyword)) {
            console.warn(
              `[extractKeywordsFromOffer] ⚠️ 过滤无效关键词: "${keyword}" (source: ${source})`
            )
            continue
          }
          addKeywordData({
            keyword,
            searchVolume: Number((item as any).searchVolume || (item as any).volume || 0) || 0,
            competition:
              typeof (item as any).competition === 'string' ? (item as any).competition : undefined,
            competitionIndex:
              typeof (item as any).competitionIndex === 'number'
                ? (item as any).competitionIndex
                : undefined,
            lowTopPageBid:
              typeof (item as any).lowTopPageBid === 'number'
                ? (item as any).lowTopPageBid
                : undefined,
            highTopPageBid:
              typeof (item as any).highTopPageBid === 'number'
                ? (item as any).highTopPageBid
                : undefined,
            source,
            matchType: normalizeKeywordMatchType((item as any).matchType, keyword),
          })
        }
      }
    }
  }

  // 从现有创意中提取关键词
  const creatives = await db.query<{ keywords: string }>(
    `SELECT keywords FROM ad_creatives
     WHERE offer_id = ? AND user_id = ?
     ORDER BY created_at DESC
     LIMIT 3`,
    [offerId, userId]
  )

  for (const creative of creatives) {
    if (creative.keywords) {
      try {
        const keywords = JSON.parse(creative.keywords)
        if (Array.isArray(keywords)) {
          keywords.forEach((kw: any) => {
            const kwStr = typeof kw === 'string' ? kw : kw.keyword
            if (kwStr && !keywordMap.has(kwStr)) {
              keywordMap.set(kwStr, {
                keyword: kwStr,
                searchVolume: typeof kw === 'object' ? kw.searchVolume || 0 : 0,
                competition: typeof kw === 'object' ? kw.competition : undefined,
                competitionIndex: typeof kw === 'object' ? kw.competitionIndex : undefined,
                lowTopPageBid: typeof kw === 'object' ? kw.lowTopPageBid : undefined,
                highTopPageBid: typeof kw === 'object' ? kw.highTopPageBid : undefined,
                source: 'CREATIVE',
                matchType: normalizeKeywordMatchType(
                  typeof kw === 'object' ? kw.matchType : undefined,
                  kwStr
                ),
              })
            }
          })
        }
      } catch {}
    }
  }

  // 如果没有创意关键词，从 AI 分析结果提取
  if (keywordMap.size === 0) {
    const offer = await db.queryOne<{
      ai_keywords: string | null
      extracted_keywords: string | null
      brand: string | null
      category: string | null
      product_name: string | null
      product_highlights: string | null
      unique_selling_points: string | null
      review_analysis: string | null
      brand_analysis: string | null
      scraped_data: string | null
      page_type: string | null
    }>(
      `SELECT
        ai_keywords,
        extracted_keywords,
        brand,
        category,
        product_name,
        product_highlights,
        unique_selling_points,
        review_analysis,
        brand_analysis,
        scraped_data,
        page_type
      FROM offers
      WHERE id = ? AND user_id = ?`,
      [offerId, userId]
    )

    // 先解析 ai_keywords；如果为空数组，再尝试 extracted_keywords
    addKeywordsFromJson(offer?.ai_keywords, 'OFFER_AI_KEYWORDS')
    addKeywordsFromJson(offer?.extracted_keywords, 'OFFER_EXTRACTED_KEYWORDS')

    // 兜底：某些页面类型（尤其店铺页/抓取降级）可能出现 ai_keywords='[]' 且 extracted_keywords=NULL
    // 这种情况下用“真实已抓取”的结构化字段构建最小种子词，避免整个创意生成流程被阻断。
    if (keywordMap.size === 0 && offer?.brand) {
      console.warn(
        `[extractKeywordsFromOffer] Offer #${offerId} 无AI/提取关键词，使用兜底种子词生成 (pageType=${resolveOfferPageType(offer)})`
      )

      // 1) 品牌词（保证至少有一个关键词）
      addKeywordString(offer.brand, 'FALLBACK_BRAND')

      // 2) 产品名 / 品类（来自抓取结果）
      if (offer.product_name && offer.product_name !== offer.brand) {
        addKeywordString(
          `${offer.brand} ${offer.product_name}`.slice(0, 80),
          'FALLBACK_PRODUCT_NAME'
        )
      }
      if (offer.category) {
        addKeywordString(`${offer.brand} ${offer.category}`.slice(0, 80), 'FALLBACK_CATEGORY')
      }

      // 3) 尝试复用统一关键词服务的“意图感知种子词”构建逻辑（仅在兜底路径加载）
      try {
        const { buildIntentAwareSeedPool } = await import('../server')
        const seedPool = buildIntentAwareSeedPool({
          brand: offer.brand,
          category: offer.category,
          productTitle: offer.product_name || undefined,
          productFeatures: offer.product_highlights || offer.unique_selling_points || undefined,
          scrapedData: offer.scraped_data || undefined,
          reviewAnalysis: offer.review_analysis || undefined,
          brandAnalysis: offer.brand_analysis || undefined,
        })

        seedPool.allSeeds
          .slice(0, 50)
          .forEach((seed) => addKeywordString(seed, 'FALLBACK_INTENT_SEEDS'))
      } catch (seedError: any) {
        console.warn(
          `[extractKeywordsFromOffer] 兜底种子词构建失败: ${seedError?.message || seedError}`
        )
      }
    }
  }

  const keywords = Array.from(keywordMap.values())

  // 🔧 修复(2026-01-21): 查询提取关键词的搜索量
  if (keywords.length > 0) {
    console.log(`📊 查询 ${keywords.length} 个提取关键词的搜索量...`)
    await progress?.({ phase: 'seed-volume', message: `初始关键词搜索量查询中` })

    try {
      // 获取 offer 信息（用于获取 target_country 和 target_language）
      const offer = await db.queryOne<{
        target_country: string
        target_language: string | null
      }>('SELECT target_country, target_language FROM offers WHERE id = ? AND user_id = ?', [
        offerId,
        userId,
      ])

      if (offer) {
        const volumeProgress = progress
          ? (info: { message: string; current?: number; total?: number }) =>
              progress({
                phase: 'seed-volume',
                current: info.current,
                total: info.total,
                message: `初始关键词搜索量 ${info.current ?? 0}/${info.total ?? 0}`,
              })
          : undefined

        const volumeResult = await getKeywordSearchVolumesForPlannerContext({
          userId,
          offerId,
          keywords: keywords.map((k) => k.keyword),
          country: offer.target_country,
          language: offer.target_language || 'en',
          plannerSession,
          onProgress: volumeProgress,
        })
        if (!volumeResult.ok) {
          throw new Error(volumeResult.message)
        }
        const volumes = volumeResult.volumes

        // 更新搜索量
        const volumeMap = new Map(volumes.map((v) => [v.keyword.toLowerCase(), v]))
        for (const kw of keywords) {
          const volume = volumeMap.get(kw.keyword.toLowerCase())
          if (volume) {
            kw.searchVolume = volume.avgMonthlySearches || 0
            kw.competition = volume.competition
            kw.competitionIndex = volume.competitionIndex
            kw.lowTopPageBid = volume.lowTopPageBid
            kw.highTopPageBid = volume.highTopPageBid
          }
        }

        const withVolume = keywords.filter((k) => k.searchVolume > 0).length
        console.log(`✅ 搜索量查询完成: ${withVolume}/${keywords.length} 个关键词有搜索量`)
      }
    } catch (error) {
      console.warn(`⚠️ 查询搜索量失败: ${error}`)
      // 降级处理：保留原有的 searchVolume: 0
    }
  }

  return keywords
}

// ============================================
// 创意生成辅助
// ============================================

function getKeywordPoolBucketMeta(
  slot: CreativeBucketSlot,
  isStore: boolean
): { intent: string; intentEn: string } {
  if (slot === 'A') {
    return { intent: '品牌意图', intentEn: 'Brand Intent' }
  }
  if (slot === 'B') {
    return {
      intent: isStore ? '热门商品型号/产品族意图' : '商品型号/产品族意图',
      intentEn: isStore ? 'Store Model Intent' : 'Model Intent',
    }
  }
  return { intent: '商品需求意图', intentEn: 'Product Demand Intent' }
}

/**
 * 获取桶的关键词和意图信息
 *
 * @param pool - 关键词池
 * @param bucket - 桶类型
 * @returns 桶信息
 */
export function getBucketInfo(
  pool: OfferKeywordPool,
  bucket: BucketType
): { keywords: PoolKeywordData[]; intent: string; intentEn: string } {
  const slot = normalizeKeywordPoolBucketQuery(bucket)
  if (!slot) {
    throw new Error(`Invalid bucket type: ${bucket}`)
  }

  const linkType = pool.linkType === 'store' ? 'store' : 'product'
  const isStore = linkType === 'store'
  const meta = getKeywordPoolBucketMeta(slot, isStore)

  return {
    keywords: buildCanonicalBucketKeywords(pool, slot, linkType),
    intent: meta.intent,
    intentEn: meta.intentEn,
  }
}

/**
 * 🆕 2025-12-22: 获取综合桶关键词（第5个创意专用）
 *
 * 策略：
 * 1. 包含所有品牌关键词（100%）
 * 2. 从A+B+C+D各桶中选择搜索量最高的非品牌关键词
 * 3. 按搜索量降序排序
 *
 * @param pool - 关键词池
 * @param userId - 用户ID（用于获取搜索量）
 * @param country - 目标国家
 * @param config - coverage 关键词配置
 * @returns coverage 关键词列表（带搜索量）
 */
export async function getCoverageBucketKeywords(
  pool: OfferKeywordPool,
  userId: number,
  country: string = 'US',
  config: CoverageKeywordConfig = DEFAULT_COVERAGE_KEYWORD_CONFIG
): Promise<Array<{ keyword: string; searchVolume: number; isBrand: boolean }>> {
  console.log(`\n🔮 开始构建商品需求 coverage 关键词池...`)
  const linkType = pool.linkType === 'store' ? 'store' : 'product'
  const pureBrandKeywords = getPoolPureBrandKeywords(pool)

  // 1. 收集所有品牌词（从 PoolKeywordData[] 提取）
  const brandKeywords = pool.brandKeywords.map((kw) => ({
    keyword: typeof kw === 'string' ? kw : kw.keyword,
    searchVolume: typeof kw === 'string' ? 0 : kw.searchVolume || 0,
    isBrand: true,
  }))
  console.log(`   品牌词: ${brandKeywords.length}个`)

  // 2. 使用 canonical D 视图收集 coverage 候选，避免遗漏 bucketD / 店铺 store buckets。
  const coverageCandidates = buildCanonicalBucketKeywords(pool, 'D', linkType)

  // 3. 收集所有非纯品牌词（去重）
  const allNonBrandKeywords = new Set<string>([
    ...coverageCandidates
      .filter((kw) => !isPureBrandPoolKeyword(kw, pureBrandKeywords))
      .map((kw) => kw.keyword),
  ])
  console.log(`   非品牌词（去重后）: ${allNonBrandKeywords.size}个`)

  // 4. 如果需要按搜索量排序，获取搜索量数据
  let nonBrandWithVolume: Array<{
    keyword: string
    searchVolume: number
    isBrand: boolean
    volumeUnavailableReason?: unknown
  }> = []

  if (config.sortByVolume && allNonBrandKeywords.size > 0) {
    try {
      const { getKeywordVolumesForExisting } = await import('../server')
      const volumeData = await getKeywordVolumesForExisting({
        baseKeywords: Array.from(allNonBrandKeywords),
        country,
        language: normalizeLanguageCode(config.language || 'en'),
        userId,
        brandName: pool.brandKeywords[0]
          ? typeof pool.brandKeywords[0] === 'string'
            ? pool.brandKeywords[0]
            : pool.brandKeywords[0].keyword
          : '',
      })

      // 构建搜索量映射（保留“搜索量不可用”标记）
      const volumeMap = new Map(
        volumeData.map((v) => [
          v.keyword.toLowerCase(),
          {
            searchVolume: v.searchVolume,
            volumeUnavailableReason: v.volumeUnavailableReason,
          },
        ])
      )

      // 转换为带搜索量的格式
      nonBrandWithVolume = Array.from(allNonBrandKeywords).map((kw) => ({
        keyword: kw,
        searchVolume: Number(volumeMap.get(kw.toLowerCase())?.searchVolume || 0),
        volumeUnavailableReason: volumeMap.get(kw.toLowerCase())?.volumeUnavailableReason,
        isBrand: false,
      }))

      // 按搜索量降序排序
      nonBrandWithVolume.sort((a, b) => b.searchVolume - a.searchVolume)

      // 过滤低于阈值的关键词
      // 🔧 修复(2026-03-05): Explorer/权限受限返回 volumeUnavailableReason 时，跳过全部搜索量过滤
      const hasAnyVolume = nonBrandWithVolume.some((kw) => kw.searchVolume > 0)
      const volumeUnavailable = hasSearchVolumeUnavailableFlag(
        nonBrandWithVolume as Array<{ volumeUnavailableReason?: unknown }>
      )
      if (hasAnyVolume && !volumeUnavailable) {
        nonBrandWithVolume = nonBrandWithVolume.filter(
          (kw) => kw.searchVolume >= config.minSearchVolume
        )
        console.log(`   获取搜索量成功，过滤后剩余: ${nonBrandWithVolume.length}个`)
      } else if (hasAnyVolume && volumeUnavailable) {
        console.log(`   ⚠️ 搜索量数据不可用（Planner 权限受限），跳过搜索量过滤`)
      } else {
        console.log(`   ⚠️ 所有关键词搜索量为0（可能是服务账号模式），跳过搜索量过滤`)
      }
    } catch (error: any) {
      console.warn(`   ⚠️ 获取搜索量失败，使用原始顺序:`, error.message)
      nonBrandWithVolume = Array.from(allNonBrandKeywords).map((kw) => ({
        keyword: kw,
        searchVolume: 0,
        isBrand: false,
      }))
    }
  } else {
    // 不需要排序，直接使用
    nonBrandWithVolume = Array.from(allNonBrandKeywords).map((kw) => ({
      keyword: kw,
      searchVolume: 0,
      isBrand: false,
    }))
  }

  // 5. 取Top N非品牌词
  const topNonBrandKeywords = nonBrandWithVolume.slice(0, config.maxNonBrandKeywords)
  console.log(`   选取Top${config.maxNonBrandKeywords}高搜索量词: ${topNonBrandKeywords.length}个`)

  // 6. 合并：品牌词 + 高搜索量非品牌词
  const result = [...brandKeywords, ...topNonBrandKeywords]

  console.log(`✅ 商品需求 coverage 关键词池构建完成: 共${result.length}个关键词`)
  console.log(`   - 品牌词: ${brandKeywords.length}个`)
  console.log(`   - 高搜索量非品牌词: ${topNonBrandKeywords.length}个`)
  if (topNonBrandKeywords.length > 0) {
    console.log(
      `   - 最高搜索量: ${topNonBrandKeywords[0]?.keyword} (${topNonBrandKeywords[0]?.searchVolume})`
    )
  }

  return result
}

/**
 * 获取可用的桶（未被占用的）
 *
 * @param offerId - Offer ID
 * @returns 可用桶列表
 */
export async function getAvailableBuckets(offerId: number): Promise<BucketType[]> {
  const db = await getDatabase()

  // 🔧 修复(2025-01-02): 只查询未删除的创意，排除软删除的创意
  // 🔥 修复(2026-03-15): 同时排除 creation_status='generating' 的占位记录（防止并发竞态）
  const usedCreatives = await db.query<{
    creative_type: string | null
    keyword_bucket: string | null
    headlines: string | null
    descriptions: string | null
    keywords: string | null
    theme: string | null
    bucket_intent: string | null
  }>(
    `SELECT creative_type, keyword_bucket, headlines, descriptions, keywords, theme, bucket_intent
     FROM ad_creatives
     WHERE offer_id = ?
       AND deleted_at IS NULL
       AND (creation_status IS NULL OR creation_status != 'generating')`,
    [offerId]
  )

  const usedTypes = new Set<CanonicalCreativeType>()
  for (const creative of usedCreatives) {
    const creativeType = deriveCanonicalCreativeType({
      creativeType: creative.creative_type,
      keywordBucket: creative.keyword_bucket,
      headlines: creative.headlines,
      descriptions: creative.descriptions,
      keywords: creative.keywords,
      theme: creative.theme,
      bucketIntent: creative.bucket_intent,
    })
    if (creativeType) {
      usedTypes.add(creativeType)
    }
  }

  const allTypes: BucketType[] = ['A', 'B', 'D']
  return allTypes.filter((bucket) => {
    const creativeType = getCreativeTypeForBucketSlot(bucket as 'A' | 'B' | 'D')
    return !usedTypes.has(creativeType)
  })
}

/**
 * 获取已使用的桶
 *
 * @param offerId - Offer ID
 * @returns 已使用桶列表
 */
export async function getUsedBuckets(offerId: number): Promise<BucketType[]> {
  const db = await getDatabase()

  // 🔧 修复(2025-01-02): 只查询未删除的创意，排除软删除的创意
  const usedCreatives = await db.query<{
    creative_type: string | null
    keyword_bucket: string | null
    headlines: string | null
    descriptions: string | null
    keywords: string | null
    theme: string | null
    bucket_intent: string | null
  }>(
    `SELECT creative_type, keyword_bucket, headlines, descriptions, keywords, theme, bucket_intent
     FROM ad_creatives
     WHERE offer_id = ? AND deleted_at IS NULL`,
    [offerId]
  )

  const usedBuckets = new Set<BucketType>()
  for (const creative of usedCreatives) {
    const creativeType = deriveCanonicalCreativeType({
      creativeType: creative.creative_type,
      keywordBucket: creative.keyword_bucket,
      headlines: creative.headlines,
      descriptions: creative.descriptions,
      keywords: creative.keywords,
      theme: creative.theme,
      bucketIntent: creative.bucket_intent,
    })
    const bucketSlot = mapCreativeTypeToBucketSlot(creativeType)
    if (bucketSlot) {
      usedBuckets.add(bucketSlot)
    }
  }

  return Array.from(usedBuckets)
} /**
 * 计算关键词重叠率
 *
 * @param keywords1 - 关键词列表 1
 * @param keywords2 - 关键词列表 2
 * @returns 重叠率 (0-1)
 */
export function calculateKeywordOverlapRate(keywords1: string[], keywords2: string[]): number {
  if (keywords1.length === 0 || keywords2.length === 0) return 0

  const set1 = new Set(keywords1.map((k) => k.toLowerCase()))
  const set2 = new Set(keywords2.map((k) => k.toLowerCase()))

  let overlap = 0
  for (const kw of set1) {
    if (set2.has(kw)) overlap++
  }

  const total = Math.max(set1.size, set2.size)
  return overlap / total
}

// ============================================
// 🔥 KISS 优化：统一关键词检索 API
// 替代 5 个重叠函数，简化开发者体验
// ============================================

type CanonicalGetKeywordsBucket = 'A' | 'B' | 'D' | 'ALL'

function resolveCanonicalGetKeywordsBucket(
  bucket: GetKeywordsOptions['bucket'],
  intent?: GetKeywordsOptions['intent'],
  creativeType?: GetKeywordsOptions['creativeType']
): CanonicalGetKeywordsBucket {
  if (bucket && bucket !== 'ALL') {
    const normalizedBucket = normalizeKeywordPoolBucketQuery(bucket)
    if (normalizedBucket) {
      return normalizedBucket
    }
  }

  const canonicalCreativeType = normalizeCanonicalCreativeType(creativeType)
  const creativeTypeBucket = mapCreativeTypeToBucketSlot(canonicalCreativeType)
  if (creativeTypeBucket) {
    return creativeTypeBucket
  }

  if (intent === 'brand' || intent === 'brand_intent') return 'A'
  if (intent === 'scenario' || intent === 'feature' || intent === 'model_intent') return 'B'
  if (intent === 'demand' || intent === 'product_intent') return 'D'
  return 'ALL'
}

function buildCanonicalKeywordView(keywordPool: OfferKeywordPool) {
  const bucketA = getBucketInfo(keywordPool, 'A')
  const bucketB = getBucketInfo(keywordPool, 'B')
  const bucketD = getBucketInfo(keywordPool, 'D')

  return {
    A: bucketA,
    B: bucketB,
    C: bucketB,
    D: bucketD,
    ALL: mergeKeywordDataLists([bucketA.keywords, bucketB.keywords, bucketD.keywords]),
  }
}

function buildPureBrandSetFromPoolKeywords(keywords: PoolKeywordData[]): Set<string> {
  return new Set(
    keywords
      .map((item) => normalizeGoogleAdsKeyword(item.keyword))
      .filter((item): item is string => Boolean(item))
  )
}

function isPoolKeywordPureBrand(item: PoolKeywordData, pureBrandSet: Set<string>): boolean {
  if (item.isPureBrand) return true
  const normalized = normalizeGoogleAdsKeyword(item.keyword)
  return Boolean(normalized && pureBrandSet.has(normalized))
}

function ensurePureBrandFallbackWithinLimit(params: {
  keywords: PoolKeywordData[]
  brandKeywords: PoolKeywordData[]
  pureBrandSet: Set<string>
  maxKeywords: number
}): PoolKeywordData[] {
  const limit = Math.max(0, params.maxKeywords)
  if (limit === 0) return []
  if (params.pureBrandSet.size === 0) return params.keywords.slice(0, limit)

  const nonPure = params.keywords.filter(
    (item) => !isPoolKeywordPureBrand(item, params.pureBrandSet)
  )
  const existingFallback = params.keywords.find((item) =>
    isPoolKeywordPureBrand(item, params.pureBrandSet)
  )

  if (existingFallback) {
    const kept = nonPure.slice(0, Math.max(0, limit - 1))
    return [...kept, existingFallback]
  }

  const fallbackBrand = params.brandKeywords.find((item) => {
    const normalized = normalizeGoogleAdsKeyword(item.keyword)
    return Boolean(normalized && params.pureBrandSet.has(normalized))
  })
  if (!fallbackBrand) {
    return params.keywords.slice(0, limit)
  }

  const kept = params.keywords.slice(0, Math.max(0, limit - 1))
  return [
    ...kept,
    {
      ...fallbackBrand,
      isPureBrand: true,
      matchType: fallbackBrand.matchType || 'EXACT',
    },
  ]
}

/**
 * 🔥 核心 API：统一关键词检索
 *
 * 示例用法：
 * ```typescript
 * // 获取所有关键词
 * const all = await getKeywords(123)
 *
 * // 只获取品牌桶
 * const brand = await getKeywords(123, { bucket: 'A' })
 *
 * // 获取过滤后的关键词
 * const filtered = await getKeywords(123, { minSearchVolume: 100, maxKeywords: 500 })
 * ```
 *
 * 注意：此函数仅负责检索。如需创建关键词池，请使用 getOrCreateKeywordPool()
 */
export async function getKeywords(
  offerId: number,
  options: GetKeywordsOptions = {}
): Promise<GetKeywordsResult> {
  const {
    bucket = 'ALL',
    intent,
    creativeType,
    minSearchVolume = 100,
    maxKeywords = 5000,
  } = options

  // 1. 获取关键词池
  const keywordPool = await getKeywordPoolByOfferId(offerId)

  // 2. 如果没有，返回空结果
  if (!keywordPool) {
    return {
      keywords: [],
      stats: { totalCount: 0 },
      meta: { offerId },
    }
  }
  const pureBrandSet = buildPureBrandSetFromPoolKeywords(keywordPool.brandKeywords)

  // 3. 使用 canonical 视图选择关键词（兼容旧 bucket / intent 参数）
  const canonicalView = buildCanonicalKeywordView(keywordPool)
  const effectiveBucket = resolveCanonicalGetKeywordsBucket(bucket, intent, creativeType)
  let keywords =
    effectiveBucket === 'ALL'
      ? [...canonicalView.ALL]
      : [...canonicalView[effectiveBucket].keywords]
  const effectiveCreativeType =
    effectiveBucket === 'ALL' ? null : getCreativeTypeForBucketSlot(effectiveBucket)
  const keywordPoolLinkType = keywordPool.linkType === 'store' ? 'store' : 'product'
  const comprehensivePoolKeywords = getComprehensiveKeywordsForPool(
    keywordPool,
    keywordPoolLinkType
  )
  const pureBrandKeywords = getPoolPureBrandKeywords(keywordPool)

  if (effectiveBucket !== 'ALL' && effectiveCreativeType) {
    keywords = await applyOfferContextToCanonicalKeywords({
      offerId,
      keywords,
      creativeType: effectiveCreativeType,
      scopeLabel: `getKeywords:${effectiveBucket}`,
      fallbackCandidates: comprehensivePoolKeywords,
      pureBrandKeywords,
    })
  }

  // 4. 按搜索量过滤（纯品牌词豁免）
  // 🔧 修复(2025-12-26): 服务账号模式下无法获取搜索量，跳过过滤
  const hasAnyVolume = keywords.some((kw) => kw.searchVolume > 0)
  const volumeUnavailable = hasSearchVolumeUnavailableFlag(keywords)
  if (hasAnyVolume && !volumeUnavailable) {
    keywords = keywords.filter((kw) => {
      const normalized = normalizeGoogleAdsKeyword(kw.keyword)
      return kw.searchVolume >= minSearchVolume || (normalized && pureBrandSet.has(normalized))
    })
  } else if (hasAnyVolume && volumeUnavailable) {
    console.log('⚠️ 搜索量数据不可用（Planner 权限受限），跳过搜索量过滤')
  } else {
    console.log('⚠️ 所有关键词搜索量为0（可能是服务账号模式），跳过搜索量过滤')
  }

  if (effectiveBucket === 'ALL' && keywordPool.brandKeywords.length > 0) {
    keywords = prioritizeBrandKeywordsFirst(
      keywords,
      keywordPool.brandKeywords.map((kw) => kw.keyword)
    )
  }

  // 5. 限制数量
  keywords = keywords.slice(0, maxKeywords)
  if ((effectiveBucket === 'A' || effectiveBucket === 'D') && pureBrandSet.size > 0) {
    keywords = ensurePureBrandFallbackWithinLimit({
      keywords,
      brandKeywords: keywordPool.brandKeywords,
      pureBrandSet,
      maxKeywords,
    })
  }

  // 6. 构建返回结果
  const result: GetKeywordsResult = {
    keywords,
    stats: {
      totalCount: keywords.length,
      bucketACount: canonicalView.A.keywords.length,
      bucketBCount: canonicalView.B.keywords.length,
      bucketCCount: canonicalView.C.keywords.length,
      bucketDCount: canonicalView.D.keywords.length,
      searchVolumeRange:
        keywords.length > 0
          ? {
              min: Math.min(...keywords.map((k) => k.searchVolume)),
              max: Math.max(...keywords.map((k) => k.searchVolume)),
            }
          : undefined,
    },
    meta: {
      offerId,
      createdAt: keywordPool.createdAt,
      updatedAt: keywordPool.updatedAt,
    },
  }

  // 7. 如果需要，返回桶信息
  if (effectiveBucket === 'ALL') {
    result.buckets = {
      A: { intent: canonicalView.A.intent, keywords: canonicalView.A.keywords },
      B: { intent: canonicalView.B.intent, keywords: canonicalView.B.keywords },
      C: { intent: canonicalView.C.intent, keywords: canonicalView.C.keywords },
      D: { intent: canonicalView.D.intent, keywords: canonicalView.D.keywords },
    }
  }

  console.log(
    `[getKeywords] 完成: offerId=${offerId}, bucket=${bucket}, effectiveBucket=${effectiveBucket}, 返回${keywords.length}个关键词`
  )
  return result
}

/**
 * 🆕 v4.16: 根据链接类型和创意桶获取关键词
 *
 * @param offerId - Offer ID
 * @param linkType - 链接类型 ('product' | 'store')
 * @param bucket - 创意桶类型 ('A' | 'B' | 'C' | 'D' | 'S')
 * @returns 关键词数组和意图描述
 */
export async function getKeywordsByLinkTypeAndBucket(
  offerId: number,
  linkType: 'product' | 'store',
  bucket: BucketType
): Promise<{ keywords: PoolKeywordData[]; intent: string; intentEn: string }> {
  const keywordPool = await getKeywordPoolByOfferId(offerId)

  if (!keywordPool) {
    console.warn(`[getKeywordsByLinkTypeAndBucket] 关键词池不存在: offerId=${offerId}`)
    return { keywords: [], intent: '', intentEn: '' }
  }

  const effectivePool =
    keywordPool.linkType === linkType ? keywordPool : { ...keywordPool, linkType }
  const bucketInfo = getBucketInfo(effectivePool as OfferKeywordPool, bucket)
  const effectiveBucket = normalizeKeywordPoolBucketQuery(bucket)
  if (!effectiveBucket) {
    throw new Error(`Invalid bucket type: ${bucket}`)
  }
  const effectiveCreativeType = getCreativeTypeForBucketSlot(effectiveBucket)
  const comprehensivePoolKeywords = getComprehensiveKeywordsForPool(
    effectivePool as OfferKeywordPool,
    linkType
  )
  const pureBrandKeywords = getPoolPureBrandKeywords(effectivePool as OfferKeywordPool)

  if (linkType !== 'product' || !effectiveCreativeType) {
    return bucketInfo
  }

  const filteredKeywords = await applyOfferContextToCanonicalKeywords({
    offerId,
    keywords: bucketInfo.keywords,
    creativeType: effectiveCreativeType,
    scopeLabel: `getKeywordsByLinkTypeAndBucket:${bucket}`,
    fallbackCandidates: comprehensivePoolKeywords,
    pureBrandKeywords,
  })

  return {
    ...bucketInfo,
    keywords: filteredKeywords,
  }
}

export const __testOnly = {
  extractStoreProductNamesFromLinks,
  buildVerifiedSourceKeywordData,
  resolveOfferPageType,
  filterGlobalCoreKeywordsByOfferContext,
}
