import { cn } from "@/lib/utils"
import React from "react"

function Skeleton({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn("animate-pulse rounded-md bg-muted", className)}
            {...props}
        />
    )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 常用骨架屏变体
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 表格骨架屏
 */
function TableRowSkeleton({ columns = 5 }: { columns?: number }) {
  return (
    <div className="flex gap-4 py-3 border-b">
      <Skeleton className="h-4 w-4" />
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton key={i} className="h-4 flex-1" />
      ))}
    </div>
  )
}

function TableSkeleton({
  rows = 5,
  columns = 5,
}: {
  rows?: number
  columns?: number
}) {
  return (
    <div className="space-y-0">
      {/* 表头 */}
      <div className="flex gap-4 py-3 border-b bg-muted/30">
        <Skeleton className="h-4 w-4" />
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {/* 行 */}
      {Array.from({ length: rows }).map((_, i) => (
        <TableRowSkeleton key={i} columns={columns} />
      ))}
    </div>
  )
}

/**
 * 卡片骨架屏
 */
function CardSkeleton({
  title = true,
  description = true,
  content = true,
  footer = true,
}: {
  title?: boolean
  description?: boolean
  content?: boolean
  footer?: boolean
}) {
  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      {title && <Skeleton className="h-6 w-1/2" />}
      {description && <Skeleton className="h-4 w-3/4" />}
      {content && <Skeleton className="h-20 w-full" />}
      {footer && <div className="flex gap-2">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-20" />
      </div>}
    </div>
  )
}

/**
 * KPI卡片骨架屏
 */
function KPISkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4" style={{
      gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`
    }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border bg-white p-6 space-y-3">
          <div className="flex justify-between">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-4 rounded-full" />
          </div>
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  )
}

/**
 * 列表骨架屏
 */
function ListSkeleton({
  items = 5,
  avatar = true,
}: {
  items?: number
  avatar?: boolean
}) {
  return (
    <div className="space-y-3">
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-4 border rounded-lg">
          {avatar && <Skeleton className="h-10 w-10 rounded-full" />}
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-6 w-16" />
        </div>
      ))}
    </div>
  )
}

/**
 * 详情页骨架屏
 */
function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-12 w-12 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <TableSkeleton rows={3} columns={4} />
    </div>
  )
}

/**
 * 聊天/消息骨架屏
 */
function ChatSkeleton({ messages = 3 }: { messages?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: messages }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "flex gap-3",
            i % 2 === 1 && "flex-row-reverse"
          )}
        >
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className={cn("space-y-2", i % 2 === 1 && "items-end")}>
            <Skeleton className="h-4 w-32" />
            <Skeleton className={cn("h-16 w-48 rounded-lg", i % 2 === 0 ? "rounded-tl-none" : "rounded-tr-none")} />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * 表单骨架屏
 */
function FormSkeleton({
  fields = 4,
  withSubmit = true,
}: {
  fields?: number
  withSubmit?: boolean
}) {
  return (
    <div className="space-y-6 max-w-md">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
      {withSubmit && (
        <Skeleton className="h-10 w-32" />
      )}
    </div>
  )
}

export {
  Skeleton,
  TableRowSkeleton,
  TableSkeleton,
  CardSkeleton,
  KPISkeleton,
  ListSkeleton,
  DetailSkeleton,
  ChatSkeleton,
  FormSkeleton,
}
