'use client'

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { TableHead } from '@/components/ui/table'
import type { CampaignSortDirection, CampaignSortField } from './types'

export type CampaignSortableHeaderProps = {
  field: CampaignSortField
  children: React.ReactNode
  className?: string
  sortField: CampaignSortField | null
  sortDirection: CampaignSortDirection
  onSort: (field: CampaignSortField) => void
}

export function CampaignSortableHeader({
  field,
  children,
  className = '',
  sortField,
  sortDirection,
  onSort,
}: CampaignSortableHeaderProps) {
  const isActive = sortField === field
  return (
    <TableHead
      className={`cursor-pointer select-none hover:bg-gray-50 ${className}`}
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-0.5">
        {children}
        {isActive ? (
          sortDirection === 'asc' ? (
            <ArrowUp className="w-3.5 h-3.5" />
          ) : (
            <ArrowDown className="w-3.5 h-3.5" />
          )
        ) : (
          <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
        )}
      </div>
    </TableHead>
  )
}
