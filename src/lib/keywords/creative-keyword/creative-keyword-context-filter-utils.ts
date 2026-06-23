/**
 * 创意关键词上下文过滤：信号提取与分词
 */
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import type { CanonicalCreativeType } from '../../creatives/server'
import type { PoolKeywordData } from '../offer-pool'

export interface OfferKeywordContext {
  brand?: string | null
  category?: string | null
  product_name?: string | null
  offer_name?: string | null
  target_country?: string | null
  target_language?: string | null
  final_url?: string | null
  url?: string | null
  page_type?: string | null
  scraped_data?: string | null
}

export const CREATIVE_CONTEXT_GENERIC_TOKENS = new Set([
  'with',
  'without',
  'from',
  'for',
  'into',
  'your',
  'more',
  'less',
  'extra',
  'battery',
  'batteries',
  'power',
  'portable',
  'electric',
  'outdoor',
  'travel',
  'camping',
  'fishing',
  'truck',
  'trucks',
  'solar',
  'ac',
  'dc',
  'and',
  'the',
  'new',
  'best',
  'official',
  'shop',
  'store',
  'buy',
  'price',
  'cost',
  'sale',
  'deal',
  'offer',
  'promo',
  'home',
  'office',
  'bed',
  'room',
  'rooms',
  'kitchen',
  'furniture',
  'bedroom',
  'department',
  'departments',
  'product',
  'products',
  'detail',
  'details',
  'seller',
  'sellers',
  'rank',
  'ranking',
  'top',
  'see',
])
export const MODEL_INTENT_TRANSACTIONAL_PATTERN =
  /\b(buy|shop|purchase|order|discount|sale|deal|coupon|promo|offer|price|cost|cheap)\b/i
export const MODEL_INTENT_SOFT_FAMILY_ALLOWED_EXTRA_TOKENS = new Set(['size'])
export const MODEL_INTENT_SOFT_FAMILY_BLOCKED_VARIANT_TOKENS = new Set(
  [
    'pro',
    'plus',
    'max',
    'ultra',
    'mini',
    'lite',
    'premium',
    'deluxe',
    'edition',
    'version',
    'gen',
    'generation',
  ]
    .map(normalizeContextToken)
    .filter(Boolean)
)
export const CREATIVE_CONTEXT_FORBIDDEN_REASON_PATTERN =
  /(品牌变体词|品牌无关词|平台冲突|语义查询词|不含品牌词)/u

export const CREATIVE_CONTEXT_MODEL_CODE_PATTERN = /\b(?:[a-z]{1,6}\d{2,5}[a-z]{0,2}|\d{3,4})\b/i
const CREATIVE_CONTEXT_MAX_WORDS_BY_TYPE: Record<CanonicalCreativeType, number> = {
  brand_intent: 6,
  model_intent: 7,
  product_intent: 8,
}

export type IntentTighteningHardBlockReason =
  | 'missing_brand'
  | 'foreign_explicit_model'
  | 'outside_hard_model_family'
  | 'transactional'
  | 'repeated_non_numeric_demand_token'
  | 'underspecified_store_term'
  | 'weak_product_specificity'
  | 'unexpected_numeric_variant'
  | 'unexpected_soft_family_tokens'
  | 'unexpected_product_modifier'
  | 'unexpected_variant_modifier'

export type IntentTighteningSoftBlockReason = 'missing_anchor'

export const INTENT_TIGHTENING_RELAXABLE_HIGH_PRIORITY_HARD_BLOCK_REASONS =
  new Set<IntentTighteningHardBlockReason>([
    'underspecified_store_term',
    'weak_product_specificity',
  ])

