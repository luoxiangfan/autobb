import type { Task } from '../types'
import { getDatabase } from '@/lib/db'
import {
  getOpenclawStrategyConfig,
  type OpenclawStrategyConfig,
} from '@/lib/openclaw/strategy-config'
import {
  executeStrategyRecommendation,
  getStrategyRecommendations,
  markStrategyRecommendationReviewQueued,
  reviewStrategyRecommendationEffect,
  type StrategyRecommendationQueueTaskData,
} from '@/lib/openclaw/strategy-recommendations'
import { normalizeOpenclawReportDate } from '@/lib/openclaw/report-date'
import { refreshOpenclawDailyReportSnapshot } from '@/lib/openclaw/reports'
import { getOpenclawSettingsMap } from '@/lib/openclaw/settings'
import { getQueueManagerForTaskType } from '@/lib/queue/queue-routing'
import { assertUserExecutionAllowed } from '@/lib/user-execution-eligibility'

export type OpenclawStrategyTaskData = {
  userId: number
  mode?: string
  trigger?: string
  kind?: StrategyRecommendationQueueTaskData['kind'] | 'analyze_recommendations'
  recommendationId?: string
  confirm?: boolean
  scheduledAt?: string
  reportDate?: string
  limit?: number
  sendReport?: boolean
}

type AsinItemRow = {
  id: number
  input_id: number | null
  asin: string | null
  country_code: string | null
  price: string | null
  brand: string | null
  title: string | null
  affiliate_link: string | null
  product_url: string | null
  priority: number | null
  status: string
  offer_id: number | null
  error_message: string | null
  data_json: unknown
}

type AsinOutcomeStats = {
  published: number
  failed: number
  lastStatus?: 'published' | 'failed'
}

type AsinOutcomeIndex = {
  byAsin: Map<string, AsinOutcomeStats>
  byBrand: Map<string, AsinOutcomeStats>
}

type RankedAsinItem = {
  item: AsinItemRow
  score: number
  signalSource: 'asin' | 'brand' | 'none'
  outcome: AsinOutcomeStats | null
  isPreferred: boolean
}

type ThompsonBudgetArmInput = {
  itemId: number
  asin: string | null
  brand: string | null
  priority: number
  isPreferred: boolean
  outcome: Partial<AsinOutcomeStats> | null
  signalSource: RankedAsinItem['signalSource']
}

type ThompsonBudgetAllocationArm = {
  itemId: number
  asin: string | null
  brand: string | null
  signalSource: RankedAsinItem['signalSource']
  alpha: number
  beta: number
  posteriorMean: number
  sampledTheta: number
  weight: number
  assignedBudget: number
}

type ThompsonBudgetAllocationResult = {
  method: 'thompson_sampling'
  totalBudget: number
  allocatedBudget: number
  perCampaignCap: number
  armCount: number
  arms: ThompsonBudgetAllocationArm[]
}

type KnowledgeBaseRow = {
  report_date: string
  summary_json: unknown
  notes: string | null
}

type AdaptiveStrategyInsight = {
  sampleDays: number
  roasSamples: number
  avgRoas: number | null
  profitableDays: number
  lossDays: number
  profitRate: number
  lossRate: number
  adjustment: 'expand' | 'defensive' | 'hold' | 'insufficient_data'
  before: {
    maxOffersPerRun: number
    defaultBudget: number
    maxCpc: number
  }
  after: {
    maxOffersPerRun: number
    defaultBudget: number
    maxCpc: number
  }
}

type StrategyRunStat = {
  publishSuccess: number
  publishFailed: number
  reason: string | null
}

type FailureGuardInsight = {
  sampleRuns: number
  publishSuccess: number
  publishFailed: number
  publishAttempts: number
  publishFailureRate: number
  stopLossRuns: number
  guardLevel: 'none' | 'mild' | 'strong' | 'insufficient_data'
  before: {
    maxOffersPerRun: number
    defaultBudget: number
    maxCpc: number
  }
  after: {
    maxOffersPerRun: number
    defaultBudget: number
    maxCpc: number
  }
}

const DEFAULT_TIMEZONE = process.env.TZ || 'Asia/Shanghai'

function formatLocalDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  if (typeof value === 'object') {
    return value as T
  }
  return fallback
}

function normalizeAsinKey(value: string | null | undefined): string | null {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
  return normalized ? normalized : null
}

