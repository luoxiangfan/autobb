'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { showError } from '@/lib/toast-utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  LazyBudgetTrendChart,
  LazyCampaignBudgetChart,
  LazyBudgetUtilizationChart,
  LazyOfferBudgetChart,
} from '@/components/LazyChartLoader'
import {
  Download,
  TrendingUp,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Activity,
  Target,
  RefreshCw,
  CalendarDays,
} from 'lucide-react'
import { useBudgetAnalytics } from '@/lib/hooks/useAnalytics'
import { formatCurrency } from '@/lib/currency'
import { formatCurrency as formatCurrencyDashboard, formatMultiCurrency } from '@/lib/utils'
import { DateRangePicker, type DateRange } from '@/components/ui/date-range-picker'


type BudgetAnalyticsTimeRange = '7' | '14' | '30' | 'custom'

interface BudgetData {
  overall: {
    totalBudget: number
    totalSpent: number
    remaining: number
    utilizationRate: number
    dailyAvgSpend: number
    projectedTotalSpend: number
    activeCampaigns: number
  }
  byCampaign: Array<{
    campaignId: number
    campaignName: string
    offerBrand: string
    budgetType: string
    budget: number
    spent: number
    remaining: number
    utilizationRate: number
    dailyAvgSpend: number
    daysRemaining: number
    conversions: number
    isOverBudget: boolean
    isNearBudget: boolean
    status: string
  }>
  trend: Array<{
    date: string
    dailySpent: number
    cumulativeSpent: number
  }>
  byOffer: Array<{
    offerId: number
    brand: string
    productName: string
    allocatedBudget: number
    spent: number
    utilizationRate: number
    campaignCount: number
    conversions: number
  }>
  alerts: Array<{
    type: string
    severity: string
    message: string
    campaigns?: Array<{
      id: number
      name: string
      overBy?: number
      remaining?: number
      daysRemaining?: number
      utilizationRate?: number
    }>
  }>
  recommendations: Array<{
    type: string
    message: string
    campaigns: string[]
  }>
}

