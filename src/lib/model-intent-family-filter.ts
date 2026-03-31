import { normalizeGoogleAdsKeyword } from './google-ads-keyword-normalizer'
import {
  containsAsinLikeToken,
  extractModelAnchorTextsFromScrapedData,
  extractModelIdentifierTokensFromText,
} from './model-anchor-evidence'

const MODEL_CODE_TOKEN_PATTERN = /^[a-z]{1,6}\d{2,5}[a-z]{0,2}$/i
const MODEL_CODE_EXTRACT_PATTERN = /\b[a-z]{1,6}\d{2,5}[a-z]{0,2}\b/gi
const NUMERIC_MODEL_CODE_TOKEN_PATTERN = /^\d{3,4}$/
const NUMERIC_MODEL_CODE_EXTRACT_PATTERN = /\b\d{3,4}\b/g
const SPEC_TERM_EXTRACT_PATTERN = /\b\d{1,5}\s*(?:wh|mah|w|kw|v|ah|l|liter|liters|qt|quart|quarts)\b/gi
export const MODEL_INTENT_MIN_KEYWORD_FLOOR = 3
const SOFT_SIZE_PATTERN = /\b(california king|cal king|king size|queen size|twin xl|twin|queen|king|full)\b/gi
const SOFT_DIMENSION_PATTERN = /\b\d{1,3}\s*(?:inch|in)\b/gi
const SOFT_PACK_PATTERN = /\b\d{1,2}\s*(?:pack|count|pc|piece|pieces|set)\b/gi
const SOFT_ATTRIBUTE_PHRASES = [
  'memory foam',
  'gel memory foam',
  'medium firm',
  'extra firm',
  'ultra firm',
  'cooling gel',
]
const SOFT_ATTRIBUTE_TOKENS = new Set([
  'hybrid',
  'latex',
  'foam',
  'firm',
  'plush',
  'medium',
  'cooling',
  'wood',
  'wooden',
  'metal',
  'steel',
  'leather',
  'cotton',
  'linen',
])
const MODEL_FAMILY_CLAIM_NOISE_TOKENS = new Set([
  'better',
  'clinically',
  'proven',
  'include',
  'included',
  'includes',
  'including',
  'improve',
  'improved',
  'improves',
  'improving',
  'prevent',
  'prevents',
  'prevented',
  'preventing',
  'reduce',
  'reduces',
  'reduced',
  'reducing',
  'reduction',
  'remove',
  'removes',
  'removed',
  'removing',
  'freshen',
  'freshens',
  'freshened',
  'freshening',
  'help',
  'helps',
  'helped',
  'helping',
])
const MODEL_FAMILY_TITLE_BREAK_TOKENS = new Set([
  'with',
  'without',
  'for',
  'from',
  'include',
  'included',
  'includes',
  'including',
  'clinically',
  'proven',
  'improve',
  'improves',
  'improved',
  'improving',
  'prevent',
  'prevents',
  'prevented',
  'preventing',
  'reduce',
  'reduces',
  'reduced',
  'reducing',
  'freshen',
  'freshens',
  'freshened',
  'freshening',
  'remove',
  'removes',
  'removed',
  'removing',
  'helps',
  'help',
])
const MODEL_FAMILY_PHRASE_NOISE_TOKENS = new Set([
  ...MODEL_FAMILY_CLAIM_NOISE_TOKENS,
  'official',
  'store',
  'shop',
  'shops',
  'brand',
  'amazon',
  'walmart',
  'ebay',
  'etsy',
  'temu',
  'aliexpress',
  'reddit',
  'forum',
  'forums',
  'online',
  'review',
  'reviews',
  'price',
  'sale',
  'deal',
  'discount',
  'coupon',
  'promo',
  'http',
  'https',
  'www',
  'com',
  'net',
  'org',
  'html',
  'htm',
  'php',
  'asp',
  'aspx',
  'product',
  'products',
  'item',
  'items',
  'detail',
  'details',
  'page',
  'pages',
  'dp',
  'gp',
])
const MODEL_FAMILY_PACK_TOKENS = new Set([
  'pack',
  'count',
  'pc',
  'piece',
  'pieces',
  'set',
])
const MODEL_FAMILY_NUMERIC_CODE_SPEC_CONTEXT_PATTERN = /\b(?:gpd|btu|lm|mah|wh|w|kw|v|ah|l|liter|liters|qt|quart|quarts|inch|in|ft|oz|lb|lbs|kg|g|cup|cups)\b/i

const LINE_TERM_STOPWORDS = new Set([
  'with',
  'without',
  'for',
  'from',
  'and',
  'the',
  'new',
  'portable',
  'power',
  'station',
  'generator',
  'solar',
  'battery',
  'home',
  'backup',
  'output',
  'ultra',
  'high',
  'ac',
  'dc',
  'official',
  'store',
  'price',
  'buy',
  'best',
  'model',
  'series',
  'version',
  'gen',
  'generation',
  'name',
  'number',
  'description',
  'additional',
  'construction',
  'material',
  'feature',
  'features',
  'recommended',
  'uses',
  'item',
  'type',
  'depth',
  'weight',
  'dimension',
  'dimensions',
  'brand',
  'color',
  'colour',
  'cover',
  'fill',
  'care',
  'benefits',
  'instruction',
  'instructions',
  'http',
  'https',
  'www',
  'com',
  'net',
  'org',
  'html',
  'htm',
  'php',
  'asp',
  'aspx',
  'product',
  'products',
  'item',
  'items',
  'detail',
  'details',
  'page',
  'pages',
  'dp',
  'gp',
  'size',
  'inch',
  'in',
  'pack',
  'count',
  'pc',
  'piece',
  'pieces',
  'set',
  'foam',
  'firm',
  'plush',
  'medium',
  'memory',
  'hybrid',
  'latex',
  'cooling',
  'queen',
  'king',
  'twin',
  'full',
])

export interface ProductModelFamilyContext {
  brandTokens?: string[]
  modelCodes: string[]
  lineTerms: string[]
  specTerms: string[]
  evidenceTexts: string[]
  productCoreTerms?: string[]
  attributeTerms?: string[]
  softFamilyTerms?: string[]
}

