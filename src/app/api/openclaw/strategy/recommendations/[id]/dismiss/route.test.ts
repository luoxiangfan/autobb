import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/openclaw/strategy/recommendations/[id]/dismiss/route'

const authFns = vi.hoisted(() => ({
  resolveOpenclawRequestUser: vi.fn(),
}))

const recommendationFns = vi.hoisted(() => ({
  dismissStrategyRecommendation: vi.fn(),
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  resolveOpenclawRequestUser: authFns.resolveOpenclawRequestUser,
}))

vi.mock('@/lib/openclaw/strategy-recommendations', () => ({
  dismissStrategyRecommendation: recommendationFns.dismissStrategyRecommendation,
}))

describe('POST /api/openclaw/strategy/recommendations/:id/dismiss', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 403 when unauthorized', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/openclaw/strategy/recommendations/r1/dismiss', {
      method: 'POST',
    })
    const res = await POST(req, { params: { id: 'r1' } })

    expect(res.status).toBe(403)
  })

  it('dismisses recommendation successfully', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 9,
      authType: 'session',
    })
    recommendationFns.dismissStrategyRecommendation.mockResolvedValue({
      id: 'rec-3',
      status: 'dismissed',
    })

    const req = new NextRequest('http://localhost/api/openclaw/strategy/recommendations/rec-3/dismiss', {
      method: 'POST',
    })
    const res = await POST(req, { params: { id: 'rec-3' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(recommendationFns.dismissStrategyRecommendation).toHaveBeenCalledWith({
      userId: 9,
      recommendationId: 'rec-3',
    })
  })

  it('returns 409 for executed recommendations', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 9,
      authType: 'session',
    })
    recommendationFns.dismissStrategyRecommendation.mockRejectedValue(
      new Error('已执行建议不支持暂不执行')
    )

    const req = new NextRequest('http://localhost/api/openclaw/strategy/recommendations/rec-3/dismiss', {
      method: 'POST',
    })
    const res = await POST(req, { params: { id: 'rec-3' } })

    expect(res.status).toBe(409)
  })
})
