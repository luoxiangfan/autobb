/**
 * 关键词池：verified source 与结构化扩展
 */
import { logger } from '@/lib/common/server'
import { parseJsonField } from '../../db'
import { type Offer } from '../../offers/server'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import {
  extractVerifiedKeywordSourcePool,
  getPureBrandKeywords,
  filterKeywordQuality,
} from '../server'
import { isInvalidKeyword } from '../planner/keyword-invalid-filter'
import { hasModelAnchorEvidence } from '../../creatives/server'
import { type PoolKeywordData } from './types'
import { getKeywordSourcePriority, prioritizeBucketKeywords } from './keyword-clustering'
import { inferDefaultKeywordMatchType } from './offer-pool-brand-utils'
import { buildGlobalCoreQualityFilterContext } from './offer-pool-global-core'
import { normalizeKeywordTermsByTargetLanguage } from './offer-pool-storage-translation'

const STRUCTURED_MODEL_TOKEN_RE = /\b[A-Z]{1,4}[- ]?\d{2,6}[A-Z0-9-]{0,8}\b/g
const STRUCTURED_SPEC_TOKEN_RE =
  /\b\d{2,5}\s?(?:gpd|btu|mah|wh|w|kw|v|psi|db|hz|khz|mhz|ghz|mm|cm|inch|in|ft|l|ml|kg|lb|lbs)\b/gi
const STRUCTURED_CERT_TOKEN_RE =
  /\b(?:nsf\s*\/?\s*ansi\s*\d{1,3}|nsf\s*\d{1,3}|ansi\s*\d{1,3}|etl|ul|fcc|ce|rohs)\b/gi
const STRUCTURED_PRODUCT_CORE_STOPWORDS = new Set([
  'for',
  'with',
  'without',
  'and',
  'the',
  'new',
  'best',
  'official',
  'store',
  'system',
  'model',
  'series',
  'version',
  'kit',
  'set',
  'pack',
])

function collectStructuredExpansionSourceTexts(offer: Offer): string[] {
  const scrapedData = parseJsonField<Record<string, unknown>>(offer.scraped_data, {})
  const extractedHeadlines = parseJsonField<unknown[]>((offer as any).extracted_headlines, [])
  const extractedDescriptions = parseJsonField<unknown[]>((offer as any).extracted_descriptions, [])

  const values: string[] = []
  const push = (value: unknown) => {
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (!trimmed) return
    values.push(trimmed)
  }
  const pushList = (value: unknown, limit: number = 8) => {
    if (!Array.isArray(value)) return
    value.slice(0, limit).forEach((item) => push(item))
  }

  push(offer.product_name)
  push((offer as any).product_title)
  push(offer.category)
  push(offer.product_highlights)
  push(offer.unique_selling_points)
  push((scrapedData as any)?.rawProductTitle)
  push((scrapedData as any)?.productName)
  push((scrapedData as any)?.title)
  pushList((scrapedData as any)?.aboutThisItem, 6)
  pushList((scrapedData as any)?.features, 6)
  pushList((scrapedData as any)?.highlights, 6)
  pushList((scrapedData as any)?.productHighlights, 6)
  pushList(extractedHeadlines, 8)
  pushList(extractedDescriptions, 4)

  return Array.from(new Set(values))
}

function extractStructuredEntitiesFromTexts(texts: string[]): {
  modelTokens: string[]
  specTokens: string[]
  certTokens: string[]
} {
  const modelTokens = new Set<string>()
  const specTokens = new Set<string>()
  const certTokens = new Set<string>()

  for (const text of texts) {
    const rawText = String(text || '')
    if (!rawText) continue

    const modelMatches = rawText.match(STRUCTURED_MODEL_TOKEN_RE) || []
    for (const match of modelMatches) {
      const normalized = match.replace(/[\s-]+/g, '').toLowerCase()
      if (!normalized) continue
      if (!/[a-z]/i.test(normalized) || !/\d/.test(normalized)) continue
      modelTokens.add(normalized)
    }

    const specMatches = rawText.match(STRUCTURED_SPEC_TOKEN_RE) || []
    for (const match of specMatches) {
      const unitMatch = match.match(/(\d{2,5})\s*([a-z]+)/i)
      if (!unitMatch) continue
      const normalized = `${unitMatch[1]} ${unitMatch[2].toLowerCase()}`
      specTokens.add(normalized)
    }

    const certMatches = rawText.match(STRUCTURED_CERT_TOKEN_RE) || []
    for (const match of certMatches) {
      const normalized = match.toLowerCase().replace(/[\/]+/g, ' ').replace(/\s+/g, ' ').trim()
      if (!normalized) continue
      certTokens.add(normalized)
    }
  }

  return {
    modelTokens: Array.from(modelTokens),
    specTokens: Array.from(specTokens),
    certTokens: Array.from(certTokens),
  }
}

