import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
  getDatabase: vi.fn(),
  queryActiveCampaigns: vi.fn(),
  getGoogleAdsCredentials: vi.fn(),
  findCachedLaunchScore: vi.fn(),
  parseLaunchScoreAnalysis: vi.fn(),
  computeContentHash: vi.fn(),
  computeCampaignConfigHash: vi.fn(),
  getOrCreateQueueManager: vi.fn(),
  queueEnqueue: vi.fn(),
  invalidateOfferCache: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: mocks.verifyAuth,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: mocks.getDatabase,
}))

vi.mock('@/lib/active-campaigns-query', () => ({
  queryActiveCampaigns: mocks.queryActiveCampaigns,
}))

vi.mock('@/lib/google-ads-oauth', () => ({
  getGoogleAdsCredentials: mocks.getGoogleAdsCredentials,
}))

vi.mock('@/lib/launch-scores', () => ({
  createLaunchScore: vi.fn(),
  findCachedLaunchScore: mocks.findCachedLaunchScore,
  computeContentHash: mocks.computeContentHash,
  computeCampaignConfigHash: mocks.computeCampaignConfigHash,
  parseLaunchScoreAnalysis: mocks.parseLaunchScoreAnalysis,
}))

vi.mock('@/lib/queue/init-queue', () => ({
  getOrCreateQueueManager: mocks.getOrCreateQueueManager,
}))

vi.mock('@/lib/api-cache', () => ({
  invalidateOfferCache: mocks.invalidateOfferCache,
}))

import { POST } from '@/app/api/campaigns/publish/route'

function createMockDb() {
  let insertedCampaignConfig: any = null
  const db = {
    type: 'sqlite' as const,
    queryOne: vi.fn(async (sql: string) => {
      if (sql.includes('FROM offers')) {
        return {
          id: 11,
          url: 'https://offer.example.com',
          final_url: 'https://offer.example.com/final',
          final_url_suffix: 'offer_suffix=1',
          brand: 'BrandA',
          target_country: 'US',
          target_language: 'en',
          scrape_status: 'completed',
          category: 'test',
          offer_name: 'Offer 11',
        }
      }

      if (sql.includes('FROM ad_creatives')) {
        return {
          id: 22,
          headlines: JSON.stringify(['h1']),
          descriptions: JSON.stringify(['d1']),
          keywords: JSON.stringify(['kw1']),
          negative_keywords: JSON.stringify([]),
          callouts: JSON.stringify([]),
          sitelinks: JSON.stringify([]),
          final_url: 'https://creative.example.com/pdp',
          final_url_suffix: 'creative_suffix=1',
          is_selected: 1,
          keywords_with_volume: JSON.stringify([]),
          theme: 'default',
          path_1: '',
          path_2: '',
        }
      }

      if (sql.includes('FROM google_ads_accounts')) {
        return {
          id: 33,
          customer_id: '1234567890',
          parent_mcc_id: '9681914021',
          is_active: 1,
          status: 'ENABLED',
        }
      }

      if (sql.includes('FROM google_ads_service_accounts')) {
        return null
      }

      return null
    }),
    exec: vi.fn(async (sql: string, params: any[]) => {
      if (sql.includes('INSERT INTO campaigns')) {
        insertedCampaignConfig = JSON.parse(String(params[8] || '{}'))
        return { changes: 1, lastInsertRowid: 1970 }
      }
      return { changes: 1, lastInsertRowid: 1 }
    }),
  }

  return {
    db,
    getInsertedCampaignConfig: () => insertedCampaignConfig,
  }
}

