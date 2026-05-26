import { beforeEach, describe, expect, it, vi } from 'vitest'

const assignmentFns = vi.hoisted(() => ({
  resolveGoogleAdsCredentialOwnerId: vi.fn(),
  isGoogleAdsAuthShared: vi.fn(),
}))

const oauthFns = vi.hoisted(() => ({
  getUserAuthType: vi.fn(),
  getGoogleAdsCredentials: vi.fn(),
  getGoogleAdsCredentialsRaw: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  queryOne: vi.fn(),
  type: 'sqlite' as const,
}))

const serviceAccountFns = vi.hoisted(() => ({
  getServiceAccountConfig: vi.fn(),
}))

vi.mock('@/lib/google-ads-auth-assignment', () => ({
  resolveGoogleAdsCredentialOwnerId: assignmentFns.resolveGoogleAdsCredentialOwnerId,
  isGoogleAdsAuthShared: assignmentFns.isGoogleAdsAuthShared,
  resolveGoogleAdsApiAccessLevel: vi.fn(async () => 'basic'),
  getGoogleAdsAuthAssignment: vi.fn(),
}))

vi.mock('@/lib/google-ads-oauth', () => ({
  getUserAuthType: oauthFns.getUserAuthType,
  getGoogleAdsCredentials: oauthFns.getGoogleAdsCredentials,
  getGoogleAdsCredentialsRaw: oauthFns.getGoogleAdsCredentialsRaw,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => dbFns),
}))

vi.mock('@/lib/google-ads-service-account', () => ({
  getServiceAccountConfig: serviceAccountFns.getServiceAccountConfig,
}))

import {
  assertNoConflictingGoogleAdsAuth,
  detectGoogleAdsDualStackCredentials,
  getGoogleAdsAuthContext,
  resolveEffectiveServiceAccountId,
  resolveGoogleAdsApiAuthForAccount,
  resolveGoogleAdsApiAuthFromContext,
  resolveGoogleAdsCredentialStatusFields,
  tryGetConfiguredGoogleAdsApiAuthForUser,
} from '@/lib/google-ads-auth-context'

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

describe('resolveGoogleAdsCredentialStatusFields', () => {
  it('fills developerToken and loginCustomerId from service account config', async () => {
    const ctx = {
      userId: 2,
      ownerUserId: 1,
      assignment: null,
      isShared: true,
      canModify: false,
      auth: { authType: 'service_account' as const, serviceAccountId: 'sa-1' },
      oauthCredentials: null,
      serviceAccountConfig: {
        id: 'sa-1',
        name: 'Admin SA',
        mccCustomerId: '1112223333',
        developerToken: 'dev-token',
      },
    }

    const fields = await resolveGoogleAdsCredentialStatusFields(ctx as any)

    expect(fields.hasServiceAccount).toBe(true)
    expect(fields.developerToken).toBe('dev-token')
    expect(fields.loginCustomerId).toBe('1112223333')
    expect(fields.apiAccessLevel).toBe('basic')
  })
})

describe('resolveGoogleAdsApiAuthForAccount', () => {
  it('accepts shared oauth when account row has no refresh_token', async () => {
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
    oauthFns.getGoogleAdsCredentials.mockResolvedValue({ refresh_token: 'rt-shared' })
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue(null)

    const result = await resolveGoogleAdsApiAuthForAccount(2, null)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.apiAuth.authType).toBe('oauth')
      expect(result.apiAuth.refreshToken).toBe('rt-shared')
    }
  })

  it('reports not_configured when oauth credentials lack refresh_token', async () => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 2,
      isShared: false,
      assignment: null,
    })
    oauthFns.getUserAuthType.mockResolvedValue({ authType: 'oauth' })
    oauthFns.getGoogleAdsCredentials.mockResolvedValue({ refresh_token: null })
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue(null)

    const result = await resolveGoogleAdsApiAuthForAccount(2, null)

    expect(result).toEqual({ ok: false, reason: 'not_configured' })
  })
})

