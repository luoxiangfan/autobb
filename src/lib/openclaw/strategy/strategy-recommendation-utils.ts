import type {
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

function formatLocalDate(date: Date): string {
  return formatOpenclawLocalDate(date)
}

function isIsoDateLike(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function normalizeRecommendationReportDate(value: unknown): string {
  const normalized = normalizeDateOnly(value)
  if (normalized && isIsoDateLike(normalized)) {
    return normalized
  }
  return formatLocalDate(new Date())
}

function shiftIsoDate(dateText: string, offsetDays: number): string {
  if (!isIsoDateLike(dateText)) return formatLocalDate(new Date())
  const [yearText, monthText, dayText] = dateText.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return formatLocalDate(new Date())
  }
  const baseMs = Date.UTC(year, month - 1, day, 12, 0, 0, 0)
  return formatLocalDate(new Date(baseMs + offsetDays * 24 * 60 * 60 * 1000))
}

function toIsoTimestampFromEpoch(value: unknown): string | null {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return null
  return new Date(num).toISOString()
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function recommendationCooldownKey(campaignId: number, recommendationType: StrategyRecommendationType): string {
  return `${campaignId}:${recommendationType}`
}

function parseReviewWindowDays(value: unknown, fallback = POST_REVIEW_DEFAULT_WINDOW_DAYS): number {
  const parsed = Math.floor(toNumber(value, fallback))
  return clampNumber(parsed, 1, MAX_POST_REVIEW_WINDOW_DAYS)
}

function hasSignalSample(params: {
  impressions: number
  clicks: number
  cost: number
  minImpressions: number
  minClicks: number
  minCost: number
}): boolean {
  return params.impressions >= params.minImpressions
    || params.clicks >= params.minClicks
    || params.cost >= params.minCost
}

function estimateImpactConfidence(params: {
  impressions: number
  clicks: number
  cost: number
  roas: number | null
  commissionLagProtected: boolean
}): StrategyImpactConfidence {
  if (params.commissionLagProtected) {
    return 'low'
  }

  let signal = 0
  if (params.impressions >= 1500) {
    signal += 2
  } else if (params.impressions >= 500) {
    signal += 1
  }
  if (params.clicks >= 120) {
    signal += 2
  } else if (params.clicks >= 40) {
    signal += 1
  }
  if (params.cost >= 80) {
    signal += 2
  } else if (params.cost >= 25) {
    signal += 1
  }
  if (params.roas !== null) {
    signal += 1
  }

  if (signal >= 6) return 'high'
  if (signal >= 3) return 'medium'
  return 'low'
}

function buildImpactConfidenceReason(params: {
  impressions: number
  clicks: number
  cost: number
  roas: number | null
}): string {
  return `样本：曝光 ${Math.round(params.impressions)} / 点击 ${Math.round(params.clicks)} / 花费 ${roundTo2(params.cost).toFixed(2)}${params.roas !== null ? ` / ROAS ${params.roas.toFixed(2)}` : ' / ROAS --'}`
}

function resolveImpactEstimationSource(params: {
  roas: number | null
  commissionLagProtected: boolean
}): StrategyImpactEstimationSource {
  if (params.roas !== null) return 'observed_roas'
  return params.commissionLagProtected ? 'fallback_lag_protected' : 'fallback_default'
}

function formatImpactEstimationSource(source: StrategyImpactEstimationSource): string {
  if (source === 'observed_roas') return '估算口径：实测ROAS'
  if (source === 'fallback_lag_protected') return '估算口径：滞后保护回退'
  return '估算口径：默认回退'
}

function applyFallbackPriorityPenalty(
  priority: number,
  source: StrategyImpactEstimationSource
): number {
  if (source === 'observed_roas') return roundTo2(priority)
  const penalty = source === 'fallback_lag_protected' ? 4 : 8
  return roundTo2(Math.max(1, priority - penalty))
}

function applyImpactEstimation(
  baseData: Omit<StrategyRecommendationData, 'ruleCode' | 'analysisNote'>,
  impact: {
    estimatedCostSaving?: number
    estimatedRevenueUplift?: number
    impactWindowDays?: number
  }
): Omit<StrategyRecommendationData, 'ruleCode' | 'analysisNote'> {
  const estimatedCostSaving = roundTo2(Math.max(0, toNumber(impact.estimatedCostSaving, 0)))
  const estimatedRevenueUplift = roundTo2(Math.max(0, toNumber(impact.estimatedRevenueUplift, 0)))
  const impactWindowDays = parseReviewWindowDays(impact.impactWindowDays, IMPACT_WINDOW_DAYS_COST_CONTROL)
  return {
    ...baseData,
    estimatedCostSaving,
    estimatedRevenueUplift,
    estimatedNetImpact: roundTo2(estimatedCostSaving + estimatedRevenueUplift),
    impactWindowDays }
}

function buildSnapshotHash(payload: Record<string, unknown>): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 24)
}

