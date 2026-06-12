import type { GoogleAdsCredentials } from '@/lib/google-ads/oauth/oauth'
import { getGoogleAdsCredentials } from '@/lib/google-ads/oauth/oauth'
import { getServiceAccountConfig } from '@/lib/google-ads/service-account/service-account'
import type { GoogleAdsAuthContext } from '@/lib/google-ads/auth/context'

type HydratedSecretsSlice = Pick<GoogleAdsAuthContext, 'oauthCredentials' | 'serviceAccountConfig'>

const hydratedSecretsByUser = new Map<
  number,
  { generation: number; secrets: HydratedSecretsSlice }
>()

/** @internal test-only */
export function clearHydratedSecretsCacheForTests(): void {
  hydratedSecretsByUser.clear()
}

export function invalidateHydratedSecretsCache(userId: number): void {
  hydratedSecretsByUser.delete(userId)
}

function rememberHydratedSecrets(
  userId: number,
  generation: number,
  secrets: HydratedSecretsSlice
): void {
  hydratedSecretsByUser.set(userId, { generation, secrets })
}

function readHydratedSecrets(userId: number, generation: number): HydratedSecretsSlice | null {
  const hit = hydratedSecretsByUser.get(userId)
  if (!hit || hit.generation !== generation) {
    return null
  }
  return hit.secrets
}

/** slim 缓存条目为 true；API / resolve 路径使用前须 hydrate */
function authContextSecretsLookStripped(
  ctx: Pick<GoogleAdsAuthContext, 'secretsStripped'>
): boolean {
  return ctx.secretsStripped === true
}

/** 未 hydrate 的 strip context 传入 resolve / API 路径时抛错 */
export function assertAuthContextSecretsHydrated(
  ctx: Pick<GoogleAdsAuthContext, 'secretsStripped' | 'userId'>
): void {
  if (authContextSecretsLookStripped(ctx)) {
    throw new Error(
      `Google Ads auth context (userId=${ctx.userId}) secrets not hydrated; call getGoogleAdsAuthContext() first`
    )
  }
}

export function oauthCredentialsLookStripped(
  credentials: GoogleAdsCredentials | null | undefined
): boolean {
  if (!credentials) return false
  const hasIdentity = Boolean(credentials.client_id || credentials.login_customer_id)
  if (!hasIdentity) return false
  return (
    (credentials.refresh_token == null || credentials.refresh_token === '') &&
    (credentials.client_secret == null || credentials.client_secret === '') &&
    (credentials.developer_token == null || credentials.developer_token === '')
  )
}

function serviceAccountConfigLooksStripped(
  config: GoogleAdsAuthContext['serviceAccountConfig']
): boolean {
  if (!config?.id) return false
  return config.privateKey == null && config.developerToken == null
}

function computeOAuthHasRefreshToken(ctx: GoogleAdsAuthContext): boolean {
  if (ctx.oauthHasRefreshToken !== undefined) {
    return ctx.oauthHasRefreshToken
  }
  return Boolean(ctx.oauthCredentials?.refresh_token)
}

function computeServiceAccountConfigured(
  ctx: Pick<GoogleAdsAuthContext, 'serviceAccountConfigured' | 'serviceAccountConfig' | 'auth'>
): boolean {
  if (ctx.serviceAccountConfigured !== undefined) {
    return ctx.serviceAccountConfigured
  }
  return Boolean(ctx.serviceAccountConfig?.id || ctx.auth.serviceAccountId)
}

/** 是否已配置 OAuth refresh（strip metadata 或 hydrate 后均可） */
export function oauthRefreshConfiguredFromContext(
  ctx: Pick<GoogleAdsAuthContext, 'oauthHasRefreshToken' | 'oauthCredentials'>
): boolean {
  return computeOAuthHasRefreshToken(ctx as GoogleAdsAuthContext)
}

function oauthFieldHasValue(value: string | null | undefined): boolean {
  return Boolean(String(value ?? '').trim())
}

