'use client'

/**
 * 共享 Google Ads 可访问账户列表拉取（设置页、Google Ads 页等）。
 * 组合凭证快照（useGoogleAdsAccountsAuth）与 /credentials/accounts 请求、异步轮询。
 */
import { useCallback, useEffect, useRef } from 'react'
import {
  appendAccountsAuthToSearchParams,
  formatNullableErrorMessage,
  resolveAccountsFetchBlockedUiEffects,
  resolveAccountsRequestAuth,
  safeReadJson,
  throwAccountsListFetchError,
  type AccountsFetchBlockedUiEffects,
  type AccountsRequestAuth,
  type ParsedGoogleAdsCredentialsStatus,
} from '@/lib/google-ads-credentials-errors'
import {
  useGoogleAdsAccountsAuth,
  type UseGoogleAdsAccountsAuthOptions,
} from './useGoogleAdsAccountsAuth'

export const GOOGLE_ADS_ACCOUNTS_POLL_INTERVAL_MS = 2000

export type GoogleAdsAccountsApiData = {
  accounts: unknown[]
  total: number
  refreshInProgress: boolean
  refreshError: string | null
  authConfigWarning: string | null
  dualStack: boolean
  cached?: boolean
  cacheStale?: boolean
  refreshFailed?: boolean
  lastSyncAt?: string | null
}

export type GoogleAdsAccountsFetchParams = {
  forceRefresh?: boolean
  isPoll?: boolean
  skipCredentialsRefresh?: boolean
  fallbackServiceAccountId?: string | null
  /** 额外 query（如 filterByUserMcc、offerId） */
  query?: Record<string, string | undefined>
}

export type GoogleAdsAccountsFetchResult =
  | {
      ok: true
      authForRequest: AccountsRequestAuth
      data: GoogleAdsAccountsApiData
    }
  | { ok: false; kind: 'blocked'; effects: AccountsFetchBlockedUiEffects }
  | { ok: false; kind: 'permission_denied'; details: unknown }
  | {
      ok: false
      kind: 'error'
      error: Error & { needsReauth?: boolean; authConfigWarning?: string | null }
    }

export type UseGoogleAdsAccountsListOptions = UseGoogleAdsAccountsAuthOptions & {
  pollIntervalMs?: number
}

function parseAccountsApiPayload(data: unknown): GoogleAdsAccountsApiData | null {
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  if (!record?.success || !record.data || typeof record.data !== 'object') {
    return null
  }
  const payload = record.data as Record<string, unknown>
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : []
  const total = typeof payload.total === 'number' ? payload.total : accounts.length

  return {
    accounts,
    total,
    refreshInProgress: Boolean(payload.refreshInProgress),
    refreshError: formatNullableErrorMessage(payload.refreshError),
    authConfigWarning: formatNullableErrorMessage(payload.authConfigWarning),
    dualStack: Boolean(payload.dualStack),
    ...(payload.cached !== undefined ? { cached: Boolean(payload.cached) } : {}),
    ...(payload.cacheStale !== undefined ? { cacheStale: Boolean(payload.cacheStale) } : {}),
    ...(payload.refreshFailed !== undefined
      ? { refreshFailed: Boolean(payload.refreshFailed) }
      : {}),
    lastSyncAt:
      typeof payload.lastSyncAt === 'string'
        ? payload.lastSyncAt
        : accounts.length > 0 &&
            typeof (accounts[0] as { lastSyncAt?: string }).lastSyncAt === 'string'
          ? (accounts[0] as { lastSyncAt: string }).lastSyncAt
          : null,
  }
}

