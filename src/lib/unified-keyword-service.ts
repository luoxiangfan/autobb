/**
 * 统一关键词服务 v2.0
 *
 * 优化目标：
 * 1. 最大化品牌相关搜索词
 * 2. 最大化广告质量（关键词、创意、着陆页一致）
 * 3. 保留高搜索量词
 *
 * 核心改进：
 * - 智能种子词构建（品牌相关种子词 → 品牌相关结果）
 * - 白名单过滤（替代竞品黑名单，100%可靠）
 * - 按搜索量降序排序（确保高价值词不丢失）
 * - 统一数据源（创意嵌入 = 投放关键词）
 */

import { getKeywordSearchVolumes } from './keyword-planner'
import { getKeywordIdeas } from './google-ads-keyword-planner'
import { getUserAuthType } from './google-ads-oauth'
import { PLATFORMS, BRAND_PATTERNS, DEFAULTS, THRESHOLD_LEVELS, CATEGORY_SYNONYMS } from './keyword-constants'
import { getKeywordPlannerSiteFilterUrlForOffer } from './keyword-planner-site-filter'
import { containsPureBrand, getPureBrandKeywords, isPureBrandKeyword } from './brand-keyword-utils'
import { normalizeGoogleAdsKeyword } from './google-ads-keyword-normalizer'
import { normalizeLanguageCode } from './language-country-codes'
import { hasModelAnchorEvidence } from './creative-type'
import { containsAsinLikeToken, extractModelIdentifierTokensFromText } from './model-anchor-evidence'

// ============================================
// 类型定义
// ============================================

export interface UnifiedKeywordData {
  keyword: string
  searchVolume: number
  competition: string
  competitionIndex: number
  lowTopPageBid: number
  highTopPageBid: number
  source: 'BRAND' | 'CATEGORY' | 'FEATURE' | 'EXPANSION'
  matchType: 'EXACT' | 'PHRASE' | 'BROAD'
  volumeUnavailableReason?: 'DEV_TOKEN_INSUFFICIENT_ACCESS'
}

/**
 * 白名单过滤结果（P0-2优化：包含竞品品牌提取）
 */
export interface WhitelistFilterResult<T> {
  /** 过滤后的关键词 */
  filtered: T[]
  /** 识别到的竞品品牌（可用作否定关键词） */
  competitorBrands: string[]
  /** 统计信息 */
  stats: {
    brandKept: number      // 品牌词保留数
    genericKept: number    // 通用词保留数
    competitorFiltered: number  // 竞品词过滤数
    misspellingFiltered?: number  // 🔥 新增(2025-12-16): 拼写错误过滤数
  }
}

/**
 * 统一关键词服务返回结果（P0-2优化：包含竞品品牌）
 */
export interface UnifiedKeywordResult {
  /** 关键词列表 */
  keywords: UnifiedKeywordData[]
  /** 识别到的竞品品牌（建议用作否定关键词） */
  competitorBrands: string[]
}

export interface OfferData {
  brand: string
  category?: string | null
  /** 可选：用于 Keyword Planner 的站点过滤（origin级别会在调用处做归一化） */
  url?: string | null
  /** 可选：最终落地页URL（优先用于站点过滤） */
  final_url?: string | null
  /** 可选：camelCase 兼容字段 */
  finalUrl?: string | null
  productTitle?: string
  productFeatures?: string
  storeProductNames?: string[]
  scrapedData?: string
  reviewAnalysis?: string
  brandAnalysis?: string
}

export interface VerifiedKeywordSourcePool {
  titleKeywords: string[]
  aboutKeywords: string[]
  paramKeywords: string[]
  hotProductKeywords: string[]
  pageKeywords: string[]
  hotProductNames: string[]
  evidenceTerms: string[]
}

export interface KeywordServiceParams {
  offer: OfferData
  country: string
  language: string
  customerId?: string
  refreshToken?: string
  accountId?: number
  userId?: number
  // 认证类型（支持服务账号模式）
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  // 可选配置
  minSearchVolume?: number
  maxKeywords?: number
}

// ============================================
// 优化1: 品牌名变体自动生成
// ============================================

/**
 * 生成品牌名变体
 *
 * 覆盖用户搜索时的常见变体：
 * - 大小写变体
 * - 带空格/不带空格变体
 * - 常见拼写错误（双字母简化）
 * - CamelCase 分词
 * - 🆕 核心品牌词提取（首词）
 */
export function generateBrandVariants(brand: string): string[] {
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
  pureBrandKeywords.forEach(keyword => variants.add(keyword))

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

  const result = Array.from(variants).filter(v => v.length >= 2)

  console.log(`   🔤 品牌变体: ${result.join(', ')}`)

  return result
}

// ============================================
// 品类场景/功能词库（用于 raw seeds 生成）
// ============================================

/**
 * 品类对应的常见使用场景词（legacy 桶B，对应商品需求场景）
 * - 这些词描述"在哪里用/为什么用"（Where/Why）
 * - 不包含技术规格或功能特性
 */
const CATEGORY_SCENARIO_SEEDS: Record<string, string[]> = {
  // 安防摄像头
  'camera': ['home security', 'baby monitor', 'pet watching', 'garage security', 'driveway monitoring', 'backyard security', 'front door security', 'home protection', 'property surveillance'],
  'security camera': ['home security system', 'house protection', 'apartment security', 'office security', 'small business security', 'remote monitoring', 'elderly care', 'nanny cam'],
  'doorbell': ['front door security', 'package theft protection', 'visitor monitoring', 'home entrance security', 'delivery notification'],

  // 智能家居
  'smart home': ['home automation', 'voice control home', 'connected home', 'smart living'],
  'vacuum': ['home cleaning', 'pet hair cleaning', 'floor cleaning', 'carpet cleaning', 'hardwood floor care'],
  'robot vacuum': ['automatic cleaning', 'hands-free cleaning', 'scheduled cleaning', 'whole home cleaning'],

  // 音频设备
  'headphones': ['music listening', 'work from home', 'commute audio', 'gaming audio', 'workout music'],
  'speaker': ['home audio', 'party music', 'outdoor entertainment', 'room audio'],

  // 通用
  'default': ['home use', 'office use', 'outdoor use', 'daily use', 'professional use']
}

/**
 * 品类对应的常见功能/规格词（legacy 桶C，对应功能规格特性）
 * - 这些词描述"要什么功能/什么规格"（What/How）
 * - 技术规格、功能特性、购买意图词
 */
const CATEGORY_FEATURE_SEEDS: Record<string, string[]> = {
  // 安防摄像头
  'camera': ['wireless', 'night vision', '4k', '2k', '1080p', 'solar powered', 'battery powered', 'motion detection', 'two-way audio', 'cloud storage', 'local storage', 'waterproof', 'outdoor', 'indoor', 'ptz', '360 degree', 'color night vision'],
  'security camera': ['no monthly fee', 'free cloud storage', 'continuous recording', 'ai detection', 'person detection', 'vehicle detection', 'package detection', 'smart alerts'],
  'doorbell': ['video doorbell', 'wireless doorbell', 'battery doorbell', 'wired doorbell', 'smart doorbell', 'doorbell with camera'],

  // 智能家居
  'smart home': ['alexa compatible', 'google home', 'apple homekit', 'wifi', 'zigbee', 'matter', 'smart hub'],
  'vacuum': ['powerful suction', 'quiet', 'self-emptying', 'mopping', 'lidar navigation', 'app control', 'scheduling'],
  'robot vacuum': ['obstacle avoidance', 'auto empty', 'self cleaning', 'mapping', 'multi-floor'],

  // 音频设备
  'headphones': ['noise cancelling', 'wireless', 'bluetooth', 'over ear', 'in ear', 'long battery life', 'comfortable', 'hi-fi', 'anc'],
  'speaker': ['portable', 'waterproof', 'bluetooth', 'wifi', 'bass', 'surround sound', 'multi-room'],

  // 通用
  'default': ['best', 'top rated', 'affordable', 'cheap', 'budget', 'premium', 'professional', 'high quality', 'durable', 'reliable']
}

/**
 * 需求扩展/比较词（适用于所有品类，legacy 桶C/D）
 */
const PURCHASE_INTENT_WORDS = [
  'best', 'top', 'review', 'vs', 'alternative', 'cheap', 'affordable',
  'budget', 'premium', 'compare', 'which', 'recommendation'
]

// ============================================
// 智能种子词构建
// ============================================

/**
 * 意图导向的种子词结果
 */
export interface IntentAwareSeedPool {
  /** 品牌商品锚点种子词 (legacy 桶A) */
  brandOrientedSeeds: string[]
  /** 商品需求场景种子词 (legacy 桶B) */
  scenarioOrientedSeeds: string[]
  /** 功能规格/需求扩展种子词 (legacy 桶C) */
  featureOrientedSeeds: string[]
  /** 所有种子词（合并去重） */
  allSeeds: string[]
}

