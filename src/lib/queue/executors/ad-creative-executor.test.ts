import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dbState = vi.hoisted(() => ({
  exec: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn(),
}))

const offerFns = vi.hoisted(() => ({
  findOfferById: vi.fn(),
}))

const generatorFns = vi.hoisted(() => ({
  generateAdCreative: vi.fn(),
}))

const feedbackFns = vi.hoisted(() => ({
  getSearchTermFeedbackHints: vi.fn(),
}))

const builderFns = vi.hoisted(() => ({
  buildCreativeKeywordSet: vi.fn(),
}))

const qualityLoopFns = vi.hoisted(() => ({
  runCreativeGenerationQualityLoop: vi.fn(),
  evaluateCreativeForQuality: vi.fn(),
}))

const keywordPoolFns = vi.hoisted(() => ({
  resolveKeywordPoolForCreativeGeneration: vi.fn(),
  getAvailableBuckets: vi.fn(),
  getBucketInfo: vi.fn(),
}))

const creativeTypeFns = vi.hoisted(() => ({
  getCreativeTypeForBucketSlot: vi.fn(),
}))

const pipelineFns = vi.hoisted(() => ({
  prepareBucketKeywordContext: vi.fn(),
  runBucketCreativeGeneration: vi.fn(),
}))

const keywordRuntimeFns = vi.hoisted(() => ({
  buildPreGenerationCreativeKeywordSet: vi.fn(),
}))

vi.mock('@/lib/google-ads-accounts-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads-accounts-auth')>()
  return {
    ...actual,
    loadKeywordPoolExpandCredentialsForOffer: vi.fn().mockResolvedValue({ ok: false }),
    getKeywordSearchVolumesForPlannerContext: vi.fn().mockResolvedValue({
      ok: true,
      volumes: [{ avgMonthlySearches: 0 }],
    }),
  }
})

vi.mock('@/lib/db', () => ({
  getDatabase: () => ({
    type: 'sqlite' as const,
    exec: dbState.exec,
    query: dbState.query,
    queryOne: dbState.queryOne,
    transaction: dbState.transaction,
  }),
}))

vi.mock('@/lib/offers', () => ({
  findOfferById: offerFns.findOfferById,
}))

vi.mock('@/lib/ad-creative-gen', () => ({
  generateAdCreative: generatorFns.generateAdCreative,
}))

vi.mock('@/lib/search-term-feedback-hints', () => ({
  getSearchTermFeedbackHints: feedbackFns.getSearchTermFeedbackHints,
}))

vi.mock('@/lib/creative-keyword-set-builder', () => ({
  buildCreativeKeywordSet: builderFns.buildCreativeKeywordSet,
}))

vi.mock('@/lib/ad-creative-quality-loop', () => ({
  AD_CREATIVE_MAX_AUTO_RETRIES: 2,
  AD_CREATIVE_REQUIRED_MIN_SCORE: 70,
  evaluateCreativeForQuality: qualityLoopFns.evaluateCreativeForQuality,
  runCreativeGenerationQualityLoop: qualityLoopFns.runCreativeGenerationQualityLoop,
}))

vi.mock('@/lib/offer-keyword-pool', () => ({
  resolveKeywordPoolForCreativeGeneration: keywordPoolFns.resolveKeywordPoolForCreativeGeneration,
  getAvailableBuckets: keywordPoolFns.getAvailableBuckets,
  getBucketInfo: keywordPoolFns.getBucketInfo,
}))

vi.mock('@/lib/creative-type', () => ({
  getCreativeTypeForBucketSlot: creativeTypeFns.getCreativeTypeForBucketSlot,
}))

vi.mock('@/lib/creative-keyword-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/creative-keyword-runtime')>()
  return {
    ...actual,
    buildPreGenerationCreativeKeywordSet: keywordRuntimeFns.buildPreGenerationCreativeKeywordSet,
  }
})

vi.mock('@/lib/bucket-creative-generation-pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bucket-creative-generation-pipeline')>()
  return {
    ...actual,
    prepareBucketKeywordContext: pipelineFns.prepareBucketKeywordContext,
    runBucketCreativeGeneration: pipelineFns.runBucketCreativeGeneration,
  }
})

vi.mock('@/lib/json-field', () => ({
  toDbJsonObjectField: (value: unknown) => value,
}))

