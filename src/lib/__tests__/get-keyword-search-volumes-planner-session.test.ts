import { beforeEach, describe, expect, it, vi } from 'vitest'

const volumeFns = vi.hoisted(() => ({
  getKeywordSearchVolumes: vi.fn(),
}))

vi.mock('@/lib/keyword-planner', () => ({
  getKeywordSearchVolumes: volumeFns.getKeywordSearchVolumes,
}))

import {
  getKeywordSearchVolumesForPlannerContext,
  type KeywordPlannerPreparedSession,
} from '@/lib/google-ads-accounts-auth'

const mockSession: KeywordPlannerPreparedSession = {
  volumeAuth: {
    authType: 'oauth',
    plannerAuth: { existingContext: {} as never },
  },
}

describe('getKeywordSearchVolumesForPlannerContext plannerSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    volumeFns.getKeywordSearchVolumes.mockResolvedValue([
      { keyword: 'test', avgMonthlySearches: 10 },
    ])
  })

  it('reuses plannerSession.volumeAuth without a separate prepare path', async () => {
    const result = await getKeywordSearchVolumesForPlannerContext({
      userId: 7,
      offerId: 3,
      keywords: ['test'],
      country: 'US',
      language: 'en',
      plannerSession: mockSession,
    })

    expect(result.ok).toBe(true)
    expect(volumeFns.getKeywordSearchVolumes).toHaveBeenCalledWith(
      ['test'],
      'US',
      'en',
      7,
      'oauth',
      undefined,
      undefined,
      mockSession.volumeAuth.plannerAuth
    )
  })
})
