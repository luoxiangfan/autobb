/**
 * Offer 级关键词池服务 v1.0
 *
 * 核心功能：
 * 1. 生成 Offer 级关键词池（一次生成多次复用）
 * 2. 纯品牌词共享 + 语义分桶独占
 * 3. AI 语义聚类（品牌商品锚点/商品需求场景/功能规格）
 * 4. 支持 3 个差异化创意生成（品牌意图 / 商品型号/产品族意图 / 商品需求意图）
 *
 * 关键词分层策略：
 * - 共享层：纯品牌词（仅品牌名本身，如 "eufy"）
 * - 独占层：语义分桶（内部 raw buckets，供 A/B/D 创意槽位重组）
 *
 * @see docs/Offer 级广告创意优化方案.md
 */

import { getDatabase, type DatabaseType } from './db'
import { generateContent } from './gemini'
import { repairJsonText } from './ai-json'
import { loadPrompt } from './prompt-loader'
import { findOfferById, type Offer } from './offers'
import { recordTokenUsage, estimateTokenCost } from './ai-token-tracker'
import { getUserAuthType } from './google-ads-oauth'
import {
  extractVerifiedKeywordSourcePool,
  type UnifiedKeywordData,
} from './unified-keyword-service'
import {
  filterKeywordQuality,
  generateFilterReport,
  containsPureBrand,
  getPureBrandKeywords,
  isPureBrandKeyword as isPureBrandKeywordInternal,
  calculateSearchVolumeThreshold,
  detectPlatformsInKeyword,
  extractPlatformFromUrl,
} from './keyword-quality-filter'
import { getMinContextTokenMatchesForKeywordQualityFilter } from './keyword-context-filter'
import { normalizeGoogleAdsKeyword } from './google-ads-keyword-normalizer'
import { isInvalidKeyword } from './keyword-invalid-filter'
import { getBrandCoreKeywords, refreshBrandCoreKeywordCache, updateBrandCoreKeywordSearchVolumes } from './brand-core-keywords'
import { getLanguageName, normalizeCountryCode, normalizeLanguageCode } from './language-country-codes'
import { DEFAULTS } from './keyword-constants'
import { classifyKeywordIntent } from './keyword-intent'
import { parseJsonField, toDbJsonArrayField } from './json-field'
import { analyzeKeywordLanguageCompatibility } from './keyword-validity'
import {
  deriveCanonicalCreativeType,
  getCreativeTypeForBucketSlot,
  hasModelAnchorEvidence,
  mapCreativeTypeToBucketSlot,
  normalizeCanonicalCreativeType,
  normalizeCreativeBucketSlot,
  type CanonicalCreativeType,
} from './creative-type'
import { resolveOfferLinkType } from './offer-link-type'
import { filterCreativeKeywordsByOfferContextDetailed } from './creative-keyword-context-filter'
import {
  buildProductModelFamilyContext,
  buildProductModelFamilyFallbackKeywords,
  filterKeywordObjectsByProductModelFamily,
  MODEL_INTENT_MIN_KEYWORD_FLOOR,
} from './model-intent-family-filter'
import {
  getKeywordSourcePriorityScore as getUnifiedKeywordSourcePriorityScore,
  getKeywordSourcePriorityScoreFromInput,
} from './creative-keyword-source-priority'
import {
  createPlannerNonBrandPolicy,
  type PlannerDecision,
  type PlannerNonBrandPolicy,
} from './planner-non-brand-policy'

const KEYWORD_CLUSTERING_MAX_OUTPUT_TOKENS = 16384
const KEYWORD_CLUSTERING_TIMEOUT_MS = 90000
const KEYWORD_CLUSTERING_INPUT_LIMIT = 500
const KEYWORD_CLUSTERING_TRUNCATION_MARGIN = 32
const KEYWORD_CLUSTERING_MAX_SPLIT_DEPTH = 3
const KEYWORD_CLUSTERING_MIN_SPLIT_KEYWORDS = 8
const MIN_NON_BRAND_KEYWORDS_PER_PRODUCT_BUCKET = 4
const MIN_NON_BRAND_KEYWORDS_PER_STORE_BUCKET = 3
const SEED_MAX_WORD_COUNT = 8
const SEED_INFO_QUERY_PATTERNS = [
  'meaning', 'definition', 'what is', 'wiki', 'wikipedia',
  'how to', 'tutorial', 'guide', 'manual', 'instructions',
  'series', 'episode', 'netflix', 'streaming',
  'download', 'software', 'app', 'apk', 'pdf', 'ebook',
  'gif', 'meme', 'emoji', 'sticker', 'drawing', 'image', 'images',
  'logo', 'png', 'jpg', 'jpeg', 'svg', 'icon', 'clipart', 'wallpaper',
  'size chart', 'size guide', 'sizing',
]

type GeminiGenerateParams = Parameters<typeof generateContent>[0]
type GeminiGenerateResult = Awaited<ReturnType<typeof generateContent>>
type KeywordPoolProgressReporter = (info: {
  phase?: 'seed-volume' | 'expand-round' | 'volume-batch' | 'service-step' | 'filter' | 'cluster' | 'save'
  message: string
  current?: number
  total?: number
}) => Promise<void> | void

function isGeminiTimeoutError(error: unknown): boolean {
  if (!error) return false
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message?: string }).message)
    : String(error)
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: string }).code)
    : ''
  return message.includes('timeout') || code === 'ECONNABORTED'
}

function extractHttpStatusFromError(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null

  const responseStatus = (error as any)?.response?.status
  if (typeof responseStatus === 'number' && responseStatus >= 400 && responseStatus <= 599) {
    return responseStatus
  }

  const message = String((error as any)?.message || '')
  const bracketMatch = message.match(/\((\d{3})\)/)
  if (bracketMatch) {
    const parsed = Number.parseInt(bracketMatch[1], 10)
    if (Number.isFinite(parsed) && parsed >= 400 && parsed <= 599) {
      return parsed
    }
  }

  const httpMatch = message.match(/HTTP\s*(\d{3})/i)
  if (httpMatch) {
    const parsed = Number.parseInt(httpMatch[1], 10)
    if (Number.isFinite(parsed) && parsed >= 400 && parsed <= 599) {
      return parsed
    }
  }

  return null
}

function isTransientClusteringMessage(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('high demand') ||
    lower.includes('overloaded') ||
    lower.includes('resource_exhausted') ||
    lower.includes('resource exhausted') ||
    lower.includes('try again later') ||
    lower.includes('temporarily unavailable') ||
    lower.includes('service unavailable') ||
    lower.includes('gateway timeout') ||
    lower.includes('bad gateway') ||
    lower.includes('too many requests') ||
    lower.includes('rate limit') ||
    lower.includes('稍后重试') ||
    lower.includes('服务不可用') ||
    lower.includes('系统繁忙')
  )
}

function isRetryableClusteringError(error: unknown): boolean {
  if (!error) return false
  if (isGeminiTimeoutError(error)) return true

  const status = extractHttpStatusFromError(error)
  if (status === 408 || status === 425 || status === 429 || (status !== null && status >= 500)) {
    return true
  }

  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: string }).code || '').toUpperCase()
    : ''
  if (['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'ECONNREFUSED'].includes(code)) {
    return true
  }

  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message?: string }).message || '')
    : String(error)
  return isTransientClusteringMessage(message)
}

function shouldUseDeterministicClusteringFallback(error: unknown): boolean {
  if (!error) return false

  const status = extractHttpStatusFromError(error)
  if (status !== null) {
    if ([401, 402, 403, 408, 425, 429].includes(status) || status >= 500) {
      return true
    }
  }

  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: string }).code || '').toUpperCase()
    : ''
  if ([
    'ECONNABORTED',
    'ETIMEDOUT',
    'ECONNRESET',
    'EPIPE',
    'ECONNREFUSED',
    'GEMINI_DAILY_QUOTA_EXHAUSTED',
  ].includes(code)) {
    return true
  }

  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message?: string }).message || '')
    : String(error)
  const lower = message.toLowerCase()
  return (
    lower.includes('gemini api调用失败')
    || lower.includes('resource exhausted')
    || lower.includes('quota')
    || lower.includes('forbidden')
    || lower.includes('payment required')
    || lower.includes('cloudflare')
    || lower.includes('rate limit')
    || lower.includes('too many requests')
    || lower.includes('gateway timeout')
    || lower.includes('service unavailable')
    || lower.includes('timeout')
    || lower.includes('overloaded')
    || lower.includes('high demand')
  )
}

function buildDeterministicProductBuckets(keywords: string[]): KeywordBuckets {
  const buckets = createEmptyBuckets()
  const normalized = normalizeKeywordsForBuckets(keywords)
  const featurePattern =
    /\b(review|reviews|rating|ratings|compare|comparison|vs|alternative|features?|spec|specs|size|weight|battery|wireless|manual|guide|how|best|top)\b/i
  const modelPattern =
    /\b([a-z]{1,4}\d{1,4}[a-z0-9-]*|model|series|version|gen|pro|max|ultra|mini)\b/i

  for (const keyword of normalized) {
    if (GLOBAL_CORE_PROMO_PRICE_PATTERNS.test(keyword)) {
      buckets.bucketD.keywords.push(keyword)
    } else if (GLOBAL_CORE_MODEL_PATTERNS.test(keyword) || modelPattern.test(keyword)) {
      buckets.bucketA.keywords.push(keyword)
    } else if (featurePattern.test(keyword)) {
      buckets.bucketC.keywords.push(keyword)
    } else {
      buckets.bucketB.keywords.push(keyword)
    }
  }

  if (normalized.length >= 4) {
    const entries: Array<{ key: 'A' | 'B' | 'C' | 'D'; list: string[] }> = [
      { key: 'A', list: buckets.bucketA.keywords },
      { key: 'B', list: buckets.bucketB.keywords },
      { key: 'C', list: buckets.bucketC.keywords },
      { key: 'D', list: buckets.bucketD.keywords },
    ]

    for (const target of entries) {
      if (target.list.length > 0) continue

      const donor = entries
        .filter(entry => entry.key !== target.key && entry.list.length > 1)
        .sort((a, b) => b.list.length - a.list.length)[0]
      if (!donor) continue

      const moved = donor.list.pop()
      if (moved) target.list.push(moved)
    }
  }

  recalculateBucketStatistics(buckets)
  return buckets
}

function buildDeterministicStoreBuckets(keywords: string[]): StoreKeywordBuckets {
  const buckets = createEmptyStoreBuckets()
  const normalized = normalizeKeywordsForBuckets(keywords)
  const allowed = new Set(normalized.map(item => item.toLowerCase()))

  buckets.bucketS.keywords = [...normalized]
  redistributeStoreBucketsFromS(buckets, normalized)
  applyStoreBucketPostProcessing(buckets)
  filterBucketsToAllowedKeywords(buckets, allowed)
  return buckets
}

function buildDeterministicClusteringFallback(params: {
  keywords: string[]
  pageType: 'product' | 'store'
  error: unknown
  scope: 'direct' | 'batch'
}): KeywordBuckets | StoreKeywordBuckets {
  const message = typeof params.error === 'object' && params.error !== null && 'message' in params.error
    ? String((params.error as { message?: string }).message || '未知错误')
    : String(params.error || '未知错误')
  const status = extractHttpStatusFromError(params.error)
  const statusText = status ? `HTTP ${status}` : '无HTTP状态'

  console.warn(
    `⚠️ AI语义聚类不可用（${params.scope}, ${statusText}），启用确定性分桶降级。原因: ${message.slice(0, 200)}`
  )

  if (params.pageType === 'store') {
    return buildDeterministicStoreBuckets(params.keywords)
  }
  return buildDeterministicProductBuckets(params.keywords)
}

async function runKeywordClustering(
  params: GeminiGenerateParams,
  userId: number
): Promise<GeminiGenerateResult> {
  const baseParams: GeminiGenerateParams = {
    ...params,
    maxOutputTokens: KEYWORD_CLUSTERING_MAX_OUTPUT_TOKENS,
    timeoutMs: KEYWORD_CLUSTERING_TIMEOUT_MS,
  }

  try {
    return await generateContent(baseParams, userId)
  } catch (error) {
    if (!isGeminiTimeoutError(error)) {
      throw error
    }
    const message = typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: string }).message)
      : String(error)
    console.warn(`⚠️ keyword_clustering 超时 (${KEYWORD_CLUSTERING_TIMEOUT_MS}ms)，按用户当前模型重试...`)
    console.warn(`   错误: ${message}`)
    return await generateContent({
      ...baseParams,
      enableAutoModelSelection: false,
    }, userId)
  }
}

function appendKeywordClusteringOutputGuardrails(prompt: string): string {
  const guardrails = [
    'CRITICAL OUTPUT RULES:',
    '- Return ONLY one valid JSON object. No markdown, no prose, no explanation.',
    '- Keep all description fields concise (single short sentence).',
    '- Do not invent new keywords. Use only keywords provided in input.',
    '- Each input keyword must appear at most once across all buckets.',
    '- If uncertain, keep keyword array empty instead of adding extra text.',
  ].join('\n')

  return `${prompt}\n\n${guardrails}`
}

function extractFirstJsonObject(text: string): string | null {
  const firstBrace = text.indexOf('{')
  if (firstBrace === -1) return null

  let depth = 0
  let inString = false
  let escaped = false
  let objectStart = -1

  for (let i = firstBrace; i < text.length; i++) {
    const char = text[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') {
      if (depth === 0) {
        objectStart = i
      }
      depth += 1
      continue
    }

    if (char === '}') {
      depth -= 1
      if (depth === 0 && objectStart >= 0) {
        return text.slice(objectStart, i + 1)
      }
    }
  }

  return null
}

function parseKeywordClusteringJson(responseText: string): any {
  const jsonCandidate = extractFirstJsonObject(responseText)
  if (!jsonCandidate) {
    throw new Error('AI 返回的数据格式无效：未找到JSON对象')
  }

  const cleanedJson = repairJsonText(jsonCandidate)
  return JSON.parse(cleanedJson)
}

function isLikelyKeywordClusteringTruncated(response: GeminiGenerateResult): boolean {
  const outputTokens = response.usage?.outputTokens || 0
  if (outputTokens <= 0) return false
  return outputTokens >= (KEYWORD_CLUSTERING_MAX_OUTPUT_TOKENS - KEYWORD_CLUSTERING_TRUNCATION_MARGIN)
}

function splitKeywordsForRetry(keywords: string[]): [string[], string[]] {
  const mid = Math.ceil(keywords.length / 2)
  return [keywords.slice(0, mid), keywords.slice(mid)]
}

type OfferPageTypeSource = Pick<Offer, 'page_type' | 'scraped_data'>

function resolveOfferPageType(offer: OfferPageTypeSource): 'store' | 'product' {
  return resolveOfferLinkType({
    page_type: offer.page_type,
    scraped_data: offer.scraped_data,
  })
}

function isGenericRetailKeyword(keyword: string): boolean {
  if (!keyword) return false
  const normalized = keyword.toLowerCase()
  const patterns = [
    /\bnear\s+me\b/i,
    /\bnear\s+to\s+me\b/i,
    /\bnear\s+by\s+me\b/i,
    /\bclosest\b/i,
    /\bnearest\b/i,
    /\bstore(s)?\b/i,
    /\bshop(s)?\b/i,
    /\boutlet(s)?\b/i,
    /\bwarehouse\b/i,
    /\bonline\b/i,
    /\bbuy\b/i,
    /\bsale\b/i,
    /\bdiscount\b/i,
    /\bdeal(s)?\b/i,
    /\bclearance\b/i
  ]
  return patterns.some(pattern => pattern.test(normalized))
}

function getKeywordSourcePriority(source: string | undefined): number {
  // 该函数在本文件排序中使用“升序比较（值越小越靠前）”。
  // 统一优先级配置使用“分值越大越可信”，此处做投影以保持既有排序语义不变。
  const sourceScore = getUnifiedKeywordSourcePriorityScore(source)
  if (!Number.isFinite(sourceScore) || sourceScore <= 0) return 999
  return 1000 - sourceScore
}

function getKeywordSourcePriorityForPoolItem(item: Pick<PoolKeywordData, 'source'> & {
  sourceType?: string
}): number {
  const sourceScore = getKeywordSourcePriorityScoreFromInput({
    source: item.source,
    sourceType: item.sourceType,
  })
  if (!Number.isFinite(sourceScore) || sourceScore <= 0) return 999
  return 1000 - sourceScore
}

function normalizeMatchTypePriority(matchType: string | undefined): number {
  const normalized = String(matchType || '').trim().toUpperCase()
  if (normalized === 'EXACT') return 3
  if (normalized === 'PHRASE') return 2
  if (normalized === 'BROAD') return 1
  return 0
}

function prioritizeKeywordsForClustering(keywords: PoolKeywordData[]): PoolKeywordData[] {
  return [...keywords].sort((a, b) => {
    const sourceRank = getKeywordSourcePriority(a.source) - getKeywordSourcePriority(b.source)
    if (sourceRank !== 0) return sourceRank

    const relevanceScoreDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0)
    if (relevanceScoreDiff !== 0) return relevanceScoreDiff

    const volumeDiff = (b.searchVolume || 0) - (a.searchVolume || 0)
    if (volumeDiff !== 0) return volumeDiff

    const lengthDiff = b.keyword.length - a.keyword.length
    if (lengthDiff !== 0) return lengthDiff

    return a.keyword.localeCompare(b.keyword)
  })
}

function prioritizeBucketKeywords(keywords: PoolKeywordData[]): PoolKeywordData[] {
  return [...keywords].sort((a, b) => {
    const sourceRank = getKeywordSourcePriority(a.source) - getKeywordSourcePriority(b.source)
    if (sourceRank !== 0) return sourceRank

    const relevanceScoreDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0)
    if (relevanceScoreDiff !== 0) return relevanceScoreDiff

    const genericRank = Number(isGenericRetailKeyword(a.keyword)) - Number(isGenericRetailKeyword(b.keyword))
    if (genericRank !== 0) return genericRank

    const volumeDiff = (b.searchVolume || 0) - (a.searchVolume || 0)
    if (volumeDiff !== 0) return volumeDiff

    return b.keyword.length - a.keyword.length
  })
}

function ensureMinimumBucketKeywords(params: {
  bucketEntries: Array<{ name: string; keywords: PoolKeywordData[] }>
  reserveKeywords: PoolKeywordData[]
  minPerBucket: number
}): Record<string, number> {
  const { bucketEntries, reserveKeywords, minPerBucket } = params
  const additions: Record<string, number> = {}

  if (minPerBucket <= 0 || bucketEntries.length === 0 || reserveKeywords.length === 0) {
    return additions
  }

  const prioritizedReserve = prioritizeBucketKeywords(reserveKeywords)
  const usedAcrossBuckets = new Set<string>()

  for (const { keywords } of bucketEntries) {
    for (const item of keywords) {
      const normalized = normalizeGoogleAdsKeyword(item.keyword)
      if (!normalized) continue
      usedAcrossBuckets.add(normalized)
    }
  }

  for (const entry of bucketEntries) {
    additions[entry.name] = 0
    if (entry.keywords.length >= minPerBucket) continue

    for (const candidate of prioritizedReserve) {
      if (entry.keywords.length >= minPerBucket) break

      const normalized = normalizeGoogleAdsKeyword(candidate.keyword)
      if (!normalized || usedAcrossBuckets.has(normalized)) continue

      entry.keywords.push(candidate)
      usedAcrossBuckets.add(normalized)
      additions[entry.name] += 1
    }
  }

  return additions
}

function isSearchVolumeUnavailableReason(reason: unknown): boolean {
  return reason === 'DEV_TOKEN_INSUFFICIENT_ACCESS'
}

function hasSearchVolumeUnavailableFlag(
  keywords: Array<{ volumeUnavailableReason?: unknown }>
): boolean {
  return keywords.some((kw) => isSearchVolumeUnavailableReason(kw?.volumeUnavailableReason))
}

function hasCommercialIntentForProductRelaxedRetention(
  keyword: string,
  language: string
): boolean {
  if (!keyword) return false
  const intent = classifyKeywordIntent(keyword, { language })
  if (intent.hardNegative) return false
  if (intent.intent === 'TRANSACTIONAL' || intent.intent === 'COMMERCIAL') return true
  return isHighIntentGlobalCoreKeyword(keyword)
}

function prioritizeBrandKeywordsFirst(
  keywords: PoolKeywordData[],
  pureBrandKeywords: string[]
): PoolKeywordData[] {
  if (keywords.length <= 1 || pureBrandKeywords.length === 0) return keywords

  const brandKeywords: PoolKeywordData[] = []
  const nonBrandKeywords: PoolKeywordData[] = []

  for (const kw of keywords) {
    if (isPureBrandKeywordInternal(kw.keyword, pureBrandKeywords)) {
      brandKeywords.push(kw)
    } else {
      nonBrandKeywords.push(kw)
    }
  }

  if (brandKeywords.length === 0 || nonBrandKeywords.length === 0) return keywords
  return [...brandKeywords, ...nonBrandKeywords]
}

// ============================================
// 类型定义
// ============================================

/**
 * 🆕 关键词池数据结构 - 包含完整元数据
 * 用途：存储关键词的搜索量、CPC、竞争度等数据，避免重复调用 Keyword Planner
 *
 * 🔥 2025-12-29: 新增 isPureBrand 属性用于标记纯品牌词
 */
export interface PoolKeywordData {
  keyword: string
  searchVolume: number
  competition?: string
  competitionIndex?: number
  lowTopPageBid?: number  // CPC 数据
  highTopPageBid?: number // CPC 数据
  source: string
  matchType?: 'EXACT' | 'PHRASE' | 'BROAD'
  isPureBrand?: boolean   // 🔥 2025-12-29 新增：标记是否为纯品牌词（豁免搜索量过滤）
  volumeUnavailableReason?: 'DEV_TOKEN_INSUFFICIENT_ACCESS'
  relevanceScore?: number
  qualityTier?: 'HIGH' | 'MEDIUM' | 'LOW'
  sourceType?: string
  sourceSubtype?: string
  rawSource?: string
  derivedTags?: string[]
}

/**
 * Offer 级关键词池
 * 🆕 v4.16: 支持单品链接和店铺链接的不同分桶策略
 */
export interface OfferKeywordPool {
  id: number
  offerId: number
  userId: number

  // 共享层：纯品牌词（🔥 升级为 PoolKeywordData[]）
  brandKeywords: PoolKeywordData[]

  // 独占层：语义分桶（单品链接，内部 raw buckets）- 4个桶
  bucketAKeywords: PoolKeywordData[]  // 品牌/商品锚点候选 (Brand Product Anchor)
  bucketBKeywords: PoolKeywordData[]  // 商品需求场景候选 (Demand Scenario)
  bucketCKeywords: PoolKeywordData[]  // 功能规格候选 (Feature / Spec)
  bucketDKeywords: PoolKeywordData[]  // 商品需求扩展候选 (Demand Expansion)

  // 桶意图描述（单品链接）
  bucketAIntent: string
  bucketBIntent: string
  bucketCIntent: string
  bucketDIntent: string

  // 🆕 v4.16: 店铺链接分桶（内部 raw buckets）- 5个桶
  storeBucketAKeywords: PoolKeywordData[]  // 品牌商品集合候选 (Brand Collection)
  storeBucketBKeywords: PoolKeywordData[]  // 商品需求场景候选 (Demand Scenario)
  storeBucketCKeywords: PoolKeywordData[]  // 热门商品线候选 (Hot Product Line)
  storeBucketDKeywords: PoolKeywordData[]  // 信任服务信号候选 (Trust Service)
  storeBucketSKeywords: PoolKeywordData[]  // 店铺全量覆盖候选 (Store Coverage)

  // 店铺分桶意图描述
  storeBucketAIntent: string
  storeBucketBIntent: string
  storeBucketCIntent: string
  storeBucketDIntent: string
  storeBucketSIntent: string

  // 🆕 v4.16: 链接类型标识
  linkType: 'product' | 'store' | 'both'

  // 元数据
  totalKeywords: number
  clusteringModel: string | null
  clusteringPromptVersion: string | null
  balanceScore: number | null

  createdAt: string
  updatedAt: string
}

/**
 * 关键词桶（AI 聚类结果）
 * 🔧 2025-12-24: 添加可选的 bucketS 支持店铺链接
 */
export interface KeywordBuckets {
  bucketA: {
    intent: string
    intentEn: string
    description: string
    keywords: string[]
  }
  bucketB: {
    intent: string
    intentEn: string
    description: string
    keywords: string[]
  }
  bucketC: {
    intent: string
    intentEn: string
    description: string
    keywords: string[]
  }
  bucketD: {
    intent: string
    intentEn: string
    description: string
    keywords: string[]
  }
  bucketS?: {  // 🔧 可选：店铺链接专用
    intent: string
    intentEn: string
    description: string
    keywords: string[]
  }
  statistics: {
    totalKeywords: number
    bucketACount: number
    bucketBCount: number
    bucketCCount: number
    bucketDCount: number
    bucketSCount?: number  // 🔧 可选：店铺链接专用
    balanceScore: number
  }
}

// ============================================
// 全局核心关键词补充逻辑
// ============================================

const GLOBAL_CORE_PROMO_PRICE_PATTERNS = /\b(discount|sale|deal|coupon|promo|code|offer|clearance|price|cost|cheap|affordable|budget)\b/i
const GLOBAL_CORE_MODEL_PATTERNS = /\b(s\d+|q\d+|s7|s8|q5|q7|max|ultra|pro(?!\s*store))\b/i
const GLOBAL_CORE_REVIEW_PATTERNS = /\b(review|rating|testimonial|feedback|comment|opinion)\b/i
const GLOBAL_CORE_TRUST_PATTERNS =
  /\b(review|reviews|rating|ratings|testimonial|testimonials|feedback|support|customer\s*service|warranty|guarantee|refund|return|secure|security|privacy|trusted|trust)\b/i
const GLOBAL_CORE_GEO_PATTERNS = /\b(locations?|near\s+me|delivery|shipping|local|store\s+finder)\b/i
const GLOBAL_CORE_TRANSACTIONAL_PATTERNS =
  /\b(buy|best|price|sale|deal|discount|coupon|promo|offer|shop|official|professional)\b/i
const GLOBAL_CORE_SEARCH_VOLUME_TTL_DAYS = 30
const GLOBAL_CORE_BRAND_PREFIX_MIN_VOLUME = 100

const GLOBAL_CORE_NON_ANCHOR_TOKENS = new Set([
  'best', 'buy', 'sale', 'deal', 'discount', 'coupon', 'promo', 'offer', 'price', 'cost', 'cheap',
  'affordable', 'official', 'shop', 'store', 'online', 'home', 'kitchen', 'professional', 'high',
  'speed', 'small', 'mini', 'portable', 'personal', 'top', 'new', 'quality', 'premium', 'amazon',
  'for', 'with', 'and', 'the', 'a', 'an',
])

function normalizeGlobalCoreToken(token: string): string {
  const raw = String(token || '').toLowerCase().trim()
  if (!raw) return ''
  if (raw.endsWith('ies') && raw.length > 4) return `${raw.slice(0, -3)}y`
  if (raw.endsWith('es') && raw.length > 4) return raw.slice(0, -2)
  if (raw.endsWith('s') && raw.length > 3 && !raw.endsWith('ss')) return raw.slice(0, -1)
  return raw
}

function tokenizeGlobalCore(text: string): string[] {
  const normalized = normalizeGoogleAdsKeyword(text)
  if (!normalized) return []
  return normalized
    .split(/\s+/)
    .map(normalizeGlobalCoreToken)
    .filter(Boolean)
}

function buildGlobalCoreAnchorTokens(offer: Offer): Set<string> {
  const brandTokens = new Set(
    getPureBrandKeywords(offer.brand || '')
      .flatMap(item => tokenizeGlobalCore(item))
  )
  const categorySignals = extractCategorySignalsFromScrapedData(offer.scraped_data)
  const sourceTexts = [
    String(offer.category || ''),
    String(offer.product_name || ''),
    ...categorySignals,
  ]
  const tokens = new Set<string>()
  for (const text of sourceTexts) {
    for (const token of tokenizeGlobalCore(text)) {
      if (token.length < 3) continue
      if (brandTokens.has(token)) continue
      if (GLOBAL_CORE_NON_ANCHOR_TOKENS.has(token)) continue
      tokens.add(token)
    }
  }
  return tokens
}

function keywordHitsGlobalCoreAnchors(keyword: string, anchorTokens: Set<string>): boolean {
  if (anchorTokens.size === 0) return true
  const tokens = tokenizeGlobalCore(keyword)
  return tokens.some(token => anchorTokens.has(token))
}

function isHighIntentGlobalCoreKeyword(keyword: string): boolean {
  if (!keyword) return false
  if (
    GLOBAL_CORE_TRANSACTIONAL_PATTERNS.test(keyword)
    || GLOBAL_CORE_PROMO_PRICE_PATTERNS.test(keyword)
    || GLOBAL_CORE_MODEL_PATTERNS.test(keyword)
    || GLOBAL_CORE_TRUST_PATTERNS.test(keyword)
    || GLOBAL_CORE_REVIEW_PATTERNS.test(keyword)
  ) {
    return true
  }
  // 对于词组型关键词（>=2词）视为可投放意图，后续仍会受“高搜索量+品类锚点”双门禁约束。
  return tokenizeGlobalCore(keyword).length >= 2
}

export function composeGlobalCoreBrandedKeyword(keyword: string, brandName: string, maxWords: number = 5): string | null {
  const normalizedBrand = normalizeGoogleAdsKeyword(brandName)
  const normalizedKeyword = normalizeGoogleAdsKeyword(keyword)
  if (!normalizedBrand || !normalizedKeyword) return null

  const brandTokens = normalizedBrand.split(/\s+/).filter(Boolean)
  const keywordTokens = normalizedKeyword.split(/\s+/).filter(Boolean)
  if (brandTokens.length === 0 || keywordTokens.length === 0) return null

  const remainder: string[] = []
  for (let i = 0; i < keywordTokens.length;) {
    let matchesBrand = true
    for (let j = 0; j < brandTokens.length; j += 1) {
      if (keywordTokens[i + j] !== brandTokens[j]) {
        matchesBrand = false
        break
      }
    }

    if (matchesBrand) {
      i += brandTokens.length
      continue
    }

    remainder.push(keywordTokens[i])
    i += 1
  }

  const combined = [...brandTokens, ...remainder]
  if (combined.length < 2 || combined.length > maxWords) return null
  return combined.join(' ')
}

function adaptGlobalCoreKeywordsWithBrandPrefix(params: {
  offer: Offer
  keywords: PoolKeywordData[]
  enforceBrandContainment: boolean
}): {
  keywords: PoolKeywordData[]
  stats: {
    nonBrandInput: number
    brandedFromNonBrand: number
    droppedLowVolume: number
    droppedLowIntent: number
    droppedNoAnchor: number
    droppedComposeFailed: number
    droppedDuplicate: number
    highVolumeThreshold: number
  }
} {
  const { offer, keywords, enforceBrandContainment } = params
  const pureBrandKeywords = getPureBrandKeywords(offer.brand || '')
  const anchorTokens = buildGlobalCoreAnchorTokens(offer)
  const canonicalBrand = normalizeGoogleAdsKeyword(offer.brand || '')

  const nonBrandCandidates = keywords.filter(item => !containsPureBrand(item.keyword, pureBrandKeywords))
  const positiveVolumes = nonBrandCandidates
    .map(item => Number(item.searchVolume || 0))
    .filter(volume => volume > 0)
  const dynamicThreshold = positiveVolumes.length > 0
    ? Math.max(GLOBAL_CORE_BRAND_PREFIX_MIN_VOLUME, calculateSearchVolumeThreshold(positiveVolumes, GLOBAL_CORE_BRAND_PREFIX_MIN_VOLUME))
    : Number.POSITIVE_INFINITY

  const seenNorm = new Set<string>()
  const adapted: PoolKeywordData[] = []
  let brandedFromNonBrand = 0
  let droppedLowVolume = 0
  let droppedLowIntent = 0
  let droppedNoAnchor = 0
  let droppedComposeFailed = 0
  let droppedDuplicate = 0

  for (const item of keywords) {
    const originalNorm = normalizeGoogleAdsKeyword(item.keyword)
    if (!originalNorm) continue
    const hasBrand = containsPureBrand(item.keyword, pureBrandKeywords)

    const pushIfUnique = (next: PoolKeywordData): boolean => {
      const norm = normalizeGoogleAdsKeyword(next.keyword)
      if (!norm) return false
      if (seenNorm.has(norm)) return false
      seenNorm.add(norm)
      adapted.push(next)
      return true
    }

    // 品牌词直接保留（仍受后续严格过滤）
    if (hasBrand) {
      if (!pushIfUnique(item)) droppedDuplicate += 1
      continue
    }

    if (!enforceBrandContainment || !canonicalBrand || pureBrandKeywords.length === 0) {
      if (!pushIfUnique(item)) droppedDuplicate += 1
      continue
    }

    const volume = Number(item.searchVolume || 0)
    if (!(volume >= dynamicThreshold)) {
      droppedLowVolume += 1
      continue
    }

    if (!isHighIntentGlobalCoreKeyword(item.keyword)) {
      droppedLowIntent += 1
      continue
    }

    if (!keywordHitsGlobalCoreAnchors(item.keyword, anchorTokens)) {
      droppedNoAnchor += 1
      continue
    }

    const branded = composeGlobalCoreBrandedKeyword(item.keyword, canonicalBrand, 5)
    if (!branded) {
      droppedComposeFailed += 1
      continue
    }

    // 🐛 修复(2026-03-14): 品牌前置后的关键词不应继承原始搜索量
    const next: PoolKeywordData = {
      ...item,
      keyword: branded,
      source: 'GLOBAL_CORE_BRANDED',
      matchType: 'PHRASE',
      searchVolume: 0, // 品牌前置后的关键词需要重新查询真实搜索量
    }

    if (pushIfUnique(next)) {
      brandedFromNonBrand += 1
    } else {
      droppedDuplicate += 1
    }
  }

  return {
    keywords: adapted,
    stats: {
      nonBrandInput: nonBrandCandidates.length,
      brandedFromNonBrand,
      droppedLowVolume,
      droppedLowIntent,
      droppedNoAnchor,
      droppedComposeFailed,
      droppedDuplicate,
      highVolumeThreshold: Number.isFinite(dynamicThreshold) ? dynamicThreshold : -1,
    }
  }
}

