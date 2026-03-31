import { describe, it, expect } from 'vitest'
import { applySmartFilters, UnifiedKeywordData } from '../unified-keyword-service'

function kw(keyword: string, searchVolume: number): UnifiedKeywordData {
  return {
    keyword,
    searchVolume,
    competition: 'UNKNOWN',
    competitionIndex: 0,
    lowTopPageBid: 0,
    highTopPageBid: 0,
    source: 'EXPANSION',
    matchType: 'PHRASE',
  }
}

describe('applySmartFilters', () => {
  it('keeps keywords when search volume data is unavailable (all volumes are 0)', () => {
    const out = applySmartFilters([kw('foo', 0), kw('bar review', 0)], 500, 15)
    expect(out.map(k => k.keyword)).toEqual(['foo'])
  })

  it('can disable volume threshold filtering explicitly', () => {
    const high = Array.from({ length: 20 }, (_, i) => kw(`high-${i}`, 1000))
    const low = Array.from({ length: 20 }, (_, i) => kw(`low-${i}`, 0))

    const defaultOut = applySmartFilters([...high, ...low], 500, 15)
    expect(defaultOut).toHaveLength(20)

    const disabledOut = applySmartFilters([...high, ...low], 500, 15, { disableSearchVolumeFilter: true })
    expect(disabledOut).toHaveLength(40)
  })

  it('keeps pure brand keywords regardless of volume thresholds', () => {
    const out = applySmartFilters(
      [kw('eufy', 10), kw('eufy review', 1000), kw('camera', 1000)],
      500,
      15,
      { pureBrandKeywords: ['eufy'] }
    )

    expect(out.map(k => k.keyword)).toEqual(['eufy', 'camera'])
  })
})
