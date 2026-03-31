import {
  isCreativeKeywordAiSourceSubtypeEnabled,
  isCreativeKeywordSourcePriorityUnifiedEnabled,
} from './creative-keyword-feature-flags'

export type KeywordSourceTier =
  | 'T0'
  | 'T1'
  | 'T2'
  | 'T3A'
  | 'T3B'
  | 'T4A'
  | 'T4B'
  | 'DERIVED_TRUSTED'
  | 'DERIVED_RESCUE'
  | 'DERIVED_SYNTHETIC'
  | 'UNKNOWN'

interface SourcePriorityRule {
  score: number
  tier: KeywordSourceTier
}

const EXACT_SOURCE_PRIORITY: Record<string, SourcePriorityRule> = {
  SEARCH_TERM_HIGH_PERFORMING: { score: 100, tier: 'T0' },
  SEARCH_TERM: { score: 95, tier: 'T0' },

  KEYWORD_PLANNER_BRAND: { score: 90, tier: 'T1' },
  PLANNER: { score: 90, tier: 'T1' },

  HOT_PRODUCT_AGGREGATE: { score: 80, tier: 'T2' },
  PARAM_EXTRACT: { score: 80, tier: 'T2' },
  TITLE_EXTRACT: { score: 75, tier: 'T2' },
  ABOUT_EXTRACT: { score: 75, tier: 'T2' },
  PAGE_EXTRACT: { score: 75, tier: 'T2' },

  GLOBAL_KEYWORD: { score: 65, tier: 'T3A' },
  GLOBAL_KEYWORDS: { score: 65, tier: 'T3A' },
  GLOBAL_CORE: { score: 65, tier: 'T3A' },
  GLOBAL_CORE_BRANDED: { score: 65, tier: 'T3A' },
  GLOBAL_CATEGORY_BRANDED: { score: 65, tier: 'T3A' },
  SCORING_SUGGESTION: { score: 60, tier: 'T3B' },
  BRANDED_INDUSTRY_TERM: { score: 58, tier: 'T3B' },
  GAP_INDUSTRY_BRANDED: { score: 56, tier: 'T3B' },

  AI_ENHANCED: { score: 50, tier: 'T4A' },
  AI_ENHANCED_PERSISTED: { score: 50, tier: 'T4A' },

  AI_TITLE_ABOUT_SUPPLEMENT: { score: 40, tier: 'T4B' },
  AI_LLM_RAW: { score: 40, tier: 'T4B' },
  AI_FALLBACK_PLACEHOLDER: { score: 40, tier: 'T4B' },
  AI_GENERATED: { score: 40, tier: 'T4B' },
  KEYWORD_EXPANSION: { score: 40, tier: 'T4B' },

  KEYWORD_POOL: { score: 57, tier: 'DERIVED_TRUSTED' },
  CANONICAL_BUCKET_VIEW: { score: 57, tier: 'DERIVED_TRUSTED' },
  MODEL_FAMILY_GUARD: { score: 53, tier: 'DERIVED_RESCUE' },
  PRODUCT_RELAX_BRANDED: { score: 44, tier: 'DERIVED_RESCUE' },
  BUILDER_NON_EMPTY_RESCUE: { score: 26, tier: 'DERIVED_RESCUE' },
  DERIVED_RESCUE: { score: 24, tier: 'DERIVED_RESCUE' },
  BRAND_SEED: { score: 28, tier: 'DERIVED_RESCUE' },
  CONTRACT_RESCUE: { score: 24, tier: 'DERIVED_RESCUE' },
  FINAL_INVARIANT: { score: 20, tier: 'DERIVED_RESCUE' },
  LEGACY_BUCKET: { score: 38, tier: 'DERIVED_SYNTHETIC' },
  MERGED: { score: 34, tier: 'DERIVED_SYNTHETIC' },
}

const PREFIX_SOURCE_PRIORITY: Array<{ prefix: string; rule: SourcePriorityRule }> = [
  { prefix: 'KEYWORD_PLANNER', rule: { score: 90, tier: 'T1' } },
  { prefix: 'GLOBAL_', rule: { score: 65, tier: 'T3A' } },
]