function buildExistingKeywordNormSet(lists: PoolKeywordData[][]): Set<string> {
  const set = new Set<string>()
  for (const list of lists) {
    for (const kw of list) {
      const norm = normalizeGoogleAdsKeyword(kw.keyword)
      if (norm) set.add(norm)
    }
  }
  return set
}

function selectBucketForProduct(keyword: string): 'A' | 'B' | 'C' | 'D' {
  if (GLOBAL_CORE_PROMO_PRICE_PATTERNS.test(keyword)) return 'D'
  if (GLOBAL_CORE_MODEL_PATTERNS.test(keyword)) return 'A'
  return 'B'
}

function selectBucketForStore(keyword: string): 'A' | 'B' | 'C' | 'D' | 'S' {
  if (GLOBAL_CORE_PROMO_PRICE_PATTERNS.test(keyword) || GLOBAL_CORE_GEO_PATTERNS.test(keyword)) return 'S'
  if (GLOBAL_CORE_TRUST_PATTERNS.test(keyword) || GLOBAL_CORE_REVIEW_PATTERNS.test(keyword)) return 'D'
  return 'B'
}

function pushUniqueKeyword(list: string[], keyword: string): void {
  const norm = normalizeGoogleAdsKeyword(keyword)
  if (!norm) return
  const exists = list.some(item => normalizeGoogleAdsKeyword(item) === norm)
  if (!exists) list.push(keyword)
}

function buildGlobalCoreQualityFilterContext(offer: Offer): {
  categoryContext?: string
  minContextTokenMatches: number
} {
  const pageType = resolveOfferPageType(offer)
  const categorySignals = extractCategorySignalsFromScrapedData(offer.scraped_data)
  const categoryContext = [offer.category, ...categorySignals]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' ')

  return {
    categoryContext: categoryContext || undefined,
    minContextTokenMatches: getMinContextTokenMatchesForKeywordQualityFilter({
      pageType
    })
  }
}

function filterGlobalCoreKeywordsByOfferContext(params: {
  offer: Offer
  keywords: PoolKeywordData[]
  scope: 'product' | 'store'
}): PoolKeywordData[] {
  const { offer, keywords, scope } = params
  if (keywords.length === 0) return keywords

  const { categoryContext, minContextTokenMatches } = buildGlobalCoreQualityFilterContext(offer)
  const enforceBrandContainment = String(offer.brand || '').trim().length > 0
  // GLOBAL_CORE 是跨Offer聚合词源，必须启用品类相关性门禁，避免跨品类词污染创意关键词。
  const effectiveMinContextTokenMatches = Math.max(1, minContextTokenMatches)

  // 第1层：先做相关性预过滤（允许非品牌候选进入后续“品牌前置改写”）
  const preFiltered = filterKeywordQuality(keywords, {
    brandName: offer.brand,
    category: categoryContext,
    productName: offer.product_name || undefined,
    targetCountry: offer.target_country || undefined,
    targetLanguage: offer.target_language || undefined,
    productUrl: offer.final_url || offer.url || undefined,
    minWordCount: 1,
    maxWordCount: 8,
    mustContainBrand: false,
    minContextTokenMatches: effectiveMinContextTokenMatches,
  })

  // 第2层：把“高意图+高搜索量”的非品牌词改写为品牌前置词（参考 title/about 补词机制）
  const adapted = adaptGlobalCoreKeywordsWithBrandPrefix({
    offer,
    keywords: preFiltered.filtered,
    enforceBrandContainment,
  })

  // 第3层：严格收口（最终进入创意的 GLOBAL_CORE 词必须含品牌词）
  const strictFiltered = filterKeywordQuality(adapted.keywords, {
    brandName: offer.brand,
    category: categoryContext,
    productName: offer.product_name || undefined,
    targetCountry: offer.target_country || undefined,
    targetLanguage: offer.target_language || undefined,
    productUrl: offer.final_url || offer.url || undefined,
    minWordCount: 1,
    maxWordCount: 8,
    mustContainBrand: enforceBrandContainment,
    minContextTokenMatches: effectiveMinContextTokenMatches,
  })

  if (preFiltered.removed.length > 0 || strictFiltered.removed.length > 0 || adapted.stats.brandedFromNonBrand > 0) {
    const contextRemoved = strictFiltered.removed.filter(item => item.reason.includes('与商品无关')).length
    const brandRemoved = strictFiltered.removed.filter(item => item.reason.includes('不含纯品牌词')).length
    const preContextRemoved = preFiltered.removed.filter(item => item.reason.includes('与商品无关')).length
    console.log(
      `🧹 GLOBAL_CORE(${scope}) 过滤链路: ${keywords.length} → 预过滤${preFiltered.filtered.length} → 改写${adapted.keywords.length} → 收口${strictFiltered.filtered.length} ` +
      `(预过滤移除 ${preFiltered.removed.length}/上下文${preContextRemoved}; 改写 ${adapted.stats.brandedFromNonBrand} 条, 高量阈值 ${adapted.stats.highVolumeThreshold === -1 ? 'N/A' : adapted.stats.highVolumeThreshold}; ` +
      `收口移除 ${strictFiltered.removed.length}/无品牌${brandRemoved}/上下文${contextRemoved})`
    )
  }

  return strictFiltered.filtered
}

async function injectGlobalCoreKeywordsForProduct(params: {
  offer: Offer
  userId: number
  brandKeywords: PoolKeywordData[]
  bucketAData: PoolKeywordData[]
  bucketBData: PoolKeywordData[]
  bucketCData: PoolKeywordData[]
  bucketDData: PoolKeywordData[]
  statistics: { totalKeywords: number; balanceScore: number }
}): Promise<{
  bucketAData: PoolKeywordData[]
  bucketBData: PoolKeywordData[]
  bucketCData: PoolKeywordData[]
  bucketDData: PoolKeywordData[]
  statistics: { totalKeywords: number; balanceScore: number }
}> {
  const { offer, userId, brandKeywords, bucketAData, bucketBData, bucketCData, bucketDData, statistics } = params

  const coreKeywords = await getBrandCoreKeywords(
    offer.brand,
    offer.target_country,
    offer.target_language || 'en'
  )
  if (coreKeywords.length === 0) {
    return {
      bucketAData,
      bucketBData,
      bucketCData,
      bucketDData,
      statistics,
    }
  }

  const existingSet = buildExistingKeywordNormSet([
    brandKeywords,
    bucketAData,
    bucketBData,
    bucketCData,
    bucketDData,
  ])

  const addedKeywords: PoolKeywordData[] = []
  const coreCandidates: PoolKeywordData[] = []
  const candidateNormSet = new Set<string>()

  for (const core of coreKeywords) {
    const keywordText = core.keywordDisplay?.trim() || core.keywordNorm
    if (!keywordText) continue
    const keywordNorm = normalizeGoogleAdsKeyword(keywordText)
    if (!keywordNorm || isInvalidKeyword(keywordNorm)) continue
    if (candidateNormSet.has(keywordNorm)) continue
    candidateNormSet.add(keywordNorm)

    coreCandidates.push({
      keyword: keywordText,
      searchVolume: Number(core.searchVolume || 0),
      source: 'GLOBAL_CORE',
      matchType: 'PHRASE',
    })
  }

  const filteredCoreCandidates = filterGlobalCoreKeywordsByOfferContext({
    offer,
    keywords: coreCandidates,
    scope: 'product',
  })

  for (const newKeyword of filteredCoreCandidates) {
    const keywordNorm = normalizeGoogleAdsKeyword(newKeyword.keyword)
    if (!keywordNorm) continue
    if (existingSet.has(keywordNorm)) continue

    const bucket = selectBucketForProduct(newKeyword.keyword)
    if (bucket === 'A') bucketAData.push(newKeyword)
    else if (bucket === 'D') bucketDData.push(newKeyword)
    else if (bucket === 'C') bucketCData.push(newKeyword)
    else bucketBData.push(newKeyword)

    existingSet.add(keywordNorm)
    addedKeywords.push(newKeyword)
  }

  await hydrateGlobalCoreKeywordSearchVolumes(addedKeywords, offer, userId)

  const counts = [bucketAData.length, bucketBData.length, bucketCData.length, bucketDData.length]
  return {
    bucketAData,
    bucketBData,
    bucketCData,
    bucketDData,
    statistics: {
      totalKeywords: counts.reduce((a, b) => a + b, 0),
      balanceScore: calculateBalanceScore(counts),
    },
  }
}

async function injectGlobalCoreKeywordsForStore(params: {
  offer: Offer
  userId: number
  brandKeywords: PoolKeywordData[]
  storeBuckets: StoreKeywordBuckets
  bucketAData: PoolKeywordData[]
  bucketBData: PoolKeywordData[]
  bucketCData: PoolKeywordData[]
  bucketDData: PoolKeywordData[]
  bucketSData: PoolKeywordData[]
}): Promise<{
  bucketAData: PoolKeywordData[]
  bucketBData: PoolKeywordData[]
  bucketCData: PoolKeywordData[]
  bucketDData: PoolKeywordData[]
  bucketSData: PoolKeywordData[]
}> {
  const {
    offer,
    userId,
    brandKeywords,
    storeBuckets,
    bucketAData,
    bucketBData,
    bucketCData,
    bucketDData,
    bucketSData,
  } = params

  const coreKeywords = await getBrandCoreKeywords(
    offer.brand,
    offer.target_country,
    offer.target_language || 'en'
  )
  if (coreKeywords.length === 0) {
    return {
      bucketAData,
      bucketBData,
      bucketCData,
      bucketDData,
      bucketSData,
    }
  }

  const existingSet = buildExistingKeywordNormSet([
    brandKeywords,
    bucketAData,
    bucketBData,
    bucketCData,
    bucketDData,
    bucketSData,
  ])

  const addedKeywords: PoolKeywordData[] = []
  const coreCandidates: PoolKeywordData[] = []
  const candidateNormSet = new Set<string>()

  for (const core of coreKeywords) {
    const keywordText = core.keywordDisplay?.trim() || core.keywordNorm
    if (!keywordText) continue
    const keywordNorm = normalizeGoogleAdsKeyword(keywordText)
    if (!keywordNorm || isInvalidKeyword(keywordNorm)) continue
    if (candidateNormSet.has(keywordNorm)) continue
    candidateNormSet.add(keywordNorm)

    coreCandidates.push({
      keyword: keywordText,
      searchVolume: Number(core.searchVolume || 0),
      source: 'GLOBAL_CORE',
      matchType: 'PHRASE',
    })
  }

  const filteredCoreCandidates = filterGlobalCoreKeywordsByOfferContext({
    offer,
    keywords: coreCandidates,
    scope: 'store',
  })

  for (const newKeyword of filteredCoreCandidates) {
    const keywordNorm = normalizeGoogleAdsKeyword(newKeyword.keyword)
    if (!keywordNorm) continue
    if (existingSet.has(keywordNorm)) continue

    const bucket = selectBucketForStore(newKeyword.keyword)
    if (bucket === 'S') {
      bucketSData.push(newKeyword)
      pushUniqueKeyword(storeBuckets.bucketS.keywords, newKeyword.keyword)
    } else if (bucket === 'D') {
      bucketDData.push(newKeyword)
      pushUniqueKeyword(storeBuckets.bucketD.keywords, newKeyword.keyword)
    } else if (bucket === 'C') {
      bucketCData.push(newKeyword)
      pushUniqueKeyword(storeBuckets.bucketC.keywords, newKeyword.keyword)
    } else if (bucket === 'A') {
      bucketAData.push(newKeyword)
      pushUniqueKeyword(storeBuckets.bucketA.keywords, newKeyword.keyword)
    } else {
      bucketBData.push(newKeyword)
      pushUniqueKeyword(storeBuckets.bucketB.keywords, newKeyword.keyword)
    }

    existingSet.add(keywordNorm)
    addedKeywords.push(newKeyword)
  }

  await hydrateGlobalCoreKeywordSearchVolumes(addedKeywords, offer, userId)
  recalculateStoreBucketStatistics(storeBuckets)

  return {
    bucketAData,
    bucketBData,
    bucketCData,
    bucketDData,
    bucketSData,
  }
}

async function hydrateGlobalCoreKeywordSearchVolumes(
  keywords: PoolKeywordData[],
  offer: Offer,
  userId: number
): Promise<void> {
  if (keywords.length === 0) return

  try {
    const country = normalizeCountryCode(offer.target_country || 'US')
    const languageCode = normalizeLanguageCode(offer.target_language || 'en')
    const languageName = getLanguageName(languageCode)
    const languageCandidates = Array.from(
      new Set(
        [languageCode, languageName, offer.target_language]
          .map(value => String(value || '').trim())
          .filter(Boolean)
      )
    )

    const keywordMap = new Map<string, PoolKeywordData>()
    for (const kw of keywords) {
      const norm = normalizeGoogleAdsKeyword(kw.keyword)
      if (!norm) continue
      if (!keywordMap.has(norm)) keywordMap.set(norm, kw)
    }

    const normalizedKeywords = Array.from(keywordMap.keys())
    if (normalizedKeywords.length === 0) return

    const db = await getDatabase()
    const placeholders = normalizedKeywords.map(() => '?').join(',')
    const languagePlaceholders = languageCandidates.map(() => '?').join(',')
    const rows = await db.query(
      `
      SELECT keyword, search_volume, competition_level, avg_cpc_micros, cached_at
      FROM global_keywords
      WHERE keyword IN (${placeholders})
        AND country = ?
        AND language IN (${languagePlaceholders})
    `,
      [...normalizedKeywords, country, ...languageCandidates]
    ) as Array<{
      keyword: string
      search_volume: number | null
      competition_level: string | null
      avg_cpc_micros: number | null
      cached_at: string | Date | null
    }>

    const cutoffMs = Date.now() - GLOBAL_CORE_SEARCH_VOLUME_TTL_DAYS * 24 * 60 * 60 * 1000
    const staleNorms = new Set<string>()
    const volumeUpdates = new Map<string, number>()

    const seenNorms = new Set<string>()
    for (const row of rows) {
      const norm = normalizeGoogleAdsKeyword(row.keyword)
      if (!norm) continue
      seenNorms.add(norm)
      const kw = keywordMap.get(norm)
      if (!kw) continue

      const cachedAtValue = row.cached_at
      const cachedAtMs = cachedAtValue instanceof Date
        ? cachedAtValue.getTime()
        : Date.parse(String(cachedAtValue || ''))
      const isFresh = Number.isFinite(cachedAtMs) && cachedAtMs >= cutoffMs

      if (isFresh) {
        kw.searchVolume = Number(row.search_volume || 0)
        if (row.competition_level) kw.competition = row.competition_level
        const avgCpc = Number(row.avg_cpc_micros || 0) / 1_000_000
        if (avgCpc > 0) {
          kw.lowTopPageBid = avgCpc
          kw.highTopPageBid = avgCpc
        }
        volumeUpdates.set(norm, kw.searchVolume || 0)
      } else {
        staleNorms.add(norm)
      }
    }

    for (const norm of normalizedKeywords) {
      if (!seenNorms.has(norm)) staleNorms.add(norm)
    }

    if (staleNorms.size > 0) {
      const { getKeywordSearchVolumes } = await import('./keyword-planner')
      const auth = await getUserAuthType(userId)
      const refreshKeywords = Array.from(staleNorms)
        .map(norm => keywordMap.get(norm)?.keyword)
        .filter((kw): kw is string => Boolean(kw))

      if (refreshKeywords.length > 0) {
        const volumes = await getKeywordSearchVolumes(
          refreshKeywords,
          country,
          languageCode,
          userId,
          auth.authType,
          auth.serviceAccountId
        )

        for (const vol of volumes) {
          const norm = normalizeGoogleAdsKeyword(vol.keyword)
          if (!norm) continue
          const kw = keywordMap.get(norm)
          if (!kw) continue

          kw.searchVolume = vol.avgMonthlySearches || 0
          kw.competition = vol.competition || kw.competition
          kw.competitionIndex = vol.competitionIndex || kw.competitionIndex
          kw.lowTopPageBid = vol.lowTopPageBid || kw.lowTopPageBid
          kw.highTopPageBid = vol.highTopPageBid || kw.highTopPageBid
          volumeUpdates.set(norm, kw.searchVolume || 0)
        }
      }
    }

    if (volumeUpdates.size > 0) {
      const updates = Array.from(volumeUpdates.entries()).map(([keywordNorm, searchVolume]) => ({
        keywordNorm,
        searchVolume,
      }))
      await updateBrandCoreKeywordSearchVolumes(
        offer.brand,
        country,
        languageCode,
        updates
      )
      await refreshBrandCoreKeywordCache(offer.brand, country, languageCode)
    }
  } catch (error: any) {
    console.warn(`⚠️ 全局核心关键词搜索量补齐失败: ${error?.message || String(error)}`)
  }
}

/**
 * 🆕 v4.16: 店铺链接关键词桶（5个桶）
 * 用于店铺链接的5种不同创意类型
 */
export interface StoreKeywordBuckets {
  bucketA: {
    intent: string  // 品牌商品集合 (Brand Collection)
    intentEn: string
    description: string
    keywords: string[]
  }
  bucketB: {
    intent: string  // 商品需求场景 (Demand Scenario)
    intentEn: string
    description: string
    keywords: string[]
  }
  bucketC: {
    intent: string  // 热门商品线 (Hot Product Line)
    intentEn: string
    description: string
    keywords: string[]
  }
  bucketD: {
    intent: string  // 信任服务信号 (Trust Service)
    intentEn: string
    description: string
    keywords: string[]
  }
  bucketS: {
    intent: string  // 店铺全量覆盖 (Store Coverage)
    intentEn: string
    description: string
    keywords: string[]
  }
  statistics: {
    totalKeywords: number
    bucketACount: number
    bucketBCount: number
    bucketCCount: number
    bucketDCount: number
    bucketSCount: number
    balanceScore: number
  }
}

/**
 * 桶类型
 * A = 品牌意图槽位 / 品牌锚点 raw bucket
 * B = 商品型号/产品族意图槽位 / 需求场景 raw bucket
 * C = 历史兼容 raw bucket（现统一并入 B）
 * D = 商品需求意图槽位 / 需求扩展 raw bucket
 * S = 历史兼容 raw bucket（现统一并入 D）
 */
export type BucketType = 'A' | 'B' | 'C' | 'D' | 'S'

const DEFAULT_PRODUCT_CLUSTER_BUCKETS = {
  A: { intent: '品牌商品锚点', intentEn: 'Brand Product Anchor', description: '品牌词与商品/型号锚点明确的候选词' },
  B: { intent: '商品需求场景', intentEn: 'Demand Scenario', description: '用户有明确商品需求或使用场景的候选词' },
  C: { intent: '功能规格特性', intentEn: 'Feature / Spec', description: '用户关注功能、参数或规格的候选词' },
  D: { intent: '商品需求扩展', intentEn: 'Demand Expansion', description: '用于补足商品需求覆盖的高相关候选词' },
} as const

const DEFAULT_STORE_CLUSTER_BUCKETS = {
  A: { intent: '品牌商品集合', intentEn: 'Brand Collection', description: '用户认可品牌，想了解品牌下的核心商品集合' },
  B: { intent: '商品需求场景', intentEn: 'Demand Scenario', description: '用户有明确商品需求或使用场景' },
  C: { intent: '热门商品线', intentEn: 'Hot Product Line', description: '用户想了解店铺热销商品线、系列或热门型号' },
  D: { intent: '信任服务信号', intentEn: 'Trust Service', description: '用户关注店铺服务、保障和可信信号' },
  S: { intent: '店铺全量覆盖', intentEn: 'Store Coverage', description: '用户想全面了解店铺商品与产品线' },
} as const

/**
 * 商品需求 coverage 关键词配置
 * 说明：这是内部 coverage 模式，不代表第 4 种创意类型。
 */
export interface CoverageKeywordConfig {
  /** 最大非品牌关键词数量 */
  maxNonBrandKeywords: number
  /** 是否按搜索量排序 */
  sortByVolume: boolean
  /** 最小搜索量阈值 */
  minSearchVolume: number
  /** 关键词搜索量查询语言 */
  language?: string
}

/**
 * 兼容旧命名：SyntheticKeywordConfig 实际等价于 CoverageKeywordConfig
 */
export type SyntheticKeywordConfig = CoverageKeywordConfig

/**
 * 默认商品需求 coverage 配置
 */
export const DEFAULT_COVERAGE_KEYWORD_CONFIG: CoverageKeywordConfig = {
  maxNonBrandKeywords: 15,  // 从各桶中选择Top15高搜索量关键词
  sortByVolume: true,
  minSearchVolume: 100,
}

/**
 * 兼容旧命名：保留 DEFAULT_SYNTHETIC_CONFIG，避免历史引用失效
 */
export const DEFAULT_SYNTHETIC_CONFIG: SyntheticKeywordConfig = DEFAULT_COVERAGE_KEYWORD_CONFIG

/**
 * 创意生成选项（带桶信息）
 */
export interface BucketCreativeOptions {
  bucket: BucketType
  theme: string
  keywords: string[]
  bucketIntent: string
}

// ============================================
// 纯品牌词识别
// ============================================

/**
 * 判断关键词是否为纯品牌词（基于品牌名生成纯品牌词集合）
 */
export function isPureBrandKeyword(keyword: string, brandName: string): boolean {
  if (!keyword || !brandName) return false
  const pureBrandKeywords = getPureBrandKeywords(brandName)
  return isPureBrandKeywordInternal(keyword, pureBrandKeywords)
}

function inferDefaultKeywordMatchType(
  keyword: string,
  pureBrandKeywords: string[]
): 'EXACT' | 'PHRASE' {
  return isPureBrandKeywordInternal(keyword, pureBrandKeywords) ? 'EXACT' : 'PHRASE'
}

/**
 * 分离纯品牌词和非品牌词
 *
 * @param keywords - 所有关键词列表
 * @param brandName - 品牌名称
 * @returns 分离结果：纯品牌词 + 非品牌词
 */
export function separateBrandKeywords(
  keywords: string[],
  brandName: string
): { brandKeywords: string[]; nonBrandKeywords: string[] } {
  const brandKeywords: string[] = []
  const nonBrandKeywords: string[] = []
  const pureBrandKeywords = getPureBrandKeywords(brandName)

  for (const keyword of keywords) {
    if (isPureBrandKeywordInternal(keyword, pureBrandKeywords)) {
      brandKeywords.push(keyword)
    } else {
      nonBrandKeywords.push(keyword)
    }
  }

  console.log(`🏷️ 纯品牌词分离: ${brandKeywords.length} 个纯品牌词, ${nonBrandKeywords.length} 个非品牌词`)
  console.log(`   纯品牌词: ${brandKeywords.join(', ') || '(无)'}`)

  return { brandKeywords, nonBrandKeywords }
}

// ============================================
// AI 语义聚类
// ============================================

/**
 * 🔥 2025-12-22 重大优化：分批处理大规模关键词聚类
 *
 * 问题：249个关键词一次性聚类导致超时（即使flash模型也需要180s+）
 * 解决：将关键词分批处理，每批80-100个关键词，并行处理后合并结果
 *
 * 性能提升：
 * - 批量处理：每批处理时间从180s+降至45-60s
 * - 并行执行：3个批次并行处理，总时间减少60%
 * - 超时风险：从>90%降至<1%
 *
 * 策略：
 * 1. 关键词数量 <= 100：直接处理（原逻辑）
 * 2. 关键词数量 > 100：分批处理（3批次并行）
 * 3. 每批次独立聚类，保持桶A/B/C结构
 * 4. 合并时去重并计算平均意图描述
 */

/**
 * 批量聚类单个批次
 * 🆕 v4.16: 支持店铺链接的5桶模式
 */
async function clusterBatchKeywords(
  batchKeywords: string[],
  brandName: string,
  category: string | null,
  userId: number,
  batchIndex: number,
  totalBatches: number,
  pageType: 'product' | 'store' = 'product',
  splitDepth: number = 0
): Promise<KeywordBuckets | StoreKeywordBuckets> {
  console.log(`📦 处理批次 ${batchIndex}/${totalBatches}: ${batchKeywords.length} 个关键词 (${pageType}链接)`)

  // 1. 加载聚类 prompt
  const promptTemplate = await loadPrompt('keyword_intent_clustering')

  // 2. 构建 prompt（v4.16 支持 store 链接）
  let prompt = promptTemplate
    .replace('{{brandName}}', brandName)
    .replace('{{productCategory}}', category || '未分类')
    .replace('{{keywords}}', batchKeywords.join('\n'))
    // 🆕 v4.16: 添加链接类型参数到 prompt
    .replace(/\{\{linkType\}\}/g, pageType)
  prompt = appendKeywordClusteringOutputGuardrails(prompt)

  // 3. 定义结构化输出 schema（支持4桶产品 或 5桶店铺）
  const isStore = pageType === 'store'
  const responseSchema = {
    type: 'OBJECT' as const,
    properties: {
      bucketA: {
        type: 'OBJECT' as const,
        properties: {
          intent: { type: 'STRING' as const },
          intentEn: { type: 'STRING' as const },
          description: { type: 'STRING' as const },
          keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } }
        },
        required: ['intent', 'intentEn', 'description', 'keywords']
      },
      bucketB: {
        type: 'OBJECT' as const,
        properties: {
          intent: { type: 'STRING' as const },
          intentEn: { type: 'STRING' as const },
          description: { type: 'STRING' as const },
          keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } }
        },
        required: ['intent', 'intentEn', 'description', 'keywords']
      },
      bucketC: {
        type: 'OBJECT' as const,
        properties: {
          intent: { type: 'STRING' as const },
          intentEn: { type: 'STRING' as const },
          description: { type: 'STRING' as const },
          keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } }
        },
        required: ['intent', 'intentEn', 'description', 'keywords']
      },
      bucketD: {
        type: 'OBJECT' as const,
        properties: {
          intent: { type: 'STRING' as const },
          intentEn: { type: 'STRING' as const },
          description: { type: 'STRING' as const },
          keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } }
        },
        required: ['intent', 'intentEn', 'description', 'keywords']
      },
      // 🆕 v4.16: 店铺链接添加 bucketS
      ...(isStore ? {
        bucketS: {
          type: 'OBJECT' as const,
          properties: {
            intent: { type: 'STRING' as const },
            intentEn: { type: 'STRING' as const },
            description: { type: 'STRING' as const },
            keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } }
          },
          required: ['intent', 'intentEn', 'description', 'keywords']
        }
      } : {}),
      statistics: {
        type: 'OBJECT' as const,
        properties: {
          totalKeywords: { type: 'INTEGER' as const },
          bucketACount: { type: 'INTEGER' as const },
          bucketBCount: { type: 'INTEGER' as const },
          bucketCCount: { type: 'INTEGER' as const },
          bucketDCount: { type: 'INTEGER' as const },
          // 🆕 v4.16: 店铺链接添加 bucketSCount
          ...(isStore ? { bucketSCount: { type: 'INTEGER' as const } } : {}),
          balanceScore: { type: 'NUMBER' as const }
        },
        required: isStore
          ? ['totalKeywords', 'bucketACount', 'bucketBCount', 'bucketCCount', 'bucketDCount', 'bucketSCount', 'balanceScore']
          : ['totalKeywords', 'bucketACount', 'bucketBCount', 'bucketCCount', 'bucketDCount', 'balanceScore']
      }
    },
    required: isStore
      ? ['bucketA', 'bucketB', 'bucketC', 'bucketD', 'bucketS', 'statistics']
      : ['bucketA', 'bucketB', 'bucketC', 'bucketD', 'statistics']
  }

  // 4. 调用 AI（使用智能模型选择，60-90s）
  const aiResponse = await runKeywordClustering({
    operationType: 'keyword_clustering',
    prompt,
    temperature: 0.3,
    responseSchema,
    responseMimeType: 'application/json'
  }, userId)

  // 5. 记录 token 使用
  if (aiResponse.usage) {
    const cost = estimateTokenCost(
      aiResponse.model,
      aiResponse.usage.inputTokens,
      aiResponse.usage.outputTokens
    )
    await recordTokenUsage({
      userId,
      model: aiResponse.model,
      operationType: 'keyword_clustering',
      inputTokens: aiResponse.usage.inputTokens,
      outputTokens: aiResponse.usage.outputTokens,
      totalTokens: aiResponse.usage.totalTokens,
      cost,
      apiType: aiResponse.apiType
    })
  }

  let batchResult
  try {
    batchResult = parseKeywordClusteringJson(aiResponse.text)
  } catch (parseError) {
    const likelyTruncated = isLikelyKeywordClusteringTruncated(aiResponse)
    const canSplitFurther =
      likelyTruncated &&
      splitDepth < KEYWORD_CLUSTERING_MAX_SPLIT_DEPTH &&
      batchKeywords.length >= (KEYWORD_CLUSTERING_MIN_SPLIT_KEYWORDS * 2)

    if (canSplitFurther) {
      const [leftKeywords, rightKeywords] = splitKeywordsForRetry(batchKeywords)
      console.warn(
        `⚠️ 批次 ${batchIndex}/${totalBatches} 响应疑似被 token 截断 ` +
        `(${aiResponse.usage?.outputTokens || 0}/${KEYWORD_CLUSTERING_MAX_OUTPUT_TOKENS})，` +
        `拆分为 ${leftKeywords.length}+${rightKeywords.length} 重试`
      )

      const leftResult = await clusterBatchKeywords(
        leftKeywords,
        brandName,
        category,
        userId,
        batchIndex,
        totalBatches,
        pageType,
        splitDepth + 1
      )
      const rightResult = await clusterBatchKeywords(
        rightKeywords,
        brandName,
        category,
        userId,
        batchIndex,
        totalBatches,
        pageType,
        splitDepth + 1
      )

      return mergeBatchResults([leftResult, rightResult])
    }

    console.error('❌ JSON解析失败:', parseError)
    console.error('   原始响应:', aiResponse.text.slice(0, 500))
    const errorMessage = parseError instanceof Error ? parseError.message : '未知错误'
    throw new Error(`JSON解析失败: ${errorMessage}`)
  }

  // 🔥 2025-12-22 添加数据结构验证（支持4个桶）
  // 🆕 v4.16: 店铺链接支持5个桶
  if (isStore) {
    // 店铺链接：验证5个桶
    if (!batchResult.bucketA || !batchResult.bucketB || !batchResult.bucketC || !batchResult.bucketD || !batchResult.bucketS) {
      console.error('❌ AI返回数据结构不完整(店铺):', batchResult)
      throw new Error('AI返回的数据结构不完整：缺少bucketA/B/C/D/S')
    }

    if (!Array.isArray(batchResult.bucketA.keywords) ||
        !Array.isArray(batchResult.bucketB.keywords) ||
        !Array.isArray(batchResult.bucketC.keywords) ||
        !Array.isArray(batchResult.bucketD.keywords) ||
        !Array.isArray(batchResult.bucketS.keywords)) {
      console.error('❌ AI返回的keywords不是数组(店铺):', batchResult)
      throw new Error('AI返回的keywords不是数组')
    }

    console.log(`✅ 批次 ${batchIndex} 完成 (店铺5桶): A=${batchResult.bucketA.keywords.length}, B=${batchResult.bucketB.keywords.length}, C=${batchResult.bucketC.keywords.length}, D=${batchResult.bucketD.keywords.length}, S=${batchResult.bucketS.keywords.length}`)
  } else {
    // 产品链接：验证4个桶
    if (!batchResult.bucketA || !batchResult.bucketB || !batchResult.bucketC || !batchResult.bucketD) {
      console.error('❌ AI返回数据结构不完整(产品):', batchResult)
      throw new Error('AI返回的数据结构不完整：缺少bucketA/B/C/D')
    }

    if (!Array.isArray(batchResult.bucketA.keywords) ||
        !Array.isArray(batchResult.bucketB.keywords) ||
        !Array.isArray(batchResult.bucketC.keywords) ||
        !Array.isArray(batchResult.bucketD.keywords)) {
      console.error('❌ AI返回的keywords不是数组(产品):', batchResult)
      throw new Error('AI返回的keywords不是数组')
    }

    console.log(`✅ 批次 ${batchIndex} 完成 (产品4桶): A=${batchResult.bucketA.keywords.length}, B=${batchResult.bucketB.keywords.length}, C=${batchResult.bucketC.keywords.length}, D=${batchResult.bucketD.keywords.length}`)
  }

  return batchResult
}

/**
 * 合并多个批次的聚类结果（支持4桶和5桶模式）
 * 🔧 修复(2025-12-24): 支持店铺链接的bucketS
 */
