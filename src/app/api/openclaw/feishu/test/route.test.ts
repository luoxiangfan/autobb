import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/openclaw/feishu/test/route'

const authFns = vi.hoisted(() => ({
  verifyOpenclawSessionAuth: vi.fn(),
}))

const settingsFns = vi.hoisted(() => ({
  getOpenclawSettingsMap: vi.fn(),
}))

const feishuApiFns = vi.hoisted(() => ({
  getTenantAccessToken: vi.fn(),
  feishuRequest: vi.fn(),
  resolveFeishuApiBase: vi.fn(),
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  verifyOpenclawSessionAuth: authFns.verifyOpenclawSessionAuth,
}))

vi.mock('@/lib/openclaw/settings', () => ({
  getOpenclawSettingsMap: settingsFns.getOpenclawSettingsMap,
}))

vi.mock('@/lib/openclaw/feishu-api', () => ({
  getTenantAccessToken: feishuApiFns.getTenantAccessToken,
  feishuRequest: feishuApiFns.feishuRequest,
  resolveFeishuApiBase: feishuApiFns.resolveFeishuApiBase,
}))

describe('openclaw feishu test route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authFns.verifyOpenclawSessionAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 7, role: 'member' },
    })
    settingsFns.getOpenclawSettingsMap.mockResolvedValue({
      feishu_app_id: 'cli_xxx',
      feishu_app_secret: 'sec_xxx',
      feishu_domain: 'feishu',
      feishu_target: 'ou_target_123',
    })
    feishuApiFns.getTenantAccessToken.mockResolvedValue('tenant_token_xxx')
    feishuApiFns.resolveFeishuApiBase.mockReturnValue('https://open.feishu.cn/open-apis')
    feishuApiFns.feishuRequest.mockResolvedValue({ bot: { app_name: 'OpenClaw Bot' } })
  })

  it('returns 400 when app secret is missing', async () => {
    settingsFns.getOpenclawSettingsMap.mockResolvedValue({
      feishu_app_id: 'cli_xxx',
      feishu_app_secret: '',
      feishu_domain: 'feishu',
      feishu_target: 'ou_target_123',
    })

    const req = new NextRequest('http://localhost/api/openclaw/feishu/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'ou_target_123' }),
    })

    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(400)
    expect(payload.error).toContain('请先填写飞书 App Secret')
  })

  it('returns 400 when target format is invalid', async () => {
    const req = new NextRequest('http://localhost/api/openclaw/feishu/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'bad-target' }),
    })

    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(400)
    expect(payload.error).toContain('推送目标格式不正确')
  })

  it('tests open_id target without chat lookup', async () => {
    const req = new NextRequest('http://localhost/api/openclaw/feishu/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'ou_target_123' }),
    })

    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.details.receiveIdType).toBe('open_id')
    expect(feishuApiFns.feishuRequest).toHaveBeenCalledTimes(1)
  })

  it('tests chat_id target with chat reachability lookup', async () => {
    feishuApiFns.feishuRequest
      .mockResolvedValueOnce({ bot: { app_name: 'OpenClaw Bot' } })
      .mockResolvedValueOnce({ data: { chat_id: 'oc_chat_123' } })

    const req = new NextRequest('http://localhost/api/openclaw/feishu/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'oc_chat_123' }),
    })

    const res = await POST(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.details.receiveIdType).toBe('chat_id')
    expect(feishuApiFns.feishuRequest).toHaveBeenCalledTimes(2)
    expect(feishuApiFns.feishuRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: expect.stringContaining('/im/v1/chats/oc_chat_123'),
      })
    )
  })
})
