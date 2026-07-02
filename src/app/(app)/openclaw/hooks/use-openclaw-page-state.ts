'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePagination } from '@/hooks'


import type {
  DailyReport,
  FeishuChatHealthLogItem,
  FeishuChatHealthResponse,
  FeishuVerifyResultState,
  FeishuVerifySessionState,
  GatewayStatusResponse,
  OpenclawCommandRunItem,
  OpenclawSettingsResponse,
  OpenclawStrategyRecommendation,
  StrategyBatchAction,
  StrategyBatchFailure,
  StrategyBatchScope,
  StrategyConfirmRequest,
  StrategyRecommendationStatusFilter,
  TokenRecord,
  WorkspaceStatusResponse,
} from '../types'
import {
  parseLocalDate,
} from '../utils'


export function useOpenClawPageState() {
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
  return {
    router,
    settings,
    setSettings,
    userValues,
    setUserValues,
    savedUserValues,
    setSavedUserValues,
    tokens,
    setTokens,
    newToken,
    setNewToken,
    reportDate,
    setReportDate,
    reportStartDate,
    setReportStartDate,
    report,
    setReport,
    reportActionCurrentPage,
    reportActionPageSize,
    setReportActionPage,
    setReportActionPageSize,
    reportActionOffset,
    getReportActionTotalPages,
    reportActionPageSizeOptions,
    loading,
    setLoading,
    savingUser,
    setSavingUser,
    gatewayStatus,
    setGatewayStatus,
    gatewayLoading,
    setGatewayLoading,
    gatewayReloading,
    setGatewayReloading,
    gatewaySkillsCollapsed,
    setGatewaySkillsCollapsed,
    gatewayShowAvailableOnly,
    setGatewayShowAvailableOnly,
    workspaceStatus,
    setWorkspaceStatus,
    workspaceLoading,
    setWorkspaceLoading,
    workspaceBootstrapping,
    setWorkspaceBootstrapping,
    workspaceAutoBootstrapTriedRef,
    handleWorkspaceBootstrapRef,
    refreshKey,
    setRefreshKey,
    strategyRecommendations,
    setStrategyRecommendations,
    strategyRecommendationsLoaded,
    setStrategyRecommendationsLoaded,
    strategyRecommendationsLoading,
    setStrategyRecommendationsLoading,
    strategyManualTriggering,
    setStrategyManualTriggering,
    strategyAnalyzeSendFeishu,
    setStrategyAnalyzeSendFeishu,
    strategyRecommendationsReportDate,
    setStrategyRecommendationsReportDate,
    strategyServerDate,
    setStrategyServerDate,
    strategyRecommendationsDisplayMode,
    setStrategyRecommendationsDisplayMode,
    strategyRecommendationStatusFilter,
    setStrategyRecommendationStatusFilter,
    strategyBatchScope,
    setStrategyBatchScope,
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
    strategyRecommendationDetailItem,
    setStrategyRecommendationDetailItem,
    strategyConfirmDialog,
    setStrategyConfirmDialog,
    strategyConfirmResolverRef,
    strategyConfirmAcknowledge,
    setStrategyConfirmAcknowledge,
    strategyCronPreset,
    setStrategyCronPreset,
    feishuTestLoading,
    setFeishuTestLoading,
    feishuTestResult,
    setFeishuTestResult,
    feishuVerifyLoading,
    setFeishuVerifyLoading,
    feishuVerifyChecking,
    setFeishuVerifyChecking,
    feishuVerifySenderOpenId,
    setFeishuVerifySenderOpenId,
    feishuVerifySession,
    setFeishuVerifySession,
    feishuVerifyResult,
    setFeishuVerifyResult,
    feishuVerifyNow,
    setFeishuVerifyNow,
    showFeishuAdvanced,
    setShowFeishuAdvanced,
    aiJsonError,
    setAiJsonError,
    feishuHealthLoading,
    setFeishuHealthLoading,
    feishuHealthError,
    setFeishuHealthError,
    feishuHealthData,
    setFeishuHealthData,
    feishuHealthDialogItem,
    setFeishuHealthDialogItem,
    pendingCommandRuns,
    setPendingCommandRuns,
    pendingCommandRunsLoading,
    setPendingCommandRunsLoading,
    pendingCommandRunsError,
    setPendingCommandRunsError,
    pendingCommandRunsPage,
    setPendingCommandRunsPage,
    pendingCommandRunsTotal,
    setPendingCommandRunsTotal,
    pendingCommandRunsTotalPages,
    setPendingCommandRunsTotalPages,
  }
}

export type OpenClawPageState = ReturnType<typeof useOpenClawPageState>
