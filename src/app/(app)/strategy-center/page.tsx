'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { showError, showSuccess, showWarning } from '@/lib/toast-utils'
import { Loader2, FlaskConical, RefreshCw } from 'lucide-react'

type StrategyRecommendationType =
  | 'adjust_cpc'
  | 'adjust_budget'
  | 'offline_campaign'
  | 'expand_keywords'
  | 'add_negative_keywords'
  | 'optimize_match_type'

type StrategyRecommendationStatus =
  | 'pending'
  | 'executed'
  | 'failed'
  | 'dismissed'
  | 'stale'

const STRATEGY_SETTING_KEYS = [
  'openclaw_strategy_enabled',
  'openclaw_strategy_cron',
  'feishu_app_id',
  'feishu_app_secret',
  'feishu_target',
] as const

type StrategySettingKey = (typeof STRATEGY_SETTING_KEYS)[number]

type SettingItem = {
  key: string
  value: string | null
  dataType: string
  description?: string | null
  isSensitive?: boolean
}

type StrategySettingsResponse = {
  success: boolean
  settings?: SettingItem[]
  error?: string
}

type StrategyRecommendation = {
  id: string
  reportDate?: string
  campaignId: number
  recommendationType: StrategyRecommendationType
  title: string
  summary?: string | null
  reason?: string | null
  priorityScore: number
  status: StrategyRecommendationStatus
  executedAt?: string | null
  executionResult?: {
    queued?: boolean
    queueTaskId?: string | null
    queueTaskStatus?: 'pending' | 'running' | 'completed' | 'failed' | 'unknown' | string
    queuedAt?: string | null
    queueUpdatedAt?: string | null
    queueRetryCount?: number
    queueTaskError?: string | null
    queueTaskCreatedAt?: string | null
    queueTaskStartedAt?: string | null
    error?: string | null
    postReviewTaskId?: string | null
    postReviewScheduledAt?: string | null
    postReview?: {
      status?: 'pending_window' | 'effective' | 'mixed' | 'ineffective' | 'no_data'
      reviewedAt?: string
    }
  } | null
  data?: {
    campaignName?: string
    runDays?: number
    impressions?: number
    clicks?: number
    cost?: number
    currency?: string | null
    ctrPct?: number
    cpc?: number
    roas?: number | null
    currentCpc?: number | null
    recommendedCpc?: number | null
    currentBudget?: number | null
    recommendedBudget?: number | null
    budgetType?: 'DAILY' | 'TOTAL'
    breakEvenConversionRatePct?: number | null
    breakEvenConversionRateByRecommendedCpcPct?: number | null
    commissionPerConversion?: number | null
    commissionLagProtected?: boolean
    estimatedCostSaving?: number
    estimatedRevenueUplift?: number
    estimatedNetImpact?: number
    impactWindowDays?: number
    impactConfidence?: 'low' | 'medium' | 'high'
    impactConfidenceReason?: string
    impactEstimationSource?: 'observed_roas' | 'fallback_lag_protected' | 'fallback_default'
    postReviewStatus?: 'pending_window' | 'effective' | 'mixed' | 'ineffective' | 'no_data'
    keywordCoverageCount?: number
    creativeQuality?: {
      headlineCount: number
      descriptionCount: number
      keywordCount: number
      level: 'high' | 'medium' | 'low'
    }
    analysisNote?: string
    keywordPlan?: Array<{ text: string; matchType: 'BROAD' | 'PHRASE' | 'EXACT' }>
    negativeKeywordPlan?: Array<{ text: string; matchType: 'BROAD' | 'PHRASE' | 'EXACT'; reason?: string }>
    matchTypePlan?: Array<{
      text: string
      currentMatchType: 'BROAD' | 'PHRASE' | 'EXACT'
      recommendedMatchType: 'BROAD' | 'PHRASE' | 'EXACT'
      clicks?: number
      conversions?: number
      cost?: number
    }>
    searchTermFeedback?: {
      hardNegativeTerms?: string[]
      softSuppressTerms?: string[]
      lookbackDays?: number
      dominantCurrency?: string
    }
    matchTypeReplaceMode?: 'none' | 'pause_existing'
  }
}

type StrategyRecommendationsResponse = {
  success: boolean
  reportDate?: string
  serverDate?: string
  historicalReadOnly?: boolean
  recommendations?: StrategyRecommendation[]
  trigger?: 'manual'
  reportSent?: boolean
  reportSendError?: string | null
  reportDeliveryTaskId?: string | null
  reportDeliveryMode?: 'queued' | string
  message?: string
  error?: string
  code?: string
}

type FeishuTestResponse = {
  success?: boolean
  ok?: boolean
  message?: string
  error?: string
}

type StrategyRecommendationStatusFilter =
  | 'actionable'
  | 'all'
  | 'queued'
  | 'pending'
  | 'executed'
  | 'failed'
  | 'dismissed'
  | 'stale'

type StrategyBatchAction = 'execute' | 'dismiss'
type StrategyBatchScope = 'filtered' | 'display'

type StrategyBatchFailure = {
  id: string
  action: StrategyBatchAction
  message: string
}

type StrategyConfirmTone = 'info' | 'warning' | 'danger'

type StrategyConfirmRequest = {
  title: string
  description: string
  details?: string[]
  confirmLabel?: string
  tone?: StrategyConfirmTone
  acknowledgeLabel?: string
}

type StrategyRecommendationExecuteDatePolicy = {
  allowed: boolean
  reason: 'same_day' | 't_minus_1_allowed' | 't_minus_1_type_blocked' | 'out_of_window' | 'unknown_date'
  reportDate: string
  serverDate: string
  tMinus1Date: string
}

const STRATEGY_SETTING_DEFAULTS: Record<StrategySettingKey, string> = {
  openclaw_strategy_enabled: 'false',
  openclaw_strategy_cron: '0 9 * * *',
  feishu_app_id: '',
  feishu_app_secret: '',
  feishu_target: '',
}

const SETTING_LABELS: Record<StrategySettingKey, string> = {
  openclaw_strategy_enabled: '启用自动分析',
  openclaw_strategy_cron: '分析频率',
  feishu_app_id: '飞书 App ID',
  feishu_app_secret: '飞书 App Secret',
  feishu_target: '飞书目标（open_id/union_id/chat_id）',
}

const OPENCLAW_TIMEZONE = 'Asia/Shanghai'

const STRATEGY_CRON_OPTIONS: Array<{ id: string; label: string; cron: string }> = [
  { id: 'daily_morning', label: '每天 09:00（推荐）', cron: '0 9 * * *' },
  { id: 'weekday_morning', label: '工作日 09:00', cron: '0 9 * * 1-5' },
  { id: 'every_6_hours', label: '每 6 小时', cron: '0 */6 * * *' },
  { id: 'hourly', label: '每小时', cron: '0 * * * *' },
  { id: 'custom', label: '自定义（保留历史值）', cron: '' },
]

const STRATEGY_T_MINUS_1_EXECUTABLE_TYPES = new Set<StrategyRecommendationType>([
  'adjust_cpc',
  'adjust_budget',
  'expand_keywords',
  'add_negative_keywords',
  'optimize_match_type',
])

const STRATEGY_T_MINUS_1_EXECUTABLE_TYPE_LABELS = 'CPC调整、预算调整、补充Search Terms关键词、新增否词、匹配类型优化'

function normalizeSettingMap(settings?: SettingItem[]): Record<StrategySettingKey, string> {
  const values: Record<StrategySettingKey, string> = { ...STRATEGY_SETTING_DEFAULTS }
  for (const item of settings || []) {
    if (!STRATEGY_SETTING_KEYS.includes(item.key as StrategySettingKey)) continue
    const key = item.key as StrategySettingKey
    values[key] = item.value ?? STRATEGY_SETTING_DEFAULTS[key]
  }
  return values
}

function parseLocalDate(value?: string | null): string {
  if (value) return value
  const now = new Date()
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: OPENCLAW_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function shiftOpenclawLocalIsoDate(dateText: string, offsetDays: number): string {
  const normalized = String(dateText || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return parseLocalDate()
  const [yearText, monthText, dayText] = normalized.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return parseLocalDate()
  }
  const baseMs = Date.UTC(year, month - 1, day, 12, 0, 0, 0)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: OPENCLAW_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(baseMs + offsetDays * 24 * 60 * 60 * 1000))
}

function resolveStrategyCronPreset(cron: string): string {
  const normalized = cron.trim().replace(/\s+/g, ' ')
  const matched = STRATEGY_CRON_OPTIONS.find((option) => option.id !== 'custom' && option.cron === normalized)
  return matched?.id || 'custom'
}

function normalizeCurrencyCode(value?: string | null): string {
  const normalized = String(value || '').trim().toUpperCase()
  return /^[A-Z]{3}$/.test(normalized) ? normalized : 'USD'
}

function formatNumber(value: unknown, digits = 2): string {
  if (value === null || value === undefined) return '--'
  if (typeof value === 'string' && value.trim() === '') return '--'
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '--'
  return parsed.toFixed(digits)
}

function formatMoney(value: unknown, currency?: string | null, digits = 2): string {
  if (value === null || value === undefined) return '--'
  if (typeof value === 'string' && value.trim() === '') return '--'
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '--'
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(parsed)
  return `${formatted} ${normalizeCurrencyCode(currency)}`
}

