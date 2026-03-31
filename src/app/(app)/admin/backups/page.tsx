'use client'

import { useState, useEffect } from 'react'
import { showSuccess, showError, showConfirm } from '@/lib/toast-utils'

/**
 * 🔧 修复(2025-12-11): 统一使用 camelCase 字段名
 */
interface Backup {
  id: number
  backupFilename: string
  backupPath: string
  fileSizeBytes: number
  status: string
  errorMessage: string | null
  backupType: string
  createdAt: string
  taskType: string
}

/**
 * 🔧 修复(2025-12-11): 统一使用 camelCase 字段名
 */
interface SyncLog {
  id: number
  userId: number
  googleAdsAccountId: number
  syncType: string
  status: string
  recordCount: number
  durationMs: number
  errorMessage: string | null
  startedAt: string
  completedAt: string | null
  username: string | null
  customerId: string | null
  taskType: string
}

interface ScheduledTask {
  name: string
  description: string
  schedule: string
  enabled: boolean
}

interface Stats {
  backup: {
    total: number
    success: number
    failed: number
    totalSizeBytes: number
    lastRun: string | null
  }
  sync: {
    total: number
    success: number
    failed: number
    totalRecords: number
    avgDuration: number
    lastRun: string | null
  }
}

type TabType = 'overview' | 'backup' | 'sync' | 'cleanup'

