/**
 * Split creative-keyword-set-builder.ts and creative-keyword-context-filter.ts
 * into smaller modules, then wire imports/exports.
 *
 * Run from repo root:
 *   node scripts/split-creative-keyword-giants.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const dir = path.join(root, 'src/lib/keywords/creative-keyword')

function readLines(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
}

function slice(lines, start, end) {
  return lines.slice(start - 1, end).join('\n')
}

function writeModule(filePath, title, body) {
  fs.writeFileSync(
    filePath,
    `/**
 * ${title}
 */\n\n${body}\n`
  )
}

function prependImports(filePath, importBlock) {
  let body = fs.readFileSync(filePath, 'utf8')
  const headerEnd = body.indexOf('*/') + 2
  const header = body.slice(0, headerEnd)
  const rest = body.slice(headerEnd).replace(/^\s+/, '')
  fs.writeFileSync(filePath, `${header}\n${importBlock}\n\n${rest}`)
}

function exportFunctions(filePath, names) {
  let body = fs.readFileSync(filePath, 'utf8')
  for (const name of names) {
    body = body.replace(new RegExp(`^function ${name}`, 'm'), `export function ${name}`)
  }
  fs.writeFileSync(filePath, body)
}

// ─── set-builder ─────────────────────────────────────────────────────────────

function splitSetBuilder() {
  const sourcePath = path.join(dir, 'creative-keyword-set-builder.ts')
  const lines = readLines(sourcePath)
  const headerImports = lines.slice(0, 33).join('\n')

  writeModule(
    path.join(dir, 'creative-keyword-set-builder-types.ts'),
    '创意关键词集合构建：类型、常量与审计结构',
    slice(lines, 34, 372)
  )

  writeModule(
    path.join(dir, 'creative-keyword-set-builder-candidates.ts'),
    '创意关键词集合构建：候选归一化、合并与过滤衔接',
    slice(lines, 374, 1421)
  )

  writeModule(
    path.join(dir, 'creative-keyword-set-builder-audit.ts'),
    '创意关键词集合构建：契约评估与来源审计',
    slice(lines, 1422, 1690)
  )

  writeModule(
    path.join(dir, 'creative-keyword-set-builder-rescue.ts'),
    '创意关键词集合构建：非空 rescue 短语与候选',
    slice(lines, 1691, 2367)
  )

  fs.writeFileSync(
    sourcePath,
    `/**
 * 创意关键词集合构建：主流程
 */
${headerImports}
export {
  type BuildCreativeKeywordSetInput,
  type BuildCreativeKeywordSetOutput,
  type CreativeKeywordCandidate,
  type CreativeKeywordSourceAudit,
  type CreativeKeywordAudit,
} from './creative-keyword-set-builder-types'

${slice(lines, 2369, lines.length)}
`
  )
}

function wireSetBuilder() {
  const typesImports = `import type { KeywordSupplementationReport } from '../../creatives/generator/types'
import type { CanonicalCreativeType } from '../../creatives/server'
import type { CreativeKeywordSourceQuotaAudit } from './creative-keyword-selection'
import type { PoolKeywordData } from '../offer-pool'
import { KEYWORD_POLICY } from '../planner/keyword-policy'`

  prependImports(path.join(dir, 'creative-keyword-set-builder-types.ts'), typesImports)

  const candidatesImports = `import type { KeywordSupplementationReport } from '../../creatives/generator/types'
import {
  filterCreativeKeywordsByOfferContextDetailed,
  normalizeCreativeKeywordCandidatesForContextFilter,
} from './creative-keyword-context-filter'
import type { CanonicalCreativeType } from '../../creatives/server'
import {
  getKeywordSourcePriorityScoreFromInput,
  inferKeywordRawSource,
  normalizeKeywordSourceSubtype,
} from './creative-keyword-source-priority'
import {
  containsPureBrand,
  getPureBrandKeywords,
  isPureBrandKeyword,
} from '../brand/brand-keyword-utils'
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
  BUILDER_MODEL_ANCHOR_PATTERN,
  BUILDER_STANDALONE_MODEL_TOKEN_PATTERN,
  BUILDER_OFFER_CONTEXT_FILTERED_TAG,
  RELAXED_FILTERING_BUCKET_FLOOR_BY_BUCKET,
  RELAXED_FILTERING_PRIORITY_SOURCE_PATTERNS,
  CREATIVE_KEYWORD_ALERT_CONTEXT_REMOVAL_THRESHOLD,
  CREATIVE_KEYWORD_ALERT_NON_TARGET_RATIO_THRESHOLD,
} from './creative-keyword-set-builder-types'`

  prependImports(
    path.join(dir, 'creative-keyword-set-builder-candidates.ts'),
    candidatesImports
  )

  const auditImports = `import type { KeywordSupplementationReport } from '../../creatives/generator/types'
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
import { inferCreativeAffinity } from './creative-keyword-set-builder-candidates'`

  prependImports(path.join(dir, 'creative-keyword-set-builder-audit.ts'), auditImports)

  const rescueImports = `import type { CanonicalCreativeType } from '../../creatives/server'
