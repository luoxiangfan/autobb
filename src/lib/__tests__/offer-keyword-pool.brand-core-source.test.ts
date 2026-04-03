import { describe, expect, it } from 'vitest'

import { __testOnly, resolveBrandCoreKeywordSourceMeta } from '../offer-keyword-pool'

describe('resolveBrandCoreKeywordSourceMeta', () => {
  it('preserves search term source semantics when source_mask contains search_term', () => {
    const meta = resolveBrandCoreKeywordSourceMeta('search_term|keyword_perf')

    expect(meta).toMatchObject({
      source: 'SEARCH_TERM',
      sourceType: 'SEARCH_TERM',
      sourceSubtype: 'SEARCH_TERM',
      rawSource: 'SEARCH_TERM',
    })
    expect(meta.derivedTags).toEqual(expect.arrayContaining(['BRAND_CORE', 'KEYWORD_PERF', 'GLOBAL_CORE']))
  })

  it('falls back to global_core when source_mask has no search_term', () => {
    const meta = resolveBrandCoreKeywordSourceMeta('keyword_perf')

    expect(meta).toMatchObject({
      source: 'GLOBAL_CORE',
      sourceType: 'GLOBAL_CORE',
      sourceSubtype: 'GLOBAL_CORE',
      rawSource: 'GLOBAL_KEYWORDS',
    })
    expect(meta.derivedTags).toEqual(expect.arrayContaining(['BRAND_CORE', 'KEYWORD_PERF']))
  })

  it('applies product_intent tightening to global core product scope and removes cross-family terms', () => {
    const filtered = __testOnly.filterGlobalCoreKeywordsByOfferContext({
      offer: {
        brand: 'Our Place',
        category: 'Cookware Sets',
        product_name: 'Our Place 13 Piece Cookware Set Including Always Pan Perfect Pot',
        offer_name: 'Our Place_US_25',
        target_country: 'US',
        target_language: 'English',
        final_url: 'https://example.com/product',
        url: 'https://example.com/product',
        page_type: 'product',
        scraped_data: null,
      } as any,
      keywords: [
        {
          keyword: 'our place cookware set',
          searchVolume: 0,
          source: 'SEARCH_TERM',
          sourceType: 'SEARCH_TERM',
          sourceSubtype: 'SEARCH_TERM',
          matchType: 'PHRASE',
        },
        {
          keyword: 'our place wonder oven',
          searchVolume: 0,
          source: 'SEARCH_TERM',
          sourceType: 'SEARCH_TERM',
          sourceSubtype: 'SEARCH_TERM',
          matchType: 'PHRASE',
        },
        {
          keyword: 'our place air fryer oven',
          searchVolume: 0,
          source: 'SEARCH_TERM',
          sourceType: 'SEARCH_TERM',
          sourceSubtype: 'SEARCH_TERM',
          matchType: 'PHRASE',
        },
      ] as any,
      scope: 'product',
    })

    const keywords = filtered.map((item) => item.keyword)
    expect(keywords).toContain('our place cookware set')
    expect(keywords).not.toContain('our place wonder oven')
    expect(keywords).not.toContain('our place air fryer oven')
  })
})
