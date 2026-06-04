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
  query: vi.fn(),
  type: 'sqlite' as const,
}))

const serviceAccountFns = vi.hoisted(() => ({
  getServiceAccountConfig: vi.fn(),
}))

vi.mock('@/lib/google-ads-auth-assignment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads-auth-assignment')>()
  return {
    ...actual,
    resolveGoogleAdsCredentialOwnerId: assignmentFns.resolveGoogleAdsCredentialOwnerId,
    isGoogleAdsAuthShared: assignmentFns.isGoogleAdsAuthShared,
    getGoogleAdsAuthAssignment: vi.fn(),
  }
})

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

vi.mock('@/lib/redis-client', () => ({
  getRedisClient: vi.fn(() => null),
}))

import { defaultOAuthAuthContext } from './helpers/campaign-route-auth-context-mock'
import { oauthCredentialsLookStripped } from '@/lib/google-ads-auth-context-cache'
import {
  assertNoConflictingGoogleAdsAuth,
  clearMemoryAuthContextCacheForTests,
  getGoogleAdsAuthContext,
  getGoogleAdsAuthContextMetadata,
  hasConfiguredGoogleAdsAuthFromContext,
  invalidateGoogleAdsAuthContextCache,
  invalidateGoogleAdsAuthContextCacheForOwner,
  invalidateGoogleAdsAuthContextForCredentialUser,
  peekMemoryAuthContextCacheForTests,
  resetGoogleAdsAuthContextGenerationForTests,
  resolveGoogleAdsApiAccessLevel,
  resolveEffectiveServiceAccountId,
  resolveGoogleAdsApiAuthForAccount,
  resolveGoogleAdsApiAuthFromContext,
  resolveGoogleAdsCredentialStatusFields,
  tryGetConfiguredGoogleAdsApiAuthForUser,
} from '@/lib/google-ads-auth-context'

function clearGoogleAdsAuthContextTestCache(): void {
  resetGoogleAdsAuthContextGenerationForTests()
  clearMemoryAuthContextCacheForTests()
  for (const userId of [1, 2, 7]) {
    invalidateGoogleAdsAuthContextCache(userId)
  }
}

