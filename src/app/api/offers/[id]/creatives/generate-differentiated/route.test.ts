import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { POST } from '@/app/api/offers/[id]/creatives/generate-differentiated/route'

const offerFns = vi.hoisted(() => ({
  findOfferById: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}))

const generatorFns = vi.hoisted(() => ({
  generateAdCreative: vi.fn(),
  applyKeywordSupplementationOnce: vi.fn(),
  createAdCreative: vi.fn(),
}))

const qualityLoopFns = vi.hoisted(() => ({
  evaluateCreativeForQuality: vi.fn(),
  runCreativeGenerationQualityLoop: vi.fn(),
}))

const selectionFns = vi.hoisted(() => ({
  selectCreativeKeywords: vi.fn(),
}))

const keywordPoolFns = vi.hoisted(() => ({
  getOrCreateKeywordPool: vi.fn(),
  getKeywordPoolByOfferId: vi.fn(),
  getBucketInfo: vi.fn(),
  getAvailableBuckets: vi.fn(),
  getUsedBuckets: vi.fn(),
  isCreativeLimitReached: vi.fn(),
  calculateKeywordOverlapRate: vi.fn(),
  determineClusteringStrategy: vi.fn(),
}))

const rebuildFns = vi.hoisted(() => ({
  postRebuild: vi.fn(),
}))

const riskAlertFns = vi.hoisted(() => ({
  createRiskAlert: vi.fn(),
}))

