import { describe, it, expect } from 'vitest'
import { normalizeGoogleAdsApiUpdateOperations } from '../google-ads-mutate-helpers'

describe('normalizeGoogleAdsApiUpdateOperations', () => {
  it('converts mutate-style update operations into google-ads-api update objects', () => {
    const out = normalizeGoogleAdsApiUpdateOperations([
      {
        update: {
          resource_name: 'customers/123/campaigns/456',
          target_spend: { cpc_bid_ceiling_micros: 1230000 },
        },
        update_mask: 'target_spend.cpc_bid_ceiling_micros',
      },
    ])

    expect(out).toEqual([
      {
        resource_name: 'customers/123/campaigns/456',
        target_spend: { cpc_bid_ceiling_micros: 1230000 },
      },
    ])
  })

  it('throws when resource_name is missing', () => {
    expect(() =>
      normalizeGoogleAdsApiUpdateOperations([
        { update: { cpc_bid_micros: 1000000 }, update_mask: 'cpc_bid_micros' },
      ])
    ).toThrow('Resource name is missing.')
  })
})

