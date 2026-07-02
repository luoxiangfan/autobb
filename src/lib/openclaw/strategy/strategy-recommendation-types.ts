export type StrategyRecommendationType =
  | 'adjust_cpc'
  | 'adjust_budget'
  | 'offline_campaign'
  | 'expand_keywords'
  | 'add_negative_keywords'
  | 'optimize_match_type'

export type StrategyRecommendationStatus =
  | 'pending'
  | 'executed'
  | 'failed'
  | 'dismissed'
  | 'stale'

export type StrategyKeywordSuggestion = {
  text: string
  matchType: 'BROAD' | 'PHRASE' | 'EXACT'
  whySelected?: string
  sourceLayer?: 'recent_search_terms' | 'historical_search_terms'
  selectionScore?: number
  evidenceMetrics?: {
    impressions?: number
    clicks?: number
    conversions?: number
    cost?: number
  }
  conflictCheck?: {
    negativeConflict: boolean
    duplicateConflict: boolean
  }
}

export type StrategyNegativeKeywordSuggestion = {
  text: string
  matchType: 'BROAD' | 'PHRASE' | 'EXACT'
  reason?: string
}

export type StrategyMatchTypeSuggestion = {
  text: string
  currentMatchType: 'BROAD' | 'PHRASE' | 'EXACT'
  recommendedMatchType: 'BROAD' | 'PHRASE' | 'EXACT'
  clicks?: number
  conversions?: number
  cost?: number
}

export type StrategyPostReviewStatus =
  | 'pending_window'
  | 'effective'
  | 'mixed'
  | 'ineffective'
  | 'no_data'

export type StrategyImpactConfidence = 'low' | 'medium' | 'high'
export type StrategyImpactEstimationSource =
  | 'observed_roas'
  | 'fallback_lag_protected'
  | 'fallback_default'

export type StrategyMatchTypeReplaceMode = 'none' | 'pause_existing'

export type StrategyRecommendationData = {
  campaignId: number
  campaignName: string
  offerId: number | null
  googleCampaignId: string | null
  currency?: string | null
  snapshotHash?: string
  runDays: number
  impressions: number
  clicks: number
  cost: number
  ctrPct: number
  cpc: number
  roas: number | null
  commissionAmount: number
  commissionLagProtected: boolean
  commissionPerConversion: number | null
  currentCpc: number | null
  recommendedCpc: number | null
  cpcAdjustmentDirection?: 'lower' | 'set' | 'raise'
  currentBudget: number | null
  recommendedBudget: number | null
  budgetType?: 'DAILY' | 'TOTAL'
  budgetAdjustmentDirection?: 'increase'
  breakEvenConversionRatePct: number | null
  breakEvenConversionRateByRecommendedCpcPct: number | null
  estimatedCostSaving: number
  estimatedRevenueUplift: number
  estimatedNetImpact: number
  impactWindowDays: number
  impactConfidence: StrategyImpactConfidence
  impactConfidenceReason: string
  impactEstimationSource?: StrategyImpactEstimationSource
  postReviewStatus?: StrategyPostReviewStatus
  postReviewSummary?: {
    reviewedAt: string
    reviewWindowDays: number
    baseline: {
      impressions: number
      clicks: number
      cost: number
      ctrPct: number
      cpc: number
      roas: number | null
      commission: number
    }
    after: {
      impressions: number
      clicks: number
      cost: number
      ctrPct: number
      cpc: number
      roas: number | null
      commission: number
      observedDays: number
    }
    delta: {
      impressionsPct: number | null
      clicksPct: number | null
      costPct: number | null
      ctrPctDiff: number | null
      cpcPct: number | null
      roasDiff: number | null
    }
  }
  keywordCoverageCount: number
  creativeQuality: {
    headlineCount: number
    descriptionCount: number
    keywordCount: number
    level: 'high' | 'medium' | 'low'
  }
  offlineOptions?: {
    removeGoogleAdsCampaign: boolean
    pauseClickFarmTasks: boolean
    pauseUrlSwapTasks: boolean
  }
  keywordPlan?: StrategyKeywordSuggestion[]
  keywordPlanDiagnostics?: {
    candidateCountRecent: number
    candidateCountHistorical: number
    selectedFromRecent: number
    selectedFromHistorical: number
    excludedReasonCounts?: Record<string, number>
  }
  negativeKeywordPlan?: StrategyNegativeKeywordSuggestion[]
  matchTypePlan?: StrategyMatchTypeSuggestion[]
  searchTermFeedback?: {
    hardNegativeTerms?: string[]
    softSuppressTerms?: string[]
    lookbackDays?: number
    dominantCurrency?: string
  }
  matchTypeReplaceMode?: StrategyMatchTypeReplaceMode
  ruleCode: string
  analysisNote: string
}

