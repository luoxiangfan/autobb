/**
 * AI keyword intent clustering + deterministic fallback.
 */
import { generateContent } from '../gemini'
import { repairJsonText } from '../ai-json'
import { loadPrompt } from '../prompt-loader'
import { recordTokenUsage, estimateTokenCost } from '../ai-token-tracker'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { classifyKeywordIntent } from '../keyword-intent'
import {
  getKeywordSourcePriorityScore as getUnifiedKeywordSourcePriorityScore,
  getKeywordSourcePriorityScoreFromInput,
} from '../creative-keyword-source-priority'
import { isPureBrandKeyword as isPureBrandKeywordInternal } from '../keyword-quality-filter'
import { resolveOfferLinkType } from '../offer-link-type'
import type { Offer } from '../offers'
import {
  DEFAULT_PRODUCT_CLUSTER_BUCKETS,
  DEFAULT_STORE_CLUSTER_BUCKETS,
  type KeywordBuckets,
  type KeywordPoolProgressReporter,
  type PoolKeywordData,
  type StoreKeywordBuckets,
} from './types'

type GeminiGenerateParams = Parameters<typeof generateContent>[0]
type GeminiGenerateResult = Awaited<ReturnType<typeof generateContent>>

const GLOBAL_CORE_PROMO_PRICE_PATTERNS =
  /\b(discount|sale|deal|coupon|promo|code|offer|clearance|price|cost|cheap|affordable|budget)\b/i
const GLOBAL_CORE_MODEL_PATTERNS = /\b(s\d+|q\d+|s7|s8|q5|q7|max|ultra|pro(?!\s*store))\b/i
const GLOBAL_CORE_REVIEW_PATTERNS = /\b(review|rating|testimonial|feedback|comment|opinion)\b/i
const GLOBAL_CORE_TRUST_PATTERNS =
  /\b(review|reviews|rating|ratings|testimonial|testimonials|feedback|support|customer\s*service|warranty|guarantee|refund|return|secure|security|privacy|trusted|trust)\b/i
const GLOBAL_CORE_TRANSACTIONAL_PATTERNS =
  /\b(buy|best|price|sale|deal|discount|coupon|promo|offer|shop|official|professional)\b/i

function normalizeGlobalCoreToken(token: string): string {
  const raw = String(token || '')
    .toLowerCase()
    .trim()
  if (!raw) return ''
  if (raw.endsWith('ies') && raw.length > 4) return `${raw.slice(0, -3)}y`
  if (raw.endsWith('es') && raw.length > 4) return raw.slice(0, -2)
  if (raw.endsWith('s') && raw.length > 3 && !raw.endsWith('ss')) return raw.slice(0, -1)
  return raw
}

function tokenizeGlobalCore(text: string): string[] {
  const normalized = normalizeGoogleAdsKeyword(text)
  if (!normalized) return []
  return normalized.split(/\s+/).map(normalizeGlobalCoreToken).filter(Boolean)
}

function isHighIntentGlobalCoreKeyword(keyword: string): boolean {
  if (!keyword) return false
  if (
    GLOBAL_CORE_TRANSACTIONAL_PATTERNS.test(keyword) ||
    GLOBAL_CORE_PROMO_PRICE_PATTERNS.test(keyword) ||
    GLOBAL_CORE_MODEL_PATTERNS.test(keyword) ||
    GLOBAL_CORE_TRUST_PATTERNS.test(keyword) ||
    GLOBAL_CORE_REVIEW_PATTERNS.test(keyword)
  ) {
    return true
  }
  return tokenizeGlobalCore(keyword).length >= 2
}