export interface ProductModelOfferLike {
  brand?: string | null
  product_name?: string | null
  offer_name?: string | null
  scraped_data?: string | null
  final_url?: string | null
  url?: string | null
}

function parseScrapedData(value: unknown): Record<string, unknown> | null {
  if (!value) return null
  if (typeof value === 'object') return value as Record<string, unknown>

  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function pushText(target: string[], value: unknown): void {
  if (typeof value !== 'string') return
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (trimmed) target.push(trimmed)
}

function collectPrimaryEvidenceTexts(offer: ProductModelOfferLike): string[] {
  const values: string[] = []
  pushText(values, offer.product_name)
  pushText(values, offer.final_url)
  pushText(values, offer.url)

  const parsed = parseScrapedData(offer.scraped_data)
  if (parsed) {
    pushText(values, parsed.rawProductTitle)
    pushText(values, parsed.title)
    pushText(values, parsed.productTitle)
    pushText(values, parsed.product_name)
    pushText(values, parsed.name)
  }

  return Array.from(new Set(values))
}

function collectAuxiliaryEvidenceTexts(offer: ProductModelOfferLike): string[] {
  const values: string[] = []
  pushText(values, offer.offer_name)

  const parsed = parseScrapedData(offer.scraped_data)
  if (parsed) {
    pushText(values, parsed.model)
    pushText(values, parsed.series)
    pushText(values, parsed.variant)
    pushText(values, parsed.sku)
  }

  const scrapedTexts = extractModelAnchorTextsFromScrapedData(offer.scraped_data)
  for (const text of scrapedTexts) {
    pushText(values, text)
  }

  return Array.from(new Set(values))
}

function toBrandTokenSet(brandName: string | null | undefined): Set<string> {
  const normalizedBrand = normalizeGoogleAdsKeyword(brandName || '')
  if (!normalizedBrand) return new Set<string>()
  return new Set(normalizedBrand.split(/\s+/).filter(Boolean))
}

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function tokenizeNormalizedText(text: string): string[] {
  return (normalizeGoogleAdsKeyword(text) || '')
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean)
}

function isModelFamilyNoiseToken(token: string): boolean {
  return LINE_TERM_STOPWORDS.has(token) || MODEL_FAMILY_CLAIM_NOISE_TOKENS.has(token)
}

function isModelFamilyPhraseNoiseToken(token: string): boolean {
  return MODEL_FAMILY_PHRASE_NOISE_TOKENS.has(token)
}

function isModelFamilyPackToken(token: string): boolean {
  return MODEL_FAMILY_PACK_TOKENS.has(token)
}

function hasClaimLikeNumericCodeContext(code: string, evidenceTexts: string[]): boolean {
  const escaped = escapeRegExp(code)
  const patterns = [
    new RegExp(`\\b${escaped}\\s*%`, 'i'),
    new RegExp(`\\b${escaped}\\b\\s+(?:better|more|less|remove(?:s|d|ing)?|improve(?:s|d|ing)?|prevent(?:s|ed|ing)?|reduce(?:s|d|ing|tion)?|include(?:s|d|ing)?)\\b`, 'i'),
    new RegExp(`\\b(?:better|more|less|remove(?:s|d|ing)?|improve(?:s|d|ing)?|prevent(?:s|ed|ing)?|reduce(?:s|d|ing|tion)?|include(?:s|d|ing)?)\\b(?:\\s+\\w+){0,2}\\s+\\b${escaped}\\b`, 'i'),
  ]

  return evidenceTexts.some((text) => {
    const raw = String(text || '')
    const normalized = normalizeGoogleAdsKeyword(text) || ''
    return patterns.some((pattern) => pattern.test(raw) || pattern.test(normalized))
  })
}

function hasSpecLikeNumericCodeContext(code: string, evidenceTexts: string[]): boolean {
  const escaped = escapeRegExp(code)
  const pattern = new RegExp(`\\b${escaped}\\b\\s*(?:gpd|btu|lm|mah|wh|w|kw|v|ah|l|liter|liters|qt|quart|quarts|inch|in|ft|oz|lb|lbs|kg|g|cup|cups)\\b`, 'i')
  return evidenceTexts.some((text) => pattern.test(normalizeGoogleAdsKeyword(text) || ''))
}

function hasLeadingNumericCodeContext(params: {
  code: string
  evidenceTexts: string[]
  brandTokens: Set<string>
}): boolean {
  for (const text of params.evidenceTexts.slice(0, 4)) {
    const tokens = tokenizeNormalizedText(text)
      .filter((token) => !params.brandTokens.has(token))
    const index = tokens.indexOf(params.code)
    if (index >= 0 && index <= 3) return true
  }

  return false
}

function shouldRetainExtractedModelCode(params: {
  code: string
  primaryEvidenceTexts: string[]
  auxiliaryEvidenceTexts: string[]
  brandTokens: Set<string>
}): boolean {
  if (!NUMERIC_MODEL_CODE_TOKEN_PATTERN.test(params.code)) return true
  if (hasSpecLikeNumericCodeContext(params.code, params.primaryEvidenceTexts)) return true
  if (hasLeadingNumericCodeContext({
    code: params.code,
    evidenceTexts: params.primaryEvidenceTexts,
    brandTokens: params.brandTokens,
  })) {
    return true
  }

  return !hasClaimLikeNumericCodeContext(
    params.code,
    [...params.primaryEvidenceTexts, ...params.auxiliaryEvidenceTexts]
  )
}

