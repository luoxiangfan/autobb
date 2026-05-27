import { getDatabase } from './db'
import type {
  CreativeKeywordUsagePlan,
  GeneratedAdCreativeData,
  GeneratedKeywordCandidateMetadata,
  HeadlineAsset,
  DescriptionAsset,
  QualityMetrics
} from './ad-creative'
import type { Offer } from './offers'
import { creativeCache, generateCreativeCacheKey } from './cache'
import { getKeywordSearchVolumesForPlannerContext } from './google-ads-accounts-auth'
import {
  clusterKeywordsByIntent,
  getBucketInfo,
  type OfferKeywordPool,
  type PoolKeywordData,
} from './offer-keyword-pool'  // 🔥 AI语义分类
import { generateContent, getGeminiMode, type ResponseSchema } from './gemini'
import { generateNegativeKeywords } from './keyword-generator'  // 🎯 新增：导入否定关键词生成函数
import { recordTokenUsage, estimateTokenCost } from './ai-token-tracker'  // 🎯 新增：导入token追踪函数
import { loadPrompt, interpolateTemplate } from './prompt-loader'  // 🎯 v3.0: 导入数据库prompt加载函数
import { calculateIntentScore, getIntentLevel } from './keyword-priority-classifier'  // 🎯 购买意图评分
import {
  normalizeGoogleAdsKeyword,
  deduplicateKeywordsWithPriority,
  logDuplicateKeywords
} from './google-ads-keyword-normalizer'  // 🔥 优化：Google Ads关键词标准化去重
import type {
  CreativeKeywordMatchType,
  KeywordAuditMetadata,
} from './creative-keyword-selection'
import { hasModelAnchorEvidence } from './creative-type'
import {
  getKeywordSourcePriorityScoreFromInput,
  inferKeywordDerivedTags,
  inferKeywordRawSource,
  normalizeKeywordSourceSubtype,
} from './creative-keyword-source-priority'
import {
  isCreativeKeywordAiSourceSubtypeEnabled,
  isCreativeKeywordSupplementThresholdGateEnabled,
} from './creative-keyword-feature-flags'
import { containsPureBrand, filterKeywordQuality, generateFilterReport, getPureBrandKeywords, shouldUseExactMatch, isBrandConcatenation, isBrandVariant, isSemanticQuery } from './keyword-quality-filter'  // 🔥 2025-12-28: 导入关键词质量过滤函数 🔥 2026-01-02: 补充导入纯品牌词函数 🔥 2026-01-05: 改为 shouldUseExactMatch 策略函数 🔥 2026-03-13: 补充导入品牌变体和语义查询过滤函数
import { isPureBrandKeyword } from './brand-keyword-utils'  // 🔥 2026-03-13: 导入纯品牌词判断函数
import { getMinContextTokenMatchesForKeywordQualityFilter } from './keyword-context-filter'
import {
  LANGUAGE_CODE_MAP,
  getLanguageName,
  getLanguageNameForCountry,
  normalizeCountryCode,
  normalizeLanguageCode
} from './language-country-codes'
import { repairJsonText } from './ai-json'
import { parsePrice } from './pricing-utils'
import {
  getGoogleAdsTextEffectiveLength,
  sanitizeGoogleAdsAdText,
  sanitizeGoogleAdsSymbols,
} from './google-ads-ad-text'
import { getLocalizedDkiOfficialSuffix, type DkiLocaleOptions } from './dki-localization'
import { classifyKeywordIntent } from './keyword-intent'
import { KEYWORD_POLICY, getRatioCappedCount, resolveNonBrandMinSearchVolumeByBrandKeywordCount } from './keyword-policy'
import { analyzeKeywordLanguageCompatibility } from './keyword-validity'
import {
  type GoogleAdsPolicyGuardMode,
  buildGoogleAdsPolicyPromptGuardrails,
  extractGoogleAdsPolicySensitiveTerms,
  resolveGoogleAdsPolicyGuardMode,
  sanitizeGoogleAdsPolicyText,
  sanitizeKeywordListForGoogleAdsPolicy,
  sanitizeKeywordObjectsForGoogleAdsPolicy
} from './google-ads-policy-guard'
import { createCreativeRuleContext, filterPromptExtrasByRelevance } from './ad-creative-rule-gate'

/**
 * 🔧 安全解析JSON字段
 * 处理 PostgreSQL jsonb 类型（自动解析为JS对象/数组）和 SQLite text 类型（需要JSON.parse）
 */
function safeParseJson(value: any, defaultValue: any = null): any {
  if (value === null || value === undefined) return defaultValue;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (e) {
      console.warn('[safeParseJson] 解析失败:', value);
      return defaultValue;
    }
  }
  return value; // 已经是对象/数组（PostgreSQL jsonb）
}

function deriveLinkTypeFromScrapedData(scrapedData: any): 'store' | 'product' | null {
  if (!scrapedData || typeof scrapedData !== 'object') return null
  const explicit = typeof scrapedData.pageType === 'string' ? scrapedData.pageType : null
  if (explicit === 'store' || explicit === 'product') return explicit
  const productsLen = Array.isArray(scrapedData.products) ? scrapedData.products.length : 0
  const hasStoreName = typeof scrapedData.storeName === 'string' && scrapedData.storeName.trim().length > 0
  const hasDeep = !!scrapedData.deepScrapeResults
  if (hasStoreName || hasDeep || productsLen >= 2) return 'store'
  return null
}

const PRICE_EVIDENCE_MISMATCH_THRESHOLD = 0.2
const SALES_RANK_PROMPT_MAX = 1000
const SALES_RANK_STRONG_SIGNAL_MAX = 100
const REVIEW_QUOTE_MIN_LENGTH = 8
const REVIEW_QUOTE_MAX_LENGTH = 90
const REVIEW_QUOTE_BLOCKLIST_PATTERN = /\b(cuz|awesome|ain't|gonna|kinda|sorta|wtf|omg|lol)\b/i
const RISKY_SOCIAL_PROOF_PERCENT_PATTERN =
  /\b\d{1,3}%\s+of\s+(?:women|men|users|people|customers)\s+(?:love|prefer|recommend|say|agree)\b/i

export type RetryFailureType = 'evidence_fail' | 'intent_fail' | 'format_fail'

export interface SearchTermFeedbackHintsInput {
  hardNegativeTerms?: string[]
  softSuppressTerms?: string[]
  highPerformingTerms?: string[]
}

interface PromptRuntimeGuidanceOptions {
  retryFailureType?: RetryFailureType
  searchTermFeedbackHints?: SearchTermFeedbackHintsInput
  policyGuardMode?: GoogleAdsPolicyGuardMode
  precomputedKeywordSet?: PrecomputedCreativeKeywordSet | null
}

interface PrecomputedCreativeKeywordSet {
  executableKeywords?: string[]
  promptKeywords?: string[]
  keywordsWithVolume?: Array<{
    keyword: string
    searchVolume: number
    source?: string
    sourceType?: string
    sourceSubtype?: string
    contractRole?: 'required' | 'optional' | 'fallback'
    evidenceStrength?: 'high' | 'medium' | 'low'
    matchType?: CreativeKeywordMatchType
    confidence?: number
  }>
}

export interface CreativePriceEvidenceResolution {
  currentPrice: string | null
  originalPrice: string | null
  discount: string | null
  priceEvidenceBlocked: boolean
  priceEvidenceWarning: string | null
  priceSource: 'offer_product_price' | 'offer_pricing_current' | 'scraped_data' | 'none'
}

export interface CreativeSalesRankSignal {
  raw: string | null
  normalizedRankText: string | null
  rankNumber: number | null
  eligibleForPrompt: boolean
  strongSignal: boolean
}

function toNonEmptyPriceText(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parsePriceAmount(value: string | null): number | null {
  if (!value) return null
  const direct = parsePrice(value)
  if (direct !== null) return direct
  const stripped = value.replace(/[A-Za-z]/g, '').trim()
  if (!stripped) return null
  return parsePrice(stripped)
}

export function resolveCreativeSalesRankSignal(value: unknown): CreativeSalesRankSignal {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) {
    return {
      raw: null,
      normalizedRankText: null,
      rankNumber: null,
      eligibleForPrompt: false,
      strongSignal: false
    }
  }

  const rankMatch = raw.match(/#\s*([\d,]+)/)
  if (!rankMatch?.[1]) {
    return {
      raw,
      normalizedRankText: null,
      rankNumber: null,
      eligibleForPrompt: false,
      strongSignal: false
    }
  }

  const rankNumber = Number.parseInt(rankMatch[1].replace(/,/g, ''), 10)
  if (!Number.isFinite(rankNumber) || rankNumber <= 0) {
    return {
      raw,
      normalizedRankText: null,
      rankNumber: null,
      eligibleForPrompt: false,
      strongSignal: false
    }
  }

  return {
    raw,
    normalizedRankText: `#${rankNumber.toLocaleString('en-US')}`,
    rankNumber,
    eligibleForPrompt: rankNumber <= SALES_RANK_PROMPT_MAX,
    strongSignal: rankNumber <= SALES_RANK_STRONG_SIGNAL_MAX
  }
}

function sanitizeReviewSnippetForPrompt(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim()

  if (normalized.length < REVIEW_QUOTE_MIN_LENGTH) return null

  const truncated = normalized.length > REVIEW_QUOTE_MAX_LENGTH
    ? `${normalized.slice(0, REVIEW_QUOTE_MAX_LENGTH - 3).trim()}...`
    : normalized

  if (REVIEW_QUOTE_BLOCKLIST_PATTERN.test(truncated)) return null
  if (RISKY_SOCIAL_PROOF_PERCENT_PATTERN.test(truncated)) return null

  return truncated
}

export function resolveCreativePriceEvidence(offer: any): CreativePriceEvidenceResolution {
  const pricingData = safeParseJson(offer?.pricing, null)
  const scrapedData = safeParseJson(offer?.scraped_data, null)

  const offerProductPrice = toNonEmptyPriceText(offer?.product_price)
  const offerPricingCurrent = toNonEmptyPriceText(pricingData?.current)
  const offerPricingOriginal = toNonEmptyPriceText(pricingData?.original)

  const scrapedCurrentPrice = toNonEmptyPriceText(scrapedData?.productPrice)
  const scrapedOriginalPrice = toNonEmptyPriceText(scrapedData?.originalPrice)
  const scrapedDiscount = toNonEmptyPriceText(scrapedData?.discount)

  const currentFromOffer = offerProductPrice || offerPricingCurrent
  const priceSource: CreativePriceEvidenceResolution['priceSource'] = offerProductPrice
    ? 'offer_product_price'
    : offerPricingCurrent
      ? 'offer_pricing_current'
      : scrapedCurrentPrice
        ? 'scraped_data'
        : 'none'

  let currentPrice = currentFromOffer || scrapedCurrentPrice || null
  let originalPrice = offerPricingOriginal || scrapedOriginalPrice || null
  let discount = scrapedDiscount || null
  let priceEvidenceBlocked = false
  let priceEvidenceWarning: string | null = null

  const offerPriceAmount = parsePriceAmount(currentFromOffer)
  const scrapedPriceAmount = parsePriceAmount(scrapedCurrentPrice)

  if (
    offerPriceAmount !== null &&
    scrapedPriceAmount !== null &&
    offerPriceAmount > 0
  ) {
    const ratio = Math.abs(scrapedPriceAmount - offerPriceAmount) / offerPriceAmount
    if (ratio > PRICE_EVIDENCE_MISMATCH_THRESHOLD) {
      const deviationPercent = Math.round(ratio * 100)
      priceEvidenceBlocked = true
      priceEvidenceWarning = `[PriceEvidenceGuard] Offer ${offer?.id ?? 'unknown'} detected conflicting prices: authoritative=${currentFromOffer}, scraped=${scrapedCurrentPrice}, deviation=${deviationPercent}%. Blocking price claims in creative output.`
      currentPrice = null
      originalPrice = null
      discount = null
    }
  }

  return {
    currentPrice,
    originalPrice,
    discount,
    priceEvidenceBlocked,
    priceEvidenceWarning,
    priceSource,
  }
}

interface TitleAboutSignals {
  productTitle: string
  titlePhrases: string[]
  aboutClaims: string[]
  keywordSeeds: string[]
  calloutIdeas: string[]
  sitelinkIdeas: Array<{ text: string; description: string }>
}

const PROMPT_KEYWORD_LIMIT = KEYWORD_POLICY.creative.promptKeywordLimit
const TITLE_ABOUT_SEED_RATIO_CAP = KEYWORD_POLICY.creative.titleAboutSeedRatioCap
const TOP_HEADLINE_SLOT_START_INDEX = 1
const TOP_HEADLINE_SLOT_COUNT = 3
const TOP_HEADLINE_MAX_LENGTH = 30
const TOP_HEADLINE_SEMANTIC_DUPLICATE_THRESHOLD = 0.78
const RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX = 4
const RETAINED_KEYWORD_HEADLINE_SLOT_COUNT = 3
const RETAINED_KEYWORD_DESCRIPTION_SLOT_START_INDEX = 0
const RETAINED_KEYWORD_DESCRIPTION_SLOT_COUNT = 2
const RETAINED_KEYWORD_HEADLINE_MAX_LENGTH = 30
const RETAINED_KEYWORD_DESCRIPTION_MAX_LENGTH = 90
const RETAINED_KEYWORD_PROTECTED_HEADLINE_COUNT = 4
const RETAINED_KEYWORD_PROTECTED_SIMILARITY_THRESHOLD = 0.82
const GOOGLE_ADS_HEADLINE_UNIQUENESS_SUFFIXES = ['Now', 'Today', 'Deals', 'Official', 'Shop'] as const
const LATIN_HEADLINE_STOPWORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with'
])

type HeadlineCandidateSource = 'title' | 'about'

interface BrandAnchoredHeadlineCandidate {
  text: string
  source: HeadlineCandidateSource
}

function normalizeSnippetText(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[•·]/g, ' ')
    .trim()
}

function truncateSnippetByWords(value: string, maxLength: number): string {
  const text = normalizeSnippetText(value)
  if (text.length <= maxLength) return text
  const words = text.split(/\s+/)
  let out = ''
  for (const word of words) {
    const next = out ? `${out} ${word}` : word
    if (next.length > maxLength) break
    out = next
  }
  return out.length >= 4 ? out : text.slice(0, maxLength).trim()
}

function isUsefulCreativePhrase(value: string, minLength: number = 4, maxLength: number = 90): boolean {
  const text = normalizeSnippetText(value)
  if (!text || text.length < minLength || text.length > maxLength) return false
  const lower = text.toLowerCase()
  if (lower === 'about this item' || lower === 'product details') return false
  return /[\p{L}\p{N}]/u.test(text)
}

function dedupeKeywordSeeds(keywords: string[], limit: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  for (const raw of keywords) {
    const cleaned = normalizeSnippetText(raw)
      .replace(/[^\p{L}\p{N}\s&/-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!isUsefulCreativePhrase(cleaned, 3, 80)) continue

    const normalized = normalizeGoogleAdsKeyword(cleaned)
    if (!normalized || seen.has(normalized)) continue

    seen.add(normalized)
    out.push(cleaned)
    if (out.length >= limit) break
  }

  return out
}

function filterHighIntentKeywordSeeds(keywords: string[], language: string): string[] {
  return keywords.filter((keyword) => {
    const intentInfo = classifyKeywordIntent(keyword, { language })
    if (intentInfo.hardNegative) return false
    return intentInfo.intent === 'TRANSACTIONAL' || intentInfo.intent === 'COMMERCIAL'
  })
}

function getSeedCapByRatio(validatedKeywordCount: number): number {
  if (validatedKeywordCount <= 0) return 0
  // seed/(validated+seed) <= 20%  => seed <= validated * 0.25
  return Math.floor(validatedKeywordCount * (TITLE_ABOUT_SEED_RATIO_CAP / (1 - TITLE_ABOUT_SEED_RATIO_CAP)))
}

function filterPhrasesByTargetLanguageGate(params: {
  phrases: string[]
  targetLanguage?: string | null
  pureBrandKeywords: string[]
}): { phrases: string[]; removedCount: number } {
  const targetLanguage = String(params.targetLanguage || '').trim()
  const out: string[] = []
  const seen = new Set<string>()
  let removedCount = 0

  for (const phrase of params.phrases || []) {
    const raw = String(phrase || '').trim()
    const normalized = normalizeGoogleAdsKeyword(raw)
    if (!raw || !normalized) continue
    if (seen.has(normalized)) continue

    if (targetLanguage) {
      const compatibility = analyzeKeywordLanguageCompatibility({
        keyword: raw,
        targetLanguage,
        pureBrandKeywords: params.pureBrandKeywords,
      })
      if (compatibility.hardReject) {
        removedCount += 1
        continue
      }
    }

    seen.add(normalized)
    out.push(raw)
  }

  return { phrases: out, removedCount }
}

export interface AdCreativePromptKeywordPlan {
  promptKeywords: string[]
  validatedPromptKeywords: string[]
  contextualPromptKeywords: string[]
  policyMatchedTerms: string[]
}

export function resolveAdCreativePromptKeywordPlan(input: {
  extractedKeywords?: Array<{ keyword?: string | null } | string>
  aiKeywords?: string[]
  titleAboutKeywordSeeds?: string[]
  offerBrand?: string | null
  targetLanguage?: string | null
  policyGuardMode?: GoogleAdsPolicyGuardMode
}): AdCreativePromptKeywordPlan {
  const policyGuardMode = resolveGoogleAdsPolicyGuardMode(input.policyGuardMode)
  const brandGateKeywords = getPureBrandKeywords(input.offerBrand || '')
  const brandFilter = (keyword: string) =>
    brandGateKeywords.length === 0 || containsPureBrand(keyword, brandGateKeywords)

  const extractedKeywords = Array.isArray(input.extractedKeywords)
    ? input.extractedKeywords
    : []
  const aiKeywords = Array.isArray(input.aiKeywords)
    ? input.aiKeywords
    : []
  const titleAboutKeywordSeeds = Array.isArray(input.titleAboutKeywordSeeds)
    ? input.titleAboutKeywordSeeds
    : []

  const rawBaseKeywordsForPrompt = extractedKeywords.length > 0
    ? extractedKeywords.map((item: any) => typeof item === 'string' ? item : item?.keyword)
    : aiKeywords.filter(brandFilter).slice(0, 15)
  const baseKeywordsPolicySafe = sanitizeKeywordListForGoogleAdsPolicy(
    rawBaseKeywordsForPrompt,
    { mode: policyGuardMode }
  )
  const baseKeywordsLanguageSafe = filterPhrasesByTargetLanguageGate({
    phrases: baseKeywordsPolicySafe.items,
    targetLanguage: input.targetLanguage,
    pureBrandKeywords: brandGateKeywords,
  })

  const validatedPromptKeywords = dedupeKeywordSeeds(
    baseKeywordsLanguageSafe.phrases,
    PROMPT_KEYWORD_LIMIT
  )
  const titleAboutSeedsPolicySafe = sanitizeKeywordListForGoogleAdsPolicy(
    titleAboutKeywordSeeds,
    { mode: policyGuardMode }
  )
  const titleAboutSeedsLanguageSafe = filterPhrasesByTargetLanguageGate({
    phrases: titleAboutSeedsPolicySafe.items,
    targetLanguage: input.targetLanguage,
    pureBrandKeywords: brandGateKeywords,
  })
  const highIntentTitleAboutSeeds = dedupeKeywordSeeds(
    filterHighIntentKeywordSeeds(
      titleAboutSeedsLanguageSafe.phrases,
      String(input.targetLanguage || 'English')
    ),
    PROMPT_KEYWORD_LIMIT
  )

  const maxSeedByTotalLimit = Math.floor(PROMPT_KEYWORD_LIMIT * TITLE_ABOUT_SEED_RATIO_CAP)
  const maxSeedByRatio = getSeedCapByRatio(validatedPromptKeywords.length)
  const contextualPromptKeywords = highIntentTitleAboutSeeds.slice(
    0,
    Math.max(0, Math.min(maxSeedByTotalLimit, maxSeedByRatio))
  )

  return {
    promptKeywords: dedupeKeywordSeeds(
      [...validatedPromptKeywords, ...contextualPromptKeywords],
      PROMPT_KEYWORD_LIMIT
    ),
    validatedPromptKeywords,
    contextualPromptKeywords,
    policyMatchedTerms: Array.from(new Set([
      ...baseKeywordsPolicySafe.matchedTerms,
      ...titleAboutSeedsPolicySafe.matchedTerms
    ])).slice(0, 12),
  }
}

function countBrandContainingKeywords(
  keywords: Array<{ keyword: string; searchVolume?: number }>,
  brandName: string,
  brandTokensToMatch: string[]
): number {
  if (!Array.isArray(keywords) || keywords.length === 0) return 0
  return keywords.filter((kw) => {
    const keyword = String(kw.keyword || '').trim()
    if (!keyword) return false
    if (containsPureBrand(keyword, brandTokensToMatch)) return true
    return typeof kw.searchVolume === 'number' && kw.searchVolume > 0 && isBrandConcatenation(keyword, brandName)
  }).length
}

function extractTitleAndAboutSignals(
  productTitleRaw: string | null | undefined,
  aboutItemsRaw: string[] | null | undefined,
  options?: {
    targetLanguage?: string | null
    brandName?: string | null
  }
): TitleAboutSignals {
  const productTitle = normalizeSnippetText(productTitleRaw || '')
  const titlePhrases: string[] = []
  const aboutClaims: string[] = []
  const keywordSeeds: string[] = []
  const calloutIdeas: string[] = []
  const sitelinkIdeas: Array<{ text: string; description: string }> = []

  const addUniquePhrase = (target: string[], value: string, maxItems: number, minLength: number = 4, maxLength: number = 90) => {
    const normalized = normalizeSnippetText(value)
    if (!isUsefulCreativePhrase(normalized, minLength, maxLength)) return
    const key = normalized.toLowerCase()
    if (target.some(item => item.toLowerCase() === key)) return
    target.push(normalized)
    if (target.length > maxItems) target.length = maxItems
  }

  const addKeywordSeed = (value: string) => {
    const cleaned = truncateSnippetByWords(value, 70)
    if (!cleaned) return
    keywordSeeds.push(cleaned)
  }

  const addSitelinkIdea = (text: string, description: string) => {
    const linkText = truncateSnippetByWords(text, 25)
    const linkDescription = truncateSnippetByWords(description, 35)
    if (!isUsefulCreativePhrase(linkText, 3, 25) || !isUsefulCreativePhrase(linkDescription, 4, 35)) return
    const key = `${linkText.toLowerCase()}__${linkDescription.toLowerCase()}`
    if (sitelinkIdeas.some(item => `${item.text.toLowerCase()}__${item.description.toLowerCase()}` === key)) return
    sitelinkIdeas.push({ text: linkText, description: linkDescription })
  }

  if (productTitle) {
    addKeywordSeed(productTitle)
    addUniquePhrase(titlePhrases, truncateSnippetByWords(productTitle, 70), 6, 6, 80)

    const titleSegments = productTitle
      .split(/\s*[|:,\-–—]\s*/g)
      .map(segment => truncateSnippetByWords(segment, 60))
      .filter(Boolean)

    for (const segment of titleSegments) {
      addUniquePhrase(titlePhrases, segment, 6, 5, 60)
      addKeywordSeed(segment)
      if (titlePhrases.length >= 6) break
    }
  }

  const aboutItems = Array.isArray(aboutItemsRaw) ? aboutItemsRaw : []
  for (const raw of aboutItems.slice(0, 8)) {
    const item = normalizeSnippetText(raw || '')
    if (!item) continue

    const colonIndex = item.indexOf(':')
    const label = colonIndex > 0 ? item.slice(0, colonIndex).trim() : ''
    const body = colonIndex > 0 ? item.slice(colonIndex + 1).trim() : item
    const firstClause = body.split(/[.!?;|]/)[0]?.trim() || body
    const compactClaim = truncateSnippetByWords(firstClause, 120)

    if (label) {
      addUniquePhrase(aboutClaims, truncateSnippetByWords(label, 60), 6, 4, 60)
      addKeywordSeed(label)
      addUniquePhrase(calloutIdeas, truncateSnippetByWords(label, 25), 6, 3, 25)
      addSitelinkIdea(label, compactClaim)
    }

    addUniquePhrase(aboutClaims, compactClaim, 6, 8, 120)
    addKeywordSeed(compactClaim)

    const shortClaim = truncateSnippetByWords(firstClause, 35)
    if (shortClaim && shortClaim.length >= 8) {
      addSitelinkIdea(label || shortClaim, shortClaim)
    }
  }

  const pureBrandKeywords = getPureBrandKeywords(options?.brandName || '')
  const languageSafeTitle = filterPhrasesByTargetLanguageGate({
    phrases: productTitle ? [productTitle] : [],
    targetLanguage: options?.targetLanguage,
    pureBrandKeywords,
  }).phrases[0] || ''
  const languageSafeTitlePhrases = filterPhrasesByTargetLanguageGate({
    phrases: titlePhrases,
    targetLanguage: options?.targetLanguage,
    pureBrandKeywords,
  }).phrases
  const languageSafeAboutClaims = filterPhrasesByTargetLanguageGate({
    phrases: aboutClaims,
    targetLanguage: options?.targetLanguage,
    pureBrandKeywords,
  }).phrases
  const languageSafeKeywordSeeds = filterPhrasesByTargetLanguageGate({
    phrases: dedupeKeywordSeeds(keywordSeeds, 24),
    targetLanguage: options?.targetLanguage,
    pureBrandKeywords,
  }).phrases
  const languageSafeCallouts = filterPhrasesByTargetLanguageGate({
    phrases: calloutIdeas.slice(0, 6),
    targetLanguage: options?.targetLanguage,
    pureBrandKeywords,
  }).phrases
  const languageSafeSitelinks = sitelinkIdeas
    .slice(0, 6)
    .filter((item) => {
      const textSafe = filterPhrasesByTargetLanguageGate({
        phrases: [item.text],
        targetLanguage: options?.targetLanguage,
        pureBrandKeywords,
      }).phrases.length > 0
      const descriptionSafe = filterPhrasesByTargetLanguageGate({
        phrases: [item.description],
        targetLanguage: options?.targetLanguage,
        pureBrandKeywords,
      }).phrases.length > 0
      return textSafe && descriptionSafe
    })

  return {
    productTitle: languageSafeTitle,
    titlePhrases: languageSafeTitlePhrases,
    aboutClaims: languageSafeAboutClaims,
    keywordSeeds: languageSafeKeywordSeeds,
    calloutIdeas: languageSafeCallouts,
    sitelinkIdeas: languageSafeSitelinks,
  }
}

function normalizeHeadlineCandidateText(value: string): string {
  return normalizeSnippetText(value)
    .replace(/[{}]/g, '')
    .replace(/[•|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function shouldSplitTitleSegmentAt(raw: string, index: number): boolean {
  const char = raw[index]
  if (char === '|' || char === ':' || char === ';') return true
  if (char !== ',') return false

  const prev = raw[index - 1] || ''
  const next = raw[index + 1] || ''
  if (/\d/.test(prev) && /\d/.test(next)) {
    return false
  }
  return true
}

function splitTitleSegmentsSafely(title: string): string[] {
  const raw = String(title || '').trim()
  if (!raw) return []

  const segments: string[] = []
  let start = 0
  for (let index = 0; index < raw.length; index += 1) {
    if (!shouldSplitTitleSegmentAt(raw, index)) continue
    const segment = normalizeHeadlineCandidateText(raw.slice(start, index))
    if (segment) segments.push(segment)
    start = index + 1
  }

  const tail = normalizeHeadlineCandidateText(raw.slice(start))
  if (tail) segments.push(tail)
  return segments
}

function trimTextToWordBoundary(text: string, maxLength: number): string {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  if (maxLength <= 0) return ''

  let truncated = normalized.slice(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')
  if (lastSpace >= Math.max(6, Math.floor(maxLength * 0.55))) {
    truncated = truncated.slice(0, lastSpace)
  }

  return truncated.replace(/\s+/g, ' ').trim()
}

function dropDanglingTailFragment(text: string): string {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return normalized
  const parts = normalized.split(' ')
  if (parts.length < 2) return normalized

  const tail = parts[parts.length - 1]
  const tailLetters = tail.replace(/[^\p{L}]/gu, '')
  if (tailLetters.length <= 2 && !/[.!?]$/.test(normalized)) {
    return parts.slice(0, -1).join(' ').trim()
  }
  return normalized
}

function balanceHeadlineParentheses(text: string): string {
  let normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return normalized

  let open = (normalized.match(/\(/g) || []).length
  let close = (normalized.match(/\)/g) || []).length
  if (open === close) return normalized

  if (open > close) {
    let toRemove = open - close
    for (let i = normalized.length - 1; i >= 0 && toRemove > 0; i -= 1) {
      if (normalized[i] !== '(') continue
      normalized = `${normalized.slice(0, i)}${normalized.slice(i + 1)}`
      toRemove -= 1
    }
  } else {
    let toRemove = close - open
    for (let i = normalized.length - 1; i >= 0 && toRemove > 0; i -= 1) {
      if (normalized[i] !== ')') continue
      normalized = `${normalized.slice(0, i)}${normalized.slice(i + 1)}`
      toRemove -= 1
    }
  }

  return normalized.replace(/\s+/g, ' ').trim()
}

function stripHeadlineTrailingPunctuation(text: string): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[;,.:|/&+\-]+$/g, '')
    .trim()
}

function trimDanglingHeadlineTailToken(text: string): string {
  let normalized = stripHeadlineTrailingPunctuation(text)
  if (!normalized) return normalized

  for (let i = 0; i < 2; i += 1) {
    const parts = normalized.split(/\s+/).filter(Boolean)
    if (parts.length < 2) break

    const tailToken = parts[parts.length - 1]
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, '')

    if (!tailToken || !HEADLINE_DANGLING_TAIL_TOKENS.has(tailToken)) {
      break
    }

    normalized = stripHeadlineTrailingPunctuation(parts.slice(0, -1).join(' '))
  }

  return normalized
}

function applyHeadlineTextGuardrail(text: string, maxLength: number): string {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return normalized

  const hasDki = /\{KeyWord:[^}]*\}/i.test(normalized)
  if (hasDki && getGoogleAdsTextEffectiveLength(normalized) > maxLength) {
    const match = normalized.match(/\{KeyWord:([^}]*)\}/i)
    if (match) {
      return buildDkiKeywordHeadline(match[1], maxLength)
    }
  }

  let output = normalized
  if (!hasDki && output.length > maxLength) {
    output = trimTextToWordBoundary(output, maxLength)
    output = dropDanglingTailFragment(output)
  }

  if (!hasDki) {
    const cleanedTail = trimDanglingHeadlineTailToken(output)
    if (cleanedTail) output = cleanedTail
  }

  output = balanceHeadlineParentheses(output)
  return output.replace(/\s+/g, ' ').trim()
}

function stripHeadlineNumericSuffixArtifact(text: string): string {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return normalized
  // Historical dedupe fallback used one-digit numeric suffixes (e.g. "Headline 2").
  // Keep legitimate product specs like "12 inch" / "14 inch" intact.
  const match = normalized.match(/^(.*\D)\s([2-9])$/)
  if (!match) return normalized
  const base = match[1].trim()
  if (base.length < 8) return normalized
  return base
}

function applyDescriptionTextGuardrail(text: string, maxLength: number): string {
  let normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return normalized
  if (normalized.length > maxLength) {
    normalized = trimTextToWordBoundary(normalized, maxLength)
    normalized = dropDanglingTailFragment(normalized)
  }

  normalized = normalized.replace(/[;,:-]\s*$/g, '').trim()
  if (normalized && !/[.!?]$/.test(normalized)) {
    if (normalized.length + 1 <= maxLength) {
      normalized = `${normalized}.`
    }
  }

  return normalized.replace(/\s+/g, ' ').trim()
}

function isHeadlineCompatibleWithTargetLanguage(text: string, targetLanguage: string | null | undefined): boolean {
  const language = normalizeLanguageCode(targetLanguage || 'en')
  if (!text) return false
  if (language === 'zh') return /[\p{Script=Han}]/u.test(text)
  if (language === 'ja') return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text)
  if (language === 'ko') return /[\p{Script=Hangul}]/u.test(text)
  if (language === 'ar') return /[\p{Script=Arabic}]/u.test(text)
  if (language === 'ru') return /[\p{Script=Cyrillic}]/u.test(text)
  if (LATIN_SOFT_COPY_LANGUAGES.includes(language as SupportedSoftCopyLanguage) && language !== 'en') {
    if (isLikelyCrossLanguageLatinAsset(text, language as SupportedSoftCopyLanguage)) {
      return false
    }
  }
  return true
}

function normalizeBrandNameForHeadline(brandName: string): string {
  return normalizeSnippetText(String(brandName || ''))
    .replace(/[{}]/g, '')
    .trim()
}

function hasBrandAnchorInHeadline(text: string, brandName: string, brandTokensToMatch: string[]): boolean {
  if (!text) return false
  if (brandTokensToMatch.length > 0) {
    return containsPureBrand(text, brandTokensToMatch)
  }
  const normalizedBrand = normalizeBrandNameForHeadline(brandName)
  if (!normalizedBrand) return true
  return text.toLowerCase().includes(normalizedBrand.toLowerCase())
}

function stripRepeatedBrandPrefix(text: string, brandName: string): string {
  const normalizedBrand = normalizeBrandNameForHeadline(brandName)
  if (!normalizedBrand) return normalizeHeadlineCandidateText(text)
  const repeatedPattern = new RegExp(`^(?:${escapeRegex(normalizedBrand)}\\s+){2,}`, 'i')
  return normalizeHeadlineCandidateText(text).replace(repeatedPattern, `${normalizedBrand} `).trim()
}

function compressLatinHeadline(text: string): string {
  let compact = normalizeHeadlineCandidateText(text)
    .replace(/\(([^)]{1,24})\)/g, ' $1 ')
    .replace(/\b(\d+)\s*(?:pack|packs|pk|pcs?|count)\b/gi, '$1pk')
    .replace(/\b(\d+)\s*ft\b/gi, '$1FT')
    .replace(/\b(\d+)\s*inch\b/gi, '$1in')
    .replace(/\b(\d+)\s*watts?\b/gi, '$1W')
    .replace(/\b(\d+)\s*lumens?\b/gi, '$1LM')
    .replace(/\bequivalent\b/gi, 'Eqv')
    .replace(/\s+/g, ' ')
    .trim()

  if (!/[A-Za-z]/.test(compact)) return compact

  const words = compact.split(/\s+/).filter(Boolean)
  const filtered = words.filter((word, index) => {
    if (index === 0) return true
    const normalized = word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
    if (!normalized) return false
    return !LATIN_HEADLINE_STOPWORDS.has(normalized)
  })
  if (filtered.length >= 2) {
    compact = filtered.join(' ')
  }
  return compact
}

function isLowValueHeadlineCandidate(text: string, brandName: string): boolean {
  const withoutBrand = normalizeHeadline2KeywordCandidate(normalizeBrandFreeText(text, brandName))
  if (!withoutBrand) return true
  const normalized = withoutBrand.toLowerCase()
  if (/^(?:\d+(?:pk|pack|pcs?|count)|white|black|silver|gray|grey|blue|red)$/i.test(normalized)) {
    return true
  }
  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length <= 1 && tokens[0] && tokens[0].length <= 3) return true
  return false
}

function fitBrandAnchoredHeadline(
  rawText: string,
  brandName: string,
  brandTokensToMatch: string[],
  maxLength: number
): string | null {
  const normalizedBrand = normalizeBrandNameForHeadline(brandName)
  let seed = normalizeHeadlineCandidateText(rawText)
  if (!seed) return null

  if (!hasBrandAnchorInHeadline(seed, normalizedBrand, brandTokensToMatch) && normalizedBrand) {
    seed = `${normalizedBrand} ${seed}`
  }
  seed = stripRepeatedBrandPrefix(seed, normalizedBrand)

  const candidateVariants = [
    seed,
    compressLatinHeadline(seed),
    fitLocalizedHeadline(seed, maxLength),
    fitLocalizedHeadline(compressLatinHeadline(seed), maxLength),
  ]

  for (const variant of candidateVariants) {
    let candidate = normalizeHeadlineCandidateText(variant)
    if (!candidate) continue
    if (candidate.length > maxLength) {
      candidate = fitLocalizedHeadline(candidate, maxLength)
    }
    candidate = stripRepeatedBrandPrefix(candidate, normalizedBrand)
    if (!candidate || candidate.length > maxLength) continue

    if (!hasBrandAnchorInHeadline(candidate, normalizedBrand, brandTokensToMatch) && normalizedBrand) {
      candidate = fitLocalizedHeadline(`${normalizedBrand} ${candidate}`, maxLength)
      candidate = stripRepeatedBrandPrefix(candidate, normalizedBrand)
    }

    if (!candidate || candidate.length > maxLength) continue
    if (!hasBrandAnchorInHeadline(candidate, normalizedBrand, brandTokensToMatch)) continue
    if (isLowValueHeadlineCandidate(candidate, normalizedBrand)) continue
    return candidate
  }

  return null
}

function isSemanticallyDuplicateHeadline(candidate: string, existing: string[], brandName: string): boolean {
  const candidateCore = normalizeGoogleAdsKeyword(normalizeBrandFreeText(candidate, brandName) || candidate)
  if (!candidateCore) return false

  for (const current of existing) {
    const currentCore = normalizeGoogleAdsKeyword(normalizeBrandFreeText(current, brandName) || current)
    if (!currentCore) continue
    if (candidateCore === currentCore) return true
    if (
      (candidateCore.length >= 8 && candidateCore.includes(currentCore)) ||
      (currentCore.length >= 8 && currentCore.includes(candidateCore))
    ) {
      return true
    }
    if (calculateTextSimilarity(candidateCore, currentCore) >= TOP_HEADLINE_SEMANTIC_DUPLICATE_THRESHOLD) {
      return true
    }
  }

  return false
}

function collectUniqueHeadlineCandidates(
  rawCandidates: string[],
  source: HeadlineCandidateSource,
  options: {
    brandName: string
    brandTokensToMatch: string[]
    maxLength: number
    targetLanguage?: string | null
    limit: number
  }
): BrandAnchoredHeadlineCandidate[] {
  const out: BrandAnchoredHeadlineCandidate[] = []
  const seen = new Set<string>()

  for (const raw of rawCandidates) {
    const fitted = fitBrandAnchoredHeadline(raw, options.brandName, options.brandTokensToMatch, options.maxLength)
    if (!fitted) continue
    if (!isHeadlineCompatibleWithTargetLanguage(fitted, options.targetLanguage)) continue

    const normalized = normalizeGoogleAdsKeyword(normalizeBrandFreeText(fitted, options.brandName) || fitted)
    if (!normalized || seen.has(normalized)) continue
    if (isSemanticallyDuplicateHeadline(fitted, out.map((item) => item.text), options.brandName)) continue

    seen.add(normalized)
    out.push({ text: fitted, source })
    if (out.length >= options.limit) break
  }

  return out
}

function extractTitlePriorityHeadlineCandidates(options: {
  productTitle?: string | null
  brandName: string
  brandTokensToMatch: string[]
  targetLanguage?: string | null
  maxLength: number
  limit: number
}): BrandAnchoredHeadlineCandidate[] {
  const title = normalizeHeadlineCandidateText(options.productTitle || '')
  if (!isUsefulCreativePhrase(title, 5, 240)) return []

  const rawCandidates: string[] = [title]
  const titleWords = title.split(/\s+/).filter(Boolean)
  for (const take of [4, 5, 6, 7, 8]) {
    if (titleWords.length >= take) {
      rawCandidates.push(titleWords.slice(0, take).join(' '))
    }
  }

  const titleSegments = splitTitleSegmentsSafely(title)
    .filter((segment) => isUsefulCreativePhrase(segment, 4, 140))

  for (const segment of titleSegments) {
    rawCandidates.push(segment)
    const splitBySlash = segment
      .split(/\s*(?:\/|\+)\s*/g)
      .map((part) => normalizeHeadlineCandidateText(part))
      .filter((part) => isUsefulCreativePhrase(part, 4, 90))
    rawCandidates.push(...splitBySlash)
  }

  for (let i = 0; i < titleSegments.length - 1; i += 1) {
    rawCandidates.push(`${titleSegments[i]} ${titleSegments[i + 1]}`)
  }

  return collectUniqueHeadlineCandidates(rawCandidates, 'title', {
    brandName: options.brandName,
    brandTokensToMatch: options.brandTokensToMatch,
    maxLength: options.maxLength,
    targetLanguage: options.targetLanguage,
    limit: options.limit,
  })
}

function extractAboutFeatureHeadlineCandidates(options: {
  aboutItems?: string[] | null
  brandName: string
  brandTokensToMatch: string[]
  targetLanguage?: string | null
  maxLength: number
  limit: number
}): BrandAnchoredHeadlineCandidate[] {
  const items = Array.isArray(options.aboutItems) ? options.aboutItems : []
  if (items.length === 0) return []

  const rawCandidates: string[] = []
  for (const raw of items.slice(0, 10)) {
    const item = normalizeHeadlineCandidateText(raw || '')
    if (!item) continue

    const colonIndex = item.indexOf(':')
    const label = colonIndex > 0 ? normalizeHeadlineCandidateText(item.slice(0, colonIndex)) : ''
    const body = colonIndex > 0 ? normalizeHeadlineCandidateText(item.slice(colonIndex + 1)) : item
    const firstClause = normalizeHeadlineCandidateText(body.split(/[.!?;|]/)[0] || body)

    if (label) rawCandidates.push(label)
    if (firstClause) rawCandidates.push(firstClause)
    if (body && body !== firstClause) {
      rawCandidates.push(truncateSnippetByWords(body, 70))
    }
  }

  return collectUniqueHeadlineCandidates(rawCandidates, 'about', {
    brandName: options.brandName,
    brandTokensToMatch: options.brandTokensToMatch,
    maxLength: options.maxLength,
    targetLanguage: options.targetLanguage,
    limit: options.limit,
  })
}

function buildBrandAnchoredTopHeadlines(options: {
  productTitle?: string | null
  aboutItems?: string[] | null
  brandName: string
  brandTokensToMatch: string[]
  targetLanguage?: string | null
  maxLength: number
  targetCount: number
}): BrandAnchoredHeadlineCandidate[] {
  const selected: BrandAnchoredHeadlineCandidate[] = []
  const titleCandidates = extractTitlePriorityHeadlineCandidates({
    productTitle: options.productTitle,
    brandName: options.brandName,
    brandTokensToMatch: options.brandTokensToMatch,
    targetLanguage: options.targetLanguage,
    maxLength: options.maxLength,
    limit: Math.max(options.targetCount * 3, 6),
  })

  for (const candidate of titleCandidates) {
    if (isSemanticallyDuplicateHeadline(candidate.text, selected.map((item) => item.text), options.brandName)) continue
    selected.push(candidate)
    if (selected.length >= options.targetCount) {
      return selected.slice(0, options.targetCount)
    }
  }

  const aboutCandidates = extractAboutFeatureHeadlineCandidates({
    aboutItems: options.aboutItems,
    brandName: options.brandName,
    brandTokensToMatch: options.brandTokensToMatch,
    targetLanguage: options.targetLanguage,
    maxLength: options.maxLength,
    limit: Math.max(options.targetCount * 3, 6),
  })

  for (const candidate of aboutCandidates) {
    if (isSemanticallyDuplicateHeadline(candidate.text, selected.map((item) => item.text), options.brandName)) continue
    selected.push(candidate)
    if (selected.length >= options.targetCount) break
  }

  return selected.slice(0, options.targetCount)
}

function syncHeadlineMetadataSlot(
  result: GeneratedAdCreativeData,
  index: number,
  headlineText: string
): void {
  if (!Array.isArray(result.headlinesWithMetadata)) return

  while (result.headlinesWithMetadata.length <= index) {
    const fallbackText = result.headlines[result.headlinesWithMetadata.length] || ''
    result.headlinesWithMetadata.push({
      text: fallbackText,
      length: Math.min(TOP_HEADLINE_MAX_LENGTH, fallbackText.length),
    })
  }

  const existing = result.headlinesWithMetadata[index]
  result.headlinesWithMetadata[index] = {
    ...existing,
    text: headlineText,
    length: Math.min(TOP_HEADLINE_MAX_LENGTH, headlineText.length),
    type: existing?.type || 'feature',
  }
}

function syncDescriptionMetadataSlot(
  result: GeneratedAdCreativeData,
  index: number,
  descriptionText: string
): void {
  if (!Array.isArray(result.descriptionsWithMetadata)) return

  while (result.descriptionsWithMetadata.length <= index) {
    const fallbackText = result.descriptions[result.descriptionsWithMetadata.length] || ''
    result.descriptionsWithMetadata.push({
      text: fallbackText,
      length: Math.min(90, fallbackText.length),
      hasCTA: getCtaRegexForLanguage('en').test(fallbackText),
    })
  }

  const existing = result.descriptionsWithMetadata[index]
  result.descriptionsWithMetadata[index] = {
    ...existing,
    text: descriptionText,
    length: Math.min(90, descriptionText.length),
    hasCTA: existing?.hasCTA ?? getCtaRegexForLanguage('en').test(descriptionText),
  }
}

export function enforceTitlePriorityTopHeadlines(
  result: GeneratedAdCreativeData,
  options: {
    brandName: string
    brandTokensToMatch?: string[]
    productTitle?: string | null
    aboutItems?: string[] | null
    targetLanguage?: string | null
    slotStartIndex?: number
    slotCount?: number
    maxLength?: number
  }
): { replaced: number; selected: string[]; titleCount: number; aboutCount: number } {
  const headlines = [...(result.headlines || [])]
  const slotStartIndex = Math.max(1, options.slotStartIndex ?? TOP_HEADLINE_SLOT_START_INDEX)
  const slotCount = Math.max(1, options.slotCount ?? TOP_HEADLINE_SLOT_COUNT)
  const maxLength = Math.max(10, options.maxLength ?? TOP_HEADLINE_MAX_LENGTH)
  const slotEndExclusive = Math.min(headlines.length, slotStartIndex + slotCount)
  const normalizedBrand = normalizeBrandNameForHeadline(options.brandName)
  const brandTokensToMatch = Array.isArray(options.brandTokensToMatch) && options.brandTokensToMatch.length > 0
    ? options.brandTokensToMatch
    : getPureBrandKeywords(normalizedBrand)

  if (!normalizedBrand || slotEndExclusive <= slotStartIndex) {
    return { replaced: 0, selected: [], titleCount: 0, aboutCount: 0 }
  }

  const selectedCandidates = buildBrandAnchoredTopHeadlines({
    productTitle: options.productTitle,
    aboutItems: options.aboutItems,
    brandName: normalizedBrand,
    brandTokensToMatch,
    targetLanguage: options.targetLanguage,
    maxLength,
    targetCount: slotCount,
  })

  if (selectedCandidates.length === 0) {
    return { replaced: 0, selected: [], titleCount: 0, aboutCount: 0 }
  }

  let replaced = 0
  for (let index = slotStartIndex; index < slotEndExclusive; index += 1) {
    const candidate = selectedCandidates[index - slotStartIndex]
    if (!candidate) break
    if (headlines[index] !== candidate.text) {
      headlines[index] = candidate.text
      replaced += 1
    }
    syncHeadlineMetadataSlot(result, index, candidate.text)
  }

  result.headlines = headlines

  return {
    replaced,
    selected: selectedCandidates.map((item) => item.text),
    titleCount: selectedCandidates.filter((item) => item.source === 'title').length,
    aboutCount: selectedCandidates.filter((item) => item.source === 'about').length,
  }
}

type SupportedSoftCopyLanguage = 'en' | 'fr' | 'de' | 'es' | 'it' | 'pt' | 'zh' | 'ja' | 'ko' | 'ru' | 'ar'

interface CopyPatternSet {
  transactional: RegExp
  trust: RegExp
  scenario: RegExp
  solution: RegExp
  pain: RegExp
  cta: RegExp
  ctaPhrases: string[]
}

const EN_CTA_REGEX = /shop now|buy now|learn more|get|order|sign up|try|start/i
const EN_CTA_PHRASES = [
  'Shop Now',
  'Buy Now',
  'Learn More',
  'Order Now',
  'Get Yours',
  'Try Now',
  'Start Now',
  'Sign Up'
]

const FR_CTA_REGEX = /acheter maintenant|acheter|commander|en savoir plus|inscrivez-vous|essayer|commencer|obtenir|découvrir|magasiner/i
const FR_CTA_PHRASES = [
  'Acheter maintenant',
  'Commander',
  'En savoir plus',
  'Découvrir',
  'Obtenir'
]

const DE_CTA_REGEX = /jetzt kaufen|kaufen|bestellen|mehr erfahren|anmelden|testen|starten|entdecken|sparen|sichern|holen/i
const DE_CTA_PHRASES = [
  'Jetzt kaufen',
  'Bestellen',
  'Mehr erfahren',
  'Entdecken',
  'Sichern'
]

const ES_CTA_REGEX = /comprar ahora|comprar|pedir|más información|mas informacion|registrarse|probar|empezar|descubrir|ahorrar|obtener|solicitar/i
const ES_CTA_PHRASES = [
  'Comprar ahora',
  'Pedir',
  'Más información',
  'Descubrir',
  'Obtener'
]

const IT_CTA_REGEX = /acquista ora|acquista|compra|ordina|scopri di più|scopri di piu|iscriviti|prova|inizia|scopri|risparmia|ottieni|richiedi/i
const IT_CTA_PHRASES = [
  'Acquista ora',
  'Ordina',
  'Scopri di più',
  'Scopri',
  'Ottieni'
]

const PT_CTA_REGEX = /comprar agora|comprar|pedir|saiba mais|inscreva-se|experimentar|começar|comecar|descobrir|economizar|obter/i
const PT_CTA_PHRASES = [
  'Comprar agora',
  'Pedir',
  'Saiba mais',
  'Descobrir',
  'Obter'
]

const ZH_CTA_REGEX = /立即购买|马上购买|立刻购买|立即下单|马上下单|了解更多|获取|立即开始|注册|立即查看|马上行动/i
const ZH_CTA_PHRASES = [
  '立即购买',
  '了解更多',
  '立即下单',
  '马上行动',
  '立即查看'
]

const JA_CTA_REGEX = /今すぐ購入|購入する|ご注文|詳しく見る|詳細を見る|今すぐ開始|登録|今すぐチェック/i
const JA_CTA_PHRASES = [
  '今すぐ購入',
  '詳しく見る',
  'ご注文はこちら',
  '今すぐ開始',
  '今すぐチェック'
]

const KO_CTA_REGEX = /지금 구매|구매하기|주문하기|자세히 보기|더 알아보기|지금 시작|지금 신청|지금 확인/i
const KO_CTA_PHRASES = [
  '지금 구매',
  '자세히 보기',
  '지금 주문',
  '지금 시작',
  '지금 확인'
]

const RU_CTA_REGEX = /купить сейчас|купить|заказать|узнать больше|подробнее|начать|получить|смотреть/i
const RU_CTA_PHRASES = [
  'Купить сейчас',
  'Узнать больше',
  'Заказать',
  'Начать',
  'Получить'
]

const AR_CTA_REGEX = /اشتري الآن|اشتر الآن|اطلب الآن|اعرف المزيد|اكتشف المزيد|ابدأ الآن|سجل الآن|احصل الآن/i
const AR_CTA_PHRASES = [
  'اشتري الآن',
  'اعرف المزيد',
  'اطلب الآن',
  'ابدأ الآن',
  'احصل الآن'
]

const EN_COPY_PATTERNS: CopyPatternSet = {
  transactional: /\b(buy|shop|order|save|deal|offer|discount|price|quote|get)\b/i,
  trust: /\b(official|authentic|trusted|certified|warranty|support|guarantee)\b/i,
  scenario: /\b(for|when|during|project|repair|install|build|fix|home|garden|yard|fence|deck|job)\b/i,
  solution: /\b(solution|solve|built|designed|helps|easy|durable|powerful|reliable|heavy[-\s]?duty|lightweight)\b/i,
  pain: /\b(problem|struggle|frustrat|tired|hard|issue|worry|difficult|stuck|slow)\b/i,
  cta: EN_CTA_REGEX,
  ctaPhrases: EN_CTA_PHRASES
}

const FR_COPY_PATTERNS: CopyPatternSet = {
  transactional: /(acheter|commander|prix|devis|offre|promo|promotion|remise|économiser|obtenir|magasiner)/i,
  trust: /(officiel|authentique|fiable|certifi|garantie|assistance|support|confiance)/i,
  scenario: /(pour|quand|pendant|projet|réparation|installer|installation|construire|bricolage|maison|jardin|terrasse|clôture|chantier)/i,
  solution: /(solution|résout|résoudre|conçu|aide|facile|durable|puissant|fiable|robuste|léger)/i,
  pain: /(problème|difficile|galère|frustr|fatigu|lent|bloqué|inquiét|souci)/i,
  cta: FR_CTA_REGEX,
  ctaPhrases: FR_CTA_PHRASES
}

const DE_COPY_PATTERNS: CopyPatternSet = {
  transactional: /(kaufen|bestellen|preis|angebot|rabatt|sparen|holen|deal)/i,
  trust: /(offiziell|authentisch|vertrau|zertifiz|garantie|support|zuverlässig|zuverlaessig)/i,
  scenario: /(für|fuer|wenn|während|waehrend|projekt|reparatur|installation|bauen|haus|garten|zaun|terrasse|job)/i,
  solution: /(lösung|loesung|löst|loest|entwickelt|hilft|einfach|robust|leistungsstark|zuverlässig|zuverlaessig|langlebig|leicht)/i,
  pain: /(problem|schwierig|frust|müde|muede|langsam|steck|sorge|hürde|huerde)/i,
  cta: DE_CTA_REGEX,
  ctaPhrases: DE_CTA_PHRASES
}

const ES_COPY_PATTERNS: CopyPatternSet = {
  transactional: /(comprar|pedido|pedir|precio|oferta|descuento|ahorrar|obtener)/i,
  trust: /(oficial|auténtico|autentico|confiable|certific|garantía|garantia|soporte|confianza)/i,
  scenario: /(para|cuando|durante|proyecto|reparaci|instal|constru|hogar|jardín|jardin|patio|valla|trabajo)/i,
  solution: /(solución|solucion|resuelve|diseñado|disenado|ayuda|fácil|facil|duradero|potente|fiable|ligero|robusto)/i,
  pain: /(problema|difícil|dificil|frustr|cansad|lento|atasc|preocup|complic)/i,
  cta: ES_CTA_REGEX,
  ctaPhrases: ES_CTA_PHRASES
}

const IT_COPY_PATTERNS: CopyPatternSet = {
  transactional: /(acquista|compra|ordina|prezzo|offerta|sconto|risparmia|ottieni)/i,
  trust: /(ufficiale|autentico|affidabile|certificat|garanzia|supporto|fiducia)/i,
  scenario: /(per|quando|durante|progetto|ripar|install|costru|casa|giardino|cortile|recinzione|lavoro)/i,
  solution: /(soluzione|risolve|progett|aiuta|facile|duraturo|potente|affidabile|leggero|robusto)/i,
  pain: /(problema|difficile|frustr|stanco|lento|blocc|preoccup|fatica)/i,
  cta: IT_CTA_REGEX,
  ctaPhrases: IT_CTA_PHRASES
}

const PT_COPY_PATTERNS: CopyPatternSet = {
  transactional: /(comprar|pedir|preço|preco|oferta|desconto|economizar|obter)/i,
  trust: /(oficial|autêntico|autentico|confiável|confiavel|certific|garantia|suporte|confiança|confianca)/i,
  scenario: /(para|quando|durante|projeto|reparo|instala|constru|casa|jardim|quintal|cerca|trabalho)/i,
  solution: /(solução|solucao|resolve|projetado|ajuda|fácil|facil|durável|duravel|potente|confiável|confiavel|leve|robusto)/i,
  pain: /(problema|difícil|dificil|frustr|cansad|lento|pres|preocup|trav)/i,
  cta: PT_CTA_REGEX,
  ctaPhrases: PT_CTA_PHRASES
}

const ZH_COPY_PATTERNS: CopyPatternSet = {
  transactional: /(购买|下单|报价|优惠|折扣|省钱|价格|立减|获取)/i,
  trust: /(官方|正品|认证|质保|售后|支持|可靠|保障)/i,
  scenario: /(适用于|用于|家庭|花园|庭院|维修|安装|施工|项目|围栏|露台)/i,
  solution: /(解决|帮助|轻松|耐用|强劲|高效|可靠|省力|便捷|稳固)/i,
  pain: /(问题|困扰|费力|麻烦|卡住|慢|担心|难|痛点)/i,
  cta: ZH_CTA_REGEX,
  ctaPhrases: ZH_CTA_PHRASES
}

const JA_COPY_PATTERNS: CopyPatternSet = {
  transactional: /(購入|注文|価格|割引|お得|セール|今すぐ|入手)/i,
  trust: /(公式|正規|認証|保証|サポート|信頼|安心)/i,
  scenario: /(家庭|庭|ガーデン|修理|設置|施工|プロジェクト|フェンス|デッキ|作業)/i,
  solution: /(解決|サポート|簡単|耐久|強力|高性能|信頼性|軽量|効率)/i,
  pain: /(問題|悩み|大変|難しい|不安|遅い|困る|手間)/i,
  cta: JA_CTA_REGEX,
  ctaPhrases: JA_CTA_PHRASES
}

const KO_COPY_PATTERNS: CopyPatternSet = {
  transactional: /(구매|주문|가격|할인|혜택|특가|지금|받기)/i,
  trust: /(공식|정품|인증|보증|지원|신뢰|안심)/i,
  scenario: /(가정|정원|마당|수리|설치|시공|프로젝트|울타리|데크|작업)/i,
  solution: /(해결|도움|간편|내구성|강력|효율|신뢰성|경량|튼튼)/i,
  pain: /(문제|고민|어려움|불편|느림|막힘|걱정|번거로움)/i,
  cta: KO_CTA_REGEX,
  ctaPhrases: KO_CTA_PHRASES
}

const RU_COPY_PATTERNS: CopyPatternSet = {
  transactional: /(купить|заказать|цена|скидк|выгод|предлож|акция|получить)/i,
  trust: /(официальн|подлинн|сертифиц|гарант|поддержк|надежн|довер)/i,
  scenario: /(дом|сад|двор|ремонт|установк|проект|работ|забор|террас)/i,
  solution: /(решен|помога|легко|прочн|мощн|надежн|эффектив|удобн|долговеч)/i,
  pain: /(проблем|сложно|трудно|медлен|застр|беспоко|неудоб)/i,
  cta: RU_CTA_REGEX,
  ctaPhrases: RU_CTA_PHRASES
}

const AR_COPY_PATTERNS: CopyPatternSet = {
  transactional: /(شراء|اطلب|سعر|خصم|عرض|وفر|احصل|الآن)/i,
  trust: /(رسمي|أصلي|موثوق|معتمد|ضمان|دعم|ثقة)/i,
  scenario: /(منزل|حديقة|فناء|إصلاح|تركيب|مشروع|سياج|سطح|عمل)/i,
  solution: /(حل|يساعد|سهل|متين|قوي|فعال|موثوق|خفيف|عملي)/i,
  pain: /(مشكلة|صعب|معاناة|بطيء|عالق|قلق|متعب)/i,
  cta: AR_CTA_REGEX,
  ctaPhrases: AR_CTA_PHRASES
}

const SUPPORTED_SOFT_COPY_LANGUAGES = new Set<SupportedSoftCopyLanguage>([
  'en', 'fr', 'de', 'es', 'it', 'pt', 'zh', 'ja', 'ko', 'ru', 'ar'
])

function resolveSoftCopyLanguage(languageCode: string): SupportedSoftCopyLanguage | null {
  const raw = String(languageCode || '').trim()
  if (!raw) return null
  const lowerRaw = raw.toLowerCase()
  const mapped = LANGUAGE_CODE_MAP[lowerRaw]
  const normalized = mapped || lowerRaw

  const localeBase = normalized.split(/[-_]/)[0]
  if (SUPPORTED_SOFT_COPY_LANGUAGES.has(localeBase as SupportedSoftCopyLanguage)) {
    return localeBase as SupportedSoftCopyLanguage
  }

  let candidate = normalized
  if (candidate === 'de-ch') candidate = 'de'

  if (SUPPORTED_SOFT_COPY_LANGUAGES.has(candidate as SupportedSoftCopyLanguage)) {
    return candidate as SupportedSoftCopyLanguage
  }

  if (!mapped) {
    return null
  }

  const fallbackNormalized = normalizeLanguageCode(raw)
  const fallbackCandidate = fallbackNormalized === 'de-ch' ? 'de' : fallbackNormalized
  return SUPPORTED_SOFT_COPY_LANGUAGES.has(fallbackCandidate as SupportedSoftCopyLanguage)
    ? fallbackCandidate as SupportedSoftCopyLanguage
    : null
}

function getCopyPatterns(languageCode: string): CopyPatternSet {
  const softLanguage = resolveSoftCopyLanguage(languageCode)
  if (softLanguage === 'fr') return FR_COPY_PATTERNS
  if (softLanguage === 'de') return DE_COPY_PATTERNS
  if (softLanguage === 'es') return ES_COPY_PATTERNS
  if (softLanguage === 'it') return IT_COPY_PATTERNS
  if (softLanguage === 'pt') return PT_COPY_PATTERNS
  if (softLanguage === 'zh') return ZH_COPY_PATTERNS
  if (softLanguage === 'ja') return JA_COPY_PATTERNS
  if (softLanguage === 'ko') return KO_COPY_PATTERNS
  if (softLanguage === 'ru') return RU_COPY_PATTERNS
  if (softLanguage === 'ar') return AR_COPY_PATTERNS
  return EN_COPY_PATTERNS
}

const LATIN_SOFT_COPY_LANGUAGES: SupportedSoftCopyLanguage[] = ['en', 'fr', 'de', 'es', 'it', 'pt']

const LANGUAGE_PURITY_MARKERS: Record<SupportedSoftCopyLanguage, string[]> = {
  en: ['shop now', 'learn more', 'official', 'buy now', 'order now'],
  fr: ['acheter', 'commander', 'officiel', 'découvrir', 'en savoir plus', 'fiable', 'garantie'],
  de: ['jetzt kaufen', 'bestellen', 'offiziell', 'zertifiz', 'alkalisch', 'umkehrosmose', 'zuverlässig'],
  es: ['comprar ahora', 'oficial', 'descubrir', 'más información', 'pedir', 'confiable'],
  it: ['acquista ora', 'ufficiale', 'ordina', 'scopri', 'acqua', 'affidabile', 'certificato'],
  pt: ['comprar agora', 'oficial', 'saiba mais', 'pedir', 'descobrir', 'confiável'],
  zh: ['立即购买', '官方', '了解更多', '获取'],
  ja: ['今すぐ購入', '公式', '詳しく見る', '注文'],
  ko: ['지금 구매', '공식', '주문', '자세히'],
  ru: ['купить', 'официальн', 'заказать', 'узнать больше'],
  ar: ['اشتري الآن', 'رسمي', 'اطلب', 'اعرف المزيد'],
}

const LATIN_LANGUAGE_SIGNATURE_MARKERS: Partial<Record<SupportedSoftCopyLanguage, string[]>> = {
  en: ['the', 'with', 'official', 'shop', 'learn'],
  fr: ['avec', 'officiel', 'fiable', 'découvrez', 'savoir'],
  de: ['offiziell', 'zertifiz', 'alkalisch', 'jetzt', 'kaufen'],
  es: ['oficial', 'comprar', 'descubrir', 'más', 'información'],
  it: ['ufficiale', 'acquista', 'scopri', 'affidabile', 'oggi'],
  pt: ['oficial', 'comprar', 'saiba', 'descobrir', 'confiável'],
}

function countMarkerHits(text: string, markers: string[]): number {
  const normalized = String(text || '').toLowerCase()
  if (!normalized) return 0
  return markers.reduce((sum, marker) => (normalized.includes(marker.toLowerCase()) ? sum + 1 : sum), 0)
}

function countSignatureHits(text: string, languageCode: SupportedSoftCopyLanguage): number {
  const markers = LATIN_LANGUAGE_SIGNATURE_MARKERS[languageCode] || []
  return countMarkerHits(text, markers)
}

function getLanguagePatternHitCount(text: string, languageCode: SupportedSoftCopyLanguage): number {
  const patterns = getCopyPatterns(languageCode)
  const normalized = String(text || '').toLowerCase()
  if (!normalized) return 0
  const checks = [
    patterns.transactional,
    patterns.trust,
    patterns.scenario,
    patterns.solution,
    patterns.pain,
    patterns.cta,
  ]
  return checks.reduce((sum, pattern) => (pattern.test(normalized) ? sum + 1 : sum), 0)
}

function isLikelyCrossLanguageLatinAsset(text: string, targetLanguage: SupportedSoftCopyLanguage): boolean {
  if (!LATIN_SOFT_COPY_LANGUAGES.includes(targetLanguage)) return false
  if (targetLanguage === 'en') return false

  const normalized = String(text || '').trim()
  if (!normalized) return false

  const targetMarkerHits = countMarkerHits(normalized, LANGUAGE_PURITY_MARKERS[targetLanguage] || [])
  const targetPatternHits = getLanguagePatternHitCount(normalized, targetLanguage)
  const targetSignatureHits = countSignatureHits(normalized, targetLanguage)

  let otherMarkerMax = 0
  let otherPatternMax = 0
  let otherSignatureMax = 0
  for (const lang of LATIN_SOFT_COPY_LANGUAGES) {
    if (lang === targetLanguage) continue
    otherMarkerMax = Math.max(otherMarkerMax, countMarkerHits(normalized, LANGUAGE_PURITY_MARKERS[lang] || []))
    otherPatternMax = Math.max(otherPatternMax, getLanguagePatternHitCount(normalized, lang))
    otherSignatureMax = Math.max(otherSignatureMax, countSignatureHits(normalized, lang))
  }

  if (otherMarkerMax >= 1 && targetMarkerHits === 0) return true
  if (otherSignatureMax >= 2 && targetSignatureHits === 0) return true
  if (otherSignatureMax >= 3 && otherSignatureMax > targetSignatureHits + 1) return true
  return otherPatternMax >= 2 && otherPatternMax > targetPatternHits
}

function getCtaRegexForLanguage(languageCode: string): RegExp {
  return getCopyPatterns(languageCode).cta
}

function getCtaPhrasesForLanguage(languageCode: string): string[] {
  return getCopyPatterns(languageCode).ctaPhrases
}

function textContainsKeyword(text: string, keyword: string): boolean {
  const normalizedText = String(text || '').toLowerCase()
  const normalizedKeyword = String(keyword || '').toLowerCase().trim()
  if (!normalizedText || !normalizedKeyword) return false
  if (normalizedText.includes(normalizedKeyword)) return true
  const keywordRoot = normalizedKeyword.replace(/s$|ing$|ed$/g, '')
  return keywordRoot.length >= 3 && normalizedText.includes(keywordRoot)
}

function headlineContainsKeyword(headline: string, keywords: string[]): boolean {
  return keywords.some((keyword) => textContainsKeyword(headline, keyword))
}

function cycleKeywordTargets(keywords: string[], count: number): string[] {
  const normalizedKeywords = keywords
    .map((keyword) => String(keyword || '').trim())
    .filter(Boolean)
  if (normalizedKeywords.length === 0 || count <= 0) return []

  const targets: string[] = []
  while (targets.length < count) {
    targets.push(normalizedKeywords[targets.length % normalizedKeywords.length])
  }
  return targets
}

function getContractRoleScore(role: unknown): number {
  const normalized = String(role || '').trim().toLowerCase()
  if (normalized === 'required') return 240
  if (normalized === 'optional') return 120
  if (normalized === 'fallback') return 0
  return 40
}

function getEvidenceStrengthScore(strength: unknown): number {
  const normalized = String(strength || '').trim().toLowerCase()
  if (normalized === 'high') return 60
  if (normalized === 'medium') return 30
  if (normalized === 'low') return 10
  return 20
}

function getKeywordFitScore(keyword: string, maxLength: number): number {
  const effectiveLength = getGoogleAdsTextEffectiveLength(String(keyword || '').trim())
  if (effectiveLength <= 0) return -200
  if (effectiveLength > maxLength) {
    return Math.max(-160, -20 * (effectiveLength - maxLength))
  }
  if (effectiveLength <= Math.max(8, maxLength - 10)) return 40
  return 20
}

function extractCreativeSlotSemanticTokens(keyword: string, brandName: string | null | undefined): string[] {
  const semanticCore = normalizeBrandFreeText(keyword, String(brandName || ''))
  return tokenizeHeadline2Keyword(semanticCore)
    .filter((token) => token.length >= 2)
    .filter((token) => !HEADLINE2_STOPWORDS.has(token))
    .filter((token) => !HEADLINE2_INTENT_TOKENS.has(token))
    .filter((token) => !HEADLINE2_BANNED_TOKENS.has(token))
}

function isKeywordEligibleForCreativeSlotContract(
  keyword: string,
  brandName: string | null | undefined
): boolean {
  const normalizedKeyword = stripHeadlineTrailingPunctuation(
    normalizeHeadline2KeywordCandidate(String(keyword || '').trim())
  )
  if (!isUsefulCreativePhrase(normalizedKeyword, 3, RETAINED_KEYWORD_DESCRIPTION_MAX_LENGTH)) {
    return false
  }

  const trailingToken = normalizedKeyword
    .split(/\s+/)
    .filter(Boolean)
    .pop()
    ?.toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '') || ''
  if (trailingToken && HEADLINE_DANGLING_TAIL_TOKENS.has(trailingToken)) {
    return false
  }

  const normalizedForMatch = normalizeGoogleAdsKeyword(normalizedKeyword)
  if (!normalizedForMatch) return false
  if (getGoogleAdsTextEffectiveLength(normalizedKeyword) > RETAINED_KEYWORD_HEADLINE_MAX_LENGTH) {
    return false
  }

  const normalizedBrandName = String(brandName || '').trim()
  if (normalizedBrandName && isBrandVariant(normalizedForMatch, normalizedBrandName)) {
    return false
  }
  if (isSemanticQuery(normalizedForMatch)) {
    return false
  }

  const semanticTokens = extractCreativeSlotSemanticTokens(normalizedForMatch, normalizedBrandName)
  if (semanticTokens.length === 0) {
    return false
  }

  if (
    semanticTokens.every((token) => /^\d+$/.test(token))
    || semanticTokens.every((token) => token.length <= 2 && !isLikelyModelCodeToken(token))
  ) {
    return false
  }

  return semanticTokens.some((token) =>
    token.length >= 3
    || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Cyrillic}]/u.test(token)
    || isLikelyModelCodeToken(token)
  )
}

function scoreKeywordUsageCandidate(
  candidate: NonNullable<PrecomputedCreativeKeywordSet['keywordsWithVolume']>[number],
  maxLength: number
): number {
  const sourceScore = getKeywordSourcePriorityScoreFromInput({
    source: candidate.source,
    sourceType: candidate.sourceSubtype || candidate.sourceType,
  })
  const volume = Number(candidate.searchVolume || 0)
  const volumeScore = volume > 0 ? Math.min(90, Math.round(Math.log10(volume + 1) * 24)) : 0
  const confidenceScore = typeof candidate.confidence === 'number'
    ? Math.max(0, Math.min(20, Math.round(candidate.confidence * 20)))
    : 0
  const exactBonus = candidate.matchType === 'EXACT' ? 16 : candidate.matchType === 'PHRASE' ? 8 : 0

  return (
    getContractRoleScore(candidate.contractRole)
    + sourceScore * 4
    + getEvidenceStrengthScore(candidate.evidenceStrength)
    + volumeScore
    + confidenceScore
    + exactBonus
    + getKeywordFitScore(candidate.keyword, maxLength)
  )
}

function dedupeKeywordUsageCandidates(
  brandName: string | null | undefined,
  precomputedKeywordSet?: PrecomputedCreativeKeywordSet | null
): NonNullable<PrecomputedCreativeKeywordSet['keywordsWithVolume']> {
  const fromKeywordObjects = Array.isArray(precomputedKeywordSet?.keywordsWithVolume)
    ? precomputedKeywordSet?.keywordsWithVolume || []
    : []
  const fallbackKeywords = Array.from(new Set([
    ...((precomputedKeywordSet?.executableKeywords || []).map((keyword) => String(keyword || '').trim())),
    ...((precomputedKeywordSet?.promptKeywords || []).map((keyword) => String(keyword || '').trim())),
  ])).filter(Boolean)

  const combined: NonNullable<PrecomputedCreativeKeywordSet['keywordsWithVolume']> = fromKeywordObjects.length > 0
    ? fromKeywordObjects
    : fallbackKeywords.map((keyword) => ({
      keyword,
      searchVolume: 0,
    }))

  const pureBrandKeywords = getPureBrandKeywords(brandName || '')
  const seen = new Map<string, NonNullable<PrecomputedCreativeKeywordSet['keywordsWithVolume']>[number]>()

  for (const item of combined) {
    const keyword = String(item?.keyword || '').trim()
    if (!keyword) continue
    if (isPureBrandKeyword(keyword, pureBrandKeywords)) continue
    if (!isKeywordEligibleForCreativeSlotContract(keyword, brandName)) continue

    const normalized = normalizeGoogleAdsKeyword(keyword)
    if (!normalized) continue

    const current = {
      keyword,
      searchVolume: Number(item?.searchVolume || 0),
      source: item?.source,
      sourceType: item?.sourceType,
      sourceSubtype: item?.sourceSubtype,
      contractRole: item?.contractRole,
      evidenceStrength: item?.evidenceStrength,
      matchType: item?.matchType,
      confidence: item?.confidence,
    }
    const existing = seen.get(normalized)
    if (!existing) {
      seen.set(normalized, current)
      continue
    }

    const existingScore = scoreKeywordUsageCandidate(existing, RETAINED_KEYWORD_DESCRIPTION_MAX_LENGTH)
    const currentScore = scoreKeywordUsageCandidate(current, RETAINED_KEYWORD_DESCRIPTION_MAX_LENGTH)
    if (currentScore > existingScore) {
      seen.set(normalized, current)
    }
  }

  return Array.from(seen.values())
}

export function buildCreativeKeywordUsagePlan(input: {
  brandName?: string | null
  precomputedKeywordSet?: PrecomputedCreativeKeywordSet | null
  headlineSlotCount?: number
  descriptionSlotCount?: number
}): CreativeKeywordUsagePlan {
  const headlineSlotCount = Math.max(1, input.headlineSlotCount ?? RETAINED_KEYWORD_HEADLINE_SLOT_COUNT)
  const descriptionSlotCount = Math.max(1, input.descriptionSlotCount ?? RETAINED_KEYWORD_DESCRIPTION_SLOT_COUNT)
  const candidates = dedupeKeywordUsageCandidates(input.brandName, input.precomputedKeywordSet)

  const rankedForHeadline = [...candidates].sort((left, right) => {
    const scoreDelta =
      scoreKeywordUsageCandidate(right, RETAINED_KEYWORD_HEADLINE_MAX_LENGTH)
      - scoreKeywordUsageCandidate(left, RETAINED_KEYWORD_HEADLINE_MAX_LENGTH)
    if (scoreDelta !== 0) return scoreDelta
    return left.keyword.localeCompare(right.keyword)
  })
  const rankedForDescription = [...candidates].sort((left, right) => {
    const scoreDelta =
      scoreKeywordUsageCandidate(right, RETAINED_KEYWORD_DESCRIPTION_MAX_LENGTH)
      - scoreKeywordUsageCandidate(left, RETAINED_KEYWORD_DESCRIPTION_MAX_LENGTH)
    if (scoreDelta !== 0) return scoreDelta
    return left.keyword.localeCompare(right.keyword)
  })

  const retainedNonBrandKeywords = rankedForDescription.map((item) => item.keyword)
  const headlineCoverageMode = retainedNonBrandKeywords.length < headlineSlotCount
    ? 'exhaustive_under_5'
    : 'top_5'

  const headlineTargets = headlineCoverageMode === 'exhaustive_under_5'
    ? cycleKeywordTargets(retainedNonBrandKeywords, headlineSlotCount)
    : rankedForHeadline.slice(0, headlineSlotCount).map((item) => item.keyword)

  const descriptionCandidates = rankedForDescription.filter((item) =>
    !headlineTargets.some((target) => normalizeGoogleAdsKeyword(target) === normalizeGoogleAdsKeyword(item.keyword))
  )
  const descriptionTargets = cycleKeywordTargets(
    (descriptionCandidates.length > 0 ? descriptionCandidates : rankedForDescription).map((item) => item.keyword),
    descriptionSlotCount
  )

  return {
    retainedNonBrandKeywords,
    headlineKeywordTargets: headlineTargets,
    descriptionKeywordTargets: descriptionTargets,
    headlineCoverageMode,
    descriptionCoverageMode: 'prefer_uncovered_then_best_available',
  }
}

function resolveEffectiveKeywordUsagePlan(input: {
  brandName?: string | null
  precomputedKeywordSet?: PrecomputedCreativeKeywordSet | null
  generatedKeywords?: string[] | null
  keywordsWithVolume?: Array<{ keyword: string; searchVolume?: number | null }> | null
}): CreativeKeywordUsagePlan {
  const primary = buildCreativeKeywordUsagePlan({
    brandName: input.brandName,
    precomputedKeywordSet: input.precomputedKeywordSet,
  })
  if (primary.retainedNonBrandKeywords.length > 0) {
    return primary
  }

  const fallbackKeywordsWithVolume =
    (input.keywordsWithVolume || [])
      .map((item) => ({
        keyword: String(item?.keyword || '').trim(),
        searchVolume: Number(item?.searchVolume || 0),
      }))
      .filter((item) => item.keyword.length > 0)

  const fallbackFromKeywords =
    fallbackKeywordsWithVolume.length > 0
      ? fallbackKeywordsWithVolume
      : (input.generatedKeywords || [])
          .map((keyword) => String(keyword || '').trim())
          .filter(Boolean)
          .map((keyword) => ({ keyword, searchVolume: 0 }))

  if (fallbackFromKeywords.length === 0) {
    return primary
  }

  return buildCreativeKeywordUsagePlan({
    brandName: input.brandName,
    precomputedKeywordSet: {
      keywordsWithVolume: fallbackFromKeywords,
    },
  })
}

function buildRetainedKeywordSlotSection(plan: CreativeKeywordUsagePlan): string {
  if (plan.retainedNonBrandKeywords.length === 0) {
    return '- No retained non-brand keywords were safe for forced slot coverage. Do not force awkward, low-quality, or semantically empty keywords into headlines or descriptions.'
  }

  const headlineLines = plan.headlineKeywordTargets.map((keyword, index) =>
    `- Headline #${RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX + index + 1}: must contain "${keyword}"`
  )
  const descriptionLines = plan.descriptionKeywordTargets.map((keyword, index) =>
    `- Description #${RETAINED_KEYWORD_DESCRIPTION_SLOT_START_INDEX + index + 1}: must contain "${keyword}"`
  )

  return [
    `- Final retained non-brand keywords: ${plan.retainedNonBrandKeywords.join(', ')}`,
    '- Headline #1 is fixed DKI. Headline #2-#4 are title/about protected and must not be repurposed for retained keyword coverage.',
    `- Headline coverage mode: ${plan.headlineCoverageMode}`,
    ...headlineLines,
    `- Description coverage mode: ${plan.descriptionCoverageMode}`,
    ...descriptionLines,
    '- Do not invent replacement keywords outside the final retained set.',
    '- Retained-keyword headlines must stay meaningfully different from Headline #1-#4; do not paraphrase or lightly remix those protected headlines.',
    '- If a listed retained keyword cannot be used naturally without harming copy quality, keep the wording natural instead of forcing a broken phrase.',
  ].join('\n')
}

function fitKeywordIntoHeadline(text: string, keyword: string, maxLength: number): string | null {
  const trimmedKeyword = String(keyword || '').trim()
  if (!trimmedKeyword) return null
  if (textContainsKeyword(text, trimmedKeyword)) return text
  if (getGoogleAdsTextEffectiveLength(trimmedKeyword) > maxLength) return null

  const base = String(text || '').trim().replace(/[.!?]+$/g, '').trim()
  const candidates = [
    `${trimmedKeyword} ${base}`.trim(),
    `${base} ${trimmedKeyword}`.trim(),
    trimmedKeyword,
  ]

  return candidates.find((candidate) =>
    Boolean(candidate) && getGoogleAdsTextEffectiveLength(candidate) <= maxLength
  ) || null
}

function canonicalizeHeadlineActionPhrases(text: string, languageCode: string): string {
  let normalized = String(text || '').toLowerCase()
  const replacements = new Map<string, string>()

  for (const phrase of getCtaPhrasesForLanguage(languageCode)) {
    const normalizedPhrase = normalizeHeadlineCandidateText(phrase).toLowerCase()
    if (!normalizedPhrase) continue

    const withoutNow = normalizedPhrase.replace(/\bnow\b/gi, '').trim()
    const canonical = (withoutNow.split(/\s+/).filter(Boolean)[0] || withoutNow || normalizedPhrase).trim()
    if (!canonical) continue

    replacements.set(normalizedPhrase, canonical)
    if (withoutNow) replacements.set(withoutNow, canonical)
  }

  const orderedSources = Array.from(replacements.keys()).sort((left, right) => right.length - left.length)
  for (const source of orderedSources) {
    normalized = normalized.replace(new RegExp(escapeRegex(source), 'gi'), replacements.get(source) || source)
  }

  const canonicalRoots = Array.from(new Set(replacements.values())).sort((left, right) => right.length - left.length)
  for (const root of canonicalRoots) {
    const trailingPattern = new RegExp(`^(.*?)\\s+${escapeRegex(root)}$`, 'i')
    const trailingMatch = normalized.match(trailingPattern)
    const body = trailingMatch?.[1]?.trim()
    if (!body || body === root) continue
    normalized = `${root} ${body}`.trim()
  }

  return normalized.replace(/\s+/g, ' ').trim()
}

function normalizeHeadlineForProtectedSimilarity(text: string, brandName: string, languageCode: string): string {
  const normalized = normalizeHeadline2KeywordCandidate(normalizeBrandFreeText(text, brandName) || text)
    .toLowerCase()
  return canonicalizeHeadlineActionPhrases(normalized, languageCode)
    .replace(/\s+/g, ' ')
    .trim()
}

function isHeadlineTooSimilarToProtectedSlots(
  candidate: string,
  protectedHeadlines: string[],
  brandName: string,
  languageCode: string
): boolean {
  const normalizedCandidate = normalizeHeadlineForProtectedSimilarity(candidate, brandName, languageCode)
  if (!normalizedCandidate) return false

  return protectedHeadlines.some((headline) => {
    const normalizedProtected = normalizeHeadlineForProtectedSimilarity(headline, brandName, languageCode)
    if (!normalizedProtected) return false
    if (normalizedCandidate === normalizedProtected) return true
    return calculateTextSimilarity(normalizedCandidate, normalizedProtected) >= RETAINED_KEYWORD_PROTECTED_SIMILARITY_THRESHOLD
  })
}

function getHeadlineActionVariants(languageCode: string): string[] {
  const phrases = getCtaPhrasesForLanguage(languageCode)
  const candidates = new Set<string>()

  for (const phrase of phrases) {
    const normalized = normalizeHeadlineCandidateText(phrase)
      .replace(/\bnow\b/gi, '')
      .trim()
    if (!normalized) continue
    candidates.add(normalized)

    const parts = normalized.split(/\s+/).filter(Boolean)
    if (parts.length > 1) {
      candidates.add(parts[0])
    }
  }

  return Array.from(candidates).filter(Boolean).slice(0, 4)
}

function fitKeywordIntoDiverseHeadline(
  text: string,
  keyword: string,
  maxLength: number,
  languageCode: string,
  protectedHeadlines: string[],
  brandName: string
): string | null {
  const baseCandidate = fitKeywordIntoHeadline(text, keyword, maxLength)
  const actionVariants = getHeadlineActionVariants(languageCode)
  const rawCandidates = [
    baseCandidate,
    normalizeHeadlineCandidateText(keyword),
    ...actionVariants.map((action) => normalizeHeadlineCandidateText(`${action} ${keyword}`)),
    ...actionVariants.map((action) => normalizeHeadlineCandidateText(`${keyword} ${action}`)),
  ]

  const seen = new Set<string>()
  for (const rawCandidate of rawCandidates) {
    const candidate = normalizeHeadlineCandidateText(String(rawCandidate || ''))
    if (!candidate || seen.has(candidate)) continue
    seen.add(candidate)
    if (getGoogleAdsTextEffectiveLength(candidate) > maxLength) continue
    if (isHeadlineTooSimilarToProtectedSlots(candidate, protectedHeadlines, brandName, languageCode)) continue
    return candidate
  }

  return null
}

function fitKeywordIntoDescription(
  text: string,
  keyword: string,
  maxLength: number,
  languageCode: string
): string | null {
  const trimmedKeyword = String(keyword || '').trim()
  if (!trimmedKeyword) return null
  if (textContainsKeyword(text, trimmedKeyword)) return text
  if (getGoogleAdsTextEffectiveLength(trimmedKeyword) > maxLength) return null

  const base = String(text || '').trim().replace(/[.!?]+$/g, '').trim()
  const cta = getCtaPhrasesForLanguage(languageCode)[0] || 'Shop Now'
  const candidates = [
    `${trimmedKeyword}. ${base}`.trim(),
    `${base}. ${trimmedKeyword}`.trim(),
    `${trimmedKeyword}. ${cta}`.trim(),
    `${cta} ${trimmedKeyword}`.trim(),
  ]

  return candidates.find((candidate) =>
    Boolean(candidate) && getGoogleAdsTextEffectiveLength(candidate) <= maxLength
  ) || null
}

export function enforceRetainedKeywordSlotCoverage(
  result: GeneratedAdCreativeData,
  usagePlan: CreativeKeywordUsagePlan | null | undefined,
  languageCode: string,
  brandName: string = ''
): { headlineFixes: number; descriptionFixes: number } {
  if (!usagePlan || usagePlan.retainedNonBrandKeywords.length === 0) {
    return { headlineFixes: 0, descriptionFixes: 0 }
  }

  const headlines = [...(result.headlines || [])]
  const descriptions = [...(result.descriptions || [])]
  const protectedHeadlines = headlines.slice(0, Math.min(RETAINED_KEYWORD_PROTECTED_HEADLINE_COUNT, headlines.length))
  let headlineFixes = 0
  let descriptionFixes = 0

  for (let index = 0; index < usagePlan.headlineKeywordTargets.length; index += 1) {
    const slotIndex = RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX + index
    if (slotIndex >= headlines.length) break
    const keywordTarget = usagePlan.headlineKeywordTargets[index]
    const currentHeadline = headlines[slotIndex]
    if (
      textContainsKeyword(currentHeadline, keywordTarget)
      && !isHeadlineTooSimilarToProtectedSlots(currentHeadline, protectedHeadlines, brandName, languageCode)
    ) {
      continue
    }

    const fitted = fitKeywordIntoDiverseHeadline(
      headlines[slotIndex],
      keywordTarget,
      RETAINED_KEYWORD_HEADLINE_MAX_LENGTH,
      languageCode,
      protectedHeadlines,
      brandName
    )
    if (!fitted || fitted === headlines[slotIndex]) continue
    headlines[slotIndex] = fitted
    headlineFixes += 1
  }

  for (let index = 0; index < usagePlan.descriptionKeywordTargets.length; index += 1) {
    const slotIndex = RETAINED_KEYWORD_DESCRIPTION_SLOT_START_INDEX + index
    if (slotIndex >= descriptions.length) break
    const keywordTarget = usagePlan.descriptionKeywordTargets[index]
    if (textContainsKeyword(descriptions[slotIndex], keywordTarget)) continue

    const fitted = fitKeywordIntoDescription(
      descriptions[slotIndex],
      keywordTarget,
      RETAINED_KEYWORD_DESCRIPTION_MAX_LENGTH,
      languageCode
    )
    if (!fitted || fitted === descriptions[slotIndex]) continue
    descriptions[slotIndex] = fitted
    descriptionFixes += 1
  }

  if (headlineFixes > 0) {
    result.headlines = headlines
    if (result.headlinesWithMetadata) {
      result.headlinesWithMetadata = result.headlinesWithMetadata.map((asset, index) => ({
        ...asset,
        text: headlines[index] ?? asset.text,
        length: Math.min(RETAINED_KEYWORD_HEADLINE_MAX_LENGTH, (headlines[index] ?? asset.text).length),
        keywords: index >= RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX && index < RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX + usagePlan.headlineKeywordTargets.length
          ? [usagePlan.headlineKeywordTargets[index - RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX]]
          : asset.keywords,
      }))
    }
  }

  if (descriptionFixes > 0) {
    result.descriptions = descriptions
    if (result.descriptionsWithMetadata) {
      result.descriptionsWithMetadata = result.descriptionsWithMetadata.map((asset, index) => ({
        ...asset,
        text: descriptions[index] ?? asset.text,
        length: Math.min(RETAINED_KEYWORD_DESCRIPTION_MAX_LENGTH, (descriptions[index] ?? asset.text).length),
        keywords: index < usagePlan.descriptionKeywordTargets.length
          ? [usagePlan.descriptionKeywordTargets[index]]
          : asset.keywords,
      }))
    }
  }

  return { headlineFixes, descriptionFixes }
}

async function recordAdCreativeOperationTokenUsage(input: {
  userId: number
  operationType: string
  aiResponse: Awaited<ReturnType<typeof generateContent>>
}): Promise<void> {
  if (!input.aiResponse.usage) return

  const cost = estimateTokenCost(
    input.aiResponse.model,
    input.aiResponse.usage.inputTokens,
    input.aiResponse.usage.outputTokens
  )
  await recordTokenUsage({
    userId: input.userId,
    model: input.aiResponse.model,
    operationType: input.operationType,
    inputTokens: input.aiResponse.usage.inputTokens,
    outputTokens: input.aiResponse.usage.outputTokens,
    totalTokens: input.aiResponse.usage.totalTokens,
    cost,
    apiType: input.aiResponse.apiType
  })
}

function enforceLanguageCtas(
  descriptions: string[],
  minCount: number,
  maxLength: number,
  languageCode: string
): { updated: string[]; fixed: number } {
  const updated = [...descriptions]
  const ctaRegex = getCtaRegexForLanguage(languageCode)
  const ctaPhrases = getCtaPhrasesForLanguage(languageCode)
  let ctaCount = updated.filter(d => ctaRegex.test(d)).length
  let fixed = 0

  for (let i = 0; i < updated.length && ctaCount < minCount; i += 1) {
    if (ctaRegex.test(updated[i])) continue
    const base = updated[i].trim().replace(/[.!?]+$/, '')
    const suffix = ctaPhrases[fixed % ctaPhrases.length]
    const candidate = `${base}. ${suffix}`.trim()
    if (candidate.length <= maxLength) {
      updated[i] = candidate
      ctaCount += 1
      fixed += 1
      continue
    }
    const fallback = `${updated[i].trim()} ${suffix}`.trim()
    if (fallback.length <= maxLength) {
      updated[i] = fallback
      ctaCount += 1
      fixed += 1
    }
  }

  return { updated, fixed }
}

function enforceKeywordEmbedding(
  headlines: string[],
  keywords: string[],
  minCount: number,
  maxLength: number,
  protectedIndexes: number[] = [0]
): { updated: string[]; fixed: number } {
  const updated = [...headlines]
  let embeddedCount = updated.filter(h => headlineContainsKeyword(h, keywords)).length
  let fixed = 0

  if (embeddedCount >= minCount) {
    return { updated, fixed }
  }

  const candidateKeywords = keywords
    .map(k => k.trim())
    .filter(k => k.length > 0 && k.length <= 14)
    .sort((a, b) => a.length - b.length)

  if (candidateKeywords.length === 0) {
    return { updated, fixed }
  }

  for (let i = 0; i < updated.length && embeddedCount < minCount; i += 1) {
    if (protectedIndexes.includes(i)) continue
    if (/\?$/g.test(updated[i])) continue
    if (headlineContainsKeyword(updated[i], keywords)) continue

    let replaced = false
    for (const kw of candidateKeywords) {
      const prefix = `${kw} ${updated[i]}`.trim()
      if (prefix.length <= maxLength) {
        updated[i] = prefix
        replaced = true
        break
      }
      const suffix = `${updated[i]} ${kw}`.trim()
      if (suffix.length <= maxLength) {
        updated[i] = suffix
        replaced = true
        break
      }
    }

    if (replaced) {
      embeddedCount += 1
      fixed += 1
    }
  }

  return { updated, fixed }
}

type NormalizedCreativeBucket = 'A' | 'B' | 'D' | null
type CopyIntentTag = 'brand' | 'scenario' | 'solution' | 'transactional' | 'other'
type ComplementarityTag = 'brand' | 'scenario' | 'transactional' | 'other'
type DescriptionStructureTag = 'pain_solution_cta' | 'benefit_cta' | 'trust_cta' | 'value_cta' | 'other'
const MODEL_INTENT_TRANSACTIONAL_MODIFIER_PATTERN =
  /\b(buy|purchase|order|shop|shopping|shops|price|pricing|cost|deal|deals|discount|sale|offer|coupon|promo|store)\b/i

function normalizeCreativeBucketType(bucket?: string | null): NormalizedCreativeBucket {
  const upper = String(bucket || '').toUpperCase()
  if (upper === 'A') return 'A'
  if (upper === 'B' || upper === 'C') return 'B'
  if (upper === 'D' || upper === 'S') return 'D'
  return null
}

export function resolveCreativeBucketPoolKeywords(
  pool: OfferKeywordPool,
  bucket?: string | null,
  fallbackBucket: Exclude<NormalizedCreativeBucket, null> = 'A'
): PoolKeywordData[] {
  const normalizedBucket = normalizeCreativeBucketType(bucket) ?? fallbackBucket
  return getBucketInfo(pool, normalizedBucket).keywords
}

function normalizeLocalizationPayload(localization: any):
  | { currency?: string; culturalNotes?: string[]; localKeywords?: string[] }
  | undefined {
  if (!localization || typeof localization !== 'object') return undefined

  if ('currency' in localization || 'culturalNotes' in localization || 'localKeywords' in localization) {
    return {
      currency: typeof localization.currency === 'string' ? localization.currency : undefined,
      culturalNotes: Array.isArray(localization.culturalNotes)
        ? localization.culturalNotes.map((v: any) => String(v || '').trim()).filter((v: string) => v.length > 0).slice(0, 8)
        : undefined,
      localKeywords: Array.isArray(localization.localKeywords)
        ? localization.localKeywords.map((v: any) => String(v || '').trim()).filter((v: string) => v.length > 0).slice(0, 12)
        : undefined
    }
  }

  const pricingCurrency = typeof localization.pricing?.currency === 'string' ? localization.pricing.currency : undefined
  const contentNotes: string[] = Array.isArray(localization.content?.culturalNotes)
    ? localization.content.culturalNotes.map((v: any) => String(v || '').trim()).filter((v: string) => v.length > 0)
    : []
  const keywordNotes: string[] = Array.isArray(localization.keywords)
    ? localization.keywords
        .map((k: any) => (typeof k?.culturalNotes === 'string' ? k.culturalNotes : ''))
        .filter((v: string) => v.length > 0)
    : []
  const localKeywordCandidates: string[] = Array.isArray(localization.keywords)
    ? localization.keywords
        .map((k: any) => (typeof k?.localized === 'string' ? k.localized : ''))
        .filter((v: string) => v.length > 0)
    : []

  const mergedNotes: string[] = [...new Set([...contentNotes, ...keywordNotes])].slice(0, 8)
  const mergedLocalKeywords: string[] = [...new Set(localKeywordCandidates)].slice(0, 12)

  if (!pricingCurrency && mergedNotes.length === 0 && mergedLocalKeywords.length === 0) {
    return undefined
  }

  return {
    currency: pricingCurrency,
    culturalNotes: mergedNotes.length > 0 ? mergedNotes : undefined,
    localKeywords: mergedLocalKeywords.length > 0 ? mergedLocalKeywords : undefined
  }
}

function detectKeywordIntentsForPrompt(
  keywords: string[],
  languageCode: string
): {
  transactional: string[]
  scenario: string[]
  solution: string[]
  other: string[]
} {
  const result = {
    transactional: [] as string[],
    scenario: [] as string[],
    solution: [] as string[],
    other: [] as string[],
  }
  const patterns = getCopyPatterns(languageCode)

  const seen = new Set<string>()
  for (const kwRaw of keywords) {
    const kw = String(kwRaw || '').trim()
    if (!kw) continue
    const normalized = kw.toLowerCase()
    if (seen.has(normalized)) continue
    seen.add(normalized)

    const classified = classifyKeywordIntent(kw, { language: languageCode })
    if (classified.intent === 'TRANSACTIONAL') {
      result.transactional.push(kw)
      continue
    }
    if (patterns.scenario.test(kw) || classified.intent === 'COMMERCIAL') {
      result.scenario.push(kw)
      continue
    }
    if (patterns.solution.test(kw)) {
      result.solution.push(kw)
      continue
    }
    result.other.push(kw)
  }

  return {
    transactional: result.transactional.slice(0, 6),
    scenario: result.scenario.slice(0, 6),
    solution: result.solution.slice(0, 6),
    other: result.other.slice(0, 6)
  }
}

const PROMPT_MODEL_ANCHOR_PATTERNS = [
  /\b[a-z]{1,5}[- ]?\d{2,4}[a-z0-9-]*\b/i,
  /\b(?:gen|generation|series|model|version|mk)\s*[a-z0-9-]+\b/i,
  /\b(?:omni|pro|ultra|max|plus|mini)\b/i,
]

function extractModelAnchorsForPrompt(keywords: string[]): string[] {
  const anchors: string[] = []
  const seen = new Set<string>()

  for (const keyword of keywords) {
    const normalized = String(keyword || '').trim()
    if (!normalized) continue

    const matched = PROMPT_MODEL_ANCHOR_PATTERNS.some((pattern) => pattern.test(normalized))
    if (!matched) continue

    const compact = normalized.toLowerCase()
    if (seen.has(compact)) continue
    seen.add(compact)
    anchors.push(normalized)

    if (anchors.length >= 6) break
  }

  return anchors
}

function getStoreProductNameCandidate(product: any): string {
  const candidates = [
    product?.productData?.productName,
    product?.productData?.name,
    product?.productName,
    product?.name,
    product?.title,
  ]

  for (const candidate of candidates) {
    const normalized = String(candidate || '').replace(/\s+/g, ' ').trim()
    if (normalized.length >= 3) {
      return normalized
    }
  }

  return ''
}

function collectStoreProductEvidenceTexts(product: any): string[] {
  const output: string[] = []
  const seen = new Set<string>()

  const push = (value: unknown) => {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim()
    if (normalized.length < 3) return
    const key = normalized.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    output.push(normalized)
  }

  const appendRecord = (value: unknown, limit = 6) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    for (const [key, raw] of Object.entries(value).slice(0, limit)) {
      if (typeof raw !== 'string' && typeof raw !== 'number') continue
      push(`${key} ${raw}`)
    }
  }

  const appendVariantList = (value: unknown, limit = 6) => {
    if (!Array.isArray(value)) return
    for (const item of value.slice(0, limit)) {
      if (!item || typeof item !== 'object') continue
      push((item as any).name)
      push((item as any).title)
      push((item as any).label)
      push((item as any).model)
      push((item as any).sku)
      push((item as any).value)
      push((item as any).option)
      push((item as any).variant)
    }
  }

  push(getStoreProductNameCandidate(product))
  push(product?.productData?.model)
  push(product?.model)
  push(product?.productData?.sku)
  push(product?.sku)
  push(product?.url)
  push(product?.link)
  push(product?.href)

  for (const value of [
    product?.productData?.aboutThisItem,
    product?.productData?.features,
    product?.aboutThisItem,
    product?.features,
  ]) {
    if (!Array.isArray(value)) continue
    value.slice(0, 5).forEach(item => push(item))
  }

  appendRecord(product?.productData?.specifications)
  appendRecord(product?.specifications)
  appendRecord(product?.productData?.attributes)
  appendRecord(product?.attributes)
  appendVariantList(product?.productData?.variants)
  appendVariantList(product?.variants)
  appendVariantList(product?.options)

  return output
}

const STORE_PRODUCT_LINK_SEGMENT_STOPWORDS = new Set([
  'products',
  'product',
  'collections',
  'collection',
  'shop',
  'store',
  'item',
  'items',
  'dp',
  'gp',
  'p',
  'sku',
])

function decodeUriComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function normalizeStoreProductLinkSegment(value: string): string {
  return decodeUriComponentSafe(String(value || ''))
    .replace(/\.[a-z0-9]{2,5}$/i, ' ')
    .replace(/[-_+]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function scoreStoreProductNameCandidate(value: string): number {
  const tokens = value.split(/\s+/).filter(Boolean)
  const tokenScore = Math.min(8, tokens.length)
  const modelBonus = /\d/.test(value) ? 4 : 0
  const phraseBonus = value.includes(' ') ? 1 : 0
  return tokenScore + modelBonus + phraseBonus
}

function extractStoreProductNameCandidatesFromLink(rawLink: string): string[] {
  const normalizedLink = String(rawLink || '').trim()
  if (!normalizedLink) return []

  const candidates: string[] = []
  const seen = new Set<string>()
  const pushCandidate = (value: unknown) => {
    const normalized = normalizeStoreProductLinkSegment(String(value || ''))
    if (normalized.length < 3) return
    const compact = normalized.toLowerCase()
    if (STORE_PRODUCT_LINK_SEGMENT_STOPWORDS.has(compact)) return
    if (seen.has(compact)) return
    seen.add(compact)
    candidates.push(normalized)
  }

  const tryUrls = [normalizedLink]
  if (!/^https?:\/\//i.test(normalizedLink)) {
    tryUrls.push(`https://${normalizedLink}`)
  }
  for (const candidateUrl of tryUrls) {
    try {
      const parsed = new URL(candidateUrl)
      const pathSegments = parsed.pathname
        .split('/')
        .map((segment) => segment.trim())
        .filter(Boolean)
      for (const segment of pathSegments.slice(-4)) {
        pushCandidate(segment)
      }
      for (const key of ['model', 'sku', 'product', 'item', 'title', 'name']) {
        pushCandidate(parsed.searchParams.get(key))
      }
      break
    } catch {
      continue
    }
  }

  if (candidates.length === 0) {
    const fallback = normalizedLink
      .replace(/^https?:\/\/[^/]+/i, '')
      .split(/[/?#&=]/)
      .map((part) => part.trim())
      .filter(Boolean)
    for (const part of fallback.slice(-6)) {
      pushCandidate(part)
    }
  }

  return candidates.sort((a, b) => scoreStoreProductNameCandidate(b) - scoreStoreProductNameCandidate(a))
}

function buildStoreProductCandidatesFromLinks(rawStoreProductLinks: unknown): any[] {
  const parsed = safeParseJson(rawStoreProductLinks, rawStoreProductLinks)
  const rawItems = Array.isArray(parsed)
    ? parsed
    : parsed
      ? [parsed]
      : []
  const candidates: any[] = []

  for (const rawItem of rawItems) {
    if (typeof rawItem === 'string') {
      const link = rawItem.trim()
      if (!link) continue
      const names = extractStoreProductNameCandidatesFromLink(link)
      candidates.push({
        name: names[0] || link,
        title: names[1],
        model: names.find((item) => /\d/.test(item)),
        link,
        url: link,
      })
      continue
    }

    if (!rawItem || typeof rawItem !== 'object') continue
    const item = rawItem as any
    const linkCandidate =
      (typeof item.url === 'string' && item.url.trim())
      || (typeof item.link === 'string' && item.link.trim())
      || (typeof item.href === 'string' && item.href.trim())
      || (typeof item.productUrl === 'string' && item.productUrl.trim())
      || (typeof item.productLink === 'string' && item.productLink.trim())
      || ''
    const names = extractStoreProductNameCandidatesFromLink(linkCandidate)
    const explicitName = getStoreProductNameCandidate(item)
    const primaryName = explicitName || names[0] || ''
    if (!primaryName && !linkCandidate) continue
    candidates.push({
      ...item,
      name: primaryName || item.name || item.title,
      title: item.title || names[1],
      model: item.model || names.find((value) => /\d/.test(value)),
      link: item.link || linkCandidate,
      url: item.url || linkCandidate,
    })
  }

  return candidates
}

function dedupeStoreProductNames(productNames: string[], limit = 3): string[] {
  const deduped: string[] = []
  const seen = new Set<string>()

  for (const productName of productNames) {
    const normalized = String(productName || '').replace(/\s+/g, ' ').trim()
    if (normalized.length < 3) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(normalized)
    if (deduped.length >= limit) break
  }

  return deduped
}

export function evaluateStoreModelIntentReadiness(params: {
  bucket: NormalizedCreativeBucket
  linkType: 'store' | 'product'
  scrapedData?: unknown
  brandAnalysis?: unknown
  storeProductLinks?: unknown
}): {
  isReady: boolean
  verifiedHotProducts: string[]
  hotProductModelAnchors: string[]
  evidenceSources: string[]
  reason?: string
} {
  if (params.linkType !== 'store' || params.bucket !== 'B') {
    return {
      isReady: true,
      verifiedHotProducts: [],
      hotProductModelAnchors: [],
      evidenceSources: [],
    }
  }

  const scrapedData = safeParseJson(params.scrapedData, null)
  const brandAnalysis = safeParseJson(params.brandAnalysis, null)
  const evidenceSources: string[] = []
  const hotProductCandidates: string[] = []
  const hotProductEvidenceTexts: string[] = []

  const appendNames = (items: any[], source: string) => {
    if (!Array.isArray(items) || items.length === 0) return
    const names = items
      .map((item) => getStoreProductNameCandidate(item))
      .filter(Boolean)
    const evidenceTexts = items.flatMap((item) => collectStoreProductEvidenceTexts(item))
    if (names.length === 0 && evidenceTexts.length === 0) return
    hotProductCandidates.push(...names)
    hotProductEvidenceTexts.push(...evidenceTexts)
    evidenceSources.push(source)
  }

  appendNames(scrapedData?.deepScrapeResults?.topProducts, 'deepScrapeResults.topProducts')
  appendNames(brandAnalysis?.hotProducts, 'brandAnalysis.hotProducts')
  appendNames(scrapedData?.products, 'scrapedData.products')
  appendNames(scrapedData?.supplementalProducts, 'scrapedData.supplementalProducts')
  appendNames(buildStoreProductCandidatesFromLinks(params.storeProductLinks), 'offer.store_product_links')

  const verifiedHotProducts = dedupeStoreProductNames(hotProductCandidates, 3)
  if (verifiedHotProducts.length === 0) {
    return {
      isReady: false,
      verifiedHotProducts,
      hotProductModelAnchors: [],
      evidenceSources,
      reason: '店铺热门商品信息不足，无法生成商品型号/产品族意图创意：未获取到可验证的热门商品，请先重抓或补充店铺商品数据。',
    }
  }

  const hotProductModelAnchors = extractModelAnchorsForPrompt([
    ...verifiedHotProducts,
    ...hotProductEvidenceTexts,
  ])
  if (hotProductModelAnchors.length === 0) {
    return {
      isReady: false,
      verifiedHotProducts,
      hotProductModelAnchors,
      evidenceSources,
      reason: '店铺热门商品信息不足，无法生成商品型号/产品族意图创意：未提取到可验证的型号/产品族锚点，请先重抓或补充店铺商品数据。',
    }
  }

  return {
    isReady: true,
    verifiedHotProducts,
    hotProductModelAnchors,
    evidenceSources,
  }
}

export function shouldRunGapAnalysisForCreative(params: {
  bucket?: string | null
  isCoverageCreative?: boolean
  deferKeywordSupplementation?: boolean
}): boolean {
  if (params.isCoverageCreative) {
    return false
  }

  const normalizedBucket = normalizeCreativeBucketType(params.bucket || null)
  if (params.deferKeywordSupplementation) {
    // D 类型始终执行 Gap Analysis，避免 defer 覆盖。
    return normalizedBucket === 'D'
  }

  return normalizedBucket === null || normalizedBucket === 'D'
}

function buildCreativeTypeConstraintSection(params: {
  bucket: NormalizedCreativeBucket
  linkType: 'store' | 'product'
  brand: string
  category: string
  productName: string
  targetCountry: string
  targetLanguage: string
  topProducts: string[]
  keywords: string[]
}): string {
  const creativeType = params.bucket === 'A'
    ? 'brand_intent'
    : params.bucket === 'B'
      ? 'model_intent'
      : params.bucket === 'D'
        ? 'product_intent'
        : 'unclassified'

  const modelAnchors = extractModelAnchorsForPrompt(params.keywords)
  const lines: string[] = [
    '## 🧭 CREATIVE TYPE CONTRACT (HARD RULES)',
    `- creativeType: ${creativeType}`,
    `- pageType: ${params.linkType}`,
    `- market: ${params.targetCountry || 'unknown'}`,
    `- language: ${params.targetLanguage || 'English'}`,
    `- brand anchor: ${params.brand || 'unknown brand'}`,
  ]

  if (params.category) {
    lines.push(`- category anchor: ${params.category}`)
  }

  if (params.productName) {
    lines.push(`- primary product anchor: ${params.productName}`)
  }

  if (params.linkType === 'store') {
    if (params.topProducts.length > 0) {
      lines.push(`- verified hot products: ${params.topProducts.join(' | ')}`)
    } else {
      lines.push('- verified hot products: none provided; do NOT invent hero SKUs, model names, or product lines.')
    }
  }

  if (modelAnchors.length > 0) {
    lines.push(`- verified model/series anchors: ${modelAnchors.join(' | ')}`)
  }

  lines.push('- Use only verified products, verified hot products, verified facts, and provided keywords. Do NOT invent new models, new series, or unsupported product relationships.')

  if (params.bucket === 'A') {
    lines.push('- brand_intent rule: every headline, description, and keyword must stay tied to BOTH the brand and a real product/category anchor.')
    lines.push('- brand_intent rule: trust language is supportive only; forbid pure brand-navigation copy such as "official store" without product context.')
    lines.push('- brand_intent keyword priority: brand + product > brand + category > brand + model > model + category.')
  } else if (params.bucket === 'B') {
    lines.push('- model_intent rule: every headline, description, and keyword must stay tightly tied to a verified model/series or verified hot product model.')
    lines.push('- model_intent rule: use exact-match purchase intent framing; forbid generic brand-only, category-only, or scenario-only copy.')
    lines.push('- model_intent keyword hard-ban: DO NOT generate template keyword strings that combine transactional modifiers with model anchors (e.g., "buy brandx x200", "brandx x200 price", "order gen 2 ring").')
    lines.push(params.linkType === 'store'
      ? '- model_intent store rule: cover multiple verified hot products when available; do not collapse into a single generic store headline.'
      : '- model_intent product rule: stay on the current product model only; do not drift into other SKUs or store-level assortment copy.')
  } else if (params.bucket === 'D') {
    lines.push('- product_intent rule: keep the first anchor on product demand, not brand trust.')
    lines.push('- product_intent rule: headlines/descriptions should prioritize category, function, scenario, product line, or use-case coverage grounded in the brand.')
    lines.push('- product_intent rule: forbid generic brand slogans that do not point back to a concrete product demand or product family.')
  }

  return `\n${lines.join('\n')}\n`
}

function buildTypeIntentGuidanceSection(
  bucket: NormalizedCreativeBucket,
  keywords: string[],
  languageCode: string
): string {
  const intents = detectKeywordIntentsForPrompt(keywords, languageCode)
  const transactionalLine = intents.transactional.length > 0 ? intents.transactional.join(', ') : 'N/A'
  const scenarioLine = intents.scenario.length > 0 ? intents.scenario.join(', ') : 'N/A'
  const solutionLine = intents.solution.length > 0 ? intents.solution.join(', ') : 'N/A'

  const baseRules = `
## 🎯 TYPE-SPECIFIC INTENT USAGE (NON-DESTRUCTIVE)
- Use ONLY provided keywords. Do NOT invent or replace keyword list items.
- Keep existing A/B/D type semantics. This section guides copy usage only.
- If one intent group has no keyword candidates, reuse existing keywords naturally without forcing.`

  if (bucket === 'A') {
    return `${baseRules}
- Bucket A focus: brand + product anchor first, trust second.
- Every asset must clearly point back to a real product/category anchor from the brand.
- Prefer trust-oriented expressions in 1-2 descriptions only as support; keep product relevance explicit.
- Never write pure brand/store navigation copy without product context.
- Transactional keyword candidates: ${transactionalLine}
- Scenario keyword candidates (supportive only): ${scenarioLine}`
  }

  if (bucket === 'B') {
    return `${baseRules}
- Bucket B focus: verified model/series purchase intent.
- Keep copy precise and model-led; treat scenario/solution wording as secondary support only.
- At least 2 descriptions should reinforce model/series fit, specifications, or buying action.
- Do NOT output transactional+model template keywords (avoid forms like "buy X200", "X200 price", "order Gen 2").
- Scenario keyword candidates (support only): ${scenarioLine}
- Solution keyword candidates (support only): ${solutionLine}
- Transactional keyword candidates (primary): ${transactionalLine}
- Do not let scenario wording dominate over the model/series anchor.`
  }

  if (bucket === 'D') {
    return `${baseRules}
- Bucket D focus: product demand coverage grounded in brand + category/feature/scenario.
- Ensure at least 1 description emphasizes a concrete demand-solving angle with compliant evidence.
- Prioritize feature, scenario, and product-line language over generic brand slogans.
- Transactional keyword candidates (supportive): ${transactionalLine}
- Scenario keyword candidates (primary): ${scenarioLine}
- Solution keyword candidates (primary/supportive): ${solutionLine}`
  }

  return `${baseRules}
- Bucket not specified. Keep balanced copy intent usage with current keywords.
- Transactional keyword candidates: ${transactionalLine}
- Scenario keyword candidates: ${scenarioLine}
- Solution keyword candidates: ${solutionLine}`
}

function normalizePersonaOrScenarioPhrase(value: string, maxWords: number, maxChars: number): string {
  const cleaned = String(value || '')
    .replace(/[|/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''

  const words = cleaned.split(' ').filter(Boolean).slice(0, maxWords)
  const joined = words.join(' ')
  if (joined.length <= maxChars) return joined
  return joined.slice(0, maxChars).trim()
}

function splitAudienceCandidates(targetAudience: string): string[] {
  const raw = String(targetAudience || '').trim()
  if (!raw) return []
  return raw
    .split(/[;,|/]/g)
    .map(segment => normalizePersonaOrScenarioPhrase(segment, 6, 40))
    .filter(Boolean)
}

function dedupePhrases(phrases: string[], limit: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const phrase of phrases) {
    const normalized = phrase.toLowerCase()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(phrase)
    if (out.length >= limit) break
  }
  return out
}

function buildPersonaScenarioGuidanceSection(params: {
  bucket: NormalizedCreativeBucket
  targetAudience: string
  useCases: string[]
  userProfiles: Array<{ profile: string; indicators?: string[] }>
  linkType: 'store' | 'product'
}): string {
  const personaCandidates = dedupePhrases([
    ...params.userProfiles.map(profile => normalizePersonaOrScenarioPhrase(profile?.profile || '', 6, 40)),
    ...splitAudienceCandidates(params.targetAudience),
  ], 4)
  const scenarioCandidates = dedupePhrases(
    (params.useCases || []).map(useCase => normalizePersonaOrScenarioPhrase(useCase, 8, 55)),
    5
  )

  const personaLine = personaCandidates.length > 0 ? personaCandidates.join(' | ') : 'Use inferred buyer persona from audience intent'
  const scenarioLine = scenarioCandidates.length > 0 ? scenarioCandidates.join(' | ') : 'Use one concrete real-world use scenario'
  const linkTypeHint = params.linkType === 'store'
    ? 'Store page: persona/scenario should guide exploration and trust, not only hard sell.'
    : 'Product page: persona/scenario must stay focused on the single product.'

  const baseRules = `
## 👤 PERSONA + SCENARIO COPY MODE (KISS)
- Write in a realistic user voice (what a real shopper would say), not abstract brand slogans.
- Each asset should center on ONE clear persona and ONE concrete scenario.
- Avoid mixing unrelated personas/scenarios in the same sentence.
- Persona candidates: ${personaLine}
- Scenario candidates: ${scenarioLine}
- ${linkTypeHint}`

  if (params.bucket === 'A') {
    return `${baseRules}
- Bucket A emotion rule: prioritize reassurance and trust language.
- Persona/scenario can support trust, but each asset must still land on brand + product relevance.
- If pain is mentioned, keep it light and brief (max 1 description).
- Avoid fear/shame-heavy wording.`
  }

  if (params.bucket === 'B') {
    return `${baseRules}
- Bucket B emotion rule: keep persona/scenario subordinate to the verified model/series anchor.
- Prefer practical purchase-fit language over broad pain-solution storytelling.
- Avoid store-exploration phrasing, generic assortment copy, and over-broad scenarios.
- Keep tone practical, precise, and conversion-oriented.`
  }

  if (params.bucket === 'D') {
    return `${baseRules}
- Bucket D emotion rule: emphasize value/action with clear CTA.
- Product demand, use-case, and function should be the main narrative lens.
- Use light loss-aversion only when evidence supports urgency/offer.
- Avoid fear/shame-heavy wording; keep conversion tone direct and positive.`
  }

  return `${baseRules}
- Keep a balanced tone across trust, scenario, and value.`
}

function normalizeSearchTermHintsTerms(terms: string[] | undefined, limit: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  for (const raw of terms || []) {
    const cleaned = String(raw || '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!cleaned || cleaned.length < 2 || cleaned.length > 60) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(cleaned)
    if (out.length >= limit) break
  }

  return out
}

function buildRetryFailureGuidanceSection(retryFailureType?: RetryFailureType): string {
  if (!retryFailureType) return ''

  if (retryFailureType === 'evidence_fail') {
    return `
## ♻️ RETRY FOCUS: EVIDENCE ALIGNMENT
- Remove any unverified numbers, guarantees, rankings, and price promises.
- Rebuild copy around verified facts only (promotion, stock, service, support, official signals).
- Prefer concrete but compliant proof language over exaggerated claims.`
  }

  if (retryFailureType === 'intent_fail') {
    return `
## ♻️ RETRY FOCUS: INTENT ALIGNMENT
- Increase search-intent match in headlines and first two descriptions.
- Keep value proposition explicit and add clearer action language.
- Use high-intent keywords naturally in copy, not as isolated keyword stuffing.`
  }

  return `
## ♻️ RETRY FOCUS: FORMAT/DELIVERY
- Prioritize RSA structure quality: clearer headline roles and stronger complementarity.
- Reduce repetitive wording; keep each headline serving a distinct angle.
- Keep descriptions concise, direct, and CTA-complete with no formatting violations.`
}

function buildSearchTermFeedbackGuidanceSection(
  hints?: SearchTermFeedbackHintsInput
): { hardTerms: string[]; softTerms: string[]; highTerms: string[]; section: string } {
  const hardTerms = normalizeSearchTermHintsTerms(hints?.hardNegativeTerms, 12)
  const softTerms = normalizeSearchTermHintsTerms(hints?.softSuppressTerms, 12)
  const highTerms = normalizeSearchTermHintsTerms(hints?.highPerformingTerms, 12)

  if (hardTerms.length === 0 && softTerms.length === 0 && highTerms.length === 0) {
    return { hardTerms, softTerms, highTerms, section: '' }
  }

  const lines: string[] = [
    '## 🔁 SEARCH-TERM FEEDBACK (RECENT PERFORMANCE)',
    '- Use this feedback to improve relevance and keyword selection.'
  ]

  if (highTerms.length > 0) {
    lines.push(`- ✅ HIGH-PERFORMING TERMS: ${highTerms.join(', ')} (prioritize these themes and related keywords).`)
  }
  if (hardTerms.length > 0) {
    lines.push(`- ❌ HARD EXCLUDE TERMS: ${hardTerms.join(', ')} (do not use in copy or generated keywords).`)
  }
  if (softTerms.length > 0) {
    lines.push(`- ⚠️ SOFT SUPPRESS TERMS: ${softTerms.join(', ')} (deprioritize unless absolutely necessary).`)
  }

  return {
    hardTerms,
    softTerms,
    highTerms,
    section: lines.join('\n')
  }
}

function classifyCopyIntentFromText(text: string, languageCode: string, keywords: string[] = []): CopyIntentTag {
  const normalized = String(text || '').toLowerCase()
  if (!normalized) return 'other'
  const patterns = getCopyPatterns(languageCode)

  if (patterns.trust.test(normalized)) return 'brand'
  if (patterns.transactional.test(normalized)) return 'transactional'
  if (patterns.scenario.test(normalized)) return 'scenario'
  if (patterns.solution.test(normalized)) return 'solution'

  for (const keyword of keywords) {
    const kw = String(keyword || '').trim()
    if (!kw) continue
    if (!normalized.includes(kw.toLowerCase())) continue
    const intent = classifyKeywordIntent(kw, { language: languageCode }).intent
    if (intent === 'TRANSACTIONAL') return 'transactional'
    if (intent === 'COMMERCIAL') return 'scenario'
  }

  return 'other'
}

function mapToComplementarityTag(tag: CopyIntentTag): ComplementarityTag {
  if (tag === 'brand' || tag === 'scenario' || tag === 'transactional') {
    return tag
  }
  // Keep compatibility with existing keyword intent taxonomy (brand/scenario/function):
  // "solution/function-like" copy is treated as scenario-equivalent for complementarity.
  if (tag === 'solution') {
    return 'scenario'
  }
  return 'other'
}

function classifyDescriptionStructure(text: string, intentTag: CopyIntentTag, languageCode: string): DescriptionStructureTag {
  const normalized = String(text || '').toLowerCase()
  if (!normalized) return 'other'
  const patterns = getCopyPatterns(languageCode)
  const hasPain = patterns.pain.test(normalized)
  const hasSolution = patterns.solution.test(normalized)
  const hasTrust = patterns.trust.test(normalized)
  const hasValue = patterns.transactional.test(normalized)
  const hasCta = patterns.cta.test(normalized)

  if (hasPain && hasSolution && hasCta) return 'pain_solution_cta'
  if (hasTrust && hasCta) return 'trust_cta'
  if ((intentTag === 'transactional' || hasValue) && hasCta) return 'value_cta'
  if (hasCta) return 'benefit_cta'
  return 'other'
}

function fitLocalizedDescription(base: string, cta: string, maxLength: number): string {
  const cleanBase = String(base || '').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '')
  if (!cleanBase) return cta
  let candidate = `${cleanBase}. ${cta}`.trim()
  if (candidate.length <= maxLength) return candidate

  const budget = Math.max(8, maxLength - cta.length - 2)
  const trimmedBase = truncateSnippetByWords(cleanBase, budget).replace(/[.!?]+$/, '')
  candidate = `${trimmedBase}. ${cta}`.trim()
  if (candidate.length <= maxLength) return candidate
  return applyDescriptionTextGuardrail(candidate, maxLength)
}

function fitLocalizedHeadline(base: string, maxLength: number): string {
  const cleaned = String(base || '').replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxLength) return cleaned
  return truncateSnippetByWords(cleaned, maxLength)
}

interface SoftCopyTemplates {
  a: {
    trustDescription: { base: string; cta: string }
    brandHeadline: string
  }
  b: {
    painSolution1: { base: string; cta: string }
    painSolution2: { base: string; cta: string }
    scenarioHeadline: string
  }
  d: {
    valueDescription: { base: string; cta: string }
    transactionalHeadline: string
  }
}

function getSoftCopyTemplates(
  language: SupportedSoftCopyLanguage,
  preferredKeyword: string,
  brandSeed: string
): SoftCopyTemplates {
  if (language === 'fr') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} avec support officiel et qualité fiable`,
          cta: 'En savoir plus'
        },
        brandHeadline: `Support officiel ${brandSeed}`
      },
      b: {
        painSolution1: {
          base: `Besoin de résultats fiables au quotidien ? ${preferredKeyword} vous aide à avancer sereinement`,
          cta: 'En savoir plus'
        },
        painSolution2: {
          base: `${preferredKeyword} offre une performance stable pour vos besoins quotidiens`,
          cta: 'Acheter maintenant'
        },
        scenarioHeadline: 'Meilleurs résultats au quotidien ?'
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} offre un excellent rapport qualité-prix et une performance fiable`,
          cta: 'Acheter maintenant'
        },
        transactionalHeadline: `Achetez ${preferredKeyword} aujourd'hui`
      }
    }
  }

  if (language === 'de') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} mit offiziellem Support und zuverlässiger Qualität`,
          cta: 'Mehr erfahren'
        },
        brandHeadline: `Offizieller ${brandSeed} Support`
      },
      b: {
        painSolution1: {
          base: `Brauchen Sie verlässliche Ergebnisse im Alltag? ${preferredKeyword} unterstützt Sie zuverlässig`,
          cta: 'Mehr erfahren'
        },
        painSolution2: {
          base: `${preferredKeyword} liefert stabile Leistung für tägliche Anforderungen`,
          cta: 'Jetzt kaufen'
        },
        scenarioHeadline: 'Bessere Ergebnisse im Alltag?'
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} bietet starken Alltagswert und zuverlässige Leistung`,
          cta: 'Jetzt kaufen'
        },
        transactionalHeadline: `Kaufen Sie ${preferredKeyword} heute`
      }
    }
  }

  if (language === 'es') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} con soporte oficial y calidad confiable`,
          cta: 'Más información'
        },
        brandHeadline: `Soporte oficial ${brandSeed}`
      },
      b: {
        painSolution1: {
          base: `¿Necesitas resultados fiables cada día? ${preferredKeyword} te ayuda con rendimiento constante`,
          cta: 'Más información'
        },
        painSolution2: {
          base: `${preferredKeyword} ofrece confianza y desempeño para necesidades diarias`,
          cta: 'Comprar ahora'
        },
        scenarioHeadline: '¿Mejores resultados diarios?'
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} ofrece valor diario y rendimiento confiable`,
          cta: 'Comprar ahora'
        },
        transactionalHeadline: `Compra ${preferredKeyword} hoy`
      }
    }
  }

  if (language === 'it') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} con supporto ufficiale e qualità affidabile`,
          cta: 'Scopri di più'
        },
        brandHeadline: `Supporto ufficiale ${brandSeed}`
      },
      b: {
        painSolution1: {
          base: `Vuoi risultati affidabili ogni giorno? ${preferredKeyword} ti aiuta con prestazioni costanti`,
          cta: 'Scopri di più'
        },
        painSolution2: {
          base: `${preferredKeyword} offre affidabilità e performance per esigenze quotidiane`,
          cta: 'Acquista ora'
        },
        scenarioHeadline: 'Risultati migliori ogni giorno?'
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} offre valore quotidiano e prestazioni affidabili`,
          cta: 'Acquista ora'
        },
        transactionalHeadline: `Acquista ${preferredKeyword} oggi`
      }
    }
  }

  if (language === 'pt') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} com suporte oficial e qualidade confiável`,
          cta: 'Saiba mais'
        },
        brandHeadline: `Suporte oficial ${brandSeed}`
      },
      b: {
        painSolution1: {
          base: `Precisa de resultados confiáveis no dia a dia? ${preferredKeyword} ajuda com desempenho estável`,
          cta: 'Saiba mais'
        },
        painSolution2: {
          base: `${preferredKeyword} oferece confiança e performance para necessidades diárias`,
          cta: 'Comprar agora'
        },
        scenarioHeadline: 'Melhores resultados no dia a dia?'
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} oferece valor diário e desempenho confiável`,
          cta: 'Comprar agora'
        },
        transactionalHeadline: `Compre ${preferredKeyword} hoje`
      }
    }
  }

  if (language === 'zh') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} 官方支持，品质可靠`,
          cta: '了解更多'
        },
        brandHeadline: `${brandSeed} 官方支持`
      },
      b: {
        painSolution1: {
          base: `需要稳定可靠的日常表现吗？${preferredKeyword} 助你持续发挥更好`,
          cta: '了解更多'
        },
        painSolution2: {
          base: `${preferredKeyword} 为日常需求带来稳定表现与信心`,
          cta: '立即购买'
        },
        scenarioHeadline: '想要更好的日常表现吗？'
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} 兼顾价值与性能，日常使用更放心`,
          cta: '立即购买'
        },
        transactionalHeadline: `今日选购 ${preferredKeyword}`
      }
    }
  }

  if (language === 'ja') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} は公式サポート付きで安心品質`,
          cta: '詳しく見る'
        },
        brandHeadline: `公式 ${brandSeed} サポート`
      },
      b: {
        painSolution1: {
          base: `毎日の成果を安定させたいですか？${preferredKeyword} がしっかり支えます`,
          cta: '詳しく見る'
        },
        painSolution2: {
          base: `${preferredKeyword} は日常ニーズに安定したパフォーマンスを提供します`,
          cta: '今すぐ購入'
        },
        scenarioHeadline: '日々の成果を高めたいですか？'
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} は毎日の作業で価値と性能を両立`,
          cta: '今すぐ購入'
        },
        transactionalHeadline: `${preferredKeyword} を今日購入`
      }
    }
  }

  if (language === 'ko') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} 공식 지원으로 믿을 수 있는 품질`,
          cta: '자세히 보기'
        },
        brandHeadline: `${brandSeed} 공식 지원`
      },
      b: {
        painSolution1: {
          base: `매일 더 안정적인 결과가 필요하신가요? ${preferredKeyword} 가 꾸준히 도와줍니다`,
          cta: '자세히 보기'
        },
        painSolution2: {
          base: `${preferredKeyword} 는 일상 니즈에 안정적인 성능과 신뢰를 제공합니다`,
          cta: '지금 구매'
        },
        scenarioHeadline: '일상 성과를 더 높이고 싶나요?'
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} 는 일상 작업에서 가치와 성능을 제공합니다`,
          cta: '지금 구매'
        },
        transactionalHeadline: `오늘 ${preferredKeyword} 구매`
      }
    }
  }

  if (language === 'ru') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} с официальной поддержкой и надежным качеством`,
          cta: 'Узнать больше'
        },
        brandHeadline: `Официальная поддержка ${brandSeed}`
      },
      b: {
        painSolution1: {
          base: `Нужны стабильные результаты каждый день? ${preferredKeyword} помогает уверенно двигаться дальше`,
          cta: 'Узнать больше'
        },
        painSolution2: {
          base: `${preferredKeyword} обеспечивает надежную работу для ежедневных задач`,
          cta: 'Купить сейчас'
        },
        scenarioHeadline: 'Лучшие результаты каждый день?'
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} дает отличную ценность и надежную работу каждый день`,
          cta: 'Купить сейчас'
        },
        transactionalHeadline: `Купите ${preferredKeyword} сегодня`
      }
    }
  }

  if (language === 'ar') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} مع دعم رسمي وجودة موثوقة`,
          cta: 'اعرف المزيد'
        },
        brandHeadline: `دعم رسمي ${brandSeed}`
      },
      b: {
        painSolution1: {
          base: `هل تحتاج نتائج موثوقة كل يوم؟ ${preferredKeyword} يساعدك بأداء ثابت`,
          cta: 'اعرف المزيد'
        },
        painSolution2: {
          base: `${preferredKeyword} يمنحك ثباتًا وثقة لاحتياجاتك اليومية`,
          cta: 'اشتري الآن'
        },
        scenarioHeadline: 'تريد نتائج يومية أفضل؟'
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} يمنحك قيمة يومية وأداءً موثوقًا`,
          cta: 'اشتري الآن'
        },
        transactionalHeadline: `اشتر ${preferredKeyword} اليوم`
      }
    }
  }

  return {
    a: {
      trustDescription: {
        base: `${preferredKeyword} with official support and trusted quality`,
        cta: 'Learn More'
      },
      brandHeadline: `Official ${brandSeed} Support`
    },
    b: {
      painSolution1: {
        base: `Need dependable results every day? ${preferredKeyword} helps you stay confident and efficient`,
        cta: 'Learn More'
      },
      painSolution2: {
        base: `Get reliable everyday performance with ${preferredKeyword} designed for daily use`,
        cta: 'Shop Now'
      },
      scenarioHeadline: 'Need Better Everyday Results?'
    },
    d: {
      valueDescription: {
        base: `${preferredKeyword} delivers everyday value with trusted performance`,
        cta: 'Shop Now'
      },
      transactionalHeadline: `Buy ${preferredKeyword} Today`
    }
  }
}

function getDefaultProductNoun(language: SupportedSoftCopyLanguage): string {
  if (language === 'fr') return 'ce produit'
  if (language === 'de') return 'dieses Produkt'
  if (language === 'es') return 'este producto'
  if (language === 'it') return 'questo prodotto'
  if (language === 'pt') return 'este produto'
  if (language === 'zh') return '这款产品'
  if (language === 'ja') return 'この製品'
  if (language === 'ko') return '이 제품'
  if (language === 'ru') return 'этот продукт'
  if (language === 'ar') return 'هذا المنتج'
  return 'our product'
}

const STRONG_NEGATIVE_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bpanic(?:king|ed)?\b/gi, replacement: 'concern' },
  { pattern: /\bterrified\b/gi, replacement: 'worried' },
  { pattern: /\bdesperate\b/gi, replacement: 'eager' },
  { pattern: /\bashamed?\b/gi, replacement: 'uncomfortable' },
  { pattern: /\bembarrass(?:ed|ing)?\b/gi, replacement: 'inconvenient' },
  { pattern: /\bhumiliat(?:e|ed|ing)\b/gi, replacement: 'frustrating' },
  { pattern: /\bdisaster\b/gi, replacement: 'setback' },
  { pattern: /\bsuffer(?:ing|ed)?\b/gi, replacement: 'deal with' },
]

function applyStrongNegativeSoftening(text: string): { text: string; changed: boolean } {
  let updated = String(text || '')
  let changed = false
  for (const rule of STRONG_NEGATIVE_REPLACEMENTS) {
    const next = updated.replace(rule.pattern, rule.replacement)
    if (next !== updated) {
      changed = true
      updated = next
    }
  }
  return { text: updated, changed }
}

function countStrongNegativeMatches(texts: string[]): number {
  const joined = texts.join(' ')
  let total = 0
  for (const rule of STRONG_NEGATIVE_REPLACEMENTS) {
    const matches = joined.match(new RegExp(rule.pattern.source, 'gi')) || []
    total += matches.length
  }
  return total
}

function enforceEmotionBoundaryByBucket(
  result: GeneratedAdCreativeData,
  bucket: NormalizedCreativeBucket,
  languageCode: string
): { fixes: number } {
  const softLanguage = resolveSoftCopyLanguage(languageCode)
  if (!bucket || softLanguage !== 'en') return { fixes: 0 }

  const headlines = [...(result.headlines || [])]
  const descriptions = [...(result.descriptions || [])]
  let fixes = 0

  const allowStrongNegativeCount = bucket === 'B' ? 2 : 0
  const currentStrongNegativeCount = countStrongNegativeMatches([...headlines, ...descriptions])
  if (currentStrongNegativeCount <= allowStrongNegativeCount) {
    return { fixes: 0 }
  }

  const softenText = (text: string): string => {
    const softened = applyStrongNegativeSoftening(text)
    if (softened.changed) fixes += 1
    return softened.text
  }

  const updatedHeadlines = headlines.map(softenText)
  const updatedDescriptions = descriptions.map(softenText)
  if (fixes > 0) {
    result.headlines = updatedHeadlines
    result.descriptions = updatedDescriptions
  }

  return { fixes }
}

export function softlyReinforceTypeCopy(
  result: GeneratedAdCreativeData,
  bucket: NormalizedCreativeBucket,
  languageCode: string,
  brandName: string
): { headlineFixes: number; descriptionFixes: number } {
  const softLanguage = resolveSoftCopyLanguage(languageCode)
  if (!bucket || !softLanguage) return { headlineFixes: 0, descriptionFixes: 0 }

  const headlines = [...(result.headlines || [])]
  const descriptions = [...(result.descriptions || [])]
  const keywords = [...(result.keywords || [])]

  if (headlines.length === 0 || descriptions.length === 0) return { headlineFixes: 0, descriptionFixes: 0 }

  let headlineFixes = 0
  let descriptionFixes = 0
  const patterns = getCopyPatterns(softLanguage)
  const preferredKeyword = keywords.find((kw) => kw.length <= 24) || brandName || getDefaultProductNoun(softLanguage)
  const brandSeed = String(brandName || preferredKeyword).trim() || preferredKeyword
  const templates = getSoftCopyTemplates(softLanguage, preferredKeyword, brandSeed)

  const headlineTags = headlines.map((h) => classifyCopyIntentFromText(h, languageCode, keywords))
  const descriptionTags = descriptions.map((d) => classifyCopyIntentFromText(d, languageCode, keywords))
  const descriptionStructures = descriptions.map((d, idx) => classifyDescriptionStructure(d, descriptionTags[idx], languageCode))

  const replaceHeadline = (index: number, text: string) => {
    if (index < 0 || index >= headlines.length) return
    const fitted = fitLocalizedHeadline(text, 30)
    if (!fitted || fitted === headlines[index]) return
    headlines[index] = fitted
    headlineFixes += 1
  }
  const replaceDescription = (index: number, base: string, cta: string) => {
    if (index < 0 || index >= descriptions.length) return
    const fitted = fitLocalizedDescription(base, cta, 90)
    if (!fitted || fitted === descriptions[index]) return
    descriptions[index] = fitted
    descriptionFixes += 1
  }

  if (bucket === 'A') {
    const trustDescCount = descriptions.filter((d) => patterns.trust.test(d)).length
    if (trustDescCount < 1) {
      replaceDescription(
        descriptions.length - 1,
        templates.a.trustDescription.base,
        templates.a.trustDescription.cta
      )
    }
    const brandHeadlineCount = headlineTags.filter((tag) => tag === 'brand').length
    if (brandHeadlineCount < 2 && headlines.length > 1) {
      replaceHeadline(headlines.length - 1, templates.a.brandHeadline)
    }
  } else if (bucket === 'B') {
    const painSolutionCount = descriptionStructures.filter((tag) => tag === 'pain_solution_cta').length
    if (painSolutionCount < 2) {
      replaceDescription(
        Math.max(0, descriptions.length - 2),
        templates.b.painSolution1.base,
        templates.b.painSolution1.cta
      )
      replaceDescription(
        descriptions.length - 1,
        templates.b.painSolution2.base,
        templates.b.painSolution2.cta
      )
    }
    const scenarioHeadlineCount = headlineTags.filter((tag) => tag === 'scenario').length
    if (scenarioHeadlineCount < 2 && headlines.length > 1) {
      replaceHeadline(headlines.length - 1, templates.b.scenarioHeadline)
    }
  } else if (bucket === 'D') {
    const transactionalDescCount = descriptionTags.filter((tag) => tag === 'transactional').length
    if (transactionalDescCount < 1) {
      replaceDescription(
        descriptions.length - 1,
        templates.d.valueDescription.base,
        templates.d.valueDescription.cta
      )
    }
    const transactionalHeadlineCount = headlineTags.filter((tag) => tag === 'transactional').length
    if (transactionalHeadlineCount < 2 && headlines.length > 1) {
      replaceHeadline(headlines.length - 1, templates.d.transactionalHeadline)
    }
  }

  result.headlines = headlines
  result.descriptions = descriptions
  return { headlineFixes, descriptionFixes }
}

export function enforceHeadlineComplementarity(
  result: GeneratedAdCreativeData,
  languageCode: string,
  brandName: string,
  bucket: NormalizedCreativeBucket = null
): { fixes: number; brandCount: number; scenarioCount: number; transactionalCount: number } {
  const headlines = [...(result.headlines || [])]
  const keywords = [...(result.keywords || [])]
  if (headlines.length < 3) {
    return { fixes: 0, brandCount: 0, scenarioCount: 0, transactionalCount: 0 }
  }

  const softLanguage = resolveSoftCopyLanguage(languageCode)
  if (!softLanguage) {
    return { fixes: 0, brandCount: 0, scenarioCount: 0, transactionalCount: 0 }
  }

  const preferredKeyword = keywords.find((kw) => kw.length <= 24) || brandName || getDefaultProductNoun(softLanguage)
  const brandSeed = String(brandName || preferredKeyword).trim() || preferredKeyword
  const templates = getSoftCopyTemplates(softLanguage, preferredKeyword, brandSeed)
  let fixes = 0

  const classifyTags = () =>
    headlines.map((h) => mapToComplementarityTag(classifyCopyIntentFromText(h, languageCode, keywords)))
  let tags = classifyTags()
  const countTag = (tag: 'brand' | 'scenario' | 'transactional') => tags.filter((t) => t === tag).length
  const topWindowStart = 1 // index 0 is reserved for DKI headline and must not be modified.
  const topWindowEndExclusive = Math.min(9, headlines.length) // editable top-8 window: [1, 8]
  const keywordIntents = detectKeywordIntentsForPrompt(keywords, languageCode)
  const hasScenarioSignal = keywordIntents.scenario.length > 0 || keywordIntents.solution.length > 0
  const hasTransactionalSignal = keywordIntents.transactional.length > 0

  let minBrand = 1
  let minScenario = hasScenarioSignal ? 1 : 0
  let minTransactional = hasTransactionalSignal ? 1 : 0

  if (bucket === 'A') {
    minBrand = 2
  } else if (bucket === 'B') {
    minBrand = 1
    minScenario = Math.max(1, minScenario)
  } else if (bucket === 'D') {
    minBrand = 1
    minTransactional = Math.max(1, minTransactional)
  } else {
    // Unknown bucket: keep conservative baseline while still honoring observed keyword signals.
    minBrand = 2
    minScenario = Math.max(1, minScenario)
    minTransactional = Math.max(1, minTransactional)
  }

  const replaceHeadlineByTag = (
    targetTag: 'brand' | 'scenario' | 'transactional',
    text: string,
    options?: { topWindowOnly?: boolean }
  ): boolean => {
    const fitted = fitLocalizedHeadline(text, 30)
    if (!fitted) return false

    const tryReplaceInRange = (start: number, end: number): boolean => {
      if (start < end || end < 1) return false
      for (let i = start; i >= end; i -= 1) {
        if (i <= 0 || i >= headlines.length) continue
        if (tags[i] === targetTag) continue
        const duplicated = headlines.some((h, idx) => idx !== i && h.toLowerCase() === fitted.toLowerCase())
        if (duplicated) continue
        if (headlines[i] === fitted) continue
        headlines[i] = fitted
        fixes += 1
        tags = classifyTags()
        return true
      }
      return false
    }

    // Prefer fixing within top-8 headlines first, so complementarity is visible in RSA primary mix.
    const replacedTop = tryReplaceInRange(topWindowEndExclusive - 1, topWindowStart)
    if (replacedTop || options?.topWindowOnly) {
      return replacedTop
    }

    return tryReplaceInRange(headlines.length - 1, Math.max(topWindowStart, topWindowEndExclusive))
  }

  const enforceMinimumTagCount = (
    tag: 'brand' | 'scenario' | 'transactional',
    min: number,
    template: string
  ) => {
    if (min <= 0) return
    while (countTag(tag) < min) {
      const replaced = replaceHeadlineByTag(tag, template)
      if (!replaced) break
    }
  }

  // Keep complementarity aligned with bucket theme and observed keyword-intent signals.
  enforceMinimumTagCount('brand', minBrand, templates.a.brandHeadline)
  enforceMinimumTagCount('scenario', minScenario, templates.b.scenarioHeadline)
  enforceMinimumTagCount('transactional', minTransactional, templates.d.transactionalHeadline)

  // Avoid excessive concentration in editable top-8 headlines (index 1-8, excluding DKI at index 0).
  const topWindow = tags.slice(topWindowStart, topWindowEndExclusive).filter((t) => t !== 'other')
  const distribution = topWindow.reduce<Record<string, number>>((acc, tag) => {
    acc[tag] = (acc[tag] || 0) + 1
    return acc
  }, {})
  const dominantEntry = Object.entries(distribution).sort((a, b) => b[1] - a[1])[0]
  if (dominantEntry && dominantEntry[1] >= 6) {
    const candidateOrderByDominant: Record<string, Array<'brand' | 'scenario' | 'transactional'>> = {
      brand: ['scenario', 'transactional'],
      scenario: ['transactional', 'brand'],
      transactional: ['scenario', 'brand']
    }
    const candidateOrder = candidateOrderByDominant[dominantEntry[0]] || ['scenario', 'transactional', 'brand']
    for (const candidate of candidateOrder) {
      if (candidate === 'scenario' && minScenario <= 0) continue
      if (candidate === 'transactional' && minTransactional <= 0) continue
      if (candidate === 'brand' && minBrand <= 0) continue
      const template = candidate === 'brand'
        ? templates.a.brandHeadline
        : candidate === 'scenario'
          ? templates.b.scenarioHeadline
          : templates.d.transactionalHeadline
      const replaced = replaceHeadlineByTag(candidate, template, { topWindowOnly: true })
      if (replaced) break
    }
  }

  result.headlines = headlines
  tags = classifyTags()
  return {
    fixes,
    brandCount: tags.filter((t) => t === 'brand').length,
    scenarioCount: tags.filter((t) => t === 'scenario').length,
    transactionalCount: tags.filter((t) => t === 'transactional').length
  }
}

export function enforceLanguagePurityGate(
  result: GeneratedAdCreativeData,
  bucket: NormalizedCreativeBucket,
  languageCode: string,
  brandName: string
): { headlineFixes: number; descriptionFixes: number } {
  const softLanguage = resolveSoftCopyLanguage(languageCode)
  if (!softLanguage) {
    return { headlineFixes: 0, descriptionFixes: 0 }
  }

  const headlines = [...(result.headlines || [])]
  const descriptions = [...(result.descriptions || [])]
  const keywords = [...(result.keywords || [])]
  const languageSafeKeywords = keywords.filter((keyword) => isKeywordCompatibleWithCreativeLanguage(keyword, languageCode))
  const preferredKeyword = languageSafeKeywords.find((kw) => kw.length <= 24)
    || languageSafeKeywords[0]
    || keywords.find((kw) => kw.length <= 24)
    || brandName
    || getDefaultProductNoun(softLanguage)
  const brandSeed = String(brandName || preferredKeyword).trim() || preferredKeyword
  const templates = getSoftCopyTemplates(softLanguage, preferredKeyword, brandSeed)

  const fallbackHeadline = bucket === 'A'
    ? templates.a.brandHeadline
    : bucket === 'B'
      ? templates.b.scenarioHeadline
      : templates.d.transactionalHeadline
  const fallbackDescription = bucket === 'A'
    ? templates.a.trustDescription
    : bucket === 'B'
      ? templates.b.painSolution1
      : templates.d.valueDescription

  let headlineFixes = 0
  for (let index = 1; index < headlines.length; index += 1) {
    if (isHeadlineCompatibleWithTargetLanguage(headlines[index], languageCode)) continue
    const replacementSeed = index <= 3 ? `${brandSeed} ${preferredKeyword}` : fallbackHeadline
    const replacement = applyHeadlineTextGuardrail(fitLocalizedHeadline(replacementSeed, 30), 30)
    if (!replacement || replacement === headlines[index]) continue
    headlines[index] = replacement
    syncHeadlineMetadataSlot(result, index, replacement)
    headlineFixes += 1
  }

  let descriptionFixes = 0
  for (let index = 0; index < descriptions.length; index += 1) {
    if (isHeadlineCompatibleWithTargetLanguage(descriptions[index], languageCode)) continue
    const replacement = applyDescriptionTextGuardrail(
      fitLocalizedDescription(fallbackDescription.base, fallbackDescription.cta, 90),
      90
    )
    if (!replacement || replacement === descriptions[index]) continue
    descriptions[index] = replacement
    descriptionFixes += 1
  }

  if (headlineFixes > 0) result.headlines = headlines
  if (descriptionFixes > 0) result.descriptions = descriptions

  return { headlineFixes, descriptionFixes }
}

export function enforceHeadlineUniquenessGate(
  result: GeneratedAdCreativeData,
  languageCode: string,
  brandName: string,
  usagePlan?: CreativeKeywordUsagePlan | null
): { fixes: number } {
  const headlines = [...(result.headlines || [])]
  if (headlines.length <= 1) return { fixes: 0 }

  const keywords = [...(result.keywords || [])]
  const protectedHeadlines = headlines.slice(0, Math.min(RETAINED_KEYWORD_PROTECTED_HEADLINE_COUNT, headlines.length))
  const seen = new Set<string>()
  const softLanguage = resolveSoftCopyLanguage(languageCode) || 'en'
  let fixes = 0

  const normalize = (value: string) => normalizeHeadlineForProtectedSimilarity(value, brandName, languageCode)
  const pickKeywordTarget = (index: number): string => {
    if (
      usagePlan
      && index >= RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX
      && index < RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX + usagePlan.headlineKeywordTargets.length
    ) {
      return usagePlan.headlineKeywordTargets[index - RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX]
    }
    return keywords[(index - 1) % Math.max(1, keywords.length)] || ''
  }

  for (let index = 0; index < headlines.length; index += 1) {
    const current = headlines[index]
    const normalizedCurrent = normalize(current)
    if (!normalizedCurrent) continue
    if (!seen.has(normalizedCurrent)) {
      seen.add(normalizedCurrent)
      continue
    }

    const keywordTarget = pickKeywordTarget(index)
    let replacement = keywordTarget
      ? fitKeywordIntoDiverseHeadline(current, keywordTarget, 30, languageCode, protectedHeadlines, brandName)
      : null

    if (!replacement) {
      const base = keywordTarget || preferredHeadlineSeed(current, brandName, softLanguage)
      const actionVariants = getHeadlineActionVariants(languageCode)
      const rawCandidates = [
        ...actionVariants.map((action) => `${action} ${base}`.trim()),
        ...actionVariants.map((action) => `${base} ${action}`.trim()),
        `${brandName} ${base}`.trim(),
        base,
      ]
      replacement = rawCandidates
        .map((candidate) => applyHeadlineTextGuardrail(fitLocalizedHeadline(candidate, 30), 30))
        .map((candidate) => stripHeadlineNumericSuffixArtifact(candidate))
        .find((candidate) => {
          const normalizedCandidate = normalize(candidate)
          return Boolean(candidate) && Boolean(normalizedCandidate) && !seen.has(normalizedCandidate)
        }) || null
    }

    replacement = stripHeadlineNumericSuffixArtifact(
      applyHeadlineTextGuardrail(String(replacement || ''), 30)
    )
    const normalizedReplacement = normalize(replacement)
    if (!replacement || !normalizedReplacement || seen.has(normalizedReplacement)) continue

    headlines[index] = replacement
    syncHeadlineMetadataSlot(result, index, replacement)
    seen.add(normalizedReplacement)
    fixes += 1
  }

  if (fixes > 0) {
    result.headlines = headlines
  }
  return { fixes }
}

function normalizeHeadlineAssetKeyForGoogleAds(text: string): string {
  return sanitizeGoogleAdsAdText(String(text || ''), 30).trim().toLowerCase()
}

function buildUniqueHeadlineVariantForGoogleAds(params: {
  currentHeadline: string
  keywordTarget: string
  brandName: string
  languageCode: string
  protectedHeadlines: string[]
  usedAssetKeys: Set<string>
}): string | null {
  const {
    currentHeadline,
    keywordTarget,
    brandName,
    languageCode,
    protectedHeadlines,
    usedAssetKeys,
  } = params
  const softLanguage = resolveSoftCopyLanguage(languageCode) || 'en'
  const preferredSeed = preferredHeadlineSeed(currentHeadline, brandName, softLanguage)
  const normalizedBrand = normalizeBrandNameForHeadline(brandName)
  const brandTokensToMatch = getPureBrandKeywords(brandName)
  const actionVariants = Array.from(new Set([
    ...getHeadlineActionVariants(languageCode),
    ...GOOGLE_ADS_HEADLINE_UNIQUENESS_SUFFIXES,
  ]))

  const rawCandidates = [
    keywordTarget
      ? fitKeywordIntoDiverseHeadline(
          currentHeadline,
          keywordTarget,
          RETAINED_KEYWORD_HEADLINE_MAX_LENGTH,
          languageCode,
          protectedHeadlines,
          brandName
        )
      : null,
    keywordTarget ? buildHardKeywordHeadlineCandidate(keywordTarget, languageCode) : null,
    ...actionVariants.map((action) => `${action} ${preferredSeed}`.trim()),
    ...actionVariants.map((action) => `${preferredSeed} ${action}`.trim()),
    `${brandName} ${keywordTarget || preferredSeed}`.trim(),
    preferredSeed,
  ]

  for (const rawCandidate of rawCandidates) {
    let candidate = stripHeadlineNumericSuffixArtifact(
      applyHeadlineTextGuardrail(String(rawCandidate || ''), RETAINED_KEYWORD_HEADLINE_MAX_LENGTH)
    )
    if (
      candidate
      && normalizedBrand
      && !hasBrandAnchorInHeadline(candidate, normalizedBrand, brandTokensToMatch)
    ) {
      candidate = stripHeadlineNumericSuffixArtifact(
        applyHeadlineTextGuardrail(`${normalizedBrand} ${candidate}`, RETAINED_KEYWORD_HEADLINE_MAX_LENGTH)
      )
    }
    const normalizedKey = normalizeHeadlineAssetKeyForGoogleAds(candidate)
    if (!candidate || !normalizedKey || usedAssetKeys.has(normalizedKey)) continue
    usedAssetKeys.add(normalizedKey)
    return candidate
  }

  return null
}

function resolveKeywordTargetForHeadlineSlot(params: {
  index: number
  usagePlan?: CreativeKeywordUsagePlan | null
  keywords: string[]
}): string {
  const { index, usagePlan, keywords } = params
  if (
    usagePlan
    && index >= RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX
    && index < RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX + usagePlan.headlineKeywordTargets.length
  ) {
    return usagePlan.headlineKeywordTargets[index - RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX]
  }
  return keywords[(index - 1) % Math.max(1, keywords.length)] || ''
}

export function enforceGoogleAdsHeadlineAssetUniqueness(
  result: GeneratedAdCreativeData,
  languageCode: string,
  brandName: string,
  usagePlan?: CreativeKeywordUsagePlan | null
): { fixes: number } {
  const headlines = [...(result.headlines || [])]
  if (headlines.length <= 1) return { fixes: 0 }

  const keywords = [...(result.keywords || [])]
  const protectedHeadlines = headlines.slice(0, Math.min(RETAINED_KEYWORD_PROTECTED_HEADLINE_COUNT, headlines.length))
  const usedAssetKeys = new Set<string>()
  let fixes = 0
  let changed = false

  for (let index = 0; index < headlines.length; index += 1) {
    const cleaned = stripHeadlineNumericSuffixArtifact(
      applyHeadlineTextGuardrail(headlines[index], RETAINED_KEYWORD_HEADLINE_MAX_LENGTH)
    )
    const normalizedKey = normalizeHeadlineAssetKeyForGoogleAds(cleaned)
    if (!normalizedKey) continue

    if (!usedAssetKeys.has(normalizedKey)) {
      usedAssetKeys.add(normalizedKey)
      if (cleaned !== headlines[index]) {
        headlines[index] = cleaned
        syncHeadlineMetadataSlot(result, index, cleaned)
        changed = true
      }
      continue
    }

    const keywordTarget = resolveKeywordTargetForHeadlineSlot({
      index,
      usagePlan,
      keywords,
    })
    const replacement = buildUniqueHeadlineVariantForGoogleAds({
      currentHeadline: cleaned,
      keywordTarget,
      brandName,
      languageCode,
      protectedHeadlines,
      usedAssetKeys,
    })

    if (!replacement) {
      throw new Error(`标题${index + 1}与已有标题重复，且无法在生成阶段构造唯一变体`)
    }

    headlines[index] = replacement
    syncHeadlineMetadataSlot(result, index, replacement)
    fixes += 1
    changed = true
  }

  if (changed) {
    result.headlines = headlines
  }

  return { fixes }
}

function preferredHeadlineSeed(
  headline: string,
  brandName: string,
  languageCode: SupportedSoftCopyLanguage
): string {
  const normalized = normalizeBrandFreeText(headline, brandName)
  const candidate = normalizeHeadlineCandidateText(normalized)
  if (candidate.length >= 6) return candidate
  return getDefaultProductNoun(languageCode)
}

function normalizeCreativeAssetText(
  result: GeneratedAdCreativeData
): { headlineFixes: number; descriptionFixes: number } {
  const headlines = [...(result.headlines || [])]
  const descriptions = [...(result.descriptions || [])]
  let headlineFixes = 0
  let descriptionFixes = 0

  for (let index = 0; index < headlines.length; index += 1) {
    const cleaned = applyHeadlineTextGuardrail(
      stripHeadlineNumericSuffixArtifact(headlines[index]),
      30
    )
    if (!cleaned || cleaned === headlines[index]) continue
    headlines[index] = cleaned
    syncHeadlineMetadataSlot(result, index, cleaned)
    headlineFixes += 1
  }

  for (let index = 0; index < descriptions.length; index += 1) {
    const cleaned = applyDescriptionTextGuardrail(descriptions[index], 90)
    if (!cleaned || cleaned === descriptions[index]) continue
    descriptions[index] = cleaned
    syncDescriptionMetadataSlot(result, index, cleaned)
    descriptionFixes += 1
  }

  if (headlineFixes > 0) result.headlines = headlines
  if (descriptionFixes > 0) result.descriptions = descriptions
  return { headlineFixes, descriptionFixes }
}

function isKeywordCompatibleWithCreativeLanguage(keyword: string, languageCode: string): boolean {
  const normalizedKeyword = normalizeHeadlineCandidateText(keyword)
  if (!normalizedKeyword) return false

  const softLanguage = resolveSoftCopyLanguage(languageCode)
  if (!softLanguage) {
    return true
  }
  return isHeadlineCompatibleWithTargetLanguage(normalizedKeyword, languageCode)
}

function toLanguageCompatibleKeywordList(keywords: string[], languageCode: string): string[] {
  return keywords
    .map((keyword) => String(keyword || '').trim())
    .filter(Boolean)
    .filter((keyword) => isKeywordCompatibleWithCreativeLanguage(keyword, languageCode))
}

function resolveHeadlineKeywordTargets(
  usagePlan: CreativeKeywordUsagePlan | null | undefined,
  keywords: string[],
  languageCode: string
): string[] {
  const usageTargets = usagePlan?.headlineKeywordTargets || []
  const languageSafeUsageTargets = toLanguageCompatibleKeywordList(usageTargets, languageCode)
  if (languageSafeUsageTargets.length > 0) {
    return cycleKeywordTargets(languageSafeUsageTargets, RETAINED_KEYWORD_HEADLINE_SLOT_COUNT)
  }

  const languageSafeKeywords = toLanguageCompatibleKeywordList(keywords, languageCode)
  if (languageSafeKeywords.length > 0) {
    return cycleKeywordTargets(languageSafeKeywords, RETAINED_KEYWORD_HEADLINE_SLOT_COUNT)
  }

  if (usageTargets.length > 0) {
    return cycleKeywordTargets(usageTargets, RETAINED_KEYWORD_HEADLINE_SLOT_COUNT)
  }
  return cycleKeywordTargets(keywords, RETAINED_KEYWORD_HEADLINE_SLOT_COUNT)
}

function resolveDescriptionKeywordTargets(
  usagePlan: CreativeKeywordUsagePlan | null | undefined,
  keywords: string[],
  languageCode: string
): string[] {
  const usageTargets = usagePlan?.descriptionKeywordTargets || []
  const languageSafeUsageTargets = toLanguageCompatibleKeywordList(usageTargets, languageCode)
  if (languageSafeUsageTargets.length > 0) {
    return cycleKeywordTargets(languageSafeUsageTargets, RETAINED_KEYWORD_DESCRIPTION_SLOT_COUNT)
  }

  const languageSafeKeywords = toLanguageCompatibleKeywordList(keywords, languageCode)
  if (languageSafeKeywords.length > 0) {
    return cycleKeywordTargets(languageSafeKeywords, RETAINED_KEYWORD_DESCRIPTION_SLOT_COUNT)
  }

  if (usageTargets.length > 0) {
    return cycleKeywordTargets(usageTargets, RETAINED_KEYWORD_DESCRIPTION_SLOT_COUNT)
  }
  return cycleKeywordTargets(keywords, RETAINED_KEYWORD_DESCRIPTION_SLOT_COUNT)
}

function buildLanguageSafeUsagePlan(
  usagePlan: CreativeKeywordUsagePlan | null | undefined,
  keywords: string[],
  languageCode: string
): CreativeKeywordUsagePlan | null {
  if (!usagePlan) return null

  const headlineKeywordTargets = resolveHeadlineKeywordTargets(usagePlan, keywords, languageCode)
  const descriptionKeywordTargets = resolveDescriptionKeywordTargets(usagePlan, keywords, languageCode)
  const retainedNonBrandKeywords = Array.from(new Set([
    ...headlineKeywordTargets,
    ...descriptionKeywordTargets,
  ]))

  if (headlineKeywordTargets.length === 0 && descriptionKeywordTargets.length === 0) {
    return usagePlan
  }

  return {
    ...usagePlan,
    retainedNonBrandKeywords: retainedNonBrandKeywords.length > 0
      ? retainedNonBrandKeywords
      : usagePlan.retainedNonBrandKeywords,
    headlineKeywordTargets: headlineKeywordTargets.length > 0
      ? headlineKeywordTargets
      : usagePlan.headlineKeywordTargets,
    descriptionKeywordTargets: descriptionKeywordTargets.length > 0
      ? descriptionKeywordTargets
      : usagePlan.descriptionKeywordTargets,
  }
}

function buildHardKeywordHeadlineCandidate(keyword: string, languageCode: string): string | null {
  const normalizedKeyword = normalizeHeadlineCandidateText(keyword)
  if (!normalizedKeyword) return null

  const actionVariants = getHeadlineActionVariants(languageCode)
  const rawCandidates = [
    ...actionVariants.map((action) => `${action} ${normalizedKeyword}`.trim()),
    normalizedKeyword,
    ...actionVariants.map((action) => `${normalizedKeyword} ${action}`.trim()),
  ]

  for (const rawCandidate of rawCandidates) {
    const candidate = applyHeadlineTextGuardrail(
      fitLocalizedHeadline(stripHeadlineNumericSuffixArtifact(rawCandidate), 30),
      30
    )
    if (!candidate) continue
    if (!textContainsKeyword(candidate, normalizedKeyword)) continue
    return candidate
  }

  return null
}

function buildHardKeywordDescriptionCandidate(keyword: string, languageCode: string): string | null {
  const normalizedKeyword = String(keyword || '').trim()
  if (!normalizedKeyword) return null
  const fitted = fitKeywordIntoDescription('', normalizedKeyword, 90, languageCode)
  if (!fitted) return null
  return applyDescriptionTextGuardrail(fitted, 90)
}

function enforceHardRetainedKeywordContract(
  result: GeneratedAdCreativeData,
  usagePlan: CreativeKeywordUsagePlan | null | undefined,
  languageCode: string,
  brandName: string
): { headlineFixes: number; descriptionFixes: number } {
  const headlines = [...(result.headlines || [])]
  const descriptions = [...(result.descriptions || [])]
  if (headlines.length === 0 || descriptions.length === 0) {
    return { headlineFixes: 0, descriptionFixes: 0 }
  }

  const headlineTargets = resolveHeadlineKeywordTargets(usagePlan, result.keywords || [], languageCode)
  const descriptionTargets = resolveDescriptionKeywordTargets(usagePlan, result.keywords || [], languageCode)
  const protectedHeadlines = headlines.slice(0, Math.min(RETAINED_KEYWORD_PROTECTED_HEADLINE_COUNT, headlines.length))
  const normalize = (value: string) => normalizeHeadlineForProtectedSimilarity(value, brandName, languageCode)

  let headlineFixes = 0
  for (let offset = 0; offset < headlineTargets.length; offset += 1) {
    const slotIndex = RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX + offset
    if (slotIndex >= headlines.length) break

    const targetKeyword = headlineTargets[offset]
    const current = headlines[slotIndex]
    if (textContainsKeyword(current, targetKeyword) && isHeadlineCompatibleWithTargetLanguage(current, languageCode)) {
      continue
    }

    const seenNormalized = new Set(
      headlines
        .map((headline, index) => (index === slotIndex ? '' : normalize(headline)))
        .filter(Boolean)
    )

    const candidatePool = [
      fitKeywordIntoDiverseHeadline(
        current,
        targetKeyword,
        30,
        languageCode,
        protectedHeadlines,
        brandName
      ),
      buildHardKeywordHeadlineCandidate(targetKeyword, languageCode),
      fitKeywordIntoHeadline('', targetKeyword, 30),
    ]

    const replacement = candidatePool
      .map((candidate) => applyHeadlineTextGuardrail(stripHeadlineNumericSuffixArtifact(String(candidate || '')), 30))
      .find((candidate) => {
        const normalized = normalize(candidate)
        if (!candidate || !normalized) return false
        if (!textContainsKeyword(candidate, targetKeyword)) return false
        if (!isHeadlineCompatibleWithTargetLanguage(candidate, languageCode)) return false
        return !seenNormalized.has(normalized)
      }) || null

    if (!replacement || replacement === current) continue
    headlines[slotIndex] = replacement
    syncHeadlineMetadataSlot(result, slotIndex, replacement)
    headlineFixes += 1
  }

  let descriptionFixes = 0
  for (let offset = 0; offset < descriptionTargets.length; offset += 1) {
    const slotIndex = RETAINED_KEYWORD_DESCRIPTION_SLOT_START_INDEX + offset
    if (slotIndex >= descriptions.length) break

    const targetKeyword = descriptionTargets[offset]
    if (textContainsKeyword(descriptions[slotIndex], targetKeyword)) continue

    const candidatePool = [
      fitKeywordIntoDescription(descriptions[slotIndex], targetKeyword, 90, languageCode),
      buildHardKeywordDescriptionCandidate(targetKeyword, languageCode),
      fitKeywordIntoDescription('', targetKeyword, 90, languageCode),
    ]

    const replacement = candidatePool
      .map((candidate) => applyDescriptionTextGuardrail(String(candidate || ''), 90))
      .find((candidate) => Boolean(candidate) && textContainsKeyword(candidate, targetKeyword)) || null
    if (!replacement || replacement === descriptions[slotIndex]) continue
    descriptions[slotIndex] = replacement
    syncDescriptionMetadataSlot(result, slotIndex, replacement)
    descriptionFixes += 1
  }

  if (headlineFixes > 0) result.headlines = headlines
  if (descriptionFixes > 0) result.descriptions = descriptions
  return { headlineFixes, descriptionFixes }
}

export function enforceFinalCreativeContract(
  result: GeneratedAdCreativeData,
  options: {
    bucket: NormalizedCreativeBucket
    languageCode: string
    brandName: string
    brandTokensToMatch: string[]
    dkiHeadline: string
    productTitle?: string | null
    aboutItems?: string[] | null
    usagePlan?: CreativeKeywordUsagePlan | null
  }
): {
  headlineFixes: number
  descriptionFixes: number
  titleFixes: number
  retainedFixes: { headlineFixes: number; descriptionFixes: number }
  languageFixes: { headlineFixes: number; descriptionFixes: number }
  uniquenessFixes: number
} {
  const headlines = [...(result.headlines || [])]
  if (headlines.length > 0) {
    const firstHeadline = String(options.dkiHeadline || '').trim()
    if (headlines[0] !== firstHeadline) {
      headlines[0] = firstHeadline
      result.headlines = headlines
      syncHeadlineMetadataSlot(result, 0, firstHeadline)
    }
  }

  const languageSafeUsagePlan = buildLanguageSafeUsagePlan(
    options.usagePlan,
    result.keywords || [],
    options.languageCode
  )

  const normalizedFix = normalizeCreativeAssetText(result)
  const languageFixesBefore = enforceLanguagePurityGate(result, options.bucket, options.languageCode, options.brandName)
  const titleFix = enforceTitlePriorityTopHeadlines(result, {
    brandName: options.brandName,
    brandTokensToMatch: options.brandTokensToMatch,
    productTitle: options.productTitle,
    aboutItems: options.aboutItems,
    targetLanguage: options.languageCode,
    slotStartIndex: TOP_HEADLINE_SLOT_START_INDEX,
    slotCount: TOP_HEADLINE_SLOT_COUNT,
    maxLength: TOP_HEADLINE_MAX_LENGTH,
  })
  const retainedFix = enforceRetainedKeywordSlotCoverage(result, languageSafeUsagePlan, options.languageCode, options.brandName)
  const uniquenessFix = enforceHeadlineUniquenessGate(result, options.languageCode, options.brandName, languageSafeUsagePlan)
  const hardRetainedFix = enforceHardRetainedKeywordContract(result, languageSafeUsagePlan, options.languageCode, options.brandName)
  const languageFixesAfter = enforceLanguagePurityGate(result, options.bucket, options.languageCode, options.brandName)
  const finalUniquenessFix = enforceHeadlineUniquenessGate(result, options.languageCode, options.brandName, languageSafeUsagePlan)
  const finalNormalizeFix = normalizeCreativeAssetText(result)
  const googleAdsUniquenessFix = enforceGoogleAdsHeadlineAssetUniqueness(
    result,
    options.languageCode,
    options.brandName,
    languageSafeUsagePlan
  )

  const finalizedHeadlines = [...(result.headlines || [])]
  if (finalizedHeadlines.length > 0) {
    const firstHeadline = String(options.dkiHeadline || '').trim()
    if (finalizedHeadlines[0] !== firstHeadline) {
      finalizedHeadlines[0] = firstHeadline
      result.headlines = finalizedHeadlines
      syncHeadlineMetadataSlot(result, 0, firstHeadline)
    }
  }

  return {
    headlineFixes:
      normalizedFix.headlineFixes
      + finalNormalizeFix.headlineFixes,
    descriptionFixes:
      normalizedFix.descriptionFixes
      + finalNormalizeFix.descriptionFixes,
    titleFixes: titleFix.replaced,
    retainedFixes: {
      headlineFixes: retainedFix.headlineFixes + hardRetainedFix.headlineFixes,
      descriptionFixes: retainedFix.descriptionFixes + hardRetainedFix.descriptionFixes,
    },
    languageFixes: {
      headlineFixes: languageFixesBefore.headlineFixes + languageFixesAfter.headlineFixes,
      descriptionFixes: languageFixesBefore.descriptionFixes + languageFixesAfter.descriptionFixes,
    },
    uniquenessFixes: uniquenessFix.fixes + finalUniquenessFix.fixes + googleAdsUniquenessFix.fixes,
  }
}

function annotateCopyIntentMetadata(
  result: GeneratedAdCreativeData,
  languageCode: string,
  keywords: string[]
): void {
  const headlines = result.headlines || []
  const descriptions = result.descriptions || []
  const ctaRegex = getCtaRegexForLanguage(languageCode)

  const headlineMetadata: HeadlineAsset[] = (result.headlinesWithMetadata && result.headlinesWithMetadata.length > 0)
    ? result.headlinesWithMetadata.map((h, idx) => ({
        ...h,
        text: headlines[idx] ?? h.text
      }))
    : headlines.map((text) => ({ text, length: text.length }))

  const descriptionMetadata: DescriptionAsset[] = (result.descriptionsWithMetadata && result.descriptionsWithMetadata.length > 0)
    ? result.descriptionsWithMetadata.map((d, idx) => ({
        ...d,
        text: descriptions[idx] ?? d.text
      }))
    : descriptions.map((text) => ({ text, length: text.length, hasCTA: ctaRegex.test(text) }))

  result.headlinesWithMetadata = headlineMetadata.map((headline) => ({
    ...headline,
    length: Math.min(30, headline.text.length),
    intentTag: classifyCopyIntentFromText(headline.text, languageCode, keywords),
  }))

  result.descriptionsWithMetadata = descriptionMetadata.map((description) => {
    const intentTag = classifyCopyIntentFromText(description.text, languageCode, keywords)
    return {
      ...description,
      length: Math.min(90, description.text.length),
      hasCTA: description.hasCTA ?? ctaRegex.test(description.text),
      intentTag,
      structureTag: classifyDescriptionStructure(description.text, intentTag, languageCode)
    }
  })
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeBrandFreeText(text: string, brandName: string): string {
  if (!text) return ''
  const brand = String(brandName || '').trim()
  if (!brand) return String(text).trim()
  const pattern = new RegExp(escapeRegex(brand), 'ig')
  return String(text).replace(pattern, '').replace(/\s{2,}/g, ' ').trim()
}

function normalizeHeadline2KeywordCandidate(text: string): string {
  return String(text || '')
    .replace(/[{}]/g, '')
    .replace(/[_/]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function tokenizeHeadline2Keyword(text: string): string[] {
  const normalized = normalizeHeadline2KeywordCandidate(text)
    .toLowerCase()
    .normalize('NFKC')
  // Unicode-aware tokenization (letters+numbers). Keep it permissive for non-English.
  return normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

function isLikelyModelCodeToken(token: string): boolean {
  const t = String(token || '').toLowerCase()
  // e.g. "f17", "vp40", "x100", "a7" (very short alnum code)
  return /^[a-z]*\d+[a-z0-9]*$/i.test(t) && t.length <= 6
}

const HEADLINE2_INTENT_TOKENS = new Set([
  'buy', 'purchase', 'order', 'shop', 'get', 'need',
  'price', 'cost', 'deal', 'discount', 'coupon', 'promo',
  'best', 'top', 'cheap', 'affordable', 'sale',
])

const HEADLINE2_BANNED_TOKENS = new Set([
  // Navigational / irrelevant for a product-category keyword defaultText
  'official', 'store', 'website', 'site', 'amazon', 'ebay',
  // Local intent noise (commonly appears in brand query keywords)
  'near', 'nearby', 'me',
])

const HEADLINE2_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'for', 'with', 'in', 'on', 'at', 'by', 'from',
  'your', 'our', 'my', 'their', 'this', 'that', 'these', 'those',
])

const HEADLINE_DANGLING_TAIL_TOKENS = new Set([
  'a', 'an', 'the',
  'and', 'or',
  'of', 'to', 'for', 'with', 'in', 'on', 'at', 'by', 'from',
  'your', 'our', 'my', 'their',
])

/**
 * 🔒 前置数据质量校验（2026-01-26）
 * 在生成创意前检查 Offer 数据质量，防止使用错误数据生成创意
 *
 * @param offer - Offer 数据对象
 * @returns 校验结果
 */
function validateOfferDataQuality(offer: {
  id: number
  brand?: string
  category?: string
  brand_description?: string
  extracted_keywords?: string
  ai_keywords?: unknown
  scrape_status?: string
  scrape_error?: string
}): { isValid: boolean; issues: string[] } {
  const issues: string[] = []
  const UNKNOWN_KEYWORD_PATTERN = /^unknown(\s|$)/i

  const parseKeywordList = (raw: unknown): string[] => {
    const parsed = safeParseJson(raw, [])
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((kw: any) => {
        if (typeof kw === 'string') return kw.trim()
        if (kw && typeof kw.keyword === 'string') return kw.keyword.trim()
        return ''
      })
      .filter(Boolean)
  }

  // 1. 检查 extracted_keywords 是否包含 "unknown" 模式
  if (offer.extracted_keywords) {
    const extractedKeywords = parseKeywordList(offer.extracted_keywords)
    const unknownKeywords = extractedKeywords.filter((kw) => UNKNOWN_KEYWORD_PATTERN.test(kw))

    if (unknownKeywords.length > 3) {
      const aiKeywords = parseKeywordList(offer.ai_keywords)
      const validAiKeywords = aiKeywords.filter((kw) => !UNKNOWN_KEYWORD_PATTERN.test(kw))

      if (validAiKeywords.length <= 3) {
        issues.push(`关键词中包含过多 "unknown" 模式 (${unknownKeywords.length}个)，可能是抓取失败`)
      } else {
        console.warn(
          `[validateOfferDataQuality] Offer ${offer.id}: extracted_keywords异常(${unknownKeywords.length}个unknown)，但ai_keywords可用(${validAiKeywords.length}个)，跳过拦截`
        )
      }
    }
  }

  // 2. 检查品牌描述是否与品牌名一致
  if (offer.brand && offer.brand_description) {
    const brandLower = offer.brand.toLowerCase()
    const descLower = offer.brand_description.toLowerCase()

    // 已知的问题品牌名（从历史案例中提取）
    const knownMismatchBrands = ['lilysilk', 'u-share', 'ushare']

    for (const mismatchBrand of knownMismatchBrands) {
      if (descLower.includes(mismatchBrand) && !brandLower.includes(mismatchBrand)) {
        issues.push(`品牌描述中提到了 "${mismatchBrand}"，但录入品牌是 "${offer.brand}"`)
      }
    }

    // 检查品牌描述是否以其他品牌名开头
    const brandStartMatch = descLower.match(/^([a-z][a-z0-9\-\s]{1,20})\s+(is|specializes|focuses|offers|provides)/i)
    if (brandStartMatch) {
      const detectedBrand = brandStartMatch[1].trim()
      // 标准化品牌名：统一连字符和空格，便于比较 "k-swiss" vs "k swiss"
      const normalize = (s: string) => s.replace(/[-\s]+/g, '').toLowerCase()
      const detectedNorm = normalize(detectedBrand)
      const brandNorm = normalize(brandLower)
      if (detectedNorm !== brandNorm && !brandNorm.includes(detectedNorm) && !detectedNorm.includes(brandNorm)) {
        issues.push(`品牌描述以 "${detectedBrand}" 开头，但录入品牌是 "${offer.brand}"`)
      }
    }
  }

  // 3. 检查类别是否与电子产品品牌明显不匹配
  const electronicsBrands = ['anker', 'reolink', 'eufy', 'soundcore', 'nebula', 'ecoflow', 'jackery']
  const nonElectronicsCategories = [
    'pajama', 'sleepwear', 'clothing', 'apparel',
    'picture frame', 'photo frame', 'home decor', 'furniture',
    'jewelry', 'cosmetics', 'beauty'
  ]

  if (offer.brand && offer.category) {
    const brandLower = offer.brand.toLowerCase()
    const categoryLower = offer.category.toLowerCase()

    if (electronicsBrands.includes(brandLower)) {
      for (const nonElecCat of nonElectronicsCategories) {
        if (categoryLower.includes(nonElecCat)) {
          issues.push(`电子产品品牌 "${offer.brand}" 的类别 "${offer.category}" 明显不匹配`)
          break
        }
      }
    }
  }

  // 4. 检查抓取状态
  if (offer.scrape_status === 'failed' && offer.scrape_error) {
    issues.push(`Offer 抓取失败: ${offer.scrape_error}`)
  }

  return {
    isValid: issues.length === 0,
    issues
  }
}

export function selectPrimaryKeywordForHeadline2(
  keywords: Array<{ keyword: string; searchVolume?: number }> | null | undefined,
  brandName: string,
  fallbackTexts: string[]
): string {
  const brandLower = String(brandName || '').toLowerCase().trim()
  const rawCandidates = (keywords || [])
    .map(k => ({
      keyword: normalizeHeadline2KeywordCandidate(String((k as any).keyword || '')),
      searchVolume: Number((k as any).searchVolume || 0)
    }))
    .filter(k => k.keyword.length > 0)
    .filter(k => k.keyword.length <= 60)

  const fallbackTokenSet = new Set(
    fallbackTexts
      .map(t => normalizeBrandFreeText(t, brandName))
      .flatMap(t => tokenizeHeadline2Keyword(t))
      .filter(t => t.length > 1)
      .filter(t => !HEADLINE2_STOPWORDS.has(t))
  )

  // Headline #2 必须不含品牌：所有候选统一做去品牌处理（非品牌关键词保持不变）
  const cleanedCandidates = rawCandidates
    .map(k => {
      const cleaned = normalizeHeadline2KeywordCandidate(normalizeBrandFreeText(k.keyword, brandName))
      return { keyword: cleaned, searchVolume: k.searchVolume }
    })
    .filter(k => k.keyword.length > 0)
    .filter(k => k.keyword.length <= 60)
    .filter(k => brandLower ? !k.keyword.toLowerCase().includes(brandLower) : true)

  const scored = cleanedCandidates
    .map(c => {
      const tokens = tokenizeHeadline2Keyword(c.keyword)
      const overlap = tokens.reduce((acc, t) => acc + (fallbackTokenSet.has(t) ? 1 : 0), 0)
      return {
        ...c,
        tokens,
        overlap,
        intent: calculateIntentScore(c.keyword, brandName),
      }
    })
    .filter(c => c.tokens.length > 0)
    // Filter out generic/navigational candidates like "shop" / "official store" / "store near me"
    .filter(c => !c.tokens.some(t => HEADLINE2_BANNED_TOKENS.has(t)))
    // Avoid defaultText that is only intent words (e.g. "shop", "buy", "price")
    .filter(c => c.tokens.some(t => !HEADLINE2_INTENT_TOKENS.has(t) && !HEADLINE2_STOPWORDS.has(t)))
    // Avoid naked model codes unless they are actually relevant to the offer text
    .filter(c => {
      if (c.tokens.length !== 1) return true
      const t = c.tokens[0]
      if (!isLikelyModelCodeToken(t)) return true
      return fallbackTokenSet.has(t)
    })
    // Require relevance when we have offer context; prevents selecting "shop" over category terms
    .filter(c => fallbackTokenSet.size === 0 ? true : c.overlap > 0)

  if (scored.length > 0) {
    const hasAnyVolume = scored.some(c => c.searchVolume > 0)
    scored.sort((a, b) => {
      if (b.intent !== a.intent) return b.intent - a.intent
      if (b.overlap !== a.overlap) return b.overlap - a.overlap
      if (hasAnyVolume && b.searchVolume !== a.searchVolume) return b.searchVolume - a.searchVolume
      return a.keyword.length - b.keyword.length
    })
    return scored[0].keyword
  }

  for (const fallback of fallbackTexts) {
    const cleaned = normalizeHeadline2KeywordCandidate(normalizeBrandFreeText(String(fallback || ''), brandName))
    if (cleaned) return cleaned
  }

  return ''
}

// Keyword with search volume data
// 🎯 数据来源说明：统一使用Historical Metrics API的精确搜索量
// 🎯 意图分类（3类）
export type IntentCategory = 'brand' | 'scenario' | 'function'

export interface KeywordWithVolume extends KeywordAuditMetadata {
  keyword: string
  searchVolume: number // 精确搜索量（来自Historical Metrics API）
  competition?: string
  competitionIndex?: number
  lowTopPageBid?: number // 页首最低出价（用于动态CPC）
  highTopPageBid?: number // 页首最高出价（用于动态CPC）
  source?: string // 数据来源标记
  matchType?: CreativeKeywordMatchType // 匹配类型（可选）
  intentCategory?: IntentCategory // 🔥 意图分类（品牌/场景/功能）
  volumeUnavailableReason?: 'DEV_TOKEN_INSUFFICIENT_ACCESS'
}

export interface KeywordSupplementationReport {
  triggered: boolean
  beforeCount: number
  afterCount: number
  addedKeywords: Array<{ keyword: string; source: 'keyword_pool' | 'title_about' }>
  supplementCapApplied: boolean
}

interface ApplyKeywordSupplementationOnceInput {
  offer: any
  userId: number
  brandName: string
  targetLanguage: string
  keywordsWithVolume: KeywordWithVolume[]
  poolCandidates?: string[]
  triggerThreshold?: number
  supplementCap?: number
  bucket?: 'A' | 'B' | 'C' | 'D' | 'S' | null  // 🔥 优化(2026-03-13): 添加 bucket 字段用于意图一致性检查
  skipAiRanking?: boolean
}

interface ApplyKeywordSupplementationOnceOutput {
  keywordsWithVolume: KeywordWithVolume[]
  keywords: string[]
  keywordSupplementation: KeywordSupplementationReport
}

const KEYWORD_SUPPLEMENT_TRIGGER_THRESHOLD = 10
const KEYWORD_SUPPLEMENT_DEFAULT_CAP = 20
const KEYWORD_SUPPLEMENT_CAP_BY_BUCKET: Record<'A' | 'B' | 'C' | 'D' | 'S', number> = {
  A: 20,
  B: 25,
  C: 25,
  D: 30,
  S: 30,
}
const KEYWORD_SUPPLEMENT_MIN_NON_BRAND = 8
const KEYWORD_SUPPLEMENT_MIN_EFFECTIVE = 12
const KEYWORD_SUPPLEMENT_MIN_B_MODEL_ANCHOR = 3
const KEYWORD_SUPPLEMENT_MIN_D_DEMAND = 6
const KEYWORD_SUPPLEMENT_MODEL_PASS_SCORE = 70
const KEYWORD_SUPPLEMENT_MODEL_MAX_CANDIDATES = 60
const KEYWORD_SUPPLEMENT_SCORING_PROMPT_ID = 'keyword_supplement_relevance_scoring'
const KEYWORD_SUPPLEMENT_SCORING_PROMPT_FALLBACK = `You are a strict SEO keyword relevance scorer for paid search.
Task: score candidate supplemental keywords for product ads.

Source: {{source}}
Brand: {{brandName}}
Target language: {{targetLanguage}}

Product title:
{{titleLine}}

About this item:
{{aboutBlock}}

Existing high-confidence keywords:
{{existingLines}}

Candidate keywords to score:
{{candidateLines}}

Scoring rules (0-100):
- Keep only query-like keywords clearly related to product/category/function/use-case/material/spec.
- Reject generic marketing slogans or vague phrases (e.g., "easy clean", "wide use").
- Reject candidates that are semantically detached from product context.
- Prefer candidates likely to be real user search queries.

Output JSON only with this structure:
{ "assessments": [ { "candidate": "...", "score": 0-100, "keep": true|false, "reason": "..." } ] }
Include every candidate exactly once in assessments.`
const KEYWORD_SUPPLEMENT_STOPWORDS_EN = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'for', 'with', 'in', 'on', 'at', 'by', 'from', 'as',
  'this', 'that', 'these', 'those', 'it', 'its', 'is', 'are', 'be', 'can', 'will', 'you', 'your', 'our',
  'because'
])
const KEYWORD_SUPPLEMENT_GENERIC_TOKENS_EN = new Set([
  'easy', 'clean', 'wide', 'use', 'quality', 'premium', 'durable', 'reliable', 'best',
  'new', 'hot', 'top', 'great', 'good', 'nice', 'perfect', 'ultimate', 'professional',
  'advanced', 'improved'
])
const KEYWORD_SUPPLEMENT_BANNED_PHRASES_EN = new Set([
  'easy clean',
  'easy to clean',
  'wide use',
  'wide usage',
  'high quality',
  'premium quality',
  'best quality',
])

function resolveKeywordSupplementCap(input: {
  supplementCap?: number
  bucket?: 'A' | 'B' | 'C' | 'D' | 'S' | null
}): number {
  const explicit = Number(input.supplementCap)
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.max(1, Math.floor(explicit))
  }

  if (input.bucket && KEYWORD_SUPPLEMENT_CAP_BY_BUCKET[input.bucket]) {
    return KEYWORD_SUPPLEMENT_CAP_BY_BUCKET[input.bucket]
  }

  return KEYWORD_SUPPLEMENT_DEFAULT_CAP
}

function hasKeywordSupplementCoverageGap(input: {
  keywordsWithVolume: KeywordWithVolume[]
  pureBrandKeywords: string[]
  targetLanguage: string
  bucket?: 'A' | 'B' | 'C' | 'D' | 'S' | null
}): boolean {
  const keywords = input.keywordsWithVolume || []
  const effectiveCount = keywords.length

  let nonPureBrandCount = 0
  let modelAnchorCount = 0
  let demandIntentCount = 0

  for (const item of keywords) {
    const keyword = String(item?.keyword || '').trim()
    if (!keyword) continue

    if (!isPureBrandKeyword(keyword, input.pureBrandKeywords)) {
      nonPureBrandCount++
    }

    if (hasModelAnchorEvidence({ keywords: [keyword] })) {
      modelAnchorCount++
    }

    const intent = classifyKeywordIntent(keyword, { language: input.targetLanguage })
    if (intent.intent === 'TRANSACTIONAL' || intent.intent === 'COMMERCIAL') {
      demandIntentCount++
    }
  }

  if (effectiveCount < KEYWORD_SUPPLEMENT_MIN_EFFECTIVE) return true
  if (nonPureBrandCount < KEYWORD_SUPPLEMENT_MIN_NON_BRAND) return true

  if ((input.bucket === 'B' || input.bucket === 'C') && modelAnchorCount < KEYWORD_SUPPLEMENT_MIN_B_MODEL_ANCHOR) {
    return true
  }

  if ((input.bucket === 'D' || input.bucket === 'S') && demandIntentCount < KEYWORD_SUPPLEMENT_MIN_D_DEMAND) {
    return true
  }

  return false
}

function matchesTargetLanguageScriptForKeyword(keyword: string, targetLanguage: string): boolean {
  const base = normalizeLanguageCode(targetLanguage || 'English').split(/[-_]/)[0]
  const text = String(keyword || '')
  if (!text.trim()) return false

  if (base === 'zh') return /[\p{Script=Han}]/u.test(text)
  if (base === 'ja') return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text)
  if (base === 'ko') return /[\p{Script=Hangul}]/u.test(text)
  if (base === 'ru') return /[\p{Script=Cyrillic}]/u.test(text)
  if (base === 'ar') return /[\p{Script=Arabic}]/u.test(text)

  const hasLatin = /[\p{Script=Latin}]/u.test(text)
  if (!hasLatin) return false
  return !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Cyrillic}]/u.test(text)
}

function normalizeSupplementCandidate(raw: string): string {
  return String(raw || '')
    .replace(/[•·]/g, ' ')
    .replace(/[\/_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s&]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeSupplementCandidate(raw: string): string[] {
  return normalizeSupplementCandidate(raw)
    .split(/\s+/)
    .map(part => part.trim())
    .filter(Boolean)
}

function composeBrandedSupplementKeyword(rawKeyword: string, brandName: string): string | null {
  const cleaned = normalizeSupplementCandidate(rawKeyword)
  if (!cleaned) return null

  const normalizedBrand = normalizeGoogleAdsKeyword(normalizeSupplementCandidate(brandName || ''))
  if (!normalizedBrand || normalizedBrand === 'unknown') {
    return cleaned
  }

  const brandTokens = normalizedBrand.split(/\s+/).filter(Boolean)
  if (brandTokens.length === 0) {
    return cleaned
  }

  const candidateTokens = tokenizeSupplementCandidate(cleaned)
  if (candidateTokens.length === 0) return null

  const lowerTokens = candidateTokens.map(token => token.toLowerCase())
  const withoutBrandTokens: string[] = []

  for (let i = 0; i < lowerTokens.length;) {
    let matchesBrand = true
    for (let j = 0; j < brandTokens.length; j += 1) {
      if (lowerTokens[i + j] !== brandTokens[j]) {
        matchesBrand = false
        break
      }
    }

    if (matchesBrand) {
      i += brandTokens.length
      continue
    }

    withoutBrandTokens.push(lowerTokens[i])
    i += 1
  }

  const recomposedCandidate = withoutBrandTokens.join(' ').trim()
  const combined = recomposedCandidate ? `${normalizedBrand} ${recomposedCandidate}` : normalizedBrand
  const combinedTokens = tokenizeSupplementCandidate(combined)
  if (combinedTokens.length < 2 || combinedTokens.length > 5) {
    return null
  }

  return combinedTokens.join(' ')
}

function isStructuredSupplementKeyword(keyword: string, targetLanguage: string): boolean {
  const cleaned = normalizeSupplementCandidate(keyword)
  if (!cleaned) return false
  if (cleaned.length < 4 || cleaned.length > 80) return false
  if (!matchesTargetLanguageScriptForKeyword(cleaned, targetLanguage)) return false

  const languageBase = normalizeLanguageCode(targetLanguage || 'English').split(/[-_]/)[0]
  const isCjkLanguage = languageBase === 'zh' || languageBase === 'ja' || languageBase === 'ko'
  const words = tokenizeSupplementCandidate(cleaned)
  if (isCjkLanguage) {
    const compact = cleaned.replace(/\s+/g, '')
    return compact.length >= 2 && compact.length <= 30
  }
  if (words.length < 2 || words.length > 6) return false

  const lowerWords = words.map(word => word.toLowerCase())
  const normalizedPhrase = lowerWords.join(' ')
  if (KEYWORD_SUPPLEMENT_BANNED_PHRASES_EN.has(normalizedPhrase)) return false
  const allStopwords = lowerWords.every(word => KEYWORD_SUPPLEMENT_STOPWORDS_EN.has(word))
  if (allStopwords) return false

  const startsWithStopword = KEYWORD_SUPPLEMENT_STOPWORDS_EN.has(lowerWords[0])
  const endsWithStopword = KEYWORD_SUPPLEMENT_STOPWORDS_EN.has(lowerWords[lowerWords.length - 1])
  const secondTokenIsStopword = lowerWords.length >= 3 && KEYWORD_SUPPLEMENT_STOPWORDS_EN.has(lowerWords[1])
  if (startsWithStopword || endsWithStopword || secondTokenIsStopword) return false

  const stopwordCount = lowerWords.filter(word => KEYWORD_SUPPLEMENT_STOPWORDS_EN.has(word)).length
  if (stopwordCount / lowerWords.length >= 0.4) return false
  const nonStopwords = lowerWords.filter(word => !KEYWORD_SUPPLEMENT_STOPWORDS_EN.has(word))
  if (nonStopwords.length === 0) return false
  const genericTokenCount = nonStopwords.filter(word => KEYWORD_SUPPLEMENT_GENERIC_TOKENS_EN.has(word)).length
  if (genericTokenCount === nonStopwords.length && nonStopwords.length <= 3) return false

  return true
}

function buildSupplementContextTokens(
  title: string,
  existingKeywords: KeywordWithVolume[]
): Set<string> {
  const seedTexts = [
    title,
    ...existingKeywords.map(kw => kw.keyword),
  ]

  const tokens = new Set<string>()
  for (const seed of seedTexts) {
    for (const rawToken of tokenizeSupplementCandidate(seed)) {
      const token = rawToken.toLowerCase()
      if (token.length < 3) continue
      if (KEYWORD_SUPPLEMENT_STOPWORDS_EN.has(token)) continue
      if (KEYWORD_SUPPLEMENT_GENERIC_TOKENS_EN.has(token)) continue
      tokens.add(token)
    }
  }

  return tokens
}

interface SupplementCandidateAssessment {
  candidate: string
  score: number
  keep: boolean
  reason?: string
}

interface RankSupplementCandidatesWithModelInput {
  source: 'keyword_pool' | 'title_about'
  candidates: string[]
  userId: number
  brandName: string
  targetLanguage: string
  title: string
  about: string[]
  existingKeywords: KeywordWithVolume[]
  skipAiRanking?: boolean
}

interface BuildKeywordSupplementScoringPromptInput {
  source: 'keyword_pool' | 'title_about'
  brandName: string
  targetLanguage: string
  titleLine: string
  aboutBlock: string
  existingLines: string
  candidateLines: string
}

async function buildKeywordSupplementScoringPrompt(
  input: BuildKeywordSupplementScoringPromptInput
): Promise<string> {
  const variables = {
    source: input.source,
    brandName: input.brandName || 'N/A',
    targetLanguage: input.targetLanguage || 'English',
    titleLine: input.titleLine || 'N/A',
    aboutBlock: input.aboutBlock || 'N/A',
    existingLines: input.existingLines || 'N/A',
    candidateLines: input.candidateLines || 'N/A',
  }

  try {
    const promptTemplate = await loadPrompt(KEYWORD_SUPPLEMENT_SCORING_PROMPT_ID)
    return interpolateTemplate(promptTemplate, variables)
  } catch (error: any) {
    console.warn(
      `[KeywordSupplement] 加载 prompt(${KEYWORD_SUPPLEMENT_SCORING_PROMPT_ID}) 失败，回退内置模板: ${error?.message || error}`
    )
    return interpolateTemplate(KEYWORD_SUPPLEMENT_SCORING_PROMPT_FALLBACK, variables)
  }
}

async function rankSupplementCandidatesWithModel(
  input: RankSupplementCandidatesWithModelInput
): Promise<string[]> {
  const uniqueCandidates: string[] = []
  const seen = new Set<string>()
  for (const raw of input.candidates) {
    const cleaned = normalizeSupplementCandidate(raw)
    const normalized = normalizeGoogleAdsKeyword(cleaned)
    if (!cleaned || !normalized || seen.has(normalized)) continue
    seen.add(normalized)
    uniqueCandidates.push(cleaned)
    if (uniqueCandidates.length >= KEYWORD_SUPPLEMENT_MODEL_MAX_CANDIDATES) break
  }

  if (uniqueCandidates.length === 0) return []

  if (input.skipAiRanking || process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
    return uniqueCandidates
  }

  const existingKeywordTexts = input.existingKeywords
    .map(kw => normalizeSupplementCandidate(kw.keyword))
    .filter(Boolean)
    .slice(0, 20)

  const titleLine = input.title || 'N/A'
  const aboutLines = (input.about || []).slice(0, 8)
  const candidateLines = uniqueCandidates.map((kw, idx) => `${idx + 1}. ${kw}`).join('\n')
  const existingLines = existingKeywordTexts.length > 0
    ? existingKeywordTexts.map((kw, idx) => `${idx + 1}. ${kw}`).join('\n')
    : 'N/A'
  const aboutBlock = aboutLines.length > 0
    ? aboutLines.map((line, idx) => `${idx + 1}. ${line}`).join('\n')
    : 'N/A'
  const prompt = await buildKeywordSupplementScoringPrompt({
    source: input.source,
    brandName: input.brandName,
    targetLanguage: input.targetLanguage,
    titleLine,
    aboutBlock,
    existingLines,
    candidateLines,
  })

  const responseSchema: ResponseSchema = {
    type: 'OBJECT',
    properties: {
      assessments: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            candidate: { type: 'STRING' },
            score: { type: 'NUMBER' },
            keep: { type: 'BOOLEAN' },
            reason: { type: 'STRING' },
          },
          required: ['candidate', 'score', 'keep'],
        },
      },
    },
    required: ['assessments'],
  }

  try {
    const aiResponse = await generateContent({
      operationType: 'keyword_supplement_relevance_scoring',
      prompt,
      temperature: 0.1,
      maxOutputTokens: 4096,
      responseSchema,
      responseMimeType: 'application/json',
    }, input.userId)

    if (aiResponse.usage) {
      const cost = estimateTokenCost(
        aiResponse.model,
        aiResponse.usage.inputTokens,
        aiResponse.usage.outputTokens
      )
      await recordTokenUsage({
        userId: input.userId,
        model: aiResponse.model,
        operationType: 'keyword_supplement_relevance_scoring',
        inputTokens: aiResponse.usage.inputTokens,
        outputTokens: aiResponse.usage.outputTokens,
        totalTokens: aiResponse.usage.totalTokens,
        cost,
        apiType: aiResponse.apiType
      })
    }

    const jsonMatch = aiResponse.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('model output missing JSON')
    }

    const parsed = JSON.parse(repairJsonText(jsonMatch[0])) as {
      assessments?: SupplementCandidateAssessment[]
    }
    const assessments = Array.isArray(parsed.assessments) ? parsed.assessments : []

    const scoredByNormalized = new Map<string, SupplementCandidateAssessment>()
    for (const item of assessments) {
      const normalized = normalizeGoogleAdsKeyword(item?.candidate || '')
      if (!normalized) continue
      const score = Number.isFinite(Number(item?.score)) ? Number(item.score) : 0
      const keep = Boolean(item?.keep) || score >= KEYWORD_SUPPLEMENT_MODEL_PASS_SCORE
      const existing = scoredByNormalized.get(normalized)
      if (!existing || score > existing.score) {
        scoredByNormalized.set(normalized, {
          candidate: normalizeSupplementCandidate(item?.candidate || ''),
          score,
          keep,
          reason: typeof item?.reason === 'string' ? item.reason : '',
        })
      }
    }

    const ranked = uniqueCandidates
      .map((candidate) => {
        const normalized = normalizeGoogleAdsKeyword(candidate)
        const scored = normalized ? scoredByNormalized.get(normalized) : undefined
        return {
          candidate,
          score: scored?.score ?? 0,
          keep: scored?.keep ?? false,
        }
      })
      .filter(item => item.keep || item.score >= KEYWORD_SUPPLEMENT_MODEL_PASS_SCORE)
      .sort((a, b) => b.score - a.score)
      .map(item => item.candidate)

    if (ranked.length > 0) {
      return ranked
    }
  } catch (error: any) {
    console.warn(`[KeywordSupplement] 模型打分失败，回退规则筛选: ${error?.message || error}`)
  }

  return uniqueCandidates
}

function extractRawTitleAndAboutForSupplement(offer: any): { title: string; about: string[] } {
  const scrapedData = safeParseJson(offer?.scraped_data, {}) || {}
  const title = normalizeSnippetText(
    scrapedData?.rawProductTitle ||
    scrapedData?.productName ||
    offer?.product_name ||
    ''
  )

  const normalizeList = (input: unknown): string[] => {
    if (!Array.isArray(input)) return []
    return input
      .map(item => normalizeSnippetText(String(item || '')))
      .filter(Boolean)
      .slice(0, 8)
  }

  let about = normalizeList(scrapedData?.rawAboutThisItem)
  if (about.length === 0) about = normalizeList(scrapedData?.aboutThisItem)
  if (about.length === 0) about = normalizeList(scrapedData?.features)
  if (about.length === 0) about = normalizeList(scrapedData?.productFeatures)

  if (about.length === 0 && typeof scrapedData?.productDescription === 'string') {
    about = scrapedData.productDescription
      .split(/[\n.;!?]+/)
      .map((line: string) => normalizeSnippetText(line))
      .filter((line: string) => line.length >= 12)
      .slice(0, 6)
  }

  return { title, about }
}

function buildTitleAboutSupplementCandidates(
  title: string,
  about: string[],
  targetLanguage: string,
  brandName?: string | null
): string[] {
  const signals = extractTitleAndAboutSignals(title, about, {
    targetLanguage,
    brandName,
  })
  const seedTexts = [
    signals.productTitle,
    ...signals.titlePhrases,
    ...signals.aboutClaims,
    ...signals.keywordSeeds,
  ].filter(Boolean)

  const candidates: string[] = []
  const seen = new Set<string>()
  const push = (phrase: string) => {
    const cleaned = normalizeSupplementCandidate(phrase)
    const norm = normalizeGoogleAdsKeyword(cleaned)
    if (!norm || seen.has(norm)) return
    if (!isStructuredSupplementKeyword(cleaned, targetLanguage)) return
    const intent = classifyKeywordIntent(cleaned, { language: targetLanguage })
    if (intent.hardNegative) return
    seen.add(norm)
    candidates.push(cleaned)
  }

  for (const text of seedTexts) {
    const words = tokenizeSupplementCandidate(text)
    if (words.length >= 2 && words.length <= 6) {
      push(words.join(' '))
      continue
    }

    if (words.length > 6) {
      // Prefer complete leading keyphrases over arbitrary sliding n-grams.
      // This keeps supplementation semantically coherent (e.g. "non slip bath mat")
      // and avoids broken fragments like "fit under" / "backing non".
      push(words.slice(0, 6).join(' '))
      push(words.slice(0, 5).join(' '))
      push(words.slice(0, 4).join(' '))
    }
  }

  return candidates
}

async function loadPoolCandidatesForSupplement(offerId: number): Promise<string[]> {
  try {
    const { getKeywordPoolByOfferId } = await import('./offer-keyword-pool')
    const { getDatabase } = await import('./db')

    const pool = await getKeywordPoolByOfferId(offerId)
    if (!pool) return []

    // 🔥 优化(2026-03-13): 获取品牌名用于质量过滤
    const db = await getDatabase()
    const offerRow = await db.queryOne<{ brand: string | null }>(
      'SELECT brand FROM offers WHERE id = ?',
      [offerId]
    )
    const brandName = offerRow?.brand || ''

    const extractKeywords = (list: Array<{ keyword?: string } | string>): string[] =>
      list
        .map((item) => (typeof item === 'string' ? item : String(item?.keyword || '')))
        .map((item) => item.trim())
        .filter(Boolean)

    // 统一走 canonical D 视图，避免补词阶段继续消费旧的 raw A/B/C/D/S 分桶语义。
    const rawKeywords = extractKeywords(resolveCreativeBucketPoolKeywords(pool, 'D', 'D'))

    // 🔥 优化(2026-03-13): 二次质量过滤，防止关键词池污染
    // 确保池中关键词仍然符合当前质量标准
    if (!brandName) {
      // 无品牌名时跳过质量过滤，直接返回原始关键词
      return rawKeywords
    }

    const pureBrandKeywords = getPureBrandKeywords(brandName)

    let filteredCount = 0
    let brandVariantFiltered = 0
    let semanticFiltered = 0
    let nonBrandFiltered = 0

    const filteredKeywords = rawKeywords.filter(keyword => {
      const normalized = normalizeGoogleAdsKeyword(keyword)
      if (!normalized) {
        filteredCount++
        return false
      }

      const isPureBrand = isPureBrandKeyword(keyword, pureBrandKeywords)

      // 过滤品牌变体词（如 "eurekaddl"）
      if (!isPureBrand && isBrandVariant(keyword, brandName)) {
        brandVariantFiltered++
        filteredCount++
        return false
      }

      // 过滤语义查询词（如 "significato"）
      if (!isPureBrand && isSemanticQuery(keyword)) {
        semanticFiltered++
        filteredCount++
        return false
      }

      // 确保非纯品牌词包含品牌（防止品牌化失败的词进入池）
      if (!isPureBrand && !containsPureBrand(keyword, pureBrandKeywords)) {
        nonBrandFiltered++
        filteredCount++
        return false
      }

      return true
    })

    if (filteredCount > 0) {
      console.log(
        `[KeywordSupplement] 关键词池二次过滤: ${rawKeywords.length} → ${filteredKeywords.length} ` +
        `(品牌变体:${brandVariantFiltered}, 语义查询:${semanticFiltered}, 不含品牌:${nonBrandFiltered})`
      )
    }

    return filteredKeywords
  } catch (error: any) {
    console.warn(`[KeywordSupplement] 读取关键词池失败: ${error?.message || error}`)
    return []
  }
}

export async function applyKeywordSupplementationOnce(
  input: ApplyKeywordSupplementationOnceInput
): Promise<ApplyKeywordSupplementationOnceOutput> {
  const triggerThreshold = input.triggerThreshold ?? KEYWORD_SUPPLEMENT_TRIGGER_THRESHOLD
  const supplementCap = resolveKeywordSupplementCap({
    supplementCap: input.supplementCap,
    bucket: input.bucket,
  })
  const beforeKeywords = [...(input.keywordsWithVolume || [])]
  const beforeCount = beforeKeywords.length
  const pureBrandKeywords = getPureBrandKeywords(input.brandName || '')
  const thresholdGateEnabled = isCreativeKeywordSupplementThresholdGateEnabled()

  if (thresholdGateEnabled && beforeCount >= triggerThreshold) {
    return {
      keywordsWithVolume: beforeKeywords,
      keywords: beforeKeywords.map(kw => kw.keyword),
      keywordSupplementation: {
        triggered: false,
        beforeCount,
        afterCount: beforeCount,
        addedKeywords: [],
        supplementCapApplied: beforeCount >= supplementCap,
      },
    }
  }

  const hasCoverageGap = hasKeywordSupplementCoverageGap({
    keywordsWithVolume: beforeKeywords,
    pureBrandKeywords,
    targetLanguage: input.targetLanguage,
    bucket: input.bucket,
  })
  if (!hasCoverageGap) {
    return {
      keywordsWithVolume: beforeKeywords,
      keywords: beforeKeywords.map(kw => kw.keyword),
      keywordSupplementation: {
        triggered: false,
        beforeCount,
        afterCount: beforeCount,
        addedKeywords: [],
        supplementCapApplied: beforeCount >= supplementCap,
      },
    }
  }

  const maxAddCount = Math.max(0, supplementCap - beforeCount)

  if (maxAddCount <= 0) {
    return {
      keywordsWithVolume: beforeKeywords,
      keywords: beforeKeywords.map(kw => kw.keyword),
      keywordSupplementation: {
        triggered: false,
        beforeCount,
        afterCount: beforeCount,
        addedKeywords: [],
        supplementCapApplied: true,
      },
    }
  }
  const seen = new Set(
    beforeKeywords
      .map(kw => normalizeGoogleAdsKeyword(kw.keyword))
      .filter(Boolean)
  )

  const added: Array<{ keyword: string; source: 'keyword_pool' | 'title_about' }> = []
  const supplementWithVolume: KeywordWithVolume[] = []
  const rawContextForRelevance = extractRawTitleAndAboutForSupplement(input.offer)
  const contextTokens = buildSupplementContextTokens(rawContextForRelevance.title, beforeKeywords)

  // 🔥 优化(2026-03-13): 定义 bucket 与意图类型的兼容性（基于意图权重）
  // 使用软过滤策略：只过滤明确不兼容的意图，而不是硬编码允许列表
  const BUCKET_INCOMPATIBLE_INTENTS: Record<string, Set<string>> = {
    A: new Set(['SUPPORT', 'DOWNLOAD', 'JOBS', 'PIRACY']),  // 品牌商品锚点：排除支持、下载、招聘、盗版
    B: new Set(['JOBS', 'PIRACY', 'DOWNLOAD']),             // 商品需求场景：排除招聘、盗版、下载
    C: new Set(['JOBS', 'PIRACY', 'DOWNLOAD']),             // 功能规格/需求扩展：排除招聘、盗版、下载
    D: new Set(['SUPPORT', 'JOBS', 'PIRACY', 'DOWNLOAD']),  // 商品需求/行动：排除支持、招聘、盗版、下载
    S: new Set(['JOBS', 'PIRACY'])                          // 综合需求：只排除招聘、盗版
  }

  // 🔥 优化(2026-03-13): 监控统计
  const filterStats = {
    total: 0,
    structured: 0,
    hardNegative: 0,
    intentIncompatible: 0,  // 改名：意图不兼容（而非不匹配）
    contextMismatch: 0,
    brandingFailed: 0,
    duplicate: 0,
    added: 0
  }

  const tryAdd = (rawKeyword: string, source: 'keyword_pool' | 'title_about') => {
    if (maxAddCount <= 0 || added.length >= maxAddCount) return

    filterStats.total++

    const cleaned = normalizeSupplementCandidate(rawKeyword)
    if (!isStructuredSupplementKeyword(cleaned, input.targetLanguage)) {
      filterStats.structured++
      return
    }

    const intent = classifyKeywordIntent(cleaned, { language: input.targetLanguage })
    if (intent.hardNegative) {
      filterStats.hardNegative++
      return
    }

    // 🔥 优化(2026-03-13): 意图兼容性检查（软过滤）
    // 策略：只过滤明确不兼容的意图，而不是要求匹配允许列表
    if (input.bucket && BUCKET_INCOMPATIBLE_INTENTS[input.bucket]) {
      const incompatibleIntents = BUCKET_INCOMPATIBLE_INTENTS[input.bucket]

      // 检查关键词意图是否在不兼容列表中
      if (incompatibleIntents.has(intent.intent)) {
        filterStats.intentIncompatible++
        if (filterStats.intentIncompatible <= 3) {
          console.log(`[KeywordSupplement] ❌ 意图不兼容: "${cleaned}" (${intent.intent}) 不适合 bucket ${input.bucket}`)
        }
        return
      }
    }

    if (source === 'title_about' && contextTokens.size > 0) {
      const candidateTokens = tokenizeSupplementCandidate(cleaned)
        .map(token => token.toLowerCase())
        .filter(token => token.length >= 3)
      const hasContextOverlap = candidateTokens.some(token => contextTokens.has(token))
      if (!hasContextOverlap) {
        filterStats.contextMismatch++
        return
      }
    }

    const finalKeyword = composeBrandedSupplementKeyword(cleaned, input.brandName)
    if (!finalKeyword) {
      filterStats.brandingFailed++
      return
    }

    const normalized = normalizeGoogleAdsKeyword(finalKeyword)
    if (!normalized || seen.has(normalized)) {
      if (normalized && seen.has(normalized)) {
        filterStats.duplicate++
      }
      return
    }

    seen.add(normalized)
    added.push({ keyword: finalKeyword, source })
    supplementWithVolume.push({
      keyword: finalKeyword,
      searchVolume: 0,
      source: source === 'keyword_pool' ? 'KEYWORD_POOL' : 'AI_GENERATED',
      sourceType: source === 'keyword_pool' ? 'CANONICAL_BUCKET_VIEW' : 'AI_TITLE_ABOUT_SUPPLEMENT',
      matchType: shouldUseExactMatch(finalKeyword, pureBrandKeywords) ? 'EXACT' : 'PHRASE',
    })
    filterStats.added++
  }

  const dbPoolCandidates = await loadPoolCandidatesForSupplement(Number(input.offer?.id || 0))
  const orderedPoolCandidatesRaw = [
    ...(input.poolCandidates || []),
    ...dbPoolCandidates,
  ]
  const orderedPoolCandidates = await rankSupplementCandidatesWithModel({
    source: 'keyword_pool',
    candidates: orderedPoolCandidatesRaw,
    userId: input.userId,
    brandName: input.brandName,
    targetLanguage: input.targetLanguage,
    title: rawContextForRelevance.title,
    about: rawContextForRelevance.about,
    existingKeywords: beforeKeywords,
    skipAiRanking: input.skipAiRanking,
  })
  for (const candidate of orderedPoolCandidates) {
    tryAdd(candidate, 'keyword_pool')
    if (added.length >= maxAddCount) break
  }

  if (added.length < maxAddCount) {
    const titleAboutCandidatesRaw = buildTitleAboutSupplementCandidates(
      rawContextForRelevance.title,
      rawContextForRelevance.about,
      input.targetLanguage,
      input.brandName
    )
    const titleAboutCandidates = await rankSupplementCandidatesWithModel({
      source: 'title_about',
      candidates: titleAboutCandidatesRaw,
      userId: input.userId,
      brandName: input.brandName,
      targetLanguage: input.targetLanguage,
      title: rawContextForRelevance.title,
      about: rawContextForRelevance.about,
      existingKeywords: [...beforeKeywords, ...supplementWithVolume],
      skipAiRanking: input.skipAiRanking,
    })
    for (const candidate of titleAboutCandidates) {
      tryAdd(candidate, 'title_about')
      if (added.length >= maxAddCount) break
    }
  }

  const merged = [...beforeKeywords, ...supplementWithVolume]
  const afterCount = merged.length
  const supplementCapApplied = beforeCount < supplementCap && afterCount >= supplementCap

  // 🔥 优化(2026-03-13): 详细的监控日志
  console.log(
    `[KeywordSupplement] offer=${input.offer?.id || 'unknown'} bucket=${input.bucket || 'unknown'} triggered=true before=${beforeCount} after=${afterCount} added=${added.length} cap=${supplementCap}`
  )

  // 输出过滤统计
  const filterRate = filterStats.total > 0
    ? ((filterStats.total - filterStats.added) / filterStats.total * 100).toFixed(1)
    : '0.0'
  console.log(
    `[KeywordSupplement] 📊 过滤统计: 总候选=${filterStats.total} ` +
    `过滤=${filterStats.total - filterStats.added} (${filterRate}%) ` +
    `添加=${filterStats.added}`
  )
  console.log(
    `[KeywordSupplement] 📋 过滤原因: ` +
    `结构化=${filterStats.structured} ` +
    `硬负面=${filterStats.hardNegative} ` +
    `意图不兼容=${filterStats.intentIncompatible} ` +
    `上下文不匹配=${filterStats.contextMismatch} ` +
    `品牌化失败=${filterStats.brandingFailed} ` +
    `重复=${filterStats.duplicate}`
  )

  // 如果意图不兼容过滤较多，输出警告
  if (filterStats.intentIncompatible > filterStats.added * 0.5) {
    console.warn(
      `[KeywordSupplement] ⚠️ 意图不兼容过滤较多 (${filterStats.intentIncompatible}/${filterStats.total})，` +
      `可能需要调整 bucket ${input.bucket} 的不兼容意图定义`
    )
  }

  // 如果补充数量不足，输出警告
  if (added.length < maxAddCount * 0.5 && maxAddCount > 10) {
    console.warn(
      `[KeywordSupplement] ⚠️ 补充数量不足 (${added.length}/${maxAddCount})，` +
      `最终关键词数=${afterCount}，目标=${supplementCap}`
    )
  }

  if (added.length > 0) {
    console.log(
      `[KeywordSupplement] added: ${added.map(item => `${item.keyword} [${item.source}]`).slice(0, 12).join(' | ')}`
    )
  }

  return {
    keywordsWithVolume: merged,
    keywords: merged.map(kw => kw.keyword),
    keywordSupplementation: {
      triggered: true,
      beforeCount,
      afterCount,
      addedKeywords: added,
      supplementCapApplied,
    },
  }
}

interface ExtractedKeywordForMerge {
  keyword?: string
  searchVolume: number
  competition?: string
  competitionIndex?: number
  volumeUnavailableReason?: 'DEV_TOKEN_INSUFFICIENT_ACCESS'
  source?: string // 🆕 2026-03-13: 支持SCORING_SUGGESTION等来源标记
  sourceType?: string
}

interface MergeExtractedKeywordsInput {
  keywordsWithVolume: KeywordWithVolume[]
  extractedKeywords: ExtractedKeywordForMerge[]
  brandName: string
  productCategory: string
  userId: number
  offerId?: number
  targetCountry: string
  language: string
  creativeType?: 'brand_intent' | 'model_intent' | 'product_intent' | null
  fallbackMode?: boolean
}

interface MergeExtractedKeywordsOutput {
  keywordsWithVolume: KeywordWithVolume[]
}

function isSearchVolumeUnavailableReason(reason: unknown): boolean {
  return reason === 'DEV_TOKEN_INSUFFICIENT_ACCESS'
}

function hasSearchVolumeUnavailableFlag(
  keywords: Array<{ volumeUnavailableReason?: unknown }>
): boolean {
  return keywords.some((kw) => isSearchVolumeUnavailableReason(kw?.volumeUnavailableReason))
}

function isKeywordPlannerVolumePermissionError(error: unknown): boolean {
  const text = String((error as any)?.message || error || '').toUpperCase()
  if (!text) return false

  return (
    text.includes('DEV_TOKEN_INSUFFICIENT_ACCESS')
    || text.includes('INSUFFICIENT')
    || text.includes('EXPLORER')
    || text.includes('PERMISSION_DENIED')
    || text.includes('USER_PERMISSION_DENIED')
    || text.includes('NOT AUTHORIZED')
  )
}

function normalizeKeywordSourceTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const normalized = Array.from(new Set(
    value
      .map((item) => String(item || '').trim().toUpperCase())
      .filter(Boolean)
  )).slice(0, 8)
  return normalized.length > 0 ? normalized : undefined
}

export function normalizeKeywordSourceAuditForGeneratorList(
  keywords: KeywordWithVolume[]
): KeywordWithVolume[] {
  const aiSourceSubtypeEnabled = isCreativeKeywordAiSourceSubtypeEnabled()
  return (keywords || []).map((item) => {
    const source = typeof item?.source === 'string' ? item.source.trim().toUpperCase() : undefined
    const explicitSourceType = typeof item?.sourceType === 'string'
      ? item.sourceType.trim().toUpperCase()
      : undefined
    const explicitSourceSubtype = typeof (item as any)?.sourceSubtype === 'string'
      ? (item as any).sourceSubtype.trim().toUpperCase()
      : undefined
    const sourceSubtype = aiSourceSubtypeEnabled
      ? (
        explicitSourceSubtype
        || explicitSourceType
        || normalizeKeywordSourceSubtype({
          source,
          sourceType: explicitSourceType,
        })
      )
      : normalizeKeywordSourceSubtype({ source })

    const rawSource = (
      typeof (item as any)?.rawSource === 'string'
        ? (item as any).rawSource.trim().toUpperCase()
        : undefined
    ) || inferKeywordRawSource({
      source,
      sourceType: sourceSubtype || item?.sourceType,
    })

    const derivedTags = normalizeKeywordSourceTags((item as any)?.derivedTags)
      || inferKeywordDerivedTags({
        source,
        sourceType: sourceSubtype || item?.sourceType,
      })

    return {
      ...item,
      source: source || item.source,
      sourceType: (explicitSourceType || sourceSubtype || source),
      sourceSubtype,
      rawSource,
      derivedTags,
    }
  })
}

export function normalizeSourceTypeFromLegacySource(input: {
  source?: string
  sourceType?: string
}): string | undefined {
  const sourceType = String(input.sourceType || '').trim().toUpperCase()
  if (sourceType) return sourceType

  const source = String(input.source || '').trim().toUpperCase()
  if (!source) return undefined

  if (source === 'AI_ENHANCED') return 'AI_ENHANCED_PERSISTED'
  if (source === 'AI_GENERATED') return 'AI_LLM_RAW'
  if (source === 'SCORING_SUGGESTION') return 'GAP_INDUSTRY_BRANDED'
  if (source === 'KEYWORD_POOL') return 'CANONICAL_BUCKET_VIEW'
  if (source === 'SEARCH_TERM') return 'SEARCH_TERM_HIGH_PERFORMING'
  return source
}

export function resolveCreativeTypeFromBucketForMerge(
  bucket: 'A' | 'B' | 'C' | 'D' | 'S' | null | undefined
): 'brand_intent' | 'model_intent' | 'product_intent' | null {
  if (bucket === 'A') return 'brand_intent'
  if (bucket === 'B' || bucket === 'C') return 'model_intent'
  if (bucket === 'D' || bucket === 'S') return 'product_intent'
  return null
}

export function shouldAllowZeroVolumeKeywordForMerge(input: {
  keyword: string
  source?: string
  sourceType?: string
  brandName: string
  language: string
  creativeType?: 'brand_intent' | 'model_intent' | 'product_intent' | null
  fallbackMode?: boolean
  volumeDataUnavailable?: boolean
}): boolean {
  const normalizedSource = String(
    normalizeSourceTypeFromLegacySource({
      source: input.source,
      sourceType: input.sourceType,
    }) || ''
  ).trim().toUpperCase()
  if (!normalizedSource) return false

  // DERIVED_VIEW 来源永不放行 zero-volume（避免 KEYWORD_POOL 派生词直通）。
  if (normalizedSource === 'KEYWORD_POOL' || normalizedSource === 'CANONICAL_BUCKET_VIEW') {
    return false
  }

  const creativeType = input.creativeType || null
  const fallbackMode = Boolean(input.fallbackMode)
  const volumeDataUnavailable = Boolean(input.volumeDataUnavailable)
  const hasModelAnchor = hasModelAnchorEvidence({ keywords: [input.keyword] })

  const pureBrandKeywords = getPureBrandKeywords(input.brandName || '')
  const isBrandKeywordCandidate =
    containsPureBrand(input.keyword, pureBrandKeywords) ||
    isBrandConcatenation(input.keyword, input.brandName)

  const intent = classifyKeywordIntent(input.keyword, { language: input.language })
  const isCommercialIntent = intent.intent === 'TRANSACTIONAL' || intent.intent === 'COMMERCIAL'
  const sourceScore = getKeywordSourcePriorityScoreFromInput({
    source: input.source,
    sourceType: normalizedSource,
  })
  const isTrustedSourceInNoVolumeMode = sourceScore >= 62

  if (normalizedSource === 'GLOBAL_CATEGORY_BRANDED') {
    if (creativeType === 'model_intent' && !hasModelAnchor && !fallbackMode) return false
    return true
  }

  if (normalizedSource === 'SCORING_SUGGESTION' || normalizedSource === 'GAP_INDUSTRY_BRANDED') {
    if (creativeType === 'model_intent' && !hasModelAnchor) return false
    if (!fallbackMode && !isBrandKeywordCandidate && !isCommercialIntent) return false
    return true
  }

  if (normalizedSource === 'AI_TITLE_ABOUT_SUPPLEMENT') {
    if (creativeType === 'model_intent' && !hasModelAnchor) return false
    if (!isBrandKeywordCandidate && !isCommercialIntent && !fallbackMode) return false
    return true
  }

  if (normalizedSource === 'AI_ENHANCED' || normalizedSource === 'AI_ENHANCED_PERSISTED') {
    if (creativeType === 'model_intent' && !hasModelAnchor && !fallbackMode) return false
    return isBrandKeywordCandidate || isCommercialIntent || fallbackMode
  }

  // Explorer/Test 权限下 volume 不可用时，改用来源可信度+类型匹配门禁。
  if (volumeDataUnavailable) {
    if (creativeType === 'model_intent' && !hasModelAnchor) return false
    if (isBrandKeywordCandidate || isCommercialIntent) return true
    return isTrustedSourceInNoVolumeMode && fallbackMode
  }

  // 低置信 AI 词仅在 fallback 或 product_intent 下放行，并保持品牌/商业意图门禁。
  if (
    normalizedSource === 'AI_GENERATED'
    || normalizedSource === 'AI_LLM_RAW'
    || normalizedSource === 'AI_FALLBACK_PLACEHOLDER'
  ) {
    if (creativeType === 'model_intent' && !hasModelAnchor) return false
    if (creativeType !== 'product_intent' && !fallbackMode) return false
    return isBrandKeywordCandidate || isCommercialIntent
  }

  return false
}

async function mergeExtractedKeywordsWithSingleExit(
  input: MergeExtractedKeywordsInput
): Promise<MergeExtractedKeywordsOutput> {
  const {
    keywordsWithVolume: baseKeywordsWithVolume,
    extractedKeywords,
    brandName,
    productCategory,
    userId,
    offerId,
    targetCountry,
    language,
    creativeType,
    fallbackMode,
  } = input

  const mergedKeywordsWithVolume = [...baseKeywordsWithVolume]
  let mergedCount = 0

  if (extractedKeywords.length > 0) {
    console.log(`\n🔗 合并extracted_keywords到关键词列表...`)

    const existingKeywordsLower = new Set(
      mergedKeywordsWithVolume
        .filter(k => k.keyword)
        .map(k => k.keyword.toLowerCase())
    )
    const brandNameLowerForMerge = brandName?.toLowerCase() || ''
    const pureBrandKeywordsForMerge = getPureBrandKeywords(brandName || '')
    const brandKeywordCountForThreshold = countBrandContainingKeywords(
      mergedKeywordsWithVolume,
      brandName,
      pureBrandKeywordsForMerge
    )
    const dynamicNonBrandMinSearchVolume =
      resolveNonBrandMinSearchVolumeByBrandKeywordCount(brandKeywordCountForThreshold)
    console.log(
      `   🎚️ 动态非品牌搜索量阈值: >= ${dynamicNonBrandMinSearchVolume} (品牌相关词 ${brandKeywordCountForThreshold} 个)`
    )
    let volumeUnavailable = hasSearchVolumeUnavailableFlag(mergedKeywordsWithVolume)

    // 🐛 修复(2026-03-14): 排除 GLOBAL_CATEGORY_BRANDED 来源的关键词
    // 这些关键词是品牌前置生成的组合词，不需要查询 Keyword Planner
    const keywordsNeedVolume = extractedKeywords.filter(kw =>
      kw.keyword &&
      kw.searchVolume === 0 &&
      kw.source !== 'GLOBAL_CATEGORY_BRANDED' &&
      !existingKeywordsLower.has(kw.keyword.toLowerCase())
    )

    if (keywordsNeedVolume.length > 0) {
      console.log(`   📊 查询 ${keywordsNeedVolume.length} 个关键词的搜索量...`)
      try {
        const keywordsForVolumeLookup = keywordsNeedVolume
          .map(k => k.keyword)
          .filter((keyword): keyword is string => Boolean(keyword))
        const volumeResult = await getKeywordSearchVolumesForPlannerContext({
          userId,
          offerId,
          keywords: keywordsForVolumeLookup,
          country: targetCountry,
          language,
        })
        if (!volumeResult.ok) {
          throw new Error(volumeResult.message)
        }
        const volumes = volumeResult.volumes

        keywordsNeedVolume.forEach(kw => {
          if (!kw.keyword) return
          const volumeData = volumes.find((v: any) => v.keyword.toLowerCase() === kw.keyword?.toLowerCase())
          if (volumeData) {
            kw.searchVolume = volumeData.avgMonthlySearches
            kw.volumeUnavailableReason = volumeData.volumeUnavailableReason
            if (isSearchVolumeUnavailableReason(volumeData.volumeUnavailableReason)) {
              volumeUnavailable = true
            }
          }
        })
        console.log(`   ✅ 搜索量查询完成`)
      } catch (volumeError) {
        console.warn(`   ⚠️ 搜索量查询失败，使用默认值0:`, volumeError)
        if (isKeywordPlannerVolumePermissionError(volumeError)) {
          volumeUnavailable = true
          console.warn('   ⚠️ Keyword Planner 搜索量权限不足（Explorer/Test），切换 no-volume 语义门禁模式')
        }
      }
    }

    if (volumeUnavailable) {
      console.log('   ℹ️ 搜索量不可用：使用 sourceType + creativeType + fallback 的匹配门禁')
    }

    const keywordsToMerge = extractedKeywords.filter(kw => {
      if (!kw.keyword) return false
      const kwLower = kw.keyword.toLowerCase()
      if (existingKeywordsLower.has(kwLower)) return false

      if (kw.searchVolume === 0) {
        const allowZeroVolume = shouldAllowZeroVolumeKeywordForMerge({
          keyword: kw.keyword,
          source: kw.source,
          sourceType: kw.sourceType,
          brandName,
          language,
          creativeType,
          fallbackMode: fallbackMode || volumeUnavailable,
          volumeDataUnavailable: volumeUnavailable,
        })
        if (!allowZeroVolume) return false
        return true
      }

      const isBrandKeywordCandidate =
        containsPureBrand(kw.keyword, pureBrandKeywordsForMerge) ||
        isBrandConcatenation(kw.keyword, brandName)
      if (!volumeUnavailable && !isBrandKeywordCandidate && kw.searchVolume < dynamicNonBrandMinSearchVolume) return false
      return true
    })
    const skippedCount = extractedKeywords.length - keywordsToMerge.length

    if (keywordsToMerge.length === 0) {
      console.log(`   ℹ️ 无新关键词需要合并（全部重复或搜索量不足）`)
    } else {
      let intentMap = new Map<string, IntentCategory>()
      try {
        console.log(`   🤖 调用AI语义分类: ${keywordsToMerge.length} 个关键词`)
        const buckets = await clusterKeywordsByIntent(
          keywordsToMerge.map(k => k.keyword).filter(Boolean) as string[],
          brandName || '',
          productCategory,
          userId,
          targetCountry,
          language,
          'product'
        )

        buckets.bucketA.keywords.filter(Boolean).forEach(k => intentMap.set(k.toLowerCase(), 'brand'))
        buckets.bucketB.keywords.filter(Boolean).forEach(k => intentMap.set(k.toLowerCase(), 'scenario'))
        buckets.bucketC.keywords.filter(Boolean).forEach(k => intentMap.set(k.toLowerCase(), 'function'))

        console.log(`   ✅ AI分类完成:`)
        console.log(`      品牌商品锚点: ${buckets.bucketA.keywords.length} 个`)
        console.log(`      商品需求场景: ${buckets.bucketB.keywords.length} 个`)
        console.log(`      功能规格/需求扩展: ${buckets.bucketC.keywords.length} 个`)
      } catch (clusterError: any) {
        console.warn(`   ⚠️ AI语义分类失败，使用默认分类: ${clusterError.message}`)
        keywordsToMerge.forEach(kw => {
          if (kw.keyword) intentMap.set(kw.keyword.toLowerCase(), 'function')
        })
      }

      keywordsToMerge.forEach(kw => {
        if (!kw.keyword) return
        const kwLower = kw.keyword.toLowerCase()
        const isBrandKeyword = kwLower === brandNameLowerForMerge || kwLower.startsWith(brandNameLowerForMerge + ' ')
        const wordCount = kw.keyword.split(' ').length
        let matchType: 'BROAD' | 'PHRASE' | 'EXACT'

        if (isBrandKeyword) {
          matchType = 'EXACT'
        } else if (wordCount >= 3) {
          matchType = 'PHRASE'
        } else {
          matchType = 'PHRASE'
        }

        mergedKeywordsWithVolume.push({
          keyword: kw.keyword,
          searchVolume: kw.searchVolume,
          competition: kw.competition || 'MEDIUM',
          competitionIndex: kw.competitionIndex || 0.5,
          lowTopPageBid: 0,
          highTopPageBid: 0,
          matchType,
          intentCategory: intentMap.get(kwLower) || 'function',
          source: 'MERGED',
          sourceType: normalizeSourceTypeFromLegacySource(kw),
        })
        existingKeywordsLower.add(kwLower)
        mergedCount++
      })

      console.log(`   ✅ 合并完成: 新增 ${mergedCount} 个关键词 (跳过 ${skippedCount} 个重复/低质量)`)
      console.log(`   📊 当前关键词总数: ${mergedKeywordsWithVolume.length} 个`)

      const brandCount = keywordsToMerge.filter(k => k.keyword && intentMap.get(k.keyword.toLowerCase()) === 'brand').length
      const scenarioCount = keywordsToMerge.filter(k => k.keyword && intentMap.get(k.keyword.toLowerCase()) === 'scenario').length
      const functionCount = keywordsToMerge.filter(k => k.keyword && intentMap.get(k.keyword.toLowerCase()) === 'function').length
      console.log(`   📊 意图分类: 品牌=${brandCount}, 场景=${scenarioCount}, 功能=${functionCount}`)
    }
  }

  return {
    keywordsWithVolume: mergedKeywordsWithVolume,
  }
}

interface KeywordFinalizeInput {
  keywordsWithVolume: KeywordWithVolume[]
  offerBrand: string
  brandName: string
  canonicalBrandKeyword: string | null
  pureBrandKeywordsList: string[]
  brandTokensToMatch: string[]
  mustContainBrand: boolean
  targetCountry: string
  targetLanguage: string
  userId: number
  offerId?: number
}

interface KeywordFinalizeOutput {
  keywordsWithVolume: KeywordWithVolume[]
  keywords: string[]
}

async function finalizeKeywordsWithSingleExit(input: KeywordFinalizeInput): Promise<KeywordFinalizeOutput> {
  let keywordsWithVolume = [...input.keywordsWithVolume]
  const {
    offerBrand,
    brandName,
    canonicalBrandKeyword,
    pureBrandKeywordsList,
    brandTokensToMatch,
    mustContainBrand,
    targetCountry,
    targetLanguage,
    userId,
  } = input

  const brandKeywordLower = canonicalBrandKeyword || offerBrand.toLowerCase().trim()
  const containsBrand = (keyword: string, searchVolume?: number): boolean => {
    if (containsPureBrand(keyword, brandTokensToMatch)) return true
    // 🔥 修复(2026-03-13): 品牌拼接词即使搜索量为 0 也应该保留（真实品牌词）
    // 移除搜索量依赖，避免真实品牌词被意外过滤
    if (isBrandConcatenation(keyword, offerBrand)) return true
    return false
  }

  // 🎯 最终关键词过滤：强制约束
  console.log('\n🔍 执行最终关键词过滤 (强制约束)...')
  const beforeFilterCount = keywordsWithVolume.length

  // 第1步：分离品牌词、品牌相关词和非品牌词
  const pureBrandKeywords: typeof keywordsWithVolume = []
  const brandRelatedKeywords: typeof keywordsWithVolume = []
  const nonBrandKeywords: typeof keywordsWithVolume = []

  keywordsWithVolume.forEach(kw => {
    const isPureBrand = shouldUseExactMatch(kw.keyword, pureBrandKeywordsList)
    const isBrandRelated = !isPureBrand && containsBrand(kw.keyword, kw.searchVolume)

    if (isPureBrand) {
      pureBrandKeywords.push(kw)
    } else if (isBrandRelated) {
      brandRelatedKeywords.push(kw)
    } else {
      nonBrandKeywords.push(kw)
    }
  })

  console.log(`   📊 关键词分类结果 (使用纯品牌词列表: [${pureBrandKeywordsList.slice(0, 3).join(', ')}${pureBrandKeywordsList.length > 3 ? '...' : ''}])`)
  console.log(`      🏷️ 纯品牌词: ${pureBrandKeywords.length} 个`)
  console.log(`      🔗 品牌相关词: ${brandRelatedKeywords.length} 个`)
  console.log(`      📝 非品牌词: ${nonBrandKeywords.length} 个`)

  // 自动分配matchType（品牌词策略）
  console.log(`\n📌 自动分配matchType（品牌词策略）`)
  pureBrandKeywords.forEach(kw => {
    kw.matchType = 'EXACT'
  })
  console.log(`   ✅ 纯品牌词(${pureBrandKeywords.length}个) → EXACT 精准匹配`)

  brandRelatedKeywords.forEach(kw => {
    kw.matchType = 'PHRASE'
  })
  console.log(`   ✅ 品牌相关词(${brandRelatedKeywords.length}个) → PHRASE 词组匹配`)

  nonBrandKeywords.forEach(kw => {
    kw.matchType = 'PHRASE'
  })
  console.log(`   ✅ 非品牌词(${nonBrandKeywords.length}个) → PHRASE 词组匹配（暂不使用BROAD）`)

  // 高价值通用词提取
  console.log(`\n📌 高价值通用词提取`)
  const { extractGenericHighValueKeywords } = await import('@/lib/unified-keyword-service')
  const extractedGenericKeywords = extractGenericHighValueKeywords(
    keywordsWithVolume,
    offerBrand,
    []
  )
  extractedGenericKeywords.forEach(kw => {
    if (!kw.matchType) kw.matchType = 'PHRASE'
  })
  console.log(`   🎯 提取到 ${extractedGenericKeywords.length} 个高价值通用词 (matchType=PHRASE)`)

  const volumeDataUnavailable = keywordsWithVolume.some(kw =>
    kw.volumeUnavailableReason === 'DEV_TOKEN_INSUFFICIENT_ACCESS'
  )
  if (volumeDataUnavailable) {
    console.log(`   ⚠️ 搜索量数据不可用（developer token 为 Test/Explorer 权限），跳过搜索量过滤`)
  }

  const dynamicNonBrandMinSearchVolume = resolveNonBrandMinSearchVolumeByBrandKeywordCount(
    pureBrandKeywords.length + brandRelatedKeywords.length
  )
  console.log(
    `   🎚️ 动态非品牌搜索量阈值: >= ${dynamicNonBrandMinSearchVolume} (品牌相关词 ${pureBrandKeywords.length + brandRelatedKeywords.length} 个)`
  )

  // 过滤非品牌词（按动态阈值保留）
  const hasAnyVolume = nonBrandKeywords.some(kw => kw.searchVolume > 0)
  const canUseVolumeFilter = hasAnyVolume && !volumeDataUnavailable
  const filteredNonBrandKeywords = canUseVolumeFilter
    ? nonBrandKeywords.filter(kw => kw.searchVolume >= dynamicNonBrandMinSearchVolume)
    : nonBrandKeywords

  const enhancedNonBrandKeywords = [...filteredNonBrandKeywords, ...extractedGenericKeywords]

  // 强制约束1：纯品牌词必须添加
  console.log(`\n📌 强制约束1: 纯品牌词 "${offerBrand}" 必须添加`)
  const existingPureBrand = pureBrandKeywords.find(kw => kw.searchVolume > 0)

  if (existingPureBrand) {
    console.log(`   ✅ 纯品牌词已存在: "${existingPureBrand.keyword}" (${existingPureBrand.searchVolume}/月)`)
  } else {
    console.log(`   ⚠️ 纯品牌词 "${offerBrand}" 需要查询搜索量...`)
    let brandSearchVolume = 0

    try {
      const { getDatabase } = await import('./db')
      const db = await getDatabase()
      const langCode = (targetLanguage || 'English').toLowerCase().substring(0, 2)

      const row = await db.queryOne(`
        SELECT keyword, search_volume
        FROM global_keywords
        WHERE LOWER(keyword) = LOWER(?) AND country = ?
        ORDER BY search_volume DESC
        LIMIT 1
      `, [offerBrand, targetCountry]) as { keyword: string; search_volume: number } | undefined

      if (row && row.search_volume > 0) {
        brandSearchVolume = row.search_volume
        console.log(`   ✅ 全局缓存查询到搜索量: ${brandSearchVolume}/月`)
      } else {
        const volumeResult = await getKeywordSearchVolumesForPlannerContext({
          userId,
          offerId: input.offerId,
          keywords: [offerBrand],
          country: targetCountry,
          language: langCode,
        })
        if (volumeResult.ok) {
          const volumes = volumeResult.volumes
          if (volumes.length > 0 && volumes[0].avgMonthlySearches > 0) {
            brandSearchVolume = volumes[0].avgMonthlySearches
            console.log(`   ✅ Keyword Planner API查询到搜索量: ${brandSearchVolume}/月`)
          } else {
            console.log(`   ⚠️ Keyword Planner API未返回搜索量数据`)
          }
        } else {
          console.log(`   ⚠️ Google Ads 认证未配置，跳过品牌词搜索量 API 查询`)
        }
      }
    } catch (err: any) {
      console.warn(`   ⚠️ 查询纯品牌词搜索量失败: ${err.message}`)
    }

    pureBrandKeywords.push({
      keyword: offerBrand,
      searchVolume: brandSearchVolume,
      matchType: 'EXACT'
    })

    if (brandSearchVolume > 0) {
      console.log(`   ✅ 纯品牌词 "${offerBrand}" 已添加 (搜索量: ${brandSearchVolume}/月)`)
    } else {
      console.log(`   ⚠️ 纯品牌词 "${offerBrand}" 已添加 (搜索量: 未知，建议手动验证)`)
    }
  }

  // 强制约束2：非品牌词阈值
  console.log(`\n📌 强制约束2: 非品牌词搜索量 >= ${dynamicNonBrandMinSearchVolume} 或来自高价值词提取`)
  console.log(`   - 搜索量达标的非品牌词: ${filteredNonBrandKeywords.length} 个`)
  console.log(`   - 提取的高价值词 (>10000): ${extractedGenericKeywords.length} 个`)
  console.log(`   - 合计非品牌词: ${enhancedNonBrandKeywords.length} 个`)

  const hasAnyVolumeBrand = brandRelatedKeywords.some(kw => kw.searchVolume > 0)
  const shouldFilterBrandByVolume = hasAnyVolumeBrand && !volumeDataUnavailable
  const allBrandKeywords = [
    ...pureBrandKeywords,
    ...brandRelatedKeywords.filter(kw => shouldFilterBrandByVolume ? kw.searchVolume > 0 : true)
  ]
  let finalKeywords = [...allBrandKeywords, ...enhancedNonBrandKeywords]
  console.log(`   📊 初始合并: ${allBrandKeywords.length} 品牌词 + ${enhancedNonBrandKeywords.length} 非品牌词 = ${finalKeywords.length} 个`)

  // 强制约束3：移除无搜索量关键词（纯品牌词豁免）
  console.log(`\n📌 强制约束3: 移除所有搜索量为0或null的关键词（品牌词除外）`)
  const beforeFinalFilter = finalKeywords.length
  const hasAnyVolumeData = finalKeywords.some(kw => kw.searchVolume > 0)
  const pureBrandKeywordNormalized = new Set(
    pureBrandKeywords
      .map(kw => normalizeGoogleAdsKeyword(kw.keyword))
      .filter(Boolean)
  )

  if (hasAnyVolumeData && !volumeDataUnavailable) {
    finalKeywords = finalKeywords.filter(kw => {
      const kwNorm = normalizeGoogleAdsKeyword(kw.keyword)
      return kw.searchVolume > 0 || (kwNorm && pureBrandKeywordNormalized.has(kwNorm))
    })

    const removedZeroVolume = beforeFinalFilter - finalKeywords.length
    if (removedZeroVolume > 0) {
      console.log(`   ⚠️ 已移除 ${removedZeroVolume} 个搜索量为0的关键词（保留品牌词）`)
    }
  } else {
    if (volumeDataUnavailable) {
      console.log(`   ⚠️ 搜索量数据不可用（developer token 无 Basic/Standard access 或 服务账号限制），跳过搜索量过滤`)
    } else {
      console.log(`   ⚠️ 所有关键词搜索量为0（可能是服务账号模式），跳过搜索量过滤`)
    }
  }
  console.log(`   ✅ 最终保留 ${finalKeywords.length} 个关键词（含搜索量数据或品牌词）`)

  const retainedBrandWithZeroVolume = finalKeywords.filter(kw =>
    kw.searchVolume === 0 && pureBrandKeywordNormalized.has(normalizeGoogleAdsKeyword(kw.keyword))
  )
  if (retainedBrandWithZeroVolume.length > 0) {
    console.log(`   ℹ️ 保留 ${retainedBrandWithZeroVolume.length} 个搜索量为0的品牌词:`)
    retainedBrandWithZeroVolume.forEach(kw => {
      console.log(`      - "${kw.keyword}" (品牌词，搜索量未知)`)
    })
  }

  // 强制约束4：购买意图评分过滤
  console.log(`\n📌 强制约束4: 购买意图评分过滤（移除纯信息查询词）`)
  const MIN_INTENT_SCORE = KEYWORD_POLICY.creative.minIntentScore
  const EXPLORE_MIN_INTENT_SCORE = KEYWORD_POLICY.creative.explore.minIntentScore
  const EXPLORE_MAX_INTENT_SCORE = Math.min(
    MIN_INTENT_SCORE,
    KEYWORD_POLICY.creative.explore.maxIntentScoreExclusive
  )
  const beforeIntentFilter = finalKeywords.length

  const keywordsWithIntent = finalKeywords.map(kw => ({
    ...kw,
    intentScore: calculateIntentScore(kw.keyword, brandName),
    intentLevel: getIntentLevel(calculateIntentScore(kw.keyword, brandName))
  }))
  const isPureBrandInFinal = (kw: { keyword: string }) => {
    const normalized = normalizeGoogleAdsKeyword(kw.keyword)
    return normalized ? pureBrandKeywordNormalized.has(normalized) : false
  }

  const highIntentKws = keywordsWithIntent.filter(kw => kw.intentScore >= 80)
  const mediumIntentKws = keywordsWithIntent.filter(kw => kw.intentScore >= 50 && kw.intentScore < 80)
  const lowIntentKws = keywordsWithIntent.filter(kw => kw.intentScore >= MIN_INTENT_SCORE && kw.intentScore < 50)
  const infoIntentKws = keywordsWithIntent.filter(kw => kw.intentScore < MIN_INTENT_SCORE && !isPureBrandInFinal(kw))
  const exploreIntentCandidates = keywordsWithIntent
    .filter(kw =>
      kw.intentScore >= EXPLORE_MIN_INTENT_SCORE &&
      kw.intentScore < EXPLORE_MAX_INTENT_SCORE &&
      !isPureBrandInFinal(kw)
    )
    .sort((a, b) => (b.searchVolume || 0) - (a.searchVolume || 0))

  console.log(`   📊 意图分布统计:`)
  console.log(`      🟢 高购买意图 (≥80): ${highIntentKws.length} 个`)
  console.log(`      🟡 中等意图 (50-79): ${mediumIntentKws.length} 个`)
  console.log(`      🟠 低购买意图 (20-49): ${lowIntentKws.length} 个`)
  console.log(`      ⚪ 信息查询 (<20): ${infoIntentKws.length} 个`)

  if (infoIntentKws.length > 0) {
    console.log(`\n   ⚠️ 将移除 ${infoIntentKws.length} 个信息查询类关键词:`)
    infoIntentKws.slice(0, 5).forEach(kw => {
      console.log(`      - "${kw.keyword}" (意图分数: ${kw.intentScore}, ${kw.intentLevel.label})`)
    })
    if (infoIntentKws.length > 5) {
      console.log(`      ... 及其他 ${infoIntentKws.length - 5} 个`)
    }
  }

  const primaryKeywords = keywordsWithIntent
    .filter(kw => isPureBrandInFinal(kw) || kw.intentScore >= MIN_INTENT_SCORE)
    .map(({ intentScore, intentLevel, ...rest }) => rest)

  const exploreQuota = getRatioCappedCount(
    primaryKeywords.length,
    KEYWORD_POLICY.creative.explore.maxRatio,
    KEYWORD_POLICY.creative.explore.maxCount
  )
  const primaryNormSet = new Set(
    primaryKeywords
      .map(kw => normalizeGoogleAdsKeyword(kw.keyword))
      .filter(Boolean)
  )
  const exploreKeywords = exploreIntentCandidates
    .filter(kw => {
      const norm = normalizeGoogleAdsKeyword(kw.keyword)
      return norm ? !primaryNormSet.has(norm) : false
    })
    .slice(0, exploreQuota)
    .map(({ intentScore, intentLevel, ...rest }) => rest)

  finalKeywords = [...primaryKeywords, ...exploreKeywords]

  const removedByIntent = beforeIntentFilter - primaryKeywords.length
  console.log(`   ✅ 意图过滤完成: 主池保留 ${primaryKeywords.length} 个，移除 ${removedByIntent} 个低意图词`)
  if (exploreKeywords.length > 0) {
    console.log(`   ➕ 覆盖度补齐: 追加 ${exploreKeywords.length}/${exploreQuota} 个探索词 (intent ${EXPLORE_MIN_INTENT_SCORE}-${EXPLORE_MAX_INTENT_SCORE - 1})`)
  }

  if (mustContainBrand) {
    const preview = brandTokensToMatch.slice(0, 3).join(', ')
    console.log(`\n🔒 强制约束: 只保留包含纯品牌词的关键词 (tokens: [${preview}${brandTokensToMatch.length > 3 ? '...' : ''}])`)
    const before = finalKeywords.length
    finalKeywords = finalKeywords.filter(kw => containsBrand(kw.keyword, kw.searchVolume))
    console.log(`   ✅ 品牌强制过滤完成: ${before} → ${finalKeywords.length}`)
  }

  console.log(`\n✅ 关键词收集完成，共 ${finalKeywords.length} 个关键词`)
  console.log(`\n📊 关键词排序规则: 100%品牌包含 + 搜索量优先`)
  finalKeywords.sort((a, b) => b.searchVolume - a.searchVolume)

  if (finalKeywords.length > 0) {
    console.log(`\n   🏷️ 品牌相关关键词 TOP 5:`)
    finalKeywords.slice(0, 5).forEach((kw, i) => {
      console.log(`      ${i + 1}. "${kw.keyword}" (${(kw.searchVolume || 0).toLocaleString()}/月)`)
    })
  }

  const afterFilterCount = finalKeywords.length
  const finalBrandCount = finalKeywords.filter(kw => containsBrand(kw.keyword, kw.searchVolume)).length
  const brandRatio = afterFilterCount > 0 ? Math.round(finalBrandCount / afterFilterCount * 100) : 0
  console.log(`\n✅ 过滤完成:`)
  console.log(`   原始关键词: ${beforeFilterCount} 个`)
  console.log(`   最终保留: ${afterFilterCount} 个`)
  console.log(`   - 品牌相关词: ${finalBrandCount} 个 (${brandRatio}%)`)
  console.log(`   - 通用词: ${afterFilterCount - finalBrandCount} 个 (${100 - brandRatio}%)`)

  // 单一出口前去重
  const beforeFinalDedupe = finalKeywords.length
  const seenForFinal = new Set<string>()
  finalKeywords = finalKeywords.filter(kw => {
    const normalized = kw.keyword.toLowerCase().trim()
    if (seenForFinal.has(normalized)) return false
    seenForFinal.add(normalized)
    return true
  })
  if (beforeFinalDedupe !== finalKeywords.length) {
    console.warn(`⚠️ 最终关键词去重: ${beforeFinalDedupe} → ${finalKeywords.length} (移除 ${beforeFinalDedupe - finalKeywords.length} 个重复)`)
  }

  const keywordTexts = finalKeywords.map(kw => kw.keyword)
  const finalKeywordCount = keywordTexts.length
  const allHaveVolume = finalKeywords.every(kw => kw.searchVolume > 0)
  const hasBrandKeyword = canonicalBrandKeyword
    ? finalKeywords.some(kw => normalizeGoogleAdsKeyword(kw.keyword) === canonicalBrandKeyword && kw.searchVolume > 0)
    : finalKeywords.some(kw => kw.keyword.toLowerCase() === brandKeywordLower && kw.searchVolume > 0)

  console.log(`\n🎯 最终验证:`)
  console.log(`   ✅ 关键词总数: ${finalKeywordCount} 个`)
  console.log(`   ${allHaveVolume ? '✅' : '❌'} 所有关键词都有搜索量数据 (searchVolume > 0)`)
  console.log(`   ${hasBrandKeyword ? '✅' : 'ℹ️'} 品牌词 "${offerBrand}" ${hasBrandKeyword ? '有搜索量' : '无搜索量数据，已排除'}`)

  if (!allHaveVolume) {
    const zeroVolumeKeywords = finalKeywords.filter(kw => kw.searchVolume <= 0)
    console.warn(`⚠️ 警告: 仍有 ${zeroVolumeKeywords.length} 个关键词搜索量为0`)
    zeroVolumeKeywords.forEach(kw => console.warn(`   - "${kw.keyword}"`))
  }
  if (finalKeywordCount < 5) {
    console.warn(`⚠️ 警告: 关键词数量 ${finalKeywordCount} < 5，可能影响广告效果`)
  }

  return {
    keywordsWithVolume: finalKeywords,
    keywords: keywordTexts,
  }
}

function truncateDkiDefaultText(defaultText: string, maxLength: number): string {
  let candidate = defaultText
  while (candidate.length > 0 && getGoogleAdsTextEffectiveLength(`{KeyWord:${candidate}}`) > maxLength) {
    candidate = candidate.slice(0, -1)
  }
  return candidate || 'Keyword'
}

export function buildDkiFirstHeadline(
  brandName: string,
  maxLength = 30,
  localeOptions?: DkiLocaleOptions
): string {
  const normalizedBrand = String(brandName || '')
    .replace(/[{}]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  if (!normalizedBrand) {
    return '{KeyWord:Keyword}'
  }

  const suffix = getLocalizedDkiOfficialSuffix(localeOptions)
  const headlineWithSuffix = `{KeyWord:${normalizedBrand}}${suffix}`

  // Google Ads DKI 规则：{KeyWord:DefaultText} token 本身不计入字符数，只计 DefaultText 的长度
  // token 之外的普通文本（如本地化后的 " Official/Oficial/官方"）会计入有效字符数。
  if (suffix && getGoogleAdsTextEffectiveLength(headlineWithSuffix) <= maxLength) {
    return headlineWithSuffix
  }

  const headlineWithoutSuffix = `{KeyWord:${normalizedBrand}}`
  if (getGoogleAdsTextEffectiveLength(headlineWithoutSuffix) <= maxLength) {
    return headlineWithoutSuffix
  }

  return `{KeyWord:${truncateDkiDefaultText(normalizedBrand, maxLength)}}`
}

export function buildDkiKeywordHeadline(defaultText: string, maxLength = 30): string {
  const normalized = String(defaultText || '')
    .replace(/[{}]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  if (!normalized) return `{KeyWord:Keyword}`

  if (normalized.length <= maxLength) {
    return `{KeyWord:${normalized}}`
  }

  return `{KeyWord:${normalized.substring(0, maxLength)}}`
}

/**
 * AI广告创意生成器
 * 优先使用Vertex AI，其次使用Gemini API
 */

/**
 * 获取语言指令 - 确保 AI 生成指定语言的内容
 */
export interface CreativeTargetLanguageResolution {
  languageCode: string
  languageName: string
  targetCountry: string
  usedCountryFallback: boolean
}

export function resolveCreativeTargetLanguage(
  targetLanguageInput: string | null | undefined,
  targetCountryInput: string | null | undefined
): CreativeTargetLanguageResolution {
  const normalizedCountry = normalizeCountryCode(String(targetCountryInput || '').trim() || 'US')
  const countryMappedLanguageName = getLanguageNameForCountry(normalizedCountry)
  const countryMappedLanguageCode = normalizeLanguageCode(countryMappedLanguageName)

  const rawTargetLanguage = String(targetLanguageInput || '').trim()
  const normalizedRawLanguage = rawTargetLanguage.toLowerCase()
  const hasRecognizedLanguageInput = Boolean(
    rawTargetLanguage
    && (
      LANGUAGE_CODE_MAP[normalizedRawLanguage]
      || /^[a-z]{2}(?:[-_][a-z]{2})?$/i.test(normalizedRawLanguage)
    )
  )

  const languageCode = hasRecognizedLanguageInput
    ? normalizeLanguageCode(rawTargetLanguage)
    : countryMappedLanguageCode

  const languageName = (() => {
    const resolved = getLanguageName(languageCode)
    if (resolved && resolved !== 'Unknown') return resolved
    return countryMappedLanguageName || 'English'
  })()

  return {
    languageCode,
    languageName,
    targetCountry: normalizedCountry,
    usedCountryFallback: !hasRecognizedLanguageInput,
  }
}

function getLanguageInstruction(
  targetLanguageInput: string | null | undefined,
  targetCountryInput: string | null | undefined
): string {
  const resolved = resolveCreativeTargetLanguage(targetLanguageInput, targetCountryInput)
  const fallbackNote = resolved.usedCountryFallback
    ? `- Target language missing/invalid, fallback by country ${resolved.targetCountry}: ${resolved.languageName} (${resolved.languageCode}).`
    : ''

  return `🔴 CRITICAL LANGUAGE REQUIREMENT
- Output language: ${resolved.languageName} ONLY (${resolved.languageCode})
- Headlines, descriptions, keywords, callouts and sitelinks must all be ${resolved.languageName}
- If any source product info/facts/phrases are in another language, translate them into ${resolved.languageName} first, then write the final ad copy
- Keep brand names, model numbers and fixed compliance acronyms unchanged
- Never output mixed-language copy or untranslated fragments
${fallbackNote}`.trim()
}

/**
 * 生成广告创意的Prompt（优化版 - 减少40%+ token消耗）
 * 🎯 需求34: 新增 extractedElements 参数，包含从爬虫阶段提取的关键词、标题、描述
 *
 * @version v2.8 (2025-12-04)
 * @changes P3优化 - badge徽章突出展示
 *   - Headlines Brand: badge优先级提升，明确指令使用完整badge文本
 *   - Callouts: badge改为P3 CRITICAL级别（与P2促销同级）
 * @previous v2.7 - P2 promotion促销强化
 *
 * @previous v2.6 - P1优化（availability紧迫感 + primeEligible验证）
 */
async function buildAdCreativePrompt(
  offer: any,
  theme?: string,
  referencePerformance?: any,
  excludeKeywords?: string[],
  extractedElements?: {
    keywords?: Array<{ keyword: string; searchVolume: number; source: string; priority: string }>
    headlines?: string[]
    descriptions?: string[]
    // 🎯 P0/P1/P2/P3优化：增强数据字段
    productInfo?: { features?: string[]; benefits?: string[]; useCases?: string[] }
    reviewAnalysis?: { sentiment?: string; themes?: string[]; insights?: string[] }
    localization?: { currency?: string; culturalNotes?: string[]; localKeywords?: string[] }
    brandAnalysis?: {
      positioning?: string
      voice?: string
      competitors?: string[]
      // 🔥 修复（2025-12-11）：添加店铺分析新字段
      hotProducts?: Array<{
        name: string
        productHighlights?: string[]
        successFactors?: string[]
      }>
      reviewAnalysis?: {
        overallSentiment?: string
        positives?: string[]
        concerns?: string[]
        customerUseCases?: string[]
        trustIndicators?: string[]
      }
      sellingPoints?: string[]
    }
    qualityScore?: number
    // 🆕 v4.10: 关键词池桶信息
    bucketInfo?: {
      bucket: string
      intent?: string
      intentEn?: string
      keywordCount: number
    }
  },
  runtimeGuidance?: PromptRuntimeGuidanceOptions
): Promise<{ prompt: string; promptKeywords: string[] }> {
  // 🎯 v3.0 REFACTOR: Load template from database (migration 056)
  const promptTemplate = await loadPrompt('ad_creative_generation')

  // Build variables map for simple substitution
  // Build variables map for basic product information
  const resolvedLanguage = resolveCreativeTargetLanguage(
    offer.target_language || null,
    offer.target_country || null
  )
  const targetLanguage = resolvedLanguage.languageName
  const languageInstruction = getLanguageInstruction(
    offer.target_language || null,
    offer.target_country || null
  )
  const policyGuardMode = resolveGoogleAdsPolicyGuardMode(runtimeGuidance?.policyGuardMode)
  const rawProductTitle = offer.product_title || offer.name || offer.title || 'Product'
  const rawProductName = offer.product_name || offer.product_title || offer.name || offer.brand
  const rawProductDescription = offer.brand_description || offer.unique_selling_points || 'Quality product'
  const rawUniqueSellingPoints = offer.unique_selling_points || offer.product_highlights || 'Premium quality'
  const policySafeProductTitle = sanitizeGoogleAdsPolicyText(String(rawProductTitle || ''), { maxLength: 120, mode: policyGuardMode })
  const policySafeProductName = sanitizeGoogleAdsPolicyText(String(rawProductName || ''), { maxLength: 120, mode: policyGuardMode })
  const policySafeProductDescription = sanitizeGoogleAdsPolicyText(String(rawProductDescription || ''), { maxLength: 240, mode: policyGuardMode })
  const policySafeUniqueSellingPoints = sanitizeGoogleAdsPolicyText(String(rawUniqueSellingPoints || ''), { maxLength: 240, mode: policyGuardMode })
  const policySignalTerms = extractGoogleAdsPolicySensitiveTerms([
    String(rawProductTitle || ''),
    String(rawProductName || ''),
    String(rawProductDescription || ''),
    String(rawUniqueSellingPoints || '')
  ], { mode: policyGuardMode })

  // 🆕 v4.16: 确定链接类型（含scraped_data兜底）
  const scrapedDataForLinkType = safeParseJson(offer.scraped_data, null)
  const derivedLinkType = deriveLinkTypeFromScrapedData(scrapedDataForLinkType)
  if (offer.page_type && derivedLinkType && offer.page_type !== derivedLinkType) {
    console.warn(`⚠️ page_type不一致: offer.page_type=${offer.page_type}, scraped_data.pageType=${derivedLinkType}。将使用 ${derivedLinkType} 作为链接类型。`)
  }
  const linkType = (() => {
    const explicit = offer.page_type as 'product' | 'store' | null
    if (explicit === 'store') return 'store'
    if (explicit === 'product') return derivedLinkType === 'store' ? 'store' : 'product'
    return derivedLinkType || 'product'
  })()

  const variables: Record<string, string> = {
    language_instruction: languageInstruction,
    brand: offer.brand,
    category: offer.category || 'product',
    product_title: policySafeProductTitle.text || String(rawProductTitle || 'Product'),
    product_name: policySafeProductName.text || String(rawProductName || offer.brand || 'Product'),
    product_description: policySafeProductDescription.text || String(rawProductDescription || 'Quality product'),
    unique_selling_points: policySafeUniqueSellingPoints.text || String(rawUniqueSellingPoints || 'Premium quality'),
    target_audience: offer.target_audience || 'General',
    target_country: offer.target_country,
    target_language: targetLanguage,
    target_language_code: resolvedLanguage.languageCode,
    // 🆕 KISS-3类型优化：Headline #2 主关键词（非品牌）
    primary_keyword: '',
    // 🆕 证据约束：仅允许使用此处可验证事实（避免“编造数字/承诺”）
    verified_facts_section: '',
    // 🆕 非破坏式意图增强：只指导文案，不改变关键词列表
    type_intent_guidance_section: ''
  }

  // Build conditional sections as complete strings
  let enhanced_features_section = ''
  let localization_section = ''
  let brand_analysis_section = ''
  // 🆕 v4.10: 关键词池桶section
  let keyword_bucket_section = ''
  let link_type_instructions = ''
  let store_creative_instructions = ''

  // 🆕 v4.16: 添加链接类型信息
  if (linkType === 'store') {
    link_type_instructions = `
**⚠️ 店铺链接关键词使用规则：**
- 品牌词使用比例可适当提高（80%+品牌词）
- 场景词和品类词用于描述使用场景
- 强调店铺信誉、官方授权、售后保障
- 避免过于具体的购买意图词汇`
    // 🆕 v4.16: 店铺创意特殊指令（KISS-3：A/B/D）
    store_creative_instructions = `
## 🏪 店铺链接创意特殊规则（KISS-3：A/B/D）

### A（品牌意图）
**目标**: 建立品牌权威，并把品牌与真实商品集合绑定
- 关键词侧重：品牌词 + 商品/品类锚点词
- 表达重点：品牌背书、代表商品、核心品类、热门商品线
- CTA：偏“进店/了解品牌商品”（如 "Explore Brand Products", "Shop Brand Direct"）

### B（热门商品型号/产品族意图）
**目标**: 承接已锁定热门商品型号/产品族的强购买意图
- 关键词侧重：品牌 + 热门商品型号/产品族 + 品类长尾词
- 表达重点：围绕热门商品型号、产品族和具体购买动作
- CTA：偏“查看型号/立即购买”（如 "Shop Exact Model", "Buy Now"）

### D（商品需求意图）
**目标**: 承接品牌下明确商品需求，但用户尚未锁定具体型号
- 关键词侧重：品牌 + 品类 + 功能/场景/产品线词
- 表达重点：商品卖点、功能、使用场景、产品线覆盖 + 明确CTA

⚠️ 兼容性说明：历史桶 \`C→B\`、\`S→D\`，不要在输出中使用/展示 \`C/S\`。`
  } else {
    link_type_instructions = `
**⚠️ 单品链接关键词使用规则：**
- 品牌词和非品牌词均衡使用（约50%/50%）
- 根据创意类型选择对应桶的关键词
- 强调产品特性和购买优势
- 明确CTA引导购买行为`
  }

  // 🆕 v4.10: 添加关键词池桶指令
  if (extractedElements?.bucketInfo) {
    const { bucket, intent, intentEn, keywordCount } = extractedElements.bucketInfo
    // 🆕 KISS-3: 归一化创意类型（兼容历史 C/S）
    const kissBucket = bucket === 'C' ? 'B' : bucket === 'S' ? 'D' : bucket

    // 🆕 v4.16: 店铺链接特殊桶处理
    if (linkType === 'store') {
      const storeBucketInstructions: Record<string, string> = {
        'A': `
**🏪 店铺桶A - 品牌意图导向**
- 核心主题: 品牌背书 + 真实商品集合
- 关键词策略: 品牌词优先，但必须同时覆盖商品/品类锚点
- 创意重点: 强调品牌优势、核心品类、热门商品线`,
        'B': `
**🏪 店铺桶B - 热门商品型号/产品族意图导向**
- 核心主题: 热门商品型号/产品族购买意图
- 关键词策略: 品牌 + 热门商品型号/产品族 + 品类，统一完全匹配
- 创意重点: 默认覆盖多个热门商品，不得退化为泛店铺文案`,
        'D': `
**🏪 店铺桶D - 商品需求意图导向**
- 核心主题: 品牌下商品需求、功能、场景和产品线覆盖
- 关键词策略: 品牌 + 品类 + 功能/场景/热门商品线词
- 创意重点: 商品需求覆盖优先，不得退化为纯品牌导航词`
      }
      keyword_bucket_section = storeBucketInstructions[kissBucket] || `
**📦 STORE KEYWORD POOL BUCKET ${kissBucket} - ${intent || intentEn}**
This store creative focuses on "${intent || intentEn}" user intent.
- ${keywordCount} pre-selected keywords for this intent
- Keywords optimized for store-level marketing`
    }
    // 兼容旧 S 桶：仅保留提示说明，运行时语义统一按 D / product_intent 处理
    else if (bucket === 'S') {
      keyword_bucket_section = `
**🧭 LEGACY BUCKET S（已废弃）**
历史 S 桶不是独立创意类型，在 KISS-3 中统一映射为桶 D（商品需求意图）。
- 仅在品牌与商品需求锚点明确时才可使用
- 文案重点：品牌相关商品需求 + 明确CTA + 可信背书
`
    } else {
      // 🆕 v4.18: 为每个产品链接桶添加单品聚焦约束
      const productBucketInstructions: Record<string, string> = {
        'A': `
**📦 产品桶A - 品牌意图导向 (Brand Intent)**
**🎯 核心主题**: 建立品牌可信度 + 强化“品牌与当前商品强相关”
**⚠️ 单品聚焦规则 (CRITICAL)**:
- ✅ 必须提到具体产品名称/型号: {{product_name}}
- ✅ 可强调品牌优势、代表商品、品牌背书（仅限可验证事实）
- ✅ 所有创意元素必须聚焦于这一个产品
- ❌ 禁止: "Shop All Products", "Browse Collection", "Cameras & Doorbells"
- ❌ 禁止: 提及同品牌其他品类产品
- 创意重点: 品牌优先，但必须回到当前商品`,
        'B': `
**📦 产品桶B - 商品型号/产品族意图导向 (Model Intent)**
**🎯 核心主题**: 当前商品型号/产品族购买意图
**⚠️ 单品聚焦规则 (CRITICAL)**:
- ✅ 广告语和关键词必须围绕这一个产品的型号/产品族
- ✅ 关键词必须覆盖品牌 + 型号/产品族 + 品类的长尾词
- ✅ 最终关键词统一完全匹配
- ❌ 禁止: 退化成泛品类词、场景词或纯品牌词
- ❌ 禁止: 暗示多产品选择或店铺级文案
- 创意重点: 精准、可投放、强购买意图`,
        'D': `
**📦 产品桶D - 商品需求意图导向 (Product Demand Intent)**
**🎯 核心主题**: 品牌下商品需求、功能、场景和产品线覆盖
**⚠️ 单品聚焦规则 (CRITICAL)**:
- ✅ 广告语优先体现商品卖点、功能、场景、产品线
- ✅ 必须同时和品牌与当前商品有关
- ✅ 明确CTA: "Buy Now", "Shop Now", "Learn More"
- ❌ 禁止: 只有品牌没有商品需求锚点
- ❌ 禁止: 变成店铺级文案或纯促销口号
- 创意重点: 需求覆盖清晰 + 行动明确`
      }
      keyword_bucket_section = productBucketInstructions[kissBucket] || `
**📦 KEYWORD POOL BUCKET ${kissBucket} - ${intent || intentEn}**
**⚠️ 单品聚焦规则 (CRITICAL)**:
- This creative MUST focus on ONE specific product: {{product_name}}
- ALL headlines and descriptions must reference this specific product
- Do NOT use generic brand/store descriptions
- Do NOT mention other products or product categories

This creative focuses on "${intent || intentEn}" user intent.
- You have ${keywordCount} pre-selected keywords optimized for this intent
- Use these intent keyword hints as guidance, but do not treat them as a bucket-only hard constraint
- Ensure headlines and descriptions align with the "${intent || intentEn}" messaging strategy
- Do NOT mix intents - stay focused on this single theme
- Stay focused on ONE product - do not generalize to product categories`
    }
  }

  // 🎯 P0优化：使用增强产品信息
  if (extractedElements?.productInfo) {
    const { features, benefits, useCases } = extractedElements.productInfo
    if (features && features.length > 0) {
      enhanced_features_section += `\n**✨ ENHANCED FEATURES**: ${features.slice(0, 5).join(', ')}`
    }
    if (benefits && benefits.length > 0) {
      enhanced_features_section += `\n**✨ KEY BENEFITS**: ${benefits.slice(0, 3).join(', ')}`
    }
    if (useCases && useCases.length > 0) {
      enhanced_features_section += `\n**✨ USE CASES**: ${useCases.slice(0, 3).join(', ')}`
    }
  }

  // 🎯 P2优化：使用本地化适配数据
  if (extractedElements?.localization) {
    const { currency, culturalNotes, localKeywords } = extractedElements.localization
    if (currency) {
      // 🔥 修复（2025-12-23）：明确指定货币符号，确保AI生成正确格式
      const currencySymbolMap: Record<string, string> = {
        'GBP': '£ (British Pound Sterling - UK market)',
        'USD': '$ (US Dollar)',
        'EUR': '€ (Euro)',
        'JPY': '¥ (Japanese Yen)',
        'AUD': 'A$ (Australian Dollar)',
        'CAD': 'C$ (Canadian Dollar)',
        'CHF': 'CHF (Swiss Franc)',
      }
      const currencySymbol = currencySymbolMap[currency] || currency
      localization_section += `\n**🌍 LOCAL CURRENCY**: ${currencySymbol}`
      // 🔥 重要：添加明确指令，要求所有价格使用正确符号
      localization_section += `\n**🔴 CRITICAL**: ALL prices in headlines and descriptions MUST use the correct currency symbol (${currencySymbol}).`
      localization_section += `\nExamples for ${currency}: "Save £170", "Only £499", "£XXX off" - NEVER use "$" or "€" for UK market.`
    }
    if (culturalNotes && culturalNotes.length > 0) {
      localization_section += `\n**🌍 CULTURAL NOTES**: ${culturalNotes.join('; ')}`
    }
    if (localKeywords && localKeywords.length > 0) {
      localization_section += `\n**🌍 LOCAL KEYWORDS**: ${localKeywords.slice(0, 5).join(', ')}`
    }
  }

  // 🎯 P3优化：使用品牌分析数据
  if (extractedElements?.brandAnalysis) {
    const { positioning, voice, competitors, hotProducts, reviewAnalysis: storeReviewAnalysis, sellingPoints } = extractedElements.brandAnalysis
    if (positioning) {
      brand_analysis_section += `\n**🏷️ BRAND POSITIONING**: ${positioning}`
    }
    if (voice) {
      brand_analysis_section += `\n**🏷️ BRAND VOICE**: ${voice}`
    }
    if (competitors && competitors.length > 0) {
      brand_analysis_section += `\n**🏷️ KEY COMPETITORS**: ${competitors.slice(0, 3).join(', ')}`
    }
    // 🔥 修复（2025-12-11）：添加店铺卖点
    if (sellingPoints && sellingPoints.length > 0) {
      brand_analysis_section += `\n**🏷️ BRAND SELLING POINTS**: ${sellingPoints.slice(0, 5).join(', ')}`
    }
    // 🔥 修复（2025-12-11）：添加热销商品产品亮点
    if (hotProducts && hotProducts.length > 0) {
      const allHighlights: string[] = []
      hotProducts.slice(0, 3).forEach(p => {
        if (p.productHighlights && p.productHighlights.length > 0) {
          allHighlights.push(...p.productHighlights.slice(0, 3))
        }
      })
      if (allHighlights.length > 0) {
        brand_analysis_section += `\n**🔥 HOT PRODUCT HIGHLIGHTS**: ${[...new Set(allHighlights)].slice(0, 8).join(', ')}`
      }
    }
    // 🔥 修复（2025-12-11）：添加店铺评论分析
    if (storeReviewAnalysis) {
      if (storeReviewAnalysis.overallSentiment) {
        brand_analysis_section += `\n**📊 STORE SENTIMENT**: ${storeReviewAnalysis.overallSentiment}`
      }
      if (storeReviewAnalysis.positives && storeReviewAnalysis.positives.length > 0) {
        brand_analysis_section += `\n**👍 CUSTOMER PRAISES**: ${storeReviewAnalysis.positives.slice(0, 4).join(', ')}`
      }
      if (storeReviewAnalysis.concerns && storeReviewAnalysis.concerns.length > 0) {
        brand_analysis_section += `\n**⚠️ CUSTOMER CONCERNS**: ${storeReviewAnalysis.concerns.slice(0, 3).join(', ')}`
      }
      if (storeReviewAnalysis.customerUseCases && storeReviewAnalysis.customerUseCases.length > 0) {
        brand_analysis_section += `\n**🎯 REAL USE CASES**: ${storeReviewAnalysis.customerUseCases.slice(0, 4).join(', ')}`
      }
      if (storeReviewAnalysis.trustIndicators && storeReviewAnalysis.trustIndicators.length > 0) {
        brand_analysis_section += `\n**✅ TRUST INDICATORS**: ${storeReviewAnalysis.trustIndicators.slice(0, 4).join(', ')}`
      }
    }
  }

  // 🔥 P0优化：增强数据 - 添加真实折扣、促销、排名、徽章等爬虫抓取的数据
  const extras: string[] = []
  const supplementalVerifiedFacts: string[] = []
  const supplementalHookLines: string[] = []

  const formatSupplementalName = (name: string) => {
    if (!name) return ''
    const cleaned = name
      .split(' - ')[0]
      .split(' – ')[0]
      .split(' — ')[0]
      .split(':')[0]
      .trim()
      .replace(/\s+/g, ' ')
    return cleaned.length > 48 ? `${cleaned.slice(0, 45).trim()}...` : cleaned
  }

  const formatSupplementalFeature = (feature: string) => {
    if (!feature) return ''
    const cleaned = feature.replace(/\s+/g, ' ').trim()
    return cleaned.length > 90 ? `${cleaned.slice(0, 87).trim()}...` : cleaned
  }

  // 价格证据策略：
  // 1) 优先使用 offer.product_price / offer.pricing.current（权威来源）
  // 2) scraped_data.productPrice 仅作为兜底
  // 3) 若权威价与抓取价偏差 >20%，触发熔断：禁止在创意中使用具体价格
  const resolvedPriceEvidence = resolveCreativePriceEvidence(offer)
  let currentPrice = resolvedPriceEvidence.currentPrice
  let originalPrice = resolvedPriceEvidence.originalPrice
  let discount = resolvedPriceEvidence.discount
  const priceEvidenceBlocked = resolvedPriceEvidence.priceEvidenceBlocked
  const priceEvidenceWarning = resolvedPriceEvidence.priceEvidenceWarning
  const priceSource = resolvedPriceEvidence.priceSource

  if (priceEvidenceWarning) {
    console.warn(priceEvidenceWarning)
    localization_section += '\n**⚠️ PRICE SAFETY RULE**: Conflicting price signals were detected. Do NOT mention any exact price amount in headlines or descriptions.'
  } else if (currentPrice) {
    console.log(`[PriceEvidence] Offer ${offer.id}: using price source=${priceSource}, value=${currentPrice}`)
  }

  if (currentPrice) {
    extras.push(`PRICE: ${currentPrice}`)
  }
  if (originalPrice && discount) {
    extras.push(`ORIGINAL: ${originalPrice} | DISCOUNT: ${discount}`)
  }

  // 🔥 促销信息（优化版 - 完整提取active数组）
  interface PromotionItem {
    description: string
    code?: string | null
    validUntil?: string | null
    conditions?: string | null
  }
  let activePromotions: PromotionItem[] = []

  if (offer.promotions) {
    try {
      const promos = JSON.parse(offer.promotions)
      if (promos.active && Array.isArray(promos.active) && promos.active.length > 0) {
        activePromotions = promos.active
      }
    } catch (error) {
      console.warn('Failed to parse promotions:', error)
    }
  }

  // 在extras中展示主促销
  if (activePromotions.length > 0) {
    const mainPromo = activePromotions[0]
    let promoText = `PROMO: ${mainPromo.description}`
    if (mainPromo.code) {
      promoText += ` | CODE: ${mainPromo.code}`
    }
    if (mainPromo.validUntil) {
      promoText += ` | VALID UNTIL: ${mainPromo.validUntil}`
    }
    if (mainPromo.conditions) {
      promoText += ` | ${mainPromo.conditions}`
    }
    extras.push(promoText)

    // 次要促销
    if (activePromotions.length > 1) {
      const secondaryPromo = activePromotions[1]
      extras.push(`EXTRA PROMO: ${secondaryPromo.description}`)
    }
  }

  // 🔥 P0-2: 销售排名和徽章（社会证明）
  let salesRank: string | null = null
  let badge = null
  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)
      salesRank = scrapedData.salesRank
      badge = scrapedData.badge
    } catch {}
  }
  const salesRankSignal = resolveCreativeSalesRankSignal(salesRank)
  const salesRankForPrompt = salesRankSignal.eligibleForPrompt
    ? salesRankSignal.raw
    : null
  const featuredSalesRank = salesRankSignal.strongSignal
    ? salesRankSignal.raw
    : null

  if (salesRankSignal.eligibleForPrompt && salesRankSignal.normalizedRankText) {
    extras.push(`SALES RANK: ${salesRankSignal.normalizedRankText}`)
  } else if (salesRank) {
    console.log(
      `[SalesRankGuard] Offer ${offer.id}: skip salesRank "${salesRank}" (rank=${salesRankSignal.rankNumber ?? 'N/A'} > ${SALES_RANK_PROMPT_MAX} or unparsable)`
    )
  }
  if (badge) {
    extras.push(`BADGE: ${badge}`)
  }

  // 🔥 P0-3: Prime资格和库存状态
  let primeEligible = false
  let availability = null
  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)
      primeEligible = scrapedData.primeEligible || scrapedData.isPrime || false
      availability = scrapedData.availability
    } catch {}
  }
  if (primeEligible) {
    extras.push(`PRIME: Yes`)
  }
  if (availability) {
    extras.push(`STOCK: ${availability}`)
  }

  // 🔥 P1-1: 用户评论洞察（基础）
  let reviewHighlights: string[] = []
  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)
      reviewHighlights = scrapedData.reviewHighlights || []
    } catch {}
  }
  if (reviewHighlights.length > 0) {
    extras.push(`REVIEW INSIGHTS: ${reviewHighlights.slice(0, 5).join(', ')}`)
  }

  // 🎯 P0优化: topReviews热门评论（真实用户引用）
  let topReviews: string[] = []
  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)
      const rawTopReviews: unknown[] = Array.isArray(scrapedData.topReviews) ? scrapedData.topReviews : []
      topReviews = rawTopReviews
        .map((review: unknown) => sanitizeReviewSnippetForPrompt(review))
        .filter((review): review is string => !!review)
      const droppedTopReviews = rawTopReviews.length - topReviews.length
      if (droppedTopReviews > 0) {
        console.log(`[ReviewQuoteGuard] Offer ${offer.id}: dropped ${droppedTopReviews} low-trust top reviews`)
      }
    } catch {}
  }
  if (topReviews.length > 0) {
    // 只使用前2条最优质评论（避免prompt过长）
    extras.push(`TOP REVIEWS (Use for credibility): ${topReviews.slice(0, 2).join(' | ')}`)

    // 🔥 v4.1优化：提取用户语言模式（常用表达词汇）
    // 从评论中提取2-4词的短语作为自然语言参考
    const userPhrases: string[] = []
    topReviews.slice(0, 5).forEach(review => {
      // 匹配常见的用户表达模式
      const patterns = [
        /very ([\w\s]+)/gi,           // "very easy to use"
        /really ([\w\s]+)/gi,         // "really quiet"
        /so ([\w]+)/gi,               // "so powerful"
        /love the ([\w\s]+)/gi,       // "love the design"
        /great ([\w\s]+)/gi,          // "great battery life"
        /perfect for ([\w\s]+)/gi,    // "perfect for pets"
        /works ([\w\s]+)/gi,          // "works perfectly"
        /easy to ([\w]+)/gi,          // "easy to clean"
      ]
      patterns.forEach(pattern => {
        const matches = review.match(pattern)
        if (matches) {
          matches.slice(0, 2).forEach(m => {
            const cleaned = m.toLowerCase().trim()
            if (cleaned.length > 5 && cleaned.length < 30 && !REVIEW_QUOTE_BLOCKLIST_PATTERN.test(cleaned)) {
              userPhrases.push(cleaned)
            }
          })
        }
      })
    })
    const uniquePhrases = [...new Set(userPhrases)].slice(0, 6)
    if (uniquePhrases.length > 0) {
      extras.push(`USER LANGUAGE PATTERNS: ${uniquePhrases.join(', ')}`)
    }
  }

  // 🔥 P1-1+: 用户评论深度分析（增强版 - 充分利用所有评论分析字段）
  let commonPraises: string[] = []
  let purchaseReasons: string[] = []
  let useCases: string[] = []
  let commonPainPoints: string[] = []
  // 🆕 新增字段
  let topPositiveKeywords: Array<{keyword: string; frequency: number; context?: string}> = []
  let userProfiles: Array<{profile: string; indicators?: string[]}> = []
  let sentimentDistribution: {positive: number; neutral: number; negative: number} | null = null
  let totalReviews: number = 0
  let averageRating: number = 0
  // 🔥 v3.2新增：量化数据亮点
  let quantitativeHighlights: Array<{metric: string; value: string; adCopy: string}> = []
  let competitorMentions: Array<{brand: string; comparison: string; sentiment: string}> = []

  // 🎯 合并基础和增强评论分析数据
  if (offer.review_analysis) {
    try {
      const reviewAnalysis = JSON.parse(offer.review_analysis)
      // 原有字段
      commonPraises = reviewAnalysis.commonPraises || []
      purchaseReasons = (reviewAnalysis.purchaseReasons || []).map((r: any) =>
        typeof r === 'string' ? r : r.reason || r
      )
      useCases = (reviewAnalysis.realUseCases || reviewAnalysis.useCases || []).map((u: any) =>
        typeof u === 'string' ? u : u.scenario || u
      )
      commonPainPoints = (reviewAnalysis.commonPainPoints || []).map((p: any) =>
        typeof p === 'string' ? p : p.issue || p
      )
      // 🆕 新增字段提取
      topPositiveKeywords = reviewAnalysis.topPositiveKeywords || []
      userProfiles = reviewAnalysis.userProfiles || []
      sentimentDistribution = reviewAnalysis.sentimentDistribution || null
      totalReviews = reviewAnalysis.totalReviews || 0
      averageRating = reviewAnalysis.averageRating || 0
      // 🔥 v3.2新增字段
      quantitativeHighlights = reviewAnalysis.quantitativeHighlights || []
      competitorMentions = reviewAnalysis.competitorMentions || []
    } catch {}
  }

  // 🎯 P1优化：合并增强评论分析数据（如果有）
  if (extractedElements?.reviewAnalysis) {
    const enhanced = extractedElements.reviewAnalysis
    if (enhanced.themes && enhanced.themes.length > 0) {
      // themes 作为额外的洞察合并到 commonPraises
      commonPraises = [...new Set([...commonPraises, ...enhanced.themes])]
    }
    if (enhanced.insights && enhanced.insights.length > 0) {
      // insights 作为额外的购买理由
      purchaseReasons = [...new Set([...purchaseReasons, ...enhanced.insights])]
    }
    // sentiment 可以补充 sentimentDistribution
    if (enhanced.sentiment && !sentimentDistribution) {
      // 简单映射：positive/negative/neutral
      const sentimentMap: any = {
        positive: { positive: 70, neutral: 20, negative: 10 },
        negative: { positive: 10, neutral: 20, negative: 70 },
        neutral: { positive: 30, neutral: 50, negative: 20 }
      }
      sentimentDistribution = sentimentMap[enhanced.sentiment.toLowerCase()] || null
    }
  }

  // 将深度评论分析数据添加到Prompt
  if (commonPraises.length > 0) {
    extras.push(`USER PRAISES: ${commonPraises.slice(0, 3).join(', ')}`)
  }
  if (purchaseReasons.length > 0) {
    extras.push(`WHY BUY: ${purchaseReasons.slice(0, 3).join(', ')}`)
  }
  if (useCases.length > 0) {
    extras.push(`USE CASES: ${useCases.slice(0, 3).join(', ')}`)
  }
  if (commonPainPoints.length > 0) {
    extras.push(`AVOID: ${commonPainPoints.slice(0, 2).join(', ')}`)
  }

  // 🆕 新增：正面关键词作为关键词参考（高频用户好评词）
  if (topPositiveKeywords.length > 0) {
    const positiveKWs = topPositiveKeywords
      .slice(0, 5)
      .map(k => `"${k.keyword}"(${k.frequency}x)`)
      .join(', ')
    extras.push(`POSITIVE KEYWORDS: ${positiveKWs}`)
  }

  // 🆕 新增：情感分布作为社会证明（高好评率）
  if (sentimentDistribution && totalReviews > 0) {
    const positiveRate = sentimentDistribution.positive
    if (positiveRate >= 80) {
      extras.push(`SOCIAL PROOF: Strong positive review sentiment from ${totalReviews} customers${averageRating ? `, ${averageRating} stars` : ''}`)
    } else if (positiveRate >= 60) {
      extras.push(`REVIEWS: ${totalReviews} customer reviews${averageRating ? `, ${averageRating} avg rating` : ''}`)
    }
  }

  // 🆕 新增：用户画像用于受众定制
  if (userProfiles.length > 0) {
    const profiles = userProfiles.slice(0, 3).map(p => p.profile).join(', ')
    extras.push(`TARGET PERSONAS: ${profiles}`)
  }

  // 🔥 v3.2新增：量化数据亮点（评论中的具体数字 - 最有说服力的广告素材）
  // 例如："8小时续航"、"2000Pa吸力"、"覆盖2000平方英尺"
  if (quantitativeHighlights.length > 0) {
    const topHighlights = quantitativeHighlights
      .slice(0, 5)
      .map(q => q.adCopy)
      .join(' | ')
    extras.push(`PROVEN CLAIMS: ${topHighlights}`)
  }

  // 🔥 v3.2新增：竞品对比优势（用户自发的竞品比较）
  if (competitorMentions.length > 0) {
    // 只提取正面对比（用户认为我们比竞品更好的地方）
    const positiveComparisons = competitorMentions
      .filter(c => c.sentiment === 'positive')
      .slice(0, 3)
      .map(c => `vs ${c.brand}: ${c.comparison}`)
      .join(' | ')
    if (positiveComparisons) {
      extras.push(`COMPETITIVE EDGE: ${positiveComparisons}`)
    }
  }

  // 🔥 P1-2: 技术规格（关键参数）
  let technicalDetails: Record<string, string> = {}
  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)
      technicalDetails = scrapedData.technicalDetails || {}
    } catch {}
  }
  if (Object.keys(technicalDetails).length > 0) {
    // 提取前3个最重要的技术参数
    const topSpecs = Object.entries(technicalDetails)
      .slice(0, 3)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ')
    extras.push(`SPECS: ${topSpecs}`)
  }

  // 🔥 2025-12-10优化：提取features和aboutThisItem（产品核心卖点）
  let productFeatures: string[] = []
  let aboutThisItem: string[] = []
  let scrapedProductTitle = ''
  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)
      productFeatures = scrapedData.features || []
      aboutThisItem = scrapedData.aboutThisItem || []
      scrapedProductTitle = typeof scrapedData.productName === 'string'
        ? scrapedData.productName
        : (typeof scrapedData.title === 'string' ? scrapedData.title : '')
    } catch {}
  }
  if (!scrapedProductTitle) {
    scrapedProductTitle = String(offer.product_name || offer.product_title || offer.name || '').trim()
  }
  // 优先使用aboutThisItem（更详细），其次使用features
  const featureSource = aboutThisItem.length > 0 ? aboutThisItem : productFeatures
  const titleAndAboutSignals = extractTitleAndAboutSignals(
    scrapedProductTitle,
    featureSource,
    {
      targetLanguage: resolvedLanguage.languageCode,
      brandName: offer.brand,
    }
  )

  if (titleAndAboutSignals.productTitle) {
    extras.push(`AMAZON TITLE: ${truncateSnippetByWords(titleAndAboutSignals.productTitle, 180)}`)
  }
  if (titleAndAboutSignals.titlePhrases.length > 0) {
    extras.push(`TITLE CORE PHRASES: ${titleAndAboutSignals.titlePhrases.slice(0, 5).join(' | ')}`)
  }
  if (featureSource.length > 0) {
    // 提取前5个最重要的产品特点（限制每条100字符避免过长）
    const topFeatures = featureSource
      .slice(0, 5)
      .map((f: string) => f.length > 100 ? f.substring(0, 100) + '...' : f)
      .join(' | ')
    extras.push(`PRODUCT FEATURES: ${topFeatures}`)
  }
  if (titleAndAboutSignals.aboutClaims.length > 0) {
    extras.push(`ABOUT CORE CLAIMS: ${titleAndAboutSignals.aboutClaims.slice(0, 5).join(' | ')}`)
  }

  // 🔥 P1-3: Store热销数据（新增优化 - 用于Amazon Store或独立站店铺页）
  let hotInsights: { avgRating: number; avgReviews: number; topProductsCount: number } | null = null
  let topProducts: string[] = []
  // 🔥 2025-12-10优化：提取销售热度数据
  let storeSalesVolumes: string[] = []
  let storeDiscounts: string[] = []
  let supplementalProducts: any[] = []
  let storePriceRange: string | null = null
  let storePriceSamples: Array<{ name: string; price: string }> = []
  let storeDescriptionClaims: string[] = []

  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)
      const storeDescription = typeof scrapedData.storeDescription === 'string' ? scrapedData.storeDescription : ''
      if (storeDescription) {
        const descLower = storeDescription.toLowerCase()
        if (/free\\s+uk\\s+(delivery|shipping)/i.test(descLower)) {
          storeDescriptionClaims.push('Free UK delivery')
        } else if (/free\\s+(delivery|shipping)/i.test(descLower)) {
          storeDescriptionClaims.push('Free delivery')
        }
      }
      hotInsights = scrapedData.hotInsights || null
      supplementalProducts = Array.isArray(scrapedData.supplementalProducts)
        ? scrapedData.supplementalProducts
        : []
      // 提取热销产品名称（如果有products数组）
      if (scrapedData.products && Array.isArray(scrapedData.products)) {
        topProducts = scrapedData.products
          .slice(0, 5)
          .map((p: any) => p.name || p.productName)
          .filter(Boolean)

        const priceSamples = scrapedData.products
          .filter((p: any) => p && p.price && (p.name || p.productName))
          .slice(0, 3)
          .map((p: any) => ({
            name: p.name || p.productName,
            price: p.price
          }))
        storePriceSamples = priceSamples

        // 🔥 2025-12-10优化：提取销量数据（"1K+ bought in past month"等）
        storeSalesVolumes = scrapedData.products
          .filter((p: any) => p.salesVolume)
          .slice(0, 3)
          .map((p: any) => `${(p.name || '').substring(0, 20)}... (${p.salesVolume})`)

        // 🔥 2025-12-10优化：提取折扣数据（"-20%"等）
        storeDiscounts = scrapedData.products
          .filter((p: any) => p.discount)
          .slice(0, 3)
          .map((p: any) => p.discount)
        storeDiscounts = [...new Set(storeDiscounts)] // 去重

        const storePriceValues = scrapedData.products
          .map((p: any) => parsePrice(p?.price))
          .filter((v: any) => typeof v === 'number' && !Number.isNaN(v)) as number[]
        if (storePriceValues.length > 0) {
          const minPrice = Math.min(...storePriceValues)
          const maxPrice = Math.max(...storePriceValues)
          if (minPrice > 0 && maxPrice > 0) {
            storePriceRange = minPrice === maxPrice
              ? `${minPrice.toFixed(2)}`
              : `${minPrice.toFixed(2)}-${maxPrice.toFixed(2)}`
          }
        }
      }

      if (supplementalProducts.length > 0) {
        const supplementalItems = supplementalProducts
          .filter((p: any) => !p?.error)
          .map((p: any) => ({
            name: p.productName || p.name,
            price: p.productPrice || p.price,
            rating: p.rating,
            reviewCount: p.reviewCount,
            features: Array.isArray(p.productFeatures) ? p.productFeatures : [],
          }))
          .filter((p: any) => Boolean(p.name))

        const supplementalNames = supplementalItems
          .map((p: any) => formatSupplementalName(p.name))
          .filter(Boolean)

        if (supplementalNames.length > 0) {
          topProducts = [...topProducts, ...supplementalNames].slice(0, 5)
        }

        const supplementalFeatured = Array.from(new Set(supplementalNames)).slice(0, 3)
        if (supplementalFeatured.length > 0) {
          extras.push(`SUPPLEMENTAL PICKS: ${supplementalFeatured.join(', ')}`)
        }

        const supplementalHooks = supplementalItems.slice(0, 3).map((item: any) => {
          const name = formatSupplementalName(item.name)
          const featureBits = (item.features || [])
            .map((f: string) => formatSupplementalFeature(f))
            .filter(Boolean)
            .slice(0, 2)
          const valueBits: string[] = []
          if (item.rating) valueBits.push(`${item.rating}★`)
          if (item.reviewCount) valueBits.push(`${item.reviewCount} reviews`)
          if (item.price) valueBits.push(item.price)
          if (featureBits.length > 0) {
            return `${name}: ${featureBits.join(' | ')}`
          }
          if (valueBits.length > 0) {
            return `${name}: ${valueBits.join(', ')}`
          }
          return name
        })
        if (supplementalHooks.length > 0) {
          supplementalHookLines.push(...supplementalHooks)
          extras.push(`SUPPLEMENTAL HOOKS: ${supplementalHooks.join(' || ')}`)
        }

        // 收集可验证事实（仅单品链接来源）
        supplementalItems.slice(0, 3).forEach((item: any) => {
          const name = formatSupplementalName(item.name)
          if (item.price) supplementalVerifiedFacts.push(`- SUPPLEMENTAL ${name} PRICE: ${item.price}`)
          if (item.rating) supplementalVerifiedFacts.push(`- SUPPLEMENTAL ${name} RATING: ${item.rating}`)
          if (item.reviewCount) supplementalVerifiedFacts.push(`- SUPPLEMENTAL ${name} REVIEW COUNT: ${item.reviewCount}`)
        })

        const supplementalPriceValues = supplementalItems
          .map((p: any) => parsePrice(p?.price))
          .filter((v: any) => typeof v === 'number' && !Number.isNaN(v)) as number[]
        const storePriceValues = Array.isArray(scrapedData.products)
          ? scrapedData.products.map((p: any) => parsePrice(p?.price)).filter((v: any) => typeof v === 'number' && !Number.isNaN(v)) as number[]
          : []
        const allPriceValues = [...supplementalPriceValues, ...storePriceValues]
        if (allPriceValues.length > 0) {
          const minPrice = Math.min(...allPriceValues)
          const maxPrice = Math.max(...allPriceValues)
          if (minPrice > 0 && maxPrice > 0) {
            storePriceRange = minPrice === maxPrice
              ? `${minPrice.toFixed(2)}`
              : `${minPrice.toFixed(2)}-${maxPrice.toFixed(2)}`
          }
        }
      }
    } catch {}
  }

  if (storePriceRange) {
    extras.push(`STORE PRICE RANGE: ${storePriceRange}`)
  }
  // 如果是Store页面，添加热销洞察到Prompt
  if (hotInsights && topProducts.length > 0) {
    extras.push(`STORE HOT PRODUCTS: ${topProducts.slice(0, 3).join(', ')} (Avg: ${hotInsights.avgRating.toFixed(1)} stars, ${hotInsights.avgReviews} reviews)`)
  }

  // 🔥 2025-12-10优化：添加销售热度数据到Prompt（强社会证明信号）
  if (storeSalesVolumes.length > 0) {
    extras.push(`🔥 SALES MOMENTUM: ${storeSalesVolumes.join(' | ')}`)
  }

  // 🔥 2025-12-10优化：添加折扣数据到Prompt（促销信号）
  if (storeDiscounts.length > 0) {
    extras.push(`ACTIVE DISCOUNTS: ${storeDiscounts.join(', ')}`)
  }

  // 🔥 v4.1优化（2025-12-09）：提取店铺深度抓取数据
  let storeAggregatedReviews: string[] = []
  let storeAggregatedFeatures: string[] = []
  let storeHotBadges: string[] = []
  let storeCategoryKeywords: string[] = []

  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)

      // 1. 提取深度抓取的聚合数据
      if (scrapedData.deepScrapeResults) {
        const dsr = scrapedData.deepScrapeResults
        storeAggregatedReviews = dsr.aggregatedReviews || []
        storeAggregatedFeatures = dsr.aggregatedFeatures || []

        // 从热销商品提取徽章
        if (dsr.topProducts && Array.isArray(dsr.topProducts)) {
          dsr.topProducts.forEach((tp: any) => {
            if (tp.productData?.badge) {
              storeHotBadges.push(tp.productData.badge)
            }
          })
          storeHotBadges = [...new Set(storeHotBadges)] // 去重
        }
      }

      // 2. 提取产品分类作为关键词来源
      if (scrapedData.productCategories?.primaryCategories) {
        storeCategoryKeywords = scrapedData.productCategories.primaryCategories
          .slice(0, 5)
          .map((c: any) => c.name)
          .filter(Boolean)
      }

      // 3. 从热销商品提取徽章（备选路径）
      if (storeHotBadges.length === 0 && scrapedData.products) {
        scrapedData.products.forEach((p: any) => {
          if (p.badge) storeHotBadges.push(p.badge)
        })
        storeHotBadges = [...new Set(storeHotBadges)].slice(0, 3)
      }

      if (supplementalProducts.length > 0) {
        const supplementalFeatures = supplementalProducts
          .flatMap((p: any) => Array.isArray(p.productFeatures) ? p.productFeatures : [])
          .filter(Boolean)
        const supplementalReviews = supplementalProducts
          .flatMap((p: any) => Array.isArray(p.reviewHighlights) ? p.reviewHighlights : [])
          .filter(Boolean)
        const supplementalTopReviews = supplementalProducts
          .flatMap((p: any) => Array.isArray(p.topReviews) ? p.topReviews : [])
          .filter(Boolean)
        const supplementalCategories = supplementalProducts
          .map((p: any) => p.category)
          .filter(Boolean)

        if (supplementalFeatures.length > 0) {
          storeAggregatedFeatures = [...storeAggregatedFeatures, ...supplementalFeatures]
        }
        if (supplementalReviews.length > 0 || supplementalTopReviews.length > 0) {
          storeAggregatedReviews = [
            ...storeAggregatedReviews,
            ...supplementalReviews,
            ...supplementalTopReviews,
          ]
        }
        if (supplementalCategories.length > 0) {
          storeCategoryKeywords = [
            ...storeCategoryKeywords,
            ...supplementalCategories,
          ]
        }
      }
    } catch {}
  }

  // 添加店铺深度数据到extras
  if (storeAggregatedFeatures.length > 0) {
    extras.push(`STORE HOT FEATURES: ${storeAggregatedFeatures.slice(0, 8).join(' | ')}`)
  }
  if (storeAggregatedReviews.length > 0) {
    extras.push(`STORE USER VOICES: ${storeAggregatedReviews.slice(0, 5).join(' | ')}`)
  }
  if (storeHotBadges.length > 0) {
    extras.push(`STORE TRUST BADGES: ${storeHotBadges.join(', ')}`)
  }
  if (storeCategoryKeywords.length > 0) {
    extras.push(`STORE CATEGORIES: ${storeCategoryKeywords.join(', ')}`)
  }

  if (linkType === 'store') {
    const uniqueClaims = [...new Set(storeDescriptionClaims)]
    uniqueClaims.forEach(claim => supplementalVerifiedFacts.push(`- STORE CLAIM: ${claim}`))
    storePriceSamples.slice(0, 2).forEach(sample => {
      const name = formatSupplementalName(sample.name)
      if (name && sample.price) {
        supplementalVerifiedFacts.push(`- STORE ITEM PRICE: ${name} ${sample.price}`)
      }
    })
    if (storePriceRange) {
      supplementalVerifiedFacts.push(`- STORE PRICE RANGE: ${storePriceRange}`)
    }
  }

  // 🆕 多单品卖点混合（店铺模式）：强约束提示
  if (linkType === 'store' && supplementalHookLines.length > 0) {
    const hooksList = supplementalHookLines.slice(0, 6).map(h => `- ${h}`).join('\n')
    store_creative_instructions += `

### 🧩 多单品卖点混合（必须）
- 必须混合使用不同单品的卖点（至少覆盖 2 个不同单品）
- 至少 2 条 headlines 或 descriptions 需直接体现单品卖点/特色（可使用短名）
- 价格/评分只能使用 VERIFIED FACTS 中列出的数字

**可用单品卖点库（混合引用）**:
${hooksList}
`
  }

  // 🎯 v3.2优化（2025-12-08）：读取v3.2差异化分析数据
  let v32Analysis: {
    storeQualityLevel?: string
    categoryDiversification?: { level: string; categories?: string[]; primaryCategory?: string }
    hotInsights?: { avgRating?: number; avgReviews?: number; topProductsCount?: number; bestSeller?: string; priceRange?: { min: number; max: number } }
    marketFit?: { score: number; level: string; strengths?: string[]; gaps?: string[] }
    credibilityLevel?: { score: number; level: string; factors?: string[] }
    categoryPosition?: { rank?: string; percentile?: number; competitors?: number }
    pageType?: 'store' | 'product'
  } | null = null

  // 🔧 修复(2025-12-31): 使用 safeParseJson 处理 PostgreSQL jsonb 字段
  if (offer.ai_analysis_v32) {
    v32Analysis = safeParseJson(offer.ai_analysis_v32)
    if (v32Analysis) {
      console.log(`[AdCreativeGenerator] 🎯 使用v3.2分析数据: pageType=${v32Analysis?.pageType}`)
    }
  }

  // 店铺页面特殊处理（v3.2增强）
  if (v32Analysis?.pageType === 'store') {
    // 店铺质量等级
    if (v32Analysis.storeQualityLevel) {
      extras.push(`STORE QUALITY: ${v32Analysis.storeQualityLevel} Tier`)
    }
    // 分类多样化
    if (v32Analysis.categoryDiversification) {
      const catDiv = v32Analysis.categoryDiversification
      extras.push(`CATEGORY FOCUS: ${catDiv.level}${catDiv.primaryCategory ? ` - Primary: ${catDiv.primaryCategory}` : ''}`)
      if (catDiv.categories && catDiv.categories.length > 0) {
        extras.push(`PRODUCT RANGE: ${catDiv.categories.slice(0, 4).join(', ')}`)
      }
    }
    // 增强热销洞察
    if (v32Analysis.hotInsights) {
      const hi = v32Analysis.hotInsights
      if (hi.bestSeller) {
        extras.push(`BEST SELLER: ${hi.bestSeller}`)
      }
      if (hi.priceRange) {
        extras.push(`PRICE RANGE: $${hi.priceRange.min} - $${hi.priceRange.max}`)
      }
    }
  }

  // 单品页面特殊处理（v3.2增强）
  if (v32Analysis?.pageType === 'product') {
    // 市场契合度
    if (v32Analysis.marketFit) {
      const mf = v32Analysis.marketFit
      extras.push(`MARKET FIT: ${mf.level} (${mf.score}/100)`)
      if (mf.strengths && mf.strengths.length > 0) {
        extras.push(`PRODUCT STRENGTHS: ${mf.strengths.slice(0, 3).join(', ')}`)
      }
    }
    // 可信度评级
    if (v32Analysis.credibilityLevel) {
      const cl = v32Analysis.credibilityLevel
      extras.push(`CREDIBILITY: ${cl.level} (${cl.score}/100)`)
      if (cl.factors && cl.factors.length > 0) {
        extras.push(`TRUST FACTORS: ${cl.factors.slice(0, 3).join(', ')}`)
      }
    }
    // 品类排名
    if (v32Analysis.categoryPosition) {
      const cp = v32Analysis.categoryPosition
      if (cp.rank) {
        extras.push(`CATEGORY RANK: ${cp.rank}`)
      }
      if (cp.percentile) {
        extras.push(`TOP ${100 - cp.percentile}% IN CATEGORY`)
      }
    }
  }

  // 🔥 P0优化：竞品分析数据（差异化定位关键）
  if (offer.competitor_analysis) {
    try {
      const compAnalysis = JSON.parse(offer.competitor_analysis)

      // 1. 价格定位营销标签（🔥 v4.2优化：完整价格区间定位）
      if (compAnalysis.pricePosition) {
        const pricePos = compAnalysis.pricePosition
        // 价格节省信息
        if (pricePos.savingsVsAvg) {
          extras.push(`COMPETITIVE PRICE: ${pricePos.savingsVsAvg}`)
        }
        // 🔥 新增：完整价格区间营销标签
        switch (pricePos.priceAdvantage) {
          case 'lowest':
            extras.push(`MARKET POSITION: [BEST VALUE] Lowest priced in category`)
            break
          case 'below_average':
            const percentile = pricePos.pricePercentile || 0
            extras.push(`MARKET POSITION: [VALUE PICK] Top ${percentile}% most affordable`)
            break
          case 'average':
            extras.push(`MARKET POSITION: [BALANCED] Competitive price with quality features`)
            break
          case 'above_average':
            extras.push(`MARKET POSITION: [QUALITY] Premium features at fair price`)
            break
          case 'premium':
            extras.push(`MARKET POSITION: [FLAGSHIP] Top-tier quality and performance`)
            break
        }
      }

      // 🔥 新增：评分优势营销标签
      if (compAnalysis.ratingPosition) {
        const ratingPos = compAnalysis.ratingPosition
        switch (ratingPos.ratingAdvantage) {
          case 'top_rated':
            extras.push(`RATING ADVANTAGE: [TOP RATED] Highest customer satisfaction (${ratingPos.ourRating} stars)`)
            break
          case 'above_average':
            extras.push(`RATING ADVANTAGE: [HIGHLY RATED] Above average at ${ratingPos.ourRating} stars`)
            break
        }
      }

      // 2. 独特卖点（竞品没有的优势）
      if (compAnalysis.uniqueSellingPoints && compAnalysis.uniqueSellingPoints.length > 0) {
        const highSignificanceUSPs = compAnalysis.uniqueSellingPoints
          .filter((u: any) => u.significance === 'high')
          .map((u: any) => u.usp)
        if (highSignificanceUSPs.length > 0) {
          extras.push(`UNIQUE ADVANTAGES: ${highSignificanceUSPs.join('; ')}`)
        }
      }

      // 3. 如何应对竞品优势（定位策略）
      if (compAnalysis.competitorAdvantages && compAnalysis.competitorAdvantages.length > 0) {
        const counterStrategies = compAnalysis.competitorAdvantages
          .slice(0, 2) // 只取前2个最重要的
          .map((a: any) => a.howToCounter)
        if (counterStrategies.length > 0) {
          extras.push(`POSITIONING STRATEGY: ${counterStrategies.join('; ')}`)
        }
      }

      // 4. 我们有且竞品也有的功能（强化竞争力）
      if (compAnalysis.featureComparison && compAnalysis.featureComparison.length > 0) {
        const ourAdvantages = compAnalysis.featureComparison
          .filter((f: any) => f.weHave && f.ourAdvantage)
          .map((f: any) => f.feature)
        if (ourAdvantages.length > 0) {
          extras.push(`COMPETITIVE FEATURES: ${ourAdvantages.slice(0, 3).join(', ')}`)
        }
      }

      // 🔥 v3.2新增：竞品弱点（转化为我们的差异化卖点）
      // 这是最有说服力的广告素材 - 直接点出竞品问题，暗示我们解决了这些问题
      if (compAnalysis.competitorWeaknesses && compAnalysis.competitorWeaknesses.length > 0) {
        // 提取高频竞品弱点的adCopy
        const highFreqWeaknesses = compAnalysis.competitorWeaknesses
          .filter((w: any) => w.frequency === 'high' || w.frequency === 'medium')
          .slice(0, 3)
          .map((w: any) => w.adCopy)
          .filter((ad: string) => ad && ad.length > 0)
        if (highFreqWeaknesses.length > 0) {
          extras.push(`COMPETITOR WEAKNESSES (use to differentiate): ${highFreqWeaknesses.join(' | ')}`)
        }

        // 单独提取详细弱点描述，用于更深度的广告创意
        const weaknessDetails = compAnalysis.competitorWeaknesses
          .slice(0, 2)
          .map((w: any) => `${w.weakness} → We offer: ${w.ourAdvantage}`)
        if (weaknessDetails.length > 0) {
          extras.push(`AVOID COMPETITOR ISSUES: ${weaknessDetails.join(' | ')}`)
        }
      }

      // 🔥 v4.1优化：提取竞品特性用于差异化关键词
      if (compAnalysis.competitors && Array.isArray(compAnalysis.competitors)) {
        // 收集所有竞品特性
        const competitorFeatures: string[] = []
        compAnalysis.competitors.forEach((comp: any) => {
          if (comp.features && Array.isArray(comp.features)) {
            competitorFeatures.push(...comp.features.slice(0, 3))
          }
        })
        // 去重并取前10个
        const uniqueCompFeatures = [...new Set(competitorFeatures)].slice(0, 10)
        if (uniqueCompFeatures.length > 0) {
          extras.push(`COMPETITOR FEATURES (for differentiation): ${uniqueCompFeatures.join(' | ')}`)
        }
      }

      console.log('✅ 已加载竞品分析数据到Prompt')
    } catch (parseError: any) {
      console.warn('⚠️ 解析竞品分析数据失败（非致命错误）:', parseError.message)
    }
  }

  // 🔥 2026-01-04新增：处理独立站增强数据字段（reviews、faqs、specifications、packages、socialProof等）
  // 这些数据从scraped_data中提取，用于增强广告创意生成
  if (offer.scraped_data) {
    try {
      const scrapedData = JSON.parse(offer.scraped_data)

      // 1. User Reviews（真实用户评论）
      if (scrapedData.reviews && Array.isArray(scrapedData.reviews) && scrapedData.reviews.length > 0) {
        const reviewSummaries = scrapedData.reviews.slice(0, 5).map((r: any) =>
          `${r.rating}★ - ${r.author}: ${r.title}${r.body ? `. ${r.body.substring(0, 80)}${r.body.length > 80 ? '...' : ''}` : ''}`
        )
        extras.push(`REAL USER REVIEWS: ${reviewSummaries.join(' | ')}`)

        // 从评论中提取用户常用表达模式
        const userPhrases: string[] = []
        scrapedData.reviews.slice(0, 5).forEach((r: any) => {
          if (r.body) {
            const patterns = [
              /very ([\w\s]+)/gi, /really ([\w\s]+)/gi, /love(s?)( the)?/gi,
              /great ([\w\s]+)/gi, /perfect for/gi, /easy to/gi, /highly recommend/gi
            ]
            patterns.forEach(pattern => {
              const matches = r.body.match(pattern)
              if (matches) {
                matches.slice(0, 2).forEach((m: string) => {
                  const cleaned = m.toLowerCase().trim().substring(0, 25)
                  if (cleaned.length > 5) userPhrases.push(cleaned)
                })
              }
            })
          }
        })
        const uniquePhrases = [...new Set(userPhrases)].slice(0, 5)
        if (uniquePhrases.length > 0) {
          extras.push(`USER LANGUAGE PATTERNS: ${uniquePhrases.join(', ')}`)
        }
      }

      // 2. FAQs（常见问题）
      if (scrapedData.faqs && Array.isArray(scrapedData.faqs) && scrapedData.faqs.length > 0) {
        // 将FAQ转化为广告创意素材：回答用户关心的问题
        const faqHighlights = scrapedData.faqs.slice(0, 4).map((f: any) =>
          `Q: ${f.question.substring(0, 50)}${f.question.length > 50 ? '...' : ''}`
        )
        extras.push(`CUSTOMER FAQs: ${faqHighlights.join(' | ')}`)
      }

      // 3. Product Specifications（技术规格）
      if (scrapedData.specifications && typeof scrapedData.specifications === 'object') {
        const specEntries = Object.entries(scrapedData.specifications).slice(0, 5)
        if (specEntries.length > 0) {
          const specStr = specEntries.map(([k, v]) => `${k}: ${v}`).join(', ')
          extras.push(`TECH SPECS: ${specStr}`)
        }
      }

      // 4. Package Options（套餐选项）
      if (scrapedData.packages && Array.isArray(scrapedData.packages) && scrapedData.packages.length > 0) {
        const packageInfo = scrapedData.packages.slice(0, 3).map((p: any) =>
          `${p.name || 'Package'}${p.price ? ` (${p.price})` : ''}: ${(p.includes || []).slice(0, 3).join(', ')}`
        )
        extras.push(`PACKAGE OPTIONS: ${packageInfo.join(' | ')}`)
      }

      // 5. Social Proof（社会证明）
      if (scrapedData.socialProof && Array.isArray(scrapedData.socialProof) && scrapedData.socialProof.length > 0) {
        const socialMetrics = scrapedData.socialProof.map((sp: any) =>
          `${sp.metric}: ${sp.value}`
        ).join(' | ')
        extras.push(`SOCIAL PROOF METRICS: ${socialMetrics}`)
      }

      // 6. Core Features（核心卖点）
      if (scrapedData.coreFeatures && Array.isArray(scrapedData.coreFeatures) && scrapedData.coreFeatures.length > 0) {
        extras.push(`CORE FEATURES: ${scrapedData.coreFeatures.slice(0, 5).join(', ')}`)
      }

      // 7. Secondary Features（次要特性）
      if (scrapedData.secondaryFeatures && Array.isArray(scrapedData.secondaryFeatures) && scrapedData.secondaryFeatures.length > 0) {
        extras.push(`ADDITIONAL FEATURES: ${scrapedData.secondaryFeatures.slice(0, 5).join(', ')}`)
      }

      console.log('✅ 已加载独立站增强数据到Prompt')
    } catch (parseError: any) {
      console.warn('⚠️ 解析独立站增强数据失败（非致命错误）:', parseError.message)
    }
  }

  // 🎯 P0优化（2025-12-07）：利用新增AI数据字段
  let aiKeywords: string[] = []
  let aiCompetitiveEdges: any = null
  let aiReviews: any = null

  // 🔧 修复(2025-12-31): 使用 safeParseJson 处理 PostgreSQL jsonb 字段
  // 读取AI增强的关键词数据
  if (offer.ai_keywords) {
    aiKeywords = safeParseJson(offer.ai_keywords, [])
    if (Array.isArray(aiKeywords)) {
      console.log(`[AdCreativeGenerator] 🎯 使用AI生成关键词: ${aiKeywords.length}个`)
    } else {
      aiKeywords = []
    }
  }

  // 读取AI竞争优势数据
  if (offer.ai_competitive_edges) {
    aiCompetitiveEdges = safeParseJson(offer.ai_competitive_edges, null)
    if (aiCompetitiveEdges) {
      console.log(`[AdCreativeGenerator] 🏆 使用AI竞争优势数据:`, aiCompetitiveEdges)
    }
  }

  // 读取AI评论洞察数据
  if (offer.ai_reviews) {
    aiReviews = safeParseJson(offer.ai_reviews, null)
    if (aiReviews) {
      console.log(`[AdCreativeGenerator] ⭐ 使用AI评论洞察: rating=${aiReviews.rating}, sentiment=${aiReviews.sentiment}`)
    }
  }

  const precomputedKeywordSet = runtimeGuidance?.precomputedKeywordSet || null
  const keywordUsagePlan = buildCreativeKeywordUsagePlan({
    brandName: offer.brand,
    precomputedKeywordSet,
  })

  const promptKeywordPlan = resolveAdCreativePromptKeywordPlan({
    extractedKeywords:
      Array.isArray(precomputedKeywordSet?.keywordsWithVolume) && precomputedKeywordSet.keywordsWithVolume.length > 0
        ? precomputedKeywordSet.keywordsWithVolume
        : extractedElements?.keywords,
    aiKeywords,
    titleAboutKeywordSeeds: titleAndAboutSignals.keywordSeeds || [],
    offerBrand: offer.brand,
    targetLanguage,
    policyGuardMode,
  })

  if (promptKeywordPlan.policyMatchedTerms.length > 0) {
    console.log(
      `[PolicyGuard] Prompt关键词净化: 命中${promptKeywordPlan.policyMatchedTerms.length}个敏感词`
    )
  }

  const promptRuleContext = createCreativeRuleContext({
    brandName: offer.brand,
    category: offer.category,
    productName: rawProductName,
    productTitle: rawProductTitle,
    productDescription: rawProductDescription,
    uniqueSellingPoints: rawUniqueSellingPoints,
    keywords: promptKeywordPlan.promptKeywords,
    targetLanguage
  })

  // Build extras_data section（去噪，避免无关维修/工具类噪声污染Prompt）
  const filteredExtrasResult = filterPromptExtrasByRelevance(extras, promptRuleContext)
  if (filteredExtrasResult.removed.length > 0) {
    console.warn(
      `🧹 Prompt extras 去噪: 移除 ${filteredExtrasResult.removed.length} 条疑似离题片段`
    )
  }
  variables.extras_data = filteredExtrasResult.filtered.length
    ? '\n' + filteredExtrasResult.filtered.join(' | ') + '\n'
    : ''

  // ✅ VERIFIED FACTS（仅允许使用这些可验证信息；为空则不要写数字/承诺）
  // 只使用“产品数据”来源，避免把prompt中的示例数字误当作证据
  const verifiedFacts: string[] = []
  if (priceEvidenceBlocked) {
    verifiedFacts.push('- PRICE EVIDENCE BLOCKED: Conflicting price signals detected. Do NOT mention any exact price amount.')
  }
  const verifiedPrimaryProduct = formatSupplementalName(policySafeProductName.text || String(rawProductName || ''))
  if (verifiedPrimaryProduct) verifiedFacts.push(`- PRIMARY PRODUCT: ${verifiedPrimaryProduct}`)
  if (offer.category) verifiedFacts.push(`- PRIMARY CATEGORY: ${offer.category}`)
  if (currentPrice) verifiedFacts.push(`- PRICE: ${currentPrice}`)
  if (originalPrice) verifiedFacts.push(`- ORIGINAL PRICE: ${originalPrice}`)
  if (discount) verifiedFacts.push(`- DISCOUNT: ${discount}`)
  if (activePromotions.length > 0) {
    const p = activePromotions[0]
    verifiedFacts.push(`- PROMOTION: ${p.description}${p.code ? ` (Code: ${p.code})` : ''}${p.validUntil ? ` (Until: ${p.validUntil})` : ''}`)
  }
  if (salesRankForPrompt) verifiedFacts.push(`- SALES RANK: ${salesRankForPrompt}`)
  if (badge) verifiedFacts.push(`- BADGE: ${badge}`)
  if (availability) verifiedFacts.push(`- STOCK/AVAILABILITY: ${availability}`)
  if (primeEligible) verifiedFacts.push(`- PRIME/FAST SHIPPING: Yes`)
  if (totalReviews > 0) verifiedFacts.push(`- TOTAL REVIEWS: ${totalReviews}`)
  if (averageRating > 0) verifiedFacts.push(`- AVERAGE RATING: ${averageRating}`)
  if (linkType === 'store' && topProducts.length > 0) {
    verifiedFacts.push(`- VERIFIED HOT PRODUCTS: ${topProducts.slice(0, 3).map(formatSupplementalName).filter(Boolean).join(', ')}`)
  }
  if (supplementalVerifiedFacts.length > 0) {
    const filteredSupplementalFacts = filterPromptExtrasByRelevance(
      supplementalVerifiedFacts,
      promptRuleContext
    )
    if (filteredSupplementalFacts.removed.length > 0) {
      console.warn(
        `🧹 Verified facts 去噪: 移除 ${filteredSupplementalFacts.removed.length} 条疑似离题事实`
      )
    }
    verifiedFacts.push(...filteredSupplementalFacts.filtered.slice(0, 6))
  }
  if (quantitativeHighlights.length > 0) {
    verifiedFacts.push(`- QUANTITATIVE HIGHLIGHTS: ${quantitativeHighlights.slice(0, 3).map(h => `${h.metric}=${h.value}`).join(', ')}`)
  }

  variables.verified_facts_section = verifiedFacts.length
    ? `\n## ✅ VERIFIED FACTS (Only use these claims; do NOT invent)\n${verifiedFacts.join('\n')}\n`
    : `\n## ✅ VERIFIED FACTS (Only use these claims; do NOT invent)\n- (No verified facts provided. Do NOT use numbers, discounts, or guarantees.)\n`
  const hasVerifiedFacts = verifiedFacts.length > 0
  const hasPromoEvidence = !!(discount || activePromotions.length > 0 || currentPrice || originalPrice)
  const hasUrgencyEvidence = !!availability || activePromotions.some((p: any) => !!p?.validUntil)

  // 🔥 Build promotion_section（v2.1新增）
  let promotion_section = ''
  if (activePromotions.length > 0) {
    const mainPromo = activePromotions[0]
    promotion_section = `\n🔥 **CRITICAL PROMOTION EMPHASIS**:
This product has ${activePromotions.length} active promotion(s). YOU MUST highlight these in your creative:

**MAIN PROMOTION**: ${mainPromo.description}${mainPromo.code ? ` (Code: ${mainPromo.code})` : ''}
${mainPromo.validUntil ? `**VALID UNTIL**: ${mainPromo.validUntil}` : ''}
${mainPromo.conditions ? `**CONDITIONS**: ${mainPromo.conditions}` : ''}

**REQUIREMENTS**:
✅ Include promotion in at least 3-5 headlines (e.g., "20% Off Today", "Use Code ${mainPromo.code || 'SAVE20'}", "Limited Time Offer")
✅ Mention promotion in 2-3 descriptions with urgency (e.g., "Don't miss out", "Offer ends soon")
✅ Add promotion-related keywords (e.g., "discount", "sale", "promo code", "limited offer")
✅ Use callouts to emphasize savings (e.g., "20% Off First Order", "Free Shipping Available")
`

    if (activePromotions.length > 1) {
      const secondaryPromo = activePromotions[1]
      promotion_section += `\n**SECONDARY PROMOTION**: ${secondaryPromo.description}${secondaryPromo.code ? ` (Code: ${secondaryPromo.code})` : ''}\n`
    }

    promotion_section += `
**PROMOTION CREATIVE EXAMPLES**:
- Headline: "Get 20% Off - Use Code ${mainPromo.code || 'SAVE20'} | ${offer.brand}"
- Headline: "${offer.brand} - Limited Time Offer | Shop Now"
- Headline: "Save on ${offer.brand_description || offer.brand} - Deal Ends Soon"
- Description: "Shop now and save with code ${mainPromo.code || 'SAVE20'}. ${mainPromo.description}. Limited time!"
- Description: "${offer.brand_description || offer.brand} at special price. ${mainPromo.description}${offer.final_url ? '. Free shipping available.' : ''}"
- Callout: "${mainPromo.description}"
- Callout: "Limited Time Deal"

`
  }
  variables.promotion_section = promotion_section

  // Build theme_section
  let theme_section = ''
  if (theme) {
    theme_section = `\n**THEME: ${theme}** - All content must reflect this theme. 60%+ headlines should directly embody theme.\n`
  }
  variables.theme_section = theme_section

  // Build reference_performance_section
  let reference_performance_section = ''
  if (referencePerformance) {
    if (referencePerformance.best_headlines?.length) {
      reference_performance_section += `TOP HEADLINES: ${referencePerformance.best_headlines.slice(0, 3).join(', ')}\n`
    }
    if (referencePerformance.top_keywords?.length) {
      reference_performance_section += `TOP KEYWORDS: ${referencePerformance.top_keywords.slice(0, 5).join(', ')}\n`
    }
  }
  variables.reference_performance_section = reference_performance_section

  // 🎯 Build extracted_elements_section
  let extracted_elements_section = ''
  if (extractedElements) {
    if (titleAndAboutSignals.productTitle) {
      extracted_elements_section += `\n**EXTRACTED PRODUCT TITLE** (Amazon title, keep unique wording):\n"${truncateSnippetByWords(titleAndAboutSignals.productTitle, 180)}"\n`
    }

    if (titleAndAboutSignals.titlePhrases.length > 0) {
      extracted_elements_section += `\n**TITLE CORE PHRASES** (high-priority wording from title):\n${titleAndAboutSignals.titlePhrases.slice(0, 6).join(' | ')}\n`
    }

    if (titleAndAboutSignals.aboutClaims.length > 0) {
      extracted_elements_section += `\n**ABOUT THIS ITEM CORE CLAIMS** (high-priority wording from bullets):\n${titleAndAboutSignals.aboutClaims.slice(0, 6).join(' | ')}\n`
    }

    if (extractedElements.keywords && extractedElements.keywords.length > 0) {
      // 🔧 调整(2026-02-03): 将提取关键词数量限制在30个以内，避免Prompt噪声过高
      // 🔧 修复(2025-12-26): 服务账号模式下无法获取搜索量，保留searchVolume=0的关键词
      const promptBrandTokens = getPureBrandKeywords(offer.brand || '')
      const promptBrandKeywordCount = countBrandContainingKeywords(
        extractedElements.keywords
          .filter(k => !!k?.keyword)
          .map(k => ({ keyword: k.keyword, searchVolume: k.searchVolume })),
        offer.brand || '',
        promptBrandTokens
      )
      const promptDynamicNonBrandMinSearchVolume =
        resolveNonBrandMinSearchVolumeByBrandKeywordCount(promptBrandKeywordCount)
      const hasAnyVolume = extractedElements.keywords.some(k => k.searchVolume > 0)
      const promptVolumeUnavailable = extractedElements.keywords.some((k: any) =>
        isSearchVolumeUnavailableReason(k?.volumeUnavailableReason)
      )
      const topKeywords = extractedElements.keywords
        .filter(k => {
          if (!hasAnyVolume || promptVolumeUnavailable) return true
          const keywordText = String(k.keyword || '')
          const isBrandKeyword =
            containsPureBrand(keywordText, promptBrandTokens) ||
            isBrandConcatenation(keywordText, offer.brand || '')
          if (isBrandKeyword) return true
          return k.searchVolume >= promptDynamicNonBrandMinSearchVolume
        })
        .slice(0, 30)
        .map(k => (k.searchVolume > 0 ? `"${k.keyword}" (${k.searchVolume}/mo)` : `"${k.keyword}"`))
      if (topKeywords.length > 0) {
        extracted_elements_section += `\n**EXTRACTED KEYWORDS** (from product data, validated by Keyword Planner):\n${topKeywords.join(', ')}\n`
      }
    }

    if (extractedElements.headlines && extractedElements.headlines.length > 0) {
      extracted_elements_section += `\n**EXTRACTED HEADLINES** (from product titles, ≤30 chars):\n${extractedElements.headlines.slice(0, 5).join(', ')}\n`
    }

    if (extractedElements.descriptions && extractedElements.descriptions.length > 0) {
      extracted_elements_section += `\n**EXTRACTED DESCRIPTIONS** (from product features, ≤90 chars):\n${extractedElements.descriptions.slice(0, 2).join('; ')}\n`
    }

    if (titleAndAboutSignals.calloutIdeas.length > 0) {
      extracted_elements_section += `\n**ABOUT-DERIVED CALLOUT IDEAS** (≤25 chars style):\n${titleAndAboutSignals.calloutIdeas.slice(0, 6).join(', ')}\n`
    }

    if (titleAndAboutSignals.sitelinkIdeas.length > 0) {
      const sitelinkHints = titleAndAboutSignals.sitelinkIdeas
        .slice(0, 6)
        .map(item => `${item.text} - ${item.description}`)
      extracted_elements_section += `\n**ABOUT-DERIVED SITELINK IDEAS** (text/desc style):\n${sitelinkHints.join(' | ')}\n`
    }

    // 🔥 独立站增强：从extraction_metadata中读取SERP补充的callout/sitelink（如果有）
    const extractionMetadata = safeParseJson((offer as any).extraction_metadata, null)
    const serpCalloutsRaw =
      Array.isArray(extractionMetadata?.serpCallouts) ? extractionMetadata.serpCallouts
        : (Array.isArray(extractionMetadata?.brandSearchSupplement?.extracted?.callouts)
            ? extractionMetadata.brandSearchSupplement.extracted.callouts
            : [])
    const serpSitelinksRaw =
      Array.isArray(extractionMetadata?.serpSitelinks) ? extractionMetadata.serpSitelinks
        : (Array.isArray(extractionMetadata?.brandSearchSupplement?.extracted?.sitelinks)
            ? extractionMetadata.brandSearchSupplement.extracted.sitelinks
            : [])

    const serpCallouts = serpCalloutsRaw
      .filter((c: any) => typeof c === 'string' && c.trim().length > 0)
      .map((c: string) => c.trim())
      .slice(0, 6)
    if (serpCallouts.length > 0) {
      extracted_elements_section += `\n**EXTRACTED CALLOUTS** (from Google SERP/official site):\n${serpCallouts.join(', ')}\n`
    }

    const serpSitelinks = serpSitelinksRaw
      .filter((s: any) => s && typeof s.text === 'string' && s.text.trim().length > 0)
      .map((s: any) => {
        const text = String(s.text).trim()
        const desc = s.description ? String(s.description).trim() : ''
        return desc ? `${text} - ${desc}` : text
      })
      .slice(0, 6)
    if (serpSitelinks.length > 0) {
      extracted_elements_section += `\n**EXTRACTED SITELINK IDEAS** (from official site):\n${serpSitelinks.join(' | ')}\n`
    }

    extracted_elements_section += `\n**INSTRUCTION**: Use above extracted elements as reference. You can refine or expand them, but prioritize extracted keywords with search volume. TITLE CORE PHRASES and ABOUT THIS ITEM CORE CLAIMS are high-priority context for headlines, descriptions, callouts and sitelinks. For keywords, only use high-intent phrases as supplemental hints.\n`
  }
  variables.extracted_elements_section = extracted_elements_section

  // 🔧 v4.36: 移除了 primary_keyword 变量设置
  // 原因：已取消强制Headline #2使用DKI格式，此变量不再需要

  // 🔧 P0修复（2025-12-08）：添加缺失的section变量赋值
  variables.enhanced_features_section = enhanced_features_section
  variables.localization_section = localization_section
  variables.brand_analysis_section = brand_analysis_section

  // Build all dynamic guidance sections
  variables.headline_brand_guidance = buildHeadlineBrandGuidance(badge, featuredSalesRank, offer, hotInsights, topProducts, sentimentDistribution, averageRating)
  variables.headline_feature_guidance = buildHeadlineFeatureGuidance(technicalDetails, reviewHighlights, commonPraises, topPositiveKeywords, featureSource)
  variables.headline_promo_guidance = buildHeadlinePromoGuidance(discount, activePromotions, hasPromoEvidence, priceEvidenceBlocked)
  variables.headline_cta_guidance = buildHeadlineCTAGuidance(primeEligible, purchaseReasons)
  variables.headline_urgency_guidance = buildHeadlineUrgencyGuidance(availability, hasUrgencyEvidence)

  variables.description_1_guidance = buildDescription1Guidance(badge, featuredSalesRank)
  variables.description_2_guidance = buildDescription2Guidance(primeEligible, activePromotions)
  variables.description_3_guidance = buildDescription3Guidance(useCases, userProfiles)
  variables.description_4_guidance = buildDescription4Guidance(topReviews, hotInsights, topProducts, sentimentDistribution, totalReviews, averageRating)

  // 优先使用AI增强数据，fallback到原有数据
  variables.review_data_summary = buildReviewDataSummary(
    reviewHighlights,
    commonPraises,
    topPositiveKeywords,
    commonPainPoints,
    aiReviews
  )

  variables.callout_guidance = buildCalloutGuidance(salesRankForPrompt, primeEligible, availability, badge, activePromotions, hasVerifiedFacts)
  const searchTermFeedbackGuidance = buildSearchTermFeedbackGuidanceSection(runtimeGuidance?.searchTermFeedbackHints)
  const excludeKeywordLines: string[] = []
  const retainedKeywordProtectionSet = new Set(
    keywordUsagePlan.retainedNonBrandKeywords
      .map((keyword) => normalizeGoogleAdsKeyword(keyword))
      .filter(Boolean) as string[]
  )
  const filteredExcludeKeywords = Array.isArray(excludeKeywords)
    ? excludeKeywords.filter((keyword) => {
      const normalized = normalizeGoogleAdsKeyword(String(keyword || ''))
      return normalized ? !retainedKeywordProtectionSet.has(normalized) : false
    })
    : []
  if (filteredExcludeKeywords.length > 0) {
    excludeKeywordLines.push(`- 已用关键词: ${filteredExcludeKeywords.slice(0, 10).join(', ')}`)
  }
  if (searchTermFeedbackGuidance.hardTerms.length > 0) {
    excludeKeywordLines.push(`- 搜索词硬排除: ${searchTermFeedbackGuidance.hardTerms.join(', ')}`)
  }
  if (searchTermFeedbackGuidance.softTerms.length > 0) {
    excludeKeywordLines.push(`- 搜索词软抑制: ${searchTermFeedbackGuidance.softTerms.join(', ')}`)
  }

  // 🎯 新增：AI关键词section
  const validatedKeywordsForPrompt = promptKeywordPlan.validatedPromptKeywords
  const titleAboutKeywordSeeds = promptKeywordPlan.contextualPromptKeywords
  const keywordsForPrompt = promptKeywordPlan.promptKeywords
  const policyMatchedTerms = Array.from(new Set([
    ...policySignalTerms,
    ...promptKeywordPlan.policyMatchedTerms
  ])).slice(0, 12)
  if (policyMatchedTerms.length > 0) {
    excludeKeywordLines.push(`- 政策敏感词硬排除: ${policyMatchedTerms.join(', ')}`)
  }
  variables.exclude_keywords_section = excludeKeywordLines.join('\n')
  variables.retained_keyword_slot_section = buildRetainedKeywordSlotSection(keywordUsagePlan)

  if (keywordsForPrompt.length > 0) {
    let aiKeywordSection = `\n**关键词池（优先）**:\n${validatedKeywordsForPrompt.join(', ')}\n`
    if (titleAboutKeywordSeeds.length > 0) {
      aiKeywordSection += `\n**上下文短语（来自TITLE/ABOUT，仅补充，非搜索量验证，占比≤20%）**:\n${titleAboutKeywordSeeds.join(', ')}\n`
    }
    variables.ai_keywords_section = aiKeywordSection
    console.log(
      `[Prompt] 🔑 提供给AI的关键词数量: ${keywordsForPrompt.length}个 (主关键词${validatedKeywordsForPrompt.length} + 上下文补充${titleAboutKeywordSeeds.length})`
    )
  } else {
    variables.ai_keywords_section = ''
  }

  // 🆕 非破坏式A/B/D意图引导（仅作用于标题/描述表达）
  const normalizedPromptBucket = normalizeCreativeBucketType(extractedElements?.bucketInfo?.bucket)
  const creativeTypeConstraintSection = buildCreativeTypeConstraintSection({
    bucket: normalizedPromptBucket,
    linkType,
    brand: String(offer.brand || ''),
    category: String(offer.category || ''),
    productName: verifiedPrimaryProduct,
    targetCountry: String(offer.target_country || ''),
    targetLanguage,
    topProducts: topProducts
      .slice(0, 3)
      .map(formatSupplementalName)
      .filter(Boolean),
    keywords: keywordsForPrompt,
  })
  const typeIntentGuidanceSection = buildTypeIntentGuidanceSection(
    normalizedPromptBucket,
    keywordsForPrompt,
    normalizeLanguageCode(targetLanguage || 'English')
  )
  const personaScenarioGuidanceSection = buildPersonaScenarioGuidanceSection({
    bucket: normalizedPromptBucket,
    targetAudience: String(offer.target_audience || ''),
    useCases: Array.from(new Set([
      ...useCases,
      ...((extractedElements?.productInfo?.useCases || []).map((item: any) => String(item || '').trim()))
    ])).filter(Boolean).slice(0, 6),
    userProfiles,
    linkType
  })
  const policyGuidanceSection = buildGoogleAdsPolicyPromptGuardrails(targetLanguage, policyMatchedTerms, { mode: policyGuardMode })
  const retryFailureGuidanceSection = buildRetryFailureGuidanceSection(runtimeGuidance?.retryFailureType)
  variables.type_intent_guidance_section = [
    creativeTypeConstraintSection,
    typeIntentGuidanceSection,
    personaScenarioGuidanceSection,
    policyGuidanceSection,
    searchTermFeedbackGuidance.section,
    retryFailureGuidanceSection
  ].filter(Boolean).join('\n')

  // 🎯 新增：AI竞争优势section
  let ai_competitive_section = ''
  if (aiCompetitiveEdges) {
    if (aiCompetitiveEdges.badges && aiCompetitiveEdges.badges.length > 0) {
      ai_competitive_section += `\n**产品认证/优势标识**: ${aiCompetitiveEdges.badges.join(', ')}\n`
    }
    if (aiCompetitiveEdges.primeEligible) {
      ai_competitive_section += `\n**物流优势**: Prime Eligible（快速配送）\n`
    }
    if (aiCompetitiveEdges.stockStatus) {
      ai_competitive_section += `\n**库存状态**: ${aiCompetitiveEdges.stockStatus}\n`
    }
    if (aiCompetitiveEdges.salesRank) {
      const aiSalesRankSignal = resolveCreativeSalesRankSignal(aiCompetitiveEdges.salesRank)
      if (aiSalesRankSignal.strongSignal && aiSalesRankSignal.raw) {
        ai_competitive_section += `\n**销售排名**: ${aiSalesRankSignal.raw}\n`
      } else if (aiSalesRankSignal.raw) {
        console.log(
          `[SalesRankGuard] Offer ${offer.id}: skip ai_competitive salesRank "${aiSalesRankSignal.raw}" (not top-tier)`
        )
      }
    }
  }
  variables.ai_competitive_section = ai_competitive_section

  // 🎯 新增：AI评论洞察section
  let ai_reviews_section = ''
  if (aiReviews) {
    if (aiReviews.rating) {
      ai_reviews_section += `\n**用户评分**: ${aiReviews.rating}/5.0`
      if (aiReviews.count) {
        ai_reviews_section += ` (${aiReviews.count}条评价)`
      }
    }
    if (aiReviews.sentiment) {
      ai_reviews_section += `\n**整体评价**: ${aiReviews.sentiment}`
    }
    if (aiReviews.positives && aiReviews.positives.length > 0) {
      ai_reviews_section += `\n**用户好评亮点**: ${aiReviews.positives.slice(0, 3).join(', ')}\n`
    }
    if (aiReviews.useCases && aiReviews.useCases.length > 0) {
      ai_reviews_section += `\n**主要使用场景**: ${aiReviews.useCases.slice(0, 2).join(', ')}\n`
    }
  }
  variables.ai_reviews_section = ai_reviews_section

  // Build competitive_guidance_section（保留原有逻辑，但增强AI数据）
  let competitive_guidance_section = ''
  if (offer.competitor_analysis) {
    try {
      const compAnalysis = JSON.parse(offer.competitor_analysis)
      competitive_guidance_section = buildCompetitiveGuidance(compAnalysis)
    } catch {}
  }
  variables.competitive_guidance_section = competitive_guidance_section

  // 🆕 v4.10: 添加关键词池桶相关变量
  // 这些变量名需要与 prompt 模板中的占位符匹配
  if (extractedElements?.bucketInfo) {
    const { bucket, intent, intentEn, keywordCount } = extractedElements.bucketInfo
    const kissBucket = bucket === 'C' ? 'B' : bucket === 'S' ? 'D' : bucket
    variables.bucket_type = kissBucket
    variables.bucket_intent = intent || intentEn || ''
    variables.bucket_info_section = `
**📦 当前创意桶：${kissBucket} - ${intent || intentEn}**
- 桶主题：${intent || intentEn}
- 预选关键词数量：${keywordCount}
- 文案风格要求：所有 Headlines 和 Descriptions 必须与"${intent || intentEn}"主题一致`
  } else {
    // 未使用关键词池时的默认值
    variables.bucket_type = ''
    variables.bucket_intent = ''
    variables.bucket_info_section = ''
  }
  // 兼容性：保留旧的占位符名称
  variables.keyword_bucket_section = keyword_bucket_section

  // 🆕 v4.16: 添加链接类型策略 section
  // 根据 offer.page_type 区分单品链接和店铺链接，使用不同的创意策略
  // 注意：linkType 已在第307行声明
  if (linkType === 'store') {
    variables.link_type_section = `
## 📍 当前链接类型：店铺页面 (Store Page)
**目标**：最大化进店，扩大品牌认知（KISS-3：A/B/D）

**类型与关键词侧重（用户可见）**:
| 类型 | 主题 | 关键词侧重 | 文案重点 |
|----|------|-----------|---------|
| A | 品牌意图 | 品牌词 + 商品/品类锚点 | 品牌背书 + 真实商品集合 + 可信度 |
| B | 热门商品型号/产品族 | 品牌 + 热门商品型号/产品族 + 品类长尾词 | 热门型号/产品族 + 购买动作 + 完全匹配 |
| D | 商品需求 | 品牌 + 品类 + 功能/场景/产品线词 | 商品需求覆盖 + 商品卖点 + CTA |

**兼容性**：历史桶 \`C→B\`、\`S→D\`（不要在输出中写 \`C/S\`）。

**核心要求**:
- 强调品牌官方地位和可信度
- 突出店铺热销产品和高评价
- 展示店铺的独特卖点和售后保障
- 有证据时使用店铺层面的社会证明（评分、评价数、销量）；禁止编造数字
`
  } else {
    // 默认：单品链接策略
    variables.link_type_section = `
## 📍 当前链接类型：产品页面 (Product Page)
**目标**：最大化转化，让用户购买这个具体产品（KISS-3：A/B/D）

**类型与关键词侧重（用户可见）**:
| 类型 | 主题 | 文案重点 |
|----|------|---------|
| A | 品牌意图 | 品牌背书 + 当前商品强相关 + 单品聚焦 |
| B | 商品型号/产品族 | 当前商品型号/产品族 + 品类长尾词 + 单品聚焦 |
| D | 商品需求 | 品牌 + 商品需求/功能/场景覆盖 + 明确CTA |

**兼容性**：历史桶 \`C→B\`、\`S→D\`（不要在输出中写 \`C/S\`）。

**核心要求**:
- 标题必须与具体产品相关联
- 至少 2 个标题包含具体产品型号或参数
- 有证据时描述可包含价格/折扣/限时等细节；禁止编造
- 禁止使用店铺化引导（如“explore our collection/store”）
`
  }

  // 🆕 v4.17: 添加链接类型相关变量到模板
  variables.link_type_instructions = link_type_instructions
  variables.store_creative_instructions = store_creative_instructions

  // 🆕 v4.17: 添加输出格式要求（解决AI返回非JSON格式问题）
  // 🔧 2026-01-02: 修复AI只返回1个关键词的问题，明确要求返回多个关键词
  variables.output_format_section = `
## 📋 OUTPUT (JSON only, no markdown):

{
  "copyAngle": "...",
  "headlines": [
    {"text": "...", "type": "brand", "length": N}
  ],
  "descriptions": [
    {"text": "...", "type": "feature-benefit-cta", "length": N}
  ],
  "keywords": ["keyword1", "keyword2", ...],
  "keywordCandidates": [
    {
      "text": "...",
      "sourceType": "...",
      "sourceField": "...",
      "anchorType": "...",
      "evidence": ["field path / product / search term evidence"],
      "suggestedMatchType": "EXACT|PHRASE|BROAD",
      "confidence": 0.0,
      "qualityReason": "...",
      "rejectionReason": "..."
    }
  ],
  "evidenceProducts": ["verified product / hot product names actually referenced"],
  "cannotGenerateReason": "...",
  "callouts": ["..."],
  "sitelinks": [{"text": "...", "url": "/", "description": "..."}],
  "path1": "...",
  "path2": "...",
  "theme": "..."
}

**TYPE RULES (CRITICAL):**
- headlines[].type 必须是单一值，仅能从以下选一个：brand / feature / promo / cta / urgency / social_proof / question / emotional
- descriptions[].type 必须是单一值，仅能从以下选一个：feature-benefit-cta / problem-solution-proof / offer-urgency-trust / usp-differentiation
- 禁止使用“|”拼接多个类型

**STRICT COUNT REQUIREMENTS (MUST MATCH EXACTLY):**
- Headlines: EXACTLY 15 items, each ≤ 30 chars
- Descriptions: EXACTLY 4 items, each ≤ 90 chars
- Keywords: 10-20 items (no more than 20)
- Callouts: EXACTLY 6 items, each ≤ 25 chars
- Sitelinks: EXACTLY 6 items, text ≤ 25, description ≤ 35

**STRUCTURED METADATA RULES:**
- copyAngle / evidenceProducts / keywordCandidates / cannotGenerateReason are OPTIONAL but strongly recommended.
- evidenceProducts must only contain verified current product names or verified hot product names actually used in copy.
- keywordCandidates are audit metadata only; keywords[] remains the final executable keyword list.
- keywordCandidates should include sourceType / sourceField / anchorType / evidence / suggestedMatchType / confidence whenever available.
- If a candidate is weak or excluded, prefer populating rejectionReason instead of silently inventing stronger evidence.
- If verified product/model evidence is insufficient, return cannotGenerateReason instead of inventing unsupported models, series, functions, or product lines.
- Do not fabricate sourceType, sourceField, anchorType, evidence, suggestedMatchType, confidence, evidenceProducts, or cannotGenerateReason.

**IMPORTANT**: Return ONLY valid JSON. No explanations or markdown. All content must be in {{target_language}}.`

  // Substitute all placeholders and return
  return {
    prompt: substitutePlaceholders(promptTemplate, variables),
    promptKeywords: promptKeywordPlan.promptKeywords,
  }
}

export type BucketType = 'A' | 'B' | 'C' | 'D' | 'S'

/**
 * 🆕 v4.16: 根据 bucket 和链接类型获取对应的 theme 描述
 *
 * @param bucket - 创意类型（A/B/C/D/S，运行时归一化为 A/B/D）
 * @param linkType - 链接类型（'product' | 'store'）
 * @returns theme 描述字符串
 */
export function getThemeByBucket(bucket: BucketType, linkType: 'product' | 'store'): string {
  const normalizedBucket: 'A' | 'B' | 'D' = bucket === 'C' ? 'B' : bucket === 'S' ? 'D' : bucket as 'A' | 'B' | 'D'
  if (linkType === 'store') {
    const themes: Record<'A' | 'B' | 'D', string> = {
      'A': '品牌意图导向 - 广告语和关键词必须同时关联品牌与真实商品集合',
      'B': '热门商品型号/产品族意图导向 - 聚焦店铺热门商品型号/产品族，关键词统一完全匹配',
      'D': '商品需求意图导向 - 聚焦品牌下商品需求、功能、场景和产品线覆盖',
    }
    return themes[normalizedBucket]
  } else {
    const themes: Record<'A' | 'B' | 'D', string> = {
      'A': '品牌意图导向 - 广告语和关键词必须同时关联品牌与当前商品',
      'B': '商品型号/产品族意图导向 - 聚焦当前商品型号/产品族，关键词统一完全匹配',
      'D': '商品需求意图导向 - 聚焦品牌下商品需求、功能、场景和产品线覆盖',
    }
    return themes[normalizedBucket]
  }
}

/**
 * Helper functions to build dynamic guidance sections
 */
function buildHeadlineBrandGuidance(badge: string | null, featuredSalesRank: string | null, offer: any, hotInsights: any, topProducts: string[], sentimentDistribution: any, averageRating: number): string {
  const rankHint = featuredSalesRank
    ? `Optional social proof: use SALES RANK only when truly top-tier (e.g., "${featuredSalesRank}")`
    : 'Do NOT invent ranking claims such as "#1" or "Best Seller" without strong evidence'
  return `- Brand (2): ${badge ? `🎯 **P3 CRITICAL - MUST use complete BADGE text**: "${badge}" (e.g., "${badge} | ${offer.brand}", "${badge} - Trusted Quality")` : '"Trusted Brand"'}, ${rankHint}${hotInsights && topProducts.length > 0 ? `. **STORE SPECIAL**: For stores with hot products, create "Best Seller Collection" headlines featuring top products (e.g., "Best ${topProducts[0]?.split(' ').slice(0, 2).join(' ')} Collection")` : ''}${sentimentDistribution && sentimentDistribution.positive >= 80 ? `. **SOCIAL PROOF**: Use review-backed trust phrasing like "Highly Rated by Customers"${averageRating ? `, "Rated ${averageRating} Stars"` : ''}. Avoid "% of people" claims.` : ''}
  * IMPORTANT: Make these 2 brand headlines COMPLETELY DIFFERENT in focus and wording
  * Focus on trust signals, quality, reliability, or unique brand strengths — derived from actual product data
  * ❌ AVOID: "official", "store", "shop" in any brand headline
`
}

function buildHeadlineFeatureGuidance(technicalDetails: Record<string, string>, reviewHighlights: string[], commonPraises: string[], topPositiveKeywords: Array<{keyword: string; frequency: number}>, productFeatures: string[] = []): string {
  // 🔥 2025-12-10优化：整合productFeatures到guidance中
  const featureExamples = productFeatures.length > 0
    ? `\n  * **SCRAPED FEATURES** (use these for authentic headlines): ${productFeatures.slice(0, 3).map(f => `"${f.substring(0, 30)}..."`).join(', ')}`
    : ''
  return `- Feature (4): ${Object.keys(technicalDetails).length > 0 ? 'Use SPECS data for technical features' : 'Core product benefits'}${reviewHighlights.length > 0 ? `, incorporate REVIEW INSIGHTS (e.g., "${reviewHighlights[0]}")` : ''}${commonPraises.length > 0 ? `. **USER PRAISES**: Use authentic features: ${commonPraises.slice(0, 2).join(', ')}` : ''}${topPositiveKeywords.length > 0 ? `. **POSITIVE KEYWORDS**: Incorporate high-frequency praise words: ${topPositiveKeywords.slice(0, 3).map(k => k.keyword).join(', ')}` : ''}${featureExamples}
  * IMPORTANT: Each of the 4 feature headlines must focus on a DIFFERENT feature or benefit
  * Example 1: "4K Resolution Display" (technical spec)
  * Example 2: "Extended Battery Life" (performance benefit)
  * Example 3: "Smart Navigation System" (functionality)
  * Example 4: "Eco-Friendly Design" (sustainability)
  * ❌ AVOID: "4K Display", "4K Resolution", "High Resolution" (too similar)
`
}

function buildHeadlinePromoGuidance(
  discount: string | null,
  activePromotions: any[],
  hasPromoEvidence: boolean,
  priceEvidenceBlocked: boolean = false
): string {
  if (priceEvidenceBlocked) {
    return `- Promo (3): ⚠️ PRICE SAFETY OVERRIDE: Conflicting price signals detected.
  * Do NOT mention any exact price amount (e.g., "$37.95", "$369.99", "Only $X").
  * You may use verified promotion wording without explicit price amounts.
  * Prefer non-numeric value messaging (e.g., "Smart Value", "Quality Choice", "Shop Official Store").`
  }

  // 🔥 修复（2026-02-04）：无证据时禁止要求量化优惠，避免与Evidence-Only冲突
  if (!hasPromoEvidence) {
    return `- Promo (3): If there is NO verified promo/price evidence, do NOT mention discounts, prices, or savings.
  * Use value-focused, non-numeric wording only (e.g., "Smart Value Picks", "Quality That Lasts", "Designed for Modern Homes")`
  }

  let promoGuidance = ''

  if (discount) {
    const hasPercent = /\d+%/.test(discount)
    const hasAmount = /[£$€]\s*\d+|\d+\s*(?:USD|GBP|EUR)/i.test(discount)

    promoGuidance = `- Promo (3): 🎯 **P0 CRITICAL**: Use ONLY VERIFIED savings/price data
  * ✅ Use the exact amount/price/percent from VERIFIED FACTS. Do NOT estimate or invent.`
    if (hasAmount) {
      promoGuidance += `
  * ✅ Examples (amount verified):
  *   - "Save £170 Today"
  *   - "Only £499 - Save £170"
  *   - "Was £669, Now £499"`
    }
    if (hasPercent) {
      promoGuidance += `
  * ✅ Examples (percent verified):
  *   - "20% Off Today"
  *   - "Save 20% This Week"`
    }
    promoGuidance += `
  * ❌ Avoid: inventing amounts not in VERIFIED FACTS`
  } else if (activePromotions.length > 0) {
    promoGuidance = `- Promo (3): 🎯 **P0 CRITICAL**: Use ONLY VERIFIED promotion wording
  * Example: "${activePromotions[0].description}" (verbatim or shortened)
  * If the promotion text includes numbers/discounts, you may use them. Otherwise, avoid adding numbers.`
  } else {
    promoGuidance = `- Promo (3): Use ONLY VERIFIED price info (if available). Avoid any invented discounts or numbers.`
  }

  promoGuidance += `
  * IMPORTANT: Each promo headline must use a DIFFERENT promotional angle
  * ✅ Different angles:
  *   - Verified savings/price angle (if available)
  *   - Verified price anchoring (if available)
  *   - Value-focused angle (non-numeric if needed)
  * ❌ Too similar (avoid): same wording with only tiny changes`

  return promoGuidance
}

function buildHeadlineCTAGuidance(primeEligible: boolean, purchaseReasons: string[]): string {
  return `- CTA (3): "Shop Now", "Get Yours Today"${primeEligible ? ', "Prime Eligible"' : ''}${purchaseReasons.length > 0 ? `. **WHY BUY**: Incorporate purchase motivations: ${purchaseReasons.slice(0, 2).join(', ')}` : ''}
  * IMPORTANT: Each CTA headline must use a DIFFERENT call-to-action verb or angle
  * Example 1: "Shop Now" (direct action)
  * Example 2: "Get Yours Today" (possession focus)
  * Example 3: "Claim Your Deal" (exclusivity focus)
  * ❌ AVOID: "Shop Now", "Shop Today", "Buy Now" (too similar)
`
}

function buildHeadlineUrgencyGuidance(availability: string | null, hasUrgencyEvidence: boolean): string {
  let urgencyText = ''
  let isCritical = false

  if (availability) {
    const stockMatch = availability.match(/(\d+)\s*left/i)
    if (stockMatch) {
      const stockLevel = parseInt(stockMatch[1])
      if (stockLevel < 10) {
        urgencyText = `🎯 **P1 CRITICAL - MUST use real STOCK data**: "${availability}" (Low stock detected: ${stockLevel} units)`
        isCritical = true
      }
    }
    if (!isCritical) {
      const lowStockKeywords = ['low stock', 'limited quantity', 'almost gone', 'running low', 'few left']
      const hasLowStockKeyword = lowStockKeywords.some(kw => availability.toLowerCase().includes(kw))
      if (hasLowStockKeyword) {
        urgencyText = `🎯 **P1 CRITICAL - MUST use URGENCY**: "${availability}" or "Limited Stock - Act Fast"`
        isCritical = true
      }
    }
  }

  if (!urgencyText) {
    if (hasUrgencyEvidence) {
      urgencyText = `Use ONLY verified urgency evidence (stock/expiry) from VERIFIED FACTS or PROMOTION.`
    } else {
      urgencyText = `No verified urgency evidence. DO NOT use time/stock/limited claims.`
    }
  }

  return `- Urgency (0-3): ${urgencyText}
  * If verified stock/expiry evidence exists, include 1-2 urgency headlines using those exact facts.
  * If no verified evidence, skip urgency headlines and use neutral CTAs instead.
  * ❌ AVOID: unverified time/stock claims ("Limited Time", "Ends Soon", "Only X Left")`
}

function buildDescription1Guidance(badge: string | null, featuredSalesRank: string | null): string {
  return `- **Description 1 (Value-Driven)**: Lead with the PRIMARY benefit or competitive advantage${badge ? `. Optionally mention BADGE: "${badge}" if natural` : ''}${featuredSalesRank ? `. Optional social proof: mention SALES RANK "${featuredSalesRank}" at most once` : `. Do NOT add ranking numbers or "Best Seller" claims without strong evidence`}
  * Focus: What makes this product/brand special (unique value proposition)
  * Example: "Premium design. Built for everyday comfort."
  * ❌ AVOID: Repeating "shop", "buy", "get" from other descriptions
`
}

function buildDescription2Guidance(primeEligible: boolean, activePromotions: any[]): string {
  return `- **Description 2 (Action-Oriented)**: Strong CTA with immediate incentive${primeEligible ? ' + Prime eligibility' : ''}${activePromotions.length > 0 ? `. 🎯 **P2 CRITICAL**: MUST mention promotion "${activePromotions[0].description}"${activePromotions[0].code ? ` with code "${activePromotions[0].code}"` : ''}. Example: "Save ${activePromotions[0].description} - Shop Now!"` : ''}
  * Focus: Urgency + convenience + trust signal (action-focused)
  * Example: "Shop now for refined design. Order today."
  * ❌ AVOID: Using the same CTA verb as Description 1 or 3
`
}

function buildDescription3Guidance(useCases: string[], userProfiles: Array<{profile: string; indicators?: string[]}>): string {
  return `- **Description 3 (Feature-Rich)**: Specific product features or use cases${useCases.length > 0 ? `. **USE CASES**: Reference real scenarios: ${useCases.slice(0, 2).join(', ')}` : ''}${userProfiles.length > 0 ? `. **TARGET PERSONAS**: Speak to: ${userProfiles.slice(0, 2).map(p => p.profile).join(', ')}` : ''}
  * Focus: Technical specs, capabilities, or versatility (feature-focused)
  * Example: "Sleek finishes. Smart storage. Designed for modern homes."
  * ❌ AVOID: Mentioning "award", "rated", "trusted" from other descriptions
`
}

function buildDescription4Guidance(topReviews: string[], hotInsights: any, topProducts: string[], sentimentDistribution: any, totalReviews: number, averageRating: number): string {
  return `- **Description 4 (Trust + Social Proof)**: Customer validation or support${topReviews.length > 0 ? `. 🎯 **P0 OPTIMIZATION - TOP REVIEWS**: Prefer concise, policy-safe review-backed phrasing (quote or paraphrase): ${topReviews.slice(0, 2).map(r => `"${r.length > 50 ? r.substring(0, 47) + '...' : r}"`).join(' or ')}` : ''}${hotInsights && topProducts.length > 0 ? `. **STORE SPECIAL**: Mention product variety and quality (Avg: ${hotInsights.avgRating.toFixed(1)} stars from ${hotInsights.avgReviews}+ reviews)` : ''}${sentimentDistribution && totalReviews > 0 ? `. **SOCIAL PROOF DATA**: Strong positive review sentiment from ${totalReviews} reviews${averageRating ? `, ${averageRating} stars` : ''}. Avoid "% of people" claims.` : ''}
  * 🎯 **P0 CRITICAL**: If TOP REVIEWS available, use clean and trustworthy wording; avoid slang/colloquial quotes
  * Focus: Reviews, ratings, guarantees, customer service (proof-focused)
  * Example with review: "Works perfectly!" - Customer Review. Shop with confidence.
  * Example without review: "Trusted for quality and style. Learn more today."
  * ❌ AVOID: Repeating "fast", "free", "easy" from other descriptions
`
}

function buildReviewDataSummary(
  reviewHighlights: string[],
  commonPraises: string[],
  topPositiveKeywords: Array<{keyword: string; frequency: number}>,
  commonPainPoints: string[],
  aiReviews?: any
): string {
  const parts: string[] = []

  // 🎯 P0优化：优先使用AI增强的评论数据
  if (aiReviews) {
    if (aiReviews.rating) {
      parts.push(`AI分析评分: ${aiReviews.rating}/5.0`)
    }
    if (aiReviews.sentiment) {
      parts.push(`用户情感倾向: ${aiReviews.sentiment}`)
    }
    if (aiReviews.positives && aiReviews.positives.length > 0) {
      parts.push(`用户好评要点: ${aiReviews.positives.slice(0, 3).join(', ')}`)
    }
    if (aiReviews.concerns && aiReviews.concerns.length > 0) {
      parts.push(`用户关注点: ${aiReviews.concerns.slice(0, 2).join(', ')}`)
    }
    if (aiReviews.useCases && aiReviews.useCases.length > 0) {
      parts.push(`主要使用场景: ${aiReviews.useCases.slice(0, 2).join(', ')}`)
    }
  }

  // Fallback到原有数据（向后兼容）
  if (reviewHighlights.length > 0) parts.push(`Review insights: ${reviewHighlights.slice(0, 3).join(', ')}`)
  if (commonPraises.length > 0) parts.push(`User praises: ${commonPraises.slice(0, 2).join(', ')}`)
  if (topPositiveKeywords.length > 0) parts.push(`Positive keywords: ${topPositiveKeywords.slice(0, 3).map(k => k.keyword).join(', ')}`)
  if (commonPainPoints.length > 0) parts.push(`(Address pain points indirectly - don't highlight negatives): ${commonPainPoints.slice(0, 2).join(', ')}`)

  return parts.length > 0 ? parts.join('; ') : ''
}

function buildCalloutGuidance(salesRank: string | null, primeEligible: boolean, availability: string | null, badge: string | null, activePromotions: any[], hasVerifiedFacts: boolean): string {
  const parts: string[] = []

  if (salesRank) {
    const rankMatch = salesRank.match(/#(\d+,?\d*)/)
    if (rankMatch) {
      const rankNum = parseInt(rankMatch[1].replace(/,/g, ''))
      if (rankNum < 100) {
        parts.push(`- 🎯 **P0 CRITICAL - MUST include**: "Best Seller" or "#1 in Category" or "Top Rated" (salesRank ${salesRank} indicates top product)`)
      }
    }
  }

  if (primeEligible) {
    parts.push('- **MUST include**: "Prime Free Shipping"')
  }

  if (availability && !availability.toLowerCase().includes('out of stock')) {
    parts.push('- **MUST include**: "In Stock Now"')
  }

  if (badge) {
    parts.push(`- 🎯 **P3 CRITICAL - MUST include**: "${badge}"`)
  }

  if (activePromotions.length > 0) {
    parts.push(`- 🎯 **P2 CRITICAL - MUST include**: Promotion callout (e.g., "${activePromotions[0].description.substring(0, 22)}..." or "Limited Deal")`)
  }

  if (!hasVerifiedFacts) {
    parts.push('- ⚠️ No verified facts: avoid numbers, discounts, guarantees, shipping promises, or time claims.')
  }

  parts.push('- Safe alternatives (non-numeric): "Modern Designs", "Curated Collections", "Quality Materials", "Shop New Arrivals", "Easy Browsing", "Top Rated Products"')

  return parts.join('\n')
}

function buildCompetitiveGuidance(compAnalysis: any): string {
  let guidance = '\n**🎯 COMPETITIVE POSITIONING GUIDANCE (CRITICAL - Use competitor analysis data)**:\n'

  if (compAnalysis.pricePosition && compAnalysis.pricePosition.priceAdvantage === 'below_average') {
    guidance += `- **PRICE ADVANTAGE**: Emphasize value and affordability. Use phrases like "Best Value", "Affordable Premium", "Save vs Competitors"\n`
  }

  if (compAnalysis.uniqueSellingPoints && compAnalysis.uniqueSellingPoints.length > 0) {
    const usps = compAnalysis.uniqueSellingPoints.filter((u: any) => u.significance === 'high')
    if (usps.length > 0) {
      guidance += `- **UNIQUE ADVANTAGES**: Highlight these differentiators that competitors DON'T have:\n`
      usps.forEach((u: any) => {
        guidance += `  * "${u.usp}" - ${u.differentiator}\n`
      })
    }
  }

  if (compAnalysis.competitorAdvantages && compAnalysis.competitorAdvantages.length > 0) {
    guidance += `- **COUNTER COMPETITOR STRENGTHS**: Apply these positioning strategies:\n`
    compAnalysis.competitorAdvantages.slice(0, 2).forEach((a: any) => {
      guidance += `  * vs "${a.advantage}" → ${a.howToCounter}\n`
    })
  }

  if (compAnalysis.featureComparison) {
    const ourAdvantages = compAnalysis.featureComparison.filter((f: any) => f.weHave && f.ourAdvantage)
    if (ourAdvantages.length > 0) {
      guidance += `- **COMPETITIVE FEATURES**: Emphasize these features where we lead:\n`
      ourAdvantages.slice(0, 3).forEach((f: any) => {
        guidance += `  * ${f.feature}\n`
      })
    }
  }

  return guidance
}

/**
 * Substitute placeholders in template with actual values
 */
function substitutePlaceholders(template: string, variables: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`
    result = result.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value)
  }
  return result
}

/**
 * 规范化非ASCII数字为ASCII数字
 * 将Bengali、Arabic、Devanagari等语言的数字转换为ASCII 0-9
 */
function normalizeDigits(text: string): string {
  // 映射：非ASCII数字 → ASCII数字
  const digitMap: Record<string, string> = {
    // Bengali digits (০-৯)
    '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
    '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
    // Arabic-Indic digits (٠-٩)
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
    // Persian/Extended Arabic-Indic digits (۰-۹)
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
    '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
    // Devanagari digits (०-९)
    '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
    '५': '5', '६': '6', '७': '7', '८': '8', '९': '9'
  }

  let normalized = text
  for (const [nonAscii, ascii] of Object.entries(digitMap)) {
    normalized = normalized.replace(new RegExp(nonAscii, 'g'), ascii)
  }
  return normalized
}

function sanitizeJsonText(text: string): string {
  let jsonText = text.trim()

  // Remove trailing commas in arrays/objects.
  jsonText = jsonText.replace(/,\s*([}\]])/g, '$1')
  // Replace smart quotes with ASCII quotes.
  jsonText = jsonText.replace(/[“”]/g, '"')
  jsonText = jsonText.replace(/[‘’]/g, "'")
  // Remove stray debug identifiers between array items.
  jsonText = jsonText.replace(/],\s*[A-Z_]+\s*\n\s*"/g, '],\n  "')
  // Remove newlines inside string values while keeping structure.
  jsonText = jsonText.replace(/([a-zA-Z,.])\s*\n\s*([a-zA-Z])/g, '$1 $2')
  // Normalize non-ASCII digits to ASCII.
  jsonText = normalizeDigits(jsonText)
  // Remove _comment fields added by AI.
  jsonText = jsonText.replace(/,\s*_comment\s*:\s*["'][^"']*["']\s*,/g, ',')
  jsonText = jsonText.replace(/,\s*_comment\s*:\s*["'][^"']*["']/g, '')
  jsonText = jsonText.replace(/_comment\s*:\s*["'][^"']*["']\s*,/g, '')
  // Clean up duplicate commas or commas next to brackets.
  jsonText = jsonText.replace(/,\s*,/g, ',')
  jsonText = jsonText.replace(/([{\[]),/g, '$1')
  jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1')
  // Fix common invalid assignment operators.
  jsonText = jsonText.replace(/:\s*=/g, ':')
  jsonText = jsonText.replace(/=\s*:/g, ':')

  return repairJsonText(jsonText).trim()
}

function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = []
  const stack: string[] = []
  let startIndex = -1
  let inString: '"' | null = null
  let escape = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]

    if (escape) {
      escape = false
      continue
    }

    if (inString) {
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === inString) {
        inString = null
      }
      continue
    }

    if (ch === '"') {
      inString = ch
      continue
    }

    if (ch === '{' || ch === '[') {
      if (stack.length === 0) {
        startIndex = i
      }
      stack.push(ch)
      continue
    }

    if (ch === '}' || ch === ']') {
      if (stack.length === 0) {
        continue
      }

      const open = stack[stack.length - 1]
      const matches = (open === '{' && ch === '}') || (open === '[' && ch === ']')
      if (!matches) {
        continue
      }

      stack.pop()
      if (stack.length === 0 && startIndex !== -1) {
        candidates.push(text.slice(startIndex, i + 1))
        startIndex = -1
      }
    }
  }

  return candidates
}

function scoreAdCreativeCandidate(raw: any): number {
  if (!raw || typeof raw !== 'object') return 0

  const data = raw?.responsive_search_ads ?? raw?.responsiveSearchAds ?? raw
  if (!data || typeof data !== 'object') return 0

  let score = 0
  if (Array.isArray(data.headlines)) score += 3
  if (Array.isArray(data.descriptions)) score += 2
  if (Array.isArray(data.keywords)) score += 1
  if (Array.isArray(data.callouts)) score += 1
  if (Array.isArray(data.sitelinks)) score += 1

  return score
}

// Gemini official structured output only supports a conservative schema subset and
// may reject large or deeply nested schemas with INVALID_ARGUMENT. Keep the
// transport schema shallow and let the prompt + parseAIResponse enforce business
// counts/length limits and parse optional audit metadata when present.
export const AD_CREATIVE_RESPONSE_SCHEMA: ResponseSchema = {
  type: 'OBJECT',
  properties: {
    headlines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          type: {
            type: 'STRING',
            enum: ['brand', 'feature', 'promo', 'cta', 'urgency', 'social_proof', 'question', 'emotional']
          },
          length: { type: 'INTEGER' },
          group: { type: 'STRING' }
        },
        required: ['text']
      }
    },
    descriptions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          type: {
            type: 'STRING',
            enum: ['feature-benefit-cta', 'problem-solution-proof', 'offer-urgency-trust', 'usp-differentiation']
          },
          length: { type: 'INTEGER' },
          group: { type: 'STRING' }
        },
        required: ['text']
      }
    },
    keywords: {
      type: 'ARRAY',
      items: { type: 'STRING' }
    },
    callouts: {
      type: 'ARRAY',
      items: { type: 'STRING' }
    },
    sitelinks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          url: { type: 'STRING' },
          description: { type: 'STRING' }
        },
        required: ['text']
      }
    },
    path1: { type: 'STRING' },
    path2: { type: 'STRING' },
    theme: { type: 'STRING' },
    explanation: { type: 'STRING' },
    quality_metrics: {
      type: 'OBJECT',
      properties: {
        headline_diversity_score: { type: 'NUMBER' },
        keyword_relevance_score: { type: 'NUMBER' }
      }
    }
  },
  required: ['headlines', 'descriptions', 'keywords']
}

export const AD_CREATIVE_RETRY_RESPONSE_SCHEMA: ResponseSchema = {
  type: 'OBJECT',
  properties: {
    headlines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          type: {
            type: 'STRING',
            enum: ['brand', 'feature', 'promo', 'cta', 'urgency', 'social_proof', 'question', 'emotional']
          },
          length: { type: 'INTEGER' },
          group: { type: 'STRING' }
        },
        required: ['text']
      }
    },
    descriptions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          type: {
            type: 'STRING',
            enum: ['feature-benefit-cta', 'problem-solution-proof', 'offer-urgency-trust', 'usp-differentiation']
          },
          length: { type: 'INTEGER' },
          group: { type: 'STRING' }
        },
        required: ['text']
      }
    },
    keywords: {
      type: 'ARRAY',
      items: { type: 'STRING' }
    },
    callouts: {
      type: 'ARRAY',
      items: { type: 'STRING' }
    },
    sitelinks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          url: { type: 'STRING' },
          description: { type: 'STRING' }
        },
        required: ['text']
      }
    },
    path1: { type: 'STRING' },
    path2: { type: 'STRING' },
    theme: { type: 'STRING' }
  },
  required: ['headlines', 'descriptions', 'keywords']
}

export const AD_CREATIVE_EMERGENCY_RETRY_RESPONSE_SCHEMA: ResponseSchema = {
  type: 'OBJECT',
  properties: {
    headlines: {
      type: 'ARRAY',
      minItems: 15,
      maxItems: 15,
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          type: {
            type: 'STRING',
            enum: ['brand', 'feature', 'promo', 'cta', 'urgency', 'social_proof', 'question', 'emotional']
          },
        },
        required: ['text', 'type']
      }
    },
    descriptions: {
      type: 'ARRAY',
      minItems: 4,
      maxItems: 4,
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          type: {
            type: 'STRING',
            enum: ['feature-benefit-cta', 'problem-solution-proof', 'offer-urgency-trust', 'usp-differentiation']
          },
        },
        required: ['text', 'type']
      }
    },
    keywords: {
      type: 'ARRAY',
      minItems: 10,
      maxItems: 20,
      items: { type: 'STRING' }
    },
    callouts: {
      type: 'ARRAY',
      minItems: 6,
      maxItems: 6,
      items: { type: 'STRING' }
    },
    sitelinks: {
      type: 'ARRAY',
      minItems: 6,
      maxItems: 6,
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          url: { type: 'STRING' },
          description: { type: 'STRING' }
        },
        required: ['text', 'url']
      }
    },
  },
  required: ['headlines', 'descriptions', 'keywords', 'callouts', 'sitelinks']
}

const AD_CREATIVE_REQUIRED_COUNTS = {
  headlines: 15,
  descriptions: 4,
  callouts: 6,
  sitelinks: 6,
  keywordMin: 10,
  keywordMax: 20,
} as const

const AD_CREATIVE_SIMPLIFIED_RETRY_MAX_OUTPUT_TOKENS = 8192
const AD_CREATIVE_EMERGENCY_RETRY_TEMPERATURE = 0.2

type AdCreativeRetryMode = 'simplified' | 'emergency'
type AdCreativeRetryPlan = {
  mode: AdCreativeRetryMode
  reason: string
}

function createAdCreativeBusinessLimitsError(details: string[]): Error {
  const error: any = new Error(`广告创意业务约束未满足: ${details.join(', ')}`)
  error.code = 'AD_CREATIVE_BUSINESS_LIMITS'
  error.details = details
  return error
}

function isModelIntentTransactionalTemplateKeyword(keyword: string): boolean {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return false
  const hasModelAnchor = hasModelAnchorEvidence({ keywords: [normalized] })
  if (!hasModelAnchor) return false
  return MODEL_INTENT_TRANSACTIONAL_MODIFIER_PATTERN.test(normalized)
}

export function filterModelIntentGeneratedKeywords(
  creative: GeneratedAdCreativeData,
  bucket: NormalizedCreativeBucket
): GeneratedAdCreativeData {
  if (bucket !== 'B') return creative

  const originalKeywords = (creative.keywords || [])
    .map((keyword) => String(keyword || '').trim())
    .filter(Boolean)
  if (originalKeywords.length === 0) return creative

  const filteredKeywords = originalKeywords
    .filter((keyword) => !isModelIntentTransactionalTemplateKeyword(keyword))
  if (filteredKeywords.length === originalKeywords.length) return creative

  const removed = originalKeywords.length - filteredKeywords.length
  console.warn(`[AdCreative] model_intent 关键词生成过滤: 移除 ${removed} 个交易修饰词+型号锚点模板词`)

  return {
    ...creative,
    keywords: filteredKeywords,
  }
}

function normalizeBusinessLimitedStringArray(items: string[] | undefined, maxLength: number, limit: number): string[] {
  return (items || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((item) => item.substring(0, maxLength))
    .slice(0, limit)
}

export function validateGeneratedAdCreativeBusinessLimits(
  creative: GeneratedAdCreativeData
): GeneratedAdCreativeData {
  const headlines = normalizeBusinessLimitedStringArray(
    creative.headlines,
    30,
    AD_CREATIVE_REQUIRED_COUNTS.headlines
  )
  const descriptions = normalizeBusinessLimitedStringArray(
    creative.descriptions,
    90,
    AD_CREATIVE_REQUIRED_COUNTS.descriptions
  )
  const callouts = normalizeBusinessLimitedStringArray(
    creative.callouts,
    25,
    AD_CREATIVE_REQUIRED_COUNTS.callouts
  )

  const seenKeywords = new Set<string>()
  const keywords = (creative.keywords || [])
    .map((keyword) => String(keyword || '').trim())
    .filter(Boolean)
    .filter((keyword) => {
      const normalized = keyword.toLowerCase()
      if (seenKeywords.has(normalized)) return false
      seenKeywords.add(normalized)
      return true
    })
    .slice(0, AD_CREATIVE_REQUIRED_COUNTS.keywordMax)

  const sitelinks = (creative.sitelinks || [])
    .map((raw) => {
      if (!raw) return null
      const text = String(raw.text || '').trim().substring(0, 25)
      const url = String(raw.url || '/').trim() || '/'
      const description = typeof raw.description === 'string'
        ? raw.description.trim().substring(0, 35)
        : undefined
      if (!text) return null
      return { text, url, description }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, AD_CREATIVE_REQUIRED_COUNTS.sitelinks)

  const details: string[] = []
  if (headlines.length < AD_CREATIVE_REQUIRED_COUNTS.headlines) {
    details.push(`headlines=${headlines.length}/${AD_CREATIVE_REQUIRED_COUNTS.headlines}`)
  }
  if (descriptions.length < AD_CREATIVE_REQUIRED_COUNTS.descriptions) {
    details.push(`descriptions=${descriptions.length}/${AD_CREATIVE_REQUIRED_COUNTS.descriptions}`)
  }
  if (keywords.length < AD_CREATIVE_REQUIRED_COUNTS.keywordMin) {
    details.push(`keywords=${keywords.length}/${AD_CREATIVE_REQUIRED_COUNTS.keywordMin}`)
  }
  if (callouts.length < AD_CREATIVE_REQUIRED_COUNTS.callouts) {
    details.push(`callouts=${callouts.length}/${AD_CREATIVE_REQUIRED_COUNTS.callouts}`)
  }
  if (sitelinks.length < AD_CREATIVE_REQUIRED_COUNTS.sitelinks) {
    details.push(`sitelinks=${sitelinks.length}/${AD_CREATIVE_REQUIRED_COUNTS.sitelinks}`)
  }

  if (details.length > 0) {
    throw createAdCreativeBusinessLimitsError(details)
  }

  return {
    ...creative,
    headlines,
    descriptions,
    keywords,
    callouts,
    sitelinks,
    theme: String(creative.theme || '通用广告').trim().substring(0, 60) || '通用广告',
    explanation: String(creative.explanation || '基于产品信息生成的广告创意').trim().substring(0, 180) || '基于产品信息生成的广告创意',
    path1: creative.path1 ? String(creative.path1).trim().substring(0, 15) : undefined,
    path2: creative.path2 ? String(creative.path2).trim().substring(0, 15) : undefined,
    headlinesWithMetadata: creative.headlinesWithMetadata?.slice(0, AD_CREATIVE_REQUIRED_COUNTS.headlines),
    descriptionsWithMetadata: creative.descriptionsWithMetadata?.slice(0, AD_CREATIVE_REQUIRED_COUNTS.descriptions),
  }
}

function shouldRetryAdCreativeWithSimplifiedPrompt(error: any, alreadySimplified: boolean): boolean {
  if (alreadySimplified) return false

  const message = String(error?.message || '')
  if (error?.code === 'MAX_TOKENS') return true
  if (error?.code === 'AD_CREATIVE_BUSINESS_LIMITS') return true
  if (message.includes('AI响应解析失败')) return true
  return false
}

export function resolveAdCreativeRetryPlan(error: any, alreadySimplified: boolean): AdCreativeRetryPlan | null {
  if (alreadySimplified) return null

  if (error?.code === 'MAX_TOKENS' && error?.isRunawayCandidate) {
    return {
      mode: 'emergency',
      reason: 'max_tokens_runaway',
    }
  }

  if (!shouldRetryAdCreativeWithSimplifiedPrompt(error, alreadySimplified)) {
    return null
  }

  return {
    mode: 'simplified',
    reason: String(error?.code || 'fallback_retry').toLowerCase(),
  }
}

export function buildSimplifiedAdCreativeRetryPrompt(prompt: string): string {
  const cutMarkers = [
    '## 输出（JSON only）',
    '## 📋 OUTPUT (JSON only, no markdown):',
    '## Structured Evidence Metadata (recommended)',
  ]
  let cutIndex = -1

  for (const marker of cutMarkers) {
    const markerIndex = prompt.indexOf(marker)
    if (markerIndex !== -1 && (cutIndex === -1 || markerIndex < cutIndex)) {
      cutIndex = markerIndex
    }
  }

  const preservedPrompt = (cutIndex === -1 ? prompt : prompt.slice(0, cutIndex)).trimEnd()
  return `${preservedPrompt}

## RETRY OVERRIDE (CRITICAL)
The previous attempt either exceeded the token budget or returned an incomplete asset set.
Ignore any earlier request for optional audit metadata, explanations, scoring blocks, or diagnostic fields.
If any earlier instruction conflicts with this section, this section wins.

Return ONLY one valid JSON object with these top-level fields:
{
  "headlines": [{"text": "...", "type": "...", "length": N}],
  "descriptions": [{"text": "...", "type": "...", "length": N}],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text": "...", "url": "/", "description": "..."}],
  "path1": "...",
  "path2": "...",
  "theme": "..."
}

Strict rules:
- EXACTLY 15 headlines, each <= 30 chars
- EXACTLY 4 descriptions, each <= 90 chars
- 10-20 keywords
- For model_intent output, never include transactional+model template keywords (no forms like "buy x200", "x200 price", "order gen 2")
- EXACTLY 6 callouts, each <= 25 chars
- EXACTLY 6 sitelinks, text <= 25 chars, description <= 35 chars
- Do NOT return copyAngle, keywordCandidates, evidenceProducts, cannotGenerateReason, explanation, quality_metrics, or any other metadata
- No markdown, no prose, no comments
- Stop immediately after the final closing brace`
}

export function buildEmergencyAdCreativeRetryPrompt(prompt: string): string {
  const simplifiedPrompt = buildSimplifiedAdCreativeRetryPrompt(prompt)
  return `${simplifiedPrompt}

## EMERGENCY OUTPUT CONTRACT (CRITICAL)
The previous attempt produced runaway output.
Return ONLY the five required top-level fields:
{
  "headlines": [{"text": "...", "type": "..."}],
  "descriptions": [{"text": "...", "type": "..."}],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text": "...", "url": "/", "description": "..."}]
}

Emergency rules:
- Use only the required properties shown above; omit length, group, theme, path1, path2, explanation, and every audit field
- Keep wording concise; do not restate instructions, verified facts, keyword plans, or reasoning
- Stop immediately after the final closing brace`
}

function selectBestJsonCandidate(text: string): string | null {
  const candidates = extractJsonCandidates(text)
  if (candidates.length === 0) return null

  let bestCandidate: string | null = null
  let bestScore = -1
  let bestLength = -1

  for (const candidate of candidates) {
    const cleaned = sanitizeJsonText(candidate)
    try {
      const parsed = JSON.parse(cleaned)
      const score = scoreAdCreativeCandidate(parsed)
      if (score > bestScore || (score === bestScore && cleaned.length > bestLength)) {
        bestCandidate = candidate
        bestScore = score
        bestLength = cleaned.length
      }
    } catch {
      // Ignore invalid JSON candidates.
    }
  }

  if (bestCandidate && bestScore > 0) {
    return bestCandidate
  }

  return null
}

/**
 * 解析AI响应
 */
export function parseAIResponse(
  text: string,
  options?: { policyGuardMode?: GoogleAdsPolicyGuardMode }
): GeneratedAdCreativeData {
  const policyGuardMode = resolveGoogleAdsPolicyGuardMode(options?.policyGuardMode)
  console.log('🔍 AI原始响应长度:', text.length)
  console.log('🔍 AI原始响应前500字符:', text.substring(0, 500))

  // 移除可能的markdown代码块标记
  let jsonText = text.trim()
  jsonText = jsonText
    .replace(/```json\s*/gi, '')
    .replace(/```javascript\s*/gi, '')
    .replace(/```\s*/g, '')
    .replace(/^json\s*/i, '')
    .trim()

  console.log('🔍 清理markdown后长度:', jsonText.length)
  console.log('🔍 清理markdown后前200字符:', jsonText.substring(0, 200))

  // 尝试提取JSON对象或数组（如果AI在JSON前后加了其他文本）
  // 优先使用候选扫描，避免误截取 {KeyWord:...} 这类内容
  const selectedCandidate = selectBestJsonCandidate(jsonText)
  if (selectedCandidate) {
    jsonText = selectedCandidate
    console.log('✅ 选择JSON候选片段，长度:', jsonText.length)
  } else {
    // 支持 { ... } 和 [ ... ] 两种格式
    const jsonObjectMatch = jsonText.match(/\{[\s\S]*\}/)
    const jsonArrayMatch = jsonText.match(/\[[\s\S]*\]/)

    if (jsonObjectMatch && jsonArrayMatch) {
      // 两者都存在时，选择更长的那个
      jsonText = jsonObjectMatch[0].length > jsonArrayMatch[0].length ? jsonObjectMatch[0] : jsonArrayMatch[0]
    } else if (jsonObjectMatch) {
      jsonText = jsonObjectMatch[0]
    } else if (jsonArrayMatch) {
      jsonText = jsonArrayMatch[0]
    } else {
      console.warn('⚠️ 未能通过正则提取JSON对象或数组')
    }

    if (jsonObjectMatch || jsonArrayMatch) {
      console.log('✅ 成功提取JSON，长度:', jsonText.length)
    }
  }

  // 清理提取后可能残留的markdown标记
  jsonText = jsonText.replace(/\n?```$/, '').trim()

  // 修复常见的JSON格式错误
  jsonText = sanitizeJsonText(jsonText)

  console.log('🔍 修复后JSON前200字符:', jsonText.substring(0, 200))

  try {
    const raw = JSON.parse(jsonText)
    const responsiveSearchAds =
      raw?.responsive_search_ads ??
      raw?.responsiveSearchAds

    // 🔧 兼容新格式：AI 可能返回 { responsive_search_ads: { ... } }
    // 旧解析器要求顶层字段 headlines/descriptions/keywords/callouts/sitelinks
    const data =
      responsiveSearchAds && typeof responsiveSearchAds === 'object'
        ? { ...raw, ...responsiveSearchAds }
        : raw

    const copyAngle = typeof data.copyAngle === 'string'
      ? data.copyAngle.trim()
      : typeof data.copy_angle === 'string'
        ? data.copy_angle.trim()
        : undefined
    const cannotGenerateReason = typeof data.cannotGenerateReason === 'string'
      ? data.cannotGenerateReason.trim()
      : typeof data.cannot_generate_reason === 'string'
        ? data.cannot_generate_reason.trim()
        : undefined
    const evidenceProducts = Array.isArray(data.evidenceProducts)
      ? data.evidenceProducts.map((item: any) => String(item || '').trim()).filter(Boolean).slice(0, 8)
      : Array.isArray(data.evidence_products)
        ? data.evidence_products.map((item: any) => String(item || '').trim()).filter(Boolean).slice(0, 8)
        : []
    const keywordCandidatesRaw: unknown[] = Array.isArray(data.keywordCandidates)
      ? data.keywordCandidates
      : Array.isArray(data.keyword_candidates)
        ? data.keyword_candidates
        : []
    const normalizeSuggestedMatchType = (
      value: unknown
    ): 'EXACT' | 'PHRASE' | 'BROAD' | undefined => {
      const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
      if (normalized === 'EXACT' || normalized === 'PHRASE' || normalized === 'BROAD') {
        return normalized
      }
      return undefined
    }
    const normalizeConfidence = (value: unknown): number | undefined => {
      const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
      return Number.isFinite(parsed) ? parsed : undefined
    }
    const normalizeDerivedTags = (value: unknown): string[] | undefined => {
      if (!Array.isArray(value)) return undefined
      const tags = Array.from(new Set(
        value
          .map((entry: any) => String(entry || '').trim())
          .filter(Boolean)
      )).slice(0, 8)
      return tags.length > 0 ? tags : undefined
    }
    const keywordCandidates: GeneratedKeywordCandidateMetadata[] = keywordCandidatesRaw
      .map((item: any): GeneratedKeywordCandidateMetadata | null => {
        if (!item || typeof item !== 'object') return null
        const candidateText = String(item.text || item.keyword || '').trim()
        if (!candidateText) return null
        return {
          text: candidateText,
          sourceType: typeof item.sourceType === 'string'
            ? item.sourceType.trim()
            : typeof item.source_type === 'string'
              ? item.source_type.trim()
              : undefined,
          sourceSubtype: typeof item.sourceSubtype === 'string'
            ? item.sourceSubtype.trim()
            : typeof item.source_subtype === 'string'
              ? item.source_subtype.trim()
              : undefined,
          rawSource: typeof item.rawSource === 'string'
            ? item.rawSource.trim()
            : typeof item.raw_source === 'string'
              ? item.raw_source.trim()
              : undefined,
          derivedTags: normalizeDerivedTags(item.derivedTags ?? item.derived_tags),
          sourceField: typeof item.sourceField === 'string'
            ? item.sourceField.trim()
            : typeof item.source_field === 'string'
              ? item.source_field.trim()
              : undefined,
          anchorType: typeof item.anchorType === 'string'
            ? item.anchorType.trim()
            : typeof item.anchor_type === 'string'
              ? item.anchor_type.trim()
              : undefined,
          evidence: Array.isArray(item.evidence)
            ? item.evidence.map((entry: any) => String(entry || '').trim()).filter(Boolean).slice(0, 6)
            : Array.isArray(item.evidence_list)
              ? item.evidence_list.map((entry: any) => String(entry || '').trim()).filter(Boolean).slice(0, 6)
              : undefined,
          suggestedMatchType: normalizeSuggestedMatchType(item.suggestedMatchType ?? item.suggested_match_type),
          confidence: normalizeConfidence(item.confidence),
          qualityReason: typeof item.qualityReason === 'string'
            ? item.qualityReason.trim()
            : typeof item.quality_reason === 'string'
              ? item.quality_reason.trim()
              : undefined,
          rejectionReason: typeof item.rejectionReason === 'string'
            ? item.rejectionReason.trim()
            : typeof item.rejection_reason === 'string'
              ? item.rejection_reason.trim()
              : undefined,
        }
      })
      .filter((item): item is GeneratedKeywordCandidateMetadata => item !== null)
      .slice(0, 20)

    if ((!data.headlines || !Array.isArray(data.headlines) || data.headlines.length < 3) && cannotGenerateReason) {
      throw new Error(cannotGenerateReason)
    }

    // 验证必需字段
    if (!data.headlines || !Array.isArray(data.headlines) || data.headlines.length < 3) {
      throw new Error('Headlines格式无效或数量不足')
    }

    if (!data.descriptions || !Array.isArray(data.descriptions) || data.descriptions.length < 2) {
      throw new Error('Descriptions格式无效或数量不足')
    }

    if (!data.keywords || !Array.isArray(data.keywords)) {
      throw new Error('Keywords格式无效')
    }

    // 处理headlines格式（支持新旧格式）
    let headlinesArray: string[]
    let headlinesWithMetadata: HeadlineAsset[] | undefined

    // 检测格式：第一个元素是string还是object
    const isNewFormat = data.headlines.length > 0 && typeof data.headlines[0] === 'object'

    if (isNewFormat) {
      // 新格式：对象数组（带metadata）
      headlinesWithMetadata = data.headlines as HeadlineAsset[]
      headlinesArray = headlinesWithMetadata.map(h => h.text)
      console.log('✅ 检测到新格式headlines（带metadata）')
    } else {
      // 旧格式：字符串数组
      headlinesArray = data.headlines as string[]
      console.log('✅ 检测到旧格式headlines（字符串数组）')
    }

    // 处理descriptions格式
    let descriptionsArray: string[]
    let descriptionsWithMetadata: DescriptionAsset[] | undefined

    const isDescNewFormat = data.descriptions.length > 0 && typeof data.descriptions[0] === 'object'

    if (isDescNewFormat) {
      descriptionsWithMetadata = data.descriptions as DescriptionAsset[]
      descriptionsArray = descriptionsWithMetadata.map(d => d.text)
      console.log('✅ 检测到新格式descriptions（带metadata）')
    } else {
      descriptionsArray = data.descriptions as string[]
      console.log('✅ 检测到旧格式descriptions（字符串数组）')
    }

    // 预先执行文本护栏（长度、断词、括号平衡）
    const headlineGuarded = headlinesArray.map((h: string) => applyHeadlineTextGuardrail(h, 30))
    const headlineGuardFixes = headlineGuarded.filter((h, idx) => h !== headlinesArray[idx]).length
    if (headlineGuardFixes > 0) {
      console.log(`🔧 Headline文本护栏: 修复 ${headlineGuardFixes} 条`)
    }
    headlinesArray = headlineGuarded
    if (headlinesWithMetadata) {
      headlinesWithMetadata = headlinesWithMetadata.map((h, idx) => ({
        ...h,
        text: headlinesArray[idx] || '',
        length: Math.min(30, (headlinesArray[idx] || '').length),
      }))
    }

    // 🔥 修复Ad Customizer标签格式（DKI语法验证）
    // 问题：AI可能生成 "{KeyWord:Text" 缺少结束符 "}"
    const fixDKISyntax = (text: string): string => {
      // 检测未闭合的 {KeyWord: 标签
      const unclosedPattern = /\{KeyWord:([^}]*?)$/i
      if (unclosedPattern.test(text)) {
        // 尝试修复：如果只是缺少结束符，添加它
        const match = text.match(unclosedPattern)
        if (match) {
          const defaultText = match[1].trim()
          // Google Ads headline限制30字符，DKI的defaultText也应支持到30字符
          if (defaultText.length > 0 && defaultText.length <= 30) {
            // 合理的默认文本长度，添加结束符
            console.log(`🔧 修复DKI标签: "${text}" → "${text}}"`)
            return text + '}'
          } else {
            // 默认文本过长或为空，移除整个DKI标签
            const fixedText = text.replace(unclosedPattern, match[1].trim() || '')
            console.log(`🔧 移除无效DKI标签（defaultText长度${defaultText.length}）: "${text}" → "${fixedText}"`)
            return fixedText
          }
        }
      }
      return text
    }

    // 🔥 过滤Google Ads禁止的符号（Policy Violation防御）
    const removeProhibitedSymbols = (text: string): string => {
      const { text: cleaned, removed } = sanitizeGoogleAdsSymbols(text)
      if (removed.length > 0) {
        console.log(`🛡️ 移除违规符号: "${text}" → "${cleaned}" (移除: ${removed.join(', ')})`)
      }
      return cleaned
    }

    const sanitizePolicySensitiveText = (text: string, maxLength: number): string => {
      const policySafe = sanitizeGoogleAdsPolicyText(text, { maxLength, mode: policyGuardMode })
      if (policySafe.changed) {
        console.log(`🛡️ 政策敏感词净化: "${text}" → "${policySafe.text}" (命中: ${policySafe.matchedTerms.join(', ')})`)
      }
      return policySafe.text
    }

    // 应用DKI修复到所有headlines
    const originalHeadlines = [...headlinesArray]
    headlinesArray = headlinesArray.map((h: string) => fixDKISyntax(h))
    const fixedCount = headlinesArray.filter((h: string, i: number) => h !== originalHeadlines[i]).length
    if (fixedCount > 0) {
      console.log(`✅ 修复了${fixedCount}个DKI标签格式问题`)
    }

    // 🔥 新增：应用符号过滤到所有headlines和descriptions
    headlinesArray = headlinesArray.map((h: string) => removeProhibitedSymbols(h))
    descriptionsArray = descriptionsArray.map((d: string) => removeProhibitedSymbols(d))
    headlinesArray = headlinesArray.map((h: string) => sanitizePolicySensitiveText(h, 30))
    descriptionsArray = descriptionsArray.map((d: string) => sanitizePolicySensitiveText(d, 90))

    // 兜底：政策净化后再次执行文本护栏，确保无断词断句
    const headlineGuardedAfterPolicy = headlinesArray.map((h: string) => applyHeadlineTextGuardrail(h, 30))
    const descriptionGuardedAfterPolicy = descriptionsArray.map((d: string) => applyDescriptionTextGuardrail(d, 90))
    const headlineGuardFixesAfterPolicy = headlineGuardedAfterPolicy.filter((h, idx) => h !== headlinesArray[idx]).length
    const descriptionGuardFixesAfterPolicy = descriptionGuardedAfterPolicy.filter((d, idx) => d !== descriptionsArray[idx]).length
    if (headlineGuardFixesAfterPolicy > 0 || descriptionGuardFixesAfterPolicy > 0) {
      console.log(
        `🔧 文本护栏(政策后): headlines ${headlineGuardFixesAfterPolicy} 条, descriptions ${descriptionGuardFixesAfterPolicy} 条`
      )
    }
    headlinesArray = headlineGuardedAfterPolicy
    descriptionsArray = descriptionGuardedAfterPolicy

    if (headlinesWithMetadata) {
      headlinesWithMetadata = headlinesWithMetadata.map((h, idx) => ({
        ...h,
        text: headlinesArray[idx] || '',
        length: Math.min(30, (headlinesArray[idx] || '').length),
      }))
    }

    if (descriptionsWithMetadata) {
      descriptionsWithMetadata = descriptionsWithMetadata.map((d, idx) => ({
        ...d,
        text: descriptionsArray[idx] || '',
        length: Math.min(90, (descriptionsArray[idx] || '').length),
      }))
    }

    // ============================================================================
    // Google Ads RSA 数量上限防御（Headlines ≤15, Descriptions ≤4）
    // ============================================================================
    if (headlinesArray.length > 15) {
      console.warn(`⚠️ headlines 超过15个（${headlinesArray.length}），已截断为15个`)
      headlinesArray = headlinesArray.slice(0, 15)
      if (headlinesWithMetadata) {
        headlinesWithMetadata = headlinesWithMetadata.slice(0, 15)
      }
    }

    if (descriptionsArray.length > 4) {
      console.warn(`⚠️ descriptions 超过4个（${descriptionsArray.length}），已截断为4个`)
      descriptionsArray = descriptionsArray.slice(0, 4)
      if (descriptionsWithMetadata) {
        descriptionsWithMetadata = descriptionsWithMetadata.slice(0, 4)
      }
    }

    // 🔧 全大写检测工具函数（Google Ads 会因 excessive capitalization 拒登）
    const isExcessiveCaps = (s: string): boolean => {
      const letters = s.replace(/[^a-zA-Z]/g, '')
      return letters.length >= 3 && letters === letters.toUpperCase()
    }
    const toTitleCase = (s: string): string => {
      return s.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase())
    }

    // ============================================================================
    // 验证 Callouts 长度 (≤25 字符)
    // ============================================================================
    let calloutsArray = Array.isArray(data.callouts) ? data.callouts : []
    const invalidCallouts = calloutsArray.filter((c: string) => c && c.length > 25)
    if (invalidCallouts.length > 0) {
      console.warn(`警告: ${invalidCallouts.length}个callout超过25字符限制`)
      console.warn(`  超长callouts: ${invalidCallouts.map((c: string) => `"${c}"(${c.length}字符)`).join(', ')}`)
      // 截断过长的callouts
      calloutsArray = calloutsArray.map((c: string) => {
        if (c && c.length > 25) {
          const truncated = c.substring(0, 25)
          console.warn(`  截断: "${c}" → "${truncated}"`)
          return truncated
        }
        return c
      })
    }
    calloutsArray = calloutsArray.map((c: string) => sanitizePolicySensitiveText(String(c || ''), 25))

    // 🔧 修复：检测并修正全大写的 callout 文案（与 sitelink 同理）
    calloutsArray = calloutsArray.map((c: string) => {
      if (typeof c === 'string' && isExcessiveCaps(c)) {
        const fixed = toTitleCase(c)
        console.log(`🔧 修正全大写callout: "${c}" → "${fixed}"`)
        return fixed
      }
      return c
    })

    // ============================================================================
    // 验证 Sitelinks 长度 (text≤25, desc≤35)
    // ============================================================================
    let sitelinksArray = Array.isArray(data.sitelinks) ? data.sitelinks : []

    // 兼容：AI 有时会输出 description1/description2 或 description_1/description_2
    // 统一归一为 { text, url, description? }，以匹配前端 & 数据库约定
    const normalizeSitelink = (raw: any) => {
      if (!raw) return null

      // 兼容：旧数据可能是 string 数组
      if (typeof raw === 'string') {
        const text = sanitizePolicySensitiveText(removeProhibitedSymbols(raw).trim(), 25)
        if (!text) return null
        return { text, url: '/', description: undefined as string | undefined }
      }

      if (typeof raw !== 'object') return null

      const textRaw =
        (typeof raw.text === 'string' && raw.text) ||
        (typeof (raw as any).title === 'string' && (raw as any).title) ||
        ''
      const text = sanitizePolicySensitiveText(removeProhibitedSymbols(textRaw).trim(), 25)
      if (!text) return null

      const urlRaw = typeof raw.url === 'string' ? raw.url : '/'
      const url = String(urlRaw).trim() || '/'

      const descriptionCandidates = [
        raw.description,
        (raw as any).desc,
        (raw as any).description1,
        (raw as any).description_1,
        (raw as any).description2,
        (raw as any).description_2,
        Array.isArray((raw as any).descriptions) ? (raw as any).descriptions[0] : undefined,
      ]
      const descriptionValue = descriptionCandidates.find(
        (v: any) => typeof v === 'string' && v.trim().length > 0
      ) as string | undefined
      const description = descriptionValue
        ? sanitizePolicySensitiveText(removeProhibitedSymbols(descriptionValue).trim(), 35)
        : undefined

      return { text, url, description }
    }

    sitelinksArray = sitelinksArray
      .map(normalizeSitelink)
      .filter((v: any) => v !== null)

    // 🔧 修复：检测并修正全大写的 sitelink 文案
    sitelinksArray = sitelinksArray.map((s: any) => {
      if (!s) return s
      let changed = false
      let text = s.text
      let description = s.description
      if (typeof text === 'string' && isExcessiveCaps(text)) {
        text = toTitleCase(text)
        changed = true
      }
      if (typeof description === 'string' && isExcessiveCaps(description)) {
        description = toTitleCase(description)
        changed = true
      }
      if (changed) {
        console.log(`🔧 修正全大写sitelink: "${s.text}" → "${text}"`)
      }
      return changed ? { ...s, text, description } : s
    })

    const invalidSitelinks = sitelinksArray.filter((s: any) =>
      s && (s.text?.length > 25 || s.description?.length > 35)
    )
    if (invalidSitelinks.length > 0) {
      // 理论上已在 normalize 中截断，这里仅用于兜底日志
      console.warn(`警告: ${invalidSitelinks.length}个sitelink超过长度限制（将自动截断）`)
      sitelinksArray = sitelinksArray.map((s: any) => {
        if (!s) return s
        return {
          ...s,
          text: typeof s.text === 'string' ? s.text.substring(0, 25) : s.text,
          description: typeof s.description === 'string' ? s.description.substring(0, 35) : s.description
        }
      })
    }

    // ============================================================================
    // 验证关键词长度 (1-10 个单词)
    // 🔧 修复(2025-12-25): 放宽到10个单词，符合Google Ads实际限制
    // Google Ads允许最多10个单词的关键词
    // ============================================================================
    let keywordsArray = Array.isArray(data.keywords) ? data.keywords.map((k: any) => String(k || '').trim()).filter(Boolean) : []
    const policySafeKeywords = sanitizeKeywordListForGoogleAdsPolicy(keywordsArray, { mode: policyGuardMode })
    if (policySafeKeywords.changedCount > 0 || policySafeKeywords.droppedCount > 0) {
      console.log(`🛡️ 关键词政策净化: 替换${policySafeKeywords.changedCount}个, 丢弃${policySafeKeywords.droppedCount}个`)
    }
    keywordsArray = policySafeKeywords.items
    const invalidKeywords = keywordsArray.filter((k: string) => {
      if (!k) return false
      const wordCount = k.trim().split(/\s+/).length
      return wordCount < 1 || wordCount > 10
    })
    if (invalidKeywords.length > 0) {
      console.warn(`警告: ${invalidKeywords.length}个keyword不符合1-10单词要求`)
      invalidKeywords.forEach((k: string) => {
        const wordCount = k.trim().split(/\s+/).length
        console.warn(`  "${k}"(${wordCount}个单词)`)
      })
      // 过滤不符合要求的关键词
      const originalCount = keywordsArray.length
      keywordsArray = keywordsArray.filter((k: string) => {
        if (!k) return false
        const wordCount = k.trim().split(/\s+/).length
        return wordCount >= 1 && wordCount <= 10
      })
      console.warn(`  长度过滤后: ${originalCount} → ${keywordsArray.length}个关键词`)
    }

    // 🔧 修复(2025-12-27): 关键词去重（AI可能生成重复关键词）
    const originalKeywordCount = keywordsArray.length
    const seenKeywords = new Set<string>()
    keywordsArray = keywordsArray.filter((k: string) => {
      const normalized = k.toLowerCase().trim()
      if (seenKeywords.has(normalized)) {
        return false
      }
      seenKeywords.add(normalized)
      return true
    })
    if (keywordsArray.length < originalKeywordCount) {
      console.warn(`⚠️ 关键词去重: ${originalKeywordCount} → ${keywordsArray.length}个关键词 (移除 ${originalKeywordCount - keywordsArray.length} 个重复)`)
    }

    // 解析quality_metrics（如果存在）
    const qualityMetrics = data.quality_metrics ? {
      headline_diversity_score: data.quality_metrics.headline_diversity_score,
      keyword_relevance_score: data.quality_metrics.keyword_relevance_score
    } : undefined

    if (qualityMetrics) {
      console.log('📊 Headline多样性:', qualityMetrics.headline_diversity_score)
      console.log('📊 关键词相关性:', qualityMetrics.keyword_relevance_score)
    }

    // 🆕 v4.7: 解析 Display Path (path1/path2)
    let path1: string | undefined = data.path1
    let path2: string | undefined = data.path2

    // 验证并截断 path1/path2 (最多15字符)
    if (path1 && path1.length > 15) {
      console.warn(`⚠️ path1 超过15字符限制: "${path1}" (${path1.length}字符)`)
      path1 = path1.substring(0, 15)
      console.log(`  截断为: "${path1}"`)
    }
    if (path2 && path2.length > 15) {
      console.warn(`⚠️ path2 超过15字符限制: "${path2}" (${path2.length}字符)`)
      path2 = path2.substring(0, 15)
      console.log(`  截断为: "${path2}"`)
    }

    // 移除path中的空格（Google Ads Display Path不允许空格）
    if (path1) {
      path1 = path1.replace(/\s+/g, '-')
    }
    if (path2) {
      path2 = path2.replace(/\s+/g, '-')
    }

    if (path1 || path2) {
      console.log(`📍 Display Path: ${path1 || '(无)'}/${path2 || '(无)'}`)
    }

    return {
      // 核心字段（向后兼容）
      headlines: headlinesArray,
      descriptions: descriptionsArray,
      keywords: keywordsArray, // 使用验证后的关键词
      callouts: calloutsArray, // 使用验证后的 callouts
      sitelinks: sitelinksArray, // 使用验证后的 sitelinks
      theme: data.theme || '通用广告',
      explanation: data.explanation || '基于产品信息生成的广告创意',

      // 🆕 v4.7: RSA Display Path
      path1,
      path2,

      // 新增字段（可选）
      copyAngle,
      evidenceProducts: evidenceProducts.length > 0 ? evidenceProducts : undefined,
      keywordCandidates: keywordCandidates.length > 0 ? keywordCandidates : undefined,
      cannotGenerateReason,
      headlinesWithMetadata,
      descriptionsWithMetadata,
      qualityMetrics
    }
  } catch (error) {
    console.error('解析AI响应失败:', error)
    console.error('原始响应前500字符:', text.substring(0, 500))
    console.error('提取JSON前1000字符:', jsonText.substring(0, 1000))
    console.error('提取JSON后500字符:', jsonText.substring(Math.max(0, jsonText.length - 500)))
    throw new Error(`AI响应解析失败: ${error instanceof Error ? error.message : '未知错误'}`)
  }
}

async function runAdCreativeModelAttempt(params: {
  userId: number
  prompt: string
  policyGuardMode: GoogleAdsPolicyGuardMode
  retryMode?: AdCreativeRetryMode
  bucket: NormalizedCreativeBucket
}): Promise<{
  aiResponse: Awaited<ReturnType<typeof generateContent>>
  result: GeneratedAdCreativeData
}> {
  const retryMode = params.retryMode
  const isSimplified = retryMode === 'simplified'
  const isEmergency = retryMode === 'emergency'
  const aiResponse = await generateContent({
    operationType: 'ad_creative_generation_main',
    prompt: params.prompt,
    temperature: isEmergency ? AD_CREATIVE_EMERGENCY_RETRY_TEMPERATURE : 0.7,
    maxOutputTokens: retryMode ? AD_CREATIVE_SIMPLIFIED_RETRY_MAX_OUTPUT_TOKENS : 16384,
    responseSchema: isEmergency
      ? AD_CREATIVE_EMERGENCY_RETRY_RESPONSE_SCHEMA
      : isSimplified
        ? AD_CREATIVE_RETRY_RESPONSE_SCHEMA
        : AD_CREATIVE_RESPONSE_SCHEMA,
    responseMimeType: 'application/json'
  }, params.userId)

  await recordAdCreativeOperationTokenUsage({
    userId: params.userId,
    operationType: isEmergency
      ? 'ad_creative_generation_retry_emergency'
      : isSimplified
        ? 'ad_creative_generation_retry_simplified'
        : 'ad_creative_generation_main',
    aiResponse
  })

  const parsed = parseAIResponse(aiResponse.text, { policyGuardMode: params.policyGuardMode })
  const modelFiltered = filterModelIntentGeneratedKeywords(parsed, params.bucket)
  const result = validateGeneratedAdCreativeBusinessLimits(modelFiltered)

  return { aiResponse, result }
}

/**
 * 主函数：生成广告创意（带缓存）
 *
 * ✅ 安全修复：userId改为必需参数，确保用户只能访问自己的Offer
 */
export async function generateAdCreative(
  offerId: number,
  userId: number,  // ✅ 修复：改为必需参数
  options?: {
    theme?: string
    referencePerformance?: any
    skipCache?: boolean
    excludeKeywords?: string[] // 需要排除的关键词（用于多次生成时避免重复）
    retryFailureType?: RetryFailureType
    searchTermFeedbackHints?: SearchTermFeedbackHintsInput
    policyGuardMode?: GoogleAdsPolicyGuardMode
    // 🆕 v4.10: 关键词池参数
    keywordPool?: any  // OfferKeywordPool
    bucket?: 'A' | 'B' | 'C' | 'S' | 'D'  // 🔥 2025-12-22: 添加D（高购买意图）桶支持
    bucketKeywords?: string[]
    bucketIntent?: string
    bucketIntentEn?: string
    deferKeywordSupplementation?: boolean
    deferKeywordPostProcessingToBuilder?: boolean
    precomputedKeywordSet?: PrecomputedCreativeKeywordSet | null
    // 内部 coverage 模式兼容参数（不代表第4种创意类型）
    isCoverageCreative?: boolean
    isSyntheticCreative?: boolean
    coverageKeywordsWithVolume?: Array<{ keyword: string; searchVolume: number; isBrand: boolean }>
    syntheticKeywordsWithVolume?: Array<{ keyword: string; searchVolume: number; isBrand: boolean }>
  }
): Promise<GeneratedAdCreativeData & { ai_model: string }> {
  const isCoverageCreative = Boolean(options?.isCoverageCreative || options?.isSyntheticCreative)

  // 生成缓存键
  const cacheKey = generateCreativeCacheKey(offerId, options)

  // 检查缓存（除非显式跳过）
  if (!options?.skipCache) {
    const cached = creativeCache.get(cacheKey)
    if (cached) {
      console.log('✅ 使用缓存的广告创意')
      console.log(`   - Cache Key: ${cacheKey}`)
      console.log(`   - Headlines: ${cached.headlines.length}个`)
      console.log(`   - Descriptions: ${cached.descriptions.length}个`)
      return cached
    }
  }

  const db = await getDatabase()

  // ✅ 安全修复：获取Offer数据时验证user_id，防止跨用户访问
  const offer = await db.queryOne(`
    SELECT * FROM offers WHERE id = ? AND user_id = ?
  `, [offerId, userId])

  if (!offer) {
    throw new Error('Offer不存在或无权访问')
  }

  // 🔒 前置数据质量校验（2026-01-26）：防止使用错误数据生成创意
  const preGenerationValidation = validateOfferDataQuality(offer as any)
  if (!preGenerationValidation.isValid) {
    console.error(`[generateAdCreative] ❌ 前置校验失败，阻止创意生成:`)
    preGenerationValidation.issues.forEach(issue => console.error(`   - ${issue}`))
    throw new Error(`创意生成前置校验失败: ${preGenerationValidation.issues.join('; ')}`)
  }

  const policyGuardMode = resolveGoogleAdsPolicyGuardMode(options?.policyGuardMode)
  console.log(`[PolicyGuard] 当前策略模式: ${policyGuardMode}`)
  const scrapedDataForOffer = safeParseJson((offer as any).scraped_data, null)
  const derivedOfferLinkType = deriveLinkTypeFromScrapedData(scrapedDataForOffer)
  const effectiveLinkType = (() => {
    const explicit = (offer as any).page_type as 'product' | 'store' | null
    if (explicit === 'store') return 'store'
    if (explicit === 'product') return derivedOfferLinkType === 'store' ? 'store' : 'product'
    return derivedOfferLinkType || 'product'
  })()
  const normalizedBucket = normalizeCreativeBucketType(options?.bucket || null)

  const offerBrand = (offer as { brand?: string }).brand || 'Unknown'
  const canonicalBrandKeyword = normalizeGoogleAdsKeyword(offerBrand)
  const pureBrandKeywordsList = getPureBrandKeywords(offerBrand)
  const brandTokensToMatch =
    pureBrandKeywordsList.length > 0
      ? pureBrandKeywordsList
      : (canonicalBrandKeyword ? [canonicalBrandKeyword] : [])
  const mustContainBrand = brandTokensToMatch.length > 0

  const containsBrand = (keyword: string, searchVolume?: number): boolean => {
    if (containsPureBrand(keyword, brandTokensToMatch)) return true
    // 🔥 修复(2026-03-13): 品牌拼接词即使搜索量为 0 也应该保留（真实品牌词）
    // 移除搜索量依赖，避免真实品牌词被意外过滤
    if (isBrandConcatenation(keyword, offerBrand)) return true
    return false
  }

  // 🎯 需求34: 读取已提取的广告元素（从爬虫阶段保存的数据）
  let extractedElements: {
    keywords?: Array<{ keyword: string; searchVolume: number; source: string; sourceType?: string; priority: string }>
    headlines?: string[]
    descriptions?: string[]
  } = {}

  // 🎯 P0/P1/P2/P3优化: 读取AI增强的提取数据
  let enhancedData: {
    keywords?: Array<{ keyword: string; volume: number; competition: string; score: number }>
    productInfo?: { features?: string[]; benefits?: string[]; useCases?: string[] }
    reviewAnalysis?: { sentiment?: string; themes?: string[]; insights?: string[] }
    qualityScore?: number
    headlines?: string[]
    descriptions?: string[]
    localization?: { currency?: string; culturalNotes?: string[]; localKeywords?: string[] }
    brandAnalysis?: {
      positioning?: string
      voice?: string
      competitors?: string[]
      // 🔥 修复（2025-12-11）：添加店铺分析新字段
      hotProducts?: Array<{
        name: string
        productHighlights?: string[]
        successFactors?: string[]
      }>
      reviewAnalysis?: {
        overallSentiment?: string
        positives?: string[]
        concerns?: string[]
        customerUseCases?: string[]
        trustIndicators?: string[]
      }
      sellingPoints?: string[]
    }
  } = {}

  try {
    // 🔥 修复(2025-12-26): 优先从关键词池获取关键词，而非使用旧的extracted_keywords
    // 关键词池已经过Keyword Planner扩展验证，包含高质量关键词
    const { getKeywordPoolByOfferId } = await import('./offer-keyword-pool')
    const keywordPool =
      (options?.keywordPool as OfferKeywordPool | undefined)
      || await getKeywordPoolByOfferId(offer.id)

    if (keywordPool && keywordPool.totalKeywords > 0) {
      // 统一走 canonical creative bucket 视图：
      // A=brand_intent, B/C=model_intent, D/S=product_intent
      const poolKeywords = resolveCreativeBucketPoolKeywords(keywordPool, normalizedBucket, 'A')

      // 转换为extractedElements格式
      // 🔧 修复(2026-01-21): 保留原始 source 字段，用于后续过滤 CLUSTERED 关键词
      extractedElements.keywords = poolKeywords.map(kw => ({
        keyword: kw.keyword,
        searchVolume: kw.searchVolume || 0,
        source: kw.source || 'KEYWORD_POOL',  // 保留原始 source（CLUSTERED/KEYWORD_PLANNER）
        sourceType: normalizeSourceTypeFromLegacySource({
          source: kw.source || 'KEYWORD_POOL',
          sourceType: (kw as any).sourceType,
        }),
        priority: 'HIGH' as const,
        isPureBrand: kw.isPureBrand  // 🔧 保留纯品牌词标记
      }))

	      // 🔥 2025-12-28: 关键词质量过滤
	      // 从关键词池获取关键词后再次过滤，确保移除品牌变体词和语义查询词
	      // 🔒 强制：只保留包含“纯品牌词”的关键词（不拼接造词）
	      const keywordFilterResult = filterKeywordQuality(extractedElements.keywords, {
	        brandName: offerBrand,
	        category: offer.category || undefined,
	        productName: (offer as any).product_name || undefined,
	        targetCountry: offer.target_country || undefined,
	        targetLanguage: offer.target_language || undefined,
	        productUrl: offer.final_url || offer.url || undefined,
	        minWordCount: 1,
	        maxWordCount: 8,
	        mustContainBrand,
	        // 过滤歧义品牌的无关主题（例如 rove beetle / rove concept）
	        minContextTokenMatches: getMinContextTokenMatchesForKeywordQualityFilter({
	          pageType: (offer as any).page_type || null
	        }),
	      })

      // 生成过滤报告
      const filterReport = generateFilterReport(extractedElements.keywords.length, keywordFilterResult.removed)
      console.log(filterReport)

      // 将 PoolKeywordData[] 转换为标准关键词格式并赋值
      extractedElements.keywords = keywordFilterResult.filtered.map(kw => ({
        keyword: kw.keyword,
        searchVolume: kw.searchVolume || 0,
        source: kw.source || 'KEYWORD_POOL',
        sourceType: normalizeSourceTypeFromLegacySource({
          source: kw.source || 'KEYWORD_POOL',
          sourceType: (kw as any).sourceType,
        }),
        priority: 'HIGH' as const
      }))
	      console.log(`🎯 从关键词池#${keywordPool.id} 获取 ${poolKeywords.length} 个关键词，过滤后剩余 ${extractedElements.keywords.length} 个 (bucket ${normalizedBucket || 'A'})`)
    } else if ((offer as any).extracted_keywords) {
      // Fallback: 关键词池不存在时，使用旧的extracted_keywords
      const rawKeywords = JSON.parse((offer as any).extracted_keywords)

      // 🔧 修复(2025-12-17): 兼容两种数据格式
      // 格式1: 字符串数组 ["Reolink", "reolink camera", ...]
      // 格式2: 对象数组 [{keyword: "Reolink", searchVolume: 90500}, ...]
      if (Array.isArray(rawKeywords) && rawKeywords.length > 0) {
        if (typeof rawKeywords[0] === 'string') {
          // 字符串数组 → 转换为对象数组（searchVolume设为0，后续会查询真实数据）
          extractedElements.keywords = rawKeywords.map(kw => ({
            keyword: kw,
            searchVolume: 0,
            source: 'EXTRACTED',
            sourceType: normalizeSourceTypeFromLegacySource({ source: 'EXTRACTED' }),
            priority: 'MEDIUM'
          }))
          console.log(`📦 读取到 ${extractedElements.keywords?.length || 0} 个提取的关键词（字符串格式，待查询搜索量）`)
        } else if (rawKeywords[0]?.keyword !== undefined) {
          // 对象数组 → 直接使用
          extractedElements.keywords = rawKeywords
          console.log(`📦 读取到 ${extractedElements.keywords.length} 个提取的关键词（对象格式）`)
        } else {
          console.warn(`⚠️ extracted_keywords格式未知，跳过`)
        }

	        // 🔥 2025-12-28: 关键词质量过滤（Fallback路径也需要过滤）
	        // 只有当 keywords 存在且非空时才进行过滤
	        // 🔒 强制：只保留包含“纯品牌词”的关键词（不拼接造词）
	        if (extractedElements.keywords && extractedElements.keywords.length > 0) {
	          const keywordFilterResult = filterKeywordQuality(extractedElements.keywords, {
	            brandName: offerBrand,
	            category: offer.category || undefined,
	            productName: (offer as any).product_name || undefined,
	            targetCountry: offer.target_country || undefined,
	            targetLanguage: offer.target_language || undefined,
	            productUrl: offer.final_url || offer.url || undefined,
	            minWordCount: 1,
	            maxWordCount: 8,
	            mustContainBrand,
	            minContextTokenMatches: getMinContextTokenMatchesForKeywordQualityFilter({
	              pageType: (offer as any).page_type || null
	            }),
	          })
          const filterReport = generateFilterReport(extractedElements.keywords.length, keywordFilterResult.removed)
          console.log(filterReport)
          // 将 PoolKeywordData[] 转换为标准关键词格式
          extractedElements.keywords = keywordFilterResult.filtered.map(kw => ({
            keyword: kw.keyword,
            searchVolume: kw.searchVolume || 0,
            source: kw.source || 'EXTRACTED',
            sourceType: normalizeSourceTypeFromLegacySource({
              source: kw.source || 'EXTRACTED',
              sourceType: (kw as any).sourceType,
            }),
            priority: 'MEDIUM' as const
          }))
        }
      }
    }
    if ((offer as any).extracted_headlines) {
      extractedElements.headlines = JSON.parse((offer as any).extracted_headlines)
      console.log(`📦 读取到 ${extractedElements.headlines?.length || 0} 个提取的标题`)
    }
    if ((offer as any).extracted_descriptions) {
      extractedElements.descriptions = JSON.parse((offer as any).extracted_descriptions)
      console.log(`📦 读取到 ${extractedElements.descriptions?.length || 0} 个提取的描述`)
    }

    // 🎯 读取增强数据（优先使用，因为质量更高）
    if ((offer as any).enhanced_keywords) {
      let rawKeywords: Array<{ keyword: string; volume?: number; competition?: string; score?: number }> = JSON.parse((offer as any).enhanced_keywords)
      console.log(`✨ 读取到 ${rawKeywords?.length || 0} 个增强关键词`)

      // 🔥 2026-01-02: 移除品类过滤 - 避免误杀有效关键词
      // 依赖Google Ads自动优化机制（质量得分、智能出价）淘汰不相关关键词
      // 保留其他过滤机制：竞品品牌、品牌变体、语义查询、搜索量过滤
      enhancedData.keywords = rawKeywords.map(kw => ({
        keyword: kw.keyword,
        volume: (kw as any).volume || 0,
        competition: (kw as any).competition || '',
        score: (kw as any).score || 0
      }))
      console.log(`✅ 关键词处理完成，共 ${enhancedData.keywords?.length || 0} 个增强关键词`)
    }
    if ((offer as any).enhanced_product_info) {
      enhancedData.productInfo = JSON.parse((offer as any).enhanced_product_info)
      console.log(`✨ 读取到增强产品信息`)
    }
    if ((offer as any).enhanced_review_analysis) {
      enhancedData.reviewAnalysis = JSON.parse((offer as any).enhanced_review_analysis)
      console.log(`✨ 读取到增强评论分析`)
    }
    if ((offer as any).extraction_quality_score) {
      enhancedData.qualityScore = (offer as any).extraction_quality_score
      console.log(`✨ 提取质量评分: ${enhancedData.qualityScore}/100`)
    }
    if ((offer as any).enhanced_headlines) {
      enhancedData.headlines = JSON.parse((offer as any).enhanced_headlines)
      console.log(`✨ 读取到 ${enhancedData.headlines?.length || 0} 个增强标题`)
    }
    if ((offer as any).enhanced_descriptions) {
      enhancedData.descriptions = JSON.parse((offer as any).enhanced_descriptions)
      console.log(`✨ 读取到 ${enhancedData.descriptions?.length || 0} 个增强描述`)
    }
    if ((offer as any).localization_adapt) {
      const rawLocalization = JSON.parse((offer as any).localization_adapt)
      enhancedData.localization = normalizeLocalizationPayload(rawLocalization)
      console.log(`✨ 读取到本地化适配数据${enhancedData.localization ? '（已标准化）' : '（结构不兼容，跳过）'}`)
    }
    if ((offer as any).brand_analysis) {
      enhancedData.brandAnalysis = JSON.parse((offer as any).brand_analysis)
      console.log(`✨ 读取到品牌分析数据`)
    }
  } catch (parseError: any) {
    console.warn('⚠️ 解析提取的广告元素失败，将使用AI全新生成:', parseError.message)
  }

  // 🎯 合并数据：将enhanced和extracted数据合并（去重）
  // 统一关键词格式为extracted格式（因为buildAdCreativePrompt期望这个格式）
  let normalizedEnhancedKeywords = (enhancedData.keywords || []).map(kw => ({
    keyword: kw.keyword,
    searchVolume: kw.volume || 0,
    source: 'AI_ENHANCED',
    sourceType: 'AI_ENHANCED_PERSISTED',
    priority: kw.score > 80 ? 'HIGH' : kw.score > 60 ? 'MEDIUM' : 'LOW'
  }))
  const policySafeEnhancedKeywords = sanitizeKeywordObjectsForGoogleAdsPolicy(normalizedEnhancedKeywords, { mode: policyGuardMode })
  if (policySafeEnhancedKeywords.changedCount > 0 || policySafeEnhancedKeywords.droppedCount > 0) {
    console.log(
      `[PolicyGuard] 增强关键词净化: 替换${policySafeEnhancedKeywords.changedCount}个, 丢弃${policySafeEnhancedKeywords.droppedCount}个`
    )
  }
  normalizedEnhancedKeywords = policySafeEnhancedKeywords.items

  // 🆕 v4.10: 如果传入了桶关键词，将其作为最高优先级关键词
  let bucketKeywordsNormalized: Array<{ keyword: string; searchVolume: number; source: string; priority: string }> = []

  // 🆕 v4.16: 如果没有传入桶关键词，根据链接类型和bucket自动获取
  if (options?.bucketKeywords && options.bucketKeywords.length > 0) {
    bucketKeywordsNormalized = options.bucketKeywords.map(kw => ({
      keyword: kw,
      searchVolume: 0, // 搜索量会在后续步骤中填充
      source: 'KEYWORD_POOL',
      sourceType: 'CANONICAL_BUCKET_VIEW',
      priority: 'HIGH' // 桶关键词优先级最高
    }))
    console.log(`📦 v4.10 关键词池: 使用桶 ${options.bucket} (${options.bucketIntent}) 的 ${bucketKeywordsNormalized.length} 个关键词`)
  } else if (options?.bucket) {
    // 🆕 v4.16: 自动根据链接类型和bucket获取关键词
    const { getKeywordsByLinkTypeAndBucket } = await import('./offer-keyword-pool')

    const bucketType = options.bucket as 'A' | 'B' | 'C' | 'D' | 'S'

    const keywordResult = await getKeywordsByLinkTypeAndBucket(offerId, effectiveLinkType, bucketType)

    if (keywordResult.keywords.length > 0) {
      bucketKeywordsNormalized = keywordResult.keywords.map(kw => ({
        keyword: kw.keyword,
        searchVolume: kw.searchVolume || 0,
        source: 'KEYWORD_POOL',
        sourceType: 'CANONICAL_BUCKET_VIEW',
        priority: 'HIGH'
      }))
      console.log(`📦 v4.16 关键词池: ${effectiveLinkType}链接 - 桶 ${bucketType} (${keywordResult.intent}) 的 ${bucketKeywordsNormalized.length} 个关键词`)
    } else {
      console.log(`📦 v4.16 关键词池: ${effectiveLinkType}链接 - 桶 ${bucketType} 暂无关键词，将使用默认关键词`)
    }
  }
  const policySafeBucketKeywords = sanitizeKeywordObjectsForGoogleAdsPolicy(bucketKeywordsNormalized, { mode: policyGuardMode })
  if (policySafeBucketKeywords.changedCount > 0 || policySafeBucketKeywords.droppedCount > 0) {
    console.log(
      `[PolicyGuard] 桶关键词净化: 替换${policySafeBucketKeywords.changedCount}个, 丢弃${policySafeBucketKeywords.droppedCount}个`
    )
  }
  bucketKeywordsNormalized = policySafeBucketKeywords.items

  // 🔥 2025-12-16修复：统一extracted关键词格式（可能是字符串数组或对象数组）
  let normalizedExtractedKeywords = (extractedElements.keywords || []).map((kw: any) => {
    // 如果是字符串，转换为对象格式
    if (typeof kw === 'string') {
      return {
        keyword: kw,
        searchVolume: 0,
        source: 'EXTRACTED',
        sourceType: normalizeSourceTypeFromLegacySource({ source: 'EXTRACTED' }),
        priority: 'MEDIUM'
      }
    }
    // 已经是对象格式
    return {
      keyword: String(kw.keyword || ''),
      searchVolume: kw.searchVolume || kw.volume || 0,
      source: kw.source || 'EXTRACTED',
      sourceType: normalizeSourceTypeFromLegacySource({
        source: kw.source || 'EXTRACTED',
        sourceType: kw.sourceType,
      }),
      priority: kw.priority || 'MEDIUM'
    }
  }).filter((kw: { keyword: string }) => kw.keyword.length > 0)
  const policySafeExtractedKeywords = sanitizeKeywordObjectsForGoogleAdsPolicy(normalizedExtractedKeywords, { mode: policyGuardMode })
  if (policySafeExtractedKeywords.changedCount > 0 || policySafeExtractedKeywords.droppedCount > 0) {
    console.log(
      `[PolicyGuard] 提取关键词净化: 替换${policySafeExtractedKeywords.changedCount}个, 丢弃${policySafeExtractedKeywords.droppedCount}个`
    )
  }
  normalizedExtractedKeywords = policySafeExtractedKeywords.items

  // 🆕 处理高性能搜索词（从实际广告表现中学习）
  let searchTermKeywords: Array<{ keyword: string; searchVolume: number; source: string; priority: string }> = []
  if (options?.searchTermFeedbackHints?.highPerformingTerms && options.searchTermFeedbackHints.highPerformingTerms.length > 0) {
    searchTermKeywords = options.searchTermFeedbackHints.highPerformingTerms.map(term => ({
      keyword: term,
      searchVolume: 0, // 搜索词没有预估搜索量，但有真实表现数据
        source: 'SEARCH_TERM_HIGH_PERFORMING',
        sourceType: 'SEARCH_TERM_HIGH_PERFORMING',
        priority: 'HIGH' // 高性能搜索词优先级高
      }))
    console.log(`🔍 添加 ${searchTermKeywords.length} 个高性能搜索词作为关键词候选`)
  }

  // 🆕 v4.10: 桶关键词优先，然后是高性能搜索词，增强关键词，最后是基础关键词
  // 🔥 优化(2025-12-22): 使用Google Ads标准化规则去重
  let mergedKeywords = [...bucketKeywordsNormalized, ...searchTermKeywords, ...normalizedEnhancedKeywords, ...normalizedExtractedKeywords]
  const policySafeMergedKeywords = sanitizeKeywordObjectsForGoogleAdsPolicy(mergedKeywords, { mode: policyGuardMode })
  if (policySafeMergedKeywords.changedCount > 0 || policySafeMergedKeywords.droppedCount > 0) {
    console.log(
      `[PolicyGuard] 合并关键词兜底净化: 替换${policySafeMergedKeywords.changedCount}个, 丢弃${policySafeMergedKeywords.droppedCount}个`
    )
  }
  mergedKeywords = policySafeMergedKeywords.items

  // 🆕 2026-03-13: 关键词缺口分析 - 在创意生成前识别缺失的行业标准关键词
  if (shouldRunGapAnalysisForCreative({
    bucket: normalizedBucket,
    isCoverageCreative,
    deferKeywordSupplementation: options?.deferKeywordSupplementation,
  })) {
    try {
      console.log('[Gap Analysis] 开始关键词缺口分析...')
      const { analyzeKeywordGapsPreGeneration } = await import('./scoring')

      const gapAnalysis = await analyzeKeywordGapsPreGeneration({
        offer: offer as any,
        existingKeywords: mergedKeywords,
        brandName: offerBrand,
        userId,
        targetCountry: offer.target_country,
        targetLanguage: offer.target_language
      })

      if (gapAnalysis.suggestedKeywords.length > 0) {
        console.log(`[Gap Analysis] 发现 ${gapAnalysis.suggestedKeywords.length} 个建议关键词（最多添加10个）`)

        // 应用品牌前缀
        const { composeGlobalCoreBrandedKeyword } = await import('./offer-keyword-pool')
        const { normalizeGoogleAdsKeyword } = await import('./google-ads-keyword-normalizer')
        const brandedGapKeywords: string[] = []

        // 构建现有关键词的标准化集合（用于去重）
        const existingKeywordsNormalized = new Set(
          mergedKeywords.map(kw => normalizeGoogleAdsKeyword(kw.keyword))
        )

        let skippedExistingCount = 0
        let brandingFailedCount = 0
        for (const keyword of gapAnalysis.suggestedKeywords) {
          const brandedKeyword = composeGlobalCoreBrandedKeyword(keyword, offerBrand, 5)
          const finalKeyword = brandedKeyword || keyword

          // 🔥 关键修复：检查品牌化后的关键词是否已存在
          const normalizedFinal = normalizeGoogleAdsKeyword(finalKeyword)
          if (existingKeywordsNormalized.has(normalizedFinal)) {
            console.log(`[Gap Analysis] ⏭️ 跳过已存在的关键词: ${finalKeyword}`)
            skippedExistingCount++
            continue
          }

          if (brandedKeyword) {
            brandedGapKeywords.push(brandedKeyword)
            console.log(`[Gap Analysis] ✅ 品牌化关键词: ${keyword} → ${brandedKeyword}`)
          } else {
            // 🔥 修复(2026-03-13): 品牌化失败时丢弃关键词，确保所有SCORING_SUGGESTION关键词都包含品牌
            console.log(`[Gap Analysis] ❌ 品牌化失败（超过5词），丢弃关键词: ${keyword}`)
            brandingFailedCount++
            // 不添加到 brandedGapKeywords，避免不含品牌的行业词进入关键词池
          }
        }

        if (skippedExistingCount > 0) {
          console.log(`[Gap Analysis] 跳过了 ${skippedExistingCount} 个已存在的关键词`)
        }

        if (brandingFailedCount > 0) {
          console.log(`[Gap Analysis] 丢弃了 ${brandingFailedCount} 个品牌化失败的关键词（品牌化后超过5词）`)
        }

        // 添加到关键词池，标记为SCORING_SUGGESTION源
        const gapKeywordsNormalized = brandedGapKeywords.map(kw => ({
          keyword: kw,
          searchVolume: 0, // 绕过搜索量过滤
          source: 'SCORING_SUGGESTION',
          sourceType: 'GAP_INDUSTRY_BRANDED',
          priority: 'HIGH',
          matchType: 'PHRASE' as const // 🎯 需求：默认词组匹配
        }))

        // 合并到现有关键词
        mergedKeywords.push(...gapKeywordsNormalized)
        console.log(`[Gap Analysis] ✅ 最终添加 ${gapKeywordsNormalized.length} 个缺口关键词到关键词池`)
      } else {
        console.log('[Gap Analysis] 未发现关键词缺口')
      }
    } catch (gapError: any) {
      console.warn('[Gap Analysis] 缺口分析失败，继续正常流程:', gapError.message)
    }
  }

  // 🔥 优化：使用Google Ads标准化进行去重，保留最高优先级的关键词
  const uniqueKeywords = deduplicateKeywordsWithPriority(
    mergedKeywords,
    kw => kw.keyword,
    kw => {
      // 统一来源优先级：使用共享配置，避免多处硬编码冲突。
      const sourceScore = getKeywordSourcePriorityScoreFromInput({
        source: kw.source,
        sourceType: (kw as any).sourceType,
      })
      return sourceScore > 0 ? sourceScore : 10
    }
  )

  // 🔥 2025-12-28: 最终关键词质量过滤
  // 确保所有来源的关键词都经过过滤，移除品牌变体词和语义查询词
  // 🔒 强制：最终只保留包含“纯品牌词”的关键词（不拼接造词）
  const finalKeywordFilter = filterKeywordQuality(uniqueKeywords, {
    brandName: offerBrand,
    category: offer.category || undefined,
    targetCountry: offer.target_country || undefined,
    targetLanguage: offer.target_language || undefined,
    minWordCount: 1,
    maxWordCount: 8,
    mustContainBrand,
  })

  if (finalKeywordFilter.removed.length > 0) {
    console.log(`🧹 最终关键词过滤: 移除 ${finalKeywordFilter.removed.length} 个低质量关键词`)
    finalKeywordFilter.removed.slice(0, 5).forEach(item => {
      const kw = typeof item.keyword === 'string' ? item.keyword : item.keyword.keyword
      console.log(`   - "${kw}": ${item.reason}`)
    })
  }

  // 将 PoolKeywordData[] 转换为标准关键词格式
  const filteredKeywords = finalKeywordFilter.filtered.map(kw => ({
    keyword: kw.keyword,
    searchVolume: kw.searchVolume || 0,
    source: kw.source || 'FILTERED',
    sourceType: (kw as any).sourceType,
    priority: 'MEDIUM' as const
  }))

  // 🔥 调试：打印去重信息
  logDuplicateKeywords(mergedKeywords.map(kw => kw.keyword), '合并前关键词')

  // 标题和描述合并
  const mergedHeadlines = [...(enhancedData.headlines || []), ...(extractedElements.headlines || [])]
  const mergedDescriptions = [...(enhancedData.descriptions || []), ...(extractedElements.descriptions || [])]

  // 标题和描述去重
  const uniqueHeadlines = [...new Set(mergedHeadlines)]
  const uniqueDescriptions = [...new Set(mergedDescriptions)]

  const mergedData = {
    keywords: filteredKeywords,
    headlines: uniqueHeadlines,
    descriptions: uniqueDescriptions,
    productInfo: enhancedData.productInfo,
    reviewAnalysis: enhancedData.reviewAnalysis,
    localization: enhancedData.localization,
    brandAnalysis: enhancedData.brandAnalysis,
    qualityScore: enhancedData.qualityScore,
    // 🆕 v4.10: 添加桶信息到合并数据中
    bucketInfo: options?.bucket ? {
      bucket: options.bucket,
      intent: options.bucketIntent,
      intentEn: options.bucketIntentEn,
      keywordCount: bucketKeywordsNormalized.length
    } : undefined
  }

  const storeModelIntentReadiness = evaluateStoreModelIntentReadiness({
    bucket: normalizedBucket,
    linkType: effectiveLinkType,
    scrapedData: (offer as any).scraped_data,
    brandAnalysis: mergedData.brandAnalysis,
    storeProductLinks: (offer as any).store_product_links,
  })
  if (!storeModelIntentReadiness.isReady) {
    console.error(`[generateAdCreative] ❌ ${storeModelIntentReadiness.reason}`)
    if (storeModelIntentReadiness.evidenceSources.length > 0) {
      console.error(`   已检查来源: ${storeModelIntentReadiness.evidenceSources.join(', ')}`)
    }
    throw new Error(storeModelIntentReadiness.reason)
  }
  if (effectiveLinkType === 'store' && normalizedBucket === 'B') {
    console.log(
      `[generateAdCreative] ✅ 店铺型号意图校验通过: hotProducts=${storeModelIntentReadiness.verifiedHotProducts.length}, modelAnchors=${storeModelIntentReadiness.hotProductModelAnchors.join(', ')}`
    )
  }

  console.log('📊 合并后的数据:')
  if (options?.bucket) {
    console.log(`   - 🆕 关键词池桶: ${options.bucket} (${options.bucketIntent})`)
    console.log(`   - 关键词: ${mergedData.keywords?.length || 0}个 (桶${bucketKeywordsNormalized.length} + 增强${enhancedData.keywords?.length || 0} + 基础${extractedElements.keywords?.length || 0})`)
  } else {
    console.log(`   - 关键词: ${mergedData.keywords?.length || 0}个 (基础${extractedElements.keywords?.length || 0} + 增强${enhancedData.keywords?.length || 0})`)
  }
  console.log(`   - 标题: ${mergedData.headlines?.length || 0}个 (基础${extractedElements.headlines?.length || 0} + 增强${enhancedData.headlines?.length || 0})`)
  console.log(`   - 描述: ${mergedData.descriptions?.length || 0}个 (基础${extractedElements.descriptions?.length || 0} + 增强${enhancedData.descriptions?.length || 0})`)
  console.log(`   - 产品信息: ${mergedData.productInfo ? '有✨' : '无'}`)
  console.log(`   - 本地化: ${mergedData.localization ? '有✨' : '无'}`)
  console.log(`   - 品牌分析: ${mergedData.brandAnalysis ? '有✨' : '无'}`)

  const precomputedKeywordSet = options?.precomputedKeywordSet || null
  const initialKeywordUsagePlan = buildCreativeKeywordUsagePlan({
    brandName: offerBrand,
    precomputedKeywordSet,
  })

  // 构建Prompt（传入合并后的数据）
  const { prompt, promptKeywords } = await buildAdCreativePrompt(
    offer,
    options?.theme,
    options?.referencePerformance,
    options?.excludeKeywords,
    mergedData,  // 🎯 传入合并后的增强数据
    {
      retryFailureType: options?.retryFailureType,
      searchTermFeedbackHints: options?.searchTermFeedbackHints,
      policyGuardMode,
      precomputedKeywordSet,
    }
  )

  // 使用统一AI入口（优先Vertex AI，自动降级到Gemini API）
  if (!userId) {
    throw new Error('生成广告创意需要用户ID，请确保已登录')
  }
  const aiMode = await getGeminiMode(userId)
  console.log(`🤖 使用统一AI入口生成广告创意 (${aiMode})...`)

  const timerLabel = `⏱️ AI生成创意 ${offerId}-${userId}-${Date.now()}`
  console.time(timerLabel)
  let aiResponse!: Awaited<ReturnType<typeof generateContent>>
  let result!: GeneratedAdCreativeData
  try {
    try {
      const attempt = await runAdCreativeModelAttempt({
        userId,
        prompt,
        policyGuardMode,
        bucket: normalizedBucket,
      })
      aiResponse = attempt.aiResponse
      result = attempt.result
    } catch (error: any) {
      const retryPlan = resolveAdCreativeRetryPlan(error, false)
      if (!retryPlan) {
        throw error
      }

      console.warn(
        `[AdCreative] 标准尝试失败，开始 ${retryPlan.mode} retry: ` +
        `${error?.code || 'UNKNOWN'} ${String(error?.message || '')} (reason=${retryPlan.reason})`
      )
      const retryPrompt = retryPlan.mode === 'emergency'
        ? buildEmergencyAdCreativeRetryPrompt(prompt)
        : buildSimplifiedAdCreativeRetryPrompt(prompt)
      const retryAttempt = await runAdCreativeModelAttempt({
        userId,
        prompt: retryPrompt,
        policyGuardMode,
        retryMode: retryPlan.mode,
        bucket: normalizedBucket,
      })
      aiResponse = retryAttempt.aiResponse
      result = retryAttempt.result
    }
  } finally {
    console.timeEnd(timerLabel)
  }
  const aiModel = `${aiMode}:${aiResponse.model}`
  result.promptKeywords = promptKeywords
  result.keywordUsagePlan = initialKeywordUsagePlan

  // 🔧 修复(2025-12-27): 对AI生成的关键词进行质量过滤（移除品牌变体词和语义查询词）
  const brandName = offerBrand || 'Brand'
  if (result.keywords && result.keywords.length > 0) {
    const policySafeGeneratedKeywords = sanitizeKeywordListForGoogleAdsPolicy(result.keywords, { mode: policyGuardMode })
    if (policySafeGeneratedKeywords.changedCount > 0 || policySafeGeneratedKeywords.droppedCount > 0) {
      console.log(
        `[PolicyGuard] AI生成关键词净化: 替换${policySafeGeneratedKeywords.changedCount}个, 丢弃${policySafeGeneratedKeywords.droppedCount}个`
      )
    }
    result.keywords = policySafeGeneratedKeywords.items

    const { filterKeywordQuality } = await import('./keyword-quality-filter')
    const keywordData = result.keywords.map(kw => ({
      keyword: kw,
      searchVolume: 0,
      source: 'AI_GENERATED' as const,
      sourceType: 'AI_LLM_RAW',
    }))
    const filtered = filterKeywordQuality(keywordData, {
      brandName,
      minWordCount: 1,
      maxWordCount: 8,
      // 🔒 强制：AI生成关键词也必须包含纯品牌词（不拼接造词）
      mustContainBrand,
    })

    if (filtered.removed.length > 0) {
      console.warn(`⚠️ 关键词质量过滤: 移除 ${filtered.removed.length} 个低质量关键词`)
      filtered.removed.slice(0, 5).forEach(item => {
        console.warn(`   - "${item.keyword.keyword}": ${item.reason}`)
      })
    }

    result.keywords = filtered.filtered.map(kw => kw.keyword)

    // 🔥 2026-01-02: 移除品类过滤 - 避免误杀有效关键词
    // 依赖Google Ads自动优化机制（质量得分、智能出价）淘汰不相关关键词
    console.log(`✅ 关键词质量过滤完成，共 ${result.keywords.length} 个关键词`)

    // 🔧 修复(2025-12-27): 添加Google Ads标准化去重，消除AI生成的重复关键词
    const { deduplicateKeywordsWithPriority } = await import('./google-ads-keyword-normalizer')
    const keywordsAfterDedup = deduplicateKeywordsWithPriority(
      result.keywords,
      kw => kw,
      () => 0  // 所有AI生成关键词优先级相同
    )

    const removedDuplicates = result.keywords.length - keywordsAfterDedup.length
    if (removedDuplicates > 0) {
      console.warn(`⚠️ 关键词去重: 移除 ${removedDuplicates} 个重复关键词`)
    }
    result.keywords = keywordsAfterDedup
    console.log(`📝 关键词去重后: ${result.keywords.length} 个唯一关键词`)
  }

  // 🔥 强制第一个headline为DKI品牌格式（自动处理30字符限制）
  const HEADLINE_MAX_LENGTH = 30
  const targetCountryRaw = (offer as { target_country?: string }).target_country || 'US'
  const resolvedCreativeLanguage = resolveCreativeTargetLanguage(
    (offer as { target_language?: string }).target_language || null,
    targetCountryRaw
  )
  const targetCountry = resolvedCreativeLanguage.targetCountry
  const targetLanguage = resolvedCreativeLanguage.languageName
  const titlePriorityProductTitle = (() => {
    const scrapedTitle =
      scrapedDataForOffer && typeof scrapedDataForOffer === 'object'
        ? (
          typeof (scrapedDataForOffer as any).productName === 'string'
            ? (scrapedDataForOffer as any).productName
            : (typeof (scrapedDataForOffer as any).title === 'string' ? (scrapedDataForOffer as any).title : '')
        )
        : ''
    return String(
      scrapedTitle
      || (offer as any).product_title
      || (offer as any).product_name
      || (offer as any).name
      || ''
    ).trim()
  })()
  const titlePriorityAboutItems = (() => {
    const scrapedAbout = Array.isArray((scrapedDataForOffer as any)?.aboutThisItem)
      ? (scrapedDataForOffer as any).aboutThisItem
      : []
    const scrapedFeatures = Array.isArray((scrapedDataForOffer as any)?.features)
      ? (scrapedDataForOffer as any).features
      : []
    const enhancedFeatures = Array.isArray(mergedData.productInfo?.features)
      ? mergedData.productInfo.features
      : []
    const enhancedBenefits = Array.isArray(mergedData.productInfo?.benefits)
      ? mergedData.productInfo.benefits
      : []
    const primary = scrapedAbout.length > 0
      ? scrapedAbout
      : (scrapedFeatures.length > 0 ? scrapedFeatures : enhancedFeatures)
    return Array.from(new Set(
      [...primary, ...enhancedBenefits]
        .map((item: any) => String(item || '').trim())
        .filter(Boolean)
    )).slice(0, 12)
  })()

  const finalFirstHeadline = buildDkiFirstHeadline(brandName, HEADLINE_MAX_LENGTH, {
    targetLanguage,
    targetCountry,
  })

  if (result.headlines.length > 0) {
    // 检查第一个headline是否符合要求
    if (result.headlines[0] !== finalFirstHeadline) {
      // 说明：DKI token 本身不计入字符数，因此这里不使用 finalFirstHeadline.length 做判断
      console.log(`🔧 强制第一个headline: "${result.headlines[0]}" → "${finalFirstHeadline}"`)
      result.headlines[0] = finalFirstHeadline
      if (result.headlinesWithMetadata && result.headlinesWithMetadata.length > 0) {
        result.headlinesWithMetadata[0] = {
          ...result.headlinesWithMetadata[0],
          text: finalFirstHeadline,
          length: finalFirstHeadline.length
        }
      }
    } else {
      console.log(`✅ 第一个headline已符合要求: "${finalFirstHeadline}"`)
    }
  }

  const titlePriorityPreFix = enforceTitlePriorityTopHeadlines(result, {
    brandName,
    brandTokensToMatch,
    productTitle: titlePriorityProductTitle,
    aboutItems: titlePriorityAboutItems,
    targetLanguage,
    slotStartIndex: TOP_HEADLINE_SLOT_START_INDEX,
    slotCount: TOP_HEADLINE_SLOT_COUNT,
    maxLength: HEADLINE_MAX_LENGTH,
  })
  if (titlePriorityPreFix.selected.length > 0) {
    console.log(
      `🔧 Title优先Top3补强(预处理): 替换${titlePriorityPreFix.replaced}条 (title=${titlePriorityPreFix.titleCount}, about=${titlePriorityPreFix.aboutCount})`
    )
  }

  // 🔧 v4.36: 移除强制Headline #2使用DKI格式的限制
  // 原因：效果不佳，让AI自由生成更多样化的标题
  // 保留Headline #1的品牌DKI格式不变

  console.log('✅ 广告创意生成成功')
  console.log(`   - Headlines: ${result.headlines.length}个`)
  console.log(`   - Descriptions: ${result.descriptions.length}个`)
  console.log(`   - Keywords: ${result.keywords.length}个`)

  // 🔄 使用统一关键词服务获取精确搜索量
  console.time('⏱️ 获取关键词搜索量')
  let keywordsWithVolume: KeywordWithVolume[] = []

  // 🔧 修复(2025-12-24): 提取到外层作用域，供后续clusterKeywordsByIntent使用
  const resolvedTargetLanguage = targetLanguage
  const language = resolvedCreativeLanguage.languageCode

  try {
    console.log(`🔍 获取关键词精确搜索量: ${result.keywords.length}个关键词, 国家=${targetCountry}, 语言=${language} (${resolvedTargetLanguage})`)

    // 🎯 使用统一服务：确保所有搜索量来自Historical Metrics API（精确匹配）
    const { getKeywordVolumesForExisting } = await import('@/lib/unified-keyword-service')
    const unifiedData = await getKeywordVolumesForExisting({
      baseKeywords: result.keywords,
      country: targetCountry,
      language,
      userId,
      brandName
    })

    // 🎯 修复：添加matchType字段（智能分配）+ lowTopPageBid/highTopPageBid竞价数据
    // 注意：这里仅做初始化，会在v4.16优化逻辑（行~2730）中根据品牌/非品牌/品牌相关分类重新分配
    keywordsWithVolume = unifiedData.map(v => {
      // 🔥 修复(2025-12-18): 不在初始阶段做复杂的品牌分类，改为统一使用PHRASE
      // 这样可以在v4.16优化阶段（行2708-2758）准确地重新分配matchType
      // 纯品牌词 → EXACT
      // 品牌相关词 → PHRASE
      // 非品牌词 → PHRASE
      let matchType: 'BROAD' | 'PHRASE' | 'EXACT' = 'PHRASE' // 默认PHRASE，后续会根据品牌分类重新分配

      return {
        keyword: v.keyword,
        searchVolume: v.searchVolume,
        competition: v.competition,
        competitionIndex: v.competitionIndex,
        lowTopPageBid: v.lowTopPageBid || 0,  // 🆕 添加页首最低出价
        highTopPageBid: v.highTopPageBid || 0, // 🆕 添加页首最高出价
        volumeUnavailableReason: v.volumeUnavailableReason,
        matchType
      }
    })
    console.log(`✅ 关键词精确搜索量获取完成（来源: Historical Metrics API）`)
  } catch (error) {
    console.warn('⚠️ 获取关键词搜索量失败，使用默认值:', error)
    // 🎯 修复：即使失败也要添加matchType和竞价数据
    keywordsWithVolume = result.keywords.map(kw => {
      // 🔥 修复(2025-12-18): 同上，初始化时统一使用PHRASE，让v4.16优化逻辑处理分类
      let matchType: 'BROAD' | 'PHRASE' | 'EXACT' = 'PHRASE'

      return {
        keyword: kw,
        searchVolume: 0,
        lowTopPageBid: 0,  // 🆕 默认为0
        highTopPageBid: 0, // 🆕 默认为0
        matchType
      }
    })
  }
  console.timeEnd('⏱️ 获取关键词搜索量')

  // 🔒 强制：只保留包含“纯品牌词”的关键词（不拼接造词）
  const originalKeywordCount = keywordsWithVolume.length
  const validKeywords = keywordsWithVolume.filter(kw => containsBrand(kw.keyword, kw.searchVolume))

  // 更新关键词列表
  const removedCount = originalKeywordCount - validKeywords.length

  if (removedCount > 0) {
    console.log(`🔧 已过滤 ${removedCount} 个不含纯品牌词的关键词`)
    console.log(`📊 剩余关键词: ${validKeywords.length}/${originalKeywordCount}`)
  }

  // 按搜索量从高到低排序
  validKeywords.sort((a, b) => b.searchVolume - a.searchVolume)

  result.keywords = validKeywords.map(kw => kw.keyword)
  keywordsWithVolume = validKeywords

  // 🎯 通过Keyword Planner扩展高搜索量关键词（多角度3轮查询策略）
  // 策略: 使用不同角度的种子词进行3轮查询，最大化获取高搜索量关键词提示
  try {
    if (brandName && userId) {
      console.log(`🔍 启动Keyword Planner多角度3轮查询策略`)
      console.time('⏱️ Keyword Planner扩展')

      const { getDatabase } = await import('@/lib/db')
      const db = await getDatabase()

      // 🔧 PostgreSQL兼容性修复: is_active/is_manager_account在PostgreSQL中是BOOLEAN类型
      const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
      const isManagerCondition = db.type === 'postgres' ? 'is_manager_account = false' : 'is_manager_account = 0'

      // 查询用户的Google Ads账号
      // 🔧 修复(2025-12-12): Keyword Planner API 必须使用客户账号，不能使用 MCC 账号
      const adsAccount = await db.queryOne(`
        SELECT id, customer_id FROM google_ads_accounts
        WHERE user_id = ?
          AND ${isActiveCondition}
          AND status = 'ENABLED'
          AND ${isManagerCondition}
        ORDER BY created_at DESC
        LIMIT 1
      `, [userId]) as { id: number; customer_id: string } | undefined

      if (adsAccount) {
        // 🔧 修复(2025-12-25): 支持服务账号和OAuth两种认证方式
        const { getGoogleAdsConfig } = await import('@/lib/keyword-planner')
        const config = await getGoogleAdsConfig(userId)

        if (config) {
          const country = (offer as { target_country?: string }).target_country || 'US'
          const plannerLanguage = resolveCreativeTargetLanguage(
            (offer as { target_language?: string }).target_language || null,
            country
          )
          const targetLanguage = plannerLanguage.languageName
          const language = plannerLanguage.languageCode

          console.log(`🌍 Keyword Planner 查询语言: ${language} (${targetLanguage})`)

          // 🔧 2025-12-17: 如果已传入特定桶的关键词，跳过从关键词池获取所有关键词
          // 这确保差异化创意只使用对应桶的关键词，而不是所有桶的关键词混合
	          if (options?.bucketKeywords && options.bucketKeywords.length > 0) {
	            console.log(`📦 已有桶 ${options.bucket} (${options.bucketIntent}) 的 ${options.bucketKeywords.length} 个关键词，跳过关键词池合并`)
	          } else {
	            // 🔥 统一架构(2025-12-16): 使用关键词池替代3轮Keyword Planner扩展
	            console.log(`\n🔍 从关键词池获取关键词...`)
	            const { getOrCreateKeywordPool } = await import('@/lib/offer-keyword-pool')

	            const keywordPool =
	              (options?.keywordPool as OfferKeywordPool | undefined)
	              || await getOrCreateKeywordPool(
	                offer.id,
	                userId
	              )

	            if (keywordPool) {
	              const poolKeywords = resolveCreativeBucketPoolKeywords(
	                keywordPool,
	                normalizedBucket,
	                'D'
	              )

	              // 🔥 优化(2025-12-22): 使用Google Ads标准化去重
	              const existingKeywordsSet = new Set(result.keywords.map(kw => normalizeGoogleAdsKeyword(kw)))
              const newKeywords = poolKeywords.filter(kw => !existingKeywordsSet.has(normalizeGoogleAdsKeyword(kw.keyword)))

              console.log(`📊 关键词池去重: ${poolKeywords.length} → ${newKeywords.length} (过滤掉 ${poolKeywords.length - newKeywords.length} 个重复)`)

            keywordsWithVolume = [
              ...keywordsWithVolume,
	              ...newKeywords.map(kw => ({
	                keyword: kw.keyword,
	                searchVolume: kw.searchVolume,
	                competition: kw.competition,
	                competitionIndex: kw.competitionIndex,
	                source: (kw.source === 'AI_GENERATED' || kw.source === 'KEYWORD_EXPANSION' || kw.source === 'MERGED') ? kw.source as 'AI_GENERATED' | 'KEYWORD_EXPANSION' | 'MERGED' : undefined,
	                sourceType: (kw as any).sourceType,
	                matchType: kw.matchType
	              }))
	            ]

            result.keywords = [...result.keywords, ...newKeywords.map(kw => kw.keyword)]
            console.log(`   ✅ 从关键词池获取 ${newKeywords.length} 个新关键词`)
            console.log(`   📊 当前关键词总数: ${keywordsWithVolume.length} 个`)
          } else {
            console.warn('   ⚠️ 关键词池不存在，跳过关键词扩展')
          }
          } // 闭合 bucketKeywords 条件检查的 else 块
        } else {
          console.warn('⚠️ 未找到Google Ads凭证（OAuth或服务账号），跳过Keyword Planner扩展')
        }
      } else {
        console.warn('⚠️ 未找到激活的Google Ads账号，跳过Keyword Planner扩展')
      }

      console.timeEnd('⏱️ Keyword Planner扩展')
    } else {
      if (!brandName || !userId) {
        console.log('ℹ️ Offer缺少品牌名或userId，跳过Keyword Planner扩展')
      }
    }
  } catch (plannerError: any) {
    // Keyword Planner扩展失败不影响主流程
    console.warn('⚠️ Keyword Planner扩展失败（非致命错误）:', plannerError.message)
  }

  let keywordSupplementationReport: KeywordSupplementationReport | undefined
  if (options?.deferKeywordPostProcessingToBuilder) {
    console.log('[KeywordPipeline] defer legacy keyword post-processing to builder')
    keywordsWithVolume = normalizeKeywordSourceAuditForGeneratorList(keywordsWithVolume)
    result.keywords = keywordsWithVolume.map(kw => kw.keyword)
  } else {
    // 🔥 方案A优化(2025-12-16): 合并extracted_keywords到最终关键词列表
    // 原问题：31个高质量Google下拉词仅作为prompt参考，未直接使用
    // 解决方案：将已验证搜索量的extracted_keywords直接合并，确保100%利用
    // 🔥 优化(2025-12-16): 使用AI语义分类（keyword_intent_clustering prompt）
    const extractedMergeResult = await mergeExtractedKeywordsWithSingleExit({
      keywordsWithVolume,
      extractedKeywords: extractedElements.keywords || [],
      brandName,
      productCategory: (offer as { category?: string }).category || '未分类',
      userId,
      offerId: offer.id,
      targetCountry,
      language,
      creativeType: resolveCreativeTypeFromBucketForMerge(normalizedBucket),
      fallbackMode: Boolean(isCoverageCreative),
    })
    keywordsWithVolume = extractedMergeResult.keywordsWithVolume

    const finalizedKeywords = await finalizeKeywordsWithSingleExit({
      keywordsWithVolume,
      offerBrand,
      brandName,
      canonicalBrandKeyword,
      pureBrandKeywordsList,
      brandTokensToMatch,
      mustContainBrand,
      targetCountry,
      targetLanguage: resolvedTargetLanguage,
      userId,
      offerId: offer.id,
    })
    keywordsWithVolume = finalizedKeywords.keywordsWithVolume
    result.keywords = finalizedKeywords.keywords

    if (!options?.deferKeywordSupplementation) {
      const supplemented = await applyKeywordSupplementationOnce({
        offer,
        userId,
        brandName,
        targetLanguage: resolvedTargetLanguage,
        keywordsWithVolume,
        poolCandidates: Array.isArray(options?.bucketKeywords) ? options.bucketKeywords : undefined,
        bucket: options?.bucket || null,  // 🔥 优化(2026-03-13): 传递 bucket 用于意图一致性检查
      })
      keywordsWithVolume = supplemented.keywordsWithVolume
      result.keywords = supplemented.keywords
      keywordSupplementationReport = supplemented.keywordSupplementation
      result.keywordSupplementation = keywordSupplementationReport
    }

    const policySafeFinalKeywords = sanitizeKeywordObjectsForGoogleAdsPolicy(keywordsWithVolume, { mode: policyGuardMode })
    if (policySafeFinalKeywords.changedCount > 0 || policySafeFinalKeywords.droppedCount > 0) {
      console.log(
        `[PolicyGuard] 最终关键词兜底净化: 替换${policySafeFinalKeywords.changedCount}个, 丢弃${policySafeFinalKeywords.droppedCount}个`
      )
    }
    keywordsWithVolume = normalizeKeywordSourceAuditForGeneratorList(policySafeFinalKeywords.items)
    result.keywords = keywordsWithVolume.map(kw => kw.keyword)
  }

  const effectiveKeywordUsagePlan = resolveEffectiveKeywordUsagePlan({
    brandName: offerBrand,
    precomputedKeywordSet,
    generatedKeywords: result.keywords,
    keywordsWithVolume,
  })
  result.keywordUsagePlan = effectiveKeywordUsagePlan

  // ✅ 基础约束修复：CTA（多语言软补强）与关键词嵌入率（English）
  const resolvedLanguage = normalizeLanguageCode(targetLanguage)
  const resolvedSoftLanguage = resolveSoftCopyLanguage(targetLanguage || resolvedLanguage)
  if (resolvedSoftLanguage) {
    const ctaFix = enforceLanguageCtas(result.descriptions, 2, 90, resolvedSoftLanguage)
    if (ctaFix.fixed > 0) {
      console.log(`🔧 CTA补强: 修复 ${ctaFix.fixed} 条描述`)
      result.descriptions = ctaFix.updated
      if (result.descriptionsWithMetadata) {
        result.descriptionsWithMetadata = result.descriptionsWithMetadata.map((d, idx) => ({
          ...d,
          text: result.descriptions[idx],
          length: result.descriptions[idx]?.length || d.length
        }))
      }
    }
  }

  if (resolvedSoftLanguage === 'en') {
    const embedFix = enforceKeywordEmbedding(result.headlines, result.keywords, 8, 30, [0])
    if (embedFix.fixed > 0) {
      console.log(`🔧 关键词嵌入率补强: 修复 ${embedFix.fixed} 个标题`)
      result.headlines = embedFix.updated
      if (result.headlinesWithMetadata) {
        result.headlinesWithMetadata = result.headlinesWithMetadata.map((h, idx) => ({
          ...h,
          text: result.headlines[idx],
          length: result.headlines[idx]?.length || h.length
        }))
      }
    }
  }

  // 🆕 非破坏式A/B/D文案补强：仅调整标题/描述表达，不修改关键词策略
  const softFix = softlyReinforceTypeCopy(result, normalizedBucket, targetLanguage || resolvedLanguage, brandName)
  if (softFix.headlineFixes > 0 || softFix.descriptionFixes > 0) {
    console.log(`🔧 类型化文案补强: headlines ${softFix.headlineFixes} 条, descriptions ${softFix.descriptionFixes} 条`)
  }

  const emotionFix = enforceEmotionBoundaryByBucket(result, normalizedBucket, targetLanguage || resolvedLanguage)
  if (emotionFix.fixes > 0) {
    console.log(`🔧 情绪边界补强: 中和强负面表达 ${emotionFix.fixes} 处`)
  }

  const complementarityFix = enforceHeadlineComplementarity(
    result,
    targetLanguage || resolvedLanguage,
    brandName,
    normalizedBucket
  )
  if (complementarityFix.fixes > 0) {
    console.log(
      `🔧 标题互补性补强: ${complementarityFix.fixes} 条 (brand=${complementarityFix.brandCount}, scenario=${complementarityFix.scenarioCount}, transactional=${complementarityFix.transactionalCount})`
    )
  }

  const titlePriorityPostFix = enforceTitlePriorityTopHeadlines(result, {
    brandName,
    brandTokensToMatch,
    productTitle: titlePriorityProductTitle,
    aboutItems: titlePriorityAboutItems,
    targetLanguage,
    slotStartIndex: TOP_HEADLINE_SLOT_START_INDEX,
    slotCount: TOP_HEADLINE_SLOT_COUNT,
    maxLength: HEADLINE_MAX_LENGTH,
  })
  if (titlePriorityPostFix.replaced > 0) {
    console.log(
      `🔧 Title优先Top3补强(后处理): 替换${titlePriorityPostFix.replaced}条 (title=${titlePriorityPostFix.titleCount}, about=${titlePriorityPostFix.aboutCount})`
    )
  }

  if (effectiveKeywordUsagePlan.retainedNonBrandKeywords.length > 0) {
    const retainedSlotFix = enforceRetainedKeywordSlotCoverage(
      result,
      effectiveKeywordUsagePlan,
      resolvedSoftLanguage || resolvedLanguage,
      brandName
    )
    if (retainedSlotFix.headlineFixes > 0 || retainedSlotFix.descriptionFixes > 0) {
      console.log(
        `🔧 Retained关键词slot补强: headlines ${retainedSlotFix.headlineFixes} 条, descriptions ${retainedSlotFix.descriptionFixes} 条`
      )
    }
  }

  const purityFix = enforceLanguagePurityGate(
    result,
    normalizedBucket,
    targetLanguage || resolvedLanguage,
    brandName
  )
  if (purityFix.headlineFixes > 0 || purityFix.descriptionFixes > 0) {
    console.log(
      `🔧 语言纯度门控: headlines ${purityFix.headlineFixes} 条, descriptions ${purityFix.descriptionFixes} 条`
    )
  }

  const dedupeFix = enforceHeadlineUniquenessGate(
    result,
    targetLanguage || resolvedLanguage,
    brandName,
    effectiveKeywordUsagePlan
  )
  if (dedupeFix.fixes > 0) {
    console.log(`🔧 Headline去重门控: 修复 ${dedupeFix.fixes} 条`)
  }

  const finalContractFix = enforceFinalCreativeContract(result, {
    bucket: normalizedBucket,
    languageCode: targetLanguage || resolvedLanguage,
    brandName,
    brandTokensToMatch,
    dkiHeadline: finalFirstHeadline,
    productTitle: titlePriorityProductTitle,
    aboutItems: titlePriorityAboutItems,
    usagePlan: effectiveKeywordUsagePlan,
  })
  if (
    finalContractFix.headlineFixes > 0
    || finalContractFix.descriptionFixes > 0
    || finalContractFix.titleFixes > 0
    || finalContractFix.retainedFixes.headlineFixes > 0
    || finalContractFix.retainedFixes.descriptionFixes > 0
    || finalContractFix.languageFixes.headlineFixes > 0
    || finalContractFix.languageFixes.descriptionFixes > 0
    || finalContractFix.uniquenessFixes > 0
  ) {
    console.log(
      `🔧 最终硬约束收敛: ` +
      `headline=${finalContractFix.headlineFixes}, ` +
      `description=${finalContractFix.descriptionFixes}, ` +
      `title=${finalContractFix.titleFixes}, ` +
      `retained(h=${finalContractFix.retainedFixes.headlineFixes},d=${finalContractFix.retainedFixes.descriptionFixes}), ` +
      `purity(h=${finalContractFix.languageFixes.headlineFixes},d=${finalContractFix.languageFixes.descriptionFixes}), ` +
      `dedupe=${finalContractFix.uniquenessFixes}`
    )
  }

  // 🆕 添加只读意图元数据（向后兼容，不影响关键词和发布）
  annotateCopyIntentMetadata(result, resolvedLanguage, result.keywords || [])

  // 修正 sitelinks URL 为真实的 offer URL
  // 需求优化：所有sitelinks统一使用offer的主URL，避免虚构的子路径
  if (result.sitelinks && result.sitelinks.length > 0) {
    // 优先使用final_url（推广链接解析后的真实URL），否则使用url
    // 🔧 修复：验证final_url是否为有效URL，排除"null/"等无效值
    const rawFinalUrl = (offer as { final_url?: string; url?: string }).final_url
    const offerUrlRaw = (offer as { url?: string }).url
    // 只有当final_url是有效的URL时才使用，否则fallback到url字段
    const isFinalUrlValid = rawFinalUrl && rawFinalUrl !== 'null' && rawFinalUrl !== 'null/' && rawFinalUrl !== 'undefined'
    const offerUrl = isFinalUrlValid ? rawFinalUrl : offerUrlRaw
    if (offerUrl) {
      result.sitelinks = result.sitelinks.map(link => {
        // 所有sitelinks统一使用offer的主URL（不拼接子路径）
        // 这确保所有链接都是真实可访问的
        return {
          ...link,
          url: offerUrl  // 优先使用final_url，避免推广链接
        }
      })

      console.log(`🔗 修正 ${result.sitelinks.length} 个附加链接URL为真实offer URL (${offerUrl.substring(0, 50)}...)`)
    }
  }

  // 🎯 生成否定关键词（排除不相关流量）
  let negativeKeywords: string[] = []
  try {
    console.log('🔍 生成否定关键词...')
    console.time('⏱️ 否定关键词生成')
    negativeKeywords = await generateNegativeKeywords(offer as Offer, userId)
    console.timeEnd('⏱️ 否定关键词生成')
    console.log(`✅ 生成${negativeKeywords.length}个否定关键词:`, negativeKeywords.slice(0, 5).join(', '), '...')
  } catch (negError: any) {
    // 否定关键词生成失败不影响主流程
    console.warn('⚠️ 否定关键词生成失败（非致命错误）:', negError.message)
  }

  const fullResult = {
    ...result,
    keywordsWithVolume,
    negativeKeywords,  // 🎯 新增：添加否定关键词到结果
    keywordSupplementation: keywordSupplementationReport,
    ai_model: aiModel
  }

  // 缓存结果（1小时TTL）
  creativeCache.set(cacheKey, fullResult)
  console.log(`💾 已缓存广告创意: ${cacheKey}`)

  return fullResult
}

/**
 * 并行生成多个广告创意（优化延迟）
 *
 * ✅ 安全修复：userId改为必需参数
 *
 * @param offerId Offer ID
 * @param userId 用户ID（必需）
 * @param count 生成数量（1-3个）
 * @param options 生成选项
 * @returns 生成的创意数组
 */
export async function generateAdCreativesBatch(
  offerId: number,
  userId: number,  // ✅ 修复：改为必需参数
  count: number = 3,
  options?: {
    theme?: string
    referencePerformance?: any
    skipCache?: boolean
    retryFailureType?: RetryFailureType
    searchTermFeedbackHints?: SearchTermFeedbackHintsInput
    deferKeywordSupplementation?: boolean
    deferKeywordPostProcessingToBuilder?: boolean
    precomputedKeywordSet?: PrecomputedCreativeKeywordSet | null
  }
): Promise<Array<GeneratedAdCreativeData & { ai_model: string }>> {
  // 限制数量在1-3之间
  const validCount = Math.max(1, Math.min(3, count))

  console.log(`🎨 并行生成 ${validCount} 个广告创意...`)

  // 为每个创意生成不同的主题变体（如果没有指定主题）
  // 增强差异性：使用更具体和对比鲜明的主题
  const themes = options?.theme
    ? [options.theme]
    : [
        'Brand Intent - 强调品牌背书 + 真实商品锚点。Headlines必须同时体现品牌与商品/品类，不得退化成纯品牌导航文案。',
        'Model Intent - 强调型号/产品族购买意图。Headlines优先体现型号、产品族或规格锚点，Descriptions突出精准适配与购买动作。',
        'Product Demand Intent - 强调商品需求、功能、场景和产品线覆盖。Headlines突出功能/场景，Descriptions说明需求解法与CTA。'
      ]

  // 创建并行生成任务
  const tasks = Array.from({ length: validCount }, (_, index) => {
    const taskOptions = {
      ...options,
      theme: themes[index % themes.length],
      skipCache: options?.skipCache || false
    }

    return generateAdCreative(offerId, userId, taskOptions)
  })

  // 并行执行所有任务
  const startTime = Date.now()
  const results = await Promise.all(tasks)
  const duration = ((Date.now() - startTime) / 1000).toFixed(2)

  console.log(`✅ ${validCount} 个广告创意生成完成，耗时 ${duration}秒`)
  console.log(`   平均每个: ${(parseFloat(duration) / validCount).toFixed(2)}秒`)

  return results
}

/**
 * 🆕 2025-12-16: 生成内部 coverage 广告创意
 *
 * 说明：
 * 1. 这不是第4种创意类型，而是内部 coverage 模式
 * 2. 关键词覆盖品牌关联的商品需求，但运行时统一归一化到 D / product_intent
 * 3. 优化 Ad Strength 评分，同时保持与真实商品需求一致
 *
 * @param offerId Offer ID
 * @param userId 用户ID
 * @param keywordPool 关键词池
 * @param options 可选配置
 * @returns 生成的 coverage 创意
 */
export async function generateSyntheticCreative(
  offerId: number,
  userId: number,
  keywordPool: any,  // OfferKeywordPool
  options?: {
    skipCache?: boolean
    maxNonBrandKeywords?: number
    minSearchVolume?: number
  }
): Promise<GeneratedAdCreativeData & { ai_model: string }> {
  console.log(`\n🔮 开始生成内部 coverage 广告创意 (Offer #${offerId})...`)

  // 1. 获取offer信息
  const db = await getDatabase()
  const offer = await db.queryOne(
    'SELECT target_country, target_language FROM offers WHERE id = ? AND user_id = ?',
    [offerId, userId]
  )
  if (!offer) {
    throw new Error('Offer不存在或无权访问')
  }

  // 2. 使用关键词池服务获取商品需求 coverage 关键词
  const { getCoverageBucketKeywords, DEFAULT_COVERAGE_KEYWORD_CONFIG } = await import('./offer-keyword-pool')

  const config = {
    ...DEFAULT_COVERAGE_KEYWORD_CONFIG,
    maxNonBrandKeywords: options?.maxNonBrandKeywords || DEFAULT_COVERAGE_KEYWORD_CONFIG.maxNonBrandKeywords,
    minSearchVolume: options?.minSearchVolume || DEFAULT_COVERAGE_KEYWORD_CONFIG.minSearchVolume,
    language: normalizeLanguageCode((offer as any).target_language || 'en'),
  }

  const targetCountry = (offer as any).target_country || 'US'
  const coverageKeywords = await getCoverageBucketKeywords(
    keywordPool,
    userId,
    targetCountry,
    config
  )

  // 3. 提取关键词列表
  const bucketKeywords = coverageKeywords.map(k => k.keyword)
  const brandKeywordCount = coverageKeywords.filter(k => k.isBrand).length
  const nonBrandKeywordCount = coverageKeywords.filter(k => !k.isBrand).length

  console.log(`📊 Coverage 关键词准备完成:`)
  console.log(`   - 品牌词: ${brandKeywordCount}个`)
  console.log(`   - 高搜索量非品牌词: ${nonBrandKeywordCount}个`)
  console.log(`   - 总计: ${bucketKeywords.length}个`)

  // 4. 调用通用创意生成函数（内部 coverage 模式，统一归一化到 D / product_intent）
  const result = await generateAdCreative(offerId, userId, {
    theme: '商品需求覆盖导向 - Coverage Creative for Product Demand',
    skipCache: options?.skipCache ?? true,
    keywordPool,
    bucket: 'D',
    bucketKeywords,
    bucketIntent: '商品需求导向',
    bucketIntentEn: 'Product Demand Coverage',
    isSyntheticCreative: true,
    syntheticKeywordsWithVolume: coverageKeywords,
  })

  console.log(`✅ 内部 coverage 广告创意生成完成`)
  console.log(`   - Headlines: ${result.headlines?.length || 0}个`)
  console.log(`   - Descriptions: ${result.descriptions?.length || 0}个`)
  console.log(`   - Keywords: ${result.keywords?.length || 0}个`)

  return result
}

/**
 * ============================================================================
 * 自动多样性检查和重新生成
 * ============================================================================
 * 生成多个创意时，自动检查相似度，不符合要求则重新生成
 */

/**
 * 计算两个文本的相似度 (0-1)
 * 使用加权多算法
 */
function calculateTextSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0

  // 1. Jaccard 相似度 (词集合) - 30%
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 0))
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 0))

  if (words1.size === 0 && words2.size === 0) return 1
  if (words1.size === 0 || words2.size === 0) return 0

  const intersection = new Set([...words1].filter(word => words2.has(word)))
  const union = new Set([...words1, ...words2])
  const jaccardSimilarity = union.size > 0 ? intersection.size / union.size : 0

  // 2. 简单的词频相似度 - 30%
  const allWords = new Set([...words1, ...words2])
  let dotProduct = 0
  let mag1 = 0
  let mag2 = 0

  for (const word of allWords) {
    const count1 = text1.toLowerCase().split(word).length - 1
    const count2 = text2.toLowerCase().split(word).length - 1
    dotProduct += count1 * count2
    mag1 += count1 * count1
    mag2 += count2 * count2
  }

  const cosineSimilarity = mag1 > 0 && mag2 > 0 ? dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2)) : 0

  // 3. 编辑距离相似度 - 20%
  const maxLen = Math.max(text1.length, text2.length)
  const editDistance = calculateEditDistance(text1, text2)
  const levenshteinSimilarity = maxLen > 0 ? 1 - editDistance / maxLen : 0

  // 4. N-gram 相似度 - 20%
  const ngrams1 = getNgrams(text1, 2)
  const ngrams2 = getNgrams(text2, 2)
  const ngramIntersection = ngrams1.filter(ng => ngrams2.includes(ng)).length
  const ngramUnion = new Set([...ngrams1, ...ngrams2]).size
  const ngramSimilarity = ngramUnion > 0 ? ngramIntersection / ngramUnion : 0

  // 加权平均
  const weightedSimilarity =
    jaccardSimilarity * 0.3 +
    cosineSimilarity * 0.3 +
    levenshteinSimilarity * 0.2 +
    ngramSimilarity * 0.2

  return Math.min(1, Math.max(0, weightedSimilarity))
}

/**
 * 计算编辑距离 (Levenshtein Distance)
 */
function calculateEditDistance(str1: string, str2: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i]
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }

  return matrix[str2.length][str1.length]
}

/**
 * 提取 N-gram
 */
function getNgrams(text: string, n: number): string[] {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0)
  const ngrams: string[] = []

  for (let i = 0; i <= words.length - n; i++) {
    ngrams.push(words.slice(i, i + n).join(' '))
  }

  return ngrams
}

/**
 * 检查创意集合中的多样性
 * 返回相似度过高的创意对
 */
function validateCreativeDiversity(
  creatives: GeneratedAdCreativeData[],
  maxSimilarity: number = 0.2
): {
  valid: boolean
  issues: string[]
  similarities: Array<{
    creative1Index: number
    creative2Index: number
    similarity: number
    type: 'headline' | 'description' | 'keyword'
  }>
} {
  const issues: string[] = []
  const similarities: any[] = []

  for (let i = 0; i < creatives.length; i++) {
    for (let j = i + 1; j < creatives.length; j++) {
      // 检查标题相似度
      const headlineSimilarity = calculateCreativeHeadlineSimilarity(
        creatives[i].headlines,
        creatives[j].headlines
      )

      if (headlineSimilarity > maxSimilarity) {
        issues.push(
          `创意 ${i + 1} 和 ${j + 1} 的标题相似度过高: ${(headlineSimilarity * 100).toFixed(1)}% > ${maxSimilarity * 100}%`
        )
        similarities.push({
          creative1Index: i,
          creative2Index: j,
          similarity: headlineSimilarity,
          type: 'headline'
        })
      }

      // 检查描述相似度
      const descriptionSimilarity = calculateCreativeDescriptionSimilarity(
        creatives[i].descriptions,
        creatives[j].descriptions
      )

      if (descriptionSimilarity > maxSimilarity) {
        issues.push(
          `创意 ${i + 1} 和 ${j + 1} 的描述相似度过高: ${(descriptionSimilarity * 100).toFixed(1)}% > ${maxSimilarity * 100}%`
        )
        similarities.push({
          creative1Index: i,
          creative2Index: j,
          similarity: descriptionSimilarity,
          type: 'description'
        })
      }

      // 检查关键词相似度
      const keywordSimilarity = calculateCreativeKeywordSimilarity(
        creatives[i].keywords,
        creatives[j].keywords
      )

      if (keywordSimilarity > maxSimilarity) {
        issues.push(
          `创意 ${i + 1} 和 ${j + 1} 的关键词相似度过高: ${(keywordSimilarity * 100).toFixed(1)}% > ${maxSimilarity * 100}%`
        )
        similarities.push({
          creative1Index: i,
          creative2Index: j,
          similarity: keywordSimilarity,
          type: 'keyword'
        })
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    similarities
  }
}

/**
 * 计算两个创意的标题相似度
 */
function calculateCreativeHeadlineSimilarity(
  headlines1: string[],
  headlines2: string[]
): number {
  let totalSimilarity = 0
  let comparisons = 0

  for (const h1 of headlines1.slice(0, 3)) {
    for (const h2 of headlines2.slice(0, 3)) {
      totalSimilarity += calculateTextSimilarity(h1, h2)
      comparisons++
    }
  }

  return comparisons > 0 ? totalSimilarity / comparisons : 0
}

/**
 * 计算两个创意的描述相似度
 */
function calculateCreativeDescriptionSimilarity(
  descriptions1: string[],
  descriptions2: string[]
): number {
  let totalSimilarity = 0
  let comparisons = 0

  for (const d1 of descriptions1) {
    for (const d2 of descriptions2) {
      totalSimilarity += calculateTextSimilarity(d1, d2)
      comparisons++
    }
  }

  return comparisons > 0 ? totalSimilarity / comparisons : 0
}

/**
 * 计算两个创意的关键词相似度
 */
function calculateCreativeKeywordSimilarity(
  keywords1: string[],
  keywords2: string[]
): number {
  const set1 = new Set(keywords1.map(k => k.toLowerCase()))
  const set2 = new Set(keywords2.map(k => k.toLowerCase()))

  const intersection = new Set([...set1].filter(k => set2.has(k)))
  const union = new Set([...set1, ...set2])

  return union.size > 0 ? intersection.size / union.size : 0
}

/**
 * 生成多个创意，确保多样性
 * 如果相似度过高，自动重新生成
 *
 * ✅ 安全修复：userId改为必需参数
 */
export async function generateMultipleCreativesWithDiversityCheck(
  offerId: number,
  userId: number,  // ✅ 修复：改为必需参数
  count: number = 3,
  maxSimilarity: number = 0.2,
  maxRetries: number = 3,
  options?: {
    theme?: string
    referencePerformance?: any
    skipCache?: boolean
    excludeKeywords?: string[]
    retryFailureType?: RetryFailureType
    searchTermFeedbackHints?: SearchTermFeedbackHintsInput
  }
): Promise<{
  creatives: GeneratedAdCreativeData[]
  diversityCheck: {
    valid: boolean
    issues: string[]
    similarities: any[]
  }
  stats: {
    totalAttempts: number
    successfulCreatives: number
    failedAttempts: number
    totalTime: number
  }
}> {
  const creatives: GeneratedAdCreativeData[] = []
  let totalAttempts = 0
  let failedAttempts = 0
  const startTime = Date.now()

  console.log(`\n🎯 开始生成 ${count} 个多样化创意 (最大相似度: ${maxSimilarity * 100}%)`)

  while (creatives.length < count && failedAttempts < maxRetries) {
    totalAttempts++
    console.log(`\n📝 生成创意 ${creatives.length + 1}/${count} (尝试 ${totalAttempts})...`)

    try {
      // 生成新创意
      const newCreative = await generateAdCreative(offerId, userId, {
        ...options,
        skipCache: true
      })

      // 检查与现有创意的多样性
      if (creatives.length === 0) {
        // 第一个创意直接添加
        creatives.push(newCreative)
        console.log(`✅ 创意 1 已添加`)
      } else {
        // 检查与现有创意的相似度
        const tempCreatives = [...creatives, newCreative]
        const diversityCheck = validateCreativeDiversity(tempCreatives, maxSimilarity)

        if (diversityCheck.valid) {
          // 通过多样性检查
          creatives.push(newCreative)
          console.log(`✅ 创意 ${creatives.length} 通过多样性检查`)
        } else {
          // 未通过多样性检查
          failedAttempts++
          console.warn(`⚠️  创意未通过多样性检查，原因:`)
          diversityCheck.issues.forEach(issue => {
            console.warn(`   - ${issue}`)
          })

          if (failedAttempts < maxRetries) {
            console.log(`   重新生成... (${failedAttempts}/${maxRetries})`)
          }
        }
      }
    } catch (error) {
      failedAttempts++
      console.error(`❌ 生成创意失败:`, error instanceof Error ? error.message : '未知错误')

      if (failedAttempts >= maxRetries) {
        console.warn(`⚠️  达到最大重试次数 (${maxRetries})`)
      }
    }
  }

  const totalTime = (Date.now() - startTime) / 1000

  // 最终多样性检查
  const finalDiversityCheck = validateCreativeDiversity(creatives, maxSimilarity)

  console.log(`\n📊 生成完成:`)
  console.log(`   ✅ 成功创意: ${creatives.length}/${count}`)
  console.log(`   ❌ 失败尝试: ${failedAttempts}`)
  console.log(`   📈 总尝试数: ${totalAttempts}`)
  console.log(`   ⏱️  总耗时: ${totalTime.toFixed(2)}秒`)

  if (finalDiversityCheck.valid) {
    console.log(`\n✅ 所有创意通过多样性检查！`)
  } else {
    console.log(`\n⚠️  部分创意未通过多样性检查:`)
    finalDiversityCheck.issues.forEach(issue => {
      console.log(`   - ${issue}`)
    })
  }

  return {
    creatives,
    diversityCheck: finalDiversityCheck,
    stats: {
      totalAttempts,
      successfulCreatives: creatives.length,
      failedAttempts,
      totalTime
    }
  }
}
