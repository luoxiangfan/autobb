import { describe, expect, it } from 'vitest'
import { parsePositiveIntegerOfferId } from '../parse-offer-id'

describe('parsePositiveIntegerOfferId', () => {
  it('accepts positive integers', () => {
    expect(parsePositiveIntegerOfferId(42)).toBe(42)
  })

  it('accepts numeric strings', () => {
    expect(parsePositiveIntegerOfferId(' 42 ')).toBe(42)
  })

  it('rejects invalid values', () => {
    expect(parsePositiveIntegerOfferId(0)).toBeUndefined()
    expect(parsePositiveIntegerOfferId(-1)).toBeUndefined()
    expect(parsePositiveIntegerOfferId('42x')).toBeUndefined()
    expect(parsePositiveIntegerOfferId(null)).toBeUndefined()
  })
})
