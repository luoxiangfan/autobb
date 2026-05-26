import { describe, expect, it, vi } from 'vitest'
import { runInitialGoogleAdsAccountsLoad } from '@/lib/google-ads-initial-accounts-load'

describe('runInitialGoogleAdsAccountsLoad', () => {
  it('prefers OAuth accounts when OAuth is configured', async () => {
    const refreshCredentialsStatus = vi.fn(async () => ({
      hasCredentials: true,
      authType: 'oauth' as const,
      serviceAccountId: null,
      authConfigWarning: undefined,
    }))
    const fetchOAuthAccounts = vi.fn(async () => {})
    const fetchServiceAccountAccounts = vi.fn(async () => {})
    const listServiceAccounts = vi.fn(async () => [{ id: 'sa-1' }])

    await runInitialGoogleAdsAccountsLoad({
      refreshCredentialsStatus,
      fetchOAuthAccounts,
      fetchServiceAccountAccounts,
      listServiceAccounts,
    })

    expect(fetchOAuthAccounts).toHaveBeenCalledWith({ skipCredentialsRefresh: true })
    expect(fetchServiceAccountAccounts).not.toHaveBeenCalled()
    expect(listServiceAccounts).not.toHaveBeenCalled()
  })

  it('falls back to first service account when OAuth is not configured', async () => {
    const refreshCredentialsStatus = vi.fn(async () => ({
      hasCredentials: false,
      authType: 'oauth' as const,
      serviceAccountId: null,
    }))
    const fetchOAuthAccounts = vi.fn(async () => {})
    const fetchServiceAccountAccounts = vi.fn(async () => {})
    const listServiceAccounts = vi.fn(async () => [{ id: 'sa-first' }, { id: 'sa-second' }])

    await runInitialGoogleAdsAccountsLoad({
      refreshCredentialsStatus,
      fetchOAuthAccounts,
      fetchServiceAccountAccounts,
      listServiceAccounts,
    })

    expect(fetchOAuthAccounts).not.toHaveBeenCalled()
    expect(fetchServiceAccountAccounts).toHaveBeenCalledWith('sa-first', {
      skipCredentialsRefresh: true,
    })
  })
})
