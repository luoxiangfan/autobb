import { normalizeGoogleAdsKeyword } from './google-ads-keyword-normalizer'

const MODEL_ANCHOR_SUFFIX_PATTERN = String.raw`(?:[a-z]\d+[a-z0-9-]*|\d{1,4}[a-z0-9-]*|[a-z]|ii|iii|iv|v|vi|vii|viii|ix|x)`
const MODEL_ANCHOR_PATTERNS = [
  /\b[a-z]{1,5}[- ]?\d{2,4}[a-z0-9-]*\b/i,
  new RegExp(String.raw`\b(?:gen|generation|series|model|version|mk)\s*${MODEL_ANCHOR_SUFFIX_PATTERN}\b`, 'i'),
  new RegExp(String.raw`\b(?:type|ver)\s*${MODEL_ANCHOR_SUFFIX_PATTERN}\b`, 'i'),
]

const LEGACY_MODEL_CODE_TOKEN_PATTERN = /^[a-z]{1,6}\d{2,5}[a-z0-9]*$/i
const GENERAL_MODEL_IDENTIFIER_TOKEN_PATTERN = /^[a-z0-9]{6,20}$/i
const MEASUREMENT_LIKE_TOKEN_PATTERN = /^\d{1,4}(?:mm|cm|m|km|inch|in|ft|yd|oz|lb|lbs|kg|g|mah|wh|w|kw|v|hz|mp|gb|tb|ml|l|day|days|night|nights|year|years|month|months)$/i
const ASIN_LIKE_TOKEN_PATTERN = /^b0[a-z0-9]{8}$/i
const DIMENSION_AXIS_TOKENS = new Set(['d', 'w', 'h'])
const DIMENSION_UNIT_TOKENS = new Set([
  'inch',
  'in',
  'inches',
  'cm',
  'mm',
  'm',
  'km',
  'ft',
  'yd',
  'oz',
  'lb',
  'lbs',
  'kg',
  'g',
  'mah',
  'wh',
  'w',
  'kw',
  'v',
  'hz',
  'mp',
  'gb',
  'tb',
  'ml',
  'l',
  'height',
  'width',
  'depth',
  'length',
])
const NOISY_IDENTIFIER_TOKENS = new Set([
  'wifi6',
  'wifi7',
  'bluetooth5',
  'bluetooth52',
])

const SCRAPED_MODEL_IDENTIFIER_FIELDS = [
  'asin',
  'model',
  'series',
  'variant',
  'sku',
  'modelNumber',
  'model_number',
  'itemModelNumber',
  'item_model_number',
  'mpn',
  'partNumber',
  'part_number',
  'manufacturerPartNumber',
  'manufacturer_part_number',
] as const

const SCRAPED_URL_FIELDS = [
  'finalUrl',
  'productUrl',
  'url',
  'link',
  'href',
] as const

const IDENTIFIER_DETAIL_KEY_PATTERN = /(item\s*model|model|sku|asin|mpn|part\s*number|manufacturer\s*part|item\s*#|style\s*#)/i

const STORE_PRODUCT_LINK_NAME_FIELDS = [
  'name',
  'title',
  'productName',
  'product_name',
  'model',
  'series',
  'variant',
  'sku',
] as const

const STORE_PRODUCT_LINK_URL_FIELDS = [
  'url',
  'link',
  'href',
  'productUrl',
  'productLink',
] as const

function parseScrapedData(scrapedData: unknown): Record<string, unknown> | null {
  if (!scrapedData) return null

  let parsed: unknown = scrapedData
  if (typeof scrapedData === 'string') {
    const trimmed = scrapedData.trim()
    if (!trimmed) return null
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return null
    }
  }

  if (!parsed || typeof parsed !== 'object') return null
  return parsed as Record<string, unknown>
}

function pushText(values: string[], value: unknown): void {
  if (typeof value !== 'string') return
  const trimmed = value.trim()
  if (trimmed) values.push(trimmed)
}

function toAlphaNumericToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isAsinLikeToken(value: string): boolean {
  const normalized = toAlphaNumericToken(value)
  return ASIN_LIKE_TOKEN_PATTERN.test(normalized)
}

export function containsAsinLikeToken(text: unknown): boolean {
  if (typeof text !== 'string' && typeof text !== 'number') return false
  const normalized = normalizeGoogleAdsKeyword(String(text))
  if (!normalized) return false
  return normalized.split(/\s+/).filter(Boolean).some((token) => isAsinLikeToken(token))
}

function countMatches(value: string, pattern: RegExp): number {
  const matches = value.match(pattern)
  return matches ? matches.length : 0
}