function buildStructuredProductCorePhrase(offer: Offer): string {
  const pureBrandTokens = new Set(
    getPureBrandKeywords(offer.brand || '')
      .flatMap((item) => normalizeGoogleAdsKeyword(item)?.split(/\s+/) || [])
      .filter(Boolean)
  )
  const tokens = (
    normalizeGoogleAdsKeyword(
      [
        String(offer.product_name || ''),
        String((offer as any).product_title || ''),
        String(offer.category || ''),
      ].join(' ')
    ) || ''
  )
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.length >= 3)
    .filter((item) => !pureBrandTokens.has(item))
    .filter((item) => !STRUCTURED_PRODUCT_CORE_STOPWORDS.has(item))
    .filter((item) => !/^\d+$/.test(item))

  if (tokens.length === 0) return ''
  return Array.from(new Set(tokens)).slice(0, 3).join(' ')
}

function buildStructuredModelSpecExpansionKeywords(params: {
  offer: Offer
  pureBrandKeywords: string[]
}): string[] {
  const brand = normalizeGoogleAdsKeyword(params.offer.brand || '')
  if (!brand) return []

  const sourceTexts = collectStructuredExpansionSourceTexts(params.offer)
  const entities = extractStructuredEntitiesFromTexts(sourceTexts)
  if (
    entities.modelTokens.length === 0 &&
    entities.specTokens.length === 0 &&
    entities.certTokens.length === 0
  ) {
    return []
  }

  const productCorePhrase = buildStructuredProductCorePhrase(params.offer)
  const out: string[] = []
  const seen = new Set<string>()
  const push = (...segments: string[]) => {
    const normalized = normalizeGoogleAdsKeyword(segments.filter(Boolean).join(' '))
    if (!normalized) return
    const tokenCount = normalized.split(/\s+/).filter(Boolean).length
    if (tokenCount < 2 || tokenCount > 8) return
    if (seen.has(normalized)) return
    seen.add(normalized)
    out.push(normalized)
  }

  for (const model of entities.modelTokens.slice(0, 10)) {
    push(brand, model)
    if (productCorePhrase) push(brand, productCorePhrase, model)
  }

  for (const spec of entities.specTokens.slice(0, 10)) {
    push(brand, spec)
    if (productCorePhrase) push(brand, productCorePhrase, spec)
    for (const model of entities.modelTokens.slice(0, 4)) {
      push(brand, model, spec)
    }
  }

  for (const cert of entities.certTokens.slice(0, 6)) {
    push(brand, cert)
    if (productCorePhrase) push(brand, productCorePhrase, cert)
    for (const model of entities.modelTokens.slice(0, 3)) {
      push(brand, model, cert)
    }
  }

  return out.slice(0, 24)
}

type VerifiedSourceKeywordMap = {
  TITLE_EXTRACT: PoolKeywordData[]
  ABOUT_EXTRACT: PoolKeywordData[]
  PARAM_EXTRACT: PoolKeywordData[]
  HOT_PRODUCT_AGGREGATE: PoolKeywordData[]
  PAGE_EXTRACT: PoolKeywordData[]
}

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

const STORE_PRODUCT_LINK_URL_FIELDS = ['url', 'link', 'href', 'productUrl', 'productLink'] as const

const STORE_PRODUCT_LINK_QUERY_NAME_KEYS = new Set([
  'name',
  'title',
  'product',
  'product_name',
  'productname',
  'model',
  'series',
  'variant',
  'sku',
])

