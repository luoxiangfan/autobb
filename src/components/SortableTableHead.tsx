'use client'

/**
 * SortableTableHead - P2-5优化
 * 可排序的表格列头组件
 */

import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { TableHead } from '@/components/ui/table'

interface SortableTableHeadProps {
  field: string
  currentSortBy: string
  sortOrder: 'asc' | 'desc'
  onSort: (field: string) => void
  children: React.ReactNode
  className?: string
  align?: 'left' | 'center' | 'right'
}

export function SortableTableHead({
  field,
  currentSortBy,
  sortOrder,
  onSort,
  children,
  className = '',
  align = 'left',
}: SortableTableHeadProps) {
  const isSorting = currentSortBy === field
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''

  return (
    <TableHead
      className={`cursor-pointer hover:bg-accent transition-colors ${alignClass} ${className}`}
      onClick={() => onSort(field)}
    >
      <div className={`flex items-center gap-2 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : ''}`}>
        <span>{children}</span>
        <div className="w-4 h-4 flex items-center justify-center">
          {isSorting ? (
            sortOrder === 'desc' ? (
              <ArrowDown className="w-4 h-4 text-primary" />
            ) : (
              <ArrowUp className="w-4 h-4 text-primary" />
            )
          ) : (
            <ArrowUpDown className="w-4 h-4 text-muted-foreground opacity-50" />
          )}
        </div>
      </div>
    </TableHead>
  )
}
