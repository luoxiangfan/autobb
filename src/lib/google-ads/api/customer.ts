import type { Customer } from 'google-ads-api'
import { updateGoogleAdsAccount } from '@/lib/google-ads/accounts/accounts'
import { withRetry } from '../../common/server'
import {
  resolveOAuthClientCredentialsForUser,
  type OAuthApiCredentialsFields,
} from '@/lib/google-ads/accounts/auth/index'
import {
  resolveGoogleAdsApiAuthType,
  type GoogleAdsAuthContext,
} from '@/lib/google-ads/auth/context'
import { getGoogleAdsClient, refreshAccessToken } from './oauth-client'

/** prepare 后可选传入，高层 API 透传至 getCustomerWithCredentials */
export type GoogleAdsApiAuthContextField = {
  authContext?: GoogleAdsAuthContext
}

export async function getCustomer(
  customerId: string,
  refreshToken: string,
  loginCustomerId: string | null,
  credentials: {
    client_id: string
    client_secret: string
    developer_token: string
  },
  userId: number,
  accountId?: number
): Promise<Customer> {
  if (!credentials) {
    throw new Error('缺少Google Ads凭证,必须从数据库提供 credentials 参数')
  }

  // login_customer_id:
  // - 通过MCC访问子账户时，通常需要设置为MCC customer_id
  // - 直接访问账户(非通过管理账户)时，根据Google Ads API文档可省略
  // 此处允许传入 null 来显式省略 login_customer_id（用于自动降级策略）
  if (loginCustomerId === undefined) {
    throw new Error('缺少 Login Customer ID(MCC账户ID)。如需省略，请显式传入 null。')
  }

  const client = getGoogleAdsClient(credentials)

  // OAuth认证模式（原有逻辑）
  try {
    // 尝试使用refresh token获取新的access token（带重试）
    const tokens = await withRetry(
      () =>
        refreshAccessToken(refreshToken, {
          client_id: credentials.client_id,
          client_secret: credentials.client_secret,
        }),
      {
        maxRetries: 2,
        initialDelay: 500,
        shouldRetry: (error) => {
          const message = error?.message || String(error)
          // invalid_grant / invalid_client 属于不可自愈错误，不需要重试
          if (message.includes('invalid_grant') || message.includes('invalid_client')) return false
          return true
        },
        operationName: 'Refresh Google Ads Token',
      }
    )

    // 更新数据库中的token
    if (accountId && userId) {
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      await updateGoogleAdsAccount(accountId, userId, {
        accessToken: tokens.access_token,
        tokenExpiresAt: expiresAt,
      })
    }

    // 创建customer实例
    const customerParams: any = {
      customer_id: customerId,
      refresh_token: refreshToken,
    }
    if (loginCustomerId) {
      customerParams.login_customer_id = loginCustomerId
    }

    const customer = client.Customer(customerParams)

    return customer
  } catch (error: any) {
    throw new Error(`获取Google Ads Customer失败: ${error.message}`)
  }
}

async function ensureGoogleAdsAuthReadyForApi(
  userId: number,
  authContext?: import('@/lib/google-ads/auth/context').GoogleAdsAuthContext
): Promise<import('@/lib/google-ads/auth/context').GoogleAdsAuthContext> {
  if (authContext) {
    const { googleAdsAuthContextDualStackError } = await import('@/lib/google-ads/auth/context')
    const dualStackError = googleAdsAuthContextDualStackError(authContext)
    if (dualStackError) {
      throw new Error(dualStackError)
    }
    return authContext
  }
  const { assertGoogleAdsAuthReadyForApi } = await import('@/lib/google-ads/auth/context')
  return assertGoogleAdsAuthReadyForApi(userId)
}

export async function resolveGoogleAdsApiCallAuth(params: {
  authType?: 'oauth' | 'service_account'
  userId: number
  authContext?: GoogleAdsAuthContext
}): Promise<{
  authType: 'oauth' | 'service_account'
  authContext: GoogleAdsAuthContext
}> {
  const authContext = await ensureGoogleAdsAuthReadyForApi(params.userId, params.authContext)
  const authType = resolveGoogleAdsApiAuthType(params, authContext)
  return { authType, authContext }
}