import type { CreativeKeywordSourceQuotaAudit } from './creative-keyword-selection'
import {
  containsPureBrand,
  getPureBrandKeywords,
} from '../brand/brand-keyword-utils'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import type { PoolKeywordData } from '../offer-pool'
import {
  type BuildCreativeKeywordSetInput,
  BUILDER_MODEL_ANCHOR_PATTERN,
  RESCUE_PREFIX_NOISE_TOKENS,
  RESCUE_BREAK_TOKENS,
  RESCUE_TRAILING_CONNECTOR_TOKENS,
  RESCUE_TRAILING_CONNECTOR_ALLOWED_BIGRAMS,
  RESCUE_SHORT_NUMERIC_SUFFIX_ALLOWED_PREV_TOKENS,
  RESCUE_INLINE_SKIP_TOKENS,
  RESCUE_FORBIDDEN_TOPIC_TOKENS,
  RESCUE_SEGMENT_SPLIT_PATTERN,
  RESCUE_CONTEXT_TEXT_MAX_ITEMS,
  RESCUE_CONTEXT_DETAIL_MAX_CANDIDATES,
  RESCUE_NEUTRAL_MODEL_TOKEN_PATTERN,
  RESCUE_NEUTRAL_SPEC_TOKEN_PATTERN,
  RESCUE_NEUTRAL_RATIO_TOKEN_PATTERN,
  RESCUE_NEUTRAL_CERT_TOKEN_PATTERN,
  RESCUE_NEUTRAL_DETAIL_MAX_CANDIDATES,
} from './creative-keyword-set-builder-types'
import { normalizeCandidateKey } from './creative-keyword-set-builder-candidates'`

  prependImports(path.join(dir, 'creative-keyword-set-builder-rescue.ts'), rescueImports)

  const mainImports = `import {
  toFallbackKeywords,
  normalizeCandidateKey,
  envEnabled,
  parseBoundedFloatEnv,
  emitCreativeKeywordRiskAlerts,
  resolveBucketMinimumKeywordTarget,
  isRelaxedFilteringPriorityCandidate,
  compareRelaxedFilteringCandidates,
  compareContextRecoveryCandidates,
  filterLanguageCompatibleCandidates,
  normalizeSeedCandidates,
  mergeSeedCandidates,
  prefixStandaloneModelTokensWithBrand,
  buildGlobalKeywordVolumeHintMap,
  applyGlobalKeywordVolumeBackfill,
  extractPoolCandidatesFromSeedCandidates,
  buildPromptKeywordSubset,
  filterBlockedPromptKeywords,
  toCreativeKeywordCandidate,
  hasOfferContextFilteredTag,
  filterBlockedFallbackCandidates,
  resolveKeywordCandidatesAfterContextFilter,
  isKeywordPoolCandidate,
} from './creative-keyword-set-builder-candidates'
import {
  shouldBlockOriginalFallbackForModelIntent,
  buildKeywordSourceAudit,
} from './creative-keyword-set-builder-audit'
import {
  buildNonEmptyRescueCandidates,
  buildNonEmptyRescueSourceQuotaAudit,
  augmentSourceQuotaAuditWithRescue,
  isBuilderNonEmptyRescueCandidate,
} from './creative-keyword-set-builder-rescue'
import { CREATIVE_PROMPT_KEYWORD_LIMIT } from './creative-keyword-set-builder-types'
`

  prependImports(path.join(dir, 'creative-keyword-set-builder.ts'), mainImports)

  // Export internal types used across modules
  let typesBody = fs.readFileSync(path.join(dir, 'creative-keyword-set-builder-types.ts'), 'utf8')
  typesBody = typesBody
    .replace(/^interface CreativeKeywordCandidateProvenance/m, 'export interface CreativeKeywordCandidateProvenance')
    .replace(/^interface CreativeKeywordSourceRatioItem/m, 'export interface CreativeKeywordSourceRatioItem')
    .replace(/^interface CreativeKeywordContextFilterStats/m, 'export interface CreativeKeywordContextFilterStats')
    .replace(/^interface CreativeKeywordSelectionMetrics/m, 'export interface CreativeKeywordSelectionMetrics')
    .replace(/^const CREATIVE_PROMPT_KEYWORD_LIMIT/m, 'export const CREATIVE_PROMPT_KEYWORD_LIMIT')
    .replace(/^const BUILDER_MODEL_ANCHOR_PATTERN/m, 'export const BUILDER_MODEL_ANCHOR_PATTERN')
    .replace(/^const BUILDER_STANDALONE_MODEL_TOKEN_PATTERN/m, 'export const BUILDER_STANDALONE_MODEL_TOKEN_PATTERN')
    .replace(/^const BUILDER_OFFER_CONTEXT_FILTERED_TAG/m, 'export const BUILDER_OFFER_CONTEXT_FILTERED_TAG')
    .replace(/^const RESCUE_PREFIX_NOISE_TOKENS/m, 'export const RESCUE_PREFIX_NOISE_TOKENS')
    .replace(/^const RESCUE_BREAK_TOKENS/m, 'export const RESCUE_BREAK_TOKENS')
    .replace(/^const RESCUE_TRAILING_CONNECTOR_TOKENS/m, 'export const RESCUE_TRAILING_CONNECTOR_TOKENS')
    .replace(/^const RESCUE_TRAILING_CONNECTOR_ALLOWED_BIGRAMS/m, 'export const RESCUE_TRAILING_CONNECTOR_ALLOWED_BIGRAMS')
    .replace(/^const RESCUE_SHORT_NUMERIC_SUFFIX_ALLOWED_PREV_TOKENS/m, 'export const RESCUE_SHORT_NUMERIC_SUFFIX_ALLOWED_PREV_TOKENS')
    .replace(/^const RESCUE_INLINE_SKIP_TOKENS/m, 'export const RESCUE_INLINE_SKIP_TOKENS')
    .replace(/^const RESCUE_FORBIDDEN_TOPIC_TOKENS/m, 'export const RESCUE_FORBIDDEN_TOPIC_TOKENS')
    .replace(/^const RESCUE_SEGMENT_SPLIT_PATTERN/m, 'export const RESCUE_SEGMENT_SPLIT_PATTERN')
    .replace(/^const RESCUE_CONTEXT_TEXT_MAX_ITEMS/m, 'export const RESCUE_CONTEXT_TEXT_MAX_ITEMS')
    .replace(/^const RESCUE_CONTEXT_DETAIL_MAX_CANDIDATES/m, 'export const RESCUE_CONTEXT_DETAIL_MAX_CANDIDATES')
    .replace(/^const RESCUE_NEUTRAL_MODEL_TOKEN_PATTERN/m, 'export const RESCUE_NEUTRAL_MODEL_TOKEN_PATTERN')
    .replace(/^const RESCUE_NEUTRAL_SPEC_TOKEN_PATTERN/m, 'export const RESCUE_NEUTRAL_SPEC_TOKEN_PATTERN')
    .replace(/^const RESCUE_NEUTRAL_RATIO_TOKEN_PATTERN/m, 'export const RESCUE_NEUTRAL_RATIO_TOKEN_PATTERN')
    .replace(/^const RESCUE_NEUTRAL_CERT_TOKEN_PATTERN/m, 'export const RESCUE_NEUTRAL_CERT_TOKEN_PATTERN')
    .replace(/^const RESCUE_NEUTRAL_DETAIL_MAX_CANDIDATES/m, 'export const RESCUE_NEUTRAL_DETAIL_MAX_CANDIDATES')
    .replace(/^const RELAXED_FILTERING_BUCKET_FLOOR_BY_BUCKET/m, 'export const RELAXED_FILTERING_BUCKET_FLOOR_BY_BUCKET')
    .replace(/^const RELAXED_FILTERING_PRIORITY_SOURCE_PATTERNS/m, 'export const RELAXED_FILTERING_PRIORITY_SOURCE_PATTERNS')
    .replace(/^const CREATIVE_KEYWORD_ALERT_CONTEXT_REMOVAL_THRESHOLD/m, 'export const CREATIVE_KEYWORD_ALERT_CONTEXT_REMOVAL_THRESHOLD')
    .replace(/^const CREATIVE_KEYWORD_ALERT_NON_TARGET_RATIO_THRESHOLD/m, 'export const CREATIVE_KEYWORD_ALERT_NON_TARGET_RATIO_THRESHOLD')
  fs.writeFileSync(path.join(dir, 'creative-keyword-set-builder-types.ts'), typesBody)

  exportFunctions(path.join(dir, 'creative-keyword-set-builder-candidates.ts'), [
    'toFallbackKeywords',
    'normalizeCandidateKey',
    'envEnabled',
    'parseBoundedFloatEnv',
    'resolveSelectedKeywordLanguageRisk',
    'emitCreativeKeywordRiskAlerts',
    'normalizeBucketForFloor',
    'resolveBucketMinimumKeywordTarget',
    'isRelaxedFilteringPriorityCandidate',
    'compareRelaxedFilteringCandidates',
    'compareContextRecoveryCandidates',
    'filterLanguageCompatibleCandidates',
    'normalizeSeedCandidates',
    'mergeSeedCandidates',
    'prefixStandaloneModelTokensWithBrand',
    'buildGlobalKeywordVolumeHintMap',
    'applyGlobalKeywordVolumeBackfill',
    'extractPoolCandidatesFromSeedCandidates',
    'buildPromptKeywordSubset',
    'filterBlockedPromptKeywords',
    'toCreativeKeywordCandidate',
    'isKeywordPoolCandidate',
    'hasOfferContextFilteredTag',
    'filterBlockedFallbackCandidates',
    'resolveKeywordCandidatesAfterContextFilter',
    'inferCreativeAffinity',
  ])

  exportFunctions(path.join(dir, 'creative-keyword-set-builder-audit.ts'), [
    'shouldBlockOriginalFallbackForModelIntent',
    'buildKeywordSourceAudit',
  ])

  exportFunctions(path.join(dir, 'creative-keyword-set-builder-rescue.ts'), [
    'buildNonEmptyRescueCandidates',
    'buildNonEmptyRescueSourceQuotaAudit',
    'augmentSourceQuotaAuditWithRescue',
    'isBuilderNonEmptyRescueCandidate',
  ])
}

// ─── context-filter ──────────────────────────────────────────────────────────

function splitContextFilter() {
  const sourcePath = path.join(dir, 'creative-keyword-context-filter.ts')
  const lines = readLines(sourcePath)
  const headerImports = lines.slice(0, 21).join('\n')

  writeModule(
    path.join(dir, 'creative-keyword-context-filter-utils.ts'),
    '创意关键词上下文过滤：信号提取与分词',
    slice(lines, 22, 691)
  )

  writeModule(
    path.join(dir, 'creative-keyword-context-filter-product.ts'),
    '创意关键词上下文过滤：商品页意图特异性',
    slice(lines, 692, 1184)
  )

  writeModule(
    path.join(dir, 'creative-keyword-context-filter-intent.ts'),
    '创意关键词上下文过滤：店铺意图与收紧评分',
    slice(lines, 1185, 1987)
  )

  const filterBody = `${slice(lines, 1989, 2608)}

