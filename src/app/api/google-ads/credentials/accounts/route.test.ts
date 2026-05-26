import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  defaultOAuthApiAuth,
  defaultOAuthAuthContext,
  resetCampaignRouteAuthMocksOAuth,
} from '@/lib/__tests__/helpers/campaign-route-auth-context-mock'
import { GET } from '@/app/api/google-ads/credentials/accounts/route'

const authFns = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
}))

const accountsAuthFns = vi.hoisted(() => ({
  getGoogleAdsAuthContext: vi.fn(),
  resolveGoogleAdsApiAuthFromContext: vi.fn(),
  detectGoogleAdsDualStackCredentials: vi.fn(),
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

const settingsFns = vi.hoisted(() => ({
  getUserOnlySetting: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyAuth: authFns.verifyAuth,
}))

vi.mock('@/lib/google-ads-auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads-auth-context')>()
  return {
    ...actual,
    getGoogleAdsAuthContext: accountsAuthFns.getGoogleAdsAuthContext,
    resolveGoogleAdsApiAuthFromContext: accountsAuthFns.resolveGoogleAdsApiAuthFromContext,
    detectGoogleAdsDualStackCredentials: accountsAuthFns.detectGoogleAdsDualStackCredentials,
  }
})

vi.mock('@/lib/google-ads-service-account', () => ({
  getServiceAccountConfig: serviceAccountFns.getServiceAccountConfig,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'postgres',
    query: dbFns.query,
    queryOne: dbFns.queryOne,
    exec: dbFns.exec,
  })),
}))

vi.mock('@/lib/google-ads-accounts-sync', () => ({
  syncAccountsFromAPI: syncFns.syncAccountsFromAPI,
}))

vi.mock('@/lib/settings', () => ({
  getUserOnlySetting: settingsFns.getUserOnlySetting,
}))

vi.mock('@/lib/api-performance', () => ({
  withPerformanceMonitoring: (handler: unknown) => handler,
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

describe('GET /api/google-ads/credentials/accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete (globalThis as { __googleAdsAccountSyncStates?: Map<string, unknown> })
      .__googleAdsAccountSyncStates

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
    dbFns.queryOne.mockResolvedValue(undefined)
    dbFns.exec.mockResolvedValue(undefined)
    serviceAccountFns.getServiceAccountConfig.mockResolvedValue(null)
    accountsAuthFns.detectGoogleAdsDualStackCredentials.mockResolvedValue({
      hasOAuthRefresh: true,
      hasActiveServiceAccount: false,
      dualStack: false,
    })
    syncFns.syncAccountsFromAPI.mockResolvedValue([])
    settingsFns.getUserOnlySetting.mockResolvedValue(null)
  })

  it('returns 401 when OAuth refresh token is missing from auth-context', async () => {
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

    expect(res.status).toBe(401)
    expect(data.error).toContain('Refresh Token')
    expect(accountsAuthFns.resolveGoogleAdsApiAuthFromContext).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7 }),
      null
    )
  })

  it('returns cached OAuth accounts using auth-context (no API sync)', async () => {
    const req = new NextRequest('http://localhost/api/google-ads/credentials/accounts?auth_type=oauth')
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

  it('returns authConfigWarning when OAuth and service account coexist', async () => {
    const { GOOGLE_ADS_DUAL_STACK_WARNING } = await import('@/lib/google-ads-auth-context')
    accountsAuthFns.detectGoogleAdsDualStackCredentials.mockResolvedValueOnce({
      hasOAuthRefresh: true,
      hasActiveServiceAccount: true,
      dualStack: true,
    })

    const req = new NextRequest('http://localhost/api/google-ads/credentials/accounts?auth_type=oauth')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.data.authConfigWarning).toBe(GOOGLE_ADS_DUAL_STACK_WARNING)
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

  it('returns 400 when service_account mode lacks service_account_id', async () => {
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

    expect(res.status).toBe(400)
    expect(data.error).toContain('服务账号ID')
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
    settingsFns.getUserOnlySetting.mockResolvedValueOnce({
      value: 'abcdefghijklmnopqrstuvwxyz1234567890',
    })

    const req = new NextRequest('http://localhost/api/google-ads/credentials/accounts?auth_type=oauth')
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(settingsFns.getUserOnlySetting).toHaveBeenCalledWith(
      'google_ads',
      'developer_token',
      7
    )
    expect(data.data.accounts).toHaveLength(1)
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
