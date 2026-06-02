import { beforeEach, describe, expect, it, vi } from 'vitest'

const authContextFns = vi.hoisted(() => ({
  resolveGoogleAdsApiAuthForAccount: vi.fn(),
  invalidateGoogleAdsAuthContextCacheForOwner: vi.fn(async () => {}),
}))

const pythonFns = vi.hoisted(() => ({
  listAccessibleCustomersPython: vi.fn(),
}))

const apiFns = vi.hoisted(() => ({
  listAccessibleCustomers: vi.fn(),
  getGoogleAdsClient: vi.fn(),
}))

const dbFns = vi.hoisted(() => ({
  type: 'sqlite' as const,
  exec: vi.fn(),
}))

const DUAL_STACK_WARNING =
  '检测到 OAuth 与服务账号同时存在，请先在设置页删除其中一种配置后再使用。'

vi.mock('@/lib/google-ads-auth-context', () => ({
  resolveGoogleAdsApiAuthForAccount: authContextFns.resolveGoogleAdsApiAuthForAccount,
  invalidateGoogleAdsAuthContextCacheForOwner:
    authContextFns.invalidateGoogleAdsAuthContextCacheForOwner,
  googleAdsApiAuthValidationErrorMessage: (reason: string) => {
    if (reason === 'dual_stack') {
      return DUAL_STACK_WARNING
    }
    if (reason === 'not_configured') {
      return 'Google Ads 认证未配置或已失效，请先在设置中完成 OAuth 授权或配置服务账号'
    }
    return `Google Ads 认证无效 (${reason})`
  },
  GOOGLE_ADS_DUAL_STACK_WARNING: DUAL_STACK_WARNING,
}))

vi.mock('@/lib/python-ads-client', () => ({
  listAccessibleCustomersPython: pythonFns.listAccessibleCustomersPython,
}))

vi.mock('@/lib/google-ads-api', () => ({
  getGoogleAdsClient: apiFns.getGoogleAdsClient,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => dbFns),
}))

import { verifyGoogleAdsCredentials } from '@/lib/google-ads-oauth'

const oauthCtx = {
  userId: 2,
  ownerUserId: 1,
  assignment: null,
  isShared: true,
  canModify: false,
  auth: { authType: 'oauth' as const },
  oauthCredentials: {
    refresh_token: 'rt-1',
    client_id: 'cid.apps.googleusercontent.com',
    client_secret: 'GOCSPX-secret',
    developer_token: 'abcdefghijklmnopqrstuvwxyz123456',
  },
  serviceAccountConfig: null,
}

const saCtx = {
  ...oauthCtx,
  auth: { authType: 'service_account' as const, serviceAccountId: 'sa-1' },
  oauthCredentials: null,
  serviceAccountConfig: {
    id: 'sa-1',
    name: 'Admin SA',
    mccCustomerId: '1112223333',
    developerToken: 'dev-token',
  },
}

