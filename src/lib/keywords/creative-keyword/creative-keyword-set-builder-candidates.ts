/**
 * 创意关键词集合构建：候选归一化、合并与过滤衔接
 */

import { logger } from '@/lib/common/server'
import type { CanonicalCreativeType } from '../../creatives/server'
import {
  getKeywordSourcePriorityScoreFromInput,
  inferKeywordRawSource,
  normalizeKeywordSourceSubtype,
} from './creative-keyword-source-priority'
import { containsPureBrand, getPureBrandKeywords } from '../brand/brand-keyword-utils'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { analyzeKeywordLanguageCompatibility } from '../planner/keyword-validity'
import type { PoolKeywordData } from '../offer-pool'
import { createRiskAlert } from '../../campaign/optimization'
import { getDatabase } from '../../db'
import { normalizeCountryCode, normalizeLanguageCode } from '../../common/server'
import {
  type BuildCreativeKeywordSetInput,
  type CreativeKeywordCandidate,
  type CreativeKeywordCandidateProvenance,
  CREATIVE_PROMPT_KEYWORD_LIMIT,
  BUILDER_STANDALONE_MODEL_TOKEN_PATTERN,
  BUILDER_OFFER_CONTEXT_FILTERED_TAG,
  RELAXED_FILTERING_BUCKET_FLOOR_BY_BUCKET,
  RELAXED_FILTERING_PRIORITY_SOURCE_PATTERNS,
  CREATIVE_KEYWORD_ALERT_CONTEXT_REMOVAL_THRESHOLD,
  CREATIVE_KEYWORD_ALERT_NON_TARGET_RATIO_THRESHOLD,
} from './creative-keyword-set-builder-types'

export function toFallbackKeywords(input: { keywords: string[]; fallbackSource: string }): Array<{
  keyword: string
  searchVolume: number
  matchType: 'PHRASE'
  source: string
  sourceType: string
}> {
  return input.keywords.map((keyword) => ({
    keyword,
    searchVolume: 0,
    matchType: 'PHRASE',
    source: input.fallbackSource,
    sourceType: 'AI_FALLBACK_PLACEHOLDER',
  }))
}

