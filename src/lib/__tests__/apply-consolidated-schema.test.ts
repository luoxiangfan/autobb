import { describe, expect, it } from 'vitest'
import { isIgnorablePostgresSchemaError } from '../apply-consolidated-schema'

describe('isIgnorablePostgresSchemaError', () => {
  it('accepts duplicate key in English and Chinese messages', () => {
    expect(
      isIgnorablePostgresSchemaError(new Error('duplicate key value violates unique constraint'))
    ).toBe(true)
    expect(
      isIgnorablePostgresSchemaError(new Error('重复键违反唯一约束"prompt_versions_pkey"'))
    ).toBe(true)
    expect(isIgnorablePostgresSchemaError({ code: '23505', message: 'duplicate' })).toBe(true)
  })

  it('rejects unrelated errors', () => {
    expect(isIgnorablePostgresSchemaError(new Error('relation "users" does not exist'))).toBe(false)
  })
})
