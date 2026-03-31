import { beforeEach, describe, expect, it, vi } from 'vitest'

type StubDb = {
  type: 'postgres'
  query: ReturnType<typeof vi.fn>
}

const stubDb: StubDb = {
  type: 'postgres',
  query: vi.fn(),
}

const { createRiskAlertMock } = vi.hoisted(() => ({
  createRiskAlertMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: async () => stubDb,
}))

vi.mock('@/lib/risk-alerts', () => ({
  createRiskAlert: createRiskAlertMock,
}))

import { checkCreativePublishTimeouts } from '@/lib/creative-publish-alerts'

describe('checkCreativePublishTimeouts', () => {
  beforeEach(() => {
    stubDb.query.mockReset()
    createRiskAlertMock.mockReset()
  })

  it('creates risk alert when creative completed but no publish request exists', async () => {
    const completedAt = new Date('2026-02-20T08:00:00.000Z')

    stubDb.query
      .mockResolvedValueOnce([
        {
          offer_id: 3694,
          user_id: 1,
          latest_completed_at: completedAt,
          latest_task_id: 'task-1',
          latest_creative_id: 4898,
        },
      ])
      .mockResolvedValueOnce([])

    createRiskAlertMock.mockResolvedValue(101)

    const result = await checkCreativePublishTimeouts({
      thresholdMinutes: 60,
      lookbackHours: 24,
      limit: 100,
    })

    expect(result.scannedOffers).toBe(1)
    expect(result.stalledOffers).toBe(1)
    expect(result.alertsTriggered).toBe(1)
    expect(result.skippedWithPublishRequest).toBe(0)
    expect(result.stalledOfferIds).toEqual([3694])

    expect(createRiskAlertMock).toHaveBeenCalledTimes(1)
    expect(createRiskAlertMock).toHaveBeenCalledWith(
      1,
      'creative_publish_timeout',
      'warning',
      expect.stringContaining('Offer #3694'),
      expect.stringContaining('Offer #3694'),
      expect.objectContaining({
        resourceType: 'offer',
        resourceId: 3694,
      })
    )
  })

  it('skips stalled alert when publish request exists after creative completion', async () => {
    const completedAt = new Date('2026-02-20T08:00:00.000Z')
    const publishAt = new Date('2026-02-20T08:05:00.000Z')

    stubDb.query
      .mockResolvedValueOnce([
        {
          offer_id: 3694,
          user_id: 1,
          latest_completed_at: completedAt,
          latest_task_id: 'task-1',
          latest_creative_id: 4898,
        },
      ])
      .mockResolvedValueOnce([
        {
          request_body_json: JSON.stringify({ offerId: 3694 }),
          created_at: publishAt,
        },
      ])

    const result = await checkCreativePublishTimeouts({
      thresholdMinutes: 60,
      lookbackHours: 24,
      limit: 100,
    })

    expect(result.scannedOffers).toBe(1)
    expect(result.stalledOffers).toBe(0)
    expect(result.alertsTriggered).toBe(0)
    expect(result.skippedWithPublishRequest).toBe(1)
    expect(result.stalledOfferIds).toEqual([])
    expect(createRiskAlertMock).not.toHaveBeenCalled()
  })
})