export function normalizeCandidateKey(keyword: unknown): string {
  return String(keyword || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function envEnabled(name: string, defaultEnabled: boolean): boolean {
  const normalized = String(process.env[name] || '')
    .trim()
    .toLowerCase()
  if (!normalized) return defaultEnabled
  if (['0', 'false', 'off', 'no'].includes(normalized)) return false
  if (['1', 'true', 'on', 'yes'].includes(normalized)) return true
  return defaultEnabled
}

export function parseBoundedFloatEnv(
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = String(process.env[name] || '').trim()
  if (!raw) return fallback
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

export function resolveSelectedKeywordLanguageRisk(params: {
  keywords: string[]
  targetLanguage?: string | null
  brandName?: string | null
}): { nonTargetLanguageCount: number; nonTargetLanguageRatio: number } {
  const keywords = Array.isArray(params.keywords)
    ? params.keywords.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  if (keywords.length === 0) {
    return {
      nonTargetLanguageCount: 0,
      nonTargetLanguageRatio: 0,
    }
  }

  const targetLanguage = String(params.targetLanguage || '').trim()
  if (!targetLanguage) {
    return {
      nonTargetLanguageCount: 0,
      nonTargetLanguageRatio: 0,
    }
  }

  const pureBrandKeywords = getPureBrandKeywords(params.brandName || '')
  const nonTargetLanguageCount = keywords.filter(
    (keyword) =>
      analyzeKeywordLanguageCompatibility({
        keyword,
        targetLanguage,
        pureBrandKeywords,
      }).hardReject
  ).length

  return {
    nonTargetLanguageCount,
    nonTargetLanguageRatio: nonTargetLanguageCount / Math.max(1, keywords.length),
  }
}

export async function emitCreativeKeywordRiskAlerts(params: {
  userId: number
  offerId?: number | null
  scopeLabel: string
  creativeType?: CanonicalCreativeType | null
  bucket?: BuildCreativeKeywordSetInput['bucket']
  minimumSelectedKeywordCount: number
  selectedKeywords: string[]
  targetLanguage?: string | null
  brandName?: string | null
  contextIntentTighteningRemovalRatio: number
  contextIntentTighteningRemoved: number
  contextIntentTighteningDenominator: number
  selectionFallbackTriggered: boolean
  nonEmptyRescueTriggered: boolean
  relaxedFilteringTriggered: boolean
}): Promise<void> {
  const userId = Number(params.userId)
  if (!Number.isFinite(userId) || userId <= 0) return

  const offerId = Number(params.offerId)
  const resourceId = Number.isFinite(offerId) && offerId > 0 ? offerId : undefined
  const languageRisk = resolveSelectedKeywordLanguageRisk({
    keywords: params.selectedKeywords,
    targetLanguage: params.targetLanguage,
    brandName: params.brandName,
  })
  const selectedKeywordCount = params.selectedKeywords.length
  const commonDetails = {
    scopeLabel: params.scopeLabel,
    bucket: params.bucket || null,
    creativeType: params.creativeType || null,
    selectedKeywordCount,
    minimumSelectedKeywordCount: params.minimumSelectedKeywordCount,
  }

  if (
    params.contextIntentTighteningRemovalRatio > CREATIVE_KEYWORD_ALERT_CONTEXT_REMOVAL_THRESHOLD
  ) {
    await createRiskAlert(
      userId,
      'creative_keyword_context_intent_removal_high',
      'warning',
      '关键词上下文收紧过高',
      `关键词上下文/意图收紧移除率过高 (${(params.contextIntentTighteningRemovalRatio * 100).toFixed(1)}%)`,
      {
        resourceType: 'offer',
        resourceId,
        details: {
          ...commonDetails,
          contextIntentTighteningRemoved: params.contextIntentTighteningRemoved,
          contextIntentTighteningDenominator: params.contextIntentTighteningDenominator,
          contextIntentTighteningRemovalRatio: params.contextIntentTighteningRemovalRatio,
        },
      }
    )
  }

  if (params.selectionFallbackTriggered || params.nonEmptyRescueTriggered) {
    await createRiskAlert(
      userId,
      'creative_keyword_fallback_rescue_triggered',
      'info',
      '关键词触发 fallback/rescue',
      '关键词筛选触发 fallback/rescue，建议检查上游候选词与上下文约束',
      {
        resourceType: 'offer',
        resourceId,
        details: {
          ...commonDetails,
          selectionFallbackTriggered: params.selectionFallbackTriggered,
          nonEmptyRescueTriggered: params.nonEmptyRescueTriggered,
          relaxedFilteringTriggered: params.relaxedFilteringTriggered,
        },
      }
    )
  }

  if (selectedKeywordCount < params.minimumSelectedKeywordCount) {
    await createRiskAlert(
      userId,
      'creative_keyword_count_below_floor',
      'warning',
      '关键词数量低于保底',
      `关键词数量低于保底: ${selectedKeywordCount}/${params.minimumSelectedKeywordCount}`,
      {
        resourceType: 'offer',
        resourceId,
        details: commonDetails,
      }
    )
  }

  if (languageRisk.nonTargetLanguageRatio > CREATIVE_KEYWORD_ALERT_NON_TARGET_RATIO_THRESHOLD) {
    await createRiskAlert(
      userId,
      'creative_keyword_non_target_ratio_high',
      'warning',
      '非目标语关键词占比过高',
      `非目标语关键词占比超限 (${(languageRisk.nonTargetLanguageRatio * 100).toFixed(1)}%)`,
      {
        resourceType: 'offer',
        resourceId,
        details: {
          ...commonDetails,
          nonTargetLanguageCount: languageRisk.nonTargetLanguageCount,
          nonTargetLanguageRatio: languageRisk.nonTargetLanguageRatio,
          threshold: CREATIVE_KEYWORD_ALERT_NON_TARGET_RATIO_THRESHOLD,
        },
      }
    )
  }
}

export function normalizeBucketForFloor(
  bucket: BuildCreativeKeywordSetInput['bucket']
): 'A' | 'B' | 'D' | null {
  const normalized = String(bucket || '')
    .trim()
    .toUpperCase()
  if (normalized === 'A') return 'A'
  if (normalized === 'B' || normalized === 'C') return 'B'
  if (normalized === 'D' || normalized === 'S') return 'D'
  return null
}

export function resolveBucketMinimumKeywordTarget(params: {
  bucket: BuildCreativeKeywordSetInput['bucket']
  maxKeywords: number
  fallbackMinimum: number
}): number {
  const safeMax = Math.max(1, Math.floor(params.maxKeywords))
  const normalizedBucket = normalizeBucketForFloor(params.bucket)
  if (!normalizedBucket) return Math.min(safeMax, params.fallbackMinimum)
  const bucketFloor = RELAXED_FILTERING_BUCKET_FLOOR_BY_BUCKET[normalizedBucket]
  return Math.min(safeMax, Math.max(params.fallbackMinimum, bucketFloor))
}

export function isRelaxedFilteringPriorityCandidate(item: PoolKeywordData): boolean {
  const sourceSignals = [
    (item as any)?.source,
    (item as any)?.sourceType,
    (item as any)?.sourceSubtype,
    (item as any)?.rawSource,
    ...(Array.isArray((item as any)?.derivedTags) ? (item as any).derivedTags : []),
  ]
    .map((value) =>
      String(value || '')
        .trim()
        .toUpperCase()
    )
    .filter(Boolean)

  return RELAXED_FILTERING_PRIORITY_SOURCE_PATTERNS.some((pattern) =>
    sourceSignals.some((signal) => signal.includes(pattern))
  )
}

export function compareRelaxedFilteringCandidates(a: PoolKeywordData, b: PoolKeywordData): number {
  const aPriority = getKeywordSourcePriorityScoreFromInput({
    source: String((a as any)?.source || ''),
    sourceType: String((a as any)?.sourceSubtype || (a as any)?.sourceType || ''),
  })
  const bPriority = getKeywordSourcePriorityScoreFromInput({
    source: String((b as any)?.source || ''),
    sourceType: String((b as any)?.sourceSubtype || (b as any)?.sourceType || ''),
  })
  if (bPriority !== aPriority) return bPriority - aPriority

  const volumeDiff = Number((b as any)?.searchVolume || 0) - Number((a as any)?.searchVolume || 0)
  if (volumeDiff !== 0) return volumeDiff

  return String((a as any)?.keyword || '').localeCompare(String((b as any)?.keyword || ''))
}

const CONTEXT_RECOVERY_SOURCE_BONUSES: Array<{ pattern: RegExp; bonus: number }> = [
  { pattern: /^SEARCH_TERM_HIGH_PERFORMING$/i, bonus: 28 },
  { pattern: /^SEARCH_TERM_/i, bonus: 24 },
  { pattern: /^KEYWORD_PLANNER/i, bonus: 22 },
  { pattern: /^GLOBAL_CORE_BRANDED$/i, bonus: 20 },
  { pattern: /^GLOBAL_CATEGORY_BRANDED$/i, bonus: 20 },
  { pattern: /^GLOBAL_CORE$/i, bonus: 18 },
  { pattern: /^GLOBAL_KEYWORDS?$/i, bonus: 18 },
  { pattern: /^OFFER_EXTRACTED_KEYWORDS$/i, bonus: 14 },
  { pattern: /^HOT_PRODUCT_AGGREGATE$/i, bonus: 14 },
  { pattern: /^PARAM_EXTRACT$/i, bonus: 10 },
]

function getContextRecoverySourceBonus(item: PoolKeywordData): number {
  const signals = [
    String((item as any)?.sourceSubtype || (item as any)?.sourceType || '').trim(),
    String((item as any)?.source || '').trim(),
    String((item as any)?.rawSource || '').trim(),
  ]
    .map((signal) => signal.toUpperCase())
    .filter(Boolean)

  for (const signal of signals) {
    for (const rule of CONTEXT_RECOVERY_SOURCE_BONUSES) {
      if (rule.pattern.test(signal)) return rule.bonus
    }
  }

  return 0
}

export function compareContextRecoveryCandidates(a: PoolKeywordData, b: PoolKeywordData): number {
  const aPriority =
    getKeywordSourcePriorityScoreFromInput({
      source: String((a as any)?.source || ''),
      sourceType: String((a as any)?.sourceSubtype || (a as any)?.sourceType || ''),
    }) + getContextRecoverySourceBonus(a)
  const bPriority =
    getKeywordSourcePriorityScoreFromInput({
      source: String((b as any)?.source || ''),
      sourceType: String((b as any)?.sourceSubtype || (b as any)?.sourceType || ''),
    }) + getContextRecoverySourceBonus(b)
  if (bPriority !== aPriority) return bPriority - aPriority

  const volumeDiff = Number((b as any)?.searchVolume || 0) - Number((a as any)?.searchVolume || 0)
  if (volumeDiff !== 0) return volumeDiff

  return String((a as any)?.keyword || '').localeCompare(String((b as any)?.keyword || ''))
}

export function filterLanguageCompatibleCandidates(params: {
  candidates: PoolKeywordData[]
  targetLanguage?: string | null
  brandName?: string | null
}): {
  keywords: PoolKeywordData[]
  blockedKeywordKeys: string[]
} {
  const targetLanguage = String(params.targetLanguage || '').trim()
  if (!targetLanguage || params.candidates.length === 0) {
    return {
      keywords: params.candidates,
      blockedKeywordKeys: [],
    }
  }

  const pureBrandKeywords = getPureBrandKeywords(params.brandName || '')
  const blockedKeywordKeys = new Set<string>()
  const accepted: PoolKeywordData[] = []

  for (const candidate of params.candidates) {
    const keyword = String((candidate as any)?.keyword || '').trim()
    if (!keyword) continue

    const languageAnalysis = analyzeKeywordLanguageCompatibility({
      keyword,
      targetLanguage,
      pureBrandKeywords,
    })
    if (languageAnalysis.hardReject) {
      const normalizedKey = normalizeCandidateKey(keyword)
      if (normalizedKey) blockedKeywordKeys.add(normalizedKey)
      continue
    }

    accepted.push(candidate)
  }

  return {
    keywords: accepted,
    blockedKeywordKeys: Array.from(blockedKeywordKeys),
  }
}

function normalizeStringList(values: unknown, max = 8): string[] | undefined {
  if (!Array.isArray(values)) return undefined
  const unique = Array.from(
    new Set(values.map((item) => String(item || '').trim()).filter(Boolean))
  ).slice(0, max)
  return unique.length > 0 ? unique : undefined
}

export function normalizeSeedCandidates(seedCandidates: unknown[]): Array<Record<string, any>> {
  return seedCandidates
    .map((item): Record<string, any> | null => {
      if (typeof item === 'string') {
        const keyword = item.trim()
        if (!keyword) return null
        return {
          keyword,
          searchVolume: 0,
          matchType: 'PHRASE' as const,
          source: 'KEYWORD_POOL' as const,
          sourceType: 'CANONICAL_BUCKET_VIEW' as const,
        }
      }

      if (!item || typeof item !== 'object') return null
      const keyword = String((item as any).keyword || '').trim()
      if (!keyword) return null

      return {
        ...(item as Record<string, any>),
        keyword,
        searchVolume:
          typeof (item as any).searchVolume === 'number'
            ? (item as any).searchVolume
            : Number((item as any).searchVolume) || 0,
        matchType: ((item as any).matchType || 'PHRASE') as 'EXACT' | 'PHRASE' | 'BROAD',
        source: String((item as any).source || 'KEYWORD_POOL').trim() || 'KEYWORD_POOL',
        sourceType:
          String((item as any).sourceType || 'CANONICAL_BUCKET_VIEW').trim() ||
          'CANONICAL_BUCKET_VIEW',
      }
    })
    .filter((item): item is Record<string, any> => item !== null)
}

function hasDemandIntentSignal(keyword: string): boolean {
  const normalized = normalizeGoogleAdsKeyword(keyword) || ''
  if (!normalized) return false
  const tokenCount = normalized.split(/\s+/).filter(Boolean).length
  if (tokenCount >= 3) return true
  return /\b(for|with|buy|best|price|deal|review|solution|kit|set|replacement)\b/i.test(normalized)
}

export function inferCreativeAffinity(params: {
  keyword: string
  creativeType?: CanonicalCreativeType | null
  brandName?: string
}): {
  label: 'brand' | 'model' | 'product' | 'mixed' | 'unknown'
  score: number
  level: 'high' | 'medium' | 'low'
} {
  const keyword = String(params.keyword || '').trim()
  const normalized = normalizeGoogleAdsKeyword(keyword) || ''
  const pureBrandKeywords = getPureBrandKeywords(params.brandName || '')
  const hasBrand =
    pureBrandKeywords.length > 0 ? containsPureBrand(keyword, pureBrandKeywords) : false
  const hasModel = /\b[a-z]*\d+[a-z0-9-]*\b/i.test(normalized)
  const hasDemand = hasDemandIntentSignal(keyword)

  let label: 'brand' | 'model' | 'product' | 'mixed' | 'unknown' = 'unknown'
  if (hasModel && hasBrand) label = 'mixed'
  else if (hasModel) label = 'model'
  else if (hasBrand && hasDemand) label = 'mixed'
  else if (hasBrand) label = 'brand'
  else if (hasDemand) label = 'product'

  const creativeType = params.creativeType || null
  let score = 0.42
  if (creativeType === 'brand_intent') {
    if (label === 'brand') score = 0.9
    else if (label === 'mixed') score = 0.78
    else if (label === 'model') score = 0.62
    else if (label === 'product') score = 0.55
  } else if (creativeType === 'model_intent') {
    if (label === 'model') score = 0.92
    else if (label === 'mixed') score = 0.88
    else if (label === 'brand') score = 0.56
    else if (label === 'product') score = 0.48
  } else if (creativeType === 'product_intent') {
    if (label === 'product') score = 0.9
    else if (label === 'mixed') score = 0.84
    else if (label === 'brand') score = 0.52
    else if (label === 'model') score = 0.58
  } else {
    if (label === 'mixed') score = 0.8
    else if (label === 'model') score = 0.74
    else if (label === 'product') score = 0.72
    else if (label === 'brand') score = 0.7
  }

  const normalizedScore = Math.max(0.3, Math.min(0.99, Math.round(score * 100) / 100))
  const level = normalizedScore >= 0.75 ? 'high' : normalizedScore >= 0.5 ? 'medium' : 'low'

  return {
    label,
    score: normalizedScore,
    level,
  }
}

function normalizeCandidateProvenance(
  item: PoolKeywordData
): CreativeKeywordCandidateProvenance | undefined {
  const source = String((item as any)?.source || '').trim()
  const sourceType = String((item as any)?.sourceType || '').trim()
  const sourceSubtype = String((item as any)?.sourceSubtype || '').trim()
  const rawSource = String((item as any)?.rawSource || '').trim()
  const sourceField = String((item as any)?.sourceField || '').trim()
  if (!source && !sourceType && !sourceSubtype && !rawSource && !sourceField) {
    return undefined
  }
  return {
    source: source || undefined,
    sourceType: sourceType || undefined,
    sourceSubtype: sourceSubtype || undefined,
    rawSource: rawSource || undefined,
    sourceField: sourceField || undefined,
  }
}

function mergeCandidateProvenanceRecords(
  records: Array<CreativeKeywordCandidateProvenance | undefined>
): CreativeKeywordCandidateProvenance[] | undefined {
  const merged = new Map<string, CreativeKeywordCandidateProvenance>()
  for (const record of records) {
    if (!record) continue
    const key = [
      record.source || '',
      record.sourceType || '',
      record.sourceSubtype || '',
      record.rawSource || '',
      record.sourceField || '',
    ].join('::')
    if (!key.replace(/:/g, '').trim()) continue
    if (!merged.has(key)) merged.set(key, record)
  }
  const values = Array.from(merged.values())
  return values.length > 0 ? values : undefined
}

function normalizeSourceScore(item: PoolKeywordData): number {
  return getKeywordSourcePriorityScoreFromInput({
    source: String((item as any)?.source || '').trim() || undefined,
    sourceType:
      String((item as any)?.sourceSubtype || (item as any)?.sourceType || '').trim() || undefined,
  })
}

function mergeKeywordCandidateRecords(
  existing: PoolKeywordData,
  incoming: PoolKeywordData
): PoolKeywordData {
  const existingScore = normalizeSourceScore(existing)
  const incomingScore = normalizeSourceScore(incoming)
  const incomingVolume = Number((incoming as any)?.searchVolume || 0)
  const existingVolume = Number((existing as any)?.searchVolume || 0)
  const preferIncoming =
    incomingScore > existingScore ||
    (incomingScore === existingScore && incomingVolume > existingVolume)
  const preferred = preferIncoming ? incoming : existing
  const secondary = preferIncoming ? existing : incoming

  const mergedProvenance = mergeCandidateProvenanceRecords([
    ...((existing as any)?.provenance || []),
    normalizeCandidateProvenance(existing),
    ...((incoming as any)?.provenance || []),
    normalizeCandidateProvenance(incoming),
  ])
  const mergedSource =
    String((preferred as any)?.source || (secondary as any)?.source || '').trim() || 'KEYWORD_POOL'
  const preferredSourceType = String((preferred as any)?.sourceType || '').trim()
  const preferredSourceSubtype = String((preferred as any)?.sourceSubtype || '').trim()
  const resolvedSourceSubtype =
    preferredSourceSubtype ||
    normalizeKeywordSourceSubtype({
      source: mergedSource,
      sourceType: preferredSourceType || undefined,
    }) ||
    undefined
  const resolvedSourceType = preferredSourceType || resolvedSourceSubtype || undefined
  const resolvedRawSource =
    String((preferred as any)?.rawSource || '').trim() ||
    inferKeywordRawSource({
      source: mergedSource,
      sourceType: resolvedSourceSubtype || resolvedSourceType,
    }) ||
    undefined
  const preferredSourceField = String((preferred as any)?.sourceField || '').trim()
  const secondarySourceField = String((secondary as any)?.sourceField || '').trim()
  const canReuseSecondarySourceField =
    !preferredSourceField &&
    String((preferred as any)?.source || '')
      .trim()
      .toUpperCase() ===
      String((secondary as any)?.source || '')
        .trim()
        .toUpperCase()
  const resolvedSourceField =
    preferredSourceField || (canReuseSecondarySourceField ? secondarySourceField : '') || undefined

  return {
    ...secondary,
    ...preferred,
    keyword: String((existing as any)?.keyword || (incoming as any)?.keyword || '').trim(),
    searchVolume: Math.max(existingVolume, incomingVolume),
    source: mergedSource,
    sourceType: resolvedSourceType,
    sourceSubtype: resolvedSourceSubtype,
    rawSource: resolvedRawSource,
    sourceField: resolvedSourceField,
    derivedTags: normalizeStringList([
      ...((existing as any)?.derivedTags || []),
      ...((incoming as any)?.derivedTags || []),
    ]),
    evidence: normalizeStringList(
      [...((existing as any)?.evidence || []), ...((incoming as any)?.evidence || [])],
      12
    ),
    provenance: mergedProvenance,
  } as PoolKeywordData
}

export function mergeSeedCandidates(input: {
  primaryCandidates: PoolKeywordData[]
  seedCandidates: PoolKeywordData[]
}): PoolKeywordData[] {
  const mergedByKey = new Map<string, PoolKeywordData>()
  const order: string[] = []
  const upsert = (candidate: PoolKeywordData) => {
    const key = normalizeCandidateKey((candidate as any)?.keyword)
    if (!key) return
    const existing = mergedByKey.get(key)
    if (!existing) {
      order.push(key)
      mergedByKey.set(key, candidate)
      return
    }
    mergedByKey.set(key, mergeKeywordCandidateRecords(existing, candidate))
  }

  for (const candidate of input.primaryCandidates) upsert(candidate)
  for (const candidate of input.seedCandidates) upsert(candidate)

  return order
    .map((key) => mergedByKey.get(key))
    .filter((candidate): candidate is PoolKeywordData => Boolean(candidate))
}

function isStandaloneModelTokenWithoutBrand(params: {
  keyword: string
  pureBrandKeywords: string[]
}): boolean {
  const normalized = normalizeGoogleAdsKeyword(params.keyword)
  if (!normalized) return false
  if (containsPureBrand(normalized, params.pureBrandKeywords)) return false

  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length !== 1) return false

  const token = tokens[0] || ''
  if (!BUILDER_STANDALONE_MODEL_TOKEN_PATTERN.test(token)) return false
  if (!/[a-z]/i.test(token) || !/\d/.test(token)) return false

  return true
}

function isShortNumericFragmentKeyword(params: {
  keyword: string
  pureBrandKeywords: string[]
}): boolean {
  const normalized = normalizeGoogleAdsKeyword(params.keyword)
  if (!normalized) return false
  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length < 2) return false

  const isShortNumericToken = (token: string) => /^\d{1,2}$/.test(token)
  if (tokens.length === 2 && tokens.every(isShortNumericToken)) return true

  const hasAdjacentRatioNumericPair = (inputTokens: string[]) => {
    for (let index = 0; index < inputTokens.length - 1; index += 1) {
      const current = inputTokens[index]
      const next = inputTokens[index + 1]
      if (!isShortNumericToken(current) || !isShortNumericToken(next)) continue
      if (Number(current) === 1 || Number(next) === 1) return true
    }
    return false
  }

  if (!containsPureBrand(normalized, params.pureBrandKeywords)) return false
  return hasAdjacentRatioNumericPair(tokens)
}

export function prefixStandaloneModelTokensWithBrand(params: {
  keywordsWithVolume: PoolKeywordData[]
  brandName?: string | null
  scopeLabel: string
}): {
  keywordsWithVolume: PoolKeywordData[]
  prefixedCount: number
  removedShortNumericFragmentCount: number
} {
  const pureBrandKeywords = getPureBrandKeywords(params.brandName || '')
  const brandKeyword = pureBrandKeywords[0] || ''
  if (params.keywordsWithVolume.length === 0) {
    return {
      keywordsWithVolume: params.keywordsWithVolume,
      prefixedCount: 0,
      removedShortNumericFragmentCount: 0,
    }
  }

  let prefixedCount = 0
  let removedShortNumericFragmentCount = 0
  const rewritten: PoolKeywordData[] = []

  for (const item of params.keywordsWithVolume) {
    const keyword = String((item as any)?.keyword || '').trim()
    if (!keyword) continue

    if (
      isShortNumericFragmentKeyword({
        keyword,
        pureBrandKeywords,
      })
    ) {
      removedShortNumericFragmentCount += 1
      continue
    }

    if (
      brandKeyword &&
      isStandaloneModelTokenWithoutBrand({
        keyword,
        pureBrandKeywords,
      })
    ) {
      prefixedCount += 1
      const normalized = normalizeGoogleAdsKeyword(keyword) || keyword
      rewritten.push({
        ...item,
        keyword: `${brandKeyword} ${normalized}`,
        matchType: 'EXACT' as const,
        derivedTags: normalizeStringList([
          ...((item as any)?.derivedTags || []),
          'MODEL_TOKEN_BRAND_PREFIXED',
        ]),
      } as PoolKeywordData)
      continue
    }

    rewritten.push(item)
  }

  const deduped = mergeSeedCandidates({
    primaryCandidates: [],
    seedCandidates: rewritten,
  })

  if (prefixedCount > 0) {
    logger.debug(
      `[buildCreativeKeywordSet][monitor] ${params.scopeLabel}: 前置品牌归一 ${prefixedCount} 个裸型号词`
    )
  }
  if (removedShortNumericFragmentCount > 0) {
    console.warn(
      `[buildCreativeKeywordSet][monitor] ${params.scopeLabel}: 移除 ${removedShortNumericFragmentCount} 个比例碎片词`
    )
  }

  return {
    keywordsWithVolume: deduped,
    prefixedCount,
    removedShortNumericFragmentCount,
  }
}

function buildGlobalKeywordLookupKeys(keyword: string): string[] {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return []
  const compact = normalized.replace(/\s+/g, '')
  return compact && compact !== normalized ? [normalized, compact] : [normalized]
}

export async function buildGlobalKeywordVolumeHintMap(params: {
  keywordsWithVolume: PoolKeywordData[]
  targetCountry?: string | null
  targetLanguage?: string | null
}): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (!Array.isArray(params.keywordsWithVolume) || params.keywordsWithVolume.length === 0) {
    return result
  }

  const lookupToKeywordKeys = new Map<string, Set<string>>()
  for (const item of params.keywordsWithVolume) {
    const keyword = String((item as any)?.keyword || '').trim()
    if (!keyword) continue

    const searchVolume = Number((item as any)?.searchVolume || 0)
    if (searchVolume > 0) continue

    const keywordKey = normalizeCandidateKey(keyword)
    if (!keywordKey) continue

    const lookupKeys = buildGlobalKeywordLookupKeys(keyword)
    for (const lookupKey of lookupKeys) {
      const key = normalizeCandidateKey(lookupKey)
      if (!key) continue
      if (!lookupToKeywordKeys.has(key)) {
        lookupToKeywordKeys.set(key, new Set())
      }
      lookupToKeywordKeys.get(key)!.add(keywordKey)
    }
  }

  const lookupKeys = Array.from(lookupToKeywordKeys.keys())
  if (lookupKeys.length === 0) return result

  const requestedLanguage = String(params.targetLanguage || '').trim()
  const effectiveLanguage = normalizeLanguageCode(requestedLanguage || 'en')
  const languageCandidates = Array.from(
    new Set([effectiveLanguage, requestedLanguage.toLowerCase()].filter(Boolean))
  )

  const effectiveCountry = normalizeCountryCode(String(params.targetCountry || 'US').trim() || 'US')
  const placeholders = lookupKeys.map(() => '?').join(',')
  const langPlaceholders = languageCandidates.map(() => '?').join(',')

  try {
    const db = await getDatabase()
    const rows = (await db.query(
      `
      SELECT keyword, search_volume
      FROM global_keywords
      WHERE keyword IN (${placeholders})
        AND country = ?
        AND language IN (${langPlaceholders})
        AND search_volume > 0
    `,
      [...lookupKeys, effectiveCountry, ...languageCandidates]
    )) as Array<{ keyword?: string; search_volume?: number }>

    for (const row of rows) {
      const lookupKey = normalizeCandidateKey(row.keyword || '')
      if (!lookupKey) continue
      const searchVolume = Number(row.search_volume || 0)
      if (searchVolume <= 0) continue

      const keywordKeys = lookupToKeywordKeys.get(lookupKey)
      if (!keywordKeys || keywordKeys.size === 0) continue

      for (const keywordKey of keywordKeys) {
        const existing = result.get(keywordKey) || 0
        if (searchVolume > existing) {
          result.set(keywordKey, searchVolume)
        }
      }
    }
  } catch (error: any) {
    console.warn(
      `[buildCreativeKeywordSet] global keyword volume backfill skipped: ${error?.message || String(error)}`
    )
  }

  return result
}

