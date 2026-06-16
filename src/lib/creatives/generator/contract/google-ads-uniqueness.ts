import type { CreativeKeywordUsagePlan, GeneratedAdCreativeData } from '../../server'
import { syncHeadlineMetadataSlot } from './headline-candidates'
import {
  buildUniqueHeadlineReplacement,
  normalizeHeadlineAssetKeyForGoogleAds,
  resolveKeywordTargetForHeadlineSlot,
} from './headline-uniqueness-variants'
import {
  RETAINED_KEYWORD_HEADLINE_MAX_LENGTH,
  RETAINED_KEYWORD_PROTECTED_HEADLINE_COUNT,
} from './slot-constants'
import { applyHeadlineTextGuardrail, stripHeadlineNumericSuffixArtifact } from './text-guardrails'

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
    const replacement = buildUniqueHeadlineReplacement({
      currentHeadline: cleaned,
      keywordTarget,
      brandName,
      languageCode,
      protectedHeadlines,
      usedKeys: usedAssetKeys,
      normalization: 'google-ads-asset',
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
