import { containsPureBrand, getPureBrandKeywords, isPureBrandKeyword } from './brand-keyword-utils'
import {
  deriveCanonicalCreativeType,
  hasModelAnchorEvidence,
  type CanonicalCreativeType,
} from './creative-type'
import {
  getKeywordSourcePriority,
  getKeywordSourceRankFromInput,
  inferKeywordDerivedTags,
  inferKeywordRawSource,
  normalizeKeywordSourceSubtype,
  type KeywordSourceTier,
} from './creative-keyword-source-priority'
import { resolveCreativeKeywordMinimumOutputCount } from './creative-keyword-output-floor'
import { normalizeGoogleAdsKeyword } from './google-ads-keyword-normalizer'
import { containsAsinLikeToken } from './model-anchor-evidence'
import {
  analyzeKeywordLanguageCompatibility,
  type KeywordLanguageCompatibility,
} from './keyword-validity'

export const CREATIVE_KEYWORD_MAX_COUNT = 50
export const CREATIVE_BRAND_KEYWORD_RESERVE = 10
export const CREATIVE_KEYWORD_MAX_WORDS = 6
export const CREATIVE_KEYWORD_MAX_WORDS_BY_TYPE: Record<CanonicalCreativeType, number> = {
  brand_intent: 6,
  model_intent: 7,
  product_intent: 8,
}
const MODEL_INTENT_BRAND_FLOOR = 3
const MODEL_INTENT_UNDERFILL_CANDIDATE_FLOOR = 8
const MODEL_INTENT_BRANDED_SINGLE_CORE_SEARCH_VOLUME_FLOOR = 2000
const PRODUCT_INTENT_BRAND_FLOOR = 1
const PRODUCT_INTENT_NON_BRAND_FLOOR = 2

type CreativeBucket = 'A' | 'B' | 'C' | 'D' | 'S'
export type CreativeKeywordMatchType = 'EXACT' | 'PHRASE' | 'BROAD'

export interface KeywordLanguageSignals {
  targetLanguage?: string
  allowedLanguageHints?: string[]
  detectedLanguageHints?: string[]
  contentTokenCount?: number
  unauthorizedContentTokenCount?: number
  unauthorizedContentRatio?: number
  unauthorizedHeadToken?: string
  softDemote?: boolean
}

export interface KeywordDecisionTraceEntry {
  stage: 'global_validity' | 'source_governance' | 'slot_contract' | 'fallback' | 'final_invariant'
  outcome: string
  note?: string
  evidence?: string[]
}

export interface KeywordAuditMetadata {
  sourceType?: string
  sourceSubtype?: string
  sourceTier?: KeywordSourceTier
  sourceGovernanceBucket?: SourceGovernanceBucket
  sourceTop1Eligible?: boolean
  sourceTop2Eligible?: boolean
  rawSource?: string
  derivedTags?: string[]
  isDerived?: boolean
  isFallback?: boolean
  sourceField?: string
  anchorType?: string
  anchorKinds?: string[]
  languageSignals?: KeywordLanguageSignals
  contractRole?: 'required' | 'optional' | 'fallback'
  evidenceStrength?: 'high' | 'medium' | 'low'
  familyMatchType?: 'hard_model' | 'soft_family' | 'product_demand' | 'brand' | 'mixed'
  fallbackReason?: string
  rescueStage?: 'context_filter' | 'post_selection' | 'final_invariant'
  filteredReasons?: string[]
  evidence?: string[]
  suggestedMatchType?: CreativeKeywordMatchType
  confidence?: number
  qualityReason?: string
  rejectionReason?: string
  decisionTrace?: KeywordDecisionTraceEntry[]
}

export interface CreativeKeywordLike extends KeywordAuditMetadata {
  keyword: string
  searchVolume: number
  competition?: string
  competitionIndex?: number
  source?: string
  matchType?: CreativeKeywordMatchType
  lowTopPageBid?: number
  highTopPageBid?: number
  volumeUnavailableReason?: string
}

export interface SelectCreativeKeywordsInput {
  keywords?: string[]
  keywordsWithVolume?: CreativeKeywordLike[]
  brandName?: string
  targetLanguage?: string
  creativeType?: CanonicalCreativeType | null
  bucket?: CreativeBucket | null
  preferredBucketKeywords?: string[]
  fallbackMode?: boolean
  maxKeywords?: number
  brandReserve?: number
  minBrandKeywords?: number
  brandOnly?: boolean
  maxWords?: number
}

export interface SelectCreativeKeywordsOutput {
  keywords: string[]
  keywordsWithVolume: CreativeKeywordLike[]
  truncated: boolean
  sourceQuotaAudit: CreativeKeywordSourceQuotaAudit
}

interface RankedCandidate extends CreativeKeywordLike {
  normalized: string
  permutationKey: string
  originalIndex: number
  isBrand: boolean
  isPureBrand: boolean
  isPreferredBucket: boolean
  sourceRank: number
  matchTypeRank: number
  intentRank: number
  wordCount: number
  evidenceProfile: CandidateEvidenceProfile
}

interface CandidateIntentScores {
  brand_intent: number
  model_intent: number
  product_intent: number
}

interface CandidateEvidenceProfile {
  hasModelAnchor: boolean
  hasDemand: boolean
  demandAnchorCount: number
  hasSpecificDemandTail: boolean
  isTransactional: boolean
  isAiGenerated: boolean
  isModelFamilyGuard: boolean
  trustedSoftFamily: boolean
  compactTrustedSoftFamily: boolean
  hasReliableSearchVolume: boolean
  sourceTrustScore: number
  preferredBucketSoftPrior: number
  intentScores: CandidateIntentScores
  selectedIntentScore: number
  secondaryIntentScore: number
  intentMargin: number
  languageSoftDemote: boolean
  unauthorizedContentRatio: number
}

export interface SourceQuotaConfig {
  combinedLowTrustCap: number
  aiCap: number
  aiLlmRawCap: number
}

export interface CreativeKeywordSourceQuotaAudit {
  enabled: boolean
  fallbackMode: boolean
  targetCount: number
  requiredBrandCount: number
  acceptedBrandCount: number
  acceptedCount: number
  deferredCount: number
  deferredRefillCount: number
  deferredRefillTriggered: boolean
  underfillBeforeRefill: number
  quota: SourceQuotaConfig
  acceptedByClass: {
    lowTrust: number
    ai: number
    aiLlmRaw: number
  }
  blockedByCap: {
    lowTrust: number
    ai: number
    aiLlmRaw: number
  }
}

export type SourceGovernanceBucket =
  | 'primary'
  | 'conditional'
  | 'rescue'
  | 'synthetic'
  | 'unknown'

const D_INTENT_PATTERN = /\b(buy|price|deal|sale|discount|coupon|offer|cost|cheap|best|review|reviews?)\b/i
const A_TRUST_PATTERN = /\b(official|authentic|original|genuine|warranty|trusted|brand)\b/i
const B_SCENARIO_PATTERN = /\b(for|outdoor|indoor|home|office|garden|yard|driveway|wall|path|walkway|pool|tree)\b/i
const PLATFORM_PATTERN = /\b(amazon|walmart|ebay|etsy|aliexpress|temu)\b/i
const COMMUNITY_PATTERN = /\b(reddit|quora|forum|forums)\b/i
const INFO_QUERY_PATTERN = /\b(what is|meaning|tutorial|guide|manual|how to|instructions?)\b/i
const QUESTION_PREFIX_PATTERN = /^(?:what|why|how|when|where|who|which|is|are|do|does|can|should|could)\b/i
const REVIEW_COMPARE_PATTERN = /\b(review|reviews|comparison|compare|vs)\b/i
const PRICE_TRACKER_PATTERN = /\b(price\s*tracker|track(?:ing)?\s*price)\b/i
const NOISE_STACK_PATTERN = /\b(electronics?\s+photo\s+wearable\s+technology|photo\s+wearable\s+technology)\b/i
const REPEATED_ACTION_PATTERN = /\b(buy|shop|purchase|order)\b.*\b\1\b/i
const LOCALE_NOISE_PATTERN = /\b(ulasan|kabupaten|bekasi|shopee|kasur|gambar|colchon|rng)\b/i
const BRAND_SLOGAN_PATTERN = /\b(a\s+cozy\s+home\s+made\s+simple|home\s+made\s+simple)\b/i
const URL_FRAGMENT_PATTERN = /\b(?:https?|www|com|dp)\b/i
const COMPONENT_NOISE_PATTERN = /\b(?:included\s+components?|package\s+contents?|box\s+contents?|what\s+s?\s+in\s+the\s+box)\b/i
const MODEL_INTENT_GENERIC_SPILLOVER_PATTERN = /\b(option|options|choice|choices|premium|quality|value|online|daily|everyday|results?|system|technology|performance|style|styles)\b/i
const PROMO_PATTERN = /\b(discount|coupon|cheap|sale|deal|offer|promo|price|cost)\b/i
const STORE_NAV_PATTERN = /\b(official\s+store|store\s+locator|near\s+me|shop\s+near\s+me)\b/i
const FEATURE_SCENARIO_PATTERN = /\b(cordless|wireless|portable|smart|pet|outdoor|indoor|home|office|travel|waterproof|quiet|fast|compact|lightweight)\b/i
const TRANSACTIONAL_MODIFIER_PATTERN = /\b(buy|purchase|order|shop|shopping|shops|price|pricing|cost|deal|deals|discount|sale|offer|coupon|promo|store)\b/i
const TRANSACTIONAL_MODIFIER_TOKENS = new Set([
  'buy',
  'purchase',
  'order',
  'shop',
  'shopping',
  'shops',
  'price',
  'pricing',
  'cost',
  'deal',
  'deals',
  'discount',
  'sale',
  'offer',
  'coupon',
  'promo',
  'store',
])
const NON_ANCHOR_TOKENS = new Set([
  'official', 'store', 'shop', 'near', 'me', 'brand', 'buy', 'sale', 'deal', 'discount',
  'coupon', 'offer', 'promo', 'price', 'cost', 'cheap', 'best', 'review', 'reviews',
  'comparison', 'compare', 'vs', 'online', 'for', 'with', 'and', 'the', 'a', 'an',
])
const DEMAND_FALLBACK_NOISE_TOKENS = new Set([
  'better',
  'clinically',
  'proven',
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
  'help',
  'helps',
  'helped',
  'helping',
  'pack',
  'count',
  'pc',
  'piece',
  'pieces',
  'set',
  'official',
  'store',
  'shop',
  'shops',
  'brand',
  'http',
  'https',
  'www',
  'com',
  'dp',
  'component',
  'components',
  'content',
  'contents',
])
const MODEL_INTENT_SOFT_FAMILY_NOISE_TOKENS = new Set([
  'comfort',
  'edition',
  'first',
  'gen',
  'generation',
  'pressure',
  'relief',
  'model',
  'series',
  'support',
  'version',
  'world',
  'worlds',
])

function normalizeSourceRank(source: string | undefined, sourceType: string | undefined): number {
  return getKeywordSourceRankFromInput({ source, sourceType })
}

export function resolveCreativeKeywordMaxWords(creativeType: CanonicalCreativeType | null | undefined): number {
  if (!creativeType) return CREATIVE_KEYWORD_MAX_WORDS
  return CREATIVE_KEYWORD_MAX_WORDS_BY_TYPE[creativeType] || CREATIVE_KEYWORD_MAX_WORDS
}

function normalizeMatchTypeRank(matchType: string | undefined): number {
  const normalized = String(matchType || '').toUpperCase()
  if (normalized === 'EXACT') return 3
  if (normalized === 'PHRASE') return 2
  if (normalized === 'BROAD') return 1
  return 0
}

function isSearchVolumeUnavailableReason(reason: unknown): boolean {
  const normalized = String(reason || '').trim().toUpperCase()
  return normalized.startsWith('DEV_TOKEN_')
}

function hasActiveSearchVolumeUnavailableFlag(item: {
  searchVolume?: unknown
  volumeUnavailableReason?: unknown
} | null | undefined): boolean {
  if (!isSearchVolumeUnavailableReason(item?.volumeUnavailableReason)) return false
  return Number(item?.searchVolume || 0) <= 0
}

function hasReliableSearchVolumeSignal(params: {
  searchVolume?: number
  volumeUnavailableReason?: unknown
  disableVolumeReliance?: boolean
}): boolean {
  if (params.disableVolumeReliance) return false
  if (isSearchVolumeUnavailableReason(params.volumeUnavailableReason)) return false
  return Number(params.searchVolume || 0) > 0
}

function normalizeAuditString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function normalizeEvidence(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined

  const normalized = Array.from(new Set(
    value
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
  )).slice(0, 4)

  return normalized.length > 0 ? normalized : undefined
}

function normalizeConfidence(value: unknown): number | undefined {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(0, Math.min(1, Math.round(parsed * 100) / 100))
}

function normalizeAuditTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const normalized = Array.from(
    new Set(
      value
        .map((item) => normalizeAuditString(item))
        .filter((item): item is string => Boolean(item))
    )
  ).slice(0, 8)
  return normalized.length > 0 ? normalized : undefined
}

function buildKeywordLanguageSignals(
  analysis: KeywordLanguageCompatibility,
  targetLanguage?: string
): KeywordLanguageSignals | undefined {
  if (!targetLanguage) return undefined

  const allowedLanguageHints = analysis.allowedLanguageHints.length > 0
    ? analysis.allowedLanguageHints
    : undefined
  const detectedLanguageHints = analysis.detectedLanguageHints.length > 0
    ? analysis.detectedLanguageHints
    : undefined

  return {
    targetLanguage: analysis.targetLanguage || normalizeAuditString(targetLanguage),
    allowedLanguageHints,
    detectedLanguageHints,
    contentTokenCount: analysis.contentTokenCount || undefined,
    unauthorizedContentTokenCount: analysis.unauthorizedContentTokenCount || undefined,
    unauthorizedContentRatio: analysis.unauthorizedContentRatio || undefined,
    unauthorizedHeadToken: analysis.unauthorizedHeadToken,
    softDemote: analysis.softDemote || undefined,
  }
}

