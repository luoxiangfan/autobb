/* * Google Ads Keyword Planner API、标准化与认证解析 */
export type { KeywordIdeasPreparedOAuth, KeywordIdea, KeywordMetrics } from './planner'
export {
  getKeywordIdeas,
  getKeywordMetrics,
  filterHighQualityKeywords,
  rankKeywordsByRelevance,
  groupKeywordsByTheme,
  formatCpcMicros,
  formatSearchVolume,
} from './planner'

export {
  normalizeGoogleAdsKeyword,
  deduplicateKeywordsWithPriority,
  areKeywordsDuplicates,
  logDuplicateKeywords,
} from './normalizer'

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
} from './planner-auth'