function collectLeadingTitleProductPhrases(params: {
  evidenceTexts: string[]
  brandTokens: Set<string>
  modelCodes: Set<string>
  specTerms: Set<string>
}): string[] {
  const phrases = new Set<string>()
  const specTokenSet = new Set(
    Array.from(params.specTerms)
      .flatMap((term) => tokenizeNormalizedText(term))
      .map(normalizeToken)
      .filter(Boolean)
  )

  for (const text of params.evidenceTexts.slice(0, 2)) {
    const normalized = normalizeGoogleAdsKeyword(text) || ''
    if (!normalized) continue

    const leadingSegment = normalized
      .split(/[,:;()]/)[0]
      .trim()
    if (!leadingSegment) continue

    const segmentTokens = leadingSegment.split(/\s+/).filter(Boolean)
    const collected: string[] = []
    let started = false

    for (let index = 0; index < segmentTokens.length; index += 1) {
      const rawToken = segmentTokens[index]
      const token = normalizeToken(rawToken)
      if (!token) continue
      const nextToken = normalizeToken(segmentTokens[index + 1] || '')

      if (!started && params.brandTokens.has(token)) continue
      if (!started && (params.modelCodes.has(token) || specTokenSet.has(token))) continue
      if (!started && /^\d+$/.test(token) && isModelFamilyPackToken(nextToken)) {
        index += 1
        continue
      }
      if (!started && (isModelFamilyPackToken(token) || isModelFamilyPhraseNoiseToken(token))) continue
      if (containsAsinLikeToken(token)) break
      if (MODEL_FAMILY_TITLE_BREAK_TOKENS.has(token)) break
      if (started && isModelFamilyPhraseNoiseToken(token)) break
      collected.push(rawToken)
      started = true
      if (collected.length >= 6) break
    }

    while (collected.length > 0) {
      const firstToken = normalizeToken(collected[0] || '')
      const secondToken = normalizeToken(collected[1] || '')
      if (/^\d+$/.test(firstToken) && isModelFamilyPackToken(secondToken)) {
        collected.shift()
        collected.shift()
        continue
      }
      if (isModelFamilyPackToken(firstToken) || isModelFamilyPhraseNoiseToken(firstToken)) {
        collected.shift()
        continue
      }
      break
    }

    while (collected.length > 0) {
      const lastToken = normalizeToken(collected[collected.length - 1] || '')
      if (
        !lastToken
        || isModelFamilyPackToken(lastToken)
        || isModelFamilyPhraseNoiseToken(lastToken)
      ) {
        collected.pop()
        continue
      }
      break
    }

    const phrase = normalizeGoogleAdsKeyword(collected.join(' '))
    if (!phrase) continue

    const phraseTokens = phrase
      .split(/\s+/)
      .map(normalizeToken)
      .filter(Boolean)
      .filter((token) => !params.brandTokens.has(token))
    if (phraseTokens.length < 2) continue
    if (phraseTokens.every((token) => isModelFamilyPhraseNoiseToken(token) || isModelFamilyPackToken(token))) {
      continue
    }

    phrases.add(phrase)
    if (phraseTokens.length > 3) {
      const shorter = normalizeGoogleAdsKeyword(phraseTokens.slice(0, 3).join(' '))
      if (shorter) phrases.add(shorter)
    }
  }

  return Array.from(phrases).slice(0, 4)
}

function filterFallbackSingleTerms(
  terms: string[],
  brandTokens: Set<string>
): string[] {
  return Array.from(new Set(
    terms
      .map((item) => normalizeGoogleAdsKeyword(item))
      .filter((item): item is string => Boolean(item))
  ))
    .filter((item) => {
      const token = normalizeToken(item)
      if (!token || token.length < 4) return false
      if (brandTokens.has(token)) return false
      if (containsAsinLikeToken(token)) return false
      if (NUMERIC_MODEL_CODE_TOKEN_PATTERN.test(token)) return false
      if (isModelFamilyNoiseToken(token)) return false
      return true
    })
}

function filterFallbackPhrases(
  phrases: string[],
  brandTokens: Set<string>
): string[] {
  return Array.from(new Set(
    phrases
      .map((item) => normalizeGoogleAdsKeyword(item))
      .filter((item): item is string => Boolean(item))
  ))
    .filter((item) => {
      if (containsAsinLikeToken(item)) return false
      const tokens = item
        .split(/\s+/)
        .map(normalizeToken)
        .filter(Boolean)
        .filter((token) => !brandTokens.has(token))
      if (tokens.length < 2) return false
      if (tokens.some((token) => isModelFamilyPhraseNoiseToken(token))) return false
      if (/^\d+$/.test(tokens[tokens.length - 1] || '')) return false
      if (
        isModelFamilyPackToken(tokens[tokens.length - 1] || '')
        || isModelFamilyPhraseNoiseToken(tokens[tokens.length - 1] || '')
      ) {
        return false
      }
      if (tokens.every((token) => isModelFamilyPhraseNoiseToken(token) || isModelFamilyPackToken(token))) {
        return false
      }
      return true
    })
}

function isOpaqueModelIdentifierToken(token: string): boolean {
  const normalized = normalizeToken(token)
  if (!normalized) return false

  const extracted = extractModelIdentifierTokensFromText(normalized)
    .map(normalizeToken)
    .filter(Boolean)
  if (!extracted.includes(normalized)) return false

  const digitCount = (normalized.match(/\d/g) || []).length
  const letterCount = (normalized.match(/[a-z]/g) || []).length
  if (digitCount < 3 || letterCount < 1) return false

  return normalized.length >= 6 || digitCount >= 4
}

function isConsumerFacingProductSpec(term: string): boolean {
  const normalized = normalizeGoogleAdsKeyword(term) || ''
  if (!normalized) return false
  return /^\d{1,5}\s*(?:l|liter|liters|qt|quart|quarts)$/.test(normalized)
}

function extractModelCodesFromText(text: string): string[] {
  const generalizedTokens = extractModelIdentifierTokensFromText(text)
  const generalizedTokenSet = new Set(generalizedTokens.map(normalizeToken).filter(Boolean))
  const modelLikeMatches = [
    ...(text.match(MODEL_CODE_EXTRACT_PATTERN) || []),
    ...(text.match(NUMERIC_MODEL_CODE_EXTRACT_PATTERN) || []),
    ...generalizedTokens,
  ]
  const normalized = modelLikeMatches
    .map(normalizeToken)
    .filter(Boolean)
    .filter((token) =>
      MODEL_CODE_TOKEN_PATTERN.test(token)
      || NUMERIC_MODEL_CODE_TOKEN_PATTERN.test(token)
      || generalizedTokenSet.has(token)
    )
  return Array.from(new Set(normalized))
}

