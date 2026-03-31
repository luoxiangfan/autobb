import { describe, expect, it } from 'vitest'

import {
  allocateBudgetsWithThompsonSampling,
  buildStrategyRunExplanations,
  calculateNextCpc,
  deriveAdaptiveStrategyConfig,
  deriveFailureGuardConfig,
  rankAsinItemsForExecution,
  scoreAsinItemForExecution,
  shouldTreatCampaignAsConflict,
} from '@/lib/queue/executors/openclaw-strategy-executor'
import { normalizeOpenclawStrategyConfig, type OpenclawStrategyConfig } from '@/lib/openclaw/strategy-config'

function baseConfig(): OpenclawStrategyConfig {
  return {
    enabled: true,
    cron: '0 9 * * *',
    maxOffersPerRun: 3,
    defaultBudget: 20,
    maxCpc: 1.2,
    minCpc: 0.1,
    dailyBudgetCap: 1000,
    dailySpendCap: 100,
    targetRoas: 1,
    priorityAsins: undefined,
    enableAutoPublish: true,
    enableAutoPause: true,
    enableAutoAdjustCpc: true,
    allowAffiliateFetch: true,
    enforceAutoadsOnly: true,
    dryRun: false,
  }
}

describe('openclaw strategy adaptive helpers', () => {
  it('calculateNextCpc 会在高ROAS时上调并受上限约束', () => {
    const next = calculateNextCpc({
      roas: 2,
      currentCpc: 1,
      minCpc: 0.1,
      maxCpc: 1.05,
      targetRoas: 1,
    })

    expect(next).toBe(1.05)
  })

  it('calculateNextCpc 会在低ROAS时下调并受下限约束', () => {
    const next = calculateNextCpc({
      roas: 0.2,
      currentCpc: 0.12,
      minCpc: 0.1,
      maxCpc: 1.2,
      targetRoas: 1,
    })

    expect(next).toBe(0.1)
  })

  it('normalizeOpenclawStrategyConfig 会强制执行预算与CPC约束', () => {
    const normalized = normalizeOpenclawStrategyConfig({
      ...baseConfig(),
      maxOffersPerRun: 0,
      defaultBudget: 999,
      dailyBudgetCap: 5000,
      dailySpendCap: 300,
      minCpc: 2,
      maxCpc: 0.5,
      targetRoas: 0,
      priorityAsins: ['b0test1234', 'B0TEST1234', 'bad asin'],
    })

    expect(normalized.maxOffersPerRun).toBe(1)
    expect(normalized.dailyBudgetCap).toBe(1000)
    expect(normalized.dailySpendCap).toBe(100)
    expect(normalized.defaultBudget).toBe(100)
    expect(normalized.minCpc).toBe(2)
    expect(normalized.maxCpc).toBe(2)
    expect(normalized.targetRoas).toBe(0.1)
    expect(normalized.priorityAsins).toEqual(['B0TEST1234'])
  })

  it('normalizeOpenclawStrategyConfig 会保留AutoAds强制开关', () => {
    const normalized = normalizeOpenclawStrategyConfig({
      ...baseConfig(),
      enforceAutoadsOnly: false,
    })

    expect(normalized.enforceAutoadsOnly).toBe(false)
  })

  it('scoreAsinItemForExecution 会偏好高成功率样本', () => {
    const bullish = scoreAsinItemForExecution({
      priority: 1,
      outcome: { published: 6, failed: 1, lastStatus: 'published' },
    })
    const bearish = scoreAsinItemForExecution({
      priority: 1,
      outcome: { published: 1, failed: 6, lastStatus: 'failed' },
    })

    expect(bullish).toBeGreaterThan(bearish)
  })

  it('scoreAsinItemForExecution 会为优先ASIN提供加分', () => {
    const normal = scoreAsinItemForExecution({
      priority: 1,
      outcome: { published: 2, failed: 1, lastStatus: 'published' },
      isPreferred: false,
    })
    const preferred = scoreAsinItemForExecution({
      priority: 1,
      outcome: { published: 2, failed: 1, lastStatus: 'published' },
      isPreferred: true,
    })

    expect(preferred).toBeGreaterThan(normal)
  })

  it('rankAsinItemsForExecution 会基于历史表现重排同优先级候选', () => {
    const items = [
      {
        id: 1,
        asin: 'A-1',
        brand: 'BrandA',
        priority: 1,
      },
      {
        id: 2,
        asin: 'B-1',
        brand: 'BrandB',
        priority: 1,
      },
    ] as any

    const ranked = rankAsinItemsForExecution(items, {
      byAsin: new Map([
        ['A-1', { published: 5, failed: 1, lastStatus: 'published' }],
        ['B-1', { published: 0, failed: 4, lastStatus: 'failed' }],
      ]),
      byBrand: new Map(),
    })

    expect(ranked[0].item.id).toBe(1)
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
    expect(ranked[0].signalSource).toBe('asin')
  })

  it('rankAsinItemsForExecution 会优先选择指定ASIN列表', () => {
    const items = [
      {
        id: 10,
        asin: 'PREFERRED-1',
        brand: 'BrandC',
        priority: 0,
      },
      {
        id: 11,
        asin: 'NORMAL-1',
        brand: 'BrandC',
        priority: 2,
      },
    ] as any

    const ranked = rankAsinItemsForExecution(items, {
      byAsin: new Map(),
      byBrand: new Map(),
    }, {
      priorityAsins: ['preferred-1'],
    })

    expect(ranked[0].item.asin).toBe('PREFERRED-1')
    expect(ranked[0].isPreferred).toBe(true)
  })

  it('shouldTreatCampaignAsConflict 会将未知品牌视为冲突', () => {
    const decision = shouldTreatCampaignAsConflict({
      campaignStatus: 'ENABLED',
      campaignBrand: '',
      targetBrand: 'BrandA',
    })

    expect(decision.conflict).toBe(true)
    expect(decision.unknownBrand).toBe(true)
  })

  it('shouldTreatCampaignAsConflict 会识别同品牌不冲突', () => {
    const decision = shouldTreatCampaignAsConflict({
      campaignStatus: 'ENABLED',
      campaignBrand: 'BrandA',
      targetBrand: 'BrandA',
    })

    expect(decision.conflict).toBe(false)
    expect(decision.unknownBrand).toBe(false)
  })

  it('deriveAdaptiveStrategyConfig 在高盈利样本下扩张', () => {
    const cfg = baseConfig()
    const { effectiveConfig, insight } = deriveAdaptiveStrategyConfig({
      config: cfg,
      knowledgeRows: [
        { summary_json: { roi: { totalCost: 20, totalRevenue: 30 } }, notes: null },
        { summary_json: { roi: { totalCost: 20, totalRevenue: 26 } }, notes: null },
        { summary_json: { roi: { totalCost: 20, totalRevenue: 24 } }, notes: null },
      ],
    })

    expect(insight.adjustment).toBe('expand')
    expect(effectiveConfig.maxOffersPerRun).toBe(4)
    expect(effectiveConfig.defaultBudget).toBe(22)
    expect(effectiveConfig.maxCpc).toBe(1.26)
  })

  it('deriveAdaptiveStrategyConfig 在低ROAS样本下收缩', () => {
    const cfg = baseConfig()
    const { effectiveConfig, insight } = deriveAdaptiveStrategyConfig({
      config: cfg,
      knowledgeRows: [
        { summary_json: { roi: { totalCost: 20, totalRevenue: 8 } }, notes: null },
        { summary_json: { roi: { totalCost: 20, totalRevenue: 10 } }, notes: null },
        { summary_json: { roi: { totalCost: 20, totalRevenue: 12 } }, notes: null },
      ],
    })

    expect(insight.adjustment).toBe('defensive')
    expect(effectiveConfig.maxOffersPerRun).toBe(2)
    expect(effectiveConfig.defaultBudget).toBe(16)
    expect(effectiveConfig.maxCpc).toBe(1.08)
  })

  it('deriveFailureGuardConfig 在高失败率下进入强防守', () => {
    const cfg = baseConfig()
    const { effectiveConfig, insight } = deriveFailureGuardConfig({
      config: cfg,
      runStats: [
        { publishSuccess: 0, publishFailed: 2, reason: 'publish_failure_stop_loss' },
        { publishSuccess: 1, publishFailed: 3, reason: 'publish_failure_stop_loss' },
      ],
    })

    expect(insight.guardLevel).toBe('strong')
    expect(insight.publishFailureRate).toBe(0.83)
    expect(effectiveConfig.maxOffersPerRun).toBe(1)
    expect(effectiveConfig.defaultBudget).toBe(15)
    expect(effectiveConfig.maxCpc).toBe(1.02)
  })

  it('deriveFailureGuardConfig 在样本不足时保持不变', () => {
    const cfg = baseConfig()
    const { effectiveConfig, insight } = deriveFailureGuardConfig({
      config: cfg,
      runStats: [{ publishSuccess: 1, publishFailed: 0, reason: null }],
    })

    expect(insight.guardLevel).toBe('insufficient_data')
    expect(effectiveConfig.maxOffersPerRun).toBe(cfg.maxOffersPerRun)
    expect(effectiveConfig.defaultBudget).toBe(cfg.defaultBudget)
    expect(effectiveConfig.maxCpc).toBe(cfg.maxCpc)
  })

  it('allocateBudgetsWithThompsonSampling 会按权重分配并受单臂上限约束', () => {
    const randomValues = [
      0.12, 0.31, 0.55, 0.91, 0.22, 0.44,
      0.66, 0.18, 0.73, 0.27, 0.49, 0.88,
    ]
    let randomIndex = 0
    const randomFn = () => {
      const value = randomValues[randomIndex % randomValues.length]
      randomIndex += 1
      return value
    }

    const allocation = allocateBudgetsWithThompsonSampling({
      totalBudget: 30,
      perCampaignCap: 12,
      randomFn,
      arms: [
        {
          itemId: 1,
          asin: 'A1',
          brand: 'BrandA',
          priority: 3,
          isPreferred: true,
          outcome: { published: 10, failed: 2 },
          signalSource: 'asin',
        },
        {
          itemId: 2,
          asin: 'B1',
          brand: 'BrandB',
          priority: 1,
          isPreferred: false,
          outcome: { published: 3, failed: 3 },
          signalSource: 'asin',
        },
        {
          itemId: 3,
          asin: 'C1',
          brand: 'BrandC',
          priority: 0,
          isPreferred: false,
          outcome: { published: 0, failed: 1 },
          signalSource: 'none',
        },
      ],
    })

    expect(allocation.method).toBe('thompson_sampling')
    expect(allocation.armCount).toBe(3)
    expect(allocation.allocatedBudget).toBeLessThanOrEqual(30)
    expect(allocation.arms.every((arm) => arm.assignedBudget <= 12)).toBe(true)
    expect(allocation.arms.some((arm) => arm.itemId === 1 && arm.assignedBudget > 0)).toBe(true)
  })

  it('buildStrategyRunExplanations 会输出发布/暂停/熔断解释结构', () => {
    const explanation = buildStrategyRunExplanations({
      run: {
        id: 'run-1',
        mode: 'auto',
        status: 'completed',
        runDate: '2026-02-07',
        startedAt: '2026-02-07T01:00:00.000Z',
        completedAt: '2026-02-07T01:05:00.000Z',
        createdAt: '2026-02-07T01:00:00.000Z',
        errorMessage: null,
        statsJson: {
          reason: 'daily_spend_cap',
          offersConsidered: 3,
          campaignsPublished: 1,
          campaignsPaused: 2,
          publishFailed: 1,
          skipped: 1,
          projectedSpend: 88,
          dailySpent: 80,
          adaptiveInsight: { adjustment: 'defensive' },
          failureGuardInsight: { guardLevel: 'mild', publishFailureRate: 0.5 },
          budgetAllocation: { method: 'thompson_sampling' },
          realtimeSpend: { hasRealtime: true },
          brandSnapshot: { accountCount: 1 },
          circuitBreak: { paused: 2 },
        },
      },
      actions: [
        {
          id: 1,
          actionType: 'publish_campaign',
          targetType: 'offer',
          targetId: '100',
          status: 'success',
          errorMessage: null,
          requestJson: {},
          responseJson: {},
          createdAt: '2026-02-07T01:01:00.000Z',
        },
        {
          id: 2,
          actionType: 'pause_campaign',
          targetType: 'campaign',
          targetId: '200',
          status: 'success',
          errorMessage: null,
          requestJson: { status: 'PAUSED' },
          responseJson: {},
          createdAt: '2026-02-07T01:02:00.000Z',
        },
        {
          id: 3,
          actionType: 'spend_cap_circuit_break',
          targetType: 'run',
          targetId: 'run-1',
          status: 'success',
          errorMessage: null,
          requestJson: { dailySpendCap: 100 },
          responseJson: { paused: 2 },
          createdAt: '2026-02-07T01:03:00.000Z',
        },
      ],
    })

    expect(explanation.summary.reason).toBe('daily_spend_cap')
    expect(explanation.explanations.publish.length).toBeGreaterThan(0)
    expect(explanation.explanations.pause.length).toBeGreaterThan(0)
    expect(explanation.explanations.circuitBreak.length).toBeGreaterThan(0)
    expect(explanation.actionTimeline).toHaveLength(3)
  })
})