export default function BudgetAnalyticsPage() {
  const router = useRouter()

  // Date filters
  const [timeRange, setTimeRange] = useState<BudgetAnalyticsTimeRange>('30')
  const [startDate, setStartDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 30)
    return date.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const [dateRange, setDateRange] = useState<DateRange | undefined>()
  const [appliedCustomRange, setAppliedCustomRange] = useState<{ startDate: string; endDate: string } | null>(null)
  const [reportCurrency, setReportCurrency] = useState<string | null>(null)

  // Use SWR for data fetching with automatic caching
  const { data, currencyInfo, error, isLoading: loading, refresh } = useBudgetAnalytics(startDate, endDate, reportCurrency)

  const selectedCurrency = reportCurrency || currencyInfo?.currency || 'USD'
  const availableCurrencies = currencyInfo?.currencies ?? []
  const money = (amount: number) => formatCurrency(amount, selectedCurrency)
  const moneyCsv = (amount: number) => `${selectedCurrency} ${Number(amount ?? 0).toFixed(2)}`

  const customRangeLabel = appliedCustomRange
    ? `${appliedCustomRange.startDate} ~ ${appliedCustomRange.endDate}`
    : '自定义'

  const applyPresetRange = (days: Exclude<BudgetAnalyticsTimeRange, 'custom'>) => {
    const end = new Date()
    const start = new Date(end)
    start.setDate(start.getDate() - (Number(days) - 1))
    const startStr = start.toISOString().split('T')[0]
    const endStr = end.toISOString().split('T')[0]
    setStartDate(startStr)
    setEndDate(endStr)
    setAppliedCustomRange(null)
  }

  const handleSelectPresetRange = (days: Exclude<BudgetAnalyticsTimeRange, 'custom'>) => {
    setTimeRange(days)
    applyPresetRange(days)
  }

  const formatDateInputValue = (date: Date): string => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const handleDateRangeChange = (range: DateRange | undefined) => {
    if (!range?.from || !range?.to) {
      setDateRange(range)
      return
    }

    const startDateStr = formatDateInputValue(range.from)
    const endDateStr = formatDateInputValue(range.to)

    if (startDateStr > endDateStr) return

    setDateRange(range)
    setAppliedCustomRange({
      startDate: startDateStr,
      endDate: endDateStr,
    })
    setStartDate(startDateStr)
    setEndDate(endDateStr)
    setTimeRange('custom')
  }


  useEffect(() => {
    if (!currencyInfo?.currency || !Array.isArray(currencyInfo.currencies)) return
    if (!reportCurrency || !currencyInfo.currencies.includes(reportCurrency)) {
      setReportCurrency(currencyInfo.currency)
    }
  }, [currencyInfo?.currency, currencyInfo?.currencies, reportCurrency])

  // Show error toast if fetch fails
  if (error) {
    showError('加载失败', error.message || 'Failed to load budget analytics')
  }

  const exportData = () => {
    if (!data) return

    // Create CSV content
    const csvRows: string[] = []

    // Overall section
    csvRows.push('预算整体分析')
    csvRows.push('指标,数值')
    csvRows.push(`总预算,${moneyCsv(data.overall.totalBudget)}`)
    csvRows.push(`已花费,${moneyCsv(data.overall.totalSpent)}`)
    csvRows.push(`剩余,${moneyCsv(data.overall.remaining)}`)
    csvRows.push(`使用率,${data.overall.utilizationRate}%`)
    csvRows.push(`日均花费,${moneyCsv(data.overall.dailyAvgSpend)}`)
    csvRows.push(`预计30天花费,${moneyCsv(data.overall.projectedTotalSpend)}`)
    csvRows.push('')

    // Campaign section
    csvRows.push('Campaign预算使用')
    csvRows.push('Campaign名称,品牌,预算,已花费,剩余,使用率,状态')
    data.byCampaign.forEach((row: BudgetData['byCampaign'][0]) => {
      csvRows.push(
        `${row.campaignName},${row.offerBrand},${row.budget},${row.spent},${row.remaining},${row.utilizationRate}%,${row.status}`
      )
    })
    csvRows.push('')

    // Offer section
    csvRows.push('Offer预算分配')
    csvRows.push('品牌,产品名称,分配预算,已花费,使用率,Campaign数量')
    data.byOffer.forEach((row: BudgetData['byOffer'][0]) => {
      csvRows.push(
        `${row.brand},${row.productName},${row.allocatedBudget},${row.spent},${row.utilizationRate}%,${row.campaignCount}`
      )
    })

    // Create and download file
    const csvContent = csvRows.join('\n')
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `budget-analysis-${startDate}-${endDate}.csv`
    link.click()
  }

  const getAlertIcon = (severity: string) => {
    if (severity === 'critical') return <AlertCircle className="h-5 w-5 text-red-600" />
    if (severity === 'warning') return <AlertCircle className="h-5 w-5 text-amber-600" />
    return <CheckCircle2 className="h-5 w-5 text-blue-600" />
  }

  const getAlertColor = (severity: string) => {
    if (severity === 'critical') return 'bg-red-50 border-red-200 text-red-800'
    if (severity === 'warning') return 'bg-amber-50 border-amber-200 text-amber-800'
    return 'bg-blue-50 border-blue-200 text-blue-800'
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">无法加载预算分析数据</p>
          <Button className="mt-4" onClick={() => refresh()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            重试
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <button
                onClick={() => router.push('/dashboard')}
                className="text-indigo-600 hover:text-indigo-500 mr-4"
              >
                ← 返回Dashboard
              </button>
              <h1 className="text-xl font-bold text-gray-900">预算分析</h1>
            </div>
            <div className="flex items-center gap-3">
              {/* 刷新按钮 */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refresh()}
                disabled={loading}
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              {/* 时间范围 */}
              <div className="flex bg-white rounded-lg border p-1 gap-1">
                {(['7', '14', '30'] as const).map((d) => (
                  <Button
                    key={d}
                    variant={timeRange === d ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => handleSelectPresetRange(d)}
                    className="h-8 px-4 text-sm whitespace-nowrap"
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
              {availableCurrencies.length > 1 && (
                <Select value={selectedCurrency} onValueChange={(v) => setReportCurrency(v)}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableCurrencies.map((c: string) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button onClick={exportData}>
                <Download className="h-4 w-4 mr-2" />
                导出报告
              </Button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0 space-y-6">
          {/* Alerts Section */}
          {data.alerts.length > 0 && (
            <div className="space-y-3">
              {data.alerts.map((alert: BudgetData['alerts'][0], index: number) => (
                <div
                  key={index}
                  className={`p-4 rounded-lg border ${getAlertColor(alert.severity)}`}
                >
                  <div className="flex items-start gap-3">
                    {getAlertIcon(alert.severity)}
                    <div className="flex-1">
                      <p className="font-semibold">{alert.message}</p>
                      {alert.campaigns && alert.campaigns.length > 0 && (
                        <ul className="mt-2 space-y-1 text-sm">
                          {alert.campaigns.map((campaign, idx) => (
                            <li key={idx}>
                              • {campaign.name}
                              {campaign.overBy && ` (超支 ${money(campaign.overBy)})`}
                              {campaign.remaining !== undefined && ` (剩余 ${money(campaign.remaining)})`}
                              {campaign.daysRemaining && ` (预计剩余 ${campaign.daysRemaining.toFixed(0)} 天)`}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Overall Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">预算使用率</CardTitle>
                <Activity className="h-4 w-4 text-indigo-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-gray-900">
                  {(data.overall?.utilizationRate ?? 0).toFixed(1)}%
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  {money(data.overall?.totalSpent ?? 0)} / {money(data.overall?.totalBudget ?? 0)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">剩余预算</CardTitle>
                <DollarSign className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {money(data.overall?.remaining ?? 0)}
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  可用预算
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">日均花费</CardTitle>
                <TrendingUp className="h-4 w-4 text-indigo-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-gray-900">
                  {money(data.overall?.dailyAvgSpend ?? 0)}
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  预计30天 {money(data.overall?.projectedTotalSpend ?? 0)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">活跃Campaign</CardTitle>
                <Target className="h-4 w-4 text-indigo-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-gray-900">
                  {data.overall?.activeCampaigns ?? 0}
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  正在投放中
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Recommendations */}
          {data.recommendations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>优化建议</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.recommendations.map((rec: BudgetData['recommendations'][0], index: number) => (
                    <div key={index} className="bg-blue-50 p-4 rounded-lg">
                      <p className="font-semibold text-blue-900">{rec.message}</p>
                      <ul className="mt-2 space-y-1 text-sm text-blue-800">
                        {rec.campaigns.map((campaign, idx) => (
                          <li key={idx}>• {campaign}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Budget Trend */}
          <Card>
            <CardHeader>
              <CardTitle>预算使用趋势</CardTitle>
            </CardHeader>
            <CardContent>
              <LazyBudgetTrendChart data={data.trend} currency={selectedCurrency} height={350} />
            </CardContent>
          </Card>

          {/* Budget Utilization Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>预算使用状态分布</CardTitle>
              </CardHeader>
              <CardContent>
                <LazyBudgetUtilizationChart data={data.byCampaign} height={350} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Offer预算分配</CardTitle>
              </CardHeader>
              <CardContent>
                <LazyOfferBudgetChart data={data.byOffer} currency={selectedCurrency} height={350} />
              </CardContent>
            </Card>
          </div>

          {/* Campaign Budget Comparison */}
          <Card>
            <CardHeader>
              <CardTitle>Campaign预算使用对比 (Top 10)</CardTitle>
            </CardHeader>
            <CardContent>
              <LazyCampaignBudgetChart data={data.byCampaign} currency={selectedCurrency} height={450} />
            </CardContent>
          </Card>

          {/* Detailed Campaign Table */}
          <Card>
            <CardHeader>
              <CardTitle>Campaign详细数据</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Campaign
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        品牌
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        预算
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        已花费
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        剩余
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        使用率
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        日均
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        预计剩余天数
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                        状态
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {data.byCampaign.map((campaign: BudgetData['byCampaign'][0]) => (
                      <tr key={campaign.campaignId} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900">{campaign.campaignName}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{campaign.offerBrand}</td>
                        <td className="px-4 py-3 text-sm text-right text-gray-900">
                          {money(campaign.budget)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-900">
                          {money(campaign.spent)}
                        </td>
                        <td className={`px-4 py-3 text-sm text-right ${campaign.remaining >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {money(campaign.remaining)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right">
                          <span
                            className={`font-semibold ${
                              campaign.isOverBudget
                                ? 'text-red-600'
                                : campaign.isNearBudget
                                ? 'text-amber-600'
                                : 'text-green-600'
                            }`}
                          >
                            {campaign.utilizationRate.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-600">
                          {money(campaign.dailyAvgSpend)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-600">
                          {campaign.daysRemaining > 0 && campaign.daysRemaining < 999
                            ? `${campaign.daysRemaining.toFixed(0)} 天`
                            : '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {campaign.isOverBudget ? (
                            <Badge variant="destructive">超预算</Badge>
                          ) : campaign.isNearBudget ? (
                            <Badge className="bg-amber-500">接近预算</Badge>
                          ) : (
                            <Badge className="bg-green-500">正常</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
