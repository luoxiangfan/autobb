import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import {
  containsPureBrand,
  isPureBrandKeyword,
  PRODUCT_WORD_PATTERNS,
} from './brand/brand-keyword-utils'
import {
  buildKeywordIntegrityAnchors,
  getSplitAnchorDistortionReason,
  isKeywordLanguageMismatch,
} from './planner/keyword-validity'
import { isBrandIrrelevant, isBrandVariant } from './keyword-quality-filter-brand'
import { isPlatformMismatch } from './keyword-quality-filter-platform'
import type { PoolKeywordData } from './offer-pool'
import type { RelevanceMode } from './keyword-quality-filter-types'

const RELEVANCE_PHRASE_NORMALIZERS: Array<{ pattern: RegExp; replacement: string }> = [
  // Normalize common multi-word product forms to a single token to improve context matching.
  { pattern: /\brobot(?:ic)?\s+vacuum(?:s)?\b/giu, replacement: ' vacuum ' },
  { pattern: /\brobo[\s-]?vac(?:s)?\b/giu, replacement: ' vacuum ' },
  { pattern: /\bsound[\s-]?bar(?:s)?\b/giu, replacement: ' speaker ' },
  { pattern: /\bdash[\s-]?cam(?:s)?\b/giu, replacement: ' camera ' },
  { pattern: /\bpower[\s-]?bank(?:s)?\b/giu, replacement: ' powerbank ' },
]

const RELEVANCE_TOKEN_EQUIVALENCE_GROUPS: string[][] = [
  [
    'audio',
    'speaker',
    'speakers',
    'soundbar',
    'soundbars',
    'subwoofer',
    'subwoofers',
    'stereo',
    'homeaudio',
    'loudspeaker',
    'loudspeakers',
    'amp',
    'amps',
    'amplifier',
    'amplifiers',
    'receiver',
    'receivers',
    'headphone',
    'headphones',
    'earbud',
    'earbuds',
  ],
  ['vacuum', 'vacuums', 'robovac', 'robovacs', 'robotvacuum', 'roboticvacuum'],
  [
    'charge',
    'charger',
    'chargers',
    'charging',
    'charged',
    'adapter',
    'adapters',
    'powerbank',
    'powerbanks',
  ],
  ['camera', 'cameras', 'cam', 'cams', 'dashcam', 'dashcams', 'dashcamera', 'dashcameras'],
]

const RELEVANCE_TOKEN_CANONICAL_MAP = new Map<string, string>()
for (const group of RELEVANCE_TOKEN_EQUIVALENCE_GROUPS) {
  const canonical = group[0]
  for (const alias of group) {
    RELEVANCE_TOKEN_CANONICAL_MAP.set(alias, canonical)
  }
}

const COMMERCIAL_CONTEXT_SIGNAL_TOKENS = new Set([
  ...PRODUCT_WORD_PATTERNS,
  'speaker',
  'soundbar',
  'audio',
  'vacuum',
  'robovac',
  'charger',
  'charge',
  'adapter',
  'camera',
  'timer',
  'controller',
  'furniture',
  'mattress',
  'desk',
  'chair',
  'table',
  'sofa',
  'dresser',
  'frame',
  'trundle',
  'bunk',
])

const CONTEXT_PLACEHOLDER_PHRASES = new Set([
  'data not available',
  'not available',
  'unknown',
  'n a',
  'na',
  'none',
  'null',
  'no data',
  'not applicable',
])

const GENERIC_MARKETPLACE_TAXONOMY_TOKENS = new Set([
  'home',
  'kitchen',
  'bedroom',
  'department',
  'departments',
  'product',
  'products',
  'detail',
  'details',
  'seller',
  'sellers',
  'rank',
  'ranking',
  'top',
  'see',
])

const BROAD_CONTEXT_MATCH_TOKENS = new Set(['bed', 'office', 'room', 'rooms'])

const CONTEXT_MATCH_BRIDGE_RULES: Array<{
  targetToken: string
  contextFamily: Set<string>
}> = [
  {
    targetToken: 'furniture',
    contextFamily: new Set([
      'bed',
      'beds',
      'frame',
      'frames',
      'bunk',
      'trundle',
      'loft',
      'furniture',
    ]),
  },
]

