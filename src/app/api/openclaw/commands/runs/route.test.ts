import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/openclaw/commands/runs/route'

const authFns = vi.hoisted(() => ({
  resolveOpenclawRequestUser: vi.fn(),
}))

const runsFns = vi.hoisted(() => ({
  listOpenclawCommandRuns: vi.fn(),
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  resolveOpenclawRequestUser: authFns.resolveOpenclawRequestUser,
}))

vi.mock('@/lib/openclaw/commands/runs-service', () => ({
  listOpenclawCommandRuns: runsFns.listOpenclawCommandRuns,
}))

describe('GET /api/openclaw/commands/runs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 7,
      authType: 'gateway-binding',
    })
    runsFns.listOpenclawCommandRuns.mockResolvedValue({
      items: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 1,
      },
      filters: {
        status: null,
        riskLevel: null,
      },
    })
  })

  it('uses query metadata as auth fallback for gateway binding', async () => {
    const req = new NextRequest(
      'http://localhost/api/openclaw/commands/runs?page=2&limit=10&status=failed'
      + '&riskLevel=high&createdAfter=2026-02-09T00:00:00.000Z'
      + '&channel=feishu&sender_open_id=ou_runs_1&account_id=acct_runs_1&tenant_key=tenant_runs_1',
      {
        method: 'GET',
        headers: {
          authorization: 'Bearer gateway-token',
        },
      }
    )

    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(authFns.resolveOpenclawRequestUser).toHaveBeenCalledTimes(1)
    expect(authFns.resolveOpenclawRequestUser.mock.calls[0]?.[1]).toEqual({
      channel: 'feishu',
      senderId: 'ou_runs_1',
      accountId: 'acct_runs_1',
      tenantKey: 'tenant_runs_1',
    })
    expect(runsFns.listOpenclawCommandRuns).toHaveBeenCalledWith({
      userId: 7,
      page: 2,
      limit: 10,
      status: 'failed',
      riskLevel: 'high',
      createdAfter: '2026-02-09T00:00:00.000Z',
    })
  })

  it('returns json 500 when auth resolution throws before listing runs', async () => {
    authFns.resolveOpenclawRequestUser.mockRejectedValueOnce(new Error('db unavailable'))

    const req = new NextRequest(
      'http://localhost/api/openclaw/commands/runs?page=1&limit=10',
      {
        method: 'GET',
        headers: {
          authorization: 'Bearer gateway-token',
        },
      }
    )

    const res = await GET(req)
    const payload = await res.json()

    expect(res.status).toBe(500)
    expect(payload.error).toContain('db unavailable')
    expect(runsFns.listOpenclawCommandRuns).not.toHaveBeenCalled()
  })
})