export function applyGlobalKeywordVolumeBackfill(params: {
  keywordsWithVolume: PoolKeywordData[]
  volumeHintMap: Map<string, number>
}): { keywordsWithVolume: PoolKeywordData[]; patchedCount: number } {
  if (!Array.isArray(params.keywordsWithVolume) || params.keywordsWithVolume.length === 0) {
    return { keywordsWithVolume: params.keywordsWithVolume, patchedCount: 0 }
  }
  if (!(params.volumeHintMap instanceof Map) || params.volumeHintMap.size === 0) {
    return { keywordsWithVolume: params.keywordsWithVolume, patchedCount: 0 }
  }

  let patchedCount = 0
  const keywordsWithVolume = params.keywordsWithVolume.map((item) => {
    const keyword = String((item as any)?.keyword || '').trim()
    const keywordKey = normalizeCandidateKey(keyword)
    if (!keywordKey) return item

    const hintVolume = Number(params.volumeHintMap.get(keywordKey) || 0)
    if (hintVolume <= 0) return item

    const currentVolume = Number((item as any)?.searchVolume || 0)
    if (currentVolume > 0) return item

    patchedCount += 1
    return {
      ...item,
      searchVolume: hintVolume,
    }
  })

  return { keywordsWithVolume, patchedCount }
}

