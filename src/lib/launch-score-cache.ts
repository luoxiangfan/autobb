import type { AdCreative } from './ad-creative'
import type { Offer } from './offers'
import {
  type LaunchScoreHashCampaignConfig,
  toCampaignConfigHashData,
  toLaunchScoreScoringCampaignConfig,
} from './launch-score-campaign-config'
import {
  computeCampaignConfigHash,
  computeContentHash,
  createLaunchScore,
  findCachedLaunchScore,
  findLatestLaunchScore,
  findLatestLaunchScoresByCreativeIds,
  resolveLaunchScoreForCreativeCompare,
  resolveLaunchScoreForCreativeCompareFromMaps,
  type CreativeContentData,
  type LaunchScore,
  type ScoreAnalysis,
} from './launch-scores'
import { calculateLaunchScore } from './scoring'

export type { LaunchScoreHashCampaignConfig } from './launch-score-campaign-config'
export {
  DEFAULT_LAUNCH_SCORE_DAILY_BUDGET,
  DEFAULT_LAUNCH_SCORE_MAX_CPC,
} from './launch-score-campaign-config'

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
  const campaignConfigHashData = toCampaignConfigHashData(campaignConfig, offer)
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

export type CreativeLaunchScoreReadResult = {
  /** 与当前创意 contentHash 精确匹配的记录 */
  score: LaunchScore | null
  /** 库中该创意最新一条，但与当前内容哈希不一致 */
  staleScore: LaunchScore | null
}

/**
 * GET 读路径：优先 contentHash 命中；否则标记是否存在过期分。
 */
export async function readLaunchScoreForCreative(
  creative: AdCreative,
  offer: Offer,
  userId: number,
  campaignConfig?: LaunchScoreHashCampaignConfig
): Promise<CreativeLaunchScoreReadResult> {
  const cached = await findCachedLaunchScoreForCreative(creative, offer, userId, campaignConfig)
  if (cached) {
    return { score: cached, staleScore: null }
  }

  const offerLatest = await findLatestLaunchScore(offer.id, userId)
  const { score } = await resolveLaunchScoreForCreativeCompare(
    creative.id,
    userId,
    offerLatest,
    1
  )
  return { score: null, staleScore: score }
}

/** 并行查询多创意的 contentHash 缓存（compare 等批量场景） */
export async function findCachedLaunchScoresForCreatives(
  creatives: AdCreative[],
  offer: Offer,
  userId: number,
  campaignConfig?: LaunchScoreHashCampaignConfig
): Promise<Map<number, LaunchScore>> {
  const pairs = await Promise.all(
    creatives.map(async (creative) => {
      const cached = await findCachedLaunchScoreForCreative(
        creative,
        offer,
        userId,
        campaignConfig
      )
      return [creative.id, cached] as const
    })
  )

  const result = new Map<number, LaunchScore>()
  for (const [creativeId, score] of pairs) {
    if (score) {
      result.set(creativeId, score)
    }
  }
  return result
}

/** 并行 readLaunchScoreForCreative（只读对比）；批量复用 offer / per-creative 最新分查询 */
export async function readLaunchScoresForCreatives(
  creatives: AdCreative[],
  offer: Offer,
  userId: number,
  campaignConfig?: LaunchScoreHashCampaignConfig
): Promise<Map<number, CreativeLaunchScoreReadResult>> {
  if (creatives.length === 0) {
    return new Map()
  }

  const creativeIds = creatives.map((c) => c.id)
  const [cacheEntries, offerLatest, scoresByCreativeId] = await Promise.all([
    Promise.all(
      creatives.map(async (creative) => {
        const cached = await findCachedLaunchScoreForCreative(
          creative,
          offer,
          userId,
          campaignConfig
        )
        return [creative.id, cached] as const
      })
    ),
    findLatestLaunchScore(offer.id, userId),
    findLatestLaunchScoresByCreativeIds(creativeIds, userId),
  ])

  const result = new Map<number, CreativeLaunchScoreReadResult>()
  for (const [creativeId, cached] of cacheEntries) {
    if (cached) {
      result.set(creativeId, { score: cached, staleScore: null })
      continue
    }
    const { score } = resolveLaunchScoreForCreativeCompareFromMaps(
      creativeId,
      scoresByCreativeId,
      offerLatest,
      1
    )
    result.set(creativeId, { score: null, staleScore: score })
  }
  return result
}

export type EnsureLaunchScoreForCreativeResult = {
  launchScore: LaunchScore
  fromCache: boolean
}

/**
 * 返回与当前创意内容哈希匹配的 Launch Score；无则计算并写入（含去重）。
 */
export async function ensureLaunchScoreForCreative(
  userId: number,
  offer: Offer,
  creative: AdCreative,
  campaignConfig?: LaunchScoreHashCampaignConfig
): Promise<EnsureLaunchScoreForCreativeResult> {
  const cached = await findCachedLaunchScoreForCreative(creative, offer, userId, campaignConfig)
  if (cached) {
    return { launchScore: cached, fromCache: true }
  }

  const scoringConfig = toLaunchScoreScoringCampaignConfig(campaignConfig, offer)
  const analysis = await calculateLaunchScore(offer, creative, userId, scoringConfig)
  const { launchScore } = await saveLaunchScoreWithContentCache(
    userId,
    offer.id,
    creative,
    offer,
    analysis.scoreAnalysis,
    { campaignConfig }
  )
  return { launchScore, fromCache: false }
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
