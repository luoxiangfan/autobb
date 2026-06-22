/**
 * 创意关键词选择：主流程
 */
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import {
  analyzeKeywordLanguageCompatibility,
} from '../planner/keyword-validity'

import {
  CREATIVE_KEYWORD_MAX_COUNT,
  MODEL_INTENT_UNDERFILL_CANDIDATE_FLOOR,
  type CreativeKeywordMatchType,
  type CreativeKeywordLike,
  type SelectCreativeKeywordsInput,
  type SelectCreativeKeywordsOutput,
  type RankedCandidate,
} from './creative-keyword-selection-types'
import {
  deriveCanonicalCreativeType,
  containsAsinLikeToken,
} from '../../creatives/server'
import { getPureBrandKeywords } from '../brand/brand-keyword-utils'
import {
  getKeywordSourcePriority,
  normalizeKeywordSourceSubtype,
  inferKeywordRawSource,
  inferKeywordDerivedTags,
} from './creative-keyword-source-priority'
import {
  compareRankedCandidates,
  hasActiveSearchVolumeUnavailableFlag,
  resolveCreativeKeywordMaxWords,
  buildKeywordLanguageSignals,
  buildKeywordDecisionTrace,
  normalizeAuditTags,
  inferAnchorType,
  inferAnchorKinds,
  normalizeAuditString,
  inferKeywordConfidence,
  inferQualityReason,
  buildAuditEvidence,
  resolveKeywordFallbackReason,
  resolveKeywordRescueStage,
  buildKeywordContractRoleMap,
  inferEvidenceStrength,
  inferFamilyMatchType,
  resolveModelIntentFinalMatchType,
  isDerivedSourceTier,
  inferSourceField,
  isStrongPreferredBucketCandidate,
  trimLowValueTransactionalTailCandidates,
} from './creative-keyword-candidate'
import {
  applySourceQuotaOnSelectedCandidates,
  reconcileSourceQuotaAuditWithFinalOutput,
  resolveSourceQuotaConfig,
  resolvePreferredBucketRequiredCount,
  classifySourceGovernance,
  enforceModelIntentAiCapOnFinalOutput,
} from './creative-keyword-source-quota'
import {
  toRankedCandidates,
  ensureBrandCoverage,
  ensurePureBrandCoverage,
  resolveCreativeKeywordContractDefaults,
  buildBucketSpecificRescueCandidates,
  buildGuaranteedNonEmptyRescueCandidates,
  enforceCreativeKeywordContract,
  enforceFinalOutputInvariants,
  rebalanceModelIntentCandidates,
  backfillCreativeOutputCandidates,
  buildModelIntentPrecisionRescueCandidates,
} from './creative-keyword-output'

