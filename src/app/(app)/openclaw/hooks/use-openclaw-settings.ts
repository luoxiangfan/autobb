/* eslint-disable react-hooks/exhaustive-deps -- setters from useOpenClawPageState are stable */
'use client'

import { useCallback } from 'react'
import { toast } from 'sonner'
import {
  AI_GLOBAL_KEY_SET,
  FEISHU_CHAT_USER_KEYS,
  STRATEGY_MINIMAL_USER_KEYS,
  USER_DEFAULT_VALUES,
  USER_KEYS,
} from '../constants'
import type {
  OpenclawAiAuthOverrideWarning,
  OpenclawSettingsResponse,
  OpenclawSettingsSaveResponse,
  StrategyRecommendationsResponse,
} from '../types'
import {
  hasText,
  isLikelyCronExpression,
  isTruthy,
  normalizeIsoDateText,
  parseLocalDate,
  resolveNormalizedReportDateRange,
} from '../utils'

import type { OpenClawPageState } from './use-openclaw-page-state'

export function useOpenClawSettings(state: OpenClawPageState) {
  const {
    router,
    setSettings,
    userValues,
    setUserValues,
    savedUserValues,
    setSavedUserValues,
    setTokens,
    setNewToken,
    reportDate,
    reportStartDate,
    setReportDate,
    setReportStartDate,
    setReport,
    setLoading,
    setSavingUser,
    setStrategyRecommendations,
    setStrategyRecommendationsLoaded,
    setStrategyRecommendationsReportDate,
    setStrategyServerDate,
  } = state

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


  const strategySaveKeys = [...STRATEGY_MINIMAL_USER_KEYS]

  const setUserValue = (key: string, value: string) => {
    setUserValues(prev => ({ ...prev, [key]: value }))
  }

  const hasUserDirtyFields = (keys: readonly string[]) => {
    const current = userValues
    const saved = savedUserValues
    return keys.some((key) => (current[key] ?? '') !== (saved[key] ?? ''))
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


  return {
    showAiAuthOverrideWarnings,
    loadOpenClawPageData,
    strategySaveKeys,
    setUserValue,
    hasUserDirtyFields,
    saveSettings,
    handleCreateToken,
    handleRevokeToken,
  }
}
