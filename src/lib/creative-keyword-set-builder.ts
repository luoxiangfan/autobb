import { applyKeywordSupplementationOnce, type KeywordSupplementationReport } from './ad-creative-gen'
import {
  filterCreativeKeywordsByOfferContextDetailed,
  normalizeCreativeKeywordCandidatesForContextFilter,
} from './creative-keyword-context-filter'
import {
  CREATIVE_BRAND_KEYWORD_RESERVE,
  CREATIVE_KEYWORD_MAX_COUNT,
  selectCreativeKeywords,
  type CreativeKeywordSourceQuotaAudit,
} from './creative-keyword-selection'
import { resolveCreativeKeywordMinimumOutputCount } from './creative-keyword-output-floor'
import { logKeywordSourceAudit } from './creative-keyword-audit-log'
import type { CanonicalCreativeType } from './creative-type'
import { getKeywordSourcePriorityScoreFromInput } from './creative-keyword-source-priority'
import { containsPureBrand, getPureBrandKeywords, isPureBrandKeyword } from './brand-keyword-utils'
import { normalizeGoogleAdsKeyword } from './google-ads-keyword-normalizer'
import { KEYWORD_POLICY } from './keyword-policy'
import { analyzeKeywordLanguageCompatibility } from './keyword-validity'
import type { PoolKeywordData } from './offer-keyword-pool'
import { createRiskAlert } from './risk-alerts'
import { getDatabase } from './db'
import { normalizeCountryCode, normalizeLanguageCode } from './language-country-codes'

export interface BuildCreativeKeywordSetInput {
  offer: {
    brand?: string | null
    category?: string | null
    product_name?: string | null
    extracted_headlines?: unknown
    extracted_keywords?: unknown
    enhanced_headlines?: unknown
    enhanced_keywords?: unknown
    product_highlights?: unknown
    unique_selling_points?: unknown
    target_country?: string | null
    target_language?: string | null
    final_url?: string | null
    url?: string | null
    page_type?: string | null
    scraped_data?: string | null
  }
  userId: number
  brandName: string
  targetLanguage: string
  creativeType?: CanonicalCreativeType | null
  bucket?: 'A' | 'B' | 'C' | 'D' | 'S' | null
  scopeLabel: string
  keywordsWithVolume?: unknown[]
  keywords?: string[]
  promptKeywords?: string[]
  seedCandidates?: unknown[]
  fallbackSource?: string
  enableSupplementation?: boolean
  continueOnSupplementError?: boolean
  fallbackMode?: boolean
  maxKeywords?: number
  brandReserve?: number
  minBrandKeywords?: number
  brandOnly?: boolean
}

export interface BuildCreativeKeywordSetOutput {
  promptKeywords: string[]
  executableKeywords: string[]
  executableKeywordCandidates: CreativeKeywordCandidate[]
  candidatePool: CreativeKeywordCandidate[]
  // Deprecated compatibility projection. Prefer `executableKeywords`.
  keywords: string[]
  keywordsWithVolume: PoolKeywordData[]
  keywordSupplementation?: KeywordSupplementationReport
  contextFallbackStrategy: 'filtered' | 'keyword_pool' | 'original'
  audit: CreativeKeywordAudit
  // Deprecated compatibility field. Prefer `audit`.
  keywordSourceAudit: CreativeKeywordSourceAudit
}

interface CreativeKeywordCandidateProvenance {
  source?: string
  sourceType?: string
  sourceSubtype?: string
  rawSource?: string
  sourceField?: string
}

export interface CreativeKeywordCandidate {
  keyword: string
  searchVolume: number
  rawSource?: string
  sourceSubtype?: string
  derivedTags?: string[]
  sourceField?: string
  evidence?: string[]
  creativeAffinity?: {
    label: 'brand' | 'model' | 'product' | 'mixed' | 'unknown'
    score: number
    level: 'high' | 'medium' | 'low'
  }
  promptEligible?: boolean
  executableEligible?: boolean
  provenance?: CreativeKeywordCandidateProvenance[]
}

interface CreativeKeywordSourceRatioItem {
  count: number
  ratio: number
}

interface CreativeKeywordContextFilterStats {
  removedByContextMismatch: number
  removedByForbidden: number
  removedByQuality: number
  removedByModelFamily: number
  removedByIntentTightening: number
}

interface CreativeKeywordSelectionMetrics {
  contractSatisfied: boolean
  requiredKeywords: CreativeKeywordSourceRatioItem
  fallbackKeywords: CreativeKeywordSourceRatioItem
  modelFamilyGuardKeywords: CreativeKeywordSourceRatioItem
  pureBrandKeywords: CreativeKeywordSourceRatioItem
  nonPureBrandKeywords: CreativeKeywordSourceRatioItem
  dNonPureBrandKeywords: CreativeKeywordSourceRatioItem
  hardModelKeywords: CreativeKeywordSourceRatioItem
  softFamilyKeywords: CreativeKeywordSourceRatioItem
  finalRescueKeywords: CreativeKeywordSourceRatioItem
}

