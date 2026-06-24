/**
 * 创意关键词选择：输出修复、回填与契约 enforcement
 */
import {
  containsPureBrand,
  getPureBrandKeywords,
  isPureBrandKeyword,
} from '../brand/brand-keyword-utils'
import {
  hasModelAnchorEvidence,
  containsAsinLikeToken,
  type CanonicalCreativeType,
} from '../../creatives/server'
import { resolveCreativeKeywordMinimumOutputCount } from './creative-keyword-output-floor'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'

import {
  CREATIVE_BRAND_KEYWORD_RESERVE,
  MODEL_INTENT_BRAND_FLOOR,
  PRODUCT_INTENT_BRAND_FLOOR,
  PRODUCT_INTENT_NON_BRAND_FLOOR,
  type CreativeKeywordLike,
  type SelectCreativeKeywordsInput,
  type SourceGovernanceBucket,
  type RankedCandidate,
  type CreativeBucket,
  PLATFORM_PATTERN,
  COMMUNITY_PATTERN,
  INFO_QUERY_PATTERN,
  QUESTION_PREFIX_PATTERN,
  REVIEW_COMPARE_PATTERN,
  MODEL_INTENT_GENERIC_SPILLOVER_PATTERN,
} from './creative-keyword-selection-types'
import {
  compareRankedCandidates,
  buildRankedCandidate,
  isLowQualityCandidate,
  hasActiveSearchVolumeUnavailableFlag,
  isCompactTrustedModelIntentSoftFamilyCandidate,
  normalizeCompactedBrandKeyword,
  countProductIntentDemandCandidates,
  isProductIntentDemandCandidate,
  isModelIntentQualifiedCandidate,
  findProductIntentReplacementIndex,
  findModelIntentReplacementIndex,
  countModelIntentQualifiedCandidates,
  isDirectProductAnchorCandidate,
  isAdjacentGenericProductCandidate,
  isModelIntentPreferredFallbackCandidate,
  hasRepeatedDemandAnchorToken,
  preferNonAiTwinCandidate,
  compactDemandSemanticDuplicates,
  isModelIntentRescueKeyword,
  getDemandAnchorTokens,
} from './creative-keyword-candidate'
import { classifySourceGovernance } from './creative-keyword-source-quota'

export function dedupeRankedCandidatePool(candidates: RankedCandidate[]): RankedCandidate[] {
  const deduped = new Map<string, RankedCandidate>()
  for (const candidate of candidates) {
    const existing = deduped.get(candidate.normalized)
    if (!existing || compareRankedCandidates(candidate, existing) < 0) {
      deduped.set(candidate.normalized, candidate)
    }
  }
  return Array.from(deduped.values())
}

export function compareFinalOutputCandidates(
  a: RankedCandidate,
  b: RankedCandidate,
  params: {
    creativeType: CanonicalCreativeType | null
    brandName: string | undefined
  }
): number {
  if (params.creativeType === 'product_intent') {
    const aDirect = isDirectProductAnchorCandidate(a, params.brandName)
    const bDirect = isDirectProductAnchorCandidate(b, params.brandName)
    if (aDirect !== bDirect) return Number(bDirect) - Number(aDirect)

    const aAdjacent = isAdjacentGenericProductCandidate(a, params.brandName)
    const bAdjacent = isAdjacentGenericProductCandidate(b, params.brandName)
    if (aAdjacent !== bAdjacent) return Number(aAdjacent) - Number(bAdjacent)
  }

  const aGovernance = classifySourceGovernance(a)
  const bGovernance = classifySourceGovernance(b)
  const governanceOrder: Record<SourceGovernanceBucket, number> = {
    primary: 0,
    conditional: 1,
    rescue: 2,
    unknown: 3,
    synthetic: 4,
  }
  if (governanceOrder[aGovernance.bucket] !== governanceOrder[bGovernance.bucket]) {
    return governanceOrder[aGovernance.bucket] - governanceOrder[bGovernance.bucket]
  }

  return compareRankedCandidates(a, b)
}

export function repairProductIntentFrontload(params: {
  selected: RankedCandidate[]
  candidatePool: RankedCandidate[]
  brandName: string | undefined
}): RankedCandidate[] {
  const working = [...params.selected]
  const available = params.candidatePool.filter(
    (candidate) => !working.some((item) => item.normalized === candidate.normalized)
  )

  const takeReplacement = (
    predicate: (candidate: RankedCandidate) => boolean
  ): RankedCandidate | null => {
    const index = available.findIndex(predicate)
    if (index < 0) return null
    const [candidate] = available.splice(index, 1)
    return candidate || null
  }

  if (working[0] && isAdjacentGenericProductCandidate(working[0], params.brandName)) {
    const top1Replacement = takeReplacement(
      (candidate) => !isAdjacentGenericProductCandidate(candidate, params.brandName)
    )
    if (top1Replacement) working.splice(0, 1, top1Replacement)
  }

  const maxTop3 = Math.min(3, working.length)
  let top3DirectCount = working
    .slice(0, maxTop3)
    .filter((candidate) => isDirectProductAnchorCandidate(candidate, params.brandName)).length
  const requiredTop3Direct = Math.min(2, maxTop3)

  while (top3DirectCount < requiredTop3Direct) {
    const replacement = takeReplacement((candidate) =>
      isDirectProductAnchorCandidate(candidate, params.brandName)
    )
    if (!replacement) break

    let replaceIndex = -1
    for (let index = maxTop3 - 1; index >= 0; index -= 1) {
      if (!isDirectProductAnchorCandidate(working[index], params.brandName)) {
        replaceIndex = index
        break
      }
    }
    if (replaceIndex < 0) break
    working.splice(replaceIndex, 1, replacement)
    top3DirectCount += 1
  }

  let adjacentTop3Count = working
    .slice(0, maxTop3)
    .filter((candidate) => isAdjacentGenericProductCandidate(candidate, params.brandName)).length
  while (adjacentTop3Count > 1) {
    const replacement = takeReplacement(
      (candidate) => !isAdjacentGenericProductCandidate(candidate, params.brandName)
    )
    if (!replacement) break

    let replaceIndex = -1
    for (let index = maxTop3 - 1; index >= 0; index -= 1) {
      if (isAdjacentGenericProductCandidate(working[index], params.brandName)) {
        replaceIndex = index
        break
      }
    }
    if (replaceIndex < 0) break
    working.splice(replaceIndex, 1, replacement)
    adjacentTop3Count -= 1
  }

  return working
}