function extractSpecTermsFromText(text: string): string[] {
  const normalized = normalizeGoogleAdsKeyword(text)
  if (!normalized) return []
  const matches = normalized.match(SPEC_TERM_EXTRACT_PATTERN) || []
  return Array.from(new Set(matches.map((item) => item.toLowerCase())))
}

function normalizeSoftAttributePhrase(value: string): string {
  const normalized = normalizeGoogleAdsKeyword(value) || ''
  if (!normalized) return ''
  if (normalized === 'california king' || normalized === 'cal king') return 'cal king'
  if (normalized === 'king size') return 'king'
  if (normalized === 'queen size') return 'queen'
  if (normalized === 'twin xl') return 'twin xl'

  const dimensionMatch = normalized.match(/^(\d{1,3})\s*(?:inch|in)$/)
  if (dimensionMatch) return `${dimensionMatch[1]} inch`

  const packMatch = normalized.match(/^(\d{1,2})\s*(?:pack|count|pc|piece|pieces|set)$/)
  if (packMatch) return `${packMatch[1]} pack`

  return normalized
}

function extractSoftAttributeTermsFromText(text: string): string[] {
  const normalized = normalizeGoogleAdsKeyword(text)
  if (!normalized) return []

  const attributes = new Set<string>()
  for (const phrase of SOFT_ATTRIBUTE_PHRASES) {
    if (normalized.includes(phrase)) {
      attributes.add(phrase)
    }
  }

  for (const match of normalized.match(SOFT_SIZE_PATTERN) || []) {
    const attribute = normalizeSoftAttributePhrase(match)
    if (attribute) attributes.add(attribute)
  }
  for (const match of normalized.match(SOFT_DIMENSION_PATTERN) || []) {
    const attribute = normalizeSoftAttributePhrase(match)
    if (attribute) attributes.add(attribute)
  }
  for (const match of normalized.match(SOFT_PACK_PATTERN) || []) {
    const attribute = normalizeSoftAttributePhrase(match)
    if (attribute) attributes.add(attribute)
  }

  for (const token of normalized.split(/\s+/)) {
    const normalizedToken = normalizeToken(token)
    if (SOFT_ATTRIBUTE_TOKENS.has(normalizedToken)) {
      attributes.add(normalizedToken)
    }
  }

  return Array.from(attributes)
}

function pruneSubsumedSoftAttributeTerms(attributeTerms: string[]): string[] {
  const normalizedTerms = Array.from(new Set(
    attributeTerms
      .map((term) => normalizeGoogleAdsKeyword(term))
      .filter((term): term is string => Boolean(term))
  ))
  const multiTokenTerms = normalizedTerms
    .map((term) => ({
      term,
      tokens: term.split(/\s+/).map(normalizeToken).filter(Boolean),
    }))
    .filter((item) => item.tokens.length > 1)

  return normalizedTerms.filter((term) => {
    const tokens = term.split(/\s+/).map(normalizeToken).filter(Boolean)
    if (tokens.length !== 1) return true
    const [token] = tokens
    return !multiTokenTerms.some((item) => item.tokens.includes(token))
  })
}

function collectLineTermsFromEvidence(params: {
  evidenceTexts: string[]
  brandTokens: Set<string>
  modelCodes: Set<string>
}): string[] {
  const { evidenceTexts, brandTokens, modelCodes } = params
  const lineTerms = new Set<string>()

  for (const text of evidenceTexts) {
    const normalized = normalizeGoogleAdsKeyword(text)
    if (!normalized) continue
    const tokens = normalized.split(/\s+/).filter(Boolean)

    for (let i = 0; i < tokens.length; i += 1) {
      const token = normalizeToken(tokens[i])
      if (!token || !modelCodes.has(token)) continue

      for (const offset of [-2, -1, 1]) {
        const candidate = normalizeToken(tokens[i + offset] || '')
        if (!candidate) continue
        if (candidate.length < 4) continue
        if (brandTokens.has(candidate)) continue
        if (MODEL_CODE_TOKEN_PATTERN.test(candidate)) continue
        if (LINE_TERM_STOPWORDS.has(candidate)) continue
        lineTerms.add(candidate)
      }
    }
  }

  return Array.from(lineTerms)
}

function buildSoftAttributeTokenSet(attributeTerms: string[]): Set<string> {
  return new Set(
    attributeTerms
      .flatMap((term) => (normalizeGoogleAdsKeyword(term) || '').split(/\s+/))
      .map(normalizeToken)
      .filter(Boolean)
  )
}

function collectProductCoreTerms(params: {
  evidenceTexts: string[]
  brandTokens: Set<string>
  modelCodes: Set<string>
  specTerms: Set<string>
  attributeTerms: string[]
}): string[] {
  const tokenCounts = new Map<string, number>()
  const attributeTokenSet = buildSoftAttributeTokenSet(params.attributeTerms)
  const specTokenSet = new Set(
    Array.from(params.specTerms)
      .flatMap((term) => (normalizeGoogleAdsKeyword(term) || '').split(/\s+/))
      .map(normalizeToken)
      .filter(Boolean)
  )

  for (const text of params.evidenceTexts) {
    const normalized = normalizeGoogleAdsKeyword(text)
    if (!normalized) continue

    for (const rawToken of normalized.split(/\s+/)) {
      const token = normalizeToken(rawToken)
      if (!token) continue
      if (token.length < 4) continue
      if (containsAsinLikeToken(token)) continue
      if (params.brandTokens.has(token)) continue
      if (params.modelCodes.has(token)) continue
      if (specTokenSet.has(token)) continue
      if (attributeTokenSet.has(token)) continue
      if (LINE_TERM_STOPWORDS.has(token)) continue
      tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1)
    }
  }

  return Array.from(tokenCounts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([token]) => token)
    .slice(0, 4)
}

