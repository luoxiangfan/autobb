/**
 * Google Ads 账号列表 / API 调用所需的认证解析（auth-context 之上）。
 */
import { getDatabase } from './db'
import { getUserOnlySetting } from './settings'
import {
  getGoogleAdsAuthContext,
  googleAdsApiAuthValidationErrorMessage,
  googleAdsAuthContextDualStackError,
  resolveEffectiveServiceAccountId,
  resolveGoogleAdsApiAuthForAccount,
  resolveGoogleAdsApiAuthFromContext,
  type GoogleAdsApiAuthFields,
  type GoogleAdsAuthContext,
} from './google-ads-auth-context'
import { getServiceAccountConfig } from './google-ads-service-account'
import type { KeywordIdeasPreparedOAuth } from './google-ads-keyword-planner'
import { getGoogleAdsConfig, getKeywordSearchVolumes } from './keyword-planner'
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

/** campaign-sync / 定时任务：按账户解析认证方式与 token（与 syncCampaignsFromGoogleAds 一致） */
export function resolveSyncAuthForAccount(
  accountApiAuth: GoogleAdsApiAuthFields,
  oauthCredentials: GoogleAdsAuthContext['oauthCredentials'],
  account: { service_account_id: string | null },
  authContext: GoogleAdsAuthContext
) {
  const linkedServiceAccountId =
    typeof account.service_account_id === 'string' ? account.service_account_id.trim() : ''
  const syncAuthType = accountApiAuth.authType
  const syncServiceAccountId =
    accountApiAuth.serviceAccountId ||
    (syncAuthType === 'service_account'
      ? resolveEffectiveServiceAccountId(
          linkedServiceAccountId || account.service_account_id,
          authContext
        )
      : undefined)
  const syncRefreshToken =
    syncAuthType === 'oauth'
      ? resolveOAuthRefreshToken(accountApiAuth, oauthCredentials) || null
      : null
  return { syncAuthType, syncServiceAccountId, syncRefreshToken }
}

export type SyncUserCredentials = {
  client_id: string
  client_secret: string
  developer_token: string
  login_customer_id?: string
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
  const dualStackError = googleAdsAuthContextDualStackError(params.authContext)
  if (dualStackError) {
    return { ok: false, message: dualStackError }
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
      login_customer_id:
        creds.login_customer_id || bundle.loginCustomerId || undefined,
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

/** OAuth API 客户端三元组（不含 refresh_token） */
export type OAuthApiCredentialsFields = {
  client_id: string
  client_secret: string
  developer_token: string
}

/** 含 login_customer_id 的 OAuth 客户端凭证 */
export type OAuthApiClientCredentials = OAuthApiCredentialsFields & {
  login_customer_id: string
}

function toOAuthApiCredentialsFields(
  userCredentials: SyncUserCredentials
): OAuthApiCredentialsFields {
  return {
    client_id: userCredentials.client_id,
    client_secret: userCredentials.client_secret,
    developer_token: userCredentials.developer_token,
  }
}

/**
 * 在已持有 authContext 时解析并 heal OAuth client 凭证（避免重复 resolve/heal）。
 */
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
      login_customer_id: loginCustomerId,
    }),
    loginCustomerId,
  }
}

export type OAuthGoogleAdsCallBundle = {
  oauthCredentials: OAuthApiCredentialsFields
  oauthLoginCustomerId?: string
}

/**
 * OAuth 模式下一次性 heal 并返回可下传的 API 凭证包（非 OAuth 返回 ok 且无 bundle）。
 */
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

export type PreparedGoogleAdsAccountApiCall = {
  apiAuth: GoogleAdsApiAuthFields
  refreshToken: string
  oauthCredentials?: OAuthApiCredentialsFields
  oauthLoginCustomerId?: string
}

/** 与 Google Ads API 调用成对 spread，复用已 assert 的 auth-context */
export function googleAdsAuthContextParam(
  authContext: GoogleAdsAuthContext
): { authContext: GoogleAdsAuthContext } {
  return { authContext }
}

