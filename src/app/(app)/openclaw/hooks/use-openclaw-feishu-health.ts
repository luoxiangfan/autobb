/* eslint-disable react-hooks/exhaustive-deps -- setters from useOpenClawPageState are stable */
'use client'

import { useCallback, useEffect } from 'react'


import type {
  FeishuChatHealthResponse,
} from '../types'



import type { OpenClawPageState } from './use-openclaw-page-state'

export function useOpenClawFeishuHealth(state: OpenClawPageState) {
  const {
    settings,
    setFeishuHealthData,
    setFeishuHealthDialogItem,
    setFeishuHealthError,
    setFeishuHealthLoading,
    feishuHealthData,
  } = state

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
    loadFeishuHealthData,
    feishuHealthRows,
    feishuHealthStats,
    feishuHealthExecutionStats,
    feishuHealthWorkflowStats,
    feishuHealthWindowHours,
    feishuHealthWindowDays,
    feishuHealthRetentionDays,
    feishuHealthExcerptLimit,
    feishuHealthExecutionMissingSeconds,
  }
}