export function repairGovernanceFrontSlots(params: {
  creativeType: CanonicalCreativeType | null
  selected: RankedCandidate[]
  candidatePool: RankedCandidate[]
  brandName: string | undefined
}): RankedCandidate[] {
  const working = [...params.selected]
  const available = params.candidatePool.filter(
    (candidate) => !working.some((item) => item.normalized === candidate.normalized)
  )

  const topSlotPredicates = [
    (candidate: RankedCandidate) => classifySourceGovernance(candidate).top1Eligible,
    (candidate: RankedCandidate) => classifySourceGovernance(candidate).top2Eligible,
  ]

  for (let slot = 0; slot < Math.min(2, working.length); slot += 1) {
    if (topSlotPredicates[slot]?.(working[slot])) continue

    const replacementIndex = available.findIndex((candidate) =>
      topSlotPredicates[slot]?.(candidate)
    )
    if (replacementIndex < 0) continue

    const [replacement] = available.splice(replacementIndex, 1)
    if (!replacement) continue
    working.splice(slot, 1, replacement)
  }

  return working.sort((left, right) =>
    compareFinalOutputCandidates(left, right, {
      creativeType: params.creativeType,
      brandName: params.brandName,
    })
  )
}

function isRescueCapExemptCandidate(
  candidate: RankedCandidate,
  creativeType: CanonicalCreativeType | null,
  brandName: string | undefined
): boolean {
  if (classifySourceGovernance(candidate).bucket !== 'rescue') return false
  if (candidate.isPureBrand) return true

  if (creativeType === 'brand_intent') {
    return candidate.isBrand && candidate.evidenceProfile.hasDemand
  }

  if (creativeType === 'product_intent') {
    return (
      isDirectProductAnchorCandidate(candidate, brandName) ||
      isProductIntentDemandCandidate(candidate, brandName)
    )
  }

  if (creativeType === 'model_intent') {
    return isModelIntentQualifiedCandidate(candidate, brandName)
  }

  return false
}

function isModelIntentFinalEligibleCandidate(params: {
  candidate: RankedCandidate
  brandName: string | undefined
  preserveOutput: boolean
  allowPreferredBucketFallback: boolean
}): boolean {
  if (isModelIntentQualifiedCandidate(params.candidate, params.brandName)) return true

  if (
    (params.preserveOutput || params.allowPreferredBucketFallback) &&
    isModelIntentPreferredFallbackCandidate(params.candidate, params.brandName)
  ) {
    return true
  }

  return false
}

export function enforceFinalOutputInvariants(params: {
  creativeType: CanonicalCreativeType | null
  outputCandidates: RankedCandidate[]
  rankedCandidates: RankedCandidate[]
  brandName: string | undefined
  maxKeywords: number
  fallbackMode: boolean
  requiredBrandCount: number
  requiredPureBrandCount: number
  brandOnly: boolean
}): RankedCandidate[] {
  const preservedOutput = dedupeRankedCandidatePool(params.outputCandidates)
  const preservedOutputSet = new Set(preservedOutput.map((candidate) => candidate.normalized))
  const combinedPool = dedupeRankedCandidatePool([...preservedOutput, ...params.rankedCandidates])
  const strictModelIntentQualifiedCount =
    params.creativeType === 'model_intent'
      ? combinedPool.filter((candidate) =>
          isModelIntentQualifiedCandidate(candidate, params.brandName)
        ).length
      : 0
  const allowPreferredBucketFallback =
    params.creativeType === 'model_intent' &&
    strictModelIntentQualifiedCount < Math.min(params.maxKeywords, combinedPool.length)

  const isValidFinalCandidate = (candidate: RankedCandidate, preserveOutput: boolean): boolean => {
    if (containsAsinLikeToken(candidate.keyword)) return false
    if (candidate.evidenceProfile.unauthorizedContentRatio > 0) return false
    if (
      params.creativeType === 'model_intent' &&
      !isModelIntentFinalEligibleCandidate({
        candidate,
        brandName: params.brandName,
        preserveOutput,
        allowPreferredBucketFallback,
      })
    ) {
      return false
    }
    return true
  }

  const sortedPool = combinedPool
    .filter((candidate) =>
      isValidFinalCandidate(candidate, preservedOutputSet.has(candidate.normalized))
    )
    .sort((left, right) =>
      compareFinalOutputCandidates(left, right, {
        creativeType: params.creativeType,
        brandName: params.brandName,
      })
    )
  if (sortedPool.length === 0) return []

  const sortedPreservedOutput = preservedOutput
    .filter((candidate) => isValidFinalCandidate(candidate, true))
    .sort((left, right) =>
      compareFinalOutputCandidates(left, right, {
        creativeType: params.creativeType,
        brandName: params.brandName,
      })
    )
  const effectivePreservedOutput = params.brandOnly
    ? sortedPreservedOutput.filter((candidate) => candidate.isBrand)
    : sortedPreservedOutput
  const effectivePool = params.brandOnly
    ? sortedPool.filter((candidate) => candidate.isBrand)
    : sortedPool
  if (effectivePool.length === 0) return []

  const desiredCount = Math.min(params.maxKeywords, effectivePool.length)
  const rescueCap =
    desiredCount < 4 ? Math.min(1, desiredCount) : Math.max(1, Math.floor(desiredCount * 0.3))
  const syntheticCap = params.fallbackMode ? Math.min(1, desiredCount) : 0

  const selected: RankedCandidate[] = [...effectivePreservedOutput]
  const selectedKeys = new Set(selected.map((candidate) => candidate.normalized))
  let selectedRescueCount = selected.filter(
    (candidate) =>
      classifySourceGovernance(candidate).bucket === 'rescue' &&
      !isRescueCapExemptCandidate(candidate, params.creativeType, params.brandName)
  ).length
  let selectedSyntheticCount = selected.filter(
    (candidate) => classifySourceGovernance(candidate).bucket === 'synthetic'
  ).length

  const canSelect = (candidate: RankedCandidate, relaxedTopSlot: boolean): boolean => {
    const governance = classifySourceGovernance(candidate)
    if (!relaxedTopSlot) {
      if (selected.length === 0 && !governance.top1Eligible) return false
      if (selected.length === 1 && !governance.top2Eligible) return false
    }
    if (
      governance.bucket === 'rescue' &&
      !isRescueCapExemptCandidate(candidate, params.creativeType, params.brandName) &&
      selectedRescueCount >= rescueCap
    ) {
      return false
    }
    if (governance.bucket === 'synthetic' && selectedSyntheticCount >= syntheticCap) return false
    return true
  }

  const pushSelected = (candidate: RankedCandidate): void => {
    selected.push(candidate)
    selectedKeys.add(candidate.normalized)
    const governance = classifySourceGovernance(candidate)
    if (
      governance.bucket === 'rescue' &&
      !isRescueCapExemptCandidate(candidate, params.creativeType, params.brandName)
    ) {
      selectedRescueCount += 1
    }
    if (governance.bucket === 'synthetic') selectedSyntheticCount += 1
  }

  const supplementalPool = effectivePool.filter(
    (candidate) => !selectedKeys.has(candidate.normalized)
  )
  if (selected.length < desiredCount) {
    for (const relaxedTopSlot of [false, true]) {
      for (const candidate of supplementalPool) {
        if (selected.length >= desiredCount) break
        if (selectedKeys.has(candidate.normalized)) continue
        if (!canSelect(candidate, relaxedTopSlot)) continue
        pushSelected(candidate)
      }
      if (selected.length >= desiredCount) break
    }
  }

  let normalizedSelected = repairGovernanceFrontSlots({
    creativeType: params.creativeType,
    selected: selected.sort((left, right) =>
      compareFinalOutputCandidates(left, right, {
        creativeType: params.creativeType,
        brandName: params.brandName,
      })
    ),
    candidatePool: effectivePool,
    brandName: params.brandName,
  })

  const enforceCoverageFloor = (
    working: RankedCandidate[],
    pool: RankedCandidate[],
    targetCount: number,
    matcher: (candidate: RankedCandidate) => boolean,
    replaceable: (candidate: RankedCandidate) => boolean
  ): RankedCandidate[] => {
    const next = [...working]
    const currentCount = next.filter(matcher).length
    if (currentCount >= targetCount) return next

    const replacements = pool.filter(
      (candidate) =>
        matcher(candidate) && !next.some((item) => item.normalized === candidate.normalized)
    )
    let missing = targetCount - currentCount
    for (const replacement of replacements) {
      if (missing <= 0) break
      let replaceIndex = -1
      for (let index = next.length - 1; index >= 0; index -= 1) {
        if (replaceable(next[index])) {
          replaceIndex = index
          break
        }
      }
      if (replaceIndex < 0) break
      next.splice(replaceIndex, 1, replacement)
      missing -= 1
    }
    return next
  }

  let trimmedSelected = normalizedSelected.slice(0, params.maxKeywords)
  if (params.requiredPureBrandCount > 0) {
    trimmedSelected = enforceCoverageFloor(
      trimmedSelected,
      effectivePool,
      Math.min(
        params.requiredPureBrandCount,
        trimmedSelected.length || params.requiredPureBrandCount
      ),
      (candidate) => candidate.isPureBrand,
      (candidate) => !candidate.isPureBrand
    )
  }
  if (params.requiredBrandCount > 0) {
    trimmedSelected = enforceCoverageFloor(
      trimmedSelected,
      effectivePool,
      Math.min(
        params.requiredBrandCount,
        Math.max(trimmedSelected.length, params.requiredBrandCount)
      ),
      (candidate) => candidate.isBrand,
      (candidate) => !candidate.isBrand
    )
  }

  if (params.creativeType === 'product_intent') {
    return repairProductIntentFrontload({
      selected: trimmedSelected,
      candidatePool: effectivePool,
      brandName: params.brandName,
    }).slice(0, params.maxKeywords)
  }

  return trimmedSelected
}

