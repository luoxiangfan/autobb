import { describe, expect, it } from 'vitest'
import { parseTruthyFlag } from '@/lib/common'

describe('parseTruthyFlag', () => {
  it('returns true only for explicit truthy values', () => {
    expect(parseTruthyFlag(true)).toBe(true)
    expect(parseTruthyFlag('true')).toBe(true)
    expect(parseTruthyFlag(' TRUE ')).toBe(true)
    expect(parseTruthyFlag(1)).toBe(true)
  })

  it('returns false for false-like strings and other values', () => {
    expect(parseTruthyFlag(false)).toBe(false)
    expect(parseTruthyFlag('false')).toBe(false)
    expect(parseTruthyFlag(undefined)).toBe(false)
    expect(parseTruthyFlag(null)).toBe(false)
    expect(parseTruthyFlag('')).toBe(false)
  })
})
