/**
 * 创意关键词上下文过滤：店铺意图与收紧评分
 */
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import type { CanonicalCreativeType } from '../../creatives/server'
import type { PoolKeywordData } from '../offer-pool'
import {
  containsPureBrand,
  getPureBrandKeywords,
  isPureBrandKeyword,
} from '../brand/brand-keyword-utils'
import {
  isKeywordInProductModelFamily,
  MODEL_INTENT_MIN_KEYWORD_FLOOR,
  type ProductModelFamilyContext,
} from '../../creatives/server'
import {
  tokenizeContext,
  tokenizeStoreIntentSpecificity,
  CREATIVE_CONTEXT_GENERIC_TOKENS,
  CREATIVE_CONTEXT_MODEL_CODE_PATTERN,
  MODEL_INTENT_TRANSACTIONAL_PATTERN,
  MODEL_INTENT_SOFT_FAMILY_ALLOWED_EXTRA_TOKENS,
  MODEL_INTENT_SOFT_FAMILY_BLOCKED_VARIANT_TOKENS,
  INTENT_TIGHTENING_RELAXABLE_HIGH_PRIORITY_HARD_BLOCK_REASONS,
  type IntentTighteningEvaluation,
  type IntentTighteningHardBlockReason,
  type IntentTighteningSoftBlockReason,
  type ProductPageIntentSpecificityContext,
  type StoreIntentTighteningContext,
} from './creative-keyword-context-filter-utils'
import { evaluateProductPageIntentSpecificity } from './creative-keyword-context-filter-product'

export function evaluateStoreIntentSpecificity(params: {
  keyword: string
  brandName?: string | null
  context?: StoreIntentTighteningContext | null
}): {
  tokenCount: number
  hasHeadAnchor: boolean
  shouldBlock: boolean
} {
  const tokens = tokenizeStoreIntentSpecificity(params.keyword, params.brandName).filter(
    (token) => !/^\d+$/.test(token)
  )
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

export function hasSoftModelFamilySignals(context?: ProductModelFamilyContext | null): boolean {
  if (!context) return false
  return (
    (context.softFamilyTerms?.length || 0) > 0 ||
    ((context.productCoreTerms?.length || 0) > 0 && (context.attributeTerms?.length || 0) > 0)
  )
}

export function hasAnyModelFamilySignals(context?: ProductModelFamilyContext | null): boolean {
  if (!context) return false
  return (
    context.modelCodes.length > 0 ||
    context.lineTerms.length > 0 ||
    context.specTerms.length > 0 ||
    hasSoftModelFamilySignals(context)
  )
}

export function buildIntentContextAnchorTokens(params: {
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
    params.creativeType === 'model_intent' ||
    (params.modelFamilyContext?.modelCodes.length || 0) === 0
  const shouldIncludeSoftFamilyTerms =
    params.creativeType === 'model_intent' && hasSoftModelFamilySignals(params.modelFamilyContext)
  const modelFamilyTokens = new Set(
    [
      ...(params.modelFamilyContext?.modelCodes || []),
      ...(shouldIncludeLineTerms ? params.modelFamilyContext?.lineTerms || [] : []),
      ...(params.modelFamilyContext?.specTerms || []),
      ...(shouldIncludeSoftFamilyTerms ? params.modelFamilyContext?.productCoreTerms || [] : []),
      ...(shouldIncludeSoftFamilyTerms ? params.modelFamilyContext?.attributeTerms || [] : []),
      ...(shouldIncludeSoftFamilyTerms ? params.modelFamilyContext?.softFamilyTerms || [] : []),
    ]
      .flatMap((value) => tokenizeContext(value))
      .filter((token) => token.length >= 3)
      .filter((token) => !brandTokens.has(token))
      .filter((token) => !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token))
  )
  const shouldAllowLongProductTokens =
    (params.modelFamilyContext?.modelCodes.length || 0) === 0 &&
    (params.modelFamilyContext?.lineTerms.length || 0) === 0 &&
    !hasSoftModelFamilySignals(params.modelFamilyContext)

  const productTokens = tokenizeContext(params.productName || '')
    .filter((token) => token.length >= 3)
    .filter((token) => !brandTokens.has(token))
    .filter((token) => !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token))
    .filter(
      (token) =>
        categoryTokens.includes(token) ||
        modelFamilyTokens.has(token) ||
        (/[a-z]/i.test(token) && /\d/.test(token)) ||
        (shouldAllowLongProductTokens && token.length >= 7)
    )

  return new Set([...categoryTokens, ...modelFamilyTokens, ...productTokens])
}

