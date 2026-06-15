import type {
  CreativeKeywordUsagePlan,
  GeneratedAdCreativeData,
  HeadlineAsset,
  DescriptionAsset,
} from '../ad-creative'

// 🔥 AI语义分类
import { generateContent } from '../gemini'
// 🎯 新增：导入否定关键词生成函数
import { recordTokenUsage, estimateTokenCost } from '../ai-token-tracker' // 🎯 新增：导入token追踪函数
// 🎯 v3.0: 导入数据库prompt加载函数
// 🎯 购买意图评分
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer' // 🔥 优化：Google Ads关键词标准化去重
import { getKeywordSourcePriorityScoreFromInput } from '../creative-keyword-source-priority'

import {
  containsPureBrand,
  getPureBrandKeywords,
  isBrandVariant,
  isSemanticQuery,
} from '../keyword-quality-filter' // 🔥 2025-12-28: 导入关键词质量过滤函数 🔥 2026-01-02: 补充导入纯品牌词函数 🔥 2026-01-05: 改为 shouldUseExactMatch 策略函数 🔥 2026-03-13: 补充导入品牌变体和语义查询过滤函数
import { isPureBrandKeyword } from '../brand-keyword-utils' // 🔥 2026-03-13: 导入纯品牌词判断函数

import {
  getGoogleAdsTextEffectiveLength,
  sanitizeGoogleAdsAdText,
} from '@/lib/google-ads/common/ad-text'
import { classifyKeywordIntent } from '../keyword-intent'

import {
  buildLanguageSafeUsagePlan,
  enforceLanguagePurityGate,
  getCopyPatterns,
  getCtaPhrasesForLanguage,
  getCtaRegexForLanguage,
  isHeadlineCompatibleWithTargetLanguage,
  resolveSoftCopyLanguage,
  toLanguageCompatibleKeywordList,
} from './language'
import { buildDkiKeywordHeadline, detectKeywordIntentsForPrompt } from './prompts'
import type {
  BrandAnchoredHeadlineCandidate,
  ComplementarityTag,
  CopyIntentTag,
  DescriptionStructureTag,
  HeadlineCandidateSource,
  NormalizedCreativeBucket,
  PrecomputedCreativeKeywordSet,
  SoftCopyTemplates,
  SupportedSoftCopyLanguage,
} from './types'
import {
  calculateTextSimilarity,
  escapeRegex,
  isUsefulCreativePhrase,
  normalizeSnippetText,
  truncateSnippetByWords,
} from './utils'
import {
  HEADLINE2_BANNED_TOKENS,
  HEADLINE2_INTENT_TOKENS,
  HEADLINE2_STOPWORDS,
  HEADLINE_DANGLING_TAIL_TOKENS,
  isLikelyModelCodeToken,
  normalizeBrandFreeText,
  normalizeHeadline2KeywordCandidate,
  tokenizeHeadline2Keyword,
} from './contract/response-handling'

export const TOP_HEADLINE_SLOT_START_INDEX = 1

export const TOP_HEADLINE_SLOT_COUNT = 3

export const TOP_HEADLINE_MAX_LENGTH = 30

export const TOP_HEADLINE_SEMANTIC_DUPLICATE_THRESHOLD = 0.78

export const RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX = 4

export const RETAINED_KEYWORD_HEADLINE_SLOT_COUNT = 3

export const RETAINED_KEYWORD_DESCRIPTION_SLOT_START_INDEX = 0

export const RETAINED_KEYWORD_DESCRIPTION_SLOT_COUNT = 2

export const RETAINED_KEYWORD_HEADLINE_MAX_LENGTH = 30

export const RETAINED_KEYWORD_DESCRIPTION_MAX_LENGTH = 90

export const RETAINED_KEYWORD_PROTECTED_HEADLINE_COUNT = 4

export const RETAINED_KEYWORD_PROTECTED_SIMILARITY_THRESHOLD = 0.82

export const GOOGLE_ADS_HEADLINE_UNIQUENESS_SUFFIXES = [
  'Now',
  'Today',
  'Deals',
  'Official',
  'Shop',
] as const

export const LATIN_HEADLINE_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
])

