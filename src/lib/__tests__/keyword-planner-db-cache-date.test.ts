import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let mockDb: any
let getKeywordSearchVolumes: typeof import('../keyword-planner').getKeywordSearchVolumes

const mockGetBatchCachedVolumes = vi.fn()

vi.mock('../db', () => ({
  getDatabase: () => mockDb,
}))

vi.mock('../redis', () => ({
  getCachedKeywordVolume: vi.fn(),
  cacheKeywordVolume: vi.fn(),
  getBatchCachedVolumes: (...args: any[]) => mockGetBatchCachedVolumes(...args),
  batchCacheVolumes: vi.fn(),
}))

describe('KeywordPlanner DB cache cutoff', () => {
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
    ;({ getKeywordSearchVolumes } = await import('../keyword-planner'))
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

