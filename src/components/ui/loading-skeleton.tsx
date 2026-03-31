'use client'

/**
 * LoadingSkeleton - P2-6优化
 * 统一的Loading Skeleton组件，提供一致的加载体验
 */

import { Card, CardContent, CardHeader } from '@/components/ui/card'

interface LoadingSkeletonProps {
  variant?: 'card' | 'table' | 'list' | 'kpi' | 'custom'
  count?: number
  className?: string
  children?: React.ReactNode
}

/**
 * KPI卡片骨架屏
 */
function KPISkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white rounded-lg shadow p-6 animate-pulse">
          <div className="flex items-center justify-between mb-4">
            <div className="flex-1">
              <div className="h-4 bg-gray-200 rounded w-24 mb-3"></div>
              <div className="h-8 bg-gray-300 rounded w-32"></div>
            </div>
            <div className="w-12 h-12 bg-gray-200 rounded-lg"></div>
          </div>
          <div className="h-6 bg-gray-200 rounded w-20"></div>
        </div>
      ))}
    </div>
  )
}

/**
 * 卡片骨架屏
 */
function CardSkeleton({ count = 1 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <div className="animate-pulse">
              <div className="h-6 bg-gray-200 rounded w-48 mb-2"></div>
              <div className="h-4 bg-gray-100 rounded w-64"></div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="animate-pulse space-y-3">
              <div className="h-4 bg-gray-200 rounded"></div>
              <div className="h-4 bg-gray-200 rounded w-5/6"></div>
              <div className="h-4 bg-gray-200 rounded w-4/6"></div>
            </div>
          </CardContent>
        </Card>
      ))}
    </>
  )
}

/**
 * 表格骨架屏
 */
function TableSkeleton({ count = 5 }: { count?: number }) {
  return (
    <Card>
      <CardContent className="py-6">
        <div className="animate-pulse space-y-4">
          {/* Table Header */}
          <div className="flex gap-4 pb-4 border-b">
            <div className="h-4 bg-gray-300 rounded w-1/4"></div>
            <div className="h-4 bg-gray-300 rounded w-1/6"></div>
            <div className="h-4 bg-gray-300 rounded w-1/6"></div>
            <div className="h-4 bg-gray-300 rounded w-1/6"></div>
            <div className="h-4 bg-gray-300 rounded w-1/6"></div>
          </div>
          {/* Table Rows */}
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="flex gap-4 items-center">
              <div className="h-10 bg-gray-100 rounded w-1/4"></div>
              <div className="h-10 bg-gray-100 rounded w-1/6"></div>
              <div className="h-10 bg-gray-100 rounded w-1/6"></div>
              <div className="h-10 bg-gray-100 rounded w-1/6"></div>
              <div className="h-10 bg-gray-100 rounded w-1/6"></div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * 列表骨架屏
 */
function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white rounded-lg shadow p-4 animate-pulse">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gray-200 rounded-full"></div>
            <div className="flex-1">
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-gray-100 rounded w-1/2"></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * 主组件 - 统一的Loading Skeleton
 */
export function LoadingSkeleton({
  variant = 'card',
  count = 1,
  className = '',
  children,
}: LoadingSkeletonProps) {
  // Custom variant allows passing custom skeleton structure
  if (variant === 'custom' && children) {
    return <div className={className}>{children}</div>
  }

  // Predefined variants
  const skeletonMap = {
    kpi: <KPISkeleton count={count} />,
    card: <CardSkeleton count={count} />,
    table: <TableSkeleton count={count} />,
    list: <ListSkeleton count={count} />,
    custom: <CardSkeleton count={count} />, // fallback
  }

  return <div className={className}>{skeletonMap[variant]}</div>
}

/**
 * 快捷导出 - 常用变体
 */
export const KPILoadingSkeleton = () => <LoadingSkeleton variant="kpi" count={4} />
export const TableLoadingSkeleton = ({ rows = 5 }: { rows?: number }) => (
  <LoadingSkeleton variant="table" count={rows} />
)
export const CardLoadingSkeleton = ({ cards = 1 }: { cards?: number }) => (
  <LoadingSkeleton variant="card" count={cards} />
)
export const ListLoadingSkeleton = ({ items = 3 }: { items?: number }) => (
  <LoadingSkeleton variant="list" count={items} />
)