export function rebalanceModelIntentCandidates(input: {
  selectedList: RankedCandidate[]
  maxKeywords: number
  brandName?: string
  rankedCandidates?: RankedCandidate[]
}): RankedCandidate[] {
  const selectedList = Array.isArray(input.selectedList) ? input.selectedList : []
  if (selectedList.length <= 1) return selectedList

  const allRankedCandidates = Array.isArray(input.rankedCandidates) ? input.rankedCandidates : []
  const compactSoftFamilyUniverse = allRankedCandidates
    .filter(
      (candidate) =>
        !hasModelAnchorEvidence({ keywords: [candidate.keyword] }) &&
        isCompactTrustedModelIntentSoftFamilyCandidate(candidate, input.brandName)
    )
    .sort(compareRankedCandidates)
  const desiredSoftFamilyCount = Math.min(
    compactSoftFamilyUniverse.length,
    Math.max(2, Math.min(6, Math.floor(input.maxKeywords * 0.2)))
  )
  const selectedCompactSoftFamilyCount = selectedList.filter(
    (candidate) =>
      !hasModelAnchorEvidence({ keywords: [candidate.keyword] }) &&
      isCompactTrustedModelIntentSoftFamilyCandidate(candidate, input.brandName)
  ).length

  let workingSelectedList = selectedList
  if (desiredSoftFamilyCount > selectedCompactSoftFamilyCount) {
    const missingSoftFamilyCandidates = compactSoftFamilyUniverse
      .filter((candidate) => !selectedList.some((item) => item.normalized === candidate.normalized))
      .slice(0, desiredSoftFamilyCount - selectedCompactSoftFamilyCount)

    if (missingSoftFamilyCandidates.length > 0) {
      const replaced = [...selectedList].sort(compareRankedCandidates)
      let currentModelCount = replaced.filter((candidate) =>
        hasModelAnchorEvidence({ keywords: [candidate.keyword] })
      ).length
      const minModelCount = Math.max(
        3,
        Math.min(replaced.length, input.maxKeywords - desiredSoftFamilyCount)
      )

      for (const addition of missingSoftFamilyCandidates) {
        let replaceIndex = -1
        for (let index = replaced.length - 1; index >= 0; index -= 1) {
          const candidate = replaced[index]
          if (isCompactTrustedModelIntentSoftFamilyCandidate(candidate, input.brandName)) continue
          const hasModelAnchor = hasModelAnchorEvidence({ keywords: [candidate.keyword] })
          if (hasModelAnchor && currentModelCount <= minModelCount) continue
          replaceIndex = index
          break
        }
        if (replaceIndex < 0) break

        if (hasModelAnchorEvidence({ keywords: [replaced[replaceIndex].keyword] })) {
          currentModelCount -= 1
        }
        replaced[replaceIndex] = addition
      }

      workingSelectedList = replaced
    }
  }

  const modelCandidates = workingSelectedList
    .filter((candidate) => hasModelAnchorEvidence({ keywords: [candidate.keyword] }))
    .sort(compareRankedCandidates)
  if (modelCandidates.length === 0) return workingSelectedList

  const nonModelCandidates = workingSelectedList
    .filter((candidate) => !hasModelAnchorEvidence({ keywords: [candidate.keyword] }))
    .sort(compareRankedCandidates)
  if (nonModelCandidates.length === 0) return workingSelectedList

  const compactSoftFamilyCandidates = nonModelCandidates.filter((candidate) =>
    isCompactTrustedModelIntentSoftFamilyCandidate(candidate, input.brandName)
  )
  const maxNonModelCount = Math.max(6, Math.floor(input.maxKeywords * 0.2))
  if (nonModelCandidates.length <= maxNonModelCount) return workingSelectedList
  if (compactSoftFamilyCandidates.length === 0) {
    return [...modelCandidates, ...nonModelCandidates.slice(0, maxNonModelCount)]
      .sort(compareRankedCandidates)
      .slice(0, input.maxKeywords)
  }

  const compactSoftFamilySet = new Set(
    compactSoftFamilyCandidates.map((candidate) => candidate.normalized)
  )
  const genericNonModelCandidates = nonModelCandidates
    .filter((candidate) => !compactSoftFamilySet.has(candidate.normalized))
    .sort(compareRankedCandidates)

  const genericBudgetCap = Math.min(
    maxNonModelCount,
    Math.max(2, Math.floor(maxNonModelCount * 0.3))
  )
  const softFamilyReserve = Math.min(
    maxNonModelCount,
    Math.max(3, maxNonModelCount - genericBudgetCap)
  )
  const prioritizedSoftFamily = compactSoftFamilyCandidates.slice(0, softFamilyReserve)
  const remainingSoftFamily = compactSoftFamilyCandidates.slice(prioritizedSoftFamily.length)
  const remainingBudget = Math.max(0, maxNonModelCount - prioritizedSoftFamily.length)
  const genericBudget =
    compactSoftFamilyCandidates.length > softFamilyReserve
      ? Math.min(remainingBudget, genericBudgetCap)
      : remainingBudget
  const selectedGeneric = genericNonModelCandidates.slice(0, genericBudget)
  const leftoverBudget = Math.max(
    0,
    maxNonModelCount - prioritizedSoftFamily.length - selectedGeneric.length
  )

  return [
    ...modelCandidates,
    ...prioritizedSoftFamily,
    ...selectedGeneric,
    ...remainingSoftFamily.slice(0, leftoverBudget),
  ]
    .sort(compareRankedCandidates)
    .slice(0, input.maxKeywords)
}

