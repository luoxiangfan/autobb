'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DateRangePicker, type DateRange } from '@/components/ui/date-range-picker'
import { TrendChart, type TrendChartData } from '@/components/charts/TrendChart'

type DistributionStats = {
  status: Record<string, number>
  adStrength: Record<string, number>
  quality: Record<string, number>
  theme: Record<string, number>
}

type UsageStats = {
  selected: number
  notSelected: number
  total: number
  usageRate: number
}

interface CreativesAnalyticsSectionProps {
  timeRange: '7' | '14' | '30' | 'custom'
  dateRange: DateRange | undefined
  customRangeLabel: string
  trendsData: TrendChartData[]
  trendsLoading: boolean
  trendsError: string | null
  distributions: DistributionStats | null
  usageStats: UsageStats | null
  onSelectPresetTimeRange: (days: '7' | '14' | '30') => void
  onDateRangeChange: (range: DateRange | undefined) => void
  onRetry: () => void
}

export default function CreativesAnalyticsSection({
  timeRange,
  dateRange,
  customRangeLabel,
  trendsData,
  trendsLoading,
  trendsError,
  distributions,
  usageStats,
  onSelectPresetTimeRange,
  onDateRangeChange,
  onRetry,
}: CreativesAnalyticsSectionProps) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">创意统计</h3>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">时间范围:</span>
          <div className="flex gap-1">
            {(['7', '14', '30'] as const).map((days) => (
              <Button
                key={days}
                size="sm"
                variant={timeRange === days ? 'default' : 'ghost'}
                className={`h-8 px-3 text-sm ${timeRange === days ? '' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                onClick={() => onSelectPresetTimeRange(days)}
                aria-label={`${days}天`}
              >
                <span className="sm:hidden">{days}</span>
                <span className="hidden sm:inline">{days}天</span>
              </Button>
            ))}
            <DateRangePicker
              value={dateRange}
              onChange={onDateRangeChange}
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

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
        <div className="lg:col-span-2">
          <TrendChart
            data={trendsData}
            metrics={[
              { key: 'newCreatives', label: '新增创意', color: 'hsl(217, 91%, 60%)' },
            ]}
            title="新增创意趋势"
            description="每日新增创意数量"
            loading={trendsLoading}
            error={trendsError}
            onRetry={onRetry}
            height={220}
            hideTimeRangeSelector={true}
            chartType="bar"
          />
        </div>

        <div className="lg:col-span-2">
          <TrendChart
            data={trendsData}
            metrics={[
              { key: 'highQuality', label: '高质量(≥80)', color: 'hsl(142, 76%, 36%)' },
              { key: 'mediumQuality', label: '中等(60-79)', color: 'hsl(45, 93%, 47%)' },
              { key: 'lowQuality', label: '低质量(<60)', color: 'hsl(0, 84%, 60%)' },
            ]}
            title="创意质量分布趋势"
            description="按质量评分分类"
            loading={trendsLoading}
            error={trendsError}
            onRetry={onRetry}
            height={220}
            hideTimeRangeSelector={true}
          />
        </div>

        <div className="lg:col-span-1 flex flex-col gap-4">
          {distributions && (
            <Card>
              <CardContent className="pt-4 pb-4">
                <h4 className="text-sm font-medium text-gray-600 mb-3">质量评分分布</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">优秀 (≥90)</span>
                    <span className="text-sm font-semibold text-green-600">{distributions.quality.excellent || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">良好 (75-89)</span>
                    <span className="text-sm font-semibold text-blue-600">{distributions.quality.good || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">一般 (60-74)</span>
                    <span className="text-sm font-semibold text-yellow-600">{distributions.quality.average || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">较差 (&lt;60)</span>
                    <span className="text-sm font-semibold text-red-600">{distributions.quality.poor || 0}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {usageStats && (
            <Card>
              <CardContent className="pt-4 pb-4">
                <h4 className="text-sm font-medium text-gray-600 mb-3">创意使用情况</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">总创意数</span>
                    <span className="text-sm font-semibold text-gray-900">{usageStats.total}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">已选用</span>
                    <span className="text-sm font-semibold text-green-600">{usageStats.selected}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">使用率</span>
                    <span className="text-sm font-semibold text-blue-600">{usageStats.usageRate}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                    <div
                      className="bg-blue-600 h-1.5 rounded-full transition-all"
                      style={{ width: `${usageStats.usageRate}%` }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
