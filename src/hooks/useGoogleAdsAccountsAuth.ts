'use client'

/**
 * 账号列表请求前的 Google Ads 凭证解析（ref 同步快照 + 轮询刷新策略）。
 */
import { useCallback, useRef } from 'react'
import {
  fetchGoogleAdsCredentialsStatus,
  GOOGLE_ADS_CREDENTIALS_POLL_REFRESH_EVERY,
  parseCredentialsStatusResponse,
  type ParsedGoogleAdsCredentialsStatus,
} from '@/lib/google-ads/common/credentials-errors'

export type { ParsedGoogleAdsCredentialsStatus }

export interface UseGoogleAdsAccountsAuthOptions {
  onCredentialsUpdated?: (parsed: ParsedGoogleAdsCredentialsStatus) => void
}

export function useGoogleAdsAccountsAuth(options: UseGoogleAdsAccountsAuthOptions = {}) {
  const authRef = useRef<ParsedGoogleAdsCredentialsStatus | null>(null)
  const pollCountRef = useRef(0)
  const onCredentialsUpdatedRef = useRef(options.onCredentialsUpdated)
  onCredentialsUpdatedRef.current = options.onCredentialsUpdated

  const applyCredentialsSnapshot = useCallback((parsed: ParsedGoogleAdsCredentialsStatus) => {
    authRef.current = parsed
    onCredentialsUpdatedRef.current?.(parsed)
  }, [])

  const syncFromCredentialsResponse = useCallback(
    (data: unknown): ParsedGoogleAdsCredentialsStatus => {
      const parsed = parseCredentialsStatusResponse(data)
      applyCredentialsSnapshot(parsed)
      return parsed
    },
    [applyCredentialsSnapshot]
  )

  const refreshCredentialsStatus =
    useCallback(async (): Promise<ParsedGoogleAdsCredentialsStatus> => {
      const parsed = await fetchGoogleAdsCredentialsStatus()
      applyCredentialsSnapshot(parsed)
      return parsed
    }, [applyCredentialsSnapshot])

  /**
   * 按轮询策略刷新凭证并返回当前快照（供本轮 accounts 请求立即使用，避免 React state 滞后）。
   */
  const prepareAuthForAccountsFetch = useCallback(
    async (opts: {
      forceRefresh?: boolean
      isPoll?: boolean
      /** 已有快照时跳过 /credentials（如刚 syncFromCredentialsResponse 或上一轮已 forceRefresh） */
      skipCredentialsRefresh?: boolean
    }): Promise<ParsedGoogleAdsCredentialsStatus> => {
      const forceRefresh = Boolean(opts.forceRefresh)
      const isPoll = Boolean(opts.isPoll)
      const skipCredentialsRefresh = Boolean(opts.skipCredentialsRefresh)

      if (forceRefresh && !skipCredentialsRefresh) {
        authRef.current = null
        pollCountRef.current = 0
      }

      if (isPoll) {
        pollCountRef.current += 1
      }

      if (skipCredentialsRefresh && authRef.current) {
        return authRef.current
      }

      const shouldRefreshCredentials =
        forceRefresh ||
        !authRef.current ||
        !isPoll ||
        pollCountRef.current % GOOGLE_ADS_CREDENTIALS_POLL_REFRESH_EVERY === 0

      if (shouldRefreshCredentials) {
        return refreshCredentialsStatus()
      }

      return authRef.current!
    },
    [refreshCredentialsStatus]
  )

  const resetPollCount = useCallback(() => {
    pollCountRef.current = 0
  }, [])

  return {
    authRef,
    pollCountRef,
    refreshCredentialsStatus,
    syncFromCredentialsResponse,
    prepareAuthForAccountsFetch,
    resetPollCount,
  }
}