export function resolveCreativeKeywordContractDefaults(params: {
  creativeType: CanonicalCreativeType | null
  maxKeywords: number
}): {
  brandReserve: number
  minBrandKeywords: number
  requiredPureBrandCount: number
  minProductDemandCount: number
  minModelIntentQualifiedCount: number
} {
  if (params.creativeType === 'brand_intent') {
    return {
      brandReserve: CREATIVE_BRAND_KEYWORD_RESERVE,
      minBrandKeywords: CREATIVE_BRAND_KEYWORD_RESERVE,
      requiredPureBrandCount: Math.min(1, params.maxKeywords),
      minProductDemandCount: 0,
      minModelIntentQualifiedCount: 0,
    }
  }

  if (params.creativeType === 'model_intent') {
    const brandFloor = Math.min(MODEL_INTENT_BRAND_FLOOR, params.maxKeywords)
    const minModelIntentQualifiedCount = Math.min(
      4,
      Math.max(1, Math.ceil(Math.max(1, params.maxKeywords) * 0.25))
    )
    return {
      brandReserve: brandFloor,
      minBrandKeywords: brandFloor,
      requiredPureBrandCount: 0,
      minProductDemandCount: 0,
      minModelIntentQualifiedCount,
    }
  }

  if (params.creativeType === 'product_intent') {
    return {
      brandReserve: Math.min(PRODUCT_INTENT_BRAND_FLOOR, params.maxKeywords),
      minBrandKeywords: Math.min(PRODUCT_INTENT_BRAND_FLOOR, params.maxKeywords),
      requiredPureBrandCount: Math.min(1, params.maxKeywords),
      minProductDemandCount: Math.min(
        PRODUCT_INTENT_NON_BRAND_FLOOR,
        Math.max(0, params.maxKeywords - 1)
      ),
      minModelIntentQualifiedCount: 0,
    }
  }

  return {
    brandReserve: CREATIVE_BRAND_KEYWORD_RESERVE,
    minBrandKeywords: CREATIVE_BRAND_KEYWORD_RESERVE,
    requiredPureBrandCount: 0,
    minProductDemandCount: 0,
    minModelIntentQualifiedCount: 0,
  }
}

export function enforceCreativeKeywordContract(input: {
  creativeType: CanonicalCreativeType | null
  selectedList: RankedCandidate[]
  rankedCandidates: RankedCandidate[]
  brandName: string | undefined
  maxKeywords: number
  requiredPureBrandCount: number
  minProductDemandCount: number
  minModelIntentQualifiedCount: number
}): RankedCandidate[] {
  let working = Array.isArray(input.selectedList) ? [...input.selectedList] : []
  if (working.length === 0) return working

  if (input.creativeType === 'product_intent' && input.minProductDemandCount > 0) {
    const seen = new Set(working.map((candidate) => candidate.normalized))
    const rescueCandidates = input.rankedCandidates
      .filter(
        (candidate) =>
          !seen.has(candidate.normalized) &&
          isProductIntentDemandCandidate(candidate, input.brandName)
      )
      .sort(compareRankedCandidates)

    let demandCount = countProductIntentDemandCandidates(working, input.brandName)
    for (const rescueCandidate of rescueCandidates) {
      if (demandCount >= input.minProductDemandCount) break

      if (working.length < input.maxKeywords) {
        working.push(rescueCandidate)
        seen.add(rescueCandidate.normalized)
        demandCount += 1
        continue
      }

      const replacementIndex = findProductIntentReplacementIndex({
        candidates: working,
        requiredPureBrandCount: input.requiredPureBrandCount,
        brandName: input.brandName,
      })
      if (replacementIndex < 0) break

      seen.delete(working[replacementIndex].normalized)
      working.splice(replacementIndex, 1, rescueCandidate)
      seen.add(rescueCandidate.normalized)
      demandCount = countProductIntentDemandCandidates(working, input.brandName)
    }
  }

  if (input.creativeType === 'model_intent' && input.minModelIntentQualifiedCount > 0) {
    const seen = new Set(working.map((candidate) => candidate.normalized))
    const rescueCandidates = input.rankedCandidates
      .filter(
        (candidate) =>
          !seen.has(candidate.normalized) &&
          isModelIntentQualifiedCandidate(candidate, input.brandName)
      )
      .sort(compareRankedCandidates)

    let qualifiedCount = countModelIntentQualifiedCandidates(working, input.brandName)
    for (const rescueCandidate of rescueCandidates) {
      if (qualifiedCount >= input.minModelIntentQualifiedCount) break

      if (working.length < input.maxKeywords) {
        working.push(rescueCandidate)
        seen.add(rescueCandidate.normalized)
        qualifiedCount += 1
        continue
      }

      const replacementIndex = findModelIntentReplacementIndex({
        candidates: working,
        brandName: input.brandName,
      })
      if (replacementIndex < 0) break

      seen.delete(working[replacementIndex].normalized)
      working.splice(replacementIndex, 1, rescueCandidate)
      seen.add(rescueCandidate.normalized)
      qualifiedCount = countModelIntentQualifiedCandidates(working, input.brandName)
    }
  }

  return working.sort(compareRankedCandidates).slice(0, input.maxKeywords)
}

