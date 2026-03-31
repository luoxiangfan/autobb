'use client'

/**
 * Campaign对比视图组件
 *
 * 功能：
 * - 并排展示同一Offer的多个Campaign变体
 * - 显示关键指标对比（CTR、CPC、花费、转化、ROI）
 * - Winner标识和行业均值对比
 * - 趋势图表（近7天CTR走势）
 * - 智能建议展示和一键应用
 */

import { useState, useEffect } from 'react'
import { Crown, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Loader2, ArrowUp, ArrowDown } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { formatCurrency } from '@/lib/currency'

interface CampaignPerformance {
  campaignId: number
  campaignName: string
  status: string
  impressions: number
  clicks: number
  cost: number
  conversions: number
  ctr: number
  cpc: number
  cpa: number
  conversionRate: number
  roi: number
  dailyTrends: Array<{
    date: string
    impressions: number
    clicks: number
    ctr: number
    cost: number
  }>
}

interface Winner {
  campaignId: number
  metric: 'ctr' | 'roi' | 'conversions'
  value: number
}

interface Recommendation {
  campaignId: number
  priority: 'high' | 'medium' | 'low'
  type: 'pause' | 'increase_budget' | 'decrease_budget' | 'optimize_creative'
  reason: string
  action: string
}

interface ComparisonData {
  offerId: number
  offerName: string
  dateRange: { start: string; end: string }
  campaigns: CampaignPerformance[]
  winner: Winner | null
  recommendations: Recommendation[]
  industryBenchmarks: {
    avgCtr: number
    avgCpc: number
    avgConversionRate: number
  }
  currency?: string
  currencies?: string[]
  hasMixedCurrency?: boolean
}

interface CampaignComparisonProps {
  offerId: number
}

