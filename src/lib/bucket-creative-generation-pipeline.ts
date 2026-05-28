/**
 * 桶级广告创意生成共享管线（质量环 + 关键词后处理 + 评估门禁）
 *
 * 供队列执行器、同步 API、备份 Regenerator 复用，避免逻辑漂移。
 */

import { generateAdCreative } from '@/lib/ad-creative-gen'
import type { AdCreativeGenerationModeProfile } from '@/lib/ad-creative-generation-mode'
import {
  applyCreativeKeywordSetToCreative,
  buildPreGenerationCreativeKeywordSet,
  buildCreativeBrandKeywords,
  createCreativeQualityEvaluationInput,
  evaluateCreativePersistenceHardGate,
  finalizeCreativeKeywordSet,
  mergeUsedKeywordsExcludingBrand,
  resolveCreativeKeywordsForRetryExclusion,
} from '@/lib/creative-keyword-runtime'
import {
  AD_CREATIVE_REQUIRED_MIN_SCORE,
  evaluateCreativeForQuality,
  runCreativeGenerationQualityLoop,
  type CreativeAttemptEvaluation,
  type CreativeGenerationLoopResult,
} from '@/lib/ad-creative-quality-loop'
import {
  getCreativeTypeForBucketSlot,
  type CanonicalCreativeType,
  type CreativeBucketSlot,
} from '@/lib/creative-type'
import { getThemeByBucket } from '@/lib/ad-creative-generator'
import { getKeywordsByLinkTypeAndBucket } from '@/lib/offer-keyword-pool'
import type {
  KeywordPlannerPreparedSession,
  KeywordPoolPreparedExpand,
} from '@/lib/google-ads-accounts-auth'
import type { OfferKeywordPool, PoolKeywordData } from '@/lib/offer-keyword-pool'
import type { Offer } from '@/lib/offers'
import { getSearchTermFeedbackHints, type SearchTermFeedbackHints } from '@/lib/search-term-feedback-hints'
import type { SearchTermFeedbackHintsInput } from '@/lib/ad-creative-generator'
import { parseBooleanEnv } from '@/lib/parse-env'
import type { RetryFailureType } from '@/lib/rsa-quality-gate'

export type GeneratedAdCreative = Awaited<ReturnType<typeof generateAdCreative>>

export type CreativePersistenceGateError = Error & {
  code?: string
  category?: string
  userMessage?: string
  retryable?: boolean
  details?: Record<string, unknown>
}

export interface CreativePersistenceGateErrorEnvelope {
  category?: string
  userMessage?: string
  retryable?: boolean
}

export type KeywordPostProcessMode = 'finalize' | 'applyPrecomputed'

export function createCreativePersistenceGateError(params: {
  attempts: number
  details: ReturnType<typeof evaluateCreativePersistenceHardGate>
  batchIndex?: number
  bucket?: string | null
  envelope?: CreativePersistenceGateErrorEnvelope
}): CreativePersistenceGateError {
  const error = new Error(
    `创意落库门禁未通过: ${params.details.violations.map((item) => item.code).join(', ')}`
  ) as CreativePersistenceGateError
  error.code = 'CREATIVE_PERSISTENCE_GATE_FAILED'
  error.details = {
    attempts: params.attempts,
    ...params.details,
    ...(params.batchIndex !== undefined ? { batchIndex: params.batchIndex } : {}),
    ...(params.bucket !== undefined ? { bucket: params.bucket } : {}),
  }
  if (params.envelope?.category) error.category = params.envelope.category
  if (params.envelope?.userMessage) error.userMessage = params.envelope.userMessage
  if (params.envelope?.retryable !== undefined) error.retryable = params.envelope.retryable
  return error
}

/** 落库前 persistence 硬门禁（质量环内已检查时，路由侧无需再调用） */
export function assertPostGenerationPersistenceGate(params: {
  enabled: boolean
  creative: GeneratedAdCreative
  bucket: string | null | undefined
  offer: Offer
  attempts: number
  batchIndex?: number
  envelope?: CreativePersistenceGateErrorEnvelope
}): void {
  if (!params.enabled) return

  const persistenceGateResult = evaluateCreativePersistenceHardGate({
    creative: params.creative,
    bucket: params.bucket ?? null,
    targetLanguage: params.offer.target_language,
    brandName: params.offer.brand,
  })
  if (!persistenceGateResult.passed) {
    throw createCreativePersistenceGateError({
      attempts: params.attempts,
      details: persistenceGateResult,
      batchIndex: params.batchIndex,
      bucket: params.bucket ?? null,
      envelope: params.envelope,
    })
  }
}

