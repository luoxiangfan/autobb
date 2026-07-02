import {
  HIGH_RISK_COMMAND_LOOKBACK_DAYS,
  OPENCLAW_TIMEZONE,
  STRATEGY_CRON_OPTIONS,
} from './constants'
import type {
  FeishuChatExecutionState,
  FeishuChatHealthDecision,
  FeishuChatHealthLogItem,
  FeishuChatWorkflowState,
  FeishuReceiveIdType,
  OpenclawCommandRiskLevel,
  OpenclawStrategyRecommendation,
} from './types'

export const parseLocalDate = (value?: string | null) => {
  if (value) return value
  const now = new Date()
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: OPENCLAW_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit' }).format(now)
  return iso
}

export const normalizeIsoDateText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  const raw = String(value).trim()
  if (!raw) return null
  const matched = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  return matched ? matched[1] : null
}

export const resolveNormalizedReportDateRange = (startValue?: string | null, endValue?: string | null): {
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
    days: Math.max(1, days) }
}

export const isTruthy = (value?: string | null, fallback: boolean = false) => {
  if (value === null || value === undefined || value === '') return fallback
  const normalized = value.toLowerCase()
  return normalized === 'true' || normalized === '1'
}

export const hasText = (value?: string | null) => Boolean(value && value.trim())

export const normalizeFeishuId = (value?: string | null) => String(value || '').trim().replace(/^(feishu|lark):/i, '').toLowerCase()

export function parseFeishuVerifyTarget(input?: string | null): {
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

export const resolveStrategyCronPreset = (cron: string) => {
  const normalized = cron.trim().replace(/\s+/g, ' ')
  const matched = STRATEGY_CRON_OPTIONS.find((option) => option.id !== 'custom' && option.cron === normalized)
  return matched?.id || 'custom'
}

export const isLikelyCronExpression = (value: string) => {
  const parts = value.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const partPattern = /^(\*|\*\/\d+|\d+(?:-\d+)?(?:\/\d+)?|\d+(?:,\d+)+)$/
  return parts.every((part) => partPattern.test(part))
}

export const formatTimestamp = (value?: number | string | null) => {
  if (!value) return '未知'
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return '未知'
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short' }).format(date)
}

export const formatTimestampCompactLines = (value?: number | string | null): { date: string; time: string } => {
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
    time: `${hours}:${minutes}:${seconds}` }
}

