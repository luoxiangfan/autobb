import { describe, expect, it } from 'vitest'
import { formatGoogleAdsAuthSaveError } from './api-messages'
import { resolveGoogleAdsOAuthCallbackErrorMessage } from './oauth-callback-errors'
import {
  validateGoogleAdsOAuthForm,
  resolveEffectiveGoogleAdsAuthMethod,
  resolveGoogleAdsAuthMethodFromCredentialStatus,
  isGoogleAdsAuthMethodLocked,
} from './validation'

describe('formatGoogleAdsAuthSaveError', () => {
  it('returns server message for 409 conflicts', () => {
    expect(formatGoogleAdsAuthSaveError(409, '当前已配置服务账号认证')).toBe(
      '当前已配置服务账号认证'
    )
  })

  it('falls back to conflict hint when 409 message is empty', () => {
    expect(formatGoogleAdsAuthSaveError(409, '')).toBe('请先删除另一种 Google Ads 认证方式后再保存')
  })
})

describe('resolveEffectiveGoogleAdsAuthMethod', () => {
  it('locks to configured authType when credentials are ready', () => {
    expect(
      resolveEffectiveGoogleAdsAuthMethod(
        { hasCredentials: true, authType: 'service_account', dualStack: false },
        'oauth'
      )
    ).toBe('service_account')
  })

  it('follows tab selection when not configured', () => {
    expect(
      resolveEffectiveGoogleAdsAuthMethod(
        { hasCredentials: false, authType: undefined, dualStack: false },
        'oauth'
      )
    ).toBe('oauth')
  })

  it('follows tab selection during dual stack cleanup', () => {
    expect(
      resolveEffectiveGoogleAdsAuthMethod(
        { hasCredentials: false, authType: 'oauth', dualStack: true },
        'service_account'
      )
    ).toBe('service_account')
  })
})

describe('resolveGoogleAdsAuthMethodFromCredentialStatus', () => {
  it('returns null when status is missing', () => {
    expect(resolveGoogleAdsAuthMethodFromCredentialStatus(null)).toBeNull()
  })

  it('uses configured authType when present', () => {
    expect(
      resolveGoogleAdsAuthMethodFromCredentialStatus({
        authType: 'service_account',
        dualStack: false,
        hasServiceAccount: true,
      })
    ).toBe('service_account')
  })

  it('defaults dual stack to oauth instead of biasing service account', () => {
    expect(
      resolveGoogleAdsAuthMethodFromCredentialStatus({
        dualStack: true,
        hasServiceAccount: true,
        hasRefreshToken: true,
        hasOAuthFields: true,
      })
    ).toBe('oauth')
  })

  it('prefers oauth for oauth-only partial config', () => {
    expect(
      resolveGoogleAdsAuthMethodFromCredentialStatus({
        dualStack: false,
        hasOAuthFields: true,
        hasRefreshToken: false,
        hasServiceAccount: false,
      })
    ).toBe('oauth')
  })

  it('prefers service account for sa-only partial config', () => {
    expect(
      resolveGoogleAdsAuthMethodFromCredentialStatus({
        dualStack: false,
        hasServiceAccount: true,
        hasOAuthFields: false,
      })
    ).toBe('service_account')
  })

  it('defaults unconfigured users to oauth', () => {
    expect(
      resolveGoogleAdsAuthMethodFromCredentialStatus({
        dualStack: false,
        hasServiceAccount: false,
        hasOAuthFields: false,
        hasRefreshToken: false,
      })
    ).toBe('oauth')
  })
})

describe('isGoogleAdsAuthMethodLocked', () => {
  it('locks when configured and not dual stack', () => {
    expect(isGoogleAdsAuthMethodLocked({ hasCredentials: true, dualStack: false })).toBe(true)
  })

  it('does not lock during dual stack cleanup', () => {
    expect(isGoogleAdsAuthMethodLocked({ hasCredentials: false, dualStack: true })).toBe(false)
  })
})

describe('resolveGoogleAdsOAuthCallbackErrorMessage', () => {
  it('maps known oauth callback codes', () => {
    expect(resolveGoogleAdsOAuthCallbackErrorMessage('missing_code')).toContain('缺少授权码')
    expect(resolveGoogleAdsOAuthCallbackErrorMessage('auth_conflict')).toContain('服务账号')
  })
})

describe('validateGoogleAdsOAuthForm', () => {
  it('rejects empty login customer id', () => {
    expect(
      validateGoogleAdsOAuthForm({
        login_customer_id: '',
        client_id: 'id',
        client_secret: 'secret',
        developer_token: 'token',
      })
    ).toMatch(/Login Customer ID/)
  })
})
