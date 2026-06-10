import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const assignmentFns = vi.hoisted(() => ({
  assertUserCanModifyGoogleAdsAuth: vi.fn(),
}))

const serviceAccountFns = vi.hoisted(() => ({
  getOwnServiceAccountConfigForBackup: vi.fn(),
}))

const backupFns = vi.hoisted(() => ({
  buildGoogleAdsServiceAccountBackupPayload: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/google-ads-auth-assignment', () => ({
  assertUserCanModifyGoogleAdsAuth: assignmentFns.assertUserCanModifyGoogleAdsAuth,
}))

vi.mock('@/lib/google-ads-service-account', () => ({
  getOwnServiceAccountConfigForBackup: serviceAccountFns.getOwnServiceAccountConfigForBackup,
}))

vi.mock('@/lib/google-ads-service-account-backup', () => ({
  buildGoogleAdsServiceAccountBackupPayload: backupFns.buildGoogleAdsServiceAccountBackupPayload,
}))

import { GET } from '@/app/api/export/google-ads-service-account/route'

describe('GET /api/export/google-ads-service-account', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 7, role: 'user' },
    })
    assignmentFns.assertUserCanModifyGoogleAdsAuth.mockResolvedValue(undefined)
    serviceAccountFns.getOwnServiceAccountConfigForBackup.mockResolvedValue({
      name: 'Main SA',
      mccCustomerId: '1234567890',
      developerToken: 'dev-token-123456789012345678',
      serviceAccountEmail: 'sa@test.iam.gserviceaccount.com',
      privateKey: 'private-key',
      projectId: 'proj-1',
    })
    backupFns.buildGoogleAdsServiceAccountBackupPayload.mockReturnValue({
      version: '1.0',
      type: 'google_ads_service_account',
      serviceAccount: { name: 'Main SA' },
    })
  })

  it('exports service account backup json', async () => {
    const req = new NextRequest(
      'http://localhost/api/export/google-ads-service-account?include_sensitive=true'
    )

    const res = await GET(req)
    const payload = JSON.parse(await res.text())

    expect(res.status).toBe(200)
    expect(payload.type).toBe('google_ads_service_account')
    expect(backupFns.buildGoogleAdsServiceAccountBackupPayload).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, includeSensitive: true })
    )
  })

  it('returns 404 when user has no service account', async () => {
    serviceAccountFns.getOwnServiceAccountConfigForBackup.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/export/google-ads-service-account')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.error).toContain('未配置')
  })
})
