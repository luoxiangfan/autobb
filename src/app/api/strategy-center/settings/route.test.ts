import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT } from '@/app/api/strategy-center/settings/route'

const authFns = vi.hoisted(() => ({
  verifyStrategyCenterSessionAuth: vi.fn(),
}))

const settingsFns = vi.hoisted(() => ({
  getSettingsByCategory: vi.fn(),
  getUserOnlySettingsByCategory: vi.fn(),
  updateSettings: vi.fn(),
}))

const configFns = vi.hoisted(() => ({
  syncOpenclawConfig: vi.fn(),
}))

vi.mock('@/lib/openclaw/request-auth', () => ({
  verifyStrategyCenterSessionAuth: authFns.verifyStrategyCenterSessionAuth,
}))

vi.mock('@/lib/settings', () => ({
  getSettingsByCategory: settingsFns.getSettingsByCategory,
  getUserOnlySettingsByCategory: settingsFns.getUserOnlySettingsByCategory,
  updateSettings: settingsFns.updateSettings,
}))

vi.mock('@/lib/openclaw/config', () => ({
  syncOpenclawConfig: configFns.syncOpenclawConfig,
}))

describe('strategy-center settings route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authFns.verifyStrategyCenterSessionAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 4, role: 'member' },
    })

    settingsFns.getSettingsByCategory.mockResolvedValue([
      { key: 'feishu_target' },
      { key: 'feishu_allow_from' },
      { key: 'feishu_dm_policy' },
    ])
    settingsFns.getUserOnlySettingsByCategory.mockResolvedValue([])
    settingsFns.updateSettings.mockResolvedValue(undefined)
    configFns.syncOpenclawConfig.mockResolvedValue(undefined)
  })

  it('auto injects feishu allowlist and dm policy when personal target is updated', async () => {
    settingsFns.getUserOnlySettingsByCategory.mockResolvedValue([
      { key: 'feishu_allow_from', value: '["ou_existing_1"]' },
    ])

    const req = new NextRequest('http://localhost/api/strategy-center/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        updates: [
          { key: 'feishu_target', value: 'feishu:ou_target_123' },
        ],
      }),
    })

    const res = await PUT(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(settingsFns.updateSettings).toHaveBeenCalledTimes(1)
    expect(settingsFns.updateSettings).toHaveBeenCalledWith(
      expect.arrayContaining([
        { category: 'openclaw', key: 'feishu_target', value: 'feishu:ou_target_123' },
        { category: 'openclaw', key: 'feishu_dm_policy', value: 'allowlist' },
        { category: 'openclaw', key: 'feishu_allow_from', value: '["ou_existing_1","ou_target_123"]' },
      ]),
      4
    )
    expect(configFns.syncOpenclawConfig).toHaveBeenCalledWith({
      reason: 'strategy-center-settings',
      actorUserId: 4,
    })
  })

  it('does not inject dm allowlist for chat/group targets', async () => {
    const req = new NextRequest('http://localhost/api/strategy-center/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        updates: [
          { key: 'feishu_target', value: 'chat:oc_group_123' },
        ],
      }),
    })

    const res = await PUT(req)
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(settingsFns.updateSettings).toHaveBeenCalledWith(
      [{ category: 'openclaw', key: 'feishu_target', value: 'chat:oc_group_123' }],
      4
    )
  })
})
