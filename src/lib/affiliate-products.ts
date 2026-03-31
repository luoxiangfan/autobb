import { createOffer, deleteOffer, findOfferById } from '@/lib/offers'
import { getDatabase, type DatabaseAdapter } from '@/lib/db'
import { getInsertedId, toBool } from '@/lib/db-helpers'
import { getSetting, getUserOnlySetting } from '@/lib/settings'
import { createOfferExtractionTaskForExistingOffer } from '@/lib/offer-extraction-task'
import { load as loadHtml } from 'cheerio'
import {
  buildProductSummaryCacheHash,
  getCachedProductSummary,
  setCachedProductSummary,
  type ProductSummaryCachePayload,
} from '@/lib/products-cache'
import { getYeahPromosSessionCookieForSync } from '@/lib/yeahpromos-session'
import { resolveAffiliateSettingCategory } from '@/lib/openclaw/settings'
import axios from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { fetchProxyIp } from '@/lib/proxy/fetch-proxy-ip'
import { generateRandomFingerprint } from '@/lib/browser-fingerprint'

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

type NormalizedAffiliateProduct = {
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
  createdAtFrom?: string
  createdAtTo?: string
  status?: AffiliateProductStatusFilter
  skipItems?: boolean
  skipInvalidSummary?: boolean
  fastSummary?: boolean
  lightweightSummary?: boolean
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

type OfferProductBackfillDecisionReason =
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

export class ConfigRequiredError extends Error {
  code = 'CONFIG_REQUIRED' as const
  platform: AffiliatePlatform
  missingKeys: string[]

  constructor(platform: AffiliatePlatform, missingKeys: string[]) {
    const keyList = missingKeys.join(', ')
    super(`${platform} 配置不完整或解密失败: ${keyList}。请检查配置是否正确，或 ENCRYPTION_KEY 是否与加密时一致`)
    this.name = 'ConfigRequiredError'
    this.platform = platform
    this.missingKeys = missingKeys
  }
}

type PlatformConfigCheck = {
  configured: boolean
  missingKeys: string[]
  values: Record<string, string>
}

const PLATFORM_KEY_REQUIREMENTS: Record<AffiliatePlatform, string[]> = {
  yeahpromos: ['yeahpromos_token', 'yeahpromos_site_id'],
  partnerboost: ['partnerboost_token'],
}

const DEFAULT_PB_BASE_URL = 'https://app.partnerboost.com'
const DEFAULT_PB_COUNTRY_CODE = 'US'
const DEFAULT_PB_PRODUCTS_PAGE_SIZE = 100
const MAX_PB_SYNC_MAX_PAGES = 20000
const MAX_PB_EMPTY_PAGE_STREAK = 3
const DEFAULT_PB_PRODUCTS_LINK_BATCH_SIZE = 20
const MAX_PB_PRODUCTS_LINK_BATCH_SIZE = 50
const DEFAULT_PB_ASIN_LINK_BATCH_SIZE = 20
const MAX_PB_ASIN_LINK_BATCH_SIZE = 50
const MAX_PB_ASINS_PER_REQUEST = 50
const PB_LINK_HEARTBEAT_EVERY_BATCHES = 20
const DEFAULT_PB_DELTA_ASIN_BATCH_SIZE = MAX_PB_ASINS_PER_REQUEST
const MAX_PB_DELTA_ASIN_BATCH_SIZE = MAX_PB_ASINS_PER_REQUEST
const DEFAULT_PB_ACTIVE_DAYS = 14
const MAX_PB_ACTIVE_DAYS = 60
const DEFAULT_PB_REQUEST_DELAY_MS = 150
const MAX_PB_REQUEST_DELAY_MS = 5000
const DEFAULT_PB_RATE_LIMIT_MAX_RETRIES = 4
const DEFAULT_PB_RATE_LIMIT_BASE_DELAY_MS = 800
const DEFAULT_PB_RATE_LIMIT_MAX_DELAY_MS = 12000
const DEFAULT_PB_FULL_SYNC_COUNTRY_SEQUENCE = ['US', 'MX', 'CA', 'DE', 'UK', 'ES', 'FR', 'IT'] as const
const DEFAULT_PB_STREAM_WINDOW_PAGES = 10
const MAX_PB_STREAM_WINDOW_PAGES = 200
const DEFAULT_YP_STREAM_WINDOW_PAGES = 3
const MAX_YP_STREAM_WINDOW_PAGES = 20
const DEFAULT_UPSERT_BATCH_SIZE_POSTGRES = 800
const DEFAULT_UPSERT_BATCH_SIZE_SQLITE = 40
const DEFAULT_YP_REQUEST_DELAY_MS = 120
const MAX_YP_REQUEST_DELAY_MS = 5000
const DEFAULT_YP_RATE_LIMIT_MAX_RETRIES = 5
const DEFAULT_YP_RATE_LIMIT_BASE_DELAY_MS = 1200
const DEFAULT_YP_RATE_LIMIT_MAX_DELAY_MS = 30000
const DEFAULT_YP_ACTIVE_DAYS = 30
const MAX_YP_ACTIVE_DAYS = 90
const DEFAULT_YP_DELTA_MAX_PAGES = 20
const DEFAULT_YP_DELTA_PRIORITY_PAGE_CAP = 2
const MAX_YP_SYNC_MAX_PAGES = 50000
const MAX_YP_EMPTY_PAGE_STREAK = 3
// 连续多少页返回空列表时切换市场（避免在已抓完的市场无限翻页）
const MAX_YP_CONSECUTIVE_EMPTY_PAGES_PER_SCOPE = 10
const DEFAULT_YP_SKIP_FAILED_PAGES = true // 默认跳过连续失败的页面，避免因服务器端问题导致整个同步中止
const DEFAULT_YP_PRODUCTS_REQUEST_DELAY_MS = 4500
const MIN_YP_PRODUCTS_REQUEST_DELAY_MS = 1500
const MAX_YP_PRODUCTS_REQUEST_DELAY_MS = 15000
const DEFAULT_YP_PRODUCTS_DELAY_JITTER_MS = 1200
const MAX_YP_PRODUCTS_DELAY_JITTER_MS = 4000
const YP_SESSION_MIN_REMAINING_MS_INITIAL = 30 * 60 * 1000
const YP_SESSION_MIN_REMAINING_MS_RESUME = 5 * 60 * 1000
const AFFILIATE_RAW_JSON_RETIREMENT_TABLE = 'affiliate_product_raw_json_retirement'
const AFFILIATE_RAW_JSON_RETIREMENT_SINGLETON_ID = 1
const AFFILIATE_RAW_JSON_RETIREMENT_BATCH_SIZE_MIN = 500
const AFFILIATE_RAW_JSON_RETIREMENT_BATCH_SIZE_BUSY = 1000
const AFFILIATE_RAW_JSON_RETIREMENT_BATCH_SIZE_MAX = 2000
const AFFILIATE_RAW_JSON_RETIREMENT_BUSY_SYNC_RUNS_THRESHOLD = 1
const AFFILIATE_RAW_JSON_RETIREMENT_PEAK_SYNC_RUNS_THRESHOLD = 3
const AFFILIATE_RAW_JSON_RETIREMENT_DROP_LOCK_KEY = 93620411
const AFFILIATE_RAW_JSON_RETIREMENT_DROP_LOCK_TIMEOUT_MS = 1500
const AFFILIATE_RAW_JSON_RETIREMENT_DROP_STATEMENT_TIMEOUT_MS = 5000
const AFFILIATE_RAW_JSON_RETIREMENT_DROP_MAX_ATTEMPTS = 3
const AFFILIATE_RAW_JSON_RETIREMENT_DROP_RETRY_BASE_DELAY_MS = 500
const AFFILIATE_RAW_JSON_RETIREMENT_DROP_RETRY_MAX_DELAY_MS = 3000
const AFFILIATE_RAW_JSON_RETIREMENT_DROP_WINDOW_START_HOUR = 1
const AFFILIATE_RAW_JSON_RETIREMENT_DROP_WINDOW_END_HOUR = 6
const AFFILIATE_RAW_JSON_RETIREMENT_DROP_WINDOW_TZ_OFFSET_HOURS = 8
const YP_MARKETPLACE_TEMPLATES_SETTING_KEY = 'yeahpromos_marketplace_templates_json'
const YP_PROXY_COUNTRY_ALIAS: Record<string, string> = {
  UK: 'GB',
}
const PRODUCT_COUNTRY_FILTER_ALIAS_MAP: Record<string, string[]> = {
  UK: ['GB'],
  GB: ['UK'],
}
const YP_DOM_INTERCEPT_KEYWORDS = [
  'request too fast',
  'request too frequent',
  'please request later',
  'too many request',
  'rate limit',
  'too many requests',
  'captcha',
  'verify you are human',
  'access denied',
  'forbidden',
  'robot check',
  'cloudflare',
  '请求过于频繁',
  '请求太快',
  '请稍后再试',
  'login required',
  'please login',
  'session expired',
  'unauthorized',
  '请登录',
  '登录已过期',
  '会话已过期',
] as const
const AFFILIATE_YP_ACCESS_PRODUCTS_TARGET_KEY = 'affiliate_yp_access_products_target'
const AFFILIATE_YP_ACCESS_PRODUCTS_UPDATED_AT_KEY = 'affiliate_yp_access_products_updated_at'

type PartnerboostProduct = {
  product_id?: string
  brand_id?: string | number
  brandId?: string | number
  bid?: string | number
  product_name?: string
  asin?: string
  brand_name?: string
  url?: string
  country_code?: string
  original_price?: string | number
  discount_price?: string | number
  currency?: string
  commission?: string | number
  acc_commission?: string | number
  reviews?: string | number
  review_count?: string | number
  reviewCount?: string | number
  rating_count?: string | number
  ratings_total?: string | number
}

type PartnerboostProductsResponse = {
  status?: { code?: number | string; msg?: string }
  data?: {
    list?: PartnerboostProduct[] | Record<string, PartnerboostProduct>
    has_more?: boolean | number | string
    hasMore?: boolean | number | string
  }
}

type PartnerboostDtcProduct = {
  creative_id?: string | number
  brand_id?: string | number
  mcid?: string
  merchant_name?: string
  brand?: string
  name?: string
  url?: string
  sku?: string
  price?: string | number
  old_price?: string | number
  currency?: string
  availability?: string
  tracking_url?: string
  tracking_url_short?: string
  tracking_url_smart?: string
  country?: string
  country_code?: string
}

type PartnerboostDtcProductsResponse = {
  status?: { code?: number | string; msg?: string }
  data?: {
    total?: number | string
    list?: PartnerboostDtcProduct[] | Record<string, PartnerboostDtcProduct>
  }
}

type PartnerboostLinkItem = {
  product_id?: string
  asin?: string
  link?: string
  partnerboost_link?: string
  link_id?: string
}

type PartnerboostLinkResponse = {
  status?: { code?: number | string; msg?: string }
  data?: PartnerboostLinkItem[]
  error_list?: Array<{ product_id?: string; message?: string }>
}

type PartnerboostAsinLinkResponse = {
  status?: { code?: number | string; msg?: string }
  data?: PartnerboostLinkItem[]
  error_list?: Array<{ asin?: string; country_code?: string; message?: string }>
}

type PartnerboostPromotableFetchParams = {
  userId: number
  asins?: string[]
  maxPages?: number
  startPage?: number
  countryCodeOverride?: string
  linkCountryCodeOverride?: string
  suppressMaxPagesWarning?: boolean
  onFetchProgress?: (fetchedCount: number) => Promise<void> | void
}

type PartnerboostPromotableFetchResult = {
  items: NormalizedAffiliateProduct[]
  hasMore: boolean
  nextPage: number
  fetchedPages: number
}

type YeahPromosMerchant = {
  id?: string | number
  mid?: string | number
  advert_id?: string | number
  site_id?: string | number
  merchant_name?: string
  url?: string
  site_url?: string
  tracking_url?: string
  track?: string
  is_deeplink?: string | number | boolean
  country?: string
  avg_payout?: string | number
  payout_unit?: string
  advert_status?: string | number
  status?: string | number
  merchant_status?: string
  reviews?: string | number
  review_count?: string | number
  reviewCount?: string | number
  rating_count?: string | number
  ratings_total?: string | number
}

type YeahPromosResponseData = {
  PageTotal?: number | string
  pageTotal?: number | string
  PageNow?: number | string
  pageNow?: number | string
  Data?: YeahPromosMerchant[] | Record<string, YeahPromosMerchant>
  data?: YeahPromosMerchant[] | Record<string, YeahPromosMerchant>
}

type YeahPromosResponse = {
  Code?: number | string
  code?: number | string
  message?: string
  msg?: string
  PageTotal?: number | string
  pageTotal?: number | string
  PageNow?: number | string
  pageNow?: number | string
  Data?: YeahPromosMerchant[] | Record<string, YeahPromosMerchant>
  data?: YeahPromosMerchant[] | YeahPromosResponseData
}

type YeahPromosTransaction = {
  id?: string | number
  advert_id?: string | number
  oid?: string | number
  creationDate_time?: string
  amount?: string | number
  sale_comm?: string | number
  status?: string | number
  sku?: string
  tag1?: string
  tag2?: string
  tag3?: string
}

type YeahPromosTransactionsResponseData = {
  PageTotal?: number | string
  pageTotal?: number | string
  PageNow?: number | string
  pageNow?: number | string
  Data?: YeahPromosTransaction[] | Record<string, YeahPromosTransaction>
  data?: YeahPromosTransaction[] | Record<string, YeahPromosTransaction>
}

type YeahPromosTransactionsResponse = {
  Code?: number | string
  code?: number | string
  PageTotal?: number | string
  pageTotal?: number | string
  PageNow?: number | string
  pageNow?: number | string
  Data?: YeahPromosTransaction[] | Record<string, YeahPromosTransaction>
  data?: YeahPromosTransaction[] | YeahPromosTransactionsResponseData
}

type YeahPromosTransactionMetric = {
  priceAmount: number | null
  commissionAmount: number | null
  commissionRate: number | null
  sampleCount: number
}

type YeahPromosProductPageParseResult = {
  items: NormalizedAffiliateProduct[]
  pageNow: number | null
  nextPage: number | null
  noProductsFound: boolean
}

type YeahPromosMarketplaceTemplate = {
  scope: string
  marketplace: string
  country: string
  url: string
}

type YeahPromosProxyConfigEntry = {
  country?: string
  url?: string
}

type YeahPromosProductsFetchResult = {
  items: NormalizedAffiliateProduct[]
  hasMore: boolean
  nextPage: number
  nextScope: string | null
  fetchedPages: number
}

type YeahPromosDeltaScopePlan = {
  templates: YeahPromosMarketplaceTemplate[]
  scopePageBudgets: Record<string, number>
}

type ParsedYeahPromosCommission = {
  mode: 'rate' | 'amount'
  rate: number | null
  amount: number | null
}

const YP_MARKETPLACE_COUNTRY_MAP: Record<string, string> = {
  'amazon.com': 'US',
  'amazon.co.uk': 'GB',
  'amazon.ca': 'CA',
  'amazon.de': 'DE',
  'amazon.fr': 'FR',
}

const DEFAULT_YP_MARKETPLACE_TEMPLATES: YeahPromosMarketplaceTemplate[] = [
  {
    scope: 'amazon.com',
    marketplace: 'amazon.com',
    country: 'US',
    url: 'https://yeahpromos.com/index/offer/products?is_delete=0&site_id=11767&join_status=2&market_place=amazon.com&sort=5&min_price=0&max_price=501&page=2',
  },
  {
    scope: 'amazon.co.uk',
    marketplace: 'amazon.co.uk',
    country: 'GB',
    url: 'https://yeahpromos.com/index/offer/products?is_delete=0&site_id=11767&join_status=2&market_place=amazon.co.uk&sort=5&min_price=0&max_price=501&page=2',
  },
  {
    scope: 'amazon.ca',
    marketplace: 'amazon.ca',
    country: 'CA',
    url: 'https://yeahpromos.com/index/offer/products?is_delete=0&site_id=11767&join_status=2&market_place=amazon.ca&sort=5&min_price=0&max_price=501&page=2',
  },
  {
    scope: 'amazon.de',
    marketplace: 'amazon.de',
    country: 'DE',
    url: 'https://yeahpromos.com/index/offer/products?is_delete=0&site_id=11767&join_status=2&market_place=amazon.de&sort=5&min_price=0&max_price=501&page=2',
  },
  {
    scope: 'amazon.fr',
    marketplace: 'amazon.fr',
    country: 'FR',
    url: 'https://yeahpromos.com/index/offer/products?is_delete=0&site_id=11767&join_status=2&market_place=amazon.fr&sort=5&min_price=0&max_price=501&page=2',
  },
]

export function normalizeYeahPromosResultCode(code: unknown): number | null {
  if (code === null || code === undefined || code === '') {
    return null
  }

  const parsed = Number(code)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

export function normalizePartnerboostStatusCode(code: unknown): number | null {
  if (code === null || code === undefined || code === '') {
    return null
  }

  const parsed = Number(code)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

function normalizePartnerboostProductsList(value: unknown): PartnerboostProduct[] {
  if (Array.isArray(value)) {
    return value
  }

  if (value && typeof value === 'object') {
    const candidates = Object.values(value as Record<string, unknown>)
    return candidates.filter((item) => item && typeof item === 'object') as PartnerboostProduct[]
  }

  return []
}

function normalizePartnerboostDtcProductsList(value: unknown): PartnerboostDtcProduct[] {
  if (Array.isArray(value)) {
    return value
  }

  if (value && typeof value === 'object') {
    const candidates = Object.values(value as Record<string, unknown>)
    return candidates.filter((item) => item && typeof item === 'object') as PartnerboostDtcProduct[]
  }

  return []
}

function normalizeBoolFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value > 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === '1' || normalized === 'true' || normalized === 'yes'
  }
  return false
}

function parseBooleanSetting(value: string | null | undefined, fallback: boolean): boolean {
  if (value === null || value === undefined) return fallback
  const normalized = String(value).trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  return fallback
}

export function extractPartnerboostProductsPayload(payload: PartnerboostProductsResponse): {
  products: PartnerboostProduct[]
  hasMore: boolean
} {
  const products = normalizePartnerboostProductsList(payload.data?.list)
  const hasMore = normalizeBoolFlag(payload.data?.has_more ?? payload.data?.hasMore)

  return {
    products,
    hasMore,
  }
}

export function extractPartnerboostDtcProductsPayload(input: {
  payload: PartnerboostDtcProductsResponse
  page: number
  pageSize: number
}): {
  products: PartnerboostDtcProduct[]
  hasMore: boolean
} {
  const products = normalizePartnerboostDtcProductsList(input.payload.data?.list)
  if (products.length === 0) {
    return {
      products,
      hasMore: false,
    }
  }

  const total = toNumber(input.payload.data?.total)
  if (total !== null) {
    return {
      products,
      hasMore: input.page * input.pageSize < total,
    }
  }

  return {
    products,
    hasMore: products.length >= input.pageSize,
  }
}

function parseInteger(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
}

function parseIntegerInRange(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = parseInteger(value, fallback)
  return Math.max(min, Math.min(parsed, max))
}

function resolveSyncMaxPages(
  requestedMaxPages: number | undefined,
  fallbackMaxPages: number | null,
  maxAllowedPages: number
): number | null {
  const candidates: Array<number | null | undefined> = [requestedMaxPages, fallbackMaxPages]
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue
    const parsed = Math.trunc(Number(candidate))
    if (!Number.isFinite(parsed) || parsed <= 0) continue
    return Math.min(parsed, maxAllowedPages)
  }
  return null
}

function sleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomIntInRange(min: number, max: number): number {
  const normalizedMin = Math.trunc(Math.min(min, max))
  const normalizedMax = Math.trunc(Math.max(min, max))
  if (normalizedMax <= normalizedMin) return normalizedMin
  return normalizedMin + Math.floor(Math.random() * (normalizedMax - normalizedMin + 1))
}

function calculateExponentialBackoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  if (attempt <= 0) return 0
  const delay = baseDelayMs * Math.pow(2, attempt - 1)
  return Math.min(delay, maxDelayMs)
}

function parseHttpStatusFromErrorMessage(message: string): number | undefined {
  const statusMatch = message.match(/\((\d{3})\):/)
  if (!statusMatch) return undefined
  const status = Number(statusMatch[1])
  return Number.isFinite(status) ? status : undefined
}

function isTransientHttpStatus(responseStatus?: number): boolean {
  const status = Number(responseStatus)
  if (!Number.isFinite(status)) return false

  // 408 Request Timeout - 可重试
  if (status === 408) return true

  // 5xx 服务端错误 - 可重试
  if (status >= 500 && status <= 599) return true

  // 4xx 客户端错误 - 不可重试
  // 特别是 407 Proxy Authentication Required（代理认证失败）
  // 401 Unauthorized, 403 Forbidden, 404 Not Found 等都不应重试
  return false
}

function isTransientNetworkErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase()

  // ❌ 代理认证错误 - 不可重试（配额用完或凭证失效）
  if (normalized.includes('407') || normalized.includes('proxy authentication required')) {
    return false
  }

  // ❌ 代理配额/余额错误 - 不可重试
  if (
    normalized.includes('business abnormality') ||
    normalized.includes('account abnormal') ||
    normalized.includes('insufficient balance') ||
    normalized.includes('no credit') ||
    normalized.includes('quota exceeded') ||
    normalized.includes('配额') ||
    normalized.includes('余额不足')
  ) {
    return false
  }

  // ✅ 临时网络错误 - 可重试
  return normalized.includes('fetch failed')
    || normalized.includes('network error')
    || normalized.includes('socket hang up')
    || normalized.includes('econnreset')
    || normalized.includes('etimedout')
    || normalized.includes('eai_again')
    || normalized.includes('enotfound')
    || normalized.includes('econnrefused')
    || normalized.includes('und_err_connect_timeout')
    || normalized.includes('bad gateway')
    || normalized.includes('gateway timeout')
}

function isJsonParseErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('unexpected end of json input')
    || normalized.includes('is not valid json')
    || normalized.includes('json parse')
    || (normalized.includes('unexpected token') && normalized.includes('json'))
}

/**
 * 检测代理相关的致命错误（不应重试）
 * 包括：407认证失败、配额用完、账户异常等
 */
function isProxyFatalError(error: unknown): boolean {
  if (!error) return false

  const message = String((error as any)?.message || '')
  const normalized = message.toLowerCase()

  // 407 Proxy Authentication Required
  if (normalized.includes('407') || normalized.includes('proxy authentication required')) {
    return true
  }

  // IPRocket 业务异常
  if (
    normalized.includes('business abnormality') ||
    normalized.includes('account abnormal') ||
    normalized.includes('risk control') ||
    normalized.includes('contact customer service')
  ) {
    return true
  }

  // 代理配额/余额不足
  if (
    normalized.includes('insufficient balance') ||
    normalized.includes('no credit') ||
    normalized.includes('quota exceeded') ||
    normalized.includes('配额用完') ||
    normalized.includes('余额不足')
  ) {
    return true
  }

  return false
}

function isPartnerboostRateLimited(payloadStatusCode: number | null, payloadStatusMessage: string, responseStatus?: number): boolean {
  if (responseStatus === 429) return true
  if (payloadStatusCode === 1002) return true

  const normalizedMessage = payloadStatusMessage.toLowerCase()
  return normalizedMessage.includes('too many request')
    || normalizedMessage.includes('rate limit')
}

function isPartnerboostRateLimitError(error: unknown): boolean {
  const raw = error as {
    message?: string
    status?: {
      code?: number | string
      msg?: string
    }
  }
  const message = String(raw?.message || '')
  const responseStatus = parseHttpStatusFromErrorMessage(message)
  const payloadStatusCode = normalizePartnerboostStatusCode(raw?.status?.code)
  const payloadStatusMessage = String(raw?.status?.msg || message)

  if (isPartnerboostRateLimited(payloadStatusCode, payloadStatusMessage, responseStatus)) {
    return true
  }

  const normalizedMessage = message.toLowerCase()
  return normalizedMessage.includes('"code":1002')
    || normalizedMessage.includes('code:1002')
}

function isPartnerboostTransientError(error: unknown): boolean {
  if (!error) return false

  // ❌ 代理致命错误 - 不可重试
  if (isProxyFatalError(error)) return false

  const raw = error as {
    message?: string
    status?: {
      code?: number | string
      msg?: string
    }
  }

  const message = String(raw?.message || '')
  const responseStatus = parseHttpStatusFromErrorMessage(message)
  if (isTransientHttpStatus(responseStatus)) return true

  const payloadStatusCode = normalizePartnerboostStatusCode(raw?.status?.code)
  if (payloadStatusCode !== null && payloadStatusCode >= 500) return true

  const payloadStatusMessage = String(raw?.status?.msg || message)
  return isTransientNetworkErrorMessage(payloadStatusMessage)
}

function isYeahPromosRequestTooFastMessage(message: string): boolean {
  const normalizedMessage = message.toLowerCase()
  return normalizedMessage.includes('request too fast')
    || normalizedMessage.includes('request too frequent')
    || normalizedMessage.includes('please request later')
    || normalizedMessage.includes('too frequent')
    || normalizedMessage.includes('请求过于频繁')
    || normalizedMessage.includes('请求太快')
    || normalizedMessage.includes('请稍后再试')
}

function isYeahPromosRateLimited(code: number | null, message: string, responseStatus?: number): boolean {
  if (responseStatus === 429) return true

  if (code !== null) {
    if (code === 429 || code === 100429 || code === 200429) return true
  }

  if (isYeahPromosRequestTooFastMessage(message)) return true

  const normalizedMessage = message.toLowerCase()
  return normalizedMessage.includes('too many request')
    || normalizedMessage.includes('rate limit')
    || normalizedMessage.includes('too many requests')
}

function isYeahPromosTransientError(error: unknown): boolean {
  if (!error) return false

  // ❌ 代理致命错误 - 不可重试
  if (isProxyFatalError(error)) return false

  const raw = error as {
    message?: string
    status?: {
      code?: number | string
      msg?: string
    }
  }

  const message = String(raw?.message || '')
  const responseStatus = parseHttpStatusFromErrorMessage(message)
  if (isTransientHttpStatus(responseStatus)) return true

  const payloadStatusCode = normalizeYeahPromosResultCode(raw?.status?.code)
  if (payloadStatusCode !== null && payloadStatusCode >= 500) return true

  if (isTransientNetworkErrorMessage(message)) return true

  return isJsonParseErrorMessage(message)
}

function parseReviewCount(value: unknown): number | null {
  if (value === null || value === undefined) return null

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return Math.max(0, Math.trunc(value))
  }

  const raw = String(value).trim()
  if (!raw) return null

  const compact = raw.toLowerCase().replace(/[，,\s]/g, '')
  const shortMatch = compact.match(/^(\d+(?:\.\d+)?)([kmb])$/i)
  if (shortMatch) {
    const base = Number(shortMatch[1])
    const unit = shortMatch[2].toLowerCase()
    const multiplier = unit === 'k' ? 1000 : unit === 'm' ? 1000000 : 1000000000
    if (Number.isFinite(base)) {
      return Math.max(0, Math.trunc(base * multiplier))
    }
  }

  const numeric = compact.replace(/[^0-9]/g, '')
  if (!numeric) return null

  const parsed = Number(numeric)
  if (!Number.isFinite(parsed)) return null

  return Math.max(0, Math.trunc(parsed))
}

