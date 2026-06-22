/**
 * 创意关键词选择：候选构建、评分与意图分类
 */
import {
  containsPureBrand,
  getPureBrandKeywords,
} from '../brand/brand-keyword-utils'
import {
  deriveCanonicalCreativeType,
  hasModelAnchorEvidence,
  containsAsinLikeToken,
  type CanonicalCreativeType,
} from '../../creatives/server'
import {
  getKeywordSourceRankFromInput,
  inferKeywordRawSource,
  normalizeKeywordSourceSubtype,
  type KeywordSourceTier,
} from './creative-keyword-source-priority'
import { resolveCreativeKeywordMinimumOutputCount } from './creative-keyword-output-floor'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import {
  analyzeKeywordLanguageCompatibility,
  type KeywordLanguageCompatibility,
} from '../planner/keyword-validity'

import {
  CREATIVE_KEYWORD_MAX_WORDS,
  CREATIVE_KEYWORD_MAX_WORDS_BY_TYPE,
  MODEL_INTENT_BRANDED_SINGLE_CORE_SEARCH_VOLUME_FLOOR,
  type CreativeKeywordMatchType,
  type KeywordAuditMetadata,
  type KeywordDecisionTraceEntry,
  type CreativeKeywordLike,
  type SourceGovernanceBucket,
  type KeywordLanguageSignals,
  type RankedCandidate,
  type CandidateEvidenceProfile,
  type CandidateIntentScores,
  type CreativeBucket,
  D_INTENT_PATTERN,
  A_TRUST_PATTERN,
  B_SCENARIO_PATTERN,
  PLATFORM_PATTERN,
  COMMUNITY_PATTERN,
  INFO_QUERY_PATTERN,
  QUESTION_PREFIX_PATTERN,
  REVIEW_COMPARE_PATTERN,
  PRICE_TRACKER_PATTERN,
  NOISE_STACK_PATTERN,
  REPEATED_ACTION_PATTERN,
  LOCALE_NOISE_PATTERN,
  BRAND_SLOGAN_PATTERN,
  URL_FRAGMENT_PATTERN,
  COMPONENT_NOISE_PATTERN,
  MODEL_INTENT_GENERIC_SPILLOVER_PATTERN,
  AI_TEMPLATE_SENSITIVE_SOURCE_SUBTYPES,
  AI_TEMPLATE_SPILLOVER_TOKENS,
  AI_TEMPLATE_NOISE_ONLY_TOKENS,
  AI_TEMPLATE_PHRASE_PATTERNS,
  AI_TEMPLATE_SAFE_SPEC_PATTERN,
  PROMO_PATTERN,
  STORE_NAV_PATTERN,
  FEATURE_SCENARIO_PATTERN,
  TRANSACTIONAL_MODIFIER_PATTERN,
  TRANSACTIONAL_MODIFIER_TOKENS,
  NON_ANCHOR_TOKENS,
  DEMAND_FALLBACK_NOISE_TOKENS,
  MODEL_INTENT_SOFT_FAMILY_NOISE_TOKENS,
} from './creative-keyword-selection-types'
import { classifyCandidateSource, isAiSubtype } from './creative-keyword-source-quota'

function normalizeSourceRank(source: string | undefined, sourceType: string | undefined): number {
  return getKeywordSourceRankFromInput({ source, sourceType })
}

export function resolveCreativeKeywordMaxWords(
  creativeType: CanonicalCreativeType | null | undefined
): number {
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

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function normalizeCompactedBrandKeyword(
  keyword: string,
  brandName: string | undefined
): string {
  const rawKeyword = String(keyword || '').trim()
  if (!rawKeyword) return ''

  const normalizedKeyword = normalizeGoogleAdsKeyword(rawKeyword)
  if (!normalizedKeyword) return rawKeyword

  const normalizedBrand = normalizeGoogleAdsKeyword(brandName || '')
  if (!normalizedBrand) return rawKeyword

  const brandTokens = normalizedBrand.split(/\s+/).filter(Boolean)
  if (brandTokens.length < 2) return rawKeyword

  const compactBrand = brandTokens.join('')
  if (!compactBrand || compactBrand === normalizedBrand) return rawKeyword

  const compactBrandPattern = new RegExp(`\\b${escapeRegex(compactBrand)}\\b`, 'g')
  if (!compactBrandPattern.test(normalizedKeyword)) return rawKeyword
  compactBrandPattern.lastIndex = 0

  return normalizedKeyword.replace(compactBrandPattern, normalizedBrand).replace(/\s+/g, ' ').trim()
}

function isSearchVolumeUnavailableReason(reason: unknown): boolean {
  const normalized = String(reason || '')
    .trim()
    .toUpperCase()
  return normalized.startsWith('DEV_TOKEN_')
}

export function hasActiveSearchVolumeUnavailableFlag(
  item:
    | {
        searchVolume?: unknown
        volumeUnavailableReason?: unknown
      }
    | null
    | undefined
): boolean {
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

export function normalizeAuditString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function normalizeEvidence(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined

  const normalized = Array.from(
    new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))
  ).slice(0, 4)

  return normalized.length > 0 ? normalized : undefined
}

