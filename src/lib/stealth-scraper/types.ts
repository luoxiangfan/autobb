/**
 * Scraper Types and Interfaces
 *
 * Shared type definitions for all scraper modules
 */

import type { Browser, BrowserContext } from 'playwright'
import type { ProxyCredentials } from '../proxy/types'
import type { SupplementalProductResult } from '../offer-supplemental-products'

// Re-export ProxyCredentials for external use
export type { ProxyCredentials } from '../proxy/types'

/**
 * 浏览器实例结果（支持连接池和独立创建两种模式）
 */
export interface StealthBrowserResult {
  browser: Browser
  context: BrowserContext
  proxy?: ProxyCredentials
  instanceId?: string  // 连接池模式时有值
  fromPool: boolean    // 标记是否来自连接池
}

/**
 * Enhanced Amazon product data structure
 */
export interface AmazonProductData {
  productName: string | null
  // Raw capture fields for supplementation and audit
  rawProductTitle?: string | null
  rawAboutThisItem?: string[]
  productDescription: string | null
  productPrice: string | null
  originalPrice: string | null
  discount: string | null
  brandName: string | null
  features: string[]
  aboutThisItem: string[]  // Amazon "About this item" 产品详细描述
  imageUrls: string[]
  // New fields for AI creative generation
  rating: string | null
  reviewCount: string | null
  salesRank: string | null
  badge: string | null  // 🎯 P3优化: Amazon trust badges (Amazon's Choice, Best Seller等)
  availability: string | null
  primeEligible: boolean
  reviewHighlights: string[]
  topReviews: string[]
  technicalDetails: Record<string, string>
  asin: string | null
  category: string | null
  // 🔥 竞品候选ASIN列表（从"Frequently bought together"、"Customers also viewed"等提取）
  // 🔥 KISS优化（2025-12-09）：只存储ASIN，品牌/价格通过详情页抓取获取（更准确）
  relatedAsins: string[]
  // 🔥 P2优化: 评论主题/关键词（Amazon的Review Topics，用于广告创意）
  reviewKeywords?: string[]
}

/**
 * Amazon Store data structure
 */
export interface AmazonStoreData {
  storeName: string | null
  storeDescription: string | null
  brandName: string | null
  products: Array<{
    name: string
    price: string | null
    rating: string | null
    reviewCount: string | null
    asin: string | null
    hotScore?: number      // 🔥 新增：热销分数
    rank?: number          // 🔥 新增：热销排名
    isHot?: boolean        // 🔥 新增：是否为热销商品（Top 5）
    hotLabel?: string      // 🔥 新增：热销标签
    // 🎯 Phase 3: 数据维度增强
    promotion?: string | null       // 促销信息：折扣、优惠券、限时优惠
    badge?: string | null           // 徽章：Amazon's Choice、Best Seller、#1 in Category
    isPrime?: boolean               // Prime标识
    // 🔥 新增：完整详情页数据（用于hotScore优化）
    salesRank?: string | null       // 销量排名
    features?: string[]             // 产品特性
    // 🔥 2025-12-10优化：从店铺页直接提取的销售热度
    salesVolume?: string | null     // 销售热度："1K+ bought in past month"
    discount?: string | null        // 折扣百分比："-20%"
    deliveryInfo?: string | null    // 配送信息："Get it by Tuesday, December 16"
    imageUrl?: string | null        // 产品图片URL
  }>
  totalProducts: number
  storeUrl: string
  // 🔥 新增：热销洞察
  hotInsights?: {
    avgRating: number
    avgReviews: number
    topProductsCount: number
  }
  // 🆕 Phase 2: 产品分类（全局店铺理解）
  productCategories?: {
    primaryCategories: Array<{
      name: string
      count: number
      url?: string
    }>
    categoryTree?: {
      [parentCategory: string]: string[]
    }
    totalCategories: number
  }
  // 🔥 增强版：深度抓取结果（热销商品详情页数据）
  deepScrapeResults?: {
    topProducts: Array<{
      asin: string
      productData: AmazonProductData | null
      reviews: string[]           // 评价摘要
      reviewHighlights?: string[] // 🔥 新增：评价亮点
      competitorAsins: string[]   // 竞品ASIN列表
      features?: string[]         // 🔥 新增：产品特性
      scrapeStatus: 'success' | 'failed' | 'skipped'
      error?: string
    }>
    totalScraped: number
    successCount: number
    failedCount: number
    // 🔥 新增：聚合数据用于AI分析
    aggregatedReviews?: string[]           // 聚合所有热销商品的评论
    aggregatedCompetitorAsins?: string[]   // 聚合所有竞品ASIN（去重）
    aggregatedFeatures?: string[]          // 聚合所有产品特性（去重）
  }
  supplementalProducts?: SupplementalProductResult[]
}