const CREATIVE_PROMPT_KEYWORD_LIMIT = KEYWORD_POLICY.creative.promptKeywordLimit
const BUILDER_MODEL_ANCHOR_PATTERN = /\b[a-z]*\d+[a-z0-9-]*\b/i
const BUILDER_STANDALONE_MODEL_TOKEN_PATTERN = /^[a-z][a-z0-9-]*\d[a-z0-9-]*$/i
const BUILDER_OFFER_CONTEXT_FILTERED_TAG = 'OFFER_CONTEXT_FILTERED'
const RESCUE_PREFIX_NOISE_TOKENS = new Set([
  'app',
  'apps',
  'better',
  'clinically',
  'proven',
  'first',
  'include',
  'included',
  'includes',
  'including',
  'improve',
  'improved',
  'improves',
  'improving',
  'prevent',
  'prevents',
  'prevented',
  'preventing',
  'reduce',
  'reduces',
  'reduced',
  'reducing',
  'reduction',
  'remove',
  'removes',
  'removed',
  'removing',
  'subscription',
  'subscriptions',
  'help',
  'helps',
  'helped',
  'helping',
  'new',
  'no',
  'with',
  'without',
  'for',
  'from',
  'and',
  'the',
  'a',
  'an',
  'pack',
  'count',
  'pc',
  'piece',
  'pieces',
  'set',
  'world',
  'worlds',
])
const RESCUE_BREAK_TOKENS = new Set([
  'app',
  'apps',
  'at',
  'by',
  'buy',
  'compatible',
  'cost',
  'details',
  'for',
  'official',
  'order',
  'page',
  'pages',
  'price',
  'prices',
  'purchase',
  'sale',
  'shop',
  'shopping',
  'store',
  'stores',
  'subscription',
  'subscriptions',
  'with',
  'without',
  'from',
  'in',
  'of',
  'on',
  'to',
  'include',
  'included',
  'includes',
  'including',
  'clinically',
  'proven',
  'improve',
  'improved',
  'improves',
  'improving',
  'prevent',
  'prevents',
  'prevented',
  'preventing',
  'reduce',
  'reduces',
  'reduced',
  'reducing',
  'reduction',
  'remove',
  'removes',
  'removed',
  'removing',
  'help',
  'helps',
  'helped',
  'helping',
  'http',
  'https',
  'www',
  'com',
  'net',
  'org',
  'html',
  'htm',
  'php',
  'asp',
  'aspx',
  'product',
  'products',
  'item',
  'items',
  'detail',
  'details',
  'page',
  'pages',
])
const RESCUE_TRAILING_CONNECTOR_TOKENS = new Set([
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'to',
  'with',
  'without',
  'and',
  'or',
])
const RESCUE_TRAILING_CONNECTOR_ALLOWED_BIGRAMS = new Set([
  'check in',
  'log in',
  'sign in',
])
const RESCUE_SHORT_NUMERIC_SUFFIX_ALLOWED_PREV_TOKENS = new Set([
  'gen',
  'mark',
  'mk',
  'series',
  'ver',
  'version',
])
const RESCUE_INLINE_SKIP_TOKENS = new Set([
  'and',
  'for',
  'or',
  'plus',
  's',
])
const RESCUE_SEGMENT_SPLIT_PATTERN = /[,;:()\-–—|]+/
const RESCUE_CONTEXT_TEXT_MAX_ITEMS = 16
const RESCUE_CONTEXT_DETAIL_MAX_CANDIDATES: Record<'brand_intent' | 'model_intent' | 'product_intent', number> = {
  brand_intent: 10,
  model_intent: 8,
  product_intent: 12,
}
const RESCUE_BRAND_SUFFIXES_BY_LANGUAGE: Record<string, string[]> = {
  en: ['official', 'store', 'warranty', 'support', 'reviews', 'shop'],
  de: ['offiziell', 'shop', 'garantie', 'support', 'bewertungen', 'kaufen'],
  it: ['ufficiale', 'negozio', 'garanzia', 'supporto', 'recensioni', 'acquista'],
}
const RESCUE_NEUTRAL_MODEL_TOKEN_PATTERN = /\b[a-z]{1,10}\d[a-z0-9-]{0,10}\b/i
const RESCUE_NEUTRAL_SPEC_TOKEN_PATTERN =
  /\b\d{2,4}\s*(?:gpd|btu|db|inch|in|cm|mm|w|kw|v|mah|wh|hz|oz|lb|lbs|kg)\b/i
const RESCUE_NEUTRAL_RATIO_TOKEN_PATTERN = /\b\d{1,2}\s*:\s*\d{1,2}\b/
const RESCUE_NEUTRAL_CERT_TOKEN_PATTERN = /\bnsf\s*\/?\s*ansi\s*([0-9,&\s]+)/i
const RESCUE_NEUTRAL_DETAIL_MAX_CANDIDATES = 12
const RELAXED_FILTERING_BUCKET_FLOOR_BY_BUCKET: Record<'A' | 'B' | 'D', number> = {
  A: 10,
  B: 8,
  D: 10,
}
const RELAXED_FILTERING_PRIORITY_SOURCE_PATTERNS = [
  'BRAND_SEED',
  'TITLE_EXTRACT',
  'PARAM_EXTRACT',
  'CANONICAL_BUCKET_VIEW',
]
const CREATIVE_KEYWORD_ALERT_CONTEXT_REMOVAL_THRESHOLD = 0.8
const CREATIVE_KEYWORD_ALERT_NON_TARGET_RATIO_THRESHOLD = 0.05

export interface CreativeKeywordSourceAudit {
  totalKeywords: number
  withSearchVolumeKeywords: number
  zeroVolumeKeywords: number
  volumeUnavailableKeywords: number
  noVolumeMode: boolean
  fallbackMode: boolean
  contextFallbackStrategy: 'filtered' | 'keyword_pool' | 'original'
  sourceQuotaAudit: CreativeKeywordSourceQuotaAudit
  contextFilterStats: CreativeKeywordContextFilterStats
  byRawSource: Record<string, CreativeKeywordSourceRatioItem>
  bySourceSubtype: Record<string, CreativeKeywordSourceRatioItem>
  bySourceField: Record<string, CreativeKeywordSourceRatioItem>
  creativeAffinityByLabel: Record<string, CreativeKeywordSourceRatioItem>
  creativeAffinityByLevel: Record<string, CreativeKeywordSourceRatioItem>
  supplementationSources: Record<string, CreativeKeywordSourceRatioItem>
  selectionMetrics: CreativeKeywordSelectionMetrics
  pipeline: {
    initialCandidateCount: number
    initialContextFilteredCount: number
    postSupplementCandidateCount: number
    postSupplementContextFilteredCount: number
    finalCandidatePoolCount: number
    selectionFallbackTriggered: boolean
    selectionFallbackSource: 'filtered' | 'keyword_pool' | 'original'
    selectionFallbackReason: 'none' | 'context_filter_empty' | 'selection_empty' | 'final_invariant'
    contractSatisfiedAfterFallback: boolean
    finalInvariantTriggered: boolean
    finalInvariantCandidateCount: number
    nonEmptyRescueTriggered?: boolean
    nonEmptyRescueCandidateCount?: number
    relaxedFilteringTriggered?: boolean
    relaxedFilteringAddedCount?: number
    relaxedFilteringTargetCount?: number
    relaxedFilteringPostFilterRatio?: number
    supplementAppliedAfterFilter: boolean
  }
}

export type CreativeKeywordAudit = CreativeKeywordSourceAudit