function isGeneralModelIdentifierToken(token: string): boolean {
  const normalized = toAlphaNumericToken(token)
  if (!GENERAL_MODEL_IDENTIFIER_TOKEN_PATTERN.test(normalized)) return false
  if (NOISY_IDENTIFIER_TOKENS.has(normalized)) return false
  if (isAsinLikeToken(normalized)) return false
  if (MEASUREMENT_LIKE_TOKEN_PATTERN.test(normalized)) return false

  const letterCount = countMatches(normalized, /[a-z]/g)
  const digitCount = countMatches(normalized, /\d/g)
  if (letterCount < 2 || digitCount < 2) return false

  return true
}

function isDimensionFragmentLikeText(text: unknown): boolean {
  if (typeof text !== 'string' && typeof text !== 'number') return false
  const raw = String(text).toLowerCase().normalize('NFKC')
  const normalized = normalizeGoogleAdsKeyword(String(text))
  if (!normalized) return false

  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length < 2) return false

  let numericTokenCount = 0
  let measurementModifierCount = 0
  let nonMeasurementWordCount = 0
  const hasDecimalSeparator = /\d\s*\.\s*\d/.test(raw)

  for (const token of tokens) {
    const compact = toAlphaNumericToken(token)
    if (!compact) continue
    if (isAsinLikeToken(compact)) return false
    if (LEGACY_MODEL_CODE_TOKEN_PATTERN.test(compact) || isGeneralModelIdentifierToken(compact)) {
      return false
    }

    if (/^\d+$/.test(compact)) {
      numericTokenCount += 1
      continue
    }

    if (DIMENSION_AXIS_TOKENS.has(compact) || DIMENSION_UNIT_TOKENS.has(compact)) {
      measurementModifierCount += 1
      continue
    }

    nonMeasurementWordCount += 1
  }

  if (numericTokenCount === 0) return false
  if (measurementModifierCount === 0 && !hasDecimalSeparator) return false

  return nonMeasurementWordCount <= 1
}

export function extractModelIdentifierTokensFromText(text: unknown): string[] {
  if (typeof text !== 'string' && typeof text !== 'number') return []
  const normalized = normalizeGoogleAdsKeyword(String(text))
  if (!normalized) return []

  const tokens = normalized.split(/\s+/).filter(Boolean)
  const modelTokens = new Set<string>()
  for (const token of tokens) {
    if (isAsinLikeToken(token)) continue
    if (LEGACY_MODEL_CODE_TOKEN_PATTERN.test(token) || isGeneralModelIdentifierToken(token)) {
      modelTokens.add(token.toLowerCase())
    }
  }

  return Array.from(modelTokens)
}