const LEGACY_EXACT_SOURCE_PRIORITY: Record<string, SourcePriorityRule> = {
  SCORING_SUGGESTION: { score: 110, tier: 'T3B' },
  KEYWORD_POOL: { score: 100, tier: 'DERIVED_TRUSTED' },
  SEARCH_TERM_HIGH_PERFORMING: { score: 80, tier: 'T0' },
  SEARCH_TERM: { score: 75, tier: 'T0' },
  KEYWORD_PLANNER: { score: 70, tier: 'T1' },
  KEYWORD_PLANNER_BRAND: { score: 70, tier: 'T1' },
  GLOBAL_KEYWORD: { score: 65, tier: 'T3A' },
  GLOBAL_KEYWORDS: { score: 65, tier: 'T3A' },
  AI_ENHANCED: { score: 50, tier: 'T4A' },
  AI_ENHANCED_PERSISTED: { score: 50, tier: 'T4A' },
  AI_GENERATED: { score: 40, tier: 'T4B' },
  AI_LLM_RAW: { score: 40, tier: 'T4B' },
  AI_FALLBACK_PLACEHOLDER: { score: 40, tier: 'T4B' },
  KEYWORD_EXPANSION: { score: 40, tier: 'T4B' },
}

function normalizeSource(source: string | undefined): string {
  return String(source || '').trim().toUpperCase()
}

function hasKnownPriority(normalizedSource: string): boolean {
  if (!normalizedSource) return false
  if (Object.prototype.hasOwnProperty.call(EXACT_SOURCE_PRIORITY, normalizedSource)) return true
  return PREFIX_SOURCE_PRIORITY.some(({ prefix }) => normalizedSource.startsWith(prefix))
}

function shouldPreferRawCanonicalSource(input: {
  source?: string
  sourceType?: string
}): boolean {
  const sourceType = normalizeSource(input.sourceType)
  const source = normalizeSource(input.source)

  if (
    sourceType !== 'KEYWORD_POOL'
    && sourceType !== 'CANONICAL_BUCKET_VIEW'
  ) {
    return false
  }

  if (!source || source === 'UNKNOWN') return false
  if (source === 'KEYWORD_POOL' || source === 'CANONICAL_BUCKET_VIEW') return false
  return hasKnownPriority(source)
}

export function resolveKeywordPrioritySource(input: {
  source?: string
  sourceType?: string
}): string | undefined {
  if (!isCreativeKeywordSourcePriorityUnifiedEnabled()) {
    const source = normalizeSource(input.source)
    if (source && source !== 'UNKNOWN') return source
    const sourceType = normalizeSource(input.sourceType)
    return sourceType || undefined
  }

  const sourceType = normalizeSource(input.sourceType)
  const source = normalizeSource(input.source)
  if (shouldPreferRawCanonicalSource({ source, sourceType })) return source
  if (sourceType && sourceType !== 'UNKNOWN' && hasKnownPriority(sourceType)) return sourceType
  return source || undefined
}

export function getKeywordSourcePriority(source: string | undefined): SourcePriorityRule {
  const normalized = normalizeSource(source)
  if (!normalized) return { score: 0, tier: 'UNKNOWN' }

  if (!isCreativeKeywordSourcePriorityUnifiedEnabled()) {
    const legacy = LEGACY_EXACT_SOURCE_PRIORITY[normalized]
    if (legacy) return legacy
    for (const { prefix, rule } of PREFIX_SOURCE_PRIORITY) {
      if (normalized.startsWith(prefix)) return rule
    }
    return { score: 20, tier: 'UNKNOWN' }
  }

  const exact = EXACT_SOURCE_PRIORITY[normalized]
  if (exact) return exact

  for (const { prefix, rule } of PREFIX_SOURCE_PRIORITY) {
    if (normalized.startsWith(prefix)) return rule
  }

  return { score: 20, tier: 'UNKNOWN' }
}

export function getKeywordSourcePriorityScore(source: string | undefined): number {
  return getKeywordSourcePriority(source).score
}

export function getKeywordSourcePriorityScoreFromInput(input: {
  source?: string
  sourceType?: string
}): number {
  return getKeywordSourcePriorityScore(resolveKeywordPrioritySource(input))
}

export function getKeywordSourceRank(source: string | undefined): number {
  const score = getKeywordSourcePriorityScore(source)
  return Math.max(0, Math.min(10, Math.round(score / 10)))
}

