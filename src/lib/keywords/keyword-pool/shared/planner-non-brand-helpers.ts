import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { getPureBrandKeywords } from '@/lib/keywords/brand/brand-keyword-utils'
import { containsAsinLikeToken } from '@/lib/creatives/server'
import {
  type ProductModelFamilyContext,
  isKeywordInProductModelFamily,
} from '@/lib/creatives/server'
import {
  getTemplateGarbageReason,
  isSemanticQuery,
  detectPlatformsInKeyword,
} from '@/lib/keywords/keyword-quality-filter'
import { classifyKeywordIntent } from '@/lib/keywords/planner/keyword-intent'
import type { PlannerNonBrandUseCase } from '@/lib/keywords/planner/planner-non-brand-policy'
import type { Offer } from '@/lib/offers/server'

const PLANNER_CONTEXT_STOPWORDS = new Set([
  'with',
  'without',
  'for',
  'from',
  'and',
  'the',
  'new',
  'best',
  'buy',
  'shop',
  'official',
  'store',
  'sale',
  'deal',
  'price',
  'online',
])

function mergeUniqueTags(...inputs: unknown[]): string[] | undefined {
  const tags = new Set<string>()

  for (const input of inputs) {
    const values = Array.isArray(input) ? input : [input]
    for (const value of values) {
      const normalized = String(value || '')
        .trim()
        .toUpperCase()
      if (!normalized) continue
      tags.add(normalized)
    }
  }

  return tags.size > 0 ? Array.from(tags) : undefined
}

function buildOfferContextTokenSet(params: {
  brandName: string
  category: string
  offer?: Offer
  modelFamilyContext?: ProductModelFamilyContext
}): Set<string> {
  const brandTokens = new Set(
    getPureBrandKeywords(params.brandName)
      .flatMap((keyword) => normalizeGoogleAdsKeyword(keyword)?.split(/\s+/) || [])
      .filter(Boolean)
  )

  const tokens = new Set<string>()
  const inputs = [
    params.category,
    params.offer?.category,
    params.offer?.product_name,
    ...(params.modelFamilyContext?.productCoreTerms || []),
    ...(params.modelFamilyContext?.attributeTerms || []),
    ...(params.modelFamilyContext?.softFamilyTerms || []),
  ]

  for (const input of inputs) {
    const normalized = normalizeGoogleAdsKeyword(String(input || ''))
    if (!normalized) continue
    for (const token of normalized.split(/\s+/)) {
      if (!token) continue
      if (token.length <= 2) continue
      if (brandTokens.has(token)) continue
      if (PLANNER_CONTEXT_STOPWORDS.has(token)) continue
      tokens.add(token)
    }
  }

  return tokens
}

function countOfferContextMatches(keyword: string, contextTokens: Set<string>): number {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized || contextTokens.size === 0) return 0

  let matches = 0
  for (const token of new Set(normalized.split(/\s+/).filter(Boolean))) {
    if (contextTokens.has(token)) matches++
  }
  return matches
}

function inferPlannerNonBrandUseCase(params: {
  keyword: string
  pageType: 'product' | 'store'
  targetLanguage: string
  offerContextTokens: Set<string>
  modelFamilyContext?: ProductModelFamilyContext
}): PlannerNonBrandUseCase | undefined {
  const normalizedKeyword = normalizeGoogleAdsKeyword(params.keyword)
  if (!normalizedKeyword) return undefined
  if (containsAsinLikeToken(normalizedKeyword)) return undefined
  if (getTemplateGarbageReason(normalizedKeyword)) return undefined
  if (isSemanticQuery(normalizedKeyword)) return undefined
  if (detectPlatformsInKeyword(normalizedKeyword).length > 0) return undefined

  const intent = classifyKeywordIntent(normalizedKeyword, {
    language: params.targetLanguage || 'en',
  })
  if (intent.hardNegative) return undefined

  if (
    params.pageType === 'product' &&
    params.modelFamilyContext &&
    isKeywordInProductModelFamily(normalizedKeyword, params.modelFamilyContext)
  ) {
    return 'model_family'
  }

  const contextMatches = countOfferContextMatches(normalizedKeyword, params.offerContextTokens)
  if (contextMatches === 0) return undefined

  if (intent.intent === 'TRANSACTIONAL' || intent.intent === 'COMMERCIAL') {
    return 'demand'
  }

  if (params.pageType === 'store') {
    return 'pool'
  }

  return contextMatches >= 2 ? 'pool' : undefined
}

function buildPlannerNonBrandMetadata(useCase: PlannerNonBrandUseCase): {
  sourceType: string
  sourceSubtype: string
  rawSource: 'KEYWORD_PLANNER'
  derivedTags: string[]
} {
  const sourceSubtype =
    useCase === 'model_family'
      ? 'KEYWORD_PLANNER_MODEL_FAMILY'
      : useCase === 'demand'
        ? 'KEYWORD_PLANNER_DEMAND'
        : 'KEYWORD_PLANNER_POOL'

  return {
    sourceType: 'KEYWORD_PLANNER',
    sourceSubtype,
    rawSource: 'KEYWORD_PLANNER',
    derivedTags: [
      'PLANNER_NON_BRAND',
      useCase === 'model_family'
        ? 'PLANNER_NON_BRAND_MODEL_FAMILY'
        : useCase === 'demand'
          ? 'PLANNER_NON_BRAND_DEMAND'
          : 'PLANNER_NON_BRAND_POOL',
    ],
  }
}

function buildPlannerBrandRewriteMetadata(useCase: PlannerNonBrandUseCase): {
  sourceType: string
  sourceSubtype: string
  rawSource: 'KEYWORD_PLANNER'
  derivedTags: string[]
} {
  const sourceSubtype =
    useCase === 'model_family'
      ? 'KEYWORD_PLANNER_MODEL_FAMILY_REWRITE'
      : useCase === 'demand'
        ? 'KEYWORD_PLANNER_DEMAND_REWRITE'
        : 'KEYWORD_PLANNER_POOL_REWRITE'

  return {
    sourceType: 'BRANDED_INDUSTRY_TERM',
    sourceSubtype,
    rawSource: 'KEYWORD_PLANNER',
    derivedTags: [
      'PLANNER_NON_BRAND',
      useCase === 'model_family'
        ? 'PLANNER_NON_BRAND_MODEL_FAMILY'
        : useCase === 'demand'
          ? 'PLANNER_NON_BRAND_DEMAND'
          : 'PLANNER_NON_BRAND_POOL',
      'PURE_BRAND_PREFIX_REWRITE',
    ],
  }
}

export {
  mergeUniqueTags,
  buildOfferContextTokenSet,
  inferPlannerNonBrandUseCase,
  buildPlannerNonBrandMetadata,
  buildPlannerBrandRewriteMetadata,
}
