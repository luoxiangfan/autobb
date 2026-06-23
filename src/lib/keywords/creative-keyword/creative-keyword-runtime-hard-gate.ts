/**
 * 创意关键词运行时：持久化硬门禁
 */
import type { GeneratedAdCreativeData } from '../../creatives/server'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { analyzeKeywordLanguageCompatibility } from '../planner/keyword-validity'
import { resolveCreativeKeywordsForRetryExclusion } from './creative-keyword-runtime-retry-keywords'

export type CanonicalBucketSlot = 'A' | 'B' | 'D'

export interface EvaluateCreativePersistenceHardGateInput {
  creative: Pick<
    GeneratedAdCreativeData,
    'keywords' | 'executableKeywords' | 'keywordsWithVolume' | 'headlines' | 'descriptions'
  >
  bucket?: string | null
  targetLanguage?: string | null
  brandName?: string | null
  bucketKeywordFloors?: Partial<Record<CanonicalBucketSlot, number>>
  defaultMinimumKeywordCount?: number
  maxNonTargetLanguageRatio?: number
  maxDuplicateKeywordRatio?: number
}

export interface CreativePersistenceHardGateViolation {
  code:
    | 'keyword_count_below_floor'
    | 'non_target_language_ratio_exceeded'
    | 'duplicate_ratio_exceeded'
    | 'truncation_anomaly_detected'
  message: string
}

export interface CreativePersistenceHardGateResult {
  passed: boolean
  bucket: CanonicalBucketSlot | null
  targetLanguage: string
  thresholds: {
    requiredKeywordCount: number
    maxNonTargetLanguageRatio: number
    maxDuplicateKeywordRatio: number
  }
  metrics: {
    keywordCount: number
    duplicateKeywordCount: number
    duplicateKeywordRatio: number
    nonTargetLanguageKeywordCount: number
    nonTargetLanguageKeywordRatio: number
    truncationAnomalyCount: number
  }
  violations: CreativePersistenceHardGateViolation[]
}

const HARD_GATE_BUCKET_KEYWORD_FLOORS: Record<CanonicalBucketSlot, number> = {
  A: 10,
  B: 8,
  D: 10,
}
const HARD_GATE_DEFAULT_MINIMUM_KEYWORD_COUNT = HARD_GATE_BUCKET_KEYWORD_FLOORS.B
const HARD_GATE_MAX_NON_TARGET_LANGUAGE_RATIO = 0.05
const HARD_GATE_MAX_DUPLICATE_KEYWORD_RATIO = 0.2
const TRUNCATED_CTA_TAIL_PATTERN =
  /\b(?:get|buy|shop|learn|save|order|book|discover|find|view|try|join|call)\s+[a-z]{1,2}$/i
const UNBALANCED_OPEN_BRACKET_TAIL_PATTERN = /[([{][^)\]}]*$/

export function buildCreativeBrandKeywords(brandName: string | null | undefined): string[] {
  const normalized = String(brandName || '')
    .trim()
    .toLowerCase()
  return normalized ? [normalized] : []
}

function normalizeBucketForHardGate(bucket: unknown): CanonicalBucketSlot | null {
  const normalized = String(bucket || '')
    .trim()
    .toUpperCase()
  if (normalized === 'A') return 'A'
  if (normalized === 'B' || normalized === 'C') return 'B'
  if (normalized === 'D' || normalized === 'S') return 'D'
  return null
}

function clampRatio(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(1, parsed))
}

function isLikelyTruncatedCreativeText(value: unknown): boolean {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return false
  if (TRUNCATED_CTA_TAIL_PATTERN.test(normalized)) return true
  if (UNBALANCED_OPEN_BRACKET_TAIL_PATTERN.test(normalized)) return true
  return false
}

function countCreativeTextTruncationAnomalies(
  creative: EvaluateCreativePersistenceHardGateInput['creative']
): number {
  const assets = [
    ...(Array.isArray(creative.headlines) ? creative.headlines : []),
    ...(Array.isArray(creative.descriptions) ? creative.descriptions : []),
  ]
  let anomalies = 0
  for (const asset of assets) {
    if (isLikelyTruncatedCreativeText(asset)) anomalies += 1
  }
  return anomalies
}

