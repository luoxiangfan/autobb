/**
 * 创意关键词集合构建：契约评估与来源审计
 */
import type { KeywordSupplementationReport } from '../../creatives/generator/types'
import type { CanonicalCreativeType } from '../../creatives/server'
import type { CreativeKeywordSourceQuotaAudit } from './creative-keyword-selection'
import {
  containsPureBrand,
  getPureBrandKeywords,
  isPureBrandKeyword,
} from '../brand/brand-keyword-utils'
import type { PoolKeywordData } from '../offer-pool'
import {
  type CreativeKeywordContextFilterStats,
  type CreativeKeywordSourceAudit,
  type CreativeKeywordSourceRatioItem,
  BUILDER_MODEL_ANCHOR_PATTERN,
} from './creative-keyword-set-builder-types'
import { inferCreativeAffinity } from './creative-keyword-set-builder-candidates'

export function shouldBlockOriginalFallbackForModelIntent(input: {
  creativeType?: CanonicalCreativeType | null
  bucket?: 'A' | 'B' | 'C' | 'D' | 'S' | null
}): boolean {
  if (input.creativeType === 'model_intent') return true
  const normalizedBucket = String(input.bucket || '')
    .trim()
    .toUpperCase()
  return normalizedBucket === 'B' || normalizedBucket === 'C'
}

function countToRatioMap(
  counts: Record<string, number>,
  total: number
): Record<string, CreativeKeywordSourceRatioItem> {
  const safeTotal = total > 0 ? total : 1
  const entries = Object.entries(counts)
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

  return entries.reduce<Record<string, CreativeKeywordSourceRatioItem>>((acc, [key, count]) => {
    acc[key] = {
      count,
      ratio: Math.round((count / safeTotal) * 10000) / 10000,
    }
    return acc
  }, {})
}

function bumpCount(
  target: Record<string, number>,
  key: string | undefined,
  fallbackKey: string
): void {
  const normalized =
    String(key || '')
      .trim()
      .toUpperCase() || fallbackKey
  target[normalized] = (target[normalized] || 0) + 1
}

function toRatioItem(count: number, total: number): CreativeKeywordSourceRatioItem {
  const safeTotal = total > 0 ? total : 1
  return {
    count,
    ratio: Math.round((count / safeTotal) * 10000) / 10000,
  }
}

function normalizeAuditMetricValue(value: unknown): string {
  return String(value || '')
    .trim()
    .toUpperCase()
}

function hasAuditMetricTag(item: PoolKeywordData, expected: string): boolean {
  const normalizedExpected = normalizeAuditMetricValue(expected)
  if (!normalizedExpected) return false
  const derivedTags = Array.isArray((item as any)?.derivedTags) ? (item as any).derivedTags : []
  return derivedTags.some((tag: unknown) => normalizeAuditMetricValue(tag) === normalizedExpected)
}

function isModelFamilyGuardKeyword(item: PoolKeywordData): boolean {
  const sourceKeys = [
    (item as any)?.sourceSubtype,
    (item as any)?.sourceType,
    (item as any)?.source,
    (item as any)?.fallbackReason,
  ].map(normalizeAuditMetricValue)

  return sourceKeys.includes('MODEL_FAMILY_GUARD') || hasAuditMetricTag(item, 'MODEL_FAMILY_GUARD')
}

function isFinalRescueKeyword(item: PoolKeywordData): boolean {
  const sourceKeys = [
    (item as any)?.sourceSubtype,
    (item as any)?.sourceType,
    (item as any)?.source,
    (item as any)?.fallbackReason,
    (item as any)?.rescueStage,
  ].map(normalizeAuditMetricValue)

  return (
    sourceKeys.includes('CONTRACT_RESCUE') ||
    sourceKeys.includes('FINAL_INVARIANT') ||
    hasAuditMetricTag(item, 'CONTRACT_RESCUE') ||
    hasAuditMetricTag(item, 'FINAL_INVARIANT')
  )
}

