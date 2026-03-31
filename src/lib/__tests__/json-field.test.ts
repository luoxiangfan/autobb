import { describe, expect, it } from 'vitest'
import { parseJsonField, toDbJsonArrayField, toDbJsonField, toDbJsonObjectField } from '@/lib/json-field'

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
  it('keeps sqlite behavior with json string', () => {
    expect(toDbJsonField({ ok: true }, 'sqlite')).toBe('{"ok":true}')
  })

  it('parses json string to native object for postgres', () => {
    expect(toDbJsonField('{"ok":true}', 'postgres')).toEqual({ ok: true })
  })

  it('parses double-encoded json string to native object for postgres', () => {
    expect(toDbJsonField('"{\\"ok\\":true}"', 'postgres')).toEqual({ ok: true })
  })
})

describe('toDbJsonObjectField', () => {
  it('returns object for postgres', () => {
    expect(toDbJsonObjectField({ a: 1 }, 'postgres')).toEqual({ a: 1 })
  })

  it('rejects scalar string for postgres and uses fallback', () => {
    expect(toDbJsonObjectField('"hello"', 'postgres', { message: 'fallback' })).toEqual({
      message: 'fallback',
    })
  })
})

describe('toDbJsonArrayField', () => {
  it('returns array for postgres', () => {
    expect(toDbJsonArrayField([1, 2], 'postgres')).toEqual([1, 2])
  })

  it('parses double-encoded array string for postgres', () => {
    expect(toDbJsonArrayField('"[1,2]"', 'postgres', [])).toEqual([1, 2])
  })

  it('rejects object payload for postgres and uses fallback array', () => {
    expect(toDbJsonArrayField('{"a":1}', 'postgres', [])).toEqual([])
  })
})
