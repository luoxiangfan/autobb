'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { showSuccess, showError, showInfo } from '@/lib/common'
import { GOOGLE_ADS_CAMPAIGN_PIPELINE_IDLE_EVENT } from '@/lib/google-ads/campaign/sync-events'
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
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Search,
  Trash2,
  AlertCircle,
  CheckCircle2,
  PlayCircle,
  PauseCircle,
  XCircle,
  TrendingUp,
  Coins,
  Loader2,
  BarChart3,
} from 'lucide-react'
import type { TrendChartData, TrendChartMetric } from '@/components/charts/TrendChart'
import type { DateRange } from '@/components/ui/date-range-picker'
import { getCampaignStatusLabel } from '@/lib/common'
import { formatToggleStatusWarnings } from './toggle-status-warning'
import {
  campaignHasBoundOffer,
  isCampaignEnabled,
  resolveOfferTasksToggleAction,
  type OfferTasksToggleAction,
} from '@/lib/offers'
import { CampaignsActionDialogs } from './CampaignsActionDialogs'
import { CampaignOverallRoasDialog } from './CampaignOverallRoasDialog'
import { CampaignsTable } from './CampaignsTable'
import { convertAmountForDisplay, formatCurrencyWithCode } from './campaign-metrics-utils'
import type { CampaignSortDirection, CampaignSortField } from './types'
import { formatCurrency } from '@/lib/common'
import { formatCurrency as formatCurrencyDashboard, formatMultiCurrency } from '@/lib/common'

const CampaignsTrendsSection = dynamic(() => import('./CampaignsTrendsSection'), {
  ssr: false,
  loading: () => <CampaignsTrendsSectionSkeleton />,
})
const AdjustCampaignCpcDialog = dynamic(() => import('@/components/AdjustCampaignCpcDialog'), {
  ssr: false,
})
const AdjustCampaignBudgetDialog = dynamic(
  () => import('@/components/AdjustCampaignBudgetDialog'),
  { ssr: false }
)
const ClickFarmTaskModal = dynamic(() => import('@/components/ClickFarmTaskModal'), { ssr: false })
const UrlSwapTaskModal = dynamic(() => import('@/components/UrlSwapTaskModal'), { ssr: false })
const BatchTasksDialog = dynamic(() => import('@/components/BatchTasksDialog'), { ssr: false })

interface Campaign {
  id: number
  offerId: number
  googleAdsAccountId: number | null
  adsAccountCustomerId?: string | null
  adsAccountName?: string | null
  googleCampaignId?: string | null
  campaignId: string | null
  campaignName: string
  customName: string | null
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
  // 软删除状态字段
  isDeleted?: boolean | number
  deletedAt?: string | null
  offerIsDeleted?: boolean | number
  offerSyncSource: string
  needsOfferCompletion: boolean
  clickFarmTaskStatus: string | null
  urlSwapTaskStatus: string | null
  statusCategory: string
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

interface CampaignsClientPageProps {
  defaultTimeRange?: '7' | '14' | '30'
  createdAtStart?: string
  createdAtEnd?: string
  pageTitle?: string
}

type SelectedCampaignSnapshot = {
  id: number
  campaignName: string
  status: string
}

function CampaignsTrendsSectionSkeleton() {
  return (
    <div className="mb-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="h-8 w-32 rounded bg-gray-100" />
        <div className="h-9 w-72 rounded bg-gray-100" />
      </div>
      <div className="mb-3 h-4 w-64 rounded bg-gray-100" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardContent className="pt-6">
            <div className="animate-pulse space-y-3">
              <div className="h-5 w-24 rounded bg-gray-100" />
              <div className="h-[220px] rounded bg-gray-100" />
            </div>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardContent className="pt-6">
            <div className="animate-pulse space-y-3">
              <div className="h-5 w-24 rounded bg-gray-100" />
              <div className="h-[220px] rounded bg-gray-100" />
            </div>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="animate-pulse space-y-2">
                <div className="h-4 w-20 rounded bg-gray-100" />
                <div className="h-3 w-full rounded bg-gray-100" />
                <div className="h-3 w-5/6 rounded bg-gray-100" />
                <div className="h-3 w-4/6 rounded bg-gray-100" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="animate-pulse space-y-2">
                <div className="h-4 w-20 rounded bg-gray-100" />
                <div className="h-3 w-full rounded bg-gray-100" />
                <div className="h-3 w-5/6 rounded bg-gray-100" />
                <div className="h-3 w-4/6 rounded bg-gray-100" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

const MAX_SELECTED_CAMPAIGNS = 500
const BATCH_OPERATION_CHUNK_SIZE = 100
const DEFAULT_STATUS_FILTER = 'ENABLED'

function areUserFilterSelectionsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((id, index) => id === sortedB[index])
}

export default function CampaignsClientPage({
  defaultTimeRange,
  createdAtStart,
  createdAtEnd,
  pageTitle = '广告系列管理',
}: CampaignsClientPageProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
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
  const [statusFilter, setStatusFilter] = useState<string>(DEFAULT_STATUS_FILTER)
  const [needsOfferCompletionFilter, setNeedsOfferCompletionFilter] = useState<string>('all') // 'all' | 'true' | 'false'
  const [statusCategoryFilter, setStatusCategoryFilter] = useState<string>('all') // 'all' | 'pending' | 'watching' | 'qualified'
  const [selectedUserFilters, setSelectedUserFilters] = useState<string[]>([]) // [] => all users
  const [pendingUserFilters, setPendingUserFilters] = useState<string[]>([])
  const [userFilterMenuOpen, setUserFilterMenuOpen] = useState(false)
  const [users, setUsers] = useState<Array<{ id: number; username: string; email: string }>>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [isAdmin, setIsAdmin] = useState<boolean>(false)
  const [affiliateFilter, setAffiliateFilter] = useState<string>('all') // 'all' | affiliate platform
  const [affiliates, setAffiliates] = useState<Array<{ name: string; count: number }>>([])
  const [affiliatesLoading, setAffiliatesLoading] = useState(false)

  // 从 URL 参数或 props 读取默认时间范围
  const getTimeRangeFromUrl = () => {
    try {
      const param = searchParams?.get('timeRange')
      if (param === '7' || param === '14' || param === '30') {
        return param
      }
    } catch {
      // ignore
    }
    return defaultTimeRange || '7'
  }

  const [timeRange, setTimeRange] = useState<CampaignsTimeRange>(getTimeRangeFromUrl())
  const [dateRange, setDateRange] = useState<DateRange | undefined>()
  const [appliedCustomRange, setAppliedCustomRange] = useState<{
    startDate: string
    endDate: string
  } | null>(null)
  const showDeletedCampaigns = false

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const totalItems = serverTotal
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))

  // Sorting states
  const [sortField, setSortField] = useState<CampaignSortField | null>(null)
  const [sortDirection, setSortDirection] = useState<CampaignSortDirection>(null)
  const silentRefreshCountRef = useRef(0)
  const campaignsInFlightRef = useRef<Map<string, Promise<void>>>(new Map())
  const trendsInFlightRef = useRef<Map<string, Promise<void>>>(new Map())
  const periodicRefreshInFlightRef = useRef(false)
  const campaignsFetchAbortRef = useRef<AbortController | null>(null)
  const campaignsFetchSeqRef = useRef(0)
  const trendsFetchAbortRef = useRef<AbortController | null>(null)
  const trendsFetchSeqRef = useRef(0)
  const fetchCampaignsRef = useRef<(options?: { silent?: boolean }) => Promise<void>>(
    async () => {}
  )
  const fetchTrendsRef = useRef<() => Promise<void>>(async () => {})

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
  const [trendsCostsByCurrency, setTrendsCostsByCurrency] = useState<
    Array<{ currency: string; amount: number }>
  >([])
  const [expandedTrendChart, setExpandedTrendChart] = useState<'traffic' | 'cost' | null>(null)
  const expandedTrendChartHeight = 380
  const [trendsSectionMounted, setTrendsSectionMounted] = useState(false)

