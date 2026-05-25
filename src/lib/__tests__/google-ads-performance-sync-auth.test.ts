import { describe, expect, it } from 'vitest'

/**
 * Mirrors syncUserPerformanceData service account id resolution.
 */
function resolvePerformanceSyncServiceAccountId(
  auth: { authType: 'oauth' | 'service_account'; serviceAccountId?: string },
  configId: string | undefined,
  account: { service_account_id: string | null }
): string | undefined {
  const linked =
    typeof account.service_account_id === 'string' ? account.service_account_id.trim() : ''
  if (auth.authType !== 'service_account') {
    return undefined
  }
  return linked || configId || auth.serviceAccountId
}

describe('performance sync auth resolution', () => {
  it('uses assignment service account when account row has no service_account_id', () => {
    expect(
      resolvePerformanceSyncServiceAccountId(
        { authType: 'service_account', serviceAccountId: 'sa-admin' },
        'sa-admin',
        { service_account_id: null }
      )
    ).toBe('sa-admin')
  })

  it('prefers linked account service_account_id', () => {
    expect(
      resolvePerformanceSyncServiceAccountId(
        { authType: 'service_account', serviceAccountId: 'sa-admin' },
        'sa-admin',
        { service_account_id: 'sa-linked' }
      )
    ).toBe('sa-linked')
  })

  it('falls back to serviceAccountConfig id when auth has no serviceAccountId', () => {
    expect(
      resolvePerformanceSyncServiceAccountId(
        { authType: 'service_account' },
        'sa-from-config',
        { service_account_id: null }
      )
    ).toBe('sa-from-config')
  })

  it('returns undefined for oauth auth', () => {
    expect(
      resolvePerformanceSyncServiceAccountId(
        { authType: 'oauth' },
        undefined,
        { service_account_id: 'sa-linked' }
      )
    ).toBeUndefined()
  })
})
