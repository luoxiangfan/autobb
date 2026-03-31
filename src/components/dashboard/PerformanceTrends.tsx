'use client'

/**
 * PerformanceTrends - P2-1优化新增 + P2-4移动端优化 + 多货币支持
 * 使用shadcn/ui Chart + Recharts展示广告表现数据趋势
 * 🔧 修复(2025-12-30): 支持多货币显示
 */

import { useEffect, useState } from 'react'
import { TrendingUp, Calendar } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, ResponsiveContainer } from 'recharts'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { safeToFixed, formatCurrency } from '@/lib/utils'
import { CURRENCY_SYMBOLS } from '@/lib/currency'

interface TrendData {
  date: string
  impressions: number
  clicks: number
  cost: number
  conversions: number
  ctr: number
  cpc: number
}

interface PerformanceTrendsData {
  trends: TrendData[]
  summary: {
    totalImpressions: number
    totalClicks: number
    totalCost: number
    totalConversions: number
    avgCTR: number
    avgCPC: number
    currency?: string // 🔧 新增(2025-12-30): 货币代码
  }
}

const chartConfig = {
  impressions: {
    label: '展示量',
    color: 'hsl(var(--chart-1))',
  },
  clicks: {
    label: '点击量',
    color: 'hsl(var(--chart-2))',
  },
  cost: {
    label: '花费',
    color: 'hsl(var(--chart-3))',
  },
  conversions: {
    label: '转化量',
    color: 'hsl(var(--chart-4))',
  },
  ctr: {
    label: 'CTR',
    color: 'hsl(var(--chart-5))',
  },
} satisfies ChartConfig

interface PerformanceTrendsProps {
  days: number
}