export function extractPoolCandidatesFromSeedCandidates(
  seedCandidates: PoolKeywordData[]
): string[] {
  const seen = new Set<string>()
  const results: string[] = []
  for (const candidate of seedCandidates) {
    const normalized = normalizeCandidateKey((candidate as any)?.keyword)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    results.push(String((candidate as any)?.keyword || '').trim())
  }
  return results
}

export function buildPromptKeywordSubset(input: {
  selectedKeywords: string[]
  candidates: PoolKeywordData[]
  maxKeywords?: number
}): string[] {
  const maxKeywords = Number.isFinite(input.maxKeywords)
    ? Math.max(1, Math.floor(Number(input.maxKeywords)))
    : CREATIVE_PROMPT_KEYWORD_LIMIT
  const ordered = [
    ...(Array.isArray(input.selectedKeywords) ? input.selectedKeywords : []),
    ...input.candidates.map((item) => String((item as any)?.keyword || '')),
  ]

  const seen = new Set<string>()
  const promptKeywords: string[] = []
  for (const keywordRaw of ordered) {
    const keyword = String(keywordRaw || '').trim()
    if (!keyword) continue
    const normalized = normalizeCandidateKey(keyword)
    if (!normalized || seen.has(normalized)) continue
    promptKeywords.push(keyword)
    seen.add(normalized)
    if (promptKeywords.length >= maxKeywords) break
  }

  return promptKeywords
}

