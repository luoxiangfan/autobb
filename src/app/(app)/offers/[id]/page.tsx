'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useParams } from 'next/navigation'
import { showSuccess, showError, showInfo } from '@/lib/toast-utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { TrendingUp, DollarSign, Target, Activity, RefreshCcw } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import { getCommissionPerConversion, parseCommissionPayoutValue } from '@/lib/offer-monetization'
import type { TrendChartData } from '@/components/charts/TrendChart'

const OfferTrendsSection = dynamic(() => import('./OfferTrendsSection'), {
  ssr: false,
  loading: () => <OfferTrendsSectionSkeleton />,
})

interface Offer {
  id: number
  url: string
  finalUrl?: string | null
  finalUrlSuffix?: string | null
  brand: string
  category: string | null
  categoryRaw?: string | null
  categorySource?: 'scraped_data' | 'category' | null
  targetCountry: string
  affiliateLink: string | null
  brandDescription: string | null
  uniqueSellingPoints: string | null
  productHighlights: string | null
  targetAudience: string | null
  scrapeStatus: string
  scrapeError: string | null
  scrapedAt: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  // AI分析结果字段（仅显示评论分析和竞品分析）
  reviewAnalysis: string | null
  competitorAnalysis: string | null
  // 链接类型
  pageType: 'store' | 'product' | null
  // 可选的产品价格和佣金比例
  productPrice: string | null
  commissionPayout: string | null
  storeProductLinks?: string[]
}

interface PerformanceSummary {
  campaignCount: number
  impressions: number
  clicks: number
  conversions: number
  commission: number
  costUsd: number
  ctr: number
  avgCpcUsd: number
  conversionRate: number
  commissionPerClick: number
  dateRange: {
    start: string
    end: string
  }
}

interface CampaignPerformance {
  campaignId: number
  campaignName: string
  googleCampaignId: string | null
  adsAccountCurrency?: string | null
  impressions: number
  clicks: number
  conversions: number
  commission: number
  costUsd: number
  ctr: number
  cpcUsd: number
  conversionRate: number
  commissionPerClick: number
}

interface ROIData {
  totalCostUsd: number
  totalRevenueUsd: number
  roiPercentage: number
  profitUsd: number
  conversions: number
  commission: number
  avgOrderValue: number
}