export function hasIntentContextAnchor(params: {
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

export function hasUnexpectedSoftFamilyTokens(params: {
  keyword: string
  brandName?: string | null
  anchorTokens: Set<string>
  modelFamilyContext?: ProductModelFamilyContext | null
}): boolean {
  const { keyword, brandName, anchorTokens, modelFamilyContext } = params
  if (!modelFamilyContext) return false
  if (!hasSoftModelFamilySignals(modelFamilyContext)) return false
  if (modelFamilyContext.modelCodes.length > 0 || modelFamilyContext.lineTerms.length > 0)
    return false

  const brandTokens = new Set(tokenizeContext(brandName || ''))
  const keywordTokens = tokenizeContext(keyword)
    .filter((token) => !brandTokens.has(token))
    .filter((token) => !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token))
  const allowedTokens = new Set([...anchorTokens, ...MODEL_INTENT_SOFT_FAMILY_ALLOWED_EXTRA_TOKENS])

  const unexpectedTokens = keywordTokens
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !allowedTokens.has(token))
  if (unexpectedTokens.length === 0) return false
  if (
    unexpectedTokens.some((token) => MODEL_INTENT_SOFT_FAMILY_BLOCKED_VARIANT_TOKENS.has(token))
  ) {
    return true
  }

  const normalizedKeyword = normalizeGoogleAdsKeyword(keyword) || ''
  const hasBrand = containsPureBrand(keyword, getPureBrandKeywords(brandName || ''))
  const matchedAnchorCount = keywordTokens.filter((token) => anchorTokens.has(token)).length
  const repeatedDemandToken = hasRepeatedNonNumericDemandToken(keyword, brandName)
  const allowSingleVariantToken =
    hasBrand &&
    matchedAnchorCount >= 1 &&
    keywordTokens.length <= 6 &&
    unexpectedTokens.length === 1 &&
    !repeatedDemandToken &&
    !MODEL_INTENT_TRANSACTIONAL_PATTERN.test(normalizedKeyword)
  if (allowSingleVariantToken) return false

  return true
}

export function buildAllowedVariantTokens(params: {
  anchorTokens: Set<string>
  modelFamilyContext?: ProductModelFamilyContext | null
}): Set<string> {
  return new Set([
    ...params.anchorTokens,
    ...(params.modelFamilyContext?.modelCodes || []).flatMap((value) => tokenizeContext(value)),
    ...(params.modelFamilyContext?.lineTerms || []).flatMap((value) => tokenizeContext(value)),
    ...(params.modelFamilyContext?.specTerms || []).flatMap((value) => tokenizeContext(value)),
    ...(params.modelFamilyContext?.productCoreTerms || []).flatMap((value) =>
      tokenizeContext(value)
    ),
    ...(params.modelFamilyContext?.attributeTerms || []).flatMap((value) => tokenizeContext(value)),
    ...(params.modelFamilyContext?.softFamilyTerms || []).flatMap((value) =>
      tokenizeContext(value)
    ),
  ])
}

export function hasUnexpectedVariantModifierToken(params: {
  keyword: string
  brandName?: string | null
  anchorTokens: Set<string>
  modelFamilyContext?: ProductModelFamilyContext | null
}): boolean {
  const brandTokens = new Set(tokenizeContext(params.brandName || ''))
  const keywordTokens = tokenizeContext(params.keyword)
    .filter((token) => !brandTokens.has(token))
    .filter((token) => !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token))

  const blockedVariantTokens = keywordTokens.filter((token) =>
    MODEL_INTENT_SOFT_FAMILY_BLOCKED_VARIANT_TOKENS.has(token)
  )
  if (blockedVariantTokens.length === 0) return false

  const allowedVariantTokens = buildAllowedVariantTokens({
    anchorTokens: params.anchorTokens,
    modelFamilyContext: params.modelFamilyContext,
  })

  return blockedVariantTokens.some((token) => !allowedVariantTokens.has(token))
}

