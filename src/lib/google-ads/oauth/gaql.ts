import {
  getCustomerWithCredentials,
  type OAuthApiCredentialsFields,
} from '@/lib/google-ads/api/api'
import type { GoogleAdsAuthContext } from '@/lib/google-ads/auth/context'
import { runWithLoginCustomerFallbackForAccount } from '@/lib/google-ads/oauth/login-customer'

type GoogleAdsCustomer = Awaited<ReturnType<typeof getCustomerWithCredentials>>

export type OAuthGaqlAdsAccountRef = {
  customer_id: string
  parent_mcc_id?: string | null
  id?: number
}

/**
 * OAuth GAQL：按 login_customer_id 候选创建 customer 并执行查询，权限类错误时自动切换下一候选。
 */
export async function runOAuthGaqlWithLoginCustomerFallback<T>(params: {
  adsAccount: OAuthGaqlAdsAccountRef
  userId: number
  refreshToken: string
  oauthCredentials: OAuthApiCredentialsFields
  oauthLoginCustomerId?: string
  serviceAccountMccId?: string
  serviceAccountId?: string
  /* * prepare 后传入，避免重复 assert / 加载 auth-context */
  authContext?: GoogleAdsAuthContext
  actionName: string
  query: (customer: GoogleAdsCustomer) => Promise<T>
}): Promise<T> {
  return runWithLoginCustomerFallbackForAccount({
    adsAccount: params.adsAccount,
    refreshToken: params.refreshToken,
    authType: 'oauth',
    serviceAccountId: params.serviceAccountId,
    serviceAccountMccId: params.serviceAccountMccId,
    oauthLoginCustomerId: params.oauthLoginCustomerId,
    actionName: params.actionName,
    callback: async (loginCustomerId) => {
      const customer = await getCustomerWithCredentials({
        customerId: params.adsAccount.customer_id,
        refreshToken: params.refreshToken,
        loginCustomerId,
        userId: params.userId,
        credentials: params.oauthCredentials,
        accountParentMccId: params.adsAccount.parent_mcc_id,
        oauthLoginCustomerIdHint: params.oauthLoginCustomerId,
        authType: 'oauth',
        authContext: params.authContext,
      })
      return params.query(customer)
    },
  })
}
