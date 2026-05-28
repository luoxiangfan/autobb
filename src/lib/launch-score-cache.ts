import type { AdCreative } from './ad-creative'
import type { Offer } from './offers'
import {
  computeCampaignConfigHash,
  computeContentHash,
  findCachedLaunchScore,
  type CampaignConfigData,
  type CreativeContentData,
} from './launch-scores'

/** 与 calculateLaunchScore 默认投放参数一致 */
export const DEFAULT_LAUNCH_SCORE_DAILY_BUDGET = 10
export const DEFAULT_LAUNCH_SCORE_MAX_CPC = 0.17

export type LaunchScoreHashCampaignConfig = {
  budgetAmount?: number
  maxCpcBid?: number
  targetCountry?: string
  targetLanguage?: string
}

export function buildLaunchScoreHashes(
  creative: AdCreative,
  offer: Offer,
  campaignConfig?: LaunchScoreHashCampaignConfig
): { contentHash: string; campaignConfigHash: string } {
  const contentHashData: CreativeContentData = {
    headlines: creative.headlines || [],
    descriptions: creative.descriptions || [],
    keywords: creative.keywords || [],
    negativeKeywords: creative.negativeKeywords || [],
    finalUrl: (creative.final_url || offer.final_url || offer.url || '').trim(),
  }
  const campaignConfigHashData: CampaignConfigData = {
    targetCountry: campaignConfig?.targetCountry || offer.target_country || 'US',
    targetLanguage: campaignConfig?.targetLanguage || offer.target_language || 'en',
    dailyBudget: campaignConfig?.budgetAmount ?? DEFAULT_LAUNCH_SCORE_DAILY_BUDGET,
    maxCpc: campaignConfig?.maxCpcBid ?? DEFAULT_LAUNCH_SCORE_MAX_CPC,
  }
  return {
    contentHash: computeContentHash(contentHashData),
    campaignConfigHash: computeCampaignConfigHash(campaignConfigHashData),
  }
}

export async function findCachedLaunchScoreForCreative(
  creative: AdCreative,
  offer: Offer,
  userId: number,
  campaignConfig?: LaunchScoreHashCampaignConfig
) {
  const { contentHash, campaignConfigHash } = buildLaunchScoreHashes(creative, offer, campaignConfig)
  return findCachedLaunchScore(creative.id, contentHash, campaignConfigHash, userId)
}
