/**
 * Ad Creative Generator - Unified Exports
 *
 * Re-exports all public APIs from ad-creative-generator
 * Provides modular access to types and configuration
 */

// Re-export types
export type { KeywordWithVolume, AIConfig } from './types'

// Re-export configuration utilities
export { getAIConfig, getLanguageInstruction } from './ai-config'

// Re-export main generation functions from original file
export {
  generateAdCreative,
  generateAdCreativesBatch,
  generateMultipleCreativesWithDiversityCheck,
  applyKeywordSupplementationOnce,
} from '../ad-creative-generator'

export type { KeywordSupplementationReport } from '../ad-creative-generator'
