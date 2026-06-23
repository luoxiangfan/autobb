/**
 * 创意关键词集合构建：非空 rescue 短语与候选
 */
import type { CreativeKeywordSourceQuotaAudit } from './creative-keyword-selection'
import { containsPureBrand, getPureBrandKeywords } from '../brand/brand-keyword-utils'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import type { PoolKeywordData } from '../offer-pool'
import {
  type BuildCreativeKeywordSetInput,
  BUILDER_MODEL_ANCHOR_PATTERN,
  RESCUE_PREFIX_NOISE_TOKENS,
  RESCUE_BREAK_TOKENS,
  RESCUE_TRAILING_CONNECTOR_TOKENS,
  RESCUE_TRAILING_CONNECTOR_ALLOWED_BIGRAMS,
  RESCUE_SHORT_NUMERIC_SUFFIX_ALLOWED_PREV_TOKENS,
  RESCUE_INLINE_SKIP_TOKENS,
  RESCUE_FORBIDDEN_TOPIC_TOKENS,
  RESCUE_SEGMENT_SPLIT_PATTERN,
  RESCUE_CONTEXT_TEXT_MAX_ITEMS,
  RESCUE_CONTEXT_DETAIL_MAX_CANDIDATES,
  RESCUE_NEUTRAL_MODEL_TOKEN_PATTERN,
  RESCUE_NEUTRAL_SPEC_TOKEN_PATTERN,
  RESCUE_NEUTRAL_RATIO_TOKEN_PATTERN,
  RESCUE_NEUTRAL_CERT_TOKEN_PATTERN,
  RESCUE_NEUTRAL_DETAIL_MAX_CANDIDATES,
} from './creative-keyword-set-builder-types'
import { normalizeCandidateKey } from './creative-keyword-set-builder-candidates'

function normalizeRescueKeywordPhrase(
  text: unknown,
  maxTokens: number,
  options?: {
    preserveAndToken?: boolean
  }
): string | null {
  const normalized = normalizeGoogleAdsKeyword(String(text || ''))
  if (!normalized) return null
  const tokens = compactRescueTokens(normalized.split(/\s+/).filter(Boolean), maxTokens, options)
  return tokens.length > 0 ? tokens.join(' ') : null
}

function dedupeRescuePhrases(phrases: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const results: string[] = []

  for (const phrase of phrases) {
    const normalized = normalizeCandidateKey(phrase)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    results.push(String(phrase).trim())
  }

  return results
}

function stripBrandTokensFromPhrase(
  text: unknown,
  brandName: string | undefined,
  maxTokens: number
): string | null {
  const normalized = normalizeGoogleAdsKeyword(String(text || ''))
  if (!normalized) return null

  const brandTokens = new Set(
    normalizeGoogleAdsKeyword(brandName || '')
      ?.split(/\s+/)
      .filter(Boolean) || []
  )
  const tokens = normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !brandTokens.has(token))
  const compactTokens = compactRescueTokens(tokens, maxTokens)

  return compactTokens.length > 0 ? compactTokens.join(' ') : null
}

