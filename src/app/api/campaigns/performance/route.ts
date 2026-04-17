import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { convertCurrency } from '@/lib/currency'
import { buildAffiliateUnattributedFailureFilter } from '@/lib/openclaw/affiliate-attribution-failures'
import { isPerformanceReleaseEnabled } from '@/lib/feature-flags'
import { matchesCampaignSearch } from '@/lib/campaign-search'
import {
  buildCampaignPerformanceCacheHash,
  getCachedCampaignPerformance,
  setCachedCampaignPerformance,
} from '@/lib/campaigns-read-cache'

function formatAsYmd(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const raw = String(value)
  if (!raw.trim()) return null

  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) return m[1]

  const t = Date.parse(raw)
  if (!Number.isFinite(t)) return null
  return new Date(t).toISOString().slice(0, 10)
}

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

function shiftYmd(ymd: string, deltaDays: number): string {
  const [year, month, day] = ymd.split('-').map((part) => Number(part))
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + deltaDays)
  return date.toISOString().slice(0, 10)
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

function calculateRoas(commission: number, cost: number): { value: number | null; infinite: boolean } {
  const normalizedCommission = Number(commission) || 0
  const normalizedCost = Number(cost) || 0
  if (normalizedCost <= 0) {
    if (normalizedCommission > 0) {
      return { value: null, infinite: true }
    }
    return { value: 0, infinite: false }
  }

  return {
    value: roundTo2(normalizedCommission / normalizedCost),
    infinite: false,
  }
}

type Agg = {
  impressions: number
  clicks: number
  cost: number
}

const BASE_CURRENCY = 'USD'

function convertToBase(amount: number, currency: string): number {
  const normalizedAmount = Number(amount) || 0
  const normalizedCurrency = normalizeCurrency(currency)
  if (normalizedCurrency === BASE_CURRENCY) return normalizedAmount
  try {
    return convertCurrency(normalizedAmount, normalizedCurrency, BASE_CURRENCY)
  } catch {
    return 0
  }
}

function convertAmountToCurrency(amount: number, fromCurrency: string, toCurrency: string): number {
  const normalizedAmount = Number(amount) || 0
  if (!Number.isFinite(normalizedAmount) || normalizedAmount === 0) return 0

  const sourceCurrency = normalizeCurrency(fromCurrency)
  const targetCurrency = normalizeCurrency(toCurrency)
  if (sourceCurrency === targetCurrency) return normalizedAmount

  try {
    return convertCurrency(normalizedAmount, sourceCurrency, targetCurrency)
  } catch {
    return 0
  }
}

function sumAmountsInCurrency(
  amountsByCurrency: Map<string, number> | undefined,
  targetCurrency: string
): number {
  if (!amountsByCurrency || amountsByCurrency.size === 0) return 0

  let total = 0
  for (const [currency, amount] of amountsByCurrency.entries()) {
    total += convertAmountToCurrency(amount, currency, targetCurrency)
  }
  return total
}

function summarizeAggByCurrency(params: {
  byCampaign: Map<number, Map<string, Agg>>
  reportingCurrency: string | null
}): Agg {
  let impressions = 0
  let clicks = 0
  let cost = 0

  for (const byCurrency of params.byCampaign.values()) {
    for (const [currency, agg] of byCurrency.entries()) {
      const normalizedCurrency = normalizeCurrency(currency)
      if (params.reportingCurrency && normalizedCurrency !== params.reportingCurrency) {
        continue
      }

      const aggImpressions = Number(agg.impressions) || 0
      const aggClicks = Number(agg.clicks) || 0
      const aggCost = Number(agg.cost) || 0

      impressions += aggImpressions
      clicks += aggClicks
      cost += params.reportingCurrency
        ? aggCost
        : convertToBase(aggCost, normalizedCurrency)
    }
  }

  return { impressions, clicks, cost }
}

