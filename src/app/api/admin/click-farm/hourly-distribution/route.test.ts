import { describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const authUser = {
  userId: 1,
  email: 'admin@autoads.dev',
  role: 'admin',
  packageType: 'enterprise',
}

const mockQuery = vi.fn()

vi.mock('@/lib/auth', () => ({
  withAuth: (handler: any, options?: { requireAdmin?: boolean }) => {
    return async (request: NextRequest) => {
      if (options?.requireAdmin && authUser.role !== 'admin') {
        return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
      }
      return handler(request, authUser)
    }
  },
}))

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>()
  return {
    ...actual,
    getDatabase: vi.fn(async () => ({
      query: mockQuery,
    })),
  }
})

import { GET } from './route'

function makeRequest() {
  return new NextRequest('http://localhost/api/admin/click-farm/hourly-distribution', {
    headers: {
      'x-user-id': '1',
      'x-user-role': 'admin',
    },
  })
}

describe('GET /api/admin/click-farm/hourly-distribution', () => {
  it('supports native jsonb arrays', async () => {
    const distribution = Array.from({ length: 24 }, (_, hour) => (hour === 0 ? 2 : 0))
    mockQuery.mockResolvedValueOnce([
      { hourly_distribution: distribution, timezone: 'UTC', daily_history: [] },
    ])

    const response = await GET(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.hourlyConfigured[0]).toBe(2)
  })

  it('keeps compatibility with legacy json strings', async () => {
    const distribution = Array.from({ length: 24 }, (_, hour) => (hour === 0 ? 5 : 0))
    mockQuery.mockResolvedValueOnce([
      {
        hourly_distribution: JSON.stringify(distribution),
        timezone: 'UTC',
        daily_history: [],
      },
    ])

    const response = await GET(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.hourlyConfigured[0]).toBe(5)
  })

  it('aggregates hourlyActual from daily_history hourly_breakdown', async () => {
    const distribution = Array.from({ length: 24 }, () => 0)
    const today = new Date().toISOString().split('T')[0]
    mockQuery.mockResolvedValueOnce([
      {
        hourly_distribution: distribution,
        timezone: 'UTC',
        daily_history: [
          {
            date: today,
            hourly_breakdown: Array.from({ length: 24 }, (_, hour) => ({
              actual: hour === 3 ? 4 : 0,
            })),
          },
        ],
      },
    ])

    const response = await GET(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.hourlyActual[3]).toBe(4)
    expect(payload.data.matchRate).toBeDefined()
  })
})
