import { describe, expect, it } from 'vitest'
import { parseNumber } from './settings'

describe('openclaw settings parseNumber', () => {
  it('returns fallback when value is empty string', () => {
    expect(parseNumber('', 20)).toBe(20)
    expect(parseNumber('   ', 30)).toBe(30)
  })

  it('parses trimmed numeric strings', () => {
    expect(parseNumber(' 42 ', 0)).toBe(42)
    expect(parseNumber('1.5', 0)).toBe(1.5)
  })
})