function normalizeBrandKey(value: string | null | undefined): string | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  return normalized ? normalized : null
}

export function scoreAsinItemForExecution(params: {
  priority?: number | null
  outcome?: Partial<AsinOutcomeStats> | null
  isPreferred?: boolean
}): number {
  const priority = Math.max(0, toNumber(params.priority, 0))
  const published = Math.max(0, toNumber(params.outcome?.published, 0))
  const failed = Math.max(0, toNumber(params.outcome?.failed, 0))
  const sampleSize = published + failed
  const bayesWinRate = (published + 1) / (sampleSize + 2)

  const explorationBonus = sampleSize < 3 ? (3 - sampleSize) * 6 : 0
  const failurePenalty = Math.min(18, failed * 2)
  const recentFailurePenalty =
    String(params.outcome?.lastStatus || '').toLowerCase() === 'failed' ? 6 : 0
  const preferredBoost = params.isPreferred ? 80 : 0

  return roundCurrency(
    priority * 100 +
      bayesWinRate * 25 +
      explorationBonus -
      failurePenalty -
      recentFailurePenalty +
      preferredBoost
  )
}

export function rankAsinItemsForExecution(
  items: AsinItemRow[],
  outcomeIndex: AsinOutcomeIndex,
  options?: { priorityAsins?: Iterable<string> }
): RankedAsinItem[] {
  const preferredAsins = new Set(
    Array.from(options?.priorityAsins || [])
      .map((value) => normalizeAsinKey(String(value || '')))
      .filter((value): value is string => Boolean(value))
  )

  const ranked = items.map((item) => {
    const asinKey = normalizeAsinKey(item.asin)
    const brandKey = normalizeBrandKey(item.brand)

    const asinOutcome = asinKey ? outcomeIndex.byAsin.get(asinKey) : undefined
    const brandOutcome = brandKey ? outcomeIndex.byBrand.get(brandKey) : undefined
    const outcome = asinOutcome || brandOutcome || null
    const isPreferred = asinKey ? preferredAsins.has(asinKey) : false
    const signalSource: RankedAsinItem['signalSource'] = asinOutcome
      ? 'asin'
      : brandOutcome
        ? 'brand'
        : 'none'

    return {
      item,
      score: scoreAsinItemForExecution({
        priority: item.priority,
        outcome,
        isPreferred,
      }),
      signalSource,
      outcome,
      isPreferred,
    }
  })

  return ranked.sort((a, b) => {
    if (a.isPreferred !== b.isPreferred) return a.isPreferred ? -1 : 1
    if (b.score !== a.score) return b.score - a.score
    const priorityDelta = toNumber(b.item.priority, 0) - toNumber(a.item.priority, 0)
    if (priorityDelta !== 0) return priorityDelta
    return a.item.id - b.item.id
  })
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function sampleGamma(shape: number, randomFn: () => number): number {
  const safeShape = Math.max(0.0001, shape)

  if (safeShape < 1) {
    const u = Math.max(1e-12, randomFn())
    return sampleGamma(safeShape + 1, randomFn) * Math.pow(u, 1 / safeShape)
  }

  const d = safeShape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)

  while (true) {
    const u1 = Math.max(1e-12, randomFn())
    const u2 = Math.max(1e-12, randomFn())
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    const v = Math.pow(1 + c * z, 3)

    if (v <= 0) continue

    const u = Math.max(1e-12, randomFn())
    const z2 = z * z
    if (u < 1 - 0.0331 * z2 * z2) {
      return d * v
    }

    if (Math.log(u) < 0.5 * z2 + d * (1 - v + Math.log(v))) {
      return d * v
    }
  }
}

function sampleBeta(alpha: number, beta: number, randomFn: () => number): number {
  const a = Math.max(0.0001, alpha)
  const b = Math.max(0.0001, beta)
  const x = sampleGamma(a, randomFn)
  const y = sampleGamma(b, randomFn)
  const total = x + y
  if (!(total > 0)) {
    return a / (a + b)
  }
  return x / total
}

