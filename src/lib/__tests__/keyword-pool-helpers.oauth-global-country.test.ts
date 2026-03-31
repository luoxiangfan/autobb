import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoolKeywordData } from '../offer-keyword-pool'

let mockDb: any
const mockExpandKeywordsWithSeeds = vi.fn()
const mockGetKeywordSearchVolumes = vi.fn()

vi.mock('../db', () => ({
  getDatabase: () => mockDb,
}))

vi.mock('../unified-keyword-service', () => ({
  expandKeywordsWithSeeds: (...args: any[]) => mockExpandKeywordsWithSeeds(...args),
}))

vi.mock('../keyword-planner', () => ({
  getKeywordSearchVolumes: (...args: any[]) => mockGetKeywordSearchVolumes(...args),
}))

vi.mock('../google-trends', () => ({
  getTrendsKeywords: vi.fn(async () => []),
}))

vi.mock('../google-suggestions', () => ({
  detectCountryInKeyword: vi.fn(() => []),
  filterLowIntentKeywords: vi.fn((keywords: string[]) => keywords),
  filterMismatchedGeoKeywords: vi.fn((keywords: string[]) => keywords),
  getBrandSearchSuggestions: vi.fn(async () => []),
}))

// Avoid native bcrypt binary issues in some test runners.
vi.mock('bcrypt', () => {
  const stub = {
    hash: async () => 'stub-hash',
    compare: async () => true,
  }
  return { default: stub, ...stub }
})

