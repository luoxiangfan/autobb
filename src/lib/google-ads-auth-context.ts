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
  resolveGoogleAdsApiAccessLevelFromContext,
  type GoogleAdsAuthAssignment,
} from './google-ads-auth-assignment'
import { boolCondition, isDbRowActive } from './db-helpers'
import { getDatabase } from './db'
import {
  getGoogleAdsCredentials,
  getGoogleAdsCredentialsRaw,
  getUserAuthType,
} from './google-ads-oauth'
import {
  GOOGLE_ADS_AUTH_CONTEXT_CACHE_TTL_MS,
  GOOGLE_ADS_AUTH_CONTEXT_PEER_RETRY_WAIT_MS,
  invalidateGoogleAdsAuthContextRedis,
  readGoogleAdsAuthContextFromRedis,
  releaseGoogleAdsAuthContextInflightLock,
  tryAcquireGoogleAdsAuthContextInflightLock,
  waitForPeerGoogleAdsAuthContext,
  writeGoogleAdsAuthContextToRedis,
} from './google-ads-auth-context-redis'
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
    authType?: 'oauth' | 'service_account'
    serviceAccountId?: string
  }
  oauthCredentials: Awaited<ReturnType<typeof getGoogleAdsCredentials>>
  serviceAccountConfig: Awaited<ReturnType<typeof getServiceAccountConfig>>
  /** 与 assignment / 凭证行一致的 API 访问级别（加载 context 时解析一次） */
  apiAccessLevel: string | null
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
    options?.oauthRefreshAlreadyLoaded !== undefined
      ? options.oauthRefreshAlreadyLoaded
      : Boolean((await getGoogleAdsCredentialsRaw(ownerUserId))?.refresh_token)

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
const authContextCache = new Map<
  number,
  { expiresAt: number; ctx: GoogleAdsAuthContext }
>()
const authContextGeneration = new Map<number, number>()

function getAuthContextGeneration(userId: number): number {
  return authContextGeneration.get(userId) ?? 0
}

function bumpAuthContextGeneration(userId: number): number {
  const next = getAuthContextGeneration(userId) + 1
  authContextGeneration.set(userId, next)
  return next
}

function isAuthContextGenerationCurrent(userId: number, generation: number): boolean {
  return getAuthContextGeneration(userId) === generation
}

/** @internal test-only */
export function resetGoogleAdsAuthContextGenerationForTests(): void {
  authContextGeneration.clear()
}

async function commitAuthContextCache(
  userId: number,
  ctx: GoogleAdsAuthContext,
  generationAtStart: number
): Promise<GoogleAdsAuthContext> {
  if (!isAuthContextGenerationCurrent(userId, generationAtStart)) {
    const freshCtx = await loadGoogleAdsAuthContext(userId)
    if (!isAuthContextGenerationCurrent(userId, generationAtStart)) {
      return freshCtx
    }
    rememberAuthContextInMemory(userId, freshCtx)
    await writeGoogleAdsAuthContextToRedis(userId, freshCtx, getAuthContextGeneration(userId))
    return freshCtx
  }

  rememberAuthContextInMemory(userId, ctx)
  await writeGoogleAdsAuthContextToRedis(userId, ctx, getAuthContextGeneration(userId))
  return ctx
}

async function resolvePeerOrAcquireAuthContextLock(
  userId: number
): Promise<{ peerCtx: GoogleAdsAuthContext | null; acquiredLock: boolean }> {
  const minGeneration = getAuthContextGeneration(userId)
  let acquiredLock = await tryAcquireGoogleAdsAuthContextInflightLock(userId)
  if (acquiredLock) {
    return { peerCtx: null, acquiredLock: true }
  }

  let peerCtx = await waitForPeerGoogleAdsAuthContext(userId, { minGeneration })
  if (peerCtx) {
    return { peerCtx, acquiredLock: false }
  }

  acquiredLock = await tryAcquireGoogleAdsAuthContextInflightLock(userId)
  if (acquiredLock) {
    return { peerCtx: null, acquiredLock: true }
  }

  peerCtx = await waitForPeerGoogleAdsAuthContext(userId, {
    minGeneration,
    maxWaitMs: GOOGLE_ADS_AUTH_CONTEXT_PEER_RETRY_WAIT_MS,
  })
  return { peerCtx, acquiredLock: false }
}

