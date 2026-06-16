import { describe, expect, it } from 'vitest'
import { mapWithConcurrency, resolveBatchEvaluateConcurrency } from '../common/server'

describe('run-with-concurrency', () => {
  it('mapWithConcurrency preserves order with bounded parallelism', async () => {
    const items = [1, 2, 3, 4, 5]
    const results = await mapWithConcurrency(items, 2, async (value) => {
      await new Promise((resolve) => setTimeout(resolve, (6 - value) * 5))
      return value * 10
    })
    expect(results).toEqual([10, 20, 30, 40, 50])
  })

  it('clamps batch evaluate concurrency', () => {
    expect(resolveBatchEvaluateConcurrency(undefined)).toBe(8)
    expect(resolveBatchEvaluateConcurrency('3')).toBe(3)
    expect(resolveBatchEvaluateConcurrency('99')).toBe(20)
    expect(resolveBatchEvaluateConcurrency('nope')).toBe(8)
  })
})
