'use client'

import { useEffect, useState } from 'react'
import { showSuccess, showError } from '@/lib/toast-utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { RefreshCw, CheckCircle2, XCircle, Clock, AlertCircle, Activity, Settings } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { fetchWithRetry } from '@/lib/api-error-handler'

interface SyncStatus {
  isRunning: boolean
  lastSyncAt: string | null
  nextSyncAt: string | null
  lastSyncDuration: number | null
  lastSyncRecordCount: number
  lastSyncError: string | null
}

/**
 * 🔧 修复(2025-12-11): 统一使用 camelCase 字段名
 */
interface SyncLog {
  id: number
  userId: number
  googleAdsAccountId: number
  syncType: 'manual' | 'auto'
  status: 'success' | 'failed' | 'running'
  recordCount: number
  durationMs: number
  errorMessage: string | null
  startedAt: string
  completedAt: string | null
}

export default function SyncManagementPage() {
  const router = useRouter()
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [logs, setLogs] = useState<SyncLog[]>([])
  const [loading, setLoading] = useState(true)
  const [logsRefreshing, setLogsRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)

  useEffect(() => {
    fetchStatus()
    fetchLogs()
  }, [])

  // 自动刷新（每10秒）
  useEffect(() => {
    if (!autoRefresh) return

    const interval = setInterval(() => {
      fetchStatus()
      fetchLogs({ silent: true })
    }, 10000)

    return () => clearInterval(interval)
  }, [autoRefresh])

  const fetchStatus = async () => {
    try {
      const result = await fetchWithRetry('/api/sync/status', {
        credentials: 'include',
      }, {
        maxRetries: 2,
        retryDelay: 2000,
        retryOnErrors: ['SERVICE_UNAVAILABLE', 'HTML_RESPONSE']
      })

      if (result.success) {
        setStatus(result.data)
      }
    } catch (err: any) {
      console.error('Fetch status error:', err)
    }
  }

  const fetchLogs = async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true
    try {
      if (silent) {
        setLogsRefreshing(true)
      } else {
        setLoading(true)
      }
      const result = await fetchWithRetry('/api/sync/logs?limit=20', {
        credentials: 'include',
      }, {
        maxRetries: 2,
        retryDelay: 2000,
        retryOnErrors: ['SERVICE_UNAVAILABLE', 'HTML_RESPONSE']
      })

      if (result.success) {
        setLogs(result.data.logs)
      }
    } catch (err: any) {
      console.error('Fetch logs error:', err)
    } finally {
      if (silent) {
        setLogsRefreshing(false)
      } else {
        setLoading(false)
      }
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const result = await fetchWithRetry('/api/sync/trigger', {
        method: 'POST',
        credentials: 'include',
      })

      if (!result.success) {
        showError('同步失败', result.userMessage)
        return
      }

      const data = result.data
      // 🔧 修复(2025-12-28): API已改为异步队列，无法立即返回recordCount和duration
      // 改为显示任务已加入队列的提示
      showSuccess(
        '数据同步任务已加入队列',
        `任务ID: ${data.taskId}。可在任务队列页面查看执行状态。`
      )

      // 刷新状态和日志
      setTimeout(() => {
        fetchStatus()
        fetchLogs({ silent: true })
      }, 1000)
    } catch (err: any) {
      showError('同步失败', '同步时发生未知错误')
    } finally {
      setSyncing(false)
    }
  }

  const getStatusBadge = (logStatus: string) => {
    const configs = {
      success: { label: '成功', variant: 'default' as const, icon: CheckCircle2, className: 'bg-green-600 hover:bg-green-700' },
      failed: { label: '失败', variant: 'destructive' as const, icon: XCircle, className: '' },
      running: { label: '运行中', variant: 'secondary' as const, icon: Activity, className: 'bg-blue-100 text-blue-800' },
    }
    const config = configs[logStatus as keyof typeof configs] || { label: logStatus, variant: 'outline' as const, icon: AlertCircle, className: '' }
    const Icon = config.icon

    return (
      <Badge variant={config.variant} className={`flex items-center gap-1 w-fit ${config.className}`}>
        <Icon className="w-3 h-3" />
        {config.label}
      </Badge>
    )
  }

  const getSyncTypeBadge = (type: string) => {
    const isManual = type === 'manual'
    return (
      <Badge variant={isManual ? 'outline' : 'secondary'}>
        {isManual ? '手动' : '自动'}
      </Badge>
    )
  }

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`
    return `${(ms / 60000).toFixed(2)}min`
  }

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold text-gray-900">数据同步管理</h1>
              {status?.isRunning && (
                <Badge variant="secondary" className="flex items-center gap-1">
                  <Activity className="w-3 h-3 animate-pulse" />
                  同步中
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push('/sync/settings')}
              >
                <Settings className="w-4 h-4 mr-1" />
                设置
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAutoRefresh(!autoRefresh)}
              >
                <RefreshCw className={`w-4 h-4 mr-1 ${autoRefresh ? 'animate-spin' : ''}`} />
                {autoRefresh ? '自动刷新' : '手动刷新'}
              </Button>
              <Button
                onClick={handleSync}
                disabled={syncing || status?.isRunning}
                className="flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? '同步中...' : '手动同步'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* 当前状态卡片 */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">当前状态</h2>

            {status ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-gray-600">运行状态</p>
                  <div className="mt-2">
                    {status.isRunning ? (
                      <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                        <Activity className="w-3 h-3 animate-pulse" />
                        运行中
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="flex items-center gap-1 w-fit">
                        <Clock className="w-3 h-3" />
                        空闲
                      </Badge>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-sm text-gray-600">最后同步时间</p>
                  <p className="text-lg font-bold text-gray-900 mt-1">
                    {status.lastSyncAt ? formatDateTime(status.lastSyncAt) : '从未同步'}
                  </p>
                </div>

                <div>
                  <p className="text-sm text-gray-600">上次同步记录数</p>
                  <p className="text-lg font-bold text-gray-900 mt-1">
                    {(status.lastSyncRecordCount ?? 0).toLocaleString()} 条
                  </p>
                </div>

                <div>
                  <p className="text-sm text-gray-600">上次同步耗时</p>
                  <p className="text-lg font-bold text-gray-900 mt-1">
                    {status.lastSyncDuration ? formatDuration(status.lastSyncDuration) : '-'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                <p className="mt-2 text-sm text-gray-600">加载状态...</p>
              </div>
            )}

            {status?.lastSyncError && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <XCircle className="w-5 h-5 text-red-600 mt-0.5" />
                  <div>
                    <p className="font-medium text-red-900">最后同步失败</p>
                    <p className="text-sm text-red-700 mt-1">{status.lastSyncError}</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 同步历史日志 */}
        <Card>
          <CardContent className="pt-6">
            <div className="mb-4 flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">同步历史</h2>
              {logsRefreshing && (
                <span className="inline-flex items-center text-xs text-gray-500">
                  <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" />
                  后台更新中
                </span>
              )}
            </div>

            {loading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                <p className="mt-2 text-sm text-gray-600">加载日志...</p>
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>暂无同步历史</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="[&_thead_th]:bg-white">
                  <TableHeader>
                    <TableRow>
                      <TableHead>开始时间</TableHead>
                      <TableHead>类型</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead className="text-right">记录数</TableHead>
                      <TableHead className="text-right">耗时</TableHead>
                      <TableHead>完成时间</TableHead>
                      <TableHead>错误信息</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="font-medium">
                          {formatDateTime(log.startedAt)}
                        </TableCell>
                        <TableCell>
                          {getSyncTypeBadge(log.syncType)}
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(log.status)}
                        </TableCell>
                        <TableCell className="text-right">
                          {(log.recordCount ?? 0).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatDuration(log.durationMs)}
                        </TableCell>
                        <TableCell>
                          {log.completedAt ? formatDateTime(log.completedAt) : '-'}
                        </TableCell>
                        <TableCell>
                          {log.errorMessage ? (
                            <span className="text-red-600 text-sm truncate max-w-xs block" title={log.errorMessage}>
                              {log.errorMessage}
                            </span>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
