/**
 * Canonical A/B/D keyword projection for creative generation.
 */
import { getDatabase } from '../db'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { containsPureBrand, isPureBrandKeyword } from '../brand-keyword-utils'
import { filterCreativeKeywordsByOfferContextDetailed } from '../creative-keyword-context-filter'
import { hasModelAnchorEvidence, type CanonicalCreativeType } from '../creative-type'
import { classifyKeywordIntent } from '../keyword-intent'
import {
  buildProductModelFamilyContext,
  buildProductModelFamilyFallbackKeywords,
  filterKeywordObjectsByProductModelFamily,
  MODEL_INTENT_MIN_KEYWORD_FLOOR,
} from '../model-intent-family-filter'
import {
  getKeywordSourcePriorityForPoolItem,
  normalizeMatchTypePriority,
} from './keyword-clustering'
import type { OfferKeywordPool, PoolKeywordData } from './types'

// ============================================

type KeywordItem = PoolKeywordData | string

function normalizeKeywordItem(item: KeywordItem): PoolKeywordData | null {
  if (typeof item === 'string') {
    const keyword = item.trim()
    if (!keyword) return null
    return {
      keyword,
      searchVolume: 0,
      source: 'LEGACY',
      matchType: 'PHRASE',
    }
  }
  if (!item || typeof item !== 'object') return null
  const keyword = String(item.keyword || '').trim()
  if (!keyword) return null
  return {
    ...item,
    keyword,
    searchVolume:
      typeof item.searchVolume === 'number' ? item.searchVolume : Number(item.searchVolume) || 0,
    source: item.source || 'LEGACY',
    matchType: item.matchType || 'PHRASE',
  }
}

export function mergeKeywordDataLists(lists: Array<KeywordItem[]>): PoolKeywordData[] {
  const merged = new Map<string, PoolKeywordData>()

  for (const list of lists) {
    for (const item of list || []) {
      const normalized = normalizeKeywordItem(item)
      if (!normalized) continue
      const key = normalizeGoogleAdsKeyword(normalized.keyword) || normalized.keyword.toLowerCase()
      if (!key) continue

      const existing = merged.get(key)
      if (!existing) {
        merged.set(key, normalized)
        continue
      }

      const priorityDiff =
        getKeywordSourcePriorityForPoolItem(existing) -
        getKeywordSourcePriorityForPoolItem(normalized)
      if (priorityDiff > 0) {
        merged.set(key, normalized)
        continue
      }
      if (priorityDiff < 0) {
        continue
      }

      if (normalized.searchVolume > (existing.searchVolume || 0)) {
        merged.set(key, normalized)
        continue
      }
      if (normalized.searchVolume < (existing.searchVolume || 0)) {
        continue
      }

      const matchTypeDiff =
        normalizeMatchTypePriority(normalized.matchType) -
        normalizeMatchTypePriority(existing.matchType)
      if (matchTypeDiff > 0) {
        merged.set(key, normalized)
        continue
      }

      if (matchTypeDiff < 0) continue

      if (normalized.keyword.length < existing.keyword.length) {
        merged.set(key, normalized)
      }
    }
  }

  return Array.from(merged.values())
}

export function getComprehensiveKeywordsForPool(
  pool: OfferKeywordPool,
  linkType: 'product' | 'store'
): PoolKeywordData[] {
  if (linkType === 'store') {
    return mergeKeywordDataLists([
      pool.brandKeywords,
      pool.storeBucketAKeywords,
      pool.storeBucketBKeywords,
      pool.storeBucketCKeywords,
      pool.storeBucketDKeywords,
      pool.storeBucketSKeywords,
    ])
  }

  return mergeKeywordDataLists([
    pool.brandKeywords,
    pool.bucketAKeywords,
    pool.bucketBKeywords,
    pool.bucketCKeywords,
    pool.bucketDKeywords,
  ])
}