function isHardModelKeyword(item: PoolKeywordData): boolean {
  const keyword = String((item as any)?.keyword || '')
  const familyMatchType = String((item as any)?.familyMatchType || '')
    .trim()
    .toLowerCase()
  if (familyMatchType === 'hard_model') return true
  if (familyMatchType === 'mixed') {
    return BUILDER_MODEL_ANCHOR_PATTERN.test(keyword)
  }
  return BUILDER_MODEL_ANCHOR_PATTERN.test(keyword)
}

function isSoftFamilyKeyword(item: PoolKeywordData): boolean {
  const familyMatchType = String((item as any)?.familyMatchType || '')
    .trim()
    .toLowerCase()
  if (familyMatchType === 'soft_family') return true
  return isModelFamilyGuardKeyword(item)
}

function evaluateCreativeKeywordContractSatisfaction(params: {
  keywords: PoolKeywordData[]
  creativeType?: CanonicalCreativeType | null
  brandName?: string
  pureBrandCount: number
  nonPureBrandCount: number
  hardModelCount: number
  softFamilyCount: number
}): boolean {
  const totalKeywords = params.keywords.length
  if (totalKeywords === 0) return false

  const pureBrandKeywords = getPureBrandKeywords(params.brandName || '')
  const brandKeywordCount = params.keywords.filter((item) =>
    containsPureBrand(String((item as any)?.keyword || ''), pureBrandKeywords)
  ).length

  if (params.creativeType === 'brand_intent') {
    return params.pureBrandCount >= 1 && brandKeywordCount >= 1
  }

  if (params.creativeType === 'model_intent') {
    return params.pureBrandCount === 0 && (params.hardModelCount > 0 || params.softFamilyCount > 0)
  }

  if (params.creativeType === 'product_intent') {
    const requiredNonPureBrandCount = totalKeywords > 1 ? 1 : 0
    return params.pureBrandCount >= 1 && params.nonPureBrandCount >= requiredNonPureBrandCount
  }

  return totalKeywords > 0
}

