import type { AdCreative } from './ad-creative'
import { findAdCreativeById, findAdCreativesByOfferId } from './ad-creative'
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
  findLaunchScoreById,
  findLatestLaunchScore,
  findLatestLaunchScoresByCreativeIds,
  resolveKeywordsWithVolumeForLaunchScore,
  resolveLaunchScoreForCreativeCompare,
  resolveLaunchScoreForCreativeCompareFromMaps,
  type CreativeContentData,
  type LaunchScore,
  type LaunchScoreCompareSource,
  type ScoreAnalysis,
} from './launch-scores'
import { calculateLaunchScore } from './scoring'

export type { LaunchScoreHashCampaignConfig } from './launch-score-campaign-config'
export {
  DEFAULT_LAUNCH_SCORE_DAILY_BUDGET,
  DEFAULT_LAUNCH_SCORE_MAX_CPC,
} from './launch-score-campaign-config'

/** 按 ad_creatives.score 选最高分创意（无 hash 命中时的回退） */
export function pickBestAdCreativeByScore(creatives: AdCreative[]): AdCreative | null {
  if (creatives.length === 0) {
    return null
  }
  return creatives.reduce((best, current) =>
    (current.score || 0) > (best.score || 0) ? current : best
  )
}

/** Step3 关键词优先：构建与发布路径一致的 contentHash 输入 */
export function buildLaunchScoreCreativeContentData(
  creative: AdCreative,
  offer: Offer,
  campaignConfig?: LaunchScoreHashCampaignConfig
): CreativeContentData {
  const keywordsWithVolume = resolveKeywordsWithVolumeForLaunchScore(creative, campaignConfig)
  return {
    headlines: creative.headlines || [],
    descriptions: creative.descriptions || [],
    keywords: creative.keywords || [],
    negativeKeywords: creative.negativeKeywords || [],
    keywordsWithVolume,
    finalUrl: (creative.final_url || offer.final_url || offer.url || '').trim(),
  }
}

/** 计分前注入 Step3 解析后的 keywordsWithVolume */
export function enrichCreativeForLaunchScore(
  creative: AdCreative,
  offer: Offer,
  campaignConfig?: LaunchScoreHashCampaignConfig
): AdCreative {
  const keywordsWithVolume = resolveKeywordsWithVolumeForLaunchScore(creative, campaignConfig)
  return { ...creative, keywordsWithVolume: keywordsWithVolume as AdCreative['keywordsWithVolume'] }
}

export function buildLaunchScoreHashes(
  creative: AdCreative,
  offer: Offer,
  campaignConfig?: LaunchScoreHashCampaignConfig,
  options?: { useZeroBudgetFallback?: boolean }
): { contentHash: string; campaignConfigHash: string } {
  const contentHashData = buildLaunchScoreCreativeContentData(creative, offer, campaignConfig)
  const campaignConfigHashData = toCampaignConfigHashData(campaignConfig, offer, {
    useZeroBudgetFallback: options?.useZeroBudgetFallback,
  })
  return {
    contentHash: computeContentHash(contentHashData),
    campaignConfigHash: computeCampaignConfigHash(campaignConfigHashData),
  }
}

/**
 * 无 creativeId 读分：优先选当前 hash 下 Launch Score 最高的创意，否则回退 ad_creatives.score。
 */
export async function pickBestCreativeForLaunchScoreRead(
  creatives: AdCreative[],
  offer: Offer,
  userId: number,
  campaignConfig?: LaunchScoreHashCampaignConfig
): Promise<AdCreative | null> {
  if (creatives.length === 0) {
    return null
  }
  if (creatives.length === 1) {
    return creatives[0]
  }

  const cachedById = await findCachedLaunchScoresForCreatives(
    creatives,
    offer,
    userId,
    campaignConfig
  )
  let bestCreative: AdCreative | null = null
  let bestTotal = -1
  for (const creative of creatives) {
    const cached = cachedById.get(creative.id)
    if (cached && cached.totalScore > bestTotal) {
      bestTotal = cached.totalScore
      bestCreative = creative
    }
  }
  return bestCreative ?? pickBestAdCreativeByScore(creatives)
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
  /** 库中该创意最新一条，但与当前 contentHash / campaignConfigHash 不一致 */
  staleScore: LaunchScore | null
}

