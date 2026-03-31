/**
 * Campaign对比视图API
 * GET /api/campaigns/compare?offer_id=X&days=7
 *
 * 功能：
 * - 获取同一Offer的所有Campaign对比数据
 * - 聚合近7天/30天性能数据
 * - 自动标识Winner
 * - 生成规则化优化建议
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { createOptimizationEngine, type CampaignMetrics } from '@/lib/optimization-rules'
import { convertCurrency } from '@/lib/currency'
import { getCommissionPerConversion as getOfferCommissionPerConversion } from '@/lib/offer-monetization'

interface CampaignPerformance {
  campaignId: number
  campaignName: string
  status: string

  // 聚合指标
  impressions: number
  clicks: number
  cost: number
  conversions: number

  // 计算指标
  ctr: number
  cpc: number
  cpa: number
  conversionRate: number
  roi: number

  // 每日趋势数据
  dailyTrends: Array<{
    date: string
    impressions: number
    clicks: number
    ctr: number
    cost: number
  }>
}

interface CampaignComparison {
  offerId: number
  offerName: string
  dateRange: { start: string; end: string }
  campaigns: CampaignPerformance[]
  winner: {
    campaignId: number
    metric: 'ctr' | 'roi' | 'conversions'
    value: number
  } | null
  recommendations: Array<{
    campaignId: number
    priority: 'high' | 'medium' | 'low'
    type: 'pause' | 'increase_budget' | 'decrease_budget' | 'optimize_creative'
    reason: string
    action: string
  }>
  industryBenchmarks: {
    avgCtr: number
    avgCpc: number
    avgConversionRate: number
  }
  currency?: string
  currencies?: string[]
  hasMixedCurrency?: boolean
}

/**
 * 映射优化类型到API响应格式
 */
