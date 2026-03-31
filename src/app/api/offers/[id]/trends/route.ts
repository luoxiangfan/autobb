import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { findOfferById } from '@/lib/offers'
import { getOfferCurrencyInfo, getOfferPerformanceTrend } from '@/lib/offer-performance'

/**
 * GET /api/offers/:id/trends
 *
 * 获取 Offer 趋势数据（按日期聚合，转化口径改为佣金）
 *
 * 注意：
 * - 广告花费和佣金保持原始货币（CNY 和 USD）
 * - 不支持货币选择
 *
 * Query Parameters:
 * - daysBack: number (可选，默认30天)
 */
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const offerId = parseInt(params.id)

    const offer = await findOfferById(offerId, userId)
    if (!offer) {
      return NextResponse.json(
        { error: 'Offer不存在或无权访问' },
        { status: 404 }
      )
    }

    const { searchParams } = new URL(request.url)
    const daysBack = parseInt(searchParams.get('daysBack') || '30')

    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - daysBack)

    const startDateStr = startDate.toISOString().split('T')[0]
    const endDateStr = endDate.toISOString().split('T')[0]

    const currencyInfo = await getOfferCurrencyInfo(offerId, userId, daysBack)
    const trends = await getOfferPerformanceTrend(offerId, userId, daysBack)

    const formattedTrends = trends.map((row) => {
      const cost = Number(row.cost) || 0
      const clicks = Number(row.clicks) || 0
      const avgCpcUsd = clicks > 0 ? cost / clicks : 0

      return {
        date: row.date,
        impressions: Number(row.impressions) || 0,
        clicks,
        conversions: Math.round((Number(row.conversions) || 0) * 100) / 100,
        commission: Math.round((Number(row.commission) || 0) * 100) / 100,
        commissionCurrency: row.commission_currency || 'USD',
        costUsd: Math.round(cost * 100) / 100,
        costCurrency: row.cost_currency || 'CNY',
        ctr: Math.round((Number(row.ctr) || 0) * 100) / 100,
        conversionRate: Math.round((Number(row.conversion_rate) || 0) * 100) / 100,
        commissionPerClick: Math.round((Number(row.commission_per_click) || 0) * 100) / 100,
        avgCpcUsd: Math.round(avgCpcUsd * 100) / 100,
      }
    })

    return NextResponse.json({
      success: true,
      trends: formattedTrends,
      currency: currencyInfo.currency,
      currencies: currencyInfo.currencies,
      hasMixedCurrency: currencyInfo.hasMixedCurrency,
      offer: {
        id: offer.id,
        brand: offer.brand,
        category: offer.category,
      },
      dateRange: {
        start: startDateStr,
        end: endDateStr,
        days: daysBack,
      },
    })
  } catch (error: any) {
    console.error('Get offer trends error:', error)
    return NextResponse.json(
      { error: error.message || '获取趋势数据失败' },
      { status: 500 }
    )
  }
}