function composeBrandedKeyword(
  keyword: string,
  normalizedBrand: string,
  maxWords: number
): string | null {
  const brandTokens = normalizedBrand.split(/\s+/).filter(Boolean)
  if (brandTokens.length === 0) return null

  const normalizedKeyword = normalizeGoogleAdsKeyword(keyword)
  if (!normalizedKeyword) return null
  const keywordTokens = normalizedKeyword.split(/\s+/).filter(Boolean)
  if (keywordTokens.length === 0) return null

  const remainder: string[] = []
  for (let i = 0; i < keywordTokens.length; ) {
    let matchesBrand = true
    for (let j = 0; j < brandTokens.length; j += 1) {
      if (keywordTokens[i + j] !== brandTokens[j]) {
        matchesBrand = false
        break
      }
    }

    if (matchesBrand) {
      i += brandTokens.length
      continue
    }

    remainder.push(keywordTokens[i])
    i += 1
  }

  const combinedTokens = [...brandTokens, ...remainder]
  if (combinedTokens.length < 2 || combinedTokens.length > maxWords) return null
  return combinedTokens.join(' ')
}

function shouldGenerateCompactBrandedVariant(
  candidate: RankedCandidate,
  creativeType: CanonicalCreativeType | null,
  brandName: string | undefined
): boolean {
  if (candidate.isBrand || candidate.isPureBrand) return false
  if (containsAsinLikeToken(candidate.keyword)) return false
  const profile = candidate.evidenceProfile
  if (!profile.hasDemand && !profile.hasModelAnchor) return false
  if (profile.selectedIntentScore < 1) return false
  if (profile.sourceTrustScore < 5.5 && candidate.searchVolume <= 0) return false
  if (profile.isAiGenerated && profile.sourceTrustScore < 6.5) return false
  if (hasRepeatedDemandAnchorToken(candidate.normalized, brandName)) return false

  if (creativeType === 'model_intent') {
    if (
      !profile.hasModelAnchor &&
      !profile.compactTrustedSoftFamily &&
      !profile.hasSpecificDemandTail
    ) {
      return false
    }
    if (MODEL_INTENT_GENERIC_SPILLOVER_PATTERN.test(candidate.normalized)) return false
  }

  return true
}

export function ensureBrandCoverage(
  candidates: RankedCandidate[],
  input: SelectCreativeKeywordsInput,
  maxWords: number,
  targetBrandCount: number
): RankedCandidate[] {
  if (targetBrandCount <= 0) return candidates

  const normalizedBrand = normalizeGoogleAdsKeyword(input.brandName || '')
  if (!normalizedBrand || normalizedBrand === 'unknown') return candidates

  const pureBrandKeywords = getPureBrandKeywords(normalizedBrand)
  if (pureBrandKeywords.length === 0) return candidates

  const existing = new Set(candidates.map((candidate) => candidate.normalized))
  const existingBrandCount = candidates.filter((candidate) => candidate.isBrand).length
  if (existingBrandCount >= targetBrandCount) return candidates

  const nonBrandCandidates = candidates
    .filter((candidate) =>
      shouldGenerateCompactBrandedVariant(candidate, input.creativeType || null, input.brandName)
    )
    .sort(compareRankedCandidates)

  const augmented: RankedCandidate[] = [...candidates]
  let nextIndex =
    candidates.reduce((max, candidate) => Math.max(max, candidate.originalIndex), -1) + 1
  let brandCount = existingBrandCount

  for (const candidate of nonBrandCandidates) {
    if (brandCount >= targetBrandCount) break

    const brandedKeyword = composeBrandedKeyword(candidate.keyword, normalizedBrand, maxWords)
    if (!brandedKeyword) continue

    const normalized = normalizeGoogleAdsKeyword(brandedKeyword)
    if (!normalized || existing.has(normalized)) continue

    const wordCount = normalized.split(/\s+/).filter(Boolean).length || 1
    if (wordCount > maxWords) continue

    const isBrand = containsPureBrand(brandedKeyword, pureBrandKeywords)
    if (!isBrand) continue

    const isPureBrand = isPureBrandKeyword(brandedKeyword, pureBrandKeywords)
    const augmentedCandidate = buildRankedCandidate({
      candidate: {
        ...candidate,
        keyword: brandedKeyword,
        searchVolume: 0,
      },
      keyword: brandedKeyword,
      normalized,
      originalIndex: nextIndex,
      isBrand: true,
      isPureBrand,
      isPreferredBucket: false,
      creativeType: input.creativeType || null,
      bucket: input.bucket,
      brandName: input.brandName,
      targetLanguage: input.targetLanguage,
      wordCount,
      allowModelIntentSoftFamilyFallback: false,
      disableVolumeReliance: Boolean(input.fallbackMode),
    })
    const weakVariant = isLowQualityCandidate(
      augmentedCandidate,
      input.creativeType || null,
      input.brandName,
      {
        targetLanguage: input.targetLanguage,
        allowModelIntentPreferredFallback: false,
        allowModelIntentSoftFamilyFallback: false,
        disableVolumeReliance: Boolean(input.fallbackMode),
      }
    )
    if (weakVariant) continue

    // 品牌前置后的关键词需要重新查询真实搜索量，先以 0 进入选择层。
    augmented.push(augmentedCandidate)
    nextIndex += 1
    brandCount += 1
    existing.add(normalized)
  }

  return augmented
}

export function ensurePureBrandCoverage(
  candidates: RankedCandidate[],
  input: SelectCreativeKeywordsInput,
  maxWords: number,
  targetPureBrandCount: number
): RankedCandidate[] {
  if (targetPureBrandCount <= 0) return candidates
  if (input.creativeType !== 'brand_intent' && input.creativeType !== 'product_intent')
    return candidates

  const normalizedBrand = normalizeGoogleAdsKeyword(input.brandName || '')
  if (!normalizedBrand || normalizedBrand === 'unknown') return candidates

  const pureBrandKeywords = getPureBrandKeywords(normalizedBrand)
  if (pureBrandKeywords.length === 0) return candidates

  const existing = new Set(candidates.map((candidate) => candidate.normalized))
  const existingPureBrandCount = candidates.filter((candidate) => candidate.isPureBrand).length
  if (existingPureBrandCount >= targetPureBrandCount) return candidates

  const augmented: RankedCandidate[] = [...candidates]
  let nextIndex =
    candidates.reduce((max, candidate) => Math.max(max, candidate.originalIndex), -1) + 1
  let pureBrandCount = existingPureBrandCount

  for (const keyword of pureBrandKeywords) {
    if (pureBrandCount >= targetPureBrandCount) break

    const normalized = normalizeGoogleAdsKeyword(keyword)
    if (!normalized || existing.has(normalized)) continue

    const wordCount = normalized.split(/\s+/).filter(Boolean).length || 1
    if (wordCount > maxWords) continue

    const pureBrandSeed = buildRankedCandidate({
      candidate: {
        keyword,
        searchVolume: 0,
        source: 'BRAND_SEED',
        matchType: 'PHRASE',
        sourceType: 'BRAND_SEED',
        sourceField: 'brand',
        anchorType: 'brand',
        evidence: pureBrandKeywords.slice(0, 2),
        suggestedMatchType: 'PHRASE',
        confidence: 0.88,
        qualityReason: '纯品牌词兜底保留',
      },
      keyword,
      normalized,
      originalIndex: nextIndex,
      isBrand: true,
      isPureBrand: true,
      isPreferredBucket: false,
      creativeType: input.creativeType || null,
      bucket: input.bucket,
      brandName: input.brandName,
      targetLanguage: input.targetLanguage,
      wordCount,
    })
    augmented.push(pureBrandSeed)
    nextIndex += 1
    pureBrandCount += 1
    existing.add(normalized)
  }

  return augmented
}

