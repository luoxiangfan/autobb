/**
 * Bonus Score API
 * 获取广告创意的加分数据
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { getCreativePerformance } from '@/lib/bonus-score-calculator'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify authentication
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const adCreativeId = parseInt(id)

    if (isNaN(adCreativeId)) {
      return NextResponse.json({ error: 'Invalid ad creative ID' }, { status: 400 })
    }

    const db = await getDatabase()

    // 验证创意归属
    const creative = await db.queryOne<any>(`
      SELECT id, google_campaign_id
      FROM ad_creatives
      WHERE id = ? AND user_id = ?
    `, [adCreativeId, authResult.user.userId])

    if (!creative) {
      return NextResponse.json({ error: 'Ad creative not found' }, { status: 404 })
    }

    // 获取创意关联账号币种（优先 campaigns.ad_creative_id，其次 google_campaign_id 关联）
    const currencyRow = await db.queryOne<any>(`
      SELECT COALESCE(gaa.currency, 'USD') as currency
      FROM campaigns c
      LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
      WHERE c.user_id = ? AND c.ad_creative_id = ?
      LIMIT 1
    `, [authResult.user.userId, adCreativeId])

    const fallbackCurrencyRow = !currencyRow?.currency && creative.google_campaign_id
      ? await db.queryOne<any>(`
          SELECT COALESCE(gaa.currency, 'USD') as currency
          FROM campaigns c
          LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
          WHERE c.user_id = ? AND c.google_campaign_id = ?
          LIMIT 1
        `, [authResult.user.userId, creative.google_campaign_id])
      : null

    const currency = String((currencyRow?.currency || fallbackCurrencyRow?.currency || 'USD')).trim().toUpperCase()

    const performanceData = await getCreativePerformance(adCreativeId)

    if (!performanceData) {
      return NextResponse.json({
        hasData: false,
        message: 'No performance data available yet. Bonus score requires at least 100 clicks.',
        bonusScore: 0,
        breakdown: null,
        currency
      })
    }

    return NextResponse.json({
      hasData: true,
      bonusScore: performanceData.bonusScore.totalBonus,
      breakdown: performanceData.bonusScore.breakdown,
      minClicksReached: performanceData.bonusScore.minClicksReached,
      industryCode: performanceData.bonusScore.industryCode,
      industryLabel: performanceData.bonusScore.industryLabel,
      performance: performanceData.performance,
      syncDate: performanceData.syncDate,
      currency
    })
  } catch (error) {
    console.error('Get bonus score error:', error)
    return NextResponse.json(
      { error: 'Failed to get bonus score' },
      { status: 500 }
    )
  }
}
