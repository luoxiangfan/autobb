/**
 * Stealth Scraper Module - Unified Exports
 *
 * This module provides stealth browser-based scraping capabilities for:
 * - Amazon product pages
 * - Amazon store pages
 * - Independent e-commerce stores (Shopify, WooCommerce, etc.)
 *
 * All scrapers use:
 * - Playwright connection pooling for performance
 * - Browser fingerprint spoofing for anti-bot bypass
 * - Proxy rotation with automatic retry on failure
 * - Smart wait strategies for optimal page loading
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
  IndependentProductData,  // 🔥 新增：独立站产品数据类型
} from './types'

// Proxy utilities
export {
  isProxyConnectionError,
  withProxyRetry,
  retryWithBackoff,
} from './proxy-utils'

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
export {
  scrapeUrlWithBrowser,
  resolveAffiliateLink,
} from './core'

// Amazon product scraping
export {
  scrapeAmazonProduct,
} from './amazon-product'

// Amazon store scraping
export {
  scrapeAmazonStore,
  scrapeAmazonStoreDeep,
} from './amazon-store'

// Independent store scraping
export {
  scrapeIndependentStore,
  scrapeIndependentStoreDeep,  // 🔥 新增：独立站深度抓取
  scrapeIndependentProduct,    // 🔥 新增：独立站单品抓取
} from './independent-store'

// Product detail cache (统一缓存模块)
export {
  getCachedProductDetail,
  setCachedProductDetail,
  getProductCacheStats,
  checkCacheBatch,
  cleanupExpiredCache,
} from './product-detail-cache'