function parseCsvValues(value: string): string[] {
  return value
    .split(/[\n,;\s]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeAsin(value: unknown): string | null {
  const normalized = String(value || '').trim().toUpperCase()
  return normalized || null
}

function normalizeBrand(value: unknown): string | null {
  const text = String(value || '').trim()
  if (!text) return null
  return text.toLowerCase()
}

function isPartnerboostShortLink(value: string | null): boolean {
  if (!value) return false

  try {
    const parsed = new URL(value)
    const hostname = parsed.hostname.toLowerCase()
    return hostname === 'pboost.me' || hostname.endsWith('.pboost.me')
  } catch {
    return /:\/\/(?:www\.)?pboost\.me\//i.test(value)
  }
}

export function resolvePartnerboostPromoLinks(input: {
  productIdLink?: string | null
  asinLink?: string | null
  asinPartnerboostLink?: string | null
}): {
  promoLink: string | null
  shortPromoLink: string | null
} {
  const productIdLink = normalizeUrl(input.productIdLink)
  const shortPromoLink = normalizeUrl(input.asinPartnerboostLink)
    || (isPartnerboostShortLink(productIdLink) ? productIdLink : null)
  const promoLink = shortPromoLink
    || normalizeUrl(input.asinLink)
    || productIdLink
    || null

  return {
    promoLink,
    shortPromoLink,
  }
}

export function resolvePartnerboostCountryCode(value: unknown, fallback: unknown = DEFAULT_PB_COUNTRY_CODE): string {
  const primary = normalizeCountryCode(String(value || ''))
  if (primary) return primary

  const backup = normalizeCountryCode(String(fallback || ''))
  if (backup) return backup

  return DEFAULT_PB_COUNTRY_CODE
}

function resolvePartnerboostFullSyncCountrySequence(): string[] {
  const deduped: string[] = []
  const seen = new Set<string>()

  for (const country of DEFAULT_PB_FULL_SYNC_COUNTRY_SEQUENCE) {
    const normalized = normalizeCountryCode(country)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    deduped.push(normalized)
  }

  if (deduped.length === 0) {
    return [DEFAULT_PB_COUNTRY_CODE]
  }

  return deduped
}

function assertPartnerboostAsinRequestLimit(asins: string[]): void {
  if (asins.length <= MAX_PB_ASINS_PER_REQUEST) return
  throw new Error(
    `PartnerBoost 商品拉取失败: The asins parameter can contain a maximum of ${MAX_PB_ASINS_PER_REQUEST} elements`
  )
}

function normalizeYeahPromosMerchants(value: unknown): YeahPromosMerchant[] {
  if (Array.isArray(value)) {
    return value
  }

  if (value && typeof value === 'object') {
    const candidates = Object.values(value as Record<string, unknown>)
    return candidates.filter((item) => item && typeof item === 'object') as YeahPromosMerchant[]
  }

  return []
}

function normalizeYeahPromosTransactions(value: unknown): YeahPromosTransaction[] {
  if (Array.isArray(value)) {
    return value
  }

  if (value && typeof value === 'object') {
    const candidates = Object.values(value as Record<string, unknown>)
    return candidates.filter((item) => item && typeof item === 'object') as YeahPromosTransaction[]
  }

  return []
}

export function extractYeahPromosPayload(payload: YeahPromosResponse): {
  merchants: YeahPromosMerchant[]
  pageTotal: number | null
  pageNow: number | null
} {
  const nested = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as YeahPromosResponseData
    : null

  const merchants = normalizeYeahPromosMerchants(
    payload.Data
    ?? (Array.isArray(payload.data) ? payload.data : undefined)
    ?? nested?.Data
    ?? nested?.data
  )

  const pageTotal = toNumber(payload.PageTotal ?? payload.pageTotal ?? nested?.PageTotal ?? nested?.pageTotal)
  const pageNow = toNumber(payload.PageNow ?? payload.pageNow ?? nested?.PageNow ?? nested?.pageNow)

  return {
    merchants,
    pageTotal,
    pageNow,
  }
}

export function extractYeahPromosTransactionsPayload(payload: YeahPromosTransactionsResponse): {
  transactions: YeahPromosTransaction[]
  pageTotal: number | null
  pageNow: number | null
} {
  const nested = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as YeahPromosTransactionsResponseData
    : null

  const transactions = normalizeYeahPromosTransactions(
    payload.Data
    ?? (Array.isArray(payload.data) ? payload.data : undefined)
    ?? nested?.Data
    ?? nested?.data
  )

  const pageTotal = toNumber(payload.PageTotal ?? payload.pageTotal ?? nested?.PageTotal ?? nested?.pageTotal)
  const pageNow = toNumber(payload.PageNow ?? payload.pageNow ?? nested?.PageNow ?? nested?.pageNow)

  return {
    transactions,
    pageTotal,
    pageNow,
  }
}

function normalizeUrl(value?: string | null): string | null {
  if (!value) return null
  const trimmed = String(value).trim()
  return trimmed || null
}

function extractAsinFromUrlLike(value: unknown): string | null {
  const raw = normalizeUrl(typeof value === 'string' ? value : String(value || ''))
  if (!raw) return null

  const candidates = [raw]
  if (/%[0-9A-Fa-f]{2}/.test(raw)) {
    try {
      const decoded = decodeURIComponent(raw)
      if (decoded && decoded !== raw) {
        candidates.push(decoded)
      }
    } catch {
      // ignore malformed percent-encoding
    }
  }

  const patterns = [
    /\/dp\/([A-Za-z0-9]{10})(?=[/?#&]|$)/i,
    /\/gp\/product\/([A-Za-z0-9]{10})(?=[/?#&]|$)/i,
    /[?&#]asin=([A-Za-z0-9]{10})(?=[&#]|$)/i,
  ]

  for (const candidate of candidates) {
    for (const pattern of patterns) {
      const matched = candidate.match(pattern)
      if (!matched?.[1]) continue
      const asin = normalizeAsin(matched[1])
      if (asin) return asin
    }
  }

  return null
}

function extractPartnerboostLinkId(value: unknown): string | null {
  const raw = normalizeUrl(typeof value === 'string' ? value : String(value || ''))
  if (!raw) return null

  const candidates = [raw]
  if (/%[0-9A-Fa-f]{2}/.test(raw)) {
    try {
      const decoded = decodeURIComponent(raw)
      if (decoded && decoded !== raw) {
        candidates.push(decoded)
      }
    } catch {
      // ignore malformed percent-encoding
    }
  }

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate)
      const key = Array.from(url.searchParams.keys())
        .find((item) => item.toLowerCase() === 'aa_adgroupid')
      if (key) {
        const value = normalizeUrl(url.searchParams.get(key))
        if (value) return value
      }
    } catch {
      // ignore invalid url
    }

    const matched = candidate.match(/[?&#]aa_adgroupid=([^&#]+)/i)
    if (matched?.[1]) {
      const value = normalizeUrl(matched[1])
      if (value) return value
    }
  }

  return null
}

function buildComparableUrlTokens(value: unknown): string[] {
  const raw = normalizeUrl(typeof value === 'string' ? value : String(value || ''))
  if (!raw) return []

  const queue: string[] = [raw]
  const seen = new Set<string>()
  const tokens: string[] = []

  while (queue.length > 0) {
    const current = queue.shift() as string
    const normalizedCurrent = normalizeUrl(current)
    if (!normalizedCurrent || seen.has(normalizedCurrent)) continue

    seen.add(normalizedCurrent)
    tokens.push(normalizedCurrent)

    if (/%[0-9A-Fa-f]{2}/.test(normalizedCurrent)) {
      try {
        const decoded = decodeURIComponent(normalizedCurrent)
        const normalizedDecoded = normalizeUrl(decoded)
        if (normalizedDecoded && !seen.has(normalizedDecoded)) {
          queue.push(normalizedDecoded)
        }
      } catch {
        // ignore malformed percent-encoding
      }
    }

    try {
      const parsed = new URL(normalizedCurrent)
      const protocol = parsed.protocol.toLowerCase()
      const hostname = parsed.hostname.toLowerCase()
      const pathname = parsed.pathname ? parsed.pathname.replace(/\/+$/, '') : ''
      const normalizedPathname = pathname || '/'

      const queryEntries = Array.from(parsed.searchParams.entries())
      queryEntries.sort((a, b) => {
        if (a[0] === b[0]) return a[1].localeCompare(b[1])
        return a[0].localeCompare(b[0])
      })
      const sortedParams = new URLSearchParams()
      for (const [key, val] of queryEntries) {
        sortedParams.append(key, val)
      }
      const sortedQuery = sortedParams.toString()
      const canonical = `${protocol}//${hostname}${normalizedPathname}${sortedQuery ? `?${sortedQuery}` : ''}`
      if (!seen.has(canonical)) {
        queue.push(canonical)
      }
    } catch {
      // ignore invalid url
    }
  }

  return tokens
}

function dedupePositiveIds(ids: number[]): number[] {
  const result: number[] = []
  const seen = new Set<number>()
  for (const raw of ids) {
    const id = Number(raw)
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

function resolveOfferProductBackfillDecision(params: {
  exactUrlProductIds: number[]
  linkIdProductIds: number[]
  asinProductIds: number[]
  brandProductIds: number[]
}): {
  productId: number | null
  reason: OfferProductBackfillDecisionReason
  exactUrlProductIds: number[]
  linkIdProductIds: number[]
  asinProductIds: number[]
  brandProductIds: number[]
} {
  const exactUrlProductIds = dedupePositiveIds(params.exactUrlProductIds)
  const linkIdProductIds = dedupePositiveIds(params.linkIdProductIds)
  const asinProductIds = dedupePositiveIds(params.asinProductIds)
  const brandProductIds = dedupePositiveIds(params.brandProductIds)

  if (exactUrlProductIds.length === 1) {
    return {
      productId: exactUrlProductIds[0],
      reason: 'exact_url',
      exactUrlProductIds,
      linkIdProductIds,
      asinProductIds,
      brandProductIds,
    }
  }

  if (exactUrlProductIds.length > 1) {
    return {
      productId: null,
      reason: 'ambiguous_exact_url',
      exactUrlProductIds,
      linkIdProductIds,
      asinProductIds,
      brandProductIds,
    }
  }

  if (linkIdProductIds.length > 0 && asinProductIds.length > 0) {
    const asinSet = new Set(asinProductIds)
    const intersection = linkIdProductIds.filter((productId) => asinSet.has(productId))
    if (intersection.length === 1) {
      return {
        productId: intersection[0],
        reason: 'link_id_asin_intersection',
        exactUrlProductIds,
        linkIdProductIds,
        asinProductIds,
        brandProductIds,
      }
    }

    if (intersection.length > 1) {
      return {
        productId: null,
        reason: 'ambiguous_link_id_asin_intersection',
        exactUrlProductIds,
        linkIdProductIds,
        asinProductIds,
        brandProductIds,
      }
    }

    return {
      productId: null,
      reason: 'conflicting_link_id_asin',
      exactUrlProductIds,
      linkIdProductIds,
      asinProductIds,
      brandProductIds,
    }
  }

  if (linkIdProductIds.length === 1) {
    return {
      productId: linkIdProductIds[0],
      reason: 'link_id',
      exactUrlProductIds,
      linkIdProductIds,
      asinProductIds,
      brandProductIds,
    }
  }

  if (linkIdProductIds.length > 1) {
    return {
      productId: null,
      reason: 'ambiguous_link_id',
      exactUrlProductIds,
      linkIdProductIds,
      asinProductIds,
      brandProductIds,
    }
  }

  if (asinProductIds.length === 1) {
    return {
      productId: asinProductIds[0],
      reason: 'asin',
      exactUrlProductIds,
      linkIdProductIds,
      asinProductIds,
      brandProductIds,
    }
  }

  if (asinProductIds.length > 1) {
    return {
      productId: null,
      reason: 'ambiguous_asin',
      exactUrlProductIds,
      linkIdProductIds,
      asinProductIds,
      brandProductIds,
    }
  }

  // Brand matching as fallback
  if (brandProductIds.length === 1) {
    return {
      productId: brandProductIds[0],
      reason: 'brand',
      exactUrlProductIds,
      linkIdProductIds,
      asinProductIds,
      brandProductIds,
    }
  }

  if (brandProductIds.length > 1) {
    return {
      productId: null,
      reason: 'ambiguous_brand',
      exactUrlProductIds,
      linkIdProductIds,
      asinProductIds,
      brandProductIds,
    }
  }

  return {
    productId: null,
    reason: 'no_match',
    exactUrlProductIds,
    linkIdProductIds,
    asinProductIds,
    brandProductIds,
  }
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parsePercentage(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    if (value >= 0 && value <= 1) return value * 100
    return value
  }

  const raw = String(value).trim()
  if (!raw) return null
  const normalized = raw.replace('%', '')
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  if (raw.includes('%')) return parsed
  if (parsed >= 0 && parsed <= 1) return parsed * 100
  return parsed
}

function parsePriceAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null

  const raw = String(value).trim()
  if (!raw) return null
  const numeric = raw.replace(/[^0-9.-]+/g, '')
  if (!numeric) return null
  const parsed = Number(numeric)
  return Number.isFinite(parsed) ? parsed : null
}

function hasCurrencySymbol(value: string): boolean {
  return /[$€£¥₴₽₩₹]/.test(value)
}

function looksLikeCurrencyUnit(value: string): boolean {
  const raw = value.trim()
  if (!raw) return false
  if (raw.includes('%')) return false
  if (hasCurrencySymbol(raw)) return true

  const upper = raw.toUpperCase()
  if (/^[A-Z]{3}$/.test(upper)) return true
  return false
}

function normalizeCurrencyUnit(value: unknown): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  if (/^[A-Za-z]{3}$/.test(raw)) {
    return raw.toUpperCase()
  }

  // 只接受纯货币符号（不含数字），拒绝 "$49.99" 这类价格字符串误存为货币单位的脏数据
  if (hasCurrencySymbol(raw) && !/\d/.test(raw)) {
    return raw
  }

  return null
}

function extractCurrencyUnitFromText(value: unknown): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  const symbolMatch = raw.match(/[$€£¥₴₽₩₹]/)
  if (symbolMatch) {
    return symbolMatch[0]
  }

  const codeMatch = raw.match(/\b([A-Za-z]{3})\b/)
  if (codeMatch) {
    return codeMatch[1].toUpperCase()
  }

  return null
}

function parsePartnerboostCommission(value: unknown, fallbackCurrency: string | null): {
  mode: 'percent' | 'amount'
  rate: number | null
  amount: number | null
  currency: string | null
} {
  const raw = String(value || '').trim()
  if (!raw) {
    return {
      mode: 'percent',
      rate: null,
      amount: null,
      currency: fallbackCurrency,
    }
  }

  if (raw.includes('%')) {
    return {
      mode: 'percent',
      rate: parsePercentage(value),
      amount: null,
      currency: fallbackCurrency,
    }
  }

  const extractedCurrency = extractCurrencyUnitFromText(raw)
  if (extractedCurrency) {
    return {
      mode: 'amount',
      rate: null,
      amount: parsePriceAmount(value),
      currency: extractedCurrency,
    }
  }

  return {
    mode: 'percent',
    rate: parsePercentage(value),
    amount: null,
    currency: fallbackCurrency,
  }
}

export function parseYeahPromosMerchantCommission(avgPayout: unknown, payoutUnit: unknown): ParsedYeahPromosCommission {
  const avgText = String(avgPayout || '').trim()
  const unitText = String(payoutUnit || '').trim()

  const isRate = avgText.includes('%') || unitText.includes('%')
  if (isRate) {
    return {
      mode: 'rate',
      rate: parsePercentage(avgPayout),
      amount: null,
    }
  }

  const isAmount = hasCurrencySymbol(avgText) || looksLikeCurrencyUnit(unitText)
  if (isAmount) {
    return {
      mode: 'amount',
      rate: null,
      amount: parsePriceAmount(avgPayout),
    }
  }

  return {
    mode: 'rate',
    rate: parsePercentage(avgPayout),
    amount: null,
  }
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

function computeCommissionAmount(priceAmount: number | null, commissionRate: number | null): number | null {
  if (priceAmount === null || commissionRate === null) return null
  return roundTo2(priceAmount * (commissionRate / 100))
}

function normalizeCountryCode(value: string): string | null {
  const code = value.trim().toUpperCase()
  if (!code) return null
  if (code.length === 2 || code.length === 3) return code
  return code
}

function normalizeProductTargetCountryFilter(value: unknown): string | null {
  const normalized = normalizeCountryCode(String(value || ''))
  if (!normalized || normalized === 'ALL') return null
  if (!/^[A-Z]{2,3}$/.test(normalized)) return null
  return normalized
}

function resolveProductCountryFilterCandidates(value: unknown): string[] {
  const normalized = normalizeProductTargetCountryFilter(value)
  if (!normalized) return []

  const deduped = new Set<string>([normalized])
  for (const alias of PRODUCT_COUNTRY_FILTER_ALIAS_MAP[normalized] || []) {
    const aliasCode = normalizeCountryCode(alias)
    if (!aliasCode) continue
    deduped.add(aliasCode)
  }

  return Array.from(deduped)
}

function normalizeCountries(input: unknown): string[] {
  if (!input) return []

  const fromArray = (arr: unknown[]): string[] => {
    const deduped = new Set<string>()
    for (const value of arr) {
      if (value === null || value === undefined) continue
      const code = normalizeCountryCode(String(value))
      if (code) deduped.add(code)
    }
    return Array.from(deduped)
  }

  if (Array.isArray(input)) {
    return fromArray(input)
  }

  const text = String(input).trim()
  if (!text) return []
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) {
        return fromArray(parsed)
      }
    } catch {
      // ignore
    }
  }

  return fromArray(text.split(/[;,|/\s]+/g).filter(Boolean))
}

function normalizeProxyCountryCode(value: string): string | null {
  const normalized = normalizeCountryCode(value)
  if (!normalized) return null
  return YP_PROXY_COUNTRY_ALIAS[normalized] || normalized
}

function resolveProxyCountryCandidates(country: string): string[] {
  const normalized = normalizeProxyCountryCode(country)
  if (!normalized) return []
  const candidates = new Set<string>([normalized])
  for (const [alias, canonical] of Object.entries(YP_PROXY_COUNTRY_ALIAS)) {
    if (canonical === normalized) {
      candidates.add(alias)
    }
  }
  return Array.from(candidates)
}

function normalizeYeahPromosMarketplace(value: unknown): string | null {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return null
  if (!text.startsWith('amazon.')) return null
  return text
}

function resolveYeahPromosMarketplaceCountry(marketplace: string | null): string | null {
  if (!marketplace) return null
  return YP_MARKETPLACE_COUNTRY_MAP[marketplace] || null
}

function normalizeYeahPromosMarketplaceTemplateEntry(value: unknown): YeahPromosMarketplaceTemplate | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const rawUrl = normalizeUrl(
    String(
      record.url
      ?? record.template_url
      ?? record.templateUrl
      ?? ''
    )
  )
  if (!rawUrl) return null

  let parsedUrl: URL
  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    return null
  }

  if (!/^https?:$/i.test(parsedUrl.protocol)) return null
  if (!/yeahpromos\.com$/i.test(parsedUrl.hostname)) return null
  if (parsedUrl.pathname !== '/index/offer/products') return null

  const marketplaceFromUrl = normalizeYeahPromosMarketplace(parsedUrl.searchParams.get('market_place') || '')
  const marketplace = normalizeYeahPromosMarketplace(
    record.marketplace
    ?? record.market_place
    ?? record.marketPlace
    ?? marketplaceFromUrl
    ?? ''
  )
  if (!marketplace) return null

  const country = normalizeProxyCountryCode(String(
    record.country
    ?? record.country_code
    ?? record.countryCode
    ?? resolveYeahPromosMarketplaceCountry(marketplace)
    ?? ''
  ))
  if (!country) return null

  if (!parsedUrl.searchParams.has('page')) {
    parsedUrl.searchParams.set('page', '1')
  }

  const scope = normalizeYeahPromosMarketplace(
    String(record.scope ?? marketplace)
  ) || marketplace

  return {
    scope,
    marketplace,
    country,
    url: parsedUrl.toString(),
  }
}

function cloneDefaultYeahPromosMarketplaceTemplates(): YeahPromosMarketplaceTemplate[] {
  return DEFAULT_YP_MARKETPLACE_TEMPLATES.map((item) => ({ ...item }))
}

function buildYeahPromosDeltaScopePlan(params: {
  templates: YeahPromosMarketplaceTemplate[]
  activeScopes: string[]
  maxPages: number
}): YeahPromosDeltaScopePlan {
  const orderedTemplates = params.templates.filter((template, index, arr) =>
    arr.findIndex((item) => item.scope === template.scope) === index
  )
  if (orderedTemplates.length === 0) {
    return {
      templates: [],
      scopePageBudgets: {},
    }
  }

  const normalizedMaxPages = Math.max(1, Math.trunc(params.maxPages))
  const templateByScope = new Map(orderedTemplates.map((template) => [template.scope, template] as const))
  const normalizedActiveScopes = params.activeScopes
    .map((scope) => normalizeYeahPromosMarketplace(scope))
    .filter((scope): scope is string => Boolean(scope))
  const priorityTemplates = Array.from(new Set(normalizedActiveScopes))
    .map((scope) => templateByScope.get(scope) || null)
    .filter((template): template is YeahPromosMarketplaceTemplate => Boolean(template))
  const priorityScopeSet = new Set(priorityTemplates.map((template) => template.scope))
  const fallbackTemplates = orderedTemplates.filter((template) => !priorityScopeSet.has(template.scope))
  const scopeBudgets = new Map<string, number>()
  let remainingPages = normalizedMaxPages

  const allocatePages = (templates: YeahPromosMarketplaceTemplate[], maxPagesPerScope: number): void => {
    if (templates.length === 0 || remainingPages <= 0) return

    let madeProgress = true
    while (remainingPages > 0 && madeProgress) {
      madeProgress = false
      for (const template of templates) {
        if (remainingPages <= 0) break
        const currentBudget = scopeBudgets.get(template.scope) || 0
        if (currentBudget >= maxPagesPerScope) {
          continue
        }
        scopeBudgets.set(template.scope, currentBudget + 1)
        remainingPages -= 1
        madeProgress = true
      }
    }
  }

  if (priorityTemplates.length > 0) {
    allocatePages(priorityTemplates, 1)
    allocatePages(priorityTemplates, DEFAULT_YP_DELTA_PRIORITY_PAGE_CAP)
  }
  allocatePages(fallbackTemplates, 1)

  const allTemplates = [...priorityTemplates, ...fallbackTemplates]
  allocatePages(allTemplates, Number.MAX_SAFE_INTEGER)

  const plannedTemplates = allTemplates.filter((template) => (scopeBudgets.get(template.scope) || 0) > 0)

  return {
    templates: plannedTemplates,
    scopePageBudgets: Object.fromEntries(scopeBudgets.entries()),
  }
}

function resolveYeahPromosMarketplaceTemplates(rawValue: string | null | undefined): YeahPromosMarketplaceTemplate[] {
  const raw = String(rawValue || '').trim()
  if (!raw) return cloneDefaultYeahPromosMarketplaceTemplates()

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return cloneDefaultYeahPromosMarketplaceTemplates()
    }

    const items: YeahPromosMarketplaceTemplate[] = []
    const seenScopes = new Set<string>()
    for (const candidate of parsed) {
      const normalized = normalizeYeahPromosMarketplaceTemplateEntry(candidate)
      if (!normalized) continue
      if (seenScopes.has(normalized.scope)) continue
      seenScopes.add(normalized.scope)
      items.push(normalized)
    }

    return items.length > 0
      ? items
      : cloneDefaultYeahPromosMarketplaceTemplates()
  } catch {
    return cloneDefaultYeahPromosMarketplaceTemplates()
  }
}

function buildYeahPromosProductsPageUrl(templateUrl: string, page: number): string {
  const url = new URL(templateUrl)
  url.searchParams.set('page', String(Math.max(1, Math.trunc(page))))
  return url.toString()
}

function applyYeahPromosTemplateSiteId(
  templates: YeahPromosMarketplaceTemplate[],
  siteId: string | null | undefined
): YeahPromosMarketplaceTemplate[] {
  const normalizedSiteId = String(siteId || '').trim()
  if (!normalizedSiteId) {
    return templates.map((template) => ({ ...template }))
  }

  return templates.map((template) => {
    try {
      const url = new URL(template.url)
      url.searchParams.set('site_id', normalizedSiteId)
      return {
        ...template,
        url: normalizeUrl(url.toString()) || url.toString(),
      }
    } catch {
      return { ...template }
    }
  })
}

function parseYeahPromosProxyCountryUrlMap(rawValue: string | null | undefined): Map<string, string> {
  const map = new Map<string, string>()
  const raw = String(rawValue || '').trim()
  if (!raw) return map

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return map
    }

    for (const item of parsed as YeahPromosProxyConfigEntry[]) {
      const country = normalizeProxyCountryCode(String(item?.country || ''))
      const url = normalizeUrl(String(item?.url || ''))
      if (!country || !url) continue
      map.set(country, url)
    }
  } catch {
    return map
  }

  return map
}

function resolveYeahPromosProxyProviderUrl(countryProxyMap: Map<string, string>, country: string): string | null {
  const candidates = resolveProxyCountryCandidates(country)
  for (const candidate of candidates) {
    const matched = normalizeUrl(countryProxyMap.get(candidate) || '')
    if (matched) return matched
  }
  return null
}

function detectYeahPromosHttpIntercept(input: {
  status: number
  html: string
}): { blocked: boolean; reason: string | null } {
  const status = Number(input.status)
  const rawHtml = String(input.html || '')
  const html = rawHtml.toLowerCase()

  if (status === 403) return { blocked: true, reason: 'http_403' }
  if (status === 429) return { blocked: true, reason: 'http_429' }
  if (status >= 500 && status <= 599) return { blocked: true, reason: `http_${status}` }

  if (!rawHtml.trim()) {
    return { blocked: true, reason: 'empty_html' }
  }

  if (YP_DOM_INTERCEPT_KEYWORDS.some((keyword) => html.includes(keyword))) {
    return { blocked: true, reason: 'dom_keyword' }
  }

  const hasProductCards = html.includes('adv-content')
  const hasNoProductsHint = html.includes('no products found')
  const hasPageList = html.includes('id="pagelist"') || html.includes("id='pagelist'")
  if (!hasProductCards && !hasNoProductsHint && !hasPageList) {
    return { blocked: true, reason: 'dom_abnormal' }
  }

  return { blocked: false, reason: null }
}

function normalizeYmdDate(value: unknown): string | null {
  const text = String(value || '').trim()
  if (!text) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  return text
}

function formatYmdDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function parseAllowedCountries(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return normalizeCountries(parsed)
  } catch {
    return normalizeCountries(value)
  }
}

function normalizePlatformValue(value: unknown): AffiliatePlatform | null {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return null
  if (raw === 'yp' || raw === 'yeahpromos') return 'yeahpromos'
  if (raw === 'pb' || raw === 'partnerboost') return 'partnerboost'
  return null
}

export function normalizeAffiliateProductStatusFilter(value: unknown): AffiliateProductStatusFilter {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'active' || raw === 'invalid' || raw === 'sync_missing' || raw === 'unknown') {
    return raw
  }
  return 'all'
}

export function normalizeAffiliateLandingPageTypeFilter(
  value: unknown
): AffiliateLandingPageType | 'all' {
  const raw = String(value || '').trim().toLowerCase()
  if (
    raw === 'amazon_product'
    || raw === 'amazon_store'
    || raw === 'independent_product'
    || raw === 'independent_store'
    || raw === 'unknown'
  ) {
    return raw
  }
  return 'all'
}

function resolveAffiliateProductLifecycleStatus(value: unknown): AffiliateProductLifecycleStatus {
  if (value === 'active' || value === 'invalid' || value === 'sync_missing' || value === 'unknown') {
    return value
  }
  return 'unknown'
}

function normalizeTriStateBool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value > 0

  const raw = String(value).trim().toLowerCase()
  if (!raw) return null
  if (raw === '1' || raw === 'true' || raw === 'yes') return true
  if (raw === '0' || raw === 'false' || raw === 'no') return false
  return null
}

function normalizeCommissionRateMode(value: unknown): AffiliateCommissionRateMode | null {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return null
  if (raw === 'amount') return 'amount'
  if (raw === 'rate' || raw === 'percent' || raw === 'percentage') return 'percent'
  return null
}

const CONFIRMED_INVALID_STATUS_TOKENS = new Set<string>([
  'offline',
  'inactive',
  'disabled',
  'removed',
  'invalid',
  'out_of_stock',
  'sold_out',
  'unavailable',
])

const CONFIRMED_INVALID_STATUS_KEYWORDS = [
  'offline',
  'inactive',
  'disabled',
  'removed',
  'invalid',
  'out of stock',
  'out-of-stock',
  'sold out',
  'unavailable',
  '失效',
  '下架',
  '缺货',
  '无库存',
  '不可用',
]

function normalizeStatusToken(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function resolveConfirmedInvalidFromSignals(input: {
  advertStatus?: unknown
  status?: unknown
  availability?: unknown
  stockStatus?: unknown
  joinStatus?: unknown
  isAvailable?: unknown
  inStock?: unknown
  isOos?: unknown
}): boolean {
  const advertStatus = String(input.advertStatus ?? '').trim()
  if (advertStatus === '0') return true

  const statusTokens = [
    normalizeStatusToken(input.status),
    normalizeStatusToken(input.availability),
    normalizeStatusToken(input.stockStatus),
  ].filter(Boolean)

  if (statusTokens.some((token) => CONFIRMED_INVALID_STATUS_TOKENS.has(token))) {
    return true
  }

  const joinStatusText = String(input.joinStatus || '').trim().toLowerCase()
  if (joinStatusText) {
    if (CONFIRMED_INVALID_STATUS_KEYWORDS.some((keyword) => joinStatusText.includes(keyword))) {
      return true
    }
  }

  const isAvailable = normalizeTriStateBool(input.isAvailable)
  if (isAvailable === false) return true

  const inStock = normalizeTriStateBool(input.inStock)
  if (inStock === false) return true

  const isOos = normalizeTriStateBool(input.isOos)
  if (isOos === true) return true

  return false
}

export function detectAffiliateLandingPageType(params: {
  asin?: string | null
  productUrl?: string | null
  promoLink?: string | null
  shortPromoLink?: string | null
}): AffiliateLandingPageType {
  if (params.asin && String(params.asin).trim()) {
    return 'amazon_product'
  }

  const candidateUrls = [params.productUrl, params.shortPromoLink, params.promoLink]

  let parsedUrl: URL | null = null
  for (const value of candidateUrls) {
    const normalized = normalizeUrl(value)
    if (!normalized) continue
    try {
      parsedUrl = new URL(normalized)
      break
    } catch {
      continue
    }
  }

  if (!parsedUrl) return 'unknown'

  const hostname = parsedUrl.hostname.toLowerCase()
  const pathname = parsedUrl.pathname.toLowerCase()
  const isAmazonDomain = hostname.includes('amazon.')

  if (isAmazonDomain) {
    if (
      pathname.includes('/stores/')
      || pathname.includes('/store/')
      || pathname.includes('/storefront/')
    ) {
      return 'amazon_store'
    }

    if (pathname.includes('/dp/') || pathname.includes('/gp/product/')) {
      return 'amazon_product'
    }
  }

  const isIndependentProduct =
    pathname.includes('/products/')
    || pathname.includes('/product/')
    || pathname.includes('/p/')
    || pathname.includes('/item/')

  if (isIndependentProduct) {
    return 'independent_product'
  }

  const isIndependentStore =
    pathname === '/'
    || pathname === ''
    || pathname.includes('/collections')
    || pathname.includes('/shop')
    || pathname.includes('/store')

  if (isIndependentStore) {
    return 'independent_store'
  }

  return 'unknown'
}

export function normalizeAffiliatePlatform(value: unknown): AffiliatePlatform | null {
  return normalizePlatformValue(value)
}

function chooseOfferUrl(product: AffiliateProduct): string | null {
  const candidateUrls = [
    normalizeUrl(product.product_url),
    normalizeUrl(product.short_promo_link),
    normalizeUrl(product.promo_link),
    product.asin ? `https://www.amazon.com/dp/${product.asin}` : null,
  ]

  for (const url of candidateUrls) {
    if (!url) continue
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return url
      }
    } catch {
      continue
    }
  }

  return null
}

async function fetchPartnerboostShortPromoLinkByAsin(params: {
  userId: number
  asin: string
  targetCountry: string
}): Promise<string | null> {
  const shortLinks = await fetchPartnerboostShortPromoLinksByAsins({
    userId: params.userId,
    asins: [params.asin],
    targetCountry: params.targetCountry,
  })
  const targetAsin = normalizeAsin(params.asin)
  if (!targetAsin) return null
  return shortLinks.get(targetAsin) || null
}

async function fetchPartnerboostShortPromoLinksByAsins(params: {
  userId: number
  asins: string[]
  targetCountry: string
}): Promise<Map<string, string>> {
  const shortLinkByAsin = new Map<string, string>()
  const normalizedAsins = Array.from(new Set(
    (params.asins || [])
      .map((asin) => normalizeAsin(asin))
      .filter((asin): asin is string => Boolean(asin))
  ))
  if (normalizedAsins.length === 0) return shortLinkByAsin

  const check = await checkAffiliatePlatformConfig(params.userId, 'partnerboost')
  if (!check.configured) return shortLinkByAsin

  const token = (check.values.partnerboost_token || '').trim()
  if (!token) return shortLinkByAsin

  const baseUrl = (check.values.partnerboost_base_url || DEFAULT_PB_BASE_URL).replace(/\/+$/, '')
  const linkCountryCode = resolvePartnerboostCountryCode(check.values.partnerboost_link_country_code, params.targetCountry)
  const uid = check.values.partnerboost_link_uid || ''
  const returnPartnerboostLink = parseInteger(check.values.partnerboost_link_return_partnerboost_link || '1', 1)
  const rateLimitRetryOptions: PartnerboostRequestRateLimitOptions = {
    maxRetries: parseIntegerInRange(
      check.values.partnerboost_rate_limit_max_retries || String(DEFAULT_PB_RATE_LIMIT_MAX_RETRIES),
      DEFAULT_PB_RATE_LIMIT_MAX_RETRIES,
      0,
      10
    ),
    baseDelayMs: parseIntegerInRange(
      check.values.partnerboost_rate_limit_base_delay_ms || String(DEFAULT_PB_RATE_LIMIT_BASE_DELAY_MS),
      DEFAULT_PB_RATE_LIMIT_BASE_DELAY_MS,
      100,
      60000
    ),
    maxDelayMs: parseIntegerInRange(
      check.values.partnerboost_rate_limit_max_delay_ms || String(DEFAULT_PB_RATE_LIMIT_MAX_DELAY_MS),
      DEFAULT_PB_RATE_LIMIT_MAX_DELAY_MS,
      500,
      120000
    ),
  }

  for (let index = 0; index < normalizedAsins.length; index += MAX_PB_ASINS_PER_REQUEST) {
    const batchAsins = normalizedAsins.slice(index, index + MAX_PB_ASINS_PER_REQUEST)
    const payload = await fetchPartnerboostJsonWithRateLimitRetry<PartnerboostAsinLinkResponse>(
      `${baseUrl}/api/datafeed/get_amazon_link_by_asin`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          asins: batchAsins.join(','),
          country_code: linkCountryCode,
          uid,
          return_partnerboost_link: returnPartnerboostLink,
        }),
      },
      'PartnerBoost ASIN推广链接拉取失败',
      rateLimitRetryOptions
    )

    const statusCode = normalizePartnerboostStatusCode(payload.status?.code)
    if (statusCode === null) {
      throw new Error(`PartnerBoost ASIN推广链接拉取失败: Invalid status code ${String(payload.status?.code)}`)
    }
    if (statusCode !== 0) {
      throw new Error(`PartnerBoost ASIN推广链接拉取失败: ${payload.status?.msg || statusCode}`)
    }

    for (const item of payload.data || []) {
      const asinKey = normalizeAsin(item.asin)
      const shortLink = normalizeUrl(item.partnerboost_link)
      if (!asinKey || !shortLink) continue
      shortLinkByAsin.set(asinKey, shortLink)
    }
  }

  return shortLinkByAsin
}

async function resolveOfferAffiliateLinkForProduct(params: {
  db: DatabaseAdapter
  userId: number
  product: AffiliateProduct
  targetCountry: string
}): Promise<string | null> {
  const existingShort = normalizeUrl(params.product.short_promo_link)
  if (existingShort) return existingShort

  const existingPromo = normalizeUrl(params.product.promo_link)
  if (params.product.platform !== 'partnerboost') {
    return existingPromo
  }

  const asin = normalizeAsin(params.product.asin)
  if (!asin) {
    return existingPromo
  }

  try {
    const fetchedShort = await fetchPartnerboostShortPromoLinkByAsin({
      userId: params.userId,
      asin,
      targetCountry: params.targetCountry,
    })
    if (!fetchedShort) {
      return existingPromo
    }

    await params.db.exec(
      `
        UPDATE affiliate_products
        SET short_promo_link = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `,
      [fetchedShort, new Date().toISOString(), params.product.id, params.userId]
    )

    return fetchedShort
  } catch (error: any) {
    console.warn(
      `[affiliate-products] fallback to promo_link when fetching short link failed (productId=${params.product.id}, asin=${asin}): ${error?.message || error}`
    )
    return existingPromo
  }
}

async function hydratePartnerboostShortLinksForRows(params: {
  db: DatabaseAdapter
  userId: number
  rows: Array<AffiliateProduct>
}): Promise<void> {
  const candidates = params.rows.filter((row) => {
    if (row.platform !== 'partnerboost') return false
    if (normalizeUrl(row.short_promo_link)) return false
    return Boolean(normalizeAsin(row.asin))
  })
  if (candidates.length === 0) return

  const countryAsinsMap = new Map<string, Set<string>>()
  for (const row of candidates) {
    const asin = normalizeAsin(row.asin)
    if (!asin) continue
    const preferredCountry = parseAllowedCountries(row.allowed_countries_json)[0] || DEFAULT_PB_COUNTRY_CODE
    const country = resolvePartnerboostCountryCode(preferredCountry, DEFAULT_PB_COUNTRY_CODE)
    if (!countryAsinsMap.has(country)) {
      countryAsinsMap.set(country, new Set<string>())
    }
    countryAsinsMap.get(country)!.add(asin)
  }

  const shortByAsin = new Map<string, string>()
  for (const [country, asinSet] of countryAsinsMap.entries()) {
    const fetched = await fetchPartnerboostShortPromoLinksByAsins({
      userId: params.userId,
      asins: Array.from(asinSet),
      targetCountry: country,
    })

    for (const [asin, shortLink] of fetched.entries()) {
      if (!shortByAsin.has(asin)) {
        shortByAsin.set(asin, shortLink)
      }
    }
  }
  if (shortByAsin.size === 0) return

  const updates: Array<{ id: number; shortLink: string }> = []
  for (const row of candidates) {
    const asin = normalizeAsin(row.asin)
    if (!asin) continue
    const shortLink = shortByAsin.get(asin)
    if (!shortLink) continue
    row.short_promo_link = shortLink
    updates.push({
      id: Number(row.id),
      shortLink,
    })
  }
  if (updates.length === 0) return

  const nowIso = new Date().toISOString()
  for (const update of updates) {
    if (!Number.isFinite(update.id) || update.id <= 0) continue
    await params.db.exec(
      `
        UPDATE affiliate_products
        SET short_promo_link = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `,
      [update.shortLink, nowIso, update.id, params.userId]
    )
  }
}

function formatPriceForOffer(product: AffiliateProduct): string | undefined {
  if (product.price_amount === null || product.price_amount === undefined) return undefined
  if (product.price_currency) {
    return `${String(product.price_currency).toUpperCase()} ${product.price_amount}`
  }
  return `${product.price_amount}`
}

function formatCommissionForOffer(product: AffiliateProduct): string | undefined {
  if (product.commission_rate === null || product.commission_rate === undefined) return undefined
  return `${roundTo2(product.commission_rate)}%`
}

async function getUserScopedSettingMap(userId: number, keys: string[]): Promise<Record<string, string>> {
  const values = await Promise.all(
    keys.map(async (key) => {
      const category = resolveAffiliateSettingCategory(key)
      const record = await getUserOnlySetting(category, key, userId)
      return [key, (record?.value || '').trim()] as const
    })
  )

  return values.reduce<Record<string, string>>((acc, [key, value]) => {
    acc[key] = value
    return acc
  }, {})
}

async function upsertUserSystemSetting(params: {
  userId: number
  key: string
  value: string
  description: string
}): Promise<void> {
  const db = await getDatabase()
  const nowExpr = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const falseValue = db.type === 'postgres' ? false : 0

  const existing = await db.queryOne<{ id: number }>(
    `
      SELECT id
      FROM system_settings
      WHERE user_id = ?
        AND category = 'system'
        AND key = ?
      LIMIT 1
    `,
    [params.userId, params.key]
  )

  if (existing?.id) {
    await db.exec(
      `
        UPDATE system_settings
        SET value = ?, updated_at = ${nowExpr}
        WHERE id = ?
      `,
      [params.value, existing.id]
    )
    return
  }

  await db.exec(
    `
      INSERT INTO system_settings (
        user_id,
        category,
        key,
        value,
        data_type,
        is_sensitive,
        is_required,
        description
      ) VALUES (?, 'system', ?, ?, 'string', ?, ?, ?)
    `,
    [params.userId, params.key, params.value, falseValue, falseValue, params.description]
  )
}

export async function checkAffiliatePlatformConfig(userId: number, platform: AffiliatePlatform): Promise<PlatformConfigCheck> {
  const requiredKeys = PLATFORM_KEY_REQUIREMENTS[platform]
  const optionalKeys = platform === 'partnerboost'
    ? [
        'partnerboost_base_url',
        'partnerboost_products_page_size',
        'partnerboost_products_page',
        'partnerboost_products_default_filter',
        'partnerboost_products_country_code',
        'partnerboost_products_brand_id',
        'partnerboost_products_sort',
        'partnerboost_products_asins',
        'partnerboost_products_relationship',
        'partnerboost_products_is_original_currency',
        'partnerboost_products_has_promo_code',
        'partnerboost_products_has_acc',
        'partnerboost_products_filter_sexual_wellness',
        'partnerboost_products_link_batch_size',
        'partnerboost_asin_link_batch_size',
        'partnerboost_request_delay_ms',
        'partnerboost_rate_limit_max_retries',
        'partnerboost_rate_limit_base_delay_ms',
        'partnerboost_rate_limit_max_delay_ms',
        'partnerboost_link_country_code',
        'partnerboost_link_uid',
        'partnerboost_link_return_partnerboost_link',
      ]
    : [
        'yeahpromos_start_date',
        'yeahpromos_end_date',
        'yeahpromos_is_amazon',
        'yeahpromos_page',
        'yeahpromos_limit',
        'yeahpromos_request_delay_ms',
        'yeahpromos_rate_limit_max_retries',
        'yeahpromos_rate_limit_base_delay_ms',
        'yeahpromos_rate_limit_max_delay_ms',
        'yeahpromos_marketplace_templates_json',
      ]

  const values = await getUserScopedSettingMap(userId, [...requiredKeys, ...optionalKeys])
  const missingKeys = requiredKeys.filter((key) => !values[key])

  return {
    configured: missingKeys.length === 0,
    missingKeys,
    values,
  }
}

