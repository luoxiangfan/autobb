import { convertCurrency } from '@/lib/common/server'

export function normalizeCurrency(value: unknown): string {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()
  return normalized || 'USD'
}

export function formatLocalYmd(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function shiftYmd(ymd: string, deltaDays: number): string {
  const [year, month, day] = ymd.split('-').map((part) => Number(part))
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + deltaDays)
  return date.toISOString().slice(0, 10)
}

export function diffDaysInclusive(startYmd: string, endYmd: string): number {
  const startTs = Date.parse(`${startYmd}T00:00:00Z`)
  const endTs = Date.parse(`${endYmd}T00:00:00Z`)
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) return 1
  return Math.max(1, Math.floor((endTs - startTs) / (24 * 60 * 60 * 1000)) + 1)
}

export function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

export function calculateRoas(
  commission: number,
  cost: number
): { value: number | null; infinite: boolean } {
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

export type PerformanceAgg = {
  impressions: number
  clicks: number
  cost: number
}

export const BASE_CURRENCY = 'USD'

export function convertToBase(amount: number, currency: string): number {
  const normalizedAmount = Number(amount) || 0
  const normalizedCurrency = normalizeCurrency(currency)
  if (normalizedCurrency === BASE_CURRENCY) return normalizedAmount
  try {
    return convertCurrency(normalizedAmount, normalizedCurrency, BASE_CURRENCY)
  } catch {
    return 0
  }
}

export function convertAmountToCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string
): number {
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

export function sumAmountsInCurrency(
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

export function summarizeAggByCurrency(params: {
  byCampaign: Map<number, Map<string, PerformanceAgg>>
  reportingCurrency: string | null
}): PerformanceAgg {
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
      cost += params.reportingCurrency ? aggCost : convertToBase(aggCost, normalizedCurrency)
    }
  }

  return { impressions, clicks, cost }
}

export function summarizeCostsByCurrency(
  byCampaign: Map<number, Map<string, PerformanceAgg>>
): Array<{ currency: string; amount: number }> {
  const totals = new Map<string, number>()

  for (const byCurrency of byCampaign.values()) {
    for (const [currency, agg] of byCurrency.entries()) {
      const normalizedCurrency = normalizeCurrency(currency)
      totals.set(
        normalizedCurrency,
        (totals.get(normalizedCurrency) || 0) + (Number(agg.cost) || 0)
      )
    }
  }

  return Array.from(totals.entries())
    .map(([currency, amount]) => ({ currency, amount }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.currency.localeCompare(b.currency))
}

export function summarizeCommissionByCurrency(
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

export function sumCommissionByCampaign(
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

export function filterMapByCampaignIds<T>(
  byCampaign: Map<number, T>,
  campaignIds: Set<number>
): Map<number, T> {
  if (campaignIds.size === 0) return new Map<number, T>()
  const filtered = new Map<number, T>()
  for (const [campaignId, value] of byCampaign.entries()) {
    if (!campaignIds.has(campaignId)) continue
    filtered.set(campaignId, value)
  }
  return filtered
}

export const CAMPAIGN_SORT_FIELDS = new Set([
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

export function parseOptionalPositiveInt(value: string | null): number | null {
  if (value === null) return null
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

export function parseOptionalNonNegativeInt(value: string | null): number | null {
  if (value === null) return null
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

export function parseOptionalBoolean(value: string | null): boolean | null {
  if (value === null) return null
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'true' || normalized === '1') return true
  if (normalized === 'false' || normalized === '0') return false
  return null
}

export function safeParseJson<T = any>(value: unknown): T | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return value as T
  if (typeof value !== 'string') return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export function toPositiveNumberOrNull(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function resolveConfiguredMaxCpc(maxCpc: unknown, campaignConfig: unknown): number | null {
  const direct = toPositiveNumberOrNull(maxCpc)
  if (direct !== null) return direct

  const parsedConfig = safeParseJson<Record<string, unknown>>(campaignConfig)
  return toPositiveNumberOrNull(parsedConfig?.maxCpcBid)
}

// "Deleted" here仅表示软删除(is_deleted)，而不是业务上的“下线(REMOVED)”
// 下线后的广告系列仍然需要出现在 /campaigns 列表中，因此只按 isDeleted 过滤
export function isCampaignRemovedOrDeleted(campaign: any): boolean {
  const deletedFlag = campaign?.isDeleted === true || campaign?.isDeleted === 1
  return deletedFlag
}

export function getCampaignRoasValue(campaign: any): number | null {
  const commission = Number(campaign?.performance?.commission ?? campaign?.performance?.conversions)
  const cost = Number(campaign?.performance?.costLocal ?? campaign?.performance?.costUsd)
  if (!Number.isFinite(commission) || !Number.isFinite(cost) || cost <= 0) return null
  return roundTo2(commission / cost)
}
