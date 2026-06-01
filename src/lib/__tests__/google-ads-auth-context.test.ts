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

import { defaultOAuthAuthContext } from './helpers/campaign-route-auth-context-mock'
import {
  assertNoConflictingGoogleAdsAuth,
  getGoogleAdsAuthContext,
  hasConfiguredGoogleAdsAuthFromContext,
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
    oauthFns.getGoogleAdsCredentialsRaw.mockResolvedValue({ refresh_token: 'rt-admin' })
    dbFns.queryOne.mockResolvedValue(null)
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue(null)

    const ctx = await getGoogleAdsAuthContext(2)

    expect(ctx.ownerUserId).toBe(1)
    expect(ctx.isShared).toBe(true)
    expect(ctx.canModify).toBe(false)
    expect(ctx.dualStack).toBe(false)
    expect(ctx.oauthCredentials?.refresh_token).toBe('rt-admin')
    expect(ctx.serviceAccountConfig).toBeNull()
    expect(oauthFns.getGoogleAdsCredentials).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ ownerUserId: 1, isShared: true })
    )
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
    oauthFns.getGoogleAdsCredentialsRaw.mockResolvedValue(null)
    dbFns.queryOne.mockResolvedValue(null)

    const ctx = await getGoogleAdsAuthContext(2)

    expect(ctx.dualStack).toBe(false)
    expect(ctx.auth.authType).toBe('service_account')
    expect(ctx.oauthCredentials).toBeNull()
    expect(ctx.serviceAccountConfig?.id).toBe('sa-1')
    expect(oauthFns.getGoogleAdsCredentials).not.toHaveBeenCalled()
    expect(serviceAccountFns.getServiceAccountConfig).toHaveBeenCalledWith(
      2,
      'sa-1',
      expect.objectContaining({ ownerUserId: 1, isShared: true })
    )
  })

  it('sets dualStack when owner has oauth refresh and active service account', async () => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 2,
      isShared: false,
      assignment: null,
    })
    assignmentFns.isGoogleAdsAuthShared.mockReturnValue(false)
    oauthFns.getUserAuthType.mockResolvedValue({ authType: 'oauth' })
    oauthFns.getGoogleAdsCredentials.mockResolvedValue({ refresh_token: 'rt' })
    oauthFns.getGoogleAdsCredentialsRaw.mockResolvedValue({ refresh_token: 'rt' })
    dbFns.queryOne.mockResolvedValue({ id: 'sa-1' })
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue(null)

    const ctx = await getGoogleAdsAuthContext(2)

    expect(ctx.dualStack).toBe(true)
  })

  it('sets dualStack false when owner has only oauth', async () => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 2,
      isShared: false,
      assignment: null,
    })
    assignmentFns.isGoogleAdsAuthShared.mockReturnValue(false)
    oauthFns.getUserAuthType.mockResolvedValue({ authType: 'oauth' })
    oauthFns.getGoogleAdsCredentials.mockResolvedValue({ refresh_token: 'rt' })
    oauthFns.getGoogleAdsCredentialsRaw.mockResolvedValue({ refresh_token: 'rt' })
    dbFns.queryOne.mockResolvedValue(null)
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue(null)

    const ctx = await getGoogleAdsAuthContext(2)

    expect(ctx.dualStack).toBe(false)
  })
})

