import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCreativeKeywordSet } from '../creative-keyword-set-builder'
import { resolveCreativeKeywordMinimumOutputCount } from '../creative-keyword-output-floor'

const mocks = vi.hoisted(() => ({
  applyKeywordSupplementationOnce: vi.fn(),
  filterCreativeKeywordsByOfferContextDetailed: vi.fn(),
  normalizeCreativeKeywordCandidatesForContextFilter: vi.fn(),
  selectCreativeKeywords: vi.fn(),
  createRiskAlert: vi.fn(),
  dbQuery: vi.fn(),
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

vi.mock('../risk-alerts', () => ({
  createRiskAlert: mocks.createRiskAlert,
}))

vi.mock('../db', () => ({
  getDatabase: async () => ({
    query: (...args: any[]) => mocks.dbQuery(...args),
  }),
}))

describe('buildCreativeKeywordSet keyword source audit', () => {
  beforeEach(() => {
    mocks.dbQuery.mockReset()
    mocks.dbQuery.mockResolvedValue([])
  })

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

  it('builds source audit with counts/ratios and carries source quota metadata', async () => {
    const selectedKeywords = [
      {
        keyword: 'brandx x200 vacuum',
        searchVolume: 1600,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        sourceType: 'SEARCH_TERM_HIGH_PERFORMING',
        sourceSubtype: 'SEARCH_TERM_HIGH_PERFORMING',
        rawSource: 'SEARCH_TERM',
        sourceField: 'search_terms',
      },
      {
        keyword: 'brandx vacuum cleaner',
        searchVolume: 0,
        source: 'AI_GENERATED',
        sourceType: 'AI_LLM_RAW',
        sourceSubtype: 'AI_LLM_RAW',
        rawSource: 'AI',
        sourceField: 'ai',
        volumeUnavailableReason: 'DEV_TOKEN_INSUFFICIENT_ACCESS',
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
        fallbackMode: true,
        targetCount: 2,
        requiredBrandCount: 0,
        acceptedBrandCount: 2,
        acceptedCount: 2,
        deferredCount: 3,
        deferredRefillCount: 1,
        deferredRefillTriggered: true,
        underfillBeforeRefill: 1,
        quota: {
          combinedLowTrustCap: 1,
          aiCap: 1,
          aiLlmRawCap: 1,
        },
        acceptedByClass: {
          lowTrust: 1,
          ai: 1,
          aiLlmRaw: 1,
        },
        blockedByCap: {
          lowTrust: 2,
          ai: 1,
          aiLlmRaw: 1,
        },
      },
    })
    mocks.applyKeywordSupplementationOnce.mockResolvedValue({
      keywordsWithVolume: selectedKeywords,
      keywordSupplementation: {
        triggered: false,
        beforeCount: 2,
        afterCount: 2,
        addedKeywords: [],
        supplementCapApplied: false,
      },
    })

    const result = await buildCreativeKeywordSet({
      offer: { brand: 'BrandX' },
      userId: 1,
      brandName: 'BrandX',
      targetLanguage: 'en',
      creativeType: 'model_intent',
      scopeLabel: 'unit-test',
      keywordsWithVolume: selectedKeywords as any,
      keywords: selectedKeywords.map((item) => item.keyword),
      enableSupplementation: true,
      fallbackMode: true,
    })

    expect(result.keywords).toEqual(['brandx x200 vacuum', 'brandx vacuum cleaner'])
    expect(result.executableKeywords).toEqual(result.keywords)
    expect(result.promptKeywords).toEqual(['brandx x200 vacuum', 'brandx vacuum cleaner'])
    expect(result).toEqual(expect.objectContaining({
      promptKeywords: expect.any(Array),
      executableKeywords: expect.any(Array),
      candidatePool: expect.any(Array),
      audit: expect.any(Object),
    }))
    expect(result.audit).toEqual(result.keywordSourceAudit)
    expect(result.keywordSourceAudit).toMatchObject({
      totalKeywords: 2,
      withSearchVolumeKeywords: 1,
      zeroVolumeKeywords: 1,
      volumeUnavailableKeywords: 1,
      noVolumeMode: true,
      fallbackMode: true,
      contextFallbackStrategy: 'filtered',
      sourceQuotaAudit: {
        deferredRefillTriggered: true,
        quota: {
          combinedLowTrustCap: 1,
        },
      },
      contextFilterStats: {
        removedByForbidden: 0,
        removedByQuality: 0,
        removedByModelFamily: 0,
        removedByIntentTightening: 0,
      },
      byRawSource: {
        SEARCH_TERM: { count: 1, ratio: 0.5 },
        AI: { count: 1, ratio: 0.5 },
      },
      bySourceSubtype: {
        SEARCH_TERM_HIGH_PERFORMING: { count: 1, ratio: 0.5 },
        AI_LLM_RAW: { count: 1, ratio: 0.5 },
      },
      bySourceField: {
        SEARCH_TERMS: { count: 1, ratio: 0.5 },
        AI: { count: 1, ratio: 0.5 },
      },
      creativeAffinityByLabel: {
        MIXED: { count: 2, ratio: 1 },
      },
      creativeAffinityByLevel: {
        HIGH: { count: 2, ratio: 1 },
      },
      supplementationSources: {},
      selectionMetrics: {
        contractSatisfied: true,
        hardModelKeywords: { count: 1, ratio: 0.5 },
        softFamilyKeywords: { count: 0, ratio: 0 },
        modelFamilyGuardKeywords: { count: 0, ratio: 0 },
        finalRescueKeywords: { count: 0, ratio: 0 },
      },
      pipeline: {
        initialCandidateCount: 2,
        initialContextFilteredCount: 2,
        postSupplementCandidateCount: 2,
        postSupplementContextFilteredCount: 2,
        selectionFallbackTriggered: false,
        selectionFallbackSource: 'filtered',
        selectionFallbackReason: 'none',
        contractSatisfiedAfterFallback: true,
        finalInvariantTriggered: false,
        finalInvariantCandidateCount: 0,
        supplementAppliedAfterFilter: true,
      },
    })
  })

  it('tracks context mismatch removals in context filter stats', async () => {
    const selectedKeywords = [
      {
        keyword: 'brandx x200 vacuum cleaner',
        searchVolume: 1200,
        source: 'KEYWORD_PLANNER',
        sourceType: 'KEYWORD_PLANNER',
        sourceSubtype: 'KEYWORD_PLANNER',
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockImplementation(({ keywordsWithVolume }: any) =>
      contextFilterResult(keywordsWithVolume, {
        contextMismatchRemovedCount: 5,
        qualityRemovedCount: 1,
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
      offer: { brand: 'BrandX', product_name: 'BrandX X200 Vacuum Cleaner' },
      userId: 1,
      brandName: 'BrandX',
      targetLanguage: 'en',
      creativeType: 'product_intent',
      bucket: 'D',
      scopeLabel: 'unit-context-mismatch-audit',
      keywordsWithVolume: selectedKeywords as any,
      enableSupplementation: false,
      fallbackMode: false,
    })

    expect(result.audit.contextFilterStats).toMatchObject({
      removedByContextMismatch: 5,
      removedByQuality: 1,
      removedByForbidden: 0,
      removedByModelFamily: 0,
      removedByIntentTightening: 0,
    })
  })

  it('uses fixed fallback order filtered -> keyword_pool -> original and merges bucket seeds without entry override', async () => {
    const aiCandidates = [
      {
        keyword: 'brandx ai vacuum',
        searchVolume: 300,
        source: 'AI_GENERATED',
        sourceType: 'AI_LLM_RAW',
      },
    ]
    const bucketSeeds = [
      {
        keyword: 'brandx x300 vacuum',
        searchVolume: 900,
        source: 'KEYWORD_POOL',
        sourceType: 'CANONICAL_BUCKET_VIEW',
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(contextFilterResult([], {
      forbiddenRemovedCount: 1,
      qualityRemovedCount: 1,
      blockedKeywordKeys: ['brandx ai vacuum'],
    } as any))
    mocks.selectCreativeKeywords.mockImplementation(({ keywordsWithVolume }: any) => ({
      keywords: (keywordsWithVolume || []).map((item: any) => item.keyword),
      keywordsWithVolume: keywordsWithVolume || [],
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
    }))
    mocks.applyKeywordSupplementationOnce.mockImplementation(async ({ keywordsWithVolume }: any) => ({
      keywordsWithVolume,
      keywords: (keywordsWithVolume || []).map((item: any) => item.keyword),
      keywordSupplementation: {
        triggered: false,
        beforeCount: 2,
        afterCount: 2,
        addedKeywords: [],
        supplementCapApplied: false,
      },
    }))

    const result = await buildCreativeKeywordSet({
      offer: { brand: 'BrandX' },
      userId: 1,
      brandName: 'BrandX',
      targetLanguage: 'en',
      scopeLabel: 'unit-fallback-order',
      keywordsWithVolume: aiCandidates as any,
      keywords: aiCandidates.map((item) => item.keyword),
      seedCandidates: bucketSeeds as any,
      enableSupplementation: true,
      fallbackMode: false,
    })

    expect(mocks.applyKeywordSupplementationOnce).toHaveBeenCalledWith(expect.objectContaining({
      poolCandidates: ['brandx x300 vacuum'],
    }))
    expect(mocks.selectCreativeKeywords).toHaveBeenCalledWith(expect.objectContaining({
      preferredBucketKeywords: ['brandx x300 vacuum'],
    }))
    expect(result.contextFallbackStrategy).toBe('keyword_pool')
    expect(result.keywordsWithVolume.map((item) => item.keyword)).toEqual(['brandx x300 vacuum'])
    expect(result.executableKeywords).toEqual(['brandx x300 vacuum'])
    expect(result.promptKeywords).toEqual(['brandx x300 vacuum'])
    expect(result.candidatePool.map((item) => item.keyword)).toEqual(['brandx x300 vacuum'])
  })

  it('triggers relaxed filtering refill when post-filter ratio is below threshold', async () => {
    const sparseContextCandidates = [
      {
        keyword: 'brandx anchor demand keyword',
        searchVolume: 2100,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        sourceType: 'SEARCH_TERM_HIGH_PERFORMING',
      },
    ]
    const highPriorityCandidates = Array.from({ length: 12 }, (_, index) => ({
      keyword: `brandx d floor ${index + 1}`,
      searchVolume: 500 - index,
      source: 'KEYWORD_POOL',
      sourceType: 'CANONICAL_BUCKET_VIEW',
      sourceSubtype: 'CANONICAL_BUCKET_VIEW',
      rawSource: 'KEYWORD_POOL',
      sourceField: 'keyword_pool',
    }))
    const candidatePool = [
      ...sparseContextCandidates,
      ...highPriorityCandidates,
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockImplementation(() =>
      contextFilterResult(sparseContextCandidates)
    )
    mocks.selectCreativeKeywords.mockImplementation(({ keywordsWithVolume }: any) => ({
      keywords: (keywordsWithVolume || []).map((item: any) => item.keyword),
      keywordsWithVolume: keywordsWithVolume || [],
      truncated: false,
      sourceQuotaAudit: {
        enabled: true,
        fallbackMode: false,
        targetCount: (keywordsWithVolume || []).length,
        requiredBrandCount: 0,
        acceptedBrandCount: (keywordsWithVolume || []).length,
        acceptedCount: (keywordsWithVolume || []).length,
        deferredCount: 0,
        deferredRefillCount: 0,
        deferredRefillTriggered: false,
        underfillBeforeRefill: 0,
        quota: { combinedLowTrustCap: 20, aiCap: 20, aiLlmRawCap: 20 },
        acceptedByClass: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
        blockedByCap: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
      },
    }))

    const result = await buildCreativeKeywordSet({
      offer: { brand: 'BrandX', product_name: 'BrandX Floor Cleaner' },
      userId: 1,
      brandName: 'BrandX',
      targetLanguage: 'en',
      creativeType: 'product_intent',
      bucket: 'D',
      scopeLabel: 'unit-relaxed-filtering-refill',
      keywordsWithVolume: candidatePool as any,
      keywords: candidatePool.map((item) => item.keyword),
      enableSupplementation: false,
      fallbackMode: false,
    })

    expect(result.contextFallbackStrategy).toBe('filtered')
    expect(result.executableKeywords.length).toBeGreaterThanOrEqual(10)
    expect(result.executableKeywords).toEqual(expect.arrayContaining([
      'brandx anchor demand keyword',
      'brandx d floor 1',
    ]))
    expect(result.audit.pipeline).toMatchObject({
      relaxedFilteringTriggered: true,
      relaxedFilteringAddedCount: 9,
      relaxedFilteringTargetCount: 10,
    })
    expect(result.audit.pipeline.relaxedFilteringPostFilterRatio || 1).toBeLessThan(0.1)
  })

  it('keeps the higher-volume canonical metadata when the same keyword also exists as a zero-volume ai candidate', async () => {
    const aiCandidates = [
      {
        keyword: 'anker solix everfrost 2',
        searchVolume: 0,
        source: 'AI_GENERATED',
        sourceType: 'AI_LLM_RAW',
        sourceSubtype: 'AI_LLM_RAW',
        rawSource: 'AI',
        sourceField: 'ai',
        volumeUnavailableReason: 'DEV_TOKEN_INSUFFICIENT_ACCESS',
      },
    ]
    const bucketSeeds = [
      {
        keyword: 'anker solix everfrost 2',
        searchVolume: 880,
        source: 'GLOBAL_KEYWORDS',
        sourceType: 'CANONICAL_BUCKET_VIEW',
        sourceSubtype: 'CANONICAL_BUCKET_VIEW',
        rawSource: 'GLOBAL_KEYWORDS',
        sourceField: 'keyword',
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockImplementation(({ keywordsWithVolume }: any) =>
      contextFilterResult(keywordsWithVolume)
    )
    mocks.selectCreativeKeywords.mockImplementation(({ keywordsWithVolume }: any) => ({
      keywords: (keywordsWithVolume || []).map((item: any) => item.keyword),
      keywordsWithVolume: keywordsWithVolume || [],
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
    }))

    const result = await buildCreativeKeywordSet({
      offer: {
        brand: 'Anker',
        category: 'Powered Coolers',
        product_name: 'Anker SOLIX EverFrost 2 Electric Cooler 50L',
      },
      userId: 1,
      brandName: 'Anker',
      targetLanguage: 'en',
      creativeType: 'model_intent',
      bucket: 'B',
      scopeLabel: 'unit-duplicate-volume-upgrade',
      keywordsWithVolume: aiCandidates as any,
      keywords: aiCandidates.map((item) => item.keyword),
      seedCandidates: bucketSeeds as any,
      enableSupplementation: false,
      fallbackMode: false,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    const mergedSelectedKeyword = result.keywordsWithVolume.filter((item) =>
      item.keyword === 'anker solix everfrost 2'
    )
    expect(mergedSelectedKeyword).toHaveLength(1)
    expect(mergedSelectedKeyword[0]).toMatchObject({
      keyword: 'anker solix everfrost 2',
      searchVolume: 880,
      source: 'GLOBAL_KEYWORDS',
      sourceType: 'CANONICAL_BUCKET_VIEW',
      sourceSubtype: 'CANONICAL_BUCKET_VIEW',
      rawSource: 'GLOBAL_KEYWORDS',
    })
    const mergedPoolKeyword = result.candidatePool.filter((item) =>
      item.keyword === 'anker solix everfrost 2'
    )
    expect(mergedPoolKeyword).toHaveLength(1)
    expect(mergedPoolKeyword[0]).toMatchObject({
      keyword: 'anker solix everfrost 2',
      searchVolume: 880,
      rawSource: 'GLOBAL_KEYWORDS',
      sourceSubtype: 'CANONICAL_BUCKET_VIEW',
    })
  })

  it('supplements only after the first context filter and re-filters supplemented candidates', async () => {
    const expectedFloor = resolveCreativeKeywordMinimumOutputCount({
      creativeType: 'product_intent',
      maxKeywords: 50,
      bucket: 'D',
    })
    const filteredCandidates = [
      {
        keyword: 'brandx x200 vacuum',
        searchVolume: 1600,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        sourceType: 'SEARCH_TERM_HIGH_PERFORMING',
      },
    ]
    const supplementedCandidates = [
      ...filteredCandidates,
      {
        keyword: 'brandx cordless vacuum',
        searchVolume: 0,
        source: 'KEYWORD_POOL',
        sourceType: 'KEYWORD_POOL',
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed
      .mockImplementationOnce(() =>
        contextFilterResult(filteredCandidates, {
          qualityRemovedCount: 1,
          blockedKeywordKeys: ['brandx noisy rejected term'],
        })
      )
      .mockImplementationOnce(({ keywordsWithVolume }: any) =>
        contextFilterResult(keywordsWithVolume)
      )
    mocks.applyKeywordSupplementationOnce.mockImplementation(async ({ keywordsWithVolume }: any) => {
      expect(keywordsWithVolume).toEqual(filteredCandidates)
      return {
        keywordsWithVolume: supplementedCandidates,
        keywords: supplementedCandidates.map((item) => item.keyword),
        keywordSupplementation: {
          triggered: true,
          beforeCount: 1,
          afterCount: 2,
          addedKeywords: [{ keyword: 'brandx cordless vacuum', source: 'keyword_pool' }],
          supplementCapApplied: false,
        },
      }
    })
    mocks.selectCreativeKeywords.mockImplementation(({ keywordsWithVolume }: any) => ({
      keywords: (keywordsWithVolume || []).map((item: any) => item.keyword),
      keywordsWithVolume: keywordsWithVolume || [],
      truncated: false,
      sourceQuotaAudit: {
        enabled: true,
        fallbackMode: false,
        targetCount: 2,
        requiredBrandCount: 0,
        acceptedBrandCount: 2,
        acceptedCount: 2,
        deferredCount: 0,
        deferredRefillCount: 0,
        deferredRefillTriggered: false,
        underfillBeforeRefill: 0,
        quota: { combinedLowTrustCap: 1, aiCap: 1, aiLlmRawCap: 1 },
        acceptedByClass: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
        blockedByCap: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
      },
    }))
    const filterCallsBefore = mocks.filterCreativeKeywordsByOfferContextDetailed.mock.calls.length

    const result = await buildCreativeKeywordSet({
      offer: { brand: 'BrandX', product_name: 'X200 Vacuum' },
      userId: 1,
      brandName: 'BrandX',
      targetLanguage: 'en',
      creativeType: 'product_intent',
      bucket: 'D',
      scopeLabel: 'unit-post-filter-supplement',
      keywordsWithVolume: [
        ...filteredCandidates,
        {
          keyword: 'brandx noisy rejected term',
          searchVolume: 50,
          source: 'AI_GENERATED',
          sourceType: 'AI_LLM_RAW',
        },
      ] as any,
      enableSupplementation: true,
      fallbackMode: false,
    })

    expect(mocks.filterCreativeKeywordsByOfferContextDetailed.mock.calls.length - filterCallsBefore).toBe(2)
    expect(result.executableKeywords).toEqual(expect.arrayContaining([
      'brandx x200 vacuum',
      'brandx cordless vacuum',
    ]))
    expect(result.executableKeywords.length).toBeGreaterThanOrEqual(2)
    expect(result.executableKeywords.length).toBeLessThanOrEqual(expectedFloor)
    expect(new Set(result.executableKeywords).size).toBe(result.executableKeywords.length)
    expect(result.keywordSupplementation).toMatchObject({
      triggered: true,
      beforeCount: 1,
      afterCount: 2,
    })
    expect(result.audit.supplementationSources).toMatchObject({
      KEYWORD_POOL: { count: 1, ratio: 1 },
    })
    expect(result.audit.contextFilterStats).toMatchObject({
      removedByForbidden: 0,
      removedByQuality: 1,
      removedByModelFamily: 0,
      removedByIntentTightening: 0,
    })
    expect(result.audit.selectionMetrics.contractSatisfied).toBe(true)
    expect(result.audit.selectionMetrics.dNonPureBrandKeywords.count).toBeGreaterThanOrEqual(2)
    expect(result.audit.pipeline).toMatchObject({
      initialCandidateCount: 2,
      initialContextFilteredCount: 1,
      postSupplementCandidateCount: 2,
      postSupplementContextFilteredCount: 2,
      selectionFallbackTriggered: true,
      selectionFallbackSource: 'original',
      selectionFallbackReason: 'selection_empty',
      contractSatisfiedAfterFallback: true,
      supplementAppliedAfterFilter: true,
    })
    expect(result.audit.pipeline.finalCandidatePoolCount).toBeGreaterThanOrEqual(result.executableKeywords.length)
  })

  it('reuses offer-context-filtered seed candidates without re-running initial context filter', async () => {
    const expectedFloor = resolveCreativeKeywordMinimumOutputCount({
      creativeType: 'model_intent',
      maxKeywords: 50,
      bucket: 'B',
    })
    const contextFilteredSeedCandidates = [
      {
        keyword: 'novilla king size mattress',
        searchVolume: 260,
        source: 'KEYWORD_POOL',
        sourceType: 'CANONICAL_BUCKET_VIEW',
        derivedTags: ['OFFER_CONTEXT_FILTERED'],
      },
      {
        keyword: 'novilla memory foam mattress',
        searchVolume: 320,
        source: 'KEYWORD_POOL',
        sourceType: 'CANONICAL_BUCKET_VIEW',
        derivedTags: ['MODEL_FAMILY_GUARD', 'OFFER_CONTEXT_FILTERED'],
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockImplementation(({ keywordsWithVolume }: any) =>
      contextFilterResult(keywordsWithVolume)
    )
    mocks.selectCreativeKeywords.mockImplementation(({ keywordsWithVolume }: any) => ({
      keywords: (keywordsWithVolume || []).map((item: any) => item.keyword),
      keywordsWithVolume: keywordsWithVolume || [],
      truncated: false,
      sourceQuotaAudit: {
        enabled: true,
        fallbackMode: false,
        targetCount: 2,
        requiredBrandCount: 0,
        acceptedBrandCount: 2,
        acceptedCount: 2,
        deferredCount: 0,
        deferredRefillCount: 0,
        deferredRefillTriggered: false,
        underfillBeforeRefill: 0,
        quota: { combinedLowTrustCap: 1, aiCap: 1, aiLlmRawCap: 1 },
        acceptedByClass: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
        blockedByCap: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
      },
    }))

    const filterCallsBefore = mocks.filterCreativeKeywordsByOfferContextDetailed.mock.calls.length

    const result = await buildCreativeKeywordSet({
      offer: { brand: 'Novilla', product_name: 'Novilla King Mattress 12 Inch' },
      userId: 1,
      brandName: 'Novilla',
      targetLanguage: 'en',
      creativeType: 'model_intent',
      bucket: 'B',
      scopeLabel: 'unit-context-filter-reuse',
      keywordsWithVolume: [],
      keywords: [],
      seedCandidates: contextFilteredSeedCandidates as any,
      enableSupplementation: false,
      fallbackMode: false,
    })

    expect(mocks.filterCreativeKeywordsByOfferContextDetailed.mock.calls.length - filterCallsBefore).toBe(0)
    expect(result.executableKeywords).toEqual(expect.arrayContaining([
      'novilla king size mattress',
      'novilla memory foam mattress',
    ]))
    expect(result.executableKeywords.length).toBeGreaterThanOrEqual(2)
    expect(result.executableKeywords.length).toBeLessThanOrEqual(expectedFloor)
    expect(result.audit.contextFilterStats).toMatchObject({
      removedByForbidden: 0,
      removedByQuality: 0,
      removedByModelFamily: 0,
      removedByIntentTightening: 0,
    })
    expect(result.audit.pipeline).toMatchObject({
      initialCandidateCount: 2,
      initialContextFilteredCount: 2,
      postSupplementCandidateCount: 2,
      postSupplementContextFilteredCount: 2,
      finalCandidatePoolCount: result.executableKeywords.length,
      selectionFallbackTriggered: true,
      selectionFallbackSource: 'original',
      selectionFallbackReason: 'selection_empty',
      contractSatisfiedAfterFallback: true,
    })
  })

  it('keeps context-filter-generated safe fallback keywords inside the final candidate pool', async () => {
    const expectedFloor = resolveCreativeKeywordMinimumOutputCount({
      creativeType: 'model_intent',
      maxKeywords: 50,
      bucket: 'B',
    })
    const generatedFallbackCandidates = [
      {
        keyword: 'novilla king mattress',
        searchVolume: 0,
        source: 'MODEL_FAMILY_GUARD',
        sourceType: 'MODEL_FAMILY_GUARD',
        derivedTags: ['MODEL_FAMILY_GUARD'],
      },
      {
        keyword: 'novilla memory foam mattress',
        searchVolume: 0,
        source: 'MODEL_FAMILY_GUARD',
        sourceType: 'MODEL_FAMILY_GUARD',
        derivedTags: ['MODEL_FAMILY_GUARD'],
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(contextFilterResult(
      generatedFallbackCandidates,
      {
        modelFamilyRemovedCount: 1,
        blockedKeywordKeys: ['novilla queen mattress'],
      }
    ))
    mocks.selectCreativeKeywords.mockImplementation(({ keywordsWithVolume }: any) => ({
      keywords: (keywordsWithVolume || []).map((item: any) => item.keyword),
      keywordsWithVolume: keywordsWithVolume || [],
      truncated: false,
      sourceQuotaAudit: {
        enabled: true,
        fallbackMode: false,
        targetCount: 2,
        requiredBrandCount: 0,
        acceptedBrandCount: 2,
        acceptedCount: 2,
        deferredCount: 0,
        deferredRefillCount: 0,
        deferredRefillTriggered: false,
        underfillBeforeRefill: 0,
        quota: { combinedLowTrustCap: 1, aiCap: 1, aiLlmRawCap: 1 },
        acceptedByClass: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
        blockedByCap: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
      },
    }))

    const result = await buildCreativeKeywordSet({
      offer: { brand: 'Novilla', product_name: 'Novilla King Mattress 12 Inch' },
      userId: 1,
      brandName: 'Novilla',
      targetLanguage: 'en',
      creativeType: 'model_intent',
      bucket: 'B',
      scopeLabel: 'unit-context-generated-candidate-pool',
      keywordsWithVolume: [
        {
          keyword: 'novilla queen mattress',
          searchVolume: 180,
          source: 'KEYWORD_POOL',
          sourceType: 'CANONICAL_BUCKET_VIEW',
        },
      ] as any,
      enableSupplementation: false,
      fallbackMode: false,
    })

    expect(result.executableKeywords).toEqual(expect.arrayContaining([
      'novilla king mattress',
      'novilla memory foam mattress',
    ]))
    expect(result.executableKeywords.length).toBeGreaterThanOrEqual(2)
    expect(result.executableKeywords.length).toBeLessThanOrEqual(expectedFloor)
    expect(result.candidatePool.map((item) => item.keyword)).toEqual(expect.arrayContaining([
      'novilla king mattress',
      'novilla memory foam mattress',
    ]))
    expect(result.audit.pipeline).toMatchObject({
      finalCandidatePoolCount: result.executableKeywords.length,
      selectionFallbackTriggered: true,
      selectionFallbackSource: 'original',
      selectionFallbackReason: 'selection_empty',
    })
  })

  it('merges same-keyword provenance across primary and seed candidates', async () => {
    const primaryCandidates = [
      {
        keyword: 'brandx x200 vacuum',
        searchVolume: 1600,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        sourceType: 'SEARCH_TERM_HIGH_PERFORMING',
        sourceSubtype: 'SEARCH_TERM_HIGH_PERFORMING',
        rawSource: 'SEARCH_TERM',
        sourceField: 'search_terms',
        derivedTags: ['SEARCH_TERM'],
        evidence: ['x200'],
      },
    ]
    const seedCandidates = [
      {
        keyword: 'brandx x200 vacuum',
        searchVolume: 900,
        source: 'KEYWORD_POOL',
        sourceType: 'CANONICAL_BUCKET_VIEW',
        sourceSubtype: 'CANONICAL_BUCKET_VIEW',
        rawSource: 'DERIVED_VIEW',
        sourceField: 'keyword_pool',
        derivedTags: ['CANONICAL_BUCKET_VIEW'],
        evidence: ['bucket_b'],
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockImplementation(({ keywordsWithVolume }: any) =>
      contextFilterResult(keywordsWithVolume)
    )
    mocks.selectCreativeKeywords.mockImplementation(({ keywordsWithVolume }: any) => ({
      keywords: (keywordsWithVolume || []).map((item: any) => item.keyword),
      keywordsWithVolume: keywordsWithVolume || [],
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
    }))
    mocks.applyKeywordSupplementationOnce.mockImplementation(async ({ keywordsWithVolume }: any) => ({
      keywordsWithVolume,
      keywordSupplementation: {
        triggered: false,
        beforeCount: 1,
        afterCount: 1,
        addedKeywords: [],
        supplementCapApplied: false,
      },
    }))

    const result = await buildCreativeKeywordSet({
      offer: { brand: 'BrandX' },
      userId: 1,
      brandName: 'BrandX',
      targetLanguage: 'en',
      scopeLabel: 'unit-provenance-merge',
      keywordsWithVolume: primaryCandidates as any,
      seedCandidates: seedCandidates as any,
      enableSupplementation: true,
    })

    expect(result.executableKeywords).toEqual(['brandx x200 vacuum'])
    expect(result.keywordsWithVolume).toHaveLength(1)
    expect(result.keywordsWithVolume[0]).toMatchObject({
      keyword: 'brandx x200 vacuum',
      searchVolume: 1600,
      source: 'SEARCH_TERM_HIGH_PERFORMING',
      rawSource: 'SEARCH_TERM',
    })
    expect(result.candidatePool).toHaveLength(1)
    expect(result.candidatePool[0]).toMatchObject({
      keyword: 'brandx x200 vacuum',
      sourceSubtype: 'SEARCH_TERM_HIGH_PERFORMING',
      sourceField: 'search_terms',
    })
    expect(result.candidatePool[0].derivedTags || []).toEqual(
      expect.arrayContaining(['SEARCH_TERM', 'CANONICAL_BUCKET_VIEW'])
    )
    expect(result.candidatePool[0].evidence || []).toEqual(
      expect.arrayContaining(['x200', 'bucket_b'])
    )
    expect(result.candidatePool[0].provenance || []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceSubtype: 'SEARCH_TERM_HIGH_PERFORMING',
          rawSource: 'SEARCH_TERM',
        }),
        expect.objectContaining({
          sourceSubtype: 'CANONICAL_BUCKET_VIEW',
          rawSource: 'DERIVED_VIEW',
        }),
      ])
    )
    expect(result.candidatePool[0].creativeAffinity).toMatchObject({
      label: 'mixed',
      level: 'high',
    })
    expect(result.audit.creativeAffinityByLabel).toMatchObject({
      MIXED: { count: 1, ratio: 1 },
    })
  })

  it('normalizes raw bucket seed candidates inside builder', async () => {
    const aiCandidates = [
      {
        keyword: 'brandx ai vacuum',
        searchVolume: 300,
        source: 'AI_GENERATED',
        sourceType: 'AI_LLM_RAW',
      },
    ]
    const rawSeedCandidates = [
      'brandx x200 vacuum',
      {
        keyword: 'brandx x300 vacuum',
        searchVolume: '800',
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(contextFilterResult([]))
    mocks.selectCreativeKeywords.mockImplementation(({ keywordsWithVolume }: any) => ({
      keywords: (keywordsWithVolume || []).map((item: any) => item.keyword),
      keywordsWithVolume: keywordsWithVolume || [],
      truncated: false,
      sourceQuotaAudit: {
        enabled: true,
        fallbackMode: false,
        targetCount: 2,
        requiredBrandCount: 0,
        acceptedBrandCount: 2,
        acceptedCount: 2,
        deferredCount: 0,
        deferredRefillCount: 0,
        deferredRefillTriggered: false,
        underfillBeforeRefill: 0,
        quota: { combinedLowTrustCap: 1, aiCap: 1, aiLlmRawCap: 1 },
        acceptedByClass: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
        blockedByCap: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
      },
    }))
    mocks.applyKeywordSupplementationOnce.mockImplementation(async ({ keywordsWithVolume }: any) => ({
      keywordsWithVolume,
      keywords: (keywordsWithVolume || []).map((item: any) => item.keyword),
      keywordSupplementation: {
        triggered: false,
        beforeCount: 2,
        afterCount: 2,
        addedKeywords: [],
        supplementCapApplied: false,
      },
    }))

    const result = await buildCreativeKeywordSet({
      offer: { brand: 'BrandX' },
      userId: 1,
      brandName: 'BrandX',
      targetLanguage: 'en',
      scopeLabel: 'unit-seed-normalization',
      keywordsWithVolume: aiCandidates as any,
      keywords: aiCandidates.map((item) => item.keyword),
      seedCandidates: rawSeedCandidates as any,
      enableSupplementation: true,
      fallbackMode: false,
    })

    expect(result.contextFallbackStrategy).toBe('keyword_pool')
    expect(result.executableKeywords).toEqual(['brandx x200 vacuum', 'brandx x300 vacuum'])
    expect(result.keywordsWithVolume).toEqual([
      expect.objectContaining({
        keyword: 'brandx x200 vacuum',
        searchVolume: 0,
        source: 'KEYWORD_POOL',
        sourceType: 'CANONICAL_BUCKET_VIEW',
      }),
      expect.objectContaining({
        keyword: 'brandx x300 vacuum',
        searchVolume: 800,
        source: 'KEYWORD_POOL',
        sourceType: 'CANONICAL_BUCKET_VIEW',
      }),
    ])
  })

  it('triggers builder non-empty rescue when selection exhausts candidates', async () => {
    const candidates = [
      {
        keyword: 'brandx outdoor camera',
        searchVolume: 0,
        source: 'AI_GENERATED',
        sourceType: 'AI_LLM_RAW',
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(contextFilterResult(candidates))
    mocks.selectCreativeKeywords.mockReturnValue({
      keywords: [],
      keywordsWithVolume: [],
      truncated: false,
      sourceQuotaAudit: {
        enabled: true,
        fallbackMode: false,
        targetCount: 0,
        requiredBrandCount: 0,
        acceptedBrandCount: 0,
        acceptedCount: 0,
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
      offer: {
        brand: 'BrandX',
        category: 'Security Camera',
        product_name: 'Outdoor Camera',
      },
      userId: 1,
      brandName: 'BrandX',
      targetLanguage: 'en',
      creativeType: 'product_intent',
      bucket: 'D',
      scopeLabel: 'unit-empty-selection',
      keywordsWithVolume: candidates as any,
      keywords: candidates.map((item) => item.keyword),
      enableSupplementation: false,
      fallbackMode: false,
    })

    expect(result.executableKeywords.length).toBeGreaterThan(0)
    expect(result.promptKeywords.length).toBeGreaterThan(0)
    expect(result.contextFallbackStrategy).toBe('original')
    expect(result.candidatePool).toEqual(expect.arrayContaining([
      expect.objectContaining({
        keyword: 'brandx outdoor camera',
        promptEligible: true,
        executableEligible: true,
      }),
    ]))
    expect(result.audit.pipeline).toMatchObject({
      selectionFallbackTriggered: true,
      selectionFallbackSource: 'original',
      selectionFallbackReason: 'selection_empty',
      contractSatisfiedAfterFallback: true,
      finalInvariantTriggered: false,
      finalInvariantCandidateCount: 0,
      nonEmptyRescueTriggered: true,
    })
  })

  it('keeps model_intent blocked from original AI fallback while still using builder non-empty rescue', async () => {
    const aiCandidates = [
      {
        keyword: 'brandx official store',
        searchVolume: 0,
        source: 'AI_GENERATED',
        sourceType: 'AI_LLM_RAW',
      },
    ]
    const bucketSeeds = [
      {
        keyword: 'brandx king mattress',
        searchVolume: 120,
        source: 'KEYWORD_POOL',
        sourceType: 'CANONICAL_BUCKET_VIEW',
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(contextFilterResult([]))
    mocks.selectCreativeKeywords.mockReturnValue({
      keywords: [],
      keywordsWithVolume: [],
      truncated: false,
      sourceQuotaAudit: {
        enabled: true,
        fallbackMode: false,
        targetCount: 0,
        requiredBrandCount: 0,
        acceptedBrandCount: 0,
        acceptedCount: 0,
        deferredCount: 0,
        deferredRefillCount: 0,
        deferredRefillTriggered: false,
        underfillBeforeRefill: 0,
        quota: { combinedLowTrustCap: 1, aiCap: 1, aiLlmRawCap: 1 },
        acceptedByClass: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
        blockedByCap: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
      },
    })
    mocks.applyKeywordSupplementationOnce.mockImplementation(async ({ keywordsWithVolume }: any) => ({
      keywordsWithVolume,
      keywords: (keywordsWithVolume || []).map((item: any) => item.keyword),
      keywordSupplementation: {
        triggered: false,
        beforeCount: 1,
        afterCount: 1,
        addedKeywords: [],
        supplementCapApplied: false,
      },
    }))
    const selectCallsBefore = mocks.selectCreativeKeywords.mock.calls.length

    const result = await buildCreativeKeywordSet({
      offer: {
        brand: 'BrandX',
        category: 'Mattress',
        product_name: 'BrandX King Mattress',
      },
      userId: 1,
      brandName: 'BrandX',
      targetLanguage: 'en',
      creativeType: 'model_intent',
      bucket: 'B',
      scopeLabel: 'unit-model-intent-no-original-fallback',
      keywordsWithVolume: aiCandidates as any,
      keywords: aiCandidates.map((item) => item.keyword),
      seedCandidates: bucketSeeds as any,
      enableSupplementation: true,
      fallbackMode: false,
    })

    expect(mocks.selectCreativeKeywords.mock.calls.length - selectCallsBefore).toBe(2)
    expect(mocks.selectCreativeKeywords.mock.calls.at(selectCallsBefore)?.[0]).toEqual(expect.objectContaining({
      keywordsWithVolume: [
        expect.objectContaining({
          keyword: 'brandx king mattress',
          source: 'KEYWORD_POOL',
          sourceType: 'CANONICAL_BUCKET_VIEW',
        }),
      ],
    }))
    expect(mocks.selectCreativeKeywords.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      keywordsWithVolume: expect.arrayContaining([
        expect.objectContaining({
          sourceType: 'BUILDER_NON_EMPTY_RESCUE',
        }),
      ]),
    }))
    expect(result.executableKeywords.length).toBeGreaterThan(0)
    expect(result.promptKeywords.length).toBeGreaterThan(0)
    expect(result.contextFallbackStrategy).toBe('keyword_pool')
    expect(result.audit.pipeline).toMatchObject({
      selectionFallbackTriggered: true,
      selectionFallbackSource: 'keyword_pool',
      selectionFallbackReason: 'context_filter_empty',
      contractSatisfiedAfterFallback: false,
      finalInvariantTriggered: true,
      finalInvariantCandidateCount: 1,
      nonEmptyRescueTriggered: true,
    })
  })

  it('does not leak context-blocked original candidates back into fallback prompt or candidate pools', async () => {
    const blockedAiCandidates = [
      {
        keyword: 'brandx official store',
        searchVolume: 0,
        source: 'AI_GENERATED',
        sourceType: 'AI_LLM_RAW',
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(contextFilterResult([], {
      forbiddenRemovedCount: 1,
      blockedKeywordKeys: ['brandx official store'],
    } as any))
    mocks.selectCreativeKeywords.mockReturnValue({
      keywords: [],
      keywordsWithVolume: [],
      truncated: false,
      sourceQuotaAudit: {
        enabled: true,
        fallbackMode: false,
        targetCount: 0,
        requiredBrandCount: 0,
        acceptedBrandCount: 0,
        acceptedCount: 0,
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
      offer: {
        brand: 'BrandX',
        category: 'Security Camera',
        product_name: 'Outdoor Camera',
      },
      userId: 1,
      brandName: 'BrandX',
      targetLanguage: 'en',
      creativeType: 'product_intent',
      bucket: 'D',
      scopeLabel: 'unit-no-blocked-fallback-leak',
      keywordsWithVolume: blockedAiCandidates as any,
      keywords: blockedAiCandidates.map((item) => item.keyword),
      enableSupplementation: false,
      fallbackMode: false,
    })

    expect(result.executableKeywords).toEqual(expect.arrayContaining([
      'brandx',
      'brandx outdoor camera',
    ]))
    expect(result.promptKeywords).not.toContain('brandx official store')
    expect(result.candidatePool.map((item) => item.keyword)).not.toContain('brandx official store')
  })

  it('applies target-language gate to fallback and non-empty rescue candidates', async () => {
    const englishCandidates = [
      {
        keyword: 'waterdrop official filter x16',
        searchVolume: 120,
        source: 'KEYWORD_POOL',
        sourceType: 'CANONICAL_BUCKET_VIEW',
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(contextFilterResult(englishCandidates))
    mocks.selectCreativeKeywords.mockReturnValue({
      keywords: [],
      keywordsWithVolume: [],
      truncated: false,
      sourceQuotaAudit: {
        enabled: true,
        fallbackMode: false,
        targetCount: 0,
        requiredBrandCount: 0,
        acceptedBrandCount: 0,
        acceptedCount: 0,
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
      offer: {
        brand: 'Waterdrop',
        category: 'Official Store',
        product_name: 'Waterdrop Official Filter X16',
      },
      userId: 1,
      brandName: 'Waterdrop',
      targetLanguage: 'it',
      creativeType: 'product_intent',
      bucket: 'D',
      scopeLabel: 'unit-language-gate-fallback-and-rescue',
      keywordsWithVolume: englishCandidates as any,
      keywords: englishCandidates.map((item) => item.keyword),
      enableSupplementation: false,
      fallbackMode: false,
    })

    expect(result.executableKeywords).toContain('waterdrop')
    expect(result.promptKeywords).toContain('waterdrop')
    expect(result.executableKeywords).not.toContain('waterdrop official filter x16')
    expect(result.candidatePool.map((item) => item.keyword)).not.toContain('waterdrop official filter x16')
    expect(result.executableKeywords.some((keyword) => /official/i.test(keyword))).toBe(false)
    expect(result.candidatePool).toEqual(expect.arrayContaining([
      expect.objectContaining({
        keyword: 'waterdrop',
        sourceSubtype: 'BUILDER_NON_EMPTY_RESCUE',
        rawSource: 'DERIVED_RESCUE',
        sourceField: 'derived_rescue',
      }),
    ]))
  })

  it('creates risk alerts when context tightening is too high and output stays below floor', async () => {
    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockReset()
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReset()
    mocks.selectCreativeKeywords.mockReset()
    mocks.createRiskAlert.mockReset()

    const inputCandidates = Array.from({ length: 10 }, (_, index) => ({
      keyword: `brandx demand keyword ${index + 1}`,
      searchVolume: 1000 - index * 10,
      source: 'KEYWORD_POOL',
      sourceType: 'CANONICAL_BUCKET_VIEW',
    }))

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(contextFilterResult(
      [inputCandidates[0]],
      {
        contextMismatchRemovedCount: 8,
        intentTighteningRemovedCount: 1,
      }
    ))

    let selectCallCount = 0
    mocks.selectCreativeKeywords.mockImplementation(({ keywordsWithVolume }: any) => {
      selectCallCount += 1
      if (selectCallCount === 1) {
        return {
          keywords: [],
          keywordsWithVolume: [],
          truncated: false,
          sourceQuotaAudit: {
            enabled: true,
            fallbackMode: false,
            targetCount: 0,
            requiredBrandCount: 0,
            acceptedBrandCount: 0,
            acceptedCount: 0,
            deferredCount: 0,
            deferredRefillCount: 0,
            deferredRefillTriggered: false,
            underfillBeforeRefill: 0,
            quota: { combinedLowTrustCap: 1, aiCap: 1, aiLlmRawCap: 1 },
            acceptedByClass: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
            blockedByCap: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
          },
        }
      }
      const first = (keywordsWithVolume || [])[0]
      return {
        keywords: first ? [first.keyword] : [],
        keywordsWithVolume: first ? [first] : [],
        truncated: false,
        sourceQuotaAudit: {
          enabled: true,
          fallbackMode: false,
          targetCount: first ? 1 : 0,
          requiredBrandCount: 0,
          acceptedBrandCount: first ? 1 : 0,
          acceptedCount: first ? 1 : 0,
          deferredCount: 0,
          deferredRefillCount: 0,
          deferredRefillTriggered: false,
          underfillBeforeRefill: 0,
          quota: { combinedLowTrustCap: 1, aiCap: 1, aiLlmRawCap: 1 },
          acceptedByClass: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
          blockedByCap: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
        },
      }
    })

    const alertCallsBefore = mocks.createRiskAlert.mock.calls.length

    await buildCreativeKeywordSet({
      offer: {
        id: 1001,
        brand: 'BrandX',
        category: 'Robot Vacuum',
        product_name: 'BrandX Robot Vacuum',
      } as any,
      userId: 77,
      brandName: 'BrandX',
      targetLanguage: 'en',
      creativeType: 'product_intent',
      bucket: 'D',
      scopeLabel: 'unit-risk-alerts',
      keywordsWithVolume: inputCandidates as any,
      keywords: inputCandidates.map((item) => item.keyword),
      enableSupplementation: false,
      fallbackMode: false,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    const newAlertCalls = mocks.createRiskAlert.mock.calls.slice(alertCallsBefore)
    const alertTypes = newAlertCalls.map((call: any[]) => call[1])
    expect(alertTypes).toEqual(expect.arrayContaining([
      'creative_keyword_context_intent_removal_high',
      'creative_keyword_fallback_rescue_triggered',
    ]))
    expect(alertTypes).not.toContain('creative_keyword_count_below_floor')
  })

  it('tops up underfilled model_intent output with offer-derived rescue candidates without dropping existing precise keywords', async () => {
    const expectedFloor = resolveCreativeKeywordMinimumOutputCount({
      creativeType: 'model_intent',
      maxKeywords: 50,
      bucket: 'B',
    })
    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockReset()
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReset()
    mocks.selectCreativeKeywords.mockReset()

    const initialSelected = [
      {
        keyword: 'novilla queen mattress',
        searchVolume: 420,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        sourceType: 'SEARCH_TERM_HIGH_PERFORMING',
        matchType: 'EXACT',
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(contextFilterResult(initialSelected))
    mocks.selectCreativeKeywords
      .mockReturnValueOnce({
        keywords: initialSelected.map((item) => item.keyword),
        keywordsWithVolume: initialSelected,
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
      .mockReturnValueOnce({
        keywords: initialSelected.map((item) => item.keyword),
        keywordsWithVolume: initialSelected,
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
      offer: {
        brand: 'Novilla',
        category: 'Mattresses',
        product_name: 'Novilla King Mattress 12 Inch',
      },
      userId: 1,
      brandName: 'Novilla',
      targetLanguage: 'en',
      creativeType: 'model_intent',
      bucket: 'B',
      scopeLabel: 'unit-underfill-topup',
      keywordsWithVolume: initialSelected as any,
      keywords: initialSelected.map((item) => item.keyword),
      enableSupplementation: false,
      fallbackMode: false,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(mocks.selectCreativeKeywords).toHaveBeenCalledTimes(2)
    expect(mocks.selectCreativeKeywords.mock.calls.at(1)?.[0]).toEqual(expect.objectContaining({
      keywordsWithVolume: expect.arrayContaining([
        expect.objectContaining({
          sourceType: 'BUILDER_NON_EMPTY_RESCUE',
          keyword: 'novilla king mattress 12 inch',
        }),
      ]),
    }))
    expect(result.executableKeywords).toEqual(expect.arrayContaining([
      'novilla queen mattress',
      'novilla king mattress 12 inch',
    ]))
    expect(result.executableKeywords.length).toBeGreaterThanOrEqual(2)
    expect(result.executableKeywords.length).toBeLessThanOrEqual(expectedFloor)
    expect(result.keywordSourceAudit.sourceQuotaAudit.acceptedCount).toBe(result.executableKeywords.length)
    expect(result.keywordSourceAudit.sourceQuotaAudit.targetCount).toBeGreaterThanOrEqual(
      result.executableKeywords.length
    )
    expect(result.audit.pipeline).toMatchObject({
      selectionFallbackTriggered: true,
      selectionFallbackSource: 'original',
      selectionFallbackReason: 'selection_empty',
      nonEmptyRescueTriggered: true,
      nonEmptyRescueCandidateCount: expect.any(Number),
    })
  })

  it('normalizes thousands separators before splitting model-intent rescue segments', async () => {
    const initialSelected = [
      {
        keyword: 'dreo portable ac',
        searchVolume: 420,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        sourceType: 'SEARCH_TERM_HIGH_PERFORMING',
        matchType: 'EXACT',
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockReset()
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReset()
    mocks.selectCreativeKeywords.mockReset()
    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(contextFilterResult(initialSelected))
    mocks.selectCreativeKeywords
      .mockReturnValueOnce({
        keywords: initialSelected.map((item) => item.keyword),
        keywordsWithVolume: initialSelected,
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
      .mockReturnValueOnce({
        keywords: initialSelected.map((item) => item.keyword),
        keywordsWithVolume: initialSelected,
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

    await buildCreativeKeywordSet({
      offer: {
        brand: 'Dreo',
        category: 'Portable',
        product_name: 'DREO Portable Air Conditioners, 14000 BTU ASHRAE (10 000 BTU DOE) Smart AC Unit',
        extracted_headlines: ['Quiet smart AC by Dreo'],
      },
      userId: 1,
      brandName: 'Dreo',
      targetLanguage: 'en',
      creativeType: 'model_intent',
      bucket: 'B',
      scopeLabel: 'unit-thousands-separator-rescue',
      keywordsWithVolume: initialSelected as any,
      keywords: initialSelected.map((item) => item.keyword),
      enableSupplementation: false,
      fallbackMode: false,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(mocks.selectCreativeKeywords).toHaveBeenCalledTimes(2)
    const secondPassKeywords = (
      mocks.selectCreativeKeywords.mock.calls.at(1)?.[0]?.keywordsWithVolume || []
    ).map((item: any) => item.keyword)
    expect(secondPassKeywords).toContain('dreo 10000 btu doe')
    expect(secondPassKeywords).not.toContain('dreo 10')
    expect(secondPassKeywords).not.toContain('dreo 10 000 btu doe')
    expect(secondPassKeywords).not.toContain('dreo 000 btu doe')
    expect(secondPassKeywords).not.toContain('dreo 000 btu doe smart')
    expect(secondPassKeywords).not.toContain('dreo 14000 btu ashrae 10')
    expect(secondPassKeywords).not.toContain('dreo quiet smart ac by')
  })

  it('keeps model_intent non-empty rescue certification phrases branded when brand exists', async () => {
    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockReset()
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReset()
    mocks.selectCreativeKeywords.mockReset()

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(contextFilterResult([]))
    mocks.selectCreativeKeywords.mockReturnValue({
      keywords: [],
      keywordsWithVolume: [],
      truncated: false,
      sourceQuotaAudit: {
        enabled: true,
        fallbackMode: false,
        targetCount: 0,
        requiredBrandCount: 0,
        acceptedBrandCount: 0,
        acceptedCount: 0,
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
      offer: {
        brand: 'Waterdrop',
        category: 'Reverse Osmosis Systems',
        product_name: 'Waterdrop X16 Reverse Osmosis System NSF/ANSI 58&372 Certified 1600 GPD',
      },
      userId: 1,
      brandName: 'Waterdrop',
      targetLanguage: 'en',
      creativeType: 'model_intent',
      bucket: 'B',
      scopeLabel: 'unit-model-intent-branded-cert-rescue',
      keywordsWithVolume: [] as any,
      keywords: [],
      enableSupplementation: false,
      fallbackMode: false,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    const rescueKeywords = result.candidatePool
      .filter((item) => item.sourceSubtype === 'BUILDER_NON_EMPTY_RESCUE')
      .map((item) => item.keyword)
    expect(rescueKeywords.length).toBeGreaterThan(0)
    expect(rescueKeywords.some((keyword) => keyword.startsWith('waterdrop nsf ansi'))).toBe(true)
    expect(rescueKeywords.some((keyword) => /^nsf ansi\b/.test(keyword))).toBe(false)
    expect(result.executableKeywords.some((keyword) => /^nsf ansi\b/.test(keyword))).toBe(false)
  })

  it('keeps product_intent non-empty rescue spec tokens branded when brand exists', async () => {
    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockReset()
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReset()
    mocks.selectCreativeKeywords.mockReset()

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(contextFilterResult([]))
    mocks.selectCreativeKeywords.mockReturnValue({
      keywords: [],
      keywordsWithVolume: [],
      truncated: false,
      sourceQuotaAudit: {
        enabled: true,
        fallbackMode: false,
        targetCount: 0,
        requiredBrandCount: 0,
        acceptedBrandCount: 0,
        acceptedCount: 0,
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
      offer: {
        brand: 'Dreo',
        category: 'Portable Air Conditioners',
        product_name: 'Dreo Portable Air Conditioner 14000 BTU 115V 45db',
      },
      userId: 1,
      brandName: 'Dreo',
      targetLanguage: 'en',
      creativeType: 'product_intent',
      bucket: 'D',
      scopeLabel: 'unit-product-intent-branded-spec-rescue',
      keywordsWithVolume: [] as any,
      keywords: [],
      enableSupplementation: false,
      fallbackMode: false,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    const rescueKeywords = result.candidatePool
      .filter((item) => item.sourceSubtype === 'BUILDER_NON_EMPTY_RESCUE')
      .map((item) => item.keyword)
    const isSpecKeyword = (keyword: string) => /\b(?:\d{2,4}\s*(?:btu|db|v)|\d+db|\d+v)\b/i.test(keyword)
    const brandedSpecKeywords = rescueKeywords.filter((keyword) =>
      keyword.includes('dreo') && isSpecKeyword(keyword)
    )
    const unbrandedSpecKeywords = rescueKeywords.filter((keyword) =>
      !keyword.includes('dreo') && isSpecKeyword(keyword)
    )

    expect(brandedSpecKeywords.length).toBeGreaterThan(0)
    expect(unbrandedSpecKeywords).toEqual([])
    expect(result.executableKeywords).not.toEqual(expect.arrayContaining([
      '14000 btu',
      '115v',
      '45db',
    ]))
  })

  it('uses the shared demand-intent floor to top up underfilled product_intent output with builder rescue candidates', async () => {
    const expectedFloor = resolveCreativeKeywordMinimumOutputCount({
      creativeType: 'product_intent',
      maxKeywords: 50,
      bucket: 'D',
    })
    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockReset()
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReset()
    mocks.selectCreativeKeywords.mockReset()

    const initialSelected = [
      {
        keyword: 'brandx robot vacuum cleaner',
        searchVolume: 420,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        sourceType: 'SEARCH_TERM_HIGH_PERFORMING',
        matchType: 'PHRASE',
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(contextFilterResult(initialSelected))
    mocks.selectCreativeKeywords.mockReturnValue({
      keywords: initialSelected.map((item) => item.keyword),
      keywordsWithVolume: initialSelected,
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
    mocks.applyKeywordSupplementationOnce.mockImplementation(async ({ keywordsWithVolume }: any) => ({
      keywordsWithVolume,
      keywords: (keywordsWithVolume || []).map((item: any) => item.keyword),
      keywordSupplementation: null,
    }))

    const result = await buildCreativeKeywordSet({
      offer: {
        brand: 'BrandX',
        category: 'Robot Vacuum',
        product_name: 'BrandX Robot Vacuum',
      },
      userId: 1,
      brandName: 'BrandX',
      targetLanguage: 'en',
      creativeType: 'product_intent',
      bucket: 'D',
      scopeLabel: 'unit-product-intent-shared-floor',
      keywordsWithVolume: initialSelected as any,
      keywords: initialSelected.map((item) => item.keyword),
      enableSupplementation: true,
      fallbackMode: false,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.executableKeywords).toContain('brandx robot vacuum cleaner')
    expect(result.executableKeywords.length).toBeGreaterThanOrEqual(2)
    expect(result.executableKeywords.length).toBeLessThanOrEqual(expectedFloor)
    expect(new Set(result.executableKeywords).size).toBe(result.executableKeywords.length)
    expect(result.audit.pipeline).toMatchObject({
      nonEmptyRescueTriggered: true,
      nonEmptyRescueCandidateCount: expect.any(Number),
      selectionFallbackSource: 'original',
    })
  })

  it('does not degrade model_intent underfill rescue into pure brand when only category context is available', async () => {
    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockReset()
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReset()
    mocks.selectCreativeKeywords.mockReset()

    const initialSelected = [
      {
        keyword: 'eufy x10 omni',
        searchVolume: 1800,
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        sourceType: 'SEARCH_TERM_HIGH_PERFORMING',
        matchType: 'EXACT',
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(contextFilterResult(initialSelected))
    mocks.selectCreativeKeywords
      .mockReturnValueOnce({
        keywords: initialSelected.map((item) => item.keyword),
        keywordsWithVolume: initialSelected,
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
      .mockReturnValueOnce({
        keywords: initialSelected.map((item) => item.keyword),
        keywordsWithVolume: initialSelected,
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
      offer: {
        brand: 'Eufy',
        category: 'Robot Vacuum',
      },
      userId: 1,
      brandName: 'Eufy',
      targetLanguage: 'en',
      creativeType: 'model_intent',
      bucket: 'B',
      scopeLabel: 'unit-model-intent-category-topup',
      keywordsWithVolume: initialSelected as any,
      keywords: initialSelected.map((item) => item.keyword),
      enableSupplementation: false,
      fallbackMode: false,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(mocks.selectCreativeKeywords.mock.calls.at(1)?.[0]).toEqual(expect.objectContaining({
      keywordsWithVolume: expect.arrayContaining([
        expect.objectContaining({
          sourceType: 'BUILDER_NON_EMPTY_RESCUE',
          keyword: 'eufy robot vacuum',
        }),
      ]),
    }))
    expect(result.executableKeywords).toEqual(expect.arrayContaining([
      'eufy x10 omni',
      'eufy robot vacuum',
    ]))
    expect(result.executableKeywords).not.toContain('eufy')
  })

  it('derives multiple cleaner model_intent rescue phrases from segmented product titles', async () => {
    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockReset()
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReset()
    mocks.selectCreativeKeywords.mockReset()

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(contextFilterResult([]))
    mocks.selectCreativeKeywords.mockReturnValue({
      keywords: [],
      keywordsWithVolume: [],
      truncated: false,
      sourceQuotaAudit: {
        enabled: true,
        fallbackMode: false,
        targetCount: 0,
        requiredBrandCount: 0,
        acceptedBrandCount: 0,
        acceptedCount: 0,
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
      offer: {
        brand: 'HiLIFE',
        category: 'Garment Steamers',
        product_name: 'HiLIFE Steamer for Clothes, 1100W Clothes Steamer, Fast Wrinkle Removal with Large 300ml Tank',
      },
      userId: 1,
      brandName: 'HiLIFE',
      targetLanguage: 'en',
      creativeType: 'model_intent',
      bucket: 'B',
      scopeLabel: 'unit-model-intent-segmented-rescue',
      keywordsWithVolume: [] as any,
      keywords: [],
      enableSupplementation: false,
      fallbackMode: false,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.executableKeywords).toEqual(expect.arrayContaining([
      'hilife steamer clothes',
      'hilife 1100w clothes steamer',
    ]))
    expect(result.executableKeywords).not.toContain('hilife steamer')
    expect(result.audit.pipeline).toMatchObject({
      nonEmptyRescueTriggered: true,
    })
  })

  it('skips marketing fragments and combines adjacent model/product segments in model_intent rescue', async () => {
    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockReset()
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReset()
    mocks.selectCreativeKeywords.mockReset()

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(contextFilterResult([]))
    mocks.selectCreativeKeywords.mockReturnValue({
      keywords: [],
      keywordsWithVolume: [],
      truncated: false,
      sourceQuotaAudit: {
        enabled: true,
        fallbackMode: false,
        targetCount: 0,
        requiredBrandCount: 0,
        acceptedBrandCount: 0,
        acceptedCount: 0,
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
      offer: {
        brand: 'Ringconn',
        category: 'Rings',
        product_name: "RingConn Gen 2, World’s First Smart Ring with Sleep Apnea Monitoring, No APP Subscription",
      },
      userId: 1,
      brandName: 'Ringconn',
      targetLanguage: 'en',
      creativeType: 'model_intent',
      bucket: 'B',
      scopeLabel: 'unit-model-intent-marketing-fragment-rescue',
      keywordsWithVolume: [] as any,
      keywords: [],
      enableSupplementation: false,
      fallbackMode: false,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.executableKeywords).toEqual(expect.arrayContaining([
      'ringconn gen 2 smart ring',
      'ringconn gen 2',
    ]))
    expect(result.executableKeywords.some((keyword) => /\bworld\b|\bfirst\b/.test(keyword))).toBe(false)
    expect(result.audit.pipeline).toMatchObject({
      nonEmptyRescueTriggered: true,
    })
  })

  it('recombines short hyphen-split product compounds in model_intent rescue', async () => {
    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockReset()
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReset()
    mocks.selectCreativeKeywords.mockReset()

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(contextFilterResult([]))
    mocks.selectCreativeKeywords.mockReturnValue({
      keywords: [],
      keywordsWithVolume: [],
      truncated: false,
      sourceQuotaAudit: {
        enabled: true,
        fallbackMode: false,
        targetCount: 0,
        requiredBrandCount: 0,
        acceptedBrandCount: 0,
        acceptedCount: 0,
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
      offer: {
        brand: 'EU Natural',
        category: 'Supplements',
        product_name: 'Eu Natural Urinary Harmony D-Mannose Supplement - Urinary Tract Health for Women',
      },
      userId: 1,
      brandName: 'EU Natural',
      targetLanguage: 'en',
      creativeType: 'model_intent',
      bucket: 'B',
      scopeLabel: 'unit-model-intent-hyphen-bridge-rescue',
      keywordsWithVolume: [] as any,
      keywords: [],
      enableSupplementation: false,
      fallbackMode: false,
      minBrandKeywords: 0,
      brandReserve: 0,
    })

    expect(result.executableKeywords).toEqual(expect.arrayContaining([
      'eu natural urinary harmony d mannose',
      'eu natural mannose supplement',
    ]))
    expect(result.executableKeywords).not.toContain('eu natural urinary harmony d')
  })

  it('deduplicates repeated rescue tokens and avoids generic unbranded category rescue for model_intent', async () => {
    const weakCandidates = [
      {
        keyword: 'novilla official store',
        searchVolume: 0,
        source: 'AI_GENERATED',
        sourceType: 'AI_LLM_RAW',
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(contextFilterResult([]))
    mocks.selectCreativeKeywords.mockReturnValue({
      keywords: [],
      keywordsWithVolume: [],
      truncated: false,
      sourceQuotaAudit: {
        enabled: true,
        fallbackMode: false,
        targetCount: 0,
        requiredBrandCount: 0,
        acceptedBrandCount: 0,
        acceptedCount: 0,
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
      offer: {
        brand: 'Novilla',
        category: 'Mattresses',
        product_name: 'Novilla King Mattress 12 Inch King',
      },
      userId: 1,
      brandName: 'Novilla',
      targetLanguage: 'en',
      creativeType: 'model_intent',
      bucket: 'B',
      scopeLabel: 'unit-model-intent-rescue-dedupe',
      keywordsWithVolume: weakCandidates as any,
      keywords: weakCandidates.map((item) => item.keyword),
      enableSupplementation: false,
      fallbackMode: false,
    })

    expect(result.executableKeywords.length).toBeGreaterThan(0)
    expect(result.executableKeywords).not.toContain('king mattress 12 inch king')
    expect(result.executableKeywords).not.toContain('mattresses')
    expect(result.executableKeywords).toEqual(expect.arrayContaining([
      'novilla king mattress 12 inch',
    ]))
  })

  it('backfills zero-volume selected keywords from global keyword cache', async () => {
    const selectedKeywords = [
      {
        keyword: 'novilla',
        searchVolume: 0,
        source: 'BRAND_SEED',
        sourceType: 'BRAND_SEED',
        sourceSubtype: 'BRAND_SEED',
      },
    ]

    mocks.dbQuery.mockResolvedValue([
      {
        keyword: 'novilla',
        search_volume: 2400,
      },
    ])
    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(contextFilterResult(selectedKeywords))
    mocks.selectCreativeKeywords.mockReturnValue({
      keywords: ['novilla'],
      keywordsWithVolume: selectedKeywords,
      truncated: false,
      sourceQuotaAudit: {
        enabled: true,
        fallbackMode: false,
        targetCount: 1,
        requiredBrandCount: 1,
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
      offer: { brand: 'Novilla', target_country: 'US', target_language: 'en' },
      userId: 1,
      brandName: 'Novilla',
      targetLanguage: 'en',
      creativeType: 'brand_intent',
      bucket: 'A',
      scopeLabel: 'unit-global-volume-backfill',
      keywordsWithVolume: selectedKeywords as any,
      keywords: ['novilla'],
      enableSupplementation: false,
      fallbackMode: false,
    })

    expect(mocks.dbQuery).toHaveBeenCalledTimes(1)
    expect(result.keywordsWithVolume).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyword: 'novilla',
          searchVolume: 2400,
        }),
      ])
    )
    expect(result.audit.withSearchVolumeKeywords).toBeGreaterThanOrEqual(1)
  })

  it('enforces minimum keyword floor when selection underfills', async () => {
    const primaryCandidates = [
      {
        keyword: 'brandx official',
        searchVolume: 1200,
        source: 'BRAND_SEED',
        sourceType: 'BRAND_SEED',
        sourceSubtype: 'BRAND_SEED',
      },
      {
        keyword: 'brandx air conditioner',
        searchVolume: 800,
        source: 'TITLE_EXTRACT',
        sourceType: 'TITLE_EXTRACT',
        sourceSubtype: 'TITLE_EXTRACT',
      },
    ]
    const seedCandidates = [
      {
        keyword: 'brandx portable ac',
        searchVolume: 650,
        source: 'KEYWORD_POOL',
        sourceType: 'KEYWORD_POOL',
        sourceSubtype: 'KEYWORD_POOL',
      },
      {
        keyword: 'brandx smart ac unit',
        searchVolume: 540,
        source: 'KEYWORD_POOL',
        sourceType: 'KEYWORD_POOL',
        sourceSubtype: 'KEYWORD_POOL',
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(
      contextFilterResult([...primaryCandidates, ...seedCandidates] as any)
    )
    mocks.selectCreativeKeywords.mockImplementation((input: any) => {
      const keep = Array.isArray(input?.keywordsWithVolume) ? input.keywordsWithVolume.slice(0, 2) : []
      return {
        keywords: keep.map((item: any) => item.keyword),
        keywordsWithVolume: keep,
        truncated: false,
        sourceQuotaAudit: {
          enabled: true,
          fallbackMode: false,
          targetCount: 2,
          requiredBrandCount: 1,
          acceptedBrandCount: 1,
          acceptedCount: keep.length,
          deferredCount: 0,
          deferredRefillCount: 0,
          deferredRefillTriggered: false,
          underfillBeforeRefill: 0,
          quota: { combinedLowTrustCap: 10, aiCap: 10, aiLlmRawCap: 10 },
          acceptedByClass: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
          blockedByCap: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
        },
      }
    })

    const result = await buildCreativeKeywordSet({
      offer: {
        brand: 'BrandX',
        product_name: 'BrandX AC516S Portable Air Conditioner',
        target_country: 'US',
        target_language: 'en',
      },
      userId: 1,
      brandName: 'BrandX',
      targetLanguage: 'en',
      creativeType: 'brand_intent',
      bucket: 'A',
      scopeLabel: 'unit-floor-topup',
      maxKeywords: 4,
      keywordsWithVolume: primaryCandidates as any,
      keywords: primaryCandidates.map((item) => item.keyword),
      seedCandidates: seedCandidates as any,
      enableSupplementation: false,
      fallbackMode: false,
    })

    expect(result.executableKeywords).toHaveLength(4)
    expect(result.executableKeywords).toEqual(
      expect.arrayContaining([
        'brandx official',
        'brandx air conditioner',
      ])
    )
    expect(
      result.audit.pipeline.finalInvariantTriggered || result.audit.pipeline.nonEmptyRescueTriggered
    ).toBe(true)
  })

  it('recovers bucket A floor for mixed-language inputs using localized and neutral rescue candidates', async () => {
    const weakCandidates = [
      {
        keyword: 'waterdrop official filter',
        searchVolume: 800,
        source: 'TITLE_EXTRACT',
        sourceType: 'TITLE_EXTRACT',
        sourceSubtype: 'TITLE_EXTRACT',
      },
      {
        keyword: 'waterdrop alkalisches mineral',
        searchVolume: 600,
        source: 'ABOUT_EXTRACT',
        sourceType: 'ABOUT_EXTRACT',
        sourceSubtype: 'ABOUT_EXTRACT',
      },
      {
        keyword: 'waterdrop x12',
        searchVolume: 500,
        source: 'TITLE_EXTRACT',
        sourceType: 'TITLE_EXTRACT',
        sourceSubtype: 'TITLE_EXTRACT',
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(contextFilterResult(weakCandidates as any))
    mocks.selectCreativeKeywords.mockImplementation((input: any) => {
      const keep = Array.isArray(input?.keywordsWithVolume) ? input.keywordsWithVolume.slice(0, 1) : []
      return {
        keywords: keep.map((item: any) => item.keyword),
        keywordsWithVolume: keep,
        truncated: false,
        sourceQuotaAudit: {
          enabled: true,
          fallbackMode: false,
          targetCount: Math.max(1, keep.length),
          requiredBrandCount: 1,
          acceptedBrandCount: keep.length,
          acceptedCount: keep.length,
          deferredCount: 0,
          deferredRefillCount: 0,
          deferredRefillTriggered: false,
          underfillBeforeRefill: 0,
          quota: { combinedLowTrustCap: 20, aiCap: 20, aiLlmRawCap: 20 },
          acceptedByClass: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
          blockedByCap: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
        },
      }
    })

    const result = await buildCreativeKeywordSet({
      offer: {
        brand: 'Waterdrop',
        category: 'Filtrierung für unter & über der Spüle',
        product_name: 'Waterdrop X12 Alkalisches Mineral pH+ Umkehrosmoseanlage NSF/ANSI 58&372 Zertifiziert 1200 GPD 11-stufige Filtration Tanklos 3:1',
        unique_selling_points: 'Portata ultra-rapida 1200 GPD con sistema tankless',
        product_highlights: 'Rubinetto digitale, filtro RO 0.0001 um, NSF/ANSI 58',
        extracted_headlines: JSON.stringify(['Waterdrop X12: Alkalisches pH', '1200 GPD Schneller Durchfluss']),
        extracted_keywords: JSON.stringify(['waterdrop official filter x12', 'waterdrop x12 1200 gpd', 'waterdrop alkalisches mineral']),
        target_country: 'IT',
        target_language: 'Italian',
      },
      userId: 1,
      brandName: 'Waterdrop',
      targetLanguage: 'Italian',
      creativeType: 'brand_intent',
      bucket: 'A',
      scopeLabel: 'unit-it-floor-recovery',
      maxKeywords: 12,
      keywordsWithVolume: weakCandidates as any,
      keywords: weakCandidates.map((item) => item.keyword),
      enableSupplementation: false,
      fallbackMode: false,
    })

    expect(result.executableKeywords.length).toBeGreaterThanOrEqual(10)
    expect(result.executableKeywords.some((keyword) => /waterdrop x12/i.test(keyword))).toBe(true)
    expect(
      result.audit.pipeline.nonEmptyRescueTriggered || result.audit.pipeline.finalInvariantTriggered
    ).toBe(true)
  })

  it('prefixes standalone model tokens with pure brand keyword before final output', async () => {
    const candidates = [
      {
        keyword: 'x12',
        searchVolume: 200,
        source: 'TITLE_EXTRACT',
        sourceType: 'TITLE_EXTRACT',
        sourceSubtype: 'TITLE_EXTRACT',
      },
      {
        keyword: 'ao25',
        searchVolume: 150,
        source: 'PARAM_EXTRACT',
        sourceType: 'PARAM_EXTRACT',
        sourceSubtype: 'PARAM_EXTRACT',
      },
      {
        keyword: 'waterdrop x12',
        searchVolume: 500,
        source: 'TITLE_EXTRACT',
        sourceType: 'TITLE_EXTRACT',
        sourceSubtype: 'TITLE_EXTRACT',
      },
      {
        keyword: 'waterdrop nsf ansi 58',
        searchVolume: 320,
        source: 'PARAM_EXTRACT',
        sourceType: 'PARAM_EXTRACT',
        sourceSubtype: 'PARAM_EXTRACT',
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(contextFilterResult(candidates as any))
    mocks.selectCreativeKeywords.mockImplementation((input: any) => {
      const keep = Array.isArray(input?.keywordsWithVolume) ? input.keywordsWithVolume.slice(0, 10) : []
      return {
        keywords: keep.map((item: any) => item.keyword),
        keywordsWithVolume: keep,
        truncated: false,
        sourceQuotaAudit: {
          enabled: true,
          fallbackMode: false,
          targetCount: keep.length,
          requiredBrandCount: 0,
          acceptedBrandCount: keep.length,
          acceptedCount: keep.length,
          deferredCount: 0,
          deferredRefillCount: 0,
          deferredRefillTriggered: false,
          underfillBeforeRefill: 0,
          quota: { combinedLowTrustCap: 20, aiCap: 20, aiLlmRawCap: 20 },
          acceptedByClass: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
          blockedByCap: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
        },
      }
    })

    const result = await buildCreativeKeywordSet({
      offer: {
        brand: 'Waterdrop',
        product_name: 'Waterdrop X12',
        target_country: 'IT',
        target_language: 'Italian',
      },
      userId: 1,
      brandName: 'Waterdrop',
      targetLanguage: 'Italian',
      creativeType: 'model_intent',
      scopeLabel: 'unit-standalone-model-prefix',
      maxKeywords: 10,
      keywordsWithVolume: candidates as any,
      keywords: candidates.map((item) => item.keyword),
      enableSupplementation: false,
      fallbackMode: false,
    })

    expect(result.executableKeywords).toContain('waterdrop x12')
    expect(result.executableKeywords).toContain('waterdrop ao25')
    expect(result.executableKeywords).not.toContain('x12')
    expect(result.executableKeywords).not.toContain('ao25')
    expect(result.candidatePool.map((item) => item.keyword)).not.toContain('x12')
    expect(result.candidatePool.map((item) => item.keyword)).not.toContain('ao25')
  })

  it('removes ratio-fragment keywords like \"3 1\" and \"waterdrop 3 1\"', async () => {
    const candidates = [
      {
        keyword: '3 1',
        searchVolume: 50,
        source: 'DERIVED_RESCUE',
        sourceType: 'DERIVED_RESCUE',
        sourceSubtype: 'DERIVED_RESCUE',
      },
      {
        keyword: 'waterdrop 3 1',
        searchVolume: 60,
        source: 'DERIVED_RESCUE',
        sourceType: 'DERIVED_RESCUE',
        sourceSubtype: 'DERIVED_RESCUE',
      },
      {
        keyword: 'waterdrop 10 1 cleaner',
        searchVolume: 45,
        source: 'DERIVED_RESCUE',
        sourceType: 'DERIVED_RESCUE',
        sourceSubtype: 'DERIVED_RESCUE',
      },
      {
        keyword: 'waterdrop x12',
        searchVolume: 500,
        source: 'TITLE_EXTRACT',
        sourceType: 'TITLE_EXTRACT',
        sourceSubtype: 'TITLE_EXTRACT',
      },
      {
        keyword: 'waterdrop nsf ansi 58',
        searchVolume: 320,
        source: 'PARAM_EXTRACT',
        sourceType: 'PARAM_EXTRACT',
        sourceSubtype: 'PARAM_EXTRACT',
      },
      {
        keyword: 'waterdrop ufficiale',
        searchVolume: 280,
        source: 'TITLE_EXTRACT',
        sourceType: 'TITLE_EXTRACT',
        sourceSubtype: 'TITLE_EXTRACT',
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(contextFilterResult(candidates as any))
    mocks.selectCreativeKeywords.mockImplementation((input: any) => {
      const keep = Array.isArray(input?.keywordsWithVolume) ? input.keywordsWithVolume.slice(0, 10) : []
      return {
        keywords: keep.map((item: any) => item.keyword),
        keywordsWithVolume: keep,
        truncated: false,
        sourceQuotaAudit: {
          enabled: true,
          fallbackMode: false,
          targetCount: keep.length,
          requiredBrandCount: 0,
          acceptedBrandCount: keep.length,
          acceptedCount: keep.length,
          deferredCount: 0,
          deferredRefillCount: 0,
          deferredRefillTriggered: false,
          underfillBeforeRefill: 0,
          quota: { combinedLowTrustCap: 20, aiCap: 20, aiLlmRawCap: 20 },
          acceptedByClass: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
          blockedByCap: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
        },
      }
    })

    const result = await buildCreativeKeywordSet({
      offer: {
        brand: 'Waterdrop',
        product_name: 'Waterdrop X12',
        target_country: 'IT',
        target_language: 'Italian',
      },
      userId: 1,
      brandName: 'Waterdrop',
      targetLanguage: 'Italian',
      creativeType: 'brand_intent',
      scopeLabel: 'unit-ratio-fragment-filter',
      maxKeywords: 10,
      keywordsWithVolume: candidates as any,
      keywords: candidates.map((item) => item.keyword),
      enableSupplementation: false,
      fallbackMode: false,
    })

    expect(result.executableKeywords).not.toContain('3 1')
    expect(result.executableKeywords).not.toContain('waterdrop 3 1')
    expect(result.executableKeywords).not.toContain('waterdrop 10 1 cleaner')
    expect(result.candidatePool.map((item) => item.keyword)).not.toContain('3 1')
    expect(result.candidatePool.map((item) => item.keyword)).not.toContain('waterdrop 3 1')
    expect(result.candidatePool.map((item) => item.keyword)).not.toContain('waterdrop 10 1 cleaner')
  })

  it('keeps non-ratio brand model keywords like \"lenovo 3 15\"', async () => {
    const candidates = [
      {
        keyword: 'lenovo 3 15',
        searchVolume: 260,
        source: 'TITLE_EXTRACT',
        sourceType: 'TITLE_EXTRACT',
        sourceSubtype: 'TITLE_EXTRACT',
      },
      {
        keyword: 'lenovo ideapad 3 15',
        searchVolume: 480,
        source: 'TITLE_EXTRACT',
        sourceType: 'TITLE_EXTRACT',
        sourceSubtype: 'TITLE_EXTRACT',
      },
      {
        keyword: '3 1',
        searchVolume: 40,
        source: 'DERIVED_RESCUE',
        sourceType: 'DERIVED_RESCUE',
        sourceSubtype: 'DERIVED_RESCUE',
      },
      {
        keyword: 'lenovo 3 1',
        searchVolume: 35,
        source: 'DERIVED_RESCUE',
        sourceType: 'DERIVED_RESCUE',
        sourceSubtype: 'DERIVED_RESCUE',
      },
    ]

    mocks.normalizeCreativeKeywordCandidatesForContextFilter.mockImplementation((input: any[]) => input)
    mocks.filterCreativeKeywordsByOfferContextDetailed.mockReturnValue(contextFilterResult(candidates as any))
    mocks.selectCreativeKeywords.mockImplementation((input: any) => {
      const keep = Array.isArray(input?.keywordsWithVolume) ? input.keywordsWithVolume.slice(0, 10) : []
      return {
        keywords: keep.map((item: any) => item.keyword),
        keywordsWithVolume: keep,
        truncated: false,
        sourceQuotaAudit: {
          enabled: true,
          fallbackMode: false,
          targetCount: keep.length,
          requiredBrandCount: 0,
          acceptedBrandCount: keep.length,
          acceptedCount: keep.length,
          deferredCount: 0,
          deferredRefillCount: 0,
          deferredRefillTriggered: false,
          underfillBeforeRefill: 0,
          quota: { combinedLowTrustCap: 20, aiCap: 20, aiLlmRawCap: 20 },
          acceptedByClass: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
          blockedByCap: { lowTrust: 0, ai: 0, aiLlmRaw: 0 },
        },
      }
    })

    const result = await buildCreativeKeywordSet({
      offer: {
        brand: 'Lenovo',
        product_name: 'Lenovo IdeaPad 3 15',
        target_country: 'US',
        target_language: 'English',
      },
      userId: 1,
      brandName: 'Lenovo',
      targetLanguage: 'English',
      creativeType: 'brand_intent',
      scopeLabel: 'unit-ratio-filter-do-not-overblock',
      maxKeywords: 10,
      keywordsWithVolume: candidates as any,
      keywords: candidates.map((item) => item.keyword),
      enableSupplementation: false,
      fallbackMode: false,
    })

    expect(result.executableKeywords).toContain('lenovo 3 15')
    expect(result.executableKeywords).toContain('lenovo ideapad 3 15')
    expect(result.executableKeywords).not.toContain('3 1')
    expect(result.executableKeywords).not.toContain('lenovo 3 1')
    expect(result.candidatePool.map((item) => item.keyword)).toContain('lenovo 3 15')
    expect(result.candidatePool.map((item) => item.keyword)).not.toContain('lenovo 3 1')
  })
})
