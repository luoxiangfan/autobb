#!/usr/bin/env tsx
/**
 * Phase-2 campaigns split: ROAS utilities, SortableHeader, OverallRoasDialog.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const pagePath = path.join(root, 'src/app/(app)/campaigns/CampaignsClientPage.tsx')
const typesPath = path.join(root, 'src/app/(app)/campaigns/types.ts')

function readLines(file: string): string[] {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/)
}

function writeFile(rel: string, content: string) {
  const full = path.join(root, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}

function slice(file: string, start: number, end: number): string {
  return readLines(file)
    .slice(start - 1, end)
    .join('\n')
}

function _replaceBlock(file: string, start: number, end: number, replacement: string) {
  const lines = readLines(file)
  const next = [...lines.slice(0, start - 1), ...replacement.split(/\r?\n/), ...lines.slice(end)]
  fs.writeFileSync(file, next.join('\n'))
}

// --- types.ts: append ROAS + sort types ---
const typesAppend = `

export type CampaignRoasRankItem = {
  id: number
  campaignName: string
  spend: number
  commission: number
  impressions: number
  clicks: number
  roas: number | null
  actualCpc: number | null
}

export type OverallRoasStatistics = {
  generatedAt: string
  timeRangeLabel: string
  currency: string
  campaignCount: number
  totalSpend: number
  totalCommission: number
  totalRoas: number | null
  avgActualCpc: number | null
  highestActualCpc: CampaignRoasRankItem | null
  lowestActualCpc: CampaignRoasRankItem | null
  totalImpressions: number
  totalClicks: number
  averageCtr: number | null
  campaigns: CampaignRoasRankItem[]
  bestTop3: CampaignRoasRankItem[]
  worstBottom3: CampaignRoasRankItem[]
}

export type CampaignSortField =
  | 'campaignName'
  | 'budgetAmount'
  | 'impressions'
  | 'clicks'
  | 'ctr'
  | 'cpc'
  | 'configuredMaxCpc'
  | 'conversions'
  | 'cost'
  | 'roas'
  | 'status'
  | 'servingStartDate'

export type CampaignSortDirection = 'asc' | 'desc' | null
`

const typesContent = fs.readFileSync(typesPath, 'utf8')
if (!typesContent.includes('export type CampaignRoasRankItem')) {
  fs.writeFileSync(typesPath, typesContent.trimEnd() + typesAppend)
}

// --- campaign-metrics-utils.ts ---
writeFile(
  'src/app/(app)/campaigns/campaign-metrics-utils.ts',
  `import { formatCurrency as formatCurrencyDashboard } from '@/lib/utils'
import { convertCurrency } from '@/lib/currency-converter'
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
    .map(({ currency, amount }) => \`\${currency} \${formatCurrencyDashboard(amount, currency)}\`)
    .join(', ')
}

export const formatRoasNumber = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '--' : \`\${value.toFixed(2)}x\`

export const formatPercentNumber = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '--' : \`\${value.toFixed(2)}%\`

export const anonymizeCampaignName = (campaignName: string): string => {
  const normalized = String(campaignName || '').trim()
  if (!normalized) return 'Unknown'
  const firstUnderscore = normalized.indexOf('_')
  if (firstUnderscore <= 0) return 'Unknown'
  return \`Unknown\${normalized.slice(firstUnderscore)}\`
}
`
)

// --- build-overall-roas-statistics.ts ---
writeFile(
  'src/app/(app)/campaigns/build-overall-roas-statistics.ts',
  `import type { Campaign, CampaignRoasRankItem, OverallRoasStatistics } from './types'
import { convertAmountForDisplay } from './campaign-metrics-utils'

const normalizeMetricValue = (value: unknown): number => {
  const normalized = Number(value ?? 0)
  return Number.isFinite(normalized) ? normalized : 0
}

export function buildOverallRoasStatistics(params: {
  selectedCampaigns: Campaign[]
  timeRangeLabel: string
  summaryDisplayCurrency: string
}): OverallRoasStatistics {
  const { selectedCampaigns, timeRangeLabel, summaryDisplayCurrency } = params

  const campaignMetrics: CampaignRoasRankItem[] = selectedCampaigns.map((campaign) => {
    const metricCurrency = String(
      campaign.performanceCurrency ||
        campaign.adsAccountCurrency ||
        summaryDisplayCurrency ||
        'USD'
    ).toUpperCase()
    const rawSpend = normalizeMetricValue(
      campaign.performance?.costLocal ?? campaign.performance?.costUsd
    )
    const rawCommission = normalizeMetricValue(
      campaign.performance?.commission ?? campaign.performance?.conversions
    )
    const impressions = normalizeMetricValue(campaign.performance?.impressions)
    const clicks = normalizeMetricValue(campaign.performance?.clicks)

    const spend = normalizeMetricValue(
      convertAmountForDisplay(rawSpend, metricCurrency, summaryDisplayCurrency)
    )
    const commission = normalizeMetricValue(
      convertAmountForDisplay(rawCommission, metricCurrency, summaryDisplayCurrency)
    )
    const roas = spend > 0 ? commission / spend : null
    const actualCpc = clicks > 0 ? spend / clicks : null

    return {
      id: campaign.id,
      campaignName: campaign.campaignName,
      spend,
      commission,
      impressions,
      clicks,
      roas,
      actualCpc,
    }
  })

  const totalSpend = campaignMetrics.reduce((sum, item) => sum + item.spend, 0)
  const totalCommission = campaignMetrics.reduce((sum, item) => sum + item.commission, 0)
  const totalImpressions = campaignMetrics.reduce((sum, item) => sum + item.impressions, 0)
  const totalClicks = campaignMetrics.reduce((sum, item) => sum + item.clicks, 0)
  const totalRoas = totalSpend > 0 ? totalCommission / totalSpend : null
  const avgActualCpc = totalClicks > 0 ? totalSpend / totalClicks : null
  const averageCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : null

  const sortedByActualCpc = campaignMetrics
    .filter((item) => item.actualCpc !== null)
    .sort((a, b) => Number(a.actualCpc) - Number(b.actualCpc))
  const lowestActualCpc = sortedByActualCpc[0] || null
  const highestActualCpc =
    sortedByActualCpc.length > 0 ? sortedByActualCpc[sortedByActualCpc.length - 1] : null

  const sortedByRoasDesc = campaignMetrics
    .filter((item) => item.roas !== null)
    .sort((a, b) => {
      const roasGap = Number(b.roas) - Number(a.roas)
      if (roasGap !== 0) return roasGap
      return b.commission - a.commission
    })
  const sortedByRoasAsc = [...sortedByRoasDesc].reverse()

  return {
    generatedAt: new Date().toLocaleString('zh-CN', {
      hour12: false,
      timeZone: 'Asia/Shanghai',
    }),
    timeRangeLabel,
    currency: summaryDisplayCurrency,
    campaignCount: selectedCampaigns.length,
    totalSpend,
    totalCommission,
    totalRoas,
    avgActualCpc,
    highestActualCpc,
    lowestActualCpc,
    totalImpressions,
    totalClicks,
    averageCtr,
    campaigns: campaignMetrics,
    bestTop3: sortedByRoasDesc.slice(0, 3),
    worstBottom3: sortedByRoasAsc.slice(0, 3),
  }
}
`
)

// --- export-overall-roas-image.ts: extract canvas builder ---
const imageBody = slice(pagePath, 2362, 2769)
  .replace(
    /^  const buildOverallRoasImageDataUrl = \(/m,
    'export function buildOverallRoasImageDataUrl('
  )
  .replace(/^    stats: OverallRoasStatistics,/m, '  stats: OverallRoasStatistics,')
  .replace(
    /^    options\?: \{ hideBrandNames\?: boolean \}/m,
    '  options?: { hideBrandNames?: boolean }'
  )
  .replace(/^  \): string => \{/m, '): string {')

writeFile(
  'src/app/(app)/campaigns/export-overall-roas-image.ts',
  `import { formatCurrency as formatCurrencyDashboard } from '@/lib/utils'
import type { CampaignRoasRankItem, OverallRoasStatistics } from './types'
import { anonymizeCampaignName, formatPercentNumber, formatRoasNumber } from './campaign-metrics-utils'

${imageBody}
`
)

// --- CampaignSortableHeader.tsx ---
writeFile(
  'src/app/(app)/campaigns/CampaignSortableHeader.tsx',
  `'use client'

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { TableHead } from '@/components/ui/table'
import type { CampaignSortDirection, CampaignSortField } from './types'

export type CampaignSortableHeaderProps = {
  field: CampaignSortField
  children: React.ReactNode
  className?: string
  sortField: CampaignSortField | null
  sortDirection: CampaignSortDirection
  onSort: (field: CampaignSortField) => void
}

export function CampaignSortableHeader({
  field,
  children,
  className = '',
  sortField,
  sortDirection,
  onSort,
}: CampaignSortableHeaderProps) {
  const isActive = sortField === field
  return (
    <TableHead
      className={\`cursor-pointer select-none hover:bg-gray-50 \${className}\`}
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-0.5">
        {children}
        {isActive ? (
          sortDirection === 'asc' ? (
            <ArrowUp className="w-3.5 h-3.5" />
          ) : (
            <ArrowDown className="w-3.5 h-3.5" />
          )
        ) : (
          <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
        )}
      </div>
    </TableHead>
  )
}
`
)

console.log('Wrote campaigns phase-2 utility modules. Wire CampaignsClientPage manually.')