export default function AdminScheduledTasksPage() {
  const [activeTab, setActiveTab] = useState<TabType>('overview')
  const [backups, setBackups] = useState<Backup[]>([])
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [backupLoading, setBackupLoading] = useState(false)

  // 🔧 数据清理相关state
  const [cleanupStats, setCleanupStats] = useState<any>(null)
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [cleanupResult, setCleanupResult] = useState<{
    success: boolean
    message: string
    details?: {
      scraped_products: number
      ad_creatives: number
      google_ads_accounts: number
      total: number
    }
  } | null>(null)

  // 加载定时任务数据
  const loadData = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/admin/scheduled-tasks?limit=50', {
        credentials: 'include',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '加载失败')
      }

      setBackups(data.data.backups)
      setSyncLogs(data.data.syncLogs)
      setStats(data.data.stats)
      setScheduledTasks(data.data.scheduledTasks)
    } catch (err: any) {
      setError(err.message || '加载数据失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // 手动触发备份
  const triggerManualBackup = async () => {
    const confirmed = await showConfirm(
      '确认备份',
      '确定要立即备份数据库吗？'
    )

    if (!confirmed) {
      return
    }

    try {
      setBackupLoading(true)
      const response = await fetch('/api/admin/backups/manual', {
        method: 'POST',
        credentials: 'include',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '备份失败')
      }

      showSuccess('备份成功', '数据库已成功备份')
      loadData()
    } catch (err: any) {
      showError('备份失败', err.message || '请稍后重试')
    } finally {
      setBackupLoading(false)
    }
  }

  // 格式化文件大小
  const formatFileSize = (bytes: number) => {
    if (!bytes || bytes === 0) return '-'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  // 格式化日期时间
  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return '-'
    const date = new Date(dateStr)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  // 格式化持续时间
  const formatDuration = (ms: number) => {
    if (!ms) return '-'
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60000).toFixed(1)}min`
  }

  // 渲染状态徽章
  const renderStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      success: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
      running: 'bg-yellow-100 text-yellow-800',
    }
    const labels: Record<string, string> = {
      success: '成功',
      failed: '失败',
      running: '进行中',
    }
    return (
      <span className={`px-2 py-1 text-xs rounded ${styles[status] || 'bg-gray-100 text-gray-800'}`}>
        {labels[status] || status}
      </span>
    )
  }

  // 加载清理统计信息
  const loadCleanupStats = async () => {
    try {
      setCleanupLoading(true)
      const response = await fetch('/api/admin/cleanup', {
        credentials: 'include',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '获取统计失败')
      }

      setCleanupStats(data)
    } catch (err: any) {
      console.error('获取清理统计失败:', err)
      showError('获取统计失败', err.message || '请稍后重试')
    } finally {
      setCleanupLoading(false)
    }
  }

  // 处理清理操作
  const handleCleanup = async (mode?: 'preview') => {
    try {
      setCleanupLoading(true)
      setCleanupResult(null)

      const url = mode === 'preview' ? '/api/admin/cleanup?mode=preview' : '/api/admin/cleanup'
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tables: ['scraped_products', 'ad_creatives', 'google_ads_accounts'],
          dryRun: mode === 'preview',
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '清理失败')
      }

      const success = mode === 'preview'
        ? data.summary.totalRecordsToDelete > 0
        : data.summary.totalRecordsDeleted > 0

      setCleanupResult({
        success,
        message: data.message,
        details: {
          scraped_products: data.summary.results?.scraped_products?.count || 0,
          ad_creatives: data.summary.results?.ad_creatives?.count || 0,
          google_ads_accounts: data.summary.results?.google_ads_accounts?.count || 0,
          total: success ? data.summary.totalRecordsToDelete : data.summary.totalRecordsDeleted,
        },
      })

      if (mode === 'preview') {
        showSuccess('预览完成', `可清理 ${data.summary.totalRecordsToDelete} 条记录`)
      } else {
        showSuccess('清理完成', `已清理 ${data.summary.totalRecordsDeleted} 条记录`)
      }

      // 刷新统计
      await loadCleanupStats()
    } catch (err: any) {
      console.error('清理失败:', err)
      setCleanupResult({ success: false, message: err.message || '清理失败' })
      showError('清理失败', err.message || '请稍后重试')
    } finally {
      setCleanupLoading(false)
    }
  }

  // Tab组件
  const tabs: { id: TabType; label: string }[] = [
    { id: 'overview', label: '概览' },
    { id: 'backup', label: '数据库备份' },
    { id: 'sync', label: '数据同步' },
    { id: 'cleanup', label: '数据清理' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* 标题栏 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">备份与定时任务</h1>
          <p className="mt-2 text-sm text-gray-600">
            查看和管理系统定时任务执行历史
          </p>
        </div>

        {/* Tab切换 */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-500 border-t-transparent"></div>
            <p className="mt-2 text-gray-600">加载中...</p>
          </div>
        ) : (
          <>
            {/* 概览Tab */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* 定时任务配置 */}
                <div className="bg-white rounded-lg shadow p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">定时任务配置</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {scheduledTasks.map((task, index) => (
                      <div key={index} className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="font-medium text-gray-900">{task.name}</h3>
                          <span className={`px-2 py-1 text-xs rounded ${
                            task.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                          }`}>
                            {task.enabled ? '已启用' : '已禁用'}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mb-2">{task.description}</p>
                        <p className="text-xs text-gray-500">
                          <span className="font-medium">执行时间：</span>{task.schedule}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 统计卡片 */}
                {stats && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* 备份统计 */}
                    <div className="bg-white rounded-lg shadow p-6">
                      <h2 className="text-lg font-semibold text-gray-900 mb-4">数据库备份统计</h2>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-sm text-gray-500">总备份数</div>
                          <div className="text-2xl font-bold text-gray-900">{stats.backup.total}</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500">成功率</div>
                          <div className="text-2xl font-bold text-green-600">
                            {stats.backup.total > 0
                              ? `${((stats.backup.success / stats.backup.total) * 100).toFixed(1)}%`
                              : '-'}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500">总备份大小</div>
                          <div className="text-2xl font-bold text-indigo-600">
                            {formatFileSize(stats.backup.totalSizeBytes)}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500">最后执行</div>
                          <div className="text-sm font-medium text-gray-900">
                            {formatDateTime(stats.backup.lastRun)}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 同步统计 */}
                    <div className="bg-white rounded-lg shadow p-6">
                      <h2 className="text-lg font-semibold text-gray-900 mb-4">数据同步统计</h2>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-sm text-gray-500">总同步次数</div>
                          <div className="text-2xl font-bold text-gray-900">{stats.sync.total}</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500">成功率</div>
                          <div className="text-2xl font-bold text-green-600">
                            {stats.sync.total > 0
                              ? `${((stats.sync.success / stats.sync.total) * 100).toFixed(1)}%`
                              : '-'}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500">总同步记录</div>
                          <div className="text-2xl font-bold text-indigo-600">
                            {(stats.sync?.totalRecords ?? 0).toLocaleString()}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500">平均耗时</div>
                          <div className="text-2xl font-bold text-orange-600">
                            {formatDuration(stats.sync.avgDuration)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 最近任务执行 */}
                <div className="bg-white rounded-lg shadow p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">最近执行记录</h2>
                  <div className="space-y-3">
                    {/* 合并备份和同步日志，按时间排序 */}
                    {[...backups.slice(0, 5), ...syncLogs.slice(0, 5)]
                      .sort((a, b) => {
                        const dateA = new Date('createdAt' in a ? a.createdAt : a.startedAt)
                        const dateB = new Date('createdAt' in b ? b.createdAt : b.startedAt)
                        return dateB.getTime() - dateA.getTime()
                      })
                      .slice(0, 10)
                      .map((item, index) => (
                        <div key={`${item.taskType}-${item.id}`} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                          <div className="flex items-center space-x-4">
                            <span className={`px-2 py-1 text-xs rounded ${
                              item.taskType === 'backup' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'
                            }`}>
                              {item.taskType === 'backup' ? '备份' : '同步'}
                            </span>
                            <div>
                              <p className="text-sm font-medium text-gray-900">
                                {item.taskType === 'backup'
                                  ? (item as Backup).backupFilename || '数据库备份'
                                  : `用户 ${(item as SyncLog).username || (item as SyncLog).userId} - ${(item as SyncLog).recordCount} 条记录`}
                              </p>
                              <p className="text-xs text-gray-500">
                                {'createdAt' in item ? formatDateTime(item.createdAt) : formatDateTime((item as SyncLog).startedAt)}
                              </p>
                            </div>
                          </div>
                          {renderStatusBadge(item.status)}
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}

            {/* 备份Tab */}
            {activeTab === 'backup' && (
              <div className="space-y-6">
                {/* 统计卡片 */}
                {stats && (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="bg-white rounded-lg shadow p-6">
                      <div className="text-sm text-gray-500">总备份数</div>
                      <div className="mt-2 text-3xl font-bold text-gray-900">{stats.backup.total}</div>
                    </div>
                    <div className="bg-white rounded-lg shadow p-6">
                      <div className="text-sm text-gray-500">成功备份</div>
                      <div className="mt-2 text-3xl font-bold text-green-600">{stats.backup.success}</div>
                    </div>
                    <div className="bg-white rounded-lg shadow p-6">
                      <div className="text-sm text-gray-500">失败备份</div>
                      <div className="mt-2 text-3xl font-bold text-red-600">{stats.backup.failed}</div>
                    </div>
                    <div className="bg-white rounded-lg shadow p-6">
                      <div className="text-sm text-gray-500">总备份大小</div>
                      <div className="mt-2 text-3xl font-bold text-indigo-600">
                        {formatFileSize(stats.backup.totalSizeBytes)}
                      </div>
                    </div>
                  </div>
                )}

                {/* 操作栏 */}
                <div>
                  <button
                    onClick={triggerManualBackup}
                    disabled={backupLoading}
                    className="px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {backupLoading ? '备份中...' : '立即备份'}
                  </button>
                </div>

                {/* 备份列表 */}
                {backups.length === 0 ? (
                  <div className="text-center py-12 bg-white rounded-lg shadow">
                    <p className="text-gray-500">暂无备份记录</p>
                  </div>
                ) : (
                  <div className="bg-white shadow overflow-hidden rounded-lg">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            备份文件
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            类型
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            文件大小
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            状态
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            备份时间
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {backups.map((backup) => (
                          <tr key={backup.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4">
                              <div className="text-sm font-medium text-gray-900">
                                {backup.backupFilename || 'N/A'}
                              </div>
                              {backup.errorMessage && (
                                <div className="text-xs text-red-600 mt-1">
                                  错误: {backup.errorMessage}
                                </div>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              <span className={`px-2 py-1 text-xs rounded ${
                                backup.backupType === 'manual'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-gray-100 text-gray-800'
                              }`}>
                                {backup.backupType === 'manual' ? '手动' : '自动'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-900">
                              {backup.status === 'success' ? formatFileSize(backup.fileSizeBytes) : 'N/A'}
                            </td>
                            <td className="px-6 py-4">
                              {renderStatusBadge(backup.status)}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-900">
                              {formatDateTime(backup.createdAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 说明信息 */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                  <h3 className="text-sm font-medium text-blue-900 mb-3">备份说明</h3>
                  <ul className="text-sm text-blue-700 space-y-2">
                    <li>• 系统每天凌晨2点自动执行备份</li>
                    <li>• 备份文件保留最近7天，超过7天的备份会自动清理</li>
                    <li>• 您也可以随时点击"立即备份"按钮进行手动备份</li>
                    <li>• 备份文件存储在 data/backups/ 目录下</li>
                  </ul>
                </div>
              </div>
            )}

            {/* 同步Tab */}
            {activeTab === 'sync' && (
              <div className="space-y-6">
                {/* 统计卡片 */}
                {stats && (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="bg-white rounded-lg shadow p-6">
                      <div className="text-sm text-gray-500">总同步次数</div>
                      <div className="mt-2 text-3xl font-bold text-gray-900">{stats.sync.total}</div>
                    </div>
                    <div className="bg-white rounded-lg shadow p-6">
                      <div className="text-sm text-gray-500">成功同步</div>
                      <div className="mt-2 text-3xl font-bold text-green-600">{stats.sync.success}</div>
                    </div>
                    <div className="bg-white rounded-lg shadow p-6">
                      <div className="text-sm text-gray-500">失败同步</div>
                      <div className="mt-2 text-3xl font-bold text-red-600">{stats.sync.failed}</div>
                    </div>
                    <div className="bg-white rounded-lg shadow p-6">
                      <div className="text-sm text-gray-500">平均耗时</div>
                      <div className="mt-2 text-3xl font-bold text-orange-600">
                        {formatDuration(stats.sync.avgDuration)}
                      </div>
                    </div>
                  </div>
                )}

                {/* 同步列表 */}
                {syncLogs.length === 0 ? (
                  <div className="text-center py-12 bg-white rounded-lg shadow">
                    <p className="text-gray-500">暂无同步记录</p>
                  </div>
                ) : (
                  <div className="bg-white shadow overflow-hidden rounded-lg">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            用户
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            账户ID
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            类型
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            记录数
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            耗时
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            状态
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            开始时间
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {syncLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4">
                              <div className="text-sm font-medium text-gray-900">
                                {log.username || `用户#${log.userId}`}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-900">
                              {log.customerId || '-'}
                            </td>
                            <td className="px-6 py-4">
                              <span className={`px-2 py-1 text-xs rounded ${
                                log.syncType === 'manual'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-gray-100 text-gray-800'
                              }`}>
                                {log.syncType === 'manual' ? '手动' : '自动'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-900">
                              {(log.recordCount ?? 0).toLocaleString()}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-900">
                              {formatDuration(log.durationMs)}
                            </td>
                            <td className="px-6 py-4">
                              {renderStatusBadge(log.status)}
                              {log.errorMessage && (
                                <div className="text-xs text-red-600 mt-1 max-w-xs truncate" title={log.errorMessage}>
                                  {log.errorMessage}
                                </div>
                              )}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-900">
                              {formatDateTime(log.startedAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 说明信息 */}
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-6">
                  <h3 className="text-sm font-medium text-purple-900 mb-3">数据同步说明</h3>
                  <ul className="text-sm text-purple-700 space-y-2">
                    <li>• 同步会拉取最近7天的广告性能数据（展示、点击、转化、花费等）</li>
                    <li>• 在 <a href="/settings" className="underline hover:text-purple-900">系统设置</a> 中可以配置自动同步的间隔时间（建议6-24小时）</li>
                    <li>• 在 Offer 详情页可以手动触发数据同步</li>
                    <li>• 同步日志保留90天，超过90天的日志会自动清理</li>
                    <li>• 同步任务通过队列系统执行，可在 <a href="/admin/queue" className="underline hover:text-purple-900">任务队列</a> 中查看执行状态</li>
                  </ul>
                </div>
              </div>
            )}

            {/* 数据清理Tab */}
            {activeTab === 'cleanup' && (
              <div className="space-y-6">
                {/* 说明卡片 */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                  <h3 className="text-lg font-medium text-blue-900 mb-3">数据清理功能</h3>
                  <p className="text-sm text-blue-700 mb-4">
                    清理系统中已软删除的记录。软删除的数据会保留90天，超过90天后将被永久删除。
                  </p>
                  <ul className="text-sm text-blue-700 space-y-1">
                    <li>• <strong>预览模式</strong>：查看可清理的记录数量，不实际删除</li>
                    <li>• <strong>执行清理</strong>：删除超过90天的软删除记录</li>
                    <li>• <strong>清理范围</strong>：抓取产品、广告创意、Google Ads账户</li>
                  </ul>
                </div>

                {/* 统计卡片 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white rounded-lg shadow p-6">
                    <div className="text-sm text-gray-500">抓取产品 (scraped_products)</div>
                    <div className="text-2xl font-bold text-gray-900">
                      {cleanupStats?.current?.scraped_products?.toLocaleString() || '-'}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      可清理: {cleanupStats?.cleanable?.scraped_products?.toLocaleString() || 0}
                    </div>
                  </div>
                  <div className="bg-white rounded-lg shadow p-6">
                    <div className="text-sm text-gray-500">广告创意 (ad_creatives)</div>
                    <div className="text-2xl font-bold text-gray-900">
                      {cleanupStats?.current?.ad_creatives?.toLocaleString() || '-'}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      可清理: {cleanupStats?.cleanable?.ad_creatives?.toLocaleString() || 0}
                    </div>
                  </div>
                  <div className="bg-white rounded-lg shadow p-6">
                    <div className="text-sm text-gray-500">Google Ads账户</div>
                    <div className="text-2xl font-bold text-gray-900">
                      {cleanupStats?.current?.google_ads_accounts?.toLocaleString() || '-'}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      可清理: {cleanupStats?.cleanable?.google_ads_accounts?.toLocaleString() || 0}
                    </div>
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className="bg-white rounded-lg shadow p-6">
                  <h4 className="text-lg font-semibold text-gray-900 mb-4">清理操作</h4>

                  <div className="flex flex-wrap gap-4">
                    <button
                      onClick={loadCleanupStats}
                      disabled={cleanupLoading}
                      className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                    >
                      {cleanupLoading ? '加载中...' : '刷新统计'}
                    </button>

                    <button
                      onClick={() => handleCleanup('preview')}
                      disabled={cleanupLoading}
                      className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 disabled:opacity-50"
                    >
                      {cleanupLoading ? '计算中...' : '预览清理'}
                    </button>

                    <button
                      onClick={() => handleCleanup()}
                      disabled={cleanupLoading || !cleanupStats?.cleanable?.total}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:bg-gray-400"
                    >
                      {cleanupLoading ? '清理中...' : '执行清理'}
                    </button>
                  </div>

                  {/* 清理结果 */}
                  {cleanupResult && (
                    <div className={`mt-6 p-4 rounded-lg ${
                      cleanupResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
                    }`}>
                      <div className="flex items-center mb-2">
                        {cleanupResult.success ? (
                          <span className="text-green-600 text-lg mr-2">✅</span>
                        ) : (
                          <span className="text-red-600 text-lg mr-2">❌</span>
                        )}
                        <span className={`font-medium ${cleanupResult.success ? 'text-green-800' : 'text-red-800'}`}>
                          {cleanupResult.message}
                        </span>
                      </div>

                      {cleanupResult.details && (
                        <div className="mt-3 text-sm">
                          <div className="font-medium text-gray-700 mb-2">清理详情：</div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <div>
                              <span className="text-gray-500">抓取产品：</span>
                              <span className="font-medium">{cleanupResult.details.scraped_products}</span>
                            </div>
                            <div>
                              <span className="text-gray-500">广告创意：</span>
                              <span className="font-medium">{cleanupResult.details.ad_creatives}</span>
                            </div>
                            <div>
                              <span className="text-gray-500">Google账户：</span>
                              <span className="font-medium">{cleanupResult.details.google_ads_accounts}</span>
                            </div>
                            <div>
                              <span className="text-gray-500">总计：</span>
                              <span className="font-medium">{cleanupResult.details.total}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 说明信息 */}
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
                  <h4 className="text-sm font-medium text-yellow-900 mb-2">⚠️ 注意事项</h4>
                  <ul className="text-sm text-yellow-700 space-y-1">
                    <li>• 清理操作不可逆，请在执行前确认预览结果</li>
                    <li>• 建议先使用「预览清理」查看可清理的记录数量</li>
                    <li>• 清理后数据将无法恢复</li>
                    <li>• 系统会自动保留最近90天的软删除数据</li>
                  </ul>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