function normalizeRescueNumericSeparators(text: string): string {
  let normalized = String(text || '')
  let previous = ''
  while (normalized !== previous) {
    previous = normalized
    normalized = normalized.replace(/(\d)[,\.\u00A0\u202F'\s](?=\d{3}\b)/g, '$1')
  }
  return normalized
}

function normalizeAmpersandBrandPhrase(brandName: string): string | null {
  const raw = String(brandName || '').trim()
  if (!raw || !/[&＋+]/u.test(raw)) return null
  return (
    raw
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\s*[&＋+]\s*/gu, ' & ')
      .replace(/\s+/g, ' ')
      .trim() || null
  )
}

function buildRescueBrandKeywordVariants(input: {
  brandName: string
  normalizedBrand: string | null
}): {
  prefixes: string[]
  pure: string[]
} {
  const canonical = input.normalizedBrand || null
  const ampersandPhrase = normalizeAmpersandBrandPhrase(input.brandName)
  const andPhrase = normalizeRescueKeywordPhrase(
    String(input.brandName || '').replace(/\s*[&＋+]\s*/gu, ' and '),
    4,
    { preserveAndToken: true }
  )
  const compactCanonical = canonical ? canonical.replace(/\s+/g, '').trim() : null
  const compactAnd = andPhrase ? andPhrase.replace(/\s+/g, '').trim() : null
  const isConnectorBrand = Boolean(ampersandPhrase)

  const prefixes = dedupeRescuePhrases(
    isConnectorBrand
      ? [ampersandPhrase, andPhrase, canonical]
      : [canonical, andPhrase, ampersandPhrase]
  ).slice(0, 3)

  const pure = dedupeRescuePhrases(
    isConnectorBrand
      ? [ampersandPhrase, andPhrase, compactAnd, canonical, compactCanonical]
      : [canonical, andPhrase, ampersandPhrase, compactAnd, compactCanonical]
  ).slice(0, 6)

  return { prefixes, pure }
}

function extractRescuePhraseCandidates(
  text: unknown,
  brandName: string | undefined,
  maxTokens: number,
  options?: {
    maxSegments?: number
  }
): string[] {
  const raw = normalizeRescueNumericSeparators(String(text || '')).trim()
  if (!raw) return []
  const maxSegments = Math.max(1, Math.floor(Number(options?.maxSegments || 2)))

  const segmentCandidates = raw
    .split(RESCUE_SEGMENT_SPLIT_PATTERN)
    .slice(0, maxSegments)
    .map((segment) => stripBrandTokensFromPhrase(segment, brandName, maxTokens))
    .filter(Boolean)

  if (segmentCandidates.length === 0) {
    return dedupeRescuePhrases([stripBrandTokensFromPhrase(raw, brandName, maxTokens)])
  }

  return dedupeRescuePhrases(segmentCandidates)
}

function parseOfferTextArray(
  value: unknown,
  maxItems: number = RESCUE_CONTEXT_TEXT_MAX_ITEMS
): string[] {
  const limit = Math.max(1, Math.floor(Number(maxItems) || RESCUE_CONTEXT_TEXT_MAX_ITEMS))
  const collected: string[] = []
  const queue: unknown[] = [value]

  while (queue.length > 0 && collected.length < limit) {
    const current = queue.shift()
    if (!current) continue

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item)
      }
      continue
    }

    if (typeof current === 'string') {
      const text = current.trim()
      if (!text) continue
      if (
        (text.startsWith('[') && text.endsWith(']')) ||
        (text.startsWith('{') && text.endsWith('}'))
      ) {
        try {
          queue.push(JSON.parse(text))
          continue
        } catch {
          // keep as plain string fallback
        }
      }
      collected.push(text)
      continue
    }

    if (typeof current === 'object') {
      const objectValue = current as Record<string, unknown>
      if (typeof objectValue.text === 'string' && objectValue.text.trim()) {
        collected.push(objectValue.text.trim())
        continue
      }
      for (const nestedValue of Object.values(objectValue)) {
        queue.push(nestedValue)
      }
    }
  }

  return collected.slice(0, limit)
}

function extractRescuePhraseCandidatesFromTexts(params: {
  texts: unknown[]
  brandName?: string
  maxTokens: number
  maxSegmentsPerText: number
  maxCandidates: number
}): string[] {
  const results: string[] = []
  for (const rawText of params.texts) {
    if (results.length >= params.maxCandidates) break
    const phrases = extractRescuePhraseCandidates(rawText, params.brandName, params.maxTokens, {
      maxSegments: params.maxSegmentsPerText,
    })
    if (phrases.length === 0) continue
    const combined = buildCombinedRescuePhraseCandidates(phrases, params.maxTokens)
    results.push(...phrases, ...combined)
  }
  return dedupeRescuePhrases(results).slice(0, params.maxCandidates)
}

