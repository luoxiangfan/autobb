'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { usePagination } from '@/hooks'
import { parseAiModelsJson, setAiModelsSelectedModel } from '@/lib/openclaw/config/ai-models'
import {
  AI_GLOBAL_EDIT_KEYS,
  AI_GLOBAL_KEY_SET,
  FEISHU_CHAT_USER_KEYS,
  HIGH_RISK_COMMAND_PAGE_LIMIT,
  REPORT_TREND_RANGE_OPTIONS,
  DEFAULT_REPORT_TREND_RANGE_DAYS,
  STRATEGY_CRON_OPTIONS,
  STRATEGY_MINIMAL_USER_KEYS,
  USER_DEFAULT_VALUES,
  USER_KEYS,
} from './constants'
import type {
  DailyReport,
  FeishuChatHealthLogItem,
  FeishuChatHealthResponse,
  FeishuVerifyResultState,
  FeishuVerifySessionState,
  GatewaySkillRow,
  GatewayStatusResponse,
  OpenclawAiAuthOverrideWarning,
  OpenclawCommandRunItem,
  OpenclawCommandRunsResponse,
  OpenclawGatewayReloadResponse,
  OpenclawSettingsResponse,
  OpenclawSettingsSaveResponse,
  OpenclawStrategyRecommendation,
  StrategyBatchAction,
  StrategyBatchFailure,
  StrategyBatchScope,
  StrategyConfirmRequest,
  StrategyConfirmTone,
  StrategyRecommendationStatusFilter,
  StrategyRecommendationsResponse,
  TokenRecord,
  WorkspaceBootstrapResponse,
  WorkspaceStatusResponse,
} from './types'
import {
  formatMoneyWithUnit,
  hasText,
  isLikelyCronExpression,
  isStrategyRecommendationExecutable,
  isStrategyRecommendationQueued,
  isTruthy,
  normalizeFeishuId,
  normalizeIsoDateText,
  parseFeishuVerifyTarget,
  parseLocalDate,
  resolveNormalizedReportDateRange,
  resolveRecentHighRiskCreatedAfter,
  resolveStrategyCronPreset,
  resolveStrategyRecommendationExecuteDatePolicy,
  resolveStrategyRecommendationStatusRank,
  resolveStrategyRecommendationTypeLabel,
  resolveStrategyRecommendationTypeRank,
  shiftOpenclawLocalIsoDate,
} from './utils'
import { STRATEGY_T_MINUS_1_EXECUTABLE_TYPE_LABELS } from './utils'

