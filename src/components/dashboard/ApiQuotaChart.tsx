'use client'

/**
 * Google Ads API配额使用圆环图
 * 显示每日API调用次数和剩余配额
 */

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Activity, AlertTriangle, CheckCircle2, TrendingUp } from 'lucide-react'
import { safeToFixed } from '@/lib/utils'

interface ApiQuotaData {
  today: {
    totalRequests: number
    totalOperations: number
    quotaLimit: number
    quotaRemaining: number
    quotaUsagePercent: number
    successfulOperations: number
    failedOperations: number
    operationBreakdown: {
      [key: string]: number
    }
  }
  quotaCheck: {
    isNearLimit: boolean
    isOverLimit: boolean
    currentUsage: number
    percentUsed: number
  }
  recommendations: string[]
  trend: Array<{
    date: string
    totalRequests: number
    successRate: number
  }>
  latestRateLimitEvent?: {
    occurredAt: string
    message: string
    endpoint?: string | null
  } | null
  isUsingSharedCredentials?: boolean // 是否使用共享凭证
  targetUserId?: number // 实际统计的用户ID
}

interface Props {
  days?: number
}

export function ApiQuotaChart({ days = 7 }: Props) {
  const [data, setData] = useState<ApiQuotaData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchQuotaData()
  }, [days])

  const fetchQuotaData = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/dashboard/api-quota?days=${days}`, {
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error('Failed to fetch quota data')
      }

      const result = await response.json()
      setData(result.data)
    } catch (error) {
      console.error('Failed to fetch API quota:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-gray-500">
          <Activity className="w-12 h-12 mx-auto mb-2 text-gray-300" />
          <p>暂无API使用数据</p>
        </CardContent>
      </Card>
    )
  }

  const { today, quotaCheck, recommendations, latestRateLimitEvent } = data

  const isUnlimitedQuota = (today.quotaLimit ?? 0) < 0
  const todayQuotaConsumption = today.totalRequests ?? 0
  const latestRateLimitTime = latestRateLimitEvent?.occurredAt
    ? new Date(latestRateLimitEvent.occurredAt).toLocaleString('zh-CN', {
        hour12: false,
      })
    : null

  // 计算圆环图参数
  const usagePercent = isUnlimitedQuota ? 0 : Math.min(today.quotaUsagePercent, 100)
  const remainingPercent = Math.max(0, 100 - usagePercent)

  // 圆环图SVG参数（缩小20%高度：160 → 128）
  const size = 128
  const strokeWidth = 16
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const usageOffset = circumference - (usagePercent / 100) * circumference
  const centerX = size / 2
  const centerY = size / 2

  // 颜色根据使用率变化
  const getStatusColor = () => {
    if (quotaCheck.isOverLimit) return 'text-red-600'
    if (quotaCheck.isNearLimit) return 'text-orange-600'
    return 'text-green-600'
  }

  const getStatusBadge = () => {
    if (quotaCheck.isOverLimit) {
      return { label: '已超限', variant: 'destructive' as const, icon: AlertTriangle }
    }
    if (quotaCheck.isNearLimit) {
      return { label: '接近限制', variant: 'secondary' as const, icon: AlertTriangle, className: 'bg-orange-500 hover:bg-orange-600' }
    }
    return { label: '正常', variant: 'default' as const, icon: CheckCircle2, className: 'bg-green-600 hover:bg-green-700' }
  }

  const statusBadge = getStatusBadge()
  const StatusIcon = statusBadge.icon

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-600" />
            API配额使用
          </CardTitle>
          <Badge
            variant={statusBadge.variant}
            className={statusBadge.className}
          >
            <StatusIcon className="w-3 h-3 mr-1" />
            {statusBadge.label}
          </Badge>
        </div>
        <CardDescription className="text-xs">
          今日Google Ads API配额消耗量
          {data.isUsingSharedCredentials && (
            <span className="text-blue-600 ml-1">（系统共享账号）</span>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 圆环图 */}
        <div className="flex items-center justify-center">
          <div className="relative" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="transform -rotate-90">
              {/* 背景圆环 */}
              <circle
                cx={centerX}
                cy={centerY}
                r={radius}
                fill="none"
                stroke="#e5e7eb"
                strokeWidth={strokeWidth}
              />
              {/* 使用量圆环 */}
              <circle
                cx={centerX}
                cy={centerY}
                r={radius}
                fill="none"
                stroke={quotaCheck.isOverLimit ? '#dc2626' : quotaCheck.isNearLimit ? '#f59e0b' : '#10b981'}
                strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={usageOffset}
                strokeLinecap="round"
                className="transition-all duration-500"
              />
            </svg>

            {/* 中心文字 */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className={`text-2xl font-bold ${getStatusColor()}`}>
                {(todayQuotaConsumption ?? 0).toLocaleString('en-US')}
              </div>
              <div className="text-xs text-gray-500">
                / {isUnlimitedQuota ? '无限' : (today.quotaLimit ?? 0).toLocaleString('en-US')}
              </div>
              <div className={`text-xs font-medium mt-0.5 ${getStatusColor()}`}>
                {isUnlimitedQuota ? '无限制' : `${safeToFixed(usagePercent ?? 0, 1)}%`}
              </div>
            </div>
          </div>
        </div>

        {/* 统计信息 */}
        <div className="grid grid-cols-2 gap-3 pt-2 border-t">
          <div>
            <div className="text-xs text-gray-500">剩余配额</div>
            <div className="text-lg font-semibold text-gray-900">
              {isUnlimitedQuota ? '无限' : (today.quotaRemaining ?? 0).toLocaleString('en-US')}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">成功率</div>
            <div className="text-lg font-semibold text-gray-900">
              {today.totalRequests > 0
                ? safeToFixed(
                    ((today.successfulOperations ?? 0) / ((today.successfulOperations ?? 0) + (today.failedOperations ?? 0)) * 100),
                    1
                  )
                : '0'}%
            </div>
          </div>
        </div>

        {/* 建议 */}
        {recommendations && recommendations.length > 0 && (
          <Alert className={quotaCheck.isOverLimit ? 'bg-red-50 border-red-200' : quotaCheck.isNearLimit ? 'bg-orange-50 border-orange-200' : 'bg-green-50 border-green-200'}>
            <AlertDescription className="text-xs">
              {recommendations[0]}
            </AlertDescription>
          </Alert>
        )}

        {latestRateLimitEvent && (
          <Alert className="bg-amber-50 border-amber-200">
            <AlertDescription className="text-xs space-y-1">
              <div className="font-medium text-amber-900">最近限速事件</div>
              <div className="text-amber-800">
                时间: {latestRateLimitTime || latestRateLimitEvent.occurredAt}
              </div>
              <div className="text-amber-800 break-words">
                内容: {latestRateLimitEvent.message}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* 操作类型分布 */}
        {today.operationBreakdown && Object.keys(today.operationBreakdown).length > 0 && (
          <div className="pt-2 border-t">
            <div className="text-xs text-gray-500 mb-2">操作类型分布</div>
            <div className="space-y-1.5">
              {Object.entries(today.operationBreakdown)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .slice(0, 3)
                .map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between text-xs">
                    <span className="text-gray-600 capitalize">{type.replace('_', ' ')}</span>
                    <span className="font-medium text-gray-900">{(count as number).toLocaleString('en-US')}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* 最近趋势 */}
        {data.trend && data.trend.length > 0 && (
          <div className="pt-2 border-t">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
              <span>最近{days}天趋势</span>
              <TrendingUp className="w-3 h-3" />
            </div>
            <div className="space-y-1">
              {data.trend.slice(0, 3).map((item) => (
                <div key={item.date} className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">{item.date}</span>
                  <span className="font-medium text-gray-900">{(item.totalRequests ?? 0).toLocaleString('en-US')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