export function useGoogleAdsAccountsList(options: UseGoogleAdsAccountsListOptions = {}) {
  const pollIntervalMs = options.pollIntervalMs ?? GOOGLE_ADS_ACCOUNTS_POLL_INTERVAL_MS
  const {
    prepareAuthForAccountsFetch,
    refreshCredentialsStatus,
    syncFromCredentialsResponse,
    authRef,
    pollCountRef,
    resetPollCount,
  } = useGoogleAdsAccountsAuth({
    onCredentialsUpdated: options.onCredentialsUpdated,
  })

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearAccountsPoll = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  useEffect(() => () => clearAccountsPoll(), [clearAccountsPoll])

  const fetchAccounts = useCallback(
    async (params: GoogleAdsAccountsFetchParams): Promise<GoogleAdsAccountsFetchResult> => {
      const authSnapshot = await prepareAuthForAccountsFetch({
        forceRefresh: params.forceRefresh,
        isPoll: params.isPoll,
        skipCredentialsRefresh: params.skipCredentialsRefresh,
      })

      const resolved = resolveAccountsRequestAuth(authSnapshot, params.fallbackServiceAccountId)
      if (!resolved.ok) {
        return {
          ok: false,
          kind: 'blocked',
          effects: resolveAccountsFetchBlockedUiEffects(resolved, {
            forceRefresh: params.forceRefresh,
          }),
        }
      }

      const authForRequest = resolved.authForRequest
      const searchParams = new URLSearchParams()
      if (params.forceRefresh) {
        searchParams.set('refresh', 'true')
        searchParams.set('async', 'true')
      }
      if (params.query) {
        for (const [key, value] of Object.entries(params.query)) {
          if (value !== undefined && value !== '') {
            searchParams.set(key, value)
          }
        }
      }
      appendAccountsAuthToSearchParams(searchParams, authForRequest)

      const response = await fetch(
        `/api/google-ads/credentials/accounts?${searchParams.toString()}`,
        {
          credentials: 'include',
          cache: 'no-store',
        }
      )

      if (!response.ok) {
        const body = await safeReadJson(response)
        const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : null
        if (record?.code === 'SERVICE_ACCOUNT_PERMISSION_DENIED' && record.details !== undefined) {
          return { ok: false, kind: 'permission_denied', details: record.details }
        }

        try {
          throwAccountsListFetchError(response, body, {
            fallbackMessage: '获取账户列表失败',
          })
        } catch (error) {
          return {
            ok: false,
            kind: 'error',
            error: error as Error & {
              needsReauth?: boolean
              authConfigWarning?: string | null
            },
          }
        }
      }

      const data = await response.json()
      const parsed = parseAccountsApiPayload(data)
      if (!parsed) {
        return {
          ok: false,
          kind: 'error',
          error: new Error('获取账户列表失败'),
        }
      }

      return {
        ok: true,
        authForRequest,
        data: parsed,
      }
    },
    [prepareAuthForAccountsFetch]
  )

  const scheduleAccountsPollRef = useRef<
    (
      baseParams: GoogleAdsAccountsFetchParams,
      onResult: (result: GoogleAdsAccountsFetchResult) => void
    ) => void
  >(() => {})

  scheduleAccountsPollRef.current = (baseParams, onResult) => {
    clearAccountsPoll()
    pollTimerRef.current = setTimeout(async () => {
      const result = await fetchAccounts({
        ...baseParams,
        isPoll: true,
        forceRefresh: false,
        skipCredentialsRefresh: baseParams.skipCredentialsRefresh ?? true,
      })
      onResult(result)
      if (result.ok && result.data.refreshInProgress) {
        scheduleAccountsPollRef.current(baseParams, onResult)
      }
    }, pollIntervalMs)
  }

  const scheduleAccountsPoll = useCallback(
    (
      baseParams: GoogleAdsAccountsFetchParams,
      onResult: (result: GoogleAdsAccountsFetchResult) => void
    ) => {
      scheduleAccountsPollRef.current(baseParams, onResult)
    },
    []
  )

  return {
    authRef,
    pollCountRef,
    refreshCredentialsStatus,
    syncFromCredentialsResponse,
    prepareAuthForAccountsFetch,
    resetPollCount,
    fetchAccounts,
    scheduleAccountsPoll,
    clearAccountsPoll,
  }
}

export type { ParsedGoogleAdsCredentialsStatus }
