import { formatCurrency as formatCurrencyDashboard } from '@/lib/common'
import { convertCurrency } from '@/lib/common'
import type { Campaign } from './types'

export const roundTo2 = (value: number): number => Math.round(value * 100) / 100

export const getCampaignCommissionValue = (campaign: Campaign): number | null => {
  const raw = campaign.performance?.commission ?? campaign.performance?.conversions
  if (raw === null || raw === undefined) return null
  const normalized = Number(raw)
  return Number.isFinite(normalized) ? normalized : null
}

export const getCampaignCostValue = (campaign: Campaign): number | null => {
  const raw = campaign.performance?.costLocal ?? campaign.performance?.costUsd
  if (raw === null || raw === undefined) return null
  const normalized = Number(raw)
  return Number.isFinite(normalized) ? normalized : null
}

export const calculateCampaignRoas = (campaign: Campaign): number | null => {
  const commission = getCampaignCommissionValue(campaign)
  const cost = getCampaignCostValue(campaign)
  if (commission === null || cost === null || cost <= 0) return null
  return Math.round((commission / cost) * 100) / 100
}

export const convertAmountForDisplay = (
  amount: number,
  fromCurrency: string,
  toCurrency: string
): number => {
  if (!Number.isFinite(amount)) return 0

  const sourceCurrency = String(fromCurrency || '')
    .trim()
    .toUpperCase()
  const targetCurrency = String(toCurrency || '')
    .trim()
    .toUpperCase()

  if (!sourceCurrency || !targetCurrency || sourceCurrency === targetCurrency) {
    return amount
  }

  try {
    return convertCurrency(amount, sourceCurrency, targetCurrency)
  } catch {
    return amount
  }
}

export const formatCurrencyWithCode = (
  amounts: Array<{ currency: string; amount: number }>,
  fallbackCurrency: string
): string => {
  if (!Array.isArray(amounts) || amounts.length === 0) {
    return formatCurrencyDashboard(0, fallbackCurrency)
  }

  return amounts
    .map(({ currency, amount }) => `${currency} ${formatCurrencyDashboard(amount, currency)}`)
    .join(', ')
}

export const formatRoasNumber = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '--' : `${value.toFixed(2)}x`

export const formatPercentNumber = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '--' : `${value.toFixed(2)}%`

export const anonymizeCampaignName = (campaignName: string): string => {
  const normalized = String(campaignName || '').trim()
  if (!normalized) return 'Unknown'
  const firstUnderscore = normalized.indexOf('_')
  if (firstUnderscore <= 0) return 'Unknown'
  return `Unknown${normalized.slice(firstUnderscore)}`
}
