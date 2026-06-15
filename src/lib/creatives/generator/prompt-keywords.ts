// 🔥 AI语义分类
// 🎯 新增：导入否定关键词生成函数
// 🎯 新增：导入token追踪函数
// 🎯 v3.0: 导入数据库prompt加载函数
// 🎯 购买意图评分
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer' // 🔥 优化：Google Ads关键词标准化去重

import { containsPureBrand, getPureBrandKeywords } from '../../keywords'
import { isBrandConcatenation } from '../../keywords' // 🔥 2025-12-28: 导入关键词质量过滤函数 🔥 2026-01-02: 补充导入纯品牌词函数 🔥 2026-01-05: 改为 shouldUseExactMatch 策略函数 🔥 2026-03-13: 补充导入品牌变体和语义查询过滤函数
// 🔥 2026-03-13: 导入纯品牌词判断函数

import { classifyKeywordIntent } from '../../keywords'
import { KEYWORD_POLICY } from '../../keywords/keyword-policy'
import { analyzeKeywordLanguageCompatibility } from '../../keywords'
import {
  type GoogleAdsPolicyGuardMode,
  resolveGoogleAdsPolicyGuardMode,
  sanitizeKeywordListForGoogleAdsPolicy,
} from '@/lib/google-ads/policy/policy-guard'

import type { AdCreativePromptKeywordPlan, TitleAboutSignals } from './types'
import {
  dedupeKeywordSeeds,
  isUsefulCreativePhrase,
  normalizeSnippetText,
  truncateSnippetByWords,
} from './utils'

export const PROMPT_KEYWORD_LIMIT = KEYWORD_POLICY.creative.promptKeywordLimit

export const TITLE_ABOUT_SEED_RATIO_CAP = KEYWORD_POLICY.creative.titleAboutSeedRatioCap

export function filterHighIntentKeywordSeeds(keywords: string[], language: string): string[] {
  return keywords.filter((keyword) => {
    const intentInfo = classifyKeywordIntent(keyword, { language })
    if (intentInfo.hardNegative) return false
    return intentInfo.intent === 'TRANSACTIONAL' || intentInfo.intent === 'COMMERCIAL'
  })
}

export function getSeedCapByRatio(validatedKeywordCount: number): number {
  if (validatedKeywordCount <= 0) return 0
  // seed/(validated+seed) <= 20%  => seed <= validated * 0.25
  return Math.floor(
    validatedKeywordCount * (TITLE_ABOUT_SEED_RATIO_CAP / (1 - TITLE_ABOUT_SEED_RATIO_CAP))
  )
}

export function filterPhrasesByTargetLanguageGate(params: {
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

  const extractedKeywords = Array.isArray(input.extractedKeywords) ? input.extractedKeywords : []
  const aiKeywords = Array.isArray(input.aiKeywords) ? input.aiKeywords : []
  const titleAboutKeywordSeeds = Array.isArray(input.titleAboutKeywordSeeds)
    ? input.titleAboutKeywordSeeds
    : []

  const rawBaseKeywordsForPrompt =
    extractedKeywords.length > 0
      ? extractedKeywords.map((item: any) => (typeof item === 'string' ? item : item?.keyword))
      : aiKeywords.filter(brandFilter).slice(0, 15)
  const baseKeywordsPolicySafe = sanitizeKeywordListForGoogleAdsPolicy(rawBaseKeywordsForPrompt, {
    mode: policyGuardMode,
  })
  const baseKeywordsLanguageSafe = filterPhrasesByTargetLanguageGate({
    phrases: baseKeywordsPolicySafe.items,
    targetLanguage: input.targetLanguage,
    pureBrandKeywords: brandGateKeywords,
  })

  const validatedPromptKeywords = dedupeKeywordSeeds(
    baseKeywordsLanguageSafe.phrases,
    PROMPT_KEYWORD_LIMIT
  )
  const titleAboutSeedsPolicySafe = sanitizeKeywordListForGoogleAdsPolicy(titleAboutKeywordSeeds, {
    mode: policyGuardMode,
  })
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
    policyMatchedTerms: Array.from(
      new Set([...baseKeywordsPolicySafe.matchedTerms, ...titleAboutSeedsPolicySafe.matchedTerms])
    ).slice(0, 12),
  }
}

export function countBrandContainingKeywords(
  keywords: Array<{ keyword: string; searchVolume?: number }>,
  brandName: string,
  brandTokensToMatch: string[]
): number {
  if (!Array.isArray(keywords) || keywords.length === 0) return 0
  return keywords.filter((kw) => {
    const keyword = String(kw.keyword || '').trim()
    if (!keyword) return false
    if (containsPureBrand(keyword, brandTokensToMatch)) return true
    return (
      typeof kw.searchVolume === 'number' &&
      kw.searchVolume > 0 &&
      isBrandConcatenation(keyword, brandName)
    )
  }).length
}

export function extractTitleAndAboutSignals(
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

  const addUniquePhrase = (
    target: string[],
    value: string,
    maxItems: number,
    minLength: number = 4,
    maxLength: number = 90
  ) => {
    const normalized = normalizeSnippetText(value)
    if (!isUsefulCreativePhrase(normalized, minLength, maxLength)) return
    const key = normalized.toLowerCase()
    if (target.some((item) => item.toLowerCase() === key)) return
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
    if (!isUsefulCreativePhrase(linkText, 3, 25) || !isUsefulCreativePhrase(linkDescription, 4, 35))
      return
    const key = `${linkText.toLowerCase()}__${linkDescription.toLowerCase()}`
    if (
      sitelinkIdeas.some(
        (item) => `${item.text.toLowerCase()}__${item.description.toLowerCase()}` === key
      )
    )
      return
    sitelinkIdeas.push({ text: linkText, description: linkDescription })
  }

  if (productTitle) {
    addKeywordSeed(productTitle)
    addUniquePhrase(titlePhrases, truncateSnippetByWords(productTitle, 70), 6, 6, 80)

    const titleSegments = productTitle
      .split(/\s*[|:,\-–—]\s*/g)
      .map((segment) => truncateSnippetByWords(segment, 60))
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
  const languageSafeTitle =
    filterPhrasesByTargetLanguageGate({
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
  const languageSafeSitelinks = sitelinkIdeas.slice(0, 6).filter((item) => {
    const textSafe =
      filterPhrasesByTargetLanguageGate({
        phrases: [item.text],
        targetLanguage: options?.targetLanguage,
        pureBrandKeywords,
      }).phrases.length > 0
    const descriptionSafe =
      filterPhrasesByTargetLanguageGate({
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
