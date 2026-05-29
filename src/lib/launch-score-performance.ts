import { getDatabase } from './db'
import type { LaunchScore } from './launch-scores'

/**
 * Launch Score性能数据集成
 *
 * 将Launch Score的AI预测与实际Google Ads表现数据进行对比分析
 */

export interface PerformanceData {
  totalImpressions: number
  totalClicks: number
  totalConversions: number
  /** 广告账户原始币种下的总花费 */
  totalCost: number
  costCurrency: string
  /** 点击率，0–1 小数（如 0.025 = 2.5%） */
  avgCtr: number
  /** 每次点击成本（与 costCurrency 一致） */
  avgCpc: number
  /** 转化率，0–1 小数 */
  conversionRate: number
  actualRoi: number | null
  dateRange: {
    start: string
    end: string
    days: number
  }
}

export interface PredictionComparison {
  metric: string
  predicted: number | string
  actual: number | string
  accuracy: number | null // 准确度百分比 (null表示无法计算)
  variance: string // 差异描述
}

export interface PerformanceEnhancedAnalysis {
  launchScore: LaunchScore
  performanceData: PerformanceData | null
  comparisons: PredictionComparison[]
  adjustedRecommendations: string[]
}

function formatPerformanceMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.length === 3 ? currency : 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

/** GET launch-score / performance 接口共用的性能对比载荷（不含 accuracyScore） */
export type LaunchScorePerformanceApiPayload = {
  hasPerformanceData: boolean
  performanceData: PerformanceData | null
  comparisons: PredictionComparison[]
  adjustedRecommendations: string[]
  message?: string
}

/** 基于已解析的 Launch Score 构建 performance 载荷（不再 readLaunchScoreForCreative） */
export async function buildLaunchScorePerformanceApiPayload(
  launchScore: LaunchScore,
  userId: number,
  daysBack: number = 30,
  avgOrderValue?: number
): Promise<LaunchScorePerformanceApiPayload> {
  const enhanced = await getPerformanceEnhancedAnalysis(
    launchScore,
    userId,
    daysBack,
    avgOrderValue
  )
  return toLaunchScorePerformanceApiPayload(enhanced)
}

export function toLaunchScorePerformanceApiPayload(
  enhanced: PerformanceEnhancedAnalysis
): LaunchScorePerformanceApiPayload {
  const hasPerformanceData = enhanced.performanceData !== null
  return {
    hasPerformanceData,
    performanceData: enhanced.performanceData,
    comparisons: enhanced.comparisons,
    adjustedRecommendations: enhanced.adjustedRecommendations,
    ...(!hasPerformanceData && enhanced.adjustedRecommendations[0]
      ? { message: enhanced.adjustedRecommendations[0] }
      : {}),
  }
}

/**
 * 获取Offer的实际性能数据（使用 campaign_performance）
 */
