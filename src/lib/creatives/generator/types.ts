import { type KeywordPlannerPreparedSession } from '@/lib/google-ads/accounts/auth/index'

// 🔥 AI语义分类
// 🎯 新增：导入否定关键词生成函数
// 🎯 新增：导入token追踪函数
// 🎯 v3.0: 导入数据库prompt加载函数
// 🎯 购买意图评分

// 🔥 优化：Google Ads关键词标准化去重
import type { CreativeKeywordMatchType, KeywordAuditMetadata } from '../../keywords/server'

// 🔥 2025-12-28: 导入关键词质量过滤函数 🔥 2026-01-02: 补充导入纯品牌词函数 🔥 2026-01-05: 改为 shouldUseExactMatch 策略函数 🔥 2026-03-13: 补充导入品牌变体和语义查询过滤函数
// 🔥 2026-03-13: 导入纯品牌词判断函数

import { type GoogleAdsPolicyGuardMode } from '@/lib/google-ads/policy/policy-guard'

export type RetryFailureType = 'evidence_fail' | 'intent_fail' | 'format_fail'

export interface SearchTermFeedbackHintsInput {
  hardNegativeTerms?: string[]
  softSuppressTerms?: string[]
  highPerformingTerms?: string[]
}

export interface PromptRuntimeGuidanceOptions {
  retryFailureType?: RetryFailureType
  searchTermFeedbackHints?: SearchTermFeedbackHintsInput
  policyGuardMode?: GoogleAdsPolicyGuardMode
  precomputedKeywordSet?: PrecomputedCreativeKeywordSet | null
}

export interface PrecomputedCreativeKeywordSet {
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

export interface TitleAboutSignals {
  productTitle: string
  titlePhrases: string[]
  aboutClaims: string[]
  keywordSeeds: string[]
  calloutIdeas: string[]
  sitelinkIdeas: Array<{ text: string; description: string }>
}

export type HeadlineCandidateSource = 'title' | 'about'

export interface BrandAnchoredHeadlineCandidate {
  text: string
  source: HeadlineCandidateSource
}

export interface AdCreativePromptKeywordPlan {
  promptKeywords: string[]
  validatedPromptKeywords: string[]
  contextualPromptKeywords: string[]
  policyMatchedTerms: string[]
}

export type SupportedSoftCopyLanguage =
  | 'en'
  | 'fr'
  | 'de'
  | 'es'
  | 'it'
  | 'pt'
  | 'zh'
  | 'ja'
  | 'ko'
  | 'ru'
  | 'ar'

export interface CopyPatternSet {
  transactional: RegExp
  trust: RegExp
  scenario: RegExp
  solution: RegExp
  pain: RegExp
  cta: RegExp
  ctaPhrases: string[]
}

export type NormalizedCreativeBucket = 'A' | 'B' | 'D' | null

export type CopyIntentTag = 'brand' | 'scenario' | 'solution' | 'transactional' | 'other'

export type ComplementarityTag = 'brand' | 'scenario' | 'transactional' | 'other'

export type DescriptionStructureTag =
  | 'pain_solution_cta'
  | 'benefit_cta'
  | 'trust_cta'
  | 'value_cta'
  | 'other'

export interface SoftCopyTemplates {
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

export interface ApplyKeywordSupplementationOnceInput {
  offer: any
  userId: number
  brandName: string
  targetLanguage: string
  keywordsWithVolume: KeywordWithVolume[]
  poolCandidates?: string[]
  triggerThreshold?: number
  supplementCap?: number
  bucket?: 'A' | 'B' | 'C' | 'D' | 'S' | null // 🔥 优化(2026-03-13): 添加 bucket 字段用于意图一致性检查
  skipAiRanking?: boolean
}

export interface ApplyKeywordSupplementationOnceOutput {
  keywordsWithVolume: KeywordWithVolume[]
  keywords: string[]
  keywordSupplementation: KeywordSupplementationReport
}

export interface SupplementCandidateAssessment {
  candidate: string
  score: number
  keep: boolean
  reason?: string
}

export interface RankSupplementCandidatesWithModelInput {
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

export interface BuildKeywordSupplementScoringPromptInput {
  source: 'keyword_pool' | 'title_about'
  brandName: string
  targetLanguage: string
  titleLine: string
  aboutBlock: string
  existingLines: string
  candidateLines: string
}

export interface ExtractedKeywordForMerge {
  keyword?: string
  searchVolume: number
  competition?: string
  competitionIndex?: number
  volumeUnavailableReason?: 'DEV_TOKEN_INSUFFICIENT_ACCESS'
  source?: string // 🆕 2026-03-13: 支持SCORING_SUGGESTION等来源标记
  sourceType?: string
}

export interface MergeExtractedKeywordsInput {
  keywordsWithVolume: KeywordWithVolume[]
  extractedKeywords: ExtractedKeywordForMerge[]
  brandName: string
  productCategory: string
  userId: number
  offerId?: number
  plannerSession?: KeywordPlannerPreparedSession
  targetCountry: string
  language: string
  creativeType?: 'brand_intent' | 'model_intent' | 'product_intent' | null
  fallbackMode?: boolean
}

export interface MergeExtractedKeywordsOutput {
  keywordsWithVolume: KeywordWithVolume[]
}

export interface KeywordFinalizeInput {
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
  plannerSession?: KeywordPlannerPreparedSession
}

export interface KeywordFinalizeOutput {
  keywordsWithVolume: KeywordWithVolume[]
  keywords: string[]
}

export interface CreativeTargetLanguageResolution {
  languageCode: string
  languageName: string
  targetCountry: string
  usedCountryFallback: boolean
}

export type BucketType = 'A' | 'B' | 'C' | 'D' | 'S'

/**
 * 🆕 v4.16: 根据 bucket 和链接类型获取对应的 theme 描述
 *
 * @param bucket - 创意类型（A/B/C/D/S，运行时归一化为 A/B/D）
 * @param linkType - 链接类型（'product' | 'store'）
 * @returns theme 描述字符串
 */

export type AdCreativeRetryMode = 'simplified' | 'emergency'

export type AdCreativeRetryPlan = {
  mode: AdCreativeRetryMode
  reason: string
}
