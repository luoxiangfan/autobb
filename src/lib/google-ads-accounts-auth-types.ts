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
  | { ok: true; authContext: GoogleAdsAuthContext; apiAuth: GoogleAdsApiAuthFields }

/** 批任务 prepare 缓存条目：不含 refresh_token / client_secret 等密钥 */
export type SlimPreparedGoogleAdsAccountApiCall = {
  authContext: GoogleAdsAuthContext
  apiAuth: GoogleAdsApiAuthFields
  oauthLoginCustomerId?: string
}

export type GoogleAdsLinkedAccountPrepareCache = {
  prepareByLinkedSa: Map<string, SlimPreparedGoogleAdsAccountApiCall>
}

export type CreativeGenerationAuthCache = GoogleAdsLinkedAccountPrepareCache & {
  validationByOfferId: Map<number, CreativeGenerationGoogleAdsValidationResult>
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