const KEYWORD_SOURCE_STOPWORDS = new Set([
  'with', 'for', 'and', 'the', 'a', 'an', 'in', 'on', 'of', 'to', 'by', 'from',
  'new', 'edition', 'pack', 'set', 'kit', 'bundle', 'feature', 'features',
  'about', 'item', 'items', 'model', 'series', 'version', 'style', 'color',
  'size', 'option', 'options', 'type', 'asin', 'sku', 'mpn', 'upc', 'ean',
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

const MODEL_IDENTIFIER_DETAIL_KEY_PATTERN = /(item\s*model|model|sku|asin|mpn|part\s*number|manufacturer\s*part|item\s*#|style\s*#)/i

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
  const exists = target.some(item => item.toLowerCase() === normalized.toLowerCase())
  if (exists || target.length >= limit) return
  target.push(normalized)
}

function collectPrioritizedTextGroups(
  groups: unknown[],
  limit: number
): string[] {
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
        for (const key of ['text', 'name', 'title', 'label', 'value', 'keyword', 'scenario', 'theme', 'summary']) {
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
  if (technicalDetails && typeof technicalDetails === 'object' && !Array.isArray(technicalDetails)) {
    for (const [key, rawValue] of Object.entries(technicalDetails as Record<string, unknown>).slice(0, 20)) {
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
    .replace(/^(?:item\s+)?(?:model(?:\s+name|\s+number)?|series|version|style(?:\s+name)?|color|colour|brand(?:\s+name)?|name|number|sku|mpn|part\s+number|item\s+type\s+name|option|feature|features|use case|scenario|summary|theme)\s*[:\-]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isOpaqueStandaloneIdentifierToken(token: string): boolean {
  const normalized = String(token || '').toLowerCase().replace(/[^a-z0-9]/g, '')
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
    normalizeGoogleAdsKeyword(brandName)
      ?.split(/\s+/)
      .filter(Boolean) || []
  )
  const tokens = normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter(token => !brandTokens.has(token))

  return tokens.length === 1 && isOpaqueStandaloneIdentifierToken(tokens[0])
}

function buildBrandedPhraseSeed(text: string, brandName: string, maxTokens = 4): string | null {
  const normalized = normalizeGoogleAdsKeyword(stripSourceTextLabel(text))
  if (!normalized) return null

  const brandTokenSet = new Set(
    normalizeGoogleAdsKeyword(brandName)
      ?.split(/\s+/)
      .filter(Boolean) || []
  )
  const tokens = normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter(token => token.length >= 3 || /\d/.test(token))
    .filter(token => !brandTokenSet.has(token))
    .filter(token => !KEYWORD_SOURCE_STOPWORDS.has(token))
    .filter(token => !/^\d+$/.test(token))

  if (tokens.length === 0) return null
  if (!tokens.some(token => /[a-z]/i.test(token))) return null

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
  includeScenario?: boolean
  allowModelAnchors?: boolean
  includePhraseFallback?: boolean
}): string[] {
  const seeds = new Set<string>()

  for (const text of params.texts) {
    extractFeatureSeeds(text, params.brandName).forEach(seed => pushUniqueSeed(seeds, seed))

    if (params.includeScenario) {
      extractScenarioFromFeatures(text).forEach((scenario) => {
        pushUniqueSeed(seeds, `${params.brandName.toLowerCase()} ${scenario}`)
      })
    }

    if (params.allowModelAnchors && hasModelAnchorEvidence({ keywords: [text] })) {
      extractProductLineSeeds(`${params.brandName} ${stripSourceTextLabel(text)}`, params.brandName)
        .filter(seed => !isOpaqueStandaloneIdentifierPhrase(seed, params.brandName))
        .filter(seed => hasModelAnchorEvidence({ keywords: [seed] }))
        .forEach(seed => pushUniqueSeed(seeds, seed))
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

  const titleTexts = Array.from(new Set([
    normalizeSourceText(offer.productTitle),
    normalizeSourceText(scrapedData?.rawProductTitle),
    normalizeSourceText(scrapedData?.productName),
    normalizeSourceText(scrapedData?.title),
  ].filter(Boolean))).slice(0, 8)

  const aboutTexts = collectPrioritizedTextGroups([
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
  ], 12)

  const paramTexts = collectPrioritizedTextGroups([
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
  ], 12)

  const pageTexts = Array.from(new Set([
    ...collectReviewAnalysisTexts(reviewAnalysis),
    ...collectBrandAnalysisTexts(brandAnalysis),
  ].filter(Boolean))).slice(0, 12)

  const hotProductNames = collectPrioritizedTextGroups([
    (offer.storeProductNames || [])
      .map(item => normalizeSourceText(item))
      .filter(Boolean)
      .filter(item => !isLikelyUrlText(item)),
    collectProductNameList(scrapedData?.supplementalProducts),
    collectProductNameList(scrapedData?.deepScrapeResults?.topProducts),
    collectProductNameList(brandAnalysis?.hotProducts),
    collectProductNameList(scrapedData?.products),
  ], 10)

  const evidenceTerms = new Set<string>()
  const titleKeywords = new Set<string>()
  const hotProductKeywords = new Set<string>()

  for (const text of titleTexts) {
    const extracted = [
      ...extractKeywordsFromProductTitle(text, brandName),
      ...extractProductLineSeeds(text, brandName),
    ]
    extracted.forEach(seed => pushUniqueSeed(titleKeywords, seed))
    addEvidenceTerms(evidenceTerms, extracted)
  }

  const aboutKeywords = extractSourceKeywordsFromTexts({
    texts: aboutTexts,
    brandName,
    includeScenario: true,
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
    extracted.forEach(seed => pushUniqueSeed(hotProductKeywords, seed))
    addEvidenceTerms(evidenceTerms, extracted)
  }

  aggregateStoreProductSeeds(hotProductNames, brandName)
    .forEach(seed => pushUniqueSeed(hotProductKeywords, seed))
  aggregateStoreProductLineSeeds(hotProductNames, brandName, evidenceTerms)
    .forEach(seed => pushUniqueSeed(hotProductKeywords, seed))
  addEvidenceTerms(evidenceTerms, hotProductKeywords)

  const pageKeywords = extractSourceKeywordsFromTexts({
    texts: pageTexts,
    brandName,
    includeScenario: true,
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
 * 三类创意相关的 raw seeds 生成策略：
 * - legacy 桶A: 品牌名 + 产品类型/型号/系列词
 * - legacy 桶B: 使用场景/应用环境/问题解决
 * - legacy 桶C: 技术规格/功能特性/需求扩展
 *
 * @param offer - Offer 数据
 * @returns 按意图分类的种子词池
 */
export function buildIntentAwareSeedPool(offer: OfferData): IntentAwareSeedPool {
  const brandName = offer.brand
  const category = offer.category?.toLowerCase() || ''

  if (!brandName) {
    return { brandOrientedSeeds: [], scenarioOrientedSeeds: [], featureOrientedSeeds: [], allSeeds: [] }
  }

  console.log('\n🎯 构建意图感知种子词池 v2.0')
  console.log(`   品牌: ${brandName}, 品类: ${category || '未分类'}`)

  const featureSeeds = new Set<string>()
  const verifiedSourcePool = extractVerifiedKeywordSourcePool(offer)

  // ==========================================
  // legacy 桶A: 品牌商品锚点种子词
  // ==========================================
  const brandSeeds = new Set<string>()

  // A1. 品牌名变体
  const brandVariants = generateBrandVariants(brandName)
  brandVariants.forEach(v => brandSeeds.add(v))

  // A2. 品牌 + 品类
  if (category) {
    const categoryCore = category.split(/[\s&,]+/)[0]
    brandSeeds.add(`${brandName} ${categoryCore}`)
  }

  verifiedSourcePool.titleKeywords.forEach(seed => brandSeeds.add(seed))
  verifiedSourcePool.hotProductKeywords.forEach(seed => brandSeeds.add(seed))
  verifiedSourcePool.paramKeywords
    .filter(seed => hasModelAnchorEvidence({ keywords: [seed] }))
    .forEach(seed => brandSeeds.add(seed))

  // A3. 从产品标题提取品牌+产品词
  if (offer.productTitle) {
    const titleSeeds = extractKeywordsFromProductTitle(offer.productTitle, brandName)
    titleSeeds.forEach(s => brandSeeds.add(s))
    const productLineSeeds = extractProductLineSeeds(offer.productTitle, brandName)
    productLineSeeds.forEach(s => brandSeeds.add(s))
  }

  // A4. 从 scrapedData 提取
  if (offer.scrapedData) {
    try {
      const scrapedData = JSON.parse(offer.scrapedData)
      const productName = scrapedData.productName || scrapedData.title
      if (productName && productName !== brandName) {
        const titleSeeds = extractKeywordsFromProductTitle(productName, brandName)
        titleSeeds.forEach(s => brandSeeds.add(s))
        const productLineSeeds = extractProductLineSeeds(productName, brandName)
        productLineSeeds.forEach(s => brandSeeds.add(s))
      }
      // 店铺多商品聚合
      if (scrapedData.products && Array.isArray(scrapedData.products)) {
        const storeProductNames = scrapedData.products
          .slice(0, 10)
          .map((p: any) => p.title || p.productName || p.name)
          .filter((name: string) => name && name.length > 3)
        const storeSeeds = aggregateStoreProductSeeds(storeProductNames, brandName)
        storeSeeds.forEach(s => brandSeeds.add(s))
        const hotProductLineSeeds = aggregateStoreProductLineSeeds(storeProductNames, brandName)
        hotProductLineSeeds.forEach(s => brandSeeds.add(s))
        hotProductLineSeeds.forEach(s => featureSeeds.add(s))
      }
    } catch {}
  }

  // ==========================================
  // legacy 桶B: 商品需求场景种子词
  // ==========================================
  const scenarioSeeds = new Set<string>()

  // B1. 从品类词库获取场景词
  const categoryKey = findCategoryKey(category, CATEGORY_SCENARIO_SEEDS)
  const categoryScenarios = CATEGORY_SCENARIO_SEEDS[categoryKey] || CATEGORY_SCENARIO_SEEDS['default']

  // B2. 添加场景词（不带品牌名，用于获取通用场景关键词）
  categoryScenarios.slice(0, 8).forEach(scenario => {
    scenarioSeeds.add(scenario)
    // 也添加品牌+场景组合，捕获"eufy home security"这类搜索
    scenarioSeeds.add(`${brandName.toLowerCase()} ${scenario}`)
  })

  // B3. 从产品特性中提取场景相关词
  if (offer.productFeatures) {
    const scenarioFromFeatures = extractScenarioFromFeatures(offer.productFeatures)
    scenarioFromFeatures.forEach(s => scenarioSeeds.add(s))
  }
  verifiedSourcePool.pageKeywords.forEach(seed => scenarioSeeds.add(seed))

  // ==========================================
  // legacy 桶C: 功能规格 / 需求扩展种子词
  // ==========================================
  // C1. 从品类词库获取功能词
  const featureCategoryKey = findCategoryKey(category, CATEGORY_FEATURE_SEEDS)
  const categoryFeatures = CATEGORY_FEATURE_SEEDS[featureCategoryKey] || CATEGORY_FEATURE_SEEDS['default']

  // C2. 添加功能词组合
  categoryFeatures.slice(0, 10).forEach(feature => {
    // 功能词 + 品类核心词
    const categoryCore = category.split(/[\s&,]+/)[0] || 'product'
    featureSeeds.add(`${feature} ${categoryCore}`)
    // 品牌 + 功能词（捕获"eufy wireless camera"）
    featureSeeds.add(`${brandName.toLowerCase()} ${feature}`)
  })

  // C3. 添加购买意图词
  PURCHASE_INTENT_WORDS.slice(0, 5).forEach(intent => {
    const categoryCore = category.split(/[\s&,]+/)[0] || 'product'
    featureSeeds.add(`${intent} ${categoryCore}`)
  })

  // C4. 从产品特性提取功能相关词
  if (offer.productFeatures) {
    const featureFromDesc = extractFeatureSeeds(offer.productFeatures, brandName)
    featureFromDesc.forEach(s => featureSeeds.add(s))
  }
  verifiedSourcePool.aboutKeywords.forEach(seed => featureSeeds.add(seed))
  verifiedSourcePool.paramKeywords.forEach(seed => featureSeeds.add(seed))
  verifiedSourcePool.hotProductKeywords.forEach(seed => featureSeeds.add(seed))
  verifiedSourcePool.pageKeywords.forEach(seed => featureSeeds.add(seed))

  // ==========================================
  // 合并去重
  // ==========================================
  const allSeedsSet = new Set<string>()
  brandSeeds.forEach(s => allSeedsSet.add(s.toLowerCase().trim()))
  scenarioSeeds.forEach(s => allSeedsSet.add(s.toLowerCase().trim()))
  featureSeeds.forEach(s => allSeedsSet.add(s.toLowerCase().trim()))

  const result: IntentAwareSeedPool = {
    brandOrientedSeeds: Array.from(brandSeeds).slice(0, 15),
    scenarioOrientedSeeds: Array.from(scenarioSeeds).slice(0, 15),
    featureOrientedSeeds: Array.from(featureSeeds).slice(0, 15),
    allSeeds: Array.from(allSeedsSet).slice(0, 50)
  }

  // 输出统计
  console.log(`\n📊 种子词统计 (🔥 2025-12-26 扩大种子池):`)
  console.log(`   🏷️ 品牌商品锚点 (legacy 桶A): ${result.brandOrientedSeeds.length} 个`)
  result.brandOrientedSeeds.slice(0, 5).forEach(s => console.log(`      - "${s}"`))
  console.log(`   🏠 商品需求场景 (legacy 桶B): ${result.scenarioOrientedSeeds.length} 个`)
  result.scenarioOrientedSeeds.slice(0, 5).forEach(s => console.log(`      - "${s}"`))
  console.log(`   ⚙️ 功能规格/需求扩展 (legacy 桶C): ${result.featureOrientedSeeds.length} 个`)
  result.featureOrientedSeeds.slice(0, 5).forEach(s => console.log(`      - "${s}"`))
  console.log(`   📝 总计: ${result.allSeeds.length} 个去重种子词 (之前: 25)`)

  return result
}

/**
 * 查找匹配的品类键
 */
function findCategoryKey(category: string, seedMap: Record<string, string[]>): string {
  if (!category) return 'default'

  const categoryLower = category.toLowerCase()

  // 精确匹配
  if (seedMap[categoryLower]) return categoryLower

  // 部分匹配
  for (const key of Object.keys(seedMap)) {
    if (categoryLower.includes(key) || key.includes(categoryLower)) {
      return key
    }
  }

  return 'default'
}

/**
 * 从产品特性中提取场景相关词
 */
function extractScenarioFromFeatures(features: string): string[] {
  const scenarios: string[] = []
  const featureLower = features.toLowerCase()

  // 场景关键词映射
  const scenarioPatterns: Record<string, string> = {
    'baby': 'baby monitor',
    'pet': 'pet watching',
    'home': 'home security',
    'outdoor': 'outdoor monitoring',
    'indoor': 'indoor security',
    'garage': 'garage security',
    'front door': 'front door security',
    'backyard': 'backyard monitoring',
    'office': 'office security',
    'business': 'business security'
  }

  for (const [pattern, scenario] of Object.entries(scenarioPatterns)) {
    if (featureLower.includes(pattern)) {
      scenarios.push(scenario)
    }
  }

  return scenarios.slice(0, 5)
}

/**
 * 构建智能种子词池（向后兼容）
 *
 * 从 Offer 数据提取品牌相关的种子词，用于 Keyword Planner 查询
 * 品牌相关种子词 → Keyword Planner 返回更相关结果
 *
 * 优化(2025-12-14): 添加品牌名变体生成，覆盖常见搜索变体
 * 优化(2025-12-16): 使用意图感知种子词构建，最大化覆盖三个意图桶
 */
export function buildSmartSeedPool(offer: OfferData): string[] {
  // 🆕 v2.0: 使用意图感知种子词构建
  const intentPool = buildIntentAwareSeedPool(offer)
  return intentPool.allSeeds
}

async function expandWithoutKeywordPlanner(params: {
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
      matchType
    })
  }

  pureBrandKeywords.forEach(kw => addKeyword(kw, 'BRAND'))

  try {
    const { getBrandSearchSuggestions } = await import('./google-suggestions')
    const suggestions = await getBrandSearchSuggestions({
      brand: offer.brand,
      country,
      language: languageCode,
      useProxy: true,
      productName: offer.productTitle || offer.brand,
      category: offer.category || undefined,
    })

    suggestions.forEach(s => addKeyword(s.keyword, 'EXPANSION'))
  } catch (error: any) {
    console.warn('   ⚠️ Google下拉词获取失败，跳过补充:', error.message)
  }

  if (userId) {
    try {
      const { extractKeywordsEnhanced } = await import('./enhanced-keyword-extractor')
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

      const enhanced = await extractKeywordsEnhanced({
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
      }, userId)

      enhanced.forEach(kw => addKeyword(kw.keyword, 'EXPANSION'))
    } catch (error: any) {
      console.warn('   ⚠️ 增强提取失败，跳过补充:', error.message)
    }
  }

  // 🔥 2026-03-13: 移除 TRENDS 关键词生成
  // 原因：
  // 1. Title/About补充已覆盖产品特征词
  // 2. 行业通用词（Scoring建议）已覆盖行业标准词
  // 3. TRENDS关键词质量不可控（品类识别错误、无意义组合）
  // 4. 无搜索量数据验证（Explorer限制）
  // 5. 与其他来源重复度高
  //
  // try {
  //   const { getTrendsKeywords } = await import('./google-trends')
  //   const seedKeywords = Array.from(keywordMap.values())
  //     .slice(0, 10)
  //     .map(kw => kw.keyword)
  //
  //   const trends = await getTrendsKeywords(seedKeywords, offer.brand, offer.category || '')
  //   trends.forEach(kw => addKeyword(kw.keyword, 'EXPANSION'))
  // } catch (error: any) {
  //   console.warn('   ⚠️ Google Trends扩展失败，跳过补充:', error.message)
  // }

  return Array.from(keywordMap.values())
}

/**
 * 从产品标题提取种子词
 */
function extractKeywordsFromProductTitle(productTitle: string, brandName: string): string[] {
  if (!productTitle || !brandName) return []

  const keywords: string[] = []
  const brandLower = brandName.toLowerCase()
  const titleLower = productTitle.toLowerCase()

  // 移除品牌名，获取产品描述部分
  const titleWithoutBrand = productTitle
    .replace(new RegExp(brandName, 'gi'), '')
    .replace(/^\s*[-–—]\s*/, '')
    .trim()

  // 分词并过滤
  const words = titleWithoutBrand
    .split(/\s+/)
    .filter(w => {
      const isShort = w.length < 3
      const isSpec = /^[\d.]+[pPkKgGmMtT"']*$/.test(w) || /^\d+x\d+$/i.test(w)
      const isCommon = /^(with|for|and|the|a|an|in|on|of|to|by|from|new|pro|plus|max|mini|lite)$/i.test(w)
      return !isShort && !isSpec && !isCommon
    })

  // 策略1: 品牌名 + 前2个核心词
  if (words.length >= 2) {
    keywords.push(`${brandName} ${words.slice(0, 2).join(' ')}`)
  }

  // 策略2: 品牌名 + 单个核心产品词
  const productTypeWords = words.filter(w =>
    /^[A-Z][a-z]+$/.test(w) || /^[a-z]+$/.test(w)
  )

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
    .map(token => token.trim())
    .filter(Boolean)

  const tokens = rawTokens.filter((token) => {
    if (token.length < 2) return false
    if (/^[\d.]+[pPkKgGmMtT"']*$/.test(token)) return false
    if (/^\d+x\d+$/i.test(token)) return false
    if (/^(with|for|and|the|a|an|in|on|of|to|by|from|new|edition|pack|set|kit|bundle)$/i.test(token)) return false
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
    const nameWithoutBrand = productName
      .replace(new RegExp(brandName, 'gi'), '')
      .trim()

    const words = nameWithoutBrand
      .split(/[\s\-–—,]+/)
      .filter(w => {
        if (w.length < 3) return false
        if (/^[\d.]+[pPkKgGmMtThHzZ"']*$/.test(w)) return false
        if (/^\d+x\d+$/i.test(w)) return false
        if (/^(with|for|and|the|a|an|in|on|of|to|by|from|new|pro|plus|max|mini|lite|version|edition|series|gen|generation|pack|set|kit|bundle)$/i.test(w)) return false
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

  const seeds: string[] = []
  const seenSeeds = new Set<string>()

  const highValueFeatures: Record<string, string> = {
    '4k': '4K',
    '1080p': 'HD',
    'night vision': 'night vision',
    'motion detection': 'motion detection',
    'two-way audio': 'two-way audio',
    'wireless': 'wireless',
    'solar': 'solar',
    'battery': 'battery',
    'waterproof': 'waterproof',
    'ptz': 'PTZ',
    'smart': 'smart',
    'alexa': 'Alexa',
    'bluetooth': 'bluetooth',
    'portable': 'portable',
  }

  const featureList = features
    .split(/[;,]/)
    .map(f => f.trim().toLowerCase())
    .filter(f => f.length > 3)

  for (const feature of featureList) {
    for (const [pattern, seedWord] of Object.entries(highValueFeatures)) {
      if (feature.includes(pattern)) {
        const seed = `${brandName} ${seedWord}`
        if (!seenSeeds.has(seed.toLowerCase())) {
          seenSeeds.add(seed.toLowerCase())
          seeds.push(seed)
        }
        break
      }
    }
  }

  return seeds.slice(0, 5)
}
// ============================================
// 白名单过滤
// ============================================

/**
 * 检测关键词是否包含已知品牌名
 *
 * 返回: 品牌名 或 null
 *
 * 注意：销售平台关键词（如amazon）不会被识别为竞品品牌
 */
function detectBrandInKeyword(keyword: string): string | null {
  const keywordLower = keyword.toLowerCase()

  // 🔥 优先检查销售平台白名单（2025-12-17修复）
  // 如果关键词包含销售平台词（如 "argus 3 pro amazon"），不应视为竞品
  for (const platform of PLATFORMS) {
    const regex = new RegExp(`\\b${platform}\\b`, 'i')
    if (regex.test(keywordLower)) {
      // 包含销售平台词，不视为竞品，返回 null
      return null
    }
  }

  // 检查已知品牌列表
  for (const brand of BRAND_PATTERNS) {
    // 完整词匹配（避免 "spring" 匹配 "ring"）
    const regex = new RegExp(`\\b${brand}\\b`, 'i')
    if (regex.test(keywordLower)) {
      return brand
    }
  }

  return null
}

/**
 * 🔥 修复(2025-12-16): 生成品牌名的常见拼写变体/错误
 *
 * 用于识别并排除 Google Keyword Planner 返回的拼写错误关键词
 * 例如: "Dreame" → ["dreamers", "dreamer", "dream "] (这些应该被排除)
 */
function generateBrandMisspellings(brandName: string): string[] {
  const brand = brandName.toLowerCase()
  const misspellings: string[] = []

  // 1. 添加 's' 后缀变体 (dreame → dreamers)
  misspellings.push(brand + 's')
  misspellings.push(brand + 'rs')
  misspellings.push(brand + 'er')
  misspellings.push(brand + 'ers')

  // 2. 去掉末尾字母变体 (dreame → dream)
  if (brand.length > 3) {
    misspellings.push(brand.slice(0, -1))  // dreame → dream
    misspellings.push(brand.slice(0, -1) + 'er')  // dreame → dreamer
    misspellings.push(brand.slice(0, -1) + 'ers')  // dreame → dreamers
  }

  // 3. 常见字母替换 (a↔e, i↔y)
  const variants = [
    brand.replace(/e/g, 'a'),
    brand.replace(/a/g, 'e'),
    brand.replace(/i/g, 'y'),
    brand.replace(/y/g, 'i'),
  ].filter(v => v !== brand)
  misspellings.push(...variants)

  return [...new Set(misspellings)]  // 去重
}

/**
 * 🔥 修复(2025-12-16): 检查关键词是否包含品牌名作为完整单词
 *
 * 使用单词边界匹配，避免 "dreamers" 误匹配 "dreame"
 */
function containsBrandAsWord(keyword: string, brandName: string): boolean {
  const brandLower = brandName.toLowerCase()
  const keywordLower = keyword.toLowerCase()

  // 使用单词边界正则表达式
  const brandPattern = new RegExp(`\\b${escapeRegex(brandLower)}\\b`, 'i')
  return brandPattern.test(keywordLower)
}

/**
 * 🔥 修复(2025-12-16): 检查关键词是否包含品牌拼写错误
 *
 * 用于排除 Google Keyword Planner 返回的拼写变体
 */
function containsBrandMisspelling(keyword: string, brandName: string): boolean {
  const keywordLower = keyword.toLowerCase()
  const misspellings = generateBrandMisspellings(brandName)

  for (const misspelling of misspellings) {
    // 使用单词边界匹配
    const pattern = new RegExp(`\\b${escapeRegex(misspelling)}\\b`, 'i')
    if (pattern.test(keywordLower)) {
      return true
    }
  }
  return false
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 白名单过滤（P0-2优化：提取竞品品牌用作否定关键词）
 *
 * 🔥 2025-12-24 优化规则：
 * 1. ✅ 保留: 包含自身品牌名的关键词（精确单词匹配）
 * 2. ❌ 排除: 包含品牌拼写错误的关键词（如 dreamers, dreamer）
 * 3. ✅ 保留: 不含任何品牌名的通用品类词
 * 4. ❌ 排除: 包含其他品牌名的关键词（竞品）
 * 5. ✅ 优化: 同时包含自身品牌+竞品的关键词保留（跨品牌比较搜索有价值）
 *
 * 🔥 修复(2025-12-16): 使用单词边界匹配 + 拼写变体过滤
 * 🆕 优化(2025-12): 返回识别到的竞品品牌列表，可用于创建否定关键词
 * 🆕 2025-12-24: 跨品牌比较搜索保留（如 "roborock xiaomi" 应该保留）
 */
export function filterByWhitelist<T extends { keyword: string }>(
  keywords: T[],
  brandName: string
): WhitelistFilterResult<T> {
  const pureBrandKeywords = getPureBrandKeywords(brandName)
  const shortBrand = pureBrandKeywords.find(kw => kw.split(/\s+/).length === 1)
  const normalizedBrand = normalizeGoogleAdsKeyword(brandName)
  const coreBrand = shortBrand || normalizedBrand || brandName.toLowerCase()
  const coreBrandLower = coreBrand.toLowerCase()

  let brandKept = 0
  let genericKept = 0
  let competitorFiltered = 0
  let crossBrandKept = 0  // 🔥 2025-12-24: 跨品牌比较搜索保留计数
  let misspellingFiltered = 0  // 🔥 新增：拼写错误过滤计数

  // 🆕 收集识别到的竞品品牌
  const competitorBrandsSet = new Set<string>()

  const filtered = keywords.filter(kw => {
    const keywordLower = kw.keyword.toLowerCase()

    // 🔥 修复(2025-12-16): 先检查是否包含品牌拼写错误
    // 例如: "dreamers", "dreamer shop" 应该被过滤
    if (containsBrandMisspelling(kw.keyword, brandName) || containsBrandMisspelling(kw.keyword, coreBrand)) {
      misspellingFiltered++
      console.log(`   ❌ 过滤拼写错误: "${kw.keyword}" (品牌: ${brandName})`)
      return false
    }

    // 🔥 修复(2025-12-16): 使用单词边界匹配品牌名
    // 1. 包含自身品牌名（完整单词匹配） → 保留
    if (containsBrandAsWord(kw.keyword, brandName) || containsBrandAsWord(kw.keyword, coreBrand)) {
      brandKept++
      return true
    }

    // 🔥 2025-12-24 优化：检查是否同时包含自身品牌和竞品
    // 如果同时包含自身品牌和竞品（如 "roborock xiaomi"），这是跨品牌比较搜索，应该保留
    const detectedBrand = detectBrandInKeyword(kw.keyword)
    if (detectedBrand) {
      // 🔧 2025-12-24 修复：先检查是否包含自身品牌（使用单词边界匹配）
      const hasSelfBrandWord = containsBrandAsWord(kw.keyword, brandName) ||
                               containsBrandAsWord(kw.keyword, coreBrand)

      // 辅助检查：部分匹配（处理品牌变体）
      const hasSelfBrandPartial = keywordLower.includes(coreBrandLower) ||
                                  brandName.toLowerCase().split(' ').some(part =>
                                    part.length >= 3 && keywordLower.includes(part.toLowerCase())
                                  )

      if (hasSelfBrandWord || hasSelfBrandPartial) {
        // 🔥 同时包含自身品牌和竞品，保留（跨品牌比较搜索有价值）
        crossBrandKept++
        console.log(`   ✅ 保留跨品牌比较词: "${kw.keyword}" (自身: ${brandName} + 竞品: ${detectedBrand})`)
        return true
      }

      // 纯竞品词（不含自身品牌） → 排除
      competitorFiltered++
      competitorBrandsSet.add(detectedBrand)  // 🆕 收集竞品品牌
      console.log(`   ❌ 过滤竞品词: "${kw.keyword}" (检测到竞品: ${detectedBrand})`)
      return false
    }

    // 3. 不含任何品牌名 → 保留（通用品类词）
    genericKept++
    return true
  })

  const competitorBrands = Array.from(competitorBrandsSet)

  console.log(`\n📋 白名单过滤结果:`)
  console.log(`   ✅ 品牌词保留: ${brandKept}`)
  console.log(`   ✅ 通用词保留: ${genericKept}`)
  console.log(`   ✅ 跨品牌比较词保留: ${crossBrandKept}`)  // 🔥 2025-12-24 新增
  console.log(`   ❌ 竞品词过滤: ${competitorFiltered}`)
  console.log(`   ❌ 拼写错误过滤: ${misspellingFiltered}`)  // 🔥 新增
  if (competitorBrands.length > 0) {
    console.log(`   🏷️ 识别竞品品牌: ${competitorBrands.join(', ')}`)
  }

  return {
    filtered,
    competitorBrands,
    stats: {
      brandKept,
      genericKept,
      competitorFiltered,
      misspellingFiltered  // 🔥 新增
    }
  }
}

/**
 * 白名单过滤（简化版，向后兼容）
 * @deprecated 建议使用 filterByWhitelist 获取完整结果
 */
export function filterByWhitelistSimple<T extends { keyword: string }>(
  keywords: T[],
  brandName: string
): T[] {
  return filterByWhitelist(keywords, brandName).filtered
}

// ============================================
// 智能过滤和排序
// ============================================

// 研究意图关键词标识（需要过滤）
const RESEARCH_INTENT_PATTERNS = [
  'review', 'reviews', 'vs', 'versus', 'comparison', 'compare',
  'alternative', 'alternatives', 'how to', 'what is', 'guide',
  'tutorial', 'reddit', 'forum', 'blog', 'article'
]

/**
 * 智能过滤
 *
 * - 搜索量过滤 (默认>500，可自适应降低)
 * - 研究意图过滤 (排除 review, vs, tutorial)
 *
 * 🆕 优化3 (2025-12-14): 搜索量阈值自适应
 * - 如果过滤后关键词不足15个，自动降低阈值重试
 * - 最低阈值为1（确保小众市场也能获得关键词）
 */
export function applySmartFilters(
  keywords: UnifiedKeywordData[],
  minSearchVolume: number = DEFAULTS.minSearchVolume,
  minKeywordsTarget: number = DEFAULTS.minKeywordsTarget,
  options?: { disableSearchVolumeFilter?: boolean; pureBrandKeywords?: string[] }
): UnifiedKeywordData[] {
  const hasAnyVolume = keywords.some(kw => kw.searchVolume > 0)
  const disableSearchVolumeFilter = options?.disableSearchVolumeFilter ?? !hasAnyVolume
  const pureBrandKeywords = options?.pureBrandKeywords || []
  const isPureBrand = (keyword: string) => isPureBrandKeyword(keyword, pureBrandKeywords)

  if (disableSearchVolumeFilter) {
    console.log('\n⚠️ 搜索量数据不可用，跳过搜索量阈值过滤（仅过滤研究意图词）')
    return keywords.filter(kw => {
      if (isPureBrand(kw.keyword)) return true
      const keywordLower = kw.keyword.toLowerCase()
      const hasResearchIntent = RESEARCH_INTENT_PATTERNS.some(pattern => keywordLower.includes(pattern))
      return !hasResearchIntent
    })
  }

  let currentThreshold = minSearchVolume
  let filtered: UnifiedKeywordData[] = []
  let attempts = 0
  const maxAttempts = DEFAULTS.maxFilterAttempts

  // 🔥 2025-12-18优化: 动态阈值生成（基于初始关键词的搜索量分布）
  // 计算合理的自适应阈值序列
  const thresholdLevels = calculateAdaptiveThresholds(keywords, minSearchVolume)

  console.log(`\n📊 自适应阈值序列: ${thresholdLevels.join(' → ')}`)

  while (attempts < maxAttempts) {
    currentThreshold = thresholdLevels[Math.min(attempts, thresholdLevels.length - 1)]

    let volumeFiltered = 0
    let intentFiltered = 0

    filtered = keywords.filter(kw => {
      if (isPureBrand(kw.keyword)) return true
      // 搜索量过滤
      if (kw.searchVolume < currentThreshold) {
        volumeFiltered++
        return false
      }

      // 研究意图过滤
      const keywordLower = kw.keyword.toLowerCase()
      const hasResearchIntent = RESEARCH_INTENT_PATTERNS.some(pattern =>
        keywordLower.includes(pattern)
      )

      if (hasResearchIntent) {
        intentFiltered++
        return false
      }

      return true
    })

    // 如果结果足够或已达最低阈值，停止
    if (filtered.length >= minKeywordsTarget || currentThreshold <= 1) {
      console.log(`\n📊 智能过滤结果 (阈值=${currentThreshold}):`)
      console.log(`   过滤低搜索量(<${currentThreshold}): ${volumeFiltered}`)
      console.log(`   过滤研究意图词: ${intentFiltered}`)
      console.log(`   保留关键词: ${filtered.length}`)

      if (attempts > 0) {
        console.log(`   📉 阈值自适应: ${minSearchVolume} → ${currentThreshold} (第${attempts + 1}次尝试)`)
      }
      break
    }

    // 结果不足，降低阈值重试
    console.log(`   ⚠️ 关键词不足(${filtered.length}/${minKeywordsTarget})，降低阈值重试...`)
    attempts++
  }

  return filtered
}

/**
 * 🔥 2025-12-18新增: 计算动态自适应阈值
 * 简化设计：基于关键词的实际搜索量分布，只保留高中等价值的词
 * 低搜索量的词直接过滤掉，不需要逐步降低阈值
 */
function calculateAdaptiveThresholds(keywords: UnifiedKeywordData[], initialThreshold: number): number[] {
  // 如果关键词为空，返回初始阈值
  if (keywords.length === 0) {
    return [initialThreshold, 1]
  }

  // 获取所有有效的搜索量数据
  const validVolumes = keywords
    .map(kw => kw.searchVolume)
    .filter(vol => vol > 0)
    .sort((a, b) => b - a)

  if (validVolumes.length === 0) {
    return [initialThreshold, 1]
  }

  // 计算中位数作为参考点
  const medianVolume = validVolumes[Math.floor(validVolumes.length / 2)]

  // 智能阈值：保留高中等价值的词（中位数的30%以上）
  const adaptiveThreshold = Math.max(
    Math.floor(medianVolume * 0.3),  // 中位数的30%
    Math.floor(initialThreshold * 0.5)  // 至少是初始阈值的50%
  )

  const thresholds: number[] = [initialThreshold]

  // 如果自适应阈值不同于初始阈值，添加到阈值序列
  if (adaptiveThreshold < initialThreshold && !thresholds.includes(adaptiveThreshold)) {
    thresholds.push(adaptiveThreshold)
  }

  // 最终兜底阈值
  thresholds.push(1)

  // 去重并按降序排列
  return Array.from(new Set(thresholds)).sort((a, b) => b - a)
}

/**
 * 智能匹配类型分配
 */
export function assignMatchTypes(
  keywords: UnifiedKeywordData[],
  brandName: string
): UnifiedKeywordData[] {
  const pureBrandKeywords = getPureBrandKeywords(brandName)

  return keywords.map(kw => {
    // 纯品牌词 → EXACT
    if (isPureBrandKeyword(kw.keyword, pureBrandKeywords)) {
      return { ...kw, matchType: 'EXACT' as const }
    }

    // 品牌相关词 → PHRASE
    if (containsPureBrand(kw.keyword, pureBrandKeywords)) {
      return { ...kw, matchType: 'PHRASE' as const }
    }

    // 短关键词 (≤3 words) → PHRASE
    const wordCount = kw.keyword.split(/\s+/).length
    if (wordCount <= 3) {
      return { ...kw, matchType: 'PHRASE' as const }
    }

    // 长尾词 → PHRASE（默认收敛，避免意外放量）
    return { ...kw, matchType: 'PHRASE' as const }
  })
}

// ============================================
// 主服务函数
// ============================================

/**
 * 多轮意图感知扩展结果
 */
export interface MultiRoundExpansionResult {
  /** 品牌商品锚点关键词 (legacy 桶A) */
  brandOrientedKeywords: UnifiedKeywordData[]
  /** 商品需求场景关键词 (legacy 桶B) */
  scenarioOrientedKeywords: UnifiedKeywordData[]
  /** 功能规格关键词 (legacy 桶C) */
  featureOrientedKeywords: UnifiedKeywordData[]
  /** 所有关键词（合并去重） */
  allKeywords: UnifiedKeywordData[]
  /** 识别到的竞品品牌 */
  competitorBrands: string[]
  /** 扩展统计 */
  stats: {
    round1Count: number  // 品牌商品锚点
    round2Count: number  // 商品需求场景
    round3Count: number  // 功能规格/需求扩展
    totalBeforeDedup: number
    totalAfterDedup: number
  }
}

/**
 * 多轮意图感知关键词扩展 v2.0
 *
 * 三轮扩展策略：
 * - Round 1: 使用品牌商品锚点种子词 → 获取品牌+产品关键词
 * - Round 2: 使用商品需求场景种子词 → 获取使用场景关键词
 * - Round 3: 使用功能规格/需求扩展种子词 → 获取功能特性关键词
 *
 * @param params - 扩展参数
 * @returns 按意图分类的关键词结果
 */
export async function getMultiRoundIntentAwareKeywords(params: KeywordServiceParams): Promise<MultiRoundExpansionResult> {
  const {
    offer,
    country,
    language,
    customerId,
    refreshToken,
    accountId,
    userId,
    authType = 'oauth',
    serviceAccountId,
    minSearchVolume = 100,  // 多轮扩展使用较低阈值
    maxKeywords = 500
  } = params

  console.log('\n' + '='.repeat(60))
  console.log('🎯 多轮意图感知关键词扩展 v2.0')
  console.log('='.repeat(60))
  console.log(`品牌: ${offer.brand}`)
  console.log(`品类: ${offer.category || '未分类'}`)
  console.log(`国家: ${country}, 语言: ${language}`)
  console.log(`认证方式: ${authType}`)

  const pureBrandKeywords = getPureBrandKeywords(offer.brand)

  // 1. 构建意图感知种子词池
  console.log('\n📍 Step 1: 构建意图感知种子词池')
  const intentSeeds = buildIntentAwareSeedPool(offer)

  const keywordMap = new Map<string, UnifiedKeywordData>()
  const competitorBrandsSet = new Set<string>()

  // 统计
  let round1Count = 0
  let round2Count = 0
  let round3Count = 0

  // 辅助函数：执行单轮扩展
  const runExpansionRound = async (
    roundName: string,
    roundSeeds: string[],
    roundNum: number
  ): Promise<UnifiedKeywordData[]> => {
    if (roundSeeds.length === 0) {
      console.log(`   ⚠️ ${roundName}: 无种子词，跳过`)
      return []
    }

    console.log(`\n📍 Round ${roundNum}: ${roundName}`)
    console.log(`   种子词: ${roundSeeds.slice(0, 5).join(', ')}${roundSeeds.length > 5 ? '...' : ''}`)

    const roundKeywords: UnifiedKeywordData[] = []

    if (customerId && userId) {
      try {
        const keywordIdeas = await getKeywordIdeas({
          customerId,
          seedKeywords: roundSeeds,
          pageUrl: getKeywordPlannerSiteFilterUrlForOffer({
            final_url: (offer as any).final_url || (offer as any).finalUrl || null,
            url: offer.url,
            extraction_metadata: (offer as any).extraction_metadata || null,
          }),
          targetCountry: country,
          targetLanguage: language,
          accountId,
          userId,
          authType,
          serviceAccountId,
        })

        console.log(`   📋 Keyword Planner 返回 ${keywordIdeas.length} 个建议`)

        keywordIdeas.forEach(idea => {
          roundKeywords.push({
            keyword: idea.text,
            searchVolume: idea.avgMonthlySearches || 0,
            competition: idea.competition || 'UNKNOWN',
            competitionIndex: idea.competitionIndex || 0,
            lowTopPageBid: (idea.lowTopOfPageBidMicros || 0) / 1_000_000,
            highTopPageBid: (idea.highTopOfPageBidMicros || 0) / 1_000_000,
            source: 'EXPANSION',
            matchType: 'PHRASE'
          })
        })
      } catch (error: any) {
        console.error(`   ❌ ${roundName} 扩展失败:`, error.message)
      }
    }

    return roundKeywords
  }

  // 2. Round 1: 品牌导向扩展
  const brandKeywords = await runExpansionRound(
    '品牌商品锚点 (Brand Product Anchor)',
    intentSeeds.brandOrientedSeeds,
    1
  )
  round1Count = brandKeywords.length

  // 3. Round 2: 场景导向扩展
  const scenarioKeywords = await runExpansionRound(
    '商品需求场景 (Demand Scenario)',
    intentSeeds.scenarioOrientedSeeds,
    2
  )
  round2Count = scenarioKeywords.length

  // 4. Round 3: 功能导向扩展
  const featureKeywords = await runExpansionRound(
    '功能规格/需求扩展 (Feature / Demand Expansion)',
    intentSeeds.featureOrientedSeeds,
    3
  )
  round3Count = featureKeywords.length

  // 5. 合并去重
  console.log('\n📍 Step 5: 合并去重')
  const totalBeforeDedup = brandKeywords.length + scenarioKeywords.length + featureKeywords.length

  // 添加到 keywordMap（自动去重）
  const addToMap = (keywords: UnifiedKeywordData[], source: string) => {
    keywords.forEach(kw => {
      const canonical = normalizeGoogleAdsKeyword(kw.keyword)
      if (!canonical) return
      if (!keywordMap.has(canonical)) {
        keywordMap.set(canonical, { ...kw, source: source as any })
      } else {
        // 如果已存在，保留搜索量更高的
        const existing = keywordMap.get(canonical)!
        if (kw.searchVolume > existing.searchVolume) {
          keywordMap.set(canonical, { ...kw, source: source as any })
        }
      }
    })
  }

  addToMap(brandKeywords, 'BRAND')
  addToMap(scenarioKeywords, 'CATEGORY')
  addToMap(featureKeywords, 'FEATURE')

  // 6. 白名单过滤
  console.log('\n📍 Step 6: 白名单过滤')
  let allKeywords = Array.from(keywordMap.values())
  const whitelistResult = filterByWhitelist(allKeywords, offer.brand)
  allKeywords = whitelistResult.filtered as UnifiedKeywordData[]
  whitelistResult.competitorBrands.forEach(b => competitorBrandsSet.add(b))

  // 🔥 2026-01-02: 移除品类过滤 - 避免误杀有效关键词
  // 依赖Google Ads自动优化机制（质量得分、智能出价）淘汰不相关关键词
  console.log(`\n✅ 关键词过滤完成，共 ${allKeywords.length} 个关键词`)

  if (pureBrandKeywords.length > 0) {
    const beforeBrandFilter = allKeywords.length
    allKeywords = allKeywords.filter(kw => containsPureBrand(kw.keyword, pureBrandKeywords))
    console.log(`   🔒 品牌强制过滤: ${beforeBrandFilter} → ${allKeywords.length}`)
  }

  // 7. 按搜索量降序排序（关键修复：先排序再截取）
  console.log('\n📍 Step 7: 按搜索量降序排序')
  allKeywords.sort((a, b) => b.searchVolume - a.searchVolume)
  console.log(`   📊 排序后搜索量范围: ${allKeywords[allKeywords.length - 1]?.searchVolume || 0} - ${allKeywords[0]?.searchVolume || 0}`)

  // 8. 获取精确搜索量（对搜索量最高的前1000个关键词）
  console.log('\n📍 Step 8: 获取精确搜索量（前1000个）')
  let disableSearchVolumeFilter = false
  let metricsAvailable = false
  try {
    const volumes = await getKeywordSearchVolumes(
      allKeywords.slice(0, 1000).map(kw => kw.keyword),
      country,
      language,
      userId
    )

    disableSearchVolumeFilter = volumes.some((vol: any) =>
      vol?.volumeUnavailableReason === 'DEV_TOKEN_INSUFFICIENT_ACCESS'
    )
    if (volumes.length > 0 && !disableSearchVolumeFilter) {
      metricsAvailable = true
    }

    volumes.forEach(vol => {
      const canonical = normalizeGoogleAdsKeyword(vol.keyword)
      if (!canonical) return
      // 更新 keywordMap 中的搜索量
      allKeywords.forEach((kw, idx) => {
        if (normalizeGoogleAdsKeyword(kw.keyword) === canonical) {
          allKeywords[idx] = {
            ...kw,
            searchVolume: vol.avgMonthlySearches,
            competition: vol.competition,
            competitionIndex: vol.competitionIndex,
            lowTopPageBid: vol.lowTopPageBid,
            highTopPageBid: vol.highTopPageBid,
          }
        }
      })
    })
    console.log(`   ✅ 更新 ${volumes.length} 个关键词的搜索量`)
  } catch (error: any) {
    console.error('   ❌ 获取搜索量失败:', error.message)
  }
  if (!metricsAvailable) {
    disableSearchVolumeFilter = true
  }

  // 9. 智能过滤 + 匹配类型分配
  console.log('\n📍 Step 9: 智能过滤')
  allKeywords = applySmartFilters(allKeywords, minSearchVolume, 30, { disableSearchVolumeFilter, pureBrandKeywords })
  allKeywords = assignMatchTypes(allKeywords, offer.brand)

  // 10. 再次按搜索量排序（确保最终排序正确）
  allKeywords.sort((a, b) => b.searchVolume - a.searchVolume)

  // 11. 限制数量
  allKeywords = allKeywords.slice(0, maxKeywords)

  // 11. 按意图重新分类（基于关键词内容）
  const classifyByIntent = (kw: UnifiedKeywordData): 'brand' | 'scenario' | 'feature' => {
    const kwLower = kw.keyword.toLowerCase()

    // 品牌商品锚点：包含品牌名
    if (containsPureBrand(kw.keyword, pureBrandKeywords)) {
      return 'brand'
    }

    // 功能规格：包含功能/规格词
    const featurePatterns = ['wireless', 'night vision', '4k', '2k', '1080p', 'solar', 'battery', 'motion', 'detection', 'audio', 'storage', 'waterproof', 'ptz', 'hd', 'best', 'top', 'cheap', 'affordable', 'budget']
    if (featurePatterns.some(p => kwLower.includes(p))) {
      return 'feature'
    }

    // 默认：商品需求场景
    return 'scenario'
  }

  const brandOrientedKeywords = allKeywords.filter(kw => classifyByIntent(kw) === 'brand')
  const scenarioOrientedKeywords = allKeywords.filter(kw => classifyByIntent(kw) === 'scenario')
  const featureOrientedKeywords = allKeywords.filter(kw => classifyByIntent(kw) === 'feature')

  // 输出统计
  console.log('\n' + '='.repeat(60))
  console.log('✅ 多轮意图感知扩展完成')
  console.log('='.repeat(60))
  console.log(`📊 扩展统计:`)
  console.log(`   Round 1 (品牌商品锚点): ${round1Count} 个`)
  console.log(`   Round 2 (商品需求场景): ${round2Count} 个`)
  console.log(`   Round 3 (功能规格/需求扩展): ${round3Count} 个`)
  console.log(`   合并前总计: ${totalBeforeDedup} 个`)
  console.log(`   去重后总计: ${allKeywords.length} 个`)
  console.log(`\n📊 意图分类结果:`)
  console.log(`   🏷️ 品牌商品锚点: ${brandOrientedKeywords.length} 个`)
  console.log(`   🏠 商品需求场景: ${scenarioOrientedKeywords.length} 个`)
  console.log(`   ⚙️ 功能规格/需求扩展: ${featureOrientedKeywords.length} 个`)

  if (competitorBrandsSet.size > 0) {
    console.log(`\n🏷️ 识别竞品品牌: ${Array.from(competitorBrandsSet).join(', ')}`)
  }

  return {
    brandOrientedKeywords,
    scenarioOrientedKeywords,
    featureOrientedKeywords,
    allKeywords,
    competitorBrands: Array.from(competitorBrandsSet),
    stats: {
      round1Count,
      round2Count,
      round3Count,
      totalBeforeDedup,
      totalAfterDedup: allKeywords.length
    }
  }
}

/**
 * 统一关键词数据获取服务 v2.0
 *
 * 流程：
 * 1. 构建智能种子词池
 * 2. Keyword Planner 查询（获取所有结果）
 * 3. 按搜索量降序排序
 * 4. 白名单过滤
 * 5. 智能过滤 + 匹配类型分配
 */
export async function getUnifiedKeywordData(params: KeywordServiceParams): Promise<UnifiedKeywordResult> {
  const {
    offer,
    country,
    language,
    customerId,
    refreshToken,
    accountId,
    userId,
    authType = 'oauth',
    serviceAccountId,
    minSearchVolume = 500,
    maxKeywords = 500
  } = params

  console.log('\n' + '='.repeat(60))
  console.log('🔄 统一关键词服务 v2.0 启动')
  console.log('='.repeat(60))
  console.log(`品牌: ${offer.brand}`)
  console.log(`国家: ${country}, 语言: ${language}`)
  console.log(`认证方式: ${authType}`)

  const pureBrandKeywords = getPureBrandKeywords(offer.brand)

  const results: UnifiedKeywordData[] = []
  const keywordMap = new Map<string, UnifiedKeywordData>()
  let disableSearchVolumeFilter = false
  let keywordPlannerAvailable = false
  let keywordPlannerMetricsAvailable = false

  const addToKeywordMap = (data: UnifiedKeywordData) => {
    const canonical = normalizeGoogleAdsKeyword(data.keyword)
    if (!canonical) return
    if (!keywordMap.has(canonical)) {
      keywordMap.set(canonical, { ...data, keyword: data.keyword })
    }
  }

  // ==========================================
  // Step 1: 构建智能种子词池
  // ==========================================
  console.log('\n📍 Step 1: 构建智能种子词池')
  const smartSeeds = buildSmartSeedPool(offer)
  const brandRelatedSeeds = smartSeeds.filter(seed => containsPureBrand(seed, pureBrandKeywords))
  const seedKeywordsForPlanner = Array.from(new Set([...pureBrandKeywords, ...brandRelatedSeeds]))

  if (smartSeeds.length === 0) {
    console.log('   ⚠️ 无法构建种子词池，返回空结果')
    return { keywords: [], competitorBrands: [] }
  }

  // ==========================================
  // Step 2: Keyword Planner 查询
  // ==========================================
  console.log('\n📍 Step 2: Keyword Planner 查询')

  if (customerId && userId) {
    try {
      const keywordIdeas = await getKeywordIdeas({
        customerId,
        seedKeywords: seedKeywordsForPlanner,
        targetCountry: country,
        targetLanguage: language,
        accountId,
        userId,
        authType,
        serviceAccountId,
      })

      console.log(`   📋 Keyword Planner 返回 ${keywordIdeas.length} 个关键词建议`)
      keywordPlannerAvailable = keywordIdeas.length > 0

      // 转换为统一格式
      keywordIdeas.forEach(idea => {
        const canonical = normalizeGoogleAdsKeyword(idea.text)
        if (!canonical) return
        addToKeywordMap({
          keyword: idea.text,
          searchVolume: idea.avgMonthlySearches || 0,
          competition: idea.competition || 'UNKNOWN',
          competitionIndex: idea.competitionIndex || 0,
          lowTopPageBid: (idea.lowTopOfPageBidMicros || 0) / 1_000_000,
          highTopPageBid: (idea.highTopOfPageBidMicros || 0) / 1_000_000,
          source: 'EXPANSION',
          matchType: 'PHRASE'
        })
      })
    } catch (error: any) {
      console.error(`   ❌ Keyword Planner 查询失败:`, error.message)
    }
  } else {
    console.log('   ⚠️ 缺少 Google Ads 凭证，跳过 Keyword Planner 查询')
  }

  if (!keywordPlannerAvailable) {
    const fallbackKeywords = await expandWithoutKeywordPlanner({
      offer,
      country,
      language,
      userId
    })

    fallbackKeywords.forEach(kw => addToKeywordMap(kw))
  }

  // 添加种子词本身（确保品牌词被包含）
  const seedKeywordsToAdd = keywordPlannerAvailable
    ? pureBrandKeywords
    : Array.from(new Set([...brandRelatedSeeds, ...pureBrandKeywords]))

  for (const seed of seedKeywordsToAdd) {
    const matchType = isPureBrandKeyword(seed, pureBrandKeywords) ? 'EXACT' : 'PHRASE'
    addToKeywordMap({
      keyword: seed,
      searchVolume: 0,
      competition: 'UNKNOWN',
      competitionIndex: 0,
      lowTopPageBid: 0,
      highTopPageBid: 0,
      source: 'BRAND',
      matchType
    })
  }

  // ==========================================
  // Step 2.5: 按搜索量降序排序（关键修复：先排序再截取）
  // ==========================================
  console.log('\n📍 Step 2.5: 按搜索量降序排序')

  let allKeywords = Array.from(keywordMap.values())
  allKeywords.sort((a, b) => b.searchVolume - a.searchVolume)

  console.log(`   📊 Keyword Planner返回 ${allKeywords.length} 个关键词`)
  if (allKeywords.length > 0) {
    console.log(`   📊 排序后搜索量范围: ${allKeywords[allKeywords.length - 1]?.searchVolume || 0} - ${allKeywords[0]?.searchVolume || 0}`)
  }

  // ==========================================
  // Step 2.6: 获取精确搜索量（只对搜索量最高的前1000个）
  // ==========================================
  console.log('\n📍 Step 2.6: 获取精确搜索量（前1000个）')

  const topKeywordsForVolume = allKeywords.slice(0, 1000).map(kw => kw.keyword)

  try {
    const volumes = await getKeywordSearchVolumes(
      topKeywordsForVolume,
      country,
      language,
      userId
    )

    disableSearchVolumeFilter = volumes.some((vol: any) =>
      vol?.volumeUnavailableReason === 'DEV_TOKEN_INSUFFICIENT_ACCESS'
    )

    // 更新搜索量（只更新前1000个）
    volumes.forEach(vol => {
      const canonical = normalizeGoogleAdsKeyword(vol.keyword)
      if (!canonical) return
      const existing = keywordMap.get(canonical)
      if (existing) {
        keywordMap.set(canonical, {
          ...existing,
          searchVolume: vol.avgMonthlySearches,
          competition: vol.competition,
          competitionIndex: vol.competitionIndex,
          lowTopPageBid: vol.lowTopPageBid,
          highTopPageBid: vol.highTopPageBid,
        })
      }
    })

    console.log(`   ✅ 更新 ${volumes.length} 个关键词的精确搜索量`)

    // 🔥 关键：重新从Map生成数组，确保更新后的搜索量生效
    allKeywords = Array.from(keywordMap.values())
  } catch (error: any) {
    console.error(`   ❌ 获取精确搜索量失败:`, error.message)
    // allKeywords已在Step 2.5生成，使用Keyword Planner的初始搜索量
  }

  const topKeywordSet = new Set(
    topKeywordsForVolume
      .map(kw => normalizeGoogleAdsKeyword(kw))
      .filter(Boolean)
  )
  const brandSeedToQuery = pureBrandKeywords.filter(kw => {
    const canonical = normalizeGoogleAdsKeyword(kw)
    return canonical && !topKeywordSet.has(canonical)
  })

  if (brandSeedToQuery.length > 0 && userId) {
    try {
      const volumes = await getKeywordSearchVolumes(
        brandSeedToQuery,
        country,
        language,
        userId
      )

      if (volumes.some((vol: any) =>
        vol?.volumeUnavailableReason === 'DEV_TOKEN_INSUFFICIENT_ACCESS'
      )) {
        disableSearchVolumeFilter = true
      }
      if (volumes.length > 0 && !disableSearchVolumeFilter) {
        keywordPlannerMetricsAvailable = true
      }

      volumes.forEach(vol => {
        const canonical = normalizeGoogleAdsKeyword(vol.keyword)
        if (!canonical) return
        const existing = keywordMap.get(canonical)
        if (existing) {
          keywordMap.set(canonical, {
            ...existing,
            searchVolume: vol.avgMonthlySearches,
            competition: vol.competition,
            competitionIndex: vol.competitionIndex,
            lowTopPageBid: vol.lowTopPageBid,
            highTopPageBid: vol.highTopPageBid,
          })
        }
      })
    } catch (error: any) {
      console.warn(`   ⚠️ 品牌词搜索量查询失败:`, error.message)
    }
  }

  // ==========================================
  // Step 3: 品牌词优先 + 按搜索量降序排序
  // ==========================================
  console.log('\n📍 Step 3: 品牌词优先排序')

  // 🆕 优化2: 品牌词优先排序
  // 排序规则：1. 品牌词优先 2. 按搜索量降序
  allKeywords.sort((a, b) => {
    const aIsBrand = containsPureBrand(a.keyword, pureBrandKeywords) ? 1 : 0
    const bIsBrand = containsPureBrand(b.keyword, pureBrandKeywords) ? 1 : 0

    // 品牌词优先
    if (aIsBrand !== bIsBrand) {
      return bIsBrand - aIsBrand
    }

    // 同类型内按搜索量降序
    return b.searchVolume - a.searchVolume
  })

  // 统计品牌词数量
  const brandKeywordCount = allKeywords.filter(kw =>
    containsPureBrand(kw.keyword, pureBrandKeywords)
  ).length

  console.log(`   总关键词数: ${allKeywords.length}`)
  console.log(`   🏷️ 品牌词数量: ${brandKeywordCount}`)
  if (allKeywords.length > 0) {
    console.log(`   搜索量范围: ${allKeywords[allKeywords.length - 1].searchVolume} - ${allKeywords[0].searchVolume}`)
  }

  // ==========================================
  // Step 4: 白名单过滤
  // ==========================================
  console.log('\n📍 Step 4: 白名单过滤')

  // 🆕 P0-2优化：提取竞品品牌用于否定关键词
  const whitelistResult = filterByWhitelist(allKeywords, offer.brand)
  allKeywords = whitelistResult.filtered as UnifiedKeywordData[]
  const competitorBrands = whitelistResult.competitorBrands

  // 🔥 2026-01-02: 移除品类过滤 - 避免误杀有效关键词
  // 依赖Google Ads自动优化机制（质量得分、智能出价）淘汰不相关关键词
  console.log(`\n✅ 关键词过滤完成，共 ${allKeywords.length} 个关键词`)

  if (pureBrandKeywords.length > 0) {
    const beforeBrandFilter = allKeywords.length
    allKeywords = allKeywords.filter(kw => containsPureBrand(kw.keyword, pureBrandKeywords))
    console.log(`   🔒 品牌强制过滤: ${beforeBrandFilter} → ${allKeywords.length}`)
  }

  if (!keywordPlannerMetricsAvailable) {
    disableSearchVolumeFilter = true
  }

  // ==========================================
  // Step 5: 智能过滤
  // ==========================================
  console.log('\n📍 Step 5: 智能过滤')

  allKeywords = applySmartFilters(allKeywords, minSearchVolume, DEFAULTS.minKeywordsTarget, { disableSearchVolumeFilter, pureBrandKeywords })

  // ==========================================
  // Step 6: 智能匹配类型分配
  // ==========================================
  console.log('\n📍 Step 6: 智能匹配类型分配')

  allKeywords = assignMatchTypes(allKeywords, offer.brand)

  // ==========================================
  // 最终结果
  // ==========================================
  const finalKeywords = allKeywords.slice(0, maxKeywords)

  console.log('\n' + '='.repeat(60))
  console.log('✅ 统一关键词服务完成')
  console.log('='.repeat(60))
  console.log(`最终关键词数: ${finalKeywords.length}`)

  // 打印 Top 10
  console.log('\n📊 Top 10 关键词:')
  finalKeywords.slice(0, 10).forEach((kw, i) => {
    console.log(`   ${i + 1}. "${kw.keyword}" (${kw.searchVolume.toLocaleString()}/月, ${kw.matchType})`)
  })

  // 统计匹配类型分布
  const matchTypeCounts = finalKeywords.reduce((acc, kw) => {
    acc[kw.matchType] = (acc[kw.matchType] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  console.log('\n📊 匹配类型分布:')
  Object.entries(matchTypeCounts).forEach(([type, count]) => {
    console.log(`   ${type}: ${count}`)
  })

  // 🆕 P0-2优化：输出识别到的竞品品牌
  if (competitorBrands.length > 0) {
    console.log(`\n🏷️ 识别竞品品牌 (${competitorBrands.length}个，可用作否定关键词):`)
    competitorBrands.forEach(brand => {
      console.log(`   - ${brand}`)
    })
  }

  return {
    keywords: finalKeywords,
    competitorBrands
  }
}

// ============================================
// 向后兼容的多轮扩展函数
// ============================================

/**
 * 多轮扩展查询（保持向后兼容）
 *
 * @deprecated 建议使用 getUnifiedKeywordData 代替
 */
export async function getUnifiedKeywordDataWithMultiRounds(params: {
  baseKeywords: string[]
  country: string
  language: string
  customerId: string
  refreshToken: string
  accountId: number
  userId: number
  brandName: string
  roundSeeds: Array<{ round: number; name: string; seeds: string[] }>
}): Promise<UnifiedKeywordData[]> {
  console.log('⚠️ getUnifiedKeywordDataWithMultiRounds 已废弃，使用 getUnifiedKeywordData 代替')

  // 合并所有轮次的种子词
  const allSeeds = params.roundSeeds.flatMap(r => r.seeds)
  const uniqueSeeds = [...new Set([...params.baseKeywords, ...allSeeds])]

  // 构建简化的 offer 对象
  const offer: OfferData = {
    brand: params.brandName,
  }

  // 🆕 P0-2: 向后兼容，只返回关键词数组
  const result = await getUnifiedKeywordData({
    offer,
    country: params.country,
    language: params.language,
    customerId: params.customerId,
    refreshToken: params.refreshToken,
    accountId: params.accountId,
    userId: params.userId,
  })
  return result.keywords
}

// ============================================
// 向后兼容：获取现有关键词的搜索量
// ============================================

/**
 * 获取现有关键词列表的搜索量数据
 *
 * 用于 ad-creative-generator.ts 等场景，AI 已生成关键词列表，
 * 只需要获取这些关键词的搜索量数据。
 *
 * @param params.baseKeywords - 已有的关键词列表
 * @param params.country - 目标国家
 * @param params.language - 目标语言
 * @param params.userId - 用户ID
 * @param params.brandName - 品牌名（可选，用于匹配类型分配）
 */
export async function getKeywordVolumesForExisting(params: {
  baseKeywords: string[]
  country: string
  language: string
  userId?: number
  brandName?: string
  enableExpansion?: boolean  // 已废弃，忽略
}): Promise<UnifiedKeywordData[]> {
  const { baseKeywords, country, language, userId, brandName } = params

  if (!baseKeywords || baseKeywords.length === 0) {
    return []
  }

  console.log(`\n📊 获取 ${baseKeywords.length} 个关键词的搜索量数据`)

  try {
    // 直接使用 Historical Metrics API 获取精确搜索量
    const volumes = await getKeywordSearchVolumes(
      baseKeywords,
      country,
      language,
      userId
    )

    // 转换为 UnifiedKeywordData 格式
    const pureBrandKeywords = brandName ? getPureBrandKeywords(brandName) : []

    const results: UnifiedKeywordData[] = volumes.map(vol => {
      // 智能分配匹配类型
      let matchType: 'EXACT' | 'PHRASE' | 'BROAD' = 'PHRASE'
      if (pureBrandKeywords.length > 0 && isPureBrandKeyword(vol.keyword, pureBrandKeywords)) {
        matchType = 'EXACT'  // 纯品牌词用精准匹配
      } else if (pureBrandKeywords.length > 0 && containsPureBrand(vol.keyword, pureBrandKeywords)) {
        matchType = 'PHRASE'  // 品牌相关词用词组匹配
      } else if (vol.keyword.split(/\s+/).length <= 3) {
        matchType = 'PHRASE'  // 短词用词组匹配
      } else {
        matchType = 'PHRASE'  // 长尾词默认词组匹配，避免兜底放量
      }

      return {
        keyword: vol.keyword,
        searchVolume: vol.avgMonthlySearches,
        competition: vol.competition,
        competitionIndex: vol.competitionIndex,
        lowTopPageBid: vol.lowTopPageBid,
        highTopPageBid: vol.highTopPageBid,
        volumeUnavailableReason: vol.volumeUnavailableReason,
        source: 'BRAND' as const,
        matchType,
      }
    })

    console.log(`✅ 获取搜索量完成: ${results.length} 个关键词`)

    return results
  } catch (error: any) {
    console.error('❌ 获取关键词搜索量失败:', error.message)
    // 返回带默认搜索量的结果
    return baseKeywords.map(kw => ({
      keyword: kw,
      searchVolume: 0,
      competition: 'UNKNOWN',
      competitionIndex: 0,
      lowTopPageBid: 0,
      highTopPageBid: 0,
      source: 'BRAND' as const,
      matchType: 'PHRASE' as const,
    }))
  }
}

// ============================================
// 向后兼容：使用自定义种子词扩展关键词
// ============================================

/**
 * 使用自定义种子词扩展关键词
 *
 * 用于 ad-creative-generator.ts 多轮扩展场景，
 * 使用指定的种子词通过 Keyword Planner 获取扩展关键词。
 *
 * @param params.expansionSeeds - 种子关键词列表
 * @param params.country - 目标国家
 * @param params.language - 目标语言
 * @param params.userId - 用户ID
 * @param params.brandName - 品牌名（用于白名单过滤和匹配类型分配）
 */
export async function expandKeywordsWithSeeds(params: {
  expansionSeeds: string[]
  country: string
  language: string
  userId?: number
  brandName?: string
  pageUrl?: string
  customerId?: string
  refreshToken?: string
  accountId?: number
  clientId?: string
  clientSecret?: string
  developerToken?: string
  // 认证类型（支持服务账号模式）
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  minSearchVolume?: number
  maxKeywords?: number
  onProgress?: (info: { message: string; current?: number; total?: number }) => Promise<void> | void
}): Promise<UnifiedKeywordData[]> {
  const {
    expansionSeeds,
    country,
    language,
    userId,
    brandName,
    pageUrl,
    customerId,
    refreshToken,
    accountId,
    clientId,
    clientSecret,
    developerToken,
    authType = 'oauth',
    serviceAccountId,
    minSearchVolume = 500,
    maxKeywords = 100,
    onProgress
  } = params

  console.log(`认证方式: ${authType}`)

  if (!expansionSeeds || expansionSeeds.length === 0) {
    return []
  }

  // 🔧 优化(2025-12-26): 多词品牌名添加可用的短品牌词种子
  // 解决：当品牌名为"Wahl Professional"时，Keyword Planner只返回包含完整品牌名的关键词，
  // 无法获取"wahl detailer"、"wahl peanut"等只包含短品牌词的产品型号关键词
  let finalSeedKeywords = [...expansionSeeds]

  if (brandName && brandName.includes(' ')) {
    const pureBrandKeywords = getPureBrandKeywords(brandName)
    const shortBrand = pureBrandKeywords.find(kw => kw.split(/\s+/).length === 1)

    if (shortBrand) {
      const brandWords = normalizeGoogleAdsKeyword(brandName).split(/\s+/).filter(Boolean)
      const firstWord = brandWords[0]
      const shortLower = shortBrand.toLowerCase()

      const additionalSeeds = [
        shortBrand,
        `${shortLower} products`
      ]

      if (firstWord && firstWord === shortLower && brandWords.length > 1) {
        additionalSeeds.push(`${shortLower} ${brandWords.slice(1).join(' ')}`)
      }

      for (const seed of additionalSeeds) {
        if (!finalSeedKeywords.some(s => s.toLowerCase() === seed.toLowerCase())) {
          finalSeedKeywords.push(seed)
          console.log(`   + 短品牌词种子: "${seed}"`)
        }
      }

      console.log(`   📊 种子词增强: ${expansionSeeds.length} → ${finalSeedKeywords.length} 个`)
    }
  }

  console.log(`\n🔄 使用 ${finalSeedKeywords.length} 个种子词扩展关键词`)
  finalSeedKeywords.forEach((seed, i) => console.log(`   ${i + 1}. "${seed}"`))

  const keywordMap = new Map<string, UnifiedKeywordData>()

  try {
    // 1. 使用 Keyword Planner 获取扩展关键词
    if (customerId && userId) {
      const keywordIdeas = await getKeywordIdeas({
        customerId,
        seedKeywords: finalSeedKeywords,  // 使用增强后的种子词
        pageUrl,
        targetCountry: country,
        targetLanguage: language,
        userId,
        accountId,
        authType,
        serviceAccountId,
      })

      console.log(`   📋 Keyword Planner 返回 ${keywordIdeas.length} 个关键词建议`)

      keywordIdeas.forEach(idea => {
        const canonical = normalizeGoogleAdsKeyword(idea.text)
        if (!canonical) return
        if (!keywordMap.has(canonical)) {
          keywordMap.set(canonical, {
            keyword: idea.text,
            searchVolume: idea.avgMonthlySearches || 0,
            competition: idea.competition || 'UNKNOWN',
            competitionIndex: idea.competitionIndex || 0,
            lowTopPageBid: (idea.lowTopOfPageBidMicros || 0) / 1_000_000,
            highTopPageBid: (idea.highTopOfPageBidMicros || 0) / 1_000_000,
            source: 'EXPANSION',
            matchType: 'PHRASE'
          })
        }
      })
    }

    // 2. 按搜索量降序排序（关键修复：先排序再截取）
    let results = Array.from(keywordMap.values())
    results.sort((a, b) => b.searchVolume - a.searchVolume)

    console.log(`   📊 扩展关键词排序: ${results.length} 个`)
    if (results.length > 0) {
      console.log(`   📊 搜索量范围: ${results[results.length - 1]?.searchVolume || 0} - ${results[0]?.searchVolume || 0}`)
    }

    // 3. 获取精确搜索量（分批查询所有关键词）
    const BATCH_SIZE = 1000
    const totalKeywords = results.length
    console.log(`   📊 准备查询 ${totalKeywords} 个关键词的精确搜索量`)

    let disableSearchVolumeFilter = false
    // 🔧 修复(2026-01-22): 跟踪已验证的关键词，防止使用 Keyword Ideas 的估算值
    const verifiedKeywords = new Set<string>()

    if (totalKeywords > 0) {
      // 分批处理，每批最多1000个关键词
      const totalOuterBatches = Math.ceil(results.length / BATCH_SIZE)
      for (let i = 0; i < results.length; i += BATCH_SIZE) {
        const batch = results.slice(i, i + BATCH_SIZE)
        const batchKeywords = batch.map(kw => kw.keyword)

        const outerBatchIndex = Math.floor(i / BATCH_SIZE) + 1
        try {
          await onProgress?.({
            message: `精确搜索量批次 ${outerBatchIndex}/${totalOuterBatches}`,
            current: outerBatchIndex,
            total: totalOuterBatches
          })
        } catch {}

        console.log(`   📊 查询批次 ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(totalKeywords / BATCH_SIZE)}: ${batchKeywords.length} 个关键词`)

        try {
          const volumes = await getKeywordSearchVolumes(
            batchKeywords,
            country,
            language,
            userId,
            undefined,
            undefined,
            onProgress
              ? (info: { message: string; current?: number; total?: number }) =>
                  onProgress({
                    message: `精确搜索量 ${outerBatchIndex}/${totalOuterBatches} · ${info.message}`,
                    current: info.current,
                    total: info.total
                  })
              : undefined
          )

          if (volumes.some((vol: any) =>
            vol?.volumeUnavailableReason === 'DEV_TOKEN_INSUFFICIENT_ACCESS'
          )) {
            disableSearchVolumeFilter = true
          }

          volumes.forEach(vol => {
          const canonical = normalizeGoogleAdsKeyword(vol.keyword)
          if (!canonical) return
          const existing = keywordMap.get(canonical)
          if (existing) {
            // 🔧 修复(2026-01-22): 标记为已验证
            verifiedKeywords.add(canonical)
              keywordMap.set(canonical, {
                ...existing,
                searchVolume: vol.avgMonthlySearches,
                competition: vol.competition,
                competitionIndex: vol.competitionIndex,
                lowTopPageBid: vol.lowTopPageBid,
                highTopPageBid: vol.highTopPageBid,
              })
            }
          })
        } catch (batchError: any) {
          console.warn(`   ⚠️ 批次 ${Math.floor(i / BATCH_SIZE) + 1} 查询失败，继续处理下一批:`, batchError.message)
        }
      }

      console.log(`   ✅ 所有关键词搜索量查询完成`)

      // 🔧 修复(2026-01-22): 对于未被验证的关键词，将搜索量设为 0
      // 这些关键词使用的是 Keyword Ideas 的估算值，而非 Historical Metrics 的真实值
      if (!disableSearchVolumeFilter) {
        let unverifiedCount = 0
        for (const [canonical, kw] of keywordMap) {
          if (!verifiedKeywords.has(canonical) && kw.searchVolume > 0) {
            keywordMap.set(canonical, {
              ...kw,
              searchVolume: 0,  // 重置为 0，因为没有真实搜索量数据
            })
            unverifiedCount++
          }
        }
        if (unverifiedCount > 0) {
          console.log(`   ⚠️ 重置了 ${unverifiedCount} 个未验证关键词的搜索量（Keyword Ideas 估算值 → 0）`)
        }
      }

      // 重新生成数组，确保更新后的搜索量生效
      results = Array.from(keywordMap.values())
    }

    // 4. 再次按搜索量降序排序
    results.sort((a, b) => b.searchVolume - a.searchVolume)

    // 白名单过滤（如果有品牌名）
    if (brandName) {
      results = filterByWhitelistSimple(results, brandName)
    }

    // 搜索量过滤
    // 🔧 修复(2025-12-26): 搜索量不可用（服务账号 / developer token 无 Basic access）时跳过过滤
    if (disableSearchVolumeFilter) {
      console.log('⚠️ 搜索量数据不可用（可能是服务账号或 developer token 无 Basic/Standard access），跳过搜索量过滤')
    } else {
      const pureBrandKeywords = brandName ? getPureBrandKeywords(brandName) : []
      const hasAnyVolume = results.some(kw => kw.searchVolume > 0)
      if (hasAnyVolume) {
        results = results.filter(kw => {
          if (pureBrandKeywords.length > 0 && isPureBrandKeyword(kw.keyword, pureBrandKeywords)) {
            return true
          }
          return kw.searchVolume >= minSearchVolume
        })
      } else {
        console.log('⚠️ 所有关键词搜索量为0（可能是API未返回数据），跳过搜索量过滤')
      }
    }

    // 智能匹配类型分配
    if (brandName) {
      results = assignMatchTypes(results, brandName)
    }

    // 限制数量
    results = results.slice(0, maxKeywords)

    console.log(`✅ 扩展关键词完成: ${results.length} 个关键词`)

    return results
  } catch (error: any) {
    console.error('❌ 扩展关键词失败:', error.message)
    return []
  }
}

// ============================================
// 🆕 通用词提取（从已生成的关键词中提取）
// ============================================

/**
 * 从已生成的关键词中提取高价值通用词
 *
 * 用途：从Keyword Planner API返回的混合关键词中提取纯通用词（不含品牌名）
 * 策略：
 * 1. 过滤掉所有含品牌名的词（包括自身品牌和竞品）
 * 2. 只保留搜索量 > 10000 的高价值词
 * 3. 过滤掉信息查询词（review, tutorial等）
 * 4. 按搜索量排序
 *
 * 优势：
 * - 无需额外API调用，直接复用现有数据
 * - 通用方案，对所有品牌都适用
 * - 自动化提取，无需维护词库
 *
 * @param allKeywords Keyword Planner返回的所有关键词
 * @param brandName 自身品牌名
 * @param competitorBrands 已识别的竞品品牌
 * @returns 高价值通用词列表（搜索量>10000）
 */
export function extractGenericHighValueKeywords(
  allKeywords: any[], // Accept any keyword data with keyword and searchVolume properties
  brandName: string,
  competitorBrands: string[] = []
): any[] {
  console.log(`\n🆕 通用词提取 - 从已生成关键词中提取高价值通用词`)
  console.log(`================================`)

  const brandLower = brandName.toLowerCase()

  // 步骤1：过滤掉所有含品牌名的词
  console.log(`📌 步骤1: 排除含品牌名的词`)

  const allBrands = [brandName, ...competitorBrands]
  const beforeBrandFilter = allKeywords.length

  let genericKeywords = allKeywords.filter(kw => {
    const kwLower = kw.keyword.toLowerCase()
    // 检查是否含有任何品牌名（使用单词边界匹配）
    return !allBrands.some(brand => {
      const brandPattern = new RegExp(`\\b${escapeRegex(brand.toLowerCase())}\\b`, 'i')
      return brandPattern.test(kwLower)
    })
  })

  const brandFiltered = beforeBrandFilter - genericKeywords.length
  console.log(`   排除的品牌词: ${brandFiltered}`)
  console.log(`   保留的非品牌词: ${genericKeywords.length}`)

  // 步骤2：只保留搜索量 > 10000 的高价值词
  console.log(`\n📌 步骤2: 高价值词过滤 (搜索量 > 10,000)`)

  const beforeVolumeFilter = genericKeywords.length
  // 🔧 修复(2025-12-26): 如果所有关键词搜索量都为0（服务账号模式），跳过搜索量过滤
  const hasAnyVolume = genericKeywords.some(kw => kw.searchVolume > 0)
  if (hasAnyVolume) {
    genericKeywords = genericKeywords.filter(kw => kw.searchVolume > 10000)
  } else {
    console.log('   ⚠️ 所有关键词搜索量为0（可能是服务账号模式），跳过搜索量过滤')
  }

  const volumeFiltered = beforeVolumeFilter - genericKeywords.length
  console.log(`   搜索量<10000的词: ${volumeFiltered}`)
  console.log(`   保留的高价值词: ${genericKeywords.length}`)

  if (genericKeywords.length === 0) {
    console.warn(`   ⚠️ 没有搜索量>10000的通用词`)
    return []
  }

  // 步骤3：过滤掉信息查询词
  console.log(`\n📌 步骤3: 排除低购买意图词`)

  const RESEARCH_INTENT_PATTERNS = [
    'review', 'reviews', 'rating', 'vs', 'versus', 'comparison', 'compare',
    'alternative', 'alternatives', 'how to', 'what is', 'guide', 'tutorial',
    'reddit', 'forum', 'blog', 'article', 'repair', 'troubleshoot',
    'corporation', 'company', 'official website', 'headquarters', 'about us',
    'contact', 'customer service', 'support'
  ]

  const beforeIntentFilter = genericKeywords.length
  genericKeywords = genericKeywords.filter(kw => {
    const kwLower = kw.keyword.toLowerCase()
    return !RESEARCH_INTENT_PATTERNS.some(pattern => kwLower.includes(pattern))
  })

  const intentFiltered = beforeIntentFilter - genericKeywords.length
  console.log(`   排除的低意图词: ${intentFiltered}`)
  console.log(`   保留的高意图词: ${genericKeywords.length}`)

  // 步骤4：按搜索量排序
  genericKeywords.sort((a, b) => b.searchVolume - a.searchVolume)

  console.log(`\n✅ 通用词提取完成: ${genericKeywords.length} 个高价值词`)
  if (genericKeywords.length > 0) {
    console.log(`   Top 5:`)
    genericKeywords.slice(0, 5).forEach((kw, i) => {
      console.log(`   ${i + 1}. "${kw.keyword}" (${kw.searchVolume.toLocaleString()}/月)`)
    })
  }

  return genericKeywords
}
