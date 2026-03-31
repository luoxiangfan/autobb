import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

function formatLocalYmd(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeDateToYmd(value: unknown): string | null {
  if (value === null || value === undefined) return null

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }

  const raw = String(value).trim()
  if (!raw) return null

  const ymdMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  if (ymdMatch) return ymdMatch[1]

  const parsed = Date.parse(raw)
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed).toISOString().slice(0, 10)
}

function buildYmdDateRange(startYmd: string, endYmd: string): string[] {
  const range: string[] = []
  const cursor = new Date(`${startYmd}T00:00:00.000Z`)
  const end = new Date(`${endYmd}T00:00:00.000Z`)

  while (cursor.getTime() <= end.getTime()) {
    range.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return range
}

/**
 * GET /api/dashboard/trends
 * 获取广告表现数据趋势
 * P2-1优化新增
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.user.userId

    // 获取查询参数
    const searchParams = request.nextUrl.searchParams
    const days = parseInt(searchParams.get('days') || '7', 10)

    // 计算日期范围（使用本地时区，days=7 表示含今天在内的7天窗口）
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days + 1)
    const startDateStr = formatLocalYmd(startDate)
    const endDateStr = formatLocalYmd(endDate)

    // 获取数据库实例
    const db = await getDatabase()

    // 查询货币分布：
    // - 先按最近有数据的日期排序，避免默认命中“高花费但已停更”的旧币种
    // - 再按花费排序作为同日并列时的次级依据
    const currencyRows = await db.query<any>(`
      SELECT
        COALESCE(currency, 'USD') as currency,
        COALESCE(SUM(cost), 0) as total_cost,
        MAX(date) as latest_date
      FROM campaign_performance
      WHERE user_id = ?
        AND date >= ?
        AND date <= ?
      GROUP BY COALESCE(currency, 'USD')
      ORDER BY latest_date DESC, total_cost DESC, currency ASC
    `, [userId, startDateStr, endDateStr])

    const currencies = Array.from(
      new Set(
        (currencyRows || [])
          .map((r: any) => String(r.currency || '').trim().toUpperCase())
          .filter(Boolean)
      )
    )
    const hasMixedCurrency = currencies.length > 1
    const summaryCurrency = hasMixedCurrency
      ? 'MIXED'
      : (currencies[0] || 'USD')
    const costs = (currencyRows || [])
      .map((row: any) => ({
        currency: String(row.currency || '').trim().toUpperCase() || 'USD',
        amount: Number(row.total_cost) || 0,
      }))
      .filter((item: { currency: string; amount: number }) => Number.isFinite(item.amount))

    // 查询每日表现数据
    const query = `
      SELECT
        DATE(date) as date,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(cost) as cost,
        SUM(conversions) as conversions
      FROM campaign_performance
      WHERE user_id = ?
        AND date >= ?
        AND date <= ?
      GROUP BY DATE(date)
      ORDER BY date ASC
    `

    const rows = await db.query(query, [
      userId,
      startDateStr,
      endDateStr,
    ]) as Array<{
      date: string
      impressions: number
      clicks: number
      cost: number
      conversions: number
    }>

    // 按日期补齐空缺，避免“无消耗日”导致曲线提前截止。
    const rowsByDate = new Map<string, {
      impressions: number
      clicks: number
      cost: number
      conversions: number
    }>()

    for (const row of rows) {
      const date = normalizeDateToYmd(row.date)
      if (!date) continue

      const current = rowsByDate.get(date) || { impressions: 0, clicks: 0, cost: 0, conversions: 0 }
      current.impressions += Number(row.impressions) || 0
      current.clicks += Number(row.clicks) || 0
      current.cost += Number(row.cost) || 0
      current.conversions += Number(row.conversions) || 0
      rowsByDate.set(date, current)
    }

    const trends = buildYmdDateRange(startDateStr, endDateStr).map((date) => {
      const row = rowsByDate.get(date) || { impressions: 0, clicks: 0, cost: 0, conversions: 0 }
      return {
        date,
        impressions: row.impressions,
        clicks: row.clicks,
        cost: row.cost,
        conversions: row.conversions,
        ctr: row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0,
        cpc: row.clicks > 0 ? row.cost / row.clicks : 0,
      }
    })

    const summary = {
      totalImpressions: trends.reduce((sum, row) => sum + (Number(row.impressions) || 0), 0),
      totalClicks: trends.reduce((sum, row) => sum + (Number(row.clicks) || 0), 0),
      totalCost: trends.reduce((sum, row) => sum + (Number(row.cost) || 0), 0),
      totalConversions: trends.reduce((sum, row) => sum + (Number(row.conversions) || 0), 0),
      avgCTR: 0,
      avgCPC: 0,
      currency: summaryCurrency,
      currencies,
      hasMixedCurrency,
      costs,
    }

    // 计算平均CTR和CPC
    if (summary.totalImpressions > 0) {
      summary.avgCTR = (summary.totalClicks / summary.totalImpressions) * 100
    }
    if (summary.totalClicks > 0) {
      summary.avgCPC = summary.totalCost / summary.totalClicks
    }

    return NextResponse.json({
      success: true,
      data: {
        trends,
        summary,
      },
    })
  } catch (error) {
    console.error('获取趋势数据失败:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      },
      { status: 500 }
    )
  }
}