function buildCombinedRescuePhraseCandidates(phrases: string[], maxTokens: number): string[] {
  const combined: string[] = []

  for (let index = 0; index < phrases.length - 1; index += 1) {
    const current = phrases[index]
    const next = phrases[index + 1]
    if (!current || !next) continue
    if (!BUILDER_MODEL_ANCHOR_PATTERN.test(current) && !hasShortRescueBridgeToken(current)) {
      continue
    }

    const candidate = composeRescueKeyword([current, next], maxTokens)
    if (candidate) combined.push(candidate)
  }

  return dedupeRescuePhrases(combined)
}

function hasShortRescueBridgeToken(phrase: string): boolean {
  const normalized = normalizeGoogleAdsKeyword(phrase)
  if (!normalized) return false
  const tokens = normalized.split(/\s+/).filter(Boolean)
  const lastToken = tokens[tokens.length - 1] || ''
  return /^[a-z]{1,2}$/i.test(lastToken)
}

function composeRescueKeyword(
  parts: Array<string | null | undefined>,
  maxTokens: number,
  options?: {
    preserveAndToken?: boolean
  }
): string | null {
  const normalized = normalizeGoogleAdsKeyword(
    parts
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join(' ')
  )
  if (!normalized) return null

  const tokens = compactRescueTokens(normalized.split(/\s+/).filter(Boolean), maxTokens, options)
  return tokens.length > 0 ? tokens.join(' ') : null
}

function compactRescueTokens(
  tokens: string[],
  maxTokens: number,
  options?: {
    preserveAndToken?: boolean
  }
): string[] {
  const compacted: string[] = []
  const seen = new Set<string>()
  for (let index = 0; index < tokens.length; index += 1) {
    const rawToken = tokens[index]
    const token = String(rawToken || '').trim()
    if (!token) continue
    const dedupeKey = token.toLowerCase()
    const isNumeric = /^\d+$/.test(dedupeKey)
    const nextToken = String(tokens[index + 1] || '')
      .trim()
      .toLowerCase()

    if (isNumeric && /^0{3}\d*$/.test(dedupeKey)) continue

    if (
      isNumeric &&
      compacted.length > 0 &&
      /^\d{1,4}$/.test(compacted[compacted.length - 1]) &&
      dedupeKey.length === 3
    ) {
      compacted[compacted.length - 1] = `${compacted[compacted.length - 1]}${dedupeKey}`
      continue
    }

    if (
      compacted.length === 0 &&
      isNumeric &&
      ['pack', 'count', 'pc', 'piece', 'pieces', 'set'].includes(nextToken)
    ) {
      index += 1
      continue
    }
    if (compacted.length === 0 && RESCUE_PREFIX_NOISE_TOKENS.has(dedupeKey)) continue
    if (RESCUE_INLINE_SKIP_TOKENS.has(dedupeKey)) {
      if (!(options?.preserveAndToken && dedupeKey === 'and')) {
        continue
      }
    }
    if (compacted.length > 0 && RESCUE_BREAK_TOKENS.has(dedupeKey)) break
    if (!isNumeric && seen.has(dedupeKey)) continue
    compacted.push(token)
    if (!isNumeric) seen.add(dedupeKey)
    if (compacted.length >= maxTokens) break
  }
  return compacted
}

