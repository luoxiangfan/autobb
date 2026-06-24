/**
 * Ad Strength 主评估编排器
 */

import type { HeadlineAsset, DescriptionAsset } from '../ad-creative'
import type { KeywordPlannerPreparedSession } from '@/lib/google-ads/accounts/auth/index'
import type { CanonicalCreativeType } from '../creative-type'
import {
  AD_STRENGTH_DIMENSION_CONFIG,
  mapRawScoreToTarget,
  validateAdStrengthConfig,
} from '../ad-strength-config'
import type { AdStrengthEvaluation } from './types'
import { parseCompetitivePositioningAiScores } from './competitive-positioning-ai-parse'
import { calculateCopyIntentMetrics } from './copy-intent-metrics'
import { generateSuggestions, scoreToRating } from './rating-suggestions'
import { calculateBrandSearchVolume } from './dimensions/brand-search-volume'
import { calculateCompetitivePositioning } from './dimensions/competitive-positioning'
import { calculateCompliance } from './dimensions/compliance'
import { calculateCompleteness } from './dimensions/completeness'
import { calculateDiversity } from './dimensions/diversity'
import { calculateQuality } from './dimensions/quality'
import { calculateRelevance } from './dimensions/relevance'

const adStrengthConfigValidation = validateAdStrengthConfig()
if (!adStrengthConfigValidation.valid) {
  console.warn(
    `[AdStrength] invalid config detected: ${adStrengthConfigValidation.errors.join('; ')}`
  )
}

export async function evaluateAdStrength(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[],
  keywords: string[],
  options?: {
    brandName?: string
    targetCountry?: string
    targetLanguage?: string
    userId?: number
    offerId?: number
    sitelinks?: Array<{
      text: string
      url: string
      description1?: string
      description2?: string
      description?: string
    }>
    callouts?: string[]
    keywordsWithVolume?: Array<{
      keyword: string
      searchVolume: number
      volumeUnavailableReason?: 'DEV_TOKEN_INSUFFICIENT_ACCESS' | 'DEV_TOKEN_TEST_ONLY'
    }>
    category?: string
    bucketType?: 'A' | 'B' | 'C' | 'D' | 'S'
    creativeType?: CanonicalCreativeType
    skipCompetitivePositioningAi?: boolean
    plannerSession?: KeywordPlannerPreparedSession
    skipKeywordPoolExpandLoad?: boolean
  }
): Promise<AdStrengthEvaluation> {
  const diversityRaw = calculateDiversity(headlines, descriptions)
  const diversityConfig = AD_STRENGTH_DIMENSION_CONFIG.diversity
  const diversity = {
    score: mapRawScoreToTarget(
      diversityRaw.score,
      diversityConfig.rawMax,
      diversityConfig.targetMax
    ),
    weight: diversityConfig.weight,
    details: diversityRaw.details,
  }

  const relevanceRaw = calculateRelevance(
    headlines,
    descriptions,
    keywords,
    options?.sitelinks,
    options?.callouts,
    options?.brandName,
    options?.category
  )
  const relevanceConfig = AD_STRENGTH_DIMENSION_CONFIG.relevance
  const relevance = {
    score: mapRawScoreToTarget(
      relevanceRaw.score,
      relevanceConfig.rawMax,
      relevanceConfig.targetMax
    ),
    weight: relevanceConfig.weight,
    details: relevanceRaw.details,
  }

  const completenessRaw = calculateCompleteness(headlines, descriptions)
  const completenessConfig = AD_STRENGTH_DIMENSION_CONFIG.completeness
  const completeness = {
    score: mapRawScoreToTarget(
      completenessRaw.score,
      completenessConfig.rawMax,
      completenessConfig.targetMax
    ),
    weight: completenessConfig.weight,
    details: completenessRaw.details,
  }

  const qualityRaw = calculateQuality(
    headlines,
    descriptions,
    options?.brandName,
    undefined,
    options?.targetLanguage
  )
  const qualityConfig = AD_STRENGTH_DIMENSION_CONFIG.quality
  const quality = {
    score: mapRawScoreToTarget(qualityRaw.score, qualityConfig.rawMax, qualityConfig.targetMax),
    weight: qualityConfig.weight,
    details: qualityRaw.details,
  }

  const complianceRaw = calculateCompliance(headlines, descriptions)
  const complianceConfig = AD_STRENGTH_DIMENSION_CONFIG.compliance
  const compliance = {
    score: mapRawScoreToTarget(
      complianceRaw.score,
      complianceConfig.rawMax,
      complianceConfig.targetMax
    ),
    weight: complianceConfig.weight,
    details: complianceRaw.details,
  }

  const brandSearchVolumeRaw = await calculateBrandSearchVolume(
    options?.brandName,
    options?.targetCountry || 'US',
    options?.targetLanguage || 'en',
    options?.userId,
    options?.keywordsWithVolume,
    options?.offerId,
    options?.plannerSession,
    options?.skipKeywordPoolExpandLoad
  )
  const brandSearchVolumeConfig = AD_STRENGTH_DIMENSION_CONFIG.brandSearchVolume
  const brandSearchVolume = {
    score: mapRawScoreToTarget(
      brandSearchVolumeRaw.score,
      brandSearchVolumeConfig.rawMax,
      brandSearchVolumeConfig.targetMax
    ),
    weight: brandSearchVolumeConfig.weight,
    details: brandSearchVolumeRaw.details,
  }

  const competitivePositioningRaw = await calculateCompetitivePositioning(
    headlines,
    descriptions,
    options?.userId,
    { skipAiEnhancement: options?.skipCompetitivePositioningAi === true }
  )
  const competitivePositioningConfig = AD_STRENGTH_DIMENSION_CONFIG.competitivePositioning
  const competitivePositioning = {
    ...competitivePositioningRaw,
    score: mapRawScoreToTarget(
      competitivePositioningRaw.score,
      competitivePositioningConfig.rawMax,
      competitivePositioningConfig.targetMax
    ),
    weight: competitivePositioningConfig.weight,
  }

  const overallScore =
    diversity.score +
    relevance.score +
    completeness.score +
    quality.score +
    compliance.score +
    brandSearchVolume.score +
    competitivePositioning.score

  const rating = scoreToRating(overallScore)

  const copyIntentMetrics = calculateCopyIntentMetrics(
    headlines,
    descriptions,
    options?.bucketType,
    options?.targetLanguage,
    keywords,
    options?.creativeType
  )

  const suggestions = generateSuggestions(
    diversity,
    relevance,
    completeness,
    quality,
    compliance,
    brandSearchVolume,
    competitivePositioning,
    rating,
    copyIntentMetrics
  )

  return {
    overallScore: Math.round(overallScore),
    rating,
    dimensions: {
      diversity,
      relevance,
      completeness,
      quality,
      compliance,
      brandSearchVolume,
      competitivePositioning,
    },
    copyIntentMetrics,
    suggestions,
  }
}

export const __testOnly = {
  parseCompetitivePositioningAiScores,
}
