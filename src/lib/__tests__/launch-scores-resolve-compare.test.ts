import { describe, expect, it } from 'vitest'
import {
  resolveOfferLatestLaunchScoreForCompare,
  type LaunchScore,
} from '../launch-scores'

function scoreRow(overrides: Partial<LaunchScore>): LaunchScore {
  return {
    id: 1,
    userId: 1,
    offerId: 10,
    totalScore: 80,
    launchViabilityScore: 30,
    adQualityScore: 25,
    keywordStrategyScore: 15,
    basicConfigScore: 10,
    launchViabilityData: null,
    adQualityData: null,
    keywordStrategyData: null,
    basicConfigData: null,
    recommendations: null,
    calculatedAt: '2026-01-01T00:00:00.000Z',
    adCreativeId: null,
    issues: null,
    suggestions: null,
    contentHash: null,
    campaignConfigHash: null,
    ...overrides,
  }
}

describe('resolveOfferLatestLaunchScoreForCompare', () => {
  it('matches offer latest when ad_creative_id equals creative', () => {
    const offerLatest = scoreRow({ adCreativeId: 99, totalScore: 75 })
    expect(resolveOfferLatestLaunchScoreForCompare(offerLatest, 99, 2)).toEqual({
      score: offerLatest,
      scoreSource: 'creative',
    })
  })

  it('allows legacy null ad_creative_id only for single-creative compare', () => {
    const offerLatest = scoreRow({ adCreativeId: null, totalScore: 72 })
    expect(resolveOfferLatestLaunchScoreForCompare(offerLatest, 99, 1)).toEqual({
      score: offerLatest,
      scoreSource: 'offer_latest',
    })
    expect(resolveOfferLatestLaunchScoreForCompare(offerLatest, 99, 2)).toEqual({
      score: null,
      scoreSource: null,
    })
  })

  it('returns null when latest belongs to another creative', () => {
    const offerLatest = scoreRow({ adCreativeId: 50 })
    expect(resolveOfferLatestLaunchScoreForCompare(offerLatest, 99, 1)).toEqual({
      score: null,
      scoreSource: null,
    })
  })
})
