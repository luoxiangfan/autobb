/**
 * Seed pool construction for unified keyword service.
 */
import { logger } from '@/lib/common/server'
import {
  containsPureBrand,
  getPureBrandKeywords,
  isPureBrandKeyword,
} from '../brand/brand-keyword-utils'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { normalizeLanguageCode } from '../../common/server'
import { hasModelAnchorEvidence } from '../../creatives/server'
import { containsAsinLikeToken, extractModelIdentifierTokensFromText } from '../../creatives/server'
import type {
  IntentAwareSeedPool,
  OfferData,
  UnifiedKeywordData,
  VerifiedKeywordSourcePool,
} from './unified-keyword-types'

function generateBrandVariants(brand: string): string[] {
  if (!brand || brand.length < 2) return []

  const variants = new Set<string>()
  const brandLower = brand.toLowerCase()
  const normalizedBrand = normalizeGoogleAdsKeyword(brand)
  const pureBrandKeywords = getPureBrandKeywords(brand)

  // 基础变体
  variants.add(brandLower)
  variants.add(brand) // 原始形式
  if (normalizedBrand) {
    variants.add(normalizedBrand)
  }
  pureBrandKeywords.forEach((keyword) => variants.add(keyword))

  // 带空格/不带空格变体
  if (brand.includes(' ')) {
    // "Reo Link" → "reolink"
    variants.add(brand.replace(/\s+/g, '').toLowerCase())
  } else if (brand.length > 5) {
    // CamelCase 分词: "ReoLink" → "reo link"
    const camelSplit = brand.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
    if (camelSplit !== brandLower) {
      variants.add(camelSplit)
    }

    // 尝试在中间插入空格（适用于组合词）
    // "reolink" → "reo link" (尝试常见分割点)
    const midPoint = Math.floor(brand.length / 2)
    for (let i = midPoint - 1; i <= midPoint + 1; i++) {
      if (i > 2 && i < brand.length - 2) {
        const withSpace = brandLower.slice(0, i) + ' ' + brandLower.slice(i)
        variants.add(withSpace)
      }
    }
  }

  // 常见拼写错误：删除双字母
  // "reolink" 本身没有双字母，但 "google" → "gogle"
  const withoutDoubles = brandLower.replace(/(.)\1/g, '$1')
  if (withoutDoubles !== brandLower && withoutDoubles.length >= 3) {
    variants.add(withoutDoubles)
  }

  // 常见拼写错误：末尾多加/少加字母
  // 不生成太多变体，保持简洁

  const result = Array.from(variants).filter((v) => v.length >= 2)

  logger.debug(`   🔤 品牌变体: ${result.join(', ')}`)

  return result
}

const KEYWORD_SOURCE_STOPWORDS = new Set([
  'with',
  'for',
  'and',
  'the',
  'a',
  'an',
  'in',
  'on',
  'of',
  'to',
  'by',
  'from',
  'new',
  'edition',
  'pack',
  'set',
  'kit',
  'bundle',
  'feature',
  'features',
  'about',
  'item',
  'items',
  'model',
  'series',
  'version',
  'style',
  'color',
  'size',
  'option',
  'options',
  'type',
  'asin',
  'sku',
  'mpn',
  'upc',
  'ean',
])

const MODEL_IDENTIFIER_FIELDS = [
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

const MODEL_IDENTIFIER_DETAIL_KEY_PATTERN =
  /(item\s*model|model|sku|asin|mpn|part\s*number|manufacturer\s*part|item\s*#|style\s*#)/i

function safeParseStructuredData(value: unknown): any | null {
  if (!value) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    try {
      return JSON.parse(trimmed)
    } catch {
      return null
    }
  }
  if (typeof value === 'object') {
    return value
  }
  return null
}

function normalizeSourceText(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return String(value).replace(/\s+/g, ' ').trim()
}

function pushUniqueText(target: string[], value: unknown, limit: number): void {
  const normalized = normalizeSourceText(value)
  if (!normalized) return
  const exists = target.some((item) => item.toLowerCase() === normalized.toLowerCase())
  if (exists || target.length >= limit) return
  target.push(normalized)
}

function collectPrioritizedTextGroups(groups: unknown[], limit: number): string[] {
  const output: string[] = []

  for (const group of groups) {
    if (output.length >= limit) break

    const items = Array.isArray(group) ? group : [group]
    for (const item of items) {
      pushUniqueText(output, item, limit)
      if (output.length >= limit) break
    }
  }

  return output
}

function isLikelyUrlText(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

function collectSimpleTextList(value: unknown, limit = 12): string[] {
  const output: string[] = []

  if (typeof value === 'string' || typeof value === 'number') {
    pushUniqueText(output, value, limit)
    return output
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string' || typeof item === 'number') {
        pushUniqueText(output, item, limit)
      } else if (item && typeof item === 'object') {
        for (const key of [
          'text',
          'name',
          'title',
          'label',
          'value',
          'keyword',
          'scenario',
          'theme',
          'summary',
        ]) {
          pushUniqueText(output, (item as any)?.[key], limit)
          if (output.length >= limit) break
        }
      }
      if (output.length >= limit) break
    }
  }

  return output
}

