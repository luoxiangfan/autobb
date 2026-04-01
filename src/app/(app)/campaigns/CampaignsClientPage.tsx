'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { showSuccess, showError, showInfo } from '@/lib/toast-utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { ResponsivePagination } from '@/components/ui/responsive-pagination'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Search, Trash2, ExternalLink, AlertCircle, CheckCircle2, PlayCircle, PauseCircle, XCircle, TrendingUp, Coins, Wallet, ArrowUpDown, ArrowUp, ArrowDown, Package, Loader2, MoreHorizontal, Maximize2, CalendarDays } from 'lucide-react'
import type { TrendChartData, TrendChartMetric } from '@/components/charts/TrendChart'
import { DateRangePicker, type DateRange } from '@/components/ui/date-range-picker'
import {
  getCampaignStatusLabel,
} from '@/lib/i18n-constants'
import { convertCurrency, formatCurrency } from '@/lib/currency'
import { formatCurrency as formatCurrencyDashboard, formatMultiCurrency } from '@/lib/utils'

const TrendChart = dynamic(
  () => import('@/components/charts/TrendChart').then((mod) => mod.TrendChart),
  {
    ssr: false,
    loading: () => <div className="h-[260px] w-full animate-pulse rounded-md bg-muted/50" />,
  }
)
const AdjustCampaignCpcDialog = dynamic(() => import('@/components/AdjustCampaignCpcDialog'), { ssr: false })
const AdjustCampaignBudgetDialog = dynamic(() => import('@/components/AdjustCampaignBudgetDialog'), { ssr: false })
const ClickFarmTaskModal = dynamic(() => import('@/components/ClickFarmTaskModal'), { ssr: false })
const UrlSwapTaskModal = dynamic(() => import('@/components/UrlSwapTaskModal'), { ssr: false })

interface Campaign {
  id: number
  offerId: number
  googleAdsAccountId: number | null
  adsAccountCustomerId?: string | null
  adsAccountName?: string | null
  googleCampaignId?: string | null
  campaignId: string | null
  campaignName: string
  budgetAmount: number
  budgetType: string
  status: string
  creationStatus: string
  creationError: string | null
  lastSyncAt: string | null
  servingStartDate?: string | null
  adsAccountAvailable?: boolean
  adsAccountCurrency?: string | null
  performanceCurrency?: string | null
  configuredMaxCpc?: number | null
  createdAt: string
  // 🔧 新增: 软删除状态字段
  isDeleted?: boolean | number
  deletedAt?: string | null
  offerIsDeleted?: boolean | number
  performance?: {
    impressions: number
    clicks: number
    conversions: number
    commission?: number
    commissionBase?: number
    costLocal?: number
    costUsd: number
    costBase?: number
    ctr: number
    cpcLocal?: number
    cpcUsd: number
    cpcBase?: number
    conversionRate: number
    commissionPerClick?: number
    dateRange: {
      start: string
      end: string
      days: number
    }
  }
}

interface PerformanceSummary {
  totalCampaigns: number
  activeCampaigns: number
  totalImpressions: number
  totalClicks: number
  totalConversions: number
  totalCommission?: number
  attributedCommission?: number
  unattributedCommission?: number
  totalCostUsd: number
  totalRoas?: number | null
  totalRoasInfinite?: boolean
  baseCurrency?: string
  currency?: string
  currencies?: string[]
  hasMixedCurrency?: boolean
  costs?: Array<{ currency: string; amount: number }>
  attributedCommissionsByCurrency?: Array<{ currency: string; amount: number }>
  unattributedCommissionsByCurrency?: Array<{ currency: string; amount: number }>
  latestSyncAt?: string | null
  statusDistribution?: {
    enabled: number
    paused: number
    removed: number
    total: number
  }
  // 环比增长数据
  changes?: {
    impressions: number | null
    clicks: number | null
    conversions: number | null
    cost: number | null
    roas?: number | null
    roasInfinite?: boolean
  }
}

type OfflineActionResult =
  | { status: 'success' }
  | { status: 'error'; message: string }
  | { status: 'account_issue'; message: string; accountStatus?: string }

type BatchOfflineFailure = {
  campaignName: string
  message: string
}

type BatchDeleteFailure = {
  campaignName: string
  message: string
}

type BatchOfflineAccountIssue = {
  campaign: Campaign
  message: string
  accountStatus?: string
}

type BatchOfflinePendingState = {
  totalCount: number
  successCount: number
  failures: BatchOfflineFailure[]
  accountIssues: BatchOfflineAccountIssue[]
}

type CampaignsTimeRange = '7' | '14' | '30' | 'custom'

const formatDateInputValue = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getCampaignCommissionValue = (campaign: Campaign): number | null => {
  const raw = campaign.performance?.commission ?? campaign.performance?.conversions
  if (raw === null || raw === undefined) return null
  const normalized = Number(raw)
  return Number.isFinite(normalized) ? normalized : null
}

const getCampaignCostValue = (campaign: Campaign): number | null => {
  const raw = campaign.performance?.costLocal ?? campaign.performance?.costUsd
  if (raw === null || raw === undefined) return null
  const normalized = Number(raw)
  return Number.isFinite(normalized) ? normalized : null
}

const calculateCampaignRoas = (campaign: Campaign): number | null => {
  const commission = getCampaignCommissionValue(campaign)
  const cost = getCampaignCostValue(campaign)
  if (commission === null || cost === null || cost <= 0) return null
  return Math.round((commission / cost) * 100) / 100
}

const convertAmountForDisplay = (amount: number, fromCurrency: string, toCurrency: string): number => {
  if (!Number.isFinite(amount)) return 0

  const sourceCurrency = String(fromCurrency || '').trim().toUpperCase()
  const targetCurrency = String(toCurrency || '').trim().toUpperCase()

  if (!sourceCurrency || !targetCurrency || sourceCurrency === targetCurrency) {
    return amount
  }

  try {
    return convertCurrency(amount, sourceCurrency, targetCurrency)
  } catch {
    return amount
  }
}

const formatCurrencyWithCode = (amounts: Array<{ currency: string; amount: number }>, fallbackCurrency: string): string => {
  if (!Array.isArray(amounts) || amounts.length === 0) {
    return formatCurrencyDashboard(0, fallbackCurrency)
  }

  return amounts
    .map(({ currency, amount }) => `${currency} ${formatCurrencyDashboard(amount, currency)}`)
    .join(', ')
}

const formatCampaignRoas = (campaign: Campaign): string => {
  const roas = calculateCampaignRoas(campaign)
  return roas === null ? '-' : roas.toFixed(2)
}

interface CampaignsClientPageProps {
  campaignsReqDedupEnabled?: boolean
  campaignsServerPagingEnabled?: boolean
}

type SelectedCampaignSnapshot = {
  id: number
  campaignName: string
  status: string
}

const MAX_SELECTED_CAMPAIGNS = 500
const BATCH_OPERATION_CHUNK_SIZE = 100

