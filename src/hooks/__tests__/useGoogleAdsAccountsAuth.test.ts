// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGoogleAdsAccountsAuth } from '../useGoogleAdsAccountsAuth'
import { GOOGLE_ADS_CREDENTIALS_POLL_REFRESH_EVERY } from '@/lib/google-ads-credentials-errors'

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
  authConfigWarning: null,
}

describe('useGoogleAdsAccountsAuth', () => {
  beforeEach(() => {
    vi.mocked(fetchGoogleAdsCredentialsStatus).mockReset()
    vi.mocked(fetchGoogleAdsCredentialsStatus).mockResolvedValue(oauthParsed)
  })

  it('forceRefresh clears cache and refetches credentials', async () => {
    const { result } = renderHook(() => useGoogleAdsAccountsAuth())

    await act(async () => {
      await result.current.prepareAuthForAccountsFetch({ forceRefresh: true, isPoll: false })
    })
    expect(fetchGoogleAdsCredentialsStatus).toHaveBeenCalledTimes(1)

    vi.mocked(fetchGoogleAdsCredentialsStatus).mockClear()

    await act(async () => {
      await result.current.prepareAuthForAccountsFetch({ forceRefresh: false, isPoll: true })
    })
    expect(fetchGoogleAdsCredentialsStatus).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.prepareAuthForAccountsFetch({ forceRefresh: true, isPoll: false })
    })
    expect(fetchGoogleAdsCredentialsStatus).toHaveBeenCalledTimes(1)
  })

  it('refetches credentials every N poll ticks', async () => {
    const { result } = renderHook(() => useGoogleAdsAccountsAuth())

    await act(async () => {
      await result.current.prepareAuthForAccountsFetch({ forceRefresh: true, isPoll: false })
    })
    expect(fetchGoogleAdsCredentialsStatus).toHaveBeenCalledTimes(1)
    vi.mocked(fetchGoogleAdsCredentialsStatus).mockClear()

    for (let i = 1; i < GOOGLE_ADS_CREDENTIALS_POLL_REFRESH_EVERY; i++) {
      await act(async () => {
        await result.current.prepareAuthForAccountsFetch({ forceRefresh: false, isPoll: true })
      })
    }
    expect(fetchGoogleAdsCredentialsStatus).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.prepareAuthForAccountsFetch({ forceRefresh: false, isPoll: true })
    })
    expect(fetchGoogleAdsCredentialsStatus).toHaveBeenCalledTimes(1)
  })
})
