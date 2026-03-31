import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/openclaw/strategy/status/route'

const authFns = vi.hoisted(() => ({
  resolveOpenclawRequestUser: vi.fn(),
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  resolveOpenclawRequestUser: authFns.resolveOpenclawRequestUser,
}))

describe('GET /api/openclaw/strategy/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 403 when user is unauthorized', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/openclaw/strategy/status')
    const res = await GET(req)

    expect(res.status).toBe(403)
  })

  it('returns 410 because strategy status endpoint is deprecated', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 11,
      authType: 'session',
    })

    const req = new NextRequest('http://localhost/api/openclaw/strategy/status')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(410)
    expect(String(data.error || '')).toContain('策略状态接口已下线')
  })
})