export function hasRepeatedNonNumericDemandToken(
  keyword: string,
  brandName?: string | null
): boolean {
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

export function shouldKeepAfterIntentTightening(params: {
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

export function evaluateIntentTighteningCandidate(params: {
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
  const { creativeType, keyword, brandName, anchorTokens, pageType, modelFamilyContext } = params
  const pureBrandKeywords = getPureBrandKeywords(brandName || '')
  const hasBrand = containsPureBrand(keyword, pureBrandKeywords)
  const isPureBrand = isPureBrandKeyword(keyword, pureBrandKeywords)
  const effectiveAnchorTokens = new Set<string>(anchorTokens)
  for (const token of params.storeIntentContext?.headAnchorTokens || []) {
    effectiveAnchorTokens.add(token)
  }
  const hasAnchor = hasIntentContextAnchor({
    keyword,
    anchorTokens: effectiveAnchorTokens,
    brandName,
  })
  const normalizedKeyword = normalizeGoogleAdsKeyword(keyword) || ''
  const hasExplicitModelCode = CREATIVE_CONTEXT_MODEL_CODE_PATTERN.test(normalizedKeyword)
  const isForeignExplicitModel = Boolean(
    pageType === 'product' &&
    hasExplicitModelCode &&
    modelFamilyContext &&
    !isKeywordInProductModelFamily(keyword, modelFamilyContext)
  )
  const hasHardModelFamilySignals =
    pageType === 'product' &&
    Boolean(
      modelFamilyContext &&
      ((modelFamilyContext.modelCodes?.length || 0) > 0 ||
        (modelFamilyContext.lineTerms?.length || 0) > 0)
    )
  const hasModelFamilySignals =
    pageType === 'product' && hasAnyModelFamilySignals(modelFamilyContext)
  const isOutsideProductModelFamily =
    Boolean(hasModelFamilySignals && modelFamilyContext) &&
    !isKeywordInProductModelFamily(keyword, modelFamilyContext!)
  const isOutsideHardModelFamily =
    Boolean(hasHardModelFamilySignals && modelFamilyContext) &&
    !isKeywordInProductModelFamily(keyword, modelFamilyContext!)
  const isTransactional = MODEL_INTENT_TRANSACTIONAL_PATTERN.test(normalizedKeyword)
  const hasUnexpectedVariantModifier =
    pageType === 'product' &&
    !isPureBrand &&
    hasUnexpectedVariantModifierToken({
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
  const { hasWeakProductSpecificity, hasUnexpectedProductModifier, hasUnexpectedNumericVariant } =
    evaluateProductPageIntentSpecificity({
      keyword,
      searchVolume: params.searchVolume,
      creativeType,
      brandName,
      hasBrand,
      hasExplicitModelCode,
      context: pageType === 'product' ? params.productPageIntentContext : null,
    })
  const hasUnderspecifiedStoreTerm =
    pageType === 'store' &&
    (creativeType === 'brand_intent' || creativeType === 'product_intent') &&
    !isPureBrand &&
    !hasExplicitModelCode &&
    evaluateStoreIntentSpecificity({
      keyword,
      brandName,
      context: params.storeIntentContext,
    }).shouldBlock

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

export function scoreIntentTighteningFallbackCandidate(params: {
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
  const { creativeType, keyword, searchVolume, evaluation } = params
  const evaluationResult =
    evaluation ||
    evaluateIntentTighteningCandidate({
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
  const uniqueKeywordTokens = Array.from(
    new Set(
      tokenizeContext(params.keyword)
        .filter((token) => !brandTokens.has(token))
        .filter(
          (token) => !CREATIVE_CONTEXT_GENERIC_TOKENS.has(token) || params.anchorTokens.has(token)
        )
    )
  )
  if (uniqueKeywordTokens.length === 0) {
    return {
      score: 0,
      nonNumericMatchedAnchorCount: 0,
    }
  }

  const matchedAnchorTokens = uniqueKeywordTokens.filter((token) => params.anchorTokens.has(token))
  const nonNumericMatchedAnchorCount = matchedAnchorTokens.filter(
    (token) => !/^\d+$/.test(token)
  ).length
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

function resolveIntentTighteningSourceTrustScore(
  item: Pick<
    PoolKeywordData,
    'source' | 'sourceType' | 'sourceSubtype' | 'rawSource' | 'derivedTags'
  >
): number {
  const tags = new Set(
    [
      item.source,
      item.sourceType,
      item.sourceSubtype,
      item.rawSource,
      ...(Array.isArray(item.derivedTags) ? item.derivedTags : []),
    ]
      .map((value) =>
        String(value || '')
          .trim()
          .toUpperCase()
      )
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

function isHighPriorityIntentTighteningSource(
  item: Pick<
    PoolKeywordData,
    'source' | 'sourceType' | 'sourceSubtype' | 'rawSource' | 'derivedTags' | 'searchVolume'
  >
): boolean {
  const tags = new Set(
    [
      item.source,
      item.sourceType,
      item.sourceSubtype,
      item.rawSource,
      ...(Array.isArray(item.derivedTags) ? item.derivedTags : []),
    ]
      .map((value) =>
        String(value || '')
          .trim()
          .toUpperCase()
      )
      .filter(Boolean)
  )
  const has = (pattern: string) => Array.from(tags).some((tag) => tag.includes(pattern))

  if (
    has('SEARCH_TERM_HIGH_PERFORMING') ||
    has('SEARCH_TERM') ||
    has('KEYWORD_PLANNER') ||
    has('HOT_PRODUCT_AGGREGATE') ||
    has('PARAM_EXTRACT') ||
    has('TITLE_EXTRACT') ||
    has('ABOUT_EXTRACT')
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

  const nonRelaxableHardBlocks = params.evaluation.hardBlockReasons.filter(
    (reason) => !INTENT_TIGHTENING_RELAXABLE_HIGH_PRIORITY_HARD_BLOCK_REASONS.has(reason)
  )
  if (nonRelaxableHardBlocks.length > 0) return false

  if (params.creativeType === 'model_intent') {
    if (!params.evaluation.hasBrand && !params.evaluation.hasExplicitModelCode) return false
    if (!params.evaluation.hasAnchor && !params.evaluation.hasExplicitModelCode) return false
    return (
      params.evaluation.hardBlockReasons.length > 0 || params.evaluation.softBlockReasons.length > 0
    )
  }

  if (params.creativeType === 'brand_intent' && !params.evaluation.hasBrand) return false
  if (!params.evaluation.hasBrand && !params.evaluation.hasAnchor) return false

  return (
    params.evaluation.hardBlockReasons.length > 0 || params.evaluation.softBlockReasons.length > 0
  )
}

export function resolveIntentTighteningPreferredFloor(params: {
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
  return Math.max(params.minimumKeywordFloor, Math.min(8, adaptiveTarget))
}

export function buildIntentTighteningPermutationKey(keyword: string): string {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return ''
  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length <= 1) return normalized
  return [...tokens].sort().join(' ')
}

export function buildIntentTighteningRelaxedFallbackCandidates(params: {
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
        score:
          scoreIntentTighteningFallbackCandidate({
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
          }) +
          sourceTrustScore +
          (relaxHighPriorityHardBlock ? 0.8 : 0),
      }
    })
    .filter(
      (
        item
      ): item is {
        item: PoolKeywordData
        normalized: string
        permutationKey: string
        sourceTrustScore: number
        relaxHighPriorityHardBlock: boolean
        score: number
      } => item !== null
    )
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
  const adaptiveScoreFloor =
    params.creativeType === 'model_intent'
      ? Math.max(4, topScore - 2.5)
      : Math.max(2.2, topScore - 2.8)

  const picked: PoolKeywordData[] = []
  for (const [index, item] of scored.entries()) {
    const passFloor =
      item.score >= adaptiveScoreFloor ||
      (index === 0 && item.score >= minimumAcceptedScore) ||
      (params.creativeType === 'model_intent' &&
        item.sourceTrustScore >= 1.8 &&
        item.relaxHighPriorityHardBlock &&
        item.score >= adaptiveScoreFloor - 1.1) ||
      (params.creativeType !== 'model_intent' &&
        item.sourceTrustScore >= 1.8 &&
        item.score >= adaptiveScoreFloor - 0.9)
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
