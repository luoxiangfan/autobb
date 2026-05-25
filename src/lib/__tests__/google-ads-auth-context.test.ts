import { beforeEach, describe, expect, it, vi } from 'vitest'

const assignmentFns = vi.hoisted(() => ({
  resolveGoogleAdsCredentialOwnerId: vi.fn(),
  isGoogleAdsAuthShared: vi.fn(),
}))

const oauthFns = vi.hoisted(() => ({
  getUserAuthType: vi.fn(),
  getGoogleAdsCredentials: vi.fn(),
}))

const serviceAccountFns = vi.hoisted(() => ({
  getServiceAccountConfig: vi.fn(),
}))

vi.mock('@/lib/google-ads-auth-assignment', () => ({
  resolveGoogleAdsCredentialOwnerId: assignmentFns.resolveGoogleAdsCredentialOwnerId,
  isGoogleAdsAuthShared: assignmentFns.isGoogleAdsAuthShared,
  getGoogleAdsAuthAssignment: vi.fn(),
}))

vi.mock('@/lib/google-ads-oauth', () => ({
  getUserAuthType: oauthFns.getUserAuthType,
  getGoogleAdsCredentials: oauthFns.getGoogleAdsCredentials,
}))

vi.mock('@/lib/google-ads-service-account', () => ({
  getServiceAccountConfig: serviceAccountFns.getServiceAccountConfig,
}))

import { getGoogleAdsAuthContext } from '@/lib/google-ads-auth-context'

describe('getGoogleAdsAuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    assignmentFns.isGoogleAdsAuthShared.mockReturnValue(true)
  })

  it('loads oauth credentials for shared oauth user', async () => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 1,
      isShared: true,
      assignment: {
        userId: 2,
        assignmentMode: 'shared_admin',
        sharedAdminUserId: 1,
        authType: 'oauth',
        configuredBy: 1,
        createdAt: '',
        updatedAt: '',
      },
    })
    oauthFns.getUserAuthType.mockResolvedValue({ authType: 'oauth' })
    oauthFns.getGoogleAdsCredentials.mockResolvedValue({
      refresh_token: 'rt-admin',
      client_id: 'cid',
    })
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue(null)

    const ctx = await getGoogleAdsAuthContext(2)

    expect(ctx.ownerUserId).toBe(1)
    expect(ctx.isShared).toBe(true)
    expect(ctx.canModify).toBe(false)
    expect(ctx.oauthCredentials?.refresh_token).toBe('rt-admin')
    expect(ctx.serviceAccountConfig).toBeNull()
    expect(oauthFns.getGoogleAdsCredentials).toHaveBeenCalledWith(2)
    expect(serviceAccountFns.getServiceAccountConfig).not.toHaveBeenCalled()
  })

  it('loads service account config for shared service account user', async () => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 1,
      isShared: true,
      assignment: {
        userId: 2,
        assignmentMode: 'shared_admin',
        sharedAdminUserId: 1,
        authType: 'service_account',
        configuredBy: 1,
        createdAt: '',
        updatedAt: '',
      },
    })
    oauthFns.getUserAuthType.mockResolvedValue({
      authType: 'service_account',
      serviceAccountId: 'sa-1',
    })
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue({
      id: 'sa-1',
      mccCustomerId: '123',
      developerToken: 'token',
    })

    const ctx = await getGoogleAdsAuthContext(2)

    expect(ctx.auth.authType).toBe('service_account')
    expect(ctx.oauthCredentials).toBeNull()
    expect(ctx.serviceAccountConfig?.id).toBe('sa-1')
    expect(oauthFns.getGoogleAdsCredentials).not.toHaveBeenCalled()
    expect(serviceAccountFns.getServiceAccountConfig).toHaveBeenCalledWith(2, 'sa-1')
  })
})
