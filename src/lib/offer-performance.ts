import { getDatabase } from './db'
import { convertCurrency } from './currency'

/**
 * Offer Performance Analytics
 *
 * Offer/Campaign 的广告基础指标仍来自 campaign_performance，
 * 佣金指标来自 affiliate_commission_attributions。
 */

export interface OfferPerformanceSummary {
  offer_id: number
  campaign_count: number
  impressions: number
  clicks: number
  conversions: number
  commission: number
  commission_currency: string
  cost: number
  cost_currency: string
  ctr: number
  avg_cpc: number
  conversion_rate: number
  commission_per_click: number
  date_range: {
    start: string
    end: string
  }
}

export interface OfferPerformanceTrend {
  date: string
  impressions: number
  clicks: number
  conversions: number
  commission: number
  commission_currency: string
  cost: number
  cost_currency: string
  ctr: number
  conversion_rate: number
  commission_per_click: number
}

export interface CampaignPerformanceComparison {
  campaign_id: number
  campaign_name: string
  google_campaign_id: string
  impressions: number
  clicks: number
  conversions: number
  commission: number
  commission_currency: string
  cost: number
  cost_currency: string
  ctr: number
  cpc: number
  conversion_rate: number
  commission_per_click: number
}

export interface OfferROI {
  total_cost_usd: number
  total_revenue_usd: number
  roi_percentage: number
  profit_usd: number
  conversions: number
  commission: number
}

export interface OfferCurrencyInfo {
  currency: string
  currencies: string[]
  hasMixedCurrency: boolean
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

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

function getDateRange(daysBack: number): { startDateStr: string; endDateStr: string } {
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - daysBack)

  return {
    startDateStr: startDate.toISOString().split('T')[0],
    endDateStr: endDate.toISOString().split('T')[0],
  }
}

/**
 * 获取 Offer 在时间范围内涉及的货币信息
 * 注意：campaign_performance.cost 存储的是 Ads 账号原币的标准单位（非 micros）。
 */
export async function getOfferCurrencyInfo(
  offerId: number,
  userId: number,
  daysBack: number = 30
): Promise<OfferCurrencyInfo> {
  const db = await getDatabase()
  const { startDateStr, endDateStr } = getDateRange(daysBack)

  const rows = await db.query(`
    SELECT DISTINCT
      COALESCE(cp.currency, gaa.currency, 'USD') as currency
    FROM campaigns c
    LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
    LEFT JOIN campaign_performance cp
      ON c.id = cp.campaign_id
      AND cp.date >= ?
      AND cp.date <= ?
    WHERE c.offer_id = ?
      AND c.user_id = ?
  `, [startDateStr, endDateStr, offerId, userId]) as any[]

  const currencies = rows
    .map((r) => String(r.currency || '').trim())
    .filter((c) => Boolean(c))

  const unique = Array.from(new Set(currencies))
  if (unique.length === 0) {
    return { currency: 'USD', currencies: ['USD'], hasMixedCurrency: false }
  }

  const latestCurrencyRow = await db.queryOne(`
    SELECT COALESCE(gaa.currency, 'USD') as currency
    FROM campaigns c
    LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
    WHERE c.offer_id = ?
      AND c.user_id = ?
    ORDER BY COALESCE(c.published_at, c.created_at) DESC
    LIMIT 1
  `, [offerId, userId]) as any

  const latestCurrency = String(latestCurrencyRow?.currency || '').trim()
  const preferredCurrency = latestCurrency && unique.includes(latestCurrency)
    ? latestCurrency
    : unique[0]

  return {
    currency: preferredCurrency,
    currencies: unique,
    hasMixedCurrency: unique.length > 1,
  }
}

