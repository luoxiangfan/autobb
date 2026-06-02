import {
  googleAdsApiAuthValidationErrorMessage,
  googleAdsAuthContextDualStackError,
  resolveGoogleAdsApiAuthForAccount,
  resolveGoogleAdsApiAuthFromContext,
  type GoogleAdsApiAuthFields,
  type GoogleAdsAuthContext,
} from './google-ads-auth-context'
import { healAccountsRouteDeveloperToken } from './google-ads-developer-token-heal'
import { resolveOAuthRefreshToken } from './google-ads-accounts-route-auth'
import type {
  AccountsRouteCredentials,
  GoogleAdsLinkedAccountPrepareCache,
  GoogleAdsLinkedAccountPrepareResult,
  OAuthApiCredentialsFields,
  OAuthGoogleAdsCallBundle,
  PreparedGoogleAdsAccountApiCall,
  SyncUserCredentials,
} from './google-ads-accounts-auth-types'
import { toOAuthApiCredentialsFields } from './google-ads-accounts-auth-types'

/** campaign-sync / 定时任务：按账户解析认证方式与 token（与 syncCampaignsFromGoogleAds 一致） */
export function resolveSyncAuthForAccount(
  accountApiAuth: GoogleAdsApiAuthFields,
  oauthCredentials: GoogleAdsAuthContext['oauthCredentials'],
  _account: { service_account_id: string | null },
  _authContext: GoogleAdsAuthContext
) {
  const syncAuthType = accountApiAuth.authType
  const syncServiceAccountId =
    syncAuthType === 'service_account' ? accountApiAuth.serviceAccountId : undefined
  const syncRefreshToken =
    syncAuthType === 'oauth'
      ? resolveOAuthRefreshToken(accountApiAuth, oauthCredentials) || null
      : null
  return { syncAuthType, syncServiceAccountId, syncRefreshToken }
}

export async function resolveHealedOAuthCredentialsFields(params: {
  userId: number
  authContext: GoogleAdsAuthContext
}): Promise<
  | { ok: true; credentials: OAuthApiCredentialsFields; loginCustomerId: string }
  | { ok: false; message: string }
> {
  const dualStackError = googleAdsAuthContextDualStackError(params.authContext)
  if (dualStackError) {
    return { ok: false, message: dualStackError }
  }

  if (params.authContext.auth.authType === 'service_account') {
    return { ok: false, message: `用户(ID=${params.userId})当前使用服务账号认证，无法读取 OAuth 基础凭证` }
  }

  const oauthCredentials = params.authContext.oauthCredentials
  if (!oauthCredentials?.client_id || !oauthCredentials.client_secret) {
    return {
      ok: false,
      message: 'Google Ads OAuth 凭证配置不完整，请在设置页面完成配置',
    }
  }

  const routeCredentials: AccountsRouteCredentials = {
    client_id: oauthCredentials.client_id,
    client_secret: oauthCredentials.client_secret,
    developer_token: oauthCredentials.developer_token,
    refresh_token: oauthCredentials.refresh_token,
    login_customer_id: oauthCredentials.login_customer_id,
  }

  const healResult = await healAccountsRouteDeveloperToken({
    credentials: routeCredentials,
    authType: 'oauth',
    ownerUserId: params.authContext.ownerUserId,
    clientSecret: routeCredentials.client_secret,
    authContext: params.authContext,
  })
  if (!healResult.ok) {
    return { ok: false, message: healResult.message }
  }

  const loginCustomerId = routeCredentials.login_customer_id?.trim() || ''

  return {
    ok: true,
    credentials: toOAuthApiCredentialsFields({
      client_id: routeCredentials.client_id,
      client_secret: routeCredentials.client_secret,
      developer_token: routeCredentials.developer_token,
    }),
    loginCustomerId,
  }
}

export async function loadOAuthGoogleAdsCallBundleForContext(params: {
  userId: number
  authContext: GoogleAdsAuthContext
}): Promise<
  | { ok: true; bundle?: OAuthGoogleAdsCallBundle }
  | { ok: false; message: string }
> {
  const dualStackError = googleAdsAuthContextDualStackError(params.authContext)
  if (dualStackError) {
    return { ok: false, message: dualStackError }
  }

  if (params.authContext.auth.authType !== 'oauth') {
    return { ok: true }
  }

  const healed = await resolveHealedOAuthCredentialsFields(params)
  if (!healed.ok) {
    return { ok: false, message: healed.message }
  }

  return {
    ok: true,
    bundle: {
      oauthCredentials: healed.credentials,
      oauthLoginCustomerId: healed.loginCustomerId || undefined,
    },
  }
}

export function googleAdsAuthContextParam(
  authContext: GoogleAdsAuthContext
): { authContext: GoogleAdsAuthContext } {
  return { authContext }
}