export function PerformanceTrends({ days }: PerformanceTrendsProps) {
  const [data, setData] = useState<PerformanceTrendsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeMetric, setActiveMetric] = useState<'volume' | 'rate'>('volume')

  // P2-4: 移动端检测
  const isMobile = useIsMobile()

  const fetchData = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/dashboard/trends?days=${days}`, {
        credentials: 'include'
      })
      if (!response.ok) {
        throw new Error('获取趋势数据失败')
      }
      const result = await response.json()
      setData(result.data)
      setError(null)
    } catch (err) {
      console.error('获取趋势数据失败:', err)
      setError(err instanceof Error ? err.message : '未知错误')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [days])

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="animate-pulse space-y-4">
            <div className="h-6 bg-gray-200 rounded w-48"></div>
            <div className="h-64 bg-gray-100 rounded"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <div>
            <p className="text-red-800 font-medium">数据加载失败</p>
            <p className="text-red-600 text-sm mt-1">{error}</p>
          </div>
        </div>
        <button
          onClick={fetchData}
          className="mt-4 px-4 py-2 bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition-colors text-sm font-medium"
        >
          重新加载
        </button>
      </div>
    )
  }

  if (!data) {
    return null
  }

  // 检测空数据场景
  const hasNoData = data.trends.length === 0 || (
    data.summary.totalImpressions === 0 &&
    data.summary.totalClicks === 0 &&
    data.summary.totalCost === 0 &&
    data.summary.totalConversions === 0
  )

  return (
    <Card>
      <CardHeader>
        {/* P2-4: 移动端优化 - 标题和日期选择器垂直排列 */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <TrendingUp className={`${isMobile ? 'h-5 w-5' : 'h-6 w-6'} text-blue-600`} />
            <div>
              <CardTitle className={isMobile ? 'text-base' : 'text-lg'}>
                广告表现趋势
              </CardTitle>
              <CardDescription className={isMobile ? 'text-xs' : ''}>
                过去{days}天的数据变化
              </CardDescription>
            </div>
          </div>
        </div>

        {/* 指标切换 - 移动端全宽 */}
        <div className="mt-4 flex gap-2 w-full sm:w-auto">
          <Button
            variant={activeMetric === 'volume' ? 'default' : 'outline'}
            className={isMobile ? 'flex-1 text-xs' : ''}
            size="sm"
            onClick={() => setActiveMetric('volume')}
          >
            数量指标
          </Button>
          <Button
            variant={activeMetric === 'rate' ? 'default' : 'outline'}
            className={isMobile ? 'flex-1 text-xs' : ''}
            size="sm"
            onClick={() => setActiveMetric('rate')}
          >
            比率指标
          </Button>
        </div>
      </CardHeader>

      {/* 暂无数据提示 */}
      {hasNoData && (
        <CardContent className="pb-0">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-500 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="text-blue-800 font-medium">暂无趋势数据</p>
                <p className="text-blue-600 text-sm mt-1">
                  当前时间段内暂无广告表现数据。开始创建Campaign并同步Google Ads数据后，这里将显示趋势图表。
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      )}

      {!hasNoData && (
        <CardContent>
          {/* 数量指标图表 - P2-4: 移动端高度调整 */}
          {activeMetric === 'volume' && (
            <ChartContainer
              config={chartConfig}
              className={isMobile ? 'h-[220px]' : 'h-[300px]'}
            >
              <LineChart
                data={data.trends}
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value) => {
                    const date = new Date(value)
                    return `${date.getMonth() + 1}/${date.getDate()}`
                  }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value) => {
                    if (value >= 1000) {
                      return `${safeToFixed(value / 1000, 1)}k`
                    }
                    return value.toString()
                  }}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="impressions"
                  stroke="var(--color-impressions)"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="clicks"
                  stroke="var(--color-clicks)"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="cost"
                  stroke="var(--color-cost)"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="conversions"
                  stroke="var(--color-conversions)"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ChartContainer>
          )}

          {/* 比率指标图表 - P2-4: 移动端高度调整 */}
          {activeMetric === 'rate' && (
            <ChartContainer
              config={chartConfig}
              className={isMobile ? 'h-[220px]' : 'h-[300px]'}
            >
              <LineChart
                data={data.trends}
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value) => {
                    const date = new Date(value)
                    return `${date.getMonth() + 1}/${date.getDate()}`
                  }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value) => `${safeToFixed(value, 2)}%`}
                />
                <ChartTooltip
                  content={<ChartTooltipContent formatter={(value) => {
                    // Handle array values from chart tooltip
                    if (Array.isArray(value)) {
                      return `${safeToFixed(value[0], 2)}%`
                    }
                    return `${safeToFixed(value, 2)}%`
                  }} />}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="ctr"
                  stroke="var(--color-ctr)"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                  name="CTR (%)"
                />
                <Line
                  type="monotone"
                  dataKey="cpc"
                  stroke="var(--color-cost)"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                  name={`CPC (${CURRENCY_SYMBOLS[String(data.summary?.currency || 'USD').toUpperCase()] || data.summary?.currency || 'USD'})`}
                />
              </LineChart>
            </ChartContainer>
          )}

          {/* 汇总统计 - P2-4: 移动端优化 */}
          <div className="mt-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
            <div className={`text-center ${isMobile ? 'p-2' : 'p-3'} bg-blue-50 rounded-lg`}>
              <p className="text-xs text-muted-foreground mb-1">总展示量</p>
              <p className={`${isMobile ? 'text-base' : 'text-lg'} font-bold text-blue-600`}>
                {isMobile && (data.summary?.totalImpressions ?? 0) >= 1000
                  ? `${safeToFixed((data.summary?.totalImpressions ?? 0) / 1000, 1)}k`
                  : (data.summary?.totalImpressions ?? 0).toLocaleString('en-US')}
              </p>
            </div>
            <div className={`text-center ${isMobile ? 'p-2' : 'p-3'} bg-green-50 rounded-lg`}>
              <p className="text-xs text-muted-foreground mb-1">总点击量</p>
              <p className={`${isMobile ? 'text-base' : 'text-lg'} font-bold text-green-600`}>
                {isMobile && (data.summary?.totalClicks ?? 0) >= 1000
                  ? `${safeToFixed((data.summary?.totalClicks ?? 0) / 1000, 1)}k`
                  : (data.summary?.totalClicks ?? 0).toLocaleString('en-US')}
              </p>
            </div>
            <div className={`text-center ${isMobile ? 'p-2' : 'p-3'} bg-purple-50 rounded-lg`}>
              <p className="text-xs text-muted-foreground mb-1">总花费</p>
              <p className={`${isMobile ? 'text-base' : 'text-lg'} font-bold text-purple-600`}>
                {formatCurrency(Number(data.summary?.totalCost) || 0, data.summary?.currency || 'USD', isMobile ? 0 : 2)}
              </p>
            </div>
            <div className={`text-center ${isMobile ? 'p-2' : 'p-3'} bg-orange-50 rounded-lg`}>
              <p className="text-xs text-muted-foreground mb-1">总转化量</p>
              <p className={`${isMobile ? 'text-base' : 'text-lg'} font-bold text-orange-600`}>
                {data.summary.totalConversions}
              </p>
            </div>
            <div className={`text-center ${isMobile ? 'p-2' : 'p-3'} bg-indigo-50 rounded-lg`}>
              <p className="text-xs text-muted-foreground mb-1">平均CTR</p>
              <p className={`${isMobile ? 'text-base' : 'text-lg'} font-bold text-indigo-600`}>
                {safeToFixed((data.summary?.avgCTR ?? 0) * 100, isMobile ? 1 : 2)}%
              </p>
            </div>
            <div className={`text-center ${isMobile ? 'p-2' : 'p-3'} bg-pink-50 rounded-lg`}>
              <p className="text-xs text-muted-foreground mb-1">平均CPC</p>
              <p className={`${isMobile ? 'text-base' : 'text-lg'} font-bold text-pink-600`}>
                {formatCurrency(data.summary?.avgCPC ?? 0, data.summary?.currency || 'USD', isMobile ? 1 : 2)}
              </p>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