function toFallbackKeywords(input: {
  keywords: string[]
  fallbackSource: string
}): Array<{
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

function normalizeCandidateKey(keyword: unknown): string {
  return String(keyword || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function envEnabled(name: string, defaultEnabled: boolean): boolean {
  const normalized = String(process.env[name] || '').trim().toLowerCase()
  if (!normalized) return defaultEnabled
  if (['0', 'false', 'off', 'no'].includes(normalized)) return false
  if (['1', 'true', 'on', 'yes'].includes(normalized)) return true
  return defaultEnabled
}

function parseBoundedFloatEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = String(process.env[name] || '').trim()
  if (!raw) return fallback
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function resolveSelectedKeywordLanguageRisk(params: {
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
  const nonTargetLanguageCount = keywords.filter((keyword) =>
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

async function emitCreativeKeywordRiskAlerts(params: {
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

  if (params.contextIntentTighteningRemovalRatio > CREATIVE_KEYWORD_ALERT_CONTEXT_REMOVAL_THRESHOLD) {
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

function normalizeBucketForFloor(bucket: BuildCreativeKeywordSetInput['bucket']): 'A' | 'B' | 'D' | null {
  const normalized = String(bucket || '').trim().toUpperCase()
  if (normalized === 'A') return 'A'
  if (normalized === 'B' || normalized === 'C') return 'B'
  if (normalized === 'D' || normalized === 'S') return 'D'
  return null
}

function resolveBucketMinimumKeywordTarget(params: {
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

function isRelaxedFilteringPriorityCandidate(item: PoolKeywordData): boolean {
  const sourceSignals = [
    (item as any)?.source,
    (item as any)?.sourceType,
    (item as any)?.sourceSubtype,
    (item as any)?.rawSource,
    ...(Array.isArray((item as any)?.derivedTags) ? (item as any).derivedTags : []),
  ]
    .map((value) => String(value || '').trim().toUpperCase())
    .filter(Boolean)

  return RELAXED_FILTERING_PRIORITY_SOURCE_PATTERNS.some((pattern) =>
    sourceSignals.some((signal) => signal.includes(pattern))
  )
}

function compareRelaxedFilteringCandidates(a: PoolKeywordData, b: PoolKeywordData): number {
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

function filterLanguageCompatibleCandidates(params: {
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
    new Set(
      values
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  ).slice(0, max)
  return unique.length > 0 ? unique : undefined
}

function normalizeSeedCandidates(seedCandidates: unknown[]): Array<Record<string, any>> {
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
        searchVolume: typeof (item as any).searchVolume === 'number'
          ? (item as any).searchVolume
          : Number((item as any).searchVolume) || 0,
        matchType: ((item as any).matchType || 'PHRASE') as 'EXACT' | 'PHRASE' | 'BROAD',
        source: String((item as any).source || 'KEYWORD_POOL').trim() || 'KEYWORD_POOL',
        sourceType: String((item as any).sourceType || 'CANONICAL_BUCKET_VIEW').trim() || 'CANONICAL_BUCKET_VIEW',
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

function inferCreativeAffinity(params: {
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
  const hasBrand = pureBrandKeywords.length > 0
    ? containsPureBrand(keyword, pureBrandKeywords)
    : false
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
  const level = normalizedScore >= 0.75
    ? 'high'
    : normalizedScore >= 0.5
      ? 'medium'
      : 'low'

  return {
    label,
    score: normalizedScore,
    level,
  }
}

function normalizeCandidateProvenance(item: PoolKeywordData): CreativeKeywordCandidateProvenance | undefined {
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

function mergeCandidateProvenanceRecords(records: Array<CreativeKeywordCandidateProvenance | undefined>): CreativeKeywordCandidateProvenance[] | undefined {
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
    sourceType: String((item as any)?.sourceSubtype || (item as any)?.sourceType || '').trim() || undefined,
  })
}

function mergeKeywordCandidateRecords(existing: PoolKeywordData, incoming: PoolKeywordData): PoolKeywordData {
  const existingScore = normalizeSourceScore(existing)
  const incomingScore = normalizeSourceScore(incoming)
  const incomingVolume = Number((incoming as any)?.searchVolume || 0)
  const existingVolume = Number((existing as any)?.searchVolume || 0)
  const preferIncoming = incomingScore > existingScore || (incomingScore === existingScore && incomingVolume > existingVolume)
  const preferred = preferIncoming ? incoming : existing
  const secondary = preferIncoming ? existing : incoming

  const mergedProvenance = mergeCandidateProvenanceRecords([
    ...((existing as any)?.provenance || []),
    normalizeCandidateProvenance(existing),
    ...((incoming as any)?.provenance || []),
    normalizeCandidateProvenance(incoming),
  ])

  return {
    ...secondary,
    ...preferred,
    keyword: String((existing as any)?.keyword || (incoming as any)?.keyword || '').trim(),
    searchVolume: Math.max(existingVolume, incomingVolume),
    source: String((preferred as any)?.source || (secondary as any)?.source || '').trim() || 'KEYWORD_POOL',
    sourceType: String((preferred as any)?.sourceType || (secondary as any)?.sourceType || '').trim() || undefined,
    sourceSubtype: String((preferred as any)?.sourceSubtype || (secondary as any)?.sourceSubtype || '').trim() || undefined,
    rawSource: String((preferred as any)?.rawSource || (secondary as any)?.rawSource || '').trim() || undefined,
    sourceField: String((preferred as any)?.sourceField || (secondary as any)?.sourceField || '').trim() || undefined,
    derivedTags: normalizeStringList([
      ...((existing as any)?.derivedTags || []),
      ...((incoming as any)?.derivedTags || []),
    ]),
    evidence: normalizeStringList([
      ...((existing as any)?.evidence || []),
      ...((incoming as any)?.evidence || []),
    ], 12),
    provenance: mergedProvenance,
  } as PoolKeywordData
}

function mergeSeedCandidates(input: {
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

function prefixStandaloneModelTokensWithBrand(params: {
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

    if (isShortNumericFragmentKeyword({
      keyword,
      pureBrandKeywords,
    })) {
      removedShortNumericFragmentCount += 1
      continue
    }

    if (
      brandKeyword
      && isStandaloneModelTokenWithoutBrand({
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
    console.log(
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
  return compact && compact !== normalized
    ? [normalized, compact]
    : [normalized]
}

async function buildGlobalKeywordVolumeHintMap(params: {
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
    new Set([
      effectiveLanguage,
      requestedLanguage.toLowerCase(),
    ].filter(Boolean))
  )

  const effectiveCountry = normalizeCountryCode(String(params.targetCountry || 'US').trim() || 'US')
  const placeholders = lookupKeys.map(() => '?').join(',')
  const langPlaceholders = languageCandidates.map(() => '?').join(',')

  try {
    const db = await getDatabase()
    const rows = await db.query(`
      SELECT keyword, search_volume
      FROM global_keywords
      WHERE keyword IN (${placeholders})
        AND country = ?
        AND language IN (${langPlaceholders})
        AND search_volume > 0
    `, [
      ...lookupKeys,
      effectiveCountry,
      ...languageCandidates,
    ]) as Array<{ keyword?: string; search_volume?: number }>

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

function applyGlobalKeywordVolumeBackfill(params: {
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

function extractPoolCandidatesFromSeedCandidates(seedCandidates: PoolKeywordData[]): string[] {
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

function buildPromptKeywordSubset(input: {
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

function filterBlockedPromptKeywords(params: {
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

function toCreativeKeywordCandidate(item: PoolKeywordData, flags?: {
  promptEligible?: boolean
  executableEligible?: boolean
  creativeType?: CanonicalCreativeType | null
  brandName?: string
}): CreativeKeywordCandidate {
  const keyword = String((item as any)?.keyword || '').trim()
  return {
    keyword,
    searchVolume: Number((item as any)?.searchVolume || 0),
    rawSource: String((item as any)?.rawSource || '').trim() || undefined,
    sourceSubtype: String((item as any)?.sourceSubtype || (item as any)?.sourceType || '').trim() || undefined,
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

function isKeywordPoolCandidate(item: PoolKeywordData): boolean {
  const source = String((item as any)?.source || '').trim().toUpperCase()
  const sourceType = String((item as any)?.sourceType || '').trim().toUpperCase()
  const sourceSubtype = String((item as any)?.sourceSubtype || '').trim().toUpperCase()
  const sourceField = String((item as any)?.sourceField || '').trim().toLowerCase()

  return (
    source === 'KEYWORD_POOL'
    || sourceType === 'KEYWORD_POOL'
    || sourceType === 'CANONICAL_BUCKET_VIEW'
    || sourceSubtype === 'KEYWORD_POOL'
    || sourceSubtype === 'CANONICAL_BUCKET_VIEW'
    || sourceField === 'keyword_pool'
  )
}

function hasOfferContextFilteredTag(item: PoolKeywordData): boolean {
  const derivedTags = Array.isArray((item as any)?.derivedTags)
    ? (item as any).derivedTags
    : []
  return derivedTags.some((tag: unknown) =>
    String(tag || '').trim().toUpperCase() === BUILDER_OFFER_CONTEXT_FILTERED_TAG
  )
}

function filterBlockedFallbackCandidates(params: {
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

function resolveKeywordCandidatesAfterContextFilter(params: {
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

function shouldBlockOriginalFallbackForModelIntent(input: {
  creativeType?: CanonicalCreativeType | null
  bucket?: 'A' | 'B' | 'C' | 'D' | 'S' | null
}): boolean {
  if (input.creativeType === 'model_intent') return true
  const normalizedBucket = String(input.bucket || '').trim().toUpperCase()
  return normalizedBucket === 'B' || normalizedBucket === 'C'
}

function countToRatioMap(counts: Record<string, number>, total: number): Record<string, CreativeKeywordSourceRatioItem> {
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

function bumpCount(target: Record<string, number>, key: string | undefined, fallbackKey: string): void {
  const normalized = String(key || '').trim().toUpperCase() || fallbackKey
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
  return String(value || '').trim().toUpperCase()
}

function hasAuditMetricTag(item: PoolKeywordData, expected: string): boolean {
  const normalizedExpected = normalizeAuditMetricValue(expected)
  if (!normalizedExpected) return false
  const derivedTags = Array.isArray((item as any)?.derivedTags)
    ? (item as any).derivedTags
    : []
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
    sourceKeys.includes('CONTRACT_RESCUE')
    || sourceKeys.includes('FINAL_INVARIANT')
    || hasAuditMetricTag(item, 'CONTRACT_RESCUE')
    || hasAuditMetricTag(item, 'FINAL_INVARIANT')
  )
}

function isHardModelKeyword(item: PoolKeywordData): boolean {
  const keyword = String((item as any)?.keyword || '')
  const familyMatchType = String((item as any)?.familyMatchType || '').trim().toLowerCase()
  if (familyMatchType === 'hard_model') return true
  if (familyMatchType === 'mixed') {
    return BUILDER_MODEL_ANCHOR_PATTERN.test(keyword)
  }
  return BUILDER_MODEL_ANCHOR_PATTERN.test(keyword)
}

function isSoftFamilyKeyword(item: PoolKeywordData): boolean {
  const familyMatchType = String((item as any)?.familyMatchType || '').trim().toLowerCase()
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

function buildKeywordSourceAudit(input: {
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
      (item as any)?.volumeUnavailableReason === 'DEV_TOKEN_INSUFFICIENT_ACCESS'
      && searchVolume <= 0
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
  const requiredKeywordsCount = keywords.filter((item) =>
    String((item as any)?.contractRole || '').trim().toLowerCase() === 'required'
  ).length
  const fallbackKeywordsCount = keywords.filter((item) =>
    String((item as any)?.contractRole || '').trim().toLowerCase() === 'fallback'
  ).length
  const modelFamilyGuardCount = keywords.filter(isModelFamilyGuardKeyword).length
  const hardModelCount = keywords.filter(isHardModelKeyword).length
  const softFamilyCount = keywords.filter(isSoftFamilyKeyword).length
  const finalRescueCount = keywords.filter(isFinalRescueKeyword).length
  const dNonPureBrandCount = input.creativeType === 'product_intent'
    ? nonPureBrandCount
    : 0
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

function normalizeRescueKeywordPhrase(text: unknown, maxTokens: number): string | null {
  const normalized = normalizeGoogleAdsKeyword(String(text || ''))
  if (!normalized) return null
  const tokens = compactRescueTokens(normalized.split(/\s+/).filter(Boolean), maxTokens)
  return tokens.length > 0 ? tokens.join(' ') : null
}

function dedupeRescuePhrases(phrases: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const results: string[] = []

  for (const phrase of phrases) {
    const normalized = normalizeCandidateKey(phrase)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    results.push(String(phrase).trim())
  }

  return results
}

function stripBrandTokensFromPhrase(text: unknown, brandName: string | undefined, maxTokens: number): string | null {
  const normalized = normalizeGoogleAdsKeyword(String(text || ''))
  if (!normalized) return null

  const brandTokens = new Set(
    normalizeGoogleAdsKeyword(brandName || '')
      ?.split(/\s+/)
      .filter(Boolean) || []
  )
  const tokens = normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !brandTokens.has(token))
  const compactTokens = compactRescueTokens(tokens, maxTokens)

  return compactTokens.length > 0 ? compactTokens.join(' ') : null
}

function normalizeRescueNumericSeparators(text: string): string {
  let normalized = String(text || '')
  let previous = ''
  while (normalized !== previous) {
    previous = normalized
    normalized = normalized.replace(/(\d)[,\.\u00A0\u202F'\s](?=\d{3}\b)/g, '$1')
  }
  return normalized
}

function extractRescuePhraseCandidates(
  text: unknown,
  brandName: string | undefined,
  maxTokens: number,
  options?: {
    maxSegments?: number
  }
): string[] {
  const raw = normalizeRescueNumericSeparators(String(text || '')).trim()
  if (!raw) return []
  const maxSegments = Math.max(
    1,
    Math.floor(Number(options?.maxSegments || 2))
  )

  const segmentCandidates = raw
    .split(RESCUE_SEGMENT_SPLIT_PATTERN)
    .slice(0, maxSegments)
    .map(segment => stripBrandTokensFromPhrase(segment, brandName, maxTokens))
    .filter(Boolean)

  if (segmentCandidates.length === 0) {
    return dedupeRescuePhrases([
      stripBrandTokensFromPhrase(raw, brandName, maxTokens),
    ])
  }

  return dedupeRescuePhrases(segmentCandidates)
}

function parseOfferTextArray(value: unknown, maxItems: number = RESCUE_CONTEXT_TEXT_MAX_ITEMS): string[] {
  const limit = Math.max(1, Math.floor(Number(maxItems) || RESCUE_CONTEXT_TEXT_MAX_ITEMS))
  const collected: string[] = []
  const queue: unknown[] = [value]

  while (queue.length > 0 && collected.length < limit) {
    const current = queue.shift()
    if (!current) continue

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item)
      }
      continue
    }

    if (typeof current === 'string') {
      const text = current.trim()
      if (!text) continue
      if (
        (text.startsWith('[') && text.endsWith(']'))
        || (text.startsWith('{') && text.endsWith('}'))
      ) {
        try {
          queue.push(JSON.parse(text))
          continue
        } catch {
          // keep as plain string fallback
        }
      }
      collected.push(text)
      continue
    }

    if (typeof current === 'object') {
      const objectValue = current as Record<string, unknown>
      if (typeof objectValue.text === 'string' && objectValue.text.trim()) {
        collected.push(objectValue.text.trim())
        continue
      }
      for (const nestedValue of Object.values(objectValue)) {
        queue.push(nestedValue)
      }
    }
  }

  return collected.slice(0, limit)
}

function extractRescuePhraseCandidatesFromTexts(params: {
  texts: unknown[]
  brandName?: string
  maxTokens: number
  maxSegmentsPerText: number
  maxCandidates: number
}): string[] {
  const results: string[] = []
  for (const rawText of params.texts) {
    if (results.length >= params.maxCandidates) break
    const phrases = extractRescuePhraseCandidates(
      rawText,
      params.brandName,
      params.maxTokens,
      { maxSegments: params.maxSegmentsPerText }
    )
    if (phrases.length === 0) continue
    const combined = buildCombinedRescuePhraseCandidates(
      phrases,
      params.maxTokens
    )
    results.push(...phrases, ...combined)
  }
  return dedupeRescuePhrases(results).slice(0, params.maxCandidates)
}

function buildCombinedRescuePhraseCandidates(
  phrases: string[],
  maxTokens: number
): string[] {
  const combined: string[] = []

  for (let index = 0; index < phrases.length - 1; index += 1) {
    const current = phrases[index]
    const next = phrases[index + 1]
    if (!current || !next) continue
    if (!BUILDER_MODEL_ANCHOR_PATTERN.test(current) && !hasShortRescueBridgeToken(current)) {
      continue
    }

    const candidate = composeRescueKeyword([current, next], maxTokens)
    if (candidate) combined.push(candidate)
  }

  return dedupeRescuePhrases(combined)
}

function hasShortRescueBridgeToken(phrase: string): boolean {
  const normalized = normalizeGoogleAdsKeyword(phrase)
  if (!normalized) return false
  const tokens = normalized.split(/\s+/).filter(Boolean)
  const lastToken = tokens[tokens.length - 1] || ''
  return /^[a-z]{1,2}$/i.test(lastToken)
}

function composeRescueKeyword(parts: Array<string | null | undefined>, maxTokens: number): string | null {
  const normalized = normalizeGoogleAdsKeyword(
    parts
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join(' ')
  )
  if (!normalized) return null

  const tokens = compactRescueTokens(normalized.split(/\s+/).filter(Boolean), maxTokens)
  return tokens.length > 0 ? tokens.join(' ') : null
}

function compactRescueTokens(tokens: string[], maxTokens: number): string[] {
  const compacted: string[] = []
  const seen = new Set<string>()
  for (let index = 0; index < tokens.length; index += 1) {
    const rawToken = tokens[index]
    const token = String(rawToken || '').trim()
    if (!token) continue
    const dedupeKey = token.toLowerCase()
    const isNumeric = /^\d+$/.test(dedupeKey)
    const nextToken = String(tokens[index + 1] || '').trim().toLowerCase()

    if (isNumeric && /^0{3,}\d*$/.test(dedupeKey)) continue

    if (
      isNumeric
      && compacted.length > 0
      && /^\d{1,4}$/.test(compacted[compacted.length - 1])
      && dedupeKey.length === 3
    ) {
      compacted[compacted.length - 1] = `${compacted[compacted.length - 1]}${dedupeKey}`
      continue
    }

    if (
      compacted.length === 0
      && isNumeric
      && ['pack', 'count', 'pc', 'piece', 'pieces', 'set'].includes(nextToken)
    ) {
      index += 1
      continue
    }
    if (compacted.length === 0 && RESCUE_PREFIX_NOISE_TOKENS.has(dedupeKey)) continue
    if (RESCUE_INLINE_SKIP_TOKENS.has(dedupeKey)) continue
    if (compacted.length > 0 && RESCUE_BREAK_TOKENS.has(dedupeKey)) break
    if (!isNumeric && seen.has(dedupeKey)) continue
    compacted.push(token)
    if (!isNumeric) seen.add(dedupeKey)
    if (compacted.length >= maxTokens) break
  }
  return compacted
}

function getNonEmptyRescueCandidateRejectionReason(params: {
  keyword: string
  brandLeadingTokens: Set<string>
}): string | null {
  const normalized = normalizeGoogleAdsKeyword(params.keyword)
  if (!normalized) return 'empty'

  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return 'empty'

  if (tokens.some(token => /^0{3,}\d*$/.test(token))) {
    return 'numeric_fragment'
  }

  const lastToken = tokens[tokens.length - 1] || ''
  if (tokens.length >= 2 && RESCUE_TRAILING_CONNECTOR_TOKENS.has(lastToken)) {
    const lastBigram = tokens.slice(-2).join(' ')
    if (!RESCUE_TRAILING_CONNECTOR_ALLOWED_BIGRAMS.has(lastBigram)) {
      return 'trailing_connector'
    }
  }

  if (
    tokens.length === 2
    && /^\d{1,2}$/.test(tokens[1] || '')
    && params.brandLeadingTokens.has(tokens[0] || '')
  ) {
    return 'brand_short_numeric_fragment'
  }

  if (tokens.length >= 3 && /^\d{1,2}$/.test(tokens[tokens.length - 1] || '')) {
    const penultimateToken = tokens[tokens.length - 2] || ''
    const hasPriorNumericAnchor = tokens
      .slice(0, -1)
      .some(token => /\d/.test(token) && !/^\d{1,2}$/.test(token))
    if (hasPriorNumericAnchor && !RESCUE_SHORT_NUMERIC_SUFFIX_ALLOWED_PREV_TOKENS.has(penultimateToken)) {
      return 'trailing_short_numeric_fragment'
    }
  }

  return null
}

function createNonEmptyRescueCandidate(keyword: string, evidence: string[]): PoolKeywordData {
  return {
    keyword,
    searchVolume: 0,
    source: 'DERIVED_RESCUE',
    matchType: 'PHRASE',
    sourceType: 'BUILDER_NON_EMPTY_RESCUE',
    sourceSubtype: 'BUILDER_NON_EMPTY_RESCUE',
    rawSource: 'DERIVED_RESCUE',
    sourceField: 'derived_rescue',
    derivedTags: ['NON_EMPTY_RESCUE'],
    evidence,
  } as PoolKeywordData
}

function resolveRescueLanguageKey(targetLanguage: unknown): string {
  return normalizeLanguageCode(String(targetLanguage || '').trim() || 'en')
}

function collectLanguageBrandSuffixCandidates(input: {
  targetLanguage?: string | null
  maxCandidates?: number
}): string[] {
  const languageKey = resolveRescueLanguageKey(input.targetLanguage)
  const maxCandidates = Math.max(1, Math.floor(Number(input.maxCandidates) || 6))
  const localized = RESCUE_BRAND_SUFFIXES_BY_LANGUAGE[languageKey] || RESCUE_BRAND_SUFFIXES_BY_LANGUAGE.en
  return dedupeRescuePhrases(localized).slice(0, maxCandidates)
}

function collectNeutralRescueDetailCandidates(
  input: BuildCreativeKeywordSetInput,
  maxTokens: number
): string[] {
  const texts = [
    ...parseOfferTextArray(input.offer.product_name),
    ...parseOfferTextArray(input.offer.category),
    ...parseOfferTextArray(input.offer.unique_selling_points),
    ...parseOfferTextArray(input.offer.product_highlights),
    ...parseOfferTextArray(input.offer.extracted_headlines),
    ...parseOfferTextArray(input.offer.extracted_keywords),
    ...parseOfferTextArray(input.offer.enhanced_headlines),
    ...parseOfferTextArray(input.offer.enhanced_keywords),
  ]

  const candidates: string[] = []
  const pushCandidate = (raw: string | null | undefined) => {
    const normalized = normalizeRescueKeywordPhrase(raw, maxTokens)
    if (!normalized) return
    if (!/\d/.test(normalized) && !/\b(?:nsf|ansi|ro|ph|tds|gpd|btu)\b/i.test(normalized)) {
      return
    }
    candidates.push(normalized)
  }

  for (const text of texts) {
    const normalizedText = normalizeRescueNumericSeparators(String(text || ''))
    if (!normalizedText) continue

    for (const match of normalizedText.matchAll(new RegExp(RESCUE_NEUTRAL_MODEL_TOKEN_PATTERN.source, 'gi'))) {
      pushCandidate(match[0] || '')
    }
    for (const match of normalizedText.matchAll(new RegExp(RESCUE_NEUTRAL_SPEC_TOKEN_PATTERN.source, 'gi'))) {
      pushCandidate(match[0] || '')
    }
    for (const match of normalizedText.matchAll(new RegExp(RESCUE_NEUTRAL_RATIO_TOKEN_PATTERN.source, 'g'))) {
      pushCandidate(match[0] || '')
    }
    for (const certMatch of normalizedText.matchAll(new RegExp(RESCUE_NEUTRAL_CERT_TOKEN_PATTERN.source, 'gi'))) {
      const certNumbers = Array.from(String(certMatch[1] || '').matchAll(/\d{1,3}/g)).map((item) => item[0])
      for (const certNumber of certNumbers) {
        pushCandidate(`nsf ansi ${certNumber}`)
      }
    }
  }

  return dedupeRescuePhrases(candidates).slice(0, RESCUE_NEUTRAL_DETAIL_MAX_CANDIDATES)
}

function buildNonEmptyRescueCandidates(input: BuildCreativeKeywordSetInput): PoolKeywordData[] {
  const creativeType = input.creativeType || null
  const combinedTokenLimit = creativeType === 'model_intent' ? 6 : 5
  const detailTokenLimit = creativeType === 'model_intent' ? 5 : 4
  const contextMaxCandidates = creativeType === 'model_intent'
    ? RESCUE_CONTEXT_DETAIL_MAX_CANDIDATES.model_intent
    : creativeType === 'product_intent'
      ? RESCUE_CONTEXT_DETAIL_MAX_CANDIDATES.product_intent
      : RESCUE_CONTEXT_DETAIL_MAX_CANDIDATES.brand_intent
  const normalizedBrand = normalizeRescueKeywordPhrase(
    input.brandName || input.offer.brand || '',
    3
  )
  const pureBrandKeyword = getPureBrandKeywords(input.brandName || input.offer.brand || '')[0]
    || normalizedBrand
    || null
  const brandLeadingTokens = new Set(
    dedupeRescuePhrases([normalizedBrand, pureBrandKeyword])
      .map((keyword) => normalizeGoogleAdsKeyword(keyword) || '')
      .map((keyword) => keyword.split(/\s+/).filter(Boolean)[0] || '')
      .filter(Boolean)
  )
  const productSegmentCandidates = extractRescuePhraseCandidates(
    input.offer.product_name || '',
    normalizedBrand || undefined,
    detailTokenLimit,
    { maxSegments: 6 }
  )
  const offerContextTexts = [
    ...parseOfferTextArray(input.offer.extracted_headlines),
    ...parseOfferTextArray(input.offer.extracted_keywords),
    ...parseOfferTextArray(input.offer.enhanced_headlines),
    ...parseOfferTextArray(input.offer.enhanced_keywords),
    ...parseOfferTextArray(input.offer.product_highlights),
    ...parseOfferTextArray(input.offer.unique_selling_points),
  ]
  const contextDetailCandidates = extractRescuePhraseCandidatesFromTexts({
    texts: offerContextTexts,
    brandName: normalizedBrand || undefined,
    maxTokens: detailTokenLimit,
    maxSegmentsPerText: creativeType === 'model_intent' ? 3 : 4,
    maxCandidates: contextMaxCandidates,
  })
  const combinedProductCandidates = buildCombinedRescuePhraseCandidates(
    productSegmentCandidates,
    detailTokenLimit
  )
  const shortBridgeSegmentIndexes = new Set<number>()
  for (let index = 0; index < productSegmentCandidates.length - 1; index += 1) {
    if (hasShortRescueBridgeToken(productSegmentCandidates[index])) {
      shortBridgeSegmentIndexes.add(index)
    }
  }
  const productDetailCandidates = dedupeRescuePhrases([
    ...combinedProductCandidates,
    ...productSegmentCandidates.filter((_, index) => !shortBridgeSegmentIndexes.has(index)),
    ...contextDetailCandidates,
  ]).slice(0, Math.max(6, contextMaxCandidates))
  const categoryDetailCandidates = extractRescuePhraseCandidates(
    input.offer.category || '',
    normalizedBrand || undefined,
    3,
    { maxSegments: 3 }
  ).slice(0, 3)
  const languageBrandSuffixCandidates = collectLanguageBrandSuffixCandidates({
    targetLanguage: input.targetLanguage || input.offer.target_language,
    maxCandidates: 6,
  })
  const neutralDetailCandidates = collectNeutralRescueDetailCandidates(input, detailTokenLimit)
  const productCore = productDetailCandidates[0] || null
  const categoryCore = categoryDetailCandidates[0] || null

  const results: PoolKeywordData[] = []
  const seen = new Set<string>()
  const pushCandidate = (keyword: string | null, evidence: string[]) => {
    if (!keyword) return
    if (getNonEmptyRescueCandidateRejectionReason({
      keyword,
      brandLeadingTokens,
    })) return
    const normalized = normalizeCandidateKey(keyword)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    results.push(createNonEmptyRescueCandidate(keyword, evidence))
  }
  const pushBrandedRescueCandidate = (
    detailKeyword: string | null,
    evidence: string[]
  ) => {
    if (!normalizedBrand) return
    if (creativeType === 'model_intent' && !detailKeyword) return
    pushCandidate(
      composeRescueKeyword([normalizedBrand, detailKeyword], combinedTokenLimit),
      evidence
    )
  }
  const pushBrandedRescueCandidates = (
    detailKeywords: string[],
    evidence: string[]
  ) => {
    for (const detailKeyword of detailKeywords) {
      pushBrandedRescueCandidate(detailKeyword, evidence)
    }
  }
  const pushRescueCandidatePreferBranded = (
    detailKeyword: string | null,
    evidence: string[]
  ) => {
    if (normalizedBrand) {
      pushBrandedRescueCandidate(detailKeyword, evidence)
      return
    }
    pushCandidate(detailKeyword, evidence)
  }

  if (creativeType === 'brand_intent' || creativeType === 'product_intent') {
    pushCandidate(pureBrandKeyword, ['pure_brand_floor'])
  }

  if (normalizedBrand) {
    if (creativeType === 'brand_intent' || creativeType === 'product_intent' || !creativeType) {
      pushBrandedRescueCandidates(languageBrandSuffixCandidates, ['localized_brand_suffix'])
    }
    pushBrandedRescueCandidates(neutralDetailCandidates, ['offer_neutral_specs'])
    pushBrandedRescueCandidates(productDetailCandidates, ['offer_product_name'])
    pushBrandedRescueCandidates(contextDetailCandidates, ['offer_context'])
    if (creativeType !== 'model_intent' || productDetailCandidates.length === 0) {
      pushBrandedRescueCandidates(categoryDetailCandidates, ['offer_category'])
    }
  }

  if (creativeType === 'model_intent') {
    const productModelDetailCandidates = productDetailCandidates
      .filter(candidate => BUILDER_MODEL_ANCHOR_PATTERN.test(candidate))
      .slice(0, 4)
    const productHasModelAnchor = productModelDetailCandidates.length > 0
    const categoryHasModelAnchor = Boolean(categoryCore && BUILDER_MODEL_ANCHOR_PATTERN.test(categoryCore))
    if (!normalizedBrand || productHasModelAnchor) {
      for (const candidate of productModelDetailCandidates) {
        pushRescueCandidatePreferBranded(candidate, ['offer_product_name'])
      }
    }
    if (!normalizedBrand || categoryHasModelAnchor) {
      pushRescueCandidatePreferBranded(categoryCore, ['offer_category'])
    }
    for (const neutralCandidate of neutralDetailCandidates) {
      if (!BUILDER_MODEL_ANCHOR_PATTERN.test(neutralCandidate)) continue
      pushRescueCandidatePreferBranded(neutralCandidate, ['offer_neutral_specs'])
    }
  } else if (creativeType === 'product_intent' || !creativeType) {
    pushRescueCandidatePreferBranded(productCore, ['offer_product_name'])
    pushRescueCandidatePreferBranded(categoryCore, ['offer_category'])
    for (const neutralCandidate of neutralDetailCandidates) {
      pushRescueCandidatePreferBranded(neutralCandidate, ['offer_neutral_specs'])
    }
  }

  return results
}

function buildNonEmptyRescueSourceQuotaAudit(params: {
  fallbackMode: boolean
  keywordCount: number
}): CreativeKeywordSourceQuotaAudit {
  const count = Math.max(0, Math.floor(params.keywordCount))
  return {
    enabled: true,
    fallbackMode: params.fallbackMode,
    targetCount: count,
    requiredBrandCount: 0,
    acceptedBrandCount: 0,
    acceptedCount: count,
    deferredCount: 0,
    deferredRefillCount: 0,
    deferredRefillTriggered: false,
    underfillBeforeRefill: 0,
    quota: {
      combinedLowTrustCap: Math.max(1, count),
      aiCap: Math.max(1, count),
      aiLlmRawCap: Math.max(1, count),
    },
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
  }
}

function augmentSourceQuotaAuditWithRescue(params: {
  audit: CreativeKeywordSourceQuotaAudit
  keywordsWithVolume: PoolKeywordData[]
  brandName: string | undefined
}): CreativeKeywordSourceQuotaAudit {
  const pureBrandKeywords = getPureBrandKeywords(params.brandName || '')
  const acceptedBrandCount = params.keywordsWithVolume.filter((item) =>
    containsPureBrand(String((item as any)?.keyword || ''), pureBrandKeywords)
  ).length

  return {
    ...params.audit,
    targetCount: Math.max(params.audit.targetCount, params.keywordsWithVolume.length),
    acceptedBrandCount,
    acceptedCount: params.keywordsWithVolume.length,
  }
}

export async function buildCreativeKeywordSet(
  input: BuildCreativeKeywordSetInput
): Promise<BuildCreativeKeywordSetOutput> {
  const fallbackSource = String(input.fallbackSource || 'AI_GENERATED').trim().toUpperCase() || 'AI_GENERATED'
  const primaryCandidates = normalizeCreativeKeywordCandidatesForContextFilter(
    Array.isArray(input.keywordsWithVolume) && input.keywordsWithVolume.length > 0
      ? input.keywordsWithVolume
      : toFallbackKeywords({
        keywords: Array.isArray(input.keywords) ? input.keywords : [],
        fallbackSource,
      }),
    fallbackSource
  )
  const rawSeedCandidates = Array.isArray(input.seedCandidates) && input.seedCandidates.length > 0
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
  const canReuseContextFilteredSeedCandidates = (
    primaryCandidates.length === 0
    && originalCandidates.length > 0
    && originalCandidates.every((item) => hasOfferContextFilteredTag(item as PoolKeywordData))
  )

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
  const accumulateBlockedFallbackKeywordKeys = (report: {
    blockedKeywordKeys?: string[]
  }) => {
    for (const keywordKey of report.blockedKeywordKeys || []) {
      const normalized = normalizeCandidateKey(keywordKey)
      if (normalized) blockedFallbackKeywordKeys.add(normalized)
    }
  }
  const applyLanguageGate = (candidates: PoolKeywordData[], stageLabel: string): PoolKeywordData[] => {
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
  const runContextFilter = (keywordsWithVolume: PoolKeywordData[]) => filterCreativeKeywordsByOfferContextDetailed({
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
        const candidatesNeedingFilter = supplementedCandidates.filter((item) =>
          !hasOfferContextFilteredTag(item as PoolKeywordData)
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
      console.warn(
        `[buildCreativeKeywordSet] 补词失败（继续执行）: ${error?.message || error}`
      )
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
  const minimumSelectedKeywordCount = resolveCreativeKeywordMinimumOutputCount({
    creativeType: input.creativeType || null,
    maxKeywords,
    bucket: input.bucket,
  })
  const relaxedFilteringTargetCount = resolveBucketMinimumKeywordTarget({
    bucket: input.bucket,
    maxKeywords,
    fallbackMinimum: minimumSelectedKeywordCount,
  })
  let relaxedFilteringTriggered = false
  let relaxedFilteringAddedCount = 0
  let relaxedFilteringPostFilterRatio = 0

  const contextIntentTighteningRemoved = (
    contextFilterStats.removedByContextMismatch + contextFilterStats.removedByIntentTightening
  )
  const contextIntentTighteningDenominator = Math.max(
    1,
    initialCandidateCount,
    postSupplementCandidateCount
  )
  const contextIntentTighteningRemovalRatio = Math.min(
    1,
    contextIntentTighteningRemoved / contextIntentTighteningDenominator
  )
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
    relaxedFilteringEnabled
    && contextFilteredCandidates.length > 0
    && relaxedFilteringPostFilterRatio < relaxedFilteringTriggerRatio
    && contextFilteredCandidates.length < relaxedFilteringTargetCount
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

  const selectFromCandidates = (selectionCandidates: PoolKeywordData[], preferredBucketKeywords: string[]) =>
    selectCreativeKeywords({
      keywords: selectionCandidates.map((item) => item.keyword),
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
    (
      blockOriginalFallback && fallbackResolved.strategy === 'original'
        ? []
        : fallbackResolved.keywords
    ) as PoolKeywordData[],
    poolCandidates
  )
  let selectionStrategy = (
    blockOriginalFallback && fallbackResolved.strategy === 'original'
      ? 'keyword_pool'
      : fallbackResolved.strategy
  )
  let selectionFallbackReason: CreativeKeywordSourceAudit['pipeline']['selectionFallbackReason'] =
    fallbackResolved.strategy === 'filtered' ? 'none' : 'context_filter_empty'
  let finalInvariantTriggered = false
  let finalInvariantCandidateCount = 0
  let nonEmptyRescueTriggered = false
  let nonEmptyRescueCandidateCount = 0

  const keywordPoolCandidates = candidatePoolSource.filter(isKeywordPoolCandidate)
  if (
    selected.keywords.length === 0
    && selectionStrategy !== 'keyword_pool'
    && keywordPoolCandidates.length > 0
  ) {
    selected = selectFromCandidates(keywordPoolCandidates, poolCandidates)
    selectionStrategy = 'keyword_pool'
    if (selectionFallbackReason === 'none') {
      selectionFallbackReason = 'selection_empty'
    }
  }

  if (
    selected.keywords.length === 0
    && selectionStrategy !== 'original'
    && candidatePoolSource.length > 0
    && !blockOriginalFallback
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
    const currentCount = Array.isArray(selected.keywordsWithVolume) ? selected.keywordsWithVolume.length : 0
    if (
      prefixed.prefixedCount <= 0
      && prefixed.removedShortNumericFragmentCount <= 0
      && prefixed.keywordsWithVolume.length === currentCount
    ) return
    selected = {
      ...selected,
      keywordsWithVolume: prefixed.keywordsWithVolume as any,
      keywords: prefixed.keywordsWithVolume.map((item) => item.keyword),
    }
  }

  normalizeSelectedStandaloneModelTokens()

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

      let nextSelected = rescueSelected.keywords.length > selected.keywords.length
        ? rescueSelected
        : selected

      if (nextSelected.keywords.length < minimumSelectedKeywordCount) {
        const existingKeywordKeys = new Set(
          ((nextSelected.keywordsWithVolume as PoolKeywordData[]) || [])
            .map((item) => normalizeCandidateKey((item as any)?.keyword))
            .filter(Boolean)
        )
        const manualRescueCandidates = nonEmptyRescueCandidates.filter((item) => {
          const key = normalizeCandidateKey((item as any)?.keyword)
          return Boolean(key) && !existingKeywordKeys.has(key)
        }).slice(0, Math.max(0, minimumSelectedKeywordCount - nextSelected.keywords.length))

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
              audit: nextSelected.keywords.length > 0
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
    const fallbackInvariantTopUpCandidates = candidatePoolSource
      .filter((item) => {
        const key = normalizeCandidateKey((item as any)?.keyword)
        return Boolean(key) && !existingKeywordKeys.has(key)
      })
      .sort(compareRelaxedFilteringCandidates)
      .slice(0, Math.max(0, minimumSelectedKeywordCount - selected.keywords.length))

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
          audit: selected.sourceQuotaAudit || buildNonEmptyRescueSourceQuotaAudit({
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
  const executableKeywordCandidates = (selected.keywordsWithVolume as PoolKeywordData[]).map((item) =>
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
    keywords: selected.keywords,
    keywordsWithVolume: selected.keywordsWithVolume as PoolKeywordData[],
    keywordSupplementation,
    contextFallbackStrategy: selectionStrategy,
    audit,
    keywordSourceAudit: audit,
  }
}
