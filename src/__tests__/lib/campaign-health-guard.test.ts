import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}))

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>()
  return {
    ...actual,
    getDatabase: mocks.getDatabase,
  }
})

import { hasEnabledCampaignForOffer } from '@/lib/campaign/campaign-health-guard'

describe('campaign health guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('detects enabled campaign by user + offer', async () => {
    const db = {
      queryOne: vi.fn(async () => ({ id: 77 })),
    }

    mocks.getDatabase.mockResolvedValue(db)

    const hasEnabled = await hasEnabledCampaignForOffer({
      userId: 1,
      offerId: 3343,
    })

    expect(hasEnabled).toBe(true)
    expect(db.queryOne).toHaveBeenCalledTimes(1)
  })

  it('returns false when no enabled campaign exists', async () => {
    const db = {
      queryOne: vi.fn(async () => null),
    }

    mocks.getDatabase.mockResolvedValue(db)

    const hasEnabled = await hasEnabledCampaignForOffer({
      userId: 1,
      offerId: 3343,
    })

    expect(hasEnabled).toBe(false)
  })
})