/** 凭证表是否存在 OAuth 配置字段（含 refresh 或半成品 client_id 等；metadata 路径可用） */
export function oauthCredentialFieldsPresentFromContext(
  ctx: Pick<GoogleAdsAuthContext, 'oauthHasRefreshToken' | 'oauthCredentials'>
): boolean {
  if (oauthRefreshConfiguredFromContext(ctx)) {
    return true
  }
  const credentials = ctx.oauthCredentials
  if (!credentials) {
    return false
  }
  return (
    oauthFieldHasValue(credentials.client_id) ||
    oauthFieldHasValue(credentials.client_secret) ||
    oauthFieldHasValue(credentials.developer_token) ||
    oauthFieldHasValue(credentials.login_customer_id)
  )
}

/** 是否已配置服务账号（strip metadata 或 hydrate 后均可） */
export function serviceAccountConfiguredFromContext(
  ctx: Pick<GoogleAdsAuthContext, 'serviceAccountConfigured' | 'serviceAccountConfig' | 'auth'>
): boolean {
  return computeServiceAccountConfigured(ctx)
}

function stripOAuthCredentialsForCache(credentials: GoogleAdsCredentials): GoogleAdsCredentials {
  return {
    ...credentials,
    client_secret: null as unknown as string,
    refresh_token: null as unknown as string,
    access_token: undefined,
    developer_token: null as unknown as string,
  }
}

/**
 * 写入 Redis / 进程内缓存前移除密钥（metadata 标志保留以便无 hydrate 判断）。
 */
export function stripGoogleAdsAuthContextForCache(ctx: GoogleAdsAuthContext): GoogleAdsAuthContext {
  return {
    ...ctx,
    secretsStripped: true,
    oauthHasRefreshToken: computeOAuthHasRefreshToken(ctx),
    serviceAccountConfigured: computeServiceAccountConfigured(ctx),
    oauthCredentials: ctx.oauthCredentials
      ? stripOAuthCredentialsForCache(ctx.oauthCredentials)
      : null,
    serviceAccountConfig: ctx.serviceAccountConfig
      ? {
          ...ctx.serviceAccountConfig,
          privateKey: null as unknown as string,
          developerToken: null as unknown as string,
        }
      : null,
  }
}

/** 旧版 Redis payload 或误写入的明文条目：读后立即 strip */
export function normalizeCachedAuthContextPayload(ctx: GoogleAdsAuthContext): GoogleAdsAuthContext {
  if (authContextSecretsLookStripped(ctx)) {
    return ctx
  }
  const hasOAuthSecrets = Boolean(
    ctx.oauthCredentials?.refresh_token ||
    ctx.oauthCredentials?.client_secret ||
    ctx.oauthCredentials?.developer_token
  )
  const hasSaSecrets = Boolean(
    ctx.serviceAccountConfig?.privateKey || ctx.serviceAccountConfig?.developerToken
  )
  if (!hasOAuthSecrets && !hasSaSecrets) {
    return { ...ctx, secretsStripped: false }
  }
  return stripGoogleAdsAuthContextForCache({ ...ctx, secretsStripped: false })
}

function credentialOwnerResolution(ctx: GoogleAdsAuthContext) {
  return {
    ownerUserId: ctx.ownerUserId,
    assignment: ctx.assignment,
    isShared: ctx.isShared,
  }
}

/** strip 后的 context 或密钥字段缺失时需从 DB 补全 */
export function googleAdsAuthContextNeedsSecretHydration(ctx: GoogleAdsAuthContext): boolean {
  if (!authContextSecretsLookStripped(ctx)) {
    return false
  }
  const needsOAuth =
    ctx.dualStack ||
    ctx.auth.authType === 'oauth' ||
    oauthCredentialsLookStripped(ctx.oauthCredentials) ||
    computeOAuthHasRefreshToken(ctx)
  const needsServiceAccount =
    ctx.dualStack ||
    ctx.auth.authType === 'service_account' ||
    serviceAccountConfigLooksStripped(ctx.serviceAccountConfig) ||
    computeServiceAccountConfigured(ctx)

  if (needsOAuth && (!ctx.oauthCredentials || oauthCredentialsLookStripped(ctx.oauthCredentials))) {
    return true
  }
  if (
    needsServiceAccount &&
    (!ctx.serviceAccountConfig || serviceAccountConfigLooksStripped(ctx.serviceAccountConfig))
  ) {
    return true
  }
  return false
}