function getNonEmptyRescueCandidateRejectionReason(params: {
  keyword: string
  brandLeadingTokens: Set<string>
}): string | null {
  const normalized = normalizeGoogleAdsKeyword(params.keyword)
  if (!normalized) return 'empty'

  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return 'empty'

  if (tokens.some((token) => RESCUE_FORBIDDEN_TOPIC_TOKENS.has(token))) {
    return 'forbidden_topic_fragment'
  }

  if (tokens.some((token) => /^0{3}\d*$/.test(token))) {
    return 'numeric_fragment'
  }

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const current = tokens[index]
    const next = tokens[index + 1]
    if (/^\d{1,2}$/.test(current) && /^\d{1,2}$/.test(next)) {
      return 'adjacent_short_numeric_pair'
    }
  }

  const lastToken = tokens[tokens.length - 1] || ''
  if (tokens.length >= 2 && RESCUE_TRAILING_CONNECTOR_TOKENS.has(lastToken)) {
    const lastBigram = tokens.slice(-2).join(' ')
    if (!RESCUE_TRAILING_CONNECTOR_ALLOWED_BIGRAMS.has(lastBigram)) {
      return 'trailing_connector'
    }
  }

  if (
    tokens.length === 2 &&
    /^\d{1,2}$/.test(tokens[1] || '') &&
    params.brandLeadingTokens.has(tokens[0] || '')
  ) {
    return 'brand_short_numeric_fragment'
  }

  if (tokens.length >= 3 && /^\d{1,2}$/.test(tokens[tokens.length - 1] || '')) {
    const penultimateToken = tokens[tokens.length - 2] || ''
    const hasPriorNumericAnchor = tokens
      .slice(0, -1)
      .some((token) => /\d/.test(token) && !/^\d{1,2}$/.test(token))
    if (
      hasPriorNumericAnchor &&
      !RESCUE_SHORT_NUMERIC_SUFFIX_ALLOWED_PREV_TOKENS.has(penultimateToken)
    ) {
      return 'trailing_short_numeric_fragment'
    }
  }

  return null
}

export function isBuilderNonEmptyRescueCandidate(
  item: PoolKeywordData | null | undefined
): boolean {
  if (!item) return false
  const sourceType = String((item as any)?.sourceType || '')
    .trim()
    .toUpperCase()
  const sourceSubtype = String((item as any)?.sourceSubtype || '')
    .trim()
    .toUpperCase()
  const source = String((item as any)?.source || '')
    .trim()
    .toUpperCase()

  return (
    sourceType === 'BUILDER_NON_EMPTY_RESCUE' ||
    sourceSubtype === 'BUILDER_NON_EMPTY_RESCUE' ||
    source === 'DERIVED_RESCUE'
  )
}

function createNonEmptyRescueCandidate(keyword: string, evidence: string[]): PoolKeywordData {
  return {
    keyword,
    searchVolume: 0,
    source: 'DERIVED_RESCUE',
    matchType: 'PHRASE',
    sourceType: 'BUILDER_NON_EMPTY_RESCUE',
    sourceSubtype: 'BUILDER_NON_EMPTY_RESCUE',
    rawSource: 'DERIVED_RESCUE',
    sourceField: 'derived_rescue',
    derivedTags: ['NON_EMPTY_RESCUE'],
    evidence,
  } as PoolKeywordData
}

