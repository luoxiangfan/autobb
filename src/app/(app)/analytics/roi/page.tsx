'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { showError } from '@/lib/toast-utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { LazyROITrendChart, LazyCampaignROIChart, LazyOfferROIChart } from '@/components/LazyChartLoader'
import { Download, TrendingUp, TrendingDown, DollarSign, Target, Percent, RefreshCw, CalendarDays, Coins } from 'lucide-react'
import { useROIAnalytics } from '@/lib/hooks/useAnalytics'
import { formatCurrency } from '@/lib/currency'
import { formatCurrency as formatCurrencyDashboard, formatMultiCurrency } from '@/lib/utils'
import { DateRangePicker, type DateRange } from '@/components/ui/date-range-picker'


type ROIAnalyticsTimeRange = '7' | '14' | '30' | 'custom'

interface ROIData {
  overall: {
    totalCost: number
    totalRevenue: number
    totalProfit: number
    roi: number
    conversions: number
    avgCommission: number
  }
  trend: Array<{
    date: string
    cost: number
    revenue: number
    profit: number
    roi: number
    conversions: number
  }>
  byCampaign: Array<{
    campaignId: number
    campaignName: string
    offerBrand: string
    cost: number
    revenue: number
    profit: number
    roi: number
    conversions: number
    ctr: number
    conversionRate: number
  }>
  byOffer: Array<{
    offerId: number
    brand: string
    offerName: string
    commissionAmount: number
    campaignCount: number
    cost: number
    revenue: number
    profit: number
    roi: number
    conversions: number
  }>
  efficiency: {
    costPerConversion: number
    revenuePerConversion: number
    profitMargin: number
    breakEvenPoint: number
  }
}