export function toRankedCandidates(
  input: SelectCreativeKeywordsInput,
  maxWords: number,
  options?: {
    allowModelIntentPreferredFallback?: boolean
    allowModelIntentSoftFamilyFallback?: boolean
    disableVolumeReliance?: boolean
  }
): RankedCandidate[] {
  const normalizedBrand = normalizeGoogleAdsKeyword(input.brandName || '')
  const pureBrandKeywords =
    normalizedBrand && normalizedBrand !== 'unknown' ? getPureBrandKeywords(normalizedBrand) : []

  const merged: CreativeKeywordLike[] = []
  const disableVolumeReliance = Boolean(
    options?.disableVolumeReliance ||
    input.fallbackMode ||
    input.keywordsWithVolume?.some((item) => hasActiveSearchVolumeUnavailableFlag(item as any))
  )
  const preferredBucketSet = new Set(
    (Array.isArray(input.preferredBucketKeywords) ? input.preferredBucketKeywords : [])
      .map((keyword) => normalizeGoogleAdsKeyword(keyword))
      .filter((keyword): keyword is string => Boolean(keyword))
  )

  if (Array.isArray(input.keywordsWithVolume)) {
    for (const item of input.keywordsWithVolume) {
      if (!item || typeof item !== 'object') continue
      merged.push({
        keyword: String(item.keyword || '').trim(),
        searchVolume: Number(item.searchVolume || 0) || 0,
        competition: item.competition,
        competitionIndex: item.competitionIndex,
        source: item.source,
        matchType: item.matchType,
        sourceType: item.sourceType,
        sourceSubtype: item.sourceSubtype,
        rawSource: item.rawSource,
        derivedTags: item.derivedTags,
        sourceField: item.sourceField,
        anchorType: item.anchorType,
        evidence: item.evidence,
        suggestedMatchType: item.suggestedMatchType,
        confidence: item.confidence,
        qualityReason: item.qualityReason,
        rejectionReason: item.rejectionReason,
        lowTopPageBid: item.lowTopPageBid,
        highTopPageBid: item.highTopPageBid,
        volumeUnavailableReason: item.volumeUnavailableReason,
      })
    }
  }

  if (Array.isArray(input.keywords)) {
    for (const rawKeyword of input.keywords) {
      const keyword = String(rawKeyword || '').trim()
      if (!keyword) continue
      merged.push({
        keyword,
        searchVolume: 0,
        source: 'AI_GENERATED',
        matchType: 'PHRASE',
        sourceType: 'AI_LLM_RAW',
        sourceSubtype: 'AI_LLM_RAW',
        rawSource: 'AI',
        derivedTags: ['AI_LLM_RAW'],
        sourceField: 'ai',
        suggestedMatchType: 'PHRASE',
      })
    }
  }

  const dedupedByNormalized = new Map<string, RankedCandidate>()
  for (let i = 0; i < merged.length; i += 1) {
    const candidate = merged[i]
    const rawKeyword = String(candidate.keyword || '').trim()
    if (!rawKeyword) continue

    const keyword = normalizeCompactedBrandKeyword(rawKeyword, input.brandName)
    if (!keyword) continue

    const normalized = normalizeGoogleAdsKeyword(keyword)
    if (!normalized) continue
    const wordCount = normalized.split(/\s+/).filter(Boolean).length || 1
    if (wordCount > maxWords) continue

    const isBrand =
      pureBrandKeywords.length > 0 ? containsPureBrand(keyword, pureBrandKeywords) : false
    const isPureBrand =
      pureBrandKeywords.length > 0 ? isPureBrandKeyword(keyword, pureBrandKeywords) : false
    const ranked = buildRankedCandidate({
      candidate,
      keyword,
      normalized,
      originalIndex: i,
      isBrand,
      isPureBrand,
      isPreferredBucket: preferredBucketSet.has(normalized),
      creativeType: input.creativeType || null,
      bucket: input.bucket,
      brandName: input.brandName,
      targetLanguage: input.targetLanguage,
      wordCount,
      allowModelIntentSoftFamilyFallback: Boolean(
        input.creativeType === 'model_intent' && options?.allowModelIntentSoftFamilyFallback
      ),
      disableVolumeReliance,
    })
    if (
      isLowQualityCandidate(ranked, input.creativeType || null, input.brandName, {
        ...options,
        targetLanguage: input.targetLanguage,
        disableVolumeReliance,
      })
    ) {
      continue
    }

    const existing = dedupedByNormalized.get(normalized)
    if (!existing) {
      dedupedByNormalized.set(normalized, ranked)
      continue
    }
    dedupedByNormalized.set(
      normalized,
      preferNonAiTwinCandidate(ranked, existing, input.creativeType || null)
    )
  }

  const dedupedByPermutation = new Map<string, RankedCandidate>()
  for (const candidate of dedupedByNormalized.values()) {
    const permutationKey = candidate.permutationKey || candidate.normalized
    const existing = dedupedByPermutation.get(permutationKey)
    if (!existing) {
      dedupedByPermutation.set(permutationKey, candidate)
      continue
    }
    dedupedByPermutation.set(
      permutationKey,
      preferNonAiTwinCandidate(candidate, existing, input.creativeType || null)
    )
  }

  return compactDemandSemanticDuplicates({
    candidates: Array.from(dedupedByPermutation.values()),
    creativeType: input.creativeType || null,
    brandName: input.brandName,
  })
}

export function buildBucketSpecificRescueCandidates(params: {
  input: SelectCreativeKeywordsInput
  creativeType: CanonicalCreativeType | null
  maxWords: number
  requiredBrandCount: number
}): RankedCandidate[] {
  if (params.creativeType !== 'model_intent') return []

  return ensureBrandCoverage(
    ensurePureBrandCoverage(
      toRankedCandidates({ ...params.input, creativeType: params.creativeType }, params.maxWords, {
        allowModelIntentPreferredFallback: true,
        allowModelIntentSoftFamilyFallback: true,
        disableVolumeReliance: Boolean(params.input.fallbackMode),
      }),
      { ...params.input, creativeType: params.creativeType },
      params.maxWords,
      0
    ),
    { ...params.input, creativeType: params.creativeType },
    params.maxWords,
    params.requiredBrandCount
  )
}