function collectRecordTextList(value: unknown, limit = 10): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []

  const output: string[] = []
  for (const [, raw] of Object.entries(value).slice(0, limit)) {
    if (typeof raw === 'string' || typeof raw === 'number') {
      pushUniqueText(output, raw, limit)
      continue
    }

    if (Array.isArray(raw)) {
      const joined = collectSimpleTextList(raw, 3).join(' ')
      if (joined) {
        pushUniqueText(output, joined, limit)
      }
    }
  }

  return output
}

function collectVariantTextList(value: unknown, limit = 10): string[] {
  if (!Array.isArray(value)) return []

  const output: string[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const fields = [
      (item as any).name,
      (item as any).title,
      (item as any).label,
      (item as any).model,
      (item as any).sku,
      (item as any).value,
      (item as any).option,
      (item as any).variant,
    ]
    for (const field of fields) {
      pushUniqueText(output, field, limit)
      if (output.length >= limit) break
    }
    if (output.length >= limit) break
  }
  return output
}

function collectModelIdentifierTextList(scrapedData: any, limit = 10): string[] {
  if (!scrapedData || typeof scrapedData !== 'object') return []

  const output: string[] = []
  for (const key of MODEL_IDENTIFIER_FIELDS) {
    pushUniqueText(output, scrapedData?.[key], limit)
    if (output.length >= limit) return output
  }

  const technicalDetails = scrapedData?.technicalDetails
  if (
    technicalDetails &&
    typeof technicalDetails === 'object' &&
    !Array.isArray(technicalDetails)
  ) {
    for (const [key, rawValue] of Object.entries(technicalDetails as Record<string, unknown>).slice(
      0,
      20
    )) {
      if (!MODEL_IDENTIFIER_DETAIL_KEY_PATTERN.test(key)) continue
      if (typeof rawValue === 'string' || typeof rawValue === 'number') {
        pushUniqueText(output, `${key} ${rawValue}`, limit)
      }
      if (output.length >= limit) break
    }
  }

  return output
}

function getProductNameCandidate(product: any): string {
  const candidates = [
    product?.productData?.productName,
    product?.productData?.name,
    product?.productName,
    product?.name,
    product?.title,
  ]

  for (const candidate of candidates) {
    const normalized = normalizeSourceText(candidate)
    if (normalized.length >= 3) return normalized
  }

  return ''
}

function collectProductNameList(value: unknown, limit = 10): string[] {
  if (!Array.isArray(value)) return []

  const output: string[] = []
  for (const item of value) {
    const productName = getProductNameCandidate(item)
    if (!productName) continue
    pushUniqueText(output, productName, limit)
    if (output.length >= limit) break
  }

  return output
}

function collectProductFeatureTextList(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return []

  const output: string[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    for (const source of [
      (item as any)?.productData?.aboutThisItem,
      (item as any)?.productData?.features,
      (item as any)?.aboutThisItem,
      (item as any)?.features,
    ]) {
      for (const text of collectSimpleTextList(source, 5)) {
        pushUniqueText(output, text, limit)
      }
    }
    if (output.length >= limit) break
  }

  return output
}

function collectProductParamTextList(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return []

  const output: string[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    for (const text of [
      ...collectRecordTextList((item as any)?.productData?.specifications, 4),
      ...collectRecordTextList((item as any)?.specifications, 4),
      ...collectRecordTextList((item as any)?.productData?.attributes, 4),
      ...collectRecordTextList((item as any)?.attributes, 4),
      ...collectVariantTextList((item as any)?.productData?.variants, 4),
      ...collectVariantTextList((item as any)?.variants, 4),
      normalizeSourceText((item as any)?.productData?.model),
      normalizeSourceText((item as any)?.model),
      normalizeSourceText((item as any)?.productData?.sku),
      normalizeSourceText((item as any)?.sku),
      normalizeSourceText((item as any)?.productData?.asin),
      normalizeSourceText((item as any)?.asin),
      normalizeSourceText((item as any)?.productData?.modelNumber),
      normalizeSourceText((item as any)?.modelNumber),
      normalizeSourceText((item as any)?.productData?.itemModelNumber),
      normalizeSourceText((item as any)?.itemModelNumber),
      normalizeSourceText((item as any)?.productData?.mpn),
      normalizeSourceText((item as any)?.mpn),
    ]) {
      pushUniqueText(output, text, limit)
    }
    if (output.length >= limit) break
  }

  return output
}

function collectReviewAnalysisTexts(reviewAnalysis: any): string[] {
  if (!reviewAnalysis || typeof reviewAnalysis !== 'object') return []

  const output: string[] = []
  const append = (value: unknown, limit = 12) => {
    for (const item of collectSimpleTextList(value, limit)) {
      pushUniqueText(output, item, 16)
    }
  }

  append(reviewAnalysis.customerUseCases)
  append(reviewAnalysis.useCases)
  append(reviewAnalysis.positives)
  append(reviewAnalysis.painPoints)
  append(reviewAnalysis.concerns)
  append(reviewAnalysis.trustIndicators)
  append(reviewAnalysis.keyThemes)
  append(reviewAnalysis.summary, 4)

  if (Array.isArray(reviewAnalysis.scenarios)) {
    for (const item of reviewAnalysis.scenarios) {
      if (!item || typeof item !== 'object') continue
      pushUniqueText(output, (item as any).scenario, 16)
      pushUniqueText(output, (item as any).name, 16)
      if (output.length >= 16) break
    }
  }

  return output
}

