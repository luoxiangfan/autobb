import { describe, expect, it } from 'vitest'

import type { CreativeKeywordUsagePlan, GeneratedAdCreativeData } from '../ad-creative'
import {
  buildCreativeKeywordUsagePlan,
  enforceRetainedKeywordSlotCoverage,
} from '../ad-creative-generator'

function buildCreativeDraft(): GeneratedAdCreativeData {
  return {
    headlines: [
      '{KeyWord:BrandX} Official',
      'BrandX X200 Vacuum',
      'BrandX Everyday Cleaning',
      'BrandX Lightweight Design',
      'Lightweight everyday clean',
      'Smart cleaning made easy',
      'Fresh floors without effort',
      'Quiet cleanup for busy homes',
      'Easy cleaning for daily mess',
    ],
    descriptions: [
      'Easy cleaning for busy homes. Shop Now',
      'Built for everyday cleanup. Learn More',
      'Quiet performance with smart features. Buy Now',
      'Freshen every room with less effort. Get Yours',
    ],
    keywords: [],
    theme: 'test',
    explanation: 'test',
  }
}

describe('buildCreativeKeywordUsagePlan', () => {
  it('cycles all valid retained keywords through headline targets when fewer than five are retained', () => {
    const plan = buildCreativeKeywordUsagePlan({
      brandName: 'BrandX',
      precomputedKeywordSet: {
        keywordsWithVolume: [
          { keyword: 'brandx x200 vacuum', searchVolume: 5200, contractRole: 'required' },
          { keyword: 'brandx robot vacuum', searchVolume: 4100, contractRole: 'required' },
          { keyword: 'brandx cordless vacuum', searchVolume: 3200, contractRole: 'required' },
        ],
      },
    })

    expect(plan.retainedNonBrandKeywords).toEqual([
      'brandx x200 vacuum',
      'brandx robot vacuum',
      'brandx cordless vacuum',
    ])
    expect(plan.headlineCoverageMode).toBe('exhaustive_under_5')
    expect(plan.headlineKeywordTargets).toEqual([
      'brandx x200 vacuum',
      'brandx robot vacuum',
      'brandx cordless vacuum',
      'brandx x200 vacuum',
      'brandx robot vacuum',
    ])
  })

  it('selects the best five retained keywords for headline slots when more than five are retained', () => {
    const plan = buildCreativeKeywordUsagePlan({
      brandName: 'BrandX',
      precomputedKeywordSet: {
        keywordsWithVolume: [
          { keyword: 'brandx robot vacuum', searchVolume: 9600, contractRole: 'required', evidenceStrength: 'high' },
          { keyword: 'brandx x200 vacuum', searchVolume: 9100, contractRole: 'required', evidenceStrength: 'high' },
          { keyword: 'brandx cordless vacuum', searchVolume: 8700, contractRole: 'required', evidenceStrength: 'medium' },
          { keyword: 'brandx smart vacuum', searchVolume: 8200, contractRole: 'optional', evidenceStrength: 'medium' },
          { keyword: 'brandx vacuum cleaner', searchVolume: 7800, contractRole: 'optional', evidenceStrength: 'medium' },
          { keyword: 'brandx home vacuum', searchVolume: 1100, contractRole: 'fallback', evidenceStrength: 'low' },
        ],
      },
    })

    expect(plan.headlineCoverageMode).toBe('top_5')
    expect(plan.retainedNonBrandKeywords).toContain('brandx home vacuum')
    expect(plan.headlineKeywordTargets).toHaveLength(5)
    expect(plan.headlineKeywordTargets).not.toContain('brandx home vacuum')
    expect(plan.headlineKeywordTargets).toEqual(expect.arrayContaining([
      'brandx robot vacuum',
      'brandx x200 vacuum',
      'brandx cordless vacuum',
      'brandx smart vacuum',
      'brandx vacuum cleaner',
    ]))
  })

  it('excludes semantically bad or meaningless keywords from the forced slot plan', () => {
    const plan = buildCreativeKeywordUsagePlan({
      brandName: 'BrandX',
      precomputedKeywordSet: {
        keywordsWithVolume: [
          { keyword: 'brandx x200 vacuum', searchVolume: 4100, contractRole: 'required' },
          { keyword: 'brandx official', searchVolume: 9999, contractRole: 'required' },
          { keyword: 'brandx review', searchVolume: 9000, contractRole: 'required' },
          { keyword: 'brandxddl', searchVolume: 8500, contractRole: 'required' },
          { keyword: 'brandx 12', searchVolume: 7000, contractRole: 'required' },
        ],
      },
    })

    expect(plan.retainedNonBrandKeywords).toEqual(['brandx x200 vacuum'])
    expect(plan.headlineKeywordTargets).toEqual([
      'brandx x200 vacuum',
      'brandx x200 vacuum',
      'brandx x200 vacuum',
      'brandx x200 vacuum',
      'brandx x200 vacuum',
    ])
    expect(plan.descriptionKeywordTargets).toEqual([
      'brandx x200 vacuum',
      'brandx x200 vacuum',
    ])
  })

  it('filters dangling-tail keywords that would produce broken retained-slot headlines', () => {
    const plan = buildCreativeKeywordUsagePlan({
      brandName: 'Novilla',
      precomputedKeywordSet: {
        keywordsWithVolume: [
          { keyword: 'novilla mattress full', searchVolume: 5200, contractRole: 'required' },
          { keyword: 'novilla full size mattress', searchVolume: 4100, contractRole: 'required' },
          { keyword: 'novilla full mattress box your', searchVolume: 3900, contractRole: 'required' },
          { keyword: 'novilla medium plush feel with', searchVolume: 3600, contractRole: 'required' },
        ],
      },
    })

    expect(plan.retainedNonBrandKeywords).toEqual([
      'novilla mattress full',
      'novilla full size mattress',
    ])
    expect(plan.retainedNonBrandKeywords).not.toContain('novilla full mattress box your')
    expect(plan.retainedNonBrandKeywords).not.toContain('novilla medium plush feel with')
  })
})

