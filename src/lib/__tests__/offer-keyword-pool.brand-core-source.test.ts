import { describe, expect, it } from 'vitest'

import { resolveBrandCoreKeywordSourceMeta } from '../offer-keyword-pool'

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
})