function safeParseArray(value: unknown): any[] {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function safeParseObject(value: unknown): Record<string, any> {
  if (!value) return {}
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>
  }
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, any>
      : {}
  } catch {
    return {}
  }
}

function normalizeStrategyRecommendationStatus(value: unknown): StrategyRecommendationStatus {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'executed') return 'executed'
  if (normalized === 'failed') return 'failed'
  if (normalized === 'dismissed') return 'dismissed'
  if (normalized === 'stale') return 'stale'
  return 'pending'
}

function normalizeGoogleCampaignId(...values: Array<unknown>): string | null {
  for (const value of values) {
    const text = String(value || '').trim()
    if (/^\d+$/.test(text)) {
      return text
    }
  }
  return null
}

function calculateRunDays(createdAt: string | null, publishedAt: string | null): number {
  const source = String(publishedAt || createdAt || '').trim()
  if (!source) return 0
  const time = Date.parse(source)
  if (!Number.isFinite(time)) return 0
  return Math.max(0, Math.floor((Date.now() - time) / (1000 * 60 * 60 * 24)))
}

function buildPerfMap(rows: Array<{ campaign_id: number; impressions: number; clicks: number; cost: number }>): Map<number, PerfAgg> {
  const map = new Map<number, PerfAgg>()
  for (const row of rows) {
    const campaignId = Number(row.campaign_id)
    if (!Number.isFinite(campaignId)) continue
    map.set(campaignId, {
      impressions: toNumber(row.impressions, 0),
      clicks: toNumber(row.clicks, 0),
      cost: roundTo2(toNumber(row.cost, 0)) })
  }
  return map
}

function calculateCreativeQuality(creative: CreativeRow | undefined): StrategyRecommendationData['creativeQuality'] {
  if (!creative) {
    return {
      headlineCount: 0,
      descriptionCount: 0,
      keywordCount: 0,
      level: 'low' }
  }

  const headlines = safeParseArray(creative.headlines)
  const descriptions = safeParseArray(creative.descriptions)
  const keywords = safeParseArray(creative.keywords)
  const keywordsWithVolume = safeParseArray(creative.keywords_with_volume)
  const mergedKeywordCount = Math.max(keywords.length, keywordsWithVolume.length, 0)

  const headlineCount = headlines.length
  const descriptionCount = descriptions.length
  const keywordCount = mergedKeywordCount

  let level: 'high' | 'medium' | 'low' = 'low'
  if (headlineCount >= 12 && descriptionCount >= 4 && keywordCount >= 20) {
    level = 'high'
  } else if (headlineCount >= 8 && descriptionCount >= 3 && keywordCount >= 10) {
    level = 'medium'
  }

  return {
    headlineCount,
    descriptionCount,
    keywordCount,
    level }
}