vi.mock('@/lib/offers', () => ({
  findOfferById: offerFns.findOfferById,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

vi.mock('@/lib/ad-creative-generator', () => ({
  generateAdCreative: generatorFns.generateAdCreative,
  applyKeywordSupplementationOnce: generatorFns.applyKeywordSupplementationOnce,
}))

vi.mock('@/lib/ad-creative', () => ({
  createAdCreative: generatorFns.createAdCreative,
}))

vi.mock('@/lib/ad-creative-quality-loop', () => ({
  AD_CREATIVE_MAX_AUTO_RETRIES: 2,
  AD_CREATIVE_REQUIRED_MIN_SCORE: 70,
  evaluateCreativeForQuality: qualityLoopFns.evaluateCreativeForQuality,
  runCreativeGenerationQualityLoop: qualityLoopFns.runCreativeGenerationQualityLoop,
}))

vi.mock('@/lib/creative-keyword-selection', () => ({
  CREATIVE_BRAND_KEYWORD_RESERVE: 4,
  CREATIVE_KEYWORD_MAX_COUNT: 50,
  selectCreativeKeywords: selectionFns.selectCreativeKeywords,
}))

vi.mock('@/lib/offer-keyword-pool', () => ({
  getOrCreateKeywordPool: keywordPoolFns.getOrCreateKeywordPool,
  getKeywordPoolByOfferId: keywordPoolFns.getKeywordPoolByOfferId,
  getBucketInfo: keywordPoolFns.getBucketInfo,
  getAvailableBuckets: keywordPoolFns.getAvailableBuckets,
  getUsedBuckets: keywordPoolFns.getUsedBuckets,
  isCreativeLimitReached: keywordPoolFns.isCreativeLimitReached,
  calculateKeywordOverlapRate: keywordPoolFns.calculateKeywordOverlapRate,
  determineClusteringStrategy: keywordPoolFns.determineClusteringStrategy,
}))

vi.mock('@/app/api/offers/[id]/rebuild/route', () => ({
  POST: rebuildFns.postRebuild,
}))

vi.mock('@/lib/risk-alerts', () => ({
  createRiskAlert: riskAlertFns.createRiskAlert,
}))

describe('POST /api/offers/:id/creatives/generate-differentiated', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.AD_CREATIVE_HARD_PERSISTENCE_GATE_ENABLED = '0'
    process.env.AD_CREATIVE_HARD_QUALITY_GATE_ENABLED = '1'
    process.env.AD_CREATIVE_HARD_GATE_RETRY_ONCE_ENABLED = '1'
    riskAlertFns.createRiskAlert.mockResolvedValue(1)

    offerFns.findOfferById.mockResolvedValue({
      id: 96,
      user_id: 1,
      scrape_status: 'completed',
    })

    rebuildFns.postRebuild.mockResolvedValue(
      NextResponse.json({
        success: true,
        taskId: 'rebuild-96',
        offerId: 96,
      })
    )

    keywordPoolFns.getOrCreateKeywordPool.mockResolvedValue({
      id: 801,
      totalKeywords: 8,
      brandKeywords: [{ keyword: 'brandx', searchVolume: 1000, source: 'BRAND' }],
      balanceScore: 0.88,
    })
    keywordPoolFns.determineClusteringStrategy.mockReturnValue({
      bucketCount: 1,
      strategy: 'focused',
      message: 'test strategy',
    })
    keywordPoolFns.getAvailableBuckets.mockResolvedValue(['B'])
    keywordPoolFns.getUsedBuckets.mockResolvedValue([])
    keywordPoolFns.getBucketInfo.mockReturnValue({
      intent: '商品型号/产品族意图',
      intentEn: 'Model Intent',
      keywords: [
        {
          keyword: 'brandx x200 vacuum',
          searchVolume: 5000,
          competition: 'LOW',
          competitionIndex: 12,
          matchType: 'PHRASE',
          source: 'KEYWORD_POOL',
        },
      ],
    })

    generatorFns.generateAdCreative.mockResolvedValue({
      headlines: ['BrandX X200 Vacuum', 'Buy BrandX X200', 'X200 Robot Vacuum'],
      descriptions: ['Deep clean with X200.', 'Shop verified BrandX model.'],
      keywords: ['brandx x200 vacuum'],
      theme: '商品型号/产品族意图 - Model Intent',
      ai_model: 'gemini-test',
    })
    generatorFns.applyKeywordSupplementationOnce.mockImplementation(async ({ keywordsWithVolume }: any) => ({
      keywords: keywordsWithVolume.map((item: any) => item.keyword),
      keywordsWithVolume,
      keywordSupplementation: {
        triggered: false,
        beforeCount: keywordsWithVolume.length,
        afterCount: keywordsWithVolume.length,
        addedKeywords: [],
        supplementCapApplied: false,
      },
    }))
    selectionFns.selectCreativeKeywords.mockImplementation((input: any) => ({
      keywords: (input.keywordsWithVolume || []).map((item: any) => item.keyword),
      keywordsWithVolume: (input.keywordsWithVolume || []).map((item: any) => ({
        ...item,
        matchType: 'EXACT',
      })),
      truncated: false,
    }))
    qualityLoopFns.runCreativeGenerationQualityLoop.mockImplementation(async ({ generate }: any) => {
      const creative = await generate({ attempt: 1, retryFailureType: undefined })
      return {
        selectedCreative: creative,
        selectedEvaluation: {
          passed: true,
          adStrength: {
            finalRating: 'GOOD',
            finalScore: 82,
            localEvaluation: {
              dimensions: {
                relevance: { score: 12 },
                quality: { score: 11 },
                completeness: { score: 10 },
                diversity: { score: 9 },
                compliance: { score: 8 },
                brandSearchVolume: { score: 7 },
                competitivePositioning: { score: 6 },
              },
            },
            combinedSuggestions: [],
          },
        },
        attempts: 1,
      }
    })
    generatorFns.createAdCreative.mockImplementation(async (_userId: number, _offerId: number, data: any) => ({
      id: 901,
      ...data,
    }))
  })

  afterEach(() => {
    delete process.env.AD_CREATIVE_HARD_PERSISTENCE_GATE_ENABLED
    delete process.env.AD_CREATIVE_HARD_QUALITY_GATE_ENABLED
    delete process.env.AD_CREATIVE_HARD_GATE_RETRY_ONCE_ENABLED
  })

  it('delegates forceRegeneratePool=true to offer rebuild and returns 202', async () => {
    const req = new NextRequest('http://localhost/api/offers/96/creatives/generate-differentiated', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        forceRegeneratePool: true,
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(202)
    expect(rebuildFns.postRebuild).toHaveBeenCalledTimes(1)
    expect(keywordPoolFns.getOrCreateKeywordPool).not.toHaveBeenCalled()
    expect(data.success).toBe(true)
    expect(data.data.rebuildTaskId).toBe('rebuild-96')
  })

  it('passes through rebuild errors when delegation fails', async () => {
    rebuildFns.postRebuild.mockResolvedValueOnce(
      NextResponse.json(
        {
          error: 'Invalid data',
          message: 'Offer缺少推广链接，无法重建',
        },
        { status: 400 }
      )
    )

    const req = new NextRequest('http://localhost/api/offers/96/creatives/generate-differentiated', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        forceRegeneratePool: true,
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(keywordPoolFns.getOrCreateKeywordPool).not.toHaveBeenCalled()
    expect(data.message).toBe('Offer缺少推广链接，无法重建')
  })

  it('returns canonical creativeType and defers matchType finalization to keyword selection', async () => {
    selectionFns.selectCreativeKeywords.mockImplementationOnce((input: any) => {
      expect(input.creativeType).toBe('model_intent')
      expect(input.keywordsWithVolume).toHaveLength(1)
      expect(input.keywordsWithVolume[0].matchType).toBe('PHRASE')

      return {
        keywords: input.keywordsWithVolume.map((item: any) => item.keyword),
        keywordsWithVolume: input.keywordsWithVolume.map((item: any) => ({
          ...item,
          matchType: 'EXACT',
        })),
        truncated: false,
      }
    })

    const req = new NextRequest('http://localhost/api/offers/96/creatives/generate-differentiated', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        buckets: ['B'],
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(generatorFns.generateAdCreative).toHaveBeenCalledWith(
      96,
      1,
      expect.objectContaining({
        bucket: 'B',
        deferKeywordPostProcessingToBuilder: true,
      })
    )
    expect(data.success).toBe(true)
    expect(data.data.creatives[0].creative.creativeType).toBe('model_intent')
    expect(generatorFns.createAdCreative).toHaveBeenCalledWith(
      1,
      96,
      expect.objectContaining({
        score_breakdown: {
          relevance: 12,
          quality: 11,
          engagement: 10,
          diversity: 9,
          clarity: 8,
          brandSearchVolume: 7,
          competitivePositioning: 6,
        },
      })
    )
  })

  it('falls back legacy C bucket to D/product_intent when model-anchor evidence is missing', async () => {
    keywordPoolFns.getAvailableBuckets.mockResolvedValueOnce(['D'])
    keywordPoolFns.getBucketInfo.mockReturnValueOnce({
      intent: '商品需求意图',
      intentEn: 'Product Intent',
      keywords: [
        {
          keyword: 'brandx cordless vacuum',
          searchVolume: 6200,
          competition: 'MEDIUM',
          competitionIndex: 28,
          matchType: 'PHRASE',
          source: 'KEYWORD_POOL',
        },
      ],
    })

    selectionFns.selectCreativeKeywords.mockImplementationOnce((input: any) => {
      expect(input.creativeType).toBe('product_intent')
      return {
        keywords: input.keywordsWithVolume.map((item: any) => item.keyword),
        keywordsWithVolume: input.keywordsWithVolume.map((item: any) => ({
          ...item,
          matchType: 'PHRASE',
        })),
        truncated: false,
      }
    })

    const req = new NextRequest('http://localhost/api/offers/96/creatives/generate-differentiated', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        buckets: ['C'],
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.creatives[0].bucket).toBe('D')
    expect(data.data.creatives[0].creative.creativeType).toBe('product_intent')
    expect(generatorFns.createAdCreative).toHaveBeenCalledWith(
      1,
      96,
      expect.objectContaining({
        keyword_bucket: 'D',
        creative_type: 'product_intent',
      })
    )
  })

  it('accepts legacy creativeType input and maps to canonical bucket D', async () => {
    keywordPoolFns.getAvailableBuckets.mockResolvedValueOnce(['D'])
    keywordPoolFns.getBucketInfo.mockReturnValueOnce({
      intent: '商品需求意图',
      intentEn: 'Product Intent',
      keywords: [
        {
          keyword: 'brandx cordless vacuum',
          searchVolume: 6200,
          competition: 'MEDIUM',
          competitionIndex: 28,
          matchType: 'PHRASE',
          source: 'KEYWORD_POOL',
        },
      ],
    })

    const req = new NextRequest('http://localhost/api/offers/96/creatives/generate-differentiated', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        creativeType: 'brand_product',
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.creatives[0].bucket).toBe('D')
    expect(data.data.creatives[0].creative.creativeType).toBe('product_intent')
  })

  it('rejects inconsistent creativeType and buckets payloads', async () => {
    keywordPoolFns.getAvailableBuckets.mockResolvedValueOnce(['B', 'D'])

    const req = new NextRequest('http://localhost/api/offers/96/creatives/generate-differentiated', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        buckets: ['B'],
        creativeType: 'product_intent',
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.success).toBe(false)
    expect(data.error).toContain('creativeType 与 buckets 不一致')
  })

  it('returns 422 and skips persistence when hard persistence gate fails', async () => {
    process.env.AD_CREATIVE_HARD_PERSISTENCE_GATE_ENABLED = '1'

    const req = new NextRequest('http://localhost/api/offers/96/creatives/generate-differentiated', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        buckets: ['B'],
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(422)
    expect(data.success).toBe(false)
    expect(data.error).toEqual(expect.objectContaining({
      code: 'CREATIVE_PERSISTENCE_GATE_FAILED',
    }))
    expect(data.data.creatives[0]).toEqual(expect.objectContaining({
      bucket: 'B',
      success: false,
      errorCode: 'CREATIVE_PERSISTENCE_GATE_FAILED',
    }))
    expect(generatorFns.createAdCreative).not.toHaveBeenCalled()
  })

  it('returns 422 and skips persistence when hard quality gate still fails after one retry', async () => {
    qualityLoopFns.runCreativeGenerationQualityLoop.mockResolvedValue({
      selectedCreative: {
        headlines: ['BrandX X200 Vacuum', 'Buy BrandX X200', 'X200 Robot Vacuum'],
        descriptions: ['Deep clean with X200.', 'Shop verified BrandX model.'],
        keywords: ['brandx x200 vacuum'],
        theme: '商品型号/产品族意图 - Model Intent',
        ai_model: 'gemini-test',
      },
      selectedEvaluation: {
        passed: false,
        reasons: ['score_below_threshold'],
        failureType: 'ad_strength_score',
        adStrength: {
          finalRating: 'AVERAGE',
          finalScore: 61,
          localEvaluation: {
            dimensions: {
              relevance: { score: 9 },
              quality: { score: 8 },
              completeness: { score: 7 },
              diversity: { score: 7 },
              compliance: { score: 8 },
              brandSearchVolume: { score: 7 },
              competitivePositioning: { score: 6 },
            },
          },
          combinedSuggestions: ['Improve headlines'],
        },
      },
      attempts: 2,
      history: [],
    })

    const req = new NextRequest('http://localhost/api/offers/96/creatives/generate-differentiated', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        buckets: ['B'],
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(422)
    expect(data.success).toBe(false)
    expect(data.error).toEqual(expect.objectContaining({
      code: 'CREATIVE_QUALITY_GATE_FAILED',
    }))
    expect(qualityLoopFns.runCreativeGenerationQualityLoop).toHaveBeenCalledTimes(2)
    expect(generatorFns.createAdCreative).not.toHaveBeenCalled()
  })

  it('retries once with refreshed keyword set when hard gate fails and succeeds on second pass', async () => {
    qualityLoopFns.runCreativeGenerationQualityLoop
      .mockResolvedValueOnce({
        selectedCreative: {
          headlines: ['BrandX X200 Vacuum', 'Buy BrandX X200', 'X200 Robot Vacuum'],
          descriptions: ['Deep clean with X200.', 'Shop verified BrandX model.'],
          keywords: ['brandx x200 vacuum'],
          theme: '商品型号/产品族意图 - Model Intent',
          ai_model: 'gemini-test',
        },
        selectedEvaluation: {
          passed: false,
          reasons: ['score_below_threshold'],
          failureType: 'ad_strength_score',
          adStrength: {
            finalRating: 'AVERAGE',
            finalScore: 62,
            localEvaluation: {
              dimensions: {
                relevance: { score: 9 },
                quality: { score: 8 },
                completeness: { score: 7 },
                diversity: { score: 7 },
                compliance: { score: 8 },
                brandSearchVolume: { score: 7 },
                competitivePositioning: { score: 6 },
              },
            },
            combinedSuggestions: ['Improve headlines'],
          },
        },
        attempts: 2,
        history: [],
      })
      .mockResolvedValueOnce({
        selectedCreative: {
          headlines: ['BrandX X200 Vacuum', 'Official BrandX X200', 'X200 Robot Vacuum'],
          descriptions: ['Deep clean with X200.', 'Shop verified BrandX model.'],
          keywords: ['brandx x200 vacuum'],
          theme: '商品型号/产品族意图 - Model Intent',
          ai_model: 'gemini-test',
        },
        selectedEvaluation: {
          passed: true,
          reasons: [],
          failureType: null,
          adStrength: {
            finalRating: 'GOOD',
            finalScore: 82,
            localEvaluation: {
              dimensions: {
                relevance: { score: 12 },
                quality: { score: 11 },
                completeness: { score: 10 },
                diversity: { score: 9 },
                compliance: { score: 8 },
                brandSearchVolume: { score: 7 },
                competitivePositioning: { score: 6 },
              },
            },
            combinedSuggestions: [],
          },
        },
        attempts: 1,
        history: [],
      })

    const req = new NextRequest('http://localhost/api/offers/96/creatives/generate-differentiated', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': '1',
      },
      body: JSON.stringify({
        buckets: ['B'],
      }),
    })

    const res = await POST(req, { params: { id: '96' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(qualityLoopFns.runCreativeGenerationQualityLoop).toHaveBeenCalledTimes(2)
    expect(generatorFns.createAdCreative).toHaveBeenCalledTimes(1)
  })
})
