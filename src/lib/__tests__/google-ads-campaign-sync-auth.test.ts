import { describe, expect, it } from 'vitest'
import { resolveOAuthRefreshToken } from '../google-ads-accounts-auth'

/**
 * Mirrors syncCampaignsFromGoogleAds per-account auth resolution.
 */
function resolveSyncAuthForAccount(
  accountApiAuth: {
    authType: 'oauth' | 'service_account'
    refreshToken: string
    serviceAccountId?: string
  },
  oauthCredentials: { refresh_token?: string } | null,
  account: { service_account_id: string | null },
  assignmentServiceAccountId?: string
) {
  const linkedServiceAccountId =
    typeof account.service_account_id === 'string' ? account.service_account_id.trim() : ''
  const syncAuthType = accountApiAuth.authType
  const syncServiceAccountId =
    accountApiAuth.serviceAccountId ||
    (syncAuthType === 'service_account'
      ? linkedServiceAccountId || assignmentServiceAccountId
      : undefined)
  const syncRefreshToken =
    syncAuthType === 'oauth'
      ? resolveOAuthRefreshToken(accountApiAuth, oauthCredentials) || null
      : null
  return { syncAuthType, syncServiceAccountId, syncRefreshToken }
}

describe('campaign sync auth resolution', () => {
  it('uses shared service account when account row still says oauth', () => {
    const result = resolveSyncAuthForAccount(
      { authType: 'service_account', refreshToken: '', serviceAccountId: 'sa-admin-1' },
      null,
      { service_account_id: null }
    )
    expect(result.syncAuthType).toBe('service_account')
    expect(result.syncServiceAccountId).toBe('sa-admin-1')
    expect(result.syncRefreshToken).toBeNull()
  })

  it('prefers linked account service_account_id over assignment default', () => {
    const result = resolveSyncAuthForAccount(
      { authType: 'service_account', refreshToken: '', serviceAccountId: 'sa-linked-2' },
      null,
      { service_account_id: 'sa-linked-2' },
      'sa-admin-1'
    )
    expect(result.syncServiceAccountId).toBe('sa-linked-2')
  })

  it('uses oauth refresh token from user credentials when account row is empty', () => {
    const result = resolveSyncAuthForAccount(
      { authType: 'oauth', refreshToken: 'shared-refresh' },
      { refresh_token: 'oauth-row-refresh' },
      { service_account_id: null }
    )
    expect(result.syncAuthType).toBe('oauth')
    expect(result.syncRefreshToken).toBe('shared-refresh')
  })

  it('prefers user-level oauth refresh token over oauth credentials row', () => {
    const result = resolveSyncAuthForAccount(
      { authType: 'oauth', refreshToken: 'user-level-refresh' },
      { refresh_token: 'oauth-row-refresh' },
      { service_account_id: null }
    )
    expect(result.syncRefreshToken).toBe('user-level-refresh')
  })

  it('falls back to oauth credentials refresh_token when apiAuth has none', () => {
    const result = resolveSyncAuthForAccount(
      { authType: 'oauth', refreshToken: '' },
      { refresh_token: 'oauth-row-refresh' },
      { service_account_id: null }
    )
    expect(result.syncRefreshToken).toBe('oauth-row-refresh')
  })

  it('does not use stale account-row refresh_token', () => {
    const result = resolveSyncAuthForAccount(
      { authType: 'oauth', refreshToken: '' },
      null,
      { service_account_id: null }
    )
    expect(result.syncRefreshToken).toBeNull()
  })
})
