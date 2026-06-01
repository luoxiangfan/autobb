/**
 * Google Ads 认证上下文（assignment + OAuth / 服务账号凭证）。
 *
 * 产品规则：OAuth 与服务账号二选一，切换前须删除当前配置（设置页约束）；勿实现双栈或 OAuth→用户级 SA 自动回退。
 *
 * 约定：
 * - 需要调用 Google Ads API 时，优先 `getGoogleAdsAuthContext(userId)`，勿散落 `getUserAuthType` + `getGoogleAdsCredentials`。
 * - `linkedAccountServiceAccountId` 仅在用户当前为服务账号认证时生效；OAuth 用户传入账号 SA 不会切换为服务账号调用。
 * - 是否已配置：用 `hasConfiguredGoogleAdsAuthFromContext`（按 userId 查请用 `google-ads-auth-assignment.hasConfiguredGoogleAdsAuth`），勿仅用 `auth.serviceAccountId` 判断。
 * - 已持有 context 做 heal/sync 前须 `googleAdsAuthContextDualStackError`；禁止在 `dualStack` 时绕过 `resolve` 直接调 API。
 * - 按 userId 发起 API 前可用 `assertGoogleAdsAuthReadyForApi`（`getCustomerWithCredentials` / 统一客户端 / `syncAccountsFromAPI` 已用）。
 */
import {
  isGoogleAdsAuthShared,
  resolveGoogleAdsCredentialOwnerId,
  resolveGoogleAdsApiAccessLevel,
  type GoogleAdsAuthAssignment,
} from './google-ads-auth-assignment'
import { boolCondition } from './db-helpers'
import { getDatabase } from './db'
import {
  getGoogleAdsCredentials,
  getGoogleAdsCredentialsRaw,
  getUserAuthType,
} from './google-ads-oauth'
import { getServiceAccountConfig } from './google-ads-service-account'

export interface GoogleAdsAuthContext {
  userId: number
  ownerUserId: number
  assignment: GoogleAdsAuthAssignment | null
  isShared: boolean
  canModify: boolean
  /** OAuth refresh_token 与活跃服务账号同时存在（历史双栈残留） */
  dualStack: boolean
  auth: {
    authType: 'oauth' | 'service_account'
    serviceAccountId?: string
  }
  oauthCredentials: Awaited<ReturnType<typeof getGoogleAdsCredentials>>
  serviceAccountConfig: Awaited<ReturnType<typeof getServiceAccountConfig>>
}

async function resolveDualStackOnOwner(
  ownerUserId: number,
  options?: { oauthRefreshAlreadyLoaded?: boolean }
): Promise<{
  hasOAuthRefresh: boolean
  hasActiveServiceAccount: boolean
  dualStack: boolean
}> {
  const hasOAuthRefresh =
    options?.oauthRefreshAlreadyLoaded ??
    Boolean((await getGoogleAdsCredentialsRaw(ownerUserId))?.refresh_token)

  const db = await getDatabase()
  const isActiveCondition = boolCondition('is_active', true, db.type)
  const existingSa = await db.queryOne<{ id: string }>(
    `SELECT id FROM google_ads_service_accounts WHERE user_id = ? AND ${isActiveCondition} LIMIT 1`,
    [ownerUserId]
  )
  const hasActiveServiceAccount = Boolean(existingSa)
  return {
    hasOAuthRefresh,
    hasActiveServiceAccount,
    dualStack: hasOAuthRefresh && hasActiveServiceAccount,
  }
}

export interface GoogleAdsApiAuthFields {
  authType: 'oauth' | 'service_account'
  refreshToken: string
  serviceAccountId?: string
  serviceAccountMccId?: string
  oauthLoginCustomerId?: string
}

const authContextInflight = new Map<number, Promise<GoogleAdsAuthContext>>()