const CANONICAL_PLATFORM_PATTERN = /\b(amazon|walmart|ebay|etsy|aliexpress|temu|shopee)\b/i
const CANONICAL_INFO_QUERY_PATTERN =
  /\b(what is|meaning|tutorial|guide|manual|how to|instructions?|gambar|como|qué es|cos[eè]|qu[e']|cosa|wie|was ist|guida|manuale)\b/i
const CANONICAL_REVIEW_COMPARE_PATTERN =
  /\b(review|reviews|rating|ratings|comparison|compare|vs|versus|ulasan|recensioni?|recensione|bewertung(?:en)?|rezension(?:en)?|rese(?:n|ñ)a(?:s)?|avis|comparaison|comparar|confronto|vergleich|testbericht)\b/i
const CANONICAL_STORE_NAV_PATTERN =
  /\b(official store|official site|store locator|near me|customer service|contact us|help center|support center|order tracking|returns?|shipping policy|faq|login|sign in)\b/i
const CANONICAL_PROMO_PATTERN =
  /\b(discount|coupon|cheap|sale|deal|offer|promo|price|cost|clearance|best price)\b/i
const CANONICAL_REPEATED_ACTION_PATTERN = /\b(buy|shop|purchase|order)\b.*\b\1\b/i
const CANONICAL_BRAND_SLOGAN_PATTERN = /\b(a\s+cozy\s+home\s+made\s+simple|home\s+made\s+simple)\b/i
const CANONICAL_GEO_ADMIN_PATTERN = /\b(kabupaten|kecamatan|kelurahan)\b/i
const CANONICAL_GARBAGE_TOKEN_PATTERN = /\b(rng|openurlproduct)\b/i
const CANONICAL_QUESTION_PREFIX_PATTERN =
  /^(?:what|why|how|when|where|who|which|is|are|do|does|did|can|could|should|would)\b/i
const CANONICAL_SOFT_MODEL_SIZE_PATTERN =
  /\b(california king|cal king|king size|queen size|twin xl|twin|queen|king|full)\b/gi
const CANONICAL_SOFT_MODEL_DIMENSION_PATTERN = /\b\d{1,3}\s*(?:inch|in)\b/gi
const CANONICAL_SOFT_MODEL_PACK_PATTERN = /\b\d{1,2}\s*(?:pack|count|pc|piece|pieces|set)\b/gi
const CANONICAL_SOFT_MODEL_ATTRIBUTE_PHRASES = [
  'memory foam',
  'gel memory foam',
  'medium firm',
  'extra firm',
  'ultra firm',
  'cooling gel',
]
const CANONICAL_SOFT_MODEL_ATTRIBUTE_TOKENS = new Set([
  'hybrid',
  'latex',
  'foam',
  'firm',
  'plush',
  'medium',
  'cooling',
  'wood',
  'wooden',
  'metal',
  'steel',
  'leather',
  'cotton',
  'linen',
])
const CANONICAL_NON_ANCHOR_TOKENS = new Set([
  'official',
  'store',
  'shop',
  'collection',
  'sale',
  'deal',
  'discount',
  'coupon',
  'offer',
  'promo',
  'free',
  'shipping',
  'warranty',
  'support',
  'buy',
  'best',
  'top',
  'price',
  'cost',
  'online',
  'near',
  'me',
  'new',
  'latest',
  'review',
  'reviews',
  'rating',
  'ratings',
  'comparison',
  'compare',
  'vs',
  'versus',
  'service',
  'help',
  'contact',
  'tracking',
  'returns',
  'faq',
  'login',
  'site',
  'customer',
])
const CANONICAL_PRIMARY_SOURCES = new Set([
  'KEYWORD_PLANNER_BRAND',
  'KEYWORD_PLANNER',
  'HOT_PRODUCT_AGGREGATE',
  'OFFER_EXTRACTED_KEYWORDS',
  'PARAM_EXTRACT',
  'TITLE_EXTRACT',
  'ABOUT_EXTRACT',
  'PAGE_EXTRACT',
  'ENHANCED_EXTRACT',
])
const MODEL_INTENT_CANONICAL_TOP_SOURCE_BOOSTS = new Map<string, number>([
  ['SEARCH_TERM_HIGH_PERFORMING', 9],
  ['SEARCH_TERM', 8],
  ['HOT_PRODUCT_AGGREGATE', 7],
  ['KEYWORD_PLANNER_BRAND', 6],
  ['KEYWORD_PLANNER', 6],
  ['PARAM_EXTRACT', 6],
  ['TITLE_EXTRACT', 6],
  ['ABOUT_EXTRACT', 5],
  ['PAGE_EXTRACT', 4],
  ['GOOGLE_SUGGEST', 3],
  ['OFFER_EXTRACTED_KEYWORDS', 3],
])
const CANONICAL_FILTER_RELAXED_TOP_SOURCES = new Set([
  'SEARCH_TERM_HIGH_PERFORMING',
  'SEARCH_TERM',
  'HOT_PRODUCT_AGGREGATE',
  'KEYWORD_PLANNER_BRAND',
  'KEYWORD_PLANNER',
  'PARAM_EXTRACT',
  'TITLE_EXTRACT',
  'ABOUT_EXTRACT',
])
const STORE_MODEL_INTENT_RELAXED_SOURCES = new Set([
  'SEARCH_TERM_HIGH_PERFORMING',
  'SEARCH_TERM',
  'HOT_PRODUCT_AGGREGATE',
  'OFFER_EXTRACTED_KEYWORDS',
  'KEYWORD_PLANNER_BRAND',
  'KEYWORD_PLANNER',
  'PARAM_EXTRACT',
  'TITLE_EXTRACT',
  'ABOUT_EXTRACT',
  'PAGE_EXTRACT',
  'ENHANCED_EXTRACT',
])
const PRODUCT_MODEL_INTENT_RELAXED_SOURCES = new Set([
  'SEARCH_TERM_HIGH_PERFORMING',
  'SEARCH_TERM',
  'HOT_PRODUCT_AGGREGATE',
  'OFFER_EXTRACTED_KEYWORDS',
  'KEYWORD_PLANNER_BRAND',
  'KEYWORD_PLANNER',
  'PARAM_EXTRACT',
  'TITLE_EXTRACT',
  'ABOUT_EXTRACT',
  'PAGE_EXTRACT',
  'ENHANCED_EXTRACT',
])
const STORE_MODEL_INTENT_WEAK_DEMAND_TOKENS = new Set([
  'always',
  'large',
  'small',
  'mini',
  'medium',
  'extra',
  'xl',
  'xxl',
])
const PRODUCT_MODEL_INTENT_WEAK_DEMAND_TOKENS = new Set([
  'always',
  'large',
  'small',
  'mini',
  'medium',
  'extra',
  'xl',
  'xxl',
])

export function getPoolPureBrandKeywords(pool: OfferKeywordPool): string[] {
  return Array.from(
    new Set(
      (pool.brandKeywords || [])
        .map((item) => normalizeGoogleAdsKeyword(typeof item === 'string' ? item : item.keyword))
        .filter((item): item is string => !!item)
    )
  )
}

function collectCanonicalSoftModelSignalTokens(normalizedKeyword: string): Set<string> {
  const softSignalTokens = new Set<string>()

  for (const phrase of CANONICAL_SOFT_MODEL_ATTRIBUTE_PHRASES) {
    if (!normalizedKeyword.includes(phrase)) continue
    for (const token of phrase.split(/\s+/).filter(Boolean)) {
      softSignalTokens.add(token)
    }
  }

  for (const pattern of [
    CANONICAL_SOFT_MODEL_SIZE_PATTERN,
    CANONICAL_SOFT_MODEL_DIMENSION_PATTERN,
    CANONICAL_SOFT_MODEL_PACK_PATTERN,
  ]) {
    const matches = normalizedKeyword.match(pattern) || []
    for (const match of matches) {
      const normalizedMatch = normalizeGoogleAdsKeyword(match) || ''
      for (const token of normalizedMatch.split(/\s+/).filter(Boolean)) {
        softSignalTokens.add(token)
      }
    }
  }

  for (const token of normalizedKeyword.split(/\s+/)) {
    if (CANONICAL_SOFT_MODEL_ATTRIBUTE_TOKENS.has(token)) {
      softSignalTokens.add(token)
    }
  }

  return softSignalTokens
}

function buildCanonicalBrandTokenSet(pureBrandKeywords: string[]): Set<string> {
  return new Set(pureBrandKeywords.flatMap((item) => item.split(/\s+/)).filter(Boolean))
}

function extractCanonicalDemandTokens(keyword: string, pureBrandKeywords: string[]): string[] {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return []

  const brandTokens = buildCanonicalBrandTokenSet(pureBrandKeywords)
  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token.length > 2)
    .filter((token) => !brandTokens.has(token))
    .filter((token) => !CANONICAL_NON_ANCHOR_TOKENS.has(token))
    .filter((token) => !hasModelAnchorEvidence({ keywords: [token] }))
}

function hasDemandAnchorInCanonicalBucket(keyword: string, pureBrandKeywords: string[]): boolean {
  return extractCanonicalDemandTokens(keyword, pureBrandKeywords).length > 0
}

function hasSoftModelFamilySignalInCanonicalBucket(
  keyword: string,
  pureBrandKeywords: string[]
): boolean {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return false
  if (!containsPureBrand(keyword, pureBrandKeywords)) return false

  const softSignalTokens = collectCanonicalSoftModelSignalTokens(normalized)
  if (softSignalTokens.size === 0) return false

  const productCoreTokens = extractCanonicalDemandTokens(keyword, pureBrandKeywords).filter(
    (token) => !softSignalTokens.has(token)
  )
  return productCoreTokens.length > 0
}

function getCanonicalSourceLabels(
  item: Pick<PoolKeywordData, 'source'> & {
    sourceType?: string
    sourceSubtype?: string
    rawSource?: string
    derivedTags?: string[]
  }
): string[] {
  return Array.from(
    new Set(
      [
        item.sourceType,
        item.sourceSubtype,
        item.rawSource,
        item.source,
        ...(Array.isArray(item.derivedTags) ? item.derivedTags : []),
      ]
        .map((value) =>
          String(value || '')
            .trim()
            .toUpperCase()
        )
        .filter(Boolean)
    )
  )
}

function getModelIntentCanonicalSourceAdjustment(
  item: Pick<PoolKeywordData, 'source' | 'sourceType'>
): number {
  const labels = getCanonicalSourceLabels(item)
  let adjustment = 0

  for (const label of labels) {
    const exactBoost = MODEL_INTENT_CANONICAL_TOP_SOURCE_BOOSTS.get(label)
    if (typeof exactBoost === 'number') {
      adjustment = Math.max(adjustment, exactBoost)
      continue
    }

    if (label.startsWith('KEYWORD_PLANNER')) {
      adjustment = Math.max(adjustment, 3)
      continue
    }

    if (label.startsWith('GLOBAL_')) {
      adjustment = Math.min(adjustment, -4)
      continue
    }

    if (label === 'MODEL_FAMILY_GUARD') {
      adjustment = Math.min(adjustment, -6)
    }
  }

  return adjustment
}

function isHighPriorityCanonicalSource(
  item: Pick<
    PoolKeywordData,
    'source' | 'sourceType' | 'sourceSubtype' | 'rawSource' | 'derivedTags'
  >
): boolean {
  const labels = getCanonicalSourceLabels(item)
  return labels.some((label) => CANONICAL_FILTER_RELAXED_TOP_SOURCES.has(label))
}

function getModelIntentCanonicalVolumeAdjustment(
  item: Pick<PoolKeywordData, 'searchVolume'>
): number {
  const volume = Number(item.searchVolume || 0)
  if (!Number.isFinite(volume) || volume <= 0) return 0
  if (volume >= 500) return 4
  if (volume >= 200) return 3
  if (volume >= 50) return 2
  return 1
}

function getModelIntentCanonicalShapePenalty(keyword: string, pureBrandKeywords: string[]): number {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return 0

  let penalty = 0
  const normalizedBrandKeywords = pureBrandKeywords
    .map((item) => normalizeGoogleAdsKeyword(item))
    .filter((item): item is string => Boolean(item))

  if (
    containsPureBrand(keyword, pureBrandKeywords) &&
    normalizedBrandKeywords.length > 0 &&
    !normalizedBrandKeywords.some(
      (brand) => normalized === brand || normalized.startsWith(`${brand} `)
    )
  ) {
    penalty += 4
  }

  const keywordTokens = normalized.split(/\s+/).filter(Boolean)
  const lastToken = keywordTokens[keywordTokens.length - 1] || ''
  if (/^\d{1,3}$/.test(lastToken)) {
    penalty += 3
  }

  const demandTokens = new Set(extractCanonicalDemandTokens(keyword, pureBrandKeywords))
  const softSignalTokens = collectCanonicalSoftModelSignalTokens(normalized)
  const firstDemandIndex = keywordTokens.findIndex((token) => demandTokens.has(token))
  const firstSoftSignalIndex = keywordTokens.findIndex((token) => softSignalTokens.has(token))
  if (
    firstDemandIndex >= 0 &&
    firstSoftSignalIndex >= 0 &&
    firstDemandIndex < firstSoftSignalIndex
  ) {
    penalty += 2
  }

  return penalty
}

function buildCanonicalPermutationKey(keyword: string): string {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return ''

  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length <= 1) return normalized
  return [...tokens].sort().join(' ')
}