function collectNeutralRescueDetailCandidates(
  input: BuildCreativeKeywordSetInput,
  maxTokens: number
): string[] {
  const texts = [
    ...parseOfferTextArray(input.offer.product_name),
    ...parseOfferTextArray(input.offer.category),
    ...parseOfferTextArray(input.offer.unique_selling_points),
    ...parseOfferTextArray(input.offer.product_highlights),
    ...parseOfferTextArray(input.offer.extracted_headlines),
    ...parseOfferTextArray(input.offer.extracted_keywords),
    ...parseOfferTextArray(input.offer.enhanced_headlines),
    ...parseOfferTextArray(input.offer.enhanced_keywords),
  ]

  const candidates: string[] = []
  const pushCandidate = (raw: string | null | undefined) => {
    const normalized = normalizeRescueKeywordPhrase(raw, maxTokens)
    if (!normalized) return
    if (!/\d/.test(normalized) && !/\b(?:nsf|ansi|ro|ph|tds|gpd|btu)\b/i.test(normalized)) {
      return
    }
    candidates.push(normalized)
  }

  for (const text of texts) {
    const normalizedText = normalizeRescueNumericSeparators(String(text || ''))
    if (!normalizedText) continue

    for (const match of normalizedText.matchAll(
      new RegExp(RESCUE_NEUTRAL_MODEL_TOKEN_PATTERN.source, 'gi')
    )) {
      pushCandidate(match[0] || '')
    }
    for (const match of normalizedText.matchAll(
      new RegExp(RESCUE_NEUTRAL_SPEC_TOKEN_PATTERN.source, 'gi')
    )) {
      pushCandidate(match[0] || '')
    }
    for (const match of normalizedText.matchAll(
      new RegExp(RESCUE_NEUTRAL_RATIO_TOKEN_PATTERN.source, 'g')
    )) {
      pushCandidate(match[0] || '')
    }
    for (const certMatch of normalizedText.matchAll(
      new RegExp(RESCUE_NEUTRAL_CERT_TOKEN_PATTERN.source, 'gi')
    )) {
      const certNumbers = Array.from(String(certMatch[1] || '').matchAll(/\d{1,3}/g)).map(
        (item) => item[0]
      )
      for (const certNumber of certNumbers) {
        pushCandidate(`nsf ansi ${certNumber}`)
      }
    }
  }

  return dedupeRescuePhrases(candidates).slice(0, RESCUE_NEUTRAL_DETAIL_MAX_CANDIDATES)
}