export function buildModelIntentPrecisionRescueCandidates(params: {
  rankedCandidates: RankedCandidate[]
  brandName?: string
  maxKeywords: number
  maxCandidates?: number
  excludeNormalized?: Set<string>
  excludePermutationKeys?: Set<string>
}): RankedCandidate[] {
  if (!Array.isArray(params.rankedCandidates) || params.rankedCandidates.length === 0) return []
  const requestedMaxCandidates = Number(params.maxCandidates)
  const baseCap = Math.min(
    params.maxKeywords,
    Math.max(1, Math.min(3, Math.floor(params.maxKeywords * 0.2)))
  )
  const precisionRescueCap = Number.isFinite(requestedMaxCandidates)
    ? Math.max(0, Math.min(baseCap, Math.floor(requestedMaxCandidates)))
    : baseCap
  if (precisionRescueCap <= 0) return []

  const rescued: RankedCandidate[] = []
  const seenNormalized = new Set<string>()
  const seenPermutation = new Set<string>()
  for (const normalized of params.excludeNormalized || []) {
    seenNormalized.add(
      String(normalized || '')
        .trim()
        .toLowerCase()
    )
  }
  for (const permutationKey of params.excludePermutationKeys || []) {
    const normalizedPermutationKey = String(permutationKey || '').trim()
    if (normalizedPermutationKey) seenPermutation.add(normalizedPermutationKey)
  }
  const sorted = [...params.rankedCandidates].sort(compareRankedCandidates)

  for (const candidate of sorted) {
    if (rescued.length >= precisionRescueCap) break
    if (seenNormalized.has(candidate.normalized)) continue
    const permutationKey = candidate.permutationKey || candidate.normalized
    if (seenPermutation.has(permutationKey)) continue
    if (candidate.isPureBrand) continue
    if (containsAsinLikeToken(candidate.keyword)) continue
    if (!isModelIntentQualifiedCandidate(candidate, params.brandName)) continue

    rescued.push(candidate)
    seenNormalized.add(candidate.normalized)
    seenPermutation.add(permutationKey)
  }

  return rescued
}

function buildProductIntentPrecisionRescueCandidates(params: {
  rankedCandidates: RankedCandidate[]
  brandName: string | undefined
  maxKeywords: number
  maxCandidates?: number
  excludeNormalized?: Set<string>
  excludePermutationKeys?: Set<string>
}): RankedCandidate[] {
  if (!Array.isArray(params.rankedCandidates) || params.rankedCandidates.length === 0) return []
  const requestedMaxCandidates = Number(params.maxCandidates)
  const baseCap = Math.min(
    params.maxKeywords,
    Math.max(1, Math.min(3, Math.floor(params.maxKeywords * 0.25)))
  )
  const precisionRescueCap = Number.isFinite(requestedMaxCandidates)
    ? Math.max(0, Math.min(baseCap, Math.floor(requestedMaxCandidates)))
    : baseCap
  if (precisionRescueCap <= 0) return []

  const rescued: RankedCandidate[] = []
  const seenNormalized = new Set<string>()
  const seenPermutation = new Set<string>()
  for (const normalized of params.excludeNormalized || []) {
    seenNormalized.add(
      String(normalized || '')
        .trim()
        .toLowerCase()
    )
  }
  for (const permutationKey of params.excludePermutationKeys || []) {
    const normalizedPermutationKey = String(permutationKey || '').trim()
    if (normalizedPermutationKey) seenPermutation.add(normalizedPermutationKey)
  }
  const sorted = [...params.rankedCandidates].sort(compareRankedCandidates)

  for (const candidate of sorted) {
    if (rescued.length >= precisionRescueCap) break
    if (seenNormalized.has(candidate.normalized)) continue
    const permutationKey = candidate.permutationKey || candidate.normalized
    if (seenPermutation.has(permutationKey)) continue
    if (candidate.isPureBrand) continue
    if (containsAsinLikeToken(candidate.keyword)) continue
    if (!isProductIntentDemandCandidate(candidate, params.brandName)) continue

    rescued.push(candidate)
    seenNormalized.add(candidate.normalized)
    seenPermutation.add(permutationKey)
  }

  return rescued
}

export function backfillCreativeOutputCandidates(params: {
  creativeType: CanonicalCreativeType | null
  bucket?: CreativeBucket | null
  outputCandidates: RankedCandidate[]
  rankedCandidates: RankedCandidate[]
  maxKeywords: number
  brandName: string | undefined
}): RankedCandidate[] {
  const outputCandidates = Array.isArray(params.outputCandidates) ? params.outputCandidates : []
  if (outputCandidates.length === 0) return outputCandidates

  const outputFloor = resolveCreativeKeywordMinimumOutputCount({
    creativeType: params.creativeType,
    maxKeywords: params.maxKeywords,
    bucket: params.bucket,
  })
  if (outputCandidates.length >= outputFloor) return outputCandidates

  const existingNormalized = new Set(outputCandidates.map((candidate) => candidate.normalized))
  const existingPermutationKeys = new Set(
    outputCandidates.map((candidate) => candidate.permutationKey || candidate.normalized)
  )
  const precisionRescueCandidates =
    params.creativeType === 'model_intent'
      ? buildModelIntentPrecisionRescueCandidates({
          rankedCandidates: params.rankedCandidates,
          brandName: params.brandName,
          maxKeywords: params.maxKeywords,
          maxCandidates: outputFloor - outputCandidates.length,
          excludeNormalized: existingNormalized,
          excludePermutationKeys: existingPermutationKeys,
        })
      : params.creativeType === 'product_intent'
        ? buildProductIntentPrecisionRescueCandidates({
            rankedCandidates: params.rankedCandidates,
            brandName: params.brandName,
            maxKeywords: params.maxKeywords,
            maxCandidates: outputFloor - outputCandidates.length,
            excludeNormalized: existingNormalized,
            excludePermutationKeys: existingPermutationKeys,
          })
        : []
  if (precisionRescueCandidates.length === 0) return outputCandidates

  return [...outputCandidates, ...precisionRescueCandidates]
    .sort(compareRankedCandidates)
    .slice(0, params.maxKeywords)
}

