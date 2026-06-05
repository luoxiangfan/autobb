/**
 * 图表组件动态导入（按需加载）
 */
import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'

const ChartSkeleton = () => <Skeleton className="h-[400px] w-full" />

export const TrendChartDynamic = dynamic(
  () => import('./TrendChart').then((mod) => mod.TrendChart),
  {
    loading: () => <ChartSkeleton />,
    ssr: false,
  }
)
