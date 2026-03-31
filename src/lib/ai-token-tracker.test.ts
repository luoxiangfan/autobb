import { describe, expect, it } from 'vitest'
import { estimateTokenCost } from '@/lib/ai-token-tracker'

describe('estimateTokenCost', () => {
  it('uses gpt-5.2 pricing (USD per 1M) and converts to CNY', () => {
    const cost = estimateTokenCost('gpt-5.2', 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo((1.75 + 14.0) * 7.2, 10)
  })

  it('supports dated gpt-5.2 model variants', () => {
    const cost = estimateTokenCost('gpt-5.2-2025-12-11', 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo((1.75 + 14.0) * 7.2, 10)
  })

  it('uses gemini-3-flash-preview pricing (USD per 1M) and converts to CNY', () => {
    const cost = estimateTokenCost('gemini-3-flash-preview', 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo((0.5 + 3.0) * 7.2, 10)
  })

  it('keeps legacy fallback pricing for other flash/pro models', () => {
    const flashCost = estimateTokenCost('gemini-2.5-flash', 1_000_000, 1_000_000)
    const proCost = estimateTokenCost('gemini-2.5-pro', 1_000_000, 1_000_000)

    expect(flashCost).toBeCloseTo((0.075 + 0.3) * 7.2, 10)
    expect(proCost).toBeCloseTo((1.25 + 5.0) * 7.2, 10)
  })
})