function isDerivedSourceTier(tier: KeywordSourceTier): boolean {
  return tier.startsWith('DERIVED_')
}

function normalizeDecisionTraceEvidence(entries: Array<string | undefined | false>): string[] | undefined {
  return normalizeEvidence(entries.filter((entry): entry is string => Boolean(entry)))
}

function buildKeywordDecisionTrace(params: {
  sourceTier: KeywordSourceTier
  sourceGovernanceBucket: SourceGovernanceBucket
  sourceTop1Eligible: boolean
  sourceTop2Eligible: boolean
  contractRole: NonNullable<KeywordAuditMetadata['contractRole']>
  fallbackReason?: string
  rescueStage?: KeywordAuditMetadata['rescueStage']
  evidenceStrength?: KeywordAuditMetadata['evidenceStrength']
  familyMatchType?: KeywordAuditMetadata['familyMatchType']
  finalMatchType: CreativeKeywordMatchType
  languageSignals?: KeywordLanguageSignals
}): KeywordDecisionTraceEntry[] {
  const trace: KeywordDecisionTraceEntry[] = [
    {
      stage: 'global_validity',
      outcome: params.languageSignals?.softDemote ? 'soft_demote' : 'pass',
      note: params.languageSignals?.softDemote
        ? 'language governance kept candidate with a soft demotion'
        : 'candidate cleared global validity gates',
      evidence: normalizeDecisionTraceEvidence([
        params.languageSignals?.targetLanguage
          ? `target_language:${params.languageSignals.targetLanguage}`
          : undefined,
        typeof params.languageSignals?.unauthorizedContentRatio === 'number'
          ? `unauthorized_ratio:${params.languageSignals.unauthorizedContentRatio.toFixed(2)}`
          : undefined,
        params.languageSignals?.unauthorizedHeadToken
          ? `unauthorized_head:${params.languageSignals.unauthorizedHeadToken}`
          : undefined,
      ]),
    },
    {
      stage: 'source_governance',
      outcome: params.sourceGovernanceBucket,
      note: `source tier ${params.sourceTier}`,
      evidence: normalizeDecisionTraceEvidence([
        `tier:${params.sourceTier}`,
        params.sourceTop1Eligible ? 'top1_eligible' : 'top1_blocked',
        params.sourceTop2Eligible ? 'top2_eligible' : 'top2_blocked',
      ]),
    },
    {
      stage: 'slot_contract',
      outcome: params.contractRole,
      note: 'slot contract role assigned',
      evidence: normalizeDecisionTraceEvidence([
        params.familyMatchType ? `family:${params.familyMatchType}` : undefined,
        params.evidenceStrength ? `strength:${params.evidenceStrength}` : undefined,
      ]),
    },
  ]

  if (params.fallbackReason || params.rescueStage) {
    trace.push({
      stage: 'fallback',
      outcome: params.fallbackReason || 'fallback',
      note: 'candidate entered fallback or rescue path',
      evidence: normalizeDecisionTraceEvidence([
        params.rescueStage ? `stage:${params.rescueStage}` : undefined,
      ]),
    })
  }

  trace.push({
    stage: 'final_invariant',
    outcome: 'selected',
    note: 'candidate survived final invariant checks',
    evidence: normalizeDecisionTraceEvidence([
      `match:${params.finalMatchType}`,
      isDerivedSourceTier(params.sourceTier) ? 'derived' : 'raw',
      params.fallbackReason || params.rescueStage ? 'fallback' : 'primary_path',
    ]),
  })

  return trace
}

function inferSourceField(source: string | undefined): string | undefined {
  const normalized = String(source || '').trim().toUpperCase()
  if (!normalized) return undefined

  if (normalized === 'SEARCH_TERM' || normalized === 'SEARCH_TERM_HIGH_PERFORMING') return 'search_terms'
  if (normalized.startsWith('KEYWORD_PLANNER') || normalized === 'PLANNER' || normalized === 'GLOBAL_KEYWORD') {
    return 'keyword_planner'
  }
  if (normalized === 'HOT_PRODUCT_AGGREGATE') return 'hot_products'
  if (normalized === 'PARAM_EXTRACT') return 'product_params'
  if (normalized === 'TITLE_EXTRACT') return 'title'
  if (normalized === 'ABOUT_EXTRACT') return 'about'
  if (normalized === 'PAGE_EXTRACT') return 'page_content'
  if (normalized === 'KEYWORD_POOL' || normalized === 'LEGACY_BUCKET' || normalized === 'MERGED') {
    return 'keyword_pool'
  }
  if (normalized === 'BRAND_SEED') return 'brand'
  if (
    normalized === 'AI_GENERATED'
    || normalized === 'AI_ENHANCED'
    || normalized === 'KEYWORD_EXPANSION'
    || normalized === 'SCORING_SUGGESTION'
    || normalized === 'BRANDED_INDUSTRY_TERM'
  ) {
    return 'ai'
  }

  return undefined
}

function hasDemandAnchor(keyword: string, brandName: string | undefined): boolean {
  return getDemandAnchorTokens(keyword, brandName).length > 0
}

function getDemandAnchorTokens(keyword: string, brandName: string | undefined): string[] {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return []

  const brandTokens = new Set(
    normalizeGoogleAdsKeyword(brandName || '')
      ?.split(/\s+/)
      .filter(Boolean) || []
  )
  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token.length > 2)
    .filter((token) => !brandTokens.has(token))
    .filter((token) => !NON_ANCHOR_TOKENS.has(token))
}

function hasRepeatedDemandAnchorToken(keyword: string, brandName: string | undefined): boolean {
  const seen = new Set<string>()
  for (const token of getDemandAnchorTokens(keyword, brandName)) {
    if (/^\d+$/.test(token)) continue
    if (seen.has(token)) return true
    seen.add(token)
  }
  return false
}

function isBrandTrailingDemandPhrase(keyword: string, brandName: string | undefined): boolean {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  const normalizedBrand = normalizeGoogleAdsKeyword(brandName || '')
  if (!normalized || !normalizedBrand) return false

  const keywordTokens = normalized.split(/\s+/).filter(Boolean)
  const brandTokens = normalizedBrand.split(/\s+/).filter(Boolean)
  if (brandTokens.length === 0 || keywordTokens.length <= brandTokens.length + 1) return false

  const trailingBrand = keywordTokens.slice(-brandTokens.length).join(' ')
  if (trailingBrand !== normalizedBrand) return false
  if (keywordTokens.slice(0, brandTokens.length).join(' ') === normalizedBrand) return false

  const demandPrefixTokens = keywordTokens
    .slice(0, -brandTokens.length)
    .filter((token) => !TRANSACTIONAL_MODIFIER_TOKENS.has(token))

  return demandPrefixTokens.length >= 2
}

function getMeaningfulDemandAnchorTokens(keyword: string, brandName: string | undefined): string[] {
  return getDemandAnchorTokens(keyword, brandName)
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !DEMAND_FALLBACK_NOISE_TOKENS.has(token))
}

function getModelIntentSoftFamilyCoreTokens(keyword: string, brandName: string | undefined): string[] {
  return getMeaningfulDemandAnchorTokens(keyword, brandName)
    .filter((token) => !MODEL_INTENT_SOFT_FAMILY_NOISE_TOKENS.has(token))
}

function getNonBrandKeywordTokens(keyword: string, brandName: string | undefined): string[] {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return []

  const brandTokens = new Set(
    normalizeGoogleAdsKeyword(brandName || '')
      ?.split(/\s+/)
      .filter(Boolean) || []
  )

  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !brandTokens.has(token))
}

function hasLowValueTransactionalBoundary(keyword: string, brandName: string | undefined): boolean {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return false

  if (REPEATED_ACTION_PATTERN.test(normalized)) return true

  const tokens = getNonBrandKeywordTokens(normalized, brandName)
  if (tokens.length === 0) return false

  const firstToken = tokens[0]
  const lastToken = tokens[tokens.length - 1]
  return (
    TRANSACTIONAL_MODIFIER_TOKENS.has(firstToken)
    || TRANSACTIONAL_MODIFIER_TOKENS.has(lastToken)
  )
}

function isLowSignalEvaluativeBrandQuery(params: {
  keyword: string
  creativeType: CanonicalCreativeType | null
  isBrand: boolean
  isPureBrand: boolean
  hasModelAnchor: boolean
  brandName: string | undefined
}): boolean {
  if (params.creativeType !== 'brand_intent' && params.creativeType !== 'product_intent') {
    return false
  }
  if (!params.isBrand || params.isPureBrand || params.hasModelAnchor) return false

  const normalized = normalizeGoogleAdsKeyword(params.keyword)
  if (!normalized) return false

  const demandTokens = getDemandAnchorTokens(normalized, params.brandName)
    .filter((token) => !TRANSACTIONAL_MODIFIER_TOKENS.has(token))
  const hasExplicitQualifier = /\bfor\b/i.test(normalized)

  if (/\bgood\b/i.test(normalized) && !hasExplicitQualifier) return true
  if (/\bbest\b/i.test(normalized) && !hasExplicitQualifier && demandTokens.length <= 2) return true

  return false
}

function getTransactionalModifierCount(keyword: string): number {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return 0

  return new Set(
    normalized
      .split(/\s+/)
      .filter(Boolean)
      .filter((token) => TRANSACTIONAL_MODIFIER_TOKENS.has(token))
  ).size
}

function shouldApplyDemandSemanticCoreCompaction(
  creativeType: CanonicalCreativeType | null
): boolean {
  return creativeType === 'brand_intent' || creativeType === 'product_intent'
}

function buildDemandSemanticCoreKey(params: {
  candidate: RankedCandidate
  creativeType: CanonicalCreativeType | null
  brandName: string | undefined
}): string {
  if (!shouldApplyDemandSemanticCoreCompaction(params.creativeType)) return ''
  if (params.candidate.isPureBrand) return ''

  const meaningfulTokens = getMeaningfulDemandAnchorTokens(
    params.candidate.keyword,
    params.brandName
  )
  const fallbackTokens = getDemandAnchorTokens(params.candidate.keyword, params.brandName)
  const tokens = (meaningfulTokens.length > 0 ? meaningfulTokens : fallbackTokens)
    .map((token) => token.toLowerCase())
    .filter(Boolean)
    .filter((token) => !TRANSACTIONAL_MODIFIER_TOKENS.has(token))

  if (tokens.length === 0) return ''
  return Array.from(new Set(tokens)).sort().join(' ')
}

function compareDemandSemanticCoreRepresentative(
  left: RankedCandidate,
  right: RankedCandidate
): number {
  const leftTransactionalCount = getTransactionalModifierCount(left.keyword)
  const rightTransactionalCount = getTransactionalModifierCount(right.keyword)
  const leftHasTransactionalModifier = leftTransactionalCount > 0
  const rightHasTransactionalModifier = rightTransactionalCount > 0

  if (leftHasTransactionalModifier !== rightHasTransactionalModifier) {
    return Number(leftHasTransactionalModifier) - Number(rightHasTransactionalModifier)
  }
  if (leftTransactionalCount !== rightTransactionalCount) {
    return leftTransactionalCount - rightTransactionalCount
  }

  return compareRankedCandidates(left, right)
}

function compactDemandSemanticDuplicates(params: {
  candidates: RankedCandidate[]
  creativeType: CanonicalCreativeType | null
  brandName: string | undefined
}): RankedCandidate[] {
  if (!shouldApplyDemandSemanticCoreCompaction(params.creativeType)) {
    return params.candidates
  }

  const passthrough: RankedCandidate[] = []
  const passthroughCoreKeys = new Set<string>()
  const compactedByCore = new Map<string, RankedCandidate>()

  for (const candidate of params.candidates) {
    const semanticCoreKey = buildDemandSemanticCoreKey({
      candidate,
      creativeType: params.creativeType,
      brandName: params.brandName,
    })
    if (!semanticCoreKey) {
      passthrough.push(candidate)
      continue
    }

    const transactionalModifierCount = getTransactionalModifierCount(candidate.keyword)
    if (transactionalModifierCount === 0) {
      passthrough.push(candidate)
      passthroughCoreKeys.add(semanticCoreKey)
      continue
    }

    const existing = compactedByCore.get(semanticCoreKey)
    if (!existing || compareDemandSemanticCoreRepresentative(candidate, existing) < 0) {
      compactedByCore.set(semanticCoreKey, candidate)
    }
  }

  return [
    ...passthrough,
    ...Array.from(compactedByCore.entries())
      .filter(([semanticCoreKey]) => !passthroughCoreKeys.has(semanticCoreKey))
      .map(([, candidate]) => candidate),
  ]
}

function isLowValueTransactionalTailCandidate(params: {
  candidate: RankedCandidate
  creativeType: CanonicalCreativeType | null
  brandName: string | undefined
}): boolean {
  const { candidate, creativeType, brandName } = params
  if (creativeType !== 'brand_intent' && creativeType !== 'product_intent') return false
  if (candidate.isPureBrand || !candidate.isBrand) return false

  const normalized = candidate.normalized || normalizeGoogleAdsKeyword(candidate.keyword) || ''
  if (!normalized || !TRANSACTIONAL_MODIFIER_PATTERN.test(normalized)) return false
  if (!hasLowValueTransactionalBoundary(normalized, brandName)) return false

  return true
}

