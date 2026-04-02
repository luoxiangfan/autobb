'use client'

import { Maximize2 } from 'lucide-react'
import { TrendChart, type TrendChartData, type TrendChartMetric } from '@/components/charts/TrendChart'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DateRangePicker, type DateRange } from '@/components/ui/date-range-picker'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type CampaignsTimeRange = '7' | '14' | '30' | 'custom'
type ExpandedTrendChart = 'traffic' | 'cost' | null

interface CampaignsTrendsSectionProps {
  timeRange: CampaignsTimeRange
  dateRange: DateRange | undefined
  customRangeLabel: string
  trendsOverviewDescription: string
  trendsData: TrendChartData[]
  trendsLoading: boolean
  trendsError: string | null
  trafficTrendMetrics: TrendChartMetric[]
  costTrendMetrics: TrendChartMetric[]
  trafficTrendDescription: string
  costTrendDescription: string
  averageCtrText: string
  averageCpcText: string
  averageRoasText: string
  trendsCurrencyValue: string
  enabledCampaignCount: number
  pausedCampaignCount: number
  removedCampaignCount: number
  totalCampaignCount: number
  expandedTrendChart: ExpandedTrendChart
  expandedTrendChartHeight: number
  onSelectPresetTimeRange: (days: '7' | '14' | '30') => void
  onDateRangeChange: (range: DateRange | undefined) => void
  onRetry: () => void
  onExpandedTrendChartChange: (value: ExpandedTrendChart) => void
}

export default function CampaignsTrendsSection({
  timeRange,
  dateRange,
  customRangeLabel,
  trendsOverviewDescription,
  trendsData,
  trendsLoading,
  trendsError,
  trafficTrendMetrics,
  costTrendMetrics,
  trafficTrendDescription,
  costTrendDescription,
  averageCtrText,
  averageCpcText,
  averageRoasText,
  trendsCurrencyValue,
  enabledCampaignCount,
  pausedCampaignCount,
  removedCampaignCount,
  totalCampaignCount,
  expandedTrendChart,
  expandedTrendChartHeight,
  onSelectPresetTimeRange,
  onDateRangeChange,
  onRetry,
  onExpandedTrendChartChange,
}: CampaignsTrendsSectionProps) {
  return (
    <>
      <div className="mb-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">性能趋势</h3>
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
        <p className="mb-3 text-xs text-gray-500">{trendsOverviewDescription}</p>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:items-start">
          <div className="lg:col-span-2">
            <TrendChart
              data={trendsData}
              metrics={trafficTrendMetrics}
              title="流量趋势"
              description={trafficTrendDescription}
              loading={trendsLoading}
              error={trendsError}
              onRetry={onRetry}
              height={220}
              hideTimeRangeSelector={true}
              chartType="bar"
              dualYAxis={true}
              headerActions={
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onExpandedTrendChartChange('traffic')}
                  title="放大趋势图"
                  aria-label="放大流量趋势图"
                >
                  <Maximize2 className="h-4 w-4" />
                </Button>
              }
            />
          </div>

          <div className="lg:col-span-2">
            <TrendChart
              data={trendsData}
              metrics={costTrendMetrics}
              title="成本趋势"
              description={costTrendDescription}
              loading={trendsLoading}
              error={trendsError}
              onRetry={onRetry}
              height={220}
              hideTimeRangeSelector={true}
              chartType="mixed"
              dualYAxis={true}
              headerActions={
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onExpandedTrendChartChange('cost')}
                  title="放大趋势图"
                  aria-label="放大成本趋势图"
                >
                  <Maximize2 className="h-4 w-4" />
                </Button>
              }
            />
          </div>

          <div className="flex flex-col gap-4 lg:col-span-1">
            <Card>
              <CardContent className="pt-4 pb-4">
                <h4 className="mb-3 text-sm font-medium text-gray-600">效率指标</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">平均CTR</span>
                    <span className="text-sm font-semibold text-gray-900">{averageCtrText}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">平均CPC({trendsCurrencyValue})</span>
                    <span className="text-sm font-semibold text-gray-900">{averageCpcText}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">平均ROAS</span>
                    <span className="text-sm font-semibold text-gray-900">{averageRoasText}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4 pb-4">
                <h4 className="mb-3 text-sm font-medium text-gray-600">广告系列状态</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
                      <span className="text-xs text-gray-600">投放中</span>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">{enabledCampaignCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
                      <span className="text-xs text-gray-600">已暂停</span>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">{pausedCampaignCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
                      <span className="text-xs text-gray-600">已移除</span>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">{removedCampaignCount}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between border-t pt-2">
                    <span className="text-xs font-medium text-gray-700">总计</span>
                    <span className="text-sm font-bold text-gray-900">{totalCampaignCount}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Dialog
        open={expandedTrendChart !== null}
        onOpenChange={(open) => {
          if (!open) onExpandedTrendChartChange(null)
        }}
      >
        <DialogContent className="max-h-[88vh] w-[96vw] max-w-[96vw] overflow-y-auto sm:max-w-[96vw] lg:max-w-[1280px] xl:max-w-[1440px]">
          <DialogHeader>
            <DialogTitle>{expandedTrendChart === 'traffic' ? '流量趋势（放大）' : '成本趋势（放大）'}</DialogTitle>
          </DialogHeader>
          {expandedTrendChart === 'traffic' && (
            <TrendChart
              data={trendsData}
              metrics={trafficTrendMetrics}
              title="流量趋势"
              description={trafficTrendDescription}
              loading={trendsLoading}
              error={trendsError}
              onRetry={onRetry}
              height={expandedTrendChartHeight}
              hideTimeRangeSelector={true}
              chartType="bar"
              dualYAxis={true}
            />
          )}
          {expandedTrendChart === 'cost' && (
            <TrendChart
              data={trendsData}
              metrics={costTrendMetrics}
              title="成本趋势"
              description={costTrendDescription}
              loading={trendsLoading}
              error={trendsError}
              onRetry={onRetry}
              height={expandedTrendChartHeight}
              hideTimeRangeSelector={true}
              chartType="mixed"
              dualYAxis={true}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