function applyContextMatchBridgeRules(params: {
  keywordTokens: string[]
  usableContext: string[]
  matchedTokenSet: Set<string>
}): void {
  const { keywordTokens, usableContext, matchedTokenSet } = params
  if (keywordTokens.length === 0 || usableContext.length === 0) return

  for (const rule of CONTEXT_MATCH_BRIDGE_RULES) {
    if (!keywordTokens.includes(rule.targetToken)) continue
    if (!usableContext.some((token) => rule.contextFamily.has(token))) continue
    matchedTokenSet.add(rule.targetToken)
  }
}

function sanitizeContextInput(input?: string): string {
  if (!input) return ''

  const normalized = input
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

  if (!normalized) return ''
  if (CONTEXT_PLACEHOLDER_PHRASES.has(normalized)) return ''
  return input
}

function normalizeRelevanceToken(token: string): string {
  const raw = (token || '').toLowerCase().trim()
  if (!raw) return ''

  const directAlias = RELEVANCE_TOKEN_CANONICAL_MAP.get(raw)
  if (directAlias) return directAlias

  let stemmed = raw
  if (stemmed.endsWith('ies') && stemmed.length > 4) {
    stemmed = `${stemmed.slice(0, -3)}y`
  } else if (stemmed.endsWith('es') && stemmed.length > 4) {
    stemmed = stemmed.slice(0, -2)
  } else if (stemmed.endsWith('s') && stemmed.length > 3 && !stemmed.endsWith('ss')) {
    stemmed = stemmed.slice(0, -1)
  }

  return RELEVANCE_TOKEN_CANONICAL_MAP.get(stemmed) || stemmed
}

export function hasCommercialContextSignal(keyword: string): boolean {
  const tokens = normalizeRelevanceTokens(keyword)
  if (hasModelLikeToken(tokens)) return true
  return tokens.some((token) => COMMERCIAL_CONTEXT_SIGNAL_TOKENS.has(token))
}

const CONTEXT_RESTORE_BLOCKED_PATTERNS = [
  /\b(gif|meme|emoji|sticker|drawing|image|images|logo|png|jpg|jpeg|svg|icon|clipart|wallpaper)\b/i,
  /\b(size chart|size guide|sizing)\b/i,
]

