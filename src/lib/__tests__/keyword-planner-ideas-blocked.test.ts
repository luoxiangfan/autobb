import { describe, expect, it } from 'vitest'
import { keywordPlannerIdeasBlockedReason } from '@/lib/keywords'
import type { KeywordPlannerSessionAuthResult } from '@/lib/keywords'

describe('keywordPlannerIdeasBlockedReason', () => {
  it('returns prepare failure message when session auth failed', () => {
    const plannerAuth: KeywordPlannerSessionAuthResult = {
      ok: false,
      message: 'Google Ads OAuth 授权已过期',
    }
    expect(keywordPlannerIdeasBlockedReason(plannerAuth)).toBe('Google Ads OAuth 授权已过期')
  })

  it('does not block ideas for service_account even without preparedOAuth', () => {
    const plannerAuth: KeywordPlannerSessionAuthResult = {
      ok: true,
      session: {
        volumeAuth: {
          authType: 'service_account',
          serviceAccountId: 'sa-linked',
          plannerAuth: { existingContext: {} as never },
        },
      },
    }
    expect(keywordPlannerIdeasBlockedReason(plannerAuth)).toBeNull()
  })

  it('blocks OAuth ideas when preparedOAuth is missing', () => {
    const plannerAuth: KeywordPlannerSessionAuthResult = {
      ok: true,
      session: {
        volumeAuth: {
          authType: 'oauth',
          plannerAuth: { existingContext: {} as never },
        },
      },
    }
    expect(keywordPlannerIdeasBlockedReason(plannerAuth)).toBe(
      'OAuth credentials unavailable for Keyword Planner'
    )
  })

  it('allows OAuth ideas when preparedOAuth is present', () => {
    const plannerAuth: KeywordPlannerSessionAuthResult = {
      ok: true,
      session: {
        preparedOAuth: {
          credentials: {} as never,
          refreshToken: 'rt',
        },
        volumeAuth: {
          authType: 'oauth',
          plannerAuth: { existingContext: {} as never },
        },
      },
    }
    expect(keywordPlannerIdeasBlockedReason(plannerAuth)).toBeNull()
  })

  it('returns null when plannerAuth is null (no session)', () => {
    expect(keywordPlannerIdeasBlockedReason(null)).toBeNull()
  })
})