/** 将 C/S 等兼容槽位映射为管线使用的 A/B/D */
export function normalizePipelineBucket(
  bucket: string | null | undefined
): CreativeBucketSlot | null {
  const normalized = String(bucket || '').trim().toUpperCase()
  if (normalized === 'C') return 'B'
  if (normalized === 'S') return 'D'
  if (normalized === 'A' || normalized === 'B' || normalized === 'D') {
    return normalized
  }
  return null
}

export interface BucketKeywordContext {
  bucket: CreativeBucketSlot
  creativeType: CanonicalCreativeType
  bucketIntent: string
  bucketIntentEn: string
  bucketKeywords: string[]
  seedCandidates: Array<Record<string, unknown>>
  precomputedKeywordSet: Awaited<ReturnType<typeof buildPreGenerationCreativeKeywordSet>>
}

export interface BucketCreativeGenerationHooks {
  onBeforeGenerate?: (ctx: { attempt: number }) => Promise<void>
  onAfterGenerate?: (ctx: { attempt: number; creative: GeneratedAdCreative }) => Promise<void>
  onBeforeEvaluate?: (ctx: { attempt: number }) => Promise<void>
  onAfterEvaluate?: (ctx: {
    attempt: number
    evaluation: CreativeAttemptEvaluation
  }) => Promise<void>
}

export interface RunBucketCreativeGenerationParams {
  offerId: number
  userId: number
  offer: Offer
  bucket: CreativeBucketSlot | null
  generationProfile: AdCreativeGenerationModeProfile
  maxRetries: number
  scopeLabel: string
  linkType?: 'product' | 'store'
  keywordPool?: OfferKeywordPool | null
  /** 与 keywordPool 同次 resolveKeywordPoolForCreativeGeneration prepare，避免 generateAdCreative 重复 load */
  plannerSession?: KeywordPlannerPreparedSession
  preparedExpand?: KeywordPoolPreparedExpand
  searchTermFeedbackHints?: SearchTermFeedbackHintsInput
  loadSearchTermFeedbackHints?: boolean
  referencePerformance?: unknown
  theme?: string
  skipCache?: boolean
  /** 为 true 时仅第 2 轮起 skipCache（同步 API 行为） */
  skipCacheOnRetryOnly?: boolean
  hardPersistenceGateEnabled?: boolean
  requireNonEmptyKeywords?: boolean
  keywordPostProcessMode?: KeywordPostProcessMode
  bucketInfo?: {
    keywords: PoolKeywordData[] | string[]
    intent: string
    intentEn: string
  }
  bucketIntent?: string
  bucketIntentEn?: string
  /** 调用方已构建的关键词上下文（避免重复 buildPreGeneration） */
  preparedBucketContext?: BucketKeywordContext | null
  /** 传给 generateAdCreative 的桶标识（可与 pipeline bucket 不同，如 C/S） */
  generationBucket?: string | null
  /** finalize 时是否写入 keywordSupplementation（批量首稿为 false） */
  finalizeIncludeKeywordSupplementation?: boolean
  /** 指定轮次复用已生成创意，跳过 AI 调用（批量首稿） */
  getSeedCreativeForAttempt?: (attempt: number) => GeneratedAdCreative | undefined
  hooks?: BucketCreativeGenerationHooks
}

