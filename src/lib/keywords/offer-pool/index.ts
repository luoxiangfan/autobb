/**
 * Offer 级关键词池服务 v1.0
 *
 * @see docs/Offer 级广告创意优化方案.md
 */

export type {
  BucketCreativeOptions,
  BucketType,
  ClusteringStrategy,
  CoverageKeywordConfig,
  GetKeywordsOptions,
  GetKeywordsResult,
  KeywordBuckets,
  OfferKeywordPool,
  PoolKeywordData,
  StoreKeywordBuckets,
  SyntheticKeywordConfig,
} from './types'
export {
  DEFAULT_COVERAGE_KEYWORD_CONFIG,
  DEFAULT_PRODUCT_CLUSTER_BUCKETS,
  DEFAULT_STORE_CLUSTER_BUCKETS,
} from './types'
export { clusterKeywordsByIntent } from './keyword-clustering'
export { determineClusteringStrategy } from './clustering-strategy'

export {
  composeGlobalCoreBrandedKeyword,
  resolveBrandCoreKeywordSourceMeta,
} from './offer-pool-global-core'
export { separateBrandKeywords } from './offer-pool-brand-utils'
export { saveKeywordPool, getKeywordPoolByOfferId, deleteKeywordPool } from './offer-pool-storage'
export { generateOfferKeywordPool } from './offer-pool-generator'
export {
  getOrCreateKeywordPool,
  resolveKeywordPoolForCreativeGeneration,
  promoteKeywordsToOfferKeywordPool,
} from './offer-pool-resolution'
export {
  getBucketInfo,
  getCoverageBucketKeywords,
  getAvailableBuckets,
  getUsedBuckets,
  calculateKeywordOverlapRate,
  getKeywords,
  getKeywordsByLinkTypeAndBucket,
} from './offer-pool-bucket-api'

import { resolveOfferPageType } from './keyword-clustering'
import {
  buildVerifiedSourceKeywordData,
  extractStoreProductNamesFromLinks,
} from './offer-pool-storage'
import { filterGlobalCoreKeywordsByOfferContext } from './offer-pool-global-core'

export const __testOnly = {
  extractStoreProductNamesFromLinks,
  buildVerifiedSourceKeywordData,
  resolveOfferPageType,
  filterGlobalCoreKeywordsByOfferContext,
}
