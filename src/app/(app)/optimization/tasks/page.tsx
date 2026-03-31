'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  RefreshCw,
  ArrowLeft,
  Play,
  Check,
  Filter
} from 'lucide-react'
import { toast } from 'sonner'

interface OptimizationTask {
  id: number
  campaignName: string
  action: string
  reason: string
  priority: 'high' | 'medium' | 'low'
  status: 'pending' | 'in_progress' | 'completed'
  createdAt: string
  updatedAt?: string
}

/**
 * 优化任务管理页面
 * 显示和管理所有优化任务
 */
export default function OptimizationTasksPage() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [tasks, setTasks] = useState<OptimizationTask[]>([])
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [priorityFilter, setPriorityFilter] = useState<string>('all')
  const [updatingTaskId, setUpdatingTaskId] = useState<number | null>(null)

  useEffect(() => {
    fetchTasks()
  }, [statusFilter])

  const fetchTasks = async () => {
    try {
      setLoading(true)
      const statusParam = statusFilter !== 'all' ? `status=${statusFilter}` : ''
      const response = await fetch(`/api/optimization-tasks?${statusParam}`)

      if (response.ok) {
        const data = await response.json()
        setTasks(data.tasks || [])
      } else {
        toast.error('获取任务列表失败')
      }
    } catch (error) {
      console.error('获取任务失败:', error)
      toast.error('获取任务列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchTasks()
    setRefreshing(false)
    toast.success('任务列表已刷新')
  }

  const handleUpdateStatus = async (taskId: number, newStatus: string) => {
    try {
      setUpdatingTaskId(taskId)
      const response = await fetch(`/api/optimization-tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      })

      if (response.ok) {
        toast.success('任务状态已更新')
        await fetchTasks()
      } else {
        const data = await response.json()
        toast.error(data.error || '更新失败')
      }
    } catch (error) {
      console.error('更新任务状态失败:', error)
      toast.error('更新任务状态失败')
    } finally {
      setUpdatingTaskId(null)
    }
  }

  const getSeverityBadge = (priority: string) => {
    switch (priority) {
      case 'high':
        return <Badge variant="destructive">高优先级</Badge>
      case 'medium':
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-700">中优先级</Badge>
      case 'low':
        return <Badge variant="outline">低优先级</Badge>
      default:
        return <Badge variant="outline">{priority}</Badge>
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <Badge variant="secondary" className="bg-green-100 text-green-700 gap-1">
            <CheckCircle2 className="w-3 h-3" />
            已完成
          </Badge>
        )
      case 'in_progress':
        return (
          <Badge variant="secondary" className="bg-blue-100 text-blue-700 gap-1">
            <Clock className="w-3 h-3" />
            进行中
          </Badge>
        )
      default:
        return (
          <Badge variant="secondary" className="bg-orange-100 text-orange-700 gap-1">
            <AlertTriangle className="w-3 h-3" />
            待处理
          </Badge>
        )
    }
  }

  // 过滤任务
  const filteredTasks = tasks.filter(task => {
    if (priorityFilter !== 'all' && task.priority !== priorityFilter) {
      return false
    }
    return true
  })

  // 统计数据
  const stats = {
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    inProgress: tasks.filter(t => t.status === 'in_progress').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    high: tasks.filter(t => t.priority === 'high').length
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
        <div className="flex items-center gap-4">
          <a
            href="/optimization/overview"
            className="inline-flex items-center justify-center w-10 h-10 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </a>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">优化任务管理</h1>
            <p className="text-slate-500 mt-1">查看和处理所有优化建议</p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={handleRefresh}
          disabled={refreshing}
          className="gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-slate-500">全部任务</p>
            <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-slate-500">待处理</p>
            <p className="text-2xl font-bold text-orange-600">{stats.pending}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-slate-500">进行中</p>
            <p className="text-2xl font-bold text-blue-600">{stats.inProgress}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-slate-500">已完成</p>
            <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-slate-500">高优先级</p>
            <p className="text-2xl font-bold text-red-600">{stats.high}</p>
          </CardContent>
        </Card>
      </div>

      {/* 筛选器 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">任务列表</CardTitle>
              <CardDescription>共 {filteredTasks.length} 个任务</CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-400" />
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[120px]">
                    <SelectValue placeholder="状态筛选" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部状态</SelectItem>
                    <SelectItem value="pending">待处理</SelectItem>
                    <SelectItem value="in_progress">进行中</SelectItem>
                    <SelectItem value="completed">已完成</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="优先级" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部优先级</SelectItem>
                  <SelectItem value="high">高</SelectItem>
                  <SelectItem value="medium">中</SelectItem>
                  <SelectItem value="low">低</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredTasks.length > 0 ? (
            <Table className="[&_thead_th]:bg-white">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">广告系列</TableHead>
                  <TableHead>优化建议</TableHead>
                  <TableHead className="w-[100px]">优先级</TableHead>
                  <TableHead className="w-[100px]">状态</TableHead>
                  <TableHead className="w-[150px]">创建时间</TableHead>
                  <TableHead className="w-[150px] text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="font-medium">
                      {task.campaignName || '未关联广告系列'}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium">{task.action}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{task.reason}</p>
                      </div>
                    </TableCell>
                    <TableCell>{getSeverityBadge(task.priority)}</TableCell>
                    <TableCell>{getStatusBadge(task.status)}</TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {new Date(task.createdAt).toLocaleDateString('zh-CN')}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {task.status === 'pending' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleUpdateStatus(task.id, 'in_progress')}
                            disabled={updatingTaskId === task.id}
                            className="gap-1"
                          >
                            <Play className="w-3 h-3" />
                            开始
                          </Button>
                        )}
                        {task.status === 'in_progress' && (
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => handleUpdateStatus(task.id, 'completed')}
                            disabled={updatingTaskId === task.id}
                            className="gap-1"
                          >
                            <Check className="w-3 h-3" />
                            完成
                          </Button>
                        )}
                        {task.status === 'completed' && (
                          <span className="text-xs text-slate-400">已处理</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12 text-slate-500">
              <CheckCircle2 className="w-16 h-16 mx-auto text-green-300 mb-4" />
              <p className="text-lg font-medium">暂无任务</p>
              <p className="text-sm mt-1">
                {statusFilter !== 'all' ? '该状态下没有任务' : '所有优化任务已完成'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
