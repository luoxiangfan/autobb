import { getDatabase, type DatabaseAdapter } from '@/lib/db'
import { fetchAutoadsJson } from '@/lib/openclaw/autoads-client'
import { fetchAffiliateCommissionRevenue, type AffiliateCommissionRevenue } from '@/lib/openclaw/affiliate-revenue'
import { invokeOpenclawTool } from '@/lib/openclaw/gateway'
import { resolveUserFeishuAccountId } from '@/lib/openclaw/feishu-accounts'
import { writeDailyReportToBitable, writeDailyReportToDoc } from '@/lib/openclaw/feishu-docs'
import { formatOpenclawLocalDate, normalizeOpenclawReportDate } from '@/lib/openclaw/report-date'
import { getStrategyRecommendations, type StrategyRecommendation } from '@/lib/openclaw/strategy-recommendations'
import { toDbJsonObjectField } from '@/lib/json-field'
import { createRiskAlert } from '@/lib/risk-alerts'
import { buildAffiliateUnattributedFailureFilter } from '@/lib/openclaw/affiliate-attribution-failures'

type DailyReportPayload = {
  date: string
  dateRange?: {
    startDate: string
    endDate: string
    days: number
    isRange: boolean
  }
  generatedAt: string
  summary?: any
  kpis?: any
  dailySnapshot?: DailyPerformanceSnapshot
  trends?: any
  roi?: any
  campaigns?: any
  budget?: any
  performance?: any
  actions?: any[]
  strategyActions?: any[]
  strategyRun?: any
  strategyRunRange?: {
    startDate: string
    endDate: string
    runsTotal: number
    runsSuccess: number
    runsFailed: number
    runsSkipped: number
    latestRunDate: string | null
    latestMode: string | null
    latestStatus: string | null
  }
  strategyRecommendations?: StrategyRecommendation[]
  errors?: Array<{ source: string; message: string }>
}

type DailyPerformanceSnapshot = {
  impressions: number
  clicks: number
  cost: number
  conversions: number
}

type StrategyKnowledgeSummary = {
  runsTotal: number
  runsSuccess: number
  runsFailed: number
  runsSkipped: number
  mode: string
  reason: string | null
  adjustment: string
  guardLevel: string
  publishFailureRate: number
  offersConsidered: number
  campaignsPublished: number
  campaignsPaused: number
  publishSuccess: number
  publishFailed: number
  actionSuccess: number
  actionFailed: number
  circuitBreakTriggered: boolean
  circuitBreakPaused: number
  rankCandidateCount: number
  rankSelectedCount: number
  rankSelectedAverageScore: number
  recommendedMaxOffersPerRun: number
  recommendedDefaultBudget: number
  recommendedMaxCpc: number
  recommendationSource: 'effective_config' | 'failure_guard_after' | 'adaptive_after' | 'none'
  recommendationNote: string
  topPublishFailureReasons: string[]
}

const reportInflight = new Map<string, Promise<DailyReportPayload>>()
const reportDeliveryInflight = new Map<string, Promise<void>>()

type DailyReportLoadOptions = {
  forceRefresh?: boolean
}

type DailyReportBuildOptions = {
  startDate?: string
}

type SendDailyReportToFeishuParams = {
  userId: number
  target?: string
  date?: string
  startDate?: string
  deliveryTaskId?: string
}

function formatLocalDate(date: Date): string {
  return formatOpenclawLocalDate(date)
}

function parseMaybeJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  if (typeof value === 'object') return value as T
  return fallback
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

function normalizeCurrencyCode(value: unknown, fallback = 'USD'): string {
  const normalized = String(value || '').trim().toUpperCase()
  if (!normalized) return fallback
  if (normalized === 'MIXED' || /^[A-Z]{3}$/.test(normalized)) {
    return normalized
  }
  return fallback
}

function formatMoney(value: unknown, currency: string): string {
  return `${roundTo2(toNumber(value, 0))} ${normalizeCurrencyCode(currency)}`
}

type BudgetCurrencyOverview = {
  currency: string
  totalBudget: number
  totalSpent: number
  totalSpentEnabledCampaigns?: number
  totalSpentAllCampaigns?: number
  remaining: number
  activeCampaigns: number
}

function toBudgetCurrencyOverview(value: unknown): BudgetCurrencyOverview | null {
  const row = asObject(value)
  const currency = normalizeCurrencyCode(row?.currency, '')
  if (!currency) return null

  const totalBudget = roundTo2(toNumber(row?.totalBudget, 0))
  const totalSpentEnabledCampaigns = roundTo2(
    toNumber(row?.totalSpentEnabledCampaigns, toNumber(row?.totalSpent, 0))
  )
  const totalSpentAllCampaigns = roundTo2(
    toNumber(row?.totalSpentAllCampaigns, totalSpentEnabledCampaigns)
  )

  return {
    currency,
    totalBudget,
    totalSpent: totalSpentEnabledCampaigns,
    totalSpentEnabledCampaigns,
    totalSpentAllCampaigns,
    remaining: roundTo2(toNumber(row?.remaining, totalBudget - totalSpentEnabledCampaigns)),
    activeCampaigns: Math.max(0, Math.round(toNumber(row?.activeCampaigns, 0))),
  }
}

function isBudgetCurrencyOverview(
  item: BudgetCurrencyOverview | null
): item is BudgetCurrencyOverview {
  return item !== null
}

type RoiCurrencyOverview = {
  currency: string
  cost: number
  revenue: number
  profit: number
  roas: number | null
  roi: number | null
}

function formatRatioValue(value: number | null, suffix: 'x' | '%'): string {
  if (value === null || !Number.isFinite(value)) {
    return '暂不可用'
  }

  return `${Number(value).toFixed(2)}${suffix}`
}

function buildRoiCurrencyOverview(params: {
  budgetOverview: BudgetCurrencyOverview[]
  affiliateBreakdown: Array<{ totalCommission?: number; currency?: string }>
}): RoiCurrencyOverview[] {
  const orderedCurrencies: string[] = []
  const seenCurrencies = new Set<string>()
  const costByCurrency = new Map<string, number>()
  const revenueByCurrency = new Map<string, number>()

  const trackCurrency = (currency: string) => {
    if (!currency || seenCurrencies.has(currency)) return
    seenCurrencies.add(currency)
    orderedCurrencies.push(currency)
  }

  for (const item of params.budgetOverview) {
    const currency = normalizeCurrencyCode(item.currency, '')
    if (!currency) continue

    trackCurrency(currency)
    costByCurrency.set(
      currency,
      roundTo2(
        (costByCurrency.get(currency) || 0)
        + toNumber(item.totalSpentAllCampaigns, toNumber(item.totalSpentEnabledCampaigns, toNumber(item.totalSpent, 0)))
      )
    )
  }

  for (const item of params.affiliateBreakdown) {
    const currency = normalizeCurrencyCode(item.currency, '')
    if (!currency) continue

    trackCurrency(currency)
    revenueByCurrency.set(currency, roundTo2((revenueByCurrency.get(currency) || 0) + toNumber(item.totalCommission, 0)))
  }

  return orderedCurrencies.map((currency) => {
    const cost = roundTo2(costByCurrency.get(currency) || 0)
    const revenue = roundTo2(revenueByCurrency.get(currency) || 0)
    const profit = roundTo2(revenue - cost)
    const roas = cost > 0 ? roundTo2(revenue / cost) : null
    const roi = cost > 0 ? roundTo2((profit / cost) * 100) : null

    return {
      currency,
      cost,
      revenue,
      profit,
      roas,
      roi,
    }
  })
}

function asObject(value: unknown): Record<string, any> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, any>
}

type CampaignPerformanceByDateRow = {
  date: string
  impressions: number | null
  clicks: number | null
  cost: number | null
  conversions: number | null
}

type ReportRangeKpiRow = {
  total_offers: number | null
  total_campaigns: number | null
  impressions: number | null
  clicks: number | null
  cost: number | null
  conversions: number | null
}

type CommissionByDateRow = {
  report_date: string
  commission: number | null
}

type PlatformCommissionSummaryRow = {
  platform: string
  currency: string | null
  total_commission: number | null
  records: number | null
}

type AttributionSummaryRangeRow = {
  total_commission: number | null
  attributed_commission: number | null
  written_rows: number | null
  attributed_offers: number | null
  attributed_campaigns: number | null
}

type UnattributedFailureSummaryRangeRow = {
  total_commission: number | null
  total_rows: number | null
}

type OfferRevenueRow = {
  offer_id: number
  revenue: number | null
  attributed_campaign_count: number | null
}

type OfferPerformanceRow = {
  offer_id: number
  cost: number | null
  clicks: number | null
  campaign_count: number | null
}

type OfferMetaRow = {
  id: number
  offer_name: string | null
  brand: string | null
}

type CampaignRevenueRow = {
  campaign_id: number
  offer_id: number | null
  revenue: number | null
}

type CampaignPerformanceRow = {
  campaign_id: number
  campaign_name: string | null
  status: string | null
  offer_id: number | null
  cost: number | null
  clicks: number | null
}

type AttributionFailureSummaryRow = {
  reason_code: string
  reason_count: number | null
  commission: number | null
}

type AffiliateReconciliationTopReason = {
  code: string
  label: string
  count: number
  commission: number
}

type AffiliateReconciliationSnapshot = {
  reportDate: string
  totalRevenue: number
  attributedRevenue: number
  gap: number
  gapRatio: number
  hasGap: boolean
  severity: 'critical' | 'warning' | null
  failureRows: number
  failureCommission: number
  topFailureReasons: AffiliateReconciliationTopReason[]
}

type ReportOfferBreakdownRow = {
  offerId: number | string
  offerName: string
  brand: string
  campaignCount: number
  attributedCampaignCount: number
  clicks: number
  cost: number
  revenue: number
  profit: number
  roi: number | null
  roas: number | null
  isUnattributed: boolean
}

type ReportCampaignBreakdownRow = {
  campaignId: number | string
  campaignName: string
  status: string
  offerId: number | null
  offerName: string
  offerBrand: string
  clicks: number
  cost: number
  revenue: number
  profit: number
  roi: number | null
  roas: number | null
  isUnattributed: boolean
}

const COMMISSION_EPSILON = 0.0001
const REPORT_TREND_DAYS = 30
const RECONCILIATION_GAP_ALERT_EPSILON = 0.01
const RECONCILIATION_CRITICAL_GAP_AMOUNT = 20
const RECONCILIATION_CRITICAL_GAP_RATIO = 30

function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function normalizeTrendDateKey(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }

  if (value === null || value === undefined) return null
  const raw = String(value).trim()
  if (!raw) return null

  const ymdMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  if (ymdMatch) {
    return ymdMatch[1]
  }

  const parsed = Date.parse(raw)
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed).toISOString().slice(0, 10)
}