describe('enforceRetainedKeywordSlotCoverage', () => {
  it('fills retained-keyword slots without touching unrelated copy', () => {
    const creative = buildCreativeDraft()
    const usagePlan = buildCreativeKeywordUsagePlan({
      brandName: 'BrandX',
      precomputedKeywordSet: {
        keywordsWithVolume: [
          { keyword: 'brandx x200 vacuum', searchVolume: 5200, contractRole: 'required' },
          { keyword: 'brandx robot vacuum', searchVolume: 4100, contractRole: 'required' },
        ],
      },
    })

    const result = enforceRetainedKeywordSlotCoverage(creative, usagePlan, 'en', 'BrandX')

    expect(result).toEqual({ headlineFixes: 5, descriptionFixes: 2 })
    expect(creative.headlines.slice(0, 4)).toEqual([
      '{KeyWord:BrandX} Official',
      'BrandX X200 Vacuum',
      'BrandX Everyday Cleaning',
      'BrandX Lightweight Design',
    ])
    expect(creative.headlines.slice(4, 9)).toEqual([
      'Shop brandx x200 vacuum',
      'brandx robot vacuum',
      'Shop brandx x200 vacuum',
      'brandx robot vacuum',
      'Shop brandx x200 vacuum',
    ])
    expect(creative.descriptions[0]).toContain('brandx x200 vacuum')
    expect(creative.descriptions[1]).toContain('brandx robot vacuum')
    expect(creative.descriptions[2]).toBe('Quiet performance with smart features. Buy Now')
  })

  it('keeps retained-keyword headlines meaningfully different from headline #1-#4', () => {
    const creative = buildCreativeDraft()
    creative.headlines[4] = 'BrandX X200 Vacuum'
    creative.headlines[5] = 'BrandX Everyday Cleaning'
    creative.headlines[6] = 'BrandX Lightweight Design'
    creative.headlines[7] = 'BrandX X200 Vacuum'
    creative.headlines[8] = 'BrandX Everyday Cleaning'

    const usagePlan = buildCreativeKeywordUsagePlan({
      brandName: 'BrandX',
      precomputedKeywordSet: {
        keywordsWithVolume: [
          { keyword: 'brandx x200 vacuum', searchVolume: 5200, contractRole: 'required' },
          { keyword: 'brandx robot vacuum', searchVolume: 4100, contractRole: 'required' },
        ],
      },
    })

    const result = enforceRetainedKeywordSlotCoverage(creative, usagePlan, 'en', 'BrandX')

    expect(result.headlineFixes).toBe(5)
    expect(creative.headlines.slice(4, 9)).toEqual([
      'Shop brandx x200 vacuum',
      'brandx robot vacuum',
      'Shop brandx x200 vacuum',
      'brandx robot vacuum',
      'Shop brandx x200 vacuum',
    ])
  })

  it('does not force a retained-keyword headline when every safe variant is too similar to headline #1-#4', () => {
    const creative = buildCreativeDraft()
    creative.headlines[0] = 'BrandX X200 Vacuum'
    creative.headlines[1] = 'Shop BrandX X200 Vacuum'
    creative.headlines[2] = 'Buy BrandX X200 Vacuum'
    creative.headlines[3] = 'Learn More BrandX X200 Vacuum'

    const usagePlan: CreativeKeywordUsagePlan = {
      retainedNonBrandKeywords: ['brandx x200 vacuum'],
      headlineKeywordTargets: ['brandx x200 vacuum'],
      descriptionKeywordTargets: [],
      headlineCoverageMode: 'exhaustive_under_5',
      descriptionCoverageMode: 'prefer_uncovered_then_best_available',
    }

    const beforeHeadline = creative.headlines[4]
    const result = enforceRetainedKeywordSlotCoverage(creative, usagePlan, 'en', 'BrandX')

    expect(result).toEqual({ headlineFixes: 0, descriptionFixes: 0 })
    expect(creative.headlines[4]).toBe(beforeHeadline)
  })

  it('no-ops when there is no safe retained keyword plan', () => {
    const creative = buildCreativeDraft()
    const emptyPlan: CreativeKeywordUsagePlan = {
      retainedNonBrandKeywords: [],
      headlineKeywordTargets: [],
      descriptionKeywordTargets: [],
      headlineCoverageMode: 'exhaustive_under_5',
      descriptionCoverageMode: 'prefer_uncovered_then_best_available',
    }

    const before = JSON.parse(JSON.stringify(creative))
    const result = enforceRetainedKeywordSlotCoverage(creative, emptyPlan, 'en')

    expect(result).toEqual({ headlineFixes: 0, descriptionFixes: 0 })
    expect(creative).toEqual(before)
  })
})
