import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/admin/users/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  queryOne: vi.fn(),
  query: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
  createUser: vi.fn(),
  generateUniqueUsername: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

describe('GET /api/admin/users search operator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { role: 'admin', userId: 1 },
    })
    dbFns.getDatabase.mockReturnValue({
      type: 'postgres',
      queryOne: dbFns.queryOne,
      query: dbFns.query,
    })
    dbFns.queryOne.mockResolvedValue({ count: 1 })
    dbFns.query.mockResolvedValue([
      {
        id: 105,
        username: 'KITZEI706',
        email: 'KITZEI706@gmail.com',
        display_name: null,
        role: 'user',
        package_type: 'trial',
        package_expires_at: null,
        is_active: true,
        openclaw_enabled: false,
        product_management_enabled: false,
        strategy_center_enabled: false,
        last_login_at: null,
        created_at: '2026-03-01T00:00:00.000Z',
        locked_until: null,
        failed_login_count: 0,
      },
    ])
  })

  it('uses ILIKE for postgres username/email search', async () => {
    const req = new NextRequest('http://localhost/api/admin/users?search=kitzei')
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(dbFns.queryOne).toHaveBeenCalledTimes(1)
    expect(dbFns.query).toHaveBeenCalledTimes(1)

    const countSql = String(dbFns.queryOne.mock.calls[0]?.[0] || '')
    const countParams = dbFns.queryOne.mock.calls[0]?.[1] || []
    const listSql = String(dbFns.query.mock.calls[0]?.[0] || '')
    const listParams = dbFns.query.mock.calls[0]?.[1] || []

    expect(countSql).toContain('username ILIKE ? OR email ILIKE ?')
    expect(listSql).toContain('username ILIKE ? OR email ILIKE ?')
    expect(countParams).toContain('%kitzei%')
    expect(listParams).toContain('%kitzei%')
  })
})