describe('getGoogleAdsAuthContext', () => {
  beforeEach(() => {
    clearGoogleAdsAuthContextTestCache()
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

  it('stores stripped secrets in process memory cache and hydrates on subsequent read', async () => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 7,
      isShared: false,
      assignment: null,
    })
    assignmentFns.isGoogleAdsAuthShared.mockReturnValue(false)
    oauthFns.getUserAuthType.mockResolvedValue({ authType: 'oauth' })
    oauthFns.getGoogleAdsCredentials.mockResolvedValue({
      refresh_token: 'rt-secret',
      client_id: 'cid',
      client_secret: 'sec',
      developer_token: 'dev',
    })
    oauthFns.getGoogleAdsCredentialsRaw.mockResolvedValue({ refresh_token: 'rt-secret' })
    dbFns.queryOne.mockResolvedValue(null)
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue(null)

    const first = await getGoogleAdsAuthContext(7)
    expect(first.oauthCredentials?.refresh_token).toBe('rt-secret')

    const peeked = peekMemoryAuthContextCacheForTests(7)
    expect(peeked?.secretsStripped).toBe(true)
    expect(peeked?.oauthHasRefreshToken).toBe(true)
    expect(oauthCredentialsLookStripped(peeked?.oauthCredentials)).toBe(true)

    oauthFns.getGoogleAdsCredentials.mockClear()
    const second = await getGoogleAdsAuthContext(7)
    expect(second.oauthCredentials?.refresh_token).toBe('rt-secret')
    expect(oauthFns.getGoogleAdsCredentials).not.toHaveBeenCalled()
  })

  it('resolveGoogleAdsApiAccessLevel reads slim cache without hydrating', async () => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 7,
      isShared: false,
      assignment: null,
    })
    assignmentFns.isGoogleAdsAuthShared.mockReturnValue(false)
    oauthFns.getUserAuthType.mockResolvedValue({ authType: 'oauth' })
    oauthFns.getGoogleAdsCredentials.mockResolvedValue({
      refresh_token: 'rt-secret',
      client_id: 'cid',
      api_access_level: 'basic',
    })
    oauthFns.getGoogleAdsCredentialsRaw.mockResolvedValue({ refresh_token: 'rt-secret' })
    dbFns.queryOne.mockResolvedValue(null)
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue(null)

    await getGoogleAdsAuthContext(7)
    oauthFns.getGoogleAdsCredentials.mockClear()

    await expect(resolveGoogleAdsApiAccessLevel(7)).resolves.toBe('basic')
    expect(oauthFns.getGoogleAdsCredentials).not.toHaveBeenCalled()
  })

  it('getGoogleAdsAuthContextMetadata supports hasConfigured without hydrate', async () => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 7,
      isShared: false,
      assignment: null,
    })
    assignmentFns.isGoogleAdsAuthShared.mockReturnValue(false)
    oauthFns.getUserAuthType.mockResolvedValue({ authType: 'oauth' })
    oauthFns.getGoogleAdsCredentials.mockResolvedValue({
      refresh_token: 'rt-secret',
      client_id: 'cid',
    })
    oauthFns.getGoogleAdsCredentialsRaw.mockResolvedValue({ refresh_token: 'rt-secret' })
    dbFns.queryOne.mockResolvedValue(null)
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue(null)

    await getGoogleAdsAuthContext(7)
    oauthFns.getGoogleAdsCredentials.mockClear()

    const slim = await getGoogleAdsAuthContextMetadata(7)
    expect(slim.secretsStripped).toBe(true)
    expect(hasConfiguredGoogleAdsAuthFromContext(slim)).toBe(true)
    expect(oauthFns.getGoogleAdsCredentials).not.toHaveBeenCalled()
  })

  it('commitAuthContextCache skips write when generation invalidated during load', async () => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 7,
      isShared: false,
      assignment: null,
    })
    assignmentFns.isGoogleAdsAuthShared.mockReturnValue(false)
    oauthFns.getUserAuthType.mockResolvedValue({ authType: 'oauth' })

    let loadCount = 0
    oauthFns.getGoogleAdsCredentials.mockImplementation(async () => {
      loadCount += 1
      if (loadCount === 1) {
        invalidateGoogleAdsAuthContextCache(7)
      }
      return {
        refresh_token: loadCount === 1 ? 'stale-rt' : 'fresh-rt',
        client_id: 'cid',
      }
    })
    oauthFns.getGoogleAdsCredentialsRaw.mockResolvedValue({ refresh_token: 'rt' })
    dbFns.queryOne.mockResolvedValue(null)
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue(null)

    const ctx = await getGoogleAdsAuthContext(7)
    expect(ctx.oauthCredentials?.refresh_token).toBe('fresh-rt')
    expect(peekMemoryAuthContextCacheForTests(7)).toBeNull()
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
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue({ id: 'sa-1', name: 'Dual SA' })

    const ctx = await getGoogleAdsAuthContext(2)

    expect(ctx.dualStack).toBe(true)
    expect(ctx.serviceAccountConfig).toEqual({ id: 'sa-1', name: 'Dual SA' })
    expect(serviceAccountFns.getServiceAccountConfig).toHaveBeenCalledWith(
      2,
      undefined,
      expect.objectContaining({ ownerUserId: 2 })
    )
  })

  it('loads oauth credentials for dual-stack cleanup when auth preference is service_account', async () => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 2,
      isShared: false,
      assignment: null,
    })
    assignmentFns.isGoogleAdsAuthShared.mockReturnValue(false)
    oauthFns.getUserAuthType.mockResolvedValue({
      authType: 'service_account',
      serviceAccountId: 'sa-1',
    })
    oauthFns.getGoogleAdsCredentials.mockResolvedValue({
      refresh_token: 'rt-dual',
      client_id: 'cid',
    })
    oauthFns.getGoogleAdsCredentialsRaw.mockResolvedValue({ refresh_token: 'rt-dual' })
    dbFns.queryOne.mockResolvedValue({ id: 'sa-1' })
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue({ id: 'sa-1', name: 'Dual SA' })

    const ctx = await getGoogleAdsAuthContext(2)

    expect(ctx.dualStack).toBe(true)
    expect(ctx.oauthCredentials).toEqual(
      expect.objectContaining({ refresh_token: 'rt-dual' })
    )
    expect(oauthFns.getGoogleAdsCredentials).toHaveBeenCalled()
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

  it('reloads fresh context when invalidated during in-flight load', async () => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 2,
      isShared: false,
      assignment: null,
    })
    assignmentFns.isGoogleAdsAuthShared.mockReturnValue(false)
    oauthFns.getUserAuthType.mockResolvedValue({ authType: 'oauth' })
    oauthFns.getGoogleAdsCredentialsRaw.mockResolvedValue(null)
    dbFns.queryOne.mockResolvedValue(undefined)
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue(null)

    let resolveSlow: (value: { refresh_token: string }) => void = () => {}
    oauthFns.getGoogleAdsCredentials.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSlow = resolve
        })
    )

    const loadPromise = getGoogleAdsAuthContext(2)
    invalidateGoogleAdsAuthContextCache(2)
    oauthFns.getGoogleAdsCredentials.mockResolvedValue({ refresh_token: 'fresh-rt' })
    resolveSlow({ refresh_token: 'stale-rt' })

    const ctx = await loadPromise

    expect(ctx.oauthCredentials?.refresh_token).toBe('fresh-rt')
  })

  it('detects dualStack when oauth snapshot lacks refresh but owner DB has refresh and SA', async () => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 2,
      isShared: false,
      assignment: {
        userId: 2,
        assignmentMode: 'own',
        sharedAdminUserId: null,
        authType: 'oauth',
        configuredBy: 2,
        createdAt: '',
        updatedAt: '',
      },
    })
    assignmentFns.isGoogleAdsAuthShared.mockReturnValue(false)
    oauthFns.getUserAuthType.mockResolvedValue({ authType: 'oauth' })
    oauthFns.getGoogleAdsCredentials.mockResolvedValue(null)
    oauthFns.getGoogleAdsCredentialsRaw.mockResolvedValue({ refresh_token: 'rt' })
    dbFns.queryOne.mockResolvedValue({ id: 'sa-1' })
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue({ id: 'sa-1', name: 'Dual SA' })

    const ctx = await getGoogleAdsAuthContext(2)

    expect(ctx.dualStack).toBe(true)
    expect(ctx.serviceAccountConfig).toEqual({ id: 'sa-1', name: 'Dual SA' })
    expect(oauthFns.getGoogleAdsCredentialsRaw).toHaveBeenCalled()
  })
})

