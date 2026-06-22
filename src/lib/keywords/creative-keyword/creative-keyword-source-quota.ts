/**
 * 创意关键词选择：来源配额治理
 */
import {
  type CanonicalCreativeType,
} from '../../creatives/server'
import {
  getKeywordSourcePriority,
  inferKeywordRawSource,
  normalizeKeywordSourceSubtype,
} from './creative-keyword-source-priority'



import {
  type CreativeKeywordSourceQuotaAudit,
  type SourceGovernanceBucket,
  type SourceQuotaConfig,
  type RankedCandidate,
} from './creative-keyword-selection-types'
import {
  compareRankedCandidates,
  isStrongPreferredBucketCandidate,
  isModelIntentQualifiedCandidate,
  clampNumber,
} from './creative-keyword-candidate'

export function resolveSourceQuotaConfig(params: {
  maxKeywords: number
  fallbackMode: boolean
  creativeType: CanonicalCreativeType | null
  rankedCandidates: RankedCandidate[]
}): SourceQuotaConfig {
  const safeMax = Math.max(1, Math.floor(params.maxKeywords))
  let combinedRatio = params.fallbackMode ? 0.35 : 0.2
  let aiRatio = params.fallbackMode ? 0.25 : 0.15
  let aiLlmRawRatio = params.fallbackMode ? 0.15 : 0.1

  if (params.rankedCandidates.length > 0) {
    let trustedStrongFitCount = 0
    let lowTrustCount = 0
    for (const candidate of params.rankedCandidates) {
      const profile = candidate.evidenceProfile
      const sourceClass = classifyCandidateSource(candidate)
      if (sourceClass.lowTrust) lowTrustCount += 1

      const strongFit =
        profile.selectedIntentScore >= 2 ||
        profile.intentMargin >= 1.5 ||
        (profile.hasModelAnchor && profile.selectedIntentScore >= 1)
      const trusted = !sourceClass.lowTrust && profile.sourceTrustScore >= 6
      if (strongFit && trusted) trustedStrongFitCount += 1
    }

    const trustedSupply = trustedStrongFitCount / safeMax
    const lowTrustShare = lowTrustCount / Math.max(1, params.rankedCandidates.length)

    if (trustedSupply >= 1.2) {
      combinedRatio -= 0.12
      aiRatio -= 0.08
      aiLlmRawRatio -= 0.06
    } else if (trustedSupply >= 0.8) {
      combinedRatio -= 0.06
      aiRatio -= 0.04
      aiLlmRawRatio -= 0.03
    } else if (trustedSupply <= 0.35) {
      combinedRatio += 0.1
      aiRatio += 0.08
      aiLlmRawRatio += 0.06
    } else if (trustedSupply <= 0.55) {
      combinedRatio += 0.05
      aiRatio += 0.03
      aiLlmRawRatio += 0.02
    }

    if (params.creativeType === 'model_intent' && trustedSupply >= 0.8) {
      combinedRatio -= 0.03
      aiRatio -= 0.02
      aiLlmRawRatio -= 0.02
    }

    if (lowTrustShare <= 0.2 && trustedSupply >= 0.9) {
      combinedRatio -= 0.04
      aiRatio -= 0.03
      aiLlmRawRatio -= 0.02
    } else if (lowTrustShare >= 0.65 && trustedSupply <= 0.6) {
      combinedRatio += 0.06
      aiRatio += 0.04
      aiLlmRawRatio += 0.03
    }
  }

  combinedRatio = clampNumber(
    combinedRatio,
    params.fallbackMode ? 0.12 : 0.05,
    params.fallbackMode ? 0.5 : 0.35
  )
  aiRatio = clampNumber(
    aiRatio,
    params.fallbackMode ? 0.08 : 0.03,
    params.fallbackMode ? 0.4 : 0.25
  )
  aiLlmRawRatio = clampNumber(
    aiLlmRawRatio,
    params.fallbackMode ? 0.05 : 0.02,
    params.fallbackMode ? 0.3 : 0.18
  )

  const combinedLowTrustCap = Math.max(0, Math.floor(safeMax * combinedRatio))
  const aiCap = Math.min(combinedLowTrustCap, Math.max(0, Math.floor(safeMax * aiRatio)))
  const aiLlmRawCap = Math.min(aiCap, Math.max(0, Math.floor(safeMax * aiLlmRawRatio)))

  return {
    combinedLowTrustCap,
    aiCap,
    aiLlmRawCap,
  }
}

