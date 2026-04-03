'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { showSuccess, showError } from '@/lib/toast-utils'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Settings, Save, RefreshCw, Bell, Clock, AlertTriangle } from 'lucide-react'

/**
 * 🔧 修复(2025-12-11): 统一使用 camelCase 与 API 响应匹配
 */
interface SyncConfig {
  id: number
  userId: number
  autoSyncEnabled: boolean
  syncIntervalHours: number
  maxRetryAttempts: number
  retryDelayMinutes: number
  notifyOnSuccess: boolean
  notifyOnFailure: boolean
  notificationEmail: string | null
  lastAutoSyncAt: string | null
  nextScheduledSyncAt: string | null
  consecutiveFailures: number
  createdAt: string
  updatedAt: string
}

interface SchedulerStatus {
  isRunning: boolean
  checkIntervalMs: number
  enabled: boolean
}

export default function SyncSettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState<SyncConfig | null>(null)
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null)

  // Form state
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false)
  const [syncInterval, setSyncInterval] = useState(4)
  const [maxRetries, setMaxRetries] = useState(3)
  const [retryDelay, setRetryDelay] = useState(15)
  const [notifySuccess, setNotifySuccess] = useState(false)
  const [notifyFailure, setNotifyFailure] = useState(true)
  const [notificationEmail, setNotificationEmail] = useState('')

  useEffect(() => {
    fetchConfig()
    fetchSchedulerStatus()
  }, [])

  const fetchConfig = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/sync/config', {
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('获取配置失败')
      }

      const data = await response.json()
      setConfig(data.config)

      // Initialize form state - 🔧 修复: 使用 camelCase 字段名
      setAutoSyncEnabled(data.config.autoSyncEnabled)
      setSyncInterval(data.config.syncIntervalHours)
      setMaxRetries(data.config.maxRetryAttempts)
      setRetryDelay(data.config.retryDelayMinutes)
      setNotifySuccess(data.config.notifyOnSuccess)
      setNotifyFailure(data.config.notifyOnFailure)
      setNotificationEmail(data.config.notificationEmail || '')
    } catch (err: any) {
      showError('加载失败', err.message || '无法加载同步配置')
    } finally {
      setLoading(false)
    }
  }

  const fetchSchedulerStatus = async () => {
    try {
      const response = await fetch('/api/sync/scheduler', {
        credentials: 'include',
      })

      if (response.ok) {
        const data = await response.json()
        setSchedulerStatus(data.status)
      }
    } catch (err) {
      console.error('Failed to fetch scheduler status:', err)
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)

      const response = await fetch('/api/sync/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        // 🔧 修复(2025-12-11): PUT 请求体使用 camelCase
        body: JSON.stringify({
          autoSyncEnabled: autoSyncEnabled,
          syncIntervalHours: syncInterval,
          maxRetryAttempts: maxRetries,
          retryDelayMinutes: retryDelay,
          notifyOnSuccess: notifySuccess,
          notifyOnFailure: notifyFailure,
          notificationEmail: notificationEmail || null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '保存配置失败')
      }

      const data = await response.json()
      setConfig(data.config)
      showSuccess('保存成功', '同步配置已更新')

      // Refresh scheduler status if auto sync was toggled
      await fetchSchedulerStatus()
    } catch (err: any) {
      showError('保存失败', err.message || '无法保存同步配置')
    } finally {
      setSaving(false)
    }
  }

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return '从未'
    return new Date(dateStr).toLocaleString('zh-CN')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  if (!config) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">加载配置失败</p>
          <button
            onClick={() => router.push('/sync')}
            className="mt-4 text-indigo-600 hover:text-indigo-500"
          >
            返回同步管理
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <button
                onClick={() => router.push('/sync')}
                className="text-indigo-600 hover:text-indigo-500 mr-4"
              >
                ← 返回同步管理
              </button>
              <Settings className="h-6 w-6 text-gray-700 mr-2" />
              <h1 className="text-xl font-bold text-gray-900">自动同步设置</h1>
            </div>
            <div className="flex items-center">
              <Button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2"
              >
                <Save className="h-4 w-4" />
                {saving ? '保存中...' : '保存设置'}
              </Button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0 space-y-6">
          {/* Status Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                当前状态
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">自动同步</p>
                  <p className="text-lg font-semibold">
                    {config.autoSyncEnabled ? (
                      <span className="text-green-600">已启用</span>
                    ) : (
                      <span className="text-gray-500">已禁用</span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">调度器状态</p>
                  <p className="text-lg font-semibold">
                    {schedulerStatus?.isRunning ? (
                      <span className="text-green-600">运行中</span>
                    ) : (
                      <span className="text-gray-500">已停止</span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">上次自动同步</p>
                  <p className="text-sm font-medium">
                    {formatDateTime(config.lastAutoSyncAt)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">下次计划同步</p>
                  <p className="text-sm font-medium">
                    {formatDateTime(config.nextScheduledSyncAt)}
                  </p>
                </div>
              </div>

              {config.consecutiveFailures > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-yellow-600" />
                    <p className="text-yellow-800 font-medium">
                      连续失败 {config.consecutiveFailures} 次
                    </p>
                  </div>
                  <p className="text-yellow-600 text-sm mt-1">
                    达到最大重试次数后，自动同步将被暂停
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Auto Sync Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                自动同步配置
              </CardTitle>
              <CardDescription>配置后台自动同步的行为</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Enable Auto Sync */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="auto-sync">启用自动同步</Label>
                  <p className="text-sm text-gray-500">
                    后台自动同步Google Ads性能数据
                  </p>
                </div>
                <Switch
                  id="auto-sync"
                  checked={autoSyncEnabled}
                  onCheckedChange={setAutoSyncEnabled}
                />
              </div>

              {/* Sync Interval */}
              <div className="space-y-2">
                <Label htmlFor="sync-interval">同步间隔</Label>
                <Select
                  value={syncInterval.toString()}
                  onValueChange={(value) => setSyncInterval(parseInt(value))}
                >
                  <SelectTrigger id="sync-interval">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">每1小时</SelectItem>
                    <SelectItem value="3">每3小时</SelectItem>
                    <SelectItem value="4">每4小时（默认）</SelectItem>
                    <SelectItem value="6">每6小时</SelectItem>
                    <SelectItem value="12">每12小时</SelectItem>
                    <SelectItem value="24">每24小时</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-gray-500">数据同步的频率（默认每4小时）</p>
              </div>

              {/* Max Retry Attempts */}
              <div className="space-y-2">
                <Label htmlFor="max-retries">最大重试次数</Label>
                <Input
                  id="max-retries"
                  type="number"
                  min="0"
                  max="10"
                  value={maxRetries}
                  onChange={(e) => setMaxRetries(parseInt(e.target.value) || 0)}
                />
                <p className="text-sm text-gray-500">
                  同步失败后的重试次数，0表示不重试
                </p>
              </div>

              {/* Retry Delay */}
              <div className="space-y-2">
                <Label htmlFor="retry-delay">重试延迟（分钟）</Label>
                <Input
                  id="retry-delay"
                  type="number"
                  min="5"
                  max="120"
                  value={retryDelay}
                  onChange={(e) => setRetryDelay(parseInt(e.target.value) || 15)}
                />
                <p className="text-sm text-gray-500">
                  失败后等待多久再重试，范围: 5-120分钟
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Notification Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                通知设置
              </CardTitle>
              <CardDescription>配置同步结果通知（未来功能）</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Notify on Success */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="notify-success">成功时通知</Label>
                  <p className="text-sm text-gray-500">
                    同步成功时发送通知
                  </p>
                </div>
                <Switch
                  id="notify-success"
                  checked={notifySuccess}
                  onCheckedChange={setNotifySuccess}
                />
              </div>

              {/* Notify on Failure */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="notify-failure">失败时通知</Label>
                  <p className="text-sm text-gray-500">
                    同步失败时发送通知（推荐）
                  </p>
                </div>
                <Switch
                  id="notify-failure"
                  checked={notifyFailure}
                  onCheckedChange={setNotifyFailure}
                />
              </div>

              {/* Notification Email */}
              <div className="space-y-2">
                <Label htmlFor="notification-email">通知邮箱</Label>
                <Input
                  id="notification-email"
                  type="email"
                  placeholder="your.email@example.com"
                  value={notificationEmail}
                  onChange={(e) => setNotificationEmail(e.target.value)}
                />
                <p className="text-sm text-gray-500">
                  接收同步通知的邮箱地址（功能开发中）
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Info Card */}
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <svg
                  className="w-5 h-5 text-blue-500 mt-0.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                  />
                </svg>
                <div>
                  <p className="text-blue-800 font-medium">提示</p>
                  <ul className="text-blue-600 text-sm mt-2 space-y-1 list-disc list-inside">
                    <li>自动同步仅在生产环境运行</li>
                    <li>建议设置合理的同步间隔以避免API限流</li>
                    <li>启用失败通知可及时发现问题</li>
                    <li>连续失败达到最大重试次数后，需手动重启自动同步</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