export interface IntentTighteningEvaluation {
  keep: boolean
  hasBrand: boolean
  isPureBrand: boolean
  hasAnchor: boolean
  hasExplicitModelCode: boolean
  isForeignExplicitModel: boolean
  isOutsideProductModelFamily: boolean
  isOutsideHardModelFamily: boolean
  hasUnexpectedSoftTokens: boolean
  hasUnexpectedVariantModifier: boolean
  hasRepeatedDemandToken: boolean
  isTransactional: boolean
  hardBlockReasons: IntentTighteningHardBlockReason[]
  softBlockReasons: IntentTighteningSoftBlockReason[]
}

export interface StoreIntentTighteningContext {
  headAnchorTokens: Set<string>
  richerSiblingTokenSupport: Map<string, number>
}

export interface ProductPageIntentSpecificityContext {
  strongAnchorTokens: Set<string>
  categoryHeadTokens: Set<string>
  specificAnchorTokens: Set<string>
  coreSpecificAnchorTokens: Set<string>
  lineAnchorTokens: Set<string>
  specAnchorTokens: Set<string>
  supportedSoftModifierTokens: Set<string>
  supportedNumericVariantTokens: Set<string>
  titleNumericTokens: Set<string>
  supportedGenericModifierTokens: Set<string>
}

export interface ProductPageIntentSpecificityEvaluation {
  matchedStrongAnchorCount: number
  matchedCategoryHeadCount: number
  matchedSpecificAnchorCount: number
  hasWeakProductSpecificity: boolean
  hasUnexpectedProductModifier: boolean
  hasUnexpectedNumericVariant: boolean
}

export const STORE_INTENT_SPECIFICITY_IGNORED_TOKENS = new Set([
  'a',
  'an',
  'and',
  'best',
  'brand',
  'buy',
  'cost',
  'deal',
  'deals',
  'discount',
  'feature',
  'featuring',
  'for',
  'from',
  'official',
  'offer',
  'online',
  'order',
  'price',
  'promo',
  'purchase',
  'review',
  'reviews',
  'sale',
  'shop',
  'shopping',
  'shops',
  'store',
  'the',
  'to',
  'with',
  'without',
])
export const PRODUCT_PAGE_CONTAINER_HEAD_TOKENS = new Set(
  ['set', 'kit', 'system', 'collection', 'bundle', 'pack', 'series', 'line']
    .map(normalizeContextToken)
    .filter(Boolean)
)
export const PRODUCT_PAGE_SPECIFICITY_NOISE_TOKENS = new Set(
  ['pro', 'plus', 'max', 'ultra', 'mini', 'lite', 'edition', 'version', 'official', 'new']
    .map(normalizeContextToken)
    .filter(Boolean)
)
export const PRODUCT_PAGE_GENERIC_DRIFT_TOKENS = new Set(
  [
    'accessories',
    'accessory',
    'appliance',
    'appliances',
    'battery',
    'batteries',
    'filter',
    'filters',
    'part',
    'parts',
    'replacement',
    'replacements',
  ]
    .map(normalizeContextToken)
    .filter(Boolean)
)
export const PRODUCT_PAGE_ALLOWED_SOFT_MODIFIER_TOKENS = new Set(
  [
    'california',
    'cooling',
    'firm',
    'foam',
    'full',
    'gel',
    'hybrid',
    'inch',
    'king',
    'latex',
    'medium',
    'memory',
    'plush',
    'queen',
    'size',
    'twin',
  ]
    .map(normalizeContextToken)
    .filter(Boolean)
)
export const PRODUCT_PAGE_WEAK_SINGLE_SPECIFICITY_TOKENS = new Set(
  [
    'compact',
    'cordless',
    'electric',
    'handheld',
    'lightweight',
    'pet',
    'portable',
    'power',
    'solar',
    'stick',
    'upright',
    'wireless',
  ]
    .map(normalizeContextToken)
    .filter(Boolean)
)
export const PRODUCT_PAGE_CONTEXTUAL_GENERIC_MODIFIER_TOKENS = new Set(
  [
    'battery',
    'batteries',
    'compact',
    'cordless',
    'electric',
    'fishing',
    'lightweight',
    'outdoor',
    'pet',
    'portable',
    'power',
    'solar',
    'travel',
    'wireless',
  ]
    .map(normalizeContextToken)
    .filter(Boolean)
)
export const PRODUCT_PAGE_PORTABLE_SUPPORT_CONTEXT_TOKENS = new Set(
  [
    'car',
    'cars',
    'camping',
    'fishing',
    'outdoor',
    'travel',
    'truck',
    'trucks',
    'vehicle',
    'vehicles',
  ]
    .map(normalizeContextToken)
    .filter(Boolean)
)
export const PRODUCT_PAGE_SPECIFICITY_PREFIX_BREAK_PATTERN = /\s(?:-|–|—|:|\|)\s/u
export const PRODUCT_PAGE_SPECIFICITY_WINDOW_BEFORE_HEAD = 5
export const PRODUCT_PAGE_SPECIFICITY_WINDOW_AFTER_HEAD = 4
export const PRODUCT_PAGE_CORE_SPECIFICITY_WINDOW_BEFORE_HEAD = 3
export const PRODUCT_PAGE_CORE_SPECIFICITY_WINDOW_AFTER_HEAD = 0

