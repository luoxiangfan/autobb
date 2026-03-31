/**
 * Bonus Score Calculator
 * 基于实际广告效果计算20分加分
 */

import { getDatabase } from './db'
import { getIndustryBenchmark, IndustryBenchmark } from './industry-classifier'

export interface PerformanceData {
  clicks: number
  ctr: number
  cpc: number
  conversions: number
  conversionRate: number
}

export interface BonusScoreBreakdown {
  clicks: { score: number; value: number; benchmark: number; comparison: string }
  ctr: { score: number; value: number; benchmark: number; comparison: string }
  cpc: { score: number; value: number; benchmark: number; comparison: string }
  conversions: { score: number; value: number; benchmark: number; comparison: string }
}

export interface BonusScoreResult {
  totalBonus: number
  breakdown: BonusScoreBreakdown
  minClicksReached: boolean
  industryCode: string
  industryLabel: string
}

const MIN_CLICKS_THRESHOLD = 100

/**
 * 计算加分（0-20分）
 */
export async function calculateBonusScore(
  performance: PerformanceData,
  industryCode: string
): Promise<BonusScoreResult> {
  const benchmark = await getIndustryBenchmark(industryCode)

  if (!benchmark) {
    throw new Error(`Industry benchmark not found: ${industryCode}`)
  }

  const minClicksReached = performance.clicks >= MIN_CLICKS_THRESHOLD

  // 如果未达到最低点击数，返回0分
  if (!minClicksReached) {
    return {
      totalBonus: 0,
      breakdown: {
        clicks: { score: 0, value: performance.clicks, benchmark: MIN_CLICKS_THRESHOLD, comparison: 'insufficient_data' },
        ctr: { score: 0, value: performance.ctr, benchmark: benchmark.avg_ctr, comparison: 'insufficient_data' },
        cpc: { score: 0, value: performance.cpc, benchmark: benchmark.avg_cpc, comparison: 'insufficient_data' },
        conversions: { score: 0, value: performance.conversions, benchmark: 0, comparison: 'insufficient_data' }
      },
      minClicksReached: false,
      industryCode,
      industryLabel: `${benchmark.industry_l1} > ${benchmark.industry_l2}`
    }
  }

  // 计算各项得分（每项0-5分）
  const clicksScore = calculateClicksScore(performance.clicks)
  const ctrScore = calculateCtrScore(performance.ctr, benchmark.avg_ctr)
  const cpcScore = calculateCpcScore(performance.cpc, benchmark.avg_cpc)
  const conversionsScore = calculateConversionsScore(performance.conversionRate, benchmark.avg_conversion_rate)

  const totalBonus = clicksScore.score + ctrScore.score + cpcScore.score + conversionsScore.score

  return {
    totalBonus,
    breakdown: {
      clicks: clicksScore,
      ctr: ctrScore,
      cpc: cpcScore,
      conversions: conversionsScore
    },
    minClicksReached: true,
    industryCode,
    industryLabel: `${benchmark.industry_l1} > ${benchmark.industry_l2}`
  }
}

/**
 * 点击数得分（0-5分）
 * 基于绝对数量，越多越好
 */
function calculateClicksScore(clicks: number): BonusScoreBreakdown['clicks'] {
  let score: number
  let comparison: string

  if (clicks >= 1000) {
    score = 5
    comparison = 'excellent'
  } else if (clicks >= 500) {
    score = 4
    comparison = 'good'
  } else if (clicks >= 300) {
    score = 3
    comparison = 'average'
  } else if (clicks >= 200) {
    score = 2
    comparison = 'below_average'
  } else {
    score = 1
    comparison = 'low'
  }

  return {
    score,
    value: clicks,
    benchmark: 500, // 中位数基准
    comparison
  }
}

/**
 * CTR得分（0-5分）
 * 与行业基准比较，高于基准得分更高
 */
function calculateCtrScore(ctr: number, benchmarkCtr: number): BonusScoreBreakdown['ctr'] {
  const ratio = ctr / benchmarkCtr
  let score: number
  let comparison: string

  if (ratio >= 1.5) {
    score = 5
    comparison = 'excellent'
  } else if (ratio >= 1.2) {
    score = 4
    comparison = 'good'
  } else if (ratio >= 0.9) {
    score = 3
    comparison = 'average'
  } else if (ratio >= 0.7) {
    score = 2
    comparison = 'below_average'
  } else {
    score = 1
    comparison = 'low'
  }

  return {
    score,
    value: ctr,
    benchmark: benchmarkCtr,
    comparison
  }
}

/**
 * CPC得分（0-5分）
 * 与行业基准比较，低于基准得分更高（成本效率）
 */
function calculateCpcScore(cpc: number, benchmarkCpc: number): BonusScoreBreakdown['cpc'] {
  const ratio = cpc / benchmarkCpc
  let score: number
  let comparison: string

  // CPC是越低越好，所以ratio越小得分越高
  if (ratio <= 0.5) {
    score = 5
    comparison = 'excellent'
  } else if (ratio <= 0.7) {
    score = 4
    comparison = 'good'
  } else if (ratio <= 1.0) {
    score = 3
    comparison = 'average'
  } else if (ratio <= 1.3) {
    score = 2
    comparison = 'below_average'
  } else {
    score = 1
    comparison = 'high'
  }

  return {
    score,
    value: cpc,
    benchmark: benchmarkCpc,
    comparison
  }
}

