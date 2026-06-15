import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const assignmentFns = vi.hoisted(() => ({
  assertUserCanModifyGoogleAdsAuth: vi.fn(),
}))

const settingsStoreFns = vi.hoisted(() => ({
  upsertGoogleAdsOAuthConfigFromSettings: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
  exec: vi.fn(),
  transaction: vi.fn(async (fn: () => Promise<void>) => fn()),
}))

const authContextFns = vi.hoisted(() => ({
  invalidateGoogleAdsAuthContextForCredentialUser: vi.fn(),
}))

vi.mock('@/lib/google-ads/auth/context', () => ({
  invalidateGoogleAdsAuthContextForCredentialUser:
    authContextFns.invalidateGoogleAdsAuthContextForCredentialUser,
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/google-ads/auth/assignment', () => ({
  assertUserCanModifyGoogleAdsAuth: assignmentFns.assertUserCanModifyGoogleAdsAuth,
}))

vi.mock('@/lib/google-ads/settings/settings-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads/settings/settings-store')>()
  return {
    ...actual,
    upsertGoogleAdsOAuthConfigFromSettings: settingsStoreFns.upsertGoogleAdsOAuthConfigFromSettings,
  }
})

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => dbFns),
}))

vi.mock('@/lib/auth', () => ({
  encrypt: vi.fn((value: string) => `enc:${value}`),
}))

import { POST } from '@/app/api/import/settings/route'

describe('POST /api/import/settings google_ads OAuth fields', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 7, role: 'user' },
    })
    assignmentFns.assertUserCanModifyGoogleAdsAuth.mockResolvedValue(undefined)
    settingsStoreFns.upsertGoogleAdsOAuthConfigFromSettings.mockResolvedValue({
      synced: true,
      oauthClientCredentialsChanged: false,
    })
    dbFns.queryOne.mockResolvedValue(undefined)
    dbFns.exec.mockResolvedValue(undefined)
    authContextFns.invalidateGoogleAdsAuthContextForCredentialUser.mockResolvedValue(undefined)
  })

  it('routes google_ads OAuth keys to credentials store instead of system_settings', async () => {
    const req = new NextRequest('http://localhost/api/import/settings', {
      method: 'POST',
      body: JSON.stringify({
        settings: {
          google_ads: {
            client_id: { value: 'cid.apps.googleusercontent.com' },
            client_secret: { value: 'GOCSPX-secret' },
            developer_token: { value: 'dev-token-123456789012345678' },
            login_customer_id: { value: '1234567890' },
          },
          ai: {
            gemini_model: { value: 'gemini-test' },
          },
        },
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(settingsStoreFns.upsertGoogleAdsOAuthConfigFromSettings).toHaveBeenCalledWith(
      7,
      {
        client_id: 'cid.apps.googleusercontent.com',
        client_secret: 'GOCSPX-secret',
        developer_token: 'dev-token-123456789012345678',
        login_customer_id: '1234567890',
      },
      expect.objectContaining({ db: dbFns, skipAuthContextInvalidate: true })
    )
    expect(dbFns.transaction).toHaveBeenCalled()
    expect(dbFns.exec).toHaveBeenCalledTimes(1)
    expect(dbFns.exec.mock.calls[0][0]).toContain('INSERT INTO system_settings')
    expect(dbFns.exec.mock.calls[0][1]).toEqual(
      expect.arrayContaining([7, 'ai', 'gemini_model', 'gemini-test'])
    )
  })

  it('returns 409 when OAuth import conflicts with service account auth', async () => {
    const { GoogleAdsSettingsAuthConflictError } =
      await import('@/lib/google-ads/settings/settings-store')
    settingsStoreFns.upsertGoogleAdsOAuthConfigFromSettings.mockRejectedValueOnce(
      new GoogleAdsSettingsAuthConflictError(
        '当前已配置服务账号认证，请先在设置页删除服务账号后再配置 OAuth。'
      )
    )

    const req = new NextRequest('http://localhost/api/import/settings', {
      method: 'POST',
      body: JSON.stringify({
        settings: {
          google_ads: {
            client_id: { value: 'cid.apps.googleusercontent.com' },
          },
        },
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(409)
    expect(data.error).toContain('服务账号')
    expect(dbFns.exec).not.toHaveBeenCalled()
  })

  it('returns success false when generic settings transaction fails', async () => {
    dbFns.queryOne
      .mockResolvedValueOnce({ id: 1, is_sensitive: 0 })
      .mockResolvedValueOnce({ id: 2, is_sensitive: 0 })
    dbFns.exec.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('db write failed'))

    const req = new NextRequest('http://localhost/api/import/settings', {
      method: 'POST',
      body: JSON.stringify({
        settings: {
          ai: {
            gemini_model: { value: 'gemini-test' },
            gemini_api_key: { value: 'bad-key' },
          },
        },
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(false)
    expect(data.partial).toBe(false)
    expect(data.summary.imported).toBe(0)
    expect(data.summary.errors).toBe(1)
    expect(dbFns.transaction).toHaveBeenCalled()
  })

  it('rolls back oauth and generic when unified transaction fails', async () => {
    dbFns.queryOne.mockResolvedValueOnce({ id: 1, is_sensitive: 0 })
    dbFns.exec.mockRejectedValueOnce(new Error('db write failed'))

    const req = new NextRequest('http://localhost/api/import/settings', {
      method: 'POST',
      body: JSON.stringify({
        settings: {
          google_ads: {
            client_id: { value: 'cid.apps.googleusercontent.com' },
          },
          ai: {
            gemini_model: { value: 'gemini-test' },
          },
        },
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(false)
    expect(data.partial).toBe(false)
    expect(data.summary.imported).toBe(0)
    expect(data.summary.errors).toBe(1)
    expect(settingsStoreFns.upsertGoogleAdsOAuthConfigFromSettings).toHaveBeenCalledWith(
      7,
      { client_id: 'cid.apps.googleusercontent.com' },
      expect.objectContaining({ db: dbFns, skipAuthContextInvalidate: true })
    )
  })

  it('treats blocked refresh_token as warning and keeps success true', async () => {
    const req = new NextRequest('http://localhost/api/import/settings', {
      method: 'POST',
      body: JSON.stringify({
        settings: {
          google_ads: {
            refresh_token: { value: 'rt-should-not-import' },
            client_id: { value: 'cid.apps.googleusercontent.com' },
          },
        },
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.summary.warnings).toBe(1)
    expect(data.warnings?.[0]).toContain('refresh_token')
    expect(settingsStoreFns.upsertGoogleAdsOAuthConfigFromSettings).toHaveBeenCalledWith(
      7,
      { client_id: 'cid.apps.googleusercontent.com' },
      expect.objectContaining({ db: dbFns, skipAuthContextInvalidate: true })
    )
  })
})
