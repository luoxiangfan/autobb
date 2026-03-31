/**
 * Ad Elements Extractor - Type Definitions
 */

import type { AmazonProductData, AmazonStoreData } from '../stealth-scraper'

// Type alias for Store Product (extracted from AmazonStoreData.products)
export type StoreProduct = AmazonStoreData['products'][number]

// 扩展的Store Product类型（包含深度数据）
export type EnrichedStoreProduct = {
  name: string
  asin?: string | null
  price?: string | null
  rating?: string | null
  reviewCount?: string | null
  imageUrl?: string | null
  hotScore?: number
  hasDeepData?: boolean
  // 深度数据字段
  productData?: AmazonProductData | null
  reviewAnalysis?: any | null
  competitorAnalysis?: any | null
  productInfo?: any | null  // AI产品分析结果
}

/**
 * 提取的广告元素
 */
export interface ExtractedAdElements {
  // 关键字（已查询搜索量）
  keywords: Array<{
    keyword: string
    source: 'product_title' | 'google_suggest' | 'brand_variant'
    searchVolume: number
    priority: 'HIGH' | 'MEDIUM' | 'LOW'
  }>

  // 广告标题（15个）
  headlines: string[]

  // 广告描述（4个）
  descriptions: string[]

  // 提取来源统计
  sources: {
    productCount: number
    keywordSources: Record<string, number>
    topProducts: Array<{
      name: string
      rating: string | null
      reviewCount: string | null
    }>
  }
}

/**
 * 商品数据接口（兼容单商品和店铺商品）
 * 🎯 P1修复: 同步ai.ts中的ProductInfo字段定义
 */
export interface ProductInfo {
  name: string
  description?: string
  features?: string[]
  aboutThisItem?: string[]  // Amazon "About this item" 产品详细描述
  brand?: string
  rating?: string | null
  reviewCount?: string | null
  // Deep analysis fields from productInfo
  uniqueSellingPoints?: string
  targetAudience?: string
  productHighlights?: string
  brandDescription?: string
  category?: string

  // 🎯 P1修复: 以下字段与ai.ts ProductInfo同步
  pricing?: {
    current?: string
    original?: string
    discount?: string
    competitiveness?: 'Premium' | 'Competitive' | 'Budget'
    valueAssessment?: string
  }

  reviews?: {
    rating?: number
    count?: number
    sentiment?: 'Positive' | 'Mixed' | 'Negative'
    positives?: string[]
    concerns?: string[]
    useCases?: string[]
  }

  promotions?: {
    active?: boolean
    types?: string[]
    urgency?: string | null
    activeDeals?: string[]
    urgencyIndicators?: string[]
    freeShipping?: boolean
  }

  competitiveEdges?: {
    badges?: string[]
    primeEligible?: boolean
    stockStatus?: string
    salesRank?: string
  }

  // 🔥 v3.2新增：深度数据增强字段
  storeDeepData?: {
    aggregatedReviews?: string[]      // 热销商品评论聚合
    aggregatedFeatures?: string[]     // 热销商品特性聚合
    hotBadges?: string[]              // 热销商品徽章
    categoryKeywords?: string[]       // 店铺分类关键词
  }

  userLanguagePatterns?: string[]     // 用户语言模式（从评论提取）
  competitorFeatures?: string[]       // 竞品特性（用于差异化）
  topReviewQuotes?: string[]          // 热门评论原文（用于引用）
}

/**
 * 品类阈值配置
 */
export interface CategoryThreshold {
  highReviewBase: number  // High 流行度评论数基准
  mediumReviewBase: number  // Medium 流行度评论数基准
  multiplier: number  // 门槛倍数
  description: string
}