export async function getOfferPerformanceSummary(
  offerId: number,
  userId: number,
  daysBack: number = 30
): Promise<OfferPerformanceSummary> {
  const db = await getDatabase()
  const { startDateStr, endDateStr } = getDateRange(daysBack)

  // 查询广告数据（不转换货币，保持原始数据）
  const summary = await db.queryOne(`
    SELECT
      COUNT(DISTINCT cp.campaign_id) as campaign_count,
      SUM(cp.impressions) as impressions,
      SUM(cp.clicks) as clicks,
      SUM(cp.cost) as cost,
      COALESCE(MAX(cp.currency), MAX(gaa.currency), 'CNY') as cost_currency,
      CASE
        WHEN SUM(cp.impressions) > 0 THEN SUM(cp.clicks) * 100.0 / SUM(cp.impressions)
        ELSE 0
      END as ctr,
      CASE
        WHEN SUM(cp.clicks) > 0 THEN SUM(cp.cost) / SUM(cp.clicks)
        ELSE 0
      END as avg_cpc
    FROM campaigns c
    LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
    LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
    WHERE c.offer_id = ?
      AND c.user_id = ?
      AND cp.date >= ?
      AND cp.date <= ?
  `, [offerId, userId, startDateStr, endDateStr]) as any

  // 查询佣金数据（不转换货币，保持原始数据）
  const commissionData = await db.queryOne(`
    SELECT
      COALESCE(SUM(aca.commission_amount), 0) AS commission,
      COALESCE(MAX(aca.currency), 'USD') as commission_currency
    FROM affiliate_commission_attributions aca
    WHERE aca.user_id = ?
      AND aca.offer_id = ?
      AND aca.report_date >= ?
      AND aca.report_date <= ?
  `, [userId, offerId, startDateStr, endDateStr]) as any

  const clicks = Number(summary?.clicks) || 0
  const commission = Number(commissionData?.commission) || 0
  const commissionPerClick = clicks > 0 ? commission / clicks : 0

  return {
    offer_id: offerId,
    campaign_count: Number(summary?.campaign_count) || 0,
    impressions: Number(summary?.impressions) || 0,
    clicks,
    conversions: roundTo2(commission),
    commission: roundTo2(commission),
    commission_currency: String(commissionData?.commission_currency || 'USD'),
    cost: Number(summary?.cost) || 0,
    cost_currency: String(summary?.cost_currency || 'CNY'),
    ctr: Number(summary?.ctr) || 0,
    avg_cpc: Number(summary?.avg_cpc) || 0,
    conversion_rate: roundTo2(commissionPerClick),
    commission_per_click: roundTo2(commissionPerClick),
    date_range: {
      start: startDateStr,
      end: endDateStr,
    },
  }
}

export async function getOfferPerformanceTrend(
  offerId: number,
  userId: number,
  daysBack: number = 30
): Promise<OfferPerformanceTrend[]> {
  const db = await getDatabase()
  const { startDateStr, endDateStr } = getDateRange(daysBack)

  // 查询广告趋势数据（不转换货币）
  const adTrends = await db.query(`
    SELECT
      cp.date as date,
      SUM(cp.impressions) as impressions,
      SUM(cp.clicks) as clicks,
      SUM(cp.cost) as cost,
      COALESCE(MAX(cp.currency), MAX(gaa.currency), 'CNY') as cost_currency,
      CASE
        WHEN SUM(cp.impressions) > 0 THEN SUM(cp.clicks) * 100.0 / SUM(cp.impressions)
        ELSE 0
      END as ctr
    FROM campaigns c
    LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
    LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
    WHERE c.offer_id = ?
      AND c.user_id = ?
      AND cp.date >= ?
      AND cp.date <= ?
    GROUP BY cp.date
    ORDER BY cp.date ASC
  `, [offerId, userId, startDateStr, endDateStr]) as any[]

  // 查询佣金趋势数据（不转换货币）
  const commissionTrends = await db.query(`
    SELECT
      aca.report_date as date,
      COALESCE(SUM(aca.commission_amount), 0) as commission,
      COALESCE(MAX(aca.currency), 'USD') as commission_currency
    FROM affiliate_commission_attributions aca
    WHERE aca.user_id = ?
      AND aca.offer_id = ?
      AND aca.report_date >= ?
      AND aca.report_date <= ?
    GROUP BY aca.report_date
    ORDER BY aca.report_date ASC
  `, [userId, offerId, startDateStr, endDateStr]) as any[]

  const adMap = new Map<string, {
    impressions: number
    clicks: number
    cost: number
    cost_currency: string
    ctr: number
  }>()
  for (const row of adTrends) {
    const date = normalizeDateKey(row?.date)
    if (!date) continue
    adMap.set(date, {
      impressions: Number(row?.impressions) || 0,
      clicks: Number(row?.clicks) || 0,
      cost: Number(row?.cost) || 0,
      cost_currency: String(row?.cost_currency || 'CNY'),
      ctr: Number(row?.ctr) || 0,
    })
  }

  const commissionMap = new Map<string, { commission: number; commission_currency: string }>()
  for (const row of commissionTrends) {
    const date = normalizeDateKey(row?.date)
    if (!date) continue
    commissionMap.set(date, {
      commission: Number(row?.commission) || 0,
      commission_currency: String(row?.commission_currency || 'USD'),
    })
  }

  const dateSet = new Set<string>([
    ...Array.from(adMap.keys()),
    ...Array.from(commissionMap.keys()),
  ])

  const dates = Array.from(dateSet).sort((a, b) => a.localeCompare(b))

  return dates.map((date) => {
    const ad = adMap.get(date)
    const commissionData = commissionMap.get(date)
    const clicks = ad?.clicks || 0
    const commission = commissionData?.commission || 0
    const commissionPerClick = clicks > 0 ? commission / clicks : 0

    return {
      date,
      impressions: ad?.impressions || 0,
      clicks,
      conversions: roundTo2(commission),
      commission: roundTo2(commission),
      commission_currency: commissionData?.commission_currency || 'USD',
      cost: ad?.cost || 0,
      cost_currency: ad?.cost_currency || 'CNY',
      ctr: ad?.ctr || 0,
      conversion_rate: roundTo2(commissionPerClick),
      commission_per_click: roundTo2(commissionPerClick),
    }
  })
}

