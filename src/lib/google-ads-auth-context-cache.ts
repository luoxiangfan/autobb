import type { GoogleAdsCredentials } from './google-ads-oauth'
import { getGoogleAdsCredentials } from './google-ads-oauth'
import { getServiceAccountConfig } from './google-ads-service-account'
import type { GoogleAdsAuthContext } from './google-ads-auth-context'

const STRIPPED = ''

/** OAuth / SA 密钥字段占位；Redis 与进程内缓存均只存 strip 后的 context */
export function oauthCredentialsLookStripped(
  credentials: GoogleAdsCredentials | null | undefined
): boolean {
  if (!credentials) return false
  const hasIdentity = Boolean(credentials.client_id || credentials.login_customer_id)
  if (!hasIdentity) return false
  return !credentials.refresh_token && !credentials.client_secret && !credentials.developer_token
}

export function serviceAccountConfigLooksStripped(
  config: GoogleAdsAuthContext['serviceAccountConfig']
): boolean {
  if (!config?.id) return false
  return !config.privateKey && !config.developerToken
}

/**
 * 写入 Redis / 进程内缓存前移除密钥（metadata 保留以便 hydrate 判断 auth 形态）。
 */
export function stripGoogleAdsAuthContextForCache(ctx: GoogleAdsAuthContext): GoogleAdsAuthContext {
  return {
    ...ctx,
    oauthCredentials: ctx.oauthCredentials
      ? {
          ...ctx.oauthCredentials,
          client_secret: STRIPPED,
          refresh_token: STRIPPED,
          access_token: undefined,
          developer_token: STRIPPED,
        }
      : null,
    serviceAccountConfig: ctx.serviceAccountConfig
      ? {
          ...ctx.serviceAccountConfig,
          privateKey: STRIPPED,
          developerToken: STRIPPED,
        }
      : null,
  }
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
  const needsOAuth =
    ctx.dualStack ||
    ctx.auth.authType === 'oauth' ||
    oauthCredentialsLookStripped(ctx.oauthCredentials)
  const needsServiceAccount =
    ctx.dualStack ||
    ctx.auth.authType === 'service_account' ||
    serviceAccountConfigLooksStripped(ctx.serviceAccountConfig)

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

/**
 * 从 strip 后的 context（Redis / 进程内缓存）按 auth 形态从 DB 补全密钥。
 */
export async function hydrateGoogleAdsAuthContextSecrets(
  ctx: GoogleAdsAuthContext
): Promise<GoogleAdsAuthContext> {
  if (!googleAdsAuthContextNeedsSecretHydration(ctx)) {
    return ctx
  }

  const resolution = credentialOwnerResolution(ctx)
  const needsOAuth =
    ctx.dualStack ||
    ctx.auth.authType === 'oauth' ||
    oauthCredentialsLookStripped(ctx.oauthCredentials)
  const needsServiceAccount =
    ctx.dualStack ||
    ctx.auth.authType === 'service_account' ||
    serviceAccountConfigLooksStripped(ctx.serviceAccountConfig)

  let oauthCredentials = ctx.oauthCredentials
  let serviceAccountConfig = ctx.serviceAccountConfig

  if (needsOAuth) {
    oauthCredentials = await getGoogleAdsCredentials(ctx.userId, resolution)
  }
  if (needsServiceAccount) {
    serviceAccountConfig = await getServiceAccountConfig(
      ctx.userId,
      ctx.auth.serviceAccountId ?? ctx.serviceAccountConfig?.id,
      resolution
    )
    if (ctx.dualStack && !serviceAccountConfig) {
      serviceAccountConfig = await getServiceAccountConfig(ctx.userId, undefined, resolution)
    }
  }

  if (oauthCredentials === ctx.oauthCredentials && serviceAccountConfig === ctx.serviceAccountConfig) {
    return ctx
  }

  return {
    ...ctx,
    oauthCredentials,
    serviceAccountConfig,
  }
}