describe('POST /api/campaigns/publish URL alignment', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 7 },
    })

    mocks.queryActiveCampaigns.mockResolvedValue({
      ownCampaigns: [],
      manualCampaigns: [],
      otherCampaigns: [],
      total: { enabled: 0, own: 0, manual: 0, other: 0 },
    })

    mocks.getGoogleAdsCredentials.mockResolvedValue({
      refresh_token: 'refresh-token',
    })

    mocks.findCachedLaunchScore.mockResolvedValue({
      id: 1,
      totalScore: 90,
    })

    mocks.parseLaunchScoreAnalysis.mockReturnValue({
      launchViability: {
        score: 35,
        brandSearchScore: 12,
        brandSearchVolume: 1200,
        competitionScore: 13,
        competitionLevel: 'MEDIUM',
        marketPotentialScore: 10,
        issues: [],
        suggestions: [],
      },
      adQuality: {
        score: 28,
        adStrengthScore: 14,
        adStrength: 'GOOD',
        headlineDiversityScore: 7,
        headlineDiversity: 82,
        descriptionQualityScore: 7,
        issues: [],
        suggestions: [],
      },
      keywordStrategy: {
        score: 18,
        relevanceScore: 7,
        matchTypeScore: 5,
        negativeKeywordsScore: 6,
        issues: [],
        suggestions: [],
      },
      basicConfig: {
        score: 9,
        countryLanguageScore: 4,
        finalUrlScore: 5,
        issues: [],
        suggestions: [],
      },
      overallRecommendations: [],
    })

    mocks.computeContentHash.mockReturnValue('content-hash')
    mocks.computeCampaignConfigHash.mockReturnValue('config-hash')
    mocks.queueEnqueue.mockResolvedValue(undefined)
    mocks.getOrCreateQueueManager.mockResolvedValue({
      enqueue: mocks.queueEnqueue,
    })
  })

  it('returns 422 when explicit finalUrls/finalUrlSuffix violate ownership', async () => {
    const { db, getInsertedCampaignConfig } = createMockDb()
    mocks.getDatabase.mockResolvedValue(db)

    const req = new NextRequest('http://localhost/api/campaigns/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        offerId: 11,
        adCreativeId: 22,
        googleAdsAccountId: 33,
        pauseOldCampaigns: false,
        campaignConfig: {
          campaignName: 'BrandA-US-20260217',
          adGroupName: 'BrandA-US-11-22',
          budgetAmount: 20,
          budgetType: 'DAILY',
          targetCountry: 'US',
          targetLanguage: 'en',
          biddingStrategy: 'MAXIMIZE_CLICKS',
          maxCpcBid: 1,
          finalUrls: ['https://pboost.me/demo'],
          finalUrlSuffix: 'src=pboost',
          keywords: ['kw1'],
          negativeKeywords: [],
        },
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(422)
    expect(data.action).toBe('CAMPAIGN_CONFIG_FIELD_OWNERSHIP_VIOLATION')
    expect(data.details.fields).toContain('finalUrls')
    expect(data.details.finalUrls).toMatchObject({
      input: 'https://pboost.me/demo',
      expected: 'https://creative.example.com/pdp',
    })
    expect(getInsertedCampaignConfig()).toBeNull()
    expect(mocks.queueEnqueue).not.toHaveBeenCalled()
    expect(mocks.invalidateOfferCache).not.toHaveBeenCalled()
  })

  it('uses creative URL source when request does not override ownership fields', async () => {
    const { db, getInsertedCampaignConfig } = createMockDb()
    mocks.getDatabase.mockResolvedValue(db)

    const req = new NextRequest('http://localhost/api/campaigns/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        offerId: 11,
        adCreativeId: 22,
        googleAdsAccountId: 33,
        pauseOldCampaigns: false,
        campaignConfig: {
          campaignName: 'BrandA-US-20260217',
          adGroupName: 'BrandA-US-11-22',
          budgetAmount: 20,
          budgetType: 'DAILY',
          targetCountry: 'US',
          targetLanguage: 'en',
          biddingStrategy: 'MAXIMIZE_CLICKS',
          maxCpcBid: 1,
          keywords: ['kw1'],
          negativeKeywords: [],
        },
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(202)
    expect(data.success).toBe(true)
    expect(getInsertedCampaignConfig()).toMatchObject({
      finalUrls: ['https://creative.example.com/pdp'],
      finalUrlSuffix: 'creative_suffix=1',
    })
    expect(mocks.queueEnqueue).toHaveBeenCalledWith(
      'campaign-publish',
      expect.objectContaining({
        creative: expect.objectContaining({
          finalUrl: 'https://creative.example.com/pdp',
          finalUrlSuffix: 'creative_suffix=1',
        }),
      }),
      7,
      expect.any(Object)
    )
    expect(mocks.invalidateOfferCache).toHaveBeenCalledWith(7, 11)
  })
})