export default function ROIAnalyticsPage() {
  const router = useRouter()

  // Date filters
  const [timeRange, setTimeRange] = useState<ROIAnalyticsTimeRange>('30')
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
  const { data, currencyInfo, error, isLoading: loading, refresh } = useROIAnalytics(startDate, endDate, reportCurrency)

  const selectedCurrency = reportCurrency || currencyInfo?.currency || 'USD'
  const availableCurrencies = currencyInfo?.currencies ?? []
  const money = (amount: number) => formatCurrency(amount, selectedCurrency)
  const moneyCsv = (amount: number) => `${selectedCurrency} ${Number(amount ?? 0).toFixed(2)}`

  const customRangeLabel = appliedCustomRange
    ? `${appliedCustomRange.startDate} ~ ${appliedCustomRange.endDate}`
    : '自定义'

  const applyPresetRange = (days: Exclude<ROIAnalyticsTimeRange, 'custom'>) => {
    const end = new Date()
    const start = new Date(end)
    start.setDate(start.getDate() - (Number(days) - 1))
    const startStr = start.toISOString().split('T')[0]
    const endStr = end.toISOString().split('T')[0]
    setStartDate(startStr)
    setEndDate(endStr)
    setAppliedCustomRange(null)
  }

  const handleSelectPresetRange = (days: Exclude<ROIAnalyticsTimeRange, 'custom'>) => {
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
    showError('加载失败', error.message || 'Failed to load ROI analytics')
  }

  const exportData = () => {
    if (!data) return

    // Create CSV content
    const csvRows: string[] = []

    // Overall section
    csvRows.push('ROAS整体分析')
    csvRows.push('指标,数值')
    csvRows.push(`总花费,${moneyCsv(data.overall.totalCost)}`)
    csvRows.push(`总佣金,${moneyCsv(data.overall.totalRevenue)}`)
    csvRows.push(`ROAS,${data.overall.roi}x`)
    csvRows.push(`转化次数,${data.overall.conversions}`)
    csvRows.push('')

    // Trend section
    csvRows.push('ROAS趋势分析')
    csvRows.push('日期,花费,佣金,ROAS,转化次数')
    data.trend.forEach((row: ROIData['trend'][0]) => {
      csvRows.push(`${row.date},${row.cost},${row.revenue},${row.roi},${row.conversions}`)
    })
    csvRows.push('')

    // Campaign section
    csvRows.push('Campaign ROAS排名')
    csvRows.push('Campaign名称,品牌,花费,佣金,ROAS,转化次数')
    data.byCampaign.forEach((row: ROIData['byCampaign'][0]) => {
      csvRows.push(`${row.campaignName},${row.offerBrand},${row.cost},${row.revenue},${row.roi},${row.conversions}`)
    })
    csvRows.push('')

    // Offer section
    csvRows.push('Offer ROAS分析')
    csvRows.push('品牌,产品名称,花费,佣金,ROAS,转化次数')
    data.byOffer.forEach((row: ROIData['byOffer'][0]) => {
      csvRows.push(`${row.brand},${row.offerName},${row.cost},${row.revenue},${row.roi},${row.conversions}`)
    })

    // Create and download file
    const csvContent = csvRows.join('\n')
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `roas-analysis-${startDate}-${endDate}.csv`
    link.click()
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
          <p className="text-gray-600">无法加载ROI分析数据</p>
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
              <h1 className="text-xl font-bold text-gray-900">ROAS分析</h1>
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
          {/* Overall Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">总ROAS</CardTitle>
                {data.overall.roi >= 0 ? (
                  <TrendingUp className="h-4 w-4 text-green-600" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-600" />
                )}
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${data.overall.roi >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {(Number(data.overall.roi) || 0).toFixed(2)}x
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  广告支出回报率
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">总佣金</CardTitle>
                <Coins className="h-4 w-4 text-amber-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-gray-900">
                  {money(data.overall?.totalRevenue ?? 0)}
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  总花费 {money(data.overall?.totalCost ?? 0)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">转化效率</CardTitle>
                <Target className="h-4 w-4 text-indigo-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-gray-900">
                  {data.overall.conversions}
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  总转化次数 · {money(Number(data.efficiency.costPerConversion) || 0)}/次
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">佣金率</CardTitle>
                <Percent className="h-4 w-4 text-indigo-600" />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${data.efficiency.profitMargin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {(Number(data.efficiency.profitMargin) || 0).toFixed(2)}%
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  佣金占花费比例
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">单次转化佣金</CardTitle>
                <DollarSign className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-gray-900">
                  {money(Number(data.efficiency.revenuePerConversion) || 0)}
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  平均佣金 {money(Number(data.overall.avgCommission) || 0)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">盈亏平衡点</CardTitle>
                <Target className="h-4 w-4 text-amber-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-gray-900">
                  {data.efficiency.breakEvenPoint}
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  需要转化次数
                </p>
              </CardContent>
            </Card>
          </div>

          {/* ROAS Trend */}
          <Card>
            <CardHeader>
              <CardTitle>ROAS趋势分析</CardTitle>
            </CardHeader>
            <CardContent>
              <LazyROITrendChart data={data.trend} currency={selectedCurrency} height={350} />
            </CardContent>
          </Card>

          {/* Campaign ROAS Ranking */}
          <Card>
            <CardHeader>
              <CardTitle>Campaign ROAS排名 (Top 10)</CardTitle>
            </CardHeader>
            <CardContent>
              <LazyCampaignROIChart data={data.byCampaign} currency={selectedCurrency} height={450} />
            </CardContent>
          </Card>

          {/* Offer ROAS Analysis */}
          <Card>
            <CardHeader>
              <CardTitle>Offer ROAS分析</CardTitle>
            </CardHeader>
            <CardContent>
              <LazyOfferROIChart data={data.byOffer} currency={selectedCurrency} height={400} />
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
                        花费
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        佣金
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        ROAS
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        转化
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        CTR
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        转化率
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {data.byCampaign.map((campaign: ROIData['byCampaign'][0]) => (
                      <tr key={campaign.campaignId} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900">{campaign.campaignName}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{campaign.offerBrand}</td>
                        <td className="px-4 py-3 text-sm text-right text-gray-900">
                          {money(Number(campaign.cost) || 0)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-green-600">
                          {money(Number(campaign.revenue) || 0)}
                        </td>
                        <td className={`px-4 py-3 text-sm text-right font-bold ${campaign.roi >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {(Number(campaign.roi) || 0).toFixed(2)}x
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-900">
                          {campaign.conversions}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-600">
                          {(Number(campaign.ctr) || 0).toFixed(2)}%
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-600">
                          {(Number(campaign.conversionRate) || 0).toFixed(2)}%
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
