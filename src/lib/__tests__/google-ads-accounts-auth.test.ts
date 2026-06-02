import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultOAuthApiAuth, defaultOAuthAuthContext } from './helpers/campaign-route-auth-context-mock'
import {
  createGoogleAdsLinkedAccountPrepareCache,
  developerTokenLooksInvalid,
  healAccountsRouteDeveloperToken,
  linkedSaPrepareCacheKey,
  prepareGoogleAdsApiCallForLinkedAccountCached,
  resolveAccountsRouteAuthBundle,
  prepareGoogleAdsAccountApiCall,
  resolveAndHealSyncUserCredentials,
  resolveOAuthApiCredentialsForUser,
  resolveOAuthRefreshToken,
} from '../google-ads-accounts-auth'

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

const settingsFns = vi.hoisted(() => ({
  getUserOnlySetting: vi.fn(),
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

vi.mock('../settings', () => ({
  getUserOnlySetting: settingsFns.getUserOnlySetting,
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

  it('returns 401 when OAuth refresh token is missing', async () => {
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
    expect(result.status).toBe(401)
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
    settingsFns.getUserOnlySetting.mockResolvedValue({ value: validSettingToken })
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      ...defaultOAuthAuthContext,
      userId: 1,
      ownerUserId: 1,
      dualStack: false,
    })
  })

  it('loads owner auth context and returns DUAL_STACK_CONFLICT when authContext omitted', async () => {
    authContextFns.getGoogleAdsAuthContext.mockResolvedValue({
      userId: 7,
      ownerUserId: 7,
      assignment: null,
      isShared: false,
      canModify: true,
      dualStack: true,
      auth: { authType: 'oauth' as const },
      oauthCredentials: oauthCredentialsFull,
      serviceAccountConfig: { id: 'sa-1' },
    })

    const result = await healAccountsRouteDeveloperToken({
      credentials: { ...oauthCredentialsFull },
      authType: 'oauth',
      ownerUserId: 7,
      clientSecret: oauthCredentialsFull.client_secret,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('DUAL_STACK_CONFLICT')
    expect(authContextFns.getGoogleAdsAuthContext).toHaveBeenCalledWith(7)
    expect(settingsFns.getUserOnlySetting).not.toHaveBeenCalled()
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
    expect(settingsFns.getUserOnlySetting).not.toHaveBeenCalled()
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
    })

    expect(result.ok).toBe(true)
    expect(settingsFns.getUserOnlySetting).not.toHaveBeenCalled()
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
    settingsFns.getUserOnlySetting.mockResolvedValue({ value: '' })

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
    settingsFns.getUserOnlySetting.mockResolvedValue({
      value: 'abcdefghijklmnopqrstuvwxyz1234567890',
    })

    const result = await resolveAndHealSyncUserCredentials({
      userId: 2,
      authContext: sharedAuthContext,
      authType: 'oauth',
      serviceAccountId: null,
    })

    expect(result.ok).toBe(true)
    expect(settingsFns.getUserOnlySetting).toHaveBeenCalledWith(
      'google_ads',
      'developer_token',
      1
    )
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
    expect(result.userCredentials.developer_token).toBe(
      'sa-developer-token-abcdefghijklmnopqrst'
    )
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

    await expect(resolveOAuthApiCredentialsForUser(1)).rejects.toThrow(
      /OAuth 与服务账号同时存在/
    )
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

describe('GoogleAdsLinkedAccountPrepareCache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValue({
      ok: true,
      ctx: oauthAuthContextFull,
      apiAuth: defaultOAuthApiAuth,
    })
    settingsFns.getUserOnlySetting.mockResolvedValue({
      value: 'abcdefghijklmnopqrstuvwxyz1234567890ab',
    })
  })

  it('linkedSaPrepareCacheKey isolates userId and linked SA', () => {
    expect(linkedSaPrepareCacheKey(2, 'sa-1')).toBe('2\0sa-1')
    expect(linkedSaPrepareCacheKey(2, null)).toBe('2\0')
    expect(linkedSaPrepareCacheKey(3, 'sa-1')).not.toBe(linkedSaPrepareCacheKey(2, 'sa-1'))
  })

  it('prepareGoogleAdsApiCallForLinkedAccountCached reuses result for same linked SA', async () => {
    const cache = createGoogleAdsLinkedAccountPrepareCache()

    const first = await prepareGoogleAdsApiCallForLinkedAccountCached(1, 'sa-1', cache)
    const second = await prepareGoogleAdsApiCallForLinkedAccountCached(1, 'sa-1', cache)

    expect(first).toBe(second)
    expect(authContextFns.resolveGoogleAdsApiAuthForAccount).toHaveBeenCalledTimes(1)
    expect(authContextFns.resolveGoogleAdsApiAuthForAccount).toHaveBeenCalledWith(1, 'sa-1')
  })

  it('prepareGoogleAdsApiCallForLinkedAccountCached treats blank linked SA as null', async () => {
    const cache = createGoogleAdsLinkedAccountPrepareCache()

    await prepareGoogleAdsApiCallForLinkedAccountCached(1, null, cache)
    await prepareGoogleAdsApiCallForLinkedAccountCached(1, '   ', cache)

    expect(authContextFns.resolveGoogleAdsApiAuthForAccount).toHaveBeenCalledTimes(1)
    expect(authContextFns.resolveGoogleAdsApiAuthForAccount).toHaveBeenCalledWith(1, null)
  })

  it('prepareGoogleAdsApiCallForLinkedAccountCached does not cache failures', async () => {
    authContextFns.resolveGoogleAdsApiAuthForAccount
      .mockResolvedValueOnce({ ok: false, reason: 'not_configured' })
      .mockResolvedValueOnce({ ok: false, reason: 'not_configured' })
    const cache = createGoogleAdsLinkedAccountPrepareCache()

    const first = await prepareGoogleAdsApiCallForLinkedAccountCached(1, 'sa-1', cache)
    const second = await prepareGoogleAdsApiCallForLinkedAccountCached(1, 'sa-1', cache)

    expect(first).toEqual({ ok: false, message: expect.any(String) })
    expect(second).toEqual({ ok: false, message: expect.any(String) })
    expect(authContextFns.resolveGoogleAdsApiAuthForAccount).toHaveBeenCalledTimes(2)
  })
})