export function buildKeywordSourceAudit(input: {
  keywordsWithVolume: PoolKeywordData[]
  fallbackMode: boolean
  contextFallbackStrategy: 'filtered' | 'keyword_pool' | 'original'
  sourceQuotaAudit: CreativeKeywordSourceQuotaAudit
  contextFilterStats: CreativeKeywordContextFilterStats
  creativeType?: CanonicalCreativeType | null
  brandName?: string
  keywordSupplementation?: KeywordSupplementationReport
  pipeline: CreativeKeywordSourceAudit['pipeline']
}): CreativeKeywordSourceAudit {
  const keywords = Array.isArray(input.keywordsWithVolume) ? input.keywordsWithVolume : []
  const totalKeywords = keywords.length

  let withSearchVolumeKeywords = 0
  let volumeUnavailableKeywords = 0
  const byRawSourceCount: Record<string, number> = {}
  const bySourceSubtypeCount: Record<string, number> = {}
  const bySourceFieldCount: Record<string, number> = {}
  const creativeAffinityByLabelCount: Record<string, number> = {}
  const creativeAffinityByLevelCount: Record<string, number> = {}
  const supplementationSourceCount: Record<string, number> = {}

  for (const item of keywords) {
    const searchVolume = Number((item as any)?.searchVolume || 0)
    if (searchVolume > 0) withSearchVolumeKeywords += 1
    if (
      (item as any)?.volumeUnavailableReason === 'DEV_TOKEN_INSUFFICIENT_ACCESS' &&
      searchVolume <= 0
    ) {
      volumeUnavailableKeywords += 1
    }

    bumpCount(byRawSourceCount, (item as any)?.rawSource, 'UNKNOWN')
    bumpCount(
      bySourceSubtypeCount,
      (item as any)?.sourceSubtype || (item as any)?.sourceType,
      'UNKNOWN'
    )
    bumpCount(bySourceFieldCount, (item as any)?.sourceField, 'UNKNOWN')
    const affinity = inferCreativeAffinity({
      keyword: String((item as any)?.keyword || ''),
      creativeType: input.creativeType || null,
      brandName: input.brandName,
    })
    bumpCount(creativeAffinityByLabelCount, affinity.label, 'UNKNOWN')
    bumpCount(creativeAffinityByLevelCount, affinity.level, 'UNKNOWN')
  }

  for (const addedKeyword of input.keywordSupplementation?.addedKeywords || []) {
    bumpCount(supplementationSourceCount, (addedKeyword as any)?.source, 'UNKNOWN')
  }

  const zeroVolumeKeywords = Math.max(0, totalKeywords - withSearchVolumeKeywords)
  const noVolumeMode = volumeUnavailableKeywords > 0
  const pureBrandKeywords = getPureBrandKeywords(input.brandName || '')
  const pureBrandCount = keywords.filter((item) =>
    isPureBrandKeyword(String((item as any)?.keyword || ''), pureBrandKeywords)
  ).length
  const nonPureBrandCount = Math.max(0, totalKeywords - pureBrandCount)
  const requiredKeywordsCount = keywords.filter(
    (item) =>
      String((item as any)?.contractRole || '')
        .trim()
        .toLowerCase() === 'required'
  ).length
  const fallbackKeywordsCount = keywords.filter(
    (item) =>
      String((item as any)?.contractRole || '')
        .trim()
        .toLowerCase() === 'fallback'
  ).length
  const modelFamilyGuardCount = keywords.filter(isModelFamilyGuardKeyword).length
  const hardModelCount = keywords.filter(isHardModelKeyword).length
  const softFamilyCount = keywords.filter(isSoftFamilyKeyword).length
  const finalRescueCount = keywords.filter(isFinalRescueKeyword).length
  const dNonPureBrandCount = input.creativeType === 'product_intent' ? nonPureBrandCount : 0
  const contractSatisfied = evaluateCreativeKeywordContractSatisfaction({
    keywords,
    creativeType: input.creativeType || null,
    brandName: input.brandName,
    pureBrandCount,
    nonPureBrandCount,
    hardModelCount,
    softFamilyCount,
  })

  return {
    totalKeywords,
    withSearchVolumeKeywords,
    zeroVolumeKeywords,
    volumeUnavailableKeywords,
    noVolumeMode,
    fallbackMode: input.fallbackMode,
    contextFallbackStrategy: input.contextFallbackStrategy,
    sourceQuotaAudit: input.sourceQuotaAudit,
    contextFilterStats: input.contextFilterStats,
    byRawSource: countToRatioMap(byRawSourceCount, totalKeywords),
    bySourceSubtype: countToRatioMap(bySourceSubtypeCount, totalKeywords),
    bySourceField: countToRatioMap(bySourceFieldCount, totalKeywords),
    creativeAffinityByLabel: countToRatioMap(creativeAffinityByLabelCount, totalKeywords),
    creativeAffinityByLevel: countToRatioMap(creativeAffinityByLevelCount, totalKeywords),
    supplementationSources: countToRatioMap(
      supplementationSourceCount,
      Array.isArray(input.keywordSupplementation?.addedKeywords)
        ? input.keywordSupplementation.addedKeywords.length
        : 0
    ),
    selectionMetrics: {
      contractSatisfied,
      requiredKeywords: toRatioItem(requiredKeywordsCount, totalKeywords),
      fallbackKeywords: toRatioItem(fallbackKeywordsCount, totalKeywords),
      modelFamilyGuardKeywords: toRatioItem(modelFamilyGuardCount, totalKeywords),
      pureBrandKeywords: toRatioItem(pureBrandCount, totalKeywords),
      nonPureBrandKeywords: toRatioItem(nonPureBrandCount, totalKeywords),
      dNonPureBrandKeywords: toRatioItem(dNonPureBrandCount, totalKeywords),
      hardModelKeywords: toRatioItem(hardModelCount, totalKeywords),
      softFamilyKeywords: toRatioItem(softFamilyCount, totalKeywords),
      finalRescueKeywords: toRatioItem(finalRescueCount, totalKeywords),
    },
    pipeline: {
      ...input.pipeline,
      contractSatisfiedAfterFallback: contractSatisfied,
    },
  }
}
