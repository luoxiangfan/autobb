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
} from './google-ads-accounts-auth-types'

export {
  looksLikeOAuthAccessToken,
  looksLikeOAuthClientId,
  looksLikeOAuthClientSecret,
  developerTokenLooksInvalid,
  healAccountsRouteDeveloperToken,
} from './google-ads-developer-token-heal'

export {
  resolveOAuthRefreshToken,
  accountsBundleResolveErrorMessage,
  resolveAndHealSyncUserCredentials,
  resolveSyncUserCredentialsForJob,
  resolveOAuthClientCredentialsForUser,
  resolveOAuthApiCredentialsForUser,
  resolveAccountsRouteAuthBundle,
} from './google-ads-accounts-route-auth'

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
} from './google-ads-api-prepare'

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
} from './google-ads-keyword-planner-auth'

export {
  assertGoogleAdsAuthTypeMatchesContext,
  resolveGoogleAdsApiAuthType,
} from './google-ads-auth-context'

export {
  oauthGetCustomerParams,
  type GoogleAdsCustomerCredentialParams,
  type OAuthGetCustomerWithCredentialsParams,
} from './google-ads-oauth-customer-params'

export {
  createCreativeGenerationAuthCache,
  clearCreativeGenerationAuthCache,
  validateGoogleAdsConfigForCreativeGeneration,
} from './google-ads-creative-generation-auth'
