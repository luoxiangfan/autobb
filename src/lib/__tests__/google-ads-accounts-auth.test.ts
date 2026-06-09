import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultOAuthApiAuth,
  defaultOAuthAuthContext,
} from './helpers/campaign-route-auth-context-mock'
import { invalidateGoogleAdsAuthContextCache } from '@/lib/google-ads-auth-context'
import {
  createGoogleAdsLinkedAccountPrepareCache,
  clearGoogleAdsLinkedAccountPrepareCache,
  developerTokenLooksInvalid,
  healAccountsRouteDeveloperToken,
  linkedSaPrepareCacheKey,
  loadOAuthGoogleAdsCallBundleForContext,
  prepareGoogleAdsApiCallForLinkedAccountCached,
  resolveAccountsRouteAuthBundle,
  prepareGoogleAdsAccountApiCall,
  resolveAndHealSyncUserCredentials,
  resolveOAuthApiCredentialsForUser,
  resolveOAuthClientCredentialsForUser,
  resolveOAuthRefreshToken,
} from '../google-ads-accounts-auth'
import * as routeAuthModule from '../google-ads-accounts-route-auth'

const authContextFns = vi.hoisted(() => ({
  getGoogleAdsAuthContext: vi.fn(),
  resolveGoogleAdsApiAuthFromContext: vi.fn(),
  resolveGoogleAdsApiAuthForAccount: vi.fn(),
}))

const serviceAccountFns = vi.hoisted(() => ({
  getServiceAccountConfig: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  exec: vi.fn(),
}))

const settingsStoreFns = vi.hoisted(() => ({
  getGoogleAdsOAuthConfigValue: vi.fn(),
}))

vi.mock('../google-ads-settings-store', () => ({
  getGoogleAdsOAuthConfigValue: settingsStoreFns.getGoogleAdsOAuthConfigValue,
}))

vi.mock('../google-ads-auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../google-ads-auth-context')>()
  return {
    ...actual,
    getGoogleAdsAuthContext: authContextFns.getGoogleAdsAuthContext,
    resolveGoogleAdsApiAuthFromContext: authContextFns.resolveGoogleAdsApiAuthFromContext,
    resolveGoogleAdsApiAuthForAccount: authContextFns.resolveGoogleAdsApiAuthForAccount,
  }
})

vi.mock('../google-ads-service-account', () => ({
  getServiceAccountConfig: serviceAccountFns.getServiceAccountConfig,
}))

vi.mock('../db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'postgres',
    exec: dbFns.exec,
  })),
}))

const oauthCredentialsFull = {
  refresh_token: 'oauth-refresh-token',
  login_customer_id: '9988776655',
  client_id: 'test-client-id.apps.googleusercontent.com',
  client_secret: 'GOCSPX-test-client-secret',
  developer_token: 'abcdefghijklmnopqrstuvwxyz123456',
}

const oauthAuthContextFull = {
  ...defaultOAuthAuthContext,
  oauthCredentials: oauthCredentialsFull,
}

function healAuthContext(overrides?: Partial<typeof oauthAuthContextFull>) {
  return { ...oauthAuthContextFull, userId: 1, ownerUserId: 1, ...overrides }
}

describe('resolveOAuthRefreshToken', () => {
  it('prefers apiAuth refresh over oauth credentials row', () => {
    expect(
      resolveOAuthRefreshToken(
        { ...defaultOAuthApiAuth, refreshToken: 'api-refresh' },
        oauthCredentialsFull
      )
    ).toBe('api-refresh')
  })

  it('falls back to oauth credentials refresh_token', () => {
    expect(
      resolveOAuthRefreshToken({ ...defaultOAuthApiAuth, refreshToken: '' }, oauthCredentialsFull)
    ).toBe('oauth-refresh-token')
  })

  it('returns empty for service_account auth type', () => {
    expect(
      resolveOAuthRefreshToken(
        { authType: 'service_account', refreshToken: '', serviceAccountId: 'sa-1' },
        oauthCredentialsFull
      )
    ).toBe('')
  })
})

describe('resolveAccountsRouteAuthBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authContextFns.resolveGoogleAdsApiAuthFromContext.mockResolvedValue(defaultOAuthApiAuth)
    dbFns.exec.mockResolvedValue(undefined)
  })

  it('returns 409 when auth context has dual stack', async () => {
    const result = await resolveAccountsRouteAuthBundle({
      userId: 1,
      authContext: { ...oauthAuthContextFull, dualStack: true },
      authType: 'oauth',
      serviceAccountId: null,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(result.body.code).toBe('DUAL_STACK_CONFLICT')
    expect(authContextFns.resolveGoogleAdsApiAuthFromContext).not.toHaveBeenCalled()
  })

  it('resolves OAuth bundle with user-level refresh token', async () => {
    const result = await resolveAccountsRouteAuthBundle({
      userId: 1,
      authContext: oauthAuthContextFull,
      authType: 'oauth',
      serviceAccountId: null,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bundle.authType).toBe('oauth')
    expect(result.bundle.credentials.refresh_token).toBe('oauth-refresh-token')
    expect(result.bundle.credentials.developer_token).toBe(oauthCredentialsFull.developer_token)
    expect(result.bundle.loginCustomerId).toBe('9988776655')
  })

  it('returns 404 when OAuth refresh token is missing', async () => {
    authContextFns.resolveGoogleAdsApiAuthFromContext.mockResolvedValue({
      ...defaultOAuthApiAuth,
      refreshToken: '',
    })

    const result = await resolveAccountsRouteAuthBundle({
      userId: 1,
      authContext: {
        ...oauthAuthContextFull,
        oauthCredentials: { ...oauthCredentialsFull, refresh_token: '' },
      },
      authType: 'oauth',
      serviceAccountId: null,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(404)
    expect(result.body.code).toBe('CREDENTIALS_NOT_CONFIGURED')
  })

  it('returns 401 with OAUTH_REFRESH_MISSING when metadata indicates refresh but tokens are empty', async () => {
    authContextFns.resolveGoogleAdsApiAuthFromContext.mockResolvedValue({
      ...defaultOAuthApiAuth,
      refreshToken: '',
    })

    const result = await resolveAccountsRouteAuthBundle({
      userId: 1,
      authContext: {
        ...oauthAuthContextFull,
        oauthHasRefreshToken: true,
        oauthCredentials: { ...oauthCredentialsFull, refresh_token: '' },
      },
      authType: 'oauth',
      serviceAccountId: null,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(401)
    expect(result.body.code).toBe('OAUTH_REFRESH_MISSING')
  })

  it('returns 400 when service account id is missing', async () => {
    const result = await resolveAccountsRouteAuthBundle({
      userId: 1,
      authContext: oauthAuthContextFull,
      authType: 'service_account',
      serviceAccountId: null,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(400)
  })

  it('returns 404 when service account config is missing', async () => {
    authContextFns.resolveGoogleAdsApiAuthFromContext.mockResolvedValue({
      authType: 'service_account',
      refreshToken: '',
      serviceAccountId: 'sa-missing',
    })
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue(null)

    const result = await resolveAccountsRouteAuthBundle({
      userId: 1,
      authContext: oauthAuthContextFull,
      authType: 'service_account',
      serviceAccountId: 'sa-missing',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(404)
  })

  it('resolves service account bundle with developer token from config', async () => {
    authContextFns.resolveGoogleAdsApiAuthFromContext.mockResolvedValue({
      authType: 'service_account',
      refreshToken: '',
      serviceAccountId: 'sa-1',
      serviceAccountMccId: '1111222233',
    })
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue({
      id: 'sa-1',
      developerToken: 'sa-developer-token-abcdefghijklmnopqrst',
      mccCustomerId: '1111222233',
    })

    const result = await resolveAccountsRouteAuthBundle({
      userId: 1,
      authContext: oauthAuthContextFull,
      authType: 'service_account',
      serviceAccountId: 'sa-1',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bundle.authType).toBe('service_account')
    expect(result.bundle.credentials.developer_token).toBe(
      'sa-developer-token-abcdefghijklmnopqrst'
    )
    expect(result.bundle.loginCustomerId).toBe('1111222233')
  })
})

describe('healAccountsRouteDeveloperToken', () => {
  const validSettingToken = 'abcdefghijklmnopqrstuvwxyz1234567890ab'

  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.exec.mockResolvedValue(undefined)
    settingsStoreFns.getGoogleAdsOAuthConfigValue.mockResolvedValue(validSettingToken)
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      ...defaultOAuthAuthContext,
      userId: 1,
      ownerUserId: 1,
      dualStack: false,
    })
  })

  it('returns DUAL_STACK_CONFLICT when authContext has dualStack (shared user perspective)', async () => {
    const result = await healAccountsRouteDeveloperToken({
      credentials: { ...oauthCredentialsFull },
      authType: 'oauth',
      ownerUserId: 7,
      clientSecret: oauthCredentialsFull.client_secret,
      authContext: healAuthContext({
        userId: 2,
        ownerUserId: 7,
        isShared: true,
        dualStack: true,
        serviceAccountConfig: { id: 'sa-1' },
      }),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('DUAL_STACK_CONFLICT')
    expect(authContextFns.getGoogleAdsAuthContext).not.toHaveBeenCalled()
    expect(settingsStoreFns.getGoogleAdsOAuthConfigValue).not.toHaveBeenCalled()
  })

  it('returns dual-stack error when authContext has dualStack', async () => {
    const result = await healAccountsRouteDeveloperToken({
      credentials: { ...oauthCredentialsFull },
      authType: 'oauth',
      ownerUserId: 7,
      clientSecret: oauthCredentialsFull.client_secret,
      authContext: {
        userId: 7,
        ownerUserId: 7,
        assignment: null,
        isShared: false,
        canModify: true,
        dualStack: true,
        auth: { authType: 'oauth' as const },
        oauthCredentials: oauthCredentialsFull,
        serviceAccountConfig: null,
      },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('DUAL_STACK_CONFLICT')
    expect(result.message).toContain('OAuth 与服务账号同时存在')
    expect(settingsStoreFns.getGoogleAdsOAuthConfigValue).not.toHaveBeenCalled()
  })

  it('passes when developer token already looks valid', async () => {
    const credentials = {
      client_id: oauthCredentialsFull.client_id,
      client_secret: oauthCredentialsFull.client_secret,
      developer_token: oauthCredentialsFull.developer_token,
    }

    const result = await healAccountsRouteDeveloperToken({
      credentials,
      authType: 'oauth',
      ownerUserId: 1,
      clientSecret: credentials.client_secret,
      authContext: healAuthContext(),
    })

    expect(result.ok).toBe(true)
    expect(settingsStoreFns.getGoogleAdsOAuthConfigValue).not.toHaveBeenCalled()
  })

  it('heals OAuth developer_token from settings and updates credentials table', async () => {
    const credentials = {
      client_id: oauthCredentialsFull.client_id,
      client_secret: oauthCredentialsFull.client_secret,
      developer_token: oauthCredentialsFull.client_secret,
    }

    expect(developerTokenLooksInvalid(credentials.developer_token, credentials.client_secret)).toBe(
      true
    )

    const result = await healAccountsRouteDeveloperToken({
      credentials,
      authType: 'oauth',
      ownerUserId: 1,
      clientSecret: credentials.client_secret,
      authContext: healAuthContext(),
    })

    expect(result.ok).toBe(true)
    expect(credentials.developer_token).toBe(validSettingToken)
    expect(dbFns.exec).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE google_ads_credentials'),
      expect.any(Array)
    )
  })

  it('heals service account developer_token in memory and database', async () => {
    const serviceAccountConfig = { developerToken: 'GOCSPX-wrong-token-used-as-dev' }
    const credentials = {
      client_id: 'placeholder',
      client_secret: 'GOCSPX-placeholder-secret',
      developer_token: serviceAccountConfig.developerToken,
    }

    const result = await healAccountsRouteDeveloperToken({
      credentials,
      authType: 'service_account',
      ownerUserId: 1,
      clientSecret: credentials.client_secret,
      serviceAccountId: 'sa-1',
      serviceAccountConfig,
      authContext: healAuthContext({
        auth: { authType: 'service_account' as const, serviceAccountId: 'sa-1' },
        oauthCredentials: null,
        serviceAccountConfig: { id: 'sa-1', developerToken: serviceAccountConfig.developerToken },
      }),
    })

    expect(result.ok).toBe(true)
    expect(credentials.developer_token).toBe(validSettingToken)
    expect(serviceAccountConfig.developerToken).toBe(validSettingToken)
    expect(dbFns.exec).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE google_ads_service_accounts'),
      expect.any(Array)
    )
  })

  it('returns DEVELOPER_TOKEN_INVALID when settings has no valid token', async () => {
    settingsStoreFns.getGoogleAdsOAuthConfigValue.mockResolvedValue('')

    const credentials = {
      client_id: oauthCredentialsFull.client_id,
      client_secret: oauthCredentialsFull.client_secret,
      developer_token: oauthCredentialsFull.client_secret,
    }

    const result = await healAccountsRouteDeveloperToken({
      credentials,
      authType: 'oauth',
      ownerUserId: 1,
      clientSecret: credentials.client_secret,
      authContext: healAuthContext(),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('DEVELOPER_TOKEN_INVALID')
  })
})

describe('resolveAndHealSyncUserCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authContextFns.resolveGoogleAdsApiAuthFromContext.mockResolvedValue(defaultOAuthApiAuth)
    dbFns.exec.mockResolvedValue(undefined)
  })

  it('returns dual-stack error without calling accounts bundle', async () => {
    const result = await resolveAndHealSyncUserCredentials({
      userId: 1,
      authContext: { ...oauthAuthContextFull, dualStack: true },
      authType: 'oauth',
      serviceAccountId: null,
    })

    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining('OAuth 与服务账号同时存在'),
    })
    expect(authContextFns.resolveGoogleAdsApiAuthFromContext).not.toHaveBeenCalled()
  })

  it('returns healed oauth user credentials', async () => {
    const result = await resolveAndHealSyncUserCredentials({
      userId: 1,
      authContext: oauthAuthContextFull,
      authType: 'oauth',
      serviceAccountId: null,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.userCredentials.developer_token).toBe(oauthCredentialsFull.developer_token)
    expect(result.userCredentials.login_customer_id).toBe('9988776655')
  })

  it('heals developer_token using credential ownerUserId for shared auth', async () => {
    const sharedAuthContext = {
      ...oauthAuthContextFull,
      userId: 2,
      ownerUserId: 1,
      isShared: true,
      canModify: false,
      oauthCredentials: {
        ...oauthCredentialsFull,
        developer_token: 'GOCSPX-wrong-secret-used-as-token',
      },
    }
    settingsStoreFns.getGoogleAdsOAuthConfigValue.mockResolvedValue(
      'abcdefghijklmnopqrstuvwxyz1234567890'
    )

    const result = await resolveAndHealSyncUserCredentials({
      userId: 2,
      authContext: sharedAuthContext,
      authType: 'oauth',
      serviceAccountId: null,
    })

    expect(result.ok).toBe(true)
    expect(settingsStoreFns.getGoogleAdsOAuthConfigValue).toHaveBeenCalledWith(1, 'developer_token')
    expect(dbFns.exec).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE google_ads_credentials'),
      expect.arrayContaining(['abcdefghijklmnopqrstuvwxyz1234567890', 1])
    )
  })

  it('returns healed service account user credentials', async () => {
    authContextFns.resolveGoogleAdsApiAuthFromContext.mockResolvedValue({
      authType: 'service_account',
      refreshToken: '',
      serviceAccountId: 'sa-1',
      serviceAccountMccId: '1111222233',
    })
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue({
      id: 'sa-1',
      developerToken: 'sa-developer-token-abcdefghijklmnopqrst',
      mccCustomerId: '1111222233',
    })

    const result = await resolveAndHealSyncUserCredentials({
      userId: 1,
      authContext: oauthAuthContextFull,
      authType: 'service_account',
      serviceAccountId: 'sa-1',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.userCredentials.developer_token).toBe('sa-developer-token-abcdefghijklmnopqrst')
    expect(result.serviceAccountConfig?.id).toBe('sa-1')
  })
})

describe('resolveOAuthApiCredentialsForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue(oauthAuthContextFull)
    authContextFns.resolveGoogleAdsApiAuthFromContext.mockResolvedValue(defaultOAuthApiAuth)
    dbFns.exec.mockResolvedValue(undefined)
  })

  it('returns oauth client credentials with login_customer_id', async () => {
    const result = await resolveOAuthApiCredentialsForUser(1)

    expect(authContextFns.getGoogleAdsAuthContext).toHaveBeenCalledWith(1)
    expect(result).toEqual({
      client_id: oauthCredentialsFull.client_id,
      client_secret: oauthCredentialsFull.client_secret,
      developer_token: oauthCredentialsFull.developer_token,
      login_customer_id: '9988776655',
    })
  })

  it('throws when user is configured for service account', async () => {
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      ...oauthAuthContextFull,
      auth: { authType: 'service_account', serviceAccountId: 'sa-1' },
    })

    await expect(resolveOAuthApiCredentialsForUser(1)).rejects.toThrow(/服务账号认证/)
  })

  it('throws dual-stack error before heal', async () => {
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      ...oauthAuthContextFull,
      dualStack: true,
    })

    await expect(resolveOAuthApiCredentialsForUser(1)).rejects.toThrow(/OAuth 与服务账号同时存在/)
  })

  it('throws when login_customer_id is missing', async () => {
    authContextFns.resolveGoogleAdsApiAuthFromContext.mockResolvedValue({
      ...defaultOAuthApiAuth,
      oauthLoginCustomerId: undefined,
    })
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      ...oauthAuthContextFull,
      oauthCredentials: { ...oauthCredentialsFull, login_customer_id: '' },
    })

    await expect(resolveOAuthApiCredentialsForUser(1)).rejects.toThrow(/login_customer_id/)
  })
})

