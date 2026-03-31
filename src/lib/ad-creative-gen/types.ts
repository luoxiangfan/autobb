/**
 * Ad Creative Generator - Type Definitions
 *
 * Shared TypeScript interfaces for ad creative generation modules
 */

// Re-export types from ad-creative module
export type {
  GeneratedAdCreativeData,
  HeadlineAsset,
  DescriptionAsset,
  QualityMetrics
} from '../ad-creative'

export type { Offer } from '../offers'

/**
 * Keyword with search volume data
 * 🎯 数据来源说明：统一使用Historical Metrics API的精确搜索量
 */
export interface KeywordWithVolume {
  keyword: string
  searchVolume: number // 精确搜索量（来自Historical Metrics API）
  competition?: string
  competitionIndex?: number
  source?: 'AI_GENERATED' | 'KEYWORD_EXPANSION' | 'MERGED' // 数据来源标记
  matchType?: 'EXACT' | 'PHRASE' | 'BROAD' // 匹配类型（可选）
  volumeUnavailableReason?: 'DEV_TOKEN_INSUFFICIENT_ACCESS'
}

/**
 * AI Configuration
 * 统一使用 Gemini API
 */
export interface AIConfig {
  type: 'gemini-api' | null
  geminiAPI?: {
    apiKey: string
    model: string
  }
}
