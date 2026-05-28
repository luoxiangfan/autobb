/**
 * 广告创意重新生成器
 *
 * 功能：
 * 1. 继承原创意/任务配置的 generation_mode，经共享桶级管线生成
 * 2. 保存新生成的广告创意
 * 3. 返回新的广告创意 ID 和 campaign_config
 */

import { createAdCreative, findAdCreativeById } from './ad-creative'
import {
  getAdCreativeGenerationModeProfile,
  normalizeAdCreativeGenerationMode,
} from './ad-creative-generation-mode'
import { getThemeByBucket } from './ad-creative-generator'
import {
  assertPostGenerationPersistenceGate,
  formatBucketGenerationRejectedError,
  resolveOfferLinkType,
  runBucketCreativeGeneration,
} from './bucket-creative-generation-pipeline'
import { findOfferById } from './offers'
import { resolveKeywordPoolForCreativeGeneration } from './offer-keyword-pool'
import { deriveSkipKeywordPoolExpandLoad } from './parse-offer-id'
import {
  getCreativeTypeForBucketSlot,
  normalizeCreativeBucketSlot,
  type CreativeBucketSlot,
} from './creative-type'

/**
 * 重新生成广告创意结果
 */
export interface RegenerateAdCreativeResult {
  success: boolean
  adCreativeId?: number
  campaignConfig?: any
  generationMode?: string
  error?: string
}

/**
 * 重新生成广告创意参数
 */
export interface RegenerateAdCreativeParams {
  userId: number
  offerId: number
  previousAdCreativeId: number
  campaignConfigForTask: Record<string, any>  // 来自任务的 campaignConfig，包含原始的创意元素等信息
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return fallback
}

function resolveRegenerationBucketContext(
  previousCreative: Awaited<ReturnType<typeof findAdCreativeById>>,
  campaignConfig: Record<string, any>
): { slotBucket: CreativeBucketSlot | null; generationBucket: string | null } {
  const raw =
    previousCreative?.keyword_bucket
    ?? campaignConfig?.keyword_bucket
    ?? campaignConfig?.keywordBucket
    ?? campaignConfig?.bucket
  if (typeof raw !== 'string') {
    return { slotBucket: null, generationBucket: null }
  }

  const slotBucket = normalizeCreativeBucketSlot(raw)
  if (!slotBucket) {
    return { slotBucket: null, generationBucket: null }
  }

  const upper = raw.trim().toUpperCase()
  const generationBucket =
    (upper === 'C' && slotBucket === 'B') || (upper === 'S' && slotBucket === 'D')
      ? upper
      : slotBucket

  return { slotBucket, generationBucket }
}

/**
 * 重新生成广告创意
 */
