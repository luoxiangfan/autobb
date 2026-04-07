import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { toNumber } from '@/lib/utils'

function roundTo2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100
}

/**
 * GET /api/analytics/budget
 * 获取预算使用分析数据
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
    const requestedCurrencyRaw = searchParams.get('currency')
    const requestedCurrency = requestedCurrencyRaw ? requestedCurrencyRaw.trim().toUpperCase() : null

    const campaignId = campaignIdRaw ? parseInt(campaignIdRaw, 10) : null
    if (campaignIdRaw && (campaignId === null || isNaN(campaignId))) {
      return NextResponse.json({ error: 'Invalid campaign_id' }, { status: 400 })
    }

    const db = await getDatabase()
    const userId = authResult.user.userId

    // 构建查询条件
    const baseWhereConditions = ['cp.user_id = ?']
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

    // 获取可用币种（优先使用 performance 中出现的币种；无数据则回退到账号币种）
    const currencyRows = await db.query<any>(`
      SELECT DISTINCT cp.currency as currency
      FROM campaign_performance cp
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

    const allCampaignSpendWhereConditions = [...baseWhereConditions, 'COALESCE(cp.currency, \'USD\') = ?']
    const allCampaignSpendParams: any[] = [...baseParams, reportingCurrency]

    // 计算日期范围（天数）
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const end = endDate ? new Date(endDate) : new Date()
    const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) || 1

    // 1. 整体预算使用情况
    const overallBudget = await db.queryOne(`
      SELECT
        SUM(c.budget_amount) as total_budget,
        SUM(cp.cost) as total_spent,
        COUNT(DISTINCT c.id) as active_campaigns
      FROM campaigns c
      INNER JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
      LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
        AND ${whereConditions.join(' AND ')}
      WHERE c.user_id = ? AND c.status = 'ENABLED'
        AND COALESCE(gaa.currency, 'USD') = ?
        ${campaignId ? 'AND c.id = ?' : ''}
    `, [...params, userId, reportingCurrency, ...(campaignId ? [campaignId] : [])]) as any

    const allCampaignSpend = await db.queryOne(`
      SELECT
        COALESCE(SUM(cp.cost), 0) as total_spent_all_campaigns
      FROM campaign_performance cp
      WHERE ${allCampaignSpendWhereConditions.join(' AND ')}
    `, allCampaignSpendParams) as any

    const totalBudgetRaw = toNumber(overallBudget.total_budget)
    const totalSpentRaw = toNumber(overallBudget.total_spent)
    const totalSpentAllCampaignsRaw = toNumber(allCampaignSpend.total_spent_all_campaigns)
    const totalBudget = roundTo2(totalBudgetRaw)
    const totalSpent = roundTo2(totalSpentRaw)
    const totalSpentAllCampaigns = roundTo2(totalSpentAllCampaignsRaw)
    const activeCampaigns = toNumber(overallBudget.active_campaigns)
    const remaining = roundTo2(totalBudget - totalSpent)
    const utilizationRate = totalBudgetRaw > 0 ? (totalSpentRaw / totalBudgetRaw) * 100 : 0
    const dailyAvgSpend = totalSpentRaw / daysDiff
    const projectedTotalSpend = dailyAvgSpend * 30 // 预测30天花费

    // 2. 按Campaign的预算使用
    const campaignBudgets = await db.query(`
      SELECT
        c.id,
        c.campaign_name,
        c.budget_amount,
        c.budget_type,
        o.brand as offer_brand,
        SUM(cp.cost) as spent,
        SUM(cp.conversions) as conversions,
        COUNT(DISTINCT cp.date) as active_days
      FROM campaigns c
      INNER JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
      LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
        AND ${whereConditions.join(' AND ')}
      LEFT JOIN offers o ON c.offer_id = o.id
      WHERE c.user_id = ? AND c.status = 'ENABLED'
        AND COALESCE(gaa.currency, 'USD') = ?
        ${campaignId ? 'AND c.id = ?' : ''}
      GROUP BY c.id, c.campaign_name, c.budget_amount, c.budget_type, o.brand
      ORDER BY c.budget_amount DESC
    `, [...params, userId, reportingCurrency, ...(campaignId ? [campaignId] : [])]) as any[]

    const campaignBudgetData = campaignBudgets.map((row) => {
      const budgetRaw = toNumber(row.budget_amount)
      const spentRaw = toNumber(row.spent)
      const budget = roundTo2(budgetRaw)
      const spent = roundTo2(spentRaw)
      const conversions = toNumber(row.conversions)
      const activeDays = toNumber(row.active_days)

      const remaining = roundTo2(budget - spent)
      const utilizationRate = budgetRaw > 0 ? (spentRaw / budgetRaw) * 100 : 0
      const dailyAvg = activeDays > 0 ? spentRaw / activeDays : 0
      const daysRemaining = budget > 0 && dailyAvg > 0 ? remaining / dailyAvg : 0
      const isOverBudget = spentRaw > budgetRaw
      const isNearBudget = utilizationRate >= 80 && utilizationRate < 100

      return {
        campaignId: row.id,
        campaignName: row.campaign_name,
        offerBrand: row.offer_brand,
        budgetType: row.budget_type,
        budget,
        spent,
        remaining,
        utilizationRate: roundTo2(utilizationRate),
        dailyAvgSpend: roundTo2(dailyAvg),
        daysRemaining: parseFloat(daysRemaining.toFixed(1)),
        conversions,
        isOverBudget,
        isNearBudget,
        status: isOverBudget ? 'over_budget' : isNearBudget ? 'near_budget' : 'on_track',
      }
    })

    // 3. 预算使用趋势（按日）
    const budgetTrend = await db.query(`
      SELECT
        DATE(cp.date) as date,
        SUM(cp.cost) as daily_spent
      FROM campaign_performance cp
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY DATE(cp.date)
      ORDER BY date ASC
    `, params) as any[]

    let cumulativeSpent = 0
    const budgetTrendData = budgetTrend.map((row) => {
      const dailySpent = toNumber(row.daily_spent)
      cumulativeSpent += dailySpent
      return {
        date: row.date,
        dailySpent: parseFloat(dailySpent.toFixed(2)),
        cumulativeSpent: parseFloat(cumulativeSpent.toFixed(2)),
      }
    })

    // 4. 预算分配分析（按Offer）
    const budgetByOffer = await db.query(`
      SELECT
        o.id,
        o.brand,
        o.product_name,
        SUM(c.budget_amount) as allocated_budget,
        SUM(cp.cost) as spent,
        COUNT(DISTINCT c.id) as campaign_count,
        SUM(cp.conversions) as conversions
      FROM campaigns c
      INNER JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
      LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
        AND ${whereConditions.join(' AND ')}
      LEFT JOIN offers o ON c.offer_id = o.id
      WHERE c.user_id = ? AND o.id IS NOT NULL
        AND COALESCE(gaa.currency, 'USD') = ?
        ${campaignId ? 'AND c.id = ?' : ''}
      GROUP BY o.id, o.brand, o.product_name
      HAVING SUM(cp.cost) > 0
      ORDER BY spent DESC
      LIMIT 10
    `, [...params, userId, reportingCurrency, ...(campaignId ? [campaignId] : [])]) as any[]

    const budgetByOfferData = budgetByOffer.map((row) => {
      const allocatedBudget = toNumber(row.allocated_budget)
      const spent = toNumber(row.spent)
      const conversions = toNumber(row.conversions)
      const campaignCount = toNumber(row.campaign_count)
      const utilizationRate = allocatedBudget > 0 ? (spent / allocatedBudget) * 100 : 0

      return {
        offerId: row.id,
        brand: row.brand,
        productName: row.product_name,
        allocatedBudget: roundTo2(allocatedBudget),
        spent: roundTo2(spent),
        utilizationRate: roundTo2(utilizationRate),
        campaignCount,
        conversions,
      }
    })

    // 5. 预算警报
    const alerts: any[] = []

    // 超预算的Campaign
    const overBudgetCampaigns = campaignBudgetData.filter((c) => c.isOverBudget)
    if (overBudgetCampaigns.length > 0) {
      alerts.push({
        type: 'over_budget',
        severity: 'critical',
        message: `${overBudgetCampaigns.length} 个Campaign超出预算`,
        campaigns: overBudgetCampaigns.map((c) => ({
          id: c.campaignId,
          name: c.campaignName,
          overBy: parseFloat((c.spent - c.budget).toFixed(2)),
        })),
      })
    }

    // 接近预算的Campaign
    const nearBudgetCampaigns = campaignBudgetData.filter((c) => c.isNearBudget)
    if (nearBudgetCampaigns.length > 0) {
      alerts.push({
        type: 'near_budget',
        severity: 'warning',
        message: `${nearBudgetCampaigns.length} 个Campaign接近预算限制`,
        campaigns: nearBudgetCampaigns.map((c) => ({
          id: c.campaignId,
          name: c.campaignName,
          remaining: c.remaining,
          daysRemaining: c.daysRemaining,
        })),
      })
    }

    // 预算利用率过低
    const underutilizedCampaigns = campaignBudgetData.filter(
      (c) => c.utilizationRate < 20 && c.budget > 100
    )
    if (underutilizedCampaigns.length > 0) {
      alerts.push({
        type: 'underutilized',
        severity: 'info',
        message: `${underutilizedCampaigns.length} 个Campaign预算利用率过低`,
        campaigns: underutilizedCampaigns.map((c) => ({
          id: c.campaignId,
          name: c.campaignName,
          utilizationRate: c.utilizationRate,
        })),
      })
    }

    // 6. 预算优化建议
    const recommendations: any[] = []

    // 建议增加高ROI Campaign的预算
    const highRoiCampaigns = campaignBudgetData
      .filter((c) => c.conversions > 10 && c.utilizationRate > 90)
      .slice(0, 3)
    if (highRoiCampaigns.length > 0) {
      recommendations.push({
        type: 'increase_budget',
        message: '建议增加高转化Campaign的预算',
        campaigns: highRoiCampaigns.map((c) => c.campaignName),
      })
    }

    // 建议暂停低效Campaign
    const lowPerformanceCampaigns = campaignBudgetData
      .filter((c) => c.conversions === 0 && c.spent > 50)
      .slice(0, 3)
    if (lowPerformanceCampaigns.length > 0) {
      recommendations.push({
        type: 'pause_campaign',
        message: '建议暂停或优化零转化Campaign',
        campaigns: lowPerformanceCampaigns.map((c) => c.campaignName),
      })
    }

    return NextResponse.json({
      success: true,
      currency: reportingCurrency,
      currencies,
      hasMixedCurrency,
      data: {
        overall: {
          totalBudget,
          totalSpent,
          totalSpentEnabledCampaigns: totalSpent,
          totalSpentAllCampaigns,
          remaining,
          utilizationRate: roundTo2(utilizationRate),
          dailyAvgSpend: roundTo2(dailyAvgSpend),
          projectedTotalSpend: roundTo2(projectedTotalSpend),
          activeCampaigns,
        },
        byCampaign: campaignBudgetData,
        trend: budgetTrendData,
        byOffer: budgetByOfferData,
        alerts,
        recommendations,
      },
    })
  } catch (error: any) {
    console.error('获取预算分析数据失败:', error)
    return NextResponse.json(
      { error: '获取预算分析数据失败', message: error.message },
      { status: 500 }
    )
  }
}