function normalizeKeywordMapKey(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function resolveOfferLinkType(offer: Offer): 'product' | 'store' {
  const record = offer as unknown as Record<string, unknown>
  const pageType = String(record.page_type || '').trim().toLowerCase()
  if (pageType === 'store' || pageType === 'product') {
    return pageType
  }
  const linkType = String(record.link_type || '').trim().toLowerCase()
  if (linkType === 'store') return 'store'
  return 'product'
}

export function buildKeywordPoolVolumeHintMap(keywordPool: OfferKeywordPool | null | undefined): Map<string, {
  searchVolume: number
  volumeUnavailableReason?: string
}> {
  const hints = new Map<string, { searchVolume: number; volumeUnavailableReason?: string }>()
  if (!keywordPool) return hints

  const groups: Array<unknown[] | undefined> = [
    keywordPool.brandKeywords,
    keywordPool.bucketAKeywords,
    keywordPool.bucketBKeywords,
    keywordPool.bucketCKeywords,
    keywordPool.bucketDKeywords,
    keywordPool.storeBucketAKeywords,
    keywordPool.storeBucketBKeywords,
    keywordPool.storeBucketCKeywords,
    keywordPool.storeBucketDKeywords,
    keywordPool.storeBucketSKeywords,
  ]

  for (const group of groups) {
    if (!Array.isArray(group) || group.length === 0) continue
    for (const item of group) {
      const key = normalizeKeywordMapKey((item as { keyword?: string })?.keyword)
      if (!key) continue

      const searchVolume = Number((item as { searchVolume?: number })?.searchVolume || 0)
      const volumeUnavailableReasonRaw = String((item as { volumeUnavailableReason?: string })?.volumeUnavailableReason || '').trim()
      const volumeUnavailableReason = volumeUnavailableReasonRaw || undefined

      const existing = hints.get(key)
      if (!existing) {
        hints.set(key, { searchVolume, volumeUnavailableReason })
        continue
      }

      if (searchVolume > existing.searchVolume) {
        hints.set(key, {
          searchVolume,
          volumeUnavailableReason: volumeUnavailableReason || existing.volumeUnavailableReason,
        })
        continue
      }

      if (!existing.volumeUnavailableReason && volumeUnavailableReason) {
        hints.set(key, {
          searchVolume: existing.searchVolume,
          volumeUnavailableReason,
        })
      }
    }
  }

  return hints
}

export function backfillCreativeKeywordVolumesFromPoolHints(
  creative: GeneratedAdCreative,
  hints: Map<string, { searchVolume: number; volumeUnavailableReason?: string }>,
  scopeLabel: string
): void {
  if (!Array.isArray(creative.keywordsWithVolume) || creative.keywordsWithVolume.length === 0) return
  if (!hints || hints.size === 0) return

  let patched = 0
  creative.keywordsWithVolume = creative.keywordsWithVolume.map((item): typeof item => {
    if (!item || typeof item !== 'object') return item

    const key = normalizeKeywordMapKey((item as { keyword?: string }).keyword)
    if (!key) return item

    const hint = hints.get(key)
    if (!hint || hint.searchVolume <= 0) return item

    const currentSearchVolume = Number((item as { searchVolume?: number }).searchVolume || 0)
    if (currentSearchVolume > 0) return item

    patched += 1
    return {
      ...item,
      searchVolume: hint.searchVolume,
      volumeUnavailableReason: (
        (item as { volumeUnavailableReason?: string }).volumeUnavailableReason
        || hint.volumeUnavailableReason
      ) as typeof item.volumeUnavailableReason,
    }
  })

  if (patched > 0) {
    console.log(`ℹ️ [${scopeLabel}] 已从关键词池回填 ${patched} 个关键词搜索量`)
  }
}

export async function loadSearchTermFeedbackHintsForGeneration(
  offerId: number,
  userId: number
): Promise<SearchTermFeedbackHintsInput | undefined> {
  try {
    const hints: SearchTermFeedbackHints = await getSearchTermFeedbackHints({ offerId, userId })
    console.log(
      `🔁 搜索词反馈已加载: high=${hints.highPerformingTerms.length}, hard=${hints.hardNegativeTerms.length}, soft=${hints.softSuppressTerms.length}, rows=${hints.sourceRows}`
    )
    return {
      hardNegativeTerms: hints.hardNegativeTerms,
      softSuppressTerms: hints.softSuppressTerms,
      highPerformingTerms: hints.highPerformingTerms,
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`⚠️ 搜索词反馈读取失败，继续默认生成: ${message}`)
    return undefined
  }
}

export async function loadBucketSeedCandidates(
  offerId: number,
  linkType: 'product' | 'store',
  bucket: CreativeBucketSlot,
  scopeLabel: string
): Promise<Array<Record<string, unknown>>> {
  try {
    const bucketResult = await getKeywordsByLinkTypeAndBucket(offerId, linkType, bucket)
    return Array.isArray(bucketResult.keywords)
      ? (bucketResult.keywords as unknown as Array<Record<string, unknown>>)
      : []
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`⚠️ [${scopeLabel}] 桶${bucket}关键词同步失败: ${message}`)
    return []
  }
}