function collectBrandAnalysisTexts(brandAnalysis: any): string[] {
  if (!brandAnalysis || typeof brandAnalysis !== 'object') return []

  const output: string[] = []
  const append = (value: unknown, limit = 12) => {
    for (const item of collectSimpleTextList(value, limit)) {
      pushUniqueText(output, item, 16)
    }
  }

  append(brandAnalysis.sellingPoints)
  append(brandAnalysis.hotProductHighlights)
  append(brandAnalysis.positioning, 4)
  append(brandAnalysis.voice, 4)
  append(brandAnalysis.customerUseCases)
  append(brandAnalysis.trustIndicators)

  return output
}

function stripSourceTextLabel(text: string): string {
  return text
    .replace(
      /^(?:item\s+)?(?:model(?:\s+name|\s+number)?|series|version|style(?:\s+name)?|color|colour|brand(?:\s+name)?|name|number|sku|mpn|part\s+number|item\s+type\s+name|option|feature|features|use case|scenario|summary|theme)\s*[:\-]?\s*/i,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim()
}

function isOpaqueStandaloneIdentifierToken(token: string): boolean {
  const normalized = String(token || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  if (!normalized) return false

  const extracted = extractModelIdentifierTokensFromText(normalized)
  if (!extracted.includes(normalized)) return false

  const digitCount = (normalized.match(/\d/g) || []).length
  const letterCount = (normalized.match(/[a-z]/g) || []).length
  if (digitCount < 3 || letterCount < 1) return false

  return normalized.length >= 6 || digitCount >= 4
}

function isOpaqueStandaloneIdentifierPhrase(text: string, brandName: string): boolean {
  const normalized = normalizeGoogleAdsKeyword(text)
  if (!normalized) return false

  const brandTokens = new Set(
    normalizeGoogleAdsKeyword(brandName)?.split(/\s+/).filter(Boolean) || []
  )
  const tokens = normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !brandTokens.has(token))

  return tokens.length === 1 && isOpaqueStandaloneIdentifierToken(tokens[0])
}

function buildBrandedPhraseSeed(text: string, brandName: string, maxTokens = 4): string | null {
  const normalized = normalizeGoogleAdsKeyword(stripSourceTextLabel(text))
  if (!normalized) return null

  const brandTokenSet = new Set(
    normalizeGoogleAdsKeyword(brandName)?.split(/\s+/).filter(Boolean) || []
  )
  const tokens = normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token.length >= 3 || /\d/.test(token))
    .filter((token) => !brandTokenSet.has(token))
    .filter((token) => !KEYWORD_SOURCE_STOPWORDS.has(token))
    .filter((token) => !/^\d+$/.test(token))

  if (tokens.length === 0) return null
  if (!tokens.some((token) => /[a-z]/i.test(token))) return null

  const seed = `${brandName} ${tokens.slice(0, maxTokens).join(' ')}`.trim()
  const wordCount = seed.split(/\s+/).length
  if (wordCount < 2 || wordCount > 5) return null
  if (isOpaqueStandaloneIdentifierPhrase(seed, brandName)) return null

  return seed
}

function pushUniqueSeed(target: Set<string>, seed: string | null | undefined): void {
  const normalized = normalizeSourceText(seed)
  if (!normalized) return
  if (containsAsinLikeToken(normalized)) return
  target.add(normalized)
}

function addEvidenceTerms(target: Set<string>, seeds: Iterable<string>): void {
  for (const seed of seeds) {
    const normalized = normalizeGoogleAdsKeyword(seed)
    if (normalized) target.add(normalized)
  }
}

function extractSourceKeywordsFromTexts(params: {
  texts: string[]
  brandName: string
  includeEvidencePhrases?: boolean
  allowModelAnchors?: boolean
  includePhraseFallback?: boolean
}): string[] {
  const seeds = new Set<string>()

  for (const text of params.texts) {
    extractFeatureSeeds(text, params.brandName).forEach((seed) => pushUniqueSeed(seeds, seed))

    if (params.includeEvidencePhrases) {
      extractEvidenceScenarioSeedsFromText(text, params.brandName).forEach((scenarioSeed) => {
        pushUniqueSeed(seeds, scenarioSeed)
      })
    }

    if (params.allowModelAnchors && hasModelAnchorEvidence({ keywords: [text] })) {
      extractProductLineSeeds(`${params.brandName} ${stripSourceTextLabel(text)}`, params.brandName)
        .filter((seed) => !isOpaqueStandaloneIdentifierPhrase(seed, params.brandName))
        .filter((seed) => hasModelAnchorEvidence({ keywords: [seed] }))
        .forEach((seed) => pushUniqueSeed(seeds, seed))
    }

    if (params.includePhraseFallback) {
      pushUniqueSeed(seeds, buildBrandedPhraseSeed(text, params.brandName))
    }
  }

  return Array.from(seeds).slice(0, 12)
}