function buildCanonicalUnitStrippedKey(keyword: string): string {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return ''

  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token !== 'inch' && token !== 'in')
    .join(' ')
}

function normalizeCanonicalCommercialConceptToken(token: string): string {
  const normalized = String(token || '')
    .trim()
    .toLowerCase()
  if (!normalized || /\d/.test(normalized)) return normalized

  if (/ies$/.test(normalized) && normalized.length > 4) {
    return `${normalized.slice(0, -3)}y`
  }
  if (/(sses|shes|ches|xes|zes)$/.test(normalized) && normalized.length > 5) {
    return normalized.slice(0, -2)
  }
  if (/s$/.test(normalized) && !/ss$/.test(normalized) && normalized.length > 4) {
    return normalized.slice(0, -1)
  }

  return normalized
}

function buildCanonicalCommercialConceptKey(keyword: string): string {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return ''

  const tokens = normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !CANONICAL_NON_ANCHOR_TOKENS.has(token))
    .map(normalizeCanonicalCommercialConceptToken)
    .filter(Boolean)

  if (tokens.length === 0) return ''
  return [...tokens].sort().join(' ')
}

function pruneCanonicalCommercialVariants(
  keywords: PoolKeywordData[],
  pureBrandKeywords: string[],
  creativeType: CanonicalCreativeType
): PoolKeywordData[] {
  const pruned: PoolKeywordData[] = []
  const seenBaseConceptKeys = new Set<string>()
  const seenCommercialConceptKeys = new Set<string>()
  const seenConceptKeys = new Set<string>()

  for (const item of keywords) {
    if (isPureBrandPoolKeyword(item, pureBrandKeywords)) {
      pruned.push(item)
      continue
    }

    const conceptKey = buildCanonicalCommercialConceptKey(item.keyword)
    if (!conceptKey) {
      pruned.push(item)
      continue
    }

    const intent = classifyKeywordIntent(item.keyword).intent
    if (creativeType === 'brand_intent') {
      if (seenConceptKeys.has(conceptKey)) continue
      seenConceptKeys.add(conceptKey)
      pruned.push(item)
      continue
    }

    const perIntentSeenConceptKeys =
      intent === 'TRANSACTIONAL' || intent === 'COMMERCIAL'
        ? seenCommercialConceptKeys
        : seenBaseConceptKeys
    if (perIntentSeenConceptKeys.has(conceptKey)) continue
    perIntentSeenConceptKeys.add(conceptKey)
    pruned.push(item)
  }

  return pruned
}