export function resolveCreativeContextMaxWordCount(
  creativeType: CanonicalCreativeType | null | undefined
): number {
  if (!creativeType) return 6
  return CREATIVE_CONTEXT_MAX_WORDS_BY_TYPE[creativeType] || 6
}

export function resolveOfferPageTypeForKeywordContext(
  offer: OfferKeywordContext
): 'store' | 'product' {
  const explicit = String(offer.page_type || '')
    .trim()
    .toLowerCase()
  if (explicit === 'store') return 'store'
  if (explicit === 'product') return 'product'

  if (offer.scraped_data) {
    try {
      const parsed = JSON.parse(offer.scraped_data)
      const pageType = String((parsed as any)?.pageType || '')
        .trim()
        .toLowerCase()
      if (pageType === 'store' || pageType === 'product') return pageType

      const productsLen = Array.isArray((parsed as any)?.products)
        ? (parsed as any).products.length
        : 0
      const hasStoreName =
        typeof (parsed as any)?.storeName === 'string' &&
        (parsed as any).storeName.trim().length > 0
      const hasDeep = Boolean((parsed as any)?.deepScrapeResults)
      if (hasStoreName || hasDeep || productsLen >= 2) return 'store'
    } catch {
      // Ignore invalid scraped_data JSON
    }
  }

  return 'product'
}

export function extractCategorySignalsForKeywordContext(
  scrapedData: string | null | undefined
): string[] {
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

    return Array.from(new Set(candidates))
  } catch {
    return []
  }
}

const KEYWORD_CONTEXT_STRUCTURED_TEXT_EXCLUDED_KEYS = new Set([
  'finalurl',
  'finalurlsuffix',
  'producturl',
  'imageurl',
  'image',
  'images',
  'price',
  'saleprice',
  'regularprice',
  'rating',
  'reviewcount',
  'rank',
  'hotscore',
  'ishot',
  'hotlabel',
  'targetlanguage',
])

export function collectKeywordContextStructuredTexts(
  value: unknown,
  output: string[],
  key?: string,
  depth: number = 0
): void {
  if (depth > 4 || value == null) return

  const normalizedKey = String(key || '')
    .trim()
    .toLowerCase()
  if (normalizedKey && KEYWORD_CONTEXT_STRUCTURED_TEXT_EXCLUDED_KEYS.has(normalizedKey)) {
    return
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return
    if (/^https?:\/\//i.test(trimmed)) return
    output.push(trimmed)
    return
  }

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 12)) {
      collectKeywordContextStructuredTexts(item, output, key, depth + 1)
    }
    return
  }

  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      collectKeywordContextStructuredTexts(childValue, output, childKey, depth + 1)
    }
  }
}

