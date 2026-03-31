'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Activity, Users, Clock, CheckCircle, XCircle, RefreshCw, Settings, Save, AlertCircle, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, ArrowUp, ArrowUpDown, ArrowDown, Cpu, HardDrive, Network } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import { fetchWithRetry } from '@/lib/api-error-handler'

interface QueueStats {
  global: {
    running: number
    coreRunning?: number
    backgroundRunning?: number
    queued: number
    queuedEligible?: number
    queuedDelayed?: number
    nextQueuedAt?: number
    completed: number
    failed: number
  }
  perUser: Array<{
    userId: number
    username: string
    email?: string
    packageType?: string
    running: number
    coreRunning?: number
    backgroundRunning?: number
    runningByType?: Record<string, number>
    queued: number
    completed: number
    failed: number
    coreCompleted?: number
    backgroundCompleted?: number
    coreFailed?: number
    backgroundFailed?: number
  }>
  config: {
    globalConcurrency: number
    perUserConcurrency: number
    perTypeConcurrency?: PerTypeConcurrency  // 新增：类型并发配置
    maxQueueSize: number
    taskTimeout: number
    enablePriority: boolean
  }
  // 新增字段 (New Unified Queue Feature)
  byType?: Record<string, number>
  byTypeRunning?: Record<string, number>
}

// 任务类型并发配置
interface PerTypeConcurrency {
  scrape: number
  'ai-analysis': number
  sync: number
  backup: number
  email: number
  export: number
  'link-check': number
  cleanup: number
  'offer-extraction': number
  'batch-offer-creation': number
  'ad-creative': number
  'campaign-publish': number  // 🆕 广告系列发布
  'click-farm': number         // 🆕 补点击任务
  'url-swap': number           // 🆕 换链接任务
  'openclaw-strategy': number // 🆕 OpenClaw 策略任务
  'affiliate-product-sync': number // 🆕 联盟商品同步任务
  'openclaw-command': number // 🆕 OpenClaw 指令执行任务
  'openclaw-affiliate-sync': number // 🆕 OpenClaw 联盟佣金快照同步任务
  'openclaw-report-send': number // 🆕 OpenClaw 报表投递任务
  [key: string]: number  // 允许其他自定义类型
}

// 任务类型中文名称映射
const TASK_TYPE_LABELS: Record<string, string> = {
  'scrape': '网页抓取',
  'ai-analysis': 'AI分析',
  'sync': '数据同步',
  'backup': '数据备份',
  'email': '邮件发送',
  'export': '数据导出',
  'link-check': '链接检查',
  'cleanup': '清理任务',
  'offer-extraction': 'Offer提取',
  'batch-offer-creation': '批量创建',
  'ad-creative': '广告创意生成',
  'campaign-publish': '广告系列发布',
  'click-farm': '补点击任务',  // 🆕 补点击任务
  'url-swap': '换链接任务',    // 🆕 换链接任务
  'openclaw-strategy': 'OpenClaw策略', // 🆕 OpenClaw 策略任务
  'affiliate-product-sync': '商品同步', // 🆕 联盟商品同步任务
  'openclaw-command': 'OpenClaw指令', // 🆕 OpenClaw 指令执行任务
  'openclaw-affiliate-sync': '联盟佣金同步', // 🆕 OpenClaw 联盟佣金快照同步任务
  'openclaw-report-send': '报表投递', // 🆕 OpenClaw 报表投递任务
}

const PACKAGE_TYPE_LABELS: Record<string, string> = {
  trial: '试用版',
  annual: '年卡',
  lifetime: '长期会员',
  enterprise: '私有化部署',
}

const PACKAGE_TYPE_SORT_ORDER: Record<string, number> = {
  trial: 0,
  annual: 1,
  lifetime: 2,
  enterprise: 3,
}

interface QueueConfig {
  globalConcurrency: number
  perUserConcurrency: number
  perTypeConcurrency: PerTypeConcurrency  // 新增：类型并发配置
  maxQueueSize: number
  taskTimeout: number
  enablePriority: boolean
  // 新增字段 (New Unified Queue Feature)
  defaultMaxRetries?: number
  retryDelay?: number
  storageType?: 'redis' | 'memory'
}

interface UserQueuePagination {
  total: number
  page: number
  limit: number
  totalPages: number
}

interface HostMetricsSnapshot {
  timestamp: string
  intervalSec: number | null
  available: boolean
  source: 'cgroup-v2' | 'fallback' | 'unavailable'
  cpu: {
    usagePct: number | null
    throttledPct: number | null
    quotaCores: number | null
  }
  memory: {
    usedBytes: number | null
    limitBytes: number | null
    usagePct: number | null
  }
  diskIo: {
    readBps: number | null
    writeBps: number | null
    readOpsPerSec: number | null
    writeOpsPerSec: number | null
  }
  network: {
    rxBps: number | null
    txBps: number | null
  }
}

interface HostMetricsHistoryPoint {
  timestamp: string
  cpuUsagePct: number | null
  cpuThrottledPct: number | null
  memUsagePct: number | null
  diskReadBps: number | null
  diskWriteBps: number | null
  netRxBps: number | null
  netTxBps: number | null
}

interface HostMetricsPayload {
  snapshot: HostMetricsSnapshot
  history: HostMetricsHistoryPoint[]
  windowSec: number
  sampleIntervalSec: number
}

interface SchedulerStatus {
  clickFarmScheduler: {
    status: 'healthy' | 'warning' | 'error'
    message: string
    metrics: {
      enabledTasks: number
      recentQueuedTasks: number
      runningTasks?: number
      lastQueuedAt: string | null
      checkInterval: string
      schedulerProcess: string
    }
  }
  urlSwapScheduler: {
    status: 'healthy' | 'warning' | 'error'
    message: string
    metrics: {
      enabledTasks: number
      overdueTasks: number
      recentQueuedTasks: number
      runningTasks?: number
      lastQueuedAt: string | null
      checkInterval: string
      schedulerProcess: string
    }
  }
  dataSyncScheduler: {
    status: 'healthy' | 'warning' | 'error'
    message: string
    metrics: {
      enabledUsers: number
      recentQueuedTasks: number
      runningTasks?: number
      lastQueuedAt: string | null
      checkInterval: string
      schedulerProcess: string
    }
  }
  affiliateSyncScheduler: {
    status: 'healthy' | 'warning' | 'error'
    message: string
    metrics: {
      enabledUsers: number
      recentQueuedTasks: number
      runningTasks?: number
      lastQueuedAt: string | null
      checkInterval: string
      schedulerProcess: string
    }
  }
  zombieCleanupScheduler: {
    status: 'healthy' | 'warning' | 'error'
    message: string
    metrics: {
      potentialZombieTasks: number
      recentFixedTasks: number
      checkInterval: string
      schedulerProcess: string
    }
  }
  openclawStrategyScheduler: {
    status: 'healthy' | 'warning' | 'error'
    message: string
    metrics: {
      enabledUsers: number
      recentQueuedTasks: number
      runningTasks?: number
      lastQueuedAt: string | null
      checkInterval: string
      schedulerProcess: string
    }
  }
  note?: string
}

const formatPct = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  return `${value.toFixed(1)}%`
}

