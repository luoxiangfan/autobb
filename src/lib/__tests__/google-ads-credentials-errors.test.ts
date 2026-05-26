import { describe, expect, it } from 'vitest'
import {
  appendAccountsAuthToSearchParams,
  assertAccountsRequestAuth,
  buildAuthForAccountsRequest,
  buildGoogleAdsApiErrorMessage,
  GOOGLE_ADS_MISSING_SERVICE_ACCOUNT_MESSAGE,
  parseAccountsListFetchFailure,
  parseCredentialsStatusResponse,
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
})