export function selectCreativeKeywords(
  input: SelectCreativeKeywordsInput
): SelectCreativeKeywordsOutput {
  const creativeType =
    input.creativeType ||
    deriveCanonicalCreativeType({
      creativeType: input.creativeType,
      keywordBucket: input.bucket,
      keywords: input.keywordsWithVolume?.map((item) => item.keyword) || input.keywords,
    })
  const maxKeywordsInput = Number(input.maxKeywords)
  const maxKeywords = Number.isFinite(maxKeywordsInput)
    ? Math.max(1, Math.floor(maxKeywordsInput))
    : CREATIVE_KEYWORD_MAX_COUNT
  const contractDefaults = resolveCreativeKeywordContractDefaults({
    creativeType,
    maxKeywords,
  })

  const brandReserveInput = Number(input.brandReserve)
  const brandReserve = Number.isFinite(brandReserveInput)
    ? Math.max(0, Math.floor(brandReserveInput))
    : contractDefaults.brandReserve
  const minBrandKeywordsInput = Number(input.minBrandKeywords)
  const minBrandKeywords = Number.isFinite(minBrandKeywordsInput)
    ? Math.max(0, Math.floor(minBrandKeywordsInput))
    : contractDefaults.minBrandKeywords
  const requestedBrandOnly =
    creativeType === 'brand_intent'
      ? true
      : creativeType === 'model_intent'
        ? false
        : Boolean(input.brandOnly)

  const maxWordsInput = Number(input.maxWords)
  const maxWords = Number.isFinite(maxWordsInput)
    ? Math.max(1, Math.floor(maxWordsInput))
    : resolveCreativeKeywordMaxWords(creativeType)
  const fallbackMode =
    Boolean(input.fallbackMode) ||
    Boolean(
      input.keywordsWithVolume?.some((item) => hasActiveSearchVolumeUnavailableFlag(item as any))
    )

  const requiredPureBrandCount = contractDefaults.requiredPureBrandCount
  const effectiveBrandReserve = brandReserve
  const effectiveMinBrandKeywords = minBrandKeywords
  const requiredBrandCount = requestedBrandOnly
    ? maxKeywords
    : Math.min(maxKeywords, effectiveMinBrandKeywords)

  let rankedCandidates = ensureBrandCoverage(
    ensurePureBrandCoverage(
      toRankedCandidates({ ...input, creativeType }, maxWords, {
        disableVolumeReliance: fallbackMode,
      }),
      { ...input, creativeType },
      maxWords,
      creativeType === 'brand_intent' || creativeType === 'product_intent' ? 1 : 0
    ),
    { ...input, creativeType },
    maxWords,
    requiredBrandCount
  )
  if (
    creativeType === 'model_intent' &&
    rankedCandidates.length < Math.min(maxKeywords, MODEL_INTENT_UNDERFILL_CANDIDATE_FLOOR)
  ) {
    const relaxedCandidates = buildBucketSpecificRescueCandidates({
      input: { ...input, fallbackMode },
      creativeType,
      maxWords,
      requiredBrandCount,
    })
    if (relaxedCandidates.length > rankedCandidates.length) {
      rankedCandidates = relaxedCandidates
    }
  }
  if (rankedCandidates.length === 0) {
    const guaranteedRescueCandidates = buildGuaranteedNonEmptyRescueCandidates({
      input: { ...input, creativeType },
      creativeType,
      rankedCandidates,
      maxWords,
      maxKeywords,
    })
    if (guaranteedRescueCandidates.length > 0) {
      rankedCandidates = guaranteedRescueCandidates
    }
  }
  const preferredBucketCandidates = rankedCandidates
    .filter((candidate) => candidate.isPreferredBucket)
    .sort(compareRankedCandidates)
  const strongPreferredBucketCandidates = preferredBucketCandidates
    .filter((candidate) => isStrongPreferredBucketCandidate(candidate))
    .sort(compareRankedCandidates)
  const requiredPreferredBucketCount = resolvePreferredBucketRequiredCount({
    creativeType,
    maxKeywords,
    preferredAvailableCount: preferredBucketCandidates.length,
    strongPreferredAvailableCount: strongPreferredBucketCandidates.length,
    totalAvailableCount: rankedCandidates.length,
  })
  if (rankedCandidates.length === 0) {
    return {
      keywords: [],
      keywordsWithVolume: [],
      truncated: false,
      sourceQuotaAudit: {
        enabled: true,
        fallbackMode,
        targetCount: 0,
        requiredBrandCount: Math.max(0, requiredBrandCount),
        acceptedBrandCount: 0,
        acceptedCount: 0,
        deferredCount: 0,
        deferredRefillCount: 0,
        deferredRefillTriggered: false,
        underfillBeforeRefill: 0,
        quota: resolveSourceQuotaConfig({
          maxKeywords,
          fallbackMode,
          creativeType,
          rankedCandidates: [],
        }),
        acceptedByClass: {
          lowTrust: 0,
          ai: 0,
          aiLlmRaw: 0,
        },
        blockedByCap: {
          lowTrust: 0,
          ai: 0,
          aiLlmRaw: 0,
        },
      },
    }
  }

  const selected = new Map<string, RankedCandidate>()
  let selectedStrongPreferredBucketCount = 0
  const pushSelected = (candidate: RankedCandidate): boolean => {
    if (selected.has(candidate.normalized)) return false
    selected.set(candidate.normalized, candidate)
    if (isStrongPreferredBucketCandidate(candidate)) selectedStrongPreferredBucketCount += 1
    return true
  }
  const candidateCollectionBudget = Math.min(
    rankedCandidates.length,
    Math.max(maxKeywords, Math.floor(maxKeywords * 2))
  )

  const pureBrandCandidates = rankedCandidates
    .filter((candidate) => candidate.isPureBrand)
    .sort(compareRankedCandidates)
  const brandCandidates = rankedCandidates
    .filter((candidate) => candidate.isBrand)
    .sort(compareRankedCandidates)
  const enforceBrandOnly = requestedBrandOnly && brandCandidates.length > 0

  if (
    (creativeType === 'brand_intent' || creativeType === 'product_intent') &&
    pureBrandCandidates.length > 0
  ) {
    pushSelected(pureBrandCandidates[0])
  }

  if (enforceBrandOnly) {
    for (const candidate of brandCandidates) {
      if (selected.size >= candidateCollectionBudget) break
      pushSelected(candidate)
    }
  } else {
    for (const candidate of brandCandidates) {
      if (selected.size >= requiredBrandCount) break
      pushSelected(candidate)
    }

    const reservedBrandCount = Math.min(
      maxKeywords,
      Math.max(requiredBrandCount, effectiveBrandReserve)
    )
    for (const candidate of brandCandidates) {
      if (selected.size >= reservedBrandCount) break
      pushSelected(candidate)
    }

    if (requiredPreferredBucketCount > 0) {
      for (const candidate of strongPreferredBucketCandidates) {
        if (selected.size >= candidateCollectionBudget) break
        if (selectedStrongPreferredBucketCount >= requiredPreferredBucketCount) break
        pushSelected(candidate)
      }
    }
  }

  if (!enforceBrandOnly) {
    const allCandidates = [...rankedCandidates].sort(compareRankedCandidates)
    for (const candidate of allCandidates) {
      if (selected.size >= candidateCollectionBudget) break
      pushSelected(candidate)
    }
  }

  const sourceQuotaApplied = applySourceQuotaOnSelectedCandidates({
    selectedList: Array.from(selected.values()).sort(compareRankedCandidates),
    creativeType,
    maxKeywords,
    requiredBrandCount,
    requiredPureBrandCount,
    requiredPreferredBucketCount,
    fallbackMode,
  })
  const quotaBalancedSelectedList =
    creativeType === 'model_intent'
      ? rebalanceModelIntentCandidates({
          selectedList: sourceQuotaApplied.selectedList,
          maxKeywords,
          brandName: input.brandName,
          rankedCandidates,
        })
      : sourceQuotaApplied.selectedList
  const selectedList = enforceCreativeKeywordContract({
    creativeType,
    selectedList: quotaBalancedSelectedList,
    rankedCandidates,
    brandName: input.brandName,
    maxKeywords,
    requiredPureBrandCount,
    minProductDemandCount: contractDefaults.minProductDemandCount,
    minModelIntentQualifiedCount: contractDefaults.minModelIntentQualifiedCount,
  })
  let outputCandidates = selectedList.filter(
    (candidate) => !containsAsinLikeToken(candidate.keyword)
  )
  if (
    (creativeType === 'model_intent' || creativeType === 'product_intent') &&
    outputCandidates.length > 0
  ) {
    outputCandidates = backfillCreativeOutputCandidates({
      creativeType,
      bucket: input.bucket,
      outputCandidates,
      rankedCandidates,
      maxKeywords,
      brandName: input.brandName,
    })
  }
  outputCandidates = trimLowValueTransactionalTailCandidates({
    candidates: outputCandidates,
    creativeType,
    bucket: input.bucket,
    brandName: input.brandName,
    maxKeywords,
    requiredPureBrandCount,
    minProductDemandCount: contractDefaults.minProductDemandCount,
  })
  outputCandidates = enforceFinalOutputInvariants({
    creativeType,
    outputCandidates,
    rankedCandidates,
    brandName: input.brandName,
    maxKeywords,
    fallbackMode,
    requiredBrandCount,
    requiredPureBrandCount,
    brandOnly: enforceBrandOnly,
  })
  if (creativeType === 'model_intent' && outputCandidates.length === 0) {
    const precisionRescueCandidates = buildModelIntentPrecisionRescueCandidates({
      rankedCandidates,
      brandName: input.brandName,
      maxKeywords,
    })
    if (precisionRescueCandidates.length > 0) {
      outputCandidates = enforceFinalOutputInvariants({
        creativeType,
        outputCandidates: precisionRescueCandidates,
        rankedCandidates,
        brandName: input.brandName,
        maxKeywords,
        fallbackMode,
        requiredBrandCount,
        requiredPureBrandCount,
        brandOnly: enforceBrandOnly,
      })
    }
  }
  if (outputCandidates.length === 0) {
    const guaranteedRescueCandidates = buildGuaranteedNonEmptyRescueCandidates({
      input: { ...input, creativeType },
      creativeType,
      rankedCandidates,
      maxWords,
      maxKeywords,
    })
    if (guaranteedRescueCandidates.length > 0) {
      outputCandidates = enforceFinalOutputInvariants({
        creativeType,
        outputCandidates: guaranteedRescueCandidates,
        rankedCandidates,
        brandName: input.brandName,
        maxKeywords,
        fallbackMode,
        requiredBrandCount,
        requiredPureBrandCount,
        brandOnly: enforceBrandOnly,
      })
    }
  }
  if (creativeType === 'model_intent' && outputCandidates.length > 0) {
    outputCandidates = enforceModelIntentAiCapOnFinalOutput({
      outputCandidates,
      rankedCandidates,
      quota: sourceQuotaApplied.audit.quota,
      brandName: input.brandName,
    })
  }
  const contractRoleMap = buildKeywordContractRoleMap({
    selectedList: outputCandidates,
    creativeType,
    brandName: input.brandName,
    requiredBrandCount,
    requiredPureBrandCount,
    minProductDemandCount: contractDefaults.minProductDemandCount,
  })
  const normalizedBrand = normalizeGoogleAdsKeyword(input.brandName || '')
  const pureBrandKeywords =
    normalizedBrand && normalizedBrand !== 'unknown' ? getPureBrandKeywords(normalizedBrand) : []
  const keywordsWithVolume: CreativeKeywordLike[] = outputCandidates.map((candidate) => {
    const finalMatchType: CreativeKeywordMatchType =
      creativeType === 'model_intent'
        ? resolveModelIntentFinalMatchType(candidate)
        : candidate.matchType || candidate.suggestedMatchType || 'PHRASE'
    const normalizedPrioritySubtype = normalizeKeywordSourceSubtype({
      source: candidate.source,
      sourceType: candidate.sourceType,
    })
    const explicitSourceSubtype =
      normalizeAuditString(candidate.sourceSubtype) ||
      normalizeAuditString(candidate.sourceType)?.toUpperCase()
    const sourceSubtype =
      explicitSourceSubtype === 'KEYWORD_POOL' || explicitSourceSubtype === 'CANONICAL_BUCKET_VIEW'
        ? normalizedPrioritySubtype || explicitSourceSubtype
        : explicitSourceSubtype || normalizedPrioritySubtype
    const sourceTier = getKeywordSourcePriority(
      sourceSubtype || candidate.sourceType || candidate.source
    ).tier
    const sourceGovernance = classifySourceGovernance(candidate)
    const rawSource =
      normalizeAuditString(candidate.rawSource) ||
      inferKeywordRawSource({
        source: candidate.source,
        sourceType: sourceSubtype || candidate.sourceType,
      })
    const derivedTags =
      normalizeAuditTags(candidate.derivedTags) ||
      inferKeywordDerivedTags({
        source: candidate.source,
        sourceType: sourceSubtype || candidate.sourceType,
      })
    const contractRole = contractRoleMap.get(candidate.normalized) || 'optional'
    const evidenceStrength = inferEvidenceStrength(candidate, creativeType, input.brandName)
    const familyMatchType = inferFamilyMatchType(candidate, creativeType, input.brandName)
    const fallbackReason = resolveKeywordFallbackReason(candidate)
    const rescueStage = resolveKeywordRescueStage(candidate)
    const languageSignals = buildKeywordLanguageSignals(
      analyzeKeywordLanguageCompatibility({
        keyword: candidate.keyword,
        targetLanguage: input.targetLanguage,
        pureBrandKeywords,
      }),
      input.targetLanguage
    )
    const isDerived = isDerivedSourceTier(sourceTier)
    const isFallback = Boolean(
      contractRole === 'fallback' ||
      fallbackReason ||
      rescueStage ||
      sourceGovernance.bucket === 'rescue' ||
      sourceGovernance.bucket === 'synthetic'
    )
    const decisionTrace = buildKeywordDecisionTrace({
      sourceTier,
      sourceGovernanceBucket: sourceGovernance.bucket,
      sourceTop1Eligible: sourceGovernance.top1Eligible,
      sourceTop2Eligible: sourceGovernance.top2Eligible,
      contractRole,
      fallbackReason,
      rescueStage,
      evidenceStrength,
      familyMatchType,
      finalMatchType,
      languageSignals,
    })

    return {
      keyword: candidate.keyword,
      searchVolume: Number(candidate.searchVolume || 0) || 0,
      competition: candidate.competition,
      competitionIndex: candidate.competitionIndex,
      source: candidate.source,
      matchType: finalMatchType,
      sourceType:
        normalizeAuditString(candidate.sourceType) || normalizeAuditString(candidate.source),
      sourceSubtype,
      sourceTier,
      sourceGovernanceBucket: sourceGovernance.bucket,
      sourceTop1Eligible: sourceGovernance.top1Eligible,
      sourceTop2Eligible: sourceGovernance.top2Eligible,
      rawSource,
      derivedTags,
      isDerived,
      isFallback,
      sourceField:
        normalizeAuditString(candidate.sourceField) || inferSourceField(candidate.source),
      anchorType:
        normalizeAuditString(candidate.anchorType) ||
        inferAnchorType({
          keyword: candidate.keyword,
          isBrand: candidate.isBrand,
          brandName: input.brandName,
        }),
      anchorKinds: inferAnchorKinds({
        keyword: candidate.keyword,
        isBrand: candidate.isBrand,
        brandName: input.brandName,
      }),
      languageSignals,
      contractRole,
      evidenceStrength,
      familyMatchType,
      fallbackReason,
      rescueStage,
      filteredReasons: candidate.rejectionReason ? [candidate.rejectionReason] : undefined,
      evidence: buildAuditEvidence(candidate, input.brandName),
      suggestedMatchType: candidate.suggestedMatchType || finalMatchType,
      confidence: inferKeywordConfidence(candidate, creativeType, finalMatchType),
      qualityReason: inferQualityReason(candidate, creativeType, input.brandName, finalMatchType),
      rejectionReason: normalizeAuditString(candidate.rejectionReason),
      decisionTrace,
      lowTopPageBid: candidate.lowTopPageBid,
      highTopPageBid: candidate.highTopPageBid,
      volumeUnavailableReason: candidate.volumeUnavailableReason,
    }
  })
  const reconciledSourceQuotaAudit = reconcileSourceQuotaAuditWithFinalOutput({
    audit: sourceQuotaApplied.audit,
    finalCandidates: outputCandidates,
  })

  return {
    keywords: keywordsWithVolume.map((item) => item.keyword),
    keywordsWithVolume,
    truncated: rankedCandidates.length > keywordsWithVolume.length,
    sourceQuotaAudit: reconciledSourceQuotaAudit,
  }
}
