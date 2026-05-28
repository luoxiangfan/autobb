import { describe, expect, it } from 'vitest'
import {
  deriveSkipKeywordPoolExpandLoad,
  parsePositiveIntegerId,
  parsePositiveIntegerOfferId,
  parsePositiveIntegerOfferIdList,
  parseUniquePositiveIntegerIds,
} from '../parse-offer-id'

describe('parsePositiveIntegerId', () => {
  it('accepts positive integers', () => {
    expect(parsePositiveIntegerId(42)).toBe(42)
  })

  it('accepts numeric strings', () => {
    expect(parsePositiveIntegerId(' 42 ')).toBe(42)
  })

  it('rejects invalid values', () => {
    expect(parsePositiveIntegerId(0)).toBeUndefined()
    expect(parsePositiveIntegerId(-1)).toBeUndefined()
    expect(parsePositiveIntegerId('42x')).toBeUndefined()
    expect(parsePositiveIntegerId(null)).toBeUndefined()
  })
})

describe('parsePositiveIntegerOfferId', () => {
  it('delegates to parsePositiveIntegerId', () => {
    expect(parsePositiveIntegerOfferId(42)).toBe(42)
    expect(parsePositiveIntegerOfferId(' 42 ')).toBe(42)
    expect(parsePositiveIntegerOfferId(0)).toBeUndefined()
  })
})

describe('parseUniquePositiveIntegerIds', () => {
  it('returns unique ids in order', () => {
    expect(parseUniquePositiveIntegerIds([3, 1, 2])).toEqual({ ok: true, ids: [3, 1, 2] })
  })

  it('rejects invalid ids', () => {
    expect(parseUniquePositiveIntegerIds([1, 'x'])).toEqual({ ok: false, reason: 'invalid' })
  })

  it('rejects duplicate ids', () => {
    expect(parseUniquePositiveIntegerIds([1, 2, 2])).toEqual({ ok: false, reason: 'duplicate' })
  })
})

describe('parsePositiveIntegerOfferIdList', () => {
  it('parses comma-separated ids and drops invalid segments', () => {
    expect(parsePositiveIntegerOfferIdList('1, 2,3')).toEqual([1, 2, 3])
    expect(parsePositiveIntegerOfferIdList('1,,x,4')).toEqual([1, 4])
  })

  it('dedupes ids while preserving first-seen order', () => {
    expect(parsePositiveIntegerOfferIdList('1,1,2,2,3')).toEqual([1, 2, 3])
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
