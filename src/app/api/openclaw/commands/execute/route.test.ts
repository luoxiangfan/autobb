import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/openclaw/commands/execute/route'

const authFns = vi.hoisted(() => ({
  resolveOpenclawRequestUser: vi.fn(),
}))

const commandFns = vi.hoisted(() => ({
  executeOpenclawCommand: vi.fn(),
}))

const correlationFns = vi.hoisted(() => ({
  resolveOpenclawParentRequestId: vi.fn(),
  resolveOpenclawParentRequestIdFromHeaders: vi.fn(),
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  resolveOpenclawRequestUser: authFns.resolveOpenclawRequestUser,
}))

vi.mock('@/lib/openclaw/commands/command-service', () => ({
  executeOpenclawCommand: commandFns.executeOpenclawCommand,
}))

vi.mock('@/lib/openclaw/request-correlation', () => ({
  resolveOpenclawParentRequestId: correlationFns.resolveOpenclawParentRequestId,
  resolveOpenclawParentRequestIdFromHeaders: correlationFns.resolveOpenclawParentRequestIdFromHeaders,
}))

describe('POST /api/openclaw/commands/execute', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authFns.resolveOpenclawRequestUser.mockResolvedValue({
      userId: 42,
      authType: 'gateway-binding',
    })
    correlationFns.resolveOpenclawParentRequestIdFromHeaders.mockReturnValue({
      parentRequestId: null,
      source: 'none',
    })
    correlationFns.resolveOpenclawParentRequestId.mockResolvedValue(null)
    commandFns.executeOpenclawCommand.mockResolvedValue({
      status: 'queued',
      runId: 'run-1',
    })
  })

  it('uses body metadata as auth fallback for gateway binding', async () => {
    const req = new NextRequest('http://localhost/api/openclaw/commands/execute', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer gateway-token',
      },
      body: JSON.stringify({
        method: 'POST',
        path: '/api/offers/extract',
        channel: 'feishu',
        sender_open_id: 'ou_abc',
        account_id: 'acct_123',
        tenant_key: 'tenant_456',
        body: {
          affiliate_link: 'https://example.com/offer',
        },
      }),
    })

    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(authFns.resolveOpenclawRequestUser).toHaveBeenCalledTimes(1)
    expect(authFns.resolveOpenclawRequestUser.mock.calls[0]?.[1]).toEqual({
      channel: 'feishu',
      senderId: 'ou_abc',
      accountId: 'acct_123',
      tenantKey: 'tenant_456',
    })
    expect(commandFns.executeOpenclawCommand).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      channel: 'feishu',
      senderId: 'ou_abc',
      path: '/api/offers/extract',
      method: 'POST',
    }))
  })

  it('returns json 500 when auth resolution throws before command execution', async () => {
    authFns.resolveOpenclawRequestUser.mockRejectedValueOnce(new Error('users table missing'))

    const req = new NextRequest('http://localhost/api/openclaw/commands/execute', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer gateway-token',
      },
      body: JSON.stringify({
        method: 'POST',
        path: '/api/offers/extract',
      }),
    })

    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(500)
    expect(payload.error).toContain('users table missing')
    expect(commandFns.executeOpenclawCommand).not.toHaveBeenCalled()
  })
})
