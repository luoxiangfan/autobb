import { describe, expect, it } from 'vitest'
import { resolveBatchStartTasksConcurrency } from '@/lib/campaign/server'

describe('resolveBatchStartTasksConcurrency', () => {
  it('falls back to default when value is invalid', () => {
    expect(resolveBatchStartTasksConcurrency(undefined)).toBe(8)
    expect(resolveBatchStartTasksConcurrency('abc')).toBe(8)
    expect(resolveBatchStartTasksConcurrency('0')).toBe(8)
    expect(resolveBatchStartTasksConcurrency('-5')).toBe(8)
  })

  it('accepts valid range and clamps high values', () => {
    expect(resolveBatchStartTasksConcurrency('1')).toBe(1)
    expect(resolveBatchStartTasksConcurrency('12')).toBe(12)
    expect(resolveBatchStartTasksConcurrency('99')).toBe(32)
  })
})