export async function getCampaignPerformanceComparison(
  offerId: number,
  userId: number,
  daysBack: number = 30
): Promise<CampaignPerformanceComparison[]> {
  const db = await getDatabase()
  const { startDateStr, endDateStr } = getDateRange(daysBack)

  // 查询所有 Campaign 的广告数据（不转换货币）
  const campaigns = await db.query(`
    SELECT
      cp.campaign_id,
      c.campaign_name,
      c.google_campaign_id,
      SUM(cp.impressions) as impressions,
      SUM(cp.clicks) as clicks,
      SUM(cp.cost) as cost,
      COALESCE(MAX(cp.currency), gaa.currency, 'CNY') as cost_currency,
      CASE
        WHEN SUM(cp.impressions) > 0 THEN SUM(cp.clicks) * 100.0 / SUM(cp.impressions)
        ELSE 0
      END as ctr,
      CASE
        WHEN SUM(cp.clicks) > 0 THEN SUM(cp.cost) / SUM(cp.clicks)
        ELSE 0
      END as cpc
    FROM campaigns c
    LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
    LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
    WHERE c.offer_id = ?
      AND c.user_id = ?
      AND cp.date >= ?
      AND cp.date <= ?
    GROUP BY cp.campaign_id, c.campaign_name, c.google_campaign_id, gaa.currency
    ORDER BY SUM(cp.clicks) DESC
  `, [offerId, userId, startDateStr, endDateStr]) as any[]

  // 查询每个 Campaign 的佣金数据（不转换货币）
  const commissionRows = await db.query(`
    SELECT
      aca.campaign_id,
      COALESCE(SUM(aca.commission_amount), 0) AS commission,
      COALESCE(MAX(aca.currency), 'USD') as commission_currency
    FROM affiliate_commission_attributions aca
    WHERE aca.user_id = ?
      AND aca.offer_id = ?
      AND aca.report_date >= ?
      AND aca.report_date <= ?
      AND aca.campaign_id IS NOT NULL
    GROUP BY aca.campaign_id
  `, [userId, offerId, startDateStr, endDateStr]) as Array<{
    campaign_id: number
    commission: number
    commission_currency: string
  }>

  const commissionByCampaign = new Map<number, { commission: number; commission_currency: string }>()
  for (const row of commissionRows) {
    const campaignId = Number(row.campaign_id)
    if (!Number.isFinite(campaignId)) continue
    commissionByCampaign.set(campaignId, {
      commission: Number(row.commission) || 0,
      commission_currency: String(row.commission_currency || 'USD'),
    })
  }

  const mapped = campaigns.map((row) => {
    const campaignId = Number(row.campaign_id)
    const clicks = Number(row.clicks) || 0
    const commissionData = commissionByCampaign.get(campaignId)
    const commission = commissionData?.commission || 0
    const commissionPerClick = clicks > 0 ? commission / clicks : 0

    return {
      campaign_id: campaignId,
      campaign_name: row.campaign_name,
      google_campaign_id: row.google_campaign_id,
      impressions: Number(row.impressions) || 0,
      clicks,
      conversions: roundTo2(commission),
      commission: roundTo2(commission),
      commission_currency: commissionData?.commission_currency || 'USD',
      cost: Number(row.cost) || 0,
      cost_currency: String(row.cost_currency || 'CNY'),
      ctr: Number(row.ctr) || 0,
      cpc: Number(row.cpc) || 0,
      conversion_rate: roundTo2(commissionPerClick),
      commission_per_click: roundTo2(commissionPerClick),
    }
  })

  return mapped.sort((a, b) => {
    if (b.commission !== a.commission) return b.commission - a.commission
    return b.clicks - a.clicks
  })
}