export default function CampaignsClientPage({
  campaignsReqDedupEnabled = false,
  campaignsServerPagingEnabled = false,
}: CampaignsClientPageProps) {
  const router = useRouter()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [filteredCampaigns, setFilteredCampaigns] = useState<Campaign[]>([])
  const [serverTotal, setServerTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<PerformanceSummary | null>(null)

  // Filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [timeRange, setTimeRange] = useState<CampaignsTimeRange>('7')
  const [dateRange, setDateRange] = useState<DateRange | undefined>()
  const [appliedCustomRange, setAppliedCustomRange] = useState<{ startDate: string; endDate: string } | null>(null)
  const showDeletedCampaigns = false

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const isServerPagingMode = campaignsServerPagingEnabled
  const totalItems = isServerPagingMode ? serverTotal : filteredCampaigns.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))

  // Sorting states
  type SortField = 'campaignName' | 'budgetAmount' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'configuredMaxCpc' | 'conversions' | 'cost' | 'roas' | 'status' | 'servingStartDate'
  type SortDirection = 'asc' | 'desc' | null
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>(null)
  const filterKeyRef = useRef<string>('')
  const silentRefreshCountRef = useRef(0)
  const campaignsInFlightRef = useRef<Map<string, Promise<void>>>(new Map())
  const trendsInFlightRef = useRef<Map<string, Promise<void>>>(new Map())
  const periodicRefreshInFlightRef = useRef(false)
  const campaignsFetchAbortRef = useRef<AbortController | null>(null)
  const campaignsFetchSeqRef = useRef(0)
  const trendsFetchAbortRef = useRef<AbortController | null>(null)
  const trendsFetchSeqRef = useRef(0)

  // Trend data states
  const [trendsData, setTrendsData] = useState<TrendChartData[]>([])
  const [trendsLoading, setTrendsLoading] = useState(false)
  const [trendsError, setTrendsError] = useState<string | null>(null)
  const [trendsBaseCurrency, setTrendsBaseCurrency] = useState<string>('USD')
  const [trendsTotalsConverted, setTrendsTotalsConverted] = useState<{
    cost: number
    commission: number
    impressions: number
    clicks: number
    cpc: number
    roas: number
  } | null>(null)
  const [trendsCostsByCurrency, setTrendsCostsByCurrency] = useState<Array<{ currency: string; amount: number }>>([])
  const [trendsCommissionsByCurrency, setTrendsCommissionsByCurrency] = useState<Array<{ currency: string; amount: number }>>([])
  const [expandedTrendChart, setExpandedTrendChart] = useState<'traffic' | 'cost' | null>(null)
  const expandedTrendChartHeight = 380

  // Batch offline states
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<number>>(new Set())
  const [selectedCampaignSnapshots, setSelectedCampaignSnapshots] = useState<Record<number, SelectedCampaignSnapshot>>({})
  const [batchOfflineSubmitting, setBatchOfflineSubmitting] = useState(false)
  const [isBatchOfflineDialogOpen, setIsBatchOfflineDialogOpen] = useState(false)
  const [isBatchOfflineAccountIssueDialogOpen, setIsBatchOfflineAccountIssueDialogOpen] = useState(false)
  const [batchOfflinePendingState, setBatchOfflinePendingState] = useState<BatchOfflinePendingState | null>(null)
  const [batchOfflineBlacklistOffer, setBatchOfflineBlacklistOffer] = useState(false)
  const [batchOfflinePauseClickFarm, setBatchOfflinePauseClickFarm] = useState(false)
  const [batchOfflinePauseUrlSwap, setBatchOfflinePauseUrlSwap] = useState(false)
  const [batchOfflineRemoveGoogleAds, setBatchOfflineRemoveGoogleAds] = useState(false)
  const [batchDeleteSubmitting, setBatchDeleteSubmitting] = useState(false)
  const [isBatchDeleteDialogOpen, setIsBatchDeleteDialogOpen] = useState(false)

  // Adjust CPC dialog states
  const [adjustCpcOpen, setAdjustCpcOpen] = useState(false)
  const [adjustCpcTarget, setAdjustCpcTarget] = useState<{ googleCampaignId: string; campaignName: string } | null>(null)
  const [adjustBudgetOpen, setAdjustBudgetOpen] = useState(false)
  const [adjustBudgetTarget, setAdjustBudgetTarget] = useState<{
    googleCampaignId: string
    campaignName: string
    currentBudget: number
    currentBudgetType: string
    currency: string
  } | null>(null)

  // Toggle status states
  const [statusUpdatingIds, setStatusUpdatingIds] = useState<Set<number>>(new Set())
  const [isToggleStatusDialogOpen, setIsToggleStatusDialogOpen] = useState(false)
  const [toggleStatusTarget, setToggleStatusTarget] = useState<Campaign | null>(null)
  const [toggleStatusNextStatus, setToggleStatusNextStatus] = useState<'PAUSED' | 'ENABLED' | null>(null)

  // Delete draft dialog states
  const [isDeleteDraftDialogOpen, setIsDeleteDraftDialogOpen] = useState(false)
  const [deleteDraftTarget, setDeleteDraftTarget] = useState<Campaign | null>(null)
  const [deleteDraftSubmitting, setDeleteDraftSubmitting] = useState(false)
  const [isDeleteRemovedDialogOpen, setIsDeleteRemovedDialogOpen] = useState(false)
  const [deleteRemovedTarget, setDeleteRemovedTarget] = useState<Campaign | null>(null)
  const [deleteRemovedSubmitting, setDeleteRemovedSubmitting] = useState(false)

  // Offline (下线) dialog states
  const [isOfflineDialogOpen, setIsOfflineDialogOpen] = useState(false)
  const [offlineTarget, setOfflineTarget] = useState<Campaign | null>(null)
  const [offlineSubmitting, setOfflineSubmitting] = useState(false)
  const [offlineBlacklistOffer, setOfflineBlacklistOffer] = useState(false)
  const [offlinePauseClickFarm, setOfflinePauseClickFarm] = useState(false)
  const [offlinePauseUrlSwap, setOfflinePauseUrlSwap] = useState(false)
  const [offlineRemoveGoogleAds, setOfflineRemoveGoogleAds] = useState(false)
  const [isOfflineAccountIssueDialogOpen, setIsOfflineAccountIssueDialogOpen] = useState(false)
  const [offlineAccountIssueMessage, setOfflineAccountIssueMessage] = useState<string | null>(null)
  const [offlineAccountIssueStatus, setOfflineAccountIssueStatus] = useState<string | null>(null)

   // 补点击任务Modal
  const [isClickFarmModalOpen, setIsClickFarmModalOpen] = useState(false)
  const [selectedOfferForClickFarm, setSelectedOfferForClickFarm] = useState<Campaign | null>(null)
  const [editTaskIdForClickFarm, setEditTaskIdForClickFarm] = useState<string | number | undefined>(undefined)
  const [clickFarmLoading, setClickFarmLoading] = useState(false)
  
  // 换链接任务Modal
  const [isUrlSwapModalOpen, setIsUrlSwapModalOpen] = useState(false)
  const [selectedOfferForUrlSwap, setSelectedOfferForUrlSwap] = useState<Campaign | null>(null)
  const [editTaskIdForUrlSwap, setEditTaskIdForUrlSwap] = useState<string | undefined>(undefined)
  const [urlSwapLoading, setUrlSwapLoading] = useState(false)

  // 仅将软删除(isDeleted)视为"已删除"，REMOVED 视为"已下线"仍展示
  const isCampaignDeleted = (campaign: Campaign) => {
    const deletedFlag = campaign.isDeleted === true || campaign.isDeleted === 1
    return deletedFlag
  }
  const isOfferDeleted = (campaign: Campaign) => campaign.offerIsDeleted === true || campaign.offerIsDeleted === 1
  const getCampaignGoogleId = (campaign: Campaign) => campaign.googleCampaignId || campaign.campaignId

  const currencySet = new Set(
    campaigns
      .map((c) => c.adsAccountCurrency)
      .filter((c): c is string => Boolean(c))
  )
  const defaultCurrency = currencySet.size >= 1 ? Array.from(currencySet)[0] : 'USD'
  const formatMoney = (value: number, currencyCode: string = defaultCurrency) =>
    formatCurrency(value, currencyCode)
  const trendsCurrencyValue = trendsBaseCurrency || defaultCurrency
  const trendsOverviewDescription = `说明：花费/佣金/CPC/ROAS 按 ${trendsCurrencyValue} 统一折算`
  const trafficTrendDescription = `左轴：展示+点击，右轴：佣金(${trendsCurrencyValue})`
  const costTrendDescription = `左轴：花费+佣金(${trendsCurrencyValue})，右轴：CPC/ROAS`
  const formatTrendsMoney = (value: number) => formatCurrency(value, trendsCurrencyValue)
  const trafficTrendMetrics: TrendChartMetric[] = [
    { key: 'impressions', label: '展示', color: 'hsl(217, 91%, 60%)', yAxisId: 'left' },
    { key: 'clicks', label: '点击', color: 'hsl(142, 76%, 36%)', yAxisId: 'left' },
    { key: 'commission', label: `佣金(${trendsCurrencyValue})`, color: 'hsl(280, 87%, 65%)', formatter: (v: number) => formatTrendsMoney(v), yAxisId: 'right' },
  ]
  const costStackPalette = [
    'hsl(25, 95%, 53%)',
    'hsl(217, 91%, 60%)',
    'hsl(142, 76%, 36%)',
    'hsl(280, 87%, 65%)',
    'hsl(45, 93%, 47%)',
    'hsl(190, 85%, 45%)',
    'hsl(340, 82%, 52%)',
    'hsl(160, 70%, 42%)',
  ]
  const fallbackCostMetric: TrendChartMetric = {
    key: 'cost',
    label: `花费(${trendsCurrencyValue})`,
    color: costStackPalette[0],
    formatter: (v: number) => formatTrendsMoney(v),
    yAxisId: 'left',
    chartType: 'bar',
  }
  const costTrendMetrics: TrendChartMetric[] = [
    fallbackCostMetric,
    { key: 'commission', label: `佣金(${trendsCurrencyValue})`, color: 'hsl(280, 87%, 65%)', formatter: (v: number) => formatTrendsMoney(v), yAxisId: 'left', chartType: 'bar' },
    { key: 'avgCpc', label: `CPC(${trendsCurrencyValue})`, color: 'hsl(45, 93%, 47%)', formatter: (v: number) => formatTrendsMoney(v), yAxisId: 'right', chartType: 'line' },
    { key: 'roas', label: 'ROAS', color: 'hsl(221, 83%, 53%)', formatter: (v: number) => `${Number(v || 0).toFixed(2)}x`, yAxisId: 'right', chartType: 'line' },
  ]
  const formatSummaryRoas = (value: PerformanceSummary | null): string => {
    if (!value) return '--'
    if (value.currency === 'MIXED') return '--'
    if (value.totalRoasInfinite) return '∞'
    if (value.totalRoas === null || value.totalRoas === undefined) return '--'
    const normalized = Number(value.totalRoas)
    if (!Number.isFinite(normalized)) return '--'
    return `${normalized.toFixed(2)}x`
  }
  const formatSummaryRoasChange = (value: PerformanceSummary | null): string => {
    if (!value) return '--'
    if (value.currency === 'MIXED') return '--'
    if (value.changes?.roasInfinite) return '∞'
    const roasChange = value.changes?.roas
    if (roasChange === null || roasChange === undefined) return '--'
    const normalized = Number(roasChange)
    if (!Number.isFinite(normalized)) return '--'
    return `${Math.abs(normalized).toFixed(1)}%`
  }
  const visibleCampaignCount = totalItems
  const hasBatchOfflineSelection = selectedCampaignIds.size > 0
  const selectedRemovedCampaignCount = useMemo(
    () => Object.values(selectedCampaignSnapshots).filter(
      (campaign) => String(campaign.status || '').toUpperCase() === 'REMOVED'
    ).length,
    [selectedCampaignSnapshots]
  )
  const activeCampaignCount = isServerPagingMode
    ? Math.max(
        0,
        Number(summary?.statusDistribution?.total ?? summary?.totalCampaigns ?? totalItems)
          - Number(summary?.statusDistribution?.removed ?? 0)
      )
    : campaigns.filter((campaign) => !isCampaignDeleted(campaign)).length
  const enabledCampaignCount = Number(summary?.statusDistribution?.enabled ?? campaigns.filter(c => c.status === 'ENABLED').length)
  const pausedCampaignCount = Number(summary?.statusDistribution?.paused ?? campaigns.filter(c => c.status === 'PAUSED').length)
  const removedCampaignCount = Number(summary?.statusDistribution?.removed ?? campaigns.filter(c => c.status === 'REMOVED').length)
  const totalCampaignCount = Number(summary?.statusDistribution?.total ?? campaigns.length)
  const latestCampaignSyncFromCampaigns = campaigns.reduce<string | null>((latest, campaign) => {
    const candidate = campaign.lastSyncAt
    if (!candidate) return latest
    const candidateTs = Date.parse(candidate)
    if (Number.isNaN(candidateTs)) return latest

    if (!latest) return candidate
    const latestTs = Date.parse(latest)
    if (Number.isNaN(latestTs) || candidateTs > latestTs) return candidate

    return latest
  }, null)
  const latestCampaignSyncAt = summary?.latestSyncAt || latestCampaignSyncFromCampaigns
  const latestCampaignSyncLabel = (() => {
    if (!latestCampaignSyncAt) return '未同步'
    const parsed = Date.parse(latestCampaignSyncAt)
    if (Number.isNaN(parsed)) return '未同步'
    return new Date(parsed).toLocaleString('zh-CN', {
      hour12: false,
      timeZone: 'Asia/Shanghai',
    })
  })()
  const summaryTotalCommission = Number(summary?.totalCommission ?? summary?.totalConversions) || 0
  const summaryAttributedCommission = Number(summary?.attributedCommission ?? summaryTotalCommission) || 0
  const summaryUnattributedCommission = Number(
    summary?.unattributedCommission ?? Math.max(0, summaryTotalCommission - summaryAttributedCommission)
  ) || 0
  const summaryCommissionCurrency = summary?.currency && summary.currency !== 'MIXED'
    ? String(summary.currency)
    : trendsCurrencyValue
  const summaryDisplayCurrency = String(trendsCurrencyValue || defaultCurrency)
  const summaryTotalCommissionDisplay = convertAmountForDisplay(
    summaryTotalCommission,
    summaryCommissionCurrency,
    summaryDisplayCurrency
  )
  const summaryAttributedCommissionDisplay = convertAmountForDisplay(
    summaryAttributedCommission,
    summaryCommissionCurrency,
    summaryDisplayCurrency
  )
  const summaryUnattributedCommissionDisplay = convertAmountForDisplay(
    summaryUnattributedCommission,
    summaryCommissionCurrency,
    summaryDisplayCurrency
  )
  const summaryCostCurrency = summary?.currency && summary.currency !== 'MIXED'
    ? String(summary.currency)
    : summaryDisplayCurrency
  const summaryTotalCostDisplay = convertAmountForDisplay(
    Number(summary?.totalCostUsd ?? 0),
    summaryCostCurrency,
    summaryDisplayCurrency
  )
  const costBreakdown = trendsCostsByCurrency.length > 0
    ? trendsCostsByCurrency
    : (
      Array.isArray(summary?.costs) && summary.costs.length > 0
        ? summary.costs
        : (
          summary?.currency && summary.currency !== 'MIXED'
            ? [{ currency: String(summary.currency), amount: Number(summary?.totalCostUsd ?? 0) }]
            : []
        )
    )
  const commissionBreakdown = trendsCommissionsByCurrency.length > 0
    ? trendsCommissionsByCurrency
    : (
      summary?.currency && summary.currency !== 'MIXED'
        ? [{ currency: String(summary.currency), amount: summaryTotalCommission }]
        : []
    )
  const mixedAttributedCommissionBreakdown = Array.isArray(summary?.attributedCommissionsByCurrency)
    ? summary.attributedCommissionsByCurrency
    : []
  const mixedUnattributedCommissionBreakdown = Array.isArray(summary?.unattributedCommissionsByCurrency)
    ? summary.unattributedCommissionsByCurrency
    : []
  const customRangeLabel = appliedCustomRange
    ? `${appliedCustomRange.startDate} ~ ${appliedCustomRange.endDate}`
    : '自定义'
  const serverListDepsKey = isServerPagingMode
    ? JSON.stringify({
        currentPage,
        pageSize,
        searchQuery: debouncedSearchQuery.trim(),
        statusFilter,
        sortField,
        sortDirection,
        showDeletedCampaigns,
      })
    : ''

  useEffect(() => {
    if (!isServerPagingMode) {
      setDebouncedSearchQuery(searchQuery)
      return
    }

    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 300)

    return () => {
      window.clearTimeout(timer)
    }
  }, [isServerPagingMode, searchQuery])

  const handleDateRangeChange = (range: DateRange | undefined) => {
    if (!range?.from || !range?.to) {
      setDateRange(range)
      return
    }

    const startDate = formatDateInputValue(range.from)
    const endDate = formatDateInputValue(range.to)

    if (startDate > endDate) {
      showError('时间范围无效', '结束日期不能早于开始日期')
      return
    }

    setDateRange(range)
    setAppliedCustomRange({
      startDate,
      endDate,
    })
    setTimeRange('custom')
  }

  const selectPresetTimeRange = (days: Exclude<CampaignsTimeRange, 'custom'>) => {
    setTimeRange(days)
  }

  const resetBatchOfflineOptions = () => {
    setBatchOfflineBlacklistOffer(false)
    setBatchOfflinePauseClickFarm(false)
    setBatchOfflinePauseUrlSwap(false)
    setBatchOfflineRemoveGoogleAds(false)
  }

  const resetBatchOfflineState = () => {
    setBatchOfflinePendingState(null)
    resetBatchOfflineOptions()
  }

  const chunkArray = <T,>(items: T[], chunkSize: number): T[][] => {
    if (items.length === 0) return []
    const chunks: T[][] = []
    for (let i = 0; i < items.length; i += chunkSize) {
      chunks.push(items.slice(i, i + chunkSize))
    }
    return chunks
  }

  const upsertSelectedCampaignSnapshots = useCallback((nextCampaigns: Campaign[]) => {
    if (nextCampaigns.length === 0) return

    setSelectedCampaignSnapshots((prev) => {
      const next: Record<number, SelectedCampaignSnapshot> = { ...prev }
      let changed = false

      nextCampaigns.forEach((campaign) => {
        if (!selectedCampaignIds.has(campaign.id)) return

        const previous = next[campaign.id]
        const incoming: SelectedCampaignSnapshot = {
          id: campaign.id,
          campaignName: campaign.campaignName,
          status: campaign.status,
        }

        if (
          !previous
          || previous.campaignName !== incoming.campaignName
          || previous.status !== incoming.status
        ) {
          next[campaign.id] = incoming
          changed = true
        }
      })

      return changed ? next : prev
    })
  }, [selectedCampaignIds])

  const removeSelectedCampaignSnapshots = useCallback((ids: number[]) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)

    setSelectedCampaignSnapshots((prev) => {
      const next: Record<number, SelectedCampaignSnapshot> = { ...prev }
      let changed = false
      idSet.forEach((id) => {
        if (next[id]) {
          delete next[id]
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [])

  const applyLocalCampaignDeletion = useCallback((ids: number[]) => {
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length === 0) return
    const idSet = new Set(uniqueIds)

    setCampaigns((prev) => prev.filter((campaign) => !idSet.has(campaign.id)))
    setSelectedCampaignIds((prev) => {
      const next = new Set(prev)
      uniqueIds.forEach((id) => next.delete(id))
      return next
    })
    removeSelectedCampaignSnapshots(uniqueIds)

    if (isServerPagingMode) {
      setServerTotal((prev) => Math.max(0, prev - uniqueIds.length))
    }
  }, [isServerPagingMode, removeSelectedCampaignSnapshots])

  const applyLocalCampaignOffline = useCallback((ids: number[]) => {
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length === 0) return
    const idSet = new Set(uniqueIds)
    setCampaigns((prev) => {
      return prev.map((campaign) => {
        if (!idSet.has(campaign.id)) return campaign
        if (String(campaign.status || '').toUpperCase() === 'REMOVED') return campaign
        return {
          ...campaign,
          status: 'REMOVED',
        }
      })
    })

    setSelectedCampaignSnapshots((prev) => {
      const next: Record<number, SelectedCampaignSnapshot> = { ...prev }
      let changed = false

      uniqueIds.forEach((id) => {
        const snapshot = next[id]
        if (!snapshot) return
        if (String(snapshot.status || '').toUpperCase() === 'REMOVED') return
        next[id] = {
          ...snapshot,
          status: 'REMOVED',
        }
        changed = true
      })

      return changed ? next : prev
    })
  }, [isServerPagingMode])

  /**
   * 处理401未授权错误 - 跳转到登录页
   */
  const handleUnauthorized = () => {
    // 清除无效的cookie
    document.cookie = 'auth_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    // 跳转到登录页，保留当前路径用于登录后跳转回来
    const redirectUrl = encodeURIComponent(window.location.pathname + window.location.search)
    router.push(`/login?redirect=${redirectUrl}`)
  }

  useEffect(() => {
    fetchCampaigns()
  }, [timeRange, appliedCustomRange?.startDate, appliedCustomRange?.endDate, serverListDepsKey])

  useEffect(() => {
    fetchTrends()
  }, [timeRange, appliedCustomRange?.startDate, appliedCustomRange?.endDate])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden) return
      if (periodicRefreshInFlightRef.current) return

      periodicRefreshInFlightRef.current = true
      Promise.all([
        fetchCampaigns({ silent: true }),
        fetchTrends(),
      ]).finally(() => {
        periodicRefreshInFlightRef.current = false
      })
    }, 60_000)

    return () => {
      window.clearInterval(timer)
    }
  }, [timeRange, appliedCustomRange?.startDate, appliedCustomRange?.endDate, serverListDepsKey])

  useEffect(() => {
    upsertSelectedCampaignSnapshots(campaigns)

    setSelectedCampaignSnapshots((prev) => {
      const next: Record<number, SelectedCampaignSnapshot> = {}
      let changed = false

      for (const id of selectedCampaignIds) {
        const snapshot = prev[id]
        if (snapshot) {
          next[id] = snapshot
        } else {
          changed = true
        }
      }

      if (Object.keys(prev).length !== Object.keys(next).length) {
        changed = true
      }

      return changed ? next : prev
    })
  }, [campaigns, selectedCampaignIds, upsertSelectedCampaignSnapshots])

  useEffect(() => {
    if (isServerPagingMode) {
      setFilteredCampaigns(campaigns)
      setCurrentPage((prev) => {
        return prev > totalPages ? totalPages : prev
      })
      return
    }

    let result = campaigns

    if (!showDeletedCampaigns) {
      result = result.filter((campaign) => !isCampaignDeleted(campaign))
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (c) =>
          c.campaignName.toLowerCase().includes(query) ||
          (c.campaignId && c.campaignId.includes(query))
      )
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter((c) => c.status === statusFilter)
    }

    // Sorting
    if (sortField && sortDirection) {
      result = [...result].sort((a, b) => {
        if (sortField === 'servingStartDate') {
          const aDate = a.servingStartDate
          const bDate = b.servingStartDate

          // 无投放日期的记录，始终排在最后（不随排序方向变化）
          if (!aDate && !bDate) return 0
          if (!aDate) return 1
          if (!bDate) return -1

          if (aDate < bDate) return sortDirection === 'asc' ? -1 : 1
          if (aDate > bDate) return sortDirection === 'asc' ? 1 : -1
          return 0
        }
        if (sortField === 'roas') {
          const aRoas = calculateCampaignRoas(a)
          const bRoas = calculateCampaignRoas(b)
          if (aRoas === null && bRoas === null) return 0
          if (aRoas === null) return 1
          if (bRoas === null) return -1
          return sortDirection === 'asc' ? aRoas - bRoas : bRoas - aRoas
        }

        let aVal: number | string = 0
        let bVal: number | string = 0

        switch (sortField) {
          case 'campaignName':
            aVal = a.campaignName.toLowerCase()
            bVal = b.campaignName.toLowerCase()
            break
          case 'budgetAmount':
            // 🔧 修复(2025-12-29): 确保数值类型比较
            aVal = Number(a.budgetAmount) || 0
            bVal = Number(b.budgetAmount) || 0
            break
          case 'impressions':
            // 🔧 修复(2025-12-29): 确保数值类型比较
            aVal = Number(a.performance?.impressions) || 0
            bVal = Number(b.performance?.impressions) || 0
            break
          case 'clicks':
            // 🔧 修复(2025-12-29): 确保数值类型比较
            aVal = Number(a.performance?.clicks) || 0
            bVal = Number(b.performance?.clicks) || 0
            break
          case 'ctr':
            // 🔧 修复(2025-12-29): 确保数值类型比较
            aVal = Number(a.performance?.ctr) || 0
            bVal = Number(b.performance?.ctr) || 0
            break
          case 'cpc':
            // 🔧 修复(2025-12-29): 确保数值类型比较
            aVal = Number(a.performance?.cpcBase ?? a.performance?.cpcLocal ?? a.performance?.cpcUsd) || 0
            bVal = Number(b.performance?.cpcBase ?? b.performance?.cpcLocal ?? b.performance?.cpcUsd) || 0
            break
          case 'configuredMaxCpc':
            aVal = Number(a.configuredMaxCpc) || 0
            bVal = Number(b.configuredMaxCpc) || 0
            break
          case 'conversions':
            // 🔧 修复(2025-12-29): 确保数值类型比较
            aVal = Number(a.performance?.commissionBase ?? a.performance?.commission ?? a.performance?.conversions) || 0
            bVal = Number(b.performance?.commissionBase ?? b.performance?.commission ?? b.performance?.conversions) || 0
            break
          case 'cost':
            // 🔧 修复(2025-12-29): 确保数值类型比较
            aVal = Number(a.performance?.costBase ?? a.performance?.costLocal ?? a.performance?.costUsd) || 0
            bVal = Number(b.performance?.costBase ?? b.performance?.costLocal ?? b.performance?.costUsd) || 0
            break
          case 'status':
            aVal = a.status
            bVal = b.status
            break
        }

        if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
        if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
        return 0
      })
    }

    setFilteredCampaigns(result)

    const filterKey = JSON.stringify({ searchQuery, statusFilter, sortField, sortDirection, showDeletedCampaigns })
    const filtersChanged = filterKeyRef.current !== filterKey
    filterKeyRef.current = filterKey

    const filteredTotalPages = Math.max(1, Math.ceil(result.length / pageSize))
    setCurrentPage((prev) => {
      const nextPage = filtersChanged ? 1 : prev
      return nextPage > filteredTotalPages ? filteredTotalPages : nextPage
    })
  }, [campaigns, searchQuery, statusFilter, sortField, sortDirection, pageSize, showDeletedCampaigns, isServerPagingMode, totalPages])

  const buildDateRangeParams = (): URLSearchParams => {
    const params = new URLSearchParams()
    if (timeRange === 'custom') {
      if (appliedCustomRange) {
        params.set('start_date', appliedCustomRange.startDate)
        params.set('end_date', appliedCustomRange.endDate)
      } else {
        params.set('daysBack', '7')
      }
    } else {
      params.set('daysBack', timeRange)
    }

    return params
  }

  const buildCampaignListParams = (options?: {
    ids?: number[]
  }): URLSearchParams => {
    const params = buildDateRangeParams()

    if (options?.ids && options.ids.length > 0) {
      params.set('ids', options.ids.join(','))
      return params
    }

    if (!isServerPagingMode) {
      return params
    }

    params.set('limit', String(pageSize))
    params.set('offset', String((currentPage - 1) * pageSize))
    params.set('showDeleted', String(showDeletedCampaigns))

    const normalizedSearch = (isServerPagingMode ? debouncedSearchQuery : searchQuery).trim()
    if (normalizedSearch) {
      params.set('search', normalizedSearch)
    }

    if (statusFilter !== 'all') {
      params.set('status', statusFilter)
    }

    if (sortField && sortDirection) {
      params.set('sortBy', sortField)
      params.set('sortOrder', sortDirection)
    }

    return params
  }

  const fetchCampaigns = async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true
    const queryString = buildCampaignListParams().toString()
    const dedupKey = queryString

    const executeFetchCampaigns = async () => {
      const requestSeq = campaignsFetchSeqRef.current + 1
      campaignsFetchSeqRef.current = requestSeq
      campaignsFetchAbortRef.current?.abort()
      const abortController = new AbortController()
      campaignsFetchAbortRef.current = abortController

      if (silent) {
        silentRefreshCountRef.current += 1
        setBackgroundRefreshing(true)
      } else {
        setLoading(true)
      }

      try {
        const response = await fetch(`/api/campaigns/performance?${queryString}`, {
          credentials: 'include',
          signal: abortController.signal,
        })

        // 处理401未授权 - 跳转到登录页
        if (response.status === 401) {
          handleUnauthorized()
          return
        }

        if (!response.ok) {
          throw new Error('获取广告系列数据失败')
        }

        const data = await response.json()
        const nextCampaigns = Array.isArray(data.campaigns) ? (data.campaigns as Campaign[]) : []
        const nextTotal = Number.isFinite(Number(data.total)) ? Number(data.total) : nextCampaigns.length

        if (requestSeq !== campaignsFetchSeqRef.current) {
          return
        }

        setCampaigns(nextCampaigns)
        if (isServerPagingMode) {
          setFilteredCampaigns(nextCampaigns)
        }
        // 🔧 修复(2025-12-29): 不要直接设置 filteredCampaigns
        // 让 useEffect 自动应用排序、过滤等处理逻辑
        // setFilteredCampaigns(data.campaigns)
        setSummary(data.summary)
        setServerTotal(nextTotal)
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return
        }
        setError(err.message || '加载失败')
      } finally {
        if (silent) {
          silentRefreshCountRef.current = Math.max(0, silentRefreshCountRef.current - 1)
          if (silentRefreshCountRef.current === 0) {
            setBackgroundRefreshing(false)
          }
        } else {
          if (requestSeq === campaignsFetchSeqRef.current) {
            setLoading(false)
          }
        }
        if (campaignsFetchAbortRef.current === abortController) {
          campaignsFetchAbortRef.current = null
        }
      }
    }

    if (!campaignsReqDedupEnabled) {
      await executeFetchCampaigns()
      return
    }

    const inFlight = campaignsInFlightRef.current.get(dedupKey)
    if (inFlight) {
      await inFlight
      return
    }

    const requestPromise = executeFetchCampaigns()
    campaignsInFlightRef.current.set(dedupKey, requestPromise)
    try {
      await requestPromise
    } finally {
      campaignsInFlightRef.current.delete(dedupKey)
    }
  }

  const fetchTrends = async () => {
    const queryString = buildDateRangeParams().toString()
    const dedupKey = queryString

    const executeFetchTrends = async () => {
      const requestSeq = trendsFetchSeqRef.current + 1
      trendsFetchSeqRef.current = requestSeq
      trendsFetchAbortRef.current?.abort()
      const abortController = new AbortController()
      trendsFetchAbortRef.current = abortController

      try {
        setTrendsLoading(true)
        const response = await fetch(`/api/campaigns/trends?${queryString}`, {
          credentials: 'include',
          signal: abortController.signal,
        })

        // 处理401未授权 - 跳转到登录页
        if (response.status === 401) {
          handleUnauthorized()
          return
        }

        if (!response.ok) {
          throw new Error('获取趋势数据失败')
        }

        const data = await response.json()
        if (requestSeq !== trendsFetchSeqRef.current) {
          return
        }
        setTrendsData(data.trends)
        setTrendsBaseCurrency(String(data.summary?.baseCurrency || 'USD'))
        setTrendsTotalsConverted(data.summary?.totalsConverted || null)
        setTrendsCostsByCurrency(Array.isArray(data.summary?.costsByCurrency) ? data.summary.costsByCurrency : [])
        setTrendsCommissionsByCurrency(Array.isArray(data.summary?.commissionsByCurrency) ? data.summary.commissionsByCurrency : [])
        setTrendsError(null)
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return
        }
        setTrendsError(err.message || '加载趋势数据失败')
      } finally {
        if (requestSeq === trendsFetchSeqRef.current) {
          setTrendsLoading(false)
        }
        if (trendsFetchAbortRef.current === abortController) {
          trendsFetchAbortRef.current = null
        }
      }
    }

    if (!campaignsReqDedupEnabled) {
      await executeFetchTrends()
      return
    }

    const inFlight = trendsInFlightRef.current.get(dedupKey)
    if (inFlight) {
      await inFlight
      return
    }

    const requestPromise = executeFetchTrends()
    trendsInFlightRef.current.set(dedupKey, requestPromise)
    try {
      await requestPromise
    } finally {
      trendsInFlightRef.current.delete(dedupKey)
    }
  }

  const handleBudgetAdjusted = (payload: {
    googleCampaignId: string
    budgetAmount: number
    budgetType: 'DAILY' | 'TOTAL'
  }) => {
    const normalizedBudgetAmount = Number(payload.budgetAmount)
    if (!Number.isFinite(normalizedBudgetAmount) || normalizedBudgetAmount <= 0) return
    const normalizedBudgetType = payload.budgetType === 'TOTAL' ? 'TOTAL' : 'DAILY'

    setCampaigns((prev) =>
      prev.map((campaign) => {
        if (String(getCampaignGoogleId(campaign) || '') !== payload.googleCampaignId) {
          return campaign
        }

        return {
          ...campaign,
          budgetAmount: normalizedBudgetAmount,
          budgetType: normalizedBudgetType,
        }
      })
    )
  }

  const handleCpcAdjusted = async (payload: {
    googleCampaignId: string
    newCpc: number
  }) => {
    const normalizedCpc = Number(payload.newCpc)
    if (!Number.isFinite(normalizedCpc) || normalizedCpc <= 0) return

    setCampaigns((prev) =>
      prev.map((campaign) => {
        if (String(getCampaignGoogleId(campaign) || '') !== payload.googleCampaignId) {
          return campaign
        }

        return {
          ...campaign,
          configuredMaxCpc: normalizedCpc,
        }
      })
    )

    // Keep table data eventually consistent with backend-calculated fields.
    await fetchCampaigns({ silent: true })
  }

  const openDeleteDraftDialog = (campaign: Campaign) => {
    setDeleteDraftTarget(campaign)
    setIsDeleteDraftDialogOpen(true)
  }

  const confirmDeleteDraft = async () => {
    if (!deleteDraftTarget || deleteDraftSubmitting) return

    const campaignId = deleteDraftTarget.id
    const campaignName = deleteDraftTarget.campaignName

    setDeleteDraftSubmitting(true)

    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      // 处理401未授权 - 跳转到登录页
      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || '删除草稿失败')
      }

      applyLocalCampaignDeletion([campaignId])
      showSuccess('删除草稿成功', `已删除草稿广告系列"${campaignName}"`)
      void fetchCampaigns({ silent: true })
    } catch (err: any) {
      showError('删除草稿失败', err?.message || '网络错误')
    } finally {
      setDeleteDraftSubmitting(false)
      setIsDeleteDraftDialogOpen(false)
      setDeleteDraftTarget(null)
    }
  }

  const openDeleteRemovedDialog = (campaign: Campaign) => {
    const isRemovedStatus = String(campaign.status || '').toUpperCase() === 'REMOVED'
    const adsAccountUnavailable = campaign.adsAccountAvailable === false

    if (!isRemovedStatus && !adsAccountUnavailable) {
      showError('无法操作', '仅已移除或Ads账号已解绑的广告系列可删除')
      return
    }

    setDeleteRemovedTarget(campaign)
    setIsDeleteRemovedDialogOpen(true)
  }

  const confirmDeleteRemoved = async () => {
    if (!deleteRemovedTarget || deleteRemovedSubmitting) return

    const campaignId = deleteRemovedTarget.id
    const campaignName = deleteRemovedTarget.campaignName

    setDeleteRemovedSubmitting(true)

    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || '删除广告系列失败')
      }

      applyLocalCampaignDeletion([campaignId])
      showSuccess('删除广告系列成功', `已永久删除"${campaignName}"`)
      void fetchCampaigns({ silent: true })
    } catch (err: any) {
      showError('删除广告系列失败', err?.message || '网络错误')
    } finally {
      setDeleteRemovedSubmitting(false)
      setIsDeleteRemovedDialogOpen(false)
      setDeleteRemovedTarget(null)
    }
  }

  const runOfflineForCampaign = async (
    campaign: Campaign,
    options?: {
      forceLocalOffline?: boolean
      blacklistOffer?: boolean
      pauseClickFarmTasks?: boolean
      pauseUrlSwapTasks?: boolean
      removeGoogleAdsCampaign?: boolean
    }
  ): Promise<OfflineActionResult> => {
    const response = await fetch(`/api/campaigns/${campaign.id}/offline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        blacklistOffer: options?.blacklistOffer ?? false,
        pauseClickFarmTasks: options?.pauseClickFarmTasks ?? false,
        pauseUrlSwapTasks: options?.pauseUrlSwapTasks ?? false,
        removeGoogleAdsCampaign: options?.removeGoogleAdsCampaign ?? false,
        forceLocalOffline: options?.forceLocalOffline ?? false,
      }),
    })

    if (response.status === 401) {
      handleUnauthorized()
      throw new Error('UNAUTHORIZED')
    }

    const data = await response.json().catch(() => null)

    if (response.status === 422 && data?.action === 'ACCOUNT_STATUS_NOT_USABLE') {
      const accountStatus = data?.details?.accountStatus
      return {
        status: 'account_issue',
        message: data?.message || '账号状态异常，无法在 Google Ads 中暂停/删除广告系列。',
        accountStatus: accountStatus ? String(accountStatus) : undefined,
      }
    }

    if (!response.ok) {
      return {
        status: 'error',
        message: data?.error || data?.message || '下线失败',
      }
    }

    return { status: 'success' }
  }

  const mapBatchOfflineFailureCategory = (message: string): string => {
    if (message.includes('尚未发布到Google Ads')) return '未发布到 Google Ads'
    if (message.includes('关联Offer已删除')) return '关联 Offer 已删除'
    if (message.includes('账号状态异常') || message.includes('Ads账号') || message.includes('Ads 账号')) return 'Ads 账号异常'
    if (message.includes('已下线') || message.includes('已删除')) return '已下线/已删除'
    if (message.includes('未授权') || message.includes('UNAUTHORIZED')) return '登录状态失效'
    if (message.includes('网络')) return '网络错误'
    return '其他错误'
  }

  const buildBatchOfflineFailureSummary = (failures: BatchOfflineFailure[]): string => {
    const grouped = new Map<string, { count: number; samples: string[] }>()

    failures.forEach((failure) => {
      const category = mapBatchOfflineFailureCategory(failure.message)
      const current = grouped.get(category) || { count: 0, samples: [] }
      current.count += 1
      if (current.samples.length < 2) {
        current.samples.push(failure.campaignName)
      }
      grouped.set(category, current)
    })

    return Array.from(grouped.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([category, info]) => `- ${category}: ${info.count} 个（示例：${info.samples.join('、')}）`)
      .join('\n')
  }

  const fetchCampaignsByIds = async (ids: number[]): Promise<Campaign[]> => {
    if (ids.length === 0) return []

    const chunks = chunkArray(ids, BATCH_OPERATION_CHUNK_SIZE)
    const merged = new Map<number, Campaign>()

    const chunkRequests = chunks.map(async (chunk) => {
      const queryString = buildCampaignListParams({ ids: chunk }).toString()
      const response = await fetch(`/api/campaigns/performance?${queryString}`, {
        credentials: 'include',
      })

      if (response.status === 401) {
        handleUnauthorized()
        throw new Error('UNAUTHORIZED')
      }

      if (!response.ok) {
        throw new Error('获取已选广告系列失败')
      }

      const data = await response.json()
      return Array.isArray(data.campaigns) ? (data.campaigns as Campaign[]) : []
    })

    const chunkResults = await Promise.all(chunkRequests)
    chunkResults.forEach((campaignList) => {
      campaignList.forEach((campaign) => {
        merged.set(campaign.id, campaign)
      })
    })

    return ids
      .map((id) => merged.get(id))
      .filter((campaign): campaign is Campaign => Boolean(campaign))
  }

  const getSelectedCampaigns = async (): Promise<Campaign[]> => {
    const ids = Array.from(selectedCampaignIds)
    if (ids.length === 0) return []

    if (!isServerPagingMode) {
      const selected = campaigns.filter((campaign) => selectedCampaignIds.has(campaign.id))
      upsertSelectedCampaignSnapshots(selected)
      return selected
    }

    const selected = await fetchCampaignsByIds(ids)
    upsertSelectedCampaignSnapshots(selected)
    return selected
  }

  const getRemovedCampaigns = (list: Campaign[]) =>
    list.filter((campaign) => {
      const isRemovedStatus = String(campaign.status || '').toUpperCase() === 'REMOVED'
      const adsAccountUnavailable = campaign.adsAccountAvailable === false
      return isRemovedStatus || adsAccountUnavailable
    })

  const buildBatchDeleteFailureSummary = (failures: BatchDeleteFailure[]): string =>
    failures
      .slice(0, 3)
      .map((failure) => `- ${failure.campaignName}：${failure.message}`)
      .join('\n')

  const buildBatchAccountStatusSummary = (accountIssues: BatchOfflineAccountIssue[]): string | null => {
    if (accountIssues.length === 0) return null

    const grouped = new Map<string, number>()
    accountIssues.forEach((item) => {
      const status = item.accountStatus || 'UNKNOWN'
      grouped.set(status, (grouped.get(status) || 0) + 1)
    })

    return Array.from(grouped.entries())
      .map(([status, count]) => `${status}（${count}个）`)
      .join('，')
  }

  const buildBatchAccountIssueSampleNames = (
    accountIssues: BatchOfflineAccountIssue[],
    limit: number = 3
  ): string => accountIssues.slice(0, limit).map((item) => item.campaign.campaignName).join('、')

  const executeBatchOffline = async (
    selectedCampaigns: Campaign[],
    options: {
      forceLocalOffline?: boolean
      blacklistOffer: boolean
      pauseClickFarmTasks: boolean
      pauseUrlSwapTasks: boolean
      removeGoogleAdsCampaign: boolean
    }
  ) => {
    const failures: BatchOfflineFailure[] = []
    const accountIssues: BatchOfflineAccountIssue[] = []
    let successCount = 0
    const successCampaignIds: number[] = []
    let unauthorizedDetected = false

    const chunks = chunkArray(selectedCampaigns, BATCH_OPERATION_CHUNK_SIZE)
    for (const campaignChunk of chunks) {
      const offlinePromises = campaignChunk.map(async (campaign) => ({
        campaign,
        result: await runOfflineForCampaign(campaign, options),
      }))
      const results = await Promise.allSettled(offlinePromises)

      results.forEach((item, index) => {
        const fallbackCampaign = campaignChunk[index]

        if (item.status === 'rejected') {
          if (item.reason?.message === 'UNAUTHORIZED') {
            unauthorizedDetected = true
            return
          }

          failures.push({
            campaignName: fallbackCampaign?.campaignName || '未知广告系列',
            message: item.reason?.message || '网络错误',
          })
          return
        }

        const { campaign, result } = item.value
        if (result.status === 'success') {
          successCount += 1
          successCampaignIds.push(campaign.id)
          return
        }

        if (result.status === 'account_issue') {
          accountIssues.push({
            campaign,
            message: result.message,
            accountStatus: result.accountStatus,
          })
          return
        }

        failures.push({
          campaignName: campaign.campaignName,
          message: result.message,
        })
      })

      if (unauthorizedDetected) break
    }

    return {
      successCount,
      successCampaignIds,
      failures,
      accountIssues,
      unauthorizedDetected,
    }
  }

  const openToggleStatusConfirm = (campaign: Campaign) => {
    const isDeleted = campaign.isDeleted === true || campaign.isDeleted === 1
    const offerDeleted = campaign.offerIsDeleted === true || campaign.offerIsDeleted === 1
    const googleCampaignId = getCampaignGoogleId(campaign)

    if (isDeleted || offerDeleted) {
      showError('无法操作', '该广告系列已删除')
      return
    }

    if (!googleCampaignId) {
      showError('无法操作', '该广告系列尚未发布到Google Ads')
      return
    }

    if (campaign.adsAccountAvailable === false) {
      showError('无法操作', '关联的Ads账号不可用（可能已解绑或停用）')
      return
    }

    const currentStatus = String(campaign.status || '').toUpperCase()
    const nextStatus =
      currentStatus === 'ENABLED'
        ? 'PAUSED'
        : currentStatus === 'PAUSED'
          ? 'ENABLED'
          : null

    if (!nextStatus) {
      showError('无法操作', `当前状态(${campaign.status})不支持暂停/启用`)
      return
    }

    setToggleStatusTarget(campaign)
    setToggleStatusNextStatus(nextStatus)
    setIsToggleStatusDialogOpen(true)
  }

  const confirmToggleStatus = async () => {
    if (!toggleStatusTarget || !toggleStatusNextStatus) return
    const campaign = toggleStatusTarget
    const nextStatus = toggleStatusNextStatus

    setIsToggleStatusDialogOpen(false)
    setToggleStatusTarget(null)
    setToggleStatusNextStatus(null)

    await handleToggleStatus(campaign, nextStatus)
  }

  const openOfflineDialog = (campaign: Campaign) => {
    const isDeleted = campaign.isDeleted === true || campaign.isDeleted === 1
    const offerDeleted = campaign.offerIsDeleted === true || campaign.offerIsDeleted === 1
    const googleCampaignId = getCampaignGoogleId(campaign)
    const normalizedCreationStatus = String(campaign.creationStatus || '').toLowerCase()
    const canOfflineWithoutGoogleCampaign = normalizedCreationStatus === 'pending' || normalizedCreationStatus === 'failed'

    if (isDeleted || offerDeleted || String(campaign.status || '').toUpperCase() === 'REMOVED') {
      showError('无法操作', '该广告系列已下线/删除')
      return
    }

    if (!googleCampaignId && !canOfflineWithoutGoogleCampaign) {
      showError('无法操作', '该广告系列尚未发布到Google Ads')
      return
    }

    if (campaign.adsAccountAvailable === false && googleCampaignId) {
      showError('无法操作', '关联的Ads账号不可用（可能已解绑或停用）')
      return
    }

    setOfflineTarget(campaign)
    setOfflineBlacklistOffer(false)
    setOfflinePauseClickFarm(true)
    setOfflinePauseUrlSwap(true)
    setOfflineRemoveGoogleAds(true)
    setIsOfflineDialogOpen(true)
  }

  const confirmOffline = async () => {
    if (!offlineTarget || offlineSubmitting) return
    const campaign = offlineTarget

    setOfflineSubmitting(true)
    setIsOfflineDialogOpen(false)
    let keepState = false

    try {
      const response = await fetch(`/api/campaigns/${campaign.id}/offline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          blacklistOffer: offlineBlacklistOffer,
          pauseClickFarmTasks: offlinePauseClickFarm,
          pauseUrlSwapTasks: offlinePauseUrlSwap,
          removeGoogleAdsCampaign: offlineRemoveGoogleAds,
        }),
      })

      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      const data = await response.json().catch(() => null)
      if (response.status === 422 && data?.action === 'ACCOUNT_STATUS_NOT_USABLE') {
        setOfflineAccountIssueMessage(data?.message || '账号状态异常，无法在 Google Ads 中暂停广告系列。')
        const status = data?.details?.accountStatus
        setOfflineAccountIssueStatus(status ? String(status) : null)
        setIsOfflineAccountIssueDialogOpen(true)
        keepState = true
        return
      }
      if (!response.ok) {
        const message = data?.error || data?.message || '下线失败'
        showError('下线失败', message)
        return
      }

      const actionLabel = data?.googleAds?.action === 'REMOVE' ? '删除' : '暂停'
      const googleAdsNote = data?.googleAds?.queued
        ? `Google Ads ${actionLabel}处理已排队（计划处理 ${data.googleAds?.planned ?? 0} 个广告系列）`
        : data?.googleAds?.skippedReason
          ? `Google Ads 未同步：${data.googleAds.skippedReason}`
          : undefined

      applyLocalCampaignOffline([campaign.id])
      showSuccess('已下线', googleAdsNote)
      void fetchCampaigns({ silent: true })
    } catch (err: any) {
      showError('下线失败', err?.message || '网络错误')
    } finally {
      setOfflineSubmitting(false)
      if (!keepState) {
        setOfflineTarget(null)
        setOfflineBlacklistOffer(false)
        setOfflinePauseClickFarm(false)
        setOfflinePauseUrlSwap(false)
        setOfflineRemoveGoogleAds(false)
        setOfflineAccountIssueMessage(null)
        setOfflineAccountIssueStatus(null)
      }
    }
  }

  const handleOpenBatchOfflineDialog = () => {
    if (!hasBatchOfflineSelection || batchOfflineSubmitting) return

    resetBatchOfflineState()
    setIsBatchOfflineDialogOpen(true)
  }

  const handleOpenBatchDeleteDialog = async () => {
    if (!hasBatchOfflineSelection || batchDeleteSubmitting) return

    try {
      const selectedCampaigns = await getSelectedCampaigns()
      const removedCampaigns = getRemovedCampaigns(selectedCampaigns)
      if (removedCampaigns.length === 0) {
        showError('批量删除失败', '仅已移除或Ads账号已解绑的广告系列可批量删除')
        return
      }

      setIsBatchDeleteDialogOpen(true)
    } catch (err: any) {
      if (err?.message === 'UNAUTHORIZED') return
      showError('批量删除失败', err?.message || '未能加载选中广告系列')
    }
  }

  const handleBatchDeleteRemoved = async () => {
    if (!hasBatchOfflineSelection || batchDeleteSubmitting) return
    try {
      const selectedCampaigns = await getSelectedCampaigns()
      if (selectedCampaigns.length === 0) {
        showError('批量删除失败', '未找到可操作的广告系列')
        return
      }

      const removedCampaigns = getRemovedCampaigns(selectedCampaigns)
      if (removedCampaigns.length === 0) {
        showError('批量删除失败', '仅已移除或Ads账号已解绑的广告系列可批量删除')
        return
      }

      setBatchDeleteSubmitting(true)
      setIsBatchDeleteDialogOpen(false)

      const successIds: number[] = []
      const failures: BatchDeleteFailure[] = []
      let unauthorizedDetected = false

      const chunks = chunkArray(removedCampaigns, BATCH_OPERATION_CHUNK_SIZE)
      for (const campaignChunk of chunks) {
        const deletePromises = campaignChunk.map(async (campaign) => {
          const response = await fetch(`/api/campaigns/${campaign.id}`, {
            method: 'DELETE',
            credentials: 'include',
          })

          if (response.status === 401) {
            handleUnauthorized()
            throw new Error('UNAUTHORIZED')
          }

          if (!response.ok) {
            const data = await response.json().catch(() => null)
            throw new Error(data?.error || '删除失败')
          }

          return campaign.id
        })

        const results = await Promise.allSettled(deletePromises)
        results.forEach((item, index) => {
          const campaign = campaignChunk[index]
          if (item.status === 'fulfilled') {
            successIds.push(item.value)
            return
          }

          if (item.reason?.message === 'UNAUTHORIZED') {
            unauthorizedDetected = true
            return
          }

          failures.push({
            campaignName: campaign?.campaignName || '未知广告系列',
            message: item.reason?.message || '网络错误',
          })
        })

        if (unauthorizedDetected) break
      }

      if (unauthorizedDetected) return

      if (successIds.length > 0) {
        applyLocalCampaignDeletion(successIds)
        void fetchCampaigns({ silent: true })
      }

      const skippedCount = selectedCampaigns.length - removedCampaigns.length
      if (failures.length === 0) {
        const desc = skippedCount > 0
          ? `已删除 ${successIds.length} 个广告系列，跳过 ${skippedCount} 个不可删除的广告系列`
          : `已删除 ${successIds.length} 个广告系列`
        showSuccess('批量删除成功', desc)
        return
      }

      if (successIds.length > 0) {
        showSuccess('批量删除部分成功', `已删除 ${successIds.length} 个广告系列`)
      }

      const failureSummary = buildBatchDeleteFailureSummary(failures)
      const skippedNote = skippedCount > 0
        ? `\n另有 ${skippedCount} 个不可删除的广告系列已跳过。`
        : ''

      showError(
        '批量删除失败',
        `${failures.length}/${removedCampaigns.length} 个广告系列删除失败：\n${failureSummary}${skippedNote}`
      )
    } catch (err: any) {
      if (err?.message === 'UNAUTHORIZED') return
      showError('批量删除失败', err?.message || '网络错误')
    } finally {
      setBatchDeleteSubmitting(false)
    }
  }

  const handleBatchOffline = async () => {
    if (selectedCampaignIds.size === 0 || batchOfflineSubmitting) return
    try {
      const selectedCampaigns = await getSelectedCampaigns()
      if (selectedCampaigns.length === 0) {
        showError('批量下线失败', '未找到可操作的广告系列')
        return
      }

      setBatchOfflineSubmitting(true)
      setIsBatchOfflineDialogOpen(false)

      const execution = await executeBatchOffline(selectedCampaigns, {
        blacklistOffer: batchOfflineBlacklistOffer,
        pauseClickFarmTasks: batchOfflinePauseClickFarm,
        pauseUrlSwapTasks: batchOfflinePauseUrlSwap,
        removeGoogleAdsCampaign: batchOfflineRemoveGoogleAds,
      })

      if (execution.unauthorizedDetected) {
        return
      }

      if (execution.successCampaignIds.length > 0) {
        applyLocalCampaignOffline(execution.successCampaignIds)
        void fetchCampaigns({ silent: true })
      }

      if (execution.accountIssues.length > 0) {
        setBatchOfflinePendingState({
          totalCount: selectedCampaigns.length,
          successCount: execution.successCount,
          failures: execution.failures,
          accountIssues: execution.accountIssues,
        })
        setIsBatchOfflineAccountIssueDialogOpen(true)
        return
      }

      if (execution.failures.length > 0) {
        if (execution.successCount > 0) {
          showSuccess('批量下线部分成功', `已下线 ${execution.successCount} 个广告系列`)
        }
        const groupedSummary = buildBatchOfflineFailureSummary(execution.failures)
        showError(
          '批量下线失败',
          `${execution.failures.length}/${selectedCampaigns.length} 个广告系列下线失败：\n${groupedSummary}`
        )
        return
      }

      setSelectedCampaignIds(new Set())
      setSelectedCampaignSnapshots({})
      resetBatchOfflineState()
      showSuccess('批量下线成功', `已下线 ${selectedCampaigns.length} 个广告系列`)
    } catch (err: any) {
      if (err?.message === 'UNAUTHORIZED') return
      showError('批量下线失败', err?.message || '网络错误')
    } finally {
      setBatchOfflineSubmitting(false)
    }
  }

  const confirmBatchOfflineLocalOnly = async () => {
    if (!batchOfflinePendingState || batchOfflineSubmitting) return

    const pendingState = batchOfflinePendingState
    const accountIssueCampaigns = pendingState.accountIssues.map((item) => item.campaign)

    if (accountIssueCampaigns.length === 0) {
      setIsBatchOfflineAccountIssueDialogOpen(false)
      resetBatchOfflineState()
      return
    }

    setBatchOfflineSubmitting(true)
    setIsBatchOfflineAccountIssueDialogOpen(false)

    try {
      const retry = await executeBatchOffline(accountIssueCampaigns, {
        forceLocalOffline: true,
        blacklistOffer: batchOfflineBlacklistOffer,
        pauseClickFarmTasks: batchOfflinePauseClickFarm,
        pauseUrlSwapTasks: batchOfflinePauseUrlSwap,
        removeGoogleAdsCampaign: batchOfflineRemoveGoogleAds,
      })

      if (retry.unauthorizedDetected) {
        return
      }

      const combinedFailures: BatchOfflineFailure[] = [...pendingState.failures, ...retry.failures]
      if (retry.accountIssues.length > 0) {
        retry.accountIssues.forEach((item) => {
          combinedFailures.push({
            campaignName: item.campaign.campaignName,
            message: item.message || '账号状态异常，且本地下线未完成',
          })
        })
      }

      const combinedSuccessCount = pendingState.successCount + retry.successCount

      if (retry.successCampaignIds.length > 0) {
        applyLocalCampaignOffline(retry.successCampaignIds)
        void fetchCampaigns({ silent: true })
      }

      if (combinedFailures.length > 0) {
        if (combinedSuccessCount > 0) {
          showSuccess('批量下线部分成功', `已下线 ${combinedSuccessCount} 个广告系列`)
        }
        const groupedSummary = buildBatchOfflineFailureSummary(combinedFailures)
        showError(
          '批量下线失败',
          `${combinedFailures.length}/${pendingState.totalCount} 个广告系列下线失败：\n${groupedSummary}`
        )
        return
      }

      setSelectedCampaignIds(new Set())
      setSelectedCampaignSnapshots({})
      showSuccess('批量下线成功', `已下线 ${combinedSuccessCount} 个广告系列`)
    } catch (err: any) {
      showError('批量下线失败', err?.message || '网络错误')
    } finally {
      setBatchOfflineSubmitting(false)
      resetBatchOfflineState()
    }
  }

  const confirmOfflineLocalOnly = async () => {
    if (!offlineTarget || offlineSubmitting) return
    const campaign = offlineTarget

    setOfflineSubmitting(true)
    setIsOfflineAccountIssueDialogOpen(false)

    try {
      const response = await fetch(`/api/campaigns/${campaign.id}/offline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          blacklistOffer: offlineBlacklistOffer,
          pauseClickFarmTasks: offlinePauseClickFarm,
          pauseUrlSwapTasks: offlinePauseUrlSwap,
          removeGoogleAdsCampaign: offlineRemoveGoogleAds,
          forceLocalOffline: true,
        }),
      })

      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      const data = await response.json().catch(() => null)
      if (!response.ok) {
        const message = data?.error || data?.message || '本地下线失败'
        showError('本地下线失败', message)
        return
      }

      const googleAdsNote = data?.googleAds?.skippedReason
        ? `Google Ads 未同步：${data.googleAds.skippedReason}`
        : undefined

      applyLocalCampaignOffline([campaign.id])
      showSuccess('已本地下线', googleAdsNote)
      void fetchCampaigns({ silent: true })
    } catch (err: any) {
      showError('本地下线失败', err?.message || '网络错误')
    } finally {
      setOfflineSubmitting(false)
      setOfflineTarget(null)
      setOfflineBlacklistOffer(false)
      setOfflinePauseClickFarm(false)
      setOfflinePauseUrlSwap(false)
      setOfflineRemoveGoogleAds(false)
      setOfflineAccountIssueMessage(null)
      setOfflineAccountIssueStatus(null)
    }
  }

  const handleToggleStatus = async (
    campaign: Campaign,
    nextStatusOverride?: 'PAUSED' | 'ENABLED'
  ) => {
    const isDeleted = campaign.isDeleted === true || campaign.isDeleted === 1
    const offerDeleted = campaign.offerIsDeleted === true || campaign.offerIsDeleted === 1
    const googleCampaignId = getCampaignGoogleId(campaign)

    if (isDeleted || offerDeleted) {
      showError('无法操作', '该广告系列已删除')
      return
    }

    if (!googleCampaignId) {
      showError('无法操作', '该广告系列尚未发布到Google Ads')
      return
    }

    if (campaign.adsAccountAvailable === false) {
      showError('无法操作', '关联的Ads账号不可用（可能已解绑或停用）')
      return
    }

    const currentStatus = String(campaign.status || '').toUpperCase()
    if (currentStatus !== 'ENABLED' && currentStatus !== 'PAUSED') {
      showError('无法操作', `当前状态(${campaign.status})不支持暂停/启用`)
      return
    }

    const nextStatus = nextStatusOverride || (currentStatus === 'ENABLED' ? 'PAUSED' : 'ENABLED')

    setStatusUpdatingIds((prev) => {
      const next = new Set(prev)
      next.add(campaign.id)
      return next
    })

    try {
      const response = await fetch(`/api/campaigns/${campaign.id}/toggle-status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: nextStatus }),
      })

      // 处理401未授权 - 跳转到登录页
      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      const data = await response.json().catch(() => null)

      if (!response.ok) {
        const message = data?.error || data?.message || '操作失败'
        if (data?.needsReauth) {
          showError('Google Ads 授权已过期', message)
        } else {
          showError('操作失败', message)
        }
        return
      }

      // 本地更新状态（避免整页重刷）
      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === campaign.id
            ? { ...c, status: data?.status || nextStatus }
            : c
        )
      )

      showSuccess(nextStatus === 'PAUSED' ? '已暂停' : '已启用', campaign.campaignName)
    } catch (err: any) {
      showError('操作失败', err?.message || '网络错误')
    } finally {
      setStatusUpdatingIds((prev) => {
        const next = new Set(prev)
        next.delete(campaign.id)
        return next
      })
    }
  }

  // 获取当前页的广告系列
  const paginatedCampaigns = isServerPagingMode
    ? filteredCampaigns
    : filteredCampaigns.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  // 全选/取消全选
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const currentPageIds = paginatedCampaigns.map((campaign) => campaign.id)
      const currentPageIdSet = new Set(currentPageIds)
      const currentSelectedCount = selectedCampaignIds.size
      const alreadySelectedOnPage = currentPageIds.filter((id) => selectedCampaignIds.has(id)).length
      const canAddCount = Math.max(0, MAX_SELECTED_CAMPAIGNS - currentSelectedCount)
      const selectableOnPage = currentPageIds.filter((id) => !selectedCampaignIds.has(id))

      if (selectableOnPage.length > canAddCount) {
        showError('选择数量超限', `最多可选择 ${MAX_SELECTED_CAMPAIGNS} 个广告系列`)
      }

      const idsToAdd = selectableOnPage.slice(0, canAddCount)
      const nextSelected = new Set(selectedCampaignIds)
      idsToAdd.forEach((id) => nextSelected.add(id))
      setSelectedCampaignIds(nextSelected)

      if (idsToAdd.length > 0 || alreadySelectedOnPage > 0) {
        setSelectedCampaignSnapshots((prev) => {
          const next = { ...prev }
          paginatedCampaigns.forEach((campaign) => {
            if (currentPageIdSet.has(campaign.id) && nextSelected.has(campaign.id)) {
              next[campaign.id] = {
                id: campaign.id,
                campaignName: campaign.campaignName,
                status: campaign.status,
              }
            }
          })
          return next
        })
      }
    } else {
      const pageIds = paginatedCampaigns.map((campaign) => campaign.id)
      if (pageIds.length === 0) return
      const pageIdSet = new Set(pageIds)

      setSelectedCampaignIds((prev) => {
        const next = new Set(prev)
        pageIds.forEach((id) => next.delete(id))
        return next
      })
      removeSelectedCampaignSnapshots(Array.from(pageIdSet))
    }
  }

  // 单选切换
  const handleSelectCampaign = (campaign: Campaign, checked: boolean) => {
    const campaignId = campaign.id
    const newSelected = new Set(selectedCampaignIds)
    if (checked) {
      if (newSelected.has(campaignId)) return
      if (newSelected.size >= MAX_SELECTED_CAMPAIGNS) {
        showError('选择数量超限', `最多可选择 ${MAX_SELECTED_CAMPAIGNS} 个广告系列`)
        return
      }
      newSelected.add(campaignId)
      setSelectedCampaignSnapshots((prev) => ({
        ...prev,
        [campaignId]: {
          id: campaignId,
          campaignName: campaign.campaignName,
          status: campaign.status,
        },
      }))
    } else {
      newSelected.delete(campaignId)
      removeSelectedCampaignSnapshots([campaignId])
    }
    setSelectedCampaignIds(newSelected)
  }

  const getStatusBadge = (status: string, adsAccountAvailable?: boolean) => {
    if (adsAccountAvailable === false) {
      return (
        <Badge variant="outline" className="flex items-center gap-1 w-fit whitespace-nowrap border-orange-200 text-orange-800 bg-orange-50">
          <AlertCircle className="w-3 h-3" />
          账号已解绑
        </Badge>
      )
    }

    const configs = {
      ENABLED: { label: getCampaignStatusLabel('ENABLED'), variant: 'default' as const, icon: PlayCircle, className: 'bg-green-600 hover:bg-green-700' },
      PAUSED: { label: getCampaignStatusLabel('PAUSED'), variant: 'secondary' as const, icon: PauseCircle, className: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200' },
      REMOVED: { label: getCampaignStatusLabel('REMOVED'), variant: 'destructive' as const, icon: XCircle, className: '' },
    }
    const config = configs[status as keyof typeof configs] || { label: status, variant: 'outline' as const, icon: AlertCircle, className: '' }
    const Icon = config.icon

    return (
      <Badge variant={config.variant} className={`flex items-center gap-0.5 w-fit whitespace-nowrap text-[11px] px-1.5 py-0 ${config.className}`}>
        <Icon className="w-3 h-3" />
        {config.label}
      </Badge>
    )
  }

  // 排序处理函数
  const handleSort = (field: SortField) => {
    if (isServerPagingMode && currentPage !== 1) {
      setCurrentPage(1)
    }

    if (sortField === field) {
      // 如果点击的是当前排序字段，切换排序方向
      if (sortDirection === 'asc') {
        setSortDirection('desc')
      } else if (sortDirection === 'desc') {
        setSortDirection(null)
        setSortField(null)
      } else {
        setSortDirection('asc')
      }
    } else {
      // 如果点击的是新字段，设置为升序
      setSortField(field)
      setSortDirection('asc')
    }
  }

  // 可排序表头组件
  const SortableHeader = ({ field, children, className = '' }: { field: SortField; children: React.ReactNode; className?: string }) => {
    const isActive = sortField === field
    return (
      <TableHead className={`cursor-pointer select-none hover:bg-gray-50 ${className}`} onClick={() => handleSort(field)}>
        <div className="flex items-center gap-0.5">
          {children}
          {isActive ? (
            sortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />
          ) : (
            <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
          )}
        </div>
      </TableHead>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold text-gray-900">广告系列管理</h1>
              <Badge variant="outline" className="text-sm">
                {visibleCampaignCount}
              </Badge>
              {backgroundRefreshing && (
                <span className="inline-flex items-center text-xs text-gray-500">
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  后台更新中
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {/* 批量删除按钮 - 多选后显示，仅已移除或账号已解绑可删除 */}
              {hasBatchOfflineSelection && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void handleOpenBatchDeleteDialog()}
                  disabled={batchDeleteSubmitting || selectedRemovedCampaignCount === 0}
                  title={selectedRemovedCampaignCount > 0 ? '批量删除已移除或账号已解绑的广告系列' : '仅已移除或账号已解绑的广告系列可删除'}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {batchDeleteSubmitting
                    ? '批量删除中...'
                    : `批量删除 (${selectedRemovedCampaignCount})`}
                </Button>
              )}
              {/* 批量下线按钮 - 有选中项时显示 */}
              {hasBatchOfflineSelection && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleOpenBatchOfflineDialog}
                  disabled={batchOfflineSubmitting}
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  {batchOfflineSubmitting
                    ? '批量下线中...'
                    : `批量下线 (${selectedCampaignIds.size})`}
                </Button>
              )}
              <Button onClick={() => router.push('/offers')}>
                创建广告系列
              </Button>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-full mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* Summary Statistics with comparison */}
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">总展示次数</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {(summary.totalImpressions ?? 0).toLocaleString()}
                    </p>
                    {summary.changes?.impressions !== null && summary.changes?.impressions !== undefined && (
                      <p className={`text-xs mt-1 ${summary.changes.impressions >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {summary.changes.impressions >= 0 ? '↑' : '↓'} {Math.abs(summary.changes.impressions).toFixed(1)}% 环比
                      </p>
                    )}
                  </div>
                  <div className="h-12 w-12 bg-blue-100 rounded-full flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">总点击次数</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {(summary.totalClicks ?? 0).toLocaleString()}
                    </p>
                    {summary.changes?.clicks !== null && summary.changes?.clicks !== undefined && (
                      <p className={`text-xs mt-1 ${summary.changes.clicks >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {summary.changes.clicks >= 0 ? '↑' : '↓'} {Math.abs(summary.changes.clicks).toFixed(1)}% 环比
                      </p>
                    )}
                  </div>
                  <div className="h-12 w-12 bg-green-100 rounded-full flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6 text-green-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">总花费({trendsCurrencyValue})</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {formatCurrencyDashboard(
                        Number(trendsTotalsConverted?.cost ?? summaryTotalCostDisplay),
                        String(trendsCurrencyValue || defaultCurrency)
                      )}
                    </p>
                    {costBreakdown.length > 0 && (
                      <p className="text-xs mt-1 text-gray-500">
                        分币种: {formatMultiCurrency(costBreakdown)}
                      </p>
                    )}
                    {summary?.currency !== 'MIXED' && summary.changes?.cost !== null && summary.changes?.cost !== undefined && (
                      <p className={`text-xs mt-1 ${summary.changes.cost <= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {summary.changes.cost >= 0 ? '↑' : '↓'} {Math.abs(summary.changes.cost).toFixed(1)}% 环比
                      </p>
                    )}
                  </div>
                  <div className="h-12 w-12 bg-orange-100 rounded-full flex items-center justify-center">
                    <Coins className="w-6 h-6 text-orange-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">总佣金({trendsCurrencyValue})</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {formatCurrencyDashboard(
                        Number(trendsTotalsConverted?.commission ?? summaryTotalCommissionDisplay),
                        String(trendsCurrencyValue || defaultCurrency)
                      )}
                    </p>
                    {summary?.currency !== 'MIXED' ? (
                      <>
                        <p className="text-xs mt-1 text-gray-500">
                          可归因: {formatCurrencyDashboard(
                            summaryAttributedCommissionDisplay,
                            summaryDisplayCurrency
                          )}
                        </p>
                        <p className={`text-xs mt-1 ${summaryUnattributedCommission > 0 ? 'text-amber-600' : 'text-gray-500'}`}>
                          未归因: {formatCurrencyDashboard(
                            summaryUnattributedCommissionDisplay,
                            summaryDisplayCurrency
                          )}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-xs mt-1 text-gray-500">
                          可归因: {formatCurrencyWithCode(mixedAttributedCommissionBreakdown, summaryDisplayCurrency)}
                        </p>
                        <p className={`text-xs mt-1 ${mixedUnattributedCommissionBreakdown.length > 0 ? 'text-amber-600' : 'text-gray-500'}`}>
                          未归因: {formatCurrencyWithCode(mixedUnattributedCommissionBreakdown, summaryDisplayCurrency)}
                        </p>
                      </>
                    )}
                    {summary?.currency !== 'MIXED' && summary.changes?.conversions !== null && summary.changes?.conversions !== undefined && (
                      <p className={`text-xs mt-1 ${summary.changes.conversions >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {summary.changes.conversions >= 0 ? '↑' : '↓'} {Math.abs(summary.changes.conversions).toFixed(1)}% 环比
                      </p>
                    )}
                  </div>
                  <div className="h-12 w-12 bg-purple-100 rounded-full flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-purple-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">ROAS</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {Number.isFinite(Number(trendsTotalsConverted?.roas))
                        ? `${Number(trendsTotalsConverted?.roas).toFixed(2)}x`
                        : formatSummaryRoas(summary)}
                    </p>
                    {summary.currency === 'MIXED' ? (
                      <p className="text-xs mt-1 text-gray-500">-- 环比</p>
                    ) : summary.changes?.roasInfinite ? (
                      <p className="text-xs mt-1 text-green-600">↑ ∞ 环比</p>
                    ) : summary.changes?.roas !== null && summary.changes?.roas !== undefined ? (
                      <p className={`text-xs mt-1 ${Number(summary.changes.roas) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {Number(summary.changes.roas) >= 0 ? '↑' : '↓'} {formatSummaryRoasChange(summary)} 环比
                      </p>
                    ) : (
                      <p className="text-xs mt-1 text-gray-500">-- 环比</p>
                    )}
                  </div>
                  <div className="h-12 w-12 bg-indigo-100 rounded-full flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-indigo-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Trends Charts - 分组展示 */}
        <div className="mb-6">
          {/* 统一的时间范围选择器 */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">性能趋势</h3>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">时间范围:</span>
              <div className="flex gap-1">
                {(['7', '14', '30'] as const).map((days) => (
                  <Button
                    key={days}
                    size="sm"
                    variant={timeRange === days ? 'default' : 'ghost'}
                    className={`h-8 px-3 text-sm ${timeRange === days ? '' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    onClick={() => selectPresetTimeRange(days)}
                    aria-label={`${days}天`}
                  >
                    <span className="sm:hidden">{days}</span>
                    <span className="hidden sm:inline">{days}天</span>
                  </Button>
                ))}
                <DateRangePicker
                  value={dateRange}
                  onChange={handleDateRangeChange}
                  placeholder={customRangeLabel}
                  variant={timeRange === 'custom' ? 'default' : 'ghost'}
                  size="sm"
                  maxDate={new Date()}
                  showPresets={false}
                  showClearButton={true}
                  compact={true}
                  className="max-w-[190px]"
                />
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            {trendsOverviewDescription}
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
            {/* 流量趋势 - 2/5 (柱状图，双Y轴：展示在左轴，点击/佣金在右轴) */}
            <div className="lg:col-span-2">
              <TrendChart
                data={trendsData}
                metrics={trafficTrendMetrics}
                title="流量趋势"
                description={trafficTrendDescription}
                loading={trendsLoading}
                error={trendsError}
                onRetry={() => void fetchTrends()}
                height={220}
                hideTimeRangeSelector={true}
                chartType="bar"
                dualYAxis={true}
                headerActions={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setExpandedTrendChart('traffic')}
                    title="放大趋势图"
                    aria-label="放大流量趋势图"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                }
              />
            </div>

            {/* 成本趋势 - 2/5 (柱状+折线：花费/佣金在左轴，CPC/ROAS在右轴) */}
            <div className="lg:col-span-2">
              <TrendChart
                data={trendsData}
                metrics={costTrendMetrics}
                title="成本趋势"
                description={costTrendDescription}
                loading={trendsLoading}
                error={trendsError}
                onRetry={() => void fetchTrends()}
                height={220}
                hideTimeRangeSelector={true}
                chartType="mixed"
                dualYAxis={true}
                headerActions={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setExpandedTrendChart('cost')}
                    title="放大趋势图"
                    aria-label="放大成本趋势图"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                }
              />
            </div>

            {/* 效率指标卡片 + 状态分布卡片 - 1/5 */}
            <div className="lg:col-span-1 flex flex-col gap-4">
              {/* 效率指标卡片 */}
              <Card>
                <CardContent className="pt-4 pb-4">
                  <h4 className="text-sm font-medium text-gray-600 mb-3">效率指标</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">平均CTR</span>
                      <span className="text-sm font-semibold text-gray-900">
                        {trendsData.length > 0
                          ? `${(trendsData.reduce((sum, d) => sum + ((d.ctr as number) || 0), 0) / trendsData.length).toFixed(2)}%`
                          : '0.00%'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">平均CPC({trendsCurrencyValue})</span>
                      <span className="text-sm font-semibold text-gray-900">
                        {trendsData.length > 0
                          ? formatTrendsMoney(Number(trendsTotalsConverted?.cpc ?? 0))
                          : formatTrendsMoney(0)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">平均ROAS</span>
                      <span className="text-sm font-semibold text-gray-900">
                        {trendsData.length > 0
                          ? `${Number(trendsTotalsConverted?.roas ?? 0).toFixed(2)}x`
                          : '0.00x'}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* 状态分布卡片 */}
              <Card>
                <CardContent className="pt-4 pb-4">
                  <h4 className="text-sm font-medium text-gray-600 mb-3">广告系列状态</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
                        <span className="text-xs text-gray-600">投放中</span>
                      </div>
                      <span className="text-sm font-semibold text-gray-900">
                        {enabledCampaignCount}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-yellow-500"></div>
                        <span className="text-xs text-gray-600">已暂停</span>
                      </div>
                      <span className="text-sm font-semibold text-gray-900">
                        {pausedCampaignCount}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
                        <span className="text-xs text-gray-600">已移除</span>
                      </div>
                      <span className="text-sm font-semibold text-gray-900">
                        {removedCampaignCount}
                      </span>
                    </div>
                    <div className="border-t pt-2 mt-2 flex justify-between items-center">
                      <span className="text-xs font-medium text-gray-700">总计</span>
                      <span className="text-sm font-bold text-gray-900">{totalCampaignCount}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center gap-3">
              {/* Search */}
              <div className="relative w-full md:flex-1 md:min-w-[300px]">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="搜索广告系列名称或ID..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value)
                    if (isServerPagingMode && currentPage !== 1) {
                      setCurrentPage(1)
                    }
                  }}
                  className="pl-10"
                />
              </div>

              {/* Status Filter */}
              <div className="w-full sm:w-[220px] md:w-[200px]">
                <Select
                  value={statusFilter}
                  onValueChange={(value) => {
                    setStatusFilter(value)
                    if (isServerPagingMode && currentPage !== 1) {
                      setCurrentPage(1)
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="投放状态" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">所有投放状态</SelectItem>
                    <SelectItem value="ENABLED">{getCampaignStatusLabel('ENABLED')}</SelectItem>
                    <SelectItem value="PAUSED">{getCampaignStatusLabel('PAUSED')}</SelectItem>
                    <SelectItem value="REMOVED">{getCampaignStatusLabel('REMOVED')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center px-3 py-2 border border-gray-200 rounded-md bg-gray-50 md:ml-auto">
                <span className="text-xs text-gray-500 whitespace-nowrap mr-2">
                  数据同步时间（北京时间）
                </span>
                <span className="text-xs font-medium text-gray-700 whitespace-nowrap">
                  {latestCampaignSyncLabel}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {/* Content */}
        {filteredCampaigns.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow border border-gray-200">
            <div className="mx-auto h-12 w-12 text-gray-400 mb-4">
              <Search className="w-full h-full" />
            </div>
            <h3 className="text-lg font-medium text-gray-900">未找到广告系列</h3>
            <p className="mt-2 text-sm text-gray-500">
              {activeCampaignCount === 0
                ? "您还没有创建任何广告系列，请前往Offer列表创建。"
                : "没有找到符合筛选条件的广告系列。"}
            </p>
            {activeCampaignCount === 0 && (
              <div className="mt-6">
                <Button onClick={() => router.push('/offers')}>
                  前往Offer列表
                </Button>
              </div>
            )}
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table className="min-w-[1260px] [&_th]:h-9 [&_th]:px-1 [&_td]:px-1 [&_td]:py-1.5 [&_thead_th]:bg-white">
                  <TableHeader>
                    <TableRow>
                      {/* 全选checkbox */}
                      <TableHead className="w-[30px]">
                        <Checkbox
                          checked={
                            paginatedCampaigns.length > 0 &&
                            paginatedCampaigns.every((campaign) => selectedCampaignIds.has(campaign.id))
                          }
                          onCheckedChange={handleSelectAll}
                          aria-label="全选"
                        />
                      </TableHead>
                      <SortableHeader field="campaignName" className="w-[300px] whitespace-nowrap">系列名称</SortableHeader>
                      <TableHead className="w-[92px] min-w-[92px] max-w-[92px] whitespace-nowrap">关联Ads账号</TableHead>
                      <SortableHeader field="budgetAmount" className="w-[86px] whitespace-nowrap">预算</SortableHeader>
                      <SortableHeader field="impressions" className="w-[58px] whitespace-nowrap !px-0.5">展示</SortableHeader>
                      <SortableHeader field="clicks" className="w-[58px] whitespace-nowrap !px-0.5">点击</SortableHeader>
                      <SortableHeader field="ctr" className="w-[56px] whitespace-nowrap !px-0.5">点击率</SortableHeader>
                      <SortableHeader field="cpc" className="w-[94px] whitespace-nowrap !px-0.5">实际CPC</SortableHeader>
                      <SortableHeader field="configuredMaxCpc" className="w-[94px] whitespace-nowrap !px-0.5">配置CPC</SortableHeader>
                      <SortableHeader field="conversions" className="w-[94px] whitespace-nowrap !px-0.5">佣金</SortableHeader>
                      <SortableHeader field="cost" className="w-[94px] whitespace-nowrap !px-0.5">花费</SortableHeader>
                      <SortableHeader field="roas" className="w-[62px] whitespace-nowrap !px-0.5">ROAS</SortableHeader>
                      <SortableHeader field="status" className="w-[78px] whitespace-nowrap">投放状态</SortableHeader>
                      <SortableHeader field="servingStartDate" className="w-[74px] whitespace-nowrap">投放日期</SortableHeader>
                      <TableHead className="w-[48px] whitespace-nowrap text-center">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                <TableBody>
                    {paginatedCampaigns.map((campaign) => {
                      // 🔧 检查是否已删除 (兼容PostgreSQL的boolean和SQLite的number)
                      const isDeleted = isCampaignDeleted(campaign)
                      const offerDeleted = isOfferDeleted(campaign)
                      const googleCampaignId = getCampaignGoogleId(campaign)
                      const isStatusUpdating = statusUpdatingIds.has(campaign.id)
                      const budgetCurrency = campaign.adsAccountCurrency || defaultCurrency
                      const performanceCurrency = campaign.performanceCurrency || campaign.adsAccountCurrency || defaultCurrency
                        const adsAccountName = String(campaign.adsAccountName || '').trim()
                        const adsAccountCustomerId = String(campaign.adsAccountCustomerId || '').trim()
                        const shouldHideAdsAccount = isDeleted
                        const adsAccountDisplayName = shouldHideAdsAccount
                          ? '-'
                          : (adsAccountName || adsAccountCustomerId || '-')
                        const adsAccountDisplayId = shouldHideAdsAccount
                          ? ''
                          : (
                            adsAccountCustomerId
                            || (campaign.googleAdsAccountId !== null && campaign.googleAdsAccountId !== undefined
                              ? String(campaign.googleAdsAccountId)
                              : '')
                          )

                          const canAdjustCpc = Boolean(googleCampaignId) && !isDeleted && !offerDeleted && campaign.adsAccountAvailable !== false
                          const adjustCpcDisabledReason = !googleCampaignId
                            ? '该广告系列尚未发布到Google Ads，无法调整CPC'
                            : campaign.adsAccountAvailable === false
                              ? 'Ads账号已解绑，无法调整CPC'
                              : isDeleted
                                ? '该广告系列已删除，无法调整CPC'
                                : offerDeleted
                                  ? '关联Offer已删除，无法调整CPC'
                                  : '调整CPC出价'
                          const canAdjustBudget = Boolean(googleCampaignId) && !isDeleted && !offerDeleted && campaign.adsAccountAvailable !== false
                          const adjustBudgetDisabledReason = !googleCampaignId
                            ? '该广告系列尚未发布到Google Ads，无法调整每日预算'
                            : campaign.adsAccountAvailable === false
                              ? 'Ads账号已解绑，无法调整每日预算'
                              : isDeleted
                                ? '该广告系列已删除，无法调整每日预算'
                                : offerDeleted
                                  ? '关联Offer已删除，无法调整每日预算'
                                  : '调整每日预算'

                        const canToggleStatus = !isStatusUpdating && Boolean(googleCampaignId) && !isDeleted && !offerDeleted && campaign.adsAccountAvailable !== false && (campaign.status === 'ENABLED' || campaign.status === 'PAUSED')
                        const toggleLabel = campaign.status === 'ENABLED' ? '暂停广告系列' : '启用广告系列'
                        const toggleDisabledReason = isStatusUpdating
                          ? '操作中...'
                          : !googleCampaignId
                            ? '该广告系列尚未发布到Google Ads，无法暂停/启用'
                            : campaign.adsAccountAvailable === false
                              ? 'Ads账号已解绑，无法暂停/启用'
                              : isDeleted
                                ? '该广告系列已删除，无法暂停/启用'
                                : offerDeleted
                                  ? '关联Offer已删除，无法暂停/启用'
                                  : (campaign.status !== 'ENABLED' && campaign.status !== 'PAUSED')
                                    ? `当前状态(${campaign.status})不支持暂停/启用`
                                    : toggleLabel

                        const normalizedCreationStatus = String(campaign.creationStatus || '').toLowerCase()
                        const canOfflineWithoutGoogleCampaign = normalizedCreationStatus === 'pending' || normalizedCreationStatus === 'failed'
                        const canOffline = !offlineSubmitting
                          && !isDeleted
                          && !offerDeleted
                          && String(campaign.status || '').toUpperCase() !== 'REMOVED'
                          && (Boolean(googleCampaignId) || canOfflineWithoutGoogleCampaign)
                          && (googleCampaignId ? campaign.adsAccountAvailable !== false : true)
                        const offlineDisabledReason = isDeleted
                          ? '该广告系列已删除，无法下线'
                          : offerDeleted
                            ? '关联Offer已删除，无法下线'
                            : String(campaign.status || '').toUpperCase() === 'REMOVED'
                              ? '该广告系列已下线'
                              : (!googleCampaignId && !canOfflineWithoutGoogleCampaign)
                                ? '该广告系列尚未发布到Google Ads，且不在可下线状态（pending/failed）'
                                : (googleCampaignId && campaign.adsAccountAvailable === false)
                                  ? 'Ads账号已解绑，无法下线'
                                  : '下线广告系列（不可恢复）'

                        const canDeleteDraft = campaign.creationStatus === 'draft'
                        const canDeleteDraftAction = canDeleteDraft && !deleteDraftSubmitting
                        const isRemovedStatus = String(campaign.status || '').toUpperCase() === 'REMOVED'
                        const canDeleteRemovedAction = (isRemovedStatus || campaign.adsAccountAvailable === false) && !deleteRemovedSubmitting
                        const campaignRoas = formatCampaignRoas(campaign)
                        const configuredMaxCpc = Number(campaign.configuredMaxCpc)
                        const hasConfiguredMaxCpc = Number.isFinite(configuredMaxCpc) && configuredMaxCpc > 0


                        return (
                    <TableRow
                      key={campaign.id}
                      className={`hover:bg-gray-50/50 ${isDeleted || offerDeleted ? 'bg-gray-50' : ''}`}
                    >
                      {/* 选择checkbox */}
                      <TableCell>
                        <Checkbox
                          checked={selectedCampaignIds.has(campaign.id)}
                          onCheckedChange={(checked) => handleSelectCampaign(campaign, checked as boolean)}
                          aria-label={`选择 ${campaign.campaignName}`}
                          title="加入批量下线"
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <div className="font-medium text-gray-900 whitespace-nowrap" title={campaign.campaignName}>
                            {campaign.campaignName}
                          </div>
                          {isDeleted && (
                            <span
                              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-600 shrink-0"
                              title="已删除"
                              aria-label="已删除"
                            >
                              <Trash2 className="h-3 w-3" />
                            </span>
                          )}
                          {offerDeleted && !isDeleted && (
                            <Badge variant="outline" className="text-xs whitespace-nowrap bg-orange-50 text-orange-700 border-orange-200 shrink-0">
                              Offer已删除
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="w-[92px] min-w-[92px] max-w-[92px] whitespace-nowrap">
                        <div className="w-[92px] min-w-[92px] max-w-[92px] overflow-hidden">
                          <div className="font-medium text-gray-900 truncate" title={adsAccountDisplayName}>
                            {adsAccountDisplayName}
                          </div>
                          {!shouldHideAdsAccount && adsAccountDisplayId && (
                            <div className="text-[11px] text-gray-500 font-mono leading-none mt-0.5 truncate" title={adsAccountDisplayId}>
                              {adsAccountDisplayId}
                            </div>
                          )}
                          {!shouldHideAdsAccount && campaign.adsAccountAvailable === false && (
                            <Badge variant="outline" className="mt-0.5 text-[10px] px-1 py-0 whitespace-nowrap border-orange-200 text-orange-700 bg-orange-50">
                              已解绑
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 truncate" title={formatMoney(Number(campaign.budgetAmount) || 0, budgetCurrency)}>
                            {formatMoney(Number(campaign.budgetAmount) || 0, budgetCurrency)}
                          </div>
                          <Badge variant="outline" className="mt-0.5 text-[10px] px-1 py-0 whitespace-nowrap border-gray-200 text-gray-600">
                            {campaign.budgetType}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap !px-0.5">
                        <div className="font-medium text-gray-900">
                          {campaign.performance?.impressions?.toLocaleString() || '0'}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap !px-0.5">
                        <div className="font-medium text-gray-900">
                          {campaign.performance?.clicks?.toLocaleString() || '0'}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap !px-0.5">
                        <div className="font-medium text-gray-900">
                          {(Number(campaign.performance?.ctr) || 0).toFixed(2)}%
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap !px-0.5">
                        <div className="font-medium text-gray-900">
                          {formatMoney(Number(campaign.performance?.cpcLocal ?? campaign.performance?.cpcUsd) || 0, performanceCurrency)}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap !px-0.5">
                        <div className="font-medium text-gray-900">
                          {hasConfiguredMaxCpc
                            ? formatMoney(configuredMaxCpc, budgetCurrency)
                            : '-'}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap !px-0.5">
                        <div className="font-medium text-gray-900">
                          {formatMoney(Number(campaign.performance?.commission ?? campaign.performance?.conversions) || 0, performanceCurrency)}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap !px-0.5">
                        <div className="font-medium text-gray-900">
                          {formatMoney(Number(campaign.performance?.costLocal ?? campaign.performance?.costUsd) || 0, performanceCurrency)}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap !px-0.5">
                        <div className="font-medium text-gray-900">
                          {campaignRoas}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {getStatusBadge(campaign.status, campaign.adsAccountAvailable)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className="text-sm text-gray-900">
                          {campaign.servingStartDate || '-'}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              aria-label="更多操作"
                              title="更多操作"
                            >
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40">
                            <DropdownMenuItem
                              className="gap-2"
                              onClick={() => router.push(`/offers/${campaign.offerId}`)}
                            >
                              <Package className="w-4 h-4 text-green-600" />
                              <span>查看关联Offer</span>
                            </DropdownMenuItem>

                              <DropdownMenuItem
                                className="gap-2"
                                onClick={() => {
                                  if (!googleCampaignId) return
                                  if (campaign.adsAccountAvailable === false) return
                                  setAdjustBudgetTarget({
                                    googleCampaignId,
                                    campaignName: campaign.campaignName,
                                    currentBudget: Number(campaign.budgetAmount) || 0,
                                    currentBudgetType: String(campaign.budgetType || 'DAILY'),
                                    currency: budgetCurrency,
                                  })
                                  setAdjustBudgetOpen(true)
                                }}
                                disabled={!canAdjustBudget}
                                title={adjustBudgetDisabledReason}
                              >
                                <Wallet className="w-4 h-4 text-emerald-600" />
                                <span>调整每日预算</span>
                              </DropdownMenuItem>

                              <DropdownMenuItem
                                className="gap-2"
                                onClick={() => {
                                  if (!googleCampaignId) return
                                if (campaign.adsAccountAvailable === false) return
                                setAdjustCpcTarget({ googleCampaignId, campaignName: campaign.campaignName })
                                setAdjustCpcOpen(true)
                              }}
                              disabled={!canAdjustCpc}
                              title={adjustCpcDisabledReason}
                            >
                              <Coins className="w-4 h-4 text-indigo-600" />
                              <span>调整CPC</span>
                            </DropdownMenuItem>

                            <DropdownMenuItem
                              className="gap-2"
                              onClick={() => void openToggleStatusConfirm(campaign)}
                              disabled={!canToggleStatus}
                              title={toggleDisabledReason}
                            >
                              {isStatusUpdating ? (
                                <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                              ) : campaign.status === 'ENABLED' ? (
                                <PauseCircle className="w-4 h-4 text-yellow-600" />
                              ) : (
                                <PlayCircle className="w-4 h-4 text-green-600" />
                              )}
                              <span>{isStatusUpdating ? '状态更新中' : toggleLabel}</span>
                            </DropdownMenuItem>

                            <DropdownMenuItem
                              className="gap-2"
                              onClick={() => openOfflineDialog(campaign)}
                              disabled={!canOffline}
                              title={offlineDisabledReason}
                            >
                              <XCircle className="w-4 h-4 text-red-600" />
                              <span>下线广告系列</span>
                            </DropdownMenuItem>

                            {(isRemovedStatus || campaign.adsAccountAvailable === false || canDeleteDraft) && <DropdownMenuSeparator />}

                            {(isRemovedStatus || campaign.adsAccountAvailable === false) && (
                              <DropdownMenuItem
                                className="gap-2"
                                onClick={() => openDeleteRemovedDialog(campaign)}
                                disabled={!canDeleteRemovedAction}
                                title={canDeleteRemovedAction ? '永久删除广告系列（本地删除，不再调用 Google Ads）' : '删除中...'}
                              >
                                <Trash2 className="w-4 h-4 text-red-600" />
                                <span>删除广告系列</span>
                              </DropdownMenuItem>
                            )}

                            {canDeleteDraft && (
                              <DropdownMenuItem
                                className="gap-2"
                                onClick={() => openDeleteDraftDialog(campaign)}
                                disabled={!canDeleteDraftAction}
                                title={canDeleteDraftAction ? '删除草稿广告系列' : '删除中...'}
                              >
                                <Trash2 className="w-4 h-4 text-red-600" />
                                <span>删除草稿</span>
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className='gap-2'
                              title='补点击任务'
                              disabled={clickFarmLoading}
                              onClick={
                                async () => {
                                  setClickFarmLoading(true)
                                  try {
                                    const { resolveClickFarmTaskMode } = await import('../offers/task-modal-helpers')
                                    const { editTaskId, infoMessage } = await resolveClickFarmTaskMode(campaign.offerId)
                                    setSelectedOfferForClickFarm(campaign)
                                    setEditTaskIdForClickFarm(editTaskId)
                                    if (infoMessage) {
                                      showInfo(infoMessage)
                                    }
                                    setIsClickFarmModalOpen(true)
                                  } catch (error) {
                                    console.error('查询补点击任务出错:', error)
                                    setSelectedOfferForClickFarm(campaign)
                                    setEditTaskIdForClickFarm(undefined)
                                    setIsClickFarmModalOpen(true)
                                  } finally {
                                    setClickFarmLoading(false)
                                  }
                                }
                              }
                            >
                              <span className="text-[10px] font-semibold text-gray-500">CLK</span>
                              <span>补点击任务</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className='gap-2'
                              title='换链接任务'
                              disabled={urlSwapLoading || !campaign.adsAccountAvailable}
                              onClick={
                                async () => {
                                  setUrlSwapLoading(true)
                                  try {
                                    const { resolveUrlSwapTaskMode } = await import('../offers/task-modal-helpers')
                                    const { editTaskId, infoMessage } = await resolveUrlSwapTaskMode(campaign.offerId)
                                    setSelectedOfferForUrlSwap(campaign)
                                    setEditTaskIdForUrlSwap(
                                      editTaskId === undefined ? undefined : String(editTaskId)
                                    )
                                    if (infoMessage) {
                                      showInfo(infoMessage)
                                    }
                                    setIsUrlSwapModalOpen(true)
                                  } catch (error) {
                                    console.error('查询换链接任务出错:', error)
                                    setSelectedOfferForUrlSwap(campaign)
                                    setEditTaskIdForUrlSwap(undefined)
                                    setIsUrlSwapModalOpen(true)
                                  } finally {
                                    setUrlSwapLoading(false)
                                  }
                                }
                              }
                            >
                              <span className="text-[10px] font-semibold text-gray-500">URL</span>
                              <span>换链接任务</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )})}
                </TableBody>
              </Table>
              </div>
              {/* Pagination Controls - Bottom */}
              {filteredCampaigns.length > 0 && (
                <div className="px-4 py-3 border-t border-gray-200">
                  <ResponsivePagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    totalItems={totalItems}
                    pageSize={pageSize}
                    onPageChange={setCurrentPage}
                    onPageSizeChange={(size) => { setPageSize(size); setCurrentPage(1); }}
                    pageSizeOptions={[10, 20, 50, 100, 500, 1000]}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}
        </main>

        {/* Adjust Budget Dialog */}
        {adjustBudgetTarget && (
          <AdjustCampaignBudgetDialog
            open={adjustBudgetOpen}
            onOpenChange={(nextOpen: boolean) => {
              setAdjustBudgetOpen(nextOpen)
              if (!nextOpen) setAdjustBudgetTarget(null)
            }}
            googleCampaignId={adjustBudgetTarget.googleCampaignId}
            campaignName={adjustBudgetTarget.campaignName}
            currentBudget={adjustBudgetTarget.currentBudget}
            currentBudgetType={adjustBudgetTarget.currentBudgetType}
            currency={adjustBudgetTarget.currency}
            onSaved={handleBudgetAdjusted}
          />
        )}

        {/* Adjust CPC Dialog */}
        {adjustCpcTarget && (
          <AdjustCampaignCpcDialog
            open={adjustCpcOpen}
            onOpenChange={(nextOpen: boolean) => {
              setAdjustCpcOpen(nextOpen)
              if (!nextOpen) setAdjustCpcTarget(null)
            }}
            googleCampaignId={adjustCpcTarget.googleCampaignId}
            campaignName={adjustCpcTarget.campaignName}
            onSaved={handleCpcAdjusted}
          />
        )}

      {/* Trend Expand Dialog */}
      <Dialog
        open={expandedTrendChart !== null}
        onOpenChange={(open) => {
          if (!open) setExpandedTrendChart(null)
        }}
      >
        <DialogContent className="w-[96vw] max-w-[96vw] sm:max-w-[96vw] lg:max-w-[1280px] xl:max-w-[1440px] max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{expandedTrendChart === 'traffic' ? '流量趋势（放大）' : '成本趋势（放大）'}</DialogTitle>
          </DialogHeader>
          {expandedTrendChart === 'traffic' && (
            <TrendChart
              data={trendsData}
              metrics={trafficTrendMetrics}
              title="流量趋势"
              description={trafficTrendDescription}
              loading={trendsLoading}
              error={trendsError}
              onRetry={() => void fetchTrends()}
              height={expandedTrendChartHeight}
              hideTimeRangeSelector={true}
              chartType="bar"
              dualYAxis={true}
            />
          )}
          {expandedTrendChart === 'cost' && (
            <TrendChart
              data={trendsData}
              metrics={costTrendMetrics}
              title="成本趋势"
              description={costTrendDescription}
              loading={trendsLoading}
              error={trendsError}
              onRetry={() => void fetchTrends()}
              height={expandedTrendChartHeight}
              hideTimeRangeSelector={true}
              chartType="mixed"
              dualYAxis={true}
            />
          )}
        </DialogContent>
      </Dialog>

        {/* Toggle Status Confirmation Dialog */}
        <AlertDialog
          open={isToggleStatusDialogOpen}
          onOpenChange={(open) => {
            setIsToggleStatusDialogOpen(open)
            if (!open) {
              setToggleStatusTarget(null)
              setToggleStatusNextStatus(null)
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {toggleStatusNextStatus === 'PAUSED' ? '确认暂停广告系列' : '确认启用广告系列'}
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>
                    确认要将广告系列{' '}
                    <strong className="text-gray-900">{toggleStatusTarget?.campaignName || '-'}</strong>{' '}
                    {toggleStatusNextStatus
                      ? `切换为「${getCampaignStatusLabel(toggleStatusNextStatus)}」吗？`
                      : '进行状态切换吗？'}
                  </p>

                  {toggleStatusNextStatus === 'PAUSED' ? (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                      <p className="font-medium mb-1">暂停后将会：</p>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>停止在 Google Ads 的投放</li>
                        <li>避免继续产生花费</li>
                        <li>可随时重新启用恢复投放</li>
                      </ul>
                    </div>
                  ) : (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
                      <p className="font-medium mb-1">启用后将会：</p>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>恢复在 Google Ads 的投放</li>
                        <li>可能立即开始产生花费</li>
                        <li>请确认预算与出价设置无误</li>
                      </ul>
                    </div>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <Button
                onClick={() => void confirmToggleStatus()}
                className={
                  toggleStatusNextStatus === 'PAUSED'
                    ? 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-600'
                    : 'bg-green-600 hover:bg-green-700 focus:ring-green-600'
                }
              >
                {toggleStatusNextStatus === 'PAUSED' ? '确认暂停' : '确认启用'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      {/* Batch Delete Confirmation Dialog */}
      <AlertDialog
        open={isBatchDeleteDialogOpen}
        onOpenChange={(open) => {
          setIsBatchDeleteDialogOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量删除广告系列</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  将永久删除选中项中状态为"已移除"或"账号已解绑"的{' '}
                  <strong className="text-gray-900">{selectedRemovedCampaignCount}</strong>{' '}
                  个广告系列。
                </p>
                {selectedCampaignIds.size > selectedRemovedCampaignCount && (
                  <p className="text-sm text-amber-700">
                    另外 {selectedCampaignIds.size - selectedRemovedCampaignCount} 个不可删除的广告系列会被自动跳过。
                  </p>
                )}
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                  <p className="font-medium mb-1">批量删除将会：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>永久删除这些广告系列</li>
                    <li>删除后不再显示在当前列表</li>
                    <li>此操作不可恢复</li>
                  </ul>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchDeleteSubmitting}>取消</AlertDialogCancel>
            <Button
              onClick={() => void handleBatchDeleteRemoved()}
              disabled={batchDeleteSubmitting || selectedRemovedCampaignCount === 0}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {batchDeleteSubmitting ? '删除中...' : `确认批量删除 (${selectedRemovedCampaignCount})`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Batch Offline Confirmation Dialog */}
      <AlertDialog
        open={isBatchOfflineDialogOpen}
        onOpenChange={(open) => {
          setIsBatchOfflineDialogOpen(open)
          if (!open && !batchOfflineSubmitting) {
            resetBatchOfflineState()
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量下线广告系列</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  您确定要下线选中的{' '}
                  <strong className="text-gray-900">{selectedCampaignIds.size}</strong>{' '}
                  个广告系列吗？
                </p>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                  <p className="font-medium mb-1">批量下线将会：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>逐个下线选中的广告系列</li>
                    <li>在 Google Ads 中暂停这些广告系列（可选删除）</li>
                    <li>此操作不可恢复</li>
                  </ul>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={batchOfflineRemoveGoogleAds}
                    onCheckedChange={(checked) => setBatchOfflineRemoveGoogleAds(Boolean(checked))}
                    id="batch-offline-remove-google-ads"
                  />
                  <label htmlFor="batch-offline-remove-google-ads" className="text-sm text-gray-700">
                    同时在 Google Ads 中删除这些广告系列（不可恢复）
                  </label>
                </div>
                <div className="text-sm font-semibold text-red-700">
                  以下选项会影响对应 Offer
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={batchOfflineBlacklistOffer}
                    onCheckedChange={(checked) => setBatchOfflineBlacklistOffer(Boolean(checked))}
                    id="batch-offline-blacklist-offer"
                  />
                  <label htmlFor="batch-offline-blacklist-offer" className="text-sm text-gray-700">
                    同时拉黑对应 Offer（品牌+国家组合）
                  </label>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={batchOfflinePauseClickFarm}
                    onCheckedChange={(checked) => setBatchOfflinePauseClickFarm(Boolean(checked))}
                    id="batch-offline-pause-click-farm"
                  />
                  <label htmlFor="batch-offline-pause-click-farm" className="text-sm text-gray-700">
                    同时暂停补点击任务
                  </label>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={batchOfflinePauseUrlSwap}
                    onCheckedChange={(checked) => setBatchOfflinePauseUrlSwap(Boolean(checked))}
                    id="batch-offline-pause-url-swap"
                  />
                  <label htmlFor="batch-offline-pause-url-swap" className="text-sm text-gray-700">
                    同时暂停换链接任务
                  </label>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchOfflineSubmitting}>取消</AlertDialogCancel>
            <Button
              onClick={() => void handleBatchOffline()}
              disabled={batchOfflineSubmitting || selectedCampaignIds.size === 0}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {batchOfflineSubmitting ? '下线中...' : `确认批量下线 (${selectedCampaignIds.size})`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Batch Offline Account Issue Dialog */}
      <AlertDialog
        open={isBatchOfflineAccountIssueDialogOpen}
        onOpenChange={(open) => {
          setIsBatchOfflineAccountIssueDialogOpen(open)
          if (!open && !batchOfflineSubmitting) {
            resetBatchOfflineState()
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>部分账号状态异常</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  有{' '}
                  <strong className="text-gray-900">{batchOfflinePendingState?.accountIssues.length || 0}</strong>{' '}
                  个广告系列因 Ads 账号状态异常，无法在 Google Ads 中{batchOfflineRemoveGoogleAds ? '删除' : '暂停'}。
                </p>
                <p>
                  {batchOfflinePendingState?.accountIssues[0]?.message || '是否继续仅本地下线这些广告系列？'}
                </p>
                {batchOfflinePendingState && batchOfflinePendingState.accountIssues.length > 0 && (
                  <div className="text-sm text-gray-700">
                    示例广告系列：
                    <strong>{buildBatchAccountIssueSampleNames(batchOfflinePendingState.accountIssues)}</strong>
                  </div>
                )}
                {batchOfflinePendingState && buildBatchAccountStatusSummary(batchOfflinePendingState.accountIssues) && (
                  <div className="text-sm text-gray-700">
                    账号状态分布：
                    <strong>{buildBatchAccountStatusSummary(batchOfflinePendingState.accountIssues)}</strong>
                  </div>
                )}
                {batchOfflinePendingState && batchOfflinePendingState.failures.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                    已有 {batchOfflinePendingState.failures.length} 个广告系列因其他原因下线失败，
                    将在本次完成后统一汇总提示。
                  </div>
                )}
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                  <p className="font-medium mb-1">继续本地下线将会：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>仅在本地标记这些广告系列为已下线</li>
                    <li>无法保证 Google Ads 侧立即停止投放</li>
                    <li>请尽快登录 Google Ads 处理账号状态与广告系列</li>
                  </ul>
                </div>
                <div className="text-sm font-semibold text-red-700">
                  以下选项会影响对应 Offer
                </div>
                <div className="text-sm text-gray-700">
                  当前选择：
                  Google Ads 侧{batchOfflineRemoveGoogleAds ? '删除' : '暂停'}，
                  {batchOfflineBlacklistOffer ? '拉黑Offer' : '不拉黑Offer'}，
                  {batchOfflinePauseClickFarm ? '暂停补点击任务' : '不暂停补点击任务'}，
                  {batchOfflinePauseUrlSwap ? '暂停换链接任务' : '不暂停换链接任务'}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchOfflineSubmitting}>取消</AlertDialogCancel>
            <Button
              onClick={() => void confirmBatchOfflineLocalOnly()}
              disabled={batchOfflineSubmitting || !batchOfflinePendingState}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {batchOfflineSubmitting ? '处理中...' : '仅本地下线异常项'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Removed Campaign Confirmation Dialog */}
      <AlertDialog
        open={isDeleteRemovedDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteRemovedDialogOpen(open)
          if (!open && !deleteRemovedSubmitting) {
            setDeleteRemovedTarget(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除广告系列</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  您确定要永久删除广告系列{' '}
                  <strong className="text-gray-900">{deleteRemovedTarget?.campaignName || '-'}</strong> 吗？
                </p>
                <p className="text-sm text-red-700">
                  此操作会从列表中彻底移除，不可恢复。
                </p>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                  <p className="font-medium mb-1">删除后将会：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>从广告系列列表中彻底移除</li>
                    <li>仅删除本地记录，不会触发新的 Google Ads 操作（包含 Ads 账号已解绑的广告系列）</li>
                    <li>此操作不可恢复</li>
                  </ul>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteRemovedSubmitting}>取消</AlertDialogCancel>
            <Button
              onClick={() => void confirmDeleteRemoved()}
              disabled={deleteRemovedSubmitting || !deleteRemovedTarget}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleteRemovedSubmitting ? '删除中...' : '确认删除'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Draft Confirmation Dialog */}
      <AlertDialog
        open={isDeleteDraftDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteDraftDialogOpen(open)
          if (!open && !deleteDraftSubmitting) {
            setDeleteDraftTarget(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除草稿广告系列</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  您确定要删除草稿广告系列{' '}
                  <strong className="text-gray-900">{deleteDraftTarget?.campaignName || '-'}</strong> 吗？
                </p>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                  <p className="font-medium mb-1">删除后将会：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>永久删除该本地草稿广告系列</li>
                    <li>不会触发 Google Ads 侧投放变化</li>
                    <li>此操作不可恢复</li>
                  </ul>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteDraftSubmitting}>取消</AlertDialogCancel>
            <Button
              onClick={() => void confirmDeleteDraft()}
              disabled={deleteDraftSubmitting || !deleteDraftTarget}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleteDraftSubmitting ? '删除中...' : '确认删除'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Offline Confirmation Dialog */}
      <AlertDialog
        open={isOfflineDialogOpen}
        onOpenChange={(open) => {
          setIsOfflineDialogOpen(open)
          if (!open) {
            setOfflineTarget(null)
            setOfflineBlacklistOffer(false)
            setOfflinePauseClickFarm(false)
            setOfflinePauseUrlSwap(false)
            setOfflineRemoveGoogleAds(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认下线广告系列</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  您确定要下线广告系列{' '}
                  <strong className="text-gray-900">{offlineTarget?.campaignName || '-'}</strong> 吗？
                </p>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                  <p className="font-medium mb-1">下线将会：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>在 Google Ads 中暂停该广告系列（可选删除）</li>
                    <li>仅下线当前广告系列，不影响同 Offer 下其他广告系列</li>
                    <li>此操作不可恢复</li>
                  </ul>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={offlineRemoveGoogleAds}
                    onCheckedChange={(checked) => setOfflineRemoveGoogleAds(Boolean(checked))}
                    id="offline-remove-google-ads"
                  />
                  <label htmlFor="offline-remove-google-ads" className="text-sm text-gray-700">
                    同时在 Google Ads 中删除该广告系列（不可恢复）
                  </label>
                </div>
                <div className="text-sm font-semibold text-red-700">
                  以下选项会影响整个 Offer
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={offlineBlacklistOffer}
                    onCheckedChange={(checked) => setOfflineBlacklistOffer(Boolean(checked))}
                    id="offline-blacklist-offer"
                  />
                  <label htmlFor="offline-blacklist-offer" className="text-sm text-gray-700">
                    同时拉黑该 Offer（品牌+国家组合）
                  </label>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={offlinePauseClickFarm}
                    onCheckedChange={(checked) => setOfflinePauseClickFarm(Boolean(checked))}
                    id="offline-pause-click-farm"
                  />
                  <label htmlFor="offline-pause-click-farm" className="text-sm text-gray-700">
                    同时暂停补点击任务
                  </label>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={offlinePauseUrlSwap}
                    onCheckedChange={(checked) => setOfflinePauseUrlSwap(Boolean(checked))}
                    id="offline-pause-url-swap"
                  />
                  <label htmlFor="offline-pause-url-swap" className="text-sm text-gray-700">
                    同时暂停换链接任务
                  </label>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={offlineSubmitting}>取消</AlertDialogCancel>
            <Button
              onClick={() => void confirmOffline()}
              disabled={offlineSubmitting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {offlineSubmitting ? '下线中...' : '确认下线'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Offline Account Issue Dialog */}
      <AlertDialog
        open={isOfflineAccountIssueDialogOpen}
        onOpenChange={(open) => {
          setIsOfflineAccountIssueDialogOpen(open)
          if (!open) {
            setOfflineAccountIssueMessage(null)
            setOfflineAccountIssueStatus(null)
            setOfflineTarget(null)
            setOfflineBlacklistOffer(false)
            setOfflinePauseClickFarm(false)
            setOfflinePauseUrlSwap(false)
            setOfflineRemoveGoogleAds(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>账号状态异常</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {offlineAccountIssueMessage || '当前 Ads 账号状态异常，无法在 Google Ads 中暂停/删除广告系列。'}
                </p>
                {offlineAccountIssueStatus && (
                  <div className="text-sm text-gray-700">
                    当前账号状态：<strong>{offlineAccountIssueStatus}</strong>
                  </div>
                )}
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                  <p className="font-medium mb-1">继续本地下线将会：</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>仅在本地标记该广告系列为已下线（不影响同 Offer 下其他广告系列）</li>
                    <li>无法保证 Google Ads 侧立即停止投放</li>
                    <li>请尽快登录 Google Ads 处理账号状态与广告系列</li>
                  </ul>
                </div>
                <div className="text-sm font-semibold text-red-700">
                  以下选项会影响整个 Offer
                </div>
                <div className="text-sm text-gray-700">
                  当前选择：
                  Google Ads 侧{offlineRemoveGoogleAds ? '删除' : '暂停'}，
                  {offlineBlacklistOffer ? '拉黑Offer' : '不拉黑Offer'}，
                  {offlinePauseClickFarm ? '暂停补点击任务' : '不暂停补点击任务'}，
                  {offlinePauseUrlSwap ? '暂停换链接任务' : '不暂停换链接任务'}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={offlineSubmitting}>取消</AlertDialogCancel>
            <Button
              onClick={() => void confirmOfflineLocalOnly()}
              disabled={offlineSubmitting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {offlineSubmitting ? '处理中...' : '仅本地下线'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* 补点击任务Modal */}
      {(isClickFarmModalOpen || selectedOfferForClickFarm) && (
        <ClickFarmTaskModal
          open={isClickFarmModalOpen}
          onOpenChange={(open) => {
            setIsClickFarmModalOpen(open)
            if (!open) {
              setSelectedOfferForClickFarm(null)
              setEditTaskIdForClickFarm(undefined)
            }
          }}
          onSuccess={() => {
            // 任务创建/更新成功后可以选择刷新列表或显示提示
          }}
          preSelectedOfferId={selectedOfferForClickFarm?.offerId}
          editTaskId={editTaskIdForClickFarm}
        />
      )}

      {/* 换链接任务Modal */}
      {(isUrlSwapModalOpen || selectedOfferForUrlSwap) && (
        <UrlSwapTaskModal
          open={isUrlSwapModalOpen}
          onOpenChange={(open) => {
            setIsUrlSwapModalOpen(open)
            if (!open) {
              setSelectedOfferForUrlSwap(null)
              setEditTaskIdForUrlSwap(undefined)
            }
          }}
          onSuccess={() => {
            // 任务创建/更新成功后可以选择刷新列表或显示提示
          }}
          offerId={selectedOfferForUrlSwap?.offerId}
          editTaskId={editTaskIdForUrlSwap}
        />
      )}
    </div>
  )
}
