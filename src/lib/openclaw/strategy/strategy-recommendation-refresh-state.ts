import type { StrategyRecommendation } from './strategy-recommendation-types'

export const refreshRecommendationsInflight = new Map<string, Promise<StrategyRecommendation[]>>()
