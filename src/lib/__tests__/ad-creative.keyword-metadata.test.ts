import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAdCreative } from '../ad-creative'

const dbState = vi.hoisted(() => ({
  queryOne: vi.fn(),
  exec: vi.fn(),
  insertParams: null as any[] | null,
}))

vi.mock('../db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'sqlite' as const,
    queryOne: dbState.queryOne,
    exec: dbState.exec,
  })),
}))

vi.mock('../search-term-auto-negatives', () => ({
  getSearchTermAutoNegativeConfigFromEnv: vi.fn(() => ({
    enabled: false,
    lookbackDays: 7,
    minClicks: 1,
    minCost: 0,
    maxPerAdGroup: 5,
    maxPerUser: 5,
  })),
  getSearchTermAutoPositiveConfigFromEnv: vi.fn(() => ({
    enabled: false,
    lookbackDays: 7,
    minClicks: 1,
    minConversions: 1,
    maxPerAdGroup: 3,
    maxPerUser: 3,
  })),
  runSearchTermAutoNegatives: vi.fn(),
  runSearchTermAutoPositiveKeywords: vi.fn(),
}))

describe('createAdCreative keyword metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.insertParams = null

    dbState.exec.mockImplementation(async (sql: string, params?: any[]) => {
      if (sql.includes('INSERT INTO ad_creatives')) {
        dbState.insertParams = params || null
        return { changes: 1, lastInsertRowid: 501 }
      }

      return { changes: 1 }
    })

    dbState.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT brand, target_language FROM offers')) {
        return { brand: 'BrandX', target_language: 'en' }
      }

      if (sql.includes('SELECT * FROM ad_creatives')) {
        return {
          id: 501,
          offer_id: 96,
          user_id: 1,
          headlines: JSON.stringify(['BrandX X200 Vacuum']),
          descriptions: JSON.stringify(['Clean faster with BrandX X200']),
          keywords: dbState.insertParams?.[4],
          keywords_with_volume: dbState.insertParams?.[5],
          negative_keywords: null,
          callouts: null,
          sitelinks: null,
          final_url: 'https://example.com/product',
          final_url_suffix: null,
          path1: null,
          path2: null,
          score: 84,
          score_breakdown: JSON.stringify({
            relevance: 12,
            quality: 12,
            engagement: 12,
            diversity: 12,
            clarity: 12,
            brandSearchVolume: 12,
            competitivePositioning: 12,
          }),
          score_explanation: 'ok',
          generation_round: 1,
          theme: '型号导向',
          ai_model: 'gemini-2.5-pro',
          ad_strength_data: dbState.insertParams?.[19] ?? null,
          creative_type: 'model_intent',
          keyword_bucket: 'B',
          keyword_pool_id: null,
          bucket_intent: '型号导向',
          creation_status: 'draft',
          creation_error: null,
          last_sync_at: null,
          created_at: '2026-03-17 00:00:00',
          updated_at: '2026-03-17 00:00:00',
        }
      }

      return null
    })
  })

  it('keeps enriched keyword source metadata through create and readback', async () => {
    const creative = await createAdCreative(1, 96, {
      headlines: ['BrandX X200 Vacuum'],
      descriptions: ['Clean faster with BrandX X200'],
      keywords: ['brandx x200 vacuum'],
      keywordsWithVolume: [
        {
          keyword: 'brandx x200 vacuum',
          searchVolume: 1600,
          source: 'SEARCH_TERM_HIGH_PERFORMING',
          matchType: 'PHRASE',
          sourceField: 'search_terms',
          evidence: ['x200', 'vacuum'],
          confidence: 0.93,
        },
      ],
      theme: '型号导向',
      explanation: 'Focus on the verified model.',
      final_url: 'https://example.com/product',
      ai_model: 'gemini-2.5-pro',
      score: 84,
      score_breakdown: {
        relevance: 12,
        quality: 12,
        engagement: 12,
        diversity: 12,
        clarity: 12,
        brandSearchVolume: 12,
        competitivePositioning: 12,
      },
      creative_type: 'model_intent',
      keyword_bucket: 'B',
      bucket_intent: '型号导向',
    })

    const persistedKeywords = JSON.parse(String(dbState.insertParams?.[5] || '[]'))

    expect(persistedKeywords).toHaveLength(1)
    expect(persistedKeywords[0]).toMatchObject({
      keyword: 'brandx x200 vacuum',
      source: 'SEARCH_TERM_HIGH_PERFORMING',
      sourceType: 'SEARCH_TERM_HIGH_PERFORMING',
      sourceSubtype: 'SEARCH_TERM_HIGH_PERFORMING',
      sourceTier: 'T0',
      sourceGovernanceBucket: 'primary',
      sourceTop1Eligible: true,
      sourceTop2Eligible: true,
      rawSource: 'SEARCH_TERM',
      isDerived: false,
      isFallback: false,
      sourceField: 'search_terms',
      matchType: 'EXACT',
      suggestedMatchType: 'EXACT',
      confidence: 0.93,
      evidence: ['x200', 'vacuum'],
      languageSignals: expect.objectContaining({
        targetLanguage: 'en',
        allowedLanguageHints: expect.arrayContaining(['en']),
      }),
      decisionTrace: expect.arrayContaining([
        expect.objectContaining({ stage: 'source_governance', outcome: 'primary' }),
        expect.objectContaining({ stage: 'final_invariant', outcome: 'selected' }),
      ]),
    })

    expect(creative.keywordsWithVolume?.[0]).toMatchObject({
      source: 'SEARCH_TERM_HIGH_PERFORMING',
      sourceType: 'SEARCH_TERM_HIGH_PERFORMING',
      sourceSubtype: 'SEARCH_TERM_HIGH_PERFORMING',
      sourceTier: 'T0',
      sourceGovernanceBucket: 'primary',
      sourceTop1Eligible: true,
      sourceTop2Eligible: true,
      rawSource: 'SEARCH_TERM',
      isDerived: false,
      isFallback: false,
      sourceField: 'search_terms',
      matchType: 'EXACT',
      suggestedMatchType: 'EXACT',
      confidence: 0.93,
      evidence: ['x200', 'vacuum'],
      languageSignals: expect.objectContaining({
        targetLanguage: 'en',
        allowedLanguageHints: expect.arrayContaining(['en']),
      }),
      decisionTrace: expect.arrayContaining([
        expect.objectContaining({ stage: 'source_governance', outcome: 'primary' }),
        expect.objectContaining({ stage: 'final_invariant', outcome: 'selected' }),
      ]),
    })
  })

  it('persists audit as primary field and keeps keywordSourceAudit alias in adStrength payload', async () => {
    const creative = await createAdCreative(1, 96, {
      headlines: ['BrandX X200 Vacuum'],
      descriptions: ['Clean faster with BrandX X200'],
      keywords: ['brandx x200 vacuum'],
      keywordsWithVolume: [
        {
          keyword: 'brandx x200 vacuum',
          searchVolume: 1600,
          source: 'SEARCH_TERM_HIGH_PERFORMING',
          matchType: 'PHRASE',
        },
      ],
      theme: '型号导向',
      explanation: 'Focus on the verified model.',
      final_url: 'https://example.com/product',
      ai_model: 'gemini-2.5-pro',
      score: 84,
      score_breakdown: {
        relevance: 12,
        quality: 12,
        engagement: 12,
        diversity: 12,
        clarity: 12,
        brandSearchVolume: 12,
        competitivePositioning: 12,
      },
      adStrength: {
        rating: 'GOOD',
        score: 84,
        dimensions: {
          relevance: { score: 12 },
          quality: { score: 12 },
        } as any,
        audit: {
          totalKeywords: 2,
          withSearchVolumeKeywords: 1,
          zeroVolumeKeywords: 1,
          volumeUnavailableKeywords: 1,
          noVolumeMode: true,
          fallbackMode: true,
          contextFallbackStrategy: 'filtered',
          sourceQuotaAudit: {
            enabled: true,
            fallbackMode: true,
            targetCount: 2,
            requiredBrandCount: 0,
            acceptedBrandCount: 1,
            acceptedCount: 2,
            deferredCount: 1,
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
              lowTrust: 1,
              ai: 0,
              aiLlmRaw: 0,
            },
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
        },
      },
      creative_type: 'model_intent',
      keyword_bucket: 'B',
      bucket_intent: '型号导向',
    })

    const persistedAdStrength = JSON.parse(String(dbState.insertParams?.[19] || '{}'))
    expect(persistedAdStrength.audit).toMatchObject({
      totalKeywords: 2,
      noVolumeMode: true,
      sourceQuotaAudit: {
        deferredRefillTriggered: true,
      },
      byRawSource: {
        SEARCH_TERM: { count: 1, ratio: 0.5 },
      },
    })
    expect(persistedAdStrength.keywordSourceAudit).toMatchObject({
      totalKeywords: 2,
      noVolumeMode: true,
      sourceQuotaAudit: {
        deferredRefillTriggered: true,
      },
      byRawSource: {
        SEARCH_TERM: { count: 1, ratio: 0.5 },
      },
    })

    expect((creative as any).adStrength?.audit).toMatchObject({
      totalKeywords: 2,
      sourceQuotaAudit: {
        deferredRefillTriggered: true,
      },
    })
    expect((creative as any).adStrength?.keywordSourceAudit).toMatchObject({
      totalKeywords: 2,
      sourceQuotaAudit: {
        deferredRefillTriggered: true,
      },
    })
  })

  it('trusts builder executable keywords and skips legacy reselection on persist', async () => {
    const creative = await createAdCreative(1, 96, {
      headlines: ['BrandX X200 Vacuum'],
      descriptions: ['Clean faster with BrandX X200'],
      keywords: ['brandx x200 vacuum'],
      executableKeywords: ['brandx x200 vacuum'],
      audit: {
        totalKeywords: 1,
        withSearchVolumeKeywords: 1,
        zeroVolumeKeywords: 0,
        volumeUnavailableKeywords: 0,
        noVolumeMode: false,
        fallbackMode: false,
        contextFallbackStrategy: 'filtered',
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
          quota: {
            combinedLowTrustCap: 1,
            aiCap: 1,
            aiLlmRawCap: 1,
          },
          acceptedByClass: {
            lowTrust: 0,
            ai: 0,
            aiLlmRaw: 0,
          },
          blockedByCap: {
            lowTrust: 0,
            ai: 0,
            aiLlmRaw: 0,
          },
        },
        byRawSource: {},
        bySourceSubtype: {},
        bySourceField: {},
        creativeAffinityByLabel: {},
        creativeAffinityByLevel: {},
        supplementationSources: {},
        pipeline: {
          initialCandidateCount: 1,
          initialContextFilteredCount: 1,
          postSupplementCandidateCount: 1,
          postSupplementContextFilteredCount: 1,
          finalCandidatePoolCount: 1,
          selectionFallbackTriggered: false,
          selectionFallbackSource: 'filtered',
          selectionFallbackReason: 'none',
          finalInvariantTriggered: false,
          finalInvariantCandidateCount: 0,
          supplementAppliedAfterFilter: false,
        },
      } as any,
      keywordsWithVolume: [
        {
          keyword: 'brandx x200 vacuum',
          searchVolume: 1600,
          source: 'SEARCH_TERM_HIGH_PERFORMING',
          matchType: 'PHRASE',
          sourceType: 'SEARCH_TERM_HIGH_PERFORMING',
          sourceSubtype: 'SEARCH_TERM_HIGH_PERFORMING',
          rawSource: 'SEARCH_TERM',
          sourceField: 'search_terms',
        },
      ],
      theme: '型号导向',
      explanation: 'Focus on the verified model.',
      final_url: 'https://example.com/product',
      ai_model: 'gemini-2.5-pro',
      score: 84,
      score_breakdown: {
        relevance: 12,
        quality: 12,
        engagement: 12,
        diversity: 12,
        clarity: 12,
        brandSearchVolume: 12,
        competitivePositioning: 12,
      },
      creative_type: 'model_intent',
      keyword_bucket: 'B',
      bucket_intent: '型号导向',
    } as any)

    const persistedKeywords = JSON.parse(String(dbState.insertParams?.[5] || '[]'))

    expect(persistedKeywords).toHaveLength(1)
    expect(persistedKeywords[0]).toMatchObject({
      keyword: 'brandx x200 vacuum',
      matchType: 'PHRASE',
      source: 'SEARCH_TERM_HIGH_PERFORMING',
      sourceSubtype: 'SEARCH_TERM_HIGH_PERFORMING',
    })
    expect(creative.keywords).toEqual(['brandx x200 vacuum'])
    expect(creative.keywordsWithVolume?.[0]).toMatchObject({
      keyword: 'brandx x200 vacuum',
      matchType: 'PHRASE',
    })
  })

  it('trusts builder-validated keywords when audit exists even without explicit executableKeywords', async () => {
    const creative = await createAdCreative(1, 96, {
      headlines: ['BrandX X200 Vacuum'],
      descriptions: ['Clean faster with BrandX X200'],
      keywords: ['brandx x200 vacuum'],
      keywordSourceAudit: {
        totalKeywords: 1,
        withSearchVolumeKeywords: 1,
        zeroVolumeKeywords: 0,
        volumeUnavailableKeywords: 0,
        noVolumeMode: false,
        fallbackMode: false,
        contextFallbackStrategy: 'filtered',
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
          quota: {
            combinedLowTrustCap: 1,
            aiCap: 1,
            aiLlmRawCap: 1,
          },
          acceptedByClass: {
            lowTrust: 0,
            ai: 0,
            aiLlmRaw: 0,
          },
          blockedByCap: {
            lowTrust: 0,
            ai: 0,
            aiLlmRaw: 0,
          },
        },
        byRawSource: {},
        bySourceSubtype: {},
        bySourceField: {},
        creativeAffinityByLabel: {},
        creativeAffinityByLevel: {},
        supplementationSources: {},
        pipeline: {
          initialCandidateCount: 1,
          initialContextFilteredCount: 1,
          postSupplementCandidateCount: 1,
          postSupplementContextFilteredCount: 1,
          finalCandidatePoolCount: 1,
          selectionFallbackTriggered: false,
          selectionFallbackSource: 'filtered',
          selectionFallbackReason: 'none',
          finalInvariantTriggered: false,
          finalInvariantCandidateCount: 0,
          supplementAppliedAfterFilter: false,
        },
      } as any,
      keywordsWithVolume: [
        {
          keyword: 'brandx x200 vacuum',
          searchVolume: 1600,
          source: 'SEARCH_TERM_HIGH_PERFORMING',
          matchType: 'PHRASE',
          sourceType: 'SEARCH_TERM_HIGH_PERFORMING',
          sourceSubtype: 'SEARCH_TERM_HIGH_PERFORMING',
          rawSource: 'SEARCH_TERM',
          sourceField: 'search_terms',
        },
      ],
      theme: '型号导向',
      explanation: 'Focus on the verified model.',
      final_url: 'https://example.com/product',
      ai_model: 'gemini-2.5-pro',
      score: 84,
      score_breakdown: {
        relevance: 12,
        quality: 12,
        engagement: 12,
        diversity: 12,
        clarity: 12,
        brandSearchVolume: 12,
        competitivePositioning: 12,
      },
      creative_type: 'model_intent',
      keyword_bucket: 'B',
      bucket_intent: '型号导向',
    } as any)

    expect(creative.keywords).toEqual(['brandx x200 vacuum'])
    expect(creative.keywordsWithVolume?.[0]).toMatchObject({
      keyword: 'brandx x200 vacuum',
      matchType: 'PHRASE',
      sourceSubtype: 'SEARCH_TERM_HIGH_PERFORMING',
    })
  })

  it('rejects explicit empty builder selections to enforce non-empty keyword contract', async () => {
    await expect(createAdCreative(1, 96, {
      headlines: ['BrandX X200 Vacuum'],
      descriptions: ['Clean faster with BrandX X200'],
      keywords: [],
      executableKeywords: [],
      audit: {
        totalKeywords: 0,
        withSearchVolumeKeywords: 0,
        zeroVolumeKeywords: 0,
        volumeUnavailableKeywords: 0,
        noVolumeMode: false,
        fallbackMode: false,
        contextFallbackStrategy: 'original',
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
          quota: {
            combinedLowTrustCap: 1,
            aiCap: 1,
            aiLlmRawCap: 1,
          },
          acceptedByClass: {
            lowTrust: 0,
            ai: 0,
            aiLlmRaw: 0,
          },
          blockedByCap: {
            lowTrust: 0,
            ai: 0,
            aiLlmRaw: 0,
          },
        },
        byRawSource: {},
        bySourceSubtype: {},
        bySourceField: {},
        creativeAffinityByLabel: {},
        creativeAffinityByLevel: {},
        supplementationSources: {},
        pipeline: {
          initialCandidateCount: 1,
          initialContextFilteredCount: 0,
          postSupplementCandidateCount: 1,
          postSupplementContextFilteredCount: 0,
          finalCandidatePoolCount: 1,
          selectionFallbackTriggered: true,
          selectionFallbackSource: 'original',
          selectionFallbackReason: 'selection_empty',
          contractSatisfiedAfterFallback: false,
          finalInvariantTriggered: false,
          finalInvariantCandidateCount: 0,
          supplementAppliedAfterFilter: false,
        },
      } as any,
      keywordsWithVolume: [],
      theme: '型号导向',
      explanation: 'Skip wrong keywords entirely.',
      final_url: 'https://example.com/product',
      ai_model: 'gemini-2.5-pro',
      score: 84,
      score_breakdown: {
        relevance: 12,
        quality: 12,
        engagement: 12,
        diversity: 12,
        clarity: 12,
        brandSearchVolume: 12,
        competitivePositioning: 12,
      },
      creative_type: 'model_intent',
      keyword_bucket: 'B',
      bucket_intent: '型号导向',
    } as any)).rejects.toThrow('关键词 contract 校验失败')
  })

  it('rejects executable keywords without builder audit', async () => {
    await expect(createAdCreative(1, 96, {
      headlines: ['BrandX X200 Vacuum'],
      descriptions: ['Clean faster with BrandX X200'],
      keywords: ['brandx x200 vacuum'],
      executableKeywords: ['brandx x200 vacuum'],
      keywordsWithVolume: [
        {
          keyword: 'brandx x200 vacuum',
          searchVolume: 1600,
          source: 'SEARCH_TERM_HIGH_PERFORMING',
          matchType: 'PHRASE',
        },
      ],
      theme: '型号导向',
      explanation: 'Focus on the verified model.',
      final_url: 'https://example.com/product',
      ai_model: 'gemini-2.5-pro',
      score: 84,
      score_breakdown: {
        relevance: 12,
        quality: 12,
        engagement: 12,
        diversity: 12,
        clarity: 12,
        brandSearchVolume: 12,
        competitivePositioning: 12,
      },
      creative_type: 'model_intent',
      keyword_bucket: 'B',
      bucket_intent: '型号导向',
    } as any)).rejects.toThrow('缺少 builder audit')
  })
})