function mergeHydratedSecrets(
  ctx: GoogleAdsAuthContext,
  secrets: HydratedSecretsSlice
): GoogleAdsAuthContext {
  return {
    ...ctx,
    secretsStripped: false,
    oauthHasRefreshToken: Boolean(secrets.oauthCredentials?.refresh_token),
    serviceAccountConfigured: Boolean(
      secrets.serviceAccountConfig?.id || ctx.auth.serviceAccountId
    ),
    oauthCredentials: secrets.oauthCredentials,
    serviceAccountConfig: secrets.serviceAccountConfig,
  }
}

/**
 * 从 strip 后的 context（Redis / 进程内缓存）按 auth 形态从 DB 补全密钥。
 * `getGeneration` 用于 generation 绑定的进程内 secrets 短缓存（invalidate 时 bump generation 失效）。
 */
export async function hydrateGoogleAdsAuthContextSecrets(
  ctx: GoogleAdsAuthContext,
  getGeneration?: (userId: number) => number
): Promise<GoogleAdsAuthContext> {
  if (!googleAdsAuthContextNeedsSecretHydration(ctx)) {
    return ctx.secretsStripped ? { ...ctx, secretsStripped: false } : ctx
  }

  const generation = getGeneration?.(ctx.userId)
  if (generation !== undefined) {
    const cachedSecrets = readHydratedSecrets(ctx.userId, generation)
    if (cachedSecrets) {
      return mergeHydratedSecrets(ctx, cachedSecrets)
    }
  }

  const resolution = credentialOwnerResolution(ctx)
  const needsOAuth =
    ctx.dualStack ||
    ctx.auth.authType === 'oauth' ||
    oauthCredentialsLookStripped(ctx.oauthCredentials) ||
    computeOAuthHasRefreshToken(ctx)
  const needsServiceAccount =
    ctx.dualStack ||
    ctx.auth.authType === 'service_account' ||
    serviceAccountConfigLooksStripped(ctx.serviceAccountConfig) ||
    computeServiceAccountConfigured(ctx)

  const loadOAuth = needsOAuth
    ? getGoogleAdsCredentials(ctx.userId, resolution)
    : Promise.resolve(ctx.oauthCredentials)
  const loadServiceAccount = needsServiceAccount
    ? getServiceAccountConfig(
        ctx.userId,
        ctx.auth.serviceAccountId ?? ctx.serviceAccountConfig?.id,
        resolution
      ).then(async (config) => {
        if (ctx.dualStack && !config) {
          return getServiceAccountConfig(ctx.userId, undefined, resolution)
        }
        return config
      })
    : Promise.resolve(ctx.serviceAccountConfig)

  const [oauthCredentials, serviceAccountConfig] = await Promise.all([
    loadOAuth,
    loadServiceAccount,
  ])

  const secrets: HydratedSecretsSlice = { oauthCredentials, serviceAccountConfig }
  if (generation !== undefined) {
    rememberHydratedSecrets(ctx.userId, generation, secrets)
  }

  if (
    oauthCredentials === ctx.oauthCredentials &&
    serviceAccountConfig === ctx.serviceAccountConfig
  ) {
    return { ...ctx, secretsStripped: false }
  }

  return mergeHydratedSecrets(ctx, secrets)
}

/** load / commit 后种子化 secrets 短缓存，避免紧接的 hydrate 重复查库 */
export function seedHydratedSecretsCacheFromFullContext(
  userId: number,
  generation: number,
  ctx: GoogleAdsAuthContext
): void {
  rememberHydratedSecrets(userId, generation, {
    oauthCredentials: ctx.oauthCredentials,
    serviceAccountConfig: ctx.serviceAccountConfig,
  })
}