const KEYWORD_CLUSTERING_MAX_OUTPUT_TOKENS = 16384
const KEYWORD_CLUSTERING_TIMEOUT_MS = 90000
export const KEYWORD_CLUSTERING_INPUT_LIMIT = 500
const KEYWORD_CLUSTERING_TRUNCATION_MARGIN = 32
const KEYWORD_CLUSTERING_MAX_SPLIT_DEPTH = 3
const KEYWORD_CLUSTERING_MIN_SPLIT_KEYWORDS = 8
export const MIN_NON_BRAND_KEYWORDS_PER_PRODUCT_BUCKET = 4
export const MIN_NON_BRAND_KEYWORDS_PER_STORE_BUCKET = 3
export const SEED_MAX_WORD_COUNT = 8
export const SEED_INFO_QUERY_PATTERNS = [
  'meaning',
  'definition',
  'what is',
  'wiki',
  'wikipedia',
  'how to',
  'tutorial',
  'guide',
  'manual',
  'instructions',
  'series',
  'episode',
  'netflix',
  'streaming',
  'download',
  'software',
  'app',
  'apk',
  'pdf',
  'ebook',
  'gif',
  'meme',
  'emoji',
  'sticker',
  'drawing',
  'image',
  'images',
  'logo',
  'png',
  'jpg',
  'jpeg',
  'svg',
  'icon',
  'clipart',
  'wallpaper',
  'size chart',
  'size guide',
  'sizing',
]

function isGeminiTimeoutError(error: unknown): boolean {
  if (!error) return false
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: string }).message)
      : String(error)
  const code =
    typeof error === 'object' && error !== null && 'code' in error
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

  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: string }).code || '').toUpperCase()
      : ''
  if (['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'ECONNREFUSED'].includes(code)) {
    return true
  }

  const message =
    typeof error === 'object' && error !== null && 'message' in error
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

  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: string }).code || '').toUpperCase()
      : ''
  if (
    [
      'ECONNABORTED',
      'ETIMEDOUT',
      'ECONNRESET',
      'EPIPE',
      'ECONNREFUSED',
      'GEMINI_DAILY_QUOTA_EXHAUSTED',
    ].includes(code)
  ) {
    return true
  }

  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: string }).message || '')
      : String(error)
  const lower = message.toLowerCase()
  return (
    lower.includes('gemini api调用失败') ||
    lower.includes('resource exhausted') ||
    lower.includes('quota') ||
    lower.includes('forbidden') ||
    lower.includes('payment required') ||
    lower.includes('cloudflare') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('gateway timeout') ||
    lower.includes('service unavailable') ||
    lower.includes('timeout') ||
    lower.includes('overloaded') ||
    lower.includes('high demand')
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
        .filter((entry) => entry.key !== target.key && entry.list.length > 1)
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
  const allowed = new Set(normalized.map((item) => item.toLowerCase()))

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
  const message =
    typeof params.error === 'object' && params.error !== null && 'message' in params.error
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
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: string }).message)
        : String(error)
    console.warn(
      `⚠️ keyword_clustering 超时 (${KEYWORD_CLUSTERING_TIMEOUT_MS}ms)，按用户当前模型重试...`
    )
    console.warn(`   错误: ${message}`)
    return await generateContent(
      {
        ...baseParams,
        enableAutoModelSelection: false,
      },
      userId
    )
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

export function extractFirstJsonObject(text: string): string | null {
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
  return outputTokens >= KEYWORD_CLUSTERING_MAX_OUTPUT_TOKENS - KEYWORD_CLUSTERING_TRUNCATION_MARGIN
}

function splitKeywordsForRetry(keywords: string[]): [string[], string[]] {
  const mid = Math.ceil(keywords.length / 2)
  return [keywords.slice(0, mid), keywords.slice(mid)]
}

type OfferPageTypeSource = Pick<Offer, 'page_type' | 'scraped_data'>

export function resolveOfferPageType(offer: OfferPageTypeSource): 'store' | 'product' {
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
    /\bclearance\b/i,
  ]
  return patterns.some((pattern) => pattern.test(normalized))
}

