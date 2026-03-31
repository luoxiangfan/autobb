/**
 * Ad Strength配置常量
 *
 * 该模块仅承载权重与阈值配置，避免与评估执行逻辑耦合。
 */

export const CP_AI_FEATURE_FLAG = 'AD_STRENGTH_ENABLE_CP_AI'

export const AD_STRENGTH_DIMENSION_CONFIG = {
  diversity: { rawMax: 20, targetMax: 18, weight: 0.18 },
  relevance: { rawMax: 20, targetMax: 22, weight: 0.22 },
  completeness: { rawMax: 15, targetMax: 10, weight: 0.10 },
  quality: { rawMax: 15, targetMax: 14, weight: 0.14 },
  compliance: { rawMax: 10, targetMax: 8, weight: 0.08 },
  brandSearchVolume: { rawMax: 20, targetMax: 18, weight: 0.18 },
  competitivePositioning: { rawMax: 10, targetMax: 10, weight: 0.10 },
} as const

export const AD_STRENGTH_RATING_THRESHOLDS = {
  excellent: 85,
  good: 70,
  average: 50,
} as const

export const AD_STRENGTH_RELEVANCE_THRESHOLDS = {
  targetEmbeddingRate: 8 / 15,
  embeddingRateTier2: 0.4,
  embeddingRateTier1: 0.27,
  naturalnessDensityGood: 0.3,
  naturalnessDensityOk: 0.5,
} as const

export const AD_STRENGTH_COMPETITIVE_POSITIONING_CONFIG = {
  aiEnhancementThreshold: 6,
} as const

export const AD_STRENGTH_SUGGESTION_THRESHOLDS = {
  diversity: {
    typeDistribution: 6,
    lengthDistribution: 6,
    textUniqueness: 3,
  },
  relevance: {
    keywordCoverage: 8,
    keywordEmbeddingRate: 53,
    keywordNaturalness: 4,
  },
  completeness: {
    assetCount: 7,
    characterCompliance: 5,
  },
  quality: {
    numberUsage: 4,
    ctaPresence: 4,
    urgencyExpression: 3,
  },
  compliance: {
    policyAdherence: 5,
    noSpamWords: 3,
  },
  competitivePositioning: {
    priceAdvantage: 2,
    uniqueMarketPosition: 2,
    competitiveComparison: 1,
    valueEmphasis: 1,
  },
  copyIntent: {
    coverage: 50,
    alignment: 60,
  },
} as const

export const AD_STRENGTH_SUBDIMENSION_MAX = {
  diversity: {
    typeDistribution: 7.2,
    lengthDistribution: 7.2,
    textUniqueness: 3.6,
  },
  relevance: {
    keywordCoverage: 10,
    keywordEmbeddingRate: 100,
    keywordNaturalness: 6,
  },
  completeness: {
    assetCount: 9,
    characterCompliance: 6,
  },
  quality: {
    numberUsage: 4,
    ctaPresence: 4,
    urgencyExpression: 3,
  },
  compliance: {
    policyAdherence: 6,
    noSpamWords: 4,
  },
  competitivePositioning: {
    priceAdvantage: 3,
    uniqueMarketPosition: 3,
    competitiveComparison: 2,
    valueEmphasis: 2,
  },
  copyIntent: {
    coverage: 100,
    alignment: 100,
  },
} as const

function validateSuggestionThresholdGroup(
  groupName: string,
  thresholds: Record<string, number>,
  maxima: Record<string, number>,
  errors: string[]
): void {
  for (const [key, value] of Object.entries(thresholds)) {
    const max = maxima[key]
    if (!Number.isFinite(max)) {
      errors.push(`missing max config for suggestion.${groupName}.${key}`)
      continue
    }
    if (!Number.isFinite(value) || value < 0 || value > max) {
      errors.push(`suggestion.${groupName}.${key} must be within [0, ${max}], got ${value}`)
    }
  }
}

export function mapRawScoreToTarget(rawScore: number, rawMax: number, targetMax: number): number {
  if (!Number.isFinite(rawScore) || rawMax <= 0 || targetMax <= 0) return 0
  const boundedRaw = Math.max(0, Math.min(rawMax, rawScore))
  return Math.round((boundedRaw / rawMax) * targetMax)
}

export interface AdStrengthConfigValidationResult {
  valid: boolean
  errors: string[]
}

