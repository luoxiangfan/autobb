'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  applyGoogleAdsAccountsFetchUiEffects,
  resolveGoogleAdsAccountsFetchUiEffects,
  shouldRefreshCredentialsAfterAccountsFetchOk,
  type ServiceAccountPermissionDetails,
} from '@/lib/google-ads-accounts-fetch'
import {
  createGoogleAdsAccountsCoreApplyHandlers,
  createDismissGoogleAdsPermissionErrorHandler,
  withAccountsListSchedulePoll,
} from '@/lib/google-ads-accounts-fetch-handlers'
import {
  useGoogleAdsAccountsList,
  type GoogleAdsAccountsFetchParams,
  type GoogleAdsAccountsFetchResult,
} from '@/hooks/useGoogleAdsAccountsList'
import { formatGoogleAdsAuthSaveError } from './api-messages'
import { resolveGoogleAdsOAuthCallbackErrorMessage } from './oauth-callback-errors'
import type {
  GoogleAdsAccount,
  GoogleAdsCredentialStatus,
  GoogleAdsDeleteConfirmState,
} from './types'
import {
  hasGoogleAdsUnsavedChanges,
  isGoogleAdsAuthMethodLocked,
  resolveEffectiveGoogleAdsAuthMethod,
  resolveAuthMethodAfterCredentialStatusRefresh,
  shouldFetchGoogleAdsServiceAccounts,
} from './validation'

export interface UseGoogleAdsAuthSettingsParams {
  oauthFormData: Record<string, string> | undefined
  savedOAuthFormData: Record<string, string> | undefined
  onRefreshCategory: () => Promise<void>
  onClearOAuthFormFields: (keys: string[]) => void
  onOAuthSaveComplete: () => void
}