export function allocateBudgetsWithThompsonSampling(params: {
  totalBudget: number
  perCampaignCap: number
  arms: ThompsonBudgetArmInput[]
  randomFn?: () => number
}): ThompsonBudgetAllocationResult {
  const totalBudget = roundCurrency(Math.max(0, toNumber(params.totalBudget, 0)))
  const perCampaignCap = roundCurrency(Math.max(0.01, toNumber(params.perCampaignCap, 1)))
  const randomFn = params.randomFn || Math.random

  const preparedArms = params.arms.map((arm) => {
    const published = Math.max(0, toNumber(arm.outcome?.published, 0))
    const failed = Math.max(0, toNumber(arm.outcome?.failed, 0))
    const priorityBoost = Math.min(2, Math.max(0, toNumber(arm.priority, 0)) * 0.05)
    const preferredBoost = arm.isPreferred ? 0.5 : 0

    const alpha = 1 + published + priorityBoost + preferredBoost
    const beta = 1 + failed
    const posteriorMean = alpha / (alpha + beta)
    const sampledTheta = sampleBeta(alpha, beta, randomFn)
    const weight = Math.max(0.0001, sampledTheta * 0.7 + posteriorMean * 0.3)

    return {
      ...arm,
      alpha,
      beta,
      posteriorMean,
      sampledTheta,
      weight,
      assignedBudget: 0,
    }
  })

  if (preparedArms.length === 0 || totalBudget <= 0) {
    return {
      method: 'thompson_sampling',
      totalBudget,
      allocatedBudget: 0,
      perCampaignCap,
      armCount: preparedArms.length,
      arms: preparedArms.map((arm) => ({
        itemId: arm.itemId,
        asin: arm.asin,
        brand: arm.brand,
        signalSource: arm.signalSource,
        alpha: roundCurrency(arm.alpha),
        beta: roundCurrency(arm.beta),
        posteriorMean: roundCurrency(arm.posteriorMean),
        sampledTheta: roundCurrency(arm.sampledTheta),
        weight: roundCurrency(arm.weight),
        assignedBudget: 0,
      })),
    }
  }

  let remainingBudget = totalBudget
  let activeIndexes = preparedArms.map((_, idx) => idx)

  while (remainingBudget > 0.001 && activeIndexes.length > 0) {
    const activeWeightSum = activeIndexes.reduce((sum, idx) => sum + preparedArms[idx].weight, 0)
    if (!(activeWeightSum > 0)) break

    let distributedThisRound = 0
    for (const idx of activeIndexes) {
      const arm = preparedArms[idx]
      const remainingCap = perCampaignCap - arm.assignedBudget
      if (remainingCap <= 0) continue

      const share = remainingBudget * (arm.weight / activeWeightSum)
      const assigned = Math.min(remainingCap, share)
      if (assigned <= 0) continue

      arm.assignedBudget += assigned
      distributedThisRound += assigned
    }

    if (distributedThisRound <= 0) break

    remainingBudget = Math.max(0, remainingBudget - distributedThisRound)
    activeIndexes = activeIndexes.filter((idx) => {
      const arm = preparedArms[idx]
      return arm.assignedBudget < perCampaignCap - 0.001
    })
  }

  const roundedArms = preparedArms.map((arm) => ({
    ...arm,
    assignedBudget: roundCurrency(arm.assignedBudget),
  }))

  const roundedAllocated = roundCurrency(
    roundedArms.reduce((sum, arm) => sum + arm.assignedBudget, 0)
  )
  const budgetGap = roundCurrency(totalBudget - roundedAllocated)
  if (budgetGap > 0 && roundedArms.length > 0) {
    const sorted = [...roundedArms].sort((a, b) => b.weight - a.weight)
    for (const arm of sorted) {
      const current = roundedArms.find((entry) => entry.itemId === arm.itemId)
      if (!current) continue
      const remainingCap = roundCurrency(perCampaignCap - current.assignedBudget)
      if (remainingCap <= 0) continue

      const patch = roundCurrency(Math.min(remainingCap, budgetGap))
      if (patch <= 0) continue
      current.assignedBudget = roundCurrency(current.assignedBudget + patch)
      break
    }
  }

  const sortedArms = [...roundedArms].sort((a, b) => {
    if (b.sampledTheta !== a.sampledTheta) {
      return b.sampledTheta - a.sampledTheta
    }
    return b.posteriorMean - a.posteriorMean
  })

  return {
    method: 'thompson_sampling',
    totalBudget,
    allocatedBudget: roundCurrency(sortedArms.reduce((sum, arm) => sum + arm.assignedBudget, 0)),
    perCampaignCap,
    armCount: sortedArms.length,
    arms: sortedArms.map((arm) => ({
      itemId: arm.itemId,
      asin: arm.asin,
      brand: arm.brand,
      signalSource: arm.signalSource,
      alpha: roundCurrency(arm.alpha),
      beta: roundCurrency(arm.beta),
      posteriorMean: roundCurrency(arm.posteriorMean),
      sampledTheta: roundCurrency(arm.sampledTheta),
      weight: roundCurrency(arm.weight),
      assignedBudget: arm.assignedBudget,
    })),
  }
}

