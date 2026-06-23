/**
 * 创意关键词集合构建：主流程
 */
import {
  toFallbackKeywords,
  normalizeCandidateKey,
  envEnabled,
  parseBoundedFloatEnv,
  emitCreativeKeywordRiskAlerts,
  resolveBucketMinimumKeywordTarget,
  isRelaxedFilteringPriorityCandidate,
  compareRelaxedFilteringCandidates,
  compareContextRecoveryCandidates,
  filterLanguageCompatibleCandidates,
  normalizeSeedCandidates,
  mergeSeedCandidates,
  prefixStandaloneModelTokensWithBrand,
  buildGlobalKeywordVolumeHintMap,
  applyGlobalKeywordVolumeBackfill,
  extractPoolCandidatesFromSeedCandidates,
  buildPromptKeywordSubset,
  filterBlockedPromptKeywords,
  toCreativeKeywordCandidate,
  hasOfferContextFilteredTag,
  filterBlockedFallbackCandidates,
  resolveKeywordCandidatesAfterContextFilter,
  isKeywordPoolCandidate,
} from './creative-keyword-set-builder-candidates'
import {
  shouldBlockOriginalFallbackForModelIntent,
  buildKeywordSourceAudit,
} from './creative-keyword-set-builder-audit'
import {
  buildNonEmptyRescueCandidates,
  buildNonEmptyRescueSourceQuotaAudit,
  augmentSourceQuotaAuditWithRescue,
  isBuilderNonEmptyRescueCandidate,
} from './creative-keyword-set-builder-rescue'
import { CREATIVE_PROMPT_KEYWORD_LIMIT } from './creative-keyword-set-builder-types'
import type {
  BuildCreativeKeywordSetInput,
  BuildCreativeKeywordSetOutput,
  CreativeKeywordContextFilterStats,
  CreativeKeywordSourceAudit,
} from './creative-keyword-set-builder-types'

import { applyKeywordSupplementationOnce } from '../../creatives/generator/keyword-supplement'
import type { KeywordSupplementationReport } from '../../creatives/generator/types'
import {
  filterCreativeKeywordsByOfferContextDetailed,
  normalizeCreativeKeywordCandidatesForContextFilter,
} from './creative-keyword-context-filter'
import {
  CREATIVE_BRAND_KEYWORD_RESERVE,
  CREATIVE_KEYWORD_MAX_COUNT,
  selectCreativeKeywords,
} from './creative-keyword-selection'
import { resolveCreativeKeywordMinimumOutputCount } from './creative-keyword-output-floor'
import { logKeywordSourceAudit } from './creative-keyword-audit-log'
import type { PoolKeywordData } from '../offer-pool'

export {
  type BuildCreativeKeywordSetInput,
  type BuildCreativeKeywordSetOutput,
  type CreativeKeywordCandidate,
  type CreativeKeywordSourceAudit,
  type CreativeKeywordAudit,
} from './creative-keyword-set-builder-types'

