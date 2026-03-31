/**
 * 性能优化：React.memo 包装器工具
 *
 * 使用场景：
 * - 父组件频繁更新，但子组件props无变化
 * - 列表项组件，避免整个列表重渲染
 * - 纯展示组件，不应该随父组件重渲染
 */
import React, { memo, ComponentType } from 'react'
import { cn } from '@/lib/utils'

/**
 * 带类型安全的memo包装器
 * 自动推断props类型，避免类型丢失
 */
export function withMemo<P extends object>(
  Component: ComponentType<P>,
  propsAreEqual?: (prevProps: Readonly<P>, nextProps: Readonly<P>) => boolean
) {
  return memo(Component, propsAreEqual)
}

/**
 * 表格行包装器
 * 用于表格列表项，避免整表重渲染
 */
export const TableRowMemo = memo(function TableRowMemo({
  children,
  className,
  onClick,
  'data-state': dataState,
}: {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  'data-state'?: string
}) {
  return (
    <tr
      className={cn(
        'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
        className
      )}
      onClick={onClick}
      data-state={dataState}
    >
      {children}
    </tr>
  )
})

/**
 * 卡片包装器
 * 用于Dashboard卡片等展示组件
 */
export const CardMemo = memo(function CardMemo({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)}>
      {children}
    </div>
  )
})

/**
 * KPI卡片包装器
 * 用于Dashboard KPI卡片
 */
export const KPICardMemo = memo(function KPICardMemo({
  title,
  value,
  change,
  icon: Icon,
  trend,
  className,
}: {
  title: string
  value: string | number
  change?: number
  icon?: ComponentType<{ className?: string }>
  trend?: 'up' | 'down' | 'neutral'
  className?: string
}) {
  return (
    <div className={cn('rounded-xl border bg-white p-6 shadow-sm', className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-500">{title}</span>
        {Icon && <Icon className="h-4 w-4 text-slate-400" />}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-900">{value}</span>
        {change !== undefined && (
          <span
            className={cn(
              'text-sm font-medium',
              trend === 'up' && 'text-emerald-600',
              trend === 'down' && 'text-red-600',
              trend === 'neutral' && 'text-slate-500'
            )}
          >
            {change > 0 ? '+' : ''}{change}%
          </span>
        )}
      </div>
    </div>
  )
})

/**
 * Badge包装器
 * 用于状态标签等小组件
 */
export const BadgeMemo = memo(function BadgeMemo({
  children,
  variant = 'default',
  className,
}: {
  children: React.ReactNode
  variant?: 'default' | 'secondary' | 'destructive' | 'outline'
  className?: string
}) {
  const variants = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/80',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/80',
    outline: 'text-foreground border border-input',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  )
})

/**
 * 空状态包装器
 */
export const EmptyStateMemo = memo(function EmptyStateMemo({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 text-center', className)}>
      {Icon && <Icon className="h-12 w-12 text-slate-300 mb-4" />}
      <h3 className="text-lg font-medium text-slate-900">{title}</h3>
      {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
})

/**
 * 骨架屏包装器
 */
export const SkeletonMemo = memo(function SkeletonMemo({
  className,
  variant = 'text',
}: {
  className?: string
  variant?: 'text' | 'circular' | 'rectangular'
}) {
  const variants = {
    text: 'rounded h-4',
    circular: 'rounded-full',
    rectangular: 'rounded-md',
  }

  return (
    <div
      className={cn(
        'animate-pulse bg-slate-200',
        variants[variant],
        className
      )}
    />
  )
})

/**
 * 导出默认的memo配置
 * 使用深度相等检查（需要安装fast-deep-equal）
 */
// 如果不需要深度检查，可以使用默认的浅比较
export const memoConfig = {
  arePropsEqual: (prev: any, next: any) => {
    // 自定义相等检查逻辑
    // 可以根据具体需求调整
    return prev === next
  },
}