function collectProminentTitleLineTerms(params: {
  evidenceTexts: string[]
  brandTokens: Set<string>
  productCoreTerms: string[]
  attributeTerms: string[]
  specTerms: Set<string>
}): string[] {
  const lineTerms = new Set<string>()
  const productCoreSet = new Set(params.productCoreTerms.map(normalizeToken).filter(Boolean))
  const attributeTokenSet = buildSoftAttributeTokenSet(params.attributeTerms)
  const specTokenSet = new Set(
    Array.from(params.specTerms)
      .flatMap((term) => (normalizeGoogleAdsKeyword(term) || '').split(/\s+/))
      .map(normalizeToken)
      .filter(Boolean)
  )

  for (const text of params.evidenceTexts.slice(0, 4)) {
    const rawTokens = String(text || '')
      .split(/[\s/|,()\-–—]+/)
      .map((token) => token.trim())
      .filter(Boolean)

    for (let index = 0; index < Math.min(rawTokens.length, 8); index += 1) {
      const rawToken = rawTokens[index]
      const token = normalizeToken(rawToken)
      if (!token) continue
      if (token.length < 4) continue
      if (params.brandTokens.has(token)) continue
      if (LINE_TERM_STOPWORDS.has(token)) continue
      if (productCoreSet.has(token)) continue
      if (attributeTokenSet.has(token)) continue
      if (specTokenSet.has(token)) continue
      if (containsAsinLikeToken(token)) continue
      if (/^\d/.test(token)) continue

      const looksProminent =
        /[A-Z]{2,}/.test(rawToken)
        || /[a-z][A-Z]/.test(rawToken)
      const prevToken = rawTokens[index - 1] || ''
      const nextToken = rawTokens[index + 1] || ''
      const nearNumericCue =
        /^\d+[a-z]*$/i.test(prevToken)
        || /^\d+[a-z]*$/i.test(nextToken)

      if (!looksProminent && !nearNumericCue) continue
      lineTerms.add(token)
    }
  }

  return Array.from(lineTerms).slice(0, 4)
}

function buildSoftFamilyTerms(productCoreTerms: string[], attributeTerms: string[]): string[] {
  const families = new Set<string>()

  for (const productCore of productCoreTerms) {
    const normalizedProductCore = normalizeGoogleAdsKeyword(productCore)
    if (!normalizedProductCore) continue

    for (const attribute of attributeTerms) {
      const normalizedAttribute = normalizeGoogleAdsKeyword(attribute)
      if (!normalizedAttribute) continue
      families.add(`${normalizedAttribute} ${normalizedProductCore}`.trim())
    }
  }

  return Array.from(families)
}

function collectTitleProductFamilyPhrases(params: {
  evidenceTexts: string[]
  lineTerms: string[]
}): string[] {
  const phrases = new Set<string>()
  const normalizedLineTerms = params.lineTerms
    .map((term) => normalizeGoogleAdsKeyword(term))
    .filter((term): term is string => Boolean(term))
  if (normalizedLineTerms.length === 0) return []

  const lineTermSet = new Set(normalizedLineTerms.map(normalizeToken))
  for (const text of params.evidenceTexts.slice(0, 2)) {
    const tokens = (normalizeGoogleAdsKeyword(text) || '').split(/\s+/).filter(Boolean)
    for (let index = 0; index < tokens.length; index += 1) {
      const current = normalizeToken(tokens[index])
      if (!lineTermSet.has(current)) continue

      const phraseTokens = [tokens[index]]
      const nextToken = tokens[index + 1] || ''
      const normalizedNext = normalizeToken(nextToken)
      if (lineTermSet.has(normalizedNext) && normalizedNext !== current) {
        phraseTokens.push(nextToken)
      }

      const suffixToken = tokens[index + phraseTokens.length] || ''
      if (/^\d{1,2}$/.test(suffixToken)) {
        phraseTokens.push(suffixToken)
      }

      if (phraseTokens.length >= 2) {
        phrases.add(phraseTokens.join(' '))
      }
    }
  }

  return Array.from(phrases).slice(0, 4)
}

export function buildProductModelFamilyContext(offer: ProductModelOfferLike): ProductModelFamilyContext {
  const primaryEvidenceTexts = collectPrimaryEvidenceTexts(offer)
  const auxiliaryEvidenceTexts = collectAuxiliaryEvidenceTexts(offer)
  const evidenceTexts = Array.from(new Set([
    ...primaryEvidenceTexts,
    ...auxiliaryEvidenceTexts,
  ]))
  const brandTokens = toBrandTokenSet(offer.brand)
  const primaryModelCodeSet = new Set<string>()
  const auxiliaryModelCodeSet = new Set<string>()
  const specTermSet = new Set<string>()
  const attributeTermSet = new Set<string>()

  for (const text of primaryEvidenceTexts) {
    for (const code of extractModelCodesFromText(text)) {
      if (brandTokens.has(code)) continue
      if (!shouldRetainExtractedModelCode({
        code,
        primaryEvidenceTexts,
        auxiliaryEvidenceTexts,
        brandTokens,
      })) {
        continue
      }
      primaryModelCodeSet.add(code)
    }
  }

  for (const text of auxiliaryEvidenceTexts) {
    for (const code of extractModelCodesFromText(text)) {
      if (brandTokens.has(code)) continue
      if (!shouldRetainExtractedModelCode({
        code,
        primaryEvidenceTexts,
        auxiliaryEvidenceTexts,
        brandTokens,
      })) {
        continue
      }
      auxiliaryModelCodeSet.add(code)
    }
  }

  const modelCodeSet = new Set<string>(primaryModelCodeSet)
  for (const code of auxiliaryModelCodeSet) {
    if (primaryModelCodeSet.has(code) || !isOpaqueModelIdentifierToken(code)) {
      modelCodeSet.add(code)
    }
  }

  for (const text of evidenceTexts) {
    for (const spec of extractSpecTermsFromText(text)) {
      specTermSet.add(spec)
    }
    for (const attribute of extractSoftAttributeTermsFromText(text)) {
      attributeTermSet.add(attribute)
    }
  }
  const prunedAttributeTerms = pruneSubsumedSoftAttributeTerms(Array.from(attributeTermSet))
  const titleLeadingProductPhrases = collectLeadingTitleProductPhrases({
    evidenceTexts: primaryEvidenceTexts,
    brandTokens,
    modelCodes: modelCodeSet,
    specTerms: specTermSet,
  })

  const inferredLineTerms = collectLineTermsFromEvidence({
    evidenceTexts,
    brandTokens,
    modelCodes: modelCodeSet,
  })
  const productCoreTerms = collectProductCoreTerms({
    evidenceTexts,
    brandTokens,
    modelCodes: modelCodeSet,
    specTerms: specTermSet,
    attributeTerms: prunedAttributeTerms,
  })
  const prominentTitleLineTerms = collectProminentTitleLineTerms({
    evidenceTexts: primaryEvidenceTexts,
    brandTokens,
    productCoreTerms,
    attributeTerms: prunedAttributeTerms,
    specTerms: specTermSet,
  })
  const lineTerms = Array.from(new Set([
    ...inferredLineTerms,
    ...prominentTitleLineTerms,
  ])).slice(0, 4)
  const keepTitleLeadingSoftFamilyTerms = !(
    modelCodeSet.size === 0
    && lineTerms.length === 0
    && specTermSet.size === 0
    && productCoreTerms.length === 0
    && prunedAttributeTerms.length === 0
    && titleLeadingProductPhrases.length > 0
    && titleLeadingProductPhrases.every((phrase) => (normalizeGoogleAdsKeyword(phrase) || '').split(/\s+/).filter(Boolean).length <= 2)
  )
  const softFamilyTerms = Array.from(new Set([
    ...buildSoftFamilyTerms(productCoreTerms, prunedAttributeTerms),
    ...(keepTitleLeadingSoftFamilyTerms ? titleLeadingProductPhrases : []),
  ])).slice(0, 6)

  return {
    brandTokens: Array.from(brandTokens),
    modelCodes: Array.from(modelCodeSet),
    lineTerms,
    specTerms: Array.from(specTermSet),
    evidenceTexts,
    productCoreTerms,
    attributeTerms: prunedAttributeTerms,
    softFamilyTerms,
  }
}

