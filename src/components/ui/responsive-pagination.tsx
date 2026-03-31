/**
 * 响应式分页组件
 *
 * 针对移动端优化的分页控件：
 * - 移动端：简化为只显示上/下一页和当前页码
 * - 桌面端：显示完整分页信息
 * - 自动换行布局，避免溢出
 */

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ResponsivePaginationProps {
  currentPage: number
  totalPages: number
  totalItems: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
  className?: string
}

/**
 * 移动端优化的分页控件
 */
export function ResponsivePagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50],
  className,
}: ResponsivePaginationProps) {
  // 移动端判断（简单判断屏幕宽度）
  const [isMobile, setIsMobile] = React.useState(false)

  React.useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // 计算显示范围
  const startItem = Math.min((currentPage - 1) * pageSize + 1, totalItems)
  const endItem = Math.min(currentPage * pageSize, totalItems)

  // 简化页码显示（移动端）
  const getPageNumbers = () => {
    if (!isMobile) {
      // 桌面端：显示更多页码
      if (totalPages <= 7) {
        return Array.from({ length: totalPages }, (_, i) => i + 1)
      }
      return Array.from({ length: totalPages }, (_, i) => i + 1).filter(page => {
        if (page === 1 || page === totalPages) return true
        if (Math.abs(page - currentPage) <= 1) return true
        if (page === 2 && currentPage <= 3) return true
        if (page === totalPages - 1 && currentPage >= totalPages - 2) return true
        return false
      })
    }

    // 移动端：只显示当前页
    return [currentPage]
  }

  const pageNumbers = getPageNumbers()
  const showPageNumbers = pageNumbers.length > 0 && !isMobile

  return (
    <div className={cn(
      "w-full",
      className
    )}>
      {/* 移动端：垂直布局 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        {/* 左侧：分页信息 */}
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
          {/* 每页条数选择器 */}
          {onPageSizeChange && (
            <div className="flex items-center gap-1">
              <span className="whitespace-nowrap">每页</span>
              <select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className="h-8 px-2 rounded border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {pageSizeOptions.map(size => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
              <span className="whitespace-nowrap">条</span>
            </div>
          )}
          {/* 分页信息 */}
          <span className="whitespace-nowrap">
            共 {totalItems} 条
          </span>
        </div>

        {/* 右侧：分页控件 */}
        <div className="flex items-center justify-center sm:justify-end gap-2">
          {/* 移动端：简化显示 */}
          {isMobile ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 whitespace-nowrap">
                {startItem}-{endItem}/{totalItems}
              </span>
            </div>
          ) : null}

          {/* 上一页按钮 */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="h-8 px-3"
          >
            <ChevronLeft className="w-4 h-4 mr-0 sm:mr-1" />
            <span className="hidden sm:inline">上一页</span>
          </Button>

          {/* 页码按钮 */}
          {showPageNumbers && (
            <div className="flex items-center gap-1">
              {pageNumbers.map((page, index, arr) => (
                <React.Fragment key={page}>
                  {/* 显示省略号 */}
                  {index > 0 && arr[index - 1] !== page - 1 && (
                    <span className="px-2 text-gray-400">...</span>
                  )}
                  <Button
                    variant={currentPage === page ? "default" : "outline"}
                    size="sm"
                    onClick={() => onPageChange(page)}
                    className={cn(
                      "h-8 w-8 p-0",
                      currentPage === page && "bg-blue-600 hover:bg-blue-700"
                    )}
                  >
                    {page}
                  </Button>
                </React.Fragment>
              ))}
            </div>
          )}

          {/* 下一页按钮 */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
            className="h-8 px-3"
          >
            <span className="hidden sm:inline">下一页</span>
            <ChevronRight className="w-4 h-4 ml-0 sm:ml-1" />
          </Button>

          {/* 移动端：当前页码显示 */}
          {isMobile && (
            <span className="text-sm text-gray-600 ml-1">
              / {totalPages}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * 简单的分页信息显示（无按钮）
 */
export function PaginationInfo({
  currentPage,
  pageSize,
  totalItems,
  className,
}: {
  currentPage: number
  pageSize: number
  totalItems: number
  className?: string
}) {
  const startItem = Math.min((currentPage - 1) * pageSize + 1, totalItems)
  const endItem = Math.min(currentPage * pageSize, totalItems)

  return (
    <span className={cn("text-sm text-gray-500 whitespace-nowrap", className)}>
      显示第 {startItem} - {endItem} 条，共 {totalItems} 条
    </span>
  )
}
