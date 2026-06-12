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
  QualityMetrics,
} from '../ad-creative'

export type { Offer } from '../offers'

export type { KeywordWithVolume } from '../ad-creative-generator/types'

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
