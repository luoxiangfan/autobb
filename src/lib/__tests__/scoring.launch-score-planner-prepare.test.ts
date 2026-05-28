import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const generateContentMock = vi.fn()
const loadKeywordPoolExpandMock = vi.fn()

vi.mock('../gemini', () => ({
  generateContent: generateContentMock,
}))

vi.mock('../ai-token-tracker', () => ({
  recordTokenUsage: vi.fn(),
  estimateTokenCost: vi.fn(() => 0.01),
}))

vi.mock('../google-ads-accounts-auth', () => ({
  loadKeywordPoolExpandCredentialsForOffer: loadKeywordPoolExpandMock,
}))

vi.mock('../ad-strength-evaluator', () => ({
  evaluateAdStrength: vi.fn().mockResolvedValue({
    rating: 'GOOD',
    overallScore: 80,
    dimensions: {},
    suggestions: [],
  }),
}))

function buildLaunchScoreAiPayload() {
  return {
    launchViability: {
      score: 35,
      brandSearchVolume: 1200,
      brandSearchScore: 12,
      profitMargin: 0,
      profitScore: 0,
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
      budgetScore: 0,
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
    const { calculateLaunchScore } = await import('../scoring')

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
  })

  it('prepares keyword pool expand only when ad_strength must be evaluated', async () => {
    const { calculateLaunchScore } = await import('../scoring')

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
  })
})