describe('resolveGoogleAdsCredentialStatusFields', () => {
  it('reports hasCredentials false when dualStack', () => {
    const fields = resolveGoogleAdsCredentialStatusFields({
      userId: 2,
      ownerUserId: 2,
      assignment: null,
      isShared: false,
      canModify: true,
      dualStack: true,
      auth: { authType: 'oauth' },
      oauthCredentials: { refresh_token: 'rt' },
      serviceAccountConfig: { id: 'sa-1', developerToken: 'tok', mccCustomerId: '111' },
      apiAccessLevel: null,
    } as any)

    expect(fields.hasCredentials).toBe(false)
    expect(fields.hasRefreshToken).toBe(true)
    expect(fields.hasServiceAccount).toBe(true)
  })

  it('fills developerToken and loginCustomerId from service account config', () => {
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
        updatedAt: '2026-01-01 00:00:00',
      },
      apiAccessLevel: 'basic',
    }

    const fields = resolveGoogleAdsCredentialStatusFields(ctx as any)

    expect(fields.hasServiceAccount).toBe(true)
    expect(fields.developerToken).toBe('dev-token')
    expect(fields.loginCustomerId).toBe('1112223333')
    expect(fields.apiAccessLevel).toBe('basic')
    expect(fields.lastVerifiedAt).toBe('2026-01-01 00:00:00')
    expect(fields.isActive).toBe(true)
  })

  it('normalizes oauth is_active for postgres boolean', () => {
    const fields = resolveGoogleAdsCredentialStatusFields({
      userId: 2,
      ownerUserId: 2,
      assignment: null,
      isShared: false,
      canModify: true,
      dualStack: false,
      auth: { authType: 'oauth' },
      oauthCredentials: {
        refresh_token: 'rt',
        is_active: true,
        last_verified_at: '2026-01-02',
      },
      serviceAccountConfig: null,
      apiAccessLevel: 'explorer',
    } as any)

    expect(fields.isActive).toBe(true)
    expect(fields.lastVerifiedAt).toBe('2026-01-02')
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
  })

  it('returns null when auth is not configured', async () => {
    const { resolveGoogleAdsDisplayAuthType } = await import('@/lib/google-ads-auth-context')
    expect(
      resolveGoogleAdsDisplayAuthType({
        dualStack: false,
        auth: {},
        oauthCredentials: null,
        serviceAccountConfig: null,
      } as Parameters<typeof resolveGoogleAdsDisplayAuthType>[0])
    ).toBeNull()
  })

  it('returns authType when configured', async () => {
    const { resolveGoogleAdsDisplayAuthType } = await import('@/lib/google-ads-auth-context')
    expect(
      resolveGoogleAdsDisplayAuthType({
        dualStack: false,
        auth: { authType: 'service_account', serviceAccountId: 'sa-1' },
        oauthCredentials: null,
        serviceAccountConfig: { id: 'sa-1' },
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
  beforeEach(() => {
    clearGoogleAdsAuthContextTestCache()
    vi.clearAllMocks()
  })

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
  beforeEach(() => {
    clearGoogleAdsAuthContextTestCache()
    vi.clearAllMocks()
  })

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
  beforeEach(() => {
    clearGoogleAdsAuthContextTestCache()
    vi.clearAllMocks()
  })

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

describe('resolveGoogleAdsApiAuthType', () => {
  it('infers service_account when authType omitted and context is SA', async () => {
    const { resolveGoogleAdsApiAuthType } = await import('@/lib/google-ads-auth-context')
    expect(
      resolveGoogleAdsApiAuthType(
        {},
        {
          ...defaultOAuthAuthContext,
          auth: { authType: 'service_account', serviceAccountId: 'sa-1' },
          oauthCredentials: null,
          serviceAccountConfig: { id: 'sa-1', mccCustomerId: '111', developerToken: 'tok' },
        } as any
      )
    ).toBe('service_account')
  })

  it('rejects explicit oauth when context is service_account', async () => {
    const { resolveGoogleAdsApiAuthType } = await import('@/lib/google-ads-auth-context')
    expect(() =>
      resolveGoogleAdsApiAuthType(
        { authType: 'oauth' },
        {
          ...defaultOAuthAuthContext,
          auth: { authType: 'service_account', serviceAccountId: 'sa-1' },
          oauthCredentials: null,
          serviceAccountConfig: { id: 'sa-1' },
        } as any
      )
    ).toThrow(/服务账号认证/)
  })

  it('infers oauth from credential hints when auth.authType is empty', async () => {
    const { resolveGoogleAdsApiAuthType } = await import('@/lib/google-ads-auth-context')
    expect(
      resolveGoogleAdsApiAuthType(
        {},
        {
          ...defaultOAuthAuthContext,
          auth: {},
          oauthCredentials: { refresh_token: 'rt' },
          serviceAccountConfig: null,
        } as any
      )
    ).toBe('oauth')
  })

  it('infers service_account from credential hints when auth.authType is empty', async () => {
    const { resolveGoogleAdsApiAuthType } = await import('@/lib/google-ads-auth-context')
    expect(
      resolveGoogleAdsApiAuthType(
        {},
        {
          ...defaultOAuthAuthContext,
          auth: {},
          oauthCredentials: null,
          serviceAccountConfig: { id: 'sa-1', mccCustomerId: '111', developerToken: 'tok' },
        } as any
      )
    ).toBe('service_account')
  })
})

describe('resolveGoogleAdsApiAuthFromContext', () => {
  it('throws when context is not configured', async () => {
    const { resolveGoogleAdsApiAuthFromContext } = await import('@/lib/google-ads-auth-context')
    await expect(
      resolveGoogleAdsApiAuthFromContext({
        ...defaultOAuthAuthContext,
        dualStack: false,
        auth: {},
        oauthCredentials: null,
        serviceAccountConfig: null,
      } as any)
    ).rejects.toThrow(/认证未配置或已失效/)
  })

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

describe('invalidateGoogleAdsAuthContextCacheForOwner', () => {
  beforeEach(() => {
    clearGoogleAdsAuthContextTestCache()
    vi.clearAllMocks()
    dbFns.query.mockResolvedValue([{ user_id: 2 }, { user_id: 7 }])
  })

  it('busts owner and shared_admin dependents', async () => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 1,
      isShared: false,
      assignment: null,
    })
    oauthFns.getUserAuthType.mockResolvedValue('oauth')
    oauthFns.getGoogleAdsCredentials.mockResolvedValue({ refresh_token: 'rt' })
    oauthFns.getGoogleAdsCredentialsRaw.mockResolvedValue(null)
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue(null)

    await getGoogleAdsAuthContext(1)
    await getGoogleAdsAuthContext(2)
    expect(assignmentFns.resolveGoogleAdsCredentialOwnerId).toHaveBeenCalledTimes(2)

    await invalidateGoogleAdsAuthContextCacheForOwner(1)

    expect(dbFns.query).toHaveBeenCalledWith(
      expect.stringContaining('shared_admin_user_id'),
      [1]
    )

    await getGoogleAdsAuthContext(1)
    await getGoogleAdsAuthContext(2)
    expect(assignmentFns.resolveGoogleAdsCredentialOwnerId).toHaveBeenCalledTimes(4)
  })
})

describe('invalidateGoogleAdsAuthContextForCredentialUser', () => {
  beforeEach(() => {
    clearGoogleAdsAuthContextTestCache()
    vi.clearAllMocks()
    dbFns.query.mockResolvedValue([])
  })

  it('resolves owner then cascades cache bust', async () => {
    assignmentFns.resolveGoogleAdsCredentialOwnerId.mockResolvedValue({
      ownerUserId: 5,
      isShared: false,
      assignment: null,
    })
    oauthFns.getUserAuthType.mockResolvedValue('oauth')
    oauthFns.getGoogleAdsCredentials.mockResolvedValue({ refresh_token: 'rt' })
    oauthFns.getGoogleAdsCredentialsRaw.mockResolvedValue(null)
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue(null)

    await getGoogleAdsAuthContext(5)
    expect(assignmentFns.resolveGoogleAdsCredentialOwnerId).toHaveBeenCalledTimes(1)

    await invalidateGoogleAdsAuthContextForCredentialUser(5)

    await getGoogleAdsAuthContext(5)
    expect(assignmentFns.resolveGoogleAdsCredentialOwnerId).toHaveBeenCalledTimes(3)
  })
})
