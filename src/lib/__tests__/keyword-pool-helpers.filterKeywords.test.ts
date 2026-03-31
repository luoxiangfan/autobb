import { describe, it, expect } from 'vitest'
import { filterKeywords } from '../keyword-pool-helpers'
import type { PoolKeywordData } from '../offer-keyword-pool'

describe('keyword-pool-helpers.filterKeywords', () => {
  it('keeps only brand-containing keywords', () => {
    const input: PoolKeywordData[] = [
      { keyword: 'bettabot', searchVolume: 0, source: 'TEST' },
      { keyword: 'robot vacuum', searchVolume: 20000, source: 'TEST' },
      { keyword: 'betta fish', searchVolume: 50000, source: 'TEST' },
      { keyword: 'betta fish tank', searchVolume: 30000, source: 'TEST' },
    ]

    const out = filterKeywords(input, 'Bettabot', 'robot vacuum cleaner', 'US', 'Bettabot X1 robot vacuum cleaner')
    const texts = out.map(k => k.keyword.toLowerCase())

    expect(texts).toContain('bettabot')
    expect(texts).not.toContain('robot vacuum')
    expect(texts).not.toContain('betta fish')
    expect(texts).not.toContain('betta fish tank')
  })

  it('does not keep non-brand category keywords', () => {
    const input: PoolKeywordData[] = [
      { keyword: 'brandx', searchVolume: 0, source: 'TEST' },
      { keyword: 'betta fish', searchVolume: 50000, source: 'TEST' },
      { keyword: 'dog food', searchVolume: 40000, source: 'TEST' },
      { keyword: 'cat toy', searchVolume: 30000, source: 'TEST' },
      { keyword: 'random thing', searchVolume: 20000, source: 'TEST' },
    ]

    const out = filterKeywords(input, 'BrandX', '', 'US', null)
    const texts = out.map(k => k.keyword.toLowerCase())

    expect(texts).toContain('brandx')
    expect(texts).not.toContain('betta fish')
    expect(texts).not.toContain('dog food')
    expect(texts).not.toContain('cat toy')
    expect(texts).not.toContain('random thing')
  })

  it('normalizes UK target country when applying geo filter', () => {
    const input: PoolKeywordData[] = [
      { keyword: 'hoover', searchVolume: 1000, source: 'TEST' },
      { keyword: 'hoover uk', searchVolume: 1000, source: 'TEST' },
      { keyword: 'hoover france', searchVolume: 1000, source: 'TEST' },
    ]

    const out = filterKeywords(input, 'Hoover', 'vacuum', 'UK', 'Hoover vacuum cleaner')
    const texts = out.map(k => k.keyword.toLowerCase())

    expect(texts).toContain('hoover')
    expect(texts).toContain('hoover uk')
    expect(texts).not.toContain('hoover france')
  })

  it('allows only planner non-brand keywords covered by the use-case policy', () => {
    const input: PoolKeywordData[] = [
      { keyword: 'novilla', searchVolume: 24000, source: 'TEST' },
      {
        keyword: 'cooling mattress',
        searchVolume: 2200,
        source: 'KEYWORD_PLANNER',
        sourceType: 'KEYWORD_PLANNER',
        sourceSubtype: 'KEYWORD_PLANNER_DEMAND',
        rawSource: 'KEYWORD_PLANNER',
        derivedTags: ['PLANNER_NON_BRAND', 'PLANNER_NON_BRAND_DEMAND'],
      },
      {
        keyword: 'mattress',
        searchVolume: 5400,
        source: 'KEYWORD_PLANNER',
        sourceType: 'KEYWORD_PLANNER',
        sourceSubtype: 'KEYWORD_PLANNER_POOL',
        rawSource: 'KEYWORD_PLANNER',
        derivedTags: ['PLANNER_NON_BRAND', 'PLANNER_NON_BRAND_POOL'],
      },
    ]

    const out = filterKeywords(input, 'Novilla', 'mattress', 'US', 'Novilla memory foam mattress', {
      allowNonBrandFromPlanner: {
        pageType: 'product',
        allowNonBrandForPool: false,
        allowNonBrandForDemand: true,
        allowNonBrandForModelFamily: true,
      },
    })
    const texts = out.map(k => k.keyword.toLowerCase())

    expect(texts).toContain('novilla')
    expect(texts).toContain('cooling mattress')
    expect(texts).not.toContain('mattress')
  })
})
