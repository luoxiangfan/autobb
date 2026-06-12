// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGoogleAdsAccountsList } from '../useGoogleAdsAccountsList'

vi.mock('@/lib/google-ads/common/credentials-errors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads/common/credentials-errors')>()
  return {
    ...actual,
    fetchGoogleAdsCredentialsStatus: vi.fn(),
  }
})

import { fetchGoogleAdsCredentialsStatus } from '@/lib/google-ads/common/credentials-errors'

const oauthParsed = {
  authType: 'oauth' as const,
  hasCredentials: true,
  dualStack: false,
  authConfigWarning: null,
}

describe('useGoogleAdsAccountsList', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            accounts: [{ customerId: '1' }],
            total: 1,
            refreshInProgress: false,
          },
        }),
      })
    )
    vi.mocked(fetchGoogleAdsCredentialsStatus).mockReset()
    vi.mocked(fetchGoogleAdsCredentialsStatus).mockResolvedValue(oauthParsed)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetchAccounts returns parsed accounts on success', async () => {
    const { result } = renderHook(() => useGoogleAdsAccountsList())

    let fetchResult: Awaited<ReturnType<typeof result.current.fetchAccounts>> | undefined
    await act(async () => {
      fetchResult = await result.current.fetchAccounts({ forceRefresh: true })
    })

    expect(fetchResult?.ok).toBe(true)
    if (fetchResult?.ok) {
      expect(fetchResult.data.total).toBe(1)
      expect(fetchResult.authForRequest.authType).toBe('oauth')
    }
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/google-ads/credentials/accounts?'),
      expect.objectContaining({ credentials: 'include' })
    )
    const url = String(vi.mocked(fetch).mock.calls[0]?.[0])
    expect(url).toContain('refresh=true')
    expect(url).toContain('async=true')
    expect(url).toContain('auth_type=oauth')
  })

  it('forceRefresh overrides conflicting refresh=false in query', async () => {
    const { result } = renderHook(() => useGoogleAdsAccountsList())

    await act(async () => {
      await result.current.fetchAccounts({
        forceRefresh: true,
        query: { refresh: 'false', offerId: '99' },
      })
    })

    const url = String(vi.mocked(fetch).mock.calls[0]?.[0])
    expect(url).toContain('refresh=true')
    expect(url).toContain('async=true')
    expect(url).toContain('offerId=99')
  })

  it('fetchAccounts returns permission_denied for service account permission errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          code: 'SERVICE_ACCOUNT_PERMISSION_DENIED',
          details: {
            serviceAccountEmail: 'sa@test.iam.gserviceaccount.com',
            mccCustomerId: '1234567890',
          },
        }),
      })
    )

    const { result } = renderHook(() => useGoogleAdsAccountsList())

    let fetchResult: Awaited<ReturnType<typeof result.current.fetchAccounts>> | undefined
    await act(async () => {
      fetchResult = await result.current.fetchAccounts({ forceRefresh: true })
    })

    expect(fetchResult?.ok).toBe(false)
    if (fetchResult && !fetchResult.ok) {
      expect(fetchResult.kind).toBe('permission_denied')
    }
  })

  it('fetchAccounts returns blocked when credentials not configured', async () => {
    vi.mocked(fetchGoogleAdsCredentialsStatus).mockResolvedValue({
      hasCredentials: false,
      dualStack: false,
      authConfigWarning: null,
    })

    const { result } = renderHook(() => useGoogleAdsAccountsList())

    let fetchResult: Awaited<ReturnType<typeof result.current.fetchAccounts>> | undefined
    await act(async () => {
      fetchResult = await result.current.fetchAccounts({ forceRefresh: true })
    })

    expect(fetchResult?.ok).toBe(false)
    if (fetchResult && !fetchResult.ok && fetchResult.kind === 'blocked') {
      expect(fetchResult.effects.errorMessage).toBeTruthy()
    }
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('clearAccountsPoll cancels scheduled poll', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useGoogleAdsAccountsList())

    await act(async () => {
      result.current.scheduleAccountsPoll({ forceRefresh: true }, () => {})
      result.current.clearAccountsPoll()
      await vi.advanceTimersByTimeAsync(3000)
    })

    expect(global.fetch).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('does not invoke poll callback after unmount', async () => {
    vi.useFakeTimers()
    const onResult = vi.fn()
    const { result, unmount } = renderHook(() => useGoogleAdsAccountsList())

    await act(async () => {
      result.current.scheduleAccountsPoll({ forceRefresh: true }, onResult)
      unmount()
      await vi.advanceTimersByTimeAsync(3000)
    })

    expect(onResult).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
