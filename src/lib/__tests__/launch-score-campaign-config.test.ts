import { describe, expect, it } from 'vitest'
import {
  launchScoreHashConfigFromPublishCampaignConfig,
  parseLaunchScoreHashCampaignConfig,
  parseLaunchScoreHashCampaignConfigFromSearchParams,
  toCampaignConfigHashData,
} from '../launch-score/server'

describe('parseLaunchScoreHashCampaignConfig', () => {
  it('parses object fields', () => {
    expect(
      parseLaunchScoreHashCampaignConfig({
        budgetAmount: 25,
        maxCpcBid: 0.5,
        targetCountry: 'US',
        targetLanguage: 'en',
      })
    ).toEqual({
      budgetAmount: 25,
      maxCpcBid: 0.5,
      targetCountry: 'US',
      targetLanguage: 'en',
    })
  })

  it('parses JSON string', () => {
    expect(
      parseLaunchScoreHashCampaignConfig(JSON.stringify({ budgetAmount: 12, maxCpcBid: 0.2 }))
    ).toEqual({
      budgetAmount: 12,
      maxCpcBid: 0.2,
      targetCountry: undefined,
      targetLanguage: undefined,
    })
  })

  it('returns undefined for empty object', () => {
    expect(parseLaunchScoreHashCampaignConfig({})).toBeUndefined()
  })

  it('parses keywords array', () => {
    expect(
      parseLaunchScoreHashCampaignConfig({
        keywords: ['brand', { text: 'buy', matchType: 'PHRASE' }],
      })
    ).toEqual({
      budgetAmount: undefined,
      maxCpcBid: undefined,
      targetCountry: undefined,
      targetLanguage: undefined,
      keywords: ['brand', { text: 'buy', matchType: 'PHRASE' }],
    })
  })
})

describe('parseLaunchScoreHashCampaignConfigFromSearchParams', () => {
  it('reads discrete query fields', () => {
    const params = new URLSearchParams({
      budgetAmount: '30',
      maxCpcBid: '0.25',
      targetCountry: 'CA',
    })
    expect(parseLaunchScoreHashCampaignConfigFromSearchParams(params)).toEqual({
      budgetAmount: 30,
      maxCpcBid: 0.25,
      targetCountry: 'CA',
      targetLanguage: undefined,
    })
  })
})

describe('toCampaignConfigHashData publish vs default', () => {
  const offer = {
    target_country: 'US',
    target_language: 'en',
  } as any

  it('uses zero budget fallback for publish', () => {
    const data = toCampaignConfigHashData(
      launchScoreHashConfigFromPublishCampaignConfig({}),
      offer,
      { useZeroBudgetFallback: true }
    )
    expect(data.dailyBudget).toBe(0)
    expect(data.maxCpc).toBe(0)
  })

  it('uses default budget for API without config', () => {
    const data = toCampaignConfigHashData(undefined, offer)
    expect(data.dailyBudget).toBe(10)
    expect(data.maxCpc).toBe(0.17)
  })
})
