// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGoogleAdsAccountsList } from '../useGoogleAdsAccountsList'

vi.mock('@/lib/google-ads-credentials-errors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google-ads-credentials-errors')>()
  return {
    ...actual,
    fetchGoogleAdsCredentialsStatus: vi.fn(),
  }
})

import { fetchGoogleAdsCredentialsStatus } from '@/lib/google-ads-credentials-errors'

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
})