async function loadGoogleAdsAuthContext(userId: number): Promise<GoogleAdsAuthContext> {
  const resolution = await resolveGoogleAdsCredentialOwnerId(userId)
  const { ownerUserId, assignment, isShared } = resolution
  const auth = await getUserAuthType(userId, resolution)

  let oauthCredentials: Awaited<ReturnType<typeof getGoogleAdsCredentials>> = null
  let serviceAccountConfig: Awaited<ReturnType<typeof getServiceAccountConfig>> = null

  if (auth.authType === 'oauth') {
    oauthCredentials = await getGoogleAdsCredentials(userId, resolution)
  } else {
    serviceAccountConfig = await getServiceAccountConfig(userId, auth.serviceAccountId, resolution)
  }

  const { dualStack } = await resolveDualStackOnOwner(ownerUserId, {
    oauthRefreshAlreadyLoaded:
      auth.authType === 'oauth' ? Boolean(oauthCredentials?.refresh_token) : undefined,
  })

  return {
    userId,
    ownerUserId,
    assignment,
    isShared,
    canModify: !isGoogleAdsAuthShared(assignment),
    dualStack,
    auth,
    oauthCredentials,
    serviceAccountConfig,
  }
}

/**
 * 一次性解析用户的 Google Ads 认证上下文（assignment + 凭证）。
 * 同一事件循环内对相同 userId 的并发调用会合并为一次加载。
 */
export async function getGoogleAdsAuthContext(userId: number): Promise<GoogleAdsAuthContext> {
  const inflight = authContextInflight.get(userId)
  if (inflight) {
    return inflight
  }

  const promise = loadGoogleAdsAuthContext(userId).finally(() => {
    authContextInflight.delete(userId)
  })
  authContextInflight.set(userId, promise)
  return promise
}

export function resolveEffectiveServiceAccountId(
  linkedAccountServiceAccountId: string | null | undefined,
  ctx: Pick<GoogleAdsAuthContext, 'auth' | 'serviceAccountConfig'>
): string | undefined {
  if (ctx.auth.authType !== 'service_account') {
    return undefined
  }

  const linked =
    typeof linkedAccountServiceAccountId === 'string'
      ? linkedAccountServiceAccountId.trim()
      : ''

  return linked || ctx.auth.serviceAccountId || ctx.serviceAccountConfig?.id
}

export function hasConfiguredGoogleAdsAuthFromContext(ctx: GoogleAdsAuthContext): boolean {
  if (ctx.dualStack) {
    return false
  }

  if (ctx.assignment?.assignmentMode === 'shared_admin') {
    if (ctx.assignment.authType === 'service_account') {
      return Boolean(resolveEffectiveServiceAccountId(undefined, ctx))
    }
    return Boolean(ctx.oauthCredentials?.refresh_token)
  }

  if (ctx.auth.authType === 'oauth') {
    return Boolean(ctx.oauthCredentials?.refresh_token)
  }

  return Boolean(resolveEffectiveServiceAccountId(undefined, ctx))
}

/**
 * 凭证状态 / 管理端展示用 authType：双栈时不返回 getUserAuthType 偏好的 oauth，避免 UI 误判为已选 OAuth。
 */
export function resolveGoogleAdsDisplayAuthType(
  ctx: GoogleAdsAuthContext
): 'oauth' | 'service_account' | null {
  if (ctx.dualStack) {
    return null
  }
  return ctx.auth.authType
}

export function getServiceAccountMccFromContext(ctx: GoogleAdsAuthContext): string | undefined {
  const mcc = ctx.serviceAccountConfig?.mccCustomerId
  return mcc ? String(mcc) : undefined
}

export type GoogleAdsApiAuthValidationError =
  | 'dual_stack'
  | 'not_configured'
  | 'oauth_refresh_missing'
  | 'service_account_missing'

