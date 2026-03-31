'use client'

/**
 * Dashboard - 简洁高效的仪表盘
 * 设计原则：聚焦核心指标，减少视觉噪音，突出行动点
 */

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Eye,
  MousePointerClick,
  DollarSign,
  Coins,
  TrendingUp,
  TrendingDown,
  Plus,
  Rocket,
  AlertTriangle,
  ChevronRight,
  RefreshCw,
  CalendarDays,
} from 'lucide-react'
import { formatCurrency, formatMultiCurrency } from '@/lib/utils'
import { DateRangePicker, type DateRange } from '@/components/ui/date-range-picker'

interface KPIData {
  current: {
    impressions: number
    clicks: number
    cost: number
    commission: number
    roas: number | null
    roasInfinite: boolean
    ctr: number
    cpc: number
    currency?: string // 🔧 新增(2025-12-30): 货币代码
    costs?: Array<{ currency: string; amount: number }> // 🔧 新增: 多货币详情
  }
  changes: {
    impressions: number
    clicks: number
    cost: number
    commission: number
    roas: number | null
    roasInfinite: boolean
  }
}

interface RiskAlert {
  id: number
  type: string
  message: string
  severity: 'high' | 'medium' | 'low'
}

interface OfferSummary {
  total: number
  active: number
  pendingScrape: number
}

type DashboardTimeRange = '7' | '14' | '30' | 'custom'

interface DashboardClientPageProps {
  dashboardDeferEnabled?: boolean
}

function DeferredWidgetSkeleton({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-24 w-full" />
      </CardContent>
    </Card>
  )
}

function DeferredInsightsSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Insights</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
      </CardContent>
    </Card>
  )
}

const DeferredInsightsCard = dynamic(
  () => import('@/components/dashboard/InsightsCard').then((mod) => mod.InsightsCard),
  { ssr: false, loading: () => <DeferredInsightsSkeleton /> }
)

const DeferredApiQuotaChart = dynamic(
  () => import('@/components/dashboard/ApiQuotaChart').then((mod) => mod.ApiQuotaChart),
  { ssr: false, loading: () => <DeferredWidgetSkeleton title="API配额" /> }
)

const DeferredAiTokenCostChart = dynamic(
  () => import('@/components/dashboard/AiTokenCostChart').then((mod) => mod.AiTokenCostChart),
  { ssr: false, loading: () => <DeferredWidgetSkeleton title="AI Token成本" /> }
)

