/**
 * One-time mechanical split of strategy-recommendations.ts into layered modules.
 * Run: node scripts/split-strategy-recommendations.mjs
 */
import fs from 'fs'
import path from 'path'

const dir = path.join('src', 'lib', 'openclaw', 'strategy')
const srcPath = path.join(dir, 'strategy-recommendations.ts')
const lines = fs.readFileSync(srcPath, 'utf8').split('\n')

function slice(start, end) {
  return lines.slice(start - 1, end).join('\n')
}

function exportInternalTypes(block) {
  return block.replace(
    /^type (CampaignRow|PerfAgg|CreativeRow|KeywordInventoryRow|CampaignKeywordInventory|SearchTermAgg|RecommendationDraft|KeywordExpansionPlanResult|ExecuteActionResult) /gm,
    'export type $1 '
  )
}

function stripExportKeyword(block) {
  return block.replace(/^export /gm, '')
}

function exportConsts(block) {
  return block.replace(
    /^const (MIN_|KEYWORD_|CPC_|SEARCH_|NEGATIVE_|MATCH_|IMPACT_|POST_|MAX_|MS_|OFFLINE_|RECOMMENDATION_|T_MINUS_)/gm,
    'export const $1'
  )
}

const typesFile = `${exportConsts(exportInternalTypes(slice(17, 327)))}\n`

const utilsHeader = `import type {
  CampaignRow,
  CreativeRow,
  PerfAgg,
  StrategyImpactConfidence,
  StrategyImpactEstimationSource,
  StrategyRecommendationData,
  StrategyRecommendationStatus,
  StrategyRecommendationType,
} from './strategy-recommendation-types'
import {
  IMPACT_WINDOW_DAYS_COST_CONTROL,
  MAX_POST_REVIEW_WINDOW_DAYS,
  MIN_KEYWORD_COVERAGE_TARGET,
  POST_REVIEW_DEFAULT_WINDOW_DAYS,
} from './strategy-recommendation-types'
import { formatOpenclawLocalDate } from '@/lib/openclaw/runtime/report-date'
import { normalizeDateOnly } from '@/lib/db'
import { extractCampaignConfigKeywords } from '@/lib/campaign/server'
import crypto from 'crypto'

`

const utilsBody =
  slice(330, 732) +
  `

function parseExecutionResultObject(value: unknown): Record<string, any> {
  return safeParseObject(value)
}

` +
  slice(2924, 2939)

const utilsExports = `
export {
  formatLocalDate,
  isIsoDateLike,
  normalizeRecommendationReportDate,
  shiftIsoDate,
  toIsoTimestampFromEpoch,
  toNumber,
  roundTo2,
  clampNumber,
  recommendationCooldownKey,
  parseReviewWindowDays,
  hasSignalSample,
  estimateImpactConfidence,
  buildImpactConfidenceReason,
  resolveImpactEstimationSource,
  formatImpactEstimationSource,
  applyFallbackPriorityPenalty,
  applyImpactEstimation,
  buildSnapshotHash,
  safeParseArray,
  safeParseObject,
  parseExecutionResultObject,
  normalizeStrategyRecommendationStatus,
  normalizeGoogleCampaignId,
  calculateRunDays,
  buildPerfMap,
  calculateCreativeQuality,
  sanitizeKeyword,
  normalizeBudgetType,
  buildDailyBudgetUpdatePayload,
  normalizeKeywordMatchType,
  normalizeBoolean,
  normalizeKeywordKey,
  tokenizeKeywordText,
  containsTokenSequence,
  isKeywordConflictingWithNegativeTerms,
  extractCampaignConfigKeywordSet,
  resolveCampaignConfigMaxCpc,
  resolveCampaignCurrentCpc,
  shouldGenerateExpandKeywordsRecommendation,
  buildDeterministicRecommendationExecuteTaskId,
}
`

