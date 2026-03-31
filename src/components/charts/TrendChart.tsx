'use client'

/**
 * TrendChart - 可复用的趋势图组件
 * 支持折线图展示性能趋势数据
 */

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, BarChart, Bar, ComposedChart } from 'recharts'
import { TrendingUp, Calendar } from 'lucide-react'

export interface TrendChartData {
  date: string
  [key: string]: string | number
}

export interface TrendChartMetric {
  key: string
  label: string
  color: string
  formatter?: (value: number) => string
  yAxisId?: 'left' | 'right' // 指定使用左侧还是右侧Y轴
  chartType?: 'line' | 'bar' // mixed 模式下指定该指标渲染类型
  stackId?: string // 柱状图堆叠分组
}

export interface TrendChartProps {
  data: TrendChartData[]
  metrics: TrendChartMetric[]
  title?: string
  description?: string
  headerActions?: React.ReactNode
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  chartType?: 'line' | 'bar' | 'mixed'
  timeRangeOptions?: number[]
  selectedTimeRange?: number
  onTimeRangeChange?: (days: number) => void
  height?: number
  showLegend?: boolean
  className?: string
  hideTimeRangeSelector?: boolean
  dualYAxis?: boolean // 是否启用双Y轴
}

const defaultTimeRangeOptions = [7, 14, 30]

