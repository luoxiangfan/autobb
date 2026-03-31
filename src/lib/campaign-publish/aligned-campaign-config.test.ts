import { describe, expect, it } from 'vitest'
import {
  buildAlignedPublishCampaignConfig,
  evaluatePublishCampaignConfigOwnership,
  hasPublishCampaignConfigOwnershipViolation,
} from './aligned-campaign-config'

describe('buildAlignedPublishCampaignConfig', () => {
  it('prefers creative finalUrl and finalUrlSuffix over input and offer', () => {
    const result = buildAlignedPublishCampaignConfig({
      campaignConfig: {
        finalUrls: ['https://input.example.com'],
        finalUrlSuffix: 'input=1',
      },
      creative: {
        finalUrl: 'https://creative.example.com/pdp',
        finalUrlSuffix: 'creative=1',
      },
      offer: {
        url: 'https://offer.example.com',
        finalUrl: 'https://offer-final.example.com',
        finalUrlSuffix: 'offer=1',
      },
    })

    expect(result.campaignConfig.finalUrls).toEqual(['https://creative.example.com/pdp'])
    expect(result.campaignConfig.finalUrlSuffix).toBe('creative=1')
    expect(result.overridden.finalUrls).toBe(true)
    expect(result.overridden.finalUrlSuffix).toBe(true)
  })

  it('falls back to offer finalUrl, then offer url when creative finalUrl is missing', () => {
    const withOfferFinalUrl = buildAlignedPublishCampaignConfig({
      campaignConfig: {
        finalUrls: ['https://input.example.com'],
      },
      creative: {
        finalUrl: '',
      },
      offer: {
        url: 'https://offer.example.com',
        finalUrl: 'https://offer-final.example.com/landing',
      },
    })

    expect(withOfferFinalUrl.campaignConfig.finalUrls).toEqual(['https://offer-final.example.com/landing'])

    const withOfferUrl = buildAlignedPublishCampaignConfig({
      campaignConfig: {
        finalUrls: ['https://input.example.com'],
      },
      offer: {
        url: 'https://offer.example.com',
      },
    })

    expect(withOfferUrl.campaignConfig.finalUrls).toEqual(['https://offer.example.com'])
  })

  it('keeps input finalUrl/finalUrlSuffix when no upstream source is available', () => {
    const result = buildAlignedPublishCampaignConfig({
      campaignConfig: {
        finalUrls: ['https://input.example.com/path'],
        finalUrlSuffix: 'src=input',
      },
    })

    expect(result.campaignConfig.finalUrls).toEqual(['https://input.example.com/path'])
    expect(result.campaignConfig.finalUrlSuffix).toBe('src=input')
    expect(result.overridden.finalUrls).toBe(false)
    expect(result.overridden.finalUrlSuffix).toBe(false)
  })

  it('marks ownership violation when explicit input conflicts with creative/offer source', () => {
    const result = evaluatePublishCampaignConfigOwnership({
      campaignConfig: {
        finalUrls: ['https://pboost.me/demo'],
        finalUrlSuffix: 'src=pboost',
      },
      creative: {
        finalUrl: 'https://creative.example.com/pdp',
        finalUrlSuffix: 'creative=1',
      },
    })

    expect(result.violation.finalUrls).toBe(true)
    expect(result.violation.finalUrlSuffix).toBe(true)
    expect(result.violation.expectedFinalUrl).toBe('https://creative.example.com/pdp')
    expect(hasPublishCampaignConfigOwnershipViolation(result.violation)).toBe(true)
  })
})