function trimLowValueTransactionalTailCandidates(params: {
  candidates: RankedCandidate[]
  creativeType: CanonicalCreativeType | null
  bucket?: CreativeBucket | null
  brandName: string | undefined
  maxKeywords: number
  requiredPureBrandCount: number
  minProductDemandCount: number
}): RankedCandidate[] {
  if (params.creativeType !== 'brand_intent' && params.creativeType !== 'product_intent') {
    return params.candidates
  }

  const minimumOutputFloor = resolveCreativeKeywordMinimumOutputCount({
    creativeType: params.creativeType,
    maxKeywords: params.maxKeywords,
    bucket: params.bucket,
  })
  const minimumDemandFloor = params.creativeType === 'product_intent'
    ? Math.min(
      params.minProductDemandCount,
      countProductIntentDemandCandidates(params.candidates, params.brandName)
    )
    : 0
  const canPreserveContract = (candidates: RankedCandidate[]): boolean => {
    if (candidates.length < minimumOutputFloor) return false
    if (
      (params.creativeType === 'brand_intent' || params.creativeType === 'product_intent')
      && params.requiredPureBrandCount > 0
      && candidates.filter((candidate) => candidate.isPureBrand).length < params.requiredPureBrandCount
    ) {
      return false
    }
    if (
      params.creativeType === 'product_intent'
      && minimumDemandFloor > 0
      && countProductIntentDemandCandidates(candidates, params.brandName) < minimumDemandFloor
    ) {
      return false
    }
    return true
  }

  const fullyPruned = params.candidates.filter((candidate) => !isLowValueTransactionalTailCandidate({
    candidate,
    creativeType: params.creativeType,
    brandName: params.brandName,
  }))
  if (fullyPruned.length < params.candidates.length && canPreserveContract(fullyPruned)) {
    return fullyPruned
  }

  const trimmed = [...params.candidates]
  for (let index = trimmed.length - 1; index >= 0; index -= 1) {
    if (trimmed.length <= minimumOutputFloor) break
    if (!isLowValueTransactionalTailCandidate({
      candidate: trimmed[index],
      creativeType: params.creativeType,
      brandName: params.brandName,
    })) {
      continue
    }
    const next = [...trimmed]
    next.splice(index, 1)
    if (!canPreserveContract(next)) continue
    trimmed.splice(index, 1)
  }

  return trimmed
}

function hasModelIntentRescuePrefixNoise(keyword: string, brandName: string | undefined): boolean {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return false

  const brandTokens = new Set(
    normalizeGoogleAdsKeyword(brandName || '')
      ?.split(/\s+/)
      .filter(Boolean) || []
  )
  const tokens = normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !brandTokens.has(token))
  const meaningfulDemandTokens = new Set(getMeaningfulDemandAnchorTokens(normalized, brandName))
  const firstMeaningfulIndex = tokens.findIndex((token) => meaningfulDemandTokens.has(token))
  if (firstMeaningfulIndex <= 0) return false

  const prefixTokens = tokens.slice(0, firstMeaningfulIndex)
  const packTokenSet = new Set(['pack', 'count', 'pc', 'piece', 'pieces', 'set'])
  const storeTokenSet = new Set(['official', 'store', 'shop', 'shops', 'brand'])
  const hasClaimLikePrefix = prefixTokens.some((token) =>
    DEMAND_FALLBACK_NOISE_TOKENS.has(token)
    && !packTokenSet.has(token)
    && !storeTokenSet.has(token)
  )
  if (hasClaimLikePrefix) return true

  const hasPackHeavyPrefix =
    prefixTokens.length >= 3
    && prefixTokens.some((token) => packTokenSet.has(token) || /^\d+$/.test(token))

  return hasPackHeavyPrefix
}

function isModelIntentRescueKeyword(keyword: string, brandName: string | undefined): boolean {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return false
  if (containsAsinLikeToken(normalized)) return false
  if (INFO_QUERY_PATTERN.test(normalized)) return false
  if (QUESTION_PREFIX_PATTERN.test(normalized)) return false
  if (REVIEW_COMPARE_PATTERN.test(normalized)) return false
  if (PLATFORM_PATTERN.test(normalized)) return false
  if (COMMUNITY_PATTERN.test(normalized)) return false
  if (hasModelIntentRescuePrefixNoise(normalized, brandName)) return false

  if (hasModelAnchorEvidence({ keywords: [normalized] })) return true

  const meaningfulDemandTokens = getMeaningfulDemandAnchorTokens(normalized, brandName)
  if (meaningfulDemandTokens.length >= 2) return true

  const normalizedBrand = normalizeGoogleAdsKeyword(brandName || '')
  const pureBrandKeywords =
    normalizedBrand && normalizedBrand !== 'unknown'
      ? getPureBrandKeywords(normalizedBrand)
      : []
  const isBranded = pureBrandKeywords.length > 0
    ? containsPureBrand(normalized, pureBrandKeywords)
    : false

  return isBranded && meaningfulDemandTokens.length >= 1 && normalized.split(/\s+/).filter(Boolean).length >= 3
}

function isAiGeneratedCandidate(candidate: {
  source?: string
  sourceType?: string
  sourceSubtype?: string
}): boolean {
  const sourceSubtype = normalizeKeywordSourceSubtype({
    source: candidate.source,
    sourceType: candidate.sourceSubtype || candidate.sourceType,
  })
  const rawSource = inferKeywordRawSource({
    source: candidate.source,
    sourceType: sourceSubtype || candidate.sourceType,
  })
  return rawSource === 'AI' || isAiSubtype(sourceSubtype)
}

function hasDerivedTag(candidate: {
  derivedTags?: string[]
}, expectedTag: string): boolean {
  const normalizedTag = String(expectedTag || '').trim().toUpperCase()
  if (!normalizedTag) return false
  return Boolean(candidate.derivedTags?.some((tag) => String(tag || '').trim().toUpperCase() === normalizedTag))
}

function getNormalizedCandidateSourceSubtype(candidate: {
  source?: string
  sourceType?: string
  sourceSubtype?: string
}): string | undefined {
  return normalizeKeywordSourceSubtype({
    source: candidate.source,
    sourceType: candidate.sourceSubtype || candidate.sourceType,
  })
}

function isDerivedRescueSourceSubtype(sourceSubtype: string | undefined): boolean {
  const normalized = String(sourceSubtype || '').trim().toUpperCase()
  return (
    normalized === 'BUILDER_NON_EMPTY_RESCUE'
    || normalized === 'DERIVED_RESCUE'
    || normalized === 'MODEL_FAMILY_GUARD'
    || normalized === 'PRODUCT_RELAX_BRANDED'
    || normalized === 'BRAND_SEED'
    || normalized === 'CONTRACT_RESCUE'
    || normalized === 'FINAL_INVARIANT'
  )
}

function isDerivedRescueCandidate(candidate: {
  source?: string
  sourceType?: string
  sourceSubtype?: string
}): boolean {
  return isDerivedRescueSourceSubtype(getNormalizedCandidateSourceSubtype(candidate))
}

function isModelFamilyGuardCandidate(candidate: {
  source?: string
  sourceType?: string
  sourceSubtype?: string
  derivedTags?: string[]
}): boolean {
  const normalizedSource = String(candidate.source || '').trim().toUpperCase()
  const normalizedSubtype = getNormalizedCandidateSourceSubtype(candidate)

  return (
    normalizedSource === 'MODEL_FAMILY_GUARD'
    || normalizedSubtype === 'MODEL_FAMILY_GUARD'
    || hasDerivedTag(candidate, 'MODEL_FAMILY_GUARD')
  )
}

function isTrustedModelIntentSoftFamilyCandidate(candidate: {
  keyword: string
  normalized?: string
  isBrand?: boolean
  isPureBrand: boolean
  isPreferredBucket?: boolean
  source?: string
  sourceType?: string
  sourceSubtype?: string
  derivedTags?: string[]
  sourceRank?: number
  searchVolume?: number
  volumeUnavailableReason?: unknown
}, brandName: string | undefined): boolean {
  const text = candidate.normalized || normalizeGoogleAdsKeyword(candidate.keyword) || ''
  if (!text) return false
  if (candidate.isPureBrand) return false
  if (containsAsinLikeToken(text)) return false
  if (hasModelIntentRescuePrefixNoise(text, brandName)) return false
  if (URL_FRAGMENT_PATTERN.test(text)) return false
  if (COMPONENT_NOISE_PATTERN.test(text)) return false
  if (hasModelAnchorEvidence({ keywords: [text] })) return false
  const demandAnchorTokens = getDemandAnchorTokens(text, brandName)
  const meaningfulDemandAnchorTokens = getMeaningfulDemandAnchorTokens(text, brandName)
  const softFamilyCoreTokens = getModelIntentSoftFamilyCoreTokens(text, brandName)
  if (meaningfulDemandAnchorTokens.length === 0) return false
  if (softFamilyCoreTokens.length === 0) return false

  const sourceRank = typeof candidate.sourceRank === 'number'
    ? candidate.sourceRank
    : normalizeSourceRank(candidate.source, candidate.sourceSubtype || candidate.sourceType)
  const isBrand = Boolean(candidate.isBrand)
  const nonNumericDemandAnchorCount = softFamilyCoreTokens.length
  const wordCount = text.split(/\s+/).filter(Boolean).length
  const hasFriendlySpecToken = /\b\d+\s*(?:inch|in|oz|ml|l|pack|count|ct|pcs|piece|w|wh|mah|gb|tb)?\b/i.test(text)
  const hasGenericSpilloverSignal = MODEL_INTENT_GENERIC_SPILLOVER_PATTERN.test(text)
  const hasReliableSearchVolume = hasReliableSearchVolumeSignal({
    searchVolume: candidate.searchVolume,
    volumeUnavailableReason: candidate.volumeUnavailableReason,
  })
  const hasTrustedSource =
    sourceRank >= 8
    || (
      sourceRank >= 7
      && nonNumericDemandAnchorCount >= 2
      && !hasGenericSpilloverSignal
    )

  const isModelFamilyGuard = isModelFamilyGuardCandidate(candidate)
  const allowHighVolumeBrandedSingleCoreDemand = Boolean(
    isBrand
    && !isModelFamilyGuard
    && candidate.isPreferredBucket
    && !isAiGeneratedCandidate(candidate)
    && !hasGenericSpilloverSignal
    && meaningfulDemandAnchorTokens.length === 1
    && softFamilyCoreTokens.length === 1
    && hasReliableSearchVolume
    && Number(candidate.searchVolume || 0) >= MODEL_INTENT_BRANDED_SINGLE_CORE_SEARCH_VOLUME_FLOOR
  )
  if (isModelFamilyGuard) {
    // Guard fallback is allowed only when it carries enough real product-demand detail.
    if (hasGenericSpilloverSignal) return false
    if (nonNumericDemandAnchorCount >= 2) return true
    if (nonNumericDemandAnchorCount >= 1 && hasTrustedSource) return true
    if (nonNumericDemandAnchorCount >= 1 && wordCount >= 3 && hasFriendlySpecToken) return true
    return false
  }

  // Single-tail branded demand like "novilla mattress" is usually too generic for B.
  // Keep only when it comes from a trusted source or is a high-volume preferred demand term.
  if (
    meaningfulDemandAnchorTokens.length === 1
    && !hasTrustedSource
    && !allowHighVolumeBrandedSingleCoreDemand
  ) {
    return false
  }

  // Unbranded soft-family phrases must come from a stronger source than canonical pool projection.
  if (!isBrand && !hasTrustedSource) return false

  return Boolean(isBrand || candidate.isPreferredBucket || hasTrustedSource)
}

function resolveModelIntentSoftFamilyIntentBoost(candidate: {
  keyword: string
  normalized?: string
  isBrand: boolean
  isPureBrand: boolean
  isPreferredBucket?: boolean
  source?: string
  sourceType?: string
  sourceSubtype?: string
  derivedTags?: string[]
  sourceRank?: number
  searchVolume?: number
  volumeUnavailableReason?: unknown
}, brandName: string | undefined): number {
  if (!isTrustedModelIntentSoftFamilyCandidate(candidate, brandName)) return 0
  if (isModelFamilyGuardCandidate(candidate)) return 5
  if (candidate.isBrand) return 4
  return 3
}

function isCompactTrustedModelIntentSoftFamilyCandidate(candidate: {
  keyword: string
  normalized?: string
  isBrand?: boolean
  isPureBrand: boolean
  isPreferredBucket?: boolean
  source?: string
  sourceType?: string
  sourceSubtype?: string
  derivedTags?: string[]
  sourceRank?: number
  searchVolume?: number
  wordCount?: number
}, brandName: string | undefined): boolean {
  const normalized = candidate.normalized || normalizeGoogleAdsKeyword(candidate.keyword) || ''
  if (!normalized) return false
  if (!isTrustedModelIntentSoftFamilyCandidate(candidate, brandName)) return false
  if (MODEL_INTENT_GENERIC_SPILLOVER_PATTERN.test(normalized)) return false
  if (hasRepeatedDemandAnchorToken(normalized, brandName)) return false

  const demandTokenCount = getDemandAnchorTokens(normalized, brandName)
    .filter((token) => !/^\d+$/.test(token))
    .length
  const wordCount = candidate.wordCount || normalized.split(/\s+/).filter(Boolean).length

  return demandTokenCount > 0 && demandTokenCount <= 4 && wordCount <= 6
}

