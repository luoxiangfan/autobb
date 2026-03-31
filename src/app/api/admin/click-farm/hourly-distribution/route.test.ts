import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockQuery = vi.fn()

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    query: mockQuery,
  })),
}))

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
    mockQuery.mockResolvedValueOnce([{ hourly_distribution: distribution }])

    const response = await GET(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.hourlyConfigured[0]).toBe(2)
  })

  it('keeps compatibility with legacy json strings', async () => {
    const distribution = Array.from({ length: 24 }, (_, hour) => (hour === 0 ? 5 : 0))
    mockQuery.mockResolvedValueOnce([{ hourly_distribution: JSON.stringify(distribution) }])

    const response = await GET(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.hourlyConfigured[0]).toBe(5)
  })
})
