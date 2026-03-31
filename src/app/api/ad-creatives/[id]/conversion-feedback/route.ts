/**
 * Conversion Feedback API
 * 用户手动反馈广告转化数据
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { getInsertedId } from '@/lib/db-helpers'
import { calculateBonusScore, saveCreativePerformance } from '@/lib/bonus-score-calculator'
import { getIndustryBenchmark } from '@/lib/industry-classifier'
import { verifyAuth } from '@/lib/auth'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify authentication
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.user.userId.toString()
    const { id } = await params
    const adCreativeId = parseInt(id)

    if (isNaN(adCreativeId)) {
      return NextResponse.json({ error: 'Invalid ad creative ID' }, { status: 400 })
    }

    const body = await request.json()
    const {
      conversions,
      conversionValue = 0,
      periodStart,
      periodEnd,
      feedbackNote
    } = body

    if (typeof conversions !== 'number' || conversions < 0) {
      return NextResponse.json({ error: 'Invalid conversions value' }, { status: 400 })
    }

    if (!periodStart || !periodEnd) {
      return NextResponse.json({ error: 'Period start and end dates are required' }, { status: 400 })
    }

    const db = await getDatabase()

    // 验证广告创意存在
    const creative = await db.queryOne<any>(`
      SELECT ac.id, ac.offer_id, o.industry_code
      FROM ad_creatives ac
      JOIN offers o ON ac.offer_id = o.id
      WHERE ac.id = ?
    `, [adCreativeId])

    if (!creative) {
      return NextResponse.json({ error: 'Ad creative not found' }, { status: 404 })
    }

    // 保存转化反馈
    const result = await db.exec(`
      INSERT INTO conversion_feedback (
        ad_creative_id, user_id, conversions, conversion_value,
        period_start, period_end, feedback_note
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      adCreativeId,
      userId,
      conversions,
      conversionValue,
      periodStart,
      periodEnd,
      feedbackNote || null
    ])

    const feedbackId = getInsertedId(result, db.type)

    // 获取现有效果数据并更新转化信息
    const existingPerformance = await db.queryOne<any>(`
      SELECT * FROM ad_creative_performance
      WHERE ad_creative_id = ?
      ORDER BY sync_date DESC
      LIMIT 1
    `, [adCreativeId])

    if (existingPerformance && existingPerformance.clicks >= 100) {
      // 计算转化率
      const conversionRate = (conversions / existingPerformance.clicks) * 100

      // 更新效果数据并重新计算加分
      const bonusResult = await calculateBonusScore(
        {
          clicks: existingPerformance.clicks,
          ctr: existingPerformance.ctr,
          cpc: existingPerformance.cpc,
          conversions,
          conversionRate
        },
        creative.industry_code || 'ecom_fashion'
      )

      // 更新数据库
      await db.exec(`
        UPDATE ad_creative_performance
        SET conversions = ?,
            conversion_rate = ?,
            conversion_value = ?,
            bonus_score = ?,
            bonus_breakdown = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [
        conversions,
        conversionRate,
        conversionValue,
        bonusResult.totalBonus,
        JSON.stringify(bonusResult.breakdown),
        existingPerformance.id
      ])

      return NextResponse.json({
        success: true,
        feedbackId,
        bonusScore: bonusResult.totalBonus,
        breakdown: bonusResult.breakdown,
        message: 'Conversion feedback saved and bonus score updated'
      })
    }

    return NextResponse.json({
      success: true,
      feedbackId,
      message: 'Conversion feedback saved. Bonus score will be calculated when performance data is available.'
    })
  } catch (error) {
    console.error('Conversion feedback error:', error)
    return NextResponse.json(
      { error: 'Failed to save conversion feedback' },
      { status: 500 }
    )
  }
}

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const adCreativeId = parseInt(id)

    if (isNaN(adCreativeId)) {
      return NextResponse.json({ error: 'Invalid ad creative ID' }, { status: 400 })
    }

    const db = await getDatabase()

    // 获取所有转化反馈
    const feedbacks = await db.query<any>(`
      SELECT
        id, conversions, conversion_value,
        period_start, period_end, feedback_note,
        created_at
      FROM conversion_feedback
      WHERE ad_creative_id = ?
      ORDER BY created_at DESC
    `, [adCreativeId])

    // 获取汇总统计
    const summary = await db.queryOne<any>(`
      SELECT
        SUM(conversions) as total_conversions,
        SUM(conversion_value) as total_value,
        COUNT(*) as feedback_count
      FROM conversion_feedback
      WHERE ad_creative_id = ?
    `, [adCreativeId])

    return NextResponse.json({
      feedbacks,
      summary: {
        totalConversions: summary?.total_conversions || 0,
        totalValue: summary?.total_value || 0,
        feedbackCount: summary?.feedback_count || 0
      }
    })
  } catch (error) {
    console.error('Get conversion feedback error:', error)
    return NextResponse.json(
      { error: 'Failed to get conversion feedback' },
      { status: 500 }
    )
  }
}
