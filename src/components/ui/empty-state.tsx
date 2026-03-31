'use client'

/**
 * EmptyState - P2-7优化
 * 统一的空状态组件，提供友好的空状态体验
 */

import { ReactNode } from 'react'
import {
  FileX,
  Search,
  Inbox,
  AlertCircle,
  Database,
  FolderOpen,
  PackageOpen,
  Users,
  LucideIcon
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface EmptyStateProps {
  /**
   * 空状态类型 - 预定义常见场景
   */
  variant?: 'no-data' | 'no-results' | 'no-offers' | 'no-campaigns' | 'no-users' | 'error' | 'custom'
  /**
   * 标题文本
   */
  title?: string
  /**
   * 描述文本
   */
  description?: string
  /**
   * 图标组件 (自定义variant时使用)
   */
  icon?: LucideIcon
  /**
   * CTA按钮文本
   */
  actionLabel?: string
  /**
   * CTA按钮点击事件
   */
  onAction?: () => void
  /**
   * 次要操作按钮文本
   */
  secondaryActionLabel?: string
  /**
   * 次要操作按钮点击事件
   */
  onSecondaryAction?: () => void
  /**
   * 自定义图标颜色
   */
  iconColor?: string
  /**
   * 容器className
   */
  className?: string
  /**
   * 是否在Card中显示
   */
  inCard?: boolean
}

/**
 * 预定义场景配置
 */
const variantConfig = {
  'no-data': {
    icon: Database,
    title: '暂无数据',
    description: '当前还没有数据，请稍后再试或创建新数据',
    iconColor: 'text-blue-500',
  },
  'no-results': {
    icon: Search,
    title: '未找到匹配结果',
    description: '尝试调整搜索条件或筛选器',
    iconColor: 'text-gray-500',
  },
  'no-offers': {
    icon: PackageOpen,
    title: '暂无Offer',
    description: '点击下方按钮创建您的第一个Offer，开始推广之旅',
    iconColor: 'text-blue-500',
  },
  'no-campaigns': {
    icon: FolderOpen,
    title: '暂无广告系列',
    description: '创建Offer后，可以一键生成AI广告系列',
    iconColor: 'text-green-500',
  },
  'no-users': {
    icon: Users,
    title: '暂无用户',
    description: '系统中还没有用户数据',
    iconColor: 'text-purple-500',
  },
  'error': {
    icon: AlertCircle,
    title: '加载失败',
    description: '数据加载时出现问题，请重试',
    iconColor: 'text-red-500',
  },
  'custom': {
    icon: Inbox,
    title: '暂无内容',
    description: '',
    iconColor: 'text-gray-400',
  },
}

export function EmptyState({
  variant = 'no-data',
  title,
  description,
  icon,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  iconColor,
  className = '',
  inCard = true,
}: EmptyStateProps) {
  // 获取配置
  const config = variantConfig[variant]
  const Icon = icon || config.icon
  const displayTitle = title || config.title
  const displayDescription = description || config.description
  const displayIconColor = iconColor || config.iconColor

  const content = (
    <div className={`py-12 text-center ${className}`}>
      {/* Icon */}
      <div className="flex justify-center mb-4">
        <div className="p-3 bg-gray-100 rounded-full">
          <Icon className={`h-10 w-10 ${displayIconColor}`} strokeWidth={1.5} />
        </div>
      </div>

      {/* Title */}
      <h3 className="text-lg font-semibold text-gray-900 mb-2">
        {displayTitle}
      </h3>

      {/* Description */}
      {displayDescription && (
        <p className="text-sm text-gray-500 max-w-md mx-auto mb-6">
          {displayDescription}
        </p>
      )}

      {/* Actions */}
      {(actionLabel || secondaryActionLabel) && (
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          {actionLabel && onAction && (
            <Button onClick={onAction} size="default">
              {actionLabel}
            </Button>
          )}
          {secondaryActionLabel && onSecondaryAction && (
            <Button onClick={onSecondaryAction} variant="outline" size="default">
              {secondaryActionLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  )

  // 包装在Card中或直接返回
  if (inCard) {
    return (
      <Card>
        <CardContent>{content}</CardContent>
      </Card>
    )
  }

  return content
}

/**
 * 快捷导出 - 常用场景
 */

export const NoDataState = ({
  title,
  description,
  actionLabel,
  onAction
}: Partial<EmptyStateProps>) => (
  <EmptyState
    variant="no-data"
    title={title}
    description={description}
    actionLabel={actionLabel}
    onAction={onAction}
  />
)

export const NoResultsState = ({
  description = '尝试调整搜索条件或筛选器'
}: Partial<EmptyStateProps>) => (
  <EmptyState
    variant="no-results"
    description={description}
  />
)

export const NoOffersState = ({
  onAction
}: Partial<EmptyStateProps>) => (
  <EmptyState
    variant="no-offers"
    actionLabel="创建Offer"
    onAction={onAction}
  />
)

export const NoCampaignsState = ({
  onAction
}: Partial<EmptyStateProps>) => (
  <EmptyState
    variant="no-campaigns"
    actionLabel="创建Campaign"
    onAction={onAction}
  />
)

export const ErrorState = ({
  description,
  actionLabel = '重新加载',
  onAction
}: Partial<EmptyStateProps>) => (
  <EmptyState
    variant="error"
    description={description}
    actionLabel={actionLabel}
    onAction={onAction}
  />
)
