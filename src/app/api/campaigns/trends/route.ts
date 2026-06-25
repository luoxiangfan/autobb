import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { convertCurrency } from '@/lib/common/server'
import { buildAffiliateUnattributedFailureFilter } from '@/lib/openclaw/affiliate-commission/affiliate-attribution-failures'
import {
  buildCampaignTrendsCacheHash,
  getCachedCampaignTrends,
  setCachedCampaignTrends,
} from '@/lib/campaign/server'
import {
  filterCampaignRowIdsForTrendsScope,
  parseAffiliateTrendsParam,
  queryCampaignRowsForTrendsScope,
  resolveEffectiveUserIdsForCampaignScope,
} from '@/lib/campaign/server'

function normalizeCurrency(value: unknown): string {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()
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
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
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

function parseOptionalBoolean(value: string | null): boolean {
  if (value === null) return false
  const normalized = String(value).trim().toLowerCase()
  return normalized === 'true' || normalized === '1'
}

function parseOptionalBooleanParam(value: string | null): boolean | null {
  if (value === null) return null
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'true' || normalized === '1') return true
  if (normalized === 'false' || normalized === '0') return false
  return null
}

/* * Keep each IN list under PostgreSQL parameter limits (~999) with room for other binds. */
const CAMPAIGN_ID_IN_CHUNK = 350

function chunkIds(ids: number[]): number[][] {
  if (ids.length === 0) return []
  const chunks: number[][] = []
  for (let i = 0; i < ids.length; i += CAMPAIGN_ID_IN_CHUNK) {
    chunks.push(ids.slice(i, i + CAMPAIGN_ID_IN_CHUNK))
  }
  return chunks
}

