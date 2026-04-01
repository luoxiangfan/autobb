import { normalizeGoogleAdsKeyword } from './google-ads-keyword-normalizer'
import { getMinContextTokenMatchesForKeywordQualityFilter } from './keyword-context-filter'
import { filterKeywordQuality } from './keyword-quality-filter'
import { containsPureBrand, getPureBrandKeywords, isPureBrandKeyword } from './brand-keyword-utils'
import type { CanonicalCreativeType } from './creative-type'
import { resolveCreativeKeywordMinimumOutputCount } from './creative-keyword-output-floor'
import type { PoolKeywordData } from './offer-keyword-pool'
import {
  buildProductModelFamilyContext,
  buildProductModelFamilyFallbackKeywords,
  filterKeywordObjectsByProductModelFamily,
  isKeywordInProductModelFamily,
  MODEL_INTENT_MIN_KEYWORD_FLOOR,
  type ProductModelFamilyContext,
  supplementModelIntentKeywordsWithFallback,
} from './model-intent-family-filter'

interface OfferKeywordContext {
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

const CREATIVE_CONTEXT_GENERIC_TOKENS = new Set([
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
const MODEL_INTENT_TRANSACTIONAL_PATTERN = /\b(buy|shop|purchase|order|discount|sale|deal|coupon|promo|offer|price|cost|cheap)\b/i
const MODEL_INTENT_SOFT_FAMILY_ALLOWED_EXTRA_TOKENS = new Set([
  'size',
])
const MODEL_INTENT_SOFT_FAMILY_BLOCKED_VARIANT_TOKENS = new Set([
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
  .filter(Boolean))
const CREATIVE_CONTEXT_FORBIDDEN_REASON_PATTERN = /(品牌变体词|品牌无关词|平台冲突|语义查询词|不含品牌词)/u

const CREATIVE_CONTEXT_MODEL_CODE_PATTERN = /\b(?:[a-z]{1,6}\d{2,5}[a-z]{0,2}|\d{3,4})\b/i
const CREATIVE_CONTEXT_MAX_WORDS_BY_TYPE: Record<CanonicalCreativeType, number> = {
  brand_intent: 6,
  model_intent: 7,
  product_intent: 8,
}

type IntentTighteningHardBlockReason =
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

type IntentTighteningSoftBlockReason = 'missing_anchor'

const INTENT_TIGHTENING_RELAXABLE_HIGH_PRIORITY_HARD_BLOCK_REASONS = new Set<IntentTighteningHardBlockReason>([
  'underspecified_store_term',
  'weak_product_specificity',
])

interface IntentTighteningEvaluation {
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

interface StoreIntentTighteningContext {
  headAnchorTokens: Set<string>
  richerSiblingTokenSupport: Map<string, number>
}

interface ProductPageIntentSpecificityContext {
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

interface ProductPageIntentSpecificityEvaluation {
  matchedStrongAnchorCount: number
  matchedCategoryHeadCount: number
  matchedSpecificAnchorCount: number
  hasWeakProductSpecificity: boolean
  hasUnexpectedProductModifier: boolean
  hasUnexpectedNumericVariant: boolean
}

const STORE_INTENT_SPECIFICITY_IGNORED_TOKENS = new Set([
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
const PRODUCT_PAGE_CONTAINER_HEAD_TOKENS = new Set([
  'set',
  'kit',
  'system',
  'collection',
  'bundle',
  'pack',
  'series',
  'line',
].map(normalizeContextToken).filter(Boolean))
const PRODUCT_PAGE_SPECIFICITY_NOISE_TOKENS = new Set([
  'pro',
  'plus',
  'max',
  'ultra',
  'mini',
  'lite',
  'edition',
  'version',
  'official',
  'new',
].map(normalizeContextToken).filter(Boolean))
const PRODUCT_PAGE_GENERIC_DRIFT_TOKENS = new Set([
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
].map(normalizeContextToken).filter(Boolean))
const PRODUCT_PAGE_ALLOWED_SOFT_MODIFIER_TOKENS = new Set([
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
].map(normalizeContextToken).filter(Boolean))
const PRODUCT_PAGE_WEAK_SINGLE_SPECIFICITY_TOKENS = new Set([
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
].map(normalizeContextToken).filter(Boolean))
const PRODUCT_PAGE_CONTEXTUAL_GENERIC_MODIFIER_TOKENS = new Set([
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
].map(normalizeContextToken).filter(Boolean))
const PRODUCT_PAGE_PORTABLE_SUPPORT_CONTEXT_TOKENS = new Set([
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
].map(normalizeContextToken).filter(Boolean))
const PRODUCT_PAGE_SPECIFICITY_PREFIX_BREAK_PATTERN = /\s(?:-|–|—|:|\|)\s/u
const PRODUCT_PAGE_SPECIFICITY_WINDOW_BEFORE_HEAD = 5
const PRODUCT_PAGE_SPECIFICITY_WINDOW_AFTER_HEAD = 4
const PRODUCT_PAGE_CORE_SPECIFICITY_WINDOW_BEFORE_HEAD = 3
const PRODUCT_PAGE_CORE_SPECIFICITY_WINDOW_AFTER_HEAD = 0

function resolveCreativeContextMaxWordCount(creativeType: CanonicalCreativeType | null | undefined): number {
  if (!creativeType) return 6
  return CREATIVE_CONTEXT_MAX_WORDS_BY_TYPE[creativeType] || 6
}

function resolveOfferPageTypeForKeywordContext(offer: OfferKeywordContext): 'store' | 'product' {
  const explicit = String(offer.page_type || '').trim().toLowerCase()
  if (explicit === 'store') return 'store'
  if (explicit === 'product') return 'product'

  if (offer.scraped_data) {
    try {
      const parsed = JSON.parse(offer.scraped_data)
      const pageType = String((parsed as any)?.pageType || '').trim().toLowerCase()
      if (pageType === 'store' || pageType === 'product') return pageType

      const productsLen = Array.isArray((parsed as any)?.products) ? (parsed as any).products.length : 0
      const hasStoreName = typeof (parsed as any)?.storeName === 'string' && (parsed as any).storeName.trim().length > 0
      const hasDeep = Boolean((parsed as any)?.deepScrapeResults)
      if (hasStoreName || hasDeep || productsLen >= 2) return 'store'
    } catch {
      // Ignore invalid scraped_data JSON
    }
  }

  return 'product'
}

function extractCategorySignalsForKeywordContext(scrapedData: string | null | undefined): string[] {
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

function collectKeywordContextStructuredTexts(
  value: unknown,
  output: string[],
  key?: string,
  depth: number = 0
): void {
  if (depth > 4 || value == null) return

  const normalizedKey = String(key || '').trim().toLowerCase()
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

function extractStoreSignalsForKeywordQualityContext(scrapedData: string | null | undefined): string[] {
  if (!scrapedData) return []

  try {
    const parsed = JSON.parse(scrapedData)
    if (!parsed || typeof parsed !== 'object') return []

    const collected: string[] = []
    collectKeywordContextStructuredTexts((parsed as any).productDescription, collected, 'productDescription')
    collectKeywordContextStructuredTexts((parsed as any).productCategory, collected, 'productCategory')
    collectKeywordContextStructuredTexts((parsed as any).rawProductTitle, collected, 'rawProductTitle')
    collectKeywordContextStructuredTexts((parsed as any).rawAboutThisItem, collected, 'rawAboutThisItem')
    collectKeywordContextStructuredTexts((parsed as any).supplementalProducts, collected, 'supplementalProducts')
    collectKeywordContextStructuredTexts((parsed as any).deepScrapeResults, collected, 'deepScrapeResults')
    collectKeywordContextStructuredTexts((parsed as any).supplementalSummary, collected, 'supplementalSummary')
    collectKeywordContextStructuredTexts((parsed as any).hotInsights, collected, 'hotInsights')
    collectKeywordContextStructuredTexts((parsed as any).products, collected, 'products')

    return Array.from(new Set(collected))
  } catch {
    return []
  }
}

function buildKeywordQualityProductContext(
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

function normalizeContextToken(token: string): string {
  const normalized = String(token || '').trim().toLowerCase()
  if (!normalized) return ''

  if (normalized.endsWith('ies') && normalized.length > 4) return `${normalized.slice(0, -3)}y`
  if (normalized.endsWith('es') && normalized.length > 4) return normalized.slice(0, -2)
  if (normalized.endsWith('s') && normalized.length > 3 && !normalized.endsWith('ss')) return normalized.slice(0, -1)
  return normalized
}

function tokenizeContext(text: string): string[] {
  const normalized = normalizeGoogleAdsKeyword(text)
  if (!normalized) return []
  return normalized.split(/\s+/).map(normalizeContextToken).filter(Boolean)
}

function tokenizeStoreIntentSpecificity(text: string, brandName?: string | null): string[] {
  const brandTokens = new Set(tokenizeContext(brandName || ''))
  return tokenizeContext(text)
    .filter((token) => !brandTokens.has(token))
    .filter((token) => !STORE_INTENT_SPECIFICITY_IGNORED_TOKENS.has(token))
}

function getStoreIntentSpecificityHeadToken(text: string, brandName?: string | null): string {
  const tokens = tokenizeStoreIntentSpecificity(text, brandName)
    .filter((token) => !/^\d+$/.test(token))
  return tokens[tokens.length - 1] || ''
}

function buildStoreIntentTighteningContext(params: {
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
    const tokens = Array.from(new Set(
      tokenizeStoreIntentSpecificity(item.keyword, params.brandName)
        .filter((token) => !/^\d+$/.test(token))
    ))
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
      count >= 2
      || categoryHeadTokens.has(token)
      || descriptiveHeadTokens.has(token)
      || explicitModelHeadTokens.has(token)
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

function extractIntentPhraseHeadTokens(text: string, brandName?: string | null): string[] {
  const breadcrumbSegments = String(text || '')
    .split(/\s*(?:>|\/|\|)\s*/g)
    .map((segment) => segment.trim())
    .filter(Boolean)
  const leafBreadcrumbSegments = breadcrumbSegments.length > 0
    ? [breadcrumbSegments[breadcrumbSegments.length - 1] || '']
    : breadcrumbSegments
  const segments = leafBreadcrumbSegments
    .flatMap((segment) => segment.split(/\s*(?:&|,|;)\s*/g))
    .map((segment) => segment.trim())
    .filter(Boolean)

  const heads = new Set<string>()
  for (const segment of segments) {
    const tokens = tokenizeStoreIntentSpecificity(segment, brandName)
      .filter((token) => !/^\d+$/.test(token))
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

function extractLeafIntentSpecificitySegments(text: string): string[] {
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

function shouldAllowCoreSpecificAnchorToken(token: string): boolean {
  return !/^\d+[a-z]{0,4}$/i.test(token)
}

function isNumericLikeProductToken(token: string): boolean {
  return (
    /^\d+$/.test(token)
    || /^\d+[a-z]{0,4}$/i.test(token)
    || /^[a-z]{1,4}\d+[a-z0-9]{0,4}$/i.test(token)
  )
}

function buildProductPageIntentSpecificityContext(params: {
  brandName?: string | null
  productName?: string | null
  categoryTexts?: string[]
  modelFamilyContext?: ProductModelFamilyContext | null
}): ProductPageIntentSpecificityContext | null {
  const categoryHeadTokens = new Set<string>()
  for (const categoryText of params.categoryTexts || []) {
    for (const headToken of extractIntentPhraseHeadTokens(categoryText, params.brandName)) {
      if (PRODUCT_PAGE_GENERIC_DRIFT_TOKENS.has(headToken)) continue
      categoryHeadTokens.add(headToken)
    }
  }

  const specificAnchorTokens = new Set<string>()
  const coreSpecificAnchorTokens = new Set<string>()
  const lineAnchorTokens = new Set<string>()
  const specAnchorTokens = new Set<string>()
  const supportedSoftModifierTokens = new Set<string>()
  const supportedNumericVariantTokens = new Set<string>()
  const titleNumericTokens = new Set<string>()
  const supportedGenericModifierTokens = new Set<string>()
  const productCoreHeadTokens = new Set<string>(
    (params.modelFamilyContext?.productCoreTerms || [])
      .flatMap((value) => tokenizeContext(value))
      .filter((token) => token.length >= 3)
      .filter((token) => !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token) || categoryHeadTokens.has(token))
      .filter((token) => !PRODUCT_PAGE_GENERIC_DRIFT_TOKENS.has(token))
  )
  const leadingProductTitle = (() => {
    const title = String(params.productName || '').trim()
    if (!title) return ''
    return title.split(PRODUCT_PAGE_SPECIFICITY_PREFIX_BREAK_PATTERN)[0] || title
  })()
  const addSpecificAnchorTokens = (values: string[] | null | undefined, ...targets: Set<string>[]) => {
    for (const value of values || []) {
      for (const token of tokenizeContext(value)
        .filter((token) => token.length >= 3)
        .filter((token) => !/^\d+$/.test(token))
        .filter((token) => !PRODUCT_PAGE_SPECIFICITY_NOISE_TOKENS.has(token))
        .filter((token) => !PRODUCT_PAGE_GENERIC_DRIFT_TOKENS.has(token))
        .filter((token) => !categoryHeadTokens.has(token))
        .filter((token) => !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token))) {
        for (const target of targets) {
          target.add(token)
        }
      }
    }
  }
  const pushSupportedGenericModifierTokens = (values?: string[] | null) => {
    for (const value of values || []) {
      const tokens = tokenizeContext(value)
      for (const token of tokens) {
        if (PRODUCT_PAGE_CONTEXTUAL_GENERIC_MODIFIER_TOKENS.has(token)) {
          supportedGenericModifierTokens.add(token)
        }
      }
      if (tokens.some((token) => PRODUCT_PAGE_PORTABLE_SUPPORT_CONTEXT_TOKENS.has(token))) {
        supportedGenericModifierTokens.add('portable')
      }
    }
  }
  if (leadingProductTitle) {
    pushSupportedGenericModifierTokens([leadingProductTitle])
    const titleTokens = tokenizeContext(leadingProductTitle)
    const brandTokens = new Set(tokenizeContext(params.brandName || ''))
    const effectiveHeadTokens = categoryHeadTokens.size > 0
      ? categoryHeadTokens
      : productCoreHeadTokens
    const headIndexes = titleTokens
      .map((token, index) => (effectiveHeadTokens.has(token) ? index : -1))
      .filter((index) => index >= 0)
    const candidateIndexes = new Set<number>()

    if (headIndexes.length > 0) {
      for (const headIndex of headIndexes) {
        const start = Math.max(0, headIndex - PRODUCT_PAGE_SPECIFICITY_WINDOW_BEFORE_HEAD)
        const end = Math.min(titleTokens.length - 1, headIndex + PRODUCT_PAGE_SPECIFICITY_WINDOW_AFTER_HEAD)
        for (let index = start; index <= end; index += 1) {
          candidateIndexes.add(index)
        }
      }
    } else {
      for (let index = 0; index < Math.min(8, titleTokens.length); index += 1) {
        candidateIndexes.add(index)
      }
    }

    const broadTitleSpecificTokens = Array.from(candidateIndexes)
      .sort((a, b) => a - b)
      .map((index) => titleTokens[index])
      .filter((token) => !brandTokens.has(token))
    addSpecificAnchorTokens(broadTitleSpecificTokens, specificAnchorTokens)

    const coreCandidateIndexes = new Set<number>()
    if (headIndexes.length > 0) {
      for (const headIndex of headIndexes) {
        const start = Math.max(0, headIndex - PRODUCT_PAGE_CORE_SPECIFICITY_WINDOW_BEFORE_HEAD)
        const end = Math.min(titleTokens.length - 1, headIndex + PRODUCT_PAGE_CORE_SPECIFICITY_WINDOW_AFTER_HEAD)
        for (let index = start; index <= end; index += 1) {
          coreCandidateIndexes.add(index)
        }
      }
    } else {
      for (let index = 0; index < Math.min(5, titleTokens.length); index += 1) {
        coreCandidateIndexes.add(index)
      }
    }

    addSpecificAnchorTokens(
      Array.from(coreCandidateIndexes)
        .sort((a, b) => a - b)
        .map((index) => titleTokens[index])
        .filter((token) => !brandTokens.has(token)),
      specificAnchorTokens
    )
    addSpecificAnchorTokens(
      Array.from(coreCandidateIndexes)
        .sort((a, b) => a - b)
        .map((index) => titleTokens[index])
        .filter((token) => !brandTokens.has(token))
        .filter((token) => shouldAllowCoreSpecificAnchorToken(token)),
      coreSpecificAnchorTokens
    )
    for (const index of coreCandidateIndexes) {
      const token = titleTokens[index]
      if (PRODUCT_PAGE_ALLOWED_SOFT_MODIFIER_TOKENS.has(token)) {
        supportedSoftModifierTokens.add(token)
      }
      if (isNumericLikeProductToken(token)) {
        titleNumericTokens.add(token)
        supportedNumericVariantTokens.add(token)
      }
    }
  }
  for (const categoryText of params.categoryTexts || []) {
    pushSupportedGenericModifierTokens([categoryText])
    for (const leafSegment of extractLeafIntentSpecificitySegments(categoryText)) {
      const categoryTokens = tokenizeContext(leafSegment)
      const headIndexes = categoryTokens
        .map((token, index) => (categoryHeadTokens.has(token) ? index : -1))
        .filter((index) => index >= 0)
      const candidateIndexes = new Set<number>()
      for (const headIndex of headIndexes) {
        const start = Math.max(0, headIndex - 3)
        const end = Math.min(categoryTokens.length - 1, headIndex + 1)
        for (let index = start; index <= end; index += 1) {
          candidateIndexes.add(index)
        }
      }
      addSpecificAnchorTokens(
        Array.from(candidateIndexes)
          .sort((a, b) => a - b)
          .map((index) => categoryTokens[index]),
        specificAnchorTokens
      )
    }
  }

  const strongAnchorTokens = new Set<string>([...categoryHeadTokens, ...specificAnchorTokens])
  const pushAnchorTokens = (values?: string[] | null) => {
    for (const value of values || []) {
      for (const token of tokenizeContext(value)
        .filter((token) => token.length >= 3)
        .filter((token) => !/^\d+$/.test(token))
        .filter((token) => !PRODUCT_PAGE_GENERIC_DRIFT_TOKENS.has(token))
        .filter((token) => !PRODUCT_PAGE_SPECIFICITY_NOISE_TOKENS.has(token))
        .filter((token) => !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token) || categoryHeadTokens.has(token))) {
        if (!categoryHeadTokens.has(token) && !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token)) {
          specificAnchorTokens.add(token)
        }
        strongAnchorTokens.add(token)
      }
    }
  }

  pushAnchorTokens(params.modelFamilyContext?.lineTerms)
  pushAnchorTokens(params.modelFamilyContext?.productCoreTerms)
  pushAnchorTokens(params.modelFamilyContext?.attributeTerms)
  pushAnchorTokens(params.modelFamilyContext?.softFamilyTerms)
  const pushSupportedSoftVariantTokens = (values?: string[]) => {
    for (const value of values || []) {
      for (const token of tokenizeContext(value)) {
        if (PRODUCT_PAGE_ALLOWED_SOFT_MODIFIER_TOKENS.has(token)) {
          supportedSoftModifierTokens.add(token)
        }
        if (isNumericLikeProductToken(token)) {
          supportedNumericVariantTokens.add(token)
        }
      }
    }
  }
  pushSupportedSoftVariantTokens(params.modelFamilyContext?.lineTerms)
  pushSupportedSoftVariantTokens(params.modelFamilyContext?.specTerms)
  pushSupportedSoftVariantTokens(params.modelFamilyContext?.productCoreTerms)
  pushSupportedSoftVariantTokens(params.modelFamilyContext?.attributeTerms)
  pushSupportedSoftVariantTokens(params.modelFamilyContext?.softFamilyTerms)
  pushSupportedGenericModifierTokens(params.modelFamilyContext?.lineTerms)
  pushSupportedGenericModifierTokens(params.modelFamilyContext?.productCoreTerms)
  pushSupportedGenericModifierTokens(params.modelFamilyContext?.attributeTerms)
  pushSupportedGenericModifierTokens(params.modelFamilyContext?.softFamilyTerms)
  for (const value of params.modelFamilyContext?.lineTerms || []) {
    for (const token of tokenizeContext(value)
      .filter((token) => token.length >= 3)
      .filter((token) => !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token))
      .filter((token) => !PRODUCT_PAGE_GENERIC_DRIFT_TOKENS.has(token))) {
      lineAnchorTokens.add(token)
    }
  }
  for (const value of params.modelFamilyContext?.specTerms || []) {
    for (const token of tokenizeContext(value).filter(isNumericLikeProductToken)) {
      specAnchorTokens.add(token)
      supportedNumericVariantTokens.add(token)
    }
  }
  if (
    supportedSoftModifierTokens.has('california')
    || supportedSoftModifierTokens.has('full')
    || supportedSoftModifierTokens.has('king')
    || supportedSoftModifierTokens.has('queen')
    || supportedSoftModifierTokens.has('twin')
  ) {
    supportedSoftModifierTokens.add('size')
  }

  if (strongAnchorTokens.size === 0 && categoryHeadTokens.size === 0) {
    return null
  }

  return {
    strongAnchorTokens,
    categoryHeadTokens,
    specificAnchorTokens,
    coreSpecificAnchorTokens,
    lineAnchorTokens,
    specAnchorTokens,
    supportedSoftModifierTokens,
    supportedNumericVariantTokens,
    titleNumericTokens,
    supportedGenericModifierTokens,
  }
}

function evaluateProductPageIntentSpecificity(params: {
  keyword: string
  searchVolume?: number
  creativeType: CanonicalCreativeType
  brandName?: string | null
  hasBrand: boolean
  hasExplicitModelCode: boolean
  context?: ProductPageIntentSpecificityContext | null
}): ProductPageIntentSpecificityEvaluation {
  if (!params.context) {
    return {
      matchedStrongAnchorCount: 0,
      matchedCategoryHeadCount: 0,
      matchedSpecificAnchorCount: 0,
      hasWeakProductSpecificity: false,
      hasUnexpectedProductModifier: false,
      hasUnexpectedNumericVariant: false,
    }
  }

  const brandTokens = new Set(tokenizeContext(params.brandName || ''))
  const rawKeywordTokens = tokenizeContext(params.keyword)
    .filter((token) => !brandTokens.has(token))
    .filter((token) => !/^\d+$/.test(token))
  const keywordTokens = Array.from(new Set(
    rawKeywordTokens
      .filter((token) =>
        !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token)
        || params.context?.strongAnchorTokens.has(token)
        || params.context?.categoryHeadTokens.has(token)
      )
  ))
  const matchedStrongAnchorTokens = keywordTokens
    .filter((token) => params.context?.strongAnchorTokens.has(token))
  const matchedCategoryHeadTokens = matchedStrongAnchorTokens
    .filter((token) => params.context?.categoryHeadTokens.has(token))
  const matchedSpecificAnchorTokens = matchedStrongAnchorTokens
    .filter((token) => params.context?.specificAnchorTokens.has(token))
  const matchedCoreSpecificAnchorTokens = matchedStrongAnchorTokens
    .filter((token) => params.context?.coreSpecificAnchorTokens.has(token))
  const matchedLineAnchorTokens = matchedStrongAnchorTokens
    .filter((token) => params.context?.lineAnchorTokens.has(token))
  const matchedSpecAnchorTokens = matchedStrongAnchorTokens
    .filter((token) => params.context?.specAnchorTokens.has(token))
  const matchedStrongAnchorCount = Array.from(new Set(matchedStrongAnchorTokens)).length
  const matchedCategoryHeadCount = Array.from(new Set(matchedCategoryHeadTokens)).length
  const matchedSpecificAnchorCount = Array.from(new Set(matchedSpecificAnchorTokens)).length
  const matchedCoreSpecificAnchorCount = Array.from(new Set(matchedCoreSpecificAnchorTokens)).length
  const matchedLineAnchorCount = Array.from(new Set(matchedLineAnchorTokens)).length
  const matchedSpecAnchorCount = Array.from(new Set(matchedSpecAnchorTokens)).length
  const hasOnlyWeakSingleSpecificity = (
    matchedCoreSpecificAnchorCount > 0
    && matchedCoreSpecificAnchorTokens.every((token) => PRODUCT_PAGE_WEAK_SINGLE_SPECIFICITY_TOKENS.has(token))
  )
  const keywordNumericTokens = Array.from(new Set(
    tokenizeContext(params.keyword)
      .filter((token) => isNumericLikeProductToken(token))
  ))
  const hasUnexpectedNumericVariant = (
    params.context.supportedNumericVariantTokens.size > 0
    && keywordNumericTokens.length > 0
    && keywordNumericTokens.some((token) => !params.context?.supportedNumericVariantTokens.has(token))
  )
  const unexpectedProductModifierTokens = (() => {
    const allowedTokens = new Set<string>([
      ...(params.context?.categoryHeadTokens || []),
      ...(params.context?.specificAnchorTokens || []),
    ])
    let seenAllowedBeforeFor = false
    let seenSpecificAnchorBeforeTail = false
    let seenCategoryHeadBeforeTail = false
    let allowForTail = false
    const unexpected: string[] = []
    const canStartDescriptiveTail = (token: string): boolean => (
      seenAllowedBeforeFor
      && seenSpecificAnchorBeforeTail
      && seenCategoryHeadBeforeTail
      && !PRODUCT_PAGE_GENERIC_DRIFT_TOKENS.has(token)
      && PRODUCT_PAGE_CONTEXTUAL_GENERIC_MODIFIER_TOKENS.has(token)
    )
    const markAllowedToken = (token: string) => {
      if (allowForTail) return
      seenAllowedBeforeFor = true
      if (params.context?.specificAnchorTokens.has(token)) {
        seenSpecificAnchorBeforeTail = true
      }
      if (params.context?.categoryHeadTokens.has(token)) {
        seenCategoryHeadBeforeTail = true
      }
    }

    for (const token of rawKeywordTokens) {
      if (PRODUCT_PAGE_ALLOWED_SOFT_MODIFIER_TOKENS.has(token)) {
        if (params.context?.supportedSoftModifierTokens.has(token)) {
          markAllowedToken(token)
          continue
        }
        unexpected.push(token)
        continue
      }
      if (allowedTokens.has(token)) {
        markAllowedToken(token)
        continue
      }
      if (PRODUCT_PAGE_CONTEXTUAL_GENERIC_MODIFIER_TOKENS.has(token)) {
        if (params.context?.supportedGenericModifierTokens.has(token)) {
          markAllowedToken(token)
          continue
        }
        if (canStartDescriptiveTail(token)) {
          allowForTail = true
          continue
        }
        unexpected.push(token)
        continue
      }
      if (token === 'for') {
        if (!seenAllowedBeforeFor) {
          unexpected.push(token)
        }
        allowForTail = seenAllowedBeforeFor
        continue
      }
      if (
        CREATIVE_CONTEXT_GENERIC_TOKENS.has(token)
        && !PRODUCT_PAGE_GENERIC_DRIFT_TOKENS.has(token)
      ) {
        continue
      }
      if (allowForTail) {
        if (PRODUCT_PAGE_GENERIC_DRIFT_TOKENS.has(token)) {
          unexpected.push(token)
        }
        continue
      }
      unexpected.push(token)
    }

    return Array.from(new Set(unexpected))
  })()
  const hasUnexpectedProductModifier = (
    unexpectedProductModifierTokens.length > 0
  )
  const supportedContextualGenericModifierTokens = Array.from(new Set(
    rawKeywordTokens.filter((token) =>
      PRODUCT_PAGE_CONTEXTUAL_GENERIC_MODIFIER_TOKENS.has(token)
      && params.context?.supportedGenericModifierTokens.has(token)
    )
  ))
  const hasSupportedContextualModifierOnlyDrift = (
    params.hasBrand
    && !params.hasExplicitModelCode
    && supportedContextualGenericModifierTokens.length > 0
    && matchedCategoryHeadCount === 0
    && matchedSpecificAnchorCount <= 1
    && matchedCoreSpecificAnchorCount <= 1
  )
  const hasLineOnlyFamilyDrift = (
    params.hasBrand
    && !params.hasExplicitModelCode
    && matchedCategoryHeadCount === 0
    && matchedCoreSpecificAnchorCount === 0
    && matchedLineAnchorCount === 1
    && matchedStrongAnchorCount === matchedLineAnchorCount
    && keywordTokens.length <= 1
  )
  const hasSpecOnlyProductDrift = (
    params.hasBrand
    && !params.hasExplicitModelCode
    && matchedCategoryHeadCount === 0
    && matchedCoreSpecificAnchorCount === 0
    && matchedSpecAnchorCount > 0
    && matchedStrongAnchorCount === matchedSpecAnchorCount
    && keywordTokens.length <= matchedSpecAnchorCount
  )

  let hasWeakProductSpecificity = false
  if (params.creativeType === 'product_intent') {
    if (!params.hasBrand) {
      hasWeakProductSpecificity = (
        matchedStrongAnchorCount === 0
        || (
          matchedStrongAnchorCount < 2
          && matchedCategoryHeadCount === 0
        )
        || (
          keywordTokens.length <= 1
          && matchedStrongAnchorCount < 2
        )
      )
    } else {
      hasWeakProductSpecificity = (
        matchedStrongAnchorCount === 0
        || (
          !params.hasExplicitModelCode
          && (params.searchVolume || 0) <= 0
          && matchedStrongAnchorCount > 0
          && (matchedCoreSpecificAnchorCount === 0 || hasOnlyWeakSingleSpecificity)
          && keywordTokens.length <= 1
          && params.context.coreSpecificAnchorTokens.size > 0
        )
        || (
          !params.hasExplicitModelCode
          && matchedCategoryHeadCount === 0
          && matchedCoreSpecificAnchorCount === 0
          && matchedSpecificAnchorCount <= 1
          && keywordTokens.length <= 1
        )
        || (
          hasUnexpectedProductModifier
          && params.context.specificAnchorTokens.size > 0
          && matchedSpecificAnchorCount === 0
        )
        || hasSupportedContextualModifierOnlyDrift
        || hasLineOnlyFamilyDrift
        || hasSpecOnlyProductDrift
      )
    }
  } else if (params.creativeType === 'brand_intent' && params.hasBrand) {
    hasWeakProductSpecificity = (
      matchedStrongAnchorCount === 0
      || (
        hasUnexpectedProductModifier
        && params.context.specificAnchorTokens.size > 0
        && matchedSpecificAnchorCount === 0
      )
      || hasSupportedContextualModifierOnlyDrift
      || hasLineOnlyFamilyDrift
      || hasSpecOnlyProductDrift
    )
  } else if (params.creativeType === 'model_intent' && !params.hasExplicitModelCode) {
    if (!params.hasBrand) {
      hasWeakProductSpecificity = (
        matchedStrongAnchorCount < 2
        || (
          keywordTokens.length <= 1
          && matchedCategoryHeadCount === 0
        )
      )
    } else {
      hasWeakProductSpecificity = (
        matchedStrongAnchorCount === 0
        || hasLineOnlyFamilyDrift
        || hasSpecOnlyProductDrift
      )
    }
  }

  return {
    matchedStrongAnchorCount,
    matchedCategoryHeadCount,
    matchedSpecificAnchorCount,
    hasWeakProductSpecificity,
    hasUnexpectedProductModifier,
    hasUnexpectedNumericVariant,
  }
}

function evaluateStoreIntentSpecificity(params: {
  keyword: string
  brandName?: string | null
  context?: StoreIntentTighteningContext | null
}): {
  tokenCount: number
  hasHeadAnchor: boolean
  shouldBlock: boolean
} {
  const tokens = tokenizeStoreIntentSpecificity(params.keyword, params.brandName)
    .filter((token) => !/^\d+$/.test(token))
  if (tokens.length === 0) {
    return {
      tokenCount: 0,
      hasHeadAnchor: false,
      shouldBlock: false,
    }
  }

  const hasHeadAnchor = tokens.some((token) => params.context?.headAnchorTokens.has(token))
  if (tokens.length === 1) {
    const token = tokens[0]
    const siblingSupport = params.context?.richerSiblingTokenSupport.get(token) || 0
    return {
      tokenCount: 1,
      hasHeadAnchor,
      shouldBlock: !hasHeadAnchor || siblingSupport >= 2,
    }
  }

  return {
    tokenCount: tokens.length,
    hasHeadAnchor,
    shouldBlock: !hasHeadAnchor,
  }
}

function hasSoftModelFamilySignals(context?: ProductModelFamilyContext | null): boolean {
  if (!context) return false
  return (
    (context.softFamilyTerms?.length || 0) > 0
    || (
      (context.productCoreTerms?.length || 0) > 0
      && (context.attributeTerms?.length || 0) > 0
    )
  )
}

function hasAnyModelFamilySignals(context?: ProductModelFamilyContext | null): boolean {
  if (!context) return false
  return (
    context.modelCodes.length > 0
    || context.lineTerms.length > 0
    || context.specTerms.length > 0
    || hasSoftModelFamilySignals(context)
  )
}

function buildIntentContextAnchorTokens(params: {
  brandName?: string | null
  categoryContext: string
  productName?: string | null
  modelFamilyContext?: ProductModelFamilyContext | null
  creativeType?: CanonicalCreativeType | null
}): Set<string> {
  const brandTokens = new Set(tokenizeContext(params.brandName || ''))
  const categoryTokens = tokenizeContext(params.categoryContext)
    .filter((token) => token.length >= 3)
    .filter((token) => !brandTokens.has(token))
    .filter((token) => !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token))
  const shouldIncludeLineTerms =
    params.creativeType === 'model_intent'
    || (params.modelFamilyContext?.modelCodes.length || 0) === 0
  const shouldIncludeSoftFamilyTerms =
    params.creativeType === 'model_intent'
    && hasSoftModelFamilySignals(params.modelFamilyContext)
  const modelFamilyTokens = new Set([
    ...(params.modelFamilyContext?.modelCodes || []),
    ...(shouldIncludeLineTerms ? (params.modelFamilyContext?.lineTerms || []) : []),
    ...(params.modelFamilyContext?.specTerms || []),
    ...(shouldIncludeSoftFamilyTerms ? (params.modelFamilyContext?.productCoreTerms || []) : []),
    ...(shouldIncludeSoftFamilyTerms ? (params.modelFamilyContext?.attributeTerms || []) : []),
    ...(shouldIncludeSoftFamilyTerms ? (params.modelFamilyContext?.softFamilyTerms || []) : []),
  ]
    .flatMap((value) => tokenizeContext(value))
    .filter((token) => token.length >= 3)
    .filter((token) => !brandTokens.has(token))
    .filter((token) => !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token)))
  const shouldAllowLongProductTokens =
    (params.modelFamilyContext?.modelCodes.length || 0) === 0
    && (params.modelFamilyContext?.lineTerms.length || 0) === 0
    && !hasSoftModelFamilySignals(params.modelFamilyContext)

  const productTokens = tokenizeContext(params.productName || '')
    .filter((token) => token.length >= 3)
    .filter((token) => !brandTokens.has(token))
    .filter((token) => !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token))
    .filter((token) =>
      categoryTokens.includes(token)
      || modelFamilyTokens.has(token)
      || (/[a-z]/i.test(token) && /\d/.test(token))
      || (shouldAllowLongProductTokens && token.length >= 7)
    )

  return new Set([...categoryTokens, ...modelFamilyTokens, ...productTokens])
}

function hasIntentContextAnchor(params: {
  keyword: string
  anchorTokens: Set<string>
  brandName?: string | null
}): boolean {
  const { keyword, anchorTokens, brandName } = params
  if (anchorTokens.size === 0) return true

  const brandTokens = new Set(tokenizeContext(brandName || ''))
  const keywordTokens = tokenizeContext(keyword)
    .filter((token) => !brandTokens.has(token))
    .filter((token) => !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token) || anchorTokens.has(token))

  if (keywordTokens.length === 0) return false
  return keywordTokens.some((token) => anchorTokens.has(token))
}

function hasUnexpectedSoftFamilyTokens(params: {
  keyword: string
  brandName?: string | null
  anchorTokens: Set<string>
  modelFamilyContext?: ProductModelFamilyContext | null
}): boolean {
  const { keyword, brandName, anchorTokens, modelFamilyContext } = params
  if (!modelFamilyContext) return false
  if (!hasSoftModelFamilySignals(modelFamilyContext)) return false
  if (modelFamilyContext.modelCodes.length > 0 || modelFamilyContext.lineTerms.length > 0) return false

  const brandTokens = new Set(tokenizeContext(brandName || ''))
  const keywordTokens = tokenizeContext(keyword)
    .filter((token) => !brandTokens.has(token))
    .filter((token) => !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token))
  const allowedTokens = new Set([
    ...anchorTokens,
    ...MODEL_INTENT_SOFT_FAMILY_ALLOWED_EXTRA_TOKENS,
  ])

  const unexpectedTokens = keywordTokens
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !allowedTokens.has(token))
  if (unexpectedTokens.length === 0) return false
  if (unexpectedTokens.some((token) => MODEL_INTENT_SOFT_FAMILY_BLOCKED_VARIANT_TOKENS.has(token))) {
    return true
  }

  const normalizedKeyword = normalizeGoogleAdsKeyword(keyword) || ''
  const hasBrand = containsPureBrand(keyword, getPureBrandKeywords(brandName || ''))
  const matchedAnchorCount = keywordTokens.filter((token) => anchorTokens.has(token)).length
  const repeatedDemandToken = hasRepeatedNonNumericDemandToken(keyword, brandName)
  const allowSingleVariantToken = (
    hasBrand
    && matchedAnchorCount >= 1
    && keywordTokens.length <= 6
    && unexpectedTokens.length === 1
    && !repeatedDemandToken
    && !MODEL_INTENT_TRANSACTIONAL_PATTERN.test(normalizedKeyword)
  )
  if (allowSingleVariantToken) return false

  return true
}

function buildAllowedVariantTokens(params: {
  anchorTokens: Set<string>
  modelFamilyContext?: ProductModelFamilyContext | null
}): Set<string> {
  return new Set([
    ...params.anchorTokens,
    ...(params.modelFamilyContext?.modelCodes || [])
      .flatMap((value) => tokenizeContext(value)),
    ...(params.modelFamilyContext?.lineTerms || [])
      .flatMap((value) => tokenizeContext(value)),
    ...(params.modelFamilyContext?.specTerms || [])
      .flatMap((value) => tokenizeContext(value)),
    ...(params.modelFamilyContext?.productCoreTerms || [])
      .flatMap((value) => tokenizeContext(value)),
    ...(params.modelFamilyContext?.attributeTerms || [])
      .flatMap((value) => tokenizeContext(value)),
    ...(params.modelFamilyContext?.softFamilyTerms || [])
      .flatMap((value) => tokenizeContext(value)),
  ])
}

function hasUnexpectedVariantModifierToken(params: {
  keyword: string
  brandName?: string | null
  anchorTokens: Set<string>
  modelFamilyContext?: ProductModelFamilyContext | null
}): boolean {
  const brandTokens = new Set(tokenizeContext(params.brandName || ''))
  const keywordTokens = tokenizeContext(params.keyword)
    .filter((token) => !brandTokens.has(token))
    .filter((token) => !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token))

  const blockedVariantTokens = keywordTokens
    .filter((token) => MODEL_INTENT_SOFT_FAMILY_BLOCKED_VARIANT_TOKENS.has(token))
  if (blockedVariantTokens.length === 0) return false

  const allowedVariantTokens = buildAllowedVariantTokens({
    anchorTokens: params.anchorTokens,
    modelFamilyContext: params.modelFamilyContext,
  })

  return blockedVariantTokens.some((token) => !allowedVariantTokens.has(token))
}

function hasRepeatedNonNumericDemandToken(keyword: string, brandName?: string | null): boolean {
  const brandTokens = new Set(tokenizeContext(brandName || ''))
  const seen = new Set<string>()
  for (const token of tokenizeContext(keyword)) {
    if (!token || brandTokens.has(token) || CREATIVE_CONTEXT_GENERIC_TOKENS.has(token)) continue
    if (/^\d+$/.test(token)) continue
    if (seen.has(token)) return true
    seen.add(token)
  }
  return false
}

function shouldKeepAfterIntentTightening(params: {
  creativeType: CanonicalCreativeType
  keyword: string
  searchVolume?: number
  brandName?: string | null
  anchorTokens: Set<string>
  pageType?: 'store' | 'product'
  modelFamilyContext?: ProductModelFamilyContext | null
  storeIntentContext?: StoreIntentTighteningContext | null
  productPageIntentContext?: ProductPageIntentSpecificityContext | null
}): boolean {
  return evaluateIntentTighteningCandidate(params).keep
}

function evaluateIntentTighteningCandidate(params: {
  creativeType: CanonicalCreativeType
  keyword: string
  searchVolume?: number
  brandName?: string | null
  anchorTokens: Set<string>
  pageType?: 'store' | 'product'
  modelFamilyContext?: ProductModelFamilyContext | null
  storeIntentContext?: StoreIntentTighteningContext | null
  productPageIntentContext?: ProductPageIntentSpecificityContext | null
}): IntentTighteningEvaluation {
  const {
    creativeType,
    keyword,
    brandName,
    anchorTokens,
    pageType,
    modelFamilyContext,
  } = params
  const pureBrandKeywords = getPureBrandKeywords(brandName || '')
  const hasBrand = containsPureBrand(keyword, pureBrandKeywords)
  const isPureBrand = isPureBrandKeyword(keyword, pureBrandKeywords)
  const effectiveAnchorTokens = new Set<string>(anchorTokens)
  for (const token of params.storeIntentContext?.headAnchorTokens || []) {
    effectiveAnchorTokens.add(token)
  }
  const hasAnchor = hasIntentContextAnchor({ keyword, anchorTokens: effectiveAnchorTokens, brandName })
  const normalizedKeyword = normalizeGoogleAdsKeyword(keyword) || ''
  const hasExplicitModelCode = CREATIVE_CONTEXT_MODEL_CODE_PATTERN.test(normalizedKeyword)
  const isForeignExplicitModel = Boolean(
    pageType === 'product'
    && hasExplicitModelCode
    && modelFamilyContext
    && !isKeywordInProductModelFamily(keyword, modelFamilyContext)
  )
  const hasHardModelFamilySignals =
    pageType === 'product'
    && Boolean(
      modelFamilyContext
      && (
        (modelFamilyContext.modelCodes?.length || 0) > 0
        || (modelFamilyContext.lineTerms?.length || 0) > 0
      )
    )
  const hasModelFamilySignals =
    pageType === 'product'
    && hasAnyModelFamilySignals(modelFamilyContext)
  const isOutsideProductModelFamily =
    Boolean(hasModelFamilySignals && modelFamilyContext)
    && !isKeywordInProductModelFamily(keyword, modelFamilyContext!)
  const isOutsideHardModelFamily =
    Boolean(hasHardModelFamilySignals && modelFamilyContext)
    && !isKeywordInProductModelFamily(keyword, modelFamilyContext!)
  const isTransactional = MODEL_INTENT_TRANSACTIONAL_PATTERN.test(normalizedKeyword)
  const hasUnexpectedVariantModifier =
    pageType === 'product'
    && !isPureBrand
    && hasUnexpectedVariantModifierToken({
      keyword,
      brandName,
      anchorTokens,
      modelFamilyContext,
    })
  const hasRepeatedDemandToken = hasRepeatedNonNumericDemandToken(keyword, brandName)
  const hasUnexpectedSoftTokens = hasUnexpectedSoftFamilyTokens({
    keyword,
    brandName,
    anchorTokens,
    modelFamilyContext,
  })
  const {
    hasWeakProductSpecificity,
    hasUnexpectedProductModifier,
    hasUnexpectedNumericVariant,
  } = evaluateProductPageIntentSpecificity({
    keyword,
    searchVolume: params.searchVolume,
    creativeType,
    brandName,
    hasBrand,
    hasExplicitModelCode,
    context: pageType === 'product' ? params.productPageIntentContext : null,
  })
  const hasUnderspecifiedStoreTerm = (
    pageType === 'store'
    && (creativeType === 'brand_intent' || creativeType === 'product_intent')
    && !isPureBrand
    && !hasExplicitModelCode
    && evaluateStoreIntentSpecificity({
      keyword,
      brandName,
      context: params.storeIntentContext,
    }).shouldBlock
  )

  const hardBlockReasons: IntentTighteningHardBlockReason[] = []
  const softBlockReasons: IntentTighteningSoftBlockReason[] = []
  let keep = true

  if (creativeType === 'brand_intent') {
    if (isPureBrand) {
      keep = true
    } else {
      if (!hasBrand) hardBlockReasons.push('missing_brand')
      if (isForeignExplicitModel) hardBlockReasons.push('foreign_explicit_model')
      if (hasWeakProductSpecificity) hardBlockReasons.push('weak_product_specificity')
      if (hasUnexpectedNumericVariant) hardBlockReasons.push('unexpected_numeric_variant')
      if (hasUnexpectedProductModifier) hardBlockReasons.push('unexpected_product_modifier')
      if (hasUnexpectedVariantModifier) hardBlockReasons.push('unexpected_variant_modifier')
      if (hasUnderspecifiedStoreTerm) hardBlockReasons.push('underspecified_store_term')
      if (!hasAnchor) softBlockReasons.push('missing_anchor')
      keep = hardBlockReasons.length === 0 && softBlockReasons.length === 0
    }
  } else if (creativeType === 'model_intent') {
    if (isForeignExplicitModel) hardBlockReasons.push('foreign_explicit_model')
    if (isOutsideHardModelFamily) hardBlockReasons.push('outside_hard_model_family')
    if (isTransactional) hardBlockReasons.push('transactional')
    if (hasRepeatedDemandToken) hardBlockReasons.push('repeated_non_numeric_demand_token')
    if (hasWeakProductSpecificity) hardBlockReasons.push('weak_product_specificity')
    if (hasUnexpectedProductModifier) hardBlockReasons.push('unexpected_product_modifier')
    if (hasUnexpectedSoftTokens) hardBlockReasons.push('unexpected_soft_family_tokens')
    if (!hasAnchor) softBlockReasons.push('missing_anchor')
    keep = hardBlockReasons.length === 0 && softBlockReasons.length === 0
  } else if (creativeType === 'product_intent') {
    if (isPureBrand) {
      keep = true
    } else {
      if (isForeignExplicitModel) hardBlockReasons.push('foreign_explicit_model')
      if (hasWeakProductSpecificity) hardBlockReasons.push('weak_product_specificity')
      if (hasUnexpectedNumericVariant) hardBlockReasons.push('unexpected_numeric_variant')
      if (hasUnexpectedProductModifier) hardBlockReasons.push('unexpected_product_modifier')
      if (hasUnexpectedVariantModifier) hardBlockReasons.push('unexpected_variant_modifier')
      if (hasUnderspecifiedStoreTerm) hardBlockReasons.push('underspecified_store_term')
      if (!hasAnchor) softBlockReasons.push('missing_anchor')
      keep = hardBlockReasons.length === 0 && softBlockReasons.length === 0
    }
  }

  return {
    keep,
    hasBrand,
    isPureBrand,
    hasAnchor,
    hasExplicitModelCode,
    isForeignExplicitModel,
    isOutsideProductModelFamily,
    isOutsideHardModelFamily,
    hasUnexpectedSoftTokens,
    hasUnexpectedVariantModifier,
    hasRepeatedDemandToken,
    isTransactional,
    hardBlockReasons,
    softBlockReasons,
  }
}

function scoreIntentTighteningFallbackCandidate(params: {
  creativeType: CanonicalCreativeType
  keyword: string
  searchVolume?: number
  brandName?: string | null
  anchorTokens: Set<string>
  pageType?: 'store' | 'product'
  modelFamilyContext?: ProductModelFamilyContext | null
  storeIntentContext?: StoreIntentTighteningContext | null
  productPageIntentContext?: ProductPageIntentSpecificityContext | null
  evaluation?: IntentTighteningEvaluation
  }): number {
  const {
    creativeType,
    keyword,
    searchVolume,
    evaluation,
  } = params
  const evaluationResult = evaluation || evaluateIntentTighteningCandidate({
    creativeType,
    keyword,
    brandName: params.brandName,
    anchorTokens: params.anchorTokens,
    pageType: params.pageType,
    modelFamilyContext: params.modelFamilyContext,
    storeIntentContext: params.storeIntentContext,
    productPageIntentContext: params.productPageIntentContext,
  })
  const {
    hasBrand,
    isPureBrand,
    hasAnchor,
    hasExplicitModelCode,
    isForeignExplicitModel,
    isOutsideProductModelFamily,
    isOutsideHardModelFamily,
    hasUnexpectedSoftTokens,
    hasRepeatedDemandToken,
    isTransactional,
  } = evaluationResult
  const normalizedKeyword = normalizeGoogleAdsKeyword(keyword) || ''
  const keywordWordCount = normalizedKeyword.split(/\s+/).filter(Boolean).length
  const volumeScore = resolveIntentTighteningVolumeScore(searchVolume)
  const anchorCoverage = resolveIntentTighteningAnchorCoverageScore({
    keyword,
    anchorTokens: params.anchorTokens,
    brandName: params.brandName,
  })
  const lexicalDiversityScore = resolveIntentTighteningLexicalDiversityScore({
    keyword,
    brandName: params.brandName,
  })

  let score = 0
  if (hasAnchor) score += 4
  if (hasBrand) score += 2
  if (!isTransactional) score += 1
  if (hasExplicitModelCode) score += 2
  if (!hasUnexpectedSoftTokens) score += 1
  score += anchorCoverage.score
  score += lexicalDiversityScore
  score += volumeScore
  if (keywordWordCount >= 2 && keywordWordCount <= 6) score += 1
  if (isPureBrand) score += creativeType === 'brand_intent' ? 2 : 0
  if (hasRepeatedDemandToken) score -= 4
  if (isForeignExplicitModel) score -= 8
  if (isOutsideHardModelFamily) score -= 6
  else if (isOutsideProductModelFamily) score -= 2

  if (creativeType === 'model_intent' && !hasBrand && !hasExplicitModelCode && !hasAnchor) {
    score -= 4
  }
  if (creativeType === 'model_intent' && !hasBrand && !hasExplicitModelCode) {
    if (anchorCoverage.nonNumericMatchedAnchorCount >= 2) score += 1
    else if (anchorCoverage.nonNumericMatchedAnchorCount === 0) score -= 1.5
  }
  if (creativeType === 'model_intent' && hasUnexpectedSoftTokens && !hasBrand) {
    score -= 2
  }
  if (creativeType === 'product_intent' && !hasAnchor && !hasBrand) {
    score -= 3
  }

  return score
}

function resolveIntentTighteningVolumeScore(searchVolume?: number): number {
  const volume = Number(searchVolume || 0)
  if (!Number.isFinite(volume) || volume <= 0) return 0
  return Math.min(2.5, Math.log10(volume + 1))
}

function resolveIntentTighteningAnchorCoverageScore(params: {
  keyword: string
  anchorTokens: Set<string>
  brandName?: string | null
}): {
  score: number
  nonNumericMatchedAnchorCount: number
} {
  if (!params.anchorTokens || params.anchorTokens.size === 0) {
    return {
      score: 0,
      nonNumericMatchedAnchorCount: 0,
    }
  }

  const brandTokens = new Set(tokenizeContext(params.brandName || ''))
  const uniqueKeywordTokens = Array.from(new Set(
    tokenizeContext(params.keyword)
      .filter((token) => !brandTokens.has(token))
      .filter((token) => !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token) || params.anchorTokens.has(token))
  ))
  if (uniqueKeywordTokens.length === 0) {
    return {
      score: 0,
      nonNumericMatchedAnchorCount: 0,
    }
  }

  const matchedAnchorTokens = uniqueKeywordTokens
    .filter((token) => params.anchorTokens.has(token))
  const nonNumericMatchedAnchorCount = matchedAnchorTokens
    .filter((token) => !/^\d+$/.test(token))
    .length
  if (matchedAnchorTokens.length === 0) {
    return {
      score: 0,
      nonNumericMatchedAnchorCount,
    }
  }

  let score = Math.min(2.4, matchedAnchorTokens.length * 0.8)
  if (nonNumericMatchedAnchorCount >= 2) score += 1
  if (matchedAnchorTokens.length >= 3) score += 0.6

  return {
    score,
    nonNumericMatchedAnchorCount,
  }
}

function resolveIntentTighteningLexicalDiversityScore(params: {
  keyword: string
  brandName?: string | null
}): number {
  const brandTokens = new Set(tokenizeContext(params.brandName || ''))
  const tokens = tokenizeContext(params.keyword)
    .filter((token) => !brandTokens.has(token))
    .filter((token) => !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token))
  if (tokens.length <= 1) return 0

  const nonNumericTokens = tokens.filter((token) => !/^\d+$/.test(token))
  if (nonNumericTokens.length <= 1) return 0

  const uniqueNonNumericTokens = new Set(nonNumericTokens)
  const uniqueRatio = uniqueNonNumericTokens.size / nonNumericTokens.length
  if (uniqueRatio >= 0.9) return 0.8
  if (uniqueRatio >= 0.75) return 0.3
  return -1
}

function resolveIntentTighteningSourceTrustScore(item: Pick<
  PoolKeywordData,
  'source' | 'sourceType' | 'sourceSubtype' | 'rawSource' | 'derivedTags'
>): number {
  const tags = new Set(
    [
      item.source,
      item.sourceType,
      item.sourceSubtype,
      item.rawSource,
      ...(Array.isArray(item.derivedTags) ? item.derivedTags : []),
    ]
      .map((value) => String(value || '').trim().toUpperCase())
      .filter(Boolean)
  )
  const has = (pattern: string) => Array.from(tags).some((tag) => tag.includes(pattern))

  if (has('SEARCH_TERM_HIGH_PERFORMING')) return 2.4
  if (has('SEARCH_TERM')) return 2.0
  if (has('HOT_PRODUCT_AGGREGATE') || has('HOT_PRODUCT')) return 1.8
  if (has('KEYWORD_PLANNER_BRAND')) return 1.7
  if (has('KEYWORD_PLANNER') || has('KEYWORD_POOL') || has('CANONICAL_BUCKET_VIEW')) return 1.4
  if (has('PARAM_EXTRACT') || has('TITLE_EXTRACT') || has('ABOUT_EXTRACT')) return 1.3
  if (has('OFFER_EXTRACTED')) return 1.0
  if (has('GOOGLE_SUGGEST')) return 0.9
  if (has('MODEL_FAMILY_GUARD')) return 0.7
  if (has('AI') || has('LLM') || has('CLUSTERED')) return 0.2
  return 0.6
}

function isHighPriorityIntentTighteningSource(item: Pick<
  PoolKeywordData,
  'source' | 'sourceType' | 'sourceSubtype' | 'rawSource' | 'derivedTags' | 'searchVolume'
>): boolean {
  const tags = new Set(
    [
      item.source,
      item.sourceType,
      item.sourceSubtype,
      item.rawSource,
      ...(Array.isArray(item.derivedTags) ? item.derivedTags : []),
    ]
      .map((value) => String(value || '').trim().toUpperCase())
      .filter(Boolean)
  )
  const has = (pattern: string) => Array.from(tags).some((tag) => tag.includes(pattern))

  if (
    has('SEARCH_TERM_HIGH_PERFORMING')
    || has('SEARCH_TERM')
    || has('KEYWORD_PLANNER')
    || has('HOT_PRODUCT_AGGREGATE')
    || has('PARAM_EXTRACT')
    || has('TITLE_EXTRACT')
    || has('ABOUT_EXTRACT')
  ) {
    return true
  }

  const hasTrustedCanonicalSignal = has('DERIVED_TRUSTED')

  return hasTrustedCanonicalSignal
}

function shouldRelaxIntentTighteningForHighPrioritySource(params: {
  creativeType: CanonicalCreativeType
  item: PoolKeywordData
  evaluation: IntentTighteningEvaluation
}): boolean {
  if (!isHighPriorityIntentTighteningSource(params.item)) return false

  const nonRelaxableHardBlocks = params.evaluation.hardBlockReasons.filter((reason) =>
    !INTENT_TIGHTENING_RELAXABLE_HIGH_PRIORITY_HARD_BLOCK_REASONS.has(reason)
  )
  if (nonRelaxableHardBlocks.length > 0) return false

  if (params.creativeType === 'model_intent') {
    if (!params.evaluation.hasBrand && !params.evaluation.hasExplicitModelCode) return false
    if (!params.evaluation.hasAnchor && !params.evaluation.hasExplicitModelCode) return false
    return params.evaluation.hardBlockReasons.length > 0 || params.evaluation.softBlockReasons.length > 0
  }

  if (params.creativeType === 'brand_intent' && !params.evaluation.hasBrand) return false
  if (!params.evaluation.hasBrand && !params.evaluation.hasAnchor) return false

  return params.evaluation.hardBlockReasons.length > 0 || params.evaluation.softBlockReasons.length > 0
}

function resolveIntentTighteningPreferredFloor(params: {
  creativeType: CanonicalCreativeType
  minimumKeywordFloor: number
  candidateCount: number
}): number {
  if (params.creativeType === 'model_intent') {
    return Math.max(params.minimumKeywordFloor, MODEL_INTENT_MIN_KEYWORD_FLOOR)
  }

  const adaptiveTarget = Math.ceil(
    Math.max(params.minimumKeywordFloor, params.candidateCount * 0.06)
  )
  return Math.max(
    params.minimumKeywordFloor,
    Math.min(8, adaptiveTarget)
  )
}

function buildIntentTighteningPermutationKey(keyword: string): string {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return ''
  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length <= 1) return normalized
  return [...tokens].sort().join(' ')
}