const plannersHeader = `import type {
  CampaignKeywordInventory,
  CampaignRow,
  CreativeRow,
  PerfAgg,
  RecommendationDraft,
  SearchTermAgg,
  StrategyKeywordSuggestion,
  StrategyMatchTypeSuggestion,
  StrategyNegativeKeywordSuggestion,
  StrategyRecommendationData,
  StrategyRecommendationType,
} from './strategy-recommendation-types'
import {
  CPC_RAISE_CAP_MULTIPLIER,
  CPC_RAISE_NO_TRAFFIC_MAX_RUN_DAYS,
  CPC_RAISE_NO_TRAFFIC_MIN_RUN_DAYS,
  CPC_RAISE_STEP_RATIO,
  CPC_RECOMMENDED_DIVISOR,
  IMPACT_WINDOW_DAYS_COST_CONTROL,
  IMPACT_WINDOW_DAYS_TRAFFIC_GROWTH,
  KEYWORD_EXPANSION_TARGET_MAX,
  KEYWORD_EXPANSION_TARGET_MIN,
  MATCH_TYPE_OPTIMIZATION_MAX,
  MIN_KEYWORD_COVERAGE_TARGET,
  MS_PER_DAY,
  NEGATIVE_KEYWORD_PLAN_MAX,
  OFFLINE_LOW_CTR_MIN_CLICKS,
  OFFLINE_LOW_CTR_MIN_COST,
  OFFLINE_LOW_CTR_MIN_IMPRESSIONS,
  RECOMMENDATION_COOLDOWN_DAYS,
  SEARCH_TERM_LOOKBACK_DAYS,
} from './strategy-recommendation-types'
import {
  applyFallbackPriorityPenalty,
  applyImpactEstimation,
  buildImpactConfidenceReason,
  buildSnapshotHash,
  calculateCreativeQuality,
  calculateRunDays,
  estimateImpactConfidence,
  extractCampaignConfigKeywordSet,
  formatImpactEstimationSource,
  hasSignalSample,
  isKeywordConflictingWithNegativeTerms,
  normalizeBudgetType,
  normalizeGoogleCampaignId,
  normalizeKeywordKey,
  normalizeKeywordMatchType,
  recommendationCooldownKey,
  resolveCampaignCurrentCpc,
  resolveImpactEstimationSource,
  roundTo2,
  sanitizeKeyword,
  shouldGenerateExpandKeywordsRecommendation,
  toNumber,
  tokenizeKeywordText,
  containsTokenSequence,
} from './strategy-recommendation-utils'
import { getCommissionPerConversion } from '@/lib/offers/server'
import { classifyKeywordIntent, recommendMatchTypeForKeyword } from '@/lib/keywords/server'
import { classifySearchTermFeedbackTerms } from '@/lib/keywords/server'
import { containsPureBrand, getPureBrandKeywords } from '@/lib/keywords/server'
import { extractCampaignConfigNegativeKeywords } from '@/lib/campaign/server'
import { patchExpandKeywordsSummaryCoverage } from './expand-keyword-coverage'

`

const plannersBody = exportInternalTypes(slice(733, 2208))
const plannersExports = `\nexport { buildRecommendationDrafts, buildCooldownUntilByKey, isRecommendationInCooldown }\n`

const repoHeader = `import type {
  StrategyRecommendation,
  StrategyRecommendationData,
  StrategyRecommendationType,
} from './strategy-recommendation-types'
import {
  normalizeRecommendationReportDate,
  normalizeStrategyRecommendationStatus,
  safeParseObject,
  toNumber,
} from './strategy-recommendation-utils'
import { getDatabase } from '@/lib/db'
import { toDbJsonObjectField } from '@/lib/db'

`

const repoBody = `${slice(2210, 2287)}\n\n${slice(2822, 2875)}`
const repoExports = `\nexport { listRecommendations, appendRecommendationEvent, getRecommendationById }\n`

const refreshStateFile = `import type { StrategyRecommendation } from './strategy-recommendation-types'

export const refreshRecommendationsInflight = new Map<string, Promise<StrategyRecommendation[]>>()
`

const refreshHeader = `import type {
  CampaignKeywordInventory,
  CampaignRow,
  CreativeRow,
  KeywordInventoryRow,
  SearchTermAgg,
  StrategyRecommendation,
  StrategyRecommendationType,
} from './strategy-recommendation-types'
import { refreshRecommendationsInflight } from './strategy-recommendation-refresh-state'
import { SEARCH_TERM_LOOKBACK_DAYS } from './strategy-recommendation-types'
import {
  buildPerfMap,
  calculateRunDays,
  extractCampaignConfigKeywordSet,
  formatLocalDate,
  normalizeBoolean,
  normalizeGoogleCampaignId,
  normalizeKeywordMatchType,
  roundTo2,
  sanitizeKeyword,
  shiftIsoDate,
  toNumber,
} from './strategy-recommendation-utils'
import {
  buildRecommendationDrafts,
  buildCooldownUntilByKey,
} from './strategy-recommendation-planners'
import { listRecommendations, appendRecommendationEvent } from './strategy-recommendation-repository'
import { getDatabase } from '@/lib/db'
import { toDbJsonObjectField } from '@/lib/db'
import { normalizeOpenclawReportDate } from '@/lib/openclaw/runtime/report-date'

`

const refreshBody = `${stripExportKeyword(slice(2311, 2791))}\n\n${stripExportKeyword(slice(2793, 2820))}`
const refreshExports = `\nexport { refreshStrategyRecommendations, getStrategyRecommendations }\n`