export function resolvePreferredBucketRequiredCount(params: {
  creativeType: CanonicalCreativeType | null
  maxKeywords: number
  preferredAvailableCount: number
  strongPreferredAvailableCount: number
  totalAvailableCount: number
}): number {
  if (params.preferredAvailableCount <= 0) return 0
  if (params.strongPreferredAvailableCount <= 0) return 0

  let baseRatio = 0.24
  if (params.creativeType === 'brand_intent') baseRatio = 0.3
  else if (params.creativeType === 'model_intent') baseRatio = 0.2
  else if (params.creativeType === 'product_intent') baseRatio = 0.26

  const strongDensity =
    params.strongPreferredAvailableCount / Math.max(1, params.totalAvailableCount)
  const strongSupply = params.strongPreferredAvailableCount / Math.max(1, params.maxKeywords)
  const adaptiveRatio = clampNumber(
    baseRatio + strongDensity * 0.12 + strongSupply * 0.08,
    0.08,
    0.45
  )

  let floor = 1
  if (params.maxKeywords >= 12 && params.creativeType !== 'model_intent') floor = 2
  if (params.maxKeywords >= 20 && strongDensity >= 0.35) floor = 3

  const target = Math.ceil(params.maxKeywords * adaptiveRatio)
  return Math.min(params.maxKeywords, params.strongPreferredAvailableCount, Math.max(floor, target))
}

export function isAiSubtype(sourceSubtype: string | undefined): boolean {
  const normalized = String(sourceSubtype || '')
    .trim()
    .toUpperCase()
  if (!normalized) return false
  if (normalized.startsWith('AI_')) return true
  return normalized === 'KEYWORD_EXPANSION'
}

function isAiLlmRawSubtype(sourceSubtype: string | undefined): boolean {
  const normalized = String(sourceSubtype || '')
    .trim()
    .toUpperCase()
  return (
    normalized === 'AI_LLM_RAW' ||
    normalized === 'AI_GENERATED' ||
    normalized === 'AI_FALLBACK_PLACEHOLDER'
  )
}

function isScoringSubtype(sourceSubtype: string | undefined): boolean {
  const normalized = String(sourceSubtype || '')
    .trim()
    .toUpperCase()
  return (
    normalized === 'SCORING_SUGGESTION' ||
    normalized === 'GAP_INDUSTRY_BRANDED' ||
    normalized === 'BRANDED_INDUSTRY_TERM'
  )
}

export function classifyCandidateSource(candidate: RankedCandidate): {
  lowTrust: boolean
  ai: boolean
  aiLlmRaw: boolean
} {
  const sourceSubtype = normalizeKeywordSourceSubtype({
    source: candidate.source,
    sourceType: candidate.sourceSubtype || candidate.sourceType,
  })
  const rawSource = inferKeywordRawSource({
    source: candidate.source,
    sourceType: sourceSubtype || candidate.sourceType,
  })

  const ai = rawSource === 'AI' || isAiSubtype(sourceSubtype)
  const aiLlmRaw = isAiLlmRawSubtype(sourceSubtype)
  const lowTrust = ai || isScoringSubtype(sourceSubtype)

  return {
    lowTrust,
    ai,
    aiLlmRaw,
  }
}

export function classifySourceGovernance(candidate: RankedCandidate): {
  bucket: SourceGovernanceBucket
  top1Eligible: boolean
  top2Eligible: boolean
} {
  const sourceSubtype = normalizeKeywordSourceSubtype({
    source: candidate.source,
    sourceType: candidate.sourceSubtype || candidate.sourceType,
  })
  const tier = getKeywordSourcePriority(
    sourceSubtype || candidate.sourceType || candidate.source
  ).tier

  if (tier === 'T0' || tier === 'T1' || tier === 'T2' || tier === 'DERIVED_TRUSTED') {
    return {
      bucket: 'primary',
      top1Eligible: true,
      top2Eligible: true,
    }
  }

  if (tier === 'T3A' || tier === 'T3B') {
    return {
      bucket: 'conditional',
      top1Eligible: false,
      top2Eligible: true,
    }
  }

  if (tier === 'DERIVED_RESCUE') {
    return {
      bucket: 'rescue',
      top1Eligible: false,
      top2Eligible: true,
    }
  }

  if (tier === 'T4A' || tier === 'T4B' || tier === 'DERIVED_SYNTHETIC') {
    return {
      bucket: 'synthetic',
      top1Eligible: false,
      top2Eligible: false,
    }
  }

  return {
    bucket: 'unknown',
    top1Eligible: false,
    top2Eligible: true,
  }
}

