/**
 * Ad Elements Extractor - Unified Exports
 */

// Re-export types
export type {
  StoreProduct,
  EnrichedStoreProduct,
  ExtractedAdElements,
  ProductInfo,
  CategoryThreshold
} from './types'

// Re-export main function from original file
export { extractAdElements } from '../ad-elements-extractor'
