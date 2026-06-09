'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  appendAccountsAuthToSearchParams,
  GOOGLE_ADS_NOT_CONFIGURED_MESSAGE,
  parseAccountsListFetchFailure,
  resolveAccountsFetchBlockedUiEffects,
  resolveAccountsRequestAuth,
  safeReadJson,
  type AccountsRequestAuth,
} from '@/lib/google-ads-credentials-errors'
import { useGoogleAdsAccountsAuth } from '@/hooks/useGoogleAdsAccountsAuth'
import { formatGoogleAdsAuthSaveError } from './api-messages'
import { resolveGoogleAdsOAuthCallbackErrorMessage } from './oauth-callback-errors'
import type {
  GoogleAdsAccount,
  GoogleAdsCredentialStatus,
  GoogleAdsDeleteConfirmState,
} from './types'
import { hasGoogleAdsUnsavedChanges } from './validation'

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
  const [googleAdsAccounts, setGoogleAdsAccounts] = useState<GoogleAdsAccount[]>([])
  const [loadingGoogleAdsAccounts, setLoadingGoogleAdsAccounts] = useState(false)
  const [showGoogleAdsAccounts, setShowGoogleAdsAccounts] = useState(false)
  const [startingOAuth, setStartingOAuth] = useState(false)
  const [verifyingGoogleAdsCredentials, setVerifyingGoogleAdsCredentials] = useState(false)
  const [googleAdsAuthMethod, setGoogleAdsAuthMethod] = useState<'oauth' | 'service_account'>(
    'service_account'
  )
  const { prepareAuthForAccountsFetch } = useGoogleAdsAccountsAuth()
  const googleAdsAccountsPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
  const [, setLoadingServiceAccounts] = useState(false)
  const [deletingServiceAccountId, setDeletingServiceAccountId] = useState<string | null>(null)
  const [deletingOAuthConfig, setDeletingOAuthConfig] = useState(false)
  const [deleteConfirmState, setDeleteConfirmState] = useState<GoogleAdsDeleteConfirmState>(null)
  const [permissionError, setPermissionError] = useState<{
    serviceAccountEmail?: string
    mccCustomerId?: string
    solution?: { steps: string[]; docsUrl?: string }
  } | null>(null)

  const googleAdsAuthReadOnly = googleAdsCredentialStatus?.canModify === false
  const googleAdsDualStack = Boolean(googleAdsCredentialStatus?.dualStack)
  const googleAdsAuthActionsBlocked = googleAdsAuthReadOnly || googleAdsDualStack

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
        googleAdsCredentialStatus?.hasRefreshToken
      )
    }
    return false
  }

  const oauthHasUnsavedChanges = () => hasGoogleAdsUnsavedChanges(oauthFormData, savedOAuthFormData)

  const fetchServiceAccounts = useCallback(async () => {
    setLoadingServiceAccounts(true)
    try {
      const response = await fetch('/api/google-ads/service-account', {
        credentials: 'include',
      })
      const data = await response.json()
      if (response.ok) {
        setServiceAccounts(data.accounts || [])
      }
    } catch (err: unknown) {
      console.error('Failed to fetch service accounts:', err)
    } finally {
      setLoadingServiceAccounts(false)
    }
  }, [])

  const fetchGoogleAdsCredentialStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/google-ads/credentials', {
        credentials: 'include',
      })
      if (response.ok) {
        const data = await response.json()
        setGoogleAdsCredentialStatus(data.data)
        if (data.data?.authType === 'oauth' || data.data?.authType === 'service_account') {
          setGoogleAdsAuthMethod(data.data.authType)
        } else if (data.data?.hasServiceAccount) {
          setGoogleAdsAuthMethod('service_account')
        } else if (data.data?.hasRefreshToken) {
          setGoogleAdsAuthMethod('oauth')
        }
        if (
          data.data?.authType === 'service_account' ||
          (data.data?.hasServiceAccount && data.data?.authType !== 'oauth') ||
          (data.data?.authConfigWarning && data.data?.hasServiceAccount)
        ) {
          void fetchServiceAccounts()
        }
      }
    } catch (err) {
      console.error('Failed to fetch Google Ads credential status:', err)
    }
  }, [fetchServiceAccounts])

  useEffect(() => {
    void fetchGoogleAdsCredentialStatus()
  }, [fetchGoogleAdsCredentialStatus])

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const oauthSuccess = urlParams.get('oauth_success')
    const errorParam = urlParams.get('error')
    if (!oauthSuccess && !errorParam) return

    if (oauthSuccess === 'true') {
      toast.success('✅ OAuth 授权成功！Refresh Token 已保存')
      setGoogleAdsAuthMethod('oauth')
      void fetchGoogleAdsCredentialStatus()
      window.history.replaceState({}, '', '/settings?category=google_ads')
    } else if (errorParam) {
      toast.error(resolveGoogleAdsOAuthCallbackErrorMessage(errorParam))
      window.history.replaceState({}, '', '/settings?category=google_ads')
    }
  }, [fetchGoogleAdsCredentialStatus])

  useEffect(() => {
    return () => {
      if (googleAdsAccountsPollTimerRef.current) {
        clearTimeout(googleAdsAccountsPollTimerRef.current)
      }
    }
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
    if (oauthHasUnsavedChanges()) {
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
        await fetchGoogleAdsCredentialStatus()
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

  const scheduleGoogleAdsAccountsPoll = (authForRequest: AccountsRequestAuth) => {
    if (googleAdsAccountsPollTimerRef.current) {
      clearTimeout(googleAdsAccountsPollTimerRef.current)
    }
    googleAdsAccountsPollTimerRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams()
        appendAccountsAuthToSearchParams(params, authForRequest)
        const response = await fetch(`/api/google-ads/credentials/accounts?${params.toString()}`, {
          credentials: 'include',
          cache: 'no-store',
        })
        if (!response.ok) return

        const data = await response.json()
        if (!data.success || !data.data) return

        setGoogleAdsAccounts(data.data.accounts || [])
        if (data.data.refreshInProgress) {
          scheduleGoogleAdsAccountsPoll(authForRequest)
        } else {
          toast.success(`找到${data.data.total}个可访问的 Google Ads 账户`)
          await fetchGoogleAdsCredentialStatus()
        }
      } catch {
        // 轮询失败时静默，用户可手动重试
      }
    }, 2000)
  }

  const handleFetchGoogleAdsAccounts = async () => {
    try {
      setLoadingGoogleAdsAccounts(true)
      setShowGoogleAdsAccounts(true)

      const auth = await prepareAuthForAccountsFetch({ forceRefresh: true, isPoll: false })
      const resolved = resolveAccountsRequestAuth(
        auth,
        serviceAccounts[0]?.id ?? googleAdsCredentialStatus?.serviceAccountId
      )
      if (!resolved.ok) {
        const effects = resolveAccountsFetchBlockedUiEffects(resolved, { forceRefresh: true })
        await fetchGoogleAdsCredentialStatus()
        throw new Error(
          effects.errorMessage ?? effects.authConfigWarning ?? GOOGLE_ADS_NOT_CONFIGURED_MESSAGE
        )
      }
      const authForRequest = resolved.authForRequest

      const params = new URLSearchParams({ refresh: 'true', async: 'true' })
      appendAccountsAuthToSearchParams(params, authForRequest)
      const response = await fetch(`/api/google-ads/credentials/accounts?${params.toString()}`, {
        credentials: 'include',
      })

      if (!response.ok) {
        const data = await safeReadJson(response)
        if (
          data &&
          typeof data === 'object' &&
          (data as { code?: string }).code === 'SERVICE_ACCOUNT_PERMISSION_DENIED' &&
          (data as { details?: unknown }).details
        ) {
          setPermissionError((data as { details: typeof permissionError }).details)
          setShowGoogleAdsAccounts(true)
          return
        }

        const { message } = parseAccountsListFetchFailure(response, data, {
          fallbackMessage: '获取账户列表失败',
        })
        await fetchGoogleAdsCredentialStatus()
        throw new Error(message)
      }

      const data = await response.json()
      setPermissionError(null)
      setGoogleAdsAccounts(data.data.accounts || [])
      await fetchGoogleAdsCredentialStatus()
      if (data.data?.refreshInProgress) {
        toast.message('账号正在后台同步，列表将逐步更新')
        scheduleGoogleAdsAccountsPoll(authForRequest)
      } else {
        toast.success(`找到${data.data.total}个可访问的 Google Ads 账户`)
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '获取失败')
      setShowGoogleAdsAccounts(false)
    } finally {
      setLoadingGoogleAdsAccounts(false)
    }
  }

  const handleSaveServiceAccount = async () => {
    if (googleAdsAuthActionsBlocked) {
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
      await fetchGoogleAdsCredentialStatus()
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
      await fetchGoogleAdsCredentialStatus()
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
      await fetchGoogleAdsCredentialStatus()
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
      ['login_customer_id', 'client_id', 'client_secret', 'developer_token'].some(isSet)
    )
  })()

  const hasServiceAccountConfigToDelete = Boolean(googleAdsCredentialStatus?.serviceAccountId)

  const requestDeleteCurrentGoogleAdsConfig = () => {
    if (googleAdsAuthMethod === 'oauth') {
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
    await fetchGoogleAdsCredentialStatus()
    onOAuthSaveComplete()
  }

  return {
    googleAdsCredentialStatus,
    googleAdsAccounts,
    loadingGoogleAdsAccounts,
    showGoogleAdsAccounts,
    setShowGoogleAdsAccounts,
    startingOAuth,
    verifyingGoogleAdsCredentials,
    googleAdsAuthMethod,
    setGoogleAdsAuthMethod,
    serviceAccountForm,
    setServiceAccountForm,
    savingServiceAccount,
    serviceAccounts,
    deletingServiceAccountId,
    deletingOAuthConfig,
    deleteConfirmState,
    setDeleteConfirmState,
    permissionError,
    setPermissionError,
    googleAdsAuthReadOnly,
    googleAdsDualStack,
    googleAdsAuthActionsBlocked,
    isGoogleAdsSharedAdminHiddenSecret,
    oauthHasUnsavedChanges,
    fetchServiceAccounts,
    fetchGoogleAdsCredentialStatus,
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
