import { describe, expect, it } from 'vitest'
import { formatGoogleAdsAuthSaveError } from './api-messages'
import { resolveGoogleAdsOAuthCallbackErrorMessage } from './oauth-callback-errors'
import { validateGoogleAdsOAuthForm } from './validation'

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

describe('resolveGoogleAdsOAuthCallbackErrorMessage', () => {
  it('maps known oauth callback codes', () => {
    expect(resolveGoogleAdsOAuthCallbackErrorMessage('missing_code')).toContain('缺少授权码')
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