export async function calculateOfferROI(
  offerId: number,
  userId: number,
  avgOrderValue: number,
  daysBack: number = 30
): Promise<OfferROI> {
  const db = await getDatabase()
  const { startDateStr, endDateStr } = getDateRange(daysBack)

  // 查询广告成本数据，按货币分组
  const adDataRows = await db.query(`
    SELECT
      COALESCE(cp.currency, gaa.currency, 'CNY') as currency,
      SUM(cp.cost) as total_cost
    FROM campaigns c
    LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
    LEFT JOIN campaign_performance cp ON c.id = cp.campaign_id
    WHERE c.offer_id = ?
      AND c.user_id = ?
      AND cp.date >= ?
      AND cp.date <= ?
    GROUP BY COALESCE(cp.currency, gaa.currency, 'CNY')
  `, [offerId, userId, startDateStr, endDateStr]) as Array<{ currency: string; total_cost: number }>

  // 将所有成本转换为 USD
  let totalCostUsd = 0
  for (const row of adDataRows) {
    const costAmount = Number(row.total_cost) || 0
    const costCurrency = String(row.currency || 'CNY').trim()

    if (costAmount > 0) {
      try {
        const converted = convertCurrency(costAmount, costCurrency, 'USD')
        totalCostUsd += converted
      } catch (error) {
        console.warn(`Failed to convert cost from ${costCurrency} to USD:`, error)
        totalCostUsd += costAmount
      }
    }
  }

  // 查询佣金数据，按货币分组
  const commissionRows = await db.query(`
    SELECT
      aca.currency,
      COALESCE(SUM(aca.commission_amount), 0) AS commission
    FROM affiliate_commission_attributions aca
    WHERE aca.user_id = ?
      AND aca.offer_id = ?
      AND aca.report_date >= ?
      AND aca.report_date <= ?
    GROUP BY aca.currency
  `, [userId, offerId, startDateStr, endDateStr]) as Array<{ currency: string; commission: number }>

  // 将所有佣金转换为 USD
  let totalCommissionUsd = 0
  for (const row of commissionRows) {
    const commissionAmount = Number(row.commission) || 0
    const commissionCurrency = String(row.currency || 'USD').trim()

    if (commissionAmount > 0) {
      try {
        const converted = convertCurrency(commissionAmount, commissionCurrency, 'USD')
        totalCommissionUsd += converted
      } catch (error) {
        console.warn(`Failed to convert commission from ${commissionCurrency} to USD:`, error)
        totalCommissionUsd += commissionAmount
      }
    }
  }

  void avgOrderValue
  const totalRevenueUsd = totalCommissionUsd
  const profitUsd = totalRevenueUsd - totalCostUsd
  const roiPercentage = totalCostUsd > 0 ? (profitUsd / totalCostUsd) * 100 : 0

  return {
    total_cost_usd: roundTo2(totalCostUsd),
    total_revenue_usd: roundTo2(totalRevenueUsd),
    roi_percentage: roundTo2(roiPercentage),
    profit_usd: roundTo2(profitUsd),
    conversions: roundTo2(totalCommissionUsd),
    commission: roundTo2(totalCommissionUsd),
  }
}