const formatDateInputValue = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function DashboardClientPage({ dashboardDeferEnabled = false }: DashboardClientPageProps) {
  const router = useRouter()
  const [timeRange, setTimeRange] = useState<DashboardTimeRange>('7')
  const [dateRange, setDateRange] = useState<DateRange | undefined>()
  const [appliedCustomRange, setAppliedCustomRange] = useState<{ startDate: string; endDate: string } | null>(null)
  const [kpiData, setKpiData] = useState<KPIData | null>(null)
  const [risks, setRisks] = useState<RiskAlert[]>([])
  const [offerSummary, setOfferSummary] = useState<OfferSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [deferredWidgetsMounted, setDeferredWidgetsMounted] = useState(!dashboardDeferEnabled)
  const fetchAbortRef = useRef<AbortController | null>(null)
  const fetchSeqRef = useRef(0)

  useEffect(() => {
    if (!dashboardDeferEnabled) {
      setDeferredWidgetsMounted(true)
      return
    }

    const timer = window.setTimeout(() => {
      setDeferredWidgetsMounted(true)
    }, 300)

    return () => {
      window.clearTimeout(timer)
    }
  }, [dashboardDeferEnabled])

  /**
   * 处理401未授权错误 - 跳转到登录页
   */
  const handleUnauthorized = () => {
    document.cookie = 'auth_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    const redirectUrl = encodeURIComponent(window.location.pathname + window.location.search)
    router.push(`/login?redirect=${redirectUrl}`)
  }

  const fetchData = async (showRefresh = false) => {
    const seq = fetchSeqRef.current + 1
    fetchSeqRef.current = seq

    fetchAbortRef.current?.abort()
    const abortController = new AbortController()
    fetchAbortRef.current = abortController

    if (showRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      const kpiParams = new URLSearchParams()
      if (timeRange === 'custom' && appliedCustomRange) {
        kpiParams.set('start_date', appliedCustomRange.startDate)
        kpiParams.set('end_date', appliedCustomRange.endDate)
      } else {
        kpiParams.set('days', timeRange)
      }
      if (showRefresh) {
        kpiParams.set('refresh', 'true')
      }

      const [kpiRes, riskRes, offerRes] = await Promise.all([
        fetch(`/api/dashboard/kpis?${kpiParams.toString()}`, {
          credentials: 'include',
          cache: 'no-store',
          signal: abortController.signal,
        }),
        fetch('/api/risk-alerts?limit=3', {
          credentials: 'include',
          cache: 'no-store',
          signal: abortController.signal,
        }),
        fetch('/api/offers?summary=true', {
          credentials: 'include',
          cache: 'no-store',
          signal: abortController.signal,
        }),
      ])

      if (fetchSeqRef.current !== seq) return

      // 处理401未授权
      if (kpiRes.status === 401 || riskRes.status === 401 || offerRes.status === 401) {
        handleUnauthorized()
        return
      }

      if (kpiRes.ok) {
        const kpi = await kpiRes.json()
        setKpiData(kpi.data)
      }

      if (riskRes.ok) {
        const risk = await riskRes.json()
        // 确保alerts是数组类型
        const alertsArray = Array.isArray(risk.alerts) ? risk.alerts : []
        setRisks(alertsArray.slice(0, 3))
      }

      if (offerRes.ok) {
        const offer = await offerRes.json()
        // ✅ summary模式：后端直接返回聚合统计，避免拉取完整Offer列表
        if (offer?.summary) {
          setOfferSummary({
            total: offer.summary.total || 0,
            active: offer.summary.active || 0,
            pendingScrape: offer.summary.pendingScrape || 0
          })
        } else {
          // 兼容旧结构（返回完整offers数组）
          const offersArray = Array.isArray(offer.offers) ? offer.offers : []
          setOfferSummary({
            total: offersArray.length,
            active: offersArray.filter((o: any) => o.isActive).length,
            pendingScrape: offersArray.filter((o: any) => o.scrapeStatus === 'pending').length
          })
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return
      }
      console.error('Dashboard数据加载失败:', err)
    } finally {
      if (fetchSeqRef.current === seq) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }

  useEffect(() => {
    fetchData()
  }, [timeRange, appliedCustomRange?.startDate, appliedCustomRange?.endDate])

  useEffect(() => {
    return () => {
      fetchAbortRef.current?.abort()
    }
  }, [])

  const formatNumber = (num: number | null | undefined) => (num ?? 0).toLocaleString()

  /**
   * 🔧 修复(2025-12-29): 安全地格式化数值，处理可能为字符串或null的情况
   */
  const safeToFixed = (num: any, decimals: number = 2): string => {
    const value = Number(num ?? 0)
    if (isNaN(value)) return '0'.padEnd(decimals > 0 ? decimals + 2 : 1, '0')
    return value.toFixed(decimals)
  }

  /**
   * 🔧 新增(2025-12-30): 格式化费用显示（支持多货币）
   * 🔧 修改(2026-03-10): 多货币时显示转换后的USD总额，与Campaigns页面保持一致
   */
  const formatCostDisplay = (kpiData: KPIData | null): string => {
    if (!kpiData) return formatCurrency(0, 'USD')

    const { current } = kpiData

    // 多货币场景 - 显示转换后的USD总额
    if (current.currency === 'MIXED') {
      return formatCurrency(current.cost, 'USD')
    }

    // 单一货币场景
    return formatCurrency(current.cost, current.currency || 'USD')
  }

  /**
   * 🔧 新增(2026-03-08): 格式化佣金显示（支持多货币）
   * 🔧 修改(2026-03-10): 多货币时显示转换后的USD总额，与Campaigns页面保持一致
   */
  const formatCommissionDisplay = (kpiData: KPIData | null): string => {
    if (!kpiData) return formatCurrency(0, 'USD')

    const { current } = kpiData

    // 多货币场景 - 显示转换后的USD总额
    if (current.currency === 'MIXED') {
      return formatCurrency(current.commission, 'USD')
    }

    // 单一货币场景
    return formatCurrency(current.commission, current.currency || 'USD')
  }

  /**
   * 🔧 修改(2026-03-10): 多货币时也计算ROAS，与Campaigns页面保持一致
   */
  const formatRoasDisplay = (kpiData: KPIData | null): string => {
    if (!kpiData) return '--'
    // 多货币时也计算ROAS（基于转换后的USD金额）
    if (kpiData.current.roasInfinite) return '∞'
    if (kpiData.current.roas === null || kpiData.current.roas === undefined) return '--'
    return `${safeToFixed(kpiData.current.roas, 2)}x`
  }

  /**
   * 🔧 修改(2026-03-10): 多货币时也显示ROAS变化，与Campaigns页面保持一致
   */
  const formatRoasChangeText = (kpiData: KPIData | null): string => {
    if (!kpiData) return '--'
    // 多货币时也显示ROAS变化
    if (kpiData.changes.roasInfinite) return '∞'
    if (kpiData.changes.roas === null || kpiData.changes.roas === undefined) return '--'
    const value = Number(kpiData.changes.roas)
    if (!Number.isFinite(value)) return '--'
    return `${value >= 0 ? '+' : ''}${safeToFixed(value, 1)}%`
  }

  const customRangeLabel = appliedCustomRange
    ? `${appliedCustomRange.startDate} ~ ${appliedCustomRange.endDate}`
    : '自定义'

  const handleDateRangeChange = (range: DateRange | undefined) => {
    if (!range?.from || !range?.to) {
      setDateRange(range)
      return
    }

    const startDate = formatDateInputValue(range.from)
    const endDate = formatDateInputValue(range.to)

    if (startDate > endDate) {
      return
    }

    setDateRange(range)
    setAppliedCustomRange({
      startDate,
      endDate,
    })
    setTimeRange('custom')
  }

  const widgetDays = (() => {
    if (timeRange !== 'custom') return Number(timeRange)
    if (!appliedCustomRange) return 7
    const startTs = Date.parse(`${appliedCustomRange.startDate}T00:00:00`)
    const endTs = Date.parse(`${appliedCustomRange.endDate}T00:00:00`)
    if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs < startTs) return 7
    return Math.floor((endTs - startTs) / (24 * 60 * 60 * 1000)) + 1
  })()

  // 加载骨架屏
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          <Skeleton className="h-10 w-48" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-32" />)}
          </div>
          <Skeleton className="h-48" />
        </div>
      </div>
    )
  }

  const hasRisks = risks.length > 0

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header - 简洁 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">仪表盘</h1>
            <p className="text-sm text-gray-500 mt-1">
              {offerSummary && `${offerSummary.total} 个Offer · ${offerSummary.active} 个活跃`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* 刷新按钮 */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchData(true)}
              disabled={refreshing}
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
            {/* 时间范围 */}
            <div className="flex bg-white rounded-lg border p-1">
              {([7, 14, 30] as const).map((d) => (
                <Button
                  key={d}
                  variant={timeRange === String(d) ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setTimeRange(String(d) as DashboardTimeRange)}
                  className="h-7 px-3 text-xs"
                  aria-label={`${d}天`}
                >
                  <span className="sm:hidden">{d}</span>
                  <span className="hidden sm:inline">{d}天</span>
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


        {/* 核心KPI - 5个关键指标 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
          {/* 展示量 */}
          <Card className="hover:shadow-md transition-shadow">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500 mb-1">展示量</p>
                  <p className="text-2xl font-bold">
                    {kpiData ? formatNumber(kpiData.current.impressions) : '-'}
                  </p>
                </div>
                <div className="p-3 bg-blue-50 rounded-xl">
                  <Eye className="w-6 h-6 text-blue-600" />
                </div>
              </div>
              {kpiData && (
                <div className="flex items-center gap-1 mt-3">
                  {kpiData.changes.impressions >= 0 ? (
                    <TrendingUp className="w-4 h-4 text-green-500" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-red-500" />
                  )}
                  <span className={`text-sm font-medium ${kpiData.changes.impressions >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {kpiData.changes.impressions >= 0 ? '+' : ''}{safeToFixed(kpiData.changes.impressions, 1)}%
                  </span>
                  <span className="text-xs text-gray-400 ml-1">vs 上周期</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 点击量 */}
          <Card className="hover:shadow-md transition-shadow">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500 mb-1">点击量</p>
                  <p className="text-2xl font-bold">
                    {kpiData ? formatNumber(kpiData.current.clicks) : '-'}
                  </p>
                </div>
                <div className="p-3 bg-green-50 rounded-xl">
                  <MousePointerClick className="w-6 h-6 text-green-600" />
                </div>
              </div>
              {kpiData && (
                <div className="flex items-center gap-1 mt-3">
                  {kpiData.changes.clicks >= 0 ? (
                    <TrendingUp className="w-4 h-4 text-green-500" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-red-500" />
                  )}
                  <span className={`text-sm font-medium ${kpiData.changes.clicks >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {kpiData.changes.clicks >= 0 ? '+' : ''}{safeToFixed(kpiData.changes.clicks, 1)}%
                  </span>
                  <span className="text-xs text-gray-400 ml-1">vs 上周期</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 花费 */}
          <Card className="hover:shadow-md transition-shadow">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-sm text-gray-500 mb-1">
                    总花费(USD)
                  </p>
                  <p className="text-2xl font-bold">
                    {kpiData ? formatCostDisplay(kpiData) : '-'}
                  </p>
                  {kpiData && kpiData.current.currency === 'MIXED' && kpiData.current.costs && kpiData.current.costs.length > 0 && (
                    <p className="text-xs mt-1 text-gray-500">
                      分币种: {formatMultiCurrency(kpiData.current.costs)}
                    </p>
                  )}
                </div>
                <div className="p-3 bg-purple-50 rounded-xl">
                  <DollarSign className="w-6 h-6 text-purple-600" />
                </div>
              </div>
              {kpiData && kpiData.current.currency !== 'MIXED' && (
                <div className="flex items-center gap-1 mt-3">
                  {kpiData.changes.cost >= 0 ? (
                    <TrendingUp className="w-4 h-4 text-red-500" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-green-500" />
                  )}
                  <span className={`text-sm font-medium ${kpiData.changes.cost >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {kpiData.changes.cost >= 0 ? '+' : ''}{safeToFixed(kpiData.changes.cost, 1)}%
                  </span>
                  <span className="text-xs text-gray-400 ml-1">vs 上周期</span>
                </div>
              )}
              {kpiData && kpiData.current.currency === 'MIXED' && (
                <div className="flex items-center gap-1 mt-3">
                  <span className="text-xs text-gray-500">-- 环比</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 佣金 */}
          <Card className="hover:shadow-md transition-shadow">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-sm text-gray-500 mb-1">
                    总佣金(USD)
                  </p>
                  <p className="text-2xl font-bold">
                    {kpiData ? formatCommissionDisplay(kpiData) : '-'}
                  </p>
                </div>
                <div className="p-3 bg-amber-50 rounded-xl">
                  <Coins className="w-6 h-6 text-amber-600" />
                </div>
              </div>
              {kpiData && kpiData.current.currency !== 'MIXED' && (
                <div className="flex items-center gap-1 mt-3">
                  {kpiData.changes.commission >= 0 ? (
                    <TrendingUp className="w-4 h-4 text-green-500" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-red-500" />
                  )}
                  <span className={`text-sm font-medium ${kpiData.changes.commission >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {kpiData.changes.commission >= 0 ? '+' : ''}{safeToFixed(kpiData.changes.commission, 1)}%
                  </span>
                  <span className="text-xs text-gray-400 ml-1">vs 上周期</span>
                </div>
              )}
              {kpiData && kpiData.current.currency === 'MIXED' && (
                <div className="flex items-center gap-1 mt-3">
                  <span className="text-xs text-gray-500">-- 环比</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ROAS */}
          <Card className="hover:shadow-md transition-shadow">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-sm text-gray-500 mb-1">ROAS</p>
                  <p className="text-2xl font-bold">
                    {formatRoasDisplay(kpiData)}
                  </p>
                </div>
                <div className="p-3 bg-indigo-50 rounded-xl">
                  <TrendingUp className="w-6 h-6 text-indigo-600" />
                </div>
              </div>
              {kpiData && (
                <div className="flex items-center gap-1 mt-3">
                  {kpiData.current.currency === 'MIXED' ? (
                    <span className="text-xs text-gray-500">-- 环比</span>
                  ) : kpiData.changes.roasInfinite ? (
                    <>
                      <TrendingUp className="w-4 h-4 text-green-500" />
                      <span className="text-sm font-medium text-green-600">{formatRoasChangeText(kpiData)}</span>
                      <span className="text-xs text-gray-400 ml-1">vs 上周期</span>
                    </>
                  ) : typeof kpiData.changes.roas === 'number' ? (
                    <>
                      {kpiData.changes.roas >= 0 ? (
                        <TrendingUp className="w-4 h-4 text-green-500" />
                      ) : (
                        <TrendingDown className="w-4 h-4 text-red-500" />
                      )}
                      <span className={`text-sm font-medium ${kpiData.changes.roas >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatRoasChangeText(kpiData)}
                      </span>
                      <span className="text-xs text-gray-400 ml-1">vs 上周期</span>
                    </>
                  ) : (
                    <span className="text-xs text-gray-500">-- 环比</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* API配额、AI Token成本 和 快速开始 - 新布局 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* API配额卡片 */}
          {deferredWidgetsMounted ? (
            <DeferredApiQuotaChart days={widgetDays} />
          ) : (
            <DeferredWidgetSkeleton title="API配额" />
          )}

          {/* AI Token成本卡片 */}
          {deferredWidgetsMounted ? (
            <DeferredAiTokenCostChart days={widgetDays} />
          ) : (
            <DeferredWidgetSkeleton title="AI Token成本" />
          )}

          {/* 快速开始 - 占1列，最右侧 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">快速开始</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Button
                  variant="outline"
                  className="w-full h-auto py-4 justify-start gap-3 hover:border-blue-300 hover:bg-blue-50"
                  onClick={() => router.push('/offers?action=create')}
                >
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Plus className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-semibold text-sm">创建Offer</div>
                    <div className="text-xs text-gray-500">添加新产品</div>
                  </div>
                </Button>

                <Button
                  variant="outline"
                  className="w-full h-auto py-4 justify-start gap-3 hover:border-green-300 hover:bg-green-50"
                  onClick={() => router.push('/offers')}
                >
                  <div className="p-2 bg-green-100 rounded-lg">
                    <Rocket className="w-4 h-4 text-green-600" />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-semibold text-sm">一键上广告</div>
                    <div className="text-xs text-gray-500">
                      {offerSummary && offerSummary.total > 0
                        ? `${offerSummary.total}个可投放`
                        : '先创建Offer'}
                    </div>
                  </div>
                </Button>

                <Button
                  variant="outline"
                  className="w-full h-auto py-4 justify-start gap-3 hover:border-indigo-300 hover:bg-indigo-50"
                  onClick={() => router.push('/campaigns')}
                >
                  <div className="p-2 bg-indigo-100 rounded-lg">
                    <TrendingUp className="w-4 h-4 text-indigo-600" />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-semibold text-sm">广告系列</div>
                    <div className="text-xs text-gray-500">管理投放系列</div>
                  </div>
                </Button>

                <Button
                  variant="outline"
                  className="w-full h-auto py-4 justify-start gap-3 hover:border-orange-300 hover:bg-orange-50"
                  onClick={() => router.push('/google-ads')}
                >
                  <div className="p-2 bg-orange-100 rounded-lg">
                    <DollarSign className="w-4 h-4 text-orange-600" />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-semibold text-sm">Google Ads账号</div>
                    <div className="text-xs text-gray-500">账号管理</div>
                  </div>
                </Button>

                <Button
                  variant="outline"
                  className="w-full h-auto py-4 justify-start gap-3 hover:border-gray-300 hover:bg-gray-50"
                  onClick={() => router.push('/settings')}
                >
                  <div className="p-2 bg-gray-100 rounded-lg">
                    <RefreshCw className="w-4 h-4 text-gray-600" />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-semibold text-sm">系统设置</div>
                    <div className="text-xs text-gray-500">配置参数</div>
                  </div>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Insights */}
        <div className="mt-6">
          {deferredWidgetsMounted ? (
            <DeferredInsightsCard days={widgetDays} />
          ) : (
            <DeferredInsightsSkeleton />
          )}
        </div>
      </div>
    </div>
  )
}