describe('prepareGoogleAdsAccountApiCall', () => {
  beforeEach(() => {
    authContextFns.resolveGoogleAdsApiAuthFromContext.mockClear()
  })

  it('returns dual-stack error at entry without resolving api auth', async () => {
    const dualStackContext = {
      userId: 7,
      ownerUserId: 7,
      assignment: null,
      isShared: false,
      canModify: true,
      dualStack: true,
      auth: { authType: 'oauth' as const },
      oauthCredentials: { ...oauthCredentialsFull },
      serviceAccountConfig: null,
    }

    const result = await prepareGoogleAdsAccountApiCall({
      authContext: dualStackContext,
      linkedServiceAccountId: null,
    })

    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining('OAuth 与服务账号同时存在'),
    })
    expect(authContextFns.resolveGoogleAdsApiAuthFromContext).not.toHaveBeenCalled()
  })
})

describe('resolveOAuthClientCredentialsForUser OAuth path alignment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settingsStoreFns.getGoogleAdsOAuthConfigValue.mockResolvedValue(
      'abcdefghijklmnopqrstuvwxyz1234567890ab'
    )
  })

  it('returns the same client fields as loadOAuthGoogleAdsCallBundleForContext', async () => {
    const bundle = await loadOAuthGoogleAdsCallBundleForContext({
      userId: oauthAuthContextFull.userId,
      authContext: oauthAuthContextFull,
    })
    expect(bundle.ok).toBe(true)
    expect(bundle.bundle?.oauthCredentials).toBeTruthy()

    const clientCreds = await resolveOAuthClientCredentialsForUser(oauthAuthContextFull.userId, {
      existingAuthContext: oauthAuthContextFull,
    })

    expect(clientCreds).toEqual({
      ...bundle.bundle!.oauthCredentials,
      login_customer_id: bundle.bundle!.oauthLoginCustomerId ?? '',
    })
  })

  it('reuses existing auth context without resolveAndHealSyncUserCredentials', async () => {
    const syncSpy = vi.spyOn(routeAuthModule, 'resolveAndHealSyncUserCredentials')

    await resolveOAuthClientCredentialsForUser(oauthAuthContextFull.userId, {
      existingAuthContext: oauthAuthContextFull,
    })

    expect(syncSpy).not.toHaveBeenCalled()
    expect(authContextFns.getGoogleAdsAuthContext).not.toHaveBeenCalled()
    syncSpy.mockRestore()
  })

  it('rejects service account context', async () => {
    const saContext = {
      ...oauthAuthContextFull,
      auth: { authType: 'service_account' as const, serviceAccountId: 'sa-1' },
      oauthCredentials: null,
      serviceAccountConfig: { id: 'sa-1', mccCustomerId: '111', developerToken: 'tok' },
    }

    await expect(
      resolveOAuthClientCredentialsForUser(saContext.userId, {
        existingAuthContext: saContext,
      })
    ).rejects.toThrow(/服务账号认证/)
  })
})

