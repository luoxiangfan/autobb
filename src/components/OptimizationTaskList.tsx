'use client'

/**
 * 优化任务清单组件
 *
 * 功能：
 * - TODO风格展示优化任务
 * - 按优先级分组
 * - 更新任务状态
 * - 手动生成新任务
 */

import { useState, useEffect } from 'react'
import {
  CheckCircle2,
  Circle,
  XCircle,
  AlertTriangle,
  TrendingUp,
  Info,
  Loader2,
  RefreshCw,
  ChevronRight
} from 'lucide-react'
import { showSuccess, showError } from '@/lib/toast-utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'

interface Task {
  id: number
  campaignId: number
  campaignName: string
  taskType: string
  priority: 'high' | 'medium' | 'low'
  reason: string
  action: string
  expectedImpact: string
  status: 'pending' | 'in_progress' | 'completed' | 'dismissed'
  createdAt: string
}

interface Statistics {
  total: number
  pending: number
  inProgress: number
  completed: number
  dismissed: number
  byPriority: {
    high: number
    medium: number
    low: number
  }
}

export default function OptimizationTaskList() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [statistics, setStatistics] = useState<Statistics | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [expandedTask, setExpandedTask] = useState<number | null>(null)
  const [completionNote, setCompletionNote] = useState<string>('')

  // 加载任务
  const loadTasks = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/optimization-tasks', {
        credentials: 'include'
      })
      if (!response.ok) throw new Error('Failed to load tasks')

      const data = await response.json()
      setTasks(data.tasks)
      setStatistics(data.statistics)
    } catch (error) {
      console.error('Load tasks error:', error)
    } finally {
      setLoading(false)
    }
  }

  // 生成新任务
  const generateTasks = async () => {
    setGenerating(true)
    try {
      const response = await fetch('/api/optimization-tasks', {
        method: 'POST'
      })

      if (!response.ok) throw new Error('Failed to generate tasks')

      const data = await response.json()
      await loadTasks()

      showSuccess('任务生成成功', `已生成 ${data.generatedTasks} 个优化任务`)
    } catch (error) {
      console.error('Generate tasks error:', error)
      showError('任务生成失败', '请稍后重试')
    } finally {
      setGenerating(false)
    }
  }

  // 更新任务状态
  const updateTaskStatus = async (
    taskId: number,
    status: 'in_progress' | 'completed' | 'dismissed',
    note?: string
  ) => {
    try {
      const response = await fetch(`/api/optimization-tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, note })
      })

      if (!response.ok) throw new Error('Failed to update task')

      await loadTasks()
      setExpandedTask(null)
      setCompletionNote('')
    } catch (error) {
      console.error('Update task error:', error)
      showError('更新任务失败', '请稍后重试')
    }
  }

  useEffect(() => {
    loadTasks()
  }, [])

  // 优先级配置
  const priorityConfig = {
    high: {
      color: 'bg-red-100 text-red-800 border-red-300',
      icon: AlertTriangle,
      label: '高优先级'
    },
    medium: {
      color: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      icon: TrendingUp,
      label: '中优先级'
    },
    low: {
      color: 'bg-blue-100 text-blue-800 border-blue-300',
      icon: Info,
      label: '低优先级'
    }
  }

  // 按优先级和状态分组
  const groupedTasks = {
    pending: {
      high: tasks.filter(t => t.status === 'pending' && t.priority === 'high'),
      medium: tasks.filter(t => t.status === 'pending' && t.priority === 'medium'),
      low: tasks.filter(t => t.status === 'pending' && t.priority === 'low')
    },
    inProgress: tasks.filter(t => t.status === 'in_progress'),
    completed: tasks.filter(t => t.status === 'completed'),
    dismissed: tasks.filter(t => t.status === 'dismissed')
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-3 text-sm text-gray-500">加载优化任务...</span>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* 统计卡片 */}
      {statistics && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{statistics.pending}</div>
              <p className="text-xs text-gray-500">待处理任务</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-red-600">{statistics.byPriority.high}</div>
              <p className="text-xs text-gray-500">高优先级</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-green-600">{statistics.completed}</div>
              <p className="text-xs text-gray-500">已完成</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-gray-600">{statistics.total}</div>
              <p className="text-xs text-gray-500">总任务数（30天）</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 头部操作 */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">优化任务清单</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadTasks}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
          <Button onClick={generateTasks} disabled={generating}>
            {generating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                生成中...
              </>
            ) : (
              '生成新任务'
            )}
          </Button>
        </div>
      </div>

      {/* 待处理任务 */}
      {Object.entries(groupedTasks.pending).map(([priority, priorityTasks]) => {
        if (priorityTasks.length === 0) return null

        const config = priorityConfig[priority as 'high' | 'medium' | 'low']
        const Icon = config.icon

        return (
          <Card key={priority}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Icon className="h-5 w-5" />
                <CardTitle>{config.label}</CardTitle>
                <Badge variant="secondary">{priorityTasks.length}</Badge>
              </div>
              <CardDescription>需要采取行动的Campaign优化建议</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {priorityTasks.map((task) => (
                  <div key={task.id} className={`rounded-lg border p-4 ${config.color}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Circle className="h-4 w-4" />
                          <span className="font-semibold">{task.campaignName}</span>
                          <Badge variant="outline" className="text-xs">
                            {task.taskType}
                          </Badge>
                        </div>

                        <p className="text-sm mb-2">{task.reason}</p>

                        {expandedTask === task.id && (
                          <div className="mt-3 space-y-2 border-t pt-2">
                            <p className="text-sm font-medium">建议行动：</p>
                            <p className="text-sm">{task.action}</p>

                            <p className="text-sm font-medium mt-2">预期影响：</p>
                            <p className="text-sm">{task.expectedImpact}</p>

                            <div className="mt-3 space-y-2">
                              <Textarea
                                placeholder="添加完成备注（可选）..."
                                value={completionNote}
                                onChange={(e) => setCompletionNote(e.target.value)}
                                rows={2}
                              />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => updateTaskStatus(task.id, 'in_progress')}
                                >
                                  标记为进行中
                                </Button>
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => updateTaskStatus(task.id, 'completed', completionNote)}
                                >
                                  <CheckCircle2 className="mr-1 h-3 w-3" />
                                  完成
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => updateTaskStatus(task.id, 'dismissed', completionNote)}
                                >
                                  <XCircle className="mr-1 h-3 w-3" />
                                  忽略
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
                      >
                        <ChevronRight
                          className={`h-4 w-4 transition-transform ${
                            expandedTask === task.id ? 'rotate-90' : ''
                          }`}
                        />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )
      })}

      {/* 进行中的任务 */}
      {groupedTasks.inProgress.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>进行中的任务</CardTitle>
            <CardDescription>{groupedTasks.inProgress.length}个任务正在处理</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {groupedTasks.inProgress.map((task) => (
                <div key={task.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  <div className="flex-1">
                    <span className="font-medium">{task.campaignName}</span>
                    <span className="ml-2 text-sm text-gray-500">- {task.reason}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => updateTaskStatus(task.id, 'completed')}
                  >
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    完成
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 已完成任务（折叠） */}
      {groupedTasks.completed.length > 0 && (
        <Card className="opacity-60">
          <CardHeader>
            <CardTitle className="text-sm">已完成 ({groupedTasks.completed.length})</CardTitle>
          </CardHeader>
        </Card>
      )}

      {/* 空状态 */}
      {tasks.length === 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>暂无优化任务</AlertTitle>
          <AlertDescription>
            点击「生成新任务」按钮，系统将分析您的Campaign表现并生成优化建议
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
