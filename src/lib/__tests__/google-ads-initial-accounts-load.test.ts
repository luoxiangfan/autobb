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

    await runInitialGoogleAdsAccountsLoad({
      refreshCredentialsStatus,
      fetchOAuthAccounts,
      fetchServiceAccountAccounts,
    })

    expect(fetchOAuthAccounts).toHaveBeenCalledWith({ skipCredentialsRefresh: true })
    expect(fetchServiceAccountAccounts).not.toHaveBeenCalled()
  })

  it('does not fall back to service account when OAuth is not configured', async () => {
    const refreshCredentialsStatus = vi.fn(async () => ({
      hasCredentials: false,
      authType: 'oauth' as const,
      serviceAccountId: null,
    }))
    const fetchOAuthAccounts = vi.fn(async () => {})
    const fetchServiceAccountAccounts = vi.fn(async () => {})

    await runInitialGoogleAdsAccountsLoad({
      refreshCredentialsStatus,
      fetchOAuthAccounts,
      fetchServiceAccountAccounts,
    })

    expect(fetchOAuthAccounts).not.toHaveBeenCalled()
    expect(fetchServiceAccountAccounts).not.toHaveBeenCalled()
  })

  it('stops after dual-stack warning without implicit SA fallback', async () => {
    const onAuthConfigWarning = vi.fn()
    const refreshCredentialsStatus = vi.fn(async () => ({
      hasCredentials: true,
      authType: 'oauth' as const,
      serviceAccountId: null,
      authConfigWarning: 'dual stack warning',
    }))
    const fetchOAuthAccounts = vi.fn(async () => {})
    const fetchServiceAccountAccounts = vi.fn(async () => {})

    await runInitialGoogleAdsAccountsLoad({
      refreshCredentialsStatus,
      fetchOAuthAccounts,
      fetchServiceAccountAccounts,
      onAuthConfigWarning,
    })

    expect(onAuthConfigWarning).toHaveBeenCalledWith('dual stack warning')
    expect(fetchOAuthAccounts).not.toHaveBeenCalled()
    expect(fetchServiceAccountAccounts).not.toHaveBeenCalled()
  })

  it('does not load SA accounts when dual-stack warning even if authType is service_account', async () => {
    const onAuthConfigWarning = vi.fn()
    const refreshCredentialsStatus = vi.fn(async () => ({
      hasCredentials: true,
      authType: 'service_account' as const,
      serviceAccountId: 'sa-bound',
      authConfigWarning: 'dual stack warning',
    }))
    const fetchOAuthAccounts = vi.fn(async () => {})
    const fetchServiceAccountAccounts = vi.fn(async () => {})

    await runInitialGoogleAdsAccountsLoad({
      refreshCredentialsStatus,
      fetchOAuthAccounts,
      fetchServiceAccountAccounts,
      onAuthConfigWarning,
    })

    expect(onAuthConfigWarning).toHaveBeenCalledWith('dual stack warning')
    expect(fetchServiceAccountAccounts).not.toHaveBeenCalled()
    expect(fetchOAuthAccounts).not.toHaveBeenCalled()
  })

  it('loads service account accounts when resolveAccountsRequestAuth succeeds', async () => {
    const refreshCredentialsStatus = vi.fn(async () => ({
      hasCredentials: true,
      authType: 'service_account' as const,
      serviceAccountId: 'sa-bound',
      authConfigWarning: null,
    }))
    const fetchOAuthAccounts = vi.fn(async () => {})
    const fetchServiceAccountAccounts = vi.fn(async () => {})

    await runInitialGoogleAdsAccountsLoad({
      refreshCredentialsStatus,
      fetchOAuthAccounts,
      fetchServiceAccountAccounts,
    })

    expect(fetchServiceAccountAccounts).toHaveBeenCalledWith('sa-bound', {
      skipCredentialsRefresh: true,
    })
    expect(fetchOAuthAccounts).not.toHaveBeenCalled()
  })
})