function ensurePlatformConfigured(check: PlatformConfigCheck, platform: AffiliatePlatform): void {
  if (check.configured) return
  throw new ConfigRequiredError(platform, check.missingKeys)
}

async function fetchJsonOrThrow<T>(url: string, init: RequestInit, errorPrefix: string): Promise<T> {
  const response = await fetch(url, init)
  const text = await response.text().catch(() => '')
  const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 220)

  if (!response.ok) {
    // 特殊处理 407 Proxy Authentication Required
    if (response.status === 407) {
      throw new Error(
        `${errorPrefix} (407): 代理认证失败 - IPRocket配额可能已用完或凭证失效，请检查代理服务余额和配置`
      )
    }

    throw new Error(`${errorPrefix} (${response.status}): ${snippet || '请求失败'}`)
  }

  const body = text.trim()
  if (!body) {
    throw new Error(`${errorPrefix} (${response.status}): Empty response body`)
  }

  try {
    return JSON.parse(body) as T
  } catch (error: any) {
    const parseMessage = String(error?.message || 'Failed to parse JSON response')
    const responseHint = snippet ? `; response=${snippet}` : ''
    throw new SyntaxError(`${errorPrefix} (${response.status}): ${parseMessage}${responseHint}`)
  }
}

type PartnerboostRequestRateLimitOptions = {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
}

type YeahPromosRequestRateLimitOptions = {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
}

async function fetchPartnerboostJsonWithRateLimitRetry<T extends { status?: { code?: number | string; msg?: string } }>(
  url: string,
  init: RequestInit,
  errorPrefix: string,
  options: PartnerboostRequestRateLimitOptions
): Promise<T> {
  let attempt = 0
  while (true) {
    let responseStatus: number | undefined
    try {
      const payload = await fetchJsonOrThrow<T>(url, init, errorPrefix)
      const payloadStatusCode = normalizePartnerboostStatusCode(payload?.status?.code)
      const payloadStatusMessage = String(payload?.status?.msg || '')

      if (
        isPartnerboostRateLimited(payloadStatusCode, payloadStatusMessage, responseStatus)
        && attempt < options.maxRetries
      ) {
        attempt += 1
        const delayMs = calculateExponentialBackoffDelay(attempt, options.baseDelayMs, options.maxDelayMs)
        console.warn(`[partnerboost] rate limited(${errorPrefix}), retry ${attempt}/${options.maxRetries} after ${delayMs}ms`)
        await sleep(delayMs)
        continue
      }

      return payload
    } catch (error: any) {
      const message = String(error?.message || '')
      responseStatus = parseHttpStatusFromErrorMessage(message)
      const payloadStatusCode = normalizePartnerboostStatusCode(error?.status?.code)
      const payloadStatusMessage = String(error?.status?.msg || message)

      // ❌ 检测代理致命错误（不可重试）
      if (isProxyFatalError(error)) {
        console.error(`[partnerboost] 代理致命错误，停止重试: ${message}`)
        throw error
      }

      const isRateLimited = isPartnerboostRateLimited(payloadStatusCode, payloadStatusMessage, responseStatus)
      const isTransient = !isRateLimited && isPartnerboostTransientError(error)

      if ((isRateLimited || isTransient) && attempt < options.maxRetries) {
        attempt += 1
        const delayMs = calculateExponentialBackoffDelay(attempt, options.baseDelayMs, options.maxDelayMs)
        const retryReason = isRateLimited ? 'rate limited' : 'transient error'
        console.warn(`[partnerboost] ${retryReason}(${errorPrefix}), retry ${attempt}/${options.maxRetries} after ${delayMs}ms`)
        await sleep(delayMs)
        continue
      }

      throw error
    }
  }
}

async function fetchPartnerboostDtcPromotableProductsWithMeta(input: {
  baseUrl: string
  token: string
  brandId: string | null
  pageSize: number
  startPage: number
  maxPages: number | null
  requestDelayMs: number
  rateLimitRetryOptions: PartnerboostRequestRateLimitOptions
}): Promise<PartnerboostPromotableFetchResult> {
  const items: NormalizedAffiliateProduct[] = []
  let page = input.startPage
  let hasMore = true
  let fetchedPages = 0

  while (hasMore && (input.maxPages === null || fetchedPages < input.maxPages)) {
    const payload = await fetchPartnerboostJsonWithRateLimitRetry<PartnerboostDtcProductsResponse>(
      `${input.baseUrl}/api.php?mod=datafeed&op=list`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: input.token,
          brand_type: 'DTC',
          brand_id: input.brandId || undefined,
          page,
          limit: input.pageSize,
        }),
      },
      'PartnerBoost DTC 商品拉取失败',
      input.rateLimitRetryOptions
    )

    const statusCode = normalizePartnerboostStatusCode(payload.status?.code)
    if (statusCode === null) {
      throw new Error(`PartnerBoost DTC 商品拉取失败: Invalid status code ${String(payload.status?.code)}`)
    }
    if (statusCode !== 0) {
      throw new Error(`PartnerBoost DTC 商品拉取失败: ${payload.status?.msg || statusCode}`)
    }

    const extracted = extractPartnerboostDtcProductsPayload({
      payload,
      page,
      pageSize: input.pageSize,
    })
    fetchedPages += 1
    hasMore = extracted.hasMore

    for (const product of extracted.products) {
      const shortPromoLink = normalizeUrl(product.tracking_url_short)
      const promoLink = shortPromoLink
        || normalizeUrl(product.tracking_url_smart)
        || normalizeUrl(product.tracking_url)
      if (!promoLink) continue

      const mid = normalizeUrl(
        typeof product.creative_id === 'string' || typeof product.creative_id === 'number'
          ? String(product.creative_id)
          : product.sku || product.url || ''
      )
      if (!mid) continue

      const priceAmount = parsePriceAmount(product.price ?? product.old_price)
      const priceCurrency = normalizeCurrencyUnit(product.currency)
      const asin = extractAsinFromUrlLike(product.url)
      const merchantId = normalizeUrl(
        typeof product.brand_id === 'string' || typeof product.brand_id === 'number'
          ? String(product.brand_id)
          : product.mcid || ''
      )

      items.push({
        platform: 'partnerboost',
        mid,
        merchantId,
        asin,
        brand: normalizeUrl(product.brand || product.merchant_name),
        productName: normalizeUrl(product.name),
        productUrl: normalizeUrl(product.url),
        promoLink,
        shortPromoLink,
        allowedCountries: normalizeCountries(product.country_code ?? product.country ?? ''),
        priceAmount,
        priceCurrency,
        commissionRate: null,
        commissionAmount: null,
        commissionRateMode: 'percent',
        reviewCount: null,
        isDeepLink: null,
        isConfirmedInvalid: resolveConfirmedInvalidFromSignals({
          availability: product.availability,
        }),
      })
    }

    page += 1
    if (hasMore && input.requestDelayMs > 0) {
      await sleep(input.requestDelayMs)
    }
  }

  return {
    items,
    hasMore,
    nextPage: page,
    fetchedPages,
  }
}

async function fetchYeahPromosJsonWithRateLimitRetry<T extends {
  Code?: number | string
  code?: number | string
  message?: string
  msg?: string
}>(
  url: string,
  init: RequestInit,
  errorPrefix: string,
  options: YeahPromosRequestRateLimitOptions
): Promise<T> {
  let attempt = 0
  const resolveRetryDelayMs = (retryAttempt: number, errorMessage: string): number => {
    const backoffDelayMs = calculateExponentialBackoffDelay(
      retryAttempt,
      options.baseDelayMs,
      options.maxDelayMs
    )

    if (!isYeahPromosRequestTooFastMessage(errorMessage)) {
      return backoffDelayMs
    }

    const minDelayForTooFastMs = Math.min(options.maxDelayMs, 2000 * retryAttempt)
    return Math.max(backoffDelayMs, minDelayForTooFastMs)
  }

  while (true) {
    let responseStatus: number | undefined
    try {
      const payload = await fetchJsonOrThrow<T>(url, init, errorPrefix)
      const code = normalizeYeahPromosResultCode(payload?.Code ?? payload?.code)
      const message = String(payload?.message || payload?.msg || '')

      if (isYeahPromosRateLimited(code, message, responseStatus) && attempt < options.maxRetries) {
        attempt += 1
        const delayMs = resolveRetryDelayMs(attempt, message)
        console.warn(`[yeahpromos] rate limited(${errorPrefix}), retry ${attempt}/${options.maxRetries} after ${delayMs}ms`)
        await sleep(delayMs)
        continue
      }

      return payload
    } catch (error: any) {
      const message = String(error?.message || '')
      const statusMatch = message.match(/\((\d{3})\):/)
      responseStatus = statusMatch ? Number(statusMatch[1]) : undefined

      // ❌ 检测代理致命错误（不可重试）
      if (isProxyFatalError(error)) {
        console.error(`[yeahpromos] 代理致命错误，停止重试: ${message}`)
        throw error
      }

      const isRateLimited = isYeahPromosRateLimited(null, message, responseStatus)
      const isTransient = !isRateLimited && isYeahPromosTransientError(error)

      if ((isRateLimited || isTransient) && attempt < options.maxRetries) {
        attempt += 1
        const delayMs = resolveRetryDelayMs(attempt, message)
        const retryReason = isRateLimited ? 'rate limited' : 'transient error'
        console.warn(`[yeahpromos] ${retryReason}(${errorPrefix}), retry ${attempt}/${options.maxRetries} after ${delayMs}ms`)
        await sleep(delayMs)
        continue
      }

      throw error
    }
  }
}

async function fetchPartnerboostPromotableProductsWithMeta(
  params: PartnerboostPromotableFetchParams
): Promise<PartnerboostPromotableFetchResult> {
  const check = await checkAffiliatePlatformConfig(params.userId, 'partnerboost')
  ensurePlatformConfigured(check, 'partnerboost')

  const token = check.values.partnerboost_token
  const baseUrl = (check.values.partnerboost_base_url || DEFAULT_PB_BASE_URL).replace(/\/+$/, '')
  const pageSize = Math.max(1, Math.min(
    parseInteger(check.values.partnerboost_products_page_size || String(DEFAULT_PB_PRODUCTS_PAGE_SIZE), DEFAULT_PB_PRODUCTS_PAGE_SIZE),
    200
  ))
  const configuredStartPage = Math.max(1, parseInteger(check.values.partnerboost_products_page || '1', 1))
  const startPage = Math.max(1, parseInteger(params.startPage, configuredStartPage))
  const defaultFilter = parseInteger(check.values.partnerboost_products_default_filter || '0', 0)
  const countryCode = resolvePartnerboostCountryCode(
    params.countryCodeOverride,
    check.values.partnerboost_products_country_code
  )
  const brandId = (check.values.partnerboost_products_brand_id || '').trim() || null
  const sort = check.values.partnerboost_products_sort || ''
  const relationship = parseInteger(check.values.partnerboost_products_relationship || '1', 1)
  const isOriginalCurrency = parseInteger(check.values.partnerboost_products_is_original_currency || '0', 0)
  const hasPromoCode = parseInteger(check.values.partnerboost_products_has_promo_code || '0', 0)
  const hasAcc = parseInteger(check.values.partnerboost_products_has_acc || '0', 0)
  const filterSexual = parseInteger(check.values.partnerboost_products_filter_sexual_wellness || '0', 0)
  const productLinkBatchSize = parseIntegerInRange(
    check.values.partnerboost_products_link_batch_size || String(DEFAULT_PB_PRODUCTS_LINK_BATCH_SIZE),
    DEFAULT_PB_PRODUCTS_LINK_BATCH_SIZE,
    1,
    MAX_PB_PRODUCTS_LINK_BATCH_SIZE
  )
  const asinLinkBatchSize = parseIntegerInRange(
    check.values.partnerboost_asin_link_batch_size || String(DEFAULT_PB_ASIN_LINK_BATCH_SIZE),
    DEFAULT_PB_ASIN_LINK_BATCH_SIZE,
    1,
    MAX_PB_ASIN_LINK_BATCH_SIZE
  )
  const requestDelayMs = parseIntegerInRange(
    check.values.partnerboost_request_delay_ms || String(DEFAULT_PB_REQUEST_DELAY_MS),
    DEFAULT_PB_REQUEST_DELAY_MS,
    0,
    MAX_PB_REQUEST_DELAY_MS
  )
  const rateLimitRetryOptions: PartnerboostRequestRateLimitOptions = {
    maxRetries: parseIntegerInRange(
      check.values.partnerboost_rate_limit_max_retries || String(DEFAULT_PB_RATE_LIMIT_MAX_RETRIES),
      DEFAULT_PB_RATE_LIMIT_MAX_RETRIES,
      0,
      10
    ),
    baseDelayMs: parseIntegerInRange(
      check.values.partnerboost_rate_limit_base_delay_ms || String(DEFAULT_PB_RATE_LIMIT_BASE_DELAY_MS),
      DEFAULT_PB_RATE_LIMIT_BASE_DELAY_MS,
      100,
      60000
    ),
    maxDelayMs: parseIntegerInRange(
      check.values.partnerboost_rate_limit_max_delay_ms || String(DEFAULT_PB_RATE_LIMIT_MAX_DELAY_MS),
      DEFAULT_PB_RATE_LIMIT_MAX_DELAY_MS,
      500,
      120000
    ),
  }
  const configuredAsins = parseCsvValues(check.values.partnerboost_products_asins || '')
  const allAsins = Array.from(new Set([...(params.asins || []), ...configuredAsins]))
    .map((asin) => normalizeAsin(asin))
    .filter((asin): asin is string => Boolean(asin))
  assertPartnerboostAsinRequestLimit(allAsins)
  const linkCountryCode = resolvePartnerboostCountryCode(
    params.linkCountryCodeOverride ?? check.values.partnerboost_link_country_code,
    countryCode
  )
  const uid = check.values.partnerboost_link_uid || ''
  const returnPartnerboostLink = parseInteger(check.values.partnerboost_link_return_partnerboost_link || '1', 1)
  const isAsinTargetedSync = allAsins.length > 0
  const defaultMaxPages = isAsinTargetedSync ? 1 : null
  const maxPages = resolveSyncMaxPages(params.maxPages, defaultMaxPages, MAX_PB_SYNC_MAX_PAGES)
  const fullSyncCountrySequence = resolvePartnerboostFullSyncCountrySequence()
  const includeDtcProducts = !isAsinTargetedSync && countryCode === fullSyncCountrySequence[0]

  const products: PartnerboostProduct[] = []
  let page = startPage
  let hasMore = true
  let fetchedPages = 0
  let emptyPageStreak = 0
  let lastFetchProgressCount = 0

  const emitFetchProgress = async (force: boolean = false): Promise<void> => {
    if (!params.onFetchProgress) return
    if (!force && products.length === lastFetchProgressCount) return
    lastFetchProgressCount = products.length
    try {
      await params.onFetchProgress(products.length)
    } catch (error: any) {
      console.warn('[partnerboost] onFetchProgress callback failed:', error?.message || error)
    }
  }

  while (hasMore && (maxPages === null || fetchedPages < maxPages)) {
    const payload = await fetchPartnerboostJsonWithRateLimitRetry<PartnerboostProductsResponse>(
      `${baseUrl}/api/datafeed/get_fba_products`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          page_size: pageSize,
          page,
          default_filter: defaultFilter,
          country_code: countryCode,
          brand_id: brandId,
          sort,
          asins: allAsins.join(','),
          relationship,
          is_original_currency: isOriginalCurrency,
          has_promo_code: hasPromoCode,
          has_acc: hasAcc,
          filter_sexual_wellness: filterSexual,
        }),
      },
      'PartnerBoost 商品拉取失败',
      rateLimitRetryOptions
    )

    const statusCode = normalizePartnerboostStatusCode(payload.status?.code)
    if (statusCode === null) {
      throw new Error(`PartnerBoost 商品拉取失败: Invalid status code ${String(payload.status?.code)}`)
    }
    if (statusCode !== 0) {
      throw new Error(`PartnerBoost 商品拉取失败: ${payload.status?.msg || statusCode}`)
    }

    const extracted = extractPartnerboostProductsPayload(payload)
    products.push(...extracted.products)
    hasMore = extracted.hasMore
    fetchedPages += 1

    if (fetchedPages === 1 || fetchedPages % 5 === 0 || !hasMore) {
      await emitFetchProgress()
    }

    if (!isAsinTargetedSync && hasMore) {
      if (extracted.products.length === 0) {
        emptyPageStreak += 1
        if (emptyPageStreak >= MAX_PB_EMPTY_PAGE_STREAK) {
          console.warn(
            `[partnerboost] received ${emptyPageStreak} consecutive empty pages with has_more=true; stopping early to avoid infinite pagination`
          )
          hasMore = false
        }
      } else {
        emptyPageStreak = 0
      }
    } else {
      emptyPageStreak = 0
    }

    page += 1

    if (isAsinTargetedSync) {
      hasMore = false
    }

    if (hasMore && requestDelayMs > 0) {
      await sleep(requestDelayMs)
    }
  }

  if (
    !isAsinTargetedSync
    && maxPages !== null
    && hasMore
    && fetchedPages >= maxPages
    && !params.suppressMaxPagesWarning
  ) {
    console.warn(`[partnerboost] reached page limit (${maxPages}) while has_more=true; results may be truncated`)
  }

  await emitFetchProgress(true)

  const productIds = products
    .map((item) => String(item.product_id || '').trim())
    .filter(Boolean)

  const linkMap = new Map<string, string>()
  let rateLimitedProductLinkBatchCount = 0
  let productLinkBatchProcessed = 0
  for (let index = 0; index < productIds.length; index += productLinkBatchSize) {
    const batchIds = productIds.slice(index, index + productLinkBatchSize)
    try {
      const payload = await fetchPartnerboostJsonWithRateLimitRetry<PartnerboostLinkResponse>(
        `${baseUrl}/api/datafeed/get_fba_products_link`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            product_ids: batchIds.join(','),
            uid,
          }),
        },
        'PartnerBoost 推广链接拉取失败',
        rateLimitRetryOptions
      )

      const statusCode = normalizePartnerboostStatusCode(payload.status?.code)
      if (statusCode === null) {
        throw new Error(`PartnerBoost 推广链接拉取失败: Invalid status code ${String(payload.status?.code)}`)
      }
      if (statusCode !== 0) {
        throw new Error(`PartnerBoost 推广链接拉取失败: ${payload.status?.msg || statusCode}`)
      }

      for (const item of payload.data || []) {
        const productId = String(item.product_id || '').trim()
        const link = normalizeUrl(item.partnerboost_link || item.link)
        if (!productId || !link) continue
        linkMap.set(productId, link)
      }
    } catch (error) {
      if (!isPartnerboostRateLimitError(error)) {
        throw error
      }

      rateLimitedProductLinkBatchCount += 1
      console.warn(
        `[partnerboost] product link batch rate-limited, falling back to ASIN link for this batch (${index + 1}-${Math.min(index + productLinkBatchSize, productIds.length)}/${productIds.length})`
      )
    }

    const hasRemaining = index + productLinkBatchSize < productIds.length
    productLinkBatchProcessed += 1
    if (
      productLinkBatchProcessed % PB_LINK_HEARTBEAT_EVERY_BATCHES === 0
      || !hasRemaining
    ) {
      await emitFetchProgress(true)
    }

    if (hasRemaining && requestDelayMs > 0) {
      await sleep(requestDelayMs)
    }
  }

  const asinLinkMap = new Map<string, { link: string | null; partnerboostLink: string | null }>()
  // 优先使用 product_id 链接；仅对缺失 product_id 链接的商品补查 ASIN 链接，
  // 可显著减少 API 请求量并降低触发 429 的概率。
  const linkLookupAsins = Array.from(new Set(
    products
      .filter((item) => {
        const productId = String(item.product_id || '').trim()
        return !productId || !linkMap.has(productId)
      })
      .map((item) => normalizeAsin(item.asin))
      .filter((asin): asin is string => Boolean(asin))
  ))
  let asinLinkBatchProcessed = 0
  for (let index = 0; index < linkLookupAsins.length; index += asinLinkBatchSize) {
    const batchAsins = linkLookupAsins.slice(index, index + asinLinkBatchSize)
    try {
      const payload = await fetchPartnerboostJsonWithRateLimitRetry<PartnerboostAsinLinkResponse>(
        `${baseUrl}/api/datafeed/get_amazon_link_by_asin`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            asins: batchAsins.join(','),
            country_code: linkCountryCode,
            uid,
            return_partnerboost_link: returnPartnerboostLink,
          }),
        },
        'PartnerBoost ASIN推广链接拉取失败',
        rateLimitRetryOptions
      )

      const statusCode = normalizePartnerboostStatusCode(payload.status?.code)
      if (statusCode === null) {
        throw new Error(`PartnerBoost ASIN推广链接拉取失败: Invalid status code ${String(payload.status?.code)}`)
      }
      if (statusCode !== 0) {
        throw new Error(`PartnerBoost ASIN推广链接拉取失败: ${payload.status?.msg || statusCode}`)
      }

      for (const item of payload.data || []) {
        const asinKey = normalizeAsin(item.asin)
        if (!asinKey) continue

        asinLinkMap.set(asinKey, {
          link: normalizeUrl(item.link),
          partnerboostLink: normalizeUrl(item.partnerboost_link),
        })
      }
    } catch (error) {
      if (!isPartnerboostRateLimitError(error)) {
        throw error
      }

      console.warn(
        `[partnerboost] asin link batch rate-limited; stop remaining ASIN enrichment (${index + 1}-${Math.min(index + asinLinkBatchSize, linkLookupAsins.length)}/${linkLookupAsins.length})`
      )
      break
    }

    const hasRemaining = index + asinLinkBatchSize < linkLookupAsins.length
    asinLinkBatchProcessed += 1
    if (
      asinLinkBatchProcessed % PB_LINK_HEARTBEAT_EVERY_BATCHES === 0
      || !hasRemaining
    ) {
      await emitFetchProgress(true)
    }

    if (hasRemaining && requestDelayMs > 0) {
      await sleep(requestDelayMs)
    }
  }

  if (rateLimitedProductLinkBatchCount > 0) {
    console.warn(
      `[partnerboost] product link batches rate-limited: ${rateLimitedProductLinkBatchCount}; used ASIN fallback for missing links`
    )
  }

  const amazonItems: NormalizedAffiliateProduct[] = []
  for (const item of products) {
    const mid = String(item.product_id || '').trim()
    if (!mid) continue

    const asinKey = normalizeAsin(item.asin)
    const asinLinks = asinKey ? asinLinkMap.get(asinKey) : undefined
    const resolvedLinks = resolvePartnerboostPromoLinks({
      productIdLink: linkMap.get(mid) || null,
      asinLink: asinLinks?.link || null,
      asinPartnerboostLink: asinLinks?.partnerboostLink || null,
    })

    const promoLink = resolvedLinks.promoLink
    if (!promoLink) {
      continue
    }

    const priceAmount = parsePriceAmount(item.discount_price ?? item.original_price)
    const priceCurrency = normalizeCurrencyUnit(item.currency)
    const parsedCommission = parsePartnerboostCommission(item.acc_commission ?? item.commission, priceCurrency)
    const commissionRate = parsedCommission.mode === 'percent' ? parsedCommission.rate : parsedCommission.amount
    const allowedCountries = normalizeCountries(item.country_code)
    const reviewCount = parseReviewCount(
      item.review_count
      ?? item.reviewCount
      ?? item.reviews
      ?? item.rating_count
      ?? item.ratings_total
    )
    const merchantId = normalizeUrl(
      typeof item.brand_id === 'string' || typeof item.brand_id === 'number'
        ? String(item.brand_id)
        : typeof item.brandId === 'string' || typeof item.brandId === 'number'
            ? String(item.brandId)
            : typeof item.bid === 'string' || typeof item.bid === 'number'
                ? String(item.bid)
                : ''
    )
    const isDeepLink = normalizeTriStateBool((item as any).is_deeplink ?? (item as any).isDeepLink)
    const isConfirmedInvalid = resolveConfirmedInvalidFromSignals({
      advertStatus: (item as any).advert_status,
      status: (item as any).status,
      availability: (item as any).availability,
      stockStatus: (item as any).stock_status,
      isAvailable: (item as any).is_available,
      inStock: (item as any).in_stock,
      isOos: (item as any).is_oos,
    })

    amazonItems.push({
      platform: 'partnerboost',
      mid,
      merchantId,
      asin: normalizeUrl(item.asin),
      brand: normalizeUrl(item.brand_name),
      productName: normalizeUrl(item.product_name),
      productUrl: normalizeUrl(item.url),
      promoLink,
      shortPromoLink: resolvedLinks.shortPromoLink,
      allowedCountries,
      priceAmount,
      priceCurrency,
      commissionRate,
      commissionAmount: parsedCommission.mode === 'amount'
        ? parsedCommission.amount
        : computeCommissionAmount(priceAmount, commissionRate),
      commissionRateMode: parsedCommission.mode,
      reviewCount,
      isDeepLink,
      isConfirmedInvalid,
    })
  }

  let dtcResult: PartnerboostPromotableFetchResult = {
    items: [],
    hasMore: false,
    nextPage: startPage,
    fetchedPages: 0,
  }
  if (includeDtcProducts) {
    dtcResult = await fetchPartnerboostDtcPromotableProductsWithMeta({
      baseUrl,
      token,
      brandId,
      pageSize,
      startPage,
      maxPages,
      requestDelayMs,
      rateLimitRetryOptions,
    })
  }

  return {
    items: [...amazonItems, ...dtcResult.items],
    hasMore: hasMore || dtcResult.hasMore,
    nextPage: Math.max(page, dtcResult.nextPage),
    fetchedPages: Math.max(fetchedPages, dtcResult.fetchedPages),
  }
}

async function fetchPartnerboostPromotableProducts(
  params: PartnerboostPromotableFetchParams
): Promise<NormalizedAffiliateProduct[]> {
  const result = await fetchPartnerboostPromotableProductsWithMeta(params)
  return result.items
}

async function loadYeahPromosMarketplaceTemplates(params: {
  userId: number
  preloadedSettings?: Record<string, string>
}): Promise<YeahPromosMarketplaceTemplate[]> {
  const preloadedValue = String(
    params.preloadedSettings?.[YP_MARKETPLACE_TEMPLATES_SETTING_KEY]
    || ''
  ).trim()
  const templates = preloadedValue
    ? resolveYeahPromosMarketplaceTemplates(preloadedValue)
    : resolveYeahPromosMarketplaceTemplates(
      (
        await getSetting(
          'openclaw',
          YP_MARKETPLACE_TEMPLATES_SETTING_KEY,
          params.userId
        )
      )?.value || ''
    )

  const preloadedSiteId = String(params.preloadedSettings?.yeahpromos_site_id || '').trim()
  const resolvedSiteId = preloadedSiteId
    || String(
      (
        await getSetting(
          'affiliate_sync',
          'yeahpromos_site_id',
          params.userId
        )
      )?.value || ''
    ).trim()

  return applyYeahPromosTemplateSiteId(templates, resolvedSiteId)
}

async function loadYeahPromosCountryProxyMap(userId: number): Promise<Map<string, string>> {
  const proxySetting = await getUserOnlySetting('proxy', 'urls', userId)
  return parseYeahPromosProxyCountryUrlMap(proxySetting?.value || '')
}

async function createYeahPromosProxyAgent(params: {
  proxyProviderUrl: string
  country: string
  reason: string
}): Promise<HttpsProxyAgent<string>> {
  const proxy = await fetchProxyIp(params.proxyProviderUrl, 3, false)
  console.log(`[yeahpromos] proxy ${params.country} (${params.reason}): ${proxy.fullAddress}`)
  return new HttpsProxyAgent(`http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`, {
    keepAlive: true,
    timeout: 60000,
  })
}

async function fetchYeahPromosAccessProductsCount(params: {
  userId: number
  siteId: string
  sessionCookie: string
  proxyAgent?: HttpsProxyAgent<string>
}): Promise<number | null> {
  const url = new URL('https://yeahpromos.com/index/offer/report_performance')
  url.searchParams.set('site_id', params.siteId)

  const agent = params.proxyAgent
  const fingerprint = generateRandomFingerprint()

  // 构建完整的 HTTP 头部（参考 browser-stealth.ts）
  const headers: Record<string, string> = {
    'Cookie': params.sessionCookie,
    'Accept': fingerprint.accept,
    'Accept-Language': fingerprint.acceptLanguage,
    'Accept-Encoding': fingerprint.acceptEncoding!,
    'User-Agent': fingerprint.userAgent,
    'Connection': fingerprint.connection!,
    'Upgrade-Insecure-Requests': fingerprint.upgradeInsecureRequests!,
    'Sec-Fetch-Dest': fingerprint.secFetchDest!,
    'Sec-Fetch-Mode': fingerprint.secFetchMode!,
    'Sec-Fetch-Site': fingerprint.secFetchSite!,
    'Sec-Fetch-User': fingerprint.secFetchUser!,
    'Cache-Control': fingerprint.cacheControl!,
    'DNT': fingerprint.dnt!,
  }

  // 只有 Chrome/Edge 才发送 Sec-CH-UA 头部
  if (fingerprint.secChUa) {
    headers['Sec-CH-UA'] = fingerprint.secChUa
    headers['Sec-CH-UA-Mobile'] = fingerprint.secChUaMobile!
    headers['Sec-CH-UA-Platform'] = fingerprint.secChUaPlatform!
  }

  const response = await axios.get(url.toString(), {
    headers,
    httpsAgent: agent,
    httpAgent: agent,
    maxRedirects: 5,
    validateStatus: () => true,
    responseType: 'text',
    timeout: 60000,
  })
  const html = typeof response.data === 'string' ? response.data : ''

  if (response.status < 200 || response.status >= 300) {
    return null
  }

  const redirectedUrl = normalizeUrl(response.request?.res?.responseUrl) || ''
  const isLoginRedirect = redirectedUrl.includes('/index/login/login')
    || redirectedUrl.includes('/index/index/login')
    || /action=\"\/index\/login\/login\"/i.test(html)
  if (isLoginRedirect) {
    return null
  }

  const match = html.match(/Access\\s*Products\\s*:\\s*([0-9,]+)/i)
  if (!match?.[1]) {
    return null
  }

  const parsed = Number(match[1].replace(/,/g, ''))
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  const normalized = Math.trunc(parsed)
  const nowIso = new Date().toISOString()
  await Promise.all([
    upsertUserSystemSetting({
      userId: params.userId,
      key: AFFILIATE_YP_ACCESS_PRODUCTS_TARGET_KEY,
      value: String(normalized),
      description: 'YP Access Products 最新目标总量',
    }),
    upsertUserSystemSetting({
      userId: params.userId,
      key: AFFILIATE_YP_ACCESS_PRODUCTS_UPDATED_AT_KEY,
      value: nowIso,
      description: 'YP Access Products 最近更新时间',
    }),
  ])

  return normalized
}

function normalizeYeahPromosStoreMerchant(input: {
  merchant: YeahPromosMerchant
  siteId: string
}): NormalizedAffiliateProduct | null {
  const merchant = input.merchant
  const merchantId = normalizeUrl(
    typeof merchant.mid === 'string' || typeof merchant.mid === 'number'
      ? String(merchant.mid)
      : typeof merchant.id === 'string' || typeof merchant.id === 'number'
          ? String(merchant.id)
          : typeof merchant.advert_id === 'string' || typeof merchant.advert_id === 'number'
              ? String(merchant.advert_id)
              : ''
  )
  if (!merchantId) return null

  const advertId = normalizeUrl(
    typeof merchant.advert_id === 'string' || typeof merchant.advert_id === 'number'
      ? String(merchant.advert_id)
      : merchantId
  )
  const track = normalizeUrl(merchant.track)
  const promoLink = normalizeYeahPromosPromoUrl(merchant.tracking_url)
    || buildYeahPromosTrackPromoUrl(track)
  if (!promoLink) return null

  const parsedCommission = parseYeahPromosMerchantCommission(
    merchant.avg_payout,
    merchant.payout_unit
  )
  const commissionRateMode: AffiliateCommissionRateMode = parsedCommission.mode === 'amount'
    ? 'amount'
    : 'percent'
  const productUrl = normalizeUrl(merchant.url)
    || normalizeUrl(merchant.site_url)
    || buildYeahPromosAdvertContentUrl(advertId, input.siteId)

  const reviewCount = parseReviewCount(
    merchant.review_count
    ?? merchant.reviewCount
    ?? merchant.reviews
    ?? merchant.rating_count
    ?? merchant.ratings_total
  )
  const isDeepLink = normalizeTriStateBool(merchant.is_deeplink)
  const isConfirmedInvalid = resolveConfirmedInvalidFromSignals({
    advertStatus: merchant.advert_status,
    status: merchant.status ?? merchant.merchant_status,
    availability: null,
    stockStatus: null,
    joinStatus: merchant.merchant_status,
    isAvailable: null,
    inStock: null,
    isOos: null,
  })

  return {
    platform: 'yeahpromos',
    mid: `store_${advertId || merchantId}`,
    merchantId,
    asin: null,
    brand: normalizeUrl(merchant.merchant_name),
    productName: normalizeUrl(merchant.merchant_name),
    productUrl,
    promoLink,
    shortPromoLink: null,
    allowedCountries: normalizeCountries(merchant.country),
    priceAmount: null,
    priceCurrency: null,
    commissionRate: commissionRateMode === 'percent' ? parsedCommission.rate : null,
    commissionAmount: commissionRateMode === 'amount' ? parsedCommission.amount : null,
    commissionRateMode,
    reviewCount,
    isDeepLink,
    isConfirmedInvalid,
  }
}

async function fetchYeahPromosPromotableStores(params: {
  token: string
  siteId: string
  pageSize: number
  requestDelayMs: number
  rateLimitRetryOptions: YeahPromosRequestRateLimitOptions
  onFetchProgress?: (fetchedCount: number) => Promise<void> | void
}): Promise<NormalizedAffiliateProduct[]> {
  const items: NormalizedAffiliateProduct[] = []
  let page = 1
  let hasMore = true

  while (hasMore) {
    const url = new URL('https://yeahpromos.com/index/getadvert/getadvert')
    url.searchParams.set('site_id', params.siteId)
    url.searchParams.set('elite', '0')
    url.searchParams.set('page', String(page))
    url.searchParams.set('limit', String(params.pageSize))

    const payload = await fetchYeahPromosJsonWithRateLimitRetry<YeahPromosResponse>(
      url.toString(),
      {
        method: 'GET',
        headers: {
          token: params.token,
          Accept: 'application/json',
        },
      },
      'YeahPromos 店铺信息拉取失败',
      params.rateLimitRetryOptions
    )

    const code = normalizeYeahPromosResultCode(payload?.Code ?? payload?.code)
    if (code !== null && code !== 100000) {
      throw new Error(`YeahPromos 店铺信息拉取失败: ${String(payload?.message || payload?.msg || code)}`)
    }

    const extracted = extractYeahPromosPayload(payload)
    for (const merchant of extracted.merchants) {
      const normalized = normalizeYeahPromosStoreMerchant({
        merchant,
        siteId: params.siteId,
      })
      if (!normalized) continue
      items.push(normalized)
    }

    if (params.onFetchProgress) {
      await params.onFetchProgress(items.length)
    }

    const pageTotal = extracted.pageTotal
    const pageNow = extracted.pageNow ?? page
    hasMore = pageTotal !== null
      ? pageNow < pageTotal
      : extracted.merchants.length >= params.pageSize
    page += 1

    if (hasMore && params.requestDelayMs > 0) {
      await sleep(params.requestDelayMs)
    }
  }

  return items
}

