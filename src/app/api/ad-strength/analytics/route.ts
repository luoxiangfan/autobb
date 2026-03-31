import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { getInsertedId } from '@/lib/db-helpers'
import { toNumber } from '@/lib/utils'

/**
 * GET /api/ad-strength/analytics
 * 获取Ad Strength与实际转化效果的统计分析
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const days = parseInt(searchParams.get('days') || '30')
    const offerId = searchParams.get('offerId')

    const db = await getDatabase()

    // 1. 各评级的平均转化率
    const ratingPerformance = await db.query(`
      SELECT
        rating,
        COUNT(*) as count,
        AVG(overall_score) as avg_score,
        AVG(ctr) as avg_ctr,
        AVG(cvr) as avg_cvr,
        AVG(cpc) as avg_cpc,
        SUM(impressions) as total_impressions,
        SUM(clicks) as total_clicks,
        SUM(conversions) as total_conversions,
        SUM(cost) as total_cost
      FROM ad_strength_history
      WHERE user_id = ?
        AND evaluated_at >= datetime('now', '-' || ? || ' days')
        ${offerId ? 'AND offer_id = ?' : ''}
      GROUP BY rating
      ORDER BY
        CASE rating
          WHEN 'EXCELLENT' THEN 1
          WHEN 'GOOD' THEN 2
          WHEN 'AVERAGE' THEN 3
          WHEN 'POOR' THEN 4
          ELSE 5
        END
    `, [offerId ? [userId, days, offerId] : [userId, days]])

    // 2. 评分与转化率的相关性
    const scoreCorrelation = await db.query(`
      SELECT
        CASE
          WHEN overall_score >= 90 THEN '90-100'
          WHEN overall_score >= 80 THEN '80-89'
          WHEN overall_score >= 70 THEN '70-79'
          WHEN overall_score >= 60 THEN '60-69'
          ELSE '0-59'
        END as score_range,
        COUNT(*) as count,
        AVG(ctr) as avg_ctr,
        AVG(cvr) as avg_cvr
      FROM ad_strength_history
      WHERE user_id = ?
        AND evaluated_at >= datetime('now', '-' || ? || ' days')
        AND impressions > 100
      GROUP BY score_range
      ORDER BY score_range DESC
    `, [[userId, days]])

    // 3. 各维度对转化率的影响
    const dimensionImpact = await db.query(`
      SELECT
        'diversity' as dimension,
        CASE
          WHEN diversity_score >= 20 THEN 'high'
          WHEN diversity_score >= 15 THEN 'medium'
          ELSE 'low'
        END as level,
        AVG(cvr) as avg_cvr,
        COUNT(*) as count
      FROM ad_strength_history
      WHERE user_id = ? AND impressions > 100
      GROUP BY level

      UNION ALL

      SELECT
        'relevance' as dimension,
        CASE
          WHEN relevance_score >= 20 THEN 'high'
          WHEN relevance_score >= 15 THEN 'medium'
          ELSE 'low'
        END as level,
        AVG(cvr) as avg_cvr,
        COUNT(*) as count
      FROM ad_strength_history
      WHERE user_id = ? AND impressions > 100
      GROUP BY level

      UNION ALL

      SELECT
        'quality' as dimension,
        CASE
          WHEN quality_score >= 16 THEN 'high'
          WHEN quality_score >= 12 THEN 'medium'
          ELSE 'low'
        END as level,
        AVG(cvr) as avg_cvr,
        COUNT(*) as count
      FROM ad_strength_history
      WHERE user_id = ? AND impressions > 100
      GROUP BY level
    `, [[userId, userId, userId]])

    // 4. 资产特征对转化的影响
    const featureImpact = await db.query(`
      SELECT
        'has_numbers' as feature,
        has_numbers as has_feature,
        AVG(cvr) as avg_cvr,
        COUNT(*) as count
      FROM ad_strength_history
      WHERE user_id = ? AND impressions > 100
      GROUP BY has_numbers

      UNION ALL

      SELECT
        'has_cta' as feature,
        has_cta as has_feature,
        AVG(cvr) as avg_cvr,
        COUNT(*) as count
      FROM ad_strength_history
      WHERE user_id = ? AND impressions > 100
      GROUP BY has_cta

      UNION ALL

      SELECT
        'has_urgency' as feature,
        has_urgency as has_feature,
        AVG(cvr) as avg_cvr,
        COUNT(*) as count
      FROM ad_strength_history
      WHERE user_id = ? AND impressions > 100
      GROUP BY has_urgency
    `, [[userId, userId, userId]])

    // 5. 时间趋势（按周）
    const weeklyTrend = await db.query(`
      SELECT
        strftime('%Y-%W', evaluated_at) as week,
        COUNT(*) as count,
        AVG(overall_score) as avg_score,
        AVG(cvr) as avg_cvr,
        SUM(conversions) as total_conversions
      FROM ad_strength_history
      WHERE user_id = ?
        AND evaluated_at >= datetime('now', '-' || ? || ' days')
      GROUP BY week
      ORDER BY week
    `, [[userId, days]])

    // 6. 计算关键洞察
    const insights = generateInsights(ratingPerformance, scoreCorrelation, featureImpact)

    return NextResponse.json({
      success: true,
      analytics: {
        ratingPerformance,
        scoreCorrelation,
        dimensionImpact,
        featureImpact,
        weeklyTrend
      },
      insights,
      metadata: {
        userId: parseInt(userId),
        dateRange: `${days}天`,
        offerId: offerId || null,
        generatedAt: new Date().toISOString()
      }
    })
  } catch (error: any) {
    console.error('获取Ad Strength分析失败:', error)
    return NextResponse.json(
      { error: error.message || '获取分析失败' },
      { status: 500 }
    )
  }
}

/**
 * 生成关键洞察
 */