export function buildStrategyRunExplanations(params: {
  run: {
    id: string
    mode: string | null
    status: string | null
    runDate: string | null
    startedAt: string | null
    completedAt: string | null
    createdAt: string | null
    errorMessage: string | null
    statsJson: unknown
  }
  actions: Array<{
    id: number
    actionType: string
    targetType: string | null
    targetId: string | null
    status: string | null
    errorMessage: string | null
    requestJson: unknown
    responseJson: unknown
    createdAt: string | null
  }>
}) {
  const runStats = parseJson<Record<string, any>>(params.run.statsJson, {})

  const byType = params.actions.reduce(
    (acc, action) => {
      const key = action.actionType
      if (!acc[key]) {
        acc[key] = [] as typeof params.actions
      }
      acc[key].push(action)
      return acc
    },
    {} as Record<string, typeof params.actions>
  )

  const pushPublishedReasons = () => {
    const reasons: any[] = []

    if (runStats?.adaptiveInsight?.adjustment) {
      reasons.push({
        trigger: 'adaptive_tune',
        summary: '根据近7日ROI样本进行参数自适应',
        evidence: runStats.adaptiveInsight,
      })
    }

    if (runStats?.failureGuardInsight?.guardLevel) {
      reasons.push({
        trigger: 'failure_guard_tune',
        summary: '根据历史发布失败率进行防守式调参',
        evidence: runStats.failureGuardInsight,
      })
    }

    if (runStats?.budgetAllocation?.method) {
      reasons.push({
        trigger: 'budget_allocate',
        summary:
          runStats.budgetAllocation.method === 'thompson_sampling'
            ? '采用 Thompson Sampling 对候选臂进行预算分配'
            : '预算分配回退到默认预算策略',
        evidence: runStats.budgetAllocation,
      })
    }

    const cpcActions = (byType.adjust_cpc || [])
      .filter((action) => action.status === 'success')
      .map((action) => ({
        actionId: action.id,
        targetId: action.targetId,
        details: parseJson<Record<string, any>>(action.responseJson, {}),
      }))

    if (cpcActions.length > 0) {
      reasons.push({
        trigger: 'adjust_cpc',
        summary: '根据ROAS阈值规则动态调整CPC',
        evidence: {
          adjustedCount: cpcActions.length,
          samples: cpcActions.slice(0, 5),
        },
      })
    }

    return reasons
  }

  const pushPauseReasons = () => {
    const pauseActions = (byType.pause_campaign || []).map((action) => ({
      actionId: action.id,
      status: action.status,
      targetId: action.targetId,
      reason: action.errorMessage || null,
      request: parseJson<Record<string, any>>(action.requestJson, {}),
    }))

    const reasons: any[] = []
    if (pauseActions.length > 0) {
      reasons.push({
        trigger: 'pause_campaign',
        summary: '触发品牌冲突处理，暂停冲突Campaign',
        evidence: {
          pauseAttempts: pauseActions.length,
          pauseSuccess: pauseActions.filter((action) => action.status === 'success').length,
          pauseFailed: pauseActions.filter((action) => action.status !== 'success').length,
          samples: pauseActions.slice(0, 10),
        },
      })
    }

    if (runStats?.brandSnapshot) {
      reasons.push({
        trigger: 'active_brand_snapshot',
        summary: '基于账号品牌快照识别冲突与未知品牌风险',
        evidence: runStats.brandSnapshot,
      })
    }

    if (runStats?.unresolvedConflicts) {
      reasons.push({
        trigger: 'unresolved_conflicts',
        summary: '存在无法自动处理的品牌冲突，策略跳过发布',
        evidence: {
          unresolvedConflicts: runStats.unresolvedConflicts,
          unknownBrandConflicts: runStats.unknownBrandConflicts || 0,
        },
      })
    }

    return reasons
  }

  const pushCircuitBreakReasons = () => {
    const reasons: any[] = []

    const circuitBreakAction = (byType.spend_cap_circuit_break || [])[0]
    if (circuitBreakAction) {
      reasons.push({
        trigger: 'spend_cap_circuit_break',
        summary: '当日花费触发上限，执行全账号熔断暂停',
        evidence: {
          request: parseJson<Record<string, any>>(circuitBreakAction.requestJson, {}),
          response: parseJson<Record<string, any>>(circuitBreakAction.responseJson, {}),
          status: circuitBreakAction.status,
          errorMessage: circuitBreakAction.errorMessage,
        },
      })
    }

    if (runStats?.realtimeSpend) {
      reasons.push({
        trigger: 'spend_realtime_check',
        summary: '基于实时花费接口进行熔断前校验',
        evidence: runStats.realtimeSpend,
      })
    }

    if (runStats?.circuitBreak) {
      reasons.push({
        trigger: 'circuit_break_result',
        summary: '记录熔断执行结果（API优先，失败时本地兜底）',
        evidence: runStats.circuitBreak,
      })
    }

    return reasons
  }

  const publishActions = byType.publish_campaign || []
  const publishedSummary = {
    attempts: publishActions.length,
    success: publishActions.filter((action) => action.status === 'success').length,
    failed: publishActions.filter((action) => action.status !== 'success').length,
  }

  const stopLossAction = (byType.stop_loss || [])[0]

  return {
    run: {
      id: params.run.id,
      mode: params.run.mode,
      status: params.run.status,
      runDate: params.run.runDate,
      startedAt: params.run.startedAt,
      completedAt: params.run.completedAt,
      createdAt: params.run.createdAt,
      errorMessage: params.run.errorMessage,
    },
    summary: {
      reason: runStats.reason || null,
      offersConsidered: toNumber(runStats.offersConsidered, 0),
      campaignsPublished: toNumber(runStats.campaignsPublished, 0),
      campaignsPaused: toNumber(runStats.campaignsPaused, 0),
      publishFailed: toNumber(runStats.publishFailed, 0),
      skipped: toNumber(runStats.skipped, 0),
      projectedSpend: toNumber(runStats.projectedSpend, 0),
      dailySpent: toNumber(runStats.dailySpent, 0),
      publishedSummary,
      stopLoss: stopLossAction
        ? {
            actionId: stopLossAction.id,
            status: stopLossAction.status,
            details: parseJson<Record<string, any>>(stopLossAction.responseJson, {}),
            errorMessage: stopLossAction.errorMessage,
          }
        : runStats.stopLoss || null,
    },
    explanations: {
      publish: pushPublishedReasons(),
      pause: pushPauseReasons(),
      circuitBreak: pushCircuitBreakReasons(),
    },
    actionTimeline: params.actions.map((action) => ({
      id: action.id,
      actionType: action.actionType,
      targetType: action.targetType,
      targetId: action.targetId,
      status: action.status,
      errorMessage: action.errorMessage,
      createdAt: action.createdAt,
    })),
  }
}