async function loadGoogleAdsAuthContext(userId: number): Promise<GoogleAdsAuthContext> {
  const resolution = await resolveGoogleAdsCredentialOwnerId(userId)
  const { ownerUserId, assignment, isShared } = resolution
  const auth = await getUserAuthType(userId, resolution)

  let oauthCredentials: Awaited<ReturnType<typeof getGoogleAdsCredentials>> = null
  let serviceAccountConfig: Awaited<ReturnType<typeof getServiceAccountConfig>> = null

  if (auth.authType === 'oauth') {
    oauthCredentials = await getGoogleAdsCredentials(userId, resolution)
  } else if (auth.authType === 'service_account') {
    serviceAccountConfig = await getServiceAccountConfig(userId, auth.serviceAccountId, resolution)
  }

  const { dualStack } = await resolveDualStackOnOwner(ownerUserId, {
    oauthRefreshAlreadyLoaded:
      auth.authType === 'oauth' && oauthCredentials?.refresh_token ? true : undefined,
  })

  // 双栈清理 UI 需同时展示 OAuth / SA 元数据；仍禁止 API 调用（dualStack 门禁不变）
  if (dualStack && !oauthCredentials) {
    oauthCredentials = await getGoogleAdsCredentials(userId, resolution)
  }
  if (dualStack && !serviceAccountConfig) {
    serviceAccountConfig = await getServiceAccountConfig(userId, undefined, resolution)
  }

  const partialCtx = {
    userId,
    ownerUserId,
    assignment,
    isShared,
    auth,
    oauthCredentials,
    serviceAccountConfig,
  }
  const apiAccessLevel = resolveGoogleAdsApiAccessLevelFromContext(partialCtx)

  return {
    ...partialCtx,
    canModify: !isGoogleAdsAuthShared(assignment),
    dualStack,
    apiAccessLevel,
  }
}

function rememberAuthContextInMemory(userId: number, ctx: GoogleAdsAuthContext): GoogleAdsAuthContext {
  authContextCache.set(userId, {
    ctx,
    expiresAt: Date.now() + GOOGLE_ADS_AUTH_CONTEXT_CACHE_TTL_MS,
  })
  return ctx
}

/**
 * 一次性解析用户的 Google Ads 认证上下文（assignment + 凭证）。
 * 进程内 + Redis 合并并发加载；多实例下仅一个实例执行 DB 读取。
 */
export async function getGoogleAdsAuthContext(userId: number): Promise<GoogleAdsAuthContext> {
  const cached = authContextCache.get(userId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.ctx
  }
  if (cached) {
    authContextCache.delete(userId)
  }

  const fromRedis = await readGoogleAdsAuthContextFromRedis(userId, {
    minGeneration: getAuthContextGeneration(userId),
  })
  if (fromRedis) {
    return rememberAuthContextInMemory(userId, fromRedis)
  }

  const inflight = authContextInflight.get(userId)
  if (inflight) {
    return inflight
  }

  const promise = (async () => {
    const generationAtStart = getAuthContextGeneration(userId)
    let acquiredLock = false
    try {
      const peerOrLock = await resolvePeerOrAcquireAuthContextLock(userId)
      acquiredLock = peerOrLock.acquiredLock
      if (peerOrLock.peerCtx) {
        if (!isAuthContextGenerationCurrent(userId, generationAtStart)) {
          const ctx = await loadGoogleAdsAuthContext(userId)
          return await commitAuthContextCache(userId, ctx, generationAtStart)
        }
        return rememberAuthContextInMemory(userId, peerOrLock.peerCtx)
      }

      const ctx = await loadGoogleAdsAuthContext(userId)
      return await commitAuthContextCache(userId, ctx, generationAtStart)
    } finally {
      authContextInflight.delete(userId)
      if (acquiredLock) {
        await releaseGoogleAdsAuthContextInflightLock(userId)
      }
    }
  })()

  authContextInflight.set(userId, promise)
  return promise
}

/** 保存/删除凭证后使短时缓存失效 */
export function invalidateGoogleAdsAuthContextCache(userId: number): void {
  bumpAuthContextGeneration(userId)
  authContextCache.delete(userId)
  authContextInflight.delete(userId)
  void invalidateGoogleAdsAuthContextRedis(userId)
}

/**
 * 解析用户的 Google Ads API 访问级别（复用 auth-context 缓存）。
 */
export async function resolveGoogleAdsApiAccessLevel(userId: number): Promise<string | null> {
  const ctx = await getGoogleAdsAuthContext(userId)
  return ctx.apiAccessLevel
}

/**
 * 凭证 owner 变更时失效 owner 及所有共享该 owner 的子用户缓存。
 */
