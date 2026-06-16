import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const generateContentMock = vi.fn()
const loadKeywordPoolExpandMock = vi.fn()
const loadPromptMock = vi.hoisted(() => vi.fn())

vi.mock('../ai/ai', () => ({
  generateContent: generateContentMock,
}))

vi.mock('../ai/ai', () => ({
  loadPrompt: loadPromptMock,
  interpolateTemplate: (template: string) => template,
}))

vi.mock('../ai-token-tracker', () => ({
  recordTokenUsage: vi.fn(),
  estimateTokenCost: vi.fn(() => 0.01),
}))

vi.mock('@/lib/google-ads/accounts/auth/index', () => ({
  loadKeywordPoolExpandCredentialsForOffer: loadKeywordPoolExpandMock,
}))

const evaluateAdStrengthMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    rating: 'GOOD',
    overallScore: 80,
    dimensions: {},
    suggestions: [],
  })
)

vi.mock('../creatives/strength/evaluate', () => ({
  evaluateAdStrength: evaluateAdStrengthMock,
}))

function buildLaunchScoreAiPayload() {
  return {
    launchViability: {
      score: 35,
      brandSearchVolume: 1200,
      brandSearchScore: 12,
      profitMargin: 0,
      competitionLevel: 'LOW',
      competitionScore: 13,
      marketPotentialScore: 10,
      issues: [],
      suggestions: [],
    },
    adQuality: {
      score: 25,
      adStrength: 'GOOD',
      adStrengthScore: 12,
      headlineDiversity: 80,
      headlineDiversityScore: 7,
      descriptionQuality: 85,
      descriptionQualityScore: 6,
      issues: [],
      suggestions: [],
    },
    keywordStrategy: {
      score: 16,
      relevanceScore: 7,
      matchTypeScore: 5,
      negativeKeywordsScore: 4,
      totalKeywords: 3,
      negativeKeywordsCount: 2,
      matchTypeDistribution: { EXACT: 1, PHRASE: 2 },
      issues: [],
      suggestions: [],
    },
    basicConfig: {
      score: 9,
      countryLanguageScore: 5,
      finalUrlScore: 4,
      targetCountry: 'US',
      targetLanguage: 'English',
      finalUrl: 'https://www.amazon.com/acme-brand',
      dailyBudget: 20,
      maxCpc: 0.5,
      issues: [],
      suggestions: [],
    },
    overallRecommendations: [],
  }
}

