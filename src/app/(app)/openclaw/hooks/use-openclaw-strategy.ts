/* eslint-disable react-hooks/exhaustive-deps -- setters from useOpenClawPageState are stable */
'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import {
  STRATEGY_CRON_OPTIONS,
} from '../constants'
import type {
  OpenclawStrategyRecommendation,
  StrategyBatchAction,
  StrategyBatchFailure,
  StrategyConfirmRequest,
  StrategyConfirmTone,
  StrategyRecommendationsResponse,
} from '../types'
import {
  isStrategyRecommendationExecutable,
  isStrategyRecommendationQueued,
  parseLocalDate,
  resolveStrategyCronPreset,
  resolveStrategyRecommendationExecuteDatePolicy,
  resolveStrategyRecommendationStatusRank,
  resolveStrategyRecommendationTypeLabel,
  resolveStrategyRecommendationTypeRank,
  STRATEGY_T_MINUS_1_EXECUTABLE_TYPE_LABELS,
} from '../utils'

import type { OpenClawPageState } from './use-openclaw-page-state'

type SettingsSlice = {
  setUserValue: (key: string, value: string) => void
}

export function useOpenClawStrategy(state: OpenClawPageState, settingsSlice: SettingsSlice) {
  const { setUserValue } = settingsSlice
  const {
    userValues,
    reportDate,
    setReportDate,
    report,
    setRefreshKey,
    strategyRecommendations,
    setStrategyRecommendations,
    strategyRecommendationsLoaded,
    setStrategyRecommendationsLoaded,
    setStrategyRecommendationsLoading,
    strategyAnalyzeSendFeishu,
    strategyRecommendationsReportDate,
    setStrategyRecommendationsReportDate,
    strategyServerDate,
    setStrategyServerDate,
    strategyRecommendationsDisplayMode,
    strategyRecommendationStatusFilter,
    strategyBatchScope,
    selectedStrategyRecommendationIds,
    setSelectedStrategyRecommendationIds,
    strategyBatchExecuting,
    setStrategyBatchExecuting,
    strategyBatchDismissing,
    setStrategyBatchDismissing,
    strategyBatchLastAction,
    setStrategyBatchLastAction,
    strategyBatchFailures,
    setStrategyBatchFailures,
    strategyRecommendationExecutingId,
    setStrategyRecommendationExecutingId,
    strategyRecommendationDismissingId,
    setStrategyRecommendationDismissingId,
    strategyConfirmDialog,
    setStrategyConfirmDialog,
    strategyConfirmResolverRef,
    setStrategyConfirmAcknowledge,
    setStrategyCronPreset,
    setStrategyManualTriggering,
  } = state

  useEffect(() => {
    setStrategyCronPreset(resolveStrategyCronPreset(userValues.openclaw_strategy_cron || ''))
  }, [userValues.openclaw_strategy_cron])

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

  const handleStrategyCronPresetChange = (presetId: string) => {
    setStrategyCronPreset(presetId)
    const preset = STRATEGY_CRON_OPTIONS.find(option => option.id === presetId)
    if (!preset || preset.id === 'custom') return
    setUserValue('openclaw_strategy_cron', preset.cron)
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

  return {
    resolveStrategyConfirmToneClasses,
    strategyConfirmToneClasses,
    closeStrategyConfirmDialog,
    requestStrategyConfirm,
    loadStrategyRecommendations,
    handleStrategyCronPresetChange,
    handleTriggerStrategyRecommendations,
    handleExecuteStrategyRecommendation,
    handleDismissStrategyRecommendation,
    strategyRecommendationActionBusy,
    requestStrategyRecommendationAction,
    strategyDisplayDate,
    strategyServerDateDisplay,
    strategyDateNormalized,
    strategyHistoricalReadOnly,
    isStrategyRecommendationExecutableInCurrentWindow,
    strategyRecommendationsView,
    strategyRecommendationsFiltered,
    strategyRecommendationsDisplay,
    strategyRecommendationSummary,
    strategyBatchActionPool,
    selectedStrategyRecommendationSet,
    selectableStrategyRecommendations,
    selectedSelectableCount,
    selectedVisibleCount,
    selectedHiddenCount,
    selectedExecutableCount,
    selectedDismissibleCount,
    strategyRecommendationsAllSelected,
    strategyRecommendationsPartiallySelected,
    hasQueuedStrategyRecommendations,
    unknownQueueTaskCount,
    toggleStrategyRecommendationSelected,
    handleSelectAllStrategyRecommendations,
    isStrategyRecommendationBatchEligible,
    runStrategyRecommendationBatchAction,
    handleBatchExecuteStrategyRecommendations,
    handleBatchDismissStrategyRecommendations,
    handleRetryFailedStrategyRecommendations,
  }
}
