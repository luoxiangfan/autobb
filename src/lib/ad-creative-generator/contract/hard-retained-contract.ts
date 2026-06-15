import type { CreativeKeywordUsagePlan, GeneratedAdCreativeData } from '../../ad-creative'
import {
  isHeadlineCompatibleWithTargetLanguage,
  toLanguageCompatibleKeywordList,
} from '../language'
import type { SupportedSoftCopyLanguage } from '../types'
import { normalizeBrandFreeText } from './response-handling'
import { syncDescriptionMetadataSlot, syncHeadlineMetadataSlot } from './headline-candidates'
import {
  cycleKeywordTargets,
  fitKeywordIntoDescription,
  fitKeywordIntoDiverseHeadline,
  fitKeywordIntoHeadline,
  getHeadlineActionVariants,
  normalizeHeadlineForProtectedSimilarity,
  textContainsKeyword,
} from './keyword-usage'
import { fitLocalizedHeadline } from './localized-fit'
import { getDefaultProductNoun } from './soft-copy-templates'
import {
  RETAINED_KEYWORD_DESCRIPTION_SLOT_COUNT,
  RETAINED_KEYWORD_DESCRIPTION_SLOT_START_INDEX,
  RETAINED_KEYWORD_HEADLINE_SLOT_COUNT,
  RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX,
  RETAINED_KEYWORD_PROTECTED_HEADLINE_COUNT,
} from './slot-constants'
import {
  applyDescriptionTextGuardrail,
  applyHeadlineTextGuardrail,
  normalizeHeadlineCandidateText,
  stripHeadlineNumericSuffixArtifact,
} from './text-guardrails'

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