describe('verifyGoogleAdsCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbFns.exec.mockResolvedValue(undefined)
    apiFns.getGoogleAdsClient.mockReturnValue({
      listAccessibleCustomers: apiFns.listAccessibleCustomers,
    })
  })

  it('returns dual-stack warning when resolve reports dual_stack', async () => {
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValue({
      ok: false,
      reason: 'dual_stack',
    })

    const result = await verifyGoogleAdsCredentials(2)

    expect(result).toEqual({ valid: false, error: DUAL_STACK_WARNING })
    expect(authContextFns.resolveGoogleAdsApiAuthForAccount).toHaveBeenCalledWith(2, null)
  })

  it('returns invalid when resolveGoogleAdsApiAuthForAccount fails', async () => {
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValue({
      ok: false,
      reason: 'not_configured',
    })

    const result = await verifyGoogleAdsCredentials(2)

    expect(result.valid).toBe(false)
    expect(result.error).toContain('未配置')
    expect(authContextFns.resolveGoogleAdsApiAuthForAccount).toHaveBeenCalledWith(2, null)
  })

  it('verifies service account via Python and updates SA row', async () => {
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValue({
      ok: true,
      ctx: saCtx,
      apiAuth: {
        authType: 'service_account',
        refreshToken: '',
        serviceAccountId: 'sa-1',
      },
    })
    pythonFns.listAccessibleCustomersPython.mockResolvedValue(['customers/1234567890'])

    const result = await verifyGoogleAdsCredentials(2)

    expect(result).toEqual({
      valid: true,
      customer_id: '1234567890',
      authType: 'service_account',
    })
    expect(pythonFns.listAccessibleCustomersPython).toHaveBeenCalledWith({
      userId: 2,
      serviceAccountId: 'sa-1',
    })
    expect(dbFns.exec).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE google_ads_service_accounts'),
      ['sa-1']
    )
    expect(authContextFns.invalidateGoogleAdsAuthContextCacheForOwner).toHaveBeenCalledWith(1)
  })

  it('returns invalid when service account config is missing', async () => {
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValue({
      ok: true,
      ctx: { ...saCtx, serviceAccountConfig: null },
      apiAuth: {
        authType: 'service_account',
        refreshToken: '',
        serviceAccountId: 'sa-1',
      },
    })

    const result = await verifyGoogleAdsCredentials(2)

    expect(result).toEqual({
      valid: false,
      error: '未找到服务账号配置',
      authType: 'service_account',
    })
  })

  it('returns invalid when service account has no accessible customers', async () => {
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValue({
      ok: true,
      ctx: saCtx,
      apiAuth: {
        authType: 'service_account',
        refreshToken: '',
        serviceAccountId: 'sa-1',
      },
    })
    pythonFns.listAccessibleCustomersPython.mockResolvedValue([])

    const result = await verifyGoogleAdsCredentials(2)

    expect(result).toEqual({
      valid: false,
      error: '无可访问的账户',
      authType: 'service_account',
    })
  })

  it('returns invalid when Python verification throws', async () => {
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValue({
      ok: true,
      ctx: saCtx,
      apiAuth: {
        authType: 'service_account',
        refreshToken: '',
        serviceAccountId: 'sa-1',
      },
    })
    pythonFns.listAccessibleCustomersPython.mockRejectedValue(new Error('SA auth failed'))

    const result = await verifyGoogleAdsCredentials(2)

    expect(result).toEqual({
      valid: false,
      error: 'SA auth failed',
      authType: 'service_account',
    })
  })

  it('verifies OAuth via listAccessibleCustomers and updates owner credentials', async () => {
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValue({
      ok: true,
      ctx: oauthCtx,
      apiAuth: {
        authType: 'oauth',
        refreshToken: 'rt-1',
        oauthLoginCustomerId: '9988776655',
      },
    })
    apiFns.listAccessibleCustomers.mockResolvedValue({
      resource_names: ['customers/9876543210'],
    })

    const result = await verifyGoogleAdsCredentials(2)

    expect(result).toEqual({
      valid: true,
      customer_id: '9876543210',
      authType: 'oauth',
    })
    expect(apiFns.listAccessibleCustomers).toHaveBeenCalledWith('rt-1')
    expect(dbFns.exec).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE google_ads_credentials'),
      [oauthCtx.ownerUserId]
    )
    expect(authContextFns.invalidateGoogleAdsAuthContextCacheForOwner).toHaveBeenCalledWith(1)
  })

  it('returns invalid when OAuth credentials lack refresh_token', async () => {
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValue({
      ok: true,
      ctx: {
        ...oauthCtx,
        oauthCredentials: { ...oauthCtx.oauthCredentials, refresh_token: '' },
      },
      apiAuth: { authType: 'oauth', refreshToken: '', oauthLoginCustomerId: '9988776655' },
    })

    const result = await verifyGoogleAdsCredentials(2)

    expect(result).toEqual({
      valid: false,
      error: '缺少Refresh Token，请完成 OAuth 授权',
      authType: 'oauth',
    })
  })

  it('returns invalid when OAuth client fields are incomplete', async () => {
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValue({
      ok: true,
      ctx: {
        ...oauthCtx,
        oauthCredentials: {
          refresh_token: 'rt-1',
          client_id: '',
          client_secret: '',
          developer_token: '',
        },
      },
      apiAuth: { authType: 'oauth', refreshToken: 'rt-1' },
    })

    const result = await verifyGoogleAdsCredentials(2)

    expect(result).toEqual({
      valid: false,
      error: '凭证配置不完整，请在设置中完成 Google Ads API 配置',
      authType: 'oauth',
    })
  })

  it('returns invalid when OAuth listAccessibleCustomers returns empty', async () => {
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockResolvedValue({
      ok: true,
      ctx: oauthCtx,
      apiAuth: { authType: 'oauth', refreshToken: 'rt-1' },
    })
    apiFns.listAccessibleCustomers.mockResolvedValue({ resource_names: [] })

    const result = await verifyGoogleAdsCredentials(2)

    expect(result).toEqual({
      valid: false,
      error: '无可访问的账户',
      authType: 'oauth',
    })
  })

  it('returns invalid with message when unexpected error is thrown', async () => {
    authContextFns.resolveGoogleAdsApiAuthForAccount.mockRejectedValue(
      new Error('database unavailable')
    )

    const result = await verifyGoogleAdsCredentials(2)

    expect(result).toEqual({ valid: false, error: 'database unavailable' })
  })
})
