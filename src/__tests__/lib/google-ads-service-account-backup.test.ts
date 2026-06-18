import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildGoogleAdsServiceAccountBackupPayload,
  buildServiceAccountJsonForBackup,
  GoogleAdsServiceAccountBackupConflictError,
  GoogleAdsServiceAccountBackupValidationError,
  importGoogleAdsServiceAccountFromBackup,
} from '@/lib/google-ads/service-account/backup'

const authContextFns = vi.hoisted(() => ({
  assertNoConflictingGoogleAdsAuth: vi.fn(),
}))

const serviceAccountFns = vi.hoisted(() => ({
  replaceGoogleAdsServiceAccountForUser: vi.fn(),
  parseServiceAccountJson: vi.fn(),
}))

vi.mock('@/lib/google-ads/auth/context', () => ({
  assertNoConflictingGoogleAdsAuth: authContextFns.assertNoConflictingGoogleAdsAuth,
}))

vi.mock('@/lib/google-ads/service-account/service-account', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/google-ads/service-account/service-account')>()
  return {
    ...actual,
    parseServiceAccountJson: serviceAccountFns.parseServiceAccountJson,
    replaceGoogleAdsServiceAccountForUser: serviceAccountFns.replaceGoogleAdsServiceAccountForUser,
  }
})

vi.mock('@/lib/auth', () => ({
  encrypt: vi.fn((value: string) => `enc:${value}`),
}))

describe('@/lib/google-ads/service-account/backup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authContextFns.assertNoConflictingGoogleAdsAuth.mockResolvedValue(undefined)
    serviceAccountFns.parseServiceAccountJson.mockReturnValue({
      clientEmail: 'sa@test.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
      projectId: 'proj-1',
    })
    serviceAccountFns.replaceGoogleAdsServiceAccountForUser.mockResolvedValue('sa-new-id')
  })

  it('masks sensitive fields when includeSensitive is false', () => {
    const payload = buildGoogleAdsServiceAccountBackupPayload({
      userId: 7,
      includeSensitive: false,
      account: {
        name: 'Main SA',
        mccCustomerId: '1234567890',
        developerToken: 'dev-token-123456789012345678',
        serviceAccountEmail: 'sa@test.iam.gserviceaccount.com',
        privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
        projectId: 'proj-1',
      },
    })

    expect(payload.type).toBe('google_ads_service_account')
    expect(payload.serviceAccount.developerToken).toContain('****')
    expect(payload.serviceAccount.serviceAccountJson).toBeNull()
  })

  it('includes serviceAccountJson when includeSensitive is true', () => {
    const payload = buildGoogleAdsServiceAccountBackupPayload({
      userId: 7,
      includeSensitive: true,
      account: {
        name: 'Main SA',
        mccCustomerId: '1234567890',
        developerToken: 'dev-token-123456789012345678',
        serviceAccountEmail: 'sa@test.iam.gserviceaccount.com',
        privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
        projectId: 'proj-1',
      },
    })

    expect(payload.serviceAccount.serviceAccountJson).toContain('client_email')
    expect(JSON.parse(payload.serviceAccount.serviceAccountJson!)).toMatchObject({
      client_email: 'sa@test.iam.gserviceaccount.com',
    })
  })

  it('imports restorable backup and replaces service account', async () => {
    const json = buildServiceAccountJsonForBackup({
      serviceAccountEmail: 'sa@test.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
      projectId: 'proj-1',
    })

    const result = await importGoogleAdsServiceAccountFromBackup(7, {
      serviceAccount: {
        name: 'Main SA',
        mccCustomerId: '1234567890',
        developerToken: 'dev-token-123456789012345678',
        serviceAccountJson: json,
      },
    })

    expect(result.serviceAccountId).toBe('sa-new-id')
    expect(serviceAccountFns.replaceGoogleAdsServiceAccountForUser).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        name: 'Main SA',
        mccCustomerId: '1234567890',
        serviceAccountEmail: 'sa@test.iam.gserviceaccount.com',
        encryptedPrivateKey: expect.stringContaining('enc:'),
      })
    )
  })

  it('rejects masked backup on import', async () => {
    await expect(
      importGoogleAdsServiceAccountFromBackup(7, {
        serviceAccount: {
          name: 'Main SA',
          mccCustomerId: '1234567890',
          developerToken: 'abcd****wxyz',
          serviceAccountJson: '{"client_email":"x","private_key":"****"}',
        },
      })
    ).rejects.toBeInstanceOf(GoogleAdsServiceAccountBackupValidationError)
  })

  it('returns conflict error when OAuth is already configured', async () => {
    authContextFns.assertNoConflictingGoogleAdsAuth.mockRejectedValue(
      new Error('当前已配置 OAuth 认证，请先在设置页删除 OAuth 后再配置服务账号。')
    )

    await expect(
      importGoogleAdsServiceAccountFromBackup(7, {
        serviceAccount: {
          name: 'Main SA',
          mccCustomerId: '1234567890',
          developerToken: 'dev-token-123456789012345678',
          serviceAccountJson: buildServiceAccountJsonForBackup({
            serviceAccountEmail: 'sa@test.iam.gserviceaccount.com',
            privateKey: 'key',
          }),
        },
      })
    ).rejects.toBeInstanceOf(GoogleAdsServiceAccountBackupConflictError)
  })
})