export function normalizeHeadlineCandidateText(value: string): string {
  return normalizeSnippetText(value)
    .replace(/[{}]/g, '')
    .replace(/[•|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function shouldSplitTitleSegmentAt(raw: string, index: number): boolean {
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

export function splitTitleSegmentsSafely(title: string): string[] {
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

export function trimTextToWordBoundary(text: string, maxLength: number): string {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (normalized.length <= maxLength) return normalized
  if (maxLength <= 0) return ''

  let truncated = normalized.slice(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')
  if (lastSpace >= Math.max(6, Math.floor(maxLength * 0.55))) {
    truncated = truncated.slice(0, lastSpace)
  }

  return truncated.replace(/\s+/g, ' ').trim()
}

export function dropDanglingTailFragment(text: string): string {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
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

export function balanceHeadlineParentheses(text: string): string {
  let normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
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

export function stripHeadlineTrailingPunctuation(text: string): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[;,.:|/&+\-]+$/g, '')
    .trim()
}

export function trimDanglingHeadlineTailToken(text: string): string {
  let normalized = stripHeadlineTrailingPunctuation(text)
  if (!normalized) return normalized

  for (let i = 0; i < 2; i += 1) {
    const parts = normalized.split(/\s+/).filter(Boolean)
    if (parts.length < 2) break

    const tailToken = parts[parts.length - 1].toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

    if (!tailToken || !HEADLINE_DANGLING_TAIL_TOKENS.has(tailToken)) {
      break
    }

    normalized = stripHeadlineTrailingPunctuation(parts.slice(0, -1).join(' '))
  }

  return normalized
}

export function applyHeadlineTextGuardrail(text: string, maxLength: number): string {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
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

export function stripHeadlineNumericSuffixArtifact(text: string): string {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return normalized
  // Historical dedupe fallback used one-digit numeric suffixes (e.g. "Headline 2").
  // Keep legitimate product specs like "12 inch" / "14 inch" intact.
  const match = normalized.match(/^(.*\D)\s([2-9])$/)
  if (!match) return normalized
  const base = match[1].trim()
  if (base.length < 8) return normalized
  return base
}

export function applyDescriptionTextGuardrail(text: string, maxLength: number): string {
  let normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
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

export function normalizeBrandNameForHeadline(brandName: string): string {
  return normalizeSnippetText(String(brandName || ''))
    .replace(/[{}]/g, '')
    .trim()
}

export function hasBrandAnchorInHeadline(
  text: string,
  brandName: string,
  brandTokensToMatch: string[]
): boolean {
  if (!text) return false
  if (brandTokensToMatch.length > 0) {
    return containsPureBrand(text, brandTokensToMatch)
  }
  const normalizedBrand = normalizeBrandNameForHeadline(brandName)
  if (!normalizedBrand) return true
  return text.toLowerCase().includes(normalizedBrand.toLowerCase())
}

export function stripRepeatedBrandPrefix(text: string, brandName: string): string {
  const normalizedBrand = normalizeBrandNameForHeadline(brandName)
  if (!normalizedBrand) return normalizeHeadlineCandidateText(text)
  const repeatedPattern = new RegExp(`^(?:${escapeRegex(normalizedBrand)}\\s+){2 }`, 'i')
  return normalizeHeadlineCandidateText(text).replace(repeatedPattern, `${normalizedBrand} `).trim()
}

export function compressLatinHeadline(text: string): string {
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

export function isLowValueHeadlineCandidate(text: string, brandName: string): boolean {
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

export function fitBrandAnchoredHeadline(
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

    if (
      !hasBrandAnchorInHeadline(candidate, normalizedBrand, brandTokensToMatch) &&
      normalizedBrand
    ) {
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

export function isSemanticallyDuplicateHeadline(
  candidate: string,
  existing: string[],
  brandName: string
): boolean {
  const candidateCore = normalizeGoogleAdsKeyword(
    normalizeBrandFreeText(candidate, brandName) || candidate
  )
  if (!candidateCore) return false

  for (const current of existing) {
    const currentCore = normalizeGoogleAdsKeyword(
      normalizeBrandFreeText(current, brandName) || current
    )
    if (!currentCore) continue
    if (candidateCore === currentCore) return true
    if (
      (candidateCore.length >= 8 && candidateCore.includes(currentCore)) ||
      (currentCore.length >= 8 && currentCore.includes(candidateCore))
    ) {
      return true
    }
    if (
      calculateTextSimilarity(candidateCore, currentCore) >=
      TOP_HEADLINE_SEMANTIC_DUPLICATE_THRESHOLD
    ) {
      return true
    }
  }

  return false
}

export function collectUniqueHeadlineCandidates(
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
    const fitted = fitBrandAnchoredHeadline(
      raw,
      options.brandName,
      options.brandTokensToMatch,
      options.maxLength
    )
    if (!fitted) continue
    if (!isHeadlineCompatibleWithTargetLanguage(fitted, options.targetLanguage)) continue

    const normalized = normalizeGoogleAdsKeyword(
      normalizeBrandFreeText(fitted, options.brandName) || fitted
    )
    if (!normalized || seen.has(normalized)) continue
    if (
      isSemanticallyDuplicateHeadline(
        fitted,
        out.map((item) => item.text),
        options.brandName
      )
    )
      continue

    seen.add(normalized)
    out.push({ text: fitted, source })
    if (out.length >= options.limit) break
  }

  return out
}

export function extractTitlePriorityHeadlineCandidates(options: {
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

  const titleSegments = splitTitleSegmentsSafely(title).filter((segment) =>
    isUsefulCreativePhrase(segment, 4, 140)
  )

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

export function extractAboutFeatureHeadlineCandidates(options: {
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

export function buildBrandAnchoredTopHeadlines(options: {
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
    if (
      isSemanticallyDuplicateHeadline(
        candidate.text,
        selected.map((item) => item.text),
        options.brandName
      )
    )
      continue
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
    if (
      isSemanticallyDuplicateHeadline(
        candidate.text,
        selected.map((item) => item.text),
        options.brandName
      )
    )
      continue
    selected.push(candidate)
    if (selected.length >= options.targetCount) break
  }

  return selected.slice(0, options.targetCount)
}

export function syncHeadlineMetadataSlot(
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

export function syncDescriptionMetadataSlot(
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
  const brandTokensToMatch =
    Array.isArray(options.brandTokensToMatch) && options.brandTokensToMatch.length > 0
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

export function textContainsKeyword(text: string, keyword: string): boolean {
  const normalizedText = String(text || '').toLowerCase()
  const normalizedKeyword = String(keyword || '')
    .toLowerCase()
    .trim()
  if (!normalizedText || !normalizedKeyword) return false
  if (normalizedText.includes(normalizedKeyword)) return true
  const keywordRoot = normalizedKeyword.replace(/s$|ing$|ed$/g, '')
  return keywordRoot.length >= 3 && normalizedText.includes(keywordRoot)
}

export function headlineContainsKeyword(headline: string, keywords: string[]): boolean {
  return keywords.some((keyword) => textContainsKeyword(headline, keyword))
}

export function cycleKeywordTargets(keywords: string[], count: number): string[] {
  const normalizedKeywords = keywords.map((keyword) => String(keyword || '').trim()).filter(Boolean)
  if (normalizedKeywords.length === 0 || count <= 0) return []

  const targets: string[] = []
  while (targets.length < count) {
    targets.push(normalizedKeywords[targets.length % normalizedKeywords.length])
  }
  return targets
}

export function getContractRoleScore(role: unknown): number {
  const normalized = String(role || '')
    .trim()
    .toLowerCase()
  if (normalized === 'required') return 240
  if (normalized === 'optional') return 120
  if (normalized === 'fallback') return 0
  return 40
}

export function getEvidenceStrengthScore(strength: unknown): number {
  const normalized = String(strength || '')
    .trim()
    .toLowerCase()
  if (normalized === 'high') return 60
  if (normalized === 'medium') return 30
  if (normalized === 'low') return 10
  return 20
}

export function getKeywordFitScore(keyword: string, maxLength: number): number {
  const effectiveLength = getGoogleAdsTextEffectiveLength(String(keyword || '').trim())
  if (effectiveLength <= 0) return -200
  if (effectiveLength > maxLength) {
    return Math.max(-160, -20 * (effectiveLength - maxLength))
  }
  if (effectiveLength <= Math.max(8, maxLength - 10)) return 40
  return 20
}

export function extractCreativeSlotSemanticTokens(
  keyword: string,
  brandName: string | null | undefined
): string[] {
  const semanticCore = normalizeBrandFreeText(keyword, String(brandName || ''))
  return tokenizeHeadline2Keyword(semanticCore)
    .filter((token) => token.length >= 2)
    .filter((token) => !HEADLINE2_STOPWORDS.has(token))
    .filter((token) => !HEADLINE2_INTENT_TOKENS.has(token))
    .filter((token) => !HEADLINE2_BANNED_TOKENS.has(token))
}

export function isKeywordEligibleForCreativeSlotContract(
  keyword: string,
  brandName: string | null | undefined
): boolean {
  const normalizedKeyword = stripHeadlineTrailingPunctuation(
    normalizeHeadline2KeywordCandidate(String(keyword || '').trim())
  )
  if (!isUsefulCreativePhrase(normalizedKeyword, 3, RETAINED_KEYWORD_DESCRIPTION_MAX_LENGTH)) {
    return false
  }

  const trailingToken =
    normalizedKeyword
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
    semanticTokens.every((token) => /^\d+$/.test(token)) ||
    semanticTokens.every((token) => token.length <= 2 && !isLikelyModelCodeToken(token))
  ) {
    return false
  }

  return semanticTokens.some(
    (token) =>
      token.length >= 3 ||
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Cyrillic}]/u.test(
        token
      ) ||
      isLikelyModelCodeToken(token)
  )
}

export function scoreKeywordUsageCandidate(
  candidate: NonNullable<PrecomputedCreativeKeywordSet['keywordsWithVolume']>[number],
  maxLength: number
): number {
  const sourceScore = getKeywordSourcePriorityScoreFromInput({
    source: candidate.source,
    sourceType: candidate.sourceSubtype || candidate.sourceType,
  })
  const volume = Number(candidate.searchVolume || 0)
  const volumeScore = volume > 0 ? Math.min(90, Math.round(Math.log10(volume + 1) * 24)) : 0
  const confidenceScore =
    typeof candidate.confidence === 'number'
      ? Math.max(0, Math.min(20, Math.round(candidate.confidence * 20)))
      : 0
  const exactBonus = candidate.matchType === 'EXACT' ? 16 : candidate.matchType === 'PHRASE' ? 8 : 0

  return (
    getContractRoleScore(candidate.contractRole) +
    sourceScore * 4 +
    getEvidenceStrengthScore(candidate.evidenceStrength) +
    volumeScore +
    confidenceScore +
    exactBonus +
    getKeywordFitScore(candidate.keyword, maxLength)
  )
}

export function dedupeKeywordUsageCandidates(
  brandName: string | null | undefined,
  precomputedKeywordSet?: PrecomputedCreativeKeywordSet | null
): NonNullable<PrecomputedCreativeKeywordSet['keywordsWithVolume']> {
  const fromKeywordObjects = Array.isArray(precomputedKeywordSet?.keywordsWithVolume)
    ? precomputedKeywordSet?.keywordsWithVolume || []
    : []
  const fallbackKeywords = Array.from(
    new Set([
      ...(precomputedKeywordSet?.executableKeywords || []).map((keyword) =>
        String(keyword || '').trim()
      ),
      ...(precomputedKeywordSet?.promptKeywords || []).map((keyword) =>
        String(keyword || '').trim()
      ),
    ])
  ).filter(Boolean)

  const combined: NonNullable<PrecomputedCreativeKeywordSet['keywordsWithVolume']> =
    fromKeywordObjects.length > 0
      ? fromKeywordObjects
      : fallbackKeywords.map((keyword) => ({
          keyword,
          searchVolume: 0,
        }))

  const pureBrandKeywords = getPureBrandKeywords(brandName || '')
  const seen = new Map<
    string,
    NonNullable<PrecomputedCreativeKeywordSet['keywordsWithVolume']>[number]
  >()

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

    const existingScore = scoreKeywordUsageCandidate(
      existing,
      RETAINED_KEYWORD_DESCRIPTION_MAX_LENGTH
    )
    const currentScore = scoreKeywordUsageCandidate(
      current,
      RETAINED_KEYWORD_DESCRIPTION_MAX_LENGTH
    )
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
  const headlineSlotCount = Math.max(
    1,
    input.headlineSlotCount ?? RETAINED_KEYWORD_HEADLINE_SLOT_COUNT
  )
  const descriptionSlotCount = Math.max(
    1,
    input.descriptionSlotCount ?? RETAINED_KEYWORD_DESCRIPTION_SLOT_COUNT
  )
  const candidates = dedupeKeywordUsageCandidates(input.brandName, input.precomputedKeywordSet)

  const rankedForHeadline = [...candidates].sort((left, right) => {
    const scoreDelta =
      scoreKeywordUsageCandidate(right, RETAINED_KEYWORD_HEADLINE_MAX_LENGTH) -
      scoreKeywordUsageCandidate(left, RETAINED_KEYWORD_HEADLINE_MAX_LENGTH)
    if (scoreDelta !== 0) return scoreDelta
    return left.keyword.localeCompare(right.keyword)
  })
  const rankedForDescription = [...candidates].sort((left, right) => {
    const scoreDelta =
      scoreKeywordUsageCandidate(right, RETAINED_KEYWORD_DESCRIPTION_MAX_LENGTH) -
      scoreKeywordUsageCandidate(left, RETAINED_KEYWORD_DESCRIPTION_MAX_LENGTH)
    if (scoreDelta !== 0) return scoreDelta
    return left.keyword.localeCompare(right.keyword)
  })

  const retainedNonBrandKeywords = rankedForDescription.map((item) => item.keyword)
  const headlineCoverageMode =
    retainedNonBrandKeywords.length < headlineSlotCount ? 'exhaustive_under_5' : 'top_5'

  const headlineTargets =
    headlineCoverageMode === 'exhaustive_under_5'
      ? cycleKeywordTargets(retainedNonBrandKeywords, headlineSlotCount)
      : rankedForHeadline.slice(0, headlineSlotCount).map((item) => item.keyword)

  const descriptionCandidates = rankedForDescription.filter(
    (item) =>
      !headlineTargets.some(
        (target) => normalizeGoogleAdsKeyword(target) === normalizeGoogleAdsKeyword(item.keyword)
      )
  )
  const descriptionTargets = cycleKeywordTargets(
    (descriptionCandidates.length > 0 ? descriptionCandidates : rankedForDescription).map(
      (item) => item.keyword
    ),
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

export function resolveEffectiveKeywordUsagePlan(input: {
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

  const fallbackKeywordsWithVolume = (input.keywordsWithVolume || [])
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

export function fitKeywordIntoHeadline(
  text: string,
  keyword: string,
  maxLength: number
): string | null {
  const trimmedKeyword = String(keyword || '').trim()
  if (!trimmedKeyword) return null
  if (textContainsKeyword(text, trimmedKeyword)) return text
  if (getGoogleAdsTextEffectiveLength(trimmedKeyword) > maxLength) return null

  const base = String(text || '')
    .trim()
    .replace(/[.!?]+$/g, '')
    .trim()
  const candidates = [
    `${trimmedKeyword} ${base}`.trim(),
    `${base} ${trimmedKeyword}`.trim(),
    trimmedKeyword,
  ]

  return (
    candidates.find(
      (candidate) => Boolean(candidate) && getGoogleAdsTextEffectiveLength(candidate) <= maxLength
    ) || null
  )
}

export function canonicalizeHeadlineActionPhrases(text: string, languageCode: string): string {
  let normalized = String(text || '').toLowerCase()
  const replacements = new Map<string, string>()

  for (const phrase of getCtaPhrasesForLanguage(languageCode)) {
    const normalizedPhrase = normalizeHeadlineCandidateText(phrase).toLowerCase()
    if (!normalizedPhrase) continue

    const withoutNow = normalizedPhrase.replace(/\bnow\b/gi, '').trim()
    const canonical = (
      withoutNow.split(/\s+/).filter(Boolean)[0] ||
      withoutNow ||
      normalizedPhrase
    ).trim()
    if (!canonical) continue

    replacements.set(normalizedPhrase, canonical)
    if (withoutNow) replacements.set(withoutNow, canonical)
  }

  const orderedSources = Array.from(replacements.keys()).sort(
    (left, right) => right.length - left.length
  )
  for (const source of orderedSources) {
    normalized = normalized.replace(
      new RegExp(escapeRegex(source), 'gi'),
      replacements.get(source) || source
    )
  }

  const canonicalRoots = Array.from(new Set(replacements.values())).sort(
    (left, right) => right.length - left.length
  )
  for (const root of canonicalRoots) {
    const trailingPattern = new RegExp(`^(.*?)\\s+${escapeRegex(root)}$`, 'i')
    const trailingMatch = normalized.match(trailingPattern)
    const body = trailingMatch?.[1]?.trim()
    if (!body || body === root) continue
    normalized = `${root} ${body}`.trim()
  }

  return normalized.replace(/\s+/g, ' ').trim()
}

export function normalizeHeadlineForProtectedSimilarity(
  text: string,
  brandName: string,
  languageCode: string
): string {
  const normalized = normalizeHeadline2KeywordCandidate(
    normalizeBrandFreeText(text, brandName) || text
  ).toLowerCase()
  return canonicalizeHeadlineActionPhrases(normalized, languageCode).replace(/\s+/g, ' ').trim()
}

export function isHeadlineTooSimilarToProtectedSlots(
  candidate: string,
  protectedHeadlines: string[],
  brandName: string,
  languageCode: string
): boolean {
  const normalizedCandidate = normalizeHeadlineForProtectedSimilarity(
    candidate,
    brandName,
    languageCode
  )
  if (!normalizedCandidate) return false

  return protectedHeadlines.some((headline) => {
    const normalizedProtected = normalizeHeadlineForProtectedSimilarity(
      headline,
      brandName,
      languageCode
    )
    if (!normalizedProtected) return false
    if (normalizedCandidate === normalizedProtected) return true
    return (
      calculateTextSimilarity(normalizedCandidate, normalizedProtected) >=
      RETAINED_KEYWORD_PROTECTED_SIMILARITY_THRESHOLD
    )
  })
}

export function getHeadlineActionVariants(languageCode: string): string[] {
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

export function fitKeywordIntoDiverseHeadline(
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
    if (
      isHeadlineTooSimilarToProtectedSlots(candidate, protectedHeadlines, brandName, languageCode)
    )
      continue
    return candidate
  }

  return null
}

export function fitKeywordIntoDescription(
  text: string,
  keyword: string,
  maxLength: number,
  languageCode: string
): string | null {
  const trimmedKeyword = String(keyword || '').trim()
  if (!trimmedKeyword) return null
  if (textContainsKeyword(text, trimmedKeyword)) return text
  if (getGoogleAdsTextEffectiveLength(trimmedKeyword) > maxLength) return null

  const base = String(text || '')
    .trim()
    .replace(/[.!?]+$/g, '')
    .trim()
  const cta = getCtaPhrasesForLanguage(languageCode)[0] || 'Shop Now'
  const candidates = [
    `${trimmedKeyword}. ${base}`.trim(),
    `${base}. ${trimmedKeyword}`.trim(),
    `${trimmedKeyword}. ${cta}`.trim(),
    `${cta} ${trimmedKeyword}`.trim(),
  ]

  return (
    candidates.find(
      (candidate) => Boolean(candidate) && getGoogleAdsTextEffectiveLength(candidate) <= maxLength
    ) || null
  )
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
  const protectedHeadlines = headlines.slice(
    0,
    Math.min(RETAINED_KEYWORD_PROTECTED_HEADLINE_COUNT, headlines.length)
  )
  let headlineFixes = 0
  let descriptionFixes = 0

  for (let index = 0; index < usagePlan.headlineKeywordTargets.length; index += 1) {
    const slotIndex = RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX + index
    if (slotIndex >= headlines.length) break
    const keywordTarget = usagePlan.headlineKeywordTargets[index]
    const currentHeadline = headlines[slotIndex]
    if (
      textContainsKeyword(currentHeadline, keywordTarget) &&
      !isHeadlineTooSimilarToProtectedSlots(
        currentHeadline,
        protectedHeadlines,
        brandName,
        languageCode
      )
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
        length: Math.min(
          RETAINED_KEYWORD_HEADLINE_MAX_LENGTH,
          (headlines[index] ?? asset.text).length
        ),
        keywords:
          index >= RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX &&
          index <
            RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX + usagePlan.headlineKeywordTargets.length
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
        length: Math.min(
          RETAINED_KEYWORD_DESCRIPTION_MAX_LENGTH,
          (descriptions[index] ?? asset.text).length
        ),
        keywords:
          index < usagePlan.descriptionKeywordTargets.length
            ? [usagePlan.descriptionKeywordTargets[index]]
            : asset.keywords,
      }))
    }
  }

  return { headlineFixes, descriptionFixes }
}

export async function recordAdCreativeOperationTokenUsage(input: {
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
    apiType: input.aiResponse.apiType,
  })
}

export function enforceKeywordEmbedding(
  headlines: string[],
  keywords: string[],
  minCount: number,
  maxLength: number,
  protectedIndexes: number[] = [0]
): { updated: string[]; fixed: number } {
  const updated = [...headlines]
  let embeddedCount = updated.filter((h) => headlineContainsKeyword(h, keywords)).length
  let fixed = 0

  if (embeddedCount >= minCount) {
    return { updated, fixed }
  }

  const candidateKeywords = keywords
    .map((k) => k.trim())
    .filter((k) => k.length > 0 && k.length <= 14)
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

export const MODEL_INTENT_TRANSACTIONAL_MODIFIER_PATTERN =
  /\b(buy|purchase|order|shop|shopping|shops|price|pricing|cost|deal|deals|discount|sale|offer|coupon|promo|store)\b/i

export function classifyCopyIntentFromText(
  text: string,
  languageCode: string,
  keywords: string[] = []
): CopyIntentTag {
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

export function mapToComplementarityTag(tag: CopyIntentTag): ComplementarityTag {
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

export function classifyDescriptionStructure(
  text: string,
  intentTag: CopyIntentTag,
  languageCode: string
): DescriptionStructureTag {
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

export function fitLocalizedDescription(base: string, cta: string, maxLength: number): string {
  const cleanBase = String(base || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '')
  if (!cleanBase) return cta
  let candidate = `${cleanBase}. ${cta}`.trim()
  if (candidate.length <= maxLength) return candidate

  const budget = Math.max(8, maxLength - cta.length - 2)
  const trimmedBase = truncateSnippetByWords(cleanBase, budget).replace(/[.!?]+$/, '')
  candidate = `${trimmedBase}. ${cta}`.trim()
  if (candidate.length <= maxLength) return candidate
  return applyDescriptionTextGuardrail(candidate, maxLength)
}

export function fitLocalizedHeadline(base: string, maxLength: number): string {
  const cleaned = String(base || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length <= maxLength) return cleaned
  return truncateSnippetByWords(cleaned, maxLength)
}

export function getSoftCopyTemplates(
  language: SupportedSoftCopyLanguage,
  preferredKeyword: string,
  brandSeed: string
): SoftCopyTemplates {
  if (language === 'fr') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} avec support officiel et qualité fiable`,
          cta: 'En savoir plus',
        },
        brandHeadline: `Support officiel ${brandSeed}`,
      },
      b: {
        painSolution1: {
          base: `Besoin de résultats fiables au quotidien ? ${preferredKeyword} vous aide à avancer sereinement`,
          cta: 'En savoir plus',
        },
        painSolution2: {
          base: `${preferredKeyword} offre une performance stable pour vos besoins quotidiens`,
          cta: 'Acheter maintenant',
        },
        scenarioHeadline: 'Meilleurs résultats au quotidien ?',
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} offre un excellent rapport qualité-prix et une performance fiable`,
          cta: 'Acheter maintenant',
        },
        transactionalHeadline: `Achetez ${preferredKeyword} aujourd'hui`,
      },
    }
  }

  if (language === 'de') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} mit offiziellem Support und zuverlässiger Qualität`,
          cta: 'Mehr erfahren',
        },
        brandHeadline: `Offizieller ${brandSeed} Support`,
      },
      b: {
        painSolution1: {
          base: `Brauchen Sie verlässliche Ergebnisse im Alltag? ${preferredKeyword} unterstützt Sie zuverlässig`,
          cta: 'Mehr erfahren',
        },
        painSolution2: {
          base: `${preferredKeyword} liefert stabile Leistung für tägliche Anforderungen`,
          cta: 'Jetzt kaufen',
        },
        scenarioHeadline: 'Bessere Ergebnisse im Alltag?',
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} bietet starken Alltagswert und zuverlässige Leistung`,
          cta: 'Jetzt kaufen',
        },
        transactionalHeadline: `Kaufen Sie ${preferredKeyword} heute`,
      },
    }
  }

  if (language === 'es') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} con soporte oficial y calidad confiable`,
          cta: 'Más información',
        },
        brandHeadline: `Soporte oficial ${brandSeed}`,
      },
      b: {
        painSolution1: {
          base: `¿Necesitas resultados fiables cada día? ${preferredKeyword} te ayuda con rendimiento constante`,
          cta: 'Más información',
        },
        painSolution2: {
          base: `${preferredKeyword} ofrece confianza y desempeño para necesidades diarias`,
          cta: 'Comprar ahora',
        },
        scenarioHeadline: '¿Mejores resultados diarios?',
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} ofrece valor diario y rendimiento confiable`,
          cta: 'Comprar ahora',
        },
        transactionalHeadline: `Compra ${preferredKeyword} hoy`,
      },
    }
  }

  if (language === 'it') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} con supporto ufficiale e qualità affidabile`,
          cta: 'Scopri di più',
        },
        brandHeadline: `Supporto ufficiale ${brandSeed}`,
      },
      b: {
        painSolution1: {
          base: `Vuoi risultati affidabili ogni giorno? ${preferredKeyword} ti aiuta con prestazioni costanti`,
          cta: 'Scopri di più',
        },
        painSolution2: {
          base: `${preferredKeyword} offre affidabilità e performance per esigenze quotidiane`,
          cta: 'Acquista ora',
        },
        scenarioHeadline: 'Risultati migliori ogni giorno?',
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} offre valore quotidiano e prestazioni affidabili`,
          cta: 'Acquista ora',
        },
        transactionalHeadline: `Acquista ${preferredKeyword} oggi`,
      },
    }
  }

  if (language === 'pt') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} com suporte oficial e qualidade confiável`,
          cta: 'Saiba mais',
        },
        brandHeadline: `Suporte oficial ${brandSeed}`,
      },
      b: {
        painSolution1: {
          base: `Precisa de resultados confiáveis no dia a dia? ${preferredKeyword} ajuda com desempenho estável`,
          cta: 'Saiba mais',
        },
        painSolution2: {
          base: `${preferredKeyword} oferece confiança e performance para necessidades diárias`,
          cta: 'Comprar agora',
        },
        scenarioHeadline: 'Melhores resultados no dia a dia?',
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} oferece valor diário e desempenho confiável`,
          cta: 'Comprar agora',
        },
        transactionalHeadline: `Compre ${preferredKeyword} hoje`,
      },
    }
  }

  if (language === 'zh') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} 官方支持，品质可靠`,
          cta: '了解更多',
        },
        brandHeadline: `${brandSeed} 官方支持`,
      },
      b: {
        painSolution1: {
          base: `需要稳定可靠的日常表现吗？${preferredKeyword} 助你持续发挥更好`,
          cta: '了解更多',
        },
        painSolution2: {
          base: `${preferredKeyword} 为日常需求带来稳定表现与信心`,
          cta: '立即购买',
        },
        scenarioHeadline: '想要更好的日常表现吗？',
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} 兼顾价值与性能，日常使用更放心`,
          cta: '立即购买',
        },
        transactionalHeadline: `今日选购 ${preferredKeyword}`,
      },
    }
  }

  if (language === 'ja') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} は公式サポート付きで安心品質`,
          cta: '詳しく見る',
        },
        brandHeadline: `公式 ${brandSeed} サポート`,
      },
      b: {
        painSolution1: {
          base: `毎日の成果を安定させたいですか？${preferredKeyword} がしっかり支えます`,
          cta: '詳しく見る',
        },
        painSolution2: {
          base: `${preferredKeyword} は日常ニーズに安定したパフォーマンスを提供します`,
          cta: '今すぐ購入',
        },
        scenarioHeadline: '日々の成果を高めたいですか？',
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} は毎日の作業で価値と性能を両立`,
          cta: '今すぐ購入',
        },
        transactionalHeadline: `${preferredKeyword} を今日購入`,
      },
    }
  }

  if (language === 'ko') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} 공식 지원으로 믿을 수 있는 품질`,
          cta: '자세히 보기',
        },
        brandHeadline: `${brandSeed} 공식 지원`,
      },
      b: {
        painSolution1: {
          base: `매일 더 안정적인 결과가 필요하신가요? ${preferredKeyword} 가 꾸준히 도와줍니다`,
          cta: '자세히 보기',
        },
        painSolution2: {
          base: `${preferredKeyword} 는 일상 니즈에 안정적인 성능과 신뢰를 제공합니다`,
          cta: '지금 구매',
        },
        scenarioHeadline: '일상 성과를 더 높이고 싶나요?',
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} 는 일상 작업에서 가치와 성능을 제공합니다`,
          cta: '지금 구매',
        },
        transactionalHeadline: `오늘 ${preferredKeyword} 구매`,
      },
    }
  }

  if (language === 'ru') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} с официальной поддержкой и надежным качеством`,
          cta: 'Узнать больше',
        },
        brandHeadline: `Официальная поддержка ${brandSeed}`,
      },
      b: {
        painSolution1: {
          base: `Нужны стабильные результаты каждый день? ${preferredKeyword} помогает уверенно двигаться дальше`,
          cta: 'Узнать больше',
        },
        painSolution2: {
          base: `${preferredKeyword} обеспечивает надежную работу для ежедневных задач`,
          cta: 'Купить сейчас',
        },
        scenarioHeadline: 'Лучшие результаты каждый день?',
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} дает отличную ценность и надежную работу каждый день`,
          cta: 'Купить сейчас',
        },
        transactionalHeadline: `Купите ${preferredKeyword} сегодня`,
      },
    }
  }

  if (language === 'ar') {
    return {
      a: {
        trustDescription: {
          base: `${preferredKeyword} مع دعم رسمي وجودة موثوقة`,
          cta: 'اعرف المزيد',
        },
        brandHeadline: `دعم رسمي ${brandSeed}`,
      },
      b: {
        painSolution1: {
          base: `هل تحتاج نتائج موثوقة كل يوم؟ ${preferredKeyword} يساعدك بأداء ثابت`,
          cta: 'اعرف المزيد',
        },
        painSolution2: {
          base: `${preferredKeyword} يمنحك ثباتًا وثقة لاحتياجاتك اليومية`,
          cta: 'اشتري الآن',
        },
        scenarioHeadline: 'تريد نتائج يومية أفضل؟',
      },
      d: {
        valueDescription: {
          base: `${preferredKeyword} يمنحك قيمة يومية وأداءً موثوقًا`,
          cta: 'اشتري الآن',
        },
        transactionalHeadline: `اشتر ${preferredKeyword} اليوم`,
      },
    }
  }

  return {
    a: {
      trustDescription: {
        base: `${preferredKeyword} with official support and trusted quality`,
        cta: 'Learn More',
      },
      brandHeadline: `Official ${brandSeed} Support`,
    },
    b: {
      painSolution1: {
        base: `Need dependable results every day? ${preferredKeyword} helps you stay confident and efficient`,
        cta: 'Learn More',
      },
      painSolution2: {
        base: `Get reliable everyday performance with ${preferredKeyword} designed for daily use`,
        cta: 'Shop Now',
      },
      scenarioHeadline: 'Need Better Everyday Results?',
    },
    d: {
      valueDescription: {
        base: `${preferredKeyword} delivers everyday value with trusted performance`,
        cta: 'Shop Now',
      },
      transactionalHeadline: `Buy ${preferredKeyword} Today`,
    },
  }
}

