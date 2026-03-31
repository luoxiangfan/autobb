'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'

// Lazy load chart components with loading states
export const LazyROITrendChart = dynamic(
  () => import('@/components/ROIChart').then((mod) => ({ default: mod.ROITrendChart })),
  {
    loading: () => <Skeleton className="w-full h-[300px]" />,
    ssr: false,
  }
)

export const LazyCampaignROIChart = dynamic(
  () => import('@/components/ROIChart').then((mod) => ({ default: mod.CampaignROIChart })),
  {
    loading: () => <Skeleton className="w-full h-[400px]" />,
    ssr: false,
  }
)

export const LazyOfferROIChart = dynamic(
  () => import('@/components/ROIChart').then((mod) => ({ default: mod.OfferROIChart })),
  {
    loading: () => <Skeleton className="w-full h-[350px]" />,
    ssr: false,
  }
)

export const LazyBudgetTrendChart = dynamic(
  () => import('@/components/BudgetChart').then((mod) => ({ default: mod.BudgetTrendChart })),
  {
    loading: () => <Skeleton className="w-full h-[300px]" />,
    ssr: false,
  }
)

export const LazyCampaignBudgetChart = dynamic(
  () => import('@/components/BudgetChart').then((mod) => ({ default: mod.CampaignBudgetChart })),
  {
    loading: () => <Skeleton className="w-full h-[400px]" />,
    ssr: false,
  }
)

export const LazyBudgetUtilizationChart = dynamic(
  () => import('@/components/BudgetChart').then((mod) => ({ default: mod.BudgetUtilizationChart })),
  {
    loading: () => <Skeleton className="w-full h-[350px]" />,
    ssr: false,
  }
)

export const LazyOfferBudgetChart = dynamic(
  () => import('@/components/BudgetChart').then((mod) => ({ default: mod.OfferBudgetChart })),
  {
    loading: () => <Skeleton className="w-full h-[350px]" />,
    ssr: false,
  }
)
