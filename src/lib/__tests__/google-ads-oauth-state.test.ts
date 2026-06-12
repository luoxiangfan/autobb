import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/config', () => ({
  JWT_SECRET: 'test-jwt-secret-at-least-32-chars-long!!',
}))

import {
  createGoogleAdsOAuthState,
  GOOGLE_ADS_OAUTH_STATE_FUTURE_SKEW_MS,
  GOOGLE_ADS_OAUTH_STATE_MAX_AGE_MS,
  verifyGoogleAdsOAuthState,
} from '@/lib/google-ads/oauth/state'

describe('@/lib/google-ads/oauth/state', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('creates and verifies a valid signed state', () => {
    const state = createGoogleAdsOAuthState({
      user_id: 42,
      timestamp: Date.now(),
      purpose: 'google_ads',
    })

    const result = verifyGoogleAdsOAuthState(state, {
      expectedPurpose: 'google_ads',
      expectedUserId: 42,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.user_id).toBe(42)
      expect(result.payload.purpose).toBe('google_ads')
    }
  })

  it('rejects tampered payload', () => {
    const state = createGoogleAdsOAuthState({
      user_id: 1,
      timestamp: Date.now(),
    })
    const [body] = state.split('.')
    const tampered = `${body}x.${state.split('.')[1]}`

    expect(verifyGoogleAdsOAuthState(tampered).ok).toBe(false)
  })

  it('rejects expired state', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    const state = createGoogleAdsOAuthState({
      user_id: 1,
      timestamp: Date.now(),
    })

    vi.setSystemTime(new Date(Date.now() + GOOGLE_ADS_OAUTH_STATE_MAX_AGE_MS + 1))

    const result = verifyGoogleAdsOAuthState(state)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('state_expired')
    }
  })

  it('rejects state timestamp too far in the future', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    const state = createGoogleAdsOAuthState({
      user_id: 1,
      timestamp: Date.now() + GOOGLE_ADS_OAUTH_STATE_FUTURE_SKEW_MS + 1,
    })

    const result = verifyGoogleAdsOAuthState(state)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('invalid_state')
    }
  })

  it('rejects session user mismatch', () => {
    const state = createGoogleAdsOAuthState({
      user_id: 1,
      timestamp: Date.now(),
    })

    const result = verifyGoogleAdsOAuthState(state, { expectedUserId: 2 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('session_mismatch')
    }
  })

  it('rejects wrong purpose', () => {
    const state = createGoogleAdsOAuthState({
      user_id: 1,
      timestamp: Date.now(),
    })

    const result = verifyGoogleAdsOAuthState(state, { expectedPurpose: 'google_ads' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('invalid_purpose')
    }
  })
})
