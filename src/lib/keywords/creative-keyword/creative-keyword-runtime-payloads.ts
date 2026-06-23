/**
 * 创意关键词运行时：API 响应与评估 payload 构造
 */
import type {
  CreativeAttemptEvaluation,
  CreativeGenerationHistoryItem,
  CreativeQualityEvaluationInput,
} from '../../creatives/server'
import { normalizeCanonicalCreativeType } from '../../creatives/server'
import type { ComprehensiveAdStrengthResult } from '../../launch-score/server'
import type { CreativeKeywordSourceAudit } from './creative-keyword-set-builder'
import type {
  CreateCreativeAdStrengthPayloadOptions,
  CreateCreativeOptimizationPayloadOptions,
  CreateCreativeQualityEvaluationInputOptions,
  CreateCreativeResponsePayloadOptions,
  CreateCreativeScoreBreakdownOptions,
  CreativeBucketSummaryInput,
  CreativeOfferSummaryInput,
} from './creative-keyword-runtime-types'

const DEFAULT_FINAL_PUBLISH_DECISION = {
  status: 'PENDING_LAUNCH_SCORE_CHECK',
  stage: 'campaign_publish',
  hardBlockSource: 'launch_score',
} as const

export function createCreativeQualityEvaluationInput(
  input: CreateCreativeQualityEvaluationInputOptions
): CreativeQualityEvaluationInput {
  const targetLanguage = input.offer.target_language || 'en'
  const normalizedPageType = (() => {
    const normalized = String(input.offer.page_type || '')
      .trim()
      .toLowerCase()
    if (normalized === 'store' || normalized === 'product') return normalized
    return null
  })()
  const bucketType = (() => {
    const normalized = String(input.bucket || '')
      .trim()
      .toUpperCase()
    if (normalized === 'A') return 'A' as const
    if (normalized === 'B' || normalized === 'C') return normalized as 'B' | 'C'
    if (normalized === 'D' || normalized === 'S') return normalized as 'D' | 'S'
    return null
  })()
  const normalizedCreativeType =
    normalizeCanonicalCreativeType(input.creativeType) ||
    normalizeCanonicalCreativeType(
      (input.creative as { creative_type?: unknown })?.creative_type
    ) ||
    (bucketType === 'A'
      ? 'brand_intent'
      : bucketType === 'B' || bucketType === 'C'
        ? 'model_intent'
        : bucketType === 'D' || bucketType === 'S'
          ? 'product_intent'
          : null)

  return {
    creative: input.creative,
    minimumScore: input.minimumScore,
    adStrengthContext: {
      brandName: input.offer.brand,
      targetCountry: input.offer.target_country || 'US',
      targetLanguage,
      bucketType,
      creativeType: normalizedCreativeType,
      userId: input.userId,
      offerId: input.offer.id,
      skipCompetitivePositioningAi: input.skipCompetitivePositioningAi,
      plannerSession: input.plannerSession,
      skipKeywordPoolExpandLoad: input.skipKeywordPoolExpandLoad,
    },
    ruleContext: {
      brandName: input.offer.brand,
      category: input.offer.category,
      productName: input.offer.product_name || input.productNameFallback,
      productTitle: input.offer.product_title || input.productTitleFallback,
      productDescription: input.offer.brand_description,
      uniqueSellingPoints: input.offer.unique_selling_points || input.offer.product_highlights,
      keywords: input.keywords || input.creative.keywords || [],
      targetLanguage,
      bucket: input.bucket,
      ...(normalizedPageType ? { pageType: normalizedPageType } : {}),
    },
  }
}

export function createCreativeAdStrengthPayload(
  evaluation: Pick<
    ComprehensiveAdStrengthResult,
    'finalRating' | 'finalScore' | 'localEvaluation' | 'combinedSuggestions' | 'rsaQualityGate'
  >,
  audit?: CreativeKeywordSourceAudit,
  options?: CreateCreativeAdStrengthPayloadOptions
) {
  return {
    rating: evaluation.finalRating,
    score: evaluation.finalScore,
    isExcellent: evaluation.finalRating === 'EXCELLENT',
    ...(options?.includeRsaQualityGate ? { rsaQualityGate: evaluation.rsaQualityGate } : {}),
    dimensions: evaluation.localEvaluation.dimensions,
    suggestions: evaluation.combinedSuggestions,
    audit,
  }
}

