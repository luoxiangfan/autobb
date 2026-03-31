'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ResponsivePagination } from '@/components/ui/responsive-pagination'
import { TrendChartDynamic } from '@/components/charts/dynamic'
import { toast } from 'sonner'
import { Eye } from 'lucide-react'
import { usePagination } from '@/hooks'
import { parseAiModelsJson, setAiModelsSelectedModel } from '@/lib/openclaw/ai-models'

type SettingItem = {
  key: string
  value: string | null
  dataType: string
  description?: string | null
  isSensitive?: boolean
}

type OpenclawSettingsResponse = {
  success: boolean
  isAdmin: boolean
  userId: number
  user: SettingItem[]
}

type TokenRecord = {
  id: number
  name: string | null
  status: string
  created_at: string
  last_used_at: string | null
}

type DailyReport = {
  date: string
  dateRange?: {
    startDate?: string
    endDate?: string
    days?: number
    isRange?: boolean
  }
  generatedAt: string
  summary?: any
  kpis?: any
  trends?: any
  roi?: any
  campaigns?: any
  budget?: any
  performance?: any
  actions?: any[]
  strategyRecommendations?: OpenclawStrategyRecommendation[]
  errors?: Array<{ source: string; message: string }>
}

type OpenclawStrategyRecommendation = {
  id: string
  reportDate?: string
  campaignId: number
  recommendationType:
    | 'adjust_cpc'
    | 'adjust_budget'
    | 'offline_campaign'
    | 'expand_keywords'
    | 'add_negative_keywords'
    | 'optimize_match_type'
  title: string
  summary?: string | null
  reason?: string | null
  priorityScore: number
  status: 'pending' | 'executed' | 'failed' | 'dismissed' | 'stale'
  executedAt?: string | null
  executionResult?: {
    queued?: boolean
    queueTaskId?: string | null
    queueTaskStatus?: 'pending' | 'running' | 'completed' | 'failed' | string
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
    postReviewSummary?: {
      reviewedAt?: string
      reviewWindowDays?: number
      after?: {
        observedDays?: number
      }
    }
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
  reportDate?: string | null
  serverDate?: string | null
  historicalReadOnly?: boolean
  code?: string
  recommendations?: OpenclawStrategyRecommendation[]
  trigger?: 'manual'
  reportSent?: boolean
  reportSendError?: string | null
  reportDeliveryTaskId?: string | null
  reportDeliveryMode?: 'queued' | string
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

type GatewayStatusResponse = {
  success: boolean
  fetchedAt?: string
  health?: any | null
  skills?: any | null
  errors?: string[]
  error?: string
}

type OpenclawAiAuthOverrideWarning = {
  providerId: string
  source: 'auth-profile' | 'env'
  sourceLabel?: string
  profileIds?: string[]
  authProfilesPath?: string
  envVar?: string
  message: string
  suggestion?: string
}

type OpenclawSettingsSaveResponse = {
  success?: boolean
  skippedKeys?: string[]
  aiAuthOverrideWarnings?: OpenclawAiAuthOverrideWarning[]
  error?: string
}

type OpenclawGatewayReloadResponse = {
  success?: boolean
  message?: string
  gatewayStatus?: GatewayStatusResponse
  aiAuthOverrideWarnings?: OpenclawAiAuthOverrideWarning[]
  error?: string
}

type GatewaySkillRow = {
  skill: any
  missingItems: string[]
  isReady: boolean
  status: {
    label: string
    variant: 'default' | 'secondary' | 'outline' | 'destructive'
  }
  installHint: string
}

type WorkspaceStatusFile = {
  name: string
  path: string
  exists: boolean
  size: number | null
  updatedAt: string | null
}

type WorkspaceStatusResponse = {
  success: boolean
  source?: 'runtime-config' | 'computed'
  runtimeWorkspaceDir?: string | null
  computedWorkspaceDir?: string
  workspaceDir?: string
  memoryDir?: string
  files?: WorkspaceStatusFile[]
  missingFiles?: string[]
  dailyMemoryPath?: string
  dailyMemoryExists?: boolean
  canReloadGateway?: boolean
  error?: string
}

type WorkspaceBootstrapResponse = {
  success: boolean
  changedFiles?: string[]
  status?: WorkspaceStatusResponse
  error?: string
}

type FeishuReceiveIdType = 'open_id' | 'union_id' | 'chat_id'

type FeishuVerifySessionState = {
  verificationId: string
  code: string
  expiresAt: number
  receiveIdType: FeishuReceiveIdType
  target: string
  expectedSenderOpenId: string
}

type FeishuVerifyResultState = {
  verified: boolean
  pending: boolean
  message: string
}

type FeishuChatHealthDecision = 'allowed' | 'blocked' | 'error'
type FeishuChatExecutionState =
  | 'not_applicable'
  | 'waiting'
  | 'missing'
  | 'pending_confirm'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'expired'
  | 'unknown'

type FeishuChatWorkflowState =
  | 'not_required'
  | 'running'
  | 'incomplete'
  | 'completed'
  | 'failed'
  | 'unknown'

type FeishuChatWorkflowStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'unknown'

type FeishuChatWorkflowStep = {
  key: string
  label: string
  status: FeishuChatWorkflowStepStatus
  detail: string
}

type FeishuChatHealthLogItem = {
  id: number
  userId: number
  accountId: string
  messageId: string | null
  chatId: string | null
  chatType: string | null
  messageType: string | null
  senderPrimaryId: string | null
  senderOpenId: string | null
  senderUnionId: string | null
  senderUserId: string | null
  senderCandidates: string[]
  decision: FeishuChatHealthDecision
  reasonCode: string
  reasonMessage: string | null
  messageText: string | null
  messageExcerpt: string
  messageTextLength: number
  metadata: Record<string, unknown> | null
  executionState: FeishuChatExecutionState
  executionRunId: string | null
  executionRunStatus: string | null
  executionRunCount: number
  executionRunCreatedAt: string | null
  executionDetail: string
  workflowState: FeishuChatWorkflowState
  workflowProgress: number
  workflowDetail: string
  workflowOfferId: number | null
  workflowSteps: FeishuChatWorkflowStep[]
  ageSeconds: number
  createdAt: string
}

type FeishuChatHealthResponse = {
  success: boolean
  rows: FeishuChatHealthLogItem[]
  stats: {
    total: number
    allowed: number
    blocked: number
    error: number
    execution: {
      linked: number
      completed: number
      inProgress: number
      waiting: number
      missing: number
      failed: number
      notApplicable: number
      unknown: number
    }
    workflow: {
      tracked: number
      completed: number
      running: number
      incomplete: number
      failed: number
      notRequired: number
      unknown: number
    }
  }
  windowHours: number
  retentionDays: number
  excerptLimit: number
  executionMissingSeconds: number
  limit: number
}

type OpenclawCommandRunStatus =
  | 'draft'
  | 'pending_confirm'
  | 'confirmed'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'expired'

type OpenclawCommandRiskLevel = 'low' | 'medium' | 'high' | 'critical'

type OpenclawCommandRunItem = {
  runId: string
  intent: string | null
  request: {
    method: string
    path: string
  }
  riskLevel: OpenclawCommandRiskLevel
  status: OpenclawCommandRunStatus
  confirmRequired: boolean
  confirmExpiresAt: string | null
  confirmStatus: string | null
  queueTaskId: string | null
  createdAt: string
  updatedAt: string
}

type OpenclawCommandRunsResponse = {
  success: boolean
  items: OpenclawCommandRunItem[]
  pagination?: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

const HIGH_RISK_COMMAND_LOOKBACK_DAYS = 7
const HIGH_RISK_COMMAND_PAGE_LIMIT = 10
const REPORT_TREND_RANGE_OPTIONS = [
  { days: 7, label: '过去7天（含今天）' },
  { days: 14, label: '过去14天（含今天）' },
  { days: 30, label: '过去30天（含今天）' },
] as const
const DEFAULT_REPORT_TREND_RANGE_DAYS = 30

const AI_MINIMAL_PLACEHOLDER = `{
  "providers": {
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "YOUR_API_KEY",
      "api": "openai-responses",
      "models": [
        { "id": "gpt-5-mini", "name": "GPT-5 Mini" }
      ]
    }
  }
}`

const STRATEGY_CRON_OPTIONS: Array<{ id: string; label: string; cron: string }> = [
  { id: 'daily_morning', label: '每天 09:00（推荐）', cron: '0 9 * * *' },
  { id: 'weekday_morning', label: '工作日 09:00', cron: '0 9 * * 1-5' },
  { id: 'every_6_hours', label: '每 6 小时', cron: '0 */6 * * *' },
  { id: 'hourly', label: '每小时', cron: '0 * * * *' },
  { id: 'custom', label: '自定义（保留历史值）', cron: '' },
]

const AI_GLOBAL_KEYS = [
  'ai_models_json',
  'openclaw_models_mode',
  'openclaw_models_bedrock_discovery_json',
] as const

const AI_GLOBAL_KEY_SET = new Set<string>([...AI_GLOBAL_KEYS])

const AI_GLOBAL_EDIT_KEYS = [
  'ai_models_json',
] as const

const FEISHU_CHAT_MINIMAL_USER_KEYS = [
  'feishu_app_id',
  'feishu_app_secret',
  'feishu_target',
  'feishu_accounts_json',
] as const

const FEISHU_CHAT_COMMUNICATION_USER_KEYS = [
  'feishu_domain',
  'feishu_bot_name',
  'feishu_auth_mode',
  'feishu_require_tenant_key',
  'feishu_strict_auto_bind',
] as const

const FEISHU_BASIC_EXAMPLE_VALUES: Record<string, string> = {
  feishu_app_id: 'cli_xxx',
  feishu_app_secret: 'app_secret_xxx',
  feishu_target: 'ou_xxx',
  feishu_domain: 'feishu',
  feishu_auth_mode: 'strict',
  feishu_require_tenant_key: 'true',
  feishu_strict_auto_bind: 'true',
}

const PARTNERBOOST_USER_KEYS = [
  'partnerboost_base_url',
  'partnerboost_products_country_code',
  'partnerboost_products_link_batch_size',
  'partnerboost_asin_link_batch_size',
  'partnerboost_request_delay_ms',
  'partnerboost_rate_limit_max_retries',
  'partnerboost_rate_limit_base_delay_ms',
  'partnerboost_rate_limit_max_delay_ms',
  'partnerboost_link_country_code',
  'partnerboost_link_uid',
] as const

const STRATEGY_MINIMAL_USER_KEYS = [
  'openclaw_strategy_enabled',
  'openclaw_strategy_cron',
] as const

const FEISHU_CHAT_USER_KEYS = [...FEISHU_CHAT_MINIMAL_USER_KEYS, ...FEISHU_CHAT_COMMUNICATION_USER_KEYS] as const

const USER_KEYS = new Set([
  ...AI_GLOBAL_KEYS,
  ...PARTNERBOOST_USER_KEYS,
  'partnerboost_products_page_size',
  'partnerboost_products_page',
  'partnerboost_products_default_filter',
  'partnerboost_products_brand_id',
  'partnerboost_products_sort',
  'partnerboost_products_asins',
  'partnerboost_products_relationship',
  'partnerboost_products_is_original_currency',
  'partnerboost_products_has_promo_code',
  'partnerboost_products_has_acc',
  'partnerboost_products_filter_sexual_wellness',
  'partnerboost_link_return_partnerboost_link',
  ...FEISHU_CHAT_USER_KEYS,
  ...STRATEGY_MINIMAL_USER_KEYS,
])

const USER_DEFAULT_VALUES: Record<string, string> = {
  feishu_domain: 'feishu',
  feishu_auth_mode: 'strict',
  feishu_require_tenant_key: 'true',
  feishu_strict_auto_bind: 'true',
  partnerboost_base_url: 'https://app.partnerboost.com',
  openclaw_strategy_enabled: 'false',
  openclaw_strategy_cron: '0 9 * * *',
}

const OPENCLAW_TIMEZONE = 'Asia/Shanghai'

const parseLocalDate = (value?: string | null) => {
  if (value) return value
  const now = new Date()
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: OPENCLAW_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return iso
}

const normalizeIsoDateText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  const raw = String(value).trim()
  if (!raw) return null
  const matched = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  return matched ? matched[1] : null
}

const resolveNormalizedReportDateRange = (startValue?: string | null, endValue?: string | null): {
  startDate: string
  endDate: string
  days: number
} => {
  const today = parseLocalDate()
  const endDate = normalizeIsoDateText(endValue) || today
  const startCandidate = normalizeIsoDateText(startValue) || endDate
  const startDate = startCandidate <= endDate ? startCandidate : endDate

  const startMs = Date.parse(`${startDate}T00:00:00.000Z`)
  const endMs = Date.parse(`${endDate}T00:00:00.000Z`)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return { startDate, endDate, days: 1 }
  }

  const days = Math.floor((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1
  return {
    startDate,
    endDate,
    days: Math.max(1, days),
  }
}

const isTruthy = (value?: string | null, fallback: boolean = false) => {
  if (value === null || value === undefined || value === '') return fallback
  const normalized = value.toLowerCase()
  return normalized === 'true' || normalized === '1'
}

const hasText = (value?: string | null) => Boolean(value && value.trim())

const normalizeFeishuId = (value?: string | null) => String(value || '').trim().replace(/^(feishu|lark):/i, '').toLowerCase()

function parseFeishuVerifyTarget(input?: string | null): {
  target: string
  receiveIdType: FeishuReceiveIdType
} | null {
  const raw = String(input || '').trim()
  if (!raw) return null

  const normalized = raw.replace(/^(feishu|lark):/i, '').trim()
  if (!normalized) return null

  const typed = normalized.match(/^(open_id|union_id|chat_id):(.+)$/i)
  if (typed) {
    const receiveIdType = typed[1].toLowerCase() as FeishuReceiveIdType
    const target = typed[2].trim()
    if (!target) return null
    return { target, receiveIdType }
  }

  if (normalized.startsWith('ou_')) return { target: normalized, receiveIdType: 'open_id' }
  if (normalized.startsWith('on_')) return { target: normalized, receiveIdType: 'union_id' }
  if (normalized.startsWith('oc_')) return { target: normalized, receiveIdType: 'chat_id' }

  return null
}

const resolveStrategyCronPreset = (cron: string) => {
  const normalized = cron.trim().replace(/\s+/g, ' ')
  const matched = STRATEGY_CRON_OPTIONS.find((option) => option.id !== 'custom' && option.cron === normalized)
  return matched?.id || 'custom'
}

const isLikelyCronExpression = (value: string) => {
  const parts = value.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const partPattern = /^(\*|\*\/\d+|\d+(?:-\d+)?(?:\/\d+)?|\d+(?:,\d+)+)$/
  return parts.every((part) => partPattern.test(part))
}

const formatTimestamp = (value?: number | string | null) => {
  if (!value) return '未知'
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return '未知'
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

const formatTimestampCompactLines = (value?: number | string | null): { date: string; time: string } => {
  if (!value) {
    return { date: '未知', time: '--:--:--' }
  }

  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return { date: '未知', time: '--:--:--' }
  }

  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')

  return {
    date: `${month}-${day}`,
    time: `${hours}:${minutes}:${seconds}`,
  }
}

const formatDuration = (ms?: number | null) => {
  if (!Number.isFinite(ms)) return '未知'
  if (ms === null || ms === undefined) return '未知'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  return `${hours}h`
}

const formatCountdown = (ms?: number | null) => {
  if (!Number.isFinite(ms) || ms === null || ms === undefined) return '未知'
  if (ms <= 0) return '已过期'
  const totalSeconds = Math.ceil(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}分${String(seconds).padStart(2, '0')}秒`
}

const formatNumber = (value: unknown, digits = 2): string => {
  if (value === null || value === undefined) return '--'
  if (typeof value === 'string' && value.trim() === '') return '--'
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '--'
  return parsed.toFixed(digits)
}

const normalizeCurrencyCode = (value?: string | null): string => {
  const normalized = String(value || '').trim().toUpperCase()
  return /^[A-Z]{3}$/.test(normalized) ? normalized : 'USD'
}

const formatMoney = (value: unknown, currency?: string | null, digits = 2): string => {
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

const formatMoneyWithUnit = (value: unknown, currency?: string | null, digits = 2): string => {
  if (value === null || value === undefined) return '--'
  if (typeof value === 'string' && value.trim() === '') return '--'
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '--'
  const normalized = String(currency || '').trim().toUpperCase()
  if (normalized === 'MIXED') {
    const formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(parsed)
    return `${formatted} MIXED`
  }
  return formatMoney(parsed, normalized || 'USD', digits)
}

const resolveImpactConfidenceText = (value?: string | null): string => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'high') return '高'
  if (normalized === 'medium') return '中'
  return '低'
}

const resolveImpactEstimationSourceText = (value?: string | null): string => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'observed_roas') return '估算口径：实测ROAS'
  if (normalized === 'fallback_lag_protected') return '估算口径：滞后保护回退'
  if (normalized === 'fallback_default') return '估算口径：默认回退'
  return ''
}

const resolveStrategyRecommendationTypeLabel = (type: OpenclawStrategyRecommendation['recommendationType']) => {
  if (type === 'adjust_cpc') return 'CPC调整'
  if (type === 'adjust_budget') return '预算调整'
  if (type === 'offline_campaign') return '下线Campaign'
  if (type === 'expand_keywords') return '补充Search Terms关键词'
  if (type === 'add_negative_keywords') return '新增否词'
  if (type === 'optimize_match_type') return '匹配类型优化'
  return type
}

const resolveStrategyRecommendationTypeTone = (type: OpenclawStrategyRecommendation['recommendationType']): string => {
  if (type === 'offline_campaign') return 'border-rose-200 bg-rose-50 text-rose-700'
  if (type === 'adjust_budget') return 'border-sky-200 bg-sky-50 text-sky-700'
  if (type === 'adjust_cpc') return 'border-indigo-200 bg-indigo-50 text-indigo-700'
  if (type === 'expand_keywords') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (type === 'add_negative_keywords') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (type === 'optimize_match_type') return 'border-teal-200 bg-teal-50 text-teal-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

const resolveStrategyRecommendationStatusBadge = (status: OpenclawStrategyRecommendation['status']) => {
  if (status === 'executed') return { label: '已执行', variant: 'default' as const }
  if (status === 'failed') return { label: '执行失败', variant: 'destructive' as const }
  if (status === 'stale') return { label: '待重算', variant: 'secondary' as const }
  if (status === 'dismissed') return { label: '暂不执行', variant: 'outline' as const }
  return { label: '待执行', variant: 'outline' as const }
}

const isStrategyRecommendationQueued = (item: OpenclawStrategyRecommendation): boolean => {
  const queueStatus = String(item.executionResult?.queueTaskStatus || '').toLowerCase()
  if (queueStatus === 'pending' || queueStatus === 'running') return true
  return item.executionResult?.queued === true
}

const STRATEGY_T_MINUS_1_EXECUTABLE_TYPES = new Set<OpenclawStrategyRecommendation['recommendationType']>([
  'adjust_cpc',
  'adjust_budget',
  'expand_keywords',
  'add_negative_keywords',
  'optimize_match_type',
])
const STRATEGY_T_MINUS_1_EXECUTABLE_TYPE_LABELS = 'CPC调整、预算调整、补充Search Terms关键词、新增否词、匹配类型优化'

const shiftOpenclawLocalIsoDate = (dateText: string, offsetDays: number): string => {
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

type StrategyRecommendationExecuteDatePolicy = {
  allowed: boolean
  reason: 'same_day' | 't_minus_1_allowed' | 't_minus_1_type_blocked' | 'out_of_window' | 'unknown_date'
  reportDate: string
  serverDate: string
  tMinus1Date: string
}

const resolveStrategyRecommendationExecuteDatePolicy = (params: {
  recommendation: OpenclawStrategyRecommendation
  serverDate: string
  fallbackReportDate?: string
}): StrategyRecommendationExecuteDatePolicy => {
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

const isStrategyRecommendationExecutable = (item: OpenclawStrategyRecommendation): boolean => {
  if (item.status === 'executed' || item.status === 'dismissed' || item.status === 'stale') {
    return false
  }
  return !isStrategyRecommendationQueued(item)
}

const resolvePostReviewStatusText = (status?: string | null) => {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'effective') return '复盘：有效'
  if (normalized === 'mixed') return '复盘：部分有效'
  if (normalized === 'ineffective') return '复盘：无效'
  if (normalized === 'no_data') return '复盘：样本不足'
  if (normalized === 'pending_window') return '复盘：观察中'
  return ''
}

const resolveStrategyRecommendationTypeRank = (type: OpenclawStrategyRecommendation['recommendationType']): number => {
  if (type === 'offline_campaign') return 4
  if (type === 'adjust_budget') return 3
  if (type === 'add_negative_keywords') return 2.8
  if (type === 'optimize_match_type') return 2.6
  if (type === 'adjust_cpc') return 2
  return 1
}

const resolveStrategyRecommendationStatusRank = (status: OpenclawStrategyRecommendation['status']): number => {
  if (status === 'pending') return 5
  if (status === 'failed') return 4.4
  if (status === 'stale') return 4
  if (status === 'dismissed') return 2
  return 1
}

const renderTriState = (value?: boolean | null) => {
  if (value === true) return '是'
  if (value === false) return '否'
  return '未知'
}

const resolveFeishuHealthDecisionBadge = (decision: FeishuChatHealthDecision): {
  label: string
  variant: 'default' | 'secondary' | 'outline' | 'destructive'
} => {
  if (decision === 'allowed') return { label: '放行', variant: 'default' }
  if (decision === 'blocked') return { label: '拦截', variant: 'outline' }
  return { label: '错误', variant: 'destructive' }
}

const resolveFeishuHealthSenderText = (row: FeishuChatHealthLogItem): string => {
  const candidates = [
    row.senderOpenId,
    row.senderPrimaryId,
    row.senderUnionId,
    row.senderUserId,
    ...(Array.isArray(row.senderCandidates) ? row.senderCandidates : []),
  ]

  const first = candidates
    .map((item) => String(item || '').trim())
    .find(Boolean)

  return first || '-'
}

const resolveFeishuExecutionBadge = (state: FeishuChatExecutionState): {
  label: string
  variant: 'default' | 'secondary' | 'outline' | 'destructive'
} => {
  if (state === 'completed') return { label: '已完成', variant: 'default' }
  if (state === 'running' || state === 'queued' || state === 'pending_confirm') {
    return { label: '执行中', variant: 'secondary' }
  }
  if (state === 'waiting') return { label: '等待落库', variant: 'outline' }
  if (state === 'missing') return { label: '断链', variant: 'destructive' }
  if (state === 'failed' || state === 'canceled' || state === 'expired') {
    return { label: '执行失败', variant: 'destructive' }
  }
  if (state === 'not_applicable') return { label: '不适用', variant: 'outline' }
  return { label: '未知', variant: 'outline' }
}

const resolveFeishuWorkflowBadge = (state: FeishuChatWorkflowState): {
  label: string
  variant: 'default' | 'secondary' | 'outline' | 'destructive'
} => {
  if (state === 'completed') return { label: '业务完成', variant: 'default' }
  if (state === 'running') return { label: '业务执行中', variant: 'secondary' }
  if (state === 'incomplete') return { label: '业务未完成', variant: 'destructive' }
  if (state === 'failed') return { label: '业务失败', variant: 'destructive' }
  if (state === 'not_required') return { label: '不跟踪', variant: 'outline' }
  return { label: '未知', variant: 'outline' }
}

const resolveCommandRiskBadge = (riskLevel: OpenclawCommandRiskLevel): {
  label: string
  variant: 'default' | 'secondary' | 'outline' | 'destructive'
} => {
  if (riskLevel === 'critical') return { label: 'critical', variant: 'destructive' }
  if (riskLevel === 'high') return { label: 'high', variant: 'destructive' }
  if (riskLevel === 'medium') return { label: 'medium', variant: 'secondary' }
  return { label: 'low', variant: 'outline' }
}

const resolveCommandConfirmStatusText = (status?: string | null): string => {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'pending') return '待确认'
  if (normalized === 'confirmed') return '已确认'
  if (normalized === 'canceled') return '已取消'
  if (normalized === 'expired') return '已过期'
  return normalized || '-'
}

const formatFeishuRunIdShort = (value?: string | null): string => {
  const text = String(value || '').trim()
  if (!text) return '-'
  if (text.length <= 12) return text
  return `${text.slice(0, 12)}...`
}

const formatAgeSeconds = (value?: number): string => {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 0) return '-'
  if (seconds < 60) return `${Math.floor(seconds)}s`

  const minutes = Math.floor(seconds / 60)
  const remainSeconds = Math.floor(seconds % 60)
  if (minutes < 60) return `${minutes}m${String(remainSeconds).padStart(2, '0')}s`

  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  return `${hours}h${String(remainMinutes).padStart(2, '0')}m`
}

const resolveRecentHighRiskCreatedAfter = (): string => {
  const lookbackMs = HIGH_RISK_COMMAND_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  return new Date(Date.now() - lookbackMs).toISOString()
}

export default function OpenClawPage() {
  const router = useRouter()
  const [settings, setSettings] = useState<OpenclawSettingsResponse | null>(null)
  const [userValues, setUserValues] = useState<Record<string, string>>({})
  const [savedUserValues, setSavedUserValues] = useState<Record<string, string>>({})
  const [tokens, setTokens] = useState<TokenRecord[]>([])
  const [newToken, setNewToken] = useState<string | null>(null)
  const [reportDate, setReportDate] = useState<string>(parseLocalDate())
  const [reportStartDate, setReportStartDate] = useState<string>(parseLocalDate())
  const [report, setReport] = useState<DailyReport | null>(null)
  const {
    currentPage: reportActionCurrentPage,
    pageSize: reportActionPageSize,
    setPage: setReportActionPage,
    setPageSize: setReportActionPageSize,
    offset: reportActionOffset,
    getTotalPages: getReportActionTotalPages,
    pageSizeOptions: reportActionPageSizeOptions,
  } = usePagination({ initialPageSize: 10 })
  const [loading, setLoading] = useState(true)
  const [savingUser, setSavingUser] = useState(false)
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatusResponse | null>(null)
  const [gatewayLoading, setGatewayLoading] = useState(false)
  const [gatewayReloading, setGatewayReloading] = useState(false)
  const [gatewaySkillsCollapsed, setGatewaySkillsCollapsed] = useState(true)
  const [gatewayShowAvailableOnly, setGatewayShowAvailableOnly] = useState(true)
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatusResponse | null>(null)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceBootstrapping, setWorkspaceBootstrapping] = useState(false)
  const workspaceAutoBootstrapTriedRef = useRef(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [strategyRecommendations, setStrategyRecommendations] = useState<OpenclawStrategyRecommendation[]>([])
  const [strategyRecommendationsLoaded, setStrategyRecommendationsLoaded] = useState(false)
  const [strategyRecommendationsLoading, setStrategyRecommendationsLoading] = useState(false)
  const [strategyManualTriggering, setStrategyManualTriggering] = useState(false)
  const [strategyAnalyzeSendFeishu, setStrategyAnalyzeSendFeishu] = useState(true)
  const [strategyRecommendationsReportDate, setStrategyRecommendationsReportDate] = useState<string>(parseLocalDate())
  const [strategyServerDate, setStrategyServerDate] = useState<string>(parseLocalDate())
  const [strategyRecommendationsDisplayMode, setStrategyRecommendationsDisplayMode] = useState<'final' | 'all'>('final')
  const [strategyRecommendationStatusFilter, setStrategyRecommendationStatusFilter] = useState<StrategyRecommendationStatusFilter>('actionable')
  const [strategyBatchScope, setStrategyBatchScope] = useState<StrategyBatchScope>('filtered')
  const [selectedStrategyRecommendationIds, setSelectedStrategyRecommendationIds] = useState<string[]>([])
  const [strategyBatchExecuting, setStrategyBatchExecuting] = useState(false)
  const [strategyBatchDismissing, setStrategyBatchDismissing] = useState(false)
  const [strategyBatchLastAction, setStrategyBatchLastAction] = useState<StrategyBatchAction | null>(null)
  const [strategyBatchFailures, setStrategyBatchFailures] = useState<StrategyBatchFailure[]>([])
  const [strategyRecommendationExecutingId, setStrategyRecommendationExecutingId] = useState<string | null>(null)
  const [strategyRecommendationDismissingId, setStrategyRecommendationDismissingId] = useState<string | null>(null)
  const [strategyRecommendationDetailItem, setStrategyRecommendationDetailItem] = useState<OpenclawStrategyRecommendation | null>(null)
  const [strategyConfirmDialog, setStrategyConfirmDialog] = useState<StrategyConfirmRequest | null>(null)
  const strategyConfirmResolverRef = useRef<((accepted: boolean) => void) | null>(null)
  const [strategyConfirmAcknowledge, setStrategyConfirmAcknowledge] = useState(false)
  const [strategyCronPreset, setStrategyCronPreset] = useState('daily_morning')
  const [feishuTestLoading, setFeishuTestLoading] = useState(false)
  const [feishuTestResult, setFeishuTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [feishuVerifyLoading, setFeishuVerifyLoading] = useState(false)
  const [feishuVerifyChecking, setFeishuVerifyChecking] = useState(false)
  const [feishuVerifySenderOpenId, setFeishuVerifySenderOpenId] = useState('')
  const [feishuVerifySession, setFeishuVerifySession] = useState<FeishuVerifySessionState | null>(null)
  const [feishuVerifyResult, setFeishuVerifyResult] = useState<FeishuVerifyResultState | null>(null)
  const [feishuVerifyNow, setFeishuVerifyNow] = useState<number>(Date.now())
  const [showFeishuAdvanced, setShowFeishuAdvanced] = useState(false)
  const [aiJsonError, setAiJsonError] = useState<string | null>(null)
  const [feishuHealthLoading, setFeishuHealthLoading] = useState(false)
  const [feishuHealthError, setFeishuHealthError] = useState<string | null>(null)
  const [feishuHealthData, setFeishuHealthData] = useState<FeishuChatHealthResponse | null>(null)
  const [feishuHealthDialogItem, setFeishuHealthDialogItem] = useState<FeishuChatHealthLogItem | null>(null)
  const [pendingCommandRuns, setPendingCommandRuns] = useState<OpenclawCommandRunItem[]>([])
  const [pendingCommandRunsLoading, setPendingCommandRunsLoading] = useState(false)
  const [pendingCommandRunsError, setPendingCommandRunsError] = useState<string | null>(null)
  const [pendingCommandRunsPage, setPendingCommandRunsPage] = useState(1)
  const [pendingCommandRunsTotal, setPendingCommandRunsTotal] = useState(0)
  const [pendingCommandRunsTotalPages, setPendingCommandRunsTotalPages] = useState(1)

  useEffect(() => {
    setStrategyCronPreset(resolveStrategyCronPreset(userValues.openclaw_strategy_cron || ''))
  }, [userValues.openclaw_strategy_cron])

  useEffect(() => {
    if (!feishuVerifySession) return
    const timer = window.setInterval(() => {
      setFeishuVerifyNow(Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [feishuVerifySession])

  useEffect(() => {
    setReportActionPage(1)
  }, [report?.date, report?.dateRange?.startDate, setReportActionPage])

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

  const showAiAuthOverrideWarnings = useCallback((warnings: OpenclawAiAuthOverrideWarning[] | undefined) => {
    if (!warnings || warnings.length === 0) {
      return
    }

    const first = warnings[0]
    const extraCount = warnings.length - 1
    const suffix = extraCount > 0 ? `，另有 ${extraCount} 个 provider 同样被覆盖` : ''
    toast.warning(`${first.message}${suffix}`)
    if (first.suggestion) {
      toast.message(first.suggestion)
    }
  }, [])

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

  useEffect(() => {
    return () => {
      if (strategyConfirmResolverRef.current) {
        strategyConfirmResolverRef.current(false)
        strategyConfirmResolverRef.current = null
      }
    }
  }, [])

  const loadFeishuHealthData = useCallback(async (silent: boolean = false) => {
    if (settings?.isAdmin !== true) return

    if (!silent) {
      setFeishuHealthLoading(true)
    }
    setFeishuHealthError(null)

    try {
      const response = await fetch('/api/openclaw/feishu/chat-health?limit=200', {
        credentials: 'include',
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || '加载飞书聊天链路健康数据失败')
      }

      setFeishuHealthData(payload as FeishuChatHealthResponse)
    } catch (error: any) {
      const message = error?.message || '加载飞书聊天链路健康数据失败'
      setFeishuHealthError(message)
    } finally {
      setFeishuHealthLoading(false)
    }
  }, [settings?.isAdmin])

  const loadStrategyRecommendations = useCallback(async (options?: {
    refresh?: boolean
    silent?: boolean
    date?: string
    syncReportDate?: boolean
    isActive?: () => boolean
  }) => {
    if (!options?.silent) {
      setStrategyRecommendationsLoading(true)
    }

    try {
      const strategyDate = String(options?.date || reportDate || parseLocalDate()).trim() || parseLocalDate()
      const query = new URLSearchParams({
        date: strategyDate,
        limit: '200',
      })
      if (options?.refresh) {
        query.set('refresh', '1')
      }
      const response = await fetch(`/api/openclaw/strategy/recommendations?${query.toString()}`, {
        credentials: 'include',
      })
      const payload = await response.json().catch(() => null) as StrategyRecommendationsResponse | null
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || '加载策略建议失败')
      }
      if (options?.isActive && !options.isActive()) return
      setStrategyRecommendations(Array.isArray(payload.recommendations) ? payload.recommendations : [])
      const serverDate = String(payload.serverDate || '').trim()
      if (serverDate) {
        setStrategyServerDate(serverDate)
      }
      const normalizedReportDate = String(payload.reportDate || strategyDate).trim() || strategyDate
      setStrategyRecommendationsReportDate(normalizedReportDate)
      if ((options?.syncReportDate ?? true) && normalizedReportDate !== reportDate) {
        setReportDate(normalizedReportDate)
      }
      setStrategyRecommendationsLoaded(true)
    } catch (error: any) {
      if (options?.isActive && !options.isActive()) return
      if (!options?.silent) {
        toast.error(error?.message || '加载策略建议失败')
      }
      setStrategyRecommendations([])
      setStrategyRecommendationsLoaded(true)
    } finally {
      if (options?.isActive && !options.isActive()) return
      if (!options?.silent) {
        setStrategyRecommendationsLoading(false)
      }
    }
  }, [reportDate])

  useEffect(() => {
    if (settings?.isAdmin !== true) {
      setFeishuHealthData(null)
      setFeishuHealthError(null)
      setFeishuHealthDialogItem(null)
      setFeishuHealthLoading(false)
      return
    }

    void loadFeishuHealthData(true)
  }, [settings?.isAdmin, loadFeishuHealthData])

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      try {
        const resolvedReportRange = resolveNormalizedReportDateRange(reportStartDate, reportDate)
        const reportQuery = new URLSearchParams({ date: resolvedReportRange.endDate })
        if (resolvedReportRange.startDate !== resolvedReportRange.endDate) {
          reportQuery.set('start_date', resolvedReportRange.startDate)
          reportQuery.set('end_date', resolvedReportRange.endDate)
        }
        if (resolvedReportRange.endDate === parseLocalDate()) {
          reportQuery.set('refresh', '1')
        }

        const strategyDate = resolvedReportRange.endDate
        const strategyQuery = new URLSearchParams({
          date: strategyDate,
          limit: '200',
        })

        const [settingsRes, tokensRes, reportRes, strategyRecommendationsRes] = await Promise.all([
          fetch('/api/openclaw/settings', { credentials: 'include' }),
          fetch('/api/openclaw/tokens', { credentials: 'include' }),
          fetch(`/api/openclaw/reports/daily?${reportQuery.toString()}`, { credentials: 'include' }),
          fetch(`/api/openclaw/strategy/recommendations?${strategyQuery.toString()}`, { credentials: 'include' }),
        ])

        if (settingsRes.status === 403) {
          toast.error('当前账号未开启 OpenClaw 功能')
          router.replace('/dashboard')
          return
        }

        if (!settingsRes.ok) {
          throw new Error('配置加载失败')
        }

        const settingsJson = await settingsRes.json() as OpenclawSettingsResponse
        const tokensJson = tokensRes.ok ? await tokensRes.json() : { tokens: [] }
        const reportJson = reportRes.ok ? await reportRes.json() : { report: null }
        const strategyRecommendationsJson = strategyRecommendationsRes.ok
          ? await strategyRecommendationsRes.json() as StrategyRecommendationsResponse
          : { success: false, recommendations: [] } as StrategyRecommendationsResponse

        if (!active) return

        setSettings(settingsJson)
        setTokens(tokensJson.tokens || [])
        setReport(reportJson.report || null)
        const normalizedReportDate = normalizeIsoDateText(reportJson?.report?.date) || ''
        const normalizedStartDateFromRange = normalizeIsoDateText(reportJson?.report?.dateRange?.startDate) || ''
        if (normalizedReportDate && normalizedReportDate !== reportDate) {
          setReportDate(normalizedReportDate)
        }
        if (normalizedStartDateFromRange && normalizedStartDateFromRange !== reportStartDate) {
          setReportStartDate(normalizedStartDateFromRange)
        } else if (normalizedReportDate && reportStartDate > normalizedReportDate) {
          setReportStartDate(normalizedReportDate)
        }
        setStrategyRecommendations(Array.isArray(strategyRecommendationsJson.recommendations) ? strategyRecommendationsJson.recommendations : [])
        setStrategyServerDate(
          String(strategyRecommendationsJson?.serverDate || '').trim() || parseLocalDate()
        )
        setStrategyRecommendationsReportDate(
          String(strategyRecommendationsJson?.reportDate || strategyDate).trim() || strategyDate
        )
        setStrategyRecommendationsLoaded(Boolean(strategyRecommendationsJson?.success))

        const userMap: Record<string, string> = {}
        settingsJson.user.forEach(item => {
          userMap[item.key] = item.value ?? ''
        })
        Object.entries(USER_DEFAULT_VALUES).forEach(([key, defaultValue]) => {
          const current = userMap[key]
          if (current === undefined || current === null || String(current).trim() === '') {
            userMap[key] = defaultValue
          }
        })

        setUserValues(userMap)
        setSavedUserValues(userMap)
      } catch (error: any) {
        if (!active) return
        toast.error(error?.message || 'OpenClaw 配置加载失败')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    loadGatewayStatus(false, () => active)
    loadWorkspaceStatus(false, () => active)
    return () => {
      active = false
    }
    // Keep this effect keyed to report date range/refreshKey only; expanding deps here can trigger
    // repeated initial-load loops due to function identity churn in local async loaders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportDate, reportStartDate, refreshKey])

  const handleSelectReportTrendRange = useCallback((days: number) => {
    const normalizedDays = REPORT_TREND_RANGE_OPTIONS.some((option) => option.days === days)
      ? days
      : DEFAULT_REPORT_TREND_RANGE_DAYS

    const endDate = parseLocalDate()
    const startDate = shiftOpenclawLocalIsoDate(endDate, -(normalizedDays - 1))
    setReportStartDate(startDate)
    setReportDate(endDate)
  }, [])

  const strategySaveKeys = [...STRATEGY_MINIMAL_USER_KEYS]

  const setUserValue = (key: string, value: string) => {
    setUserValues(prev => ({ ...prev, [key]: value }))
  }

  const hasUserDirtyFields = (keys: readonly string[]) => {
    const current = userValues
    const saved = savedUserValues
    return keys.some((key) => (current[key] ?? '') !== (saved[key] ?? ''))
  }

  const loadPendingCommandRuns = useCallback(async (options?: {
    silent?: boolean
    page?: number
    isActive?: () => boolean
  }) => {
    const silent = options?.silent === true
    const page = Number.isFinite(options?.page) && Number(options?.page) > 0
      ? Math.floor(Number(options?.page))
      : 1
    const isActive = options?.isActive

    if (!silent) {
      setPendingCommandRunsLoading(true)
    }
    setPendingCommandRunsError(null)

    try {
      const query = new URLSearchParams({
        page: String(page),
        limit: String(HIGH_RISK_COMMAND_PAGE_LIMIT),
        riskLevel: 'high_or_above',
        createdAfter: resolveRecentHighRiskCreatedAfter(),
      })
      const response = await fetch(`/api/openclaw/commands/runs?${query.toString()}`, {
        credentials: 'include',
      })
      const payload = await response.json().catch(() => null) as OpenclawCommandRunsResponse | null
      if (!response.ok || !payload?.success) {
        throw new Error((payload as any)?.error || '高风险命令记录加载失败')
      }

      if (isActive && !isActive()) return
      const items = Array.isArray(payload.items) ? payload.items : []
      const pagination = payload.pagination || null
      const total = Number(pagination?.total || items.length || 0)
      const totalPages = Math.max(1, Number(pagination?.totalPages || 1))
      const resolvedPage = Math.min(
        totalPages,
        Math.max(1, Number(pagination?.page || page))
      )

      setPendingCommandRuns(items)
      setPendingCommandRunsTotal(total)
      setPendingCommandRunsTotalPages(totalPages)
      setPendingCommandRunsPage((prev) => (prev === resolvedPage ? prev : resolvedPage))
    } catch (error: any) {
      if (isActive && !isActive()) return
      const message = error?.message || '高风险命令记录加载失败'
      setPendingCommandRunsError(message)
      if (!silent) {
        setPendingCommandRuns([])
        setPendingCommandRunsTotal(0)
        setPendingCommandRunsTotalPages(1)
      }
    } finally {
      if (isActive && !isActive()) return
      if (!silent) {
        setPendingCommandRunsLoading(false)
      }
    }
  }, [])

  const loadGatewayStatus = async (force = false, isActive?: () => boolean) => {
    setGatewayLoading(true)
    try {
      const response = await fetch(
        `/api/openclaw/gateway/status${force ? '?force=1' : ''}`,
        { credentials: 'include' }
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'Gateway 状态获取失败')
      }
      if (isActive && !isActive()) return
      setGatewayStatus(payload)
    } catch (error: any) {
      if (isActive && !isActive()) return
      setGatewayStatus({
        success: false,
        error: error?.message || 'Gateway 状态获取失败',
      })
    } finally {
      if (isActive && !isActive()) return
      setGatewayLoading(false)
    }
  }

  const loadWorkspaceStatus = async (force = false, isActive?: () => boolean) => {
    setWorkspaceLoading(true)
    try {
      const response = await fetch(
        `/api/openclaw/workspace/status${force ? '?force=1' : ''}`,
        { credentials: 'include' }
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'SOUL 工作区状态获取失败')
      }
      if (isActive && !isActive()) return

      const missingFiles = Array.isArray(payload?.missingFiles) ? payload.missingFiles.length : 0
      const missingDailyMemory = payload?.dailyMemoryExists === false
      const needsBootstrap = payload?.success && (missingFiles > 0 || missingDailyMemory)

      if (!force && needsBootstrap && !workspaceAutoBootstrapTriedRef.current) {
        workspaceAutoBootstrapTriedRef.current = true
        setWorkspaceStatus(payload)
        await handleWorkspaceBootstrap({ silent: true })
        return
      }

      setWorkspaceStatus(payload)
    } catch (error: any) {
      if (isActive && !isActive()) return
      setWorkspaceStatus({
        success: false,
        error: error?.message || 'SOUL 工作区状态获取失败',
      })
    } finally {
      if (isActive && !isActive()) return
      setWorkspaceLoading(false)
    }
  }

  useEffect(() => {
    let active = true

    if (!settings?.userId) {
      setPendingCommandRuns([])
      setPendingCommandRunsError(null)
      setPendingCommandRunsLoading(false)
      setPendingCommandRunsPage(1)
      setPendingCommandRunsTotal(0)
      setPendingCommandRunsTotalPages(1)
      return () => {
        active = false
      }
    }

    void loadPendingCommandRuns({
      silent: false,
      page: pendingCommandRunsPage,
      isActive: () => active,
    })
    const timer = window.setInterval(() => {
      void loadPendingCommandRuns({
        silent: true,
        page: pendingCommandRunsPage,
        isActive: () => active,
      })
    }, 30000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [settings?.userId, refreshKey, pendingCommandRunsPage, loadPendingCommandRuns])

  const handleWorkspaceBootstrap = async (options?: { silent?: boolean }): Promise<boolean> => {
    const silent = options?.silent === true
    setWorkspaceBootstrapping(true)
    try {
      const response = await fetch('/api/openclaw/workspace/bootstrap', {
        method: 'POST',
        credentials: 'include',
      })
      const payload = (await response.json().catch(() => null)) as WorkspaceBootstrapResponse | null
      if (!response.ok) {
        throw new Error(payload?.error || 'SOUL 工作区补齐失败')
      }

      if (payload?.status && typeof payload.status === 'object') {
        setWorkspaceStatus(payload.status)
      } else {
        await loadWorkspaceStatus(true)
      }

      const changedCount = payload?.changedFiles?.length || 0
      if (!silent) {
        toast.success(changedCount > 0 ? `工作区已补齐（${changedCount} 个文件）` : '工作区已是最新状态')
      }
      return true
    } catch (error: any) {
      if (!silent) {
        toast.error(error?.message || 'SOUL 工作区补齐失败')
      }
      return false
    } finally {
      setWorkspaceBootstrapping(false)
    }
  }

  const handleWorkspaceBootstrapAndReload = async () => {
    if (settings?.isAdmin !== true) {
      toast.error('仅管理员可执行补齐并热加载')
      return
    }

    const bootstrapSuccess = await handleWorkspaceBootstrap()
    if (!bootstrapSuccess) {
      return
    }

    await handleGatewayHotReload()
  }

  const handleGatewayHotReload = async () => {
    if (settings?.isAdmin !== true) {
      toast.error('仅管理员可执行配置热加载')
      return
    }

    setGatewayReloading(true)
    try {
      const response = await fetch('/api/openclaw/gateway/reload', {
        method: 'POST',
        credentials: 'include',
      })
      const payload = (await response.json().catch(() => null)) as OpenclawGatewayReloadResponse | null
      if (!response.ok) {
        throw new Error(payload?.error || '配置热加载失败')
      }

      const nextGatewayStatus = payload?.gatewayStatus
      if (nextGatewayStatus && typeof nextGatewayStatus === 'object') {
        setGatewayStatus(nextGatewayStatus as GatewayStatusResponse)
      } else {
        await loadGatewayStatus(true)
      }

      toast.success(payload?.message || '配置已同步并触发 Gateway 热加载')
      showAiAuthOverrideWarnings(payload?.aiAuthOverrideWarnings)
    } catch (error: any) {
      toast.error(error?.message || '配置热加载失败')
    } finally {
      setGatewayReloading(false)
    }
  }

  const saveSettings = async (params: {
    scope: 'user' | 'global'
    keys?: string[]
    successMessage?: string
  }) => {
    const { scope, keys, successMessage } = params

    const normalizedUserValues: Record<string, string> = { ...userValues }

    const selectedKeySet = keys && keys.length > 0 ? new Set(keys) : null

    if (scope === 'user') {
      const isSavingStrategyMinimal = !selectedKeySet || STRATEGY_MINIMAL_USER_KEYS.some((key) => selectedKeySet.has(key))
      if (isSavingStrategyMinimal) {
        const cronValue = String(normalizedUserValues.openclaw_strategy_cron || '').trim() || USER_DEFAULT_VALUES.openclaw_strategy_cron
        if (!isLikelyCronExpression(cronValue)) {
          toast.error('Cron 表达式格式错误，请输入 5 段表达式（例如：0 9 * * *）')
          return
        }
        const strategyNormalizedPatch: Record<string, string> = {
          openclaw_strategy_cron: cronValue,
          openclaw_strategy_enabled: isTruthy(normalizedUserValues.openclaw_strategy_enabled, false) ? 'true' : 'false',
        }
        Object.assign(normalizedUserValues, strategyNormalizedPatch)
        setUserValues((prev) => ({ ...prev, ...strategyNormalizedPatch }))
      }

      const isSavingFeishuSettings = !selectedKeySet || FEISHU_CHAT_USER_KEYS.some((key) => selectedKeySet.has(key))
      if (isSavingFeishuSettings) {
        const hasAppSecret = hasText(normalizedUserValues.feishu_app_secret)
        if (!hasAppSecret) {
          toast.error('飞书 App Secret 为必填项')
          return
        }
      }

    }
    const updates = Object.entries(normalizedUserValues)
      .filter(([key]) => USER_KEYS.has(key))
      .filter(([key]) => !selectedKeySet || selectedKeySet.has(key))
      .filter(([key]) => (scope === 'global' ? AI_GLOBAL_KEY_SET.has(key) : !AI_GLOBAL_KEY_SET.has(key)))
      .map(([key, value]) => ({ key, value: value ?? '' }))
    const updateKeys = updates.map((item) => item.key)

    if (updates.length === 0) {
      toast.message('当前分区没有可保存的配置项')
      return
    }

    setSavingUser(true)
    try {
      const response = await fetch('/api/openclaw/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ scope, updates }),
      })
      const payload = (await response.json().catch(() => null)) as OpenclawSettingsSaveResponse | null

      if (!response.ok) {
        throw new Error(payload?.error || '保存失败')
      }

      setSavedUserValues((prev) => {
        const next = { ...prev }
        updateKeys.forEach((key) => {
          next[key] = normalizedUserValues[key] ?? ''
        })
        return next
      })

      toast.success(successMessage || '用户配置已保存')
      showAiAuthOverrideWarnings(payload?.aiAuthOverrideWarnings)
    } catch (error: any) {
      toast.error(error?.message || '保存失败')
    } finally {
      setSavingUser(false)
    }
  }

  const handleCreateToken = async () => {
    try {
      const response = await fetch('/api/openclaw/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: 'OpenClaw Access' }),
      })

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}))
        throw new Error(errorJson.error || '生成失败')
      }

      const result = await response.json()
      setTokens(prev => [result.record, ...prev])
      setNewToken(result.token)
      toast.success('OpenClaw Token 已生成')
    } catch (error: any) {
      toast.error(error?.message || '生成失败')
    }
  }

  const handleRevokeToken = async (id: number) => {
    try {
      const response = await fetch(`/api/openclaw/tokens/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}))
        throw new Error(errorJson.error || '撤销失败')
      }

      setTokens(prev => prev.filter(token => token.id !== id))
      toast.success('Token 已撤销')
    } catch (error: any) {
      toast.error(error?.message || '撤销失败')
    }
  }

  const handleStrategyCronPresetChange = (presetId: string) => {
    setStrategyCronPreset(presetId)
    const preset = STRATEGY_CRON_OPTIONS.find(option => option.id === presetId)
    if (!preset || preset.id === 'custom') return
    setUserValue('openclaw_strategy_cron', preset.cron)
  }

  const handleFeishuTestConnection = async () => {
    const appId = (userValues.feishu_app_id || '').trim()
    const appSecret = (userValues.feishu_app_secret || '').trim()
    const target = (userValues.feishu_target || '').trim()

    if (!appId) {
      toast.error('请先填写飞书 App ID')
      return
    }
    if (!appSecret) {
      toast.error('请先填写飞书 App Secret')
      return
    }
    if (!target) {
      toast.error('请先填写飞书推送目标')
      return
    }

    setFeishuTestLoading(true)
    setFeishuTestResult(null)
    try {
      const response = await fetch('/api/openclaw/feishu/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          appId,
          appSecret,
          domain: userValues.feishu_domain || 'feishu',
          target,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (response.ok && payload?.success) {
        setFeishuTestResult({ ok: true, message: payload?.message || 'Feishu 连接正常' })
      } else {
        setFeishuTestResult({ ok: false, message: payload?.error || '连接失败' })
      }
    } catch (error: any) {
      setFeishuTestResult({ ok: false, message: error?.message || '连接测试失败' })
    } finally {
      setFeishuTestLoading(false)
    }
  }

  const handleFeishuStartVerify = async () => {
    const appId = (userValues.feishu_app_id || '').trim()
    const appSecret = (userValues.feishu_app_secret || '').trim()
    const target = (userValues.feishu_target || '').trim()
    const expectedSenderOpenId = normalizeFeishuId(feishuVerifySenderOpenId)

    if (!appId) {
      toast.error('请先填写飞书 App ID')
      return
    }
    if (!appSecret) {
      toast.error('请先填写飞书 App Secret')
      return
    }
    if (!target) {
      toast.error('请先填写飞书推送目标')
      return
    }

    setFeishuVerifyLoading(true)
    setFeishuVerifyResult(null)

    try {
      const response = await fetch('/api/openclaw/feishu/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'start',
          appId,
          appSecret,
          domain: userValues.feishu_domain || 'feishu',
          target,
          expectedSenderOpenId: expectedSenderOpenId || undefined,
        }),
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.success || !payload?.verification?.verificationId) {
        const message = payload?.error || payload?.message || '发起双向通信验证失败'
        setFeishuVerifySession(null)
        setFeishuVerifyResult({ verified: false, pending: false, message })
        toast.error(message)
        return
      }

      const verification = payload.verification as FeishuVerifySessionState
      setFeishuVerifySession(verification)
      setFeishuVerifyNow(Date.now())
      setFeishuVerifySenderOpenId(verification.expectedSenderOpenId)
      setFeishuVerifyResult({
        verified: false,
        pending: true,
        message: payload?.message || '验证码已发送，请回复验证码后校验回执',
      })
      toast.success(payload?.message || '双向通信验证已发起')
    } catch (error: any) {
      const message = error?.message || '双向通信验证发起失败'
      setFeishuVerifySession(null)
      setFeishuVerifyResult({ verified: false, pending: false, message })
      toast.error(message)
    } finally {
      setFeishuVerifyLoading(false)
    }
  }

  const handleFeishuCheckVerify = async () => {
    if (!feishuVerifySession?.verificationId) {
      toast.error('请先点击“验证双向通信”发送验证码')
      return
    }

    setFeishuVerifyChecking(true)
    try {
      const response = await fetch('/api/openclaw/feishu/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'check',
          verificationId: feishuVerifySession.verificationId,
        }),
      })

      const payload = await response.json().catch(() => null)
      const message = payload?.message || payload?.error || '校验双向通信状态失败'
      const verified = Boolean(payload?.verified)
      const pending = Boolean(payload?.pending)

      setFeishuVerifyResult({
        verified,
        pending,
        message,
      })

      if (response.ok && verified) {
        toast.success(message)
        setFeishuVerifySession(null)
        return
      }

      if (response.ok && pending) {
        const expiresAt = Number(payload?.expiresAt)
        const expectedSenderOpenId = String(payload?.expectedSenderOpenId || '').trim()
        setFeishuVerifySession((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            expiresAt: Number.isFinite(expiresAt) ? expiresAt : prev.expiresAt,
            expectedSenderOpenId: expectedSenderOpenId || prev.expectedSenderOpenId,
          }
        })
        return
      }

      if (response.status === 404 || response.status === 410) {
        setFeishuVerifySession(null)
      }

      toast.error(message)
    } catch (error: any) {
      const message = error?.message || '校验双向通信状态失败'
      setFeishuVerifyResult({ verified: false, pending: false, message })
      toast.error(message)
    } finally {
      setFeishuVerifyChecking(false)
    }
  }

  const handleFormatAiJson = () => {
    const raw = userValues.ai_models_json || ''
    if (!raw.trim()) return
    try {
      const parsed = JSON.parse(raw)
      setUserValue('ai_models_json', JSON.stringify(parsed, null, 2))
      setAiJsonError(null)
    } catch (e: any) {
      setAiJsonError(e?.message || 'JSON 格式错误')
    }
  }

  const validateAiJson = (value: string): string | null => {
    return parseAiModelsJson(value).parseError
  }

  const aiModelsInfo = useMemo(
    () => parseAiModelsJson(userValues.ai_models_json || ''),
    [userValues.ai_models_json]
  )
  const aiModelOptions = aiModelsInfo.modelOptions
  const aiSelectedModelRef = aiModelsInfo.selectedModelRef
  const aiSelectedModelMeta = aiModelOptions.find((option) => option.modelRef === aiSelectedModelRef) || null

  const handleAiModelChange = (nextModelRef: string) => {
    const result = setAiModelsSelectedModel(userValues.ai_models_json || '', nextModelRef)
    if (result.error) {
      setAiJsonError(result.error)
      toast.error(result.error)
      return
    }

    setUserValue('ai_models_json', result.json)
    setAiJsonError(null)
  }

  const handleTriggerStrategyRecommendations = async () => {
    const targetDate = String(reportDate || strategyRecommendationsReportDate || parseLocalDate()).trim() || parseLocalDate()
    const currentServerDate = String(strategyServerDate || parseLocalDate()).trim() || parseLocalDate()
    const isHistoricalTriggerDate = targetDate < currentServerDate
    if (isHistoricalTriggerDate) {
      toast.error(`历史日期 ${targetDate} 仅支持查看，请切换到 ${currentServerDate} 后重新分析`)
      return
    }

    const hasReviewState = strategyRecommendations.some(
      (item) => item.status === 'pending' || item.status === 'failed' || item.status === 'stale'
    )
    if (hasReviewState) {
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
    setStrategyManualTriggering(true)
    setStrategyRecommendationsLoading(true)
    setStrategyBatchLastAction(null)
    setStrategyBatchFailures([])
    try {
      if (!strategyAnalyzeSendFeishu) {
        await loadStrategyRecommendations({
          refresh: true,
          date: targetDate,
          syncReportDate: true,
        })
        setSelectedStrategyRecommendationIds([])
        toast.success('分析完成，优化建议已更新')
      } else {
        const response = await fetch('/api/openclaw/strategy/recommendations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ date: targetDate, limit: 200 }),
        })
        const payload = await response.json().catch(() => null) as StrategyRecommendationsResponse | null
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error || '手动触发分析失败')
        }
        setStrategyRecommendations(Array.isArray(payload.recommendations) ? payload.recommendations : [])
        const serverDate = String(payload.serverDate || '').trim()
        if (serverDate) {
          setStrategyServerDate(serverDate)
        }
        const normalizedReportDate = String(payload.reportDate || targetDate).trim() || targetDate
        setStrategyRecommendationsReportDate(normalizedReportDate)
        if (normalizedReportDate !== reportDate) {
          setReportDate(normalizedReportDate)
        }
        setStrategyRecommendationsLoaded(true)
        setSelectedStrategyRecommendationIds([])
        if (payload.reportSent === false) {
          toast.warning(payload.reportSendError || '分析完成，但Feishu报告发送任务入队失败')
        } else {
          toast.success('分析完成，优化建议已更新，Feishu报告已入队发送')
        }
      }
    } catch (error: any) {
      setStrategyRecommendationsLoaded(true)
      toast.error(error?.message || '手动触发分析失败')
    } finally {
      setStrategyManualTriggering(false)
      setStrategyRecommendationsLoading(false)
    }
  }

  const handleExecuteStrategyRecommendation = async (recommendation: OpenclawStrategyRecommendation) => {
    if (!recommendation?.id) return
    if (recommendation.status === 'stale') {
      toast.error('建议内容已变化，请重新分析后再执行')
      return
    }
    if (recommendation.status === 'dismissed') {
      toast.error('该建议已暂不执行，请重新分析后再执行')
      return
    }
    if (recommendation.status === 'executed') {
      toast.error('建议已执行，无需重复执行')
      return
    }
    if (isStrategyRecommendationQueued(recommendation)) {
      toast.error('建议已在执行队列中')
      return
    }
    if (!isStrategyRecommendationExecutable(recommendation)) {
      toast.error('当前状态不支持执行该建议')
      return
    }
    const executeDatePolicy = resolveStrategyRecommendationExecuteDatePolicy({
      recommendation,
      serverDate: strategyServerDateDisplay,
      fallbackReportDate: strategyDisplayDate,
    })
    if (!executeDatePolicy.allowed) {
      if (executeDatePolicy.reason === 't_minus_1_type_blocked') {
        toast.error(
          `建议日期 ${executeDatePolicy.reportDate} 为 T-1（${executeDatePolicy.tMinus1Date}），仅支持执行类型：${STRATEGY_T_MINUS_1_EXECUTABLE_TYPE_LABELS}`
        )
      } else {
        toast.error(
          `建议日期 ${executeDatePolicy.reportDate || strategyDisplayDate} 不可执行，仅支持当天 ${executeDatePolicy.serverDate || strategyServerDateDisplay}，以及 T-1 ${executeDatePolicy.tMinus1Date} 的部分类型`
        )
      }
      return
    }

    const campaignName = recommendation.data?.campaignName || `Campaign #${recommendation.campaignId}`
    const typeLabel = resolveStrategyRecommendationTypeLabel(recommendation.recommendationType)
    const confirmed = await requestStrategyConfirm({
      title: `确认执行「${typeLabel}」`,
      description: '执行后将直接写入 AutoAds / Google Ads，请确认当前建议已完成业务复核。',
      details: [
        `目标：${campaignName}`,
        `建议ID：${recommendation.id}`,
      ],
      acknowledgeLabel: '我已确认：执行后将直接落地到投放系统',
      confirmLabel: '确认执行',
      tone: 'danger',
    })
    if (!confirmed) return

    setStrategyRecommendationExecutingId(recommendation.id)
    try {
      const payload = await requestStrategyRecommendationAction(recommendation.id, 'execute', { confirm: true })
      if (payload?.deduplicated) {
        toast.success('建议已在执行队列中')
      } else {
        toast.success('建议已加入执行队列')
      }
      await loadStrategyRecommendations({ refresh: false, silent: true, date: reportDate })
      setRefreshKey(prev => prev + 1)
    } catch (error: any) {
      toast.error(error?.message || '执行建议失败')
      await loadStrategyRecommendations({ refresh: false, silent: true, date: reportDate })
    } finally {
      setStrategyRecommendationExecutingId(null)
    }
  }

  const handleDismissStrategyRecommendation = async (recommendation: OpenclawStrategyRecommendation) => {
    if (!recommendation?.id) return
    if (recommendation.status === 'executed') {
      toast.error('已执行建议不支持暂不执行')
      return
    }
    const campaignName = recommendation.data?.campaignName || `Campaign #${recommendation.campaignId}`
    const confirmed = await requestStrategyConfirm({
      title: '确认暂不执行该建议',
      description: '暂不执行后该建议将不进入执行队列，可在后续重新分析后再次处理。',
      details: [
        `目标：${campaignName}`,
        `建议ID：${recommendation.id}`,
      ],
      confirmLabel: '确认暂不执行',
      tone: 'info',
    })
    if (!confirmed) return

    setStrategyRecommendationDismissingId(recommendation.id)
    try {
      await requestStrategyRecommendationAction(recommendation.id, 'dismiss')
      toast.success('建议已设为暂不执行')
      await loadStrategyRecommendations({ refresh: false, silent: true, date: reportDate })
    } catch (error: any) {
      toast.error(error?.message || '设置暂不执行失败')
    } finally {
      setStrategyRecommendationDismissingId(null)
    }
  }

  const strategyRecommendationActionBusy =
    strategyRecommendationExecutingId !== null
    || strategyRecommendationDismissingId !== null
    || strategyBatchExecuting
    || strategyBatchDismissing

  const requestStrategyRecommendationAction = useCallback(async (
    recommendationId: string,
    action: 'execute' | 'dismiss',
    body?: Record<string, unknown>
  ) => {
    const response = await fetch(`/api/openclaw/strategy/recommendations/${recommendationId}/${action}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.success) {
      const fallbackMessage = action === 'execute' ? '执行建议失败' : '设置暂不执行失败'
      throw new Error(payload?.error || fallbackMessage)
    }
    return payload
  }, [])

  const reportSummary = report?.summary?.kpis || {}
  const reportKpis = report?.kpis?.data || {}
  const reportRoi = report?.roi?.data?.overall || {}
  const reportRoiCurrencyRaw = String(report?.roi?.currency || '').trim().toUpperCase()
  const reportBudgetCurrencyRaw = String(report?.budget?.currency || '').trim().toUpperCase()
  const reportCostCurrency = reportRoiCurrencyRaw || reportBudgetCurrencyRaw || 'USD'
  const totalCost = Number(reportRoi.totalCost) || 0
  const totalRevenueRaw = reportRoi?.totalRevenue
  const totalRevenue = totalRevenueRaw === null || totalRevenueRaw === undefined
    ? null
    : Number(totalRevenueRaw)
  const roiRevenueAvailable = reportRoi?.revenueAvailable !== false
    && totalRevenue !== null
    && Number.isFinite(totalRevenue)
  const reportRoas = roiRevenueAvailable
    ? (reportRoi?.roas !== undefined
      ? (Number(reportRoi.roas) || 0)
      : (totalCost > 0 ? (totalRevenue || 0) / totalCost : 0))
    : null
  const roiRevenueSource = String(reportRoi.revenueSource || 'unavailable')
  const usingAffiliateCommissionRevenue = roiRevenueAvailable && roiRevenueSource === 'affiliate_commission'
  const roiUnavailableReason = String(reportRoi.unavailableReason || '')
  const affiliateRevenueBreakdown = Array.isArray(reportRoi.affiliateBreakdown)
    ? reportRoi.affiliateBreakdown as Array<{ platform?: string; totalCommission?: number; records?: number; currency?: string }>
    : []
  const affiliateRevenueCurrencies = Array.from(
    new Set(
      affiliateRevenueBreakdown
        .map((item) => String(item.currency || '').trim().toUpperCase())
        .filter((item) => /^[A-Z]{3}$/.test(item))
    )
  )
  const reportRevenueCurrency =
    affiliateRevenueCurrencies.length > 1
      ? 'MIXED'
      : (affiliateRevenueCurrencies[0] || reportCostCurrency)
  const revenueTitle = '佣金收入'
  const reportRevenueValue: string = roiRevenueAvailable
    ? formatMoneyWithUnit(totalRevenue || 0, reportRevenueCurrency)
    : '—'
  const reportCostValue: string = formatMoneyWithUnit(
    reportKpis.current?.cost ?? totalCost,
    reportCostCurrency
  )
  const reportRoasValue = roiRevenueAvailable && reportRoas !== null ? `${reportRoas.toFixed(2)}x` : '—'
  const reportRoiValue = roiRevenueAvailable && reportRoi.roi !== null && reportRoi.roi !== undefined
    ? `${reportRoi.roi}%`
    : '—'
  const reportProfitValue: string = roiRevenueAvailable && reportRoi.totalProfit !== null && reportRoi.totalProfit !== undefined
    ? formatMoneyWithUnit(reportRoi.totalProfit, reportRevenueCurrency === 'MIXED' ? 'MIXED' : reportCostCurrency)
    : '—'
  const roiUnavailableHint = roiUnavailableReason === 'affiliate_not_configured'
    ? '未配置联盟平台参数，严格模式下不回退 AutoAds 收益。'
    : '联盟平台佣金查询失败或暂无返回，严格模式下不回退 AutoAds 收益。'
  const offerRows = report?.roi?.data?.byOffer || []
  const topOfferRows = [...offerRows]
    .sort((a, b) => (Number(b.revenue) || 0) - (Number(a.revenue) || 0))
    .slice(0, 10)
  const normalizedReportRange = resolveNormalizedReportDateRange(reportStartDate, reportDate)
  const normalizedReportStartDateForTrend = normalizedReportRange.startDate
  const normalizedReportDateForTrend = normalizedReportRange.endDate
  const reportDateRangeDays = normalizedReportRange.days
  const trendData = useMemo(() => {
    const sourceRows = Array.isArray(report?.trends?.data?.trends)
      ? report.trends.data.trends
      : []
    if (sourceRows.length === 0) return []

    return sourceRows.filter((row: any) => {
      const date = normalizeIsoDateText(row?.date)
      if (!date) return false
      return date >= normalizedReportStartDateForTrend && date <= normalizedReportDateForTrend
    })
  }, [
    normalizedReportDateForTrend,
    normalizedReportStartDateForTrend,
    report?.trends?.data?.trends,
  ])
  const trendDescription = reportDateRangeDays <= 1
    ? `单日趋势（${normalizedReportDateForTrend}）`
    : `${normalizedReportStartDateForTrend} ~ ${normalizedReportDateForTrend}（${reportDateRangeDays}天）`
  const budgetOverall = report?.budget?.data?.overall || {}
  const budgetCurrency = reportBudgetCurrencyRaw || reportCostCurrency
  const budgetTotalValue = formatMoneyWithUnit(budgetOverall.totalBudget ?? 0, budgetCurrency)
  const budgetSpentValue = formatMoneyWithUnit(budgetOverall.totalSpent ?? 0, budgetCurrency)
  const budgetRemainingValue = formatMoneyWithUnit(budgetOverall.remaining ?? 0, budgetCurrency)
  const reportRoiCostValue = formatMoneyWithUnit(totalCost, reportCostCurrency)
  const campaignRows = report?.roi?.data?.byCampaign || []
  const topCampaigns = [...campaignRows]
    .sort((a, b) => {
      const revenueDiff = (Number(b.revenue) || 0) - (Number(a.revenue) || 0)
      if (revenueDiff !== 0) return revenueDiff
      return (Number(b.cost) || 0) - (Number(a.cost) || 0)
    })
    .slice(0, 5)
  const reportActions = useMemo(() => {
    if (!Array.isArray(report?.actions)) return []
    return report.actions
  }, [report?.actions])
  const reportActionTotalPages = getReportActionTotalPages(reportActions.length)
  const pagedReportActions = useMemo(() => {
    return reportActions.slice(reportActionOffset, reportActionOffset + reportActionPageSize)
  }, [reportActions, reportActionOffset, reportActionPageSize])

  useEffect(() => {
    if (reportActionTotalPages <= 0 && reportActionCurrentPage !== 1) {
      setReportActionPage(1)
      return
    }
    if (reportActionTotalPages > 0 && reportActionCurrentPage > reportActionTotalPages) {
      setReportActionPage(reportActionTotalPages)
    }
  }, [reportActionCurrentPage, reportActionTotalPages, setReportActionPage])

  const strategyDisplayDate = String(strategyRecommendationsReportDate || reportDate || parseLocalDate()).trim() || parseLocalDate()
  const strategyServerDateDisplay = String(strategyServerDate || parseLocalDate()).trim() || parseLocalDate()
  const strategyDateNormalized = Boolean(strategyDisplayDate && reportDate && strategyDisplayDate !== reportDate)
  const strategyHistoricalReadOnly = Boolean(
    strategyDisplayDate
    && strategyServerDateDisplay
    && strategyDisplayDate < strategyServerDateDisplay
  )
  const isStrategyRecommendationExecutableInCurrentWindow = useCallback((item: OpenclawStrategyRecommendation) => {
    if (!isStrategyRecommendationExecutable(item)) return false
    const datePolicy = resolveStrategyRecommendationExecuteDatePolicy({
      recommendation: item,
      serverDate: strategyServerDateDisplay,
      fallbackReportDate: strategyDisplayDate,
    })
    return datePolicy.allowed
  }, [strategyDisplayDate, strategyServerDateDisplay])
  const strategyRecommendationsView = useMemo(() => {
    const fromState = Array.isArray(strategyRecommendations) ? strategyRecommendations : []
    const fromReport = Array.isArray(report?.strategyRecommendations)
      ? report.strategyRecommendations as OpenclawStrategyRecommendation[]
      : []
    const source = strategyRecommendationsLoaded
      ? fromState
      : (fromState.length > 0 ? fromState : fromReport)
    return [...source].sort((a, b) => (Number(b.priorityScore) || 0) - (Number(a.priorityScore) || 0))
  }, [strategyRecommendations, strategyRecommendationsLoaded, report?.strategyRecommendations])
  const strategyRecommendationsFiltered = useMemo(() => {
    if (strategyRecommendationStatusFilter === 'actionable') {
      return strategyRecommendationsView.filter(
        (item) => item.status === 'pending'
          || item.status === 'failed'
          || item.status === 'stale'
      )
    }
    if (strategyRecommendationStatusFilter === 'all') {
      return strategyRecommendationsView
    }
    if (strategyRecommendationStatusFilter === 'queued') {
      return strategyRecommendationsView.filter((item) => isStrategyRecommendationQueued(item))
    }
    return strategyRecommendationsView.filter((item) => item.status === strategyRecommendationStatusFilter)
  }, [strategyRecommendationStatusFilter, strategyRecommendationsView])
  const strategyRecommendationsDisplay = useMemo(() => {
    if (strategyRecommendationsDisplayMode === 'all') {
      return strategyRecommendationsFiltered
    }

    const bestByCampaign = new Map<number, OpenclawStrategyRecommendation>()
    for (const item of strategyRecommendationsFiltered) {
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
        resolveStrategyRecommendationTypeRank(item.recommendationType)
        - resolveStrategyRecommendationTypeRank(existing.recommendationType)
      if (typeDiff > 0) {
        bestByCampaign.set(item.campaignId, item)
        continue
      }
      if (typeDiff < 0) {
        continue
      }

      const statusDiff =
        resolveStrategyRecommendationStatusRank(item.status)
        - resolveStrategyRecommendationStatusRank(existing.status)
      if (statusDiff > 0) {
        bestByCampaign.set(item.campaignId, item)
      }
    }

    return Array.from(bestByCampaign.values())
      .sort((a, b) => (Number(b.priorityScore) || 0) - (Number(a.priorityScore) || 0))
  }, [strategyRecommendationsDisplayMode, strategyRecommendationsFiltered])
  const strategyRecommendationSummary = useMemo(() => {
    const summary = {
      total: strategyRecommendationsView.length,
      pending: 0,
      executed: 0,
      failed: 0,
      dismissed: 0,
      stale: 0,
      actionable: 0,
      queued: 0,
      executable: 0,
    }

    for (const item of strategyRecommendationsView) {
      if (item.status === 'pending') summary.pending += 1
      if (item.status === 'executed') summary.executed += 1
      if (item.status === 'failed') summary.failed += 1
      if (item.status === 'dismissed') summary.dismissed += 1
      if (item.status === 'stale') summary.stale += 1

      if (
        item.status === 'pending'
        || item.status === 'failed'
        || item.status === 'stale'
      ) {
        summary.actionable += 1
      }

      const queued = isStrategyRecommendationQueued(item)
      if (queued) summary.queued += 1
      if (isStrategyRecommendationExecutableInCurrentWindow(item)) summary.executable += 1
    }

    return summary
  }, [isStrategyRecommendationExecutableInCurrentWindow, strategyRecommendationsView])
  const strategyBatchActionPool = useMemo(
    () => (strategyBatchScope === 'filtered' ? strategyRecommendationsFiltered : strategyRecommendationsDisplay),
    [strategyBatchScope, strategyRecommendationsDisplay, strategyRecommendationsFiltered]
  )
  const selectedStrategyRecommendationSet = useMemo(
    () => new Set(selectedStrategyRecommendationIds),
    [selectedStrategyRecommendationIds]
  )
  const selectableStrategyRecommendations = useMemo(
    () => strategyBatchActionPool.filter((item) => item.status !== 'executed'),
    [strategyBatchActionPool]
  )
  const selectedSelectableCount = selectableStrategyRecommendations.filter((item) => selectedStrategyRecommendationSet.has(item.id)).length
  const selectedVisibleCount = strategyRecommendationsDisplay.filter(
    (item) => selectedStrategyRecommendationSet.has(item.id) && item.status !== 'executed'
  ).length
  const selectedHiddenCount = Math.max(0, selectedSelectableCount - selectedVisibleCount)
  const selectedExecutableCount = strategyBatchActionPool.filter(
    (item) => selectedStrategyRecommendationSet.has(item.id)
      && isStrategyRecommendationExecutableInCurrentWindow(item)
  ).length
  const selectedDismissibleCount = strategyBatchActionPool.filter(
    (item) => selectedStrategyRecommendationSet.has(item.id)
      && (item.status === 'pending' || item.status === 'failed' || item.status === 'stale')
  ).length
  const strategyRecommendationsAllSelected = selectableStrategyRecommendations.length > 0
    && selectedSelectableCount === selectableStrategyRecommendations.length
  const strategyRecommendationsPartiallySelected = selectedSelectableCount > 0
    && selectedSelectableCount < selectableStrategyRecommendations.length

  useEffect(() => {
    const selectableIdSet = new Set(selectableStrategyRecommendations.map((item) => item.id))
    setSelectedStrategyRecommendationIds((prev) => prev.filter((id) => selectableIdSet.has(id)))
  }, [selectableStrategyRecommendations])

  const hasQueuedStrategyRecommendations = useMemo(
    () => strategyRecommendations.some((item) => isStrategyRecommendationQueued(item)),
    [strategyRecommendations]
  )
  const unknownQueueTaskCount = useMemo(
    () => strategyRecommendations.filter((item) => {
      const queueTaskId = String(item.executionResult?.queueTaskId || '').trim()
      if (!queueTaskId) return false
      return String(item.executionResult?.queueTaskStatus || '').trim().toLowerCase() === 'unknown'
    }).length,
    [strategyRecommendations]
  )

  useEffect(() => {
    if (!strategyRecommendationsLoaded || !hasQueuedStrategyRecommendations) {
      return
    }
    let active = true
    const timer = window.setInterval(() => {
      void loadStrategyRecommendations({
        refresh: false,
        silent: true,
        date: strategyRecommendationsReportDate || reportDate,
        syncReportDate: false,
        isActive: () => active,
      })
    }, 15000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [
    hasQueuedStrategyRecommendations,
    loadStrategyRecommendations,
    reportDate,
    strategyRecommendationsLoaded,
    strategyRecommendationsReportDate,
  ])

  const toggleStrategyRecommendationSelected = (recommendationId: string, checked: boolean) => {
    setSelectedStrategyRecommendationIds((prev) => {
      if (checked) {
        if (prev.includes(recommendationId)) return prev
        return [...prev, recommendationId]
      }
      return prev.filter((id) => id !== recommendationId)
    })
  }

  const handleSelectAllStrategyRecommendations = (checked: boolean) => {
    if (!checked) {
      setSelectedStrategyRecommendationIds([])
      return
    }
    setSelectedStrategyRecommendationIds(selectableStrategyRecommendations.map((item) => item.id))
  }

  const isStrategyRecommendationBatchEligible = (
    action: StrategyBatchAction,
    item: OpenclawStrategyRecommendation
  ): boolean => {
    if (action === 'execute') {
      return isStrategyRecommendationExecutableInCurrentWindow(item)
    }
    return item.status === 'pending'
      || item.status === 'failed'
      || item.status === 'stale'
  }

  const runStrategyRecommendationBatchAction = async (
    action: StrategyBatchAction,
    options?: { targetIds?: string[] }
  ) => {
    const scopeLabel = Array.isArray(options?.targetIds) && options.targetIds.length > 0
      ? '失败项'
      : (strategyBatchScope === 'filtered' ? '当前筛选全部' : '当前展示')
    const targetIds = Array.isArray(options?.targetIds) && options.targetIds.length > 0
      ? options.targetIds
      : selectedStrategyRecommendationIds
    const selectedIdSet = new Set(targetIds)
    const selectedRows = strategyBatchActionPool.filter(
      (item) => selectedIdSet.has(item.id) && isStrategyRecommendationBatchEligible(action, item)
    )
    if (selectedRows.length === 0) {
      if (action === 'execute') {
        toast.error('所选建议中暂无可执行项')
      } else {
        toast.error('所选建议中暂无可设为暂不执行项')
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
    } else if (action === 'dismiss') {
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

    if (action === 'execute') setStrategyBatchExecuting(true)
    if (action === 'dismiss') setStrategyBatchDismissing(true)

    let successCount = 0
    const successIds: string[] = []
    const failed: StrategyBatchFailure[] = []
    try {
      for (const item of selectedRows) {
        try {
          await requestStrategyRecommendationAction(
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

      await loadStrategyRecommendations({
        refresh: false,
        silent: true,
        date: strategyRecommendationsReportDate || reportDate,
        syncReportDate: false,
      })
      if (action === 'execute' && successCount > 0) {
        setRefreshKey((prev) => prev + 1)
      }
      setSelectedStrategyRecommendationIds((prev) => {
        const successSet = new Set(successIds)
        return prev.filter((id) => !successSet.has(id))
      })
      setStrategyBatchLastAction(action)
      setStrategyBatchFailures(failed)

      if (failed.length === 0) {
        if (action === 'execute') toast.success(`批量执行已入队，共 ${successCount} 条`)
        if (action === 'dismiss') toast.success(`批量暂不执行完成，共 ${successCount} 条`)
      } else {
        const label = action === 'execute' ? '执行' : '暂不执行'
        toast.warning(`批量${label}完成：成功 ${successCount}，失败 ${failed.length}（失败项已保留，可一键重试）`)
      }
    } finally {
      if (action === 'execute') setStrategyBatchExecuting(false)
      if (action === 'dismiss') setStrategyBatchDismissing(false)
    }
  }

  const handleBatchExecuteStrategyRecommendations = async () => {
    await runStrategyRecommendationBatchAction('execute')
  }

  const handleBatchDismissStrategyRecommendations = async () => {
    await runStrategyRecommendationBatchAction('dismiss')
  }

  const handleRetryFailedStrategyRecommendations = async () => {
    if (!strategyBatchLastAction || strategyBatchFailures.length === 0) {
      return
    }
    const retryIds = Array.from(new Set(strategyBatchFailures.map((item) => item.id)))
    setSelectedStrategyRecommendationIds(retryIds)
    await runStrategyRecommendationBatchAction(strategyBatchLastAction, { targetIds: retryIds })
  }
  const gatewayHealth = gatewayStatus?.health || null
  const gatewaySkillsReport = gatewayStatus?.skills || null
  const gatewaySkillsList = useMemo<any[]>(
    () => (Array.isArray(gatewaySkillsReport?.skills) ? gatewaySkillsReport.skills : []),
    [gatewaySkillsReport]
  )
  const gatewaySkillsSummary = gatewaySkillsList.reduce(
    (acc: { total: number; ready: number; missing: number; disabled: number; blocked: number }, item: any) => {
      const missing = item?.missing || {}
      const missingCount =
        (missing?.bins?.length || 0) +
        (missing?.anyBins?.length || 0) +
        (missing?.env?.length || 0) +
        (missing?.config?.length || 0) +
        (missing?.os?.length || 0)
      acc.total += 1
      if (item?.disabled) acc.disabled += 1
      if (item?.blockedByAllowlist) acc.blocked += 1
      if (missingCount > 0) acc.missing += 1
      if (!item?.disabled && !item?.blockedByAllowlist && item?.eligible && missingCount === 0) {
        acc.ready += 1
      }
      return acc
    },
    { total: 0, ready: 0, missing: 0, disabled: 0, blocked: 0 }
  )
  const gatewaySkillsRows = useMemo<GatewaySkillRow[]>(() => {
    return gatewaySkillsList.map((skill: any) => {
      const missing = skill?.missing || {}
      const missingItems = [
        ...(missing?.bins || []),
        ...(missing?.anyBins || []),
        ...(missing?.env || []),
        ...(missing?.config || []),
        ...(missing?.os || []),
      ].filter((value): value is string => Boolean(value))
      const isReady = !skill?.disabled && !skill?.blockedByAllowlist && Boolean(skill?.eligible) && missingItems.length === 0
      const status = skill?.disabled
        ? { label: '已禁用', variant: 'secondary' as const }
        : skill?.blockedByAllowlist
          ? { label: '被阻止', variant: 'outline' as const }
          : missingItems.length > 0
            ? { label: '缺少依赖', variant: 'destructive' as const }
            : skill?.eligible
              ? { label: '可用', variant: 'default' as const }
              : { label: '未知', variant: 'secondary' as const }
      const installHint = Array.isArray(skill?.install)
        ? skill.install.map((item: any) => item?.label).filter(Boolean).join('; ')
        : ''

      return {
        skill,
        missingItems,
        isReady,
        status,
        installHint,
      }
    })
  }, [gatewaySkillsList])
  const gatewayVisibleSkills = gatewayShowAvailableOnly
    ? gatewaySkillsRows.filter((item) => item.isReady)
    : gatewaySkillsRows
  const workspaceFiles = Array.isArray(workspaceStatus?.files) ? workspaceStatus.files : []
  const workspaceMissingFiles = Array.isArray(workspaceStatus?.missingFiles) ? workspaceStatus.missingFiles : []
  const workspaceReady = Boolean(
    workspaceStatus?.success
    && workspaceMissingFiles.length === 0
    && workspaceStatus.dailyMemoryExists
  )
  const workspaceSourceLabel = workspaceStatus?.source === 'runtime-config'
    ? '运行时配置'
    : workspaceStatus?.source === 'computed'
      ? '计算结果'
      : '未知'
  const canReloadFromWorkspace = workspaceStatus?.canReloadGateway ?? (settings?.isAdmin === true)
  const canEditAiSettings = settings?.isAdmin === true
  const aiConfigured = Boolean((userValues.ai_models_json || '').trim())
  const aiModelLabel = aiSelectedModelMeta
    ? `${aiSelectedModelMeta.modelName}（${aiSelectedModelMeta.modelRef}）`
    : aiSelectedModelRef

  const canRunFeishuConnectionTest =
    hasText(userValues.feishu_app_id)
    && hasText(userValues.feishu_app_secret)
    && hasText(userValues.feishu_target)
  const canRunFeishuVerifyStart =
    hasText(userValues.feishu_app_id)
    && hasText(userValues.feishu_app_secret)
    && hasText(userValues.feishu_target)
  const feishuVerifyParsedTarget = parseFeishuVerifyTarget(userValues.feishu_target)
  const feishuVerifyNeedsSenderOpenId = Boolean(
    feishuVerifyParsedTarget && feishuVerifyParsedTarget.receiveIdType !== 'open_id'
  )
  const feishuVerifyExpiresInMs = feishuVerifySession
    ? feishuVerifySession.expiresAt - feishuVerifyNow
    : null

  const setupCards = [
    {
      id: 'gateway',
      label: 'Gateway',
      done: Boolean(gatewayStatus?.success && gatewayHealth?.ok),
      note: gatewayStatus?.success
        ? (gatewayHealth?.ok ? '在线' : '离线')
        : (gatewayStatus?.error || '待检测'),
    },
    {
      id: 'ai',
      label: 'AI引擎',
      done: canEditAiSettings ? aiConfigured : true,
      note: canEditAiSettings
        ? (aiConfigured ? (aiModelLabel ? '当前：' + aiModelLabel : '已配置 Providers JSON') : '未配置')
        : '成员无需配置（管理员统一维护）',
    },
    {
      id: 'strategy',
      label: '自动分析',
      done: isTruthy(userValues.openclaw_strategy_enabled, false),
      note: isTruthy(userValues.openclaw_strategy_enabled, false) ? '已启用' : '未启用',
    },
  ] as const
  const setupCompletedCount = setupCards.filter(item => item.done).length
  const setupProgressPercent = Math.round((setupCompletedCount / setupCards.length) * 100)
  const aiDirty = hasUserDirtyFields(AI_GLOBAL_EDIT_KEYS)
  const aiSectionDirty = canEditAiSettings && aiDirty
  const feishuChatDirty = hasUserDirtyFields(FEISHU_CHAT_USER_KEYS)
  const pendingCommandCount = pendingCommandRunsTotal
  const strategyDirty = hasUserDirtyFields(STRATEGY_MINIMAL_USER_KEYS)

  const feishuHealthRows = feishuHealthData?.rows || []
  const feishuHealthStats = feishuHealthData?.stats || {
    total: 0,
    allowed: 0,
    blocked: 0,
    error: 0,
  }
  const feishuHealthExecutionStats = feishuHealthData?.stats?.execution || {
    linked: 0,
    completed: 0,
    inProgress: 0,
    waiting: 0,
    missing: 0,
    failed: 0,
    notApplicable: 0,
    unknown: 0,
  }
  const feishuHealthWorkflowStats = feishuHealthData?.stats?.workflow || {
    tracked: 0,
    completed: 0,
    running: 0,
    incomplete: 0,
    failed: 0,
    notRequired: 0,
    unknown: 0,
  }
  const feishuHealthWindowHours = feishuHealthData?.windowHours || 24 * 7
  const feishuHealthWindowDays = Math.max(1, Math.floor(feishuHealthWindowHours / 24))
  const feishuHealthRetentionDays = feishuHealthData?.retentionDays || 7
  const feishuHealthExcerptLimit = feishuHealthData?.excerptLimit || 500
  const feishuHealthExecutionMissingSeconds = feishuHealthData?.executionMissingSeconds || 180

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">OpenClaw</h1>
          <p className="text-slate-500 text-sm mt-1">飞书协作 + AutoAds 自动化控制台</p>
        </div>
        <Link
          href="/help/openclaw-config"
          className={`${buttonVariants({ variant: 'outline', size: 'sm' })} gap-2`}
        >
          配置指南
        </Link>
      </div>

      <Tabs defaultValue="config">
        <TabsList className="bg-slate-100">
          <TabsTrigger value="config">配置中心</TabsTrigger>
          {settings?.isAdmin === true && <TabsTrigger value="feishu-health">飞书链路健康</TabsTrigger>}
          <TabsTrigger value="report">每日报表</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="space-y-6">
          <div className="text-sm text-slate-500">完成以下配置以启用 OpenClaw 全部功能</div>

          <Card>
            <CardHeader>
              <CardTitle>配置向导</CardTitle>
              <CardDescription>按步骤完成核心参数，降低首次配置复杂度</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border bg-slate-50 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span>完成度</span>
                  <span className="font-medium">{setupCompletedCount}/{setupCards.length}（{setupProgressPercent}%）</span>
                </div>
                <div className="mt-2 h-2 rounded bg-slate-200">
                  <div className="h-2 rounded bg-slate-900 transition-all" style={{ width: `${setupProgressPercent}%` }} />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {setupCards.map(card => (
                  <div key={card.id} className="rounded-md border px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{card.label}</span>
                      <Badge variant={card.done ? 'default' : 'secondary'}>{card.done ? '已完成' : '待配置'}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{card.note}</div>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                <span>建议顺序：Gateway → AI引擎 → 自动分析。飞书账号已迁移到策略中心独立配置。</span>
                <Link href="/strategy-center" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  去策略中心配置飞书账号
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>高风险命令确认</CardTitle>
                <CardDescription>
                  已启用自动确认执行；本区域仅展示最近 {HIGH_RISK_COMMAND_LOOKBACK_DAYS} 天高风险命令记录。
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={pendingCommandCount > 0 ? 'destructive' : 'secondary'}>
                  近{HIGH_RISK_COMMAND_LOOKBACK_DAYS}天 {pendingCommandCount}
                </Badge>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => loadPendingCommandRuns({
                    page: pendingCommandRunsPage,
                  })}
                  disabled={pendingCommandRunsLoading}
                >
                  {pendingCommandRunsLoading ? '刷新中...' : '刷新'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {pendingCommandRunsError && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
                  {pendingCommandRunsError}
                </div>
              )}
              {pendingCommandRunsLoading && pendingCommandRuns.length === 0 && (
                <div className="text-sm text-slate-500">高风险命令记录加载中...</div>
              )}
              {!pendingCommandRunsLoading && pendingCommandRuns.length === 0 && (
                <div className="text-sm text-slate-500">
                  最近 {HIGH_RISK_COMMAND_LOOKBACK_DAYS} 天暂无高风险命令记录。
                </div>
              )}
              {pendingCommandRuns.length > 0 && (
                <>
                  <Table className="[&_thead_th]:bg-white">
                    <TableHeader>
                      <TableRow>
                        <TableHead>创建时间</TableHead>
                        <TableHead>请求</TableHead>
                        <TableHead>风险</TableHead>
                        <TableHead>运行状态</TableHead>
                        <TableHead>确认状态</TableHead>
                        <TableHead>最近更新时间</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingCommandRuns.map((run) => {
                        const riskBadge = resolveCommandRiskBadge(run.riskLevel)
                        const runPath = `${run.request.method} ${run.request.path}`
                        return (
                          <TableRow key={run.runId}>
                            <TableCell className="text-xs">{formatTimestamp(run.createdAt)}</TableCell>
                            <TableCell className="text-xs">
                              <div className="font-medium">{runPath}</div>
                              <div className="text-slate-500">run: {formatFeishuRunIdShort(run.runId)}</div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={riskBadge.variant}>{riskBadge.label}</Badge>
                            </TableCell>
                            <TableCell className="text-xs">{run.status}</TableCell>
                            <TableCell className="text-xs">{resolveCommandConfirmStatusText(run.confirmStatus)}</TableCell>
                            <TableCell className="text-xs">
                              {run.updatedAt ? formatTimestamp(run.updatedAt) : '-'}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                  <div className="flex flex-col gap-2 text-xs text-slate-500 md:flex-row md:items-center md:justify-between">
                    <div>
                      最近 {HIGH_RISK_COMMAND_LOOKBACK_DAYS} 天共 {pendingCommandRunsTotal} 条，
                      第 {pendingCommandRunsPage} / {pendingCommandRunsTotalPages} 页
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setPendingCommandRunsPage((prev) => Math.max(1, prev - 1))}
                        disabled={pendingCommandRunsLoading || pendingCommandRunsPage <= 1}
                      >
                        上一页
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setPendingCommandRunsPage((prev) => Math.min(pendingCommandRunsTotalPages, prev + 1))}
                        disabled={pendingCommandRunsLoading || pendingCommandRunsPage >= pendingCommandRunsTotalPages}
                      >
                        下一页
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Gateway / 技能状态</CardTitle>
                <CardDescription>实时查看 OpenClaw Gateway 健康度与技能依赖</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {canEditAiSettings && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleGatewayHotReload}
                    disabled={gatewayLoading || gatewayReloading}
                  >
                    {gatewayReloading ? '热加载中...' : '配置热加载'}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => loadGatewayStatus(true)}
                  disabled={gatewayLoading || gatewayReloading}
                >
                  {gatewayLoading ? '刷新中...' : '刷新'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {!gatewayStatus && <div className="text-sm text-slate-500">状态加载中...</div>}
              {gatewayStatus && !gatewayStatus.success && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
                  {gatewayStatus.error || 'Gateway 状态获取失败'}
                </div>
              )}
              {gatewayStatus?.success && (
                <>
                  <div className="grid gap-4 md:grid-cols-4">
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">Gateway</div>
                      <div className="mt-2 flex items-center gap-2">
                        <Badge variant={gatewayHealth?.ok ? 'default' : 'destructive'}>
                          {gatewayHealth?.ok ? '在线' : '离线'}
                        </Badge>
                        <span className="text-xs text-slate-500">
                          {gatewayStatus?.fetchedAt ? formatTimestamp(gatewayStatus.fetchedAt) : '未知'}
                        </span>
                      </div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">Channels</div>
                      <div className="mt-2 text-lg font-semibold">
                        {gatewayHealth?.channelOrder?.length ?? 0}
                      </div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">Sessions</div>
                      <div className="mt-2 text-lg font-semibold">
                        {gatewayHealth?.sessions?.count ?? 0}
                      </div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">技能可用/总数</div>
                      <div className="mt-2 text-lg font-semibold">
                        {gatewaySkillsSummary.ready}/{gatewaySkillsSummary.total}
                      </div>
                    </div>
                  </div>

                  {gatewayStatus?.errors && gatewayStatus.errors.length > 0 && (
                    <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md p-3">
                      {gatewayStatus.errors.join(' / ')}
                    </div>
                  )}

                  <div>
                    <div className="text-sm font-semibold text-slate-700 mb-2">Gateway 健康检查</div>
                    {gatewayHealth ? (
                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="border rounded-md p-3">
                          <div className="text-xs text-slate-500">耗时</div>
                          <div className="mt-2 text-sm font-medium">
                            {formatDuration(gatewayHealth?.durationMs)}
                          </div>
                        </div>
                        <div className="border rounded-md p-3">
                          <div className="text-xs text-slate-500">默认Agent</div>
                          <div className="mt-2 text-sm font-medium">
                            {gatewayHealth?.defaultAgentId || '未知'}
                          </div>
                        </div>
                        <div className="border rounded-md p-3">
                          <div className="text-xs text-slate-500">最近会话数</div>
                          <div className="mt-2 text-sm font-medium">
                            {gatewayHealth?.sessions?.recent?.length ?? 0}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-slate-500">暂无健康检查数据</div>
                    )}
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-slate-700 mb-2">Channel 状态</div>
                    {gatewayHealth?.channelOrder?.length ? (
                      <Table className="[&_thead_th]:bg-white">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Channel</TableHead>
                            <TableHead>配置</TableHead>
                            <TableHead>绑定</TableHead>
                            <TableHead>探测</TableHead>
                            <TableHead>上次探测</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {gatewayHealth.channelOrder.map((channelKey: string) => {
                            const channel = gatewayHealth.channels?.[channelKey] || {}
                            const label =
                              gatewayHealth.channelLabels?.[channelKey] || channelKey
                            const probeOk = channel?.probe?.ok
                            return (
                              <TableRow key={channelKey}>
                                <TableCell className="font-medium">{label}</TableCell>
                                <TableCell>{renderTriState(channel?.configured)}</TableCell>
                                <TableCell>{renderTriState(channel?.linked)}</TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      probeOk === true
                                        ? 'default'
                                        : probeOk === false
                                          ? 'destructive'
                                          : 'secondary'
                                    }
                                  >
                                    {probeOk === true ? 'OK' : probeOk === false ? 'Fail' : '未知'}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  {formatTimestamp(channel?.lastProbeAt || channel?.lastProbeAtMs)}
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    ) : (
                      <div className="text-sm text-slate-500">暂无 Channel 数据</div>
                    )}
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-700">技能状态</div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="whitespace-nowrap">
                          可用 {gatewaySkillsSummary.ready}/{gatewaySkillsSummary.total}
                        </Badge>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setGatewaySkillsCollapsed((prev) => !prev)}
                        >
                          {gatewaySkillsCollapsed ? '展开列表' : '收起列表'}
                        </Button>
                      </div>
                    </div>
                    {gatewaySkillsCollapsed ? (
                      <div className="text-sm text-slate-500">
                        默认仅展示“可用”技能，点击“展开列表”查看明细。
                      </div>
                    ) : gatewaySkillsList.length > 0 ? (
                      <div className="space-y-3">
                        <div className="flex justify-end">
                          <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                            <span>仅看可用</span>
                            <Switch
                              checked={gatewayShowAvailableOnly}
                              onCheckedChange={setGatewayShowAvailableOnly}
                              aria-label="仅显示可用技能"
                            />
                          </label>
                        </div>
                        {gatewayVisibleSkills.length > 0 ? (
                          <Table className="table-fixed [&_thead_th]:bg-white">
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-[34%]">技能</TableHead>
                                <TableHead className="w-[110px] whitespace-nowrap">状态</TableHead>
                                <TableHead className="w-[34%]">缺失项</TableHead>
                                <TableHead className="w-[22%]">安装建议</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {gatewayVisibleSkills.map((item) => (
                                <TableRow key={item.skill?.skillKey || item.skill?.name}>
                                  <TableCell className="align-top">
                                    <div className="font-medium">{item.skill?.name || item.skill?.skillKey}</div>
                                    <div className="text-xs text-slate-500">{item.skill?.description}</div>
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap align-top">
                                    <Badge variant={item.status.variant} className="whitespace-nowrap">
                                      {item.status.label}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="align-top text-xs text-slate-500">
                                    {item.missingItems.length > 0 ? item.missingItems.join(', ') : '—'}
                                  </TableCell>
                                  <TableCell className="align-top text-xs text-slate-500">
                                    {item.installHint || '—'}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        ) : (
                          <div className="text-sm text-slate-500">暂无可用技能，点击“显示全部状态”查看其他状态。</div>
                        )}
                      </div>
                    ) : (
                      <div className="text-sm text-slate-500">暂无技能数据</div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  SOUL 工作区
                  <Badge variant={workspaceReady ? 'default' : 'secondary'} className="text-[11px]">{workspaceReady ? '已就绪' : '待补齐'}</Badge>
                </CardTitle>
                <CardDescription>检查并补齐 AGENTS/SOUL/USER/MEMORY 与每日记忆文件</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {canReloadFromWorkspace && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleWorkspaceBootstrapAndReload}
                    disabled={workspaceLoading || workspaceBootstrapping || gatewayReloading}
                  >
                    {(workspaceBootstrapping || gatewayReloading) ? '处理中...' : '补齐并热加载'}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => loadWorkspaceStatus(true)}
                  disabled={workspaceLoading || workspaceBootstrapping}
                >
                  {workspaceLoading ? '刷新中...' : '刷新'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleWorkspaceBootstrap()}
                  disabled={workspaceBootstrapping || gatewayReloading}
                >
                  {workspaceBootstrapping ? '补齐中...' : '一键补齐'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {!workspaceStatus && <div className="text-sm text-slate-500">状态加载中...</div>}
              {workspaceStatus && !workspaceStatus.success && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
                  {workspaceStatus.error || 'SOUL 工作区状态获取失败'}
                </div>
              )}
              {workspaceStatus?.success && (
                <>
                  <div className="grid gap-4 md:grid-cols-4">
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">工作区目录</div>
                      <div className="mt-2 text-xs break-all">{workspaceStatus.workspaceDir || '未知'}</div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">路径来源</div>
                      <div className="mt-2 flex items-center gap-2">
                        <Badge variant="outline">{workspaceSourceLabel}</Badge>
                        <span className="text-xs text-slate-500">{workspaceStatus.runtimeWorkspaceDir ? 'runtime 生效' : '按规则推导'}</span>
                      </div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">缺失模板文件</div>
                      <div className="mt-2 text-lg font-semibold">{workspaceMissingFiles.length}</div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-slate-500">今日记忆文件</div>
                      <div className="mt-2">
                        <Badge variant={workspaceStatus.dailyMemoryExists ? 'default' : 'secondary'}>
                          {workspaceStatus.dailyMemoryExists ? '已生成' : '未生成'}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {workspaceStatus.dailyMemoryPath && (
                    <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-slate-600 break-all">
                      每日记忆路径：{workspaceStatus.dailyMemoryPath}
                    </div>
                  )}

                  <Table className="[&_thead_th]:bg-white">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[20%]">文件</TableHead>
                        <TableHead className="w-[16%]">状态</TableHead>
                        <TableHead className="w-[44%]">路径</TableHead>
                        <TableHead className="w-[20%]">更新时间</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {workspaceFiles.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-slate-500">暂无文件状态</TableCell>
                        </TableRow>
                      )}
                      {workspaceFiles.map((file) => (
                        <TableRow key={file.path}>
                          <TableCell className="font-medium">{file.name}</TableCell>
                          <TableCell>
                            <Badge variant={file.exists ? 'default' : 'destructive'}>{file.exists ? '已存在' : '缺失'}</Badge>
                          </TableCell>
                          <TableCell className="text-xs break-all text-slate-600">{file.path}</TableCell>
                          <TableCell className="text-xs text-slate-500">{formatTimestamp(file.updatedAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {workspaceMissingFiles.length > 0 && (
                    <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                      缺失文件：{workspaceMissingFiles.join(', ')}。点击“一键补齐”自动创建。
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                AI 引擎
                <Badge variant="secondary" className="text-[11px]">全局配置</Badge>
                <Badge variant={canEditAiSettings ? 'default' : 'outline'} className="text-[11px]">
                  {canEditAiSettings ? '管理员可编辑' : '成员只读'}
                </Badge>
                {aiSectionDirty && <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" aria-label="AI 配置未保存" />}
              </CardTitle>
              <CardDescription>
                全局配置：仅管理员可修改；普通成员只读查看当前生效模型
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!canEditAiSettings && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  当前账号为普通成员，仅可查看 AI 引擎配置。请联系管理员修改。
                </div>
              )}
              <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-slate-600">
                JSON 格式：顶层 providers 对象，每个 provider 包含 baseUrl、apiKey、api 和 models 数组。详见配置指南。
              </div>
              <div className="grid gap-4 rounded-md border px-3 py-3 md:grid-cols-2">
                <div className="space-y-1">
                  <div className="text-xs text-slate-500">当前给 OpenClaw 使用的模型</div>
                  <div className="truncate text-sm font-medium" title={aiModelLabel || '未识别'}>
                    {aiModelLabel || '未识别（请检查 Providers JSON）'}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">切换模型</label>
                  <Select
                    value={aiSelectedModelRef || undefined}
                    onValueChange={handleAiModelChange}
                    disabled={!canEditAiSettings || Boolean(aiModelsInfo.parseError) || aiModelOptions.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={aiModelOptions.length > 0 ? '选择可用模型' : '暂无可用模型'}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {aiModelOptions.map((option) => (
                        <SelectItem key={option.modelRef} value={option.modelRef}>
                          {option.modelName} ({option.modelRef})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {!aiModelsInfo.parseError && aiConfigured && aiModelOptions.length === 0 && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  当前 JSON 中未解析到可用模型，请确认 models.providers.[provider].models 配置。
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  Providers JSON
                  <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleFormatAiJson}
                    disabled={!canEditAiSettings}
                  >
                    格式化JSON
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setUserValue('ai_models_json', AI_MINIMAL_PLACEHOLDER)
                      setAiJsonError(null)
                    }}
                    disabled={!canEditAiSettings}
                  >
                    最小模板
                  </Button>
                </div>
              </div>
              {aiJsonError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  JSON 格式错误：{aiJsonError}
                </div>
              )}
              <Textarea
                value={userValues.ai_models_json || ''}
                onChange={(e) => {
                  setUserValue('ai_models_json', e.target.value)
                  setAiJsonError(validateAiJson(e.target.value))
                }}
                placeholder={AI_MINIMAL_PLACEHOLDER}
                rows={10}
                disabled={!canEditAiSettings}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={() => {
                    const jsonErr = validateAiJson(userValues.ai_models_json || '')
                    if (jsonErr) {
                      setAiJsonError(jsonErr)
                      toast.error('AI Providers JSON 格式错误，请修正后再保存')
                      return
                    }
                    setAiJsonError(null)
                    saveSettings({ scope: 'global', keys: [...AI_GLOBAL_KEYS], successMessage: 'AI 配置已保存（全局）' })
                  }}
                  disabled={savingUser || !canEditAiSettings}
                >
                  {savingUser ? '保存中...' : aiSectionDirty ? '保存 AI 配置 *' : '保存 AI 配置'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>功能拆分提示</CardTitle>
              <CardDescription>
                联盟平台配置已迁移到「Settings / 联盟同步」，策略中心与飞书相关配置已迁移到「策略中心」。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Link href="/settings?category=affiliate_sync" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                前往联盟同步设置
              </Link>
              <Link href="/strategy-center" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                前往策略中心
              </Link>
            </CardContent>
          </Card>

          <Card className="hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                飞书聊天
                {feishuChatDirty && <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" aria-label="飞书配置未保存" />}
              </CardTitle>
              <CardDescription>最小必填：App ID / App Secret / 推送目标</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-3 text-xs">
                <div className="rounded-md border bg-slate-50 px-3 py-2 text-slate-600 space-y-1">
                  <div className="font-medium text-slate-800">聊天参数（* 为必需）</div>
                  <div><span className="text-red-500" aria-hidden="true">*</span> 飞书 App ID</div>
                  <div><span className="text-red-500" aria-hidden="true">*</span> 飞书 App Secret</div>
                  <div><span className="text-red-500" aria-hidden="true">*</span> 飞书推送目标（open_id / union_id / chat_id）</div>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-md border bg-slate-50 px-3 py-2">
                <div className="text-xs text-slate-600">高级参数（通信鉴权）默认已预置，按需展开</div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFeishuAdvanced((prev) => !prev)}
                >
                  {showFeishuAdvanced ? '收起高级参数' : '展开高级参数'}
                </Button>
              </div>
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                高风险命令已启用自动确认执行；控制面仅保留近 7 天审计记录展示。
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <InputWithLabel
                  label="飞书 App ID"
                  required
                  value={userValues.feishu_app_id || ''}
                  onChange={(v) => setUserValue('feishu_app_id', v)}
                  placeholder={FEISHU_BASIC_EXAMPLE_VALUES.feishu_app_id}
                />
                <InputWithLabel
                  label="飞书推送目标（open_id / union_id / chat_id）"
                  required
                  value={userValues.feishu_target || ''}
                  onChange={(v) => setUserValue('feishu_target', v)}
                  placeholder={FEISHU_BASIC_EXAMPLE_VALUES.feishu_target}
                />
                <InputWithLabel
                  label="飞书 App Secret"
                  required
                  type="password"
                  value={userValues.feishu_app_secret || ''}
                  onChange={(v) => setUserValue('feishu_app_secret', v)}
                  placeholder={FEISHU_BASIC_EXAMPLE_VALUES.feishu_app_secret}
                />
              </div>

              {showFeishuAdvanced && (
                <>
                  <div className="rounded-md border px-4 py-3 space-y-4">
                    <div className="text-sm font-medium">通信与鉴权（建议配置，已预置默认值）</div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">飞书域名</label>
                        <Select
                          value={userValues.feishu_domain || 'feishu'}
                          onValueChange={(v) => setUserValue('feishu_domain', v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="选择域名" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="feishu">feishu</SelectItem>
                            <SelectItem value="lark">lark</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <InputWithLabel
                        label="Bot 展示名（可选）"
                        value={userValues.feishu_bot_name || ''}
                        onChange={(v) => setUserValue('feishu_bot_name', v)}
                        placeholder="OpenClaw 助手"
                      />
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">鉴权模式</label>
                        <Select
                          value={userValues.feishu_auth_mode || 'strict'}
                          onValueChange={(v) => setUserValue('feishu_auth_mode', v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="选择模式" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="strict">strict（推荐）</SelectItem>
                            <SelectItem value="compat">compat（兼容）</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <SwitchWithLabel
                        label="Require Tenant Key"
                        checked={isTruthy(userValues.feishu_require_tenant_key, true)}
                        onChange={(val) => setUserValue('feishu_require_tenant_key', val ? 'true' : 'false')}
                      />
                      <SwitchWithLabel
                        label="Strict Auto Bind"
                        checked={isTruthy(userValues.feishu_strict_auto_bind, true)}
                        onChange={(val) => setUserValue('feishu_strict_auto_bind', val ? 'true' : 'false')}
                      />
                    </div>

                    <p className="text-xs text-slate-500">
                      默认已自动填写：domain=feishu、authMode=strict、Require Tenant Key=true、Strict Auto Bind=true。仅在迁移历史账号时短暂使用 compat。
                    </p>
                  </div>
                </>
              )}

              <div className="grid gap-2 md:grid-cols-3 text-xs">
                <div className={hasText(userValues.feishu_app_id) ? 'text-emerald-600' : 'text-slate-500'}>
                  {hasText(userValues.feishu_app_id) ? '✓ App ID 已填写' : '• App ID 未填写'}
                </div>
                <div className={hasText(userValues.feishu_app_secret) ? 'text-emerald-600' : 'text-slate-500'}>
                  {hasText(userValues.feishu_app_secret)
                    ? '✓ Secret 已填写'
                    : '• Secret 未填写'}
                </div>
                <div className={hasText(userValues.feishu_target) ? 'text-emerald-600' : 'text-slate-500'}>
                  {hasText(userValues.feishu_target) ? '✓ 推送目标已填写' : '• 推送目标未填写'}
                </div>
                {showFeishuAdvanced && (
                  <>
                    <div className={isTruthy(userValues.feishu_require_tenant_key, true) ? 'text-emerald-600' : 'text-amber-600'}>
                      {isTruthy(userValues.feishu_require_tenant_key, true)
                        ? '✓ Tenant Key 校验已启用'
                        : '• Tenant Key 校验未启用（兼容模式）'}
                    </div>
                    <div className={isTruthy(userValues.feishu_strict_auto_bind, true) ? 'text-emerald-600' : 'text-amber-600'}>
                      {isTruthy(userValues.feishu_strict_auto_bind, true)
                        ? '✓ Strict Auto Bind 已启用'
                        : '• Strict Auto Bind 未启用'}
                    </div>
                    <div className={(userValues.feishu_auth_mode || 'strict') === 'strict' ? 'text-emerald-600' : 'text-amber-600'}>
                      {(userValues.feishu_auth_mode || 'strict') === 'strict'
                        ? '✓ 鉴权模式 strict'
                        : '• 鉴权模式 compat（迁移用）'}
                    </div>
                  </>
                )}
              </div>

              <div className="rounded-md border bg-slate-50 px-3 py-3 space-y-3">
                <div className="text-sm font-medium text-slate-800">双向通信验证（半自动）</div>
                <p className="text-xs text-slate-600">
                  点击“验证双向通信”后，系统会向当前 target 发送随机验证码（5分钟有效）；请在同一会话用指定 open_id 回复后，再点击“校验回执”。
                </p>

                {feishuVerifyNeedsSenderOpenId && (
                  <InputWithLabel
                    label="验证发送者 open_id（target 非 open_id 时建议填写）"
                    value={feishuVerifySenderOpenId}
                    onChange={setFeishuVerifySenderOpenId}
                    placeholder="ou_xxx"
                  />
                )}

                {feishuVerifySession && (
                  <div className="grid gap-2 md:grid-cols-2 text-xs text-slate-600">
                    <div>验证码：<code>{feishuVerifySession.code}</code></div>
                    <div>有效期：{formatCountdown(feishuVerifyExpiresInMs)}</div>
                    <div>验证发送者：<code>{feishuVerifySession.expectedSenderOpenId}</code></div>
                    <div>会话ID：<code>{feishuVerifySession.verificationId}</code></div>
                    <div className="md:col-span-2">过期时间：{formatTimestamp(feishuVerifySession.expiresAt)}</div>
                  </div>
                )}

                {feishuVerifyResult && (
                  <div
                    className={`rounded-md border px-3 py-2 text-xs ${
                      feishuVerifyResult.verified
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : feishuVerifyResult.pending
                          ? 'border-amber-300 bg-amber-50 text-amber-700'
                          : 'border-red-300 bg-red-50 text-red-700'
                    }`}
                  >
                    {feishuVerifyResult.message}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleFeishuTestConnection}
                    disabled={feishuTestLoading || !canRunFeishuConnectionTest}
                    title={canRunFeishuConnectionTest ? undefined : '请先填写飞书 App ID / App Secret / 推送目标'}
                  >
                    {feishuTestLoading ? '测试中...' : '测试连接'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleFeishuStartVerify}
                    disabled={feishuVerifyLoading || !canRunFeishuVerifyStart}
                    title={canRunFeishuVerifyStart ? undefined : '请先填写飞书 App ID / App Secret / 推送目标'}
                  >
                    {feishuVerifyLoading ? '发送中...' : '验证双向通信'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleFeishuCheckVerify}
                    disabled={feishuVerifyChecking || !feishuVerifySession?.verificationId}
                    title={feishuVerifySession?.verificationId ? undefined : '请先发送验证码'}
                  >
                    {feishuVerifyChecking ? '校验中...' : '校验回执'}
                  </Button>
                  {feishuTestResult && (
                    <Badge variant={feishuTestResult.ok ? 'default' : 'destructive'}>
                      {feishuTestResult.ok ? '连接成功' : feishuTestResult.message}
                    </Badge>
                  )}
                </div>
                <Button
                  onClick={() => saveSettings({ scope: 'user', keys: [...FEISHU_CHAT_USER_KEYS], successMessage: '飞书配置已保存' })}
                  disabled={savingUser || !canRunFeishuConnectionTest}
                  title={canRunFeishuConnectionTest ? undefined : '请先填写飞书 App ID / App Secret / 推送目标'}
                >
                  {savingUser ? '保存中...' : feishuChatDirty ? '保存飞书配置 *' : '保存飞书配置'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>联盟平台</CardTitle>
              <CardDescription>联盟配置已迁移到系统设置页，OpenClaw 页面仅保留只读入口。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border bg-amber-50 px-3 py-2 text-sm text-amber-800">
                请前往 <span className="font-mono">/settings?category=affiliate_sync</span> 维护联盟凭证与佣金同步参数。
              </div>
              <div className="flex justify-end">
                <Link
                  href="/settings?category=affiliate_sync"
                  className={buttonVariants({ variant: 'outline' })}
                >
                  前往 Settings 配置
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>OpenClaw Access Tokens</CardTitle>
              <CardDescription>用于 OpenClaw 调用 AutoAds API（用户级隔离）</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {newToken && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3 text-sm">
                  新Token：<span className="font-mono break-all">{newToken}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <Button onClick={handleCreateToken}>生成新Token</Button>
              </div>
              <Table className="[&_thead_th]:bg-white">
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead>最后使用</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tokens.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-slate-500">
                        暂无Token
                      </TableCell>
                    </TableRow>
                  )}
                  {tokens.map(token => (
                    <TableRow key={token.id}>
                      <TableCell>{token.name || 'OpenClaw Token'}</TableCell>
                      <TableCell>
                        <Badge variant={token.status === 'active' ? 'default' : 'secondary'}>
                          {token.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{token.created_at}</TableCell>
                      <TableCell>{token.last_used_at || '-'}</TableCell>
                      <TableCell>
                        <Button variant="ghost" onClick={() => handleRevokeToken(token.id)}>
                          撤销
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {settings?.isAdmin === true && (
          <TabsContent value="feishu-health" className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>飞书聊天链路健康页</CardTitle>
                  <CardDescription>
                    最近 {feishuHealthWindowDays} 天消息链路诊断（保留 {feishuHealthRetentionDays} 天，列表片段最多 {feishuHealthExcerptLimit} 字，放行后超过 {feishuHealthExecutionMissingSeconds}s 无执行记录标记为断链）
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={feishuHealthLoading}
                  onClick={() => {
                    void loadFeishuHealthData()
                  }}
                >
                  {feishuHealthLoading ? '刷新中...' : '刷新'}
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {feishuHealthError && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                    {feishuHealthError}
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">总消息</div>
                    <div className="mt-1 text-xl font-semibold">{feishuHealthStats.total}</div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">放行</div>
                    <div className="mt-1 text-xl font-semibold text-emerald-600">{feishuHealthStats.allowed}</div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">拦截</div>
                    <div className="mt-1 text-xl font-semibold text-amber-600">{feishuHealthStats.blocked}</div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">错误</div>
                    <div className="mt-1 text-xl font-semibold text-red-600">{feishuHealthStats.error}</div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">已关联执行</div>
                    <div className="mt-1 text-xl font-semibold text-sky-600">{feishuHealthExecutionStats.linked}</div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">已完成</div>
                    <div className="mt-1 text-xl font-semibold text-emerald-600">{feishuHealthExecutionStats.completed}</div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">执行中</div>
                    <div className="mt-1 text-xl font-semibold text-indigo-600">{feishuHealthExecutionStats.inProgress}</div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">等待落库</div>
                    <div className="mt-1 text-xl font-semibold text-amber-600">{feishuHealthExecutionStats.waiting}</div>
                  </div>
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
                    <div className="text-xs text-red-600">断链</div>
                    <div className="mt-1 text-xl font-semibold text-red-600">{feishuHealthExecutionStats.missing}</div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">执行失败</div>
                    <div className="mt-1 text-xl font-semibold text-red-600">{feishuHealthExecutionStats.failed}</div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">业务跟踪</div>
                    <div className="mt-1 text-xl font-semibold text-sky-600">{feishuHealthWorkflowStats.tracked}</div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">业务完成</div>
                    <div className="mt-1 text-xl font-semibold text-emerald-600">{feishuHealthWorkflowStats.completed}</div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">业务执行中</div>
                    <div className="mt-1 text-xl font-semibold text-indigo-600">{feishuHealthWorkflowStats.running}</div>
                  </div>
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
                    <div className="text-xs text-red-600">业务未完成</div>
                    <div className="mt-1 text-xl font-semibold text-red-600">{feishuHealthWorkflowStats.incomplete}</div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">业务失败</div>
                    <div className="mt-1 text-xl font-semibold text-red-600">{feishuHealthWorkflowStats.failed}</div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <div className="text-xs text-slate-500">无需跟踪</div>
                    <div className="mt-1 text-xl font-semibold text-slate-600">{feishuHealthWorkflowStats.notRequired}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>链路明细</CardTitle>
                <CardDescription>每条消息显示放行/拦截原因，默认展示原文前 {feishuHealthExcerptLimit} 字片段</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table className="table-fixed min-w-[1460px] [&_thead_th]:bg-white">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="h-8 w-[86px] whitespace-nowrap">时间</TableHead>
                        <TableHead className="h-8 w-[88px] whitespace-nowrap">记录ID</TableHead>
                        <TableHead className="h-8 w-[78px] whitespace-nowrap">决策</TableHead>
                        <TableHead className="h-8 w-[88px] whitespace-nowrap">执行状态</TableHead>
                        <TableHead className="h-8 w-[96px] whitespace-nowrap">业务状态</TableHead>
                        <TableHead className="h-8 w-[21%] whitespace-nowrap">链路详情</TableHead>
                        <TableHead className="h-8 w-[18%] whitespace-nowrap">原因</TableHead>
                        <TableHead className="h-8 w-[11%] whitespace-nowrap">发送者</TableHead>
                        <TableHead className="h-8 w-[11%] whitespace-nowrap">会话</TableHead>
                        <TableHead className="h-8 w-[20%] whitespace-nowrap">消息片段</TableHead>
                        <TableHead className="h-8 w-[56px] whitespace-nowrap text-center">原文</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {feishuHealthRows.map((row) => {
                        const decisionBadge = resolveFeishuHealthDecisionBadge(row.decision)
                        const executionBadge = resolveFeishuExecutionBadge(row.executionState)
                        const workflowBadge = resolveFeishuWorkflowBadge(row.workflowState)
                        const senderText = resolveFeishuHealthSenderText(row)
                        const chatText = row.chatId || '-'
                        const excerpt = row.messageExcerpt || '-'
                        const reasonText = row.reasonMessage ? `${row.reasonCode || '-'} · ${row.reasonMessage}` : row.reasonCode || '-'
                        const executionRunId = row.executionRunId || ''
                        const executionRunStatus = row.executionRunStatus || '-'
                        const executionRunCreatedAt = row.executionRunCreatedAt ? formatTimestamp(row.executionRunCreatedAt) : '-'
                        const executionRunCount = Number.isFinite(row.executionRunCount) ? row.executionRunCount : 0
                        const executionAgeText = row.decision === 'allowed' ? formatAgeSeconds(row.ageSeconds) : '-'
                        const workflowProgress = Number.isFinite(row.workflowProgress) ? Math.max(0, Math.min(100, Math.floor(row.workflowProgress))) : 0
                        const workflowProgressText = row.workflowState === 'not_required' ? '-' : `${workflowProgress}%`
                        const timestampLines = formatTimestampCompactLines(row.createdAt)
                        const canViewFullText = hasText(row.messageText || '')
                        const isMissing = row.executionState === 'missing'
                        const isWorkflowRisk = row.workflowState === 'incomplete' || row.workflowState === 'failed'

                        return (
                          <TableRow key={row.id} className={isMissing || isWorkflowRisk ? 'bg-red-50/70' : undefined}>
                            <TableCell className="whitespace-nowrap py-1.5 text-[11px] leading-4 text-slate-600">
                              <div>{timestampLines.date}</div>
                              <div className="text-slate-500">{timestampLines.time}</div>
                            </TableCell>
                            <TableCell className="whitespace-nowrap py-1.5 font-mono text-xs text-slate-700">
                              {row.id}
                            </TableCell>
                            <TableCell className="whitespace-nowrap py-1.5">
                              <Badge className="whitespace-nowrap" variant={decisionBadge.variant}>{decisionBadge.label}</Badge>
                            </TableCell>
                            <TableCell className="whitespace-nowrap py-1.5">
                              <Badge className="whitespace-nowrap" variant={executionBadge.variant}>{executionBadge.label}</Badge>
                            </TableCell>
                            <TableCell className="whitespace-nowrap py-1.5">
                              <Badge className="whitespace-nowrap" variant={workflowBadge.variant}>{workflowBadge.label}</Badge>
                              <div className="mt-1 text-[11px] text-slate-500">{workflowProgressText}</div>
                            </TableCell>
                            <TableCell className="py-1.5 align-top text-xs">
                              <div className="line-clamp-2 break-all font-medium leading-4" title={row.workflowDetail || '-'}>
                                {row.workflowDetail || '-'}
                              </div>
                              <div className="mt-1 line-clamp-2 break-all leading-4 text-slate-600" title={row.executionDetail || '-'}>
                                {row.executionDetail || '-'}
                              </div>
                              <div
                                className="mt-1 line-clamp-2 break-all font-mono text-[11px] leading-4 text-slate-500"
                                title={`run:${executionRunId || '-'} · status:${executionRunStatus} · created:${executionRunCreatedAt} · count:${executionRunCount} · age:${executionAgeText}`}
                              >
                                {`run:${formatFeishuRunIdShort(executionRunId)}`} · {executionRunStatus} · {executionRunCount}条 · {executionAgeText}
                              </div>
                            </TableCell>
                            <TableCell className="py-1.5 align-top">
                              <div className="line-clamp-2 break-all text-xs font-medium leading-4" title={reasonText}>{reasonText}</div>
                            </TableCell>
                            <TableCell className="py-1.5 align-top font-mono text-xs">
                              <div className="line-clamp-2 break-all leading-4" title={senderText}>{senderText}</div>
                            </TableCell>
                            <TableCell className="py-1.5 align-top font-mono text-xs">
                              <div className="line-clamp-2 break-all leading-4" title={chatText}>{chatText}</div>
                            </TableCell>
                            <TableCell className="py-1.5 align-top text-xs text-slate-700">
                              <div className="line-clamp-2 break-all leading-4" title={excerpt}>{excerpt}</div>
                            </TableCell>
                            <TableCell className="whitespace-nowrap py-1.5 text-center">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 w-7 p-0"
                                aria-label={canViewFullText ? '查看原文' : '无原文可查看'}
                                title={canViewFullText ? '查看原文' : '无原文可查看'}
                                disabled={!canViewFullText}
                                onClick={() => setFeishuHealthDialogItem(row)}
                              >
                                <Eye className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}

                      {feishuHealthRows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={11} className="text-center text-slate-500">
                            最近 {feishuHealthWindowDays} 天暂无飞书链路日志
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Dialog
              open={Boolean(feishuHealthDialogItem)}
              onOpenChange={(open) => {
                if (!open) {
                  setFeishuHealthDialogItem(null)
                }
              }}
            >
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>飞书消息原文</DialogTitle>
                  <DialogDescription>
                    {feishuHealthDialogItem
                      ? `${formatTimestamp(feishuHealthDialogItem.createdAt)} · ${feishuHealthDialogItem.reasonCode || '-'} · ${resolveFeishuHealthSenderText(feishuHealthDialogItem)}`
                      : '消息详情'}
                  </DialogDescription>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-auto rounded-md border bg-slate-50 p-3 text-xs whitespace-pre-wrap break-all">
                  {feishuHealthDialogItem?.messageText || '-'}
                </div>
              </DialogContent>
            </Dialog>
          </TabsContent>
        )}

        <TabsContent value="strategy" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                自动分析设置
                {strategyDirty && <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" aria-label="自动分析设置未保存" />}
              </CardTitle>
              <CardDescription>自动分析运行中 Campaign 表现并生成优化建议，执行环节始终由人工触发</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-slate-700">
                建议流程：①启用自动分析 → ②设置分析频率 → ③在下方“优化建议”中人工选择执行
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <SwitchWithLabel
                  label="启用自动分析"
                  required
                  checked={isTruthy(userValues.openclaw_strategy_enabled, false)}
                  onChange={(val) => setUserValue('openclaw_strategy_enabled', val ? 'true' : 'false')}
                />
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    分析频率
                    <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>
                  </label>
                  <Select value={strategyCronPreset} onValueChange={handleStrategyCronPresetChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择分析频率" />
                    </SelectTrigger>
                    <SelectContent>
                      {STRATEGY_CRON_OPTIONS.map(option => (
                        <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                自动分析只负责生成报告与优化建议，不会自动执行对广告投放的变更。
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={() => saveSettings({ scope: 'user', keys: strategySaveKeys, successMessage: '自动分析设置已保存' })}
                  disabled={savingUser}
                >
                  {savingUser ? '保存中...' : strategyDirty ? '保存自动分析设置 *' : '保存自动分析设置'}
                </Button>
              </div>
            </CardContent>
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
                    {strategyDateNormalized && (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
                        已从 {reportDate} 归一到服务端日期
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex w-full flex-col gap-3 rounded-xl border border-slate-200 bg-white/90 p-3 xl:w-auto xl:min-w-[280px]">
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>分析后发送 Feishu</span>
                    <Switch
                      checked={strategyAnalyzeSendFeishu}
                      onCheckedChange={(checked) => setStrategyAnalyzeSendFeishu(Boolean(checked))}
                      disabled={strategyManualTriggering || strategyRecommendationsLoading || strategyRecommendationActionBusy}
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={handleTriggerStrategyRecommendations}
                    disabled={
                      strategyManualTriggering
                      || strategyRecommendationsLoading
                      || strategyRecommendationActionBusy
                    }
                  >
                    {strategyManualTriggering ? '分析中...' : '重新分析'}
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <div className="text-xs text-slate-500">总建议</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-900">{strategyRecommendationSummary.total}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <div className="text-xs text-slate-500">待处理（待执行/执行失败/待重算）</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-900">{strategyRecommendationSummary.actionable}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <div className="text-xs text-slate-500">排队执行中</div>
                  <div className="mt-1 text-2xl font-semibold text-amber-700">{strategyRecommendationSummary.queued}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <div className="text-xs text-slate-500">当前可执行</div>
                  <div className="mt-1 text-2xl font-semibold text-emerald-700">{strategyRecommendationSummary.executable}</div>
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
                {hasQueuedStrategyRecommendations && (
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
                        variant={strategyRecommendationsDisplayMode === 'final' ? 'default' : 'outline'}
                        onClick={() => setStrategyRecommendationsDisplayMode('final')}
                        disabled={strategyRecommendationActionBusy}
                      >
                        每 Campaign 仅显示最高优先级
                      </Button>
                      <Button
                        size="sm"
                        variant={strategyRecommendationsDisplayMode === 'all' ? 'default' : 'outline'}
                        onClick={() => setStrategyRecommendationsDisplayMode('all')}
                        disabled={strategyRecommendationActionBusy}
                      >
                        显示全部建议
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Select
                        value={strategyRecommendationStatusFilter}
                        onValueChange={(value) => setStrategyRecommendationStatusFilter(value as StrategyRecommendationStatusFilter)}
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
                        value={strategyBatchScope}
                        onValueChange={(value) => setStrategyBatchScope(value as StrategyBatchScope)}
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
                    当前 {strategyRecommendationsDisplayMode === 'final' ? '每个 Campaign 仅显示优先级最高建议' : '显示全部建议'}
                    {' · '}
                    展示 {strategyRecommendationsDisplay.length} / {strategyRecommendationsView.length} 条
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
                      onClick={handleBatchExecuteStrategyRecommendations}
                      disabled={strategyRecommendationActionBusy || selectedExecutableCount === 0}
                    >
                      {strategyBatchExecuting ? '批量执行中...' : '批量执行'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleBatchDismissStrategyRecommendations}
                      disabled={strategyRecommendationActionBusy || selectedDismissibleCount === 0}
                    >
                      {strategyBatchDismissing ? '批量处理中...' : '批量暂不执行'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleRetryFailedStrategyRecommendations}
                      disabled={strategyRecommendationActionBusy || strategyBatchFailures.length === 0}
                    >
                      重试失败项{strategyBatchFailures.length > 0 ? ` (${strategyBatchFailures.length})` : ''}
                    </Button>
                  </div>
                </div>
              </div>

              {strategyBatchFailures.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  最近失败（Top3）：
                  {strategyBatchFailures.slice(0, 3).map((item, idx) => (
                    <span key={`${item.id}:${idx}`} className="ml-1">
                      [{item.id}] {item.message}
                    </span>
                  ))}
                </div>
              )}

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <Table className="min-w-[1320px] [&_thead_th]:bg-white">
                  <TableHeader className="bg-slate-50/80">
                    <TableRow className="hover:bg-slate-50/80">
                      <TableHead className="w-[44px] text-xs font-semibold text-slate-600">
                        <Checkbox
                          checked={
                            strategyRecommendationsAllSelected
                              ? true
                              : strategyRecommendationsPartiallySelected
                                ? 'indeterminate'
                                : false
                          }
                          onCheckedChange={(checked) => handleSelectAllStrategyRecommendations(Boolean(checked))}
                          aria-label="全选策略建议"
                          disabled={strategyRecommendationActionBusy || selectableStrategyRecommendations.length === 0}
                        />
                      </TableHead>
                      <TableHead className="w-[52px] text-xs font-semibold text-slate-600">#</TableHead>
                      <TableHead className="min-w-[200px] text-xs font-semibold text-slate-600">类型 / ID</TableHead>
                      <TableHead className="min-w-[240px] text-xs font-semibold text-slate-600">建议</TableHead>
                      <TableHead className="min-w-[260px] text-xs font-semibold text-slate-600">Campaign</TableHead>
                      <TableHead className="min-w-[240px] text-xs font-semibold text-slate-600">成本/盈亏平衡</TableHead>
                      <TableHead className="min-w-[220px] text-xs font-semibold text-slate-600">优先级分</TableHead>
                      <TableHead className="min-w-[140px] text-xs font-semibold text-slate-600">状态</TableHead>
                      <TableHead className="min-w-[340px] text-right text-xs font-semibold text-slate-600">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {strategyRecommendationsDisplay.map((item, index) => {
                      const statusBadge = resolveStrategyRecommendationStatusBadge(item.status)
                      const isExecuting = strategyRecommendationExecutingId === item.id
                      const isDismissing = strategyRecommendationDismissingId === item.id
                      const isSelectable = item.status !== 'executed'
                      const isChecked = selectedStrategyRecommendationSet.has(item.id)
                      const analysisNote = item.data?.analysisNote || item.reason || item.summary || '-'
                      const isQueued = isStrategyRecommendationQueued(item)
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
                      const recommendationTypeLabel = resolveStrategyRecommendationTypeLabel(item.recommendationType)
                      const recommendationTypeTone = resolveStrategyRecommendationTypeTone(item.recommendationType)

                      return (
                        <TableRow key={item.id} className="align-top hover:bg-slate-50/70">
                          <TableCell>
                            {isSelectable ? (
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) => toggleStrategyRecommendationSelected(item.id, Boolean(checked))}
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
                          <TableCell className="w-[140px] max-w-[140px] space-y-1 pt-3">
                            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                            {item.status === 'stale' && (
                              <div className="text-xs text-amber-600">建议内容已变化，请重新分析后再执行</div>
                            )}
                            {isQueued && (
                              <div className="text-xs text-amber-600">排队执行中</div>
                            )}
                            {item.status === 'failed' && item.executionResult?.error && (
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
                                onClick={() => setStrategyRecommendationDetailItem(item)}
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
                                onClick={() => handleExecuteStrategyRecommendation(item)}
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
                                onClick={() => handleDismissStrategyRecommendation(item)}
                              >
                                {isDismissing ? '处理中...' : '暂不执行'}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    {strategyRecommendationsDisplay.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={9} className="py-10 text-center text-slate-500">
                          {strategyRecommendationsLoading ? '策略建议生成中...' : '暂无策略建议'}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <Dialog
                open={Boolean(strategyRecommendationDetailItem)}
                onOpenChange={(open) => {
                  if (!open) setStrategyRecommendationDetailItem(null)
                }}
              >
                <DialogContent className="max-w-3xl">
                  <DialogHeader>
                    <DialogTitle>建议执行明细</DialogTitle>
                    <DialogDescription>
                      {strategyRecommendationDetailItem
                        ? `${resolveStrategyRecommendationTypeLabel(strategyRecommendationDetailItem.recommendationType)} · ${strategyRecommendationDetailItem.data?.campaignName || `Campaign #${strategyRecommendationDetailItem.campaignId}`}`
                        : ''}
                    </DialogDescription>
                  </DialogHeader>
                  {strategyRecommendationDetailItem && (
                    <div className="max-h-[65vh] space-y-4 overflow-y-auto text-sm">
                      {Array.isArray(strategyRecommendationDetailItem.data?.keywordPlan) && strategyRecommendationDetailItem.data.keywordPlan.length > 0 && (
                        <div className="space-y-2 rounded-md border p-3">
                          <div className="text-sm font-medium">
                            补充Search Terms关键词（{strategyRecommendationDetailItem.data.keywordPlan.length}）
                          </div>
                          <div className="space-y-1 text-xs text-slate-600">
                            {strategyRecommendationDetailItem.data.keywordPlan.slice(0, 30).map((kw, idx) => (
                              <div key={`kw:${kw.text}:${idx}`}>
                                {idx + 1}. {kw.text} [{kw.matchType}]
                              </div>
                            ))}
                            {strategyRecommendationDetailItem.data.keywordPlan.length > 30 && (
                              <div>其余 {strategyRecommendationDetailItem.data.keywordPlan.length - 30} 条已省略</div>
                            )}
                          </div>
                        </div>
                      )}
                      {Array.isArray(strategyRecommendationDetailItem.data?.negativeKeywordPlan) && strategyRecommendationDetailItem.data.negativeKeywordPlan.length > 0 && (
                        <div className="space-y-2 rounded-md border p-3">
                          <div className="text-sm font-medium">
                            否词建议（{strategyRecommendationDetailItem.data.negativeKeywordPlan.length}）
                          </div>
                          <div className="space-y-1 text-xs text-slate-600">
                            {strategyRecommendationDetailItem.data.negativeKeywordPlan.slice(0, 30).map((kw, idx) => (
                              <div key={`neg:${kw.text}:${idx}`}>
                                {idx + 1}. {kw.text} [{kw.matchType}]
                                {kw.reason ? ` · ${kw.reason}` : ''}
                              </div>
                            ))}
                            {strategyRecommendationDetailItem.data.negativeKeywordPlan.length > 30 && (
                              <div>其余 {strategyRecommendationDetailItem.data.negativeKeywordPlan.length - 30} 条已省略</div>
                            )}
                          </div>
                        </div>
                      )}
                      {Array.isArray(strategyRecommendationDetailItem.data?.matchTypePlan) && strategyRecommendationDetailItem.data.matchTypePlan.length > 0 && (
                        <div className="space-y-2 rounded-md border p-3">
                          <div className="text-sm font-medium">
                            匹配类型优化（{strategyRecommendationDetailItem.data.matchTypePlan.length}）
                          </div>
                          <div className="space-y-1 text-xs text-slate-600">
                            {strategyRecommendationDetailItem.data.matchTypePlan.slice(0, 30).map((kw, idx) => (
                              <div key={`mt:${kw.text}:${idx}`}>
                                {idx + 1}. {kw.text} [{kw.currentMatchType} → {kw.recommendedMatchType}]
                                {Number.isFinite(Number(kw.clicks)) ? ` · 点击 ${formatNumber(kw.clicks, 0)}` : ''}
                                {Number.isFinite(Number(kw.conversions)) ? ` · 转化 ${formatNumber(kw.conversions, 2)}` : ''}
                                {Number.isFinite(Number(kw.cost))
                                  ? ` · 花费 ${formatMoney(kw.cost, strategyRecommendationDetailItem.data?.currency || strategyRecommendationDetailItem.data?.searchTermFeedback?.dominantCurrency, 2)}`
                                  : ''}
                              </div>
                            ))}
                            {strategyRecommendationDetailItem.data.matchTypePlan.length > 30 && (
                              <div>其余 {strategyRecommendationDetailItem.data.matchTypePlan.length - 30} 条已省略</div>
                            )}
                          </div>
                        </div>
                      )}
                      {(
                        (Array.isArray(strategyRecommendationDetailItem.data?.searchTermFeedback?.hardNegativeTerms)
                          && strategyRecommendationDetailItem.data.searchTermFeedback.hardNegativeTerms.length > 0)
                        || (Array.isArray(strategyRecommendationDetailItem.data?.searchTermFeedback?.softSuppressTerms)
                          && strategyRecommendationDetailItem.data.searchTermFeedback.softSuppressTerms.length > 0)
                      ) && (
                        <div className="space-y-2 rounded-md border p-3">
                          <div className="text-sm font-medium">
                            搜索词反馈（近{strategyRecommendationDetailItem.data?.searchTermFeedback?.lookbackDays || 14}天）
                          </div>
                          {Array.isArray(strategyRecommendationDetailItem.data?.searchTermFeedback?.hardNegativeTerms)
                            && strategyRecommendationDetailItem.data.searchTermFeedback.hardNegativeTerms.length > 0 && (
                              <div className="space-y-1 text-xs text-slate-600">
                                <div className="font-medium text-amber-700">
                                  hard 词（建议优先否词）{strategyRecommendationDetailItem.data.searchTermFeedback.hardNegativeTerms.length}
                                </div>
                                {strategyRecommendationDetailItem.data.searchTermFeedback.hardNegativeTerms.slice(0, 30).map((term, idx) => (
                                  <div key={`hard:${term}:${idx}`}>{idx + 1}. {term}</div>
                                ))}
                              </div>
                            )}
                          {Array.isArray(strategyRecommendationDetailItem.data?.searchTermFeedback?.softSuppressTerms)
                            && strategyRecommendationDetailItem.data.searchTermFeedback.softSuppressTerms.length > 0 && (
                              <div className="space-y-1 text-xs text-slate-600">
                                <div className="font-medium text-sky-700">
                                  soft 词（建议弱化/收紧匹配）{strategyRecommendationDetailItem.data.searchTermFeedback.softSuppressTerms.length}
                                </div>
                                {strategyRecommendationDetailItem.data.searchTermFeedback.softSuppressTerms.slice(0, 30).map((term, idx) => (
                                  <div key={`soft:${term}:${idx}`}>{idx + 1}. {term}</div>
                                ))}
                              </div>
                            )}
                        </div>
                      )}
                      {(!Array.isArray(strategyRecommendationDetailItem.data?.keywordPlan) || strategyRecommendationDetailItem.data.keywordPlan.length === 0)
                        && (!Array.isArray(strategyRecommendationDetailItem.data?.negativeKeywordPlan) || strategyRecommendationDetailItem.data.negativeKeywordPlan.length === 0)
                        && (!Array.isArray(strategyRecommendationDetailItem.data?.matchTypePlan) || strategyRecommendationDetailItem.data.matchTypePlan.length === 0)
                        && (!Array.isArray(strategyRecommendationDetailItem.data?.searchTermFeedback?.hardNegativeTerms) || strategyRecommendationDetailItem.data.searchTermFeedback.hardNegativeTerms.length === 0)
                        && (!Array.isArray(strategyRecommendationDetailItem.data?.searchTermFeedback?.softSuppressTerms) || strategyRecommendationDetailItem.data.searchTermFeedback.softSuppressTerms.length === 0) && (
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

        </TabsContent>

        <TabsContent value="report" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>每日报表</CardTitle>
              <CardDescription>统计数据 + 操作记录</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <div className="space-y-2">
                  <label className="text-sm font-medium">报表日期范围</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="date"
                      value={normalizedReportStartDateForTrend}
                      max={normalizedReportDateForTrend}
                      onChange={(e) => {
                        const nextStart = e.target.value
                        if (!nextStart) return
                        setReportStartDate(nextStart)
                        if (nextStart > reportDate) {
                          setReportDate(nextStart)
                        }
                      }}
                      className="w-[170px]"
                    />
                    <span className="text-xs text-slate-500">至</span>
                    <Input
                      type="date"
                      value={normalizedReportDateForTrend}
                      min={normalizedReportStartDateForTrend}
                      onChange={(e) => {
                        const nextEnd = e.target.value
                        if (!nextEnd) return
                        setReportDate(nextEnd)
                        if (nextEnd < reportStartDate) {
                          setReportStartDate(nextEnd)
                        }
                      }}
                      className="w-[170px]"
                    />
                  </div>
                  <div className="text-xs text-slate-500">已选择 {reportDateRangeDays} 天</div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">快捷区间</label>
                  <div className="flex flex-wrap items-center gap-2">
                    {REPORT_TREND_RANGE_OPTIONS.map((option) => (
                      <Button
                        key={`report-range-${option.days}`}
                        type="button"
                        size="sm"
                        variant={
                          normalizedReportDateForTrend === parseLocalDate()
                          && normalizedReportStartDateForTrend === shiftOpenclawLocalIsoDate(parseLocalDate(), -(option.days - 1))
                            ? 'default'
                            : 'outline'
                        }
                        className="whitespace-nowrap"
                        onClick={() => handleSelectReportTrendRange(option.days)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
              {loading && <span className="text-sm text-slate-500">加载中...</span>}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:auto-rows-fr md:grid-cols-4">
            <KpiCard title="Offer数" value={reportSummary.totalOffers ?? 0} />
            <KpiCard title="Campaign数" value={reportSummary.totalCampaigns ?? 0} />
            <KpiCard title={revenueTitle} value={reportRevenueValue} />
            <KpiCard title="ROAS" value={reportRoasValue} />
          </div>

          <div className="grid gap-4 md:auto-rows-fr md:grid-cols-4">
            <KpiCard title="曝光" value={reportKpis.current?.impressions ?? 0} />
            <KpiCard title="点击" value={reportKpis.current?.clicks ?? 0} />
            <KpiCard title="转化" value={reportKpis.current?.conversions ?? 0} />
            <KpiCard title="花费" value={reportCostValue} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>预算与消耗</CardTitle>
              <CardDescription>基于当日预算统计</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:auto-rows-fr md:grid-cols-5">
              <KpiCard title="总预算" value={budgetTotalValue} />
              <KpiCard title="总花费" value={budgetSpentValue} />
              <KpiCard title="剩余预算" value={budgetRemainingValue} />
              <KpiCard title="预算使用率" value={`${budgetOverall.utilizationRate ?? 0}%`} />
              <KpiCard title="启用Campaign数" value={budgetOverall.activeCampaigns ?? 0} />
            </CardContent>
          </Card>

          <TrendChartDynamic
            data={trendData}
            metrics={[
              { key: 'impressions', label: '曝光', color: '#2563eb' },
              { key: 'clicks', label: '点击', color: '#16a34a' },
              { key: 'cost', label: '花费', color: '#f97316', yAxisId: 'right' },
              { key: 'commission', label: '佣金', color: '#9333ea', yAxisId: 'right' },
            ]}
            title="广告表现趋势"
            description={trendDescription}
            dualYAxis
            hideTimeRangeSelector
          />

          <Card>
            <CardHeader>
              <CardTitle>ROI / ROAS 分析</CardTitle>
              <CardDescription>
                {usingAffiliateCommissionRevenue
                  ? '收益口径：联盟平台佣金（PartnerBoost / YeahPromos，Campaign/Offer级）'
                  : '收益口径：联盟平台佣金（Campaign/Offer级，严格模式当前不可用）'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {usingAffiliateCommissionRevenue && affiliateRevenueBreakdown.length > 0 && (
                <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  平台拆分：
                  {affiliateRevenueBreakdown
                    .map((item) => `${item.platform || 'unknown'} ${formatMoneyWithUnit(item.totalCommission || 0, item.currency || reportRevenueCurrency)}（${item.records || 0}条）`)
                    .join(' | ')}
                </div>
              )}
              {!roiRevenueAvailable && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {roiUnavailableHint}
                </div>
              )}
              <div className="grid gap-4 md:auto-rows-fr md:grid-cols-5">
                <KpiCard title="花费" value={reportRoiCostValue} />
                <KpiCard title={revenueTitle} value={reportRevenueValue} />
                <KpiCard title="利润" value={reportProfitValue} />
                <KpiCard title="ROAS" value={reportRoasValue} />
                <KpiCard title="ROI" value={reportRoiValue} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Offer ROI Top 10</CardTitle>
              <CardDescription>收益口径：联盟佣金归因（未归因佣金将以 Unattributed 行展示）</CardDescription>
            </CardHeader>
            <CardContent>
              <Table className="[&_thead_th]:bg-white">
                <TableHeader>
                  <TableRow>
                    <TableHead>Offer</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead>Campaigns</TableHead>
                    <TableHead>Revenue</TableHead>
                    <TableHead>Cost</TableHead>
                    <TableHead>ROI</TableHead>
                    <TableHead>ROAS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topOfferRows.map((offer: any) => {
                    const cost = Number(offer.cost) || 0
                    const revenue = Number(offer.revenue) || 0
                    const roasValue = offer.roas === null || offer.roas === undefined
                      ? (cost > 0 ? revenue / cost : null)
                      : Number(offer.roas)
                    const offerLabel = offer.offerName || `Offer #${offer.offerId}`
                    const roiValue = offer.roi === null || offer.roi === undefined
                      ? '—'
                      : `${Number(offer.roi).toFixed(2)}%`
                    const roasText = roasValue === null || !Number.isFinite(roasValue)
                      ? '—'
                      : `${roasValue.toFixed(2)}x`
                    return (
                      <TableRow key={offer.offerId}>
                        <TableCell>{offerLabel}</TableCell>
                        <TableCell>{offer.brand || '-'}</TableCell>
                        <TableCell>{offer.campaignCount ?? 0}</TableCell>
                        <TableCell>{revenue}</TableCell>
                        <TableCell>{cost}</TableCell>
                        <TableCell>{roiValue}</TableCell>
                        <TableCell>{roasText}</TableCell>
                      </TableRow>
                    )
                  })}
                  {topOfferRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-slate-500">
                        暂无Offer数据
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Campaign Top 5</CardTitle>
              <CardDescription>按佣金收入排序（未归因佣金将单列展示）</CardDescription>
            </CardHeader>
            <CardContent>
              <Table className="[&_thead_th]:bg-white">
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>点击</TableHead>
                    <TableHead>花费</TableHead>
                    <TableHead>佣金</TableHead>
                    <TableHead>ROAS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topCampaigns.map((campaign: any) => (
                    <TableRow key={campaign.campaignId}>
                      <TableCell>{campaign.campaignName}</TableCell>
                      <TableCell>{campaign.status}</TableCell>
                      <TableCell>{campaign.clicks ?? 0}</TableCell>
                      <TableCell>{campaign.cost ?? 0}</TableCell>
                      <TableCell>{campaign.revenue ?? 0}</TableCell>
                      <TableCell>
                        {campaign.roas === null || campaign.roas === undefined
                          ? '—'
                          : `${Number(campaign.roas).toFixed(2)}x`}
                      </TableCell>
                    </TableRow>
                  ))}
                  {topCampaigns.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-slate-500">
                        暂无数据
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>操作记录</CardTitle>
              <CardDescription>OpenClaw 调用 AutoAds 的操作日志</CardDescription>
            </CardHeader>
            <CardContent>
              <Table className="[&_thead_th]:bg-white">
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>动作</TableHead>
                    <TableHead>目标</TableHead>
                    <TableHead>状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedReportActions.map((action: any) => (
                    <TableRow key={action.id}>
                      <TableCell>{action.created_at}</TableCell>
                      <TableCell>{action.action}</TableCell>
                      <TableCell>{action.target_type} {action.target_id}</TableCell>
                      <TableCell>
                        <Badge variant={action.status === 'success' ? 'default' : 'destructive'}>
                          {action.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {reportActions.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-slate-500">
                        暂无操作记录
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {reportActionTotalPages > 0 && (
                <div className="mt-4 border-t px-1 pt-4">
                  <ResponsivePagination
                    currentPage={reportActionCurrentPage}
                    totalPages={reportActionTotalPages}
                    totalItems={reportActions.length}
                    pageSize={reportActionPageSize}
                    onPageChange={setReportActionPage}
                    onPageSizeChange={setReportActionPageSize}
                    pageSizeOptions={reportActionPageSizeOptions}
                  />
                </div>
              )}
            </CardContent>
          </Card>

        </TabsContent>
      </Tabs>
    </div>
  )
}

function InputWithLabel(props: {
  label: string
  value: string
  placeholder?: string
  type?: string
  disabled?: boolean
  required?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">
        {props.label}
        {props.required && <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>}
      </label>
      <Input
        type={props.type}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        disabled={props.disabled}
      />
    </div>
  )
}

function SwitchWithLabel(props: {
  label: string
  checked: boolean
  disabled?: boolean
  required?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between border rounded-md px-3 py-2">
      <span className="text-sm">
        {props.label}
        {props.required && <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>}
      </span>
      <Switch checked={props.checked} onCheckedChange={props.onChange} disabled={props.disabled} />
    </div>
  )
}

function KpiCard(props: { title: string; value: string | number }) {
  return (
    <Card className="h-full">
      <CardContent className="flex h-full min-h-[96px] flex-col justify-center gap-2 py-4">
        <CardDescription className="leading-none">{props.title}</CardDescription>
        <CardTitle className="text-2xl leading-none tracking-tight tabular-nums">{props.value}</CardTitle>
      </CardContent>
    </Card>
  )
}
