import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { parseDeleteGoogleAdsAccountRequest } from '@/lib/google-ads/account-delete'

describe('parseDeleteGoogleAdsAccountRequest', () => {
  it('reads flag from query string', async () => {
    const req = new NextRequest(
      'http://localhost/api/google-ads-accounts/9?removeGoogleAdsCampaigns=true',
      { method: 'DELETE' }
    )
    await expect(parseDeleteGoogleAdsAccountRequest(req)).resolves.toEqual({
      removeGoogleAdsCampaigns: true,
    })
  })

  it('reads flag from JSON body without content-type', async () => {
    const req = new NextRequest('http://localhost/api/google-ads-accounts/9', {
      method: 'DELETE',
      body: JSON.stringify({ removeGoogleAdsCampaigns: true }),
    })
    await expect(parseDeleteGoogleAdsAccountRequest(req)).resolves.toEqual({
      removeGoogleAdsCampaigns: true,
    })
  })

  it('treats false-like body values as false', async () => {
    const req = new NextRequest('http://localhost/api/google-ads-accounts/9', {
      method: 'DELETE',
      body: JSON.stringify({ removeGoogleAdsCampaigns: 'false' }),
    })
    await expect(parseDeleteGoogleAdsAccountRequest(req)).resolves.toEqual({
      removeGoogleAdsCampaigns: false,
    })
  })
})
