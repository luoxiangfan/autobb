import { beforeEach, describe, expect, it, vi } from 'vitest'
import { regenerateAdCreative } from './ad-creative-regenerator'

const offerFns = vi.hoisted(() => ({
  findOfferById: vi.fn(),
}))

const adCreativeFns = vi.hoisted(() => ({
  findAdCreativeById: vi.fn(),
  createAdCreative: vi.fn(),
}))

const generatorFns = vi.hoisted(() => ({
  getThemeByBucket: vi.fn(),
}))

vi.mock('./offers', () => ({
  findOfferById: offerFns.findOfferById,
}))

vi.mock('./ad-creative', () => ({
  findAdCreativeById: adCreativeFns.findAdCreativeById,
  createAdCreative: adCreativeFns.createAdCreative,
}))

vi.mock('./ad-creative-generator', () => ({
  getThemeByBucket: generatorFns.getThemeByBucket,
}))

const keywordPoolFns = vi.hoisted(() => ({
  resolveKeywordPoolForCreativeGeneration: vi.fn(),
}))

const pipelineFns = vi.hoisted(() => ({
  runBucketCreativeGeneration: vi.fn(),
}))

vi.mock('./offer-keyword-pool', () => ({
  resolveKeywordPoolForCreativeGeneration: keywordPoolFns.resolveKeywordPoolForCreativeGeneration,
}))

vi.mock('./bucket-creative-generation-pipeline', () => ({
  assertPostGenerationPersistenceGate: vi.fn(),
  formatBucketGenerationRejectedError: (result: {
    selectedEvaluation?: {
      reasons?: string[]
      adStrength?: { finalScore?: number; finalRating?: string }
    }
  }) => {
    const evaluation = result.selectedEvaluation
    const score = evaluation?.adStrength?.finalScore
    const rating = evaluation?.adStrength?.finalRating
    const reasons = Array.isArray(evaluation?.reasons) ? evaluation.reasons.join('; ') : ''
    return reasons
      ? `广告创意质量未达标（${rating || 'UNKNOWN'} ${score ?? '-'}）：${reasons}`
      : `广告创意质量未达标（${rating || 'UNKNOWN'} ${score ?? '-'}）`
  },
  resolveOfferLinkType: () => 'product',
  runBucketCreativeGeneration: pipelineFns.runBucketCreativeGeneration,
}))