function buildIntentTighteningRelaxedFallbackCandidates(params: {
  items: PoolKeywordData[]
  creativeType: CanonicalCreativeType
  brandName?: string | null
  anchorTokens: Set<string>
  pageType?: 'store' | 'product'
  modelFamilyContext?: ProductModelFamilyContext | null
  storeIntentContext?: StoreIntentTighteningContext | null
  productPageIntentContext?: ProductPageIntentSpecificityContext | null
  limit: number
  excludeNormalized?: Set<string>
  excludePermutationKeys?: Set<string>
}): PoolKeywordData[] {
  const limit = Math.max(0, Math.floor(params.limit))
  if (limit <= 0 || params.items.length === 0) return []

  const excluded = new Set<string>()
  const excludedPermutation = new Set<string>()
  for (const normalized of params.excludeNormalized || []) {
    const value = String(normalized || '').trim()
    if (value) excluded.add(value)
  }
  for (const permutationKey of params.excludePermutationKeys || []) {
    const value = String(permutationKey || '').trim()
    if (value) excludedPermutation.add(value)
  }

  const scored = params.items
    .map((item) => {
      const normalized = normalizeGoogleAdsKeyword(item.keyword) || ''
      if (!normalized || excluded.has(normalized)) return null
      const permutationKey = buildIntentTighteningPermutationKey(item.keyword) || normalized
      if (excludedPermutation.has(permutationKey)) return null
      const sourceTrustScore = resolveIntentTighteningSourceTrustScore(item)

      const evaluation = evaluateIntentTighteningCandidate({
        creativeType: params.creativeType,
        keyword: item.keyword,
        searchVolume: item.searchVolume,
        brandName: params.brandName,
        anchorTokens: params.anchorTokens,
        pageType: params.pageType,
        modelFamilyContext: params.modelFamilyContext,
        storeIntentContext: params.storeIntentContext,
        productPageIntentContext: params.productPageIntentContext,
      })
      if (evaluation.keep) return null

      const relaxHighPriorityHardBlock = shouldRelaxIntentTighteningForHighPrioritySource({
        creativeType: params.creativeType,
        item,
        evaluation,
      })
      if (evaluation.hardBlockReasons.length > 0 && !relaxHighPriorityHardBlock) return null

      return {
        item,
        normalized,
        permutationKey,
        sourceTrustScore,
        relaxHighPriorityHardBlock,
        score: scoreIntentTighteningFallbackCandidate({
          creativeType: params.creativeType,
          keyword: item.keyword,
          searchVolume: item.searchVolume,
          brandName: params.brandName,
          anchorTokens: params.anchorTokens,
          pageType: params.pageType,
          modelFamilyContext: params.modelFamilyContext,
          storeIntentContext: params.storeIntentContext,
          productPageIntentContext: params.productPageIntentContext,
          evaluation,
        }) + sourceTrustScore + (relaxHighPriorityHardBlock ? 0.8 : 0),
      }
    })
    .filter((item): item is {
      item: PoolKeywordData
      normalized: string
      permutationKey: string
      sourceTrustScore: number
      relaxHighPriorityHardBlock: boolean
      score: number
    } => item !== null)
    .sort((a, b) => {
      const scoreDiff = b.score - a.score
      if (scoreDiff !== 0) return scoreDiff
      const trustDiff = b.sourceTrustScore - a.sourceTrustScore
      if (trustDiff !== 0) return trustDiff
      const volumeDiff = (b.item.searchVolume || 0) - (a.item.searchVolume || 0)
      if (volumeDiff !== 0) return volumeDiff
      return a.item.keyword.length - b.item.keyword.length
    })
  if (scored.length === 0) return []

  const topScore = scored[0]?.score ?? Number.NEGATIVE_INFINITY
  const minimumAcceptedScore = params.creativeType === 'model_intent' ? 2 : 1
  const adaptiveScoreFloor = params.creativeType === 'model_intent'
    ? Math.max(4, topScore - 2.5)
    : Math.max(2.2, topScore - 2.8)

  const picked: PoolKeywordData[] = []
  for (const [index, item] of scored.entries()) {
    const passFloor = (
      item.score >= adaptiveScoreFloor
      || (index === 0 && item.score >= minimumAcceptedScore)
      || (
        params.creativeType === 'model_intent'
        && item.sourceTrustScore >= 1.8
        && item.relaxHighPriorityHardBlock
        && item.score >= adaptiveScoreFloor - 1.1
      )
      || (
        params.creativeType !== 'model_intent'
        && item.sourceTrustScore >= 1.8
        && item.score >= adaptiveScoreFloor - 0.9
      )
    )
    if (!passFloor) continue
    if (excluded.has(item.normalized)) continue
    if (excludedPermutation.has(item.permutationKey)) continue
    picked.push(item.item)
    excluded.add(item.normalized)
    excludedPermutation.add(item.permutationKey)
    if (picked.length >= limit) break
  }

  return picked
}

