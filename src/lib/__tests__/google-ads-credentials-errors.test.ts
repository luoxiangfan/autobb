import { describe, expect, it } from 'vitest'
import {
  appendAccountsAuthToSearchParams,
  accountsRequestBlockedMessage,
  assertAccountsRequestAuth,
  buildAuthForAccountsRequest,
  buildGoogleAdsApiErrorMessage,
  GOOGLE_ADS_MISSING_SERVICE_ACCOUNT_MESSAGE,
  GOOGLE_ADS_NOT_CONFIGURED_MESSAGE,
  parseAccountsListFetchFailure,
  parseCredentialsStatusResponse,
  resolveAccountsFetchBlockedUiEffects,
  resolveAccountsRequestAuth,
} from '../google-ads-credentials-errors'

describe('google-ads-credentials-errors', () => {
  it('buildGoogleAdsApiErrorMessage handles AUTH_TYPE_MISMATCH', () => {
    const response = new Response(null, { status: 409 })
    expect(
      buildGoogleAdsApiErrorMessage(response, {
        code: 'AUTH_TYPE_MISMATCH',
        message: '请改用服务账号',
      })
    ).toBe('请改用服务账号')
  })

  it('parseAccountsListFetchFailure flags oauth expiry', () => {
    const response = new Response(null, { status: 401 })
    const result = parseAccountsListFetchFailure(response, { code: 'OAUTH_TOKEN_EXPIRED' })
    expect(result.needsReauth).toBe(true)
    expect(result.message).toContain('OAuth')
    expect(result.authConfigWarning).toBeNull()
  })

  it('parseAccountsListFetchFailure surfaces dual-stack warning and authConfigWarning', () => {
    const response = new Response(null, { status: 409 })
    const warning = '检测到 OAuth 与服务账号同时存在，请先在设置页删除其中一种配置后再使用。'
    const result = parseAccountsListFetchFailure(response, {
      code: 'DUAL_STACK_CONFLICT',
      message: warning,
      authConfigWarning: warning,
    })
    expect(result.needsReauth).toBe(false)
    expect(result.message).toBe(warning)
    expect(result.authConfigWarning).toBe(warning)
  })

  it('buildGoogleAdsApiErrorMessage handles DUAL_STACK_CONFLICT', () => {
    const response = new Response(null, { status: 409 })
    const warning = '双栈提示'
    expect(
      buildGoogleAdsApiErrorMessage(response, {
        code: 'DUAL_STACK_CONFLICT',
        authConfigWarning: warning,
      })
    ).toBe(warning)
  })

  it('parseCredentialsStatusResponse infers service_account when only SA configured', () => {
    const parsed = parseCredentialsStatusResponse({
      success: true,
      data: {
        hasCredentials: true,
        hasRefreshToken: false,
        hasServiceAccount: true,
        serviceAccountId: 'sa-99',
      },
    })
    expect(parsed.authType).toBe('service_account')
    expect(parsed.serviceAccountId).toBe('sa-99')
  })

  it('parseCredentialsStatusResponse does not infer SA when dual-stack warning without authType', () => {
    const warning = '检测到 OAuth 与服务账号同时存在，请先在设置页删除其中一种配置后再使用。'
    const parsed = parseCredentialsStatusResponse({
      success: true,
      data: {
        hasCredentials: false,
        hasRefreshToken: false,
        hasServiceAccount: true,
        serviceAccountId: 'sa-99',
        authConfigWarning: warning,
      },
    })
    expect(parsed.hasCredentials).toBe(false)
    expect(parsed.authConfigWarning).toBe(warning)
    expect(parsed.authType).toBeUndefined()
    expect(parsed.serviceAccountId).toBe('sa-99')
  })

  it('parseCredentialsStatusResponse omits authType when unconfigured', () => {
    const parsed = parseCredentialsStatusResponse({
      success: true,
      data: {
        hasCredentials: false,
        hasRefreshToken: false,
        hasServiceAccount: false,
      },
    })
    expect(parsed.hasCredentials).toBe(false)
    expect(parsed.authType).toBeUndefined()
  })

  it('parseCredentialsStatusResponse prefers explicit authType', () => {
    const parsed = parseCredentialsStatusResponse({
      success: true,
      data: {
        hasCredentials: true,
        authType: 'oauth',
        hasRefreshToken: true,
        hasServiceAccount: true,
        serviceAccountId: 'sa-99',
      },
    })
    expect(parsed.authType).toBe('oauth')
  })

  it('buildAuthForAccountsRequest merges SA fallback id', () => {
    const built = buildAuthForAccountsRequest(
      {
        authType: 'service_account',
        serviceAccountId: undefined,
        hasCredentials: true,
        authConfigWarning: null,
      },
      'sa-fallback'
    )
    expect(built.serviceAccountId).toBe('sa-fallback')
  })

  it('assertAccountsRequestAuth throws when SA id missing', () => {
    expect(() =>
      assertAccountsRequestAuth({ authType: 'service_account', serviceAccountId: undefined })
    ).toThrow(GOOGLE_ADS_MISSING_SERVICE_ACCOUNT_MESSAGE)
  })

  it('appendAccountsAuthToSearchParams omits service_account_id for oauth', () => {
    const params = new URLSearchParams({ filterByUserMcc: 'true' })
    appendAccountsAuthToSearchParams(params, {
      authType: 'oauth',
      serviceAccountId: 'sa-should-not-send',
    })
    expect(params.get('auth_type')).toBe('oauth')
    expect(params.get('service_account_id')).toBeNull()
  })

  it('appendAccountsAuthToSearchParams includes service_account_id for SA', () => {
    const params = new URLSearchParams()
    appendAccountsAuthToSearchParams(params, {
      authType: 'service_account',
      serviceAccountId: 'sa-42',
    })
    expect(params.get('auth_type')).toBe('service_account')
    expect(params.get('service_account_id')).toBe('sa-42')
  })

  it('resolveAccountsRequestAuth blocks dual-stack warning', () => {
    const warning = '双栈冲突'
    const result = resolveAccountsRequestAuth({
      hasCredentials: false,
      authConfigWarning: warning,
    })
    expect(result).toEqual({
      ok: false,
      reason: 'auth_config_warning',
      authConfigWarning: warning,
    })
  })

  it('resolveAccountsRequestAuth blocks when not configured', () => {
    expect(
      resolveAccountsRequestAuth({
        hasCredentials: false,
        authConfigWarning: null,
      })
    ).toEqual({ ok: false, reason: 'not_configured' })
  })

  it('resolveAccountsRequestAuth returns authForRequest when valid', () => {
    const result = resolveAccountsRequestAuth({
      authType: 'oauth',
      hasCredentials: true,
      authConfigWarning: null,
    })
    expect(result).toEqual({
      ok: true,
      authForRequest: { authType: 'oauth', serviceAccountId: undefined },
    })
  })

  it('resolveAccountsRequestAuth blocks when SA id missing', () => {
    const result = resolveAccountsRequestAuth({
      authType: 'service_account',
      hasCredentials: true,
      authConfigWarning: null,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('invalid_auth')
      expect(result.message).toBe(GOOGLE_ADS_MISSING_SERVICE_ACCOUNT_MESSAGE)
    }
  })

  it('accountsRequestBlockedMessage maps not_configured and invalid_auth', () => {
    expect(accountsRequestBlockedMessage({ ok: false, reason: 'not_configured' })).toBe(
      GOOGLE_ADS_NOT_CONFIGURED_MESSAGE
    )
    expect(
      accountsRequestBlockedMessage({
        ok: false,
        reason: 'invalid_auth',
        message: 'missing sa',
      })
    ).toBe('missing sa')
    expect(
      accountsRequestBlockedMessage({
        ok: false,
        reason: 'auth_config_warning',
        authConfigWarning: 'warn',
      })
    ).toBeNull()
  })

  it('buildAuthForAccountsRequest throws when authType missing', () => {
    expect(() =>
      buildAuthForAccountsRequest({
        hasCredentials: true,
        authConfigWarning: null,
      })
    ).toThrow(GOOGLE_ADS_NOT_CONFIGURED_MESSAGE)
  })

  it('resolveAccountsFetchBlockedUiEffects maps refresh spinner reset and messages', () => {
    expect(
      resolveAccountsFetchBlockedUiEffects(
        { ok: false, reason: 'auth_config_warning', authConfigWarning: 'dual stack' },
        { forceRefresh: true }
      )
    ).toEqual({
      authConfigWarning: 'dual stack',
      clearForceRefreshState: true,
    })

    expect(
      resolveAccountsFetchBlockedUiEffects(
        { ok: false, reason: 'not_configured' },
        { forceRefresh: true }
      )
    ).toEqual({
      errorMessage: GOOGLE_ADS_NOT_CONFIGURED_MESSAGE,
      clearForceRefreshState: true,
    })
  })
})
