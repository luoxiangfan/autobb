import type { GeneratedAdCreativeData } from '../..'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { containsPureBrand, getPureBrandKeywords } from '../../../keywords'
import { getCtaRegexForLanguage, isHeadlineCompatibleWithTargetLanguage } from '../language'
import type { BrandAnchoredHeadlineCandidate, HeadlineCandidateSource } from '../types'
import {
  calculateTextSimilarity,
  escapeRegex,
  isUsefulCreativePhrase,
  normalizeSnippetText,
  truncateSnippetByWords,
} from '../utils'
import { normalizeBrandFreeText, normalizeHeadline2KeywordCandidate } from './response-handling'
import { fitLocalizedHeadline } from './localized-fit'
import {
  TOP_HEADLINE_MAX_LENGTH,
  TOP_HEADLINE_SEMANTIC_DUPLICATE_THRESHOLD,
  TOP_HEADLINE_SLOT_COUNT,
  TOP_HEADLINE_SLOT_START_INDEX,
} from './slot-constants'
import {
  LATIN_HEADLINE_STOPWORDS,
  normalizeHeadlineCandidateText,
  splitTitleSegmentsSafely,
} from './text-guardrails'

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
