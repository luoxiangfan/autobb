import { describe, expect, it } from 'vitest'
import {
  parseJsonField,
  toDbJsonArrayField,
  toDbJsonField,
  toDbJsonObjectField,
} from '@/lib/json-field'

describe('parseJsonField', () => {
  it('returns object/array directly for native jsonb values', () => {
    const input = { ok: true, nested: { value: 1 } }
    expect(parseJsonField(input, null)).toEqual(input)
  })

  it('parses standard JSON string payloads', () => {
    const input = '{"ok":true,"count":2}'
    expect(parseJsonField(input, null)).toEqual({ ok: true, count: 2 })
  })

  it('parses double-encoded JSON strings', () => {
    const input = '"{\\"ok\\":true,\\"items\\":[1,2]}"'
    expect(parseJsonField(input, null)).toEqual({ ok: true, items: [1, 2] })
  })

  it('falls back on invalid payloads', () => {
    expect(parseJsonField('not-json', { ok: false })).toEqual({ ok: false })
  })
})

describe('toDbJsonField', () => {
  it('returns native object values for JSONB writes', () => {
    expect(toDbJsonField({ ok: true })).toEqual({ ok: true })
  })

  it('parses json string to native object', () => {
    expect(toDbJsonField('{"ok":true}')).toEqual({ ok: true })
  })

  it('parses double-encoded json string to native object', () => {
    expect(toDbJsonField('"{\\"ok\\":true}"')).toEqual({ ok: true })
  })
})

describe('toDbJsonObjectField', () => {
  it('returns object values', () => {
    expect(toDbJsonObjectField({ a: 1 })).toEqual({ a: 1 })
  })

  it('rejects scalar string and uses fallback', () => {
    expect(toDbJsonObjectField('"hello"', { message: 'fallback' })).toEqual({
      message: 'fallback',
    })
  })
})

describe('toDbJsonArrayField', () => {
  it('returns array values', () => {
    expect(toDbJsonArrayField([1, 2])).toEqual([1, 2])
  })

  it('parses double-encoded array string', () => {
    expect(toDbJsonArrayField('"[1,2]"', [])).toEqual([1, 2])
  })

  it('rejects object payload and uses fallback array', () => {
    expect(toDbJsonArrayField('{"a":1}', [])).toEqual([])
  })
})
