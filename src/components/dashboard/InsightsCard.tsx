'use client'

/**
 * InsightsCard - P1-5优化版
 * 使用shadcn/ui Card, Button, Badge组件
 */

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, Info, AlertTriangle, TrendingUp, Lightbulb } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { safeToFixed } from '@/lib/utils'

interface Insight {
  id: string
  type: 'warning' | 'success' | 'info' | 'error'
  priority: 'high' | 'medium' | 'low'
  title: string
  message: string
  recommendation: string
  relatedCampaign?: {
    id: number
    name: string
  }
  relatedOffer?: {
    id: number
    name: string
    url: string
  }
  metrics?: {
    current: number
    benchmark: number
    change: number
  }
  createdAt: string
}

interface InsightsData {
  insights: Insight[]
  total: number
  summary: {
    high: number
    medium: number
    low: number
  }
  generatedAt: string
}

interface InsightsCardProps {
  days: number
}

export function InsightsCard({ days }: InsightsCardProps) {
  const [data, setData] = useState<InsightsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/dashboard/insights?days=${days}`, {
        credentials: 'include'
      })
      if (!response.ok) {
        throw new Error('获取智能洞察失败')
      }
      const result = await response.json()
      setData(result.data)
      setError(null)
    } catch (err) {
      console.error('获取智能洞察失败:', err)
      setError(err instanceof Error ? err.message : '未知错误')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [days])

  const getInsightIcon = (type: string) => {
    switch (type) {
      case 'error':
        return <AlertCircle className="h-5 w-5" />
      case 'warning':
        return <AlertTriangle className="h-5 w-5" />
      case 'success':
        return <CheckCircle className="h-5 w-5" />
      case 'info':
        return <Info className="h-5 w-5" />
      default:
        return <Info className="h-5 w-5" />
    }
  }

  const getInsightColors = (type: string) => {
    switch (type) {
      case 'error':
        return {
          bg: 'bg-red-50',
          border: 'border-red-200',
          icon: 'text-red-600',
          title: 'text-red-900',
        }
      case 'warning':
        return {
          bg: 'bg-yellow-50',
          border: 'border-yellow-200',
          icon: 'text-yellow-600',
          title: 'text-yellow-900',
        }
      case 'success':
        return {
          bg: 'bg-green-50',
          border: 'border-green-200',
          icon: 'text-green-600',
          title: 'text-green-900',
        }
      case 'info':
        return {
          bg: 'bg-blue-50',
          border: 'border-blue-200',
          icon: 'text-blue-600',
          title: 'text-blue-900',
        }
      default:
        return {
          bg: 'bg-gray-50',
          border: 'border-gray-200',
          icon: 'text-gray-600',
          title: 'text-gray-900',
        }
    }
  }

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'high':
        return (
          <Badge variant="destructive" className="bg-red-100 text-red-800 hover:bg-red-200">
            高优先级
          </Badge>
        )
      case 'medium':
        return (
          <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300">
            中优先级
          </Badge>
        )
      case 'low':
        return (
          <Badge variant="secondary">
            低优先级
          </Badge>
        )
      default:
        return null
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="animate-pulse space-y-4">
            <div className="h-6 bg-gray-200 rounded w-48"></div>
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 bg-gray-100 rounded"></div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="border-red-200">
        <CardContent className="pt-6">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="text-red-800 font-medium">数据加载失败</p>
                <p className="text-red-600 text-sm mt-1">{error}</p>
              </div>
            </div>
            <button
              onClick={fetchData}
              className="mt-4 px-4 py-2 bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition-colors text-sm font-medium"
            >
              重新加载
            </button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!data) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-6 w-6 text-blue-600" />
            <CardTitle className="text-lg">智能洞察</CardTitle>
          </div>

          {/* 统计摘要 */}
          <div className="flex items-center gap-4">
            {data.summary?.high > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-sm font-medium text-red-600">{data.summary.high}</span>
                <span className="text-sm text-muted-foreground">高优先级</span>
              </div>
            )}
            {data.summary?.medium > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-sm font-medium text-yellow-600">{data.summary.medium}</span>
                <span className="text-sm text-muted-foreground">中优先级</span>
              </div>
            )}
            {data.summary?.low > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-sm font-medium text-gray-600">{data.summary.low}</span>
                <span className="text-sm text-muted-foreground">低优先级</span>
              </div>
            )}
          </div>
        </div>
      </CardHeader>

      {/* Insights列表 */}
      <CardContent className="space-y-4">
        {!data.insights || data.insights.length === 0 ? (
          <div className="text-center py-12">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <p className="text-muted-foreground">太好了！目前没有发现需要关注的问题</p>
            <p className="text-sm text-muted-foreground mt-2">您的Campaign运行状况良好</p>
          </div>
        ) : (
          data.insights.map((insight) => {
            const colors = getInsightColors(insight.type)
            return (
              <Card
                key={insight.id}
                className={`border ${colors.border} ${colors.bg} hover:shadow-lg transition-all`}
              >
                <CardContent className="pt-6">
                  {/* Insight Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-start gap-3 flex-1">
                      <div className={`p-2 rounded-lg bg-white/50 ${colors.icon}`}>
                        {getInsightIcon(insight.type)}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className={`font-semibold text-base ${colors.title}`}>{insight.title}</h3>
                          {getPriorityBadge(insight.priority)}
                        </div>
                        <p className="text-sm text-foreground/80">{insight.message}</p>
                      </div>
                    </div>
                  </div>

                  {/* Related Campaign or Offer */}
                  {insight.relatedOffer && (
                    <div className="mb-3 pl-10">
                      <div className="flex items-center gap-2 text-sm">
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">相关链接:</span>
                        <a
                          href={`/offers/${insight.relatedOffer.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline font-medium truncate max-w-[300px]"
                          title={insight.relatedOffer.url}
                        >
                          {insight.relatedOffer.name}
                        </a>
                      </div>
                      <div className="flex items-center gap-2 text-sm mt-1 pl-6">
                        <span className="text-muted-foreground text-xs">链接:</span>
                        <a
                          href={insight.relatedOffer.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-500 hover:underline text-xs truncate max-w-[280px]"
                          title={insight.relatedOffer.url}
                        >
                          {insight.relatedOffer.url}
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Related Campaign */}
                  {insight.relatedCampaign && (
                    <div className="mb-3 pl-10">
                      <div className="flex items-center gap-2 text-sm">
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">相关Campaign:</span>
                        <a
                          href={`/campaigns/${insight.relatedCampaign.id}`}
                          className="text-blue-600 hover:underline font-medium"
                        >
                          {insight.relatedCampaign.name}
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Metrics */}
                  {insight.metrics && (
                    <div className="mb-3 pl-10">
                      <div className="flex items-center gap-4 text-sm font-mono">
                        <div>
                          <span className="text-muted-foreground">当前值: </span>
                          <span className="font-semibold text-foreground">
                            {safeToFixed(insight.metrics?.current ?? 0, 2)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">基准值: </span>
                          <span className="font-semibold text-foreground">
                            {safeToFixed(insight.metrics?.benchmark ?? 0, 2)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">差异: </span>
                          <span
                            className={`font-semibold ${(insight.metrics?.change ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'
                              }`}
                          >
                            {(insight.metrics?.change ?? 0) >= 0 ? '+' : ''}
                            {safeToFixed(insight.metrics?.change ?? 0, 2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Recommendation */}
                  <div className="pl-10 pt-3 border-t border-border/50">
                    <p className="text-sm font-medium text-foreground mb-1">💡 建议:</p>
                    <p className="text-sm text-muted-foreground">{insight.recommendation}</p>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </CardContent>

      {/* Footer */}
      {data.insights && data.insights.length > 0 && (
        <CardContent className="bg-muted/30 border-t">
          <p className="text-sm text-muted-foreground">
            最后更新: {new Date(data.generatedAt).toLocaleString('zh-CN')}
          </p>
        </CardContent>
      )}
    </Card>
  )
}
