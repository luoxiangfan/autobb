/**
 * Google Ads 认证上下文（assignment + OAuth / 服务账号凭证）。
 *
 * 产品规则：OAuth 与服务账号二选一，切换前须删除当前配置（设置页约束）；勿实现双栈或 OAuth→用户级 SA 自动回退。
 *
 * 约定：
 * - 需要调用 Google Ads API 时，优先 `getGoogleAdsAuthContext(userId)`，勿散落 `getUserAuthType` + `getGoogleAdsCredentials`。
 * - 认证未就绪（双栈 / 未配置）：优先 `resolveGoogleAdsAuthReadyFailure` → `googleAdsAuthReadyFailurePayload` / `googleAdsAuthReadyFailureHttpStatus`。
 * - `linkedAccountServiceAccountId` 仅在用户当前为服务账号认证时生效；OAuth 用户传入账号 SA 不会切换为服务账号调用。
 * - 是否已配置：用 `hasConfiguredGoogleAdsAuthFromContext`（按 userId 查请用 `google-ads-auth-assignment.hasConfiguredGoogleAdsAuth`），勿仅用 `auth.serviceAccountId` 判断。
 * - 已持有 context 且将直接调 API：须已通过 `resolveGoogleAdsAuthReadyFailure` 或 `prepareGoogleAdsApiCallForLinkedAccount`；禁止在 `dualStack` 时绕过 resolve。
 * - 按 userId 发起 API 前可用 `assertGoogleAdsAuthReadyForApi`（仅拦双栈；未配置由 prepare / resolveGoogleAdsAuthReadyFailure 负责）。
 * - 进程内与 Redis 仅缓存 strip metadata（`secretsStripped: true`）；`getGoogleAdsAuthContext` 返回前 hydrate。
 * - 仅读 metadata（如 apiAccessLevel / hasConfigured）优先 `getGoogleAdsAuthContextMetadata`，勿对 strip context 调 `resolve*FromContext`。
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
  getGoogleAdsCredentialsMetadata,
  getGoogleAdsCredentialsRaw,
  getUserAuthType,
  googleAdsCredentialsFromMetadata,
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
import {
  getServiceAccountConfig,
  getServiceAccountConfigMetadata,
} from './google-ads-service-account'
import {
  clearHydratedSecretsCacheForTests,
  hydrateGoogleAdsAuthContextSecrets,
  invalidateHydratedSecretsCache,
  oauthRefreshConfiguredFromContext,
  seedHydratedSecretsCacheFromFullContext,
  serviceAccountConfiguredFromContext,
  stripGoogleAdsAuthContextForCache,
  assertAuthContextSecretsHydrated,
} from './google-ads-auth-context-cache'

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
  /** load 时写入；strip 缓存保留，供 hasConfigured 等无需 hydrate 的判断 */
  oauthHasRefreshToken?: boolean
  serviceAccountConfigured?: boolean
  /** slim 缓存条目为 true；API 路径使用前须 hydrate */
  secretsStripped?: boolean
}

