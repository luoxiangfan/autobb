import type { AffiliatePlatform, NormalizedAffiliateProduct } from './types'

export type PlatformConfigCheck = {
  configured: boolean
  missingKeys: string[]
  values: Record<string, string>
}

export const PLATFORM_KEY_REQUIREMENTS: Record<AffiliatePlatform, string[]> = {
  yeahpromos: ['yeahpromos_token', 'yeahpromos_site_id'],
  partnerboost: ['partnerboost_token'],
}

export const DEFAULT_PB_BASE_URL = 'https://app.partnerboost.com'
export const DEFAULT_PB_COUNTRY_CODE = 'US'
export const DEFAULT_PB_PRODUCTS_PAGE_SIZE = 100
export const MAX_PB_SYNC_MAX_PAGES = 20000
export const MAX_PB_EMPTY_PAGE_STREAK = 3
export const DEFAULT_PB_PRODUCTS_LINK_BATCH_SIZE = 20
export const MAX_PB_PRODUCTS_LINK_BATCH_SIZE = 50
export const DEFAULT_PB_ASIN_LINK_BATCH_SIZE = 20
export const MAX_PB_ASIN_LINK_BATCH_SIZE = 50
export const MAX_PB_ASINS_PER_REQUEST = 50
export const PB_LINK_HEARTBEAT_EVERY_BATCHES = 20
export const DEFAULT_PB_DELTA_ASIN_BATCH_SIZE = MAX_PB_ASINS_PER_REQUEST
export const MAX_PB_DELTA_ASIN_BATCH_SIZE = MAX_PB_ASINS_PER_REQUEST
export const DEFAULT_PB_ACTIVE_DAYS = 14
export const MAX_PB_ACTIVE_DAYS = 60
export const DEFAULT_PB_REQUEST_DELAY_MS = 150
export const MAX_PB_REQUEST_DELAY_MS = 5000
export const DEFAULT_PB_RATE_LIMIT_MAX_RETRIES = 4
export const DEFAULT_PB_RATE_LIMIT_BASE_DELAY_MS = 800
export const DEFAULT_PB_RATE_LIMIT_MAX_DELAY_MS = 12000
export const DEFAULT_PB_FULL_SYNC_COUNTRY_SEQUENCE = [
  'US',
  'MX',
  'CA',
  'DE',
  'UK',
  'ES',
  'FR',
  'IT',
] as const
export const DEFAULT_PB_STREAM_WINDOW_PAGES = 10
export const MAX_PB_STREAM_WINDOW_PAGES = 200
export const DEFAULT_YP_STREAM_WINDOW_PAGES = 3
export const MAX_YP_STREAM_WINDOW_PAGES = 20
export const DEFAULT_UPSERT_BATCH_SIZE_POSTGRES = 800
export const DEFAULT_AFFILIATE_PRODUCTS_UPSERT_STATEMENT_TIMEOUT_MS = 5 * 60 * 1000
export const MIN_AFFILIATE_PRODUCTS_UPSERT_STATEMENT_TIMEOUT_MS = 60 * 1000
export const MAX_AFFILIATE_PRODUCTS_UPSERT_STATEMENT_TIMEOUT_MS = 30 * 60 * 1000
export const DEFAULT_YP_RATE_LIMIT_MAX_RETRIES = 5
export const DEFAULT_YP_RATE_LIMIT_BASE_DELAY_MS = 1200
export const DEFAULT_YP_RATE_LIMIT_MAX_DELAY_MS = 30000
export const DEFAULT_YP_ACTIVE_DAYS = 30
export const MAX_YP_ACTIVE_DAYS = 90
export const DEFAULT_YP_DELTA_MAX_PAGES = 20
export const DEFAULT_YP_DELTA_PRIORITY_PAGE_CAP = 2
export const MAX_YP_SYNC_MAX_PAGES = 50000
export const MAX_YP_EMPTY_PAGE_STREAK = 3
// 连续多少页返回空列表时切换市场（避免在已抓完的市场无限翻页）
export const MAX_YP_CONSECUTIVE_EMPTY_PAGES_PER_SCOPE = 10
export const DEFAULT_YP_SKIP_FAILED_PAGES = true // 默认跳过连续失败的页面，避免因服务器端问题导致整个同步中止
export const DEFAULT_YP_PRODUCTS_REQUEST_DELAY_MS = 4500
export const MIN_YP_PRODUCTS_REQUEST_DELAY_MS = 1500
export const MAX_YP_PRODUCTS_REQUEST_DELAY_MS = 15000
export const DEFAULT_YP_PRODUCTS_DELAY_JITTER_MS = 1200
export const MAX_YP_PRODUCTS_DELAY_JITTER_MS = 4000
export const YP_SESSION_MIN_REMAINING_MS_INITIAL = 30 * 60 * 1000
export const YP_SESSION_MIN_REMAINING_MS_RESUME = 5 * 60 * 1000
export const AFFILIATE_RAW_JSON_RETIREMENT_TABLE = 'affiliate_product_raw_json_retirement'
export const AFFILIATE_RAW_JSON_RETIREMENT_SINGLETON_ID = 1
export const AFFILIATE_RAW_JSON_RETIREMENT_BATCH_SIZE_MIN = 500
export const AFFILIATE_RAW_JSON_RETIREMENT_BATCH_SIZE_BUSY = 1000
export const AFFILIATE_RAW_JSON_RETIREMENT_BATCH_SIZE_MAX = 2000
export const AFFILIATE_RAW_JSON_RETIREMENT_BUSY_SYNC_RUNS_THRESHOLD = 1
export const AFFILIATE_RAW_JSON_RETIREMENT_PEAK_SYNC_RUNS_THRESHOLD = 3
export const AFFILIATE_RAW_JSON_RETIREMENT_DROP_LOCK_KEY = 93620411
export const AFFILIATE_RAW_JSON_RETIREMENT_DROP_LOCK_TIMEOUT_MS = 1500
export const AFFILIATE_RAW_JSON_RETIREMENT_DROP_STATEMENT_TIMEOUT_MS = 5000
export const AFFILIATE_RAW_JSON_RETIREMENT_DROP_MAX_ATTEMPTS = 3
export const AFFILIATE_RAW_JSON_RETIREMENT_DROP_RETRY_BASE_DELAY_MS = 500
export const AFFILIATE_RAW_JSON_RETIREMENT_DROP_RETRY_MAX_DELAY_MS = 3000
export const AFFILIATE_RAW_JSON_RETIREMENT_DROP_WINDOW_START_HOUR = 1
export const AFFILIATE_RAW_JSON_RETIREMENT_DROP_WINDOW_END_HOUR = 6
export const AFFILIATE_RAW_JSON_RETIREMENT_DROP_WINDOW_TZ_OFFSET_HOURS = 8
export const YP_MARKETPLACE_TEMPLATES_SETTING_KEY = 'yeahpromos_marketplace_templates_json'
export const YP_PROXY_COUNTRY_ALIAS: Record<string, string> = {
  UK: 'GB',
}
export const PRODUCT_COUNTRY_FILTER_ALIAS_MAP: Record<string, string[]> = {
  UK: ['GB'],
  GB: ['UK'],
}
export const YP_DOM_INTERCEPT_KEYWORDS = [
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
export const AFFILIATE_YP_ACCESS_PRODUCTS_TARGET_KEY = 'affiliate_yp_access_products_target'
export const AFFILIATE_YP_ACCESS_PRODUCTS_UPDATED_AT_KEY = 'affiliate_yp_access_products_updated_at'

export type PartnerboostProduct = {
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

export type PartnerboostProductsResponse = {
  status?: { code?: number | string; msg?: string }
  data?: {
    list?: PartnerboostProduct[] | Record<string, PartnerboostProduct>
    has_more?: boolean | number | string
    hasMore?: boolean | number | string
  }
}

export type PartnerboostDtcProduct = {
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

export type PartnerboostDtcProductsResponse = {
  status?: { code?: number | string; msg?: string }
  data?: {
    total?: number | string
    list?: PartnerboostDtcProduct[] | Record<string, PartnerboostDtcProduct>
  }
}

export type PartnerboostLinkItem = {
  product_id?: string
  asin?: string
  link?: string
  partnerboost_link?: string
  link_id?: string
}

export type PartnerboostLinkResponse = {
  status?: { code?: number | string; msg?: string }
  data?: PartnerboostLinkItem[]
  error_list?: Array<{ product_id?: string; message?: string }>
}

export type PartnerboostAsinLinkResponse = {
  status?: { code?: number | string; msg?: string }
  data?: PartnerboostLinkItem[]
  error_list?: Array<{ asin?: string; country_code?: string; message?: string }>
}

export type PartnerboostPromotableFetchParams = {
  userId: number
  asins?: string[]
  maxPages?: number
  startPage?: number
  countryCodeOverride?: string
  linkCountryCodeOverride?: string
  suppressMaxPagesWarning?: boolean
  onFetchProgress?: (fetchedCount: number) => Promise<void> | void
}

export type PartnerboostPromotableFetchResult = {
  items: NormalizedAffiliateProduct[]
  hasMore: boolean
  nextPage: number
  fetchedPages: number
}

export type YeahPromosMerchant = {
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

export type YeahPromosResponseData = {
  PageTotal?: number | string
  pageTotal?: number | string
  PageNow?: number | string
  pageNow?: number | string
  Data?: YeahPromosMerchant[] | Record<string, YeahPromosMerchant>
  data?: YeahPromosMerchant[] | Record<string, YeahPromosMerchant>
}

export type YeahPromosResponse = {
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

export type YeahPromosTransaction = {
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

export type YeahPromosTransactionsResponseData = {
  PageTotal?: number | string
  pageTotal?: number | string
  PageNow?: number | string
  pageNow?: number | string
  Data?: YeahPromosTransaction[] | Record<string, YeahPromosTransaction>
  data?: YeahPromosTransaction[] | Record<string, YeahPromosTransaction>
}

export type YeahPromosTransactionsResponse = {
  Code?: number | string
  code?: number | string
  PageTotal?: number | string
  pageTotal?: number | string
  PageNow?: number | string
  pageNow?: number | string
  Data?: YeahPromosTransaction[] | Record<string, YeahPromosTransaction>
  data?: YeahPromosTransaction[] | YeahPromosTransactionsResponseData
}

export type YeahPromosProductPageParseResult = {
  items: NormalizedAffiliateProduct[]
  pageNow: number | null
  nextPage: number | null
  noProductsFound: boolean
}

export type YeahPromosMarketplaceTemplate = {
  scope: string
  marketplace: string
  country: string
  url: string
}

export type YeahPromosProxyConfigEntry = {
  country?: string
  url?: string
}

export type YeahPromosProductsFetchResult = {
  items: NormalizedAffiliateProduct[]
  hasMore: boolean
  nextPage: number
  nextScope: string | null
  fetchedPages: number
}

export type YeahPromosDeltaScopePlan = {
  templates: YeahPromosMarketplaceTemplate[]
  scopePageBudgets: Record<string, number>
}

export type ParsedYeahPromosCommission = {
  mode: 'rate' | 'amount'
  rate: number | null
  amount: number | null
}

export const YP_MARKETPLACE_COUNTRY_MAP: Record<string, string> = {
  'amazon.com': 'US',
  'amazon.co.uk': 'GB',
  'amazon.ca': 'CA',
  'amazon.de': 'DE',
  'amazon.fr': 'FR',
}

export const DEFAULT_YP_MARKETPLACE_TEMPLATES: YeahPromosMarketplaceTemplate[] = [
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
