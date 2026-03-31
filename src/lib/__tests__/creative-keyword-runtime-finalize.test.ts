import { beforeEach, describe, expect, it, vi } from 'vitest'

const builderFns = vi.hoisted(() => ({
  buildCreativeKeywordSet: vi.fn(),
}))

vi.mock('@/lib/creative-keyword-set-builder', () => ({
  buildCreativeKeywordSet: builderFns.buildCreativeKeywordSet,
}))

import { finalizeCreativeKeywordSet } from '../creative-keyword-runtime'

describe('finalizeCreativeKeywordSet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rebuilds final executable keywords from generated creative state and reapplies builder output', async () => {
    builderFns.buildCreativeKeywordSet.mockResolvedValue({
      executableKeywords: ['brandx x200 vacuum'],
      executableKeywordCandidates: [],
      candidatePool: [],
      keywords: ['brandx x200 vacuum'],
      keywordsWithVolume: [
        {
          keyword: 'brandx x200 vacuum',
          searchVolume: 1200,
          matchType: 'EXACT',
        },
      ],
      promptKeywords: ['brandx x200 vacuum', 'buy brandx x200 vacuum'],
      keywordSupplementation: undefined,
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

    const creative = {
      headlines: ['BrandX X200 Vacuum'],
      descriptions: ['Clean faster with BrandX X200'],
      keywords: ['brandx x200 vacuum', 'brandx official store'],
      keywordsWithVolume: [
        {
          keyword: 'brandx x200 vacuum',
          searchVolume: 900,
          source: 'AI_GENERATED',
          matchType: 'PHRASE',
        },
      ],
      promptKeywords: ['brandx x200 vacuum'],
      theme: 'model intent',
      explanation: 'Focus on the verified model.',
    }

    const result = await finalizeCreativeKeywordSet({
      offer: {
        brand: 'BrandX',
        target_language: 'en',
      },
      userId: 7,
      creative,
      creativeType: 'model_intent',
      bucket: 'B',
      scopeLabel: 'unit-finalize',
      seedCandidates: [{ keyword: 'brandx x200 replacement filter' }],
    })

    expect(builderFns.buildCreativeKeywordSet).toHaveBeenCalledWith(expect.objectContaining({
      creativeType: 'model_intent',
      bucket: 'B',
      scopeLabel: 'unit-finalize',
      keywords: ['brandx x200 vacuum', 'brandx official store'],
      promptKeywords: ['brandx x200 vacuum'],
      seedCandidates: [{ keyword: 'brandx x200 replacement filter' }],
      enableSupplementation: false,
      continueOnSupplementError: true,
    }))
    expect(result.keywords).toEqual(['brandx x200 vacuum'])
    expect(result.keywordsWithVolume).toEqual([
      expect.objectContaining({
        keyword: 'brandx x200 vacuum',
        searchVolume: 1200,
      }),
    ])
    expect(result.promptKeywords).toEqual(['brandx x200 vacuum', 'buy brandx x200 vacuum'])
    expect(result.audit).toMatchObject({
      totalKeywords: 1,
      contextFallbackStrategy: 'filtered',
    })
  })
})
