import type { CreativeKeywordUsagePlan, GeneratedAdCreativeData } from '../../creatives'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { getGoogleAdsTextEffectiveLength } from '@/lib/google-ads/common/ad-text'
import { getKeywordSourcePriorityScoreFromInput } from '../../keywords'
import { getPureBrandKeywords } from '../../keywords'
import { isBrandVariant, isSemanticQuery } from '../../keywords'
import { isPureBrandKeyword } from '../../keywords'
import { getCtaPhrasesForLanguage } from '../language'
import type { PrecomputedCreativeKeywordSet } from '../types'
import { escapeRegex, isUsefulCreativePhrase, calculateTextSimilarity } from '../utils'
import {
  isLikelyModelCodeToken,
  normalizeBrandFreeText,
  normalizeHeadline2KeywordCandidate,
  tokenizeHeadline2Keyword,
} from './response-handling'
import {
  HEADLINE2_BANNED_TOKENS,
  HEADLINE2_INTENT_TOKENS,
  HEADLINE2_STOPWORDS,
  HEADLINE_DANGLING_TAIL_TOKENS,
} from './headline-tokens'
import {
  RETAINED_KEYWORD_DESCRIPTION_MAX_LENGTH,
  RETAINED_KEYWORD_DESCRIPTION_SLOT_COUNT,
  RETAINED_KEYWORD_DESCRIPTION_SLOT_START_INDEX,
  RETAINED_KEYWORD_HEADLINE_MAX_LENGTH,
  RETAINED_KEYWORD_HEADLINE_SLOT_COUNT,
  RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX,
  RETAINED_KEYWORD_PROTECTED_HEADLINE_COUNT,
  RETAINED_KEYWORD_PROTECTED_SIMILARITY_THRESHOLD,
} from './slot-constants'
import { normalizeHeadlineCandidateText, stripHeadlineTrailingPunctuation } from './text-guardrails'

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
