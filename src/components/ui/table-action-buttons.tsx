/**
 * 响应式表格操作按钮组件
 *
 * 针对移动端优化的表格操作区域：
 * - 移动端：只显示图标，隐藏文字
 * - 桌面端：显示图标+文字
 * - 次要操作统一放入下拉菜单
 */

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MoreHorizontal } from "lucide-react"

interface TableActionButtonProps {
  icon: React.ReactNode
  label: string
  onClick?: () => void
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary"
  size?: "sm" | "default" | "lg" | "icon"
  disabled?: boolean
  className?: string
  title?: string
}

/**
 * 单个表格操作按钮
 * - 移动端只显示图标
 * - 桌面端显示图标+文字
 */
export function TableActionButton({
  icon,
  label,
  onClick,
  variant = "ghost",
  size = "sm",
  disabled = false,
  className,
  title,
}: TableActionButtonProps) {
  return (
    <Button
      variant={variant}
      size={size}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "transition-all",
        // 默认样式
        className
      )}
      title={title || label}
    >
      {icon}
      {/* 桌面端显示文字 - 使用 hidden sm:flex 来控制显示 */}
      <span className="hidden sm:inline ml-1.5">{label}</span>
    </Button>
  )
}

interface TableActionGroupProps {
  children: React.ReactNode
  className?: string
}

/**
 * 操作按钮组
 * - 移动端：水平排列，可能换行
 * - 桌面端：水平排列，不换行
 */
export function TableActionGroup({ children, className }: TableActionGroupProps) {
  return (
    <div className={cn(
      "flex flex-wrap items-center gap-1 sm:gap-2",
      className
    )}>
      {children}
    </div>
  )
}

interface ResponsiveActionCellProps {
  primaryAction?: {
    icon: React.ReactNode
    label: string
    href?: string  // 🔥 2026-01-05: 支持链接（用于打开新标签页）
    onClick?: () => void
    disabled?: boolean
    variant?: "default" | "outline" | "ghost"
    title?: string
    target?: string  // 🔥 2026-01-05: a标签的target属性
  }
  secondaryActions?: Array<{
    icon: React.ReactNode
    label: string
    onClick: () => void
    disabled?: boolean
    variant?: "ghost" | "destructive" | "secondary"
    className?: string
    title?: string
  }>
  className?: string
}

/**
 * 完整的响应式操作单元格
 * 包含一个主要操作按钮（发布广告等）和一个下拉菜单（包含多个次要操作）
 */
export function ResponsiveActionCell({
  primaryAction,
  secondaryActions,
  className,
}: ResponsiveActionCellProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* 主要操作按钮 - 支持链接或onClick */}
      {primaryAction && (
        primaryAction.href ? (
          // 🔥 2026-01-05: 使用<a>标签支持href和target
          <a
            href={primaryAction.href}
            target={primaryAction.target}
            rel={primaryAction.target === '_blank' ? 'noopener noreferrer' : undefined}
            className={cn(
              "inline-flex items-center justify-center h-8 px-3 text-sm font-medium rounded-md transition-colors",
              primaryAction.variant === "outline" ? "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50" :
              primaryAction.variant === "ghost" ? "text-gray-700 hover:bg-gray-100" :
              "bg-blue-600 text-white hover:bg-blue-700",
              primaryAction.disabled && "opacity-50 pointer-events-none",
              "whitespace-nowrap"
            )}
            title={primaryAction.disabled ? '请等待数据抓取完成' : (primaryAction.title || primaryAction.label)}
          >
            {primaryAction.icon}
            <span className="hidden sm:inline ml-1.5">{primaryAction.label}</span>
          </a>
        ) : (
          // 使用Button组件（onClick模式）
          <Button
            size="sm"
            variant={primaryAction.variant || "default"}
            onClick={primaryAction.onClick}
            disabled={primaryAction.disabled}
            className="h-8 whitespace-nowrap"
            title={primaryAction.disabled ? '请等待数据抓取完成' : (primaryAction.title || primaryAction.label)}
          >
            {primaryAction.icon}
            <span className="hidden sm:inline ml-1.5">{primaryAction.label}</span>
          </Button>
        )
      )}

      {/* 次要操作 - 下拉菜单 */}
      {secondaryActions && secondaryActions.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 px-2">
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {secondaryActions.map((action, idx) => (
              <DropdownMenuItem
                key={idx}
                onClick={action.onClick}
                disabled={action.disabled}
                className={cn(
                  action.variant === 'destructive' && 'text-red-600 focus:text-red-600',
                  action.className
                )}
                title={action.title || action.label}
              >
                {action.icon}
                <span className="ml-2">{action.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