function OfferTrendsSectionSkeleton() {
  return (
    <Card className="mb-6">
      <CardContent className="pt-6">
        <div className="animate-pulse space-y-3">
          <div className="h-5 w-32 rounded bg-gray-100" />
          <div className="h-[280px] rounded bg-gray-100" />
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * 根据国家代码获取Amazon域名
 * 🔧 2025-12-11添加：用于前端生成正确的竞品链接
 */
function getAmazonDomain(countryCode: string): string {
  const domainMap: Record<string, string> = {
    'US': 'amazon.com',
    'UK': 'amazon.co.uk',
    'DE': 'amazon.de',
    'FR': 'amazon.fr',
    'IT': 'amazon.it',
    'ES': 'amazon.es',
    'JP': 'amazon.co.jp',
    'CA': 'amazon.ca',
    'AU': 'amazon.com.au',
    'IN': 'amazon.in',
    'MX': 'amazon.com.mx',
    'BR': 'amazon.com.br',
  }
  return domainMap[countryCode] || 'amazon.com'
}

/**
 * 获取竞品的真实URL
 * 优先使用存储的productUrl，如果没有则根据国家代码动态生成
 */
function getCompetitorUrl(comp: any, targetCountry: string): string {
  if (comp.productUrl) {
    return comp.productUrl
  }
  if (comp.asin) {
    const domain = getAmazonDomain(targetCountry)
    return `https://www.${domain}/dp/${comp.asin}`
  }
  return ''
}

export default function OfferDetailPage() {
  const router = useRouter()
  const params = useParams()
  const offerId = params?.id as string

  const [offer, setOffer] = useState<Offer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [scraping, setScraping] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isRebuildDialogOpen, setIsRebuildDialogOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [rebuildError, setRebuildError] = useState<string | null>(null)
  const [removeGoogleAdsCampaignsOnDelete, setRemoveGoogleAdsCampaignsOnDelete] = useState(false)

  // Performance data states
  const [performanceLoading, setPerformanceLoading] = useState(true)
  const [performanceSummary, setPerformanceSummary] = useState<PerformanceSummary | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignPerformance[]>([])
  const [roi, setRoi] = useState<ROIData | null>(null)
  const [currencyInfo, setCurrencyInfo] = useState<{ currency: string; currencies: string[]; hasMixedCurrency: boolean } | null>(null)
  const [reportCurrency, setReportCurrency] = useState<string | null>(null)
  const [timeRange, setTimeRange] = useState<string>('30')
  const [avgOrderValue, setAvgOrderValue] = useState<string>('')

  // Trend data states
  const [trendsSectionMounted, setTrendsSectionMounted] = useState(false)
  const [trendsData, setTrendsData] = useState<TrendChartData[]>([])
  const [trendsLoading, setTrendsLoading] = useState(false)
  const [trendsError, setTrendsError] = useState<string | null>(null)

  useEffect(() => {
    fetchOffer()
  }, [offerId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTrendsSectionMounted(true)
    }, 250)

    return () => {
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (!offerId) return
    fetchPerformance()
    if (trendsSectionMounted) {
      fetchTrends()
    }
  }, [offerId, timeRange, avgOrderValue, reportCurrency, trendsSectionMounted])

  const fetchOffer = async () => {
    try {
      // HttpOnly Cookie自动携带，无需手动操作
      const response = await fetch(`/api/offers/${offerId}`, {
        credentials: 'include', // 确保发送cookie
      })

      if (!response.ok) {
        throw new Error('获取Offer失败')
      }

      const data = await response.json()
      setOffer(data.offer)
    } catch (err: any) {
      setError(err.message || '获取Offer失败')
    } finally {
      setLoading(false)
    }
  }

  const fetchPerformance = async () => {
    try {
      setPerformanceLoading(true)
      const avgOrderValueNum = parseFloat(avgOrderValue) || 0
      const currencyParam = reportCurrency ? `&currency=${encodeURIComponent(reportCurrency)}` : ''
      const response = await fetch(
        `/api/offers/${offerId}/performance?daysBack=${timeRange}&avgOrderValue=${avgOrderValueNum}${currencyParam}`,
        {
          credentials: 'include',
        }
      )

      if (!response.ok) {
        throw new Error('获取性能数据失败')
      }

      const data = await response.json()
      setPerformanceSummary(data.summary)
      setCampaigns(data.campaigns)
      setRoi(data.roi)
      if (data.currency && Array.isArray(data.currencies)) {
        setCurrencyInfo({
          currency: data.currency,
          currencies: data.currencies,
          hasMixedCurrency: Boolean(data.hasMixedCurrency),
        })
        if (!reportCurrency || !data.currencies.includes(reportCurrency)) {
          setReportCurrency(data.currency)
        }
      }
    } catch (err: any) {
      console.error('Fetch performance error:', err)
      // 不阻塞页面加载，只是性能数据获取失败
    } finally {
      setPerformanceLoading(false)
    }
  }

  const fetchTrends = async () => {
    try {
      setTrendsLoading(true)
      const currencyParam = reportCurrency ? `&currency=${encodeURIComponent(reportCurrency)}` : ''
      const response = await fetch(
        `/api/offers/${offerId}/trends?daysBack=${timeRange}${currencyParam}`,
        {
          credentials: 'include',
        }
      )

      if (!response.ok) {
        throw new Error('获取趋势数据失败')
      }

      const data = await response.json()
      setTrendsData(data.trends)
      setTrendsError(null)
      if (!currencyInfo && data.currency && Array.isArray(data.currencies)) {
        setCurrencyInfo({
          currency: data.currency,
          currencies: data.currencies,
          hasMixedCurrency: Boolean(data.hasMixedCurrency),
        })
        if (!reportCurrency || !data.currencies.includes(reportCurrency)) {
          setReportCurrency(data.currency)
        }
      }
    } catch (err: any) {
      setTrendsError(err.message || '加载趋势数据失败')
    } finally {
      setTrendsLoading(false)
    }
  }

  const selectedCurrency = reportCurrency || currencyInfo?.currency || 'USD'
  const availableCurrencies = currencyInfo?.currencies ?? []
  const formatMoney = (value: number, currencyCode: string = selectedCurrency) =>
    formatCurrency(value, currencyCode)

  const commissionDisplay = useMemo(() => {
    if (!offer?.commissionPayout) return null

    const parsedPayout = parseCommissionPayoutValue(offer.commissionPayout, {
      targetCountry: offer.targetCountry,
    })
    if (!parsedPayout) {
      return {
        mode: 'unknown' as const,
        payoutLabel: '佣金设置',
        payoutValue: offer.commissionPayout,
        absoluteValue: null as string | null,
        absoluteHint: null as string | null,
      }
    }

    const perConversion = getCommissionPerConversion({
      productPrice: offer.productPrice,
      commissionPayout: offer.commissionPayout,
      targetCountry: offer.targetCountry,
    })

    return {
      mode: parsedPayout.mode,
      payoutLabel: parsedPayout.mode === 'percent' ? '佣金比例' : '佣金设置（绝对值）',
      payoutValue: offer.commissionPayout,
      absoluteValue: perConversion ? formatCurrency(perConversion.amount, perConversion.currency) : null,
      absoluteHint: parsedPayout.mode === 'percent' && !perConversion
        ? '缺少产品价格，暂无法换算绝对佣金'
        : null,
    }
  }, [offer])

  const handleDelete = async () => {
    try {
      setDeleting(true)
      setDeleteError(null)

      const url = new URL(`/api/offers/${offerId}`, window.location.origin)
      if (removeGoogleAdsCampaignsOnDelete) {
        url.searchParams.set('removeGoogleAdsCampaigns', 'true')
      }

      const response = await fetch(url.toString(), {
        method: 'DELETE',
        credentials: 'include',
      })

      const data = await response.json()

      if (!response.ok) {
        // 在对话框内显示错误，不关闭对话框
        setDeleteError(data.error || '删除Offer失败')
        return
      }

      // 关闭对话框
      setIsDeleteDialogOpen(false)
      setDeleteError(null)
      setRemoveGoogleAdsCampaignsOnDelete(false)

      // 跳转到列表页
      router.push('/offers')
    } catch (err: any) {
      setDeleteError(err.message || '删除Offer失败')
    } finally {
      setDeleting(false)
    }
  }

  const handleScrape = async () => {
    setScraping(true)

    try {
      // HttpOnly Cookie自动携带，无需手动操作
      const response = await fetch(`/api/offers/${offerId}/scrape`, {
        method: 'POST',
        credentials: 'include', // 确保发送cookie
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '启动抓取失败')
      }

      showInfo('抓取已启动', '产品信息抓取已启动，请稍后刷新页面查看结果')

      // 3秒后自动刷新
      setTimeout(() => {
        fetchOffer()
      }, 3000)
    } catch (err: any) {
      showError('启动抓取失败', err.message || '请稍后重试')
    } finally {
      setScraping(false)
    }
  }

  const getScrapeStatusLabel = (status: string): string => {
    const labels: Record<string, string> = {
      pending: '待抓取',
      queued: '队列中',
      in_progress: '抓取中',
      completed: '已完成',
      failed: '失败',
    }
    return labels[status] || status
  }

  const getScrapeStatusColor = (status: string): string => {
    const colors: Record<string, string> = {
      pending: 'bg-gray-100 text-gray-800',
      queued: 'bg-yellow-100 text-yellow-800',
      in_progress: 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
    }
    return colors[status] || 'bg-gray-100 text-gray-800'
  }

  const handleRebuild = async () => {
    try {
      setRebuilding(true)
      setRebuildError(null)

      const response = await fetch(`/api/offers/${offerId}/rebuild`, {
        method: 'POST',
        credentials: 'include',
      })

      const data = await response.json()

      if (!response.ok) {
        setRebuildError(data.message || '重建Offer失败')
        return
      }

      // 关闭对话框
      setIsRebuildDialogOpen(false)
      setRebuildError(null)

      // 显示成功提示
      showSuccess('重建任务已创建', `Offer重建任务已启动，taskId: ${data.taskId}`)

      // 3秒后刷新页面数据
      setTimeout(() => {
        fetchOffer()
      }, 3000)
    } catch (err: any) {
      setRebuildError(err.message || '重建Offer失败')
    } finally {
      setRebuilding(false)
    }
  }

  const handleSyncData = async () => {
    setSyncing(true)

    try {
      const response = await fetch('/api/sync/trigger', {
        method: 'POST',
        credentials: 'include',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '触发数据同步失败')
      }

      const data = await response.json()
      showSuccess(
        '数据同步任务已加入队列',
        `任务ID: ${data.taskId}。可在任务队列(/admin/queue)中查看执行状态。`
      )

      // 10秒后自动刷新性能数据（给队列处理时间）
      setTimeout(() => {
        fetchPerformance()
      }, 10000)
    } catch (err: any) {
      showError('触发数据同步失败', err.message || '请稍后重试')
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  if (error || !offer) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">{error || '加载失败'}</p>
          <button
            onClick={() => router.push('/offers')}
            className="mt-4 text-indigo-600 hover:text-indigo-500"
          >
            返回列表
          </button>
        </div>
      </div>
    )
  }

  const resolvedFinalUrl = offer.finalUrl || offer.url
  const finalUrlSuffixValue = offer.finalUrlSuffix
  const finalUrlSuffixStatus =
    finalUrlSuffixValue === ''
      ? 'empty'
      : finalUrlSuffixValue
        ? 'present'
        : 'missing'
  const shouldShowOriginalUrl =
    Boolean(offer.finalUrl && offer.url && offer.finalUrl !== offer.url)
  const storeProductLinks = Array.isArray(offer.storeProductLinks)
    ? offer.storeProductLinks.map((link) => link.trim()).filter((link) => Boolean(link))
    : []

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <a href="/offers" className="text-indigo-600 hover:text-indigo-500 mr-4">
                ← 返回列表
              </a>
              <h1 className="text-xl font-bold text-gray-900">{offer.brand}</h1>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleSyncData}
                disabled={syncing}
                className="px-4 py-2 text-sm text-green-600 hover:text-green-800 disabled:opacity-50 flex items-center gap-1"
                title="从Google Ads同步最新广告数据"
              >
                <RefreshCcw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? '同步中...' : '广告数据同步'}
              </button>
              <button
                onClick={() => router.push(`/offers/${offerId}/edit`)}
                className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900"
              >
                编辑
              </button>
              <button
                onClick={() => setIsRebuildDialogOpen(true)}
                disabled={rebuilding || !offer.affiliateLink}
                className="px-4 py-2 text-sm text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                title={!offer.affiliateLink ? '缺少推广链接，无法重建' : '重新抓取并更新所有Offer信息'}
              >
                重建
              </button>
              <button
                onClick={() => {
                  setRemoveGoogleAdsCampaignsOnDelete(false)
                  setIsDeleteDialogOpen(true)
                }}
                disabled={deleting}
                className="px-4 py-2 text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* 抓取状态提示 */}
          <div className={`mb-6 px-4 py-3 rounded border ${
            offer.scrapeStatus === 'completed' ? 'bg-green-50 border-green-400 text-green-700' :
            offer.scrapeStatus === 'failed' ? 'bg-red-50 border-red-400 text-red-700' :
            'bg-blue-50 border-blue-400 text-blue-700'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getScrapeStatusColor(offer.scrapeStatus)}`}>
                  {getScrapeStatusLabel(offer.scrapeStatus)}
                </span>
                <span className="ml-3">
                  {offer.scrapeStatus === 'pending' && '产品信息后台异步抓取中...'}
                  {offer.scrapeStatus === 'in_progress' && '正在抓取产品信息...'}
                  {offer.scrapeStatus === 'completed' && `产品信息抓取完成 (${offer.scrapedAt ? new Date(offer.scrapedAt).toLocaleString('zh-CN') : ''})`}
                  {offer.scrapeStatus === 'failed' && `抓取失败: ${offer.scrapeError || '未知错误'}`}
                </span>
              </div>
              {offer.scrapeStatus === 'failed' && (
                <button
                  onClick={handleScrape}
                  disabled={scraping}
                  className="px-3 py-1 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  {scraping ? '启动中...' : '重新抓取'}
                </button>
              )}
            </div>
          </div>

          {/* 性能数据控制 */}
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-gray-900">投放表现</h2>
                  <div className="flex gap-2">
                    <Button
                      variant={timeRange === '7' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setTimeRange('7')}
                      className="text-xs sm:text-sm px-3"
                    >
                      7天
                    </Button>
                    <Button
                      variant={timeRange === '30' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setTimeRange('30')}
                      className="text-xs sm:text-sm px-3"
                    >
                      30天
                    </Button>
                    <Button
                      variant={timeRange === '90' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setTimeRange('90')}
                      className="text-xs sm:text-sm px-3"
                    >
                      90天
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  {availableCurrencies.length > 1 && (
                    <>
                      <span className="text-sm text-gray-600 shrink-0">币种:</span>
                      <Select value={selectedCurrency} onValueChange={(v) => setReportCurrency(v)}>
                        <SelectTrigger className="w-[92px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {availableCurrencies.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  )}
                  <span className="text-sm text-gray-600 shrink-0">AOV:</span>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={avgOrderValue}
                    onChange={(e) => setAvgOrderValue(e.target.value)}
                    className="w-[90px] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    style={{ textAlign: 'right', width: '90px' }}
                  />
                  <span className="text-sm text-gray-600">
                    {selectedCurrency}
                  </span>
                </div>
              </div>

              {performanceLoading ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                  <p className="mt-2 text-sm text-gray-600">加载性能数据...</p>
                </div>
              ) : performanceSummary ? (
                <>
                  {/* 性能汇总卡片 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    <Card>
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-gray-600">展示次数</p>
                            <p className="text-2xl font-bold text-gray-900 mt-1">
                              {(performanceSummary.impressions ?? 0).toLocaleString()}
                            </p>
                          </div>
                          <div className="h-12 w-12 bg-blue-100 rounded-full flex items-center justify-center">
                            <TrendingUp className="w-6 h-6 text-blue-600" />
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          CTR: {(Number(performanceSummary.ctr) || 0).toFixed(2)}%
                        </p>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-gray-600">点击次数</p>
                            <p className="text-2xl font-bold text-gray-900 mt-1">
                              {(performanceSummary.clicks ?? 0).toLocaleString()}
                            </p>
                          </div>
                          <div className="h-12 w-12 bg-green-100 rounded-full flex items-center justify-center">
                            <Target className="w-6 h-6 text-green-600" />
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          平均CPC:{' '}
                          {formatMoney(Number(performanceSummary.avgCpcUsd) || 0)}
                        </p>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-gray-600">佣金</p>
                            <p className="text-2xl font-bold text-gray-900 mt-1">
                              {formatMoney(Number(performanceSummary.commission ?? performanceSummary.conversions) || 0)}
                            </p>
                          </div>
                          <div className="h-12 w-12 bg-purple-100 rounded-full flex items-center justify-center">
                            <Activity className="w-6 h-6 text-purple-600" />
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          每次点击佣金: {formatMoney(Number(performanceSummary.commissionPerClick ?? performanceSummary.conversionRate) || 0)}
                        </p>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-gray-600">总花费</p>
                            <p className="text-2xl font-bold text-gray-900 mt-1">
                              {formatMoney(Number(performanceSummary.costUsd) || 0)}
                            </p>
                          </div>
                          <div className="h-12 w-12 bg-orange-100 rounded-full flex items-center justify-center">
                            <DollarSign className="w-6 h-6 text-orange-600" />
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          {performanceSummary.campaignCount} 个广告系列
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* ROI卡片 */}
                  {roi && (
                    <Card className="mb-6">
                      <CardContent className="pt-6">
                        <h3 className="text-md font-semibold text-gray-900 mb-4">投资回报率 (ROI)</h3>
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                          <div>
                            <p className="text-sm text-gray-600">总花费</p>
                            <p className="text-lg font-bold text-gray-900">
                              {formatMoney(Number(roi.totalCostUsd) || 0)}
                            </p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-600">总收入</p>
                            <p className="text-lg font-bold text-gray-900">
                              {formatMoney(Number(roi.totalRevenueUsd) || 0)}
                            </p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-600">利润</p>
                            <p className={`text-lg font-bold ${roi.profitUsd >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {formatMoney(Number(roi.profitUsd) || 0)}
                            </p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-600">ROI</p>
                            <p className={`text-lg font-bold ${roi.roiPercentage >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {(Number(roi.roiPercentage) || 0).toFixed(0)}%
                            </p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-600">佣金</p>
                            <p className="text-lg font-bold text-gray-900">{formatMoney(Number(roi.commission ?? roi.conversions) || 0)}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {trendsSectionMounted ? (
                    <OfferTrendsSection
                      timeRange={timeRange}
                      trendsData={trendsData}
                      trendsLoading={trendsLoading}
                      trendsError={trendsError}
                      selectedCurrency={selectedCurrency}
                      onRetry={fetchTrends}
                      formatMoney={formatMoney}
                    />
                  ) : (
                    <OfferTrendsSectionSkeleton />
                  )}

                  {/* Campaign对比表格 */}
                  {campaigns.length > 0 && (
                    <Card className="mb-6">
                      <CardContent className="pt-6">
                        <h3 className="text-md font-semibold text-gray-900 mb-4">广告系列表现对比</h3>
                        <div className="overflow-x-auto">
                          <Table className="[&_thead_th]:bg-white">
                            <TableHeader>
                              <TableRow>
                                <TableHead>广告系列名称</TableHead>
                                <TableHead className="text-right">展示</TableHead>
                                <TableHead className="text-right">点击</TableHead>
                                <TableHead className="text-right">CTR</TableHead>
                                <TableHead className="text-right">CPC</TableHead>
                                <TableHead className="text-right">佣金</TableHead>
                                <TableHead className="text-right">每次点击佣金</TableHead>
                                <TableHead className="text-right">花费</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {campaigns.map((campaign) => (
                                <TableRow key={campaign.campaignId}>
                                  <TableCell className="font-medium">
                                    <div>
                                      {campaign.campaignName}
                                      {campaign.googleCampaignId && (
                                        <div className="text-xs text-gray-500 font-mono mt-1">
                                          ID: {campaign.googleCampaignId}
                                        </div>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right">{(campaign.impressions ?? 0).toLocaleString()}</TableCell>
                                  <TableCell className="text-right">{(campaign.clicks ?? 0).toLocaleString()}</TableCell>
                                  <TableCell className="text-right">{(Number(campaign.ctr) || 0).toFixed(2)}%</TableCell>
                                  <TableCell className="text-right">
                                    {formatMoney(Number(campaign.cpcUsd) || 0, campaign.adsAccountCurrency || selectedCurrency)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatMoney(Number(campaign.commission ?? campaign.conversions) || 0, campaign.adsAccountCurrency || selectedCurrency)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatMoney(Number(campaign.commissionPerClick ?? campaign.conversionRate) || 0, campaign.adsAccountCurrency || selectedCurrency)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatMoney(Number(campaign.costUsd) || 0, campaign.adsAccountCurrency || selectedCurrency)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <p>暂无性能数据</p>
                  <p className="text-sm mt-2">创建广告系列并投放后，性能数据将在此显示</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 基础信息卡片 */}
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">基础信息</h2>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-gray-500">品牌名称</dt>
                <dd className="mt-1 text-sm text-gray-900">{offer.brand}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">链接类型</dt>
                <dd className="mt-1">
                  <span className={`px-2 py-1 text-xs font-semibold rounded ${
                    offer.pageType === 'store'
                      ? 'bg-purple-100 text-purple-800'
                      : 'bg-blue-100 text-blue-800'
                  }`}>
                    {offer.pageType === 'store' ? '🏪 店铺' : '📦 单品'}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">产品分类</dt>
                <dd
                  className="mt-1 text-sm text-gray-900 break-words"
                  title={offer.categoryRaw || offer.category || ''}
                >
                  {offer.category || '未分类'}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">目标国家</dt>
                <dd className="mt-1 text-sm text-gray-900">{offer.targetCountry}</dd>
              </div>
              {offer.productPrice && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">产品价格</dt>
                  <dd className="mt-1 text-sm text-gray-900">{offer.productPrice}</dd>
                </div>
              )}
              {commissionDisplay && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">{commissionDisplay.payoutLabel}</dt>
                  <dd className="mt-1 text-sm text-gray-900">{commissionDisplay.payoutValue}</dd>
                </div>
              )}
              {commissionDisplay && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">佣金绝对值（单次转化）</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {commissionDisplay.absoluteValue || (
                      <span className="text-gray-400">{commissionDisplay.absoluteHint || '暂无法计算'}</span>
                    )}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-sm font-medium text-gray-500">状态</dt>
                <dd className="mt-1">
                  <span className={`px-2 py-1 text-xs font-semibold rounded ${
                    offer.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {offer.isActive ? '启用' : '禁用'}
                  </span>
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-sm font-medium text-gray-500">Final URL（最终落地页）</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  <a
                    href={resolvedFinalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 hover:text-indigo-500 break-all"
                  >
                    {resolvedFinalUrl}
                  </a>
                  {!offer.finalUrl && (
                    <div className="text-xs text-amber-600 mt-1">Final URL未提取，当前显示原始URL</div>
                  )}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-sm font-medium text-gray-500">Final URL Suffix</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {finalUrlSuffixStatus === 'present' && (
                    <span className="font-mono break-all">{finalUrlSuffixValue}</span>
                  )}
                  {finalUrlSuffixStatus === 'empty' && (
                    <span className="text-gray-500">无参数</span>
                  )}
                  {finalUrlSuffixStatus === 'missing' && (
                    <span className="text-gray-400">未提取</span>
                  )}
                </dd>
              </div>
              {shouldShowOriginalUrl && (
                <div className="sm:col-span-2">
                  <dt className="text-sm font-medium text-gray-500">原始URL</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    <a href={offer.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-500 break-all">
                      {offer.url}
                    </a>
                  </dd>
                </div>
              )}
              {offer.affiliateLink && (
                <div className="sm:col-span-2">
                  <dt className="text-sm font-medium text-gray-500">联盟推广链接</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    <a href={offer.affiliateLink} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-500 break-all">
                      {offer.affiliateLink}
                    </a>
                  </dd>
                </div>
              )}
              {storeProductLinks.length > 0 && (
                <div className="sm:col-span-2">
                  <dt className="text-sm font-medium text-gray-500">单品推广链接</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    <ul className="space-y-1">
                      {storeProductLinks.map((link, index) => (
                        <li key={`${link}-${index}`}>
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-600 hover:text-indigo-500 break-all"
                          >
                            {link}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* 产品描述卡片 */}
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">产品描述</h2>
            <dl className="space-y-4">
              <div>
                <dt className="text-sm font-medium text-gray-500 mb-2">品牌描述</dt>
                <dd className="text-sm text-gray-900 whitespace-pre-wrap">
                  {offer.brandDescription || <span className="text-gray-400 italic">暂无</span>}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 mb-2">独特卖点</dt>
                <dd className="text-sm text-gray-900 whitespace-pre-wrap">
                  {offer.uniqueSellingPoints || <span className="text-gray-400 italic">暂无</span>}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 mb-2">产品亮点</dt>
                <dd className="text-sm text-gray-900 whitespace-pre-wrap">
                  {offer.productHighlights || <span className="text-gray-400 italic">暂无</span>}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 mb-2">目标受众</dt>
                <dd className="text-sm text-gray-900 whitespace-pre-wrap">
                  {offer.targetAudience || <span className="text-gray-400 italic">暂无</span>}
                </dd>
              </div>
            </dl>
          </div>

          {/* 评论分析卡片 */}
          {offer.reviewAnalysis && (() => {
            try {
              const reviewData = JSON.parse(offer.reviewAnalysis)
              return (
                <div className="bg-white shadow rounded-lg p-6 mb-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">
                    <span className="mr-2">📊</span>评论分析
                    {reviewData.totalReviews && (
                      <span className="ml-2 text-sm font-normal text-gray-500">
                        （基于 {reviewData.totalReviews} 条评论，平均评分 {reviewData.averageRating}⭐）
                      </span>
                    )}
                  </h2>
                  <dl className="space-y-4">
                    {/* 情感分布 */}
                    {reviewData.sentimentDistribution && (
                      <div>
                        <dt className="text-sm font-medium text-gray-500 mb-2">情感分布</dt>
                        <dd className="flex gap-4 text-sm">
                          <span className="text-green-600">👍 好评 {typeof reviewData.sentimentDistribution.positive === 'number' ? reviewData.sentimentDistribution.positive : reviewData.sentimentDistribution.positive?.percentage || 0}%</span>
                          <span className="text-gray-600">😐 中立 {typeof reviewData.sentimentDistribution.neutral === 'number' ? reviewData.sentimentDistribution.neutral : reviewData.sentimentDistribution.neutral?.percentage || 0}%</span>
                          <span className="text-red-600">👎 差评 {typeof reviewData.sentimentDistribution.negative === 'number' ? reviewData.sentimentDistribution.negative : reviewData.sentimentDistribution.negative?.percentage || 0}%</span>
                        </dd>
                      </div>
                    )}
                    {/* 正面关键词 */}
                    {reviewData.topPositiveKeywords && reviewData.topPositiveKeywords.length > 0 && (
                      <div>
                        <dt className="text-sm font-medium text-gray-500 mb-2">用户好评点</dt>
                        <dd className="text-sm text-gray-900">
                          <ul className="list-disc list-inside space-y-2">
                            {reviewData.topPositiveKeywords.map((item: any, idx: number) => (
                              <li key={idx} className="text-green-700">
                                <strong>{item.keyword}</strong>
                                {item.frequency && (
                                  <span className="text-gray-600 text-xs ml-1">
                                    （提及频率: {typeof item.frequency === 'number' ? `${item.frequency}次` : item.frequency}）
                                  </span>
                                )}
                                {item.context && <p className="ml-5 text-gray-600 text-xs mt-1">{item.context}</p>}
                              </li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                    )}
                    {/* 负面关键词 */}
                    {reviewData.topNegativeKeywords && reviewData.topNegativeKeywords.length > 0 && (
                      <div>
                        <dt className="text-sm font-medium text-gray-500 mb-2">用户痛点</dt>
                        <dd className="text-sm text-gray-900">
                          <ul className="list-disc list-inside space-y-2">
                            {reviewData.topNegativeKeywords.map((item: any, idx: number) => (
                              <li key={idx} className="text-red-700">
                                <strong>{item.keyword}</strong>
                                {item.frequency && (
                                  <span className="text-gray-600 text-xs ml-1">
                                    （提及频率: {typeof item.frequency === 'number' ? `${item.frequency}次` : item.frequency}）
                                  </span>
                                )}
                                {item.context && <p className="ml-5 text-gray-600 text-xs mt-1">{item.context}</p>}
                              </li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                    )}
                    {/* 购买原因 */}
                    {reviewData.purchaseReasons && reviewData.purchaseReasons.length > 0 && (
                      <div>
                        <dt className="text-sm font-medium text-gray-500 mb-2">购买原因</dt>
                        <dd className="text-sm text-gray-900">
                          <ul className="list-disc list-inside space-y-2">
                            {reviewData.purchaseReasons.map((item: any, idx: number) => (
                              <li key={idx}>
                                <strong>{typeof item === 'string' ? item : item.reason}</strong>
                                {typeof item === 'object' && item.frequency && (
                                  <span className="text-gray-500 text-xs ml-1">
                                    （{typeof item.frequency === 'number' ? `${item.frequency}人` : item.frequency}）
                                  </span>
                                )}
                                {typeof item === 'object' && (item.description || item.evidence) && (
                                  <p className="ml-5 text-gray-600 text-xs mt-1">{item.description || item.evidence}</p>
                                )}
                              </li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                    )}
                    {/* 真实使用场景 */}
                    {reviewData.realUseCases && reviewData.realUseCases.length > 0 && (
                      <div>
                        <dt className="text-sm font-medium text-gray-500 mb-2">使用场景</dt>
                        <dd className="text-sm text-gray-900">
                          <ul className="list-disc list-inside space-y-2">
                            {reviewData.realUseCases.map((item: any, idx: number) => (
                              <li key={idx}>
                                <strong>{typeof item === 'string' ? item : (item.scenario || item.useCase)}</strong>
                                {typeof item === 'object' && item.mentions && (
                                  <span className="text-gray-600 text-xs ml-1">
                                    （提及频率: {typeof item.mentions === 'number' ? `${item.mentions}次` : item.mentions}）
                                  </span>
                                )}
                                {typeof item === 'object' && (item.description || item.evidence) && (
                                  <p className="ml-5 text-gray-600 text-xs mt-1">{item.description || item.evidence}</p>
                                )}
                                {typeof item === 'object' && item.examples && item.examples.length > 0 && (
                                  <ul className="ml-5 mt-1 text-gray-600 text-xs list-none">
                                    {item.examples.map((ex: string, exIdx: number) => (
                                      <li key={exIdx}>• {ex}</li>
                                    ))}
                                  </ul>
                                )}
                              </li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                    )}
                    {/* 用户画像 */}
                    {reviewData.userProfiles && reviewData.userProfiles.length > 0 && (
                      <div>
                        <dt className="text-sm font-medium text-gray-500 mb-2">用户画像</dt>
                        <dd className="text-sm text-gray-900">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {reviewData.userProfiles.map((profile: any, idx: number) => {
                              // 🔥 2025-12-16修复：适配字符串格式（AI返回）和对象格式（TypeScript定义）
                              const isString = typeof profile === 'string'
                              // 解析字符串格式："The Multi-Pet Owner: Their primary challenge..."
                              const [title, ...descParts] = isString ? profile.split(': ') : []
                              const description = descParts.join(': ')

                              return (
                                <div key={idx} className="bg-gray-50 p-3 rounded">
                                  <div className="flex justify-between items-start">
                                    <div className="font-medium text-blue-700">
                                      {isString ? title : (profile.type || profile.profile)}
                                    </div>
                                    {!isString && profile.percentage && (
                                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                                        {profile.percentage}%
                                      </span>
                                    )}
                                  </div>
                                  {(isString ? description : (profile.primaryNeed || profile.description)) && (
                                    <p className="mt-1 text-xs text-gray-600">
                                      {isString ? description : (profile.primaryNeed || profile.description)}
                                    </p>
                                  )}
                                  {!isString && profile.indicators && profile.indicators.length > 0 && (
                                    <ul className="mt-1 text-xs text-gray-600">
                                      {profile.indicators.map((ind: string, indIdx: number) => (
                                        <li key={indIdx}>• {ind}</li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </dd>
                      </div>
                    )}
                    {/* 常见问题 */}
                    {reviewData.commonPainPoints && reviewData.commonPainPoints.length > 0 && (
                      <div>
                        <dt className="text-sm font-medium text-gray-500 mb-2">常见问题</dt>
                        <dd className="text-sm text-gray-900">
                          <ul className="space-y-2">
                            {reviewData.commonPainPoints.map((item: any, idx: number) => (
                              <li key={idx} className="bg-red-50 p-2 rounded">
                                <div className="flex items-center gap-2">
                                  <span className="text-red-700 font-medium">{typeof item === 'string' ? item : (item.issue || item.painPoint)}</span>
                                  {item.severity && (
                                    <Badge variant={item.severity === 'high' ? 'destructive' : item.severity === 'moderate' ? 'secondary' : 'outline'}>
                                      {item.severity === 'high' ? '严重' : item.severity === 'moderate' ? '中等' : '轻微'}
                                    </Badge>
                                  )}
                                </div>
                                {typeof item === 'object' && (item.description || item.evidence) && (
                                  <p className="mt-1 text-xs text-gray-600">{item.description || item.evidence}</p>
                                )}
                                {item.workarounds && item.workarounds.length > 0 && (
                                  <div className="mt-1 text-xs text-gray-600">
                                    解决方案：{item.workarounds.join('；')}
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                    )}
                    {/* 量化亮点 */}
                    {reviewData.quantitativeHighlights && reviewData.quantitativeHighlights.length > 0 && (
                      <div>
                        <dt className="text-sm font-medium text-gray-500 mb-2">量化亮点</dt>
                        <dd className="text-sm text-gray-900">
                          <ul className="space-y-2">
                            {reviewData.quantitativeHighlights.map((item: any, idx: number) => (
                              <li key={idx} className="bg-blue-50 p-2 rounded">
                                {/* 🔥 2025-12-16修复：适配多种数据格式 */}
                                {/* AI返回格式: {label, quote, value} */}
                                {/* TypeScript定义: {metric, value, source, adCopy} */}
                                {/* 旧格式: {highlight, description/evidence} */}
                                <div className="font-medium text-blue-800">
                                  {item.label || item.metric || item.highlight || item.adCopy}
                                  {item.value && <span className="ml-2 text-blue-600">({item.value})</span>}
                                </div>
                                {(item.quote || item.description || item.evidence || item.source) && (
                                  <p className="mt-1 text-xs text-gray-600 italic">
                                    {item.quote ? `"${item.quote}"` : (item.description || item.evidence || item.source)}
                                  </p>
                                )}
                              </li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                    )}
                    {/* 竞品对比提及 */}
                    {reviewData.competitorMentions && reviewData.competitorMentions.length > 0 && (
                      <div>
                        <dt className="text-sm font-medium text-gray-500 mb-2">竞品对比提及</dt>
                        <dd className="text-sm text-gray-900">
                          <ul className="space-y-2">
                            {reviewData.competitorMentions.map((item: any, idx: number) => (
                              <li key={idx} className="bg-gray-50 p-2 rounded">
                                <div className="flex items-center gap-2">
                                  {/* 🔥 2025-12-16修复：适配多种数据格式 */}
                                  {/* AI返回格式: {brand, context} */}
                                  {/* TypeScript定义: {brand, context, sentiment} */}
                                  {/* 旧格式: {competitor, sentiment, context} */}
                                  <span className="font-medium">{item.brand || item.competitor}</span>
                                  {item.sentiment && (
                                    <Badge variant={item.sentiment === 'positive' ? 'default' : item.sentiment === 'neutral' ? 'secondary' : 'outline'}>
                                      {item.sentiment}
                                    </Badge>
                                  )}
                                </div>
                                {item.context && <p className="mt-1 text-xs text-gray-600">{item.context}</p>}
                              </li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              )
            } catch {
              return null
            }
          })()}

          {/* 竞品分析卡片 */}
          {offer.competitorAnalysis && (() => {
            try {
              const competitorData = JSON.parse(offer.competitorAnalysis)
              return (
                <div className="bg-white shadow rounded-lg p-6 mb-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">
                    <span className="mr-2">🏆</span>竞品分析
                    {competitorData.totalCompetitors && (
                      <span className="ml-2 text-sm font-normal text-gray-500">
                        （分析了 {competitorData.totalCompetitors} 个竞品）
                      </span>
                    )}
                    {competitorData.overallCompetitiveness !== undefined && (() => {
                      // 🔥 2025-12-16修复：适配对象格式 {score, summary} 和数字格式
                      const competitivenessScore = typeof competitorData.overallCompetitiveness === 'object'
                        ? competitorData.overallCompetitiveness.score
                        : competitorData.overallCompetitiveness
                      return (
                        <Badge
                          variant={competitivenessScore >= 70 ? 'default' : competitivenessScore >= 50 ? 'secondary' : 'destructive'}
                          className="ml-2"
                        >
                          竞争力 {competitivenessScore}/100
                        </Badge>
                      )
                    })()}
                  </h2>
                  <dl className="space-y-4">
                    {/* 价格竞争力 */}
                    {competitorData.pricePosition && (
                      <div>
                        <dt className="text-sm font-medium text-gray-500 mb-2">价格竞争力</dt>
                        <dd className="text-sm text-gray-900">
                          <div className="bg-gray-50 p-3 rounded space-y-2">
                            <div className="flex items-center gap-4">
                              <span>我方价格: <strong>${competitorData.pricePosition.ourPrice}</strong></span>
                              <span>竞品均价: ${(Number(competitorData.pricePosition.avgCompetitorPrice) || 0).toFixed(2)}</span>
                              <Badge variant={
                                competitorData.pricePosition.priceAdvantage === 'lowest' ? 'default' :
                                competitorData.pricePosition.priceAdvantage === 'below_average' ? 'secondary' :
                                competitorData.pricePosition.priceAdvantage === 'average' ? 'outline' : 'destructive'
                              }>
                                {competitorData.pricePosition.priceAdvantage === 'lowest' ? '最低价' :
                                 competitorData.pricePosition.priceAdvantage === 'below_average' ? '低于均价' :
                                 competitorData.pricePosition.priceAdvantage === 'average' ? '均价水平' :
                                 competitorData.pricePosition.priceAdvantage === 'above_average' ? '高于均价' : '高端定价'}
                              </Badge>
                            </div>
                            {competitorData.pricePosition.savingsVsAvg && (
                              <div className="text-green-600 text-xs">{competitorData.pricePosition.savingsVsAvg}</div>
                            )}
                          </div>
                        </dd>
                      </div>
                    )}
                    {/* 评分竞争力 */}
                    {competitorData.ratingPosition && (
                      <div>
                        <dt className="text-sm font-medium text-gray-500 mb-2">评分竞争力</dt>
                        <dd className="text-sm text-gray-900">
                          <div className="bg-gray-50 p-3 rounded flex items-center gap-4">
                            <span>我方评分: <strong>{competitorData.ratingPosition.ourRating}⭐</strong></span>
                            <span>竞品均分: {(Number(competitorData.ratingPosition.avgCompetitorRating) || 0).toFixed(1)}⭐</span>
                            <Badge variant={
                              competitorData.ratingPosition.ratingAdvantage === 'top_rated' ? 'default' :
                              competitorData.ratingPosition.ratingAdvantage === 'above_average' ? 'secondary' : 'outline'
                            }>
                              {competitorData.ratingPosition.ratingAdvantage === 'top_rated' ? '评分最高' :
                               competitorData.ratingPosition.ratingAdvantage === 'above_average' ? '高于均分' :
                               competitorData.ratingPosition.ratingAdvantage === 'average' ? '均分水平' : '低于均分'}
                            </Badge>
                          </div>
                        </dd>
                      </div>
                    )}
                    {/* 独特卖点 */}
                    {competitorData.uniqueSellingPoints && competitorData.uniqueSellingPoints.length > 0 && (
                      <div>
                        <dt className="text-sm font-medium text-gray-500 mb-2">独特卖点 (USP)</dt>
                        <dd className="text-sm text-gray-900">
                          <ul className="space-y-2">
                            {competitorData.uniqueSellingPoints.map((usp: any, idx: number) => (
                              <li key={idx} className="bg-green-50 p-2 rounded flex items-start gap-2">
                                <Badge variant={usp.significance === 'high' ? 'default' : usp.significance === 'medium' ? 'secondary' : 'outline'} className="shrink-0">
                                  {usp.significance === 'high' ? '高度差异化' : usp.significance === 'medium' ? '中度差异化' : '轻度差异化'}
                                </Badge>
                                <div>
                                  <div className="font-medium text-green-800">{usp.usp}</div>
                                  {usp.differentiator && <div className="text-xs text-gray-600 mt-1">{usp.differentiator}</div>}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                    )}
                    {/* 竞品优势（需应对） */}
                    {competitorData.competitorAdvantages && competitorData.competitorAdvantages.length > 0 && (
                      <div>
                        <dt className="text-sm font-medium text-gray-500 mb-2">竞品优势（需应对）</dt>
                        <dd className="text-sm text-gray-900">
                          <ul className="space-y-2">
                            {competitorData.competitorAdvantages.map((adv: any, idx: number) => (
                              <li key={idx} className="bg-yellow-50 p-2 rounded">
                                <div className="flex items-center gap-2">
                                  <span className="text-yellow-800 font-medium">{adv.advantage}</span>
                                  {adv.competitor && <span className="text-xs text-gray-500">— {adv.competitor}</span>}
                                </div>
                                {adv.howToCounter && (
                                  <div className="mt-1 text-xs text-blue-600">💡 应对策略：{adv.howToCounter}</div>
                                )}
                              </li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                    )}
                    {/* 功能对比 */}
                    {competitorData.featureComparison && competitorData.featureComparison.length > 0 && (
                      <div>
                        <dt className="text-sm font-medium text-gray-500 mb-2">功能对比</dt>
                        <dd className="text-sm text-gray-900">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                            {competitorData.featureComparison.map((feat: any, idx: number) => (
                              <div key={idx} className={`p-2 rounded ${feat.ourAdvantage ? 'bg-green-50 border border-green-200' : feat.weHave ? 'bg-gray-50' : 'bg-red-50'}`}>
                                <div className="flex items-center gap-1">
                                  <span>{feat.weHave ? '✅' : '❌'}</span>
                                  <span className={feat.ourAdvantage ? 'text-green-700 font-medium' : ''}>{feat.feature}</span>
                                </div>
                                <div className="text-xs text-gray-500">
                                  {feat.competitorsHave}/{competitorData.totalCompetitors || '?'} 竞品有此功能
                                </div>
                              </div>
                            ))}
                          </div>
                        </dd>
                      </div>
                    )}
                    {/* 竞品列表 */}
                    {competitorData.competitors && competitorData.competitors.length > 0 && (
                      <div>
                        <dt className="text-sm font-medium text-gray-500 mb-2">竞品列表</dt>
                        <dd className="text-sm text-gray-900">
                          <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">品牌/名称</th>
                                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">价格</th>
                                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">评分</th>
                                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">评论数</th>
                                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">来源</th>
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                {competitorData.competitors.slice(0, 8).map((comp: any, idx: number) => {
                                  // 🔧 2025-12-11修复：使用getCompetitorUrl获取正确的竞品链接
                                  const competitorUrl = getCompetitorUrl(comp, offer.targetCountry)
                                  return (
                                  <tr key={idx}>
                                    <td className="px-3 py-2 text-sm text-gray-900 max-w-[200px]">
                                      {competitorUrl && comp.asin !== 'market-benchmark' ? (
                                        <a href={competitorUrl} target="_blank" rel="noopener noreferrer" className="font-medium truncate text-blue-600 hover:text-blue-800 hover:underline block" title={comp.name}>
                                          {comp.name}
                                        </a>
                                      ) : (
                                        <div className="font-medium truncate" title={comp.name}>{comp.name}</div>
                                      )}
                                      {comp.brand && <div className="text-xs text-gray-500">{comp.brand}</div>}
                                    </td>
                                    <td className="px-3 py-2 text-sm text-gray-900">{comp.priceText || (comp.price ? `$${comp.price}` : '-')}</td>
                                    <td className="px-3 py-2 text-sm text-gray-900">{comp.rating ? `${comp.rating}⭐` : '-'}</td>
                                    <td className="px-3 py-2 text-sm text-gray-900">{comp.reviewCount?.toLocaleString() || '-'}</td>
                                    <td className="px-3 py-2 text-xs text-gray-500">
                                      {comp.source === 'amazon_compare' ? '对比表' :
                                       comp.source === 'amazon_also_viewed' ? '看了又看' :
                                       comp.source === 'amazon_similar' ? '相似商品' : comp.source || '-'}
                                    </td>
                                  </tr>
                                )})}
                              </tbody>
                            </table>
                          </div>
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              )
            } catch {
              return null
            }
          })()}

          {/* 系统信息卡片 */}
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">系统信息</h2>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-gray-500">创建时间</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {new Date(offer.createdAt).toLocaleString('zh-CN')}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">最后更新</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {new Date(offer.updatedAt).toLocaleString('zh-CN')}
                </dd>
              </div>
            </dl>
          </div>

        </div>
      </main>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={(open) => {
        setIsDeleteDialogOpen(open)
        if (!open) {
          setDeleteError(null)
          setRemoveGoogleAdsCampaignsOnDelete(false)
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除Offer</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  您确定要删除 <strong className="text-gray-900">{offer?.brand}</strong> 的Offer吗？
                </p>

                {/* 删除错误提示 */}
                {deleteError && (
                  <div className="bg-red-50 border border-red-200 rounded-md p-3">
                    <p className="text-sm text-red-800">{deleteError}</p>
                  </div>
                )}

                {!deleteError && (
                  <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
                    <p className="text-sm text-amber-800 font-medium mb-2">⚠️ 警告</p>
                    <ul className="text-sm text-amber-700 space-y-1 list-disc list-inside">
                      <li>此操作不可撤销</li>
                      <li>系统会自动暂停该Offer在各关联Ads账号下的已启用广告系列（仅暂停该账号下关联的广告系列），避免继续花费</li>
                      <li>所有相关数据将被永久删除</li>
                    </ul>
                    <div className="mt-3 flex items-start gap-3 rounded-md border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
                      <Checkbox
                        id="delete-remove-ads-detail"
                        checked={removeGoogleAdsCampaignsOnDelete}
                        onCheckedChange={(checked) => setRemoveGoogleAdsCampaignsOnDelete(checked as boolean)}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <Label htmlFor="delete-remove-ads-detail" className="text-sm font-medium cursor-pointer text-orange-900">
                          同时在 Ads 账号中删除对应广告系列（不可恢复）
                        </Label>
                        <p className="text-xs text-orange-700 mt-1">
                          仅删除该账号下与该Offer关联的广告系列
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} onClick={() => setDeleteError(null)}>
              取消
            </AlertDialogCancel>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              variant="destructive"
            >
              {deleting ? '删除中...' : deleteError ? '重试删除' : '确认删除'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rebuild Confirmation Dialog */}
      <AlertDialog open={isRebuildDialogOpen} onOpenChange={(open) => {
        setIsRebuildDialogOpen(open)
        if (!open) setRebuildError(null)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认重建Offer</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  您确定要重建 <strong className="text-gray-900">{offer?.brand}</strong> 的Offer吗？
                </p>

                {/* 重建错误提示 */}
                {rebuildError && (
                  <div className="bg-red-50 border border-red-200 rounded-md p-3">
                    <p className="text-sm text-red-800">{rebuildError}</p>
                  </div>
                )}

                {!rebuildError && (
                  <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                    <p className="text-sm text-blue-800 font-medium mb-2">ℹ️ 重建说明</p>
                    <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
                      <li>将重新抓取产品页面和店铺信息</li>
                      <li>重新运行AI分析生成所有内容</li>
                      <li>更新品牌信息、产品描述、评价分析、竞品分析等所有字段</li>
                      <li>处理时间约2-5分钟，后台异步执行</li>
                      <li><strong>注意：将覆盖现有所有数据</strong></li>
                    </ul>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rebuilding} onClick={() => setRebuildError(null)}>
              取消
            </AlertDialogCancel>
            <Button
              onClick={handleRebuild}
              disabled={rebuilding}
              variant="default"
            >
              {rebuilding ? '启动中...' : rebuildError ? '重试' : '确认重建'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
