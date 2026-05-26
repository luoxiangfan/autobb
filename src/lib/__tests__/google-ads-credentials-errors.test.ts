import { describe, expect, it } from 'vitest'
import {
  buildGoogleAdsApiErrorMessage,
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
})