describe('resolveGoogleAdsCredentialStatusFields', () => {
  it('reports hasCredentials false when dualStack', async () => {
    const fields = await resolveGoogleAdsCredentialStatusFields({
      userId: 2,
      ownerUserId: 2,
      assignment: null,
      isShared: false,
      canModify: true,
      dualStack: true,
      auth: { authType: 'oauth' },
      oauthCredentials: { refresh_token: 'rt' },
      serviceAccountConfig: { id: 'sa-1', developerToken: 'tok', mccCustomerId: '111' },
    } as any)

    expect(fields.hasCredentials).toBe(false)
    expect(fields.hasRefreshToken).toBe(true)
    expect(fields.hasServiceAccount).toBe(true)
  })

  it('fills developerToken and loginCustomerId from service account config', async () => {
    const ctx = {
      userId: 2,
      ownerUserId: 1,
      assignment: null,
      isShared: true,
      canModify: false,
      dualStack: false,
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

describe('resolveGoogleAdsDisplayAuthType', () => {
  it('returns null when dualStack is true', async () => {
    const { resolveGoogleAdsDisplayAuthType } = await import('@/lib/google-ads-auth-context')
    expect(
      resolveGoogleAdsDisplayAuthType({
        dualStack: true,
        auth: { authType: 'oauth' },
      } as Parameters<typeof resolveGoogleAdsDisplayAuthType>[0])
    ).toBeNull()
    expect(
      resolveGoogleAdsDisplayAuthType({
        dualStack: false,
        auth: { authType: 'service_account', serviceAccountId: 'sa-1' },
      } as Parameters<typeof resolveGoogleAdsDisplayAuthType>[0])
    ).toBe('service_account')
  })
})

describe('googleAdsAuthContextDualStackError', () => {
  it('returns warning when dualStack is true', async () => {
    const { googleAdsAuthContextDualStackError, GOOGLE_ADS_DUAL_STACK_WARNING } =
      await import('@/lib/google-ads-auth-context')
    expect(googleAdsAuthContextDualStackError({ dualStack: true })).toBe(
      GOOGLE_ADS_DUAL_STACK_WARNING
    )
    expect(googleAdsAuthContextDualStackError({ dualStack: false })).toBeNull()
  })
})

describe('googleAdsApiAuthValidationErrorMessage', () => {
  it('returns dual-stack warning for dual_stack reason', async () => {
    const { googleAdsApiAuthValidationErrorMessage, GOOGLE_ADS_DUAL_STACK_WARNING } =
      await import('@/lib/google-ads-auth-context')
    expect(googleAdsApiAuthValidationErrorMessage('dual_stack')).toBe(
      GOOGLE_ADS_DUAL_STACK_WARNING
    )
  })
})

describe('hasConfiguredGoogleAdsAuthFromContext', () => {
  it('returns false when dualStack is true even with oauth refresh', () => {
    expect(
      hasConfiguredGoogleAdsAuthFromContext({
        userId: 2,
        ownerUserId: 2,
        assignment: null,
        isShared: false,
        canModify: true,
        dualStack: true,
        auth: { authType: 'oauth' },
        oauthCredentials: { refresh_token: 'rt' },
        serviceAccountConfig: { id: 'sa-1' },
      } as any)
    ).toBe(false)
  })
})

describe('resolveGoogleAdsApiAuthForAccount', () => {
  it('reports dual_stack when context has dualStack', async () => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 2,
      isShared: false,
      assignment: null,
    })
    oauthFns.getUserAuthType.mockResolvedValue({ authType: 'oauth' })
    oauthFns.getGoogleAdsCredentials.mockResolvedValue({ refresh_token: 'rt' })
    oauthFns.getGoogleAdsCredentialsRaw.mockResolvedValue({ refresh_token: 'rt' })
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue(null)
    dbFns.queryOne.mockResolvedValue({ id: 'sa-1' })

    const result = await resolveGoogleAdsApiAuthForAccount(2, null)

    expect(result).toEqual({ ok: false, reason: 'dual_stack' })
  })

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
    oauthFns.getGoogleAdsCredentialsRaw.mockResolvedValue({ refresh_token: 'rt-shared' })
    dbFns.queryOne.mockResolvedValue(null)
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

describe('assertGoogleAdsAuthReadyForApi', () => {
  it('throws dual-stack warning when context has dualStack', async () => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 2,
      isShared: false,
      assignment: null,
    })
    assignmentFns.isGoogleAdsAuthShared.mockReturnValue(false)
    oauthFns.getUserAuthType.mockResolvedValue({ authType: 'oauth' })
    oauthFns.getGoogleAdsCredentials.mockResolvedValue({ refresh_token: 'rt' })
    oauthFns.getGoogleAdsCredentialsRaw.mockResolvedValue({ refresh_token: 'rt' })
    dbFns.queryOne.mockResolvedValue({ id: 'sa-1' })
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue(null)

    const { assertGoogleAdsAuthReadyForApi } = await import('@/lib/google-ads-auth-context')
    await expect(assertGoogleAdsAuthReadyForApi(2)).rejects.toThrow(/OAuth 与服务账号同时存在/)
  })
})

describe('resolveGoogleAdsApiAuthFromContext', () => {
  it('throws when context has dualStack', async () => {
    const { resolveGoogleAdsApiAuthFromContext } = await import('@/lib/google-ads-auth-context')
    await expect(
      resolveGoogleAdsApiAuthFromContext({
        ...defaultOAuthAuthContext,
        dualStack: true,
        oauthCredentials: { refresh_token: 'rt' },
      } as any)
    ).rejects.toThrow(/OAuth 与服务账号同时存在/)
  })

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
      dualStack: false,
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
