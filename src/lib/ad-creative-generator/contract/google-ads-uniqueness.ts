import type { CreativeKeywordUsagePlan, GeneratedAdCreativeData } from '../../ad-creative'
import { sanitizeGoogleAdsAdText } from '@/lib/google-ads/common/ad-text'
import { getPureBrandKeywords } from '../../keyword-quality-filter'
import { resolveSoftCopyLanguage } from '../language'
import { buildHardKeywordHeadlineCandidate, preferredHeadlineSeed } from './hard-retained-contract'
import {
  hasBrandAnchorInHeadline,
  normalizeBrandNameForHeadline,
  syncHeadlineMetadataSlot,
} from './headline-candidates'
import { fitKeywordIntoDiverseHeadline, getHeadlineActionVariants } from './keyword-usage'
import {
  GOOGLE_ADS_HEADLINE_UNIQUENESS_SUFFIXES,
  RETAINED_KEYWORD_HEADLINE_MAX_LENGTH,
  RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX,
  RETAINED_KEYWORD_PROTECTED_HEADLINE_COUNT,
} from './slot-constants'
import {
  applyHeadlineTextGuardrail,
  stripHeadlineNumericSuffixArtifact,
} from './text-guardrails'

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