export const __testOnly = {
  normalizeContextToken,
  tokenizeContext,
  buildIntentContextAnchorTokens,
  hasIntentContextAnchor,
  shouldKeepAfterIntentTightening,
}
`

  fs.writeFileSync(
    sourcePath,
    `/**
 * 创意关键词上下文过滤：主流程
 */
${headerImports}

${filterBody}
`
  )
}

function wireContextFilter() {
  const sharedTypes = `import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import type { CanonicalCreativeType } from '../../creatives/server'
import type { PoolKeywordData } from '../offer-pool'

interface OfferKeywordContext {
  brand?: string | null
  category?: string | null
  product_name?: string | null
  offer_name?: string | null
  target_country?: string | null
  target_language?: string | null
  final_url?: string | null
  url?: string | null
  page_type?: string | null
  scraped_data?: string | null
}
`

  prependImports(
    path.join(dir, 'creative-keyword-context-filter-utils.ts'),
    sharedTypes
  )

  prependImports(
    path.join(dir, 'creative-keyword-context-filter-product.ts'),
    `${sharedTypes}
import {
  normalizeContextToken,
  tokenizeContext,
  resolveCreativeContextMaxWordCount,
  extractCategorySignalsForKeywordContext,
  collectKeywordContextStructuredTexts,
  shouldAllowCoreSpecificAnchorToken,
  extractLeafIntentSpecificitySegments,
  CREATIVE_CONTEXT_GENERIC_TOKENS,
  PRODUCT_PAGE_CONTAINER_HEAD_TOKENS,
  PRODUCT_PAGE_SPECIFICITY_NOISE_TOKENS,
  PRODUCT_PAGE_GENERIC_DRIFT_TOKENS,
  PRODUCT_PAGE_ALLOWED_SOFT_MODIFIER_TOKENS,
  PRODUCT_PAGE_WEAK_SINGLE_SPECIFICITY_TOKENS,
  PRODUCT_PAGE_CONTEXTUAL_GENERIC_MODIFIER_TOKENS,
  PRODUCT_PAGE_PORTABLE_SUPPORT_CONTEXT_TOKENS,
  PRODUCT_PAGE_SPECIFICITY_PREFIX_BREAK_PATTERN,
  PRODUCT_PAGE_SPECIFICITY_WINDOW_BEFORE_HEAD,
  PRODUCT_PAGE_SPECIFICITY_WINDOW_AFTER_HEAD,
  PRODUCT_PAGE_CORE_SPECIFICITY_WINDOW_BEFORE_HEAD,
  PRODUCT_PAGE_CORE_SPECIFICITY_WINDOW_AFTER_HEAD,
  type ProductPageIntentSpecificityContext,
  type ProductPageIntentSpecificityEvaluation,
} from './creative-keyword-context-filter-utils'`
  )

  prependImports(
    path.join(dir, 'creative-keyword-context-filter-intent.ts'),
    `${sharedTypes}