export function filterBlockedPromptKeywords(params: {
  keywords: string[]
  blockedKeywordKeys?: Iterable<string>
}): string[] {
  const blockedKeywordKeys = new Set(
    Array.from(params.blockedKeywordKeys || [])
      .map((item) => normalizeCandidateKey(item))
      .filter(Boolean)
  )
  if (blockedKeywordKeys.size === 0) return params.keywords

  return params.keywords.filter((keyword) => {
    const normalized = normalizeCandidateKey(keyword)
    return !normalized || !blockedKeywordKeys.has(normalized)
  })
}

export function toCreativeKeywordCandidate(
  item: PoolKeywordData,
  flags?: {
    promptEligible?: boolean
    executableEligible?: boolean
    creativeType?: CanonicalCreativeType | null
    brandName?: string
  }
): CreativeKeywordCandidate {
  const keyword = String((item as any)?.keyword || '').trim()
  return {
    keyword,
    searchVolume: Number((item as any)?.searchVolume || 0),
    rawSource: String((item as any)?.rawSource || '').trim() || undefined,
    sourceSubtype:
      String((item as any)?.sourceSubtype || (item as any)?.sourceType || '').trim() || undefined,
    derivedTags: normalizeStringList((item as any)?.derivedTags),
    sourceField: String((item as any)?.sourceField || '').trim() || undefined,
    evidence: normalizeStringList((item as any)?.evidence, 12),
    creativeAffinity: inferCreativeAffinity({
      keyword,
      creativeType: flags?.creativeType || null,
      brandName: flags?.brandName,
    }),
    promptEligible: Boolean(flags?.promptEligible),
    executableEligible: Boolean(flags?.executableEligible),
    provenance: mergeCandidateProvenanceRecords([
      ...((item as any)?.provenance || []),
      normalizeCandidateProvenance(item),
    ]),
  }
}