function formatTimestamp(value?: number | string | null): string {
  if (!value) return '未知'
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return '未知'
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function resolveImpactConfidenceText(value?: string | null): string {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'high') return '高'
  if (normalized === 'medium') return '中'
  return '低'
}

function resolveImpactEstimationSourceText(value?: string | null): string {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'observed_roas') return '估算口径：实测ROAS'
  if (normalized === 'fallback_lag_protected') return '估算口径：滞后保护回退'
  if (normalized === 'fallback_default') return '估算口径：默认回退'
  return ''
}

function resolveRecommendationTypeLabel(type: StrategyRecommendationType): string {
  if (type === 'adjust_cpc') return 'CPC调整'
  if (type === 'adjust_budget') return '预算调整'
  if (type === 'offline_campaign') return '下线Campaign'
  if (type === 'expand_keywords') return '补充Search Terms关键词'
  if (type === 'add_negative_keywords') return '新增否词'
  return '匹配类型优化'
}

function resolveRecommendationTypeTone(type: StrategyRecommendationType): string {
  if (type === 'offline_campaign') return 'border-rose-200 bg-rose-50 text-rose-700'
  if (type === 'adjust_budget') return 'border-sky-200 bg-sky-50 text-sky-700'
  if (type === 'adjust_cpc') return 'border-indigo-200 bg-indigo-50 text-indigo-700'
  if (type === 'expand_keywords') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (type === 'add_negative_keywords') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (type === 'optimize_match_type') return 'border-teal-200 bg-teal-50 text-teal-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function resolveRecommendationStatusBadge(status: StrategyRecommendationStatus): {
  label: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
} {
  if (status === 'executed') return { label: '已执行', variant: 'default' }
  if (status === 'failed') return { label: '执行失败', variant: 'destructive' }
  if (status === 'stale') return { label: '待重算', variant: 'secondary' }
  if (status === 'dismissed') return { label: '暂不执行', variant: 'outline' }
  return { label: '待执行', variant: 'outline' }
}

function isStrategyRecommendationQueued(item: StrategyRecommendation): boolean {
  const queueStatus = String(item.executionResult?.queueTaskStatus || '').toLowerCase()
  if (queueStatus === 'pending' || queueStatus === 'running') return true
  return item.executionResult?.queued === true
}

function isStrategyRecommendationExecutable(item: StrategyRecommendation): boolean {
  if (item.status === 'executed' || item.status === 'dismissed' || item.status === 'stale') {
    return false
  }
  return !isStrategyRecommendationQueued(item)
}

function resolveRecommendationExecuteDatePolicy(params: {
  recommendation: StrategyRecommendation
  serverDate: string
  fallbackReportDate?: string
}): StrategyRecommendationExecuteDatePolicy {
  const reportDate = String(params.recommendation.reportDate || params.fallbackReportDate || '').trim()
  const serverDate = String(params.serverDate || '').trim()
  const tMinus1Date = shiftOpenclawLocalIsoDate(serverDate, -1)

  if (!reportDate || !serverDate) {
    return {
      allowed: true,
      reason: 'unknown_date',
      reportDate,
      serverDate,
      tMinus1Date,
    }
  }

  if (reportDate === serverDate) {
    return {
      allowed: true,
      reason: 'same_day',
      reportDate,
      serverDate,
      tMinus1Date,
    }
  }

  if (reportDate === tMinus1Date) {
    if (STRATEGY_T_MINUS_1_EXECUTABLE_TYPES.has(params.recommendation.recommendationType)) {
      return {
        allowed: true,
        reason: 't_minus_1_allowed',
        reportDate,
        serverDate,
        tMinus1Date,
      }
    }
    return {
      allowed: false,
      reason: 't_minus_1_type_blocked',
      reportDate,
      serverDate,
      tMinus1Date,
    }
  }

  return {
    allowed: false,
    reason: 'out_of_window',
    reportDate,
    serverDate,
    tMinus1Date,
  }
}

function resolveRecommendationTypeRank(type: StrategyRecommendationType): number {
  if (type === 'offline_campaign') return 4
  if (type === 'adjust_budget') return 3
  if (type === 'add_negative_keywords') return 2.8
  if (type === 'optimize_match_type') return 2.6
  if (type === 'adjust_cpc') return 2
  return 1
}

function resolveRecommendationStatusRank(status: StrategyRecommendationStatus): number {
  if (status === 'pending') return 5
  if (status === 'failed') return 4.4
  if (status === 'stale') return 4
  if (status === 'dismissed') return 2
  return 1
}

function resolvePostReviewStatusText(status?: string | null): string {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'effective') return '复盘：有效'
  if (normalized === 'mixed') return '复盘：部分有效'
  if (normalized === 'ineffective') return '复盘：无效'
  if (normalized === 'no_data') return '复盘：样本不足'
  if (normalized === 'pending_window') return '复盘：观察中'
  return ''
}