const lifecycleHeader = `import type {
  StrategyRecommendation,
  StrategyRecommendationData,
  StrategyRecommendationQueueTaskData,
  StrategyRecommendationType,
  StrategyPostReviewStatus,
  QueueStrategyRecommendationExecutionResult,
} from './strategy-recommendation-types'
import {
  T_MINUS_1_EXECUTION_ALLOWED_TYPES,
  T_MINUS_1_EXECUTION_ALLOWED_TYPES_TEXT,
  MS_PER_DAY,
  POST_REVIEW_DEFAULT_WINDOW_DAYS,
  POST_REVIEW_MIN_CLICKS,
  POST_REVIEW_MIN_COST,
  POST_REVIEW_MIN_IMPRESSIONS,
  POST_REVIEW_MIN_OBSERVED_DAYS,
} from './strategy-recommendation-types'
import {
  buildDeterministicRecommendationExecuteTaskId,
  formatLocalDate,
  hasSignalSample,
  normalizeRecommendationReportDate,
  parseExecutionResultObject,
  parseReviewWindowDays,
  roundTo2,
  safeParseObject,
  shiftIsoDate,
  toIsoTimestampFromEpoch,
  toNumber,
} from './strategy-recommendation-utils'
import {
  appendRecommendationEvent,
  getRecommendationById,
} from './strategy-recommendation-repository'
import { getQueueManagerForTaskType } from '@/lib/queue/queue-routing'
import { getDatabase } from '@/lib/db'
import { toDbJsonObjectField } from '@/lib/db'

`

const lifecycleBody = `${stripExportKeyword(slice(2877, 2918))}\n\n${stripExportKeyword(slice(2941, 3548))}`
const lifecycleExports = `
export {
  dismissStrategyRecommendation,
  assertStrategyRecommendationReadyForExecution,
  markStrategyRecommendationQueued,
  markStrategyRecommendationReviewQueued,
  reviewStrategyRecommendationEffect,
  queueStrategyRecommendationExecution,
}
`

const executionHeader = `import type {
  StrategyRecommendation,
  StrategyRecommendationData,
  StrategyRecommendationType,
} from './strategy-recommendation-types'
import {
  buildDailyBudgetUpdatePayload,
  normalizeGoogleCampaignId,
  parseExecutionResultObject,
  safeParseObject,
  toNumber,
} from './strategy-recommendation-utils'
import {
  appendRecommendationEvent,
  getRecommendationById,
} from './strategy-recommendation-repository'
import { assertStrategyRecommendationReadyForExecution } from './strategy-recommendation-lifecycle'
import { fetchAutoadsJson } from '@/lib/openclaw/runtime/autoads-client'
import { getDatabase } from '@/lib/db'
import { toDbJsonObjectField } from '@/lib/db'

`

const executionBody = `${stripExportKeyword(slice(2289, 2309))}\n\n${stripExportKeyword(slice(3550, 3916))}`
const executionExports = `
export {
  persistStrategyRecommendationExecutionRuntime,
  executeStrategyRecommendation,
  assertRecommendationActionResult,
  isAlreadyOfflineCampaignError,
}
`

const barrel = `export * from './strategy-recommendation-types'
export * from './strategy-recommendation-utils'
export * from './strategy-recommendation-planners'
export * from './strategy-recommendation-repository'
export * from './strategy-recommendation-refresh'
export * from './strategy-recommendation-lifecycle'
export * from './strategy-recommendation-execution'

import { buildRecommendationDrafts } from './strategy-recommendation-planners'
import {
  assertRecommendationActionResult,
  isAlreadyOfflineCampaignError,
} from './strategy-recommendation-execution'
import {
  buildDailyBudgetUpdatePayload,
  buildDeterministicRecommendationExecuteTaskId,
  normalizeRecommendationReportDate,
} from './strategy-recommendation-utils'
import { patchExpandKeywordsSummaryCoverage } from './expand-keyword-coverage'

export const __testUtils = {
  buildRecommendationDrafts,
  buildDeterministicRecommendationExecuteTaskId,
  buildDailyBudgetUpdatePayload,
  assertRecommendationActionResult,
  isAlreadyOfflineCampaignError,
  patchExpandKeywordsSummaryCoverage,
  normalizeRecommendationReportDate,
}
`

fs.writeFileSync(path.join(dir, 'strategy-recommendation-types.ts'), typesFile)
fs.writeFileSync(
  path.join(dir, 'strategy-recommendation-utils.ts'),
  utilsHeader + utilsBody + utilsExports
)
fs.writeFileSync(
  path.join(dir, 'strategy-recommendation-planners.ts'),
  plannersHeader + plannersBody + plannersExports
)
fs.writeFileSync(
  path.join(dir, 'strategy-recommendation-repository.ts'),
  repoHeader + repoBody + repoExports
)
fs.writeFileSync(path.join(dir, 'strategy-recommendation-refresh-state.ts'), refreshStateFile)
fs.writeFileSync(
  path.join(dir, 'strategy-recommendation-refresh.ts'),
  refreshHeader + refreshBody + refreshExports
)
fs.writeFileSync(
  path.join(dir, 'strategy-recommendation-lifecycle.ts'),
  lifecycleHeader + lifecycleBody + lifecycleExports
)
fs.writeFileSync(
  path.join(dir, 'strategy-recommendation-execution.ts'),
  executionHeader + executionBody + executionExports
)
fs.writeFileSync(path.join(dir, 'strategy-recommendations.ts'), barrel)

console.log('Split complete.')