export function getKeywordSourcePriority(source: string | undefined): number {
  // 该函数在本文件排序中使用“升序比较（值越小越靠前）”。
  // 统一优先级配置使用“分值越大越可信”，此处做投影以保持既有排序语义不变。
  const sourceScore = getUnifiedKeywordSourcePriorityScore(source)
  if (!Number.isFinite(sourceScore) || sourceScore <= 0) return 999
  return 1000 - sourceScore
}

export function getKeywordSourcePriorityForPoolItem(
  item: Pick<PoolKeywordData, 'source'> & {
    sourceType?: string
  }
): number {
  const sourceScore = getKeywordSourcePriorityScoreFromInput({
    source: item.source,
    sourceType: item.sourceType,
  })
  if (!Number.isFinite(sourceScore) || sourceScore <= 0) return 999
  return 1000 - sourceScore
}

export function normalizeMatchTypePriority(matchType: string | undefined): number {
  const normalized = String(matchType || '')
    .trim()
    .toUpperCase()
  if (normalized === 'EXACT') return 3
  if (normalized === 'PHRASE') return 2
  if (normalized === 'BROAD') return 1
  return 0
}

export function prioritizeKeywordsForClustering(keywords: PoolKeywordData[]): PoolKeywordData[] {
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

export function prioritizeBucketKeywords(keywords: PoolKeywordData[]): PoolKeywordData[] {
  return [...keywords].sort((a, b) => {
    const sourceRank = getKeywordSourcePriority(a.source) - getKeywordSourcePriority(b.source)
    if (sourceRank !== 0) return sourceRank

    const relevanceScoreDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0)
    if (relevanceScoreDiff !== 0) return relevanceScoreDiff

    const genericRank =
      Number(isGenericRetailKeyword(a.keyword)) - Number(isGenericRetailKeyword(b.keyword))
    if (genericRank !== 0) return genericRank

    const volumeDiff = (b.searchVolume || 0) - (a.searchVolume || 0)
    if (volumeDiff !== 0) return volumeDiff

    return b.keyword.length - a.keyword.length
  })
}

