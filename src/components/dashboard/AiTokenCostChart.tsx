'use client'

/**
 * AI Token成本图表
 * 显示AI模型调用的token使用量和成本统计
 */

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Zap, DollarSign, TrendingUp, AlertTriangle } from 'lucide-react'
import { safeToFixed } from '@/lib/utils'

interface TokenUsage {
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  callCount: number
}

interface OperationUsage {
  operationType: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  callCount: number
}

interface AiTokenData {
  today: {
    totalCost: number
    totalTokens: number
    totalCalls: number
    modelUsage: TokenUsage[]
    operationUsage?: OperationUsage[] // 🆕 操作类型分布
  }
  trend: Array<{
    date: string
    totalCost: number
    totalTokens: number
  }>
  recommendations: string[]
  highCostOperations?: OperationUsage[] // 🆕 高成本操作
}

interface Props {
  days?: number
}

export function AiTokenCostChart({ days = 7 }: Props) {
  const [data, setData] = useState<AiTokenData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTokenData()
  }, [days])

  const fetchTokenData = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/dashboard/ai-token-cost?days=${days}`, {
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error('Failed to fetch token data')
      }

      const result = await response.json()
      setData(result.data)
    } catch (error) {
      console.error('Failed to fetch AI token cost:', error)
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
          <Zap className="w-12 h-12 mx-auto mb-2 text-gray-300" />
          <p>暂无AI使用数据</p>
        </CardContent>
      </Card>
    )
  }

  const { today, trend, recommendations } = data

  // 圆环图SVG参数（与ApiQuotaChart保持一致）
  const size = 128
  const strokeWidth = 16
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const centerX = size / 2
  const centerY = size / 2

  // 计算模型使用占比（取最大使用的模型）
  const topModel = today.modelUsage && today.modelUsage.length > 0
    ? today.modelUsage.reduce((max, model) =>
        (model.totalTokens ?? 0) > (max.totalTokens ?? 0) ? model : max
      )
    : null

  const topModelPercent = topModel && (today.totalTokens ?? 0) > 0
    ? ((topModel.totalTokens ?? 0) / (today.totalTokens ?? 1)) * 100
    : 0

  const usageOffset = circumference - (topModelPercent / 100) * circumference

  // 颜色根据成本等级
  const getStatusColor = () => {
    if (today.totalCost > 100) return 'text-red-600'
    if (today.totalCost > 50) return 'text-orange-600'
    return 'text-green-600'
  }

  const getStatusBadge = () => {
    if (today.totalCost > 100) {
      return { label: '高成本', variant: 'destructive' as const, icon: AlertTriangle }
    }
    if (today.totalCost > 50) {
      return { label: '中等', variant: 'secondary' as const, icon: DollarSign, className: 'bg-orange-500 hover:bg-orange-600' }
    }
    return { label: '正常', variant: 'default' as const, icon: DollarSign, className: 'bg-green-600 hover:bg-green-700' }
  }

  const statusBadge = getStatusBadge()
  const StatusIcon = statusBadge.icon

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-5 h-5 text-purple-600" />
            AI Token成本
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
          今日AI模型调用统计
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
                stroke={today.totalCost > 100 ? '#dc2626' : today.totalCost > 50 ? '#f59e0b' : '#8b5cf6'}
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
                ¥{safeToFixed(Number(today.totalCost) || 0, 2)}
              </div>
              <div className="text-xs text-gray-500">{today.totalCalls || 0} 次调用</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {safeToFixed((Number(today.totalTokens) || 0) / 1000, 1)}K tokens
              </div>
            </div>
          </div>
        </div>

        {/* 统计信息 */}
        <div className="grid grid-cols-2 gap-3 pt-2 border-t">
          <div>
            <div className="text-xs text-gray-500">输入Token</div>
            <div className="text-lg font-semibold text-gray-900">
              {(today.modelUsage?.reduce((sum, m) => sum + (m.inputTokens ?? 0), 0) ?? 0).toLocaleString('en-US')}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">输出Token</div>
            <div className="text-lg font-semibold text-gray-900">
              {(today.modelUsage?.reduce((sum, m) => sum + (m.outputTokens ?? 0), 0) ?? 0).toLocaleString('en-US')}
            </div>
          </div>
        </div>

        {/* 建议 */}
        {recommendations && recommendations.length > 0 && (
          <Alert className={today.totalCost > 100 ? 'bg-red-50 border-red-200' : today.totalCost > 50 ? 'bg-orange-50 border-orange-200' : 'bg-purple-50 border-purple-200'}>
            <AlertDescription className="text-xs">
              {recommendations[0]}
            </AlertDescription>
          </Alert>
        )}

        {/* 🆕 操作类型分布（优先显示，更重要）*/}
        {today.operationUsage && today.operationUsage.length > 0 && (
          <div className="pt-2 border-t">
            <div className="text-xs text-gray-500 mb-2">高成本操作类型（Top 5）</div>
            <div className="space-y-1.5">
              {today.operationUsage
                .slice(0, 5)
                .map((op) => {
                  const isHighCost = op.cost > 10
                  const opName = op.operationType
                    .replace(/_/g, ' ')
                    .replace(/\b\w/g, (c) => c.toUpperCase())
                  return (
                    <div key={op.operationType} className="flex items-center justify-between text-xs">
                      <div className="flex items-center flex-1 mr-2">
                        <span className={`truncate ${isHighCost ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                          {opName}
                        </span>
                        {isHighCost && <AlertTriangle className="w-3 h-3 ml-1 text-red-500" />}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 text-xs">{Number(op.callCount) || 0}次</span>
                        <span className="font-medium text-gray-900">¥{safeToFixed(Number(op.cost) || 0, 2)}</span>
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        )}

        {/* 模型使用分布 */}
        {today.modelUsage && today.modelUsage.length > 0 && (
          <div className="pt-2 border-t">
            <div className="text-xs text-gray-500 mb-2">模型使用分布</div>
            <div className="space-y-1.5">
              {today.modelUsage
                .sort((a, b) => b.cost - a.cost)
                .slice(0, 3)
                .map((model) => (
                  <div key={model.model} className="flex items-center justify-between text-xs">
                    <span className="text-gray-600 truncate flex-1 mr-2">{model.model}</span>
                    <span className="font-medium text-gray-900">¥{safeToFixed(Number(model.cost) || 0, 2)}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* 最近趋势 */}
        {trend && trend.length > 0 && (
          <div className="pt-2 border-t">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
              <span>最近{days}天趋势</span>
              <TrendingUp className="w-3 h-3" />
            </div>
            <div className="space-y-1">
              {trend.slice(0, 3).map((item) => (
                <div key={item.date} className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">{item.date}</span>
                  <span className="font-medium text-gray-900">¥{safeToFixed(Number(item.totalCost) || 0, 2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