function summarizeQualityFilterRemoved(
  removed: Array<{ reason: string }>
): {
  contextMismatchRemovedCount: number
  forbiddenRemovedCount: number
  qualityRemovedCount: number
} {
  const contextMismatchRemovedCount = removed
    .filter((item) => item.reason.includes('与商品无关'))
    .length
  const forbiddenRemovedCount = removed
    .filter((item) => CREATIVE_CONTEXT_FORBIDDEN_REASON_PATTERN.test(item.reason))
    .length
  const qualityRemovedCount = Math.max(
    0,
    removed.length - contextMismatchRemovedCount - forbiddenRemovedCount
  )

  return {
    contextMismatchRemovedCount,
    forbiddenRemovedCount,
    qualityRemovedCount,
  }
}

function normalizeContextFilteredKeywordKey(keyword: string): string {
  return normalizeGoogleAdsKeyword(keyword) || String(keyword || '').trim().toLowerCase()
}

function addBlockedKeywordKey(
  blockedKeywordKeys: Set<string>,
  keyword: string | null | undefined
): void {
  const normalized = normalizeContextFilteredKeywordKey(String(keyword || ''))
  if (normalized) blockedKeywordKeys.add(normalized)
}

export function normalizeCreativeKeywordCandidatesForContextFilter(
  keywordsWithVolume: unknown[],
  fallbackSource: string
): PoolKeywordData[] {
  return keywordsWithVolume
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const keyword = String((item as any).keyword || '').trim()
      if (!keyword) return null

      return {
        ...item,
        keyword,
        searchVolume: typeof (item as any).searchVolume === 'number'
          ? (item as any).searchVolume
          : Number((item as any).searchVolume) || 0,
        source: String((item as any).source || fallbackSource || 'KEYWORD_POOL').trim() || 'KEYWORD_POOL',
        matchType: ((item as any).matchType || 'PHRASE') as 'EXACT' | 'PHRASE' | 'BROAD',
      } as PoolKeywordData
    })
    .filter((item): item is PoolKeywordData => item !== null)
}

