import { describe, expect, it } from 'vitest'
import { getMinContextTokenMatchesForKeywordQualityFilter } from './keyword-context-filter'

describe('getMinContextTokenMatchesForKeywordQualityFilter', () => {
  it('returns 0 for store pages', () => {
    expect(getMinContextTokenMatchesForKeywordQualityFilter({ pageType: 'store' })).toBe(0)
  })

  it('returns 1 for product/unknown pages', () => {
    expect(getMinContextTokenMatchesForKeywordQualityFilter({ pageType: 'product' })).toBe(1)
    expect(getMinContextTokenMatchesForKeywordQualityFilter({ pageType: undefined })).toBe(1)
    expect(getMinContextTokenMatchesForKeywordQualityFilter({ pageType: null })).toBe(1)
  })
})

