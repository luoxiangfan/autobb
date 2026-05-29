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
 * 按 auth-context 凭证状态拉取账号列表；双栈警告时不隐式回落服务账号。
 */
export async function runInitialGoogleAdsAccountsLoad(
  handlers: GoogleAdsInitialAccountsLoadHandlers
): Promise<void> {
  const auth = await handlers.refreshCredentialsStatus()
  if (auth.authConfigWarning) {
    handlers.onAuthConfigWarning?.(auth.authConfigWarning)
    return
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
}
