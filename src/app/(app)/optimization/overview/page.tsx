'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  MousePointer,
  Eye,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Target,
  Zap
} from 'lucide-react'
import { toast } from 'sonner'

interface OptimizationMetrics {
  ctrChange: number
  cpcChange: number
  impressionsChange: number
  clicksChange: number
  pendingTasks: number
  completedTasks: number
  costSavings: number
  lastUpdated: string
}

interface OptimizationTask {
  id: number
  title: string
  description: string
  severity: 'high' | 'medium' | 'low'
  status: 'pending' | 'in_progress' | 'completed'
  createdAt: string
}

interface CreativeScore {
  creativeId: number
  headline: string
  score: number
  rating: string
  ctr: number
  impressions: number
}

/**
 * 优化概览页面
 * 显示核心优化指标和任务列表
 */
export default function OptimizationOverviewPage() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [metrics, setMetrics] = useState<OptimizationMetrics | null>(null)
  const [tasks, setTasks] = useState<OptimizationTask[]>([])
  const [topCreatives, setTopCreatives] = useState<CreativeScore[]>([])

  useEffect(() => {
    fetchOptimizationData()
  }, [])

  const fetchOptimizationData = async () => {
    try {
      setLoading(true)

      // 并行获取优化数据
      const [metricsRes, tasksRes, creativesRes] = await Promise.all([
        fetch('/api/optimization/metrics'),
        fetch('/api/optimization-tasks?status=pending'),
        fetch('/api/optimization/top-creatives?limit=5')
      ])

      if (metricsRes.ok) {
        const metricsData = await metricsRes.json()
        setMetrics(metricsData.metrics)
      } else {
        // 使用默认数据
        setMetrics({
          ctrChange: 0,
          cpcChange: 0,
          impressionsChange: 0,
          clicksChange: 0,
          pendingTasks: 0,
          completedTasks: 0,
          costSavings: 0,
          lastUpdated: new Date().toISOString()
        })
      }

      if (tasksRes.ok) {
        const tasksData = await tasksRes.json()
        // 转换任务数据格式以匹配页面需求
        const formattedTasks = (tasksData.tasks || []).slice(0, 5).map((task: any) => ({
          id: task.id,
          title: task.campaignName || '优化任务',
          description: task.reason || task.action || '',
          severity: task.priority || 'medium',
          status: task.status || 'pending',
          createdAt: task.createdAt
        }))
        setTasks(formattedTasks)
      }

      if (creativesRes.ok) {
        const creativesData = await creativesRes.json()
        setTopCreatives(creativesData.creatives || [])
      }
    } catch (error) {
      console.error('获取优化数据失败:', error)
      toast.error('获取优化数据失败')
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchOptimizationData()
    setRefreshing(false)
    toast.success('数据已刷新')
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high':
        return 'bg-red-100 text-red-700 border-red-200'
      case 'medium':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200'
      case 'low':
        return 'bg-green-100 text-green-700 border-green-200'
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />
      case 'in_progress':
        return <Clock className="w-4 h-4 text-blue-500" />
      default:
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />
    }
  }

  const getRatingColor = (rating: string) => {
    switch (rating) {
      case 'excellent':
        return 'text-green-600 bg-green-50'
      case 'good':
        return 'text-blue-600 bg-blue-50'
      case 'average':
        return 'text-yellow-600 bg-yellow-50'
      default:
        return 'text-red-600 bg-red-50'
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">优化概览</h1>
          <p className="text-slate-500 mt-1">监控广告表现，持续优化投放效果</p>
        </div>
        <Button
          variant="outline"
          onClick={handleRefresh}
          disabled={refreshing}
          className="gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          刷新数据
        </Button>
      </div>

      {/* 核心KPI卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* CTR变化 */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500 font-medium">CTR变化</p>
                <p className="text-2xl font-bold mt-1">
                  {metrics?.ctrChange != null ? (
                    <span className={metrics.ctrChange >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {metrics.ctrChange >= 0 ? '+' : ''}{metrics.ctrChange.toFixed(2)}%
                    </span>
                  ) : (
                    <span className="text-slate-400">--</span>
                  )}
                </p>
                <p className="text-xs text-slate-400 mt-1">过去7天</p>
              </div>
              <div className={`p-3 rounded-full ${metrics?.ctrChange && metrics.ctrChange >= 0 ? 'bg-green-100' : 'bg-red-100'}`}>
                {metrics?.ctrChange && metrics.ctrChange >= 0 ? (
                  <TrendingUp className="w-6 h-6 text-green-600" />
                ) : (
                  <TrendingDown className="w-6 h-6 text-red-600" />
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CPC变化 */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500 font-medium">CPC变化</p>
                <p className="text-2xl font-bold mt-1">
                  {metrics?.cpcChange != null ? (
                    <span className={metrics.cpcChange <= 0 ? 'text-green-600' : 'text-red-600'}>
                      {metrics.cpcChange >= 0 ? '+' : ''}{metrics.cpcChange.toFixed(2)}%
                    </span>
                  ) : (
                    <span className="text-slate-400">--</span>
                  )}
                </p>
                <p className="text-xs text-slate-400 mt-1">过去7天（负值表示成本下降）</p>
              </div>
              <div className={`p-3 rounded-full ${metrics?.cpcChange && metrics.cpcChange <= 0 ? 'bg-green-100' : 'bg-red-100'}`}>
                <DollarSign className={`w-6 h-6 ${metrics?.cpcChange && metrics.cpcChange <= 0 ? 'text-green-600' : 'text-red-600'}`} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 展示量变化 */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500 font-medium">展示量变化</p>
                <p className="text-2xl font-bold mt-1">
                  {metrics?.impressionsChange != null ? (
                    <span className={metrics.impressionsChange >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {metrics.impressionsChange >= 0 ? '+' : ''}{metrics.impressionsChange.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-slate-400">--</span>
                  )}
                </p>
                <p className="text-xs text-slate-400 mt-1">过去7天</p>
              </div>
              <div className={`p-3 rounded-full ${metrics?.impressionsChange && metrics.impressionsChange >= 0 ? 'bg-blue-100' : 'bg-red-100'}`}>
                <Eye className={`w-6 h-6 ${metrics?.impressionsChange && metrics.impressionsChange >= 0 ? 'text-blue-600' : 'text-red-600'}`} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 优化任务 */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500 font-medium">优化任务</p>
                <p className="text-2xl font-bold mt-1">
                  <span className="text-orange-600">{metrics?.pendingTasks || 0}</span>
                  <span className="text-slate-400 text-lg"> / </span>
                  <span className="text-green-600">{metrics?.completedTasks || 0}</span>
                </p>
                <p className="text-xs text-slate-400 mt-1">待处理 / 已完成</p>
              </div>
              <div className="p-3 rounded-full bg-orange-100">
                <Target className="w-6 h-6 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 两列布局：任务列表和创意排行 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 待处理任务 */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">待处理优化任务</CardTitle>
                <CardDescription>需要关注的优化建议</CardDescription>
              </div>
              <a
                href="/optimization/tasks"
                className="inline-flex items-center gap-1 px-3 h-9 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
              >
                查看全部
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </CardHeader>
          <CardContent>
            {tasks.length > 0 ? (
              <div className="space-y-3">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-start gap-3 p-3 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors"
                  >
                    {getStatusIcon(task.status)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {task.title}
                        </p>
                        <Badge variant="outline" className={`text-xs ${getSeverityColor(task.severity)}`}>
                          {task.severity === 'high' ? '高' : task.severity === 'medium' ? '中' : '低'}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                        {task.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-slate-500">
                <CheckCircle2 className="w-12 h-12 mx-auto text-green-300 mb-3" />
                <p>暂无待处理任务</p>
                <p className="text-xs mt-1">所有优化任务已完成</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 创意性能排行 */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">创意性能排行</CardTitle>
                <CardDescription>5维度评分 TOP 5</CardDescription>
              </div>
              <a
                href="/optimization/creative-learning"
                className="inline-flex items-center gap-1 px-3 h-9 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
              >
                查看详情
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </CardHeader>
          <CardContent>
            {topCreatives.length > 0 ? (
              <div className="space-y-3">
                {topCreatives.map((creative, index) => (
                  <div
                    key={creative.creativeId}
                    className="flex items-center gap-3 p-3 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors"
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      index === 0 ? 'bg-yellow-100 text-yellow-700' :
                      index === 1 ? 'bg-slate-200 text-slate-700' :
                      index === 2 ? 'bg-orange-100 text-orange-700' :
                      'bg-slate-100 text-slate-500'
                    }`}>
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {creative.headline || '创意标题'}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-slate-500">
                          CTR: {((creative.ctr ?? 0) * 100).toFixed(2)}%
                        </span>
                        <span className="text-xs text-slate-500">
                          展示: {(creative.impressions ?? 0).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${getRatingColor(creative.rating || 'poor')}`}>
                        <Zap className="w-3 h-3" />
                        {creative.score ?? 0}分
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-slate-500">
                <MousePointer className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                <p>暂无创意评分数据</p>
                <p className="text-xs mt-1">需要更多广告投放数据</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 快捷操作 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">快捷操作</CardTitle>
          <CardDescription>常用优化功能入口</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <a
              href="/optimization/tasks"
              className="inline-flex items-center justify-center h-auto py-4 flex-col gap-2 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground text-sm font-medium transition-colors"
            >
              <Target className="w-5 h-5 text-orange-500" />
              <span>任务管理</span>
            </a>
            <a
              href="/optimization/creative-learning"
              className="inline-flex items-center justify-center h-auto py-4 flex-col gap-2 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground text-sm font-medium transition-colors"
            >
              <Zap className="w-5 h-5 text-blue-500" />
              <span>创意学习</span>
            </a>
            <a
              href="/optimization/trends"
              className="inline-flex items-center justify-center h-auto py-4 flex-col gap-2 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground text-sm font-medium transition-colors"
            >
              <TrendingUp className="w-5 h-5 text-green-500" />
              <span>性能趋势</span>
            </a>
            <a
              href="/optimization/competitors"
              className="inline-flex items-center justify-center h-auto py-4 flex-col gap-2 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground text-sm font-medium transition-colors"
            >
              <Eye className="w-5 h-5 text-purple-500" />
              <span>竞品监控</span>
            </a>
          </div>
        </CardContent>
      </Card>

      {/* 最后更新时间 */}
      {metrics?.lastUpdated && (
        <p className="text-xs text-slate-400 text-center">
          最后更新: {new Date(metrics.lastUpdated).toLocaleString('zh-CN')}
        </p>
      )}
    </div>
  )
}