export function buildNonEmptyRescueCandidates(
  input: BuildCreativeKeywordSetInput
): PoolKeywordData[] {
  const creativeType = input.creativeType || null
  const combinedTokenLimit = creativeType === 'model_intent' ? 6 : 5
  const detailTokenLimit = creativeType === 'model_intent' ? 5 : 4
  const contextMaxCandidates =
    creativeType === 'model_intent'
      ? RESCUE_CONTEXT_DETAIL_MAX_CANDIDATES.model_intent
      : creativeType === 'product_intent'
        ? RESCUE_CONTEXT_DETAIL_MAX_CANDIDATES.product_intent
        : RESCUE_CONTEXT_DETAIL_MAX_CANDIDATES.brand_intent
  const rawBrandName = input.brandName || input.offer.brand || ''
  const normalizedBrand = normalizeRescueKeywordPhrase(rawBrandName, 3)
  const brandKeywordVariants = buildRescueBrandKeywordVariants({
    brandName: rawBrandName,
    normalizedBrand,
  })
  const pureBrandKeyword =
    brandKeywordVariants.pure[0] || getPureBrandKeywords(rawBrandName)[0] || normalizedBrand || null
  const brandLeadingTokens = new Set(
    dedupeRescuePhrases([
      ...brandKeywordVariants.prefixes,
      ...brandKeywordVariants.pure,
      pureBrandKeyword,
    ])
      .map((keyword) => normalizeGoogleAdsKeyword(keyword) || '')
      .map((keyword) => keyword.split(/\s+/).filter(Boolean)[0] || '')
      .filter(Boolean)
  )
  const productSegmentCandidates = extractRescuePhraseCandidates(
    input.offer.product_name || '',
    normalizedBrand || undefined,
    detailTokenLimit,
    { maxSegments: 6 }
  )
  const offerContextTexts = [
    ...parseOfferTextArray(input.offer.extracted_headlines),
    ...parseOfferTextArray(input.offer.extracted_keywords),
    ...parseOfferTextArray(input.offer.enhanced_headlines),
    ...parseOfferTextArray(input.offer.enhanced_keywords),
    ...parseOfferTextArray(input.offer.product_highlights),
    ...parseOfferTextArray(input.offer.unique_selling_points),
  ]
  const contextDetailCandidates = extractRescuePhraseCandidatesFromTexts({
    texts: offerContextTexts,
    brandName: normalizedBrand || undefined,
    maxTokens: detailTokenLimit,
    maxSegmentsPerText: creativeType === 'model_intent' ? 3 : 4,
    maxCandidates: contextMaxCandidates,
  })
  const combinedProductCandidates = buildCombinedRescuePhraseCandidates(
    productSegmentCandidates,
    detailTokenLimit
  )
  const shortBridgeSegmentIndexes = new Set<number>()
  for (let index = 0; index < productSegmentCandidates.length - 1; index += 1) {
    if (hasShortRescueBridgeToken(productSegmentCandidates[index])) {
      shortBridgeSegmentIndexes.add(index)
    }
  }
  const productDetailCandidates = dedupeRescuePhrases([
    ...combinedProductCandidates,
    ...productSegmentCandidates.filter((_, index) => !shortBridgeSegmentIndexes.has(index)),
    ...contextDetailCandidates,
  ]).slice(0, Math.max(6, contextMaxCandidates))
  const productTailCandidates = dedupeRescuePhrases(
    productDetailCandidates.map((candidate) => {
      const tokens = normalizeGoogleAdsKeyword(candidate).split(/\s+/).filter(Boolean)
      if (tokens.length < 2) return null
      const tail = tokens[tokens.length - 1] || ''
      if (!/^[a-z]{4,}$/i.test(tail)) return null
      if (RESCUE_PREFIX_NOISE_TOKENS.has(tail) || RESCUE_INLINE_SKIP_TOKENS.has(tail)) return null
      return tail
    })
  ).slice(0, 3)
  const categoryDetailCandidates = extractRescuePhraseCandidates(
    input.offer.category || '',
    normalizedBrand || undefined,
    3,
    { maxSegments: 3 }
  ).slice(0, 3)
  const neutralDetailCandidates = collectNeutralRescueDetailCandidates(input, detailTokenLimit)
  const productCore = productDetailCandidates[0] || null
  const categoryCore = categoryDetailCandidates[0] || null

  const results: PoolKeywordData[] = []
  const seen = new Set<string>()
  const pushCandidate = (keyword: string | null, evidence: string[]) => {
    if (!keyword) return
    if (
      getNonEmptyRescueCandidateRejectionReason({
        keyword,
        brandLeadingTokens,
      })
    )
      return
    const normalized = normalizeCandidateKey(keyword)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    results.push(createNonEmptyRescueCandidate(keyword, evidence))
  }
  const pushBrandedRescueCandidate = (detailKeyword: string | null, evidence: string[]) => {
    if (brandKeywordVariants.prefixes.length === 0) return
    if (creativeType === 'model_intent' && !detailKeyword) return
    for (const prefix of brandKeywordVariants.prefixes) {
      pushCandidate(
        composeRescueKeyword([prefix, detailKeyword], combinedTokenLimit, {
          preserveAndToken: true,
        }),
        evidence
      )
    }
  }
  const pushBrandedRescueCandidates = (detailKeywords: string[], evidence: string[]) => {
    for (const detailKeyword of detailKeywords) {
      pushBrandedRescueCandidate(detailKeyword, evidence)
    }
  }
  const pushRescueCandidatePreferBranded = (detailKeyword: string | null, evidence: string[]) => {
    if (brandKeywordVariants.prefixes.length > 0) {
      pushBrandedRescueCandidate(detailKeyword, evidence)
      return
    }
    pushCandidate(detailKeyword, evidence)
  }

  if (creativeType === 'brand_intent' || creativeType === 'product_intent') {
    for (const keyword of dedupeRescuePhrases([pureBrandKeyword, ...brandKeywordVariants.pure])) {
      pushCandidate(keyword, ['pure_brand_floor'])
    }
  }

  if (brandKeywordVariants.prefixes.length > 0) {
    if (creativeType === 'brand_intent' || creativeType === 'product_intent' || !creativeType) {
      pushBrandedRescueCandidates(productTailCandidates, ['offer_product_tail'])
    }
    pushBrandedRescueCandidates(productDetailCandidates, ['offer_product_name'])
    pushBrandedRescueCandidates(contextDetailCandidates, ['offer_context'])
    if (creativeType !== 'model_intent' || productDetailCandidates.length === 0) {
      pushBrandedRescueCandidates(categoryDetailCandidates, ['offer_category'])
    }
    pushBrandedRescueCandidates(neutralDetailCandidates, ['offer_neutral_specs'])
  }

  if (creativeType === 'model_intent') {
    const productModelDetailCandidates = productDetailCandidates
      .filter((candidate) => BUILDER_MODEL_ANCHOR_PATTERN.test(candidate))
      .slice(0, 4)
    const productHasModelAnchor = productModelDetailCandidates.length > 0
    const categoryHasModelAnchor = Boolean(
      categoryCore && BUILDER_MODEL_ANCHOR_PATTERN.test(categoryCore)
    )
    if (brandKeywordVariants.prefixes.length === 0 || productHasModelAnchor) {
      for (const candidate of productModelDetailCandidates) {
        pushRescueCandidatePreferBranded(candidate, ['offer_product_name'])
      }
    }
    if (brandKeywordVariants.prefixes.length === 0 || categoryHasModelAnchor) {
      pushRescueCandidatePreferBranded(categoryCore, ['offer_category'])
    }
    for (const neutralCandidate of neutralDetailCandidates) {
      if (!BUILDER_MODEL_ANCHOR_PATTERN.test(neutralCandidate)) continue
      pushRescueCandidatePreferBranded(neutralCandidate, ['offer_neutral_specs'])
    }
  } else if (creativeType === 'product_intent' || !creativeType) {
    pushRescueCandidatePreferBranded(productCore, ['offer_product_name'])
    pushRescueCandidatePreferBranded(categoryCore, ['offer_category'])
    for (const neutralCandidate of neutralDetailCandidates) {
      pushRescueCandidatePreferBranded(neutralCandidate, ['offer_neutral_specs'])
    }
  }

  return results
}

