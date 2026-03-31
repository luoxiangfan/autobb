'use client'

import React, { useRef, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@/lib/utils'

interface VirtualTableProps {
  items: any[]
  itemHeight: number
  className?: string
  children: (items: any[], ref: (element: HTMLDivElement | null) => void) => React.ReactNode
  containerClassName?: string
  overscan?: number
}

export function VirtualTable({
  items,
  itemHeight,
  className,
  children,
  containerClassName,
  overscan = 5,
}: VirtualTableProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight,
    overscan,
  })

  return (
    <div
      ref={parentRef}
      className={cn(
        'w-full h-[400px] overflow-auto border rounded-lg',
        containerClassName
      )}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
        className={className}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {children([items[virtualRow.index]], (el) => {
              // No-op for row ref since we're using virtual positioning
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// 简化的虚拟表格 - 适用于固定列数的表格
interface SimpleVirtualTableProps {
  data: any[]
  columns: {
    key: string
    header: string
    width?: string | number
    render?: (item: any) => React.ReactNode
  }[]
  itemHeight?: number
  className?: string
  containerClassName?: string
  rowClassName?: string
  onRowClick?: (item: any) => void
}

export function SimpleVirtualTable({
  data,
  columns,
  itemHeight = 60,
  className,
  containerClassName,
  rowClassName,
  onRowClick,
}: SimpleVirtualTableProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight,
    overscan: 5,
  })

  return (
    <div
      ref={parentRef}
      className={cn(
        'w-full h-[400px] overflow-auto border rounded-lg bg-background',
        containerClassName
      )}
    >
      {/* 表头 */}
      <div
        className="sticky top-0 z-10 flex border-b bg-muted/50 backdrop-blur-sm"
        style={{ minWidth: 'max-content' }}
      >
        {columns.map((col, i) => (
          <div
            key={col.key}
            className={cn(
              'px-4 py-3 text-sm font-medium text-muted-foreground',
              i === 0 && 'pl-6',
              i === columns.length - 1 && 'pr-6'
            )}
            style={{ width: col.width, flexShrink: 0 }}
          >
            {col.header}
          </div>
        ))}
      </div>

      {/* 虚拟内容 */}
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = data[virtualRow.index]
          return (
            <div
              key={virtualRow.key}
              className={cn(
                'absolute flex items-center border-b hover:bg-muted/50 transition-colors',
                rowClassName,
                onRowClick && 'cursor-pointer'
              )}
              style={{
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                minWidth: 'max-content',
              }}
              onClick={() => onRowClick?.(item)}
            >
              {columns.map((col, i) => (
                <div
                  key={col.key}
                  className={cn(
                    'px-4 py-2 text-sm truncate',
                    i === 0 && 'pl-6',
                    i === columns.length - 1 && 'pr-6'
                  )}
                  style={{ width: col.width, flexShrink: 0 }}
                >
                  {col.render ? col.render(item) : item[col.key]}
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {/* 空状态 */}
      {data.length === 0 && (
        <div className="flex items-center justify-center h-48 text-muted-foreground">
          暂无数据
        </div>
      )}
    </div>
  )
}