function shouldPruneModelIntentCanonicalVariant(
  item: PoolKeywordData,
  pureBrandKeywords: string[],
  seenPermutationKeys: Set<string>,
  seenUnitStrippedKeys: Set<string>
): boolean {
  const normalized = normalizeGoogleAdsKeyword(item.keyword)
  if (!normalized) return false

  const shapePenalty = getModelIntentCanonicalShapePenalty(item.keyword, pureBrandKeywords)
  if (shapePenalty <= 0) return false

  const permutationKey = buildCanonicalPermutationKey(normalized)
  if (permutationKey && seenPermutationKeys.has(permutationKey)) {
    return true
  }

  const trailingToken = normalized.split(/\s+/).filter(Boolean).slice(-1)[0] || ''
  const hasBareTrailingNumericSpec = /^\d{1,3}$/.test(trailingToken)
  if (hasBareTrailingNumericSpec && seenUnitStrippedKeys.has(normalized)) {
    return true
  }

  return false
}

function pruneModelIntentCanonicalVariants(
  keywords: PoolKeywordData[],
  pureBrandKeywords: string[]
): PoolKeywordData[] {
  const pruned: PoolKeywordData[] = []
  const seenPermutationKeys = new Set<string>()
  const seenUnitStrippedKeys = new Set<string>()

  for (const item of keywords) {
    const normalized = normalizeGoogleAdsKeyword(item.keyword)
    if (!normalized) continue

    if (
      shouldPruneModelIntentCanonicalVariant(
        item,
        pureBrandKeywords,
        seenPermutationKeys,
        seenUnitStrippedKeys
      )
    ) {
      continue
    }

    pruned.push(item)
    seenPermutationKeys.add(buildCanonicalPermutationKey(normalized))
    seenUnitStrippedKeys.add(buildCanonicalUnitStrippedKey(normalized))
  }

  return pruned
}

export function isPureBrandPoolKeyword(
  item: PoolKeywordData,
  pureBrandKeywords: string[]
): boolean {
  return Boolean(item.isPureBrand) || isPureBrandKeyword(item.keyword, pureBrandKeywords)
}

function hasStoreModelIntentFamilyRescueSignal(
  item: PoolKeywordData,
  pureBrandKeywords: string[]
): boolean {
  if (isPureBrandPoolKeyword(item, pureBrandKeywords)) return false
  if (!containsPureBrand(item.keyword, pureBrandKeywords)) return false
  if (!hasDemandAnchorInCanonicalBucket(item.keyword, pureBrandKeywords)) return false

  const labels = getCanonicalSourceLabels(item)
  if (!labels.some((label) => STORE_MODEL_INTENT_RELAXED_SOURCES.has(label))) return false

  const normalizedKeyword = normalizeGoogleAdsKeyword(item.keyword) || ''
  if (!normalizedKeyword) return false
  const keywordTokens = normalizedKeyword.split(/\s+/).filter(Boolean)
  if (keywordTokens.length < 3) return false

  const demandTokens = extractCanonicalDemandTokens(item.keyword, pureBrandKeywords).filter(
    (token) => token.length >= 3
  )
  if (demandTokens.length === 0) return false

  return demandTokens.some((token) => !STORE_MODEL_INTENT_WEAK_DEMAND_TOKENS.has(token))
}

function hasProductModelIntentFamilyRescueSignal(
  item: PoolKeywordData,
  pureBrandKeywords: string[]
): boolean {
  if (isPureBrandPoolKeyword(item, pureBrandKeywords)) return false
  if (!containsPureBrand(item.keyword, pureBrandKeywords)) return false
  if (!hasDemandAnchorInCanonicalBucket(item.keyword, pureBrandKeywords)) return false

  const labels = getCanonicalSourceLabels(item)
  if (!labels.some((label) => PRODUCT_MODEL_INTENT_RELAXED_SOURCES.has(label))) return false

  const normalizedKeyword = normalizeGoogleAdsKeyword(item.keyword) || ''
  if (!normalizedKeyword) return false
  const keywordTokens = normalizedKeyword.split(/\s+/).filter(Boolean)
  if (keywordTokens.length < 3) return false

  const demandTokens = extractCanonicalDemandTokens(item.keyword, pureBrandKeywords).filter(
    (token) => token.length >= 3
  )
  if (demandTokens.length < 2) return false

  return demandTokens.some((token) => !PRODUCT_MODEL_INTENT_WEAK_DEMAND_TOKENS.has(token))
}

function hasLinkTypeModelIntentFamilyRescueSignal(
  item: PoolKeywordData,
  pureBrandKeywords: string[],
  linkType: 'product' | 'store'
): boolean {
  if (linkType === 'store') {
    return hasStoreModelIntentFamilyRescueSignal(item, pureBrandKeywords)
  }
  return hasProductModelIntentFamilyRescueSignal(item, pureBrandKeywords)
}

