/**
 * 创意关键词集合构建：类型、常量与审计结构
 */
import type { KeywordSupplementationReport } from '../../creatives/generator/types'
import type { CanonicalCreativeType } from '../../creatives/server'
import type { CreativeKeywordSourceQuotaAudit } from './creative-keyword-selection'
import type { PoolKeywordData } from '../offer-pool'
import { KEYWORD_POLICY } from '../planner/keyword-policy'

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
  skipSupplementAiRanking?: boolean
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
  keywordsWithVolume: PoolKeywordData[]
  keywordSupplementation?: KeywordSupplementationReport
  contextFallbackStrategy: 'filtered' | 'keyword_pool' | 'original'
  audit: CreativeKeywordAudit
}

export interface CreativeKeywordCandidateProvenance {
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

export interface CreativeKeywordSourceRatioItem {
  count: number
  ratio: number
}

export interface CreativeKeywordContextFilterStats {
  removedByContextMismatch: number
  removedByForbidden: number
  removedByQuality: number
  removedByModelFamily: number
  removedByIntentTightening: number
}

export interface CreativeKeywordSelectionMetrics {
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

export const CREATIVE_PROMPT_KEYWORD_LIMIT = KEYWORD_POLICY.creative.promptKeywordLimit
export const BUILDER_MODEL_ANCHOR_PATTERN = /\b[a-z]*\d+[a-z0-9-]*\b/i
export const BUILDER_STANDALONE_MODEL_TOKEN_PATTERN = /^[a-z][a-z0-9-]*\d[a-z0-9-]*$/i
export const BUILDER_OFFER_CONTEXT_FILTERED_TAG = 'OFFER_CONTEXT_FILTERED'
export const RESCUE_PREFIX_NOISE_TOKENS = new Set([
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
export const RESCUE_BREAK_TOKENS = new Set([
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
export const RESCUE_TRAILING_CONNECTOR_TOKENS = new Set([
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
export const RESCUE_TRAILING_CONNECTOR_ALLOWED_BIGRAMS = new Set(['check in', 'log in', 'sign in'])
export const RESCUE_SHORT_NUMERIC_SUFFIX_ALLOWED_PREV_TOKENS = new Set([
  'gen',
  'mark',
  'mk',
  'series',
  'ver',
  'version',
])
export const RESCUE_INLINE_SKIP_TOKENS = new Set(['and', 'for', 'or', 'plus', 's'])
export const RESCUE_FORBIDDEN_TOPIC_TOKENS = new Set([
  'bistro',
  'menu',
  'shopify',
  'template',
  'theme',
  'wordpress',
])
export const RESCUE_SEGMENT_SPLIT_PATTERN = /[,;:()\-–—|]+/
export const RESCUE_CONTEXT_TEXT_MAX_ITEMS = 16
export const RESCUE_CONTEXT_DETAIL_MAX_CANDIDATES: Record<
  'brand_intent' | 'model_intent' | 'product_intent',
  number
> = {
  brand_intent: 12,
  model_intent: 8,
  product_intent: 12,
}
export const RESCUE_NEUTRAL_MODEL_TOKEN_PATTERN = /\b[a-z]{1,10}\d[a-z0-9-]{0,10}\b/i
export const RESCUE_NEUTRAL_SPEC_TOKEN_PATTERN =
  /\b\d{2,4}\s*(?:gpd|btu|db|inch|in|cm|mm|w|kw|v|mah|wh|hz|oz|lb|lbs|kg)\b/i
export const RESCUE_NEUTRAL_RATIO_TOKEN_PATTERN = /\b\d{1,2}\s*:\s*\d{1,2}\b/
export const RESCUE_NEUTRAL_CERT_TOKEN_PATTERN = /\bnsf\s*\/?\s*ansi\s*([0-9,&\s]+)/i
export const RESCUE_NEUTRAL_DETAIL_MAX_CANDIDATES = 12
export const RELAXED_FILTERING_BUCKET_FLOOR_BY_BUCKET: Record<'A' | 'B' | 'D', number> = {
  A: 10,
  B: 8,
  D: 10,
}
export const RELAXED_FILTERING_PRIORITY_SOURCE_PATTERNS = [
  'BRAND_SEED',
  'TITLE_EXTRACT',
  'PARAM_EXTRACT',
  'CANONICAL_BUCKET_VIEW',
]
export const CREATIVE_KEYWORD_ALERT_CONTEXT_REMOVAL_THRESHOLD = 0.8
export const CREATIVE_KEYWORD_ALERT_NON_TARGET_RATIO_THRESHOLD = 0.05

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
