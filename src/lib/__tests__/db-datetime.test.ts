import { describe, it, expect } from 'vitest'
import { parseDbDateTimeAsUtc, normalizeDateOnly, normalizeTimestampToIso } from '../db-datetime'

describe('db-datetime', () => {
  it('parses date-only as UTC midnight', () => {
    const d = parseDbDateTimeAsUtc('2026-01-15')
    expect(d.toISOString()).toBe('2026-01-15T00:00:00.000Z')
  })

  it('parses timestamp without timezone as UTC', () => {
    const d = parseDbDateTimeAsUtc('2026-01-17 04:00:00')
    expect(d.toISOString()).toBe('2026-01-17T04:00:00.000Z')
  })

  it('parses microseconds and normalizes to milliseconds', () => {
    const d = parseDbDateTimeAsUtc('2026-01-17 03:41:49.591359+00')
    expect(d.toISOString()).toBe('2026-01-17T03:41:49.591Z')
  })

  it('normalizes date-only from Date and string', () => {
    expect(normalizeDateOnly(new Date('2026-01-15T00:00:00.000Z'))).toBe('2026-01-15')
    expect(normalizeDateOnly('2026-01-15T00:00:00.000Z')).toBe('2026-01-15')
    expect(normalizeDateOnly('2026-01-15 12:00:00')).toBe('2026-01-15')
  })

  it('normalizes timestamps to ISO strings', () => {
    expect(normalizeTimestampToIso('2026-01-17 04:00:00')).toBe('2026-01-17T04:00:00.000Z')
    expect(normalizeTimestampToIso(new Date('2026-01-17T04:00:00.000Z'))).toBe('2026-01-17T04:00:00.000Z')
  })
})

