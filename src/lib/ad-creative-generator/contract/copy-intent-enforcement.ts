import type { GeneratedAdCreativeData } from '../../ad-creative'
import { classifyKeywordIntent } from '../../keyword-intent'
import { getCopyPatterns, resolveSoftCopyLanguage } from '../language'
import type {
  ComplementarityTag,
  CopyIntentTag,
  DescriptionStructureTag,
  NormalizedCreativeBucket,
} from '../types'
import { fitLocalizedDescription, fitLocalizedHeadline } from './localized-fit'
import { getDefaultProductNoun, getSoftCopyTemplates } from './soft-copy-templates'

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
