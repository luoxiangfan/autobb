/**
 * 创意关键词选择：类型、常量与模式
 */



import {
  type CanonicalCreativeType,
} from '../../creatives/server'
import {
  type KeywordSourceTier,
} from './creative-keyword-source-priority'



export const CREATIVE_KEYWORD_MAX_COUNT = 50
export const CREATIVE_BRAND_KEYWORD_RESERVE = 10
export const CREATIVE_KEYWORD_MAX_WORDS = 6
export const CREATIVE_KEYWORD_MAX_WORDS_BY_TYPE: Record<CanonicalCreativeType, number> = {
  brand_intent: 6,
  model_intent: 7,
  product_intent: 8,
}
export const MODEL_INTENT_BRAND_FLOOR = 3
export const MODEL_INTENT_UNDERFILL_CANDIDATE_FLOOR = 8
export const MODEL_INTENT_BRANDED_SINGLE_CORE_SEARCH_VOLUME_FLOOR = 2000
export const PRODUCT_INTENT_BRAND_FLOOR = 1
export const PRODUCT_INTENT_NON_BRAND_FLOOR = 2

export type CreativeBucket = 'A' | 'B' | 'C' | 'D' | 'S'
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

export interface RankedCandidate extends CreativeKeywordLike {
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

export interface CandidateIntentScores {
  brand_intent: number
  model_intent: number
  product_intent: number
}

export interface CandidateEvidenceProfile {
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

export type SourceGovernanceBucket = 'primary' | 'conditional' | 'rescue' | 'synthetic' | 'unknown'

export const D_INTENT_PATTERN =
  /\b(buy|price|deal|sale|discount|coupon|offer|cost|cheap|best|review|reviews?)\b/i
export const A_TRUST_PATTERN = /\b(official|authentic|original|genuine|warranty|trusted|brand)\b/i
export const B_SCENARIO_PATTERN =
  /\b(for|outdoor|indoor|home|office|garden|yard|driveway|wall|path|walkway|pool|tree)\b/i
export const PLATFORM_PATTERN = /\b(amazon|walmart|ebay|etsy|aliexpress|temu)\b/i
export const COMMUNITY_PATTERN = /\b(reddit|quora|forum|forums)\b/i
export const INFO_QUERY_PATTERN =
  /\b(what is|meaning|tutorial|guide|manual|how to|instructions?)\b/i
export const QUESTION_PREFIX_PATTERN =
  /^(?:what|why|how|when|where|who|which|is|are|do|does|can|should|could)\b/i
export const REVIEW_COMPARE_PATTERN = /\b(review|reviews|comparison|compare|vs)\b/i
export const PRICE_TRACKER_PATTERN = /\b(price\s*tracker|track(?:ing)?\s*price)\b/i
export const NOISE_STACK_PATTERN =
  /\b(electronics?\s+photo\s+wearable\s+technology|photo\s+wearable\s+technology)\b/i
export const REPEATED_ACTION_PATTERN = /\b(buy|shop|purchase|order)\b.*\b\1\b/i
export const LOCALE_NOISE_PATTERN = /\b(ulasan|kabupaten|bekasi|shopee|kasur|gambar|colchon|rng)\b/i
export const BRAND_SLOGAN_PATTERN = /\b(a\s+cozy\s+home\s+made\s+simple|home\s+made\s+simple)\b/i
export const URL_FRAGMENT_PATTERN = /\b(?:https?|www|com|dp)\b/i
export const COMPONENT_NOISE_PATTERN =
  /\b(?:included\s+components?|package\s+contents?|box\s+contents?|what\s+s?\s+in\s+the\s+box)\b/i
export const MODEL_INTENT_GENERIC_SPILLOVER_PATTERN =
  /\b(option|options|choice|choices|premium|quality|value|online|daily|everyday|results?|system|technology|performance|style|styles)\b/i
export const AI_TEMPLATE_SENSITIVE_SOURCE_SUBTYPES = new Set([
  'AI_GENERATED',
  'AI_LLM_RAW',
  'KEYWORD_EXPANSION',
  'AI_FALLBACK_PLACEHOLDER',
  'CLUSTERED',
])
export const AI_TEMPLATE_SPILLOVER_TOKENS = new Set([
  'choice',
  'choices',
  'option',
  'options',
  'solution',
  'solutions',
  'premium',
  'quality',
  'value',
  'daily',
  'everyday',
  'style',
  'styles',
  'performance',
  'technology',
  'system',
  'systems',
])
export const AI_TEMPLATE_NOISE_ONLY_TOKENS = new Set(['everyone', 'everybody', 'anyone'])
export const AI_TEMPLATE_PHRASE_PATTERNS = [
  /\b(?:smart|premium|ultimate|best|top)\s+(?:choice|option|solution)s?\b/i,
  /\b(?:daily|everyday)\s+(?:choice|option|solution|use)\b/i,
  /\b(?:high|top|premium)\s+quality\b/i,
  /\b(?:best|top)\s+value\b/i,
  /\b(?:for|to)\s+every(?:one|day)\b/i,
  /\b(?:lifestyle|home)\s+(?:essential|essentials|must\s*have)\b/i,
]
export const AI_TEMPLATE_SAFE_SPEC_PATTERN =
  /\b\d+\s*(?:inch|in|oz|ml|l|pack|count|ct|pcs|piece|w|wh|mah|gb|tb|btu|doe|ashrae)\b/i
export const PROMO_PATTERN = /\b(discount|coupon|cheap|sale|deal|offer|promo|price|cost)\b/i
export const STORE_NAV_PATTERN =
  /\b(official\s+store|store\s+locator|near\s+me|shop\s+near\s+me)\b/i
export const FEATURE_SCENARIO_PATTERN =
  /\b(cordless|wireless|portable|smart|pet|outdoor|indoor|home|office|travel|waterproof|quiet|fast|compact|lightweight)\b/i
export const TRANSACTIONAL_MODIFIER_PATTERN =
  /\b(buy|purchase|order|shop|shopping|shops|price|pricing|cost|deal|deals|discount|sale|offer|coupon|promo|store)\b/i
export const TRANSACTIONAL_MODIFIER_TOKENS = new Set([
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
export const NON_ANCHOR_TOKENS = new Set([
  'official',
  'store',
  'shop',
  'near',
  'me',
  'brand',
  'buy',
  'sale',
  'deal',
  'discount',
  'coupon',
  'offer',
  'promo',
  'price',
  'cost',
  'cheap',
  'best',
  'review',
  'reviews',
  'comparison',
  'compare',
  'vs',
  'online',
  'for',
  'with',
  'and',
  'the',
  'a',
  'an',
])
export const DEMAND_FALLBACK_NOISE_TOKENS = new Set([
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
export const MODEL_INTENT_SOFT_FAMILY_NOISE_TOKENS = new Set([
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