export function buildNonEmptyRescueSourceQuotaAudit(params: {
  fallbackMode: boolean
  keywordCount: number
}): CreativeKeywordSourceQuotaAudit {
  const count = Math.max(0, Math.floor(params.keywordCount))
  return {
    enabled: true,
    fallbackMode: params.fallbackMode,
    targetCount: count,
    requiredBrandCount: 0,
    acceptedBrandCount: 0,
    acceptedCount: count,
    deferredCount: 0,
    deferredRefillCount: 0,
    deferredRefillTriggered: false,
    underfillBeforeRefill: 0,
    quota: {
      combinedLowTrustCap: Math.max(1, count),
      aiCap: Math.max(1, count),
      aiLlmRawCap: Math.max(1, count),
    },
    acceptedByClass: {
      lowTrust: 0,
      ai: 0,
      aiLlmRaw: 0,
    },
    blockedByCap: {
      lowTrust: 0,
      ai: 0,
      aiLlmRaw: 0,
    },
  }
}

export function augmentSourceQuotaAuditWithRescue(params: {
  audit: CreativeKeywordSourceQuotaAudit
  keywordsWithVolume: PoolKeywordData[]
  brandName: string | undefined
}): CreativeKeywordSourceQuotaAudit {
  const pureBrandKeywords = getPureBrandKeywords(params.brandName || '')
  const acceptedBrandCount = params.keywordsWithVolume.filter((item) =>
    containsPureBrand(String((item as any)?.keyword || ''), pureBrandKeywords)
  ).length

  return {
    ...params.audit,
    targetCount: Math.max(params.audit.targetCount, params.keywordsWithVolume.length),
    acceptedBrandCount,
    acceptedCount: params.keywordsWithVolume.length,
  }
}