function extractModelCodesFromKeyword(keyword: string): string[] {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return []

  const tokens = normalized
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean)

  const generalizedTokens = extractModelIdentifierTokensFromText(keyword)
    .map(normalizeToken)
    .filter(Boolean)

  return Array.from(new Set(
    [
      ...tokens.filter((token) => MODEL_CODE_TOKEN_PATTERN.test(token) || NUMERIC_MODEL_CODE_TOKEN_PATTERN.test(token)),
      ...generalizedTokens,
    ]
  ))
}

function keywordContainsAnyToken(keyword: string, tokens: Set<string>): boolean {
  if (tokens.size === 0) return false
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return false
  const keywordTokens = normalized.split(/\s+/).map(normalizeToken).filter(Boolean)
  return keywordTokens.some((token) => tokens.has(token))
}

function keywordContainsAnyPhrase(keyword: string, phrases: string[]): boolean {
  if (!Array.isArray(phrases) || phrases.length === 0) return false
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return false
  return phrases.some((phrase) => {
    const normalizedPhrase = normalizeGoogleAdsKeyword(phrase)
    return Boolean(normalizedPhrase) && normalized.includes(normalizedPhrase)
  })
}

export function isKeywordInProductModelFamily(
  keyword: string,
  context: ProductModelFamilyContext
): boolean {
  const brandTokenSet = new Set((context.brandTokens || []).map(normalizeToken).filter(Boolean))
  const modelCodeSet = new Set(context.modelCodes.map(normalizeToken).filter(Boolean))
  const lineTermSet = new Set(context.lineTerms.map(normalizeToken).filter(Boolean))
  const specTermSet = new Set(context.specTerms.map((item) => item.toLowerCase()).filter(Boolean))
  const productCoreSet = new Set((context.productCoreTerms || []).map(normalizeToken).filter(Boolean))
  const softFamilyTerms = context.softFamilyTerms || []
  const attributeTerms = context.attributeTerms || []
  const contextSoftAttributeSet = new Set(
    attributeTerms
      .map((item) => normalizeGoogleAdsKeyword(item))
      .filter((item): item is string => Boolean(item))
  )
  const contextSoftAttributeNumberTokens = new Set(
    Array.from(contextSoftAttributeSet)
      .flatMap((item) => item.split(/\s+/))
      .map(normalizeToken)
      .filter((token) => /^\d{1,3}$/.test(token))
  )
  const keywordSoftAttributeTerms = pruneSubsumedSoftAttributeTerms(
    extractSoftAttributeTermsFromText(keyword)
  )
    .map((item) => normalizeGoogleAdsKeyword(item))
    .filter((item): item is string => Boolean(item))
  const normalizedKeyword = normalizeGoogleAdsKeyword(keyword)
  const keywordTokens = (normalizedKeyword || '')
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean)
  const keywordTokenSet = new Set(keywordTokens)
  const hasBrandTokenMatch = brandTokenSet.size > 0
    && keywordTokens.some((token) => brandTokenSet.has(token))
  const nonBrandKeywordTokens = keywordTokens.filter((token) => !brandTokenSet.has(token))
  const lineMatchCount = Array.from(lineTermSet).filter((token) => keywordTokenSet.has(token)).length
  const matchedSpecTerms = Array.from(specTermSet).filter((term) => {
    const specTokens = (normalizeGoogleAdsKeyword(term) || '')
      .split(/\s+/)
      .map(normalizeToken)
      .filter(Boolean)
    return specTokens.length > 0 && specTokens.every((token) => keywordTokenSet.has(token))
  })
  const hasFriendlySpecMatch = matchedSpecTerms.some(isConsumerFacingProductSpec)
  const hasProductCoreMatch = Array.from(productCoreSet).some((token) => keywordTokenSet.has(token))
  const hasSoftFamilyPhraseMatch = keywordContainsAnyPhrase(keyword, softFamilyTerms)
  const hasAttributePhraseMatch = keywordContainsAnyPhrase(keyword, attributeTerms)
  const hasHardModelCode = modelCodeSet.size > 0
  const hasLineTermOnlySignals =
    !hasHardModelCode
    && lineTermSet.size > 0
    && specTermSet.size === 0
    && productCoreSet.size === 0
    && softFamilyTerms.length === 0
    && attributeTerms.length === 0

  if (
    modelCodeSet.size === 0
    && lineTermSet.size === 0
    && specTermSet.size === 0
    && productCoreSet.size === 0
    && softFamilyTerms.length === 0
    && attributeTerms.length === 0
  ) {
    return true
  }

  const keywordModelCodes = extractModelCodesFromKeyword(keyword)
  if (keywordModelCodes.length > 0) {
    const hasAllowedCode = keywordModelCodes.some((code) => modelCodeSet.has(normalizeToken(code)))
    if (hasAllowedCode) return true
    return false
  }

  if (
    contextSoftAttributeSet.size > 0
    && keywordSoftAttributeTerms.some((term) => !contextSoftAttributeSet.has(term))
  ) {
    return false
  }

  if (
    contextSoftAttributeNumberTokens.size > 0
    && keywordTokens.some((token) => /^\d{1,3}$/.test(token) && !contextSoftAttributeNumberTokens.has(token))
  ) {
    return false
  }

  if (
    productCoreSet.size > 0
    && (
      hasSoftFamilyPhraseMatch
      || (hasProductCoreMatch && hasAttributePhraseMatch)
    )
  ) {
    return true
  }

  // Keep a single branded core term (e.g. "novilla mattress") for model-intent
  // soft-family products, while still rejecting broader weak variants.
  const hasBrandedSingleCorePhrase = (
    !hasHardModelCode
    && brandTokenSet.size > 0
    && hasBrandTokenMatch
    && nonBrandKeywordTokens.length === 1
    && productCoreSet.has(nonBrandKeywordTokens[0])
    && !hasAttributePhraseMatch
    && !hasSoftFamilyPhraseMatch
    && !hasFriendlySpecMatch
  )
  if (hasBrandedSingleCorePhrase) {
    return true
  }

  if (hasHardModelCode) {
    return false
  }

  if (hasLineTermOnlySignals) {
    return lineMatchCount > 0
  }

  if (lineMatchCount >= 2) return true
  if (lineMatchCount > 0 && hasProductCoreMatch) return true
  if (lineMatchCount > 0 && hasFriendlySpecMatch) return true
  if (hasProductCoreMatch && hasFriendlySpecMatch) return true

  return false
}