function extractYeahPromosPageNumberFromHref(href: string | null | undefined): number | null {
  const rawHref = normalizeUrl(href)
  if (!rawHref) return null

  try {
    const url = new URL(rawHref, 'https://yeahpromos.com')
    const page = parseInteger(url.searchParams.get('page') || '', NaN)
    if (!Number.isFinite(page) || page <= 0) return null
    return page
  } catch {
    return null
  }
}

function resolveYeahPromosPromoIdentifiers(promoLink: string | null): { pid: string | null; track: string | null } {
  const rawPromoLink = normalizeUrl(promoLink)
  if (!rawPromoLink) {
    return { pid: null, track: null }
  }

  try {
    const url = new URL(rawPromoLink, 'https://yeahpromos.com')
    const pid = normalizeUrl(url.searchParams.get('pid'))
    const track = normalizeUrl(url.searchParams.get('track'))
    return { pid, track }
  } catch {
    const pidMatch = rawPromoLink.match(/[?&]pid=([^&#]+)/i)
    const trackMatch = rawPromoLink.match(/[?&]track=([^&#]+)/i)
    return {
      pid: normalizeUrl(pidMatch?.[1] || null),
      track: normalizeUrl(trackMatch?.[1] || null),
    }
  }
}

function buildYeahPromosTrackPromoUrl(track: string | null): string | null {
  const normalizedTrack = normalizeUrl(track)
  if (!normalizedTrack) return null

  try {
    const url = new URL('https://yeahpromos.com/index/index/openurl')
    url.searchParams.set('track', normalizedTrack)
    url.searchParams.set('url', '')
    return normalizeUrl(url.toString())
  } catch {
    return null
  }
}

function buildYeahPromosAdvertContentUrl(advertId: string | null, siteId: string | null): string | null {
  const normalizedAdvertId = normalizeUrl(advertId)
  const normalizedSiteId = normalizeUrl(siteId)
  if (!normalizedAdvertId || !normalizedSiteId) return null

  try {
    const url = new URL('https://yeahpromos.com/index/advert/advert_content')
    url.searchParams.set('advert_id', normalizedAdvertId)
    url.searchParams.set('site_id', normalizedSiteId)
    return normalizeUrl(url.toString())
  } catch {
    return null
  }
}

const YEAHPROMOS_PROMO_PATH_PATTERN = /\/index\/index\/openurl(?:product)?\?/i

function decodeHtmlEntitiesForUrl(input: string): string {
  return String(input || '')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/g, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&#x27;/gi, '\'')
    .replace(/&#x2f;/gi, '/')
}

function normalizeYeahPromosPromoUrl(raw: string | null | undefined): string | null {
  const decoded = normalizeUrl(decodeHtmlEntitiesForUrl(String(raw || '')))
  if (!decoded) return null

  try {
    if (/^https?:\/\//i.test(decoded)) {
      return normalizeUrl(decoded)
    }
    if (decoded.startsWith('/')) {
      return normalizeUrl(new URL(decoded, 'https://yeahpromos.com').toString())
    }
  } catch {
    return null
  }

  return null
}

function extractYeahPromosPromoLinkFromText(rawText: string | null | undefined): string | null {
  const text = decodeHtmlEntitiesForUrl(String(rawText || ''))
  if (!text) return null

  const patterns: RegExp[] = [
    /ClipboardJS\.copy\(\s*(['"`])([^'"`]+)\1\s*\)/i,
    /copy\(\s*(['"`])([^'"`]+)\1\s*\)/i,
    /(['"`])((?:https?:\/\/|\/index\/index\/openurl(?:product)?\?)[^'"`\s<>]+)\1/i,
    /(https?:\/\/yeahpromos\.com\/index\/index\/openurl(?:product)?\?[^'"`\s<>]+)/i,
    /(\/index\/index\/openurl(?:product)?\?[^'"`\s<>]+)/i,
    /(https?:\/\/[^'"`\s<>]+)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    const candidate = match?.[2] || match?.[1]
    const normalized = normalizeYeahPromosPromoUrl(candidate)
    if (normalized) return normalized
  }

  return null
}

function resolveYeahPromosPromoLinkFromCard(params: {
  candidateTexts: Array<string | null | undefined>
  cardHtml: string
}): string | null {
  for (const candidateText of params.candidateTexts) {
    const extracted = extractYeahPromosPromoLinkFromText(candidateText)
    if (extracted) return extracted
  }

  const cardHtml = decodeHtmlEntitiesForUrl(params.cardHtml || '')
  if (!cardHtml) return null

  const absoluteMatches = cardHtml.match(/https?:\/\/[^'"`\s<>]+/ig) || []
  for (const candidate of absoluteMatches) {
    if (!YEAHPROMOS_PROMO_PATH_PATTERN.test(candidate)) continue
    const normalized = normalizeYeahPromosPromoUrl(candidate)
    if (normalized) return normalized
  }

  const relativeMatches = cardHtml.match(/\/index\/index\/openurl(?:product)?\?[^'"`\s<>]+/ig) || []
  for (const candidate of relativeMatches) {
    const normalized = normalizeYeahPromosPromoUrl(candidate)
    if (normalized) return normalized
  }

  return null
}

function resolveYeahPromosProductMid(input: {
  pid: string | null
  applyProductId: string | null
  track: string | null
  asin: string | null
}): string | null {
  if (input.pid) return `pid_${input.pid}`
  if (input.applyProductId) return `product_${input.applyProductId}`
  if (input.asin) return `asin_${input.asin}`
  if (input.track) return `track_${input.track}`
  return null
}

function resolveYeahPromosKeyFieldsStatus(input: {
  brand: string | null
  asin: string | null
  priceAmount: number | null
  commissionRate: number | null
  promoLink: string | null
  reviewCount: number | null
}): {
  complete: boolean
  missing_fields: string[]
  last_checked_at: string
} {
  const missingFields: string[] = []
  if (!normalizeUrl(input.brand)) missingFields.push('brand')
  if (!normalizeAsin(input.asin)) missingFields.push('asin')
  if (input.priceAmount === null || !Number.isFinite(input.priceAmount)) missingFields.push('priceAmount')
  if (input.commissionRate === null || !Number.isFinite(input.commissionRate)) missingFields.push('commissionRate')
  if (!normalizeUrl(input.promoLink)) missingFields.push('promoLink')
  if (input.reviewCount === null || !Number.isFinite(input.reviewCount)) missingFields.push('reviewCount')

  return {
    complete: missingFields.length === 0,
    missing_fields: missingFields,
    last_checked_at: new Date().toISOString(),
  }
}

function parseYeahPromosProductHtmlPage(
  html: string,
  context?: {
    marketplace?: string | null
    country?: string | null
  }
): YeahPromosProductPageParseResult {
  const $ = loadHtml(html)
  const selectedMarketplaceCode = normalizeProxyCountryCode(String(
    context?.country
    || resolveYeahPromosMarketplaceCountry(
      normalizeYeahPromosMarketplace(context?.marketplace || '')
    )
    || $('select[name="market_place"] option:selected').attr('value')
    || ''
  ))
  const selectedSiteId = normalizeUrl(String(
    $('select[name="site"] option:selected').attr('value')
    || ''
  ))

  const noProductsFound = /No products found/i.test($.text())
  const pageNowText = normalizeUrl($('#pageList .page-num').first().text())
  const pageNowMatch = pageNowText?.match(/Page\s+(\d+)/i)
  const parsedPageNow = pageNowMatch?.[1]
    ? parseInteger(pageNowMatch[1], NaN)
    : null

  const nextPageHref = $('#pageList .pager li').last().find('a').attr('href')
  const parsedNextPage = extractYeahPromosPageNumberFromHref(nextPageHref)
  const nextPage = parsedNextPage
    && (!parsedPageNow || parsedNextPage > parsedPageNow)
    ? parsedNextPage
    : null

  const items: NormalizedAffiliateProduct[] = []
  for (const element of $('.adv-block .adv-content').toArray()) {
    const block = $(element)
    const body = block.find('.adv-main').first()
    if (!body.length) continue

    const productName = normalizeUrl(body.find('.adv-name').first().text())
    const asin = normalizeAsin(body.find('span').first().text())
    const brand = normalizeUrl(body.find('.col-xs-7 a').first().text())
    const priceText = normalizeUrl(
      body.find('.color-1136').first().text()
      || body.find('.col-xs-8 [class*="color"]').first().text()
      || body.find('.col-xs-8 .price').first().text()
      || body.find('.col-xs-8 .adv-price').first().text()
      || body.find('.col-xs-8 div').first().text()
    )
    const commissionText = normalizeUrl(body.find('.row').first().find('.col-xs-4 div').first().text())
    const ratingPanel = body.find('.rating-panel').first()
    const reviewCount = parseReviewCount(ratingPanel.text())
    const rating = parsePriceAmount(ratingPanel.attr('data-rating'))
    const joinStatus = normalizeUrl(block.find('.status-joined').first().text())
    const applyProductId = normalizeUrl(body.find('.apply-product').first().attr('data-product_id'))
    const promoLink = resolveYeahPromosPromoLinkFromCard({
      candidateTexts: [
        body.find('.adv-btn[onclick*="ClipboardJS.copy"]').first().attr('onclick'),
        body.find('.adv-btn[onclick*="copy"]').first().attr('onclick'),
        body.find('.adv-btn[data-clipboard-text]').first().attr('data-clipboard-text'),
        body.find('[data-clipboard-text]').first().attr('data-clipboard-text'),
        body.find('[data-copy-url]').first().attr('data-copy-url'),
        body.find('a[href*="/index/index/openurlproduct"]').first().attr('href'),
        body.find('a[href*="/index/index/openurl"]').first().attr('href'),
      ],
      cardHtml: block.html() || '',
    })
    const promoMeta = resolveYeahPromosPromoIdentifiers(promoLink)

    const mid = resolveYeahPromosProductMid({
      pid: promoMeta.pid,
      applyProductId,
      track: promoMeta.track,
      asin,
    })
    if (!mid) continue

    const priceAmount = parsePriceAmount(priceText)
    const priceCurrency = normalizeCurrencyUnit(
      String(priceText || '').split(/\s+/g)[0]
    ) || extractCurrencyUnitFromText(priceText)
    const commissionRate = parsePercentage(commissionText)
    const commissionAmount = computeCommissionAmount(priceAmount, commissionRate)
    const allowedCountries = selectedMarketplaceCode ? [selectedMarketplaceCode] : []
    const isConfirmedInvalid = resolveConfirmedInvalidFromSignals({
      advertStatus: null,
      status: null,
      availability: null,
      stockStatus: null,
      joinStatus,
      isAvailable: null,
      inStock: null,
      isOos: null,
    })

    items.push({
      platform: 'yeahpromos',
      mid,
      asin,
      brand,
      productName,
      productUrl: null,
      promoLink,
      shortPromoLink: null,
      allowedCountries,
      priceAmount,
      priceCurrency,
      commissionRate,
      commissionAmount,
      commissionRateMode: 'percent',
      reviewCount,
      isDeepLink: null,
      isConfirmedInvalid,
    })
  }

  return {
    items,
    pageNow: Number.isFinite(parsedPageNow as number) ? (parsedPageNow as number) : null,
    nextPage,
    noProductsFound,
  }
}

async function fetchYeahPromosProductsHtmlPageWithPlaywright(params: {
  pageUrl: string
  sessionCookie: string
  proxyProviderUrl: string
  country: string
}): Promise<string> {
  const { chromium } = await import('playwright')
  const proxy = await fetchProxyIp(params.proxyProviderUrl, 3, false)
  // 每次使用不同的浏览器指纹，避免被识别为同一客户端
  const fingerprint = generateRandomFingerprint()
  const browser = await chromium.launch({
    headless: true,
    proxy: {
      server: `http://${proxy.host}:${proxy.port}`,
      username: proxy.username,
      password: proxy.password,
    },
    args: ['--disable-http2', '--disable-quic', '--no-sandbox'],
    timeout: 60000,
  })

  try {
    const context = await browser.newContext({
      userAgent: fingerprint.userAgent,
      locale: fingerprint.language,
      extraHTTPHeaders: {
        Cookie: params.sessionCookie,
        Accept: fingerprint.accept,
        'Accept-Language': fingerprint.acceptLanguage,
      },
    })
    const page = await context.newPage()
    await page.goto(params.pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    const html = await page.content()
    const redirectedUrl = normalizeUrl(page.url()) || ''
    const isLoginRedirect = redirectedUrl.includes('/index/login/login')
      || redirectedUrl.includes('/index/index/login')
      || /action=\"\/index\/login\/login\"/i.test(html)
    if (isLoginRedirect) {
      throw new Error('YeahPromos 登录态已失效，请先在 /products 执行 YP 登录态采集')
    }
    return html
  } finally {
    await browser.close().catch(() => {})
  }
}

async function fetchYeahPromosProductsHtmlPage(params: {
  template: YeahPromosMarketplaceTemplate
  page: number
  sessionCookie: string
  rateLimitRetryOptions: YeahPromosRequestRateLimitOptions
  proxyProviderUrl: string
}): Promise<YeahPromosProductPageParseResult> {
  const pageUrl = buildYeahPromosProductsPageUrl(params.template.url, params.page)

  let attempt = 0
  const resolveRetryDelayMs = (retryAttempt: number, message: string): number => {
    const backoffDelayMs = calculateExponentialBackoffDelay(
      retryAttempt,
      params.rateLimitRetryOptions.baseDelayMs,
      params.rateLimitRetryOptions.maxDelayMs
    )
    if (!isYeahPromosRequestTooFastMessage(message)) {
      return backoffDelayMs
    }

    const minDelayForTooFastMs = Math.min(params.rateLimitRetryOptions.maxDelayMs, 5000 * retryAttempt)
    return Math.max(backoffDelayMs, minDelayForTooFastMs)
  }

  while (true) {
    let response: import('axios').AxiosResponse<string>
    try {
      const agent = await createYeahPromosProxyAgent({
        proxyProviderUrl: params.proxyProviderUrl,
        country: params.template.country,
        reason: `http:page=${params.page},attempt=${attempt + 1}`,
      })
      // 每次重试使用不同的浏览器指纹，避免被识别为同一客户端
      const fingerprint = generateRandomFingerprint()

      // 构建完整的 HTTP 头部（参考 browser-stealth.ts）
      const headers: Record<string, string> = {
        'Cookie': params.sessionCookie,
        'Accept': fingerprint.accept,
        'Accept-Language': fingerprint.acceptLanguage,
        'Accept-Encoding': fingerprint.acceptEncoding!,
        'User-Agent': fingerprint.userAgent,
        'Connection': fingerprint.connection!,
        'Upgrade-Insecure-Requests': fingerprint.upgradeInsecureRequests!,
        'Sec-Fetch-Dest': fingerprint.secFetchDest!,
        'Sec-Fetch-Mode': fingerprint.secFetchMode!,
        'Sec-Fetch-Site': fingerprint.secFetchSite!,
        'Sec-Fetch-User': fingerprint.secFetchUser!,
        'Cache-Control': fingerprint.cacheControl!,
        'DNT': fingerprint.dnt!,
      }

      // 只有 Chrome/Edge 才发送 Sec-CH-UA 头部
      if (fingerprint.secChUa) {
        headers['Sec-CH-UA'] = fingerprint.secChUa
        headers['Sec-CH-UA-Mobile'] = fingerprint.secChUaMobile!
        headers['Sec-CH-UA-Platform'] = fingerprint.secChUaPlatform!
      }

      response = await axios.get(pageUrl, {
        headers,
        httpsAgent: agent,
        httpAgent: agent,
        maxRedirects: 5,
        validateStatus: () => true,
        responseType: 'text',
        timeout: 60000,
      })
    } catch (error: any) {
      const message = String(error?.message || '网络请求失败')
      const isTransient = isTransientNetworkErrorMessage(message)
      if (isTransient && attempt < params.rateLimitRetryOptions.maxRetries) {
        attempt += 1
        const delayMs = resolveRetryDelayMs(attempt, message)
        console.warn(
          `[yeahpromos] transient network(scope=${params.template.scope}, page=${params.page}), retry ${attempt}/${params.rateLimitRetryOptions.maxRetries} after ${delayMs}ms`
        )
        await sleep(delayMs)
        continue
      }
      throw error
    }

    const html = typeof response.data === 'string' ? response.data : ''
    const snippet = html.replace(/\s+/g, ' ').trim().slice(0, 220)

    const redirectedUrl = normalizeUrl(response.request?.res?.responseUrl) || ''
    const isLoginRedirect = redirectedUrl.includes('/index/login/login')
      || redirectedUrl.includes('/index/index/login')
      || /action=\"\/index\/login\/login\"/i.test(html)
    if (isLoginRedirect) {
      throw new Error('YeahPromos 登录态已失效，请先在 /products 执行 YP 登录态采集')
    }

    const isOk = response.status >= 200 && response.status < 300
    const interceptCheck = detectYeahPromosHttpIntercept({
      status: response.status,
      html,
    })

    const shouldTryPlaywright = response.status === 403
      || response.status === 429
      || (isOk && interceptCheck.blocked)
    if (shouldTryPlaywright) {
      try {
        const playwrightHtml = await fetchYeahPromosProductsHtmlPageWithPlaywright({
          pageUrl,
          sessionCookie: params.sessionCookie,
          proxyProviderUrl: params.proxyProviderUrl,
          country: params.template.country,
        })
        return parseYeahPromosProductHtmlPage(playwrightHtml, {
          marketplace: params.template.marketplace,
          country: params.template.country,
        })
      } catch (playwrightError: any) {
        const message = String(playwrightError?.message || playwrightError)
        if (attempt < params.rateLimitRetryOptions.maxRetries) {
          attempt += 1
          const delayMs = resolveRetryDelayMs(attempt, message)
          console.warn(
            `[yeahpromos] playwright fallback failed(scope=${params.template.scope}, page=${params.page}), retry ${attempt}/${params.rateLimitRetryOptions.maxRetries} after ${delayMs}ms`
          )
          await sleep(delayMs)
          continue
        }
        throw new Error(
          `YeahPromos 产品页 Playwright 回退失败(scope=${params.template.scope}, page=${params.page}): ${message}`
        )
      }
    }

    if (!isOk) {
      const failureMessage = `YeahPromos 产品页拉取失败(scope=${params.template.scope}, page=${params.page}, status=${response.status}): ${snippet || '请求失败'}`
      if (isTransientHttpStatus(response.status) && attempt < params.rateLimitRetryOptions.maxRetries) {
        attempt += 1
        const delayMs = resolveRetryDelayMs(attempt, failureMessage)
        console.warn(
          `[yeahpromos] transient http(scope=${params.template.scope}, page=${params.page}), retry ${attempt}/${params.rateLimitRetryOptions.maxRetries} after ${delayMs}ms`
        )
        await sleep(delayMs)
        continue
      }
      throw new Error(failureMessage)
    }

    if (interceptCheck.blocked) {
      const message = `YeahPromos 产品页疑似风控(scope=${params.template.scope}, page=${params.page}, reason=${interceptCheck.reason || 'unknown'})`
      if (attempt < params.rateLimitRetryOptions.maxRetries) {
        attempt += 1
        const delayMs = resolveRetryDelayMs(attempt, message)
        console.warn(
          `[yeahpromos] intercept(scope=${params.template.scope}, page=${params.page}), retry ${attempt}/${params.rateLimitRetryOptions.maxRetries} after ${delayMs}ms`
        )
        await sleep(delayMs)
        continue
      }
      throw new Error(message)
    }

    return parseYeahPromosProductHtmlPage(html, {
      marketplace: params.template.marketplace,
      country: params.template.country,
    })
  }
}

function resolveYeahPromosSyncSessionMinRemainingMs(params: {
  startPage?: number
  startScope?: string
}): number {
  const startPage = Number(params.startPage || 0)
  const hasStartScope = String(params.startScope || '').trim().length > 0
  const isResumeWindow = startPage > 1 || hasStartScope
  return isResumeWindow
    ? YP_SESSION_MIN_REMAINING_MS_RESUME
    : YP_SESSION_MIN_REMAINING_MS_INITIAL
}

function resolveYeahPromosConsecutiveFailureStrategy(params: {
  skipFailedPages: boolean
  fetchedItemsInWindow: number
}): 'skip-page' | 'fail-sync' {
  if (!params.skipFailedPages) return 'fail-sync'
  if (params.fetchedItemsInWindow <= 0) return 'fail-sync'
  return 'skip-page'
}

async function fetchYeahPromosPromotableProductsWithMeta(params: {
  userId: number
  startPage?: number
  startScope?: string
  maxPages?: number
  suppressMaxPagesWarning?: boolean
  templatesOverride?: YeahPromosMarketplaceTemplate[]
  scopePageBudgets?: Record<string, number>
  fetchStores?: boolean
  refreshAccessProductsBaseline?: boolean
  onFetchProgress?: (fetchedCount: number) => Promise<void> | void
}): Promise<YeahPromosProductsFetchResult> {
  const check = await checkAffiliatePlatformConfig(params.userId, 'yeahpromos')
  ensurePlatformConfigured(check, 'yeahpromos')

  const siteId = check.values.yeahpromos_site_id
  const token = check.values.yeahpromos_token
  const sessionCookie = await getYeahPromosSessionCookieForSync(params.userId)
  if (!sessionCookie) {
    throw new Error('YeahPromos 登录态缺失或已过期，请先在 /products 完成 YP 登录态采集')
  }

  const minSessionRemainingMs = resolveYeahPromosSyncSessionMinRemainingMs({
    startPage: params.startPage,
    startScope: params.startScope,
  })

  // 导入session检查函数
  const { checkYeahPromosSessionValidForSync } = await import('@/lib/yeahpromos-session')
  const sessionCheck = await checkYeahPromosSessionValidForSync(params.userId, minSessionRemainingMs)
  if (!sessionCheck.valid) {
    const remainingMinutes = sessionCheck.remainingMs ? Math.floor(sessionCheck.remainingMs / 60000) : 0
    const requiredMinutes = Math.floor(minSessionRemainingMs / 60000)
    throw new Error(
      sessionCheck.isExpired
        ? 'YeahPromos 登录态已过期，同步任务终止'
        : `YeahPromos 登录态即将过期（剩余 ${remainingMinutes} 分钟，当前窗口需要至少 ${requiredMinutes} 分钟），同步任务终止以避免中途失败`
    )
  }

  const templates = params.templatesOverride?.length
    ? params.templatesOverride.map((template) => ({ ...template }))
    : await loadYeahPromosMarketplaceTemplates({
        userId: params.userId,
        preloadedSettings: check.values,
      })
  const countryProxyMap = await loadYeahPromosCountryProxyMap(params.userId)

  const baselineTemplate = templates.find(
    (item) => Boolean(resolveYeahPromosProxyProviderUrl(countryProxyMap, item.country))
  )
  const shouldRefreshAccessProductsBaseline = params.refreshAccessProductsBaseline ?? true
  if (shouldRefreshAccessProductsBaseline && baselineTemplate && siteId) {
    try {
      const baselineProxyUrl = resolveYeahPromosProxyProviderUrl(countryProxyMap, baselineTemplate.country)
      if (baselineProxyUrl) {
        const proxyAgent = await createYeahPromosProxyAgent({
          proxyProviderUrl: baselineProxyUrl,
          country: baselineTemplate.country,
          reason: 'refresh-access-products-baseline',
        })
        await fetchYeahPromosAccessProductsCount({
          userId: params.userId,
          siteId,
          sessionCookie,
          proxyAgent,
        })
      }
    } catch (error: any) {
      console.warn('[yeahpromos] failed to refresh Access Products baseline:', error?.message || error)
    }
  }

  const requestDelayMs = parseIntegerInRange(
    check.values.yeahpromos_request_delay_ms || String(DEFAULT_YP_PRODUCTS_REQUEST_DELAY_MS),
    DEFAULT_YP_PRODUCTS_REQUEST_DELAY_MS,
    MIN_YP_PRODUCTS_REQUEST_DELAY_MS,
    MAX_YP_PRODUCTS_REQUEST_DELAY_MS
  )
  const requestDelayJitterMs = parseIntegerInRange(
    String(DEFAULT_YP_PRODUCTS_DELAY_JITTER_MS),
    DEFAULT_YP_PRODUCTS_DELAY_JITTER_MS,
    0,
    MAX_YP_PRODUCTS_DELAY_JITTER_MS
  )
  const rateLimitRetryOptions: YeahPromosRequestRateLimitOptions = {
    maxRetries: parseIntegerInRange(
      check.values.yeahpromos_rate_limit_max_retries || String(DEFAULT_YP_RATE_LIMIT_MAX_RETRIES),
      DEFAULT_YP_RATE_LIMIT_MAX_RETRIES,
      0,
      10
    ),
    baseDelayMs: parseIntegerInRange(
      check.values.yeahpromos_rate_limit_base_delay_ms || String(DEFAULT_YP_RATE_LIMIT_BASE_DELAY_MS),
      DEFAULT_YP_RATE_LIMIT_BASE_DELAY_MS,
      100,
      60000
    ),
    maxDelayMs: parseIntegerInRange(
      check.values.yeahpromos_rate_limit_max_delay_ms || String(DEFAULT_YP_RATE_LIMIT_MAX_DELAY_MS),
      DEFAULT_YP_RATE_LIMIT_MAX_DELAY_MS,
      500,
      120000
    ),
  }

  // 读取是否跳过连续失败的页面配置
  // 默认为 true，避免因 YeahPromos 服务器端问题导致整个同步中止
  const skipFailedPages = parseBooleanSetting(
    check.values.yeahpromos_skip_failed_pages,
    DEFAULT_YP_SKIP_FAILED_PAGES
  )

  const maxPages = resolveSyncMaxPages(params.maxPages, null, MAX_YP_SYNC_MAX_PAGES)
  const configuredStartPage = Math.max(1, parseInteger(check.values.yeahpromos_page || '1', 1))
  const storePageSize = parseIntegerInRange(
    check.values.yeahpromos_limit || '1000',
    1000,
    1,
    1000
  )
  const scopePageBudgets = new Map<string, number>()
  if (params.scopePageBudgets) {
    for (const [scope, rawBudget] of Object.entries(params.scopePageBudgets)) {
      const normalizedScope = normalizeYeahPromosMarketplace(scope)
      const normalizedBudget = Math.max(0, Math.trunc(Number(rawBudget || 0)))
      if (!normalizedScope || normalizedBudget <= 0) continue
      scopePageBudgets.set(normalizedScope, normalizedBudget)
    }
  }
  const startScope = normalizeYeahPromosMarketplace(params.startScope || '')
  const shouldFetchStores = params.fetchStores ?? (!startScope && Math.max(
    1,
    parseInteger(
      params.startPage,
      startScope ? 1 : configuredStartPage
    )
  ) <= 1)
  const resolvedStartScopeIndex = startScope
    ? templates.findIndex((item) => item.scope === startScope)
    : 0
  let scopeIndex = resolvedStartScopeIndex >= 0 ? resolvedStartScopeIndex : 0
  let page = Math.max(
    1,
    parseInteger(
      params.startPage,
      startScope ? 1 : configuredStartPage
    )
  )
  let fetchedPages = 0
  let consecutiveScopeFailureCount = 0
  let consecutiveEmptyPagesInScope = 0  // 当前市场连续空页面计数
  const fetchedPagesByScope = new Map<string, number>()

  const items: NormalizedAffiliateProduct[] = []
  let lastFetchProgressCount = 0

  const emitFetchProgress = async (force: boolean = false): Promise<void> => {
    if (!params.onFetchProgress) return
    if (!force && items.length === lastFetchProgressCount) return
    lastFetchProgressCount = items.length
    try {
      await params.onFetchProgress(items.length)
    } catch (error: any) {
      console.warn('[yeahpromos] onFetchProgress callback failed:', error?.message || error)
    }
  }

  while (
    scopeIndex < templates.length
    && (maxPages === null || fetchedPages < maxPages)
  ) {
    const currentTemplate = templates[scopeIndex]
    const currentPage = page
    const proxyProviderUrl = resolveYeahPromosProxyProviderUrl(countryProxyMap, currentTemplate.country)

    if (!proxyProviderUrl) {
      console.warn(
        `[yeahpromos] skip scope=${currentTemplate.scope}: missing proxy for country=${currentTemplate.country}`
      )
      scopeIndex += 1
      page = 1
      consecutiveScopeFailureCount = 0
      consecutiveEmptyPagesInScope = 0
      continue
    }

    try {
      const parsed = await fetchYeahPromosProductsHtmlPage({
        template: currentTemplate,
        page: currentPage,
        sessionCookie,
        rateLimitRetryOptions,
        proxyProviderUrl,
      })
      items.push(...parsed.items)
      fetchedPages += 1
      const currentScopeFetchedPages = (fetchedPagesByScope.get(currentTemplate.scope) || 0) + 1
      fetchedPagesByScope.set(currentTemplate.scope, currentScopeFetchedPages)

      // 检查本页是否返回了商品
      const pageHasItems = parsed.items.length > 0

      if (!pageHasItems) {
        consecutiveEmptyPagesInScope += 1
        console.log(
          `[yeahpromos] scope=${currentTemplate.scope} page=${currentPage} returned empty (${consecutiveEmptyPagesInScope}/${MAX_YP_CONSECUTIVE_EMPTY_PAGES_PER_SCOPE})`
        )
      } else {
        consecutiveEmptyPagesInScope = 0
      }

      const parsedNextPage = parsed.nextPage
      const hasNextPage = Number.isFinite(parsedNextPage as number) && (parsedNextPage as number) > currentPage
      const scopePageBudget = scopePageBudgets.get(currentTemplate.scope)
      const scopeBudgetReached = scopePageBudget !== undefined
        && currentScopeFetchedPages >= scopePageBudget

      // 切换市场的条件：
      // 1. 页面明确标记没有商品且返回空列表
      // 2. 连续多页返回空列表（避免在已抓完的市场无限翻页）
      // 3. 页面没有下一页链接
      const shouldSwitchScope =
        scopeBudgetReached ||
        (parsed.noProductsFound && parsed.items.length === 0) ||
        consecutiveEmptyPagesInScope >= MAX_YP_CONSECUTIVE_EMPTY_PAGES_PER_SCOPE ||
        !hasNextPage

      if (shouldSwitchScope) {
        if (scopeBudgetReached) {
          console.log(
            `[yeahpromos] switching from scope=${currentTemplate.scope} to next scope: reached delta page budget ${scopePageBudget}`
          )
        }
        if (consecutiveEmptyPagesInScope >= MAX_YP_CONSECUTIVE_EMPTY_PAGES_PER_SCOPE) {
          console.log(
            `[yeahpromos] switching from scope=${currentTemplate.scope} to next scope: ${consecutiveEmptyPagesInScope} consecutive empty pages`
          )
        }
        scopeIndex += 1
        page = 1
        consecutiveScopeFailureCount = 0
        consecutiveEmptyPagesInScope = 0
      } else {
        page = parsedNextPage as number
        consecutiveScopeFailureCount = 0
      }
    } catch (error: any) {
      fetchedPages += 1
      consecutiveScopeFailureCount += 1
      console.warn(
        `[yeahpromos] skip failed page scope=${currentTemplate.scope}, page=${currentPage}: ${error?.message || error}`
      )
      if (consecutiveScopeFailureCount >= MAX_YP_EMPTY_PAGE_STREAK) {
        const reason = error?.message || error

        if (resolveYeahPromosConsecutiveFailureStrategy({
          skipFailedPages,
          fetchedItemsInWindow: items.length,
        }) === 'skip-page') {
          // 跳过当前页面，继续下一页，避免因服务器端问题导致整个同步中止
          console.warn(
            `[yeahpromos] 连续失败 ${consecutiveScopeFailureCount} 次，跳过当前页面继续同步 (scope=${currentTemplate.scope}, page=${currentPage})`
          )
          page = currentPage + 1
          consecutiveScopeFailureCount = 0
        } else {
          const noItemsWarning = items.length === 0 && skipFailedPages
            ? '当前窗口尚未抓到任何商品，不允许静默跳页；'
            : ''
          // 避免静默跳过整个 scope 导致”completed 但漏抓大量页面”。
          // 连续失败达到阈值时直接抛错，让任务进入 failed 并由续跑逻辑从当前 cursor 重试。
          throw new Error(
            `YeahPromos scope=${currentTemplate.scope} page=${currentPage} 连续失败 ${consecutiveScopeFailureCount} 次，${noItemsWarning}已中止同步以避免漏抓。最后错误: ${reason}`
          )
        }
      } else {
        // 失败时保持当前页，下一轮更换代理后重试同一页，避免跳页漏抓。
        page = currentPage
      }
    }

    const hasMoreCandidates = scopeIndex < templates.length
    if (fetchedPages === 1 || fetchedPages % 3 === 0 || !hasMoreCandidates) {
      await emitFetchProgress()
    }

    if (hasMoreCandidates && (maxPages === null || fetchedPages < maxPages)) {
      const jitterMs = requestDelayJitterMs > 0
        ? randomIntInRange(-requestDelayJitterMs, requestDelayJitterMs)
        : 0
      const effectiveDelayMs = Math.max(0, requestDelayMs + jitterMs)
      if (effectiveDelayMs > 0) {
        await sleep(effectiveDelayMs)
      }
    }
  }

  const hasMore = scopeIndex < templates.length
  const nextScope = hasMore ? templates[scopeIndex]?.scope || null : null
  const nextPage = hasMore ? Math.max(1, page) : 0

  if (maxPages !== null && hasMore && fetchedPages >= maxPages && !params.suppressMaxPagesWarning) {
    console.warn(`[yeahpromos] reached page limit (${maxPages}); product results may be truncated`)
  }

  if (shouldFetchStores && token && siteId) {
    try {
      const storeItems = await fetchYeahPromosPromotableStores({
        token,
        siteId,
        pageSize: storePageSize,
        requestDelayMs,
        rateLimitRetryOptions,
        onFetchProgress: async (fetchedStoreCount) => {
          if (!params.onFetchProgress) return
          await params.onFetchProgress(items.length + fetchedStoreCount)
        },
      })
      items.push(...storeItems)
    } catch (error: any) {
      // 店铺信息拉取失败不应中断商品同步主流程
      console.warn('[yeahpromos] failed to fetch store merchants:', error?.message || error)
    }
  }

  await emitFetchProgress(true)

  return {
    items,
    hasMore,
    nextPage,
    nextScope,
    fetchedPages,
  }
}

async function fetchYeahPromosPromotableProducts(params: {
  userId: number
  startPage?: number
  startScope?: string
  maxPages?: number
  suppressMaxPagesWarning?: boolean
  templatesOverride?: YeahPromosMarketplaceTemplate[]
  scopePageBudgets?: Record<string, number>
  fetchStores?: boolean
  refreshAccessProductsBaseline?: boolean
  onFetchProgress?: (fetchedCount: number) => Promise<void> | void
}): Promise<NormalizedAffiliateProduct[]> {
  const result = await fetchYeahPromosPromotableProductsWithMeta(params)
  return result.items
}

function dedupeNormalizedProducts(items: NormalizedAffiliateProduct[]): NormalizedAffiliateProduct[] {
  const deduped = new Map<string, NormalizedAffiliateProduct>()
  for (const item of items) {
    if (!item.mid) continue
    const key = `${item.platform}:${item.mid}`
    const existing = deduped.get(key)
    if (!existing) {
      deduped.set(key, {
        ...item,
        allowedCountries: normalizeCountries(item.allowedCountries),
      })
      continue
    }

    const mergedAllowedCountries = normalizeCountries([
      ...existing.allowedCountries,
      ...item.allowedCountries,
    ])

    const merged: NormalizedAffiliateProduct = {
      ...existing,
      merchantId: existing.merchantId || item.merchantId || null,
      asin: existing.asin || item.asin,
      brand: existing.brand || item.brand,
      productName: existing.productName || item.productName,
      productUrl: existing.productUrl || item.productUrl,
      promoLink: existing.promoLink || item.promoLink,
      shortPromoLink: existing.shortPromoLink || item.shortPromoLink,
      allowedCountries: mergedAllowedCountries,
      priceAmount: existing.priceAmount ?? item.priceAmount,
      priceCurrency: existing.priceCurrency || item.priceCurrency,
      commissionRate: existing.commissionRate ?? item.commissionRate,
      commissionAmount: existing.commissionAmount ?? item.commissionAmount,
      commissionRateMode: existing.commissionRateMode || item.commissionRateMode,
      reviewCount: existing.reviewCount ?? item.reviewCount,
      isDeepLink: existing.isDeepLink ?? item.isDeepLink,
      isConfirmedInvalid: existing.isConfirmedInvalid || item.isConfirmedInvalid,
    }

    deduped.set(key, merged)
  }
  return Array.from(deduped.values())
}

async function loadExistingMidSet(userId: number, platform: AffiliatePlatform, mids: string[]): Promise<Set<string>> {
  if (mids.length === 0) return new Set<string>()
  const db = await getDatabase()
  const existing = new Set<string>()
  const dedupedMids = Array.from(new Set(
    mids
      .map((mid) => String(mid || '').trim())
      .filter(Boolean)
  ))
  if (dedupedMids.length === 0) return existing

  // 避免 PostgreSQL 参数上限（65534）与 SQLite 变量上限导致大批量同步失败。
  const batchSize = db.type === 'postgres' ? 10000 : 500
  for (let index = 0; index < dedupedMids.length; index += batchSize) {
    const batch = dedupedMids.slice(index, index + batchSize)
    if (batch.length === 0) continue

    const placeholders = batch.map(() => '?').join(', ')
    const rows = await db.query<{ mid: string }>(
      `
        SELECT mid
        FROM affiliate_products
        WHERE user_id = ?
          AND platform = ?
          AND mid IN (${placeholders})
      `,
      [userId, platform, ...batch]
    )

    for (const row of rows) {
      if (row?.mid) {
        existing.add(row.mid)
      }
    }
  }

  return existing
}

async function getPartnerboostDeltaSyncSettings(userId: number): Promise<{
  asinBatchSize: number
  activeDays: number
}> {
  const [asinBatchSetting, activeDaysSetting] = await Promise.all([
    getUserOnlySetting('system', 'affiliate_pb_delta_asin_batch_size', userId),
    getUserOnlySetting('system', 'affiliate_pb_active_days', userId),
  ])

  const asinBatchSize = parseIntegerInRange(
    asinBatchSetting?.value || String(DEFAULT_PB_DELTA_ASIN_BATCH_SIZE),
    DEFAULT_PB_DELTA_ASIN_BATCH_SIZE,
    10,
    MAX_PB_DELTA_ASIN_BATCH_SIZE
  )
  const activeDays = parseIntegerInRange(
    activeDaysSetting?.value || String(DEFAULT_PB_ACTIVE_DAYS),
    DEFAULT_PB_ACTIVE_DAYS,
    1,
    MAX_PB_ACTIVE_DAYS
  )

  return {
    asinBatchSize,
    activeDays,
  }
}

async function listActivePartnerboostAsins(userId: number, activeDays: number): Promise<string[]> {
  const db = await getDatabase()
  const recentDays = Math.max(1, activeDays)
  const isBlacklistedCondition = db.type === 'postgres'
    ? 'p.is_blacklisted = FALSE'
    : 'p.is_blacklisted = 0'
  const recentUpdatedCondition = db.type === 'postgres'
    ? `p.updated_at >= CURRENT_TIMESTAMP - INTERVAL '${recentDays} days'`
    : `p.updated_at >= datetime('now', '-${recentDays} days')`
  const recentReportDateCondition = db.type === 'postgres'
    ? `report_date >= CURRENT_DATE - INTERVAL '${Math.max(0, recentDays - 1)} days'`
    : `report_date >= date('now', '-${Math.max(0, recentDays - 1)} days')`

  const rows = await db.query<{ asin: string | null }>(
    `
      SELECT DISTINCT p.asin
      FROM affiliate_products p
      WHERE p.user_id = ?
        AND p.platform = 'partnerboost'
        AND ${isBlacklistedCondition}
        AND p.asin IS NOT NULL
        AND TRIM(p.asin) <> ''
        AND (
          EXISTS (
            SELECT 1
            FROM affiliate_product_offer_links l
            WHERE l.user_id = p.user_id
              AND l.product_id = p.id
            LIMIT 1
          )
          OR ${recentUpdatedCondition}
        )
      ORDER BY p.asin
    `,
    [userId]
  )

  const recentOrderRows = await db.query<{ asin: string | null }>(
    `
      SELECT DISTINCT source_asin AS asin
      FROM affiliate_commission_attributions
      WHERE user_id = ?
        AND platform = 'partnerboost'
        AND source_asin IS NOT NULL
        AND TRIM(source_asin) <> ''
        AND ${recentReportDateCondition}
      UNION
      SELECT DISTINCT source_asin AS asin
      FROM openclaw_affiliate_attribution_failures
      WHERE user_id = ?
        AND platform = 'partnerboost'
        AND source_asin IS NOT NULL
        AND TRIM(source_asin) <> ''
        AND ${recentReportDateCondition}
    `,
    [userId, userId]
  )

  const asins: string[] = []
  const seen = new Set<string>()
  for (const row of [...rows, ...recentOrderRows]) {
    const asin = normalizeAsin(row.asin)
    if (!asin || seen.has(asin)) continue
    seen.add(asin)
    asins.push(asin)
  }
  return asins
}

async function fetchPartnerboostDeltaProducts(params: {
  userId: number
  onFetchProgress?: (fetchedCount: number) => Promise<void> | void
}): Promise<NormalizedAffiliateProduct[]> {
  const settings = await getPartnerboostDeltaSyncSettings(params.userId)
  const asins = await listActivePartnerboostAsins(params.userId, settings.activeDays)
  if (asins.length === 0) {
    if (params.onFetchProgress) {
      await params.onFetchProgress(0)
    }
    return []
  }

  const normalizedItems: NormalizedAffiliateProduct[] = []
  const batchSize = Math.max(10, settings.asinBatchSize)

  for (let index = 0; index < asins.length; index += batchSize) {
    const batch = asins.slice(index, index + batchSize)
    const batchItems = await fetchPartnerboostPromotableProducts({
      userId: params.userId,
      asins: batch,
      maxPages: 1,
      onFetchProgress: async (fetchedCount: number) => {
        if (!params.onFetchProgress) return
        await params.onFetchProgress(normalizedItems.length + fetchedCount)
      },
    })
    normalizedItems.push(...batchItems)

    if (params.onFetchProgress) {
      await params.onFetchProgress(normalizedItems.length)
    }
  }

  return normalizedItems
}

async function getYeahPromosDeltaSyncSettings(userId: number): Promise<{
  activeDays: number
  maxPages: number
}> {
  const [activeDaysSetting, maxPagesSetting] = await Promise.all([
    getUserOnlySetting('system', 'affiliate_yp_active_days', userId),
    getUserOnlySetting('system', 'affiliate_yp_delta_max_pages', userId),
  ])
  const activeDays = parseIntegerInRange(
    activeDaysSetting?.value || String(DEFAULT_YP_ACTIVE_DAYS),
    DEFAULT_YP_ACTIVE_DAYS,
    1,
    MAX_YP_ACTIVE_DAYS
  )
  const maxPages = parseIntegerInRange(
    maxPagesSetting?.value || String(DEFAULT_YP_DELTA_MAX_PAGES),
    DEFAULT_YP_DELTA_MAX_PAGES,
    1,
    MAX_YP_SYNC_MAX_PAGES
  )

  return {
    activeDays,
    maxPages,
  }
}

async function listActiveYeahPromosScopes(params: {
  userId: number
  activeDays: number
  templates: YeahPromosMarketplaceTemplate[]
}): Promise<string[]> {
  if (params.templates.length === 0) return []

  const db = await getDatabase()
  const recentDays = Math.max(1, params.activeDays)
  const isBlacklistedCondition = db.type === 'postgres'
    ? 'p.is_blacklisted = FALSE'
    : 'p.is_blacklisted = 0'
  const recentSeenCondition = db.type === 'postgres'
    ? `COALESCE(p.last_seen_at, p.last_synced_at, p.updated_at) >= CURRENT_TIMESTAMP - INTERVAL '${recentDays} days'`
    : `COALESCE(p.last_seen_at, p.last_synced_at, p.updated_at) >= datetime('now', '-${recentDays} days')`

  const rows = await db.query<{
    allowed_countries_json: string | null
    product_count: number | string | null
    latest_activity_at: string | null
  }>(
    `
      SELECT
        p.allowed_countries_json,
        COUNT(*) AS product_count,
        MAX(COALESCE(p.last_seen_at, p.last_synced_at, p.updated_at)) AS latest_activity_at
      FROM affiliate_products p
      WHERE p.user_id = ?
        AND p.platform = 'yeahpromos'
        AND ${isBlacklistedCondition}
        AND (
          EXISTS (
            SELECT 1
            FROM affiliate_product_offer_links l
            WHERE l.user_id = p.user_id
              AND l.product_id = p.id
            LIMIT 1
          )
          OR ${recentSeenCondition}
        )
      GROUP BY p.allowed_countries_json
    `,
    [params.userId]
  )

  const scopesByCountry = new Map<string, string[]>()
  const templateOrder = new Map<string, number>()
  for (const [index, template] of params.templates.entries()) {
    templateOrder.set(template.scope, index)
    const countryScopes = scopesByCountry.get(template.country) || []
    countryScopes.push(template.scope)
    scopesByCountry.set(template.country, countryScopes)
  }

  const scores = new Map<string, { score: number; latestActivityAtMs: number }>()
  for (const row of rows) {
    const countries = parseAllowedCountries(row.allowed_countries_json)
    const rowScore = Math.max(1, Number(row.product_count || 0))
    const latestActivityAtMs = Date.parse(String(row.latest_activity_at || '')) || 0

    for (const country of countries) {
      const matchedScopes = scopesByCountry.get(country)
      if (!matchedScopes?.length) continue
      for (const scope of matchedScopes) {
        const current = scores.get(scope) || { score: 0, latestActivityAtMs: 0 }
        current.score += rowScore
        current.latestActivityAtMs = Math.max(current.latestActivityAtMs, latestActivityAtMs)
        scores.set(scope, current)
      }
    }
  }

  return Array.from(scores.entries())
    .sort((left, right) => {
      if (right[1].score !== left[1].score) {
        return right[1].score - left[1].score
      }
      if (right[1].latestActivityAtMs !== left[1].latestActivityAtMs) {
        return right[1].latestActivityAtMs - left[1].latestActivityAtMs
      }
      return (templateOrder.get(left[0]) || 0) - (templateOrder.get(right[0]) || 0)
    })
    .map(([scope]) => scope)
}

async function fetchYeahPromosDeltaProducts(params: {
  userId: number
  onFetchProgress?: (fetchedCount: number) => Promise<void> | void
}): Promise<NormalizedAffiliateProduct[]> {
  const settings = await getYeahPromosDeltaSyncSettings(params.userId)
  const templates = await loadYeahPromosMarketplaceTemplates({ userId: params.userId })
  const activeScopes = await listActiveYeahPromosScopes({
    userId: params.userId,
    activeDays: settings.activeDays,
    templates,
  })
  const deltaPlan = buildYeahPromosDeltaScopePlan({
    templates,
    activeScopes,
    maxPages: settings.maxPages,
  })

  if (deltaPlan.templates.length === 0) {
    if (params.onFetchProgress) {
      await params.onFetchProgress(0)
    }
    return []
  }

  return await fetchYeahPromosPromotableProducts({
    userId: params.userId,
    maxPages: settings.maxPages,
    templatesOverride: deltaPlan.templates,
    scopePageBudgets: deltaPlan.scopePageBudgets,
    fetchStores: false,
    refreshAccessProductsBaseline: false,
    onFetchProgress: params.onFetchProgress,
  })
}

function getAffiliateProductsUpsertBatchSize(dbType: 'sqlite' | 'postgres'): number {
  return dbType === 'postgres'
    ? DEFAULT_UPSERT_BATCH_SIZE_POSTGRES
    : DEFAULT_UPSERT_BATCH_SIZE_SQLITE
}

function buildAffiliateProductsUpsertValues(params: {
  userId: number
  platform: AffiliatePlatform
  items: NormalizedAffiliateProduct[]
  nowIso: string
}): any[] {
  const values: any[] = []
  for (const item of params.items) {
    values.push(
      params.userId,
      params.platform,
      item.mid,
      item.merchantId || null,
      item.asin,
      item.brand,
      item.productName,
      item.productUrl,
      item.promoLink,
      item.shortPromoLink,
      JSON.stringify(item.allowedCountries || []),
      item.priceAmount,
      item.priceCurrency,
      item.commissionRate,
      item.commissionAmount,
      item.commissionRateMode,
      item.reviewCount,
      item.isDeepLink,
      item.isConfirmedInvalid,
      params.nowIso,
      params.nowIso,
      params.nowIso
    )
  }
  return values
}

function buildAffiliateProductsBusinessChangedSql(params: {
  existingAlias: string
  incomingAlias: string
  dbType: 'sqlite' | 'postgres'
}): string {
  const comparator = params.dbType === 'postgres'
    ? 'IS DISTINCT FROM'
    : 'IS NOT'

  const fields: Array<[string, string]> = [
    ['merchant_id', 'merchant_id'],
    ['asin', 'asin'],
    ['brand', 'brand'],
    ['product_name', 'product_name'],
    ['product_url', 'product_url'],
    ['promo_link', 'promo_link'],
    ['short_promo_link', 'short_promo_link'],
    ['allowed_countries_json', 'allowed_countries_json'],
    ['price_amount', 'price_amount'],
    ['price_currency', 'price_currency'],
    ['commission_rate', 'commission_rate'],
    ['commission_amount', 'commission_amount'],
    ['commission_rate_mode', 'commission_rate_mode'],
    ['review_count', 'review_count'],
    ['is_deeplink', 'is_deeplink'],
    ['is_confirmed_invalid', 'is_confirmed_invalid'],
  ]

  return fields
    .map(([existingColumn, incomingColumn]) => (
      `${params.existingAlias}.${existingColumn} ${comparator} ${params.incomingAlias}.${incomingColumn}`
    ))
    .join('\n          OR ')
}

async function upsertAffiliateProductsChunkOnConflict(params: {
  db: DatabaseAdapter
  userId: number
  platform: AffiliatePlatform
  items: NormalizedAffiliateProduct[]
  nowIso: string
}): Promise<void> {
  if (params.items.length === 0) return

  const perRowPlaceholder = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  const placeholders = new Array(params.items.length).fill(perRowPlaceholder).join(', ')
  const values = buildAffiliateProductsUpsertValues(params)
  const businessChangedSql = buildAffiliateProductsBusinessChangedSql({
    existingAlias: 'affiliate_products',
    incomingAlias: 'EXCLUDED',
    dbType: params.db.type,
  })
  const timestampDistinctComparator = params.db.type === 'postgres'
    ? 'IS DISTINCT FROM'
    : 'IS NOT'

  await params.db.exec(`
    INSERT INTO affiliate_products (
      user_id,
      platform,
      mid,
      merchant_id,
      asin,
      brand,
      product_name,
      product_url,
      promo_link,
      short_promo_link,
      allowed_countries_json,
      price_amount,
      price_currency,
      commission_rate,
      commission_amount,
      commission_rate_mode,
      review_count,
      is_deeplink,
      is_confirmed_invalid,
      last_synced_at,
      last_seen_at,
      updated_at
    )
    VALUES ${placeholders}
    ON CONFLICT (user_id, platform, mid) DO UPDATE SET
      merchant_id = CASE
        WHEN (
          ${businessChangedSql}
        ) THEN EXCLUDED.merchant_id
        ELSE affiliate_products.merchant_id
      END,
      asin = CASE
        WHEN (
          ${businessChangedSql}
        ) THEN EXCLUDED.asin
        ELSE affiliate_products.asin
      END,
      brand = CASE
        WHEN (
          ${businessChangedSql}
        ) THEN EXCLUDED.brand
        ELSE affiliate_products.brand
      END,
      product_name = CASE
        WHEN (
          ${businessChangedSql}
        ) THEN EXCLUDED.product_name
        ELSE affiliate_products.product_name
      END,
      product_url = CASE
        WHEN (
          ${businessChangedSql}
        ) THEN EXCLUDED.product_url
        ELSE affiliate_products.product_url
      END,
      promo_link = CASE
        WHEN (
          ${businessChangedSql}
        ) THEN EXCLUDED.promo_link
        ELSE affiliate_products.promo_link
      END,
      short_promo_link = CASE
        WHEN (
          ${businessChangedSql}
        ) THEN EXCLUDED.short_promo_link
        ELSE affiliate_products.short_promo_link
      END,
      allowed_countries_json = CASE
        WHEN (
          ${businessChangedSql}
        ) THEN EXCLUDED.allowed_countries_json
        ELSE affiliate_products.allowed_countries_json
      END,
      price_amount = CASE
        WHEN (
          ${businessChangedSql}
        ) THEN COALESCE(EXCLUDED.price_amount, affiliate_products.price_amount)
        ELSE affiliate_products.price_amount
      END,
      price_currency = CASE
        WHEN (
          ${businessChangedSql}
        ) THEN COALESCE(EXCLUDED.price_currency, affiliate_products.price_currency)
        ELSE affiliate_products.price_currency
      END,
      commission_rate = CASE
        WHEN (
          ${businessChangedSql}
        ) THEN EXCLUDED.commission_rate
        ELSE affiliate_products.commission_rate
      END,
      commission_amount = CASE
        WHEN (
          ${businessChangedSql}
        ) THEN EXCLUDED.commission_amount
        ELSE affiliate_products.commission_amount
      END,
      commission_rate_mode = CASE
        WHEN (
          ${businessChangedSql}
        ) THEN EXCLUDED.commission_rate_mode
        ELSE affiliate_products.commission_rate_mode
      END,
      review_count = CASE
        WHEN (
          ${businessChangedSql}
        ) THEN EXCLUDED.review_count
        ELSE affiliate_products.review_count
      END,
      is_deeplink = CASE
        WHEN (
          ${businessChangedSql}
        ) THEN EXCLUDED.is_deeplink
        ELSE affiliate_products.is_deeplink
      END,
      is_confirmed_invalid = CASE
        WHEN (
          ${businessChangedSql}
        ) THEN EXCLUDED.is_confirmed_invalid
        ELSE affiliate_products.is_confirmed_invalid
      END,
      last_synced_at = EXCLUDED.last_synced_at,
      last_seen_at = EXCLUDED.last_seen_at,
      updated_at = CASE
        WHEN (
          ${businessChangedSql}
        ) THEN EXCLUDED.updated_at
        ELSE affiliate_products.updated_at
      END
    WHERE (
      ${businessChangedSql}
    )
      OR affiliate_products.last_synced_at ${timestampDistinctComparator} EXCLUDED.last_synced_at
      OR affiliate_products.last_seen_at ${timestampDistinctComparator} EXCLUDED.last_seen_at
  `, values)
}

async function upsertAffiliateProductsChunkPostgresTwoPhase(params: {
  db: DatabaseAdapter
  userId: number
  platform: AffiliatePlatform
  items: NormalizedAffiliateProduct[]
  nowIso: string
}): Promise<void> {
  if (params.items.length === 0) return

  const perRowPlaceholder = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  const placeholders = new Array(params.items.length).fill(perRowPlaceholder).join(', ')
  const incomingColumns = `
    user_id,
    platform,
    mid,
    merchant_id,
    asin,
    brand,
    product_name,
    product_url,
    promo_link,
    short_promo_link,
    allowed_countries_json,
    price_amount,
    price_currency,
    commission_rate,
    commission_amount,
    commission_rate_mode,
    review_count,
    is_deeplink,
    is_confirmed_invalid,
    last_synced_at,
    last_seen_at,
    updated_at
  `
  const typedIncomingProjection = `
    v.user_id::integer AS user_id,
    v.platform::text AS platform,
    v.mid::text AS mid,
    v.merchant_id::text AS merchant_id,
    v.asin::text AS asin,
    v.brand::text AS brand,
    v.product_name::text AS product_name,
    v.product_url::text AS product_url,
    v.promo_link::text AS promo_link,
    v.short_promo_link::text AS short_promo_link,
    v.allowed_countries_json::text AS allowed_countries_json,
    v.price_amount::double precision AS price_amount,
    v.price_currency::text AS price_currency,
    v.commission_rate::double precision AS commission_rate,
    v.commission_amount::double precision AS commission_amount,
    v.commission_rate_mode::text AS commission_rate_mode,
    v.review_count::integer AS review_count,
    v.is_deeplink::boolean AS is_deeplink,
    v.is_confirmed_invalid::boolean AS is_confirmed_invalid,
    v.last_synced_at::timestamp AS last_synced_at,
    v.last_seen_at::timestamp AS last_seen_at,
    v.updated_at::timestamp AS updated_at
  `
  const incomingCte = `
    WITH incoming AS (
      SELECT
        ${typedIncomingProjection}
      FROM (VALUES ${placeholders}) AS v (${incomingColumns})
    )
  `
  const values = buildAffiliateProductsUpsertValues(params)
  const businessChangedSql = buildAffiliateProductsBusinessChangedSql({
    existingAlias: 'p',
    incomingAlias: 'incoming',
    dbType: 'postgres',
  })
  const conflictBusinessChangedSql = buildAffiliateProductsBusinessChangedSql({
    existingAlias: 'affiliate_products',
    incomingAlias: 'EXCLUDED',
    dbType: 'postgres',
  })

  await params.db.exec(`
    ${incomingCte}
    UPDATE affiliate_products p
    SET
      merchant_id = incoming.merchant_id,
      asin = incoming.asin,
      brand = incoming.brand,
      product_name = incoming.product_name,
      product_url = incoming.product_url,
      promo_link = incoming.promo_link,
      short_promo_link = incoming.short_promo_link,
      allowed_countries_json = incoming.allowed_countries_json,
      price_amount = COALESCE(incoming.price_amount, p.price_amount),
      price_currency = COALESCE(incoming.price_currency, p.price_currency),
      commission_rate = incoming.commission_rate,
      commission_amount = incoming.commission_amount,
      commission_rate_mode = incoming.commission_rate_mode,
      review_count = incoming.review_count,
      is_deeplink = incoming.is_deeplink,
      is_confirmed_invalid = incoming.is_confirmed_invalid,
      last_synced_at = incoming.last_synced_at,
      last_seen_at = incoming.last_seen_at,
      updated_at = incoming.updated_at
    FROM incoming
    WHERE p.user_id = incoming.user_id
      AND p.platform = incoming.platform
      AND p.mid = incoming.mid
      AND (
        ${businessChangedSql}
      )
  `, values)

  await params.db.exec(`
    ${incomingCte}
    UPDATE affiliate_products p
    SET
      last_synced_at = incoming.last_synced_at,
      last_seen_at = incoming.last_seen_at
    FROM incoming
    WHERE p.user_id = incoming.user_id
      AND p.platform = incoming.platform
      AND p.mid = incoming.mid
      AND NOT (
        ${businessChangedSql}
      )
      AND (
        p.last_synced_at IS DISTINCT FROM incoming.last_synced_at
        OR p.last_seen_at IS DISTINCT FROM incoming.last_seen_at
      )
  `, values)

  await params.db.exec(`
    ${incomingCte}
    INSERT INTO affiliate_products (
      user_id,
      platform,
      mid,
      merchant_id,
      asin,
      brand,
      product_name,
      product_url,
      promo_link,
      short_promo_link,
      allowed_countries_json,
      price_amount,
      price_currency,
      commission_rate,
      commission_amount,
      commission_rate_mode,
      review_count,
      is_deeplink,
      is_confirmed_invalid,
      last_synced_at,
      last_seen_at,
      updated_at
    )
    SELECT
      incoming.user_id,
      incoming.platform,
      incoming.mid,
      incoming.merchant_id,
      incoming.asin,
      incoming.brand,
      incoming.product_name,
      incoming.product_url,
      incoming.promo_link,
      incoming.short_promo_link,
      incoming.allowed_countries_json,
      incoming.price_amount,
      incoming.price_currency,
      incoming.commission_rate,
      incoming.commission_amount,
      incoming.commission_rate_mode,
      incoming.review_count,
      incoming.is_deeplink,
      incoming.is_confirmed_invalid,
      incoming.last_synced_at,
      incoming.last_seen_at,
      incoming.updated_at
    FROM incoming
    LEFT JOIN affiliate_products p
      ON p.user_id = incoming.user_id
      AND p.platform = incoming.platform
      AND p.mid = incoming.mid
    WHERE p.id IS NULL
    ON CONFLICT (user_id, platform, mid) DO UPDATE SET
      merchant_id = CASE
        WHEN (
          ${conflictBusinessChangedSql}
        ) THEN EXCLUDED.merchant_id
        ELSE affiliate_products.merchant_id
      END,
      asin = CASE
        WHEN (
          ${conflictBusinessChangedSql}
        ) THEN EXCLUDED.asin
        ELSE affiliate_products.asin
      END,
      brand = CASE
        WHEN (
          ${conflictBusinessChangedSql}
        ) THEN EXCLUDED.brand
        ELSE affiliate_products.brand
      END,
      product_name = CASE
        WHEN (
          ${conflictBusinessChangedSql}
        ) THEN EXCLUDED.product_name
        ELSE affiliate_products.product_name
      END,
      product_url = CASE
        WHEN (
          ${conflictBusinessChangedSql}
        ) THEN EXCLUDED.product_url
        ELSE affiliate_products.product_url
      END,
      promo_link = CASE
        WHEN (
          ${conflictBusinessChangedSql}
        ) THEN EXCLUDED.promo_link
        ELSE affiliate_products.promo_link
      END,
      short_promo_link = CASE
        WHEN (
          ${conflictBusinessChangedSql}
        ) THEN EXCLUDED.short_promo_link
        ELSE affiliate_products.short_promo_link
      END,
      allowed_countries_json = CASE
        WHEN (
          ${conflictBusinessChangedSql}
        ) THEN EXCLUDED.allowed_countries_json
        ELSE affiliate_products.allowed_countries_json
      END,
      price_amount = CASE
        WHEN (
          ${conflictBusinessChangedSql}
        ) THEN COALESCE(EXCLUDED.price_amount, affiliate_products.price_amount)
        ELSE affiliate_products.price_amount
      END,
      price_currency = CASE
        WHEN (
          ${conflictBusinessChangedSql}
        ) THEN COALESCE(EXCLUDED.price_currency, affiliate_products.price_currency)
        ELSE affiliate_products.price_currency
      END,
      commission_rate = CASE
        WHEN (
          ${conflictBusinessChangedSql}
        ) THEN EXCLUDED.commission_rate
        ELSE affiliate_products.commission_rate
      END,
      commission_amount = CASE
        WHEN (
          ${conflictBusinessChangedSql}
        ) THEN EXCLUDED.commission_amount
        ELSE affiliate_products.commission_amount
      END,
      commission_rate_mode = CASE
        WHEN (
          ${conflictBusinessChangedSql}
        ) THEN EXCLUDED.commission_rate_mode
        ELSE affiliate_products.commission_rate_mode
      END,
      review_count = CASE
        WHEN (
          ${conflictBusinessChangedSql}
        ) THEN EXCLUDED.review_count
        ELSE affiliate_products.review_count
      END,
      is_deeplink = CASE
        WHEN (
          ${conflictBusinessChangedSql}
        ) THEN EXCLUDED.is_deeplink
        ELSE affiliate_products.is_deeplink
      END,
      is_confirmed_invalid = CASE
        WHEN (
          ${conflictBusinessChangedSql}
        ) THEN EXCLUDED.is_confirmed_invalid
        ELSE affiliate_products.is_confirmed_invalid
      END,
      last_synced_at = EXCLUDED.last_synced_at,
      last_seen_at = EXCLUDED.last_seen_at,
      updated_at = CASE
        WHEN (
          ${conflictBusinessChangedSql}
        ) THEN EXCLUDED.updated_at
        ELSE affiliate_products.updated_at
      END
    WHERE (
      ${conflictBusinessChangedSql}
    )
      OR affiliate_products.last_synced_at IS DISTINCT FROM EXCLUDED.last_synced_at
      OR affiliate_products.last_seen_at IS DISTINCT FROM EXCLUDED.last_seen_at
  `, values)
}

async function upsertAffiliateProductsChunk(params: {
  db: DatabaseAdapter
  userId: number
  platform: AffiliatePlatform
  items: NormalizedAffiliateProduct[]
  nowIso: string
}): Promise<void> {
  if (params.db.type === 'postgres') {
    await upsertAffiliateProductsChunkPostgresTwoPhase(params)
    return
  }
  await upsertAffiliateProductsChunkOnConflict(params)
}

export async function upsertAffiliateProducts(
  userId: number,
  platform: AffiliatePlatform,
  items: NormalizedAffiliateProduct[],
  options?: {
    progressEvery?: number
    onProgress?: (progress: AffiliateProductSyncProgress) => Promise<void> | void
  }
): Promise<{
  totalFetched: number
  createdCount: number
  updatedCount: number
}> {
  const db = await getDatabase()
  const deduped = dedupeNormalizedProducts(items)
  const totalFetched = deduped.length

  const emitProgress = async (progress: AffiliateProductSyncProgress): Promise<void> => {
    if (!options?.onProgress) return
    try {
      await options.onProgress(progress)
    } catch (error: any) {
      console.warn('[affiliate-products] onProgress callback failed:', error?.message || error)
    }
  }

  if (deduped.length === 0) {
    await emitProgress({
      totalFetched: 0,
      processedCount: 0,
      createdCount: 0,
      updatedCount: 0,
      failedCount: 0,
    })
    return {
      totalFetched: 0,
      createdCount: 0,
      updatedCount: 0,
    }
  }

  let createdCount = 0
  let updatedCount = 0
  let processedCount = 0
  let lastEmittedProcessed = 0
  const nowIso = new Date().toISOString()
  const progressEvery = Math.max(1, Math.floor(Number(options?.progressEvery || 20)))
  const upsertBatchSize = Math.max(1, getAffiliateProductsUpsertBatchSize(db.type))

  await emitProgress({
    totalFetched,
    processedCount,
    createdCount,
    updatedCount,
    failedCount: 0,
  })

  for (let index = 0; index < deduped.length; index += upsertBatchSize) {
    const batch = deduped.slice(index, index + upsertBatchSize)
    const existingMidSet = await loadExistingMidSet(
      userId,
      platform,
      batch.map((item) => item.mid)
    )

    for (const item of batch) {
      if (existingMidSet.has(item.mid)) {
        updatedCount += 1
      } else {
        createdCount += 1
      }
    }

    await upsertAffiliateProductsChunk({
      db,
      userId,
      platform,
      items: batch,
      nowIso,
    })

    processedCount += batch.length
    if (
      processedCount - lastEmittedProcessed >= progressEvery
      || processedCount === totalFetched
    ) {
      lastEmittedProcessed = processedCount
      await emitProgress({
        totalFetched,
        processedCount,
        createdCount,
        updatedCount,
        failedCount: 0,
      })
    }
  }

  return {
    totalFetched,
    createdCount,
    updatedCount,
  }
}

const SORT_FIELD_SQL: Record<ProductSortField, string> = {
  serial: 'p.id',
  platform: 'p.platform',
  mid: 'p.mid',
  asin: 'p.asin',
  createdAt: 'p.created_at',
  allowedCountries: 'p.allowed_countries_json',
  priceAmount: 'p.price_amount',
  commissionRate: 'p.commission_rate',
  commissionAmount: 'p.commission_amount',
  reviewCount: 'p.review_count',
  promoLink: 'COALESCE(p.short_promo_link, p.promo_link)',
  relatedOfferCount: 'related_offer_count',
  updatedAt: 'p.updated_at',
  recommendationScore: 'p.recommendation_score', // 新增: 推荐指数排序
}

const NUMERIC_SORT_FIELDS_WITH_NULLS_LAST: Set<ProductSortField> = new Set([
  'priceAmount',
  'commissionRate',
  'commissionAmount',
  'reviewCount',
  'recommendationScore', // 新增: 推荐指数排序时NULL值放最后
])

export function buildAffiliateProductsOrderBy(params: {
  sortBy: ProductSortField
  sortOrder: ProductSortOrder
}): string {
  const { sortBy, sortOrder } = params
  const direction = sortOrder === 'asc' ? 'ASC' : 'DESC'
  const sortSql = SORT_FIELD_SQL[sortBy] || SORT_FIELD_SQL.serial

  if (NUMERIC_SORT_FIELDS_WITH_NULLS_LAST.has(sortBy)) {
    return `(${sortSql} IS NULL) ASC, ${sortSql} ${direction}, p.id DESC`
  }

  return `${sortSql} ${direction}, p.id DESC`
}

function normalizeNumericRangeBounds(params: {
  min?: number | null
  max?: number | null
}): { min: number | null; max: number | null } {
  const min = typeof params.min === 'number' && Number.isFinite(params.min)
    ? params.min
    : null
  const max = typeof params.max === 'number' && Number.isFinite(params.max)
    ? params.max
    : null

  if (min !== null && max !== null && min > max) {
    return { min: max, max: min }
  }

  return { min, max }
}

function appendNumericRangeWhere(params: {
  whereConditions: string[]
  whereParams: any[]
  columnSql: string
  min?: number | null
  max?: number | null
}): void {
  const { min, max } = normalizeNumericRangeBounds({ min: params.min, max: params.max })

  if (min !== null) {
    params.whereConditions.push(`${params.columnSql} >= ?`)
    params.whereParams.push(min)
  }

  if (max !== null) {
    params.whereConditions.push(`${params.columnSql} <= ?`)
    params.whereParams.push(max)
  }
}

function normalizeDateRangeBounds(params: {
  from?: string | null
  to?: string | null
}): { from: string | null; to: string | null } {
  const from = normalizeYmdDate(params.from)
  const to = normalizeYmdDate(params.to)

  if (from && to && from > to) {
    return { from: to, to: from }
  }

  return { from, to }
}

function appendDateRangeWhere(params: {
  whereConditions: string[]
  whereParams: any[]
  columnSql: string
  from?: string | null
  to?: string | null
}): void {
  const { from, to } = normalizeDateRangeBounds({ from: params.from, to: params.to })
  const toDayStartSql = (ymd: string): string => `${ymd} 00:00:00`
  const addDaysToYmd = (ymd: string, days: number): string | null => {
    const parsed = new Date(`${ymd}T00:00:00.000Z`)
    if (Number.isNaN(parsed.getTime())) return null
    parsed.setUTCDate(parsed.getUTCDate() + days)
    return parsed.toISOString().slice(0, 10)
  }

  if (from) {
    params.whereConditions.push(`${params.columnSql} >= ?`)
    params.whereParams.push(toDayStartSql(from))
  }

  if (to) {
    const exclusiveEnd = addDaysToYmd(to, 1)
    if (exclusiveEnd) {
      params.whereConditions.push(`${params.columnSql} < ?`)
      params.whereParams.push(toDayStartSql(exclusiveEnd))
    } else {
      params.whereConditions.push(`${params.columnSql} <= ?`)
      params.whereParams.push(`${to} 23:59:59.999`)
    }
  }
}

function buildAffiliateLandingTypeConditionSql(alias: string = 'p'): {
  byType: Record<AffiliateLandingPageType, string>
  productCondition: string
  storeCondition: string
} {
  const asinPresent = `COALESCE(NULLIF(TRIM(${alias}.asin), ''), NULL) IS NOT NULL`
  const urlCandidates = [
    `LOWER(COALESCE(${alias}.product_url, ''))`,
    `LOWER(COALESCE(${alias}.short_promo_link, ''))`,
    `LOWER(COALESCE(${alias}.promo_link, ''))`,
  ]

  const matchesAnyPattern = (patterns: string[]): string => (
    urlCandidates
      .map((urlSql) => `(${patterns.map((pattern) => `${urlSql} LIKE '${pattern}'`).join(' OR ')})`)
      .join(' OR ')
  )

  const amazonStoreByUrl = `(${matchesAnyPattern([
    '%amazon.%/stores/%',
    '%amazon.%/store/%',
    '%amazon.%/storefront/%',
  ])})`
  const amazonProductByUrl = `(${matchesAnyPattern([
    '%amazon.%/dp/%',
    '%amazon.%/gp/product/%',
  ])})`
  const independentProductByUrl = `(${matchesAnyPattern([
    '%/products/%',
    '%/product/%',
    '%/p/%',
    '%/item/%',
    '%://%/%-p_%',
    '%://%/%.html%',
  ])})`
  const independentStoreByUrl = `(${matchesAnyPattern([
    '%/collections%',
    '%/shop%',
    '%/store%',
  ])})`

  const amazonStore = `(NOT (${asinPresent}) AND (${amazonStoreByUrl}))`
  const amazonProduct = `((${asinPresent}) OR (NOT (${amazonStore}) AND (${amazonProductByUrl})))`
  const independentProduct = `(NOT (${amazonProduct}) AND NOT (${amazonStore}) AND (${independentProductByUrl}))`
  const independentStore = `(NOT (${amazonProduct}) AND NOT (${amazonStore}) AND NOT (${independentProduct}) AND (${independentStoreByUrl}))`

  const productCondition = `((${amazonProduct}) OR (${independentProduct}))`
  const storeCondition = `(NOT (${productCondition}) AND ((${amazonStore}) OR (${independentStore})))`
  const unknownCondition = `(NOT (${productCondition}) AND NOT (${storeCondition}))`

  return {
    byType: {
      amazon_product: amazonProduct,
      amazon_store: amazonStore,
      independent_product: independentProduct,
      independent_store: independentStore,
      unknown: unknownCondition,
    },
    productCondition,
    storeCondition,
  }
}

function buildConfirmedInvalidSql(columnSql: string = 'p.is_confirmed_invalid'): string {
  return `(COALESCE(${columnSql}, FALSE) = TRUE)`
}

function parseDateToTimestamp(input: string | null): number | null {
  if (!input) return null
  const timestamp = Date.parse(input)
  if (!Number.isFinite(timestamp)) return null
  return timestamp
}

function isMissingTableError(error: unknown): boolean {
  const message = String((error as any)?.message || '').toLowerCase()
  return /(no such table|does not exist)/i.test(message)
}

const affiliateProductsMerchantIdColumnAvailability: Partial<Record<'sqlite' | 'postgres', boolean>> = {}
const affiliateProductsRawJsonColumnAvailability: Partial<Record<'sqlite' | 'postgres', boolean>> = {}

async function hasAffiliateProductsMerchantIdColumn(db: DatabaseAdapter): Promise<boolean> {
  const cached = affiliateProductsMerchantIdColumnAvailability[db.type]
  if (typeof cached === 'boolean') {
    return cached
  }

  try {
    if (db.type === 'postgres') {
      const row = await db.queryOne<{ exists: boolean }>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'affiliate_products'
              AND column_name = 'merchant_id'
          ) AS exists
        `
      )
      const exists = Boolean(row?.exists)
      affiliateProductsMerchantIdColumnAvailability.postgres = exists
      return exists
    }

    const rows = await db.query<{ name: string }>(`PRAGMA table_info(affiliate_products)`)
    const exists = Array.isArray(rows) && rows.some((row) => String((row as any)?.name || '').toLowerCase() === 'merchant_id')
    affiliateProductsMerchantIdColumnAvailability.sqlite = exists
    return exists
  } catch {
    return false
  }
}

async function hasAffiliateProductsRawJsonColumn(
  db: DatabaseAdapter,
  options?: { refresh?: boolean }
): Promise<boolean> {
  const cached = affiliateProductsRawJsonColumnAvailability[db.type]
  if (!options?.refresh && typeof cached === 'boolean') {
    return cached
  }

  try {
    if (db.type === 'postgres') {
      const row = await db.queryOne<{ exists: boolean }>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'affiliate_products'
              AND column_name = 'raw_json'
          ) AS exists
        `
      )
      const exists = Boolean(row?.exists)
      affiliateProductsRawJsonColumnAvailability.postgres = exists
      return exists
    }

    const rows = await db.query<{ name: string }>(`PRAGMA table_info(affiliate_products)`)
    const exists = Array.isArray(rows) && rows.some((row) => String((row as any)?.name || '').toLowerCase() === 'raw_json')
    affiliateProductsRawJsonColumnAvailability.sqlite = exists
    return exists
  } catch {
    return false
  }
}

function isMissingColumnError(error: unknown): boolean {
  const message = String((error as any)?.message || '').toLowerCase()
  return /(no such column|column .* does not exist|unknown column|undefined column)/i.test(message)
}

function isRetriableRawJsonDropError(error: unknown): boolean {
  const code = String((error as any)?.code || '').trim().toUpperCase()
  if (code === '55P03' || code === '57014' || code === '40P01') {
    return true
  }

  const message = String((error as any)?.message || '').toLowerCase()
  return (
    message.includes('lock timeout')
    || message.includes('statement timeout')
    || message.includes('could not obtain lock on relation')
    || message.includes('deadlock detected')
  )
}

async function countActiveAffiliateProductSyncRuns(db: DatabaseAdapter): Promise<number> {
  try {
    const row = await db.queryOne<{ active_count: number }>(
      `
        SELECT COUNT(*) AS active_count
        FROM affiliate_product_sync_runs
        WHERE status IN ('pending', 'running')
      `
    )
    return toSafeNonNegativeInt(row?.active_count)
  } catch (error) {
    if (isMissingTableError(error)) {
      return 0
    }
    throw error
  }
}

async function resolveAffiliateProductsRawJsonCleanupBatchSize(params: {
  db: DatabaseAdapter
  requestedBatchSize?: number
}): Promise<number> {
  if (typeof params.requestedBatchSize === 'number' && Number.isFinite(params.requestedBatchSize)) {
    return parseIntegerInRange(
      params.requestedBatchSize,
      AFFILIATE_RAW_JSON_RETIREMENT_BATCH_SIZE_MAX,
      AFFILIATE_RAW_JSON_RETIREMENT_BATCH_SIZE_MIN,
      AFFILIATE_RAW_JSON_RETIREMENT_BATCH_SIZE_MAX
    )
  }

  const activeSyncRuns = await countActiveAffiliateProductSyncRuns(params.db)
  if (activeSyncRuns >= AFFILIATE_RAW_JSON_RETIREMENT_PEAK_SYNC_RUNS_THRESHOLD) {
    return AFFILIATE_RAW_JSON_RETIREMENT_BATCH_SIZE_MIN
  }
  if (activeSyncRuns >= AFFILIATE_RAW_JSON_RETIREMENT_BUSY_SYNC_RUNS_THRESHOLD) {
    return AFFILIATE_RAW_JSON_RETIREMENT_BATCH_SIZE_BUSY
  }
  return AFFILIATE_RAW_JSON_RETIREMENT_BATCH_SIZE_MAX
}

type RawJsonDropAttemptResult = 'dropped' | 'already_missing' | 'lock_not_acquired'

function isWithinAffiliateRawJsonDropWindow(now: Date): boolean {
  const offsetHours = parseIntegerInRange(
    process.env.AFFILIATE_RAW_JSON_RETIREMENT_DROP_WINDOW_TZ_OFFSET_HOURS,
    AFFILIATE_RAW_JSON_RETIREMENT_DROP_WINDOW_TZ_OFFSET_HOURS,
    -12,
    14
  )
  const startHour = parseIntegerInRange(
    process.env.AFFILIATE_RAW_JSON_RETIREMENT_DROP_WINDOW_START_HOUR,
    AFFILIATE_RAW_JSON_RETIREMENT_DROP_WINDOW_START_HOUR,
    0,
    23
  )
  const endHour = parseIntegerInRange(
    process.env.AFFILIATE_RAW_JSON_RETIREMENT_DROP_WINDOW_END_HOUR,
    AFFILIATE_RAW_JSON_RETIREMENT_DROP_WINDOW_END_HOUR,
    0,
    24
  )

  const localHour = (now.getUTCHours() + offsetHours + 24) % 24
  if (startHour === endHour) {
    return true
  }
  if (startHour < endHour) {
    return localHour >= startHour && localHour < endHour
  }
  return localHour >= startHour || localHour < endHour
}

async function dropAffiliateProductsRawJsonColumnWithRetry(db: DatabaseAdapter): Promise<RawJsonDropAttemptResult> {
  if (db.type !== 'postgres') {
    try {
      await db.exec(`ALTER TABLE affiliate_products DROP COLUMN raw_json`)
      return 'dropped'
    } catch (error) {
      if (isMissingColumnError(error)) {
        return 'already_missing'
      }
      throw error
    }
  }

  for (let attempt = 1; attempt <= AFFILIATE_RAW_JSON_RETIREMENT_DROP_MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await db.transaction(async () => {
        const lockRow = await db.queryOne<{ acquired: boolean }>(
          `SELECT pg_try_advisory_xact_lock(?) AS acquired`,
          [AFFILIATE_RAW_JSON_RETIREMENT_DROP_LOCK_KEY]
        )
        if (!lockRow?.acquired) {
          return 'lock_not_acquired' as const
        }

        await db.exec(`SET LOCAL lock_timeout = '${AFFILIATE_RAW_JSON_RETIREMENT_DROP_LOCK_TIMEOUT_MS}ms'`)
        await db.exec(`SET LOCAL statement_timeout = '${AFFILIATE_RAW_JSON_RETIREMENT_DROP_STATEMENT_TIMEOUT_MS}ms'`)
        await db.exec(`ALTER TABLE affiliate_products DROP COLUMN IF EXISTS raw_json`)
        return 'dropped' as const
      })

      return result
    } catch (error) {
      if (isMissingColumnError(error)) {
        return 'already_missing'
      }

      const canRetry = isRetriableRawJsonDropError(error) && attempt < AFFILIATE_RAW_JSON_RETIREMENT_DROP_MAX_ATTEMPTS
      if (!canRetry) {
        throw error
      }

      const delayMs = Math.min(
        AFFILIATE_RAW_JSON_RETIREMENT_DROP_RETRY_MAX_DELAY_MS,
        AFFILIATE_RAW_JSON_RETIREMENT_DROP_RETRY_BASE_DELAY_MS * (2 ** (attempt - 1))
      )
      await sleep(delayMs)
    }
  }

  return 'lock_not_acquired'
}

async function clearAffiliateProductsRawJsonBatch(db: DatabaseAdapter, batchSize: number): Promise<number> {
  if (batchSize <= 0) return 0

  if (db.type === 'postgres') {
    const result = await db.exec(
      `
        WITH target AS (
          SELECT ctid
          FROM affiliate_products
          WHERE raw_json IS NOT NULL
          LIMIT ?
        )
        UPDATE affiliate_products p
        SET raw_json = NULL
        FROM target
        WHERE p.ctid = target.ctid
      `,
      [batchSize]
    )
    return Number(result?.changes || 0)
  }

  const result = await db.exec(
    `
      UPDATE affiliate_products
      SET raw_json = NULL
      WHERE rowid IN (
        SELECT rowid
        FROM affiliate_products
        WHERE raw_json IS NOT NULL
        LIMIT ?
      )
    `,
    [batchSize]
  )
  return Number(result?.changes || 0)
}

export async function runAffiliateProductsRawJsonRetirementMaintenance(options?: {
  batchSize?: number
  now?: Date
  allowDropOutsideWindow?: boolean
}): Promise<void> {
  const db = await getDatabase()
  const now = options?.now instanceof Date
    && Number.isFinite(options.now.getTime())
    ? options.now
    : new Date()

  type RetirementControlRow = {
    drop_after_at: string | null
    cleanup_completed_at: string | null
    raw_json_drop_completed_at: string | null
  }

  let controlRow: RetirementControlRow | undefined
  try {
    controlRow = await db.queryOne<RetirementControlRow>(
      `
        SELECT
          drop_after_at,
          cleanup_completed_at,
          raw_json_drop_completed_at
        FROM ${AFFILIATE_RAW_JSON_RETIREMENT_TABLE}
        WHERE singleton_id = ?
        LIMIT 1
      `,
      [AFFILIATE_RAW_JSON_RETIREMENT_SINGLETON_ID]
    )
  } catch (error) {
    if (isMissingTableError(error)) {
      return
    }
    throw error
  }

  if (!controlRow) {
    return
  }

  const nowIso = now.toISOString()
  let rawJsonColumnExists = await hasAffiliateProductsRawJsonColumn(db)

  if (!controlRow.cleanup_completed_at) {
    if (!rawJsonColumnExists) {
      await db.exec(
        `
          UPDATE ${AFFILIATE_RAW_JSON_RETIREMENT_TABLE}
          SET cleanup_completed_at = COALESCE(cleanup_completed_at, ?),
              updated_at = ?
          WHERE singleton_id = ?
        `,
        [nowIso, nowIso, AFFILIATE_RAW_JSON_RETIREMENT_SINGLETON_ID]
      )
      controlRow.cleanup_completed_at = nowIso
    } else {
      const batchSize = await resolveAffiliateProductsRawJsonCleanupBatchSize({
        db,
        requestedBatchSize: options?.batchSize,
      })
      const cleanedRows = await clearAffiliateProductsRawJsonBatch(db, batchSize)
      if (cleanedRows === 0) {
        await db.exec(
          `
            UPDATE ${AFFILIATE_RAW_JSON_RETIREMENT_TABLE}
            SET cleanup_completed_at = COALESCE(cleanup_completed_at, ?),
                updated_at = ?
            WHERE singleton_id = ?
          `,
          [nowIso, nowIso, AFFILIATE_RAW_JSON_RETIREMENT_SINGLETON_ID]
        )
        controlRow.cleanup_completed_at = nowIso
      }
    }
  }

  const dropAfterTimestamp = parseDateToTimestamp(controlRow.drop_after_at || null)
  const dropWindowReady = options?.allowDropOutsideWindow === true
    || isWithinAffiliateRawJsonDropWindow(now)
  if (
    rawJsonColumnExists
    && !controlRow.raw_json_drop_completed_at
    && dropAfterTimestamp !== null
    && now.getTime() >= dropAfterTimestamp
    && dropWindowReady
  ) {
    await db.exec(
      `
        UPDATE ${AFFILIATE_RAW_JSON_RETIREMENT_TABLE}
        SET raw_json_drop_started_at = COALESCE(raw_json_drop_started_at, ?),
            last_error = NULL,
            updated_at = ?
        WHERE singleton_id = ?
      `,
      [nowIso, nowIso, AFFILIATE_RAW_JSON_RETIREMENT_SINGLETON_ID]
    )

    try {
      const dropResult = await dropAffiliateProductsRawJsonColumnWithRetry(db)
      if (dropResult === 'lock_not_acquired') {
        rawJsonColumnExists = await hasAffiliateProductsRawJsonColumn(db, { refresh: true })
      } else {
        rawJsonColumnExists = await hasAffiliateProductsRawJsonColumn(db, { refresh: true })
      }

      if (!rawJsonColumnExists) {
        const dropCompletedAt = new Date().toISOString()
        await db.exec(
          `
            UPDATE ${AFFILIATE_RAW_JSON_RETIREMENT_TABLE}
            SET raw_json_drop_completed_at = COALESCE(raw_json_drop_completed_at, ?),
                last_error = NULL,
                updated_at = ?
            WHERE singleton_id = ?
          `,
          [dropCompletedAt, dropCompletedAt, AFFILIATE_RAW_JSON_RETIREMENT_SINGLETON_ID]
        )
        controlRow.raw_json_drop_completed_at = dropCompletedAt
      }
    } catch (error) {
      if (isMissingColumnError(error)) {
        affiliateProductsRawJsonColumnAvailability[db.type] = false
        rawJsonColumnExists = false
        const dropCompletedAt = new Date().toISOString()
        await db.exec(
          `
            UPDATE ${AFFILIATE_RAW_JSON_RETIREMENT_TABLE}
            SET raw_json_drop_completed_at = COALESCE(raw_json_drop_completed_at, ?),
                last_error = NULL,
                updated_at = ?
            WHERE singleton_id = ?
          `,
          [dropCompletedAt, dropCompletedAt, AFFILIATE_RAW_JSON_RETIREMENT_SINGLETON_ID]
        )
        controlRow.raw_json_drop_completed_at = dropCompletedAt
      } else {
        const errorMessage = String((error as any)?.message || error || 'unknown error').slice(0, 1000)
        const failedAt = new Date().toISOString()
        await db.exec(
          `
            UPDATE ${AFFILIATE_RAW_JSON_RETIREMENT_TABLE}
            SET last_error = ?,
                updated_at = ?
            WHERE singleton_id = ?
          `,
          [errorMessage, failedAt, AFFILIATE_RAW_JSON_RETIREMENT_SINGLETON_ID]
        )
        throw error
      }
    }
  }

  rawJsonColumnExists = await hasAffiliateProductsRawJsonColumn(db, { refresh: true })

  if (!rawJsonColumnExists && !controlRow.raw_json_drop_completed_at) {
    const dropCompletedAt = new Date().toISOString()
    await db.exec(
      `
        UPDATE ${AFFILIATE_RAW_JSON_RETIREMENT_TABLE}
        SET raw_json_drop_completed_at = COALESCE(raw_json_drop_completed_at, ?),
            last_error = NULL,
            updated_at = ?
        WHERE singleton_id = ?
      `,
      [dropCompletedAt, dropCompletedAt, AFFILIATE_RAW_JSON_RETIREMENT_SINGLETON_ID]
    )
  }
}

function toHourBucketIso(date: Date): string {
  const copy = new Date(date.getTime())
  copy.setUTCMinutes(0, 0, 0)
  return copy.toISOString()
}

function toSafeNonNegativeInt(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return Math.trunc(parsed)
}

function resolveLifecycleStatusFromRowForList(
  row: Pick<AffiliateProduct, 'is_confirmed_invalid' | 'last_seen_at'>
  & { baseline_started_at?: string | null }
): AffiliateProductLifecycleStatus {
  if (normalizeTriStateBool(row.is_confirmed_invalid) === true) {
    return 'invalid'
  }

  const baselineTimestamp = parseDateToTimestamp(row.baseline_started_at || null)
  if (baselineTimestamp === null) {
    return 'unknown'
  }

  const lastSeenTimestamp = parseDateToTimestamp(row.last_seen_at || null)
  if (lastSeenTimestamp !== null && lastSeenTimestamp >= baselineTimestamp) {
    return 'active'
  }

  return 'sync_missing'
}

export async function listAffiliateProducts(userId: number, options: ProductListOptions = {}): Promise<ProductListResult> {
  const db = await getDatabase()
  const page = Math.max(1, options.page || 1)
  const pageSize = Math.min(100, Math.max(10, options.pageSize || 20))
  const skipItems = options.skipItems === true
  const skipInvalidSummary = options.skipInvalidSummary === true
  const fastSummary = options.fastSummary === true
  const lightweightSummary = fastSummary && options.lightweightSummary === true
  const offset = (page - 1) * pageSize
  const sortBy = options.sortBy || 'serial'
  const sortOrder = options.sortOrder === 'asc' ? 'asc' : 'desc'
  const orderBySql = buildAffiliateProductsOrderBy({ sortBy, sortOrder })
  const offerNotDeletedCondition = db.type === 'postgres'
    ? '(o.is_deleted = false OR o.is_deleted IS NULL)'
    : '(o.is_deleted = 0 OR o.is_deleted IS NULL)'
  const statusFilter = normalizeAffiliateProductStatusFilter(options.status)
  const landingPageTypeFilter = normalizeAffiliateLandingPageTypeFilter(options.landingPageType)
  const landingTypeSql = buildAffiliateLandingTypeConditionSql('p')
  const asinPresentConditionSql = `COALESCE(NULLIF(TRIM(p.asin), ''), NULL) IS NOT NULL`
  type PlatformStatsAccumulator = Omit<PlatformProductStats, 'visibleCount'>
  const toSafeCount = (value: unknown): number => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) return 0
    return parsed
  }
  const createPlatformStatsAccumulator = (): Record<AffiliatePlatform, PlatformStatsAccumulator> => ({
    yeahpromos: {
      total: 0,
      productCount: 0,
      storeCount: 0,
      productsWithLinkCount: 0,
      activeProductsCount: 0,
      invalidProductsCount: 0,
      syncMissingProductsCount: 0,
      unknownProductsCount: 0,
      blacklistedCount: 0,
    },
    partnerboost: {
      total: 0,
      productCount: 0,
      storeCount: 0,
      productsWithLinkCount: 0,
      activeProductsCount: 0,
      invalidProductsCount: 0,
      syncMissingProductsCount: 0,
      unknownProductsCount: 0,
      blacklistedCount: 0,
    },
  })
  const resolveVisibleCount = (stats: PlatformStatsAccumulator): number => {
    if (statusFilter === 'all') return stats.total
    if (statusFilter === 'invalid') return stats.invalidProductsCount
    if (statusFilter === 'active') return stats.activeProductsCount
    if (statusFilter === 'sync_missing') return stats.syncMissingProductsCount
    return stats.unknownProductsCount
  }
  const toPlatformStats = (stats: PlatformStatsAccumulator): PlatformProductStats => ({
    ...stats,
    visibleCount: resolveVisibleCount(stats),
  })
  const finalizePlatformStats = (accumulator: Record<AffiliatePlatform, PlatformStatsAccumulator>): Record<AffiliatePlatform, PlatformProductStats> => ({
    yeahpromos: toPlatformStats(accumulator.yeahpromos),
    partnerboost: toPlatformStats(accumulator.partnerboost),
  })
  const confirmedInvalidStatusSql = buildConfirmedInvalidSql()
  const fullSyncBaselineCteSql = `
    WITH latest_platform_full_sync AS (
      SELECT ranked.platform, ranked.baseline_started_at
      FROM (
        SELECT
          r.platform,
          COALESCE(r.started_at, r.created_at) AS baseline_started_at,
          ROW_NUMBER() OVER (
            PARTITION BY r.platform
            ORDER BY COALESCE(r.completed_at, r.started_at, r.created_at) DESC, r.id DESC
          ) AS row_num
        FROM affiliate_product_sync_runs r
        WHERE r.user_id = ?
          AND r.mode = 'platform'
          AND r.status = 'completed'
      ) ranked
      WHERE ranked.row_num = 1
    )
  `
  const whereConditions: string[] = ['p.user_id = ?']
  const whereParams: any[] = [userId]

  const platform = normalizePlatformValue(options.platform)
  if (platform) {
    whereConditions.push('p.platform = ?')
    whereParams.push(platform)
  }

  const search = (options.search || '').trim().toLowerCase()
  if (search) {
    const like = `%${search}%`
    whereConditions.push(`
      LOWER(
        COALESCE(p.mid, '')
        || ' '
        || COALESCE(p.asin, '')
        || ' '
        || COALESCE(p.product_name, '')
        || ' '
        || COALESCE(p.brand, '')
      ) LIKE ?
    `)
    whereParams.push(like)
  }

  const midRaw = (options.mid || '').trim()
  const mid = midRaw.toLowerCase()
  const hasMerchantIdColumn = midRaw
    ? await hasAffiliateProductsMerchantIdColumn(db)
    : false
  if (midRaw) {
    const prefersPartnerboostMerchantExact = hasMerchantIdColumn && /^\d{5,}$/.test(midRaw)

    if (prefersPartnerboostMerchantExact) {
      // 典型场景：输入 PartnerBoost 商家ID（纯数字），走 merchant_id 精确匹配避免扫描。
      whereConditions.push(`(
        (
          p.platform = 'partnerboost'
          AND p.merchant_id = ?
        )
        OR (
          p.platform <> 'partnerboost'
          AND p.mid = ?
        )
      )`)
      whereParams.push(midRaw, midRaw)
    } else if (hasMerchantIdColumn) {
      // MID 筛选语义改为“精确匹配”，模糊检索请使用通用 search 输入框。
      whereConditions.push(`(
        (
          p.platform <> 'partnerboost'
          AND LOWER(p.mid) = ?
        )
        OR (
          p.platform = 'partnerboost'
          AND LOWER(p.merchant_id) = ?
        )
      )`)
      whereParams.push(mid, mid)
    } else {
      // 兼容旧库（尚未执行 merchant_id 迁移）时退化为 mid 精确匹配。
      whereConditions.push('LOWER(p.mid) = ?')
      whereParams.push(mid)
    }
  }

  const targetCountryCandidates = resolveProductCountryFilterCandidates(options.targetCountry)
  if (targetCountryCandidates.length > 0) {
    const countryLikeConditions = targetCountryCandidates
      .map(() => `LOWER(p.allowed_countries_json) LIKE ?`)
      .join(' OR ')
    whereConditions.push(`(${countryLikeConditions})`)
    for (const countryCode of targetCountryCandidates) {
      whereParams.push(`%\"${countryCode.toLowerCase()}\"%`)
    }
  }

  if (landingPageTypeFilter !== 'all') {
    whereConditions.push(landingTypeSql.byType[landingPageTypeFilter])
  }

  appendNumericRangeWhere({
    whereConditions,
    whereParams,
    columnSql: 'p.review_count',
    min: options.reviewCountMin,
    max: options.reviewCountMax,
  })

  appendNumericRangeWhere({
    whereConditions,
    whereParams,
    columnSql: 'p.price_amount',
    min: options.priceAmountMin,
    max: options.priceAmountMax,
  })

  appendNumericRangeWhere({
    whereConditions,
    whereParams,
    columnSql: 'p.commission_rate',
    min: options.commissionRateMin,
    max: options.commissionRateMax,
  })

  appendNumericRangeWhere({
    whereConditions,
    whereParams,
    columnSql: 'p.commission_amount',
    min: options.commissionAmountMin,
    max: options.commissionAmountMax,
  })

  appendNumericRangeWhere({
    whereConditions,
    whereParams,
    columnSql: 'p.recommendation_score',
    min: options.recommendationScoreMin,
    max: options.recommendationScoreMax,
  })

  const createdAtRange = normalizeDateRangeBounds({
    from: options.createdAtFrom,
    to: options.createdAtTo,
  })

  appendDateRangeWhere({
    whereConditions,
    whereParams,
    columnSql: 'p.created_at',
    from: createdAtRange.from,
    to: createdAtRange.to,
  })

  const baseWhereSql = whereConditions.join(' AND ')
  const filteredWhereConditions = [...whereConditions]
  const filteredWhereParams = [...whereParams]

  if (statusFilter !== 'all') {
    if (statusFilter === 'invalid') {
      filteredWhereConditions.push(confirmedInvalidStatusSql)
    } else if (statusFilter === 'active') {
      filteredWhereConditions.push(`
        baseline.baseline_started_at IS NOT NULL
        AND p.last_seen_at IS NOT NULL
        AND p.last_seen_at >= baseline.baseline_started_at
        AND NOT (${confirmedInvalidStatusSql})
      `)
    } else if (statusFilter === 'sync_missing') {
      filteredWhereConditions.push(`
        baseline.baseline_started_at IS NOT NULL
        AND (
          p.last_seen_at IS NULL
          OR p.last_seen_at < baseline.baseline_started_at
        )
        AND NOT (${confirmedInvalidStatusSql})
      `)
    } else {
      filteredWhereConditions.push(`
        baseline.baseline_started_at IS NULL
        AND NOT (${confirmedInvalidStatusSql})
      `)
    }
  }

  const filteredWhereSql = filteredWhereConditions.join(' AND ')
  const productStatusSelectSql = statusFilter === 'all'
    ? 'NULL AS product_status'
    : `'${statusFilter}' AS product_status`

  type ProductRowWithDerived = AffiliateProduct & {
    related_offer_count?: number
    active_offer_count?: number
    historical_offer_count?: number
    product_status?: AffiliateProductLifecycleStatus
    baseline_started_at?: string | null
  }

  const rowsPromise: Promise<ProductRowWithDerived[]> = skipItems
    ? Promise.resolve([])
    : db.query<ProductRowWithDerived>(
      `
        ${fullSyncBaselineCteSql}
        SELECT
          p.*,
          ${productStatusSelectSql},
          baseline.baseline_started_at AS baseline_started_at,
          COALESCE(link_counts.active_offer_count, 0) AS active_offer_count,
          COALESCE(link_counts.historical_offer_count, 0) AS historical_offer_count,
          COALESCE(link_counts.historical_offer_count, 0) AS related_offer_count
        FROM affiliate_products p
        LEFT JOIN latest_platform_full_sync baseline ON baseline.platform = p.platform
        LEFT JOIN (
          SELECT
            link.product_id,
            COUNT(DISTINCT CASE
              WHEN c.status = 'ENABLED' AND COALESCE(c.is_deleted, FALSE) = FALSE THEN link.offer_id
              ELSE NULL
            END) AS active_offer_count,
            COUNT(DISTINCT CASE
              WHEN COALESCE(c.google_campaign_id, '') <> '' THEN link.offer_id
              ELSE NULL
            END) AS historical_offer_count
          FROM affiliate_product_offer_links link
          INNER JOIN offers o
            ON o.user_id = link.user_id
            AND o.id = link.offer_id
            AND ${offerNotDeletedCondition}
          LEFT JOIN campaigns c
            ON c.user_id = link.user_id
            AND c.offer_id = link.offer_id
          WHERE link.user_id = ?
          GROUP BY link.product_id
        ) link_counts ON link_counts.product_id = p.id
        WHERE ${filteredWhereSql}
        ORDER BY ${orderBySql}
        LIMIT ?
        OFFSET ?
      `,
      [userId, userId, ...filteredWhereParams, pageSize, offset]
    )
  const summaryCachePayload: ProductSummaryCachePayload = {
    search,
    mid,
    platform: platform || 'all',
    targetCountry: normalizeProductTargetCountryFilter(options.targetCountry) || 'all',
    landingPageType: landingPageTypeFilter,
    status: statusFilter,
    reviewCountMin: options.reviewCountMin ?? null,
    reviewCountMax: options.reviewCountMax ?? null,
    priceAmountMin: options.priceAmountMin ?? null,
    priceAmountMax: options.priceAmountMax ?? null,
    commissionRateMin: options.commissionRateMin ?? null,
    commissionRateMax: options.commissionRateMax ?? null,
    commissionAmountMin: options.commissionAmountMin ?? null,
    commissionAmountMax: options.commissionAmountMax ?? null,
    recommendationScoreMin: options.recommendationScoreMin ?? null,
    recommendationScoreMax: options.recommendationScoreMax ?? null,
    createdAtFrom: createdAtRange.from,
    createdAtTo: createdAtRange.to,
  }
  const summaryCacheHash = buildProductSummaryCacheHash(summaryCachePayload)
  const cachedSummary = await getCachedProductSummary<{
    total: number
    productsWithLinkCount: number
    activeProductsCount: number
    invalidProductsCount: number
    syncMissingProductsCount: number
    unknownProductsCount: number
    blacklistedCount: number
    landingPageStats?: Partial<ProductLandingPageStats>
    platformStats?: Partial<Record<AffiliatePlatform, Partial<PlatformProductStats>>>
  }>(userId, summaryCacheHash)

  let total = 0
  let landingPageStats: ProductLandingPageStats = {
    productCount: 0,
    storeCount: 0,
    unknownCount: 0,
  }
  let productsWithLinkCount = 0
  let activeProductsCount = 0
  let invalidProductsCount = 0
  let syncMissingProductsCount = 0
  let unknownProductsCount = 0
  let blacklistedCount = 0
  const platformStatsAccumulator = createPlatformStatsAccumulator()
  let platformStats = finalizePlatformStats(platformStatsAccumulator)
  const resolveCachedLandingPageStats = (resolvedTotal: number): ProductLandingPageStats => {
    const productCount = toSafeCount(cachedSummary?.landingPageStats?.productCount)
    const storeCount = toSafeCount(cachedSummary?.landingPageStats?.storeCount)
    return {
      productCount,
      storeCount,
      unknownCount: Math.max(0, resolvedTotal - productCount - storeCount),
    }
  }
  const resolveLightweightLandingPageStats = (resolvedTotal: number): ProductLandingPageStats => {
    const cachedLandingStats = resolveCachedLandingPageStats(resolvedTotal)
    if (cachedLandingStats.productCount > 0 || cachedLandingStats.storeCount > 0) {
      return cachedLandingStats
    }

    // lightweightSummary 下不再做昂贵的 URL 分类聚合；优先使用 ASIN 信号兜底避免“商品/店铺全 0”。
    const inferredProductCount = Math.max(
      0,
      platformStatsAccumulator.yeahpromos.productCount + platformStatsAccumulator.partnerboost.productCount
    )
    return {
      productCount: inferredProductCount,
      storeCount: 0,
      unknownCount: Math.max(0, resolvedTotal - inferredProductCount),
    }
  }

  const cachedPlatformStats = cachedSummary?.platformStats
  const hasCachedPlatformStats = Boolean(
    cachedPlatformStats
    && typeof cachedPlatformStats === 'object'
  )

  if (cachedSummary && hasCachedPlatformStats) {
    total = Number(cachedSummary.total || 0)
    productsWithLinkCount = Number(cachedSummary.productsWithLinkCount || 0)
    activeProductsCount = Number(cachedSummary.activeProductsCount || 0)
    invalidProductsCount = Number(cachedSummary.invalidProductsCount || 0)
    syncMissingProductsCount = Number(cachedSummary.syncMissingProductsCount || 0)
    unknownProductsCount = Number(cachedSummary.unknownProductsCount || 0)
    blacklistedCount = Number(cachedSummary.blacklistedCount || 0)

    for (const platformKey of ['yeahpromos', 'partnerboost'] as const) {
      const platformCached = cachedPlatformStats?.[platformKey]
      if (!platformCached || typeof platformCached !== 'object') continue
      platformStatsAccumulator[platformKey] = {
        total: toSafeCount(platformCached.total),
        productCount: toSafeCount(platformCached.productCount),
        storeCount: toSafeCount(platformCached.storeCount),
        productsWithLinkCount: toSafeCount(platformCached.productsWithLinkCount),
        activeProductsCount: toSafeCount(platformCached.activeProductsCount),
        invalidProductsCount: toSafeCount(platformCached.invalidProductsCount),
        syncMissingProductsCount: toSafeCount(platformCached.syncMissingProductsCount),
        unknownProductsCount: toSafeCount(platformCached.unknownProductsCount),
        blacklistedCount: toSafeCount(platformCached.blacklistedCount),
      }
    }

    platformStats = finalizePlatformStats(platformStatsAccumulator)
    const cachedLanding = cachedSummary.landingPageStats
    const productCount = toSafeCount(cachedLanding?.productCount)
    const storeCount = toSafeCount(cachedLanding?.storeCount)
    const fallbackProductCount = platformStats.yeahpromos.productCount + platformStats.partnerboost.productCount
    const fallbackStoreCount = platformStats.yeahpromos.storeCount + platformStats.partnerboost.storeCount
    const resolvedProductCount = productCount > 0 || storeCount > 0 ? productCount : fallbackProductCount
    const resolvedStoreCount = productCount > 0 || storeCount > 0 ? storeCount : fallbackStoreCount
    landingPageStats = {
      productCount: resolvedProductCount,
      storeCount: resolvedStoreCount,
      unknownCount: Math.max(0, total - resolvedProductCount - resolvedStoreCount),
    }
  } else if (fastSummary) {
    if (cachedSummary) {
      productsWithLinkCount = Number(cachedSummary.productsWithLinkCount || 0)
      activeProductsCount = Number(cachedSummary.activeProductsCount || 0)
      invalidProductsCount = Number(cachedSummary.invalidProductsCount || 0)
      syncMissingProductsCount = Number(cachedSummary.syncMissingProductsCount || 0)
      unknownProductsCount = Number(cachedSummary.unknownProductsCount || 0)
      blacklistedCount = Number(cachedSummary.blacklistedCount || 0)
    }

    const basePlatformRows = lightweightSummary
      ? await db.query<{
        platform: string
        total_count: number
        asin_product_count: number
      }>(
        `
          SELECT
            p.platform AS platform,
            COUNT(*) AS total_count,
            SUM(CASE WHEN ${asinPresentConditionSql} THEN 1 ELSE 0 END) AS asin_product_count
          FROM affiliate_products p
          WHERE ${baseWhereSql}
          GROUP BY p.platform
        `,
        [...whereParams]
      )
      : await db.query<{
        platform: string
        total_count: number
        product_count: number
        store_count: number
      }>(
        `
          SELECT
            p.platform AS platform,
            COUNT(*) AS total_count,
            SUM(CASE WHEN ${landingTypeSql.productCondition} THEN 1 ELSE 0 END) AS product_count,
            SUM(CASE WHEN ${landingTypeSql.storeCondition} THEN 1 ELSE 0 END) AS store_count
          FROM affiliate_products p
          WHERE ${baseWhereSql}
          GROUP BY p.platform
        `,
        [...whereParams]
      )

    for (const row of basePlatformRows) {
      const platformKey = normalizeAffiliatePlatform(row.platform)
      if (!platformKey) continue
      platformStatsAccumulator[platformKey].total = toSafeCount(row.total_count)
      if (lightweightSummary) {
        platformStatsAccumulator[platformKey].productCount = toSafeCount((row as any).asin_product_count)
        platformStatsAccumulator[platformKey].storeCount = 0
      } else {
        platformStatsAccumulator[platformKey].productCount = toSafeCount((row as any).product_count)
        platformStatsAccumulator[platformKey].storeCount = toSafeCount((row as any).store_count)
      }
    }

    if (statusFilter === 'all') {
      total = Object.values(platformStatsAccumulator).reduce((sum, item) => sum + item.total, 0)
      platformStats = finalizePlatformStats(platformStatsAccumulator)
      landingPageStats = lightweightSummary
        ? resolveLightweightLandingPageStats(total)
        : (() => {
          const productCount = platformStats.yeahpromos.productCount + platformStats.partnerboost.productCount
          const storeCount = platformStats.yeahpromos.storeCount + platformStats.partnerboost.storeCount
          return {
            productCount,
            storeCount,
            unknownCount: Math.max(0, total - productCount - storeCount),
          }
        })()
    } else {
      const fastVisibleRows = lightweightSummary
        ? await db.query<{
          platform: string
          visible_count: number
          asin_product_count: number
        }>(
          `
            ${fullSyncBaselineCteSql}
            SELECT
              p.platform AS platform,
              COUNT(*) AS visible_count,
              SUM(CASE WHEN ${asinPresentConditionSql} THEN 1 ELSE 0 END) AS asin_product_count
            FROM affiliate_products p
            LEFT JOIN latest_platform_full_sync baseline ON baseline.platform = p.platform
            WHERE ${filteredWhereSql}
            GROUP BY p.platform
          `,
          [userId, ...filteredWhereParams]
        )
        : await db.query<{
          platform: string
          visible_count: number
          product_count: number
          store_count: number
        }>(
          `
            ${fullSyncBaselineCteSql}
            SELECT
              p.platform AS platform,
              COUNT(*) AS visible_count,
              SUM(CASE WHEN ${landingTypeSql.productCondition} THEN 1 ELSE 0 END) AS product_count,
              SUM(CASE WHEN ${landingTypeSql.storeCondition} THEN 1 ELSE 0 END) AS store_count
            FROM affiliate_products p
            LEFT JOIN latest_platform_full_sync baseline ON baseline.platform = p.platform
            WHERE ${filteredWhereSql}
            GROUP BY p.platform
          `,
          [userId, ...filteredWhereParams]
        )

      for (const platformKey of ['yeahpromos', 'partnerboost'] as const) {
        platformStatsAccumulator[platformKey].productCount = 0
        platformStatsAccumulator[platformKey].storeCount = 0
      }

      let visibleTotal = 0
      for (const row of fastVisibleRows) {
        const platformKey = normalizeAffiliatePlatform(row.platform)
        if (!platformKey) continue
        const visibleCount = toSafeCount(row.visible_count)
        visibleTotal += visibleCount
        if (lightweightSummary) {
          platformStatsAccumulator[platformKey].productCount = toSafeCount((row as any).asin_product_count)
          platformStatsAccumulator[platformKey].storeCount = 0
        } else {
          platformStatsAccumulator[platformKey].productCount = toSafeCount((row as any).product_count)
          platformStatsAccumulator[platformKey].storeCount = toSafeCount((row as any).store_count)
        }

        if (statusFilter === 'active') {
          platformStatsAccumulator[platformKey].activeProductsCount = visibleCount
          continue
        }
        if (statusFilter === 'invalid') {
          platformStatsAccumulator[platformKey].invalidProductsCount = visibleCount
          continue
        }
        if (statusFilter === 'sync_missing') {
          platformStatsAccumulator[platformKey].syncMissingProductsCount = visibleCount
          continue
        }
        platformStatsAccumulator[platformKey].unknownProductsCount = visibleCount
      }

      total = visibleTotal
      if (statusFilter === 'active') {
        activeProductsCount = visibleTotal
      } else if (statusFilter === 'invalid') {
        invalidProductsCount = visibleTotal
      } else if (statusFilter === 'sync_missing') {
        syncMissingProductsCount = visibleTotal
      } else if (statusFilter === 'unknown') {
        unknownProductsCount = visibleTotal
      }

      platformStats = finalizePlatformStats(platformStatsAccumulator)
      landingPageStats = lightweightSummary
        ? resolveLightweightLandingPageStats(total)
        : (() => {
          const productCount = platformStats.yeahpromos.productCount + platformStats.partnerboost.productCount
          const storeCount = platformStats.yeahpromos.storeCount + platformStats.partnerboost.storeCount
          return {
            productCount,
            storeCount,
            unknownCount: Math.max(0, total - productCount - storeCount),
          }
        })()
    }

    if (!lightweightSummary) {
      await setCachedProductSummary(userId, summaryCacheHash, {
        total,
        productsWithLinkCount,
        activeProductsCount,
        invalidProductsCount,
        syncMissingProductsCount,
        unknownProductsCount,
        blacklistedCount,
        landingPageStats,
        platformStats,
      })
    }
  } else {
    const summaryRow = await db.queryOne<{
      total_count: number
      active_products_count: number
      sync_missing_products_count: number
      unknown_products_count: number
      blacklisted_count: number
      products_with_link_count: number
      yeahpromos_count: number
    }>(
      `
        ${fullSyncBaselineCteSql}
        SELECT
          COUNT(*) AS total_count,
          SUM(CASE WHEN baseline.baseline_started_at IS NOT NULL AND p.last_seen_at IS NOT NULL AND p.last_seen_at >= baseline.baseline_started_at THEN 1 ELSE 0 END) AS active_products_count,
          SUM(CASE WHEN baseline.baseline_started_at IS NOT NULL AND (p.last_seen_at IS NULL OR p.last_seen_at < baseline.baseline_started_at) THEN 1 ELSE 0 END) AS sync_missing_products_count,
          SUM(CASE WHEN baseline.baseline_started_at IS NULL THEN 1 ELSE 0 END) AS unknown_products_count,
          SUM(CASE WHEN COALESCE(p.is_blacklisted, FALSE) = TRUE THEN 1 ELSE 0 END) AS blacklisted_count,
          SUM(
            CASE
              WHEN COALESCE(NULLIF(TRIM(p.short_promo_link), ''), NULLIF(TRIM(p.promo_link), '')) IS NOT NULL THEN 1
              ELSE 0
            END
          ) AS products_with_link_count,
          SUM(CASE WHEN p.platform = 'yeahpromos' THEN 1 ELSE 0 END) AS yeahpromos_count
        FROM affiliate_products p
        LEFT JOIN latest_platform_full_sync baseline ON baseline.platform = p.platform
        WHERE ${baseWhereSql}
      `,
      [userId, ...whereParams]
    )

    const platformSummaryRows = await db.query<{
      platform: string
      total_count: number
      product_count: number
      store_count: number
      active_products_count: number
      sync_missing_products_count: number
      unknown_products_count: number
      blacklisted_count: number
      products_with_link_count: number
    }>(
      `
        ${fullSyncBaselineCteSql}
        SELECT
          p.platform AS platform,
          COUNT(*) AS total_count,
          SUM(CASE WHEN ${landingTypeSql.productCondition} THEN 1 ELSE 0 END) AS product_count,
          SUM(CASE WHEN ${landingTypeSql.storeCondition} THEN 1 ELSE 0 END) AS store_count,
          SUM(CASE WHEN baseline.baseline_started_at IS NOT NULL AND p.last_seen_at IS NOT NULL AND p.last_seen_at >= baseline.baseline_started_at THEN 1 ELSE 0 END) AS active_products_count,
          SUM(CASE WHEN baseline.baseline_started_at IS NOT NULL AND (p.last_seen_at IS NULL OR p.last_seen_at < baseline.baseline_started_at) THEN 1 ELSE 0 END) AS sync_missing_products_count,
          SUM(CASE WHEN baseline.baseline_started_at IS NULL THEN 1 ELSE 0 END) AS unknown_products_count,
          SUM(CASE WHEN COALESCE(p.is_blacklisted, FALSE) = TRUE THEN 1 ELSE 0 END) AS blacklisted_count,
          SUM(
            CASE
              WHEN COALESCE(NULLIF(TRIM(p.short_promo_link), ''), NULLIF(TRIM(p.promo_link), '')) IS NOT NULL THEN 1
              ELSE 0
            END
          ) AS products_with_link_count
        FROM affiliate_products p
        LEFT JOIN latest_platform_full_sync baseline ON baseline.platform = p.platform
        WHERE ${baseWhereSql}
        GROUP BY p.platform
      `,
      [userId, ...whereParams]
    )

    for (const row of platformSummaryRows) {
      const platformKey = normalizeAffiliatePlatform(row.platform)
      if (!platformKey) continue
      platformStatsAccumulator[platformKey] = {
        total: toSafeCount(row.total_count),
        productCount: toSafeCount(row.product_count),
        storeCount: toSafeCount(row.store_count),
        productsWithLinkCount: toSafeCount(row.products_with_link_count),
        activeProductsCount: toSafeCount(row.active_products_count),
        invalidProductsCount: 0,
        syncMissingProductsCount: toSafeCount(row.sync_missing_products_count),
        unknownProductsCount: toSafeCount(row.unknown_products_count),
        blacklistedCount: toSafeCount(row.blacklisted_count),
      }
    }

    let invalidActiveOverlapCount = 0
    let invalidSyncMissingOverlapCount = 0
    let invalidUnknownOverlapCount = 0

    if (!skipInvalidSummary) {
      const invalidSummaryRow = await db.queryOne<{
        invalid_products_count: number
        invalid_active_overlap_count: number
        invalid_sync_missing_overlap_count: number
        invalid_unknown_overlap_count: number
      }>(
        `
          ${fullSyncBaselineCteSql}
          SELECT
            COUNT(*) AS invalid_products_count,
            SUM(CASE WHEN baseline.baseline_started_at IS NOT NULL AND p.last_seen_at IS NOT NULL AND p.last_seen_at >= baseline.baseline_started_at THEN 1 ELSE 0 END) AS invalid_active_overlap_count,
            SUM(CASE WHEN baseline.baseline_started_at IS NOT NULL AND (p.last_seen_at IS NULL OR p.last_seen_at < baseline.baseline_started_at) THEN 1 ELSE 0 END) AS invalid_sync_missing_overlap_count,
            SUM(CASE WHEN baseline.baseline_started_at IS NULL THEN 1 ELSE 0 END) AS invalid_unknown_overlap_count
          FROM affiliate_products p
          LEFT JOIN latest_platform_full_sync baseline ON baseline.platform = p.platform
          WHERE ${baseWhereSql}
            AND ${confirmedInvalidStatusSql}
        `,
        [userId, ...whereParams]
      )

      const invalidSummaryByPlatformRows = await db.query<{
        platform: string
        invalid_products_count: number
        invalid_active_overlap_count: number
        invalid_sync_missing_overlap_count: number
        invalid_unknown_overlap_count: number
      }>(
        `
          ${fullSyncBaselineCteSql}
          SELECT
            p.platform AS platform,
            COUNT(*) AS invalid_products_count,
            SUM(CASE WHEN baseline.baseline_started_at IS NOT NULL AND p.last_seen_at IS NOT NULL AND p.last_seen_at >= baseline.baseline_started_at THEN 1 ELSE 0 END) AS invalid_active_overlap_count,
            SUM(CASE WHEN baseline.baseline_started_at IS NOT NULL AND (p.last_seen_at IS NULL OR p.last_seen_at < baseline.baseline_started_at) THEN 1 ELSE 0 END) AS invalid_sync_missing_overlap_count,
            SUM(CASE WHEN baseline.baseline_started_at IS NULL THEN 1 ELSE 0 END) AS invalid_unknown_overlap_count
          FROM affiliate_products p
          LEFT JOIN latest_platform_full_sync baseline ON baseline.platform = p.platform
          WHERE ${baseWhereSql}
            AND ${confirmedInvalidStatusSql}
          GROUP BY p.platform
        `,
        [userId, ...whereParams]
      )

      invalidProductsCount = Number(invalidSummaryRow?.invalid_products_count || 0)
      invalidActiveOverlapCount = Number(invalidSummaryRow?.invalid_active_overlap_count || 0)
      invalidSyncMissingOverlapCount = Number(invalidSummaryRow?.invalid_sync_missing_overlap_count || 0)
      invalidUnknownOverlapCount = Number(invalidSummaryRow?.invalid_unknown_overlap_count || 0)

      for (const row of invalidSummaryByPlatformRows) {
        const platformKey = normalizeAffiliatePlatform(row.platform)
        if (!platformKey) continue
        const invalidCount = toSafeCount(row.invalid_products_count)
        const invalidActiveOverlap = toSafeCount(row.invalid_active_overlap_count)
        const invalidSyncMissingOverlap = toSafeCount(row.invalid_sync_missing_overlap_count)
        const invalidUnknownOverlap = toSafeCount(row.invalid_unknown_overlap_count)

        platformStatsAccumulator[platformKey].invalidProductsCount = invalidCount
        platformStatsAccumulator[platformKey].activeProductsCount = Math.max(
          0,
          platformStatsAccumulator[platformKey].activeProductsCount - invalidActiveOverlap
        )
        platformStatsAccumulator[platformKey].syncMissingProductsCount = Math.max(
          0,
          platformStatsAccumulator[platformKey].syncMissingProductsCount - invalidSyncMissingOverlap
        )
        platformStatsAccumulator[platformKey].unknownProductsCount = Math.max(
          0,
          platformStatsAccumulator[platformKey].unknownProductsCount - invalidUnknownOverlap
        )
      }
    }

    const baseActiveProductsCount = Number(summaryRow?.active_products_count || 0)
    const baseSyncMissingProductsCount = Number(summaryRow?.sync_missing_products_count || 0)
    const baseUnknownProductsCount = Number(summaryRow?.unknown_products_count || 0)

    activeProductsCount = Math.max(0, baseActiveProductsCount - invalidActiveOverlapCount)
    syncMissingProductsCount = Math.max(0, baseSyncMissingProductsCount - invalidSyncMissingOverlapCount)
    unknownProductsCount = Math.max(0, baseUnknownProductsCount - invalidUnknownOverlapCount)

    total = (() => {
      if (statusFilter === 'all') return Number(summaryRow?.total_count || 0)
      if (statusFilter === 'invalid') return invalidProductsCount
      if (statusFilter === 'active') return activeProductsCount
      if (statusFilter === 'sync_missing') return syncMissingProductsCount
      return unknownProductsCount
    })()
    productsWithLinkCount = Number(summaryRow?.products_with_link_count || 0)
    blacklistedCount = Number(summaryRow?.blacklisted_count || 0)

    if (statusFilter !== 'all') {
      const filteredLandingRows = await db.query<{
        platform: string
        product_count: number
        store_count: number
      }>(
        `
          ${fullSyncBaselineCteSql}
          SELECT
            p.platform AS platform,
            SUM(CASE WHEN ${landingTypeSql.productCondition} THEN 1 ELSE 0 END) AS product_count,
            SUM(CASE WHEN ${landingTypeSql.storeCondition} THEN 1 ELSE 0 END) AS store_count
          FROM affiliate_products p
          LEFT JOIN latest_platform_full_sync baseline ON baseline.platform = p.platform
          WHERE ${filteredWhereSql}
          GROUP BY p.platform
        `,
        [userId, ...filteredWhereParams]
      )

      for (const platformKey of ['yeahpromos', 'partnerboost'] as const) {
        platformStatsAccumulator[platformKey].productCount = 0
        platformStatsAccumulator[platformKey].storeCount = 0
      }
      for (const row of filteredLandingRows) {
        const platformKey = normalizeAffiliatePlatform(row.platform)
        if (!platformKey) continue
        platformStatsAccumulator[platformKey].productCount = toSafeCount(row.product_count)
        platformStatsAccumulator[platformKey].storeCount = toSafeCount(row.store_count)
      }
    }

    platformStats = finalizePlatformStats(platformStatsAccumulator)
    const productCount = platformStats.yeahpromos.productCount + platformStats.partnerboost.productCount
    const storeCount = platformStats.yeahpromos.storeCount + platformStats.partnerboost.storeCount
    landingPageStats = {
      productCount,
      storeCount,
      unknownCount: Math.max(0, total - productCount - storeCount),
    }

    await setCachedProductSummary(userId, summaryCacheHash, {
      total,
      productsWithLinkCount,
      activeProductsCount,
      invalidProductsCount,
      syncMissingProductsCount,
      unknownProductsCount,
      blacklistedCount,
      landingPageStats,
      platformStats,
    })
  }

  const rows = await rowsPromise
  if (!skipItems) {
    await hydratePartnerboostShortLinksForRows({
      db,
      userId,
      rows,
    })
  }

  const items = skipItems
    ? []
    : rows.map((row, index) => {
      const rowForMapping = statusFilter === 'all'
        ? {
            ...row,
            product_status: resolveLifecycleStatusFromRowForList(row),
          }
        : row
      return mapAffiliateProductRow(rowForMapping, offset + index + 1)
    })

  return {
    items,
    total,
    landingPageStats,
    productsWithLinkCount,
    activeProductsCount,
    invalidProductsCount,
    syncMissingProductsCount,
    unknownProductsCount,
    blacklistedCount,
    platformStats,
    page,
    pageSize,
  }
}

function mapAffiliateProductRow(
  row: AffiliateProduct & {
    related_offer_count?: number
    active_offer_count?: number
    historical_offer_count?: number
    product_status?: AffiliateProductLifecycleStatus
  },
  serialNumber?: number
): AffiliateProductListItem {
  const normalizedCommissionRateMode = normalizeCommissionRateMode(row.commission_rate_mode)
  const hasComparableCommissionValues = row.commission_amount !== null && row.commission_rate !== null
  const looksLikeAmountModeFromValues = hasComparableCommissionValues
    ? Math.abs(Number(row.commission_amount) - Number(row.commission_rate)) < 0.000001
    : false

  const commissionRateMode: 'percent' | 'amount' = normalizedCommissionRateMode
    || (looksLikeAmountModeFromValues ? 'amount' : 'percent')

  const inferredCommissionCurrency = normalizeCurrencyUnit(row.price_currency)

  const normalizedCommissionAmount = commissionRateMode === 'amount'
    ? (row.commission_amount ?? row.commission_rate)
    : row.commission_amount

  const normalizedCommissionRate = commissionRateMode === 'amount'
    ? (row.commission_amount ?? row.commission_rate)
    : row.commission_rate

  const normalizedReviewCount = row.review_count
  const isDeepLink = normalizeTriStateBool(row.is_deeplink)
  const landingPageType = detectAffiliateLandingPageType({
    asin: row.asin,
    productUrl: row.product_url,
    promoLink: row.promo_link,
    shortPromoLink: row.short_promo_link,
  })
  const normalizedId = Number(row.id)
  if (!Number.isFinite(normalizedId) || normalizedId <= 0) {
    throw new Error(`[affiliate-products] invalid affiliate_products.id: ${String(row.id)}`)
  }
  const resolvedSerial = typeof serialNumber === 'number' && Number.isFinite(serialNumber)
    ? serialNumber
    : normalizedId

  const merchantId = (() => {
    if (row.platform === 'partnerboost') {
      const partnerboostMerchantId = String(row.merchant_id || '').trim()
      return partnerboostMerchantId || null
    }

    const defaultMerchantId = String(row.mid || '').trim()
    return defaultMerchantId || null
  })()

  return {
    id: normalizedId,
    serial: resolvedSerial,
    platform: row.platform,
    mid: row.mid,
    merchantId,
    productStatus: resolveAffiliateProductLifecycleStatus(row.product_status),
    asin: row.asin,
    landingPageType,
    isDeepLink,
    brand: row.brand,
    productName: row.product_name,
    productUrl: row.product_url,
    allowedCountries: parseAllowedCountries(row.allowed_countries_json),
    priceAmount: row.price_amount,
    priceCurrency: row.price_currency,
    commissionRate: normalizedCommissionRate,
    commissionRateMode,
    commissionAmount: normalizedCommissionAmount,
    commissionCurrency: inferredCommissionCurrency,
    reviewCount: normalizedReviewCount,
    promoLink: row.short_promo_link || row.promo_link,
    shortPromoLink: row.short_promo_link,
    activeOfferCount: Number(row.active_offer_count || 0),
    historicalOfferCount: Number(row.historical_offer_count || 0),
    relatedOfferCount: Number(row.related_offer_count || 0),
    isBlacklisted: toBool(row.is_blacklisted),
    recommendationScore: row.recommendation_score || null,
    recommendationReasons: row.recommendation_reasons ? JSON.parse(row.recommendation_reasons) : null,
    seasonalityScore: row.seasonality_score || null,
    productAnalysis: row.product_analysis ? JSON.parse(row.product_analysis) : null,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const __testOnly = {
  assertPartnerboostAsinRequestLimit,
  calculateExponentialBackoffDelay,
  buildComparableUrlTokens,
  dedupeNormalizedProducts,
  extractAsinFromUrlLike,
  extractPartnerboostLinkId,
  isPartnerboostTransientError,
  isPartnerboostRateLimited,
  isPartnerboostRateLimitError,
  isYeahPromosRateLimited,
  isYeahPromosTransientError,
  parseYeahPromosProductHtmlPage,
  buildYeahPromosProductsPageUrl,
  applyYeahPromosTemplateSiteId,
  buildYeahPromosDeltaScopePlan,
  resolveYeahPromosMarketplaceTemplates,
  resolveYeahPromosSyncSessionMinRemainingMs,
  resolveYeahPromosConsecutiveFailureStrategy,
  parseYeahPromosProxyCountryUrlMap,
  resolveYeahPromosProxyProviderUrl,
  detectYeahPromosHttpIntercept,
  resolveYeahPromosProductMid,
  normalizeYeahPromosStoreMerchant,
  buildYeahPromosAdvertContentUrl,
  resolveOfferProductBackfillDecision,
  resolvePartnerboostFullSyncCountrySequence,
  normalizeNumericRangeBounds,
  mapAffiliateProductRow,
  resolveSyncMaxPages,
}

export async function getAffiliateProductById(userId: number, productId: number): Promise<AffiliateProduct | null> {
  const db = await getDatabase()
  const row = await db.queryOne<AffiliateProduct>(
    `SELECT * FROM affiliate_products WHERE id = ? AND user_id = ? LIMIT 1`,
    [productId, userId]
  )
  return row || null
}

export async function clearAllAffiliateProducts(userId: number): Promise<{ deletedCount: number }> {
  const db = await getDatabase()

  const totalRow = await db.queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM affiliate_products WHERE user_id = ?`,
    [userId]
  )

  await db.exec(
    `DELETE FROM affiliate_products WHERE user_id = ?`,
    [userId]
  )

  return {
    deletedCount: Number(totalRow?.total || 0),
  }
}

async function listActiveLinkedOfferIdsForProduct(userId: number, productId: number): Promise<number[]> {
  const db = await getDatabase()
  const offerNotDeletedCondition = db.type === 'postgres'
    ? '(o.is_deleted = false OR o.is_deleted IS NULL)'
    : '(o.is_deleted = 0 OR o.is_deleted IS NULL)'

  const rows = await db.query<{ offer_id: number }>(
    `
      SELECT DISTINCT link.offer_id
      FROM affiliate_product_offer_links link
      INNER JOIN offers o ON o.id = link.offer_id AND o.user_id = link.user_id
      WHERE link.user_id = ?
        AND link.product_id = ?
        AND ${offerNotDeletedCondition}
      ORDER BY link.offer_id ASC
    `,
    [userId, productId]
  )

  return rows
    .map((row) => Number(row.offer_id))
    .filter((value) => Number.isFinite(value) && value > 0)
}

export async function offlineAffiliateProduct(params: {
  userId: number
  productId: number
}): Promise<AffiliateProductOfflineResult> {
  const product = await getAffiliateProductById(params.userId, params.productId)
  if (!product) {
    throw new Error('商品不存在')
  }

  const linkedOfferIds = await listActiveLinkedOfferIdsForProduct(params.userId, params.productId)
  const deletedOfferIds: number[] = []
  const failedOffers: AffiliateProductOfflineFailure[] = []

  for (const offerId of linkedOfferIds) {
    try {
      const result = await deleteOffer(offerId, params.userId, true, true)
      if (!result.success) {
        throw new Error(result.message || '删除Offer失败')
      }
      deletedOfferIds.push(offerId)
    } catch (error: any) {
      failedOffers.push({
        offerId,
        error: error?.message || '删除Offer失败',
      })
    }
  }

  const offlined = failedOffers.length === 0
  const updatedProduct = offlined
    ? await setAffiliateProductBlacklist(params.userId, params.productId, true)
    : product

  return {
    productId: params.productId,
    totalLinkedOffers: linkedOfferIds.length,
    deletedOfferCount: deletedOfferIds.length,
    deletedOfferIds,
    failedOffers,
    offlined,
    product: updatedProduct,
  }
}

export async function batchOfflineAffiliateProducts(params: {
  userId: number
  productIds: number[]
}): Promise<BatchOfflineAffiliateProductsResult> {
  const dedupedProductIds = Array.from(new Set(
    params.productIds
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)
  ))

  const results: BatchOfflineAffiliateProductsResult['results'] = []
  let successCount = 0
  let failureCount = 0

  for (const productId of dedupedProductIds) {
    try {
      const result = await offlineAffiliateProduct({
        userId: params.userId,
        productId,
      })

      if (!result.offlined) {
        failureCount += 1
        results.push({
          productId,
          success: false,
          deletedOfferCount: result.deletedOfferCount,
          totalLinkedOffers: result.totalLinkedOffers,
          offlined: result.offlined,
          failedOffers: result.failedOffers,
          error: `下线失败：${result.failedOffers.length}/${result.totalLinkedOffers} 个关联Offer删除失败`,
        })
        continue
      }

      successCount += 1
      results.push({
        productId,
        success: true,
        deletedOfferCount: result.deletedOfferCount,
        totalLinkedOffers: result.totalLinkedOffers,
        offlined: result.offlined,
      })
    } catch (error: any) {
      failureCount += 1
      results.push({
        productId,
        success: false,
        error: error?.message || '下线商品失败',
      })
    }
  }

  return {
    total: dedupedProductIds.length,
    successCount,
    failureCount,
    results,
  }
}

export async function setAffiliateProductBlacklist(userId: number, productId: number, blacklisted: boolean): Promise<AffiliateProduct | null> {
  const db = await getDatabase()
  const value = db.type === 'postgres' ? blacklisted : (blacklisted ? 1 : 0)
  const nowIso = new Date().toISOString()

  await db.exec(
    `
      UPDATE affiliate_products
      SET is_blacklisted = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `,
    [value, nowIso, productId, userId]
  )

  return await getAffiliateProductById(userId, productId)
}

export async function recordAffiliateProductOfferLink(params: {
  userId: number
  productId: number
  offerId: number
  createdVia?: AffiliateProductOfferLinkCreatedVia
}): Promise<void> {
  const db = await getDatabase()
  await db.exec(
    `
      INSERT INTO affiliate_product_offer_links (user_id, product_id, offer_id, created_via)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, product_id, offer_id) DO NOTHING
    `,
    [params.userId, params.productId, params.offerId, params.createdVia || 'single']
  )
}

export async function linkOfferToAffiliateProduct(params: {
  userId: number
  productId: number
  offerId: number
}): Promise<{ product: AffiliateProduct; offerId: number; linked: boolean }> {
  const db = await getDatabase()

  const product = await getAffiliateProductById(params.userId, params.productId)
  if (!product) {
    throw new Error('商品不存在')
  }

  const offer = await findOfferById(params.offerId, params.userId)
  if (!offer) {
    throw new Error('Offer不存在')
  }

  const existing = await db.queryOne<{ id: number }>(
    `
      SELECT id
      FROM affiliate_product_offer_links
      WHERE user_id = ? AND product_id = ? AND offer_id = ?
      LIMIT 1
    `,
    [params.userId, params.productId, params.offerId]
  )

  if (existing) {
    return {
      product,
      offerId: offer.id,
      linked: false,
    }
  }

  await recordAffiliateProductOfferLink({
    userId: params.userId,
    productId: params.productId,
    offerId: params.offerId,
    createdVia: 'manual_link',
  })

  return {
    product,
    offerId: offer.id,
    linked: true,
  }
}

export async function backfillOfferProductLinkForPublishedCampaign(params: {
  userId: number
  offerId: number
}): Promise<OfferProductLinkBackfillResult> {
  const db = await getDatabase()

  const existing = await db.queryOne<{ product_id: number }>(
    `
      SELECT product_id
      FROM affiliate_product_offer_links
      WHERE user_id = ? AND offer_id = ?
      LIMIT 1
    `,
    [params.userId, params.offerId]
  )

  if (existing && Number.isFinite(Number(existing.product_id)) && Number(existing.product_id) > 0) {
    return {
      linked: false,
      offerId: params.offerId,
      productId: Number(existing.product_id),
      reason: 'already_linked',
      signals: {
        urlTokenCount: 0,
        linkIdCount: 0,
        asinCount: 0,
        brandCount: 0,
      },
      candidates: {
        exactUrlProductIds: [],
        linkIdProductIds: [],
        asinProductIds: [],
        brandProductIds: [],
      },
    }
  }

  const offerNotDeletedCondition = db.type === 'postgres'
    ? '(is_deleted = false OR is_deleted IS NULL)'
    : '(is_deleted = 0 OR is_deleted IS NULL)'

  const offer = await db.queryOne<{
    id: number
    url: string | null
    final_url: string | null
    affiliate_link: string | null
  }>(
    `
      SELECT id, url, final_url, affiliate_link
      FROM offers
      WHERE id = ? AND user_id = ? AND ${offerNotDeletedCondition}
      LIMIT 1
    `,
    [params.offerId, params.userId]
  )

  if (!offer) {
    return {
      linked: false,
      offerId: params.offerId,
      productId: null,
      reason: 'offer_not_found',
      signals: {
        urlTokenCount: 0,
        linkIdCount: 0,
        asinCount: 0,
        brandCount: 0,
      },
      candidates: {
        exactUrlProductIds: [],
        linkIdProductIds: [],
        asinProductIds: [],
        brandProductIds: [],
      },
    }
  }

  const offerUrlTokens = new Set<string>()
  const offerLinkIds = new Set<string>()
  const offerAsins = new Set<string>()
  const offerUrlCandidates = [offer.url, offer.final_url, offer.affiliate_link]

  for (const candidate of offerUrlCandidates) {
    for (const token of buildComparableUrlTokens(candidate)) {
      offerUrlTokens.add(token)
    }

    const linkId = extractPartnerboostLinkId(candidate)
    if (linkId) {
      offerLinkIds.add(linkId.toLowerCase())
    }

    const asin = extractAsinFromUrlLike(candidate)
    if (asin) {
      offerAsins.add(asin)
    }
  }

  // Query brand information from affiliate_products for ASINs found in offer URLs
  const offerBrands = new Set<string>()
  if (offerAsins.size > 0) {
    const asinArray = Array.from(offerAsins)
    const asinPlaceholders = asinArray.map(() => '?').join(', ')
    const brandRows = await db.query<{ brand: string }>(
      `
        SELECT DISTINCT brand
        FROM affiliate_products
        WHERE user_id = ? AND asin IN (${asinPlaceholders}) AND brand IS NOT NULL
      `,
      [params.userId, ...asinArray]
    )
    for (const row of brandRows) {
      const brand = normalizeBrand(row.brand)
      if (brand) {
        offerBrands.add(brand)
      }
    }
  }

  if (offerUrlTokens.size === 0 && offerLinkIds.size === 0 && offerAsins.size === 0 && offerBrands.size === 0) {
    return {
      linked: false,
      offerId: params.offerId,
      productId: null,
      reason: 'no_offer_signal',
      signals: {
        urlTokenCount: 0,
        linkIdCount: 0,
        asinCount: 0,
        brandCount: 0,
      },
      candidates: {
        exactUrlProductIds: [],
        linkIdProductIds: [],
        asinProductIds: [],
        brandProductIds: [],
      },
    }
  }

  const notBlacklistedCondition = db.type === 'postgres'
    ? '(is_blacklisted = false OR is_blacklisted IS NULL)'
    : '(is_blacklisted = 0 OR is_blacklisted IS NULL)'

  const productRows = await db.query<{
    id: number
    asin: string | null
    brand: string | null
    promo_link: string | null
    short_promo_link: string | null
    product_url: string | null
  }>(
    `
      SELECT id, asin, brand, promo_link, short_promo_link, product_url
      FROM affiliate_products
      WHERE user_id = ? AND ${notBlacklistedCondition}
    `,
    [params.userId]
  )

  const exactUrlProductIds: number[] = []
  const linkIdProductIds: number[] = []
  const asinProductIds: number[] = []
  const brandProductIds: number[] = []

  for (const row of productRows) {
    const productId = Number(row.id)
    if (!Number.isFinite(productId) || productId <= 0) continue

    if (offerUrlTokens.size > 0) {
      const productUrlTokens = new Set<string>()
      for (const token of buildComparableUrlTokens(row.promo_link)) {
        productUrlTokens.add(token)
      }
      for (const token of buildComparableUrlTokens(row.short_promo_link)) {
        productUrlTokens.add(token)
      }
      for (const token of buildComparableUrlTokens(row.product_url)) {
        productUrlTokens.add(token)
      }
      for (const token of productUrlTokens) {
        if (!offerUrlTokens.has(token)) continue
        exactUrlProductIds.push(productId)
        break
      }
    }

    if (offerLinkIds.size > 0) {
      const productLinkIdCandidates = [
        extractPartnerboostLinkId(row.promo_link),
        extractPartnerboostLinkId(row.short_promo_link),
      ]
      for (const linkId of productLinkIdCandidates) {
        if (!linkId) continue
        if (offerLinkIds.has(linkId.toLowerCase())) {
          linkIdProductIds.push(productId)
          break
        }
      }
    }

    if (offerAsins.size > 0) {
      const productAsin = normalizeAsin(row.asin)
      if (productAsin && offerAsins.has(productAsin)) {
        asinProductIds.push(productId)
      }
    }

    if (offerBrands.size > 0) {
      const productBrand = normalizeBrand(row.brand)
      if (productBrand && offerBrands.has(productBrand)) {
        brandProductIds.push(productId)
      }
    }
  }

  const decision = resolveOfferProductBackfillDecision({
    exactUrlProductIds,
    linkIdProductIds,
    asinProductIds,
    brandProductIds,
  })

  const reasonMap: Record<OfferProductBackfillDecisionReason, OfferProductLinkBackfillReason> = {
    exact_url: 'linked_by_exact_url',
    link_id: 'linked_by_link_id',
    asin: 'linked_by_asin',
    brand: 'linked_by_brand',
    link_id_asin_intersection: 'linked_by_link_id_asin_intersection',
    ambiguous_exact_url: 'ambiguous_exact_url',
    ambiguous_link_id: 'ambiguous_link_id',
    ambiguous_asin: 'ambiguous_asin',
    ambiguous_brand: 'ambiguous_brand',
    ambiguous_link_id_asin_intersection: 'ambiguous_link_id_asin_intersection',
    conflicting_link_id_asin: 'conflicting_link_id_asin',
    no_match: 'no_match',
  }

  if (!decision.productId) {
    return {
      linked: false,
      offerId: params.offerId,
      productId: null,
      reason: reasonMap[decision.reason],
      signals: {
        urlTokenCount: offerUrlTokens.size,
        linkIdCount: offerLinkIds.size,
        asinCount: offerAsins.size,
        brandCount: offerBrands.size,
      },
      candidates: {
        exactUrlProductIds: decision.exactUrlProductIds,
        linkIdProductIds: decision.linkIdProductIds,
        asinProductIds: decision.asinProductIds,
        brandProductIds: decision.brandProductIds,
      },
    }
  }

  await recordAffiliateProductOfferLink({
    userId: params.userId,
    productId: decision.productId,
    offerId: params.offerId,
    createdVia: 'publish_backfill',
  })

  return {
    linked: true,
    offerId: params.offerId,
    productId: decision.productId,
    reason: reasonMap[decision.reason],
    signals: {
      urlTokenCount: offerUrlTokens.size,
      linkIdCount: offerLinkIds.size,
      asinCount: offerAsins.size,
      brandCount: offerBrands.size,
    },
    candidates: {
      exactUrlProductIds: decision.exactUrlProductIds,
      linkIdProductIds: decision.linkIdProductIds,
      asinProductIds: decision.asinProductIds,
      brandProductIds: decision.brandProductIds,
    },
  }
}

export async function createOfferFromAffiliateProduct(params: {
  userId: number
  productId: number
  targetCountry?: string
  createdVia?: 'single' | 'batch'
}): Promise<{ product: AffiliateProduct; offerId: number; taskId: string }> {
  const db = await getDatabase()
  const product = await getAffiliateProductById(params.userId, params.productId)
  if (!product) {
    throw new Error('商品不存在')
  }

  if (toBool(product.is_blacklisted)) {
    throw new Error('商品已下线，无法创建Offer')
  }

  const offerUrl = chooseOfferUrl(product)
  if (!offerUrl) {
    throw new Error('该商品缺少可用落地页链接，无法创建Offer')
  }

  const allowedCountries = parseAllowedCountries(product.allowed_countries_json)
  const targetCountry = (params.targetCountry || allowedCountries[0] || 'US').toUpperCase()
  const brand = (product.brand || product.product_name || product.mid || 'Unknown').trim()
  const affiliateLink = await resolveOfferAffiliateLinkForProduct({
    db,
    userId: params.userId,
    product,
    targetCountry,
  })

  const offer = await createOffer(params.userId, {
    url: offerUrl,
    brand,
    target_country: targetCountry,
    affiliate_link: affiliateLink || undefined,
    product_price: formatPriceForOffer(product),
    commission_payout: formatCommissionForOffer(product),
    page_type: 'product',
  })

  try {
    await recordAffiliateProductOfferLink({
      userId: params.userId,
      productId: product.id,
      offerId: offer.id,
      createdVia: params.createdVia || 'single',
    })

    const extractionTaskId = await createOfferExtractionTaskForExistingOffer({
      userId: params.userId,
      offerId: offer.id,
      affiliateLink: affiliateLink || offer.affiliate_link || offer.url,
      targetCountry: offer.target_country,
      productPrice: offer.product_price,
      commissionPayout: offer.commission_payout,
      brandName: offer.brand,
      pageType: offer.page_type === 'store' ? 'store' : 'product',
      priority: params.createdVia === 'single' ? 'high' : 'normal',
      skipCache: false,
      skipWarmup: false,
    })

    return {
      product,
      offerId: offer.id,
      taskId: extractionTaskId,
    }
  } catch (error) {
    await db.exec(
      `DELETE FROM affiliate_product_offer_links WHERE user_id = ? AND product_id = ? AND offer_id = ?`,
      [params.userId, product.id, offer.id]
    )
    await db.exec(
      `DELETE FROM offers WHERE id = ? AND user_id = ?`,
      [offer.id, params.userId]
    )

    throw error
  }
}

export async function batchCreateOffersFromAffiliateProducts(params: {
  userId: number
  items: Array<{ productId: number; targetCountry?: string }>
}): Promise<{
  total: number
  successCount: number
  failureCount: number
  results: Array<{ productId: number; success: boolean; offerId?: number; taskId?: string; error?: string }>
}> {
  const results: Array<{ productId: number; success: boolean; offerId?: number; taskId?: string; error?: string }> = []
  let successCount = 0
  let failureCount = 0

  for (const item of params.items) {
    try {
      const result = await createOfferFromAffiliateProduct({
        userId: params.userId,
        productId: item.productId,
        targetCountry: item.targetCountry,
        createdVia: 'batch',
      })
      successCount += 1
      results.push({
        productId: item.productId,
        success: true,
        offerId: result.offerId,
        taskId: result.taskId,
      })
    } catch (error: any) {
      failureCount += 1
      results.push({
        productId: item.productId,
        success: false,
        error: error?.message || '创建Offer失败',
      })
    }
  }

  return {
    total: params.items.length,
    successCount,
    failureCount,
    results,
  }
}

export async function createAffiliateProductSyncRun(params: {
  userId: number
  platform: AffiliatePlatform
  mode: SyncMode
  triggerSource?: string
  status?: 'queued' | 'running' | 'completed' | 'failed'
}): Promise<number> {
  const db = await getDatabase()
  const nowIso = new Date().toISOString()
  const result = await db.exec(
    `
      INSERT INTO affiliate_product_sync_runs
      (user_id, platform, mode, status, trigger_source, started_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      params.userId,
      params.platform,
      params.mode,
      params.status || 'queued',
      params.triggerSource || null,
      params.status === 'running' ? nowIso : null,
      nowIso,
      nowIso,
    ]
  )

  return getInsertedId(result, db.type)
}

export async function updateAffiliateProductSyncRun(params: {
  runId: number
  status?: 'queued' | 'running' | 'completed' | 'failed'
  totalItems?: number
  createdCount?: number
  updatedCount?: number
  failedCount?: number
  cursorPage?: number | null
  cursorScope?: string | null
  processedBatches?: number
  lastHeartbeatAt?: string | null
  errorMessage?: string | null
  startedAt?: string | null
  completedAt?: string | null
}): Promise<void> {
  const db = await getDatabase()
  const updates: string[] = []
  const values: any[] = []

  // Log all update parameters for debugging
  console.log(`[affiliate-sync] updateAffiliateProductSyncRun called for run #${params.runId}:`, {
    status: params.status,
    totalItems: params.totalItems,
    createdCount: params.createdCount,
    updatedCount: params.updatedCount,
    cursorPage: params.cursorPage,
    cursorScope: params.cursorScope,
    hasHeartbeat: params.lastHeartbeatAt !== undefined,
  })

  if (params.status !== undefined) {
    updates.push('status = ?')
    values.push(params.status)
  }
  if (params.totalItems !== undefined) {
    updates.push('total_items = ?')
    values.push(params.totalItems)
  }
  if (params.createdCount !== undefined) {
    updates.push('created_count = ?')
    values.push(params.createdCount)
  }
  if (params.updatedCount !== undefined) {
    updates.push('updated_count = ?')
    values.push(params.updatedCount)
  }
  if (params.failedCount !== undefined) {
    updates.push('failed_count = ?')
    values.push(params.failedCount)
  }
  if (params.cursorPage !== undefined) {
    updates.push('cursor_page = ?')
    values.push(params.cursorPage === null ? 0 : params.cursorPage)
  }
  if (params.cursorScope !== undefined) {
    updates.push('cursor_scope = ?')
    values.push(params.cursorScope || null)
  }
  if (params.processedBatches !== undefined) {
    updates.push('processed_batches = ?')
    values.push(params.processedBatches)
  }
  if (params.lastHeartbeatAt !== undefined) {
    updates.push('last_heartbeat_at = ?')
    values.push(params.lastHeartbeatAt)
  }
  if (params.errorMessage !== undefined) {
    updates.push('error_message = ?')
    values.push(params.errorMessage)
  }
  if (params.startedAt !== undefined) {
    updates.push('started_at = ?')
    values.push(params.startedAt)
  }
  if (params.completedAt !== undefined) {
    updates.push('completed_at = ?')
    values.push(params.completedAt)
  }

  if (updates.length === 0) return

  updates.push('updated_at = ?')
  values.push(new Date().toISOString())
  values.push(params.runId)

  try {
    await db.exec(
      `
        UPDATE affiliate_product_sync_runs
        SET ${updates.join(', ')}
        WHERE id = ?
      `,
      values
    )

    // Log status updates for debugging
    if (params.status) {
      console.log(`[affiliate-sync] Updated run #${params.runId} status to '${params.status}'`)
    }
  } catch (error: any) {
    console.error(`[affiliate-sync] Failed to update run #${params.runId}:`, error?.message || error)
    throw error
  }
}

export async function getAffiliateProductSyncRunById(params: {
  runId: number
  userId?: number
}): Promise<{
  id: number
  user_id: number
  platform: AffiliatePlatform
  mode: SyncMode
  status: string
  trigger_source: string | null
  total_items: number
  created_count: number
  updated_count: number
  failed_count: number
  cursor_page: number
  cursor_scope: string | null
  processed_batches: number
  last_heartbeat_at: string | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
} | null> {
  const db = await getDatabase()
  const whereUser = params.userId ? 'AND user_id = ?' : ''
  const values = params.userId ? [params.runId, params.userId] : [params.runId]

  const row = await db.queryOne<any>(
    `
      SELECT *
      FROM affiliate_product_sync_runs
      WHERE id = ?
      ${whereUser}
      LIMIT 1
    `,
    values
  )

  if (!row) return null

  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    platform: row.platform,
    mode: row.mode,
    status: String(row.status || ''),
    trigger_source: row.trigger_source ?? null,
    total_items: Number(row.total_items || 0),
    created_count: Number(row.created_count || 0),
    updated_count: Number(row.updated_count || 0),
    failed_count: Number(row.failed_count || 0),
    cursor_page: Number(row.cursor_page || 0),
    cursor_scope: row.cursor_scope ?? null,
    processed_batches: Number(row.processed_batches || 0),
    last_heartbeat_at: row.last_heartbeat_at ?? null,
    error_message: row.error_message ?? null,
    started_at: row.started_at ?? null,
    completed_at: row.completed_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function getLatestFailedAffiliateProductSyncRun(params: {
  userId: number
  platform: AffiliatePlatform
  mode: SyncMode
  excludeRunId?: number
}): Promise<{
  id: number
  user_id: number
  platform: AffiliatePlatform
  mode: SyncMode
  status: string
  trigger_source: string | null
  total_items: number
  created_count: number
  updated_count: number
  failed_count: number
  cursor_page: number
  cursor_scope: string | null
  processed_batches: number
  last_heartbeat_at: string | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
} | null> {
  const db = await getDatabase()
  const excludeClause = params.excludeRunId ? 'AND id <> ?' : ''
  const values = params.excludeRunId
    ? [params.userId, params.platform, params.mode, params.excludeRunId]
    : [params.userId, params.platform, params.mode]

  const row = await db.queryOne<any>(
    `
      SELECT *
      FROM affiliate_product_sync_runs
      WHERE user_id = ?
        AND platform = ?
        AND mode = ?
        AND status = 'failed'
        AND cursor_page > 0
        ${excludeClause}
      ORDER BY COALESCE(completed_at, updated_at, created_at) DESC
      LIMIT 1
    `,
    values
  )

  if (!row) return null

  // 仅当“最近一次终态”仍是 failed 时才允许续跑。
  // 如果失败游标之后已有 completed 任务，说明链路已经成功跑通，
  // 再继续续跑旧失败游标会导致手动全量误从历史断点启动。
  const newerCompleted = await db.queryOne<{ id: number }>(
    `
      SELECT id
      FROM affiliate_product_sync_runs
      WHERE user_id = ?
        AND platform = ?
        AND mode = ?
        AND status = 'completed'
        AND id > ?
      LIMIT 1
    `,
    [params.userId, params.platform, params.mode, Number(row.id)]
  )
  if (newerCompleted?.id) {
    return null
  }

  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    platform: row.platform,
    mode: row.mode,
    status: String(row.status || ''),
    trigger_source: row.trigger_source ?? null,
    total_items: Number(row.total_items || 0),
    created_count: Number(row.created_count || 0),
    updated_count: Number(row.updated_count || 0),
    failed_count: Number(row.failed_count || 0),
    cursor_page: Number(row.cursor_page || 0),
    cursor_scope: row.cursor_scope ?? null,
    processed_batches: Number(row.processed_batches || 0),
    last_heartbeat_at: row.last_heartbeat_at ?? null,
    error_message: row.error_message ?? null,
    started_at: row.started_at ?? null,
    completed_at: row.completed_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function getAffiliateProductSyncRuns(userId: number, limit: number = 20): Promise<Array<{
  id: number
  platform: AffiliatePlatform
  mode: SyncMode
  status: string
  trigger_source: string | null
  total_items: number
  created_count: number
  updated_count: number
  failed_count: number
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}>> {
  const db = await getDatabase()
  const safeLimit = Math.max(1, Math.min(limit, 100))
  return await db.query(
    `
      SELECT
        id,
        platform,
        mode,
        status,
        trigger_source,
        total_items,
        created_count,
        updated_count,
        failed_count,
        error_message,
        started_at,
        completed_at,
        created_at
      FROM affiliate_product_sync_runs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    [userId, safeLimit]
  )
}

export async function recordAffiliateProductSyncHourlySnapshot(params: {
  userId: number
  runId: number
  platform: AffiliatePlatform
  totalItems: number
  timestamp?: Date
}): Promise<void> {
  const totalItems = toSafeNonNegativeInt(params.totalItems)
  const now = params.timestamp || new Date()
  const nowIso = now.toISOString()
  const hourBucket = toHourBucketIso(now)
  const db = await getDatabase()

  try {
    if (db.type === 'postgres') {
      await db.exec(
        `
          INSERT INTO affiliate_product_sync_hourly_stats (
            user_id,
            run_id,
            platform,
            hour_bucket,
            max_total_items,
            sample_count,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT (run_id, hour_bucket)
          DO UPDATE SET
            max_total_items = GREATEST(affiliate_product_sync_hourly_stats.max_total_items, EXCLUDED.max_total_items),
            sample_count = affiliate_product_sync_hourly_stats.sample_count + 1,
            updated_at = EXCLUDED.updated_at
        `,
        [params.userId, params.runId, params.platform, hourBucket, totalItems, nowIso, nowIso]
      )
      return
    }

    await db.exec(
      `
        INSERT INTO affiliate_product_sync_hourly_stats (
          user_id,
          run_id,
          platform,
          hour_bucket,
          max_total_items,
          sample_count,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(run_id, hour_bucket)
        DO UPDATE SET
          max_total_items = CASE
            WHEN excluded.max_total_items > affiliate_product_sync_hourly_stats.max_total_items
              THEN excluded.max_total_items
            ELSE affiliate_product_sync_hourly_stats.max_total_items
          END,
          sample_count = affiliate_product_sync_hourly_stats.sample_count + 1,
          updated_at = excluded.updated_at
      `,
      [params.userId, params.runId, params.platform, hourBucket, totalItems, nowIso, nowIso]
    )
  } catch (error) {
    if (isMissingTableError(error)) {
      return
    }
    throw error
  }
}

export async function getYeahPromosSyncMonitor(userId: number): Promise<YeahPromosSyncMonitor> {
  const fallback: YeahPromosSyncMonitor = {
    runId: null,
    runStatus: null,
    targetItems: null,
    fetchedItems: 0,
    remainingItems: null,
    avgItemsPerHour: null,
    etaAt: null,
    windowCloseAt: null,
    canFinishInWindow: null,
    statsUpdatedAt: null,
    hourlyStats: [],
  }

  const targetSetting = await getUserOnlySetting('system', AFFILIATE_YP_ACCESS_PRODUCTS_TARGET_KEY, userId)
  const targetItemsParsed = toSafeNonNegativeInt(targetSetting?.value || null)
  const targetItems = targetItemsParsed > 0 ? targetItemsParsed : null

  const db = await getDatabase()
  const activeRunFreshnessSql = db.type === 'postgres'
    ? "COALESCE(last_heartbeat_at, updated_at, created_at) >= NOW() - INTERVAL '45 minutes'"
    : "COALESCE(last_heartbeat_at, updated_at, created_at) >= datetime('now', '-45 minutes')"
  const latestRun = await db.queryOne<{
    id: number
    status: string
    total_items: number
    started_at: string | null
    completed_at: string | null
    last_heartbeat_at: string | null
    updated_at: string
  }>(
    `
      SELECT
        id,
        status,
        total_items,
        started_at,
        completed_at,
        last_heartbeat_at,
        updated_at
      FROM affiliate_product_sync_runs
      WHERE user_id = ?
        AND platform = 'yeahpromos'
      ORDER BY
        CASE
          WHEN status = 'running' AND (${activeRunFreshnessSql}) THEN 0
          WHEN status = 'queued' AND (${activeRunFreshnessSql}) THEN 1
          ELSE 2
        END,
        COALESCE(last_heartbeat_at, updated_at, created_at) DESC,
        created_at DESC
      LIMIT 1
    `,
    [userId]
  )

  if (!latestRun?.id) {
    return {
      ...fallback,
      targetItems,
    }
  }

  const runId = Number(latestRun.id)
  const fetchedItems = toSafeNonNegativeInt(latestRun.total_items)

  let hourlyRows: Array<{
    hour_bucket: string
    max_total_items: number
    sample_count: number
    updated_at: string | null
  }> = []
  try {
    hourlyRows = await db.query(
      `
        SELECT
          hour_bucket,
          max_total_items,
          sample_count,
          updated_at
        FROM affiliate_product_sync_hourly_stats
        WHERE user_id = ?
          AND run_id = ?
        ORDER BY hour_bucket DESC
        LIMIT 36
      `,
      [userId, runId]
    )
  } catch (error) {
    if (!isMissingTableError(error)) {
      throw error
    }
  }

  const rowsAsc = [...hourlyRows].reverse()
  const hourlyStats: AffiliateProductSyncHourlyStat[] = []
  let previousCumulative = 0
  for (const row of rowsAsc) {
    const cumulativeFetched = Math.max(previousCumulative, toSafeNonNegativeInt(row.max_total_items))
    const fetchedCount = Math.max(0, cumulativeFetched - previousCumulative)
    previousCumulative = cumulativeFetched
    hourlyStats.push({
      hourBucket: String(row.hour_bucket || ''),
      fetchedCount,
      cumulativeFetched,
      sampleCount: toSafeNonNegativeInt(row.sample_count),
      updatedAt: row.updated_at || null,
    })
  }

  const recentStats = hourlyStats.slice(-6).filter((item) => item.fetchedCount > 0)
  let avgItemsPerHour = recentStats.length > 0
    ? roundTo2(recentStats.reduce((sum, item) => sum + item.fetchedCount, 0) / recentStats.length)
    : null

  if ((avgItemsPerHour === null || avgItemsPerHour <= 0) && fetchedItems > 0) {
    const startedAtMs = parseDateToTimestamp(latestRun.started_at)
    if (startedAtMs !== null) {
      const elapsedHours = Math.max(0, (Date.now() - startedAtMs) / (60 * 60 * 1000))
      if (elapsedHours >= 0.1) {
        avgItemsPerHour = roundTo2(fetchedItems / elapsedHours)
      }
    }
  }

  const remainingItems = targetItems !== null
    ? Math.max(0, targetItems - fetchedItems)
    : null

  let etaAt: string | null = null
  if (remainingItems !== null) {
    if (remainingItems === 0) {
      etaAt = latestRun.completed_at || new Date().toISOString()
    } else if (avgItemsPerHour !== null && avgItemsPerHour > 0) {
      const etaMs = Date.now() + (remainingItems / avgItemsPerHour) * 60 * 60 * 1000
      etaAt = new Date(etaMs).toISOString()
    }
  }

  const statsUpdatedAt = hourlyStats.length > 0
    ? (hourlyStats[hourlyStats.length - 1].updatedAt || null)
    : (latestRun.last_heartbeat_at || latestRun.updated_at || null)

  return {
    runId,
    runStatus: latestRun.status || null,
    targetItems,
    fetchedItems,
    remainingItems,
    avgItemsPerHour,
    etaAt,
    windowCloseAt: null,
    canFinishInWindow: null,
    statsUpdatedAt,
    hourlyStats,
  }
}

export type AffiliateProductSyncCheckpoint = {
  cursorPage: number
  cursorScope?: string | null
  processedBatches: number
  totalFetched: number
  createdCount: number
  updatedCount: number
  failedCount: number
}

export type AffiliateProductSyncHourlyStat = {
  hourBucket: string
  fetchedCount: number
  cumulativeFetched: number
  sampleCount: number
  updatedAt: string | null
}

export type YeahPromosSyncMonitor = {
  runId: number | null
  runStatus: string | null
  targetItems: number | null
  fetchedItems: number
  remainingItems: number | null
  avgItemsPerHour: number | null
  etaAt: string | null
  windowCloseAt: string | null
  canFinishInWindow: boolean | null
  statsUpdatedAt: string | null
  hourlyStats: AffiliateProductSyncHourlyStat[]
}

async function syncPartnerboostPlatformByWindow(params: {
  userId: number
  startPage?: number
  startScope?: string
  pageWindowSize?: number
  progressEvery?: number
  onProgress?: (progress: AffiliateProductSyncProgress) => Promise<void> | void
  onCheckpoint?: (checkpoint: AffiliateProductSyncCheckpoint) => Promise<void> | void
}): Promise<{
  totalFetched: number
  createdCount: number
  updatedCount: number
  hasMore: boolean
  nextCursorPage: number
  nextCursorScope: string | null
}> {
  const pageWindowSize = parseIntegerInRange(
    params.pageWindowSize ?? DEFAULT_PB_STREAM_WINDOW_PAGES,
    DEFAULT_PB_STREAM_WINDOW_PAGES,
    1,
    MAX_PB_STREAM_WINDOW_PAGES
  )

  const countrySequence = resolvePartnerboostFullSyncCountrySequence()
  const normalizedStartScope = normalizeCountryCode(String(params.startScope || ''))
  let scopeIndex = normalizedStartScope
    ? countrySequence.indexOf(normalizedStartScope)
    : 0
  if (scopeIndex < 0) {
    scopeIndex = 0
  }

  let cursorPage = Math.max(1, parseInteger(params.startPage, 1))
  let cursorScope: string | null = countrySequence[scopeIndex] || null
  let totalFetched = 0
  let createdCount = 0
  let updatedCount = 0
  const failedCount = 0
  let processedBatches = 0
  const seenMidAllowedCountries = new Map<string, Set<string>>()

  const emitProgress = async (nextFetched: number): Promise<void> => {
    if (!params.onProgress) return
    try {
      await params.onProgress({
        totalFetched: Math.max(0, nextFetched),
        processedCount: createdCount + updatedCount + failedCount,
        createdCount,
        updatedCount,
        failedCount,
      })
    } catch (error: any) {
      console.warn('[affiliate-products] PB stream onProgress callback failed:', error?.message || error)
    }
  }

  const emitCheckpoint = async (): Promise<void> => {
    if (!params.onCheckpoint) return
    try {
      await params.onCheckpoint({
        cursorPage,
        cursorScope,
        processedBatches,
        totalFetched,
        createdCount,
        updatedCount,
        failedCount,
      })
    } catch (error: any) {
      console.warn('[affiliate-products] PB stream onCheckpoint callback failed:', error?.message || error)
    }
  }

  await emitProgress(0)
  await emitCheckpoint()

  if (scopeIndex >= countrySequence.length) {
    cursorPage = 0
    cursorScope = null
    await emitProgress(totalFetched)
    await emitCheckpoint()
    return {
      totalFetched,
      createdCount,
      updatedCount,
      hasMore: false,
      nextCursorPage: 0,
      nextCursorScope: null,
    }
  }

  const currentCountry = countrySequence[scopeIndex]
  cursorScope = currentCountry
  const windowStartPage = cursorPage
  const fetchResult = await fetchPartnerboostPromotableProductsWithMeta({
    userId: params.userId,
    startPage: windowStartPage,
    countryCodeOverride: currentCountry,
    linkCountryCodeOverride: currentCountry,
    maxPages: pageWindowSize,
    suppressMaxPagesWarning: true,
    onFetchProgress: async (fetchedCount) => {
      await emitProgress(totalFetched + Math.max(0, fetchedCount))
      await emitCheckpoint()
    },
  })

  const scopedWindowItems: NormalizedAffiliateProduct[] = []
  for (const item of fetchResult.items) {
    const mid = String(item.mid || '').trim()
    if (!mid) continue

    const allowedCountries = normalizeCountries(item.allowedCountries)
    const existingCountries = seenMidAllowedCountries.get(mid) || new Set<string>()
    for (const country of allowedCountries) {
      existingCountries.add(country)
    }
    seenMidAllowedCountries.set(mid, existingCountries)

    scopedWindowItems.push({
      ...item,
      allowedCountries: Array.from(existingCountries),
    })
  }

  const upserted = await upsertAffiliateProducts(
    params.userId,
    'partnerboost',
    scopedWindowItems,
    {
      progressEvery: params.progressEvery,
    }
  )
  totalFetched += upserted.totalFetched
  createdCount += upserted.createdCount
  updatedCount += upserted.updatedCount
  if (fetchResult.fetchedPages > 0) {
    processedBatches += 1
  }

  const nextPage = fetchResult.nextPage > windowStartPage
    ? fetchResult.nextPage
    : windowStartPage + Math.max(1, fetchResult.fetchedPages)
  const scopeHasMore = fetchResult.hasMore && fetchResult.fetchedPages > 0

  let hasMore = false
  if (scopeHasMore) {
    cursorPage = nextPage
    cursorScope = currentCountry
    hasMore = true
  } else {
    scopeIndex += 1
    if (scopeIndex < countrySequence.length) {
      cursorPage = 1
      cursorScope = countrySequence[scopeIndex]
      hasMore = true
    } else {
      cursorPage = 0
      cursorScope = null
      hasMore = false
    }
  }

  await emitProgress(totalFetched)
  await emitCheckpoint()

  return {
    totalFetched,
    createdCount,
    updatedCount,
    hasMore,
    nextCursorPage: cursorPage,
    nextCursorScope: cursorScope,
  }
}

async function syncYeahPromosPlatformByWindow(params: {
  userId: number
  startPage?: number
  startScope?: string
  pageWindowSize?: number
  progressEvery?: number
  onProgress?: (progress: AffiliateProductSyncProgress) => Promise<void> | void
  onCheckpoint?: (checkpoint: AffiliateProductSyncCheckpoint) => Promise<void> | void
}): Promise<{
  totalFetched: number
  createdCount: number
  updatedCount: number
  hasMore: boolean
  nextCursorPage: number
  nextCursorScope: string | null
}> {
  const pageWindowSize = parseIntegerInRange(
    params.pageWindowSize ?? DEFAULT_YP_STREAM_WINDOW_PAGES,
    DEFAULT_YP_STREAM_WINDOW_PAGES,
    1,
    MAX_YP_STREAM_WINDOW_PAGES
  )

  let cursorPage = Math.max(1, parseInteger(params.startPage, 1))
  let cursorScope = normalizeYeahPromosMarketplace(params.startScope || '')
  let totalFetched = 0
  let createdCount = 0
  let updatedCount = 0
  const failedCount = 0
  let processedBatches = 0

  const emitProgress = async (nextFetched: number): Promise<void> => {
    if (!params.onProgress) return
    try {
      await params.onProgress({
        totalFetched: Math.max(0, nextFetched),
        processedCount: createdCount + updatedCount + failedCount,
        createdCount,
        updatedCount,
        failedCount,
      })
    } catch (error: any) {
      console.warn('[affiliate-products] YP stream onProgress callback failed:', error?.message || error)
    }
  }

  const emitCheckpoint = async (): Promise<void> => {
    if (!params.onCheckpoint) return
    try {
      await params.onCheckpoint({
        cursorPage,
        cursorScope,
        processedBatches,
        totalFetched,
        createdCount,
        updatedCount,
        failedCount,
      })
    } catch (error: any) {
      console.warn('[affiliate-products] YP stream onCheckpoint callback failed:', error?.message || error)
    }
  }

  await emitProgress(0)
  await emitCheckpoint()

  const fetchResult = await fetchYeahPromosPromotableProductsWithMeta({
    userId: params.userId,
    startPage: cursorPage,
    startScope: cursorScope || undefined,
    maxPages: pageWindowSize,
    suppressMaxPagesWarning: true,
    onFetchProgress: async (fetchedCount) => {
      await emitProgress(totalFetched + Math.max(0, fetchedCount))
      await emitCheckpoint()
    },
  })

  const dedupedWindowItems = dedupeNormalizedProducts(fetchResult.items)

  const upserted = await upsertAffiliateProducts(
    params.userId,
    'yeahpromos',
    dedupedWindowItems,
    {
      progressEvery: params.progressEvery,
    }
  )
  totalFetched += upserted.totalFetched
  createdCount += upserted.createdCount
  updatedCount += upserted.updatedCount
  if (fetchResult.fetchedPages > 0) {
    processedBatches += 1
  }

  const hasMore = fetchResult.hasMore
  cursorPage = hasMore ? Math.max(1, fetchResult.nextPage) : 0
  cursorScope = hasMore ? (fetchResult.nextScope || null) : null

  await emitProgress(totalFetched)
  await emitCheckpoint()

  return {
    totalFetched,
    createdCount,
    updatedCount,
    hasMore,
    nextCursorPage: cursorPage,
    nextCursorScope: cursorScope,
  }
}

export async function syncAffiliateProducts(params: {
  userId: number
  platform: AffiliatePlatform
  mode: SyncMode
  productId?: number
  resumeFromPage?: number
  resumeFromScope?: string
  pageWindowSize?: number
  progressEvery?: number
  onProgress?: (progress: AffiliateProductSyncProgress) => Promise<void> | void
  onCheckpoint?: (checkpoint: AffiliateProductSyncCheckpoint) => Promise<void> | void
}): Promise<{
  totalFetched: number
  createdCount: number
  updatedCount: number
  hasMore?: boolean
  nextCursorPage?: number
  nextCursorScope?: string | null
}> {
  let normalizedItems: NormalizedAffiliateProduct[] = []
  const emitFetchProgress = async (fetchedCount: number): Promise<void> => {
    if (!params.onProgress) return
    try {
      await params.onProgress({
        totalFetched: Math.max(0, fetchedCount),
        processedCount: 0,
        createdCount: 0,
        updatedCount: 0,
        failedCount: 0,
      })
    } catch (error: any) {
      console.warn('[affiliate-products] fetch stage progress callback failed:', error?.message || error)
    }
  }

  if (params.mode === 'delta') {
    normalizedItems = params.platform === 'partnerboost'
      ? await fetchPartnerboostDeltaProducts({
          userId: params.userId,
          onFetchProgress: emitFetchProgress,
        })
      : await fetchYeahPromosDeltaProducts({
          userId: params.userId,
          onFetchProgress: emitFetchProgress,
        })
  } else if (params.mode === 'single') {
    if (!params.productId) {
      throw new Error('缺少商品ID')
    }

    const existing = await getAffiliateProductById(params.userId, params.productId)
    if (!existing) {
      throw new Error('商品不存在')
    }
    if (existing.platform !== params.platform) {
      throw new Error('商品平台与同步请求不匹配')
    }

    if (params.platform === 'partnerboost') {
      if (!existing.asin) {
        throw new Error('该PB商品缺少ASIN，无法执行单商品同步')
      }
      const fetched = await fetchPartnerboostPromotableProducts({
        userId: params.userId,
        asins: [existing.asin],
        maxPages: 1,
        onFetchProgress: emitFetchProgress,
      })
      normalizedItems = fetched.filter((item) => item.mid === existing.mid)
    } else {
      const fetched = await fetchYeahPromosPromotableProducts({
        userId: params.userId,
        onFetchProgress: emitFetchProgress,
      })
      normalizedItems = fetched.filter((item) => item.mid === existing.mid)
    }

    if (normalizedItems.length === 0) {
      throw new Error('联盟平台未返回该商品，可能已失去推广资格')
    }
  } else {
    if (params.platform === 'partnerboost') {
      const result = await syncPartnerboostPlatformByWindow({
        userId: params.userId,
        startPage: params.resumeFromPage,
        startScope: params.resumeFromScope,
        pageWindowSize: params.pageWindowSize,
        progressEvery: params.progressEvery,
        onProgress: params.onProgress,
        onCheckpoint: params.onCheckpoint,
      })
      return result
    }

    return await syncYeahPromosPlatformByWindow({
      userId: params.userId,
      startPage: params.resumeFromPage,
      startScope: params.resumeFromScope,
      pageWindowSize: params.pageWindowSize,
      progressEvery: params.progressEvery,
      onProgress: params.onProgress,
      onCheckpoint: params.onCheckpoint,
    })
  }

  const upserted = await upsertAffiliateProducts(params.userId, params.platform, normalizedItems, {
    progressEvery: params.progressEvery,
    onProgress: params.onProgress,
  })
  return {
    ...upserted,
    hasMore: false,
    nextCursorPage: 0,
    nextCursorScope: null,
  }
}
