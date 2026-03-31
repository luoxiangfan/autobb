import { describe, expect, it } from 'vitest'

import { resolveKeywordCandidatesAfterContextFilter } from './ad-creative-keyword-fallback'

describe('resolveKeywordCandidatesAfterContextFilter', () => {
  it('prefers filtered candidates when context filtering succeeds', () => {
    const result = resolveKeywordCandidatesAfterContextFilter({
      contextFilteredCandidates: [
        { keyword: 'brandx x200 vacuum', searchVolume: 100, source: 'KEYWORD_POOL' } as any,
      ],
      originalCandidates: [
        { keyword: 'brandx official store', searchVolume: 100, source: 'AI_GENERATED' } as any,
      ],
    })

    expect(result.strategy).toBe('filtered')
    expect(result.keywords).toHaveLength(1)
    expect(result.keywords[0].keyword).toBe('brandx x200 vacuum')
  })

  it('falls back to keyword-pool candidates before using the full original set', () => {
    const result = resolveKeywordCandidatesAfterContextFilter({
      contextFilteredCandidates: [],
      originalCandidates: [
        { keyword: 'brandx official store', searchVolume: 100, source: 'AI_GENERATED' } as any,
        { keyword: 'brandx x200 vacuum', searchVolume: 80, source: 'KEYWORD_POOL' } as any,
        { keyword: 'brandx x300 vacuum', searchVolume: 70, source: 'KEYWORD_POOL' } as any,
      ],
    })

    expect(result.strategy).toBe('keyword_pool')
    expect(result.keywords.map((item) => item.keyword)).toEqual([
      'brandx x200 vacuum',
      'brandx x300 vacuum',
    ])
  })

  it('uses the original set only when no safer keyword-pool fallback exists', () => {
    const result = resolveKeywordCandidatesAfterContextFilter({
      contextFilteredCandidates: [],
      originalCandidates: [
        { keyword: 'brandx official store', searchVolume: 100, source: 'AI_GENERATED' } as any,
      ],
    })

    expect(result.strategy).toBe('original')
    expect(result.keywords).toHaveLength(1)
  })
})