function normalizeConfidence(value: unknown): number | undefined {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(0, Math.min(1, Math.round(parsed * 100) / 100))
}

export function normalizeAuditTags(value: unknown): string[] | undefined {
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

export function buildKeywordLanguageSignals(
  analysis: KeywordLanguageCompatibility,
  targetLanguage?: string
): KeywordLanguageSignals | undefined {
  if (!targetLanguage) return undefined

  const allowedLanguageHints =
    analysis.allowedLanguageHints.length > 0 ? analysis.allowedLanguageHints : undefined
  const detectedLanguageHints =
    analysis.detectedLanguageHints.length > 0 ? analysis.detectedLanguageHints : undefined

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

export function isDerivedSourceTier(tier: KeywordSourceTier): boolean {
  return tier.startsWith('DERIVED_')
}

function normalizeDecisionTraceEvidence(
  entries: Array<string | undefined | false>
): string[] | undefined {
  return normalizeEvidence(entries.filter((entry): entry is string => Boolean(entry)))
}

export function buildKeywordDecisionTrace(params: {
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

export function inferSourceField(source: string | undefined): string | undefined {
  const normalized = String(source || '')
    .trim()
    .toUpperCase()
  if (!normalized) return undefined

  if (normalized === 'SEARCH_TERM' || normalized === 'SEARCH_TERM_HIGH_PERFORMING')
    return 'search_terms'
  if (
    normalized.startsWith('KEYWORD_PLANNER') ||
    normalized === 'PLANNER' ||
    normalized === 'GLOBAL_KEYWORD'
  ) {
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
    normalized === 'AI_GENERATED' ||
    normalized === 'AI_ENHANCED' ||
    normalized === 'KEYWORD_EXPANSION' ||
    normalized === 'SCORING_SUGGESTION' ||
    normalized === 'BRANDED_INDUSTRY_TERM'
  ) {
    return 'ai'
  }

  return undefined
}

export function hasDemandAnchor(keyword: string, brandName: string | undefined): boolean {
  return getDemandAnchorTokens(keyword, brandName).length > 0
}

export function getDemandAnchorTokens(keyword: string, brandName: string | undefined): string[] {
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

export function hasRepeatedDemandAnchorToken(
  keyword: string,
  brandName: string | undefined
): boolean {
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

function getModelIntentSoftFamilyCoreTokens(
  keyword: string,
  brandName: string | undefined
): string[] {
  return getMeaningfulDemandAnchorTokens(keyword, brandName).filter(
    (token) => !MODEL_INTENT_SOFT_FAMILY_NOISE_TOKENS.has(token)
  )
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
    TRANSACTIONAL_MODIFIER_TOKENS.has(firstToken) || TRANSACTIONAL_MODIFIER_TOKENS.has(lastToken)
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

  const demandTokens = getDemandAnchorTokens(normalized, params.brandName).filter(
    (token) => !TRANSACTIONAL_MODIFIER_TOKENS.has(token)
  )
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

export function compactDemandSemanticDuplicates(params: {
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

export function trimLowValueTransactionalTailCandidates(params: {
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
  const minimumDemandFloor =
    params.creativeType === 'product_intent'
      ? Math.min(
          params.minProductDemandCount,
          countProductIntentDemandCandidates(params.candidates, params.brandName)
        )
      : 0
  const canPreserveContract = (candidates: RankedCandidate[]): boolean => {
    if (candidates.length < minimumOutputFloor) return false
    if (
      (params.creativeType === 'brand_intent' || params.creativeType === 'product_intent') &&
      params.requiredPureBrandCount > 0 &&
      candidates.filter((candidate) => candidate.isPureBrand).length < params.requiredPureBrandCount
    ) {
      return false
    }
    if (
      params.creativeType === 'product_intent' &&
      minimumDemandFloor > 0 &&
      countProductIntentDemandCandidates(candidates, params.brandName) < minimumDemandFloor
    ) {
      return false
    }
    return true
  }

  const fullyPruned = params.candidates.filter(
    (candidate) =>
      !isLowValueTransactionalTailCandidate({
        candidate,
        creativeType: params.creativeType,
        brandName: params.brandName,
      })
  )
  if (fullyPruned.length < params.candidates.length && canPreserveContract(fullyPruned)) {
    return fullyPruned
  }

  const trimmed = [...params.candidates]
  for (let index = trimmed.length - 1; index >= 0; index -= 1) {
    if (trimmed.length <= minimumOutputFloor) break
    if (
      !isLowValueTransactionalTailCandidate({
        candidate: trimmed[index],
        creativeType: params.creativeType,
        brandName: params.brandName,
      })
    ) {
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
  const hasClaimLikePrefix = prefixTokens.some(
    (token) =>
      DEMAND_FALLBACK_NOISE_TOKENS.has(token) &&
      !packTokenSet.has(token) &&
      !storeTokenSet.has(token)
  )
  if (hasClaimLikePrefix) return true

  const hasPackHeavyPrefix =
    prefixTokens.length >= 3 &&
    prefixTokens.some((token) => packTokenSet.has(token) || /^\d+$/.test(token))

  return hasPackHeavyPrefix
}

export function isModelIntentRescueKeyword(
  keyword: string,
  brandName: string | undefined
): boolean {
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
    normalizedBrand && normalizedBrand !== 'unknown' ? getPureBrandKeywords(normalizedBrand) : []
  const isBranded =
    pureBrandKeywords.length > 0 ? containsPureBrand(normalized, pureBrandKeywords) : false

  return (
    isBranded &&
    meaningfulDemandTokens.length >= 1 &&
    normalized.split(/\s+/).filter(Boolean).length >= 3
  )
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

function isAiTemplateSensitiveCandidateSource(candidate: {
  source?: string
  sourceType?: string
  sourceSubtype?: string
}): boolean {
  const normalizedSubtype = getNormalizedCandidateSourceSubtype(candidate)
  if (normalizedSubtype) {
    if (normalizedSubtype.startsWith('AI_')) return true
    if (AI_TEMPLATE_SENSITIVE_SOURCE_SUBTYPES.has(normalizedSubtype)) return true
  }
  const normalizedSource = String(candidate.source || '')
    .trim()
    .toUpperCase()
  return (
    normalizedSource.startsWith('AI_') ||
    AI_TEMPLATE_SENSITIVE_SOURCE_SUBTYPES.has(normalizedSource)
  )
}

function hasAiTemplateLexicalNoise(params: {
  keyword: string
  brandName: string | undefined
  creativeType: CanonicalCreativeType | null
}): boolean {
  const normalized = normalizeGoogleAdsKeyword(params.keyword)
  if (!normalized) return false

  const nonBrandTokens = getNonBrandKeywordTokens(normalized, params.brandName)
  if (nonBrandTokens.length === 0) return false

  const meaningfulDemandTokens = getMeaningfulDemandAnchorTokens(normalized, params.brandName)
  const spilloverHits = new Set(
    nonBrandTokens.filter((token) => AI_TEMPLATE_SPILLOVER_TOKENS.has(token))
  )
  const nonTemplateDemandTokens = meaningfulDemandTokens.filter(
    (token) => !AI_TEMPLATE_SPILLOVER_TOKENS.has(token) && !AI_TEMPLATE_NOISE_ONLY_TOKENS.has(token)
  )
  const hasTemplatePhrase = AI_TEMPLATE_PHRASE_PATTERNS.some((pattern) => pattern.test(normalized))
  const hasSafeSpecSignal = AI_TEMPLATE_SAFE_SPEC_PATTERN.test(normalized)
  const hasStrongDemandTail = meaningfulDemandTokens.length >= 2

  if (hasSafeSpecSignal && hasStrongDemandTail) return false
  if (
    hasTemplatePhrase &&
    (meaningfulDemandTokens.length <= 1 || nonTemplateDemandTokens.length === 0)
  ) {
    return true
  }
  if (spilloverHits.size >= 2 && !hasStrongDemandTail) return true
  if (
    params.creativeType === 'product_intent' &&
    spilloverHits.size >= 1 &&
    meaningfulDemandTokens.length === 0
  ) {
    return true
  }

  return false
}

function hasDerivedTag(
  candidate: {
    derivedTags?: string[]
  },
  expectedTag: string
): boolean {
  const normalizedTag = String(expectedTag || '')
    .trim()
    .toUpperCase()
  if (!normalizedTag) return false
  return Boolean(
    candidate.derivedTags?.some(
      (tag) =>
        String(tag || '')
          .trim()
          .toUpperCase() === normalizedTag
    )
  )
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
  const normalized = String(sourceSubtype || '')
    .trim()
    .toUpperCase()
  return (
    normalized === 'BUILDER_NON_EMPTY_RESCUE' ||
    normalized === 'DERIVED_RESCUE' ||
    normalized === 'MODEL_FAMILY_GUARD' ||
    normalized === 'PRODUCT_RELAX_BRANDED' ||
    normalized === 'BRAND_SEED' ||
    normalized === 'CONTRACT_RESCUE' ||
    normalized === 'FINAL_INVARIANT'
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
  const normalizedSource = String(candidate.source || '')
    .trim()
    .toUpperCase()
  const normalizedSubtype = getNormalizedCandidateSourceSubtype(candidate)

  return (
    normalizedSource === 'MODEL_FAMILY_GUARD' ||
    normalizedSubtype === 'MODEL_FAMILY_GUARD' ||
    hasDerivedTag(candidate, 'MODEL_FAMILY_GUARD')
  )
}

function isTrustedModelIntentSoftFamilyCandidate(
  candidate: {
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
  },
  brandName: string | undefined
): boolean {
  const text = candidate.normalized || normalizeGoogleAdsKeyword(candidate.keyword) || ''
  if (!text) return false
  if (candidate.isPureBrand) return false
  if (containsAsinLikeToken(text)) return false
  if (hasModelIntentRescuePrefixNoise(text, brandName)) return false
  if (URL_FRAGMENT_PATTERN.test(text)) return false
  if (COMPONENT_NOISE_PATTERN.test(text)) return false
  if (hasModelAnchorEvidence({ keywords: [text] })) return false
  const meaningfulDemandAnchorTokens = getMeaningfulDemandAnchorTokens(text, brandName)
  const softFamilyCoreTokens = getModelIntentSoftFamilyCoreTokens(text, brandName)
  if (meaningfulDemandAnchorTokens.length === 0) return false
  if (softFamilyCoreTokens.length === 0) return false

  const sourceRank =
    typeof candidate.sourceRank === 'number'
      ? candidate.sourceRank
      : normalizeSourceRank(candidate.source, candidate.sourceSubtype || candidate.sourceType)
  const isBrand = Boolean(candidate.isBrand)
  const nonNumericDemandAnchorCount = softFamilyCoreTokens.length
  const wordCount = text.split(/\s+/).filter(Boolean).length
  const hasFriendlySpecToken =
    /\b\d+\s*(?:inch|in|oz|ml|l|pack|count|ct|pcs|piece|w|wh|mah|gb|tb)?\b/i.test(text)
  const hasGenericSpilloverSignal = MODEL_INTENT_GENERIC_SPILLOVER_PATTERN.test(text)
  const hasReliableSearchVolume = hasReliableSearchVolumeSignal({
    searchVolume: candidate.searchVolume,
    volumeUnavailableReason: candidate.volumeUnavailableReason,
  })
  const hasTrustedSource =
    sourceRank >= 8 ||
    (sourceRank >= 7 && nonNumericDemandAnchorCount >= 2 && !hasGenericSpilloverSignal)

  const isModelFamilyGuard = isModelFamilyGuardCandidate(candidate)
  const allowHighVolumeBrandedSingleCoreDemand = Boolean(
    isBrand &&
    !isModelFamilyGuard &&
    candidate.isPreferredBucket &&
    !isAiGeneratedCandidate(candidate) &&
    !hasGenericSpilloverSignal &&
    meaningfulDemandAnchorTokens.length === 1 &&
    softFamilyCoreTokens.length === 1 &&
    hasReliableSearchVolume &&
    Number(candidate.searchVolume || 0) >= MODEL_INTENT_BRANDED_SINGLE_CORE_SEARCH_VOLUME_FLOOR
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
    meaningfulDemandAnchorTokens.length === 1 &&
    !hasTrustedSource &&
    !allowHighVolumeBrandedSingleCoreDemand
  ) {
    return false
  }

  // Unbranded soft-family phrases must come from a stronger source than canonical pool projection.
  if (!isBrand && !hasTrustedSource) return false

  return Boolean(isBrand || candidate.isPreferredBucket || hasTrustedSource)
}

function resolveModelIntentSoftFamilyIntentBoost(
  candidate: {
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
  },
  brandName: string | undefined
): number {
  if (!isTrustedModelIntentSoftFamilyCandidate(candidate, brandName)) return 0
  if (isModelFamilyGuardCandidate(candidate)) return 5
  if (candidate.isBrand) return 4
  return 3
}

export function isCompactTrustedModelIntentSoftFamilyCandidate(
  candidate: {
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
  },
  brandName: string | undefined
): boolean {
  const normalized = candidate.normalized || normalizeGoogleAdsKeyword(candidate.keyword) || ''
  if (!normalized) return false
  if (!isTrustedModelIntentSoftFamilyCandidate(candidate, brandName)) return false
  if (MODEL_INTENT_GENERIC_SPILLOVER_PATTERN.test(normalized)) return false
  if (hasRepeatedDemandAnchorToken(normalized, brandName)) return false

  const demandTokenCount = getDemandAnchorTokens(normalized, brandName).filter(
    (token) => !/^\d+$/.test(token)
  ).length
  const wordCount = candidate.wordCount || normalized.split(/\s+/).filter(Boolean).length

  return demandTokenCount > 0 && demandTokenCount <= 4 && wordCount <= 6
}

export function isModelIntentRescueBackstopCandidate(
  candidate: {
    keyword: string
    normalized?: string
    isBrand?: boolean
    isPureBrand: boolean
    source?: string
    sourceType?: string
    sourceSubtype?: string
  },
  brandName: string | undefined
): boolean {
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

export function isLowQualityCandidate(
  candidate: {
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
  },
  creativeType: CanonicalCreativeType | null,
  brandName: string | undefined,
  options?: {
    targetLanguage?: string
    allowModelIntentPreferredFallback?: boolean
    allowModelIntentSoftFamilyFallback?: boolean
    disableVolumeReliance?: boolean
  }
): boolean {
  const text = candidate.normalized
  if (!text) return true
  if (containsAsinLikeToken(text)) return true
  const normalizedBrand = normalizeGoogleAdsKeyword(brandName || '')
  const pureBrandKeywords =
    normalizedBrand && normalizedBrand !== 'unknown' ? getPureBrandKeywords(normalizedBrand) : []
  const languageAnalysis = analyzeKeywordLanguageCompatibility({
    keyword: candidate.keyword,
    targetLanguage: options?.targetLanguage,
    pureBrandKeywords,
  })
  if (languageAnalysis.hardReject) return true
  const hasModelAnchor = hasModelAnchorEvidence({ keywords: [text] })
  const demandAnchorTokens = getDemandAnchorTokens(text, brandName)
  const modelIntentSoftFamilyCoreTokens =
    creativeType === 'model_intent' ? getModelIntentSoftFamilyCoreTokens(text, brandName) : []
  const hasDemand = demandAnchorTokens.length > 0
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
  const rescueBackstopCandidate =
    creativeType === 'model_intent'
      ? isModelIntentRescueBackstopCandidate(candidate, brandName)
      : false
  const allowSoftFamilyCandidate =
    trustedSoftFamilyCandidate &&
    (candidate.isBrand ||
      isModelFamilyGuardCandidate(candidate) ||
      Boolean(options?.allowModelIntentSoftFamilyFallback))
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
  if (
    !candidate.isPureBrand &&
    !hasModelAnchor &&
    isAiTemplateSensitiveCandidateSource(candidate) &&
    hasAiTemplateLexicalNoise({
      keyword: text,
      brandName,
      creativeType,
    })
  ) {
    return true
  }
  if (
    isLowSignalEvaluativeBrandQuery({
      keyword: text,
      creativeType,
      isBrand: candidate.isBrand,
      isPureBrand: candidate.isPureBrand,
      hasModelAnchor,
      brandName,
    })
  ) {
    return true
  }
  if (!candidate.isPureBrand && hasRepeatedDemandAnchorToken(text, brandName)) return true
  if (
    !candidate.isPureBrand &&
    candidate.isBrand &&
    !hasModelAnchor &&
    isBrandTrailingDemandPhrase(text, brandName)
  ) {
    return true
  }
  if (STORE_NAV_PATTERN.test(text) && !hasDemand) return true
  if (PROMO_PATTERN.test(text) && !hasDemand && !hasModelAnchor) return true
  if (
    creativeType === 'brand_intent' &&
    candidate.isBrand &&
    !candidate.isPureBrand &&
    !hasDemand &&
    !hasModelAnchor
  )
    return true
  if (
    creativeType === 'model_intent' &&
    hasModelAnchor &&
    hasTransactionalModifier &&
    isAiGenerated
  )
    return true
  if (creativeType === 'model_intent' && isModelIntentDimensionOrParamOnlyText(text, brandName))
    return true
  if (
    creativeType === 'product_intent' &&
    candidate.isBrand &&
    !candidate.isPureBrand &&
    !hasModelAnchor &&
    !trustedSoftFamilyCandidate &&
    (options?.disableVolumeReliance ? false : !hasReliableSearchVolume) &&
    demandAnchorTokens.filter((token) => !/^\d+$/.test(token)).length <= 1
  ) {
    return true
  }
  if (
    creativeType === 'model_intent' &&
    !hasModelAnchor &&
    !(
      (options?.allowModelIntentPreferredFallback &&
        candidate.isPreferredBucket &&
        hasSpecificModelIntentSoftFamilyCore &&
        !candidate.isPureBrand) ||
      rescueBackstopCandidate ||
      (allowSoftFamilyCandidate && hasModelIntentSoftFamilyCore)
    )
  ) {
    return true
  }
  if (creativeType === 'model_intent' && candidate.isPureBrand) return true
  return false
}

export function inferAnchorType(candidate: {
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

export function inferAnchorKinds(candidate: {
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

export function inferEvidenceStrength(
  candidate: RankedCandidate,
  creativeType: CanonicalCreativeType | null,
  _brandName: string | undefined
): 'high' | 'medium' | 'low' {
  let score = 0
  const profile = candidate.evidenceProfile
  const hasSoftFamilySignal =
    creativeType === 'model_intent' && (profile.isModelFamilyGuard || profile.trustedSoftFamily)
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

export function inferFamilyMatchType(
  candidate: RankedCandidate,
  creativeType: CanonicalCreativeType | null,
  _brandName: string | undefined
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

export function resolveModelIntentFinalMatchType(
  candidate: RankedCandidate
): CreativeKeywordMatchType {
  const profile = candidate.evidenceProfile
  if (profile.hasModelAnchor) return 'EXACT'

  const allowSoftFamilyPhrase =
    profile.compactTrustedSoftFamily ||
    (profile.trustedSoftFamily &&
      profile.sourceTrustScore >= 5.5 &&
      profile.selectedIntentScore >= 1.2 &&
      profile.intentMargin >= 0 &&
      !profile.isTransactional)
  if (allowSoftFamilyPhrase) return 'PHRASE'
  if (profile.hasDemand && candidate.isBrand && isDerivedRescueCandidate(candidate)) return 'PHRASE'

  return 'EXACT'
}

export function resolveKeywordFallbackReason(candidate: RankedCandidate): string | undefined {
  const sourceKey = String(
    candidate.sourceSubtype || candidate.sourceType || candidate.source || ''
  )
    .trim()
    .toUpperCase()

  if (!sourceKey) return undefined
  if (sourceKey === 'MODEL_FAMILY_GUARD') return 'model_family_guard'
  if (sourceKey === 'PRODUCT_RELAX_BRANDED') return 'product_relax_branded'
  if (sourceKey === 'BRAND_SEED') return 'brand_seed'
  if (sourceKey === 'CONTRACT_RESCUE' || sourceKey === 'FINAL_INVARIANT') return 'final_invariant'
  return undefined
}

export function resolveKeywordRescueStage(
  candidate: RankedCandidate
): KeywordAuditMetadata['rescueStage'] {
  const fallbackReason = resolveKeywordFallbackReason(candidate)
  if (!fallbackReason) return undefined
  if (fallbackReason === 'final_invariant') return 'final_invariant'
  return 'post_selection'
}

export function buildKeywordContractRoleMap(params: {
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
      selected.filter(
        (candidate) =>
          hasModelAnchorEvidence({ keywords: [candidate.keyword] }) ||
          isModelFamilyGuardCandidate(candidate) ||
          isTrustedModelIntentSoftFamilyCandidate(candidate, params.brandName) ||
          isModelIntentRescueBackstopCandidate(candidate, params.brandName)
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

export function buildAuditEvidence(
  candidate: RankedCandidate,
  brandName: string | undefined
): string[] | undefined {
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

export function inferKeywordConfidence(
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

  if (
    creativeType === 'model_intent' &&
    hasModelAnchorEvidence({ keywords: [candidate.keyword] })
  ) {
    confidence += 0.1
  }

  return Math.max(0.35, Math.min(0.99, Math.round(confidence * 100) / 100))
}

export function inferQualityReason(
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
  const creativeType =
    params.creativeType ||
    deriveCanonicalCreativeType({ creativeType: null, keywordBucket: bucket, keywords: [keyword] })
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
      score += resolveModelIntentSoftFamilyIntentBoost(
        {
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
        },
        brandName
      )
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

export function clampNumber(value: number, min: number, max: number): number {
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
  const normalized =
    params.candidate.normalized || normalizeGoogleAdsKeyword(params.candidate.keyword) || ''
  const normalizedBrand = normalizeGoogleAdsKeyword(params.brandName || '')
  const pureBrandKeywords =
    normalizedBrand && normalizedBrand !== 'unknown' ? getPureBrandKeywords(normalizedBrand) : []
  const demandAnchorTokens = getDemandAnchorTokens(normalized, params.brandName)
  const nonNumericDemandTokens = demandAnchorTokens.filter((token) => !/^\d+$/.test(token))
  const hasModelAnchor = hasModelAnchorEvidence({ keywords: [normalized] })
  const hasDemand = demandAnchorTokens.length > 0
  const hasSpecificDemandTail = nonNumericDemandTokens.length >= 2
  const isTransactional = TRANSACTIONAL_MODIFIER_PATTERN.test(normalized)
  const isAiGenerated = isAiGeneratedCandidate(params.candidate)
  const isModelFamilyGuard = isModelFamilyGuardCandidate(params.candidate)
  const trustedSoftFamily = isTrustedModelIntentSoftFamilyCandidate(
    params.candidate,
    params.brandName
  )
  const compactTrustedSoftFamily = isCompactTrustedModelIntentSoftFamilyCandidate(
    {
      ...params.candidate,
      wordCount: params.candidate.wordCount,
    },
    params.brandName
  )
  const languageAnalysis = analyzeKeywordLanguageCompatibility({
    keyword: params.candidate.keyword,
    targetLanguage: params.targetLanguage,
    pureBrandKeywords,
  })
  const selectedIntentScore =
    params.selectedIntentScoreOverride ??
    resolveSelectedIntentScore(params.intentScores, params.creativeType)
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
    if (isTransactional && !hasModelAnchor && !hasSpecificDemandTail)
      preferredBucketSoftPrior -= 0.35
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

export function buildRankedCandidate(params: {
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
    selectedIntentScore += resolveModelIntentSoftFamilyIntentBoost(
      {
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
      },
      params.brandName
    )
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

  const intentRank = Number(
    (
      evidenceProfile.selectedIntentScore +
      evidenceProfile.preferredBucketSoftPrior * 0.35 +
      evidenceProfile.sourceTrustScore * 0.2 +
      Math.max(0, evidenceProfile.intentMargin) * 0.25
    ).toFixed(4)
  )

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

export function isStrongPreferredBucketCandidate(candidate: RankedCandidate): boolean {
  if (!candidate.isPreferredBucket) return false
  const profile = candidate.evidenceProfile
  if (profile.preferredBucketSoftPrior >= 1.15) return true
  if (profile.hasModelAnchor && profile.selectedIntentScore >= 1) return true
  if (profile.compactTrustedSoftFamily) return true
  if (profile.hasSpecificDemandTail && profile.sourceTrustScore >= 6) return true
  return false
}

export function compareRankedCandidates(a: RankedCandidate, b: RankedCandidate): number {
  const aProfile = a.evidenceProfile
  const bProfile = b.evidenceProfile
  const aModelFamilyGuard = aProfile.isModelFamilyGuard
  const bModelFamilyGuard = bProfile.isModelFamilyGuard
  const aHasModelAnchor = aProfile.hasModelAnchor
  const bHasModelAnchor = bProfile.hasModelAnchor

  if (
    !aHasModelAnchor &&
    !bHasModelAnchor &&
    aModelFamilyGuard !== bModelFamilyGuard &&
    Math.abs(a.intentRank - b.intentRank) <= 1
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
  if (aProfile.intentMargin !== bProfile.intentMargin)
    return bProfile.intentMargin - aProfile.intentMargin
  if (aProfile.sourceTrustScore !== bProfile.sourceTrustScore) {
    return bProfile.sourceTrustScore - aProfile.sourceTrustScore
  }
  if (aModelFamilyGuard !== bModelFamilyGuard)
    return Number(bModelFamilyGuard) - Number(aModelFamilyGuard)
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

export function preferNonAiTwinCandidate(
  candidate: RankedCandidate,
  existing: RankedCandidate,
  creativeType: CanonicalCreativeType | null
): RankedCandidate {
  if (creativeType !== 'model_intent') {
    return compareRankedCandidates(candidate, existing) < 0 ? candidate : existing
  }

  const candidateClass = classifyCandidateSource(candidate)
  const existingClass = classifyCandidateSource(existing)

  if (candidateClass.ai !== existingClass.ai) {
    return candidateClass.ai ? existing : candidate
  }

  return compareRankedCandidates(candidate, existing) < 0 ? candidate : existing
}

const MODEL_INTENT_PARAM_TOKENS = new Set([
  'battery',
  'batteries',
  'bundle',
  'bundles',
  'color',
  'colors',
  'edition',
  'gen',
  'generation',
  'height',
  'inch',
  'inches',
  'length',
  'pack',
  'packs',
  'piece',
  'pieces',
  'set',
  'sets',
  'size',
  'sizes',
  'version',
  'weight',
  'width',
  'wh',
  'mah',
  'oz',
  'lb',
  'lbs',
  'ml',
  'l',
  'cm',
  'mm',
  'm',
  'ft',
  'qt',
  'pcs',
  'pc',
  'full',
  'queen',
  'king',
  'twin',
  'california',
])

function isDimensionOrParamLikeToken(token: string): boolean {
  const normalized = String(token || '')
    .trim()
    .toLowerCase()
  if (!normalized) return true
  if (/^\d+$/.test(normalized)) return true
  if (/^\d+(?:[a-z]{1,4})$/i.test(normalized)) return true
  if (/^[a-z]$/i.test(normalized)) return true
  if (/^\d+(?:\.\d+)?$/.test(normalized)) return true
  if (MODEL_INTENT_PARAM_TOKENS.has(normalized)) return true
  return false
}

export function isModelIntentDimensionOrParamOnlyText(
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

export function isModelIntentDimensionOrParamOnlyCandidate(
  candidate: RankedCandidate,
  brandName: string | undefined
): boolean {
  if (candidate.evidenceProfile.hasModelAnchor) return false
  if (candidate.evidenceProfile.compactTrustedSoftFamily) return false
  if (candidate.evidenceProfile.trustedSoftFamily) return false
  if (candidate.evidenceProfile.isModelFamilyGuard) return false
  return isModelIntentDimensionOrParamOnlyText(candidate.keyword, brandName)
}

export function isDirectProductAnchorCandidate(
  candidate: RankedCandidate,
  brandName: string | undefined
): boolean {
  if (candidate.isPureBrand) return false

  const profile = candidate.evidenceProfile
  if (profile.hasModelAnchor) return true
  if (candidate.isBrand && profile.hasDemand) return true
  if (profile.hasSpecificDemandTail) return true

  return (
    !candidate.isBrand &&
    profile.hasDemand &&
    profile.sourceTrustScore >= 6.4 &&
    profile.selectedIntentScore >= 1.5 &&
    !profile.languageSoftDemote &&
    hasDemandAnchor(candidate.keyword, brandName)
  )
}

export function isAdjacentGenericProductCandidate(
  candidate: RankedCandidate,
  brandName: string | undefined
): boolean {
  if (candidate.isPureBrand) return false

  const profile = candidate.evidenceProfile
  if (!profile.hasDemand) return false
  if (isDirectProductAnchorCandidate(candidate, brandName)) return false

  return !candidate.isBrand || (profile.selectedIntentScore < 2 && profile.sourceTrustScore < 6.8)
}

export function isProductIntentDemandCandidate(
  candidate: RankedCandidate,
  brandName: string | undefined
): boolean {
  if (candidate.isPureBrand) return false
  if (isDirectProductAnchorCandidate(candidate, brandName)) return true

  const profile = candidate.evidenceProfile
  if (!profile.hasDemand) return false
  if (candidate.isBrand) return true

  return (
    profile.sourceTrustScore >= 5.8 &&
    profile.selectedIntentScore >= 1.25 &&
    !profile.languageSoftDemote &&
    hasDemandAnchor(candidate.keyword, brandName)
  )
}

export function countProductIntentDemandCandidates(
  candidates: RankedCandidate[],
  brandName: string | undefined
): number {
  return candidates.filter((candidate) => isProductIntentDemandCandidate(candidate, brandName))
    .length
}

export function findProductIntentReplacementIndex(input: {
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

    const existingReplacement = replacementIndex >= 0 ? input.candidates[replacementIndex] : null
    const candidateIsWorse =
      !existingReplacement || compareRankedCandidates(candidate, existingReplacement) > 0

    if (score > replacementScore || (score === replacementScore && candidateIsWorse)) {
      replacementIndex = index
      replacementScore = score
    }
  }

  return replacementIndex
}

export function isModelIntentQualifiedCandidate(
  candidate: RankedCandidate,
  brandName: string | undefined
): boolean {
  if (candidate.isPureBrand) return false

  const profile = candidate.evidenceProfile
  if (profile.unauthorizedContentRatio > 0) return false
  if (isModelIntentDimensionOrParamOnlyCandidate(candidate, brandName)) return false
  if (profile.hasModelAnchor) return true
  if (
    profile.isModelFamilyGuard &&
    profile.hasDemand &&
    (profile.demandAnchorCount >= 2 ||
      (candidate.isBrand && profile.demandAnchorCount >= 1 && profile.sourceTrustScore >= 6.2))
  ) {
    return true
  }
  if (profile.compactTrustedSoftFamily) return true
  if (
    profile.trustedSoftFamily &&
    profile.hasDemand &&
    candidate.isBrand &&
    profile.sourceTrustScore >= 5.6 &&
    profile.selectedIntentScore >= 1
  ) {
    return true
  }
  if (isModelIntentRescueBackstopCandidate(candidate, brandName)) return true

  return false
}

export function isModelIntentPreferredFallbackCandidate(
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

export function countModelIntentQualifiedCandidates(
  candidates: RankedCandidate[],
  brandName: string | undefined
): number {
  return candidates.filter((candidate) => isModelIntentQualifiedCandidate(candidate, brandName))
    .length
}

export function findModelIntentReplacementIndex(input: {
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

    const existingReplacement = replacementIndex >= 0 ? input.candidates[replacementIndex] : null
    const candidateIsWorse =
      !existingReplacement || compareRankedCandidates(candidate, existingReplacement) > 0

    if (score > replacementScore || (score === replacementScore && candidateIsWorse)) {
      replacementIndex = index
      replacementScore = score
    }
  }

  return replacementIndex
}