/** prepare 成功后 spread 入内，避免漏传 authContext */
export function preparedAuthContextField(
  prepared: { authContext: GoogleAdsAuthContext }
): { authContext: GoogleAdsAuthContext } {
  return googleAdsAuthContextParam(prepared.authContext)
}

/**
 * 解析账号级 API 调用所需的 refreshToken / heal 凭证（refresh 仅来自 auth-context）。
 */
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

/**
 * 校验用户/账号认证并 prepare（含 OAuth heal）；避免路由层 resolve + prepare 重复编排。
 */
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

export async function prepareGoogleAdsAccountApiCall(params: {
  authContext: GoogleAdsAuthContext
  linkedServiceAccountId?: string | null
  /** 已由 resolveGoogleAdsApiAuthForAccount 解析时传入，避免重复 resolve */
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

/** Keyword Planner Historical Metrics 调用所需的 heal 后凭证（与 keyword-planner KeywordPlannerAuthOptions 同形） */
export type KeywordPlannerVolumeAuth = {
  authType: 'oauth' | 'service_account'
  serviceAccountId?: string
  plannerAuth: {
    existingContext: GoogleAdsAuthContext
    healedOAuth?: {
      credentials: OAuthApiCredentialsFields
      loginCustomerId?: string
      refreshToken?: string
    }
  }
}

export type KeywordPlannerVolumeAuthLoadResult =
  | { ok: true; volumeAuth: KeywordPlannerVolumeAuth }
  | { ok: false; message: string }

/** Keyword Planner Ideas + Historical Metrics 共用 session（单次 prepare 产物） */
export type KeywordPlannerPreparedSession = {
  preparedOAuth?: KeywordIdeasPreparedOAuth
  volumeAuth: KeywordPlannerVolumeAuth
}

export function buildKeywordPlannerSessionFromPrepared(
  prepared: { authContext: GoogleAdsAuthContext } & PreparedGoogleAdsAccountApiCall
): KeywordPlannerPreparedSession {
  const volumeAuth = keywordPlannerVolumeAuthFromPrepared(prepared.authContext, prepared)

  let preparedOAuth: KeywordIdeasPreparedOAuth | undefined
  if (prepared.apiAuth.authType === 'oauth' && prepared.oauthCredentials) {
    preparedOAuth = {
      refreshToken: prepared.refreshToken,
      credentials: prepared.oauthCredentials,
      oauthLoginCustomerId:
        prepared.oauthLoginCustomerId ?? prepared.apiAuth.oauthLoginCustomerId,
      ...preparedAuthContextField(prepared),
    }
  }

  return { preparedOAuth, volumeAuth }
}

export function keywordPlannerVolumeAuthFromPrepared(
  authContext: GoogleAdsAuthContext,
  prepared: PreparedGoogleAdsAccountApiCall
): KeywordPlannerVolumeAuth {
  return {
    authType: prepared.apiAuth.authType,
    serviceAccountId: prepared.apiAuth.serviceAccountId,
    plannerAuth: {
      existingContext: authContext,
      healedOAuth: prepared.oauthCredentials
        ? {
            credentials: prepared.oauthCredentials,
            loginCustomerId: prepared.oauthLoginCustomerId,
            refreshToken: prepared.refreshToken,
          }
        : undefined,
    },
  }
}

/** 按 Google Ads 账号行解析 linked service_account_id */
export async function resolveLinkedServiceAccountIdForGoogleAdsAccount(
  userId: number,
  googleAdsAccountId: number
): Promise<string | null> {
  const db = await getDatabase()
  const row = await db.queryOne<{ service_account_id: string | null }>(
    `SELECT service_account_id FROM google_ads_accounts WHERE id = ? AND user_id = ? LIMIT 1`,
    [googleAdsAccountId, userId]
  )
  const linked = row?.service_account_id?.trim()
  return linked || null
}

/** 解析 Offer/用户关联账号的 linked service_account_id，供 Keyword Planner 使用 */
export async function resolveLinkedServiceAccountIdForOffer(
  userId: number,
  offerId?: number
): Promise<string | null> {
  const db = await getDatabase()

  if (offerId) {
    const fromCampaign = await db.queryOne<{ service_account_id: string | null }>(
      `SELECT ga.service_account_id
       FROM google_ads_accounts ga
       INNER JOIN campaigns c ON c.google_ads_account_id = ga.id AND c.user_id = ?
       WHERE c.offer_id = ?
         AND ga.service_account_id IS NOT NULL
         AND TRIM(ga.service_account_id) <> ''
       ORDER BY c.updated_at DESC
       LIMIT 1`,
      [userId, offerId]
    )
    const linkedFromCampaign = fromCampaign?.service_account_id?.trim()
    if (linkedFromCampaign) return linkedFromCampaign
  }

  const isActiveCondition =
    db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
  const isManagerCondition =
    db.type === 'postgres' ? 'is_manager_account = false' : 'is_manager_account = 0'

  const account = await db.queryOne<{ service_account_id: string | null }>(
    `SELECT service_account_id FROM google_ads_accounts
     WHERE user_id = ? AND ${isActiveCondition} AND status = 'ENABLED' AND ${isManagerCondition}
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  )

  const linked = account?.service_account_id?.trim()
  return linked || null
}

export async function loadKeywordPlannerVolumeAuthForOffer(
  userId: number,
  offerId?: number
): Promise<KeywordPlannerVolumeAuthLoadResult> {
  return loadKeywordPlannerVolumeAuthForContext({ userId, offerId })
}

export type KeywordPlannerVolumeAuthContextParams = {
  userId: number
  offerId?: number
  googleAdsAccountId?: number
  /** 显式传入时跳过自动解析 */
  linkedServiceAccountId?: string | null
}

/** 按 Offer / Ads 账号 / 显式 linked SA 解析 Keyword Planner 用的 linked SA */
export async function resolveLinkedServiceAccountIdForKeywordPlannerContext(
  params: KeywordPlannerVolumeAuthContextParams
): Promise<string | null> {
  if (params.linkedServiceAccountId !== undefined) {
    return params.linkedServiceAccountId
  }
  if (params.googleAdsAccountId) {
    return resolveLinkedServiceAccountIdForGoogleAdsAccount(
      params.userId,
      params.googleAdsAccountId
    )
  }
  return resolveLinkedServiceAccountIdForOffer(params.userId, params.offerId)
}

/** 按 Offer / Ads 账号解析 linked SA 后加载 volume 认证 */
export async function loadKeywordPlannerVolumeAuthForContext(
  params: KeywordPlannerVolumeAuthContextParams
): Promise<KeywordPlannerVolumeAuthLoadResult> {
  const linkedSa = await resolveLinkedServiceAccountIdForKeywordPlannerContext(params)
  return loadKeywordPlannerVolumeAuth(params.userId, linkedSa)
}

/**
 * 解析 Keyword Planner 搜索量 API 的认证（校验 + prepare/heal，单次入口）。
 */
export async function loadKeywordPlannerVolumeAuth(
  userId: number,
  linkedServiceAccountId?: string | null
): Promise<KeywordPlannerVolumeAuthLoadResult> {
  const prepared = await prepareGoogleAdsApiCallForLinkedAccount(
    userId,
    linkedServiceAccountId ?? null
  )
  if (!prepared.ok) {
    return { ok: false, message: prepared.message }
  }

  return {
    ok: true,
    volumeAuth: keywordPlannerVolumeAuthFromPrepared(prepared.authContext, prepared),
  }
}

/** Keyword Planner 搜索量查询（linked SA + prepare/heal，单次入口） */
export async function getKeywordSearchVolumesForPlannerContext(
  params: KeywordPlannerVolumeAuthContextParams & {
    keywords: string[]
    country: string
    language: string
    /** 已由 loadKeywordPoolExpandCredentialsForOffer 等 prepare 时传入，避免重复 heal */
    plannerSession?: KeywordPlannerPreparedSession
    onProgress?: (info: { message: string; current?: number; total?: number }) => Promise<void> | void
  }
): Promise<
  | { ok: true; volumes: Awaited<ReturnType<typeof getKeywordSearchVolumes>> }
  | { ok: false; message: string }
> {
  let volumeAuth = params.plannerSession?.volumeAuth
  if (!volumeAuth) {
    const loaded = await loadKeywordPlannerVolumeAuthForContext(params)
    if (!loaded.ok) {
      return { ok: false, message: loaded.message }
    }
    volumeAuth = loaded.volumeAuth
  }

  const volumes = await getKeywordSearchVolumes(
    params.keywords,
    params.country,
    params.language,
    params.userId,
    volumeAuth.authType,
    volumeAuth.serviceAccountId,
    params.onProgress,
    volumeAuth.plannerAuth
  )
  return { ok: true, volumes }
}

export type CreativeGenerationGoogleAdsValidationResult =
  | {
      ok: false
      message: string
      authType?: 'oauth' | 'service_account'
      missingFields?: string[]
    }
  | { ok: true; authContext: GoogleAdsAuthContext; apiAuth: GoogleAdsApiAuthFields }

export type GoogleAdsLinkedAccountPrepareResult = Awaited<
  ReturnType<typeof prepareGoogleAdsApiCallForLinkedAccount>
>

/** 批量任务：按 userId + linked SA 复用 prepare 结果 */
export type GoogleAdsLinkedAccountPrepareCache = {
  prepareByLinkedSa: Map<string, GoogleAdsLinkedAccountPrepareResult>
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
  cache?.prepareByLinkedSa.set(key, prepared)
  return prepared
}

/** 批量创意入队等场景：复用 linked SA 的 prepare 与按 offer 的校验结果 */
export type CreativeGenerationAuthCache = GoogleAdsLinkedAccountPrepareCache & {
  validationByOfferId: Map<number, CreativeGenerationGoogleAdsValidationResult>
}

export function createCreativeGenerationAuthCache(): CreativeGenerationAuthCache {
  return {
    ...createGoogleAdsLinkedAccountPrepareCache(),
    validationByOfferId: new Map(),
  }
}

/**
 * OAuth customerId：与关键词池 expand 一致，优先 Offer 关联 Ads 账号行，否则 login_customer_id。
 */
async function resolveOAuthCustomerIdForPlannerContext(
  userId: number,
  offerId: number | undefined,
  googleAdsConfig: Awaited<ReturnType<typeof getGoogleAdsConfig>>
): Promise<string | null> {
  if (offerId != null) {
    const adsAccount = await queryGoogleAdsAccountForOfferExpand(userId, offerId)
    const fromAccount = adsAccount?.customer_id?.trim()
    if (fromAccount) return fromAccount
  }
  const fromLogin =
    googleAdsConfig?.customerId?.trim() || googleAdsConfig?.loginCustomerId?.trim() || ''
  return fromLogin || null
}

async function validateGoogleAdsConfigForCreativeGenerationInternal(
  userId: number,
  offerId: number | undefined,
  cache?: CreativeGenerationAuthCache
): Promise<CreativeGenerationGoogleAdsValidationResult> {
  const linkedSa =
    offerId != null ? await resolveLinkedServiceAccountIdForOffer(userId, offerId) : null

  const prepared = await prepareGoogleAdsApiCallForLinkedAccountCached(
    userId,
    linkedSa,
    cache
  )
  if (!prepared.ok) {
    return { ok: false, message: prepared.message }
  }

  const { authContext, apiAuth } = prepared
  const googleAdsConfig = await getGoogleAdsConfig(
    userId,
    apiAuth.authType,
    apiAuth.serviceAccountId,
    authContext,
    prepared.oauthCredentials
      ? {
          credentials: prepared.oauthCredentials,
          loginCustomerId: prepared.oauthLoginCustomerId,
          refreshToken: prepared.refreshToken,
        }
      : undefined
  )

  if (apiAuth.authType === 'service_account') {
    const isConfigComplete = !!(googleAdsConfig?.developerToken && googleAdsConfig?.customerId)
    if (!isConfigComplete) {
      return {
        ok: false,
        message: '广告创意生成需要完整的 Google Ads API 配置',
        authType: apiAuth.authType,
        missingFields: [
          !googleAdsConfig?.developerToken && 'Developer Token',
          !googleAdsConfig?.customerId && 'MCC Customer ID',
        ].filter(Boolean) as string[],
      }
    }
    return { ok: true, authContext, apiAuth }
  }

  const oauthCustomerId = await resolveOAuthCustomerIdForPlannerContext(
    userId,
    offerId,
    googleAdsConfig
  )
  const isConfigComplete = !!(
    googleAdsConfig?.developerToken &&
    googleAdsConfig?.refreshToken &&
    oauthCustomerId
  )

  if (!isConfigComplete) {
    return {
      ok: false,
      message: '广告创意生成需要完整的 Google Ads API 配置',
      authType: apiAuth.authType,
      missingFields: [
        !googleAdsConfig?.developerToken && 'Developer Token',
        !googleAdsConfig?.refreshToken && 'Refresh Token / OAuth',
        !oauthCustomerId && 'Customer ID',
      ].filter(Boolean) as string[],
    }
  }

  return { ok: true, authContext, apiAuth }
}

/**
 * 创意生成入队前校验 Google Ads 配置（linked SA + prepare/heal）。
 * 提供 offerId 时按 Offer 关联账号解析 linked SA；批量入队可省略 offerId（用户级 prepare）。
 * 传入 cache 时复用同 linked SA 的 prepare 与同 offerId 的校验结果。
 */
export async function validateGoogleAdsConfigForCreativeGeneration(
  userId: number,
  offerId?: number,
  cache?: CreativeGenerationAuthCache
): Promise<CreativeGenerationGoogleAdsValidationResult> {
  if (offerId != null && cache?.validationByOfferId.has(offerId)) {
    return cache.validationByOfferId.get(offerId)!
  }

  const result = await validateGoogleAdsConfigForCreativeGenerationInternal(
    userId,
    offerId,
    cache
  )

  if (offerId != null) {
    cache?.validationByOfferId.set(offerId, result)
  }

  return result
}

export type KeywordPoolExpandCredentials = {
  authType: 'oauth' | 'service_account'
  /** 本次 prepare 使用的 linked SA（供 expandKeywordsWithSeeds 复用，避免重复 prepare） */
  linkedServiceAccountId?: string | null
  customerId?: string
  refreshToken?: string
  accountId?: number
  clientId?: string
  clientSecret?: string
  developerToken?: string
}

export type ResolveKeywordPlannerLinkedSaParams = {
  userId: number
  offerId?: number
  /** 显式传入时跳过 offerId / serviceAccountId 解析 */
  linkedServiceAccountId?: string | null
  /** 与 linkedServiceAccountId 等价的历史字段，仅当 linkedServiceAccountId 未传入时生效 */
  serviceAccountId?: string | null
}

/**
 * Keyword Planner session：解析 linked SA。
 *
 * 优先级（勿随意调整，调用方可能同时传多个字段）：
 * 1. `linkedServiceAccountId` 已传入（含显式 `null`）→ 直接使用，不再查库
 * 2. `offerId` → `resolveLinkedServiceAccountIdForOffer`（campaign 关联账号行 SA，否则用户最近启用账号）
 * 3. `serviceAccountId`（deprecated）→ 仅作显式 SA 字符串回退
 */
export async function resolveKeywordPlannerLinkedServiceAccountId(
  params: ResolveKeywordPlannerLinkedSaParams
): Promise<string | null> {
  if (params.linkedServiceAccountId !== undefined) {
    return params.linkedServiceAccountId
  }
  if (params.offerId) {
    return resolveLinkedServiceAccountIdForOffer(params.userId, params.offerId)
  }
  const legacy = params.serviceAccountId?.trim()
  return legacy || null
}

async function queryGoogleAdsAccountForOfferExpand(
  userId: number,
  offerId: number
): Promise<{ id: number; customer_id: string } | undefined> {
  const db = await getDatabase()
  const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
  const isManagerCondition =
    db.type === 'postgres' ? 'is_manager_account = false' : 'is_manager_account = 0'

  const fromCampaign = await db.queryOne<{ id: number; customer_id: string }>(
    `SELECT ga.id, ga.customer_id
     FROM google_ads_accounts ga
     INNER JOIN campaigns c ON c.google_ads_account_id = ga.id AND c.user_id = ?
     WHERE c.offer_id = ?
       AND ga.status = 'ENABLED'
       AND ${isActiveCondition}
       AND ${isManagerCondition}
     ORDER BY c.updated_at DESC
     LIMIT 1`,
    [userId, offerId]
  )
  if (fromCampaign?.customer_id) {
    return fromCampaign
  }

  return db.queryOne<{ id: number; customer_id: string }>(
    `SELECT id, customer_id FROM google_ads_accounts
     WHERE user_id = ? AND ${isActiveCondition} AND status = 'ENABLED' AND ${isManagerCondition}
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  )
}

export type KeywordPoolExpandLoadResult =
  | { ok: false }
  | {
      ok: true
      creds: KeywordPoolExpandCredentials
      plannerSession: KeywordPlannerPreparedSession
    }

/** 已由 loadKeywordPoolExpandCredentialsForOffer prepare 成功时传入池生成，避免重复 heal */
export type KeywordPoolPreparedExpand = Extract<KeywordPoolExpandLoadResult, { ok: true }>

/** 关键词池扩展：单次 prepare，返回 OAuth 字段 + 可复用的 planner session */
export async function loadKeywordPoolExpandCredentialsForOffer(
  userId: number,
  offerId: number
): Promise<KeywordPoolExpandLoadResult> {
  const linkedSa = await resolveLinkedServiceAccountIdForOffer(userId, offerId)
  const prepared = await prepareGoogleAdsApiCallForLinkedAccount(userId, linkedSa)
  if (!prepared.ok) {
    return { ok: false }
  }

  const plannerSession = buildKeywordPlannerSessionFromPrepared(prepared)
  const authType = prepared.apiAuth.authType
  if (authType === 'service_account') {
    return {
      ok: true,
      creds: { authType: 'service_account', linkedServiceAccountId: linkedSa },
      plannerSession,
    }
  }

  const adsAccount = await queryGoogleAdsAccountForOfferExpand(userId, offerId)
  if (!adsAccount?.customer_id) {
    return {
      ok: true,
      creds: { authType: 'oauth', linkedServiceAccountId: linkedSa },
      plannerSession,
    }
  }

  const oauthCreds = syncUserCredentialsFromPrepared(prepared)
  return {
    ok: true,
    creds: {
      authType: 'oauth',
      linkedServiceAccountId: linkedSa,
      customerId: adsAccount.customer_id,
      refreshToken: prepared.refreshToken,
      accountId: adsAccount.id,
      clientId: oauthCreds?.client_id,
      clientSecret: oauthCreds?.client_secret,
      developerToken: oauthCreds?.developer_token,
    },
    plannerSession,
  }
}

/**
 * 通过 auth-context 解析 OAuth client 凭证（含 developer_token heal）。
 */
export async function resolveOAuthClientCredentialsForUser(
  userId: number,
  options: {
    requireLoginCustomerId?: boolean
    /** 调用方已 assert 时传入，避免重复加载 auth-context */
    existingAuthContext?: GoogleAdsAuthContext
  } = {}
): Promise<OAuthApiClientCredentials> {
  const requireLogin = options.requireLoginCustomerId !== false
  const authContext =
    options.existingAuthContext ?? (await getGoogleAdsAuthContext(userId))
  const dualStackError = googleAdsAuthContextDualStackError(authContext)
  if (dualStackError) {
    throw new Error(dualStackError)
  }
  if (authContext.auth.authType === 'service_account') {
    throw new Error(`用户(ID=${userId})当前使用服务账号认证，无法读取 OAuth 基础凭证`)
  }

  const credResolved = await resolveAndHealSyncUserCredentials({
    userId,
    authContext,
    authType: 'oauth',
    serviceAccountId: null,
  })
  if (!credResolved.ok) {
    throw new Error(credResolved.message)
  }

  const loginCustomerId = credResolved.userCredentials.login_customer_id?.trim() || ''
  if (requireLogin && !loginCustomerId) {
    throw new Error(`用户(ID=${userId})未配置 login_customer_id。OAuth模式需要此参数。`)
  }

  return {
    ...toOAuthApiCredentialsFields(credResolved.userCredentials),
    login_customer_id: loginCustomerId,
  }
}

/**
 * 解析 OAuth 凭证且要求配置 login_customer_id（历史默认行为）。
 */
export async function resolveOAuthApiCredentialsForUser(
  userId: number
): Promise<OAuthApiClientCredentials> {
  return resolveOAuthClientCredentialsForUser(userId, { requireLoginCustomerId: true })
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

export type DeveloperTokenHealCode = 'DEVELOPER_TOKEN_INVALID' | 'DUAL_STACK_CONFLICT'

export type DeveloperTokenHealResult =
  | { ok: true }
  | { ok: false; code: DeveloperTokenHealCode; message: string }

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
  /** 传入时用于双栈拦截，避免误写 developer_token */
  authContext?: GoogleAdsAuthContext
}): Promise<DeveloperTokenHealResult> {
  let authContext = params.authContext
  if (!authContext) {
    const { getGoogleAdsAuthContext } = await import('./google-ads-auth-context')
    authContext = await getGoogleAdsAuthContext(params.ownerUserId)
  }

  const dualStackError = googleAdsAuthContextDualStackError(authContext)
  if (dualStackError) {
    return { ok: false, code: 'DUAL_STACK_CONFLICT', message: dualStackError }
  }

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

  const dualStackError = googleAdsAuthContextDualStackError(authContext)
  if (dualStackError) {
    return {
      ok: false,
      status: 409,
      body: {
        error: dualStackError,
        code: 'DUAL_STACK_CONFLICT',
        message: dualStackError,
        authConfigWarning: dualStackError,
      },
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

/** 单次 load expand；若调用方已传入 session / preparedExpand 则不再重复请求 */
export async function resolvePlannerExpandForOffer(
  userId: number,
  offerId: number,
  existing?: {
    plannerSession?: KeywordPlannerPreparedSession
    preparedExpand?: KeywordPoolExpandLoadResult
  }
): Promise<{
  plannerSession?: KeywordPlannerPreparedSession
  preparedExpand?: KeywordPoolExpandLoadResult
}> {
  if (existing?.preparedExpand !== undefined) {
    return {
      preparedExpand: existing.preparedExpand,
      plannerSession:
        existing.plannerSession ??
        (existing.preparedExpand.ok ? existing.preparedExpand.plannerSession : undefined),
    }
  }
  if (existing?.plannerSession !== undefined) {
    return {
      plannerSession: existing.plannerSession,
      preparedExpand: existing.preparedExpand,
    }
  }
  const expandLoad = await loadKeywordPoolExpandCredentialsForOffer(userId, offerId)
  return {
    preparedExpand: expandLoad,
    plannerSession: expandLoad.ok ? expandLoad.plannerSession : undefined,
  }
}
