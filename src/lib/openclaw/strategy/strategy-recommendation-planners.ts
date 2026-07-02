import type {
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


export type KeywordExpansionPlanResult = {
  keywordPlan: StrategyKeywordSuggestion[]
  diagnostics: {
    candidateCountRecent: number
    candidateCountHistorical: number
    selectedFromRecent: number
    selectedFromHistorical: number
    excludedReasonCounts: Record<string, number>
  }
}

function scoreSearchTermCandidate(
  row: SearchTermAgg,
  sourceLayer: 'recent_search_terms' | 'historical_search_terms'
): number {
  const totalImpressions = Math.max(0, toNumber(row.impressions, 0))
  const totalClicks = Math.max(0, toNumber(row.clicks, 0))
  const totalConversions = Math.max(0, toNumber(row.conversions, 0))
  const totalCost = Math.max(0, toNumber(row.cost, 0))

  const recentImpressions = Math.max(0, toNumber(row.recentImpressions, 0))
  const recentClicks = Math.max(0, toNumber(row.recentClicks, 0))
  const recentConversions = Math.max(0, toNumber(row.recentConversions, 0))
  const recentCost = Math.max(0, toNumber(row.recentCost, 0))

  const totalCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0
  const recentCtr = recentImpressions > 0 ? recentClicks / recentImpressions : 0
  const totalCvr = totalClicks > 0 ? totalConversions / totalClicks : 0
  const recentCvr = recentClicks > 0 ? recentConversions / recentClicks : 0

  // 以转化与点击质量为主，近期信号作为加分，而不是硬门槛。
  let score =
    totalConversions * 18 +
    totalClicks * 0.28 +
    totalCtr * 90 +
    totalCvr * 110 +
    recentConversions * 26 +
    recentClicks * 0.55 +
    recentCtr * 150 +
    recentCvr * 180

  if (totalConversions <= 0) {
    score -= Math.min(12, totalCost * 0.15)
    if (recentConversions <= 0) {
      score -= Math.min(8, recentCost * 0.25)
    }
  }

  if (sourceLayer === 'historical_search_terms') {
    score -= 3
  }

  return roundTo2(Math.max(0, score))
}

function buildKeywordExpansionPlan(params: {
  brand: string | null
  category: string | null
  productName: string | null
  existing: Set<string>
  negativeTerms?: Set<string>
  searchTermsRecent?: SearchTermAgg[]
  searchTermsHistorical?: SearchTermAgg[]
}): KeywordExpansionPlanResult {
  const brand = sanitizeKeyword(String(params.brand || ''))
  const category = sanitizeKeyword(String(params.category || ''))
  const productName = sanitizeKeyword(String(params.productName || ''))
  const pureBrandKeywords = getPureBrandKeywords(brand)
  const existing = new Set<string>(Array.from(params.existing))
  const negativeTerms = new Set(
    Array.from(params.negativeTerms || [])
      .map((item) => normalizeKeywordKey(item))
      .filter(Boolean)
  )
  const relevanceAnchorTokens = new Set<string>()
  for (const text of [category, productName]) {
    for (const token of tokenizeKeywordText(text)) {
      if (token.length < 3) continue
      if (['best', 'buy', 'sale', 'deal', 'discount', 'coupon', 'offer', 'price', 'cost', 'cheap', 'official', 'store'].includes(token)) {
        continue
      }
      relevanceAnchorTokens.add(token)
    }
  }

  const diagnostics = {
    candidateCountRecent: 0,
    candidateCountHistorical: 0,
    selectedFromRecent: 0,
    selectedFromHistorical: 0,
    excludedReasonCounts: {} as Record<string, number> }

  const incrementExcludedReason = (reason: string) => {
    if (!reason) return
    diagnostics.excludedReasonCounts[reason] = (diagnostics.excludedReasonCounts[reason] || 0) + 1
  }

  const buildRankedPool = (
    rows: SearchTermAgg[] | undefined,
    sourceLayer: 'recent_search_terms' | 'historical_search_terms'
  ): SearchTermAgg[] => {
    if (!Array.isArray(rows) || rows.length === 0) return []
    const normalized: SearchTermAgg[] = []
    const seen = new Set<string>()
    for (const row of rows) {
      const text = sanitizeKeyword(String(row?.searchTerm || ''))
      const key = normalizeKeywordKey(text)
      if (!text || !key) continue
      if (seen.has(key)) continue
      seen.add(key)
      normalized.push({
        ...row,
        searchTerm: text })
    }
    return normalized.sort((a, b) => {
      const scoreDiff = scoreSearchTermCandidate(b, sourceLayer) - scoreSearchTermCandidate(a, sourceLayer)
      if (scoreDiff !== 0) return scoreDiff
      const convDiff = toNumber(b.conversions, 0) - toNumber(a.conversions, 0)
      if (convDiff !== 0) return convDiff
      const clickDiff = toNumber(b.clicks, 0) - toNumber(a.clicks, 0)
      if (clickDiff !== 0) return clickDiff
      return toNumber(b.impressions, 0) - toNumber(a.impressions, 0)
    })
  }

  const rankedRecentPool = buildRankedPool(params.searchTermsRecent, 'recent_search_terms')
  const rankedHistoricalPool = buildRankedPool(params.searchTermsHistorical, 'historical_search_terms')
  diagnostics.candidateCountRecent = rankedRecentPool.length
  diagnostics.candidateCountHistorical = rankedHistoricalPool.length

  const desiredAdditionCount = Math.min(
    KEYWORD_EXPANSION_TARGET_MAX,
    Math.max(
      KEYWORD_EXPANSION_TARGET_MIN,
      MIN_KEYWORD_COVERAGE_TARGET - params.existing.size + KEYWORD_EXPANSION_TARGET_MIN
    )
  )

  const selected: StrategyKeywordSuggestion[] = []
  const seen = new Set<string>(Array.from(existing))
  const appendCandidate = (
    row: SearchTermAgg,
    sourceLayer: 'recent_search_terms' | 'historical_search_terms'
  ): boolean => {
    const text = sanitizeKeyword(String(row.searchTerm || ''))
    const normalized = normalizeKeywordKey(text)
    const duplicateConflict = seen.has(normalized)
    if (!text || !normalized) {
      incrementExcludedReason('empty_or_invalid')
      return false
    }
    if (duplicateConflict) {
      incrementExcludedReason('duplicate_conflict')
      return false
    }
    if (normalized.length < 2 || normalized.length > 80) {
      incrementExcludedReason('length_out_of_range')
      return false
    }
    const negativeConflict = isKeywordConflictingWithNegativeTerms(text, negativeTerms)
    if (negativeConflict) {
      incrementExcludedReason('negative_conflict')
      return false
    }
    if (/(amazon|walmart|ebay|etsy|aliexpress|temu)\b/i.test(text)) {
      incrementExcludedReason('platform_query')
      return false
    }
    if (/\b(what is|meaning|tutorial|guide|manual|how to|instructions?)\b/i.test(text)) {
      incrementExcludedReason('informational_query')
      return false
    }
    if (/\b(review|reviews|comparison|compare|vs)\b/i.test(text)) {
      incrementExcludedReason('evaluative_query')
      return false
    }

    const hasBrand = pureBrandKeywords.length > 0
      ? containsPureBrand(text, pureBrandKeywords)
      : false
    const anchorMatches = tokenizeKeywordText(text)
      .filter((token) => relevanceAnchorTokens.has(token))
      .length
    if (!hasBrand && anchorMatches < 2) {
      incrementExcludedReason('weak_relevance_anchor')
      return false
    }

    const hasDemandAnchor = anchorMatches > 0
    if (/\b(discount|coupon|cheap|sale|deal|offer|promo|price|cost)\b/i.test(text) && !hasDemandAnchor) {
      incrementExcludedReason('low_intent_promo')
      return false
    }
    if (/\b(official store|store locator|near me)\b/i.test(text) && !hasDemandAnchor) {
      incrementExcludedReason('low_intent_navigational')
      return false
    }

    const impressions = toNumber(row.impressions, 0)
    const clicks = toNumber(row.clicks, 0)
    const conversions = toNumber(row.conversions, 0)
    const cost = roundTo2(toNumber(row.cost, 0))
    const recentClicks = toNumber(row.recentClicks, 0)
    const recentConversions = toNumber(row.recentConversions, 0)
    const score = scoreSearchTermCandidate(row, sourceLayer)
    const whySelectedParts: string[] = []
    if (sourceLayer === 'recent_search_terms') {
      whySelectedParts.push('来源：近14天真实Search Terms')
    } else {
      whySelectedParts.push('来源：历史真实Search Terms（高表现）')
    }
    if (conversions > 0) {
      whySelectedParts.push(`累计转化 ${roundTo2(conversions)}`)
    } else if (clicks > 0) {
      whySelectedParts.push(`累计点击 ${roundTo2(clicks)}`)
    }
    if (sourceLayer === 'historical_search_terms' && recentClicks > 0) {
      whySelectedParts.push(`近14天仍有点击 ${roundTo2(recentClicks)}`)
    }
    if (sourceLayer === 'historical_search_terms' && recentConversions > 0) {
      whySelectedParts.push(`近14天转化 ${roundTo2(recentConversions)}`)
    }
    if (hasBrand) {
      whySelectedParts.push('命中纯品牌词')
    }
    if (anchorMatches > 0) {
      whySelectedParts.push(`匹配 ${anchorMatches} 个相关锚点`)
    }
    whySelectedParts.push(`综合得分 ${score.toFixed(1)}`)

    const intent = classifyKeywordIntent(text).intent
    selected.push({
      text,
      matchType: recommendMatchTypeForKeyword({
        keyword: text,
        brandName: brand || undefined,
        intent }),
      sourceLayer,
      selectionScore: score,
      whySelected: whySelectedParts.join('；') || '来源于真实 Search Terms 且通过相关性校验',
      evidenceMetrics: {
        impressions,
        clicks,
        conversions,
        cost },
      conflictCheck: {
        negativeConflict,
        duplicateConflict } })
    seen.add(normalized)
    if (sourceLayer === 'recent_search_terms') diagnostics.selectedFromRecent += 1
    else diagnostics.selectedFromHistorical += 1
    return true
  }

  for (const row of rankedRecentPool) {
    appendCandidate(row, 'recent_search_terms')
    if (selected.length >= desiredAdditionCount) {
      return { keywordPlan: selected, diagnostics }
    }
  }

  for (const row of rankedHistoricalPool) {
    appendCandidate(row, 'historical_search_terms')
    if (selected.length >= desiredAdditionCount) {
      break
    }
  }

  return {
    keywordPlan: selected,
    diagnostics }
}

function buildExpandKeywordsSnapshotHash(params: {
  campaignId: number
  runDays: number
  keywordCoverageCount: number
  impressions: number
  clicks: number
  keywordPlan: StrategyKeywordSuggestion[]
}): string {
  return buildSnapshotHash({
    type: 'expand_keywords',
    campaignId: params.campaignId,
    runDays: params.runDays,
    keywordCoverageCount: params.keywordCoverageCount,
    impressions: params.impressions,
    clicks: params.clicks,
    keywordPlan: params.keywordPlan.map((item) => ({ text: item.text, matchType: item.matchType })) })
}

function estimateOfflinePriority(params: {
  noTraffic: boolean
  lowCtr: boolean
  lowRoas: boolean
  roas: number | null
  cost7d: number
  costTotal: number
}): number {
  const base = params.noTraffic ? 92 : (params.lowRoas ? 86 : (params.lowCtr ? 82 : 75))
  const roasPenalty = params.lowRoas && params.roas !== null
    ? Math.min(8, Math.max(0, (0.5 - params.roas) * 20))
    : 0
  const wasteCost = Math.max(params.cost7d, params.costTotal * 0.3)
  return roundTo2(Math.min(100, base + roasPenalty + Math.min(12, wasteCost / 20)))
}

function estimateCpcPriority(params: {
  currentCpc: number | null
  recommendedCpc: number
  clicks7d: number
  direction?: 'lower' | 'set' | 'raise'
  runDays?: number
  noTraffic?: boolean
}): number {
  if (params.direction === 'raise') {
    const raiseRatio = params.currentCpc && params.currentCpc > 0
      ? Math.max(0, (params.recommendedCpc / params.currentCpc) - 1)
      : 0
    const ratioBoost = Math.min(8, raiseRatio * 40)
    const dayBoost = Math.min(
      6,
      Math.max(0, toNumber(params.runDays, CPC_RAISE_NO_TRAFFIC_MIN_RUN_DAYS) - CPC_RAISE_NO_TRAFFIC_MIN_RUN_DAYS) * 1.5
    )
    const base = params.noTraffic ? 78 : 72
    return roundTo2(Math.min(90, base + ratioBoost + dayBoost))
  }
  if (!params.currentCpc || params.currentCpc <= 0) {
    return 70
  }
  const gap = Math.max(0, params.currentCpc - params.recommendedCpc)
  const savings = gap * params.clicks7d
  return roundTo2(Math.min(96, 68 + Math.min(18, gap * 30) + Math.min(10, savings * 2)))
}

function estimateKeywordPriority(params: {
  keywordCount: number
  impressions: number
  clicks: number
}): number {
  const coverageGap = Math.max(0, MIN_KEYWORD_COVERAGE_TARGET - params.keywordCount)
  const trafficGap = Math.max(0, 400 - params.impressions)
  const clickGap = Math.max(0, 25 - params.clicks)
  return roundTo2(Math.min(90, 52 + Math.min(20, coverageGap) + Math.min(10, trafficGap / 80) + Math.min(8, clickGap / 5)))
}

function estimateBudgetPriority(params: {
  ctrPct: number
  cpc: number
  currentBudget: number | null
  recommendedBudget: number
}): number {
  const ctrBoost = Math.min(14, Math.max(0, params.ctrPct - 6))
  const lowCpcBoost = params.cpc > 0 ? Math.min(10, Math.max(0, (0.8 - params.cpc) * 12)) : 0
  const budgetGap = params.currentBudget && params.currentBudget > 0
    ? Math.max(0, params.recommendedBudget - params.currentBudget)
    : params.recommendedBudget
  const budgetBoost = Math.min(8, budgetGap / 2)
  return roundTo2(Math.min(92, 60 + ctrBoost + lowCpcBoost + budgetBoost))
}

function estimateNegativeKeywordPriority(params: {
  hardNegativeCount: number
  totalCost: number
  selectedCount: number
}): number {
  const hardNegativeBoost = Math.min(20, params.hardNegativeCount * 3.5)
  const wasteCostBoost = Math.min(12, params.totalCost / 4)
  const coverageBoost = Math.min(8, params.selectedCount)
  return roundTo2(Math.min(96, 62 + hardNegativeBoost + wasteCostBoost + coverageBoost))
}

function estimateMatchTypePriority(params: {
  selectedCount: number
  totalCost: number
  broadToNarrowCount: number
}): number {
  const countBoost = Math.min(10, params.selectedCount * 1.4)
  const costBoost = Math.min(12, params.totalCost / 5)
  const directionBoost = Math.min(12, params.broadToNarrowCount * 2.5)
  return roundTo2(Math.min(94, 58 + countBoost + costBoost + directionBoost))
}

function buildNegativeKeywordPlan(params: {
  searchTerms: SearchTermAgg[]
  existingNegativeTerms: Set<string>
  hardFeedbackTerms?: Set<string>
}): StrategyNegativeKeywordSuggestion[] {
  const selected: StrategyNegativeKeywordSuggestion[] = []
  const seen = new Set<string>()
  const hardFeedbackTerms = new Set(
    Array.from(params.hardFeedbackTerms || [])
      .map((item) => normalizeKeywordKey(item))
      .filter(Boolean)
  )

  const ranked = [...params.searchTerms]
    .sort((a, b) => {
      const hardAByFeedback = hardFeedbackTerms.has(normalizeKeywordKey(a.searchTerm)) ? 1 : 0
      const hardBByFeedback = hardFeedbackTerms.has(normalizeKeywordKey(b.searchTerm)) ? 1 : 0
      if (hardAByFeedback !== hardBByFeedback) return hardBByFeedback - hardAByFeedback

      const hardA = classifyKeywordIntent(a.searchTerm).hardNegative ? 1 : 0
      const hardB = classifyKeywordIntent(b.searchTerm).hardNegative ? 1 : 0
      if (hardA !== hardB) return hardB - hardA
      const costDiff = toNumber(b.cost) - toNumber(a.cost)
      if (costDiff !== 0) return costDiff
      return toNumber(b.clicks) - toNumber(a.clicks)
    })

  for (const row of ranked) {
    const term = sanitizeKeyword(String(row.searchTerm || ''))
    if (!term) continue
    const normalized = normalizeKeywordKey(term)
    if (!normalized) continue
    if (seen.has(normalized) || params.existingNegativeTerms.has(normalized)) continue

    const clicks = toNumber(row.clicks, 0)
    const conversions = toNumber(row.conversions, 0)
    const cost = toNumber(row.cost, 0)
    const isFeedbackHard = hardFeedbackTerms.has(normalized)
    const intent = classifyKeywordIntent(term)
    if (!isFeedbackHard && !intent.hardNegative) continue
    if (conversions > 0) continue
    if (clicks < 2 && cost < 1.5) continue

    const reasonParts = new Set<string>()
    if (isFeedbackHard) reasonParts.add('performance_hard_negative')
    intent.reasons.forEach((reason) => reasonParts.add(reason))
    seen.add(normalized)
    selected.push({
      text: term,
      matchType: 'EXACT',
      reason: Array.from(reasonParts).join(', ') || 'hard_negative_intent' })
    if (selected.length >= NEGATIVE_KEYWORD_PLAN_MAX) {
      break
    }
  }

  return selected
}

function buildMatchTypeOptimizationPlan(params: {
  campaignKeywords: CampaignKeywordInventory[]
  brand: string | null
  searchTermMetrics: Map<string, SearchTermAgg>
  searchTerms?: SearchTermAgg[]
  softFeedbackTerms?: Set<string>
}): StrategyMatchTypeSuggestion[] {
  const selected: StrategyMatchTypeSuggestion[] = []
  const existingByTextMatch = new Set<string>()
  for (const keyword of params.campaignKeywords) {
    if (keyword.isNegative) continue
    existingByTextMatch.add(`${normalizeKeywordKey(keyword.text)}|${keyword.matchType}`)
  }

  for (const keyword of params.campaignKeywords) {
    if (keyword.isNegative) continue
    const text = sanitizeKeyword(keyword.text)
    const normalized = normalizeKeywordKey(text)
    if (!normalized) continue
    const currentMatchType = normalizeKeywordMatchType(keyword.matchType) || 'PHRASE'
    const intent = classifyKeywordIntent(text).intent
    const recommendedMatchType = recommendMatchTypeForKeyword({
      keyword: text,
      brandName: params.brand || undefined,
      intent })
    if (recommendedMatchType === currentMatchType) continue
    // KISS: 仅建议“收紧匹配类型”，避免放大流量风险
    const isNarrowing =
      (currentMatchType === 'BROAD' && (recommendedMatchType === 'PHRASE' || recommendedMatchType === 'EXACT'))
      || (currentMatchType === 'PHRASE' && recommendedMatchType === 'EXACT')
    if (!isNarrowing) continue
    if (existingByTextMatch.has(`${normalized}|${recommendedMatchType}`)) continue

    const perf = params.searchTermMetrics.get(normalized)
    const clicks = toNumber(perf?.clicks, 0)
    const conversions = toNumber(perf?.conversions, 0)
    const cost = toNumber(perf?.cost, 0)
    if (clicks < 5 && cost < 3) continue
    if (conversions > 0 && clicks < 20) continue

    selected.push({
      text,
      currentMatchType,
      recommendedMatchType,
      clicks: roundTo2(clicks),
      conversions: roundTo2(conversions),
      cost: roundTo2(cost) })
  }

  const softFeedbackTerms = new Set(
    Array.from(params.softFeedbackTerms || [])
      .map((item) => normalizeKeywordKey(item))
      .filter(Boolean)
  )
  if (softFeedbackTerms.size > 0 && Array.isArray(params.searchTerms) && params.searchTerms.length > 0) {
    const softRows = params.searchTerms
      .filter((row) => softFeedbackTerms.has(normalizeKeywordKey(row.searchTerm)))
      .sort((a, b) => {
        const costDiff = toNumber(b.cost) - toNumber(a.cost)
        if (costDiff !== 0) return costDiff
        return toNumber(b.clicks) - toNumber(a.clicks)
      })

    for (const row of softRows) {
      const softNormalized = normalizeKeywordKey(row.searchTerm)
      if (!softNormalized) continue
      const softTokens = tokenizeKeywordText(softNormalized)
      if (softTokens.length === 0) continue

      let bestCandidate: {
        text: string
        normalized: string
        currentMatchType: 'BROAD' | 'PHRASE' | 'EXACT'
        tokenCount: number
      } | null = null

      for (const keyword of params.campaignKeywords) {
        if (keyword.isNegative) continue
        const keywordText = sanitizeKeyword(keyword.text)
        const keywordNormalized = normalizeKeywordKey(keywordText)
        if (!keywordNormalized) continue
        const currentMatchType = normalizeKeywordMatchType(keyword.matchType) || 'PHRASE'
        if (currentMatchType === 'EXACT') continue

        const keywordTokens = tokenizeKeywordText(keywordNormalized)
        if (
          !containsTokenSequence(keywordTokens, softTokens)
          && !containsTokenSequence(softTokens, keywordTokens)
        ) {
          continue
        }

        const candidate = {
          text: keywordText,
          normalized: keywordNormalized,
          currentMatchType,
          tokenCount: keywordTokens.length || 999 }

        if (!bestCandidate) {
          bestCandidate = candidate
          continue
        }

        // Prefer narrowing BROAD first, then choose the broader phrase (fewer tokens).
        if (bestCandidate.currentMatchType !== 'BROAD' && candidate.currentMatchType === 'BROAD') {
          bestCandidate = candidate
          continue
        }
        if (bestCandidate.currentMatchType === candidate.currentMatchType && candidate.tokenCount < bestCandidate.tokenCount) {
          bestCandidate = candidate
        }
      }

      if (!bestCandidate) continue
      const recommendedMatchType = bestCandidate.currentMatchType === 'BROAD' ? 'PHRASE' : 'EXACT'
      if (existingByTextMatch.has(`${bestCandidate.normalized}|${recommendedMatchType}`)) continue

      const duplicated = selected.some(
        (item) =>
          normalizeKeywordKey(item.text) === bestCandidate?.normalized
          && item.recommendedMatchType === recommendedMatchType
      )
      if (duplicated) continue

      selected.push({
        text: bestCandidate.text,
        currentMatchType: bestCandidate.currentMatchType,
        recommendedMatchType,
        clicks: roundTo2(toNumber(row.clicks, 0)),
        conversions: roundTo2(toNumber(row.conversions, 0)),
        cost: roundTo2(toNumber(row.cost, 0)) })
    }
  }

  return selected
    .sort((a, b) => {
      const aGap = a.currentMatchType === 'BROAD' ? 2 : 1
      const bGap = b.currentMatchType === 'BROAD' ? 2 : 1
      if (aGap !== bGap) return bGap - aGap
      const costDiff = toNumber(b.cost) - toNumber(a.cost)
      if (costDiff !== 0) return costDiff
      return toNumber(b.clicks) - toNumber(a.clicks)
    })
    .slice(0, MATCH_TYPE_OPTIMIZATION_MAX)
}

type DuplicateOfflineMeta = {
  offerId: number
  winnerCampaignId: number
  winnerCampaignName: string
  winnerScore: number
  loserScore: number
}

function estimateDuplicateCampaignValueScore(params: {
  roas: number | null
  ctrPct: number
  clicks: number
  cpc: number
}): number {
  const roasScore = params.roas !== null
    ? Math.min(80, Math.max(0, params.roas * 40))
    : 0
  const ctrScore = Math.min(20, Math.max(0, params.ctrPct * 2))
  const clickScore = Math.min(15, Math.max(0, params.clicks / 8))
  const cpcPenalty = params.cpc > 0 ? Math.min(12, params.cpc * 8) : 0
  return roundTo2(roasScore + ctrScore + clickScore - cpcPenalty)
}

function estimateDuplicateOfflinePriority(params: {
  winnerScore: number
  loserScore: number
  cost7d: number
}): number {
  const gap = Math.max(0, params.winnerScore - params.loserScore)
  const gapBoost = Math.min(12, gap * 1.2)
  const wasteBoost = Math.min(8, params.cost7d / 8)
  return roundTo2(Math.min(94, 74 + gapBoost + wasteBoost))
}

function buildDuplicateOfflineMetaByCampaign(params: {
  campaigns: CampaignRow[]
  perfTotalByCampaign: Map<number, PerfAgg>
  perf7dByCampaign: Map<number, PerfAgg>
  commissionByCampaign: Map<number, number>
}): Map<number, DuplicateOfflineMeta> {
  type Candidate = {
    campaignId: number
    campaignName: string
    offerId: number
    runDays: number
    impressions: number
    clicks: number
    cpc: number
    roas: number | null
    score: number
  }

  const candidatesByOffer = new Map<number, Candidate[]>()

  for (const campaign of params.campaigns) {
    const campaignId = Number(campaign.id)
    const offerId = Number(campaign.offer_id)
    if (!Number.isFinite(campaignId) || !Number.isFinite(offerId) || offerId <= 0) continue

    const runDays = calculateRunDays(campaign.created_at, campaign.published_at)
    if (runDays <= 3) continue

    const perfTotal = params.perfTotalByCampaign.get(campaignId) || { impressions: 0, clicks: 0, cost: 0 }
    const hasTraffic = perfTotal.impressions > 0 || perfTotal.clicks > 0 || perfTotal.cost > 0
    if (!hasTraffic) continue

    const ctrPct = perfTotal.impressions > 0
      ? roundTo2((perfTotal.clicks / perfTotal.impressions) * 100)
      : 0
    const cpc = perfTotal.clicks > 0 ? roundTo2(perfTotal.cost / perfTotal.clicks) : 0
    const commissionAmount = roundTo2(params.commissionByCampaign.get(campaignId) || 0)
    const roas = perfTotal.cost > 0
      ? roundTo2(commissionAmount / perfTotal.cost)
      : null
    const score = estimateDuplicateCampaignValueScore({
      roas,
      ctrPct,
      clicks: perfTotal.clicks,
      cpc })

    const bucket = candidatesByOffer.get(offerId) || []
    bucket.push({
      campaignId,
      campaignName: campaign.campaign_name,
      offerId,
      runDays,
      impressions: perfTotal.impressions,
      clicks: perfTotal.clicks,
      cpc,
      roas,
      score })
    candidatesByOffer.set(offerId, bucket)
  }

  const duplicateOfflineMetaByCampaign = new Map<number, DuplicateOfflineMeta>()

  for (const [offerId, candidates] of candidatesByOffer.entries()) {
    if (candidates.length < 2) continue
    const sorted = [...candidates].sort((a, b) => b.score - a.score)
    const winner = sorted[0]
    if (!winner) continue

    for (const candidate of sorted.slice(1)) {
      const scoreGap = winner.score - candidate.score
      const gapLargeEnough = scoreGap >= 4
      const clicksWeak = candidate.clicks <= winner.clicks * 0.85
      const roasWeak =
        winner.roas !== null
        && candidate.roas !== null
        && candidate.roas + 0.12 < winner.roas
      if (!gapLargeEnough && !clicksWeak && !roasWeak) {
        continue
      }

      const perf7d = params.perf7dByCampaign.get(candidate.campaignId) || { impressions: 0, clicks: 0, cost: 0 }
      if (perf7d.cost <= 0 && candidate.clicks <= 0) {
        continue
      }

      duplicateOfflineMetaByCampaign.set(candidate.campaignId, {
        offerId,
        winnerCampaignId: winner.campaignId,
        winnerCampaignName: winner.campaignName,
        winnerScore: winner.score,
        loserScore: candidate.score })
    }
  }

  return duplicateOfflineMetaByCampaign
}

function buildCooldownUntilByKey(rows: Array<{
  campaign_id: number
  recommendation_type: string
  executed_at: string | null
}>): Map<string, number> {
  const cooldownUntilByKey = new Map<string, number>()
  for (const row of rows || []) {
    const campaignId = Number(row.campaign_id)
    if (!Number.isFinite(campaignId) || campaignId <= 0) continue
    const recommendationType = String(row.recommendation_type || '') as StrategyRecommendationType
    const cooldownDays = RECOMMENDATION_COOLDOWN_DAYS[recommendationType]
    if (!cooldownDays || cooldownDays <= 0) continue
    const executedAtMs = Date.parse(String(row.executed_at || ''))
    if (!Number.isFinite(executedAtMs) || executedAtMs <= 0) continue

    const cooldownUntilMs = executedAtMs + cooldownDays * MS_PER_DAY
    const key = recommendationCooldownKey(campaignId, recommendationType)
    const existing = cooldownUntilByKey.get(key)
    if (!existing || cooldownUntilMs > existing) {
      cooldownUntilByKey.set(key, cooldownUntilMs)
    }
  }
  return cooldownUntilByKey
}

function isRecommendationInCooldown(params: {
  campaignId: number
  recommendationType: StrategyRecommendationType
  cooldownUntilByKey?: Map<string, number>
  nowMs?: number
}): boolean {
  const until = params.cooldownUntilByKey?.get(
    recommendationCooldownKey(params.campaignId, params.recommendationType)
  )
  if (!until || !Number.isFinite(until)) return false
  return (params.nowMs || Date.now()) < until
}

function buildRecommendationDrafts(params: {
  campaigns: CampaignRow[]
  perf7dByCampaign: Map<number, PerfAgg>
  perfTotalByCampaign: Map<number, PerfAgg>
  commissionByCampaign: Map<number, number>
  keywordsByCampaign: Map<number, Set<string>>
  keywordInventoryByCampaign?: Map<number, CampaignKeywordInventory[]>
  searchTermsByCampaign?: Map<number, SearchTermAgg[]>
  historicalSearchTermsByCampaign?: Map<number, SearchTermAgg[]>
  creativeById: Map<number, CreativeRow>
  cooldownUntilByKey?: Map<string, number>
  nowMs?: number
}): RecommendationDraft[] {
  const recommendations: RecommendationDraft[] = []
  const duplicateOfflineMetaByCampaign = buildDuplicateOfflineMetaByCampaign({
    campaigns: params.campaigns,
    perfTotalByCampaign: params.perfTotalByCampaign,
    perf7dByCampaign: params.perf7dByCampaign,
    commissionByCampaign: params.commissionByCampaign })

  for (const campaign of params.campaigns) {
    const campaignId = Number(campaign.id)
    if (!Number.isFinite(campaignId)) continue

    const perf7d = params.perf7dByCampaign.get(campaignId) || { impressions: 0, clicks: 0, cost: 0 }
    const perfTotal = params.perfTotalByCampaign.get(campaignId) || { impressions: 0, clicks: 0, cost: 0 }
    const commissionAmount = roundTo2(params.commissionByCampaign.get(campaignId) || 0)
    const runDays = calculateRunDays(campaign.created_at, campaign.published_at)
    const ctrPct = perfTotal.impressions > 0
      ? roundTo2((perfTotal.clicks / perfTotal.impressions) * 100)
      : 0
    const cpc = perfTotal.clicks > 0 ? roundTo2(perfTotal.cost / perfTotal.clicks) : 0
    const roas = perfTotal.cost > 0
      ? roundTo2(commissionAmount / perfTotal.cost)
      : null

    const commissionInfo = getCommissionPerConversion({
      productPrice: campaign.product_price,
      commissionPayout: campaign.commission_payout,
      targetCountry: campaign.target_country || undefined })
    const commissionPerConversion = commissionInfo?.amount && commissionInfo.amount > 0
      ? roundTo2(commissionInfo.amount)
      : null
    const recommendedCpc = commissionPerConversion
      ? roundTo2(Math.max(0.01, commissionPerConversion / CPC_RECOMMENDED_DIVISOR))
      : null
    const currentCpc = resolveCampaignCurrentCpc(campaign)
    const currentBudget =
      campaign.budget_amount !== null && campaign.budget_amount !== undefined
        ? roundTo2(toNumber(campaign.budget_amount, 0))
        : null
    const budgetType = normalizeBudgetType(campaign.budget_type)
    const breakEvenConversionRatePct =
      currentCpc && commissionPerConversion
        ? roundTo2((currentCpc / commissionPerConversion) * 100)
        : null
    const breakEvenConversionRateByRecommendedCpcPct =
      recommendedCpc && commissionPerConversion
        ? roundTo2((recommendedCpc / commissionPerConversion) * 100)
        : null
    const inventoryKeywordSet = params.keywordsByCampaign.get(campaignId) || new Set<string>()
    const configKeywordSet = extractCampaignConfigKeywordSet(campaign.campaign_config)
    const keywordSet = new Set<string>(configKeywordSet)
    for (const item of inventoryKeywordSet) {
      keywordSet.add(item)
    }
    if (keywordSet.size > 0) {
      params.keywordsByCampaign.set(campaignId, keywordSet)
    }
    const keywordCoverageCount = keywordSet.size
    const keywordInventory = params.keywordInventoryByCampaign?.get(campaignId) || []
    const positiveKeywordInventory = keywordInventory.filter((item) => !item.isNegative)
    const negativeKeywordSet = new Set(
      keywordInventory
        .filter((item) => item.isNegative)
        .map((item) => normalizeKeywordKey(item.text))
        .filter(Boolean)
    )
    const campaignConfigNegativeKeywords = extractCampaignConfigNegativeKeywords(campaign.campaign_config)
    for (const item of campaignConfigNegativeKeywords) {
      const normalized = normalizeKeywordKey(item)
      if (!normalized) continue
      negativeKeywordSet.add(normalized)
    }
    const searchTermRows = params.searchTermsByCampaign?.get(campaignId) || []
    const historicalSearchTermRows = params.historicalSearchTermsByCampaign?.get(campaignId) || searchTermRows
    const searchTermPerfByText = new Map<string, SearchTermAgg>()
    for (const row of searchTermRows) {
      const key = normalizeKeywordKey(row.searchTerm)
      if (!key) continue
      const existing = searchTermPerfByText.get(key)
      if (!existing) {
        searchTermPerfByText.set(key, row)
      } else {
        searchTermPerfByText.set(key, {
          searchTerm: existing.searchTerm || row.searchTerm,
          impressions: roundTo2(toNumber(existing.impressions, 0) + toNumber(row.impressions, 0)),
          clicks: roundTo2(toNumber(existing.clicks, 0) + toNumber(row.clicks, 0)),
          conversions: roundTo2(toNumber(existing.conversions, 0) + toNumber(row.conversions, 0)),
          cost: roundTo2(toNumber(existing.cost, 0) + toNumber(row.cost, 0)) })
      }
    }
    const dominantCurrency = String(campaign.currency || 'USD').trim().toUpperCase() || 'USD'
    const searchTermFeedback = classifySearchTermFeedbackTerms(
      searchTermRows.map((item) => ({
        search_term: item.searchTerm,
        impressions: toNumber(item.impressions, 0),
        clicks: toNumber(item.clicks, 0),
        cost: toNumber(item.cost, 0) })),
      {
        dominantCurrency,
        maxTerms: 24
      }
    )
    const hardFeedbackTerms = new Set(
      searchTermFeedback.hardNegativeTerms
        .map((item) => normalizeKeywordKey(item))
        .filter(Boolean)
    )
    const softFeedbackTerms = new Set(
      searchTermFeedback.softSuppressTerms
        .map((item) => normalizeKeywordKey(item))
        .filter(Boolean)
    )
    const searchTermFeedbackSummary = (
      searchTermFeedback.hardNegativeTerms.length > 0 || searchTermFeedback.softSuppressTerms.length > 0
    )
      ? {
          hardNegativeTerms: searchTermFeedback.hardNegativeTerms.slice(0, 15),
          softSuppressTerms: searchTermFeedback.softSuppressTerms.slice(0, 15),
          lookbackDays: SEARCH_TERM_LOOKBACK_DAYS,
          dominantCurrency }
      : undefined
    const creativeQuality = calculateCreativeQuality(
      campaign.ad_creative_id ? params.creativeById.get(Number(campaign.ad_creative_id)) : undefined
    )
    const googleCampaignId = normalizeGoogleCampaignId(campaign.google_campaign_id, campaign.campaign_id)
    const commissionLagProtected = runDays <= 3 && commissionAmount <= 0
    const impactConfidence = estimateImpactConfidence({
      impressions: perfTotal.impressions,
      clicks: perfTotal.clicks,
      cost: perfTotal.cost,
      roas,
      commissionLagProtected })
    const impactConfidenceReason = buildImpactConfidenceReason({
      impressions: perfTotal.impressions,
      clicks: perfTotal.clicks,
      cost: perfTotal.cost,
      roas })
    const hasLowCtrSignalSample = hasSignalSample({
      impressions: perfTotal.impressions,
      clicks: perfTotal.clicks,
      cost: perfTotal.cost,
      minImpressions: OFFLINE_LOW_CTR_MIN_IMPRESSIONS,
      minClicks: OFFLINE_LOW_CTR_MIN_CLICKS,
      minCost: OFFLINE_LOW_CTR_MIN_COST })

    const baseData: Omit<StrategyRecommendationData, 'ruleCode' | 'analysisNote'> = {
      campaignId,
      campaignName: campaign.campaign_name,
      offerId: campaign.offer_id ?? null,
      googleCampaignId,
      currency: dominantCurrency,
      runDays,
      impressions: perfTotal.impressions,
      clicks: perfTotal.clicks,
      cost: perfTotal.cost,
      ctrPct,
      cpc,
      roas,
      commissionAmount,
      commissionLagProtected,
      commissionPerConversion,
      currentCpc,
      recommendedCpc,
      currentBudget,
      recommendedBudget: null,
      budgetType,
      breakEvenConversionRatePct,
      breakEvenConversionRateByRecommendedCpcPct,
      estimatedCostSaving: 0,
      estimatedRevenueUplift: 0,
      estimatedNetImpact: 0,
      impactWindowDays: IMPACT_WINDOW_DAYS_COST_CONTROL,
      impactConfidence,
      impactConfidenceReason,
      keywordCoverageCount,
      creativeQuality }

    const over7DaysZeroImpression =
      runDays > 7 && perfTotal.impressions <= 0 && perfTotal.clicks <= 0
    const over7DaysLowCtr =
      runDays > 7 && hasLowCtrSignalSample && perfTotal.impressions > 0 && ctrPct < 5
    const over7DaysLowRoas =
      runDays > 7
      && perfTotal.cost > 0
      && roas !== null
      && roas < 0.5
      && !commissionLagProtected

    if (over7DaysZeroImpression || over7DaysLowCtr || over7DaysLowRoas) {
      if (isRecommendationInCooldown({
        campaignId,
        recommendationType: 'offline_campaign',
        cooldownUntilByKey: params.cooldownUntilByKey,
        nowMs: params.nowMs })) {
        continue
      }

      const ruleCode = over7DaysZeroImpression
        ? 'offline_over7d_zero_impression'
        : over7DaysLowRoas
          ? 'offline_over7d_low_roas'
          : 'offline_over7d_low_ctr'
      const snapshotHash = buildSnapshotHash({
        type: 'offline_campaign',
        campaignId,
        ruleCode,
        runDays,
        impressions: perfTotal.impressions,
        clicks: perfTotal.clicks,
        ctrPct,
        cost: perfTotal.cost,
        cpc,
        roas })
      const reason = over7DaysZeroImpression
        ? `已投放 ${runDays} 天，累计仍无曝光/点击。`
        : over7DaysLowRoas
          ? `已投放 ${runDays} 天，ROAS ${roas?.toFixed(2)}（低于 0.50）且成本已持续消耗。`
          : `已投放 ${runDays} 天，CTR 仅 ${ctrPct.toFixed(2)}%（低于 5%，且样本量已达判定阈值）。`
      const summary = over7DaysZeroImpression
        ? '建议下线该 Campaign，停止长期无效占用并回收预算。'
        : over7DaysLowRoas
          ? '建议下线该 Campaign，触发7天低ROAS止损。'
          : '建议下线该 Campaign，避免继续低效消耗。'
      const projectedWasteCost = roundTo2(
        Math.max(
          perf7d.cost,
          runDays > 0
            ? (perfTotal.cost / runDays) * IMPACT_WINDOW_DAYS_COST_CONTROL
            : perfTotal.cost
        )
      )

      recommendations.push({
        key: `${campaignId}:offline_campaign`,
        campaignId,
        googleCampaignId,
        recommendationType: 'offline_campaign',
        title: '下线Campaign（复用下线广告系列操作）',
        summary,
        reason,
        priorityScore: estimateOfflinePriority({
          noTraffic: over7DaysZeroImpression,
          lowCtr: over7DaysLowCtr,
          lowRoas: over7DaysLowRoas,
          roas,
          cost7d: perf7d.cost,
          costTotal: perfTotal.cost }),
        data: {
          ...applyImpactEstimation(baseData, {
            estimatedCostSaving: projectedWasteCost,
            estimatedRevenueUplift: 0,
            impactWindowDays: IMPACT_WINDOW_DAYS_COST_CONTROL }),
          snapshotHash,
          offlineOptions: {
            removeGoogleAdsCampaign: true,
            pauseClickFarmTasks: true,
            pauseUrlSwapTasks: true },
          ruleCode,
          analysisNote: over7DaysZeroImpression
            ? '超过7天且无曝光/点击，命中下线规则。'
            : over7DaysLowRoas
              ? '超过7天且ROAS<0.5，命中止损下线规则。'
              : '超过7天且CTR<5%，并满足最低样本量阈值，命中下线规则。' } })

      // 下线建议优先级最高，同一 Campaign 不再生成其它可执行建议，避免冲突。
      continue
    }

    const duplicateOfflineMeta = duplicateOfflineMetaByCampaign.get(campaignId)
    if (duplicateOfflineMeta) {
      if (isRecommendationInCooldown({
        campaignId,
        recommendationType: 'offline_campaign',
        cooldownUntilByKey: params.cooldownUntilByKey,
        nowMs: params.nowMs })) {
        continue
      }

      const scoreGap = roundTo2(duplicateOfflineMeta.winnerScore - duplicateOfflineMeta.loserScore)
      const ruleCode = 'offline_duplicate_offer_campaign'
      const snapshotHash = buildSnapshotHash({
        type: 'offline_campaign',
        campaignId,
        ruleCode,
        offerId: duplicateOfflineMeta.offerId,
        winnerCampaignId: duplicateOfflineMeta.winnerCampaignId,
        winnerScore: duplicateOfflineMeta.winnerScore,
        loserScore: duplicateOfflineMeta.loserScore,
        scoreGap })

      recommendations.push({
        key: `${campaignId}:offline_campaign`,
        campaignId,
        googleCampaignId,
        recommendationType: 'offline_campaign',
        title: '下线Campaign（合并同Offer重复系列）',
        summary: `同一Offer存在重复系列，建议保留高价值系列「${duplicateOfflineMeta.winnerCampaignName}」，下线该系列以集中预算。`,
        reason: `当前系列价值评分较低（${duplicateOfflineMeta.loserScore.toFixed(1)}），较优系列评分 ${duplicateOfflineMeta.winnerScore.toFixed(1)}，差值 ${scoreGap.toFixed(1)}。`,
        priorityScore: estimateDuplicateOfflinePriority({
          winnerScore: duplicateOfflineMeta.winnerScore,
          loserScore: duplicateOfflineMeta.loserScore,
          cost7d: perf7d.cost }),
        data: {
          ...applyImpactEstimation(baseData, {
            estimatedCostSaving: roundTo2(
              Math.max(
                perf7d.cost,
                runDays > 0
                  ? (perfTotal.cost / runDays) * IMPACT_WINDOW_DAYS_COST_CONTROL
                  : perfTotal.cost
              )
            ),
            estimatedRevenueUplift: 0,
            impactWindowDays: IMPACT_WINDOW_DAYS_COST_CONTROL }),
          snapshotHash,
          offlineOptions: {
            removeGoogleAdsCampaign: true,
            pauseClickFarmTasks: true,
            pauseUrlSwapTasks: true },
          ruleCode,
          analysisNote: `命中重复系列合并规则：同Offer建议仅保留 ${duplicateOfflineMeta.winnerCampaignName}，当前系列建议下线。` } })

      // 同 Offer 重复系列建议使用下线动作，避免与其它写操作冲突。
      continue
    }

    if (recommendedCpc && recommendedCpc > 0 && googleCampaignId) {
      const shouldRaiseCpcNoTraffic =
        runDays >= CPC_RAISE_NO_TRAFFIC_MIN_RUN_DAYS
        && runDays <= CPC_RAISE_NO_TRAFFIC_MAX_RUN_DAYS
        && perfTotal.impressions <= 0
        && perfTotal.clicks <= 0
      const cpcRaiseBase = currentCpc && currentCpc > 0 ? currentCpc : recommendedCpc
      const cpcRaiseCap = roundTo2(recommendedCpc * CPC_RAISE_CAP_MULTIPLIER)
      const raisedRecommendedCpc = roundTo2(
        Math.min(
          cpcRaiseCap,
          Math.max(0.01, cpcRaiseBase * (1 + CPC_RAISE_STEP_RATIO))
        )
      )
      const shouldRaiseCpc = shouldRaiseCpcNoTraffic && raisedRecommendedCpc > cpcRaiseBase * 1.001
      const shouldSetCpc = !currentCpc || currentCpc <= 0
      const shouldLowerCpc = Boolean(currentCpc && currentCpc > recommendedCpc * 1.05)
      if (shouldRaiseCpc || shouldSetCpc || shouldLowerCpc) {
        const inCooldown = isRecommendationInCooldown({
          campaignId,
          recommendationType: 'adjust_cpc',
          cooldownUntilByKey: params.cooldownUntilByKey,
          nowMs: params.nowMs })
        if (!inCooldown) {
          const direction: StrategyRecommendationData['cpcAdjustmentDirection'] =
            shouldRaiseCpc
              ? 'raise'
              : shouldLowerCpc
                ? 'lower'
                : 'set'
          const actionCpc =
            direction === 'raise'
              ? raisedRecommendedCpc
              : recommendedCpc
          const ruleCode =
            direction === 'raise'
              ? 'cpc_no_traffic_raise'
              : direction === 'lower'
                ? 'cpc_above_recommended'
                : 'cpc_unset_use_recommended'
          const snapshotHash = buildSnapshotHash({
            type: 'adjust_cpc',
            campaignId,
            direction,
            ruleCode,
            runDays,
            currentCpc,
            recommendedCpc,
            actionCpc,
            cpcRaiseCap,
            commissionPerConversion,
            breakEvenConversionRatePct,
            breakEvenConversionRateByRecommendedCpcPct })
          const reason = direction === 'raise'
            ? `已连续${runDays}天无曝光无点击，建议将CPC上调至 ${actionCpc.toFixed(2)}（单次+${Math.round(CPC_RAISE_STEP_RATIO * 100)}%，上限 ${cpcRaiseCap.toFixed(2)}）。`
            : direction === 'lower'
              ? `当前CPC ${currentCpc?.toFixed(2)} 高于建议CPC ${recommendedCpc.toFixed(2)}，建议下调。`
              : `当前未设置CPC上限，建议设置为 ${recommendedCpc.toFixed(2)}。`
          const lagHint = direction === 'raise'
            ? '连续3-7天无量场景优先提价抢量，本规则不校验ROAS门槛。'
            : commissionLagProtected
              ? '投放≤3天且暂无佣金，按佣金滞后规则不做负向判定。'
              : '已纳入投放成本与盈亏平衡分析。'
          const projectedClicks = Math.max(
            perf7d.clicks,
            Math.round((perfTotal.clicks / Math.max(runDays, 1)) * IMPACT_WINDOW_DAYS_COST_CONTROL)
          )
          const baselineCpc = currentCpc && currentCpc > 0 ? currentCpc : (cpc > 0 ? cpc : recommendedCpc)
          const estimatedCostSaving = direction === 'raise'
            ? 0
            : roundTo2(Math.max(0, baselineCpc - actionCpc) * Math.max(0, projectedClicks))
          const breakEvenConversionRateByActionCpcPct =
            actionCpc && commissionPerConversion
              ? roundTo2((actionCpc / commissionPerConversion) * 100)
              : null

          recommendations.push({
            key: `${campaignId}:adjust_cpc`,
            campaignId,
            googleCampaignId,
            recommendationType: 'adjust_cpc',
            title:
              direction === 'raise'
                ? '上调CPC抢量'
                : direction === 'lower'
                  ? '降低CPC至建议值'
                  : '设置建议CPC',
            summary:
              direction === 'raise'
                ? `连续${runDays}天无曝光无点击，建议先上调CPC至 ${actionCpc.toFixed(2)}（封顶 ${cpcRaiseCap.toFixed(2)}）。`
                : `建议CPC = 商品价格 × 佣金比例 ÷ 50 = ${recommendedCpc.toFixed(2)}。`,
            reason,
            priorityScore: estimateCpcPriority({
              currentCpc,
              recommendedCpc: actionCpc,
              clicks7d: perf7d.clicks,
              direction: direction || undefined,
              runDays,
              noTraffic: shouldRaiseCpcNoTraffic }),
            data: {
              ...applyImpactEstimation(baseData, {
                estimatedCostSaving,
                estimatedRevenueUplift: 0,
                impactWindowDays: IMPACT_WINDOW_DAYS_COST_CONTROL }),
              snapshotHash,
              recommendedCpc: actionCpc,
              cpcAdjustmentDirection: direction,
              breakEvenConversionRateByRecommendedCpcPct: breakEvenConversionRateByActionCpcPct,
              ruleCode,
              analysisNote: direction === 'raise'
                ? `${lagHint} 公式建议CPC ${recommendedCpc.toFixed(2)}，本次目标CPC ${actionCpc.toFixed(2)}。当前盈亏平衡转化率 ${breakEvenConversionRatePct?.toFixed(2) ?? '--'}%，按目标CPC为 ${breakEvenConversionRateByActionCpcPct?.toFixed(2) ?? '--'}%。`
                : `${lagHint} 当前盈亏平衡转化率 ${breakEvenConversionRatePct?.toFixed(2) ?? '--'}%，按建议CPC可降至 ${breakEvenConversionRateByActionCpcPct?.toFixed(2) ?? '--'}%。` } })
        }
      }
    }

    const shouldScaleBudget =
      Boolean(googleCampaignId)
      && (currentBudget || 0) > 0
      && runDays >= 2
      && ctrPct >= 8
      && perfTotal.impressions >= 300
      && perfTotal.clicks >= 20
      && (recommendedCpc ? cpc <= recommendedCpc * 1.1 : cpc <= 0.8)
      && (roas !== null ? roas >= 0.8 : commissionLagProtected)

    if (shouldScaleBudget && currentBudget && currentBudget > 0) {
      const inCooldown = isRecommendationInCooldown({
        campaignId,
        recommendationType: 'adjust_budget',
        cooldownUntilByKey: params.cooldownUntilByKey,
        nowMs: params.nowMs })
      if (!inCooldown) {
        const incrementalBudget = Math.max(
          3,
          Math.min(
            20,
            currentBudget * (roas !== null && roas >= 1.2 ? 0.6 : roas !== null && roas >= 1 ? 0.45 : 0.35)
          )
        )
        const recommendedBudget = roundTo2(currentBudget + incrementalBudget)
        const snapshotHash = buildSnapshotHash({
          type: 'adjust_budget',
          campaignId,
          runDays,
          currentBudget,
          recommendedBudget,
          budgetType,
          ctrPct,
          cpc,
          roas })
        const incrementalSpend = roundTo2(
          budgetType === 'DAILY'
            ? Math.max(0, recommendedBudget - currentBudget) * IMPACT_WINDOW_DAYS_COST_CONTROL
            : Math.max(0, recommendedBudget - currentBudget)
        )
        const impactEstimationSource = resolveImpactEstimationSource({
          roas,
          commissionLagProtected })
        const effectiveRoas = roas !== null
          ? Math.max(0, roas)
          : (commissionLagProtected ? 1 : 0.6)
        const estimatedRevenueUplift = roundTo2(Math.max(0, incrementalSpend * (effectiveRoas - 1)))
        const priorityScore = applyFallbackPriorityPenalty(
          estimateBudgetPriority({
            ctrPct,
            cpc,
            currentBudget,
            recommendedBudget }),
          impactEstimationSource
        )

        recommendations.push({
          key: `${campaignId}:adjust_budget`,
          campaignId,
          googleCampaignId,
          recommendationType: 'adjust_budget',
          title: '提高预算放量',
          summary: `当前预算 ${currentBudget.toFixed(2)}，建议提升到 ${recommendedBudget.toFixed(2)}（${budgetType}）。`,
          reason: `CTR ${ctrPct.toFixed(2)}%、CPC ${cpc.toFixed(2)}${roas !== null ? `、ROAS ${roas.toFixed(2)}` : ''}，满足放量条件。`,
          priorityScore,
          data: {
            ...applyImpactEstimation(baseData, {
              estimatedCostSaving: 0,
              estimatedRevenueUplift,
              impactWindowDays: IMPACT_WINDOW_DAYS_COST_CONTROL }),
            snapshotHash,
            recommendedBudget,
            budgetAdjustmentDirection: 'increase',
            ruleCode: 'adjust_budget_high_value_campaign',
            impactEstimationSource,
            analysisNote: `基于CTR/CPC/ROAS综合评估，建议提升预算承接有效流量。${formatImpactEstimationSource(impactEstimationSource)}。` } })
      }
    }

    if (shouldGenerateExpandKeywordsRecommendation({
      runDays,
      keywordCoverageCount,
      impressions: perfTotal.impressions,
      clicks: perfTotal.clicks })) {
      const inCooldown = isRecommendationInCooldown({
        campaignId,
        recommendationType: 'expand_keywords',
        cooldownUntilByKey: params.cooldownUntilByKey,
        nowMs: params.nowMs })
      if (!inCooldown) {
        const expansionPlan = buildKeywordExpansionPlan({
          brand: campaign.brand,
          category: campaign.category,
          productName: campaign.product_name,
          existing: keywordSet,
          negativeTerms: negativeKeywordSet,
          searchTermsRecent: searchTermRows,
          searchTermsHistorical: historicalSearchTermRows })
        const keywordPlan = expansionPlan.keywordPlan

        if (keywordPlan.length > 0) {
          const snapshotHash = buildExpandKeywordsSnapshotHash({
            campaignId,
            runDays,
            keywordCoverageCount,
            impressions: perfTotal.impressions,
            clicks: perfTotal.clicks,
            keywordPlan })
          const targetHint = keywordPlan.length < KEYWORD_EXPANSION_TARGET_MIN
            ? `（候选不足，先落地 ${keywordPlan.length} 个）`
            : '（目标 20-30 个）'
          const coverageGap = Math.max(1, MIN_KEYWORD_COVERAGE_TARGET - keywordCoverageCount)
          const projectedClicks = Math.max(
            5,
            Math.round(perf7d.clicks * (0.12 + Math.min(0.28, coverageGap * 0.015)))
          )
          const projectedCost = roundTo2(projectedClicks * (cpc > 0 ? cpc : (recommendedCpc || 0.5)))
          const impactEstimationSource = resolveImpactEstimationSource({
            roas,
            commissionLagProtected })
          const effectiveRoas = roas !== null
            ? Math.max(0, roas)
            : (commissionLagProtected ? 0.9 : 0.6)
          const estimatedRevenueUplift = roundTo2(Math.max(0, projectedCost * (effectiveRoas - 1)))
          const priorityScore = applyFallbackPriorityPenalty(
            estimateKeywordPriority({
              keywordCount: keywordCoverageCount,
              impressions: perfTotal.impressions,
              clicks: perfTotal.clicks }),
            impactEstimationSource
          )

          recommendations.push({
            key: `${campaignId}:expand_keywords`,
            campaignId,
            googleCampaignId,
            recommendationType: 'expand_keywords',
            title: '补充 Search Terms 关键词（含匹配类型）',
            summary: `当前关键词 ${keywordCoverageCount} 个，建议从 Search Terms 中补充 ${keywordPlan.length} 个关键词${targetHint}。`,
            reason: `关键词覆盖不足（<${MIN_KEYWORD_COVERAGE_TARGET}）且流量偏低（曝光 ${perfTotal.impressions} / 点击 ${perfTotal.clicks}），因此仅从真实 Search Terms 中补充候选（近期优先、历史补充）。`,
            priorityScore,
            data: {
              ...applyImpactEstimation(baseData, {
                estimatedCostSaving: 0,
                estimatedRevenueUplift,
                impactWindowDays: IMPACT_WINDOW_DAYS_TRAFFIC_GROWTH }),
              snapshotHash,
              keywordPlan,
              keywordPlanDiagnostics: expansionPlan.diagnostics,
              ruleCode: 'expand_keywords_low_coverage_low_traffic',
              impactEstimationSource,
              analysisNote: `已仅基于真实 Search Terms 候选筛选新增关键词（近期优先、历史补充），并为其自动推荐匹配类型（EXACT/PHRASE/BROAD）。${formatImpactEstimationSource(impactEstimationSource)}。` } })
        }
      }
    }

    const negativeKeywordPlan = buildNegativeKeywordPlan({
      searchTerms: searchTermRows,
      existingNegativeTerms: negativeKeywordSet,
      hardFeedbackTerms })
    if (negativeKeywordPlan.length > 0) {
      const inCooldown = isRecommendationInCooldown({
        campaignId,
        recommendationType: 'add_negative_keywords',
        cooldownUntilByKey: params.cooldownUntilByKey,
        nowMs: params.nowMs })
      if (!inCooldown) {
        const hardNegativeCount = negativeKeywordPlan.length
        const totalNegativeWasteCost = roundTo2(
          negativeKeywordPlan.reduce((acc, item) => {
            const row = searchTermPerfByText.get(normalizeKeywordKey(item.text))
            return acc + toNumber(row?.cost, 0)
          }, 0)
        )
        const snapshotHash = buildSnapshotHash({
          type: 'add_negative_keywords',
          campaignId,
          runDays,
          plan: negativeKeywordPlan.map((item) => ({
            text: item.text,
            matchType: item.matchType })) })
        const estimatedCostSaving = roundTo2(totalNegativeWasteCost * 0.7)
        recommendations.push({
          key: `${campaignId}:add_negative_keywords`,
          campaignId,
          googleCampaignId,
          recommendationType: 'add_negative_keywords',
          title: '新增否词（低质流量拦截）',
          summary: `识别到 ${negativeKeywordPlan.length} 个高风险搜索词，建议作为否词拦截。`,
          reason: `近${SEARCH_TERM_LOOKBACK_DAYS}天硬负向词存在消耗，预估可减少无效花费 ${totalNegativeWasteCost.toFixed(2)}。`,
          priorityScore: estimateNegativeKeywordPriority({
            hardNegativeCount,
            totalCost: totalNegativeWasteCost,
            selectedCount: negativeKeywordPlan.length }),
          data: {
            ...applyImpactEstimation(baseData, {
              estimatedCostSaving,
              estimatedRevenueUplift: 0,
              impactWindowDays: IMPACT_WINDOW_DAYS_TRAFFIC_GROWTH }),
            snapshotHash,
            negativeKeywordPlan,
            searchTermFeedback: searchTermFeedbackSummary,
            ruleCode: 'negative_keywords_from_search_terms',
            analysisNote: '基于搜索词 hard 反馈与硬负向意图词识别否词（投放回收口径仍按Campaign/Offer级佣金）。' } })
      }
    }

    const matchTypePlan = buildMatchTypeOptimizationPlan({
      campaignKeywords: positiveKeywordInventory,
      brand: campaign.brand,
      searchTermMetrics: searchTermPerfByText,
      searchTerms: searchTermRows,
      softFeedbackTerms })
    if (matchTypePlan.length > 0) {
      const inCooldown = isRecommendationInCooldown({
        campaignId,
        recommendationType: 'optimize_match_type',
        cooldownUntilByKey: params.cooldownUntilByKey,
        nowMs: params.nowMs })
      if (!inCooldown) {
        const broadToNarrowCount = matchTypePlan.filter((item) => item.currentMatchType === 'BROAD').length
        const totalCost = roundTo2(matchTypePlan.reduce((acc, item) => acc + toNumber(item.cost, 0), 0))
        const snapshotHash = buildSnapshotHash({
          type: 'optimize_match_type',
          campaignId,
          runDays,
          plan: matchTypePlan.map((item) => ({
            text: item.text,
            currentMatchType: item.currentMatchType,
            recommendedMatchType: item.recommendedMatchType })) })
        const estimatedCostSaving = roundTo2(totalCost * 0.2)
        const estimatedRevenueUplift = roas !== null && roas >= 0.6
          ? roundTo2(totalCost * Math.min(0.12, Math.max(0.03, roas * 0.05)))
          : 0

        recommendations.push({
          key: `${campaignId}:optimize_match_type`,
          campaignId,
          googleCampaignId,
          recommendationType: 'optimize_match_type',
          title: '优化匹配类型（收紧流量）',
          summary: `识别到 ${matchTypePlan.length} 个关键词存在匹配类型优化空间，建议收紧以提升流量质量。${searchTermFeedback.softSuppressTerms.length > 0 ? `（参考 soft 抑制词 ${searchTermFeedback.softSuppressTerms.length} 个）` : ''}`,
          reason: `候选词近${SEARCH_TERM_LOOKBACK_DAYS}天累计花费 ${totalCost.toFixed(2)}，建议优先从 BROAD 收敛到 PHRASE/EXACT${searchTermFeedback.softSuppressTerms.length > 0 ? ' 并弱化 soft 低效搜索词触发' : ''}。`,
          priorityScore: estimateMatchTypePriority({
            selectedCount: matchTypePlan.length,
            totalCost,
            broadToNarrowCount }),
          data: {
            ...applyImpactEstimation(baseData, {
              estimatedCostSaving,
              estimatedRevenueUplift,
              impactWindowDays: IMPACT_WINDOW_DAYS_TRAFFIC_GROWTH }),
            snapshotHash,
            matchTypePlan,
            searchTermFeedback: searchTermFeedbackSummary,
            matchTypeReplaceMode: 'pause_existing',
            ruleCode: 'optimize_keyword_match_type',
            analysisNote: '执行方式为新增推荐匹配类型关键词，并默认暂停原匹配类型关键词（可回滚）；soft 反馈词用于优先收紧匹配类型。' } })
      }
    }
  }

  return recommendations.sort((a, b) => b.priorityScore - a.priorityScore)
}
export { buildRecommendationDrafts, buildCooldownUntilByKey, isRecommendationInCooldown }
