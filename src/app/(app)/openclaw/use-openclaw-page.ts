'use client'

import { useEffect } from 'react'
import { useOpenClawPageState } from './hooks/use-openclaw-page-state'
import { useOpenClawSettings } from './hooks/use-openclaw-settings'
import { useOpenClawConfig } from './hooks/use-openclaw-config'
import { useOpenClawStrategy } from './hooks/use-openclaw-strategy'
import { useOpenClawReport } from './hooks/use-openclaw-report'
import { useOpenClawFeishuHealth } from './hooks/use-openclaw-feishu-health'

export function useOpenClawPage() {
  const state = useOpenClawPageState()
  const settings = useOpenClawSettings(state)
  const report = useOpenClawReport(state)
  const feishuHealth = useOpenClawFeishuHealth(state)
  const config = useOpenClawConfig(state, {
    showAiAuthOverrideWarnings: settings.showAiAuthOverrideWarnings,
    setUserValue: settings.setUserValue,
    hasUserDirtyFields: settings.hasUserDirtyFields,
  })
  const strategy = useOpenClawStrategy(state, { setUserValue: settings.setUserValue })

  const { refreshKey, settings: settingsData } = state
  const {
    pendingCommandRunsPage,
    setPendingCommandRuns,
    setPendingCommandRunsError,
    setPendingCommandRunsLoading,
    setPendingCommandRunsPage,
    setPendingCommandRunsTotal,
    setPendingCommandRunsTotalPages,
  } = state
  const { loadOpenClawPageData } = settings
  const { loadGatewayStatus, loadWorkspaceStatus, loadPendingCommandRuns } = config

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

  useEffect(() => {
    let active = true

    if (!settingsData?.userId) {
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
  }, [
    settingsData?.userId,
    refreshKey,
    pendingCommandRunsPage,
    loadPendingCommandRuns,
    setPendingCommandRuns,
    setPendingCommandRunsError,
    setPendingCommandRunsLoading,
    setPendingCommandRunsPage,
    setPendingCommandRunsTotal,
    setPendingCommandRunsTotalPages,
  ])

  return {
    ...state,
    ...settings,
    ...report,
    ...feishuHealth,
    ...config,
    ...strategy,
  }
}

export type OpenClawPageViewModel = ReturnType<typeof useOpenClawPage>