function shouldDropCanonicalKeyword(
  item: PoolKeywordData,
  creativeType: CanonicalCreativeType,
  pureBrandKeywords: string[],
  linkType: 'product' | 'store' = 'product'
): boolean {
  const keyword = item.keyword
  if (!keyword) return true
  const normalizedKeyword = normalizeGoogleAdsKeyword(keyword) || keyword
  if (CANONICAL_PLATFORM_PATTERN.test(normalizedKeyword)) return true
  if (CANONICAL_INFO_QUERY_PATTERN.test(normalizedKeyword)) return true
  if (CANONICAL_REVIEW_COMPARE_PATTERN.test(normalizedKeyword)) return true
  if (CANONICAL_REPEATED_ACTION_PATTERN.test(normalizedKeyword)) return true
  if (CANONICAL_BRAND_SLOGAN_PATTERN.test(normalizedKeyword)) return true
  if (CANONICAL_GARBAGE_TOKEN_PATTERN.test(normalizedKeyword)) return true

  const hasDemandAnchor = hasDemandAnchorInCanonicalBucket(keyword, pureBrandKeywords)
  const isPureBrand = isPureBrandPoolKeyword(item, pureBrandKeywords)
  const hasModelAnchor = hasModelAnchorEvidence({ keywords: [keyword] })
  const hasSoftModelFamilySignal = hasSoftModelFamilySignalInCanonicalBucket(
    keyword,
    pureBrandKeywords
  )
  const hasModelFamilyRescueSignal = hasLinkTypeModelIntentFamilyRescueSignal(
    item,
    pureBrandKeywords,
    linkType
  )
  const canRelaxByHighPrioritySource =
    isHighPriorityCanonicalSource(item) &&
    (hasDemandAnchor || hasModelAnchor || hasSoftModelFamilySignal)
  if (CANONICAL_GEO_ADMIN_PATTERN.test(normalizedKeyword) && !hasModelAnchor) return true
  if (
    CANONICAL_QUESTION_PREFIX_PATTERN.test(normalizedKeyword) &&
    !hasDemandAnchor &&
    !hasModelAnchor &&
    !hasSoftModelFamilySignal
  )
    return true

  if (
    CANONICAL_STORE_NAV_PATTERN.test(normalizedKeyword) &&
    !hasDemandAnchor &&
    !canRelaxByHighPrioritySource
  )
    return true
  if (
    CANONICAL_PROMO_PATTERN.test(normalizedKeyword) &&
    !hasDemandAnchor &&
    !canRelaxByHighPrioritySource
  ) {
    return true
  }
  if (
    creativeType === 'model_intent' &&
    !hasModelAnchor &&
    !hasSoftModelFamilySignal &&
    !hasModelFamilyRescueSignal
  )
    return true
  if (creativeType === 'model_intent' && isPureBrand) return true
  if (creativeType === 'product_intent' && hasModelAnchor && !hasDemandAnchor) return true

  return false
}

function scoreCanonicalKeyword(
  item: PoolKeywordData,
  creativeType: CanonicalCreativeType,
  pureBrandKeywords: string[],
  linkType: 'product' | 'store' = 'product'
): number {
  const keyword = item.keyword
  const isPureBrand = isPureBrandPoolKeyword(item, pureBrandKeywords)
  const hasBrand = containsPureBrand(keyword, pureBrandKeywords)
  const hasModelAnchor = hasModelAnchorEvidence({ keywords: [keyword] })
  const hasDemandAnchor = hasDemandAnchorInCanonicalBucket(keyword, pureBrandKeywords)
  const hasSoftModelFamilySignal = hasSoftModelFamilySignalInCanonicalBucket(
    keyword,
    pureBrandKeywords
  )
  const hasModelFamilyRescueSignal = hasLinkTypeModelIntentFamilyRescueSignal(
    item,
    pureBrandKeywords,
    linkType
  )
  const intent = classifyKeywordIntent(keyword).intent

  if (creativeType === 'brand_intent') {
    let score = 0
    if (hasBrand) score += 4
    if (hasDemandAnchor) score += 3
    if (hasModelAnchor) score += 1
    if (isPureBrand) score -= 5
    return score
  }

  if (creativeType === 'model_intent') {
    let score = 0
    if (hasModelAnchor) score += 10
    if (hasSoftModelFamilySignal) score += 7
    if (hasModelFamilyRescueSignal) score += 5
    if (hasDemandAnchor) score += 1
    if (hasBrand) score += 1
    score += getModelIntentCanonicalSourceAdjustment(item)
    score += getModelIntentCanonicalVolumeAdjustment(item)
    score -= getModelIntentCanonicalShapePenalty(keyword, pureBrandKeywords)
    if (!hasModelAnchor && !hasSoftModelFamilySignal) {
      score -= hasModelFamilyRescueSignal ? 2 : 10
    }
    return score
  }

  let score = 0
  if (hasDemandAnchor) score += 4
  if (hasBrand) score += 1
  if (hasModelAnchor) score -= 1
  if (intent === 'TRANSACTIONAL' || intent === 'COMMERCIAL') score += 1
  if (isPureBrand) score -= 6
  return score
}

function sortCanonicalKeywords(
  keywords: PoolKeywordData[],
  creativeType: CanonicalCreativeType,
  pureBrandKeywords: string[],
  linkType: 'product' | 'store' = 'product'
): PoolKeywordData[] {
  const filtered = keywords.filter(
    (item) => !shouldDropCanonicalKeyword(item, creativeType, pureBrandKeywords, linkType)
  )
  const ranked = [...filtered].sort((a, b) => {
    const scoreDiff =
      scoreCanonicalKeyword(b, creativeType, pureBrandKeywords, linkType) -
      scoreCanonicalKeyword(a, creativeType, pureBrandKeywords, linkType)
    if (scoreDiff !== 0) return scoreDiff

    const sourceRankDiff =
      getKeywordSourcePriorityForPoolItem(a) - getKeywordSourcePriorityForPoolItem(b)
    if (sourceRankDiff !== 0) return sourceRankDiff

    const volumeDiff = (b.searchVolume || 0) - (a.searchVolume || 0)
    if (volumeDiff !== 0) return volumeDiff

    const brandDiff =
      Number(containsPureBrand(b.keyword, pureBrandKeywords)) -
      Number(containsPureBrand(a.keyword, pureBrandKeywords))
    if (brandDiff !== 0) return brandDiff

    return a.keyword.length - b.keyword.length
  })

  let finalized = ranked

  if (creativeType === 'product_intent') {
    const nonPureBrand = finalized.filter(
      (item) => !isPureBrandPoolKeyword(item, pureBrandKeywords)
    )
    if (nonPureBrand.length > 0) {
      const pureBrandFallback = finalized.find((item) =>
        isPureBrandPoolKeyword(item, pureBrandKeywords)
      )
      finalized = pureBrandFallback ? [...nonPureBrand, pureBrandFallback] : nonPureBrand
    }
  }

  if (creativeType === 'model_intent') {
    return pruneModelIntentCanonicalVariants(finalized, pureBrandKeywords)
  }

  return pruneCanonicalCommercialVariants(finalized, pureBrandKeywords, creativeType)
}