const formatBytes = (bytes: number | null | undefined) => {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

const formatBps = (bps: number | null | undefined) => {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return '-'
  return `${formatBytes(bps)}/s`
}

const formatDateTime = (tsMs: number | null | undefined) => {
  if (tsMs === null || tsMs === undefined || !Number.isFinite(tsMs)) return '-'
  return new Date(tsMs).toLocaleString('zh-CN')
}

function Sparkline({
  series,
  height = 28,
  width = 120,
  fixedDomain,
}: {
  series: Array<{ values: Array<number | null | undefined>, color: string }>
  height?: number
  width?: number
  fixedDomain?: { min: number; max: number }
}) {
  const allValues: number[] = []
  for (const s of series) {
    for (const v of s.values) {
      if (v === null || v === undefined) continue
      if (!Number.isFinite(v)) continue
      allValues.push(v)
    }
  }
  const n = Math.max(...series.map(s => s.values.length), 0)
  if (n < 2 || allValues.length === 0) {
    return (
      <div className="h-7 w-[120px] bg-gray-100 rounded" />
    )
  }

  const domainMin = fixedDomain?.min ?? Math.min(...allValues)
  const domainMax = fixedDomain?.max ?? Math.max(...allValues)
  const min = Number.isFinite(domainMin) ? domainMin : 0
  const max = Number.isFinite(domainMax) ? domainMax : min + 1
  const range = max - min || 1

  const pad = 2
  const innerW = width - pad * 2
  const innerH = height - pad * 2

  const xFor = (i: number, len: number) => pad + (len <= 1 ? 0 : (i / (len - 1)) * innerW)
  const yFor = (v: number) => pad + (1 - (v - min) / range) * innerH

  const buildPath = (values: Array<number | null | undefined>) => {
    let d = ''
    let started = false
    for (let i = 0; i < values.length; i++) {
      const v = values[i]
      if (v === null || v === undefined || !Number.isFinite(v)) {
        started = false
        continue
      }
      const x = xFor(i, values.length)
      const y = yFor(v)
      if (!started) {
        d += `M ${x} ${y}`
        started = true
      } else {
        d += ` L ${x} ${y}`
      }
    }
    return d
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block"
    >
      <rect x="0" y="0" width={width} height={height} fill="#F3F4F6" rx="6" />
      {series.map((s, idx) => (
        <path
          key={idx}
          d={buildPath(s.values)}
          fill="none"
          stroke={s.color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.95"
        />
      ))}
    </svg>
  )
}

export default function QueueManagementPage() {
  const [stats, setStats] = useState<QueueStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'monitor' | 'config'>('monitor')

  // 用户队列表格分页状态
  const [userQueuePagination, setUserQueuePagination] = useState<UserQueuePagination>({
    total: 0,
    page: 1,
    limit: 10,
    totalPages: 0
  })

  // 排序状态
  const [sortConfig, setSortConfig] = useState<{
    key: string
    direction: 'asc' | 'desc'
  }>({
    key: 'running',
    direction: 'desc'
  })

  // 配置表单状态
  const [config, setConfig] = useState<QueueConfig>(() => {
    // 根据服务器配置动态设置默认值
    const cpuCores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 4 // 默认4核
    const optimalGlobalConcurrency = Math.min(cpuCores * 2, 16) // CPU核数 × 2，限制最大16
    const optimalPerUserConcurrency = Math.max(2, Math.floor(optimalGlobalConcurrency / 4)) // 全局并发/4，最少2

    return {
      globalConcurrency: optimalGlobalConcurrency,
      perUserConcurrency: optimalPerUserConcurrency,
      perTypeConcurrency: {
        scrape: 3,
        'ai-analysis': 2,
        sync: 1,
        backup: 1,
        email: 3,
        export: 2,
        'link-check': 2,
        cleanup: 1,
        'offer-extraction': 2,
        'batch-offer-creation': 1,
        'ad-creative': 3,
        'campaign-publish': 2,  // 🆕 广告系列发布（Google Ads API限制）
        'click-farm': 50,        // 🆕 补点击任务（默认保守，避免小规格容器资源耗尽；可在管理台调整）
        'url-swap': 3,           // 🆕 换链接任务（定时监测，中等并发）
        'openclaw-strategy': 2, // 🆕 OpenClaw 策略任务
        'affiliate-product-sync': 2, // 🆕 联盟商品同步任务
        'openclaw-command': 3, // 🆕 OpenClaw 指令执行任务
        'openclaw-affiliate-sync': 2, // 🆕 OpenClaw 联盟佣金快照同步任务
        'openclaw-report-send': 2, // 🆕 OpenClaw 报表投递任务
      },
      maxQueueSize: 1000,
      taskTimeout: 900000,
      enablePriority: true,
      defaultMaxRetries: 3,
      retryDelay: 5000,
      storageType: 'redis'
    }
  })
  const configRef = useRef(config)
  useEffect(() => {
    configRef.current = config
  }, [config])
  const [savingConfig, setSavingConfig] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const statsInFlight = useRef(false)

  const [hostMetrics, setHostMetrics] = useState<HostMetricsSnapshot | null>(null)
  const [hostMetricsHistory, setHostMetricsHistory] = useState<HostMetricsHistoryPoint[]>([])
  const [hostMetricsHistoryWindowSec, setHostMetricsHistoryWindowSec] = useState<number>(300)
  const [hostMetricsError, setHostMetricsError] = useState<string | null>(null)
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null)
  const [schedulerLoading, setSchedulerLoading] = useState(false)
  const [schedulerError, setSchedulerError] = useState<string | null>(null)
  const [schedulerCollapsed, setSchedulerCollapsed] = useState(true)
  const hostMetricsInFlight = useRef(false)

  const fetchHostMetrics = async (showSuccessToast = false) => {
    if (hostMetricsInFlight.current) return
    hostMetricsInFlight.current = true
    try {
      setHostMetricsError(null)
      const result = await fetchWithRetry('/api/admin/host-metrics', undefined, {
        maxRetries: 1,
        retryDelay: 1000,
        retryOnErrors: ['SERVICE_UNAVAILABLE', 'HTML_RESPONSE']
      })
      if (!result.success) {
        setHostMetricsError(result.userMessage || '获取资源监控失败')
        return
      }
      const data = result.data
      if (data?.success && data.data) {
        const payloadOrSnapshot = data.data as HostMetricsPayload | HostMetricsSnapshot
        if ((payloadOrSnapshot as HostMetricsPayload).snapshot) {
          const payload = payloadOrSnapshot as HostMetricsPayload
          setHostMetrics(payload.snapshot)
          setHostMetricsHistory(payload.history || [])
          setHostMetricsHistoryWindowSec(payload.windowSec || 300)
        } else {
          setHostMetrics(payloadOrSnapshot as HostMetricsSnapshot)
          setHostMetricsHistory([])
          setHostMetricsHistoryWindowSec(300)
        }
        if (showSuccessToast) {
          toast.success('资源监控数据已更新')
        }
      } else {
        setHostMetricsError(data?.error || '获取资源监控失败')
      }
    } catch (error: any) {
      setHostMetricsError(error?.message || '获取资源监控失败')
    } finally {
      hostMetricsInFlight.current = false
    }
  }

  const fetchStats = useCallback(async (options?: {
    showSuccessToast?: boolean
    showRefreshing?: boolean
    syncConfig?: boolean
  }) => {
    if (statsInFlight.current) return
    statsInFlight.current = true
    const showSuccessToast = options?.showSuccessToast ?? false
    const showRefreshing = options?.showRefreshing ?? true
    const syncConfig = options?.syncConfig ?? true

    if (showRefreshing) setRefreshing(true)
    try {
      const result = await fetchWithRetry('/api/queue/stats', undefined, {
        maxRetries: 2,
        retryDelay: 2000,
        retryOnErrors: ['SERVICE_UNAVAILABLE', 'HTML_RESPONSE']
      })

      if (!result.success) {
        // 只在监控标签页显示错误，避免切换标签页时也显示错误
        if (activeTab === 'monitor') {
          toast.error(result.userMessage)
        }
        return
      }

      const data = result.data

      if (data.success) {
        // 适配新统一队列格式（兼容旧格式）
        // 注意：stats API可能不返回config，必须从/api/queue/config获取
        const adaptedStats = {
          global: data.data?.global || data.stats?.global || {
            running: 0,
            queued: 0,
            completed: 0,
            failed: 0
          },
          perUser: data.data?.byUser ?
            Object.entries(data.data.byUser).map(([uid, userStats]: [string, any]) => ({
              userId: parseInt(uid),
              ...userStats
            })) :
            data.stats?.perUser || [],
          // config先使用API返回的值，如果没有则等待/config API
          config: {
            // 使用API返回的配置，如果没有则使用占位符（后续会被/config API更新）
            globalConcurrency: data.data?.config?.globalConcurrency || data.stats?.config?.globalConcurrency || configRef.current.globalConcurrency,
            perUserConcurrency: data.data?.config?.perUserConcurrency || data.stats?.config?.perUserConcurrency || configRef.current.perUserConcurrency,
            maxQueueSize: data.data?.config?.maxQueueSize || data.stats?.config?.maxQueueSize || 1000,
            taskTimeout: data.data?.config?.taskTimeout || data.stats?.config?.taskTimeout || 60000,
            enablePriority: data.data?.config?.enablePriority ?? data.stats?.config?.enablePriority ?? true,
            storageType: data.data?.config?.storageType || data.stats?.config?.storageType || 'redis',
            perTypeConcurrency: data.data?.config?.perTypeConcurrency || data.stats?.config?.perTypeConcurrency
          },
          // 新增字段
          byType: data.data?.byType || {}
        }

        setStats(adaptedStats)

        // 计算用户队列表格分页
        const totalUsers = adaptedStats.perUser.length
        setUserQueuePagination(prev => ({
          ...prev,
          total: totalUsers,
          totalPages: Math.ceil(totalUsers / prev.limit) || 1,
          page: Math.min(prev.page, Math.ceil(totalUsers / prev.limit) || 1)
        }))

        // 手动刷新时显示成功提示
        if (showSuccessToast) {
          toast.success(`队列数据已更新：运行 ${adaptedStats.global.running}，排队 ${adaptedStats.global.queued}`)
        }

        if (syncConfig) {
          // 🔥 修复：从 /api/queue/config 获取配置，而不是用硬编码默认值
          // stats API 不返回 perTypeConcurrency，需要单独获取
          try {
            const configResult = await fetchWithRetry('/api/queue/config')
            if (configResult.success && configResult.data?.config) {
              const dbConfig = configResult.data.config
              setConfig(prev => ({
                ...prev,
                globalConcurrency: dbConfig.globalConcurrency ?? prev.globalConcurrency,
                perUserConcurrency: dbConfig.perUserConcurrency ?? prev.perUserConcurrency,
                perTypeConcurrency: {
                  ...prev.perTypeConcurrency,
                  ...(dbConfig.perTypeConcurrency || {}),
                },
                maxQueueSize: dbConfig.maxQueueSize ?? prev.maxQueueSize,
                taskTimeout: dbConfig.taskTimeout ?? prev.taskTimeout,
                enablePriority: dbConfig.enablePriority !== false,
                defaultMaxRetries: dbConfig.defaultMaxRetries ?? prev.defaultMaxRetries,
                retryDelay: dbConfig.retryDelay ?? prev.retryDelay,
                storageType: dbConfig.storageType ?? prev.storageType,
              }))
            }
          } catch (configError) {
            console.warn('获取队列配置失败，使用默认值:', configError)
          }
        }
      } else {
        if (activeTab === 'monitor') {
          toast.error(data.error || '获取队列统计失败')
        }
      }
    } catch (error: any) {
      console.error('获取队列统计失败:', error)
      if (activeTab === 'monitor') {
        toast.error('获取队列统计时发生未知错误')
      }
    } finally {
      statsInFlight.current = false
      setLoading(false)
      if (showRefreshing) setRefreshing(false)
    }
  }, [activeTab])

  // 获取调度器状态
  const fetchSchedulerStatus = useCallback(async () => {
    try {
      setSchedulerLoading(true)
      setSchedulerError(null)
      const result = await fetchWithRetry('/api/queue/scheduler')

      if (result.success && result.data?.data) {
        setSchedulerStatus(result.data.data)
        setSchedulerError(null)
      } else {
        const errorMsg = result.success ? '获取调度器状态失败' : (result.error || result.userMessage || '获取调度器状态失败')
        setSchedulerError(errorMsg)
        console.error('获取调度器状态失败:', errorMsg)
      }
    } catch (error: any) {
      const errorMsg = error.message || '获取调度器状态时发生未知错误'
      setSchedulerError(errorMsg)
      console.error('获取调度器状态失败:', error)
    } finally {
      setSchedulerLoading(false)
    }
  }, [])

  // 手动触发调度器
  const triggerScheduler = useCallback(async () => {
    try {
      setSchedulerLoading(true)
      setSchedulerError(null)
      const response = await fetch('/api/queue/scheduler', { method: 'POST' })
      const result = await response.json()

      if (result.success) {
        toast.success(`调度器执行完成：处理 ${result.data.processed}，入队 ${result.data.executed}`)
        // 刷新调度器状态和队列统计
        await Promise.all([fetchSchedulerStatus(), fetchStats()])
      } else {
        toast.error(result.error || '触发调度器失败')
      }
    } catch (error: any) {
      toast.error(error.message || '触发调度器失败')
    } finally {
      setSchedulerLoading(false)
    }
  }, [fetchSchedulerStatus, fetchStats])

  // 排序处理函数
  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }))
  }

  // 获取排序后的用户数据
  const getSortedUsers = () => {
    if (!stats) return []

    const users = [...stats.perUser]
    const coreRunningFor = (u: (typeof users)[number]) => (u.coreRunning ?? u.running)

    return users.sort((a, b) => {
      let aValue: number | string
      let bValue: number | string

      switch (sortConfig.key) {
        case 'username':
          aValue = a.username.toLowerCase()
          bValue = b.username.toLowerCase()
          break
        case 'packageType':
          aValue = PACKAGE_TYPE_SORT_ORDER[a.packageType || 'trial'] ?? 999
          bValue = PACKAGE_TYPE_SORT_ORDER[b.packageType || 'trial'] ?? 999
          break
        case 'running':
          aValue = coreRunningFor(a)
          bValue = coreRunningFor(b)
          break
        case 'queued':
        case 'completed':
        case 'failed':
          aValue = a[sortConfig.key as keyof typeof a] as number
          bValue = b[sortConfig.key as keyof typeof b] as number
          break
        case 'utilization':
          // 计算利用率
          aValue = stats.config.perUserConcurrency > 0
            ? (coreRunningFor(a) / stats.config.perUserConcurrency)
            : 0
          bValue = stats.config.perUserConcurrency > 0
            ? (coreRunningFor(b) / stats.config.perUserConcurrency)
            : 0
          break
        default:
          aValue = coreRunningFor(a)
          bValue = coreRunningFor(b)
      }

      if (sortConfig.direction === 'asc') {
        return aValue > bValue ? 1 : -1
      } else {
        return aValue < bValue ? 1 : -1
      }
    })
  }

  const saveConfig = async () => {
    setSavingConfig(true)
    try {
      // 🔥 记录发送的配置，便于调试
      console.log('[QueueConfig] 保存配置:', config)

      const result = await fetchWithRetry('/api/queue/config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      })

      if (!result.success) {
        const errorMsg = result.userMessage || '保存配置失败'
        console.error('[QueueConfig] 保存失败:', result.error)
        toast.error(errorMsg)
        return
      }

      // 🔥 修复：使用API返回的新配置更新状态，而不是重新fetchStats
      const savedConfig = result.data?.config
      if (savedConfig) {
        setConfig(prev => ({
          ...prev,
          globalConcurrency: savedConfig.globalConcurrency ?? prev.globalConcurrency,
          perUserConcurrency: savedConfig.perUserConcurrency ?? prev.perUserConcurrency,
          perTypeConcurrency: savedConfig.perTypeConcurrency ?? prev.perTypeConcurrency,
          maxQueueSize: savedConfig.maxQueueSize ?? prev.maxQueueSize,
          taskTimeout: savedConfig.taskTimeout ?? prev.taskTimeout,
          defaultMaxRetries: savedConfig.defaultMaxRetries ?? prev.defaultMaxRetries,
          retryDelay: savedConfig.retryDelay ?? prev.retryDelay,
        }))
      }

      toast.success('配置已保存并生效')

      // 刷新统计信息（但不覆盖刚保存的配置）
      // await fetchStats()  // 移除：避免用旧配置覆盖新配置
    } catch (error: any) {
      console.error('保存配置失败:', error)
      toast.error('保存配置时发生未知错误')
    } finally {
      setSavingConfig(false)
    }
  }

  useEffect(() => {
    void fetchStats()
  }, [fetchStats])

  // 自动刷新队列监控数据：每30秒一次；离开页面/切换标签页自动清理定时器
  useEffect(() => {
    if (activeTab !== 'monitor') return
    const interval = setInterval(() => {
      void fetchStats({ showRefreshing: false, syncConfig: false })
    }, 30_000)
    return () => clearInterval(interval)
  }, [activeTab, fetchStats])

  useEffect(() => {
    if (activeTab !== 'monitor') return
    void fetchHostMetrics()
    const interval = setInterval(() => {
      void fetchHostMetrics()
    }, 10_000)
    return () => clearInterval(interval)
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'monitor' || schedulerCollapsed) return
    void fetchSchedulerStatus()
    const interval = setInterval(() => {
      void fetchSchedulerStatus()
    }, 60_000)
    return () => clearInterval(interval)
  }, [activeTab, schedulerCollapsed, fetchSchedulerStatus])

  // 当每页显示数量或用户数据变化时，重新计算分页
  useEffect(() => {
    if (stats?.perUser) {
      const totalUsers = stats.perUser.length
      setUserQueuePagination(prev => ({
        ...prev,
        total: totalUsers,
        totalPages: Math.ceil(totalUsers / prev.limit) || 1,
        page: Math.min(prev.page, Math.ceil(totalUsers / prev.limit) || 1)
      }))
    }
  }, [stats?.perUser, userQueuePagination.limit])

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent"></div>
        </div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="p-8">
        <div className="text-center text-gray-500">
          <p>无法加载队列信息</p>
        </div>
      </div>
    )
  }

  const clickFarmRunning = stats.byTypeRunning?.['click-farm'] || 0
  const urlSwapRunning = stats.byTypeRunning?.['url-swap'] || 0
  const coreRunning = stats.global.coreRunning ?? Math.max(0, stats.global.running - clickFarmRunning - urlSwapRunning)
  const backgroundRunning = stats.global.backgroundRunning ?? (clickFarmRunning + urlSwapRunning)

  const globalUtilization = stats.config.globalConcurrency > 0
    ? Math.round((coreRunning / stats.config.globalConcurrency) * 100)
    : 0

  const totalTasks = stats.global.running + stats.global.queued + stats.global.completed + stats.global.failed

  return (
    <TooltipProvider>
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">队列配置与监控</h1>
          <p className="text-gray-500 mt-1">管理批量任务队列和并发限制</p>
        </div>
        <div className="flex items-center space-x-3">
          {activeTab === 'monitor' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void fetchStats({ showSuccessToast: true })
                void fetchHostMetrics(true)
              }}
              disabled={refreshing}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? '刷新中...' : '刷新'}
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('monitor')}
            className={`
              py-4 px-1 border-b-2 font-medium text-sm transition-colors
              ${activeTab === 'monitor'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }
            `}
          >
            <Activity className="w-5 h-5 inline-block mr-2" />
            实时监控
          </button>
          <button
            onClick={() => setActiveTab('config')}
            className={`
              py-4 px-1 border-b-2 font-medium text-sm transition-colors
              ${activeTab === 'config'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }
            `}
          >
            <Settings className="w-5 h-5 inline-block mr-2" />
            配置管理
          </button>
        </nav>
      </div>

      {/* Monitor Tab */}
      {activeTab === 'monitor' && (
        <div className="space-y-6">
          {/* Global Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Activity className="w-6 h-6 text-blue-600" />
                </div>
                <span className="text-sm font-medium text-gray-500">核心运行中</span>
              </div>
              <div className="space-y-1">
                <p className="text-3xl font-bold text-gray-900">{coreRunning}</p>
                <p className="text-sm text-gray-500">
                  / {stats.config.globalConcurrency} 并发
                </p>
                {backgroundRunning > 0 && (
                  <p className="text-xs text-gray-500">
                    总运行中 {stats.global.running}（后台 {backgroundRunning}）
                  </p>
                )}
              </div>
              <div className="mt-4">
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(globalUtilization, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  利用率: {globalUtilization}%
                  {globalUtilization > 100 ? `（超出 ${stats.global.running - stats.config.globalConcurrency}）` : ''}
                </p>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                  <Clock className="w-6 h-6 text-yellow-600" />
                </div>
                <span className="text-sm font-medium text-gray-500">队列中</span>
              </div>
              <div className="space-y-1">
                <p className="text-3xl font-bold text-gray-900">{stats.global.queued}</p>
                <p className="text-sm text-gray-500">
                  / {stats.config.maxQueueSize} 最大
                </p>
              </div>
              <div className="mt-4">
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-yellow-600 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min((stats.global.queued / stats.config.maxQueueSize) * 100, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  队列使用: {Math.round((stats.global.queued / stats.config.maxQueueSize) * 100)}%
                </p>
                {typeof stats.global.queuedEligible === 'number' && typeof stats.global.queuedDelayed === 'number' && (
                  <p className="text-xs text-gray-500 mt-1">
                    可立即执行 {stats.global.queuedEligible}；等待时间 {stats.global.queuedDelayed}
                    {stats.global.queuedEligible === 0 && stats.global.nextQueuedAt
                      ? `（最早：${formatDateTime(stats.global.nextQueuedAt)}）`
                      : ''}
                  </p>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                  <CheckCircle className="w-6 h-6 text-green-600" />
                </div>
                <span className="text-sm font-medium text-gray-500">已完成</span>
              </div>
              <div className="space-y-1">
                <p className="text-3xl font-bold text-gray-900">{stats.global.completed}</p>
                <p className="text-sm text-gray-500">
                  成功率: {totalTasks > 0 ? Math.round((stats.global.completed / totalTasks) * 100) : 0}%
                </p>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                  <XCircle className="w-6 h-6 text-red-600" />
                </div>
                <span className="text-sm font-medium text-gray-500">失败</span>
              </div>
              <div className="space-y-1">
                <p className="text-3xl font-bold text-gray-900">{stats.global.failed}</p>
                <p className="text-sm text-gray-500">
                  失败率: {totalTasks > 0 ? Math.round((stats.global.failed / totalTasks) * 100) : 0}%
                </p>
              </div>
            </div>
          </div>

          {/* Scheduler Health Check */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <button
                onClick={() => setSchedulerCollapsed(!schedulerCollapsed)}
                className="flex items-center gap-2 flex-1 text-left group"
              >
                {schedulerCollapsed ? (
                  <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-gray-600 transition-colors flex-shrink-0" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-400 group-hover:text-gray-600 transition-colors flex-shrink-0" />
                )}
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 group-hover:text-gray-700 transition-colors">调度器健康检查</h2>
                  <p className="text-sm text-gray-500">
                    监控后台定时调度器的运行状态和任务入队情况（不包括按需触发的队列任务，如 Offer 提取、广告创意生成等）
                  </p>
                </div>
              </button>
              <Button
                variant="outline"
                size="sm"
                onClick={triggerScheduler}
                disabled={schedulerLoading}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${schedulerLoading ? 'animate-spin' : ''}`} />
                {schedulerLoading ? '触发中...' : '手动触发'}
              </Button>
            </div>

            {!schedulerCollapsed && (
              <>
                {schedulerLoading && !schedulerStatus && (
                  <div className="text-center py-8 text-gray-500">
                    <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
                    <p>加载调度器状态...</p>
                  </div>
                )}

                {schedulerError && !schedulerStatus && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">获取调度器状态失败</p>
                        <p className="mt-1">{schedulerError}</p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={fetchSchedulerStatus}
                          className="mt-2"
                        >
                          重试
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {schedulerStatus && (
              <div className="space-y-4">
                {schedulerStatus.note && (
                  <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                    ℹ️ {schedulerStatus.note}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* Click Farm Scheduler */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-medium text-gray-900">补点击调度器</h3>
                      <div className={`flex items-center gap-2 px-2 py-1 rounded-full text-xs font-medium ${
                        schedulerStatus.clickFarmScheduler.status === 'healthy'
                          ? 'bg-green-100 text-green-700'
                          : schedulerStatus.clickFarmScheduler.status === 'warning'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        <div className={`w-2 h-2 rounded-full ${
                          schedulerStatus.clickFarmScheduler.status === 'healthy'
                            ? 'bg-green-600'
                            : schedulerStatus.clickFarmScheduler.status === 'warning'
                            ? 'bg-yellow-600'
                            : 'bg-red-600'
                        }`} />
                        {schedulerStatus.clickFarmScheduler.status === 'healthy' ? '正常' :
                         schedulerStatus.clickFarmScheduler.status === 'warning' ? '警告' : '异常'}
                      </div>
                    </div>

                    <div className="mb-3 text-sm text-gray-700">
                      {schedulerStatus.clickFarmScheduler.message}
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">检查间隔:</span>
                        <span className="font-medium text-gray-900">
                          {schedulerStatus.clickFarmScheduler.metrics.checkInterval}
                        </span>
                      </div>

                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <p className="text-gray-500 mb-2">任务统计:</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-blue-50 rounded px-2 py-1">
                            <span className="text-xs text-blue-600">运行任务: </span>
                            <span className="text-xs font-medium text-blue-900">
                              {schedulerStatus.clickFarmScheduler.metrics.enabledTasks}
                            </span>
                          </div>
                          <div className="bg-gray-50 rounded px-2 py-1">
                            <span className="text-xs text-gray-600">近2小时入队: </span>
                            <span className="text-xs font-medium text-gray-900">
                              {schedulerStatus.clickFarmScheduler.metrics.recentQueuedTasks}
                            </span>
                          </div>
                          {schedulerStatus.clickFarmScheduler.metrics.lastQueuedAt && (
                            <div className="bg-gray-50 rounded px-2 py-1 col-span-2">
                              <span className="text-xs text-gray-600">最后入队: </span>
                              <span className="text-xs font-medium text-gray-900">
                                {new Date(schedulerStatus.clickFarmScheduler.metrics.lastQueuedAt).toLocaleString('zh-CN')}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* URL Swap Scheduler */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-medium text-gray-900">换链接调度器</h3>
                      <div className={`flex items-center gap-2 px-2 py-1 rounded-full text-xs font-medium ${
                        schedulerStatus.urlSwapScheduler.status === 'healthy'
                          ? 'bg-green-100 text-green-700'
                          : schedulerStatus.urlSwapScheduler.status === 'warning'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        <div className={`w-2 h-2 rounded-full ${
                          schedulerStatus.urlSwapScheduler.status === 'healthy'
                            ? 'bg-green-600'
                            : schedulerStatus.urlSwapScheduler.status === 'warning'
                            ? 'bg-yellow-600'
                            : 'bg-red-600'
                        }`} />
                        {schedulerStatus.urlSwapScheduler.status === 'healthy' ? '正常' :
                         schedulerStatus.urlSwapScheduler.status === 'warning' ? '警告' : '异常'}
                      </div>
                    </div>

                    <div className="mb-3 text-sm text-gray-700">
                      {schedulerStatus.urlSwapScheduler.message}
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">检查间隔:</span>
                        <span className="font-medium text-gray-900">
                          {schedulerStatus.urlSwapScheduler.metrics.checkInterval}
                        </span>
                      </div>

                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <p className="text-gray-500 mb-2">任务统计:</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-blue-50 rounded px-2 py-1">
                            <span className="text-xs text-blue-600">启用任务: </span>
                            <span className="text-xs font-medium text-blue-900">
                              {schedulerStatus.urlSwapScheduler.metrics.enabledTasks}
                            </span>
                          </div>
                          <div className={`rounded px-2 py-1 ${
                            schedulerStatus.urlSwapScheduler.metrics.overdueTasks > 0
                              ? 'bg-red-50'
                              : 'bg-green-50'
                          }`}>
                            <span className={`text-xs ${
                              schedulerStatus.urlSwapScheduler.metrics.overdueTasks > 0
                                ? 'text-red-600'
                                : 'text-green-600'
                            }`}>逾期任务: </span>
                            <span className={`text-xs font-medium ${
                              schedulerStatus.urlSwapScheduler.metrics.overdueTasks > 0
                                ? 'text-red-900'
                                : 'text-green-900'
                            }`}>
                              {schedulerStatus.urlSwapScheduler.metrics.overdueTasks}
                            </span>
                          </div>
                          <div className="bg-gray-50 rounded px-2 py-1">
                            <span className="text-xs text-gray-600">近5分钟入队: </span>
                            <span className="text-xs font-medium text-gray-900">
                              {schedulerStatus.urlSwapScheduler.metrics.recentQueuedTasks}
                            </span>
                          </div>
                          {schedulerStatus.urlSwapScheduler.metrics.lastQueuedAt && (
                            <div className="bg-gray-50 rounded px-2 py-1 col-span-2">
                              <span className="text-xs text-gray-600">最后入队: </span>
                              <span className="text-xs font-medium text-gray-900">
                                {new Date(schedulerStatus.urlSwapScheduler.metrics.lastQueuedAt).toLocaleString('zh-CN')}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Data Sync Scheduler */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-medium text-gray-900">数据同步调度器</h3>
                      <div className={`flex items-center gap-2 px-2 py-1 rounded-full text-xs font-medium ${
                        schedulerStatus.dataSyncScheduler.status === 'healthy'
                          ? 'bg-green-100 text-green-700'
                          : schedulerStatus.dataSyncScheduler.status === 'warning'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        <div className={`w-2 h-2 rounded-full ${
                          schedulerStatus.dataSyncScheduler.status === 'healthy'
                            ? 'bg-green-600'
                            : schedulerStatus.dataSyncScheduler.status === 'warning'
                            ? 'bg-yellow-600'
                            : 'bg-red-600'
                        }`} />
                        {schedulerStatus.dataSyncScheduler.status === 'healthy' ? '正常' :
                         schedulerStatus.dataSyncScheduler.status === 'warning' ? '警告' : '异常'}
                      </div>
                    </div>

                    <div className="mb-3 text-sm text-gray-700">
                      {schedulerStatus.dataSyncScheduler.message}
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">检查间隔:</span>
                        <span className="font-medium text-gray-900">
                          {schedulerStatus.dataSyncScheduler.metrics.checkInterval}
                        </span>
                      </div>

                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <p className="text-gray-500 mb-2">任务统计:</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-blue-50 rounded px-2 py-1">
                            <span className="text-xs text-blue-600">启用用户: </span>
                            <span className="text-xs font-medium text-blue-900">
                              {schedulerStatus.dataSyncScheduler.metrics.enabledUsers}
                            </span>
                          </div>
                          <div className="bg-gray-50 rounded px-2 py-1">
                            <span className="text-xs text-gray-600">近1小时入队: </span>
                            <span className="text-xs font-medium text-gray-900">
                              {schedulerStatus.dataSyncScheduler.metrics.recentQueuedTasks}
                            </span>
                          </div>
                          {schedulerStatus.dataSyncScheduler.metrics.lastQueuedAt && (
                            <div className="bg-gray-50 rounded px-2 py-1 col-span-2">
                              <span className="text-xs text-gray-600">最后入队: </span>
                              <span className="text-xs font-medium text-gray-900">
                                {new Date(schedulerStatus.dataSyncScheduler.metrics.lastQueuedAt).toLocaleString('zh-CN')}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Affiliate Sync Scheduler */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-medium text-gray-900">联盟商品同步调度器</h3>
                      <div className={`flex items-center gap-2 px-2 py-1 rounded-full text-xs font-medium ${
                        schedulerStatus.affiliateSyncScheduler.status === 'healthy'
                          ? 'bg-green-100 text-green-700'
                          : schedulerStatus.affiliateSyncScheduler.status === 'warning'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        <div className={`w-2 h-2 rounded-full ${
                          schedulerStatus.affiliateSyncScheduler.status === 'healthy'
                            ? 'bg-green-600'
                            : schedulerStatus.affiliateSyncScheduler.status === 'warning'
                            ? 'bg-yellow-600'
                            : 'bg-red-600'
                        }`} />
                        {schedulerStatus.affiliateSyncScheduler.status === 'healthy' ? '正常' :
                         schedulerStatus.affiliateSyncScheduler.status === 'warning' ? '警告' : '异常'}
                      </div>
                    </div>

                    <div className="mb-3 text-sm text-gray-700">
                      {schedulerStatus.affiliateSyncScheduler.message}
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">检查间隔:</span>
                        <span className="font-medium text-gray-900">
                          {schedulerStatus.affiliateSyncScheduler.metrics.checkInterval}
                        </span>
                      </div>

                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <p className="text-gray-500 mb-2">任务统计:</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-blue-50 rounded px-2 py-1">
                            <span className="text-xs text-blue-600">启用用户: </span>
                            <span className="text-xs font-medium text-blue-900">
                              {schedulerStatus.affiliateSyncScheduler.metrics.enabledUsers}
                            </span>
                          </div>
                          <div className="bg-gray-50 rounded px-2 py-1">
                            <span className="text-xs text-gray-600">近30分钟入队: </span>
                            <span className="text-xs font-medium text-gray-900">
                              {schedulerStatus.affiliateSyncScheduler.metrics.recentQueuedTasks}
                            </span>
                          </div>
                          {schedulerStatus.affiliateSyncScheduler.metrics.lastQueuedAt && (
                            <div className="bg-gray-50 rounded px-2 py-1 col-span-2">
                              <span className="text-xs text-gray-600">最后入队: </span>
                              <span className="text-xs font-medium text-gray-900">
                                {new Date(schedulerStatus.affiliateSyncScheduler.metrics.lastQueuedAt).toLocaleString('zh-CN')}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Zombie Cleanup Scheduler */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-medium text-gray-900">僵尸任务清理调度器</h3>
                      <div className={`flex items-center gap-2 px-2 py-1 rounded-full text-xs font-medium ${
                        schedulerStatus.zombieCleanupScheduler.status === 'healthy'
                          ? 'bg-green-100 text-green-700'
                          : schedulerStatus.zombieCleanupScheduler.status === 'warning'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        <div className={`w-2 h-2 rounded-full ${
                          schedulerStatus.zombieCleanupScheduler.status === 'healthy'
                            ? 'bg-green-600'
                            : schedulerStatus.zombieCleanupScheduler.status === 'warning'
                            ? 'bg-yellow-600'
                            : 'bg-red-600'
                        }`} />
                        {schedulerStatus.zombieCleanupScheduler.status === 'healthy' ? '正常' :
                         schedulerStatus.zombieCleanupScheduler.status === 'warning' ? '警告' : '异常'}
                      </div>
                    </div>

                    <div className="mb-3 text-sm text-gray-700">
                      {schedulerStatus.zombieCleanupScheduler.message}
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">检查间隔:</span>
                        <span className="font-medium text-gray-900">
                          {schedulerStatus.zombieCleanupScheduler.metrics.checkInterval}
                        </span>
                      </div>

                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <p className="text-gray-500 mb-2">任务统计:</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div className={`rounded px-2 py-1 ${
                            schedulerStatus.zombieCleanupScheduler.metrics.potentialZombieTasks > 0
                              ? 'bg-yellow-50'
                              : 'bg-green-50'
                          }`}>
                            <span className={`text-xs ${
                              schedulerStatus.zombieCleanupScheduler.metrics.potentialZombieTasks > 0
                                ? 'text-yellow-600'
                                : 'text-green-600'
                            }`}>潜在僵尸: </span>
                            <span className={`text-xs font-medium ${
                              schedulerStatus.zombieCleanupScheduler.metrics.potentialZombieTasks > 0
                                ? 'text-yellow-900'
                                : 'text-green-900'
                            }`}>
                              {schedulerStatus.zombieCleanupScheduler.metrics.potentialZombieTasks}
                            </span>
                          </div>
                          <div className="bg-blue-50 rounded px-2 py-1">
                            <span className="text-xs text-blue-600">近2小时修复: </span>
                            <span className="text-xs font-medium text-blue-900">
                              {schedulerStatus.zombieCleanupScheduler.metrics.recentFixedTasks}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* OpenClaw Strategy Scheduler */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-medium text-gray-900">OpenClaw策略调度器</h3>
                      <div className={`flex items-center gap-2 px-2 py-1 rounded-full text-xs font-medium ${
                        schedulerStatus.openclawStrategyScheduler.status === 'healthy'
                          ? 'bg-green-100 text-green-700'
                          : schedulerStatus.openclawStrategyScheduler.status === 'warning'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        <div className={`w-2 h-2 rounded-full ${
                          schedulerStatus.openclawStrategyScheduler.status === 'healthy'
                            ? 'bg-green-600'
                            : schedulerStatus.openclawStrategyScheduler.status === 'warning'
                            ? 'bg-yellow-600'
                            : 'bg-red-600'
                        }`} />
                        {schedulerStatus.openclawStrategyScheduler.status === 'healthy' ? '正常' :
                         schedulerStatus.openclawStrategyScheduler.status === 'warning' ? '警告' : '异常'}
                      </div>
                    </div>

                    <div className="mb-3 text-sm text-gray-700">
                      {schedulerStatus.openclawStrategyScheduler.message}
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">检查间隔:</span>
                        <span className="font-medium text-gray-900">
                          {schedulerStatus.openclawStrategyScheduler.metrics.checkInterval}
                        </span>
                      </div>

                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <p className="text-gray-500 mb-2">任务统计:</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-blue-50 rounded px-2 py-1">
                            <span className="text-xs text-blue-600">启用用户: </span>
                            <span className="text-xs font-medium text-blue-900">
                              {schedulerStatus.openclawStrategyScheduler.metrics.enabledUsers}
                            </span>
                          </div>
                          <div className="bg-gray-50 rounded px-2 py-1">
                            <span className="text-xs text-gray-600">近24小时入队: </span>
                            <span className="text-xs font-medium text-gray-900">
                              {schedulerStatus.openclawStrategyScheduler.metrics.recentQueuedTasks}
                            </span>
                          </div>
                          {schedulerStatus.openclawStrategyScheduler.metrics.lastQueuedAt && (
                            <div className="bg-gray-50 rounded px-2 py-1 col-span-2">
                              <span className="text-xs text-gray-600">最后入队: </span>
                              <span className="text-xs font-medium text-gray-900">
                                {new Date(schedulerStatus.openclawStrategyScheduler.metrics.lastQueuedAt).toLocaleString('zh-CN')}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
              </>
            )}
          </div>

          {/* Host Metrics (Container) */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">容器资源监控</h2>
                <p className="text-sm text-gray-500">
                  低频采样（10s），仅在本页打开时启用；趋势窗口：最近{Math.round(hostMetricsHistoryWindowSec / 60)}分钟
                  {hostMetrics?.timestamp ? `；更新时间：${new Date(hostMetrics.timestamp).toLocaleString('zh-CN')}` : ''}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchHostMetrics(true)}
                disabled={hostMetricsInFlight.current}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${hostMetricsInFlight.current ? 'animate-spin' : ''}`} />
                {hostMetricsInFlight.current ? '刷新中...' : '刷新'}
              </Button>
            </div>

            {hostMetricsError && (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {hostMetricsError}
              </div>
            )}

            {!hostMetrics?.available && (
              <div className="mb-4 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
                当前环境无法获取完整容器指标（source: {hostMetrics?.source || 'unavailable'}）
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-600">CPU</span>
                  <Cpu className="w-4 h-4 text-gray-500" />
                </div>
                <div className="mt-2">
                  <div className="text-2xl font-bold text-gray-900">{formatPct(hostMetrics?.cpu.usagePct)}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    throttled: {formatPct(hostMetrics?.cpu.throttledPct)}{hostMetrics?.cpu.quotaCores ? `；quota≈${hostMetrics.cpu.quotaCores.toFixed(2)} cores` : ''}
                  </div>
                  <div className="mt-2">
                    <Sparkline
                      fixedDomain={{ min: 0, max: 100 }}
                      series={[
                        { values: hostMetricsHistory.map(p => p.cpuUsagePct), color: '#2563EB' },
                        { values: hostMetricsHistory.map(p => p.cpuThrottledPct), color: '#DC2626' }
                      ]}
                    />
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-600">内存</span>
                  <Activity className="w-4 h-4 text-gray-500" />
                </div>
                <div className="mt-2">
                  <div className="text-2xl font-bold text-gray-900">{formatPct(hostMetrics?.memory.usagePct)}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {formatBytes(hostMetrics?.memory.usedBytes)} / {hostMetrics?.memory.limitBytes ? formatBytes(hostMetrics.memory.limitBytes) : 'max'}
                  </div>
                  <div className="mt-2">
                    <Sparkline
                      fixedDomain={{ min: 0, max: 100 }}
                      series={[
                        { values: hostMetricsHistory.map(p => p.memUsagePct), color: '#16A34A' },
                      ]}
                    />
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-600">磁盘 IO</span>
                  <HardDrive className="w-4 h-4 text-gray-500" />
                </div>
                <div className="mt-2">
                  <div className="text-sm text-gray-900">
                    读 {formatBps(hostMetrics?.diskIo.readBps)} / 写 {formatBps(hostMetrics?.diskIo.writeBps)}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    rIOPS {hostMetrics?.diskIo.readOpsPerSec?.toFixed(1) ?? '-'} / wIOPS {hostMetrics?.diskIo.writeOpsPerSec?.toFixed(1) ?? '-'}
                  </div>
                  <div className="mt-2">
                    <Sparkline
                      series={[
                        { values: hostMetricsHistory.map(p => p.diskReadBps), color: '#0EA5E9' },
                        { values: hostMetricsHistory.map(p => p.diskWriteBps), color: '#A855F7' }
                      ]}
                    />
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-600">网络 IO</span>
                  <Network className="w-4 h-4 text-gray-500" />
                </div>
                <div className="mt-2">
                  <div className="text-sm text-gray-900">
                    RX {formatBps(hostMetrics?.network.rxBps)} / TX {formatBps(hostMetrics?.network.txBps)}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    interval: {hostMetrics?.intervalSec ? `${hostMetrics.intervalSec.toFixed(1)}s` : '-'}
                  </div>
                  <div className="mt-2">
                    <Sparkline
                      series={[
                        { values: hostMetricsHistory.map(p => p.netRxBps), color: '#F59E0B' },
                        { values: hostMetricsHistory.map(p => p.netTxBps), color: '#EF4444' }
                      ]}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Task Type Stats with Concurrency Limits (Running only) */}
          {stats.byType && Object.keys(stats.byType).length > 0 && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <Settings className="w-5 h-5 mr-2" />
                任务类型运行中与并发限制
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {Object.entries(stats.byType).map(([type, count]: [string, any]) => {
                  const runningCount = stats.byTypeRunning?.[type] || 0
                  const limit = stats.config.perTypeConcurrency?.[type] || 2
                  const utilization = limit > 0 ? Math.round((runningCount / limit) * 100) : 0
                  return (
                    <div key={type} className="bg-gray-50 rounded-lg p-4">
                      <p className="text-sm font-medium text-gray-600">
                        {TASK_TYPE_LABELS[type] || type}
                      </p>
                      <div className="flex items-baseline justify-between mt-1">
                        <p className="text-2xl font-bold text-gray-900">{runningCount}</p>
                        <p className="text-sm text-gray-500">/ {limit}</p>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">总任务: {count}</p>
                      <div className="mt-2">
                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full transition-all duration-500 ${
                              utilization >= 100 ? 'bg-red-500' :
                              utilization >= 70 ? 'bg-yellow-500' : 'bg-green-500'
                            }`}
                            style={{ width: `${Math.min(utilization, 100)}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{utilization}%</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Per-User Stats */}
          {stats.perUser.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <Users className="w-5 h-5 mr-2" />
                用户队列状态
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th
                        className="text-left py-3 px-4 text-sm font-medium text-gray-600 cursor-pointer hover:text-gray-900 hover:bg-gray-50 transition-colors select-none"
                        onClick={() => handleSort('username')}
                      >
                        <div className="flex items-center gap-1">
                          用户
                          {sortConfig.key === 'username' ? (
                            sortConfig.direction === 'asc' ? (
                              <ArrowUp className="w-4 h-4" />
                            ) : (
                              <ArrowDown className="w-4 h-4" />
                            )
                          ) : (
                            <ArrowUpDown className="w-4 h-4 text-gray-400" />
                          )}
                        </div>
                      </th>
                      <th
                        className="text-left py-3 px-4 text-sm font-medium text-gray-600 cursor-pointer hover:text-gray-900 hover:bg-gray-50 transition-colors select-none"
                        onClick={() => handleSort('packageType')}
                      >
                        <div className="flex items-center gap-1">
                          套餐
                          {sortConfig.key === 'packageType' ? (
                            sortConfig.direction === 'asc' ? (
                              <ArrowUp className="w-4 h-4" />
                            ) : (
                              <ArrowDown className="w-4 h-4" />
                            )
                          ) : (
                            <ArrowUpDown className="w-4 h-4 text-gray-400" />
                          )}
                        </div>
                      </th>
                      <th
                        className="text-center py-3 px-4 text-sm font-medium text-gray-600 cursor-pointer hover:text-gray-900 hover:bg-gray-50 transition-colors select-none"
                        onClick={() => handleSort('running')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          核心运行中
                          {sortConfig.key === 'running' ? (
                            sortConfig.direction === 'asc' ? (
                              <ArrowUp className="w-4 h-4" />
                            ) : (
                              <ArrowDown className="w-4 h-4" />
                            )
                          ) : (
                            <ArrowUpDown className="w-4 h-4 text-gray-400" />
                          )}
                        </div>
                      </th>
                      <th
                        className="text-center py-3 px-4 text-sm font-medium text-gray-600 cursor-pointer hover:text-gray-900 hover:bg-gray-50 transition-colors select-none"
                        onClick={() => handleSort('queued')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          队列中
                          {sortConfig.key === 'queued' ? (
                            sortConfig.direction === 'asc' ? (
                              <ArrowUp className="w-4 h-4" />
                            ) : (
                              <ArrowDown className="w-4 h-4" />
                            )
                          ) : (
                            <ArrowUpDown className="w-4 h-4 text-gray-400" />
                          )}
                        </div>
                      </th>
                      <th
                        className="text-center py-3 px-4 text-sm font-medium text-gray-600 cursor-pointer hover:text-gray-900 hover:bg-gray-50 transition-colors select-none"
                        onClick={() => handleSort('completed')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          已完成
                          {sortConfig.key === 'completed' ? (
                            sortConfig.direction === 'asc' ? (
                              <ArrowUp className="w-4 h-4" />
                            ) : (
                              <ArrowDown className="w-4 h-4" />
                            )
                          ) : (
                            <ArrowUpDown className="w-4 h-4 text-gray-400" />
                          )}
                        </div>
                      </th>
                      <th
                        className="text-center py-3 px-4 text-sm font-medium text-gray-600 cursor-pointer hover:text-gray-900 hover:bg-gray-50 transition-colors select-none"
                        onClick={() => handleSort('failed')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          失败
                          {sortConfig.key === 'failed' ? (
                            sortConfig.direction === 'asc' ? (
                              <ArrowUp className="w-4 h-4" />
                            ) : (
                              <ArrowDown className="w-4 h-4" />
                            )
                          ) : (
                            <ArrowUpDown className="w-4 h-4 text-gray-400" />
                          )}
                        </div>
                      </th>
                      <th
                        className="text-center py-3 px-4 text-sm font-medium text-gray-600 w-32 cursor-pointer hover:text-gray-900 hover:bg-gray-50 transition-colors select-none"
                        onClick={() => handleSort('utilization')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          利用率
                          {sortConfig.key === 'utilization' ? (
                            sortConfig.direction === 'asc' ? (
                              <ArrowUp className="w-4 h-4" />
                            ) : (
                              <ArrowDown className="w-4 h-4" />
                            )
                          ) : (
                            <ArrowUpDown className="w-4 h-4 text-gray-400" />
                          )}
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const startIndex = (userQueuePagination.page - 1) * userQueuePagination.limit
                      const endIndex = startIndex + userQueuePagination.limit
                      const sortedUsers = getSortedUsers()
                      const paginatedUsers = sortedUsers.slice(startIndex, endIndex)

                      return paginatedUsers.map((userStat) => {
                        const coreRunningForUser = userStat.coreRunning ?? userStat.running
                        const backgroundRunningForUser = userStat.backgroundRunning ?? 0
                        const coreCompletedForUser = userStat.coreCompleted ?? userStat.completed
                        const backgroundCompletedForUser = userStat.backgroundCompleted ?? 0
                        const coreFailedForUser = userStat.coreFailed ?? userStat.failed
                        const backgroundFailedForUser = userStat.backgroundFailed ?? 0
                        const userUtilization = stats.config.perUserConcurrency > 0
                          ? Math.round((coreRunningForUser / stats.config.perUserConcurrency) * 100)
                          : 0

                        return (
                          <tr key={userStat.userId} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="py-3 px-4">
                              <div className="flex flex-col">
                                <span className="text-sm font-medium text-gray-900">{userStat.username}</span>
                                {userStat.email && (
                                  <span className="text-xs text-gray-500">{userStat.email}</span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <span className="text-sm text-gray-700">
                                {PACKAGE_TYPE_LABELS[userStat.packageType || 'trial'] || userStat.packageType || '-'}
                              </span>
                            </td>
                            <td className="text-center py-3 px-4">
                              <div className="flex flex-col items-center gap-1">
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                  {coreRunningForUser} / {stats.config.perUserConcurrency}
                                </span>
                                {backgroundRunningForUser > 0 && (
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                                    后台 {backgroundRunningForUser}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="text-center py-3 px-4">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                {userStat.queued}
                              </span>
                            </td>
                            <td className="text-center py-3 px-4">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="inline-flex flex-col items-center gap-1 cursor-default">
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                      {userStat.completed}
                                    </span>
                                    <span className="text-[11px] text-gray-500 whitespace-nowrap">
                                      核心 {coreCompletedForUser} · 非核 {backgroundCompletedForUser}
                                    </span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs leading-5">
                                  <div>核心：已完成 {coreCompletedForUser} / 失败 {coreFailedForUser}</div>
                                  <div>非核心：已完成 {backgroundCompletedForUser} / 失败 {backgroundFailedForUser}</div>
                                </TooltipContent>
                              </Tooltip>
                            </td>
                            <td className="text-center py-3 px-4">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="inline-flex flex-col items-center gap-1 cursor-default">
                                    <span
                                      className={[
                                        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                                        coreFailedForUser > 0 ? 'bg-red-200 text-red-900 ring-1 ring-red-300' : 'bg-red-100 text-red-800',
                                      ].join(' ')}
                                    >
                                      {userStat.failed}
                                    </span>
                                    <span className="text-[11px] text-gray-500 whitespace-nowrap">
                                      <span className={coreFailedForUser > 0 ? 'text-red-700 font-semibold' : ''}>
                                        核心 {coreFailedForUser}
                                      </span>
                                      {' · '}
                                      非核 {backgroundFailedForUser}
                                    </span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs leading-5">
                                  <div>核心：已完成 {coreCompletedForUser} / 失败 {coreFailedForUser}</div>
                                  <div>非核心：已完成 {backgroundCompletedForUser} / 失败 {backgroundFailedForUser}</div>
                                </TooltipContent>
                              </Tooltip>
                            </td>
                            <td className="text-center py-3 px-4">
                              <div className="flex flex-col items-center space-y-1">
                                <div className="w-16 bg-gray-200 rounded-full h-2">
                                  <div
                                    className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                                    style={{ width: `${Math.min(userUtilization, 100)}%` }}
                                  />
                                </div>
                                <span className="text-xs text-gray-600 font-medium">{userUtilization}%</span>
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    })()}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {userQueuePagination.total > 0 && (
                <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-gray-200 pt-4">
                  <div className="flex items-center space-x-2 flex-shrink-0">
                    <span className="text-sm font-medium text-gray-600 whitespace-nowrap">每页显示：</span>
                    <Select
                      value={String(userQueuePagination.limit)}
                      onValueChange={(newLimit) => {
                        setUserQueuePagination(prev => ({
                          ...prev,
                          limit: parseInt(newLimit),
                          page: 1
                        }))
                      }}
                    >
                      <SelectTrigger className="w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5</SelectItem>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="20">20</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <span className="text-sm text-gray-600 whitespace-nowrap">
                    显示 {(userQueuePagination.page - 1) * userQueuePagination.limit + 1} - {Math.min(userQueuePagination.page * userQueuePagination.limit, userQueuePagination.total)} 条，共 {userQueuePagination.total} 条
                  </span>

                  <div className="flex items-center space-x-2 flex-shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setUserQueuePagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                      disabled={userQueuePagination.page === 1 || loading}
                    >
                      <ChevronLeft className="w-4 h-4 mr-1" />
                      上一页
                    </Button>

                    <span className="text-sm font-medium text-gray-700 px-2 whitespace-nowrap">
                      第 {userQueuePagination.page} / {userQueuePagination.totalPages} 页
                    </span>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setUserQueuePagination(prev => ({ ...prev, page: Math.min(prev.totalPages, prev.page + 1) }))}
                      disabled={userQueuePagination.page === userQueuePagination.totalPages || loading}
                    >
                      下一页
                      <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Empty State */}
          {stats.perUser.length === 0 && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
              <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">暂无活跃用户</h3>
              <p className="text-gray-500">当前没有用户在使用队列</p>
            </div>
          )}
        </div>
      )}

      {/* Config Tab */}
      {activeTab === 'config' && (
        <div className="space-y-6">
          {/* Warning Banner */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-medium text-yellow-800">配置说明</h3>
              <p className="text-sm text-yellow-700 mt-1">
                修改配置后会立即生效。建议根据服务器配置合理设置并发限制，避免服务器过载。
              </p>
            </div>
          </div>

          {/* Configuration Form */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-6">队列配置</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Global Concurrency */}
              <div>
                <Label htmlFor="globalConcurrency" className="text-sm font-medium text-gray-700">
                  全局并发限制
                </Label>
                <Input
                  id="globalConcurrency"
                  type="number"
                  min="1"
                  max="50"
                  value={config.globalConcurrency}
                  onChange={(e) => setConfig({ ...config, globalConcurrency: parseInt(e.target.value) || 1 })}
                  className="mt-1"
                />
                <p className="text-sm text-gray-500 mt-1">
                  所有用户的总并发任务数上限。自动根据CPU核心数优化：CPU核数 × 2（当前：{config.globalConcurrency}）
                </p>
              </div>

              {/* Per User Concurrency */}
              <div>
                <Label htmlFor="perUserConcurrency" className="text-sm font-medium text-gray-700">
                  单用户并发限制
                </Label>
                <Input
                  id="perUserConcurrency"
                  type="number"
                  min="1"
                  max="1000"
                  value={config.perUserConcurrency}
                  onChange={(e) => setConfig({ ...config, perUserConcurrency: parseInt(e.target.value) || 1 })}
                  className="mt-1"
                />
                <p className="text-sm text-gray-500 mt-1">
                  单个用户同时运行的任务数上限。自动计算：全局并发 ÷ 4（当前：{config.perUserConcurrency}）
                </p>
              </div>

              {/* Max Queue Size */}
              <div>
                <Label htmlFor="maxQueueSize" className="text-sm font-medium text-gray-700">
                  队列最大长度
                </Label>
                <Input
                  id="maxQueueSize"
                  type="number"
                  min="10"
                  max="10000"
                  value={config.maxQueueSize}
                  onChange={(e) => setConfig({ ...config, maxQueueSize: parseInt(e.target.value) || 10 })}
                  className="mt-1"
                />
                <p className="text-sm text-gray-500 mt-1">
                  等待队列中最多可容纳的任务数（默认：1000）
                </p>
              </div>

              {/* Task Timeout */}
              <div>
                <Label htmlFor="taskTimeout" className="text-sm font-medium text-gray-700">
                  任务超时时间（毫秒）
                </Label>
                <Input
                  id="taskTimeout"
                  type="number"
                  min="10000"
                  max="900000"
                  step="1000"
                  value={config.taskTimeout}
                  onChange={(e) => setConfig({ ...config, taskTimeout: parseInt(e.target.value) || 10000 })}
                  className="mt-1"
                />
                <p className="text-sm text-gray-500 mt-1">
                  单个任务的最大执行时间，超时后自动终止（默认：900000ms = 15分钟）
                </p>
              </div>

              {/* Enable Priority */}
              <div>
                <Label htmlFor="enablePriority" className="text-sm font-medium text-gray-700">
                  启用优先级队列
                </Label>
                <Select
                  value={config.enablePriority.toString()}
                  onValueChange={(value) => setConfig({ ...config, enablePriority: value === 'true' })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">是</SelectItem>
                    <SelectItem value="false">否</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-gray-500 mt-1">
                  是否启用任务优先级功能，高优先级任务优先执行
                </p>
              </div>

              {/* Default Max Retries (New Unified Queue Feature) */}
              <div>
                <Label htmlFor="defaultMaxRetries" className="text-sm font-medium text-gray-700">
                  默认最大重试次数
                </Label>
                <Input
                  id="defaultMaxRetries"
                  type="number"
                  min="0"
                  max="5"
                  value={config.defaultMaxRetries}
                  onChange={(e) => setConfig({ ...config, defaultMaxRetries: parseInt(e.target.value) || 0 })}
                  className="mt-1"
                />
                <p className="text-sm text-gray-500 mt-1">
                  任务失败后的最大重试次数（默认：3）
                </p>
              </div>

              {/* Retry Delay (New Unified Queue Feature) */}
              <div>
                <Label htmlFor="retryDelay" className="text-sm font-medium text-gray-700">
                  重试延迟（毫秒）
                </Label>
                <Input
                  id="retryDelay"
                  type="number"
                  min="1000"
                  max="60000"
                  step="1000"
                  value={config.retryDelay}
                  onChange={(e) => setConfig({ ...config, retryDelay: parseInt(e.target.value) || 1000 })}
                  className="mt-1"
                />
                <p className="text-sm text-gray-500 mt-1">
                  任务重试前的等待时间（默认：5000ms = 5秒）
                </p>
              </div>

              {/* Storage Type (Read-only, New Unified Queue Feature) */}
              <div>
                <Label className="text-sm font-medium text-gray-700">
                  队列存储类型
                </Label>
                <Input
                  type="text"
                  value={config.storageType === 'redis' ? 'Redis (持久化)' : '内存 (回退)'}
                  readOnly
                  className="mt-1 bg-gray-50"
                />
                <p className="text-sm text-gray-500 mt-1">
                  由环境变量 REDIS_URL 决定，不可修改
                </p>
              </div>
            </div>

            {/* Per-Type Concurrency Configuration (New Section) */}
            <div className="mt-8 pt-6 border-t border-gray-200">
              <h3 className="text-base font-semibold text-gray-900 mb-4">任务类型并发限制</h3>
              <p className="text-sm text-gray-500 mb-4">
                针对不同类型的任务设置独立的并发限制。系统会取三层限制（全局、用户、类型）中最严格的值。
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  ...Object.keys(TASK_TYPE_LABELS),
                  ...Object.keys(config.perTypeConcurrency).filter(type => !(type in TASK_TYPE_LABELS)).sort()
                ].map((type) => (
                  <div key={type} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1">
                      <Label className="text-sm font-medium text-gray-700">
                        {TASK_TYPE_LABELS[type] || type}
                      </Label>
                      <p className="text-xs text-gray-400">{type}</p>
                    </div>
                    <Input
                      type="number"
                      min="1"
                      max="1000"
                      value={config.perTypeConcurrency[type] ?? 2}
                      onChange={(e) => setConfig({
                        ...config,
                        perTypeConcurrency: {
                          ...config.perTypeConcurrency,
                          [type]: parseInt(e.target.value) || 1
                        }
                      })}
                      className="w-20 text-center"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Save Button */}
            <div className="mt-8 flex justify-end">
              <Button
                onClick={saveConfig}
                disabled={savingConfig}
                className="min-w-[120px]"
              >
                {savingConfig ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    保存中...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    保存配置
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Current Configuration Display */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">当前生效配置</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-600">全局并发限制</span>
                <span className="text-lg font-bold text-gray-900">{stats.config.globalConcurrency}</span>
              </div>
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-600">单用户并发限制</span>
                <span className="text-lg font-bold text-gray-900">{stats.config.perUserConcurrency}</span>
              </div>
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-600">队列最大长度</span>
                <span className="text-lg font-bold text-gray-900">{stats.config.maxQueueSize}</span>
              </div>
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-600">任务超时</span>
                <span className="text-lg font-bold text-gray-900">{Math.round(stats.config.taskTimeout / 1000)}s</span>
              </div>
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-600">优先级队列</span>
                <span className={`text-lg font-bold ${stats.config.enablePriority ? 'text-green-600' : 'text-gray-400'}`}>
                  {stats.config.enablePriority ? '已启用' : '已禁用'}
                </span>
              </div>
            </div>

            {/* Per-Type Concurrency Current Values */}
            {(() => {
              const perTypeConcurrency = stats.config.perTypeConcurrency
              if (!perTypeConcurrency) return null

              return (
                <div className="mt-6 pt-4 border-t border-gray-200">
                  <h3 className="text-sm font-medium text-gray-700 mb-3">任务类型并发限制</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
                    {[
                      ...Object.keys(TASK_TYPE_LABELS),
                      ...Object.keys(perTypeConcurrency).filter(type => !(type in TASK_TYPE_LABELS)).sort()
                    ].map((type) => (
                      <div key={type} className="flex items-center justify-between p-2 bg-gray-50 rounded text-sm">
                        <span className="text-gray-600 truncate" title={type}>
                          {TASK_TYPE_LABELS[type] || type}
                        </span>
                        <span className="font-bold text-gray-900 ml-2">{perTypeConcurrency[type] ?? 2}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      )}
    </div>
    </TooltipProvider>
  )
}
