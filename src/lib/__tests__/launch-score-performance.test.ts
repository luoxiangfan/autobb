import { describe, expect, it } from 'vitest'
import {
  comparePredictionVsActual,
  generatePerformanceAdjustedRecommendations,
  toLaunchScorePerformanceApiPayload,
  type PerformanceData,
} from '../launch-score-performance'
import type { LaunchScore } from '../launch-scores'

function scoreRow(overrides: Partial<LaunchScore>): LaunchScore {
  return {
    id: 1,
    userId: 1,
    offerId: 10,
    totalScore: 80,
    launchViabilityScore: 30,
    adQualityScore: 25,
    keywordStrategyScore: 15,
    basicConfigScore: 10,
    launchViabilityData: null,
    adQualityData: null,
    keywordStrategyData: null,
    basicConfigData: null,
    recommendations: null,
    calculatedAt: '2026-01-01T00:00:00.000Z',
    adCreativeId: 99,
    issues: null,
    suggestions: null,
    contentHash: null,
    campaignConfigHash: null,
    ...overrides,
  }
}

const performanceSample: PerformanceData = {
  totalImpressions: 10_000,
  totalClicks: 250,
  totalConversions: 12,
  totalCost: 120.5,
  costCurrency: 'CNY',
  avgCtr: 0.025,
  avgCpc: 0.48,
  conversionRate: 0.048,
  actualRoi: null,
  dateRange: { start: '2026-01-01', end: '2026-01-31', days: 30 },
}

describe('comparePredictionVsActual', () => {
  it('formats CTR and conversion rate as percent from ratio', () => {
    const comparisons = comparePredictionVsActual(scoreRow({}), performanceSample)
    const ctr = comparisons.find((c) => c.metric.includes('CTR'))
    const cvr = comparisons.find((c) => c.metric.includes('转化率'))
    expect(ctr?.actual).toBe('2.50%')
    expect(cvr?.actual).toBe('4.80%')
  })

  it('formats cost with account currency', () => {
    const comparisons = comparePredictionVsActual(scoreRow({}), performanceSample)
    const spend = comparisons.find((c) => c.metric.includes('总花费'))
    expect(spend?.actual).toContain('120.50')
    expect(spend?.variance).toContain('原始币种')
  })
})

describe('toLaunchScorePerformanceApiPayload', () => {
  it('does not expose accuracyScore', () => {
    const payload = toLaunchScorePerformanceApiPayload({
      launchScore: scoreRow({}),
      performanceData: performanceSample,
      comparisons: [],
      adjustedRecommendations: ['ok'],
    })
    expect(payload).not.toHaveProperty('accuracyScore')
    expect(payload.hasPerformanceData).toBe(true)
  })
})

describe('generatePerformanceAdjustedRecommendations', () => {
  it('flags low CTR when ratio is below 1%', () => {
    const lowCtr: PerformanceData = {
      ...performanceSample,
      avgCtr: 0.005,
      conversionRate: 0.03,
    }
    const recs = generatePerformanceAdjustedRecommendations(
      scoreRow({ adQualityScore: 10 }),
      lowCtr,
      []
    )
    expect(recs.some((r) => r.includes('点击率过低'))).toBe(true)
    expect(recs.some((r) => r.includes('0.50%'))).toBe(true)
  })

  it('flags strong CTR when ratio is above 5%', () => {
    const highCtr: PerformanceData = {
      ...performanceSample,
      avgCtr: 0.06,
    }
    const recs = generatePerformanceAdjustedRecommendations(scoreRow({}), highCtr, [])
    expect(recs.some((r) => r.includes('点击率表现优秀'))).toBe(true)
    expect(recs.some((r) => r.includes('6.00%'))).toBe(true)
  })
})