export function filterKeywordObjectsByProductModelFamily<T extends { keyword: string }>(
  items: T[],
  context: ProductModelFamilyContext
): {
  filtered: T[]
  removed: Array<{ item: T; reason: 'foreign_model_or_family_mismatch' }>
} {
  if (!Array.isArray(items) || items.length === 0) {
    return { filtered: [], removed: [] }
  }

  const hasHardFamilySignals =
    context.modelCodes.length > 0
    || context.lineTerms.length > 0
    || context.specTerms.length > 0
  const hasSoftFamilySignals =
    (context.softFamilyTerms?.length || 0) > 0
    || (
      (context.productCoreTerms?.length || 0) > 0
      && (context.attributeTerms?.length || 0) > 0
    )
  const hasFamilySignals = hasHardFamilySignals || hasSoftFamilySignals
  if (!hasFamilySignals) {
    return { filtered: [...items], removed: [] }
  }

  const filtered: T[] = []
  const removed: Array<{ item: T; reason: 'foreign_model_or_family_mismatch' }> = []

  for (const item of items) {
    if (isKeywordInProductModelFamily(item.keyword, context)) {
      filtered.push(item)
    } else {
      removed.push({ item, reason: 'foreign_model_or_family_mismatch' })
    }
  }

  return { filtered, removed }
}