export function googleAdsApiAuthValidationErrorMessage(
  reason: GoogleAdsApiAuthValidationError
): string {
  switch (reason) {
    case 'dual_stack':
      return GOOGLE_ADS_DUAL_STACK_WARNING
    case 'not_configured':
      return 'Google Ads 认证未配置或已失效，请先在设置中完成 OAuth 授权或配置服务账号'
    case 'oauth_refresh_missing':
      return 'Google Ads OAuth未授权或已过期，请先在设置页面重新授权'
    case 'service_account_missing':
      return '未找到服务账号配置，请先配置服务账号'
    default:
      return 'Google Ads 认证无效'
  }
}

/**
 * 校验用户级认证并解析账号级 API 字段（共享 OAuth 不依赖 google_ads_accounts.refresh_token）。
 */
export async function resolveGoogleAdsApiAuthForAccount(
  userId: number,
  linkedAccountServiceAccountId?: string | null
): Promise<
  | { ok: true; ctx: GoogleAdsAuthContext; apiAuth: GoogleAdsApiAuthFields }
  | { ok: false; reason: GoogleAdsApiAuthValidationError }
> {
  const ctx = await getGoogleAdsAuthContext(userId)
  if (ctx.dualStack) {
    return { ok: false, reason: 'dual_stack' }
  }
  if (!hasConfiguredGoogleAdsAuthFromContext(ctx)) {
    return { ok: false, reason: 'not_configured' }
  }

  const apiAuth = await resolveGoogleAdsApiAuthFromContext(ctx, linkedAccountServiceAccountId)
  if (apiAuth.authType === 'oauth' && !apiAuth.refreshToken) {
    return { ok: false, reason: 'oauth_refresh_missing' }
  }
  if (apiAuth.authType === 'service_account' && !apiAuth.serviceAccountId) {
    return { ok: false, reason: 'service_account_missing' }
  }

  return { ok: true, ctx, apiAuth }
}

/**
 * 已配置且可用于 Keyword Planner / API 的认证；未配置时返回 null（不抛错）。
 */
export async function tryGetConfiguredGoogleAdsApiAuthForUser(
  userId: number,
  linkedAccountServiceAccountId?: string | null
): Promise<{ ctx: GoogleAdsAuthContext; apiAuth: GoogleAdsApiAuthFields } | null> {
  const resolved = await resolveGoogleAdsApiAuthForAccount(userId, linkedAccountServiceAccountId)
  if (!resolved.ok) {
    return null
  }
  return { ctx: resolved.ctx, apiAuth: resolved.apiAuth }
}

export type GoogleAdsAuthSaveTarget = 'oauth' | 'service_account'

/**
 * 保存 OAuth / 服务账号前校验互斥（与设置页「二选一」一致）。
 */
export const GOOGLE_ADS_DUAL_STACK_WARNING =
  '检测到 OAuth 与服务账号同时存在，请先在设置页删除其中一种配置后再使用。'

/** 双栈时返回统一警告文案，否则 null（供 heal/sync 等已持有 context 的路径使用）。 */
export function googleAdsAuthContextDualStackError(
  ctx: Pick<GoogleAdsAuthContext, 'dualStack'>
): string | null {
  return ctx.dualStack ? GOOGLE_ADS_DUAL_STACK_WARNING : null
}

/** 发起 Google Ads API 调用前加载 context 并拒绝双栈（统一客户端 / getCustomerWithCredentials 等）。 */
export async function assertGoogleAdsAuthReadyForApi(
  userId: number
): Promise<GoogleAdsAuthContext> {
  const ctx = await getGoogleAdsAuthContext(userId)
  const dualStackError = googleAdsAuthContextDualStackError(ctx)
  if (dualStackError) {
    throw new Error(dualStackError)
  }
  return ctx
}