export async function prepareBucketKeywordContext(params: {
  offer: Offer
  userId: number
  offerId: number
  bucket: CreativeBucketSlot
  generationProfile: AdCreativeGenerationModeProfile
  scopeLabel: string
  linkType?: 'product' | 'store'
  seedCandidates?: Array<Record<string, unknown>>
  bucketInfo?: {
    keywords: PoolKeywordData[] | string[]
    intent: string
    intentEn: string
  }
}): Promise<BucketKeywordContext> {
  const linkType = params.linkType || resolveOfferLinkType(params.offer)
  const creativeType = getCreativeTypeForBucketSlot(params.bucket)
  const seedCandidates = params.seedCandidates
    ?? await loadBucketSeedCandidates(params.offerId, linkType, params.bucket, params.scopeLabel)

  const precomputedKeywordSet = await buildPreGenerationCreativeKeywordSet({
    offer: params.offer,
    userId: params.userId,
    creativeType,
    bucket: params.bucket,
    scopeLabel: params.scopeLabel,
    seedCandidates,
    enableSupplementation: params.generationProfile.enableSupplementation,
    skipSupplementAiRanking: params.generationProfile.skipSupplementAiRanking,
    continueOnSupplementError: true,
  })

  const bucketTheme = getThemeByBucket(params.bucket, linkType)
  const bucketIntent = params.bucketInfo?.intent || bucketTheme.split(' - ')[0] || bucketTheme
  const bucketIntentEn = params.bucketInfo?.intentEn || bucketTheme.split(' - ')[1] || bucketIntent
  const bucketKeywords = params.bucketInfo?.keywords
    ? params.bucketInfo.keywords.map((kw) => (typeof kw === 'string' ? kw : kw.keyword))
    : []

  return {
    bucket: params.bucket,
    creativeType,
    bucketIntent,
    bucketIntentEn,
    bucketKeywords,
    seedCandidates,
    precomputedKeywordSet,
  }
}

export function warnKeywordContextFallback(
  precomputedKeywordSet: Awaited<ReturnType<typeof buildPreGenerationCreativeKeywordSet>>,
  creative: GeneratedAdCreative
): void {
  if (
    Array.isArray(creative.keywordsWithVolume)
    && creative.keywordsWithVolume.length > 0
    && precomputedKeywordSet.contextFallbackStrategy !== 'filtered'
  ) {
    console.warn(
      precomputedKeywordSet.contextFallbackStrategy === 'keyword_pool'
        ? '⚠️ 创意关键词上下文过滤后为空，回退关键词池候选'
        : '⚠️ 创意关键词上下文过滤后为空，回退原候选关键词'
    )
  }
}

export function assertExecutableKeywordsNonEmpty(
  creative: GeneratedAdCreative,
  bucket: CreativeBucketSlot | null
): void {
  const executableKeywordCount = Array.isArray(creative.keywords) ? creative.keywords.length : 0
  if (executableKeywordCount === 0) {
    throw new Error(
      `关键词筛选后为空（bucket=${bucket || 'unknown'}），中止本轮并触发重试`
    )
  }
}

export async function postProcessGeneratedCreativeKeywords(params: {
  offer: Offer
  userId: number
  creative: GeneratedAdCreative
  bucket: CreativeBucketSlot | null
  bucketContext: BucketKeywordContext | null
  scopeLabel: string
  keywordPostProcessMode?: KeywordPostProcessMode
  keywordPoolVolumeHints?: Map<string, { searchVolume: number; volumeUnavailableReason?: string }>
  requireNonEmptyKeywords?: boolean
  finalizeIncludeKeywordSupplementation?: boolean
}): Promise<void> {
  const {
    offer,
    userId,
    creative,
    bucket,
    bucketContext,
    scopeLabel,
    keywordPostProcessMode = 'finalize',
    keywordPoolVolumeHints,
    requireNonEmptyKeywords = Boolean(bucket),
  } = params

  if (!bucket || !bucketContext) {
    if (requireNonEmptyKeywords) {
      assertExecutableKeywordsNonEmpty(creative, bucket)
    }
    return
  }

  warnKeywordContextFallback(bucketContext.precomputedKeywordSet, creative)

  if (keywordPostProcessMode === 'applyPrecomputed') {
    applyCreativeKeywordSetToCreative(creative, {
      executableKeywords: bucketContext.precomputedKeywordSet.executableKeywords,
      keywordsWithVolume: bucketContext.precomputedKeywordSet.keywordsWithVolume,
      promptKeywords: bucketContext.precomputedKeywordSet.promptKeywords,
      keywordSupplementation: bucketContext.precomputedKeywordSet.keywordSupplementation,
      audit: bucketContext.precomputedKeywordSet.audit,
    })
  } else {
    await finalizeCreativeKeywordSet({
      offer,
      userId,
      creative,
      creativeType: bucketContext.creativeType,
      bucket: bucketContext.bucket,
      scopeLabel: `${scopeLabel}-final`,
      seedCandidates: bucketContext.seedCandidates,
      ...(params.finalizeIncludeKeywordSupplementation !== undefined
        ? { includeKeywordSupplementation: params.finalizeIncludeKeywordSupplementation }
        : {}),
    })
  }

  if (keywordPoolVolumeHints) {
    backfillCreativeKeywordVolumesFromPoolHints(
      creative,
      keywordPoolVolumeHints,
      `${scopeLabel}-final`
    )
  }

  if (requireNonEmptyKeywords) {
    assertExecutableKeywordsNonEmpty(creative, bucket)
  }
}

