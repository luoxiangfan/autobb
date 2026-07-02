export type SettingItem = {
  key: string
  value: string | null
  dataType: string
  description?: string | null
  isSensitive?: boolean
}

export type OpenclawSettingsResponse = {
  success: boolean
  isAdmin: boolean
  userId: number
  user: SettingItem[]
}

export type TokenRecord = {
  id: number
  name: string | null
  status: string
  created_at: string
  last_used_at: string | null
}

export type DailyReport = {
  date: string
  dateRange?: {
    startDate?: string
    endDate?: string
    days?: number
    isRange?: boolean
  }
  generatedAt: string
  summary?: any
  kpis?: any
  trends?: any
  roi?: any
  campaigns?: any
  budget?: any
  performance?: any
  actions?: any[]
  strategyRecommendations?: OpenclawStrategyRecommendation[]
  errors?: Array<{ source: string; message: string }>
}

export type OpenclawStrategyRecommendation = {
  id: string
  reportDate?: string
  campaignId: number
  recommendationType:
    | 'adjust_cpc'
    | 'adjust_budget'
    | 'offline_campaign'
    | 'expand_keywords'
    | 'add_negative_keywords'
    | 'optimize_match_type'
  title: string
  summary?: string | null
  reason?: string | null
  priorityScore: number
  status: 'pending' | 'executed' | 'failed' | 'dismissed' | 'stale'
  executedAt?: string | null
  executionResult?: {
    queued?: boolean
    queueTaskId?: string | null
    queueTaskStatus?: 'pending' | 'running' | 'completed' | 'failed' | string
    queuedAt?: string | null
    queueUpdatedAt?: string | null
    queueRetryCount?: number
    queueTaskError?: string | null
    queueTaskCreatedAt?: string | null
    queueTaskStartedAt?: string | null
    error?: string | null
    postReviewTaskId?: string | null
    postReviewScheduledAt?: string | null
    postReview?: {
      status?: 'pending_window' | 'effective' | 'mixed' | 'ineffective' | 'no_data'
      reviewedAt?: string
    }
  } | null
  data?: {
    campaignName?: string
    runDays?: number
    impressions?: number
    clicks?: number
    cost?: number
    currency?: string | null
    ctrPct?: number
    cpc?: number
    roas?: number | null
    currentCpc?: number | null
    recommendedCpc?: number | null
    currentBudget?: number | null
    recommendedBudget?: number | null
    budgetType?: 'DAILY' | 'TOTAL'
    breakEvenConversionRatePct?: number | null
    breakEvenConversionRateByRecommendedCpcPct?: number | null
    commissionPerConversion?: number | null
    commissionLagProtected?: boolean
    estimatedCostSaving?: number
    estimatedRevenueUplift?: number
    estimatedNetImpact?: number
    impactWindowDays?: number
    impactConfidence?: 'low' | 'medium' | 'high'
    impactConfidenceReason?: string
    impactEstimationSource?: 'observed_roas' | 'fallback_lag_protected' | 'fallback_default'
    postReviewStatus?: 'pending_window' | 'effective' | 'mixed' | 'ineffective' | 'no_data'
    postReviewSummary?: {
      reviewedAt?: string
      reviewWindowDays?: number
      after?: {
        observedDays?: number
      }
    }
    keywordCoverageCount?: number
    creativeQuality?: {
      headlineCount: number
      descriptionCount: number
      keywordCount: number
      level: 'high' | 'medium' | 'low'
    }
    analysisNote?: string
    keywordPlan?: Array<{ text: string; matchType: 'BROAD' | 'PHRASE' | 'EXACT' }>
    negativeKeywordPlan?: Array<{ text: string; matchType: 'BROAD' | 'PHRASE' | 'EXACT'; reason?: string }>
    matchTypePlan?: Array<{
      text: string
      currentMatchType: 'BROAD' | 'PHRASE' | 'EXACT'
      recommendedMatchType: 'BROAD' | 'PHRASE' | 'EXACT'
      clicks?: number
      conversions?: number
      cost?: number
    }>
    searchTermFeedback?: {
      hardNegativeTerms?: string[]
      softSuppressTerms?: string[]
      lookbackDays?: number
      dominantCurrency?: string
    }
    matchTypeReplaceMode?: 'none' | 'pause_existing'
  }
}

export type StrategyRecommendationsResponse = {
  success: boolean
  reportDate?: string | null
  serverDate?: string | null
  historicalReadOnly?: boolean
  code?: string
  recommendations?: OpenclawStrategyRecommendation[]
  trigger?: 'manual'
  reportSent?: boolean
  reportSendError?: string | null
  reportDeliveryTaskId?: string | null
  reportDeliveryMode?: 'queued' | string
  error?: string
}

export type StrategyRecommendationStatusFilter =
  | 'actionable'
  | 'all'
  | 'queued'
  | 'pending'
  | 'executed'
  | 'failed'
  | 'dismissed'
  | 'stale'

export type StrategyBatchAction = 'execute' | 'dismiss'
export type StrategyBatchScope = 'filtered' | 'display'

export type StrategyBatchFailure = {
  id: string
  action: StrategyBatchAction
  message: string
}

export type StrategyConfirmTone = 'info' | 'warning' | 'danger'