function mergeBatchResults(
  batchResults: Array<{
    bucketA: { intent: string; intentEn: string; description: string; keywords: string[] }
    bucketB: { intent: string; intentEn: string; description: string; keywords: string[] }
    bucketC: { intent: string; intentEn: string; description: string; keywords: string[] }
    bucketD: { intent: string; intentEn: string; description: string; keywords: string[] }
    bucketS?: { intent: string; intentEn: string; description: string; keywords: string[] }  // 🔧 可选：店铺链接专用
    statistics: { totalKeywords: number; bucketACount: number; bucketBCount: number; bucketCCount: number; bucketDCount: number; bucketSCount?: number; balanceScore: number }
  }>
): KeywordBuckets {
  // 合并所有关键词（去重）
  const allBucketAKeywords = Array.from(new Set(batchResults.flatMap(r => r.bucketA.keywords)))
  const allBucketBKeywords = Array.from(new Set(batchResults.flatMap(r => r.bucketB.keywords)))
  const allBucketCKeywords = Array.from(new Set(batchResults.flatMap(r => r.bucketC.keywords)))
  const allBucketDKeywords = Array.from(new Set(batchResults.flatMap(r => r.bucketD.keywords)))
  const allBucketSKeywords = Array.from(new Set(batchResults.flatMap(r => r.bucketS?.keywords || [])))  // 🔧 处理可选的bucketS

  // 选择最详细的意图描述（选择最长的描述）
  const bucketAIntent = batchResults.reduce((best, current) =>
    current.bucketA.description.length > best.bucketA.description.length ? current : best
  ).bucketA

  const bucketBIntent = batchResults.reduce((best, current) =>
    current.bucketB.description.length > best.bucketB.description.length ? current : best
  ).bucketB

  const bucketCIntent = batchResults.reduce((best, current) =>
    current.bucketC.description.length > best.bucketC.description.length ? current : best
  ).bucketC

  const bucketDIntent = batchResults.reduce((best, current) =>
    current.bucketD.description.length > best.bucketD.description.length ? current : best
  ).bucketD

  // 🔧 处理bucketS（店铺链接专用）
  const bucketSIntent = batchResults.find(r => r.bucketS)?.bucketS

  // 计算统计数据
  const totalKeywords = allBucketAKeywords.length + allBucketBKeywords.length + allBucketCKeywords.length + allBucketDKeywords.length + allBucketSKeywords.length
  const averageBalanceScore = batchResults.reduce((sum, r) => sum + r.statistics.balanceScore, 0) / batchResults.length

  console.log(`🔄 合并 ${batchResults.length} 个批次结果:`)
  console.log(`   桶A: ${allBucketAKeywords.length} 个关键词`)
  console.log(`   桶B: ${allBucketBKeywords.length} 个关键词`)
  console.log(`   桶C: ${allBucketCKeywords.length} 个关键词`)
  console.log(`   桶D: ${allBucketDKeywords.length} 个关键词`)
  if (allBucketSKeywords.length > 0) {
    console.log(`   桶S: ${allBucketSKeywords.length} 个关键词`)  // 🔧 店铺链接显示bucketS
  }
  console.log(`   平均均衡度: ${averageBalanceScore.toFixed(2)}`)

  const result: KeywordBuckets = {
    bucketA: { ...bucketAIntent, keywords: allBucketAKeywords },
    bucketB: { ...bucketBIntent, keywords: allBucketBKeywords },
    bucketC: { ...bucketCIntent, keywords: allBucketCKeywords },
    bucketD: { ...bucketDIntent, keywords: allBucketDKeywords },
    statistics: {
      totalKeywords,
      bucketACount: allBucketAKeywords.length,
      bucketBCount: allBucketBKeywords.length,
      bucketCCount: allBucketCKeywords.length,
      bucketDCount: allBucketDKeywords.length,
      balanceScore: averageBalanceScore
    }
  }

  // 🔧 添加bucketS（如果存在）
  if (bucketSIntent && allBucketSKeywords.length > 0) {
    result.bucketS = { ...bucketSIntent, keywords: allBucketSKeywords }
    result.statistics.bucketSCount = allBucketSKeywords.length
  }

  return result
}

/**
 * AI 语义聚类：将非品牌关键词分成 3 个语义桶（优化版）
 *
 * 🔥 2025-12-22 重大优化：
 * - 小批量（<=100）：直接处理
 * - 大批量（>100）：分批并行处理
 * - 解决249个关键词超时问题
 *
 * 🔥 2025-12-22 整合优化：
 * - 支持4个桶（A/B/C/D）的聚类
 * - 商品需求扩展词也参与AI语义聚类
 * - 保持语义聚类的一致性
 *
 * 桶A：品牌商品锚点（品牌与商品/型号强相关）
 * 桶B：商品需求场景（用户有明确商品需求或使用场景）
 * 桶C：功能规格特性（关注技术规格、功能与参数）
 * 桶D：商品需求扩展（补足高相关需求覆盖）
 *
 * 🆕 v4.16: 店铺链接支持5个桶
 * 桶A：品牌商品集合
 * 桶B：商品需求场景
 * 桶C：热门商品线
 * 桶D：信任服务信号
 * 桶S：店铺全量覆盖
 *
 * @param keywords - 非品牌关键词列表
 * @param brandName - 品牌名称
 * @param category - 产品类别
 * @param userId - 用户 ID（用于 AI 调用）
 * @param targetCountry - 目标国家
 * @param targetLanguage - 目标语言
 * @param pageType - 链接类型 ('product' | 'store')
 * @returns 关键词桶
 */
export async function clusterKeywordsByIntent(
  keywords: string[],
  brandName: string,
  category: string | null,
  userId: number,
  targetCountry?: string,
  targetLanguage?: string,
  pageType: 'product' | 'store' = 'product',
  progress?: KeywordPoolProgressReporter
): Promise<KeywordBuckets> {
  if (keywords.length === 0) {
    console.log('⚠️ 无关键词需要聚类，返回空桶')
    return pageType === 'store' ? createEmptyStoreBuckets() : createEmptyBuckets()
  }

  console.log(`🎯 开始 AI 语义聚类: ${keywords.length} 个关键词 (${pageType}链接)`)
  await progress?.({ phase: 'cluster', message: `语义聚类准备中 (${keywords.length}个关键词)` })

  const allKeywordsForClustering = [...keywords]
  console.log(`📊 总计聚类关键词: ${allKeywordsForClustering.length} 个`)

  // 🔥 2026-02-04 优化：进一步减小批次大小，降低超时风险
  // 原因：减小单次请求处理量，提高稳定性
  const BATCH_SIZE = 30  // 每批30个关键词（降低超时风险）
  const needsBatching = allKeywordsForClustering.length > 40  // 从60改为40
  const batchCount = needsBatching ? Math.ceil(allKeywordsForClustering.length / BATCH_SIZE) : 1

  if (!needsBatching) {
    // 小批量：直接处理（原逻辑）
    console.log(`📝 小批量模式：直接处理 ${allKeywordsForClustering.length} 个关键词`)
    await progress?.({ phase: 'cluster', message: `语义聚类：小批量处理(${allKeywordsForClustering.length})` })
    try {
      const directBuckets = await clusterKeywordsDirectly(allKeywordsForClustering, brandName, category, userId, pageType)
      filterBucketsToAllowedKeywords(directBuckets, new Set(allKeywordsForClustering.map(k => k.toLowerCase())))
      return directBuckets
    } catch (error: any) {
      if (shouldUseDeterministicClusteringFallback(error)) {
        const fallbackBuckets = buildDeterministicClusteringFallback({
          keywords: allKeywordsForClustering,
          pageType,
          error,
          scope: 'direct',
        })
        filterBucketsToAllowedKeywords(fallbackBuckets, new Set(allKeywordsForClustering.map(k => k.toLowerCase())))
        return fallbackBuckets
      }
      throw error
    }
  }

  // 大批量：分批处理（有限并发）
  const MAX_CONCURRENT_BATCHES = 3
  console.log(`🚀 大批量模式：将 ${allKeywordsForClustering.length} 个关键词分成 ${batchCount} 个批次并发处理 (最大并发 ${MAX_CONCURRENT_BATCHES})`)
  await progress?.({ phase: 'cluster', message: `语义聚类：分批处理(${batchCount}批)` })

  // 1. 分批
  const batches: string[][] = []
  for (let i = 0; i < batchCount; i++) {
    const start = i * BATCH_SIZE
    const end = Math.min(start + BATCH_SIZE, allKeywordsForClustering.length)
    batches.push(allKeywordsForClustering.slice(start, end))
  }

  console.log(`📦 批次划分: ${batches.map((b, i) => `批次${i + 1}=${b.length}个`).join(', ')}`)

  // 2. 🔥 2025-12-27 优化：有限并发处理以支持多用户并发
  // 原因：纯串行会影响吞吐量，过度并发又会增加超时风险
  // 优化措施：限制并发 + 增大重试次数 + 随机抖动
  const maxRetries = 3  // 从2改为3（4次尝试）
  const baseDelay = 5000
  let lastError: any

  for (let retryCount = 0; retryCount <= maxRetries; retryCount++) {
    try {
      // 并发处理批次（限制最大并发）
      const batchResults: KeywordBuckets[] = new Array(batches.length)
      let completed = 0
      let nextIndex = 0

      const worker = async () => {
        while (true) {
          const current = nextIndex++
          if (current >= batches.length) break
          await progress?.({
            phase: 'cluster',
            current: completed,
            total: batchCount,
            message: `语义聚类：开始批次 ${current + 1}/${batchCount} (${batches[current].length}个)`
          })
          batchResults[current] = await clusterBatchKeywords(
            batches[current],
            brandName,
            category,
            userId,
            current + 1,
            batchCount,
            pageType
          ).catch(error => {
            console.error(`❌ 批次 ${current + 1} 失败:`, error.message)
            throw error
          })
          completed += 1
          await progress?.({
            phase: 'cluster',
            current: completed,
            total: batchCount,
            message: `语义聚类：完成批次 ${current + 1}/${batchCount}`
          })
        }
      }

      const workerCount = retryCount === 0
        ? Math.min(MAX_CONCURRENT_BATCHES, batches.length)
        : 1
      if (retryCount > 0 && workerCount === 1) {
        console.warn(`⚠️ 分批聚类重试阶段降级为串行执行（第 ${retryCount + 1} 轮）`)
      }
      const workers = Array.from({ length: workerCount }, () => worker())
      await Promise.all(workers)

      // 3. 合并结果
      await progress?.({ phase: 'cluster', message: '语义聚类：合并批次结果' })
      const mergedBuckets = mergeBatchResults(batchResults)
      filterBucketsToAllowedKeywords(mergedBuckets, new Set(allKeywordsForClustering.map(k => k.toLowerCase())))

      // 4. 验证结果（店铺/单品分别处理）
      if (pageType === 'store') {
        const storeBuckets = mergedBuckets as unknown as StoreKeywordBuckets
        redistributeStoreBucketsFromS(storeBuckets, allKeywordsForClustering)
        applyStoreBucketPostProcessing(storeBuckets)
        recalculateStoreBucketStatistics(storeBuckets)
        validateStoreBuckets(storeBuckets, allKeywordsForClustering)

        console.log(`✅ 分批 AI 聚类完成 (店铺):`)
        console.log(`   桶A [品牌商品集合]: ${storeBuckets.bucketA.keywords.length} 个`)
        console.log(`   桶B [商品需求场景]: ${storeBuckets.bucketB.keywords.length} 个`)
        console.log(`   桶C [热门商品线]: ${storeBuckets.bucketC.keywords.length} 个`)
        console.log(`   桶D [信任服务信号]: ${storeBuckets.bucketD.keywords.length} 个`)
        console.log(`   桶S [店铺全量覆盖]: ${storeBuckets.bucketS.keywords.length} 个`)
        console.log(`   均衡度得分: ${storeBuckets.statistics.balanceScore.toFixed(2)}`)
      } else {
        validateBuckets(mergedBuckets, allKeywordsForClustering)

        console.log(`✅ 分批 AI 聚类完成:`)
        console.log(`   桶A [品牌商品锚点]: ${mergedBuckets.bucketA.keywords.length} 个`)
        console.log(`   桶B [商品需求场景]: ${mergedBuckets.bucketB.keywords.length} 个`)
        console.log(`   桶C [功能规格特性]: ${mergedBuckets.bucketC.keywords.length} 个`)
        console.log(`   桶D [商品需求扩展]: ${mergedBuckets.bucketD.keywords.length} 个`)
        console.log(`   均衡度得分: ${mergedBuckets.statistics.balanceScore.toFixed(2)}`)
      }

      return mergedBuckets
    } catch (error: any) {
      lastError = error
      const status = extractHttpStatusFromError(error)
      const retryable = isRetryableClusteringError(error)

      if (retryCount < maxRetries && retryable) {
        // 🔥 2025-12-27 优化：添加随机抖动，避免重试风暴
        const baseDelayMs = baseDelay * Math.pow(2, retryCount)
        const jitter = Math.random() * 2000  // 0-2秒随机抖动
        const delay = Math.min(baseDelayMs + jitter, 60000)  // 最多60秒
        const errorInfo = status
          ? `HTTP ${status}`
          : String(error?.message || '').substring(0, 80)
        console.warn(`⚠️ 分批聚类第 ${retryCount + 1} 次失败 (${errorInfo})，${(delay / 1000).toFixed(1)}s 后重试...`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }

      if (shouldUseDeterministicClusteringFallback(error)) {
        const fallbackBuckets = buildDeterministicClusteringFallback({
          keywords: allKeywordsForClustering,
          pageType,
          error,
          scope: 'batch',
        })
        filterBucketsToAllowedKeywords(fallbackBuckets, new Set(allKeywordsForClustering.map(k => k.toLowerCase())))
        return fallbackBuckets
      }

      console.error('❌ 分批 AI 语义聚类失败:', error.message)
      throw new Error(`关键词AI语义分类失败（分批处理）: ${error.message}`)
    }
  }

  throw new Error(`关键词AI语义分类失败（重试${maxRetries}次均失败）: ${lastError?.message || '未知错误'}`)
}

/**
 * 直接处理小批量关键词聚类（原逻辑）
 * 🆕 v4.16: 支持店铺链接的5桶模式
 * 🔥 2025-12-27: 增加重试次数，与分批处理保持一致
 */
async function clusterKeywordsDirectly(
  keywords: string[],
  brandName: string,
  category: string | null,
  userId: number,
  pageType: 'product' | 'store' = 'product'
): Promise<KeywordBuckets | StoreKeywordBuckets> {
  // 🔥 2025-12-27: 增加重试次数，与分批处理保持一致
  const maxRetries = 3  // 🔥 从2改为3（4次尝试）
  const baseDelay = 5000
  let lastError: any

  for (let retryCount = 0; retryCount <= maxRetries; retryCount++) {
    try {
      // 1. 加载聚类 prompt（v4.16 支持 pageType 参数）
      const promptTemplate = await loadPrompt('keyword_intent_clustering')

      // 2. 构建 prompt（v4.16 支持 store 链接）
      let prompt = promptTemplate
        .replace('{{brandName}}', brandName)
        .replace('{{productCategory}}', category || '未分类')
        .replace('{{keywords}}', keywords.join('\n'))
        // 🆕 v4.16: 添加链接类型参数到 prompt
        .replace(/\{\{linkType\}\}/g, pageType)
      prompt = appendKeywordClusteringOutputGuardrails(prompt)

      // 3. 定义结构化输出 schema（支持4桶产品 或 5桶店铺）
      const isStore = pageType === 'store'
      const responseSchema = {
        type: 'OBJECT' as const,
        properties: {
          bucketA: {
            type: 'OBJECT' as const,
            properties: {
              intent: { type: 'STRING' as const },
              intentEn: { type: 'STRING' as const },
              description: { type: 'STRING' as const },
              keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } }
            },
            required: ['intent', 'intentEn', 'description', 'keywords']
          },
          bucketB: {
            type: 'OBJECT' as const,
            properties: {
              intent: { type: 'STRING' as const },
              intentEn: { type: 'STRING' as const },
              description: { type: 'STRING' as const },
              keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } }
            },
            required: ['intent', 'intentEn', 'description', 'keywords']
          },
          bucketC: {
            type: 'OBJECT' as const,
            properties: {
              intent: { type: 'STRING' as const },
              intentEn: { type: 'STRING' as const },
              description: { type: 'STRING' as const },
              keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } }
            },
            required: ['intent', 'intentEn', 'description', 'keywords']
          },
          bucketD: {
            type: 'OBJECT' as const,
            properties: {
              intent: { type: 'STRING' as const },
              intentEn: { type: 'STRING' as const },
              description: { type: 'STRING' as const },
              keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } }
            },
            required: ['intent', 'intentEn', 'description', 'keywords']
          },
          // 🆕 v4.16: 店铺链接添加 bucketS
          ...(isStore ? {
            bucketS: {
              type: 'OBJECT' as const,
              properties: {
                intent: { type: 'STRING' as const },
                intentEn: { type: 'STRING' as const },
                description: { type: 'STRING' as const },
                keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } }
              },
              required: ['intent', 'intentEn', 'description', 'keywords']
            }
          } : {}),
          statistics: {
            type: 'OBJECT' as const,
            properties: {
              totalKeywords: { type: 'INTEGER' as const },
              bucketACount: { type: 'INTEGER' as const },
              bucketBCount: { type: 'INTEGER' as const },
              bucketCCount: { type: 'INTEGER' as const },
              bucketDCount: { type: 'INTEGER' as const },
              // 🆕 v4.16: 店铺链接添加 bucketSCount
              ...(isStore ? { bucketSCount: { type: 'INTEGER' as const } } : {}),
              balanceScore: { type: 'NUMBER' as const }
            },
            required: isStore
              ? ['totalKeywords', 'bucketACount', 'bucketBCount', 'bucketCCount', 'bucketDCount', 'bucketSCount', 'balanceScore']
              : ['totalKeywords', 'bucketACount', 'bucketBCount', 'bucketCCount', 'bucketDCount', 'balanceScore']
          }
        },
        required: isStore
          ? ['bucketA', 'bucketB', 'bucketC', 'bucketD', 'bucketS', 'statistics']
          : ['bucketA', 'bucketB', 'bucketC', 'bucketD', 'statistics']
      }

      // 4. 调用 AI（使用智能模型选择）
      const aiResponse = await runKeywordClustering({
        operationType: 'keyword_clustering',
        prompt,
        temperature: 0.3,
        responseSchema,
        responseMimeType: 'application/json'
      }, userId)

      // 5. 记录 token 使用
      if (aiResponse.usage) {
        const cost = estimateTokenCost(
          aiResponse.model,
          aiResponse.usage.inputTokens,
          aiResponse.usage.outputTokens
        )
        await recordTokenUsage({
          userId,
          model: aiResponse.model,
          operationType: 'keyword_clustering',
          inputTokens: aiResponse.usage.inputTokens,
          outputTokens: aiResponse.usage.outputTokens,
          totalTokens: aiResponse.usage.totalTokens,
          cost,
          apiType: aiResponse.apiType
        })
      }

      let buckets: KeywordBuckets | StoreKeywordBuckets
      try {
        buckets = parseKeywordClusteringJson(aiResponse.text)
      } catch (parseError) {
        const likelyTruncated = isLikelyKeywordClusteringTruncated(aiResponse)
        const canSplit =
          likelyTruncated &&
          keywords.length >= (KEYWORD_CLUSTERING_MIN_SPLIT_KEYWORDS * 2)

        if (canSplit) {
          const [leftKeywords, rightKeywords] = splitKeywordsForRetry(keywords)
          console.warn(
            `⚠️ 直接聚类响应疑似被 token 截断 ` +
            `(${aiResponse.usage?.outputTokens || 0}/${KEYWORD_CLUSTERING_MAX_OUTPUT_TOKENS})，` +
            `拆分为 ${leftKeywords.length}+${rightKeywords.length} 重试`
          )

          const leftResult = await clusterBatchKeywords(
            leftKeywords,
            brandName,
            category,
            userId,
            1,
            2,
            pageType,
            1
          )
          const rightResult = await clusterBatchKeywords(
            rightKeywords,
            brandName,
            category,
            userId,
            2,
            2,
            pageType,
            1
          )

          buckets = mergeBatchResults([leftResult, rightResult]) as KeywordBuckets | StoreKeywordBuckets
        } else {
          console.error('❌ JSON解析失败:', parseError)
          console.error('   原始响应:', aiResponse.text.slice(0, 500))
          const errorMessage = parseError instanceof Error ? parseError.message : '未知错误'
          throw new Error(`JSON解析失败: ${errorMessage}`)
        }
      }

      // 🔥 2025-12-22 添加数据结构验证（支持4个桶）
      // 🆕 v4.16: 店铺链接支持5个桶
      if (isStore) {
        // 店铺链接：验证5个桶
        const storeBuckets = buckets as StoreKeywordBuckets
        if (!storeBuckets.bucketA || !storeBuckets.bucketB || !storeBuckets.bucketC || !storeBuckets.bucketD || !storeBuckets.bucketS) {
          console.error('❌ AI返回数据结构不完整(店铺):', buckets)
          throw new Error('AI返回的数据结构不完整：缺少bucketA/B/C/D/S')
        }

        if (!Array.isArray(storeBuckets.bucketA.keywords) ||
            !Array.isArray(storeBuckets.bucketB.keywords) ||
            !Array.isArray(storeBuckets.bucketC.keywords) ||
            !Array.isArray(storeBuckets.bucketD.keywords) ||
            !Array.isArray(storeBuckets.bucketS.keywords)) {
          console.error('❌ AI返回的keywords不是数组(店铺):', buckets)
          throw new Error('AI返回的keywords不是数组')
        }

        // 🔧 2026-01-11: 兜底修复 - 避免关键词全部落入桶S导致后续桶A-D无词
        // 先尝试从桶S/原始关键词中恢复 A/B/C/D 的基础分布，再应用后处理规则。
        redistributeStoreBucketsFromS(storeBuckets, keywords)

        // 🔥 v4.18 新增：后处理规则修正错误分配（促销/型号/评价/地理）
        applyStoreBucketPostProcessing(storeBuckets)
        recalculateStoreBucketStatistics(storeBuckets)

        // 验证店铺结果（只告警，不阻断创意生成）
        validateStoreBuckets(storeBuckets, keywords)

        console.log(`✅ AI 聚类完成 (店铺 5桶):`)
        console.log(`   桶A [品牌信任]: ${storeBuckets.bucketA.keywords.length} 个`)
        console.log(`   桶B [场景解决]: ${storeBuckets.bucketB.keywords.length} 个`)
        console.log(`   桶C [精选推荐]: ${storeBuckets.bucketC.keywords.length} 个`)
        console.log(`   桶D [信任信号]: ${storeBuckets.bucketD.keywords.length} 个`)
        console.log(`   桶S [店铺全景]: ${storeBuckets.bucketS.keywords.length} 个`)
        console.log(`   均衡度得分: ${storeBuckets.statistics.balanceScore.toFixed(2)}`)
      } else {
        // 产品链接：验证4个桶
        const productBuckets = buckets as KeywordBuckets
        if (!productBuckets.bucketA || !productBuckets.bucketB || !productBuckets.bucketC || !productBuckets.bucketD) {
          console.error('❌ AI返回数据结构不完整(产品):', buckets)
          throw new Error('AI返回的数据结构不完整：缺少bucketA/B/C/D')
        }

        if (!Array.isArray(productBuckets.bucketA.keywords) ||
            !Array.isArray(productBuckets.bucketB.keywords) ||
            !Array.isArray(productBuckets.bucketC.keywords) ||
            !Array.isArray(productBuckets.bucketD.keywords)) {
          console.error('❌ AI返回的keywords不是数组(产品):', buckets)
          throw new Error('AI返回的keywords不是数组')
        }

        // 验证产品结果
        validateBuckets(productBuckets, keywords)

        console.log(`✅ AI 聚类完成 (产品 4桶):`)
        console.log(`   桶A [产品型号]: ${productBuckets.bucketA.keywords.length} 个`)
        console.log(`   桶B [购买意图]: ${productBuckets.bucketB.keywords.length} 个`)
        console.log(`   桶C [功能特性]: ${productBuckets.bucketC.keywords.length} 个`)
        console.log(`   桶D [紧迫促销]: ${productBuckets.bucketD.keywords.length} 个`)
        console.log(`   均衡度得分: ${productBuckets.statistics.balanceScore.toFixed(2)}`)
      }

      return buckets
    } catch (error: any) {
      lastError = error
      const status = extractHttpStatusFromError(error)
      const retryable = isRetryableClusteringError(error)

      if (retryCount < maxRetries && retryable) {
        // 🔥 2025-12-27 优化：添加随机抖动，避免重试风暴
        const baseDelayMs = baseDelay * Math.pow(2, retryCount)
        const jitter = Math.random() * 2000  // 0-2秒随机抖动
        const delay = Math.min(baseDelayMs + jitter, 60000)  // 最多60秒
        const errorInfo = status
          ? `HTTP ${status} ${status === 504 ? '(Gateway Timeout)' : ''}`
          : String(error?.message || '').substring(0, 80)
        console.warn(`⚠️ AI 聚类第 ${retryCount + 1} 次失败 (${errorInfo})，${(delay / 1000).toFixed(1)}s 后重试...`)
        console.warn(`   错误: ${error.message}`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }

      console.error('❌ AI 语义聚类失败:', error.message)
      throw new Error(`关键词AI语义分类失败: ${error.message}`)
    }
  }

  throw new Error(`关键词AI语义分类失败（重试${maxRetries}次均失败）: ${lastError?.message || '未知错误'}`)
}

/**
 * 创建空桶
 */
function createEmptyBuckets(): KeywordBuckets {
  return {
    bucketA: { ...DEFAULT_PRODUCT_CLUSTER_BUCKETS.A, keywords: [] },
    bucketB: { ...DEFAULT_PRODUCT_CLUSTER_BUCKETS.B, keywords: [] },
    bucketC: { ...DEFAULT_PRODUCT_CLUSTER_BUCKETS.C, keywords: [] },
    bucketD: { ...DEFAULT_PRODUCT_CLUSTER_BUCKETS.D, keywords: [] },
    statistics: { totalKeywords: 0, bucketACount: 0, bucketBCount: 0, bucketCCount: 0, bucketDCount: 0, balanceScore: 1.0 }
  }
}

/**
 * 🆕 v4.16: 创建店铺链接空桶（5个桶）
 */
function createEmptyStoreBuckets(): StoreKeywordBuckets {
  return {
    bucketA: { ...DEFAULT_STORE_CLUSTER_BUCKETS.A, keywords: [] },
    bucketB: { ...DEFAULT_STORE_CLUSTER_BUCKETS.B, keywords: [] },
    bucketC: { ...DEFAULT_STORE_CLUSTER_BUCKETS.C, keywords: [] },
    bucketD: { ...DEFAULT_STORE_CLUSTER_BUCKETS.D, keywords: [] },
    bucketS: { ...DEFAULT_STORE_CLUSTER_BUCKETS.S, keywords: [] },
    statistics: { totalKeywords: 0, bucketACount: 0, bucketBCount: 0, bucketCCount: 0, bucketDCount: 0, bucketSCount: 0, balanceScore: 1.0 }
  }
}

/**
 * 验证桶结果
 */
function validateBuckets(buckets: KeywordBuckets, originalKeywords: string[]): void {
  // 🔥 2025-12-22 添加安全检查，防止undefined错误
  if (!buckets) {
    throw new Error('聚类结果为空')
  }

  const allBucketKeywords = [
    ...(buckets.bucketA?.keywords || []),
    ...(buckets.bucketB?.keywords || []),
    ...(buckets.bucketC?.keywords || []),
    ...(buckets.bucketD?.keywords || [])
  ]

  // 检查是否有遗漏
  const missing = originalKeywords.filter(kw =>
    !allBucketKeywords.some(bkw => bkw.toLowerCase() === kw.toLowerCase())
  )

  if (missing.length > 0) {
    console.warn(`⚠️ 有 ${missing.length} 个关键词未分配到桶中:`, missing.slice(0, 5))
  }

  // 检查是否有重复
  const seen = new Set<string>()
  const duplicates: string[] = []
  for (const kw of allBucketKeywords) {
    const lower = kw.toLowerCase()
    if (seen.has(lower)) {
      duplicates.push(kw)
    }
    seen.add(lower)
  }

  if (duplicates.length > 0) {
    console.warn(`⚠️ 有 ${duplicates.length} 个关键词重复分配:`, duplicates.slice(0, 5))
  }
}

/**
 * 🆕 v4.16: 验证店铺桶结果（5个桶）
 * 🔥 2025-12-24: 添加均衡性检查，不均衡时抛出错误让上层重试
 */
function validateStoreBuckets(buckets: StoreKeywordBuckets, originalKeywords: string[]): void {
  if (!buckets) {
    throw new Error('店铺聚类结果为空')
  }

  const allBucketKeywords = [
    ...(buckets.bucketA?.keywords || []),
    ...(buckets.bucketB?.keywords || []),
    ...(buckets.bucketC?.keywords || []),
    ...(buckets.bucketD?.keywords || []),
    ...(buckets.bucketS?.keywords || [])
  ]

  // 检查是否有遗漏
  const missing = originalKeywords.filter(kw =>
    !allBucketKeywords.some(bkw => bkw.toLowerCase() === kw.toLowerCase())
  )

  if (missing.length > 0) {
    console.warn(`⚠️ 有 ${missing.length} 个店铺关键词未分配到桶中:`, missing.slice(0, 5))
  }

  // 检查是否有重复
  const seen = new Set<string>()
  const duplicates: string[] = []
  for (const kw of allBucketKeywords) {
    const lower = kw.toLowerCase()
    if (seen.has(lower)) {
      duplicates.push(kw)
    }
    seen.add(lower)
  }

  if (duplicates.length > 0) {
    console.warn(`⚠️ 有 ${duplicates.length} 个店铺关键词重复分配:`, duplicates.slice(0, 5))
  }

  // 🔥 2025-12-24 新增：均衡性检查
  const counts = [
    buckets.bucketA?.keywords?.length || 0,
    buckets.bucketB?.keywords?.length || 0,
    buckets.bucketC?.keywords?.length || 0,
    buckets.bucketD?.keywords?.length || 0,
    buckets.bucketS?.keywords?.length || 0
  ]
  const nonZeroCounts = counts.filter(c => c > 0).length
  const maxCount = Math.max(...counts)
  const minCount = Math.min(...counts.filter(c => c > 0))

  // 计算均衡度：使用 AI 报告的 balanceScore 或手动计算
  const reportedBalanceScore = buckets.statistics?.balanceScore ?? calculateBalanceScore(counts)

  // 打印各桶分布情况，便于调试
  console.log(`   📊 店铺桶分布: A=${counts[0]}, B=${counts[1]}, C=${counts[2]}, D=${counts[3]}, S=${counts[4]}`)
  console.log(`   📊 有效桶数: ${nonZeroCounts}/5, 最大桶=${maxCount}, 最小非空桶=${minCount}`)
  console.log(`   📊 均衡度: ${reportedBalanceScore.toFixed(2)}`)

  // ⚠️ 2026-01-11: 店铺链接在小样本/概念型站点（如SaaS落地页）上，AI 可能倾向把词都放到桶S。
  // 这里不再直接抛错阻断创意生成，而是记录告警；上层会做兜底分桶/默认关键词降级。
  if (originalKeywords.length >= 8 && nonZeroCounts <= 1) {
    const warnMsg = `聚类结果不均衡: 只有 ${nonZeroCounts}/5 个桶有数据 (A=${counts[0]}, B=${counts[1]}, C=${counts[2]}, D=${counts[3]}, S=${counts[4]})`
    console.warn(`⚠️ ${warnMsg}`)
  }

  if (reportedBalanceScore < 0.2 && originalKeywords.length >= 20) {
    const warnMsg = `聚类均衡度偏低: ${reportedBalanceScore.toFixed(2)} < 0.2 (A=${counts[0]}, B=${counts[1]}, C=${counts[2]}, D=${counts[3]}, S=${counts[4]})`
    console.warn(`⚠️ ${warnMsg}`)
  }
}

/**
 * 🔥 2025-12-24: 计算均衡度
 */
function calculateBalanceScore(counts: number[]): number {
  if (counts.length === 0) return 1.0
  const total = counts.reduce((a, b) => a + b, 0)
  if (total === 0) return 1.0
  const avg = total / counts.length
  const maxDiff = Math.max(...counts.map(c => Math.abs(c - avg)))
  return Math.max(0, 1 - (maxDiff / total))
}

function normalizeKeywordsForBuckets(keywords: string[]): string[] {
  const unique = new Map<string, string>()
  for (const kw of keywords) {
    const trimmed = String(kw || '').trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (!unique.has(key)) unique.set(key, trimmed)
  }
  return Array.from(unique.values())
}

function recalculateStoreBucketStatistics(buckets: StoreKeywordBuckets): void {
  const counts = [
    buckets.bucketA?.keywords?.length || 0,
    buckets.bucketB?.keywords?.length || 0,
    buckets.bucketC?.keywords?.length || 0,
    buckets.bucketD?.keywords?.length || 0,
    buckets.bucketS?.keywords?.length || 0,
  ]

  const totalKeywords = counts.reduce((a, b) => a + b, 0)
  buckets.statistics.totalKeywords = totalKeywords
  buckets.statistics.bucketACount = counts[0]
  buckets.statistics.bucketBCount = counts[1]
  buckets.statistics.bucketCCount = counts[2]
  buckets.statistics.bucketDCount = counts[3]
  buckets.statistics.bucketSCount = counts[4]
  buckets.statistics.balanceScore = calculateBalanceScore(counts)
}

