'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ArrowLeft,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  MousePointer,
  Eye,
  DollarSign,
  Target,
  Calendar
} from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/currency'

interface TrendData {
  date: string
  impressions: number
  clicks: number
  cost: number
  conversions: number
  ctr: number
  cpc: number
}

interface TrendSummary {
  totalImpressions: number
  totalClicks: number
  totalCost: number
  totalConversions: number
  avgCTR: number
  avgCPC: number
  currency?: string
  currencies?: string[]
  hasMixedCurrency?: boolean
}

/**
 * 趋势分析页面
 * 展示广告表现的时间趋势
 */
export default function TrendsPage() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [days, setDays] = useState('7')
  const [trends, setTrends] = useState<TrendData[]>([])
  const [summary, setSummary] = useState<TrendSummary | null>(null)
  const [currencyInfo, setCurrencyInfo] = useState<{ currency: string; currencies: string[]; hasMixedCurrency: boolean } | null>(null)
  const [reportCurrency, setReportCurrency] = useState<string | null>(null)

  const selectedCurrency = reportCurrency || currencyInfo?.currency || summary?.currency || 'USD'
  const availableCurrencies = currencyInfo?.currencies ?? summary?.currencies ?? []
  const formatMoney = (value: number, currencyCode: string = selectedCurrency) =>
    formatCurrency(value, currencyCode)

  useEffect(() => {
    fetchTrendsData()
  }, [days, reportCurrency])

  useEffect(() => {
    if (!currencyInfo?.currency || !Array.isArray(currencyInfo.currencies)) return
    if (!reportCurrency || !currencyInfo.currencies.includes(reportCurrency)) {
      setReportCurrency(currencyInfo.currency)
    }
  }, [currencyInfo?.currency, currencyInfo?.currencies, reportCurrency])

  const fetchTrendsData = async () => {
    try {
      setLoading(true)
      const currencyParam = reportCurrency ? `&currency=${encodeURIComponent(reportCurrency)}` : ''
      const response = await fetch(`/api/dashboard/trends?days=${days}${currencyParam}`)
      if (response.ok) {
        const result = await response.json()
        if (result.success) {
          setTrends(result.data.trends || [])
          setSummary(result.data.summary || null)
          if (result.data?.summary?.currency && Array.isArray(result.data?.summary?.currencies)) {
            setCurrencyInfo({
              currency: String(result.data.summary.currency || 'USD'),
              currencies: result.data.summary.currencies,
              hasMixedCurrency: Boolean(result.data.summary.hasMixedCurrency),
            })
          }
        }
      } else {
        toast.error('获取趋势数据失败')
      }
    } catch (error) {
      console.error('获取趋势数据失败:', error)
      toast.error('获取趋势数据失败')
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchTrendsData()
    setRefreshing(false)
    toast.success('数据已刷新')
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toFixed(0)
  }

  // 计算趋势变化
  const calculateTrend = (data: TrendData[], key: keyof TrendData) => {
    if (data.length < 2) return { change: 0, isUp: true }
    const recent = data.slice(-3).reduce((sum, d) => sum + (d[key] as number), 0) / Math.min(3, data.length)
    const earlier = data.slice(0, 3).reduce((sum, d) => sum + (d[key] as number), 0) / Math.min(3, data.length)
    if (earlier === 0) return { change: recent > 0 ? 100 : 0, isUp: recent > 0 }
    const change = ((recent - earlier) / earlier) * 100
    return { change: Math.abs(change), isUp: change >= 0 }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
      </div>
    )
  }

  const ctrTrend = calculateTrend(trends, 'ctr')
  const cpcTrend = calculateTrend(trends, 'cpc')
  const impressionsTrend = calculateTrend(trends, 'impressions')
  const clicksTrend = calculateTrend(trends, 'clicks')

  return (
    <div className="p-6 space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a
            href="/optimization/overview"
            className="inline-flex items-center justify-center w-10 h-10 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </a>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">趋势分析</h1>
            <p className="text-slate-500 mt-1">监控广告表现的时间趋势变化</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {availableCurrencies.length > 1 && (
            <Select value={selectedCurrency} onValueChange={(v) => setReportCurrency(v)}>
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableCurrencies.map((c: string) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[140px]">
              <Calendar className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">最近7天</SelectItem>
              <SelectItem value="14">最近14天</SelectItem>
              <SelectItem value="30">最近30天</SelectItem>
              <SelectItem value="60">最近60天</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={refreshing}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </div>

      {/* 汇总统计 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">总展示</p>
                <p className="text-2xl font-bold text-slate-900">
                  {formatNumber(summary?.totalImpressions || 0)}
                </p>
              </div>
              <div className={`flex items-center gap-1 text-sm ${impressionsTrend.isUp ? 'text-green-600' : 'text-red-600'}`}>
                {impressionsTrend.isUp ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                {impressionsTrend.change.toFixed(1)}%
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">总点击</p>
                <p className="text-2xl font-bold text-slate-900">
                  {formatNumber(summary?.totalClicks || 0)}
                </p>
              </div>
              <div className={`flex items-center gap-1 text-sm ${clicksTrend.isUp ? 'text-green-600' : 'text-red-600'}`}>
                {clicksTrend.isUp ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                {clicksTrend.change.toFixed(1)}%
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">平均CTR</p>
                <p className="text-2xl font-bold text-slate-900">
                  {(summary?.avgCTR || 0).toFixed(2)}%
                </p>
              </div>
              <div className={`flex items-center gap-1 text-sm ${ctrTrend.isUp ? 'text-green-600' : 'text-red-600'}`}>
                {ctrTrend.isUp ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                {ctrTrend.change.toFixed(1)}%
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">平均CPC</p>
                <p className="text-2xl font-bold text-slate-900">
                  {formatMoney(summary?.avgCPC || 0)}
                </p>
              </div>
              <div className={`flex items-center gap-1 text-sm ${!cpcTrend.isUp ? 'text-green-600' : 'text-red-600'}`}>
                {!cpcTrend.isUp ? <TrendingDown className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
                {cpcTrend.change.toFixed(1)}%
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 趋势数据表格 */}
      <Card>
        <CardHeader>
          <CardTitle>每日表现数据</CardTitle>
          <CardDescription>最近{days}天的详细数据</CardDescription>
        </CardHeader>
        <CardContent>
          {trends.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">日期</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-slate-600">展示</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-slate-600">点击</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-slate-600">CTR</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-slate-600">花费</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-slate-600">CPC</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-slate-600">转化</th>
                  </tr>
                </thead>
                <tbody>
                  {trends.map((row, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-slate-50">
                      <td className="py-3 px-4 text-sm text-slate-900">{row.date}</td>
                      <td className="py-3 px-4 text-sm text-slate-600 text-right">{formatNumber(row.impressions)}</td>
                      <td className="py-3 px-4 text-sm text-slate-600 text-right">{formatNumber(row.clicks)}</td>
                      <td className="py-3 px-4 text-sm text-slate-600 text-right">{row.ctr.toFixed(2)}%</td>
                      <td className="py-3 px-4 text-sm text-slate-600 text-right">{formatMoney(row.cost)}</td>
                      <td className="py-3 px-4 text-sm text-slate-600 text-right">{formatMoney(row.cpc)}</td>
                      <td className="py-3 px-4 text-sm text-slate-600 text-right">{row.conversions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12 text-slate-500">
              <Calendar className="w-16 h-16 mx-auto text-slate-300 mb-4" />
              <p className="text-lg font-medium">暂无数据</p>
              <p className="text-sm mt-1">所选时间范围内没有广告表现数据</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 趋势图表占位 */}
      <Card>
        <CardHeader>
          <CardTitle>趋势图表</CardTitle>
          <CardDescription>可视化展示表现变化趋势</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center bg-slate-50 rounded-lg border-2 border-dashed border-slate-200">
            <div className="text-center text-slate-500">
              <TrendingUp className="w-12 h-12 mx-auto mb-2 text-slate-300" />
              <p className="text-sm">图表功能开发中</p>
              <p className="text-xs mt-1">将展示CTR/CPC/展示量的时间趋势</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