describe('keyword-pool-helpers.expandAllKeywords (OAuth global candidates)', () => {
  beforeEach(() => {
    vi.resetModules()
    mockExpandKeywordsWithSeeds.mockReset()
    mockGetKeywordSearchVolumes.mockReset()

    mockExpandKeywordsWithSeeds.mockResolvedValue([])
    mockGetKeywordSearchVolumes.mockResolvedValue([])

    mockDb = {
      type: 'postgres',
      queryOne: vi.fn(),
      exec: vi.fn(),
      close: vi.fn(),
      query: vi.fn(async (_sql: string, params: any[]) => {
        const hasGb = params.includes('GB')
        const hasUk = params.includes('UK')
        const hasEn = params.includes('en')
        const hasEnglish = params.includes('English')
        if (hasGb && hasUk && (hasEn || hasEnglish)) {
          return [
            {
              keyword: 'hoover vacuum cleaner',
              search_volume: 12100,
              competition_level: 'HIGH',
              avg_cpc_micros: 1200000,
            },
            {
              keyword: 'hoover amazon',
              search_volume: 1900,
              competition_level: 'MEDIUM',
              avg_cpc_micros: 800000,
            },
          ]
        }
        const hasDeCountry = params.includes('DE')
        const hasDe = params.includes('de')
        const hasGerman = params.includes('German')
        if (hasDeCountry && hasDe && hasGerman) {
          return [
            {
              keyword: 'midea waschmaschine',
              search_volume: 2900,
              competition_level: 'MEDIUM',
              avg_cpc_micros: 900000,
            },
            {
              keyword: 'midea dryer',
              search_volume: 2400,
              competition_level: 'MEDIUM',
              avg_cpc_micros: 850000,
            },
            {
              keyword: 'midea comprar',
              search_volume: 1700,
              competition_level: 'MEDIUM',
              avg_cpc_micros: 810000,
            },
            {
              keyword: 'midea купить',
              search_volume: 1600,
              competition_level: 'MEDIUM',
              avg_cpc_micros: 800000,
            },
          ]
        }
        return []
      }),
    }
  })

  it('queries global_keywords with normalized country (GB) when targetCountry is UK', async () => {
    const { expandAllKeywords } = await import('../keyword-pool-helpers')
    const initial: PoolKeywordData[] = [{ keyword: 'hoover', searchVolume: 0, source: 'TEST', matchType: 'BROAD' }]

    const out = await expandAllKeywords(
      initial,
      'Hoover',
      'Vacuum Cleaner',
      'UK',
      'English',
      'oauth',
      undefined,
      51,
      '1234567890',
      'refresh-token'
    )

    expect(mockDb.query).toHaveBeenCalled()
    const [sql, params] = mockDb.query.mock.calls[0]
    expect(String(sql)).toContain('country IN (')
    expect(params).toEqual(expect.arrayContaining(['GB', 'UK', 'en']))
    expect(out.map(k => k.keyword)).toContain('hoover vacuum cleaner')
  })

  it('queries global_keywords with language aliases (de + German) for DE offers', async () => {
    const { expandAllKeywords } = await import('../keyword-pool-helpers')
    const initial: PoolKeywordData[] = [{ keyword: 'midea', searchVolume: 0, source: 'TEST', matchType: 'BROAD' }]

    const out = await expandAllKeywords(
      initial,
      'Midea',
      'Waschmaschinen',
      'DE',
      'German',
      'oauth',
      undefined,
      51,
      '1234567890',
      'refresh-token'
    )

    expect(mockDb.query).toHaveBeenCalled()
    const [sql, params] = mockDb.query.mock.calls[0]
    expect(String(sql)).toContain('language IN (')
    expect(params).toEqual(expect.arrayContaining(['DE', 'de', 'German']))
    expect(out.map(k => k.keyword)).toContain('midea waschmaschine')
    expect(out.map(k => k.keyword)).toContain('midea dryer')
    expect(out.map(k => k.keyword)).not.toContain('midea comprar')
    expect(out.map(k => k.keyword)).not.toContain('midea купить')
  })

  it('sets plannerDecision.volumeUnavailableFromPlanner when planner metrics are unavailable', async () => {
    mockGetKeywordSearchVolumes.mockResolvedValue([
      {
        keyword: 'hoover',
        avgMonthlySearches: 0,
        competition: 'UNKNOWN',
        competitionIndex: 0,
        lowTopPageBid: 0,
        highTopPageBid: 0,
        volumeUnavailableReason: 'DEV_TOKEN_INSUFFICIENT_ACCESS',
      },
    ])

    const { expandAllKeywords } = await import('../keyword-pool-helpers')
    const initial: PoolKeywordData[] = [{ keyword: 'hoover', searchVolume: 0, source: 'TEST', matchType: 'BROAD' }]
    const plannerDecision: { allowNonBrandFromPlanner?: boolean; volumeUnavailableFromPlanner?: boolean } = {}

    await expandAllKeywords(
      initial,
      'Hoover',
      'Vacuum Cleaner',
      'UK',
      'English',
      'oauth',
      undefined,
      51,
      '1234567890',
      'refresh-token',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      plannerDecision
    )

    expect(plannerDecision.volumeUnavailableFromPlanner).toBe(true)
  })

  it('tags retained planner non-brand keywords by use-case when policy is enabled', async () => {
    mockExpandKeywordsWithSeeds.mockResolvedValueOnce([
      {
        keyword: '10 inch mattress',
        searchVolume: 2600,
        competition: 'HIGH',
        competitionIndex: 80,
        lowTopPageBid: 1200000,
        highTopPageBid: 1800000,
      },
      {
        keyword: 'mattress for side sleepers',
        searchVolume: 2100,
        competition: 'MEDIUM',
        competitionIndex: 65,
        lowTopPageBid: 900000,
        highTopPageBid: 1400000,
      },
      {
        keyword: 'mattress',
        searchVolume: 6400,
        competition: 'HIGH',
        competitionIndex: 90,
        lowTopPageBid: 1500000,
        highTopPageBid: 2200000,
      },
    ])

    const { expandAllKeywords } = await import('../keyword-pool-helpers')
    const initial: PoolKeywordData[] = [{ keyword: 'novilla', searchVolume: 0, source: 'TEST', matchType: 'BROAD' }]
    const plannerDecision: {
      allowNonBrandFromPlanner?: boolean
      volumeUnavailableFromPlanner?: boolean
      nonBrandPolicy?: Record<string, unknown>
    } = {}

    const out = await expandAllKeywords(
      initial,
      'Novilla',
      'Mattress',
      'US',
      'English',
      'oauth',
      {
        brand: 'Novilla',
        product_name: 'Novilla King Size Mattress, 10 Inch Memory Foam Mattress, Medium Firm',
        scraped_data: JSON.stringify({
          rawProductTitle: 'Novilla King Size Mattress, 10 Inch Memory Foam Mattress, Medium Firm',
          rawAboutThisItem: [
            'King size support',
            'Cooling comfort',
            '10 inch memory foam design',
          ],
        }),
      } as any,
      51,
      '1234567890',
      'refresh-token',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        pageType: 'product',
        allowNonBrandForPool: false,
        allowNonBrandForDemand: true,
        allowNonBrandForModelFamily: true,
      },
      plannerDecision as any
    )

    const kingMattress = out.find((item) => item.keyword === '10 inch mattress')
    expect(kingMattress).toMatchObject({
      source: 'KEYWORD_PLANNER',
      sourceType: 'KEYWORD_PLANNER',
      sourceSubtype: 'KEYWORD_PLANNER_MODEL_FAMILY',
      rawSource: 'KEYWORD_PLANNER',
    })
    expect(kingMattress?.derivedTags).toEqual(expect.arrayContaining([
      'PLANNER_NON_BRAND',
      'PLANNER_NON_BRAND_MODEL_FAMILY',
    ]))
    expect(out.map((item) => item.keyword)).not.toContain('mattress for side sleepers')
    expect(out.map((item) => item.keyword)).not.toContain('mattress')
    expect(plannerDecision.allowNonBrandFromPlanner).toBe(true)
  })

  it('keeps platform keyword when semantic term matches product URL platform', async () => {
    const { expandAllKeywords } = await import('../keyword-pool-helpers')
    const initial: PoolKeywordData[] = [{ keyword: 'hoover', searchVolume: 0, source: 'TEST', matchType: 'BROAD' }]

    const out = await expandAllKeywords(
      initial,
      'Hoover',
      'Vacuum Cleaner',
      'UK',
      'English',
      'oauth',
      {
        final_url: 'https://www.amazon.co.uk/dp/B0F94D3ZJ2',
        url: 'https://www.amazon.co.uk/dp/B0F94D3ZJ2',
      } as any,
      51,
      '1234567890',
      'refresh-token'
    )

    const keywords = out.map(k => k.keyword)
    expect(keywords).toContain('hoover amazon')
  })
})