function buildIdDisjunctionSql(
  columnExpr: string,
  chunks: number[][]
): { sql: string; values: number[] } {
  if (chunks.length === 0) return { sql: '1=0', values: [] }
  const parts = chunks.map((ch) => `${columnExpr} IN (${ch.map(() => '?').join(',')})`)
  return { sql: `(${parts.join(' OR ')})`, values: chunks.flat() }
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
 * Query Parameters
 * daysBack: number (可选，默认7天)
 * start_date: string (可选，YYYY-MM-DD)
 * end_date: string (可选，YYYY-MM-DD)
 */
export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request, user) => {
  try {
    const userId = user.userId
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
        return NextResponse.json({ error: 'start_date 不能晚于 end_date' }, { status: 400 })
      }
    }
    const requestedCurrencyRaw = searchParams.get('currency')
    const requestedCurrency = requestedCurrencyRaw ? normalizeCurrency(requestedCurrencyRaw) : null

    const affiliateFilterParam = searchParams.get('affiliate')
    const { affiliateFilter, affiliateDomainKeywords } =
      parseAffiliateTrendsParam(affiliateFilterParam)
    const hasAffiliateOfferLinkFilter = Boolean(
      affiliateFilterParam && affiliateFilter && affiliateDomainKeywords.length > 0
    )
    const affiliateOfferLikeClause = hasAffiliateOfferLinkFilter
      ? `AND (${affiliateDomainKeywords.map(() => 'o.affiliate_link LIKE ?').join(' OR ')})`
      : ''
    const affiliateOfferLikeParams = hasAffiliateOfferLinkFilter
      ? affiliateDomainKeywords.map((k) => `%${k}%`)
      : []

    const searchQuery = (searchParams.get('search') || '').trim().toLowerCase()
    const statusFilterRaw = (searchParams.get('status') || '').trim().toUpperCase()
    const statusFilter = ['ENABLED', 'PAUSED', 'REMOVED', 'ALL'].includes(statusFilterRaw)
      ? statusFilterRaw
      : ''
    const needsOfferCompletionFilter = (searchParams.get('needsOfferCompletion') || '')
      .trim()
      .toUpperCase()
    const statusCategoryFilter = (searchParams.get('statusCategory') || '').trim().toLowerCase()
    const showDeletedParam = parseOptionalBooleanParam(searchParams.get('showDeleted'))
    const idsParam = (searchParams.get('ids') || '').trim()
    const idsFilter = idsParam
      ? idsParam
          .split(',')
          .map((id) => Number.parseInt(id.trim(), 10))
          .filter((id) => Number.isFinite(id) && id > 0)
      : []
    const createdAtStartParam = searchParams.get('createdAtStart')
    const createdAtEndParam = searchParams.get('createdAtEnd')
    const userIdsParam = (searchParams.get('userIds') || '').trim()
    const requestedUserIds = userIdsParam
      ? Array.from(
          new Set(
            userIdsParam
              .split(',')
              .map((id) => Number.parseInt(id.trim(), 10))
              .filter((id) => Number.isFinite(id) && id > 0)
          )
        )
      : []
    const userIdFilterParam = searchParams.get('userId')
    const userIdFilter = userIdFilterParam ? Number.parseInt(userIdFilterParam, 10) : null
    const isAdmin = user.role === 'admin'
    const effectiveUserIds = resolveEffectiveUserIdsForCampaignScope({
      authUserId: userId,
      isAdmin,
      requestedUserIds,
      userIdFilterParam,
      userIdFilter,
    })

    const refresh = parseOptionalBoolean(searchParams.get('refresh'))
    const noCache = parseOptionalBoolean(searchParams.get('noCache'))
    const shouldBypassReadCache = refresh || noCache
    const shouldWriteCache = !noCache

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

    const cacheHash = buildCampaignTrendsCacheHash({
      startDate: startDateStr,
      endDate: endDateStr,
      currency: requestedCurrency,
      affiliate: affiliateFilter || null,
      search: searchQuery,
      status: statusFilter || 'ALL',
      needsOfferCompletion: needsOfferCompletionFilter || 'ALL',
      statusCategory: statusCategoryFilter || 'all',
      showDeleted: showDeletedParam,
      userIds: effectiveUserIds === null ? null : [...effectiveUserIds].sort((a, b) => a - b),
      ids: [...idsFilter].sort((a, b) => a - b),
      createdAtStart: createdAtStartParam,
      createdAtEnd: createdAtEndParam,
    })

    if (!shouldBypassReadCache) {
      const cached = await getCachedCampaignTrends<any>(userId, cacheHash)
      if (cached) {
        return NextResponse.json(cached)
      }
    }

    const db = await getDatabase()

    const campaignRows = await queryCampaignRowsForTrendsScope(db, {
      effectiveUserIds,
      affiliateDomainKeywords,
      createdAtStartParam,
      createdAtEndParam,
    })

    const scopedIds = filterCampaignRowIdsForTrendsScope(campaignRows, {
      searchQuery,
      statusFilter,
      needsOfferCompletionFilter,
      statusCategoryFilter,
      showDeletedParam,
      idsFilter,
    })

    const idChunks = chunkIds(scopedIds)
    const campaignIdDisjunction = buildIdDisjunctionSql('cp.campaign_id', idChunks)
    const attributionCampaignDisjunction = buildIdDisjunctionSql('a.campaign_id', idChunks)
    const scopedCampaignIdDisjunction = buildIdDisjunctionSql('c.id', idChunks)

    const buildEmptyTrendsPayload = () => ({
      success: true,
      trends: [] as any[],
      dateRange: {
        start: startDateStr,
        end: endDateStr,
        days: rangeDays,
      },
      summary: {
        currency: BASE_CURRENCY,
        currencies: [] as string[],
        hasMixedCurrency: false,
        baseCurrency: BASE_CURRENCY,
        totalsConverted: {
          cost: 0,
          commission: 0,
          impressions: 0,
          clicks: 0,
          cpc: 0,
          roas: 0,
        },
        costsByCurrency: [] as Array<{ currency: string; amount: number }>,
        commissionsByCurrency: [] as Array<{ currency: string; amount: number }>,
      },
    })

    if (idChunks.length === 0) {
      const responsePayload = buildEmptyTrendsPayload()
      if (shouldWriteCache) {
        await setCachedCampaignTrends(userId, cacheHash, responsePayload)
      }
      return NextResponse.json(responsePayload)
    }

    const perfFromJoin = `
      FROM campaign_performance cp
      INNER JOIN campaigns c ON c.id = cp.campaign_id AND c.user_id = cp.user_id
      ${hasAffiliateOfferLinkFilter ? 'INNER JOIN offers o ON o.id = c.offer_id' : ''}
      WHERE cp.date >= ?
        AND cp.date <= ?
        AND ${campaignIdDisjunction.sql}
        ${hasAffiliateOfferLinkFilter ? affiliateOfferLikeClause : ''}
    `

    const perfAggBinds = [
      startDateStr,
      endDateStr,
      ...campaignIdDisjunction.values,
      ...affiliateOfferLikeParams,
    ]

    const currencyRows = await db.query<any>(
      `
      SELECT
        COALESCE(cp.currency, 'USD') as currency,
        SUM(cp.cost) as cost
      ${perfFromJoin}
      GROUP BY COALESCE(cp.currency, 'USD')
      ORDER BY cost DESC
      `,
      perfAggBinds
    )

    const costCurrencies = currencyRows
      .map((r) => normalizeCurrency(r.currency))
      .filter((v, idx, arr) => arr.indexOf(v) === idx)

    const adTrends = await db.query<any>(
      `
      SELECT
        (cp.date::date) as date,
        COALESCE(cp.currency, 'USD') as currency,
        SUM(cp.impressions) as impressions,
        SUM(cp.clicks) as clicks,
        SUM(cp.cost) as cost
      ${perfFromJoin}
      GROUP BY (cp.date::date), COALESCE(cp.currency, 'USD')
      ORDER BY date ASC, currency ASC
      `,
      perfAggBinds
    )

    const queryAttributedCommissionTrends = async () =>
      db.query<any>(
        `
      SELECT
        a.report_date as date,
        COALESCE(a.currency, 'USD') as currency,
        COALESCE(SUM(a.commission_amount), 0) as commission
      FROM affiliate_commission_attributions a
      INNER JOIN campaigns c ON a.campaign_id = c.id
      ${hasAffiliateOfferLinkFilter ? 'INNER JOIN offers o ON o.id = c.offer_id' : ''}
      WHERE a.report_date >= ?
        AND a.report_date <= ?
        AND ${attributionCampaignDisjunction.sql}
        ${hasAffiliateOfferLinkFilter ? affiliateOfferLikeClause : ''}
      GROUP BY a.report_date, COALESCE(a.currency, 'USD')
      ORDER BY report_date ASC, currency ASC
      `,
        [
          startDateStr,
          endDateStr,
          ...attributionCampaignDisjunction.values,
          ...affiliateOfferLikeParams,
        ]
      )

    const queryUnattributedCommissionTrends = async (): Promise<any[]> => {
      const unattributedFailureFilter = buildAffiliateUnattributedFailureFilter({
        includePendingWithinGrace: true,
        includeAllFailures: true,
      })
      try {
        return await db.query<any>(
          `
          WITH scoped_campaigns AS (
            SELECT c.id, c.offer_id, c.user_id
            FROM campaigns c
            INNER JOIN offers o ON c.offer_id = o.id
            WHERE ${scopedCampaignIdDisjunction.sql}
              AND c.offer_id IS NOT NULL
              ${hasAffiliateOfferLinkFilter ? affiliateOfferLikeClause : ''}
          ),
          offer_campaign_counts AS (
            SELECT offer_id, COUNT(*) AS campaign_count
            FROM scoped_campaigns
            GROUP BY offer_id
          )
          SELECT
            f.report_date as date,
            COALESCE(f.currency, 'USD') as currency,
            COALESCE(SUM(f.commission_amount / occ.campaign_count), 0) as commission
          FROM openclaw_affiliate_attribution_failures f
          INNER JOIN scoped_campaigns sc ON f.offer_id = sc.offer_id
          INNER JOIN offer_campaign_counts occ ON sc.offer_id = occ.offer_id
          WHERE f.report_date >= ?
            AND f.report_date <= ?
            AND f.offer_id IS NOT NULL
            AND ${unattributedFailureFilter.sql}
          GROUP BY f.report_date, COALESCE(f.currency, 'USD')
          ORDER BY report_date ASC, currency ASC
          `,
          [
            ...scopedCampaignIdDisjunction.values,
            ...affiliateOfferLikeParams,
            startDateStr,
            endDateStr,
            ...unattributedFailureFilter.values,
          ]
        )
      } catch (error: any) {
        const message = String(error?.message || '')
        if (
          /openclaw_affiliate_attribution_failures/i.test(message) &&
          /(no such table|does not exist)/i.test(message)
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

    const commissionCurrencies = Array.from(
      new Set([
        ...attributedCommissionTrends.map((row) => normalizeCurrency(row.currency)),
        ...unattributedCommissionTrends.map((row) => normalizeCurrency(row.currency)),
      ])
    )
    const availableCurrencies = Array.from(new Set([...costCurrencies, ...commissionCurrencies]))
    const isFilteredByCurrency = Boolean(
      requestedCurrency && availableCurrencies.includes(requestedCurrency)
    )
    const reportingCostCurrencies = isFilteredByCurrency
      ? [String(requestedCurrency)]
      : costCurrencies
    const reportingCommissionCurrencies = isFilteredByCurrency
      ? [String(requestedCurrency)]
      : availableCurrencies
    const reportingCurrency = isFilteredByCurrency
      ? String(requestedCurrency)
      : reportingCostCurrencies[0] || reportingCommissionCurrencies[0] || BASE_CURRENCY
    const hasMixedCurrency = availableCurrencies.length > 1

    const adMap = new Map<
      string,
      Map<string, { impressions: number; clicks: number; cost: number }>
    >()
    for (const row of adTrends) {
      const date = normalizeDateKey(row.date)
      const currency = normalizeCurrency(row.currency)
      if (!reportingCostCurrencies.includes(currency)) continue

      const byCurrency =
        adMap.get(date) ?? new Map<string, { impressions: number; clicks: number; cost: number }>()
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

    const dates = Array.from(
      new Set<string>([...Array.from(adMap.keys()), ...Array.from(commissionMap.keys())])
    ).sort((a, b) => a.localeCompare(b))

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
      const adByCurrency =
        adMap.get(date) ?? new Map<string, { impressions: number; clicks: number; cost: number }>()
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
        commissionTotalsByCurrency.set(
          currency,
          (commissionTotalsByCurrency.get(currency) || 0) + currencyCommission
        )
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

    const responsePayload = {
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
    }

    if (shouldWriteCache) {
      await setCachedCampaignTrends(userId, cacheHash, responsePayload)
    }

    return NextResponse.json(responsePayload)
  } catch (error: any) {
    console.error('Get campaigns trends error:', error)
    return NextResponse.json({ error: error.message || '获取趋势数据失败' }, { status: 500 })
  }
})
