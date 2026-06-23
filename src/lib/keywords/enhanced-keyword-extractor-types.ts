/**
 * 增强关键词提取：类型定义
 */

export interface EnhancedKeyword {
  keyword: string
  searchVolume: number
  cpc: number
  competition: 'low' | 'medium' | 'high'
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
  category: 'brand' | 'core' | 'intent' | 'longtail' | 'competitor'
  source: string
  variants: string[]
  trend: 'rising' | 'stable' | 'declining'
  seasonality: number
  confidence: number
  estimatedCTR?: number
  estimatedConversionRate?: number
}

export interface KeywordExtractionInput {
  productName: string
  brandName: string
  category: string
  description: string
  features: string[]
  useCases: string[]
  targetAudience: string
  competitors: string[]
  targetCountry: string
  targetLanguage: string
  /** 提供时按 Offer linked SA prepare，供搜索量查询复用 session */
  offerId?: number
}
