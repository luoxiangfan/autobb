import type { GeneratedAdCreativeData } from './ad-creative'
import type {
  CreativeAttemptEvaluation,
  CreativeGenerationHistoryItem,
  CreativeQualityEvaluationInput,
} from './ad-creative-quality-loop'
import {
  buildCreativeKeywordSet,
  type BuildCreativeKeywordSetInput,
  type BuildCreativeKeywordSetOutput,
  type CreativeKeywordSourceAudit,
} from './creative-keyword-set-builder'
import {
  normalizeCanonicalCreativeType,
  type CanonicalCreativeType,
} from './creative-type'
import { normalizeGoogleAdsKeyword } from './google-ads-keyword-normalizer'
import { analyzeKeywordLanguageCompatibility } from './keyword-validity'
import type { ComprehensiveAdStrengthResult } from './scoring'

type CreativeKeywordSupplementation = GeneratedAdCreativeData['keywordSupplementation']
type CreativeKeywordsWithVolume = BuildCreativeKeywordSetOutput['keywordsWithVolume']

interface KeywordSetAssignmentInput {
  executableKeywords: string[]
  keywordsWithVolume: CreativeKeywordsWithVolume
  promptKeywords: string[]
  keywordSupplementation?: CreativeKeywordSupplementation
  audit?: CreativeKeywordSourceAudit
}

interface ApplyCreativeKeywordSetOptions {
  includeKeywordSupplementation?: boolean
}

interface CreateCreativeKeywordSetBuilderInputOptions {
  offer: BuildCreativeKeywordSetInput['offer']
  userId: number
  creative: Pick<GeneratedAdCreativeData, 'keywords' | 'keywordsWithVolume' | 'promptKeywords'>
  creativeType?: BuildCreativeKeywordSetInput['creativeType']
  bucket?: BuildCreativeKeywordSetInput['bucket']
  scopeLabel: string
  seedCandidates?: BuildCreativeKeywordSetInput['seedCandidates']
  enableSupplementation?: boolean
  continueOnSupplementError?: boolean
  fallbackMode?: boolean
}

interface BuildPreGenerationCreativeKeywordSetOptions {
  offer: BuildCreativeKeywordSetInput['offer']
  userId: number
  creativeType?: BuildCreativeKeywordSetInput['creativeType']
  bucket?: BuildCreativeKeywordSetInput['bucket']
  scopeLabel: string
  seedCandidates?: BuildCreativeKeywordSetInput['seedCandidates']
  enableSupplementation?: boolean
  continueOnSupplementError?: boolean
  fallbackMode?: boolean
}

interface FinalizeCreativeKeywordSetOptions<TCreative extends CreativeKeywordRuntimeCarrier> {
  offer: BuildCreativeKeywordSetInput['offer']
  userId: number
  creative: TCreative
  creativeType?: BuildCreativeKeywordSetInput['creativeType']
  bucket?: BuildCreativeKeywordSetInput['bucket']
  scopeLabel: string
  seedCandidates?: BuildCreativeKeywordSetInput['seedCandidates']
  includeKeywordSupplementation?: boolean
}

interface MergeUsedKeywordsExcludingBrandInput {
  usedKeywords: string[]
  candidateKeywords?: Array<string | null | undefined>
  brandKeywords: string[]
}

interface CreativeEvaluationOfferContext {
  brand?: string | null
  category?: string | null
  product_name?: string | null
  product_title?: string | null
  title?: string | null
  name?: string | null
  brand_description?: string | null
  unique_selling_points?: string | null
  product_highlights?: string | null
  target_country?: string | null
  target_language?: string | null
  page_type?: string | null
}

interface CreateCreativeQualityEvaluationInputOptions {
  creative: GeneratedAdCreativeData
  minimumScore?: number
  offer: CreativeEvaluationOfferContext
  userId: number
  bucket?: string | null
  creativeType?: CanonicalCreativeType | null
  keywords?: string[]
  productNameFallback?: string | null
  productTitleFallback?: string | null
}

interface CreateCreativeAdStrengthPayloadOptions {
  includeRsaQualityGate?: boolean
}

interface CreateCreativeScoreBreakdownOptions {
  allowPartialMetrics?: boolean
}

interface CreateCreativeOptimizationPayloadOptions<THistory> {
  attempts: number
  targetRating: string
  achieved: boolean
  history: THistory[]
  qualityGatePassed?: boolean
}