export const formatDuration = (ms?: number | null) => {
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

export const formatCountdown = (ms?: number | null) => {
  if (!Number.isFinite(ms) || ms === null || ms === undefined) return '未知'
  if (ms <= 0) return '已过期'
  const totalSeconds = Math.ceil(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}分${String(seconds).padStart(2, '0')}秒`
}

export const formatNumber = (value: unknown, digits = 2): string => {
  if (value === null || value === undefined) return '--'
  if (typeof value === 'string' && value.trim() === '') return '--'
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '--'
  return parsed.toFixed(digits)
}

export const normalizeCurrencyCode = (value?: string | null): string => {
  const normalized = String(value || '').trim().toUpperCase()
  return /^[A-Z]{3}$/.test(normalized) ? normalized : 'USD'
}

export const formatMoney = (value: unknown, currency?: string | null, digits = 2): string => {
  if (value === null || value === undefined) return '--'
  if (typeof value === 'string' && value.trim() === '') return '--'
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '--'
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits }).format(parsed)
  return `${formatted} ${normalizeCurrencyCode(currency)}`
}

export const formatMoneyWithUnit = (value: unknown, currency?: string | null, digits = 2): string => {
  if (value === null || value === undefined) return '--'
  if (typeof value === 'string' && value.trim() === '') return '--'
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '--'
  const normalized = String(currency || '').trim().toUpperCase()
  if (normalized === 'MIXED') {
    const formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits }).format(parsed)
    return `${formatted} MIXED`
  }
  return formatMoney(parsed, normalized || 'USD', digits)
}

export const resolveImpactConfidenceText = (value?: string | null): string => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'high') return '高'
  if (normalized === 'medium') return '中'
  return '低'
}

export const resolveImpactEstimationSourceText = (value?: string | null): string => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'observed_roas') return '估算口径：实测ROAS'
  if (normalized === 'fallback_lag_protected') return '估算口径：滞后保护回退'
  if (normalized === 'fallback_default') return '估算口径：默认回退'
  return ''
}

export const resolveStrategyRecommendationTypeLabel = (type: OpenclawStrategyRecommendation['recommendationType']) => {
  if (type === 'adjust_cpc') return 'CPC调整'
  if (type === 'adjust_budget') return '预算调整'
  if (type === 'offline_campaign') return '下线Campaign'
  if (type === 'expand_keywords') return '补充Search Terms关键词'
  if (type === 'add_negative_keywords') return '新增否词'
  if (type === 'optimize_match_type') return '匹配类型优化'
  return type
}

export const resolveStrategyRecommendationTypeTone = (type: OpenclawStrategyRecommendation['recommendationType']): string => {
  if (type === 'offline_campaign') return 'border-rose-200 bg-rose-50 text-rose-700'
  if (type === 'adjust_budget') return 'border-sky-200 bg-sky-50 text-sky-700'
  if (type === 'adjust_cpc') return 'border-indigo-200 bg-indigo-50 text-indigo-700'
  if (type === 'expand_keywords') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (type === 'add_negative_keywords') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (type === 'optimize_match_type') return 'border-teal-200 bg-teal-50 text-teal-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

export const resolveStrategyRecommendationStatusBadge = (status: OpenclawStrategyRecommendation['status']) => {
  if (status === 'executed') return { label: '已执行', variant: 'default' as const }
  if (status === 'failed') return { label: '执行失败', variant: 'destructive' as const }
  if (status === 'stale') return { label: '待重算', variant: 'secondary' as const }
  if (status === 'dismissed') return { label: '暂不执行', variant: 'outline' as const }
  return { label: '待执行', variant: 'outline' as const }
}

export const isStrategyRecommendationQueued = (item: OpenclawStrategyRecommendation): boolean => {
  const queueStatus = String(item.executionResult?.queueTaskStatus || '').toLowerCase()
  if (queueStatus === 'pending' || queueStatus === 'running') return true
  return item.executionResult?.queued === true
}

export const STRATEGY_T_MINUS_1_EXECUTABLE_TYPES = new Set<OpenclawStrategyRecommendation['recommendationType']>([
  'adjust_cpc',
  'adjust_budget',
  'expand_keywords',
  'add_negative_keywords',
  'optimize_match_type',
])
export const STRATEGY_T_MINUS_1_EXECUTABLE_TYPE_LABELS = 'CPC调整、预算调整、补充Search Terms关键词、新增否词、匹配类型优化'

export const shiftOpenclawLocalIsoDate = (dateText: string, offsetDays: number): string => {
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
    day: '2-digit' }).format(new Date(baseMs + offsetDays * 24 * 60 * 60 * 1000))
}

export type StrategyRecommendationExecuteDatePolicy = {
  allowed: boolean
  reason: 'same_day' | 't_minus_1_allowed' | 't_minus_1_type_blocked' | 'out_of_window' | 'unknown_date'
  reportDate: string
  serverDate: string
  tMinus1Date: string
}

export const resolveStrategyRecommendationExecuteDatePolicy = (params: {
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
      tMinus1Date }
  }

  if (reportDate === serverDate) {
    return {
      allowed: true,
      reason: 'same_day',
      reportDate,
      serverDate,
      tMinus1Date }
  }

  if (reportDate === tMinus1Date) {
    if (STRATEGY_T_MINUS_1_EXECUTABLE_TYPES.has(params.recommendation.recommendationType)) {
      return {
        allowed: true,
        reason: 't_minus_1_allowed',
        reportDate,
        serverDate,
        tMinus1Date }
    }
    return {
      allowed: false,
      reason: 't_minus_1_type_blocked',
      reportDate,
      serverDate,
      tMinus1Date }
  }

  return {
    allowed: false,
    reason: 'out_of_window',
    reportDate,
    serverDate,
    tMinus1Date }
}

export const isStrategyRecommendationExecutable = (item: OpenclawStrategyRecommendation): boolean => {
  if (item.status === 'executed' || item.status === 'dismissed' || item.status === 'stale') {
    return false
  }
  return !isStrategyRecommendationQueued(item)
}

export const resolvePostReviewStatusText = (status?: string | null) => {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'effective') return '复盘：有效'
  if (normalized === 'mixed') return '复盘：部分有效'
  if (normalized === 'ineffective') return '复盘：无效'
  if (normalized === 'no_data') return '复盘：样本不足'
  if (normalized === 'pending_window') return '复盘：观察中'
  return ''
}

export const resolveStrategyRecommendationTypeRank = (type: OpenclawStrategyRecommendation['recommendationType']): number => {
  if (type === 'offline_campaign') return 4
  if (type === 'adjust_budget') return 3
  if (type === 'add_negative_keywords') return 2.8
  if (type === 'optimize_match_type') return 2.6
  if (type === 'adjust_cpc') return 2
  return 1
}

export const resolveStrategyRecommendationStatusRank = (status: OpenclawStrategyRecommendation['status']): number => {
  if (status === 'pending') return 5
  if (status === 'failed') return 4.4
  if (status === 'stale') return 4
  if (status === 'dismissed') return 2
  return 1
}

export const renderTriState = (value?: boolean | null) => {
  if (value === true) return '是'
  if (value === false) return '否'
  return '未知'
}

export const resolveFeishuHealthDecisionBadge = (decision: FeishuChatHealthDecision): {
  label: string
  variant: 'default' | 'secondary' | 'outline' | 'destructive'
} => {
  if (decision === 'allowed') return { label: '放行', variant: 'default' }
  if (decision === 'blocked') return { label: '拦截', variant: 'outline' }
  return { label: '错误', variant: 'destructive' }
}

export const resolveFeishuHealthSenderText = (row: FeishuChatHealthLogItem): string => {
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

export const resolveFeishuExecutionBadge = (state: FeishuChatExecutionState): {
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

export const resolveFeishuWorkflowBadge = (state: FeishuChatWorkflowState): {
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

export const resolveCommandRiskBadge = (riskLevel: OpenclawCommandRiskLevel): {
  label: string
  variant: 'default' | 'secondary' | 'outline' | 'destructive'
} => {
  if (riskLevel === 'critical') return { label: 'critical', variant: 'destructive' }
  if (riskLevel === 'high') return { label: 'high', variant: 'destructive' }
  if (riskLevel === 'medium') return { label: 'medium', variant: 'secondary' }
  return { label: 'low', variant: 'outline' }
}

export const resolveCommandConfirmStatusText = (status?: string | null): string => {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'pending') return '待确认'
  if (normalized === 'confirmed') return '已确认'
  if (normalized === 'canceled') return '已取消'
  if (normalized === 'expired') return '已过期'
  return normalized || '-'
}

export const formatFeishuRunIdShort = (value?: string | null): string => {
  const text = String(value || '').trim()
  if (!text) return '-'
  if (text.length <= 12) return text
  return `${text.slice(0, 12)}...`
}

export const formatAgeSeconds = (value?: number): string => {
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

export const resolveRecentHighRiskCreatedAfter = (): string => {
  const lookbackMs = HIGH_RISK_COMMAND_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  return new Date(Date.now() - lookbackMs).toISOString()
}