export function evaluateCreativePersistenceHardGate(
  input: EvaluateCreativePersistenceHardGateInput
): CreativePersistenceHardGateResult {
  const bucket = normalizeBucketForHardGate(input.bucket)
  const keywords = resolveCreativeKeywordsForRetryExclusion(input.creative as any)
  const keywordCount = keywords.length
  const defaultMinimumKeywordCount = Math.max(
    1,
    Math.floor(Number(input.defaultMinimumKeywordCount) || HARD_GATE_DEFAULT_MINIMUM_KEYWORD_COUNT)
  )
  const requiredKeywordCount = Math.max(
    1,
    Math.floor(
      Number(bucket ? input.bucketKeywordFloors?.[bucket] : undefined) ||
        (bucket ? HARD_GATE_BUCKET_KEYWORD_FLOORS[bucket] : defaultMinimumKeywordCount)
    )
  )
  const maxNonTargetLanguageRatio = clampRatio(
    input.maxNonTargetLanguageRatio,
    HARD_GATE_MAX_NON_TARGET_LANGUAGE_RATIO
  )
  const maxDuplicateKeywordRatio = clampRatio(
    input.maxDuplicateKeywordRatio,
    HARD_GATE_MAX_DUPLICATE_KEYWORD_RATIO
  )

  const normalizedKeywords = keywords
    .map(
      (keyword) =>
        normalizeGoogleAdsKeyword(keyword) || keyword.toLowerCase().replace(/\s+/g, ' ').trim()
    )
    .filter(Boolean)
  const duplicateKeywordCount = Math.max(
    0,
    normalizedKeywords.length - new Set(normalizedKeywords).size
  )
  const duplicateKeywordRatio = duplicateKeywordCount / Math.max(1, normalizedKeywords.length)

  const brandKeywords = buildCreativeBrandKeywords(input.brandName)
  const nonTargetLanguageKeywordCount = keywords.filter(
    (keyword) =>
      analyzeKeywordLanguageCompatibility({
        keyword,
        targetLanguage: input.targetLanguage || undefined,
        pureBrandKeywords: brandKeywords,
      }).hardReject
  ).length
  const nonTargetLanguageKeywordRatio = nonTargetLanguageKeywordCount / Math.max(1, keywordCount)
  const truncationAnomalyCount = countCreativeTextTruncationAnomalies(input.creative)

  const violations: CreativePersistenceHardGateViolation[] = []

  if (keywordCount < requiredKeywordCount) {
    violations.push({
      code: 'keyword_count_below_floor',
      message: `关键词数量不足: ${keywordCount}/${requiredKeywordCount}`,
    })
  }

  if (nonTargetLanguageKeywordRatio > maxNonTargetLanguageRatio) {
    violations.push({
      code: 'non_target_language_ratio_exceeded',
      message: `非目标语关键词占比超限: ${(nonTargetLanguageKeywordRatio * 100).toFixed(1)}% > ${(maxNonTargetLanguageRatio * 100).toFixed(1)}%`,
    })
  }

  if (duplicateKeywordRatio > maxDuplicateKeywordRatio) {
    violations.push({
      code: 'duplicate_ratio_exceeded',
      message: `关键词重复率超限: ${(duplicateKeywordRatio * 100).toFixed(1)}% > ${(maxDuplicateKeywordRatio * 100).toFixed(1)}%`,
    })
  }

  if (truncationAnomalyCount > 0) {
    violations.push({
      code: 'truncation_anomaly_detected',
      message: `文案截断异常: ${truncationAnomalyCount} 条`,
    })
  }

  return {
    passed: violations.length === 0,
    bucket,
    targetLanguage: String(input.targetLanguage || '')
      .trim()
      .toLowerCase(),
    thresholds: {
      requiredKeywordCount,
      maxNonTargetLanguageRatio,
      maxDuplicateKeywordRatio,
    },
    metrics: {
      keywordCount,
      duplicateKeywordCount,
      duplicateKeywordRatio,
      nonTargetLanguageKeywordCount,
      nonTargetLanguageKeywordRatio,
      truncationAnomalyCount,
    },
    violations,
  }
}
