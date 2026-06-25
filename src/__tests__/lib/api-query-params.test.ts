import { describe, expect, it } from 'vitest'
import {
  formatAsYmd,
  parseCountryCodeQueryParam,
  parseNumericQueryParam,
  parseQueryBooleanParam,
  parseYmdQueryParam,
  parseYmdSearchParam,
} from '@/lib/common/api-query-params'

describe('parseQueryBooleanParam', () => {
  it('returns true for common truthy query values', () => {
    expect(parseQueryBooleanParam('true')).toBe(true)
    expect(parseQueryBooleanParam(' TRUE ')).toBe(true)
    expect(parseQueryBooleanParam('1')).toBe(true)
    expect(parseQueryBooleanParam('yes')).toBe(true)
    expect(parseQueryBooleanParam('on')).toBe(true)
  })

  it('returns false for null, empty, and false-like values', () => {
    expect(parseQueryBooleanParam(null)).toBe(false)
    expect(parseQueryBooleanParam('')).toBe(false)
    expect(parseQueryBooleanParam('false')).toBe(false)
    expect(parseQueryBooleanParam('0')).toBe(false)
  })
})

describe('parseYmdQueryParam', () => {
  it('accepts valid calendar dates', () => {
    expect(parseYmdQueryParam('2026-06-25')).toBe('2026-06-25')
    expect(parseYmdQueryParam(' 2026-01-01 ')).toBe('2026-01-01')
  })

  it('rejects invalid format or non-existent dates', () => {
    expect(parseYmdQueryParam(null)).toBeNull()
    expect(parseYmdQueryParam('2026/06/25')).toBeNull()
    expect(parseYmdQueryParam('2026-02-30')).toBeNull()
    expect(parseYmdQueryParam('not-a-date')).toBeNull()
  })
})

describe('formatAsYmd', () => {
  it('extracts date prefix or parses ISO timestamps', () => {
    expect(formatAsYmd('2026-06-25T12:00:00.000Z')).toBe('2026-06-25')
    expect(formatAsYmd('2026-06-25')).toBe('2026-06-25')
  })

  it('returns null for empty or unparseable input', () => {
    expect(formatAsYmd(null)).toBeNull()
    expect(formatAsYmd('')).toBeNull()
    expect(formatAsYmd('invalid')).toBeNull()
  })
})

describe('parseNumericQueryParam', () => {
  it('parses finite numbers and rejects missing or invalid values', () => {
    const params = new URLSearchParams('min=10&bad=abc&empty=')
    expect(parseNumericQueryParam(params, 'min')).toBe(10)
    expect(parseNumericQueryParam(params, 'bad')).toBeNull()
    expect(parseNumericQueryParam(params, 'empty')).toBeNull()
    expect(parseNumericQueryParam(params, 'missing')).toBeNull()
  })
})

describe('parseYmdSearchParam', () => {
  it('delegates to parseYmdQueryParam for a search param key', () => {
    const params = new URLSearchParams('from=2026-06-25&to=2026-02-30')
    expect(parseYmdSearchParam(params, 'from')).toBe('2026-06-25')
    expect(parseYmdSearchParam(params, 'to')).toBeNull()
    expect(parseYmdSearchParam(params, 'missing')).toBeNull()
  })
})

describe('parseCountryCodeQueryParam', () => {
  it('normalizes country codes and falls back to all', () => {
    const params = new URLSearchParams('country=us&region=ALL&bad=USA1')
    expect(parseCountryCodeQueryParam(params, 'country')).toBe('US')
    expect(parseCountryCodeQueryParam(params, 'region')).toBe('all')
    expect(parseCountryCodeQueryParam(params, 'bad')).toBe('all')
    expect(parseCountryCodeQueryParam(params, 'missing')).toBe('all')
  })
})
