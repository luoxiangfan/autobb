'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react'

interface SyncStatusData {
  isRunning: boolean
  lastSyncAt: string | null
  nextSyncAt: string | null
  lastSyncDuration: number | null
  lastSyncRecordCount: number
  lastSyncError: string | null
}

export function SyncStatus() {
  const [status, setStatus] = useState<SyncStatusData | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 获取同步状态
  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/sync/status', {
        credentials: 'include'
      })
      if (!response.ok) {
        throw new Error('获取同步状态失败')
      }
      const result = await response.json()
      setStatus(result.data)
      setError(null)
    } catch (err) {
      console.error('获取同步状态失败:', err)
      setError(err instanceof Error ? err.message : '未知错误')
    }
  }

  // 手动触发同步
  const handleSync = async () => {
    setIsSyncing(true)
    try {
      const response = await fetch('/api/sync/trigger', {
        method: 'POST',
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || '同步失败')
      }

      // 立即刷新状态
      await fetchStatus()

      // 2秒后再次刷新以获取最新状态
      setTimeout(fetchStatus, 2000)
    } catch (err) {
      console.error('触发同步失败:', err)
      setError(err instanceof Error ? err.message : '同步失败')
    } finally {
      setIsSyncing(false)
    }
  }

  // 定期轮询同步状态（每30秒）
  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 30000)
    return () => clearInterval(interval)
  }, [])

  // 格式化时间显示
  const formatTime = (isoString: string | null): string => {
    if (!isoString) return '从未同步'

    const date = new Date(isoString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return '刚刚'
    if (diffMins < 60) return `${diffMins}分钟前`
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}小时前`
    return `${Math.floor(diffMins / 1440)}天前`
  }

  if (error && !status) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-600">
        <XCircle className="h-4 w-4" />
        <span>同步状态获取失败</span>
      </div>
    )
  }

  if (!status) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>加载中...</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      {/* 同步状态指示器 */}
      <div className="flex items-center gap-2 text-sm">
        {status.isRunning ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <span className="text-blue-600">同步中...</span>
          </>
        ) : status.lastSyncError ? (
          <>
            <XCircle className="h-4 w-4 text-red-600" />
            <span className="text-red-600">同步失败</span>
          </>
        ) : status.lastSyncAt ? (
          <>
            <CheckCircle className="h-4 w-4 text-green-600" />
            <span className="text-gray-700">
              最后同步: {formatTime(status.lastSyncAt)}
            </span>
          </>
        ) : (
          <>
            <Clock className="h-4 w-4 text-gray-400" />
            <span className="text-gray-500">从未同步</span>
          </>
        )}

        {/* 同步记录数 */}
        {status.lastSyncRecordCount > 0 && !status.isRunning && (
          <span className="text-xs text-gray-500">
            ({status.lastSyncRecordCount} 条记录)
          </span>
        )}
      </div>

      {/* 手动刷新按钮 */}
      <button
        onClick={handleSync}
        disabled={isSyncing || status.isRunning}
        className="flex items-center gap-1 px-2 py-1 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        title="手动同步数据"
      >
        <RefreshCw
          className={`h-4 w-4 ${isSyncing || status.isRunning ? 'animate-spin' : ''}`}
        />
        <span>刷新</span>
      </button>

      {/* 错误提示 */}
      {status.lastSyncError && !status.isRunning && (
        <div className="text-xs text-red-600 max-w-xs truncate" title={status.lastSyncError}>
          错误: {status.lastSyncError}
        </div>
      )}
    </div>
  )
}