export function isKeywordPoolCandidate(item: PoolKeywordData): boolean {
  const source = String((item as any)?.source || '')
    .trim()
    .toUpperCase()
  const sourceType = String((item as any)?.sourceType || '')
    .trim()
    .toUpperCase()
  const sourceSubtype = String((item as any)?.sourceSubtype || '')
    .trim()
    .toUpperCase()
  const sourceField = String((item as any)?.sourceField || '')
    .trim()
    .toLowerCase()

  return (
    source === 'KEYWORD_POOL' ||
    sourceType === 'KEYWORD_POOL' ||
    sourceType === 'CANONICAL_BUCKET_VIEW' ||
    sourceSubtype === 'KEYWORD_POOL' ||
    sourceSubtype === 'CANONICAL_BUCKET_VIEW' ||
    sourceField === 'keyword_pool'
  )
}

export function hasOfferContextFilteredTag(item: PoolKeywordData): boolean {
  const derivedTags = Array.isArray((item as any)?.derivedTags) ? (item as any).derivedTags : []
  return derivedTags.some(
    (tag: unknown) =>
      String(tag || '')
        .trim()
        .toUpperCase() === BUILDER_OFFER_CONTEXT_FILTERED_TAG
  )
}

export function filterBlockedFallbackCandidates(params: {
  candidates: PoolKeywordData[]
  blockedKeywordKeys?: Iterable<string>
}): PoolKeywordData[] {
  const blockedKeywordKeys = new Set(
    Array.from(params.blockedKeywordKeys || [])
      .map((item) => normalizeCandidateKey(item))
      .filter(Boolean)
  )
  if (blockedKeywordKeys.size === 0) return params.candidates

  return params.candidates.filter((item) => {
    const key = normalizeCandidateKey((item as any)?.keyword)
    return !key || !blockedKeywordKeys.has(key)
  })
}

