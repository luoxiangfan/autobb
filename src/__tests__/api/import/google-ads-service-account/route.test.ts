import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const assignmentFns = vi.hoisted(() => ({
  assertUserCanModifyGoogleAdsAuth: vi.fn(),
}))

const backupFns = vi.hoisted(() => ({
  importGoogleAdsServiceAccountFromBackup: vi.fn(),
}))

vi.mock('@/lib/auth', async () => {
  const { createWithAuthMock } =
    await import('@/__tests__/lib/helpers/campaign-route-with-auth-mock')
  return {
    verifyAuth: authFns.verifyAuth,
    withAuth: (handler: any, options?: { requireAdmin?: boolean }) =>
      createWithAuthMock(authFns.verifyAuth)(handler, options),
  }
})

vi.mock('@/lib/google-ads/auth/assignment', () => ({
  assertUserCanModifyGoogleAdsAuth: assignmentFns.assertUserCanModifyGoogleAdsAuth,
}))

vi.mock('@/lib/google-ads/service-account/backup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads/service-account/backup')>()
  return {
    ...actual,
    importGoogleAdsServiceAccountFromBackup: backupFns.importGoogleAdsServiceAccountFromBackup,
  }
})

import { POST } from '@/app/api/import/google-ads-service-account/route'
import {
  GoogleAdsServiceAccountBackupConflictError,
  GoogleAdsServiceAccountBackupValidationError,
} from '@/lib/google-ads/service-account/backup'

describe('POST /api/import/google-ads-service-account', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 7, role: 'user' },
    })
    assignmentFns.assertUserCanModifyGoogleAdsAuth.mockResolvedValue(undefined)
    backupFns.importGoogleAdsServiceAccountFromBackup.mockResolvedValue({
      serviceAccountId: 'sa-restored',
    })
  })

  it('imports valid backup payload', async () => {
    const req = new NextRequest('http://localhost/api/import/google-ads-service-account', {
      method: 'POST',
      body: JSON.stringify({
        type: 'google_ads_service_account',
        serviceAccount: {
          name: 'Main SA',
          mccCustomerId: '1234567890',
          developerToken: 'dev-token-123456789012345678',
          serviceAccountJson:
            '{"client_email":"sa@test.iam.gserviceaccount.com","private_key":"k"}',
        },
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.serviceAccountId).toBe('sa-restored')
  })

  it('returns 409 on oauth conflict', async () => {
    backupFns.importGoogleAdsServiceAccountFromBackup.mockRejectedValue(
      new GoogleAdsServiceAccountBackupConflictError('OAuth 冲突')
    )

    const req = new NextRequest('http://localhost/api/import/google-ads-service-account', {
      method: 'POST',
      body: JSON.stringify({
        serviceAccount: {
          name: 'Main SA',
          mccCustomerId: '1234567890',
          developerToken: 'dev-token-123456789012345678',
          serviceAccountJson:
            '{"client_email":"sa@test.iam.gserviceaccount.com","private_key":"k"}',
        },
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(409)
  })

  it('returns 400 on validation error', async () => {
    backupFns.importGoogleAdsServiceAccountFromBackup.mockRejectedValue(
      new GoogleAdsServiceAccountBackupValidationError('备份不完整')
    )

    const req = new NextRequest('http://localhost/api/import/google-ads-service-account', {
      method: 'POST',
      body: JSON.stringify({
        serviceAccount: {
          name: 'Main SA',
          mccCustomerId: '1234567890',
          developerToken: 'dev-token-123456789012345678',
          serviceAccountJson:
            '{"client_email":"sa@test.iam.gserviceaccount.com","private_key":"k"}',
        },
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
