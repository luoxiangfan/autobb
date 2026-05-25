/**
 * Google Ads 认证上下文（assignment + OAuth / 服务账号凭证）。
 *
 * 约定：
 * - 需要调用 Google Ads API 时，优先 `getGoogleAdsAuthContext(userId)`，勿散落 `getUserAuthType` + `getGoogleAdsCredentials`。
 * - 账号级 SA 绑定请传入 `linkedAccountServiceAccountId`，用 `resolveEffectiveServiceAccountId` / `resolveGoogleAdsApiAuthFromContext`。
 * - 是否已配置：用 `hasConfiguredGoogleAdsAuthFromContext`，勿仅用 `auth.serviceAccountId` 判断。
 */
import {
  isGoogleAdsAuthShared,
  resolveGoogleAdsCredentialOwnerId,
  resolveGoogleAdsApiAccessLevel,
  type GoogleAdsAuthAssignment,
} from './google-ads-auth-assignment'
import { getGoogleAdsCredentials, getUserAuthType } from './google-ads-oauth'
import { getServiceAccountConfig } from './google-ads-service-account'

export interface GoogleAdsAuthContext {
  userId: number
  ownerUserId: number
  assignment: GoogleAdsAuthAssignment | null
  isShared: boolean
  canModify: boolean
  auth: {
    authType: 'oauth' | 'service_account'
    serviceAccountId?: string
  }
  oauthCredentials: Awaited<ReturnType<typeof getGoogleAdsCredentials>>
  serviceAccountConfig: Awaited<ReturnType<typeof getServiceAccountConfig>>
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
  const { ownerUserId, assignment, isShared } = await resolveGoogleAdsCredentialOwnerId(userId)
  const auth = await getUserAuthType(userId)

  let oauthCredentials: Awaited<ReturnType<typeof getGoogleAdsCredentials>> = null
  let serviceAccountConfig: Awaited<ReturnType<typeof getServiceAccountConfig>> = null

  if (auth.authType === 'oauth') {
    oauthCredentials = await getGoogleAdsCredentials(userId)
  } else {
    serviceAccountConfig = await getServiceAccountConfig(userId, auth.serviceAccountId)
  }

  return {
    userId,
    ownerUserId,
    assignment,
    isShared,
    canModify: !isGoogleAdsAuthShared(assignment),
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
  if (ctx.auth.authType === 'oauth') {
    return Boolean(ctx.oauthCredentials?.refresh_token)
  }

  return Boolean(resolveEffectiveServiceAccountId(undefined, ctx))
}

export function getServiceAccountMccFromContext(ctx: GoogleAdsAuthContext): string | undefined {
  const mcc = ctx.serviceAccountConfig?.mccCustomerId
  return mcc ? String(mcc) : undefined
}

export type GoogleAdsApiAuthValidationError =
  | 'not_configured'
  | 'oauth_refresh_missing'
  | 'service_account_missing'

export function googleAdsApiAuthValidationErrorMessage(
  reason: GoogleAdsApiAuthValidationError
): string {
  switch (reason) {
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

/** OAuth invalid_grant 时尝试回退的服务账号 ID（账号绑定 → 用户默认 SA）。 */
export function resolveOAuthInvalidGrantFallbackServiceAccountId(
  apiAuth: Pick<GoogleAdsApiAuthFields, 'serviceAccountId'>,
  ctx: Pick<GoogleAdsAuthContext, 'auth' | 'serviceAccountConfig'>
): string | undefined {
  return apiAuth.serviceAccountId || ctx.auth.serviceAccountId || ctx.serviceAccountConfig?.id
}

/**
 * 一次性加载 context 并解析 API 调用字段（无账号绑定时 linked 传 null/undefined）。
 */
export async function getGoogleAdsApiAuthForUser(
  userId: number,
  linkedAccountServiceAccountId?: string | null
): Promise<{ ctx: GoogleAdsAuthContext; apiAuth: GoogleAdsApiAuthFields }> {
  const ctx = await getGoogleAdsAuthContext(userId)
  const apiAuth = await resolveGoogleAdsApiAuthFromContext(ctx, linkedAccountServiceAccountId)
  return { ctx, apiAuth }
}

export async function resolveGoogleAdsApiAuthFromContext(
  ctx: GoogleAdsAuthContext,
  linkedAccountServiceAccountId?: string | null
): Promise<GoogleAdsApiAuthFields> {
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
  const hasCredentials = Boolean(credentials?.refresh_token || hasServiceAccount)

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
