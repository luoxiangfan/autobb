import { describe, expect, it } from 'vitest'
import { formatGoogleAdsAuthSaveError } from './api-messages'
import { resolveGoogleAdsOAuthCallbackErrorMessage } from './oauth-callback-errors'
import {
  validateGoogleAdsOAuthForm,
  validateGoogleAdsOAuthFormForSave,
  resolveEffectiveGoogleAdsAuthMethod,
  resolveGoogleAdsAuthMethodFromCredentialStatus,
  resolveAuthMethodAfterCredentialStatusRefresh,
  shouldApplyGoogleAdsAuthMethodFromCredentialStatus,
  shouldFetchGoogleAdsServiceAccounts,
  resolveGoogleAdsOAuthStartGate,
  resolveGoogleAdsOAuthVerifyGate,
  validateGoogleAdsServiceAccountForm,
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

describe('shouldApplyGoogleAdsAuthMethodFromCredentialStatus', () => {
  it('applies on first load', () => {
    expect(
      shouldApplyGoogleAdsAuthMethodFromCredentialStatus(null, {
        hasCredentials: false,
        dualStack: true,
      })
    ).toBe(true)
  })

  it('applies when configured and locked', () => {
    expect(
      shouldApplyGoogleAdsAuthMethodFromCredentialStatus(
        { hasCredentials: false, dualStack: false, authType: undefined },
        { hasCredentials: true, dualStack: false, authType: 'oauth' }
      )
    ).toBe(true)
  })

  it('does not apply on refresh when dual stack unchanged', () => {
    expect(
      shouldApplyGoogleAdsAuthMethodFromCredentialStatus(
        { hasCredentials: false, dualStack: true, authType: undefined },
        { hasCredentials: false, dualStack: true, authType: undefined }
      )
    ).toBe(false)
  })

  it('does not apply on refresh when unconfigured unchanged', () => {
    expect(
      shouldApplyGoogleAdsAuthMethodFromCredentialStatus(
        { hasCredentials: false, dualStack: false, authType: undefined },
        { hasCredentials: false, dualStack: false, authType: undefined }
      )
    ).toBe(false)
  })

  it('applies when dual stack clears after cleanup', () => {
    expect(
      shouldApplyGoogleAdsAuthMethodFromCredentialStatus(
        { hasCredentials: false, dualStack: true, authType: undefined },
        { hasCredentials: true, dualStack: false, authType: 'service_account' }
      )
    ).toBe(true)
  })

  it('applies when authType changes', () => {
    expect(
      shouldApplyGoogleAdsAuthMethodFromCredentialStatus(
        { hasCredentials: true, dualStack: false, authType: 'oauth' },
        { hasCredentials: true, dualStack: false, authType: 'service_account' }
      )
    ).toBe(true)
  })

  it('applies when unconfigured user gains service account partial config', () => {
    expect(
      shouldApplyGoogleAdsAuthMethodFromCredentialStatus(
        {
          hasCredentials: false,
          dualStack: false,
          hasServiceAccount: false,
        },
        {
          hasCredentials: false,
          dualStack: false,
          hasServiceAccount: true,
        }
      )
    ).toBe(true)
  })

  it('applies when unconfigured user gains oauth partial config', () => {
    expect(
      shouldApplyGoogleAdsAuthMethodFromCredentialStatus(
        {
          hasCredentials: false,
          dualStack: false,
          hasOAuthFields: false,
        },
        {
          hasCredentials: false,
          dualStack: false,
          hasOAuthFields: true,
        }
      )
    ).toBe(true)
  })

  it('does not apply partial flag churn during unchanged dual stack refresh', () => {
    expect(
      shouldApplyGoogleAdsAuthMethodFromCredentialStatus(
        {
          hasCredentials: false,
          dualStack: true,
          hasServiceAccount: true,
          hasOAuthFields: true,
        },
        {
          hasCredentials: false,
          dualStack: true,
          hasServiceAccount: true,
          hasOAuthFields: true,
        }
      )
    ).toBe(false)
  })
})

describe('resolveAuthMethodAfterCredentialStatusRefresh', () => {
  const dualStackStatus = {
    hasCredentials: false,
    dualStack: true,
    hasServiceAccount: true,
    hasRefreshToken: true,
    hasOAuthFields: true,
  }

  it('preserves service_account tab when dual stack unchanged on refresh', () => {
    expect(
      resolveAuthMethodAfterCredentialStatusRefresh(
        dualStackStatus,
        dualStackStatus,
        'service_account'
      )
    ).toBe('service_account')
  })

  it('applies oauth on first load for dual stack', () => {
    expect(
      resolveAuthMethodAfterCredentialStatusRefresh(null, dualStackStatus, 'service_account')
    ).toBe('oauth')
  })

  it('applies service_account when dual stack clears and SA remains configured', () => {
    expect(
      resolveAuthMethodAfterCredentialStatusRefresh(
        dualStackStatus,
        {
          hasCredentials: true,
          dualStack: false,
          authType: 'service_account',
          hasServiceAccount: true,
        },
        'oauth'
      )
    ).toBe('service_account')
  })

  it('switches to service_account when unconfigured user saves SA partial config', () => {
    expect(
      resolveAuthMethodAfterCredentialStatusRefresh(
        {
          hasCredentials: false,
          dualStack: false,
          hasServiceAccount: false,
        },
        {
          hasCredentials: false,
          dualStack: false,
          hasServiceAccount: true,
        },
        'oauth'
      )
    ).toBe('service_account')
  })
})

describe('shouldFetchGoogleAdsServiceAccounts', () => {
  it('fetches for configured service account auth', () => {
    expect(
      shouldFetchGoogleAdsServiceAccounts({
        authType: 'service_account',
        hasServiceAccount: true,
      })
    ).toBe(true)
  })

  it('fetches for dual stack with service account present', () => {
    expect(
      shouldFetchGoogleAdsServiceAccounts({
        authType: undefined,
        hasServiceAccount: true,
      })
    ).toBe(true)
  })

  it('skips for oauth-only configuration', () => {
    expect(
      shouldFetchGoogleAdsServiceAccounts({
        authType: 'oauth',
        hasServiceAccount: false,
      })
    ).toBe(false)
  })

  it('skips when status is missing', () => {
    expect(shouldFetchGoogleAdsServiceAccounts(null)).toBe(false)
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

describe('validateGoogleAdsOAuthFormForSave', () => {
  it('accepts empty secret fields when credential status marks them configured', () => {
    expect(
      validateGoogleAdsOAuthFormForSave(
        {
          login_customer_id: '1234567890',
          client_id: 'cid.apps.googleusercontent.com',
          client_secret: '',
          developer_token: '',
        },
        {
          dualStack: false,
          hasCredentials: false,
          clientSecretConfigured: true,
          developerTokenConfigured: true,
        }
      )
    ).toBeNull()
  })

  it('accepts login customer id from credential status when form field was cleared', () => {
    expect(
      validateGoogleAdsOAuthFormForSave(
        {
          login_customer_id: '',
          client_id: 'cid.apps.googleusercontent.com',
          client_secret: 'secret',
          developer_token: 'token',
        },
        {
          dualStack: false,
          hasCredentials: false,
          loginCustomerId: '1234567890',
        }
      )
    ).toBeNull()
  })

  it('rejects dual stack saves', () => {
    expect(
      validateGoogleAdsOAuthFormForSave(
        {
          login_customer_id: '1234567890',
          client_id: 'cid.apps.googleusercontent.com',
          client_secret: 'secret',
          developer_token: 'token',
        },
        { dualStack: true, hasCredentials: false }
      )
    ).toMatch(/双栈/)
  })

  it('falls back to form-only validation when credential status is missing', () => {
    expect(
      validateGoogleAdsOAuthFormForSave(
        {
          login_customer_id: '1234567890',
          client_id: 'cid.apps.googleusercontent.com',
          client_secret: '',
          developer_token: 'token',
        },
        null
      )
    ).toMatch(/Client Secret/)
  })
})

describe('resolveGoogleAdsOAuthStartGate', () => {
  it('accepts saved oauth fields from credential status', () => {
    expect(
      resolveGoogleAdsOAuthStartGate({
        dualStack: false,
        authType: 'oauth',
        hasCredentials: false,
        loginCustomerId: '1234567890',
        clientIdConfigured: true,
        clientSecretConfigured: true,
        developerTokenConfigured: true,
      })
    ).toEqual({ ok: true })
  })

  it('rejects when secrets are not saved yet', () => {
    const result = resolveGoogleAdsOAuthStartGate({
      dualStack: false,
      authType: 'oauth',
      hasCredentials: false,
      loginCustomerId: '1234567890',
      clientId: 'abc.apps.googleusercontent.com',
      clientSecretConfigured: false,
      developerTokenConfigured: true,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toMatch(/Client Secret/)
    }
  })

  it('rejects dual stack', () => {
    const result = resolveGoogleAdsOAuthStartGate({
      dualStack: true,
      hasCredentials: false,
    })
    expect(result.ok).toBe(false)
  })
})

describe('resolveGoogleAdsOAuthVerifyGate', () => {
  it('blocks when oauth form has unsaved changes', () => {
    const result = resolveGoogleAdsOAuthVerifyGate(
      {
        dualStack: false,
        authType: 'oauth',
        hasCredentials: true,
        loginCustomerId: '1234567890',
        clientIdConfigured: true,
        clientSecretConfigured: true,
        developerTokenConfigured: true,
      },
      true
    )
    expect(result.ok).toBe(false)
  })
})

describe('validateGoogleAdsServiceAccountForm', () => {
  it('rejects invalid mcc id', () => {
    expect(
      validateGoogleAdsServiceAccountForm({
        name: 'prod',
        mccCustomerId: '123',
        developerToken: 'token',
        serviceAccountJson: '{"client_email":"a@b.iam.gserviceaccount.com","private_key":"k"}',
      })
    ).toMatch(/10位数字/)
  })

  it('accepts valid service account json', () => {
    expect(
      validateGoogleAdsServiceAccountForm({
        name: 'prod',
        mccCustomerId: '1234567890',
        developerToken: 'token',
        serviceAccountJson: '{"client_email":"a@b.iam.gserviceaccount.com","private_key":"k"}',
      })
    ).toBeNull()
  })
})