function shouldAllowDeferredRefillCandidate(params: {
  candidate: RankedCandidate
  classification: {
    lowTrust: boolean
    ai: boolean
    aiLlmRaw: boolean
  }
  creativeType: CanonicalCreativeType | null
  fallbackMode: boolean
}): boolean {
  if (!params.classification.lowTrust) return true

  const profile = params.candidate.evidenceProfile
  if (params.creativeType === 'model_intent') {
    if (params.classification.aiLlmRaw && !params.fallbackMode) return false
    if (profile.hasModelAnchor && profile.sourceTrustScore >= 6.5) return true
    if (profile.compactTrustedSoftFamily && profile.sourceTrustScore >= 6) return true
    if (
      profile.hasSpecificDemandTail &&
      profile.sourceTrustScore >= (params.fallbackMode ? 6.4 : 7) &&
      !profile.isAiGenerated
    ) {
      return true
    }
    return false
  }

  if (params.creativeType === 'brand_intent') {
    if (!params.candidate.isBrand || !profile.hasDemand) return false
    if (params.classification.aiLlmRaw && !params.fallbackMode) return false
    return profile.sourceTrustScore >= (params.fallbackMode ? 5 : 5.8)
  }

  if (params.creativeType === 'product_intent') {
    if (params.classification.aiLlmRaw && !params.fallbackMode) return false
    if (
      profile.hasSpecificDemandTail &&
      profile.sourceTrustScore >= (params.fallbackMode ? 5.2 : 6)
    ) {
      return true
    }
    if (
      profile.selectedIntentScore >= 2.5 &&
      profile.sourceTrustScore >= (params.fallbackMode ? 5.5 : 6.2) &&
      !profile.isAiGenerated
    ) {
      return true
    }
    return false
  }

  return profile.sourceTrustScore >= (params.fallbackMode ? 5 : 6)
}

