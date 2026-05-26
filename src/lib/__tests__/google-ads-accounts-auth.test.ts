import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultOAuthApiAuth, defaultOAuthAuthContext } from './helpers/campaign-route-auth-context-mock'
import {
  developerTokenLooksInvalid,
  healAccountsRouteDeveloperToken,
  resolveAccountsRouteAuthBundle,
  resolveOAuthRefreshToken,
} from '../google-ads-accounts-auth'

const authContextFns = vi.hoisted(() => ({
  resolveGoogleAdsApiAuthFromContext: vi.fn(),
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
    resolveGoogleAdsApiAuthFromContext: authContextFns.resolveGoogleAdsApiAuthFromContext,
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
