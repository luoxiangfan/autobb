import { describe, expect, it } from 'vitest'

import { normalizeSqliteSql } from '@/lib/sqlite-sql'

describe('normalizeSqliteSql', () => {
  it('expands standalone placeholders', () => {
    expect(normalizeSqliteSql('WHERE IS_DELETED_FALSE')).toBe('WHERE is_deleted = 0')
    expect(normalizeSqliteSql('WHERE IS_DELETED_TRUE')).toBe('WHERE is_deleted = 1')
  })

  it('expands prefixed shorthand placeholders', () => {
    expect(normalizeSqliteSql('WHERE t.IS_DELETED_FALSE')).toBe('WHERE t.is_deleted = 0')
    expect(normalizeSqliteSql('WHERE cft.IS_DELETED_TRUE')).toBe('WHERE cft.is_deleted = 1')
  })

  it('expands equality placeholders', () => {
    expect(normalizeSqliteSql('WHERE is_deleted = IS_DELETED_FALSE')).toBe('WHERE is_deleted = 0')
    expect(normalizeSqliteSql('WHERE o.is_deleted = IS_DELETED_TRUE')).toBe('WHERE o.is_deleted = 1')
  })
})