describe('executeAdCreativeGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.AD_CREATIVE_HARD_PERSISTENCE_GATE_ENABLED = '0'

    dbState.exec.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO ad_creatives')) {
        return { lastInsertRowid: 901, changes: 1 }
      }

      return { changes: 1 }
    })
    dbState.query.mockResolvedValue([])
    dbState.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM ad_creatives WHERE id = ?')) {
        return {
          id: 901,
          offer_id: 96,
          user_id: 1,
        }
      }
      return null
    })
    dbState.transaction.mockImplementation(async (callback: () => Promise<void>) => {
      await callback()
    })

    offerFns.findOfferById.mockResolvedValue({
      id: 96,
      brand: 'BrandX',
      url: 'https://example.com/product',
      final_url: 'https://example.com/product',
      final_url_suffix: null,
      scrape_status: 'completed',
      page_type: 'product',
      target_country: 'US',
      target_language: 'en',
      category: 'robot vacuum',
      product_name: 'BrandX X200',
      brand_description: 'Robot vacuum',
      affiliate_link: null,
    })

    keywordPoolFns.resolveKeywordPoolForCreativeGeneration.mockResolvedValue({
      pool: { id: 77 },
      plannerSession: undefined,
    })
    keywordPoolFns.getAvailableBuckets.mockResolvedValue(['B'])
    keywordPoolFns.getBucketInfo.mockReturnValue({
      keywords: [{ keyword: 'brandx x200 vacuum', searchVolume: 1200 }],
      intent: '商品型号/产品族意图',
      intentEn: 'Model Intent',
    })
    creativeTypeFns.getCreativeTypeForBucketSlot.mockReturnValue('model_intent')

    const defaultPrecomputedKeywordSet = {
      executableKeywords: ['brandx x200 vacuum'],
      executableKeywordCandidates: [],
      candidatePool: [],
      keywords: ['brandx x200 vacuum'],
      keywordsWithVolume: [
        { keyword: 'brandx x200 vacuum', searchVolume: 1200, matchType: 'EXACT' },
      ],
      promptKeywords: ['brandx x200 vacuum'],
      keywordSupplementation: {
        triggered: false,
        beforeCount: 1,
        afterCount: 1,
        addedKeywords: [],
        supplementCapApplied: false,
      },
      contextFallbackStrategy: 'filtered' as const,
      audit: {
        totalKeywords: 1,
        withSearchVolumeKeywords: 1,
        zeroVolumeKeywords: 0,
        volumeUnavailableKeywords: 0,
        noVolumeMode: false,
        fallbackMode: false,
        contextFallbackStrategy: 'filtered',
        sourceQuotaAudit: {} as any,
        byRawSource: {},
        bySourceSubtype: {},
        bySourceField: {},
        creativeAffinityByLabel: {},
        creativeAffinityByLevel: {},
      },
      keywordSourceAudit: { totalKeywords: 1 },
    }

    keywordRuntimeFns.buildPreGenerationCreativeKeywordSet.mockResolvedValue(
      defaultPrecomputedKeywordSet
    )
    pipelineFns.prepareBucketKeywordContext.mockResolvedValue({
      bucket: 'B',
      creativeType: 'model_intent',
      bucketIntent: '商品型号/产品族意图',
      bucketIntentEn: 'Model Intent',
      bucketKeywords: ['brandx x200 vacuum'],
      seedCandidates: [],
      precomputedKeywordSet: defaultPrecomputedKeywordSet,
    })
    pipelineFns.runBucketCreativeGeneration.mockImplementation(async (params) => {
      const actual = await vi.importActual<
        typeof import('@/lib/bucket-creative-generation-pipeline')
      >('@/lib/bucket-creative-generation-pipeline')
      const usedKeywordsRef = { current: [] as string[] }
      const keywordPoolVolumeHints = params.keywordPool
        ? actual.buildKeywordPoolVolumeHintMap(params.keywordPool)
        : undefined
      const { generate, evaluate } = actual.createBucketCreativeGenerationCallbacks({
        ...params,
        bucketContext: params.preparedBucketContext,
        usedKeywordsRef,
        brandKeywords: ['brandx'],
        keywordPoolVolumeHints,
        searchTermFeedbackHints: params.searchTermFeedbackHints,
      })
      return qualityLoopFns.runCreativeGenerationQualityLoop({
        maxRetries: params.maxRetries,
        delayMs: params.generationProfile.delayMs,
        generate,
        evaluate,
      })
    })

    generatorFns.generateAdCreative.mockResolvedValue({
      headlines: ['BrandX X200 Vacuum'],
      descriptions: ['Clean faster with BrandX X200'],
      keywords: ['brandx x200 vacuum', 'brandx official store'],
      keywordsWithVolume: [{ keyword: 'brandx x200 vacuum', searchVolume: 800 }],
      promptKeywords: ['brandx x200 vacuum'],
      negativeKeywords: ['manual'],
      callouts: [],
      sitelinks: [],
      theme: '商品型号/产品族意图',
      explanation: 'Focus on the verified model.',
      ai_model: 'gemini-test',
    })
    feedbackFns.getSearchTermFeedbackHints.mockResolvedValue({
      hardNegativeTerms: [],
      softSuppressTerms: [],
      highPerformingTerms: [],
      lookbackDays: 0,
      sourceRows: 0,
    })

    builderFns.buildCreativeKeywordSet
      .mockResolvedValueOnce({
        executableKeywords: ['brandx x200 replacement filter'],
        executableKeywordCandidates: [],
        candidatePool: [],
        keywords: ['brandx x200 replacement filter'],
        keywordsWithVolume: [
          { keyword: 'brandx x200 replacement filter', searchVolume: 260, matchType: 'PHRASE' },
        ],
        promptKeywords: ['brandx x200 replacement filter'],
        keywordSupplementation: {
          triggered: true,
          beforeCount: 1,
          afterCount: 1,
          addedKeywords: [],
          supplementCapApplied: false,
        },
        contextFallbackStrategy: 'filtered',
        audit: {
          totalKeywords: 1,
          withSearchVolumeKeywords: 1,
          zeroVolumeKeywords: 0,
          volumeUnavailableKeywords: 0,
          noVolumeMode: false,
          fallbackMode: false,
          contextFallbackStrategy: 'filtered',
          sourceQuotaAudit: {} as any,
          byRawSource: {},
          bySourceSubtype: {},
          bySourceField: {},
          creativeAffinityByLabel: {},
          creativeAffinityByLevel: {},
        },
        keywordSourceAudit: {
          totalKeywords: 1,
        },
      })
      .mockResolvedValueOnce({
        executableKeywords: ['brandx x200 vacuum'],
        executableKeywordCandidates: [],
        candidatePool: [],
        keywords: ['brandx x200 vacuum'],
        keywordsWithVolume: [
          { keyword: 'brandx x200 vacuum', searchVolume: 1200, matchType: 'EXACT' },
        ],
        promptKeywords: ['brandx x200 vacuum', 'buy brandx x200 vacuum'],
        keywordSupplementation: {
          triggered: true,
          beforeCount: 1,
          afterCount: 2,
          addedKeywords: [{ keyword: 'buy brandx x200 vacuum', source: 'title_about' }],
          supplementCapApplied: false,
        },
        contextFallbackStrategy: 'filtered',
        audit: {
          totalKeywords: 1,
          withSearchVolumeKeywords: 1,
          zeroVolumeKeywords: 0,
          volumeUnavailableKeywords: 0,
          noVolumeMode: false,
          fallbackMode: false,
          contextFallbackStrategy: 'filtered',
          sourceQuotaAudit: {} as any,
          byRawSource: {},
          bySourceSubtype: {},
          bySourceField: {},
          creativeAffinityByLabel: {},
          creativeAffinityByLevel: {},
        },
        keywordSourceAudit: {
          totalKeywords: 1,
        },
      })

    qualityLoopFns.runCreativeGenerationQualityLoop.mockImplementation(
      async ({ generate }: any) => {
        const creative = await generate({ attempt: 1, retryFailureType: null })
        return {
          attempts: 1,
          selectedCreative: creative,
          selectedEvaluation: {
            passed: true,
            adStrength: {
              finalRating: 'GOOD',
              finalScore: 84,
              localEvaluation: {
                dimensions: {
                  relevance: { score: 12 },
                  quality: { score: 12 },
                  completeness: { score: 12 },
                  diversity: { score: 12 },
                  compliance: { score: 12 },
                  brandSearchVolume: { score: 12 },
                  competitivePositioning: { score: 12 },
                },
              },
              combinedSuggestions: [],
            },
          },
          history: [],
        }
      }
    )
  })

  it('persists builder-applied keyword audit metadata into final result payload', async () => {
    const { executeAdCreativeGeneration } = await import('./ad-creative-executor')

    const result = await executeAdCreativeGeneration({
      id: 501,
      userId: 1,
      data: {
        offerId: 96,
        bucket: 'B',
      },
    } as any)

    expect(pipelineFns.prepareBucketKeywordContext).toHaveBeenCalledWith(
      expect.objectContaining({
        offerId: 96,
        bucket: 'B',
        scopeLabel: '桶B',
      })
    )
    expect(pipelineFns.runBucketCreativeGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        keywordPostProcessMode: 'applyPrecomputed',
        preparedBucketContext: expect.objectContaining({
          precomputedKeywordSet: expect.objectContaining({
            executableKeywords: ['brandx x200 vacuum'],
          }),
        }),
      })
    )
    expect(builderFns.buildCreativeKeywordSet).not.toHaveBeenCalled()
    expect(generatorFns.generateAdCreative).toHaveBeenCalledWith(
      96,
      1,
      expect.objectContaining({
        searchTermFeedbackHints: {
          hardNegativeTerms: [],
          softSuppressTerms: [],
          highPerformingTerms: [],
        },
        precomputedKeywordSet: expect.objectContaining({
          executableKeywords: ['brandx x200 vacuum'],
          promptKeywords: ['brandx x200 vacuum'],
        }),
        deferKeywordPostProcessingToBuilder: true,
      })
    )
    expect(result.creative.keywords).toEqual(['brandx x200 vacuum'])
    expect(result.creative.keywordSupplementation).toMatchObject({
      triggered: false,
      afterCount: 1,
    })
    expect(result.creative.audit).toMatchObject({
      totalKeywords: 1,
      contextFallbackStrategy: 'filtered',
    })
    expect(result.creative.keywordSourceAudit).toMatchObject({
      totalKeywords: 1,
    })
    expect(result.adStrength.audit).toMatchObject({
      totalKeywords: 1,
    })
  })

  it('passes queue-level search term feedback hints into creative generation', async () => {
    feedbackFns.getSearchTermFeedbackHints.mockResolvedValueOnce({
      hardNegativeTerms: ['bad keyword'],
      softSuppressTerms: ['weak keyword'],
      highPerformingTerms: ['brandx x200 vacuum'],
      lookbackDays: 0,
      sourceRows: 12,
    })

    const { executeAdCreativeGeneration } = await import('./ad-creative-executor')

    await executeAdCreativeGeneration({
      id: 507,
      userId: 1,
      data: {
        offerId: 96,
        bucket: 'B',
      },
    } as any)

    expect(feedbackFns.getSearchTermFeedbackHints).toHaveBeenCalledWith({
      offerId: 96,
      userId: 1,
    })
    expect(generatorFns.generateAdCreative).toHaveBeenCalledWith(
      96,
      1,
      expect.objectContaining({
        searchTermFeedbackHints: {
          hardNegativeTerms: ['bad keyword'],
          softSuppressTerms: ['weak keyword'],
          highPerformingTerms: ['brandx x200 vacuum'],
        },
      })
    )
  })

  it('backfills rescue pure-brand keyword volume from keyword pool hints', async () => {
    keywordPoolFns.resolveKeywordPoolForCreativeGeneration.mockResolvedValueOnce({
      pool: {
        id: 77,
        brandKeywords: [
          {
            keyword: 'novilla',
            searchVolume: 2400,
            volumeUnavailableReason: 'DEV_TOKEN_INSUFFICIENT_ACCESS',
            source: 'BRAND_SEED',
            sourceType: 'BRAND_SEED',
          },
        ],
        bucketAKeywords: [],
        bucketBKeywords: [],
        bucketCKeywords: [],
        bucketDKeywords: [],
        storeBucketAKeywords: [],
        storeBucketBKeywords: [],
        storeBucketCKeywords: [],
        storeBucketDKeywords: [],
        storeBucketSKeywords: [],
      },
      plannerSession: undefined,
    })
    keywordPoolFns.getAvailableBuckets.mockResolvedValueOnce(['D'])
    keywordPoolFns.getBucketInfo.mockReturnValueOnce({
      keywords: [{ keyword: 'novilla mattress', searchVolume: 320 }],
      intent: '商品需求扩展意图',
      intentEn: 'Demand Expansion',
    })
    creativeTypeFns.getCreativeTypeForBucketSlot.mockReturnValueOnce('product_intent')
    pipelineFns.prepareBucketKeywordContext.mockImplementation(async (params: any) => {
      if (params.bucket !== 'D') {
        return {
          bucket: 'B',
          creativeType: 'model_intent',
          bucketIntent: '商品型号/产品族意图',
          bucketIntentEn: 'Model Intent',
          bucketKeywords: ['brandx x200 vacuum'],
          seedCandidates: [],
          precomputedKeywordSet: {
            executableKeywords: ['brandx x200 vacuum'],
            keywordsWithVolume: [
              { keyword: 'brandx x200 vacuum', searchVolume: 1200, matchType: 'EXACT' },
            ],
            promptKeywords: ['brandx x200 vacuum'],
            keywordSupplementation: {
              triggered: false,
              beforeCount: 1,
              afterCount: 1,
              addedKeywords: [],
              supplementCapApplied: false,
            },
            audit: { totalKeywords: 1 },
            contextFallbackStrategy: 'filtered',
          },
        }
      }
      return {
        bucket: 'D',
        creativeType: 'product_intent',
        bucketIntent: '商品需求扩展意图',
        bucketIntentEn: 'Demand Expansion',
        bucketKeywords: ['novilla'],
        seedCandidates: [{ keyword: 'novilla', searchVolume: 0 }],
        precomputedKeywordSet: {
          executableKeywords: ['novilla'],
          keywordsWithVolume: [
            {
              keyword: 'novilla',
              searchVolume: 0,
              source: 'BRAND_SEED',
              sourceType: 'BRAND_SEED',
              rawSource: 'DERIVED_RESCUE',
              matchType: 'PHRASE',
            },
          ],
          promptKeywords: ['novilla'],
          keywordSupplementation: {
            triggered: false,
            beforeCount: 1,
            afterCount: 1,
            addedKeywords: [],
            supplementCapApplied: false,
          },
          audit: { totalKeywords: 1 },
          contextFallbackStrategy: 'filtered',
        },
      }
    })

    generatorFns.generateAdCreative.mockImplementation(
      async (_offerId: number, _userId: number, options: any) => {
        if (options?.bucket === 'D') {
          return {
            headlines: ['Novilla Mattress Deals'],
            descriptions: ['Find your next mattress today'],
            keywords: ['novilla'],
            keywordsWithVolume: [
              {
                keyword: 'novilla',
                searchVolume: 0,
                source: 'BRAND_SEED',
                sourceType: 'BRAND_SEED',
                rawSource: 'DERIVED_RESCUE',
              },
            ],
            promptKeywords: ['novilla'],
            negativeKeywords: [],
            callouts: [],
            sitelinks: [],
            theme: '商品需求扩展意图',
            explanation: 'fallback brand token',
            ai_model: 'gemini-test',
          }
        }
        return {
          headlines: ['BrandX X200 Vacuum'],
          descriptions: ['Clean faster with BrandX X200'],
          keywords: ['brandx x200 vacuum', 'brandx official store'],
          keywordsWithVolume: [{ keyword: 'brandx x200 vacuum', searchVolume: 800 }],
          promptKeywords: ['brandx x200 vacuum'],
          negativeKeywords: ['manual'],
          callouts: [],
          sitelinks: [],
          theme: '商品型号/产品族意图',
          explanation: 'Focus on the verified model.',
          ai_model: 'gemini-test',
        }
      }
    )

    builderFns.buildCreativeKeywordSet.mockReset()
    builderFns.buildCreativeKeywordSet.mockResolvedValue({
      executableKeywords: ['novilla'],
      executableKeywordCandidates: [],
      candidatePool: [],
      keywords: ['novilla'],
      keywordsWithVolume: [
        {
          keyword: 'novilla',
          searchVolume: 0,
          source: 'BRAND_SEED',
          sourceType: 'BRAND_SEED',
          rawSource: 'DERIVED_RESCUE',
          matchType: 'PHRASE',
        },
      ],
      promptKeywords: ['novilla'],
      keywordSupplementation: {
        triggered: false,
        beforeCount: 1,
        afterCount: 1,
        addedKeywords: [],
        supplementCapApplied: false,
      },
      contextFallbackStrategy: 'filtered',
      audit: {
        totalKeywords: 1,
        withSearchVolumeKeywords: 0,
        zeroVolumeKeywords: 1,
        volumeUnavailableKeywords: 0,
        noVolumeMode: false,
        fallbackMode: false,
        contextFallbackStrategy: 'filtered',
        sourceQuotaAudit: {} as any,
        byRawSource: {},
        bySourceSubtype: {},
        bySourceField: {},
        creativeAffinityByLabel: {},
        creativeAffinityByLevel: {},
      },
      keywordSourceAudit: {
        totalKeywords: 1,
      },
    })

    const { executeAdCreativeGeneration } = await import('./ad-creative-executor')

    const result = await executeAdCreativeGeneration({
      id: 505,
      userId: 1,
      data: {
        offerId: 96,
        bucket: 'D',
      },
    } as any)

    expect(result.creative.keywordsWithVolume).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyword: 'novilla',
          searchVolume: 2400,
        }),
      ])
    )
  })

  it('uses precomputed executable keywords for retry exclusion on later attempts', async () => {
    pipelineFns.prepareBucketKeywordContext.mockResolvedValueOnce({
      bucket: 'B',
      creativeType: 'model_intent',
      bucketIntent: '商品型号/产品族意图',
      bucketIntentEn: 'Model Intent',
      bucketKeywords: ['brandx x200 vacuum'],
      seedCandidates: [],
      precomputedKeywordSet: {
        executableKeywords: ['x200 vacuum'],
        keywordsWithVolume: [{ keyword: 'x200 vacuum', searchVolume: 1200, matchType: 'EXACT' }],
        promptKeywords: ['x200 vacuum'],
        keywordSupplementation: {
          triggered: false,
          beforeCount: 1,
          afterCount: 1,
          addedKeywords: [],
          supplementCapApplied: false,
        },
        audit: { totalKeywords: 1 },
        contextFallbackStrategy: 'filtered',
      },
    })

    builderFns.buildCreativeKeywordSet.mockReset()
    builderFns.buildCreativeKeywordSet
      .mockResolvedValueOnce({
        executableKeywords: ['brandx x200 replacement filter'],
        executableKeywordCandidates: [],
        candidatePool: [],
        keywords: ['brandx x200 replacement filter'],
        keywordsWithVolume: [
          { keyword: 'brandx x200 replacement filter', searchVolume: 260, matchType: 'PHRASE' },
        ],
        promptKeywords: ['brandx x200 replacement filter'],
        keywordSupplementation: {
          triggered: true,
          beforeCount: 1,
          afterCount: 1,
          addedKeywords: [],
          supplementCapApplied: false,
        },
        contextFallbackStrategy: 'filtered',
        audit: {
          totalKeywords: 1,
          withSearchVolumeKeywords: 1,
          zeroVolumeKeywords: 0,
          volumeUnavailableKeywords: 0,
          noVolumeMode: false,
          fallbackMode: false,
          contextFallbackStrategy: 'filtered',
          sourceQuotaAudit: {} as any,
          byRawSource: {},
          bySourceSubtype: {},
          bySourceField: {},
          creativeAffinityByLabel: {},
          creativeAffinityByLevel: {},
        },
        keywordSourceAudit: { totalKeywords: 1 },
      })
      .mockResolvedValueOnce({
        executableKeywords: ['x200 vacuum'],
        executableKeywordCandidates: [],
        candidatePool: [],
        keywords: ['x200 vacuum'],
        keywordsWithVolume: [{ keyword: 'x200 vacuum', searchVolume: 1200, matchType: 'EXACT' }],
        promptKeywords: ['x200 vacuum'],
        keywordSupplementation: {
          triggered: false,
          beforeCount: 1,
          afterCount: 1,
          addedKeywords: [],
          supplementCapApplied: false,
        },
        contextFallbackStrategy: 'filtered',
        audit: {
          totalKeywords: 1,
          withSearchVolumeKeywords: 1,
          zeroVolumeKeywords: 0,
          volumeUnavailableKeywords: 0,
          noVolumeMode: false,
          fallbackMode: false,
          contextFallbackStrategy: 'filtered',
          sourceQuotaAudit: {} as any,
          byRawSource: {},
          bySourceSubtype: {},
          bySourceField: {},
          creativeAffinityByLabel: {},
          creativeAffinityByLevel: {},
        },
        keywordSourceAudit: { totalKeywords: 1 },
      })
      .mockResolvedValueOnce({
        executableKeywords: ['x300 vacuum'],
        executableKeywordCandidates: [],
        candidatePool: [],
        keywords: ['x300 vacuum'],
        keywordsWithVolume: [{ keyword: 'x300 vacuum', searchVolume: 900, matchType: 'EXACT' }],
        promptKeywords: ['x300 vacuum'],
        keywordSupplementation: {
          triggered: false,
          beforeCount: 1,
          afterCount: 1,
          addedKeywords: [],
          supplementCapApplied: false,
        },
        contextFallbackStrategy: 'filtered',
        audit: {
          totalKeywords: 1,
          withSearchVolumeKeywords: 1,
          zeroVolumeKeywords: 0,
          volumeUnavailableKeywords: 0,
          noVolumeMode: false,
          fallbackMode: false,
          contextFallbackStrategy: 'filtered',
          sourceQuotaAudit: {} as any,
          byRawSource: {},
          bySourceSubtype: {},
          bySourceField: {},
          creativeAffinityByLabel: {},
          creativeAffinityByLevel: {},
        },
        keywordSourceAudit: { totalKeywords: 1 },
      })

    generatorFns.generateAdCreative
      .mockResolvedValueOnce({
        headlines: ['BrandX Official Store'],
        descriptions: ['Shop BrandX directly'],
        keywords: ['brandx official store'],
        keywordsWithVolume: [
          {
            keyword: 'brandx official store',
            searchVolume: 800,
            source: 'AI_GENERATED',
            sourceType: 'AI_GENERATED',
            matchType: 'PHRASE',
          },
        ],
        promptKeywords: ['brandx official store'],
        negativeKeywords: ['manual'],
        callouts: [],
        sitelinks: [],
        theme: '商品型号/产品族意图',
        explanation: 'Too generic.',
        ai_model: 'gemini-test',
      })
      .mockResolvedValueOnce({
        headlines: ['BrandX X300 Vacuum'],
        descriptions: ['Upgrade to BrandX X300'],
        keywords: ['brandx x300 vacuum'],
        keywordsWithVolume: [
          {
            keyword: 'brandx x300 vacuum',
            searchVolume: 700,
            source: 'AI_GENERATED',
            sourceType: 'AI_GENERATED',
            matchType: 'PHRASE',
          },
        ],
        promptKeywords: ['brandx x300 vacuum'],
        negativeKeywords: ['manual'],
        callouts: [],
        sitelinks: [],
        theme: '商品型号/产品族意图',
        explanation: 'Retry candidate.',
        ai_model: 'gemini-test',
      })

    qualityLoopFns.runCreativeGenerationQualityLoop.mockImplementationOnce(
      async ({ generate }: any) => {
        await generate({ attempt: 1, retryFailureType: null })
        const creative = await generate({ attempt: 2, retryFailureType: 'quality_under_threshold' })
        return {
          attempts: 2,
          selectedCreative: creative,
          selectedEvaluation: {
            passed: true,
            adStrength: {
              finalRating: 'GOOD',
              finalScore: 84,
              localEvaluation: {
                dimensions: {
                  relevance: { score: 12 },
                  quality: { score: 12 },
                  completeness: { score: 12 },
                  diversity: { score: 12 },
                  compliance: { score: 12 },
                  brandSearchVolume: { score: 12 },
                  competitivePositioning: { score: 12 },
                },
              },
              combinedSuggestions: [],
            },
          },
          history: [],
        }
      }
    )

    const { executeAdCreativeGeneration } = await import('./ad-creative-executor')

    await executeAdCreativeGeneration({
      id: 502,
      userId: 1,
      data: {
        offerId: 96,
        bucket: 'B',
      },
    } as any)

    expect(generatorFns.generateAdCreative).toHaveBeenNthCalledWith(
      2,
      96,
      1,
      expect.objectContaining({
        excludeKeywords: expect.arrayContaining(['x200 vacuum']),
      })
    )
  })

  it('fails the task when hard quality gate is enabled and quality evaluation does not pass', async () => {
    qualityLoopFns.runCreativeGenerationQualityLoop.mockImplementationOnce(
      async ({ generate }: any) => {
        const creative = await generate({ attempt: 1, retryFailureType: null })
        return {
          attempts: 1,
          selectedCreative: creative,
          selectedEvaluation: {
            passed: false,
            adStrength: {
              finalRating: 'AVERAGE',
              finalScore: 62,
              localEvaluation: {
                dimensions: {
                  relevance: { score: 10 },
                  quality: { score: 8 },
                  completeness: { score: 9 },
                  diversity: { score: 9 },
                  compliance: { score: 10 },
                  brandSearchVolume: { score: 8 },
                  competitivePositioning: { score: 8 },
                },
              },
              combinedSuggestions: ['improve intent alignment'],
            },
          },
          history: [],
        }
      }
    )

    const { executeAdCreativeGeneration } = await import('./ad-creative-executor')

    await expect(
      executeAdCreativeGeneration({
        id: 503,
        userId: 1,
        data: {
          offerId: 96,
          bucket: 'B',
        },
      } as any)
    ).rejects.toThrow('创意质量门禁未通过')

    const executedSql = dbState.exec.mock.calls.map(([sql]) => String(sql))
    expect(executedSql.some((sql) => sql.includes("creation_status = 'draft'"))).toBe(false)
    expect(executedSql.some((sql) => sql.includes("status = 'failed'"))).toBe(true)
    expect(executedSql.some((sql) => sql.includes('DELETE FROM ad_creatives WHERE id = ?'))).toBe(
      true
    )
  })

  it('allows forced generation when hard quality gate fails and bypass is explicitly requested', async () => {
    qualityLoopFns.runCreativeGenerationQualityLoop.mockImplementationOnce(
      async ({ generate }: any) => {
        const creative = await generate({ attempt: 1, retryFailureType: null })
        return {
          attempts: 1,
          selectedCreative: creative,
          selectedEvaluation: {
            passed: false,
            adStrength: {
              finalRating: 'AVERAGE',
              finalScore: 62,
              localEvaluation: {
                dimensions: {
                  relevance: { score: 10 },
                  quality: { score: 8 },
                  completeness: { score: 9 },
                  diversity: { score: 9 },
                  compliance: { score: 10 },
                  brandSearchVolume: { score: 8 },
                  competitivePositioning: { score: 8 },
                },
              },
              combinedSuggestions: ['improve intent alignment'],
            },
            reasons: ['rule:ad_strength_below_threshold'],
          },
          history: [],
        }
      }
    )

    const { executeAdCreativeGeneration } = await import('./ad-creative-executor')

    const result = await executeAdCreativeGeneration({
      id: 506,
      userId: 1,
      data: {
        offerId: 96,
        bucket: 'B',
        forceGenerateOnQualityGate: true,
        qualityGateBypassReason: 'user_confirmed_from_quality_gate_modal',
      },
    } as any)

    expect(result).toMatchObject({
      success: true,
      qualityGate: {
        passed: false,
        bypassed: true,
        finalRating: 'AVERAGE',
        finalScore: 62,
        bypassReason: 'user_confirmed_from_quality_gate_modal',
      },
    })

    const executedSql = dbState.exec.mock.calls.map(([sql]) => String(sql))
    expect(executedSql.some((sql) => sql.includes("status = 'failed'"))).toBe(false)
    expect(executedSql.some((sql) => sql.includes("status = 'completed'"))).toBe(true)

    const completedUpdateCall = dbState.exec.mock.calls.find(([sql]) =>
      String(sql).includes("status = 'completed'")
    )
    const completedParams = Array.isArray(completedUpdateCall?.[1]) ? completedUpdateCall?.[1] : []
    expect(String(completedParams[0] || '')).toContain('已按确认强制生成')
  })

  it('fails the task when hard persistence gate is enabled and pre-persist checks do not pass', async () => {
    process.env.AD_CREATIVE_HARD_PERSISTENCE_GATE_ENABLED = '1'
    qualityLoopFns.runCreativeGenerationQualityLoop.mockImplementationOnce(
      async ({ generate }: any) => {
        const creative = await generate({ attempt: 1, retryFailureType: null })
        return {
          attempts: 1,
          selectedCreative: creative,
          selectedEvaluation: {
            passed: true,
            adStrength: {
              finalRating: 'GOOD',
              finalScore: 84,
              localEvaluation: {
                dimensions: {
                  relevance: { score: 12 },
                  quality: { score: 12 },
                  completeness: { score: 12 },
                  diversity: { score: 12 },
                  compliance: { score: 12 },
                  brandSearchVolume: { score: 12 },
                  competitivePositioning: { score: 12 },
                },
              },
              combinedSuggestions: [],
            },
          },
          history: [],
        }
      }
    )

    const { executeAdCreativeGeneration } = await import('./ad-creative-executor')

    await expect(
      executeAdCreativeGeneration({
        id: 504,
        userId: 1,
        data: {
          offerId: 96,
          bucket: 'B',
        },
      } as any)
    ).rejects.toThrow('创意落库门禁未通过')

    const executedSql = dbState.exec.mock.calls.map(([sql]) => String(sql))
    expect(executedSql.some((sql) => sql.includes("creation_status = 'draft'"))).toBe(false)
    expect(executedSql.some((sql) => sql.includes("status = 'failed'"))).toBe(true)
    expect(executedSql.some((sql) => sql.includes('DELETE FROM ad_creatives WHERE id = ?'))).toBe(
      true
    )
  })

  afterEach(() => {
    delete process.env.AD_CREATIVE_HARD_PERSISTENCE_GATE_ENABLED
  })
})
