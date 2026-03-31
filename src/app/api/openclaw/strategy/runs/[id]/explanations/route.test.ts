import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/openclaw/strategy/runs/[id]/explanations/route'

const authFns = vi.hoisted(() => ({
  resolveOpenclawRequestUser: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
  query: vi.fn(),
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  resolveOpenclawRequestUser: authFns.resolveOpenclawRequestUser,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    queryOne: dbFns.queryOne,
    query: dbFns.query,
  })),
}))

describe('GET /api/openclaw/strategy/runs/:id/explanations', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 7,
      authType: 'session',
    })

    dbFns.queryOne.mockResolvedValue({
      id: 'run-123',
      mode: 'auto',
      status: 'completed',
      run_date: '2026-02-07',
      stats_json: JSON.stringify({
        reason: 'daily_spend_cap',
        campaignsPublished: 1,
        campaignsPaused: 2,
        publishFailed: 1,
        budgetAllocation: { method: 'thompson_sampling' },
      }),
      error_message: null,
      started_at: '2026-02-07T01:00:00.000Z',
      completed_at: '2026-02-07T01:05:00.000Z',
      created_at: '2026-02-07T01:00:00.000Z',
    })

    dbFns.query.mockResolvedValue([
      {
        id: 11,
        action_type: 'publish_campaign',
        target_type: 'offer',
        target_id: '100',
        status: 'success',
        request_json: JSON.stringify({ offerId: 100 }),
        response_json: JSON.stringify({ campaignId: 200 }),
        error_message: null,
        created_at: '2026-02-07T01:02:00.000Z',
      },
      {
        id: 12,
        action_type: 'spend_cap_circuit_break',
        target_type: 'run',
        target_id: 'run-123',
        status: 'success',
        request_json: JSON.stringify({ dailySpendCap: 100 }),
        response_json: JSON.stringify({ paused: 2 }),
        error_message: null,
        created_at: '2026-02-07T01:03:00.000Z',
      },
    ])
  })

  it('returns 403 when unauthorized', async () => {
    authFns.resolveOpenclawRequestUser.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/openclaw/strategy/runs/run-123/explanations')
    const res = await GET(req, { params: { id: 'run-123' } })

    expect(res.status).toBe(403)
  })

  it('returns 404 when run is missing', async () => {
    dbFns.queryOne.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/openclaw/strategy/runs/run-404/explanations')
    const res = await GET(req, { params: { id: 'run-404' } })

    expect(res.status).toBe(404)
  })

  it('returns structured explanations for the strategy run', async () => {
    const req = new NextRequest('http://localhost/api/openclaw/strategy/runs/run-123/explanations')
    const res = await GET(req, { params: { id: 'run-123' } })
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.run.id).toBe('run-123')
    expect(payload.data.summary.reason).toBe('daily_spend_cap')
    expect(payload.data.explanations.publish.length).toBeGreaterThan(0)
    expect(payload.data.explanations.circuitBreak.length).toBeGreaterThan(0)
    expect(payload.meta.actionCount).toBe(2)
  })
})
