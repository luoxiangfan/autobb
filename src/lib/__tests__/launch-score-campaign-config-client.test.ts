import { describe, expect, it } from 'vitest'
import {
  buildLaunchScoreApiQueryString,
  buildLaunchScorePagePath,
  parseLaunchScoreHashCampaignConfigFromSearchParamsClient,
  pickLaunchScoreHashCampaignConfigFromStep3,
  serializeLaunchScoreCampaignConfigQueryKey,
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

  it('extracts keywords from step3 config', () => {
    expect(
      pickLaunchScoreHashCampaignConfigFromStep3({
        keywords: [{ keyword: 'boots' }],
      })
    ).toEqual({
      keywords: [{ keyword: 'boots' }],
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

  it('can request merged performance on GET launch-score', () => {
    const q = buildLaunchScoreApiQueryString('42', undefined, {
      includePerformance: true,
      daysBack: 30,
    })
    expect(q).toContain('includePerformance=true')
    expect(q).toContain('daysBack=30')
  })

  it('serializes keywords via campaignConfig JSON for server hash alignment', () => {
    const q = buildLaunchScoreApiQueryString('42', {
      budgetAmount: 30,
      keywords: [{ keyword: 'shoes', matchType: 'PHRASE' }],
    })
    expect(q).toContain('campaignConfig=')
    expect(decodeURIComponent(q)).toContain('shoes')
    expect(q).not.toContain('budgetAmount=30')
  })
})

describe('parseLaunchScoreHashCampaignConfigFromSearchParamsClient', () => {
  it('parses campaignConfig JSON with keywords', () => {
    const params = new URLSearchParams({
      campaignConfig: JSON.stringify({
        budgetAmount: 20,
        keywords: [{ keyword: 'hat' }],
      }),
    })
    expect(parseLaunchScoreHashCampaignConfigFromSearchParamsClient(params)).toEqual({
      budgetAmount: 20,
      keywords: [{ keyword: 'hat' }],
    })
  })
})

describe('buildLaunchScorePagePath', () => {
  it('builds path with offerId and creativeId', () => {
    expect(buildLaunchScorePagePath({ offerId: 7, creativeId: 42 })).toBe(
      '/launch-score?offerId=7&creativeId=42'
    )
  })

  it('appends campaign config query fields', () => {
    const path = buildLaunchScorePagePath({
      offerId: 1,
      creativeId: 2,
      campaignConfig: { budgetAmount: 20, maxCpcBid: 0.4, targetCountry: 'US' },
    })
    expect(path).toContain('offerId=1')
    expect(path).toContain('creativeId=2')
    expect(path).toContain('budgetAmount=20')
    expect(path).toContain('maxCpcBid=0.4')
    expect(path).toContain('targetCountry=US')
  })

  it('uses campaignConfig JSON when keywords are present', () => {
    const path = buildLaunchScorePagePath({
      offerId: 1,
      creativeId: 2,
      campaignConfig: {
        budgetAmount: 20,
        keywords: [{ keyword: 'bag' }],
      },
    })
    expect(path).toContain('campaignConfig=')
    expect(decodeURIComponent(path)).toContain('bag')
  })
})

describe('serializeLaunchScoreCampaignConfigQueryKey', () => {
  it('serializes campaign config query fields for stable deps', () => {
    const params = new URLSearchParams({
      budgetAmount: '10',
      targetCountry: 'CA',
    })
    expect(serializeLaunchScoreCampaignConfigQueryKey(params)).toBe('10||CA||')
  })
})