function mapOptimizationType(
  type: string
): 'pause' | 'increase_budget' | 'decrease_budget' | 'optimize_creative' {
  switch (type) {
    case 'pause_campaign':
      return 'pause'
    case 'increase_budget':
      return 'increase_budget'
    case 'decrease_budget':
      return 'decrease_budget'
    case 'lower_cpc':
      return 'decrease_budget'
    case 'improve_landing_page':
    case 'optimize_creative':
    case 'adjust_keywords':
    case 'expand_targeting':
      return 'optimize_creative'
    default:
      return 'optimize_creative'
  }
}

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const auth = await verifyAuth(request)
    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // 获取查询参数
    const searchParams = request.nextUrl.searchParams
    const offerIdStr = searchParams.get('offer_id')
    const daysStr = searchParams.get('days') || '7'
    const requestedCurrencyRaw = searchParams.get('currency')
    const requestedCurrency = requestedCurrencyRaw ? requestedCurrencyRaw.trim().toUpperCase() : null

    if (!offerIdStr) {
      return NextResponse.json(
        { error: 'offer_id is required' },
        { status: 400 }
      )
    }

    const offerId = parseInt(offerIdStr)
    const days = parseInt(daysStr)

    if (isNaN(offerId) || isNaN(days) || days <= 0) {
      return NextResponse.json(
        { error: 'Invalid parameters' },
        { status: 400 }
      )
    }

    const db = await getDatabase()

    // 获取Offer信息
    const offer = await db.queryOne<any>(`
      SELECT id, offer_name, target_country, product_price, commission_payout
      FROM offers
      WHERE id = ? AND user_id = ?
    `, [offerId, auth.user!.userId])

    if (!offer) {
      return NextResponse.json(
        { error: 'Offer not found' },
        { status: 404 }
      )
    }

    // 计算日期范围
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(endDate.getDate() - days)

    const startDateStr = startDate.toISOString().split('T')[0]
    const endDateStr = endDate.toISOString().split('T')[0]

    // 获取该Offer的可用币种（按账号币种）
    const currencyRows = await db.query<any>(`
      SELECT DISTINCT COALESCE(gaa.currency, 'USD') as currency
      FROM campaigns c
      LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
      WHERE c.offer_id = ? AND c.user_id = ?
      ORDER BY currency ASC
    `, [offerId, auth.user!.userId])

    const currencies = Array.from(new Set(
      (currencyRows || [])
        .map((r: any) => String(r.currency || '').trim().toUpperCase())
        .filter(Boolean)
    ))

    const defaultCurrency = currencies.length > 0 ? currencies[0] : 'USD'
    const reportingCurrency = requestedCurrency && currencies.includes(requestedCurrency)
      ? requestedCurrency
      : defaultCurrency
    const hasMixedCurrency = currencies.length > 1

    // 获取该Offer的所有Campaigns
    const campaigns = await db.query<any>(`
      SELECT
        c.id,
        c.campaign_name,
        c.status,
        COALESCE(gaa.currency, 'USD') as currency
      FROM campaigns c
      LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
      WHERE c.offer_id = ? AND c.user_id = ?
        AND COALESCE(gaa.currency, 'USD') = ?
    `, [offerId, auth.user!.userId, reportingCurrency])

    if (campaigns.length === 0) {
      return NextResponse.json({
        offerId,
        offerName: offer.offer_name,
        dateRange: { start: startDateStr, end: endDateStr },
        campaigns: [],
        winner: null,
        recommendations: [],
        industryBenchmarks: {
          avgCtr: 0.02, // 2% 行业均值
          avgCpc: 1.5,
          avgConversionRate: 0.03
        },
        currency: reportingCurrency,
        currencies,
        hasMixedCurrency
      })
    }

    // ⚡ P0性能优化: 修复N+1查询问题
    // 原问题: 循环N个campaigns，每个执行2次查询 = 2N次查询
    // 优化后: 2次批量查询，使用Map分组 = 2次查询（与campaigns数量无关）

    // 计算真实转化价值（提前计算，避免在循环中重复解析）
    let conversionValue = 50 // 默认值（USD）

    // 默认值：以USD为基准换算到报表币种
    try {
      conversionValue = convertCurrency(conversionValue, 'USD', reportingCurrency)
    } catch {
      // ignore
    }

    if (offer.product_price && offer.commission_payout) {
      try {
        const parsed = getOfferCommissionPerConversion({
          productPrice: offer.product_price,
          commissionPayout: offer.commission_payout,
          targetCountry: offer.target_country,
        })

        if (parsed && parsed.amount > 0) {
          const sourceCurrency = String(parsed.currency || 'USD').trim().toUpperCase()
          conversionValue = sourceCurrency === reportingCurrency
            ? parsed.amount
            : convertCurrency(parsed.amount, sourceCurrency, reportingCurrency)
        }
      } catch (error) {
        console.warn(`计算转化价值失败，使用默认值: ${error}`)
      }
    }

    // 批量查询1: 所有campaigns的聚合指标（单次查询）
    const campaignIds = campaigns.map(c => c.id)
    const placeholders = campaignIds.map(() => '?').join(',')

    const aggregates = await db.query<any>(`
      SELECT
        campaign_id,
        COALESCE(SUM(impressions), 0) as impressions,
        COALESCE(SUM(clicks), 0) as clicks,
        COALESCE(SUM(cost), 0) as cost,
        COALESCE(SUM(conversions), 0) as conversions
      FROM campaign_performance
      WHERE campaign_id IN (${placeholders})
        AND user_id = ?
        AND currency = ?
        AND date >= ?
        AND date <= ?
      GROUP BY campaign_id
    `, [...campaignIds, auth.user!.userId, reportingCurrency, startDateStr, endDateStr])

    // 建立Map: campaign_id → aggregate data
    const aggregateMap = new Map<number, any>()
    for (const agg of aggregates) {
      aggregateMap.set(agg.campaign_id, agg)
    }

    // 批量查询2: 所有campaigns的每日趋势（单次查询）
    const dailyData = await db.query<any>(`
      SELECT
        campaign_id,
        date,
        COALESCE(SUM(impressions), 0) as impressions,
        COALESCE(SUM(clicks), 0) as clicks,
        COALESCE(SUM(cost), 0) as cost
      FROM campaign_performance
      WHERE campaign_id IN (${placeholders})
        AND user_id = ?
        AND currency = ?
        AND date >= ?
        AND date <= ?
      GROUP BY campaign_id, date
      ORDER BY campaign_id, date ASC
    `, [...campaignIds, auth.user!.userId, reportingCurrency, startDateStr, endDateStr])

    // 建立Map: campaign_id → daily trends array
    const dailyMap = new Map<number, any[]>()
    for (const row of dailyData) {
      if (!dailyMap.has(row.campaign_id)) {
        dailyMap.set(row.campaign_id, [])
      }
      dailyMap.get(row.campaign_id)!.push({
        date: row.date,
        impressions: row.impressions,
        clicks: row.clicks,
        ctr: row.impressions > 0 ? row.clicks / row.impressions : 0,
        cost: row.cost
      })
    }

    // 聚合每个Campaign的性能数据（基于预查询的Map，无额外查询）
    const campaignPerformances: CampaignPerformance[] = []

    for (const campaign of campaigns) {
      const aggregate = aggregateMap.get(campaign.id) || {
        impressions: 0,
        clicks: 0,
        cost: 0,
        conversions: 0
      }

      const impressions = aggregate.impressions || 0
      const clicks = aggregate.clicks || 0
      const cost = aggregate.cost || 0
      const conversions = aggregate.conversions || 0

      const ctr = impressions > 0 ? clicks / impressions : 0
      const cpc = clicks > 0 ? cost / clicks : 0
      const cpa = conversions > 0 ? cost / conversions : 0
      const conversionRate = clicks > 0 ? conversions / clicks : 0
      const roi = cost > 0 ? (conversions * conversionValue - cost) / cost : 0

      const dailyTrends = dailyMap.get(campaign.id) || []

      campaignPerformances.push({
        campaignId: campaign.id,
        campaignName: campaign.campaign_name,
        status: campaign.status,
        impressions,
        clicks,
        cost,
        conversions,
        ctr,
        cpc,
        cpa,
        conversionRate,
        roi,
        dailyTrends
      })
    }

    // 标识Winner（按CTR或ROI排序）
    let winner: CampaignComparison['winner'] = null
    if (campaignPerformances.length > 0) {
      // 优先按ROI排序，其次按CTR
      const sortedByRoi = [...campaignPerformances].sort((a, b) => b.roi - a.roi)
      const sortedByCtr = [...campaignPerformances].sort((a, b) => b.ctr - a.ctr)

      const topRoi = sortedByRoi[0]
      const topCtr = sortedByCtr[0]

      // 如果ROI最高的Campaign有转化数据，选它作为Winner
      if (topRoi.conversions > 0 && topRoi.roi > 0) {
        winner = {
          campaignId: topRoi.campaignId,
          metric: 'roi',
          value: topRoi.roi
        }
      } else if (topCtr.clicks >= 10) {
        // 否则选CTR最高的（至少有10个点击）
        winner = {
          campaignId: topCtr.campaignId,
          metric: 'ctr',
          value: topCtr.ctr
        }
      }
    }

    // 使用规则引擎生成优化建议
    const engine = createOptimizationEngine()

    // 将Campaign数据转换为规则引擎所需格式
    const campaignMetricsForRules: CampaignMetrics[] = campaignPerformances.map(campaign => ({
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,
      status: campaign.status,
      impressions: campaign.impressions,
      clicks: campaign.clicks,
      cost: campaign.cost,
      conversions: campaign.conversions,
      ctr: campaign.ctr,
      cpc: campaign.cpc,
      cpa: campaign.cpa,
      conversionRate: campaign.conversionRate,
      roi: campaign.roi,
      daysRunning: days // 使用查询的天数作为运行天数
    }))

    // 生成优化建议
    const engineRecommendations = engine.generateBatchRecommendations(campaignMetricsForRules)

    // 转换为API响应格式
    const recommendations: CampaignComparison['recommendations'] = engineRecommendations.map(rec => ({
      campaignId: rec.campaignId,
      priority: rec.priority,
      type: mapOptimizationType(rec.type),
      reason: rec.reason,
      action: rec.action
    }))

    // 行业基准
    const industryAvgCtr = 0.02 // 2%
    const industryAvgConversionRate = 0.03 // 3%
    let industryAvgCpc = 1.5 // USD基准
    if (reportingCurrency !== 'USD') {
      try {
        industryAvgCpc = convertCurrency(industryAvgCpc, 'USD', reportingCurrency)
      } catch {
        // ignore
      }
    }

    const result: CampaignComparison = {
      offerId,
      offerName: offer.offer_name,
      dateRange: { start: startDateStr, end: endDateStr },
      campaigns: campaignPerformances,
      winner,
      recommendations,
      industryBenchmarks: {
        avgCtr: industryAvgCtr,
        avgCpc: industryAvgCpc,
        avgConversionRate: industryAvgConversionRate
      },
      currency: reportingCurrency,
      currencies,
      hasMixedCurrency
    }

    return NextResponse.json(result)

  } catch (error) {
    console.error('Campaign comparison error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
