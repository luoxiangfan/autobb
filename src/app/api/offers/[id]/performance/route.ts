import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import {
  getOfferPerformanceSummary,
  getOfferPerformanceTrend,
  getCampaignPerformanceComparison,
  calculateOfferROI,
  getOfferCurrencyInfo
} from '@/lib/offer-performance'

/**
 * GET /api/offers/[id]/performance
 *
 * 获取 Offer 级别性能数据（含佣金）
 *
 * 注意：
 * - 广告花费和佣金保持原始货币（CNY 和 USD）
 * - ROI 计算时统一转换为 USD
 *
 * Query Parameters:
 * - daysBack: number (可选，默认30天)
 * - avgOrderValue: number (保留兼容，不再作为佣金口径主计算依据)
 */
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: '未授权' },
        { status: 401 }
      )
    }

    const userId = authResult.user.userId
    const offerId = parseInt(params.id)

    if (isNaN(offerId)) {
      return NextResponse.json(
        { error: '无效的Offer ID' },
        { status: 400 }
      )
    }

    const { searchParams } = new URL(request.url)
    const daysBack = parseInt(searchParams.get('daysBack') || '30')
    const avgOrderValue = parseFloat(searchParams.get('avgOrderValue') || '0')

    const currencyInfo = await getOfferCurrencyInfo(offerId, userId, daysBack)
    const summary = await getOfferPerformanceSummary(offerId, userId, daysBack)
    const trend = await getOfferPerformanceTrend(offerId, userId, daysBack)
    const campaigns = await getCampaignPerformanceComparison(offerId, userId, daysBack)

    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - daysBack)
    const startDateStr = startDate.toISOString().split('T')[0]
    const endDateStr = endDate.toISOString().split('T')[0]

    const roi = await calculateOfferROI(offerId, userId, avgOrderValue, daysBack)

    const safeSummary = {
      campaignCount: summary?.campaign_count || 0,
      impressions: summary?.impressions || 0,
      clicks: summary?.clicks || 0,
      conversions: Math.round((summary?.conversions || 0) * 100) / 100,
      commission: Math.round((summary?.commission || 0) * 100) / 100,
      commissionCurrency: summary?.commission_currency || 'USD',
      costUsd: Math.round((summary?.cost || 0) * 100) / 100,
      costCurrency: summary?.cost_currency || 'CNY',
      ctr: Math.round((summary?.ctr || 0) * 100) / 100,
      avgCpcUsd: Math.round((summary?.avg_cpc || 0) * 100) / 100,
      conversionRate: Math.round((summary?.conversion_rate || 0) * 100) / 100,
      commissionPerClick: Math.round((summary?.commission_per_click || 0) * 100) / 100,
      dateRange: { start: startDateStr, end: endDateStr, days: daysBack }
    }

    return NextResponse.json({
      success: true,
      offerId,
      daysBack,
      currency: currencyInfo.currency,
      currencies: currencyInfo.currencies,
      hasMixedCurrency: currencyInfo.hasMixedCurrency,
      summary: safeSummary,
      trend: trend.map(t => ({
        date: t.date,
        impressions: t.impressions || 0,
        clicks: t.clicks || 0,
        conversions: Math.round((t.conversions || 0) * 100) / 100,
        commission: Math.round((t.commission || 0) * 100) / 100,
        commissionCurrency: t.commission_currency || 'USD',
        costUsd: Math.round((t.cost || 0) * 100) / 100,
        costCurrency: t.cost_currency || 'CNY',
        ctr: Math.round((t.ctr || 0) * 100) / 100,
        conversionRate: Math.round((t.conversion_rate || 0) * 100) / 100,
        commissionPerClick: Math.round((t.commission_per_click || 0) * 100) / 100,
      })),
      campaigns: campaigns.map(c => ({
        campaignId: c.campaign_id,
        campaignName: c.campaign_name,
        googleCampaignId: c.google_campaign_id,
        adsAccountCurrency: c.cost_currency || 'CNY',
        impressions: c.impressions || 0,
        clicks: c.clicks || 0,
        conversions: Math.round((c.conversions || 0) * 100) / 100,
        commission: Math.round((c.commission || 0) * 100) / 100,
        commissionCurrency: c.commission_currency || 'USD',
        costUsd: Math.round((c.cost || 0) * 100) / 100,
        costCurrency: c.cost_currency || 'CNY',
        ctr: Math.round((c.ctr || 0) * 100) / 100,
        cpcUsd: Math.round((c.cpc || 0) * 100) / 100,
        conversionRate: Math.round((c.conversion_rate || 0) * 100) / 100,
        commissionPerClick: Math.round((c.commission_per_click || 0) * 100) / 100,
      })),
      roi: roi ? {
        totalCostUsd: roi.total_cost_usd,
        totalRevenueUsd: roi.total_revenue_usd,
        roiPercentage: roi.roi_percentage,
        profitUsd: roi.profit_usd,
        conversions: Math.round((roi.conversions || 0) * 100) / 100,
        commission: Math.round((roi.commission || 0) * 100) / 100,
        avgOrderValue: avgOrderValue
      } : null
    })

  } catch (error: any) {
    console.error('Get offer performance error:', error)
    return NextResponse.json(
      { error: error.message || '获取Offer性能数据失败' },
      { status: 500 }
    )
  }
}
