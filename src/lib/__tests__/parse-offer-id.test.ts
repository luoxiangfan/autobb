import { describe, expect, it } from 'vitest'
import { deriveSkipKeywordPoolExpandLoad, parsePositiveIntegerOfferId } from '../parse-offer-id'

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

describe('deriveSkipKeywordPoolExpandLoad', () => {
  it('returns false when planner session exists', () => {
    expect(deriveSkipKeywordPoolExpandLoad(undefined, { volumeAuth: {} })).toBe(false)
  })

  it('returns true when expand prepare did not succeed', () => {
    expect(deriveSkipKeywordPoolExpandLoad(undefined, undefined)).toBe(true)
    expect(deriveSkipKeywordPoolExpandLoad({ ok: false }, undefined)).toBe(true)
  })

  it('returns false when expand succeeded or planner session is present', () => {
    expect(deriveSkipKeywordPoolExpandLoad({ ok: true }, undefined)).toBe(false)
    expect(deriveSkipKeywordPoolExpandLoad({ ok: true }, { volumeAuth: {} })).toBe(false)
    expect(deriveSkipKeywordPoolExpandLoad(undefined, { volumeAuth: {} })).toBe(false)
  })
})
