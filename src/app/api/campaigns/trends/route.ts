import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { convertCurrency } from '@/lib/currency'
import { buildAffiliateUnattributedFailureFilter } from '@/lib/openclaw/affiliate-attribution-failures'

function normalizeCurrency(value: unknown): string {
  const normalized = String(value ?? '').trim().toUpperCase()
  return normalized || 'USD'
}

function formatLocalYmd(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function parseYmdParam(value: string | null): string | null {
  if (!value) return null
  const normalized = String(value).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null

  const [year, month, day] = normalized.split('-').map((part) => Number(part))
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null
  }

  return normalized
}

function diffDaysInclusive(startYmd: string, endYmd: string): number {
  const startTs = Date.parse(`${startYmd}T00:00:00Z`)
  const endTs = Date.parse(`${endYmd}T00:00:00Z`)
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) return 1
  return Math.max(1, Math.floor((endTs - startTs) / (24 * 60 * 60 * 1000)) + 1)
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

const BASE_CURRENCY = 'USD'

function normalizeDateKey(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }

  const raw = String(value ?? '').trim()
  if (!raw) return ''

  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  if (match) return match[1]

  const parsed = Date.parse(raw)
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10)
  }

  return raw
}

/**
 * GET /api/campaigns/trends
 *
 * 获取所有 Campaign 的趋势数据（按日期聚合）
 * 转化口径改为佣金。
 *
 * Query Parameters:
 * - daysBack: number (可选，默认7天)
 * - start_date: string (可选，YYYY-MM-DD)
 * - end_date: string (可选，YYYY-MM-DD)
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const { searchParams } = new URL(request.url)
    const rawDaysBack = parseInt(searchParams.get('daysBack') || '7', 10)
    const daysBack = Number.isFinite(rawDaysBack) ? Math.min(Math.max(rawDaysBack, 1), 3650) : 7
    const startDateQuery = parseYmdParam(searchParams.get('start_date'))
    const endDateQuery = parseYmdParam(searchParams.get('end_date'))
    const hasCustomRangeQuery = searchParams.has('start_date') || searchParams.has('end_date')
    if (hasCustomRangeQuery) {
      if (!startDateQuery || !endDateQuery) {
        return NextResponse.json(
          { error: 'start_date 和 end_date 必须同时提供，且格式为 YYYY-MM-DD' },
          { status: 400 }
        )
      }
      if (startDateQuery > endDateQuery) {
        return NextResponse.json(
          { error: 'start_date 不能晚于 end_date' },
          { status: 400 }
        )
      }
    }
    const requestedCurrencyRaw = searchParams.get('currency')
    const requestedCurrency = requestedCurrencyRaw ? normalizeCurrency(requestedCurrencyRaw) : null

    const db = await getDatabase()

    let startDateStr = startDateQuery || ''
    let endDateStr = endDateQuery || ''
    let rangeDays = daysBack
    if (!startDateStr || !endDateStr) {
      const endDate = new Date()
      const startDate = new Date(endDate)
      startDate.setDate(startDate.getDate() - daysBack + 1)
      startDateStr = formatLocalYmd(startDate)
      endDateStr = formatLocalYmd(endDate)
      rangeDays = daysBack
    } else {
      rangeDays = diffDaysInclusive(startDateStr, endDateStr)
    }

    const currencyRows = await db.query<any>(
      `
      SELECT
        COALESCE(currency, 'USD') as currency,
        SUM(cost) as cost
      FROM campaign_performance
      WHERE user_id = ?
        AND date >= ?
        AND date <= ?
      GROUP BY COALESCE(currency, 'USD')
      ORDER BY cost DESC
      `,
      [userId, startDateStr, endDateStr]
    )

    const costCurrencies = currencyRows
      .map((r) => normalizeCurrency(r.currency))
      .filter((v, idx, arr) => arr.indexOf(v) === idx)

    const adTrends = await db.query<any>(
      `
      SELECT
        DATE(date) as date,
        COALESCE(currency, 'USD') as currency,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(cost) as cost
      FROM campaign_performance
      WHERE user_id = ?
        AND date >= ?
        AND date <= ?
      GROUP BY DATE(date), COALESCE(currency, 'USD')
      ORDER BY date ASC, currency ASC
      `,
      [userId, startDateStr, endDateStr]
    )

    const queryAttributedCommissionTrends = async () => db.query<any>(
      `
      SELECT
        report_date as date,
        COALESCE(currency, 'USD') as currency,
        COALESCE(SUM(commission_amount), 0) as commission
      FROM affiliate_commission_attributions
      WHERE user_id = ?
        AND report_date >= ?
        AND report_date <= ?
      GROUP BY report_date, COALESCE(currency, 'USD')
      ORDER BY report_date ASC, currency ASC
      `,
      [userId, startDateStr, endDateStr]
    )

    const queryUnattributedCommissionTrends = async (): Promise<any[]> => {
      const unattributedFailureFilter = buildAffiliateUnattributedFailureFilter({
        // Include all unattributed commissions (including campaign_mapping_miss)
        // to match affiliate backend daily totals
        includePendingWithinGrace: true,
        includeAllFailures: true,
      })
      try {
        return await db.query<any>(
          `
          SELECT
            report_date as date,
            COALESCE(currency, 'USD') as currency,
            COALESCE(SUM(commission_amount), 0) as commission
          FROM openclaw_affiliate_attribution_failures
          WHERE user_id = ?
            AND report_date >= ?
            AND report_date <= ?
            AND ${unattributedFailureFilter.sql}
          GROUP BY report_date, COALESCE(currency, 'USD')
          ORDER BY report_date ASC, currency ASC
          `,
          [userId, startDateStr, endDateStr, ...unattributedFailureFilter.values]
        )
      } catch (error: any) {
        const message = String(error?.message || '')
        if (
          /openclaw_affiliate_attribution_failures/i.test(message)
          && /(no such table|does not exist)/i.test(message)
        ) {
          return []
        }
        throw error
      }
    }

    const [attributedCommissionTrends, unattributedCommissionTrends] = await Promise.all([
      queryAttributedCommissionTrends(),
      queryUnattributedCommissionTrends(),
    ])

    const commissionCurrencies = Array.from(new Set([
      ...attributedCommissionTrends.map((row) => normalizeCurrency(row.currency)),
      ...unattributedCommissionTrends.map((row) => normalizeCurrency(row.currency)),
    ]))
    const availableCurrencies = Array.from(new Set([
      ...costCurrencies,
      ...commissionCurrencies,
    ]))
    const isFilteredByCurrency = Boolean(requestedCurrency && availableCurrencies.includes(requestedCurrency))
    const reportingCostCurrencies = isFilteredByCurrency
      ? [String(requestedCurrency)]
      : costCurrencies
    const reportingCommissionCurrencies = isFilteredByCurrency
      ? [String(requestedCurrency)]
      : availableCurrencies
    const reportingCurrency = isFilteredByCurrency
      ? String(requestedCurrency)
      : (reportingCostCurrencies[0] || reportingCommissionCurrencies[0] || BASE_CURRENCY)
    const hasMixedCurrency = availableCurrencies.length > 1

    const adMap = new Map<string, Map<string, { impressions: number; clicks: number; cost: number }>>()
    for (const row of adTrends) {
      const date = normalizeDateKey(row.date)
      const currency = normalizeCurrency(row.currency)
      if (!reportingCostCurrencies.includes(currency)) continue

      const byCurrency = adMap.get(date) ?? new Map<string, { impressions: number; clicks: number; cost: number }>()
      byCurrency.set(currency, {
        impressions: Number(row.impressions) || 0,
        clicks: Number(row.clicks) || 0,
        cost: Number(row.cost) || 0,
      })
      adMap.set(date, byCurrency)
    }

    const commissionMap = new Map<string, Map<string, number>>()
    const appendCommissionRows = (rows: any[]) => {
      for (const row of rows) {
        const date = normalizeDateKey(row.date)
        const currency = normalizeCurrency(row.currency)
        if (!reportingCommissionCurrencies.includes(currency)) continue

        const commission = Number(row.commission) || 0
        const byCurrency = commissionMap.get(date) ?? new Map<string, number>()
        byCurrency.set(currency, (byCurrency.get(currency) || 0) + commission)
        commissionMap.set(date, byCurrency)
      }
    }
    appendCommissionRows(attributedCommissionTrends)
    appendCommissionRows(unattributedCommissionTrends)

    const dates = Array.from(new Set<string>([
      ...Array.from(adMap.keys()),
      ...Array.from(commissionMap.keys()),
    ])).sort((a, b) => a.localeCompare(b))

    const convertToBase = (amount: number, currency: string): number => {
      const normalized = normalizeCurrency(currency)
      if (normalized === BASE_CURRENCY) return amount
      try {
        return convertCurrency(amount, normalized, BASE_CURRENCY)
      } catch {
        return 0
      }
    }

    const costTotalsByCurrency = new Map<string, number>()
    const commissionTotalsByCurrency = new Map<string, number>()
    let totalCostBase = 0
    let totalCommissionBase = 0
    let totalClicks = 0
    let totalImpressions = 0

    const formattedTrends = dates.map((date) => {
      const adByCurrency = adMap.get(date) ?? new Map<string, { impressions: number; clicks: number; cost: number }>()
      const commissionByCurrency = commissionMap.get(date) ?? new Map<string, number>()

      const row: Record<string, string | number> = { date }

      let impressions = 0
      let clicks = 0
      let costBase = 0
      let commissionBase = 0

      reportingCostCurrencies.forEach((currency) => {
        const ad = adByCurrency.get(currency)
        const currencyCost = Number(ad?.cost) || 0
        const currencyImpressions = Number(ad?.impressions) || 0
        const currencyClicks = Number(ad?.clicks) || 0

        row[`cost_${currency}`] = roundTo2(currencyCost)

        impressions += currencyImpressions
        clicks += currencyClicks
        costBase += convertToBase(currencyCost, currency)

        costTotalsByCurrency.set(currency, (costTotalsByCurrency.get(currency) || 0) + currencyCost)
      })

      reportingCommissionCurrencies.forEach((currency) => {
        const currencyCommission = Number(commissionByCurrency.get(currency)) || 0

        row[`commission_${currency}`] = roundTo2(currencyCommission)
        commissionBase += convertToBase(currencyCommission, currency)
        commissionTotalsByCurrency.set(currency, (commissionTotalsByCurrency.get(currency) || 0) + currencyCommission)
      })

      totalImpressions += impressions
      totalClicks += clicks
      totalCostBase += costBase
      totalCommissionBase += commissionBase

      const commissionPerClick = clicks > 0 ? commissionBase / clicks : 0
      const costPerCommission = commissionBase > 0 ? costBase / commissionBase : 0
      const roas = costBase > 0 ? commissionBase / costBase : 0

      return {
        ...row,
        impressions,
        clicks,
        conversions: roundTo2(commissionBase),
        commission: roundTo2(commissionBase),
        cost: roundTo2(costBase),
        ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
        conversionRate: roundTo2(commissionPerClick),
        commissionPerClick: roundTo2(commissionPerClick),
        avgCpc: clicks > 0 ? roundTo2(costBase / clicks) : 0,
        roas: roundTo2(roas),
        avgCpa: roundTo2(costPerCommission),
        costPerCommission: roundTo2(costPerCommission),
      }
    })

    const costsByCurrency = reportingCostCurrencies.map((currency) => ({
      currency,
      amount: roundTo2(costTotalsByCurrency.get(currency) || 0),
    }))
    const commissionsByCurrency = reportingCommissionCurrencies.map((currency) => ({
      currency,
      amount: roundTo2(commissionTotalsByCurrency.get(currency) || 0),
    }))

    const totalCpcBase = totalClicks > 0 ? totalCostBase / totalClicks : 0
    const totalRoasBase = totalCostBase > 0 ? totalCommissionBase / totalCostBase : 0

    return NextResponse.json({
      success: true,
      trends: formattedTrends,
      dateRange: {
        start: startDateStr,
        end: endDateStr,
        days: rangeDays,
      },
      summary: {
        currency: reportingCostCurrencies.length > 1 ? 'MIXED' : reportingCurrency,
        currencies: reportingCostCurrencies,
        hasMixedCurrency,
        baseCurrency: BASE_CURRENCY,
        totalsConverted: {
          cost: roundTo2(totalCostBase),
          commission: roundTo2(totalCommissionBase),
          impressions: roundTo2(totalImpressions),
          clicks: roundTo2(totalClicks),
          cpc: roundTo2(totalCpcBase),
          roas: roundTo2(totalRoasBase),
        },
        costsByCurrency,
        commissionsByCurrency,
      },
    })
  } catch (error: any) {
    console.error('Get campaigns trends error:', error)
    return NextResponse.json(
      { error: error.message || '获取趋势数据失败' },
      { status: 500 }
    )
  }
}
