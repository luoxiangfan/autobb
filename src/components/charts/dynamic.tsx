/**
 * ⚡ P0性能优化: 图表组件动态导入
 * 使用Next.js dynamic import实现按需加载，减少首屏JS体积
 * Recharts库约200KB，懒加载可显著提升首屏性能
 */
import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'

// 加载中的骨架屏组件
const ChartSkeleton = () => (
  <Skeleton className="h-[400px] w-full" />
)

// 动态导入图表组件，禁用SSR（图表通常需要浏览器API）
// Note: 使用 .then(mod => mod.ComponentName) 处理命名导出
export const ROITrendChartDynamic = dynamic(
  () => import('../ROIChart').then(mod => mod.ROITrendChart),
  {
    loading: () => <ChartSkeleton />,
    ssr: false
  }
)

export const CampaignROIChartDynamic = dynamic(
  () => import('../ROIChart').then(mod => mod.CampaignROIChart),
  {
    loading: () => <ChartSkeleton />,
    ssr: false
  }
)

export const OfferROIChartDynamic = dynamic(
  () => import('../ROIChart').then(mod => mod.OfferROIChart),
  {
    loading: () => <ChartSkeleton />,
    ssr: false
  }
)

// BudgetChart组件（命名导出）
export const BudgetTrendChartDynamic = dynamic(
  () => import('../BudgetChart').then(mod => mod.BudgetTrendChart),
  {
    loading: () => <ChartSkeleton />,
    ssr: false
  }
)

export const CampaignBudgetChartDynamic = dynamic(
  () => import('../BudgetChart').then(mod => mod.CampaignBudgetChart),
  {
    loading: () => <ChartSkeleton />,
    ssr: false
  }
)

export const BudgetUtilizationChartDynamic = dynamic(
  () => import('../BudgetChart').then(mod => mod.BudgetUtilizationChart),
  {
    loading: () => <ChartSkeleton />,
    ssr: false
  }
)

export const OfferBudgetChartDynamic = dynamic(
  () => import('../BudgetChart').then(mod => mod.OfferBudgetChart),
  {
    loading: () => <ChartSkeleton />,
    ssr: false
  }
)

// CampaignComparison组件（默认导出）
export const CampaignComparisonDynamic = dynamic(
  () => import('../CampaignComparison'),
  {
    loading: () => <ChartSkeleton />,
    ssr: false
  }
)

// ScoreRadarChart组件（默认导出）
export const ScoreRadarChartDynamic = dynamic(
  () => import('./ScoreRadarChart'),
  {
    loading: () => <ChartSkeleton />,
    ssr: false
  }
)

// TrendChart组件（命名导出）
export const TrendChartDynamic = dynamic(
  () => import('./TrendChart').then(mod => mod.TrendChart),
  {
    loading: () => <ChartSkeleton />,
    ssr: false
  }
)

// PerformanceTrends组件（命名导出）
export const PerformanceTrendsDynamic = dynamic(
  () => import('../dashboard/PerformanceTrends').then(mod => mod.PerformanceTrends),
  {
    loading: () => <ChartSkeleton />,
    ssr: false
  }
)
