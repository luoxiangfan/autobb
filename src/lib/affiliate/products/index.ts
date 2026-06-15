// Public API barrel

export type {
  AffiliatePlatform,
  SyncMode,
  AffiliateProductSyncProgress,
  AffiliateLandingPageType,
  AffiliateProductLifecycleStatus,
  AffiliateProductStatusFilter,
  AffiliateCommissionRateMode,
  AffiliateProduct,
  AffiliateProductListItem,
  ProductSortField,
  ProductSortOrder,
  ProductListOptions,
  PlatformProductStats,
  ProductLandingPageStats,
  ProductListResult,
  AffiliateProductOfflineFailure,
  AffiliateProductOfflineResult,
  AffiliateProductOfferLinkCreatedVia,
  OfferProductLinkBackfillReason,
  OfferProductLinkBackfillResult,
  BatchOfflineAffiliateProductsResult,
} from './types'

export type {
  AffiliateProductSyncCheckpoint,
  AffiliateProductSyncHourlyStat,
  YeahPromosSyncMonitor,
} from './sync-runs'

export { ConfigRequiredError } from './types'

export {
  normalizeYeahPromosResultCode,
  normalizePartnerboostStatusCode,
  extractPartnerboostProductsPayload,
  extractPartnerboostDtcProductsPayload,
  resolvePartnerboostPromoLinks,
  resolvePartnerboostCountryCode,
  extractYeahPromosPayload,
  extractYeahPromosTransactionsPayload,
  parseYeahPromosMerchantCommission,
} from './parsing'

export {
  normalizeAffiliateProductStatusFilter,
  normalizeAffiliateLandingPageTypeFilter,
  detectAffiliateLandingPageType,
  normalizeAffiliatePlatform,
} from './normalization'

export { checkAffiliatePlatformConfig } from './config'

export { upsertAffiliateProducts } from './upsert'

export {
  buildAffiliateProductsOrderBy,
  runAffiliateProductsRawJsonRetirementMaintenance,
  listAffiliateProducts,
} from './query'

export {
  getAffiliateProductById,
  clearAllAffiliateProducts,
  offlineAffiliateProduct,
  batchOfflineAffiliateProducts,
  setAffiliateProductBlacklist,
  linkOfferToAffiliateProduct,
  backfillOfferProductLinkForPublishedCampaign,
  createOfferFromAffiliateProduct,
  batchCreateOffersFromAffiliateProducts,
} from './actions'

export {
  createAffiliateProductSyncRun,
  updateAffiliateProductSyncRun,
  getAffiliateProductSyncRunById,
  getLatestFailedAffiliateProductSyncRun,
  getAffiliateProductSyncRuns,
  recordAffiliateProductSyncHourlySnapshot,
  getYeahPromosSyncMonitor,
} from './sync-runs'

export { syncAffiliateProducts } from './sync'

export { __testOnly } from './test-exports'