export type StrategyConfirmRequest = {
  title: string
  description: string
  details?: string[]
  confirmLabel?: string
  tone?: StrategyConfirmTone
  acknowledgeLabel?: string
}

export type GatewayStatusResponse = {
  success: boolean
  fetchedAt?: string
  health?: any | null
  skills?: any | null
  errors?: string[]
  error?: string
}

export type OpenclawAiAuthOverrideWarning = {
  providerId: string
  source: 'auth-profile' | 'env'
  sourceLabel?: string
  profileIds?: string[]
  authProfilesPath?: string
  envVar?: string
  message: string
  suggestion?: string
}

export type OpenclawSettingsSaveResponse = {
  success?: boolean
  skippedKeys?: string[]
  aiAuthOverrideWarnings?: OpenclawAiAuthOverrideWarning[]
  error?: string
}

export type OpenclawGatewayReloadResponse = {
  success?: boolean
  message?: string
  gatewayStatus?: GatewayStatusResponse
  aiAuthOverrideWarnings?: OpenclawAiAuthOverrideWarning[]
  error?: string
}

export type GatewaySkillRow = {
  skill: any
  missingItems: string[]
  isReady: boolean
  status: {
    label: string
    variant: 'default' | 'secondary' | 'outline' | 'destructive'
  }
  installHint: string
}

export type WorkspaceStatusFile = {
  name: string
  path: string
  exists: boolean
  size: number | null
  updatedAt: string | null
}

export type WorkspaceStatusResponse = {
  success: boolean
  source?: 'runtime-config' | 'computed'
  runtimeWorkspaceDir?: string | null
  computedWorkspaceDir?: string
  workspaceDir?: string
  memoryDir?: string
  files?: WorkspaceStatusFile[]
  missingFiles?: string[]
  dailyMemoryPath?: string
  dailyMemoryExists?: boolean
  canReloadGateway?: boolean
  error?: string
}

export type WorkspaceBootstrapResponse = {
  success: boolean
  changedFiles?: string[]
  status?: WorkspaceStatusResponse
  error?: string
}

export type FeishuReceiveIdType = 'open_id' | 'union_id' | 'chat_id'

export type FeishuVerifySessionState = {
  verificationId: string
  code: string
  expiresAt: number
  receiveIdType: FeishuReceiveIdType
  target: string
  expectedSenderOpenId: string
}

export type FeishuVerifyResultState = {
  verified: boolean
  pending: boolean
  message: string
}

export type FeishuChatHealthDecision = 'allowed' | 'blocked' | 'error'
export type FeishuChatExecutionState =
  | 'not_applicable'
  | 'waiting'
  | 'missing'
  | 'pending_confirm'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'expired'
  | 'unknown'

export type FeishuChatWorkflowState =
  | 'not_required'
  | 'running'
  | 'incomplete'
  | 'completed'
  | 'failed'
  | 'unknown'

export type FeishuChatWorkflowStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'unknown'

export type FeishuChatWorkflowStep = {
  key: string
  label: string
  status: FeishuChatWorkflowStepStatus
  detail: string
}

export type FeishuChatHealthLogItem = {
  id: number
  userId: number
  accountId: string
  messageId: string | null
  chatId: string | null
  chatType: string | null
  messageType: string | null
  senderPrimaryId: string | null
  senderOpenId: string | null
  senderUnionId: string | null
  senderUserId: string | null
  senderCandidates: string[]
  decision: FeishuChatHealthDecision
  reasonCode: string
  reasonMessage: string | null
  messageText: string | null
  messageExcerpt: string
  messageTextLength: number
  metadata: Record<string, unknown> | null
  executionState: FeishuChatExecutionState
  executionRunId: string | null
  executionRunStatus: string | null
  executionRunCount: number
  executionRunCreatedAt: string | null
  executionDetail: string
  workflowState: FeishuChatWorkflowState
  workflowProgress: number
  workflowDetail: string
  workflowOfferId: number | null
  workflowSteps: FeishuChatWorkflowStep[]
  ageSeconds: number
  createdAt: string
}

export type FeishuChatHealthResponse = {
  success: boolean
  rows: FeishuChatHealthLogItem[]
  stats: {
    total: number
    allowed: number
    blocked: number
    error: number
    execution: {
      linked: number
      completed: number
      inProgress: number
      waiting: number
      missing: number
      failed: number
      notApplicable: number
      unknown: number
    }
    workflow: {
      tracked: number
      completed: number
      running: number
      incomplete: number
      failed: number
      notRequired: number
      unknown: number
    }
  }
  windowHours: number
  retentionDays: number
  excerptLimit: number
  executionMissingSeconds: number
  limit: number
}

export type OpenclawCommandRunStatus =
  | 'draft'
  | 'pending_confirm'
  | 'confirmed'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'expired'

export type OpenclawCommandRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type OpenclawCommandRunItem = {
  runId: string
  intent: string | null
  request: {
    method: string
    path: string
  }
  riskLevel: OpenclawCommandRiskLevel
  status: OpenclawCommandRunStatus
  confirmRequired: boolean
  confirmExpiresAt: string | null
  confirmStatus: string | null
  queueTaskId: string | null
  createdAt: string
  updatedAt: string
}

export type OpenclawCommandRunsResponse = {
  success: boolean
  items: OpenclawCommandRunItem[]
  pagination?: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}
