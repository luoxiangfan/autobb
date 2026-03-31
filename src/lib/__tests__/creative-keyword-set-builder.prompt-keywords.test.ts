import { describe, expect, it, vi } from 'vitest'

import { buildCreativeKeywordSet } from '../creative-keyword-set-builder'

const mocks = vi.hoisted(() => ({
  applyKeywordSupplementationOnce: vi.fn(),
  filterCreativeKeywordsByOfferContextDetailed: vi.fn(),
  normalizeCreativeKeywordCandidatesForContextFilter: vi.fn(),
  selectCreativeKeywords: vi.fn(),
}))

vi.mock('../ad-creative-gen', () => ({
  applyKeywordSupplementationOnce: mocks.applyKeywordSupplementationOnce,
}))

vi.mock('../creative-keyword-context-filter', () => ({
  filterCreativeKeywordsByOfferContext: (params: any) =>
    mocks.filterCreativeKeywordsByOfferContextDetailed(params).keywords,
  filterCreativeKeywordsByOfferContextDetailed: mocks.filterCreativeKeywordsByOfferContextDetailed,
  normalizeCreativeKeywordCandidatesForContextFilter: mocks.normalizeCreativeKeywordCandidatesForContextFilter,
}))

vi.mock('../creative-keyword-selection', () => ({
  CREATIVE_BRAND_KEYWORD_RESERVE: 10,
  CREATIVE_KEYWORD_MAX_COUNT: 50,
  selectCreativeKeywords: mocks.selectCreativeKeywords,
}))

describe('buildCreativeKeywordSet prompt keyword passthrough', () => {
  const contextFilterResult = (keywords: any[], overrides: Record<string, any> = {}) => ({
    keywords,
    contextMismatchRemovedCount: 0,
    forbiddenRemovedCount: 0,
    qualityRemovedCount: 0,
    modelFamilyRemovedCount: 0,
    intentTighteningRemovedCount: 0,
    blockedKeywordKeys: [],
    ...overrides,
  })

  it('preserves upstream prompt keywords instead of rebuilding prompt metadata from executable keywords', async () => {
    const selectedKeywords = [
      {
        keyword: 'brandx x200 vacuum',
        searchVolume: 1600,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        sourceType: 'SEARCH_TERM_HIGH_PERFORMING',
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockImplementation(({ keywordsWithVolume }: any) =>
      contextFilterResult(keywordsWithVolume)
    )
    mocks.selectCreativeKeywords.mockReturnValue({
      keywords: selectedKeywords.map((item) => item.keyword),
      keywordsWithVolume: selectedKeywords,
      truncated: false,
      sourceQuotaAudit: {
        enabled: true,
        fallbackMode: false,
        targetCount: 1,
        requiredBrandCount: 0,
        acceptedBrandCount: 1,
        acceptedCount: 1,
        deferredCount: 0,
        deferredRefillCount: 0,
        deferredRefillTriggered: false,
        underfillBeforeRefill: 0,
        quota: { combinedLowTrustCap: 1, aiCap: 1, aiLlmRawCap: 1 },
        acceptedByClass: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
        blockedByCap: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
      },
    })
    mocks.applyKeywordSupplementationOnce.mockResolvedValue({
      keywordsWithVolume: selectedKeywords,
      keywordSupplementation: {
        triggered: false,
        beforeCount: 1,
        afterCount: 1,
        addedKeywords: [],
        supplementCapApplied: false,
      },
    })

    const result = await buildCreativeKeywordSet({
      offer: { brand: 'BrandX' },
      userId: 1,
      brandName: 'BrandX',
      targetLanguage: 'en',
      scopeLabel: 'unit-prompt-passthrough',
      keywordsWithVolume: selectedKeywords as any,
      keywords: selectedKeywords.map((item) => item.keyword),
      promptKeywords: [
        'brandx x200 vacuum',
        'self empty station',
        'brandx x200 vacuum',
      ],
      enableSupplementation: true,
    })

    expect(result.executableKeywords).toEqual(['brandx x200 vacuum'])
    expect(result.promptKeywords).toEqual([
      'brandx x200 vacuum',
      'self empty station',
    ])
  })

  it('drops context-blocked upstream prompt keywords while preserving remaining prompt metadata', async () => {
    const selectedKeywords = [
      {
        keyword: 'brandx x200 vacuum',
        searchVolume: 1600,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        sourceType: 'SEARCH_TERM_HIGH_PERFORMING',
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockImplementation(({ keywordsWithVolume }: any) =>
      contextFilterResult(keywordsWithVolume, {
        blockedKeywordKeys: ['buy brandx x200 vacuum'],
      })
    )
    mocks.selectCreativeKeywords.mockReturnValue({
      keywords: selectedKeywords.map((item) => item.keyword),
      keywordsWithVolume: selectedKeywords,
      truncated: false,
      sourceQuotaAudit: {
        enabled: true,
        fallbackMode: false,
        targetCount: 1,
        requiredBrandCount: 0,
        acceptedBrandCount: 1,
        acceptedCount: 1,
        deferredCount: 0,
        deferredRefillCount: 0,
        deferredRefillTriggered: false,
        underfillBeforeRefill: 0,
        quota: { combinedLowTrustCap: 1, aiCap: 1, aiLlmRawCap: 1 },
        acceptedByClass: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
        blockedByCap: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
      },
    })

    const result = await buildCreativeKeywordSet({
      offer: { brand: 'BrandX' },
      userId: 1,
      brandName: 'BrandX',
      targetLanguage: 'en',
      scopeLabel: 'unit-prompt-sanitize',
      keywordsWithVolume: selectedKeywords as any,
      keywords: selectedKeywords.map((item) => item.keyword),
      promptKeywords: [
        'brandx x200 vacuum',
        'buy brandx x200 vacuum',
      ],
      enableSupplementation: false,
    })

    expect(result.promptKeywords).toEqual(['brandx x200 vacuum'])
  })
})
