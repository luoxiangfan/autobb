import { describe, expect, it } from 'vitest'

import {
  normalizeKeywordSourceAuditForGeneratorList,
  normalizeSourceTypeFromLegacySource,
  shouldAllowZeroVolumeKeywordForMerge,
} from '../ad-creative-generator'

describe('ad-creative-generator zero-volume gate', () => {
  it('maps legacy sources into normalized source types', () => {
    expect(normalizeSourceTypeFromLegacySource({ source: 'AI_ENHANCED' })).toBe('AI_ENHANCED_PERSISTED')
    expect(normalizeSourceTypeFromLegacySource({ source: 'AI_GENERATED' })).toBe('AI_LLM_RAW')
    expect(normalizeSourceTypeFromLegacySource({ source: 'SCORING_SUGGESTION' })).toBe('GAP_INDUSTRY_BRANDED')
    expect(normalizeSourceTypeFromLegacySource({ source: 'KEYWORD_POOL' })).toBe('CANONICAL_BUCKET_VIEW')
  })

  it('always rejects derived canonical bucket view for zero-volume pass', () => {
    const allowed = shouldAllowZeroVolumeKeywordForMerge({
      keyword: 'brandx vacuum cleaner',
      source: 'KEYWORD_POOL',
      sourceType: 'CANONICAL_BUCKET_VIEW',
      brandName: 'BrandX',
      language: 'en',
      creativeType: 'product_intent',
      fallbackMode: true,
    })

    expect(allowed).toBe(false)
  })

  it('blocks low-confidence AI terms in model intent when model anchor is missing', () => {
    const allowed = shouldAllowZeroVolumeKeywordForMerge({
      keyword: 'brandx vacuum cleaner',
      source: 'AI_GENERATED',
      sourceType: 'AI_LLM_RAW',
      brandName: 'BrandX',
      language: 'en',
      creativeType: 'model_intent',
      fallbackMode: true,
    })

    expect(allowed).toBe(false)
  })

  it('allows low-confidence AI terms in model intent only with model anchor + fallback', () => {
    const allowed = shouldAllowZeroVolumeKeywordForMerge({
      keyword: 'brandx x200 vacuum',
      source: 'AI_GENERATED',
      sourceType: 'AI_LLM_RAW',
      brandName: 'BrandX',
      language: 'en',
      creativeType: 'model_intent',
      fallbackMode: true,
    })

    expect(allowed).toBe(true)
  })

  it('blocks low-confidence AI terms in brand intent without fallback mode', () => {
    const allowed = shouldAllowZeroVolumeKeywordForMerge({
      keyword: 'brandx vacuum price',
      source: 'AI_GENERATED',
      sourceType: 'AI_LLM_RAW',
      brandName: 'BrandX',
      language: 'en',
      creativeType: 'brand_intent',
      fallbackMode: false,
    })

    expect(allowed).toBe(false)
  })

  it('applies stricter checks for scoring suggestions in non-fallback mode', () => {
    const unrelated = shouldAllowZeroVolumeKeywordForMerge({
      keyword: 'brandx vacuum cleaner',
      source: 'SCORING_SUGGESTION',
      sourceType: 'GAP_INDUSTRY_BRANDED',
      brandName: 'BrandX',
      language: 'en',
      creativeType: 'model_intent',
      fallbackMode: false,
    })

    const brandedCommercial = shouldAllowZeroVolumeKeywordForMerge({
      keyword: 'brandx vacuum price',
      source: 'SCORING_SUGGESTION',
      sourceType: 'GAP_INDUSTRY_BRANDED',
      brandName: 'BrandX',
      language: 'en',
      creativeType: 'product_intent',
      fallbackMode: false,
    })

    expect(unrelated).toBe(false)
    expect(brandedCommercial).toBe(true)
  })

  it('keeps trusted planner terms with model anchors when volume is unavailable', () => {
    const allowed = shouldAllowZeroVolumeKeywordForMerge({
      keyword: 'brandx x200 vacuum',
      source: 'KEYWORD_PLANNER_BRAND',
      sourceType: 'KEYWORD_PLANNER_BRAND',
      brandName: 'BrandX',
      language: 'en',
      creativeType: 'model_intent',
      fallbackMode: true,
      volumeDataUnavailable: true,
    })

    expect(allowed).toBe(true)
  })

  it('still blocks model-intent terms without model anchors when volume is unavailable', () => {
    const blocked = shouldAllowZeroVolumeKeywordForMerge({
      keyword: 'brandx vacuum cleaner',
      source: 'KEYWORD_PLANNER_BRAND',
      sourceType: 'KEYWORD_PLANNER_BRAND',
      brandName: 'BrandX',
      language: 'en',
      creativeType: 'model_intent',
      fallbackMode: true,
      volumeDataUnavailable: true,
    })

    expect(blocked).toBe(false)
  })

  it('normalizes source audit fields for final generator keywords', () => {
    const normalized = normalizeKeywordSourceAuditForGeneratorList([
      {
        keyword: 'brandx vacuum price',
        searchVolume: 0,
        source: 'scoring_suggestion',
        sourceType: 'GAP_INDUSTRY_BRANDED',
        competition: 'MEDIUM',
      } as any,
      {
        keyword: 'brandx x200 vacuum',
        searchVolume: 1200,
        source: 'search_term_high_performing',
        competition: 'HIGH',
      } as any,
    ])

    expect(normalized[0]).toMatchObject({
      source: 'SCORING_SUGGESTION',
      sourceSubtype: 'GAP_INDUSTRY_BRANDED',
      rawSource: 'GAP_ANALYSIS',
    })
    expect(normalized[1]).toMatchObject({
      source: 'SEARCH_TERM_HIGH_PERFORMING',
      sourceSubtype: 'SEARCH_TERM_HIGH_PERFORMING',
      rawSource: 'SEARCH_TERM',
    })
  })
})