export function createCreativeScoreBreakdown(
  evaluation: Pick<ComprehensiveAdStrengthResult, 'localEvaluation'>,
  options?: CreateCreativeScoreBreakdownOptions
) {
  const dimensions = evaluation.localEvaluation.dimensions as any

  return {
    relevance: dimensions.relevance.score,
    quality: dimensions.quality.score,
    engagement: dimensions.completeness.score,
    diversity: dimensions.diversity.score,
    clarity: dimensions.compliance.score,
    brandSearchVolume: options?.allowPartialMetrics
      ? dimensions.brandSearchVolume?.score || 0
      : dimensions.brandSearchVolume.score,
    competitivePositioning: options?.allowPartialMetrics
      ? dimensions.competitivePositioning?.score || 0
      : dimensions.competitivePositioning.score,
  }
}

export function createCreativeApiRetryHistory(history: CreativeGenerationHistoryItem[]) {
  return history.map((item) => ({
    ...item,
    gatePassed: item.passed,
    gateReasons: item.reasons,
  }))
}

export function createCreativeTaskRetryHistory(history: CreativeGenerationHistoryItem[]) {
  return history.map((item) => ({
    attempt: item.attempt,
    rating: item.rating,
    score: item.score,
    suggestions: item.suggestions,
    failureType: item.failureType,
    reasons: item.reasons,
    passed: item.passed,
  }))
}

export function createCreativeOptimizationPayload<THistory>(
  input: CreateCreativeOptimizationPayloadOptions<THistory>
) {
  return {
    attempts: input.attempts,
    targetRating: input.targetRating,
    achieved: input.achieved,
    ...(input.qualityGatePassed !== undefined
      ? { qualityGatePassed: input.qualityGatePassed }
      : {}),
    history: input.history,
  }
}

export function createCreativeOfferSummaryPayload(offer: CreativeOfferSummaryInput) {
  return {
    id: offer.id,
    brand: offer.brand,
    url: offer.url,
    affiliateLink: offer.affiliate_link,
  }
}

export function createCreativeBucketSummaryPayload(input: CreativeBucketSummaryInput) {
  return {
    creativeType: input.creativeType,
    bucket: input.bucket,
    bucketIntent: input.bucketIntent,
    generatedBuckets: input.generatedBuckets,
  }
}

export function createCreativeResponsePayload(input: CreateCreativeResponsePayloadOptions) {
  return {
    ...(input.id !== undefined ? { id: input.id } : {}),
    headlines: input.creative.headlines,
    descriptions: input.creative.descriptions,
    keywords: input.creative.keywords,
    keywordsWithVolume: input.creative.keywordsWithVolume,
    ...(input.includeNegativeKeywords ? { negativeKeywords: input.creative.negativeKeywords } : {}),
    callouts: input.creative.callouts,
    sitelinks: input.creative.sitelinks,
    theme: input.creative.theme,
    explanation: input.creative.explanation,
    headlinesWithMetadata: input.creative.headlinesWithMetadata,
    descriptionsWithMetadata: input.creative.descriptionsWithMetadata,
    qualityMetrics: input.creative.qualityMetrics,
    ...(input.includeKeywordSupplementation
      ? { keywordSupplementation: input.creative.keywordSupplementation || null }
      : {}),
    audit: input.audit,
  }
}

export function createCreativeQualityGatePayload(evaluation: CreativeAttemptEvaluation) {
  return {
    passed: evaluation.passed,
    warning: !evaluation.passed,
    reasons: evaluation.reasons,
    failureType: evaluation.failureType,
    rsaGatePassed: evaluation.rsaGate.passed,
    ruleGatePassed: evaluation.ruleGate.passed,
    rsaQualityGate: evaluation.adStrength.rsaQualityGate,
    ruleGate: evaluation.ruleGate,
  }
}

export function createCreativePublishDecisionPayload(forcePublishRequested: boolean) {
  return {
    forcePublish: false,
    forcedPublish: false,
    qualityGateBypassed: false,
    forcePublishIgnored: forcePublishRequested,
    finalPublishDecision: { ...DEFAULT_FINAL_PUBLISH_DECISION },
  }
}