describe('resolveEffectiveServiceAccountId', () => {
  it('ignores linked account SA when user auth type is oauth (mutually exclusive)', () => {
    const id = resolveEffectiveServiceAccountId('sa-linked', {
      auth: { authType: 'oauth', serviceAccountId: undefined },
      serviceAccountConfig: null,
    } as any)
    expect(id).toBeUndefined()
  })
})

describe('detectGoogleAdsDualStackCredentials', () => {
  beforeEach(() => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 2,
      isShared: false,
      assignment: null,
    })
  })

  it('reports dualStack when both oauth and active service account exist', async () => {
    dbFns.queryOne.mockResolvedValueOnce({ id: 'sa-1' })
    oauthFns.getGoogleAdsCredentialsRaw.mockResolvedValueOnce({ refresh_token: 'rt' })

    const result = await detectGoogleAdsDualStackCredentials(2)

    expect(result.dualStack).toBe(true)
    expect(result.hasOAuthRefresh).toBe(true)
    expect(result.hasActiveServiceAccount).toBe(true)
  })

  it('reports no dualStack when only oauth exists', async () => {
    dbFns.queryOne.mockResolvedValueOnce(null)
    oauthFns.getGoogleAdsCredentialsRaw.mockResolvedValueOnce({ refresh_token: 'rt' })

    const result = await detectGoogleAdsDualStackCredentials(2)

    expect(result.dualStack).toBe(false)
  })
})

describe('assertNoConflictingGoogleAdsAuth', () => {
  beforeEach(() => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 2,
      isShared: false,
      assignment: null,
    })
  })

  it('rejects oauth save when owner has active service account', async () => {
    dbFns.queryOne.mockResolvedValueOnce({ id: 'sa-1' })

    await expect(assertNoConflictingGoogleAdsAuth(2, 'oauth')).rejects.toThrow(
      '服务账号'
    )
  })

  it('rejects service account save when owner has oauth refresh token', async () => {
    dbFns.queryOne.mockResolvedValueOnce(null)
    oauthFns.getGoogleAdsCredentialsRaw.mockResolvedValueOnce({ refresh_token: 'rt' })

    await expect(assertNoConflictingGoogleAdsAuth(2, 'service_account')).rejects.toThrow(
      'OAuth'
    )
  })

  it('allows oauth save when no service account exists', async () => {
    dbFns.queryOne.mockResolvedValueOnce(null)

    await expect(assertNoConflictingGoogleAdsAuth(2, 'oauth')).resolves.toBeUndefined()
  })
})

describe('tryGetConfiguredGoogleAdsApiAuthForUser', () => {
  it('returns null when oauth credentials lack refresh_token', async () => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 2,
      isShared: false,
      assignment: null,
    })
    oauthFns.getUserAuthType.mockResolvedValue({ authType: 'oauth' })
    oauthFns.getGoogleAdsCredentials.mockResolvedValue({ refresh_token: null })
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue(null)

    const result = await tryGetConfiguredGoogleAdsApiAuthForUser(2)

    expect(result).toBeNull()
  })
})

describe('resolveGoogleAdsApiAuthFromContext', () => {
  it('prefers linked account service account id and loads its MCC', async () => {
    serviceAccountFns.getServiceAccountConfig.mockImplementation(async (_userId: number, id?: string) => {
      if (id === 'sa-linked') {
        return { id: 'sa-linked', mccCustomerId: '9998887777', developerToken: 'tok' }
      }
      return { id: 'sa-default', mccCustomerId: '1112223333', developerToken: 'tok' }
    })

    const fields = await resolveGoogleAdsApiAuthFromContext({
      userId: 2,
      ownerUserId: 1,
      assignment: null,
      isShared: false,
      canModify: true,
      auth: { authType: 'service_account', serviceAccountId: 'sa-default' },
      oauthCredentials: null,
      serviceAccountConfig: {
        id: 'sa-default',
        mccCustomerId: '1112223333',
        developerToken: 'tok',
      },
    } as any, 'sa-linked')

    expect(fields.serviceAccountId).toBe('sa-linked')
    expect(fields.serviceAccountMccId).toBe('9998887777')
  })
})