function isPrimaryCanonicalSource(source: string | undefined): boolean {
  return CANONICAL_PRIMARY_SOURCES.has(String(source || '').toUpperCase())
}

function getCanonicalBucketTargets(
  item: PoolKeywordData,
  pureBrandKeywords: string[],
  linkType: 'product' | 'store' = 'product'
): Array<'A' | 'B' | 'D'> {
  const keyword = item.keyword
  if (!keyword) return []

  const isPureBrand = isPureBrandPoolKeyword(item, pureBrandKeywords)
  const hasBrand = containsPureBrand(keyword, pureBrandKeywords)
  const hasModelAnchor = hasModelAnchorEvidence({ keywords: [keyword] })
  const hasDemandAnchor = hasDemandAnchorInCanonicalBucket(keyword, pureBrandKeywords)
  const hasSoftModelFamilySignal = hasSoftModelFamilySignalInCanonicalBucket(
    keyword,
    pureBrandKeywords
  )
  const hasModelFamilyRescueSignal = hasLinkTypeModelIntentFamilyRescueSignal(
    item,
    pureBrandKeywords,
    linkType
  )
  const targets: Array<'A' | 'B' | 'D'> = []

  if (isPureBrand || (hasBrand && (hasDemandAnchor || hasModelAnchor))) {
    targets.push('A')
  }
  if (hasModelAnchor || hasSoftModelFamilySignal || hasModelFamilyRescueSignal) {
    targets.push('B')
  }
  if (hasDemandAnchor) {
    targets.push('D')
  }

  return targets
}

function buildCanonicalSourceFirstBucketKeywords(
  pool: OfferKeywordPool,
  bucket: 'A' | 'B' | 'D',
  linkType: 'product' | 'store'
): PoolKeywordData[] {
  const pureBrandKeywords = getPoolPureBrandKeywords(pool)
  const bucketCandidates: Record<
    'A' | 'B' | 'D',
    {
      primary: PoolKeywordData[]
      compatibility: PoolKeywordData[]
    }
  > = {
    A: { primary: [], compatibility: [] },
    B: { primary: [], compatibility: [] },
    D: { primary: [], compatibility: [] },
  }

  for (const item of getComprehensiveKeywordsForPool(pool, linkType)) {
    const targets = getCanonicalBucketTargets(item, pureBrandKeywords, linkType)
    if (targets.length === 0) continue

    const sourceTier = isPrimaryCanonicalSource(item.source) ? 'primary' : 'compatibility'

    for (const target of targets) {
      bucketCandidates[target][sourceTier].push(item)
    }
  }

  const merged = mergeKeywordDataLists([
    bucketCandidates[bucket].primary,
    bucketCandidates[bucket].compatibility,
  ])

  if (bucket === 'A') {
    return sortCanonicalKeywords(merged, 'brand_intent', pureBrandKeywords, linkType)
  }

  if (bucket === 'B') {
    return sortCanonicalKeywords(merged, 'model_intent', pureBrandKeywords, linkType)
  }

  return sortCanonicalKeywords(merged, 'product_intent', pureBrandKeywords, linkType)
}

function buildLegacyProjectedCanonicalBucketKeywords(
  pool: OfferKeywordPool,
  bucket: 'A' | 'B' | 'D',
  linkType: 'product' | 'store'
): PoolKeywordData[] {
  const pureBrandKeywords = getPoolPureBrandKeywords(pool)
  const isStore = linkType === 'store'

  if (bucket === 'A') {
    return sortCanonicalKeywords(
      mergeKeywordDataLists([
        pool.brandKeywords,
        isStore ? pool.storeBucketAKeywords : pool.bucketAKeywords,
        isStore ? pool.storeBucketCKeywords : [],
      ]),
      'brand_intent',
      pureBrandKeywords,
      linkType
    )
  }

  if (bucket === 'B') {
    const merged = mergeKeywordDataLists([
      pool.brandKeywords,
      isStore ? pool.storeBucketAKeywords : pool.bucketAKeywords,
      isStore ? pool.storeBucketBKeywords : pool.bucketBKeywords,
      isStore ? pool.storeBucketCKeywords : pool.bucketCKeywords,
      isStore ? pool.storeBucketSKeywords : pool.bucketDKeywords,
    ])
    const modelAnchored = merged.filter(
      (item) =>
        hasModelAnchorEvidence({ keywords: [item.keyword] }) ||
        hasSoftModelFamilySignalInCanonicalBucket(item.keyword, pureBrandKeywords) ||
        hasLinkTypeModelIntentFamilyRescueSignal(item, pureBrandKeywords, linkType)
    )
    return sortCanonicalKeywords(modelAnchored, 'model_intent', pureBrandKeywords, linkType)
  }

  return sortCanonicalKeywords(
    getComprehensiveKeywordsForPool(pool, linkType),
    'product_intent',
    pureBrandKeywords,
    linkType
  )
}

export function buildCanonicalBucketKeywords(
  pool: OfferKeywordPool,
  bucket: 'A' | 'B' | 'D',
  linkType: 'product' | 'store'
): PoolKeywordData[] {
  const sourceFirst = buildCanonicalSourceFirstBucketKeywords(pool, bucket, linkType)
  if (sourceFirst.length > 0) {
    return sourceFirst
  }

  return buildLegacyProjectedCanonicalBucketKeywords(pool, bucket, linkType)
}

interface OfferKeywordContextForCanonicalFilter {
  brand: string | null
  page_type: string | null
  category: string | null
  product_name: string | null
  offer_name: string | null
  target_country: string | null
  target_language: string | null
  scraped_data: string | null
  final_url: string | null
  url: string | null
}