export function extractStoreSignalsForKeywordQualityContext(
  scrapedData: string | null | undefined
): string[] {
  if (!scrapedData) return []

  try {
    const parsed = JSON.parse(scrapedData)
    if (!parsed || typeof parsed !== 'object') return []

    const collected: string[] = []
    collectKeywordContextStructuredTexts(
      (parsed as any).productDescription,
      collected,
      'productDescription'
    )
    collectKeywordContextStructuredTexts(
      (parsed as any).productCategory,
      collected,
      'productCategory'
    )
    collectKeywordContextStructuredTexts(
      (parsed as any).rawProductTitle,
      collected,
      'rawProductTitle'
    )
    collectKeywordContextStructuredTexts(
      (parsed as any).rawAboutThisItem,
      collected,
      'rawAboutThisItem'
    )
    collectKeywordContextStructuredTexts(
      (parsed as any).supplementalProducts,
      collected,
      'supplementalProducts'
    )
    collectKeywordContextStructuredTexts(
      (parsed as any).deepScrapeResults,
      collected,
      'deepScrapeResults'
    )
    collectKeywordContextStructuredTexts(
      (parsed as any).supplementalSummary,
      collected,
      'supplementalSummary'
    )
    collectKeywordContextStructuredTexts((parsed as any).hotInsights, collected, 'hotInsights')
    collectKeywordContextStructuredTexts((parsed as any).products, collected, 'products')

    return Array.from(new Set(collected))
  } catch {
    return []
  }
}

export function buildKeywordQualityProductContext(
  offer: OfferKeywordContext,
  pageType: 'store' | 'product'
): string | undefined {
  const texts = [
    String(offer.product_name || '').trim(),
    ...(pageType === 'store'
      ? extractStoreSignalsForKeywordQualityContext(offer.scraped_data || null)
      : []),
  ].filter(Boolean)

  if (texts.length === 0) return undefined
  const contextLimit = pageType === 'store' ? 24 : 12
  return Array.from(new Set(texts)).slice(0, contextLimit).join(' | ')
}

export function normalizeContextToken(token: string): string {
  const normalized = String(token || '')
    .trim()
    .toLowerCase()
  if (!normalized) return ''

  if (normalized.endsWith('ies') && normalized.length > 4) return `${normalized.slice(0, -3)}y`
  if (normalized.endsWith('es') && normalized.length > 4) return normalized.slice(0, -2)
  if (normalized.endsWith('s') && normalized.length > 3 && !normalized.endsWith('ss'))
    return normalized.slice(0, -1)
  return normalized
}

export function tokenizeContext(text: string): string[] {
  const normalized = normalizeGoogleAdsKeyword(text)
  if (!normalized) return []
  return normalized.split(/\s+/).map(normalizeContextToken).filter(Boolean)
}

export function tokenizeStoreIntentSpecificity(text: string, brandName?: string | null): string[] {
  const brandTokens = new Set(tokenizeContext(brandName || ''))
  return tokenizeContext(text)
    .filter((token) => !brandTokens.has(token))
    .filter((token) => !STORE_INTENT_SPECIFICITY_IGNORED_TOKENS.has(token))
}

export function getStoreIntentSpecificityHeadToken(
  text: string,
  brandName?: string | null
): string {
  const tokens = tokenizeStoreIntentSpecificity(text, brandName).filter(
    (token) => !/^\d+$/.test(token)
  )
  return tokens[tokens.length - 1] || ''
}