async function resolveDualStackOnOwner(
  ownerUserId: number,
  options?: {
    oauthRefreshAlreadyLoaded?: boolean
    /** 已确认 owner 有活跃 SA 时可传入，避免重复查库 */
    hasActiveServiceAccount?: boolean
  }
): Promise<{
  hasOAuthRefresh: boolean
  hasActiveServiceAccount: boolean
  dualStack: boolean
}> {
  const hasOAuthRefresh =
    options?.oauthRefreshAlreadyLoaded !== undefined
      ? options.oauthRefreshAlreadyLoaded
      : Boolean((await getGoogleAdsCredentialsRaw(ownerUserId))?.refresh_token)

  let hasActiveServiceAccount: boolean
  if (options?.hasActiveServiceAccount !== undefined) {
    hasActiveServiceAccount = options.hasActiveServiceAccount
  } else {
    const db = await getDatabase()
    const isActiveCondition = boolCondition('is_active', true, db.type)
    const existingSa = await db.queryOne<{ id: string }>(
      `SELECT id FROM google_ads_service_accounts WHERE user_id = ? AND ${isActiveCondition} LIMIT 1`,
      [ownerUserId]
    )
    hasActiveServiceAccount = Boolean(existingSa)
  }

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
const authContextCache = new Map<number, { expiresAt: number; ctx: GoogleAdsAuthContext }>()
const authContextGeneration = new Map<number, number>()

function getAuthContextGeneration(userId: number): number {
  return authContextGeneration.get(userId) ?? 0
}

/** prepare / hydrate 短缓存 generation 绑定（与 invalidate bump 一致） */
export function getGoogleAdsAuthContextGenerationForHydrate(userId: number): number {
  return getAuthContextGeneration(userId)
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

/** @internal test-only: 进程内缓存中的 strip 条目（不含 hydrate） */
export function peekMemoryAuthContextCacheForTests(userId: number): GoogleAdsAuthContext | null {
  return authContextCache.get(userId)?.ctx ?? null
}

/** @internal test-only */
export function clearMemoryAuthContextCacheForTests(): void {
  authContextCache.clear()
  clearHydratedSecretsCacheForTests()
}

/** @internal test-only: 写入 slim 进程内缓存（测 resolve* / metadata slim-first 路径） */
export function seedMemoryAuthContextCacheForTests(
  userId: number,
  ctx: GoogleAdsAuthContext
): void {
  rememberAuthContextInMemory(userId, ctx)
}

async function commitAuthContextCache(
  userId: number,
  ctx: GoogleAdsAuthContext,
  generationAtStart: number
): Promise<GoogleAdsAuthContext> {
  let ctxToCommit = ctx
  if (!isAuthContextGenerationCurrent(userId, generationAtStart)) {
    ctxToCommit = await loadGoogleAdsAuthContext(userId)
  }
  if (!isAuthContextGenerationCurrent(userId, generationAtStart)) {
    return ctxToCommit
  }

  const generation = getAuthContextGeneration(userId)
  rememberAuthContextInMemory(userId, ctxToCommit)
  seedHydratedSecretsCacheFromFullContext(userId, generation, ctxToCommit)
  await writeGoogleAdsAuthContextToRedis(userId, ctxToCommit, generation)
  return ctxToCommit
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
    hasActiveServiceAccount:
      auth.authType === 'service_account'
        ? Boolean(auth.serviceAccountId || serviceAccountConfig?.id)
        : undefined,
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
  const oauthHasRefreshToken = Boolean(oauthCredentials?.refresh_token)
  const serviceAccountConfigured = Boolean(serviceAccountConfig?.id || auth.serviceAccountId)

  return {
    ...partialCtx,
    canModify: !isGoogleAdsAuthShared(assignment),
    dualStack,
    apiAccessLevel,
    oauthHasRefreshToken,
    serviceAccountConfigured,
    secretsStripped: false,
  }
}

/** 只加载 metadata（不 decrypt OAuth/SA 密钥）；供 getGoogleAdsAuthContextMetadata miss 路径 */
async function loadGoogleAdsAuthContextMetadataOnly(userId: number): Promise<GoogleAdsAuthContext> {
  const resolution = await resolveGoogleAdsCredentialOwnerId(userId)
  const { ownerUserId, assignment, isShared } = resolution
  const auth = await getUserAuthType(userId, resolution)

  let oauthCredentials: GoogleAdsAuthContext['oauthCredentials'] = null
  let oauthHasRefreshToken = false
  let serviceAccountConfig: GoogleAdsAuthContext['serviceAccountConfig'] = null

  const loadOAuthMetadata = async () => {
    const oauthMeta = await getGoogleAdsCredentialsMetadata(userId, resolution)
    oauthHasRefreshToken = Boolean(oauthMeta?.hasRefreshToken)
    oauthCredentials = oauthMeta ? googleAdsCredentialsFromMetadata(oauthMeta) : null
  }

  if (auth.authType === 'oauth') {
    await loadOAuthMetadata()
  } else if (auth.authType === 'service_account') {
    serviceAccountConfig = await getServiceAccountConfigMetadata(
      userId,
      auth.serviceAccountId,
      resolution
    )
  }

  const { dualStack } = await resolveDualStackOnOwner(ownerUserId, {
    oauthRefreshAlreadyLoaded: auth.authType === 'oauth' ? oauthHasRefreshToken : undefined,
    hasActiveServiceAccount:
      auth.authType === 'service_account'
        ? Boolean(auth.serviceAccountId || serviceAccountConfig?.id)
        : undefined,
  })

  if (dualStack && !oauthCredentials) {
    await loadOAuthMetadata()
  }
  if (dualStack && !serviceAccountConfig) {
    serviceAccountConfig = await getServiceAccountConfigMetadata(userId, undefined, resolution)
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
  const serviceAccountConfigured = Boolean(serviceAccountConfig?.id || auth.serviceAccountId)

  return stripGoogleAdsAuthContextForCache({
    ...partialCtx,
    canModify: !isGoogleAdsAuthShared(assignment),
    dualStack,
    apiAccessLevel,
    oauthHasRefreshToken,
    serviceAccountConfigured,
    secretsStripped: false,
  })
}

function rememberAuthContextInMemory(userId: number, ctx: GoogleAdsAuthContext): void {
  authContextCache.set(userId, {
    ctx: stripGoogleAdsAuthContextForCache(ctx),
    expiresAt: Date.now() + GOOGLE_ADS_AUTH_CONTEXT_CACHE_TTL_MS,
  })
}

function hydrateAuthContextSecrets(ctx: GoogleAdsAuthContext): Promise<GoogleAdsAuthContext> {
  return hydrateGoogleAdsAuthContextSecrets(ctx, getAuthContextGeneration)
}

async function readSlimAuthContextFromCaches(userId: number): Promise<GoogleAdsAuthContext | null> {
  const cached = authContextCache.get(userId)
  if (cached) {
    if (cached.expiresAt <= Date.now()) {
      authContextCache.delete(userId)
    } else {
      return cached.ctx
    }
  }

  const fromRedis = await readGoogleAdsAuthContextFromRedis(userId, {
    minGeneration: getAuthContextGeneration(userId),
  })
  if (fromRedis) {
    rememberAuthContextInMemory(userId, fromRedis)
    return fromRedis
  }

  return null
}

async function readAuthContextFromMemoryCache(
  userId: number
): Promise<GoogleAdsAuthContext | null> {
  const slim = await readSlimAuthContextFromCaches(userId)
  if (!slim) {
    return null
  }
  return hydrateAuthContextSecrets(slim)
}

/**
 * 只读 metadata（不 hydrate 密钥）。缓存未命中时走 metadata-only load，不解密 OAuth/SA 密钥。
 */
export async function getGoogleAdsAuthContextMetadata(
  userId: number
): Promise<GoogleAdsAuthContext> {
  const slim = await readSlimAuthContextFromCaches(userId)
  if (slim) {
    return slim
  }

  const ctx = await loadGoogleAdsAuthContextMetadataOnly(userId)
  rememberAuthContextInMemory(userId, ctx)
  return ctx
}

/**
 * 一次性解析用户的 Google Ads 认证上下文（assignment + 凭证）。
 * 进程内与 Redis 均只缓存 strip 后的 metadata；命中后 hydrate 密钥。
 */
export async function getGoogleAdsAuthContext(userId: number): Promise<GoogleAdsAuthContext> {
  const fromCache = await readAuthContextFromMemoryCache(userId)
  if (fromCache) {
    return fromCache
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
        rememberAuthContextInMemory(userId, peerOrLock.peerCtx)
        return hydrateAuthContextSecrets(peerOrLock.peerCtx)
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
  invalidateHydratedSecretsCache(userId)
  void invalidateGoogleAdsAuthContextRedis(userId)
}

/**
 * 解析用户的 Google Ads API 访问级别（优先 slim metadata，避免 hydrate）。
 */
export async function resolveGoogleAdsApiAccessLevel(userId: number): Promise<string | null> {
  const slim = await readSlimAuthContextFromCaches(userId)
  if (slim) {
    return slim.apiAccessLevel ?? null
  }
  const ctx = await getGoogleAdsAuthContextMetadata(userId)
  return ctx.apiAccessLevel ?? null
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

/** 按凭证 userId 解析 owner 后级联失效 GAds API 内存缓存（含共享子用户）。 */
export async function invalidateGadsApiCacheForCredentialUser(
  credentialUserId: number
): Promise<void> {
  const { invalidateGadsApiCacheForUser } = await import('./cache')
  const { ownerUserId } = await resolveGoogleAdsCredentialOwnerId(credentialUserId)
  invalidateGadsApiCacheForUser(ownerUserId)

  const db = await getDatabase()
  const dependents = await db.query<{ user_id: number }>(
    `SELECT user_id FROM google_ads_auth_assignments
     WHERE shared_admin_user_id = ? AND assignment_mode = 'shared_admin'`,
    [ownerUserId]
  )
  for (const row of dependents) {
    invalidateGadsApiCacheForUser(row.user_id)
  }
}

export function resolveEffectiveServiceAccountId(
  linkedAccountServiceAccountId: string | null | undefined,
  ctx: Pick<GoogleAdsAuthContext, 'auth' | 'serviceAccountConfig'>
): string | undefined {
  if (ctx.auth.authType !== 'service_account') {
    return undefined
  }

  const linked =
    typeof linkedAccountServiceAccountId === 'string' ? linkedAccountServiceAccountId.trim() : ''

  return linked || ctx.auth.serviceAccountId || ctx.serviceAccountConfig?.id
}

export function hasConfiguredGoogleAdsAuthFromContext(ctx: GoogleAdsAuthContext): boolean {
  if (ctx.dualStack) {
    return false
  }

  if (ctx.assignment?.assignmentMode === 'shared_admin') {
    if (ctx.assignment.authType === 'service_account') {
      return (
        serviceAccountConfiguredFromContext(ctx) &&
        Boolean(resolveEffectiveServiceAccountId(undefined, ctx))
      )
    }
    return oauthRefreshConfiguredFromContext(ctx)
  }

  if (ctx.auth.authType === 'oauth') {
    return oauthRefreshConfiguredFromContext(ctx)
  }

  return (
    serviceAccountConfiguredFromContext(ctx) &&
    Boolean(resolveEffectiveServiceAccountId(undefined, ctx))
  )
}

type GoogleAdsAuthTypeHintContext = Pick<
  GoogleAdsAuthContext,
  'auth' | 'oauthCredentials' | 'serviceAccountConfig' | 'assignment' | 'oauthHasRefreshToken'
>

/** 从 auth / 凭证 / assignment 推断 authType（不含 dualStack / hasConfigured 门禁） */
function resolveGoogleAdsAuthTypeFromCredentialHints(
  ctx: GoogleAdsAuthTypeHintContext,
  options?: { unconfiguredDefault?: 'oauth' | null }
): 'oauth' | 'service_account' | null {
  if (ctx.auth.authType) {
    return ctx.auth.authType
  }
  if (oauthRefreshConfiguredFromContext(ctx)) {
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
  return (
    resolveGoogleAdsAuthTypeFromCredentialHints(ctx, { unconfiguredDefault: 'oauth' }) ?? 'oauth'
  )
}

/**
 * 显式 authType 与 auth-context 不一致时抛错（与 accounts 路由 AUTH_TYPE_MISMATCH 语义一致）。
 */
export function assertGoogleAdsAuthTypeMatchesContext(
  requested: 'oauth' | 'service_account',
  ctx: Pick<GoogleAdsAuthContext, 'auth'>
): void {
  const configured = ctx.auth.authType
  if (!configured || configured === requested) {
    return
  }
  throw new Error(
    configured === 'service_account'
      ? '当前已配置服务账号认证，请使用 auth_type=service_account，或在设置页删除服务账号后再使用 OAuth。'
      : '当前已配置 OAuth 认证，请使用 auth_type=oauth，或在设置页删除 OAuth 后再使用服务账号。'
  )
}

/**
 * 解析 API 调用的 authType（禁止 `|| 'oauth'` 默认）。
 * 调用方应优先传入 prepare 后的 `apiAuth.authType`；未传时从 context 推断。
 */
export function resolveGoogleAdsApiAuthType(
  params: { authType?: 'oauth' | 'service_account' },
  ctx: GoogleAdsAuthContext
): 'oauth' | 'service_account' {
  if (params.authType === 'oauth' || params.authType === 'service_account') {
    assertGoogleAdsAuthTypeMatchesContext(params.authType, ctx)
    return params.authType
  }
  if (ctx.auth.authType === 'service_account') {
    return 'service_account'
  }
  if (ctx.auth.authType === 'oauth') {
    return 'oauth'
  }
  const fromHints = resolveGoogleAdsAuthTypeFromCredentialHints(ctx, { unconfiguredDefault: null })
  if (fromHints) {
    return fromHints
  }
  throw new Error(
    '无法推断 Google Ads 认证方式：请先通过 prepareGoogleAdsApiCallForLinkedAccount 解析 apiAuth，并传入 authType'
  )
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

function getServiceAccountMccFromContext(ctx: GoogleAdsAuthContext): string | undefined {
  const mcc = ctx.serviceAccountConfig?.mccCustomerId
  return mcc ? String(mcc) : undefined
}

export type GoogleAdsApiAuthValidationError =
  | 'dual_stack'
  | 'not_configured'
  | 'oauth_refresh_missing'
  | 'service_account_missing'

/**
 * `hasConfiguredGoogleAdsAuthFromContext` 为 false 时的用户可读原因（双栈优先于未配置）。
 */
export function googleAdsAuthNotReadyMessage(ctx: Pick<GoogleAdsAuthContext, 'dualStack'>): string {
  const dualStackError = googleAdsAuthContextDualStackError(ctx)
  if (dualStackError) {
    return dualStackError
  }
  return googleAdsApiAuthValidationErrorMessage('not_configured')
}

export type GoogleAdsAuthReadyFailureReason = 'dual_stack' | 'not_configured'

/** 认证不可用于 API 时返回原因与文案；已配置则 null。 */
export function resolveGoogleAdsAuthReadyFailure(
  ctx: GoogleAdsAuthContext
): { reason: GoogleAdsAuthReadyFailureReason; message: string } | null {
  if (hasConfiguredGoogleAdsAuthFromContext(ctx)) {
    return null
  }
  return {
    reason: ctx.dualStack ? 'dual_stack' : 'not_configured',
    message: googleAdsAuthNotReadyMessage(ctx),
  }
}

/** API 路由：认证未就绪时的标准 error body（含双栈 authConfigWarning）。 */
export function googleAdsAuthReadyFailurePayload(failure: {
  reason: GoogleAdsAuthReadyFailureReason
  message: string
}): {
  error: string
  code: string
  message: string
  authConfigWarning?: string
} {
  const isDualStack = failure.reason === 'dual_stack'
  return {
    error: failure.message,
    code: isDualStack ? 'DUAL_STACK_CONFLICT' : 'CREDENTIALS_NOT_CONFIGURED',
    message: failure.message,
    ...(isDualStack ? { authConfigWarning: failure.message } : {}),
  }
}

export function googleAdsAuthReadyFailureHttpStatus(
  reason: GoogleAdsAuthReadyFailureReason
): number {
  return reason === 'dual_stack' ? 409 : 404
}

/** 后台同步 / 定时任务：metadata 路径检查凭证是否可用于同步（不 hydrate 密钥）。 */
export async function resolveGoogleAdsSyncCredentialGate(
  userId: number
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const ctx = await getGoogleAdsAuthContextMetadata(userId)
  const authFailure = resolveGoogleAdsAuthReadyFailure(ctx)
  if (authFailure) {
    return { ok: false, reason: authFailure.message }
  }
  return { ok: true }
}

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
  const authFailure = resolveGoogleAdsAuthReadyFailure(ctx)
  if (authFailure) {
    return { ok: false, reason: authFailure.reason }
  }

  const apiAuth = await resolveGoogleAdsApiAuthFromContext(ctx, linkedAccountServiceAccountId, {
    skipReadyGate: true,
  })
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
      throw new Error('当前已配置服务账号认证，请先在设置页删除服务账号后再配置 OAuth。')
    }
    return
  }

  const credentials = await getGoogleAdsCredentialsRaw(ownerUserId)
  if (credentials?.refresh_token) {
    throw new Error('当前已配置 OAuth 认证，请先在设置页删除 OAuth 后再配置服务账号。')
  }
}

export async function resolveGoogleAdsApiAuthFromContext(
  ctx: GoogleAdsAuthContext,
  linkedAccountServiceAccountId?: string | null,
  options?: { skipReadyGate?: boolean }
): Promise<GoogleAdsApiAuthFields> {
  assertAuthContextSecretsHydrated(ctx)
  if (!options?.skipReadyGate) {
    const authFailure = resolveGoogleAdsAuthReadyFailure(ctx)
    if (authFailure) {
      throw new Error(authFailure.message)
    }
  }

  const serviceAccountId = resolveEffectiveServiceAccountId(linkedAccountServiceAccountId, ctx)
  let serviceAccountMccId = getServiceAccountMccFromContext(ctx)

  if (serviceAccountId) {
    const contextSaId = ctx.serviceAccountConfig?.id
    if (!contextSaId || serviceAccountId !== contextSaId) {
      const ownerResolution = {
        ownerUserId: ctx.ownerUserId,
        assignment: ctx.assignment,
        isShared: ctx.isShared,
      }
      const linkedConfig = await getServiceAccountConfig(
        ctx.userId,
        serviceAccountId,
        ownerResolution
      )
      serviceAccountMccId = linkedConfig?.mccCustomerId
        ? String(linkedConfig.mccCustomerId)
        : undefined
    }
  }

  const authType = resolveGoogleAdsApiAuthType({}, ctx)

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
  assertAuthContextSecretsHydrated(ctx)
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
      ? (serviceAccount?.updatedAt ?? null)
      : (credentials?.last_verified_at ?? null),
    isActive: isServiceAccountAuth
      ? Boolean(serviceAccount)
      : isDbRowActive(credentials?.is_active),
    createdAt: isServiceAccountAuth ? serviceAccount?.createdAt : credentials?.created_at,
    updatedAt: isServiceAccountAuth ? serviceAccount?.updatedAt : credentials?.updated_at,
  }
}

/** 未配置 / 双栈：无需 hydrate 密钥的凭证摘要（供 GET /credentials metadata 路径） */
export function resolveGoogleAdsCredentialStatusSummary(ctx: GoogleAdsAuthContext): {
  hasCredentials: boolean
  hasRefreshToken: boolean
  hasServiceAccount: boolean
  serviceAccountId: string | null
  serviceAccountName: string | null
} {
  const hasServiceAccount = serviceAccountConfiguredFromContext(ctx)
  return {
    hasCredentials: hasConfiguredGoogleAdsAuthFromContext(ctx),
    hasRefreshToken: oauthRefreshConfiguredFromContext(ctx),
    hasServiceAccount,
    serviceAccountId: ctx.serviceAccountConfig?.id ?? ctx.auth.serviceAccountId ?? null,
    serviceAccountName: ctx.serviceAccountConfig?.name ?? null,
  }
}