const OFFER_CONTEXT_FILTERED_DERIVED_TAG = 'OFFER_CONTEXT_FILTERED'

function markOfferContextFilteredKeywords(keywords: PoolKeywordData[]): PoolKeywordData[] {
  return keywords.map((item) => {
    const existingTags = Array.isArray((item as any).derivedTags)
      ? (item as any).derivedTags.map((tag: unknown) => String(tag || '').trim()).filter(Boolean)
      : []
    if (
      existingTags.some((tag: string) => tag.toUpperCase() === OFFER_CONTEXT_FILTERED_DERIVED_TAG)
    ) {
      return item
    }

    return {
      ...item,
      derivedTags: [...existingTags, OFFER_CONTEXT_FILTERED_DERIVED_TAG],
    }
  })
}

async function getOfferContextForCanonicalFilter(
  offerId: number
): Promise<OfferKeywordContextForCanonicalFilter | null> {
  const db = await getDatabase()
  return (
    (await db.queryOne<OfferKeywordContextForCanonicalFilter>(
      `SELECT brand, page_type, category, product_name, offer_name, target_country, target_language, scraped_data, final_url, url
     FROM offers
     WHERE id = ?`,
      [offerId]
    )) || null
  )
}

function buildEmptyCanonicalModelIntentFallback(params: {
  offerContext: OfferKeywordContextForCanonicalFilter
  scopeLabel: string
}): PoolKeywordData[] {
  const pageType = String(params.offerContext.page_type || '')
    .trim()
    .toLowerCase()
  if (pageType === 'store') return []

  const modelFamilyContext = buildProductModelFamilyContext({
    brand: params.offerContext.brand,
    product_name: params.offerContext.product_name,
    offer_name: params.offerContext.offer_name,
    scraped_data: params.offerContext.scraped_data,
    final_url: params.offerContext.final_url,
    url: params.offerContext.url,
  })
  const fallbackKeywords = buildProductModelFamilyFallbackKeywords({
    context: modelFamilyContext,
    brandName: params.offerContext.brand,
  })
  if (fallbackKeywords.length === 0) return []

  const normalizedModelCodes = Array.from(
    new Set(
      modelFamilyContext.modelCodes
        .map((item) => normalizeGoogleAdsKeyword(item))
        .filter((item): item is string => Boolean(item))
    )
  )
  const structuredModelFallbackKeywords =
    normalizedModelCodes.length > 0
      ? fallbackKeywords.filter((keyword) => {
          const normalizedKeyword = normalizeGoogleAdsKeyword(keyword) || ''
          if (!normalizedKeyword) return false
          const keywordTokens = new Set(normalizedKeyword.split(/\s+/).filter(Boolean))
          return normalizedModelCodes.some((code) => keywordTokens.has(code))
        })
      : fallbackKeywords

  const effectiveFallbackKeywords =
    structuredModelFallbackKeywords.length > 0
      ? structuredModelFallbackKeywords
      : normalizedModelCodes.length > 0
        ? []
        : fallbackKeywords
  if (effectiveFallbackKeywords.length === 0) return []

  const fallbackSource =
    normalizedModelCodes.length > 0 ? 'MODEL_ENTITY_FALLBACK' : 'MODEL_FAMILY_GUARD'

  console.warn(
    `⚠️ model_intent canonical 为空，已注入 ${effectiveFallbackKeywords.length} 个${normalizedModelCodes.length > 0 ? '结构化型号' : ' soft-family'} fallback (${params.scopeLabel})`
  )

  return effectiveFallbackKeywords.map((keyword) => ({
    keyword,
    searchVolume: 0,
    source: fallbackSource,
    sourceType: fallbackSource,
    sourceSubtype: fallbackSource,
    rawSource: 'DERIVED_RESCUE',
    derivedTags: [fallbackSource, OFFER_CONTEXT_FILTERED_DERIVED_TAG],
    matchType: 'EXACT',
  }))
}

function isModelFamilyGuardPoolKeyword(item: PoolKeywordData | null | undefined): boolean {
  if (!item) return false
  const sourceKeys = [
    (item as any)?.source,
    (item as any)?.sourceType,
    (item as any)?.sourceSubtype,
  ].map((value) =>
    String(value || '')
      .trim()
      .toUpperCase()
  )

  if (sourceKeys.includes('MODEL_FAMILY_GUARD')) return true

  const derivedTags = Array.isArray((item as any)?.derivedTags) ? (item as any).derivedTags : []

  return derivedTags.some(
    (tag: unknown) =>
      String(tag || '')
        .trim()
        .toUpperCase() === 'MODEL_FAMILY_GUARD'
  )
}

function sortModelIntentRescueKeywords(
  keywords: PoolKeywordData[],
  pureBrandKeywords: string[]
): PoolKeywordData[] {
  const ranked = [...keywords].sort((a, b) => {
    const scoreDiff =
      scoreCanonicalKeyword(b, 'model_intent', pureBrandKeywords) -
      scoreCanonicalKeyword(a, 'model_intent', pureBrandKeywords)
    if (scoreDiff !== 0) return scoreDiff

    const sourceRankDiff =
      getKeywordSourcePriorityForPoolItem(a) - getKeywordSourcePriorityForPoolItem(b)
    if (sourceRankDiff !== 0) return sourceRankDiff

    const volumeDiff = (b.searchVolume || 0) - (a.searchVolume || 0)
    if (volumeDiff !== 0) return volumeDiff

    return a.keyword.length - b.keyword.length
  })

  return pruneModelIntentCanonicalVariants(ranked, pureBrandKeywords)
}