export function preparedAuthContextField(
  prepared: { authContext: GoogleAdsAuthContext }
): { authContext: GoogleAdsAuthContext } {
  return googleAdsAuthContextParam(prepared.authContext)
}

export function syncUserCredentialsFromPrepared(
  prepared: PreparedGoogleAdsAccountApiCall
): SyncUserCredentials | null {
  if (!prepared.oauthCredentials) return null
  return {
    client_id: prepared.oauthCredentials.client_id,
    client_secret: prepared.oauthCredentials.client_secret,
    developer_token: prepared.oauthCredentials.developer_token,
    login_customer_id: prepared.oauthLoginCustomerId,
  }
}

export async function prepareGoogleAdsAccountApiCall(params: {
  authContext: GoogleAdsAuthContext
  linkedServiceAccountId?: string | null
  apiAuth?: GoogleAdsApiAuthFields
}): Promise<
  | ({ ok: true } & PreparedGoogleAdsAccountApiCall)
  | { ok: false; message: string }
> {
  const dualStackError = googleAdsAuthContextDualStackError(params.authContext)
  if (dualStackError) {
    return { ok: false, message: dualStackError }
  }

  const apiAuth =
    params.apiAuth ??
    (await resolveGoogleAdsApiAuthFromContext(
      params.authContext,
      params.linkedServiceAccountId ?? null
    ))

  if (apiAuth.authType === 'oauth' && !apiAuth.refreshToken) {
    return { ok: false, message: 'Google Ads OAuth 授权已过期，请重新连接账号' }
  }
  if (apiAuth.authType === 'service_account' && !apiAuth.serviceAccountId) {
    return { ok: false, message: '未找到服务账号配置' }
  }

  let oauthCredentials: OAuthApiCredentialsFields | undefined
  let oauthLoginCustomerId: string | undefined
  if (apiAuth.authType === 'oauth') {
    const oauthBundle = await loadOAuthGoogleAdsCallBundleForContext({
      userId: params.authContext.userId,
      authContext: params.authContext,
    })
    if (!oauthBundle.ok) {
      return { ok: false, message: oauthBundle.message }
    }
    oauthCredentials = oauthBundle.bundle?.oauthCredentials
    oauthLoginCustomerId =
      oauthBundle.bundle?.oauthLoginCustomerId ?? apiAuth.oauthLoginCustomerId
  }

  return {
    ok: true,
    apiAuth,
    refreshToken: apiAuth.refreshToken || '',
    oauthCredentials,
    oauthLoginCustomerId,
  }
}

export async function prepareGoogleAdsApiCallForLinkedAccount(
  userId: number,
  linkedServiceAccountId?: string | null
): Promise<
  | ({ ok: true; authContext: GoogleAdsAuthContext } & PreparedGoogleAdsAccountApiCall)
  | { ok: false; message: string }
> {
  const authResolved = await resolveGoogleAdsApiAuthForAccount(
    userId,
    linkedServiceAccountId ?? null
  )
  if (!authResolved.ok) {
    return {
      ok: false,
      message: googleAdsApiAuthValidationErrorMessage(authResolved.reason),
    }
  }

  const prepared = await prepareGoogleAdsAccountApiCall({
    authContext: authResolved.ctx,
    linkedServiceAccountId: linkedServiceAccountId ?? null,
    apiAuth: authResolved.apiAuth,
  })
  if (!prepared.ok) {
    return prepared
  }

  return { ...prepared, authContext: authResolved.ctx }
}

export function createGoogleAdsLinkedAccountPrepareCache(): GoogleAdsLinkedAccountPrepareCache {
  return { prepareByLinkedSa: new Map() }
}

export function linkedSaPrepareCacheKey(userId: number, linkedSa: string | null): string {
  return `${userId}\0${linkedSa ?? ''}`
}

function normalizeLinkedSaForPrepareCache(
  linkedSa: string | null | undefined
): string | null {
  if (linkedSa == null) return null
  const trimmed = String(linkedSa).trim()
  return trimmed || null
}

export async function prepareGoogleAdsApiCallForLinkedAccountCached(
  userId: number,
  linkedSa: string | null | undefined,
  cache?: GoogleAdsLinkedAccountPrepareCache
): Promise<GoogleAdsLinkedAccountPrepareResult> {
  const normalizedSa = normalizeLinkedSaForPrepareCache(linkedSa)
  const key = linkedSaPrepareCacheKey(userId, normalizedSa)
  const hit = cache?.prepareByLinkedSa.get(key)
  if (hit) return hit

  const prepared = await prepareGoogleAdsApiCallForLinkedAccount(userId, normalizedSa)
  if (prepared.ok) {
    cache?.prepareByLinkedSa.set(key, prepared)
  }
  return prepared
}
