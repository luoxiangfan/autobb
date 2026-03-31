import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let mockDb: any
let getKeywordSearchVolumes: typeof import('../keyword-planner').getKeywordSearchVolumes

const mockGetBatchCachedVolumes = vi.fn()
const mockBatchCacheVolumes = vi.fn()
const mockGenerateKeywordHistoricalMetrics = vi.fn()

vi.mock('../db', () => ({
  getDatabase: () => mockDb,
}))

vi.mock('../redis', () => ({
  getCachedKeywordVolume: vi.fn(),
  cacheKeywordVolume: vi.fn(),
  getBatchCachedVolumes: (...args: any[]) => mockGetBatchCachedVolumes(...args),
  batchCacheVolumes: (...args: any[]) => mockBatchCacheVolumes(...args),
}))

vi.mock('../google-ads-oauth', () => ({
  refreshAccessToken: vi.fn().mockResolvedValue(undefined),
  getGoogleAdsCredentials: vi.fn().mockResolvedValue({
    refresh_token: 'rt',
    login_customer_id: '123',
  }),
}))

vi.mock('../google-ads-api-tracker', () => ({
  trackApiUsage: vi.fn(),
  ApiOperationType: { GET_KEYWORD_IDEAS: 'GET_KEYWORD_IDEAS' },
}))

vi.mock('../google-ads-service-account', () => ({
  getServiceAccountConfig: vi.fn(),
}))

vi.mock('../google-ads-api', () => ({
  GoogleAdsApi: vi.fn(),
  enums: { KeywordPlanNetwork: { GOOGLE_SEARCH: 2 } },
  getCustomerWithCredentials: vi.fn(),
  getGoogleAdsClient: () => ({
    Customer: () => ({
      keywordPlanIdeas: {
        generateKeywordHistoricalMetrics: (...args: any[]) => mockGenerateKeywordHistoricalMetrics(...args),
      },
      callMetadata: {},
    }),
  }),
}))

