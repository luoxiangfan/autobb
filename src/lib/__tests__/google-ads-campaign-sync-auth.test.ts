import { describe, expect, it } from 'vitest'

/**
 * Mirrors syncCampaignsFromGoogleAds auth resolution (assignment-first, account row fallback).
 */
function resolveSyncAuthForAccount(
  auth: { authType: 'oauth' | 'service_account'; serviceAccountId?: string },
  oauthRefreshToken: string | null | undefined,
  account: { refresh_token: string | null; service_account_id: string | null }
) {
  const linkedServiceAccountId =
    typeof account.service_account_id === 'string' ? account.service_account_id.trim() : ''
  const syncAuthType = auth.authType
  const syncServiceAccountId =
    syncAuthType === 'service_account'
      ? linkedServiceAccountId || auth.serviceAccountId
      : undefined
  const syncRefreshToken =
    syncAuthType === 'oauth'
      ? account.refresh_token || oauthRefreshToken || null
      : null
  return { syncAuthType, syncServiceAccountId, syncRefreshToken }
}

describe('campaign sync auth resolution', () => {
  it('uses shared service account when account row still says oauth', () => {
    const result = resolveSyncAuthForAccount(
      { authType: 'service_account', serviceAccountId: 'sa-admin-1' },
      null,
      { refresh_token: null, service_account_id: null }
    )
    expect(result.syncAuthType).toBe('service_account')
    expect(result.syncServiceAccountId).toBe('sa-admin-1')
    expect(result.syncRefreshToken).toBeNull()
  })

  it('prefers linked account service_account_id over assignment default', () => {
    const result = resolveSyncAuthForAccount(
      { authType: 'service_account', serviceAccountId: 'sa-admin-1' },
      null,
      { refresh_token: null, service_account_id: 'sa-linked-2' }
    )
    expect(result.syncServiceAccountId).toBe('sa-linked-2')
  })

  it('uses oauth refresh token from credentials when account row is empty', () => {
    const result = resolveSyncAuthForAccount(
      { authType: 'oauth' },
      'shared-refresh',
      { refresh_token: null, service_account_id: null }
    )
    expect(result.syncAuthType).toBe('oauth')
    expect(result.syncRefreshToken).toBe('shared-refresh')
  })
})
