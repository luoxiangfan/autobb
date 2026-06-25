import { installGoogleAdsWarningFilter } from '@/lib/google-ads/common/warning-filter'
import type { OAuthApiCredentialsFields } from '@/lib/google-ads/accounts/auth/index'

export type {
  GoogleAdsCustomerCredentialParams,
  OAuthGetCustomerWithCredentialsParams,
} from '@/lib/google-ads/oauth/customer-params'
export { oauthGetCustomerParams } from '@/lib/google-ads/oauth/customer-params'

export type { OAuthApiCredentialsFields }

/**
 * Google Ads API 高层 mutate/search 约定
 * 业务入口须 `prepareGoogleAdsApiCallForLinkedAccount` / `resolveGoogleAdsApiAuthForAccount`。
 * 调用本文件函数时传入 `apiAuth.authType` 与 `preparedAuthContextField(prepared)`。
 * 勿使用 `authType || 'oauth'`；未传 authType 时由 `resolveGoogleAdsApiCallAuth` / `resolveAuthTypeForGoogleAdsApiCall` 从 context 推断；嵌套调用须透传 `authContext`。
 */

export type { GoogleAdsApiAuthContextField } from './customer'

installGoogleAdsWarningFilter()

export { getGoogleAdsOAuthRedirectUri } from '@/lib/google-ads/oauth/redirect'

export { serializeGoogleAdsError, trackOAuthApiCall } from './shared'
export { sanitizeKeyword, sanitizeKeywordForGoogleAds } from './keywords-sanitize'
export { getGoogleAdsClient, exchangeCodeForTokens, refreshAccessToken } from './oauth-client'
export {
  getCustomer,
  resolveGoogleAdsApiCallAuth,
  resolveAuthTypeForGoogleAdsApiCall,
  getCustomerWithCredentials,
} from './customer'
export {
  findGoogleAdsCampaignByName,
  createGoogleAdsCampaign,
  updateGoogleAdsCampaignStatus,
  updateGoogleAdsCampaignName,
  removeGoogleAdsCampaign,
  updateGoogleAdsCampaignBudget,
  getGoogleAdsCampaign,
  listGoogleAdsCampaigns,
  updateCampaignFinalUrlSuffix,
} from './campaigns'
export { findGoogleAdsAdGroupByName, createGoogleAdsAdGroup } from './ad-groups'
export {
  updateGoogleAdsKeywordStatus,
  createGoogleAdsKeywordsBatch,
  createGoogleAdsKeywordsBatchAllowingDuplicates,
} from './keywords-mutate'
export {
  ensureUniqueResponsiveSearchAdAssets,
  createGoogleAdsResponsiveSearchAd,
  ensureKeywordsInHeadlines,
} from './responsive-ads'
export {
  getCampaignPerformance,
  getAdGroupPerformance,
  getAdPerformance,
  getBatchCampaignPerformance,
} from './performance'
export {
  createGoogleAdsCalloutExtensions,
  createGoogleAdsSitelinkExtensions,
  updateAssetFinalUrlSuffix,
} from './extensions'

export { enums, GoogleAdsApi } from 'google-ads-api'
