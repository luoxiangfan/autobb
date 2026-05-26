/**
 * Google Ads 账号列表 / API 调用所需的认证解析（auth-context 之上）。
 */
import { getDatabase } from './db'
import { getUserOnlySetting } from './settings'
import {
  resolveGoogleAdsApiAuthFromContext,
  type GoogleAdsApiAuthFields,
  type GoogleAdsAuthContext,
} from './google-ads-auth-context'
import { getServiceAccountConfig } from './google-ads-service-account'

/** 账号列表同步/API 客户端所需的扁平凭证 */
export interface AccountsRouteCredentials {
  client_id: string
  client_secret: string
  developer_token: string
  refresh_token?: string
  login_customer_id?: string | null
}

export interface AccountsRouteAuthBundle {
  authType: 'oauth' | 'service_account'
  serviceAccountId: string | null
  serviceAccountConfig: Awaited<ReturnType<typeof getServiceAccountConfig>>
  credentials: AccountsRouteCredentials
  loginCustomerId: string | null
}

export type AccountsRouteAuthResolveResult =
  | { ok: true; bundle: AccountsRouteAuthBundle }
  | { ok: false; status: number; body: Record<string, unknown> }

export function looksLikeOAuthClientId(value: string): boolean {
  return value.includes('.apps.googleusercontent.com')
}

export function looksLikeOAuthClientSecret(value: string): boolean {
  return /^GOCSPX[-_]?/i.test(value.trim())
}

export function looksLikeOAuthAccessToken(value: string): boolean {
  return /^ya29\./i.test(value.trim())
}

/** OAuth refresh：仅用户级 token（apiAuth / oauthCredentials），不用账号行 refresh_token */
export function resolveOAuthRefreshToken(
  apiAuth: GoogleAdsApiAuthFields,
  oauthCredentials: GoogleAdsAuthContext['oauthCredentials']
): string {
  if (apiAuth.authType !== 'oauth') return ''
  return apiAuth.refreshToken || oauthCredentials?.refresh_token || ''
}

export function developerTokenLooksInvalid(developerToken: string, clientSecret: string): boolean {
  return (
    !developerToken ||
    developerToken.trim() === clientSecret.trim() ||
    looksLikeOAuthClientId(developerToken) ||
    looksLikeOAuthClientSecret(developerToken) ||
    looksLikeOAuthAccessToken(developerToken)
  )
}

function settingDeveloperTokenLooksOk(settingDeveloperToken: string, clientSecret: string): boolean {
  return (
    !!settingDeveloperToken &&
    settingDeveloperToken.trim() !== clientSecret.trim() &&
    !looksLikeOAuthClientId(settingDeveloperToken) &&
    !looksLikeOAuthClientSecret(settingDeveloperToken) &&
    !looksLikeOAuthAccessToken(settingDeveloperToken) &&
    settingDeveloperToken.length >= 20
  )
}

export type DeveloperTokenHealResult =
  | { ok: true }
  | { ok: false; code: 'DEVELOPER_TOKEN_INVALID'; message: string }

const DEVELOPER_TOKEN_INVALID_MESSAGE =
  '当前 Developer Token 看起来不是有效的 Google Ads Developer Token（常见原因：误填为 OAuth Client Secret/Client ID/Access Token）。请在设置页面填写 Google Ads API Center 提供的 Developer Token 后重试。'

/**
 * OAuth / 服务账号：从 settings 自愈 developer_token，并 best-effort 写回凭证表。
 */
export async function healAccountsRouteDeveloperToken(params: {
  credentials: AccountsRouteCredentials
  authType: 'oauth' | 'service_account'
  ownerUserId: number
  clientSecret: string
  serviceAccountId?: string | null
  serviceAccountConfig?: { developerToken?: string } | null
}): Promise<DeveloperTokenHealResult> {
  const developerToken = String(params.credentials.developer_token || '')
  if (!developerTokenLooksInvalid(developerToken, params.clientSecret)) {
    return { ok: true }
  }

  const settingDeveloperToken =
    (await getUserOnlySetting('google_ads', 'developer_token', params.ownerUserId))?.value || ''

  if (
    !settingDeveloperTokenLooksOk(settingDeveloperToken, params.clientSecret) ||
    settingDeveloperToken.trim() === developerToken.trim()
  ) {
    return {
      ok: false,
      code: 'DEVELOPER_TOKEN_INVALID',
      message: DEVELOPER_TOKEN_INVALID_MESSAGE,
    }
  }

  console.warn(
    `[Google Ads] 检测到 ${params.authType === 'service_account' ? '服务账号' : 'OAuth'} developer_token 可能误填，已自动使用设置中的 developer_token`
  )
  params.credentials.developer_token = settingDeveloperToken
  if (params.serviceAccountConfig && 'developerToken' in params.serviceAccountConfig) {
    params.serviceAccountConfig.developerToken = settingDeveloperToken
  }

  const db = await getDatabase()
  const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'

  if (params.authType === 'oauth') {
    await db
      .exec(
        `UPDATE google_ads_credentials SET developer_token = ? WHERE user_id = ? AND ${isActiveCondition}`,
        [settingDeveloperToken, params.ownerUserId]
      )
      .catch(() => {})
  } else if (params.serviceAccountId) {
    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
    await db
      .exec(
        `UPDATE google_ads_service_accounts SET developer_token = ?, updated_at = ${nowFunc} WHERE user_id = ? AND id = ? AND ${isActiveCondition}`,
        [settingDeveloperToken, params.ownerUserId, params.serviceAccountId]
      )
      .catch(() => {})
  }

  return { ok: true }
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
      serviceAccountConfig = await getServiceAccountConfig(userId, serviceAccountId)
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
      console.log(
        '⚠️ 未配置OAuth凭证，使用占位值创建API客户端（服务账号认证不需要OAuth）'
      )
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
    return {
      ok: false,
      status: 404,
      body: {
        error: '未配置 Google Ads 凭证',
        message: '请在设置页面完成 Google Ads API 配置并完成 OAuth 授权',
        code: 'CREDENTIALS_NOT_CONFIGURED',
      },
    }
  }

  const refreshToken = resolveOAuthRefreshToken(apiAuth, oauthCredentials)
  if (!refreshToken) {
    return {
      ok: false,
      status: 401,
      body: { error: '未找到Refresh Token，请先完成OAuth授权' },
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
