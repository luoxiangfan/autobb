import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getKeywordSearchVolumes } from '@/lib/keywords/planner/keyword-planner'

let mockDb: any

const mockGetBatchCachedVolumes = vi.fn()

vi.mock('@/lib/db', () => ({
  getDatabase: () => mockDb,
  dateMinusDays: (days: number) => `CURRENT_DATE - INTERVAL '${days} days'`,
}))

vi.mock('@/lib/common/server', () => ({
  getCachedKeywordVolume: vi.fn(),
  cacheKeywordVolume: vi.fn(),
  getBatchCachedVolumes: (...args: any[]) => mockGetBatchCachedVolumes(...args),
  batchCacheVolumes: vi.fn(),
  normalizeCountryCode: (country: string) =>
    String(country || 'US')
      .trim()
      .toUpperCase(),
  normalizeLanguageCode: (language: string) =>
    String(language || 'en')
      .trim()
      .toLowerCase(),
  getGoogleAdsLanguageIdString: () => '1000',
  getGoogleAdsGeoTargetId: () => '2840',
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
  },
}))

vi.mock('@/lib/google-ads/auth/context', () => ({
  getGoogleAdsAuthContext: vi.fn(),
  resolveGoogleAdsAuthReadyFailure: vi.fn(() => null),
  resolveConfiguredGoogleAdsAuthType: vi.fn(() => 'oauth'),
}))

vi.mock('@/lib/google-ads/auth/assignment', () => ({
  resolveGoogleAdsApiAccessLevel: vi.fn(async () => null),
}))

vi.mock('@/lib/google-ads/oauth/oauth', () => ({
  refreshAccessToken: vi.fn(),
}))

vi.mock('@/lib/google-ads/api/tracker', () => ({
  trackApiUsage: vi.fn(),
  ApiOperationType: { GET_KEYWORD_IDEAS: 'GET_KEYWORD_IDEAS' },
}))

vi.mock('@/lib/google-ads/service-account/service-account', () => ({
  getServiceAccountConfig: vi.fn(),
}))

vi.mock('@/lib/google-ads/api/api', () => ({
  getGoogleAdsClient: vi.fn(),
}))

vi.mock('@/lib/google-ads/keyword/keyword-plan-idea-service', () => ({
  getKeywordPlanIdeaService: vi.fn(),
}))

describe('KeywordPlanner DB cache cutoff', () => {
  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
      queryOne: vi.fn(),
      exec: vi.fn(),
      close: vi.fn(),
    }
    mockGetBatchCachedVolumes.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('uses timestamp-compatible cutoff for postgres global_keywords.created_at', async () => {
    mockGetBatchCachedVolumes.mockResolvedValue(new Map())
    mockDb.query.mockResolvedValue([
      {
        keyword: 'test',
        search_volume: 123,
        competition_level: 'LOW',
        avg_cpc_micros: 1_000_000,
      },
    ])

    const out = await getKeywordSearchVolumes(['test'], 'US', 'en')
    expect(out[0]?.avgMonthlySearches).toBe(123)

    expect(mockDb.query).toHaveBeenCalledTimes(1)
    const [sql] = mockDb.query.mock.calls[0]
    expect(String(sql)).toContain("created_at > CURRENT_DATE - INTERVAL '7 days'")
    expect(String(sql)).not.toContain("date('now'")
    expect(String(sql)).not.toContain('to_char(')
  })
})
