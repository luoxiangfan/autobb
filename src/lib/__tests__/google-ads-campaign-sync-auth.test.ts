import { describe, expect, it } from 'vitest'
import { resolveSyncAuthForAccount } from '@/lib/google-ads/accounts/auth/index'
import { defaultOAuthAuthContext } from './helpers/campaign-route-auth-context-mock'

const saAuthContext = {
  ...defaultOAuthAuthContext,
  auth: { authType: 'service_account' as const, serviceAccountId: 'sa-admin-1' },
  oauthCredentials: null,
  serviceAccountConfig: { id: 'sa-admin-1', mccCustomerId: '111' },
}

describe('resolveSyncAuthForAccount', () => {
  it('uses shared service account when account row still says oauth', () => {
    const result = resolveSyncAuthForAccount(
      { authType: 'service_account', refreshToken: '', serviceAccountId: 'sa-admin-1' },
      null,
      { service_account_id: null },
      saAuthContext
    )
    expect(result.syncAuthType).toBe('service_account')
    expect(result.syncServiceAccountId).toBe('sa-admin-1')
    expect(result.syncRefreshToken).toBeNull()
  })

  it('prefers linked account service_account_id over context default', () => {
    const result = resolveSyncAuthForAccount(
      { authType: 'service_account', refreshToken: '', serviceAccountId: 'sa-linked-2' },
      null,
      { service_account_id: 'sa-linked-2' },
      saAuthContext
    )
    expect(result.syncServiceAccountId).toBe('sa-linked-2')
  })

  it('uses oauth refresh token from user credentials when account row is empty', () => {
    const result = resolveSyncAuthForAccount(
      { authType: 'oauth', refreshToken: 'shared-refresh' },
      { refresh_token: 'oauth-row-refresh' },
      { service_account_id: null },
      defaultOAuthAuthContext
    )
    expect(result.syncAuthType).toBe('oauth')
    expect(result.syncRefreshToken).toBe('shared-refresh')
  })

  it('prefers user-level oauth refresh token over oauth credentials row', () => {
    const result = resolveSyncAuthForAccount(
      { authType: 'oauth', refreshToken: 'user-level-refresh' },
      { refresh_token: 'oauth-row-refresh' },
      { service_account_id: null },
      defaultOAuthAuthContext
    )
    expect(result.syncRefreshToken).toBe('user-level-refresh')
  })

  it('falls back to oauth credentials refresh_token when apiAuth has none', () => {
    const result = resolveSyncAuthForAccount(
      { authType: 'oauth', refreshToken: '' },
      { refresh_token: 'oauth-row-refresh' },
      { service_account_id: null },
      defaultOAuthAuthContext
    )
    expect(result.syncRefreshToken).toBe('oauth-row-refresh')
  })

  it('returns null refresh when user-level and credentials row are both empty', () => {
    const result = resolveSyncAuthForAccount(
      { authType: 'oauth', refreshToken: '' },
      null,
      { service_account_id: null },
      defaultOAuthAuthContext
    )
    expect(result.syncRefreshToken).toBeNull()
  })
})
