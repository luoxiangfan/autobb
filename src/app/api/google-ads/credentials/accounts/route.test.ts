import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  defaultOAuthApiAuth,
  defaultOAuthAuthContext,
  resetCampaignRouteAuthMocksOAuth,
} from '@/lib/__tests__/helpers/campaign-route-auth-context-mock'
import { GET } from '@/app/api/google-ads/credentials/accounts/route'
import { resetGoogleAdsAccountAsyncRefreshCleanupThrottleForTests } from '@/lib/google-ads/accounts/async-refresh-state'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const accountsAuthFns = vi.hoisted(() => ({
  getGoogleAdsAuthContext: vi.fn(),
  resolveGoogleAdsApiAuthFromContext: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  exec: vi.fn(),
}))

const serviceAccountFns = vi.hoisted(() => ({
  getServiceAccountConfig: vi.fn(),
}))

const syncFns = vi.hoisted(() => ({
  syncAccountsFromAPI: vi.fn(),
}))

const settingsStoreFns = vi.hoisted(() => ({
  getGoogleAdsOAuthConfigValue: vi.fn(),
}))

vi.mock('@/lib/google-ads/settings/settings-store', () => ({
  getGoogleAdsOAuthConfigValue: settingsStoreFns.getGoogleAdsOAuthConfigValue,
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/google-ads/auth/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads/auth/context')>()
  return {
    ...actual,
    getGoogleAdsAuthContext: accountsAuthFns.getGoogleAdsAuthContext,
    resolveGoogleAdsApiAuthFromContext: accountsAuthFns.resolveGoogleAdsApiAuthFromContext,
  }
})

vi.mock('@/lib/google-ads/service-account/service-account', () => ({
  getServiceAccountConfig: serviceAccountFns.getServiceAccountConfig,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    query: dbFns.query,
    queryOne: dbFns.queryOne,
    exec: dbFns.exec,
  })),
}))

vi.mock('@/lib/google-ads/accounts/sync', () => ({
  syncAccountsFromAPI: syncFns.syncAccountsFromAPI,
}))

vi.mock('@/lib/common', () => ({
  withPerformanceMonitoring: (handler: unknown) => handler,
}))

vi.mock('@/lib/common', () => ({
  getRedisClient: vi.fn(() => null),
}))

const oauthCredentialsFull = {
  refresh_token: 'oauth-refresh-token',
  login_customer_id: '9988776655',
  client_id: 'test-client-id.apps.googleusercontent.com',
  client_secret: 'GOCSPX-test-client-secret',
  developer_token: 'abcdefghijklmnopqrstuvwxyz123456',
}

const cachedOAuthAccount = {
  id: 42,
  customer_id: '1234567890',
  account_name: 'Test Ads Account',
  currency: 'USD',
  timezone: 'America/Los_Angeles',
  is_manager_account: 0,
  is_active: 1,
  is_deleted: 0,
  status: 'ENABLED',
  test_account: 0,
  account_balance: 100,
  parent_mcc_id: '9988776655',
  auth_type: 'oauth',
  service_account_id: null,
  identity_verification_program_status: null,
  identity_verification_start_deadline_time: null,
  identity_verification_completion_deadline_time: null,
  identity_verification_overdue: 0,
  identity_verification_checked_at: null,
  last_sync_at: '2026-01-15 12:00:00',
}

function mockCachedAccountsQuery() {
  dbFns.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM google_ads_accounts')) {
      return [cachedOAuthAccount]
    }
    if (sql.includes('FROM offers o')) {
      return []
    }
    return []
  })
}

function mockAsyncRefreshDb() {
  let asyncRefreshRunning = false
  dbFns.queryOne.mockImplementation(async (sql: string) => {
    if (sql.includes('google_ads_accounts_async_refresh_state') && asyncRefreshRunning) {
      const now = new Date().toISOString()
      return {
        status: 'running',
        started_at: now,
        updated_at: now,
        error_message: null,
      }
    }
    return undefined
  })
  dbFns.exec.mockImplementation(async (sql: string) => {
    if (sql.includes('google_ads_accounts_async_refresh_state')) {
      if (sql.includes('INSERT')) {
        asyncRefreshRunning = true
      }
      return { changes: 1 }
    }
    return { changes: 1 }
  })
}