/**
 * Independent site store data structure
 * 🔥 增强版：与AmazonStoreData保持一致的数据结构
 */
export interface IndependentStoreData {
  storeName: string | null
  storeDescription: string | null
  logoUrl: string | null
  products: Array<{
    name: string
    price: string | null
    productUrl: string | null
    // 🔥 新增：与Amazon产品一致的字段
    rating?: string | null
    reviewCount?: string | null
    hotScore?: number      // 热销分数
    rank?: number          // 热销排名
    isHot?: boolean        // 是否为热销商品（Top 5）
    hotLabel?: string      // 热销标签
    imageUrl?: string | null // 产品图片
  }>
  totalProducts: number
  storeUrl: string
  platform: string | null // shopify, woocommerce, generic
  // 🔥 新增：热销洞察（与Amazon Store一致）
  hotInsights?: {
    avgRating: number
    avgReviews: number
    topProductsCount: number
  }
  // 🆕 产品分类（独立站店铺理解，与Amazon Store对齐）
  productCategories?: {
    primaryCategories: Array<{
      name: string
      count: number
      url?: string
    }>
    totalCategories: number
  }
  // 🔥 新增：深度抓取结果（热销商品详情页数据）
  deepScrapeResults?: {
    topProducts: Array<{
      productUrl: string
      productData: IndependentProductData | null
      reviews: string[]           // 评价摘要
      competitorUrls: string[]    // 竞品URL列表
      scrapeStatus: 'success' | 'failed' | 'skipped'
      error?: string
    }>
    totalScraped: number
    successCount: number
    failedCount: number
  }
  supplementalProducts?: SupplementalProductResult[]
}

/**
 * Independent site product data structure (for deep scraping)
 * 🔥 2025-12-24增强：与AmazonProductData保持一致的数据结构
 * 包含详细的产品、评价、技术信息和竞品数据
 */
export interface IndependentProductData {
  // 基础产品信息
  productName: string | null
  rawProductTitle?: string | null
  rawAboutThisItem?: string[]
  productDescription: string | null
  productPrice: string | null
  originalPrice: string | null
  discount: string | null
  brandName: string | null

  // 详细特性和信息（Amazon-style）
  features: string[]
  imageUrls: string[]
  technicalDetails?: Record<string, string>  // 🔥 新增：技术规格表
  category: string | null

  // 评价和社交证明
  rating: string | null
  reviewCount: string | null
  availability: string | null
  reviews: string[]
  reviewHighlights?: string[]  // 🔥 新增：评价亮点总结
  topReviews?: string[]  // 🔥 新增：TOP评价（最有帮助的评价）
  reviewKeywords?: string[]  // 🔥 新增：评价关键词主题
  structuredReviews?: Array<{
    rating: number
    date: string
    author: string
    title: string
    body: string
    verifiedBuyer: boolean
    images?: string[]
  }>
  qaPairs?: Array<{
    question: string
    answer: string
  }>
  socialProof?: Array<{
    metric: string
    value: string
  }>
  coreFeatures?: string[]
  secondaryFeatures?: string[]

  // 信任徽章和促销
  badge?: string | null  // 🔥 新增："Best Seller", "Featured", "Limited Edition"等
  promotion?: string | null  // 🔥 新增：促销信息

  // 竞品和相关产品
  relatedProductUrls?: string[]  // 🔥 新增：相关产品URL（类似Amazon竞品）
  competitorUrls?: string[]  // 🔥 新增：竞品URL列表

  // 库存和配送信息
  stockStatus?: string | null  // 🔥 新增：库存状态
  shippingInfo?: string | null  // 🔥 新增：配送信息
}

/**
 * Scrape URL result
 */
export interface ScrapeUrlResult {
  html: string
  title: string
  finalUrl: string
  redirectChain: string[]
  screenshot?: Buffer
}

/**
 * Affiliate link resolution result
 */
export interface AffiliateLinkResult {
  finalUrl: string
  finalUrlSuffix: string
  redirectChain: string[]
  redirectCount: number
}