describe('GoogleAdsLinkedAccountPrepareCache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValue({
      ok: true,
      ctx: { ...oauthAuthContextFull, userId: 1, ownerUserId: 1 },
      apiAuth: defaultOAuthApiAuth,
    })
    settingsStoreFns.getGoogleAdsOAuthConfigValue.mockResolvedValue(
      'abcdefghijklmnopqrstuvwxyz1234567890ab'
    )
  })

  it('linkedSaPrepareCacheKey isolates userId and linked SA', () => {
    expect(linkedSaPrepareCacheKey(2, 'sa-1')).toBe('2\0sa-1')
    expect(linkedSaPrepareCacheKey(2, null)).toBe('2\0')
    expect(linkedSaPrepareCacheKey(3, 'sa-1')).not.toBe(linkedSaPrepareCacheKey(2, 'sa-1'))
  })

  it('prepareGoogleAdsApiCallForLinkedAccountCached reuses slim entry and rehydrates on hit', async () => {
    const cache = createGoogleAdsLinkedAccountPrepareCache()

    const first = await prepareGoogleAdsApiCallForLinkedAccountCached(1, 'sa-1', cache)
    const second = await prepareGoogleAdsApiCallForLinkedAccountCached(1, 'sa-1', cache)

    expect(first).not.toBe(second)
    expect(first.ok && second.ok).toBe(true)
    if (first.ok && second.ok) {
      expect(second.refreshToken).toBe(first.refreshToken)
      expect(second.oauthCredentials).toEqual(first.oauthCredentials)
    }
    expect(authContextFns.resolveGoogleAdsApiAuthForAccount).toHaveBeenCalledTimes(1)
    expect(authContextFns.resolveGoogleAdsApiAuthForAccount).toHaveBeenCalledWith(1, 'sa-1')

    const slim = cache.prepareByLinkedSa.get('1\0sa-1')
    expect(slim?.authContext.secretsStripped).toBe(true)
    expect(slim?.apiAuth.refreshToken).toBe('')
    expect(slim?.generationAtPrepare).toBe(0)
  })

  it('prepareGoogleAdsApiCallForLinkedAccountCached treats blank linked SA as null', async () => {
    const cache = createGoogleAdsLinkedAccountPrepareCache()

    await prepareGoogleAdsApiCallForLinkedAccountCached(1, null, cache)
    await prepareGoogleAdsApiCallForLinkedAccountCached(1, '   ', cache)

    expect(authContextFns.resolveGoogleAdsApiAuthForAccount).toHaveBeenCalledTimes(1)
    expect(authContextFns.resolveGoogleAdsApiAuthForAccount).toHaveBeenCalledWith(1, null)
  })

  it('prepareGoogleAdsApiCallForLinkedAccountCached does not cache failures', async () => {
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockReset()
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValue({
      ok: false,
      reason: 'not_configured',
    })
    const cache = createGoogleAdsLinkedAccountPrepareCache()

    const first = await prepareGoogleAdsApiCallForLinkedAccountCached(1, 'sa-1', cache)
    const second = await prepareGoogleAdsApiCallForLinkedAccountCached(1, 'sa-1', cache)

    expect(first).toEqual({ ok: false, message: expect.any(String) })
    expect(second).toEqual({ ok: false, message: expect.any(String) })
    expect(authContextFns.resolveGoogleAdsApiAuthForAccount).toHaveBeenCalledTimes(2)
    expect(cache.prepareByLinkedSa.size).toBe(0)
  })

  it('clearGoogleAdsLinkedAccountPrepareCache empties slim entries', async () => {
    const cache = createGoogleAdsLinkedAccountPrepareCache()
    await prepareGoogleAdsApiCallForLinkedAccountCached(1, 'sa-1', cache)
    expect(cache.prepareByLinkedSa.size).toBe(1)

    clearGoogleAdsLinkedAccountPrepareCache(cache)

    expect(cache.prepareByLinkedSa.size).toBe(0)
  })

  it('prepareGoogleAdsApiCallForLinkedAccountCached evicts slim and retries full prepare when rehydrate fails', async () => {
    const cacheModule = await import('../google-ads-auth-context-cache')
    const cache = createGoogleAdsLinkedAccountPrepareCache()

    const first = await prepareGoogleAdsApiCallForLinkedAccountCached(1, 'sa-1', cache)
    expect(first.ok).toBe(true)
    expect(cache.prepareByLinkedSa.size).toBe(1)

    const hydrateSpy = vi
      .spyOn(cacheModule, 'hydrateGoogleAdsAuthContextSecrets')
      .mockResolvedValueOnce({
        ...oauthAuthContextFull,
        userId: 1,
        ownerUserId: 1,
        oauthCredentials: { ...oauthCredentialsFull, refresh_token: '' },
        secretsStripped: false,
      })

    const second = await prepareGoogleAdsApiCallForLinkedAccountCached(1, 'sa-1', cache)

    expect(hydrateSpy).toHaveBeenCalledTimes(1)
    expect(second.ok).toBe(true)
    expect(authContextFns.resolveGoogleAdsApiAuthForAccount).toHaveBeenCalledTimes(2)
    expect(cache.prepareByLinkedSa.size).toBe(1)

    hydrateSpy.mockRestore()
  })

  it('prepareGoogleAdsApiCallForLinkedAccountCached evicts stale slim when generation changes', async () => {
    const cache = createGoogleAdsLinkedAccountPrepareCache()
    await prepareGoogleAdsApiCallForLinkedAccountCached(1, 'sa-1', cache)

    invalidateGoogleAdsAuthContextCache(1)

    await prepareGoogleAdsApiCallForLinkedAccountCached(1, 'sa-1', cache)

    expect(authContextFns.resolveGoogleAdsApiAuthForAccount).toHaveBeenCalledTimes(2)
  })

  it('prepareGoogleAdsApiCallForLinkedAccountCached evicts stale slim using authContext.userId for generation', async () => {
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValue({
      ok: true,
      ctx: { ...oauthAuthContextFull, userId: 7, ownerUserId: 7 },
      apiAuth: defaultOAuthApiAuth,
    })
    const cache = createGoogleAdsLinkedAccountPrepareCache()
    await prepareGoogleAdsApiCallForLinkedAccountCached(1, 'sa-1', cache)

    invalidateGoogleAdsAuthContextCache(7)

    await prepareGoogleAdsApiCallForLinkedAccountCached(1, 'sa-1', cache)

    expect(authContextFns.resolveGoogleAdsApiAuthForAccount).toHaveBeenCalledTimes(2)
  })

  it('prepareGoogleAdsApiCallForLinkedAccountCached keys healed OAuth bundle by ownerUserId', async () => {
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValue({
      ok: true,
      ctx: { ...oauthAuthContextFull, userId: 2, ownerUserId: 7 },
      apiAuth: defaultOAuthApiAuth,
    })
    const cache = createGoogleAdsLinkedAccountPrepareCache()
    const result = await prepareGoogleAdsApiCallForLinkedAccountCached(2, null, cache)
    expect(result.ok).toBe(true)
    expect(cache.healedOAuthBundleByOwner.has(7)).toBe(true)
    expect(cache.healedOAuthBundleByOwner.has(2)).toBe(false)
  })

  it('prepareGoogleAdsApiCallForLinkedAccountCached shares healed OAuth bundle across shared sub-users on full prepare', async () => {
    const badDevTokenCredentials = {
      ...oauthCredentialsFull,
      developer_token: oauthCredentialsFull.client_secret,
    }
    const sharedCtxBase = {
      ...oauthAuthContextFull,
      ownerUserId: 7,
      isShared: true,
      oauthCredentials: badDevTokenCredentials,
    }
    authContextFns.resolveGoogleAdsApiAuthForAccount
      .mockResolvedValueOnce({
        ok: true,
        ctx: { ...sharedCtxBase, userId: 2 },
        apiAuth: defaultOAuthApiAuth,
      })
      .mockResolvedValueOnce({
        ok: true,
        ctx: { ...sharedCtxBase, userId: 3 },
        apiAuth: defaultOAuthApiAuth,
      })

    const cache = createGoogleAdsLinkedAccountPrepareCache()
    const first = await prepareGoogleAdsApiCallForLinkedAccountCached(2, null, cache)
    expect(first.ok).toBe(true)
    expect(settingsStoreFns.getGoogleAdsOAuthConfigValue).toHaveBeenCalledTimes(1)
    expect(cache.healedOAuthBundleByOwner.has(7)).toBe(true)

    settingsStoreFns.getGoogleAdsOAuthConfigValue.mockClear()

    const second = await prepareGoogleAdsApiCallForLinkedAccountCached(3, null, cache)
    expect(second.ok).toBe(true)
    expect(settingsStoreFns.getGoogleAdsOAuthConfigValue).not.toHaveBeenCalled()
    expect(authContextFns.resolveGoogleAdsApiAuthForAccount).toHaveBeenCalledTimes(2)
  })

  it('prepareGoogleAdsApiCallForLinkedAccountCached merges concurrent inflight for same key', async () => {
    const cache = createGoogleAdsLinkedAccountPrepareCache()
    let resolvePrepare: ((value: unknown) => void) | undefined
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePrepare = resolve
        })
    )

    const first = prepareGoogleAdsApiCallForLinkedAccountCached(1, 'sa-1', cache)
    const second = prepareGoogleAdsApiCallForLinkedAccountCached(1, 'sa-1', cache)

    resolvePrepare!({
      ok: true,
      ctx: oauthAuthContextFull,
      apiAuth: defaultOAuthApiAuth,
    })

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true }),
    ])
    expect(authContextFns.resolveGoogleAdsApiAuthForAccount).toHaveBeenCalledTimes(1)
  })

  it('prepareGoogleAdsApiCallForLinkedAccountCached skips re-heal on slim rehydrate when healed OAuth bundle is cached', async () => {
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValue({
      ok: true,
      ctx: {
        ...oauthAuthContextFull,
        userId: 1,
        ownerUserId: 1,
        oauthCredentials: {
          ...oauthCredentialsFull,
          developer_token: oauthCredentialsFull.client_secret,
        },
      },
      apiAuth: defaultOAuthApiAuth,
    })

    const cache = createGoogleAdsLinkedAccountPrepareCache()
    const first = await prepareGoogleAdsApiCallForLinkedAccountCached(1, null, cache)
    expect(first.ok).toBe(true)
    expect(settingsStoreFns.getGoogleAdsOAuthConfigValue).toHaveBeenCalled()
    expect(cache.healedOAuthBundleByOwner.has(1)).toBe(true)

    settingsStoreFns.getGoogleAdsOAuthConfigValue.mockClear()

    const second = await prepareGoogleAdsApiCallForLinkedAccountCached(1, null, cache)
    expect(second.ok).toBe(true)
    expect(settingsStoreFns.getGoogleAdsOAuthConfigValue).not.toHaveBeenCalled()
    expect(authContextFns.resolveGoogleAdsApiAuthForAccount).toHaveBeenCalledTimes(1)
  })
})