export type StrategyRecommendation = {
  id: string
  userId: number
  reportDate: string
  campaignId: number
  googleCampaignId: string | null
  snapshotHash: string | null
  recommendationType: StrategyRecommendationType
  title: string
  summary: string | null
  reason: string | null
  priorityScore: number
  status: StrategyRecommendationStatus
  data: StrategyRecommendationData
  executedAt: string | null
  executionResult: unknown
  createdAt: string
  updatedAt: string
}

export type CampaignRow = {
  id: number
  campaign_name: string
  campaign_id: string | null
  google_campaign_id: string | null
  max_cpc: number | null
  budget_amount: number | null
  budget_type: string | null
  created_at: string | null
  published_at: string | null
  offer_id: number | null
  ad_creative_id: number | null
  product_price: string | null
  commission_payout: string | null
  target_country: string | null
  brand: string | null
  category: string | null
  product_name: string | null
  currency?: string | null
  campaign_config?: unknown
}

export type PerfAgg = {
  impressions: number
  clicks: number
  cost: number
}

export type CreativeRow = {
  id: number
  headlines: unknown
  descriptions: unknown
  keywords: unknown
  keywords_with_volume: unknown
}

export type KeywordInventoryRow = {
  campaign_id: number
  keyword_text: string
  match_type: string | null
  is_negative: number | boolean | null
}

export type CampaignKeywordInventory = {
  text: string
  matchType: 'BROAD' | 'PHRASE' | 'EXACT'
  isNegative: boolean
}

export type SearchTermAgg = {
  searchTerm: string
  impressions: number
  clicks: number
  conversions: number
  cost: number
  recentImpressions?: number
  recentClicks?: number
  recentConversions?: number
  recentCost?: number
  lastSeenDate?: string | null
}

export type RecommendationDraft = {
  key: string
  campaignId: number
  googleCampaignId: string | null
  recommendationType: StrategyRecommendationType
  title: string
  summary: string
  reason: string
  priorityScore: number
  data: StrategyRecommendationData
}

export type StrategyRecommendationQueueTaskData = {
  userId: number
  mode?: string
  trigger?: string
  kind: 'execute_recommendation' | 'review_recommendation'
  recommendationId: string
  confirm?: boolean
  scheduledAt?: string
}

export type QueueStrategyRecommendationExecutionResult = {
  queued: boolean
  deduplicated: boolean
  taskId: string
  recommendation: StrategyRecommendation
}

export const MIN_KEYWORD_COVERAGE_TARGET = 20
export const KEYWORD_EXPANSION_TARGET_MAX = 30
export const KEYWORD_EXPANSION_TARGET_MIN = 20
export const CPC_RECOMMENDED_DIVISOR = 50
export const CPC_RAISE_NO_TRAFFIC_MIN_RUN_DAYS = 3
export const CPC_RAISE_NO_TRAFFIC_MAX_RUN_DAYS = 7
export const CPC_RAISE_STEP_RATIO = 0.2
export const CPC_RAISE_CAP_MULTIPLIER = 1.5
export const SEARCH_TERM_LOOKBACK_DAYS = 14
export const NEGATIVE_KEYWORD_PLAN_MAX = 15
export const MATCH_TYPE_OPTIMIZATION_MAX = 15
export const IMPACT_WINDOW_DAYS_COST_CONTROL = 7
export const IMPACT_WINDOW_DAYS_TRAFFIC_GROWTH = 14
export const POST_REVIEW_DEFAULT_WINDOW_DAYS = 3
export const MAX_POST_REVIEW_WINDOW_DAYS = 14
export const MS_PER_DAY = 24 * 60 * 60 * 1000
export const OFFLINE_LOW_CTR_MIN_IMPRESSIONS = 200
export const OFFLINE_LOW_CTR_MIN_CLICKS = 10
export const OFFLINE_LOW_CTR_MIN_COST = 8
export const POST_REVIEW_MIN_IMPRESSIONS = 200
export const POST_REVIEW_MIN_CLICKS = 20
export const POST_REVIEW_MIN_COST = 8
export const POST_REVIEW_MIN_OBSERVED_DAYS = 3
export const RECOMMENDATION_COOLDOWN_DAYS: Record<StrategyRecommendationType, number> = {
  adjust_cpc: 2,
  adjust_budget: 2,
  offline_campaign: 30,
  expand_keywords: 5,
  add_negative_keywords: 3,
  optimize_match_type: 5 }
export const T_MINUS_1_EXECUTION_ALLOWED_TYPES = new Set<StrategyRecommendationType>([
  'adjust_cpc',
  'adjust_budget',
  'expand_keywords',
  'add_negative_keywords',
  'optimize_match_type',
])
export const T_MINUS_1_EXECUTION_ALLOWED_TYPES_TEXT =
  'adjust_cpc, adjust_budget, expand_keywords, add_negative_keywords, optimize_match_type'