export function extractVerifiedKeywordSourcePool(offer: OfferData): VerifiedKeywordSourcePool {
  const scrapedData = safeParseStructuredData(offer.scrapedData)
  const reviewAnalysis = safeParseStructuredData(offer.reviewAnalysis)
  const brandAnalysis = safeParseStructuredData(offer.brandAnalysis)
  const brandName = offer.brand

  if (!brandName) {
    return {
      titleKeywords: [],
      aboutKeywords: [],
      paramKeywords: [],
      hotProductKeywords: [],
      pageKeywords: [],
      hotProductNames: [],
      evidenceTerms: [],
    }
  }

  const titleTexts = Array.from(
    new Set(
      [
        normalizeSourceText(offer.productTitle),
        normalizeSourceText(scrapedData?.rawProductTitle),
        normalizeSourceText(scrapedData?.productName),
        normalizeSourceText(scrapedData?.title),
      ].filter(Boolean)
    )
  ).slice(0, 8)

  const aboutTexts = collectPrioritizedTextGroups(
    [
      normalizeSourceText(offer.productFeatures),
      collectSimpleTextList(scrapedData?.rawAboutThisItem),
      collectSimpleTextList(scrapedData?.aboutThisItem),
      collectSimpleTextList(scrapedData?.features),
      collectSimpleTextList(scrapedData?.highlights),
      collectSimpleTextList(scrapedData?.productHighlights),
      collectProductFeatureTextList(scrapedData?.supplementalProducts),
      collectProductFeatureTextList(scrapedData?.deepScrapeResults?.topProducts),
      collectProductFeatureTextList(brandAnalysis?.hotProducts),
      collectProductFeatureTextList(scrapedData?.products),
    ],
    12
  )

  const paramTexts = collectPrioritizedTextGroups(
    [
      collectRecordTextList(scrapedData?.specifications),
      collectRecordTextList(scrapedData?.specs),
      collectRecordTextList(scrapedData?.attributes),
      collectRecordTextList(scrapedData?.technicalDetails),
      collectModelIdentifierTextList(scrapedData, 8),
      collectVariantTextList(scrapedData?.variants),
      collectVariantTextList(scrapedData?.productVariants),
      collectVariantTextList(scrapedData?.options),
      collectProductParamTextList(scrapedData?.supplementalProducts),
      collectProductParamTextList(scrapedData?.deepScrapeResults?.topProducts),
      collectProductParamTextList(brandAnalysis?.hotProducts),
      collectProductParamTextList(scrapedData?.products),
    ],
    12
  )

  const pageTexts = Array.from(
    new Set(
      [
        ...collectReviewAnalysisTexts(reviewAnalysis),
        ...collectBrandAnalysisTexts(brandAnalysis),
      ].filter(Boolean)
    )
  ).slice(0, 12)

  const hotProductNames = collectPrioritizedTextGroups(
    [
      (offer.storeProductNames || [])
        .map((item) => normalizeSourceText(item))
        .filter(Boolean)
        .filter((item) => !isLikelyUrlText(item)),
      collectProductNameList(scrapedData?.supplementalProducts),
      collectProductNameList(scrapedData?.deepScrapeResults?.topProducts),
      collectProductNameList(brandAnalysis?.hotProducts),
      collectProductNameList(scrapedData?.products),
    ],
    10
  )

  const evidenceTerms = new Set<string>()
  const titleKeywords = new Set<string>()
  const hotProductKeywords = new Set<string>()

  for (const text of titleTexts) {
    const extracted = [
      ...extractKeywordsFromProductTitle(text, brandName),
      ...extractProductLineSeeds(text, brandName),
    ]
    extracted.forEach((seed) => pushUniqueSeed(titleKeywords, seed))
    addEvidenceTerms(evidenceTerms, extracted)
  }

  const aboutKeywords = extractSourceKeywordsFromTexts({
    texts: aboutTexts,
    brandName,
    includeEvidencePhrases: true,
    includePhraseFallback: true,
  })
  addEvidenceTerms(evidenceTerms, aboutKeywords)

  const paramKeywords = extractSourceKeywordsFromTexts({
    texts: paramTexts,
    brandName,
    allowModelAnchors: true,
    includePhraseFallback: false,
  })
  addEvidenceTerms(evidenceTerms, paramKeywords)

  for (const productName of hotProductNames) {
    const extracted = [
      ...extractKeywordsFromProductTitle(productName, brandName),
      ...extractProductLineSeeds(productName, brandName),
    ]
    extracted.forEach((seed) => pushUniqueSeed(hotProductKeywords, seed))
    addEvidenceTerms(evidenceTerms, extracted)
  }

  aggregateStoreProductSeeds(hotProductNames, brandName).forEach((seed) =>
    pushUniqueSeed(hotProductKeywords, seed)
  )
  aggregateStoreProductLineSeeds(hotProductNames, brandName, evidenceTerms).forEach((seed) =>
    pushUniqueSeed(hotProductKeywords, seed)
  )
  addEvidenceTerms(evidenceTerms, hotProductKeywords)

  const pageKeywords = extractSourceKeywordsFromTexts({
    texts: pageTexts,
    brandName,
    includeEvidencePhrases: true,
    includePhraseFallback: true,
  })
  addEvidenceTerms(evidenceTerms, pageKeywords)

  return {
    titleKeywords: Array.from(titleKeywords).slice(0, 12),
    aboutKeywords: aboutKeywords.slice(0, 12),
    paramKeywords: paramKeywords.slice(0, 12),
    hotProductKeywords: Array.from(hotProductKeywords).slice(0, 12),
    pageKeywords: pageKeywords.slice(0, 12),
    hotProductNames,
    evidenceTerms: Array.from(evidenceTerms),
  }
}

