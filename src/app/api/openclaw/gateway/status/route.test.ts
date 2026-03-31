import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/openclaw/gateway/status/route'

const authFns = vi.hoisted(() => ({
  verifyOpenclawSessionAuth: vi.fn(),
}))

const configFns = vi.hoisted(() => ({
  syncOpenclawConfig: vi.fn(),
}))

const gatewayFns = vi.hoisted(() => ({
  getOpenclawGatewaySnapshot: vi.fn(),
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  verifyOpenclawSessionAuth: authFns.verifyOpenclawSessionAuth,
}))

vi.mock('@/lib/openclaw/config', () => ({
  syncOpenclawConfig: configFns.syncOpenclawConfig,
}))

vi.mock('@/lib/openclaw/gateway-ws', () => ({
  getOpenclawGatewaySnapshot: gatewayFns.getOpenclawGatewaySnapshot,
}))

describe('GET /api/openclaw/gateway/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyOpenclawSessionAuth.mockResolvedValue({
      authenticated: true,
      status: 200,
      user: { userId: 1, role: 'admin' },
    })
    configFns.syncOpenclawConfig.mockResolvedValue(undefined)
  })

  it('returns auth error when unauthenticated', async () => {
    authFns.verifyOpenclawSessionAuth.mockResolvedValue({
      authenticated: false,
      status: 401,
      error: 'Unauthorized',
    })

    const res = await GET(new NextRequest('http://localhost/api/openclaw/gateway/status'))
    const payload = await res.json()

    expect(res.status).toBe(401)
    expect(payload.error).toBe('Unauthorized')
    expect(gatewayFns.getOpenclawGatewaySnapshot).not.toHaveBeenCalled()
  })

  it('normalizes missing feishu linked using configured value', async () => {
    gatewayFns.getOpenclawGatewaySnapshot.mockResolvedValue({
      fetchedAt: '2026-02-16T03:00:00.000Z',
      health: {
        ok: true,
        channelOrder: ['feishu', 'whatsapp'],
        channels: {
          feishu: { configured: true, running: true },
          whatsapp: { configured: true, linked: false },
        },
      },
      skills: null,
      errors: [],
    })

    const res = await GET(new NextRequest('http://localhost/api/openclaw/gateway/status'))
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.health.channels.feishu.linked).toBe(true)
    expect(payload.health.channels.whatsapp.linked).toBe(false)
  })

  it('keeps feishu linked when gateway already returns boolean', async () => {
    gatewayFns.getOpenclawGatewaySnapshot.mockResolvedValue({
      fetchedAt: '2026-02-16T03:00:00.000Z',
      health: {
        ok: true,
        channels: {
          feishu: { configured: true, linked: false },
        },
      },
      skills: null,
      errors: [],
    })

    const res = await GET(new NextRequest('http://localhost/api/openclaw/gateway/status'))
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.health.channels.feishu.linked).toBe(false)
  })

  it('normalizes repaired snapshot on force retry path', async () => {
    gatewayFns.getOpenclawGatewaySnapshot
      .mockRejectedValueOnce(new Error('Gateway temporarily unavailable'))
      .mockResolvedValueOnce({
        fetchedAt: '2026-02-16T03:05:00.000Z',
        health: {
          ok: true,
          channels: {
            feishu: { configured: false },
          },
        },
        skills: null,
        errors: [],
      })

    const res = await GET(new NextRequest('http://localhost/api/openclaw/gateway/status?force=1'))
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.recovered).toBe(true)
    expect(payload.health.channels.feishu.linked).toBe(false)
    expect(configFns.syncOpenclawConfig).toHaveBeenCalledWith({
      reason: 'gateway-status-repair',
      actorUserId: 1,
    })
  })
})
