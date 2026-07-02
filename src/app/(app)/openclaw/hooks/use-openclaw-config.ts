/* eslint-disable react-hooks/exhaustive-deps -- setters from useOpenClawPageState are stable */
'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { parseAiModelsJson, setAiModelsSelectedModel } from '@/lib/openclaw/config/ai-models'
import {
  AI_GLOBAL_EDIT_KEYS,
  FEISHU_CHAT_USER_KEYS,
  HIGH_RISK_COMMAND_PAGE_LIMIT,
  STRATEGY_MINIMAL_USER_KEYS,
} from '../constants'
import type {
  FeishuVerifySessionState,
  GatewaySkillRow,
  GatewayStatusResponse,
  OpenclawAiAuthOverrideWarning,
  OpenclawCommandRunsResponse,
  OpenclawGatewayReloadResponse,
  WorkspaceBootstrapResponse,
} from '../types'
import {
  hasText,
  isTruthy,
  normalizeFeishuId,
  parseFeishuVerifyTarget,
  resolveRecentHighRiskCreatedAfter,
} from '../utils'

import type { OpenClawPageState } from './use-openclaw-page-state'

type SettingsSlice = {
  showAiAuthOverrideWarnings: (warnings: OpenclawAiAuthOverrideWarning[] | undefined) => void
  setUserValue: (key: string, value: string) => void
  hasUserDirtyFields: (keys: readonly string[]) => boolean
}

export function useOpenClawConfig(state: OpenClawPageState, settingsSlice: SettingsSlice) {
  const { showAiAuthOverrideWarnings, setUserValue, hasUserDirtyFields } = settingsSlice
  const {
    settings,
    userValues,
    gatewayStatus,
    setGatewayStatus,
    setGatewayLoading,
    setGatewayReloading,
    gatewayShowAvailableOnly,
    workspaceStatus,
    setWorkspaceStatus,
    setWorkspaceLoading,
    setWorkspaceBootstrapping,
    workspaceAutoBootstrapTriedRef,
    handleWorkspaceBootstrapRef,
    setFeishuTestLoading,
    setFeishuTestResult,
    setFeishuVerifyLoading,
    setFeishuVerifyChecking,
    feishuVerifySenderOpenId,
    setFeishuVerifySenderOpenId,
    feishuVerifySession,
    setFeishuVerifySession,
    setFeishuVerifyResult,
    feishuVerifyNow,
    setFeishuVerifyNow,
    setAiJsonError,
    setPendingCommandRuns,
    setPendingCommandRunsLoading,
    setPendingCommandRunsError,
    setPendingCommandRunsPage,
    setPendingCommandRunsTotal,
    setPendingCommandRunsTotalPages,
    pendingCommandRunsTotal,
  } = state

  useEffect(() => {
    if (!feishuVerifySession) return
    const timer = window.setInterval(() => {
      setFeishuVerifyNow(Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [feishuVerifySession])

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

  return {
    loadGatewayStatus,
    loadWorkspaceStatus,
    loadPendingCommandRuns,
    handleWorkspaceBootstrap,
    handleWorkspaceBootstrapAndReload,
    handleGatewayHotReload,
    handleFeishuTestConnection,
    handleFeishuStartVerify,
    handleFeishuCheckVerify,
    handleFormatAiJson,
    validateAiJson,
    aiModelsInfo,
    aiModelOptions,
    aiSelectedModelRef,
    aiSelectedModelMeta,
    handleAiModelChange,
    gatewayHealth,
    gatewaySkillsReport,
    gatewaySkillsList,
    gatewaySkillsSummary,
    gatewaySkillsRows,
    gatewayVisibleSkills,
    workspaceFiles,
    workspaceMissingFiles,
    workspaceReady,
    workspaceSourceLabel,
    canReloadFromWorkspace,
    canEditAiSettings,
    aiConfigured,
    aiModelLabel,
    canRunFeishuConnectionTest,
    canRunFeishuVerifyStart,
    feishuVerifyParsedTarget,
    feishuVerifyNeedsSenderOpenId,
    feishuVerifyExpiresInMs,
    setupCards,
    setupCompletedCount,
    setupProgressPercent,
    aiDirty,
    aiSectionDirty,
    feishuChatDirty,
    pendingCommandCount,
    strategyDirty,
  }
}