/**
 * 构建意图感知的种子词池 v2.0
 *
 * 三类创意相关的 raw seeds 生成策略
 * legacy 桶A: 品牌名 + 产品类型/型号/系列词
 * legacy 桶B: 使用场景/应用环境/问题解决
 * legacy 桶C: 技术规格/功能特性/需求扩展
 *
 * @param offer - Offer 数据
 * @returns 按意图分类的种子词池
 */
export function buildIntentAwareSeedPool(offer: OfferData): IntentAwareSeedPool {
  const brandName = offer.brand
  const category = offer.category?.toLowerCase() || ''

  if (!brandName) {
    return {
      brandOrientedSeeds: [],
      scenarioOrientedSeeds: [],
      featureOrientedSeeds: [],
      allSeeds: [],
    }
  }

  logger.debug('\n🎯 构建意图感知种子词池 v2.0')
  logger.debug(`   品牌: ${brandName}, 品类: ${category || '未分类'}`)

  const featureSeeds = new Set<string>()
  const verifiedSourcePool = extractVerifiedKeywordSourcePool(offer)

  // legacy 桶A: 品牌商品锚点种子词

  const brandSeeds = new Set<string>()

  // A1. 品牌名变体
  const brandVariants = generateBrandVariants(brandName)
  brandVariants.forEach((v) => brandSeeds.add(v))

  // A2. 品牌 + 品类
  if (category) {
    const categoryCore = category.split(/[\s&,]+/)[0]
    brandSeeds.add(`${brandName} ${categoryCore}`)
  }

  verifiedSourcePool.titleKeywords.forEach((seed) => brandSeeds.add(seed))
  verifiedSourcePool.hotProductKeywords.forEach((seed) => brandSeeds.add(seed))
  verifiedSourcePool.paramKeywords
    .filter((seed) => hasModelAnchorEvidence({ keywords: [seed] }))
    .forEach((seed) => brandSeeds.add(seed))

  // A3. 从产品标题提取品牌+产品词
  if (offer.productTitle) {
    const titleSeeds = extractKeywordsFromProductTitle(offer.productTitle, brandName)
    titleSeeds.forEach((s) => brandSeeds.add(s))
    const productLineSeeds = extractProductLineSeeds(offer.productTitle, brandName)
    productLineSeeds.forEach((s) => brandSeeds.add(s))
  }

  // A4. 从 scrapedData 提取
  if (offer.scrapedData) {
    try {
      const scrapedData = JSON.parse(offer.scrapedData)
      const productName = scrapedData.productName || scrapedData.title
      if (productName && productName !== brandName) {
        const titleSeeds = extractKeywordsFromProductTitle(productName, brandName)
        titleSeeds.forEach((s) => brandSeeds.add(s))
        const productLineSeeds = extractProductLineSeeds(productName, brandName)
        productLineSeeds.forEach((s) => brandSeeds.add(s))
      }
      // 店铺多商品聚合
      if (scrapedData.products && Array.isArray(scrapedData.products)) {
        const storeProductNames = scrapedData.products
          .slice(0, 10)
          .map((p: any) => p.title || p.productName || p.name)
          .filter((name: string) => name && name.length > 3)
        const storeSeeds = aggregateStoreProductSeeds(storeProductNames, brandName)
        storeSeeds.forEach((s) => brandSeeds.add(s))
        const hotProductLineSeeds = aggregateStoreProductLineSeeds(storeProductNames, brandName)
        hotProductLineSeeds.forEach((s) => brandSeeds.add(s))
        hotProductLineSeeds.forEach((s) => featureSeeds.add(s))
      }
    } catch {}
  }

  // legacy 桶B: 商品需求场景种子词

  const scenarioSeeds = new Set<string>()

  // B1. 仅基于证据文本提取（不再使用品类模板造词）
  const scenarioEvidenceTexts = [
    offer.productFeatures,
    ...verifiedSourcePool.aboutKeywords,
    ...verifiedSourcePool.pageKeywords,
  ].filter((value): value is string => Boolean(String(value || '').trim()))

  for (const text of scenarioEvidenceTexts) {
    extractEvidenceScenarioSeedsFromText(text, brandName, { includeUnbranded: true }).forEach(
      (seed) => scenarioSeeds.add(seed)
    )
  }

  // B2. 最小兜底：避免场景桶完全为空
  if (scenarioSeeds.size === 0 && category) {
    const categoryCore = String(category).split(/[\s&,]+/)[0]
    if (categoryCore) scenarioSeeds.add(`${brandName.toLowerCase()} ${categoryCore}`)
  }

  // legacy 桶C: 功能规格 / 需求扩展种子词

  // C1. 仅使用证据来源词，不再拼接模板功能词
  if (offer.productFeatures) {
    const featureFromDesc = extractFeatureSeeds(offer.productFeatures, brandName)
    featureFromDesc.forEach((s) => featureSeeds.add(s))
  }
  verifiedSourcePool.aboutKeywords.forEach((seed) => featureSeeds.add(seed))
  verifiedSourcePool.paramKeywords.forEach((seed) => featureSeeds.add(seed))
  verifiedSourcePool.hotProductKeywords.forEach((seed) => featureSeeds.add(seed))
  verifiedSourcePool.pageKeywords.forEach((seed) => featureSeeds.add(seed))
  if (featureSeeds.size === 0 && category) {
    const categoryCore = String(category).split(/[\s&,]+/)[0]
    if (categoryCore) featureSeeds.add(`${brandName.toLowerCase()} ${categoryCore}`)
  }

  // 合并去重

  const allSeedsSet = new Set<string>()
  brandSeeds.forEach((s) => allSeedsSet.add(s.toLowerCase().trim()))
  scenarioSeeds.forEach((s) => allSeedsSet.add(s.toLowerCase().trim()))
  featureSeeds.forEach((s) => allSeedsSet.add(s.toLowerCase().trim()))

  const result: IntentAwareSeedPool = {
    brandOrientedSeeds: Array.from(brandSeeds).slice(0, 15),
    scenarioOrientedSeeds: Array.from(scenarioSeeds).slice(0, 15),
    featureOrientedSeeds: Array.from(featureSeeds).slice(0, 15),
    allSeeds: Array.from(allSeedsSet).slice(0, 50),
  }

  // 输出统计
  logger.debug(`\n📊 种子词统计 (🔥 2025-12-26 扩大种子池):`)
  logger.debug(`   🏷️ 品牌商品锚点 (legacy 桶A): ${result.brandOrientedSeeds.length} 个`)
  result.brandOrientedSeeds.slice(0, 5).forEach((s) => logger.debug(`      - "${s}"`))
  logger.debug(`   🏠 商品需求场景 (legacy 桶B): ${result.scenarioOrientedSeeds.length} 个`)
  result.scenarioOrientedSeeds.slice(0, 5).forEach((s) => logger.debug(`      - "${s}"`))
  logger.debug(`   ⚙️ 功能规格/需求扩展 (legacy 桶C): ${result.featureOrientedSeeds.length} 个`)
  result.featureOrientedSeeds.slice(0, 5).forEach((s) => logger.debug(`      - "${s}"`))
  logger.debug(`   📝 总计: ${result.allSeeds.length} 个去重种子词 (之前: 25)`)

  return result
}