export function calculateNextCpc(params: {
  roas: number
  currentCpc: number
  minCpc: number
  maxCpc: number
  targetRoas: number
}): number {
  const minCpc = Math.max(0.01, params.minCpc)
  const maxCpc = Math.max(minCpc, params.maxCpc)
  const current = Math.max(
    minCpc,
    Math.min(maxCpc, params.currentCpc > 0 ? params.currentCpc : maxCpc)
  )
  const targetRoas = Math.max(0.01, params.targetRoas)
  const roas = Math.max(0, params.roas)

  let next = current
  if (roas >= targetRoas * 1.25) {
    next = current * 1.1
  } else if (roas >= targetRoas) {
    next = current * 1.05
  } else if (roas >= targetRoas * 0.8) {
    next = current * 0.9
  } else {
    next = current * 0.75
  }

  return roundCurrency(Math.max(minCpc, Math.min(maxCpc, next)))
}

function extractRoasFromSummary(summary: unknown): number | null {
  const parsed = parseJson<Record<string, any>>(summary, {})
  const roi = parsed?.roi || {}
  const totalCost = toNumber(roi.totalCost, 0)
  const totalRevenue = toNumber(roi.totalRevenue, 0)

  if (totalCost <= 0) return null
  return totalRevenue / totalCost
}