function shiftYmdDate(ymd: string, days: number): string {
  const parsed = new Date(`${ymd}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return ymd
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

function buildYmdDateRange(startYmd: string, endYmd: string): string[] {
  if (!isIsoDateString(startYmd) || !isIsoDateString(endYmd) || startYmd > endYmd) {
    return []
  }

  const range: string[] = []
  const cursor = new Date(`${startYmd}T00:00:00.000Z`)
  const end = new Date(`${endYmd}T00:00:00.000Z`)
  while (cursor.getTime() <= end.getTime()) {
    range.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return range
}

function resolveNormalizedDateRange(startDate: string, endDate: string): {
  startDate: string
  endDate: string
} {
  const normalizedEndDate = normalizeOpenclawReportDate(endDate)
  const normalizedStartCandidate = normalizeOpenclawReportDate(startDate)
  const normalizedStartDate = normalizedStartCandidate <= normalizedEndDate
    ? normalizedStartCandidate
    : normalizedEndDate
  return {
    startDate: normalizedStartDate,
    endDate: normalizedEndDate,
  }
}

function calculateInclusiveDateSpan(startDate: string, endDate: string): number {
  if (!isIsoDateString(startDate) || !isIsoDateString(endDate) || startDate > endDate) {
    return 1
  }
  const startMs = Date.parse(`${startDate}T00:00:00.000Z`)
  const endMs = Date.parse(`${endDate}T00:00:00.000Z`)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return 1
  }
  return Math.floor((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1
}

function calculateRoiPercent(revenue: number, cost: number): number | null {
  if (cost <= 0) return null
  return roundTo2(((revenue - cost) / cost) * 100)
}

function calculateRoasValue(revenue: number, cost: number): number | null {
  if (cost <= 0) return null
  return roundTo2(revenue / cost)
}

function normalizeCampaignStatus(value: unknown): string {
  const normalized = String(value || '').trim()
  return normalized || 'UNKNOWN'
}

function formatAffiliateFailureReasonLabel(reasonCode: string): string {
  switch (String(reasonCode || '').trim().toLowerCase()) {
    case 'missing_identifier':
      return '缺少匹配标识'
    case 'product_mapping_miss':
      return '商品映射缺失'
    case 'pending_product_mapping_miss':
      return '商品映射待补齐'
    case 'offer_mapping_miss':
      return 'Offer映射缺失'
    case 'pending_offer_mapping_miss':
      return 'Offer映射待补齐'
    case 'campaign_mapping_miss':
      return '无活动Campaign'
    default:
      return reasonCode || 'unknown'
  }
}

async function queryAffiliateAttributionFailureSummary(params: {
  db: DatabaseAdapter
  userId: number
  reportDate: string
}): Promise<{ totalRows: number; totalCommission: number; topReasons: AffiliateReconciliationTopReason[] }> {
  const unattributedFailureFilter = buildAffiliateUnattributedFailureFilter()
  try {
    const rows = await params.db.query<AttributionFailureSummaryRow>(
      `
        SELECT
          reason_code,
          COUNT(*) AS reason_count,
          COALESCE(SUM(commission_amount), 0) AS commission
        FROM openclaw_affiliate_attribution_failures
        WHERE user_id = ?
          AND report_date = ?
          AND ${unattributedFailureFilter.sql}
        GROUP BY reason_code
        ORDER BY reason_count DESC, commission DESC
      `,
      [params.userId, params.reportDate, ...unattributedFailureFilter.values]
    )

    const topReasons = rows.map((row) => ({
      code: String(row.reason_code || 'unknown'),
      label: formatAffiliateFailureReasonLabel(String(row.reason_code || 'unknown')),
      count: Math.round(toNumber(row.reason_count, 0)),
      commission: roundTo2(toNumber(row.commission, 0)),
    }))

    return {
      totalRows: topReasons.reduce((sum, item) => sum + item.count, 0),
      totalCommission: roundTo2(topReasons.reduce((sum, item) => sum + item.commission, 0)),
      topReasons: topReasons.slice(0, 5),
    }
  } catch (error: any) {
    const message = String(error?.message || '')
    if (
      /openclaw_affiliate_attribution_failures/i.test(message)
      && /(no such table|does not exist)/i.test(message)
    ) {
      return {
        totalRows: 0,
        totalCommission: 0,
        topReasons: [],
      }
    }
    throw error
  }
}

function buildAffiliateReconciliationSnapshot(params: {
  reportDate: string
  totalRevenue: number
  attributedRevenue: number
  failureRows: number
  failureCommission: number
  topReasons: AffiliateReconciliationTopReason[]
}): AffiliateReconciliationSnapshot {
  const totalRevenue = roundTo2(Math.max(0, toNumber(params.totalRevenue, 0)))
  const attributedRevenue = roundTo2(Math.max(0, toNumber(params.attributedRevenue, 0)))
  const gap = roundTo2(Math.max(0, totalRevenue - attributedRevenue))
  const gapRatio = totalRevenue > 0 ? roundTo2((gap / totalRevenue) * 100) : 0
  const hasGap = gap >= RECONCILIATION_GAP_ALERT_EPSILON
  const severity = !hasGap
    ? null
    : (
        gap >= RECONCILIATION_CRITICAL_GAP_AMOUNT || gapRatio >= RECONCILIATION_CRITICAL_GAP_RATIO
          ? 'critical'
          : 'warning'
      )

  return {
    reportDate: params.reportDate,
    totalRevenue,
    attributedRevenue,
    gap,
    gapRatio,
    hasGap,
    severity,
    failureRows: Math.max(0, Math.round(toNumber(params.failureRows, 0))),
    failureCommission: roundTo2(Math.max(0, toNumber(params.failureCommission, 0))),
    topFailureReasons: params.topReasons.slice(0, 5),
  }
}

function attachAffiliateReconciliation(params: {
  roi: unknown
  reconciliation: AffiliateReconciliationSnapshot
}) {
  const roiRoot = asObject(params.roi) ? { ...(params.roi as Record<string, any>) } : {}
  const roiData = asObject(roiRoot.data) ? { ...(roiRoot.data as Record<string, any>) } : {}
  const roiOverall = asObject(roiData.overall) ? { ...(roiData.overall as Record<string, any>) } : {}

  roiData.overall = {
    ...roiOverall,
    affiliateReconciliation: params.reconciliation,
  }

  return {
    ...roiRoot,
    data: roiData,
  }
}

async function queryCampaignPerformanceByDateRange(params: {
  db: DatabaseAdapter
  userId: number
  startDate: string
  endDate: string
}): Promise<Map<string, DailyPerformanceSnapshot>> {
  const rows = await params.db.query<CampaignPerformanceByDateRow>(
    `
      SELECT
        DATE(date) AS date,
        COALESCE(SUM(impressions), 0) AS impressions,
        COALESCE(SUM(clicks), 0) AS clicks,
        COALESCE(SUM(cost), 0) AS cost,
        COALESCE(SUM(conversions), 0) AS conversions
      FROM campaign_performance
      WHERE user_id = ?
        AND date >= ?
        AND date <= ?
      GROUP BY DATE(date)
      ORDER BY DATE(date) ASC
    `,
    [params.userId, params.startDate, params.endDate]
  )

  const map = new Map<string, DailyPerformanceSnapshot>()
  for (const row of rows) {
    const date = normalizeTrendDateKey(row.date)
    if (!isIsoDateString(date)) continue
    map.set(date, {
      impressions: toNumber(row.impressions, 0),
      clicks: toNumber(row.clicks, 0),
      cost: roundTo2(toNumber(row.cost, 0)),
      conversions: roundTo2(toNumber(row.conversions, 0)),
    })
  }
  return map
}

async function queryCommissionByDateRange(params: {
  db: DatabaseAdapter
  userId: number
  startDate: string
  endDate: string
}): Promise<Map<string, number>> {
  const rows = await params.db.query<CommissionByDateRow>(
    `
      SELECT
        report_date,
        COALESCE(SUM(commission_amount), 0) AS commission
      FROM affiliate_commission_attributions
      WHERE user_id = ?
        AND report_date >= ?
        AND report_date <= ?
      GROUP BY report_date
      ORDER BY report_date ASC
    `,
    [params.userId, params.startDate, params.endDate]
  )

  const map = new Map<string, number>()
  for (const row of rows) {
    const date = normalizeTrendDateKey(row.report_date)
    if (!isIsoDateString(date)) continue
    map.set(date, roundTo2(toNumber(row.commission, 0)))
  }
  return map
}

async function queryRangeKpiSnapshot(params: {
  db: DatabaseAdapter
  userId: number
  startDate: string
  endDate: string
}): Promise<{
  totalOffers: number
  totalCampaigns: number
  impressions: number
  clicks: number
  cost: number
  conversions: number
}> {
  const campaignNotDeletedCondition = params.db.type === 'postgres'
    ? '(c.is_deleted = false OR c.is_deleted IS NULL)'
    : '(c.is_deleted = 0 OR c.is_deleted IS NULL)'

  const row = await params.db.queryOne<ReportRangeKpiRow>(
    `
      SELECT
        COUNT(DISTINCT CASE WHEN cp.campaign_id IS NOT NULL AND c.offer_id IS NOT NULL THEN c.offer_id END) AS total_offers,
        COUNT(DISTINCT CASE WHEN cp.campaign_id IS NOT NULL THEN c.id END) AS total_campaigns,
        COALESCE(SUM(cp.impressions), 0) AS impressions,
        COALESCE(SUM(cp.clicks), 0) AS clicks,
        COALESCE(SUM(cp.cost), 0) AS cost,
        COALESCE(SUM(cp.conversions), 0) AS conversions
      FROM campaigns c
      LEFT JOIN campaign_performance cp
        ON cp.user_id = c.user_id
       AND cp.campaign_id = c.id
       AND cp.date >= ?
       AND cp.date <= ?
      WHERE c.user_id = ?
        AND ${campaignNotDeletedCondition}
    `,
    [params.startDate, params.endDate, params.userId]
  )

  return {
    totalOffers: Math.max(0, Math.round(toNumber(row?.total_offers, 0))),
    totalCampaigns: Math.max(0, Math.round(toNumber(row?.total_campaigns, 0))),
    impressions: Math.max(0, Math.round(toNumber(row?.impressions, 0))),
    clicks: Math.max(0, Math.round(toNumber(row?.clicks, 0))),
    cost: roundTo2(toNumber(row?.cost, 0)),
    conversions: roundTo2(toNumber(row?.conversions, 0)),
  }
}

function normalizeAffiliatePlatform(value: unknown): 'partnerboost' | 'yeahpromos' | null {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'partnerboost') return 'partnerboost'
  if (normalized === 'yeahpromos') return 'yeahpromos'
  return null
}

async function buildAffiliateRevenueSummaryByDateRange(params: {
  db: DatabaseAdapter
  userId: number
  startDate: string
  endDate: string
}): Promise<AffiliateCommissionRevenue> {
  const unattributedFailureFilter = buildAffiliateUnattributedFailureFilter()
  const queryUnattributedFailureByDateRange = async (): Promise<{
    platformRows: PlatformCommissionSummaryRow[]
    totalCommission: number
    totalRows: number
  }> => {
    try {
      const [platformRows, summaryRow] = await Promise.all([
        params.db.query<PlatformCommissionSummaryRow>(
          `
            SELECT
              platform,
              currency,
              COALESCE(SUM(commission_amount), 0) AS total_commission,
              COUNT(*) AS records
            FROM openclaw_affiliate_attribution_failures
            WHERE user_id = ?
              AND report_date >= ?
              AND report_date <= ?
              AND ${unattributedFailureFilter.sql}
            GROUP BY platform, currency
            ORDER BY total_commission DESC
          `,
          [params.userId, params.startDate, params.endDate, ...unattributedFailureFilter.values]
        ),
        params.db.queryOne<UnattributedFailureSummaryRangeRow>(
          `
            SELECT
              COALESCE(SUM(commission_amount), 0) AS total_commission,
              COUNT(*) AS total_rows
            FROM openclaw_affiliate_attribution_failures
            WHERE user_id = ?
              AND report_date >= ?
              AND report_date <= ?
              AND ${unattributedFailureFilter.sql}
          `,
          [params.userId, params.startDate, params.endDate, ...unattributedFailureFilter.values]
        ),
      ])

      return {
        platformRows,
        totalCommission: roundTo2(toNumber(summaryRow?.total_commission, 0)),
        totalRows: Math.max(0, Math.round(toNumber(summaryRow?.total_rows, 0))),
      }
    } catch (error: any) {
      const message = String(error?.message || '')
      if (
        /openclaw_affiliate_attribution_failures/i.test(message)
        && /(no such table|does not exist)/i.test(message)
      ) {
        return {
          platformRows: [],
          totalCommission: 0,
          totalRows: 0,
        }
      }
      throw error
    }
  }

  const [platformRows, attributionRow, unattributedFailureSummary] = await Promise.all([
    params.db.query<PlatformCommissionSummaryRow>(
      `
        SELECT
          platform,
          currency,
          COALESCE(SUM(commission_amount), 0) AS total_commission,
          COUNT(*) AS records
        FROM affiliate_commission_attributions
        WHERE user_id = ?
          AND report_date >= ?
          AND report_date <= ?
        GROUP BY platform, currency
        ORDER BY total_commission DESC
      `,
      [params.userId, params.startDate, params.endDate]
    ),
    params.db.queryOne<AttributionSummaryRangeRow>(
      `
        SELECT
          COALESCE(SUM(commission_amount), 0) AS total_commission,
          COALESCE(SUM(
            CASE
              WHEN offer_id IS NOT NULL OR campaign_id IS NOT NULL THEN commission_amount
              ELSE 0
            END
          ), 0) AS attributed_commission,
          COUNT(*) AS written_rows,
          COUNT(DISTINCT CASE WHEN offer_id IS NOT NULL THEN offer_id END) AS attributed_offers,
          COUNT(DISTINCT CASE WHEN campaign_id IS NOT NULL THEN campaign_id END) AS attributed_campaigns
        FROM affiliate_commission_attributions
        WHERE user_id = ?
          AND report_date >= ?
          AND report_date <= ?
      `,
      [params.userId, params.startDate, params.endDate]
    ),
    queryUnattributedFailureByDateRange(),
  ])

  const breakdownMap = new Map<string, {
    platform: 'partnerboost' | 'yeahpromos'
    currency: string
    totalCommission: number
    records: number
  }>()
  const appendBreakdownRows = (rows: PlatformCommissionSummaryRow[]) => {
    for (const row of rows) {
      const platform = normalizeAffiliatePlatform(row.platform)
      if (!platform) continue
      const currency = normalizeCurrencyCode(row.currency, 'USD')
      const key = `${platform}:${currency}`
      const current = breakdownMap.get(key) || {
        platform,
        currency,
        totalCommission: 0,
        records: 0,
      }
      current.totalCommission = roundTo2(current.totalCommission + toNumber(row.total_commission, 0))
      current.records = Math.max(0, current.records + Math.round(toNumber(row.records, 0)))
      breakdownMap.set(key, current)
    }
  }
  appendBreakdownRows(platformRows)
  appendBreakdownRows(unattributedFailureSummary.platformRows)

  const mergedBreakdown: AffiliateCommissionRevenue['breakdown'] = Array.from(breakdownMap.values())
    .filter((row) => row.totalCommission > 0 || row.records > 0)
    .sort((a, b) => (b.totalCommission - a.totalCommission) || a.platform.localeCompare(b.platform))
    .map((row) => ({
      platform: row.platform,
      totalCommission: roundTo2(row.totalCommission),
      records: row.records,
      currency: row.currency,
    }))

  const configuredPlatforms: Array<'partnerboost' | 'yeahpromos'> = []
  const queriedPlatforms: Array<'partnerboost' | 'yeahpromos'> = []
  const configuredSet = new Set<'partnerboost' | 'yeahpromos'>()
  const queriedSet = new Set<'partnerboost' | 'yeahpromos'>()

  for (const row of mergedBreakdown) {
    const platform = row.platform
    if (!configuredSet.has(platform)) {
      configuredSet.add(platform)
      configuredPlatforms.push(platform)
    }
    if (!queriedSet.has(platform)) {
      queriedSet.add(platform)
      queriedPlatforms.push(platform)
    }
  }

  const attributedRowsCommission = roundTo2(toNumber(attributionRow?.total_commission, 0))
  const attributedCommission = roundTo2(toNumber(attributionRow?.attributed_commission, 0))
  const unattributedFromAttributionRows = roundTo2(Math.max(0, attributedRowsCommission - attributedCommission))
  const unattributedFromFailureRows = roundTo2(Math.max(0, unattributedFailureSummary.totalCommission))
  const totalCommission = roundTo2(attributedRowsCommission + unattributedFromFailureRows)
  const unattributedCommission = roundTo2(unattributedFromAttributionRows + unattributedFromFailureRows)

  return {
    reportDate: params.endDate,
    configuredPlatforms,
    queriedPlatforms,
    totalCommission,
    breakdown: mergedBreakdown,
    errors: [],
    attribution: {
      attributedCommission,
      unattributedCommission,
      attributedOffers: Math.max(0, Math.round(toNumber(attributionRow?.attributed_offers, 0))),
      attributedCampaigns: Math.max(0, Math.round(toNumber(attributionRow?.attributed_campaigns, 0))),
      writtenRows: Math.max(0, Math.round(toNumber(attributionRow?.written_rows, 0))),
    },
  }
}

async function queryOfferRevenueByDateRange(params: {
  db: DatabaseAdapter
  userId: number
  startDate: string
  endDate: string
}): Promise<OfferRevenueRow[]> {
  return params.db.query<OfferRevenueRow>(
    `
      SELECT
        offer_id,
        COALESCE(SUM(commission_amount), 0) AS revenue,
        COUNT(DISTINCT campaign_id) AS attributed_campaign_count
      FROM affiliate_commission_attributions
      WHERE user_id = ?
        AND report_date >= ?
        AND report_date <= ?
        AND offer_id IS NOT NULL
      GROUP BY offer_id
      ORDER BY revenue DESC
    `,
    [params.userId, params.startDate, params.endDate]
  )
}

async function queryOfferPerformanceByDateRange(params: {
  db: DatabaseAdapter
  userId: number
  startDate: string
  endDate: string
}): Promise<OfferPerformanceRow[]> {
  const campaignNotDeletedCondition = params.db.type === 'postgres'
    ? '(c.is_deleted = false OR c.is_deleted IS NULL)'
    : '(c.is_deleted = 0 OR c.is_deleted IS NULL)'

  return params.db.query<OfferPerformanceRow>(
    `
      SELECT
        c.offer_id AS offer_id,
        COALESCE(SUM(cp.cost), 0) AS cost,
        COALESCE(SUM(cp.clicks), 0) AS clicks,
        COUNT(DISTINCT c.id) AS campaign_count
      FROM campaigns c
      LEFT JOIN campaign_performance cp
        ON cp.user_id = c.user_id
       AND cp.campaign_id = c.id
       AND cp.date >= ?
       AND cp.date <= ?
      WHERE c.user_id = ?
        AND c.offer_id IS NOT NULL
        AND ${campaignNotDeletedCondition}
      GROUP BY c.offer_id
    `,
    [params.startDate, params.endDate, params.userId]
  )
}

async function queryCampaignRevenueByDateRange(params: {
  db: DatabaseAdapter
  userId: number
  startDate: string
  endDate: string
}): Promise<CampaignRevenueRow[]> {
  return params.db.query<CampaignRevenueRow>(
    `
      SELECT
        campaign_id,
        offer_id,
        COALESCE(SUM(commission_amount), 0) AS revenue
      FROM affiliate_commission_attributions
      WHERE user_id = ?
        AND report_date >= ?
        AND report_date <= ?
        AND campaign_id IS NOT NULL
      GROUP BY campaign_id, offer_id
      ORDER BY revenue DESC
    `,
    [params.userId, params.startDate, params.endDate]
  )
}

async function queryCampaignPerformanceByDateRangeForBreakdown(params: {
  db: DatabaseAdapter
  userId: number
  startDate: string
  endDate: string
}): Promise<CampaignPerformanceRow[]> {
  const campaignNotDeletedCondition = params.db.type === 'postgres'
    ? '(c.is_deleted = false OR c.is_deleted IS NULL)'
    : '(c.is_deleted = 0 OR c.is_deleted IS NULL)'

  return params.db.query<CampaignPerformanceRow>(
    `
      SELECT
        c.id AS campaign_id,
        c.campaign_name AS campaign_name,
        c.status AS status,
        c.offer_id AS offer_id,
        COALESCE(SUM(cp.cost), 0) AS cost,
        COALESCE(SUM(cp.clicks), 0) AS clicks
      FROM campaigns c
      LEFT JOIN campaign_performance cp
        ON cp.user_id = c.user_id
       AND cp.campaign_id = c.id
       AND cp.date >= ?
       AND cp.date <= ?
      WHERE c.user_id = ?
        AND ${campaignNotDeletedCondition}
      GROUP BY c.id, c.campaign_name, c.status, c.offer_id
    `,
    [params.startDate, params.endDate, params.userId]
  )
}

async function queryOfferRevenueByReportDate(params: {
  db: DatabaseAdapter
  userId: number
  reportDate: string
}): Promise<OfferRevenueRow[]> {
  return params.db.query<OfferRevenueRow>(
    `
      SELECT
        offer_id,
        COALESCE(SUM(commission_amount), 0) AS revenue,
        COUNT(DISTINCT campaign_id) AS attributed_campaign_count
      FROM affiliate_commission_attributions
      WHERE user_id = ?
        AND report_date = ?
        AND offer_id IS NOT NULL
      GROUP BY offer_id
      ORDER BY revenue DESC
    `,
    [params.userId, params.reportDate]
  )
}

async function queryOfferPerformanceByReportDate(params: {
  db: DatabaseAdapter
  userId: number
  reportDate: string
}): Promise<OfferPerformanceRow[]> {
  const campaignNotDeletedCondition = params.db.type === 'postgres'
    ? '(c.is_deleted = false OR c.is_deleted IS NULL)'
    : '(c.is_deleted = 0 OR c.is_deleted IS NULL)'

  return params.db.query<OfferPerformanceRow>(
    `
      SELECT
        c.offer_id AS offer_id,
        COALESCE(SUM(cp.cost), 0) AS cost,
        COALESCE(SUM(cp.clicks), 0) AS clicks,
        COUNT(DISTINCT c.id) AS campaign_count
      FROM campaigns c
      LEFT JOIN campaign_performance cp
        ON cp.user_id = c.user_id
       AND cp.campaign_id = c.id
       AND cp.date = ?
      WHERE c.user_id = ?
        AND c.offer_id IS NOT NULL
        AND ${campaignNotDeletedCondition}
      GROUP BY c.offer_id
    `,
    [params.reportDate, params.userId]
  )
}

async function queryCampaignRevenueByReportDate(params: {
  db: DatabaseAdapter
  userId: number
  reportDate: string
}): Promise<CampaignRevenueRow[]> {
  return params.db.query<CampaignRevenueRow>(
    `
      SELECT
        campaign_id,
        offer_id,
        COALESCE(SUM(commission_amount), 0) AS revenue
      FROM affiliate_commission_attributions
      WHERE user_id = ?
        AND report_date = ?
        AND campaign_id IS NOT NULL
      GROUP BY campaign_id, offer_id
      ORDER BY revenue DESC
    `,
    [params.userId, params.reportDate]
  )
}

async function queryCampaignPerformanceByReportDate(params: {
  db: DatabaseAdapter
  userId: number
  reportDate: string
}): Promise<CampaignPerformanceRow[]> {
  const campaignNotDeletedCondition = params.db.type === 'postgres'
    ? '(c.is_deleted = false OR c.is_deleted IS NULL)'
    : '(c.is_deleted = 0 OR c.is_deleted IS NULL)'

  return params.db.query<CampaignPerformanceRow>(
    `
      SELECT
        c.id AS campaign_id,
        c.campaign_name AS campaign_name,
        c.status AS status,
        c.offer_id AS offer_id,
        COALESCE(SUM(cp.cost), 0) AS cost,
        COALESCE(SUM(cp.clicks), 0) AS clicks
      FROM campaigns c
      LEFT JOIN campaign_performance cp
        ON cp.user_id = c.user_id
       AND cp.campaign_id = c.id
       AND cp.date = ?
      WHERE c.user_id = ?
        AND ${campaignNotDeletedCondition}
      GROUP BY c.id, c.campaign_name, c.status, c.offer_id
    `,
    [params.reportDate, params.userId]
  )
}

async function queryOfferMetaMap(params: {
  db: DatabaseAdapter
  userId: number
  offerIds: number[]
}): Promise<Map<number, { offerName: string; brand: string }>> {
  const map = new Map<number, { offerName: string; brand: string }>()
  const offerIds = Array.from(
    new Set(
      params.offerIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  )
  if (offerIds.length === 0) return map

  const rows = await params.db.query<OfferMetaRow>(
    `
      SELECT id, offer_name, brand
      FROM offers
      WHERE user_id = ?
        AND id IN (${offerIds.map(() => '?').join(', ')})
    `,
    [params.userId, ...offerIds]
  )

  for (const row of rows) {
    const offerId = Number(row.id)
    if (!Number.isFinite(offerId)) continue
    map.set(offerId, {
      offerName: String(row.offer_name || '').trim(),
      brand: String(row.brand || '').trim(),
    })
  }
  return map
}

function buildUnattributedOfferRow(reportDate: string, revenue: number): ReportOfferBreakdownRow {
  return {
    offerId: `unattributed-${reportDate}`,
    offerName: 'Unattributed Commission',
    brand: 'UNATTRIBUTED',
    campaignCount: 0,
    attributedCampaignCount: 0,
    clicks: 0,
    cost: 0,
    revenue: roundTo2(revenue),
    profit: roundTo2(revenue),
    roi: null,
    roas: null,
    isUnattributed: true,
  }
}

function buildUnattributedCampaignRow(reportDate: string, revenue: number): ReportCampaignBreakdownRow {
  return {
    campaignId: `unattributed-${reportDate}`,
    campaignName: 'Unattributed Commission',
    status: 'N/A',
    offerId: null,
    offerName: 'Unattributed Commission',
    offerBrand: 'UNATTRIBUTED',
    clicks: 0,
    cost: 0,
    revenue: roundTo2(revenue),
    profit: roundTo2(revenue),
    roi: null,
    roas: null,
    isUnattributed: true,
  }
}

async function enrichReportCommissionSections(params: {
  db: DatabaseAdapter
  userId: number
  reportDate: string
  startDate?: string
  trends: unknown
  roi: unknown
}): Promise<{ trends: any; roi: any }> {
  const reportDate = normalizeOpenclawReportDate(params.reportDate)
  const hasRangeStartDate = isIsoDateString(String(params.startDate || '').trim())
  const normalizedRange = hasRangeStartDate
    ? resolveNormalizedDateRange(String(params.startDate || reportDate), reportDate)
    : { startDate: shiftYmdDate(reportDate, -(REPORT_TREND_DAYS - 1)), endDate: reportDate }
  const trendStartDate = normalizedRange.startDate
  const trendEndDate = normalizedRange.endDate
  const trendDates = buildYmdDateRange(trendStartDate, trendEndDate)
  const isDateRangeMode = trendStartDate < trendEndDate

  const roiRoot = asObject(params.roi) ? { ...(params.roi as Record<string, any>) } : {}
  const roiData = asObject(roiRoot.data) ? { ...(roiRoot.data as Record<string, any>) } : {}
  const roiOverall = asObject(roiData.overall) ? { ...(roiData.overall as Record<string, any>) } : {}

  const totalRevenueRaw = roiOverall.totalRevenue
  const totalRevenue = totalRevenueRaw === null || totalRevenueRaw === undefined
    ? null
    : toNumber(totalRevenueRaw, NaN)
  const revenueAvailable = roiOverall.revenueAvailable !== false
    && totalRevenue !== null
    && Number.isFinite(totalRevenue)

  const [
    performanceByDate,
    commissionByDate,
    offerRevenueRows,
    offerPerformanceRows,
    campaignRevenueRows,
    campaignPerformanceRows,
  ] = await Promise.all([
    queryCampaignPerformanceByDateRange({
      db: params.db,
      userId: params.userId,
      startDate: trendStartDate,
      endDate: trendEndDate,
    }),
    queryCommissionByDateRange({
      db: params.db,
      userId: params.userId,
      startDate: trendStartDate,
      endDate: trendEndDate,
    }),
    isDateRangeMode
      ? queryOfferRevenueByDateRange({
        db: params.db,
        userId: params.userId,
        startDate: trendStartDate,
        endDate: trendEndDate,
      })
      : queryOfferRevenueByReportDate({
        db: params.db,
        userId: params.userId,
        reportDate,
      }),
    isDateRangeMode
      ? queryOfferPerformanceByDateRange({
        db: params.db,
        userId: params.userId,
        startDate: trendStartDate,
        endDate: trendEndDate,
      })
      : queryOfferPerformanceByReportDate({
        db: params.db,
        userId: params.userId,
        reportDate,
      }),
    isDateRangeMode
      ? queryCampaignRevenueByDateRange({
        db: params.db,
        userId: params.userId,
        startDate: trendStartDate,
        endDate: trendEndDate,
      })
      : queryCampaignRevenueByReportDate({
        db: params.db,
        userId: params.userId,
        reportDate,
      }),
    isDateRangeMode
      ? queryCampaignPerformanceByDateRangeForBreakdown({
        db: params.db,
        userId: params.userId,
        startDate: trendStartDate,
        endDate: trendEndDate,
      })
      : queryCampaignPerformanceByReportDate({
        db: params.db,
        userId: params.userId,
        reportDate,
      }),
  ])

  const attributedCommissionForRange = roundTo2(
    trendDates.reduce((sum, date) => sum + roundTo2(commissionByDate.get(date) || 0), 0)
  )
  const revenueValue = revenueAvailable ? roundTo2(totalRevenue || 0) : 0
  const unattributedRevenue = revenueAvailable
    ? roundTo2(Math.max(0, revenueValue - attributedCommissionForRange))
    : 0
  if (unattributedRevenue > COMMISSION_EPSILON) {
    const endDateCommission = roundTo2(commissionByDate.get(trendEndDate) || 0)
    commissionByDate.set(trendEndDate, roundTo2(endDateCommission + unattributedRevenue))
  }

  const trendRows = trendDates.map((date) => {
    const perf = performanceByDate.get(date) || {
      impressions: 0,
      clicks: 0,
      cost: 0,
      conversions: 0,
    }
    const commission = roundTo2(commissionByDate.get(date) || 0)
    const impressions = toNumber(perf.impressions, 0)
    const clicks = toNumber(perf.clicks, 0)
    const cost = roundTo2(toNumber(perf.cost, 0))
    const conversions = roundTo2(toNumber(perf.conversions, 0))
    return {
      date,
      impressions,
      clicks,
      cost,
      conversions,
      commission,
      ctr: impressions > 0 ? roundTo2((clicks / impressions) * 100) : 0,
      cpc: clicks > 0 ? roundTo2(cost / clicks) : 0,
    }
  })

  const trendSummary = {
    totalImpressions: trendRows.reduce((sum, row) => sum + row.impressions, 0),
    totalClicks: trendRows.reduce((sum, row) => sum + row.clicks, 0),
    totalCost: roundTo2(trendRows.reduce((sum, row) => sum + row.cost, 0)),
    totalConversions: roundTo2(trendRows.reduce((sum, row) => sum + row.conversions, 0)),
    totalCommission: roundTo2(trendRows.reduce((sum, row) => sum + row.commission, 0)),
    avgCTR: 0,
    avgCPC: 0,
  }
  trendSummary.avgCTR = trendSummary.totalImpressions > 0
    ? roundTo2((trendSummary.totalClicks / trendSummary.totalImpressions) * 100)
    : 0
  trendSummary.avgCPC = trendSummary.totalClicks > 0
    ? roundTo2(trendSummary.totalCost / trendSummary.totalClicks)
    : 0

  const trendsRoot = asObject(params.trends) ? { ...(params.trends as Record<string, any>) } : {}
  const trendsData = asObject(trendsRoot.data) ? { ...(trendsRoot.data as Record<string, any>) } : {}
  const trendsSummaryExisting = asObject(trendsData.summary)
    ? { ...(trendsData.summary as Record<string, any>) }
    : {}
  trendsData.trends = trendRows
  trendsData.summary = {
    ...trendsSummaryExisting,
    ...trendSummary,
  }
  const normalizedTrends = {
    ...trendsRoot,
    data: trendsData,
  }

  const offerMetaMap = await queryOfferMetaMap({
    db: params.db,
    userId: params.userId,
    offerIds: [
      ...offerRevenueRows.map((row) => Number(row.offer_id)),
      ...campaignPerformanceRows.map((row) => Number(row.offer_id)),
    ],
  })

  const offerPerformanceMap = new Map<number, {
    cost: number
    clicks: number
    campaignCount: number
  }>()
  for (const row of offerPerformanceRows) {
    const offerId = Number(row.offer_id)
    if (!Number.isFinite(offerId)) continue
    offerPerformanceMap.set(offerId, {
      cost: roundTo2(toNumber(row.cost, 0)),
      clicks: Math.round(toNumber(row.clicks, 0)),
      campaignCount: Math.round(toNumber(row.campaign_count, 0)),
    })
  }

  const attributedOfferRows = offerRevenueRows
    .map((row): ReportOfferBreakdownRow | null => {
      const offerId = Number(row.offer_id)
      if (!Number.isFinite(offerId)) return null
      const revenue = roundTo2(toNumber(row.revenue, 0))
      if (revenue <= 0) return null

      const perf = offerPerformanceMap.get(offerId)
      const cost = roundTo2(toNumber(perf?.cost, 0))
      const profit = roundTo2(revenue - cost)
      const offerMeta = offerMetaMap.get(offerId)
      return {
        offerId,
        offerName: offerMeta?.offerName || `Offer #${offerId}`,
        brand: offerMeta?.brand || '-',
        campaignCount: perf?.campaignCount || 0,
        attributedCampaignCount: Math.round(toNumber(row.attributed_campaign_count, 0)),
        clicks: perf?.clicks || 0,
        cost,
        revenue,
        profit,
        roi: calculateRoiPercent(revenue, cost),
        roas: calculateRoasValue(revenue, cost),
        isUnattributed: false,
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => (b.revenue - a.revenue) || (Number(a.offerId) - Number(b.offerId)))

  const offerRows: ReportOfferBreakdownRow[] = [...attributedOfferRows]
  if (unattributedRevenue > COMMISSION_EPSILON) {
    offerRows.push(buildUnattributedOfferRow(reportDate, unattributedRevenue))
  }

  const campaignPerformanceMap = new Map<number, {
    campaignName: string
    status: string
    offerId: number | null
    cost: number
    clicks: number
  }>()
  for (const row of campaignPerformanceRows) {
    const campaignId = Number(row.campaign_id)
    if (!Number.isFinite(campaignId)) continue
    campaignPerformanceMap.set(campaignId, {
      campaignName: String(row.campaign_name || '').trim() || `Campaign #${campaignId}`,
      status: normalizeCampaignStatus(row.status),
      offerId: Number.isFinite(Number(row.offer_id)) ? Number(row.offer_id) : null,
      cost: roundTo2(toNumber(row.cost, 0)),
      clicks: Math.round(toNumber(row.clicks, 0)),
    })
  }

  const attributedCampaignRows = campaignRevenueRows
    .map((row): ReportCampaignBreakdownRow | null => {
      const campaignId = Number(row.campaign_id)
      if (!Number.isFinite(campaignId)) return null
      const revenue = roundTo2(toNumber(row.revenue, 0))
      if (revenue <= 0) return null

      const perf = campaignPerformanceMap.get(campaignId)
      const offerIdFromRevenue = Number(row.offer_id)
      const offerId = Number.isFinite(offerIdFromRevenue)
        ? offerIdFromRevenue
        : (perf?.offerId ?? null)
      const offerMeta = offerId !== null ? offerMetaMap.get(offerId) : undefined
      const cost = roundTo2(toNumber(perf?.cost, 0))
      const profit = roundTo2(revenue - cost)

      return {
        campaignId,
        campaignName: perf?.campaignName || `Campaign #${campaignId}`,
        status: perf?.status || 'UNKNOWN',
        offerId,
        offerName: offerId !== null ? (offerMeta?.offerName || `Offer #${offerId}`) : '-',
        offerBrand: offerMeta?.brand || '-',
        clicks: perf?.clicks || 0,
        cost,
        revenue,
        profit,
        roi: calculateRoiPercent(revenue, cost),
        roas: calculateRoasValue(revenue, cost),
        isUnattributed: false,
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => (b.revenue - a.revenue) || (Number(a.campaignId) - Number(b.campaignId)))

  const campaignRows: ReportCampaignBreakdownRow[] = [...attributedCampaignRows]
  if (unattributedRevenue > COMMISSION_EPSILON) {
    campaignRows.push(buildUnattributedCampaignRow(reportDate, unattributedRevenue))
  }

  roiData.byOffer = offerRows
  roiData.byCampaign = campaignRows
  roiData.breakdownSource = 'affiliate_commission_attributions'
  roiData.attributedRevenue = roundTo2(attributedCommissionForRange)
  roiData.unattributedRevenue = roundTo2(unattributedRevenue)
  roiData.hasUnattributedRevenue = unattributedRevenue > COMMISSION_EPSILON
  roiData.reportDate = reportDate
  roiData.startDate = trendStartDate
  roiData.endDate = trendEndDate
  roiData.isRange = isDateRangeMode
  roiData.overall = {
    ...roiOverall,
    attributedRevenue: roundTo2(attributedCommissionForRange),
    unattributedRevenue: roundTo2(unattributedRevenue),
  }

  return {
    trends: normalizedTrends,
    roi: {
      ...roiRoot,
      data: roiData,
    },
  }
}

function mergeRoiWithAffiliateRevenue(params: {
  roi: unknown
  summary: any
  affiliateRevenue: AffiliateCommissionRevenue
  errors: DailyReportPayload['errors']
}) {
  const roiRoot = asObject(params.roi) ? { ...(params.roi as Record<string, any>) } : {}
  const roiData = asObject(roiRoot.data) ? { ...(roiRoot.data as Record<string, any>) } : {}
  const roiOverall = asObject(roiData.overall)
    ? { ...(roiData.overall as Record<string, any>) }
    : {}

  const totalCost = roundTo2(toNumber(roiOverall.totalCost, toNumber(params.summary?.kpis?.totalCost, 0)))
  const hasAffiliateConfigured = params.affiliateRevenue.configuredPlatforms.length > 0
  const hasAffiliateData = params.affiliateRevenue.queriedPlatforms.length > 0
  const revenueAvailable = hasAffiliateConfigured && hasAffiliateData

  const totalRevenue = revenueAvailable
    ? roundTo2(params.affiliateRevenue.totalCommission)
    : null
  const totalProfit = revenueAvailable
    ? roundTo2((totalRevenue || 0) - totalCost)
    : null
  const roiPercent = revenueAvailable
    ? (totalCost > 0 ? roundTo2(((totalProfit || 0) / totalCost) * 100) : 0)
    : null
  const roas = revenueAvailable
    ? (totalCost > 0 ? roundTo2((totalRevenue || 0) / totalCost) : 0)
    : null

  for (const item of params.affiliateRevenue.errors) {
    params.errors?.push({
      source: `affiliate.${item.platform}`,
      message: item.message,
    })
  }

  roiData.overall = {
    ...roiOverall,
    totalCost,
    totalRevenue,
    totalProfit,
    roi: roiPercent,
    roas,
    revenueAvailable,
    revenueSource: revenueAvailable ? 'affiliate_commission' : 'unavailable',
    unavailableReason: revenueAvailable
      ? null
      : hasAffiliateConfigured
        ? 'affiliate_query_failed'
        : 'affiliate_not_configured',
    affiliateCommissionRevenue: roundTo2(params.affiliateRevenue.totalCommission),
    affiliateConfiguredPlatforms: params.affiliateRevenue.configuredPlatforms,
    affiliateQueriedPlatforms: params.affiliateRevenue.queriedPlatforms,
    affiliateBreakdown: params.affiliateRevenue.breakdown,
    affiliateAttribution: params.affiliateRevenue.attribution,
  }

  return {
    ...roiRoot,
    data: roiData,
  }
}

function mergeSummaryAndKpisWithRangeSnapshot(params: {
  summary: unknown
  kpis: unknown
  startDate: string
  endDate: string
  snapshot: {
    totalOffers: number
    totalCampaigns: number
    impressions: number
    clicks: number
    cost: number
    conversions: number
  }
}): { summary: any; kpis: any } {
  const days = calculateInclusiveDateSpan(params.startDate, params.endDate)

  const summaryRoot = asObject(params.summary) ? { ...(params.summary as Record<string, any>) } : {}
  const summaryKpis = asObject(summaryRoot.kpis) ? { ...(summaryRoot.kpis as Record<string, any>) } : {}
  summaryRoot.kpis = {
    ...summaryKpis,
    totalOffers: params.snapshot.totalOffers,
    totalCampaigns: params.snapshot.totalCampaigns,
    totalImpressions: params.snapshot.impressions,
    totalClicks: params.snapshot.clicks,
    totalCost: params.snapshot.cost,
    totalConversions: params.snapshot.conversions,
    dateRange: {
      startDate: params.startDate,
      endDate: params.endDate,
      days,
      isRange: params.startDate < params.endDate,
    },
  }

  const kpisRoot = asObject(params.kpis) ? { ...(params.kpis as Record<string, any>) } : {}
  const kpisData = asObject(kpisRoot.data) ? { ...(kpisRoot.data as Record<string, any>) } : {}
  const kpisCurrent = asObject(kpisData.current) ? { ...(kpisData.current as Record<string, any>) } : {}
  kpisData.current = {
    ...kpisCurrent,
    impressions: params.snapshot.impressions,
    clicks: params.snapshot.clicks,
    cost: params.snapshot.cost,
    conversions: params.snapshot.conversions,
  }
  kpisData.dateRange = {
    startDate: params.startDate,
    endDate: params.endDate,
    days,
    isRange: params.startDate < params.endDate,
  }
  kpisRoot.data = kpisData

  return {
    summary: summaryRoot,
    kpis: kpisRoot,
  }
}

function buildStrategyRunRangeSummary(params: {
  runs: any[]
  startDate: string
  endDate: string
}): DailyReportPayload['strategyRunRange'] {
  const runs = Array.isArray(params.runs) ? params.runs : []
  const latest = runs[0]
  const runsTotal = runs.length
  const runsSuccess = runs.filter((item) => String(item?.status || '').toLowerCase() === 'completed').length
  const runsFailed = runs.filter((item) => String(item?.status || '').toLowerCase() === 'failed').length
  const runsSkipped = runs.filter((item) => String(item?.status || '').toLowerCase() === 'skipped').length

  return {
    startDate: params.startDate,
    endDate: params.endDate,
    runsTotal,
    runsSuccess,
    runsFailed,
    runsSkipped,
    latestRunDate: String(latest?.run_date || '').trim() || null,
    latestMode: String(latest?.mode || '').trim() || null,
    latestStatus: String(latest?.status || '').trim() || null,
  }
}

function getTopReasons(messages: unknown[], limit = 3): string[] {
  const counts = new Map<string, number>()
  for (const item of messages) {
    const text = String(item || '').trim()
    if (!text) continue
    const normalized = text.slice(0, 120)
    counts.set(normalized, (counts.get(normalized) || 0) + 1)
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([reason, count]) => `${reason} (${count})`)
}

function buildRecommendationNote(params: {
  guardLevel: string
  publishFailureRate: number
  reason: string | null
}): string {
  if (params.reason === 'publish_failure_stop_loss') {
    return '上一轮触发发布止损，明日建议先排查账号状态、素材合规与落地页可用性，再恢复投放。'
  }

  if (params.guardLevel === 'strong') {
    return `发布失败率 ${(params.publishFailureRate * 100).toFixed(1)}%，建议明日执行强防守：缩量、降CPC、低预算小步验证。`
  }

  if (params.guardLevel === 'mild') {
    return `发布失败率 ${(params.publishFailureRate * 100).toFixed(1)}%，建议明日执行温和防守：控制节奏并优先验证高质量创意与关键词。`
  }

  if (params.guardLevel === 'insufficient_data') {
    return '当前样本不足，明日建议保持小规模探索，优先积累有效发布与转化样本。'
  }

  return '发布链路稳定，明日建议按建议参数稳步放量，同时持续监控ROAS与失败原因。'
}

function formatRecommendationSourceLabel(
  source: StrategyKnowledgeSummary['recommendationSource']
): string {
  switch (source) {
    case 'effective_config':
      return '最终生效配置'
    case 'failure_guard_after':
      return '风控后参数'
    case 'adaptive_after':
      return '自适应后参数'
    default:
      return '无建议来源'
  }
}

function buildStrategyKnowledgeSummary(report: DailyReportPayload): StrategyKnowledgeSummary {
  const strategyActions = Array.isArray(report.strategyActions) ? report.strategyActions : []
  const strategyStats = parseMaybeJson<Record<string, any>>(report.strategyRun?.stats_json, {})
  const runStatus = String(report.strategyRun?.status || '').toLowerCase()
  const strategyRunRange = asObject(report.strategyRunRange)
  const rangeRunsTotalRaw = toNumber(strategyRunRange?.runsTotal, NaN)
  const rangeRunsSuccessRaw = toNumber(strategyRunRange?.runsSuccess, NaN)
  const rangeRunsFailedRaw = toNumber(strategyRunRange?.runsFailed, NaN)
  const rangeRunsSkippedRaw = toNumber(strategyRunRange?.runsSkipped, NaN)
  const hasRangeRunSummary = Number.isFinite(rangeRunsTotalRaw)
  const resolvedRunsTotal = hasRangeRunSummary
    ? Math.max(0, Math.round(rangeRunsTotalRaw))
    : (report.strategyRun ? 1 : 0)
  const resolvedRunsSuccess = hasRangeRunSummary
    ? Math.max(0, Math.round(Number.isFinite(rangeRunsSuccessRaw) ? rangeRunsSuccessRaw : 0))
    : (runStatus === 'completed' ? 1 : 0)
  const resolvedRunsFailed = hasRangeRunSummary
    ? Math.max(0, Math.round(Number.isFinite(rangeRunsFailedRaw) ? rangeRunsFailedRaw : 0))
    : (runStatus === 'failed' ? 1 : 0)
  const resolvedRunsSkipped = hasRangeRunSummary
    ? Math.max(0, Math.round(Number.isFinite(rangeRunsSkippedRaw) ? rangeRunsSkippedRaw : 0))
    : (runStatus === 'skipped' ? 1 : 0)
  const resolvedMode = String(
    strategyRunRange?.latestMode
    || report.strategyRun?.mode
    || 'auto'
  )

  const actionSuccess = strategyActions.filter(action => action?.status === 'success').length
  const actionFailed = strategyActions.filter(action => action?.status === 'failed').length

  const publishActions = strategyActions.filter(action => action?.action_type === 'publish_campaign')
  const publishSuccess = publishActions.filter(action => action?.status === 'success').length
  const publishFailedActions = publishActions.filter(action => action?.status === 'failed')

  const topPublishFailureReasons = getTopReasons(
    publishFailedActions.map(action => action?.error_message || '发布失败（无错误信息）')
  )

  const circuitBreak = parseMaybeJson<Record<string, any>>(strategyStats.circuitBreak, {})
  const rankModel = parseMaybeJson<Record<string, any>>(strategyStats.rankModel, {})
  const failureGuard = parseMaybeJson<Record<string, any>>(strategyStats.failureGuardInsight, {})
  const adaptiveInsight = parseMaybeJson<Record<string, any>>(strategyStats.adaptiveInsight, {})
  const effectiveConfig = parseMaybeJson<Record<string, any>>(strategyStats.effectiveConfig, {})
  const failureGuardAfter = parseMaybeJson<Record<string, any>>(failureGuard.after, {})
  const adaptiveAfter = parseMaybeJson<Record<string, any>>(adaptiveInsight.after, {})

  const hasEffectiveConfig = Object.prototype.hasOwnProperty.call(effectiveConfig, 'maxOffersPerRun')
  const hasFailureGuardAfter = Object.prototype.hasOwnProperty.call(failureGuardAfter, 'maxOffersPerRun')
  const hasAdaptiveAfter = Object.prototype.hasOwnProperty.call(adaptiveAfter, 'maxOffersPerRun')

  const recommendationSource: StrategyKnowledgeSummary['recommendationSource'] = hasEffectiveConfig
    ? 'effective_config'
    : (hasFailureGuardAfter ? 'failure_guard_after' : (hasAdaptiveAfter ? 'adaptive_after' : 'none'))

  const recommendedMaxOffersPerRun = toNumber(
    effectiveConfig.maxOffersPerRun,
    toNumber(failureGuardAfter.maxOffersPerRun, toNumber(adaptiveAfter.maxOffersPerRun, 0))
  )
  const recommendedDefaultBudget = toNumber(
    effectiveConfig.defaultBudget,
    toNumber(failureGuardAfter.defaultBudget, toNumber(adaptiveAfter.defaultBudget, 0))
  )
  const recommendedMaxCpc = toNumber(
    effectiveConfig.maxCpc,
    toNumber(failureGuardAfter.maxCpc, toNumber(adaptiveAfter.maxCpc, 0))
  )

  const reason = strategyStats.reason ? String(strategyStats.reason) : null
  const circuitBreakTriggered =
    reason === 'daily_spend_cap' ||
    reason === 'daily_spend_cap_circuit_break' ||
    toNumber(circuitBreak.paused, 0) > 0 ||
    toNumber(circuitBreak.attempted, 0) > 0

  return {
    runsTotal: resolvedRunsTotal,
    runsSuccess: resolvedRunsSuccess,
    runsFailed: resolvedRunsFailed,
    runsSkipped: resolvedRunsSkipped,
    mode: resolvedMode,
    reason,
    adjustment: String(strategyStats?.adaptiveInsight?.adjustment || 'unknown'),
    guardLevel: String(failureGuard.guardLevel || 'none'),
    publishFailureRate: toNumber(failureGuard.publishFailureRate, 0),
    offersConsidered: toNumber(strategyStats.offersConsidered, 0),
    campaignsPublished: toNumber(strategyStats.campaignsPublished, 0),
    campaignsPaused: toNumber(strategyStats.campaignsPaused, 0),
    publishSuccess,
    publishFailed: Math.max(toNumber(strategyStats.publishFailed, 0), publishFailedActions.length),
    actionSuccess,
    actionFailed,
    circuitBreakTriggered,
    circuitBreakPaused: toNumber(circuitBreak.paused, 0),
    rankCandidateCount: toNumber(rankModel.candidateCount, 0),
    rankSelectedCount: toNumber(rankModel.selectedCount, 0),
    rankSelectedAverageScore: toNumber(rankModel.selectedAverageScore, 0),
    recommendedMaxOffersPerRun,
    recommendedDefaultBudget,
    recommendedMaxCpc,
    recommendationSource,
    recommendationNote: buildRecommendationNote({
      guardLevel: String(failureGuard.guardLevel || 'none'),
      publishFailureRate: toNumber(failureGuard.publishFailureRate, 0),
      reason,
    }),
    topPublishFailureReasons,
  }
}

async function fetchWithGuard<T>(source: string, fn: () => Promise<T>, errors: DailyReportPayload['errors']) {
  try {
    return await fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    errors?.push({ source, message })
    return null
  }
}

async function enrichBudgetWithMultiCurrencyOverview(params: {
  userId: number
  startDate: string
  endDate: string
  budget: any
  errors: DailyReportPayload['errors']
}): Promise<any> {
  const budgetRoot = asObject(params.budget)
  if (!budgetRoot) return params.budget

  const currencies = Array.isArray(budgetRoot.currencies)
    ? budgetRoot.currencies
      .map((currency) => normalizeCurrencyCode(currency, ''))
      .filter(Boolean)
    : []

  if (currencies.length <= 1) {
    return params.budget
  }

  const responses = await Promise.all(
    currencies.map((currency) =>
      fetchWithGuard(
        `analytics.budget.${currency}`,
        () => fetchAutoadsJson({
          userId: params.userId,
          path: '/api/analytics/budget',
          query: {
            start_date: params.startDate,
            end_date: params.endDate,
            currency,
          },
        }),
        params.errors
      )
    )
  )

  const multiCurrencyOverall: BudgetCurrencyOverview[] = responses
    .map((response) => {
      const responseRoot = asObject(response)
      return toBudgetCurrencyOverview({
        ...asObject(responseRoot?.data?.overall),
        currency: responseRoot?.currency,
      })
    })
    .filter(isBudgetCurrencyOverview)

  if (multiCurrencyOverall.length <= 1) {
    return params.budget
  }

  return {
    ...budgetRoot,
    multiCurrencyOverall,
  }
}

export async function buildOpenclawDailyReport(
  userId: number,
  dateStr?: string,
  options?: DailyReportBuildOptions
): Promise<DailyReportPayload> {
  const reportDate = normalizeOpenclawReportDate(dateStr || formatLocalDate(new Date()))
  const requestedStartDate = normalizeOpenclawReportDate(options?.startDate || reportDate)
  const { startDate: reportStartDate, endDate: reportEndDate } = resolveNormalizedDateRange(
    requestedStartDate,
    reportDate
  )
  const reportRangeDays = calculateInclusiveDateSpan(reportStartDate, reportEndDate)
  const isDateRangeMode = reportStartDate < reportEndDate
  const errors: DailyReportPayload['errors'] = []
  const db = await getDatabase()

  const [summary, kpis, trends, roi, campaigns, budget, performance, affiliateRevenue] = await Promise.all([
    fetchWithGuard('dashboard.summary', () => fetchAutoadsJson({
      userId,
      path: '/api/dashboard/summary',
      query: { days: 30 },
    }), errors),
    fetchWithGuard('dashboard.kpis', () => fetchAutoadsJson({
      userId,
      path: '/api/dashboard/kpis',
      query: { days: 7 },
    }), errors),
    fetchWithGuard('dashboard.trends', () => fetchAutoadsJson({
      userId,
      path: '/api/dashboard/trends',
      query: { days: 30 },
    }), errors),
    fetchWithGuard('analytics.roi', () => fetchAutoadsJson({
      userId,
      path: '/api/analytics/roi',
      query: { start_date: reportStartDate, end_date: reportEndDate },
    }), errors),
    fetchWithGuard('dashboard.campaigns', () => fetchAutoadsJson({
      userId,
      path: '/api/dashboard/campaigns',
      query: { days: 30, pageSize: 5, sortBy: 'cost', sortOrder: 'desc' },
    }), errors),
    fetchWithGuard('analytics.budget', () => fetchAutoadsJson({
      userId,
      path: '/api/analytics/budget',
      query: { start_date: reportStartDate, end_date: reportEndDate },
    }), errors),
    fetchWithGuard('campaigns.performance', () => fetchAutoadsJson({
      userId,
      path: '/api/campaigns/performance',
      query: { daysBack: Math.max(7, reportRangeDays) },
    }), errors),
    isDateRangeMode
      ? fetchWithGuard(
        'affiliate.commission.range',
        () => buildAffiliateRevenueSummaryByDateRange({
          db,
          userId,
          startDate: reportStartDate,
          endDate: reportEndDate,
        }),
        errors
      )
      : fetchWithGuard('affiliate.commission', () => fetchAffiliateCommissionRevenue({
        userId,
        reportDate,
      }), errors),
  ])

  let normalizedSummary: any = summary
  let normalizedKpis: any = kpis
  const normalizedBudget = await enrichBudgetWithMultiCurrencyOverview({
    userId,
    startDate: reportStartDate,
    endDate: reportEndDate,
    budget,
    errors,
  })

  if (isDateRangeMode) {
    const rangeKpiSnapshot = await fetchWithGuard(
      'openclaw.report.kpis.range',
      () => queryRangeKpiSnapshot({
        db,
        userId,
        startDate: reportStartDate,
        endDate: reportEndDate,
      }),
      errors
    )
    if (rangeKpiSnapshot) {
      const merged = mergeSummaryAndKpisWithRangeSnapshot({
        summary: summary || {},
        kpis: kpis || {},
        startDate: reportStartDate,
        endDate: reportEndDate,
        snapshot: rangeKpiSnapshot,
      })
      normalizedSummary = merged.summary
      normalizedKpis = merged.kpis
    }
  }

  let normalizedRoi = mergeRoiWithAffiliateRevenue({
    roi,
    summary: normalizedSummary,
    affiliateRevenue: affiliateRevenue || {
      reportDate,
      configuredPlatforms: [],
      queriedPlatforms: [],
      totalCommission: 0,
      breakdown: [],
      errors: [],
      attribution: {
        attributedCommission: 0,
        unattributedCommission: 0,
        attributedOffers: 0,
        attributedCampaigns: 0,
        writtenRows: 0,
      },
    },
    errors,
  })

  const roiRootForReconciliation = asObject(normalizedRoi)
  const roiDataForReconciliation = asObject(roiRootForReconciliation?.data)
  const roiOverallForReconciliation = asObject(roiDataForReconciliation?.overall)
  const totalRevenueRawForReconciliation = roiOverallForReconciliation?.totalRevenue
  const totalRevenueForReconciliation = totalRevenueRawForReconciliation === null
    || totalRevenueRawForReconciliation === undefined
    ? 0
    : roundTo2(toNumber(totalRevenueRawForReconciliation, 0))
  const attributedRevenueForReconciliation = roundTo2(
    toNumber(
      roiOverallForReconciliation?.affiliateAttribution?.attributedCommission,
      toNumber(roiOverallForReconciliation?.attributedRevenue, 0)
    )
  )
  const failureSummary = await fetchWithGuard(
    'affiliate.attribution_failures',
    () => queryAffiliateAttributionFailureSummary({
      db,
      userId,
      reportDate,
    }),
    errors
  )
  const reconciliationSnapshot = buildAffiliateReconciliationSnapshot({
    reportDate,
    totalRevenue: totalRevenueForReconciliation,
    attributedRevenue: attributedRevenueForReconciliation,
    failureRows: failureSummary?.totalRows || 0,
    failureCommission: failureSummary?.totalCommission || 0,
    topReasons: failureSummary?.topReasons || [],
  })
  normalizedRoi = attachAffiliateReconciliation({
    roi: normalizedRoi,
    reconciliation: reconciliationSnapshot,
  })

  if (reconciliationSnapshot.hasGap) {
    const reasonSummary = reconciliationSnapshot.topFailureReasons
      .slice(0, 3)
      .map((item) => `${item.label}(${item.count})`)
      .join('；')
    errors.push({
      source: 'affiliate.reconciliation',
      message: `date=${reportDate}; gap=${reconciliationSnapshot.gap}; ratio=${reconciliationSnapshot.gapRatio}%`
        + (reasonSummary ? `; reasons=${reasonSummary}` : ''),
    })

    try {
      const resourceId = Number(reportDate.replace(/-/g, ''))
      await createRiskAlert(
        userId,
        'openclaw_affiliate_reconciliation_gap',
        reconciliationSnapshot.severity === 'critical' ? 'critical' : 'warning',
        `联盟佣金对账缺口（${reportDate}）`,
        `总佣金 ${reconciliationSnapshot.totalRevenue}，已归因 ${reconciliationSnapshot.attributedRevenue}，缺口 ${reconciliationSnapshot.gap}（${reconciliationSnapshot.gapRatio}%）`,
        {
          resourceId: Number.isFinite(resourceId) ? resourceId : undefined,
          details: {
            reportDate,
            totalRevenue: reconciliationSnapshot.totalRevenue,
            attributedRevenue: reconciliationSnapshot.attributedRevenue,
            gap: reconciliationSnapshot.gap,
            gapRatio: reconciliationSnapshot.gapRatio,
            failureRows: reconciliationSnapshot.failureRows,
            failureCommission: reconciliationSnapshot.failureCommission,
            topFailureReasons: reconciliationSnapshot.topFailureReasons,
          },
        }
      )
    } catch (error: any) {
      errors.push({
        source: 'affiliate.reconciliation_alert',
        message: error?.message || String(error),
      })
    }
  }

  const dailySnapshotRow = await db.queryOne<{
    impressions: number | null
    clicks: number | null
    cost: number | null
    conversions: number | null
  }>(
    `SELECT
       COALESCE(SUM(impressions), 0) as impressions,
       COALESCE(SUM(clicks), 0) as clicks,
       COALESCE(SUM(cost), 0) as cost,
       COALESCE(SUM(conversions), 0) as conversions
     FROM campaign_performance
     WHERE user_id = ?
       AND date >= ?
       AND date <= ?`,
    [userId, reportStartDate, reportEndDate]
  )

  const dailySnapshot: DailyPerformanceSnapshot = {
    impressions: toNumber(dailySnapshotRow?.impressions, 0),
    clicks: toNumber(dailySnapshotRow?.clicks, 0),
    cost: roundTo2(toNumber(dailySnapshotRow?.cost, 0)),
    conversions: roundTo2(toNumber(dailySnapshotRow?.conversions, 0)),
  }

  const actions = await db.query<any>(
    `SELECT id, channel, sender_id, action, target_type, target_id, status, error_message, created_at
     FROM openclaw_action_logs
     WHERE user_id = ?
       AND DATE(created_at) >= ?
       AND DATE(created_at) <= ?
     ORDER BY created_at DESC
     LIMIT 200`,
    [userId, reportStartDate, reportEndDate]
  )

  const strategyActions = await db.query<any>(
    `SELECT id, action_type, target_type, target_id, status, error_message, created_at
     FROM strategy_center_actions
     WHERE user_id = ?
       AND DATE(created_at) >= ?
       AND DATE(created_at) <= ?
     ORDER BY created_at DESC
     LIMIT 200`,
    [userId, reportStartDate, reportEndDate]
  )

  const strategyRunsInRange = await db.query<any>(
    `SELECT id, mode, status, run_date, stats_json, error_message, started_at, completed_at, created_at
     FROM strategy_center_runs
     WHERE user_id = ?
       AND run_date >= ?
       AND run_date <= ?
     ORDER BY run_date DESC, created_at DESC
     LIMIT 200`,
    [userId, reportStartDate, reportEndDate]
  )
  const strategyRun = Array.isArray(strategyRunsInRange) && strategyRunsInRange.length > 0
    ? strategyRunsInRange[0]
    : null
  const strategyRunRangeSummary = isDateRangeMode
    ? buildStrategyRunRangeSummary({
      runs: strategyRunsInRange,
      startDate: reportStartDate,
      endDate: reportEndDate,
    })
    : undefined

  const strategyRecommendations = await fetchWithGuard(
    'openclaw.strategy.recommendations',
    () => getStrategyRecommendations({
      userId,
      reportDate,
      forceRefresh: false,
      limit: 100,
    }),
    errors
  )

  const enrichedSections = await fetchWithGuard(
    'openclaw.report.commission',
    () => enrichReportCommissionSections({
      db,
      userId,
      reportDate,
      startDate: isDateRangeMode ? reportStartDate : undefined,
      trends,
      roi: normalizedRoi,
    }),
    errors
  )

  return {
    date: reportDate,
    dateRange: {
      startDate: reportStartDate,
      endDate: reportEndDate,
      days: reportRangeDays,
      isRange: isDateRangeMode,
    },
    generatedAt: new Date().toISOString(),
    summary: normalizedSummary,
    kpis: normalizedKpis,
    dailySnapshot,
    trends: enrichedSections?.trends || trends,
    roi: enrichedSections?.roi || normalizedRoi,
    campaigns,
    budget: normalizedBudget,
    performance,
    actions,
    strategyActions,
    strategyRun,
    strategyRunRange: strategyRunRangeSummary,
    strategyRecommendations: strategyRecommendations || [],
    errors: errors && errors.length > 0 ? errors : undefined,
  }
}

function formatRecommendationTypeLabel(type: string): string {
  switch (type) {
    case 'adjust_cpc':
      return 'CPC调整'
    case 'adjust_budget':
      return '预算调整'
    case 'offline_campaign':
      return '下线Campaign'
    case 'expand_keywords':
      return '补充Search Terms关键词'
    case 'add_negative_keywords':
      return '新增否词'
    case 'optimize_match_type':
      return '匹配类型优化'
    default:
      return type || '策略建议'
  }
}

function formatImpactConfidenceLabel(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'high') return '高'
  if (normalized === 'medium') return '中'
  return '低'
}

export async function getOrCreateDailyReport(
  userId: number,
  dateStr?: string,
  options?: DailyReportLoadOptions
): Promise<DailyReportPayload> {
  const reportDate = normalizeOpenclawReportDate(dateStr || formatLocalDate(new Date()))
  const forceRefresh = options?.forceRefresh === true
  const inflightKey = `${userId}:${reportDate}:${forceRefresh ? 'refresh' : 'cache'}`

  const inflight = reportInflight.get(inflightKey)
  if (inflight) {
    return inflight
  }

  const task = (async () => {
    const db = await getDatabase()

    if (!forceRefresh) {
      const existing = await db.queryOne<{ payload_json: string | null }>(
        'SELECT payload_json FROM openclaw_daily_reports WHERE user_id = ? AND report_date = ?',
        [userId, reportDate]
      )

      if (existing?.payload_json) {
        try {
          const parsed = JSON.parse(existing.payload_json) as DailyReportPayload
          const effectiveReportDate = normalizeOpenclawReportDate(parsed.date || reportDate)
          const cachedDateRange = asObject(parsed.dateRange)
          const cachedRangeStart = isIsoDateString(String(cachedDateRange?.startDate || '').trim())
            ? String(cachedDateRange?.startDate)
            : effectiveReportDate
          const cachedRangeEnd = isIsoDateString(String(cachedDateRange?.endDate || '').trim())
            ? String(cachedDateRange?.endDate)
            : effectiveReportDate
          const enriched = await enrichReportCommissionSections({
            db,
            userId,
            reportDate: effectiveReportDate,
            startDate: cachedRangeStart < cachedRangeEnd ? cachedRangeStart : undefined,
            trends: parsed.trends,
            roi: parsed.roi,
          })
          const normalizedBudget = await enrichBudgetWithMultiCurrencyOverview({
            userId,
            startDate: cachedRangeStart,
            endDate: cachedRangeEnd,
            budget: parsed.budget,
            errors: parsed.errors,
          })

          const normalizedCachedReport: DailyReportPayload = {
            ...parsed,
            date: effectiveReportDate,
            trends: enriched.trends,
            roi: enriched.roi,
            budget: normalizedBudget,
          }
          const normalizedPayloadJson = JSON.stringify(normalizedCachedReport)
          if (normalizedPayloadJson !== existing.payload_json) {
            await db.exec(
              `UPDATE openclaw_daily_reports
               SET payload_json = ?
               WHERE user_id = ? AND report_date = ?`,
              [normalizedPayloadJson, userId, reportDate]
            )
          }

          return normalizedCachedReport
        } catch {
          // fall through to rebuild
        }
      }
    }

    const report = await buildOpenclawDailyReport(userId, reportDate)
    const payloadJson = JSON.stringify(report)

    await db.exec(
      `INSERT INTO openclaw_daily_reports (user_id, report_date, payload_json, sent_status)
       VALUES (?, ?, ?, 'pending')
       ON CONFLICT(user_id, report_date)
       DO UPDATE SET payload_json = excluded.payload_json`,
      [userId, reportDate, payloadJson]
    )

    const existingKnowledge = await db.queryOne<{ notes: string | null }>(
      'SELECT notes FROM openclaw_knowledge_base WHERE user_id = ? AND report_date = ? LIMIT 1',
      [userId, reportDate]
    )

    const strategySummary = buildStrategyKnowledgeSummary(report)

    await db.exec(
      `INSERT INTO openclaw_knowledge_base (user_id, report_date, summary_json, notes)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, report_date)
       DO UPDATE SET summary_json = excluded.summary_json, notes = excluded.notes`,
      [
        userId,
        reportDate,
        toDbJsonObjectField(
          {
            summary: report.summary?.kpis,
            roi: report.roi?.data?.overall,
            budget: report.budget?.data?.overall,
            actions: (report.actions || []).length,
            strategy: strategySummary,
          },
          db.type,
          {
            summary: report.summary?.kpis,
            roi: report.roi?.data?.overall,
            budget: report.budget?.data?.overall,
            actions: (report.actions || []).length,
            strategy: strategySummary,
          }
        ),
        existingKnowledge?.notes || '待人工复盘：请补充今日有效策略、失败原因、修正规则。',
      ]
    )

    return report
  })()

  reportInflight.set(inflightKey, task)
  try {
    return await task
  } finally {
    reportInflight.delete(inflightKey)
  }
}

export async function refreshOpenclawDailyReportSnapshot(params: {
  userId: number
  date?: string
}): Promise<DailyReportPayload> {
  return getOrCreateDailyReport(params.userId, params.date, { forceRefresh: true })
}

function formatReportMessage(report: DailyReportPayload): string {
  const summary = report.summary?.kpis
  const kpis = report.kpis?.data
  const dailySnapshot = asObject(report.dailySnapshot)
  const roiRoot = asObject(report.roi)
  const budgetRoot = asObject(report.budget)
  const roi = report.roi?.data?.overall
  const totalCost = roi ? Number(roi.totalCost) || 0 : 0
  const totalRevenueRaw = roi?.totalRevenue
  const totalRevenue = totalRevenueRaw === null || totalRevenueRaw === undefined
    ? null
    : Number(totalRevenueRaw)
  const revenueAvailable = roi?.revenueAvailable !== false
    && totalRevenue !== null
    && Number.isFinite(totalRevenue)
  const roas = revenueAvailable
    ? (roi?.roas !== undefined
      ? Number(roi.roas) || 0
      : (totalCost > 0 ? (totalRevenue || 0) / totalCost : 0))
    : null
  const affiliateBreakdown = Array.isArray(roi?.affiliateBreakdown)
    ? roi.affiliateBreakdown as Array<{ platform?: string; totalCommission?: number; records?: number; currency?: string }>
    : []
  const affiliateRecordCount = Math.max(
    affiliateBreakdown.reduce((sum, item) => sum + (Number(item.records) || 0), 0),
    toNumber(roi?.affiliateAttribution?.writtenRows, 0)
  )
  const affiliateReconciliation = asObject(roi?.affiliateReconciliation)
  const reconciliationHasGap = affiliateReconciliation?.hasGap === true
  const reconciliationSeverity = String(affiliateReconciliation?.severity || '').trim().toLowerCase()
  const reconciliationTopReasons = Array.isArray(affiliateReconciliation?.topFailureReasons)
    ? affiliateReconciliation.topFailureReasons as Array<{
      code?: string
      label?: string
      count?: number
      commission?: number
    }>
    : []
  const roiCurrency = normalizeCurrencyCode(roiRoot?.currency, 'USD')
  const budgetCurrency = normalizeCurrencyCode(budgetRoot?.currency, roiCurrency)
  const multiCurrencyBudgetOverview = Array.isArray(budgetRoot?.multiCurrencyOverall)
    ? budgetRoot.multiCurrencyOverall
      .map((item) => toBudgetCurrencyOverview(item))
      .filter(isBudgetCurrencyOverview)
    : []
  const affiliateCurrencies = affiliateBreakdown
    .map((item) => normalizeCurrencyCode(item.currency, ''))
    .filter(Boolean)
  const affiliateCurrency = affiliateCurrencies.length > 0
    ? (new Set(affiliateCurrencies).size === 1 ? affiliateCurrencies[0] : 'MIXED')
    : roiCurrency
  const multiCurrencyRoiOverview = buildRoiCurrencyOverview({
    budgetOverview: multiCurrencyBudgetOverview,
    affiliateBreakdown,
  })
  const hasMultiCurrencyRoiOverview = multiCurrencyRoiOverview.length > 1
  const profitCurrency = revenueAvailable && affiliateCurrency === roiCurrency
    ? roiCurrency
    : 'MIXED'
  const dailyImpressions = Math.round(
    toNumber(dailySnapshot?.impressions, toNumber(kpis?.current?.impressions, 0))
  )
  const dailyClicks = Math.round(
    toNumber(dailySnapshot?.clicks, toNumber(kpis?.current?.clicks, toNumber(summary?.totalClicks, 0)))
  )
  const dailyConversions = roundTo2(
    toNumber(dailySnapshot?.conversions, toNumber(roi?.conversions, 0))
  )
  const dailyCost = roi
    ? roundTo2(totalCost)
    : roundTo2(
      toNumber(dailySnapshot?.cost, toNumber(kpis?.current?.cost, toNumber(summary?.totalCost, 0)))
    )
  const dailyCostCurrency = roi ? roiCurrency : budgetCurrency
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').trim()
  const dateRange = asObject(report.dateRange)
  const isRangeMode = dateRange?.isRange === true
  const reportStartDate = String(dateRange?.startDate || '').trim()
  const reportEndDate = String(dateRange?.endDate || '').trim()

  const lines: string[] = []
  const strategyRecommendations = Array.isArray(report.strategyRecommendations)
    ? report.strategyRecommendations
    : []
  const normalizeRecommendationStatus = (value: unknown): 'pending' | 'executed' | 'failed' | 'dismissed' | 'stale' => {
    const normalized = String(value || '').trim().toLowerCase()
    if (normalized === 'executed') return 'executed'
    if (normalized === 'failed') return 'failed'
    if (normalized === 'dismissed') return 'dismissed'
    if (normalized === 'stale') return 'stale'
    return 'pending'
  }
  const recommendationStatusSummary = strategyRecommendations.reduce(
    (acc, item) => {
      acc.total += 1
      const status = normalizeRecommendationStatus(item?.status)
      if (status === 'executed') acc.executed += 1
      else if (status === 'failed') acc.failed += 1
      else if (status === 'stale') acc.stale += 1
      else if (status === 'dismissed') acc.dismissed += 1
      else acc.pending += 1
      return acc
    },
    {
      total: 0,
      pending: 0,
      executed: 0,
      failed: 0,
      stale: 0,
      dismissed: 0,
    }
  )

  if (isRangeMode && reportStartDate && reportEndDate) {
    lines.push(`📊 OpenClaw 周报（${reportStartDate} ~ ${reportEndDate}）`)
  } else {
    lines.push(`📊 OpenClaw 每日报表（${report.date}）`)
  }
  if (summary) {
    lines.push(`- 规模概览：Offer ${summary.totalOffers ?? 0} 个｜Campaign ${summary.totalCampaigns ?? 0} 个`)
  }
  if (multiCurrencyBudgetOverview.length > 1) {
    const spentBreakdown = multiCurrencyBudgetOverview
      .map((item) => formatMoney(item.totalSpentAllCampaigns ?? item.totalSpent, item.currency))
      .join('｜')
    lines.push(`- 投放消耗：点击 ${dailyClicks} 次｜花费 ${spentBreakdown}`)
  } else {
    lines.push(`- 投放消耗：点击 ${dailyClicks} 次｜花费 ${formatMoney(dailyCost, dailyCostCurrency)}`)
  }
  lines.push(`- ${isRangeMode ? '周期表现' : '当日表现'}：曝光 ${dailyImpressions}｜转化（Google Ads）${dailyConversions}｜联盟佣金记录 ${affiliateRecordCount}`)

  if (roi) {
    if (revenueAvailable) {
      if (hasMultiCurrencyRoiOverview) {
        const overview = multiCurrencyRoiOverview
          .map((item) =>
            `${item.currency}：佣金 ${formatMoney(item.revenue, item.currency)}｜花费 ${formatMoney(item.cost, item.currency)}｜利润 ${formatMoney(item.profit, item.currency)}`
          )
          .join('；')
        const returns = multiCurrencyRoiOverview
          .map((item) =>
            `${item.currency}：ROAS ${formatRatioValue(item.roas, 'x')}｜ROI ${formatRatioValue(item.roi, '%')}`
          )
          .join('；')
        lines.push(`- ROI概览（多币种）：${overview}`)
        lines.push(`- 回报率（多币种）：${returns}`)
      } else {
        lines.push(
          `- 佣金收入：${formatMoney(totalRevenue || 0, affiliateCurrency)}｜花费：${formatMoney(totalCost, roiCurrency)}｜利润：${formatMoney(roi.totalProfit, profitCurrency)}`
        )
        lines.push(`- ROAS：${(roas || 0).toFixed(2)}x｜ROI：${roi.roi ?? 0}%`)
      }
      lines.push('- 收入口径：联盟佣金（PartnerBoost / YeahPromos，Campaign/Offer级）')

      if (affiliateBreakdown.length > 0) {
        const detail = affiliateBreakdown
          .map((item) => {
            const itemCurrency = normalizeCurrencyCode(item.currency, affiliateCurrency)
            return `${item.platform || '未知平台'}：${formatMoney(item.totalCommission, itemCurrency)}（记录 ${Number(item.records) || 0}）`
          })
          .join(' | ')
        lines.push(`- 联盟拆分：${detail}`)
      }

      if (reconciliationHasGap) {
        if (hasMultiCurrencyRoiOverview || affiliateCurrency === 'MIXED') {
          const severityLabel = reconciliationSeverity === 'critical' ? '严重' : '预警'
          lines.push(`- 佣金对账（${severityLabel}）：检测到归因缺口，多币种场景暂按币种拆分查看联盟拆分明细`)
        } else {
          const reconciliationTotalRevenue = roundTo2(toNumber(affiliateReconciliation?.totalRevenue, totalRevenue || 0))
          const reconciliationAttributedRevenue = roundTo2(
            toNumber(
              affiliateReconciliation?.attributedRevenue,
              toNumber(roi?.affiliateAttribution?.attributedCommission, 0)
            )
          )
          const reconciliationGap = roundTo2(toNumber(affiliateReconciliation?.gap, 0))
          const reconciliationGapRatio = roundTo2(toNumber(affiliateReconciliation?.gapRatio, 0))
          const severityLabel = reconciliationSeverity === 'critical' ? '严重' : '预警'
          lines.push(
            `- 佣金对账（${severityLabel}）：总佣金 ${formatMoney(reconciliationTotalRevenue, affiliateCurrency)}｜已归因 ${formatMoney(reconciliationAttributedRevenue, affiliateCurrency)}｜缺口 ${formatMoney(reconciliationGap, affiliateCurrency)}（${reconciliationGapRatio}%）`
          )
        }

        if (reconciliationTopReasons.length > 0) {
          const reasonLine = reconciliationTopReasons
            .slice(0, 3)
            .map((item) => {
              const label = String(item.label || formatAffiliateFailureReasonLabel(String(item.code || 'unknown')))
              const count = Math.round(toNumber(item.count, 0))
              const commission = roundTo2(toNumber(item.commission, 0))
              return `${label} ${count}条/${formatMoney(commission, affiliateCurrency)}`
            })
            .join('；')
          lines.push(`- 缺口原因TOP：${reasonLine}`)
        }
      }
    } else {
      if (hasMultiCurrencyRoiOverview) {
        const costBreakdown = multiCurrencyRoiOverview
          .map((item) => formatMoney(item.cost, item.currency))
          .join('｜')
        lines.push(`- 花费：${costBreakdown}`)
      } else {
        lines.push(`- 花费：${formatMoney(totalCost, roiCurrency)}`)
      }
      lines.push('- 佣金收入：暂不可用（等待联盟平台返回）')
      lines.push('- ROAS：暂不可用｜ROI：暂不可用')
      lines.push('- 收入口径：联盟佣金（Campaign/Offer级，严格模式不回退 AutoAds）')
    }
  }

  if (multiCurrencyBudgetOverview.length > 1) {
    const detail = multiCurrencyBudgetOverview
      .map((item) =>
        `${item.currency}：预算 ${formatMoney(item.totalBudget, item.currency)}｜已花费 ${formatMoney(item.totalSpentEnabledCampaigns ?? item.totalSpent, item.currency)}｜剩余 ${formatMoney(item.remaining, item.currency)}`
      )
      .join('；')
    lines.push(`- 预算概览（启用中Campaign，多币种）：${detail}`)
  } else if (report.budget?.data?.overall) {
    const overall = report.budget.data.overall
    const budgetTotal = roundTo2(toNumber(overall.totalBudget, 0))
    const budgetSpent = roundTo2(
      toNumber(overall.totalSpentEnabledCampaigns, toNumber(overall.totalSpent, 0))
    )
    const budgetRemaining = roundTo2(
      toNumber(overall.remaining, budgetTotal - budgetSpent)
    )
    lines.push(
      `- 预算概览（启用中Campaign）：预算 ${formatMoney(budgetTotal, budgetCurrency)}｜已花费 ${formatMoney(budgetSpent, budgetCurrency)}｜剩余 ${formatMoney(budgetRemaining, budgetCurrency)}`
    )
  }

  if (recommendationStatusSummary.total > 0) {
    const readyToExecuteCount = recommendationStatusSummary.pending
    lines.push(
      `- 建议状态：总 ${recommendationStatusSummary.total}｜待执行 ${readyToExecuteCount}｜已执行 ${recommendationStatusSummary.executed}｜执行失败 ${recommendationStatusSummary.failed}｜待重算 ${recommendationStatusSummary.stale}｜暂不执行 ${recommendationStatusSummary.dismissed}`
    )
  }

  const readyToExecuteRecommendations = strategyRecommendations.filter((item) => {
    return normalizeRecommendationStatus(item?.status) === 'pending'
  })

  if (readyToExecuteRecommendations.length > 0) {
    const topRecommendations = [...readyToExecuteRecommendations]
      .sort((a, b) => (Number(b.priorityScore) || 0) - (Number(a.priorityScore) || 0))
      .slice(0, 5)
    lines.push(`- 优化建议TOP${topRecommendations.length}（按优先级分排序）：`)
    topRecommendations.forEach((item, index) => {
      const valueScore = Number(item.priorityScore) || 0
      const campaignName = item.data?.campaignName || item.data?.campaignId || item.campaignId
      const summary = item.summary || item.reason || item.title
      const netImpact = roundTo2(toNumber(item.data?.estimatedNetImpact, 0))
      const impactWindowDays = Math.max(1, Math.floor(toNumber(item.data?.impactWindowDays, 7)))
      const impactConfidenceLabel = formatImpactConfidenceLabel(item.data?.impactConfidence)
      const impactConfidenceReason = String(item.data?.impactConfidenceReason || '').trim()
      const postReviewStatus = String(item.data?.postReviewStatus || '').trim()
      const postReviewText = postReviewStatus
        ? `｜复盘 ${postReviewStatus}`
        : ''
      const confidenceReasonText = impactConfidenceReason ? `｜${impactConfidenceReason}` : ''
      lines.push(
        `  ${index + 1}. [${formatRecommendationTypeLabel(item.recommendationType)}] ${campaignName}｜优先级分 ${valueScore.toFixed(1)}｜净影响(估) ${netImpact.toFixed(2)}（${impactWindowDays}天）｜置信度 ${impactConfidenceLabel}${confidenceReasonText}${postReviewText}｜${summary}`
      )
    })
  }

  const staleRecommendations = strategyRecommendations.filter((item) => {
    const normalizedStatus = String(item?.status || '').trim().toLowerCase()
    return normalizedStatus === 'stale'
  })
  if (staleRecommendations.length > 0) {
    const topStale = [...staleRecommendations]
      .sort((a, b) => (Number(b.priorityScore) || 0) - (Number(a.priorityScore) || 0))
      .slice(0, 3)
      .map((item) => item.data?.campaignName || `Campaign #${item.campaignId}`)
      .join('、')
    lines.push(`- 待重算建议：${staleRecommendations.length} 条（不纳入可执行TOP）`)
    if (topStale) {
      lines.push(`- 待重算示例：${topStale}`)
    }
  }

  if (appUrl) {
    lines.push(`🔗 详情链接：${appUrl}/strategy-center`)
  }

  return lines.join('\n')
}

export async function sendDailyReportToFeishu(params: SendDailyReportToFeishuParams): Promise<void> {
  const defaultDailyReportDate = shiftYmdDate(formatLocalDate(new Date()), -1)
  const reportDate = normalizeOpenclawReportDate(params.date || defaultDailyReportDate)
  const normalizedStartDate = params.startDate
    ? normalizeOpenclawReportDate(params.startDate)
    : undefined
  const isRangeMode = Boolean(normalizedStartDate && normalizedStartDate < reportDate)
  const deliveryScope = isRangeMode ? `${normalizedStartDate}:${reportDate}` : reportDate
  const inflightKey = params.deliveryTaskId
    ? `daily-report-delivery:${params.userId}:${deliveryScope}:${params.target || 'no-target'}:${params.deliveryTaskId}`
    : undefined

  if (inflightKey) {
    const existing = reportDeliveryInflight.get(inflightKey)
    if (existing) {
      return existing
    }

    const task = sendDailyReportToFeishuInternal({
      ...params,
      date: reportDate,
      startDate: isRangeMode ? normalizedStartDate : undefined,
    })
    reportDeliveryInflight.set(inflightKey, task)
    try {
      await task
      return
    } finally {
      reportDeliveryInflight.delete(inflightKey)
    }
  }

  return sendDailyReportToFeishuInternal({
    ...params,
    date: reportDate,
    startDate: isRangeMode ? normalizedStartDate : undefined,
  })
}

async function sendDailyReportToFeishuInternal(params: SendDailyReportToFeishuParams): Promise<void> {
  const reportDate = normalizeOpenclawReportDate(
    params.date || shiftYmdDate(formatLocalDate(new Date()), -1)
  )
  const normalizedStartDate = params.startDate
    ? normalizeOpenclawReportDate(params.startDate)
    : undefined
  const isRangeMode = Boolean(normalizedStartDate && normalizedStartDate < reportDate)
  const report = isRangeMode
    ? await buildOpenclawDailyReport(params.userId, reportDate, { startDate: normalizedStartDate })
    : await getOrCreateDailyReport(params.userId, reportDate)
  const db = await getDatabase()
  const nowSql = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  if (!isRangeMode && params.deliveryTaskId) {
    const latestDelivery = await db.queryOne<{
      sent_status?: string
      last_delivery_task_id?: string | null
    }>(
      `SELECT sent_status, last_delivery_task_id
       FROM openclaw_daily_reports
       WHERE user_id = ? AND report_date = ?`,
      [params.userId, report.date]
    )

    const lastTaskId = String(latestDelivery?.last_delivery_task_id || '').trim()
    if (latestDelivery?.sent_status === 'sent' && lastTaskId === params.deliveryTaskId) {
      return
    }
  }

  if (!isRangeMode) {
    await db.exec(
      `UPDATE openclaw_daily_reports
       SET delivery_attempts = COALESCE(delivery_attempts, 0) + 1,
           last_delivery_task_id = ?,
           delivery_error = NULL
       WHERE user_id = ? AND report_date = ?`,
      [params.deliveryTaskId || null, params.userId, report.date]
    )
  }

  const message = formatReportMessage(report)
  let sentAny = false
  const errors: string[] = []
  const accountId = await resolveUserFeishuAccountId(params.userId)
  const deliveryScope = isRangeMode && normalizedStartDate
    ? `${normalizedStartDate}:${report.date}`
    : report.date
  const deliveryIdempotencyKey = params.deliveryTaskId
    ? `daily-report:${params.userId}:${deliveryScope}:${params.target || 'no-target'}:${params.deliveryTaskId}`
    : undefined

  if (params.target) {
    try {
      await invokeOpenclawTool({
        tool: 'message',
        action: 'send',
        args: {
          channel: 'feishu',
          target: params.target,
          message,
          ...(accountId ? { accountId } : {}),
        },
      }, deliveryIdempotencyKey ? { idempotencyKey: deliveryIdempotencyKey } : {})
      sentAny = true
    } catch (error: any) {
      const messageText = error?.message || String(error)
      errors.push(`target: ${messageText}`)
      console.error('❌ 推送飞书消息失败:', error)
    }
  }

  if (!isRangeMode) {
    try {
      await writeDailyReportToBitable(params.userId, report)
      sentAny = true
    } catch (error: any) {
      const messageText = error?.message || String(error)
      errors.push(`bitable: ${messageText}`)
      console.error('❌ 写入飞书多维表格失败:', error)
    }

    try {
      await writeDailyReportToDoc(params.userId, report)
      sentAny = true
    } catch (error: any) {
      const messageText = error?.message || String(error)
      errors.push(`doc: ${messageText}`)
      console.error('❌ 写入飞书文档失败:', error)
    }
  }

  const deliveryError = sentAny ? null : (errors.join(' | ') || '所有投递渠道均失败')

  if (!isRangeMode) {
    await db.exec(
      `UPDATE openclaw_daily_reports
       SET sent_status = ?,
           sent_at = CASE WHEN ? THEN ${nowSql} ELSE sent_at END,
           delivery_error = ?,
           last_delivery_task_id = COALESCE(?, last_delivery_task_id)
       WHERE user_id = ? AND report_date = ?`,
      [
        sentAny ? 'sent' : 'failed',
        sentAny,
        deliveryError,
        params.deliveryTaskId || null,
        params.userId,
        report.date,
      ]
    )
  }

  if (!sentAny) {
    throw new Error(deliveryError || (isRangeMode ? '周报投递失败' : '每日报表投递失败'))
  }
}
