import type { AdCreative } from './ad-creative'
import type { Offer } from './offers'
import {
  computeCampaignConfigHash,
  computeContentHash,
  createLaunchScore,
  findCachedLaunchScore,
  type CampaignConfigData,
  type CreativeContentData,
  type LaunchScore,
  type ScoreAnalysis,
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
    keywordsWithVolume: creative.keywordsWithVolume,
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

export type SaveLaunchScoreWithContentCacheOptions = {
  campaignConfig?: LaunchScoreHashCampaignConfig
  /** 与 findCachedLaunchScore 查询使用相同哈希时可传入，避免发布路径手工哈希不一致 */
  contentHash?: string
  campaignConfigHash?: string
}

/**
 * 相同 creative + contentHash + campaignConfigHash 时复用已有记录，避免重复 INSERT。
 */
export async function saveLaunchScoreWithContentCache(
  userId: number,
  offerId: number,
  creative: AdCreative,
  offer: Offer,
  analysis: ScoreAnalysis,
  options?: SaveLaunchScoreWithContentCacheOptions
): Promise<{ launchScore: LaunchScore; created: boolean }> {
  const built = buildLaunchScoreHashes(creative, offer, options?.campaignConfig)
  const contentHash = options?.contentHash ?? built.contentHash
  const campaignConfigHash = options?.campaignConfigHash ?? built.campaignConfigHash
  const existing = await findCachedLaunchScore(creative.id, contentHash, campaignConfigHash, userId)
  if (existing) {
    return { launchScore: existing, created: false }
  }

  const launchScore = await createLaunchScore(userId, offerId, analysis, {
    adCreativeId: creative.id,
    contentHash,
    campaignConfigHash,
  })
  return { launchScore, created: true }
}
