import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  exec: vi.fn(),
}))

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>()
  return {
    ...actual,
    getDatabase: vi.fn(async () => ({
      queryOne: dbMocks.queryOne,
      exec: dbMocks.exec,
    })),
    utcNowIso: vi.fn(() => '2026-06-16T10:00:00.000Z'),
  }
})

vi.mock('@/lib/google-ads/campaign/final-url', () => ({
  firstNonEmptyFinalUrlFromCampaignConfig: vi.fn(() => 'https://www.amazon.com/stores/page/store'),
}))

vi.mock('@/lib/openclaw/offers/offer-asin', () => ({
  extractAsinFromOfferUrls: vi.fn(() => null),
}))

import { createOfferFirst } from '@/lib/google-ads/campaign/sync/persist'

describe('google-ads-campaign-sync/persist.createOfferFirst', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMocks.exec.mockResolvedValue({ changes: 1 })
  })

  it('sets updated_at when backfilling page_type on existing google_ads_sync offer', async () => {
    dbMocks.queryOne.mockResolvedValue({
      id: 42,
      sync_source: 'google_ads_sync',
      url: 'https://www.amazon.com/stores/page/store',
      final_url: 'https://www.amazon.com/stores/page/store',
      final_url_suffix: '',
      brand: 'Acme',
      page_type: 'product',
    })

    const result = await createOfferFirst({
      userId: 7,
      campaign: {
        campaign_id: '123',
        campaign_name: 'Acme - US',
        budget_amount: 10,
        budget_type: 'DAILY',
        status: 'ENABLED',
        customer_id: '999',
      },
      campaignConfig: {
        finalUrls: ['https://www.amazon.com/stores/page/store'],
      },
    })

    expect(result.offerFieldsUpdated).toBe(true)
    expect(dbMocks.exec).toHaveBeenCalledTimes(1)
    const [sql, params] = dbMocks.exec.mock.calls[0]
    expect(String(sql)).toContain('updated_at = ?')
    expect(String(sql)).toContain('page_type = ?')
    expect(String(sql)).toContain('user_id = ?')
    expect(params).toContain('2026-06-16T10:00:00.000Z')
    expect(params).toContain(42)
    expect(params).toContain(7)
  })
})