export function applySourceQuotaOnSelectedCandidates(input: {
  selectedList: RankedCandidate[]
  creativeType: CanonicalCreativeType | null
  maxKeywords: number
  requiredBrandCount: number
  requiredPureBrandCount: number
  requiredPreferredBucketCount: number
  fallbackMode: boolean
}): {
  selectedList: RankedCandidate[]
  audit: CreativeKeywordSourceQuotaAudit
} {
  const targetCount = Math.min(input.maxKeywords, input.selectedList.length)
  const quotaSizingMaxKeywords = targetCount > 0 ? targetCount : input.maxKeywords
  const quota = resolveSourceQuotaConfig({
    maxKeywords: quotaSizingMaxKeywords,
    fallbackMode: input.fallbackMode,
    creativeType: input.creativeType,
    rankedCandidates: input.selectedList,
  })
  if (targetCount <= 0) {
    return {
      selectedList: [],
      audit: {
        enabled: true,
        fallbackMode: input.fallbackMode,
        targetCount: 0,
        requiredBrandCount: Math.max(0, input.requiredBrandCount),
        acceptedBrandCount: 0,
        acceptedCount: 0,
        deferredCount: 0,
        deferredRefillCount: 0,
        deferredRefillTriggered: false,
        underfillBeforeRefill: 0,
        quota,
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

  const accepted: RankedCandidate[] = []
  const acceptedNormalized = new Set<string>()
  const deferred: RankedCandidate[] = []
  const preferredReservationCandidates = input.selectedList
    .filter((candidate) => isStrongPreferredBucketCandidate(candidate))
    .sort(compareRankedCandidates)

  let acceptedBrandCount = 0
  let acceptedPureBrandCount = 0
  let acceptedStrongPreferredBucketCount = 0
  let acceptedLowTrustCount = 0
  let acceptedAiCount = 0
  let acceptedAiLlmRawCount = 0
  let blockedLowTrustCount = 0
  let blockedAiCount = 0
  let blockedAiLlmRawCount = 0

  const pushAccepted = (
    candidate: RankedCandidate,
    classification: {
      lowTrust: boolean
      ai: boolean
      aiLlmRaw: boolean
    }
  ): boolean => {
    if (acceptedNormalized.has(candidate.normalized)) return false
    accepted.push(candidate)
    acceptedNormalized.add(candidate.normalized)
    if (candidate.isBrand) acceptedBrandCount += 1
    if (candidate.isPureBrand) acceptedPureBrandCount += 1
    if (isStrongPreferredBucketCandidate(candidate)) acceptedStrongPreferredBucketCount += 1
    if (classification.lowTrust) acceptedLowTrustCount += 1
    if (classification.ai) acceptedAiCount += 1
    if (classification.aiLlmRaw) acceptedAiLlmRawCount += 1
    return true
  }

  if (input.requiredPureBrandCount > 0) {
    for (const candidate of input.selectedList) {
      if (accepted.length >= targetCount) break
      if (acceptedPureBrandCount >= input.requiredPureBrandCount) break
      if (!candidate.isPureBrand) continue
      pushAccepted(candidate, classifyCandidateSource(candidate))
    }
  }

  if (input.requiredBrandCount > 0) {
    for (const candidate of input.selectedList) {
      if (accepted.length >= targetCount) break
      if (acceptedBrandCount >= input.requiredBrandCount) break
      if (!candidate.isBrand) continue
      pushAccepted(candidate, classifyCandidateSource(candidate))
    }
  }

  if (input.requiredPreferredBucketCount > 0) {
    for (const candidate of preferredReservationCandidates) {
      if (accepted.length >= targetCount) break
      if (acceptedStrongPreferredBucketCount >= input.requiredPreferredBucketCount) break
      pushAccepted(candidate, classifyCandidateSource(candidate))
    }
  }

  for (const candidate of input.selectedList) {
    if (accepted.length >= targetCount) break
    if (acceptedNormalized.has(candidate.normalized)) continue
    const classification = classifyCandidateSource(candidate)

    const shouldReserveBrand = candidate.isBrand && acceptedBrandCount < input.requiredBrandCount
    const shouldReservePureBrand =
      candidate.isPureBrand && acceptedPureBrandCount < input.requiredPureBrandCount
    const shouldReservePreferredBucket =
      candidate.isPreferredBucket &&
      isStrongPreferredBucketCandidate(candidate) &&
      acceptedStrongPreferredBucketCount < input.requiredPreferredBucketCount
    if (shouldReserveBrand || shouldReservePureBrand || shouldReservePreferredBucket) {
      pushAccepted(candidate, classification)
      continue
    }

    if (classification.lowTrust && acceptedLowTrustCount >= quota.combinedLowTrustCap) {
      blockedLowTrustCount += 1
      deferred.push(candidate)
      continue
    }
    if (classification.ai && acceptedAiCount >= quota.aiCap) {
      blockedAiCount += 1
      deferred.push(candidate)
      continue
    }
    if (classification.aiLlmRaw && acceptedAiLlmRawCount >= quota.aiLlmRawCap) {
      blockedAiLlmRawCount += 1
      deferred.push(candidate)
      continue
    }

    pushAccepted(candidate, classification)
  }

  // fallback exit: if quota causes underfill, gradually re-introduce deferred items by original order.
  let deferredRefillCount = 0
  const underfillBeforeRefill = Math.max(0, targetCount - accepted.length)
  if (accepted.length < targetCount) {
    for (const candidate of deferred) {
      if (accepted.length >= targetCount) break
      const classification = classifyCandidateSource(candidate)
      if (
        !shouldAllowDeferredRefillCandidate({
          candidate,
          classification,
          creativeType: input.creativeType,
          fallbackMode: input.fallbackMode,
        })
      ) {
        continue
      }
      deferredRefillCount += 1
      pushAccepted(candidate, classification)
    }
  }

  return {
    selectedList: accepted.sort(compareRankedCandidates),
    audit: {
      enabled: true,
      fallbackMode: input.fallbackMode,
      targetCount,
      requiredBrandCount: Math.max(0, input.requiredBrandCount),
      acceptedBrandCount,
      acceptedCount: accepted.length,
      deferredCount: deferred.length,
      deferredRefillCount,
      deferredRefillTriggered: deferredRefillCount > 0,
      underfillBeforeRefill,
      quota,
      acceptedByClass: {
        lowTrust: acceptedLowTrustCount,
        ai: acceptedAiCount,
        aiLlmRaw: acceptedAiLlmRawCount,
      },
      blockedByCap: {
        lowTrust: blockedLowTrustCount,
        ai: blockedAiCount,
        aiLlmRaw: blockedAiLlmRawCount,
      },
    },
  }
}

export function reconcileSourceQuotaAuditWithFinalOutput(input: {
  audit: CreativeKeywordSourceQuotaAudit
  finalCandidates: RankedCandidate[]
}): CreativeKeywordSourceQuotaAudit {
  const finalCandidates = Array.isArray(input.finalCandidates) ? input.finalCandidates : []

  let acceptedBrandCount = 0
  let acceptedLowTrustCount = 0
  let acceptedAiCount = 0
  let acceptedAiLlmRawCount = 0

  for (const candidate of finalCandidates) {
    if (candidate.isBrand) acceptedBrandCount += 1
    const classification = classifyCandidateSource(candidate)
    if (classification.lowTrust) acceptedLowTrustCount += 1
    if (classification.ai) acceptedAiCount += 1
    if (classification.aiLlmRaw) acceptedAiLlmRawCount += 1
  }

  const currentTargetCount = Number(input.audit.targetCount)
  const normalizedTargetCount = Number.isFinite(currentTargetCount)
    ? Math.max(0, Math.floor(currentTargetCount))
    : 0

  return {
    ...input.audit,
    targetCount: Math.max(normalizedTargetCount, finalCandidates.length),
    acceptedBrandCount,
    acceptedCount: finalCandidates.length,
    acceptedByClass: {
      lowTrust: acceptedLowTrustCount,
      ai: acceptedAiCount,
      aiLlmRaw: acceptedAiLlmRawCount,
    },
  }
}

export function enforceModelIntentAiCapOnFinalOutput(params: {
  outputCandidates: RankedCandidate[]
  rankedCandidates: RankedCandidate[]
  quota: SourceQuotaConfig
  brandName: string | undefined
}): RankedCandidate[] {
  const outputCandidates = Array.isArray(params.outputCandidates)
    ? [...params.outputCandidates]
    : []
  if (outputCandidates.length === 0) return outputCandidates

  const aiCap = Math.max(0, Math.floor(Number(params.quota.aiCap || 0)))
  let aiCount = outputCandidates.reduce(
    (count, candidate) => (classifyCandidateSource(candidate).ai ? count + 1 : count),
    0
  )
  if (aiCount <= aiCap) return outputCandidates

  const selectedNormalized = new Set(outputCandidates.map((candidate) => candidate.normalized))
  const selectedPermutationKeys = new Set(
    outputCandidates.map((candidate) => candidate.permutationKey || candidate.normalized)
  )
  const replacementPool = [...params.rankedCandidates]
    .sort(compareRankedCandidates)
    .filter((candidate) => !selectedNormalized.has(candidate.normalized))
    .filter((candidate) => !classifyCandidateSource(candidate).ai)
    .filter((candidate) => {
      if (isModelIntentQualifiedCandidate(candidate, params.brandName)) return true
      if (!candidate.isPreferredBucket) return false
      const profile = candidate.evidenceProfile
      return (
        profile.sourceTrustScore >= 5.5 &&
        (profile.hasSpecificDemandTail ||
          profile.compactTrustedSoftFamily ||
          profile.trustedSoftFamily)
      )
    })

  let replacementCursor = 0
  for (let index = outputCandidates.length - 1; index >= 0 && aiCount > aiCap; index -= 1) {
    const current = outputCandidates[index]
    if (!classifyCandidateSource(current).ai) continue

    let replacement: RankedCandidate | null = null
    while (replacementCursor < replacementPool.length) {
      const next = replacementPool[replacementCursor++]
      const nextPermutationKey = next.permutationKey || next.normalized
      if (selectedNormalized.has(next.normalized)) continue
      if (selectedPermutationKeys.has(nextPermutationKey)) continue
      replacement = next
      break
    }
    if (!replacement) break

    const currentPermutationKey = current.permutationKey || current.normalized
    selectedNormalized.delete(current.normalized)
    selectedPermutationKeys.delete(currentPermutationKey)

    outputCandidates[index] = replacement

    selectedNormalized.add(replacement.normalized)
    selectedPermutationKeys.add(replacement.permutationKey || replacement.normalized)
    aiCount -= 1
  }

  return outputCandidates.sort(compareRankedCandidates)
}