function recalculateBucketStatistics(buckets: KeywordBuckets): void {
  const counts = [
    buckets.bucketA?.keywords?.length || 0,
    buckets.bucketB?.keywords?.length || 0,
    buckets.bucketC?.keywords?.length || 0,
    buckets.bucketD?.keywords?.length || 0,
  ]

  const totalKeywords = counts.reduce((a, b) => a + b, 0)
  buckets.statistics.totalKeywords = totalKeywords
  buckets.statistics.bucketACount = counts[0]
  buckets.statistics.bucketBCount = counts[1]
  buckets.statistics.bucketCCount = counts[2]
  buckets.statistics.bucketDCount = counts[3]
  buckets.statistics.balanceScore = calculateBalanceScore(counts)
}

function filterBucketsToAllowedKeywords(
  buckets: KeywordBuckets | StoreKeywordBuckets,
  allowedKeywords: Set<string>
): void {
  const filterList = (list?: string[]) =>
    (list || []).filter(kw => allowedKeywords.has(String(kw || '').toLowerCase()))

  buckets.bucketA.keywords = filterList(buckets.bucketA.keywords)
  buckets.bucketB.keywords = filterList(buckets.bucketB.keywords)
  buckets.bucketC.keywords = filterList(buckets.bucketC.keywords)
  buckets.bucketD.keywords = filterList(buckets.bucketD.keywords)

  const storeBuckets = buckets as StoreKeywordBuckets
  if (storeBuckets.bucketS) {
    storeBuckets.bucketS.keywords = filterList(storeBuckets.bucketS.keywords)
    recalculateStoreBucketStatistics(storeBuckets)
  } else {
    recalculateBucketStatistics(buckets as KeywordBuckets)
  }
}

function redistributeStoreBucketsFromS(buckets: StoreKeywordBuckets, originalKeywords: string[]): void {
  const all = normalizeKeywordsForBuckets([
    ...originalKeywords,
    ...(buckets.bucketA?.keywords || []),
    ...(buckets.bucketB?.keywords || []),
    ...(buckets.bucketC?.keywords || []),
    ...(buckets.bucketD?.keywords || []),
    ...(buckets.bucketS?.keywords || []),
  ])

  if (all.length === 0) return

  const trustSignalsPattern =
    /\b(review|reviews|rating|ratings|testimonial|testimonials|feedback|support|customer\s*service|warranty|guarantee|refund|return|secure|security|privacy|trusted|trust)\b/i
  const sceneSolutionPattern =
    /\b(lonely|loneliness|wellness|mental|anxiety|stress|depression|therapy|support|growth|self[- ]?reflection|mindfulness|sleep|relationship|friendship)\b/i
  const collectionPattern =
    /\b(best|top|popular|recommended|recommendation|features?|feature|compare|comparison|vs|alternatives?|examples?|templates?|list)\b/i
  const brandTrustPattern =
    /\b(official|authorized|authentic|download|app|signup|sign[- ]?up|login|subscribe|subscription|plan|pricing)\b/i
  const productTypePattern =
    /\b(ai|chatbot|assistant|companion|virtual|friend|conversation)\b/i

  const assigned: Record<'A' | 'B' | 'C' | 'D', string[]> = { A: [], B: [], C: [], D: [] }

  for (const kw of all) {
    const lower = kw.toLowerCase()
    if (trustSignalsPattern.test(lower)) {
      assigned.D.push(kw)
    } else if (sceneSolutionPattern.test(lower)) {
      assigned.B.push(kw)
    } else if (collectionPattern.test(lower)) {
      assigned.C.push(kw)
    } else if (brandTrustPattern.test(lower)) {
      assigned.A.push(kw)
    } else if (productTypePattern.test(lower)) {
      assigned.C.push(kw)
    } else {
      assigned.B.push(kw)
    }
  }

  // 确保 A/B/C/D 至少各有 1 个（当关键词数足够时）
  const bucketOrder: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D']
  if (all.length >= 4) {
    for (const target of bucketOrder) {
      if (assigned[target].length > 0) continue

      let donor: 'A' | 'B' | 'C' | 'D' | null = null
      let donorSize = 0
      for (const candidate of bucketOrder) {
        if (candidate === target) continue
        if (assigned[candidate].length > donorSize) {
          donor = candidate
          donorSize = assigned[candidate].length
        }
      }
      if (!donor || donorSize === 0) continue

      const moved = assigned[donor].pop()
      if (moved) assigned[target].push(moved)
    }
  }

  buckets.bucketA.keywords = normalizeKeywordsForBuckets(assigned.A)
  buckets.bucketB.keywords = normalizeKeywordsForBuckets(assigned.B)
  buckets.bucketC.keywords = normalizeKeywordsForBuckets(assigned.C)
  buckets.bucketD.keywords = normalizeKeywordsForBuckets(assigned.D)
  buckets.bucketS.keywords = all
  recalculateStoreBucketStatistics(buckets)
}

/**
 * 🔥 v4.18 新增：店铺桶后处理规则
 *
 * 目的：修正 AI 聚类可能的错误分配，作为双重保障
 *
 * 规则：
 * 1. 促销/价格词 → 从其他桶移到桶S
 * 2. 具体型号词 → 从桶A/B/D移到桶C
 * 3. 评价词 → 从桶A/B/C移到桶D
 * 4. 地理位置词 → 从桶A/B移到桶S
 */
function applyStoreBucketPostProcessing(buckets: StoreKeywordBuckets): void {
  console.log(`\n🔧 应用后处理规则修正关键词分配...`)

  let totalMoved = 0
  const moves: Array<{keyword: string; from: string; to: string; reason: string}> = []

  // 定义匹配规则
  const PROMO_PRICE_PATTERNS = /\b(discount|sale|deal|coupon|promo|code|offer|clearance|price|cost|cheap|affordable|budget)\b/i
  const MODEL_PATTERNS = /\b(s\d+|q\d+|s7|s8|q5|q7|max|ultra|pro(?!\s*store))\b/i  // 排除 "pro store"
  const REVIEW_PATTERNS = /\b(review|rating|testimonial|feedback|comment|opinion)\b/i
  const GEO_PATTERNS = /\b(locations?|near\s+me|delivery|shipping|local|store\s+finder)\b/i

  // 辅助函数：移动关键词
  const moveKeyword = (
    keyword: string,
    fromBucket: { intent: string; keywords: string[] },
    toBucket: { intent: string; keywords: string[] },
    fromName: string,
    toName: string,
    reason: string
  ) => {
    const index = fromBucket.keywords.indexOf(keyword)
    if (index > -1) {
      fromBucket.keywords.splice(index, 1)
      toBucket.keywords.push(keyword)
      totalMoved++
      moves.push({ keyword, from: fromName, to: toName, reason })
    }
  }

  // 规则1：促销/价格词 → 桶S
  for (const keyword of [...buckets.bucketA.keywords]) {
    if (PROMO_PRICE_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketA, buckets.bucketS, '桶A', '桶S', '含促销/价格词')
    }
  }
  for (const keyword of [...buckets.bucketB.keywords]) {
    if (PROMO_PRICE_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketB, buckets.bucketS, '桶B', '桶S', '含促销/价格词')
    }
  }
  for (const keyword of [...buckets.bucketC.keywords]) {
    if (PROMO_PRICE_PATTERNS.test(keyword) && !MODEL_PATTERNS.test(keyword)) {
      // 如果同时包含型号词，优先保留在桶C（如 "s8 price" 可以在桶C）
      moveKeyword(keyword, buckets.bucketC, buckets.bucketS, '桶C', '桶S', '含促销/价格词')
    }
  }
  for (const keyword of [...buckets.bucketD.keywords]) {
    if (PROMO_PRICE_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketD, buckets.bucketS, '桶D', '桶S', '含促销/价格词')
    }
  }

  // 规则2：具体型号词 → 桶C
  for (const keyword of [...buckets.bucketA.keywords]) {
    if (MODEL_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketA, buckets.bucketC, '桶A', '桶C', '含具体型号')
    }
  }
  for (const keyword of [...buckets.bucketB.keywords]) {
    if (MODEL_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketB, buckets.bucketC, '桶B', '桶C', '含具体型号')
    }
  }
  for (const keyword of [...buckets.bucketD.keywords]) {
    if (MODEL_PATTERNS.test(keyword) && !REVIEW_PATTERNS.test(keyword)) {
      // 如果同时包含评价词，优先保留在桶D（如 "s8 review" 可以在桶D）
      moveKeyword(keyword, buckets.bucketD, buckets.bucketC, '桶D', '桶C', '含具体型号')
    }
  }
  for (const keyword of [...buckets.bucketS.keywords]) {
    if (MODEL_PATTERNS.test(keyword) && !PROMO_PRICE_PATTERNS.test(keyword)) {
      // 如果同时包含促销词，保留在桶S（如 "s8 discount" 保留在桶S）
      moveKeyword(keyword, buckets.bucketS, buckets.bucketC, '桶S', '桶C', '含具体型号')
    }
  }

  // 规则3：评价词 → 桶D
  for (const keyword of [...buckets.bucketA.keywords]) {
    if (REVIEW_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketA, buckets.bucketD, '桶A', '桶D', '含评价词')
    }
  }
  for (const keyword of [...buckets.bucketB.keywords]) {
    if (REVIEW_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketB, buckets.bucketD, '桶B', '桶D', '含评价词')
    }
  }
  for (const keyword of [...buckets.bucketC.keywords]) {
    if (REVIEW_PATTERNS.test(keyword) && !MODEL_PATTERNS.test(keyword)) {
      // 如果同时包含型号词，保留在桶C（如 "s8 review" 可能在桶C，让它保留）
      moveKeyword(keyword, buckets.bucketC, buckets.bucketD, '桶C', '桶D', '含评价词')
    }
  }

  // 规则4：地理位置词 → 桶S
  for (const keyword of [...buckets.bucketA.keywords]) {
    if (GEO_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketA, buckets.bucketS, '桶A', '桶S', '含地理位置')
    }
  }
  for (const keyword of [...buckets.bucketB.keywords]) {
    if (GEO_PATTERNS.test(keyword)) {
      moveKeyword(keyword, buckets.bucketB, buckets.bucketS, '桶B', '桶S', '含地理位置')
    }
  }

  // 更新统计数据
  buckets.statistics.bucketACount = buckets.bucketA.keywords.length
  buckets.statistics.bucketBCount = buckets.bucketB.keywords.length
  buckets.statistics.bucketCCount = buckets.bucketC.keywords.length
  buckets.statistics.bucketDCount = buckets.bucketD.keywords.length
  buckets.statistics.bucketSCount = buckets.bucketS.keywords.length

  // 重新计算均衡度
  const counts = [
    buckets.statistics.bucketACount,
    buckets.statistics.bucketBCount,
    buckets.statistics.bucketCCount,
    buckets.statistics.bucketDCount,
    buckets.statistics.bucketSCount
  ]
  buckets.statistics.balanceScore = calculateBalanceScore(counts)

  // 输出日志
  if (totalMoved > 0) {
    console.log(`   ✅ 后处理完成：移动 ${totalMoved} 个关键词`)
    moves.slice(0, 10).forEach(m => {
      console.log(`      "${m.keyword}" (${m.from} → ${m.to}: ${m.reason})`)
    })
    if (moves.length > 10) {
      console.log(`      ... 共 ${moves.length} 个移动`)
    }
  } else {
    console.log(`   ✅ 后处理完成：无需调整（AI聚类已正确）`)
  }
}

// 🔧 2026-03-26: 保持 AI 聚类优先；当上游不可用时允许确定性分桶降级，避免创意流程被硬阻断。

// ============================================
// 关键词池数据库操作
// ============================================

function serializeKeywordArrayForDb(data: unknown, dbType: DatabaseType): unknown {
  return toDbJsonArrayField(data, dbType, [])
}

function parseKeywordArrayFromDb(data: unknown): unknown[] {
  return parseJsonField<unknown[]>(data, [])
}

const KEYWORD_CLUSTERING_PROMPT_ID = 'keyword_intent_clustering'
const KEYWORD_CLUSTERING_PROMPT_VERSION_FALLBACK = 'v4.19'

async function resolveActivePromptVersion(
  db: Awaited<ReturnType<typeof getDatabase>>,
  promptId: string,
  fallbackVersion: string
): Promise<string> {
  try {
    const isActiveCondition = db.type === 'postgres' ? 'is_active = TRUE' : 'is_active = 1'
    const activePrompt = await db.queryOne<{ version: string }>(
      `SELECT version
       FROM prompt_versions
       WHERE prompt_id = ? AND ${isActiveCondition}
       ORDER BY created_at DESC
       LIMIT 1`,
      [promptId]
    )

    return activePrompt?.version || fallbackVersion
  } catch (error: any) {
    console.warn(`[resolveActivePromptVersion] Failed to resolve active version for ${promptId}:`, error?.message || error)
    return fallbackVersion
  }
}

/**
 * 保存关键词池到数据库
 */
export async function saveKeywordPool(
  offerId: number,
  userId: number,
  brandKeywords: string[],
  buckets: KeywordBuckets,
  model?: string,
  promptVersion?: string
): Promise<OfferKeywordPool> {
  const db = await getDatabase()
  const resolvedPromptVersion = promptVersion || await resolveActivePromptVersion(
    db,
    KEYWORD_CLUSTERING_PROMPT_ID,
    KEYWORD_CLUSTERING_PROMPT_VERSION_FALLBACK
  )

  const totalKeywords = brandKeywords.length +
    buckets.bucketA.keywords.length +
    buckets.bucketB.keywords.length +
    buckets.bucketC.keywords.length +
    buckets.bucketD.keywords.length

  // 检查是否已存在
  const existing = await db.queryOne<{ id: number }>(
    'SELECT id FROM offer_keyword_pools WHERE offer_id = ?',
    [offerId]
  )

  // 🔥 2025-12-16修复：使用统一的JSON序列化函数
  const brandKwJson = serializeKeywordArrayForDb(brandKeywords, db.type)
  const bucketAJson = serializeKeywordArrayForDb(buckets.bucketA.keywords, db.type)
  const bucketBJson = serializeKeywordArrayForDb(buckets.bucketB.keywords, db.type)
  const bucketCJson = serializeKeywordArrayForDb(buckets.bucketC.keywords, db.type)
  const bucketDJson = serializeKeywordArrayForDb(buckets.bucketD.keywords, db.type)

  console.log(`📊 保存关键词池 (dbType=${db.type}):`)
  console.log(`   brand_keywords: ${brandKeywords.length}个 → ${typeof brandKwJson}`)
  console.log(`   bucket_a: ${buckets.bucketA.keywords.length}个`)
  console.log(`   bucket_b: ${buckets.bucketB.keywords.length}个`)
  console.log(`   bucket_c: ${buckets.bucketC.keywords.length}个`)
  console.log(`   bucket_d: ${buckets.bucketD.keywords.length}个`)

  if (existing) {
    // 更新现有记录
    await db.exec(
      `UPDATE offer_keyword_pools SET
        brand_keywords = ?,
        bucket_a_keywords = ?,
        bucket_b_keywords = ?,
        bucket_c_keywords = ?,
        bucket_d_keywords = ?,
        bucket_a_intent = ?,
        bucket_b_intent = ?,
        bucket_c_intent = ?,
        bucket_d_intent = ?,
        total_keywords = ?,
        clustering_model = ?,
        clustering_prompt_version = ?,
        balance_score = ?,
        updated_at = ${db.type === 'postgres' ? 'NOW()' : "datetime('now')"}
      WHERE offer_id = ?`,
      [
        brandKwJson,
        bucketAJson,
        bucketBJson,
        bucketCJson,
        bucketDJson,
        buckets.bucketA.intent,
        buckets.bucketB.intent,
        buckets.bucketC.intent,
        buckets.bucketD.intent,
        totalKeywords,
        model || null,
        resolvedPromptVersion,
        buckets.statistics.balanceScore,
        offerId
      ]
    )

    console.log(`✅ 关键词池已更新: Offer #${offerId}`)
    return getKeywordPoolByOfferId(offerId) as Promise<OfferKeywordPool>
  }

  // 创建新记录
  const result = await db.exec(
    `INSERT INTO offer_keyword_pools (
      offer_id, user_id,
      brand_keywords,
      bucket_a_keywords, bucket_b_keywords, bucket_c_keywords, bucket_d_keywords,
      bucket_a_intent, bucket_b_intent, bucket_c_intent, bucket_d_intent,
      total_keywords, clustering_model, clustering_prompt_version, balance_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      offerId,
      userId,
      brandKwJson,
      bucketAJson,
      bucketBJson,
      bucketCJson,
      bucketDJson,
      buckets.bucketA.intent,
      buckets.bucketB.intent,
      buckets.bucketC.intent,
      buckets.bucketD.intent,
      totalKeywords,
      model || null,
      resolvedPromptVersion,
      buckets.statistics.balanceScore
    ]
  )

  console.log(`✅ 关键词池已创建: Offer #${offerId}, ID #${result.lastInsertRowid}`)
  return getKeywordPoolByOfferId(offerId) as Promise<OfferKeywordPool>
}

/**
 * 🆕 保存关键词池（PoolKeywordData[] 版本）
 * 🔥 2025-12-22: 添加bucketD支持
 * 🆕 v4.16: 支持店铺链接的5桶存储
 */
async function saveKeywordPoolWithData(
  offerId: number,
  userId: number,
  brandKeywords: PoolKeywordData[],
  buckets: {
    bucketA: { intent: string; keywords: PoolKeywordData[] }
    bucketB: { intent: string; keywords: PoolKeywordData[] }
    bucketC: { intent: string; keywords: PoolKeywordData[] }
    bucketD: { intent: string; keywords: PoolKeywordData[] }
    statistics: { totalKeywords: number; balanceScore: number }
  },
  pageType: 'product' | 'store' = 'product',
  storeBuckets?: StoreKeywordBuckets,  // 🆕 v4.16: 店铺桶数据（可选）
  storeBucketData?: {
    bucketA: PoolKeywordData[]
    bucketB: PoolKeywordData[]
    bucketC: PoolKeywordData[]
    bucketD: PoolKeywordData[]
    bucketS: PoolKeywordData[]
  }
): Promise<OfferKeywordPool> {
  const db = await getDatabase()
  const clusteringPromptVersion = await resolveActivePromptVersion(
    db,
    KEYWORD_CLUSTERING_PROMPT_ID,
    KEYWORD_CLUSTERING_PROMPT_VERSION_FALLBACK
  )

  const brandKwJson = serializeKeywordArrayForDb(brandKeywords, db.type)
  const bucketAJson = serializeKeywordArrayForDb(buckets.bucketA.keywords, db.type)
  const bucketBJson = serializeKeywordArrayForDb(buckets.bucketB.keywords, db.type)
  const bucketCJson = serializeKeywordArrayForDb(buckets.bucketC.keywords, db.type)
  const bucketDJson = serializeKeywordArrayForDb(buckets.bucketD.keywords, db.type)
  const emptyArrayJson = serializeKeywordArrayForDb([], db.type)

  // 🆕 v4.16: 店铺分桶JSON（优先保存带搜索量的数据）
  const storeBucketAJson = storeBucketData
    ? serializeKeywordArrayForDb(storeBucketData.bucketA, db.type)
    : (storeBuckets ? serializeKeywordArrayForDb(storeBuckets.bucketA.keywords, db.type) : emptyArrayJson)
  const storeBucketBJson = storeBucketData
    ? serializeKeywordArrayForDb(storeBucketData.bucketB, db.type)
    : (storeBuckets ? serializeKeywordArrayForDb(storeBuckets.bucketB.keywords, db.type) : emptyArrayJson)
  const storeBucketCJson = storeBucketData
    ? serializeKeywordArrayForDb(storeBucketData.bucketC, db.type)
    : (storeBuckets ? serializeKeywordArrayForDb(storeBuckets.bucketC.keywords, db.type) : emptyArrayJson)
  const storeBucketDJson = storeBucketData
    ? serializeKeywordArrayForDb(storeBucketData.bucketD, db.type)
    : (storeBuckets ? serializeKeywordArrayForDb(storeBuckets.bucketD.keywords, db.type) : emptyArrayJson)
  const storeBucketSJson = storeBucketData
    ? serializeKeywordArrayForDb(storeBucketData.bucketS, db.type)
    : (storeBuckets ? serializeKeywordArrayForDb(storeBuckets.bucketS.keywords, db.type) : emptyArrayJson)

  const totalKeywords = brandKeywords.length + buckets.bucketA.keywords.length + buckets.bucketB.keywords.length + buckets.bucketC.keywords.length + buckets.bucketD.keywords.length

  // 检查是否已存在
  const existing = await db.queryOne<{ id: number }>(
    'SELECT id FROM offer_keyword_pools WHERE offer_id = ?',
    [offerId]
  )

  // 🆕 v4.16: 店铺分桶意图
  const storeBucketAIntent = storeBuckets?.bucketA.intent || DEFAULT_STORE_CLUSTER_BUCKETS.A.intent
  const storeBucketBIntent = storeBuckets?.bucketB.intent || DEFAULT_STORE_CLUSTER_BUCKETS.B.intent
  const storeBucketCIntent = storeBuckets?.bucketC.intent || DEFAULT_STORE_CLUSTER_BUCKETS.C.intent
  const storeBucketDIntent = storeBuckets?.bucketD.intent || DEFAULT_STORE_CLUSTER_BUCKETS.D.intent
  const storeBucketSIntent = storeBuckets?.bucketS.intent || DEFAULT_STORE_CLUSTER_BUCKETS.S.intent

  if (existing) {
    // 🆕 v4.16: 更新现有记录（包含店铺分桶）
    const updateFields = [
      'brand_keywords = ?',
      'bucket_a_keywords = ?',
      'bucket_b_keywords = ?',
      'bucket_c_keywords = ?',
      'bucket_d_keywords = ?',
      'bucket_a_intent = ?',
      'bucket_b_intent = ?',
      'bucket_c_intent = ?',
      'bucket_d_intent = ?',
      'total_keywords = ?',
      'clustering_model = ?',
      'clustering_prompt_version = ?',
      'balance_score = ?',
      'link_type = ?',
      'store_bucket_a_keywords = ?',
      'store_bucket_b_keywords = ?',
      'store_bucket_c_keywords = ?',
      'store_bucket_d_keywords = ?',
      'store_bucket_s_keywords = ?',
      'store_bucket_a_intent = ?',
      'store_bucket_b_intent = ?',
      'store_bucket_c_intent = ?',
      'store_bucket_d_intent = ?',
      'store_bucket_s_intent = ?',
      `updated_at = ${db.type === 'postgres' ? 'NOW()' : "datetime('now')"}`
    ]

    const updateValues = [
      brandKwJson,
      bucketAJson,
      bucketBJson,
      bucketCJson,
      bucketDJson,
      buckets.bucketA.intent,
      buckets.bucketB.intent,
      buckets.bucketC.intent,
      buckets.bucketD.intent,
      totalKeywords,
      'gemini',  // model
      clusteringPromptVersion,
      buckets.statistics.balanceScore,
      pageType,
      storeBucketAJson,
      storeBucketBJson,
      storeBucketCJson,
      storeBucketDJson,
      storeBucketSJson,
      storeBucketAIntent,
      storeBucketBIntent,
      storeBucketCIntent,
      storeBucketDIntent,
      storeBucketSIntent,
      offerId
    ]

    await db.exec(
      `UPDATE offer_keyword_pools SET ${updateFields.join(', ')} WHERE offer_id = ?`,
      updateValues
    )

    console.log(`✅ 关键词池已更新: Offer #${offerId} (${pageType}链接)`)
    return getKeywordPoolByOfferId(offerId) as Promise<OfferKeywordPool>
  }

  // 🆕 v4.16: 创建新记录（包含店铺分桶）
  const insertFields = [
    'offer_id', 'user_id',
    'brand_keywords',
    'bucket_a_keywords', 'bucket_b_keywords', 'bucket_c_keywords', 'bucket_d_keywords',
    'bucket_a_intent', 'bucket_b_intent', 'bucket_c_intent', 'bucket_d_intent',
    'total_keywords', 'clustering_model', 'clustering_prompt_version', 'balance_score',
    'link_type',
    'store_bucket_a_keywords', 'store_bucket_b_keywords', 'store_bucket_c_keywords', 'store_bucket_d_keywords', 'store_bucket_s_keywords',
    'store_bucket_a_intent', 'store_bucket_b_intent', 'store_bucket_c_intent', 'store_bucket_d_intent', 'store_bucket_s_intent'
  ]

  const insertValues = [
    offerId,
    userId,
    brandKwJson,
    bucketAJson,
    bucketBJson,
    bucketCJson,
    bucketDJson,
    buckets.bucketA.intent,
    buckets.bucketB.intent,
    buckets.bucketC.intent,
    buckets.bucketD.intent,
    totalKeywords,
    'gemini',
    clusteringPromptVersion,
    buckets.statistics.balanceScore,
    pageType,
    storeBucketAJson,
    storeBucketBJson,
    storeBucketCJson,
    storeBucketDJson,
    storeBucketSJson,
    storeBucketAIntent,
    storeBucketBIntent,
    storeBucketCIntent,
    storeBucketDIntent,
    storeBucketSIntent
  ]

  const placeholders = insertFields.map(() => '?').join(', ')

  const result = await db.exec(
    `INSERT INTO offer_keyword_pools (${insertFields.join(', ')}) VALUES (${placeholders})`,
    insertValues
  )

  console.log(`✅ 关键词池已创建: Offer #${offerId}, ID #${result.lastInsertRowid} (${pageType}链接, 店铺5桶: ${storeBuckets ? '是' : '否'})`)
  return getKeywordPoolByOfferId(offerId) as Promise<OfferKeywordPool>
}

function extractCategorySignalsFromScrapedData(scrapedData: string | null | undefined): string[] {
  if (!scrapedData) return []

  try {
    const parsed = JSON.parse(scrapedData)
    if (!parsed || typeof parsed !== 'object') return []

    const candidates: string[] = []
    const push = (value: unknown) => {
      if (typeof value !== 'string') return
      const trimmed = value.trim()
      if (trimmed) candidates.push(trimmed)
    }

    push((parsed as any).productCategory)
    push((parsed as any).category)

    const primaryCategories = (parsed as any)?.productCategories?.primaryCategories
    if (Array.isArray(primaryCategories)) {
      for (const item of primaryCategories) {
        push(item?.name)
      }
    }

    const breadcrumbs = (parsed as any)?.breadcrumbs
    if (Array.isArray(breadcrumbs)) {
      for (const item of breadcrumbs) {
        push(item)
      }
    }

    if (candidates.length === 0) return []
    return Array.from(new Set(candidates))
  } catch {
    return []
  }
}

const STRUCTURED_MODEL_TOKEN_RE = /\b[A-Z]{1,4}[- ]?\d{2,6}[A-Z0-9-]{0,8}\b/g
const STRUCTURED_SPEC_TOKEN_RE = /\b\d{2,5}\s?(?:gpd|btu|mah|wh|w|kw|v|psi|db|hz|khz|mhz|ghz|mm|cm|inch|in|ft|l|ml|kg|lb|lbs)\b/ig
const STRUCTURED_CERT_TOKEN_RE = /\b(?:nsf\s*\/?\s*ansi\s*\d{1,3}|nsf\s*\d{1,3}|ansi\s*\d{1,3}|etl|ul|fcc|ce|rohs)\b/ig
const STRUCTURED_PRODUCT_CORE_STOPWORDS = new Set([
  'for', 'with', 'without', 'and', 'the', 'new', 'best', 'official', 'store',
  'system', 'model', 'series', 'version', 'kit', 'set', 'pack',
])
const TARGET_LANGUAGE_TRANSLATION_MAX_BATCH_SIZE = 24
const TARGET_LANGUAGE_TRANSLATION_NEUTRAL_TOKENS = new Set([
  'nsf', 'ansi', 'etl', 'ul', 'fcc', 'ce', 'rohs',
  'gpd', 'btu', 'mah', 'wh', 'w', 'kw', 'v', 'psi', 'db', 'hz', 'khz', 'mhz', 'ghz',
  'mm', 'cm', 'inch', 'in', 'ft', 'l', 'ml', 'kg', 'lb', 'lbs',
])

function parseBooleanFeatureFlag(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return fallback
}

function splitIntoChunks<T>(items: T[], size: number): T[][] {
  const chunkSize = Math.max(1, Math.floor(size))
  const chunks: T[][] = []
  for (let start = 0; start < items.length; start += chunkSize) {
    chunks.push(items.slice(start, start + chunkSize))
  }
  return chunks
}

function buildTranslationPrompt(params: {
  targetLanguage: string
  keywords: string[]
}): string {
  const numbered = params.keywords
    .map((keyword, index) => `${index}. ${keyword}`)
    .join('\n')

  return [
    `Translate the following ad keyword phrases into target language: ${params.targetLanguage}.`,
    'Rules:',
    '- Keep brand names unchanged.',
    '- Keep model tokens and SKU-style alphanumeric tokens unchanged (e.g. X10, G3P800).',
    '- Keep certification and specification tokens unchanged (e.g. NSF/ANSI 58, 1200 GPD, BTU).',
    '- Return JSON only in this exact shape:',
    '{"translations":[{"index":0,"keyword":"translated phrase"}]}',
    '- Use the same index values as input lines.',
    '- Do not skip lines, do not add extra lines.',
    '',
    'Input keywords:',
    numbered,
  ].join('\n')
}

function parseTranslationResponse(
  text: string
): Array<{ index: number; keyword: string }> {
  const parseRawJson = (rawText: string): any => {
    return JSON.parse(rawText)
  }

  const parseCandidates = [text]
  const firstJson = extractFirstJsonObject(text)
  if (firstJson) parseCandidates.push(firstJson)

  let parsed: any = null
  for (const candidate of parseCandidates) {
    try {
      parsed = parseRawJson(candidate)
      break
    } catch {
      try {
        parsed = parseRawJson(repairJsonText(candidate))
        break
      } catch {
        // Ignore and continue trying the next candidate.
      }
    }
  }

  if (!parsed || typeof parsed !== 'object') return []
  const translations = Array.isArray((parsed as any).translations) ? (parsed as any).translations : []

  return translations
    .map((item: any) => ({
      index: Number(item?.index),
      keyword: String(item?.keyword || '').trim(),
    }))
    .filter((item: { index: number; keyword: string }) =>
      Number.isInteger(item.index) && item.index >= 0 && item.keyword.length > 0
    )
}

function buildTranslationNeutralTokenSet(pureBrandKeywords: string[]): Set<string> {
  const out = new Set<string>(TARGET_LANGUAGE_TRANSLATION_NEUTRAL_TOKENS)
  for (const brandKeyword of pureBrandKeywords) {
    const normalized = normalizeGoogleAdsKeyword(brandKeyword) || ''
    if (!normalized) continue
    for (const token of normalized.split(/\s+/).filter(Boolean)) {
      out.add(token)
    }
  }
  return out
}

function isNeutralTokenForTranslation(token: string, neutralTokens: Set<string>): boolean {
  if (!token) return true
  if (neutralTokens.has(token)) return true
  if (/^\d+$/.test(token)) return true
  if (/^[a-z]*\d+[a-z0-9-]*$/i.test(token)) return true
  if (/^\d+[a-z]{1,4}$/i.test(token)) return true
  return false
}

function shouldAttemptTranslationForKeyword(params: {
  keyword: string
  pureBrandKeywords: string[]
}): boolean {
  const normalized = normalizeGoogleAdsKeyword(params.keyword)
  if (!normalized) return false
  if (isPureBrandKeywordInternal(normalized, params.pureBrandKeywords)) return false

  const neutralTokens = buildTranslationNeutralTokenSet(params.pureBrandKeywords)
  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return false

  const hasNonNeutralToken = tokens.some((token) =>
    !isNeutralTokenForTranslation(token, neutralTokens)
  )
  return hasNonNeutralToken
}

async function translateKeywordsToTargetLanguage(params: {
  userId?: number
  targetLanguage?: string | null
  keywords: string[]
}): Promise<Map<string, string>> {
  const userId = Number(params.userId)
  const targetLanguage = String(params.targetLanguage || '').trim()
  const translationEnabled = parseBooleanFeatureFlag(
    process.env.OFFER_KEYWORD_TARGET_LANGUAGE_TRANSLATION_ENABLED,
    true
  )
  const out = new Map<string, string>()

  if (!translationEnabled || !Number.isFinite(userId) || userId <= 0) return out
  if (!targetLanguage || params.keywords.length === 0) return out

  for (const chunk of splitIntoChunks(params.keywords, TARGET_LANGUAGE_TRANSLATION_MAX_BATCH_SIZE)) {
    const uniqueChunkKeywords = Array.from(new Set(
      chunk.map((keyword) => String(keyword || '').trim()).filter(Boolean)
    ))
    if (uniqueChunkKeywords.length === 0) continue

    try {
      const aiResponse = await generateContent({
        operationType: 'keyword_translation_normalization',
        prompt: buildTranslationPrompt({
          targetLanguage,
          keywords: uniqueChunkKeywords,
        }),
        temperature: 0.1,
        maxOutputTokens: 2048,
        responseSchema: {
          type: 'OBJECT',
          properties: {
            translations: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  index: { type: 'INTEGER' },
                  keyword: { type: 'STRING' },
                },
                required: ['index', 'keyword'],
              },
            },
          },
          required: ['translations'],
        },
        responseMimeType: 'application/json',
      }, userId)

      if (aiResponse.usage) {
        const cost = estimateTokenCost(
          aiResponse.model,
          aiResponse.usage.inputTokens,
          aiResponse.usage.outputTokens
        )
        await recordTokenUsage({
          userId,
          model: aiResponse.model,
          operationType: 'keyword_translation_normalization',
          inputTokens: aiResponse.usage.inputTokens,
          outputTokens: aiResponse.usage.outputTokens,
          totalTokens: aiResponse.usage.totalTokens,
          cost,
          apiType: aiResponse.apiType,
        })
      }

      const parsed = parseTranslationResponse(aiResponse.text)
      for (const item of parsed) {
        const sourceKeyword = uniqueChunkKeywords[item.index]
        if (!sourceKeyword) continue
        const translated = String(item.keyword || '').trim()
        if (!translated) continue
        out.set(sourceKeyword, translated)
      }
    } catch (error: any) {
      console.warn(
        `[VerifiedSource] 目标语翻译失败，回退为语言过滤: ${error?.message || String(error)}`
      )
    }
  }

  return out
}

