import type { ParsedGoogleAdsCredentialsStatus } from '@/lib/google-ads-credentials-errors'

export type GoogleAdsInitialAccountsLoadHandlers = {
  refreshCredentialsStatus: () => Promise<ParsedGoogleAdsCredentialsStatus>
  fetchOAuthAccounts: (opts?: { skipCredentialsRefresh?: boolean }) => Promise<void>
  fetchServiceAccountAccounts: (
    serviceAccountId: string,
    opts?: { skipCredentialsRefresh?: boolean }
  ) => Promise<void>
  listServiceAccounts: () => Promise<Array<{ id: string }>>
  onAuthConfigWarning?: (warning: string) => void
}

/**
 * OAuth 与 SA 共存时优先 OAuth；仅在未配置 OAuth 时回落到首个 SA 拉取账号列表。
 */
export async function runInitialGoogleAdsAccountsLoad(
  handlers: GoogleAdsInitialAccountsLoadHandlers
): Promise<void> {
  const auth = await handlers.refreshCredentialsStatus()
  if (auth.authConfigWarning) {
    handlers.onAuthConfigWarning?.(auth.authConfigWarning)
  }

  if (auth.authType === 'service_account' && auth.serviceAccountId) {
    await handlers.fetchServiceAccountAccounts(auth.serviceAccountId, {
      skipCredentialsRefresh: true,
    })
    return
  }

  if (auth.hasCredentials && auth.authType === 'oauth') {
    await handlers.fetchOAuthAccounts({ skipCredentialsRefresh: true })
    return
  }

  const accounts = await handlers.listServiceAccounts()
  if (accounts.length > 0) {
    await handlers.fetchServiceAccountAccounts(accounts[0].id, {
      skipCredentialsRefresh: true,
    })
  }
}
