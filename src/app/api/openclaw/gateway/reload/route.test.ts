import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/openclaw/gateway/reload/route'

const authFns = vi.hoisted(() => ({
  verifyOpenclawSessionAuth: vi.fn(),
}))

const configFns = vi.hoisted(() => ({
  syncOpenclawConfig: vi.fn(),
}))

const gatewayFns = vi.hoisted(() => ({
  getOpenclawGatewaySnapshot: vi.fn(),
  requestOpenclawGatewayRestart: vi.fn(),
}))

const auditFns = vi.hoisted(() => ({
  auditOpenclawAiAuthOverrides: vi.fn(),
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  verifyOpenclawSessionAuth: authFns.verifyOpenclawSessionAuth,
}))

vi.mock('@/lib/openclaw/config', () => ({
  syncOpenclawConfig: configFns.syncOpenclawConfig,
}))

vi.mock('@/lib/openclaw/gateway-ws', () => ({
  getOpenclawGatewaySnapshot: gatewayFns.getOpenclawGatewaySnapshot,
  requestOpenclawGatewayRestart: gatewayFns.requestOpenclawGatewayRestart,
}))

vi.mock('@/lib/openclaw/ai-auth-audit', () => ({
  auditOpenclawAiAuthOverrides: auditFns.auditOpenclawAiAuthOverrides,
}))

describe('POST /api/openclaw/gateway/reload', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authFns.verifyOpenclawSessionAuth.mockResolvedValue({
      authenticated: true,
      status: 200,
      user: { userId: 1, role: 'admin' },
    })
    configFns.syncOpenclawConfig.mockResolvedValue(undefined)
    gatewayFns.getOpenclawGatewaySnapshot.mockResolvedValue({
      fetchedAt: '2026-02-08T00:00:00.000Z',
      health: { ok: true },
      skills: null,
      errors: [],
    })
    gatewayFns.requestOpenclawGatewayRestart.mockResolvedValue({
      requestedAt: '2026-02-08T00:00:00.000Z',
      restart: { ok: true },
      path: '/tmp/openclaw.json',
    })
    auditFns.auditOpenclawAiAuthOverrides.mockReturnValue([])
  })

  it('returns auth error when unauthenticated', async () => {
    authFns.verifyOpenclawSessionAuth.mockResolvedValue({
      authenticated: false,
      status: 401,
      error: 'Unauthorized',
    })

    const req = new NextRequest('http://localhost/api/openclaw/gateway/reload', {
      method: 'POST',
    })
    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(401)
    expect(payload.error).toBe('Unauthorized')
    expect(configFns.syncOpenclawConfig).not.toHaveBeenCalled()
  })

  it('blocks non-admin users', async () => {
    authFns.verifyOpenclawSessionAuth.mockResolvedValue({
      authenticated: true,
      status: 200,
      user: { userId: 3, role: 'member' },
    })

    const req = new NextRequest('http://localhost/api/openclaw/gateway/reload', {
      method: 'POST',
    })
    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(403)
    expect(payload.error).toContain('仅管理员可执行配置热加载')
    expect(configFns.syncOpenclawConfig).not.toHaveBeenCalled()
  })

  it('syncs config and returns refreshed gateway status', async () => {
    const req = new NextRequest('http://localhost/api/openclaw/gateway/reload', {
      method: 'POST',
    })
    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.gatewayStatus).toEqual(
      expect.objectContaining({
        success: true,
        fetchedAt: '2026-02-08T00:00:00.000Z',
      })
    )
    expect(configFns.syncOpenclawConfig).toHaveBeenCalledWith({ reason: 'openclaw-manual-hot-reload' })
    expect(gatewayFns.requestOpenclawGatewayRestart).toHaveBeenCalledWith({
      note: 'OpenClaw 控制台手动执行配置热加载',
    })
    expect(gatewayFns.getOpenclawGatewaySnapshot).toHaveBeenCalledWith({ force: true })
  })

  it('returns success with warning when gateway status check fails', async () => {
    gatewayFns.getOpenclawGatewaySnapshot.mockRejectedValue(new Error('Gateway unavailable'))

    const req = new NextRequest('http://localhost/api/openclaw/gateway/reload', {
      method: 'POST',
    })
    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.gatewayStatus).toEqual(
      expect.objectContaining({ success: false, error: 'Gateway unavailable' })
    )
  })

  it('returns success with warning when restart trigger fails', async () => {
    gatewayFns.requestOpenclawGatewayRestart.mockRejectedValue(new Error('restart failed'))

    const req = new NextRequest('http://localhost/api/openclaw/gateway/reload', {
      method: 'POST',
    })
    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.restartRequested).toBe(false)
    expect(payload.restartError).toContain('restart failed')
    expect(payload.message).toContain('重启触发失败')
  })

  it('returns 500 when config sync fails', async () => {
    configFns.syncOpenclawConfig.mockRejectedValue(new Error('sync failed'))

    const req = new NextRequest('http://localhost/api/openclaw/gateway/reload', {
      method: 'POST',
    })
    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(500)
    expect(payload.success).toBe(false)
    expect(payload.error).toContain('sync failed')
    expect(gatewayFns.requestOpenclawGatewayRestart).not.toHaveBeenCalled()
    expect(gatewayFns.getOpenclawGatewaySnapshot).not.toHaveBeenCalled()
  })

  it('includes AI auth override warnings in reload payload', async () => {
    configFns.syncOpenclawConfig.mockResolvedValue({
      configPath: '/tmp/.openclaw/openclaw.json',
      config: {
        models: {
          providers: {
            openai: { apiKey: 'sk-live' },
          },
        },
      },
    })
    auditFns.auditOpenclawAiAuthOverrides.mockReturnValue([
      {
        providerId: 'openai',
        source: 'auth-profile',
        sourceLabel: 'auth-profiles: openai:default',
        profileIds: ['openai:default'],
        message: 'Provider "openai" 当前优先使用 auth-profiles，Providers JSON 里的 apiKey 不会生效。',
        suggestion: '请清理 /tmp/.openclaw/agents/main/agent/auth-profiles.json 中该 provider 的 profile 后再热加载。',
      },
    ])

    const req = new NextRequest('http://localhost/api/openclaw/gateway/reload', {
      method: 'POST',
    })
    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.aiAuthOverrideWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: 'openai',
          source: 'auth-profile',
        }),
      ])
    )
  })
})