export function TrendChart({
  data,
  metrics,
  title = '性能趋势',
  description,
  headerActions,
  loading = false,
  error = null,
  onRetry,
  chartType = 'line',
  timeRangeOptions = defaultTimeRangeOptions,
  selectedTimeRange,
  onTimeRangeChange,
  height = 300,
  showLegend = true,
  className = '',
  hideTimeRangeSelector = false,
  dualYAxis = false,
}: TrendChartProps) {
  const toNumberSafe = (value: unknown): number => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0
    if (typeof value === 'string') {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : 0
    }
    return 0
  }

  // Loading state
  if (loading) {
    return (
      <Card className={className}>
        <CardContent className="py-12">
          <div className="animate-pulse space-y-4">
            <div className="h-6 bg-gray-200 rounded w-48"></div>
            <div className="h-64 bg-gray-100 rounded"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Error state
  if (error) {
    return (
      <Card className={className}>
        <CardContent className="py-8">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <p className="text-red-800 font-medium">数据加载失败</p>
                <p className="text-red-600 text-sm mt-1">{error}</p>
              </div>
            </div>
            {onRetry && (
              <button
                onClick={onRetry}
                className="mt-4 px-4 py-2 bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition-colors text-sm font-medium"
              >
                重新加载
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  // No data state - 只有在没有数据点时才显示空状态
  // 如果有数据点（即使值都是0），也应该显示图表
  const hasNoData = data.length === 0

  // Build chart config
  const chartConfig: ChartConfig = metrics.reduce((acc, metric) => {
    acc[metric.key] = {
      label: metric.label,
      color: metric.color,
    }
    return acc
  }, {} as ChartConfig)

  // 计算Y轴domain
  let leftDomain: [number, number] | undefined = undefined;
  let rightDomain: [number, number] | undefined = undefined;

  if (data.length > 0) {
    if (dualYAxis) {
      // 双Y轴模式：分别计算左右轴的domain
      const leftMetrics = metrics.filter(m => m.yAxisId === 'left' || !m.yAxisId);
      const rightMetrics = metrics.filter(m => m.yAxisId === 'right');

      // 计算左轴domain
      if (leftMetrics.length > 0) {
        const leftMaxValues = leftMetrics.map(m =>
          Math.max(...data.map(d => {
            const val = d[m.key];
            return toNumberSafe(val);
          }))
        );
        const leftMax = Math.max(...leftMaxValues);
        if (leftMax > 0) {
          // 🔥 2026-01-02 修复：根据最大值智能计算合适的Y轴范围
          // 确保Y轴最大值至少比数据最大值大20%
          const targetMax = leftMax * 1.2;
          if (leftMax < 10) {
            leftDomain = [0, Math.ceil(targetMax)];
          } else if (leftMax < 100) {
            leftDomain = [0, Math.ceil(targetMax / 10) * 10];
          } else if (leftMax < 1000) {
            // 🔥 修复：使用50为单位，避免500被四舍五入到600的问题
            leftDomain = [0, Math.ceil(targetMax / 50) * 50];
          } else if (leftMax < 10000) {
            leftDomain = [0, Math.ceil(targetMax / 500) * 500];
          } else {
            leftDomain = [0, Math.ceil(targetMax / 1000) * 1000];
          }
        }
      }

      // 计算右轴domain
      if (rightMetrics.length > 0) {
        const rightMaxValues = rightMetrics.map(m =>
          Math.max(...data.map(d => {
            const val = d[m.key];
            return toNumberSafe(val);
          }))
        );
        const rightMax = Math.max(...rightMaxValues);
        if (rightMax > 0) {
          // 🔥 2026-01-02 修复：根据最大值智能计算合适的Y轴范围
          const targetMax = rightMax * 1.2;
          if (rightMax < 10) {
            rightDomain = [0, Math.ceil(targetMax)];
          } else if (rightMax < 100) {
            rightDomain = [0, Math.ceil(targetMax / 10) * 10];
          } else if (rightMax < 1000) {
            // 🔥 修复：使用50为单位
            rightDomain = [0, Math.ceil(targetMax / 50) * 50];
          } else if (rightMax < 10000) {
            rightDomain = [0, Math.ceil(targetMax / 500) * 500];
          } else {
            rightDomain = [0, Math.ceil(targetMax / 1000) * 1000];
          }
        }
      }
    } else {
      // 单Y轴模式：所有metrics使用同一个自适应domain
      const allMaxValues = metrics.map(m =>
        Math.max(...data.map(d => {
          const val = d[m.key];
          return toNumberSafe(val);
        }))
      );
      const maxValue = Math.max(...allMaxValues);
      if (maxValue > 0) {
        // 🔥 2026-01-02 修复：根据最大值智能计算合适的Y轴范围
        const targetMax = maxValue * 1.2;
        if (maxValue < 10) {
          leftDomain = [0, Math.ceil(targetMax)];
        } else if (maxValue < 100) {
          leftDomain = [0, Math.ceil(targetMax / 10) * 10];
        } else if (maxValue < 1000) {
          // 🔥 修复：使用50为单位
          leftDomain = [0, Math.ceil(targetMax / 50) * 50];
        } else if (maxValue < 10000) {
          leftDomain = [0, Math.ceil(targetMax / 500) * 500];
        } else {
          leftDomain = [0, Math.ceil(targetMax / 1000) * 1000];
        }
      }
    }
  }

  const isBar = chartType === 'bar'
  const isMixed = chartType === 'mixed'
  const hasBarMetrics = isBar || (isMixed && metrics.some((metric) => metric.chartType !== 'line'))
  const barSize = !hasBarMetrics ? undefined : data.length > 60 ? 4 : data.length > 30 ? 6 : data.length > 14 ? 10 : 14
  const enableHorizontalScroll = hasBarMetrics && data.length > 20
  const minChartWidth = enableHorizontalScroll
    ? Math.max(640, data.length * (12 + (barSize ?? 10) * metrics.length))
    : undefined

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600" />
            <div>
              <CardTitle className="text-base sm:text-lg">{title}</CardTitle>
              {description && (
                <CardDescription className="text-xs sm:text-sm">{description}</CardDescription>
              )}
            </div>
          </div>

          {/* Time range selector */}
          {(headerActions || (!hideTimeRangeSelector && onTimeRangeChange && selectedTimeRange !== undefined)) && (
            <div className="flex items-center gap-2">
              {!hideTimeRangeSelector && onTimeRangeChange && selectedTimeRange !== undefined && (
                <>
                  <Calendar className="h-4 w-4 text-muted-foreground hidden sm:block" />
                  <div className="flex gap-2">
                    {timeRangeOptions.map((days) => (
                      <Button
                        key={days}
                        variant={selectedTimeRange === days ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => onTimeRangeChange(days)}
                        className="text-xs sm:text-sm px-3"
                      >
                        {days}天
                      </Button>
                    ))}
                  </div>
                </>
              )}
              {headerActions}
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {hasNoData ? (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center justify-center" style={{ height: `${height}px` }}>
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-500 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <p className="text-blue-800 font-medium">暂无趋势数据</p>
                <p className="text-blue-600 text-sm mt-1">
                  当前时间段内暂无数据。开始创建广告并同步数据后，这里将显示趋势图表。
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className={enableHorizontalScroll ? 'w-full overflow-x-auto' : undefined}>
            <ChartContainer
              config={chartConfig}
              className="aspect-auto w-full"
              style={{ height: `${height}px`, minWidth: minChartWidth ? `${minChartWidth}px` : undefined }}
            >
              {chartType === 'line' ? (
                <LineChart data={data} margin={{ top: 5, right: dualYAxis ? 60 : 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={(value) => {
                      // 解析日期，处理 "YYYY-MM-DD" 格式
                      let date: Date
                      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
                        // 手动解析 "YYYY-MM-DD" 格式，避免时区问题
                        const [year, month, day] = value.split('-').map(Number)
                        date = new Date(year, month - 1, day)
                      } else {
                        date = new Date(value)
                      }
                      return `${date.getMonth() + 1}/${date.getDate()}`
                    }}
                  />
                {/* 左侧Y轴 */}
                <YAxis
                  yAxisId="left"
                  domain={leftDomain}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value) => {
                    if (value >= 1000000) {
                      return `${(value / 1000000).toFixed(1)}M`
                    }
                    if (value >= 1000) {
                      return `${(value / 1000).toFixed(1)}K`
                    }
                    return value.toString()
                  }}
                />
                {/* 右侧Y轴（仅在dualYAxis启用时显示） */}
                {dualYAxis && (
                  <YAxis
                    yAxisId="right"
                    domain={rightDomain}
                    orientation="right"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={(value) => {
                      if (value >= 1000000) {
                        return `${(value / 1000000).toFixed(1)}M`
                      }
                      if (value >= 1000) {
                        return `${(value / 1000).toFixed(1)}K`
                      }
                      return value.toString()
                    }}
                  />
                )}
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value) => {
                        // 解析日期，处理 "YYYY-MM-DD" 格式
                        let date: Date
                        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
                          // 手动解析 "YYYY-MM-DD" 格式，避免时区问题
                          const [year, month, day] = value.split('-').map(Number)
                          date = new Date(year, month - 1, day)
                        } else {
                          date = new Date(value)
                        }
                        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
                      }}
                      formatter={(value, name, item, index, payload) => {
                        const metric = metrics.find(m => m.key === name)
                        const label = metric?.label || name
                        const formattedValue = metric?.formatter
                          ? metric.formatter(value as number)
                          : (value as number).toLocaleString()
                        return (
                          <div className="flex flex-1 justify-between items-center leading-none gap-4">
                            <span className="text-muted-foreground">{label}</span>
                            <span className="font-mono font-medium tabular-nums text-foreground">
                              {formattedValue}
                            </span>
                          </div>
                        )
                      }}
                    />
                  }
                />
                {showLegend && <Legend />}
                {metrics.map((metric) => (
                  <Line
                    key={metric.key}
                    type="monotone"
                    dataKey={metric.key}
                    stroke={metric.color}
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                    name={metric.label}
                    yAxisId={dualYAxis ? (metric.yAxisId || 'left') : 'left'}
                  />
                ))}
              </LineChart>
            ) : chartType === 'bar' ? (
              <BarChart
                data={data}
                margin={{ top: 5, right: dualYAxis ? 60 : 30, left: 20, bottom: 5 }}
                barGap={2}
                barCategoryGap={enableHorizontalScroll ? 8 : '20%'}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value) => {
                    // 解析日期，处理 "YYYY-MM-DD" 格式
                    let date: Date
                    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
                      // 手动解析 "YYYY-MM-DD" 格式，避免时区问题
                      const [year, month, day] = value.split('-').map(Number)
                      date = new Date(year, month - 1, day)
                    } else {
                      date = new Date(value)
                    }
                    return `${date.getMonth() + 1}/${date.getDate()}`
                  }}
                />
                {/* 左侧Y轴 */}
                <YAxis
                  yAxisId="left"
                  domain={leftDomain}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value) => {
                    if (value >= 1000000) {
                      return `${(value / 1000000).toFixed(1)}M`
                    }
                    if (value >= 1000) {
                      return `${(value / 1000).toFixed(1)}K`
                    }
                    return value.toString()
                  }}
                />
                {/* 右侧Y轴（仅在dualYAxis启用时显示） */}
                {dualYAxis && (
                  <YAxis
                    yAxisId="right"
                    domain={rightDomain}
                    orientation="right"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={(value) => {
                      if (value >= 1000000) {
                        return `${(value / 1000000).toFixed(1)}M`
                      }
                      if (value >= 1000) {
                        return `${(value / 1000).toFixed(1)}K`
                      }
                      return value.toString()
                    }}
                  />
                )}
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value) => {
                        // 解析日期，处理 "YYYY-MM-DD" 格式
                        let date: Date
                        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
                          // 手动解析 "YYYY-MM-DD" 格式，避免时区问题
                          const [year, month, day] = value.split('-').map(Number)
                          date = new Date(year, month - 1, day)
                        } else {
                          date = new Date(value)
                        }
                        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
                      }}
                      formatter={(value, name, item, index, payload) => {
                        const metric = metrics.find(m => m.key === name)
                        const label = metric?.label || name
                        const formattedValue = metric?.formatter
                          ? metric.formatter(value as number)
                          : (value as number).toLocaleString()
                        return (
                          <div className="flex flex-1 justify-between items-center leading-none gap-4">
                            <span className="text-muted-foreground">{label}</span>
                            <span className="font-mono font-medium tabular-nums text-foreground">
                              {formattedValue}
                            </span>
                          </div>
                        )
                      }}
                    />
                  }
                />
                {showLegend && <Legend />}
                {metrics.map((metric) => (
                  <Bar
                    key={metric.key}
                    dataKey={metric.key}
                    fill={metric.color}
                    name={metric.label}
                    yAxisId={dualYAxis ? (metric.yAxisId || 'left') : 'left'}
                    stackId={metric.stackId}
                    radius={[4, 4, 0, 0]}
                    barSize={barSize}
                  />
                ))}
              </BarChart>
            ) : (
              <ComposedChart
                data={data}
                margin={{ top: 5, right: dualYAxis ? 60 : 30, left: 20, bottom: 5 }}
                barGap={2}
                barCategoryGap={enableHorizontalScroll ? 8 : '20%'}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value) => {
                    // 解析日期，处理 "YYYY-MM-DD" 格式
                    let date: Date
                    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
                      // 手动解析 "YYYY-MM-DD" 格式，避免时区问题
                      const [year, month, day] = value.split('-').map(Number)
                      date = new Date(year, month - 1, day)
                    } else {
                      date = new Date(value)
                    }
                    return `${date.getMonth() + 1}/${date.getDate()}`
                  }}
                />
                {/* 左侧Y轴 */}
                <YAxis
                  yAxisId="left"
                  domain={leftDomain}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value) => {
                    if (value >= 1000000) {
                      return `${(value / 1000000).toFixed(1)}M`
                    }
                    if (value >= 1000) {
                      return `${(value / 1000).toFixed(1)}K`
                    }
                    return value.toString()
                  }}
                />
                {/* 右侧Y轴（仅在dualYAxis启用时显示） */}
                {dualYAxis && (
                  <YAxis
                    yAxisId="right"
                    domain={rightDomain}
                    orientation="right"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={(value) => {
                      if (value >= 1000000) {
                        return `${(value / 1000000).toFixed(1)}M`
                      }
                      if (value >= 1000) {
                        return `${(value / 1000).toFixed(1)}K`
                      }
                      return value.toString()
                    }}
                  />
                )}
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value) => {
                        // 解析日期，处理 "YYYY-MM-DD" 格式
                        let date: Date
                        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
                          // 手动解析 "YYYY-MM-DD" 格式，避免时区问题
                          const [year, month, day] = value.split('-').map(Number)
                          date = new Date(year, month - 1, day)
                        } else {
                          date = new Date(value)
                        }
                        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
                      }}
                      formatter={(value, name, item, index, payload) => {
                        const metric = metrics.find(m => m.key === name)
                        const label = metric?.label || name
                        const formattedValue = metric?.formatter
                          ? metric.formatter(value as number)
                          : (value as number).toLocaleString()
                        return (
                          <div className="flex flex-1 justify-between items-center leading-none gap-4">
                            <span className="text-muted-foreground">{label}</span>
                            <span className="font-mono font-medium tabular-nums text-foreground">
                              {formattedValue}
                            </span>
                          </div>
                        )
                      }}
                    />
                  }
                />
                {showLegend && <Legend />}
                {metrics.map((metric) => {
                  const metricChartType = metric.chartType || 'bar'

                  if (metricChartType === 'line') {
                    return (
                      <Line
                        key={metric.key}
                        type="monotone"
                        dataKey={metric.key}
                        stroke={metric.color}
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                        name={metric.label}
                        yAxisId={dualYAxis ? (metric.yAxisId || 'left') : 'left'}
                      />
                    )
                  }

                  return (
                    <Bar
                      key={metric.key}
                      dataKey={metric.key}
                      fill={metric.color}
                      name={metric.label}
                      yAxisId={dualYAxis ? (metric.yAxisId || 'left') : 'left'}
                      stackId={metric.stackId}
                      radius={[4, 4, 0, 0]}
                      barSize={barSize}
                    />
                  )
                })}
              </ComposedChart>
            )}
            </ChartContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