export default function StrategyCenterPage() {
  const router = useRouter()

  const [settingsPanelOpen, setSettingsPanelOpen] = useState(true)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsValues, setSettingsValues] = useState<Record<StrategySettingKey, string>>({ ...STRATEGY_SETTING_DEFAULTS })
  const [settingsInitialValues, setSettingsInitialValues] = useState<Record<StrategySettingKey, string>>({ ...STRATEGY_SETTING_DEFAULTS })
  const [strategyCronPreset, setStrategyCronPreset] = useState('daily_morning')

  const [reportDate, setReportDate] = useState<string>(parseLocalDate())
  const [serverDate, setServerDate] = useState<string>(parseLocalDate())
  const [recommendationsLoading, setRecommendationsLoading] = useState(false)
  const [recommendationsLoaded, setRecommendationsLoaded] = useState(false)
  const [manualAnalyzing, setManualAnalyzing] = useState(false)
  const [recommendations, setRecommendations] = useState<StrategyRecommendation[]>([])

  const [strategyAnalyzeSendFeishu, setStrategyAnalyzeSendFeishu] = useState(true)
  const [recommendationsDisplayMode, setRecommendationsDisplayMode] = useState<'final' | 'all'>('final')
  const [recommendationStatusFilter, setRecommendationStatusFilter] = useState<StrategyRecommendationStatusFilter>('actionable')
  const [batchScope, setBatchScope] = useState<StrategyBatchScope>('filtered')
  const [selectedRecommendationIds, setSelectedRecommendationIds] = useState<string[]>([])
  const [batchExecuting, setBatchExecuting] = useState(false)
  const [batchDismissing, setBatchDismissing] = useState(false)
  const [batchLastAction, setBatchLastAction] = useState<StrategyBatchAction | null>(null)
  const [batchFailures, setBatchFailures] = useState<StrategyBatchFailure[]>([])

  const [executingId, setExecutingId] = useState<string | null>(null)
  const [dismissingId, setDismissingId] = useState<string | null>(null)
  const [detailItem, setDetailItem] = useState<StrategyRecommendation | null>(null)
  const [strategyConfirmDialog, setStrategyConfirmDialog] = useState<StrategyConfirmRequest | null>(null)
  const strategyConfirmResolverRef = useRef<((accepted: boolean) => void) | null>(null)
  const [strategyConfirmAcknowledge, setStrategyConfirmAcknowledge] = useState(false)

  const [testingFeishu, setTestingFeishu] = useState(false)
  const canRunFeishuConnectionTest = Boolean(
    settingsValues.feishu_app_id.trim()
      && settingsValues.feishu_app_secret.trim()
      && settingsValues.feishu_target.trim()
  )

  const settingsDirty = useMemo(
    () => STRATEGY_SETTING_KEYS.some((key) => settingsValues[key] !== settingsInitialValues[key]),
    [settingsValues, settingsInitialValues]
  )

  const strategyDisplayDate = String(reportDate || parseLocalDate()).trim() || parseLocalDate()
  const strategyServerDateDisplay = String(serverDate || parseLocalDate()).trim() || parseLocalDate()
  const strategyHistoricalReadOnly = Boolean(
    strategyDisplayDate
      && strategyServerDateDisplay
      && strategyDisplayDate < strategyServerDateDisplay
  )

  const strategyRecommendationActionBusy =
    manualAnalyzing
    || recommendationsLoading
    || executingId !== null
    || dismissingId !== null
    || batchExecuting
    || batchDismissing

  const resolveStrategyConfirmToneClasses = useCallback((tone?: StrategyConfirmTone) => {
    if (tone === 'danger') {
      return {
        panel: 'border-red-200 bg-red-50 text-red-900',
        detail: 'text-red-700',
        confirm: 'destructive' as const,
      }
    }
    if (tone === 'warning') {
      return {
        panel: 'border-amber-200 bg-amber-50 text-amber-900',
        detail: 'text-amber-700',
        confirm: 'default' as const,
      }
    }
    return {
      panel: 'border-sky-200 bg-sky-50 text-sky-900',
      detail: 'text-sky-700',
      confirm: 'default' as const,
    }
  }, [])

  const strategyConfirmToneClasses = useMemo(
    () => resolveStrategyConfirmToneClasses(strategyConfirmDialog?.tone),
    [strategyConfirmDialog?.tone, resolveStrategyConfirmToneClasses]
  )

  const closeStrategyConfirmDialog = useCallback((accepted: boolean) => {
    const resolver = strategyConfirmResolverRef.current
    strategyConfirmResolverRef.current = null
    setStrategyConfirmDialog(null)
    setStrategyConfirmAcknowledge(false)
    resolver?.(accepted)
  }, [])

  const requestStrategyConfirm = useCallback((request: StrategyConfirmRequest) => {
    if (strategyConfirmResolverRef.current) {
      strategyConfirmResolverRef.current(false)
      strategyConfirmResolverRef.current = null
    }
    setStrategyConfirmAcknowledge(false)
    setStrategyConfirmDialog(request)
    return new Promise<boolean>((resolve) => {
      strategyConfirmResolverRef.current = resolve
    })
  }, [])

  const loadSettings = async () => {
    setSettingsLoading(true)
    try {
      const response = await fetch('/api/strategy-center/settings', {
        credentials: 'include',
        cache: 'no-store',
      })
      if (response.status === 401) {
        router.push('/login')
        return
      }

      const data = await response.json().catch(() => ({})) as StrategySettingsResponse
      if (!response.ok || !data.success) {
        throw new Error(data.error || '加载策略中心配置失败')
      }

      const nextValues = normalizeSettingMap(data.settings)
      setSettingsValues(nextValues)
      setSettingsInitialValues(nextValues)
    } catch (error: any) {
      showError('加载失败', error?.message || '加载策略中心配置失败')
    } finally {
      setSettingsLoading(false)
    }
  }

  const loadRecommendations = useCallback(async (options?: {
    date?: string
    refresh?: boolean
    silent?: boolean
    syncDate?: boolean
    isActive?: () => boolean
  }) => {
    if (!options?.silent) {
      setRecommendationsLoading(true)
    }

    try {
      const targetDate = String(options?.date || reportDate || parseLocalDate()).trim() || parseLocalDate()
      const params = new URLSearchParams()
      params.set('date', targetDate)
      params.set('limit', '200')
      if (options?.refresh) {
        params.set('refresh', '1')
      }

      const response = await fetch(`/api/strategy-center/recommendations?${params.toString()}`, {
        credentials: 'include',
        cache: 'no-store',
      })
      if (response.status === 401) {
        router.push('/login')
        return
      }

      const data = await response.json().catch(() => ({})) as StrategyRecommendationsResponse
      if (!response.ok || !data.success) {
        throw new Error(data.error || '加载策略建议失败')
      }

      if (options?.isActive && !options.isActive()) return

      const nextRecommendations = Array.isArray(data.recommendations) ? data.recommendations : []
      setRecommendations(nextRecommendations)
      const nextServerDate = String(data.serverDate || '').trim() || parseLocalDate()
      const nextReportDate = String(data.reportDate || targetDate).trim() || targetDate
      setServerDate(nextServerDate)
      setReportDate((options?.syncDate ?? true) ? nextReportDate : (prev) => prev || nextReportDate)
      setRecommendationsLoaded(true)
    } catch (error: any) {
      if (options?.isActive && !options.isActive()) return
      if (!options?.silent) {
        showError('加载失败', error?.message || '加载策略建议失败')
      }
      setRecommendations([])
      setRecommendationsLoaded(true)
    } finally {
      if (options?.isActive && !options.isActive()) return
      if (!options?.silent) {
        setRecommendationsLoading(false)
      }
    }
  }, [reportDate, router])

  useEffect(() => {
    void loadSettings()
    void loadRecommendations({ date: reportDate, syncDate: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setStrategyCronPreset(resolveStrategyCronPreset(settingsValues.openclaw_strategy_cron || ''))
  }, [settingsValues.openclaw_strategy_cron])

  useEffect(() => {
    return () => {
      if (strategyConfirmResolverRef.current) {
        strategyConfirmResolverRef.current(false)
        strategyConfirmResolverRef.current = null
      }
    }
  }, [])

  const isStrategyRecommendationExecutableInCurrentWindow = useCallback((item: StrategyRecommendation) => {
    if (!isStrategyRecommendationExecutable(item)) return false
    const datePolicy = resolveRecommendationExecuteDatePolicy({
      recommendation: item,
      serverDate: strategyServerDateDisplay,
      fallbackReportDate: strategyDisplayDate,
    })
    return datePolicy.allowed
  }, [strategyDisplayDate, strategyServerDateDisplay])

  const recommendationsView = useMemo(() => {
    const source = Array.isArray(recommendations) ? recommendations : []
    return [...source].sort((a, b) => (Number(b.priorityScore) || 0) - (Number(a.priorityScore) || 0))
  }, [recommendations])

  const recommendationsFiltered = useMemo(() => {
    if (recommendationStatusFilter === 'actionable') {
      return recommendationsView.filter(
        (item) => item.status === 'pending'
          || item.status === 'failed'
          || item.status === 'stale'
      )
    }
    if (recommendationStatusFilter === 'all') {
      return recommendationsView
    }
    if (recommendationStatusFilter === 'queued') {
      return recommendationsView.filter((item) => isStrategyRecommendationQueued(item))
    }
    return recommendationsView.filter((item) => item.status === recommendationStatusFilter)
  }, [recommendationStatusFilter, recommendationsView])

  const recommendationsDisplay = useMemo(() => {
    if (recommendationsDisplayMode === 'all') {
      return recommendationsFiltered
    }

    const bestByCampaign = new Map<number, StrategyRecommendation>()
    for (const item of recommendationsFiltered) {
      const existing = bestByCampaign.get(item.campaignId)
      if (!existing) {
        bestByCampaign.set(item.campaignId, item)
        continue
      }

      const priorityDiff = (Number(item.priorityScore) || 0) - (Number(existing.priorityScore) || 0)
      if (priorityDiff > 0) {
        bestByCampaign.set(item.campaignId, item)
        continue
      }
      if (priorityDiff < 0) {
        continue
      }

      const typeDiff =
        resolveRecommendationTypeRank(item.recommendationType)
        - resolveRecommendationTypeRank(existing.recommendationType)
      if (typeDiff > 0) {
        bestByCampaign.set(item.campaignId, item)
        continue
      }
      if (typeDiff < 0) {
        continue
      }

      const statusDiff =
        resolveRecommendationStatusRank(item.status)
        - resolveRecommendationStatusRank(existing.status)
      if (statusDiff > 0) {
        bestByCampaign.set(item.campaignId, item)
      }
    }

    return Array.from(bestByCampaign.values())
      .sort((a, b) => (Number(b.priorityScore) || 0) - (Number(a.priorityScore) || 0))
  }, [recommendationsDisplayMode, recommendationsFiltered])

  const recommendationSummary = useMemo(() => {
    const summary = {
      total: recommendationsView.length,
      actionable: 0,
      queued: 0,
      executable: 0,
    }

    for (const item of recommendationsView) {
      if (
        item.status === 'pending'
        || item.status === 'failed'
        || item.status === 'stale'
      ) {
        summary.actionable += 1
      }

      if (isStrategyRecommendationQueued(item)) {
        summary.queued += 1
      }

      if (isStrategyRecommendationExecutableInCurrentWindow(item)) {
        summary.executable += 1
      }
    }

    return summary
  }, [isStrategyRecommendationExecutableInCurrentWindow, recommendationsView])

  const batchActionPool = useMemo(
    () => (batchScope === 'filtered' ? recommendationsFiltered : recommendationsDisplay),
    [batchScope, recommendationsDisplay, recommendationsFiltered]
  )

  const selectedRecommendationSet = useMemo(
    () => new Set(selectedRecommendationIds),
    [selectedRecommendationIds]
  )

  const selectableRecommendations = useMemo(
    () => batchActionPool.filter((item) => item.status !== 'executed'),
    [batchActionPool]
  )

  const selectedSelectableCount = selectableRecommendations.filter((item) => selectedRecommendationSet.has(item.id)).length
  const selectedVisibleCount = recommendationsDisplay.filter(
    (item) => selectedRecommendationSet.has(item.id) && item.status !== 'executed'
  ).length
  const selectedHiddenCount = Math.max(0, selectedSelectableCount - selectedVisibleCount)
  const selectedExecutableCount = batchActionPool.filter(
    (item) => selectedRecommendationSet.has(item.id)
      && isStrategyRecommendationExecutableInCurrentWindow(item)
  ).length
  const selectedDismissibleCount = batchActionPool.filter(
    (item) => selectedRecommendationSet.has(item.id)
      && (item.status === 'pending' || item.status === 'failed' || item.status === 'stale')
  ).length

  const recommendationsAllSelected = selectableRecommendations.length > 0
    && selectedSelectableCount === selectableRecommendations.length
  const recommendationsPartiallySelected = selectedSelectableCount > 0
    && selectedSelectableCount < selectableRecommendations.length

  useEffect(() => {
    const selectableIdSet = new Set(selectableRecommendations.map((item) => item.id))
    setSelectedRecommendationIds((prev) => prev.filter((id) => selectableIdSet.has(id)))
  }, [selectableRecommendations])

  const hasQueuedRecommendations = useMemo(
    () => recommendations.some((item) => isStrategyRecommendationQueued(item)),
    [recommendations]
  )

  const unknownQueueTaskCount = useMemo(
    () => recommendations.filter((item) => {
      const queueTaskId = String(item.executionResult?.queueTaskId || '').trim()
      if (!queueTaskId) return false
      return String(item.executionResult?.queueTaskStatus || '').trim().toLowerCase() === 'unknown'
    }).length,
    [recommendations]
  )

  useEffect(() => {
    if (!recommendationsLoaded || !hasQueuedRecommendations) {
      return
    }

    let active = true
    const timer = window.setInterval(() => {
      void loadRecommendations({
        refresh: false,
        silent: true,
        date: reportDate,
        syncDate: false,
        isActive: () => active,
      })
    }, 15000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [hasQueuedRecommendations, loadRecommendations, recommendationsLoaded, reportDate])

  const handleSaveSettings = async () => {
    if (settingsSaving) return
    setSettingsSaving(true)

    try {
      const updates = STRATEGY_SETTING_KEYS.map((key) => ({
        key,
        value: settingsValues[key] || '',
      }))
      const response = await fetch('/api/strategy-center/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ updates }),
      })
      if (response.status === 401) {
        router.push('/login')
        return
      }

      const data = await response.json().catch(() => ({})) as StrategySettingsResponse
      if (!response.ok || !data.success) {
        throw new Error(data.error || '保存策略中心配置失败')
      }

      setSettingsInitialValues({ ...settingsValues })
      showSuccess('保存成功', '策略中心配置已更新')
    } catch (error: any) {
      showError('保存失败', error?.message || '保存策略中心配置失败')
    } finally {
      setSettingsSaving(false)
    }
  }

  const handleStrategyCronPresetChange = (presetId: string) => {
    setStrategyCronPreset(presetId)
    const preset = STRATEGY_CRON_OPTIONS.find((option) => option.id === presetId)
    if (!preset || preset.id === 'custom') return
    setSettingsValues((prev) => ({ ...prev, openclaw_strategy_cron: preset.cron }))
  }

  const handleToggleSettingsPanel = () => {
    setSettingsPanelOpen((prev) => !prev)
  }

  const requestRecommendationAction = useCallback(async (
    recommendationId: string,
    action: 'execute' | 'dismiss',
    body?: Record<string, unknown>
  ) => {
    const response = await fetch(`/api/strategy-center/recommendations/${recommendationId}/${action}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    })
    const payload = await response.json().catch(() => null) as { success?: boolean; error?: string; deduplicated?: boolean } | null
    if (!response.ok || !payload?.success) {
      const fallbackMessage = action === 'execute' ? '执行建议失败' : '设置暂不执行失败'
      throw new Error(payload?.error || fallbackMessage)
    }
    return payload
  }, [])

  const handleManualAnalyze = async () => {
    if (manualAnalyzing || strategyRecommendationActionBusy) return

    const targetDate = String(reportDate || parseLocalDate()).trim() || parseLocalDate()
    const currentServerDate = String(serverDate || parseLocalDate()).trim() || parseLocalDate()
    if (targetDate < currentServerDate) {
      showError('操作受限', `历史日期 ${targetDate} 仅支持查看，请切换到 ${currentServerDate} 后重新分析`)
      return
    }

    if (recommendations.some((item) => item.status === 'pending' || item.status === 'failed' || item.status === 'stale')) {
      const confirmed = await requestStrategyConfirm({
        title: '确认重新分析',
        description: strategyAnalyzeSendFeishu
          ? '将重算当前日期建议，现有待执行/失败建议可能变化，并同时发送 Feishu 报告。'
          : '将重算当前日期建议，现有待执行/失败建议可能变化。',
        details: [
          `策略建议日期：${targetDate}`,
          strategyAnalyzeSendFeishu ? '报告投递：Feishu 已开启' : '报告投递：仅更新页面建议',
        ],
        confirmLabel: '继续分析',
        tone: 'warning',
      })
      if (!confirmed) return
    }

    setManualAnalyzing(true)
    setRecommendationsLoading(true)
    setBatchLastAction(null)
    setBatchFailures([])

    try {
      if (!strategyAnalyzeSendFeishu) {
        await loadRecommendations({
          refresh: true,
          date: targetDate,
          syncDate: true,
        })
        setSelectedRecommendationIds([])
        showSuccess('分析完成', '优化建议已更新')
      } else {
        const response = await fetch('/api/strategy-center/recommendations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ date: targetDate, limit: 200 }),
        })
        if (response.status === 401) {
          router.push('/login')
          return
        }

        const data = await response.json().catch(() => null) as StrategyRecommendationsResponse | null
        if (!response.ok || !data?.success) {
          throw new Error(data?.error || '手动触发分析失败')
        }

        setRecommendations(Array.isArray(data.recommendations) ? data.recommendations : [])
        setReportDate(String(data.reportDate || targetDate).trim() || targetDate)
        setServerDate(String(data.serverDate || parseLocalDate()).trim() || parseLocalDate())
        setRecommendationsLoaded(true)
        setSelectedRecommendationIds([])

        if (data.reportSent === false) {
          showWarning('分析完成', data.reportSendError || '优化建议已更新，但 Feishu 报告发送任务入队失败')
        } else {
          showSuccess('分析完成', '优化建议已更新，Feishu 报告已入队发送')
        }
      }
    } catch (error: any) {
      setRecommendationsLoaded(true)
      showError('触发失败', error?.message || '手动触发分析失败')
    } finally {
      setManualAnalyzing(false)
      setRecommendationsLoading(false)
    }
  }

  const handleExecuteRecommendation = async (item: StrategyRecommendation) => {
    if (!item?.id) return
    if (item.status === 'stale') {
      showError('执行失败', '建议内容已变化，请重新分析后再执行')
      return
    }
    if (item.status === 'dismissed') {
      showError('执行失败', '该建议已暂不执行，请重新分析后再执行')
      return
    }
    if (item.status === 'executed') {
      showError('执行失败', '建议已执行，无需重复执行')
      return
    }
    if (isStrategyRecommendationQueued(item)) {
      showError('执行失败', '建议已在执行队列中')
      return
    }
    if (!isStrategyRecommendationExecutable(item)) {
      showError('执行失败', '当前状态不支持执行该建议')
      return
    }

    const executeDatePolicy = resolveRecommendationExecuteDatePolicy({
      recommendation: item,
      serverDate: strategyServerDateDisplay,
      fallbackReportDate: strategyDisplayDate,
    })
    if (!executeDatePolicy.allowed) {
      if (executeDatePolicy.reason === 't_minus_1_type_blocked') {
        showError(
          '执行失败',
          `建议日期 ${executeDatePolicy.reportDate} 为 T-1（${executeDatePolicy.tMinus1Date}），仅支持执行类型：${STRATEGY_T_MINUS_1_EXECUTABLE_TYPE_LABELS}`
        )
      } else {
        showError(
          '执行失败',
          `建议日期 ${executeDatePolicy.reportDate || strategyDisplayDate} 不可执行，仅支持当天 ${executeDatePolicy.serverDate || strategyServerDateDisplay}，以及 T-1 ${executeDatePolicy.tMinus1Date} 的部分类型`
        )
      }
      return
    }

    const campaignName = item.data?.campaignName || `Campaign #${item.campaignId}`
    const typeLabel = resolveRecommendationTypeLabel(item.recommendationType)
    const confirmed = await requestStrategyConfirm({
      title: `确认执行「${typeLabel}」`,
      description: '执行后将直接写入 AutoAds / Google Ads，请确认当前建议已完成业务复核。',
      details: [
        `目标：${campaignName}`,
        `建议ID：${item.id}`,
      ],
      acknowledgeLabel: '我已确认：执行后将直接落地到投放系统',
      confirmLabel: '确认执行',
      tone: 'danger',
    })
    if (!confirmed) return

    setExecutingId(item.id)
    try {
      const payload = await requestRecommendationAction(item.id, 'execute', { confirm: true })
      if (payload?.deduplicated) {
        showSuccess('已提交', '建议已在执行队列中')
      } else {
        showSuccess('已提交', '建议已加入执行队列')
      }
      await loadRecommendations({ refresh: false, silent: true, date: reportDate, syncDate: false })
    } catch (error: any) {
      showError('执行失败', error?.message || '执行建议失败')
      await loadRecommendations({ refresh: false, silent: true, date: reportDate, syncDate: false })
    } finally {
      setExecutingId(null)
    }
  }

  const handleDismissRecommendation = async (item: StrategyRecommendation) => {
    if (!item?.id) return
    if (item.status === 'executed') {
      showError('操作失败', '已执行建议不支持暂不执行')
      return
    }

    const campaignName = item.data?.campaignName || `Campaign #${item.campaignId}`
    const confirmed = await requestStrategyConfirm({
      title: '确认暂不执行该建议',
      description: '暂不执行后该建议将不进入执行队列，可在后续重新分析后再次处理。',
      details: [
        `目标：${campaignName}`,
        `建议ID：${item.id}`,
      ],
      confirmLabel: '确认暂不执行',
      tone: 'info',
    })
    if (!confirmed) return

    setDismissingId(item.id)
    try {
      await requestRecommendationAction(item.id, 'dismiss')
      showSuccess('已更新', '建议已设为暂不执行')
      await loadRecommendations({ refresh: false, silent: true, date: reportDate, syncDate: false })
    } catch (error: any) {
      showError('操作失败', error?.message || '设置暂不执行失败')
    } finally {
      setDismissingId(null)
    }
  }

  const toggleRecommendationSelected = (recommendationId: string, checked: boolean) => {
    setSelectedRecommendationIds((prev) => {
      if (checked) {
        if (prev.includes(recommendationId)) return prev
        return [...prev, recommendationId]
      }
      return prev.filter((id) => id !== recommendationId)
    })
  }

  const handleSelectAllRecommendations = (checked: boolean) => {
    if (!checked) {
      setSelectedRecommendationIds([])
      return
    }
    setSelectedRecommendationIds(selectableRecommendations.map((item) => item.id))
  }

  const isRecommendationBatchEligible = (
    action: StrategyBatchAction,
    item: StrategyRecommendation
  ): boolean => {
    if (action === 'execute') {
      return isStrategyRecommendationExecutableInCurrentWindow(item)
    }
    return item.status === 'pending'
      || item.status === 'failed'
      || item.status === 'stale'
  }

  const runRecommendationBatchAction = async (
    action: StrategyBatchAction,
    options?: { targetIds?: string[] }
  ) => {
    const scopeLabel = Array.isArray(options?.targetIds) && options.targetIds.length > 0
      ? '失败项'
      : (batchScope === 'filtered' ? '当前筛选全部' : '当前展示')
    const targetIds = Array.isArray(options?.targetIds) && options.targetIds.length > 0
      ? options.targetIds
      : selectedRecommendationIds
    const selectedIdSet = new Set(targetIds)
    const selectedRows = batchActionPool.filter(
      (item) => selectedIdSet.has(item.id) && isRecommendationBatchEligible(action, item)
    )

    if (selectedRows.length === 0) {
      if (action === 'execute') {
        showError('批量执行失败', '所选建议中暂无可执行项')
      } else {
        showError('批量操作失败', '所选建议中暂无可设为暂不执行项')
      }
      return
    }

    if (action === 'execute') {
      const confirmed = await requestStrategyConfirm({
        title: `确认批量执行 ${selectedRows.length} 条建议`,
        description: '批量执行将直接写入 AutoAds / Google Ads，请确认筛选范围和条目数量。',
        details: [
          `范围：${scopeLabel}`,
          `条目数：${selectedRows.length}`,
        ],
        acknowledgeLabel: '我已确认：批量执行会直接落地到投放系统',
        confirmLabel: '确认批量执行',
        tone: 'danger',
      })
      if (!confirmed) return
    }

    if (action === 'dismiss') {
      const confirmed = await requestStrategyConfirm({
        title: `确认批量设为暂不执行 ${selectedRows.length} 条建议`,
        description: '设为暂不执行后这些建议将不会执行，可在后续重新分析后再次处理。',
        details: [
          `范围：${scopeLabel}`,
          `条目数：${selectedRows.length}`,
        ],
        confirmLabel: '确认批量暂不执行',
        tone: 'warning',
      })
      if (!confirmed) return
    }

    if (action === 'execute') setBatchExecuting(true)
    if (action === 'dismiss') setBatchDismissing(true)

    let successCount = 0
    const successIds: string[] = []
    const failed: StrategyBatchFailure[] = []

    try {
      for (const item of selectedRows) {
        try {
          await requestRecommendationAction(
            item.id,
            action,
            action === 'execute' ? { confirm: true } : undefined
          )
          successCount += 1
          successIds.push(item.id)
        } catch (error: any) {
          failed.push({
            id: item.id,
            action,
            message: error?.message || `${item.id} ${action} 失败`,
          })
        }
      }

      await loadRecommendations({
        refresh: false,
        silent: true,
        date: reportDate,
        syncDate: false,
      })

      setSelectedRecommendationIds((prev) => {
        const successSet = new Set(successIds)
        return prev.filter((id) => !successSet.has(id))
      })
      setBatchLastAction(action)
      setBatchFailures(failed)

      if (failed.length === 0) {
        if (action === 'execute') showSuccess('批量执行完成', `已入队 ${successCount} 条`) 
        if (action === 'dismiss') showSuccess('批量暂不执行完成', `已处理 ${successCount} 条`)
      } else {
        const label = action === 'execute' ? '执行' : '暂不执行'
        showWarning('批量处理完成', `批量${label}：成功 ${successCount}，失败 ${failed.length}（失败项已保留，可一键重试）`)
      }
    } finally {
      if (action === 'execute') setBatchExecuting(false)
      if (action === 'dismiss') setBatchDismissing(false)
    }
  }

  const handleBatchExecuteRecommendations = async () => {
    await runRecommendationBatchAction('execute')
  }

  const handleBatchDismissRecommendations = async () => {
    await runRecommendationBatchAction('dismiss')
  }

  const handleRetryFailedRecommendations = async () => {
    if (!batchLastAction || batchFailures.length === 0) {
      return
    }
    const retryIds = Array.from(new Set(batchFailures.map((item) => item.id)))
    setSelectedRecommendationIds(retryIds)
    await runRecommendationBatchAction(batchLastAction, { targetIds: retryIds })
  }

  const handleTestFeishu = async () => {
    if (testingFeishu) return
    setTestingFeishu(true)
    try {
      const response = await fetch('/api/strategy-center/feishu/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      })
      const data = await response.json().catch(() => ({})) as FeishuTestResponse
      if (!response.ok || data.ok !== true) {
        throw new Error(data.error || '飞书连通性测试失败')
      }
      showSuccess('测试通过', data.message || '飞书连通性正常')
    } catch (error: any) {
      showError('测试失败', error?.message || '飞书连通性测试失败')
    } finally {
      setTestingFeishu(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-[1440px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>策略中心</CardTitle>
            <CardDescription>已从 OpenClaw 拆分，权限与数据均按用户隔离。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                value={reportDate}
                onChange={(event) => setReportDate(event.target.value || parseLocalDate())}
                className="w-[180px]"
              />
              <Button
                variant="outline"
                onClick={() => loadRecommendations({ date: reportDate, syncDate: true })}
                disabled={recommendationsLoading || manualAnalyzing}
              >
                {recommendationsLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                加载建议
              </Button>
              <Badge variant="outline">服务器日期 {serverDate}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">策略与飞书配置</CardTitle>
                <CardDescription>
                  最小必填：飞书 App ID / App Secret / 推送目标。其余高级参数由系统统一托管。
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {settingsDirty && <Badge variant="outline">未保存</Badge>}
                <Button
                  variant="outline"
                  onClick={handleTestFeishu}
                  disabled={settingsLoading || testingFeishu || !canRunFeishuConnectionTest}
                  title={canRunFeishuConnectionTest ? undefined : '请先填写飞书 App ID / App Secret / 推送目标'}
                >
                  {testingFeishu ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4" />}
                  测试飞书连接
                </Button>
                <Button onClick={handleSaveSettings} disabled={settingsLoading || settingsSaving || !settingsDirty}>
                  {settingsSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  保存配置
                </Button>
                <Button variant="outline" size="sm" onClick={handleToggleSettingsPanel}>
                  {settingsPanelOpen ? '收起' : '展开'}
                </Button>
              </div>
            </div>
          </CardHeader>
          {settingsPanelOpen && (
            <CardContent>
              {settingsLoading ? (
                <div className="flex h-24 items-center justify-center rounded-md border text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  配置加载中...
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {STRATEGY_SETTING_KEYS.map((key) => {
                    const value = settingsValues[key] ?? ''
                    if (key === 'openclaw_strategy_enabled') {
                      return (
                        <div key={key} className="space-y-1.5 rounded-md border p-3">
                          <div className="text-sm font-medium">{SETTING_LABELS[key]}</div>
                          <Select
                            value={value || 'false'}
                            onValueChange={(nextValue) => setSettingsValues((prev) => ({ ...prev, [key]: nextValue }))}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="true">true</SelectItem>
                              <SelectItem value="false">false</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )
                    }

                    if (key === 'openclaw_strategy_cron') {
                      return (
                        <div key={key} className="space-y-1.5 rounded-md border p-3">
                          <div className="text-sm font-medium">{SETTING_LABELS[key]}</div>
                          <Select value={strategyCronPreset} onValueChange={handleStrategyCronPresetChange}>
                            <SelectTrigger>
                              <SelectValue placeholder="选择分析频率" />
                            </SelectTrigger>
                            <SelectContent>
                              {STRATEGY_CRON_OPTIONS.map((option) => (
                                <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {strategyCronPreset === 'custom' ? (
                            <div className="text-xs text-muted-foreground">
                              当前保留历史值：<code>{value || '--'}</code>
                            </div>
                          ) : null}
                        </div>
                      )
                    }

                    return (
                      <div key={key} className="space-y-1.5 rounded-md border p-3">
                        <div className="text-sm font-medium">{SETTING_LABELS[key]}</div>
                        <Input
                          type={key === 'feishu_app_secret' ? 'password' : 'text'}
                          value={value}
                          onChange={(event) => setSettingsValues((prev) => ({ ...prev, [key]: event.target.value }))}
                          autoComplete="off"
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          )}
        </Card>

        <Card className="overflow-hidden border-slate-200">
          <CardHeader className="gap-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-sky-50/40">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-1">
                <CardTitle className="text-xl">优化建议（按优先级分排序）</CardTitle>
                <CardDescription>每日自动生成，确认后可直接执行，执行结果直接落地 AutoAds / Google Ads</CardDescription>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
                    建议日期：{strategyDisplayDate}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
                    服务端日期：{strategyServerDateDisplay}
                  </span>
                </div>
              </div>
              <div className="flex w-full flex-col gap-3 rounded-xl border border-slate-200 bg-white/90 p-3 xl:w-auto xl:min-w-[280px]">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>分析后发送 Feishu</span>
                  <Switch
                    checked={strategyAnalyzeSendFeishu}
                    onCheckedChange={(checked) => setStrategyAnalyzeSendFeishu(Boolean(checked))}
                    disabled={manualAnalyzing || recommendationsLoading || strategyRecommendationActionBusy}
                  />
                </div>
                <Button
                  size="sm"
                  onClick={handleManualAnalyze}
                  disabled={manualAnalyzing || recommendationsLoading || strategyRecommendationActionBusy}
                >
                  {manualAnalyzing ? '分析中...' : '重新分析'}
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <div className="text-xs text-slate-500">总建议</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{recommendationSummary.total}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <div className="text-xs text-slate-500">待处理（待执行/执行失败/待重算）</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{recommendationSummary.actionable}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <div className="text-xs text-slate-500">排队执行中</div>
                <div className="mt-1 text-2xl font-semibold text-amber-700">{recommendationSummary.queued}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <div className="text-xs text-slate-500">当前可执行</div>
                <div className="mt-1 text-2xl font-semibold text-emerald-700">{recommendationSummary.executable}</div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-4 md:p-6">
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs text-slate-600">
              <div className="grid gap-2 md:grid-cols-2">
                <div>操作流程：重新分析 → 选择建议 → 执行（需二次确认），支持批量执行与批量暂不执行。</div>
                <div>下线建议默认执行：删除 Google Ads Campaign + 暂停补点击任务 + 暂停换链接任务。</div>
                <div>重新分析会重算建议；开启“分析后发送 Feishu”时，会同时入队发送最新报告。</div>
                <div>佣金口径：仅按 Offer/Campaign 级联盟佣金统计，不做关键词级佣金归因。</div>
                <div>优先级口径：优先级分用于排序；净影响为估算值，含低/中/高置信度。</div>
              </div>
              <div className="mt-2 text-slate-500">刷新建议会重新计算规则，旧建议可能被标记为“待重算”。</div>
              {strategyHistoricalReadOnly && (
                <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
                  历史日期默认仅支持查看与复盘；执行仅开放 T-1（{shiftOpenclawLocalIsoDate(strategyServerDateDisplay, -1)}）且限：{STRATEGY_T_MINUS_1_EXECUTABLE_TYPE_LABELS}。
                </div>
              )}
              {hasQueuedRecommendations && (
                <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
                  检测到执行队列任务，建议列表每 15 秒自动刷新一次。
                </div>
              )}
              {unknownQueueTaskCount > 0 && (
                <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
                  {unknownQueueTaskCount} 条建议的队列状态未知（任务可能已过期），可重新执行。
                </div>
              )}
            </div>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={recommendationsDisplayMode === 'final' ? 'default' : 'outline'}
                      onClick={() => setRecommendationsDisplayMode('final')}
                      disabled={strategyRecommendationActionBusy}
                    >
                      每 Campaign 仅显示最高优先级
                    </Button>
                    <Button
                      size="sm"
                      variant={recommendationsDisplayMode === 'all' ? 'default' : 'outline'}
                      onClick={() => setRecommendationsDisplayMode('all')}
                      disabled={strategyRecommendationActionBusy}
                    >
                      显示全部建议
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Select
                      value={recommendationStatusFilter}
                      onValueChange={(value) => setRecommendationStatusFilter(value as StrategyRecommendationStatusFilter)}
                    >
                      <SelectTrigger className="h-8 w-[176px]">
                        <SelectValue placeholder="状态筛选" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="actionable">待处理（待执行+执行失败+待重算）</SelectItem>
                        <SelectItem value="all">全部状态</SelectItem>
                        <SelectItem value="queued">排队执行中</SelectItem>
                        <SelectItem value="pending">待执行</SelectItem>
                        <SelectItem value="stale">待重算</SelectItem>
                        <SelectItem value="failed">执行失败</SelectItem>
                        <SelectItem value="executed">已执行</SelectItem>
                        <SelectItem value="dismissed">暂不执行</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={batchScope}
                      onValueChange={(value) => setBatchScope(value as StrategyBatchScope)}
                    >
                      <SelectTrigger className="h-8 w-[196px]">
                        <SelectValue placeholder="批量作用范围" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="filtered">批量范围：当前筛选全部</SelectItem>
                        <SelectItem value="display">批量范围：当前展示</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  当前 {recommendationsDisplayMode === 'final' ? '每个 Campaign 仅显示优先级最高建议' : '显示全部建议'}
                  {' · '}
                  展示 {recommendationsDisplay.length} / {recommendationsView.length} 条
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 xl:min-w-[360px]">
                <div className="text-xs text-slate-600">
                  已选 {selectedSelectableCount} 条
                  {selectedHiddenCount > 0 ? `（含当前未展示 ${selectedHiddenCount} 条）` : ''}
                  {' · '}
                  可执行 {selectedExecutableCount} / 可暂不执行 {selectedDismissibleCount}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={handleBatchExecuteRecommendations}
                    disabled={strategyRecommendationActionBusy || selectedExecutableCount === 0}
                  >
                    {batchExecuting ? '批量执行中...' : '批量执行'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleBatchDismissRecommendations}
                    disabled={strategyRecommendationActionBusy || selectedDismissibleCount === 0}
                  >
                    {batchDismissing ? '批量处理中...' : '批量暂不执行'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRetryFailedRecommendations}
                    disabled={strategyRecommendationActionBusy || batchFailures.length === 0}
                  >
                    重试失败项{batchFailures.length > 0 ? ` (${batchFailures.length})` : ''}
                  </Button>
                </div>
              </div>
            </div>

            {batchFailures.length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                最近失败（Top3）：
                {batchFailures.slice(0, 3).map((item, idx) => (
                  <span key={`${item.id}:${idx}`} className="ml-1">
                    [{item.id}] {item.message}
                  </span>
                ))}
              </div>
            )}

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <Table className="min-w-[1320px]">
                <TableHeader className="bg-slate-50/80">
                  <TableRow className="hover:bg-slate-50/80">
                    <TableHead className="w-[44px] text-xs font-semibold text-slate-600">
                      <Checkbox
                        checked={
                          recommendationsAllSelected
                            ? true
                            : recommendationsPartiallySelected
                              ? 'indeterminate'
                              : false
                        }
                        onCheckedChange={(checked) => handleSelectAllRecommendations(Boolean(checked))}
                        aria-label="全选策略建议"
                        disabled={strategyRecommendationActionBusy || selectableRecommendations.length === 0}
                      />
                    </TableHead>
                    <TableHead className="w-[52px] text-xs font-semibold text-slate-600">#</TableHead>
                    <TableHead className="min-w-[200px] text-xs font-semibold text-slate-600">类型 / ID</TableHead>
                    <TableHead className="min-w-[240px] text-xs font-semibold text-slate-600">建议</TableHead>
                    <TableHead className="min-w-[260px] text-xs font-semibold text-slate-600">Campaign</TableHead>
                    <TableHead className="min-w-[240px] text-xs font-semibold text-slate-600">成本/盈亏平衡</TableHead>
                    <TableHead className="min-w-[220px] text-xs font-semibold text-slate-600">优先级分</TableHead>
                    <TableHead className="min-w-[96px] text-xs font-semibold text-slate-600">状态</TableHead>
                    <TableHead className="min-w-[340px] text-left text-xs font-semibold text-slate-600">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recommendationsDisplay.map((item, index) => {
                    const isQueued = isStrategyRecommendationQueued(item)
                    const statusBadge = isQueued
                      ? { label: '排队中', variant: 'secondary' as const }
                      : resolveRecommendationStatusBadge(item.status)
                    const isExecuting = executingId === item.id
                    const isDismissing = dismissingId === item.id
                    const isSelectable = item.status !== 'executed'
                    const isChecked = selectedRecommendationSet.has(item.id)
                    const analysisNote = item.data?.analysisNote || item.reason || item.summary || '-'
                    const postReviewText = resolvePostReviewStatusText(
                      item.data?.postReviewStatus || item.executionResult?.postReview?.status || null
                    )
                    const recommendationCurrency = normalizeCurrencyCode(
                      item.data?.currency || item.data?.searchTermFeedback?.dominantCurrency || null
                    )
                    const costText = `花费 ${formatMoney(item.data?.cost, recommendationCurrency, 2)} / 点击 ${formatNumber(item.data?.clicks, 0)} / CTR ${formatNumber(item.data?.ctrPct, 2)}%`
                    const roasText = item.data?.roas !== null && item.data?.roas !== undefined
                      ? `ROAS ${formatNumber(item.data?.roas, 2)}`
                      : 'ROAS --'
                    const breakEvenText = item.data?.breakEvenConversionRatePct !== null && item.data?.breakEvenConversionRatePct !== undefined
                      ? `盈亏平衡转化率 ${formatNumber(item.data?.breakEvenConversionRatePct, 2)}%`
                      : '盈亏平衡转化率 --'
                    const impactWindowDays = Number(item.data?.impactWindowDays || 0)
                    const estimatedCostSaving = Number(item.data?.estimatedCostSaving || 0)
                    const estimatedRevenueUplift = Number(item.data?.estimatedRevenueUplift || 0)
                    const estimatedNetImpact = Number(item.data?.estimatedNetImpact || (estimatedCostSaving + estimatedRevenueUplift))
                    const hasImpact = Number.isFinite(estimatedNetImpact) && impactWindowDays > 0
                    const impactConfidenceText = resolveImpactConfidenceText(item.data?.impactConfidence)
                    const impactEstimationSourceText = resolveImpactEstimationSourceText(item.data?.impactEstimationSource)
                    const cpcAdjustText = item.recommendationType === 'adjust_cpc'
                      ? `CPC ${formatMoney(item.data?.currentCpc, recommendationCurrency, 2)} → ${formatMoney(item.data?.recommendedCpc, recommendationCurrency, 2)}`
                      : ''
                    const budgetAdjustText = item.recommendationType === 'adjust_budget'
                      ? `预算 ${formatMoney(item.data?.currentBudget, recommendationCurrency, 2)} → ${formatMoney(item.data?.recommendedBudget, recommendationCurrency, 2)} (${item.data?.budgetType || 'DAILY'})`
                      : ''
                    const keywordPlan = Array.isArray(item.data?.keywordPlan) ? item.data.keywordPlan : []
                    const negativeKeywordPlan = Array.isArray(item.data?.negativeKeywordPlan) ? item.data.negativeKeywordPlan : []
                    const matchTypePlan = Array.isArray(item.data?.matchTypePlan) ? item.data.matchTypePlan : []
                    const hardFeedbackTerms = Array.isArray(item.data?.searchTermFeedback?.hardNegativeTerms)
                      ? item.data?.searchTermFeedback?.hardNegativeTerms || []
                      : []
                    const softFeedbackTerms = Array.isArray(item.data?.searchTermFeedback?.softSuppressTerms)
                      ? item.data?.searchTermFeedback?.softSuppressTerms || []
                      : []
                    const keywordPlanText = item.recommendationType === 'expand_keywords'
                      ? `新增词 ${keywordPlan.length} 个（自动匹配类型）`
                      : ''
                    const negativeKeywordPlanText = item.recommendationType === 'add_negative_keywords'
                      ? `否词 ${negativeKeywordPlan.length} 个（建议默认EXACT）`
                      : ''
                    const matchTypePlanText = item.recommendationType === 'optimize_match_type'
                      ? `匹配类型优化 ${matchTypePlan.length} 个（新增并暂停旧匹配类型）`
                      : ''
                    const hasRecommendationDetail = keywordPlan.length > 0 || negativeKeywordPlan.length > 0 || matchTypePlan.length > 0
                    const creativeQualityText = item.data?.creativeQuality
                      ? `创意 H${item.data.creativeQuality.headlineCount}/D${item.data.creativeQuality.descriptionCount}/K${item.data.creativeQuality.keywordCount} · ${item.data.creativeQuality.level.toUpperCase()}`
                      : ''
                    const queueRetryCount = Number(item.executionResult?.queueRetryCount)
                    const hasQueueRetryCount = Number.isFinite(queueRetryCount) && queueRetryCount >= 0
                    const recommendationTypeLabel = resolveRecommendationTypeLabel(item.recommendationType)
                    const recommendationTypeTone = resolveRecommendationTypeTone(item.recommendationType)

                    return (
                      <TableRow key={item.id} className="align-top hover:bg-slate-50/70">
                        <TableCell>
                          {isSelectable ? (
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={(checked) => toggleRecommendationSelected(item.id, Boolean(checked))}
                              aria-label={`选择建议 ${item.id}`}
                              disabled={strategyRecommendationActionBusy}
                            />
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </TableCell>
                        <TableCell className="pt-3 text-sm font-medium text-slate-500">{index + 1}</TableCell>
                        <TableCell className="space-y-2 pt-3">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${recommendationTypeTone}`}>
                            {recommendationTypeLabel}
                          </span>
                          <div className="text-xs text-slate-400">ID: {item.id}</div>
                        </TableCell>
                        <TableCell className="space-y-2 pt-3">
                          <div className="text-sm font-medium leading-5 text-slate-900">{item.title}</div>
                          <div className="text-xs leading-5 text-slate-600">{analysisNote}</div>
                          {item.data?.commissionLagProtected && (
                            <div className="text-xs text-amber-600">佣金滞后保护：投放≤3天无佣金按正常处理</div>
                          )}
                        </TableCell>
                        <TableCell className="space-y-1 pt-3">
                          <div className="text-sm font-medium text-slate-900">{item.data?.campaignName || `Campaign #${item.campaignId}`}</div>
                          <div className="text-xs text-slate-500">运行 {item.data?.runDays ?? '--'} 天</div>
                          {creativeQualityText && (
                            <div className="text-xs text-slate-500">{creativeQualityText}</div>
                          )}
                          {item.recommendationType === 'expand_keywords' && (
                            <div className="text-xs text-slate-500">现有关键词 {item.data?.keywordCoverageCount ?? 0} 个</div>
                          )}
                          {item.recommendationType === 'add_negative_keywords' && (
                            <div className="text-xs text-slate-500">
                              建议否词 {negativeKeywordPlan.length} 个
                              {hardFeedbackTerms.length > 0 ? ` · hard反馈 ${hardFeedbackTerms.length} 个` : ''}
                            </div>
                          )}
                          {item.recommendationType === 'optimize_match_type' && (
                            <div className="text-xs text-slate-500">
                              建议优化 {matchTypePlan.length} 个
                              {softFeedbackTerms.length > 0 ? ` · soft反馈 ${softFeedbackTerms.length} 个` : ''}
                            </div>
                          )}
                          {isQueued && (
                            <div className="text-xs text-amber-600">执行队列中（Task: {item.executionResult?.queueTaskId || '-'})</div>
                          )}
                          {isQueued && (
                            <div className="text-xs text-slate-500">
                              队列状态 {String(item.executionResult?.queueTaskStatus || 'pending')}
                              {item.executionResult?.queuedAt ? ` · 入队 ${formatTimestamp(item.executionResult.queuedAt)}` : ''}
                              {item.executionResult?.queueTaskCreatedAt ? ` · 创建 ${formatTimestamp(item.executionResult.queueTaskCreatedAt)}` : ''}
                              {item.executionResult?.queueTaskStartedAt ? ` · 开始 ${formatTimestamp(item.executionResult.queueTaskStartedAt)}` : ''}
                              {hasQueueRetryCount ? ` · 重试 ${queueRetryCount}` : ''}
                            </div>
                          )}
                          {item.executionResult?.queueTaskError && (
                            <div className="text-xs text-red-600" title={String(item.executionResult.queueTaskError)}>
                              队列错误：{String(item.executionResult.queueTaskError)}
                            </div>
                          )}
                          {item.executionResult?.postReviewTaskId && (
                            <div className="text-xs text-slate-500">
                              复盘任务 {String(item.executionResult.postReviewTaskId)}
                              {item.executionResult?.postReviewScheduledAt
                                ? ` · 计划 ${formatTimestamp(item.executionResult.postReviewScheduledAt)}`
                                : ''}
                            </div>
                          )}
                          {postReviewText && (
                            <div className="text-xs text-slate-500">{postReviewText}</div>
                          )}
                        </TableCell>
                        <TableCell className="space-y-1 pt-3 text-xs leading-5 text-slate-700">
                          <div>{costText}</div>
                          <div>{roasText}</div>
                          <div>{breakEvenText}</div>
                          {cpcAdjustText && <div>{cpcAdjustText}</div>}
                          {budgetAdjustText && <div>{budgetAdjustText}</div>}
                          {keywordPlanText && <div>{keywordPlanText}</div>}
                          {negativeKeywordPlanText && <div>{negativeKeywordPlanText}</div>}
                          {matchTypePlanText && <div>{matchTypePlanText}</div>}
                        </TableCell>
                        <TableCell className="space-y-1 pt-3">
                          <div className="text-lg font-semibold text-slate-900">{formatNumber(item.priorityScore, 1)}</div>
                          {hasImpact ? (
                            <div className="text-xs text-slate-500">
                              净影响(估) {formatMoney(estimatedNetImpact, recommendationCurrency, 2)} / {impactWindowDays}天 · 置信度 {impactConfidenceText}
                            </div>
                          ) : (
                            <div className="text-xs text-slate-500">净影响 --</div>
                          )}
                          <div className="text-xs text-slate-500">
                            节省 {formatMoney(estimatedCostSaving, recommendationCurrency, 2)} / 增益 {formatMoney(estimatedRevenueUplift, recommendationCurrency, 2)}
                          </div>
                          {item.data?.impactConfidenceReason && (
                            <div className="text-xs text-slate-500">{item.data.impactConfidenceReason}</div>
                          )}
                          {impactEstimationSourceText && (
                            <div className="text-xs text-slate-500">{impactEstimationSourceText}</div>
                          )}
                        </TableCell>
                        <TableCell className="w-[96px] max-w-[96px] space-y-1 pt-3">
                          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                          {item.status === 'stale' && (
                            <div className="text-xs text-amber-600">建议内容已变化，请重新分析后再执行</div>
                          )}
                          {isQueued && (
                            <div className="text-xs text-amber-600">排队执行中</div>
                          )}
                          {item.status === 'failed' && !isQueued && item.executionResult?.error && (
                            <div className="text-xs text-red-600" title={String(item.executionResult.error)}>
                              失败原因：{String(item.executionResult.error)}
                            </div>
                          )}
                          {item.executedAt && (
                            <div className="text-xs text-slate-500">{formatTimestamp(item.executedAt)}</div>
                          )}
                        </TableCell>
                        <TableCell className="min-w-[340px] pt-3 text-right">
                          <div className="flex flex-nowrap items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-3"
                              disabled={!hasRecommendationDetail}
                              onClick={() => setDetailItem(item)}
                            >
                              明细
                            </Button>
                            <Button
                              size="sm"
                              className="h-8 px-3"
                              disabled={
                                strategyRecommendationActionBusy
                                || isExecuting
                                || isDismissing
                                || !isStrategyRecommendationExecutableInCurrentWindow(item)
                              }
                              onClick={() => handleExecuteRecommendation(item)}
                            >
                              {isExecuting ? '执行中...' : '执行'}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-3"
                              disabled={
                                strategyRecommendationActionBusy
                                || isExecuting
                                || isDismissing
                                || item.status === 'executed'
                                || item.status === 'dismissed'
                              }
                              onClick={() => handleDismissRecommendation(item)}
                            >
                              {isDismissing ? '处理中...' : '暂不执行'}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {recommendationsDisplay.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-10 text-center text-slate-500">
                        {recommendationsLoading ? '策略建议生成中...' : '暂无策略建议'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <Dialog
              open={Boolean(detailItem)}
              onOpenChange={(open) => {
                if (!open) setDetailItem(null)
              }}
            >
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>建议执行明细</DialogTitle>
                  <DialogDescription>
                    {detailItem
                      ? `${resolveRecommendationTypeLabel(detailItem.recommendationType)} · ${detailItem.data?.campaignName || `Campaign #${detailItem.campaignId}`}`
                      : ''}
                  </DialogDescription>
                </DialogHeader>
                {detailItem && (
                  <div className="max-h-[65vh] space-y-4 overflow-y-auto text-sm">
                    {Array.isArray(detailItem.data?.keywordPlan) && detailItem.data.keywordPlan.length > 0 && (
                      <div className="space-y-2 rounded-md border p-3">
                        <div className="text-sm font-medium">
                          补充Search Terms关键词（{detailItem.data.keywordPlan.length}）
                        </div>
                        <div className="space-y-1 text-xs text-slate-600">
                          {detailItem.data.keywordPlan.slice(0, 30).map((kw, idx) => (
                            <div key={`kw:${kw.text}:${idx}`}>
                              {idx + 1}. {kw.text} [{kw.matchType}]
                            </div>
                          ))}
                          {detailItem.data.keywordPlan.length > 30 && (
                            <div>其余 {detailItem.data.keywordPlan.length - 30} 条已省略</div>
                          )}
                        </div>
                      </div>
                    )}
                    {Array.isArray(detailItem.data?.negativeKeywordPlan) && detailItem.data.negativeKeywordPlan.length > 0 && (
                      <div className="space-y-2 rounded-md border p-3">
                        <div className="text-sm font-medium">
                          否词建议（{detailItem.data.negativeKeywordPlan.length}）
                        </div>
                        <div className="space-y-1 text-xs text-slate-600">
                          {detailItem.data.negativeKeywordPlan.slice(0, 30).map((kw, idx) => (
                            <div key={`neg:${kw.text}:${idx}`}>
                              {idx + 1}. {kw.text} [{kw.matchType}]
                              {kw.reason ? ` · ${kw.reason}` : ''}
                            </div>
                          ))}
                          {detailItem.data.negativeKeywordPlan.length > 30 && (
                            <div>其余 {detailItem.data.negativeKeywordPlan.length - 30} 条已省略</div>
                          )}
                        </div>
                      </div>
                    )}
                    {Array.isArray(detailItem.data?.matchTypePlan) && detailItem.data.matchTypePlan.length > 0 && (
                      <div className="space-y-2 rounded-md border p-3">
                        <div className="text-sm font-medium">
                          匹配类型优化（{detailItem.data.matchTypePlan.length}）
                        </div>
                        <div className="space-y-1 text-xs text-slate-600">
                          {detailItem.data.matchTypePlan.slice(0, 30).map((kw, idx) => (
                            <div key={`mt:${kw.text}:${idx}`}>
                              {idx + 1}. {kw.text} [{kw.currentMatchType} → {kw.recommendedMatchType}]
                              {Number.isFinite(Number(kw.clicks)) ? ` · 点击 ${formatNumber(kw.clicks, 0)}` : ''}
                              {Number.isFinite(Number(kw.conversions)) ? ` · 转化 ${formatNumber(kw.conversions, 2)}` : ''}
                              {Number.isFinite(Number(kw.cost))
                                ? ` · 花费 ${formatMoney(kw.cost, detailItem.data?.currency || detailItem.data?.searchTermFeedback?.dominantCurrency, 2)}`
                                : ''}
                            </div>
                          ))}
                          {detailItem.data.matchTypePlan.length > 30 && (
                            <div>其余 {detailItem.data.matchTypePlan.length - 30} 条已省略</div>
                          )}
                        </div>
                      </div>
                    )}
                    {(
                      (Array.isArray(detailItem.data?.searchTermFeedback?.hardNegativeTerms)
                        && detailItem.data.searchTermFeedback.hardNegativeTerms.length > 0)
                      || (Array.isArray(detailItem.data?.searchTermFeedback?.softSuppressTerms)
                        && detailItem.data.searchTermFeedback.softSuppressTerms.length > 0)
                    ) && (
                      <div className="space-y-2 rounded-md border p-3">
                        <div className="text-sm font-medium">
                          搜索词反馈（近{detailItem.data?.searchTermFeedback?.lookbackDays || 14}天）
                        </div>
                        {Array.isArray(detailItem.data?.searchTermFeedback?.hardNegativeTerms)
                          && detailItem.data.searchTermFeedback.hardNegativeTerms.length > 0 && (
                            <div className="space-y-1 text-xs text-slate-600">
                              <div className="font-medium text-amber-700">
                                hard 词（建议优先否词）{detailItem.data.searchTermFeedback.hardNegativeTerms.length}
                              </div>
                              {detailItem.data.searchTermFeedback.hardNegativeTerms.slice(0, 30).map((term, idx) => (
                                <div key={`hard:${term}:${idx}`}>{idx + 1}. {term}</div>
                              ))}
                            </div>
                          )}
                        {Array.isArray(detailItem.data?.searchTermFeedback?.softSuppressTerms)
                          && detailItem.data.searchTermFeedback.softSuppressTerms.length > 0 && (
                            <div className="space-y-1 text-xs text-slate-600">
                              <div className="font-medium text-sky-700">
                                soft 词（建议弱化/收紧匹配）{detailItem.data.searchTermFeedback.softSuppressTerms.length}
                              </div>
                              {detailItem.data.searchTermFeedback.softSuppressTerms.slice(0, 30).map((term, idx) => (
                                <div key={`soft:${term}:${idx}`}>{idx + 1}. {term}</div>
                              ))}
                            </div>
                          )}
                      </div>
                    )}
                    {(!Array.isArray(detailItem.data?.keywordPlan) || detailItem.data.keywordPlan.length === 0)
                      && (!Array.isArray(detailItem.data?.negativeKeywordPlan) || detailItem.data.negativeKeywordPlan.length === 0)
                      && (!Array.isArray(detailItem.data?.matchTypePlan) || detailItem.data.matchTypePlan.length === 0)
                      && (!Array.isArray(detailItem.data?.searchTermFeedback?.hardNegativeTerms) || detailItem.data.searchTermFeedback.hardNegativeTerms.length === 0)
                      && (!Array.isArray(detailItem.data?.searchTermFeedback?.softSuppressTerms) || detailItem.data.searchTermFeedback.softSuppressTerms.length === 0) && (
                        <div className="text-xs text-slate-500">该建议暂无可展示的执行明细。</div>
                      )}
                  </div>
                )}
              </DialogContent>
            </Dialog>
            <Dialog
              open={Boolean(strategyConfirmDialog)}
              onOpenChange={(open) => {
                if (!open) closeStrategyConfirmDialog(false)
              }}
            >
              <DialogContent className="max-w-lg">
                <DialogHeader className="space-y-2">
                  <DialogTitle className="text-lg leading-6 sm:text-xl">
                    {strategyConfirmDialog?.title || '确认操作'}
                  </DialogTitle>
                  <DialogDescription className="text-sm leading-6 text-slate-600">
                    {strategyConfirmDialog?.description || ''}
                  </DialogDescription>
                </DialogHeader>
                {strategyConfirmDialog && (
                  <div className="space-y-4">
                    {Array.isArray(strategyConfirmDialog.details) && strategyConfirmDialog.details.length > 0 && (
                      <div className={`space-y-1.5 rounded-md border px-3 py-2.5 text-sm leading-6 ${strategyConfirmToneClasses.panel}`}>
                        {strategyConfirmDialog.details.map((item, idx) => (
                          <div key={`confirm-detail-${idx}`}>{item}</div>
                        ))}
                      </div>
                    )}
                    {strategyConfirmDialog.acknowledgeLabel && (
                      <label className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 ${strategyConfirmToneClasses.panel}`}>
                        <Checkbox
                          className="mt-1 h-4 w-4 shrink-0"
                          checked={strategyConfirmAcknowledge}
                          onCheckedChange={(checked) => setStrategyConfirmAcknowledge(Boolean(checked))}
                        />
                        <span className={`text-sm font-medium leading-6 ${strategyConfirmToneClasses.detail}`}>
                          {strategyConfirmDialog.acknowledgeLabel}
                        </span>
                      </label>
                    )}
                    <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
                      <Button
                        className="h-9 px-4"
                        variant="outline"
                        onClick={() => closeStrategyConfirmDialog(false)}
                      >
                        取消
                      </Button>
                      <Button
                        className="h-9 px-4"
                        variant={strategyConfirmToneClasses.confirm}
                        onClick={() => closeStrategyConfirmDialog(true)}
                        disabled={Boolean(strategyConfirmDialog.acknowledgeLabel) && !strategyConfirmAcknowledge}
                      >
                        {strategyConfirmDialog.confirmLabel || '确认'}
                      </Button>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
