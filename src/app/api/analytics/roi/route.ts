import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { convertCurrency } from '@/lib/currency'
import { toNumber } from '@/lib/utils'
import { getCommissionPerConversion as getOfferCommissionPerConversion } from '@/lib/offer-monetization'

/**
 * GET /api/analytics/roi
 * 获取ROAS分析数据（广告支出回报率）
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

    const baseWhereConditions: string[] = ['cp.user_id = ?']
    const baseParams: any[] = [userId]

    if (startDate) {
      baseWhereConditions.push('cp.date >= ?')
      baseParams.push(startDate)
    }

    if (endDate) {
      baseWhereConditions.push('cp.date <= ?')
      baseParams.push(endDate)
    }

    if (campaignId) {
      baseWhereConditions.push('cp.campaign_id = ?')
      baseParams.push(campaignId)
    }

    if (offerId) {
      baseWhereConditions.push('c.offer_id = ?')
      baseParams.push(offerId)
    }

    // 获取可用币种（优先使用 performance 中出现的币种；无数据则回退到账号币种）
    const currencyRows = await db.query<any>(`
      SELECT DISTINCT cp.currency as currency
      FROM campaign_performance cp
      INNER JOIN campaigns c ON cp.campaign_id = c.id
      WHERE ${baseWhereConditions.join(' AND ')}
      ORDER BY currency ASC
    `, baseParams)

    let currencies = Array.from(new Set(
      (currencyRows || [])
        .map((r: any) => String(r.currency || '').trim().toUpperCase())
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
          .map((r: any) => String(r.currency || '').trim().toUpperCase())
          .filter(Boolean)
      ))
    }

    const defaultCurrency = currencies.length > 0 ? currencies[0] : 'USD'
    const reportingCurrency = requestedCurrency && currencies.includes(requestedCurrency)
      ? requestedCurrency
      : defaultCurrency
    const hasMixedCurrency = currencies.length > 1

    const whereConditions = [...baseWhereConditions, 'cp.currency = ?']
    const params: any[] = [...baseParams, reportingCurrency]

    const getCommissionPerConversion = (productPrice: any, commissionPayout: any, targetCountry: any): number => {
      const parsed = getOfferCommissionPerConversion({
        productPrice: String(productPrice || ''),
        commissionPayout: String(commissionPayout || ''),
        targetCountry: String(targetCountry || ''),
      })
      if (!parsed || !(parsed.amount > 0)) return 0

      const sourceCurrency = String(parsed.currency || 'USD').trim().toUpperCase()
      if (sourceCurrency === reportingCurrency) {
        return parsed.amount
      }

      try {
        return convertCurrency(parsed.amount, sourceCurrency, reportingCurrency)
      } catch {
        // 跨币种无法换算时，避免混币种：返回0（该Offer的收益将不计入报表）
        return 0
      }
    }

    // 预计算 offerId → 单次转化佣金（报表币种）
    const offerMetaRows = await db.query<any>(`
      SELECT DISTINCT
        o.id as offer_id,
        o.target_country,
        o.product_price,
        o.commission_payout
      FROM campaign_performance cp
      INNER JOIN campaigns c ON cp.campaign_id = c.id
      LEFT JOIN offers o ON c.offer_id = o.id
      WHERE ${whereConditions.join(' AND ')} AND o.id IS NOT NULL
    `, params)

    const commissionMap = new Map<number, number>()
    for (const row of (offerMetaRows || [])) {
      const id = Number(row.offer_id)
      if (!Number.isFinite(id)) continue
      commissionMap.set(id, getCommissionPerConversion(row.product_price, row.commission_payout, row.target_country))
    }

    // 1. 整体ROAS分析（按Offer汇总，避免SQL层混币种）
    const totalsByOffer = await db.query<any>(`
      SELECT
        c.offer_id as offer_id,
        SUM(cp.cost) as total_cost,
        SUM(cp.conversions) as total_conversions
      FROM campaign_performance cp
      INNER JOIN campaigns c ON cp.campaign_id = c.id
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY c.offer_id
    `, params)

    let totalCost = 0
    let totalCommission = 0
    let totalConversions = 0

    for (const row of (totalsByOffer || [])) {
      const cost = toNumber(row.total_cost)
      const conversions = toNumber(row.total_conversions)
      const offerIdKey = Number(row.offer_id)
      const commission = commissionMap.get(offerIdKey) || 0

      totalCost += cost
      totalConversions += conversions
      totalCommission += conversions * commission
    }

    const overallRoas = totalCost > 0 ? totalCommission / totalCost : 0
    const avgCommission = totalConversions > 0 ? (totalCommission / totalConversions) : 0

    // 2. 按日期的ROAS趋势（按日期+Offer汇总后在代码层计算佣金）
    const roasTrendRaw = await db.query<any>(`
      SELECT
        DATE(cp.date) as date,
        c.offer_id as offer_id,
        SUM(cp.cost) as cost,
        SUM(cp.conversions) as conversions
      FROM campaign_performance cp
      INNER JOIN campaigns c ON cp.campaign_id = c.id
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY DATE(cp.date), c.offer_id
      ORDER BY date ASC
    `, params)

    const trendMap = new Map<string, { cost: number; conversions: number; commission: number }>()
    for (const row of (roasTrendRaw || [])) {
      const date = String(row.date || '')
      if (!date) continue

      const cost = toNumber(row.cost)
      const conversions = toNumber(row.conversions)
      const offerIdKey = Number(row.offer_id)
      const commissionPerConv = commissionMap.get(offerIdKey) || 0

      const existing = trendMap.get(date) || { cost: 0, conversions: 0, commission: 0 }
      existing.cost += cost
      existing.conversions += conversions
      existing.commission += conversions * commissionPerConv
      trendMap.set(date, existing)
    }

    const roasTrendData = Array.from(trendMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, agg]) => {
        const cost = agg.cost
        const commission = agg.commission
        const conversions = agg.conversions
        const roas = cost > 0 ? commission / cost : 0

        return {
          date,
          cost: parseFloat(cost.toFixed(2)),
          revenue: parseFloat(commission.toFixed(2)),
          profit: parseFloat((commission - cost).toFixed(2)),
          roi: parseFloat(roas.toFixed(2)),
          conversions,
        }
      })

    // 3. 按Campaign的ROAS排名
    const campaignRows = await db.query<any>(`
      SELECT
        c.id as campaign_id,
        c.campaign_name,
        c.offer_id as offer_id,
        o.brand as offer_brand,
        SUM(cp.cost) as cost,
        SUM(cp.conversions) as conversions,
        SUM(cp.impressions) as impressions,
        SUM(cp.clicks) as clicks
      FROM campaign_performance cp
      INNER JOIN campaigns c ON cp.campaign_id = c.id
      LEFT JOIN offers o ON c.offer_id = o.id
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY c.id, c.campaign_name, c.offer_id, o.brand
      HAVING SUM(cp.conversions) > 0
    `, params)

    const campaignRoasData = (campaignRows || [])
      .map((row: any) => {
        const cost = toNumber(row.cost)
        const conversions = toNumber(row.conversions)
        const impressions = toNumber(row.impressions)
        const clicks = toNumber(row.clicks)
        const offerIdKey = Number(row.offer_id)
        const commissionPerConv = commissionMap.get(offerIdKey) || 0
        const commission = conversions * commissionPerConv

        const roas = cost > 0 ? commission / cost : 0
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0
        const conversionRate = clicks > 0 ? (conversions / clicks) * 100 : 0

        return {
          campaignId: Number(row.campaign_id),
          campaignName: row.campaign_name,
          offerBrand: row.offer_brand,
          cost: parseFloat(cost.toFixed(2)),
          revenue: parseFloat(commission.toFixed(2)),
          profit: parseFloat((commission - cost).toFixed(2)),
          roi: parseFloat(roas.toFixed(2)),
          conversions,
          ctr: parseFloat(ctr.toFixed(2)),
          conversionRate: parseFloat(conversionRate.toFixed(2)),
          impressions,
          clicks,
        }
      })
      .sort((a: any, b: any) => (b.revenue || 0) - (a.revenue || 0))
      .slice(0, 10)

    // 4. 按Offer的ROAS分析
    const offerRows = await db.query<any>(`
      SELECT
        o.id as offer_id,
        o.brand,
        o.offer_name,
        COUNT(DISTINCT c.id) as campaign_count,
        SUM(cp.cost) as cost,
        SUM(cp.conversions) as conversions
      FROM campaign_performance cp
      INNER JOIN campaigns c ON cp.campaign_id = c.id
      LEFT JOIN offers o ON c.offer_id = o.id
      WHERE ${whereConditions.join(' AND ')} AND o.id IS NOT NULL
      GROUP BY o.id, o.brand, o.offer_name
      HAVING SUM(cp.conversions) > 0
    `, params)

    const offerRoasData = (offerRows || [])
      .map((row: any) => {
        const cost = toNumber(row.cost)
        const conversions = toNumber(row.conversions)
        const offerIdKey = Number(row.offer_id)
        const commissionAmount = commissionMap.get(offerIdKey) || 0
        const commission = conversions * commissionAmount
        const roas = cost > 0 ? commission / cost : 0

        return {
          offerId: offerIdKey,
          brand: row.brand,
          offerName: row.offer_name,
          commissionAmount: parseFloat(commissionAmount.toFixed(2)),
          campaignCount: toNumber(row.campaign_count),
          cost: parseFloat(cost.toFixed(2)),
          revenue: parseFloat(commission.toFixed(2)),
          profit: parseFloat((commission - cost).toFixed(2)),
          roi: parseFloat(roas.toFixed(2)),
          conversions,
        }
      })
      .sort((a: any, b: any) => (b.revenue || 0) - (a.revenue || 0))
      .slice(0, 10)

    // 5. 投资回报效率指标
    const efficiencyMetrics = {
      costPerConversion: totalConversions > 0
        ? parseFloat((totalCost / totalConversions).toFixed(2))
        : 0,
      revenuePerConversion: totalConversions > 0
        ? parseFloat((totalCommission / totalConversions).toFixed(2))
        : 0,
      profitMargin: totalCommission > 0
        ? parseFloat(((totalCommission - totalCost) / totalCommission * 100).toFixed(2))
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
          totalRevenue: parseFloat(totalCommission.toFixed(2)),
          totalProfit: parseFloat((totalCommission - totalCost).toFixed(2)),
          roi: parseFloat(overallRoas.toFixed(2)),
          conversions: totalConversions,
          avgCommission: parseFloat(avgCommission.toFixed(2)),
        },
        trend: roasTrendData,
        byCampaign: campaignRoasData,
        byOffer: offerRoasData,
        efficiency: efficiencyMetrics,
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