  // Batch offline states
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<number>>(new Set())
  const [selectedCampaignSnapshots, setSelectedCampaignSnapshots] = useState<
    Record<number, SelectedCampaignSnapshot>
  >({})
  const [batchOfflineSubmitting, setBatchOfflineSubmitting] = useState(false)
  const [isBatchOfflineDialogOpen, setIsBatchOfflineDialogOpen] = useState(false)
  const [isBatchOfflineAccountIssueDialogOpen, setIsBatchOfflineAccountIssueDialogOpen] =
    useState(false)
  const [batchOfflinePendingState, setBatchOfflinePendingState] =
    useState<BatchOfflinePendingState | null>(null)
  const [batchOfflineBlacklistOffer, setBatchOfflineBlacklistOffer] = useState(false)
  const [batchOfflinePauseClickFarm, setBatchOfflinePauseClickFarm] = useState(false)
  const [batchOfflinePauseUrlSwap, setBatchOfflinePauseUrlSwap] = useState(false)
  const [batchOfflineRemoveGoogleAds, setBatchOfflineRemoveGoogleAds] = useState(false)
  const [batchDeleteSubmitting, setBatchDeleteSubmitting] = useState(false)
  const [isBatchDeleteDialogOpen, setIsBatchDeleteDialogOpen] = useState(false)
  const [isOverallRoasDialogOpen, setIsOverallRoasDialogOpen] = useState(false)

  // 批量任务相关状态
  const [isBatchTasksDialogOpen, setIsBatchTasksDialogOpen] = useState(false)

  // Adjust CPC dialog states
  const [adjustCpcOpen, setAdjustCpcOpen] = useState(false)
  const [adjustCpcTarget, setAdjustCpcTarget] = useState<{
    googleCampaignId: string
    campaignName: string
  } | null>(null)
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
  const [toggleStatusNextStatus, setToggleStatusNextStatus] = useState<'PAUSED' | 'ENABLED' | null>(
    null
  )

  // Delete draft dialog states
  const [isDeleteDraftDialogOpen, setIsDeleteDraftDialogOpen] = useState(false)
  const [deleteDraftTarget, setDeleteDraftTarget] = useState<Campaign | null>(null)
  const [deleteDraftSubmitting, setDeleteDraftSubmitting] = useState(false)
  const [isDeleteRemovedDialogOpen, setIsDeleteRemovedDialogOpen] = useState(false)
  const [deleteRemovedTarget, setDeleteRemovedTarget] = useState<Campaign | null>(null)
  const [deleteRemovedSubmitting, setDeleteRemovedSubmitting] = useState(false)

  // 暂停/开启关联 Offer 任务
  const [pauseOfferTasksSubmitting, setPauseOfferTasksSubmitting] = useState(false)
  const [pauseOfferTasksTarget, setPauseOfferTasksTarget] = useState<{
    id: number
    campaignName: string
    offerId: number
    action: OfferTasksToggleAction
  } | null>(null)
  const [isPauseOfferTasksDialogOpen, setIsPauseOfferTasksDialogOpen] = useState(false)

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
  const [editTaskIdForClickFarm, setEditTaskIdForClickFarm] = useState<string | number | undefined>(
    undefined
  )
  const [clickFarmLoading, setClickFarmLoading] = useState(false)

  // 换链接任务Modal
  const [isUrlSwapModalOpen, setIsUrlSwapModalOpen] = useState(false)
  const [selectedOfferForUrlSwap, setSelectedOfferForUrlSwap] = useState<Campaign | null>(null)
  const [editTaskIdForUrlSwap, setEditTaskIdForUrlSwap] = useState<string | undefined>(undefined)
  const [urlSwapLoading, setUrlSwapLoading] = useState(false)

  const [syncing, setSyncing] = useState(false)
  /* * 后台队列执行 Google Ads 同步时，轮询 /api/sync/status-v2 的间隔与上限 */
  const GOOGLE_ADS_SYNC_POLL_MS = 3000
  const GOOGLE_ADS_SYNC_WAIT_MAX_MS = 15 * 60 * 1000
  const GOOGLE_ADS_SYNC_QUEUE_LAG_MS = 1000
  const GOOGLE_ADS_SYNC_QUEUE_STUCK_MS = 120_000
  const [globalSyncStatus, setGlobalSyncStatus] = useState<{
    hasRunningSync: boolean
    runningSync?: {
      syncType: string
      runningSeconds: number
      isManual: boolean
    }
    googleAdsCampaignSyncQueue?: { pending: number; running: number }
  } | null>(null)

  // 优化 : 轮询状态管理
  const [, setIsPolling] = useState(false)
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const userSelectionInitializedRef = useRef(false)
  /* * SSE / 管线 idle 时抑制 toast（本页刚点完「同步」与完成提示去重） */
  const pipelineIdleToastSuppressedUntilRef = useRef(0)
  /* * 仅在「同步广告系列」请求已成功返回后，允许根据 status-v2 自动结束 syncing，避免误清 */
  const allowIdleClearSyncingRef = useRef(false)
  /* * 正在 await 队列排空循环时禁止根据 status-v2 清 syncing（避免重复点击） */
  const googleAdsSyncWaitLoopActiveRef = useRef(false)
  /* * 合并并发 status-v2 请求，避免 interval 与 wait loop 同时触发 */
  const syncStatusCheckInFlightRef = useRef<Promise<Record<string, unknown> | null> | null>(null)

  const checkGlobalSyncStatus = useCallback(async () => {
    if (syncStatusCheckInFlightRef.current) {
      return syncStatusCheckInFlightRef.current
    }

    const run = (async () => {
      try {
        const response = await fetch('/api/sync/status-v2', { credentials: 'include' })
        if (response.ok) {
          const data = await response.json()
          setGlobalSyncStatus(data)
          if (allowIdleClearSyncingRef.current && !googleAdsSyncWaitLoopActiveRef.current) {
            const qp = Number(data.googleAdsCampaignSyncQueue?.pending ?? 0)
            const qr = Number(data.googleAdsCampaignSyncQueue?.running ?? 0)
            const logBusy =
              data.hasRunningSync === true &&
              data.runningSync?.syncType === 'google_ads_campaign_sync'
            if (qp + qr === 0 && !logBusy) {
              setSyncing(false)
            }
          }
          return data
        }
      } catch (error) {
        console.error('检查同步状态失败:', error)
      }
      return null
    })()

    syncStatusCheckInFlightRef.current = run
    try {
      return await run
    } finally {
      if (syncStatusCheckInFlightRef.current === run) {
        syncStatusCheckInFlightRef.current = null
      }
    }
  }, [])

  // 启动轮询（与 GOOGLE_ADS_SYNC_POLL_MS 一致；手动同步 wait loop 期间不启动）
  const startPolling = useCallback(() => {
    if (pollingRef.current || googleAdsSyncWaitLoopActiveRef.current) {
      return
    }
    setIsPolling(true)
    pollingRef.current = setInterval(() => {
      void checkGlobalSyncStatus()
    }, GOOGLE_ADS_SYNC_POLL_MS)
    console.log('[Sync] Started polling for sync status')
  }, [checkGlobalSyncStatus])