const TRANSACTIONAL_MATRIX_TOKENS = new Set([
  'buy',
  'purchase',
  'order',
  'shop',
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
const AI_TEMPLATE_SENSITIVE_SOURCE_KEYS = new Set([
  'AI_GENERATED',
  'AI_LLM_RAW',
  'KEYWORD_EXPANSION',
  'AI_FALLBACK_PLACEHOLDER',
  'CLUSTERED',
])
const AI_TEMPLATE_SPILLOVER_TOKENS = new Set([
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
const AI_TEMPLATE_PHRASE_PATTERNS = [
  /\b(?:smart|premium|ultimate|best|top)\s+(?:choice|option|solution)s?\b/i,
  /\b(?:daily|everyday)\s+(?:choice|option|solution|use)\b/i,
  /\b(?:high|top|premium)\s+quality\b/i,
  /\b(?:best|top)\s+value\b/i,
  /\b(?:for|to)\s+every(?:one|day)\b/i,
  /\b(?:lifestyle|home)\s+(?:essential|essentials|must\s*have)\b/i,
]
const AI_TEMPLATE_SAFE_SPEC_PATTERN =
  /\b\d+\s*(?:inch|in|oz|ml|l|pack|count|ct|pcs|piece|w|wh|mah|gb|tb|btu|doe|ashrae)\b/i

const SOURCE_TRUST_SCORE_RULES: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /^SEARCH_TERM_HIGH_PERFORMING$/i, score: 20 },
  { pattern: /^KEYWORD_PLANNER/i, score: 16 },
  { pattern: /^SEARCH_TERM_/i, score: 14 },
  { pattern: /^GOOGLE_SUGGEST$/i, score: 12 },
  { pattern: /^ENHANCED_EXTRACT$/i, score: 12 },
  { pattern: /^OFFER_EXTRACTED_KEYWORDS$/i, score: 10 },
  { pattern: /^SCORING_SUGGESTION$/i, score: 9 },
  { pattern: /^GLOBAL_CORE$/i, score: 7 },
  { pattern: /^GLOBAL_CATEGORY_BRANDED$/i, score: 6 },
  { pattern: /^GLOBAL_KEYWORDS$/i, score: 3 },
]

const HIGH_PERFORMING_INFO_QUERY_PATTERN =
  /\b(what is|meaning|tutorial|guide|manual|how to|instructions?)\b/i
const HIGH_PERFORMING_REVIEW_COMPARE_PATTERN = /\b(review|reviews|comparison|compare|vs)\b/i
const HIGH_PERFORMING_PLATFORM_PATTERN = /\b(amazon|walmart|ebay|etsy|aliexpress|temu)\b/i

export function isLanguageScriptMismatch(params: {
  keyword: string
  targetLanguage?: string
  pureBrandKeywords: string[]
}): boolean {
  return isKeywordLanguageMismatch(params)
}

export function getKeywordAnchorDistortionReason(params: {
  keyword: string
  pureBrandKeywords: string[]
  productName?: string
}): string | null {
  return getSplitAnchorDistortionReason({
    keyword: params.keyword,
    pureBrandKeywords: params.pureBrandKeywords,
    anchorTerms: buildKeywordIntegrityAnchors({
      pureBrandKeywords: params.pureBrandKeywords,
      productName: params.productName,
    }),
  })
}

export function getHighPerformingHardBlockReason(params: {
  keyword: string
  brandName: string
  pureBrandKeywords: string[]
  productUrl?: string
  targetLanguage?: string
  source?: string
  sourceType?: string
  sourceSubtype?: string
}): string | null {
  const {
    keyword,
    brandName,
    pureBrandKeywords,
    productUrl,
    targetLanguage,
    source,
    sourceType,
    sourceSubtype,
  } = params
  const templateGarbageReason = getTemplateGarbageReason(keyword, {
    source,
    sourceType,
    sourceSubtype,
  })
  if (templateGarbageReason) {
    return templateGarbageReason
  }

  if (isBrandVariant(keyword, brandName)) {
    return `高表现Search Term命中品牌变体词: "${keyword}"`
  }

  if (isBrandIrrelevant(keyword, brandName)) {
    return `高表现Search Term命中品牌无关词: "${keyword}"`
  }

  if (productUrl && isPlatformMismatch(keyword, productUrl)) {
    return `高表现Search Term平台冲突: "${keyword}"`
  }

  if (HIGH_PERFORMING_PLATFORM_PATTERN.test(keyword)) {
    return `高表现Search Term命中平台词: "${keyword}"`
  }

  if (HIGH_PERFORMING_INFO_QUERY_PATTERN.test(keyword)) {
    return `高表现Search Term命中信息查询词: "${keyword}"`
  }

  if (HIGH_PERFORMING_REVIEW_COMPARE_PATTERN.test(keyword)) {
    return `高表现Search Term命中评测对比词: "${keyword}"`
  }

  if (isLanguageScriptMismatch({ keyword, targetLanguage, pureBrandKeywords })) {
    return `语言脚本错配: "${keyword}"`
  }

  return null
}

export function shouldBlockContextRestore(keyword: string): boolean {
  const normalized = String(keyword || '')
    .trim()
    .toLowerCase()
  if (!normalized) return false
  return CONTEXT_RESTORE_BLOCKED_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function normalizeKeywordWords(keyword: string): string[] {
  const normalized =
    normalizeGoogleAdsKeyword(keyword) ||
    String(keyword || '')
      .toLowerCase()
      .trim()
  if (!normalized) return []
  return normalized.split(/\s+/).filter(Boolean)
}

function findRepeatedAdjacentWord(words: string[]): string | null {
  for (let i = 1; i < words.length; i += 1) {
    if (words[i] === words[i - 1]) return words[i]
  }
  return null
}

function getTransactionalModifierHits(words: string[]): string[] {
  return words.filter((word) => TRANSACTIONAL_MATRIX_TOKENS.has(word))
}

function hasAiTemplateSensitiveSource(options?: {
  source?: string
  sourceType?: string
  sourceSubtype?: string
}): boolean {
  if (!options) return false
  const sourceHints = [options.sourceSubtype, options.sourceType, options.source]
    .map((value) =>
      String(value || '')
        .trim()
        .toUpperCase()
    )
    .filter(Boolean)

  return sourceHints.some(
    (hint) => hint.startsWith('AI_') || AI_TEMPLATE_SENSITIVE_SOURCE_KEYS.has(hint)
  )
}

function getAiTemplatePhraseReason(keyword: string, words: string[]): string | null {
  const spilloverHits = new Set(words.filter((word) => AI_TEMPLATE_SPILLOVER_TOKENS.has(word)))
  const hasTemplatePhrase = AI_TEMPLATE_PHRASE_PATTERNS.some((pattern) => pattern.test(keyword))
  const hasSpecSignal = AI_TEMPLATE_SAFE_SPEC_PATTERN.test(keyword)

  if (hasSpecSignal && spilloverHits.size <= 1) return null
  if (hasTemplatePhrase) return 'AI模版短语'
  if (spilloverHits.size >= 2) return `AI泛化修饰词堆叠 (${Array.from(spilloverHits).join('+')})`
  return null
}

const WEAK_TRAILING_FRAGMENT_TOKENS = new Set([
  'there',
  'was',
  'were',
  'being',
  'been',
  'featuring',
  'feature',
  'features',
  'including',
  'include',
  'includes',
])

const TRAILING_BRIDGE_FRAGMENT_TOKENS = new Set([
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

const TRAILING_BRIDGE_ALLOWED_BIGRAMS = new Set(['check in', 'log in', 'sign in'])

const SHORT_NUMERIC_SUFFIX_ALLOWED_PREV_TOKENS = new Set([
  'gen',
  'mark',
  'mk',
  'series',
  'ver',
  'version',
])

export function getWeakTrailingFragmentReason(
  keyword: string,
  pureBrandKeywords: string[]
): string | null {
  if (!keyword) return null

  const brandTokens = new Set(pureBrandKeywords.flatMap((brand) => normalizeRelevanceTokens(brand)))
  const residualTokens = normalizeKeywordWords(keyword)
    .map((token) => normalizeRelevanceToken(token))
    .filter(Boolean)
    .filter((token) => !brandTokens.has(token))

  if (residualTokens.length === 0 || residualTokens.length > 2) return null
  if (!residualTokens.every((token) => WEAK_TRAILING_FRAGMENT_TOKENS.has(token))) return null

  return `弱语义残片词: "${keyword}"`
}

export function getTrailingBridgeFragmentReason(keyword: string): string | null {
  const words = normalizeKeywordWords(keyword)
  if (words.length < 2) return null

  const lastToken = words[words.length - 1] || ''
  if (!TRAILING_BRIDGE_FRAGMENT_TOKENS.has(lastToken)) return null

  const lastBigram = words.slice(-2).join(' ')
  if (TRAILING_BRIDGE_ALLOWED_BIGRAMS.has(lastBigram)) return null

  return `尾部连接残片词: "${keyword}"`
}

export function getBrandShortNumericFragmentReason(params: {
  keyword: string
  sourceType?: string
  pureBrandKeywords: string[]
}): string | null {
  const sourceType = String(params.sourceType || '')
    .trim()
    .toUpperCase()
  if (sourceType !== 'BUILDER_NON_EMPTY_RESCUE') return null

  const words = normalizeKeywordWords(params.keyword)
  if (words.length !== 2) return null
  if (!/^\d{1,2}$/.test(words[1] || '')) return null
  if (!containsPureBrand(params.keyword, params.pureBrandKeywords)) return null

  return `品牌短数字残片词: "${params.keyword}"`
}

export function getTrailingShortNumericFragmentReason(params: {
  keyword: string
  sourceType?: string
}): string | null {
  const sourceType = String(params.sourceType || '')
    .trim()
    .toUpperCase()
  if (sourceType !== 'BUILDER_NON_EMPTY_RESCUE') return null

  const words = normalizeKeywordWords(params.keyword)
  if (words.length < 3) return null

  const lastToken = words[words.length - 1] || ''
  if (!/^\d{1,2}$/.test(lastToken)) return null

  const penultimateToken = words[words.length - 2] || ''
  if (SHORT_NUMERIC_SUFFIX_ALLOWED_PREV_TOKENS.has(penultimateToken)) return null

  const hasPriorNumericAnchor = words
    .slice(0, -1)
    .some((word) => /\d/.test(word) && !/^\d{1,2}$/.test(word))
  if (!hasPriorNumericAnchor) return null

  return `尾部短数字残片词: "${params.keyword}"`
}

export function getTemplateGarbageReason(
  keyword: string,
  options?: {
    source?: string
    sourceType?: string
    sourceSubtype?: string
  }
): string | null {
  const words = normalizeKeywordWords(keyword)
  if (words.length === 0) return null

  if (words.some((word) => /^0{3}\d*$/.test(word))) {
    return `模板垃圾词: 数字残片 "${keyword}"`
  }

  const repeatedWord = findRepeatedAdjacentWord(words)
  if (repeatedWord) {
    return `模板垃圾词: 连续重复词 "${repeatedWord}"`
  }

  const transactionalHits = getTransactionalModifierHits(words)
  const uniqueTransactionalHits = Array.from(new Set(transactionalHits))
  if (uniqueTransactionalHits.length >= 2) {
    return `模板垃圾词: 交易修饰词矩阵叠加 (${uniqueTransactionalHits.join('+')})`
  }

  if (hasAiTemplateSensitiveSource(options)) {
    const aiTemplateReason = getAiTemplatePhraseReason(keyword, words)
    if (aiTemplateReason) {
      return `模板垃圾词: ${aiTemplateReason} "${keyword}"`
    }
  }

  return null
}

export function normalizeRelevanceTokens(input: string): string[] {
  let normalized = (input || '').toLowerCase().normalize('NFKC')
  for (const rule of RELEVANCE_PHRASE_NORMALIZERS) {
    normalized = normalized.replace(rule.pattern, rule.replacement)
  }

  const rawTokens = normalized
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => normalizeRelevanceToken(t))
    .filter(Boolean)

  const stop = new Set([
    'the',
    'a',
    'an',
    'and',
    'or',
    'for',
    'with',
    'to',
    'of',
    'in',
    'on',
    'by',
    'official',
    'store',
    'shop',
    'website',
    'site',
    'online',
    'set',
    'sets',
    'pack',
    'packs',
    'bundle',
    'bundles',
    'size',
    'sizes',
    'king',
    'queen',
    'twin',
    'full',
    'xl',
    'california',
    'cal',
    ...GENERIC_MARKETPLACE_TAXONOMY_TOKENS,
  ])

  return Array.from(
    new Set(
      rawTokens
        .filter((t) => t.length >= 2) // keep short but meaningful tokens like "4k", "5g"
        .filter((t) => !stop.has(t))
    )
  )
}

function getSourceTrustScore(source?: string): number {
  const normalized = String(source || '').trim()
  if (!normalized) return 5

  for (const rule of SOURCE_TRUST_SCORE_RULES) {
    if (rule.pattern.test(normalized)) return rule.score
  }

  return 5
}

export function resolveKeywordDataSourceTrustScore(keywordData: PoolKeywordData): number {
  const signals = [
    keywordData.sourceSubtype,
    keywordData.sourceType,
    keywordData.source,
    keywordData.rawSource,
  ]

  let bestScore = 0
  for (const signal of signals) {
    bestScore = Math.max(bestScore, getSourceTrustScore(signal))
  }

  return bestScore
}

function computeContextMatchCount(params: {
  keywordTokens: string[]
  pureBrandKeywords: string[]
  category?: string
  productName?: string
}): number {
  const { effectiveMatchCount } = computeContextMatchDetails(params)
  return effectiveMatchCount
}

function computeContextMatchDetails(params: {
  keywordTokens: string[]
  pureBrandKeywords: string[]
  category?: string
  productName?: string
}): {
  usableContext: string[]
  matchedTokens: string[]
  specificMatchedTokens: string[]
  effectiveMatchCount: number
} {
  const { keywordTokens, pureBrandKeywords, category, productName } = params
  const safeCategory = sanitizeContextInput(category)
  const safeProductName = sanitizeContextInput(productName)
  const contextTokens = [
    ...normalizeRelevanceTokens(safeCategory),
    ...normalizeRelevanceTokens(safeProductName),
  ]

  const brandTokens = new Set(pureBrandKeywords.flatMap((b) => normalizeRelevanceTokens(b)))
  const usableContext = Array.from(new Set(contextTokens)).filter((t) => !brandTokens.has(t))
  if (usableContext.length === 0) {
    return {
      usableContext: [],
      matchedTokens: [],
      specificMatchedTokens: [],
      effectiveMatchCount: 0,
    }
  }

  const contextSet = new Set(usableContext)
  const matchedTokenSet = new Set(keywordTokens.filter((t) => contextSet.has(t)))
  applyContextMatchBridgeRules({
    keywordTokens,
    usableContext,
    matchedTokenSet,
  })
  const matchedTokens = Array.from(matchedTokenSet)
  const specificMatchedTokens = matchedTokens.filter((t) => !BROAD_CONTEXT_MATCH_TOKENS.has(t))

  return {
    usableContext,
    matchedTokens,
    specificMatchedTokens,
    effectiveMatchCount: specificMatchedTokens.length > 0 ? matchedTokens.length : 0,
  }
}

export function inferQualityTier(score: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (score >= 70) return 'HIGH'
  if (score >= 45) return 'MEDIUM'
  return 'LOW'
}

export function computeKeywordRelevanceScore(params: {
  keyword: string
  source?: string
  pureBrandKeywords: string[]
  category?: string
  productName?: string
  relevance: { ok: boolean; mode: RelevanceMode; keywordTokens?: string[] }
}): number {
  const { keyword, source, pureBrandKeywords, category, productName, relevance } = params
  const keywordTokens = relevance.keywordTokens || normalizeRelevanceTokens(keyword)
  const words = normalizeKeywordWords(keyword)
  const repeatedWord = findRepeatedAdjacentWord(words)
  const transactionalHits = getTransactionalModifierHits(words)
  const uniqueTransactionalHits = new Set(transactionalHits).size

  let score = 35

  if (containsPureBrand(keyword, pureBrandKeywords)) {
    score += 25
  }

  if (relevance.mode === 'pure_brand') {
    score += 15
  } else {
    const contextMatchCount = computeContextMatchCount({
      keywordTokens,
      pureBrandKeywords,
      category,
      productName,
    })

    if (contextMatchCount >= 2) {
      score += 18
    } else if (contextMatchCount === 1) {
      score += 10
    } else if (relevance.mode === 'context_mismatch') {
      score -= 15
    } else {
      score -= 6
    }
  }

  score += getSourceTrustScore(source)

  if (repeatedWord) score -= 40
  if (uniqueTransactionalHits >= 2) score -= 24
  if (keywordTokens.length === 0 || keywordTokens.length > 8) score -= 6
  if (hasModelLikeToken(keywordTokens)) score += 4

  return Math.max(0, Math.min(100, score))
}

function hasModelLikeToken(keywordTokens: string[]): boolean {
  for (const token of keywordTokens) {
    if (!token) continue

    // Exclude pure years (e.g. 2024)
    if (/^\d{4}$/.test(token)) {
      const year = Number(token)
      if (year >= 1990 && year <= 2100) continue
    }

    // alpha-numeric mix (e.g. r2, r2-4k -> r2 + 4k)
    if (/[a-z]/i.test(token) && /\d/.test(token)) return true

    // numeric + unit letters (e.g. 2160p, 4k, 5g)
    if (/^\d{1,5}[a-z]{1,2}$/i.test(token)) return true
  }
  return false
}

export function isRelevantToOfferContext(params: {
  keyword: string
  pureBrandKeywords: string[]
  category?: string
  productName?: string
  minContextTokenMatches: number
}): { ok: boolean; reason?: string; mode: RelevanceMode; keywordTokens?: string[] } {
  const { keyword, pureBrandKeywords, category, productName, minContextTokenMatches } = params

  if (minContextTokenMatches <= 0) return { ok: true, mode: 'disabled' }

  // Pure brand keywords are always allowed (used for brand campaigns / navigation intent).
  if (isPureBrandKeyword(keyword, pureBrandKeywords)) return { ok: true, mode: 'pure_brand' }

  const keywordTokens = normalizeRelevanceTokens(keyword)
  if (hasModelLikeToken(keywordTokens)) return { ok: true, mode: 'model_like', keywordTokens }

  const safeCategory = sanitizeContextInput(category)
  const safeProductName = sanitizeContextInput(productName)
  const contextTokens = [
    ...normalizeRelevanceTokens(safeCategory),
    ...normalizeRelevanceTokens(safeProductName),
  ]

  // Remove brand tokens from context to avoid tautology ("rove ..." always matches).
  const brandTokens = new Set(pureBrandKeywords.flatMap((b) => normalizeRelevanceTokens(b)))
  const usableContext = Array.from(new Set(contextTokens)).filter((t) => !brandTokens.has(t))

  // If we don't have enough context to judge, don't filter to avoid false positives.
  if (usableContext.length < 3) return { ok: true, mode: 'insufficient_context', keywordTokens }

  const { effectiveMatchCount: matchCount } = computeContextMatchDetails({
    keywordTokens,
    pureBrandKeywords,
    category,
    productName,
  })

  if (matchCount >= minContextTokenMatches)
    return { ok: true, mode: 'context_match', keywordTokens }
  return {
    ok: false,
    mode: 'context_mismatch',
    reason: `与商品无关: "${keyword}" (未命中品类/商品token)`,
    keywordTokens,
  }
}