export function hasModelAnchorInText(text: unknown): boolean {
  if (typeof text !== 'string' && typeof text !== 'number') return false
  if (isDimensionFragmentLikeText(text)) return false
  const normalized = normalizeGoogleAdsKeyword(String(text))
  if (!normalized) return false
  const sanitized = normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !isAsinLikeToken(token))
    .join(' ')
  if (!sanitized) return false
  if (MODEL_ANCHOR_PATTERNS.some((pattern) => pattern.test(sanitized))) return true
  return extractModelIdentifierTokensFromText(sanitized).length > 0
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function appendUrlTexts(values: string[], value: string): void {
  const trimmed = value.trim()
  if (!trimmed) return

  pushText(values, trimmed)

  const decoded = safeDecodeURIComponent(trimmed)
  if (decoded !== trimmed) pushText(values, decoded)

  try {
    const parsed = new URL(trimmed)
    const pathText = safeDecodeURIComponent(parsed.pathname)
      .replace(/[/_+\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    pushText(values, pathText)

    for (const paramValue of parsed.searchParams.values()) {
      const normalizedParam = safeDecodeURIComponent(paramValue)
        .replace(/[/_+\-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      pushText(values, normalizedParam)
    }
  } catch {
    const normalized = decoded
      .replace(/[/_+\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (normalized !== decoded) pushText(values, normalized)
  }
}

function normalizeStoreProductLinks(storeProductLinks: unknown): unknown[] {
  if (!storeProductLinks) return []

  if (Array.isArray(storeProductLinks)) return storeProductLinks

  if (typeof storeProductLinks === 'string') {
    const trimmed = storeProductLinks.trim()
    if (!trimmed) return []
    try {
      return normalizeStoreProductLinks(JSON.parse(trimmed))
    } catch {
      return [trimmed]
    }
  }

  if (typeof storeProductLinks === 'object') {
    const record = storeProductLinks as Record<string, unknown>
    if (Array.isArray(record.links)) return record.links
    if (Array.isArray(record.products)) return record.products
    return [record]
  }

  return []
}

function appendStoreProductLinkTexts(values: string[], storeProductLinks: unknown): void {
  const normalizedLinks = normalizeStoreProductLinks(storeProductLinks)
  for (const item of normalizedLinks) {
    if (typeof item === 'string') {
      appendUrlTexts(values, item)
      continue
    }

    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>

    for (const key of STORE_PRODUCT_LINK_NAME_FIELDS) {
      pushText(values, record[key])
    }

    for (const key of STORE_PRODUCT_LINK_URL_FIELDS) {
      const urlValue = record[key]
      if (typeof urlValue === 'string') appendUrlTexts(values, urlValue)
    }
  }
}

function appendIdentifierTextsFromRecord(values: string[], record: Record<string, unknown>): void {
  for (const key of SCRAPED_MODEL_IDENTIFIER_FIELDS) {
    pushText(values, record[key])
  }

  for (const key of SCRAPED_URL_FIELDS) {
    const urlValue = record[key]
    if (typeof urlValue === 'string') appendUrlTexts(values, urlValue)
  }

  const technicalDetails = record.technicalDetails
  if (technicalDetails && typeof technicalDetails === 'object' && !Array.isArray(technicalDetails)) {
    for (const [key, value] of Object.entries(technicalDetails as Record<string, unknown>).slice(0, 30)) {
      if (!IDENTIFIER_DETAIL_KEY_PATTERN.test(key)) continue
      if (typeof value === 'string' || typeof value === 'number') {
        pushText(values, `${key} ${value}`)
      }
    }
  }
}

function appendProductTexts(values: string[], items: unknown): void {
  if (!Array.isArray(items)) return
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const product = item as Record<string, unknown>
    pushText(values, product.name)
    pushText(values, product.title)
    pushText(values, product.productName)
    pushText(values, product.model)
    pushText(values, product.series)
    pushText(values, product.variant)
    pushText(values, product.sku)
    pushText(values, product.asin)
    pushText(values, product.mpn)
    pushText(values, product.partNumber)
    pushText(values, product.part_number)
    pushText(values, product.modelNumber)
    pushText(values, product.itemModelNumber)

    for (const key of STORE_PRODUCT_LINK_URL_FIELDS) {
      const urlValue = product[key]
      if (typeof urlValue === 'string') appendUrlTexts(values, urlValue)
    }

    if (product.productData && typeof product.productData === 'object') {
      appendIdentifierTextsFromRecord(values, product.productData as Record<string, unknown>)
    }
  }
}

export function extractModelAnchorTextsFromScrapedData(scrapedData: unknown): string[] {
  const parsed = parseScrapedData(scrapedData)
  if (!parsed) return []

  const values: string[] = []
  pushText(values, parsed.title)
  pushText(values, parsed.productTitle)
  pushText(values, parsed.product_name)
  pushText(values, parsed.name)
  pushText(values, parsed.model)
  pushText(values, parsed.series)
  pushText(values, parsed.variant)
  appendIdentifierTextsFromRecord(values, parsed)
  appendProductTexts(values, parsed.products)
  appendProductTexts(values, parsed.topProducts)

  const deepScrapeResults = parsed.deepScrapeResults as Record<string, unknown> | undefined
  appendIdentifierTextsFromRecord(values, deepScrapeResults || {})
  appendProductTexts(values, deepScrapeResults?.topProducts)

  return Array.from(new Set(values))
}

export function hasModelAnchorEvidenceFromOffer(offer: unknown): boolean {
  if (!offer || typeof offer !== 'object') return false
  const data = offer as Record<string, unknown>
  const texts: string[] = []

  pushText(texts, data.product_name)
  pushText(texts, data.extracted_keywords)
  pushText(texts, data.extracted_headlines)
  pushText(texts, data.extracted_descriptions)
  pushText(texts, data.offer_name)
  pushText(texts, data.category)
  pushText(texts, data.brand_description)
  pushText(texts, data.unique_selling_points)
  pushText(texts, data.product_highlights)
  pushText(texts, data.final_url)
  pushText(texts, data.url)

  if (typeof data.final_url === 'string') appendUrlTexts(texts, data.final_url)
  if (typeof data.url === 'string') appendUrlTexts(texts, data.url)

  const parsed = parseScrapedData(data.scraped_data)
  if (parsed) {
    appendIdentifierTextsFromRecord(texts, parsed)
    appendProductTexts(texts, parsed.products)
    appendProductTexts(texts, parsed.topProducts)
    const deepScrapeResults = parsed.deepScrapeResults as Record<string, unknown> | undefined
    appendIdentifierTextsFromRecord(texts, deepScrapeResults || {})
    appendProductTexts(texts, deepScrapeResults?.topProducts)
  }

  appendStoreProductLinkTexts(texts, data.store_product_links)

  return texts.some((text) => hasModelAnchorInText(text))
}