async function normalizeKeywordTermsByTargetLanguage(params: {
  userId?: number
  keywords: string[]
  targetLanguage?: string | null
  pureBrandKeywords: string[]
}): Promise<{ keywords: string[]; removed: number; translated: number }> {
  const out: string[] = []
  const seen = new Set<string>()
  let removed = 0
  let translated = 0
  const candidatesNeedingTranslation: string[] = []

  for (const rawKeyword of params.keywords) {
    const raw = String(rawKeyword || '').trim()
    const normalized = normalizeGoogleAdsKeyword(raw)
    if (!raw || !normalized) continue

    const compatibility = analyzeKeywordLanguageCompatibility({
      keyword: raw,
      targetLanguage: params.targetLanguage || undefined,
      pureBrandKeywords: params.pureBrandKeywords,
    })
    if (compatibility.hardReject) {
      if (shouldAttemptTranslationForKeyword({
        keyword: raw,
        pureBrandKeywords: params.pureBrandKeywords,
      })) {
        candidatesNeedingTranslation.push(raw)
        continue
      }
      removed += 1
      continue
    }

    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(raw)
  }

  if (candidatesNeedingTranslation.length > 0) {
    const translatedKeywordMap = await translateKeywordsToTargetLanguage({
      userId: params.userId,
      targetLanguage: params.targetLanguage,
      keywords: candidatesNeedingTranslation,
    })

    for (const sourceKeyword of candidatesNeedingTranslation) {
      const candidate = translatedKeywordMap.get(sourceKeyword) || sourceKeyword
      const normalizedCandidate = normalizeGoogleAdsKeyword(candidate)
      if (!normalizedCandidate) {
        removed += 1
        continue
      }

      const candidateCompatibility = analyzeKeywordLanguageCompatibility({
        keyword: candidate,
        targetLanguage: params.targetLanguage || undefined,
        pureBrandKeywords: params.pureBrandKeywords,
      })
      if (candidateCompatibility.hardReject) {
        removed += 1
        continue
      }

      if (seen.has(normalizedCandidate)) continue
      seen.add(normalizedCandidate)
      out.push(candidate)
      if (normalizeGoogleAdsKeyword(sourceKeyword) !== normalizedCandidate) {
        translated += 1
      }
    }
  }

  return { keywords: out, removed, translated }
}

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
      const normalized = match
        .toLowerCase()
        .replace(/[\/]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
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
  const tokens = (normalizeGoogleAdsKeyword([
    String(offer.product_name || ''),
    String((offer as any).product_title || ''),
    String(offer.category || ''),
  ].join(' ')) || '')
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
    entities.modelTokens.length === 0
    && entities.specTokens.length === 0
    && entities.certTokens.length === 0
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

const STORE_PRODUCT_LINK_URL_FIELDS = [
  'url',
  'link',
  'href',
  'productUrl',
  'productLink',
] as const

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
      .map(segment => normalizeStoreProductNameCandidate(safeDecodeUriComponent(segment)))
      .filter(Boolean)

    for (let i = pathSegments.length - 1; i >= 0; i -= 1) {
      const segment = pathSegments[i]
      if (/^(p|dp|gp|product|products|item|items|store|shop)$/i.test(segment)) continue
      pushCandidate(segment)
      break
    }

    for (const [key, value] of parsed.searchParams.entries()) {
      if (!STORE_PRODUCT_LINK_QUERY_NAME_KEYS.has(key.toLowerCase())) continue
      pushCandidate(safeDecodeUriComponent(value))
    }
  } catch {
    if (!/^https?:\/\//i.test(trimmed)) {
      pushCandidate(safeDecodeUriComponent(trimmed))
    }
  }

  return candidates
}

