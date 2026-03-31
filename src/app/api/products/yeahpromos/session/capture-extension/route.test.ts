import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/products/yeahpromos/session/capture-extension/route'

const authFns = vi.hoisted(() => ({
  verifyProductManagementSessionAuth: vi.fn(),
}))

const ypSessionFns = vi.hoisted(() => ({
  saveYeahPromosSessionCookie: vi.fn(),
  getYeahPromosSessionState: vi.fn(),
  maskSessionId: vi.fn(),
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  verifyProductManagementSessionAuth: authFns.verifyProductManagementSessionAuth,
}))

vi.mock('@/lib/yeahpromos-session', () => ({
  saveYeahPromosSessionCookie: ypSessionFns.saveYeahPromosSessionCookie,
  getYeahPromosSessionState: ypSessionFns.getYeahPromosSessionState,
  maskSessionId: ypSessionFns.maskSessionId,
}))

describe('POST /api/products/yeahpromos/session/capture-extension', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyProductManagementSessionAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 1 },
    })
    ypSessionFns.saveYeahPromosSessionCookie.mockResolvedValue(undefined)
    ypSessionFns.getYeahPromosSessionState.mockResolvedValue({
      hasSession: true,
      isExpired: false,
      capturedAt: '2026-02-27T00:00:00.000Z',
      expiresAt: '2026-02-28T00:00:00.000Z',
      phpSessionId: 'abcd1234session',
    })
    ypSessionFns.maskSessionId.mockReturnValue('abcd****sion')
  })

  it('returns auth error when unauthenticated', async () => {
    authFns.verifyProductManagementSessionAuth.mockResolvedValue({
      authenticated: false,
      error: 'unauthorized',
      status: 401,
    })

    const req = new NextRequest('http://localhost/api/products/yeahpromos/session/capture-extension', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cookie: 'PHPSESSID=abc' }),
    })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(401)
    expect(data.success).toBe(false)
  })

  it('uses authenticated user id and ignores body userId to avoid cross-user overwrite', async () => {
    const req = new NextRequest('http://localhost/api/products/yeahpromos/session/capture-extension', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 999,
        cookie: 'PHPSESSID=abc; test=1',
      }),
    })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(ypSessionFns.saveYeahPromosSessionCookie).toHaveBeenCalledWith({
      userId: 1,
      rawCookie: 'PHPSESSID=abc; test=1',
    })
  })

  it('returns 400 when cookie is missing', async () => {
    const req = new NextRequest('http://localhost/api/products/yeahpromos/session/capture-extension', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.success).toBe(false)
    expect(ypSessionFns.saveYeahPromosSessionCookie).not.toHaveBeenCalled()
  })
})