function isModelIntentRescueBackstopCandidate(candidate: {
  keyword: string
  normalized?: string
  isBrand?: boolean
  isPureBrand: boolean
  source?: string
  sourceType?: string
  sourceSubtype?: string
}, brandName: string | undefined): boolean {
  const normalized = candidate.normalized || normalizeGoogleAdsKeyword(candidate.keyword) || ''
  if (!normalized) return false
  if (candidate.isPureBrand) return false
  if (!candidate.isBrand) return false
  if (!isDerivedRescueCandidate(candidate)) return false
  if (isModelFamilyGuardCandidate(candidate)) return false
  if (containsAsinLikeToken(normalized)) return false
  if (URL_FRAGMENT_PATTERN.test(normalized)) return false
  if (COMPONENT_NOISE_PATTERN.test(normalized)) return false
  if (hasModelIntentRescuePrefixNoise(normalized, brandName)) return false
  if (hasModelAnchorEvidence({ keywords: [normalized] })) return false
  if (isModelIntentDimensionOrParamOnlyText(normalized, brandName)) return false

  const meaningfulDemandTokens = getMeaningfulDemandAnchorTokens(normalized, brandName)
  if (meaningfulDemandTokens.length === 0) return false

  return normalized.split(/\s+/).filter(Boolean).length >= 2
}

function buildPermutationKey(keyword: string): string {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return ''
  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length <= 1) return normalized
  return [...tokens].sort().join(' ')
}

function isLowQualityCandidate(candidate: {
  keyword: string
  normalized: string
  isBrand: boolean
  isPureBrand: boolean
  isPreferredBucket?: boolean
  source?: string
  sourceType?: string
  sourceSubtype?: string
  derivedTags?: string[]
  sourceRank?: number
  searchVolume?: number
  volumeUnavailableReason?: unknown
}, creativeType: CanonicalCreativeType | null, brandName: string | undefined, options?: {
  targetLanguage?: string
  allowModelIntentPreferredFallback?: boolean
  allowModelIntentSoftFamilyFallback?: boolean
  disableVolumeReliance?: boolean
}): boolean {
  const text = candidate.normalized
  if (!text) return true
  if (containsAsinLikeToken(text)) return true
  const normalizedBrand = normalizeGoogleAdsKeyword(brandName || '')
  const pureBrandKeywords =
    normalizedBrand && normalizedBrand !== 'unknown'
      ? getPureBrandKeywords(normalizedBrand)
      : []
  const languageAnalysis = analyzeKeywordLanguageCompatibility({
    keyword: candidate.keyword,
    targetLanguage: options?.targetLanguage,
    pureBrandKeywords,
  })
  if (languageAnalysis.hardReject) return true
  const hasModelAnchor = hasModelAnchorEvidence({ keywords: [text] })
  const demandAnchorTokens = getDemandAnchorTokens(text, brandName)
  const modelIntentSoftFamilyCoreTokens = creativeType === 'model_intent'
    ? getModelIntentSoftFamilyCoreTokens(text, brandName)
    : []
  const hasDemand = demandAnchorTokens.length > 0
  const hasSpecificDemandTail = demandAnchorTokens.length >= 2
  const hasModelIntentSoftFamilyCore = modelIntentSoftFamilyCoreTokens.length > 0
  const hasSpecificModelIntentSoftFamilyCore = modelIntentSoftFamilyCoreTokens.length >= 2
  const hasTransactionalModifier = TRANSACTIONAL_MODIFIER_PATTERN.test(text)
  const hasReliableSearchVolume = hasReliableSearchVolumeSignal({
    searchVolume: candidate.searchVolume,
    volumeUnavailableReason: candidate.volumeUnavailableReason,
    disableVolumeReliance: options?.disableVolumeReliance,
  })
  const isAiGenerated = isAiGeneratedCandidate(candidate)
  const trustedSoftFamilyCandidate = isTrustedModelIntentSoftFamilyCandidate(candidate, brandName)
  const rescueBackstopCandidate = creativeType === 'model_intent'
    ? isModelIntentRescueBackstopCandidate(candidate, brandName)
    : false
  const allowSoftFamilyCandidate =
    trustedSoftFamilyCandidate
    && (
      candidate.isBrand
      || isModelFamilyGuardCandidate(candidate)
      || Boolean(options?.allowModelIntentSoftFamilyFallback)
    )
  if (PLATFORM_PATTERN.test(text)) return true
  if (COMMUNITY_PATTERN.test(text)) return true
  if (INFO_QUERY_PATTERN.test(text)) return true
  if (QUESTION_PREFIX_PATTERN.test(text)) return true
  if (REVIEW_COMPARE_PATTERN.test(text)) return true
  if (PRICE_TRACKER_PATTERN.test(text)) return true
  if (NOISE_STACK_PATTERN.test(text)) return true
  if (REPEATED_ACTION_PATTERN.test(text)) return true
  if (LOCALE_NOISE_PATTERN.test(text)) return true
  if (BRAND_SLOGAN_PATTERN.test(text)) return true
  if (URL_FRAGMENT_PATTERN.test(text)) return true
  if (COMPONENT_NOISE_PATTERN.test(text)) return true
  if (isLowSignalEvaluativeBrandQuery({
    keyword: text,
    creativeType,
    isBrand: candidate.isBrand,
    isPureBrand: candidate.isPureBrand,
    hasModelAnchor,
    brandName,
  })) {
    return true
  }
  if (!candidate.isPureBrand && hasRepeatedDemandAnchorToken(text, brandName)) return true
  if (
    !candidate.isPureBrand
    && candidate.isBrand
    && !hasModelAnchor
    && isBrandTrailingDemandPhrase(text, brandName)
  ) {
    return true
  }
  if (STORE_NAV_PATTERN.test(text) && !hasDemand) return true
  if (PROMO_PATTERN.test(text) && !hasDemand && !hasModelAnchor) return true
  if (creativeType === 'brand_intent' && candidate.isBrand && !candidate.isPureBrand && !hasDemand && !hasModelAnchor) return true
  if (creativeType === 'model_intent' && hasModelAnchor && hasTransactionalModifier && isAiGenerated) return true
  if (creativeType === 'model_intent' && isModelIntentDimensionOrParamOnlyText(text, brandName)) return true
  if (
    creativeType === 'product_intent'
    && candidate.isBrand
    && !candidate.isPureBrand
    && !hasModelAnchor
    && !trustedSoftFamilyCandidate
    && (options?.disableVolumeReliance ? false : !hasReliableSearchVolume)
    && demandAnchorTokens.filter((token) => !/^\d+$/.test(token)).length <= 1
  ) {
    return true
  }
  if (
    creativeType === 'model_intent'
    && !hasModelAnchor
    && !(
      (
        options?.allowModelIntentPreferredFallback
        && candidate.isPreferredBucket
        && hasSpecificModelIntentSoftFamilyCore
        && !candidate.isPureBrand
      )
      || rescueBackstopCandidate
      || (allowSoftFamilyCandidate && hasModelIntentSoftFamilyCore)
    )
  ) {
    return true
  }
  if (creativeType === 'model_intent' && candidate.isPureBrand) return true
  return false
}

function inferAnchorType(candidate: {
  keyword: string
  isBrand: boolean
  brandName?: string
}): string | undefined {
  const hasModelAnchor = hasModelAnchorEvidence({ keywords: [candidate.keyword] })
  const hasDemand = hasDemandAnchor(candidate.keyword, candidate.brandName)

  if (hasModelAnchor && candidate.isBrand) return 'brand_model'
  if (hasModelAnchor) return 'model'
  if (candidate.isBrand && hasDemand) return 'brand_product'
  if (candidate.isBrand) return 'brand'
  if (hasDemand) return 'product'
  return undefined
}

function inferAnchorKinds(candidate: {
  keyword: string
  isBrand: boolean
  brandName?: string
}): string[] | undefined {
  const kinds: string[] = []
  if (candidate.isBrand) kinds.push('brand')
  if (hasModelAnchorEvidence({ keywords: [candidate.keyword] })) kinds.push('model')
  if (hasDemandAnchor(candidate.keyword, candidate.brandName)) kinds.push('demand')
  return kinds.length > 0 ? kinds : undefined
}

function inferEvidenceStrength(candidate: RankedCandidate, creativeType: CanonicalCreativeType | null, _brandName: string | undefined): 'high' | 'medium' | 'low' {
  let score = 0
  const profile = candidate.evidenceProfile
  const hasSoftFamilySignal =
    creativeType === 'model_intent'
    && (
      profile.isModelFamilyGuard
      || profile.trustedSoftFamily
    )
  if (profile.hasModelAnchor) score += 2
  if (profile.hasReliableSearchVolume) score += 0.5
  if (profile.sourceTrustScore >= 8) score += 2
  else if (profile.sourceTrustScore >= 6) score += 1
  if (hasSoftFamilySignal) score += 2
  if (profile.selectedIntentScore >= 3) score += 1

  if (score >= 4) return 'high'
  if (score >= 2) return 'medium'
  return 'low'
}

function inferFamilyMatchType(
  candidate: RankedCandidate,
  creativeType: CanonicalCreativeType | null,
  brandName: string | undefined
): KeywordAuditMetadata['familyMatchType'] {
  const profile = candidate.evidenceProfile
  const hasModelAnchor = profile.hasModelAnchor
  const hasDemand = profile.hasDemand
  const hasSoftFamily = profile.isModelFamilyGuard || profile.trustedSoftFamily

  if (creativeType === 'model_intent') {
    if (hasModelAnchor && candidate.isBrand) return 'mixed'
    if (hasModelAnchor) return 'hard_model'
    if (hasSoftFamily) return 'soft_family'
  }

  if (candidate.isBrand && hasDemand) return 'mixed'
  if (candidate.isBrand) return 'brand'
  if (hasDemand) return 'product_demand'
  if (hasModelAnchor) return 'hard_model'
  return undefined
}

function resolveModelIntentFinalMatchType(candidate: RankedCandidate): CreativeKeywordMatchType {
  const profile = candidate.evidenceProfile
  if (profile.hasModelAnchor) return 'EXACT'

  const allowSoftFamilyPhrase = (
    profile.compactTrustedSoftFamily
    || (
      profile.trustedSoftFamily
      && profile.sourceTrustScore >= 5.5
      && profile.selectedIntentScore >= 1.2
      && profile.intentMargin >= 0
      && !profile.isTransactional
    )
  )
  if (allowSoftFamilyPhrase) return 'PHRASE'
  if (profile.hasDemand && candidate.isBrand && isDerivedRescueCandidate(candidate)) return 'PHRASE'

  return 'EXACT'
}

function resolveKeywordFallbackReason(candidate: RankedCandidate): string | undefined {
  const sourceKey = String(
    candidate.sourceSubtype
    || candidate.sourceType
    || candidate.source
    || ''
  ).trim().toUpperCase()

  if (!sourceKey) return undefined
  if (sourceKey === 'MODEL_FAMILY_GUARD') return 'model_family_guard'
  if (sourceKey === 'PRODUCT_RELAX_BRANDED') return 'product_relax_branded'
  if (sourceKey === 'BRAND_SEED') return 'brand_seed'
  if (sourceKey === 'CONTRACT_RESCUE' || sourceKey === 'FINAL_INVARIANT') return 'final_invariant'
  return undefined
}

function resolveKeywordRescueStage(
  candidate: RankedCandidate
): KeywordAuditMetadata['rescueStage'] {
  const fallbackReason = resolveKeywordFallbackReason(candidate)
  if (!fallbackReason) return undefined
  if (fallbackReason === 'final_invariant') return 'final_invariant'
  return 'post_selection'
}

function buildKeywordContractRoleMap(params: {
  selectedList: RankedCandidate[]
  creativeType: CanonicalCreativeType | null
  brandName: string | undefined
  requiredBrandCount: number
  requiredPureBrandCount: number
  minProductDemandCount: number
}): Map<string, NonNullable<KeywordAuditMetadata['contractRole']>> {
  const selected = [...params.selectedList].sort(compareRankedCandidates)
  const roles = new Map<string, NonNullable<KeywordAuditMetadata['contractRole']>>()
  const markRequired = (candidates: RankedCandidate[], targetCount: number) => {
    let count = 0
    for (const candidate of candidates) {
      if (count >= targetCount) break
      if (roles.get(candidate.normalized) === 'required') continue
      roles.set(candidate.normalized, 'required')
      count += 1
    }
  }

  if (params.requiredPureBrandCount > 0) {
    markRequired(
      selected.filter((candidate) => candidate.isPureBrand),
      params.requiredPureBrandCount
    )
  }

  if (params.requiredBrandCount > 0) {
    markRequired(
      selected.filter((candidate) => candidate.isBrand),
      params.requiredBrandCount
    )
  }

  if (params.creativeType === 'model_intent') {
    markRequired(
      selected.filter((candidate) =>
        hasModelAnchorEvidence({ keywords: [candidate.keyword] })
        || isModelFamilyGuardCandidate(candidate)
        || isTrustedModelIntentSoftFamilyCandidate(candidate, params.brandName)
        || isModelIntentRescueBackstopCandidate(candidate, params.brandName)
      ),
      Math.min(3, selected.length)
    )
  }

  if (params.creativeType === 'product_intent' && params.minProductDemandCount > 0) {
    markRequired(
      selected.filter((candidate) => isProductIntentDemandCandidate(candidate, params.brandName)),
      params.minProductDemandCount
    )
  }

  for (const candidate of selected) {
    if (roles.has(candidate.normalized)) continue
    roles.set(
      candidate.normalized,
      resolveKeywordFallbackReason(candidate) ? 'fallback' : 'optional'
    )
  }

  return roles
}