export function buildStoreIntentTighteningContext(params: {
  items: PoolKeywordData[]
  brandName?: string | null
  categoryTexts?: string[]
}): StoreIntentTighteningContext | null {
  const richerSiblingTokenSupport = new Map<string, number>()
  const headTokenCounts = new Map<string, number>()
  const categoryHeadTokens = new Set<string>()
  const descriptiveHeadTokens = new Set<string>()
  const explicitModelHeadTokens = new Set<string>()

  for (const categoryText of params.categoryTexts || []) {
    const headToken = getStoreIntentSpecificityHeadToken(categoryText, params.brandName)
    if (headToken) categoryHeadTokens.add(headToken)
  }

  for (const item of params.items) {
    const tokens = Array.from(
      new Set(
        tokenizeStoreIntentSpecificity(item.keyword, params.brandName).filter(
          (token) => !/^\d+$/.test(token)
        )
      )
    )
    if (tokens.length < 2) continue

    for (const token of tokens) {
      richerSiblingTokenSupport.set(token, (richerSiblingTokenSupport.get(token) || 0) + 1)
    }

    const headToken = tokens[tokens.length - 1] || ''
    if (!headToken) continue
    headTokenCounts.set(headToken, (headTokenCounts.get(headToken) || 0) + 1)
    if (tokens.length >= 3) {
      descriptiveHeadTokens.add(headToken)
    }

    const normalizedKeyword = normalizeGoogleAdsKeyword(item.keyword) || ''
    if (CREATIVE_CONTEXT_MODEL_CODE_PATTERN.test(normalizedKeyword)) {
      explicitModelHeadTokens.add(headToken)
    }
  }

  const headAnchorTokens = new Set<string>(categoryHeadTokens)
  for (const [token, count] of headTokenCounts.entries()) {
    if (
      count >= 2 ||
      categoryHeadTokens.has(token) ||
      descriptiveHeadTokens.has(token) ||
      explicitModelHeadTokens.has(token)
    ) {
      headAnchorTokens.add(token)
    }
  }

  if (headAnchorTokens.size === 0 && richerSiblingTokenSupport.size === 0) {
    return null
  }

  return {
    headAnchorTokens,
    richerSiblingTokenSupport,
  }
}

export function extractIntentPhraseHeadTokens(text: string, brandName?: string | null): string[] {
  const breadcrumbSegments = String(text || '')
    .split(/\s*(?:>|\/|\|)\s*/g)
    .map((segment) => segment.trim())
    .filter(Boolean)
  const leafBreadcrumbSegments =
    breadcrumbSegments.length > 0
      ? [breadcrumbSegments[breadcrumbSegments.length - 1] || '']
      : breadcrumbSegments
  const segments = leafBreadcrumbSegments
    .flatMap((segment) => segment.split(/\s*(?:&|,|;)\s*/g))
    .map((segment) => segment.trim())
    .filter(Boolean)

  const heads = new Set<string>()
  for (const segment of segments) {
    const tokens = tokenizeStoreIntentSpecificity(segment, brandName).filter(
      (token) => !/^\d+$/.test(token)
    )
    if (tokens.length === 0) continue

    const headToken = tokens[tokens.length - 1] || ''
    if (!headToken) continue
    heads.add(headToken)

    if (PRODUCT_PAGE_CONTAINER_HEAD_TOKENS.has(headToken) && tokens.length >= 2) {
      heads.add(tokens[tokens.length - 2] || '')
    }
  }

  return Array.from(heads).filter(Boolean)
}

export function extractLeafIntentSpecificitySegments(text: string): string[] {
  const breadcrumbSegments = String(text || '')
    .split(/\s*(?:>|\/|\|)\s*/g)
    .map((segment) => segment.trim())
    .filter(Boolean)
  const leafSegment = breadcrumbSegments[breadcrumbSegments.length - 1] || String(text || '').trim()
  if (!leafSegment) return []

  return leafSegment
    .split(/\s*(?:&|,|;)\s*/g)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

export function shouldAllowCoreSpecificAnchorToken(token: string): boolean {
  return !/^\d+[a-z]{0,4}$/i.test(token)
}

export function isNumericLikeProductToken(token: string): boolean {
  return (
    /^\d+$/.test(token) ||
    /^\d+[a-z]{0,4}$/i.test(token) ||
    /^[a-z]{1,4}\d+[a-z0-9]{0,4}$/i.test(token)
  )
}
