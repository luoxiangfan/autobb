import { describe, it, expect, vi } from 'vitest'
import type { PoolKeywordData } from '../offer-keyword-pool'

// Avoid native bcrypt binary issues in test environments (arch mismatch).
vi.mock('bcrypt', () => {
  const stub = {
    hash: async () => 'stub-hash',
    compare: async () => true,
  }
  return { default: stub, ...stub }
})

vi.mock('../google-suggestions', () => ({
  detectCountryInKeyword: vi.fn(() => []),
  filterLowIntentKeywords: vi.fn((keywords: string[]) => keywords),
  filterMismatchedGeoKeywords: vi.fn((keywords: string[]) => keywords),
  getBrandSearchSuggestions: vi.fn(async () => [
    { keyword: 'midland weather radio' },
    { keyword: 'midland emergency radio' },
  ])
}))

vi.mock('../google-trends', () => ({
  getTrendsKeywords: vi.fn(async () => [
    {
      keyword: 'midland weather alert',
      searchVolume: 0,
      competition: 'UNKNOWN',
      competitionIndex: 0,
      lowTopPageBid: 0,
      highTopPageBid: 0,
    }
  ])
}))

vi.mock('../enhanced-keyword-extractor', () => ({
  extractKeywordsEnhanced: vi.fn(async () => [
    { keyword: 'midland all hazards radio', competition: 'UNKNOWN' }
  ])
}))

vi.mock('../db', () => ({
  getDatabase: vi.fn(async () => ({
    query: vi.fn(async () => [])
  }))
}))

describe('keyword-pool-helpers.expandAllKeywords (OAuth fallback)', () => {
  it('falls back to initialKeywords when customerId is missing (prevents empty pool)', async () => {
    const { expandAllKeywords } = await import('../keyword-pool-helpers')
    const initial: PoolKeywordData[] = [
      { keyword: 'midland', searchVolume: 0, source: 'TEST', matchType: 'BROAD' },
      { keyword: 'midland weather radio', searchVolume: 0, source: 'TEST', matchType: 'BROAD' },
    ]

    const out = await expandAllKeywords(
      initial,
      'Midland',
      'Weather Radios',
      'US',
      'English',
      'oauth',
      undefined,
      62,
      undefined // customerId missing
    )

    expect(out.map(k => k.keyword)).toEqual(initial.map(k => k.keyword))
  })

  it('falls back to pure brand keywords when initialKeywords is empty', async () => {
    const { expandAllKeywords } = await import('../keyword-pool-helpers')
    const out = await expandAllKeywords(
      [],
      'Midland',
      'Weather Radios',
      'US',
      'English',
      'oauth',
      undefined,
      62,
      undefined // customerId missing
    )

    expect(out.length).toBeGreaterThan(0)
    expect(out.map(k => k.keyword.toLowerCase())).toContain('midland')
  })

  it('uses PHRASE for non-pure-brand keywords in service-account fallback path', async () => {
    const { expandAllKeywords } = await import('../keyword-pool-helpers')
    const out = await expandAllKeywords(
      [],
      'Midland',
      'Weather Radios',
      'US',
      'English',
      'service_account',
      {
        id: 1,
        user_id: 62,
        brand: 'Midland',
        url: 'https://example.com',
        target_country: 'US',
        target_language: 'English',
        status: 'pending'
      } as any,
      62
    )

    const byKeyword = new Map(out.map(item => [item.keyword.toLowerCase(), item.matchType]))
    expect(byKeyword.get('midland')).toBe('EXACT')
    expect(byKeyword.get('midland weather radio')).toBe('PHRASE')
    expect(byKeyword.get('midland emergency radio')).toBe('PHRASE')
    expect(byKeyword.get('midland weather alert')).toBe('PHRASE')
    expect(byKeyword.get('midland all hazards radio')).toBe('PHRASE')
  })
})