function sanitizeKeyword(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function normalizeBudgetType(value: unknown): 'DAILY' | 'TOTAL' {
  const text = String(value || '').trim().toUpperCase()
  return text === 'TOTAL' ? 'TOTAL' : 'DAILY'
}

function buildDailyBudgetUpdatePayload(recommendedBudget: unknown): {
  budgetAmount: number
  budgetType: 'DAILY'
} {
  const budgetAmount = roundTo2(toNumber(recommendedBudget, 0))
  if (!(budgetAmount > 0)) {
    throw new Error('建议预算无效，无法执行')
  }
  // Align with campaigns page "调整每日预算" dialog payload contract.
  return {
    budgetAmount,
    budgetType: 'DAILY' }
}

function normalizeKeywordMatchType(value: unknown): 'BROAD' | 'PHRASE' | 'EXACT' | null {
  const text = String(value || '').trim().toUpperCase()
  if (text === 'BROAD' || text === 'PHRASE' || text === 'EXACT') {
    return text
  }
  return null
}

function normalizeBoolean(value: unknown): boolean {
  if (value === true || value === false) return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  const text = String(value || '').trim().toLowerCase()
  return text === 'true' || text === 'yes' || text === 'on'
}

function normalizeKeywordKey(text: string): string {
  return sanitizeKeyword(String(text || '')).toLowerCase()
}

function tokenizeKeywordText(text: string): string[] {
  return normalizeKeywordKey(text).match(/[\p{L}\p{N}]+/gu) || []
}

function containsTokenSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || haystack.length < needle.length) return false
  const limit = haystack.length - needle.length
  for (let start = 0; start <= limit; start += 1) {
    let matched = true
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        matched = false
        break
      }
    }
    if (matched) return true
  }
  return false
}

function isKeywordConflictingWithNegativeTerms(keyword: string, negativeTerms: Set<string>): boolean {
  const normalizedKeyword = normalizeKeywordKey(keyword)
  if (!normalizedKeyword || negativeTerms.size === 0) return false

  const keywordTokens = tokenizeKeywordText(normalizedKeyword)
  for (const rawNegative of negativeTerms) {
    const normalizedNegative = normalizeKeywordKey(rawNegative)
    if (!normalizedNegative) continue
    if (normalizedNegative === normalizedKeyword) {
      return true
    }
    const negativeTokens = tokenizeKeywordText(normalizedNegative)
    if (!negativeTokens.length || !keywordTokens.length) continue
    if (
      containsTokenSequence(keywordTokens, negativeTokens)
      || containsTokenSequence(negativeTokens, keywordTokens)
    ) {
      return true
    }
  }

  return false
}

function extractCampaignConfigKeywordSet(campaignConfig: unknown): Set<string> {
  const keywordSet = new Set<string>()
  for (const item of extractCampaignConfigKeywords(campaignConfig)) {
    const normalized = normalizeKeywordKey(item.text)
    if (!normalized) continue
    keywordSet.add(normalized)
  }
  return keywordSet
}

function resolveCampaignConfigMaxCpc(campaignConfig: unknown): number | null {
  const config = safeParseObject(campaignConfig)
  const candidates = [
    config.maxCpcBid,
    config.max_cpc_bid,
    config.maxCpc,
    config.max_cpc,
  ]
  for (const candidate of candidates) {
    const parsed = Number(candidate)
    if (Number.isFinite(parsed) && parsed > 0) {
      return roundTo2(parsed)
    }
  }
  return null
}

function resolveCampaignCurrentCpc(campaign: CampaignRow): number | null {
  const directCpc = Number(campaign.max_cpc)
  if (
    campaign.max_cpc !== null
    && campaign.max_cpc !== undefined
    && Number.isFinite(directCpc)
    && directCpc > 0
  ) {
    return roundTo2(directCpc)
  }
  return resolveCampaignConfigMaxCpc(campaign.campaign_config)
}

function shouldGenerateExpandKeywordsRecommendation(params: {
  runDays: number
  keywordCoverageCount: number
  impressions: number
  clicks: number
}): boolean {
  const lowKeywordCoverage = params.keywordCoverageCount < MIN_KEYWORD_COVERAGE_TARGET
  const lowTraffic = params.impressions < 400 || params.clicks < 25
  return params.runDays > 1 && lowKeywordCoverage && lowTraffic
}

function parseExecutionResultObject(value: unknown): Record<string, any> {
  return safeParseObject(value)
}

function buildDeterministicRecommendationExecuteTaskId(params: {
  recommendationId: string
  snapshotHash: string | null | undefined
}): string {
  const normalizedRecommendationId = String(params.recommendationId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80)
  const normalizedSnapshotHash = String(params.snapshotHash || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 40)
  const recommendationPart = normalizedRecommendationId || 'unknown'
  const snapshotPart = normalizedSnapshotHash || 'nosnapshot'
  return `openclaw-strategy-exec-${recommendationPart}-${snapshotPart}`
}
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