function buildFallbackRankedCandidate(params: {
  keyword: string
  creativeType: CanonicalCreativeType | null
  bucket: CreativeBucket | null | undefined
  brandName: string | undefined
  targetLanguage?: string
  maxWords: number
  originalIndex: number
  sourceType: string
}): RankedCandidate | null {
  const keyword = String(params.keyword || '').trim()
  if (!keyword) return null
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return null
  const wordCount = normalized.split(/\s+/).filter(Boolean).length || 1
  if (wordCount > params.maxWords) return null

  const normalizedBrand = normalizeGoogleAdsKeyword(params.brandName || '')
  const pureBrandKeywords =
    normalizedBrand && normalizedBrand !== 'unknown' ? getPureBrandKeywords(normalizedBrand) : []
  const isBrand =
    pureBrandKeywords.length > 0 ? containsPureBrand(keyword, pureBrandKeywords) : false
  const isPureBrand =
    pureBrandKeywords.length > 0 ? isPureBrandKeyword(keyword, pureBrandKeywords) : false

  return buildRankedCandidate({
    candidate: {
      keyword,
      searchVolume: 0,
      source: params.sourceType,
      sourceType: params.sourceType,
      sourceSubtype: params.sourceType,
      rawSource: params.sourceType === 'MODEL_FAMILY_GUARD' ? 'DERIVED_RESCUE' : undefined,
      derivedTags: [params.sourceType],
      matchType: params.creativeType === 'model_intent' ? 'EXACT' : 'PHRASE',
      suggestedMatchType: params.creativeType === 'model_intent' ? 'EXACT' : 'PHRASE',
      sourceField: params.sourceType === 'BRAND_SEED' ? 'brand' : 'keyword_pool',
    },
    keyword,
    normalized,
    originalIndex: params.originalIndex,
    isBrand,
    isPureBrand,
    isPreferredBucket: false,
    creativeType: params.creativeType,
    bucket: params.bucket,
    brandName: params.brandName,
    targetLanguage: params.targetLanguage,
    wordCount,
    allowModelIntentSoftFamilyFallback: true,
  })
}

function buildInputSignalRescueCandidates(params: {
  input: SelectCreativeKeywordsInput
  creativeType: CanonicalCreativeType | null
  rankedCandidates: RankedCandidate[]
  maxWords: number
}): RankedCandidate[] {
  const rawKeywords = [
    ...(Array.isArray(params.input.keywordsWithVolume)
      ? params.input.keywordsWithVolume.map((item) => item.keyword)
      : []),
    ...(Array.isArray(params.input.keywords) ? params.input.keywords : []),
  ]

  const candidateTexts = new Map<string, string>()
  for (const rawKeyword of rawKeywords) {
    const normalized = normalizeGoogleAdsKeyword(rawKeyword || '')
    if (!normalized || containsAsinLikeToken(normalized)) continue
    if (
      params.creativeType === 'model_intent' &&
      !isModelIntentRescueKeyword(normalized, params.input.brandName)
    ) {
      continue
    }
    const compact = normalized
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, params.maxWords)
      .join(' ')
      .trim()
    if (!compact) continue
    const compactNormalized = normalizeGoogleAdsKeyword(compact)
    if (!compactNormalized || candidateTexts.has(compactNormalized)) continue
    candidateTexts.set(compactNormalized, compact)
  }
  if (candidateTexts.size === 0) return []

  const scored = Array.from(candidateTexts.values()).sort((left, right) => {
    const score = (text: string): number => {
      let value = 0
      if (hasModelAnchorEvidence({ keywords: [text] })) value += 4
      value +=
        getDemandAnchorTokens(text, params.input.brandName).filter((token) => !/^\d+$/.test(token))
          .length * 2
      if (!INFO_QUERY_PATTERN.test(text) && !QUESTION_PREFIX_PATTERN.test(text)) value += 2
      if (!REVIEW_COMPARE_PATTERN.test(text)) value += 1
      if (!PLATFORM_PATTERN.test(text)) value += 1
      if (!COMMUNITY_PATTERN.test(text)) value += 1
      return value
    }
    const scoreGap = score(right) - score(left)
    if (scoreGap !== 0) return scoreGap
    return left.localeCompare(right)
  })

  for (const keyword of scored) {
    const rescue = buildFallbackRankedCandidate({
      keyword,
      creativeType: params.creativeType,
      bucket: params.input.bucket,
      brandName: params.input.brandName,
      targetLanguage: params.input.targetLanguage,
      maxWords: params.maxWords,
      originalIndex: params.rankedCandidates.length + 1,
      sourceType: 'DERIVED_RESCUE',
    })
    if (
      rescue &&
      (params.creativeType !== 'model_intent' ||
        isModelIntentQualifiedCandidate(rescue, params.input.brandName))
    ) {
      return [rescue]
    }
  }

  return []
}

export function buildGuaranteedNonEmptyRescueCandidates(params: {
  input: SelectCreativeKeywordsInput
  creativeType: CanonicalCreativeType | null
  rankedCandidates: RankedCandidate[]
  maxWords: number
  maxKeywords: number
}): RankedCandidate[] {
  if (params.creativeType === 'model_intent') {
    const precision = buildModelIntentPrecisionRescueCandidates({
      rankedCandidates: params.rankedCandidates,
      brandName: params.input.brandName,
      maxKeywords: params.maxKeywords,
    })
    if (precision.length > 0) return precision.slice(0, 1)

    const signalRescueCandidates = buildInputSignalRescueCandidates({
      input: params.input,
      creativeType: params.creativeType,
      rankedCandidates: params.rankedCandidates,
      maxWords: params.maxWords,
    })
    if (signalRescueCandidates.length > 0) return signalRescueCandidates

    const bestRanked = [...params.rankedCandidates]
      .filter((candidate) => !candidate.isPureBrand)
      .filter((candidate) => !containsAsinLikeToken(candidate.keyword))
      .filter((candidate) => isModelIntentQualifiedCandidate(candidate, params.input.brandName))
      .sort(compareRankedCandidates)
      .slice(0, 1)
    return bestRanked
  }

  const normalizedBrand = normalizeGoogleAdsKeyword(params.input.brandName || '')
  const pureBrandKeywords =
    normalizedBrand && normalizedBrand !== 'unknown' ? getPureBrandKeywords(normalizedBrand) : []
  for (const keyword of pureBrandKeywords) {
    const pureBrandCandidate = buildFallbackRankedCandidate({
      keyword,
      creativeType: params.creativeType,
      bucket: params.input.bucket,
      brandName: params.input.brandName,
      targetLanguage: params.input.targetLanguage,
      maxWords: params.maxWords,
      originalIndex: params.rankedCandidates.length + 1,
      sourceType: 'BRAND_SEED',
    })
    if (pureBrandCandidate) return [pureBrandCandidate]
  }

  const signalRescueCandidates = buildInputSignalRescueCandidates({
    input: params.input,
    creativeType: params.creativeType,
    rankedCandidates: params.rankedCandidates,
    maxWords: params.maxWords,
  })
  if (signalRescueCandidates.length > 0) return signalRescueCandidates

  const bestRanked = [...params.rankedCandidates]
    .filter((candidate) => !containsAsinLikeToken(candidate.keyword))
    .sort(compareRankedCandidates)
    .slice(0, 1)
  return bestRanked
}