export function ensureMinimumBucketKeywords(params: {
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

export function hasSearchVolumeUnavailableFlag(
  keywords: Array<{ volumeUnavailableReason?: unknown }>
): boolean {
  return keywords.some((kw) => isSearchVolumeUnavailableReason(kw?.volumeUnavailableReason))
}

export function hasCommercialIntentForProductRelaxedRetention(
  keyword: string,
  language: string
): boolean {
  if (!keyword) return false
  const intent = classifyKeywordIntent(keyword, { language })
  if (intent.hardNegative) return false
  if (intent.intent === 'TRANSACTIONAL' || intent.intent === 'COMMERCIAL') return true
  return isHighIntentGlobalCoreKeyword(keyword)
}

export function prioritizeBrandKeywordsFirst(
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
  console.log(
    `📦 处理批次 ${batchIndex}/${totalBatches}: ${batchKeywords.length} 个关键词 (${pageType}链接)`
  )

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
          keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } },
        },
        required: ['intent', 'intentEn', 'description', 'keywords'],
      },
      bucketB: {
        type: 'OBJECT' as const,
        properties: {
          intent: { type: 'STRING' as const },
          intentEn: { type: 'STRING' as const },
          description: { type: 'STRING' as const },
          keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } },
        },
        required: ['intent', 'intentEn', 'description', 'keywords'],
      },
      bucketC: {
        type: 'OBJECT' as const,
        properties: {
          intent: { type: 'STRING' as const },
          intentEn: { type: 'STRING' as const },
          description: { type: 'STRING' as const },
          keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } },
        },
        required: ['intent', 'intentEn', 'description', 'keywords'],
      },
      bucketD: {
        type: 'OBJECT' as const,
        properties: {
          intent: { type: 'STRING' as const },
          intentEn: { type: 'STRING' as const },
          description: { type: 'STRING' as const },
          keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } },
        },
        required: ['intent', 'intentEn', 'description', 'keywords'],
      },
      // 🆕 v4.16: 店铺链接添加 bucketS
      ...(isStore
        ? {
            bucketS: {
              type: 'OBJECT' as const,
              properties: {
                intent: { type: 'STRING' as const },
                intentEn: { type: 'STRING' as const },
                description: { type: 'STRING' as const },
                keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } },
              },
              required: ['intent', 'intentEn', 'description', 'keywords'],
            },
          }
        : {}),
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
          balanceScore: { type: 'NUMBER' as const },
        },
        required: isStore
          ? [
              'totalKeywords',
              'bucketACount',
              'bucketBCount',
              'bucketCCount',
              'bucketDCount',
              'bucketSCount',
              'balanceScore',
            ]
          : [
              'totalKeywords',
              'bucketACount',
              'bucketBCount',
              'bucketCCount',
              'bucketDCount',
              'balanceScore',
            ],
      },
    },
    required: isStore
      ? ['bucketA', 'bucketB', 'bucketC', 'bucketD', 'bucketS', 'statistics']
      : ['bucketA', 'bucketB', 'bucketC', 'bucketD', 'statistics'],
  }

  // 4. 调用 AI（使用智能模型选择，60-90s）
  const aiResponse = await runKeywordClustering(
    {
      operationType: 'keyword_clustering',
      prompt,
      temperature: 0.3,
      responseSchema,
      responseMimeType: 'application/json',
    },
    userId
  )

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
      apiType: aiResponse.apiType,
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
      batchKeywords.length >= KEYWORD_CLUSTERING_MIN_SPLIT_KEYWORDS * 2

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
    if (
      !batchResult.bucketA ||
      !batchResult.bucketB ||
      !batchResult.bucketC ||
      !batchResult.bucketD ||
      !batchResult.bucketS
    ) {
      console.error('❌ AI返回数据结构不完整(店铺):', batchResult)
      throw new Error('AI返回的数据结构不完整：缺少bucketA/B/C/D/S')
    }

    if (
      !Array.isArray(batchResult.bucketA.keywords) ||
      !Array.isArray(batchResult.bucketB.keywords) ||
      !Array.isArray(batchResult.bucketC.keywords) ||
      !Array.isArray(batchResult.bucketD.keywords) ||
      !Array.isArray(batchResult.bucketS.keywords)
    ) {
      console.error('❌ AI返回的keywords不是数组(店铺):', batchResult)
      throw new Error('AI返回的keywords不是数组')
    }

    console.log(
      `✅ 批次 ${batchIndex} 完成 (店铺5桶): A=${batchResult.bucketA.keywords.length}, B=${batchResult.bucketB.keywords.length}, C=${batchResult.bucketC.keywords.length}, D=${batchResult.bucketD.keywords.length}, S=${batchResult.bucketS.keywords.length}`
    )
  } else {
    // 产品链接：验证4个桶
    if (
      !batchResult.bucketA ||
      !batchResult.bucketB ||
      !batchResult.bucketC ||
      !batchResult.bucketD
    ) {
      console.error('❌ AI返回数据结构不完整(产品):', batchResult)
      throw new Error('AI返回的数据结构不完整：缺少bucketA/B/C/D')
    }

    if (
      !Array.isArray(batchResult.bucketA.keywords) ||
      !Array.isArray(batchResult.bucketB.keywords) ||
      !Array.isArray(batchResult.bucketC.keywords) ||
      !Array.isArray(batchResult.bucketD.keywords)
    ) {
      console.error('❌ AI返回的keywords不是数组(产品):', batchResult)
      throw new Error('AI返回的keywords不是数组')
    }

    console.log(
      `✅ 批次 ${batchIndex} 完成 (产品4桶): A=${batchResult.bucketA.keywords.length}, B=${batchResult.bucketB.keywords.length}, C=${batchResult.bucketC.keywords.length}, D=${batchResult.bucketD.keywords.length}`
    )
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
    bucketS?: { intent: string; intentEn: string; description: string; keywords: string[] } // 🔧 可选：店铺链接专用
    statistics: {
      totalKeywords: number
      bucketACount: number
      bucketBCount: number
      bucketCCount: number
      bucketDCount: number
      bucketSCount?: number
      balanceScore: number
    }
  }>
): KeywordBuckets {
  // 合并所有关键词（去重）
  const allBucketAKeywords = Array.from(new Set(batchResults.flatMap((r) => r.bucketA.keywords)))
  const allBucketBKeywords = Array.from(new Set(batchResults.flatMap((r) => r.bucketB.keywords)))
  const allBucketCKeywords = Array.from(new Set(batchResults.flatMap((r) => r.bucketC.keywords)))
  const allBucketDKeywords = Array.from(new Set(batchResults.flatMap((r) => r.bucketD.keywords)))
  const allBucketSKeywords = Array.from(
    new Set(batchResults.flatMap((r) => r.bucketS?.keywords || []))
  ) // 🔧 处理可选的bucketS

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
  const bucketSIntent = batchResults.find((r) => r.bucketS)?.bucketS

  // 计算统计数据
  const totalKeywords =
    allBucketAKeywords.length +
    allBucketBKeywords.length +
    allBucketCKeywords.length +
    allBucketDKeywords.length +
    allBucketSKeywords.length
  const averageBalanceScore =
    batchResults.reduce((sum, r) => sum + r.statistics.balanceScore, 0) / batchResults.length

  console.log(`🔄 合并 ${batchResults.length} 个批次结果:`)
  console.log(`   桶A: ${allBucketAKeywords.length} 个关键词`)
  console.log(`   桶B: ${allBucketBKeywords.length} 个关键词`)
  console.log(`   桶C: ${allBucketCKeywords.length} 个关键词`)
  console.log(`   桶D: ${allBucketDKeywords.length} 个关键词`)
  if (allBucketSKeywords.length > 0) {
    console.log(`   桶S: ${allBucketSKeywords.length} 个关键词`) // 🔧 店铺链接显示bucketS
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
      balanceScore: averageBalanceScore,
    },
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
  const BATCH_SIZE = 30 // 每批30个关键词（降低超时风险）
  const needsBatching = allKeywordsForClustering.length > 40 // 从60改为40
  const batchCount = needsBatching ? Math.ceil(allKeywordsForClustering.length / BATCH_SIZE) : 1

  if (!needsBatching) {
    // 小批量：直接处理（原逻辑）
    console.log(`📝 小批量模式：直接处理 ${allKeywordsForClustering.length} 个关键词`)
    await progress?.({
      phase: 'cluster',
      message: `语义聚类：小批量处理(${allKeywordsForClustering.length})`,
    })
    try {
      const directBuckets = await clusterKeywordsDirectly(
        allKeywordsForClustering,
        brandName,
        category,
        userId,
        pageType
      )
      filterBucketsToAllowedKeywords(
        directBuckets,
        new Set(allKeywordsForClustering.map((k) => k.toLowerCase()))
      )
      return directBuckets
    } catch (error: any) {
      if (shouldUseDeterministicClusteringFallback(error)) {
        const fallbackBuckets = buildDeterministicClusteringFallback({
          keywords: allKeywordsForClustering,
          pageType,
          error,
          scope: 'direct',
        })
        filterBucketsToAllowedKeywords(
          fallbackBuckets,
          new Set(allKeywordsForClustering.map((k) => k.toLowerCase()))
        )
        return fallbackBuckets
      }
      throw error
    }
  }

  // 大批量：分批处理（有限并发）
  const MAX_CONCURRENT_BATCHES = 3
  console.log(
    `🚀 大批量模式：将 ${allKeywordsForClustering.length} 个关键词分成 ${batchCount} 个批次并发处理 (最大并发 ${MAX_CONCURRENT_BATCHES})`
  )
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
  const maxRetries = 3 // 从2改为3（4次尝试）
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
            message: `语义聚类：开始批次 ${current + 1}/${batchCount} (${batches[current].length}个)`,
          })
          batchResults[current] = await clusterBatchKeywords(
            batches[current],
            brandName,
            category,
            userId,
            current + 1,
            batchCount,
            pageType
          ).catch((error) => {
            console.error(`❌ 批次 ${current + 1} 失败:`, error.message)
            throw error
          })
          completed += 1
          await progress?.({
            phase: 'cluster',
            current: completed,
            total: batchCount,
            message: `语义聚类：完成批次 ${current + 1}/${batchCount}`,
          })
        }
      }

      const workerCount = retryCount === 0 ? Math.min(MAX_CONCURRENT_BATCHES, batches.length) : 1
      if (retryCount > 0 && workerCount === 1) {
        console.warn(`⚠️ 分批聚类重试阶段降级为串行执行（第 ${retryCount + 1} 轮）`)
      }
      const workers = Array.from({ length: workerCount }, () => worker())
      await Promise.all(workers)

      // 3. 合并结果
      await progress?.({ phase: 'cluster', message: '语义聚类：合并批次结果' })
      const mergedBuckets = mergeBatchResults(batchResults)
      filterBucketsToAllowedKeywords(
        mergedBuckets,
        new Set(allKeywordsForClustering.map((k) => k.toLowerCase()))
      )

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
        const jitter = Math.random() * 2000 // 0-2秒随机抖动
        const delay = Math.min(baseDelayMs + jitter, 60000) // 最多60秒
        const errorInfo = status ? `HTTP ${status}` : String(error?.message || '').substring(0, 80)
        console.warn(
          `⚠️ 分批聚类第 ${retryCount + 1} 次失败 (${errorInfo})，${(delay / 1000).toFixed(1)}s 后重试...`
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      if (shouldUseDeterministicClusteringFallback(error)) {
        const fallbackBuckets = buildDeterministicClusteringFallback({
          keywords: allKeywordsForClustering,
          pageType,
          error,
          scope: 'batch',
        })
        filterBucketsToAllowedKeywords(
          fallbackBuckets,
          new Set(allKeywordsForClustering.map((k) => k.toLowerCase()))
        )
        return fallbackBuckets
      }

      console.error('❌ 分批 AI 语义聚类失败:', error.message)
      throw new Error(`关键词AI语义分类失败（分批处理）: ${error.message}`)
    }
  }

  throw new Error(
    `关键词AI语义分类失败（重试${maxRetries}次均失败）: ${lastError?.message || '未知错误'}`
  )
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
  const maxRetries = 3 // 🔥 从2改为3（4次尝试）
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
              keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } },
            },
            required: ['intent', 'intentEn', 'description', 'keywords'],
          },
          bucketB: {
            type: 'OBJECT' as const,
            properties: {
              intent: { type: 'STRING' as const },
              intentEn: { type: 'STRING' as const },
              description: { type: 'STRING' as const },
              keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } },
            },
            required: ['intent', 'intentEn', 'description', 'keywords'],
          },
          bucketC: {
            type: 'OBJECT' as const,
            properties: {
              intent: { type: 'STRING' as const },
              intentEn: { type: 'STRING' as const },
              description: { type: 'STRING' as const },
              keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } },
            },
            required: ['intent', 'intentEn', 'description', 'keywords'],
          },
          bucketD: {
            type: 'OBJECT' as const,
            properties: {
              intent: { type: 'STRING' as const },
              intentEn: { type: 'STRING' as const },
              description: { type: 'STRING' as const },
              keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } },
            },
            required: ['intent', 'intentEn', 'description', 'keywords'],
          },
          // 🆕 v4.16: 店铺链接添加 bucketS
          ...(isStore
            ? {
                bucketS: {
                  type: 'OBJECT' as const,
                  properties: {
                    intent: { type: 'STRING' as const },
                    intentEn: { type: 'STRING' as const },
                    description: { type: 'STRING' as const },
                    keywords: { type: 'ARRAY' as const, items: { type: 'STRING' as const } },
                  },
                  required: ['intent', 'intentEn', 'description', 'keywords'],
                },
              }
            : {}),
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
              balanceScore: { type: 'NUMBER' as const },
            },
            required: isStore
              ? [
                  'totalKeywords',
                  'bucketACount',
                  'bucketBCount',
                  'bucketCCount',
                  'bucketDCount',
                  'bucketSCount',
                  'balanceScore',
                ]
              : [
                  'totalKeywords',
                  'bucketACount',
                  'bucketBCount',
                  'bucketCCount',
                  'bucketDCount',
                  'balanceScore',
                ],
          },
        },
        required: isStore
          ? ['bucketA', 'bucketB', 'bucketC', 'bucketD', 'bucketS', 'statistics']
          : ['bucketA', 'bucketB', 'bucketC', 'bucketD', 'statistics'],
      }

      // 4. 调用 AI（使用智能模型选择）
      const aiResponse = await runKeywordClustering(
        {
          operationType: 'keyword_clustering',
          prompt,
          temperature: 0.3,
          responseSchema,
          responseMimeType: 'application/json',
        },
        userId
      )

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
          apiType: aiResponse.apiType,
        })
      }

      let buckets: KeywordBuckets | StoreKeywordBuckets
      try {
        buckets = parseKeywordClusteringJson(aiResponse.text)
      } catch (parseError) {
        const likelyTruncated = isLikelyKeywordClusteringTruncated(aiResponse)
        const canSplit =
          likelyTruncated && keywords.length >= KEYWORD_CLUSTERING_MIN_SPLIT_KEYWORDS * 2

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

          buckets = mergeBatchResults([leftResult, rightResult]) as
            | KeywordBuckets
            | StoreKeywordBuckets
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
        if (
          !storeBuckets.bucketA ||
          !storeBuckets.bucketB ||
          !storeBuckets.bucketC ||
          !storeBuckets.bucketD ||
          !storeBuckets.bucketS
        ) {
          console.error('❌ AI返回数据结构不完整(店铺):', buckets)
          throw new Error('AI返回的数据结构不完整：缺少bucketA/B/C/D/S')
        }

        if (
          !Array.isArray(storeBuckets.bucketA.keywords) ||
          !Array.isArray(storeBuckets.bucketB.keywords) ||
          !Array.isArray(storeBuckets.bucketC.keywords) ||
          !Array.isArray(storeBuckets.bucketD.keywords) ||
          !Array.isArray(storeBuckets.bucketS.keywords)
        ) {
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
        if (
          !productBuckets.bucketA ||
          !productBuckets.bucketB ||
          !productBuckets.bucketC ||
          !productBuckets.bucketD
        ) {
          console.error('❌ AI返回数据结构不完整(产品):', buckets)
          throw new Error('AI返回的数据结构不完整：缺少bucketA/B/C/D')
        }

        if (
          !Array.isArray(productBuckets.bucketA.keywords) ||
          !Array.isArray(productBuckets.bucketB.keywords) ||
          !Array.isArray(productBuckets.bucketC.keywords) ||
          !Array.isArray(productBuckets.bucketD.keywords)
        ) {
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
        const jitter = Math.random() * 2000 // 0-2秒随机抖动
        const delay = Math.min(baseDelayMs + jitter, 60000) // 最多60秒
        const errorInfo = status
          ? `HTTP ${status} ${status === 504 ? '(Gateway Timeout)' : ''}`
          : String(error?.message || '').substring(0, 80)
        console.warn(
          `⚠️ AI 聚类第 ${retryCount + 1} 次失败 (${errorInfo})，${(delay / 1000).toFixed(1)}s 后重试...`
        )
        console.warn(`   错误: ${error.message}`)
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      console.error('❌ AI 语义聚类失败:', error.message)
      throw new Error(`关键词AI语义分类失败: ${error.message}`)
    }
  }

  throw new Error(
    `关键词AI语义分类失败（重试${maxRetries}次均失败）: ${lastError?.message || '未知错误'}`
  )
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
    statistics: {
      totalKeywords: 0,
      bucketACount: 0,
      bucketBCount: 0,
      bucketCCount: 0,
      bucketDCount: 0,
      balanceScore: 1.0,
    },
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
    statistics: {
      totalKeywords: 0,
      bucketACount: 0,
      bucketBCount: 0,
      bucketCCount: 0,
      bucketDCount: 0,
      bucketSCount: 0,
      balanceScore: 1.0,
    },
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
    ...(buckets.bucketD?.keywords || []),
  ]

  // 检查是否有遗漏
  const missing = originalKeywords.filter(
    (kw) => !allBucketKeywords.some((bkw) => bkw.toLowerCase() === kw.toLowerCase())
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
    ...(buckets.bucketS?.keywords || []),
  ]

  // 检查是否有遗漏
  const missing = originalKeywords.filter(
    (kw) => !allBucketKeywords.some((bkw) => bkw.toLowerCase() === kw.toLowerCase())
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
    buckets.bucketS?.keywords?.length || 0,
  ]
  const nonZeroCounts = counts.filter((c) => c > 0).length
  const maxCount = Math.max(...counts)
  const minCount = Math.min(...counts.filter((c) => c > 0))

  // 计算均衡度：使用 AI 报告的 balanceScore 或手动计算
  const reportedBalanceScore = buckets.statistics?.balanceScore ?? calculateBalanceScore(counts)

  // 打印各桶分布情况，便于调试
  console.log(
    `   📊 店铺桶分布: A=${counts[0]}, B=${counts[1]}, C=${counts[2]}, D=${counts[3]}, S=${counts[4]}`
  )
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
export function calculateBalanceScore(counts: number[]): number {
  if (counts.length === 0) return 1.0
  const total = counts.reduce((a, b) => a + b, 0)
  if (total === 0) return 1.0
  const avg = total / counts.length
  const maxDiff = Math.max(...counts.map((c) => Math.abs(c - avg)))
  return Math.max(0, 1 - maxDiff / total)
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

export function recalculateStoreBucketStatistics(buckets: StoreKeywordBuckets): void {
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
    (list || []).filter((kw) => allowedKeywords.has(String(kw || '').toLowerCase()))

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

function redistributeStoreBucketsFromS(
  buckets: StoreKeywordBuckets,
  originalKeywords: string[]
): void {
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
  const productTypePattern = /\b(ai|chatbot|assistant|companion|virtual|friend|conversation)\b/i

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
  const moves: Array<{ keyword: string; from: string; to: string; reason: string }> = []

  // 定义匹配规则
  const PROMO_PRICE_PATTERNS =
    /\b(discount|sale|deal|coupon|promo|code|offer|clearance|price|cost|cheap|affordable|budget)\b/i
  const MODEL_PATTERNS = /\b(s\d+|q\d+|s7|s8|q5|q7|max|ultra|pro(?!\s*store))\b/i // 排除 "pro store"
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
    buckets.statistics.bucketSCount,
  ]
  buckets.statistics.balanceScore = calculateBalanceScore(counts)

  // 输出日志
  if (totalMoved > 0) {
    console.log(`   ✅ 后处理完成：移动 ${totalMoved} 个关键词`)
    moves.slice(0, 10).forEach((m) => {
      console.log(`      "${m.keyword}" (${m.from} → ${m.to}: ${m.reason})`)
    })
    if (moves.length > 10) {
      console.log(`      ... 共 ${moves.length} 个移动`)
    }
  } else {
    console.log(`   ✅ 后处理完成：无需调整（AI聚类已正确）`)
  }
}