describe('KeywordPlanner developer token access handling', () => {
  beforeEach(() => {
    mockDb = {
      type: 'postgres',
      query: vi.fn(),
      queryOne: vi.fn(),
      exec: vi.fn(),
      close: vi.fn(),
    }
  })

  beforeEach(async () => {
    vi.resetModules()
    mockGetBatchCachedVolumes.mockReset()
    mockBatchCacheVolumes.mockReset()
    mockGenerateKeywordHistoricalMetrics.mockReset()
    ;({ getKeywordSearchVolumes } = await import('../keyword-planner'))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns volumeUnavailableReason and skips caching when developer token is test-only', async () => {
    mockGetBatchCachedVolumes.mockResolvedValue(new Map())
    mockDb.query.mockImplementation((sql: string) => {
      const s = String(sql)
      if (s.includes('FROM system_settings')) {
        return [
          { key: 'client_id', value: 'cid', encrypted_value: null },
          { key: 'client_secret', value: 'secret', encrypted_value: null },
          { key: 'developer_token', value: 'dt', encrypted_value: null },
        ]
      }
      if (s.includes('FROM global_keywords')) return []
      return []
    })

    mockGenerateKeywordHistoricalMetrics.mockRejectedValue({
      errors: [
        {
          message:
            'The developer token is only approved for use with test accounts. To access non-test accounts, apply for Basic or Standard access.',
        },
      ],
    })

    const out = await getKeywordSearchVolumes(['k1', 'k2'], 'US', 'en', 1)

    expect(out).toHaveLength(2)
    expect(out.every((v: any) => v.avgMonthlySearches === 0)).toBe(true)
    expect(out.every((v: any) => v.volumeUnavailableReason === 'DEV_TOKEN_INSUFFICIENT_ACCESS')).toBe(true)

    expect(mockGenerateKeywordHistoricalMetrics).toHaveBeenCalledTimes(1)
    expect(mockBatchCacheVolumes).not.toHaveBeenCalled()
    expect(mockDb.exec).not.toHaveBeenCalled()
  })

  it('keeps existing positive global volume when incoming API volume is zero', async () => {
    mockGetBatchCachedVolumes.mockResolvedValue(new Map())
    mockDb.query.mockImplementation((sql: string) => {
      const s = String(sql)
      if (s.includes('FROM system_settings')) {
        return [
          { key: 'client_id', value: 'cid', encrypted_value: null },
          { key: 'client_secret', value: 'secret', encrypted_value: null },
          { key: 'developer_token', value: 'dt', encrypted_value: null },
        ]
      }
      if (s.includes('FROM global_keywords')) return []
      return []
    })
    mockDb.queryOne.mockResolvedValue({ api_access_level: 'basic' })
    mockGenerateKeywordHistoricalMetrics.mockResolvedValue({
      results: [
        {
          text: 'novilla',
          keyword_metrics: {
            avg_monthly_searches: 0,
            competition: 'LOW',
            competition_index: 18,
            low_top_of_page_bid_micros: 80000,
            high_top_of_page_bid_micros: 120000,
          },
        },
      ],
    })

    const out = await getKeywordSearchVolumes(['novilla'], 'US', 'en', 1)

    expect(out).toHaveLength(1)
    expect(out[0]?.avgMonthlySearches).toBe(0)
    expect(mockGenerateKeywordHistoricalMetrics).toHaveBeenCalledTimes(1)
    expect(mockDb.exec).toHaveBeenCalledTimes(1)

    const [sql] = mockDb.exec.mock.calls[0]
    const normalizedSql = String(sql).replace(/\s+/g, ' ')
    expect(normalizedSql).toContain('WHEN excluded.search_volume > 0 THEN excluded.search_volume')
    expect(normalizedSql).toContain('WHEN COALESCE(global_keywords.search_volume, 0) > 0 THEN global_keywords.search_volume')
  })

  it('allows keyword planner metrics query when developer token access level is standard', async () => {
    mockGetBatchCachedVolumes.mockResolvedValue(new Map())
    mockDb.query.mockImplementation((sql: string) => {
      const s = String(sql)
      if (s.includes('FROM system_settings')) {
        return [
          { key: 'client_id', value: 'cid', encrypted_value: null },
          { key: 'client_secret', value: 'secret', encrypted_value: null },
          { key: 'developer_token', value: 'dt', encrypted_value: null },
        ]
      }
      if (s.includes('FROM global_keywords')) return []
      return []
    })
    mockDb.queryOne.mockResolvedValue({ api_access_level: 'standard' })
    mockGenerateKeywordHistoricalMetrics.mockResolvedValue({
      results: [
        {
          text: 'k1',
          keyword_metrics: {
            avg_monthly_searches: 1234,
            competition: 'LOW',
            competition_index: 22,
            low_top_of_page_bid_micros: 100000,
            high_top_of_page_bid_micros: 300000,
          },
        },
      ],
    })

    const out = await getKeywordSearchVolumes(['k1'], 'US', 'en', 1)

    expect(mockGenerateKeywordHistoricalMetrics).toHaveBeenCalledTimes(1)
    expect(out).toHaveLength(1)
    expect(out[0]?.avgMonthlySearches).toBe(1234)
    expect(out[0]?.volumeUnavailableReason).toBeUndefined()
    expect(mockBatchCacheVolumes).toHaveBeenCalledTimes(1)
  })

  it('still probes historical metrics when stored access level is explorer and returns real volumes on success', async () => {
    mockGetBatchCachedVolumes.mockResolvedValue(new Map())
    mockDb.query.mockImplementation((sql: string) => {
      const s = String(sql)
      if (s.includes('FROM system_settings')) {
        return [
          { key: 'client_id', value: 'cid', encrypted_value: null },
          { key: 'client_secret', value: 'secret', encrypted_value: null },
          { key: 'developer_token', value: 'dt', encrypted_value: null },
        ]
      }
      if (s.includes('FROM global_keywords')) return []
      return []
    })
    mockDb.queryOne.mockResolvedValue({ api_access_level: 'explorer' })
    mockGenerateKeywordHistoricalMetrics.mockResolvedValue({
      results: [
        {
          text: 'cosori warranty',
          keyword_metrics: {
            avg_monthly_searches: 5400,
            competition: 'HIGH',
            competition_index: 68,
            low_top_of_page_bid_micros: 1200000,
            high_top_of_page_bid_micros: 2300000,
          },
        },
      ],
    })

    const out = await getKeywordSearchVolumes(['cosori warranty'], 'US', 'en', 1)

    expect(mockGenerateKeywordHistoricalMetrics).toHaveBeenCalledTimes(1)
    expect(out).toHaveLength(1)
    expect(out[0]?.avgMonthlySearches).toBe(5400)
    expect(out[0]?.volumeUnavailableReason).toBeUndefined()
    expect(mockBatchCacheVolumes).toHaveBeenCalledTimes(1)
  })
})