export async function getPerformanceDataForOffer(
  offerId: number,
  userId: number,
  daysBack: number = 30
): Promise<PerformanceData | null> {
  const db = await getDatabase()

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysBack)
  const cutoffDateStr = cutoffDate.toISOString().split('T')[0]
  const today = new Date().toISOString().split('T')[0]

  const result = await db.queryOne(`
    SELECT
      SUM(cp.impressions) as total_impressions,
      SUM(cp.clicks) as total_clicks,
      SUM(cp.conversions) as total_conversions,
      SUM(cp.cost) as total_cost,
      COALESCE(MAX(cp.currency), MAX(gaa.currency), 'CNY') as cost_currency,
      CASE
        WHEN SUM(cp.impressions) > 0 THEN SUM(cp.clicks) * 100.0 / SUM(cp.impressions)
        ELSE 0
      END as avg_ctr,
      CASE
        WHEN SUM(cp.clicks) > 0 THEN SUM(cp.conversions) * 100.0 / SUM(cp.clicks)
        ELSE 0
      END as avg_conversion_rate
    FROM campaigns c
    LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
    LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
    WHERE c.offer_id = ?
      AND c.user_id = ?
      AND cp.date >= ?
      AND cp.date <= ?
  `, [offerId, userId, cutoffDateStr, today]) as any

  if (!result || result.total_impressions === null || result.total_impressions === 0) {
    return null // 没有性能数据
  }

  const totalCost = Number(result.total_cost) || 0
  const costCurrency = String(result.cost_currency || 'CNY')
  const avgCpc = result.total_clicks > 0
    ? totalCost / result.total_clicks
    : 0

  // SQL 返回百分比 (0–100)，下游阈值/展示统一用小数比率 (0–1)
  const avgCtrPercent = Number(result.avg_ctr) || 0
  const conversionRatePercent = Number(result.avg_conversion_rate) || 0

  const actualRoi = null

  return {
    totalImpressions: result.total_impressions || 0,
    totalClicks: result.total_clicks || 0,
    totalConversions: result.total_conversions || 0,
    totalCost: Math.round(totalCost * 100) / 100,
    costCurrency,
    avgCtr: avgCtrPercent / 100,
    avgCpc: Math.round(avgCpc * 100) / 100,
    conversionRate: conversionRatePercent / 100,
    actualRoi,
    dateRange: {
      start: cutoffDateStr,
      end: today,
      days: daysBack
    }
  }
}

/**
 * 对比Launch Score预测与实际表现 (v4.0 - 4维度)
 */
export function comparePredictionVsActual(
  launchScore: LaunchScore,
  performanceData: PerformanceData | null,
  avgOrderValue?: number
): PredictionComparison[] {
  const comparisons: PredictionComparison[] = []

  // 如果没有性能数据，返回空比较
  if (!performanceData) {
    comparisons.push({
      metric: 'CTR (点击率)',
      predicted: '未预测',
      actual: '暂无数据',
      accuracy: null,
      variance: '等待数据同步'
    })
    comparisons.push({
      metric: '转化率',
      predicted: '未预测',
      actual: '暂无数据',
      accuracy: null,
      variance: '等待数据同步'
    })
    comparisons.push({
      metric: 'CPC (每次点击成本)',
      predicted: '未预测',
      actual: '暂无数据',
      accuracy: null,
      variance: '等待数据同步'
    })
    return comparisons
  }

  const avgCtr = performanceData.avgCtr || 0
  const conversionRate = performanceData.conversionRate || 0
  const avgCpc = performanceData.avgCpc || 0
  const costCurrency = performanceData.costCurrency || 'CNY'

  comparisons.push({
    metric: 'CTR (点击率)',
    predicted: '—',
    actual: `${(avgCtr * 100).toFixed(2)}%`,
    accuracy: null,
    variance: 'Google Ads 实际数据',
  })

  comparisons.push({
    metric: '转化率 (Ads)',
    predicted: '—',
    actual: `${(conversionRate * 100).toFixed(2)}%`,
    accuracy: null,
    variance: 'Google Ads 转化，非佣金归因',
  })

  comparisons.push({
    metric: 'CPC (每次点击成本)',
    predicted: '—',
    actual: formatPerformanceMoney(avgCpc, costCurrency),
    accuracy: null,
    variance: 'Google Ads 实际数据',
  })

  // 4. ROI对比 (如果提供了平均订单价值)
  if (avgOrderValue && avgOrderValue > 0) {
    const revenue = performanceData.totalConversions * avgOrderValue
    const actualRoi = performanceData.totalCost > 0
      ? ((revenue - performanceData.totalCost) / performanceData.totalCost) * 100
      : 0

    comparisons.push({
      metric: 'ROI (投资回报率)',
      predicted: '—',
      actual: `${actualRoi.toFixed(1)}%`,
      accuracy: null,
      variance: '基于平均订单价值估算',
    })
  }

  comparisons.push({
    metric: '展示次数',
    predicted: '—',
    actual: performanceData.totalImpressions.toLocaleString(),
    accuracy: null,
    variance: 'Google Ads 实际数据',
  })

  comparisons.push({
    metric: '点击次数',
    predicted: '—',
    actual: performanceData.totalClicks.toLocaleString(),
    accuracy: null,
    variance: 'Google Ads 实际数据',
  })

  comparisons.push({
    metric: '转化次数 (Ads)',
    predicted: '—',
    actual: performanceData.totalConversions.toFixed(1),
    accuracy: null,
    variance: '非 Offer 佣金口径',
  })

  comparisons.push({
    metric: '总花费',
    predicted: '—',
    actual: formatPerformanceMoney(
      Number(performanceData.totalCost) || 0,
      costCurrency
    ),
    accuracy: null,
    variance: '广告账户原始币种',
  })

  return comparisons
}