export function validateAdStrengthConfig(): AdStrengthConfigValidationResult {
  const errors: string[] = []
  const epsilon = 1e-8

  const dimensions = Object.values(AD_STRENGTH_DIMENSION_CONFIG)
  const totalWeight = dimensions.reduce((sum, item) => sum + item.weight, 0)
  const totalTargetMax = dimensions.reduce((sum, item) => sum + item.targetMax, 0)

  if (Math.abs(totalWeight - 1) > epsilon) {
    errors.push(`dimension weight sum must be 1, got ${totalWeight}`)
  }

  if (totalTargetMax !== 100) {
    errors.push(`dimension targetMax sum must be 100, got ${totalTargetMax}`)
  }

  if (dimensions.some(item => item.rawMax <= 0 || item.targetMax <= 0)) {
    errors.push('dimension rawMax and targetMax must be positive')
  }

  if (
    !(
      AD_STRENGTH_RATING_THRESHOLDS.excellent > AD_STRENGTH_RATING_THRESHOLDS.good &&
      AD_STRENGTH_RATING_THRESHOLDS.good > AD_STRENGTH_RATING_THRESHOLDS.average &&
      AD_STRENGTH_RATING_THRESHOLDS.average > 0 &&
      AD_STRENGTH_RATING_THRESHOLDS.excellent <= 100
    )
  ) {
    errors.push('rating thresholds must be monotonic within 0-100')
  }

  if (
    !(
      AD_STRENGTH_RELEVANCE_THRESHOLDS.targetEmbeddingRate > AD_STRENGTH_RELEVANCE_THRESHOLDS.embeddingRateTier2 &&
      AD_STRENGTH_RELEVANCE_THRESHOLDS.embeddingRateTier2 > AD_STRENGTH_RELEVANCE_THRESHOLDS.embeddingRateTier1 &&
      AD_STRENGTH_RELEVANCE_THRESHOLDS.embeddingRateTier1 > 0 &&
      AD_STRENGTH_RELEVANCE_THRESHOLDS.targetEmbeddingRate <= 1
    )
  ) {
    errors.push('relevance embedding thresholds must be ordered within 0-1')
  }

  if (
    !(
      AD_STRENGTH_RELEVANCE_THRESHOLDS.naturalnessDensityGood > 0 &&
      AD_STRENGTH_RELEVANCE_THRESHOLDS.naturalnessDensityGood < AD_STRENGTH_RELEVANCE_THRESHOLDS.naturalnessDensityOk &&
      AD_STRENGTH_RELEVANCE_THRESHOLDS.naturalnessDensityOk <= 1
    )
  ) {
    errors.push('relevance naturalness thresholds must be ordered within 0-1')
  }

  if (
    !(
      AD_STRENGTH_COMPETITIVE_POSITIONING_CONFIG.aiEnhancementThreshold > 0 &&
      AD_STRENGTH_COMPETITIVE_POSITIONING_CONFIG.aiEnhancementThreshold <=
        AD_STRENGTH_DIMENSION_CONFIG.competitivePositioning.rawMax
    )
  ) {
    errors.push('competitive positioning ai threshold must be in raw score range')
  }

  validateSuggestionThresholdGroup(
    'diversity',
    AD_STRENGTH_SUGGESTION_THRESHOLDS.diversity,
    AD_STRENGTH_SUBDIMENSION_MAX.diversity,
    errors
  )
  validateSuggestionThresholdGroup(
    'relevance',
    AD_STRENGTH_SUGGESTION_THRESHOLDS.relevance,
    AD_STRENGTH_SUBDIMENSION_MAX.relevance,
    errors
  )
  validateSuggestionThresholdGroup(
    'completeness',
    AD_STRENGTH_SUGGESTION_THRESHOLDS.completeness,
    AD_STRENGTH_SUBDIMENSION_MAX.completeness,
    errors
  )
  validateSuggestionThresholdGroup(
    'quality',
    AD_STRENGTH_SUGGESTION_THRESHOLDS.quality,
    AD_STRENGTH_SUBDIMENSION_MAX.quality,
    errors
  )
  validateSuggestionThresholdGroup(
    'compliance',
    AD_STRENGTH_SUGGESTION_THRESHOLDS.compliance,
    AD_STRENGTH_SUBDIMENSION_MAX.compliance,
    errors
  )
  validateSuggestionThresholdGroup(
    'competitivePositioning',
    AD_STRENGTH_SUGGESTION_THRESHOLDS.competitivePositioning,
    AD_STRENGTH_SUBDIMENSION_MAX.competitivePositioning,
    errors
  )
  validateSuggestionThresholdGroup(
    'copyIntent',
    AD_STRENGTH_SUGGESTION_THRESHOLDS.copyIntent,
    AD_STRENGTH_SUBDIMENSION_MAX.copyIntent,
    errors
  )

  return {
    valid: errors.length === 0,
    errors,
  }
}