/** 仅 per-creative 旧记录算过期；legacy offer 级分数不算 stale */
function staleScoreFromCreativeCompare(
  score: LaunchScore | null,
  scoreSource: LaunchScoreCompareSource | null
): LaunchScore | null {
  if (score && scoreSource === 'creative') {
    return score
  }
  return null
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
  const { score, scoreSource } = await resolveLaunchScoreForCreativeCompare(
    creative.id,
    userId,
    offerLatest,
    1
  )
  return { score: null, staleScore: staleScoreFromCreativeCompare(score, scoreSource) }
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
    const { score, scoreSource } = resolveLaunchScoreForCreativeCompareFromMaps(
      creativeId,
      scoresByCreativeId,
      offerLatest,
      1
    )
    result.set(creativeId, {
      score: null,
      staleScore: staleScoreFromCreativeCompare(score, scoreSource),
    })
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
  const creativeForScoring = enrichCreativeForLaunchScore(creative, offer, campaignConfig)
  const analysis = await calculateLaunchScore(offer, creativeForScoring, userId, scoringConfig)
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

export type LaunchScorePerformanceLookupResult = {
  launchScore: LaunchScore | null
  stale: boolean
  resolvedCreativeId?: number
}

/**
 * Performance API 读分：优先 launchScoreId（跳过 hash 读分），否则按创意 + campaignConfig 读分。
 */
export async function resolveLaunchScoreForPerformanceApi(
  offer: Offer,
  userId: number,
  options: {
    launchScoreId?: number | null
    creativeId?: number | null
    hashCampaignConfig?: LaunchScoreHashCampaignConfig
  }
): Promise<LaunchScorePerformanceLookupResult> {
  const { launchScoreId, creativeId, hashCampaignConfig } = options

  if (launchScoreId != null) {
    const byId = await findLaunchScoreById(launchScoreId, userId)
    if (!byId || byId.offerId !== offer.id) {
      return { launchScore: null, stale: false }
    }
    return {
      launchScore: byId,
      stale: false,
      resolvedCreativeId: byId.adCreativeId ?? undefined,
    }
  }

  if (creativeId != null) {
    const creative = await findAdCreativeById(creativeId, userId)
    if (!creative || creative.offer_id !== offer.id) {
      return { launchScore: null, stale: false }
    }
    const read = await readLaunchScoreForCreative(
      creative,
      offer,
      userId,
      hashCampaignConfig
    )
    return {
      launchScore: read.score,
      stale: !read.score && read.staleScore != null,
      resolvedCreativeId: creative.id,
    }
  }

  const creatives = await findAdCreativesByOfferId(offer.id, userId)
  const bestCreative = await pickBestCreativeForLaunchScoreRead(
    creatives,
    offer,
    userId,
    hashCampaignConfig
  )
  if (!bestCreative) {
    return { launchScore: null, stale: false }
  }

  const read = await readLaunchScoreForCreative(
    bestCreative,
    offer,
    userId,
    hashCampaignConfig
  )
  return {
    launchScore: read.score,
    stale: !read.score && read.staleScore != null,
    resolvedCreativeId: bestCreative.id,
  }
}

export type LaunchScoreGetForCreativeResponse = {
  launchScore: LaunchScore | null
  stale?: boolean
  staleLaunchScoreId?: number
  autoCalculated?: boolean
  usedCreativeId?: number
  fromCache?: boolean
  message?: string
  canAutoCalculate?: boolean
  hint?: string
}

/** GET 单创意读分：hash 命中 / autoCalculate / stale / 空 */
export async function resolveLaunchScoreGetForCreative(
  userId: number,
  offer: Offer,
  creative: AdCreative,
  hashCampaignConfig: LaunchScoreHashCampaignConfig | undefined,
  autoCalculate: boolean
): Promise<LaunchScoreGetForCreativeResponse> {
  const read = await readLaunchScoreForCreative(creative, offer, userId, hashCampaignConfig)
  if (read.score) {
    return { launchScore: read.score, usedCreativeId: creative.id }
  }

  if (autoCalculate) {
    if (offer.scrape_status !== 'completed') {
      return {
        launchScore: null,
        message: '请先完成产品信息抓取后再计算Launch Score',
        canAutoCalculate: false,
        usedCreativeId: creative.id,
      }
    }

    const { launchScore, fromCache } = await ensureLaunchScoreForCreative(
      userId,
      offer,
      creative,
      hashCampaignConfig
    )
    return {
      launchScore,
      autoCalculated: true,
      usedCreativeId: creative.id,
      ...(fromCache ? { fromCache: true } : {}),
    }
  }

  const creatives = await findAdCreativesByOfferId(offer.id, userId)
  const canAutoCalculate =
    offer.scrape_status === 'completed' && creatives.length > 0

  if (read.staleScore) {
    return {
      launchScore: null,
      stale: true,
      staleLaunchScoreId: read.staleScore.id,
      usedCreativeId: creative.id,
      message: '创意内容或投放配置已变更，当前 Launch Score 已过期，请重新计算',
      canAutoCalculate,
      hint: canAutoCalculate ? '可使用 ?autoCalculate=true 参数自动计算' : undefined,
    }
  }

  return {
    launchScore: null,
    usedCreativeId: creative.id,
    message: '暂无 Launch Score，请先计算',
    canAutoCalculate,
    hint: canAutoCalculate ? '可使用 ?autoCalculate=true 参数自动计算' : undefined,
  }
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