function generateInsights(
  ratingPerformance: any[],
  scoreCorrelation: any[],
  featureImpact: any[]
): string[] {
  const insights: string[] = []

  // 评级与转化率洞察
  const excellent = ratingPerformance.find(r => r.rating === 'EXCELLENT')
  const good = ratingPerformance.find(r => r.rating === 'GOOD')
  const average = ratingPerformance.find(r => r.rating === 'AVERAGE')

  if (excellent && good) {
    const cvrDiff = parseFloat(((toNumber(excellent.avg_cvr) - toNumber(good.avg_cvr)) / toNumber(good.avg_cvr) * 100).toFixed(1))
    if (cvrDiff > 0) {
      insights.push(`EXCELLENT评级创意的转化率比GOOD高${cvrDiff}%`)
    }
  }

  if (excellent && average) {
    const cvrDiff = parseFloat(((toNumber(excellent.avg_cvr) - toNumber(average.avg_cvr)) / toNumber(average.avg_cvr) * 100).toFixed(1))
    if (cvrDiff > 0) {
      insights.push(`EXCELLENT评级创意的转化率比AVERAGE高${cvrDiff}%`)
    }
  }

  // 特征影响洞察
  const numbersImpact = featureImpact.filter(f => f.feature === 'has_numbers')
  const withNumbers = numbersImpact.find(f => f.has_feature === 1)
  const withoutNumbers = numbersImpact.find(f => f.has_feature === 0)

  if (withNumbers && withoutNumbers && toNumber(withNumbers.avg_cvr) > toNumber(withoutNumbers.avg_cvr)) {
    const diff = parseFloat(((toNumber(withNumbers.avg_cvr) - toNumber(withoutNumbers.avg_cvr)) / toNumber(withoutNumbers.avg_cvr) * 100).toFixed(1))
    insights.push(`包含数字的创意转化率提升${diff}%`)
  }

  const ctaImpact = featureImpact.filter(f => f.feature === 'has_cta')
  const withCTA = ctaImpact.find(f => f.has_feature === 1)
  const withoutCTA = ctaImpact.find(f => f.has_feature === 0)

  if (withCTA && withoutCTA && toNumber(withCTA.avg_cvr) > toNumber(withoutCTA.avg_cvr)) {
    const diff = parseFloat(((toNumber(withCTA.avg_cvr) - toNumber(withoutCTA.avg_cvr)) / toNumber(withoutCTA.avg_cvr) * 100).toFixed(1))
    insights.push(`包含CTA的创意转化率提升${diff}%`)
  }

  // 评分范围洞察
  const highScore = scoreCorrelation.find(s => s.score_range === '90-100')
  const midScore = scoreCorrelation.find(s => s.score_range === '70-79')

  if (highScore && midScore && toNumber(highScore.avg_cvr) > toNumber(midScore.avg_cvr)) {
    insights.push(`90分以上的创意表现显著优于70-79分`)
  }

  if (insights.length === 0) {
    insights.push('数据积累中，建议继续投放以获得更多洞察')
  }

  return insights
}

/**
 * POST /api/ad-strength/analytics
 * 记录新的Ad Strength评估结果（用于历史分析）
 */
export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()
    const {
      offerId,
      creativeId,
      campaignId,
      evaluation,
      creativeData
    } = body

    if (!offerId || !evaluation) {
      return NextResponse.json(
        { error: '缺少必要字段: offerId, evaluation' },
        { status: 400 }
      )
    }

    const db = await getDatabase()

    // 插入历史记录
    const result = await db.exec(`
      INSERT INTO ad_strength_history (
        user_id, offer_id, creative_id, campaign_id,
        rating, overall_score,
        diversity_score, relevance_score, completeness_score, quality_score, compliance_score,
        headlines_count, descriptions_count, keywords_count,
        has_numbers, has_cta, has_urgency,
        avg_headline_length, avg_description_length
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [[
      userId,
      offerId,
      creativeId || null,
      campaignId || null,
      evaluation.rating,
      evaluation.overallScore,
      evaluation.dimensions?.diversity?.score || 0,
      evaluation.dimensions?.relevance?.score || 0,
      evaluation.dimensions?.completeness?.score || 0,
      evaluation.dimensions?.quality?.score || 0,
      evaluation.dimensions?.compliance?.score || 0,
      creativeData?.headlines?.length || 0,
      creativeData?.descriptions?.length || 0,
      creativeData?.keywords?.length || 0,
      creativeData?.hasNumbers ? 1 : 0,
      creativeData?.hasCTA ? 1 : 0,
      creativeData?.hasUrgency ? 1 : 0,
      creativeData?.avgHeadlineLength || null,
      creativeData?.avgDescriptionLength || null
    ]])

    const historyId = getInsertedId(result, db.type)

    return NextResponse.json({
      success: true,
      historyId,
      message: 'Ad Strength历史记录已保存'
    })
  } catch (error: any) {
    console.error('保存Ad Strength历史失败:', error)
    return NextResponse.json(
      { error: error.message || '保存失败' },
      { status: 500 }
    )
  }
}