import { getMinContextTokenMatchesForKeywordQualityFilter } from '../planner/keyword-context-filter'
import {
  containsPureBrand,
  getPureBrandKeywords,
  isPureBrandKeyword,
} from '../brand/brand-keyword-utils'
import {
  buildProductModelFamilyContext,
  filterKeywordObjectsByProductModelFamily,
  isKeywordInProductModelFamily,
  supplementModelIntentKeywordsWithFallback,
  type ProductModelFamilyContext,
} from '../../creatives/server'
import {
  normalizeContextToken,
  tokenizeContext,
  tokenizeStoreIntentSpecificity,
  getStoreIntentSpecificityHeadToken,
  extractIntentPhraseHeadTokens,
  resolveCreativeContextMaxWordCount,
  CREATIVE_CONTEXT_GENERIC_TOKENS,
  CREATIVE_CONTEXT_FORBIDDEN_REASON_PATTERN,
  MODEL_INTENT_TRANSACTIONAL_PATTERN,
  MODEL_INTENT_SOFT_FAMILY_ALLOWED_EXTRA_TOKENS,
  MODEL_INTENT_SOFT_FAMILY_BLOCKED_VARIANT_TOKENS,
  STORE_INTENT_SPECIFICITY_IGNORED_TOKENS,
  type IntentTighteningEvaluation,
  type StoreIntentTighteningContext,
} from './creative-keyword-context-filter-utils'
import {
  buildProductPageIntentSpecificityContext,
  evaluateProductPageIntentSpecificity,
} from './creative-keyword-context-filter-product'`
  )

  prependImports(
    path.join(dir, 'creative-keyword-context-filter.ts'),
    `import { getMinContextTokenMatchesForKeywordQualityFilter } from '../planner/keyword-context-filter'