export function getDefaultProductNoun(language: SupportedSoftCopyLanguage): string {
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

export const STRONG_NEGATIVE_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bpanic(?:king|ed)?\b/gi, replacement: 'concern' },
  { pattern: /\bterrified\b/gi, replacement: 'worried' },
  { pattern: /\bdesperate\b/gi, replacement: 'eager' },
  { pattern: /\bashamed?\b/gi, replacement: 'uncomfortable' },
  { pattern: /\bembarrass(?:ed|ing)?\b/gi, replacement: 'inconvenient' },
  { pattern: /\bhumiliat(?:e|ed|ing)\b/gi, replacement: 'frustrating' },
  { pattern: /\bdisaster\b/gi, replacement: 'setback' },
  { pattern: /\bsuffer(?:ing|ed)?\b/gi, replacement: 'deal with' },
]

export function applyStrongNegativeSoftening(text: string): { text: string; changed: boolean } {
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

export function countStrongNegativeMatches(texts: string[]): number {
  const joined = texts.join(' ')
  let total = 0
  for (const rule of STRONG_NEGATIVE_REPLACEMENTS) {
    const matches = joined.match(new RegExp(rule.pattern.source, 'gi')) || []
    total += matches.length
  }
  return total
}

export function enforceEmotionBoundaryByBucket(
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

  if (headlines.length === 0 || descriptions.length === 0)
    return { headlineFixes: 0, descriptionFixes: 0 }

  let headlineFixes = 0
  let descriptionFixes = 0
  const patterns = getCopyPatterns(softLanguage)
  const preferredKeyword =
    keywords.find((kw) => kw.length <= 24) || brandName || getDefaultProductNoun(softLanguage)
  const brandSeed = String(brandName || preferredKeyword).trim() || preferredKeyword
  const templates = getSoftCopyTemplates(softLanguage, preferredKeyword, brandSeed)

  const headlineTags = headlines.map((h) => classifyCopyIntentFromText(h, languageCode, keywords))
  const descriptionTags = descriptions.map((d) =>
    classifyCopyIntentFromText(d, languageCode, keywords)
  )
  const descriptionStructures = descriptions.map((d, idx) =>
    classifyDescriptionStructure(d, descriptionTags[idx], languageCode)
  )

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
    const painSolutionCount = descriptionStructures.filter(
      (tag) => tag === 'pain_solution_cta'
    ).length
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

  const preferredKeyword =
    keywords.find((kw) => kw.length <= 24) || brandName || getDefaultProductNoun(softLanguage)
  const brandSeed = String(brandName || preferredKeyword).trim() || preferredKeyword
  const templates = getSoftCopyTemplates(softLanguage, preferredKeyword, brandSeed)
  let fixes = 0

  const classifyTags = () =>
    headlines.map((h) =>
      mapToComplementarityTag(classifyCopyIntentFromText(h, languageCode, keywords))
    )
  let tags = classifyTags()
  const countTag = (tag: 'brand' | 'scenario' | 'transactional') =>
    tags.filter((t) => t === tag).length
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
        const duplicated = headlines.some(
          (h, idx) => idx !== i && h.toLowerCase() === fitted.toLowerCase()
        )
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
    const candidateOrderByDominant: Record<
      string,
      Array<'brand' | 'scenario' | 'transactional'>
    > = {
      brand: ['scenario', 'transactional'],
      scenario: ['transactional', 'brand'],
      transactional: ['scenario', 'brand'],
    }
    const candidateOrder = candidateOrderByDominant[dominantEntry[0]] || [
      'scenario',
      'transactional',
      'brand',
    ]
    for (const candidate of candidateOrder) {
      if (candidate === 'scenario' && minScenario <= 0) continue
      if (candidate === 'transactional' && minTransactional <= 0) continue
      if (candidate === 'brand' && minBrand <= 0) continue
      const template =
        candidate === 'brand'
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
    transactionalCount: tags.filter((t) => t === 'transactional').length,
  }
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
  const protectedHeadlines = headlines.slice(
    0,
    Math.min(RETAINED_KEYWORD_PROTECTED_HEADLINE_COUNT, headlines.length)
  )
  const seen = new Set<string>()
  const softLanguage = resolveSoftCopyLanguage(languageCode) || 'en'
  let fixes = 0

  const normalize = (value: string) =>
    normalizeHeadlineForProtectedSimilarity(value, brandName, languageCode)
  const pickKeywordTarget = (index: number): string => {
    if (
      usagePlan &&
      index >= RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX &&
      index < RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX + usagePlan.headlineKeywordTargets.length
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
      ? fitKeywordIntoDiverseHeadline(
          current,
          keywordTarget,
          30,
          languageCode,
          protectedHeadlines,
          brandName
        )
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
      replacement =
        rawCandidates
          .map((candidate) => applyHeadlineTextGuardrail(fitLocalizedHeadline(candidate, 30), 30))
          .map((candidate) => stripHeadlineNumericSuffixArtifact(candidate))
          .find((candidate) => {
            const normalizedCandidate = normalize(candidate)
            return (
              Boolean(candidate) && Boolean(normalizedCandidate) && !seen.has(normalizedCandidate)
            )
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

export function normalizeHeadlineAssetKeyForGoogleAds(text: string): string {
  return sanitizeGoogleAdsAdText(String(text || ''), 30)
    .trim()
    .toLowerCase()
}

export function buildUniqueHeadlineVariantForGoogleAds(params: {
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
  const actionVariants = Array.from(
    new Set([
      ...getHeadlineActionVariants(languageCode),
      ...GOOGLE_ADS_HEADLINE_UNIQUENESS_SUFFIXES,
    ])
  )

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
      candidate &&
      normalizedBrand &&
      !hasBrandAnchorInHeadline(candidate, normalizedBrand, brandTokensToMatch)
    ) {
      candidate = stripHeadlineNumericSuffixArtifact(
        applyHeadlineTextGuardrail(
          `${normalizedBrand} ${candidate}`,
          RETAINED_KEYWORD_HEADLINE_MAX_LENGTH
        )
      )
    }
    const normalizedKey = normalizeHeadlineAssetKeyForGoogleAds(candidate)
    if (!candidate || !normalizedKey || usedAssetKeys.has(normalizedKey)) continue
    usedAssetKeys.add(normalizedKey)
    return candidate
  }

  return null
}

export function resolveKeywordTargetForHeadlineSlot(params: {
  index: number
  usagePlan?: CreativeKeywordUsagePlan | null
  keywords: string[]
}): string {
  const { index, usagePlan, keywords } = params
  if (
    usagePlan &&
    index >= RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX &&
    index < RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX + usagePlan.headlineKeywordTargets.length
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
  const protectedHeadlines = headlines.slice(
    0,
    Math.min(RETAINED_KEYWORD_PROTECTED_HEADLINE_COUNT, headlines.length)
  )
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

export function preferredHeadlineSeed(
  headline: string,
  brandName: string,
  languageCode: SupportedSoftCopyLanguage
): string {
  const normalized = normalizeBrandFreeText(headline, brandName)
  const candidate = normalizeHeadlineCandidateText(normalized)
  if (candidate.length >= 6) return candidate
  return getDefaultProductNoun(languageCode)
}

export function normalizeCreativeAssetText(result: GeneratedAdCreativeData): {
  headlineFixes: number
  descriptionFixes: number
} {
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

export function resolveHeadlineKeywordTargets(
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

export function resolveDescriptionKeywordTargets(
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

export function buildHardKeywordHeadlineCandidate(
  keyword: string,
  languageCode: string
): string | null {
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

export function buildHardKeywordDescriptionCandidate(
  keyword: string,
  languageCode: string
): string | null {
  const normalizedKeyword = String(keyword || '').trim()
  if (!normalizedKeyword) return null
  const fitted = fitKeywordIntoDescription('', normalizedKeyword, 90, languageCode)
  if (!fitted) return null
  return applyDescriptionTextGuardrail(fitted, 90)
}

export function enforceHardRetainedKeywordContract(
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

  const headlineTargets = resolveHeadlineKeywordTargets(
    usagePlan,
    result.keywords || [],
    languageCode
  )
  const descriptionTargets = resolveDescriptionKeywordTargets(
    usagePlan,
    result.keywords || [],
    languageCode
  )
  const protectedHeadlines = headlines.slice(
    0,
    Math.min(RETAINED_KEYWORD_PROTECTED_HEADLINE_COUNT, headlines.length)
  )
  const normalize = (value: string) =>
    normalizeHeadlineForProtectedSimilarity(value, brandName, languageCode)

  let headlineFixes = 0
  for (let offset = 0; offset < headlineTargets.length; offset += 1) {
    const slotIndex = RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX + offset
    if (slotIndex >= headlines.length) break

    const targetKeyword = headlineTargets[offset]
    const current = headlines[slotIndex]
    if (
      textContainsKeyword(current, targetKeyword) &&
      isHeadlineCompatibleWithTargetLanguage(current, languageCode)
    ) {
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

    const replacement =
      candidatePool
        .map((candidate) =>
          applyHeadlineTextGuardrail(
            stripHeadlineNumericSuffixArtifact(String(candidate || '')),
            30
          )
        )
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

    const replacement =
      candidatePool
        .map((candidate) => applyDescriptionTextGuardrail(String(candidate || ''), 90))
        .find((candidate) => Boolean(candidate) && textContainsKeyword(candidate, targetKeyword)) ||
      null
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
  const languageFixesBefore = enforceLanguagePurityGate(
    result,
    options.bucket,
    options.languageCode,
    options.brandName
  )
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
  const retainedFix = enforceRetainedKeywordSlotCoverage(
    result,
    languageSafeUsagePlan,
    options.languageCode,
    options.brandName
  )
  const uniquenessFix = enforceHeadlineUniquenessGate(
    result,
    options.languageCode,
    options.brandName,
    languageSafeUsagePlan
  )
  const hardRetainedFix = enforceHardRetainedKeywordContract(
    result,
    languageSafeUsagePlan,
    options.languageCode,
    options.brandName
  )
  const languageFixesAfter = enforceLanguagePurityGate(
    result,
    options.bucket,
    options.languageCode,
    options.brandName
  )
  const finalUniquenessFix = enforceHeadlineUniquenessGate(
    result,
    options.languageCode,
    options.brandName,
    languageSafeUsagePlan
  )
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
    headlineFixes: normalizedFix.headlineFixes + finalNormalizeFix.headlineFixes,
    descriptionFixes: normalizedFix.descriptionFixes + finalNormalizeFix.descriptionFixes,
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

export function annotateCopyIntentMetadata(
  result: GeneratedAdCreativeData,
  languageCode: string,
  keywords: string[]
): void {
  const headlines = result.headlines || []
  const descriptions = result.descriptions || []
  const ctaRegex = getCtaRegexForLanguage(languageCode)

  const headlineMetadata: HeadlineAsset[] =
    result.headlinesWithMetadata && result.headlinesWithMetadata.length > 0
      ? result.headlinesWithMetadata.map((h, idx) => ({
          ...h,
          text: headlines[idx] ?? h.text,
        }))
      : headlines.map((text) => ({ text, length: text.length }))

  const descriptionMetadata: DescriptionAsset[] =
    result.descriptionsWithMetadata && result.descriptionsWithMetadata.length > 0
      ? result.descriptionsWithMetadata.map((d, idx) => ({
          ...d,
          text: descriptions[idx] ?? d.text,
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
      structureTag: classifyDescriptionStructure(description.text, intentTag, languageCode),
    }
  })
}

export {
  normalizeBrandFreeText,
  normalizeHeadline2KeywordCandidate,
  tokenizeHeadline2Keyword,
  scoreAdCreativeCandidate,
  AD_CREATIVE_RESPONSE_SCHEMA,
  AD_CREATIVE_RETRY_RESPONSE_SCHEMA,
  AD_CREATIVE_EMERGENCY_RETRY_RESPONSE_SCHEMA,
  AD_CREATIVE_REQUIRED_COUNTS,
  AD_CREATIVE_EMERGENCY_RETRY_TEMPERATURE,
  AD_CREATIVE_SIMPLIFIED_RETRY_MAX_OUTPUT_TOKENS,
  validateGeneratedAdCreativeBusinessLimits,
  resolveAdCreativeRetryPlan,
  selectBestJsonCandidate,
  filterModelIntentGeneratedKeywords,
  parseAIResponse,
  isLikelyModelCodeToken,
  HEADLINE2_STOPWORDS,
  HEADLINE2_INTENT_TOKENS,
  HEADLINE2_BANNED_TOKENS,
  HEADLINE_DANGLING_TAIL_TOKENS,
} from './contract/response-handling'
