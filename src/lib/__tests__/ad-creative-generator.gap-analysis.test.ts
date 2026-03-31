import { describe, expect, it } from 'vitest'

import { shouldRunGapAnalysisForCreative } from '../ad-creative-generator'

describe('shouldRunGapAnalysisForCreative', () => {
  it('runs for default and product-intent creatives only', () => {
    expect(shouldRunGapAnalysisForCreative({ bucket: null })).toBe(true)
    expect(shouldRunGapAnalysisForCreative({ bucket: 'D' })).toBe(true)
    expect(shouldRunGapAnalysisForCreative({ bucket: 'A' })).toBe(false)
    expect(shouldRunGapAnalysisForCreative({ bucket: 'B' })).toBe(false)
  })

  it('stops in coverage mode and ignores defer flag for product-intent D', () => {
    expect(shouldRunGapAnalysisForCreative({ bucket: 'D', isCoverageCreative: true })).toBe(false)
    expect(shouldRunGapAnalysisForCreative({ bucket: 'D', deferKeywordSupplementation: true })).toBe(true)
    expect(shouldRunGapAnalysisForCreative({ bucket: 'A', deferKeywordSupplementation: true })).toBe(false)
  })
})
