import { describe, expect, it } from 'vitest'

import { normalizeTrendDateKey } from './reports'

describe('normalizeTrendDateKey', () => {
  it('normalizes Date objects to YYYY-MM-DD', () => {
    const value = new Date('2026-02-24T00:00:00.000Z')
    expect(normalizeTrendDateKey(value)).toBe('2026-02-24')
  })

  it('keeps ISO date strings', () => {
    expect(normalizeTrendDateKey('2026-02-24')).toBe('2026-02-24')
  })

  it('extracts date prefix from datetime strings', () => {
    expect(normalizeTrendDateKey('2026-02-24T12:34:56.000Z')).toBe('2026-02-24')
    expect(normalizeTrendDateKey('2026-02-24 12:34:56')).toBe('2026-02-24')
  })

  it('returns null for invalid values', () => {
    expect(normalizeTrendDateKey('')).toBeNull()
    expect(normalizeTrendDateKey('not-a-date')).toBeNull()
    expect(normalizeTrendDateKey(null)).toBeNull()
    expect(normalizeTrendDateKey(undefined)).toBeNull()
  })
})
