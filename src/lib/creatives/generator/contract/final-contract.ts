import type {
  CreativeKeywordUsagePlan,
  DescriptionAsset,
  GeneratedAdCreativeData,
  HeadlineAsset,
} from '../../server'
import {
  buildLanguageSafeUsagePlan,
  enforceLanguagePurityGate,
  getCtaRegexForLanguage,
} from '../language'
import type { NormalizedCreativeBucket } from '../types'
import { classifyCopyIntentFromText, classifyDescriptionStructure } from './copy-intent-enforcement'
import { enforceHeadlineUniquenessGate } from './complementarity'
import { enforceGoogleAdsHeadlineAssetUniqueness } from './google-ads-uniqueness'
import {
  enforceHardRetainedKeywordContract,
  normalizeCreativeAssetText,
} from './hard-retained-contract'
import { enforceTitlePriorityTopHeadlines, syncHeadlineMetadataSlot } from './headline-candidates'
import { enforceRetainedKeywordSlotCoverage } from './keyword-usage'
import {
  TOP_HEADLINE_MAX_LENGTH,
  TOP_HEADLINE_SLOT_COUNT,
  TOP_HEADLINE_SLOT_START_INDEX,
} from './slot-constants'

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
  const finalNormalizeFix = normalizeCreativeAssetText(result)
  const protectedUniquenessFix = enforceHeadlineUniquenessGate(
    result,
    options.languageCode,
    options.brandName,
    languageSafeUsagePlan
  )
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
    uniquenessFixes: protectedUniquenessFix.fixes + googleAdsUniquenessFix.fixes,
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
