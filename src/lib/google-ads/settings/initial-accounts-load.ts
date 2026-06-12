import {
  resolveAccountsRequestAuth,
  type ParsedGoogleAdsCredentialsStatus,
} from '@/lib/google-ads/common/credentials-errors'

export type GoogleAdsInitialAccountsLoadHandlers = {
  refreshCredentialsStatus: () => Promise<ParsedGoogleAdsCredentialsStatus>
  fetchOAuthAccounts: (opts?: { skipCredentialsRefresh?: boolean }) => Promise<void>
  fetchServiceAccountAccounts: (
    serviceAccountId: string,
    opts?: { skipCredentialsRefresh?: boolean }
  ) => Promise<void>
  onAuthConfigWarning?: (warning: string) => void
}

/**
 * 按 auth-context 凭证状态拉取账号列表；双栈警告时不隐式回落服务账号。
 */
export async function runInitialGoogleAdsAccountsLoad(
  handlers: GoogleAdsInitialAccountsLoadHandlers
): Promise<void> {
  const auth = await handlers.refreshCredentialsStatus()
  const resolved = resolveAccountsRequestAuth(auth)
  if (!resolved.ok) {
    if (resolved.reason === 'auth_config_warning') {
      handlers.onAuthConfigWarning?.(resolved.authConfigWarning)
    }
    return
  }

  const { authForRequest } = resolved
  if (authForRequest.authType === 'service_account' && authForRequest.serviceAccountId) {
    await handlers.fetchServiceAccountAccounts(authForRequest.serviceAccountId, {
      skipCredentialsRefresh: true,
    })
    return
  }

  if (authForRequest.authType === 'oauth') {
    await handlers.fetchOAuthAccounts({ skipCredentialsRefresh: true })
  }
}
