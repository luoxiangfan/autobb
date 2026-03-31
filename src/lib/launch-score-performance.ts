import { getDatabase } from './db'
import type { LaunchScore, ScoreAnalysis } from './launch-scores'

/**
 * Launch Score性能数据集成
 *
 * 将Launch Score的AI预测与实际Google Ads表现数据进行对比分析
 */

export interface PerformanceData {
  totalImpressions: number
  totalClicks: number
  totalConversions: number
  totalCostUsd: number
  avgCtr: number
  avgCpcUsd: number
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
  accuracyScore: number // 整体预测准确度 (0-100)
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
      CASE
        WHEN SUM(cp.impressions) > 0 THEN SUM(cp.clicks) * 100.0 / SUM(cp.impressions)
        ELSE 0
      END as avg_ctr,
      CASE
        WHEN SUM(cp.clicks) > 0 THEN SUM(cp.conversions) * 100.0 / SUM(cp.clicks)
        ELSE 0
      END as avg_conversion_rate
    FROM campaigns c
    LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
    WHERE c.offer_id = ?
      AND c.user_id = ?
      AND cp.date >= ?
      AND cp.date <= ?
  `, [offerId, userId, cutoffDateStr, today]) as any

  if (!result || result.total_impressions === null || result.total_impressions === 0) {
    return null // 没有性能数据
  }

  const totalCostUsd = result.total_cost || 0
  const avgCpcUsd = result.total_clicks > 0
    ? totalCostUsd / result.total_clicks
    : 0

  // 计算实际ROI (需要假设平均订单价值)
  // 这里我们只返回null，实际ROI需要在API层面结合用户输入的平均订单价值计算
  const actualRoi = null

  return {
    totalImpressions: result.total_impressions || 0,
    totalClicks: result.total_clicks || 0,
    totalConversions: result.total_conversions || 0,
    totalCostUsd: Math.round(totalCostUsd * 100) / 100,
    avgCtr: result.avg_ctr || 0,
    avgCpcUsd: Math.round(avgCpcUsd * 100) / 100,
    conversionRate: result.avg_conversion_rate || 0,
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
  const avgCpcUsd = performanceData.avgCpcUsd || 0

  // v4.0 Launch Score不包含详细的CPC/ROI预测
  // 主要展示实际数据

  // 1. CTR对比 (Launch Score没有预测CTR，这里显示实际值)
  comparisons.push({
    metric: 'CTR (点击率)',
    predicted: '未预测',
    actual: `${(avgCtr * 100).toFixed(2)}%`,
    accuracy: null,
    variance: '实际表现数据'
  })

  // 2. 转化率对比
  comparisons.push({
    metric: '转化率',
    predicted: '未预测',
    actual: `${(conversionRate * 100).toFixed(2)}%`,
    accuracy: null,
    variance: '实际表现数据'
  })

  // 3. CPC对比
  comparisons.push({
    metric: 'CPC (每次点击成本)',
    predicted: '未预测',
    actual: `$${avgCpcUsd.toFixed(2)}`,
    accuracy: null,
    variance: '实际表现数据'
  })

  // 4. ROI对比 (如果提供了平均订单价值)
  if (avgOrderValue && avgOrderValue > 0) {
    const revenue = performanceData.totalConversions * avgOrderValue
    const actualRoi = performanceData.totalCostUsd > 0
      ? ((revenue - performanceData.totalCostUsd) / performanceData.totalCostUsd) * 100
      : 0

    comparisons.push({
      metric: 'ROI (投资回报率)',
      predicted: '未预测',
      actual: `${actualRoi.toFixed(1)}%`,
      accuracy: null,
      variance: '实际表现数据'
    })
  }

  // 5. 展示次数和点击次数 (实际值，无预测)
  comparisons.push({
    metric: '展示次数',
    predicted: '未预测',
    actual: performanceData.totalImpressions.toLocaleString(),
    accuracy: null,
    variance: '实际表现数据'
  })

  comparisons.push({
    metric: '点击次数',
    predicted: '未预测',
    actual: performanceData.totalClicks.toLocaleString(),
    accuracy: null,
    variance: '实际表现数据'
  })

  comparisons.push({
    metric: '转化次数',
    predicted: '未预测',
    actual: performanceData.totalConversions.toFixed(1),
    accuracy: null,
    variance: '实际表现数据'
  })

  comparisons.push({
    metric: '总花费',
    predicted: '未预测',
    actual: `$${(Number(performanceData.totalCostUsd) || 0).toFixed(2)}`,
    accuracy: null,
    variance: '实际表现数据'
  })

  return comparisons
}

/**
 * 计算整体预测准确度
 */
export function calculateOverallAccuracy(comparisons: PredictionComparison[]): number {
  const validAccuracies = comparisons
    .map(c => c.accuracy)
    .filter((a): a is number => a !== null)

  if (validAccuracies.length === 0) {
    return 0 // 没有可计算的准确度
  }

  const sum = validAccuracies.reduce((acc, val) => acc + val, 0)
  return Math.round(sum / validAccuracies.length)
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
  if (performanceData.totalCostUsd > 100) {
    const costPerConversion = performanceData.totalConversions > 0
      ? performanceData.totalCostUsd / performanceData.totalConversions
      : 0

    if (costPerConversion > 0) {
      recommendations.push(`💰 每次转化成本: $${costPerConversion.toFixed(2)}，请评估是否在可接受范围内`)
    }
  }

  // 4. 基于Launch Score维度的建议 (v4.0 - 4维度)
  if (performanceData.avgCtr < 0.02 && launchScore.adQualityScore < 20) {
    recommendations.push(`📝 低点击率可能与广告质量得分较低有关 (${launchScore.adQualityScore}/30)，建议重新优化广告文案`)
  }

  if (performanceData.avgCpcUsd > 3 && launchScore.keywordStrategyScore < 15) {
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
    // 没有性能数据，返回原始Launch Score
    return {
      launchScore,
      performanceData: null,
      comparisons: [],
      adjustedRecommendations: ['暂无实际投放数据，无法进行对比分析。请先投放广告后查看此功能。'],
      accuracyScore: 0
    }
  }

  // 对比预测与实际
  const comparisons = comparePredictionVsActual(launchScore, performanceData, avgOrderValue)

  // 计算整体准确度
  const accuracyScore = calculateOverallAccuracy(comparisons)

  // 生成调整后的建议
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
    accuracyScore
  }
}
