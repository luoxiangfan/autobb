import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { buildAffiliateUnattributedFailureFilter } from '@/lib/openclaw/affiliate-attribution-failures'
import { toNumber } from '@/lib/utils'

function normalizeCurrency(value: unknown): string {
  const normalized = String(value ?? '').trim().toUpperCase()
  return normalized || 'USD'
}

/**
 * GET /api/analytics/roi
 * 获取ROAS分析数据（广告支出回报率）
 * 收入口径：联盟佣金（已归因 + 未归因失败表）
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('start_date')
    const endDate = searchParams.get('end_date')
    const campaignIdRaw = searchParams.get('campaign_id')
    const offerIdRaw = searchParams.get('offer_id')
    const requestedCurrencyRaw = searchParams.get('currency')
    const requestedCurrency = requestedCurrencyRaw ? requestedCurrencyRaw.trim().toUpperCase() : null

    const campaignId = campaignIdRaw ? parseInt(campaignIdRaw, 10) : null
    if (campaignIdRaw && (campaignId === null || isNaN(campaignId))) {
      return NextResponse.json({ error: 'Invalid campaign_id' }, { status: 400 })
    }

    const offerId = offerIdRaw ? parseInt(offerIdRaw, 10) : null
    if (offerIdRaw && (offerId === null || isNaN(offerId))) {
      return NextResponse.json({ error: 'Invalid offer_id' }, { status: 400 })
    }

    const db = await getDatabase()
    const userId = authResult.user.userId
    const unattributedFailureFilter = buildAffiliateUnattributedFailureFilter({
      includePendingWithinGrace: true,
      includeAllFailures: true,
    })

    const performanceWhereConditions: string[] = ['cp.user_id = ?']
    const performanceParams: any[] = [userId]

    if (startDate) {
      performanceWhereConditions.push('cp.date >= ?')
      performanceParams.push(startDate)
    }

    if (endDate) {
      performanceWhereConditions.push('cp.date <= ?')
      performanceParams.push(endDate)
    }

    if (campaignId) {
      performanceWhereConditions.push('cp.campaign_id = ?')
      performanceParams.push(campaignId)
    }

    if (offerId) {
      performanceWhereConditions.push('c.offer_id = ?')
      performanceParams.push(offerId)
    }

    const commissionWhereConditions: string[] = ['user_id = ?']
    const commissionParams: any[] = [userId]

    if (startDate) {
      commissionWhereConditions.push('report_date >= ?')
      commissionParams.push(startDate)
    }

    if (endDate) {
      commissionWhereConditions.push('report_date <= ?')
      commissionParams.push(endDate)
    }

    if (campaignId) {
      commissionWhereConditions.push('campaign_id = ?')
      commissionParams.push(campaignId)
    }

    if (offerId) {
      commissionWhereConditions.push('offer_id = ?')
      commissionParams.push(offerId)
    }

    const performanceCurrencyRows = await db.query<any>(`
      SELECT DISTINCT COALESCE(cp.currency, 'USD') as currency
      FROM campaign_performance cp
      INNER JOIN campaigns c ON cp.campaign_id = c.id
      WHERE ${performanceWhereConditions.join(' AND ')}
      ORDER BY currency ASC
    `, performanceParams)

    const attributedCurrencyRows = await db.query<any>(`
      SELECT DISTINCT COALESCE(currency, 'USD') as currency
      FROM affiliate_commission_attributions
      WHERE ${commissionWhereConditions.join(' AND ')}
      ORDER BY currency ASC
    `, commissionParams)

    let unattributedCurrencyRows: any[] = []
    try {
      unattributedCurrencyRows = await db.query<any>(`
        SELECT DISTINCT COALESCE(currency, 'USD') as currency
        FROM openclaw_affiliate_attribution_failures
        WHERE ${commissionWhereConditions.join(' AND ')}
          AND ${unattributedFailureFilter.sql}
        ORDER BY currency ASC
      `, [...commissionParams, ...unattributedFailureFilter.values])
    } catch (error: any) {
      const message = String(error?.message || '')
      if (
        !/openclaw_affiliate_attribution_failures/i.test(message)
        || !/(no such table|does not exist)/i.test(message)
      ) {
        throw error
      }
    }

    let currencies = Array.from(new Set(
      [
        ...(performanceCurrencyRows || []),
        ...(attributedCurrencyRows || []),
        ...(unattributedCurrencyRows || []),
      ]
        .map((row: any) => normalizeCurrency(row.currency))
        .filter(Boolean)
    ))

    if (currencies.length === 0) {
      const accountCurrencyRows = await db.query<any>(`
        SELECT DISTINCT COALESCE(currency, 'USD') as currency
        FROM google_ads_accounts
        WHERE user_id = ?
        ORDER BY currency ASC
      `, [userId])
      currencies = Array.from(new Set(
        (accountCurrencyRows || [])
          .map((row: any) => normalizeCurrency(row.currency))
          .filter(Boolean)
      ))
    }

    const defaultCurrency = currencies.length > 0 ? currencies[0] : 'USD'
    const reportingCurrency = requestedCurrency && currencies.includes(requestedCurrency)
      ? requestedCurrency
      : defaultCurrency
    const hasMixedCurrency = currencies.length > 1

    const performanceCurrencyWhereConditions = [...performanceWhereConditions, "COALESCE(cp.currency, 'USD') = ?"]
    const performanceCurrencyParams: any[] = [...performanceParams, reportingCurrency]
    const commissionCurrencyWhereConditions = [...commissionWhereConditions, "COALESCE(currency, 'USD') = ?"]
    const commissionCurrencyParams: any[] = [...commissionParams, reportingCurrency]

    const [
      overallCostRow,
      overallAttributedRevenueRow,
      costTrendRows,
      attributedTrendRows,
      campaignCostRows,
      campaignAttributedRevenueRows,
      offerCostRows,
      offerAttributedRevenueRows,
    ] = await Promise.all([
      db.queryOne<any>(`
        SELECT COALESCE(SUM(cp.cost), 0) as total_cost
        FROM campaign_performance cp
        INNER JOIN campaigns c ON cp.campaign_id = c.id
        WHERE ${performanceCurrencyWhereConditions.join(' AND ')}
      `, performanceCurrencyParams),
      db.queryOne<any>(`
        SELECT
          COALESCE(SUM(commission_amount), 0) as total_revenue,
          COUNT(*) as total_records
        FROM affiliate_commission_attributions
        WHERE ${commissionCurrencyWhereConditions.join(' AND ')}
      `, commissionCurrencyParams),
      db.query<any>(`
        SELECT
          DATE(cp.date) as date,
          COALESCE(SUM(cp.cost), 0) as cost
        FROM campaign_performance cp
        INNER JOIN campaigns c ON cp.campaign_id = c.id
        WHERE ${performanceCurrencyWhereConditions.join(' AND ')}
        GROUP BY DATE(cp.date)
        ORDER BY date ASC
      `, performanceCurrencyParams),
      db.query<any>(`
        SELECT
          report_date as date,
          COALESCE(SUM(commission_amount), 0) as revenue,
          COUNT(*) as conversions
        FROM affiliate_commission_attributions
        WHERE ${commissionCurrencyWhereConditions.join(' AND ')}
        GROUP BY report_date
        ORDER BY report_date ASC
      `, commissionCurrencyParams),
      db.query<any>(`
        SELECT
          c.id as campaign_id,
          c.campaign_name,
          o.brand as offer_brand,
          COALESCE(SUM(cp.cost), 0) as cost,
          COALESCE(SUM(cp.impressions), 0) as impressions,
          COALESCE(SUM(cp.clicks), 0) as clicks
        FROM campaign_performance cp
        INNER JOIN campaigns c ON cp.campaign_id = c.id
        LEFT JOIN offers o ON c.offer_id = o.id
        WHERE ${performanceCurrencyWhereConditions.join(' AND ')}
        GROUP BY c.id, c.campaign_name, o.brand
      `, performanceCurrencyParams),
      db.query<any>(`
        SELECT
          campaign_id,
          COALESCE(SUM(commission_amount), 0) as revenue,
          COUNT(*) as conversions
        FROM affiliate_commission_attributions
        WHERE ${commissionCurrencyWhereConditions.join(' AND ')}
          AND campaign_id IS NOT NULL
        GROUP BY campaign_id
      `, commissionCurrencyParams),
      db.query<any>(`
        SELECT
          o.id as offer_id,
          o.brand,
          o.offer_name,
          COUNT(DISTINCT c.id) as campaign_count,
          COALESCE(SUM(cp.cost), 0) as cost
        FROM campaign_performance cp
        INNER JOIN campaigns c ON cp.campaign_id = c.id
        LEFT JOIN offers o ON c.offer_id = o.id
        WHERE ${performanceCurrencyWhereConditions.join(' AND ')}
          AND o.id IS NOT NULL
        GROUP BY o.id, o.brand, o.offer_name
      `, performanceCurrencyParams),
      db.query<any>(`
        SELECT
          offer_id,
          COALESCE(SUM(commission_amount), 0) as revenue,
          COUNT(*) as conversions
        FROM affiliate_commission_attributions
        WHERE ${commissionCurrencyWhereConditions.join(' AND ')}
          AND offer_id IS NOT NULL
        GROUP BY offer_id
      `, commissionCurrencyParams),
    ])

    let overallUnattributedRevenueRow: any = { total_revenue: 0, total_records: 0 }
    let unattributedTrendRows: any[] = []
    let campaignUnattributedRevenueRows: any[] = []
    let offerUnattributedRevenueRows: any[] = []

    try {
      ;[
        overallUnattributedRevenueRow,
        unattributedTrendRows,
        campaignUnattributedRevenueRows,
        offerUnattributedRevenueRows,
      ] = await Promise.all([
        db.queryOne<any>(`
          SELECT
            COALESCE(SUM(commission_amount), 0) as total_revenue,
            COUNT(*) as total_records
          FROM openclaw_affiliate_attribution_failures
          WHERE ${commissionCurrencyWhereConditions.join(' AND ')}
            AND ${unattributedFailureFilter.sql}
        `, [...commissionCurrencyParams, ...unattributedFailureFilter.values]),
        db.query<any>(`
          SELECT
            report_date as date,
            COALESCE(SUM(commission_amount), 0) as revenue,
            COUNT(*) as conversions
          FROM openclaw_affiliate_attribution_failures
          WHERE ${commissionCurrencyWhereConditions.join(' AND ')}
            AND ${unattributedFailureFilter.sql}
          GROUP BY report_date
          ORDER BY report_date ASC
        `, [...commissionCurrencyParams, ...unattributedFailureFilter.values]),
        db.query<any>(`
          SELECT
            campaign_id,
            COALESCE(SUM(commission_amount), 0) as revenue,
            COUNT(*) as conversions
          FROM openclaw_affiliate_attribution_failures
          WHERE ${commissionCurrencyWhereConditions.join(' AND ')}
            AND ${unattributedFailureFilter.sql}
            AND campaign_id IS NOT NULL
          GROUP BY campaign_id
        `, [...commissionCurrencyParams, ...unattributedFailureFilter.values]),
        db.query<any>(`
          SELECT
            offer_id,
            COALESCE(SUM(commission_amount), 0) as revenue,
            COUNT(*) as conversions
          FROM openclaw_affiliate_attribution_failures
          WHERE ${commissionCurrencyWhereConditions.join(' AND ')}
            AND ${unattributedFailureFilter.sql}
            AND offer_id IS NOT NULL
          GROUP BY offer_id
        `, [...commissionCurrencyParams, ...unattributedFailureFilter.values]),
      ])
    } catch (error: any) {
      const message = String(error?.message || '')
      if (
        !/openclaw_affiliate_attribution_failures/i.test(message)
        || !/(no such table|does not exist)/i.test(message)
      ) {
        throw error
      }
    }

    const totalCost = toNumber(overallCostRow?.total_cost)
    const totalRevenue = toNumber(overallAttributedRevenueRow?.total_revenue) + toNumber(overallUnattributedRevenueRow?.total_revenue)
    const totalConversions = toNumber(overallAttributedRevenueRow?.total_records) + toNumber(overallUnattributedRevenueRow?.total_records)
    const overallRoas = totalCost > 0 ? totalRevenue / totalCost : 0
    const avgCommission = totalConversions > 0 ? totalRevenue / totalConversions : 0

    const trendMap = new Map<string, { cost: number; revenue: number; conversions: number }>()
    const appendTrendRows = (rows: any[]) => {
      for (const row of rows || []) {
        const date = String(row?.date || '').trim()
        if (!date) continue
        const current = trendMap.get(date) || { cost: 0, revenue: 0, conversions: 0 }
        current.cost += toNumber(row.cost)
        current.revenue += toNumber(row.revenue)
        current.conversions += toNumber(row.conversions)
        trendMap.set(date, current)
      }
    }

    appendTrendRows(costTrendRows)
    appendTrendRows(attributedTrendRows)
    appendTrendRows(unattributedTrendRows)

    const trendData = Array.from(trendMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, metrics]) => {
        const roas = metrics.cost > 0 ? metrics.revenue / metrics.cost : 0
        return {
          date,
          cost: parseFloat(metrics.cost.toFixed(2)),
          revenue: parseFloat(metrics.revenue.toFixed(2)),
          profit: parseFloat((metrics.revenue - metrics.cost).toFixed(2)),
          roi: parseFloat(roas.toFixed(2)),
          conversions: metrics.conversions,
        }
      })

    const appendRevenueByKey = (
      rows: any[],
      keyName: 'campaign_id' | 'offer_id',
      target: Map<number, { revenue: number; conversions: number }>
    ) => {
      for (const row of rows || []) {
        const key = Number(row?.[keyName])
        if (!Number.isFinite(key)) continue
        const current = target.get(key) || { revenue: 0, conversions: 0 }
        current.revenue += toNumber(row.revenue)
        current.conversions += toNumber(row.conversions)
        target.set(key, current)
      }
    }

    const campaignRevenueMap = new Map<number, { revenue: number; conversions: number }>()
    appendRevenueByKey(campaignAttributedRevenueRows, 'campaign_id', campaignRevenueMap)
    appendRevenueByKey(campaignUnattributedRevenueRows, 'campaign_id', campaignRevenueMap)

    const byCampaign = (campaignCostRows || [])
      .map((row: any) => {
        const campaignIdValue = Number(row.campaign_id)
        if (!Number.isFinite(campaignIdValue)) return null
        const cost = toNumber(row.cost)
        const impressions = toNumber(row.impressions)
        const clicks = toNumber(row.clicks)
        const revenueMetrics = campaignRevenueMap.get(campaignIdValue) || { revenue: 0, conversions: 0 }
        if (revenueMetrics.revenue <= 0) return null

        const roas = cost > 0 ? revenueMetrics.revenue / cost : 0
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0
        const conversionRate = clicks > 0 ? (revenueMetrics.conversions / clicks) * 100 : 0

        return {
          campaignId: campaignIdValue,
          campaignName: row.campaign_name,
          offerBrand: row.offer_brand,
          cost: parseFloat(cost.toFixed(2)),
          revenue: parseFloat(revenueMetrics.revenue.toFixed(2)),
          profit: parseFloat((revenueMetrics.revenue - cost).toFixed(2)),
          roi: parseFloat(roas.toFixed(2)),
          conversions: revenueMetrics.conversions,
          ctr: parseFloat(ctr.toFixed(2)),
          conversionRate: parseFloat(conversionRate.toFixed(2)),
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => (b.revenue || 0) - (a.revenue || 0))
      .slice(0, 10)

    const offerRevenueMap = new Map<number, { revenue: number; conversions: number }>()
    appendRevenueByKey(offerAttributedRevenueRows, 'offer_id', offerRevenueMap)
    appendRevenueByKey(offerUnattributedRevenueRows, 'offer_id', offerRevenueMap)

    const byOffer = (offerCostRows || [])
      .map((row: any) => {
        const offerIdValue = Number(row.offer_id)
        if (!Number.isFinite(offerIdValue)) return null
        const cost = toNumber(row.cost)
        const revenueMetrics = offerRevenueMap.get(offerIdValue) || { revenue: 0, conversions: 0 }
        if (revenueMetrics.revenue <= 0) return null

        const roas = cost > 0 ? revenueMetrics.revenue / cost : 0
        const commissionAmount = revenueMetrics.conversions > 0
          ? revenueMetrics.revenue / revenueMetrics.conversions
          : 0

        return {
          offerId: offerIdValue,
          brand: row.brand,
          offerName: row.offer_name,
          commissionAmount: parseFloat(commissionAmount.toFixed(2)),
          campaignCount: toNumber(row.campaign_count),
          cost: parseFloat(cost.toFixed(2)),
          revenue: parseFloat(revenueMetrics.revenue.toFixed(2)),
          profit: parseFloat((revenueMetrics.revenue - cost).toFixed(2)),
          roi: parseFloat(roas.toFixed(2)),
          conversions: revenueMetrics.conversions,
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => (b.revenue || 0) - (a.revenue || 0))
      .slice(0, 10)

    const efficiency = {
      costPerConversion: totalConversions > 0
        ? parseFloat((totalCost / totalConversions).toFixed(2))
        : 0,
      revenuePerConversion: totalConversions > 0
        ? parseFloat((totalRevenue / totalConversions).toFixed(2))
        : 0,
      profitMargin: totalRevenue > 0
        ? parseFloat((((totalRevenue - totalCost) / totalRevenue) * 100).toFixed(2))
        : 0,
      breakEvenPoint: avgCommission > 0
        ? parseFloat((totalCost / avgCommission).toFixed(0))
        : 0,
    }

    return NextResponse.json({
      success: true,
      currency: reportingCurrency,
      currencies,
      hasMixedCurrency,
      data: {
        overall: {
          totalCost: parseFloat(totalCost.toFixed(2)),
          totalRevenue: parseFloat(totalRevenue.toFixed(2)),
          totalProfit: parseFloat((totalRevenue - totalCost).toFixed(2)),
          roi: parseFloat(overallRoas.toFixed(2)),
          conversions: totalConversions,
          avgCommission: parseFloat(avgCommission.toFixed(2)),
        },
        trend: trendData,
        byCampaign,
        byOffer,
        efficiency,
      },
    })
  } catch (error: any) {
    console.error('获取ROI分析数据失败:', error)
    return NextResponse.json(
      { error: '获取ROI分析数据失败', message: error.message },
      { status: 500 }
    )
  }
}
