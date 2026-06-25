/* * Client-safe Launch Score performance comparison types (no DB/API deps). */

export interface PredictionComparison {
  metric: string
  predicted: number | string
  actual: number | string
  accuracy: number | null
  variance: string
}

/* * GET launch-score / performance 接口共用的性能对比载荷（不含 accuracyScore） */
export type LaunchScorePerformanceApiPayload = {
  hasPerformanceData: boolean
  performanceData: import('./launch-score-performance').LaunchScoreOfferPerformanceData | null
  comparisons: PredictionComparison[]
  adjustedRecommendations: string[]
  message?: string
}
