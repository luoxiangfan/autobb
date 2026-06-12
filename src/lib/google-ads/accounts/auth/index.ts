/**
 * Google Ads 账号列表 / API 调用所需的认证解析（auth-context 之上）。
 * 实现按职责拆分至同目录子模块；由此文件统一 re-export 以保持 import 路径稳定。
 */
export type {
  AccountsRouteAuthBundle,
  AccountsRouteAuthResolveResult,
  AccountsRouteCredentials,
  CreativeGenerationAuthCache,
  CreativeGenerationGoogleAdsValidationResult,
  DeveloperTokenHealCode,
  DeveloperTokenHealResult,
  GoogleAdsLinkedAccountPrepareCache,
  GoogleAdsLinkedAccountPrepareResult,
  KeywordPlannerPreparedSession,
  KeywordPlannerVolumeAuth,
  KeywordPlannerVolumeAuthContextParams,
  KeywordPlannerVolumeAuthLoadResult,
  KeywordPoolExpandCredentials,
  KeywordPoolExpandLoadResult,
  KeywordPoolPreparedExpand,
  OAuthApiClientCredentials,
  OAuthApiCredentialsFields,
  OAuthGoogleAdsCallBundle,
  PreparedGoogleAdsAccountApiCall,
  ResolveKeywordPlannerLinkedSaParams,
  SyncUserCredentials,
} from '@/lib/google-ads/accounts/auth/types'

export {
  looksLikeOAuthAccessToken,
  looksLikeOAuthClientId,
  looksLikeOAuthClientSecret,
  developerTokenLooksInvalid,
  healAccountsRouteDeveloperToken,
} from '@/lib/google-ads/accounts/auth/developer-token-heal'

export {
  resolveOAuthRefreshToken,
  accountsBundleResolveErrorMessage,
  resolveAndHealSyncUserCredentials,
  resolveSyncUserCredentialsForJob,
  resolveOAuthClientCredentialsForUser,
  resolveOAuthApiCredentialsForUser,
  resolveAccountsRouteAuthBundle,
} from '@/lib/google-ads/accounts/auth/route-auth'

export {
  resolveSyncAuthForAccount,
  resolveHealedOAuthCredentialsFields,
  loadOAuthGoogleAdsCallBundleForContext,
  googleAdsAuthContextParam,
  preparedAuthContextField,
  syncUserCredentialsFromPrepared,
  prepareGoogleAdsAccountApiCall,
  prepareGoogleAdsApiCallForLinkedAccount,
  createGoogleAdsLinkedAccountPrepareCache,
  clearGoogleAdsLinkedAccountPrepareCache,
  linkedSaPrepareCacheKey,
  prepareGoogleAdsApiCallForLinkedAccountCached,
} from '@/lib/google-ads/accounts/auth/api-prepare'

export {
  buildKeywordPlannerSessionFromPrepared,
  keywordPlannerVolumeAuthFromPrepared,
  resolveLinkedServiceAccountIdForGoogleAdsAccount,
  resolveLinkedServiceAccountIdForOffer,
  loadKeywordPlannerVolumeAuthForOffer,
  resolveLinkedServiceAccountIdForKeywordPlannerContext,
  loadKeywordPlannerVolumeAuthForContext,
  loadKeywordPlannerVolumeAuth,
  getKeywordSearchVolumesForPlannerContext,
  resolveKeywordPlannerLinkedServiceAccountId,
  queryGoogleAdsAccountForOfferExpand,
  loadKeywordPoolExpandCredentialsForOffer,
  resolvePlannerExpandForOffer,
} from '@/lib/google-ads/keyword/planner-auth'

export {
  assertGoogleAdsAuthTypeMatchesContext,
  resolveGoogleAdsApiAuthType,
} from '@/lib/google-ads/auth/context'

export {
  oauthGetCustomerParams,
  type GoogleAdsCustomerCredentialParams,
  type OAuthGetCustomerWithCredentialsParams,
} from '@/lib/google-ads/oauth/customer-params'

export {
  createCreativeGenerationAuthCache,
  clearCreativeGenerationAuthCache,
  validateGoogleAdsConfigForCreativeGeneration,
} from '@/lib/google-ads/accounts/auth/creative-generation-auth'