/**
 * 从证据文本提取场景短语（替代模板造词）
 */
function extractEvidenceScenarioSeedsFromText(
  text: string,
  brandName: string,
  options: { includeUnbranded?: boolean } = {}
): string[] {
  const includeUnbranded = Boolean(options.includeUnbranded)
  const normalized = normalizeGoogleAdsKeyword(stripSourceTextLabel(text))
  if (!normalized) return []

  const brandTokens = new Set(
    normalizeGoogleAdsKeyword(brandName)?.split(/\s+/).filter(Boolean) || []
  )

  const seeds = new Set<string>()
  const fragments = normalized
    .split(/[;,.|/]+/)
    .map((fragment) => fragment.trim())
    .filter(Boolean)

  const pushPhrase = (phraseTokens: string[]) => {
    if (phraseTokens.length < 2) return
    const phrase = phraseTokens.slice(0, 4).join(' ')
    if (!phrase) return

    if (includeUnbranded) seeds.add(phrase)
    const branded = `${brandName.toLowerCase()} ${phrase}`.trim()
    if (isOpaqueStandaloneIdentifierPhrase(branded, brandName)) return
    seeds.add(branded)
  }

  for (const fragment of fragments) {
    const tokens = fragment
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .filter((token) => token.length >= 3 || /\d/.test(token))
      .filter((token) => !brandTokens.has(token))
      .filter((token) => !KEYWORD_SOURCE_STOPWORDS.has(token))
      .filter((token) => !/^\d+$/.test(token))
      .slice(0, 6)

    pushPhrase(tokens)
  }

  if (seeds.size === 0) {
    const fallbackBranded = buildBrandedPhraseSeed(text, brandName, 4)
    if (fallbackBranded) {
      const fallbackNormalized =
        normalizeGoogleAdsKeyword(fallbackBranded) || fallbackBranded.toLowerCase()
      const fallbackTokens = fallbackNormalized
        .split(/\s+/)
        .filter(Boolean)
        .filter((token) => !brandTokens.has(token))
      pushPhrase(fallbackTokens)
    }
  }

  return Array.from(seeds).slice(0, 6)
}

/**
 * 构建智能种子词池（向后兼容）
 *
 * 从 Offer 数据提取品牌相关的种子词，用于 Keyword Planner 查询
 * 品牌相关种子词 → Keyword Planner 返回更相关结果
 *
 * 添加品牌名变体生成，覆盖常见搜索变体
 * 使用意图感知种子词构建，最大化覆盖三个意图桶
 */
export function buildSmartSeedPool(offer: OfferData): string[] {
  // v2.0: 使用意图感知种子词构建
  const intentPool = buildIntentAwareSeedPool(offer)
  return intentPool.allSeeds
}

