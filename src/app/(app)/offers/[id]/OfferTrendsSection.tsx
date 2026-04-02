'use client'

import { TrendChart, type TrendChartData } from '@/components/charts/TrendChart'

interface OfferTrendsSectionProps {
  timeRange: string
  trendsData: TrendChartData[]
  trendsLoading: boolean
  trendsError: string | null
  selectedCurrency: string
  onRetry: () => void
  formatMoney: (value: number, currencyCode?: string) => string
}

export default function OfferTrendsSection({
  timeRange,
  trendsData,
  trendsLoading,
  trendsError,
  selectedCurrency,
  onRetry,
  formatMoney,
}: OfferTrendsSectionProps) {
  return (
    <div className="mb-6">
      <TrendChart
        data={trendsData}
        metrics={[
          {
            key: 'impressions',
            label: '展示次数',
            color: '#3b82f6',
          },
          {
            key: 'clicks',
            label: '点击次数',
            color: '#10b981',
          },
          {
            key: 'commission',
            label: '佣金',
            color: '#8b5cf6',
          },
          {
            key: 'costUsd',
            label: `花费 (${selectedCurrency})`,
            color: '#f59e0b',
            formatter: (value) => formatMoney(value),
            yAxisId: 'right',
          },
        ]}
        title="投放趋势"
        description={`过去${timeRange}天的数据变化`}
        loading={trendsLoading}
        error={trendsError}
        onRetry={onRetry}
        height={280}
        hideTimeRangeSelector={true}
        dualYAxis={true}
      />
    </div>
  )
}