/**
 * 生成基于实际表现的调整建议 (v4.0 - 4维度)
 */
export function generatePerformanceAdjustedRecommendations(
  launchScore: LaunchScore,
  performanceData: PerformanceData,
  comparisons: PredictionComparison[]
): string[] {
  const recommendations: string[] = []

  // 1. CTR分析
  if (performanceData.avgCtr < 0.01) {
    recommendations.push(`📉 点击率过低 (${(performanceData.avgCtr * 100).toFixed(2)}%)，建议优化广告文案和标题吸引力`)
  } else if (performanceData.avgCtr > 0.05) {
    recommendations.push(`🎯 点击率表现优秀 (${(performanceData.avgCtr * 100).toFixed(2)}%)，继续保持创意质量`)
  }

  // 2. 转化率分析
  if (performanceData.conversionRate < 0.02) {
    recommendations.push(`🔧 转化率较低 (${(performanceData.conversionRate * 100).toFixed(2)}%)，建议检查着陆页体验和目标受众定位`)
  } else if (performanceData.conversionRate > 0.05) {
    recommendations.push(`🌟 转化率表现出色 (${(performanceData.conversionRate * 100).toFixed(2)}%)，可以考虑扩大预算规模`)
  }

  // 3. 预算使用分析
  if (performanceData.totalCost > 100) {
    const costPerConversion = performanceData.totalConversions > 0
      ? performanceData.totalCost / performanceData.totalConversions
      : 0

    if (costPerConversion > 0) {
      recommendations.push(
        `💰 每次转化成本: ${formatPerformanceMoney(costPerConversion, performanceData.costCurrency)}，请评估是否在可接受范围内`
      )
    }
  }

  if (performanceData.avgCtr < 0.02 && launchScore.adQualityScore < 20) {
    recommendations.push(`📝 低点击率可能与广告质量得分较低有关 (${launchScore.adQualityScore}/30)，建议重新优化广告文案`)
  }

  if (performanceData.avgCpc > 3 && launchScore.keywordStrategyScore < 15) {
    recommendations.push(`🔑 高CPC可能与关键词策略得分较低有关 (${launchScore.keywordStrategyScore}/20)，建议优化关键词相关性`)
  }

  // 如果没有生成任何建议，添加默认建议
  if (recommendations.length === 0) {
    recommendations.push(`✅ 整体表现符合预期，继续监控并根据数据反馈进行优化`)
  }

  return recommendations
}

/**
 * 获取性能增强的Launch Score分析
 */
export async function getPerformanceEnhancedAnalysis(
  launchScore: LaunchScore,
  userId: number,
  daysBack: number = 30,
  avgOrderValue?: number
): Promise<PerformanceEnhancedAnalysis> {
  // 获取实际性能数据
  const performanceData = await getPerformanceDataForOffer(
    launchScore.offerId,
    userId,
    daysBack
  )

  if (!performanceData) {
    return {
      launchScore,
      performanceData: null,
      comparisons: [],
      adjustedRecommendations: ['暂无实际投放数据，无法进行对比分析。请先投放广告后查看此功能。'],
    }
  }

  const comparisons = comparePredictionVsActual(launchScore, performanceData, avgOrderValue)
  const adjustedRecommendations = generatePerformanceAdjustedRecommendations(
    launchScore,
    performanceData,
    comparisons
  )

  return {
    launchScore,
    performanceData,
    comparisons,
    adjustedRecommendations,
  }
}