export async function assertNoConflictingGoogleAdsAuth(
  userId: number,
  targetAuthType: GoogleAdsAuthSaveTarget
): Promise<void> {
  const { ownerUserId } = await resolveGoogleAdsCredentialOwnerId(userId)
  const db = await getDatabase()
  const isActiveCondition = boolCondition('is_active', true, db.type)

  if (targetAuthType === 'oauth') {
    const existingSa = await db.queryOne<{ id: string }>(
      `SELECT id FROM google_ads_service_accounts WHERE user_id = ? AND ${isActiveCondition} LIMIT 1`,
      [ownerUserId]
    )
    if (existingSa) {
      throw new Error(
        '当前已配置服务账号认证，请先在设置页删除服务账号后再配置 OAuth。'
      )
    }
    return
  }

  const credentials = await getGoogleAdsCredentialsRaw(ownerUserId)
  if (credentials?.refresh_token) {
    throw new Error(
      '当前已配置 OAuth 认证，请先在设置页删除 OAuth 后再配置服务账号。'
    )
  }
}

export async function resolveGoogleAdsApiAuthFromContext(
  ctx: GoogleAdsAuthContext,
  linkedAccountServiceAccountId?: string | null
): Promise<GoogleAdsApiAuthFields> {
  const dualStackError = googleAdsAuthContextDualStackError(ctx)
  if (dualStackError) {
    throw new Error(dualStackError)
  }

  const serviceAccountId = resolveEffectiveServiceAccountId(linkedAccountServiceAccountId, ctx)
  let serviceAccountMccId = getServiceAccountMccFromContext(ctx)

  if (serviceAccountId) {
    const contextSaId = ctx.serviceAccountConfig?.id
    if (!contextSaId || serviceAccountId !== contextSaId) {
      const linkedConfig = await getServiceAccountConfig(ctx.userId, serviceAccountId)
      serviceAccountMccId = linkedConfig?.mccCustomerId
        ? String(linkedConfig.mccCustomerId)
        : undefined
    }
  }

  return {
    authType: ctx.auth.authType,
    refreshToken: ctx.oauthCredentials?.refresh_token || '',
    serviceAccountId,
    serviceAccountMccId,
    oauthLoginCustomerId: ctx.oauthCredentials?.login_customer_id
      ? String(ctx.oauthCredentials.login_customer_id).trim()
      : undefined,
  }
}

/**
 * 解析凭证状态 API 的展示字段（共享服务账号回填 MCC / developer token）。
 */
export async function resolveGoogleAdsCredentialStatusFields(ctx: GoogleAdsAuthContext): Promise<{
  hasCredentials: boolean
  hasRefreshToken: boolean
  hasServiceAccount: boolean
  serviceAccountId: string | null
  serviceAccountName: string | null
  clientId: string | null | undefined
  developerToken: string | null | undefined
  loginCustomerId: string | null | undefined
  apiAccessLevel: string
  lastVerifiedAt: string | null | undefined
  isActive: boolean | number | undefined
  createdAt: string | undefined
  updatedAt: string | undefined
}> {
  const credentials = ctx.oauthCredentials
  const serviceAccount = ctx.serviceAccountConfig
  const hasServiceAccount = Boolean(serviceAccount)
  const hasCredentials = ctx.dualStack
    ? false
    : Boolean(credentials?.refresh_token || hasServiceAccount)

  let developerToken = credentials?.developer_token ?? null
  let loginCustomerId = credentials?.login_customer_id ?? null

  if (ctx.auth.authType === 'service_account' && serviceAccount) {
    developerToken = serviceAccount.developerToken
    loginCustomerId = serviceAccount.mccCustomerId
  }

  const storedAccessLevel = await resolveGoogleAdsApiAccessLevel(ctx.userId)

  return {
    hasCredentials,
    hasRefreshToken: Boolean(credentials?.refresh_token),
    hasServiceAccount,
    serviceAccountId: serviceAccount?.id ?? ctx.auth.serviceAccountId ?? null,
    serviceAccountName: serviceAccount?.name ?? null,
    clientId: credentials?.client_id,
    developerToken,
    loginCustomerId,
    apiAccessLevel: storedAccessLevel || 'explorer',
    lastVerifiedAt: credentials?.last_verified_at ?? null,
    isActive: credentials?.is_active,
    createdAt: credentials?.created_at,
    updatedAt: credentials?.updated_at,
  }
}