export function useOpenClawPage() {
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
    pageSizeOptions: reportActionPageSizeOptions } = usePagination({ initialPageSize: 10 })
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
  const handleWorkspaceBootstrapRef = useRef<(options?: { silent?: boolean }) => Promise<boolean>>(async () => false)
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
        confirm: 'destructive' as const }
    }
    if (tone === 'warning') {
      return {
        panel: 'border-amber-200 bg-amber-50 text-amber-900',
        detail: 'text-amber-700',
        confirm: 'default' as const }
    }
    return {
      panel: 'border-sky-200 bg-sky-50 text-sky-900',
      detail: 'text-sky-700',
      confirm: 'default' as const }
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
        credentials: 'include' })

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
        limit: '200' })
      if (options?.refresh) {
        query.set('refresh', '1')
      }
      const response = await fetch(`/api/openclaw/strategy/recommendations?${query.toString()}`, {
        credentials: 'include' })
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

  const loadGatewayStatus = useCallback(async (force = false, isActive?: () => boolean) => {
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
        error: error?.message || 'Gateway 状态获取失败' })
    } finally {
      if (isActive && !isActive()) return
      setGatewayLoading(false)
    }
  }, [])

  const loadWorkspaceStatus = useCallback(async (force = false, isActive?: () => boolean) => {
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
        await handleWorkspaceBootstrapRef.current({ silent: true })
        return
      }

      setWorkspaceStatus(payload)
    } catch (error: any) {
      if (isActive && !isActive()) return
      setWorkspaceStatus({
        success: false,
        error: error?.message || 'SOUL 工作区状态获取失败' })
    } finally {
      if (isActive && !isActive()) return
      setWorkspaceLoading(false)
    }
  }, [])

  const loadOpenClawPageData = useCallback(async (isActive: () => boolean) => {
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
        limit: '200' })

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

      if (!isActive()) return

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
      if (!isActive()) return
      toast.error(error?.message || 'OpenClaw 配置加载失败')
    } finally {
      if (isActive()) setLoading(false)
    }
  }, [reportDate, reportStartDate, router])

  useEffect(() => {
    let active = true
    const isActive = () => active
    void loadOpenClawPageData(isActive)
    void loadGatewayStatus(false, isActive)
    void loadWorkspaceStatus(false, isActive)
    return () => {
      active = false
    }
  }, [refreshKey, loadOpenClawPageData, loadGatewayStatus, loadWorkspaceStatus])

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
        createdAfter: resolveRecentHighRiskCreatedAfter() })
      const response = await fetch(`/api/openclaw/commands/runs?${query.toString()}`, {
        credentials: 'include' })
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
      isActive: () => active })
    const timer = window.setInterval(() => {
      void loadPendingCommandRuns({
        silent: true,
        page: pendingCommandRunsPage,
        isActive: () => active })
    }, 30000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [settings?.userId, refreshKey, pendingCommandRunsPage, loadPendingCommandRuns])

  const handleWorkspaceBootstrap = useCallback(async (options?: { silent?: boolean }): Promise<boolean> => {
    const silent = options?.silent === true
    setWorkspaceBootstrapping(true)
    try {
      const response = await fetch('/api/openclaw/workspace/bootstrap', {
        method: 'POST',
        credentials: 'include' })
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
  }, [loadWorkspaceStatus])

  handleWorkspaceBootstrapRef.current = handleWorkspaceBootstrap

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
        credentials: 'include' })
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
          openclaw_strategy_enabled: isTruthy(normalizedUserValues.openclaw_strategy_enabled, false) ? 'true' : 'false' }
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
        body: JSON.stringify({ scope, updates }) })
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
        body: JSON.stringify({ name: 'OpenClaw Access' }) })

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
        credentials: 'include' })

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
          target }) })
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
          expectedSenderOpenId: expectedSenderOpenId || undefined }) })

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
        message: payload?.message || '验证码已发送，请回复验证码后校验回执' })
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
          verificationId: feishuVerifySession.verificationId }) })

      const payload = await response.json().catch(() => null)
      const message = payload?.message || payload?.error || '校验双向通信状态失败'
      const verified = Boolean(payload?.verified)
      const pending = Boolean(payload?.pending)

      setFeishuVerifyResult({
        verified,
        pending,
        message })

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
            expectedSenderOpenId: expectedSenderOpenId || prev.expectedSenderOpenId }
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
        tone: 'warning' })
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
          syncReportDate: true })
        setSelectedStrategyRecommendationIds([])
        toast.success('分析完成，优化建议已更新')
      } else {
        const response = await fetch('/api/openclaw/strategy/recommendations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ date: targetDate, limit: 200 }) })
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
      fallbackReportDate: strategyDisplayDate })
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
      tone: 'danger' })
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
      tone: 'info' })
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
      body: body ? JSON.stringify(body) : undefined })
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
  const budgetSpentValue = formatMoneyWithUnit(
    budgetOverall.totalSpentAllCampaigns ?? budgetOverall.totalSpent ?? 0,
    budgetCurrency
  )
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
      fallbackReportDate: strategyDisplayDate })
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
      executable: 0 }

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
        isActive: () => active })
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
        tone: 'danger' })
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
        tone: 'warning' })
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
            message: error?.message || `${item.id} ${action} 失败` })
        }
      }

      await loadStrategyRecommendations({
        refresh: false,
        silent: true,
        date: strategyRecommendationsReportDate || reportDate,
        syncReportDate: false })
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
        installHint }
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
        : (gatewayStatus?.error || '待检测') },
    {
      id: 'ai',
      label: 'AI引擎',
      done: canEditAiSettings ? aiConfigured : true,
      note: canEditAiSettings
        ? (aiConfigured ? (aiModelLabel ? '当前：' + aiModelLabel : '已配置 Providers JSON') : '未配置')
        : '成员无需配置（管理员统一维护）' },
    {
      id: 'strategy',
      label: '自动分析',
      done: isTruthy(userValues.openclaw_strategy_enabled, false),
      note: isTruthy(userValues.openclaw_strategy_enabled, false) ? '已启用' : '未启用' },
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
    error: 0 }
  const feishuHealthExecutionStats = feishuHealthData?.stats?.execution || {
    linked: 0,
    completed: 0,
    inProgress: 0,
    waiting: 0,
    missing: 0,
    failed: 0,
    notApplicable: 0,
    unknown: 0 }
  const feishuHealthWorkflowStats = feishuHealthData?.stats?.workflow || {
    tracked: 0,
    completed: 0,
    running: 0,
    incomplete: 0,
    failed: 0,
    notRequired: 0,
    unknown: 0 }
  const feishuHealthWindowHours = feishuHealthData?.windowHours || 24 * 7
  const feishuHealthWindowDays = Math.max(1, Math.floor(feishuHealthWindowHours / 24))
  const feishuHealthRetentionDays = feishuHealthData?.retentionDays || 7
  const feishuHealthExcerptLimit = feishuHealthData?.excerptLimit || 500
  const feishuHealthExecutionMissingSeconds = feishuHealthData?.executionMissingSeconds || 180

  return {
    affiliateRevenueBreakdown,
    affiliateRevenueCurrencies,
    aiConfigured,
    aiDirty,
    aiJsonError,
    aiModelLabel,
    aiModelOptions,
    aiModelsInfo,
    aiSectionDirty,
    aiSelectedModelMeta,
    aiSelectedModelRef,
    budgetCurrency,
    budgetOverall,
    budgetRemainingValue,
    budgetSpentValue,
    budgetTotalValue,
    campaignRows,
    canEditAiSettings,
    canReloadFromWorkspace,
    canRunFeishuConnectionTest,
    canRunFeishuVerifyStart,
    closeStrategyConfirmDialog,
    feishuChatDirty,
    feishuHealthData,
    feishuHealthDialogItem,
    feishuHealthError,
    feishuHealthExcerptLimit,
    feishuHealthExecutionMissingSeconds,
    feishuHealthExecutionStats,
    feishuHealthLoading,
    feishuHealthRetentionDays,
    feishuHealthRows,
    feishuHealthStats,
    feishuHealthWindowDays,
    feishuHealthWindowHours,
    feishuHealthWorkflowStats,
    feishuTestLoading,
    feishuTestResult,
    feishuVerifyChecking,
    feishuVerifyExpiresInMs,
    feishuVerifyLoading,
    feishuVerifyNeedsSenderOpenId,
    feishuVerifyNow,
    feishuVerifyParsedTarget,
    feishuVerifyResult,
    feishuVerifySenderOpenId,
    feishuVerifySession,
    gatewayHealth,
    gatewayLoading,
    gatewayReloading,
    gatewayShowAvailableOnly,
    gatewaySkillsCollapsed,
    gatewaySkillsList,
    gatewaySkillsReport,
    gatewaySkillsRows,
    gatewaySkillsSummary,
    gatewayStatus,
    gatewayVisibleSkills,
    handleAiModelChange,
    handleBatchDismissStrategyRecommendations,
    handleBatchExecuteStrategyRecommendations,
    handleCreateToken,
    handleDismissStrategyRecommendation,
    handleExecuteStrategyRecommendation,
    handleFeishuCheckVerify,
    handleFeishuStartVerify,
    handleFeishuTestConnection,
    handleFormatAiJson,
    handleGatewayHotReload,
    handleRetryFailedStrategyRecommendations,
    handleRevokeToken,
    handleSelectAllStrategyRecommendations,
    handleSelectReportTrendRange,
    handleStrategyCronPresetChange,
    handleTriggerStrategyRecommendations,
    handleWorkspaceBootstrap,
    handleWorkspaceBootstrapAndReload,
    handleWorkspaceBootstrapRef,
    hasQueuedStrategyRecommendations,
    hasUserDirtyFields,
    isStrategyRecommendationBatchEligible,
    isStrategyRecommendationExecutableInCurrentWindow,
    loadFeishuHealthData,
    loadGatewayStatus,
    loadOpenClawPageData,
    loadPendingCommandRuns,
    loadStrategyRecommendations,
    loadWorkspaceStatus,
    loading,
    newToken,
    normalizedReportDateForTrend,
    normalizedReportRange,
    normalizedReportStartDateForTrend,
    offerRows,
    pagedReportActions,
    pendingCommandCount,
    pendingCommandRuns,
    pendingCommandRunsError,
    pendingCommandRunsLoading,
    pendingCommandRunsPage,
    pendingCommandRunsTotal,
    pendingCommandRunsTotalPages,
    refreshKey,
    report,
    reportActionCurrentPage,
    reportActionPageSize,
    reportActionPageSizeOptions,
    reportActionTotalPages,
    reportActions,
    reportBudgetCurrencyRaw,
    reportCostCurrency,
    reportCostValue,
    reportDate,
    reportDateRangeDays,
    reportKpis,
    reportProfitValue,
    reportRevenueCurrency,
    reportRevenueValue,
    reportRoas,
    reportRoasValue,
    reportRoi,
    reportRoiCostValue,
    reportRoiCurrencyRaw,
    reportRoiValue,
    reportStartDate,
    reportSummary,
    requestStrategyConfirm,
    requestStrategyRecommendationAction,
    resolveStrategyConfirmToneClasses,
    revenueTitle,
    roiRevenueAvailable,
    roiRevenueSource,
    roiUnavailableHint,
    roiUnavailableReason,
    router,
    runStrategyRecommendationBatchAction,
    saveSettings,
    savedUserValues,
    savingUser,
    selectableStrategyRecommendations,
    selectedDismissibleCount,
    selectedExecutableCount,
    selectedHiddenCount,
    selectedSelectableCount,
    selectedStrategyRecommendationIds,
    selectedStrategyRecommendationSet,
    selectedVisibleCount,
    setAiJsonError,
    setFeishuHealthData,
    setFeishuHealthDialogItem,
    setFeishuHealthError,
    setFeishuHealthLoading,
    setFeishuTestLoading,
    setFeishuTestResult,
    setFeishuVerifyChecking,
    setFeishuVerifyLoading,
    setFeishuVerifyNow,
    setFeishuVerifyResult,
    setFeishuVerifySenderOpenId,
    setFeishuVerifySession,
    setGatewayLoading,
    setGatewayReloading,
    setGatewayShowAvailableOnly,
    setGatewaySkillsCollapsed,
    setGatewayStatus,
    setLoading,
    setNewToken,
    setPendingCommandRuns,
    setPendingCommandRunsError,
    setPendingCommandRunsLoading,
    setPendingCommandRunsPage,
    setPendingCommandRunsTotal,
    setPendingCommandRunsTotalPages,
    setReportActionPage,
    setReportActionPageSize,
    setReport,
    setReportDate,
    setReportStartDate,
    setSavedUserValues,
    setSavingUser,
    setSelectedStrategyRecommendationIds,
    setSettings,
    setShowFeishuAdvanced,
    setStrategyAnalyzeSendFeishu,
    setStrategyBatchDismissing,
    setStrategyBatchExecuting,
    setStrategyBatchFailures,
    setStrategyBatchLastAction,
    setStrategyBatchScope,
    setStrategyConfirmAcknowledge,
    setStrategyConfirmDialog,
    setStrategyCronPreset,
    setStrategyManualTriggering,
    setStrategyRecommendationDetailItem,
    setStrategyRecommendationDismissingId,
    setStrategyRecommendationExecutingId,
    setStrategyRecommendationStatusFilter,
    setStrategyRecommendations,
    setStrategyRecommendationsDisplayMode,
    setStrategyRecommendationsLoaded,
    setStrategyRecommendationsLoading,
    setStrategyRecommendationsReportDate,
    setStrategyServerDate,
    setTokens,
    setUserValue,
    setUserValues,
    setWorkspaceBootstrapping,
    setWorkspaceLoading,
    setWorkspaceStatus,
    settings,
    setupCards,
    setupCompletedCount,
    setupProgressPercent,
    showAiAuthOverrideWarnings,
    showFeishuAdvanced,
    strategyAnalyzeSendFeishu,
    strategyBatchActionPool,
    strategyBatchDismissing,
    strategyBatchExecuting,
    strategyBatchFailures,
    strategyBatchLastAction,
    strategyBatchScope,
    strategyConfirmAcknowledge,
    strategyConfirmDialog,
    strategyConfirmResolverRef,
    strategyConfirmToneClasses,
    strategyCronPreset,
    strategyDateNormalized,
    strategyDirty,
    strategyDisplayDate,
    strategyHistoricalReadOnly,
    strategyManualTriggering,
    strategyRecommendationActionBusy,
    strategyRecommendationDetailItem,
    strategyRecommendationDismissingId,
    strategyRecommendationExecutingId,
    strategyRecommendationStatusFilter,
    strategyRecommendationSummary,
    strategyRecommendations,
    strategyRecommendationsAllSelected,
    strategyRecommendationsDisplay,
    strategyRecommendationsDisplayMode,
    strategyRecommendationsFiltered,
    strategyRecommendationsLoaded,
    strategyRecommendationsLoading,
    strategyRecommendationsPartiallySelected,
    strategyRecommendationsReportDate,
    strategyRecommendationsView,
    strategySaveKeys,
    strategyServerDate,
    strategyServerDateDisplay,
    toggleStrategyRecommendationSelected,
    tokens,
    topCampaigns,
    topOfferRows,
    totalCost,
    totalRevenue,
    totalRevenueRaw,
    trendData,
    trendDescription,
    unknownQueueTaskCount,
    userValues,
    usingAffiliateCommissionRevenue,
    validateAiJson,
    workspaceAutoBootstrapTriedRef,
    workspaceBootstrapping,
    workspaceFiles,
    workspaceLoading,
    workspaceMissingFiles,
    workspaceReady,
    workspaceSourceLabel,
    workspaceStatus,
  }
}

export type OpenClawPageViewModel = ReturnType<typeof useOpenClawPage>
