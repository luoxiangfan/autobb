import {
  getGoogleAdsAuthContext,
  googleAdsApiAuthValidationErrorMessage,
  googleAdsAuthReadyFailureHttpStatus,
  googleAdsAuthReadyFailurePayload,
  resolveGoogleAdsApiAuthFromContext,
  resolveGoogleAdsAuthReadyFailure,
  type GoogleAdsApiAuthFields,
  type GoogleAdsAuthContext,
} from './google-ads-auth-context'
import { getServiceAccountConfig } from './google-ads-service-account'
import { healAccountsRouteDeveloperToken } from './google-ads-developer-token-heal'
import type {
  AccountsRouteAuthBundle,
  AccountsRouteAuthResolveResult,
  AccountsRouteCredentials,
  OAuthApiClientCredentials,
  SyncUserCredentials,
} from './google-ads-accounts-auth-types'

export function resolveOAuthRefreshToken(
  apiAuth: GoogleAdsApiAuthFields,
  oauthCredentials: GoogleAdsAuthContext['oauthCredentials']
): string {
  if (apiAuth.authType !== 'oauth') return ''
  return apiAuth.refreshToken || oauthCredentials?.refresh_token || ''
}

export function accountsBundleResolveErrorMessage(body: Record<string, unknown>): string {
  if (typeof body.message === 'string' && body.message.trim()) return body.message
  if (typeof body.error === 'string' && body.error.trim()) return body.error
  return 'Google Ads 凭证配置不完整，请在设置页面完成配置'
}

/**
 * data-sync 等后台任务：解析并 heal developer_token（OAuth / 服务账号）。
 */
export async function resolveAndHealSyncUserCredentials(params: {
  userId: number
  authContext: GoogleAdsAuthContext
  authType: 'oauth' | 'service_account'
  serviceAccountId: string | null
}): Promise<
  | {
      ok: true
      userCredentials: SyncUserCredentials
      serviceAccountConfig: AccountsRouteAuthBundle['serviceAccountConfig']
    }
  | { ok: false; message: string }
> {
  const authFailure = resolveGoogleAdsAuthReadyFailure(params.authContext)
  if (authFailure) {
    return { ok: false, message: authFailure.message }
  }

  const resolved = await resolveAccountsRouteAuthBundle({
    userId: params.userId,
    authContext: params.authContext,
    authType: params.authType,
    serviceAccountId: params.serviceAccountId,
  })
  if (!resolved.ok) {
    return { ok: false, message: accountsBundleResolveErrorMessage(resolved.body) }
  }

  const bundle = resolved.bundle
  const creds = bundle.credentials
  const healResult = await healAccountsRouteDeveloperToken({
    credentials: creds,
    authType: params.authType,
    ownerUserId: params.authContext.ownerUserId,
    clientSecret: creds.client_secret,
    serviceAccountId: bundle.serviceAccountId,
    serviceAccountConfig: bundle.serviceAccountConfig,
    authContext: params.authContext,
  })
  if (!healResult.ok) {
    return { ok: false, message: healResult.message }
  }

  return {
    ok: true,
    userCredentials: {
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      developer_token: creds.developer_token,
      login_customer_id: creds.login_customer_id || bundle.loginCustomerId || undefined,
    },
    serviceAccountConfig: bundle.serviceAccountConfig,
  }
}

/**
 * 后台同步任务凭证：OAuth 使用 loadOAuthGoogleAdsCallBundleForContext；服务账号仍走 resolveAndHealSyncUserCredentials。
 */
export async function resolveSyncUserCredentialsForJob(params: {
  userId: number
  authContext: GoogleAdsAuthContext
  authType: 'oauth' | 'service_account'
  serviceAccountId: string | null
}): Promise<
  | {
      ok: true
      userCredentials: SyncUserCredentials
      serviceAccountConfig: AccountsRouteAuthBundle['serviceAccountConfig']
    }
  | { ok: false; message: string }
> {
  if (params.authType === 'oauth') {
    const { loadOAuthGoogleAdsCallBundleForContext } = await import('./google-ads-api-prepare')
    const oauthBundle = await loadOAuthGoogleAdsCallBundleForContext({
      userId: params.userId,
      authContext: params.authContext,
    })
    if (!oauthBundle.ok) {
      return { ok: false, message: oauthBundle.message }
    }
    const creds = oauthBundle.bundle?.oauthCredentials
    if (!creds) {
      return { ok: false, message: 'OAuth credentials bundle missing' }
    }
    return {
      ok: true,
      userCredentials: {
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        developer_token: creds.developer_token,
        login_customer_id: oauthBundle.bundle?.oauthLoginCustomerId,
      },
      serviceAccountConfig: null,
    }
  }

  return resolveAndHealSyncUserCredentials(params)
}

/**
 * 通过 auth-context 解析 OAuth client 凭证（含 developer_token heal）。
 */
