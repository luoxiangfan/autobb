import { sanitizeGoogleAdsAdText } from '@/lib/google-ads/common/ad-text'
import type { CreativeKeywordUsagePlan } from '../../ad-creative'
import { getPureBrandKeywords } from '../../brand-keyword-utils'
import { resolveSoftCopyLanguage } from '../language'
import { buildHardKeywordHeadlineCandidate, preferredHeadlineSeed } from './hard-retained-contract'
import { hasBrandAnchorInHeadline, normalizeBrandNameForHeadline } from './headline-candidates'
import {
  fitKeywordIntoDiverseHeadline,
  getHeadlineActionVariants,
  normalizeHeadlineForProtectedSimilarity,
} from './keyword-usage'
import { fitLocalizedHeadline } from './localized-fit'
import {
  GOOGLE_ADS_HEADLINE_UNIQUENESS_SUFFIXES,
  RETAINED_KEYWORD_HEADLINE_MAX_LENGTH,
  RETAINED_KEYWORD_HEADLINE_SLOT_START_INDEX,
} from './slot-constants'
import { applyHeadlineTextGuardrail, stripHeadlineNumericSuffixArtifact } from './text-guardrails'

export type HeadlineUniquenessNormalization = 'protected-similarity' | 'google-ads-asset'

export function normalizeHeadlineAssetKeyForGoogleAds(text: string): string {
  return sanitizeGoogleAdsAdText(String(text || ''), RETAINED_KEYWORD_HEADLINE_MAX_LENGTH)
    .trim()
    .toLowerCase()
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

function buildHeadlineReplacementRawCandidates(params: {
  currentHeadline: string
  keywordTarget: string
  brandName: string
  languageCode: string
  protectedHeadlines: string[]
  maxLength: number
  normalization: HeadlineUniquenessNormalization
}): (string | null)[] {
  const {
    currentHeadline,
    keywordTarget,
    brandName,
    languageCode,
    protectedHeadlines,
    maxLength,
    normalization,
  } = params
  const softLanguage = resolveSoftCopyLanguage(languageCode) || 'en'
  const preferredSeed = preferredHeadlineSeed(currentHeadline, brandName, softLanguage)
  const actionSeed =
    normalization === 'google-ads-asset' ? preferredSeed : keywordTarget || preferredSeed
  const actionVariants =
    normalization === 'google-ads-asset'
      ? Array.from(
          new Set([
            ...getHeadlineActionVariants(languageCode),
            ...GOOGLE_ADS_HEADLINE_UNIQUENESS_SUFFIXES,
          ])
        )
      : getHeadlineActionVariants(languageCode)

  const candidates: (string | null)[] = []

  if (keywordTarget) {
    candidates.push(
      fitKeywordIntoDiverseHeadline(
        currentHeadline,
        keywordTarget,
        maxLength,
        languageCode,
        protectedHeadlines,
        brandName
      )
    )
    if (normalization === 'google-ads-asset') {
      candidates.push(buildHardKeywordHeadlineCandidate(keywordTarget, languageCode))
    }
  }

  candidates.push(
    ...actionVariants.map((action) => `${action} ${actionSeed}`.trim()),
    ...actionVariants.map((action) => `${actionSeed} ${action}`.trim()),
    `${brandName} ${keywordTarget || preferredSeed}`.trim(),
    normalization === 'google-ads-asset' ? preferredSeed : actionSeed
  )

  return candidates
}

function finalizeHeadlineReplacementCandidate(params: {
  raw: string | null
  maxLength: number
  brandName: string
  normalization: HeadlineUniquenessNormalization
}): string | null {
  const { raw, maxLength, brandName, normalization } = params
  const useLocalizedFit = normalization === 'protected-similarity'
  const enforceBrandAnchor = normalization === 'google-ads-asset'

  let candidate = stripHeadlineNumericSuffixArtifact(
    applyHeadlineTextGuardrail(
      useLocalizedFit ? fitLocalizedHeadline(String(raw || ''), maxLength) : String(raw || ''),
      maxLength
    )
  )

  if (enforceBrandAnchor && candidate) {
    const normalizedBrand = normalizeBrandNameForHeadline(brandName)
    const brandTokensToMatch = getPureBrandKeywords(brandName)
    if (
      normalizedBrand &&
      !hasBrandAnchorInHeadline(candidate, normalizedBrand, brandTokensToMatch)
    ) {
      candidate = stripHeadlineNumericSuffixArtifact(
        applyHeadlineTextGuardrail(`${normalizedBrand} ${candidate}`, maxLength)
      )
    }
  }

  return candidate || null
}

export function buildUniqueHeadlineReplacement(params: {
  currentHeadline: string
  keywordTarget: string
  brandName: string
  languageCode: string
  protectedHeadlines: string[]
  usedKeys: Set<string>
  normalization: HeadlineUniquenessNormalization
  maxLength?: number
}): string | null {
  const {
    currentHeadline,
    keywordTarget,
    brandName,
    languageCode,
    protectedHeadlines,
    usedKeys,
    normalization,
  } = params
  const maxLength = params.maxLength ?? RETAINED_KEYWORD_HEADLINE_MAX_LENGTH
  const normalizeKey =
    normalization === 'google-ads-asset'
      ? normalizeHeadlineAssetKeyForGoogleAds
      : (text: string) => normalizeHeadlineForProtectedSimilarity(text, brandName, languageCode)

  const rawCandidates = buildHeadlineReplacementRawCandidates({
    currentHeadline,
    keywordTarget,
    brandName,
    languageCode,
    protectedHeadlines,
    maxLength,
    normalization,
  })

  for (const raw of rawCandidates) {
    const candidate = finalizeHeadlineReplacementCandidate({
      raw,
      maxLength,
      brandName,
      normalization,
    })
    const normalizedKey = normalizeKey(candidate || '')
    if (!candidate || !normalizedKey || usedKeys.has(normalizedKey)) continue
    usedKeys.add(normalizedKey)
    return candidate
  }

  return null
}

/** Google Ads asset-key uniqueness variant builder. */
export function buildUniqueHeadlineVariantForGoogleAds(params: {
  currentHeadline: string
  keywordTarget: string
  brandName: string
  languageCode: string
  protectedHeadlines: string[]
  usedAssetKeys: Set<string>
}): string | null {
  return buildUniqueHeadlineReplacement({
    currentHeadline: params.currentHeadline,
    keywordTarget: params.keywordTarget,
    brandName: params.brandName,
    languageCode: params.languageCode,
    protectedHeadlines: params.protectedHeadlines,
    usedKeys: params.usedAssetKeys,
    normalization: 'google-ads-asset',
  })
}
