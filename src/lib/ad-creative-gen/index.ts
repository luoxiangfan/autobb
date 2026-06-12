/**
 * Ad Creative Generator - Unified Exports
 *
 * Re-exports used by creative generation pipeline modules.
 */

export type { KeywordWithVolume, AIConfig } from './types'

export { generateAdCreative, applyKeywordSupplementationOnce } from '../ad-creative-generator/index'

export type { KeywordSupplementationReport } from '../ad-creative-generator/index'
