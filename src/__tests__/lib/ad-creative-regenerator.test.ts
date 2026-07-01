import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const keywordPoolFns = vi.hoisted(() => ({
  resolveKeywordPoolForCreativeGeneration: vi.fn(),
}))

const pipelineFns = vi.hoisted(() => ({
  runBucketCreativeGeneration: vi.fn(),
}))

vi.mock('@/lib/offers/server', () => ({
  findOfferById: offerFns.findOfferById,
  deriveSkipKeywordPoolExpandLoad: vi.fn(() => false),
  resolveOfferLinkType: vi.fn(() => 'product'),
}))

vi.mock('@/lib/creatives/ad-creative', () => ({
  findAdCreativeById: adCreativeFns.findAdCreativeById,
  createAdCreative: adCreativeFns.createAdCreative,
}))

vi.mock('@/lib/creatives/generator/index', () => ({
  getThemeByBucket: generatorFns.getThemeByBucket,
}))

vi.mock('@/lib/keywords/offer-pool', () => ({
  resolveKeywordPoolForCreativeGeneration: keywordPoolFns.resolveKeywordPoolForCreativeGeneration,
}))

vi.mock('@/lib/keywords/server', () => ({
  createCreativeAdStrengthPayload: vi.fn(() => ({})),
  createCreativeScoreBreakdown: vi.fn(() => ({})),
  resolveCreativeKeywordAudit: vi.fn(() => ({})),
}))

vi.mock('@/lib/creatives/bucket-creative-generation-pipeline', () => ({
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
  runBucketCreativeGeneration: pipelineFns.runBucketCreativeGeneration,
}))

describe('regenerateAdCreative', () => {
  let regenerateAdCreative: typeof import('@/lib/creatives/ad-creative-regenerator').regenerateAdCreative

  const generatedPayload = {
    headlines: ['H1'],
    descriptions: ['D1'],
    keywords: ['kw'],
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    ;({ regenerateAdCreative } = await import('@/lib/creatives/ad-creative-regenerator'))

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
        generationProfile: expect.objectContaining({ maxRetries: 0 }),
      })
    )
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
        adStrength: {
          finalScore: 40,
          finalRating: 'POOR',
        },
        reasons: ['low relevance'],
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

  it('regenerates canonical bucket B creatives', async () => {
    adCreativeFns.findAdCreativeById.mockResolvedValueOnce({
      id: 401,
      generation_mode: 'fast',
      keyword_bucket: 'B',
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
        generationBucket: 'B',
      })
    )
  })

  it('rejects legacy keyword_bucket C', async () => {
    adCreativeFns.findAdCreativeById.mockResolvedValueOnce({
      id: 401,
      generation_mode: 'fast',
      keyword_bucket: 'C',
    })

    const result = await regenerateAdCreative({
      userId: 1,
      offerId: 96,
      previousAdCreativeId: 401,
      campaignConfigForTask: {},
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('仅支持 A/B/D')
    expect(pipelineFns.runBucketCreativeGeneration).not.toHaveBeenCalled()
  })

  it('falls back to campaign config generation mode when previous row is missing', async () => {
    adCreativeFns.findAdCreativeById.mockResolvedValueOnce(null)

    const result = await regenerateAdCreative({
      userId: 1,
      offerId: 96,
      previousAdCreativeId: 401,
      campaignConfigForTask: { generation_mode: 'balanced' },
    })

    expect(result.generationMode).toBe('balanced')
    expect(pipelineFns.runBucketCreativeGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        generationProfile: expect.objectContaining({ maxRetries: expect.any(Number) }),
      })
    )
  })
})