function buildCrossBucketModelIntentRescueKeywords(params: {
  offerContext: OfferKeywordContextForCanonicalFilter
  fallbackCandidates: PoolKeywordData[]
  currentKeywords?: PoolKeywordData[]
  blockedKeywordKeys?: string[]
  pureBrandKeywords: string[]
  scopeLabel: string
}): PoolKeywordData[] {
  const modelFamilyContext = buildProductModelFamilyContext({
    brand: params.offerContext.brand,
    product_name: params.offerContext.product_name,
    offer_name: params.offerContext.offer_name,
    scraped_data: params.offerContext.scraped_data,
    final_url: params.offerContext.final_url,
    url: params.offerContext.url,
  })
  const currentKeywordKeys = new Set(
    (params.currentKeywords || [])
      .filter((item) => !isModelFamilyGuardPoolKeyword(item))
      .map((item) => normalizeGoogleAdsKeyword(item.keyword))
      .filter((item): item is string => Boolean(item))
  )
  const blockedKeywordKeySet = new Set(
    (params.blockedKeywordKeys || [])
      .map((item) => normalizeGoogleAdsKeyword(item))
      .filter((item): item is string => Boolean(item))
  )
  const candidates = mergeKeywordDataLists([params.fallbackCandidates])
    .filter((item) => !isModelFamilyGuardPoolKeyword(item))
    .filter((item) => !isPureBrandPoolKeyword(item, params.pureBrandKeywords))
    .filter((item) => containsPureBrand(item.keyword, params.pureBrandKeywords))
    .filter((item) => {
      const normalized = normalizeGoogleAdsKeyword(item.keyword)
      return (
        Boolean(normalized) &&
        !currentKeywordKeys.has(normalized) &&
        !blockedKeywordKeySet.has(normalized)
      )
    })
    .filter((item) => {
      const normalized = normalizeGoogleAdsKeyword(item.keyword) || ''
      if (!normalized) return false
      if (CANONICAL_PLATFORM_PATTERN.test(normalized)) return false
      if (CANONICAL_INFO_QUERY_PATTERN.test(normalized)) return false
      if (CANONICAL_REVIEW_COMPARE_PATTERN.test(normalized)) return false
      if (CANONICAL_STORE_NAV_PATTERN.test(normalized)) return false
      if (CANONICAL_PROMO_PATTERN.test(normalized)) return false
      if (CANONICAL_REPEATED_ACTION_PATTERN.test(normalized)) return false
      if (CANONICAL_BRAND_SLOGAN_PATTERN.test(normalized)) return false
      if (CANONICAL_GEO_ADMIN_PATTERN.test(normalized)) return false
      if (CANONICAL_GARBAGE_TOKEN_PATTERN.test(normalized)) return false
      if (CANONICAL_QUESTION_PREFIX_PATTERN.test(normalized)) return false
      return true
    })

  if (candidates.length === 0) return []

  const filtered = filterKeywordObjectsByProductModelFamily(candidates, modelFamilyContext)
    .filtered.filter((item) => !isModelFamilyGuardPoolKeyword(item))
    .filter((item) => !isPureBrandPoolKeyword(item, params.pureBrandKeywords))

  if (filtered.length === 0) return []

  const positiveVolumeKeywords = filtered.filter((item) => Number(item.searchVolume || 0) > 0)
  const effectiveKeywords =
    positiveVolumeKeywords.length >= MODEL_INTENT_MIN_KEYWORD_FLOOR
      ? positiveVolumeKeywords
      : filtered

  return markOfferContextFilteredKeywords(
    sortModelIntentRescueKeywords(effectiveKeywords, params.pureBrandKeywords)
  )
}

export async function applyOfferContextToCanonicalKeywords(params: {
  offerId: number
  keywords: PoolKeywordData[]
  creativeType: CanonicalCreativeType | null
  scopeLabel: string
  fallbackCandidates?: PoolKeywordData[]
  pureBrandKeywords?: string[]
}): Promise<PoolKeywordData[]> {
  const { offerId, keywords, creativeType, scopeLabel } = params
  if (!creativeType) return keywords
  if (
    creativeType !== 'brand_intent' &&
    creativeType !== 'model_intent' &&
    creativeType !== 'product_intent'
  ) {
    return keywords
  }

  const offerContext = await getOfferContextForCanonicalFilter(offerId)
  if (!offerContext) return keywords
  const pureBrandKeywords = Array.from(
    new Set(
      (params.pureBrandKeywords || [])
        .map((item) => normalizeGoogleAdsKeyword(item))
        .filter((item): item is string => Boolean(item))
    )
  )
  const pageType = String(offerContext.page_type || '')
    .trim()
    .toLowerCase()
  const shouldAttemptModelIntentCrossBucketRescue =
    creativeType === 'model_intent' &&
    pageType === 'product' &&
    Array.isArray(params.fallbackCandidates) &&
    params.fallbackCandidates.length > 0
  if (keywords.length === 0 && creativeType === 'model_intent') {
    if (shouldAttemptModelIntentCrossBucketRescue) {
      const rescued = buildCrossBucketModelIntentRescueKeywords({
        offerContext,
        fallbackCandidates: params.fallbackCandidates || [],
        currentKeywords: keywords,
        blockedKeywordKeys: [],
        pureBrandKeywords,
        scopeLabel,
      })
      if (rescued.length > 0) {
        console.warn(
          `⚠️ model_intent canonical 为空，已回补 ${rescued.length} 个跨桶可信词 (${scopeLabel})`
        )
        return rescued
      }
    }

    return buildEmptyCanonicalModelIntentFallback({
      offerContext,
      scopeLabel,
    })
  }

  const filterResult = filterCreativeKeywordsByOfferContextDetailed({
    offer: offerContext,
    keywordsWithVolume: keywords,
    scopeLabel,
    creativeType,
  })
  const filtered = filterResult.keywords

  if (
    shouldAttemptModelIntentCrossBucketRescue &&
    (filtered.length === 0 || filtered.every((item) => isModelFamilyGuardPoolKeyword(item)))
  ) {
    const rescued = buildCrossBucketModelIntentRescueKeywords({
      offerContext,
      fallbackCandidates: params.fallbackCandidates || [],
      currentKeywords: filtered,
      blockedKeywordKeys: filterResult.blockedKeywordKeys,
      pureBrandKeywords,
      scopeLabel,
    })
    if (rescued.length > 0) {
      console.warn(
        `⚠️ model_intent canonical 退化为 guard/空，已回补 ${rescued.length} 个跨桶可信词 (${scopeLabel})`
      )
      return rescued
    }

    const directFallback = buildEmptyCanonicalModelIntentFallback({
      offerContext,
      scopeLabel,
    })
    if (directFallback.length > 0) {
      return directFallback
    }
  }

  return markOfferContextFilteredKeywords(filtered)
}