export async function invalidateGoogleAdsAuthContextCacheForOwner(
  ownerUserId: number
): Promise<void> {
  invalidateGoogleAdsAuthContextCache(ownerUserId)

  const db = await getDatabase()
  const dependents = await db.query<{ user_id: number }>(
    `SELECT user_id FROM google_ads_auth_assignments
     WHERE shared_admin_user_id = ? AND assignment_mode = 'shared_admin'`,
    [ownerUserId]
  )
  for (const row of dependents) {
    invalidateGoogleAdsAuthContextCache(row.user_id)
  }
}

/**
 * 按凭证 userId 解析 owner 后级联失效 auth-context（OAuth save/delete、服务账号 mutations 等）。
 */
export async function invalidateGoogleAdsAuthContextForCredentialUser(
  credentialUserId: number
): Promise<void> {
  const { ownerUserId } = await resolveGoogleAdsCredentialOwnerId(credentialUserId)
  await invalidateGoogleAdsAuthContextCacheForOwner(ownerUserId)
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

type GoogleAdsAuthTypeHintContext = Pick<
  GoogleAdsAuthContext,
  'auth' | 'oauthCredentials' | 'serviceAccountConfig' | 'assignment'
>

/** 从 auth / 凭证 / assignment 推断 authType（不含 dualStack / hasConfigured 门禁） */
function resolveGoogleAdsAuthTypeFromCredentialHints(
  ctx: GoogleAdsAuthTypeHintContext,
  options?: { unconfiguredDefault?: 'oauth' | null }
): 'oauth' | 'service_account' | null {
  if (ctx.auth.authType) {
    return ctx.auth.authType
  }
  if (ctx.oauthCredentials?.refresh_token) {
    return 'oauth'
  }
  if (ctx.serviceAccountConfig) {
    return 'service_account'
  }
  if (ctx.assignment?.authType) {
    return ctx.assignment.authType
  }
  return options?.unconfiguredDefault ?? null
}

/**
 * 凭证状态 / 管理端展示用 authType：双栈时不返回 getUserAuthType 偏好的 oauth，避免 UI 误判为已选 OAuth。
 */
export function resolveConfiguredGoogleAdsAuthType(
  ctx: GoogleAdsAuthTypeHintContext
): 'oauth' | 'service_account' {
  return resolveGoogleAdsAuthTypeFromCredentialHints(ctx, { unconfiguredDefault: 'oauth' }) ?? 'oauth'
}

export function resolveGoogleAdsDisplayAuthType(
  ctx: GoogleAdsAuthContext
): 'oauth' | 'service_account' | null {
  if (ctx.dualStack) {
    return null
  }
  if (!hasConfiguredGoogleAdsAuthFromContext(ctx)) {
    return null
  }
  return resolveGoogleAdsAuthTypeFromCredentialHints(ctx, { unconfiguredDefault: null })
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

  const authType = resolveConfiguredGoogleAdsAuthType(ctx)

  return {
    authType,
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
export function resolveGoogleAdsCredentialStatusFields(ctx: GoogleAdsAuthContext): {
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
  isActive: boolean
  createdAt: string | undefined
  updatedAt: string | undefined
} {
  const credentials = ctx.oauthCredentials
  const serviceAccount = ctx.serviceAccountConfig
  const hasServiceAccount = Boolean(serviceAccount)
  const hasCredentials = ctx.dualStack
    ? false
    : Boolean(credentials?.refresh_token || hasServiceAccount)
  const isServiceAccountAuth = ctx.auth.authType === 'service_account'

  let developerToken = credentials?.developer_token ?? null
  let loginCustomerId = credentials?.login_customer_id ?? null

  if (isServiceAccountAuth && serviceAccount) {
    developerToken = serviceAccount.developerToken
    loginCustomerId = serviceAccount.mccCustomerId
  }

  return {
    hasCredentials,
    hasRefreshToken: Boolean(credentials?.refresh_token),
    hasServiceAccount,
    serviceAccountId: serviceAccount?.id ?? ctx.auth.serviceAccountId ?? null,
    serviceAccountName: serviceAccount?.name ?? null,
    clientId: credentials?.client_id,
    developerToken,
    loginCustomerId,
    apiAccessLevel: ctx.apiAccessLevel || 'explorer',
    lastVerifiedAt: isServiceAccountAuth
      ? serviceAccount?.updatedAt ?? null
      : credentials?.last_verified_at ?? null,
    isActive: isServiceAccountAuth
      ? Boolean(serviceAccount)
      : isDbRowActive(credentials?.is_active),
    createdAt: isServiceAccountAuth
      ? serviceAccount?.createdAt
      : credentials?.created_at,
    updatedAt: isServiceAccountAuth
      ? serviceAccount?.updatedAt
      : credentials?.updated_at,
  }
}
