// Affiliate product types and ConfigRequiredError

export type AffiliatePlatform = 'yeahpromos' | 'partnerboost'
export type SyncMode = 'platform' | 'single' | 'delta'
export type AffiliateProductSyncProgress = {
  totalFetched: number
  processedCount: number
  createdCount: number
  updatedCount: number
  failedCount: number
}
export type AffiliateLandingPageType =
  | 'amazon_product'
  | 'amazon_store'
  | 'independent_product'
  | 'independent_store'
  | 'unknown'

export type AffiliateProductLifecycleStatus = 'active' | 'invalid' | 'sync_missing' | 'unknown'
export type AffiliateProductStatusFilter = AffiliateProductLifecycleStatus | 'all'
export type AffiliateCommissionRateMode = 'percent' | 'amount'

export type AffiliateProduct = {
  id: number
  user_id: number
  platform: AffiliatePlatform
  mid: string
  merchant_id?: string | null
  asin: string | null
  brand: string | null
  product_name: string | null
  product_url: string | null
  promo_link: string | null
  short_promo_link: string | null
  allowed_countries_json: string | null
  price_amount: number | null
  price_currency: string | null
  commission_rate: number | null
  commission_amount: number | null
  commission_rate_mode?: AffiliateCommissionRateMode | null
  review_count: number | null
  is_deeplink?: boolean | number | null
  is_confirmed_invalid?: boolean | number | null
  raw_json?: string | null
  is_blacklisted: boolean | number
  recommendation_score?: number | null // 推荐指数 (1.0-5.0)
  recommendation_reasons?: string | null // 推荐理由 (JSON数组)
  seasonality_score?: number | null // 季节性评分 (0-100)
  seasonality_analysis?: string | null // AI分析结果 (JSON)
  product_analysis?: string | null // 商品AI分析结果 (JSON) - 扩展维度
  score_calculated_at?: string | null // 评分计算时间
  last_synced_at: string | null
  last_seen_at: string | null
  created_at: string
  updated_at: string
}

export type AffiliateProductListItem = {
  id: number
  serial: number
  platform: AffiliatePlatform
  mid: string
  merchantId: string | null
  productStatus: AffiliateProductLifecycleStatus
  asin: string | null
  landingPageType: AffiliateLandingPageType
  isDeepLink: boolean | null
  brand: string | null
  productName: string | null
  productUrl: string | null
  allowedCountries: string[]
  priceAmount: number | null
  priceCurrency: string | null
  commissionRate: number | null
  commissionRateMode: AffiliateCommissionRateMode
  commissionAmount: number | null
  commissionCurrency: string | null
  reviewCount: number | null
  promoLink: string | null
  shortPromoLink: string | null
  activeOfferCount: number
  historicalOfferCount: number
  relatedOfferCount: number
  isBlacklisted: boolean
  recommendationScore: number | null // 新增: 推荐指数
  recommendationReasons: string[] | null // 新增: 推荐理由
  seasonalityScore: number | null // 新增: 季节性评分
  productAnalysis: any | null // 新增: 商品综合AI分析结果
  lastSyncedAt: string | null
  createdAt: string
  updatedAt: string
}

export type NormalizedAffiliateProduct = {
  platform: AffiliatePlatform
  mid: string
  merchantId?: string | null
  asin: string | null
  brand: string | null
  productName: string | null
  productUrl: string | null
  promoLink: string | null
  shortPromoLink: string | null
  allowedCountries: string[]
  priceAmount: number | null
  priceCurrency: string | null
  commissionRate: number | null
  commissionAmount: number | null
  commissionRateMode: AffiliateCommissionRateMode
  reviewCount: number | null
  isDeepLink: boolean | null
  isConfirmedInvalid: boolean
}

export type ProductSortField =
  | 'serial'
  | 'platform'
  | 'mid'
  | 'asin'
  | 'createdAt'
  | 'allowedCountries'
  | 'priceAmount'
  | 'commissionRate'
  | 'commissionAmount'
  | 'reviewCount'
  | 'promoLink'
  | 'relatedOfferCount'
  | 'updatedAt'
  | 'recommendationScore' // 新增: 推荐指数排序

export type ProductSortOrder = 'asc' | 'desc'