export async function regenerateAdCreative(
  params: RegenerateAdCreativeParams
): Promise<RegenerateAdCreativeResult> {
  const { userId, offerId, previousAdCreativeId, campaignConfigForTask } = params

  try {
    const previousCreative = previousAdCreativeId > 0
      ? await findAdCreativeById(previousAdCreativeId, userId)
      : null
    const inheritedMode = normalizeAdCreativeGenerationMode(
      previousCreative?.generation_mode
        ?? campaignConfigForTask?.generation_mode
        ?? campaignConfigForTask?.generationMode
    )
    const generationProfile = getAdCreativeGenerationModeProfile(inheritedMode)
    const { slotBucket: bucket, generationBucket } = resolveRegenerationBucketContext(
      previousCreative,
      campaignConfigForTask
    )
    const hardPersistenceGateEnabled = parseBooleanEnv(
      process.env.AD_CREATIVE_HARD_PERSISTENCE_GATE_ENABLED,
      true
    )

    const offer = await findOfferById(offerId, userId)
    if (!offer) {
      return {
        success: false,
        error: 'Offer 不存在或无权访问',
      }
    }

    const linkType = resolveOfferLinkType(offer)
    const bucketTheme = bucket ? getThemeByBucket(bucket, linkType) : null
    const bucketIntent = bucketTheme?.split(' - ')[0]
      || previousCreative?.bucket_intent
      || undefined
    const bucketIntentEn = bucketTheme?.split(' - ')[1] || undefined

    let keywordPool: Awaited<
      ReturnType<typeof resolveKeywordPoolForCreativeGeneration>
    >['pool'] | null = null
    let plannerSession: Awaited<
      ReturnType<typeof resolveKeywordPoolForCreativeGeneration>
    >['plannerSession']
    let preparedExpand: Awaited<
      ReturnType<typeof resolveKeywordPoolForCreativeGeneration>
    >['preparedExpand']
    if (bucket) {
      const resolved = await resolveKeywordPoolForCreativeGeneration(offerId, userId)
      keywordPool = resolved.pool
      plannerSession = resolved.plannerSession
      preparedExpand = resolved.preparedExpand
    }

    console.log(
      `[Ad Creative Regenerator] Generating for offer ${offerId} (mode=${inheritedMode}, bucket=${bucket || 'none'}, generationBucket=${generationBucket || 'none'}, maxRetries=${generationProfile.maxRetries})`
    )

    const generationResult = await runBucketCreativeGeneration({
      offerId,
      userId,
      offer,
      bucket,
      generationBucket,
      generationProfile,
      maxRetries: generationProfile.maxRetries,
      scopeLabel: bucket ? `regenerate-ad-creative-${bucket}` : 'regenerate-ad-creative',
      linkType,
      keywordPool,
      plannerSession,
      preparedExpand,
      skipKeywordPoolExpandLoad: deriveSkipKeywordPoolExpandLoad(preparedExpand, plannerSession),
      loadSearchTermFeedbackHints: true,
      skipCache: true,
      hardPersistenceGateEnabled,
      bucketIntent,
      bucketIntentEn,
    })

    const generatedCreative = generationResult.selectedCreative
    if (!generatedCreative) {
      console.error('[Ad Creative Regenerator] Generation failed after quality loop')
      return {
        success: false,
        error: '广告创意生成失败',
      }
    }

    if (!generationResult.accepted) {
      const evaluation = generationResult.selectedEvaluation
      console.warn(
        `[Ad Creative Regenerator] Quality gate not passed (mode=${inheritedMode}, score=${evaluation?.adStrength?.finalScore}, rating=${evaluation?.adStrength?.finalRating})`
      )
      return {
        success: false,
        error: formatBucketGenerationRejectedError(generationResult),
      }
    }

    assertPostGenerationPersistenceGate({
      enabled: hardPersistenceGateEnabled,
      creative: generatedCreative,
      bucket,
      offer,
      attempts: generationResult.attempts,
    })

    console.log('[Ad Creative Regenerator] Saving new creative to database...')

    const newCreative = await createAdCreative(
      userId,
      offerId,
      {
        ...generatedCreative,
        final_url: offer.url || offer.final_url || '',
        final_url_suffix: offer.final_url_suffix || '',
        generation_mode: inheritedMode,
        keyword_bucket: bucket ?? generatedCreative.keyword_bucket ?? undefined,
        bucket_intent: bucketIntent ?? generatedCreative.bucket_intent ?? undefined,
        creative_type: bucket ? getCreativeTypeForBucketSlot(bucket) : undefined,
      }
    )

    if (!newCreative?.id) {
      console.error('[Ad Creative Regenerator] Save failed')
      return {
        success: false,
        error: '广告创意保存失败',
      }
    }

    console.log(`[Ad Creative Regenerator] New creative saved with ID: ${newCreative.id}`)

    const campaignConfig = {
      ...campaignConfigForTask,
      generation_mode: inheritedMode,
      headlines: generatedCreative.headlines || [],
      descriptions: generatedCreative.descriptions || [],
      keywords: generatedCreative.keywords || [],
      callouts: generatedCreative.callouts || [],
      sitelinks: generatedCreative.sitelinks || [],
    }

    return {
      success: true,
      adCreativeId: newCreative.id,
      campaignConfig,
      generationMode: inheritedMode,
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '广告创意重新生成失败'
    console.error('[Ad Creative Regenerator] Error:', error)
    return {
      success: false,
      error: message,
    }
  }
}