function buildAuditEvidence(candidate: RankedCandidate, brandName: string | undefined): string[] | undefined {
  const fromInput = normalizeEvidence(candidate.evidence)
  if (fromInput) return fromInput

  const normalized = normalizeGoogleAdsKeyword(candidate.keyword)
  if (!normalized) return undefined

  const brandTokens = new Set(
    normalizeGoogleAdsKeyword(brandName || '')
      ?.split(/\s+/)
      .filter(Boolean) || []
  )
  const tokens = normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !brandTokens.has(token))
    .filter((token) => !NON_ANCHOR_TOKENS.has(token))
    .slice(0, 3)

  if (tokens.length > 0) return tokens
  if (brandTokens.size > 0) return Array.from(brandTokens).slice(0, 2)
  return [normalized]
}

function inferKeywordConfidence(
  candidate: RankedCandidate,
  creativeType: CanonicalCreativeType | null,
  finalMatchType: CreativeKeywordMatchType
): number {
  const provided = normalizeConfidence(candidate.confidence)
  if (provided !== undefined) return provided

  let confidence = 0.42
  confidence += Math.min(candidate.sourceRank, 10) * 0.035
  confidence += Math.max(candidate.intentRank, 0) * 0.03
  confidence += finalMatchType === 'EXACT' ? 0.08 : finalMatchType === 'PHRASE' ? 0.04 : 0
  confidence += candidate.isBrand ? 0.05 : 0
  confidence += candidate.evidenceProfile.hasReliableSearchVolume ? 0.015 : 0

  if (creativeType === 'model_intent' && hasModelAnchorEvidence({ keywords: [candidate.keyword] })) {
    confidence += 0.1
  }

  return Math.max(0.35, Math.min(0.99, Math.round(confidence * 100) / 100))
}

function inferQualityReason(
  candidate: RankedCandidate,
  creativeType: CanonicalCreativeType | null,
  brandName: string | undefined,
  finalMatchType: CreativeKeywordMatchType
): string | undefined {
  const existing = normalizeAuditString(candidate.qualityReason)
  if (existing) return existing

  const reasons: string[] = []
  const sourceField = inferSourceField(candidate.source)
  const hasModelAnchor = hasModelAnchorEvidence({ keywords: [candidate.keyword] })
  const hasDemand = hasDemandAnchor(candidate.keyword, brandName)

  if (sourceField === 'search_terms') reasons.push('来自真实搜索词')
  else if (sourceField === 'keyword_planner') reasons.push('来自关键词规划器')
  else if (sourceField === 'hot_products') reasons.push('来自热门商品线')
  else if (sourceField === 'product_params') reasons.push('来自商品参数')
  else if (sourceField === 'title') reasons.push('来自标题')

  if (creativeType === 'model_intent' && hasModelAnchor) reasons.push('包含型号锚点')
  else if (candidate.isBrand && hasDemand) reasons.push('品牌与商品强相关')
  else if (hasDemand) reasons.push('与商品需求相关')

  if (creativeType === 'model_intent' && finalMatchType === 'EXACT') {
    reasons.push('适合完全匹配')
  }

  return reasons.length > 0 ? reasons.slice(0, 2).join('；') : undefined
}