export type ProductListOptions = {
  page?: number
  pageSize?: number
  search?: string
  mid?: string
  targetCountry?: string
  landingPageType?: AffiliateLandingPageType | 'all'
  platform?: AffiliatePlatform | 'all'
  sortBy?: ProductSortField
  sortOrder?: ProductSortOrder
  reviewCountMin?: number
  reviewCountMax?: number
  priceAmountMin?: number
  priceAmountMax?: number
  commissionRateMin?: number
  commissionRateMax?: number
  commissionAmountMin?: number
  commissionAmountMax?: number
  recommendationScoreMin?: number
  recommendationScoreMax?: number
  recommendationScoreFreshOnly?: boolean
  createdAtFrom?: string
  createdAtTo?: string
  status?: AffiliateProductStatusFilter
  skipItems?: boolean
  skipInvalidSummary?: boolean
  fastSummary?: boolean
  lightweightSummary?: boolean
  skipHeavySummary?: boolean
  preferFastLandingTypeFilter?: boolean
}

export type PlatformProductStats = {
  total: number
  visibleCount: number
  productCount: number
  storeCount: number
  productsWithLinkCount: number
  activeProductsCount: number
  invalidProductsCount: number
  syncMissingProductsCount: number
  unknownProductsCount: number
  blacklistedCount: number
}

export type ProductLandingPageStats = {
  productCount: number
  storeCount: number
  unknownCount: number
}

export type ProductListResult = {
  items: AffiliateProductListItem[]
  total: number
  landingPageStats: ProductLandingPageStats
  productsWithLinkCount: number
  activeProductsCount: number
  invalidProductsCount: number
  syncMissingProductsCount: number
  unknownProductsCount: number
  blacklistedCount: number
  platformStats: Record<AffiliatePlatform, PlatformProductStats>
  page: number
  pageSize: number
}

export type AffiliateProductOfflineFailure = {
  offerId: number
  error: string
}

export type AffiliateProductOfflineResult = {
  productId: number
  totalLinkedOffers: number
  deletedOfferCount: number
  deletedOfferIds: number[]
  failedOffers: AffiliateProductOfflineFailure[]
  offlined: boolean
  product: AffiliateProduct | null
}

export type AffiliateProductOfferLinkCreatedVia =
  | 'single'
  | 'batch'
  | 'manual_link'
  | 'publish_backfill'
  | 'asin_fallback'

export type OfferProductBackfillDecisionReason =
  | 'exact_url'
  | 'link_id'
  | 'asin'
  | 'link_id_asin_intersection'
  | 'brand'
  | 'ambiguous_exact_url'
  | 'ambiguous_link_id'
  | 'ambiguous_asin'
  | 'ambiguous_brand'
  | 'ambiguous_link_id_asin_intersection'
  | 'conflicting_link_id_asin'
  | 'no_match'

export type OfferProductLinkBackfillReason =
  | 'already_linked'
  | 'offer_not_found'
  | 'no_offer_signal'
  | 'linked_by_exact_url'
  | 'linked_by_link_id'
  | 'linked_by_asin'
  | 'linked_by_brand'
  | 'linked_by_link_id_asin_intersection'
  | 'ambiguous_exact_url'
  | 'ambiguous_link_id'
  | 'ambiguous_asin'
  | 'ambiguous_brand'
  | 'ambiguous_link_id_asin_intersection'
  | 'conflicting_link_id_asin'
  | 'no_match'

export type OfferProductLinkBackfillResult = {
  linked: boolean
  offerId: number
  productId: number | null
  reason: OfferProductLinkBackfillReason
  signals: {
    urlTokenCount: number
    linkIdCount: number
    asinCount: number
    brandCount: number
  }
  candidates: {
    exactUrlProductIds: number[]
    linkIdProductIds: number[]
    asinProductIds: number[]
    brandProductIds: number[]
  }
}

export type BatchOfflineAffiliateProductsResult = {
  total: number
  successCount: number
  failureCount: number
  results: Array<{
    productId: number
    success: boolean
    deletedOfferCount?: number
    totalLinkedOffers?: number
    offlined?: boolean
    failedOffers?: AffiliateProductOfflineFailure[]
    error?: string
  }>
}

export const PRODUCT_SCORE_VALIDITY_DAYS = 30
export const PRODUCT_SCORE_VALIDITY_WINDOW_MS = PRODUCT_SCORE_VALIDITY_DAYS * 24 * 60 * 60 * 1000

export class ConfigRequiredError extends Error {
  code = 'CONFIG_REQUIRED' as const
  platform: AffiliatePlatform
  missingKeys: string[]

  constructor(platform: AffiliatePlatform, missingKeys: string[]) {
    const keyList = missingKeys.join(', ')
    super(
      `${platform} 配置不完整或解密失败: ${keyList}。请检查配置是否正确，或 ENCRYPTION_KEY 是否与加密时一致`
    )
    this.name = 'ConfigRequiredError'
    this.platform = platform
    this.missingKeys = missingKeys
  }
}