export function resolveKeywordCandidatesAfterContextFilter(params: {
  contextFilteredCandidates: PoolKeywordData[]
  originalCandidates: PoolKeywordData[]
  blockedKeywordKeys?: Iterable<string>
}): {
  keywords: PoolKeywordData[]
  strategy: 'filtered' | 'keyword_pool' | 'original'
} {
  if (params.contextFilteredCandidates.length > 0) {
    return {
      keywords: params.contextFilteredCandidates,
      strategy: 'filtered',
    }
  }

  const safeOriginalCandidates = filterBlockedFallbackCandidates({
    candidates: params.originalCandidates,
    blockedKeywordKeys: params.blockedKeywordKeys,
  })
  const keywordPoolCandidates = safeOriginalCandidates.filter(isKeywordPoolCandidate)
  if (keywordPoolCandidates.length > 0) {
    return {
      keywords: keywordPoolCandidates,
      strategy: 'keyword_pool',
    }
  }

  if (safeOriginalCandidates.length > 0) {
    return {
      keywords: safeOriginalCandidates,
      strategy: 'original',
    }
  }

  const unsafeKeywordPoolCandidates = params.originalCandidates.filter(isKeywordPoolCandidate)
  if (unsafeKeywordPoolCandidates.length > 0) {
    return {
      keywords: [],
      strategy: 'keyword_pool',
    }
  }

  return {
    keywords: [],
    strategy: 'original',
  }
}
