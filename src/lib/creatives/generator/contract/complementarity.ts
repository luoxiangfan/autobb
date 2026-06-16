import type { CreativeKeywordUsagePlan, GeneratedAdCreativeData } from '../../server'
import { resolveSoftCopyLanguage } from '../language'
import { detectKeywordIntentsForPrompt } from '../prompts'
import type { NormalizedCreativeBucket } from '../types'
import { classifyCopyIntentFromText, mapToComplementarityTag } from './copy-intent-enforcement'
import {
  buildUniqueHeadlineReplacement,
  resolveKeywordTargetForHeadlineSlot,
} from './headline-uniqueness-variants'
import { syncHeadlineMetadataSlot } from './headline-candidates'
import { normalizeHeadlineForProtectedSimilarity } from './keyword-usage'
import { fitLocalizedHeadline } from './localized-fit'
import { getDefaultProductNoun, getSoftCopyTemplates } from './soft-copy-templates'
import { RETAINED_KEYWORD_PROTECTED_HEADLINE_COUNT } from './slot-constants'

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
  let fixes = 0

  const normalize = (value: string) =>
    normalizeHeadlineForProtectedSimilarity(value, brandName, languageCode)

  for (let index = 0; index < headlines.length; index += 1) {
    const current = headlines[index]
    const normalizedCurrent = normalize(current)
    if (!normalizedCurrent) continue
    if (!seen.has(normalizedCurrent)) {
      seen.add(normalizedCurrent)
      continue
    }

    const keywordTarget = resolveKeywordTargetForHeadlineSlot({
      index,
      usagePlan,
      keywords,
    })
    const replacement = buildUniqueHeadlineReplacement({
      currentHeadline: current,
      keywordTarget,
      brandName,
      languageCode,
      protectedHeadlines,
      usedKeys: seen,
      normalization: 'protected-similarity',
    })
    if (!replacement) continue

    headlines[index] = replacement
    syncHeadlineMetadataSlot(result, index, replacement)
    fixes += 1
  }

  if (fixes > 0) {
    result.headlines = headlines
  }
  return { fixes }
}
