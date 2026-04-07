import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authUser = {
  userId: 1,
  email: 'admin@autoads.dev',
  role: 'admin',
  packageType: 'enterprise',
}

const dbFns = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  queryOne: vi.fn(),
  query: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  withAuth: (handler: any) => {
    return async (request: NextRequest, context?: { params?: Record<string, string> }) => (
      handler(request, authUser, context)
    )
  },
}))

vi.mock('@/lib/db', () => ({
  getDatabase: dbFns.getDatabase,
}))

import { GET } from './route'

describe('GET /api/admin/users/[id]/login-history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.getDatabase.mockReturnValue({
      queryOne: dbFns.queryOne,
      query: dbFns.query,
    })
  })

  it('supports native jsonb audit log details', async () => {
    dbFns.queryOne
      .mockResolvedValueOnce({ username: 'target-user', email: 'target@example.com' })
      .mockResolvedValueOnce({ total: 2 })
    dbFns.query
      .mockResolvedValueOnce([
        {
          id: 101,
          username_or_email: 'target-user',
          ip_address: '127.0.0.1',
          user_agent: 'Mozilla/5.0',
          success: 1,
          failure_reason: null,
          attempted_at: '2026-04-04T12:40:00.000Z',
          device_type: 'Desktop',
          os: 'macOS',
          browser: 'Chrome',
          browser_version: '146.0.0.0',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 202,
          event_type: 'login_success',
          ip_address: '127.0.0.2',
          user_agent: 'Mozilla/5.0',
          details: { source: 'jsonb' },
          created_at: '2026-04-04T12:42:00.000Z',
        },
      ])

    const response = await GET(
      new NextRequest('http://localhost/api/admin/users/77/login-history?limit=50'),
      { params: { id: '77' } }
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.records).toHaveLength(2)
    expect(payload.records[0]).toMatchObject({
      type: 'audit_log',
      details: { source: 'jsonb' },
    })
  })
})