export function deriveAdaptiveStrategyConfig(params: {
  config: OpenclawStrategyConfig
  knowledgeRows: Array<Pick<KnowledgeBaseRow, 'summary_json' | 'notes'>>
}): {
  effectiveConfig: OpenclawStrategyConfig
  insight: AdaptiveStrategyInsight
} {
  const { config, knowledgeRows } = params
  const effectiveConfig: OpenclawStrategyConfig = { ...config }

  const roasSamples = knowledgeRows
    .map((row) => extractRoasFromSummary(row.summary_json))
    .filter((value): value is number => value !== null && Number.isFinite(value))

  const sampleCount = roasSamples.length
  const avgRoas =
    sampleCount > 0 ? roasSamples.reduce((sum, roas) => sum + roas, 0) / sampleCount : null
  const profitableDays = roasSamples.filter((roas) => roas >= config.targetRoas).length
  const lossDays = roasSamples.filter((roas) => roas < config.targetRoas * 0.8).length
  const profitRate = sampleCount > 0 ? profitableDays / sampleCount : 0
  const lossRate = sampleCount > 0 ? lossDays / sampleCount : 0

  const before = {
    maxOffersPerRun: config.maxOffersPerRun,
    defaultBudget: config.defaultBudget,
    maxCpc: config.maxCpc,
  }

  let adjustment: AdaptiveStrategyInsight['adjustment'] = 'hold'

  if (sampleCount < 3) {
    adjustment = 'insufficient_data'
  } else if ((avgRoas || 0) >= config.targetRoas * 1.1 && profitRate >= 0.6) {
    adjustment = 'expand'
    const campaignBudgetCap = Math.max(1, Math.min(config.dailyBudgetCap, config.dailySpendCap))
    effectiveConfig.maxOffersPerRun = Math.min(config.maxOffersPerRun + 1, 8)
    effectiveConfig.defaultBudget = roundCurrency(
      clampNumber(config.defaultBudget * 1.1, 1, campaignBudgetCap)
    )
    effectiveConfig.maxCpc = roundCurrency(
      clampNumber(config.maxCpc * 1.05, config.minCpc, config.maxCpc * 1.2)
    )
  } else if ((avgRoas || 0) < config.targetRoas || lossRate >= 0.5) {
    adjustment = 'defensive'
    const campaignBudgetCap = Math.max(1, Math.min(config.dailyBudgetCap, config.dailySpendCap))
    effectiveConfig.maxOffersPerRun = Math.max(1, config.maxOffersPerRun - 1)
    effectiveConfig.defaultBudget = roundCurrency(
      clampNumber(config.defaultBudget * 0.8, 1, campaignBudgetCap)
    )
    effectiveConfig.maxCpc = roundCurrency(
      clampNumber(config.maxCpc * 0.9, config.minCpc, config.maxCpc)
    )
  }

  if (effectiveConfig.maxCpc < effectiveConfig.minCpc) {
    effectiveConfig.maxCpc = effectiveConfig.minCpc
  }

  return {
    effectiveConfig,
    insight: {
      sampleDays: knowledgeRows.length,
      roasSamples: sampleCount,
      avgRoas: avgRoas === null ? null : roundCurrency(avgRoas),
      profitableDays,
      lossDays,
      profitRate: roundCurrency(profitRate),
      lossRate: roundCurrency(lossRate),
      adjustment,
      before,
      after: {
        maxOffersPerRun: effectiveConfig.maxOffersPerRun,
        defaultBudget: effectiveConfig.defaultBudget,
        maxCpc: effectiveConfig.maxCpc,
      },
    },
  }
}