export default function CampaignComparison({ offerId }: CampaignComparisonProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ComparisonData | null>(null)
  const [days, setDays] = useState<number>(7)
  const [currencyInfo, setCurrencyInfo] = useState<{ currency: string; currencies: string[]; hasMixedCurrency: boolean } | null>(null)
  const [reportCurrency, setReportCurrency] = useState<string | null>(null)

  const selectedCurrency = reportCurrency || currencyInfo?.currency || 'USD'
  const availableCurrencies = currencyInfo?.currencies ?? []
  const formatMoney = (value: number, currencyCode: string = selectedCurrency) =>
    formatCurrency(value, currencyCode)

  // ��载对比数据
  const loadComparison = async () => {
    setLoading(true)
    setError(null)

    try {
      const currencyParam = reportCurrency ? `&currency=${encodeURIComponent(reportCurrency)}` : ''
      const response = await fetch(`/api/campaigns/compare?offer_id=${offerId}&days=${days}${currencyParam}`, {
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error('Failed to load comparison data')
      }

      const result = await response.json()
      setData(result)
      if (result?.currency && Array.isArray(result?.currencies)) {
        setCurrencyInfo({
          currency: String(result.currency || 'USD'),
          currencies: result.currencies,
          hasMixedCurrency: Boolean(result.hasMixedCurrency),
        })
        if (!reportCurrency || !result.currencies.includes(reportCurrency)) {
          setReportCurrency(String(result.currency || 'USD'))
        }
      }
    } catch (err) {
      console.error('Load comparison error:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadComparison()
  }, [offerId, days, reportCurrency])

  // 优先级颜色配置
  const priorityConfig = {
    high: { color: 'bg-red-100 text-red-800 border-red-300', icon: AlertTriangle },
    medium: { color: 'bg-yellow-100 text-yellow-800 border-yellow-300', icon: TrendingDown },
    low: { color: 'bg-blue-100 text-blue-800 border-blue-300', icon: TrendingUp }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-3 text-sm text-gray-500">加载对比数据...</span>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>加载失败</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (!data || data.campaigns.length === 0) {
    return (
      <Alert>
        <AlertDescription>该Offer暂无Campaign数据</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{data.offerName} - Campaign对比</h2>
          <p className="text-sm text-gray-500">
            {data.dateRange.start} 至 {data.dateRange.end}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {availableCurrencies.length > 1 && (
            <Select value={selectedCurrency} onValueChange={(v) => setReportCurrency(v)}>
              <SelectTrigger className="w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableCurrencies.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={days.toString()} onValueChange={(v) => setDays(parseInt(v))}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">近7天</SelectItem>
              <SelectItem value="30">近30天</SelectItem>
              <SelectItem value="90">近90天</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Campaign对比卡片 */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {data.campaigns.map((campaign) => {
          const isWinner = data.winner?.campaignId === campaign.campaignId
          const campaignRecs = data.recommendations.filter(r => r.campaignId === campaign.campaignId)

          return (
            <Card key={campaign.campaignId} className={isWinner ? 'border-yellow-400 border-2' : ''}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{campaign.campaignName}</CardTitle>
                  {isWinner && (
                    <Badge variant="default" className="bg-yellow-500">
                      <Crown className="mr-1 h-3 w-3" />
                      Winner
                    </Badge>
                  )}
                </div>
                <CardDescription>
                  状态: <Badge variant={campaign.status === 'ENABLED' ? 'default' : 'secondary'}>
                    {campaign.status}
                  </Badge>
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* 核心指标 */}
                <div className="space-y-2">
                  <MetricRow
                    label="点击率 (CTR)"
                    value={`${((Number(campaign.ctr) || 0) * 100).toFixed(2)}%`}
                    benchmark={data.industryBenchmarks.avgCtr * 100}
                    current={(Number(campaign.ctr) || 0) * 100}
                  />
                  <MetricRow
                    label="每次点击成本 (CPC)"
                    value={formatMoney(Number(campaign.cpc) || 0)}
                    benchmark={data.industryBenchmarks.avgCpc}
                    current={Number(campaign.cpc) || 0}
                    inverse
                  />
                  <MetricRow
                    label="转化率"
                    value={`${((Number(campaign.conversionRate) || 0) * 100).toFixed(2)}%`}
                    benchmark={data.industryBenchmarks.avgConversionRate * 100}
                    current={(Number(campaign.conversionRate) || 0) * 100}
                  />
                  <Separator />
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-gray-500">展示</p>
                      <p className="font-semibold">{(campaign.impressions ?? 0).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">点击</p>
                      <p className="font-semibold">{(campaign.clicks ?? 0).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">花费</p>
                      <p className="font-semibold">{formatMoney(Number(campaign.cost) || 0)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">转化</p>
                      <p className="font-semibold">{campaign.conversions}</p>
                    </div>
                  </div>
                </div>

                {/* Campaign建议 */}
                {campaignRecs.length > 0 && (
                  <div className="space-y-2">
                    <Separator />
                    <p className="text-xs font-semibold text-gray-700">优化建议</p>
                    {campaignRecs.slice(0, 2).map((rec, idx) => {
                      const config = priorityConfig[rec.priority]
                      const Icon = config.icon

                      return (
                        <div key={idx} className={`rounded-lg border p-2 ${config.color}`}>
                          <div className="flex items-start gap-2">
                            <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
                            <div className="flex-1 space-y-1">
                              <p className="text-xs font-medium">{rec.reason}</p>
                              <p className="text-xs opacity-90">{rec.action}</p>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* CTR趋势图表 */}
      {data.campaigns.some(c => c.dailyTrends.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>CTR趋势对比</CardTitle>
            <CardDescription>近{days}天点击率变化趋势</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  type="category"
                  allowDuplicatedCategory={false}
                />
                <YAxis
                  label={{ value: 'CTR (%)', angle: -90, position: 'insideLeft' }}
                  tickFormatter={(value: any) => `${(value * 100).toFixed(1)}%`}
                />
                <Tooltip
                  formatter={(value: any) => `${(value * 100).toFixed(2)}%`}
                  labelFormatter={(label: any) => `日期: ${label}`}
                />
                <Legend />
                {data.campaigns.map((campaign, index) => {
                  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']
                  return (
                    <Line
                      key={campaign.campaignId}
                      data={campaign.dailyTrends}
                      type="monotone"
                      dataKey="ctr"
                      name={campaign.campaignName}
                      stroke={colors[index % colors.length]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  )
                })}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* 综合优化建议 */}
      {data.recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>智能优化建议</CardTitle>
            <CardDescription>基于规则引擎生成的优化方案</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.recommendations.map((rec, idx) => {
                const campaign = data.campaigns.find(c => c.campaignId === rec.campaignId)
                const config = priorityConfig[rec.priority]
                const Icon = config.icon

                return (
                  <div key={idx} className={`rounded-lg border p-4 ${config.color}`}>
                    <div className="flex items-start gap-3">
                      <Icon className="mt-1 h-5 w-5 flex-shrink-0" />
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{campaign?.campaignName}</span>
                          <Badge variant="outline">{rec.type}</Badge>
                          <Badge variant="outline">{rec.priority}</Badge>
                        </div>
                        <p className="text-sm">{rec.reason}</p>
                        <p className="text-sm font-medium">{rec.action}</p>
                      </div>
                      <Button size="sm" variant="outline">
                        应用
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/**
 * 指标行组件（带行业对比）
 */
interface MetricRowProps {
  label: string
  value: string
  benchmark: number
  current: number
  inverse?: boolean // 是否值越低越好（如CPC）
}

function MetricRow({ label, value, benchmark, current, inverse = false }: MetricRowProps) {
  const diff = current - benchmark
  const isGood = inverse ? diff < 0 : diff > 0
  const percentage = benchmark !== 0 ? (diff / benchmark) * 100 : 0

  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-600">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-semibold">{value}</span>
        {Math.abs(percentage) > 5 && (
          <div className={`flex items-center gap-1 ${isGood ? 'text-green-600' : 'text-red-600'}`}>
            {isGood ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            <span className="text-xs">{Math.abs(percentage).toFixed(0)}%</span>
          </div>
        )}
      </div>
    </div>
  )
}