export async function evaluateCreativeWithPersistenceGate(params: {
  creative: GeneratedAdCreative
  offer: Offer
  userId: number
  bucket: CreativeBucketSlot | null
  creativeType?: CanonicalCreativeType | null
  generationProfile: AdCreativeGenerationModeProfile
  hardPersistenceGateEnabled?: boolean
  plannerSession?: KeywordPlannerPreparedSession
}): Promise<CreativeAttemptEvaluation> {
  const offerRecord = params.offer as unknown as Record<string, unknown>
  const hardPersistenceGateEnabled = params.hardPersistenceGateEnabled ?? parseBooleanEnv(
    process.env.AD_CREATIVE_HARD_PERSISTENCE_GATE_ENABLED,
    true
  )

  const qualityEvaluation = await evaluateCreativeForQuality(
    createCreativeQualityEvaluationInput({
      creative: params.creative,
      minimumScore: AD_CREATIVE_REQUIRED_MIN_SCORE,
      offer: params.offer,
      userId: params.userId,
      bucket: params.bucket,
      creativeType: params.creativeType ?? null,
      keywords: params.creative.keywords || [],
      productNameFallback: (offerRecord.product_title || offerRecord.name) as string | undefined,
      productTitleFallback: offerRecord.title as string | undefined,
      skipCompetitivePositioningAi: params.generationProfile.skipCompetitivePositioningAi,
      plannerSession: params.plannerSession,
    })
  )

  if (!hardPersistenceGateEnabled) {
    return qualityEvaluation
  }

  const persistenceGate = evaluateCreativePersistenceHardGate({
    creative: params.creative,
    bucket: params.bucket,
    targetLanguage: params.offer.target_language,
    brandName: params.offer.brand,
  })
  if (persistenceGate.passed) {
    return qualityEvaluation
  }

  const persistenceReasons = persistenceGate.violations.map(
    (item) => `persistence:${item.code}`
  )
  return {
    ...qualityEvaluation,
    passed: false,
    failureType: qualityEvaluation.failureType || 'format_fail',
    reasons: [...qualityEvaluation.reasons, ...persistenceReasons],
  }
}