export function deriveFailureGuardConfig(params: {
  config: OpenclawStrategyConfig
  runStats: StrategyRunStat[]
}): {
  effectiveConfig: OpenclawStrategyConfig
  insight: FailureGuardInsight
} {
  const { config, runStats } = params
  const effectiveConfig: OpenclawStrategyConfig = { ...config }

  const publishSuccess = runStats.reduce(
    (sum, stat) => sum + Math.max(0, toNumber(stat.publishSuccess, 0)),
    0
  )
  const publishFailed = runStats.reduce(
    (sum, stat) => sum + Math.max(0, toNumber(stat.publishFailed, 0)),
    0
  )
  const publishAttempts = publishSuccess + publishFailed
  const publishFailureRate = publishAttempts > 0 ? publishFailed / publishAttempts : 0
  const stopLossRuns = runStats.filter((stat) => stat.reason === 'publish_failure_stop_loss').length

  const before = {
    maxOffersPerRun: config.maxOffersPerRun,
    defaultBudget: config.defaultBudget,
    maxCpc: config.maxCpc,
  }

  let guardLevel: FailureGuardInsight['guardLevel'] = 'none'
  if (runStats.length < 2 || publishAttempts < 3) {
    guardLevel = 'insufficient_data'
  } else if (stopLossRuns >= 2 || publishFailureRate >= 0.7) {
    guardLevel = 'strong'
  } else if (publishFailureRate >= 0.5) {
    guardLevel = 'mild'
  }

  const campaignBudgetCap = Math.max(1, Math.min(config.dailyBudgetCap, config.dailySpendCap))
  if (guardLevel === 'strong') {
    effectiveConfig.maxOffersPerRun = Math.max(1, config.maxOffersPerRun - 2)
    effectiveConfig.defaultBudget = roundCurrency(
      clampNumber(config.defaultBudget * 0.75, 1, campaignBudgetCap)
    )
    effectiveConfig.maxCpc = roundCurrency(
      clampNumber(config.maxCpc * 0.85, config.minCpc, config.maxCpc)
    )
  } else if (guardLevel === 'mild') {
    effectiveConfig.maxOffersPerRun = Math.max(1, config.maxOffersPerRun - 1)
    effectiveConfig.defaultBudget = roundCurrency(
      clampNumber(config.defaultBudget * 0.9, 1, campaignBudgetCap)
    )
    effectiveConfig.maxCpc = roundCurrency(
      clampNumber(config.maxCpc * 0.92, config.minCpc, config.maxCpc)
    )
  }

  return {
    effectiveConfig,
    insight: {
      sampleRuns: runStats.length,
      publishSuccess,
      publishFailed,
      publishAttempts,
      publishFailureRate: roundCurrency(publishFailureRate),
      stopLossRuns,
      guardLevel,
      before,
      after: {
        maxOffersPerRun: effectiveConfig.maxOffersPerRun,
        defaultBudget: effectiveConfig.defaultBudget,
        maxCpc: effectiveConfig.maxCpc,
      },
    },
  }
}

export function shouldTreatCampaignAsConflict(params: {
  campaignStatus?: unknown
  campaignBrand?: unknown
  targetBrand: string
  enforceUnknownBrandAsConflict?: boolean
}): { conflict: boolean; unknownBrand: boolean } {
  const status = String(params.campaignStatus || '')
    .trim()
    .toUpperCase()
  if (status !== 'ENABLED') {
    return { conflict: false, unknownBrand: false }
  }

  const target = String(params.targetBrand || '')
    .trim()
    .toLowerCase()
  if (!target) {
    return { conflict: false, unknownBrand: false }
  }

  const brand = String(params.campaignBrand || '')
    .trim()
    .toLowerCase()
  if (!brand) {
    const unknownAsConflict = params.enforceUnknownBrandAsConflict !== false
    return { conflict: unknownAsConflict, unknownBrand: unknownAsConflict }
  }

  return {
    conflict: brand !== target,
    unknownBrand: false,
  }
}

function isStrategyRecommendationTaskData(
  data: OpenclawStrategyTaskData | undefined
): data is StrategyRecommendationQueueTaskData {
  const kind = String(data?.kind || '').trim()
  const recommendationId = String(data?.recommendationId || '').trim()
  if (!recommendationId) return false
  return kind === 'execute_recommendation' || kind === 'review_recommendation'
}

function normalizeRecommendationLimit(value: unknown, fallback = 100): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.floor(parsed), 1), 200)
}