export function useGoogleAdsAuthSettings({
  oauthFormData,
  savedOAuthFormData,
  onRefreshCategory,
  onClearOAuthFormFields,
  onOAuthSaveComplete,
}: UseGoogleAdsAuthSettingsParams) {
  const [googleAdsCredentialStatus, setGoogleAdsCredentialStatus] =
    useState<GoogleAdsCredentialStatus | null>(null)
  const [loadingGoogleAdsCredentialStatus, setLoadingGoogleAdsCredentialStatus] = useState(true)
  const [credentialStatusLoadError, setCredentialStatusLoadError] = useState<string | null>(null)
  const googleAdsCredentialStatusRef = useRef<GoogleAdsCredentialStatus | null>(null)
  const googleAdsAuthMethodRef = useRef<'oauth' | 'service_account'>('oauth')
  const [googleAdsAccounts, setGoogleAdsAccounts] = useState<GoogleAdsAccount[]>([])
  const [loadingGoogleAdsAccounts, setLoadingGoogleAdsAccounts] = useState(false)
  const [showGoogleAdsAccounts, setShowGoogleAdsAccounts] = useState(false)
  const [startingOAuth, setStartingOAuth] = useState(false)
  const [verifyingGoogleAdsCredentials, setVerifyingGoogleAdsCredentials] = useState(false)
  const [googleAdsAuthMethod, setGoogleAdsAuthMethod] = useState<'oauth' | 'service_account'>(
    'oauth'
  )

  const { fetchAccounts, scheduleAccountsPoll } = useGoogleAdsAccountsList()
  const accountsPollBaseParamsRef = useRef<GoogleAdsAccountsFetchParams>({})
  const [serviceAccountForm, setServiceAccountForm] = useState({
    name: '',
    mccCustomerId: '',
    developerToken: '',
    serviceAccountJson: '',
  })
  const [savingServiceAccount, setSavingServiceAccount] = useState(false)
  const [serviceAccounts, setServiceAccounts] = useState<
    Array<{
      id: string
      name: string
      mcc_customer_id: string
      service_account_email: string
      created_at: string
    }>
  >([])
  const [deletingServiceAccountId, setDeletingServiceAccountId] = useState<string | null>(null)
  const [deletingOAuthConfig, setDeletingOAuthConfig] = useState(false)
  const [deleteConfirmState, setDeleteConfirmState] = useState<GoogleAdsDeleteConfirmState>(null)
  const [permissionError, setPermissionError] = useState<ServiceAccountPermissionDetails | null>(
    null
  )

  const googleAdsAuthReadOnly = googleAdsCredentialStatus?.canModify === false
  const googleAdsDualStack = Boolean(googleAdsCredentialStatus?.dualStack)
  /** 禁止保存 / OAuth / 验证等写入；双栈时仍允许删除其中一种认证 */
  const googleAdsAuthModifyBlocked = googleAdsAuthReadOnly || googleAdsDualStack
  const googleAdsAuthMethodLocked = isGoogleAdsAuthMethodLocked(googleAdsCredentialStatus)
  const effectiveGoogleAdsAuthMethod = resolveEffectiveGoogleAdsAuthMethod(
    googleAdsCredentialStatus,
    googleAdsAuthMethod
  )

  const setGoogleAdsAuthMethodIfAllowed = useCallback(
    (method: 'oauth' | 'service_account') => {
      if (isGoogleAdsAuthMethodLocked(googleAdsCredentialStatus)) {
        return
      }
      googleAdsAuthMethodRef.current = method
      setGoogleAdsAuthMethod(method)
    },
    [googleAdsCredentialStatus]
  )

  const isGoogleAdsSharedAdminHiddenSecret = (key: string, value: string) => {
    if (!googleAdsAuthReadOnly || value?.trim()) {
      return false
    }
    if (key !== 'client_secret' && key !== 'developer_token') {
      return false
    }
    if (key === 'developer_token') {
      return Boolean(
        googleAdsCredentialStatus?.developerTokenConfigured ||
        googleAdsCredentialStatus?.developerToken
      )
    }
    if (key === 'client_secret') {
      return Boolean(
        googleAdsCredentialStatus?.clientSecretConfigured ||
        googleAdsCredentialStatus?.hasCredentials ||
        googleAdsCredentialStatus?.hasRefreshToken ||
        googleAdsCredentialStatus?.hasOAuthFields
      )
    }
    return false
  }

  const oauthHasUnsavedChanges = () => hasGoogleAdsUnsavedChanges(oauthFormData, savedOAuthFormData)

  const serviceAccountsFetchInFlightRef = useRef<Promise<void> | null>(null)

  const fetchServiceAccounts = useCallback(async () => {
    if (serviceAccountsFetchInFlightRef.current) {
      return serviceAccountsFetchInFlightRef.current
    }

    const promise = (async () => {
      try {
        const response = await fetch('/api/google-ads/service-account', {
          credentials: 'include',
        })
        const data = await response.json()
        if (response.ok) {
          setServiceAccounts(data.accounts || [])
        }
      } catch {
        // 服务账号列表为辅助数据，失败时静默；凭证状态刷新会再次触发
      }
    })()
    serviceAccountsFetchInFlightRef.current = promise
    void promise.finally(() => {
      if (serviceAccountsFetchInFlightRef.current === promise) {
        serviceAccountsFetchInFlightRef.current = null
      }
    })
    return promise
  }, [])

  const fetchGoogleAdsCredentialStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/google-ads/credentials', {
        credentials: 'include',
      })
      const data = (await response.json().catch(() => ({}))) as {
        data?: GoogleAdsCredentialStatus
        error?: string
        message?: string
      }

      if (!response.ok) {
        const message =
          data.message || data.error || `加载 Google Ads 认证状态失败（${response.status}）`
        const isInitialLoad = googleAdsCredentialStatusRef.current == null
        setCredentialStatusLoadError(message)
        if (isInitialLoad) {
          toast.error(message)
        }
        return
      }

      if (data.data == null) {
        const message = '服务器返回的 Google Ads 认证状态格式无效'
        const isInitialLoad = googleAdsCredentialStatusRef.current == null
        setCredentialStatusLoadError(message)
        if (isInitialLoad) {
          toast.error(message)
        }
        return
      }

      setCredentialStatusLoadError(null)
      const nextStatus = data.data
      const previousStatus = googleAdsCredentialStatusRef.current
      const nextAuthMethod = resolveAuthMethodAfterCredentialStatusRefresh(
        previousStatus,
        nextStatus,
        googleAdsAuthMethodRef.current
      )
      if (nextAuthMethod !== googleAdsAuthMethodRef.current) {
        googleAdsAuthMethodRef.current = nextAuthMethod
        setGoogleAdsAuthMethod(nextAuthMethod)
      }
      googleAdsCredentialStatusRef.current = nextStatus
      setGoogleAdsCredentialStatus(nextStatus)
      if (shouldFetchGoogleAdsServiceAccounts(nextStatus)) {
        void fetchServiceAccounts()
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : '加载 Google Ads 认证状态失败，请稍后重试'
      const isInitialLoad = googleAdsCredentialStatusRef.current == null
      setCredentialStatusLoadError(message)
      if (isInitialLoad) {
        toast.error(message)
      }
    } finally {
      setLoadingGoogleAdsCredentialStatus(false)
    }
  }, [fetchServiceAccounts])

  const credentialStatusRefreshInFlightRef = useRef<Promise<void> | null>(null)

  const refreshCredentialStatusCoalesced = useCallback(async () => {
    if (credentialStatusRefreshInFlightRef.current) {
      return credentialStatusRefreshInFlightRef.current
    }

    const promise = fetchGoogleAdsCredentialStatus().finally(() => {
      if (credentialStatusRefreshInFlightRef.current === promise) {
        credentialStatusRefreshInFlightRef.current = null
      }
    })
    credentialStatusRefreshInFlightRef.current = promise
    return promise
  }, [fetchGoogleAdsCredentialStatus])

  const retryLoadGoogleAdsCredentialStatus = useCallback(async () => {
    setLoadingGoogleAdsCredentialStatus(true)
    setCredentialStatusLoadError(null)
    await refreshCredentialStatusCoalesced()
  }, [refreshCredentialStatusCoalesced])

  useEffect(() => {
    void refreshCredentialStatusCoalesced()
  }, [refreshCredentialStatusCoalesced])

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const oauthSuccess = urlParams.get('oauth_success')
    const errorParam = urlParams.get('error')
    if (!oauthSuccess && !errorParam) return

    if (oauthSuccess === 'true') {
      toast.success('✅ OAuth 授权成功！Refresh Token 已保存')
      googleAdsAuthMethodRef.current = 'oauth'
      setGoogleAdsAuthMethod('oauth')
      void refreshCredentialStatusCoalesced()
      window.history.replaceState({}, '', '/settings?category=google_ads')
    } else if (errorParam) {
      toast.error(resolveGoogleAdsOAuthCallbackErrorMessage(errorParam))
      window.history.replaceState({}, '', '/settings?category=google_ads')
    }
  }, [refreshCredentialStatusCoalesced])

  const handleAccountsFetchResultRef = useRef<
    (
      result: GoogleAdsAccountsFetchResult,
      opts: { forceRefresh?: boolean; isPoll?: boolean }
    ) => 'ok' | 'permission_denied' | 'failed'
  >(() => 'failed')

  handleAccountsFetchResultRef.current = (result, opts) => {
    const effects = resolveGoogleAdsAccountsFetchUiEffects(result, opts)
    const handlers = withAccountsListSchedulePoll(
      {
        ...createGoogleAdsAccountsCoreApplyHandlers({
          setAuthConfigWarning: (warning) => {
            if (warning) void refreshCredentialStatusCoalesced()
          },
          setGoogleAdsDualStack: (dualStack) => {
            if (dualStack) void refreshCredentialStatusCoalesced()
          },
          setNeedsReauth: (needsReauth) => {
            if (needsReauth) void refreshCredentialStatusCoalesced()
          },
          setPermissionError,
          onErrorMessage: (message) => toast.error(message),
          onPollFailure: (message) => toast.error(message),
          onClearForceRefresh: () => {},
          onPermissionAccountsHidden: () => setGoogleAdsAccounts([]),
        }),
        onOkData: (data) => {
          setGoogleAdsAccounts(data.accounts as GoogleAdsAccount[])
        },
      },
      scheduleAccountsPoll,
      accountsPollBaseParamsRef,
      (pollResult) => {
        handleAccountsFetchResultRef.current(pollResult, { isPoll: true })
      }
    )

    const outcome = applyGoogleAdsAccountsFetchUiEffects(effects, {
      ...handlers,
      onSchedulePoll: () => {
        if (opts.forceRefresh) {
          toast.message('账号正在后台同步，列表将逐步更新')
        }
        handlers.onSchedulePoll?.()
      },
    })

    if (outcome === 'ok') {
      if (!effects.shouldSchedulePoll) {
        toast.success(`找到${effects.data!.total}个可访问的 Google Ads 账户`)
      }
      if (shouldRefreshCredentialsAfterAccountsFetchOk(effects)) {
        void refreshCredentialStatusCoalesced()
      }
      return 'ok'
    }

    if (effects.kind === 'permission_denied') {
      setShowGoogleAdsAccounts(true)
      return 'permission_denied'
    }

    return 'failed'
  }

  const handleAccountsFetchResult = useCallback(
    (
      result: GoogleAdsAccountsFetchResult,
      opts: { forceRefresh?: boolean; isPoll?: boolean }
    ): 'ok' | 'permission_denied' | 'failed' => {
      return handleAccountsFetchResultRef.current(result, opts)
    },
    []
  )

  const dismissGoogleAdsAccountsPermissionError = useCallback(() => {
    createDismissGoogleAdsPermissionErrorHandler({
      setPermissionError,
      onAccountsHidden: () => setGoogleAdsAccounts([]),
      onDismiss: () => setShowGoogleAdsAccounts(false),
    })()
  }, [])

  const handleStartGoogleAdsOAuth = async () => {
    if (oauthHasUnsavedChanges()) {
      toast.error('请先保存 Google Ads 配置后再启动 OAuth 授权')
      return
    }

    const clientId = oauthFormData?.client_id
    if (!clientId?.trim()) {
      toast.error('请先填写并保存 Client ID')
      return
    }

    try {
      setStartingOAuth(true)
      const response = await fetch('/api/google-ads/oauth/start', { credentials: 'include' })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '启动OAuth失败')
      }
      const data = await response.json()
      window.location.href = data.data.auth_url
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'OAuth启动失败')
      setStartingOAuth(false)
    }
  }

  const handleVerifyGoogleAdsCredentials = async () => {
    if (effectiveGoogleAdsAuthMethod === 'oauth' && oauthHasUnsavedChanges()) {
      toast.error('请先保存 Google Ads 配置后再验证凭证')
      return
    }

    setVerifyingGoogleAdsCredentials(true)
    try {
      const response = await fetch('/api/google-ads/credentials/verify', {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json()
      if (response.ok && data.success && data.data?.valid) {
        toast.success(data.message || 'Google Ads 凭证验证通过')
        await refreshCredentialStatusCoalesced()
        return
      }
      const message = data.data?.error || data.message || data.error || 'Google Ads 凭证验证失败'
      toast.error(message)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '验证失败')
    } finally {
      setVerifyingGoogleAdsCredentials(false)
    }
  }

  const handleFetchGoogleAdsAccounts = async () => {
    try {
      setLoadingGoogleAdsAccounts(true)
      setShowGoogleAdsAccounts(true)

      const baseParams: GoogleAdsAccountsFetchParams = {
        forceRefresh: true,
        fallbackServiceAccountId:
          serviceAccounts[0]?.id ?? googleAdsCredentialStatus?.serviceAccountId,
      }
      accountsPollBaseParamsRef.current = baseParams

      const result = await fetchAccounts(baseParams)
      const status = handleAccountsFetchResult(result, { forceRefresh: true })

      if (status === 'failed') {
        await refreshCredentialStatusCoalesced()
        setShowGoogleAdsAccounts(false)
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '获取失败')
      setShowGoogleAdsAccounts(false)
    } finally {
      setLoadingGoogleAdsAccounts(false)
    }
  }

  const handleSaveServiceAccount = async () => {
    if (googleAdsAuthModifyBlocked) {
      toast.error(
        googleAdsDualStack
          ? '请先删除双栈认证中的其中一种配置后再保存'
          : '当前 Google Ads 认证为只读，无法修改'
      )
      return
    }

    const formEmpty =
      !serviceAccountForm.name &&
      !serviceAccountForm.mccCustomerId &&
      !serviceAccountForm.developerToken &&
      !serviceAccountForm.serviceAccountJson

    if (formEmpty) {
      if (googleAdsCredentialStatus?.serviceAccountId) {
        toast.error('请先点击「替换服务账号配置」并填写新配置')
      } else {
        toast.error('请填写所有必填字段')
      }
      return
    }

    if (
      !serviceAccountForm.name ||
      !serviceAccountForm.mccCustomerId ||
      !serviceAccountForm.developerToken ||
      !serviceAccountForm.serviceAccountJson
    ) {
      toast.error('请填写所有必填字段')
      return
    }

    setSavingServiceAccount(true)
    try {
      const response = await fetch('/api/google-ads/service-account', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serviceAccountForm),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(formatGoogleAdsAuthSaveError(response.status, data.error))
      }

      toast.success('服务账号配置已保存')
      setServiceAccountForm({
        name: '',
        mccCustomerId: '',
        developerToken: '',
        serviceAccountJson: '',
      })
      await fetchServiceAccounts()
      await refreshCredentialStatusCoalesced()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSavingServiceAccount(false)
    }
  }

  const deleteServiceAccountNow = async (id: string): Promise<boolean> => {
    setDeletingServiceAccountId(id)
    try {
      const response = await fetch(`/api/google-ads/service-account?id=${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '删除失败')

      toast.success('服务账号配置已删除')
      await fetchServiceAccounts()
      await refreshCredentialStatusCoalesced()
      return true
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '删除失败')
      return false
    } finally {
      setDeletingServiceAccountId(null)
    }
  }

  const deleteOAuthConfigNow = async (): Promise<boolean> => {
    setDeletingOAuthConfig(true)
    try {
      const response = await fetch('/api/google-ads/credentials', {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || data.error || '删除失败')

      onClearOAuthFormFields(['client_id', 'client_secret', 'developer_token', 'login_customer_id'])
      toast.success('OAuth 配置已删除')
      await onRefreshCategory()
      await refreshCredentialStatusCoalesced()
      return true
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '删除失败')
      return false
    } finally {
      setDeletingOAuthConfig(false)
    }
  }

  const requestDeleteOAuthConfig = () => setDeleteConfirmState({ kind: 'oauth' })

  const requestDeleteServiceAccount = (serviceAccountId: string) =>
    setDeleteConfirmState({ kind: 'service_account', serviceAccountId })

  const hasOAuthConfigToDelete = (() => {
    const isSet = (key: string): boolean => {
      const raw = oauthFormData?.[key]
      if (!raw) return false
      if (raw === '············') return true
      return raw.trim().length > 0
    }

    return (
      Boolean(googleAdsCredentialStatus?.hasRefreshToken) ||
      Boolean(googleAdsCredentialStatus?.hasOAuthFields) ||
      ['login_customer_id', 'client_id', 'client_secret', 'developer_token'].some(isSet)
    )
  })()

  const hasServiceAccountConfigToDelete = Boolean(googleAdsCredentialStatus?.serviceAccountId)

  const requestDeleteCurrentGoogleAdsConfig = () => {
    if (effectiveGoogleAdsAuthMethod === 'oauth') {
      if (!hasOAuthConfigToDelete) {
        toast.error('当前未配置真实 OAuth 信息，无需删除')
        return
      }
      requestDeleteOAuthConfig()
      return
    }

    const id = googleAdsCredentialStatus?.serviceAccountId
    if (!id) {
      toast.error('未检测到服务账号配置')
      return
    }
    requestDeleteServiceAccount(id)
  }

  const handleDeleteConfirm = async () => {
    const state = deleteConfirmState
    if (!state) return

    const ok =
      state.kind === 'oauth'
        ? await deleteOAuthConfigNow()
        : await deleteServiceAccountNow(state.serviceAccountId)

    if (ok) {
      setDeleteConfirmState(null)
    }
  }

  const notifyOAuthSaveComplete = async () => {
    await refreshCredentialStatusCoalesced()
    onOAuthSaveComplete()
  }

  return {
    googleAdsCredentialStatus,
    loadingGoogleAdsCredentialStatus,
    credentialStatusLoadError,
    retryLoadGoogleAdsCredentialStatus,
    googleAdsAccounts,
    loadingGoogleAdsAccounts,
    showGoogleAdsAccounts,
    setShowGoogleAdsAccounts,
    startingOAuth,
    verifyingGoogleAdsCredentials,
    googleAdsAuthMethod,
    setGoogleAdsAuthMethod: setGoogleAdsAuthMethodIfAllowed,
    effectiveGoogleAdsAuthMethod,
    googleAdsAuthMethodLocked,
    serviceAccountForm,
    setServiceAccountForm,
    savingServiceAccount,
    serviceAccounts,
    deletingServiceAccountId,
    deletingOAuthConfig,
    deleteConfirmState,
    setDeleteConfirmState,
    permissionError,
    dismissGoogleAdsAccountsPermissionError,
    googleAdsAuthReadOnly,
    googleAdsDualStack,
    googleAdsAuthModifyBlocked,
    isGoogleAdsSharedAdminHiddenSecret,
    oauthHasUnsavedChanges,
    fetchServiceAccounts,
    refreshCredentialStatusCoalesced,
    handleStartGoogleAdsOAuth,
    handleVerifyGoogleAdsCredentials,
    handleFetchGoogleAdsAccounts,
    handleSaveServiceAccount,
    requestDeleteOAuthConfig,
    requestDeleteServiceAccount,
    hasOAuthConfigToDelete,
    hasServiceAccountConfigToDelete,
    requestDeleteCurrentGoogleAdsConfig,
    handleDeleteConfirm,
    notifyOAuthSaveComplete,
  }
}

export type GoogleAdsAuthSettings = ReturnType<typeof useGoogleAdsAuthSettings>