export async function expandWithoutKeywordPlanner(params: {
  offer: OfferData
  country: string
  language: string
  userId?: number
}): Promise<UnifiedKeywordData[]> {
  const { offer, country, language, userId } = params

  const pureBrandKeywords = getPureBrandKeywords(offer.brand)
  if (pureBrandKeywords.length === 0) return []

  const keywordMap = new Map<string, UnifiedKeywordData>()
  const languageCode = normalizeLanguageCode(language)

  const addKeyword = (keyword: string, source: UnifiedKeywordData['source']) => {
    if (!containsPureBrand(keyword, pureBrandKeywords)) return
    const canonical = normalizeGoogleAdsKeyword(keyword)
    if (!canonical || keywordMap.has(canonical)) return

    const matchType = isPureBrandKeyword(keyword, pureBrandKeywords) ? 'EXACT' : 'PHRASE'
    keywordMap.set(canonical, {
      keyword,
      searchVolume: 0,
      competition: 'UNKNOWN',
      competitionIndex: 0,
      lowTopPageBid: 0,
      highTopPageBid: 0,
      source,
      matchType,
    })
  }

  pureBrandKeywords.forEach((kw) => addKeyword(kw, 'BRAND'))

  try {
    const { getBrandSearchSuggestions } = await import('../google-suggestions')
    const suggestions = await getBrandSearchSuggestions({
      brand: offer.brand,
      country,
      language: languageCode,
      useProxy: true,
      productName: offer.productTitle || offer.brand,
      category: offer.category || undefined,
    })

    suggestions.forEach((s) => addKeyword(s.keyword, 'EXPANSION'))
  } catch (error: any) {
    console.warn('   ⚠️ Google下拉词获取失败，跳过补充:', error.message)
  }

  if (userId) {
    try {
      const { extractKeywordsEnhanced } = await import('../enhanced-keyword-extractor')
      const features = (() => {
        if (!offer.productFeatures) return []
        try {
          const parsed = JSON.parse(offer.productFeatures)
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      })()

      const scraped = (() => {
        if (!offer.scrapedData) return null
        try {
          return JSON.parse(offer.scrapedData)
        } catch {
          return null
        }
      })()

      const enhanced = await extractKeywordsEnhanced(
        {
          productName: offer.productTitle || offer.brand,
          brandName: offer.brand,
          category: offer.category || '',
          description: (scraped && (scraped.description || scraped.productDescription)) || '',
          features,
          useCases: [],
          targetAudience: '',
          competitors: [],
          targetCountry: country,
          targetLanguage: language,
        },
        userId
      )

      enhanced.forEach((kw) => addKeyword(kw.keyword, 'EXPANSION'))
    } catch (error: any) {
      console.warn('   ⚠️ 增强提取失败，跳过补充:', error.message)
    }
  }

  // 移除 TRENDS 关键词生成
  // 原因
  // 1. Title/About补充已覆盖产品特征词
  // 2. 行业通用词（Scoring建议）已覆盖行业标准词
  // 3. TRENDS关键词质量不可控（品类识别错误、无意义组合）
  // 4. 无搜索量数据验证（Explorer限制）
  // 5. 与其他来源重复度高

  // try {
  // try {
  // const trendsKeywords = await getTrendsKeywords(...) // google-trends module removed
  // const seedKeywords = Array.from(keywordMap.values())
  // .slice(0, 10)
  // .map(kw => kw.keyword)

  // const trends = await getTrendsKeywords(seedKeywords, offer.brand, offer.category || '')
  // trends.forEach(kw => addKeyword(kw.keyword, 'EXPANSION'))
  // } catch (error: any) {
  // console.warn(' Google Trends扩展失败，跳过补充:', error.message)
  // }

  return Array.from(keywordMap.values())
}

/**
 * 从产品标题提取种子词
 */
function extractKeywordsFromProductTitle(productTitle: string, brandName: string): string[] {
  if (!productTitle || !brandName) return []

  const keywords: string[] = []

  // 移除品牌名，获取产品描述部分
  const titleWithoutBrand = productTitle
    .replace(new RegExp(brandName, 'gi'), '')
    .replace(/^\s*[-–—]\s*/, '')
    .trim()

  // 分词并过滤
  const words = titleWithoutBrand.split(/\s+/).filter((w) => {
    const isShort = w.length < 3
    const isSpec = /^[\d.]+[pPkKgGmMtT"']*$/.test(w) || /^\d+x\d+$/i.test(w)
    const isCommon =
      /^(with|for|and|the|a|an|in|on|of|to|by|from|new|pro|plus|max|mini|lite)$/i.test(w)
    return !isShort && !isSpec && !isCommon
  })

  // 策略1: 品牌名 + 前2个核心词
  if (words.length >= 2) {
    keywords.push(`${brandName} ${words.slice(0, 2).join(' ')}`)
  }

  // 策略2: 品牌名 + 单个核心产品词
  const productTypeWords = words.filter((w) => /^[A-Z][a-z]+$/.test(w) || /^[a-z]+$/.test(w))

  for (const word of productTypeWords.slice(0, 2)) {
    const combo = `${brandName} ${word}`
    if (!keywords.includes(combo)) {
      keywords.push(combo)
    }
  }

  return keywords.slice(0, 3)
}

function extractProductLineSeeds(productTitle: string, brandName: string): string[] {
  if (!productTitle || !brandName) return []

  const titleWithoutBrand = productTitle
    .replace(new RegExp(brandName, 'gi'), '')
    .replace(/^\s*[-–—]\s*/, '')
    .trim()

  if (!titleWithoutBrand) return []

  const rawTokens = titleWithoutBrand
    .split(/[\s/|,()\-–—]+/)
    .map((token) => token.trim())
    .filter(Boolean)

  const tokens = rawTokens.filter((token) => {
    if (token.length < 2) return false
    if (/^[\d.]+[pPkKgGmMtT"']*$/.test(token)) return false
    if (/^\d+x\d+$/i.test(token)) return false
    if (
      /^(with|for|and|the|a|an|in|on|of|to|by|from|new|edition|pack|set|kit|bundle)$/i.test(token)
    )
      return false
    return /[a-z]/i.test(token)
  })

  const seeds = new Set<string>()
  for (let i = 0; i < tokens.length; i += 1) {
    const current = tokens[i]
    const next = tokens[i + 1]
    if (/^(pro|plus|max|mini|lite|ultra|omni|cam|series|gen)$/i.test(current) && i > 0) {
      continue
    }
    if (next && /^(pro|plus|max|mini|lite|ultra|omni|cam|series|gen)$/i.test(next)) {
      seeds.add(`${brandName} ${current} ${next}`)
    }
    seeds.add(`${brandName} ${current}`)
  }

  return Array.from(seeds).slice(0, 5)
}

/**
 * 从店铺多商品提取种子词
 */
function aggregateStoreProductSeeds(productNames: string[], brandName: string): string[] {
  if (!productNames || productNames.length === 0 || !brandName) return []

  const seeds: string[] = []
  const wordFrequency = new Map<string, number>()
  const phraseFrequency = new Map<string, number>()

  for (const productName of productNames) {
    const nameWithoutBrand = productName.replace(new RegExp(brandName, 'gi'), '').trim()

    const words = nameWithoutBrand.split(/[\s\-–—,]+/).filter((w) => {
      if (w.length < 3) return false
      if (/^[\d.]+[pPkKgGmMtThHzZ"']*$/.test(w)) return false
      if (/^\d+x\d+$/i.test(w)) return false
      if (
        /^(with|for|and|the|a|an|in|on|of|to|by|from|new|pro|plus|max|mini|lite|version|edition|series|gen|generation|pack|set|kit|bundle)$/i.test(
          w
        )
      )
        return false
      return true
    })

    for (const word of words) {
      const wordLower = word.toLowerCase()
      wordFrequency.set(wordLower, (wordFrequency.get(wordLower) || 0) + 1)
    }

    for (let i = 0; i < words.length - 1; i += 1) {
      const phrase = `${words[i].toLowerCase()} ${words[i + 1].toLowerCase()}`
      phraseFrequency.set(phrase, (phraseFrequency.get(phrase) || 0) + 1)
    }
  }

  // 取出现次数>=2的高频词
  const frequentWords = Array.from(wordFrequency.entries())
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word)

  for (const word of frequentWords) {
    seeds.push(`${brandName} ${word}`)
  }

  const frequentPhrases = Array.from(phraseFrequency.entries())
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([phrase]) => phrase)

  for (const phrase of frequentPhrases) {
    seeds.push(`${brandName} ${phrase}`)
  }

  return seeds
}

function aggregateStoreProductLineSeeds(
  productNames: string[],
  brandName: string,
  evidenceTerms?: Set<string>
): string[] {
  if (!productNames || productNames.length === 0 || !brandName) return []

  const frequency = new Map<string, number>()
  for (const productName of productNames) {
    const productLineSeeds = extractProductLineSeeds(productName, brandName)
    productLineSeeds.forEach((seed) => {
      const normalized = seed.toLowerCase()
      frequency.set(normalized, (frequency.get(normalized) || 0) + 1)
    })
  }

  return Array.from(frequency.entries())
    .filter(([seed, count]) => count >= 2 || (count >= 1 && Boolean(evidenceTerms?.has(seed))))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([seed]) => seed)
}

/**
 * 从产品特性提取种子词
 */
function extractFeatureSeeds(features: string, brandName: string): string[] {
  if (!features || !brandName) return []

  const brandTokenSet = new Set(
    normalizeGoogleAdsKeyword(brandName)?.split(/\s+/).filter(Boolean) || []
  )

  const seeds = new Set<string>()
  const featureList = features
    .split(/[;\n,.|]+/)
    .map((item) => normalizeGoogleAdsKeyword(stripSourceTextLabel(item)))
    .filter((item): item is string => Boolean(item))
    .slice(0, 12)

  for (const feature of featureList) {
    const tokens = feature
      .split(/\s+/)
      .filter(Boolean)
      .filter((token) => token.length >= 3 || /\d/.test(token))
      .filter((token) => !brandTokenSet.has(token))
      .filter((token) => !KEYWORD_SOURCE_STOPWORDS.has(token))
      .filter((token) => !/^\d+$/.test(token))
      .slice(0, 4)

    if (tokens.length === 0) continue
    const phrase = tokens.join(' ')
    const seed = normalizeGoogleAdsKeyword(`${brandName} ${phrase}`) || ''
    if (!seed) continue
    if (isOpaqueStandaloneIdentifierPhrase(seed, brandName)) continue
    seeds.add(seed)
  }

  return Array.from(seeds).slice(0, 6)
}