function summarizeCostsByCurrency(
  byCampaign: Map<number, Map<string, Agg>>
): Array<{ currency: string; amount: number }> {
  const totals = new Map<string, number>()

  for (const byCurrency of byCampaign.values()) {
    for (const [currency, agg] of byCurrency.entries()) {
      const normalizedCurrency = normalizeCurrency(currency)
      totals.set(normalizedCurrency, (totals.get(normalizedCurrency) || 0) + (Number(agg.cost) || 0))
    }
  }

  return Array.from(totals.entries())
    .map(([currency, amount]) => ({ currency, amount }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => (b.amount - a.amount) || a.currency.localeCompare(b.currency))
}

function summarizeCommissionByCurrency(
  byCampaign: Map<number, Map<string, number>>
): Array<{ currency: string; amount: number }> {
  const totals = new Map<string, number>()

  for (const byCurrency of byCampaign.values()) {
    for (const [currency, amount] of byCurrency.entries()) {
      const normalizedCurrency = normalizeCurrency(currency)
      totals.set(normalizedCurrency, (totals.get(normalizedCurrency) || 0) + (Number(amount) || 0))
    }
  }

  return Array.from(totals.entries())
    .map(([currency, amount]) => ({
      currency,
      amount: roundTo2(amount),
    }))
    .filter((row) => row.amount > 0)
}

function sumCommissionByCampaign(
  byCampaign: Map<number, Map<string, number>>,
  currency?: string | null
): number {
  let total = 0

  for (const byCurrency of byCampaign.values()) {
    for (const [entryCurrency, amount] of byCurrency.entries()) {
      if (currency && normalizeCurrency(entryCurrency) !== currency) {
        continue
      }
      total += Number(amount) || 0
    }
  }

  return total
}

const CAMPAIGN_SORT_FIELDS = new Set([
  'campaignName',
  'budgetAmount',
  'impressions',
  'clicks',
  'ctr',
  'cpc',
  'configuredMaxCpc',
  'conversions',
  'cost',
  'roas',
  'status',
  'servingStartDate',
])

function parseOptionalPositiveInt(value: string | null): number | null {
  if (value === null) return null
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

function parseOptionalNonNegativeInt(value: string | null): number | null {
  if (value === null) return null
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

function parseOptionalBoolean(value: string | null): boolean | null {
  if (value === null) return null
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'true' || normalized === '1') return true
  if (normalized === 'false' || normalized === '0') return false
  return null
}

function safeParseJson<T = any>(value: unknown): T | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return value as T
  if (typeof value !== 'string') return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function toPositiveNumberOrNull(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function resolveConfiguredMaxCpc(maxCpc: unknown, campaignConfig: unknown): number | null {
  const direct = toPositiveNumberOrNull(maxCpc)
  if (direct !== null) return direct

  const parsedConfig = safeParseJson<Record<string, unknown>>(campaignConfig)
  return toPositiveNumberOrNull(parsedConfig?.maxCpcBid)
}

// "Deleted" here仅表示软删除(is_deleted)，而不是业务上的“下线(REMOVED)”
// 下线后的广告系列仍然需要出现在 /campaigns 列表中，因此只按 isDeleted 过滤
function isCampaignRemovedOrDeleted(campaign: any): boolean {
  const deletedFlag = campaign?.isDeleted === true || campaign?.isDeleted === 1
  return deletedFlag
}

function getCampaignRoasValue(campaign: any): number | null {
  const commission = Number(campaign?.performance?.commission ?? campaign?.performance?.conversions)
  const cost = Number(campaign?.performance?.costLocal ?? campaign?.performance?.costUsd)
  if (!Number.isFinite(commission) || !Number.isFinite(cost) || cost <= 0) return null
  return roundTo2(commission / cost)
}

/**
 * GET /api/campaigns/performance
 *
 * Get performance data for all campaigns
 *
 * Query Parameters:
 * - daysBack: number (default: 7)
 * - start_date: string (optional, YYYY-MM-DD)
 * - end_date: string (optional, YYYY-MM-DD)
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
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
    const limit = parseOptionalPositiveInt(searchParams.get('limit'))
    const offset = parseOptionalNonNegativeInt(searchParams.get('offset'))
    const searchQuery = (searchParams.get('search') || '').trim().toLowerCase()
    const statusFilterRaw = (searchParams.get('status') || '').trim().toUpperCase()
    const statusFilter = ['ENABLED', 'PAUSED', 'REMOVED', 'ALL'].includes(statusFilterRaw) ? statusFilterRaw : ''
    const needsOfferCompletionFilter = (searchParams.get('needsOfferCompletion') || '').trim().toUpperCase()
    const statusCategoryFilter = (searchParams.get('statusCategory') || '').trim().toLowerCase()
    const showDeletedParam = parseOptionalBoolean(searchParams.get('showDeleted'))
    const refresh = parseOptionalBoolean(searchParams.get('refresh')) === true
    const noCache = parseOptionalBoolean(searchParams.get('noCache')) === true
    const shouldBypassReadCache = refresh || noCache
    const shouldWriteCache = !noCache
    const sortByParam = (searchParams.get('sortBy') || '').trim()
    const sortOrderParam = (searchParams.get('sortOrder') || '').trim().toLowerCase()
    const sortBy = CAMPAIGN_SORT_FIELDS.has(sortByParam) ? sortByParam : ''
    const sortOrder = sortOrderParam === 'asc' ? 'asc' : sortOrderParam === 'desc' ? 'desc' : null
    const idsParam = (searchParams.get('ids') || '').trim()
    const idsFilter = idsParam
      ? idsParam.split(',')
        .map((id) => Number.parseInt(id.trim(), 10))
        .filter((id) => Number.isFinite(id) && id > 0)
      : []
    // 🔧 新增：按创建时间过滤（用于"最近 14 天新增"页面）
    const createdAtStartParam = searchParams.get('createdAtStart')
    const createdAtEndParam = searchParams.get('createdAtEnd')
    let startDateStr = startDateQuery || ''
    let endDateStr = endDateQuery || ''
    let rangeDays = daysBack

    if (!startDateStr || !endDateStr) {
      const now = new Date()
      endDateStr = formatLocalYmd(now)
      const startDate = new Date(now)
      // daysBack=7 means "today + previous 6 days" (inclusive 7-day window).
      startDate.setDate(startDate.getDate() - daysBack + 1)
      startDateStr = formatLocalYmd(startDate)
      rangeDays = daysBack
    } else {
      rangeDays = diffDaysInclusive(startDateStr, endDateStr)
    }

    const prevEndDateStr = shiftYmd(startDateStr, -1)
    const prevStartDateStr = shiftYmd(prevEndDateStr, -(rangeDays - 1))
    const cacheHash = buildCampaignPerformanceCacheHash({
      startDate: startDateStr,
      endDate: endDateStr,
      currency: requestedCurrency,
      limit,
      offset,
      search: searchQuery,
      status: statusFilter || 'ALL',
      needsOfferCompletion: needsOfferCompletionFilter || 'ALL',
      statusCategory: statusCategoryFilter || 'all',
      showDeleted: showDeletedParam,
      sortBy,
      sortOrder,
      ids: idsFilter,
    })

    if (!shouldBypassReadCache) {
      const cached = await getCachedCampaignPerformance<any>(userId, cacheHash)
      if (cached) {
        return NextResponse.json(cached)
      }
    }

    const campaignsParallelEnabled = isPerformanceReleaseEnabled('campaignsParallel')
    const db = await getDatabase()

    const queryCampaignRows = async (): Promise<any[]> => (
      await db.query(`
        SELECT
          c.id,
          c.campaign_id,
          c.campaign_name,
          c.custom_name,
          c.offer_id,
          c.status,
          c.status_category,
          c.google_campaign_id,
          c.google_ads_account_id,
          c.budget_amount,
          c.budget_type,
          c.max_cpc,
          c.campaign_config,
          c.creation_status,
          c.creation_error,
          c.last_sync_at,
          c.created_at,
          c.published_at,
          c.is_deleted,
          c.deleted_at,
          gaa.id as ads_account_id,
          gaa.customer_id as ads_account_customer_id,
          gaa.account_name as ads_account_name,
          gaa.is_active as ads_account_is_active,
          gaa.is_deleted as ads_account_is_deleted,
          gaa.currency as ads_account_currency,
          o.brand as offer_brand,
          o.url as offer_url,
          o.is_deleted as offer_is_deleted,
          o.is_deleted as offer_is_deleted,
          o.needs_completion as offer_needs_completion,
          o.sync_source as offer_sync_source,
          o.google_ads_campaign_id as offer_google_ads_campaign_id,
          (SELECT status FROM click_farm_tasks WHERE offer_id = c.offer_id AND ${db.type === 'postgres' ? 'is_deleted = FALSE' : 'is_deleted = 0'} LIMIT 1) as click_farm_task_status,
          (SELECT status FROM url_swap_tasks WHERE offer_id = c.offer_id AND ${db.type === 'postgres' ? 'is_deleted = FALSE' : 'is_deleted = 0'} LIMIT 1) as url_swap_task_status
        FROM campaigns c
        LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
        LEFT JOIN offers o ON c.offer_id = o.id
        WHERE c.user_id = ?
        ${createdAtStartParam ? `AND c.created_at >= ?` : ''}
        ${createdAtEndParam ? `AND c.created_at <= ?` : ''}
        ORDER BY c.created_at DESC
      `, [
        userId,
        ...(createdAtStartParam ? [createdAtStartParam] : []),
        ...(createdAtEndParam ? [createdAtEndParam] : [])
      ]) as any[]
    )

    const aggregateByCampaignCurrency = async (params: {
      start: string
      end: string
    }): Promise<Map<number, Map<string, Agg>>> => {
      const rows = await db.query(`
        SELECT
          campaign_id,
          COALESCE(currency, 'USD') as currency,
          COALESCE(SUM(impressions), 0) as impressions,
          COALESCE(SUM(clicks), 0) as clicks,
          COALESCE(SUM(cost), 0) as cost
        FROM campaign_performance
        WHERE user_id = ?
          AND date >= ?
          AND date <= ?
        GROUP BY campaign_id, COALESCE(currency, 'USD')
      `, [userId, params.start, params.end]) as any[]

      const map = new Map<number, Map<string, Agg>>()
      for (const row of rows) {
        const campaignId = Number(row.campaign_id)
        if (!Number.isFinite(campaignId)) continue

        const currency = normalizeCurrency(row.currency)
        const agg: Agg = {
          impressions: Number(row.impressions) || 0,
          clicks: Number(row.clicks) || 0,
          cost: Number(row.cost) || 0,
        }

        const byCurrency = map.get(campaignId) ?? new Map<string, Agg>()
        byCurrency.set(currency, agg)
        map.set(campaignId, byCurrency)
      }
      return map
    }

    const queryCommissionByCampaignCurrency = async (params: {
      start: string
      end: string
      currency?: string
    }): Promise<Map<number, Map<string, number>>> => {
      const hasCurrencyFilter = Boolean(params.currency)
      const rows = await db.query<{ campaign_id: number; currency: string; commission: number }>(
        `
          SELECT
            campaign_id,
            COALESCE(currency, 'USD') as currency,
            COALESCE(SUM(commission_amount), 0) AS commission
          FROM affiliate_commission_attributions
          WHERE user_id = ?
            AND report_date >= ?
            AND report_date <= ?
            ${hasCurrencyFilter ? 'AND COALESCE(currency, \'USD\') = ?' : ''}
            AND campaign_id IS NOT NULL
          GROUP BY campaign_id, COALESCE(currency, 'USD')
        `,
        hasCurrencyFilter
          ? [userId, params.start, params.end, String(params.currency)]
          : [userId, params.start, params.end]
      )

      const map = new Map<number, Map<string, number>>()
      for (const row of rows) {
        const campaignId = Number(row.campaign_id)
        if (!Number.isFinite(campaignId)) continue
        const currency = normalizeCurrency(row.currency)
        const commission = Number(row.commission) || 0
        const byCurrency = map.get(campaignId) ?? new Map<string, number>()
        byCurrency.set(currency, commission)
        map.set(campaignId, byCurrency)
      }
      return map
    }

    let campaigns: any[]
    let currentAggByCampaign: Map<number, Map<string, Agg>>
    let currentCommissionByCampaign: Map<number, Map<string, number>>

    if (campaignsParallelEnabled) {
      ;[campaigns, currentAggByCampaign, currentCommissionByCampaign] = await Promise.all([
        queryCampaignRows(),
        aggregateByCampaignCurrency({
          start: startDateStr,
          end: endDateStr,
        }),
        queryCommissionByCampaignCurrency({
          start: startDateStr,
          end: endDateStr,
        }),
      ])
    } else {
      campaigns = await queryCampaignRows()
      currentAggByCampaign = await aggregateByCampaignCurrency({
        start: startDateStr,
        end: endDateStr,
      })
      currentCommissionByCampaign = await queryCommissionByCampaignCurrency({
        start: startDateStr,
        end: endDateStr,
      })
    }
    const costs = summarizeCostsByCurrency(currentAggByCampaign)
    const costCurrencies = costs.map((row) => row.currency)
    const reportingCurrency = requestedCurrency && costCurrencies.includes(requestedCurrency)
      ? requestedCurrency
      : null

    const pickCampaignCurrency = (params: {
      accountCurrency: string
      currentAgg?: Map<string, Agg>
    }): string => {
      if (reportingCurrency) {
        return reportingCurrency
      }

      const accountCurrency = normalizeCurrency(params.accountCurrency)
      const currentAgg = params.currentAgg
      if (!currentAgg || currentAgg.size === 0) return accountCurrency

      const options = Array.from(currentAgg.entries())
        .map(([currency, agg]) => ({
          currency: normalizeCurrency(currency),
          cost: Number(agg.cost) || 0,
        }))
        .sort((a, b) => (b.cost - a.cost) || a.currency.localeCompare(b.currency))

      const top = options[0]?.currency
      if (!top) return accountCurrency

      return top
    }

    const formattedCampaigns = campaigns.map(c => {
      const hasLinkedAdsAccountId = c.google_ads_account_id !== null && c.google_ads_account_id !== undefined
      const hasAccountRow = c.ads_account_id !== null && c.ads_account_id !== undefined
      const adsAccountIsActive = c.ads_account_is_active === true || c.ads_account_is_active === 1
      const adsAccountIsDeleted = c.ads_account_is_deleted === true || c.ads_account_is_deleted === 1
      const adsAccountAvailable = hasLinkedAdsAccountId && hasAccountRow && adsAccountIsActive && !adsAccountIsDeleted

      const currentAgg = currentAggByCampaign.get(Number(c.id))
      const accountCurrency = normalizeCurrency(c.ads_account_currency)
      const selectedCurrency = pickCampaignCurrency({
        accountCurrency,
        currentAgg,
      })

      const selectedCurrent = currentAgg?.get(selectedCurrency)
      const impressions = Number(selectedCurrent?.impressions) || 0
      const clicks = Number(selectedCurrent?.clicks) || 0
      const cost = Number(selectedCurrent?.cost) || 0

      const commissionByCurrency = currentCommissionByCampaign.get(Number(c.id))
      const commission = reportingCurrency
        ? Number(commissionByCurrency?.get(selectedCurrency)) || 0
        : sumAmountsInCurrency(commissionByCurrency, selectedCurrency)
      const commissionPerClick = clicks > 0 ? commission / clicks : 0
      const costBase = convertToBase(cost, selectedCurrency)
      const commissionBase = convertToBase(commission, selectedCurrency)
      const cpcBase = clicks > 0 ? costBase / clicks : 0
      const configuredMaxCpc = resolveConfiguredMaxCpc(c.max_cpc, c.campaign_config)

      return {
        id: c.id,
        campaignName: c.campaign_name,
        customName: c.custom_name ?? null,
        offerId: c.offer_id,
        offerBrand: c.offer_brand,
        offerUrl: c.offer_url,
        offerNeedsCompletion: c.offer_needs_completion,
        offerSyncSource: c.offer_sync_source,
        offerGoogleAdsCampaignId: c.offer_google_ads_campaign_id,
        clickFarmTaskStatus: c.click_farm_task_status ?? null,
        urlSwapTaskStatus: c.url_swap_task_status ?? null,
        status: c.status,
        statusCategory: c.status_category ?? 'pending',
        googleCampaignId: c.google_campaign_id,
        googleAdsAccountId: c.google_ads_account_id,
        adsAccountCustomerId: c.ads_account_customer_id ?? null,
        adsAccountName: c.ads_account_name ?? null,
        campaignId: c.campaign_id,
        creationStatus: c.creation_status,
        creationError: c.creation_error ?? null,
        servingStartDate: formatAsYmd(c.published_at ?? c.created_at),
        adsAccountAvailable,
        // 账号原始币种（用于预算展示与预算调整）
        adsAccountCurrency: accountCurrency,
        // 报表币种（用于花费/CPC/佣金展示，受 currency 筛选影响）
        performanceCurrency: selectedCurrency,
        budgetAmount: Number(c.budget_amount) || 0,
        budgetType: c.budget_type,
        configuredMaxCpc,
        lastSyncAt: c.last_sync_at,
        createdAt: c.created_at,
        isDeleted: c.is_deleted,
        deletedAt: c.deleted_at,
        offerIsDeleted: c.offer_is_deleted,
        performance: {
          impressions,
          clicks,
          conversions: roundTo2(commission),
          commission: roundTo2(commission),
          commissionBase: roundTo2(commissionBase),
          costLocal: cost,
          costUsd: cost,
          costBase: roundTo2(costBase),
          ctr: impressions > 0 ? Math.round((clicks * 10000) / impressions) / 100 : 0,
          cpcLocal: clicks > 0 ? Math.round((cost * 100) / clicks) / 100 : 0,
          cpcUsd: clicks > 0 ? Math.round((cost * 100) / clicks) / 100 : 0,
          cpcBase: roundTo2(cpcBase),
          conversionRate: roundTo2(commissionPerClick),
          commissionPerClick: roundTo2(commissionPerClick),
          dateRange: {
            start: startDateStr,
            end: endDateStr,
            days: rangeDays
          }
        }
      }
    })

    let listCampaigns = formattedCampaigns

    if (idsFilter.length > 0) {
      const idsSet = new Set(idsFilter)
      listCampaigns = listCampaigns.filter((campaign) => idsSet.has(Number(campaign.id)))
    }

    if (showDeletedParam === false) {
      listCampaigns = listCampaigns.filter((campaign) => !isCampaignRemovedOrDeleted(campaign))
    }

    if (searchQuery) {
      listCampaigns = listCampaigns.filter((campaign) => matchesCampaignSearch(searchQuery, campaign))
    }

    if (statusFilter && statusFilter !== 'ALL') {
      listCampaigns = listCampaigns.filter((campaign) => String(campaign.status || '').toUpperCase() === statusFilter)
    }
    
    if (needsOfferCompletionFilter && needsOfferCompletionFilter !== 'ALL') {
      listCampaigns = listCampaigns.filter((campaign) => String(campaign.offerNeedsCompletion || '').toUpperCase() === needsOfferCompletionFilter)
    }

    if (statusCategoryFilter && statusCategoryFilter !== 'all') {
      listCampaigns = listCampaigns.filter((campaign) => (campaign.statusCategory || 'pending') === statusCategoryFilter)
    }

    if (sortBy && sortOrder) {
      const direction = sortOrder === 'asc' ? 1 : -1
      listCampaigns = [...listCampaigns].sort((a, b) => {
        if (sortBy === 'servingStartDate') {
          const aDate = a.servingStartDate
          const bDate = b.servingStartDate
          if (!aDate && !bDate) return 0
          if (!aDate) return 1
          if (!bDate) return -1
          return aDate < bDate ? -direction : aDate > bDate ? direction : 0
        }

        if (sortBy === 'roas') {
          const aRoas = getCampaignRoasValue(a)
          const bRoas = getCampaignRoasValue(b)
          if (aRoas === null && bRoas === null) return 0
          if (aRoas === null) return 1
          if (bRoas === null) return -1
          return (aRoas - bRoas) * direction
        }

        let aVal: string | number = 0
        let bVal: string | number = 0

        switch (sortBy) {
          case 'campaignName':
            aVal = String(a.campaignName || '').toLowerCase()
            bVal = String(b.campaignName || '').toLowerCase()
            break
          case 'budgetAmount':
            aVal = Number(a.budgetAmount) || 0
            bVal = Number(b.budgetAmount) || 0
            break
          case 'impressions':
            aVal = Number(a.performance?.impressions) || 0
            bVal = Number(b.performance?.impressions) || 0
            break
          case 'clicks':
            aVal = Number(a.performance?.clicks) || 0
            bVal = Number(b.performance?.clicks) || 0
            break
          case 'ctr':
            aVal = Number(a.performance?.ctr) || 0
            bVal = Number(b.performance?.ctr) || 0
            break
          case 'cpc':
            aVal = Number(a.performance?.cpcBase ?? a.performance?.cpcLocal ?? a.performance?.cpcUsd) || 0
            bVal = Number(b.performance?.cpcBase ?? b.performance?.cpcLocal ?? b.performance?.cpcUsd) || 0
            break
          case 'configuredMaxCpc':
            aVal = Number(a.configuredMaxCpc) || 0
            bVal = Number(b.configuredMaxCpc) || 0
            break
          case 'conversions':
            aVal = Number(a.performance?.commissionBase ?? a.performance?.commission ?? a.performance?.conversions) || 0
            bVal = Number(b.performance?.commissionBase ?? b.performance?.commission ?? b.performance?.conversions) || 0
            break
          case 'cost':
            aVal = Number(a.performance?.costBase ?? a.performance?.costLocal ?? a.performance?.costUsd) || 0
            bVal = Number(b.performance?.costBase ?? b.performance?.costLocal ?? b.performance?.costUsd) || 0
            break
          case 'status':
            aVal = String(a.status || '')
            bVal = String(b.status || '')
            break
          default:
            return 0
        }

        if (aVal < bVal) return -direction
        if (aVal > bVal) return direction
        return 0
      })
    }

    const listTotal = listCampaigns.length
    const pagingOffset = offset ?? 0
    if (limit !== null || offset !== null) {
      const pagingLimit = limit ?? Math.max(listTotal - pagingOffset, 0)
      listCampaigns = listCampaigns.slice(pagingOffset, pagingOffset + pagingLimit)
    }

    const latestCampaignSyncFallback = formattedCampaigns.reduce<string | null>((latest, campaign) => {
      const candidate = campaign.lastSyncAt
      if (!candidate) return latest

      const candidateTs = Date.parse(candidate)
      if (Number.isNaN(candidateTs)) return latest

      if (!latest) return candidate
      const latestTs = Date.parse(latest)
      if (Number.isNaN(latestTs) || candidateTs > latestTs) return candidate

      return latest
    }, null)

    const latestSyncFromLogsPromise = db.type === 'postgres'
      ? db.queryOne<{ latest_sync_at: string | null }>(
          `
            SELECT MAX(
              COALESCE(
                NULLIF(completed_at, '')::timestamptz,
                NULLIF(started_at, '')::timestamptz,
                NULLIF(created_at, '')::timestamptz
              )
            )::text AS latest_sync_at
            FROM sync_logs
            WHERE user_id = ?
          `,
          [userId]
        )
      : db.queryOne<{ latest_sync_at: string | null }>(
          `
            SELECT MAX(COALESCE(NULLIF(completed_at, ''), NULLIF(started_at, ''), NULLIF(created_at, ''))) AS latest_sync_at
            FROM sync_logs
            WHERE user_id = ?
          `,
          [userId]
        )

    const latestSyncFromLogsRow = await latestSyncFromLogsPromise

    const latestSyncAt = latestSyncFromLogsRow?.latest_sync_at || latestCampaignSyncFallback

    const queryPreviousSummary = async (params: {
      start: string
      end: string
      currency?: string
    }): Promise<{
      totals: Agg
      attributedCommissionTotal: number
    }> => {
      const hasCurrencyFilter = Boolean(params.currency)
      const rows = await db.query<{
        summary_source: string
        currency: string | null
        impressions: number | null
        clicks: number | null
        amount: number | null
      }>(
        `
          SELECT
            'performance' AS summary_source,
            COALESCE(currency, 'USD') AS currency,
            COALESCE(SUM(impressions), 0) AS impressions,
            COALESCE(SUM(clicks), 0) AS clicks,
            COALESCE(SUM(cost), 0) AS amount
          FROM campaign_performance
          WHERE user_id = ?
            AND date >= ?
            AND date <= ?
            ${hasCurrencyFilter ? 'AND COALESCE(currency, \'USD\') = ?' : ''}
          GROUP BY 2
          UNION ALL
          SELECT
            'attributed' AS summary_source,
            COALESCE(currency, 'USD') AS currency,
            0 AS impressions,
            0 AS clicks,
            COALESCE(SUM(commission_amount), 0) AS amount
          FROM affiliate_commission_attributions
          WHERE user_id = ?
            AND report_date >= ?
            AND report_date <= ?
            ${hasCurrencyFilter ? 'AND COALESCE(currency, \'USD\') = ?' : ''}
          GROUP BY 2
        `,
        hasCurrencyFilter
          ? [
              userId,
              params.start,
              params.end,
              String(params.currency),
              userId,
              params.start,
              params.end,
              String(params.currency),
            ]
          : [
              userId,
              params.start,
              params.end,
              userId,
              params.start,
              params.end,
            ]
      )

      const totals: Agg = {
        impressions: 0,
        clicks: 0,
        cost: 0,
      }
      let attributedCommissionTotal = 0

      for (const row of rows) {
        const amount = Number(row.amount) || 0
        const currency = normalizeCurrency(row.currency)
        if (row.summary_source === 'performance') {
          totals.impressions += Number(row.impressions) || 0
          totals.clicks += Number(row.clicks) || 0
          totals.cost += hasCurrencyFilter
            ? amount
            : convertToBase(amount, currency)
          continue
        }

        if (row.summary_source === 'attributed') {
          attributedCommissionTotal += amount
        }
      }

      return {
        totals,
        attributedCommissionTotal,
      }
    }

    const queryUnattributedCommissionPeriods = async (params: {
      currentStart: string
      currentEnd: string
      previousStart: string
      previousEnd: string
      currency?: string
    }): Promise<{
      currentTotal: number
      previousTotal: number
      currentByCurrency: Array<{ currency: string; amount: number }>
    }> => {
      const unattributedFailureFilter = buildAffiliateUnattributedFailureFilter({
        // Include all unattributed commissions (including campaign_mapping_miss)
        // to match affiliate backend totals
        includePendingWithinGrace: true,
        includeAllFailures: true,
      })
      const hasCurrencyFilter = Boolean(params.currency)
      try {
        const queryParams = hasCurrencyFilter
          ? [
              userId,
              params.currentStart,
              params.currentEnd,
              ...unattributedFailureFilter.values,
              String(params.currency),
              userId,
              params.previousStart,
              params.previousEnd,
              ...unattributedFailureFilter.values,
              String(params.currency),
            ]
          : [
              userId,
              params.currentStart,
              params.currentEnd,
              ...unattributedFailureFilter.values,
              userId,
              params.previousStart,
              params.previousEnd,
              ...unattributedFailureFilter.values,
            ]
        const rows = await db.query<{
          period_label: string
          currency: string | null
          total_commission: number | null
        }>(
          `
            SELECT
              'current' AS period_label,
              COALESCE(currency, 'USD') AS currency,
              COALESCE(SUM(commission_amount), 0) AS total_commission
            FROM openclaw_affiliate_attribution_failures
            WHERE user_id = ?
              AND report_date >= ?
              AND report_date <= ?
              AND ${unattributedFailureFilter.sql}
              ${hasCurrencyFilter ? 'AND COALESCE(currency, \'USD\') = ?' : ''}
            GROUP BY 2
            UNION ALL
            SELECT
              'previous' AS period_label,
              COALESCE(currency, 'USD') AS currency,
              COALESCE(SUM(commission_amount), 0) AS total_commission
            FROM openclaw_affiliate_attribution_failures
            WHERE user_id = ?
              AND report_date >= ?
              AND report_date <= ?
              AND ${unattributedFailureFilter.sql}
              ${hasCurrencyFilter ? 'AND COALESCE(currency, \'USD\') = ?' : ''}
            GROUP BY 2
          `,
          queryParams
        )

        let currentTotal = 0
        let previousTotal = 0
        const currentByCurrency: Array<{ currency: string; amount: number }> = []

        for (const row of rows) {
          const amount = Number(row.total_commission) || 0
          const currency = normalizeCurrency(row.currency)
          if (row.period_label === 'current') {
            currentTotal += amount
            if (!hasCurrencyFilter && amount > 0) {
              currentByCurrency.push({
                currency,
                amount: roundTo2(amount),
              })
            }
            continue
          }

          if (row.period_label === 'previous') {
            previousTotal += amount
          }
        }

        return {
          currentTotal,
          previousTotal,
          currentByCurrency,
        }
      } catch (error: any) {
        const message = String(error?.message || '')
        if (
          /openclaw_affiliate_attribution_failures/i.test(message)
          && /(no such table|does not exist)/i.test(message)
        ) {
          return {
            currentTotal: 0,
            previousTotal: 0,
            currentByCurrency: [],
          }
        }
        throw error
      }
    }


    const isFilteredByCurrency = Boolean(reportingCurrency)
    const currentTotalsDerived = summarizeAggByCurrency({
      byCampaign: currentAggByCampaign,
      reportingCurrency,
    })
    const currentAttributedCommissionByCurrencyDerived = summarizeCommissionByCurrency(currentCommissionByCampaign)
    const currentAttributedCommissionTotalDerived = sumCommissionByCampaign(
      currentCommissionByCampaign,
      reportingCurrency
    )

    let currentTotals: Agg
    let prevTotals: Agg
    let currentAttributedCommissionTotal: number
    let prevAttributedCommissionTotal: number
    let currentUnattributedCommissionTotal: number
    let prevUnattributedCommissionTotal: number
    let currentAttributedCommissionByCurrency: Array<{ currency: string; amount: number }>
    let currentUnattributedCommissionByCurrency: Array<{ currency: string; amount: number }>
    let prevSummary: { totals: Agg; attributedCommissionTotal: number }
    let unattributedSummary: {
      currentTotal: number
      previousTotal: number
      currentByCurrency: Array<{ currency: string; amount: number }>
    }

    if (campaignsParallelEnabled) {
      ;[prevSummary, unattributedSummary] = await Promise.all([
        queryPreviousSummary({
          start: prevStartDateStr,
          end: prevEndDateStr,
          currency: reportingCurrency || undefined,
        }),
        queryUnattributedCommissionPeriods({
          currentStart: startDateStr,
          currentEnd: endDateStr,
          previousStart: prevStartDateStr,
          previousEnd: prevEndDateStr,
          currency: reportingCurrency || undefined,
        }),
      ])

      currentTotals = currentTotalsDerived
      prevTotals = prevSummary.totals
      currentAttributedCommissionTotal = currentAttributedCommissionTotalDerived
      prevAttributedCommissionTotal = prevSummary.attributedCommissionTotal
      currentUnattributedCommissionTotal = unattributedSummary.currentTotal
      prevUnattributedCommissionTotal = unattributedSummary.previousTotal
      currentAttributedCommissionByCurrency = isFilteredByCurrency
        ? []
        : currentAttributedCommissionByCurrencyDerived
      currentUnattributedCommissionByCurrency = isFilteredByCurrency
        ? []
        : unattributedSummary.currentByCurrency
    } else {
      currentTotals = currentTotalsDerived

      prevSummary = await queryPreviousSummary({
        start: prevStartDateStr,
        end: prevEndDateStr,
        currency: reportingCurrency || undefined,
      })
      prevTotals = prevSummary.totals
      currentAttributedCommissionTotal = currentAttributedCommissionTotalDerived
      prevAttributedCommissionTotal = prevSummary.attributedCommissionTotal
      unattributedSummary = await queryUnattributedCommissionPeriods({
        currentStart: startDateStr,
        currentEnd: endDateStr,
        previousStart: prevStartDateStr,
        previousEnd: prevEndDateStr,
        currency: reportingCurrency || undefined,
      })
      currentUnattributedCommissionTotal = unattributedSummary.currentTotal
      prevUnattributedCommissionTotal = unattributedSummary.previousTotal
      currentAttributedCommissionByCurrency = isFilteredByCurrency
        ? []
        : currentAttributedCommissionByCurrencyDerived
      currentUnattributedCommissionByCurrency = !isFilteredByCurrency
        ? unattributedSummary.currentByCurrency
        : []
    }
    const commissionCurrencies = Array.from(new Set([
      ...currentAttributedCommissionByCurrency.map((row) => normalizeCurrency(row.currency)),
      ...currentUnattributedCommissionByCurrency.map((row) => normalizeCurrency(row.currency)),
    ]))
    const summaryCurrencies = Array.from(new Set([
      ...costCurrencies,
      ...commissionCurrencies,
    ]))
    const hasMixedCurrency = summaryCurrencies.length > 1
    const currentCommissionTotal = currentAttributedCommissionTotal + currentUnattributedCommissionTotal
    const prevCommissionTotal = prevAttributedCommissionTotal + prevUnattributedCommissionTotal

    const calcChange = (current: number, previous: number): number | null => {
      if (previous === 0) return current > 0 ? 100 : null
      return Math.round(((current - previous) / previous) * 10000) / 100
    }

    const changes = {
      impressions: calcChange(currentTotals.impressions, prevTotals.impressions),
      clicks: calcChange(currentTotals.clicks, prevTotals.clicks),
      conversions: calcChange(currentCommissionTotal, prevCommissionTotal),
      cost: isFilteredByCurrency ? calcChange(currentTotals.cost, prevTotals.cost) : null,
      roas: null as number | null,
      roasInfinite: false,
    }

    const roasAvailable = isFilteredByCurrency || !hasMixedCurrency
    let totalRoas: number | null = null
    let totalRoasInfinite = false
    let prevRoas: number | null = null
    let prevRoasInfinite = false

    if (roasAvailable) {
      const currentRoas = calculateRoas(currentCommissionTotal, currentTotals.cost)
      const previousRoas = calculateRoas(prevCommissionTotal, prevTotals.cost)
      totalRoas = currentRoas.value
      totalRoasInfinite = currentRoas.infinite
      prevRoas = previousRoas.value
      prevRoasInfinite = previousRoas.infinite

      if (totalRoasInfinite) {
        changes.roasInfinite = true
      } else if (
        !prevRoasInfinite
        && typeof prevRoas === 'number'
        && prevRoas > 0
        && typeof totalRoas === 'number'
      ) {
        changes.roas = roundTo2(((totalRoas - prevRoas) / prevRoas) * 100)
      }
    }

    const statusDistribution = {
      enabled: formattedCampaigns.filter((c) => String(c.status || '').toUpperCase() === 'ENABLED').length,
      paused: formattedCampaigns.filter((c) => String(c.status || '').toUpperCase() === 'PAUSED').length,
      removed: formattedCampaigns.filter((c) => String(c.status || '').toUpperCase() === 'REMOVED').length,
      total: formattedCampaigns.length,
    }

    const responsePayload = {
      success: true,
      campaigns: listCampaigns,
      total: listTotal,
      limit: limit ?? null,
      offset: pagingOffset,
      summary: {
        totalCampaigns: formattedCampaigns.length,
        activeCampaigns: formattedCampaigns.filter(c => c.status === 'ENABLED').length,
        totalImpressions: currentTotals.impressions,
        totalClicks: currentTotals.clicks,
        totalConversions: roundTo2(currentCommissionTotal),
        totalCommission: roundTo2(currentCommissionTotal),
        attributedCommission: roundTo2(currentAttributedCommissionTotal),
        unattributedCommission: roundTo2(currentUnattributedCommissionTotal),
        totalCostUsd: currentTotals.cost,
        totalRoas: roasAvailable ? totalRoas : null,
        totalRoasInfinite: roasAvailable ? totalRoasInfinite : false,
        baseCurrency: BASE_CURRENCY,
        currency: hasMixedCurrency && !isFilteredByCurrency ? 'MIXED' : (reportingCurrency || summaryCurrencies[0] || costCurrencies[0] || 'USD'),
        currencies: costCurrencies,
        hasMixedCurrency,
        costs: hasMixedCurrency && !isFilteredByCurrency ? costs : undefined,
        attributedCommissionsByCurrency: currentAttributedCommissionByCurrency,
        unattributedCommissionsByCurrency: currentUnattributedCommissionByCurrency,
        latestSyncAt,
        statusDistribution,
        changes: {
          impressions: changes.impressions,
          clicks: changes.clicks,
          conversions: changes.conversions,
          cost: changes.cost
        },
        comparisonPeriod: {
          current: { start: startDateStr, end: endDateStr },
          previous: { start: prevStartDateStr, end: prevEndDateStr }
        }
      }
    }

    if (shouldWriteCache) {
      await setCachedCampaignPerformance(userId, cacheHash, responsePayload)
    }

    return NextResponse.json(responsePayload)

  } catch (error: any) {
    console.error('Get campaigns performance error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to get performance data' },
      { status: 500 }
    )
  }
}