describe('calculateLaunchScore planner prepare', () => {
  beforeEach(() => {
    vi.resetModules()
    generateContentMock.mockReset()
    loadKeywordPoolExpandMock.mockReset()
    loadPromptMock.mockReset()
    loadPromptMock.mockResolvedValue(
      'launch_score test template with marketPotentialScore and {{brand}}'
    )
    evaluateAdStrengthMock.mockReset()
    evaluateAdStrengthMock.mockResolvedValue({
      rating: 'GOOD',
      overallScore: 80,
      dimensions: {},
      suggestions: [],
    })
    generateContentMock.mockResolvedValue({
      text: JSON.stringify(buildLaunchScoreAiPayload()),
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      model: 'gemini-test',
      apiType: 'direct-api',
    })
    loadKeywordPoolExpandMock.mockResolvedValue({
      ok: true,
      plannerSession: { volumeAuth: { authType: 'oauth' } },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('skips keyword pool expand prepare when creative already has ad_strength', async () => {
    const { calculateLaunchScore } = await import('../launch-score/server')

    await calculateLaunchScore(
      {
        id: 1,
        brand: 'AcmeBrand',
        target_country: 'US',
        target_language: 'English',
        url: 'https://www.amazon.com/acme-brand',
        final_url: 'https://www.amazon.com/acme-brand',
        page_type: 'product',
      } as any,
      {
        headlines: ['One', 'Two', 'Three'],
        descriptions: ['Desc one', 'Desc two'],
        keywords: ['acme filter'],
        ad_strength: 'EXCELLENT',
      } as any,
      9
    )

    expect(loadKeywordPoolExpandMock).not.toHaveBeenCalled()
    expect(loadPromptMock).toHaveBeenCalledTimes(1)
  })

  it('prepares keyword pool expand only when ad_strength must be evaluated', async () => {
    const { calculateLaunchScore } = await import('../launch-score/server')

    await calculateLaunchScore(
      {
        id: 7,
        brand: 'AcmeBrand',
        target_country: 'US',
        target_language: 'English',
        url: 'https://www.amazon.com/acme-brand',
        final_url: 'https://www.amazon.com/acme-brand',
        page_type: 'product',
      } as any,
      {
        headlines: ['One', 'Two', 'Three'],
        descriptions: ['Desc one', 'Desc two'],
        keywords: ['acme filter'],
        keywordsWithVolume: [{ keyword: 'acme filter', searchVolume: 100 }],
      } as any,
      9
    )

    expect(loadKeywordPoolExpandMock).toHaveBeenCalledTimes(1)
    expect(loadKeywordPoolExpandMock).toHaveBeenCalledWith(9, 7)
    expect(loadPromptMock).toHaveBeenCalledTimes(1)
  })

  it('calculateLaunchScoresForCreatives prepares expand once for multiple creatives', async () => {
    const { calculateLaunchScoresForCreatives } = await import('../launch-score/server')
    loadKeywordPoolExpandMock.mockClear()
    loadPromptMock.mockClear()

    const offer = {
      id: 7,
      brand: 'AcmeBrand',
      target_country: 'US',
      target_language: 'English',
      url: 'https://www.amazon.com/acme-brand',
      final_url: 'https://www.amazon.com/acme-brand',
      page_type: 'product',
    } as any
    const creativeBase = {
      headlines: ['One', 'Two', 'Three'],
      descriptions: ['Desc one', 'Desc two'],
      keywords: ['acme filter'],
      ad_strength: 'EXCELLENT',
    }

    await calculateLaunchScoresForCreatives(
      offer,
      [{ ...creativeBase, id: 1 } as any, { ...creativeBase, id: 2 } as any],
      9
    )

    expect(loadKeywordPoolExpandMock).toHaveBeenCalledTimes(1)
    expect(loadKeywordPoolExpandMock).toHaveBeenCalledWith(9, 7)
  })

  it('reuses adStrengthPlanner from campaignConfig without calling expand again', async () => {
    const { calculateLaunchScore } = await import('../launch-score/server')

    const prepared = {
      plannerSession: { volumeAuth: { authType: 'oauth' } },
      skipKeywordPoolExpandLoad: false,
    }
    loadKeywordPoolExpandMock.mockClear()

    await calculateLaunchScore(
      {
        id: 7,
        brand: 'AcmeBrand',
        target_country: 'US',
        target_language: 'English',
        url: 'https://www.amazon.com/acme-brand',
        final_url: 'https://www.amazon.com/acme-brand',
        page_type: 'product',
      } as any,
      {
        headlines: ['One', 'Two', 'Three'],
        descriptions: ['Desc one', 'Desc two'],
        keywords: ['acme filter'],
      } as any,
      9,
      { adStrengthPlanner: prepared }
    )

    expect(loadKeywordPoolExpandMock).not.toHaveBeenCalled()
  })

  it('passes skipKeywordPoolExpandLoad when expand prepare fails', async () => {
    loadKeywordPoolExpandMock.mockResolvedValueOnce({ ok: false })
    evaluateAdStrengthMock.mockClear()

    const { calculateLaunchScore } = await import('../launch-score/server')

    await calculateLaunchScore(
      {
        id: 7,
        brand: 'AcmeBrand',
        target_country: 'US',
        target_language: 'English',
        url: 'https://www.amazon.com/acme-brand',
        final_url: 'https://www.amazon.com/acme-brand',
        page_type: 'product',
      } as any,
      {
        headlines: ['One', 'Two', 'Three'],
        descriptions: ['Desc one', 'Desc two'],
        keywords: ['acme filter'],
      } as any,
      9
    )

    expect(evaluateAdStrengthMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      expect.any(Array),
      expect.objectContaining({
        offerId: 7,
        skipKeywordPoolExpandLoad: true,
      })
    )
  })
})
