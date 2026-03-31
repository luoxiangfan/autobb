import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { convertCurrency } from '@/lib/currency'
import { getCommissionPerConversion as getOfferCommissionPerConversion } from '@/lib/offer-monetization'

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeCurrency(value: unknown): string {
  const normalized = String(value ?? '').trim().toUpperCase()
  return normalized || 'USD'
}

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.floor(parsed))
}

function parseOptionalInt(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.floor(parsed)
}

function getCommissionPerConversion(
  productPrice: unknown,
  commissionPayout: unknown,
  targetCountry: unknown,
  reportingCurrency: string
): number {
  const parsed = getOfferCommissionPerConversion({
    productPrice: String(productPrice || ''),
    commissionPayout: String(commissionPayout || ''),
    targetCountry: String(targetCountry || ''),
  })
  if (!parsed || !(parsed.amount > 0)) return 0

  const sourceCurrency = normalizeCurrency(parsed.currency)
  if (sourceCurrency === reportingCurrency) {
    return parsed.amount
  }

  try {
    return convertCurrency(parsed.amount, sourceCurrency, reportingCurrency)
  } catch {
    return 0
  }
}

/**
 * GET /api/keywords/performance
 * Query:
 * - days: number (default 7)
 * - offerId: number (optional)
 * - campaignId: number (optional)
 * - limit: number (default 100, max 500)
 * - currency: string (optional)
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request)
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const days = Math.min(parsePositiveInt(searchParams.get('days'), 7), 90)
    const limit = Math.min(parsePositiveInt(searchParams.get('limit'), 100), 500)
    const offerId = parseOptionalInt(searchParams.get('offerId'))
    const campaignId = parseOptionalInt(searchParams.get('campaignId'))
    const requestedCurrency = searchParams.get('currency')
      ? normalizeCurrency(searchParams.get('currency'))
      : null

    const userId = auth.user.userId
    const db = await getDatabase()

    const endDate = new Date().toISOString().slice(0, 10)
    const startDateObj = new Date()
    startDateObj.setDate(startDateObj.getDate() - (days - 1))
    const startDate = startDateObj.toISOString().slice(0, 10)

    const whereConditions: string[] = [
      'k.user_id = ?',
      'cp.user_id = ?',
      'cp.date >= ?',
      'cp.date <= ?',
    ]
    const baseParams: any[] = [userId, userId, startDate, endDate]

    if (offerId) {
      whereConditions.push('c.offer_id = ?')
      baseParams.push(offerId)
    }

    if (campaignId) {
      whereConditions.push('c.id = ?')
      baseParams.push(campaignId)
    }

    const currencyRows = await db.query<any>(
      `
        SELECT
          COALESCE(cp.currency, gaa.currency, 'USD') as currency,
          COALESCE(SUM(cp.cost), 0) as total_cost
        FROM keywords k
        INNER JOIN ad_groups ag ON k.ad_group_id = ag.id AND ag.user_id = ?
        INNER JOIN campaigns c ON ag.campaign_id = c.id AND c.user_id = ?
        INNER JOIN campaign_performance cp ON cp.campaign_id = c.id
        LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
        WHERE ${whereConditions.join(' AND ')}
        GROUP BY COALESCE(cp.currency, gaa.currency, 'USD')
        ORDER BY total_cost DESC
      `,
      baseParams
    )

    const currencies = Array.from(new Set(
      (currencyRows || [])
        .map((row: any) => normalizeCurrency(row.currency))
        .filter(Boolean)
    ))

    const reportingCurrency = requestedCurrency && currencies.includes(requestedCurrency)
      ? requestedCurrency
      : (currencies[0] || 'USD')

    const queryParams = [...baseParams, reportingCurrency, limit]

    const rows = await db.query<any>(
      `
        SELECT
          k.id as keyword_id,
          k.keyword_text,
          k.match_type,
          k.status as keyword_status,
          k.ad_group_id,
          ag.ad_group_name,
          c.id as campaign_id,
          c.campaign_name,
          c.offer_id,
          o.brand as offer_brand,
          o.offer_name,
          o.target_country,
          o.product_price,
          o.commission_payout,
          COALESCE(SUM(cp.impressions), 0) as impressions,
          COALESCE(SUM(cp.clicks), 0) as clicks,
          COALESCE(SUM(cp.conversions), 0) as conversions,
          COALESCE(SUM(cp.cost), 0) as cost,
          COALESCE(cp.currency, gaa.currency, 'USD') as currency
        FROM keywords k
        INNER JOIN ad_groups ag ON k.ad_group_id = ag.id AND ag.user_id = ?
        INNER JOIN campaigns c ON ag.campaign_id = c.id AND c.user_id = ?
        LEFT JOIN offers o ON c.offer_id = o.id
        LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
        INNER JOIN campaign_performance cp ON cp.campaign_id = c.id
        WHERE ${whereConditions.join(' AND ')}
          AND COALESCE(cp.currency, gaa.currency, 'USD') = ?
        GROUP BY
          k.id,
          k.keyword_text,
          k.match_type,
          k.status,
          k.ad_group_id,
          ag.ad_group_name,
          c.id,
          c.campaign_name,
          c.offer_id,
          o.brand,
          o.offer_name,
          o.target_country,
          o.product_price,
          o.commission_payout,
          COALESCE(cp.currency, gaa.currency, 'USD')
        ORDER BY cost DESC, clicks DESC
        LIMIT ?
      `,
      queryParams
    )

    const data = (rows || []).map((row: any) => {
      const impressions = toNumber(row.impressions)
      const clicks = toNumber(row.clicks)
      const conversions = toNumber(row.conversions)
      const cost = toNumber(row.cost)
      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0
      const cvr = clicks > 0 ? (conversions / clicks) * 100 : 0
      const cpc = clicks > 0 ? cost / clicks : 0

      const commissionPerConversion = getCommissionPerConversion(
        row.product_price,
        row.commission_payout,
        row.target_country,
        reportingCurrency
      )
      const estimatedRevenue = conversions * commissionPerConversion
      const roas = cost > 0 ? estimatedRevenue / cost : 0

      return {
        keywordId: Number(row.keyword_id),
        keywordText: row.keyword_text,
        matchType: row.match_type,
        keywordStatus: row.keyword_status,
        adGroupId: Number(row.ad_group_id),
        adGroupName: row.ad_group_name,
        campaignId: Number(row.campaign_id),
        campaignName: row.campaign_name,
        offerId: row.offer_id ? Number(row.offer_id) : null,
        offerBrand: row.offer_brand || null,
        offerName: row.offer_name || null,
        currency: normalizeCurrency(row.currency),
        metrics: {
          impressions,
          clicks,
          conversions,
          cost: Number(cost.toFixed(2)),
          ctr: Number(ctr.toFixed(2)),
          cvr: Number(cvr.toFixed(2)),
          cpc: Number(cpc.toFixed(4)),
          roas: Number(roas.toFixed(4)),
          estimatedRevenue: Number(estimatedRevenue.toFixed(2)),
        },
      }
    })

    const summary = data.reduce((acc, row) => {
      acc.impressions += row.metrics.impressions
      acc.clicks += row.metrics.clicks
      acc.conversions += row.metrics.conversions
      acc.cost += row.metrics.cost
      acc.estimatedRevenue += row.metrics.estimatedRevenue
      return acc
    }, {
      impressions: 0,
      clicks: 0,
      conversions: 0,
      cost: 0,
      estimatedRevenue: 0,
    })

    const summaryCtr = summary.impressions > 0 ? (summary.clicks / summary.impressions) * 100 : 0
    const summaryCvr = summary.clicks > 0 ? (summary.conversions / summary.clicks) * 100 : 0
    const summaryCpc = summary.clicks > 0 ? summary.cost / summary.clicks : 0
    const summaryRoas = summary.cost > 0 ? summary.estimatedRevenue / summary.cost : 0

    return NextResponse.json({
      success: true,
      data,
      summary: {
        ...summary,
        cost: Number(summary.cost.toFixed(2)),
        estimatedRevenue: Number(summary.estimatedRevenue.toFixed(2)),
        ctr: Number(summaryCtr.toFixed(2)),
        cvr: Number(summaryCvr.toFixed(2)),
        cpc: Number(summaryCpc.toFixed(4)),
        roas: Number(summaryRoas.toFixed(4)),
      },
      filters: {
        days,
        startDate,
        endDate,
        offerId,
        campaignId,
        limit,
        currency: reportingCurrency,
        availableCurrencies: currencies,
      },
      meta: {
        source: 'keywords + campaign_performance',
      },
    })
  } catch (error: any) {
    console.error('获取关键词表现失败:', error)
    return NextResponse.json(
      { error: error?.message || '获取关键词表现失败' },
      { status: 500 }
    )
  }
}