export async function buildCreativeKeywordSet(
  input: BuildCreativeKeywordSetInput
): Promise<BuildCreativeKeywordSetOutput> {
  const fallbackSource =
    String(input.fallbackSource || 'AI_GENERATED')
      .trim()
      .toUpperCase() || 'AI_GENERATED'
  const primaryCandidates = normalizeCreativeKeywordCandidatesForContextFilter(
    Array.isArray(input.keywordsWithVolume) && input.keywordsWithVolume.length > 0
      ? input.keywordsWithVolume
      : toFallbackKeywords({
          keywords: Array.isArray(input.keywords) ? input.keywords : [],
          fallbackSource,
        }),
    fallbackSource
  )
  const rawSeedCandidates =
    Array.isArray(input.seedCandidates) && input.seedCandidates.length > 0
      ? input.seedCandidates
      : []
  const normalizedSeedCandidates = normalizeCreativeKeywordCandidatesForContextFilter(
    normalizeSeedCandidates(rawSeedCandidates),
    'KEYWORD_POOL'
  )
  const poolCandidates = extractPoolCandidatesFromSeedCandidates(
    normalizedSeedCandidates as PoolKeywordData[]
  )
  const originalCandidates = mergeSeedCandidates({
    primaryCandidates: primaryCandidates as PoolKeywordData[],
    seedCandidates: normalizedSeedCandidates as PoolKeywordData[],
  })
  const canReuseContextFilteredSeedCandidates =
    primaryCandidates.length === 0 &&
    originalCandidates.length > 0 &&
    originalCandidates.every((item) => hasOfferContextFilteredTag(item as PoolKeywordData))

  let candidatePoolSource = originalCandidates
  let keywordSupplementation: KeywordSupplementationReport | undefined
  const initialCandidateCount = originalCandidates.length
  const contextFilterStats: CreativeKeywordContextFilterStats = {
    removedByContextMismatch: 0,
    removedByForbidden: 0,
    removedByQuality: 0,
    removedByModelFamily: 0,
    removedByIntentTightening: 0,
  }
  const blockedFallbackKeywordKeys = new Set<string>()
  const accumulateContextFilterStats = (report: {
    contextMismatchRemovedCount: number
    forbiddenRemovedCount: number
    qualityRemovedCount: number
    modelFamilyRemovedCount: number
    intentTighteningRemovedCount: number
  }) => {
    contextFilterStats.removedByContextMismatch += Number(report.contextMismatchRemovedCount || 0)
    contextFilterStats.removedByForbidden += Number(report.forbiddenRemovedCount || 0)
    contextFilterStats.removedByQuality += Number(report.qualityRemovedCount || 0)
    contextFilterStats.removedByModelFamily += Number(report.modelFamilyRemovedCount || 0)
    contextFilterStats.removedByIntentTightening += Number(report.intentTighteningRemovedCount || 0)
  }
  const accumulateBlockedFallbackKeywordKeys = (report: { blockedKeywordKeys?: string[] }) => {
    for (const keywordKey of report.blockedKeywordKeys || []) {
      const normalized = normalizeCandidateKey(keywordKey)
      if (normalized) blockedFallbackKeywordKeys.add(normalized)
    }
  }
  const applyLanguageGate = (
    candidates: PoolKeywordData[],
    stageLabel: string
  ): PoolKeywordData[] => {
    const languageGateResult = filterLanguageCompatibleCandidates({
      candidates,
      targetLanguage: input.targetLanguage || input.offer.target_language,
      brandName: input.brandName || input.offer.brand,
    })
    for (const blockedKeywordKey of languageGateResult.blockedKeywordKeys) {
      blockedFallbackKeywordKeys.add(blockedKeywordKey)
    }
    if (languageGateResult.blockedKeywordKeys.length > 0) {
      console.warn(
        `[buildCreativeKeywordSet] ${input.scopeLabel}: ${stageLabel} 语言门禁拦截 ${languageGateResult.blockedKeywordKeys.length} 个候选`
      )
    }
    return languageGateResult.keywords
  }
  const runContextFilter = (keywordsWithVolume: PoolKeywordData[]) =>
    filterCreativeKeywordsByOfferContextDetailed({
      offer: input.offer,
      keywordsWithVolume,
      creativeType: input.creativeType,
      scopeLabel: input.scopeLabel,
    })
  const initialContextFilterReport = canReuseContextFilteredSeedCandidates
    ? {
        keywords: originalCandidates as PoolKeywordData[],
        contextMismatchRemovedCount: 0,
        forbiddenRemovedCount: 0,
        qualityRemovedCount: 0,
        modelFamilyRemovedCount: 0,
        intentTighteningRemovedCount: 0,
        blockedKeywordKeys: [],
      }
    : runContextFilter(originalCandidates as PoolKeywordData[])
  if (!canReuseContextFilteredSeedCandidates) {
    accumulateContextFilterStats(initialContextFilterReport)
    accumulateBlockedFallbackKeywordKeys(initialContextFilterReport)
  }
  let contextFilteredCandidates = initialContextFilterReport.keywords
  const initialContextFilteredCount = contextFilteredCandidates.length
  let postSupplementCandidateCount = originalCandidates.length
  let postSupplementContextFilteredCount = contextFilteredCandidates.length

  if (input.enableSupplementation) {
    try {
      const supplemented = await applyKeywordSupplementationOnce({
        offer: input.offer,
        userId: input.userId,
        brandName: input.brandName,
        targetLanguage: input.targetLanguage,
        keywordsWithVolume: contextFilteredCandidates as any,
        poolCandidates,
        bucket: input.bucket,
        skipAiRanking: input.skipSupplementAiRanking,
      })
      keywordSupplementation = supplemented.keywordSupplementation
      const supplementedCandidates = normalizeCreativeKeywordCandidatesForContextFilter(
        supplemented.keywordsWithVolume as unknown[],
        fallbackSource
      ) as PoolKeywordData[]
      postSupplementCandidateCount = supplementedCandidates.length

      candidatePoolSource = mergeSeedCandidates({
        primaryCandidates: originalCandidates as PoolKeywordData[],
        seedCandidates: supplementedCandidates,
      })
      if (canReuseContextFilteredSeedCandidates) {
        const alreadyContextFiltered = supplementedCandidates.filter((item) =>
          hasOfferContextFilteredTag(item as PoolKeywordData)
        )
        const candidatesNeedingFilter = supplementedCandidates.filter(
          (item) => !hasOfferContextFilteredTag(item as PoolKeywordData)
        )

        if (candidatesNeedingFilter.length > 0) {
          const postSupplementContextFilterReport = runContextFilter(candidatesNeedingFilter)
          accumulateContextFilterStats(postSupplementContextFilterReport)
          accumulateBlockedFallbackKeywordKeys(postSupplementContextFilterReport)
          contextFilteredCandidates = mergeSeedCandidates({
            primaryCandidates: alreadyContextFiltered as PoolKeywordData[],
            seedCandidates: postSupplementContextFilterReport.keywords as PoolKeywordData[],
          })
        } else {
          contextFilteredCandidates = alreadyContextFiltered
        }
      } else {
        const postSupplementContextFilterReport = runContextFilter(supplementedCandidates)
        accumulateContextFilterStats(postSupplementContextFilterReport)
        accumulateBlockedFallbackKeywordKeys(postSupplementContextFilterReport)
        contextFilteredCandidates = postSupplementContextFilterReport.keywords
      }
      postSupplementContextFilteredCount = contextFilteredCandidates.length
    } catch (error: any) {
      if (!input.continueOnSupplementError) {
        throw error
      }
      console.warn(`[buildCreativeKeywordSet] 补词失败（继续执行）: ${error?.message || error}`)
    }
  }

  contextFilteredCandidates = applyLanguageGate(
    contextFilteredCandidates as PoolKeywordData[],
    'context_filter_candidates'
  )
  contextFilteredCandidates = prefixStandaloneModelTokensWithBrand({
    keywordsWithVolume: contextFilteredCandidates as PoolKeywordData[],
    brandName: input.brandName || input.offer.brand,
    scopeLabel: `${input.scopeLabel}:context_filter_candidates`,
  }).keywordsWithVolume
  postSupplementContextFilteredCount = contextFilteredCandidates.length

  candidatePoolSource = filterBlockedFallbackCandidates({
    candidates: candidatePoolSource,
    blockedKeywordKeys: blockedFallbackKeywordKeys,
  })
  candidatePoolSource = mergeSeedCandidates({
    primaryCandidates: candidatePoolSource,
    seedCandidates: contextFilteredCandidates,
  })
  candidatePoolSource = applyLanguageGate(
    candidatePoolSource as PoolKeywordData[],
    'fallback_candidate_pool'
  )
  candidatePoolSource = prefixStandaloneModelTokensWithBrand({
    keywordsWithVolume: candidatePoolSource as PoolKeywordData[],
    brandName: input.brandName || input.offer.brand,
    scopeLabel: `${input.scopeLabel}:fallback_candidate_pool`,
  }).keywordsWithVolume
  const maxKeywords = input.maxKeywords ?? CREATIVE_KEYWORD_MAX_COUNT
  const baseMinimumSelectedKeywordCount = resolveCreativeKeywordMinimumOutputCount({
    creativeType: input.creativeType || null,
    maxKeywords,
    bucket: input.bucket,
  })
  let minimumSelectedKeywordCount = baseMinimumSelectedKeywordCount
  let relaxedFilteringTargetCount = resolveBucketMinimumKeywordTarget({
    bucket: input.bucket,
    maxKeywords,
    fallbackMinimum: minimumSelectedKeywordCount,
  })
  let relaxedFilteringTriggered = false
  let relaxedFilteringAddedCount = 0
  let relaxedFilteringPostFilterRatio = 0

  const contextIntentTighteningRemoved =
    contextFilterStats.removedByContextMismatch + contextFilterStats.removedByIntentTightening
  const contextIntentTighteningDenominator = Math.max(
    1,
    initialCandidateCount,
    postSupplementCandidateCount
  )
  const contextIntentTighteningRemovalRatio = Math.min(
    1,
    contextIntentTighteningRemoved / contextIntentTighteningDenominator
  )
  const hasPositiveVolumeCandidate = candidatePoolSource.some(
    (item) => Number((item as any)?.searchVolume || 0) > 0
  )
  const allowAdaptiveNoVolumeFloor =
    input.creativeType === 'product_intent' && (input.bucket === 'D' || input.bucket === 'S')
  if (
    allowAdaptiveNoVolumeFloor &&
    !hasPositiveVolumeCandidate &&
    contextFilteredCandidates.length > 0 &&
    contextIntentTighteningRemovalRatio >= 0.9
  ) {
    const demandIntentMinimum = resolveCreativeKeywordMinimumOutputCount({
      creativeType: input.creativeType || null,
      maxKeywords,
      bucket: null,
    })
    const adaptiveMinimumSelectedKeywordCount = Math.max(
      demandIntentMinimum,
      Math.min(baseMinimumSelectedKeywordCount, contextFilteredCandidates.length)
    )
    if (adaptiveMinimumSelectedKeywordCount < minimumSelectedKeywordCount) {
      minimumSelectedKeywordCount = adaptiveMinimumSelectedKeywordCount
      relaxedFilteringTargetCount = resolveBucketMinimumKeywordTarget({
        bucket: input.bucket,
        maxKeywords,
        fallbackMinimum: minimumSelectedKeywordCount,
      })
      console.warn(
        `[buildCreativeKeywordSet][monitor] ${input.scopeLabel}: sparse no-volume context lowered keyword floor ${baseMinimumSelectedKeywordCount}→${minimumSelectedKeywordCount}`
      )
    }
  }
  relaxedFilteringPostFilterRatio = Math.min(
    1,
    Number((contextFilteredCandidates.length / contextIntentTighteningDenominator).toFixed(4))
  )
  if (contextIntentTighteningRemovalRatio > 0.8) {
    console.warn(
      `[buildCreativeKeywordSet][monitor] ${input.scopeLabel}: context+intent tightening removed ${(contextIntentTighteningRemovalRatio * 100).toFixed(1)}% (${contextIntentTighteningRemoved}/${contextIntentTighteningDenominator})`
    )
  }
  const relaxedFilteringEnabled = envEnabled('CREATIVE_KEYWORD_RELAXED_FILTERING_ENABLED', true)
  const relaxedFilteringTriggerRatio = parseBoundedFloatEnv(
    'CREATIVE_KEYWORD_RELAXED_FILTERING_TRIGGER_RATIO',
    0.1,
    0.01,
    0.6
  )
  if (
    relaxedFilteringEnabled &&
    contextFilteredCandidates.length > 0 &&
    relaxedFilteringPostFilterRatio < relaxedFilteringTriggerRatio &&
    contextFilteredCandidates.length < relaxedFilteringTargetCount
  ) {
    const existingKeywordKeys = new Set(
      contextFilteredCandidates
        .map((item) => normalizeCandidateKey((item as any)?.keyword))
        .filter(Boolean)
    )
    const refillLimit = Math.max(0, relaxedFilteringTargetCount - contextFilteredCandidates.length)
    const relaxedTopUpCandidates = candidatePoolSource
      .filter(isRelaxedFilteringPriorityCandidate)
      .filter((item) => {
        const keywordKey = normalizeCandidateKey((item as any)?.keyword)
        return Boolean(keywordKey) && !existingKeywordKeys.has(keywordKey)
      })
      .sort(compareRelaxedFilteringCandidates)
      .slice(0, refillLimit)

    if (relaxedTopUpCandidates.length > 0) {
      contextFilteredCandidates = mergeSeedCandidates({
        primaryCandidates: contextFilteredCandidates as PoolKeywordData[],
        seedCandidates: relaxedTopUpCandidates as PoolKeywordData[],
      })
      postSupplementContextFilteredCount = contextFilteredCandidates.length
      relaxedFilteringTriggered = true
      relaxedFilteringAddedCount = relaxedTopUpCandidates.length
      console.warn(
        `[buildCreativeKeywordSet][monitor] ${input.scopeLabel}: relaxed filtering added ${relaxedTopUpCandidates.length} high-priority candidates (${contextFilteredCandidates.length}/${relaxedFilteringTargetCount})`
      )
    }
  }

  const fallbackResolved = resolveKeywordCandidatesAfterContextFilter({
    contextFilteredCandidates,
    originalCandidates: candidatePoolSource,
    blockedKeywordKeys: blockedFallbackKeywordKeys,
  })
  const blockOriginalFallback = shouldBlockOriginalFallbackForModelIntent({
    creativeType: input.creativeType,
    bucket: input.bucket,
  })

  const selectFromCandidates = (
    selectionCandidates: PoolKeywordData[],
    preferredBucketKeywords: string[]
  ) =>
    selectCreativeKeywords({
      // Avoid duplicating the same pool candidates into `keywords` (which are treated as AI fallback-only inputs).
      // Pass structured candidates only, so source provenance remains stable for dedupe/quota.
      keywords: [],
      keywordsWithVolume: selectionCandidates as any,
      brandName: input.brandName,
      targetLanguage: input.targetLanguage,
      creativeType: input.creativeType,
      bucket: input.bucket,
      preferredBucketKeywords,
      fallbackMode: input.fallbackMode,
      maxKeywords,
      brandReserve: input.brandReserve ?? CREATIVE_BRAND_KEYWORD_RESERVE,
      minBrandKeywords: input.minBrandKeywords ?? CREATIVE_BRAND_KEYWORD_RESERVE,
      brandOnly: input.brandOnly,
    })

  let selected = selectFromCandidates(
    (blockOriginalFallback && fallbackResolved.strategy === 'original'
      ? []
      : fallbackResolved.keywords) as PoolKeywordData[],
    poolCandidates
  )
  let selectionStrategy =
    blockOriginalFallback && fallbackResolved.strategy === 'original'
      ? 'keyword_pool'
      : fallbackResolved.strategy
  let selectionFallbackReason: CreativeKeywordSourceAudit['pipeline']['selectionFallbackReason'] =
    fallbackResolved.strategy === 'filtered' ? 'none' : 'context_filter_empty'
  let finalInvariantTriggered = false
  let finalInvariantCandidateCount = 0
  let nonEmptyRescueTriggered = false
  let nonEmptyRescueCandidateCount = 0

  const keywordPoolCandidates = candidatePoolSource.filter(isKeywordPoolCandidate)
  if (
    selected.keywords.length === 0 &&
    selectionStrategy !== 'keyword_pool' &&
    keywordPoolCandidates.length > 0
  ) {
    selected = selectFromCandidates(keywordPoolCandidates, poolCandidates)
    selectionStrategy = 'keyword_pool'
    if (selectionFallbackReason === 'none') {
      selectionFallbackReason = 'selection_empty'
    }
  }

  if (
    selected.keywords.length === 0 &&
    selectionStrategy !== 'original' &&
    candidatePoolSource.length > 0 &&
    !blockOriginalFallback
  ) {
    selected = selectFromCandidates(candidatePoolSource, poolCandidates)
    selectionStrategy = 'original'
    if (selectionFallbackReason === 'none') {
      selectionFallbackReason = 'selection_empty'
    }
  }

  const normalizeSelectedStandaloneModelTokens = () => {
    const prefixed = prefixStandaloneModelTokensWithBrand({
      keywordsWithVolume: (selected.keywordsWithVolume as PoolKeywordData[]) || [],
      brandName: input.brandName || input.offer.brand,
      scopeLabel: `${input.scopeLabel}:selected`,
    })
    const currentCount = Array.isArray(selected.keywordsWithVolume)
      ? selected.keywordsWithVolume.length
      : 0
    if (
      prefixed.prefixedCount <= 0 &&
      prefixed.removedShortNumericFragmentCount <= 0 &&
      prefixed.keywordsWithVolume.length === currentCount
    )
      return
    selected = {
      ...selected,
      keywordsWithVolume: prefixed.keywordsWithVolume as any,
      keywords: prefixed.keywordsWithVolume.map((item) => item.keyword),
    }
  }

  normalizeSelectedStandaloneModelTokens()

  if (
    selected.keywords.length > 0 &&
    selected.keywords.length < minimumSelectedKeywordCount &&
    contextFilteredCandidates.length > selected.keywords.length
  ) {
    const existingSelectedKeywordKeys = new Set(
      ((selected.keywordsWithVolume as PoolKeywordData[]) || [])
        .map((item) => normalizeCandidateKey((item as any)?.keyword))
        .filter(Boolean)
    )
    const contextTopUpLimit = Math.max(
      0,
      Math.min(maxKeywords, minimumSelectedKeywordCount) - selected.keywords.length
    )
    const prioritizedContextTopUp = [...contextFilteredCandidates]
      .filter((item) => {
        const key = normalizeCandidateKey((item as any)?.keyword)
        return Boolean(key) && !existingSelectedKeywordKeys.has(key)
      })
      .sort(compareContextRecoveryCandidates)
      .slice(0, contextTopUpLimit)

    if (prioritizedContextTopUp.length > 0) {
      const mergedKeywordsWithVolume = mergeSeedCandidates({
        primaryCandidates: (selected.keywordsWithVolume as PoolKeywordData[]) || [],
        seedCandidates: prioritizedContextTopUp as PoolKeywordData[],
      })
      selected = {
        ...selected,
        keywords: mergedKeywordsWithVolume.map((item) => item.keyword),
        keywordsWithVolume: mergedKeywordsWithVolume as any,
        truncated: false,
        sourceQuotaAudit: augmentSourceQuotaAuditWithRescue({
          audit:
            selected.sourceQuotaAudit ||
            buildNonEmptyRescueSourceQuotaAudit({
              fallbackMode: Boolean(input.fallbackMode),
              keywordCount: mergedKeywordsWithVolume.length,
            }),
          keywordsWithVolume: mergedKeywordsWithVolume,
          brandName: input.brandName,
        }),
      }
      normalizeSelectedStandaloneModelTokens()
    }
  }

  if (selected.keywords.length === 0 && contextFilteredCandidates.length > 0) {
    const selectionFallbackLimit = Math.min(
      maxKeywords,
      Math.max(minimumSelectedKeywordCount, Math.min(12, contextFilteredCandidates.length))
    )
    const prioritizedContextFallback = [...contextFilteredCandidates]
      .sort(compareContextRecoveryCandidates)
      .slice(0, selectionFallbackLimit)

    if (prioritizedContextFallback.length > 0) {
      selected = {
        keywords: prioritizedContextFallback.map((item) => item.keyword),
        keywordsWithVolume: prioritizedContextFallback as any,
        truncated: false,
        sourceQuotaAudit: augmentSourceQuotaAuditWithRescue({
          audit: buildNonEmptyRescueSourceQuotaAudit({
            fallbackMode: Boolean(input.fallbackMode),
            keywordCount: prioritizedContextFallback.length,
          }),
          keywordsWithVolume: prioritizedContextFallback,
          brandName: input.brandName,
        }),
      }
      selectionStrategy = 'filtered'
      if (selectionFallbackReason === 'none') {
        selectionFallbackReason = 'selection_empty'
      }
      normalizeSelectedStandaloneModelTokens()
    }
  }

  if (selected.keywords.length < minimumSelectedKeywordCount) {
    const nonEmptyRescueCandidates = applyLanguageGate(
      buildNonEmptyRescueCandidates(input),
      'non_empty_rescue_candidates'
    )
    if (nonEmptyRescueCandidates.length > 0) {
      nonEmptyRescueCandidateCount = nonEmptyRescueCandidates.length

      const rescueSelectionCandidates = mergeSeedCandidates({
        primaryCandidates: (selected.keywordsWithVolume as PoolKeywordData[]) || [],
        seedCandidates: nonEmptyRescueCandidates,
      })
      const rescueSelected = selectFromCandidates(rescueSelectionCandidates, poolCandidates)

      let nextSelected =
        rescueSelected.keywords.length > selected.keywords.length ? rescueSelected : selected

      if (nextSelected.keywords.length < minimumSelectedKeywordCount) {
        const existingKeywordKeys = new Set(
          ((nextSelected.keywordsWithVolume as PoolKeywordData[]) || [])
            .map((item) => normalizeCandidateKey((item as any)?.keyword))
            .filter(Boolean)
        )
        const manualRescueCandidates = nonEmptyRescueCandidates
          .filter((item) => {
            const key = normalizeCandidateKey((item as any)?.keyword)
            return Boolean(key) && !existingKeywordKeys.has(key)
          })
          .slice(0, Math.max(0, minimumSelectedKeywordCount - nextSelected.keywords.length))

        if (manualRescueCandidates.length > 0) {
          const mergedKeywordsWithVolume = mergeSeedCandidates({
            primaryCandidates: (nextSelected.keywordsWithVolume as PoolKeywordData[]) || [],
            seedCandidates: manualRescueCandidates,
          })
          nextSelected = {
            keywords: mergedKeywordsWithVolume.map((item) => item.keyword),
            keywordsWithVolume: mergedKeywordsWithVolume as any,
            truncated: false,
            sourceQuotaAudit: augmentSourceQuotaAuditWithRescue({
              audit:
                nextSelected.keywords.length > 0
                  ? nextSelected.sourceQuotaAudit
                  : buildNonEmptyRescueSourceQuotaAudit({
                      fallbackMode: Boolean(input.fallbackMode),
                      keywordCount: mergedKeywordsWithVolume.length,
                    }),
              keywordsWithVolume: mergedKeywordsWithVolume,
              brandName: input.brandName,
            }),
          }
        }
      }

      if (nextSelected.keywords.length > selected.keywords.length) {
        selected = nextSelected
        normalizeSelectedStandaloneModelTokens()
        nonEmptyRescueTriggered = true
        candidatePoolSource = mergeSeedCandidates({
          primaryCandidates: candidatePoolSource,
          seedCandidates: nonEmptyRescueCandidates,
        })
        candidatePoolSource = prefixStandaloneModelTokensWithBrand({
          keywordsWithVolume: candidatePoolSource,
          brandName: input.brandName || input.offer.brand,
          scopeLabel: `${input.scopeLabel}:non_empty_rescue_pool`,
        }).keywordsWithVolume
        if (selectionStrategy === 'filtered') {
          selectionStrategy = 'original'
        }
        if (selectionFallbackReason === 'none') {
          selectionFallbackReason = 'selection_empty'
        }
      }
    }
  }

  if (selected.keywords.length < minimumSelectedKeywordCount) {
    const existingKeywordKeys = new Set(
      ((selected.keywordsWithVolume as PoolKeywordData[]) || [])
        .map((item) => normalizeCandidateKey((item as any)?.keyword))
        .filter(Boolean)
    )
    const fallbackNeed = Math.max(0, minimumSelectedKeywordCount - selected.keywords.length)
    const buildEligibleTopUp = (preferNonRescue: boolean) =>
      candidatePoolSource
        .filter((item) => {
          const key = normalizeCandidateKey((item as any)?.keyword)
          if (!key || existingKeywordKeys.has(key)) return false
          return preferNonRescue ? !isBuilderNonEmptyRescueCandidate(item) : true
        })
        .sort(compareRelaxedFilteringCandidates)

    const preferredTopUp = buildEligibleTopUp(true).slice(0, fallbackNeed)
    const fallbackInvariantTopUpCandidates =
      preferredTopUp.length >= fallbackNeed
        ? preferredTopUp
        : [
            ...preferredTopUp,
            ...buildEligibleTopUp(false)
              .filter((item) => {
                const key = normalizeCandidateKey((item as any)?.keyword)
                if (!key) return false
                return !preferredTopUp.some(
                  (candidate) => normalizeCandidateKey((candidate as any)?.keyword) === key
                )
              })
              .slice(0, fallbackNeed - preferredTopUp.length),
          ]

    if (fallbackInvariantTopUpCandidates.length > 0) {
      const mergedKeywordsWithVolume = mergeSeedCandidates({
        primaryCandidates: (selected.keywordsWithVolume as PoolKeywordData[]) || [],
        seedCandidates: fallbackInvariantTopUpCandidates,
      })
      selected = {
        keywords: mergedKeywordsWithVolume.map((item) => item.keyword),
        keywordsWithVolume: mergedKeywordsWithVolume as any,
        truncated: false,
        sourceQuotaAudit: augmentSourceQuotaAuditWithRescue({
          audit:
            selected.sourceQuotaAudit ||
            buildNonEmptyRescueSourceQuotaAudit({
              fallbackMode: Boolean(input.fallbackMode),
              keywordCount: mergedKeywordsWithVolume.length,
            }),
          keywordsWithVolume: mergedKeywordsWithVolume,
          brandName: input.brandName,
        }),
      }
      normalizeSelectedStandaloneModelTokens()
      finalInvariantTriggered = true
      finalInvariantCandidateCount = fallbackInvariantTopUpCandidates.length
      if (selectionFallbackReason === 'none') {
        selectionFallbackReason = 'selection_empty'
      }
      console.warn(
        `[buildCreativeKeywordSet][monitor] ${input.scopeLabel}: enforced minimum keyword floor with ${fallbackInvariantTopUpCandidates.length} fallback candidates (${selected.keywords.length}/${minimumSelectedKeywordCount})`
      )
    }
  }

  if (selectionStrategy !== 'filtered' || nonEmptyRescueTriggered) {
    console.warn(
      `[buildCreativeKeywordSet][monitor] ${input.scopeLabel}: fallback/rescue triggered (strategy=${selectionStrategy}, nonEmptyRescue=${nonEmptyRescueTriggered})`
    )
  }
  if (selected.keywords.length < minimumSelectedKeywordCount) {
    console.warn(
      `[buildCreativeKeywordSet][monitor] ${input.scopeLabel}: keyword count below floor ${selected.keywords.length}/${minimumSelectedKeywordCount}`
    )
  }

  const globalKeywordVolumeHintMap = await buildGlobalKeywordVolumeHintMap({
    keywordsWithVolume: (selected.keywordsWithVolume as PoolKeywordData[]) || [],
    targetCountry: input.offer.target_country,
    targetLanguage: input.targetLanguage || input.offer.target_language,
  })
  if (globalKeywordVolumeHintMap.size > 0) {
    const backfilled = applyGlobalKeywordVolumeBackfill({
      keywordsWithVolume: (selected.keywordsWithVolume as PoolKeywordData[]) || [],
      volumeHintMap: globalKeywordVolumeHintMap,
    })
    if (backfilled.patchedCount > 0) {
      selected = {
        ...selected,
        keywordsWithVolume: backfilled.keywordsWithVolume as any,
      }
      console.log(
        `[buildCreativeKeywordSet][monitor] ${input.scopeLabel}: global volume backfill patched ${backfilled.patchedCount} keywords`
      )
    }
  }

  const selectionFallbackTriggered =
    selectionStrategy !== 'filtered' || finalInvariantTriggered || nonEmptyRescueTriggered

  const audit = buildKeywordSourceAudit({
    keywordsWithVolume: selected.keywordsWithVolume as PoolKeywordData[],
    fallbackMode: Boolean(input.fallbackMode),
    contextFallbackStrategy: selectionStrategy,
    sourceQuotaAudit: selected.sourceQuotaAudit,
    contextFilterStats,
    creativeType: input.creativeType || null,
    brandName: input.brandName,
    keywordSupplementation,
    pipeline: {
      initialCandidateCount,
      initialContextFilteredCount,
      postSupplementCandidateCount,
      postSupplementContextFilteredCount,
      finalCandidatePoolCount: candidatePoolSource.length,
      selectionFallbackTriggered,
      selectionFallbackSource: selectionStrategy,
      selectionFallbackReason,
      contractSatisfiedAfterFallback: selected.keywords.length > 0,
      finalInvariantTriggered,
      finalInvariantCandidateCount,
      nonEmptyRescueTriggered,
      nonEmptyRescueCandidateCount,
      relaxedFilteringTriggered,
      relaxedFilteringAddedCount,
      relaxedFilteringTargetCount,
      relaxedFilteringPostFilterRatio,
      supplementAppliedAfterFilter: Boolean(input.enableSupplementation),
    },
  })
  logKeywordSourceAudit({
    scopeLabel: input.scopeLabel,
    audit,
    keywordSupplementation,
    creativeType: input.creativeType || null,
    bucket: input.bucket || null,
  })
  try {
    await emitCreativeKeywordRiskAlerts({
      userId: input.userId,
      offerId: Number((input.offer as any)?.id) || null,
      scopeLabel: input.scopeLabel,
      creativeType: input.creativeType || null,
      bucket: input.bucket || null,
      minimumSelectedKeywordCount,
      selectedKeywords: selected.keywords,
      targetLanguage: input.targetLanguage || input.offer.target_language,
      brandName: input.brandName || input.offer.brand,
      contextIntentTighteningRemovalRatio,
      contextIntentTighteningRemoved,
      contextIntentTighteningDenominator,
      selectionFallbackTriggered,
      nonEmptyRescueTriggered,
      relaxedFilteringTriggered,
    })
  } catch (error: any) {
    console.warn(
      `[buildCreativeKeywordSet] ${input.scopeLabel}: 关键词风控告警写入失败: ${error?.message || String(error)}`
    )
  }

  const sanitizedInputPromptKeywords = Array.isArray(input.promptKeywords)
    ? filterBlockedPromptKeywords({
        keywords: input.promptKeywords,
        blockedKeywordKeys: blockedFallbackKeywordKeys,
      })
    : []
  const promptKeywords =
    sanitizedInputPromptKeywords.length > 0
      ? buildPromptKeywordSubset({
          selectedKeywords: sanitizedInputPromptKeywords,
          candidates: [],
          maxKeywords: CREATIVE_PROMPT_KEYWORD_LIMIT,
        })
      : selected.keywords.length === 0
        ? []
        : buildPromptKeywordSubset({
            selectedKeywords: selected.keywords,
            candidates: candidatePoolSource,
            maxKeywords: CREATIVE_PROMPT_KEYWORD_LIMIT,
          })
  const promptKeywordSet = new Set(promptKeywords.map((item) => normalizeCandidateKey(item)))
  const executableKeywordSet = new Set(selected.keywords.map((item) => normalizeCandidateKey(item)))
  const candidatePool = candidatePoolSource.map((item) =>
    toCreativeKeywordCandidate(item, {
      promptEligible: promptKeywordSet.has(normalizeCandidateKey((item as any)?.keyword)),
      executableEligible: executableKeywordSet.has(normalizeCandidateKey((item as any)?.keyword)),
      creativeType: input.creativeType || null,
      brandName: input.brandName,
    })
  )
  const executableKeywordCandidates = (selected.keywordsWithVolume as PoolKeywordData[]).map(
    (item) =>
      toCreativeKeywordCandidate(item, {
        promptEligible: promptKeywordSet.has(normalizeCandidateKey((item as any)?.keyword)),
        executableEligible: true,
        creativeType: input.creativeType || null,
        brandName: input.brandName,
      })
  )

  return {
    promptKeywords,
    executableKeywords: selected.keywords,
    executableKeywordCandidates,
    candidatePool,
    keywordsWithVolume: selected.keywordsWithVolume as PoolKeywordData[],
    keywordSupplementation,
    contextFallbackStrategy: selectionStrategy,
    audit,
  }
}