export function buildProductModelFamilyFallbackKeywords(params: {
  context: ProductModelFamilyContext
  brandName?: string | null
}): string[] {
  const brand = normalizeGoogleAdsKeyword(params.brandName || '')
  const code = params.context.modelCodes[0]
  const brandTokens = toBrandTokenSet(params.brandName)
  const hasExpandedFallbackSignals =
    Boolean(code)
    || (params.context.lineTerms?.length || 0) >= 2
    || (params.context.specTerms?.length || 0) > 0
    || (params.context.productCoreTerms?.length || 0) > 0
  const titleLeadingProductPhrases = filterFallbackPhrases(
    collectLeadingTitleProductPhrases({
      evidenceTexts: params.context.evidenceTexts,
      brandTokens,
      modelCodes: new Set(params.context.modelCodes.map(normalizeToken).filter(Boolean)),
      specTerms: new Set(params.context.specTerms || []),
    }),
    brandTokens
  )
  const normalizedLineTerms = (
    code
      ? filterFallbackSingleTerms(params.context.lineTerms, brandTokens)
      : titleLeadingProductPhrases.length > 0 && !hasExpandedFallbackSignals
        ? []
        : filterFallbackSingleTerms(params.context.lineTerms, brandTokens)
  ).slice(0, 3)
  const primaryLine = normalizedLineTerms[0]
  const hasHardModelCode = Boolean(code)
  const combinedLinePhrase = normalizedLineTerms.length >= 2
    ? normalizedLineTerms.slice(0, 2).join(' ')
    : ''
  const titleLinePhrases = filterFallbackPhrases(collectTitleProductFamilyPhrases({
    evidenceTexts: params.context.evidenceTexts,
    lineTerms: normalizedLineTerms,
  }), brandTokens)
  const productCoreTerms = (
    code
      ? filterFallbackSingleTerms(params.context.productCoreTerms || [], brandTokens)
      : titleLeadingProductPhrases.length > 0 && !hasExpandedFallbackSignals
        ? []
        : filterFallbackSingleTerms(params.context.productCoreTerms || [], brandTokens)
  ).slice(0, 3)
  const attributeTerms = (params.context.attributeTerms || [])
    .map((item) => normalizeGoogleAdsKeyword(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, 6)
  const softFamilyTerms = filterFallbackPhrases(
    [...(params.context.softFamilyTerms || []), ...titleLeadingProductPhrases],
    brandTokens
  ).slice(0, 6)
  const fallbackLineTerms = Array.from(new Set([
    ...normalizedLineTerms,
    ...((normalizedLineTerms.length > 0 || hasHardModelCode) && titleLeadingProductPhrases.length === 0
      ? params.context.evidenceTexts
          .flatMap((text) => (normalizeGoogleAdsKeyword(text) || '').split(/\s+/))
          .map(normalizeToken)
          .filter(Boolean)
          .filter((token) => token.length >= 4)
          .filter((token) => !brandTokens.has(token))
          .filter((token) => !LINE_TERM_STOPWORDS.has(token))
          .filter((token) => !MODEL_FAMILY_CLAIM_NOISE_TOKENS.has(token))
          .filter((token) => !MODEL_CODE_TOKEN_PATTERN.test(token))
          .filter((token) => !containsAsinLikeToken(token))
          .filter((token) => !/^\d/.test(token))
          .filter((token) => !NUMERIC_MODEL_CODE_TOKEN_PATTERN.test(token))
      : []),
  ]))
    .filter((token) => !isModelFamilyNoiseToken(token))
    .slice(0, 3)
  const specs = params.context.specTerms
    .map((item) => normalizeGoogleAdsKeyword(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, 3)
  const fallbackSpecs = hasHardModelCode
    ? specs
    : specs.filter(isConsumerFacingProductSpec)
  const fallback = new Set<string>()

  if (brand && code && primaryLine) fallback.add(`${brand} ${primaryLine} ${code}`.trim())
  if (brand && code) fallback.add(`${brand} ${code}`.trim())
  for (const titlePhrase of titleLeadingProductPhrases) {
    if (brand) fallback.add(`${brand} ${titlePhrase}`.trim())
  }
  for (const family of softFamilyTerms) {
    if (brand) fallback.add(`${brand} ${family}`.trim())
    if (hasHardModelCode) fallback.add(family)
  }
  for (const linePhrase of titleLinePhrases) {
    if (brand) fallback.add(`${brand} ${linePhrase}`.trim())
    for (const productCore of productCoreTerms) {
      if (brand && linePhrase !== productCore) {
        fallback.add(`${brand} ${linePhrase} ${productCore}`.trim())
      }
    }
  }
  if (brand && combinedLinePhrase) fallback.add(`${brand} ${combinedLinePhrase}`.trim())
  for (const productCore of productCoreTerms) {
    if (brand && combinedLinePhrase && combinedLinePhrase !== productCore) {
      fallback.add(`${brand} ${combinedLinePhrase} ${productCore}`.trim())
    }
  }
  if (brand && primaryLine) fallback.add(`${brand} ${primaryLine}`.trim())
  if (hasHardModelCode && code && primaryLine) fallback.add(`${primaryLine} ${code}`.trim())
  if (hasHardModelCode && code) fallback.add(code)
  for (const attribute of attributeTerms) {
    for (const productCore of productCoreTerms) {
      if (brand) fallback.add(`${brand} ${attribute} ${productCore}`.trim())
      if (hasHardModelCode) fallback.add(`${attribute} ${productCore}`.trim())
    }
  }
  for (const line of fallbackLineTerms) {
    if (brand) fallback.add(`${brand} ${line}`.trim())
    for (const productCore of productCoreTerms) {
      if (brand && line !== productCore) {
        fallback.add(`${brand} ${line} ${productCore}`.trim())
      }
    }
    if (hasHardModelCode && code) fallback.add(`${line} ${code}`.trim())
  }
  for (const spec of fallbackSpecs) {
    if (brand && combinedLinePhrase) fallback.add(`${brand} ${combinedLinePhrase} ${spec}`.trim())
    for (const line of fallbackLineTerms) {
      if (brand) fallback.add(`${brand} ${line} ${spec}`.trim())
      if (hasHardModelCode) fallback.add(`${line} ${spec}`.trim())
    }
    for (const productCore of productCoreTerms) {
      if (brand) fallback.add(`${brand} ${spec} ${productCore}`.trim())
      if (hasHardModelCode) fallback.add(`${spec} ${productCore}`.trim())
    }
  }

  return Array.from(fallback)
    .map((item) => normalizeGoogleAdsKeyword(item))
    .filter((item): item is string => Boolean(item))
}

function normalizeKeywordKey(keyword: string): string {
  return normalizeGoogleAdsKeyword(keyword) || String(keyword || '').trim().toLowerCase()
}

export function supplementModelIntentKeywordsWithFallback<T extends { keyword: string }>(params: {
  items: T[]
  context: ProductModelFamilyContext
  brandName?: string | null
  minKeywords?: number
  buildFallbackItem: (keyword: string) => T
}): {
  items: T[]
  addedKeywords: string[]
} {
  const minKeywordsInput = Number(params.minKeywords)
  const minKeywords = Number.isFinite(minKeywordsInput)
    ? Math.max(1, Math.floor(minKeywordsInput))
    : MODEL_INTENT_MIN_KEYWORD_FLOOR

  if (!Array.isArray(params.items) || params.items.length >= minKeywords) {
    return {
      items: Array.isArray(params.items) ? [...params.items] : [],
      addedKeywords: [],
    }
  }

  const fallbackKeywords = buildProductModelFamilyFallbackKeywords({
    context: params.context,
    brandName: params.brandName,
  })
  if (fallbackKeywords.length === 0) {
    return {
      items: [...params.items],
      addedKeywords: [],
    }
  }

  const nextItems = [...params.items]
  const seen = new Set(nextItems.map((item) => normalizeKeywordKey(item.keyword)))
  const addedKeywords: string[] = []

  for (const keyword of fallbackKeywords) {
    const key = normalizeKeywordKey(keyword)
    if (!key || seen.has(key)) continue

    nextItems.push(params.buildFallbackItem(keyword))
    addedKeywords.push(keyword)
    seen.add(key)

    if (nextItems.length >= minKeywords) break
  }

  return {
    items: nextItems,
    addedKeywords,
  }
}