function extractStoreProductNamesFromLinks(storeProductLinks: unknown): string[] {
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
      const urlCandidates = extractStoreProductNameCandidatesFromUrl(item)
      if (urlCandidates.length > 0) {
        for (const candidate of urlCandidates) pushCandidate(candidate)
      } else {
        pushCandidate(item)
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

type VerifiedSourceNormalizationKey =
  | keyof VerifiedSourceKeywordMap
  | 'STRUCTURED_EXPANSION'

type NormalizedKeywordTermsResult = Awaited<ReturnType<typeof normalizeKeywordTermsByTargetLanguage>>

function createEmptyNormalizedKeywordTermsResult(): NormalizedKeywordTermsResult {
  return {
    keywords: [],
    removed: 0,
    translated: 0,
  }
}

function createEmptyVerifiedSourceNormalizationMap(): Record<VerifiedSourceNormalizationKey, NormalizedKeywordTermsResult> {
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
  return Object.values(normalizedByKey)
    .reduce((sum, item) => sum + Number(item[field] || 0), 0)
}

async function buildVerifiedSourceKeywordData(
  offer: Offer,
  userId?: number
): Promise<VerifiedSourceKeywordMap> {
  const brand = String(offer.brand || '').trim()
  if (!brand) return emptyVerifiedSourceKeywordMap()
  const storeProductNames = extractStoreProductNamesFromLinks(offer.store_product_links)

  const productFeatures = [offer.product_highlights, offer.unique_selling_points]
    .map(value => String(value || '').trim())
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
    console.log(
      `[VerifiedSource] 目标语净化移除 ${languageRemovedCount} 个候选词 (offer=${offer.id}, target=${targetLanguage || 'n/a'})`
    )
  }
  const translatedCount = sumVerifiedSourceNormalizationMetric(normalizedByKey, 'translated')
  if (translatedCount > 0) {
    console.log(
      `[VerifiedSource] 目标语净化翻译 ${translatedCount} 个候选词 (offer=${offer.id}, target=${targetLanguage || 'n/a'})`
    )
  }
  if (normalizedByKey.STRUCTURED_EXPANSION.keywords.length > 0) {
    console.log(
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
          source === 'HOT_PRODUCT_AGGREGATE' ? 0.98 :
          source === 'PARAM_EXTRACT' ? 0.96 :
          source === 'TITLE_EXTRACT' ? 0.94 :
          source === 'ABOUT_EXTRACT' ? 0.92 :
          0.9,
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
    HOT_PRODUCT_AGGREGATE: createKeywordData(normalizedByKey.HOT_PRODUCT_AGGREGATE.keywords, 'HOT_PRODUCT_AGGREGATE'),
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

function appendVerifiedKeywordsToBucket(params: {
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

/**
 * 🆕 解析关键词数组（向后兼容）
 * 处理新格式 PoolKeywordData[] 和旧格式 string[]
 */
function parseKeywordArray(data: unknown): PoolKeywordData[] {
  const parsed = parseKeywordArrayFromDb(data)

  if (!Array.isArray(parsed) || parsed.length === 0) return []

  // 新格式：PoolKeywordData[]
  if (typeof parsed[0] === 'object' && parsed[0] !== null && 'keyword' in parsed[0]) {
    return parsed as PoolKeywordData[]
  }

  // 旧格式：string[] - 转换为 PoolKeywordData[]
  return parsed
    .map((kw: unknown) => (typeof kw === 'string' ? kw : ''))
    .filter((kw) => kw.length > 0)
    .map((kw) => ({
      keyword: kw,
      searchVolume: 0,
      source: 'LEGACY',
      matchType: 'PHRASE'
    }))
}

/**
 * 根据 Offer ID 获取关键词池
 * 🆕 v4.16: 添加店铺分桶字段解析
 */
export async function getKeywordPoolByOfferId(offerId: number): Promise<OfferKeywordPool | null> {
  const db = await getDatabase()

  const row = await db.queryOne<any>(
    'SELECT * FROM offer_keyword_pools WHERE offer_id = ?',
    [offerId]
  )

  if (!row) return null

  // 🔥 2025-12-16升级：使用parseKeywordArray处理新旧格式
  // 🔥 2025-12-22：添加bucketDKeywords和bucketDIntent
  // 🔥 2025-12-24：添加店铺分桶字段
  return {
    id: row.id,
    offerId: row.offer_id,
    userId: row.user_id,
    brandKeywords: parseKeywordArray(row.brand_keywords),
    bucketAKeywords: parseKeywordArray(row.bucket_a_keywords),
    bucketBKeywords: parseKeywordArray(row.bucket_b_keywords),
    bucketCKeywords: parseKeywordArray(row.bucket_c_keywords),
    bucketDKeywords: parseKeywordArray(row.bucket_d_keywords ?? []),
    bucketAIntent: row.bucket_a_intent || DEFAULT_PRODUCT_CLUSTER_BUCKETS.A.intent,
    bucketBIntent: row.bucket_b_intent || DEFAULT_PRODUCT_CLUSTER_BUCKETS.B.intent,
    bucketCIntent: row.bucket_c_intent || DEFAULT_PRODUCT_CLUSTER_BUCKETS.C.intent,
    bucketDIntent: row.bucket_d_intent || DEFAULT_PRODUCT_CLUSTER_BUCKETS.D.intent,
    // 🆕 v4.16: 店铺分桶字段
    storeBucketAKeywords: parseKeywordArray(row.store_bucket_a_keywords ?? []),
    storeBucketBKeywords: parseKeywordArray(row.store_bucket_b_keywords ?? []),
    storeBucketCKeywords: parseKeywordArray(row.store_bucket_c_keywords ?? []),
    storeBucketDKeywords: parseKeywordArray(row.store_bucket_d_keywords ?? []),
    storeBucketSKeywords: parseKeywordArray(row.store_bucket_s_keywords ?? []),
    storeBucketAIntent: row.store_bucket_a_intent || DEFAULT_STORE_CLUSTER_BUCKETS.A.intent,
    storeBucketBIntent: row.store_bucket_b_intent || DEFAULT_STORE_CLUSTER_BUCKETS.B.intent,
    storeBucketCIntent: row.store_bucket_c_intent || DEFAULT_STORE_CLUSTER_BUCKETS.C.intent,
    storeBucketDIntent: row.store_bucket_d_intent || DEFAULT_STORE_CLUSTER_BUCKETS.D.intent,
    storeBucketSIntent: row.store_bucket_s_intent || DEFAULT_STORE_CLUSTER_BUCKETS.S.intent,
    linkType: row.link_type || 'product',
    totalKeywords: row.total_keywords,
    clusteringModel: row.clustering_model,
    clusteringPromptVersion: row.clustering_prompt_version,
    balanceScore: row.balance_score,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * 删除关键词池
 */
export async function deleteKeywordPool(offerId: number): Promise<void> {
  const db = await getDatabase()
  const existing = await db.queryOne<{ id: number }>(
    'SELECT id FROM offer_keyword_pools WHERE offer_id = ?',
    [offerId]
  )

  if (!existing) {
    console.log(`ℹ️ 关键词池不存在: Offer #${offerId}`)
    return
  }

  let cleared = 0
  await db.transaction(async () => {
    const clearResult = await db.exec(
      'UPDATE ad_creatives SET keyword_pool_id = NULL WHERE offer_id = ? AND keyword_pool_id = ?',
      [offerId, existing.id]
    )
    cleared = clearResult.changes
    await db.exec('DELETE FROM offer_keyword_pools WHERE id = ?', [existing.id])
  })

  console.log(`🗑️ 关键词池已删除: Offer #${offerId} (清理创意引用: ${cleared})`)
}

// ============================================
// 主要流程
// ============================================

/**
 * 生成 Offer 级关键词池（主入口）
 *
 * @param offerId - Offer ID
 * @param userId - 用户 ID
 * @param allKeywords - 所有关键词列表（可选，如不提供则从现有创意提取）
 * @returns 关键词池
 */
export async function generateOfferKeywordPool(
  offerId: number,
  userId: number,
  allKeywords?: string[],
  progress?: KeywordPoolProgressReporter
): Promise<OfferKeywordPool> {
  console.log(`\n📦 开始生成 Offer #${offerId} 的关键词池`)
  await progress?.({ phase: 'seed-volume', message: '开始生成关键词池' })

  // 1. 获取 Offer 信息
  const offer = await findOfferById(offerId, userId)
  if (!offer) {
    throw new Error(`Offer #${offerId} 不存在`)
  }
  const pureBrandKeywordsForOffer = getPureBrandKeywords(offer.brand || '')
  const pageType = resolveOfferPageType(offer)
  const verifiedSourceKeywords = await buildVerifiedSourceKeywordData(offer, userId)
  let allowPlannerNonBrand = false
  let plannerNonBrandPolicy: PlannerNonBrandPolicy = createPlannerNonBrandPolicy({
    pageType,
    enabled: allowPlannerNonBrand,
  })
  const plannerMinSearchVolume = pageType === 'store' ? DEFAULTS.minSearchVolume : undefined

  // 1.5 Marketplace场景：尽量补全“品牌官网”，用于Keyword Planner的站点过滤（best-effort）
  try {
    const { ensureOfferBrandOfficialSite } = await import('./offer-official-site')
    const official = await ensureOfferBrandOfficialSite({
      offerId: offer.id,
      userId,
      brand: offer.brand,
      targetCountry: offer.target_country,
      finalUrl: offer.final_url,
      url: offer.url,
      category: offer.category,
      productName: offer.product_name,
      extractionMetadata: offer.extraction_metadata,
    })

    if (official?.origin) {
      const existing = (() => {
        try {
          return offer.extraction_metadata ? JSON.parse(offer.extraction_metadata) : {}
        } catch {
          return {}
        }
      })()
      offer.extraction_metadata = JSON.stringify({ ...existing, brandOfficialSite: official })
      console.log(`🌐 已补全品牌官网(origin): ${official.origin}`)
    }
  } catch (e: any) {
    console.warn(`⚠️ 品牌官网补全失败（不影响关键词池生成）: ${e?.message || String(e)}`)
  }

  // 2. 提取初始关键词（保留 searchVolume）
  let initialKeywords: PoolKeywordData[]
  if (allKeywords) {
    // 🔧 修复(2026-01-21): 如果提供了关键词列表，查询搜索量而不是硬编码为 0
    console.log(`📊 查询 ${allKeywords.length} 个提供的关键词的搜索量...`)
    const { getKeywordSearchVolumes } = await import('./keyword-planner')
    const auth = await getUserAuthType(userId)

    try {
      await progress?.({ phase: 'seed-volume', message: `初始关键词搜索量查询中` })
      const volumeProgress = progress
        ? (info: { message: string; current?: number; total?: number }) =>
            progress({
              phase: 'seed-volume',
              current: info.current,
              total: info.total,
              message: `初始关键词搜索量 ${info.current ?? 0}/${info.total ?? 0}`
            })
        : undefined

      const volumes = await getKeywordSearchVolumes(
        allKeywords,
        offer.target_country,
        offer.target_language || 'en',
        userId,
        auth.authType,
        auth.serviceAccountId,
        volumeProgress
      )

      initialKeywords = volumes.map(v => ({
        keyword: v.keyword,
        searchVolume: v.avgMonthlySearches || 0,
        competition: v.competition,
        competitionIndex: v.competitionIndex,
        lowTopPageBid: v.lowTopPageBid,
        highTopPageBid: v.highTopPageBid,
        source: 'PROVIDED',
        matchType: inferDefaultKeywordMatchType(v.keyword, pureBrandKeywordsForOffer)
      }))

      const withVolume = initialKeywords.filter(kw => kw.searchVolume > 0).length
      console.log(`✅ 搜索量查询完成: ${withVolume}/${allKeywords.length} 个关键词有搜索量`)
    } catch (error) {
      console.warn(`⚠️ 搜索量查询失败，使用默认值 0: ${error}`)
      // 降级处理：使用默认值
      initialKeywords = allKeywords.map(kw => ({
        keyword: kw,
        searchVolume: 0,
        source: 'PROVIDED',
        matchType: inferDefaultKeywordMatchType(kw, pureBrandKeywordsForOffer)
      }))
    }
  } else {
    initialKeywords = await extractKeywordsFromOffer(offerId, userId, progress)
  }

  if (initialKeywords.length === 0) {
    throw new Error('无可用关键词，请先生成关键词')
  }

  console.log(`📝 初始关键词数: ${initialKeywords.length}`)

  // 2.5 🔧 修复(2025-12-24): 优化种子词过滤策略
  // 核心问题: 52→12个种子词过滤率太高，导致关键词扩展不足
  const beforeFilterCount = initialKeywords.length
  const offerPlatform = extractPlatformFromUrl(offer.final_url || offer.url || '')

  // 🆕 先提取长尾种子词中的有价值短语
  const extractedSeeds: PoolKeywordData[] = []
  for (const kw of initialKeywords) {
    const wordCount = kw.keyword.trim().split(/\s+/).length
    if (wordCount > SEED_MAX_WORD_COUNT) {
      // 从长尾词中提取2-4个单词的短语
      const words = kw.keyword.trim().split(/\s+/)
      const brand = offer.brand.toLowerCase()

      for (let i = 0; i < words.length - 1; i++) {
        for (let len = 2; len <= Math.min(4, words.length - i); len++) {
          const phrase = words.slice(i, i + len).join(' ')
          const phraseLower = phrase.toLowerCase()

          // 只提取包含品牌名的短语
          if (phraseLower.includes(brand)) {
            extractedSeeds.push({
              ...kw,
              keyword: phrase
            })
          }
        }
      }
    }
  }

  // 应用过滤条件
  initialKeywords = initialKeywords.filter(kw => {
    const keyword = kw.keyword.trim()
    const wordCount = keyword.split(/\s+/).length

    // 过滤条件1：长度限制（与最终质量过滤对齐，≤8个单词）
    if (wordCount > SEED_MAX_WORD_COUNT) {
      console.log(`   ⊗ 种子词长度过滤: "${keyword}" (${wordCount}个单词, 限制≤${SEED_MAX_WORD_COUNT})`)
      return false
    }

    // 过滤条件2：排除低质量词
    // 🔥 2025-12-24优化: 只过滤明确的低质量词，保留高转化词
    const invalidPatterns = [
      // 购买渠道（保留store/shop/amazon/ebay，因为这些是正常购买渠道）
      'near me', 'official',
      // 低转化查询类
      'history', 'tracker', 'locator', 'review', 'compare',
      // 过时年份
      '2023', '2022', '2021', 'black friday', 'prime day'
      // ✅ 保留: 'store', 'shop', 'amazon', 'ebay' - 店铺/销售渠道词
      // ✅ 保留: 'discount', 'sale', 'deal', 'code', 'coupon' - 商品需求扩展词
      // ✅ 保留: 'price', 'cost', 'cheap', 'affordable', 'budget' - 高转化词
      // ✅ 保留: '2024', '2025' - 当前年份
    ]
    const keywordLower = keyword.toLowerCase()
    const hasInvalidPattern = invalidPatterns.some(pattern =>
      keywordLower.includes(pattern)
    )
    if (hasInvalidPattern) {
      const matchedPattern = invalidPatterns.find(p => keywordLower.includes(p))
      console.log(`   ⊗ 种子词无效模式过滤: "${keyword}" (包含: ${matchedPattern})`)
      return false
    }

    // 过滤条件3：明显信息查询/素材查询词（高概率低转化）
    const matchedInfoPattern = SEED_INFO_QUERY_PATTERNS.find(pattern => keywordLower.includes(pattern))
    if (matchedInfoPattern) {
      console.log(`   ⊗ 种子词信息查询过滤: "${keyword}" (包含: ${matchedInfoPattern})`)
      return false
    }

    // 过滤条件4：跨平台噪音词（关键词平台与目标落地页平台不一致）
    if (offerPlatform) {
      const keywordPlatforms = detectPlatformsInKeyword(keywordLower)
      const mismatchedPlatforms = keywordPlatforms.filter(platform => platform !== offerPlatform)
      if (mismatchedPlatforms.length > 0) {
        console.log(
          `   ⊗ 种子词平台冲突过滤: "${keyword}" (关键词平台: ${mismatchedPlatforms.join('/')}, 目标平台: ${offerPlatform})`
        )
        return false
      }
    }

    return true
  })

  // 合并提取的短语种子词（去重）
  const seenPhrases = new Set(initialKeywords.map(k => k.keyword.toLowerCase()))
  let addedCount = 0
  extractedSeeds.forEach(seed => {
    if (!seenPhrases.has(seed.keyword.toLowerCase())) {
      initialKeywords.push(seed)
      seenPhrases.add(seed.keyword.toLowerCase())
      addedCount++
    }
  })

  if (addedCount > 0) {
    console.log(`   ✅ 从长尾种子词中提取: ${addedCount} 个短语种子词`)
  }

  if (beforeFilterCount !== initialKeywords.length) {
    console.log(`📊 种子词质量过滤: ${beforeFilterCount} → ${initialKeywords.length}`)
  }

  // 3. 🆕 全量扩展（v2.0：根据认证类型分发）
  const { expandAllKeywords, filterKeywords } = await import('./keyword-pool-helpers')

  // 获取Google Ads凭证和认证类型（用于扩展）
  let customerId: string | undefined
  let refreshToken: string | undefined
  let accountId: number | undefined
  let clientId: string | undefined
  let clientSecret: string | undefined
  let developerToken: string | undefined
  let authType: 'oauth' | 'service_account' = 'oauth'

  try {
    const { getGoogleAdsConfig } = await import('./keyword-planner')
    const { getDatabase } = await import('./db')
    const db = await getDatabase()

    // 获取认证类型
    const auth = await getUserAuthType(userId)
    authType = auth.authType

    // 🔧 PostgreSQL兼容性修复: is_active/is_manager_account在PostgreSQL中是BOOLEAN类型
    const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
    const isManagerCondition = db.type === 'postgres' ? 'is_manager_account = false' : 'is_manager_account = 0'

    const adsAccount = await db.queryOne(`
      SELECT id, customer_id FROM google_ads_accounts
      WHERE user_id = ? AND ${isActiveCondition} AND status = 'ENABLED' AND ${isManagerCondition}
      ORDER BY created_at DESC LIMIT 1
    `, [userId]) as { id: number; customer_id: string } | undefined

    if (adsAccount) {
      const config = await getGoogleAdsConfig(userId)
      if (config) {
        customerId = adsAccount.customer_id
        refreshToken = config.refreshToken
        accountId = adsAccount.id
        clientId = config.clientId
        clientSecret = config.clientSecret
        developerToken = config.developerToken
      }
    }
  } catch (error) {
    console.warn('⚠️ 无法获取Google Ads凭证，跳过关键词扩展')
  }

  const plannerDecision: PlannerDecision = {
    allowNonBrandFromPlanner: allowPlannerNonBrand,
    volumeUnavailableFromPlanner: false,
    nonBrandPolicy: plannerNonBrandPolicy,
  }
  const expandedKeywords = await expandAllKeywords(
    initialKeywords,
    offer.brand,
    offer.category || '',
    offer.target_country,
    offer.target_language || 'en',
    authType,           // 🔥 2025-12-29 新增：认证类型
    offer,              // 🔥 2025-12-29 新增：Offer信息（服务账号模式需要）
    userId,
    customerId,
    refreshToken,
    accountId,
    clientId,
    clientSecret,
    developerToken,
    progress,
    plannerMinSearchVolume,
    plannerNonBrandPolicy,
    plannerDecision
  )
  plannerNonBrandPolicy = plannerDecision.nonBrandPolicy || plannerNonBrandPolicy
  allowPlannerNonBrand = plannerDecision.allowNonBrandFromPlanner ?? allowPlannerNonBrand

  // 4. 🆕 智能过滤（竞品+品类+搜索量+地理位置）
  const filteredKeywords = filterKeywords(
    expandedKeywords,
    offer.brand,
    offer.category || '',
    offer.target_country,  // 🔧 修复(2025-12-17): 传递目标国家进行地理过滤
    offer.product_name,
    {
      allowNonBrandFromPlanner: plannerNonBrandPolicy,
      // KISS: 品牌门禁统一交给 filterKeywordQuality，预过滤阶段只做轻量裁剪
      applyBrandGate: false
    }
  )

  console.log(`📝 第一次过滤后关键词数: ${filteredKeywords.length}`)

  // 🆕 2025-12-27: 关键词质量过滤
  // 过滤品牌变体词（如 eurekaddl）和语义查询词（如 significato）
  const pageTypeForContextFilter = resolveOfferPageType(offer)
  const pureBrandKeywordsForFilter = getPureBrandKeywords(offer.brand || '')
  const categorySignals = extractCategorySignalsFromScrapedData(offer.scraped_data)
  const categoryContext = [offer.category, ...categorySignals].filter(Boolean).join(' ')
  const baseContextMatches = getMinContextTokenMatchesForKeywordQualityFilter({
    pageType: pageTypeForContextFilter
  })
  const effectiveContextMatches = baseContextMatches

  const qualityFiltered = filterKeywordQuality(filteredKeywords, {
    brandName: offer.brand,
    category: categoryContext || undefined,
    productName: offer.product_name || undefined,
    targetCountry: offer.target_country || undefined,
    targetLanguage: offer.target_language || undefined,
    productUrl: offer.final_url || offer.url || undefined,
    minWordCount: 1,
    maxWordCount: 8,
    // 🔒 全量强制：最终关键词必须包含“纯品牌词”（不拼接造词）
    mustContainBrand: pureBrandKeywordsForFilter.length > 0,
    allowNonBrandFromPlanner: plannerNonBrandPolicy,
    // 过滤歧义品牌的无关主题（例如 rove beetle / rove concept）
    minContextTokenMatches: effectiveContextMatches,
    contextMismatchMode: 'soft',
  })

  // 生成过滤报告
  const filterReport = generateFilterReport(filteredKeywords.length, qualityFiltered.removed)
  console.log(filterReport)

  // 使用过滤后的关键词
  let finalFilteredKeywords = qualityFiltered.filtered

  // 产品页放宽策略（仅在严格过滤导致词池接近“纯品牌词独占”时触发）：
  // 在保持上下文/语义过滤前提下，回补少量高意图非纯品牌词，避免关键词池坍缩为单词。
  if (pageTypeForContextFilter === 'product' && pureBrandKeywordsForFilter.length > 0) {
    const strictNonPureCount = finalFilteredKeywords.filter(
      kw => !isPureBrandKeywordInternal(kw.keyword, pureBrandKeywordsForFilter)
    ).length

    if (strictNonPureCount < 3) {
      const relaxedQualityFiltered = filterKeywordQuality(filteredKeywords, {
        brandName: offer.brand,
        category: categoryContext || undefined,
        productName: offer.product_name || undefined,
        targetCountry: offer.target_country || undefined,
        targetLanguage: offer.target_language || undefined,
        productUrl: offer.final_url || offer.url || undefined,
        minWordCount: 1,
        maxWordCount: 8,
        mustContainBrand: false,
        allowNonBrandFromPlanner: plannerNonBrandPolicy,
        minContextTokenMatches: effectiveContextMatches,
        contextMismatchMode: 'soft',
      })

      const existingNormSet = new Set(
        finalFilteredKeywords
          .map(item => normalizeGoogleAdsKeyword(item.keyword))
          .filter(Boolean)
      )

      const relaxedSeenSet = new Set<string>()
      const relaxedCandidates = prioritizeKeywordsForClustering(
        relaxedQualityFiltered.filtered
          .map((kw): PoolKeywordData | null => {
            if (isPureBrandKeywordInternal(kw.keyword, pureBrandKeywordsForFilter)) return null
            if (!hasCommercialIntentForProductRelaxedRetention(
              kw.keyword,
              offer.target_language || 'en'
            )) {
              return null
            }

            // 参考 title/about 补词：把高意图非品牌词统一改写为“品牌前置”形式，避免品牌词重复并限制词长。
            const brandedKeyword = composeGlobalCoreBrandedKeyword(kw.keyword, offer.brand || '', 5)
            if (!brandedKeyword) return null

            const norm = normalizeGoogleAdsKeyword(brandedKeyword)
            if (!norm || existingNormSet.has(norm) || relaxedSeenSet.has(norm)) return null
            relaxedSeenSet.add(norm)

            return {
              ...kw,
              keyword: brandedKeyword,
              source: 'PRODUCT_RELAX_BRANDED',
              sourceType: 'PRODUCT_RELAX_BRANDED',
              sourceSubtype: 'PURE_BRAND_PREFIX_REWRITE',
              rawSource: String(
                (kw as any).rawSource
                || (kw as any).sourceSubtype
                || (kw as any).sourceType
                || kw.source
                || 'KEYWORD_POOL'
              ).trim() || 'KEYWORD_POOL',
              derivedTags: Array.from(new Set([
                ...(((kw as any).derivedTags || []) as string[]),
                'PRODUCT_RELAX_BRANDED',
                'PURE_BRAND_PREFIX_REWRITE',
              ])),
              matchType: 'PHRASE',
            }
          })
          .filter((kw): kw is PoolKeywordData => kw !== null)
      )

      const rescueLimit = Math.max(8, Math.min(30, Math.floor(filteredKeywords.length * 0.2)))
      const rescuedKeywords = relaxedCandidates.slice(0, rescueLimit)

      if (rescuedKeywords.length > 0) {
        finalFilteredKeywords = [...finalFilteredKeywords, ...rescuedKeywords]
        console.log(
          `🧩 product页放宽补齐: +${rescuedKeywords.length} 个高意图词(品牌前置改写) ` +
          `(strict_non_pure=${strictNonPureCount}, relaxed_candidates=${relaxedCandidates.length})`
        )
      } else {
        console.log(
          `ℹ️ product页放宽补齐未命中可用词 (strict_non_pure=${strictNonPureCount})`
        )
      }
    }
  }

  // 🔒 有真实搜索量数据时，移除非纯品牌的0搜索量关键词
  const hasAnyVolume = finalFilteredKeywords.some(kw => kw.searchVolume > 0)
  const volumeUnavailable = plannerDecision.volumeUnavailableFromPlanner || hasSearchVolumeUnavailableFlag(finalFilteredKeywords)
  if (hasAnyVolume && !volumeUnavailable) {
    const beforeVolumeFilter = finalFilteredKeywords.length
    finalFilteredKeywords = finalFilteredKeywords.filter(kw =>
      kw.searchVolume > 0 || isPureBrandKeywordInternal(kw.keyword, pureBrandKeywordsForFilter)
    )
    if (beforeVolumeFilter !== finalFilteredKeywords.length) {
      console.log(`📉 搜索量过滤(保留纯品牌): ${beforeVolumeFilter} → ${finalFilteredKeywords.length}`)
    }
  } else if (hasAnyVolume && volumeUnavailable) {
    console.log('⚠️ 搜索量数据不可用（Planner 权限受限），跳过非纯品牌 0 搜索量关键词强制移除')
  }

  // 约束：最终关键词顺序始终前置纯品牌词，避免后续截断时品牌词被挤压
  finalFilteredKeywords = prioritizeBrandKeywordsFirst(
    finalFilteredKeywords,
    pureBrandKeywordsForFilter
  )

  console.log(`📝 最终过滤后关键词数: ${finalFilteredKeywords.length}`)
  await progress?.({ phase: 'filter', message: '关键词过滤完成' })

  // 5. 分离纯品牌词和非品牌词
  const keywordStrings = finalFilteredKeywords.map(kw => kw.keyword)
  let { brandKeywords: brandKwStrings, nonBrandKeywords: nonBrandKwStrings } = separateBrandKeywords(keywordStrings, offer.brand)

  // ✅ 确保所有纯品牌词都被纳入（如 "dr mercola" + "mercola"）
  if (pureBrandKeywordsForFilter.length > 0) {
    const brandKwNormalized = new Set(
      brandKwStrings
        .map(k => normalizeGoogleAdsKeyword(k))
        .filter(Boolean)
    )
    const missingPureBrands = pureBrandKeywordsForFilter.filter(kw => {
      const normalized = normalizeGoogleAdsKeyword(kw)
      return normalized && !brandKwNormalized.has(normalized)
    })

    if (missingPureBrands.length > 0) {
      brandKwStrings.push(...missingPureBrands)
      const missingNormalized = new Set(
        missingPureBrands
          .map(k => normalizeGoogleAdsKeyword(k))
          .filter(Boolean)
      )
      nonBrandKwStrings = nonBrandKwStrings.filter(k => {
        const normalized = normalizeGoogleAdsKeyword(k)
        return normalized ? !missingNormalized.has(normalized) : true
      })
      console.log(`✅ 补充纯品牌词: ${missingPureBrands.join(', ')}`)
    }
  }

  // 🔧 防御性兜底：如果未识别到任何纯品牌词，强制注入标准化后的品牌词
  // 典型场景：Keyword Planner 不返回 seed 本身，且品牌含标点（如 "Dr. Mercola" → "dr mercola"）
  if (brandKwStrings.length === 0) {
    const canonicalBrand = normalizeGoogleAdsKeyword(offer.brand || '')
    if (canonicalBrand) {
      console.warn(`⚠️ 未识别到纯品牌词，自动注入: "${canonicalBrand}"`)
      brandKwStrings = [canonicalBrand]
      nonBrandKwStrings = nonBrandKwStrings.filter(k => normalizeGoogleAdsKeyword(k) !== canonicalBrand)
    }
  }

  // 转换回 PoolKeywordData[]
  let brandKeywordsData = finalFilteredKeywords.filter(kw => brandKwStrings.includes(kw.keyword))
  let nonBrandKeywordsData = finalFilteredKeywords.filter(kw => nonBrandKwStrings.includes(kw.keyword))

  // 如果注入的品牌词不在 finalFilteredKeywords 中，补一个最小元数据对象，保证 brand_keywords 不为空
  if (brandKeywordsData.length === 0 && brandKwStrings.length > 0) {
    brandKeywordsData = brandKwStrings.map(keyword => ({
      keyword,
      searchVolume: 0,
      source: 'BRAND_SEED',
      matchType: 'EXACT' as const,
      isPureBrand: true,
    }))
  }

  // 🆕 聚类输入硬上限：按来源优先级 + 搜索量 选 Top N
  if (nonBrandKeywordsData.length > KEYWORD_CLUSTERING_INPUT_LIMIT) {
    const prioritized = prioritizeKeywordsForClustering(nonBrandKeywordsData)
    const capped = prioritized.slice(0, KEYWORD_CLUSTERING_INPUT_LIMIT)
    const cappedSet = new Set(capped.map(item => item.keyword))
    nonBrandKeywordsData = nonBrandKeywordsData.filter(item => cappedSet.has(item.keyword))
    nonBrandKwStrings = capped.map(item => item.keyword)
    console.log(`✂️ 聚类输入裁剪: ${prioritized.length} → ${capped.length} (Top ${KEYWORD_CLUSTERING_INPUT_LIMIT} by source+volume)`)
  }

  // 🔧 强化：补齐/更新纯品牌词的真实搜索量（优先使用缓存/Keyword Planner）
  if (pureBrandKeywordsForFilter.length > 0) {
    const brandKeywordMap = new Map<string, PoolKeywordData>()
    for (const kw of brandKeywordsData) {
      const normalized = normalizeGoogleAdsKeyword(kw.keyword)
      if (!normalized) continue
      brandKeywordMap.set(normalized, kw)
    }

    const needsBrandVolume = pureBrandKeywordsForFilter.some(kw => {
      const normalized = normalizeGoogleAdsKeyword(kw)
      if (!normalized) return false
      const existing = brandKeywordMap.get(normalized)
      return !existing || (existing.searchVolume || 0) === 0
    })

    if (needsBrandVolume) {
      try {
        const { getKeywordSearchVolumes } = await import('./keyword-planner')
        const auth = await getUserAuthType(userId)
        await progress?.({ phase: 'seed-volume', message: '品牌词搜索量查询中' })
        const volumeProgress = progress
          ? (info: { message: string; current?: number; total?: number }) =>
              progress({
                phase: 'seed-volume',
                current: info.current,
                total: info.total,
                message: `品牌词搜索量 ${info.current ?? 0}/${info.total ?? 0}`
              })
          : undefined
        const volumes = await getKeywordSearchVolumes(
          pureBrandKeywordsForFilter,
          offer.target_country,
          offer.target_language || 'en',
          userId,
          auth.authType,
          auth.serviceAccountId,
          volumeProgress
        )

        volumes.forEach(vol => {
          const normalized = normalizeGoogleAdsKeyword(vol.keyword)
          if (!normalized) return
          const existing = brandKeywordMap.get(normalized)
          const nextVolume = vol.avgMonthlySearches > 0
            ? vol.avgMonthlySearches
            : (existing?.searchVolume || 0)

          brandKeywordMap.set(normalized, {
            keyword: normalized,
            searchVolume: nextVolume,
            competition: vol.competition || existing?.competition || 'UNKNOWN',
            competitionIndex: vol.competitionIndex || existing?.competitionIndex || 0,
            lowTopPageBid: vol.lowTopPageBid || existing?.lowTopPageBid || 0,
            highTopPageBid: vol.highTopPageBid || existing?.highTopPageBid || 0,
            source: existing?.source || 'BRAND_SEED',
            matchType: 'EXACT',
            isPureBrand: true,
          })
        })
      } catch (error: any) {
        console.warn(`⚠️ 纯品牌词搜索量查询失败: ${error.message}`)
      }
    }

    // 确保缺失的纯品牌词也被注入（即使搜索量未知）
    for (const kw of pureBrandKeywordsForFilter) {
      const normalized = normalizeGoogleAdsKeyword(kw)
      if (!normalized) continue
      if (!brandKeywordMap.has(normalized)) {
        brandKeywordMap.set(normalized, {
          keyword: normalized,
          searchVolume: 0,
          source: 'BRAND_SEED',
          matchType: 'EXACT',
          isPureBrand: true,
        })
      }
    }

    brandKeywordsData = Array.from(brandKeywordMap.values())
  }

  // 🆕 v4.16: 确定页面类型
  console.log(`📊 页面类型: ${pageType}`)

  // 6. AI 语义聚类（传递国家和语言参数用于查询商品需求扩展词搜索量）
  // 🆕 v4.16: 传递 pageType 参数
  await progress?.({ phase: 'cluster', message: '语义聚类准备中' })
  const buckets = await clusterKeywordsByIntent(
    nonBrandKwStrings,
    offer.brand,
    offer.category,
    userId,
    offer.target_country,  // 🔥 2025-12-23 新增：传递目标国家
    offer.target_language || 'en',  // 🔥 2025-12-23 新增：传递目标语言
    pageType,  // 🆕 v4.16: 传递页面类型
    progress
  )

  // 🆕 v4.16: 根据页面类型处理不同的桶结构
  if (pageType === 'store') {
    // 店铺链接：处理5个桶
    const storeBuckets = buckets as StoreKeywordBuckets

    // 7. 将 PoolKeywordData 映射到桶中
    // 🔧 修复(2026-01-21): 只保留在 nonBrandKeywordsData 中有搜索量数据的关键词
    const nonBrandMap = new Map<string, PoolKeywordData>()
    for (const k of nonBrandKeywordsData) {
      const key = normalizeGoogleAdsKeyword(k.keyword)
      if (!key) continue
      const existing = nonBrandMap.get(key)
      const existingVol = existing?.searchVolume || 0
      const currentVol = k.searchVolume || 0
      if (!existing || currentVol > existingVol) {
        nonBrandMap.set(key, k)
      }
    }

    const mapAndFilterKeywords = (kwList: string[]): PoolKeywordData[] => {
      const mapped = kwList
        .map(kw => {
          const key = normalizeGoogleAdsKeyword(kw)
          return key ? nonBrandMap.get(key) : undefined
        })
        .filter((kw): kw is PoolKeywordData => kw !== undefined)
      return prioritizeBucketKeywords(mapped)
    }

    let storeBucketAData = mapAndFilterKeywords(storeBuckets.bucketA.keywords)
    let storeBucketBData = mapAndFilterKeywords(storeBuckets.bucketB.keywords)
    let storeBucketCData = mapAndFilterKeywords(storeBuckets.bucketC.keywords)
    let storeBucketDData = mapAndFilterKeywords(storeBuckets.bucketD.keywords)
    let storeBucketSData = mapAndFilterKeywords(storeBuckets.bucketS.keywords)
    const mappedStoreCount = storeBucketAData.length + storeBucketBData.length + storeBucketCData.length +
      storeBucketDData.length + storeBucketSData.length

    const storeUsedNorms = buildExistingKeywordNormSet([
      brandKeywordsData,
      storeBucketAData,
      storeBucketBData,
      storeBucketCData,
      storeBucketDData,
      storeBucketSData,
    ])
    storeBucketAData = appendVerifiedKeywordsToBucket({
      current: storeBucketAData,
      additions: verifiedSourceKeywords.TITLE_EXTRACT,
      usedNorms: storeUsedNorms,
    })
    storeBucketCData = appendVerifiedKeywordsToBucket({
      current: storeBucketCData,
      additions: [
        ...verifiedSourceKeywords.PARAM_EXTRACT,
        ...verifiedSourceKeywords.HOT_PRODUCT_AGGREGATE,
      ],
      usedNorms: storeUsedNorms,
    })
    storeBucketBData = appendVerifiedKeywordsToBucket({
      current: storeBucketBData,
      additions: verifiedSourceKeywords.ABOUT_EXTRACT,
      usedNorms: storeUsedNorms,
    })
    storeBucketSData = appendVerifiedKeywordsToBucket({
      current: storeBucketSData,
      additions: verifiedSourceKeywords.PAGE_EXTRACT,
      usedNorms: storeUsedNorms,
    })
    const verifiedStoreAdds =
      storeBucketAData.length + storeBucketBData.length + storeBucketCData.length +
      storeBucketDData.length + storeBucketSData.length - mappedStoreCount

    // 记录过滤掉的关键词数量
    const originalCount = storeBuckets.bucketA.keywords.length + storeBuckets.bucketB.keywords.length +
                          storeBuckets.bucketC.keywords.length + storeBuckets.bucketD.keywords.length +
                          storeBuckets.bucketS.keywords.length
    const filteredCount = mappedStoreCount
    if (originalCount !== filteredCount) {
      console.log(`ℹ️ 店铺关键词映射过滤: ${originalCount} → ${filteredCount} (过滤掉 ${originalCount - filteredCount} 个无搜索量数据的关键词)`)
    }
    if (verifiedStoreAdds > 0) {
      console.log(`🧩 店铺真实来源补词: +${verifiedStoreAdds} (title:${verifiedSourceKeywords.TITLE_EXTRACT.length}, about:${verifiedSourceKeywords.ABOUT_EXTRACT.length}, param:${verifiedSourceKeywords.PARAM_EXTRACT.length}, hot:${verifiedSourceKeywords.HOT_PRODUCT_AGGREGATE.length}, page:${verifiedSourceKeywords.PAGE_EXTRACT.length})`)
    }

    const storeBucketMinRetainAdds = ensureMinimumBucketKeywords({
      bucketEntries: [
        { name: 'A', keywords: storeBucketAData },
        { name: 'B', keywords: storeBucketBData },
        { name: 'C', keywords: storeBucketCData },
        { name: 'D', keywords: storeBucketDData },
        { name: 'S', keywords: storeBucketSData },
      ],
      reserveKeywords: nonBrandKeywordsData,
      minPerBucket: MIN_NON_BRAND_KEYWORDS_PER_STORE_BUCKET,
    })
    const totalStoreRetainAdds = Object.values(storeBucketMinRetainAdds).reduce((sum, value) => sum + value, 0)
    if (totalStoreRetainAdds > 0) {
      console.log(`🛟 店铺桶最小保留补齐: +${totalStoreRetainAdds} (A:${storeBucketMinRetainAdds.A || 0}, B:${storeBucketMinRetainAdds.B || 0}, C:${storeBucketMinRetainAdds.C || 0}, D:${storeBucketMinRetainAdds.D || 0}, S:${storeBucketMinRetainAdds.S || 0})`)
    }

    // 8. 补充品牌全局核心关键词（不破坏原流程）
    const injectedStore = await injectGlobalCoreKeywordsForStore({
      offer,
      userId,
      brandKeywords: brandKeywordsData,
      storeBuckets,
      bucketAData: storeBucketAData,
      bucketBData: storeBucketBData,
      bucketCData: storeBucketCData,
      bucketDData: storeBucketDData,
      bucketSData: storeBucketSData,
    })

    storeBucketAData = injectedStore.bucketAData
    storeBucketBData = injectedStore.bucketBData
    storeBucketCData = injectedStore.bucketCData
    storeBucketDData = injectedStore.bucketDData
    storeBucketSData = injectedStore.bucketSData

    // 9. 保存到数据库（包含店铺分桶）
    await progress?.({ phase: 'save', message: '保存关键词池' })
    const pool = await saveKeywordPoolWithData(
      offerId,
      userId,
      brandKeywordsData,
      {
        bucketA: { intent: storeBuckets.bucketA.intent, keywords: storeBucketAData },
        bucketB: { intent: storeBuckets.bucketB.intent, keywords: storeBucketBData },
        bucketC: { intent: storeBuckets.bucketC.intent, keywords: storeBucketCData },
        bucketD: { intent: storeBuckets.bucketD.intent, keywords: storeBucketDData },
        statistics: storeBuckets.statistics
      },
      pageType,  // 🆕 v4.16: 传递页面类型
      storeBuckets,  // 🆕 v4.16: 传递店铺桶数据
      {
        bucketA: storeBucketAData,
        bucketB: storeBucketBData,
        bucketC: storeBucketCData,
        bucketD: storeBucketDData,
        bucketS: storeBucketSData,
      }
    )

    return pool
  } else {
    // 产品链接：处理4个桶（原逻辑）
    const productBuckets = buckets as KeywordBuckets

    // 7. 将 PoolKeywordData 映射到桶中
    // 🔧 修复(2026-01-21): 只保留在 nonBrandKeywordsData 中有搜索量数据的关键词
    // 避免保留 AI 生成但无真实搜索量的模板化关键词
    const nonBrandMap = new Map<string, PoolKeywordData>()
    for (const k of nonBrandKeywordsData) {
      const key = normalizeGoogleAdsKeyword(k.keyword)
      if (!key) continue
      const existing = nonBrandMap.get(key)
      const existingVol = existing?.searchVolume || 0
      const currentVol = k.searchVolume || 0
      if (!existing || currentVol > existingVol) {
        nonBrandMap.set(key, k)
      }
    }

    const mapAndFilterKeywords = (kwList: string[]): PoolKeywordData[] => {
      const mapped = kwList
        .map(kw => {
          const key = normalizeGoogleAdsKeyword(kw)
          return key ? nonBrandMap.get(key) : undefined
        })
        .filter((kw): kw is PoolKeywordData => kw !== undefined)
      return prioritizeBucketKeywords(mapped)
    }

    let bucketAData = mapAndFilterKeywords(productBuckets.bucketA.keywords)
    let bucketBData = mapAndFilterKeywords(productBuckets.bucketB.keywords)
    let bucketCData = mapAndFilterKeywords(productBuckets.bucketC.keywords)
    let bucketDData = mapAndFilterKeywords(productBuckets.bucketD.keywords)
    const mappedProductCount = bucketAData.length + bucketBData.length + bucketCData.length + bucketDData.length

    const productUsedNorms = buildExistingKeywordNormSet([
      brandKeywordsData,
      bucketAData,
      bucketBData,
      bucketCData,
      bucketDData,
    ])
    bucketAData = appendVerifiedKeywordsToBucket({
      current: bucketAData,
      additions: verifiedSourceKeywords.TITLE_EXTRACT,
      usedNorms: productUsedNorms,
    })
    bucketCData = appendVerifiedKeywordsToBucket({
      current: bucketCData,
      additions: [
        ...verifiedSourceKeywords.PARAM_EXTRACT,
        ...verifiedSourceKeywords.HOT_PRODUCT_AGGREGATE,
      ],
      usedNorms: productUsedNorms,
    })
    bucketBData = appendVerifiedKeywordsToBucket({
      current: bucketBData,
      additions: verifiedSourceKeywords.ABOUT_EXTRACT,
      usedNorms: productUsedNorms,
    })
    bucketDData = appendVerifiedKeywordsToBucket({
      current: bucketDData,
      additions: verifiedSourceKeywords.PAGE_EXTRACT,
      usedNorms: productUsedNorms,
    })
    const verifiedProductAdds = bucketAData.length + bucketBData.length + bucketCData.length + bucketDData.length - mappedProductCount

    // 记录过滤掉的关键词数量
    const originalCount = productBuckets.bucketA.keywords.length + productBuckets.bucketB.keywords.length +
                          productBuckets.bucketC.keywords.length + productBuckets.bucketD.keywords.length
    const filteredCount = mappedProductCount
    if (originalCount !== filteredCount) {
      console.log(`ℹ️ 关键词映射过滤: ${originalCount} → ${filteredCount} (过滤掉 ${originalCount - filteredCount} 个无搜索量数据的关键词)`)
    }
    if (verifiedProductAdds > 0) {
      console.log(`🧩 产品真实来源补词: +${verifiedProductAdds} (title:${verifiedSourceKeywords.TITLE_EXTRACT.length}, about:${verifiedSourceKeywords.ABOUT_EXTRACT.length}, param:${verifiedSourceKeywords.PARAM_EXTRACT.length}, hot:${verifiedSourceKeywords.HOT_PRODUCT_AGGREGATE.length}, page:${verifiedSourceKeywords.PAGE_EXTRACT.length})`)
    }

    const productBucketMinRetainAdds = ensureMinimumBucketKeywords({
      bucketEntries: [
        { name: 'A', keywords: bucketAData },
        { name: 'B', keywords: bucketBData },
        { name: 'C', keywords: bucketCData },
        { name: 'D', keywords: bucketDData },
      ],
      reserveKeywords: nonBrandKeywordsData,
      minPerBucket: MIN_NON_BRAND_KEYWORDS_PER_PRODUCT_BUCKET,
    })
    const totalProductRetainAdds = Object.values(productBucketMinRetainAdds).reduce((sum, value) => sum + value, 0)
    if (totalProductRetainAdds > 0) {
      console.log(`🛟 产品桶最小保留补齐: +${totalProductRetainAdds} (A:${productBucketMinRetainAdds.A || 0}, B:${productBucketMinRetainAdds.B || 0}, C:${productBucketMinRetainAdds.C || 0}, D:${productBucketMinRetainAdds.D || 0})`)
    }

    // 8. 补充品牌全局核心关键词（不破坏原流程）
    const injectedProduct = await injectGlobalCoreKeywordsForProduct({
      offer,
      userId,
      brandKeywords: brandKeywordsData,
      bucketAData,
      bucketBData,
      bucketCData,
      bucketDData,
      statistics: productBuckets.statistics,
    })

    bucketAData = injectedProduct.bucketAData
    bucketBData = injectedProduct.bucketBData
    bucketCData = injectedProduct.bucketCData
    bucketDData = injectedProduct.bucketDData

    // 9. 保存到数据库
    await progress?.({ phase: 'save', message: '保存关键词池' })
    const pool = await saveKeywordPoolWithData(
      offerId,
      userId,
      brandKeywordsData,
      {
        bucketA: { intent: productBuckets.bucketA.intent, keywords: bucketAData },
        bucketB: { intent: productBuckets.bucketB.intent, keywords: bucketBData },
        bucketC: { intent: productBuckets.bucketC.intent, keywords: bucketCData },
        bucketD: { intent: productBuckets.bucketD.intent, keywords: bucketDData },
        statistics: injectedProduct.statistics
      },
      pageType  // 🆕 v4.16: 传递页面类型
    )

    return pool
  }
}

/**
 * 获取或创建关键词池
 *
 * @param offerId - Offer ID
 * @param userId - 用户 ID
 * @param forceRegenerate - 是否强制重新生成
 * @returns 关键词池
 */
export async function getOrCreateKeywordPool(
  offerId: number,
  userId: number,
  forceRegenerate: boolean = false,
  progress?: KeywordPoolProgressReporter
): Promise<OfferKeywordPool> {
  // 检查现有池
  if (!forceRegenerate) {
    const existing = await getKeywordPoolByOfferId(offerId)
    if (existing) {
      console.log(`✅ 使用现有关键词池: Offer #${offerId}`)
      return existing
    }
  }

  // 生成新池
  return generateOfferKeywordPool(offerId, userId, undefined, progress)
}

/**
 * 从 Offer 现有数据提取关键词
 * 🔥 2025-12-16升级：返回 PoolKeywordData[]，保留完整元数据
 */
async function extractKeywordsFromOffer(
  offerId: number,
  userId: number,
  progress?: KeywordPoolProgressReporter
): Promise<PoolKeywordData[]> {
  const db = await getDatabase()
  const offerBrandRow = await db.queryOne<{ brand: string | null }>(
    'SELECT brand FROM offers WHERE id = ? AND user_id = ?',
    [offerId, userId]
  )
  const pureBrandKeywords = getPureBrandKeywords(offerBrandRow?.brand || '')
  const keywordMap = new Map<string, PoolKeywordData>()

  const normalizeKeywordMatchType = (
    rawMatchType: unknown,
    keyword: string
  ): 'EXACT' | 'PHRASE' | 'BROAD' => {
    const normalized =
      typeof rawMatchType === 'string'
        ? rawMatchType.trim().toUpperCase()
        : ''
    if (normalized === 'EXACT' || normalized === 'PHRASE' || normalized === 'BROAD') {
      return normalized as 'EXACT' | 'PHRASE' | 'BROAD'
    }
    return inferDefaultKeywordMatchType(keyword, pureBrandKeywords)
  }

  const addKeywordData = (kw: PoolKeywordData) => {
    const keyword = kw?.keyword?.trim()
    if (!keyword) return
    if (keywordMap.has(keyword)) return
    keywordMap.set(keyword, kw)
  }

  const addKeywordString = (keyword: string, source: string) => {
    const normalized = keyword?.trim()
    if (!normalized) return
    // 🔒 关键词质量校验（2026-01-26）：过滤无效关键词
    if (isInvalidKeyword(normalized)) {
      console.warn(`[extractKeywordsFromOffer] ⚠️ 过滤无效关键词: "${normalized}" (source: ${source})`)
      return
    }
    addKeywordData({
      keyword: normalized,
      searchVolume: 0,
      source,
      matchType: inferDefaultKeywordMatchType(normalized, pureBrandKeywords)
    })
  }

  const addKeywordsFromJson = (raw: unknown, source: string) => {
    if (raw == null) return

    let parsed: unknown = raw
    if (typeof raw === 'string') {
      if (raw.trim() === '') return
      try {
        parsed = JSON.parse(raw)
      } catch {
        return
      }
    }

    if (!Array.isArray(parsed)) return

    for (const item of parsed) {
      if (typeof item === 'string') {
        addKeywordString(item, source)
        continue
      }
      if (item && typeof item === 'object') {
        const keyword = (item as any).keyword || (item as any).text
        if (typeof keyword === 'string') {
          // 🔒 关键词质量校验（2026-01-26）
          if (isInvalidKeyword(keyword)) {
            console.warn(`[extractKeywordsFromOffer] ⚠️ 过滤无效关键词: "${keyword}" (source: ${source})`)
            continue
          }
          addKeywordData({
            keyword,
            searchVolume: Number((item as any).searchVolume || (item as any).volume || 0) || 0,
            competition: typeof (item as any).competition === 'string' ? (item as any).competition : undefined,
            competitionIndex: typeof (item as any).competitionIndex === 'number' ? (item as any).competitionIndex : undefined,
            lowTopPageBid: typeof (item as any).lowTopPageBid === 'number' ? (item as any).lowTopPageBid : undefined,
            highTopPageBid: typeof (item as any).highTopPageBid === 'number' ? (item as any).highTopPageBid : undefined,
            source,
            matchType: normalizeKeywordMatchType((item as any).matchType, keyword)
          })
        }
      }
    }
  }

  // 从现有创意中提取关键词
  const creatives = await db.query<{ keywords: string }>(
    `SELECT keywords FROM ad_creatives
     WHERE offer_id = ? AND user_id = ?
     ORDER BY created_at DESC
     LIMIT 3`,
    [offerId, userId]
  )

  for (const creative of creatives) {
    if (creative.keywords) {
      try {
        const keywords = JSON.parse(creative.keywords)
        if (Array.isArray(keywords)) {
          keywords.forEach((kw: any) => {
            const kwStr = typeof kw === 'string' ? kw : kw.keyword
            if (kwStr && !keywordMap.has(kwStr)) {
              keywordMap.set(kwStr, {
                keyword: kwStr,
                searchVolume: typeof kw === 'object' ? (kw.searchVolume || 0) : 0,
                competition: typeof kw === 'object' ? kw.competition : undefined,
                competitionIndex: typeof kw === 'object' ? kw.competitionIndex : undefined,
                lowTopPageBid: typeof kw === 'object' ? kw.lowTopPageBid : undefined,
                highTopPageBid: typeof kw === 'object' ? kw.highTopPageBid : undefined,
                source: 'CREATIVE',
                matchType: normalizeKeywordMatchType(
                  typeof kw === 'object' ? kw.matchType : undefined,
                  kwStr
                )
              })
            }
          })
        }
      } catch {}
    }
  }

  // 如果没有创意关键词，从 AI 分析结果提取
  if (keywordMap.size === 0) {
    const offer = await db.queryOne<{
      ai_keywords: string | null
      extracted_keywords: string | null
      brand: string | null
      category: string | null
      product_name: string | null
      product_highlights: string | null
      unique_selling_points: string | null
      review_analysis: string | null
      brand_analysis: string | null
      scraped_data: string | null
      page_type: string | null
    }>(
      `SELECT
        ai_keywords,
        extracted_keywords,
        brand,
        category,
        product_name,
        product_highlights,
        unique_selling_points,
        review_analysis,
        brand_analysis,
        scraped_data,
        page_type
      FROM offers
      WHERE id = ? AND user_id = ?`,
      [offerId, userId]
    )

    // 先解析 ai_keywords；如果为空数组，再尝试 extracted_keywords
    addKeywordsFromJson(offer?.ai_keywords, 'OFFER_AI_KEYWORDS')
    addKeywordsFromJson(offer?.extracted_keywords, 'OFFER_EXTRACTED_KEYWORDS')

    // 兜底：某些页面类型（尤其店铺页/抓取降级）可能出现 ai_keywords='[]' 且 extracted_keywords=NULL
    // 这种情况下用“真实已抓取”的结构化字段构建最小种子词，避免整个创意生成流程被阻断。
    if (keywordMap.size === 0 && offer?.brand) {
      console.warn(`[extractKeywordsFromOffer] Offer #${offerId} 无AI/提取关键词，使用兜底种子词生成 (pageType=${resolveOfferPageType(offer)})`)

      // 1) 品牌词（保证至少有一个关键词）
      addKeywordString(offer.brand, 'FALLBACK_BRAND')

      // 2) 产品名 / 品类（来自抓取结果）
      if (offer.product_name && offer.product_name !== offer.brand) {
        addKeywordString(`${offer.brand} ${offer.product_name}`.slice(0, 80), 'FALLBACK_PRODUCT_NAME')
      }
      if (offer.category) {
        addKeywordString(`${offer.brand} ${offer.category}`.slice(0, 80), 'FALLBACK_CATEGORY')
      }

      // 3) 尝试复用统一关键词服务的“意图感知种子词”构建逻辑（仅在兜底路径加载）
      try {
        const { buildIntentAwareSeedPool } = await import('./unified-keyword-service')
        const seedPool = buildIntentAwareSeedPool({
          brand: offer.brand,
          category: offer.category,
          productTitle: offer.product_name || undefined,
          productFeatures: offer.product_highlights || offer.unique_selling_points || undefined,
          scrapedData: offer.scraped_data || undefined,
          reviewAnalysis: offer.review_analysis || undefined,
          brandAnalysis: offer.brand_analysis || undefined,
        })

        seedPool.allSeeds
          .slice(0, 50)
          .forEach(seed => addKeywordString(seed, 'FALLBACK_INTENT_SEEDS'))
      } catch (seedError: any) {
        console.warn(`[extractKeywordsFromOffer] 兜底种子词构建失败: ${seedError?.message || seedError}`)
      }
    }
  }

  const keywords = Array.from(keywordMap.values())

  // 🔧 修复(2026-01-21): 查询提取关键词的搜索量
  if (keywords.length > 0) {
    console.log(`📊 查询 ${keywords.length} 个提取关键词的搜索量...`)
    await progress?.({ phase: 'seed-volume', message: `初始关键词搜索量查询中` })

    try {
      const { getKeywordSearchVolumes } = await import('./keyword-planner')
      const { getUserAuthType } = await import('./google-ads-oauth')
      const auth = await getUserAuthType(userId)

      // 获取 offer 信息（用于获取 target_country 和 target_language）
      const offer = await db.queryOne<{
        target_country: string
        target_language: string | null
      }>(
        'SELECT target_country, target_language FROM offers WHERE id = ? AND user_id = ?',
        [offerId, userId]
      )

      if (offer) {
        const volumeProgress = progress
          ? (info: { message: string; current?: number; total?: number }) =>
              progress({
                phase: 'seed-volume',
                current: info.current,
                total: info.total,
                message: `初始关键词搜索量 ${info.current ?? 0}/${info.total ?? 0}`
              })
          : undefined

        const volumes = await getKeywordSearchVolumes(
          keywords.map(k => k.keyword),
          offer.target_country,
          offer.target_language || 'en',
          userId,
          auth.authType,
          auth.serviceAccountId,
          volumeProgress
        )

        // 更新搜索量
        const volumeMap = new Map(volumes.map(v => [v.keyword.toLowerCase(), v]))
        for (const kw of keywords) {
          const volume = volumeMap.get(kw.keyword.toLowerCase())
          if (volume) {
            kw.searchVolume = volume.avgMonthlySearches || 0
            kw.competition = volume.competition
            kw.competitionIndex = volume.competitionIndex
            kw.lowTopPageBid = volume.lowTopPageBid
            kw.highTopPageBid = volume.highTopPageBid
          }
        }

        const withVolume = keywords.filter(k => k.searchVolume > 0).length
        console.log(`✅ 搜索量查询完成: ${withVolume}/${keywords.length} 个关键词有搜索量`)
      }
    } catch (error) {
      console.warn(`⚠️ 查询搜索量失败: ${error}`)
      // 降级处理：保留原有的 searchVolume: 0
    }
  }

  return keywords
}

// ============================================
// 创意生成辅助
// ============================================

type KeywordItem = PoolKeywordData | string

function normalizeKeywordItem(item: KeywordItem): PoolKeywordData | null {
  if (typeof item === 'string') {
    const keyword = item.trim()
    if (!keyword) return null
    return {
      keyword,
      searchVolume: 0,
      source: 'LEGACY',
      matchType: 'PHRASE'
    }
  }
  if (!item || typeof item !== 'object') return null
  const keyword = String(item.keyword || '').trim()
  if (!keyword) return null
  return {
    ...item,
    keyword,
    searchVolume: typeof item.searchVolume === 'number' ? item.searchVolume : Number(item.searchVolume) || 0,
    source: item.source || 'LEGACY',
    matchType: item.matchType || 'PHRASE'
  }
}

function mergeKeywordDataLists(lists: Array<KeywordItem[]>): PoolKeywordData[] {
  const merged = new Map<string, PoolKeywordData>()

  for (const list of lists) {
    for (const item of list || []) {
      const normalized = normalizeKeywordItem(item)
      if (!normalized) continue
      const key = normalizeGoogleAdsKeyword(normalized.keyword) || normalized.keyword.toLowerCase()
      if (!key) continue

      const existing = merged.get(key)
      if (!existing) {
        merged.set(key, normalized)
        continue
      }

      const priorityDiff =
        getKeywordSourcePriorityForPoolItem(existing)
        - getKeywordSourcePriorityForPoolItem(normalized)
      if (priorityDiff > 0) {
        merged.set(key, normalized)
        continue
      }
      if (priorityDiff < 0) {
        continue
      }

      if (normalized.searchVolume > (existing.searchVolume || 0)) {
        merged.set(key, normalized)
        continue
      }
      if (normalized.searchVolume < (existing.searchVolume || 0)) {
        continue
      }

      const matchTypeDiff =
        normalizeMatchTypePriority(normalized.matchType)
        - normalizeMatchTypePriority(existing.matchType)
      if (matchTypeDiff > 0) {
        merged.set(key, normalized)
        continue
      }

      if (matchTypeDiff < 0) continue

      if (normalized.keyword.length < existing.keyword.length) {
        merged.set(key, normalized)
      }
    }
  }

  return Array.from(merged.values())
}

function getComprehensiveKeywordsForPool(
  pool: OfferKeywordPool,
  linkType: 'product' | 'store'
): PoolKeywordData[] {
  if (linkType === 'store') {
    return mergeKeywordDataLists([
      pool.brandKeywords,
      pool.storeBucketAKeywords,
      pool.storeBucketBKeywords,
      pool.storeBucketCKeywords,
      pool.storeBucketDKeywords,
      pool.storeBucketSKeywords
    ])
  }

  return mergeKeywordDataLists([
    pool.brandKeywords,
    pool.bucketAKeywords,
    pool.bucketBKeywords,
    pool.bucketCKeywords,
    pool.bucketDKeywords
  ])
}

const CANONICAL_PLATFORM_PATTERN = /\b(amazon|walmart|ebay|etsy|aliexpress|temu|shopee)\b/i
const CANONICAL_INFO_QUERY_PATTERN =
  /\b(what is|meaning|tutorial|guide|manual|how to|instructions?|gambar|como|qué es|cos[eè]|qu[e']|cosa|wie|was ist|guida|manuale)\b/i
const CANONICAL_REVIEW_COMPARE_PATTERN =
  /\b(review|reviews|rating|ratings|comparison|compare|vs|versus|ulasan|recensioni?|recensione|bewertung(?:en)?|rezension(?:en)?|rese(?:n|ñ)a(?:s)?|avis|comparaison|comparar|confronto|vergleich|testbericht)\b/i
const CANONICAL_STORE_NAV_PATTERN =
  /\b(official store|official site|store locator|near me|customer service|contact us|help center|support center|order tracking|returns?|shipping policy|faq|login|sign in)\b/i
const CANONICAL_PROMO_PATTERN = /\b(discount|coupon|cheap|sale|deal|offer|promo|price|cost|clearance|best price)\b/i
const CANONICAL_REPEATED_ACTION_PATTERN = /\b(buy|shop|purchase|order)\b.*\b\1\b/i
const CANONICAL_BRAND_SLOGAN_PATTERN = /\b(a\s+cozy\s+home\s+made\s+simple|home\s+made\s+simple)\b/i
const CANONICAL_GEO_ADMIN_PATTERN = /\b(kabupaten|kecamatan|kelurahan)\b/i
const CANONICAL_GARBAGE_TOKEN_PATTERN = /\b(rng)\b/i
const CANONICAL_QUESTION_PREFIX_PATTERN =
  /^(?:what|why|how|when|where|who|which|is|are|do|does|did|can|could|should|would)\b/i
const CANONICAL_SOFT_MODEL_SIZE_PATTERN = /\b(california king|cal king|king size|queen size|twin xl|twin|queen|king|full)\b/gi
const CANONICAL_SOFT_MODEL_DIMENSION_PATTERN = /\b\d{1,3}\s*(?:inch|in)\b/gi
const CANONICAL_SOFT_MODEL_PACK_PATTERN = /\b\d{1,2}\s*(?:pack|count|pc|piece|pieces|set)\b/gi
const CANONICAL_SOFT_MODEL_ATTRIBUTE_PHRASES = [
  'memory foam',
  'gel memory foam',
  'medium firm',
  'extra firm',
  'ultra firm',
  'cooling gel',
]
const CANONICAL_SOFT_MODEL_ATTRIBUTE_TOKENS = new Set([
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
const CANONICAL_NON_ANCHOR_TOKENS = new Set([
  'official',
  'store',
  'shop',
  'collection',
  'sale',
  'deal',
  'discount',
  'coupon',
  'offer',
  'promo',
  'free',
  'shipping',
  'warranty',
  'support',
  'buy',
  'best',
  'top',
  'price',
  'cost',
  'online',
  'near',
  'me',
  'new',
  'latest',
  'review',
  'reviews',
  'rating',
  'ratings',
  'comparison',
  'compare',
  'vs',
  'versus',
  'service',
  'help',
  'contact',
  'tracking',
  'returns',
  'faq',
  'login',
  'site',
  'customer',
])
const CANONICAL_PRIMARY_SOURCES = new Set([
  'KEYWORD_PLANNER_BRAND',
  'KEYWORD_PLANNER',
  'HOT_PRODUCT_AGGREGATE',
  'PARAM_EXTRACT',
  'TITLE_EXTRACT',
  'ABOUT_EXTRACT',
  'PAGE_EXTRACT',
  'ENHANCED_EXTRACT',
])
const MODEL_INTENT_CANONICAL_TOP_SOURCE_BOOSTS = new Map<string, number>([
  ['SEARCH_TERM_HIGH_PERFORMING', 9],
  ['SEARCH_TERM', 8],
  ['HOT_PRODUCT_AGGREGATE', 7],
  ['KEYWORD_PLANNER_BRAND', 6],
  ['KEYWORD_PLANNER', 6],
  ['PARAM_EXTRACT', 6],
  ['TITLE_EXTRACT', 6],
  ['ABOUT_EXTRACT', 5],
  ['PAGE_EXTRACT', 4],
  ['GOOGLE_SUGGEST', 3],
  ['OFFER_EXTRACTED_KEYWORDS', 3],
])
const CANONICAL_FILTER_RELAXED_TOP_SOURCES = new Set([
  'SEARCH_TERM_HIGH_PERFORMING',
  'SEARCH_TERM',
  'HOT_PRODUCT_AGGREGATE',
  'KEYWORD_PLANNER_BRAND',
  'KEYWORD_PLANNER',
  'PARAM_EXTRACT',
  'TITLE_EXTRACT',
  'ABOUT_EXTRACT',
])

function getPoolPureBrandKeywords(pool: OfferKeywordPool): string[] {
  return Array.from(new Set(
    (pool.brandKeywords || [])
      .map((item) => normalizeGoogleAdsKeyword(typeof item === 'string' ? item : item.keyword))
      .filter((item): item is string => !!item)
  ))
}

function collectCanonicalSoftModelSignalTokens(normalizedKeyword: string): Set<string> {
  const softSignalTokens = new Set<string>()

  for (const phrase of CANONICAL_SOFT_MODEL_ATTRIBUTE_PHRASES) {
    if (!normalizedKeyword.includes(phrase)) continue
    for (const token of phrase.split(/\s+/).filter(Boolean)) {
      softSignalTokens.add(token)
    }
  }

  for (const pattern of [
    CANONICAL_SOFT_MODEL_SIZE_PATTERN,
    CANONICAL_SOFT_MODEL_DIMENSION_PATTERN,
    CANONICAL_SOFT_MODEL_PACK_PATTERN,
  ]) {
    const matches = normalizedKeyword.match(pattern) || []
    for (const match of matches) {
      const normalizedMatch = normalizeGoogleAdsKeyword(match) || ''
      for (const token of normalizedMatch.split(/\s+/).filter(Boolean)) {
        softSignalTokens.add(token)
      }
    }
  }

  for (const token of normalizedKeyword.split(/\s+/)) {
    if (CANONICAL_SOFT_MODEL_ATTRIBUTE_TOKENS.has(token)) {
      softSignalTokens.add(token)
    }
  }

  return softSignalTokens
}

function buildCanonicalBrandTokenSet(pureBrandKeywords: string[]): Set<string> {
  return new Set(
    pureBrandKeywords
      .flatMap((item) => item.split(/\s+/))
      .filter(Boolean)
  )
}

function extractCanonicalDemandTokens(keyword: string, pureBrandKeywords: string[]): string[] {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return []

  const brandTokens = buildCanonicalBrandTokenSet(pureBrandKeywords)
  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token.length > 2)
    .filter((token) => !brandTokens.has(token))
    .filter((token) => !CANONICAL_NON_ANCHOR_TOKENS.has(token))
    .filter((token) => !hasModelAnchorEvidence({ keywords: [token] }))
}

function hasDemandAnchorInCanonicalBucket(keyword: string, pureBrandKeywords: string[]): boolean {
  return extractCanonicalDemandTokens(keyword, pureBrandKeywords).length > 0
}

function hasSoftModelFamilySignalInCanonicalBucket(keyword: string, pureBrandKeywords: string[]): boolean {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return false
  if (!containsPureBrand(keyword, pureBrandKeywords)) return false

  const softSignalTokens = collectCanonicalSoftModelSignalTokens(normalized)
  if (softSignalTokens.size === 0) return false

  const productCoreTokens = extractCanonicalDemandTokens(keyword, pureBrandKeywords)
    .filter((token) => !softSignalTokens.has(token))
  return productCoreTokens.length > 0
}

function getCanonicalSourceLabels(item: Pick<PoolKeywordData, 'source'> & {
  sourceType?: string
  sourceSubtype?: string
  rawSource?: string
  derivedTags?: string[]
}): string[] {
  return Array.from(new Set(
    [
      item.sourceType,
      item.sourceSubtype,
      item.rawSource,
      item.source,
      ...(Array.isArray(item.derivedTags) ? item.derivedTags : []),
    ]
      .map((value) => String(value || '').trim().toUpperCase())
      .filter(Boolean)
  ))
}

function getModelIntentCanonicalSourceAdjustment(item: Pick<PoolKeywordData, 'source' | 'sourceType'>): number {
  const labels = getCanonicalSourceLabels(item)
  let adjustment = 0

  for (const label of labels) {
    const exactBoost = MODEL_INTENT_CANONICAL_TOP_SOURCE_BOOSTS.get(label)
    if (typeof exactBoost === 'number') {
      adjustment = Math.max(adjustment, exactBoost)
      continue
    }

    if (label.startsWith('KEYWORD_PLANNER')) {
      adjustment = Math.max(adjustment, 3)
      continue
    }

    if (label.startsWith('GLOBAL_')) {
      adjustment = Math.min(adjustment, -4)
      continue
    }

    if (label === 'MODEL_FAMILY_GUARD') {
      adjustment = Math.min(adjustment, -6)
    }
  }

  return adjustment
}

function isHighPriorityCanonicalSource(item: Pick<
  PoolKeywordData,
  'source' | 'sourceType' | 'sourceSubtype' | 'rawSource' | 'derivedTags'
>): boolean {
  const labels = getCanonicalSourceLabels(item)
  return labels.some((label) => CANONICAL_FILTER_RELAXED_TOP_SOURCES.has(label))
}

function getModelIntentCanonicalVolumeAdjustment(item: Pick<PoolKeywordData, 'searchVolume'>): number {
  const volume = Number(item.searchVolume || 0)
  if (!Number.isFinite(volume) || volume <= 0) return 0
  if (volume >= 500) return 4
  if (volume >= 200) return 3
  if (volume >= 50) return 2
  return 1
}

function getModelIntentCanonicalShapePenalty(keyword: string, pureBrandKeywords: string[]): number {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return 0

  let penalty = 0
  const normalizedBrandKeywords = pureBrandKeywords
    .map((item) => normalizeGoogleAdsKeyword(item))
    .filter((item): item is string => Boolean(item))

  if (
    containsPureBrand(keyword, pureBrandKeywords)
    && normalizedBrandKeywords.length > 0
    && !normalizedBrandKeywords.some((brand) => normalized === brand || normalized.startsWith(`${brand} `))
  ) {
    penalty += 4
  }

  const keywordTokens = normalized.split(/\s+/).filter(Boolean)
  const lastToken = keywordTokens[keywordTokens.length - 1] || ''
  if (/^\d{1,3}$/.test(lastToken)) {
    penalty += 3
  }

  const demandTokens = new Set(extractCanonicalDemandTokens(keyword, pureBrandKeywords))
  const softSignalTokens = collectCanonicalSoftModelSignalTokens(normalized)
  const firstDemandIndex = keywordTokens.findIndex((token) => demandTokens.has(token))
  const firstSoftSignalIndex = keywordTokens.findIndex((token) => softSignalTokens.has(token))
  if (firstDemandIndex >= 0 && firstSoftSignalIndex >= 0 && firstDemandIndex < firstSoftSignalIndex) {
    penalty += 2
  }

  return penalty
}

function buildCanonicalPermutationKey(keyword: string): string {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return ''

  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length <= 1) return normalized
  return [...tokens].sort().join(' ')
}

function buildCanonicalUnitStrippedKey(keyword: string): string {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return ''

  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token !== 'inch' && token !== 'in')
    .join(' ')
}

function normalizeCanonicalCommercialConceptToken(token: string): string {
  const normalized = String(token || '').trim().toLowerCase()
  if (!normalized || /\d/.test(normalized)) return normalized

  if (/ies$/.test(normalized) && normalized.length > 4) {
    return `${normalized.slice(0, -3)}y`
  }
  if (/(sses|shes|ches|xes|zes)$/.test(normalized) && normalized.length > 5) {
    return normalized.slice(0, -2)
  }
  if (/s$/.test(normalized) && !/ss$/.test(normalized) && normalized.length > 4) {
    return normalized.slice(0, -1)
  }

  return normalized
}

function buildCanonicalCommercialConceptKey(keyword: string): string {
  const normalized = normalizeGoogleAdsKeyword(keyword)
  if (!normalized) return ''

  const tokens = normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !CANONICAL_NON_ANCHOR_TOKENS.has(token))
    .map(normalizeCanonicalCommercialConceptToken)
    .filter(Boolean)

  if (tokens.length === 0) return ''
  return [...tokens].sort().join(' ')
}

function pruneCanonicalCommercialVariants(
  keywords: PoolKeywordData[],
  pureBrandKeywords: string[],
  creativeType: CanonicalCreativeType
): PoolKeywordData[] {
  const pruned: PoolKeywordData[] = []
  const seenBaseConceptKeys = new Set<string>()
  const seenCommercialConceptKeys = new Set<string>()
  const seenConceptKeys = new Set<string>()

  for (const item of keywords) {
    if (isPureBrandPoolKeyword(item, pureBrandKeywords)) {
      pruned.push(item)
      continue
    }

    const conceptKey = buildCanonicalCommercialConceptKey(item.keyword)
    if (!conceptKey) {
      pruned.push(item)
      continue
    }

    const intent = classifyKeywordIntent(item.keyword).intent
    if (creativeType === 'brand_intent') {
      if (seenConceptKeys.has(conceptKey)) continue
      seenConceptKeys.add(conceptKey)
      pruned.push(item)
      continue
    }

    const perIntentSeenConceptKeys = (
      intent === 'TRANSACTIONAL' || intent === 'COMMERCIAL'
        ? seenCommercialConceptKeys
        : seenBaseConceptKeys
    )
    if (perIntentSeenConceptKeys.has(conceptKey)) continue
    perIntentSeenConceptKeys.add(conceptKey)
    pruned.push(item)
  }

  return pruned
}

function shouldPruneModelIntentCanonicalVariant(
  item: PoolKeywordData,
  pureBrandKeywords: string[],
  seenPermutationKeys: Set<string>,
  seenUnitStrippedKeys: Set<string>
): boolean {
  const normalized = normalizeGoogleAdsKeyword(item.keyword)
  if (!normalized) return false

  const shapePenalty = getModelIntentCanonicalShapePenalty(item.keyword, pureBrandKeywords)
  if (shapePenalty <= 0) return false

  const permutationKey = buildCanonicalPermutationKey(normalized)
  if (permutationKey && seenPermutationKeys.has(permutationKey)) {
    return true
  }

  const trailingToken = normalized.split(/\s+/).filter(Boolean).slice(-1)[0] || ''
  const hasBareTrailingNumericSpec = /^\d{1,3}$/.test(trailingToken)
  if (hasBareTrailingNumericSpec && seenUnitStrippedKeys.has(normalized)) {
    return true
  }

  return false
}

function pruneModelIntentCanonicalVariants(
  keywords: PoolKeywordData[],
  pureBrandKeywords: string[]
): PoolKeywordData[] {
  const pruned: PoolKeywordData[] = []
  const seenPermutationKeys = new Set<string>()
  const seenUnitStrippedKeys = new Set<string>()

  for (const item of keywords) {
    const normalized = normalizeGoogleAdsKeyword(item.keyword)
    if (!normalized) continue

    if (
      shouldPruneModelIntentCanonicalVariant(
        item,
        pureBrandKeywords,
        seenPermutationKeys,
        seenUnitStrippedKeys
      )
    ) {
      continue
    }

    pruned.push(item)
    seenPermutationKeys.add(buildCanonicalPermutationKey(normalized))
    seenUnitStrippedKeys.add(buildCanonicalUnitStrippedKey(normalized))
  }

  return pruned
}

function isPureBrandPoolKeyword(item: PoolKeywordData, pureBrandKeywords: string[]): boolean {
  return Boolean(item.isPureBrand) || isPureBrandKeywordInternal(item.keyword, pureBrandKeywords)
}

function shouldDropCanonicalKeyword(
  item: PoolKeywordData,
  creativeType: CanonicalCreativeType,
  pureBrandKeywords: string[]
): boolean {
  const keyword = item.keyword
  if (!keyword) return true
  const normalizedKeyword = normalizeGoogleAdsKeyword(keyword) || keyword
  if (CANONICAL_PLATFORM_PATTERN.test(normalizedKeyword)) return true
  if (CANONICAL_INFO_QUERY_PATTERN.test(normalizedKeyword)) return true
  if (CANONICAL_REVIEW_COMPARE_PATTERN.test(normalizedKeyword)) return true
  if (CANONICAL_REPEATED_ACTION_PATTERN.test(normalizedKeyword)) return true
  if (CANONICAL_BRAND_SLOGAN_PATTERN.test(normalizedKeyword)) return true
  if (CANONICAL_GARBAGE_TOKEN_PATTERN.test(normalizedKeyword)) return true

  const hasDemandAnchor = hasDemandAnchorInCanonicalBucket(keyword, pureBrandKeywords)
  const isPureBrand = isPureBrandPoolKeyword(item, pureBrandKeywords)
  const hasModelAnchor = hasModelAnchorEvidence({ keywords: [keyword] })
  const hasSoftModelFamilySignal = hasSoftModelFamilySignalInCanonicalBucket(keyword, pureBrandKeywords)
  const canRelaxByHighPrioritySource = isHighPriorityCanonicalSource(item)
    && (hasDemandAnchor || hasModelAnchor || hasSoftModelFamilySignal)
  if (CANONICAL_GEO_ADMIN_PATTERN.test(normalizedKeyword) && !hasModelAnchor) return true
  if (
    CANONICAL_QUESTION_PREFIX_PATTERN.test(normalizedKeyword)
    && !hasDemandAnchor
    && !hasModelAnchor
    && !hasSoftModelFamilySignal
  ) return true

  if (CANONICAL_STORE_NAV_PATTERN.test(normalizedKeyword) && !hasDemandAnchor && !canRelaxByHighPrioritySource) return true
  if (CANONICAL_PROMO_PATTERN.test(normalizedKeyword) && !hasDemandAnchor && !canRelaxByHighPrioritySource) {
    return true
  }
  if (
    creativeType === 'model_intent'
    && !hasModelAnchor
    && !hasSoftModelFamilySignal
  ) return true
  if (creativeType === 'model_intent' && isPureBrand) return true
  if (creativeType === 'product_intent' && hasModelAnchor && !hasDemandAnchor) return true

  return false
}

function scoreCanonicalKeyword(
  item: PoolKeywordData,
  creativeType: CanonicalCreativeType,
  pureBrandKeywords: string[]
): number {
  const keyword = item.keyword
  const isPureBrand = isPureBrandPoolKeyword(item, pureBrandKeywords)
  const hasBrand = containsPureBrand(keyword, pureBrandKeywords)
  const hasModelAnchor = hasModelAnchorEvidence({ keywords: [keyword] })
  const hasDemandAnchor = hasDemandAnchorInCanonicalBucket(keyword, pureBrandKeywords)
  const hasSoftModelFamilySignal = hasSoftModelFamilySignalInCanonicalBucket(keyword, pureBrandKeywords)
  const intent = classifyKeywordIntent(keyword).intent

  if (creativeType === 'brand_intent') {
    let score = 0
    if (hasBrand) score += 4
    if (hasDemandAnchor) score += 3
    if (hasModelAnchor) score += 1
    if (isPureBrand) score -= 5
    return score
  }

  if (creativeType === 'model_intent') {
    let score = 0
    if (hasModelAnchor) score += 10
    if (hasSoftModelFamilySignal) score += 7
    if (hasDemandAnchor) score += 1
    if (hasBrand) score += 1
    score += getModelIntentCanonicalSourceAdjustment(item)
    score += getModelIntentCanonicalVolumeAdjustment(item)
    score -= getModelIntentCanonicalShapePenalty(keyword, pureBrandKeywords)
    if (!hasModelAnchor && !hasSoftModelFamilySignal) score -= 10
    return score
  }

  let score = 0
  if (hasDemandAnchor) score += 4
  if (hasBrand) score += 1
  if (hasModelAnchor) score -= 1
  if (intent === 'TRANSACTIONAL' || intent === 'COMMERCIAL') score += 1
  if (isPureBrand) score -= 6
  return score
}

function sortCanonicalKeywords(
  keywords: PoolKeywordData[],
  creativeType: CanonicalCreativeType,
  pureBrandKeywords: string[]
): PoolKeywordData[] {
  const filtered = keywords.filter((item) => !shouldDropCanonicalKeyword(item, creativeType, pureBrandKeywords))
  const ranked = [...filtered].sort((a, b) => {
    const scoreDiff = scoreCanonicalKeyword(b, creativeType, pureBrandKeywords)
      - scoreCanonicalKeyword(a, creativeType, pureBrandKeywords)
    if (scoreDiff !== 0) return scoreDiff

    const sourceRankDiff =
      getKeywordSourcePriorityForPoolItem(a)
      - getKeywordSourcePriorityForPoolItem(b)
    if (sourceRankDiff !== 0) return sourceRankDiff

    const volumeDiff = (b.searchVolume || 0) - (a.searchVolume || 0)
    if (volumeDiff !== 0) return volumeDiff

    const brandDiff = Number(containsPureBrand(b.keyword, pureBrandKeywords))
      - Number(containsPureBrand(a.keyword, pureBrandKeywords))
    if (brandDiff !== 0) return brandDiff

    return a.keyword.length - b.keyword.length
  })

  let finalized = ranked

  if (creativeType === 'product_intent') {
    const nonPureBrand = finalized.filter((item) => !isPureBrandPoolKeyword(item, pureBrandKeywords))
    if (nonPureBrand.length > 0) {
      const pureBrandFallback = finalized.find((item) => isPureBrandPoolKeyword(item, pureBrandKeywords))
      finalized = pureBrandFallback
        ? [...nonPureBrand, pureBrandFallback]
        : nonPureBrand
    }
  }

  if (creativeType === 'model_intent') {
    return pruneModelIntentCanonicalVariants(finalized, pureBrandKeywords)
  }

  return pruneCanonicalCommercialVariants(finalized, pureBrandKeywords, creativeType)
}

function isPrimaryCanonicalSource(source: string | undefined): boolean {
  return CANONICAL_PRIMARY_SOURCES.has(String(source || '').toUpperCase())
}

function getCanonicalBucketTargets(
  item: PoolKeywordData,
  pureBrandKeywords: string[]
): Array<'A' | 'B' | 'D'> {
  const keyword = item.keyword
  if (!keyword) return []

  const isPureBrand = isPureBrandPoolKeyword(item, pureBrandKeywords)
  const hasBrand = containsPureBrand(keyword, pureBrandKeywords)
  const hasModelAnchor = hasModelAnchorEvidence({ keywords: [keyword] })
  const hasDemandAnchor = hasDemandAnchorInCanonicalBucket(keyword, pureBrandKeywords)
  const hasSoftModelFamilySignal = hasSoftModelFamilySignalInCanonicalBucket(keyword, pureBrandKeywords)
  const targets: Array<'A' | 'B' | 'D'> = []

  if (isPureBrand || (hasBrand && (hasDemandAnchor || hasModelAnchor))) {
    targets.push('A')
  }
  if (hasModelAnchor || hasSoftModelFamilySignal) {
    targets.push('B')
  }
  if (hasDemandAnchor) {
    targets.push('D')
  }

  return targets
}

function buildCanonicalSourceFirstBucketKeywords(
  pool: OfferKeywordPool,
  bucket: 'A' | 'B' | 'D',
  linkType: 'product' | 'store'
): PoolKeywordData[] {
  const pureBrandKeywords = getPoolPureBrandKeywords(pool)
  const bucketCandidates: Record<'A' | 'B' | 'D', {
    primary: PoolKeywordData[]
    compatibility: PoolKeywordData[]
  }> = {
    A: { primary: [], compatibility: [] },
    B: { primary: [], compatibility: [] },
    D: { primary: [], compatibility: [] },
  }

  for (const item of getComprehensiveKeywordsForPool(pool, linkType)) {
    const targets = getCanonicalBucketTargets(item, pureBrandKeywords)
    if (targets.length === 0) continue

    const sourceTier = isPrimaryCanonicalSource(item.source)
      ? 'primary'
      : 'compatibility'

    for (const target of targets) {
      bucketCandidates[target][sourceTier].push(item)
    }
  }

  const merged = mergeKeywordDataLists([
    bucketCandidates[bucket].primary,
    bucketCandidates[bucket].compatibility,
  ])

  if (bucket === 'A') {
    return sortCanonicalKeywords(merged, 'brand_intent', pureBrandKeywords)
  }

  if (bucket === 'B') {
    return sortCanonicalKeywords(merged, 'model_intent', pureBrandKeywords)
  }

  return sortCanonicalKeywords(merged, 'product_intent', pureBrandKeywords)
}

function buildLegacyProjectedCanonicalBucketKeywords(
  pool: OfferKeywordPool,
  bucket: 'A' | 'B' | 'D',
  linkType: 'product' | 'store'
): PoolKeywordData[] {
  const pureBrandKeywords = getPoolPureBrandKeywords(pool)
  const isStore = linkType === 'store'

  if (bucket === 'A') {
    return sortCanonicalKeywords(
      mergeKeywordDataLists([
        pool.brandKeywords,
        isStore ? pool.storeBucketAKeywords : pool.bucketAKeywords,
        isStore ? pool.storeBucketCKeywords : [],
      ]),
      'brand_intent',
      pureBrandKeywords
    )
  }

  if (bucket === 'B') {
    const merged = mergeKeywordDataLists([
      pool.brandKeywords,
      isStore ? pool.storeBucketAKeywords : pool.bucketAKeywords,
      isStore ? pool.storeBucketBKeywords : pool.bucketBKeywords,
      isStore ? pool.storeBucketCKeywords : pool.bucketCKeywords,
      isStore ? pool.storeBucketSKeywords : pool.bucketDKeywords,
    ])
    const modelAnchored = merged.filter((item) =>
      hasModelAnchorEvidence({ keywords: [item.keyword] })
      || hasSoftModelFamilySignalInCanonicalBucket(item.keyword, pureBrandKeywords)
    )
    return sortCanonicalKeywords(modelAnchored, 'model_intent', pureBrandKeywords)
  }

  return sortCanonicalKeywords(
    getComprehensiveKeywordsForPool(pool, linkType),
    'product_intent',
    pureBrandKeywords
  )
}

function buildCanonicalBucketKeywords(
  pool: OfferKeywordPool,
  bucket: 'A' | 'B' | 'D',
  linkType: 'product' | 'store'
): PoolKeywordData[] {
  const sourceFirst = buildCanonicalSourceFirstBucketKeywords(pool, bucket, linkType)
  if (sourceFirst.length > 0) {
    return sourceFirst
  }

  return buildLegacyProjectedCanonicalBucketKeywords(pool, bucket, linkType)
}

interface OfferKeywordContextForCanonicalFilter {
  brand: string | null
  page_type: string | null
  category: string | null
  product_name: string | null
  offer_name: string | null
  target_country: string | null
  target_language: string | null
  scraped_data: string | null
  final_url: string | null
  url: string | null
}

const OFFER_CONTEXT_FILTERED_DERIVED_TAG = 'OFFER_CONTEXT_FILTERED'

function markOfferContextFilteredKeywords(keywords: PoolKeywordData[]): PoolKeywordData[] {
  return keywords.map((item) => {
    const existingTags = Array.isArray((item as any).derivedTags)
      ? (item as any).derivedTags
          .map((tag: unknown) => String(tag || '').trim())
          .filter(Boolean)
      : []
    if (existingTags.some((tag: string) => tag.toUpperCase() === OFFER_CONTEXT_FILTERED_DERIVED_TAG)) {
      return item
    }

    return {
      ...item,
      derivedTags: [...existingTags, OFFER_CONTEXT_FILTERED_DERIVED_TAG],
    }
  })
}

async function getOfferContextForCanonicalFilter(offerId: number): Promise<OfferKeywordContextForCanonicalFilter | null> {
  const db = await getDatabase()
  return (
    await db.queryOne<OfferKeywordContextForCanonicalFilter>(
    `SELECT brand, page_type, category, product_name, offer_name, target_country, target_language, scraped_data, final_url, url
     FROM offers
     WHERE id = ?`,
    [offerId]
    )
  ) || null
}

function buildEmptyCanonicalModelIntentFallback(params: {
  offerContext: OfferKeywordContextForCanonicalFilter
  scopeLabel: string
}): PoolKeywordData[] {
  const pageType = String(params.offerContext.page_type || '').trim().toLowerCase()
  if (pageType === 'store') return []

  const modelFamilyContext = buildProductModelFamilyContext({
    brand: params.offerContext.brand,
    product_name: params.offerContext.product_name,
    offer_name: params.offerContext.offer_name,
    scraped_data: params.offerContext.scraped_data,
    final_url: params.offerContext.final_url,
    url: params.offerContext.url,
  })
  const fallbackKeywords = buildProductModelFamilyFallbackKeywords({
    context: modelFamilyContext,
    brandName: params.offerContext.brand,
  })
  if (fallbackKeywords.length === 0) return []

  const normalizedModelCodes = Array.from(new Set(
    modelFamilyContext.modelCodes
      .map((item) => normalizeGoogleAdsKeyword(item))
      .filter((item): item is string => Boolean(item))
  ))
  const structuredModelFallbackKeywords = normalizedModelCodes.length > 0
    ? fallbackKeywords.filter((keyword) => {
      const normalizedKeyword = normalizeGoogleAdsKeyword(keyword) || ''
      if (!normalizedKeyword) return false
      const keywordTokens = new Set(normalizedKeyword.split(/\s+/).filter(Boolean))
      return normalizedModelCodes.some((code) => keywordTokens.has(code))
    })
    : fallbackKeywords

  const effectiveFallbackKeywords = structuredModelFallbackKeywords.length > 0
    ? structuredModelFallbackKeywords
    : normalizedModelCodes.length > 0
      ? []
      : fallbackKeywords
  if (effectiveFallbackKeywords.length === 0) return []

  const fallbackSource = normalizedModelCodes.length > 0
    ? 'MODEL_ENTITY_FALLBACK'
    : 'MODEL_FAMILY_GUARD'

  console.warn(
    `⚠️ model_intent canonical 为空，已注入 ${effectiveFallbackKeywords.length} 个${normalizedModelCodes.length > 0 ? '结构化型号' : ' soft-family'} fallback (${params.scopeLabel})`
  )

  return effectiveFallbackKeywords.map((keyword) => ({
    keyword,
    searchVolume: 0,
    source: fallbackSource,
    sourceType: fallbackSource,
    sourceSubtype: fallbackSource,
    rawSource: 'DERIVED_RESCUE',
    derivedTags: [fallbackSource, OFFER_CONTEXT_FILTERED_DERIVED_TAG],
    matchType: 'EXACT',
  }))
}

function isModelFamilyGuardPoolKeyword(item: PoolKeywordData | null | undefined): boolean {
  if (!item) return false
  const sourceKeys = [
    (item as any)?.source,
    (item as any)?.sourceType,
    (item as any)?.sourceSubtype,
  ].map((value) => String(value || '').trim().toUpperCase())

  if (sourceKeys.includes('MODEL_FAMILY_GUARD')) return true

  const derivedTags = Array.isArray((item as any)?.derivedTags)
    ? (item as any).derivedTags
    : []

  return derivedTags.some((tag: unknown) => String(tag || '').trim().toUpperCase() === 'MODEL_FAMILY_GUARD')
}

function sortModelIntentRescueKeywords(
  keywords: PoolKeywordData[],
  pureBrandKeywords: string[]
): PoolKeywordData[] {
  const ranked = [...keywords].sort((a, b) => {
    const scoreDiff = scoreCanonicalKeyword(b, 'model_intent', pureBrandKeywords)
      - scoreCanonicalKeyword(a, 'model_intent', pureBrandKeywords)
    if (scoreDiff !== 0) return scoreDiff

    const sourceRankDiff =
      getKeywordSourcePriorityForPoolItem(a)
      - getKeywordSourcePriorityForPoolItem(b)
    if (sourceRankDiff !== 0) return sourceRankDiff

    const volumeDiff = (b.searchVolume || 0) - (a.searchVolume || 0)
    if (volumeDiff !== 0) return volumeDiff

    return a.keyword.length - b.keyword.length
  })

  return pruneModelIntentCanonicalVariants(ranked, pureBrandKeywords)
}

function buildCrossBucketModelIntentRescueKeywords(params: {
  offerContext: OfferKeywordContextForCanonicalFilter
  fallbackCandidates: PoolKeywordData[]
  currentKeywords?: PoolKeywordData[]
  blockedKeywordKeys?: string[]
  pureBrandKeywords: string[]
  scopeLabel: string
}): PoolKeywordData[] {
  const modelFamilyContext = buildProductModelFamilyContext({
    brand: params.offerContext.brand,
    product_name: params.offerContext.product_name,
    offer_name: params.offerContext.offer_name,
    scraped_data: params.offerContext.scraped_data,
    final_url: params.offerContext.final_url,
    url: params.offerContext.url,
  })
  const currentKeywordKeys = new Set(
    (params.currentKeywords || [])
      .filter((item) => !isModelFamilyGuardPoolKeyword(item))
      .map((item) => normalizeGoogleAdsKeyword(item.keyword))
      .filter((item): item is string => Boolean(item))
  )
  const blockedKeywordKeySet = new Set(
    (params.blockedKeywordKeys || [])
      .map((item) => normalizeGoogleAdsKeyword(item))
      .filter((item): item is string => Boolean(item))
  )
  const candidates = mergeKeywordDataLists([params.fallbackCandidates])
    .filter((item) => !isModelFamilyGuardPoolKeyword(item))
    .filter((item) => !isPureBrandPoolKeyword(item, params.pureBrandKeywords))
    .filter((item) => containsPureBrand(item.keyword, params.pureBrandKeywords))
    .filter((item) => {
      const normalized = normalizeGoogleAdsKeyword(item.keyword)
      return Boolean(normalized)
        && !currentKeywordKeys.has(normalized)
        && !blockedKeywordKeySet.has(normalized)
    })
    .filter((item) => {
      const normalized = normalizeGoogleAdsKeyword(item.keyword) || ''
      if (!normalized) return false
      if (CANONICAL_PLATFORM_PATTERN.test(normalized)) return false
      if (CANONICAL_INFO_QUERY_PATTERN.test(normalized)) return false
      if (CANONICAL_REVIEW_COMPARE_PATTERN.test(normalized)) return false
      if (CANONICAL_STORE_NAV_PATTERN.test(normalized)) return false
      if (CANONICAL_PROMO_PATTERN.test(normalized)) return false
      if (CANONICAL_REPEATED_ACTION_PATTERN.test(normalized)) return false
      if (CANONICAL_BRAND_SLOGAN_PATTERN.test(normalized)) return false
      if (CANONICAL_GEO_ADMIN_PATTERN.test(normalized)) return false
      if (CANONICAL_GARBAGE_TOKEN_PATTERN.test(normalized)) return false
      if (CANONICAL_QUESTION_PREFIX_PATTERN.test(normalized)) return false
      return true
    })

  if (candidates.length === 0) return []

  const filtered = filterKeywordObjectsByProductModelFamily(
    candidates,
    modelFamilyContext
  ).filtered
    .filter((item) => !isModelFamilyGuardPoolKeyword(item))
    .filter((item) => !isPureBrandPoolKeyword(item, params.pureBrandKeywords))

  if (filtered.length === 0) return []

  const positiveVolumeKeywords = filtered.filter((item) => Number(item.searchVolume || 0) > 0)
  const effectiveKeywords = positiveVolumeKeywords.length >= MODEL_INTENT_MIN_KEYWORD_FLOOR
    ? positiveVolumeKeywords
    : filtered

  return markOfferContextFilteredKeywords(
    sortModelIntentRescueKeywords(effectiveKeywords, params.pureBrandKeywords)
  )
}

async function applyOfferContextToCanonicalKeywords(params: {
  offerId: number
  keywords: PoolKeywordData[]
  creativeType: CanonicalCreativeType | null
  scopeLabel: string
  fallbackCandidates?: PoolKeywordData[]
  pureBrandKeywords?: string[]
}): Promise<PoolKeywordData[]> {
  const { offerId, keywords, creativeType, scopeLabel } = params
  if (!creativeType) return keywords
  if (creativeType !== 'brand_intent' && creativeType !== 'model_intent' && creativeType !== 'product_intent') {
    return keywords
  }

  const offerContext = await getOfferContextForCanonicalFilter(offerId)
  if (!offerContext) return keywords
  const pureBrandKeywords = Array.from(new Set(
    (params.pureBrandKeywords || [])
      .map((item) => normalizeGoogleAdsKeyword(item))
      .filter((item): item is string => Boolean(item))
  ))
  const pageType = String(offerContext.page_type || '').trim().toLowerCase()
  const shouldAttemptModelIntentCrossBucketRescue = (
    creativeType === 'model_intent'
    && pageType === 'product'
    && Array.isArray(params.fallbackCandidates)
    && params.fallbackCandidates.length > 0
  )
  if (keywords.length === 0 && creativeType === 'model_intent') {
    if (shouldAttemptModelIntentCrossBucketRescue) {
      const rescued = buildCrossBucketModelIntentRescueKeywords({
        offerContext,
        fallbackCandidates: params.fallbackCandidates || [],
        currentKeywords: keywords,
        blockedKeywordKeys: [],
        pureBrandKeywords,
        scopeLabel,
      })
      if (rescued.length > 0) {
        console.warn(
          `⚠️ model_intent canonical 为空，已回补 ${rescued.length} 个跨桶可信词 (${scopeLabel})`
        )
        return rescued
      }
    }

    return buildEmptyCanonicalModelIntentFallback({
      offerContext,
      scopeLabel,
    })
  }

  const filterResult = filterCreativeKeywordsByOfferContextDetailed({
    offer: offerContext,
    keywordsWithVolume: keywords,
    scopeLabel,
    creativeType,
  })
  const filtered = filterResult.keywords

  if (
    shouldAttemptModelIntentCrossBucketRescue
    && (filtered.length === 0 || filtered.every((item) => isModelFamilyGuardPoolKeyword(item)))
  ) {
    const rescued = buildCrossBucketModelIntentRescueKeywords({
      offerContext,
      fallbackCandidates: params.fallbackCandidates || [],
      currentKeywords: filtered,
      blockedKeywordKeys: filterResult.blockedKeywordKeys,
      pureBrandKeywords,
      scopeLabel,
    })
    if (rescued.length > 0) {
      console.warn(
        `⚠️ model_intent canonical 退化为 guard/空，已回补 ${rescued.length} 个跨桶可信词 (${scopeLabel})`
      )
      return rescued
    }

    const directFallback = buildEmptyCanonicalModelIntentFallback({
      offerContext,
      scopeLabel,
    })
    if (directFallback.length > 0) {
      return directFallback
    }
  }

  return markOfferContextFilteredKeywords(filtered)
}

/**
 * 获取桶的关键词和意图信息
 *
 * @param pool - 关键词池
 * @param bucket - 桶类型
 * @returns 桶信息
 */
export function getBucketInfo(
  pool: OfferKeywordPool,
  bucket: BucketType
): { keywords: PoolKeywordData[]; intent: string; intentEn: string } {
  const linkType = pool.linkType === 'store' ? 'store' : 'product'
  const isStore = linkType === 'store'

  switch (bucket) {
    case 'A':
      return {
        keywords: buildCanonicalBucketKeywords(pool, 'A', linkType),
        intent: isStore ? '品牌意图' : '品牌意图',
        intentEn: 'Brand Intent'
      }
    case 'B':
      return {
        keywords: buildCanonicalBucketKeywords(pool, 'B', linkType),
        intent: isStore ? '热门商品型号/产品族意图' : '商品型号/产品族意图',
        intentEn: isStore ? 'Store Model Intent' : 'Model Intent'
      }
    case 'C':
      return {
        // 🔧 向后兼容：旧版 C 桶在当前策略下等价于 B（商品型号/产品族意图）
        keywords: getBucketInfo(pool, 'B').keywords,
        intent: getBucketInfo(pool, 'B').intent,
        intentEn: getBucketInfo(pool, 'B').intentEn
      }
    case 'S':
      // 🔧 向后兼容：旧版 S 桶在 KISS-3 类型方案中等价于 D（商品需求意图）
      return {
        keywords: buildCanonicalBucketKeywords(pool, 'D', linkType),
        intent: isStore
          ? '商品需求意图'
          : '商品需求意图',
        intentEn: 'Product Demand Intent'
      }
    case 'D':
      // ✅ KISS优化：D 桶 = 商品需求意图
      // D 桶用于“全量覆盖”创意，确保包含全部合格关键词
      return {
        keywords: buildCanonicalBucketKeywords(pool, 'D', linkType),
        intent: isStore
          ? '商品需求意图'
          : '商品需求意图',
        intentEn: 'Product Demand Intent'
      }
    default:
      throw new Error(`Invalid bucket type: ${bucket}`)
  }
}

/**
 * KISS-3类型：将历史bucket映射到仅3个“用户可见创意类型”
 * - A -> A
 * - B/C -> B（商品型号/产品族意图）
 * - D/S -> D（商品需求意图）
 */
function mapBucketToKissType(bucket: BucketType): 'A' | 'B' | 'D' {
  if (bucket === 'A') return 'A'
  if (bucket === 'B' || bucket === 'C') return 'B'
  return 'D' // D 或 S
}

/**
 * 🆕 2025-12-22: 获取综合桶关键词（第5个创意专用）
 *
 * 策略：
 * 1. 包含所有品牌关键词（100%）
 * 2. 从A+B+C+D各桶中选择搜索量最高的非品牌关键词
 * 3. 按搜索量降序排序
 *
 * @param pool - 关键词池
 * @param userId - 用户ID（用于获取搜索量）
 * @param country - 目标国家
 * @param config - coverage 关键词配置
 * @returns coverage 关键词列表（带搜索量）
 */
export async function getCoverageBucketKeywords(
  pool: OfferKeywordPool,
  userId: number,
  country: string = 'US',
  config: CoverageKeywordConfig = DEFAULT_COVERAGE_KEYWORD_CONFIG
): Promise<Array<{ keyword: string; searchVolume: number; isBrand: boolean }>> {
  console.log(`\n🔮 开始构建商品需求 coverage 关键词池...`)
  const linkType = pool.linkType === 'store' ? 'store' : 'product'
  const pureBrandKeywords = getPoolPureBrandKeywords(pool)

  // 1. 收集所有品牌词（从 PoolKeywordData[] 提取）
  const brandKeywords = pool.brandKeywords.map(kw => ({
    keyword: typeof kw === 'string' ? kw : kw.keyword,
    searchVolume: typeof kw === 'string' ? 0 : (kw.searchVolume || 0),
    isBrand: true
  }))
  console.log(`   品牌词: ${brandKeywords.length}个`)

  // 2. 使用 canonical D 视图收集 coverage 候选，避免遗漏 bucketD / 店铺 store buckets。
  const coverageCandidates = buildCanonicalBucketKeywords(pool, 'D', linkType)

  // 3. 收集所有非纯品牌词（去重）
  const allNonBrandKeywords = new Set<string>([
    ...coverageCandidates
      .filter(kw => !isPureBrandPoolKeyword(kw, pureBrandKeywords))
      .map(kw => kw.keyword)
  ])
  console.log(`   非品牌词（去重后）: ${allNonBrandKeywords.size}个`)

  // 4. 如果需要按搜索量排序，获取搜索量数据
  let nonBrandWithVolume: Array<{
    keyword: string
    searchVolume: number
    isBrand: boolean
    volumeUnavailableReason?: unknown
  }> = []

  if (config.sortByVolume && allNonBrandKeywords.size > 0) {
    try {
      const { getKeywordVolumesForExisting } = await import('./unified-keyword-service')
      const volumeData = await getKeywordVolumesForExisting({
        baseKeywords: Array.from(allNonBrandKeywords),
        country,
        language: normalizeLanguageCode(config.language || 'en'),
        userId,
        brandName: pool.brandKeywords[0] ? (typeof pool.brandKeywords[0] === 'string' ? pool.brandKeywords[0] : pool.brandKeywords[0].keyword) : ''
      })

      // 构建搜索量映射（保留“搜索量不可用”标记）
      const volumeMap = new Map(
        volumeData.map(v => [
          v.keyword.toLowerCase(),
          {
            searchVolume: v.searchVolume,
            volumeUnavailableReason: v.volumeUnavailableReason,
          }
        ])
      )

      // 转换为带搜索量的格式
      nonBrandWithVolume = Array.from(allNonBrandKeywords).map(kw => ({
        keyword: kw,
        searchVolume: Number(volumeMap.get(kw.toLowerCase())?.searchVolume || 0),
        volumeUnavailableReason: volumeMap.get(kw.toLowerCase())?.volumeUnavailableReason,
        isBrand: false
      }))

      // 按搜索量降序排序
      nonBrandWithVolume.sort((a, b) => b.searchVolume - a.searchVolume)

      // 过滤低于阈值的关键词
      // 🔧 修复(2026-03-05): Explorer/权限受限返回 volumeUnavailableReason 时，跳过全部搜索量过滤
      const hasAnyVolume = nonBrandWithVolume.some(kw => kw.searchVolume > 0)
      const volumeUnavailable = hasSearchVolumeUnavailableFlag(nonBrandWithVolume as Array<{ volumeUnavailableReason?: unknown }>)
      if (hasAnyVolume && !volumeUnavailable) {
        nonBrandWithVolume = nonBrandWithVolume.filter(
          kw => kw.searchVolume >= config.minSearchVolume
        )
        console.log(`   获取搜索量成功，过滤后剩余: ${nonBrandWithVolume.length}个`)
      } else if (hasAnyVolume && volumeUnavailable) {
        console.log(`   ⚠️ 搜索量数据不可用（Planner 权限受限），跳过搜索量过滤`)
      } else {
        console.log(`   ⚠️ 所有关键词搜索量为0（可能是服务账号模式），跳过搜索量过滤`)
      }
    } catch (error: any) {
      console.warn(`   ⚠️ 获取搜索量失败，使用原始顺序:`, error.message)
      nonBrandWithVolume = Array.from(allNonBrandKeywords).map(kw => ({
        keyword: kw,
        searchVolume: 0,
        isBrand: false
      }))
    }
  } else {
    // 不需要排序，直接使用
    nonBrandWithVolume = Array.from(allNonBrandKeywords).map(kw => ({
      keyword: kw,
      searchVolume: 0,
      isBrand: false
    }))
  }

  // 5. 取Top N非品牌词
  const topNonBrandKeywords = nonBrandWithVolume.slice(0, config.maxNonBrandKeywords)
  console.log(`   选取Top${config.maxNonBrandKeywords}高搜索量词: ${topNonBrandKeywords.length}个`)

  // 6. 合并：品牌词 + 高搜索量非品牌词
  const result = [...brandKeywords, ...topNonBrandKeywords]

  console.log(`✅ 商品需求 coverage 关键词池构建完成: 共${result.length}个关键词`)
  console.log(`   - 品牌词: ${brandKeywords.length}个`)
  console.log(`   - 高搜索量非品牌词: ${topNonBrandKeywords.length}个`)
  if (topNonBrandKeywords.length > 0) {
    console.log(`   - 最高搜索量: ${topNonBrandKeywords[0]?.keyword} (${topNonBrandKeywords[0]?.searchVolume})`)
  }

  return result
}

/**
 * 兼容旧命名：保留 getSyntheticBucketKeywords，实际转发到 coverage helper
 */
export async function getSyntheticBucketKeywords(
  pool: OfferKeywordPool,
  userId: number,
  country: string = 'US',
  config: SyntheticKeywordConfig = DEFAULT_SYNTHETIC_CONFIG
): Promise<Array<{ keyword: string; searchVolume: number; isBrand: boolean }>> {
  return getCoverageBucketKeywords(pool, userId, country, config)
}

/**
 * KISS-3 方案中不再生成独立的旧 S/综合创意槽位；该 helper 仅保留兼容签名。
 */
export async function canGenerateCoverageCreative(offerId: number): Promise<boolean> {
  void offerId
  return false
}

/**
 * 兼容旧命名：旧 synthetic helper 已退化为 coverage helper，不再代表单独创意类型。
 */
export async function canGenerateSyntheticCreative(offerId: number): Promise<boolean> {
  return canGenerateCoverageCreative(offerId)
}

/**
 * 获取可用的桶（未被占用的）
 *
 * @param offerId - Offer ID
 * @returns 可用桶列表
 */
export async function getAvailableBuckets(offerId: number): Promise<BucketType[]> {
  const db = await getDatabase()

  // 🔧 修复(2025-01-02): 只查询未删除的创意，排除软删除的创意
  // 🔥 修复(2026-03-15): 同时排除 creation_status='generating' 的占位记录（防止并发竞态）
  const usedCreatives = await db.query<{
    creative_type: string | null
    keyword_bucket: string | null
    headlines: string | null
    descriptions: string | null
    keywords: string | null
    theme: string | null
    bucket_intent: string | null
  }>(
    `SELECT creative_type, keyword_bucket, headlines, descriptions, keywords, theme, bucket_intent
     FROM ad_creatives
     WHERE offer_id = ?
       AND deleted_at IS NULL
       AND (creation_status IS NULL OR creation_status != 'generating')`,
    [offerId]
  )

  const usedTypes = new Set<CanonicalCreativeType>()
  for (const creative of usedCreatives) {
    const creativeType = deriveCanonicalCreativeType({
      creativeType: creative.creative_type,
      keywordBucket: creative.keyword_bucket,
      headlines: creative.headlines,
      descriptions: creative.descriptions,
      keywords: creative.keywords,
      theme: creative.theme,
      bucketIntent: creative.bucket_intent,
    })
    if (creativeType) {
      usedTypes.add(creativeType)
    }
  }

  const allTypes: BucketType[] = ['A', 'B', 'D']
  return allTypes.filter((bucket) => {
    const creativeType = getCreativeTypeForBucketSlot(bucket as 'A' | 'B' | 'D')
    return !usedTypes.has(creativeType)
  })
}

/**
 * 获取已使用的桶
 *
 * @param offerId - Offer ID
 * @returns 已使用桶列表
 */
export async function getUsedBuckets(offerId: number): Promise<BucketType[]> {
  const db = await getDatabase()

  // 🔧 修复(2025-01-02): 只查询未删除的创意，排除软删除的创意
  const usedCreatives = await db.query<{
    creative_type: string | null
    keyword_bucket: string | null
    headlines: string | null
    descriptions: string | null
    keywords: string | null
    theme: string | null
    bucket_intent: string | null
  }>(
    `SELECT creative_type, keyword_bucket, headlines, descriptions, keywords, theme, bucket_intent
     FROM ad_creatives
     WHERE offer_id = ? AND deleted_at IS NULL`,
    [offerId]
  )

  const usedBuckets = new Set<BucketType>()
  for (const creative of usedCreatives) {
    const creativeType = deriveCanonicalCreativeType({
      creativeType: creative.creative_type,
      keywordBucket: creative.keyword_bucket,
      headlines: creative.headlines,
      descriptions: creative.descriptions,
      keywords: creative.keywords,
      theme: creative.theme,
      bucketIntent: creative.bucket_intent,
    })
    const bucketSlot = mapCreativeTypeToBucketSlot(creativeType)
    if (bucketSlot) {
      usedBuckets.add(bucketSlot)
    }
  }

  return Array.from(usedBuckets)
}

/**
 * 检查 Offer 创意数量是否已达上限
 *
 * @param offerId - Offer ID
 * @returns 是否已满
 */
export async function isCreativeLimitReached(offerId: number): Promise<boolean> {
  const db = await getDatabase()
  // ✅ KISS优化：最多3个创意类型（A / B(含C) / D(含S)）
  // 兼容历史数据：即使数据库中存在>3条旧创意，也不应阻塞新流程的类型判断
  const usedCreatives = await db.query<{
    creative_type: string | null
    keyword_bucket: string | null
    headlines: string | null
    descriptions: string | null
    keywords: string | null
    theme: string | null
    bucket_intent: string | null
  }>(
    `SELECT creative_type, keyword_bucket, headlines, descriptions, keywords, theme, bucket_intent
     FROM ad_creatives
     WHERE offer_id = ? AND deleted_at IS NULL`,
    [offerId]
  )

  const usedTypes = new Set<CanonicalCreativeType>()
  for (const creative of usedCreatives) {
    const creativeType = deriveCanonicalCreativeType({
      creativeType: creative.creative_type,
      keywordBucket: creative.keyword_bucket,
      headlines: creative.headlines,
      descriptions: creative.descriptions,
      keywords: creative.keywords,
      theme: creative.theme,
      bucketIntent: creative.bucket_intent,
    })
    if (creativeType) {
      usedTypes.add(creativeType)
    }
  }

  return usedTypes.size >= 3
}

/**
 * 计算关键词重叠率
 *
 * @param keywords1 - 关键词列表 1
 * @param keywords2 - 关键词列表 2
 * @returns 重叠率 (0-1)
 */
export function calculateKeywordOverlapRate(
  keywords1: string[],
  keywords2: string[]
): number {
  if (keywords1.length === 0 || keywords2.length === 0) return 0

  const set1 = new Set(keywords1.map(k => k.toLowerCase()))
  const set2 = new Set(keywords2.map(k => k.toLowerCase()))

  let overlap = 0
  for (const kw of set1) {
    if (set2.has(kw)) overlap++
  }

  const total = Math.max(set1.size, set2.size)
  return overlap / total
}

// ============================================
// 关键词数量不足处理
// ============================================

/**
 * 关键词数量不足时的处理策略
 */
export interface ClusteringStrategy {
  bucketCount: 1 | 2 | 3
  strategy: 'single' | 'dual' | 'full'
  message: string
}

/**
 * 根据关键词数量确定聚类策略
 *
 * @param keywordCount - 关键词数量
 * @returns 聚类策略
 */
export function determineClusteringStrategy(keywordCount: number): ClusteringStrategy {
  if (keywordCount < 15) {
    return {
      bucketCount: 1,
      strategy: 'single',
      message: '关键词太少 (<15)，只生成 1 个创意'
    }
  } else if (keywordCount < 30) {
    return {
      bucketCount: 2,
      strategy: 'dual',
      message: '关键词较少 (15-29)，生成 2 个创意'
    }
  } else {
    return {
      bucketCount: 3,
      strategy: 'full',
      message: '关键词充足 (>=30)，生成 3 个创意'
    }
  }
}

// ============================================
// 🔥 KISS 优化：统一关键词检索 API
// 替代 5 个重叠函数，简化开发者体验
// ============================================

/**
 * 统一的关键词检索 API
 *
 * 简化了以下 5 个重叠函数：
 * 1. getKeywordPoolByOfferId()
 * 2. getOrCreateKeywordPool()
 * 3. getMultiRoundIntentAwareKeywords()
 * 4. getUnifiedKeywordData()
 * 5. getUnifiedKeywordDataWithMultiRounds()
 *
 * 使用参数化选项替代多个函数，遵循 KISS 原则
 *
 * 注意：此函数仅负责检索。如需创建关键词池，请使用 getOrCreateKeywordPool()
 */
export interface GetKeywordsOptions {
  /** 要检索的桶：A/B/C/D/S（兼容旧参数，C→B，S→D）或 ALL（全部） */
  bucket?: 'A' | 'B' | 'C' | 'D' | 'S' | 'ALL'

  /** 意图过滤：仅在 bucket=ALL 时作为兼容收窄条件（支持 canonical creativeType 别名） */
  intent?: 'brand' | 'scenario' | 'feature' | 'demand' | CanonicalCreativeType

  /** canonical 创意类型过滤（兼容旧 key），优先级高于 intent */
  creativeType?: CanonicalCreativeType | 'brand_focus' | 'model_focus' | 'brand_product'

  /** 最小搜索量阈值 */
  minSearchVolume?: number

  /** 最大关键词数量 */
  maxKeywords?: number
}

/**
 * 统一关键词检索结果
 */
export interface GetKeywordsResult {
  /** 关键词列表 */
  keywords: PoolKeywordData[]

  /** 桶信息（如果适用） */
  buckets?: {
    A?: { intent: string; keywords: PoolKeywordData[] }
    B?: { intent: string; keywords: PoolKeywordData[] }
    C?: { intent: string; keywords: PoolKeywordData[] }
    D?: { intent: string; keywords: PoolKeywordData[] }
  }

  /** 统计信息 */
  stats: {
    totalCount: number
    bucketACount?: number
    bucketBCount?: number
    bucketCCount?: number
    bucketDCount?: number
    searchVolumeRange?: { min: number; max: number }
  }

  /** 元数据 */
  meta: {
    offerId: number
    createdAt?: string
    updatedAt?: string
    hasMultipleRounds?: boolean
  }
}

type CanonicalGetKeywordsBucket = 'A' | 'B' | 'D' | 'ALL'

function resolveCanonicalGetKeywordsBucket(
  bucket: GetKeywordsOptions['bucket'],
  intent?: GetKeywordsOptions['intent'],
  creativeType?: GetKeywordsOptions['creativeType']
): CanonicalGetKeywordsBucket {
  if (bucket && bucket !== 'ALL') {
    const normalizedBucket = normalizeCreativeBucketSlot(bucket)
    if (normalizedBucket) {
      return normalizedBucket
    }
  }

  const canonicalCreativeType = normalizeCanonicalCreativeType(creativeType)
  const creativeTypeBucket = mapCreativeTypeToBucketSlot(canonicalCreativeType)
  if (creativeTypeBucket) {
    return creativeTypeBucket
  }

  if (intent === 'brand' || intent === 'brand_intent') return 'A'
  if (intent === 'scenario' || intent === 'feature' || intent === 'model_intent') return 'B'
  if (intent === 'demand' || intent === 'product_intent') return 'D'
  return 'ALL'
}

function buildCanonicalKeywordView(keywordPool: OfferKeywordPool) {
  const bucketA = getBucketInfo(keywordPool, 'A')
  const bucketB = getBucketInfo(keywordPool, 'B')
  const bucketD = getBucketInfo(keywordPool, 'D')

  return {
    A: bucketA,
    B: bucketB,
    C: bucketB,
    D: bucketD,
    ALL: mergeKeywordDataLists([
      bucketA.keywords,
      bucketB.keywords,
      bucketD.keywords,
    ]),
  }
}

function buildPureBrandSetFromPoolKeywords(keywords: PoolKeywordData[]): Set<string> {
  return new Set(
    keywords
      .map((item) => normalizeGoogleAdsKeyword(item.keyword))
      .filter((item): item is string => Boolean(item))
  )
}

function isPoolKeywordPureBrand(
  item: PoolKeywordData,
  pureBrandSet: Set<string>
): boolean {
  if (item.isPureBrand) return true
  const normalized = normalizeGoogleAdsKeyword(item.keyword)
  return Boolean(normalized && pureBrandSet.has(normalized))
}

function ensurePureBrandFallbackWithinLimit(params: {
  keywords: PoolKeywordData[]
  brandKeywords: PoolKeywordData[]
  pureBrandSet: Set<string>
  maxKeywords: number
}): PoolKeywordData[] {
  const limit = Math.max(0, params.maxKeywords)
  if (limit === 0) return []
  if (params.pureBrandSet.size === 0) return params.keywords.slice(0, limit)

  const nonPure = params.keywords.filter((item) => !isPoolKeywordPureBrand(item, params.pureBrandSet))
  const existingFallback = params.keywords.find((item) => isPoolKeywordPureBrand(item, params.pureBrandSet))

  if (existingFallback) {
    const kept = nonPure.slice(0, Math.max(0, limit - 1))
    return [...kept, existingFallback]
  }

  const fallbackBrand = params.brandKeywords.find((item) => {
    const normalized = normalizeGoogleAdsKeyword(item.keyword)
    return Boolean(normalized && params.pureBrandSet.has(normalized))
  })
  if (!fallbackBrand) {
    return params.keywords.slice(0, limit)
  }

  const kept = params.keywords.slice(0, Math.max(0, limit - 1))
  return [
    ...kept,
    {
      ...fallbackBrand,
      isPureBrand: true,
      matchType: fallbackBrand.matchType || 'EXACT',
    },
  ]
}

/**
 * 🔥 核心 API：统一关键词检索
 *
 * 示例用法：
 * ```typescript
 * // 获取所有关键词
 * const all = await getKeywords(123)
 *
 * // 只获取品牌桶
 * const brand = await getKeywords(123, { bucket: 'A' })
 *
 * // 获取过滤后的关键词
 * const filtered = await getKeywords(123, { minSearchVolume: 100, maxKeywords: 500 })
 * ```
 *
 * 注意：此函数仅负责检索。如需创建关键词池，请使用 getOrCreateKeywordPool()
 */
export async function getKeywords(
  offerId: number,
  options: GetKeywordsOptions = {}
): Promise<GetKeywordsResult> {
  const {
    bucket = 'ALL',
    intent,
    creativeType,
    minSearchVolume = 100,
    maxKeywords = 5000
  } = options

  // 1. 获取关键词池
  const keywordPool = await getKeywordPoolByOfferId(offerId)

  // 2. 如果没有，返回空结果
  if (!keywordPool) {
    return {
      keywords: [],
      stats: { totalCount: 0 },
      meta: { offerId }
    }
  }
  const pureBrandSet = buildPureBrandSetFromPoolKeywords(keywordPool.brandKeywords)

  // 3. 使用 canonical 视图选择关键词（兼容旧 bucket / intent 参数）
  const canonicalView = buildCanonicalKeywordView(keywordPool)
  const effectiveBucket = resolveCanonicalGetKeywordsBucket(bucket, intent, creativeType)
  let keywords = effectiveBucket === 'ALL'
    ? [...canonicalView.ALL]
    : [...canonicalView[effectiveBucket].keywords]
  const effectiveCreativeType = effectiveBucket === 'ALL'
    ? null
    : getCreativeTypeForBucketSlot(effectiveBucket)
  const keywordPoolLinkType = keywordPool.linkType === 'store' ? 'store' : 'product'
  const comprehensivePoolKeywords = getComprehensiveKeywordsForPool(keywordPool, keywordPoolLinkType)
  const pureBrandKeywords = getPoolPureBrandKeywords(keywordPool)

  if (effectiveBucket !== 'ALL' && effectiveCreativeType) {
    keywords = await applyOfferContextToCanonicalKeywords({
      offerId,
      keywords,
      creativeType: effectiveCreativeType,
      scopeLabel: `getKeywords:${effectiveBucket}`,
      fallbackCandidates: comprehensivePoolKeywords,
      pureBrandKeywords,
    })
  }

  // 4. 按搜索量过滤（纯品牌词豁免）
  // 🔧 修复(2025-12-26): 服务账号模式下无法获取搜索量，跳过过滤
  const hasAnyVolume = keywords.some(kw => kw.searchVolume > 0)
  const volumeUnavailable = hasSearchVolumeUnavailableFlag(keywords)
  if (hasAnyVolume && !volumeUnavailable) {
    keywords = keywords.filter(kw => {
      const normalized = normalizeGoogleAdsKeyword(kw.keyword)
      return kw.searchVolume >= minSearchVolume || (normalized && pureBrandSet.has(normalized))
    })
  } else if (hasAnyVolume && volumeUnavailable) {
    console.log('⚠️ 搜索量数据不可用（Planner 权限受限），跳过搜索量过滤')
  } else {
    console.log('⚠️ 所有关键词搜索量为0（可能是服务账号模式），跳过搜索量过滤')
  }

  if (effectiveBucket === 'ALL' && keywordPool.brandKeywords.length > 0) {
    keywords = prioritizeBrandKeywordsFirst(
      keywords,
      keywordPool.brandKeywords.map(kw => kw.keyword)
    )
  }

  // 5. 限制数量
  keywords = keywords.slice(0, maxKeywords)
  if ((effectiveBucket === 'A' || effectiveBucket === 'D') && pureBrandSet.size > 0) {
    keywords = ensurePureBrandFallbackWithinLimit({
      keywords,
      brandKeywords: keywordPool.brandKeywords,
      pureBrandSet,
      maxKeywords,
    })
  }

  // 6. 构建返回结果
  const result: GetKeywordsResult = {
    keywords,
    stats: {
      totalCount: keywords.length,
      bucketACount: canonicalView.A.keywords.length,
      bucketBCount: canonicalView.B.keywords.length,
      bucketCCount: canonicalView.C.keywords.length,
      bucketDCount: canonicalView.D.keywords.length,
      searchVolumeRange: keywords.length > 0
        ? {
            min: Math.min(...keywords.map(k => k.searchVolume)),
            max: Math.max(...keywords.map(k => k.searchVolume))
          }
        : undefined
    },
    meta: {
      offerId,
      createdAt: keywordPool.createdAt,
      updatedAt: keywordPool.updatedAt
    }
  }

  // 7. 如果需要，返回桶信息
  if (effectiveBucket === 'ALL') {
    result.buckets = {
      A: { intent: canonicalView.A.intent, keywords: canonicalView.A.keywords },
      B: { intent: canonicalView.B.intent, keywords: canonicalView.B.keywords },
      C: { intent: canonicalView.C.intent, keywords: canonicalView.C.keywords },
      D: { intent: canonicalView.D.intent, keywords: canonicalView.D.keywords }
    }
  }

  console.log(`[getKeywords] 完成: offerId=${offerId}, bucket=${bucket}, effectiveBucket=${effectiveBucket}, 返回${keywords.length}个关键词`)
  return result
}

/**
 * 🆕 v4.16: 根据链接类型和创意桶获取关键词
 *
 * @param offerId - Offer ID
 * @param linkType - 链接类型 ('product' | 'store')
 * @param bucket - 创意桶类型 ('A' | 'B' | 'C' | 'D' | 'S')
 * @returns 关键词数组和意图描述
 */
export async function getKeywordsByLinkTypeAndBucket(
  offerId: number,
  linkType: 'product' | 'store',
  bucket: BucketType
): Promise<{ keywords: PoolKeywordData[]; intent: string; intentEn: string }> {
  const keywordPool = await getKeywordPoolByOfferId(offerId)

  if (!keywordPool) {
    console.warn(`[getKeywordsByLinkTypeAndBucket] 关键词池不存在: offerId=${offerId}`)
    return { keywords: [], intent: '', intentEn: '' }
  }

  const effectivePool = keywordPool.linkType === linkType
    ? keywordPool
    : { ...keywordPool, linkType }
  const bucketInfo = getBucketInfo(effectivePool as OfferKeywordPool, bucket)
  const effectiveBucket = mapBucketToKissType(bucket)
  const effectiveCreativeType = getCreativeTypeForBucketSlot(effectiveBucket)
  const comprehensivePoolKeywords = getComprehensiveKeywordsForPool(
    effectivePool as OfferKeywordPool,
    linkType
  )
  const pureBrandKeywords = getPoolPureBrandKeywords(effectivePool as OfferKeywordPool)

  if (linkType !== 'product' || !effectiveCreativeType) {
    return bucketInfo
  }

  const filteredKeywords = await applyOfferContextToCanonicalKeywords({
    offerId,
    keywords: bucketInfo.keywords,
    creativeType: effectiveCreativeType,
    scopeLabel: `getKeywordsByLinkTypeAndBucket:${bucket}`,
    fallbackCandidates: comprehensivePoolKeywords,
    pureBrandKeywords,
  })

  return {
    ...bucketInfo,
    keywords: filteredKeywords,
  }
}

export const __testOnly = {
  extractStoreProductNamesFromLinks,
  buildVerifiedSourceKeywordData,
  resolveOfferPageType,
}
