/**
 * Stealth browser scraping — Amazon / independent store pages.
 */

// Types
export type {
  ProxyCredentials,
  StealthBrowserResult,
  ScrapeUrlResult,
  AffiliateLinkResult,
  AmazonProductData,
  AmazonStoreData,
  IndependentStoreData,
  IndependentProductData,
} from './types'

// Proxy utilities
export { isProxyConnectionError, withProxyRetry, retryWithBackoff } from './proxy-utils'

// Browser stealth utilities
export {
  createStealthBrowser,
  releaseBrowser,
  configureStealthPage,
  getRandomUserAgent,
  randomDelay,
  getDynamicTimeout,
} from './browser-stealth'

// Core scraping functions
export { scrapeUrlWithBrowser, resolveAffiliateLink } from './core'

// Amazon product scraping
export { scrapeAmazonProduct } from './amazon-product'

// Amazon store scraping
export { scrapeAmazonStore, scrapeAmazonStoreDeep } from './amazon-store'

// Independent store scraping
export {
  scrapeIndependentStore,
  scrapeIndependentStoreDeep,
  scrapeIndependentProduct,
} from './independent-store'

// Product detail cache (商品详情缓存)
export {
  getCachedProductDetail,
  setCachedProductDetail,
  getProductCacheStats,
  checkCacheBatch,
  cleanupExpiredCache,
} from './product-detail-cache'