const STORE_PRODUCT_LINK_NOISE_SEGMENTS = new Set([
  'index',
  'openurl',
  'openurlproduct',
  'redirect',
  'go',
  'click',
  'track',
  'tracking',
  'router',
  'landing',
  'jump',
  'visit',
])

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function normalizeStoreProductNameCandidate(value: string): string {
  return value
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[_+\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeStoreProductLinksInput(storeProductLinks: unknown): unknown[] {
  if (!storeProductLinks) return []

  if (Array.isArray(storeProductLinks)) return storeProductLinks

  if (typeof storeProductLinks === 'string') {
    const trimmed = storeProductLinks.trim()
    if (!trimmed) return []
    try {
      return normalizeStoreProductLinksInput(JSON.parse(trimmed))
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

function extractStoreProductNameCandidatesFromUrl(urlLike: string): string[] {
  const trimmed = urlLike.trim()
  if (!trimmed) return []

  const candidates: string[] = []
  const pushCandidate = (value: string) => {
    const normalized = normalizeStoreProductNameCandidate(value)
    if (!normalized) return
    if (candidates.includes(normalized)) return
    candidates.push(normalized)
  }

  try {
    const parsed = new URL(trimmed)
    const pathSegments = parsed.pathname
      .split('/')
      .map((segment) => normalizeStoreProductNameCandidate(safeDecodeUriComponent(segment)))
      .filter(Boolean)

    for (let i = pathSegments.length - 1; i >= 0; i -= 1) {
      const segment = pathSegments[i]
      if (/^(p|dp|gp|product|products|item|items|store|shop)$/i.test(segment)) continue
      if (STORE_PRODUCT_LINK_NOISE_SEGMENTS.has(segment.toLowerCase())) continue
      if (/^openurl[a-z0-9_]*$/i.test(segment)) continue
      pushCandidate(segment)
      break
    }

    for (const [key, value] of parsed.searchParams.entries()) {
      if (!STORE_PRODUCT_LINK_QUERY_NAME_KEYS.has(key.toLowerCase())) continue
      const decodedValue = safeDecodeUriComponent(value)
      if (STORE_PRODUCT_LINK_NOISE_SEGMENTS.has(decodedValue.toLowerCase())) continue
      if (/^openurl[a-z0-9_]*$/i.test(decodedValue)) continue
      pushCandidate(decodedValue)
    }
  } catch {
    if (!/^https?:\/\//i.test(trimmed)) {
      pushCandidate(safeDecodeUriComponent(trimmed))
    }
  }

  return candidates
}

export function extractStoreProductNamesFromLinks(storeProductLinks: unknown): string[] {
  const candidates: string[] = []
  const pushCandidate = (value: unknown) => {
    if (typeof value !== 'string') return
    const normalized = normalizeStoreProductNameCandidate(value)
    if (!normalized) return
    if (candidates.includes(normalized)) return
    candidates.push(normalized)
  }

  const items = normalizeStoreProductLinksInput(storeProductLinks)
  for (const item of items) {
    if (typeof item === 'string') {
      const trimmedItem = item.trim()
      if (!trimmedItem) continue
      const urlCandidates = extractStoreProductNameCandidatesFromUrl(trimmedItem)
      if (urlCandidates.length > 0) {
        for (const candidate of urlCandidates) pushCandidate(candidate)
      } else if (!/^https?:\/\//i.test(trimmedItem)) {
        pushCandidate(trimmedItem)
      }
      continue
    }

    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>

    for (const key of STORE_PRODUCT_LINK_NAME_FIELDS) {
      pushCandidate(record[key])
    }

    for (const key of STORE_PRODUCT_LINK_URL_FIELDS) {
      const urlValue = record[key]
      if (typeof urlValue !== 'string') continue
      for (const candidate of extractStoreProductNameCandidatesFromUrl(urlValue)) {
        pushCandidate(candidate)
      }
    }
  }

  return candidates
}

function emptyVerifiedSourceKeywordMap(): VerifiedSourceKeywordMap {
  return {
    TITLE_EXTRACT: [],
    ABOUT_EXTRACT: [],
    PARAM_EXTRACT: [],
    HOT_PRODUCT_AGGREGATE: [],
    PAGE_EXTRACT: [],
  }
}

type VerifiedSourceNormalizationKey = keyof VerifiedSourceKeywordMap | 'STRUCTURED_EXPANSION'

type NormalizedKeywordTermsResult = Awaited<
  ReturnType<typeof normalizeKeywordTermsByTargetLanguage>
>

function createEmptyNormalizedKeywordTermsResult(): NormalizedKeywordTermsResult {
  return {
    keywords: [],
    removed: 0,
    translated: 0,
  }
}

function createEmptyVerifiedSourceNormalizationMap(): Record<
  VerifiedSourceNormalizationKey,
  NormalizedKeywordTermsResult
> {
  return {
    TITLE_EXTRACT: createEmptyNormalizedKeywordTermsResult(),
    ABOUT_EXTRACT: createEmptyNormalizedKeywordTermsResult(),
    PARAM_EXTRACT: createEmptyNormalizedKeywordTermsResult(),
    HOT_PRODUCT_AGGREGATE: createEmptyNormalizedKeywordTermsResult(),
    PAGE_EXTRACT: createEmptyNormalizedKeywordTermsResult(),
    STRUCTURED_EXPANSION: createEmptyNormalizedKeywordTermsResult(),
  }
}

async function normalizeVerifiedSourceKeywordEntriesByTargetLanguage(params: {
  userId?: number
  targetLanguage?: string
  pureBrandKeywords: string[]
  entries: Array<{
    key: VerifiedSourceNormalizationKey
    keywords: string[]
  }>
}): Promise<Record<VerifiedSourceNormalizationKey, NormalizedKeywordTermsResult>> {
  const normalizedByKey = createEmptyVerifiedSourceNormalizationMap()
  for (const entry of params.entries) {
    normalizedByKey[entry.key] = await normalizeKeywordTermsByTargetLanguage({
      userId: params.userId,
      keywords: entry.keywords,
      targetLanguage: params.targetLanguage,
      pureBrandKeywords: params.pureBrandKeywords,
    })
  }
  return normalizedByKey
}

function sumVerifiedSourceNormalizationMetric(
  normalizedByKey: Record<VerifiedSourceNormalizationKey, NormalizedKeywordTermsResult>,
  field: 'removed' | 'translated'
): number {
  return Object.values(normalizedByKey).reduce((sum, item) => sum + Number(item[field] || 0), 0)
}

export async function buildVerifiedSourceKeywordData(
  offer: Offer,
  userId?: number
): Promise<VerifiedSourceKeywordMap> {
  const brand = String(offer.brand || '').trim()
  if (!brand) return emptyVerifiedSourceKeywordMap()
  const storeProductNames = extractStoreProductNamesFromLinks(offer.store_product_links)

  const productFeatures = [offer.product_highlights, offer.unique_selling_points]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('; ')

  const sourcePool = extractVerifiedKeywordSourcePool({
    brand,
    category: offer.category,
    productTitle: offer.product_name || undefined,
    productFeatures: productFeatures || undefined,
    scrapedData: offer.scraped_data || undefined,
    reviewAnalysis: offer.review_analysis || undefined,
    brandAnalysis: (offer as any).brand_analysis || undefined,
    storeProductNames,
  })

  const pureBrandKeywords = getPureBrandKeywords(brand)
  const targetLanguage = String(offer.target_language || '').trim() || undefined

  const structuredExpansionKeywordsRaw = buildStructuredModelSpecExpansionKeywords({
    offer,
    pureBrandKeywords,
  })
  const normalizedByKey = await normalizeVerifiedSourceKeywordEntriesByTargetLanguage({
    userId,
    targetLanguage,
    pureBrandKeywords,
    entries: [
      { key: 'TITLE_EXTRACT', keywords: sourcePool.titleKeywords },
      { key: 'ABOUT_EXTRACT', keywords: sourcePool.aboutKeywords },
      { key: 'PARAM_EXTRACT', keywords: sourcePool.paramKeywords },
      { key: 'HOT_PRODUCT_AGGREGATE', keywords: sourcePool.hotProductKeywords },
      { key: 'PAGE_EXTRACT', keywords: sourcePool.pageKeywords },
      { key: 'STRUCTURED_EXPANSION', keywords: structuredExpansionKeywordsRaw },
    ],
  })
  const languageRemovedCount = sumVerifiedSourceNormalizationMetric(normalizedByKey, 'removed')
  if (languageRemovedCount > 0) {
    logger.debug(
      `[VerifiedSource] 目标语净化移除 ${languageRemovedCount} 个候选词 (offer=${offer.id}, target=${targetLanguage || 'n/a'})`
    )
  }
  const translatedCount = sumVerifiedSourceNormalizationMetric(normalizedByKey, 'translated')
  if (translatedCount > 0) {
    logger.debug(
      `[VerifiedSource] 目标语净化翻译 ${translatedCount} 个候选词 (offer=${offer.id}, target=${targetLanguage || 'n/a'})`
    )
  }
  if (normalizedByKey.STRUCTURED_EXPANSION.keywords.length > 0) {
    logger.debug(
      `[VerifiedSource] 商品化扩词注入 ${normalizedByKey.STRUCTURED_EXPANSION.keywords.length} 个型号/规格/认证候选 (offer=${offer.id})`
    )
  }

  const createKeywordData = (
    keywords: string[],
    source: keyof VerifiedSourceKeywordMap
  ): PoolKeywordData[] => {
    const map = new Map<string, PoolKeywordData>()
    for (const keyword of keywords) {
      const normalized = normalizeGoogleAdsKeyword(keyword)
      if (!normalized || isInvalidKeyword(normalized)) continue
      if (map.has(normalized)) continue
      map.set(normalized, {
        keyword,
        searchVolume: 0,
        source,
        matchType: hasModelAnchorEvidence({ keywords: [keyword] })
          ? 'EXACT'
          : inferDefaultKeywordMatchType(keyword, pureBrandKeywords),
        relevanceScore:
          source === 'HOT_PRODUCT_AGGREGATE'
            ? 0.98
            : source === 'PARAM_EXTRACT'
              ? 0.96
              : source === 'TITLE_EXTRACT'
                ? 0.94
                : source === 'ABOUT_EXTRACT'
                  ? 0.92
                  : 0.9,
        qualityTier: 'HIGH',
      })
    }
    return Array.from(map.values())
  }

  const candidateMap: VerifiedSourceKeywordMap = {
    TITLE_EXTRACT: createKeywordData(normalizedByKey.TITLE_EXTRACT.keywords, 'TITLE_EXTRACT'),
    ABOUT_EXTRACT: createKeywordData(normalizedByKey.ABOUT_EXTRACT.keywords, 'ABOUT_EXTRACT'),
    PARAM_EXTRACT: createKeywordData(
      [...normalizedByKey.PARAM_EXTRACT.keywords, ...normalizedByKey.STRUCTURED_EXPANSION.keywords],
      'PARAM_EXTRACT'
    ),
    HOT_PRODUCT_AGGREGATE: createKeywordData(
      normalizedByKey.HOT_PRODUCT_AGGREGATE.keywords,
      'HOT_PRODUCT_AGGREGATE'
    ),
    PAGE_EXTRACT: createKeywordData(normalizedByKey.PAGE_EXTRACT.keywords, 'PAGE_EXTRACT'),
  }

  const allCandidates = Object.values(candidateMap).flat()
  if (allCandidates.length === 0) return candidateMap

  const { categoryContext, minContextTokenMatches } = buildGlobalCoreQualityFilterContext(offer)
  const filtered = filterKeywordQuality(allCandidates, {
    brandName: offer.brand,
    category: categoryContext,
    productName: offer.product_name || undefined,
    targetCountry: offer.target_country || undefined,
    targetLanguage: offer.target_language || undefined,
    productUrl: offer.final_url || offer.url || undefined,
    minWordCount: 1,
    maxWordCount: 8,
    mustContainBrand: pureBrandKeywords.length > 0,
    minContextTokenMatches: Math.max(1, minContextTokenMatches),
    contextMismatchMode: 'soft',
  })

  const result = emptyVerifiedSourceKeywordMap()
  for (const item of filtered.filtered) {
    const source = String(item.source || '').toUpperCase() as keyof VerifiedSourceKeywordMap
    if (!Object.prototype.hasOwnProperty.call(result, source)) continue
    result[source].push(item)
  }

  return {
    TITLE_EXTRACT: prioritizeBucketKeywords(result.TITLE_EXTRACT),
    ABOUT_EXTRACT: prioritizeBucketKeywords(result.ABOUT_EXTRACT),
    PARAM_EXTRACT: prioritizeBucketKeywords(result.PARAM_EXTRACT),
    HOT_PRODUCT_AGGREGATE: prioritizeBucketKeywords(result.HOT_PRODUCT_AGGREGATE),
    PAGE_EXTRACT: prioritizeBucketKeywords(result.PAGE_EXTRACT),
  }
}

export function appendVerifiedKeywordsToBucket(params: {
  current: PoolKeywordData[]
  additions: PoolKeywordData[]
  usedNorms: Set<string>
}): PoolKeywordData[] {
  const map = new Map<string, PoolKeywordData>()

  for (const item of params.current) {
    const normalized = normalizeGoogleAdsKeyword(item.keyword)
    if (!normalized) continue
    map.set(normalized, item)
    params.usedNorms.add(normalized)
  }

  for (const item of params.additions) {
    const normalized = normalizeGoogleAdsKeyword(item.keyword)
    if (!normalized) continue

    const existing = map.get(normalized)
    if (existing) {
      const existingPriority = getKeywordSourcePriority(existing.source)
      const nextPriority = getKeywordSourcePriority(item.source)
      if ((existing.searchVolume || 0) <= 0 && nextPriority < existingPriority) {
        map.set(normalized, {
          ...existing,
          source: item.source,
          matchType: item.matchType || existing.matchType,
          relevanceScore: Math.max(existing.relevanceScore || 0, item.relevanceScore || 0),
          qualityTier: existing.qualityTier || item.qualityTier,
        })
      }
      continue
    }

    if (params.usedNorms.has(normalized)) continue
    map.set(normalized, item)
    params.usedNorms.add(normalized)
  }

  return prioritizeBucketKeywords(Array.from(map.values()))
}