describe('regenerateAdCreative', () => {
  const generatedPayload = {
    headlines: ['H1'],
    descriptions: ['D1'],
    keywords: ['kw'],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    offerFns.findOfferById.mockResolvedValue({
      id: 96,
      brand: 'BrandX',
      url: 'https://example.com',
      final_url_suffix: '',
      link_type: 'product',
    })
    adCreativeFns.findAdCreativeById.mockResolvedValue({
      id: 401,
      generation_mode: 'fast',
      keyword_bucket: 'A',
    })
    generatorFns.getThemeByBucket.mockReturnValue('Intent - IntentEn')
    keywordPoolFns.resolveKeywordPoolForCreativeGeneration.mockResolvedValue({
      pool: { id: 77, brandKeywords: [] },
      plannerSession: undefined,
    })
    pipelineFns.runBucketCreativeGeneration.mockResolvedValue({
      selectedCreative: generatedPayload,
      accepted: true,
      attempts: 1,
      maxRetries: 0,
      history: [],
      selectedEvaluation: {
        passed: true,
        adStrength: {
          finalScore: 80,
          finalRating: 'GOOD',
          localEvaluation: {
            dimensions: {
              relevance: { score: 10 },
              quality: { score: 10 },
              completeness: { score: 10 },
              diversity: { score: 10 },
              compliance: { score: 10 },
              brandSearchVolume: { score: 10 },
              competitivePositioning: { score: 10 },
            },
          },
          combinedSuggestions: [],
        },
        reasons: [],
      },
    })
    adCreativeFns.createAdCreative.mockResolvedValue({ id: 502 })
  })

  it('inherits generation_mode and applies fast profile (maxRetries=0)', async () => {
    const result = await regenerateAdCreative({
      userId: 1,
      offerId: 96,
      previousAdCreativeId: 401,
      campaignConfigForTask: {},
    })

    expect(result.success).toBe(true)
    expect(result.generationMode).toBe('fast')
    expect(pipelineFns.runBucketCreativeGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRetries: 0,
        bucket: 'A',
        loadSearchTermFeedbackHints: true,
      })
    )
    expect(adCreativeFns.createAdCreative).toHaveBeenCalledWith(
      1,
      96,
      expect.objectContaining({
        generation_mode: 'fast',
        score: 80,
        score_breakdown: expect.objectContaining({
          relevance: 10,
          quality: 10,
        }),
        adStrength: expect.objectContaining({
          rating: 'GOOD',
          score: 80,
        }),
      })
    )
    expect(result.campaignConfig).toMatchObject({
      generation_mode: 'fast',
    })
  })

  it('fails when quality loop does not accept the creative', async () => {
    pipelineFns.runBucketCreativeGeneration.mockResolvedValueOnce({
      selectedCreative: generatedPayload,
      accepted: false,
      attempts: 1,
      maxRetries: 0,
      history: [],
      selectedEvaluation: {
        passed: false,
        reasons: ['score_too_low'],
        adStrength: { finalScore: 55, finalRating: 'POOR' },
      },
    })

    const result = await regenerateAdCreative({
      userId: 1,
      offerId: 96,
      previousAdCreativeId: 401,
      campaignConfigForTask: {},
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('质量未达标')
    expect(adCreativeFns.createAdCreative).not.toHaveBeenCalled()
  })

  it('maps legacy keyword_bucket C to slot B and passes generationBucket C to pipeline', async () => {
    adCreativeFns.findAdCreativeById.mockResolvedValueOnce({
      id: 401,
      generation_mode: 'balanced',
      keyword_bucket: 'C',
    })

    const result = await regenerateAdCreative({
      userId: 1,
      offerId: 96,
      previousAdCreativeId: 401,
      campaignConfigForTask: {},
    })

    expect(result.success).toBe(true)
    expect(pipelineFns.runBucketCreativeGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'B',
        generationBucket: 'C',
        keywordPool: { id: 77, brandKeywords: [] },
      })
    )
    expect(adCreativeFns.createAdCreative).toHaveBeenCalledWith(
      1,
      96,
      expect.objectContaining({
        keyword_bucket: 'B',
      })
    )
  })

  it('maps legacy keyword_bucket S to slot D and passes generationBucket S to pipeline', async () => {
    adCreativeFns.findAdCreativeById.mockResolvedValueOnce({
      id: 401,
      generation_mode: 'balanced',
      keyword_bucket: 'S',
    })
    generatorFns.getThemeByBucket.mockReturnValueOnce(
      '商品需求意图导向 - 聚焦商品功能/场景需求，承接高覆盖需求流量'
    )

    const result = await regenerateAdCreative({
      userId: 1,
      offerId: 96,
      previousAdCreativeId: 401,
      campaignConfigForTask: {},
    })

    expect(result.success).toBe(true)
    expect(pipelineFns.runBucketCreativeGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'D',
        generationBucket: 'S',
        keywordPool: { id: 77, brandKeywords: [] },
      })
    )
    expect(adCreativeFns.createAdCreative).toHaveBeenCalledWith(
      1,
      96,
      expect.objectContaining({
        keyword_bucket: 'D',
        creative_type: 'product_intent',
      })
    )
  })

  it('falls back to campaign config generation mode when previous row is missing', async () => {
    adCreativeFns.findAdCreativeById.mockResolvedValueOnce(null)

    const result = await regenerateAdCreative({
      userId: 1,
      offerId: 96,
      previousAdCreativeId: 401,
      campaignConfigForTask: { generationMode: 'balanced' },
    })

    expect(result.generationMode).toBe('balanced')
    expect(pipelineFns.runBucketCreativeGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRetries: 1,
      })
    )
    expect(adCreativeFns.createAdCreative).toHaveBeenCalledWith(
      1,
      96,
      expect.objectContaining({
        generation_mode: 'balanced',
      })
    )
  })
})