export function filterCreativeKeywordsByOfferContextDetailed(params: {
  offer: OfferKeywordContext
  keywordsWithVolume: PoolKeywordData[]
  scopeLabel: string
  creativeType?: CanonicalCreativeType | null
}): {
  keywords: PoolKeywordData[]
  contextMismatchRemovedCount: number
  forbiddenRemovedCount: number
  qualityRemovedCount: number
  modelFamilyRemovedCount: number
  intentTighteningRemovedCount: number
  blockedKeywordKeys: string[]
} {
  const { offer, keywordsWithVolume, scopeLabel, creativeType } = params
  if (keywordsWithVolume.length === 0) {
    return {
      keywords: keywordsWithVolume,
      contextMismatchRemovedCount: 0,
      forbiddenRemovedCount: 0,
      qualityRemovedCount: 0,
      modelFamilyRemovedCount: 0,
      intentTighteningRemovedCount: 0,
      blockedKeywordKeys: [],
    }
  }

  const pageType = resolveOfferPageTypeForKeywordContext(offer)
  const storeKeywordContextSignals = pageType === 'store'
    ? extractStoreSignalsForKeywordQualityContext(offer.scraped_data || null)
    : []
  const baseMinContextTokenMatches = getMinContextTokenMatchesForKeywordQualityFilter({ pageType })
  const minContextTokenMatches = pageType === 'store' && storeKeywordContextSignals.length >= 3
    ? 1
    : baseMinContextTokenMatches
  const categorySignals = extractCategorySignalsForKeywordContext(offer.scraped_data || null)
  const categoryTexts = [offer.category, ...categorySignals]
    .map(value => String(value || '').trim())
    .filter(Boolean)
  const categoryContext = categoryTexts
    .join(' ')
  const keywordQualityProductContext = [
    String(offer.product_name || '').trim(),
    ...storeKeywordContextSignals,
  ]
    .filter(Boolean)
    .slice(0, 12)
    .join(' ') || buildKeywordQualityProductContext(offer, pageType)
  const productPageModelFamilyContext = pageType === 'product'
    ? buildProductModelFamilyContext({
      brand: offer.brand,
      product_name: offer.product_name,
      offer_name: offer.offer_name,
      scraped_data: offer.scraped_data || null,
      final_url: offer.final_url,
      url: offer.url,
    })
    : null

  const qualityFiltered = filterKeywordQuality(keywordsWithVolume, {
    brandName: offer.brand || '',
    category: categoryContext || undefined,
    productName: keywordQualityProductContext,
    targetCountry: offer.target_country || undefined,
    targetLanguage: offer.target_language || undefined,
    productUrl: offer.final_url || offer.url || undefined,
    minWordCount: 1,
    maxWordCount: resolveCreativeContextMaxWordCount(creativeType),
    mustContainBrand: creativeType === 'brand_intent' && String(offer.brand || '').trim().length > 0,
    minContextTokenMatches,
  })

  const {
    contextMismatchRemovedCount,
    forbiddenRemovedCount,
    qualityRemovedCount,
  } = summarizeQualityFilterRemoved(qualityFiltered.removed)
  const blockedKeywordKeys = new Set<string>()
  for (const item of qualityFiltered.removed) {
    addBlockedKeywordKey(blockedKeywordKeys, item.keyword?.keyword)
  }
  if (qualityFiltered.removed.length > 0) {
    console.log(
      `🧹 创意关键词过滤(${scopeLabel}): ${keywordsWithVolume.length} → ${qualityFiltered.filtered.length} ` +
      `(移除 ${qualityFiltered.removed.length}，其中上下文不相关 ${contextMismatchRemovedCount})`
    )
  }

  let modelFamilyFilteredKeywords = qualityFiltered.filtered
  let modelFamilyRemovedCount = 0
  if (creativeType === 'model_intent' && pageType === 'product' && qualityFiltered.filtered.length > 0) {
    const modelFamilyContext = productPageModelFamilyContext || buildProductModelFamilyContext({
      brand: offer.brand,
      product_name: offer.product_name,
      offer_name: offer.offer_name,
      scraped_data: offer.scraped_data || null,
      final_url: offer.final_url,
      url: offer.url,
    })

    const modelFamilyFiltered = filterKeywordObjectsByProductModelFamily(
      qualityFiltered.filtered,
      modelFamilyContext
    )

    if (modelFamilyFiltered.removed.length > 0) {
      modelFamilyRemovedCount = modelFamilyFiltered.removed.length
      for (const item of modelFamilyFiltered.removed) {
        addBlockedKeywordKey(blockedKeywordKeys, item.item?.keyword)
      }
      console.log(
        `🧬 model_intent 型号族过滤(${scopeLabel}): ${qualityFiltered.filtered.length} → ${modelFamilyFiltered.filtered.length} ` +
        `(移除 ${modelFamilyFiltered.removed.length})`
      )
    }

    if (modelFamilyFiltered.filtered.length > 0) {
      modelFamilyFilteredKeywords = modelFamilyFiltered.filtered
    } else {
      const fallbackKeywords = buildProductModelFamilyFallbackKeywords({
        context: modelFamilyContext,
        brandName: offer.brand,
      })

      if (fallbackKeywords.length > 0) {
        const seed = qualityFiltered.filtered[0]
        modelFamilyFilteredKeywords = fallbackKeywords.map((keyword) => ({
          ...seed,
          keyword,
          searchVolume: 0,
          source: 'MODEL_FAMILY_GUARD',
          sourceType: 'MODEL_FAMILY_GUARD',
          sourceSubtype: 'MODEL_FAMILY_GUARD',
          rawSource: 'DERIVED_RESCUE',
          derivedTags: Array.from(new Set([...(seed.derivedTags || []), 'MODEL_FAMILY_GUARD'])),
          matchType: 'EXACT',
        }))
        console.warn(
          `⚠️ model_intent 型号族过滤后无关键词，已注入 ${modelFamilyFilteredKeywords.length} 个兜底型号词 (${scopeLabel})`
        )
      }
    }

    if (modelFamilyFilteredKeywords.length > 0 && modelFamilyFilteredKeywords.length < MODEL_INTENT_MIN_KEYWORD_FLOOR) {
      const seed = modelFamilyFilteredKeywords[0]
      const supplemented = supplementModelIntentKeywordsWithFallback({
        items: modelFamilyFilteredKeywords,
        context: modelFamilyContext,
        brandName: offer.brand,
        minKeywords: MODEL_INTENT_MIN_KEYWORD_FLOOR,
        buildFallbackItem: (keyword) => ({
          ...seed,
          keyword,
          searchVolume: 0,
          source: 'MODEL_FAMILY_GUARD',
          sourceType: 'MODEL_FAMILY_GUARD',
          sourceSubtype: 'MODEL_FAMILY_GUARD',
          rawSource: 'DERIVED_RESCUE',
          derivedTags: Array.from(new Set([...(seed.derivedTags || []), 'MODEL_FAMILY_GUARD'])),
          matchType: 'EXACT' as const,
        }),
      })

      if (supplemented.addedKeywords.length > 0) {
        modelFamilyFilteredKeywords = supplemented.items
        console.log(
          `🧩 model_intent 关键词补足(${scopeLabel}): +${supplemented.addedKeywords.length} ` +
          `(总计 ${modelFamilyFilteredKeywords.length})`
        )
      }
    }
  }

  if (
    (creativeType === 'brand_intent' || creativeType === 'model_intent' || creativeType === 'product_intent')
    && modelFamilyFilteredKeywords.length > 0
  ) {
    const storeIntentContext = (
      pageType === 'store'
      && (creativeType === 'brand_intent' || creativeType === 'product_intent')
    )
      ? buildStoreIntentTighteningContext({
        items: modelFamilyFilteredKeywords,
        brandName: offer.brand,
        categoryTexts,
      })
      : null
    const productPageIntentContext = (
      pageType === 'product'
      && (
        creativeType === 'brand_intent'
        || creativeType === 'model_intent'
        || creativeType === 'product_intent'
      )
    )
      ? buildProductPageIntentSpecificityContext({
        brandName: offer.brand,
        productName: offer.product_name,
        categoryTexts,
        modelFamilyContext: productPageModelFamilyContext,
      })
      : null
    const anchorTokens = buildIntentContextAnchorTokens({
      brandName: offer.brand,
      categoryContext,
      productName: offer.product_name,
      modelFamilyContext: productPageModelFamilyContext,
      creativeType,
    })

    if (anchorTokens.size > 0 || storeIntentContext !== null) {
      const minimumKeywordFloor = resolveCreativeKeywordMinimumOutputCount({
        creativeType,
        maxKeywords: 50,
      })
      const preferredKeywordFloor = resolveIntentTighteningPreferredFloor({
        creativeType,
        minimumKeywordFloor,
        candidateCount: modelFamilyFilteredKeywords.length,
      })
      const tightened = modelFamilyFilteredKeywords.filter((item) =>
        shouldKeepAfterIntentTightening({
          creativeType,
          keyword: item.keyword,
          searchVolume: item.searchVolume,
          brandName: offer.brand,
          anchorTokens,
          pageType,
          modelFamilyContext: productPageModelFamilyContext,
          storeIntentContext,
          productPageIntentContext,
        })
      )

      if (tightened.length > 0) {
        let tightenedResult = tightened
        if (creativeType === 'model_intent' && tightened.length < MODEL_INTENT_MIN_KEYWORD_FLOOR) {
          const tightenedNormalized = new Set(
            tightened.map((item) => normalizeGoogleAdsKeyword(item.keyword) || '')
          )
          const tightenedPermutationKeys = new Set(
            tightened.map((item) => buildIntentTighteningPermutationKey(item.keyword) || normalizeGoogleAdsKeyword(item.keyword) || '')
          )
          const underfillSupplement = buildIntentTighteningRelaxedFallbackCandidates({
            items: modelFamilyFilteredKeywords,
            creativeType,
            brandName: offer.brand,
            anchorTokens,
            pageType,
            modelFamilyContext: productPageModelFamilyContext,
            storeIntentContext,
            productPageIntentContext,
            limit: MODEL_INTENT_MIN_KEYWORD_FLOOR - tightened.length,
            excludeNormalized: tightenedNormalized,
            excludePermutationKeys: tightenedPermutationKeys,
          })
          if (underfillSupplement.length > 0) {
            tightenedResult = [...tightenedResult, ...underfillSupplement]
            console.log(
              `🧩 ${creativeType} 上下文收紧后补位(${scopeLabel}): ${tightened.length} → ${tightenedResult.length}`
            )
          }

          if (tightenedResult.length < MODEL_INTENT_MIN_KEYWORD_FLOOR && pageType === 'product') {
            const modelFamilyContext = productPageModelFamilyContext || buildProductModelFamilyContext({
              brand: offer.brand,
              product_name: offer.product_name,
              offer_name: offer.offer_name,
              scraped_data: offer.scraped_data || null,
              final_url: offer.final_url,
              url: offer.url,
            })
            const fallbackKeywords = buildProductModelFamilyFallbackKeywords({
              context: modelFamilyContext,
              brandName: offer.brand,
            })
            if (fallbackKeywords.length > 0) {
              const currentNormalized = new Set(
                tightenedResult.map((item) => normalizeGoogleAdsKeyword(item.keyword) || '')
              )
              const currentPermutationKeys = new Set(
                tightenedResult.map((item) =>
                  buildIntentTighteningPermutationKey(item.keyword)
                  || normalizeGoogleAdsKeyword(item.keyword)
                  || ''
                )
              )
              const seed = tightenedResult[0] || modelFamilyFilteredKeywords[0]
              const seen = new Set<string>()
              const guardFallbackCandidates: PoolKeywordData[] = []
              for (const keyword of fallbackKeywords) {
                const normalized = normalizeGoogleAdsKeyword(keyword)
                if (!normalized || seen.has(normalized) || currentNormalized.has(normalized)) continue
                const permutationKey = buildIntentTighteningPermutationKey(keyword) || normalized
                if (currentPermutationKeys.has(permutationKey)) continue
                seen.add(normalized)
                guardFallbackCandidates.push({
                  ...seed,
                  keyword,
                  searchVolume: 0,
                  source: 'MODEL_FAMILY_GUARD',
                  sourceType: 'MODEL_FAMILY_GUARD',
                  sourceSubtype: 'MODEL_FAMILY_GUARD',
                  rawSource: 'DERIVED_RESCUE',
                  derivedTags: Array.from(new Set([...(seed.derivedTags || []), 'MODEL_FAMILY_GUARD'])),
                  matchType: 'EXACT' as const,
                })
              }
              const guardSupplement = guardFallbackCandidates
                .filter((item) => shouldKeepAfterIntentTightening({
                  creativeType,
                  keyword: item.keyword,
                  searchVolume: item.searchVolume,
                  brandName: offer.brand,
                  anchorTokens,
                  pageType,
                  modelFamilyContext,
                  storeIntentContext,
                  productPageIntentContext,
                }))
                .slice(0, MODEL_INTENT_MIN_KEYWORD_FLOOR - tightenedResult.length)
              if (guardSupplement.length > 0) {
                tightenedResult = [...tightenedResult, ...guardSupplement]
                console.log(
                  `🧩 ${creativeType} 收紧后安全补位(${scopeLabel}): ${tightened.length} → ${tightenedResult.length}`
                )
              }
            }
          }
        }

        if (creativeType !== 'model_intent' && tightenedResult.length < preferredKeywordFloor) {
          const tightenedNormalized = new Set(
            tightenedResult.map((item) => normalizeGoogleAdsKeyword(item.keyword) || '')
          )
          const tightenedPermutationKeys = new Set(
            tightenedResult.map((item) =>
              buildIntentTighteningPermutationKey(item.keyword)
              || normalizeGoogleAdsKeyword(item.keyword)
              || ''
            )
          )
          const underfillSupplement = buildIntentTighteningRelaxedFallbackCandidates({
            items: modelFamilyFilteredKeywords,
            creativeType,
            brandName: offer.brand,
            anchorTokens,
            pageType,
            modelFamilyContext: productPageModelFamilyContext,
            storeIntentContext,
            productPageIntentContext,
            limit: preferredKeywordFloor - tightenedResult.length,
            excludeNormalized: tightenedNormalized,
            excludePermutationKeys: tightenedPermutationKeys,
          })
          if (underfillSupplement.length > 0) {
            tightenedResult = [...tightenedResult, ...underfillSupplement]
            console.log(
              `🧩 ${creativeType} 收紧后补位(${scopeLabel}): ${tightened.length} → ${tightenedResult.length}`
            )
          }
        }

        const intentTighteningRemovedCount = Math.max(0, modelFamilyFilteredKeywords.length - tightenedResult.length)
        const tightenedResultKeys = new Set(
          tightenedResult.map((item) => normalizeContextFilteredKeywordKey(item.keyword))
        )
        for (const item of modelFamilyFilteredKeywords) {
          if (!tightenedResultKeys.has(normalizeContextFilteredKeywordKey(item.keyword))) {
            addBlockedKeywordKey(blockedKeywordKeys, item.keyword)
          }
        }
        if (intentTighteningRemovedCount > 0) {
          console.log(
            `🎯 ${creativeType} 上下文收紧(${scopeLabel}): ${modelFamilyFilteredKeywords.length} → ${tightenedResult.length}`
          )
        }

        return {
          keywords: tightenedResult,
          contextMismatchRemovedCount,
          forbiddenRemovedCount,
          qualityRemovedCount,
          modelFamilyRemovedCount,
          intentTighteningRemovedCount,
          blockedKeywordKeys: Array.from(blockedKeywordKeys),
        }
      }

      const relaxedFallbackLimit = creativeType === 'model_intent'
        ? Math.max(
          1,
          Math.min(
            MODEL_INTENT_MIN_KEYWORD_FLOOR + 1,
            Math.ceil(Math.max(1, modelFamilyFilteredKeywords.length * 0.35))
          )
        )
        : Math.max(1, preferredKeywordFloor)
      const relaxedFallback = buildIntentTighteningRelaxedFallbackCandidates({
        items: modelFamilyFilteredKeywords,
        creativeType,
        brandName: offer.brand,
        anchorTokens,
        pageType,
        modelFamilyContext: productPageModelFamilyContext,
        storeIntentContext,
        productPageIntentContext,
        limit: relaxedFallbackLimit,
      })
      if (relaxedFallback.length > 0) {
        const relaxedFallbackKeys = new Set(
          relaxedFallback.map((item) => normalizeContextFilteredKeywordKey(item.keyword))
        )
        for (const item of modelFamilyFilteredKeywords) {
          if (!relaxedFallbackKeys.has(normalizeContextFilteredKeywordKey(item.keyword))) {
            addBlockedKeywordKey(blockedKeywordKeys, item.keyword)
          }
        }
        console.warn(
          `⚠️ ${creativeType} 上下文收紧后触发软回退 (${scopeLabel}): ${modelFamilyFilteredKeywords.length} → ${relaxedFallback.length}`
        )
        return {
          keywords: relaxedFallback,
          contextMismatchRemovedCount,
          forbiddenRemovedCount,
          qualityRemovedCount,
          modelFamilyRemovedCount,
          intentTighteningRemovedCount: Math.max(0, modelFamilyFilteredKeywords.length - relaxedFallback.length),
          blockedKeywordKeys: Array.from(blockedKeywordKeys),
        }
      }

      if (creativeType === 'model_intent' && pageType === 'product') {
        const modelFamilyContext = productPageModelFamilyContext || buildProductModelFamilyContext({
          brand: offer.brand,
          product_name: offer.product_name,
          offer_name: offer.offer_name,
          scraped_data: offer.scraped_data || null,
          final_url: offer.final_url,
          url: offer.url,
        })
        const fallbackKeywords = buildProductModelFamilyFallbackKeywords({
          context: modelFamilyContext,
          brandName: offer.brand,
        })
        const seed = modelFamilyFilteredKeywords[0]
        const seen = new Set<string>()
        const guardFallbackCandidates: PoolKeywordData[] = []
        for (const keyword of fallbackKeywords) {
          const normalized = normalizeGoogleAdsKeyword(keyword)
          if (!normalized || seen.has(normalized)) continue
          seen.add(normalized)
          guardFallbackCandidates.push({
            ...seed,
            keyword,
            searchVolume: 0,
            source: 'MODEL_FAMILY_GUARD',
            sourceType: 'MODEL_FAMILY_GUARD',
            sourceSubtype: 'MODEL_FAMILY_GUARD',
            rawSource: 'DERIVED_RESCUE',
            derivedTags: Array.from(new Set([...(seed.derivedTags || []), 'MODEL_FAMILY_GUARD'])),
            matchType: 'EXACT' as const,
          })
        }
        const guardFallback = guardFallbackCandidates
          .filter((item) => shouldKeepAfterIntentTightening({
            creativeType,
            keyword: item.keyword,
            searchVolume: item.searchVolume,
            brandName: offer.brand,
            anchorTokens,
            pageType,
            modelFamilyContext,
            storeIntentContext,
            productPageIntentContext,
          }))
          .slice(0, MODEL_INTENT_MIN_KEYWORD_FLOOR)

        if (guardFallback.length > 0) {
          for (const item of modelFamilyFilteredKeywords) {
            addBlockedKeywordKey(blockedKeywordKeys, item.keyword)
          }
          console.warn(
            `⚠️ ${creativeType} 上下文收紧后仅剩硬阻断候选，已注入型号族安全回退 (${scopeLabel}): ${guardFallback.length}`
          )
          return {
            keywords: guardFallback,
            contextMismatchRemovedCount,
            forbiddenRemovedCount,
            qualityRemovedCount,
            modelFamilyRemovedCount,
            intentTighteningRemovedCount: Math.max(0, modelFamilyFilteredKeywords.length - guardFallback.length),
            blockedKeywordKeys: Array.from(blockedKeywordKeys),
          }
        }
      }

      console.warn(`⚠️ ${creativeType} 上下文收紧后无可用关键词，交由上层 rescue (${modelFamilyFilteredKeywords.length})`)
      for (const item of modelFamilyFilteredKeywords) {
        addBlockedKeywordKey(blockedKeywordKeys, item.keyword)
      }
      return {
        keywords: [],
        contextMismatchRemovedCount,
        forbiddenRemovedCount,
        qualityRemovedCount,
        modelFamilyRemovedCount,
        intentTighteningRemovedCount: modelFamilyFilteredKeywords.length,
        blockedKeywordKeys: Array.from(blockedKeywordKeys),
      }
    }
  }

  return {
    keywords: modelFamilyFilteredKeywords,
    contextMismatchRemovedCount,
    forbiddenRemovedCount,
    qualityRemovedCount,
    modelFamilyRemovedCount,
    intentTighteningRemovedCount: 0,
    blockedKeywordKeys: Array.from(blockedKeywordKeys),
  }
}

export function filterCreativeKeywordsByOfferContext(params: {
  offer: OfferKeywordContext
  keywordsWithVolume: PoolKeywordData[]
  scopeLabel: string
  creativeType?: CanonicalCreativeType | null
}): PoolKeywordData[] {
  return filterCreativeKeywordsByOfferContextDetailed(params).keywords
}

export const __testOnly = {
  normalizeContextToken,
  tokenizeContext,
  buildIntentContextAnchorTokens,
  hasIntentContextAnchor,
  shouldKeepAfterIntentTightening,
}