export function getKeywordSourceRankFromInput(input: {
  source?: string
  sourceType?: string
}): number {
  const score = getKeywordSourcePriorityScoreFromInput(input)
  return Math.max(0, Math.min(10, Math.round(score / 10)))
}

export function normalizeKeywordSourceSubtype(input: {
  source?: string
  sourceType?: string
}): string | undefined {
  if (!isCreativeKeywordAiSourceSubtypeEnabled()) {
    const legacySource = normalizeSource(input.source)
    return legacySource || undefined
  }

  const resolved = resolveKeywordPrioritySource(input)
  const normalized = normalizeSource(resolved)
  return normalized || undefined
}

export function inferKeywordRawSource(input: {
  source?: string
  sourceType?: string
}): string | undefined {
  const subtype = normalizeKeywordSourceSubtype(input)
  if (!subtype) return undefined

  if (subtype.startsWith('SEARCH_TERM')) return 'SEARCH_TERM'
  if (subtype.startsWith('KEYWORD_PLANNER') || subtype === 'PLANNER') return 'KEYWORD_PLANNER'

  if (
    subtype === 'HOT_PRODUCT_AGGREGATE'
    || subtype === 'PARAM_EXTRACT'
    || subtype === 'TITLE_EXTRACT'
    || subtype === 'ABOUT_EXTRACT'
    || subtype === 'PAGE_EXTRACT'
  ) {
    return 'PAGE_EXTRACT'
  }

  if (
    subtype.startsWith('GLOBAL_')
    || subtype === 'SCORING_SUGGESTION'
    || subtype === 'BRANDED_INDUSTRY_TERM'
    || subtype === 'GAP_INDUSTRY_BRANDED'
  ) {
    return 'GAP_ANALYSIS'
  }

  if (subtype.startsWith('AI_') || subtype === 'KEYWORD_EXPANSION') return 'AI'

  if (
    subtype === 'KEYWORD_POOL'
    || subtype === 'CANONICAL_BUCKET_VIEW'
  ) {
    return 'DERIVED_TRUSTED'
  }

  if (
    subtype === 'BUILDER_NON_EMPTY_RESCUE'
    || subtype === 'DERIVED_RESCUE'
    || subtype === 'MODEL_FAMILY_GUARD'
    || subtype === 'PRODUCT_RELAX_BRANDED'
    || subtype === 'BRAND_SEED'
    || subtype === 'CONTRACT_RESCUE'
    || subtype === 'FINAL_INVARIANT'
  ) {
    return 'DERIVED_RESCUE'
  }

  if (
    subtype === 'LEGACY_BUCKET'
    || subtype === 'MERGED'
  ) {
    return 'DERIVED_SYNTHETIC'
  }

  return hasKnownPriority(subtype) ? subtype : 'UNKNOWN'
}

export function inferKeywordDerivedTags(input: {
  source?: string
  sourceType?: string
}): string[] | undefined {
  const tags = new Set<string>()
  const subtype = normalizeKeywordSourceSubtype(input)
  const source = normalizeSource(input.source)
  const sourceType = normalizeSource(input.sourceType)

  const maybeAddDerivedTag = (value: string | undefined) => {
    if (!value) return
    if (
      value === 'KEYWORD_POOL'
      || value === 'CANONICAL_BUCKET_VIEW'
      || value === 'LEGACY_BUCKET'
      || value === 'MERGED'
      || value === 'BRAND_SEED'
      || value === 'BUILDER_NON_EMPTY_RESCUE'
      || value === 'DERIVED_RESCUE'
      || value === 'MODEL_FAMILY_GUARD'
      || value === 'PRODUCT_RELAX_BRANDED'
      || value === 'CONTRACT_RESCUE'
      || value === 'FINAL_INVARIANT'
      || value === 'GAP_INDUSTRY_BRANDED'
    ) {
      tags.add(value)
    }
  }

  maybeAddDerivedTag(subtype)
  maybeAddDerivedTag(source)
  maybeAddDerivedTag(sourceType)

  if (subtype === 'KEYWORD_POOL') tags.add('CANONICAL_BUCKET_VIEW')

  return tags.size > 0 ? Array.from(tags) : undefined
}