export async function resolveOAuthClientCredentialsForUser(
  userId: number,
  options: {
    requireLoginCustomerId?: boolean
    existingAuthContext?: GoogleAdsAuthContext
  } = {}
): Promise<OAuthApiClientCredentials> {
  const requireLogin = options.requireLoginCustomerId !== false
  const authContext = options.existingAuthContext ?? (await getGoogleAdsAuthContext(userId))
  const authFailure = resolveGoogleAdsAuthReadyFailure(authContext)
  if (authFailure) {
    throw new Error(authFailure.message)
  }
  if (authContext.auth.authType === 'service_account') {
    throw new Error(`用户(ID=${userId})当前使用服务账号认证，无法读取 OAuth 基础凭证`)
  }

  const { loadOAuthGoogleAdsCallBundleForContext } = await import('./google-ads-api-prepare')
  const oauthBundle = await loadOAuthGoogleAdsCallBundleForContext({ userId, authContext })
  if (!oauthBundle.ok) {
    throw new Error(oauthBundle.message)
  }
  const creds = oauthBundle.bundle?.oauthCredentials
  if (!creds) {
    throw new Error('OAuth credentials bundle missing')
  }

  const loginCustomerId =
    oauthBundle.bundle?.oauthLoginCustomerId?.trim() ||
    authContext.oauthCredentials?.login_customer_id?.trim() ||
    ''
  if (requireLogin && !loginCustomerId) {
    throw new Error(`用户(ID=${userId})未配置 login_customer_id。OAuth模式需要此参数。`)
  }

  return {
    ...creds,
    login_customer_id: loginCustomerId,
  }
}

export async function resolveOAuthApiCredentialsForUser(
  userId: number
): Promise<OAuthApiClientCredentials> {
  return resolveOAuthClientCredentialsForUser(userId, { requireLoginCustomerId: true })
}

/**
 * 从 auth-context 解析账号列表路由所需的凭证与 MCC（OAuth / 服务账号二选一，无自动回退）。
 */
export async function resolveAccountsRouteAuthBundle(params: {
  userId: number
  authContext: GoogleAdsAuthContext
  authType: 'oauth' | 'service_account'
  serviceAccountId: string | null
}): Promise<AccountsRouteAuthResolveResult> {
  const { userId, authContext, authType } = params

  const authFailure = resolveGoogleAdsAuthReadyFailure(authContext)
  if (authFailure) {
    return {
      ok: false,
      status: googleAdsAuthReadyFailureHttpStatus(authFailure.reason),
      body: googleAdsAuthReadyFailurePayload(authFailure),
    }
  }

  if (authType === 'service_account') {
    const serviceAccountId = params.serviceAccountId
    if (!serviceAccountId) {
      return {
        ok: false,
        status: 400,
        body: {
          error: '缺少服务账号ID',
          message: '使用服务账号认证时必须指定 service_account_id 参数',
        },
      }
    }

    const apiAuth = await resolveGoogleAdsApiAuthFromContext(authContext, serviceAccountId)

    let serviceAccountConfig = authContext.serviceAccountConfig
    if (!serviceAccountConfig?.id || String(serviceAccountConfig.id) !== String(serviceAccountId)) {
      serviceAccountConfig = await getServiceAccountConfig(userId, serviceAccountId, {
        ownerUserId: authContext.ownerUserId,
        assignment: authContext.assignment,
        isShared: authContext.isShared,
      })
    }
    if (!serviceAccountConfig) {
      return {
        ok: false,
        status: 404,
        body: {
          error: '服务账号配置不存在或已禁用',
          message: '请先在设置页面配置服务账号',
        },
      }
    }

    const oauthCredentials = authContext.oauthCredentials
    if (!oauthCredentials?.client_id) {
      console.log('⚠️ 未配置OAuth凭证，使用占位值创建API客户端（服务账号认证不需要OAuth）')
    }

    const credentials: AccountsRouteCredentials = {
      client_id: oauthCredentials?.client_id || 'placeholder-client-id',
      client_secret: oauthCredentials?.client_secret || 'placeholder-client-secret',
      developer_token: serviceAccountConfig.developerToken,
    }

    const loginCustomerId =
      apiAuth.serviceAccountMccId || serviceAccountConfig.mccCustomerId || null

    return {
      ok: true,
      bundle: {
        authType: 'service_account',
        serviceAccountId,
        serviceAccountConfig,
        credentials,
        loginCustomerId,
      },
    }
  }

  const apiAuth = await resolveGoogleAdsApiAuthFromContext(authContext, null)
  const oauthCredentials = authContext.oauthCredentials
  if (!oauthCredentials) {
    const authFailure = resolveGoogleAdsAuthReadyFailure(authContext) ?? {
      reason: 'not_configured',
      message: googleAdsApiAuthValidationErrorMessage('not_configured'),
    }
    return {
      ok: false,
      status: googleAdsAuthReadyFailureHttpStatus(authFailure.reason),
      body: googleAdsAuthReadyFailurePayload(authFailure),
    }
  }

  const refreshToken = resolveOAuthRefreshToken(apiAuth, oauthCredentials)
  if (!refreshToken) {
    const message = googleAdsApiAuthValidationErrorMessage('oauth_refresh_missing')
    return {
      ok: false,
      status: 401,
      body: {
        error: message,
        message,
        code: 'OAUTH_REFRESH_MISSING',
      },
    }
  }

  const loginCustomerId =
    apiAuth.oauthLoginCustomerId ||
    (oauthCredentials.login_customer_id ? String(oauthCredentials.login_customer_id) : null)

  const credentials: AccountsRouteCredentials = {
    client_id: oauthCredentials.client_id,
    client_secret: oauthCredentials.client_secret,
    developer_token: oauthCredentials.developer_token,
    refresh_token: refreshToken,
    login_customer_id: loginCustomerId,
  }

  return {
    ok: true,
    bundle: {
      authType: 'oauth',
      serviceAccountId: null,
      serviceAccountConfig: null,
      credentials,
      loginCustomerId,
    },
  }
}
