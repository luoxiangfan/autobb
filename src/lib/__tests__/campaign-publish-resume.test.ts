import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockExec = vi.fn()

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(async () => ({
    type: 'sqlite',
    exec: mockExec,
  })),
}))

import { buildPublishResumePlan, persistPublishGoogleAdsIds } from '@/lib/campaign-publish-resume'

describe('campaign-publish-resume', () => {
  beforeEach(() => {
    mockExec.mockReset()
  })

  const baseConfig = {
    targetCountry: 'US',
    targetLanguage: 'en',
    budgetAmount: 10,
    budgetType: 'DAILY',
    maxCpcBid: 0.2,
    adGroupName: 'AG-1',
    keywords: ['brand keyword'],
    negativeKeywords: ['free'],
  }

  const baseCreative = {
    headlines: ['h1', 'h2'],
    descriptions: ['d1'],
    finalUrl: 'https://example.com',
    callouts: ['Free Shipping'],
    sitelinks: [{ text: 'Shop', url: 'https://example.com' }],
  }

  it('detects no remote resources as full create mode', () => {
    const plan = buildPublishResumePlan({
      stored: null,
      nextCampaignConfig: baseConfig,
      nextCreative: baseCreative,
    })

    expect(plan.resumeMode).toBe(false)
    expect(plan.discoverRemoteByName).toBe(false)
    expect(plan.campaignSettingsChanged).toBe(true)
  })

  it('enables local resume when publish_failed has no google ids', () => {
    const plan = buildPublishResumePlan({
      enableLocalResume: true,
      stored: {
        id: 9,
        campaign_name: 'BrandA_US_11_22',
        creation_status: 'failed',
        status: 'REMOVED',
        google_campaign_id: null,
        campaign_id: null,
        google_ad_group_id: null,
        google_ad_id: null,
        campaign_config: JSON.stringify(baseConfig),
        google_ads_account_id: 1,
        ad_creative_id: 2,
        budget_amount: 10,
        budget_type: 'DAILY',
        max_cpc: 0.2,
      },
      nextCampaignConfig: { ...baseConfig },
      nextCreative: baseCreative,
    })

    expect(plan.resumeMode).toBe(true)
    expect(plan.discoverRemoteByName).toBe(true)
    expect(plan.googleCampaignId).toBeNull()
  })

  it('skips campaign update when settings unchanged on resume', () => {
    const plan = buildPublishResumePlan({
      enableLocalResume: true,
      stored: {
        id: 1,
        campaign_name: 'C1',
        creation_status: 'failed',
        status: 'REMOVED',
        google_campaign_id: '123',
        campaign_id: null,
        google_ad_group_id: '456',
        google_ad_id: '789',
        campaign_config: JSON.stringify({
          ...baseConfig,
          headlines: baseCreative.headlines,
          descriptions: baseCreative.descriptions,
          callouts: baseCreative.callouts,
          sitelinks: baseCreative.sitelinks,
          finalUrl: baseCreative.finalUrl,
        }),
        google_ads_account_id: 1,
        ad_creative_id: 2,
        budget_amount: 10,
        budget_type: 'DAILY',
        max_cpc: 0.2,
      },
      nextCampaignConfig: { ...baseConfig },
      nextCreative: baseCreative,
    })

    expect(plan.resumeMode).toBe(true)
    expect(plan.googleCampaignId).toBe('123')
    expect(plan.campaignSettingsChanged).toBe(false)
    expect(plan.adGroupSettingsChanged).toBe(false)
    expect(plan.keywordsChanged).toBe(false)
    expect(plan.rsaChanged).toBe(false)
  })

  it('marks rsa changed when creative assets differ', () => {
    const plan = buildPublishResumePlan({
      enableLocalResume: true,
      stored: {
        id: 1,
        campaign_name: 'C1',
        creation_status: 'failed',
        status: 'REMOVED',
        google_campaign_id: '123',
        campaign_id: null,
        google_ad_group_id: '456',
        google_ad_id: '789',
        campaign_config: JSON.stringify({
          ...baseConfig,
          headlines: ['old headline'],
          descriptions: ['old description'],
        }),
        google_ads_account_id: 1,
        ad_creative_id: 2,
        budget_amount: 10,
        budget_type: 'DAILY',
        max_cpc: 0.2,
      },
      nextCampaignConfig: baseConfig,
      nextCreative: {
        ...baseCreative,
        headlines: ['new headline'],
      },
    })

    expect(plan.resumeMode).toBe(true)
    expect(plan.rsaChanged).toBe(true)
    expect(plan.campaignSettingsChanged).toBe(false)
  })

  it('persists discovered google ids for pending campaigns immediately', async () => {
    mockExec.mockResolvedValueOnce({ changes: 1 })

    await expect(
      persistPublishGoogleAdsIds({
        userId: 7,
        campaignId: 99,
        googleCampaignId: '123456',
        googleAdGroupId: '789012',
      })
    ).resolves.toBe(true)

    expect(mockExec).toHaveBeenCalledWith(expect.stringContaining("creation_status = 'pending'"), [
      '123456',
      '123456',
      '789012',
      99,
      7,
    ])
  })

  it('skips persist when no ids are provided', async () => {
    await expect(
      persistPublishGoogleAdsIds({
        userId: 7,
        campaignId: 99,
      })
    ).resolves.toBe(false)

    expect(mockExec).not.toHaveBeenCalled()
  })
})
