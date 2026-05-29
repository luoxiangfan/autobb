import { describe, expect, it } from 'vitest'
import {
  buildLaunchScoreApiQueryString,
  parseLaunchScoreHashCampaignConfigFromSearchParamsClient,
  pickLaunchScoreHashCampaignConfigFromStep3,
} from '../launch-score-campaign-config-client'

describe('pickLaunchScoreHashCampaignConfigFromStep3', () => {
  it('extracts hash fields from step3 config', () => {
    expect(
      pickLaunchScoreHashCampaignConfigFromStep3({
        budgetAmount: 25,
        maxCpcBid: 0.5,
        targetCountry: 'US',
        targetLanguage: 'en',
        campaignName: 'ignored',
      })
    ).toEqual({
      budgetAmount: 25,
      maxCpcBid: 0.5,
      targetCountry: 'US',
      targetLanguage: 'en',
    })
  })
})

describe('buildLaunchScoreApiQueryString', () => {
  it('includes creativeId and campaign config params', () => {
    const q = buildLaunchScoreApiQueryString('42', {
      budgetAmount: 30,
      maxCpcBid: 0.2,
      targetCountry: 'CA',
    })
    expect(q).toContain('creativeId=42')
    expect(q).toContain('budgetAmount=30')
    expect(q).toContain('maxCpcBid=0.2')
    expect(q).toContain('targetCountry=CA')
  })
})

describe('parseLaunchScoreHashCampaignConfigFromSearchParamsClient', () => {
  it('parses discrete query fields', () => {
    const params = new URLSearchParams({
      budgetAmount: '15',
      maxCpcBid: '0.33',
    })
    expect(parseLaunchScoreHashCampaignConfigFromSearchParamsClient(params)).toEqual({
      budgetAmount: 15,
      maxCpcBid: 0.33,
      targetCountry: undefined,
      targetLanguage: undefined,
    })
  })
})