interface CreativeOfferSummaryInput {
  id?: number | null
  brand?: string | null
  url?: string | null
  affiliate_link?: string | null
}

interface CreativeBucketSummaryInput {
  creativeType: string
  bucket: string
  bucketIntent: string
  generatedBuckets: string[]
}

interface CreateCreativeResponsePayloadOptions {
  id?: number | null
  creative: GeneratedAdCreativeData
  audit?: CreativeKeywordSourceAudit
  includeNegativeKeywords?: boolean
  includeKeywordSupplementation?: boolean
}

type CanonicalBucketSlot = 'A' | 'B' | 'D'

interface EvaluateCreativePersistenceHardGateInput {
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

const DEFAULT_FINAL_PUBLISH_DECISION = {
  status: 'PENDING_LAUNCH_SCORE_CHECK',
  stage: 'campaign_publish',
  hardBlockSource: 'launch_score',
} as const

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

type CreativeKeywordRuntimeCarrier = Pick<
  GeneratedAdCreativeData,
  'keywords' | 'keywordsWithVolume' | 'promptKeywords' | 'keywordSupplementation'
> & {
  executableKeywords?: string[]
  audit?: CreativeKeywordSourceAudit
  keywordSourceAudit?: CreativeKeywordSourceAudit
  adStrength?: {
    audit?: CreativeKeywordSourceAudit
    keywordSourceAudit?: CreativeKeywordSourceAudit
  } | null
}

export function applyCreativeKeywordSetToCreative<T extends CreativeKeywordRuntimeCarrier>(
  creative: T,
  keywordSet: KeywordSetAssignmentInput,
  options?: ApplyCreativeKeywordSetOptions
): T {
  creative.executableKeywords = keywordSet.executableKeywords
  creative.keywords = keywordSet.executableKeywords
  creative.keywordsWithVolume = keywordSet.keywordsWithVolume as any
  creative.promptKeywords = keywordSet.promptKeywords

  if (options?.includeKeywordSupplementation !== false && keywordSet.keywordSupplementation !== undefined) {
    creative.keywordSupplementation = keywordSet.keywordSupplementation
  }

  if (keywordSet.audit) {
    creative.audit = keywordSet.audit
  }

  return creative
}

export function createCreativeKeywordSetBuilderInput(
  input: CreateCreativeKeywordSetBuilderInputOptions
): BuildCreativeKeywordSetInput {
  return {
    offer: input.offer,
    userId: input.userId,
    brandName: input.offer.brand || 'Unknown',
    targetLanguage: input.offer.target_language || 'English',
    creativeType: input.creativeType,
    bucket: input.bucket,
    scopeLabel: input.scopeLabel,
    keywordsWithVolume: input.creative.keywordsWithVolume as any,
    keywords: input.creative.keywords || [],
    promptKeywords: input.creative.promptKeywords,
    seedCandidates: input.seedCandidates,
    enableSupplementation: input.enableSupplementation,
    continueOnSupplementError: input.continueOnSupplementError,
    fallbackMode: input.fallbackMode,
  }
}

export async function buildPreGenerationCreativeKeywordSet(
  input: BuildPreGenerationCreativeKeywordSetOptions
): Promise<BuildCreativeKeywordSetOutput> {
  return buildCreativeKeywordSet({
    offer: input.offer,
    userId: input.userId,
    brandName: input.offer.brand || 'Unknown',
    targetLanguage: input.offer.target_language || 'English',
    creativeType: input.creativeType,
    bucket: input.bucket,
    scopeLabel: input.scopeLabel,
    keywords: [],
    keywordsWithVolume: [],
    seedCandidates: input.seedCandidates,
    enableSupplementation: input.enableSupplementation,
    continueOnSupplementError: input.continueOnSupplementError,
    fallbackMode: input.fallbackMode,
  })
}

export async function finalizeCreativeKeywordSet<TCreative extends CreativeKeywordRuntimeCarrier>(
  input: FinalizeCreativeKeywordSetOptions<TCreative>
): Promise<TCreative> {
  const finalKeywordSet = await buildCreativeKeywordSet(
    createCreativeKeywordSetBuilderInput({
      offer: input.offer,
      userId: input.userId,
      creative: input.creative,
      creativeType: input.creativeType,
      bucket: input.bucket,
      scopeLabel: input.scopeLabel,
      seedCandidates: input.seedCandidates,
      enableSupplementation: false,
      continueOnSupplementError: true,
    })
  )

  return applyCreativeKeywordSetToCreative(
    input.creative,
    {
      executableKeywords: finalKeywordSet.executableKeywords,
      keywordsWithVolume: finalKeywordSet.keywordsWithVolume,
      promptKeywords: finalKeywordSet.promptKeywords,
      keywordSupplementation: finalKeywordSet.keywordSupplementation,
      audit: finalKeywordSet.audit,
    },
    {
      includeKeywordSupplementation: input.includeKeywordSupplementation,
    }
  )
}

export function buildCreativeBrandKeywords(brandName: string | null | undefined): string[] {
  const normalized = String(brandName || '').trim().toLowerCase()
  return normalized ? [normalized] : []
}

function normalizeBucketForHardGate(bucket: unknown): CanonicalBucketSlot | null {
  const normalized = String(bucket || '').trim().toUpperCase()
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
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return false
  if (TRUNCATED_CTA_TAIL_PATTERN.test(normalized)) return true
  if (UNBALANCED_OPEN_BRACKET_TAIL_PATTERN.test(normalized)) return true
  return false
}

function countCreativeTextTruncationAnomalies(creative: EvaluateCreativePersistenceHardGateInput['creative']): number {
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
      Number(
        bucket
          ? input.bucketKeywordFloors?.[bucket]
          : undefined
      ) || (bucket ? HARD_GATE_BUCKET_KEYWORD_FLOORS[bucket] : defaultMinimumKeywordCount)
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
    .map((keyword) => normalizeGoogleAdsKeyword(keyword) || keyword.toLowerCase().replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const duplicateKeywordCount = Math.max(0, normalizedKeywords.length - new Set(normalizedKeywords).size)
  const duplicateKeywordRatio = duplicateKeywordCount / Math.max(1, normalizedKeywords.length)

  const brandKeywords = buildCreativeBrandKeywords(input.brandName)
  const nonTargetLanguageKeywordCount = keywords.filter((keyword) =>
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
    targetLanguage: String(input.targetLanguage || '').trim().toLowerCase(),
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

export function createCreativeQualityEvaluationInput(
  input: CreateCreativeQualityEvaluationInputOptions
): CreativeQualityEvaluationInput {
  const targetLanguage = input.offer.target_language || 'en'
  const normalizedPageType = (() => {
    const normalized = String(input.offer.page_type || '').trim().toLowerCase()
    if (normalized === 'store' || normalized === 'product') return normalized
    return null
  })()
  const bucketType = (() => {
    const normalized = String(input.bucket || '').trim().toUpperCase()
    if (normalized === 'A') return 'A' as const
    if (normalized === 'B' || normalized === 'C') return normalized as 'B' | 'C'
    if (normalized === 'D' || normalized === 'S') return normalized as 'D' | 'S'
    return null
  })()
  const normalizedCreativeType = normalizeCanonicalCreativeType(input.creativeType)
    || normalizeCanonicalCreativeType((input.creative as { creative_type?: unknown })?.creative_type)
    || (
      bucketType === 'A'
        ? 'brand_intent'
        : bucketType === 'B' || bucketType === 'C'
          ? 'model_intent'
          : bucketType === 'D' || bucketType === 'S'
            ? 'product_intent'
            : null
    )

  return {
    creative: input.creative,
    minimumScore: input.minimumScore,
    adStrengthContext: {
      brandName: input.offer.brand,
      targetCountry: input.offer.target_country || 'US',
      targetLanguage,
      bucketType,
      creativeType: normalizedCreativeType,
      userId: input.userId,
    },
    ruleContext: {
      brandName: input.offer.brand,
      category: input.offer.category,
      productName: input.offer.product_name || input.productNameFallback,
      productTitle: input.offer.product_title || input.productTitleFallback,
      productDescription: input.offer.brand_description,
      uniqueSellingPoints: input.offer.unique_selling_points || input.offer.product_highlights,
      keywords: input.keywords || input.creative.keywords || [],
      targetLanguage,
      bucket: input.bucket,
      ...(normalizedPageType ? { pageType: normalizedPageType } : {}),
    }
  }
}

export function createCreativeAdStrengthPayload(
  evaluation: Pick<
    ComprehensiveAdStrengthResult,
    'finalRating' | 'finalScore' | 'localEvaluation' | 'combinedSuggestions' | 'rsaQualityGate'
  >,
  audit?: CreativeKeywordSourceAudit,
  options?: CreateCreativeAdStrengthPayloadOptions
) {
  return {
    rating: evaluation.finalRating,
    score: evaluation.finalScore,
    isExcellent: evaluation.finalRating === 'EXCELLENT',
    ...(options?.includeRsaQualityGate ? { rsaQualityGate: evaluation.rsaQualityGate } : {}),
    dimensions: evaluation.localEvaluation.dimensions,
    suggestions: evaluation.combinedSuggestions,
    audit,
    keywordSourceAudit: audit,
  }
}

export function createCreativeScoreBreakdown(
  evaluation: Pick<ComprehensiveAdStrengthResult, 'localEvaluation'>,
  options?: CreateCreativeScoreBreakdownOptions
) {
  const dimensions = evaluation.localEvaluation.dimensions as any

  return {
    relevance: dimensions.relevance.score,
    quality: dimensions.quality.score,
    engagement: dimensions.completeness.score,
    diversity: dimensions.diversity.score,
    clarity: dimensions.compliance.score,
    brandSearchVolume: options?.allowPartialMetrics
      ? dimensions.brandSearchVolume?.score || 0
      : dimensions.brandSearchVolume.score,
    competitivePositioning: options?.allowPartialMetrics
      ? dimensions.competitivePositioning?.score || 0
      : dimensions.competitivePositioning.score,
  }
}

export function createCreativeApiRetryHistory(history: CreativeGenerationHistoryItem[]) {
  return history.map(item => ({
    ...item,
    gatePassed: item.passed,
    gateReasons: item.reasons,
  }))
}

export function createCreativeTaskRetryHistory(history: CreativeGenerationHistoryItem[]) {
  return history.map(item => ({
    attempt: item.attempt,
    rating: item.rating,
    score: item.score,
    suggestions: item.suggestions,
    failureType: item.failureType,
    reasons: item.reasons,
    passed: item.passed,
  }))
}

export function createCreativeOptimizationPayload<THistory>(
  input: CreateCreativeOptimizationPayloadOptions<THistory>
) {
  return {
    attempts: input.attempts,
    targetRating: input.targetRating,
    achieved: input.achieved,
    ...(input.qualityGatePassed !== undefined
      ? { qualityGatePassed: input.qualityGatePassed }
      : {}),
    history: input.history,
  }
}

export function createCreativeOfferSummaryPayload(offer: CreativeOfferSummaryInput) {
  return {
    id: offer.id,
    brand: offer.brand,
    url: offer.url,
    affiliateLink: offer.affiliate_link,
  }
}

export function createCreativeBucketSummaryPayload(input: CreativeBucketSummaryInput) {
  return {
    creativeType: input.creativeType,
    bucket: input.bucket,
    bucketIntent: input.bucketIntent,
    generatedBuckets: input.generatedBuckets,
  }
}

export function createCreativeResponsePayload(
  input: CreateCreativeResponsePayloadOptions
) {
  return {
    ...(input.id !== undefined ? { id: input.id } : {}),
    headlines: input.creative.headlines,
    descriptions: input.creative.descriptions,
    keywords: input.creative.keywords,
    keywordsWithVolume: input.creative.keywordsWithVolume,
    ...(input.includeNegativeKeywords ? { negativeKeywords: input.creative.negativeKeywords } : {}),
    callouts: input.creative.callouts,
    sitelinks: input.creative.sitelinks,
    theme: input.creative.theme,
    explanation: input.creative.explanation,
    headlinesWithMetadata: input.creative.headlinesWithMetadata,
    descriptionsWithMetadata: input.creative.descriptionsWithMetadata,
    qualityMetrics: input.creative.qualityMetrics,
    ...(input.includeKeywordSupplementation
      ? { keywordSupplementation: input.creative.keywordSupplementation || null }
      : {}),
    audit: input.audit,
    keywordSourceAudit: input.audit,
  }
}

export function createCreativeQualityGatePayload(evaluation: CreativeAttemptEvaluation) {
  return {
    passed: evaluation.passed,
    warning: !evaluation.passed,
    reasons: evaluation.reasons,
    failureType: evaluation.failureType,
    rsaGatePassed: evaluation.rsaGate.passed,
    ruleGatePassed: evaluation.ruleGate.passed,
    rsaQualityGate: evaluation.adStrength.rsaQualityGate,
    ruleGate: evaluation.ruleGate,
  }
}

export function createCreativePublishDecisionPayload(forcePublishRequested: boolean) {
  return {
    forcePublish: false,
    forcedPublish: false,
    qualityGateBypassed: false,
    forcePublishIgnored: forcePublishRequested,
    finalPublishDecision: { ...DEFAULT_FINAL_PUBLISH_DECISION },
  }
}

export function resolveCreativeKeywordsForRetryExclusion(
  creative: CreativeKeywordRuntimeCarrier | null | undefined
): string[] {
  const candidateSources: unknown[] = [
    creative?.executableKeywords,
    creative?.keywords,
    Array.isArray(creative?.keywordsWithVolume)
      ? creative.keywordsWithVolume.map((item) => String((item as any)?.keyword || '').trim())
      : [],
  ]

  for (const source of candidateSources) {
    const keywords = Array.isArray(source)
      ? source
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
      : []
    if (keywords.length > 0) {
      return keywords
    }
  }

  return []
}

export function mergeUsedKeywordsExcludingBrand(
  input: MergeUsedKeywordsExcludingBrandInput
): string[] {
  const lowSignalSingleTokenSet = new Set([
    'buy',
    'price',
    'deal',
    'deals',
    'sale',
    'discount',
    'coupon',
    'offer',
    'promo',
    'shop',
    'store',
    'online',
    'official',
    'best',
    'review',
    'reviews',
  ])
  const normalizeKeyword = (value: unknown): string => String(value || '').trim()
  const buildPermutationKey = (keyword: string): string => {
    const normalized = normalizeGoogleAdsKeyword(keyword) || ''
    if (!normalized) return ''
    const tokens = normalized.split(/\s+/).filter(Boolean)
    if (tokens.length <= 1) return normalized
    return tokens.slice().sort().join(' ')
  }
  const isUsefulCandidateKeywordForExclusion = (keyword: string): boolean => {
    const normalized = normalizeGoogleAdsKeyword(keyword) || ''
    if (!normalized) return false
    const tokens = normalized.split(/\s+/).filter(Boolean)
    if (tokens.length >= 2) return true
    const [token] = tokens
    if (!token) return false
    if (/[a-z]*\d+[a-z0-9-]*/i.test(token)) return true
    return !lowSignalSingleTokenSet.has(token)
  }
  const buildDedupKey = (keyword: string): string => {
    const normalized = normalizeGoogleAdsKeyword(keyword) || keyword.toLowerCase().replace(/\s+/g, ' ').trim()
    const permutation = buildPermutationKey(keyword)
    if (permutation) return `perm:${permutation}`
    if (normalized) return `norm:${normalized}`
    return `raw:${keyword.toLowerCase()}`
  }

  const brandKeywords = Array.isArray(input.brandKeywords)
    ? input.brandKeywords
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean)
    : []
  const nonBrandKeywords = (Array.isArray(input.candidateKeywords) ? input.candidateKeywords : [])
    .filter((item): item is string => typeof item === 'string')
    .map((item) => normalizeKeyword(item))
    .filter(Boolean)
    .filter((keyword) => isUsefulCandidateKeywordForExclusion(keyword))
    .filter((keyword) => {
      const keywordLower = keyword.toLowerCase()
      return !brandKeywords.some((brand) => keywordLower.includes(brand) || brand.includes(keywordLower))
    })

  const mergedKeywords = [
    ...(Array.isArray(input.usedKeywords) ? input.usedKeywords.map((item) => normalizeKeyword(item)) : []),
    ...nonBrandKeywords,
  ].filter(Boolean)
  const deduped = new Map<string, string>()
  for (const keyword of mergedKeywords) {
    const key = buildDedupKey(keyword)
    if (!deduped.has(key)) {
      deduped.set(key, keyword)
    }
  }

  return Array.from(deduped.values())
}

export function resolveCreativeKeywordAudit(creative: CreativeKeywordRuntimeCarrier | null | undefined): CreativeKeywordSourceAudit | undefined {
  return (
    creative?.audit
    || creative?.keywordSourceAudit
    || creative?.adStrength?.audit
    || creative?.adStrength?.keywordSourceAudit
    || undefined
  )
}