/**
 * 转化得分（0-5分）
 * 与行业基准比较，高于基准得分更高
 */
function calculateConversionsScore(conversionRate: number, benchmarkRate: number): BonusScoreBreakdown['conversions'] {
  const ratio = conversionRate / benchmarkRate
  let score: number
  let comparison: string

  if (ratio >= 1.5) {
    score = 5
    comparison = 'excellent'
  } else if (ratio >= 1.2) {
    score = 4
    comparison = 'good'
  } else if (ratio >= 0.9) {
    score = 3
    comparison = 'average'
  } else if (ratio >= 0.7) {
    score = 2
    comparison = 'below_average'
  } else {
    score = 1
    comparison = 'low'
  }

  return {
    score,
    value: conversionRate,
    benchmark: benchmarkRate,
    comparison
  }
}

/**
 * 保存广告创意效果数据和加分
 */
export async function saveCreativePerformance(
  adCreativeId: number,
  offerId: number,
  userId: string,
  performance: PerformanceData,
  industryCode: string,
  syncDate: string
): Promise<BonusScoreResult> {
  const db = await getDatabase()

  // 计算加分
  const bonusResult = await calculateBonusScore(performance, industryCode)

  // 插入或更新效果数据
  await db.exec(`
    INSERT INTO ad_creative_performance (
      ad_creative_id, offer_id, user_id,
      impressions, clicks, ctr, cost, cpc,
      conversions, conversion_rate, conversion_value,
      industry_code, bonus_score, bonus_breakdown, min_clicks_reached,
      sync_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ad_creative_id, sync_date) DO UPDATE SET
      impressions = excluded.impressions,
      clicks = excluded.clicks,
      ctr = excluded.ctr,
      cost = excluded.cost,
      cpc = excluded.cpc,
      conversions = excluded.conversions,
      conversion_rate = excluded.conversion_rate,
      bonus_score = excluded.bonus_score,
      bonus_breakdown = excluded.bonus_breakdown,
      min_clicks_reached = excluded.min_clicks_reached,
      updated_at = CURRENT_TIMESTAMP
  `, [
    adCreativeId,
    offerId,
    userId,
    0, // impressions - will be synced from Google Ads
    performance.clicks,
    performance.ctr,
    0, // cost - will be synced from Google Ads
    performance.cpc,
    performance.conversions,
    performance.conversionRate,
    0, // conversion_value - will be from user feedback
    industryCode,
    bonusResult.totalBonus,
    JSON.stringify(bonusResult.breakdown),
    bonusResult.minClicksReached ? 1 : 0,
    syncDate
  ])

  return bonusResult
}

/**
 * 获取广告创意的最新效果数据
 */
export async function getCreativePerformance(adCreativeId: number): Promise<{
  performance: PerformanceData
  bonusScore: BonusScoreResult
  syncDate: string
} | null> {
  const db = await getDatabase()

  const row = await db.queryOne(`
    SELECT
      clicks, ctr, cpc, conversions, conversion_rate,
      bonus_score, bonus_breakdown, min_clicks_reached,
      industry_code, sync_date
    FROM ad_creative_performance
    WHERE ad_creative_id = ?
    ORDER BY sync_date DESC
    LIMIT 1
  `, [adCreativeId])

  if (!row) {
    return null
  }

  const benchmark = await getIndustryBenchmark(row.industry_code)

  return {
    performance: {
      clicks: row.clicks,
      ctr: row.ctr,
      cpc: row.cpc,
      conversions: row.conversions,
      conversionRate: row.conversion_rate
    },
    bonusScore: {
      totalBonus: row.bonus_score,
      breakdown: JSON.parse(row.bonus_breakdown || '{}'),
      minClicksReached: !!row.min_clicks_reached,
      industryCode: row.industry_code,
      industryLabel: benchmark ? `${benchmark.industry_l1} > ${benchmark.industry_l2}` : row.industry_code
    },
    syncDate: row.sync_date
  }
}

/**
 * 获取用户所有创意的加分统计
 */
export async function getUserBonusStats(userId: string): Promise<{
  totalCreatives: number
  creativesWithBonus: number
  averageBonus: number
  topPerformers: { adCreativeId: number; bonusScore: number; industryLabel: string }[]
}> {
  const db = await getDatabase()

  const stats = await db.queryOne(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN min_clicks_reached = 1 THEN 1 ELSE 0 END) as with_bonus,
      AVG(CASE WHEN min_clicks_reached = 1 THEN bonus_score ELSE NULL END) as avg_bonus
    FROM ad_creative_performance
    WHERE user_id = ?
  `, [userId])

  const topPerformers = await db.query(`
    SELECT
      acp.ad_creative_id,
      acp.bonus_score,
      ib.industry_l1 || ' > ' || ib.industry_l2 as industry_label
    FROM ad_creative_performance acp
    JOIN industry_benchmarks ib ON acp.industry_code = ib.industry_code
    WHERE acp.user_id = ? AND acp.min_clicks_reached = 1
    ORDER BY acp.bonus_score DESC
    LIMIT 5
  `, [userId])

  return {
    totalCreatives: stats?.total || 0,
    creativesWithBonus: stats?.with_bonus || 0,
    averageBonus: stats?.avg_bonus ? Math.round(stats.avg_bonus * 10) / 10 : 0,
    topPerformers: topPerformers.map(p => ({
      adCreativeId: p.ad_creative_id,
      bonusScore: p.bonus_score,
      industryLabel: p.industry_label
    }))
  }
}
