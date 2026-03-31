'use client'

import React from 'react'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/useMediaQuery'

// 响应式表格配置
interface ResponsiveTableProps {
  children: React.ReactNode
  className?: string
}

// 桌面端显示表格，移动端显示卡片列表
export function ResponsiveTable({ children, className }: ResponsiveTableProps) {
  const isMobile = useIsMobile()

  return (
    <div className={cn('w-full', isMobile && 'space-y-3', className)}>
      {children}
    </div>
  )
}

// 表格行组件 - 移动端自动转换为卡片
interface ResponsiveRowProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  isHeader?: boolean
}

export function ResponsiveRow({ children, className, onClick, isHeader }: ResponsiveRowProps) {
  const isMobile = useIsMobile()

  if (isMobile) {
    // 移动端：渲染为卡片
    return (
      <div
        className={cn(
          'rounded-lg border bg-white p-4 shadow-sm',
          onClick && 'cursor-pointer hover:bg-slate-50 active:bg-slate-100',
          isHeader && 'bg-slate-100 text-slate-700 font-semibold',
          className
        )}
        onClick={onClick}
      >
        <div className="space-y-3">
          {children}
        </div>
      </div>
    )
  }

  // 桌面端：渲染为表格行
  return (
    <tr
      className={cn(
        'border-b transition-colors hover:bg-muted/50',
        onClick && 'cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      {children}
    </tr>
  )
}

// 表格单元格组件 - 移动端显示为标签+值
interface ResponsiveCellProps {
  children: React.ReactNode
  label?: string  // 移动端显示的标签
  className?: string
  hideOnMobile?: boolean
  showOnMobileAs?: 'badge' | 'value' | 'default'
}

export function ResponsiveCell({
  children,
  label,
  className,
  hideOnMobile = false,
  showOnMobileAs = 'default',
}: ResponsiveCellProps) {
  const isMobile = useIsMobile()

  if (hideOnMobile && isMobile) {
    return null
  }

  if (isMobile) {
    // 移动端：渲染为标签+值
    return (
      <div className={cn('flex justify-between items-center', className)}>
        {label && (
          <span className="text-sm text-slate-500">{label}</span>
        )}
        <div className={cn('flex-1 text-right', showOnMobileAs === 'badge' && 'flex justify-end')}>
          {children}
        </div>
      </div>
    )
  }

  // 桌面端：渲染为表格单元格
  return <td className={cn('p-2 align-middle', className)}>{children}</td>
}

// 表头单元格组件
interface ResponsiveHeadProps {
  children: React.ReactNode
  className?: string
  hideOnMobile?: boolean
}

export function ResponsiveHead({ children, className, hideOnMobile }: ResponsiveHeadProps) {
  const isMobile = useIsMobile()

  if (hideOnMobile && isMobile) {
    return null
  }

  if (isMobile) {
    return null // 移动端不显示表头
  }

  return <th className={cn('h-10 px-2 text-left align-middle font-medium text-muted-foreground', className)}>{children}</th>
}

// 使用示例的组件
interface ExampleItem {
  id: number
  name: string
  country: string
  status: string
  clicks: number
  spend: number
}

interface ResponsiveTableListProps {
  items: ExampleItem[]
  renderItem: (item: ExampleItem) => React.ReactNode
  keyExtractor: (item: ExampleItem) => string | number
}

export function ResponsiveTableList({ items, renderItem, keyExtractor }: ResponsiveTableListProps) {
  const isMobile = useIsMobile()

  if (isMobile) {
    // 移动端：卡片列表
    return (
      <div className="space-y-3">
        {items.map((item) => (
          <div key={keyExtractor(item)}>
            {renderItem(item)}
          </div>
        ))}
      </div>
    )
  }

  // 桌面端：表格
  return (
    <div className="rounded-lg border">
      <table className="w-full caption-bottom text-sm">
        <thead className="[&_tr]:border-b">
          <tr>
            <th className="h-10 px-2 text-left align-middle font-medium text-muted-foreground">名称</th>
            <th className="h-10 px-2 text-left align-middle font-medium text-muted-foreground">国家</th>
            <th className="h-10 px-2 text-left align-middle font-medium text-muted-foreground">状态</th>
            <th className="h-10 px-2 text-left align-middle font-medium text-muted-foreground">点击</th>
            <th className="h-10 px-2 text-left align-middle font-medium text-muted-foreground">花费</th>
            <th className="h-10 px-2 text-right align-middle font-medium text-muted-foreground">操作</th>
          </tr>
        </thead>
        <tbody className="[&_tr:last-child]:border-0">
          {items.map((item) => (
            <tr key={keyExtractor(item)} className="border-b transition-colors hover:bg-muted/50">
              {renderItem(item)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
