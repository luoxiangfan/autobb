/**
 * Shared types for Google Ads accounts / API auth resolution.
 */
import type { GoogleAdsApiAuthFields, GoogleAdsAuthContext } from './google-ads-auth-context'
import type { KeywordIdeasPreparedOAuth } from './google-ads-keyword-planner'
import type { getServiceAccountConfig } from './google-ads-service-account'

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

export type SyncUserCredentials = {
  client_id: string
  client_secret: string
  developer_token: string
  login_customer_id?: string
}

/** OAuth API 客户端三元组（不含 refresh_token） */
export type OAuthApiCredentialsFields = {
  client_id: string
  client_secret: string
  developer_token: string
}

export function toOAuthApiCredentialsFields(
  userCredentials: Pick<SyncUserCredentials, 'client_id' | 'client_secret' | 'developer_token'>
): OAuthApiCredentialsFields {
  return {
    client_id: userCredentials.client_id,
    client_secret: userCredentials.client_secret,
    developer_token: userCredentials.developer_token,
  }
}

/** 含 login_customer_id 的 OAuth 客户端凭证 */
export type OAuthApiClientCredentials = OAuthApiCredentialsFields & {
  login_customer_id: string
}

export type OAuthGoogleAdsCallBundle = {
  oauthCredentials: OAuthApiCredentialsFields
  oauthLoginCustomerId?: string
}

export type PreparedGoogleAdsAccountApiCall = {
  apiAuth: GoogleAdsApiAuthFields
  refreshToken: string
  oauthCredentials?: OAuthApiCredentialsFields
  oauthLoginCustomerId?: string
}

export type GoogleAdsLinkedAccountPrepareResult =
  | ({ ok: true; authContext: GoogleAdsAuthContext } & PreparedGoogleAdsAccountApiCall)
  | { ok: false; message: string }

/** Keyword Planner Historical Metrics 调用所需的 heal 后凭证 */
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

/** Keyword Planner Ideas + Historical Metrics 共用 session */
export type KeywordPlannerPreparedSession = {
  preparedOAuth?: KeywordIdeasPreparedOAuth
  volumeAuth: KeywordPlannerVolumeAuth
}

export type CreativeGenerationGoogleAdsValidationResult =
  | {
      ok: false
      message: string
      authType?: 'oauth' | 'service_account'
      missingFields?: string[]
    }
  | {
      ok: true
      /** 缓存命中或未请求 API 校验时可省略；fresh validate 会填充 */
      authContext?: GoogleAdsAuthContext
      apiAuth?: GoogleAdsApiAuthFields
    }

/** 批任务 prepare 缓存条目：不含 refresh_token / client_secret 等密钥 */
export type SlimPreparedGoogleAdsAccountApiCall = {
  authContext: GoogleAdsAuthContext
  apiAuth: GoogleAdsApiAuthFields
  oauthLoginCustomerId?: string
  /** prepare 写入时的 auth generation；与当前 generation 不一致时视为 stale */
  generationAtPrepare: number
}

/**
 * Job / 请求级 prepare 缓存（不含密钥；须在 job / 请求结束时显式 clear）。
 *
 * - `prepareByLinkedSa`：slim 条目，同 job 内 rehydrate 复用
 * - `prepareInflight`：同 (userId, linkedSa) 并发 prepare 合并
 * - `healedOAuthBundleByOwner`：OAuth heal bundle（key=`ownerUserId`，generation 绑定；共享认证多子用户复用）
 *
 * 凭证变更须依赖 `invalidateGoogleAdsAuthContextCacheForOwner` bump generation；
 * **勿跨 request / job 复用**实例。`clear*` 不触碰进程级 `hydratedSecrets` 短缓存。
 */
export type GoogleAdsLinkedAccountPrepareCache = {
  prepareByLinkedSa: Map<string, SlimPreparedGoogleAdsAccountApiCall>
  /** 同 (userId, linkedSa) 并发 prepare 合并 */
  prepareInflight: Map<string, Promise<GoogleAdsLinkedAccountPrepareResult>>
  /** job 内 OAuth heal bundle 短缓存（key=ownerUserId，generation 绑定） */
  healedOAuthBundleByOwner: Map<number, { generation: number; bundle: OAuthGoogleAdsCallBundle }>
}

/** validation 缓存条目：不含 authContext / apiAuth 密钥 */
export type CreativeGenerationValidationCacheEntry =
  | {
      ok: false
      message: string
      authType?: 'oauth' | 'service_account'
      missingFields?: string[]
      generationAtValidate: number
      /** 共享认证：凭证 owner（ownerUserId !== 请求 userId 时写入） */
      ownerUserId?: number
      ownerGenerationAtValidate?: number
    }
  | {
      ok: true
      generationAtValidate: number
      ownerUserId?: number
      ownerGenerationAtValidate?: number
    }

/**
 * 创意生成 auth 缓存（prepare + validation 两层）。
 * 仅限单次 HTTP 请求或 batch job 生命周期；结束须 `clearCreativeGenerationAuthCache`。
 */
export type CreativeGenerationAuthCache = GoogleAdsLinkedAccountPrepareCache & {
  validationByOfferId: Map<number, CreativeGenerationValidationCacheEntry>
  validationByUserId: Map<number, CreativeGenerationValidationCacheEntry>
}

export type KeywordPoolExpandCredentials = {
  authType: 'oauth' | 'service_account'
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
  linkedServiceAccountId?: string | null
  serviceAccountId?: string | null
}

export type KeywordPoolExpandLoadResult =
  | { ok: false }
  | {
      ok: true
      creds: KeywordPoolExpandCredentials
      plannerSession: KeywordPlannerPreparedSession
    }

export type KeywordPoolPreparedExpand = Extract<KeywordPoolExpandLoadResult, { ok: true }>

export type KeywordPlannerVolumeAuthContextParams = {
  userId: number
  offerId?: number
  googleAdsAccountId?: number
  linkedServiceAccountId?: string | null
}

export type DeveloperTokenHealCode = 'DEVELOPER_TOKEN_INVALID' | 'DUAL_STACK_CONFLICT'

export type DeveloperTokenHealResult =
  | { ok: true }
  | { ok: false; code: DeveloperTokenHealCode; message: string }
