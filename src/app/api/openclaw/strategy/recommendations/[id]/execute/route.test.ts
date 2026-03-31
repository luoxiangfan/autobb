import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/openclaw/strategy/recommendations/[id]/execute/route'

const authFns = vi.hoisted(() => ({
  resolveOpenclawRequestUser: vi.fn(),
}))

const recommendationFns = vi.hoisted(() => ({
  queueStrategyRecommendationExecution: vi.fn(),
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  resolveOpenclawRequestUser: authFns.resolveOpenclawRequestUser,
}))

vi.mock('@/lib/openclaw/strategy-recommendations', () => ({
  queueStrategyRecommendationExecution: recommendationFns.queueStrategyRecommendationExecution,
}))

describe('POST /api/openclaw/strategy/recommendations/:id/execute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requires confirm=true', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 9,
      authType: 'session',
    })

    const req = new NextRequest('http://localhost/api/openclaw/strategy/recommendations/r1/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: false }),
    })
    const res = await POST(req, { params: { id: 'r1' } })

    expect(res.status).toBe(400)
    expect(recommendationFns.queueStrategyRecommendationExecution).not.toHaveBeenCalled()
  })

  it('queues recommendation execution with confirmation', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 12,
      authType: 'session',
    })
    recommendationFns.queueStrategyRecommendationExecution.mockResolvedValue({
      queued: true,
      deduplicated: false,
      taskId: 'task-123',
      recommendation: {
        id: 'rec-2',
        status: 'pending',
      },
    })

    const req = new NextRequest('http://localhost/api/openclaw/strategy/recommendations/rec-2/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    })
    const res = await POST(req, { params: { id: 'rec-2' } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.queued).toBe(true)
    expect(data.taskId).toBe('task-123')
    expect(recommendationFns.queueStrategyRecommendationExecution).toHaveBeenCalledWith({
      userId: 12,
      recommendationId: 'rec-2',
      confirm: true,
      parentRequestId: undefined,
    })
  })

  it('returns 409 when recommendation requires re-analysis', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 12,
      authType: 'session',
    })
    recommendationFns.queueStrategyRecommendationExecution.mockRejectedValue(
      new Error('建议内容已更新，请重新分析后再执行')
    )

    const req = new NextRequest('http://localhost/api/openclaw/strategy/recommendations/rec-2/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    })
    const res = await POST(req, { params: { id: 'rec-2' } })

    expect(res.status).toBe(409)
  })

  it('returns 409 when recommendation is outside execution date window', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 12,
      authType: 'session',
    })
    recommendationFns.queueStrategyRecommendationExecution.mockRejectedValue(
      new Error('T-1建议仅支持执行以下类型（2026-02-24）：adjust_cpc, adjust_budget, expand_keywords, add_negative_keywords, optimize_match_type')
    )

    const req = new NextRequest('http://localhost/api/openclaw/strategy/recommendations/rec-2/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    })
    const res = await POST(req, { params: { id: 'rec-2' } })

    expect(res.status).toBe(409)
  })
})
