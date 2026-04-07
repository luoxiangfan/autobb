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

describe('GET /api/admin/audit-logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.getDatabase.mockReturnValue({
      queryOne: dbFns.queryOne,
      query: dbFns.query,
    })
  })

  it('supports native jsonb details payloads', async () => {
    dbFns.queryOne.mockResolvedValueOnce({ total: 1 })
    dbFns.query.mockResolvedValueOnce([
      {
        id: 301,
        user_id: 77,
        event_type: 'user_updated',
        ip_address: '127.0.0.1',
        user_agent: 'Mozilla/5.0',
        details: { field: 'email', oldValue: 'a@example.com', newValue: 'b@example.com' },
        created_at: '2026-04-04T12:42:00.000Z',
        operator_id: 1,
        operator_username: 'admin',
        target_user_id: 77,
        target_username: 'target-user',
        status: 'success',
        error_message: null,
      },
    ])

    const response = await GET(
      new NextRequest('http://localhost/api/admin/audit-logs?page=1&limit=50')
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.records[0]).toMatchObject({
      id: 301,
      details: {
        field: 'email',
        oldValue: 'a@example.com',
        newValue: 'b@example.com',
      },
    })
  })
})