export function createBucketCreativeGenerationCallbacks(
  params: RunBucketCreativeGenerationParams & {
    bucketContext: BucketKeywordContext | null
    searchTermFeedbackHints?: SearchTermFeedbackHintsInput
    usedKeywordsRef: { current: string[] }
    brandKeywords: string[]
    keywordPoolVolumeHints?: Map<string, { searchVolume: number; volumeUnavailableReason?: string }>
  }
) {
  const {
    offerId,
    userId,
    offer,
    bucket,
    generationProfile,
    bucketContext,
    searchTermFeedbackHints,
    usedKeywordsRef,
    brandKeywords,
    keywordPoolVolumeHints,
    referencePerformance,
    theme,
    skipCache = true,
    skipCacheOnRetryOnly = false,
    keywordPostProcessMode,
    requireNonEmptyKeywords = Boolean(bucket),
    hooks,
    getSeedCreativeForAttempt,
    finalizeIncludeKeywordSupplementation,
    generationBucket,
  } = params

  const apiBucket = generationBucket ?? bucket

  const generate = async ({
    attempt,
    retryFailureType,
  }: {
    attempt: number
    retryFailureType?: RetryFailureType
  }): Promise<GeneratedAdCreative> => {
    await hooks?.onBeforeGenerate?.({ attempt })

    const seeded = getSeedCreativeForAttempt?.(attempt)
    const creative = seeded ?? await generateAdCreative(offerId, userId, {
      theme: theme ?? (bucketContext
        ? `${bucketContext.bucketIntent} - ${bucketContext.bucketIntentEn}`
        : undefined),
      referencePerformance,
      skipCache: skipCacheOnRetryOnly ? attempt > 1 : skipCache,
      excludeKeywords: attempt > 1 ? usedKeywordsRef.current : undefined,
      retryFailureType,
      searchTermFeedbackHints,
      keywordPool: params.keywordPool || undefined,
      bucket: (apiBucket as 'A' | 'B' | 'C' | 'D' | 'S' | undefined) || undefined,
      bucketKeywords: bucketContext?.bucketKeywords,
      bucketIntent: bucketContext?.bucketIntent,
      bucketIntentEn: bucketContext?.bucketIntentEn,
      deferKeywordPostProcessingToBuilder: Boolean(bucket),
      precomputedKeywordSet: bucketContext?.precomputedKeywordSet,
      plannerSession: params.plannerSession,
      preparedExpand: params.preparedExpand,
    })

    await postProcessGeneratedCreativeKeywords({
      offer,
      userId,
      creative,
      bucket,
      bucketContext,
      scopeLabel: params.scopeLabel,
      keywordPostProcessMode,
      keywordPoolVolumeHints,
      requireNonEmptyKeywords,
      finalizeIncludeKeywordSupplementation,
    })

    usedKeywordsRef.current = mergeUsedKeywordsExcludingBrand({
      usedKeywords: usedKeywordsRef.current,
      candidateKeywords: resolveCreativeKeywordsForRetryExclusion(creative),
      brandKeywords,
    })

    await hooks?.onAfterGenerate?.({ attempt, creative })
    return creative
  }

  const evaluate = async (
    creative: GeneratedAdCreative,
    ctx: { attempt: number }
  ): Promise<CreativeAttemptEvaluation> => {
    await hooks?.onBeforeEvaluate?.({ attempt: ctx.attempt })
    const evaluation = await evaluateCreativeWithPersistenceGate({
      creative,
      offer,
      userId,
      bucket,
      creativeType: bucketContext?.creativeType ?? null,
      generationProfile,
      hardPersistenceGateEnabled: params.hardPersistenceGateEnabled,
      plannerSession: params.plannerSession,
    })
    await hooks?.onAfterEvaluate?.({ attempt: ctx.attempt, evaluation })
    return evaluation
  }

  return { generate, evaluate }
}

export async function runBucketCreativeGeneration(
  params: RunBucketCreativeGenerationParams
): Promise<CreativeGenerationLoopResult<GeneratedAdCreative>> {
  const linkType = params.linkType || resolveOfferLinkType(params.offer)
  const searchTermFeedbackHints = params.searchTermFeedbackHints
    ?? (params.loadSearchTermFeedbackHints !== false
      ? await loadSearchTermFeedbackHintsForGeneration(params.offerId, params.userId)
      : undefined)

  const bucketContext = params.preparedBucketContext
    ?? (params.bucket
      ? await prepareBucketKeywordContext({
        offer: params.offer,
        userId: params.userId,
        offerId: params.offerId,
        bucket: params.bucket,
        generationProfile: params.generationProfile,
        scopeLabel: params.scopeLabel,
        linkType,
        bucketInfo: params.bucketInfo,
      })
      : null)

  const keywordPoolVolumeHints = params.keywordPool
    ? buildKeywordPoolVolumeHintMap(params.keywordPool)
    : undefined

  const usedKeywordsRef = { current: [] as string[] }
  const brandKeywords = buildCreativeBrandKeywords(params.offer.brand)
  const { generate, evaluate } = createBucketCreativeGenerationCallbacks({
    ...params,
    bucketContext,
    searchTermFeedbackHints,
    usedKeywordsRef,
    brandKeywords,
    keywordPoolVolumeHints,
  })

  return runCreativeGenerationQualityLoop({
    maxRetries: params.maxRetries,
    delayMs: params.generationProfile.delayMs,
    generate,
    evaluate,
  })
}

export function formatBucketGenerationRejectedError(
  generationResult: CreativeGenerationLoopResult<GeneratedAdCreative>
): string {
  const evaluation = generationResult.selectedEvaluation
  const score = evaluation?.adStrength?.finalScore
  const rating = evaluation?.adStrength?.finalRating
  const reasons = Array.isArray(evaluation?.reasons) ? evaluation.reasons.join('; ') : ''
  return reasons
    ? `广告创意质量未达标（${rating || 'UNKNOWN'} ${score ?? '-'}）：${reasons}`
    : `广告创意质量未达标（${rating || 'UNKNOWN'} ${score ?? '-'}），请稍后重试或使用标准模式`
}