  // 停止轮询
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
    setIsPolling(false)
    console.log('[Sync] Stopped polling for sync status')
  }, [])

  const googleAdsCampaignQueueTotal =
    Number(globalSyncStatus?.googleAdsCampaignSyncQueue?.pending ?? 0) +
    Number(globalSyncStatus?.googleAdsCampaignSyncQueue?.running ?? 0)
  const syncCampaignButtonDisabled =
    syncing || globalSyncStatus?.hasRunningSync === true || googleAdsCampaignQueueTotal > 0
  const syncCampaignButtonLabel = syncing
    ? '同步中...'
    : globalSyncStatus?.hasRunningSync
      ? '同步任务进行中'
      : googleAdsCampaignQueueTotal > 0
        ? '队列同步中...'
        : '同步广告系列'

  // 仅将软删除(isDeleted)视为"已删除"，REMOVED 视为"已下线"仍展示
  const isCampaignDeleted = (campaign: Campaign) => {
    const deletedFlag = campaign.isDeleted === true || campaign.isDeleted === 1
    return deletedFlag
  }
  const isOfferDeleted = (campaign: Campaign) =>
    campaign.offerIsDeleted === true || campaign.offerIsDeleted === 1
  const getCampaignGoogleId = (campaign: Campaign) =>
    campaign.googleCampaignId || campaign.campaignId

  const currencySet = new Set(
    campaigns.map((c) => c.adsAccountCurrency).filter((c): c is string => Boolean(c))
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
    {
      key: 'commission',
      label: `佣金(${trendsCurrencyValue})`,
      color: 'hsl(280, 87%, 65%)',
      formatter: (v: number) => formatTrendsMoney(v),
      yAxisId: 'right',
    },
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
    {
      key: 'commission',
      label: `佣金(${trendsCurrencyValue})`,
      color: 'hsl(280, 87%, 65%)',
      formatter: (v: number) => formatTrendsMoney(v),
      yAxisId: 'left',
      chartType: 'bar',
    },
    {
      key: 'avgCpc',
      label: `CPC(${trendsCurrencyValue})`,
      color: 'hsl(45, 93%, 47%)',
      formatter: (v: number) => formatTrendsMoney(v),
      yAxisId: 'right',
      chartType: 'line',
    },
    {
      key: 'roas',
      label: 'ROAS',
      color: 'hsl(221, 83%, 53%)',
      formatter: (v: number) => `${Number(v || 0).toFixed(2)}x`,
      yAxisId: 'right',
      chartType: 'line',
    },
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
  const hasMultipleCampaignSelection = selectedCampaignIds.size > 1
  const overallRoasTimeRangeLabel =
    timeRange === 'custom'
      ? appliedCustomRange
        ? `${appliedCustomRange.startDate} ~ ${appliedCustomRange.endDate}`
        : '自定义时间范围'
      : `最近${timeRange}天`
  const selectedRemovedCampaignCount = useMemo(
    () =>
      Object.values(selectedCampaignSnapshots).filter(
        (campaign) => String(campaign.status || '').toUpperCase() === 'REMOVED'
      ).length,
    [selectedCampaignSnapshots]
  )
  const activeCampaignCount = Math.max(
    0,
    Number(summary?.statusDistribution?.total ?? summary?.totalCampaigns ?? totalItems) -
      Number(summary?.statusDistribution?.removed ?? 0)
  )
  const enabledCampaignCount = Number(
    summary?.statusDistribution?.enabled ?? campaigns.filter((c) => c.status === 'ENABLED').length
  )
  const pausedCampaignCount = Number(
    summary?.statusDistribution?.paused ?? campaigns.filter((c) => c.status === 'PAUSED').length
  )
  const removedCampaignCount = Number(
    summary?.statusDistribution?.removed ?? campaigns.filter((c) => c.status === 'REMOVED').length
  )
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
  const summaryAttributedCommission =
    Number(summary?.attributedCommission ?? summaryTotalCommission) || 0
  const summaryUnattributedCommission =
    Number(
      summary?.unattributedCommission ??
        Math.max(0, summaryTotalCommission - summaryAttributedCommission)
    ) || 0
  const summaryCommissionCurrency =
    summary?.currency && summary.currency !== 'MIXED'
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
  const summaryCostCurrency =
    summary?.currency && summary.currency !== 'MIXED'
      ? String(summary.currency)
      : summaryDisplayCurrency
  const summaryTotalCostDisplay = convertAmountForDisplay(
    Number(summary?.totalCostUsd ?? 0),
    summaryCostCurrency,
    summaryDisplayCurrency
  )
  const costBreakdown =
    trendsCostsByCurrency.length > 0
      ? trendsCostsByCurrency
      : Array.isArray(summary?.costs) && summary.costs.length > 0
        ? summary.costs
        : summary?.currency && summary.currency !== 'MIXED'
          ? [{ currency: String(summary.currency), amount: Number(summary?.totalCostUsd ?? 0) }]
          : []
  const mixedAttributedCommissionBreakdown = Array.isArray(summary?.attributedCommissionsByCurrency)
    ? summary.attributedCommissionsByCurrency
    : []
  const mixedUnattributedCommissionBreakdown = Array.isArray(
    summary?.unattributedCommissionsByCurrency
  )
    ? summary.unattributedCommissionsByCurrency
    : []
  const customRangeLabel = appliedCustomRange
    ? `${appliedCustomRange.startDate} ~ ${appliedCustomRange.endDate}`
    : '自定义'
  const serverListDepsKey = JSON.stringify({
    currentPage,
    pageSize,
    searchQuery: debouncedSearchQuery.trim(),
    statusFilter,
    statusCategoryFilter,
    needsOfferCompletionFilter,
    sortField,
    sortDirection,
    showDeletedCampaigns,
    selectedUserFilters: selectedUserFilters.slice().sort(),
    affiliateFilter,
  })
  const allUsersSelected =
    users.length > 0 &&
    selectedUserFilters.length === users.length &&
    users.every((user) => selectedUserFilters.includes(String(user.id)))
  const userFilterApplied = selectedUserFilters.length > 0 && !allUsersSelected
  const selectedUsersLabel = userFilterApplied ? `用户(${selectedUserFilters.length})` : '所有用户'
  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    statusFilter !== DEFAULT_STATUS_FILTER ||
    statusCategoryFilter !== 'all' ||
    needsOfferCompletionFilter !== 'all' ||
    userFilterApplied ||
    affiliateFilter !== 'all'
  const trendsFilterDepsKey = JSON.stringify({
    search: debouncedSearchQuery.trim(),
    statusFilter,
    statusCategoryFilter,
    needsOfferCompletionFilter,
    showDeletedCampaigns,
    selectedUserFilters: selectedUserFilters.slice().sort(),
    affiliateFilter,
    createdAtStart: createdAtStart ?? '',
    createdAtEnd: createdAtEnd ?? '',
  })

  // 初始检查同步状态
  useEffect(() => {
    void checkGlobalSyncStatus()
  }, [checkGlobalSyncStatus])

  // 检查管理员权限并加载用户列表（管理员功能）- 参考 dashboard 页面实现
  useEffect(() => {
    const checkAdminAndLoadUsers = async () => {
      try {
        setUsersLoading(true)
        // 直接使用 /api/admin/users 验证管理员权限（403=非管理员）
        const usersResponse = await fetch('/api/admin/users?limit=100', {
          credentials: 'include',
          cache: 'no-store',
        })

        if (usersResponse.status === 403 || usersResponse.status === 401) {
          // 非管理员，不获取用户列表
          setIsAdmin(false)
          return
        }

        if (usersResponse.ok) {
          const data = await usersResponse.json()
          const fetchedUsers: Array<{ id: number; username: string; email: string }> =
            data.users || []
          setUsers(fetchedUsers)
          // 默认全选一次，避免后续用户手动取消后被再次覆盖
          if (!userSelectionInitializedRef.current && fetchedUsers.length > 0) {
            const initialUserIds = fetchedUsers.map((user) => String(user.id))
            setSelectedUserFilters(initialUserIds)
            setPendingUserFilters(initialUserIds)
            userSelectionInitializedRef.current = true
          }
          setIsAdmin(true)
        } else {
          setIsAdmin(false)
        }
      } catch (error) {
        console.error('检查管理员权限或加载用户列表失败:', error)
        setIsAdmin(false)
      } finally {
        setUsersLoading(false)
      }
    }
    void checkAdminAndLoadUsers()
  }, [])

  // 加载联盟平台列表（用于筛选）
  useEffect(() => {
    const loadAffiliates = async () => {
      setAffiliatesLoading(true)
      try {
        const response = await fetch('/api/campaigns/affiliate-platforms', {
          credentials: 'include',
        })
        if (response.ok) {
          const data = await response.json()
          setAffiliates(data.affiliates || [])
        }
      } catch (error) {
        console.error('加载联盟平台列表失败:', error)
      } finally {
        setAffiliatesLoading(false)
      }
    }
    void loadAffiliates()
  }, [])

  // 监听同步状态，自动管理轮询（含：仅有队列任务但 sync_logs 尚未写入 running 的阶段）
  useEffect(() => {
    if (googleAdsSyncWaitLoopActiveRef.current) {
      return
    }
    const st = globalSyncStatus
    const queueTotal =
      Number(st?.googleAdsCampaignSyncQueue?.pending ?? 0) +
      Number(st?.googleAdsCampaignSyncQueue?.running ?? 0)
    const needPoll = Boolean(st?.hasRunningSync) || queueTotal > 0
    if (needPoll && !pollingRef.current) {
      startPolling()
    } else if (!needPoll && pollingRef.current) {
      stopPolling()
    }
  }, [globalSyncStatus, startPolling, stopPolling])

  // 清理轮询（组件卸载时）
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
      setIsPolling(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 300)

    return () => {
      window.clearTimeout(timer)
    }
  }, [searchQuery])

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

  const resetFilters = () => {
    setSearchQuery('')
    setDebouncedSearchQuery('')
    setStatusFilter(DEFAULT_STATUS_FILTER)
    setStatusCategoryFilter('all')
    setNeedsOfferCompletionFilter('all')
    const allUserIds = users.map((user) => String(user.id))
    setSelectedUserFilters(allUserIds)
    setPendingUserFilters(allUserIds)
    setAffiliateFilter('all')
    if (currentPage !== 1) {
      setCurrentPage(1)
    }
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

  const upsertSelectedCampaignSnapshots = useCallback(
    (nextCampaigns: Campaign[]) => {
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
            !previous ||
            previous.campaignName !== incoming.campaignName ||
            previous.status !== incoming.status
          ) {
            next[campaign.id] = incoming
            changed = true
          }
        })

        return changed ? next : prev
      })
    },
    [selectedCampaignIds]
  )

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

  const applyLocalCampaignDeletion = useCallback(
    (ids: number[]) => {
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

      setServerTotal((prev) => Math.max(0, prev - uniqueIds.length))
    },
    [removeSelectedCampaignSnapshots]
  )

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
  }, [])

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
    void fetchCampaignsRef.current()
  }, [
    timeRange,
    appliedCustomRange?.startDate,
    appliedCustomRange?.endDate,
    serverListDepsKey,
    selectedUserFilters,
    affiliateFilter,
  ])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTrendsSectionMounted(true)
    }, 250)

    return () => {
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (!trendsSectionMounted) return
    void fetchTrendsRef.current()
  }, [
    timeRange,
    appliedCustomRange?.startDate,
    appliedCustomRange?.endDate,
    trendsSectionMounted,
    trendsFilterDepsKey,
  ])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden) return
      if (periodicRefreshInFlightRef.current) return

      periodicRefreshInFlightRef.current = true
      const tasks: Array<Promise<void>> = [fetchCampaignsRef.current({ silent: true })]
      if (trendsSectionMounted) {
        tasks.push(fetchTrendsRef.current())
      }
      Promise.all(tasks).finally(() => {
        periodicRefreshInFlightRef.current = false
      })
    }, 60_000)

    return () => {
      window.clearInterval(timer)
    }
  }, [
    timeRange,
    appliedCustomRange?.startDate,
    appliedCustomRange?.endDate,
    serverListDepsKey,
    trendsSectionMounted,
    trendsFilterDepsKey,
  ])

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
    setFilteredCampaigns(campaigns)
    setCurrentPage((prev) => {
      return prev > totalPages ? totalPages : prev
    })
  }, [campaigns, totalPages])

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

  const buildCampaignListParams = (options?: { ids?: number[] }): URLSearchParams => {
    const params = buildDateRangeParams()

    if (options?.ids && options.ids.length > 0) {
      params.set('ids', options.ids.join(','))
      return params
    }

    const normalizedSearch = debouncedSearchQuery.trim()
    if (normalizedSearch) {
      params.set('search', normalizedSearch)
    }

    if (statusFilter !== 'all') {
      params.set('status', statusFilter)
    }

    if (needsOfferCompletionFilter !== 'all') {
      params.set('needsOfferCompletion', needsOfferCompletionFilter)
    }

    if (statusCategoryFilter !== 'all') {
      params.set('statusCategory', statusCategoryFilter)
    }

    params.set('limit', String(pageSize))
    params.set('offset', String((currentPage - 1) * pageSize))
    params.set('showDeleted', String(showDeletedCampaigns))

    if (sortField && sortDirection) {
      params.set('sortBy', sortField)
      params.set('sortOrder', sortDirection)
    }

    // 支持按创建时间过滤（用于"最近 14 天新增"页面）
    if (createdAtStart) {
      params.set('createdAtStart', createdAtStart)
    }
    if (createdAtEnd) {
      params.set('createdAtEnd', createdAtEnd)
    }

    // 支持按多个用户筛选（管理员功能）
    if (userFilterApplied) {
      params.set('userIds', selectedUserFilters.join(','))
    }

    // 支持按联盟筛选
    if (affiliateFilter && affiliateFilter !== 'all') {
      params.set('affiliate', affiliateFilter)
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
        const nextTotal = Number.isFinite(Number(data.total))
          ? Number(data.total)
          : nextCampaigns.length

        if (requestSeq !== campaignsFetchSeqRef.current) {
          return
        }

        setError('')
        setCampaigns(nextCampaigns)
        setFilteredCampaigns(nextCampaigns)
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

  // SSE（AppLayout）在 Google Ads 管线 idle 时派发事件：刷新列表并按需 toast
  useEffect(() => {
    const onPipelineIdle = () => {
      void fetchCampaignsRef.current({ silent: true })
      if (Date.now() >= pipelineIdleToastSuppressedUntilRef.current) {
        showInfo('广告系列', 'Google Ads 同步已完成，列表已更新')
      }
    }
    window.addEventListener(GOOGLE_ADS_CAMPAIGN_PIPELINE_IDLE_EVENT, onPipelineIdle)
    return () => {
      window.removeEventListener(GOOGLE_ADS_CAMPAIGN_PIPELINE_IDLE_EVENT, onPipelineIdle)
    }
  }, [])

  const buildTrendsQueryParams = (): URLSearchParams => {
    const params = buildDateRangeParams()

    const normalizedSearch = debouncedSearchQuery.trim()
    if (normalizedSearch) {
      params.set('search', normalizedSearch)
    }

    if (statusFilter !== 'all') {
      params.set('status', statusFilter)
    }

    if (needsOfferCompletionFilter !== 'all') {
      params.set('needsOfferCompletion', needsOfferCompletionFilter)
    }

    if (statusCategoryFilter !== 'all') {
      params.set('statusCategory', statusCategoryFilter)
    }

    params.set('showDeleted', String(showDeletedCampaigns))

    if (createdAtStart) {
      params.set('createdAtStart', createdAtStart)
    }
    if (createdAtEnd) {
      params.set('createdAtEnd', createdAtEnd)
    }

    if (userFilterApplied) {
      params.set('userIds', selectedUserFilters.join(','))
    }

    if (affiliateFilter && affiliateFilter !== 'all') {
      params.set('affiliate', affiliateFilter)
    }

    return params
  }

  const fetchTrends = async () => {
    const queryString = buildTrendsQueryParams().toString()
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
        setTrendsCostsByCurrency(
          Array.isArray(data.summary?.costsByCurrency) ? data.summary.costsByCurrency : []
        )
        setTrendsError(null)
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return
        }
        setTrendsTotalsConverted(null)
        setTrendsCostsByCurrency([])
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

  fetchCampaignsRef.current = fetchCampaigns
  fetchTrendsRef.current = fetchTrends

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

  const handleCpcAdjusted = async (payload: { googleCampaignId: string; newCpc: number }) => {
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

  const openPauseOfferTasksDialog = (campaign: Campaign) => {
    if (!campaignHasBoundOffer(campaign.offerId)) {
      return
    }

    const action = resolveOfferTasksToggleAction(
      campaign.clickFarmTaskStatus,
      campaign.urlSwapTaskStatus
    )

    if (action === 'start' && !isCampaignEnabled(campaign.status)) {
      showError('无法开启', '请先启用广告系列后再开启关联 Offer 任务')
      return
    }

    setPauseOfferTasksTarget({
      id: campaign.id,
      campaignName: campaign.campaignName,
      offerId: campaign.offerId,
      action,
    })
    setIsPauseOfferTasksDialogOpen(true)
  }

  const confirmPauseOfferTasks = async () => {
    if (!pauseOfferTasksTarget || pauseOfferTasksSubmitting) return

    const { action, id } = pauseOfferTasksTarget
    const isPauseAction = action === 'pause'
    const endpoint = isPauseAction
      ? `/api/campaigns/${id}/pause-offer-tasks`
      : `/api/campaigns/${id}/resume-offer-tasks`

    setPauseOfferTasksSubmitting(true)

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })

      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      const result = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(result?.error || (isPauseAction ? '暂停任务失败' : '开启任务失败'))
      }

      if (isPauseAction) {
        showSuccess(
          '暂停成功',
          `补点击：${result.details.clickFarmTask}, 换链接：${result.details.urlSwapTask}`
        )
      } else if (result?.partialSuccess || result?.error) {
        const detailParts = [
          `补点击新建 ${result.details?.clickFarmTasksCreated ?? 0}、更新 ${result.details?.clickFarmTasksUpdated ?? 0}`,
          `换链接新建 ${result.details?.urlSwapTasksCreated ?? 0}、更新 ${result.details?.urlSwapTasksUpdated ?? 0}`,
        ]
        showInfo(
          result?.error ? '任务已部分开启' : '开启完成',
          [detailParts.join('；'), result?.error].filter(Boolean).join('。')
        )
      } else {
        const detailParts = [
          `补点击新建 ${result.details?.clickFarmTasksCreated ?? 0}、更新 ${result.details?.clickFarmTasksUpdated ?? 0}`,
          `换链接新建 ${result.details?.urlSwapTasksCreated ?? 0}、更新 ${result.details?.urlSwapTasksUpdated ?? 0}`,
        ]
        showSuccess('开启成功', detailParts.join('；'))
      }

      await fetchCampaigns({ silent: true })
    } catch (err: any) {
      showError(isPauseAction ? '暂停失败' : '开启失败', err?.message || '网络错误')
    } finally {
      setPauseOfferTasksSubmitting(false)
      setIsPauseOfferTasksDialogOpen(false)
      setPauseOfferTasksTarget(null)
    }
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
    if (
      message.includes('账号状态异常') ||
      message.includes('Ads账号') ||
      message.includes('Ads 账号')
    )
      return 'Ads 账号异常'
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
      .map(
        ([category, info]) => `- ${category}: ${info.count} 个（示例：${info.samples.join('、')}）`
      )
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
      currentStatus === 'ENABLED' ? 'PAUSED' : currentStatus === 'PAUSED' ? 'ENABLED' : null

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
    const canOfflineWithoutGoogleCampaign =
      normalizedCreationStatus === 'pending' || normalizedCreationStatus === 'failed'

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
        setOfflineAccountIssueMessage(
          data?.message || '账号状态异常，无法在 Google Ads 中暂停广告系列。'
        )
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

  const syncCampaigns = async () => {
    // 检查是否有其他同步任务正在进行
    const status = await checkGlobalSyncStatus()
    const queuePending =
      Number(status?.googleAdsCampaignSyncQueue?.pending ?? 0) +
      Number(status?.googleAdsCampaignSyncQueue?.running ?? 0)
    if (status?.hasRunningSync || queuePending > 0) {
      const runningInfo = status?.runningSync
      if (status?.hasRunningSync) {
        showError(
          '同步任务进行中',
          `有${runningInfo?.isManual === true ? '手动' : '定时'}同步任务正在运行（已运行${runningInfo?.runningSeconds ?? 0}秒），请稍后再试`
        )
      } else {
        showError('同步任务进行中', 'Google Ads 广告系列同步队列仍有任务，请稍后再试')
      }
      return
    }
    // 检查当前是否正在同步
    if (syncing) {
      showInfo('同步进行中', '请勿重复点击')
      return
    }
    setSyncing(true)
    allowIdleClearSyncingRef.current = false
    const safetyRelease = setTimeout(() => setSyncing(false), GOOGLE_ADS_SYNC_WAIT_MAX_MS + 30_000)
    try {
      const response = await fetch('/api/cron/sync-google-ads-campaigns', {
        method: 'POST',
        credentials: 'include',
      })

      const text = await response.text()
      let data: Record<string, unknown> | null = null
      try {
        data = text ? (JSON.parse(text) as Record<string, unknown>) : null
      } catch {
        data = null
      }

      if (response.status === 401) {
        handleUnauthorized()
        return
      }

      if (!response.ok) {
        let detail = `HTTP ${response.status}`
        if (data && typeof data.message === 'string') {
          detail = `${detail}: ${data.message}`
        } else if (data && typeof data.error === 'string') {
          detail = `${detail}: ${data.error}`
        } else if (text) {
          detail = `${detail}: ${text.slice(0, 200)}`
        }
        throw new Error(
          response.status === 504 || response.status === 502
            ? `网关超时或上游未响应（${detail}）。任务可能已入队，请刷新列表或查看 sync_logs。`
            : `同步失败（${detail}）`
        )
      }

      allowIdleClearSyncingRef.current = true

      const asyncPayload =
        response.status === 202 && data != null && data.accepted === true && data.async === true
          ? data
          : null
      let skipFinalSuccessToast = false
      if (asyncPayload) {
        const summary = asyncPayload.summary as { enqueued?: number } | undefined
        const enqueued = typeof summary?.enqueued === 'number' ? summary.enqueued : 0
        if (enqueued > 0) {
          pipelineIdleToastSuppressedUntilRef.current =
            Date.now() + GOOGLE_ADS_SYNC_WAIT_MAX_MS + 60_000
          const waitStartedAt = Date.now()
          let everBusy = false
          let consecutiveIdle = 0
          let exitedOnIdle = false
          stopPolling()
          googleAdsSyncWaitLoopActiveRef.current = true
          try {
            await new Promise((r) => setTimeout(r, GOOGLE_ADS_SYNC_QUEUE_LAG_MS))
            while (Date.now() - waitStartedAt < GOOGLE_ADS_SYNC_WAIT_MAX_MS) {
              const st = await checkGlobalSyncStatus()
              const queue = st?.googleAdsCampaignSyncQueue
              const qp = Number(queue?.pending ?? 0)
              const qr = Number(queue?.running ?? 0)
              const logBusy =
                st?.hasRunningSync === true &&
                st?.runningSync?.syncType === 'google_ads_campaign_sync'
              const busy = qp + qr > 0 || logBusy
              if (busy) {
                everBusy = true
                consecutiveIdle = 0
              } else {
                consecutiveIdle++
                if (consecutiveIdle >= 2) {
                  exitedOnIdle = true
                  break
                }
              }
              if (!everBusy && Date.now() - waitStartedAt > GOOGLE_ADS_SYNC_QUEUE_STUCK_MS) {
                throw new Error(
                  '任务已提交但长时间未开始执行，请确认 Redis 与后台队列 Worker（QUEUE_BACKGROUND_WORKER）已启动'
                )
              }
              await new Promise((r) => setTimeout(r, GOOGLE_ADS_SYNC_POLL_MS))
            }
            if (!exitedOnIdle && Date.now() - waitStartedAt >= GOOGLE_ADS_SYNC_WAIT_MAX_MS) {
              throw new Error('等待同步完成超时，请稍后刷新列表；任务可能仍在后台执行')
            }
          } finally {
            googleAdsSyncWaitLoopActiveRef.current = false
            void checkGlobalSyncStatus()
          }
        } else {
          showInfo(
            '同步',
            typeof asyncPayload.message === 'string'
              ? asyncPayload.message
              : '未将任何用户加入同步队列'
          )
          skipFinalSuccessToast = true
        }
      }

      if (!skipFinalSuccessToast) {
        showSuccess('广告系列同步成功', asyncPayload ? '后台任务已完成' : '数据已更新')
      }
      void fetchCampaigns({ silent: true })
    } catch (err: any) {
      if (err?.message === 'UNAUTHORIZED') return
      showError('同步失败', err?.message || '网络错误')
    } finally {
      clearTimeout(safetyRelease)
      allowIdleClearSyncingRef.current = false
      pipelineIdleToastSuppressedUntilRef.current = Date.now() + 5000
      setSyncing(false)
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
        const desc =
          skippedCount > 0
            ? `已删除 ${successIds.length} 个广告系列，跳过 ${skippedCount} 个不可删除的广告系列`
            : `已删除 ${successIds.length} 个广告系列`
        showSuccess('批量删除成功', desc)
        return
      }

      if (successIds.length > 0) {
        showSuccess('批量删除部分成功', `已删除 ${successIds.length} 个广告系列`)
      }

      const failureSummary = buildBatchDeleteFailureSummary(failures)
      const skippedNote =
        skippedCount > 0 ? `\n另有 ${skippedCount} 个不可删除的广告系列已跳过。` : ''

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
        prev.map((c) => (c.id === campaign.id ? { ...c, status: data?.status || nextStatus } : c))
      )

      showSuccess(nextStatus === 'PAUSED' ? '已暂停' : '已启用', campaign.campaignName)

      // 后端可能返回非阻断 warning（如关联 offer 任务暂停失败），前端需要显式提示。
      const warnings = Array.isArray(data?.warnings) ? data.warnings : []
      if (warnings.length > 0) {
        const warningMessage = formatToggleStatusWarnings(warnings)
        if (warningMessage) {
          showInfo('状态已更新，但有提示', warningMessage)
        }
      }
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
  const paginatedCampaigns = filteredCampaigns

  // 全选/取消全选
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const currentPageIds = paginatedCampaigns.map((campaign) => campaign.id)
      const currentPageIdSet = new Set(currentPageIds)
      const currentSelectedCount = selectedCampaignIds.size
      const alreadySelectedOnPage = currentPageIds.filter((id) =>
        selectedCampaignIds.has(id)
      ).length
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
        <Badge
          variant="outline"
          className="flex items-center gap-1 w-fit whitespace-nowrap border-orange-200 text-orange-800 bg-orange-50"
        >
          <AlertCircle className="w-3 h-3" />
          账号已解绑
        </Badge>
      )
    }

    const configs = {
      ENABLED: {
        label: getCampaignStatusLabel('ENABLED'),
        variant: 'default' as const,
        icon: PlayCircle,
        className: 'bg-green-600 hover:bg-green-700',
      },
      PAUSED: {
        label: getCampaignStatusLabel('PAUSED'),
        variant: 'secondary' as const,
        icon: PauseCircle,
        className: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200',
      },
      REMOVED: {
        label: getCampaignStatusLabel('REMOVED'),
        variant: 'destructive' as const,
        icon: XCircle,
        className: '',
      },
    }
    const config = configs[status as keyof typeof configs] || {
      label: status,
      variant: 'outline' as const,
      icon: AlertCircle,
      className: '',
    }
    const Icon = config.icon

    return (
      <Badge
        variant={config.variant}
        className={`flex items-center gap-0.5 w-fit whitespace-nowrap text-[11px] px-1.5 py-0 ${config.className}`}
      >
        <Icon className="w-3 h-3" />
        {config.label}
      </Badge>
    )
  }

  // 排序处理函数
  const handleSort = (field: CampaignSortField) => {
    if (currentPage !== 1) {
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
              <h1 className="text-2xl font-bold text-gray-900">{pageTitle}</h1>
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
                  title={
                    selectedRemovedCampaignCount > 0
                      ? '批量删除已移除或账号已解绑的广告系列'
                      : '仅已移除或账号已解绑的广告系列可删除'
                  }
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
              <Button
                variant="default"
                size="sm"
                onClick={() => setIsBatchTasksDialogOpen(true)}
                disabled={selectedCampaignIds.size === 0}
              >
                <PlayCircle className="w-4 h-4 mr-2" />
                批量开启任务 ({selectedCampaignIds.size})
              </Button>
              <Button onClick={() => void syncCampaigns()} disabled={syncCampaignButtonDisabled}>
                {syncCampaignButtonLabel}
              </Button>
              <Button onClick={() => router.push('/offers')}>创建广告系列</Button>
              {hasMultipleCampaignSelection && (
                <Button variant="outline" onClick={() => setIsOverallRoasDialogOpen(true)}>
                  <BarChart3 className="w-4 h-4 mr-2" />
                  计算整体ROAS
                </Button>
              )}
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
                    {summary.changes?.impressions !== null &&
                      summary.changes?.impressions !== undefined && (
                        <p
                          className={`text-xs mt-1 ${summary.changes.impressions >= 0 ? 'text-green-600' : 'text-red-600'}`}
                        >
                          {summary.changes.impressions >= 0 ? '↑' : '↓'}{' '}
                          {Math.abs(summary.changes.impressions).toFixed(1)}% 环比
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
                      <p
                        className={`text-xs mt-1 ${summary.changes.clicks >= 0 ? 'text-green-600' : 'text-red-600'}`}
                      >
                        {summary.changes.clicks >= 0 ? '↑' : '↓'}{' '}
                        {Math.abs(summary.changes.clicks).toFixed(1)}% 环比
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
                    <p className="text-sm font-medium text-gray-600">
                      总花费({trendsCurrencyValue})
                    </p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {formatCurrencyDashboard(
                        Number(
                          trendsTotalsConverted != null
                            ? trendsTotalsConverted.cost
                            : summaryTotalCostDisplay
                        ),
                        String(trendsCurrencyValue || defaultCurrency)
                      )}
                    </p>
                    {costBreakdown.length > 0 && (
                      <p className="text-xs mt-1 text-gray-500">
                        分币种: {formatMultiCurrency(costBreakdown)}
                      </p>
                    )}
                    {summary?.currency !== 'MIXED' &&
                      summary.changes?.cost !== null &&
                      summary.changes?.cost !== undefined && (
                        <p
                          className={`text-xs mt-1 ${summary.changes.cost <= 0 ? 'text-green-600' : 'text-red-600'}`}
                        >
                          {summary.changes.cost >= 0 ? '↑' : '↓'}{' '}
                          {Math.abs(summary.changes.cost).toFixed(1)}% 环比
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
                    <p className="text-sm font-medium text-gray-600">
                      总佣金({trendsCurrencyValue})
                    </p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {formatCurrencyDashboard(
                        Number(
                          trendsTotalsConverted != null
                            ? trendsTotalsConverted.commission
                            : summaryTotalCommissionDisplay
                        ),
                        String(trendsCurrencyValue || defaultCurrency)
                      )}
                    </p>
                    {summary?.currency !== 'MIXED' ? (
                      <>
                        <p className="text-xs mt-1 text-gray-500">
                          可归因:{' '}
                          {formatCurrencyDashboard(
                            summaryAttributedCommissionDisplay,
                            summaryDisplayCurrency
                          )}
                        </p>
                        <p
                          className={`text-xs mt-1 ${summaryUnattributedCommission > 0 ? 'text-amber-600' : 'text-gray-500'}`}
                        >
                          未归因:{' '}
                          {formatCurrencyDashboard(
                            summaryUnattributedCommissionDisplay,
                            summaryDisplayCurrency
                          )}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-xs mt-1 text-gray-500">
                          可归因:{' '}
                          {formatCurrencyWithCode(
                            mixedAttributedCommissionBreakdown,
                            summaryDisplayCurrency
                          )}
                        </p>
                        <p
                          className={`text-xs mt-1 ${mixedUnattributedCommissionBreakdown.length > 0 ? 'text-amber-600' : 'text-gray-500'}`}
                        >
                          未归因:{' '}
                          {formatCurrencyWithCode(
                            mixedUnattributedCommissionBreakdown,
                            summaryDisplayCurrency
                          )}
                        </p>
                      </>
                    )}
                    {summary?.currency !== 'MIXED' &&
                      summary.changes?.conversions !== null &&
                      summary.changes?.conversions !== undefined && (
                        <p
                          className={`text-xs mt-1 ${summary.changes.conversions >= 0 ? 'text-green-600' : 'text-red-600'}`}
                        >
                          {summary.changes.conversions >= 0 ? '↑' : '↓'}{' '}
                          {Math.abs(summary.changes.conversions).toFixed(1)}% 环比
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
                      <p
                        className={`text-xs mt-1 ${Number(summary.changes.roas) >= 0 ? 'text-green-600' : 'text-red-600'}`}
                      >
                        {Number(summary.changes.roas) >= 0 ? '↑' : '↓'}{' '}
                        {formatSummaryRoasChange(summary)} 环比
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

        {trendsSectionMounted ? (
          <CampaignsTrendsSection
            timeRange={timeRange}
            dateRange={dateRange}
            customRangeLabel={customRangeLabel}
            trendsOverviewDescription={trendsOverviewDescription}
            trendsData={trendsData}
            trendsLoading={trendsLoading}
            trendsError={trendsError}
            trafficTrendMetrics={trafficTrendMetrics}
            costTrendMetrics={costTrendMetrics}
            trafficTrendDescription={trafficTrendDescription}
            costTrendDescription={costTrendDescription}
            averageCtrText={
              trendsData.length > 0
                ? `${(trendsData.reduce((sum, d) => sum + ((d.ctr as number) || 0), 0) / trendsData.length).toFixed(2)}%`
                : '0.00%'
            }
            averageCpcText={
              trendsData.length > 0
                ? formatTrendsMoney(Number(trendsTotalsConverted?.cpc ?? 0))
                : formatTrendsMoney(0)
            }
            averageRoasText={
              trendsData.length > 0
                ? `${Number(trendsTotalsConverted?.roas ?? 0).toFixed(2)}x`
                : '0.00x'
            }
            trendsCurrencyValue={trendsCurrencyValue}
            enabledCampaignCount={enabledCampaignCount}
            pausedCampaignCount={pausedCampaignCount}
            removedCampaignCount={removedCampaignCount}
            totalCampaignCount={totalCampaignCount}
            expandedTrendChart={expandedTrendChart}
            expandedTrendChartHeight={expandedTrendChartHeight}
            onSelectPresetTimeRange={selectPresetTimeRange}
            onDateRangeChange={handleDateRangeChange}
            onRetry={() => void fetchTrends()}
            onExpandedTrendChartChange={setExpandedTrendChart}
          />
        ) : (
          <CampaignsTrendsSectionSkeleton />
        )}

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center gap-3">
              {/* Search */}
              <div className="relative w-full md:flex-1 md:min-w-[300px]">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="搜索广告系列、Ads账号名称或账号ID..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value)
                    if (currentPage !== 1) {
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
                    if (currentPage !== 1) {
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

              {/* 状态分类筛选 */}
              <div className="w-full sm:w-[220px] md:w-[200px]">
                <Select
                  value={statusCategoryFilter}
                  onValueChange={(value) => {
                    setStatusCategoryFilter(value)
                    if (currentPage !== 1) {
                      setCurrentPage(1)
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="运营状态" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">所有运营状态</SelectItem>
                    <SelectItem value="pending">待定</SelectItem>
                    <SelectItem value="watching">观察</SelectItem>
                    <SelectItem value="qualified">合格</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* 用户筛选（管理员功能） */}
              {isAdmin && (
                <div className="w-auto">
                  <DropdownMenu
                    open={userFilterMenuOpen}
                    onOpenChange={(open) => {
                      if (open) {
                        setPendingUserFilters(selectedUserFilters.slice())
                      }
                      setUserFilterMenuOpen(open)
                    }}
                  >
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full justify-between font-normal"
                        disabled={usersLoading}
                      >
                        {selectedUsersLabel}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-64 max-h-80 overflow-y-auto p-0">
                      <div className="max-h-64 overflow-y-auto p-1">
                        <DropdownMenuItem
                          onSelect={(event) => {
                            event.preventDefault()
                            setPendingUserFilters((prev) => {
                              const pendingAllSelected =
                                users.length > 0 &&
                                prev.length === users.length &&
                                users.every((user) => prev.includes(String(user.id)))
                              if (pendingAllSelected) {
                                return []
                              }
                              return users.map((user) => String(user.id))
                            })
                          }}
                        >
                          <Checkbox
                            checked={
                              users.length > 0 &&
                              pendingUserFilters.length === users.length &&
                              users.every((user) => pendingUserFilters.includes(String(user.id)))
                            }
                            className="mr-2"
                          />
                          {users.length > 0 &&
                          pendingUserFilters.length === users.length &&
                          users.every((user) => pendingUserFilters.includes(String(user.id)))
                            ? '取消全选'
                            : '全选'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {users.map((user) => {
                          const userId = String(user.id)
                          const checked = pendingUserFilters.includes(userId)
                          return (
                            <DropdownMenuItem
                              key={user.id}
                              onSelect={(event) => {
                                event.preventDefault()
                                setPendingUserFilters((prev) => {
                                  const exists = prev.includes(userId)
                                  if (exists) {
                                    return prev.filter((id) => id !== userId)
                                  }
                                  return [...prev, userId]
                                })
                              }}
                            >
                              <Checkbox checked={checked} className="mr-2" />
                              {user.username}
                            </DropdownMenuItem>
                          )
                        })}
                      </div>
                      <div className="flex justify-end gap-2 border-t p-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setUserFilterMenuOpen(false)}
                        >
                          取消
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            const nextFilters = pendingUserFilters.slice()
                            const changed = !areUserFilterSelectionsEqual(
                              nextFilters,
                              selectedUserFilters
                            )
                            setSelectedUserFilters(nextFilters)
                            if (changed && currentPage !== 1) {
                              setCurrentPage(1)
                            }
                            setUserFilterMenuOpen(false)
                          }}
                        >
                          确认
                        </Button>
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}

              {/* 联盟平台筛选 */}
              <div className="w-full sm:w-[220px] md:w-[200px]">
                <Select
                  value={affiliateFilter}
                  onValueChange={(value) => {
                    setAffiliateFilter(value)
                    if (currentPage !== 1) {
                      setCurrentPage(1)
                    }
                  }}
                  disabled={affiliatesLoading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择联盟平台" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">所有联盟平台</SelectItem>
                    {affiliates.map((affiliate) => (
                      <SelectItem key={affiliate.name} value={affiliate.name}>
                        {affiliate.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={resetFilters}
                disabled={!hasActiveFilters}
              >
                重置筛选
              </Button>

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
          <div className="text-center py-12 bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="mx-auto h-12 w-12 text-gray-400 mb-4">
              <Search className="w-full h-full" />
            </div>
            <h3 className="text-lg font-medium text-gray-900">未找到广告系列</h3>
            <p className="mt-2 text-sm text-gray-500">
              {activeCampaignCount === 0
                ? '您还没有创建任何广告系列，请前往Offer列表创建。'
                : '没有找到符合筛选条件的广告系列。'}
            </p>
            {activeCampaignCount === 0 && (
              <div className="mt-6">
                <Button onClick={() => router.push('/offers')}>前往Offer列表</Button>
              </div>
            )}
          </div>
        ) : (
          <CampaignsTable
            paginatedCampaigns={paginatedCampaigns}
            filteredCampaigns={filteredCampaigns}
            selectedCampaignIds={selectedCampaignIds}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
            onSelectAll={handleSelectAll}
            onSelectCampaign={handleSelectCampaign}
            totalItems={totalItems}
            totalPages={totalPages}
            currentPage={currentPage}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setCurrentPage(1)
            }}
            defaultCurrency={defaultCurrency}
            formatMoney={formatMoney}
            isCampaignDeleted={isCampaignDeleted}
            isOfferDeleted={isOfferDeleted}
            getCampaignGoogleId={getCampaignGoogleId}
            getStatusBadge={getStatusBadge}
            statusUpdatingIds={statusUpdatingIds}
            offlineSubmitting={offlineSubmitting}
            deleteDraftSubmitting={deleteDraftSubmitting}
            deleteRemovedSubmitting={deleteRemovedSubmitting}
            pauseOfferTasksSubmitting={pauseOfferTasksSubmitting}
            setCampaigns={setCampaigns}
            onAdjustBudget={(target) => {
              setAdjustBudgetTarget(target)
              setAdjustBudgetOpen(true)
            }}
            onAdjustCpc={(target) => {
              setAdjustCpcTarget(target)
              setAdjustCpcOpen(true)
            }}
            onToggleStatus={openToggleStatusConfirm}
            onOffline={openOfflineDialog}
            onDeleteRemoved={openDeleteRemovedDialog}
            onDeleteDraft={openDeleteDraftDialog}
            onPauseOfferTasks={openPauseOfferTasksDialog}
            onOpenClickFarmModal={async (campaign) => {
              setClickFarmLoading(true)
              try {
                const { resolveClickFarmTaskMode } = await import('../offers/task-modal-helpers')
                const { editTaskId, infoMessage } = await resolveClickFarmTaskMode(campaign.offerId)
                setSelectedOfferForClickFarm(campaign)
                setEditTaskIdForClickFarm(editTaskId === undefined ? undefined : String(editTaskId))
                if (infoMessage) showInfo(infoMessage)
                setIsClickFarmModalOpen(true)
              } catch (error) {
                console.error('查询补点击任务出错:', error)
                setSelectedOfferForClickFarm(campaign)
                setEditTaskIdForClickFarm(undefined)
                setIsClickFarmModalOpen(true)
              } finally {
                setClickFarmLoading(false)
              }
            }}
            onOpenUrlSwapModal={async (campaign) => {
              setUrlSwapLoading(true)
              try {
                const { resolveUrlSwapTaskMode } = await import('../offers/task-modal-helpers')
                const { editTaskId, infoMessage } = await resolveUrlSwapTaskMode(campaign.offerId)
                setSelectedOfferForUrlSwap(campaign)
                setEditTaskIdForUrlSwap(editTaskId === undefined ? undefined : String(editTaskId))
                if (infoMessage) showInfo(infoMessage)
                setIsUrlSwapModalOpen(true)
              } catch (error) {
                console.error('查询换链接任务出错:', error)
                setSelectedOfferForUrlSwap(campaign)
                setEditTaskIdForUrlSwap(undefined)
                setIsUrlSwapModalOpen(true)
              } finally {
                setUrlSwapLoading(false)
              }
            }}
            clickFarmLoading={clickFarmLoading}
            urlSwapLoading={urlSwapLoading}
          />
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
      <CampaignOverallRoasDialog
        open={isOverallRoasDialogOpen}
        onOpenChange={setIsOverallRoasDialogOpen}
        selectedCampaignCount={selectedCampaignIds.size}
        timeRangeLabel={overallRoasTimeRangeLabel}
        summaryDisplayCurrency={summaryDisplayCurrency}
        loadSelectedCampaigns={getSelectedCampaigns}
      />
      <CampaignsActionDialogs
        isToggleStatusDialogOpen={isToggleStatusDialogOpen}
        setIsToggleStatusDialogOpen={setIsToggleStatusDialogOpen}
        toggleStatusTarget={toggleStatusTarget}
        setToggleStatusTarget={setToggleStatusTarget}
        toggleStatusNextStatus={toggleStatusNextStatus}
        setToggleStatusNextStatus={setToggleStatusNextStatus}
        confirmToggleStatus={confirmToggleStatus}
        isPauseOfferTasksDialogOpen={isPauseOfferTasksDialogOpen}
        setIsPauseOfferTasksDialogOpen={setIsPauseOfferTasksDialogOpen}
        pauseOfferTasksTarget={pauseOfferTasksTarget}
        setPauseOfferTasksTarget={setPauseOfferTasksTarget}
        pauseOfferTasksSubmitting={pauseOfferTasksSubmitting}
        confirmPauseOfferTasks={confirmPauseOfferTasks}
        isBatchDeleteDialogOpen={isBatchDeleteDialogOpen}
        setIsBatchDeleteDialogOpen={setIsBatchDeleteDialogOpen}
        batchDeleteSubmitting={batchDeleteSubmitting}
        selectedCampaignIds={selectedCampaignIds}
        selectedRemovedCampaignCount={selectedRemovedCampaignCount}
        handleBatchDeleteRemoved={handleBatchDeleteRemoved}
        isBatchOfflineDialogOpen={isBatchOfflineDialogOpen}
        setIsBatchOfflineDialogOpen={setIsBatchOfflineDialogOpen}
        batchOfflineSubmitting={batchOfflineSubmitting}
        batchOfflineRemoveGoogleAds={batchOfflineRemoveGoogleAds}
        setBatchOfflineRemoveGoogleAds={setBatchOfflineRemoveGoogleAds}
        batchOfflineBlacklistOffer={batchOfflineBlacklistOffer}
        setBatchOfflineBlacklistOffer={setBatchOfflineBlacklistOffer}
        batchOfflinePauseClickFarm={batchOfflinePauseClickFarm}
        setBatchOfflinePauseClickFarm={setBatchOfflinePauseClickFarm}
        batchOfflinePauseUrlSwap={batchOfflinePauseUrlSwap}
        setBatchOfflinePauseUrlSwap={setBatchOfflinePauseUrlSwap}
        resetBatchOfflineState={resetBatchOfflineState}
        handleBatchOffline={handleBatchOffline}
        isBatchOfflineAccountIssueDialogOpen={isBatchOfflineAccountIssueDialogOpen}
        setIsBatchOfflineAccountIssueDialogOpen={setIsBatchOfflineAccountIssueDialogOpen}
        batchOfflinePendingState={batchOfflinePendingState}
        confirmBatchOfflineLocalOnly={confirmBatchOfflineLocalOnly}
        isDeleteRemovedDialogOpen={isDeleteRemovedDialogOpen}
        setIsDeleteRemovedDialogOpen={setIsDeleteRemovedDialogOpen}
        deleteRemovedTarget={deleteRemovedTarget}
        setDeleteRemovedTarget={setDeleteRemovedTarget}
        deleteRemovedSubmitting={deleteRemovedSubmitting}
        confirmDeleteRemoved={confirmDeleteRemoved}
        isDeleteDraftDialogOpen={isDeleteDraftDialogOpen}
        setIsDeleteDraftDialogOpen={setIsDeleteDraftDialogOpen}
        deleteDraftTarget={deleteDraftTarget}
        setDeleteDraftTarget={setDeleteDraftTarget}
        deleteDraftSubmitting={deleteDraftSubmitting}
        confirmDeleteDraft={confirmDeleteDraft}
        isOfflineDialogOpen={isOfflineDialogOpen}
        setIsOfflineDialogOpen={setIsOfflineDialogOpen}
        offlineTarget={offlineTarget}
        setOfflineTarget={setOfflineTarget}
        offlineBlacklistOffer={offlineBlacklistOffer}
        setOfflineBlacklistOffer={setOfflineBlacklistOffer}
        offlinePauseClickFarm={offlinePauseClickFarm}
        setOfflinePauseClickFarm={setOfflinePauseClickFarm}
        offlinePauseUrlSwap={offlinePauseUrlSwap}
        setOfflinePauseUrlSwap={setOfflinePauseUrlSwap}
        offlineRemoveGoogleAds={offlineRemoveGoogleAds}
        setOfflineRemoveGoogleAds={setOfflineRemoveGoogleAds}
        offlineSubmitting={offlineSubmitting}
        confirmOffline={confirmOffline}
        isOfflineAccountIssueDialogOpen={isOfflineAccountIssueDialogOpen}
        setIsOfflineAccountIssueDialogOpen={setIsOfflineAccountIssueDialogOpen}
        offlineAccountIssueMessage={offlineAccountIssueMessage}
        setOfflineAccountIssueMessage={setOfflineAccountIssueMessage}
        offlineAccountIssueStatus={offlineAccountIssueStatus}
        setOfflineAccountIssueStatus={setOfflineAccountIssueStatus}
        confirmOfflineLocalOnly={confirmOfflineLocalOnly}
      />
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
            void fetchCampaigns({ silent: true })
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
            void fetchCampaigns({ silent: true })
          }}
          offerId={selectedOfferForUrlSwap?.offerId}
          editTaskId={editTaskIdForUrlSwap}
        />
      )}
      <BatchTasksDialog
        open={isBatchTasksDialogOpen}
        onOpenChange={setIsBatchTasksDialogOpen}
        variant="campaigns"
        campaignIds={Array.from(selectedCampaignIds)}
        onSuccess={() => {
          setSelectedCampaignIds(new Set())
          void fetchCampaigns({ silent: true })
        }}
      />
    </div>
  )
}
