import { describe, expect, it } from 'vitest'
import { resolveCreativeSalesRankSignal } from '../ad-creative-generator'

describe('ad-creative-generator sales rank guard', () => {
  it('suppresses weak high-rank claims from prompt context', () => {
    const signal = resolveCreativeSalesRankSignal('Ranked #18,696 in Clothing')

    expect(signal.rankNumber).toBe(18696)
    expect(signal.normalizedRankText).toBe('#18,696')
    expect(signal.eligibleForPrompt).toBe(false)
    expect(signal.strongSignal).toBe(false)
  })

  it('allows top-100 rank as strong social proof', () => {
    const signal = resolveCreativeSalesRankSignal('#88 Best Seller')

    expect(signal.rankNumber).toBe(88)
    expect(signal.eligibleForPrompt).toBe(true)
    expect(signal.strongSignal).toBe(true)
  })

  it('allows top-1000 rank for non-forced prompt reference only', () => {
    const signal = resolveCreativeSalesRankSignal('Category Rank #650')

    expect(signal.rankNumber).toBe(650)
    expect(signal.eligibleForPrompt).toBe(true)
    expect(signal.strongSignal).toBe(false)
  })

  it('returns empty signal for missing or unparsable values', () => {
    const blank = resolveCreativeSalesRankSignal(null)
    const unparsable = resolveCreativeSalesRankSignal('Best Seller in category')

    expect(blank.eligibleForPrompt).toBe(false)
    expect(blank.rankNumber).toBeNull()

    expect(unparsable.raw).toBe('Best Seller in category')
    expect(unparsable.rankNumber).toBeNull()
    expect(unparsable.eligibleForPrompt).toBe(false)
  })
})