/** 高层 API：解析 authType（含与 context 冲突检测；勿使用 `|| 'oauth'`）。 */
export async function resolveAuthTypeForGoogleAdsApiCall(params: {
  authType?: 'oauth' | 'service_account'
  userId: number
  authContext?: GoogleAdsAuthContext
}): Promise<'oauth' | 'service_account'> {
  const { authType } = await resolveGoogleAdsApiCallAuth(params)
  return authType
}

/**
 * 辅助函数：从数据库获取凭证并创建 Customer 实例。
 * 支持 OAuth 与服务账号；服务账号模式不需要 client_id/client_secret。
 *
 * 调用约定（与「OAuth / 服务账号二选一」一致）：
 * - 业务入口应优先 `prepareGoogleAdsApiCallForLinkedAccount` / `resolveGoogleAdsApiAuthForAccount`，
 *   勿在双栈（`dualStack`）或仅残留凭证时直接传入 `authType: 'service_account'` 绕过校验。
 * - OAuth 且未传 `credentials` 时会经 `resolveOAuthClientCredentialsForUser`（含双栈拦截）。
 * - 服务账号走 `getUnifiedGoogleAdsClient`（复用本函数已 assert 的 authContext，避免重复加载）。
 * - OAuth 可传 `authContext`（如 Keyword Planner prepare 后），避免重复 assert / 加载。
 */
export async function getCustomerWithCredentials(params: {
  customerId: string
  refreshToken?: string // OAuth模式需要
  accountId?: number
  userId: number
  loginCustomerId?: string | null
  credentials?: OAuthApiCredentialsFields
  /** 已传 credentials 且未显式传 loginCustomerId 时，用于推导 header */
  accountParentMccId?: string | null
  oauthLoginCustomerIdHint?: string
  // 服务账号认证参数
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  /** 调用方已校验双栈时传入，避免重复加载 auth-context */
  authContext?: GoogleAdsAuthContext
}): Promise<Customer> {
  if (!params.userId) {
    throw new Error('userId is required to fetch Google Ads credentials')
  }

  const authCtx = await ensureGoogleAdsAuthReadyForApi(params.userId, params.authContext)

  const authType = resolveGoogleAdsApiAuthType(params, authCtx)

  if (authType === 'service_account') {
    // 服务账号认证模式：使用 @htdangkhoa/google-ads，不需要 client_id/client_secret
    const { getUnifiedGoogleAdsClient } =
      await import('@/lib/google-ads/service-account/service-account')

    return getUnifiedGoogleAdsClient({
      customerId: params.customerId,
      // 服务账号模式下不需要 credentials（使用 JWT 认证）
      authConfig: {
        authType: 'service_account',
        userId: params.userId,
        serviceAccountId: params.serviceAccountId,
      },
      authContext: authCtx,
    })
  } else {
    // OAuth认证模式
    if (!params.refreshToken) {
      throw new Error('refreshToken is required for OAuth authentication')
    }

    const hasExplicitLoginCustomerId = Object.prototype.hasOwnProperty.call(
      params,
      'loginCustomerId'
    )
    const omitLoginCustomerHeader =
      hasExplicitLoginCustomerId && params.loginCustomerId === undefined

    let clientCreds: OAuthApiCredentialsFields
    let resolvedLoginCustomerId: string | null = null
    if (params.credentials) {
      clientCreds = params.credentials
      if (!hasExplicitLoginCustomerId) {
        const { resolveLoginCustomerCandidates } =
          await import('@/lib/google-ads/oauth/login-customer')
        resolvedLoginCustomerId =
          resolveLoginCustomerCandidates({
            authType: 'oauth',
            accountParentMccId: params.accountParentMccId,
            oauthLoginCustomerId: params.oauthLoginCustomerIdHint,
            targetCustomerId: params.customerId,
          })[0] ?? null
      }
    } else {
      const resolved = await resolveOAuthClientCredentialsForUser(params.userId, {
        requireLoginCustomerId: !omitLoginCustomerHeader,
        existingAuthContext: authCtx,
      })
      clientCreds = resolved
      resolvedLoginCustomerId = resolved.login_customer_id?.trim() || null
    }

    const loginCustomerId = hasExplicitLoginCustomerId
      ? (params.loginCustomerId ?? null)
      : resolvedLoginCustomerId

    return getCustomer(
      params.customerId,
      params.refreshToken,
      loginCustomerId,
      {
        client_id: clientCreds.client_id,
        client_secret: clientCreds.client_secret,
        developer_token: clientCreds.developer_token,
      },
      params.userId,
      params.accountId
    )
  }
}
