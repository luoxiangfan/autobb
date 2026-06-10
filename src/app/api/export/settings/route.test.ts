import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  query: vi.fn(),
}))

const settingsStoreFns = vi.hoisted(() => ({
  overlayGoogleAdsOAuthFieldsForSettingsExport: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => dbFns),
}))

vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn((value: string) => `decrypted:${value}`),
}))

vi.mock('@/lib/google-ads-settings-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads-settings-store')>()
  return {
    ...actual,
    overlayGoogleAdsOAuthFieldsForSettingsExport:
      settingsStoreFns.overlayGoogleAdsOAuthFieldsForSettingsExport,
  }
})

import { GET } from '@/app/api/export/settings/route'

describe('GET /api/export/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 7 },
    })
    dbFns.query.mockResolvedValue([
      {
        category: 'ai',
        key: 'gemini_model',
        value: 'gemini-test',
        encrypted_value: null,
        data_type: 'string',
        is_sensitive: 0,
        is_required: 0,
        description: null,
      },
      {
        category: 'google_ads',
        key: 'client_id',
        value: 'stale-from-system-settings',
        encrypted_value: null,
        data_type: 'string',
        is_sensitive: 0,
        is_required: 0,
        description: null,
      },
    ])
    settingsStoreFns.overlayGoogleAdsOAuthFieldsForSettingsExport.mockImplementation(
      async (exportData) => {
        exportData.google_ads = {
          client_id: {
            value: 'cid.apps.googleusercontent.com',
            dataType: 'string',
            isSensitive: false,
            description: null,
          },
        }
      }
    )
  })

  it('skips legacy google_ads system_settings keys and overlays credential store fields', async () => {
    const req = new NextRequest('http://localhost/api/export/settings')

    const res = await GET(req)
    const payload = JSON.parse(await res.text())

    expect(res.status).toBe(200)
    expect(payload.settings.ai.gemini_model.value).toBe('gemini-test')
    expect(payload.settings.google_ads.client_id.value).toBe('cid.apps.googleusercontent.com')
    expect(payload.notes.googleAdsOAuthRequiresReauth).toContain('refresh_token')
    expect(payload.notes.googleAdsServiceAccountNotIncluded).toContain('服务账号')
    expect(settingsStoreFns.overlayGoogleAdsOAuthFieldsForSettingsExport).toHaveBeenCalledWith(
      expect.objectContaining({
        ai: expect.any(Object),
      }),
      7,
      { includeSensitive: false }
    )
  })
})