describe('GET /api/google-ads/credentials/accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetGoogleAdsAccountAsyncRefreshCleanupThrottleForTests()

    authFns.verifyAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: 7, role: 'user' },
    })

    resetCampaignRouteAuthMocksOAuth(accountsAuthFns)
    accountsAuthFns.getGoogleAdsAuthContext.mockResolvedValue({
      ...defaultOAuthAuthContext,
      oauthCredentials: oauthCredentialsFull,
    })

    mockCachedAccountsQuery()
    mockAsyncRefreshDb()
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue(null)
    syncFns.syncAccountsFromAPI.mockResolvedValue([])
    settingsStoreFns.getGoogleAdsOAuthConfigValue.mockResolvedValue('')
  })

  it('returns 404 when auth-context is not configured', async () => {
    accountsAuthFns.getGoogleAdsAuthContext.mockResolvedValue({
      ...defaultOAuthAuthContext,
      oauthCredentials: null,
      serviceAccountConfig: null,
    })

    const req = new NextRequest(
      'http://localhost/api/google-ads/credentials/accounts?auth_type=oauth'
    )
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.code).toBe('CREDENTIALS_NOT_CONFIGURED')
    expect(accountsAuthFns.resolveGoogleAdsApiAuthFromContext).not.toHaveBeenCalled()
  })

  it('returns 404 when OAuth refresh token is missing from auth-context', async () => {
    accountsAuthFns.getGoogleAdsAuthContext.mockResolvedValue({
      ...defaultOAuthAuthContext,
      oauthCredentials: {
        ...oauthCredentialsFull,
        refresh_token: '',
      },
    })
    accountsAuthFns.resolveGoogleAdsApiAuthFromContext.mockResolvedValue({
      ...defaultOAuthApiAuth,
      refreshToken: '',
    })

    const req = new NextRequest('http://localhost/api/google-ads/credentials/accounts')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.code).toBe('CREDENTIALS_NOT_CONFIGURED')
    expect(accountsAuthFns.resolveGoogleAdsApiAuthFromContext).not.toHaveBeenCalled()
  })

  it('returns cached OAuth accounts using auth-context (no API sync)', async () => {
    const req = new NextRequest(
      'http://localhost/api/google-ads/credentials/accounts?auth_type=oauth'
    )
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.cached).toBe(true)
    expect(data.data.authType).toBe('oauth')
    expect(data.data.loginCustomerId).toBe('9988776655')
    expect(data.data.accounts).toHaveLength(1)
    expect(data.data.accounts[0].customerId).toBe('1234567890')
    expect(data.data.accounts[0].descriptiveName).toBe('Test Ads Account')
    expect(accountsAuthFns.resolveGoogleAdsApiAuthFromContext).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7 }),
      null
    )
  })

  it('returns 409 when requested auth_type conflicts with configured auth', async () => {
    accountsAuthFns.getGoogleAdsAuthContext.mockResolvedValue({
      ...defaultOAuthAuthContext,
      auth: { authType: 'service_account' as const, serviceAccountId: 'sa-1' },
      oauthCredentials: null,
      serviceAccountConfig: {
        id: 'sa-1',
        mccCustomerId: '1122334455',
        developerToken: 'abcdefghijklmnopqrstuvwxyz123456',
      },
    })

    const req = new NextRequest(
      'http://localhost/api/google-ads/credentials/accounts?auth_type=oauth'
    )
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(409)
    expect(data.code).toBe('AUTH_TYPE_MISMATCH')
    expect(data.configuredAuthType).toBe('service_account')
    expect(accountsAuthFns.resolveGoogleAdsApiAuthFromContext).not.toHaveBeenCalled()
  })

  it('returns 409 when heal reports DUAL_STACK_CONFLICT', async () => {
    const { GOOGLE_ADS_DUAL_STACK_WARNING } = await import('@/lib/google-ads/auth/context')
    const accountsAuth = await import('@/lib/google-ads/accounts/auth/index')
    const healSpy = vi
      .spyOn(accountsAuth, 'healAccountsRouteDeveloperToken')
      .mockResolvedValueOnce({
        ok: false,
        code: 'DUAL_STACK_CONFLICT',
        message: GOOGLE_ADS_DUAL_STACK_WARNING,
      })

    const req = new NextRequest(
      'http://localhost/api/google-ads/credentials/accounts?auth_type=oauth'
    )
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(409)
    expect(data.code).toBe('DUAL_STACK_CONFLICT')
    expect(data.authConfigWarning).toBe(GOOGLE_ADS_DUAL_STACK_WARNING)
    expect(syncFns.syncAccountsFromAPI).not.toHaveBeenCalled()
    healSpy.mockRestore()
  })

  it('returns 409 when auth context reports dual-stack credentials', async () => {
    const { GOOGLE_ADS_DUAL_STACK_WARNING } = await import('@/lib/google-ads/auth/context')
    accountsAuthFns.getGoogleAdsAuthContext.mockResolvedValueOnce({
      ...defaultOAuthAuthContext,
      oauthCredentials: oauthCredentialsFull,
      dualStack: true,
    })

    const req = new NextRequest(
      'http://localhost/api/google-ads/credentials/accounts?auth_type=oauth'
    )
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(409)
    expect(data.code).toBe('DUAL_STACK_CONFLICT')
    expect(data.authConfigWarning).toBe(GOOGLE_ADS_DUAL_STACK_WARNING)
    expect(accountsAuthFns.resolveGoogleAdsApiAuthFromContext).not.toHaveBeenCalled()
    expect(syncFns.syncAccountsFromAPI).not.toHaveBeenCalled()
  })

  it('ignores stray service_account_id in OAuth mode for cached list', async () => {
    const req = new NextRequest(
      'http://localhost/api/google-ads/credentials/accounts?auth_type=oauth&service_account_id=orphan-sa'
    )
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.data.authType).toBe('oauth')
    expect(accountsAuthFns.resolveGoogleAdsApiAuthFromContext).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7 }),
      null
    )
  })

  it('treats whitespace-only service_account_id as missing', async () => {
    accountsAuthFns.getGoogleAdsAuthContext.mockResolvedValue({
      ...defaultOAuthAuthContext,
      auth: { authType: 'service_account' as const, serviceAccountId: 'sa-1' },
      oauthCredentials: null,
      serviceAccountConfig: {
        id: 'sa-1',
        mccCustomerId: '1122334455',
        developerToken: 'abcdefghijklmnopqrstuvwxyz123456',
      },
    })

    const req = new NextRequest(
      'http://localhost/api/google-ads/credentials/accounts?auth_type=service_account&service_account_id=%20%20'
    )
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(accountsAuthFns.resolveGoogleAdsApiAuthFromContext).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7 }),
      'sa-1'
    )
    expect(data.data.loginCustomerId).toBe('1122334455')
  })

  it('returns 404 when service_account mode lacks configured credentials', async () => {
    accountsAuthFns.getGoogleAdsAuthContext.mockResolvedValue({
      ...defaultOAuthAuthContext,
      auth: { authType: 'service_account' as const },
      oauthCredentials: null,
      serviceAccountConfig: null,
    })

    const req = new NextRequest(
      'http://localhost/api/google-ads/credentials/accounts?auth_type=service_account'
    )
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.code).toBe('CREDENTIALS_NOT_CONFIGURED')
    expect(accountsAuthFns.resolveGoogleAdsApiAuthFromContext).not.toHaveBeenCalled()
  })

  it('heals invalid oauth developer_token from user settings', async () => {
    accountsAuthFns.getGoogleAdsAuthContext.mockResolvedValue({
      ...defaultOAuthAuthContext,
      oauthCredentials: {
        ...oauthCredentialsFull,
        developer_token: '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e',
      },
    })
    settingsStoreFns.getGoogleAdsOAuthConfigValue.mockResolvedValueOnce(
      'abcdefghijklmnopqrstuvwxyz1234567890'
    )

    const req = new NextRequest(
      'http://localhost/api/google-ads/credentials/accounts?auth_type=oauth'
    )
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(settingsStoreFns.getGoogleAdsOAuthConfigValue).toHaveBeenCalledWith(7, 'developer_token')
    expect(data.data.accounts).toHaveLength(1)
  })

  it('heals invalid service account developer_token from user settings', async () => {
    const saConfig = {
      id: 'sa-1',
      mccCustomerId: '1122334455',
      developerToken: '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e',
      serviceAccountEmail: 'sa@test.iam.gserviceaccount.com',
    }
    accountsAuthFns.getGoogleAdsAuthContext.mockResolvedValue({
      ...defaultOAuthAuthContext,
      auth: { authType: 'service_account' as const, serviceAccountId: 'sa-1' },
      oauthCredentials: null,
      serviceAccountConfig: saConfig,
    })
    accountsAuthFns.resolveGoogleAdsApiAuthFromContext.mockResolvedValue({
      authType: 'service_account' as const,
      refreshToken: '',
      serviceAccountId: 'sa-1',
      serviceAccountMccId: '1122334455',
      oauthLoginCustomerId: undefined,
    })
    settingsStoreFns.getGoogleAdsOAuthConfigValue.mockResolvedValueOnce(
      'abcdefghijklmnopqrstuvwxyz1234567890'
    )

    dbFns.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM google_ads_accounts')) {
        return [
          {
            ...cachedOAuthAccount,
            customer_id: '5555555555',
            auth_type: 'service_account',
            service_account_id: 'sa-1',
            parent_mcc_id: '1122334455',
          },
        ]
      }
      if (sql.includes('FROM offers o')) {
        return []
      }
      return []
    })

    const req = new NextRequest(
      'http://localhost/api/google-ads/credentials/accounts?auth_type=service_account&service_account_id=sa-1'
    )
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(settingsStoreFns.getGoogleAdsOAuthConfigValue).toHaveBeenCalled()
    expect(dbFns.exec).toHaveBeenCalled()
    expect(saConfig.developerToken).toBe('abcdefghijklmnopqrstuvwxyz1234567890')
    expect(data.data.loginCustomerId).toBe('1122334455')
  })

  it('syncs from API when refresh=true and cache is empty', async () => {
    dbFns.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM google_ads_accounts')) {
        return []
      }
      if (sql.includes('FROM offers o')) {
        return []
      }
      return []
    })

    syncFns.syncAccountsFromAPI.mockResolvedValueOnce([
      {
        customer_id: '9998887776',
        descriptive_name: 'Synced From API',
        currency_code: 'USD',
        time_zone: 'America/Los_Angeles',
        manager: false,
        test_account: false,
        status: 'ENABLED',
        account_balance: null,
        parent_mcc: '9988776655',
        db_account_id: 99,
        last_sync_at: '2026-03-25 12:00:00',
      },
    ])

    const req = new NextRequest(
      'http://localhost/api/google-ads/credentials/accounts?refresh=true&auth_type=oauth'
    )
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(syncFns.syncAccountsFromAPI).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        refresh_token: 'oauth-refresh-token',
        developer_token: expect.any(String),
      }),
      'oauth',
      null
    )
    expect(data.data.cached).toBe(false)
    expect(data.data.accounts[0].customerId).toBe('9998887776')
  })

  it('returns refreshInProgress without blocking when sync lock is held and cache is empty', async () => {
    vi.useFakeTimers()

    dbFns.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM google_ads_accounts')) {
        return []
      }
      if (sql.includes('FROM offers o')) {
        return []
      }
      return []
    })

    const nowIso = new Date().toISOString()
    dbFns.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('google_ads_accounts_async_refresh_state')) {
        return {
          status: 'running',
          started_at: nowIso,
          updated_at: nowIso,
          error_message: null,
        }
      }
      return undefined
    })
    dbFns.exec.mockImplementation(async (sql: string) => {
      if (sql.includes('google_ads_accounts_async_refresh_state')) {
        return { changes: 0 }
      }
      return { changes: 1 }
    })

    const req = new NextRequest(
      'http://localhost/api/google-ads/credentials/accounts?refresh=true&auth_type=oauth'
    )
    const responsePromise = GET(req)
    await vi.advanceTimersByTimeAsync(16_000)
    const res = await responsePromise
    const data = await res.json()

    vi.useRealTimers()

    expect(res.status).toBe(200)
    expect(data.data.refreshInProgress).toBe(true)
    expect(syncFns.syncAccountsFromAPI).not.toHaveBeenCalled()
  })

  it('returns cached data and starts background sync when refresh=true&async=true', async () => {
    syncFns.syncAccountsFromAPI.mockImplementation(() => new Promise(() => {}))

    const req = new NextRequest(
      'http://localhost/api/google-ads/credentials/accounts?refresh=true&async=true&auth_type=oauth'
    )
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.data.cached).toBe(true)
    expect(data.data.refreshInProgress).toBe(true)
    expect(syncFns.syncAccountsFromAPI).toHaveBeenCalled()
  })

  it('resolves service account auth via auth-context when service_account_id is provided', async () => {
    accountsAuthFns.getGoogleAdsAuthContext.mockResolvedValue({
      ...defaultOAuthAuthContext,
      auth: { authType: 'service_account' as const, serviceAccountId: 'sa-1' },
      oauthCredentials: oauthCredentialsFull,
      serviceAccountConfig: {
        id: 'sa-1',
        mccCustomerId: '1122334455',
        developerToken: 'abcdefghijklmnopqrstuvwxyz123456',
        serviceAccountEmail: 'sa@test.iam.gserviceaccount.com',
      },
    })
    accountsAuthFns.resolveGoogleAdsApiAuthFromContext.mockResolvedValue({
      authType: 'service_account' as const,
      refreshToken: '',
      serviceAccountId: 'sa-1',
      serviceAccountMccId: '1122334455',
      oauthLoginCustomerId: undefined,
    })

    dbFns.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM google_ads_accounts')) {
        return [
          {
            ...cachedOAuthAccount,
            customer_id: '5555555555',
            auth_type: 'service_account',
            service_account_id: 'sa-1',
            parent_mcc_id: '1122334455',
          },
        ]
      }
      if (sql.includes('FROM offers o')) {
        return []
      }
      return []
    })

    const req = new NextRequest(
      'http://localhost/api/google-ads/credentials/accounts?auth_type=service_account&service_account_id=sa-1'
    )
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.data.authType).toBe('service_account')
    expect(data.data.loginCustomerId).toBe('1122334455')
    expect(accountsAuthFns.resolveGoogleAdsApiAuthFromContext).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7 }),
      'sa-1'
    )
  })
})
