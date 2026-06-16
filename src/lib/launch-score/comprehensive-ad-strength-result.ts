import type { AdStrengthEvaluation, AdStrengthRating } from '../creatives/strength/types'

/** Local + optional Google API ad strength result (shared type-only module). */
export interface ComprehensiveAdStrengthResult {
  localEvaluation: AdStrengthEvaluation
  rsaQualityGate: {
    intentAlignmentScore: number
    evidenceAlignmentScore: number
    queryLandingAlignmentScore: number
    passed: boolean
    reasons: string[]
  }
  googleValidation?: {
    adStrength: AdStrengthRating
    isExcellent: boolean
    recommendations: string[]
    assetPerformance?: {
      bestHeadlines: string[]
      bestDescriptions: string[]
      lowPerformingAssets: string[]
    }
  }
  finalRating: AdStrengthRating
  finalScore: number
  combinedSuggestions: string[]
}
