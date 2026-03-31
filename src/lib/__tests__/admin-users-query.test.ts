import { describe, expect, it } from 'vitest'
import { buildAdminUsersOrderBy } from '../admin/users-query'

describe('admin/users-query', () => {
  it('builds status orderBy for postgres with timestamptz cast (locked_until is TEXT)', () => {
    const orderBy = buildAdminUsersOrderBy({ sortBy: 'status', sortOrder: 'ASC', dbType: 'postgres' })
    expect(orderBy).toContain("NULLIF(locked_until, '')::timestamptz")
    expect(orderBy).toContain('> NOW()')
    expect(orderBy).not.toContain('locked_until > NOW()')
  })

  it('builds status orderBy for sqlite using datetime(now)', () => {
    const orderBy = buildAdminUsersOrderBy({ sortBy: 'status', sortOrder: 'ASC', dbType: 'sqlite' })
    expect(orderBy).toContain("locked_until > datetime('now')")
  })
})

