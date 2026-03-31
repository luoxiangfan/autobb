import { describe, expect, it } from 'vitest'

import {
  AD_STRENGTH_COMPETITIVE_POSITIONING_CONFIG,
  AD_STRENGTH_DIMENSION_CONFIG,
  AD_STRENGTH_RATING_THRESHOLDS,
  AD_STRENGTH_RELEVANCE_THRESHOLDS,
  AD_STRENGTH_SUBDIMENSION_MAX,
  AD_STRENGTH_SUGGESTION_THRESHOLDS,
  mapRawScoreToTarget,
  validateAdStrengthConfig,
} from '../ad-strength-config'

describe('ad-strength-config consistency', () => {
  it('keeps dimension weights and target scores internally consistent', () => {
    const dimensions = Object.values(AD_STRENGTH_DIMENSION_CONFIG)
    const totalWeight = dimensions.reduce((sum, item) => sum + item.weight, 0)
    const totalTargetMax = dimensions.reduce((sum, item) => sum + item.targetMax, 0)

    expect(totalWeight).toBeCloseTo(1, 8)
    expect(totalTargetMax).toBe(100)
    expect(dimensions.every(item => item.rawMax > 0 && item.targetMax > 0)).toBe(true)
  })

  it('keeps revised weighting emphasis (relevance up, completeness down)', () => {
    expect(AD_STRENGTH_DIMENSION_CONFIG.relevance.targetMax).toBe(22)
    expect(AD_STRENGTH_DIMENSION_CONFIG.relevance.weight).toBeCloseTo(0.22, 8)
    expect(AD_STRENGTH_DIMENSION_CONFIG.completeness.targetMax).toBe(10)
    expect(AD_STRENGTH_DIMENSION_CONFIG.completeness.weight).toBeCloseTo(0.10, 8)
  })

  it('keeps rating thresholds monotonic and in score range', () => {
    const { excellent, good, average } = AD_STRENGTH_RATING_THRESHOLDS
    expect(excellent).toBeGreaterThan(good)
    expect(good).toBeGreaterThan(average)
    expect(average).toBeGreaterThan(0)
    expect(excellent).toBeLessThanOrEqual(100)
  })

  it('keeps relevance thresholds ordered and normalized', () => {
    const t = AD_STRENGTH_RELEVANCE_THRESHOLDS
    expect(t.targetEmbeddingRate).toBeGreaterThan(t.embeddingRateTier2)
    expect(t.embeddingRateTier2).toBeGreaterThan(t.embeddingRateTier1)
    expect(t.embeddingRateTier1).toBeGreaterThan(0)
    expect(t.targetEmbeddingRate).toBeLessThanOrEqual(1)

    expect(t.naturalnessDensityGood).toBeGreaterThan(0)
    expect(t.naturalnessDensityGood).toBeLessThan(t.naturalnessDensityOk)
    expect(t.naturalnessDensityOk).toBeLessThanOrEqual(1)
  })

  it('keeps suggestion thresholds within configured maxima', () => {
    const groups = Object.keys(AD_STRENGTH_SUGGESTION_THRESHOLDS) as Array<keyof typeof AD_STRENGTH_SUGGESTION_THRESHOLDS>
    for (const group of groups) {
      const thresholdGroup = AD_STRENGTH_SUGGESTION_THRESHOLDS[group] as Record<string, number>
      const maxGroup = AD_STRENGTH_SUBDIMENSION_MAX[group] as Record<string, number>

      for (const [key, value] of Object.entries(thresholdGroup)) {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(maxGroup[key])
      }
    }
  })

  it('maps raw scores safely with clamping and invalid-input guard', () => {
    expect(mapRawScoreToTarget(10, 20, 18)).toBe(9)
    expect(mapRawScoreToTarget(30, 20, 18)).toBe(18)
    expect(mapRawScoreToTarget(-3, 20, 18)).toBe(0)
    expect(mapRawScoreToTarget(5, 0, 18)).toBe(0)
  })

  it('keeps competitive positioning ai threshold in raw score range', () => {
    expect(AD_STRENGTH_COMPETITIVE_POSITIONING_CONFIG.aiEnhancementThreshold).toBeGreaterThan(0)
    expect(AD_STRENGTH_COMPETITIVE_POSITIONING_CONFIG.aiEnhancementThreshold).toBeLessThanOrEqual(
      AD_STRENGTH_DIMENSION_CONFIG.competitivePositioning.rawMax
    )
  })

  it('passes built-in config validation', () => {
    const validation = validateAdStrengthConfig()
    expect(validation.valid).toBe(true)
    expect(validation.errors).toEqual([])
  })
})