import { filterKeywordQuality } from '../keyword-quality-filter'
import {
  containsPureBrand,
  getPureBrandKeywords,
  isPureBrandKeyword,
} from '../brand/brand-keyword-utils'
import type { CanonicalCreativeType } from '../../creatives/server'
import { resolveCreativeKeywordMinimumOutputCount } from './creative-keyword-output-floor'
import type { PoolKeywordData } from '../offer-pool'
import {
  buildProductModelFamilyContext,
  buildProductModelFamilyFallbackKeywords,
  filterKeywordObjectsByProductModelFamily,
  isKeywordInProductModelFamily,
  MODEL_INTENT_MIN_KEYWORD_FLOOR,
  type ProductModelFamilyContext,
  supplementModelIntentKeywordsWithFallback,
} from '../../creatives/server'
import {
  resolveOfferPageTypeForKeywordContext,
  extractCategorySignalsForKeywordContext,
  extractStoreSignalsForKeywordQualityContext,
  buildKeywordQualityProductContext,
  normalizeContextFilteredKeywordKey,
  addBlockedKeywordKey,
  normalizeContextToken,
  tokenizeContext,
  CREATIVE_CONTEXT_FORBIDDEN_REASON_PATTERN,
} from './creative-keyword-context-filter-utils'
import { evaluateProductPageIntentSpecificity } from './creative-keyword-context-filter-product'
import {
  evaluateStoreIntentSpecificity,
  hasSoftModelFamilySignals,
  hasAnyModelFamilySignals,
  buildIntentContextAnchorTokens,
  hasIntentContextAnchor,
  shouldKeepAfterIntentTightening,
  evaluateIntentTighteningCandidate,
  buildIntentTighteningRelaxedFallbackCandidates,
  hasUnexpectedSoftFamilyTokens,
  buildAllowedVariantTokens,
  hasUnexpectedVariantModifierToken,
  hasRepeatedNonNumericDemandToken,
  scoreIntentTighteningFallbackCandidate,
  resolveIntentTighteningPreferredFloor,
} from './creative-keyword-context-filter-intent'
`
  )

  // Export symbols from utils for cross-module use
  let utilsBody = fs.readFileSync(path.join(dir, 'creative-keyword-context-filter-utils.ts'), 'utf8')
  utilsBody = utilsBody
    .replace(/^interface IntentTighteningEvaluation/m, 'export interface IntentTighteningEvaluation')
    .replace(/^interface StoreIntentTighteningContext/m, 'export interface StoreIntentTighteningContext')
    .replace(/^interface ProductPageIntentSpecificityContext/m, 'export interface ProductPageIntentSpecificityContext')
    .replace(/^interface ProductPageIntentSpecificityEvaluation/m, 'export interface ProductPageIntentSpecificityEvaluation')
    .replace(/^const CREATIVE_CONTEXT_GENERIC_TOKENS/m, 'export const CREATIVE_CONTEXT_GENERIC_TOKENS')
    .replace(/^const CREATIVE_CONTEXT_FORBIDDEN_REASON_PATTERN/m, 'export const CREATIVE_CONTEXT_FORBIDDEN_REASON_PATTERN')
    .replace(/^const MODEL_INTENT_TRANSACTIONAL_PATTERN/m, 'export const MODEL_INTENT_TRANSACTIONAL_PATTERN')
    .replace(/^const MODEL_INTENT_SOFT_FAMILY_ALLOWED_EXTRA_TOKENS/m, 'export const MODEL_INTENT_SOFT_FAMILY_ALLOWED_EXTRA_TOKENS')
    .replace(/^const MODEL_INTENT_SOFT_FAMILY_BLOCKED_VARIANT_TOKENS/m, 'export const MODEL_INTENT_SOFT_FAMILY_BLOCKED_VARIANT_TOKENS')
    .replace(/^const STORE_INTENT_SPECIFICITY_IGNORED_TOKENS/m, 'export const STORE_INTENT_SPECIFICITY_IGNORED_TOKENS')
    .replace(/^const PRODUCT_PAGE_CONTAINER_HEAD_TOKENS/m, 'export const PRODUCT_PAGE_CONTAINER_HEAD_TOKENS')
    .replace(/^const PRODUCT_PAGE_SPECIFICITY_NOISE_TOKENS/m, 'export const PRODUCT_PAGE_SPECIFICITY_NOISE_TOKENS')
    .replace(/^const PRODUCT_PAGE_GENERIC_DRIFT_TOKENS/m, 'export const PRODUCT_PAGE_GENERIC_DRIFT_TOKENS')
    .replace(/^const PRODUCT_PAGE_ALLOWED_SOFT_MODIFIER_TOKENS/m, 'export const PRODUCT_PAGE_ALLOWED_SOFT_MODIFIER_TOKENS')
    .replace(/^const PRODUCT_PAGE_WEAK_SINGLE_SPECIFICITY_TOKENS/m, 'export const PRODUCT_PAGE_WEAK_SINGLE_SPECIFICITY_TOKENS')
    .replace(/^const PRODUCT_PAGE_CONTEXTUAL_GENERIC_MODIFIER_TOKENS/m, 'export const PRODUCT_PAGE_CONTEXTUAL_GENERIC_MODIFIER_TOKENS')
    .replace(/^const PRODUCT_PAGE_PORTABLE_SUPPORT_CONTEXT_TOKENS/m, 'export const PRODUCT_PAGE_PORTABLE_SUPPORT_CONTEXT_TOKENS')
    .replace(/^const PRODUCT_PAGE_SPECIFICITY_PREFIX_BREAK_PATTERN/m, 'export const PRODUCT_PAGE_SPECIFICITY_PREFIX_BREAK_PATTERN')
    .replace(/^const PRODUCT_PAGE_SPECIFICITY_WINDOW_BEFORE_HEAD/m, 'export const PRODUCT_PAGE_SPECIFICITY_WINDOW_BEFORE_HEAD')
    .replace(/^const PRODUCT_PAGE_SPECIFICITY_WINDOW_AFTER_HEAD/m, 'export const PRODUCT_PAGE_SPECIFICITY_WINDOW_AFTER_HEAD')
    .replace(/^const PRODUCT_PAGE_CORE_SPECIFICITY_WINDOW_BEFORE_HEAD/m, 'export const PRODUCT_PAGE_CORE_SPECIFICITY_WINDOW_BEFORE_HEAD')
    .replace(/^const PRODUCT_PAGE_CORE_SPECIFICITY_WINDOW_AFTER_HEAD/m, 'export const PRODUCT_PAGE_CORE_SPECIFICITY_WINDOW_AFTER_HEAD')
  fs.writeFileSync(path.join(dir, 'creative-keyword-context-filter-utils.ts'), utilsBody)

  exportFunctions(path.join(dir, 'creative-keyword-context-filter-utils.ts'), [
    'resolveCreativeContextMaxWordCount',
    'resolveOfferPageTypeForKeywordContext',
    'extractCategorySignalsForKeywordContext',
    'collectKeywordContextStructuredTexts',
    'extractStoreSignalsForKeywordQualityContext',
    'buildKeywordQualityProductContext',
    'normalizeContextToken',
    'tokenizeContext',
    'tokenizeStoreIntentSpecificity',
    'getStoreIntentSpecificityHeadToken',
    'buildStoreIntentTighteningContext',
    'extractIntentPhraseHeadTokens',
    'extractLeafIntentSpecificitySegments',
    'shouldAllowCoreSpecificAnchorToken',
    'normalizeContextFilteredKeywordKey',
    'addBlockedKeywordKey',
  ])

  exportFunctions(path.join(dir, 'creative-keyword-context-filter-product.ts'), [
    'buildProductPageIntentSpecificityContext',
    'evaluateProductPageIntentSpecificity',
  ])

  exportFunctions(path.join(dir, 'creative-keyword-context-filter-intent.ts'), [
    'evaluateStoreIntentSpecificity',
    'hasSoftModelFamilySignals',
    'hasAnyModelFamilySignals',
    'buildIntentContextAnchorTokens',
    'hasIntentContextAnchor',
    'shouldKeepAfterIntentTightening',
    'evaluateIntentTighteningCandidate',
    'buildIntentTighteningRelaxedFallbackCandidates',
    'hasUnexpectedSoftFamilyTokens',
    'buildAllowedVariantTokens',
    'hasUnexpectedVariantModifierToken',
    'hasRepeatedNonNumericDemandToken',
    'scoreIntentTighteningFallbackCandidate',
    'resolveIntentTighteningPreferredFloor',
  ])
}

splitSetBuilder()
wireSetBuilder()
splitContextFilter()
wireContextFilter()

console.log('Split complete — run: npm run format:changed && npm run lint:changed && npm run type-check')
console.log('Then: npm test -- src/__tests__/lib/creative-keyword-set-builder.test.ts src/__tests__/lib/creative-keyword-context-filter.test.ts')