async function executeStrategyRecommendationTask(
  task: Task<OpenclawStrategyTaskData & StrategyRecommendationQueueTaskData>
): Promise<{ success: boolean; skipped?: boolean }> {
  const recommendationId = String(task.data?.recommendationId || '').trim()
  const kind = String(task.data?.kind || '').trim() as StrategyRecommendationQueueTaskData['kind']
  const userId = Number(task.data?.userId || task.userId)
  await assertUserExecutionAllowed(userId, {
    source: `openclaw-strategy:${task.id}:${kind || 'unknown'}`,
  })

  if (!recommendationId || !kind) {
    throw new Error('策略建议队列任务缺少必要参数')
  }

  if (kind === 'review_recommendation') {
    await reviewStrategyRecommendationEffect({
      userId,
      recommendationId,
      force: false,
    })
    return { success: true }
  }

  const executed = await executeStrategyRecommendation({
    userId,
    recommendationId,
    confirm: task.data?.confirm === true,
    queueTaskId: task.id,
  })

  const reviewWindowDays = Math.max(1, Math.floor(Number(executed.data?.impactWindowDays || 3)))
  const scheduledAt = new Date(Date.now() + reviewWindowDays * 24 * 60 * 60 * 1000).toISOString()
  try {
    await assertUserExecutionAllowed(userId, {
      source: `openclaw-strategy:post-review-enqueue:${task.id}`,
    })
    const queue = getQueueManagerForTaskType('openclaw-strategy')
    const reviewTaskId = await queue.enqueue(
      'openclaw-strategy',
      {
        userId,
        mode: 'manual',
        trigger: 'strategy_recommendation_review',
        kind: 'review_recommendation',
        recommendationId,
        scheduledAt,
      } satisfies StrategyRecommendationQueueTaskData,
      userId,
      {
        priority: 'low',
        maxRetries: 0,
        parentRequestId: task.parentRequestId,
      }
    )

    await markStrategyRecommendationReviewQueued({
      userId,
      recommendationId,
      taskId: reviewTaskId,
      scheduledAt,
    })
  } catch (error: any) {
    console.warn(
      `[OpenClawStrategy] post-review queue schedule failed: recommendationId=${recommendationId}, error=${error?.message || error}`
    )
  }

  return { success: true }
}

async function executeStrategyRecommendationAnalyzeTask(
  task: Task<OpenclawStrategyTaskData>
): Promise<{ success: boolean; skipped?: boolean }> {
  const userId = Number(task.data?.userId || task.userId)
  await assertUserExecutionAllowed(userId, { source: `openclaw-strategy:${task.id}:analyze` })
  const db = await getDatabase()
  const userAccess = await db.queryOne<{ strategy_center_enabled: boolean | number }>(
    'SELECT strategy_center_enabled FROM users WHERE id = ?',
    [userId]
  )
  const strategyCenterEnabled = userAccess
    ? (userAccess.strategy_center_enabled as any) === true ||
      (userAccess.strategy_center_enabled as any) === 1
    : false
  if (!strategyCenterEnabled) {
    return { success: true, skipped: true }
  }

  const config = await getOpenclawStrategyConfig(userId)
  if (!config.enabled) {
    return { success: true, skipped: true }
  }

  const reportDate = normalizeOpenclawReportDate(
    String(task.data?.reportDate || formatLocalDate(new Date())).trim()
  )
  const limit = normalizeRecommendationLimit(task.data?.limit, 100)
  await getStrategyRecommendations({
    userId,
    reportDate,
    forceRefresh: true,
    limit,
  })

  const report = await refreshOpenclawDailyReportSnapshot({
    userId,
    date: reportDate,
  })

  const shouldSendReport = task.data?.sendReport !== false
  if (shouldSendReport) {
    try {
      await assertUserExecutionAllowed(userId, {
        source: `openclaw-strategy:report-enqueue:${task.id}`,
      })
      const settings = await getOpenclawSettingsMap(userId)
      const feishuTarget = String(settings.feishu_target || '').trim() || undefined
      const queue = getQueueManagerForTaskType('openclaw-report-send')
      await queue.initialize()
      await queue.enqueue(
        'openclaw-report-send',
        {
          userId,
          target: feishuTarget,
          date: report.date,
          trigger: 'cron',
        },
        userId,
        {
          priority: 'high',
          maxRetries: 1,
          taskId: `openclaw-report-send-cron:${userId}:${report.date}`,
          parentRequestId: task.parentRequestId || undefined,
        }
      )
    } catch (error: any) {
      console.warn(
        `[OpenClawStrategy] recommendation report enqueue failed: userId=${userId}, date=${report.date}, error=${error?.message || error}`
      )
    }
  }

  return { success: true }
}

export async function executeOpenclawStrategy(
  task: Task<OpenclawStrategyTaskData>
): Promise<{ success: boolean; runId?: string; skipped?: boolean }> {
  if (isStrategyRecommendationTaskData(task.data)) {
    return executeStrategyRecommendationTask(
      task as Task<OpenclawStrategyTaskData & StrategyRecommendationQueueTaskData>
    )
  }

  const recommendationId = String(task.data?.recommendationId || '').trim()
  if (recommendationId) {
    throw new Error('策略建议任务 kind 非法，无法执行')
  }

  return executeStrategyRecommendationAnalyzeTask(task)
}
