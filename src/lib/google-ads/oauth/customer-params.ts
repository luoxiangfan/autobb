import type { OAuthApiCredentialsFields } from '@/lib/google-ads/accounts/auth/types'
import type { GoogleAdsAuthContext } from '@/lib/google-ads/auth/context'

/* * 高层 API 共用的 Customer 凭证字段（不含 authContext）。 */
export type GoogleAdsCustomerCredentialParams = {
  customerId: string
  refreshToken?: string
  accountId?: number
  userId: number
  loginCustomerId?: string | null
  credentials?: OAuthApiCredentialsFields
  serviceAccountId?: string
  accountParentMccId?: string | null
  oauthLoginCustomerIdHint?: string
}

/* * OAuth 分支 getCustomerWithCredentials 入参（与 google-ads-api 约定一致）。 */
export type OAuthGetCustomerWithCredentialsParams = {
  customerId: string
  refreshToken: string
  accountId?: number
  userId: number
  loginCustomerId?: string | null
  credentials?: OAuthApiCredentialsFields
  authType: 'oauth'
  serviceAccountId?: string
  authContext: GoogleAdsAuthContext
  accountParentMccId?: string | null
  oauthLoginCustomerIdHint?: string
}

/**
 * OAuth 分支构造 getCustomerWithCredentials 入参（显式 oauth + 透传已解析的 authContext）。
 */
export function oauthGetCustomerParams(
  params: GoogleAdsCustomerCredentialParams,
  authContext: GoogleAdsAuthContext
): OAuthGetCustomerWithCredentialsParams {
  if (!params.refreshToken) {
    throw new Error('refreshToken is required for OAuth authentication')
  }
  return {
    customerId: params.customerId,
    refreshToken: params.refreshToken,
    accountId: params.accountId,
    userId: params.userId,
    loginCustomerId: params.loginCustomerId,
    credentials: params.credentials,
    authType: 'oauth',
    serviceAccountId: params.serviceAccountId,
    authContext,
    accountParentMccId: params.accountParentMccId,
    oauthLoginCustomerIdHint: params.oauthLoginCustomerIdHint,
  }
}