function computeIntentRank(params: {
  keyword: string
  creativeType: CanonicalCreativeType | null
  bucket: CreativeBucket | null | undefined
  isBrand: boolean
  isPureBrand: boolean
  isPreferredBucket?: boolean
  brandName?: string
  source?: string
  sourceType?: string
  sourceSubtype?: string
  derivedTags?: string[]
  searchVolume?: number
}): number {
  const {
    keyword,
    bucket,
    isBrand,
    isPureBrand,
    brandName,
    isPreferredBucket,
    source,
    sourceType,
    sourceSubtype,
    derivedTags,
    searchVolume,
  } = params
  const creativeType = params.creativeType
    || deriveCanonicalCreativeType({ creativeType: null, keywordBucket: bucket, keywords: [keyword] })
  const text = String(keyword || '')
  const hasModelAnchor = hasModelAnchorEvidence({ keywords: [text] })
  const hasDemand = hasDemandAnchor(text, brandName)

  if (creativeType === 'brand_intent') {
    let score = 0
    if (isBrand) score += 2
    if (hasDemand) score += 3
    if (hasModelAnchor) score += 1
    if (A_TRUST_PATTERN.test(text)) score += 1
    if (isPureBrand) score -= 4
    return score
  }

  if (creativeType === 'model_intent') {
    let score = 0
    if (hasModelAnchor) score += 6
    if (isBrand) score += 1
    if (!hasModelAnchor) score -= 8
    if (!hasModelAnchor) {
      score += resolveModelIntentSoftFamilyIntentBoost({
        keyword,
        normalized: normalizeGoogleAdsKeyword(keyword) || undefined,
        isBrand,
        isPureBrand,
        isPreferredBucket,
        source,
        sourceType,
        sourceSubtype,
        derivedTags,
        searchVolume,
      }, brandName)
    }
    return score
  }

  if (creativeType === 'product_intent') {
    let score = 0
    if (hasDemand) score += 3
    if (isBrand && hasDemand) score += 2
    if (FEATURE_SCENARIO_PATTERN.test(text)) score += 2
    if (D_INTENT_PATTERN.test(text)) score -= 1
    if (B_SCENARIO_PATTERN.test(text)) score += 1
    if (isPureBrand) score -= 4
    return score
  }

  return 0
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function resolveSelectedIntentScore(
  intentScores: CandidateIntentScores,
  creativeType: CanonicalCreativeType | null
): number {
  if (creativeType === 'brand_intent') return intentScores.brand_intent
  if (creativeType === 'model_intent') return intentScores.model_intent
  if (creativeType === 'product_intent') return intentScores.product_intent
  return Math.max(intentScores.brand_intent, intentScores.model_intent, intentScores.product_intent)
}

function resolveSecondaryIntentScore(
  intentScores: CandidateIntentScores,
  creativeType: CanonicalCreativeType | null
): number {
  if (creativeType === 'brand_intent') {
    return Math.max(intentScores.model_intent, intentScores.product_intent)
  }
  if (creativeType === 'model_intent') {
    return Math.max(intentScores.brand_intent, intentScores.product_intent)
  }
  if (creativeType === 'product_intent') {
    return Math.max(intentScores.brand_intent, intentScores.model_intent)
  }

  const sorted = [
    intentScores.brand_intent,
    intentScores.model_intent,
    intentScores.product_intent,
  ].sort((a, b) => b - a)
  return sorted[1] ?? sorted[0] ?? 0
}

function resolveCandidateIntentScores(params: {
  keyword: string
  bucket: CreativeBucket | null | undefined
  isBrand: boolean
  isPureBrand: boolean
  isPreferredBucket: boolean
  brandName?: string
  source?: string
  sourceType?: string
  sourceSubtype?: string
  derivedTags?: string[]
  searchVolume?: number
}): CandidateIntentScores {
  return {
    brand_intent: computeIntentRank({
      keyword: params.keyword,
      creativeType: 'brand_intent',
      bucket: params.bucket,
      isBrand: params.isBrand,
      isPureBrand: params.isPureBrand,
      isPreferredBucket: params.isPreferredBucket,
      brandName: params.brandName,
      source: params.source,
      sourceType: params.sourceType,
      sourceSubtype: params.sourceSubtype,
      derivedTags: params.derivedTags,
      searchVolume: params.searchVolume,
    }),
    model_intent: computeIntentRank({
      keyword: params.keyword,
      creativeType: 'model_intent',
      bucket: params.bucket,
      isBrand: params.isBrand,
      isPureBrand: params.isPureBrand,
      isPreferredBucket: params.isPreferredBucket,
      brandName: params.brandName,
      source: params.source,
      sourceType: params.sourceType,
      sourceSubtype: params.sourceSubtype,
      derivedTags: params.derivedTags,
      searchVolume: params.searchVolume,
    }),
    product_intent: computeIntentRank({
      keyword: params.keyword,
      creativeType: 'product_intent',
      bucket: params.bucket,
      isBrand: params.isBrand,
      isPureBrand: params.isPureBrand,
      isPreferredBucket: params.isPreferredBucket,
      brandName: params.brandName,
      source: params.source,
      sourceType: params.sourceType,
      sourceSubtype: params.sourceSubtype,
      derivedTags: params.derivedTags,
      searchVolume: params.searchVolume,
    }),
  }
}

function buildCandidateEvidenceProfile(params: {
  candidate: {
    keyword: string
    normalized?: string
    isBrand: boolean
    isPureBrand: boolean
    isPreferredBucket: boolean
    source?: string
    sourceType?: string
    sourceSubtype?: string
    derivedTags?: string[]
    searchVolume?: number
    volumeUnavailableReason?: unknown
    sourceRank: number
    matchTypeRank: number
    wordCount: number
  }
  creativeType: CanonicalCreativeType | null
  brandName: string | undefined
  targetLanguage?: string
  intentScores: CandidateIntentScores
  selectedIntentScoreOverride?: number
  disableVolumeReliance?: boolean
}): CandidateEvidenceProfile {
  const normalized = params.candidate.normalized || normalizeGoogleAdsKeyword(params.candidate.keyword) || ''
  const normalizedBrand = normalizeGoogleAdsKeyword(params.brandName || '')
  const pureBrandKeywords =
    normalizedBrand && normalizedBrand !== 'unknown'
      ? getPureBrandKeywords(normalizedBrand)
      : []
  const demandAnchorTokens = getDemandAnchorTokens(normalized, params.brandName)
  const nonNumericDemandTokens = demandAnchorTokens.filter((token) => !/^\d+$/.test(token))
  const hasModelAnchor = hasModelAnchorEvidence({ keywords: [normalized] })
  const hasDemand = demandAnchorTokens.length > 0
  const hasSpecificDemandTail = nonNumericDemandTokens.length >= 2
  const isTransactional = TRANSACTIONAL_MODIFIER_PATTERN.test(normalized)
  const isAiGenerated = isAiGeneratedCandidate(params.candidate)
  const isModelFamilyGuard = isModelFamilyGuardCandidate(params.candidate)
  const trustedSoftFamily = isTrustedModelIntentSoftFamilyCandidate(params.candidate, params.brandName)
  const compactTrustedSoftFamily = isCompactTrustedModelIntentSoftFamilyCandidate({
    ...params.candidate,
    wordCount: params.candidate.wordCount,
  }, params.brandName)
  const languageAnalysis = analyzeKeywordLanguageCompatibility({
    keyword: params.candidate.keyword,
    targetLanguage: params.targetLanguage,
    pureBrandKeywords,
  })
  const selectedIntentScore = params.selectedIntentScoreOverride ?? resolveSelectedIntentScore(
    params.intentScores,
    params.creativeType
  )
  const secondaryIntentScore = resolveSecondaryIntentScore(params.intentScores, params.creativeType)
  const intentMargin = selectedIntentScore - secondaryIntentScore
  const hasReliableSearchVolume = hasReliableSearchVolumeSignal({
    searchVolume: params.candidate.searchVolume,
    volumeUnavailableReason: params.candidate.volumeUnavailableReason,
    disableVolumeReliance: params.disableVolumeReliance,
  })

  let sourceTrustScore = params.candidate.sourceRank
  if (hasReliableSearchVolume) sourceTrustScore += 0.25
  if (params.candidate.matchTypeRank >= 2) sourceTrustScore += 0.2
  if (isModelFamilyGuard) sourceTrustScore += 0.35
  if (params.candidate.isPreferredBucket) sourceTrustScore += 0.15
  if (isAiGenerated) sourceTrustScore -= 1.1
  if (languageAnalysis.softDemote) sourceTrustScore -= 0.9
  sourceTrustScore = clampNumber(sourceTrustScore, 0, 10)

  let preferredBucketSoftPrior = 0
  if (params.candidate.isPreferredBucket) {
    preferredBucketSoftPrior += 0.25
    if (selectedIntentScore >= 2) preferredBucketSoftPrior += 0.85
    else if (selectedIntentScore >= 1) preferredBucketSoftPrior += 0.45
    if (sourceTrustScore >= 7) preferredBucketSoftPrior += 0.55
    else if (sourceTrustScore >= 5) preferredBucketSoftPrior += 0.25
    if (hasModelAnchor) preferredBucketSoftPrior += 0.7
    if (hasSpecificDemandTail) preferredBucketSoftPrior += 0.5
    if (compactTrustedSoftFamily) preferredBucketSoftPrior += 0.75
    else if (trustedSoftFamily) preferredBucketSoftPrior += 0.45
    if (intentMargin >= 2) preferredBucketSoftPrior += 0.45
    else if (intentMargin >= 1) preferredBucketSoftPrior += 0.25
    if (isTransactional && !hasModelAnchor && !hasSpecificDemandTail) preferredBucketSoftPrior -= 0.35
    preferredBucketSoftPrior = clampNumber(preferredBucketSoftPrior, 0, 3.5)
  }

  return {
    hasModelAnchor,
    hasDemand,
    demandAnchorCount: demandAnchorTokens.length,
    hasSpecificDemandTail,
    isTransactional,
    isAiGenerated,
    isModelFamilyGuard,
    trustedSoftFamily,
    compactTrustedSoftFamily,
    hasReliableSearchVolume,
    sourceTrustScore,
    preferredBucketSoftPrior,
    intentScores: params.intentScores,
    selectedIntentScore,
    secondaryIntentScore,
    intentMargin,
    languageSoftDemote: languageAnalysis.softDemote,
    unauthorizedContentRatio: languageAnalysis.unauthorizedContentRatio,
  }
}

function buildRankedCandidate(params: {
  candidate: CreativeKeywordLike
  keyword: string
  normalized: string
  originalIndex: number
  isBrand: boolean
  isPureBrand: boolean
  isPreferredBucket: boolean
  creativeType: CanonicalCreativeType | null
  bucket: CreativeBucket | null | undefined
  brandName: string | undefined
  targetLanguage?: string
  wordCount: number
  allowModelIntentSoftFamilyFallback?: boolean
  disableVolumeReliance?: boolean
}): RankedCandidate {
  const sourceRank = normalizeSourceRank(
    params.candidate.source,
    params.candidate.sourceSubtype || params.candidate.sourceType
  )
  const matchTypeRank = normalizeMatchTypeRank(params.candidate.matchType)
  const searchVolume = Number(params.candidate.searchVolume || 0) || 0
  const intentScores = resolveCandidateIntentScores({
    keyword: params.keyword,
    bucket: params.bucket,
    isBrand: params.isBrand,
    isPureBrand: params.isPureBrand,
    isPreferredBucket: params.isPreferredBucket,
    brandName: params.brandName,
    source: params.candidate.source,
    sourceType: params.candidate.sourceType,
    sourceSubtype: params.candidate.sourceSubtype,
    derivedTags: params.candidate.derivedTags,
    searchVolume,
  })
  let selectedIntentScore = resolveSelectedIntentScore(intentScores, params.creativeType)
  if (params.creativeType === 'model_intent' && params.allowModelIntentSoftFamilyFallback) {
    selectedIntentScore += resolveModelIntentSoftFamilyIntentBoost({
      keyword: params.keyword,
      normalized: params.normalized,
      isBrand: params.isBrand,
      isPureBrand: params.isPureBrand,
      isPreferredBucket: params.isPreferredBucket,
      source: params.candidate.source,
      sourceType: params.candidate.sourceType,
      sourceSubtype: params.candidate.sourceSubtype,
      derivedTags: params.candidate.derivedTags,
      sourceRank,
      searchVolume,
      volumeUnavailableReason: params.candidate.volumeUnavailableReason,
    }, params.brandName)
  }

  const evidenceProfile = buildCandidateEvidenceProfile({
    candidate: {
      ...params.candidate,
      keyword: params.keyword,
      normalized: params.normalized,
      isBrand: params.isBrand,
      isPureBrand: params.isPureBrand,
      isPreferredBucket: params.isPreferredBucket,
      sourceRank,
      matchTypeRank,
      wordCount: params.wordCount,
      searchVolume,
      volumeUnavailableReason: params.candidate.volumeUnavailableReason,
    },
    creativeType: params.creativeType,
    brandName: params.brandName,
    targetLanguage: params.targetLanguage,
    intentScores,
    selectedIntentScoreOverride: selectedIntentScore,
    disableVolumeReliance: params.disableVolumeReliance,
  })

  const intentRank = Number((
    evidenceProfile.selectedIntentScore
    + evidenceProfile.preferredBucketSoftPrior * 0.35
    + evidenceProfile.sourceTrustScore * 0.2
    + Math.max(0, evidenceProfile.intentMargin) * 0.25
  ).toFixed(4))

  return {
    ...params.candidate,
    keyword: params.keyword,
    normalized: params.normalized,
    permutationKey: buildPermutationKey(params.keyword),
    originalIndex: params.originalIndex,
    isBrand: params.isBrand,
    isPureBrand: params.isPureBrand,
    isPreferredBucket: params.isPreferredBucket,
    sourceRank,
    matchTypeRank,
    intentRank,
    wordCount: params.wordCount,
    searchVolume,
    evidenceProfile,
  }
}

function isStrongPreferredBucketCandidate(candidate: RankedCandidate): boolean {
  if (!candidate.isPreferredBucket) return false
  const profile = candidate.evidenceProfile
  if (profile.preferredBucketSoftPrior >= 1.15) return true
  if (profile.hasModelAnchor && profile.selectedIntentScore >= 1) return true
  if (profile.compactTrustedSoftFamily) return true
  if (profile.hasSpecificDemandTail && profile.sourceTrustScore >= 6) return true
  return false
}

function compareRankedCandidates(a: RankedCandidate, b: RankedCandidate): number {
  const aProfile = a.evidenceProfile
  const bProfile = b.evidenceProfile
  const aModelFamilyGuard = aProfile.isModelFamilyGuard
  const bModelFamilyGuard = bProfile.isModelFamilyGuard
  const aHasModelAnchor = aProfile.hasModelAnchor
  const bHasModelAnchor = bProfile.hasModelAnchor

  if (
    !aHasModelAnchor
    && !bHasModelAnchor
    && aModelFamilyGuard !== bModelFamilyGuard
    && Math.abs(a.intentRank - b.intentRank) <= 1
  ) {
    return Number(bModelFamilyGuard) - Number(aModelFamilyGuard)
  }
  if (a.intentRank !== b.intentRank) return b.intentRank - a.intentRank
  if (aProfile.selectedIntentScore !== bProfile.selectedIntentScore) {
    return bProfile.selectedIntentScore - aProfile.selectedIntentScore
  }
  if (Math.abs(aProfile.preferredBucketSoftPrior - bProfile.preferredBucketSoftPrior) >= 0.35) {
    return bProfile.preferredBucketSoftPrior - aProfile.preferredBucketSoftPrior
  }
  if (aProfile.intentMargin !== bProfile.intentMargin) return bProfile.intentMargin - aProfile.intentMargin
  if (aProfile.sourceTrustScore !== bProfile.sourceTrustScore) {
    return bProfile.sourceTrustScore - aProfile.sourceTrustScore
  }
  if (aModelFamilyGuard !== bModelFamilyGuard) return Number(bModelFamilyGuard) - Number(aModelFamilyGuard)
  if (a.isPureBrand !== b.isPureBrand) return Number(b.isPureBrand) - Number(a.isPureBrand)
  if (a.isBrand !== b.isBrand) return Number(b.isBrand) - Number(a.isBrand)
  if (a.sourceRank !== b.sourceRank) return b.sourceRank - a.sourceRank
  const aReliableVolume = aProfile.hasReliableSearchVolume ? a.searchVolume : 0
  const bReliableVolume = bProfile.hasReliableSearchVolume ? b.searchVolume : 0
  if (aReliableVolume !== bReliableVolume) return bReliableVolume - aReliableVolume
  if (a.matchTypeRank !== b.matchTypeRank) return b.matchTypeRank - a.matchTypeRank
  if (a.wordCount !== b.wordCount) return a.wordCount - b.wordCount
  if (a.keyword.length !== b.keyword.length) return a.keyword.length - b.keyword.length
  return a.originalIndex - b.originalIndex
}

function resolveSourceQuotaConfig(params: {
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

      const strongFit = (
        profile.selectedIntentScore >= 2
        || profile.intentMargin >= 1.5
        || (profile.hasModelAnchor && profile.selectedIntentScore >= 1)
      )
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

  combinedRatio = clampNumber(combinedRatio, params.fallbackMode ? 0.12 : 0.05, params.fallbackMode ? 0.5 : 0.35)
  aiRatio = clampNumber(aiRatio, params.fallbackMode ? 0.08 : 0.03, params.fallbackMode ? 0.4 : 0.25)
  aiLlmRawRatio = clampNumber(aiLlmRawRatio, params.fallbackMode ? 0.05 : 0.02, params.fallbackMode ? 0.3 : 0.18)

  const combinedLowTrustCap = Math.max(0, Math.floor(safeMax * combinedRatio))
  const aiCap = Math.min(combinedLowTrustCap, Math.max(0, Math.floor(safeMax * aiRatio)))
  const aiLlmRawCap = Math.min(aiCap, Math.max(0, Math.floor(safeMax * aiLlmRawRatio)))

  return {
    combinedLowTrustCap,
    aiCap,
    aiLlmRawCap,
  }
}

function resolvePreferredBucketRequiredCount(params: {
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

  const strongDensity = params.strongPreferredAvailableCount / Math.max(1, params.totalAvailableCount)
  const strongSupply = params.strongPreferredAvailableCount / Math.max(1, params.maxKeywords)
  const adaptiveRatio = clampNumber(baseRatio + strongDensity * 0.12 + strongSupply * 0.08, 0.08, 0.45)

  let floor = 1
  if (params.maxKeywords >= 12 && params.creativeType !== 'model_intent') floor = 2
  if (params.maxKeywords >= 20 && strongDensity >= 0.35) floor = 3

  const target = Math.ceil(params.maxKeywords * adaptiveRatio)
  return Math.min(
    params.maxKeywords,
    params.strongPreferredAvailableCount,
    Math.max(floor, target)
  )
}

function isAiSubtype(sourceSubtype: string | undefined): boolean {
  const normalized = String(sourceSubtype || '').trim().toUpperCase()
  if (!normalized) return false
  if (normalized.startsWith('AI_')) return true
  return normalized === 'KEYWORD_EXPANSION'
}

function isAiLlmRawSubtype(sourceSubtype: string | undefined): boolean {
  const normalized = String(sourceSubtype || '').trim().toUpperCase()
  return (
    normalized === 'AI_LLM_RAW'
    || normalized === 'AI_GENERATED'
    || normalized === 'AI_FALLBACK_PLACEHOLDER'
  )
}

function isScoringSubtype(sourceSubtype: string | undefined): boolean {
  const normalized = String(sourceSubtype || '').trim().toUpperCase()
  return (
    normalized === 'SCORING_SUGGESTION'
    || normalized === 'GAP_INDUSTRY_BRANDED'
    || normalized === 'BRANDED_INDUSTRY_TERM'
  )
}

function classifyCandidateSource(candidate: RankedCandidate): {
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

function classifySourceGovernance(candidate: RankedCandidate): {
  bucket: SourceGovernanceBucket
  top1Eligible: boolean
  top2Eligible: boolean
} {
  const sourceSubtype = normalizeKeywordSourceSubtype({
    source: candidate.source,
    sourceType: candidate.sourceSubtype || candidate.sourceType,
  })
  const tier = getKeywordSourcePriority(sourceSubtype || candidate.sourceType || candidate.source).tier

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
      profile.hasSpecificDemandTail
      && profile.sourceTrustScore >= (params.fallbackMode ? 6.4 : 7)
      && !profile.isAiGenerated
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
    if (profile.hasSpecificDemandTail && profile.sourceTrustScore >= (params.fallbackMode ? 5.2 : 6)) {
      return true
    }
    if (
      profile.selectedIntentScore >= 2.5
      && profile.sourceTrustScore >= (params.fallbackMode ? 5.5 : 6.2)
      && !profile.isAiGenerated
    ) {
      return true
    }
    return false
  }

  return profile.sourceTrustScore >= (params.fallbackMode ? 5 : 6)
}

function applySourceQuotaOnSelectedCandidates(input: {
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
  const quota = resolveSourceQuotaConfig({
    maxKeywords: input.maxKeywords,
    fallbackMode: input.fallbackMode,
    creativeType: input.creativeType,
    rankedCandidates: input.selectedList,
  })
  const targetCount = Math.min(input.maxKeywords, input.selectedList.length)
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

  const pushAccepted = (candidate: RankedCandidate, classification: {
    lowTrust: boolean
    ai: boolean
    aiLlmRaw: boolean
  }): boolean => {
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
    const shouldReservePureBrand = (
      candidate.isPureBrand
      && acceptedPureBrandCount < input.requiredPureBrandCount
    )
    const shouldReservePreferredBucket = (
      candidate.isPreferredBucket
      && isStrongPreferredBucketCandidate(candidate)
      && acceptedStrongPreferredBucketCount < input.requiredPreferredBucketCount
    )
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
      if (!shouldAllowDeferredRefillCandidate({
        candidate,
        classification,
        creativeType: input.creativeType,
        fallbackMode: input.fallbackMode,
      })) {
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

function reconcileSourceQuotaAuditWithFinalOutput(input: {
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

function dedupeRankedCandidatePool(candidates: RankedCandidate[]): RankedCandidate[] {
  const deduped = new Map<string, RankedCandidate>()
  for (const candidate of candidates) {
    const existing = deduped.get(candidate.normalized)
    if (!existing || compareRankedCandidates(candidate, existing) < 0) {
      deduped.set(candidate.normalized, candidate)
    }
  }
  return Array.from(deduped.values())
}

function compareFinalOutputCandidates(
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

function repairProductIntentFrontload(params: {
  selected: RankedCandidate[]
  candidatePool: RankedCandidate[]
  brandName: string | undefined
}): RankedCandidate[] {
  const working = [...params.selected]
  const available = params.candidatePool.filter((candidate) =>
    !working.some((item) => item.normalized === candidate.normalized)
  )

  const takeReplacement = (predicate: (candidate: RankedCandidate) => boolean): RankedCandidate | null => {
    const index = available.findIndex(predicate)
    if (index < 0) return null
    const [candidate] = available.splice(index, 1)
    return candidate || null
  }

  if (
    working[0]
    && isAdjacentGenericProductCandidate(working[0], params.brandName)
  ) {
    const top1Replacement = takeReplacement((candidate) =>
      !isAdjacentGenericProductCandidate(candidate, params.brandName)
    )
    if (top1Replacement) working.splice(0, 1, top1Replacement)
  }

  const maxTop3 = Math.min(3, working.length)
  let top3DirectCount = working
    .slice(0, maxTop3)
    .filter((candidate) => isDirectProductAnchorCandidate(candidate, params.brandName))
    .length
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
    .filter((candidate) => isAdjacentGenericProductCandidate(candidate, params.brandName))
    .length
  while (adjacentTop3Count > 1) {
    const replacement = takeReplacement((candidate) =>
      !isAdjacentGenericProductCandidate(candidate, params.brandName)
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

function repairGovernanceFrontSlots(params: {
  creativeType: CanonicalCreativeType | null
  selected: RankedCandidate[]
  candidatePool: RankedCandidate[]
  brandName: string | undefined
}): RankedCandidate[] {
  const working = [...params.selected]
  const available = params.candidatePool.filter((candidate) =>
    !working.some((item) => item.normalized === candidate.normalized)
  )

  const topSlotPredicates = [
    (candidate: RankedCandidate) => classifySourceGovernance(candidate).top1Eligible,
    (candidate: RankedCandidate) => classifySourceGovernance(candidate).top2Eligible,
  ]

  for (let slot = 0; slot < Math.min(2, working.length); slot += 1) {
    if (topSlotPredicates[slot]?.(working[slot])) continue

    const replacementIndex = available.findIndex((candidate) => topSlotPredicates[slot]?.(candidate))
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
      isDirectProductAnchorCandidate(candidate, brandName)
      || isProductIntentDemandCandidate(candidate, brandName)
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
    (params.preserveOutput || params.allowPreferredBucketFallback)
    && isModelIntentPreferredFallbackCandidate(params.candidate, params.brandName)
  ) {
    return true
  }

  return false
}

function enforceFinalOutputInvariants(params: {
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
  const combinedPool = dedupeRankedCandidatePool([
    ...preservedOutput,
    ...params.rankedCandidates,
  ])
  const strictModelIntentQualifiedCount = params.creativeType === 'model_intent'
    ? combinedPool.filter((candidate) => isModelIntentQualifiedCandidate(candidate, params.brandName)).length
    : 0
  const allowPreferredBucketFallback = (
    params.creativeType === 'model_intent'
    && strictModelIntentQualifiedCount < Math.min(params.maxKeywords, combinedPool.length)
  )

  const isValidFinalCandidate = (candidate: RankedCandidate, preserveOutput: boolean): boolean => {
    if (containsAsinLikeToken(candidate.keyword)) return false
    if (candidate.evidenceProfile.unauthorizedContentRatio > 0) return false
    if (
      params.creativeType === 'model_intent'
      && !isModelIntentFinalEligibleCandidate({
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
    .filter((candidate) => isValidFinalCandidate(candidate, preservedOutputSet.has(candidate.normalized)))
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
  const rescueCap = desiredCount < 4
    ? Math.min(1, desiredCount)
    : Math.max(1, Math.floor(desiredCount * 0.3))
  const syntheticCap = params.fallbackMode ? Math.min(1, desiredCount) : 0

  const selected: RankedCandidate[] = [...effectivePreservedOutput]
  const selectedKeys = new Set(selected.map((candidate) => candidate.normalized))
  let selectedRescueCount = selected.filter((candidate) =>
    classifySourceGovernance(candidate).bucket === 'rescue'
    && !isRescueCapExemptCandidate(candidate, params.creativeType, params.brandName)
  ).length
  let selectedSyntheticCount = selected.filter((candidate) =>
    classifySourceGovernance(candidate).bucket === 'synthetic'
  ).length

  const canSelect = (candidate: RankedCandidate, relaxedTopSlot: boolean): boolean => {
    const governance = classifySourceGovernance(candidate)
    if (!relaxedTopSlot) {
      if (selected.length === 0 && !governance.top1Eligible) return false
      if (selected.length === 1 && !governance.top2Eligible) return false
    }
    if (
      governance.bucket === 'rescue'
      && !isRescueCapExemptCandidate(candidate, params.creativeType, params.brandName)
      && selectedRescueCount >= rescueCap
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
      governance.bucket === 'rescue'
      && !isRescueCapExemptCandidate(candidate, params.creativeType, params.brandName)
    ) {
      selectedRescueCount += 1
    }
    if (governance.bucket === 'synthetic') selectedSyntheticCount += 1
  }

  const supplementalPool = effectivePool.filter((candidate) => !selectedKeys.has(candidate.normalized))
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

    const replacements = pool.filter((candidate) =>
      matcher(candidate)
      && !next.some((item) => item.normalized === candidate.normalized)
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
      Math.min(params.requiredPureBrandCount, trimmedSelected.length || params.requiredPureBrandCount),
      (candidate) => candidate.isPureBrand,
      (candidate) => !candidate.isPureBrand
    )
  }
  if (params.requiredBrandCount > 0) {
    trimmedSelected = enforceCoverageFloor(
      trimmedSelected,
      effectivePool,
      Math.min(params.requiredBrandCount, Math.max(trimmedSelected.length, params.requiredBrandCount)),
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

function rebalanceModelIntentCandidates(input: {
  selectedList: RankedCandidate[]
  maxKeywords: number
  brandName?: string
  rankedCandidates?: RankedCandidate[]
}): RankedCandidate[] {
  const selectedList = Array.isArray(input.selectedList) ? input.selectedList : []
  if (selectedList.length <= 1) return selectedList

  const allRankedCandidates = Array.isArray(input.rankedCandidates) ? input.rankedCandidates : []
  const compactSoftFamilyUniverse = allRankedCandidates
    .filter((candidate) =>
      !hasModelAnchorEvidence({ keywords: [candidate.keyword] })
      && isCompactTrustedModelIntentSoftFamilyCandidate(candidate, input.brandName)
    )
    .sort(compareRankedCandidates)
  const desiredSoftFamilyCount = Math.min(
    compactSoftFamilyUniverse.length,
    Math.max(2, Math.min(6, Math.floor(input.maxKeywords * 0.2)))
  )
  const selectedCompactSoftFamilyCount = selectedList.filter((candidate) =>
    !hasModelAnchorEvidence({ keywords: [candidate.keyword] })
    && isCompactTrustedModelIntentSoftFamilyCandidate(candidate, input.brandName)
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
    return [
      ...modelCandidates,
      ...nonModelCandidates.slice(0, maxNonModelCount),
    ]
      .sort(compareRankedCandidates)
      .slice(0, input.maxKeywords)
  }

  const compactSoftFamilySet = new Set(compactSoftFamilyCandidates.map((candidate) => candidate.normalized))
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
  const genericBudget = compactSoftFamilyCandidates.length > softFamilyReserve
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

function resolveCreativeKeywordContractDefaults(params: {
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

const MODEL_INTENT_PARAM_TOKENS = new Set([
  'battery', 'batteries', 'bundle', 'bundles', 'color', 'colors', 'edition', 'gen', 'generation',
  'height', 'inch', 'inches', 'length', 'pack', 'packs', 'piece', 'pieces', 'set', 'sets',
  'size', 'sizes', 'version', 'weight', 'width', 'wh', 'mah', 'oz', 'lb', 'lbs', 'ml', 'l',
  'cm', 'mm', 'm', 'ft', 'qt', 'pcs', 'pc', 'full', 'queen', 'king', 'twin', 'california'
])

function isDimensionOrParamLikeToken(token: string): boolean {
  const normalized = String(token || '').trim().toLowerCase()
  if (!normalized) return true
  if (/^\d+$/.test(normalized)) return true
  if (/^\d+(?:[a-z]{1,4})$/i.test(normalized)) return true
  if (/^[a-z]$/i.test(normalized)) return true
  if (/^\d+(?:\.\d+)?$/.test(normalized)) return true
  if (MODEL_INTENT_PARAM_TOKENS.has(normalized)) return true
  return false
}

function isModelIntentDimensionOrParamOnlyText(
  keyword: string,
  brandName: string | undefined
): boolean {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return false
  if (hasModelAnchorEvidence({ keywords: [normalized] })) return false

  const brandTokens = new Set(
    normalizeGoogleAdsKeyword(brandName || '')
      ?.split(/\s+/)
      .filter(Boolean) || []
  )
  const contentTokens = normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !brandTokens.has(token))
  if (contentTokens.length === 0) return true

  return contentTokens.every(isDimensionOrParamLikeToken)
}

function isModelIntentDimensionOrParamOnlyCandidate(
  candidate: RankedCandidate,
  brandName: string | undefined
): boolean {
  if (candidate.evidenceProfile.hasModelAnchor) return false
  if (candidate.evidenceProfile.compactTrustedSoftFamily) return false
  if (candidate.evidenceProfile.trustedSoftFamily) return false
  if (candidate.evidenceProfile.isModelFamilyGuard) return false
  return isModelIntentDimensionOrParamOnlyText(candidate.keyword, brandName)
}

function isDirectProductAnchorCandidate(
  candidate: RankedCandidate,
  brandName: string | undefined
): boolean {
  if (candidate.isPureBrand) return false

  const profile = candidate.evidenceProfile
  if (profile.hasModelAnchor) return true
  if (candidate.isBrand && profile.hasDemand) return true
  if (profile.hasSpecificDemandTail) return true

  return (
    !candidate.isBrand
    && profile.hasDemand
    && profile.sourceTrustScore >= 6.4
    && profile.selectedIntentScore >= 1.5
    && !profile.languageSoftDemote
    && hasDemandAnchor(candidate.keyword, brandName)
  )
}

function isAdjacentGenericProductCandidate(
  candidate: RankedCandidate,
  brandName: string | undefined
): boolean {
  if (candidate.isPureBrand) return false

  const profile = candidate.evidenceProfile
  if (!profile.hasDemand) return false
  if (isDirectProductAnchorCandidate(candidate, brandName)) return false

  return (
    !candidate.isBrand
    || (profile.selectedIntentScore < 2 && profile.sourceTrustScore < 6.8)
  )
}

function isProductIntentDemandCandidate(
  candidate: RankedCandidate,
  brandName: string | undefined
): boolean {
  if (candidate.isPureBrand) return false
  if (isDirectProductAnchorCandidate(candidate, brandName)) return true

  const profile = candidate.evidenceProfile
  if (!profile.hasDemand) return false
  if (candidate.isBrand) return true

  return (
    profile.sourceTrustScore >= 5.8
    && profile.selectedIntentScore >= 1.25
    && !profile.languageSoftDemote
    && hasDemandAnchor(candidate.keyword, brandName)
  )
}

function countProductIntentDemandCandidates(
  candidates: RankedCandidate[],
  brandName: string | undefined
): number {
  return candidates.filter((candidate) => isProductIntentDemandCandidate(candidate, brandName)).length
}

function findProductIntentReplacementIndex(input: {
  candidates: RankedCandidate[]
  requiredPureBrandCount: number
  brandName: string | undefined
}): number {
  const pureBrandCount = input.candidates.filter((candidate) => candidate.isPureBrand).length
  let replacementIndex = -1
  let replacementScore = -1

  for (let index = 0; index < input.candidates.length; index += 1) {
    const candidate = input.candidates[index]
    if (isProductIntentDemandCandidate(candidate, input.brandName)) continue

    const hasDemand = hasDemandAnchor(candidate.keyword, input.brandName)
    const hasModelAnchor = hasModelAnchorEvidence({ keywords: [candidate.keyword] })
    let score = -1

    if (candidate.isPureBrand) {
      if (pureBrandCount <= input.requiredPureBrandCount) continue
      score = 4
    } else if (candidate.isBrand && !hasDemand && !hasModelAnchor) {
      score = 3
    } else if (candidate.isBrand && !hasDemand) {
      score = 2
    }

    if (score < 0) continue

    const existingReplacement = replacementIndex >= 0
      ? input.candidates[replacementIndex]
      : null
    const candidateIsWorse =
      !existingReplacement || compareRankedCandidates(candidate, existingReplacement) > 0

    if (score > replacementScore || (score === replacementScore && candidateIsWorse)) {
      replacementIndex = index
      replacementScore = score
    }
  }

  return replacementIndex
}

function isModelIntentQualifiedCandidate(
  candidate: RankedCandidate,
  brandName: string | undefined
): boolean {
  if (candidate.isPureBrand) return false

  const profile = candidate.evidenceProfile
  if (profile.unauthorizedContentRatio > 0) return false
  if (isModelIntentDimensionOrParamOnlyCandidate(candidate, brandName)) return false
  if (profile.hasModelAnchor) return true
  if (
    profile.isModelFamilyGuard
    && profile.hasDemand
    && (
      profile.demandAnchorCount >= 2
      || (
        candidate.isBrand
        && profile.demandAnchorCount >= 1
        && profile.sourceTrustScore >= 6.2
      )
    )
  ) {
    return true
  }
  if (profile.compactTrustedSoftFamily) return true
  if (
    profile.trustedSoftFamily
    && profile.hasDemand
    && candidate.isBrand
    && profile.sourceTrustScore >= 5.6
    && profile.selectedIntentScore >= 1
  ) {
    return true
  }
  if (isModelIntentRescueBackstopCandidate(candidate, brandName)) return true

  return false
}

function isModelIntentPreferredFallbackCandidate(
  candidate: RankedCandidate,
  brandName: string | undefined
): boolean {
  if (candidate.isPureBrand) return false

  const profile = candidate.evidenceProfile
  if (!candidate.isPreferredBucket || !isStrongPreferredBucketCandidate(candidate)) return false
  if (profile.unauthorizedContentRatio > 0) return false
  if (profile.isAiGenerated || profile.languageSoftDemote) return false
  if (profile.hasModelAnchor || profile.isModelFamilyGuard) return false
  if (profile.trustedSoftFamily || profile.compactTrustedSoftFamily) return false
  if (!profile.hasDemand || !profile.hasSpecificDemandTail) return false
  if (profile.preferredBucketSoftPrior < 0.95) return false
  if (isModelIntentDimensionOrParamOnlyCandidate(candidate, brandName)) return false

  return true
}

function countModelIntentQualifiedCandidates(
  candidates: RankedCandidate[],
  brandName: string | undefined
): number {
  return candidates.filter((candidate) => isModelIntentQualifiedCandidate(candidate, brandName)).length
}

function findModelIntentReplacementIndex(input: {
  candidates: RankedCandidate[]
  brandName: string | undefined
}): number {
  let replacementIndex = -1
  let replacementScore = -1

  for (let index = 0; index < input.candidates.length; index += 1) {
    const candidate = input.candidates[index]
    if (isModelIntentQualifiedCandidate(candidate, input.brandName)) continue

    let score = 0
    if (candidate.isPureBrand) score += 5
    else if (candidate.isBrand && !hasDemandAnchor(candidate.keyword, input.brandName)) score += 4
    else if (candidate.isBrand) score += 3
    else if (!candidate.evidenceProfile.hasSpecificDemandTail) score += 2
    else score += 1

    const existingReplacement = replacementIndex >= 0
      ? input.candidates[replacementIndex]
      : null
    const candidateIsWorse =
      !existingReplacement || compareRankedCandidates(candidate, existingReplacement) > 0

    if (score > replacementScore || (score === replacementScore && candidateIsWorse)) {
      replacementIndex = index
      replacementScore = score
    }
  }

  return replacementIndex
}

function enforceCreativeKeywordContract(input: {
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
      .filter((candidate) =>
        !seen.has(candidate.normalized)
        && isProductIntentDemandCandidate(candidate, input.brandName)
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
      .filter((candidate) =>
        !seen.has(candidate.normalized)
        && isModelIntentQualifiedCandidate(candidate, input.brandName)
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

  return working
    .sort(compareRankedCandidates)
    .slice(0, input.maxKeywords)
}

function composeBrandedKeyword(keyword: string, normalizedBrand: string, maxWords: number): string | null {
  const brandTokens = normalizedBrand.split(/\s+/).filter(Boolean)
  if (brandTokens.length === 0) return null

  const normalizedKeyword = normalizeGoogleAdsKeyword(keyword)
  if (!normalizedKeyword) return null
  const keywordTokens = normalizedKeyword.split(/\s+/).filter(Boolean)
  if (keywordTokens.length === 0) return null

  const remainder: string[] = []
  for (let i = 0; i < keywordTokens.length;) {
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
      !profile.hasModelAnchor
      && !profile.compactTrustedSoftFamily
      && !profile.hasSpecificDemandTail
    ) {
      return false
    }
    if (MODEL_INTENT_GENERIC_SPILLOVER_PATTERN.test(candidate.normalized)) return false
  }

  return true
}

function ensureBrandCoverage(
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

  const existing = new Set(candidates.map(candidate => candidate.normalized))
  const existingBrandCount = candidates.filter(candidate => candidate.isBrand).length
  if (existingBrandCount >= targetBrandCount) return candidates

  const nonBrandCandidates = candidates
    .filter((candidate) =>
      shouldGenerateCompactBrandedVariant(candidate, input.creativeType || null, input.brandName)
    )
    .sort(compareRankedCandidates)

  const augmented: RankedCandidate[] = [...candidates]
  let nextIndex = candidates.reduce((max, candidate) => Math.max(max, candidate.originalIndex), -1) + 1
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

function ensurePureBrandCoverage(
  candidates: RankedCandidate[],
  input: SelectCreativeKeywordsInput,
  maxWords: number,
  targetPureBrandCount: number
): RankedCandidate[] {
  if (targetPureBrandCount <= 0) return candidates
  if (input.creativeType !== 'brand_intent' && input.creativeType !== 'product_intent') return candidates

  const normalizedBrand = normalizeGoogleAdsKeyword(input.brandName || '')
  if (!normalizedBrand || normalizedBrand === 'unknown') return candidates

  const pureBrandKeywords = getPureBrandKeywords(normalizedBrand)
  if (pureBrandKeywords.length === 0) return candidates

  const existing = new Set(candidates.map((candidate) => candidate.normalized))
  const existingPureBrandCount = candidates.filter((candidate) => candidate.isPureBrand).length
  if (existingPureBrandCount >= targetPureBrandCount) return candidates

  const augmented: RankedCandidate[] = [...candidates]
  let nextIndex = candidates.reduce((max, candidate) => Math.max(max, candidate.originalIndex), -1) + 1
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

function toRankedCandidates(
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
    normalizedBrand && normalizedBrand !== 'unknown'
      ? getPureBrandKeywords(normalizedBrand)
      : []

  const merged: CreativeKeywordLike[] = []
  const disableVolumeReliance = Boolean(
    options?.disableVolumeReliance
    || input.fallbackMode
    || input.keywordsWithVolume?.some((item) =>
      hasActiveSearchVolumeUnavailableFlag(item as any)
    )
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
    const keyword = String(candidate.keyword || '').trim()
    if (!keyword) continue

    const normalized = normalizeGoogleAdsKeyword(keyword)
    if (!normalized) continue
    const wordCount = normalized.split(/\s+/).filter(Boolean).length || 1
    if (wordCount > maxWords) continue

    const isBrand = pureBrandKeywords.length > 0
      ? containsPureBrand(keyword, pureBrandKeywords)
      : false
    const isPureBrand = pureBrandKeywords.length > 0
      ? isPureBrandKeyword(keyword, pureBrandKeywords)
      : false
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
    if (isLowQualityCandidate(ranked, input.creativeType || null, input.brandName, {
      ...options,
      targetLanguage: input.targetLanguage,
      disableVolumeReliance,
    })) {
      continue
    }

    const existing = dedupedByNormalized.get(normalized)
    if (!existing || compareRankedCandidates(ranked, existing) < 0) {
      dedupedByNormalized.set(normalized, ranked)
    }
  }

  const dedupedByPermutation = new Map<string, RankedCandidate>()
  for (const candidate of dedupedByNormalized.values()) {
    const permutationKey = candidate.permutationKey || candidate.normalized
    const existing = dedupedByPermutation.get(permutationKey)
    if (!existing || compareRankedCandidates(candidate, existing) < 0) {
      dedupedByPermutation.set(permutationKey, candidate)
    }
  }

  return compactDemandSemanticDuplicates({
    candidates: Array.from(dedupedByPermutation.values()),
    creativeType: input.creativeType || null,
    brandName: input.brandName,
  })
}

function buildBucketSpecificRescueCandidates(params: {
  input: SelectCreativeKeywordsInput
  creativeType: CanonicalCreativeType | null
  maxWords: number
  requiredBrandCount: number
}): RankedCandidate[] {
  if (params.creativeType !== 'model_intent') return []

  return ensureBrandCoverage(
    ensurePureBrandCoverage(
      toRankedCandidates(
        { ...params.input, creativeType: params.creativeType },
        params.maxWords,
        {
          allowModelIntentPreferredFallback: true,
          allowModelIntentSoftFamilyFallback: true,
          disableVolumeReliance: Boolean(params.input.fallbackMode),
        }
      ),
      { ...params.input, creativeType: params.creativeType },
      params.maxWords,
      0
    ),
    { ...params.input, creativeType: params.creativeType },
    params.maxWords,
    params.requiredBrandCount
  )
}

function buildModelIntentPrecisionRescueCandidates(params: {
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
    seenNormalized.add(String(normalized || '').trim().toLowerCase())
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
    seenNormalized.add(String(normalized || '').trim().toLowerCase())
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

function backfillCreativeOutputCandidates(params: {
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
    normalizedBrand && normalizedBrand !== 'unknown'
      ? getPureBrandKeywords(normalizedBrand)
      : []
  const isBrand = pureBrandKeywords.length > 0
    ? containsPureBrand(keyword, pureBrandKeywords)
    : false
  const isPureBrand = pureBrandKeywords.length > 0
    ? isPureBrandKeyword(keyword, pureBrandKeywords)
    : false

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
    ...(Array.isArray(params.input.keywordsWithVolume) ? params.input.keywordsWithVolume.map((item) => item.keyword) : []),
    ...(Array.isArray(params.input.keywords) ? params.input.keywords : []),
  ]

  const candidateTexts = new Map<string, string>()
  for (const rawKeyword of rawKeywords) {
    const normalized = normalizeGoogleAdsKeyword(rawKeyword || '')
    if (!normalized || containsAsinLikeToken(normalized)) continue
    if (params.creativeType === 'model_intent' && !isModelIntentRescueKeyword(normalized, params.input.brandName)) {
      continue
    }
    const compact = normalized.split(/\s+/).filter(Boolean).slice(0, params.maxWords).join(' ').trim()
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
      value += getDemandAnchorTokens(text, params.input.brandName)
        .filter((token) => !/^\d+$/.test(token))
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
      rescue
      && (
        params.creativeType !== 'model_intent'
        || isModelIntentQualifiedCandidate(rescue, params.input.brandName)
      )
    ) {
      return [rescue]
    }
  }

  return []
}

function buildGuaranteedNonEmptyRescueCandidates(params: {
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
    normalizedBrand && normalizedBrand !== 'unknown'
      ? getPureBrandKeywords(normalizedBrand)
      : []
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

export function selectCreativeKeywords(input: SelectCreativeKeywordsInput): SelectCreativeKeywordsOutput {
  const creativeType = input.creativeType
    || deriveCanonicalCreativeType({
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
  const requestedBrandOnly = creativeType === 'brand_intent'
    ? true
    : creativeType === 'model_intent'
      ? false
      : Boolean(input.brandOnly)

  const maxWordsInput = Number(input.maxWords)
  const maxWords = Number.isFinite(maxWordsInput)
    ? Math.max(1, Math.floor(maxWordsInput))
    : resolveCreativeKeywordMaxWords(creativeType)
  const fallbackMode = Boolean(input.fallbackMode)
    || Boolean(
      input.keywordsWithVolume?.some((item) =>
        hasActiveSearchVolumeUnavailableFlag(item as any)
      )
    )

  const requiredPureBrandCount = contractDefaults.requiredPureBrandCount
  const effectiveBrandReserve = brandReserve
  const effectiveMinBrandKeywords = minBrandKeywords
  const requiredBrandCount = requestedBrandOnly
    ? maxKeywords
    : Math.min(maxKeywords, effectiveMinBrandKeywords)

  let rankedCandidates = ensureBrandCoverage(
    ensurePureBrandCoverage(
      toRankedCandidates(
        { ...input, creativeType },
        maxWords,
        { disableVolumeReliance: fallbackMode }
      ),
      { ...input, creativeType },
      maxWords,
      creativeType === 'brand_intent' || creativeType === 'product_intent' ? 1 : 0
    ),
    { ...input, creativeType },
    maxWords,
    requiredBrandCount
  )
  if (
    creativeType === 'model_intent'
    && rankedCandidates.length < Math.min(maxKeywords, MODEL_INTENT_UNDERFILL_CANDIDATE_FLOOR)
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
    .filter(candidate => candidate.isBrand)
    .sort(compareRankedCandidates)
  const enforceBrandOnly = requestedBrandOnly && brandCandidates.length > 0

  if ((creativeType === 'brand_intent' || creativeType === 'product_intent') && pureBrandCandidates.length > 0) {
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

    const reservedBrandCount = Math.min(maxKeywords, Math.max(requiredBrandCount, effectiveBrandReserve))
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
  const quotaBalancedSelectedList = creativeType === 'model_intent'
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
  let outputCandidates = selectedList.filter((candidate) => !containsAsinLikeToken(candidate.keyword))
  if ((creativeType === 'model_intent' || creativeType === 'product_intent') && outputCandidates.length > 0) {
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
    normalizedBrand && normalizedBrand !== 'unknown'
      ? getPureBrandKeywords(normalizedBrand)
      : []
  const keywordsWithVolume: CreativeKeywordLike[] = outputCandidates.map((candidate) => {
    const finalMatchType: CreativeKeywordMatchType = creativeType === 'model_intent'
      ? resolveModelIntentFinalMatchType(candidate)
      : candidate.matchType || candidate.suggestedMatchType || 'PHRASE'
    const normalizedPrioritySubtype = normalizeKeywordSourceSubtype({
      source: candidate.source,
      sourceType: candidate.sourceType,
    })
    const explicitSourceSubtype =
      normalizeAuditString(candidate.sourceSubtype)
      || normalizeAuditString(candidate.sourceType)?.toUpperCase()
    const sourceSubtype = (
      explicitSourceSubtype === 'KEYWORD_POOL'
      || explicitSourceSubtype === 'CANONICAL_BUCKET_VIEW'
    )
      ? normalizedPrioritySubtype || explicitSourceSubtype
      : explicitSourceSubtype || normalizedPrioritySubtype
    const sourceTier = getKeywordSourcePriority(sourceSubtype || candidate.sourceType || candidate.source).tier
    const sourceGovernance = classifySourceGovernance(candidate)
    const rawSource =
      normalizeAuditString(candidate.rawSource)
      || inferKeywordRawSource({
        source: candidate.source,
        sourceType: sourceSubtype || candidate.sourceType,
      })
    const derivedTags =
      normalizeAuditTags(candidate.derivedTags)
      || inferKeywordDerivedTags({
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
      contractRole === 'fallback'
      || fallbackReason
      || rescueStage
      || sourceGovernance.bucket === 'rescue'
      || sourceGovernance.bucket === 'synthetic'
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
      sourceType: normalizeAuditString(candidate.sourceType) || normalizeAuditString(candidate.source),
      sourceSubtype,
      sourceTier,
      sourceGovernanceBucket: sourceGovernance.bucket,
      sourceTop1Eligible: sourceGovernance.top1Eligible,
      sourceTop2Eligible: sourceGovernance.top2Eligible,
      rawSource,
      derivedTags,
      isDerived,
      isFallback,
      sourceField: normalizeAuditString(candidate.sourceField) || inferSourceField(candidate.source),
      anchorType: normalizeAuditString(candidate.anchorType) || inferAnchorType({
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
    keywords: keywordsWithVolume.map(item => item.keyword),
    keywordsWithVolume,
    truncated: rankedCandidates.length > keywordsWithVolume.length,
    sourceQuotaAudit: reconciledSourceQuotaAudit,
  }
}
