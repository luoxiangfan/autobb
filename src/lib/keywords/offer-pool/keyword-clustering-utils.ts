/**
 * 关键词聚类：工具函数与优先级排序
 */
import { generateContent } from '../../ai/server'
import { repairJsonText } from '../../ai/server'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { classifyKeywordIntent } from '../server'
import {
  getKeywordSourcePriorityScore as getUnifiedKeywordSourcePriorityScore,
  getKeywordSourcePriorityScoreFromInput,
} from '../server'
import { isPureBrandKeyword } from '../server'
import { resolveOfferLinkType } from '../../offers/server'
import type { Offer } from '../../offers/server'
import { type KeywordBuckets, type PoolKeywordData, type StoreKeywordBuckets } from './types'

import {
  createEmptyBuckets,
  createEmptyStoreBuckets,
  recalculateBucketStatistics,
  redistributeStoreBucketsFromS,
  applyStoreBucketPostProcessing,
  filterBucketsToAllowedKeywords,
  normalizeKeywordsForBuckets,
} from './keyword-clustering-buckets'
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

export const KEYWORD_CLUSTERING_MAX_OUTPUT_TOKENS = 16384
const KEYWORD_CLUSTERING_TIMEOUT_MS = 90000
export const KEYWORD_CLUSTERING_INPUT_LIMIT = 500
const KEYWORD_CLUSTERING_TRUNCATION_MARGIN = 32
export const KEYWORD_CLUSTERING_MAX_SPLIT_DEPTH = 3
export const KEYWORD_CLUSTERING_MIN_SPLIT_KEYWORDS = 8
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

export function extractHttpStatusFromError(error: unknown): number | null {
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

export function isRetryableClusteringError(error: unknown): boolean {
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

export function shouldUseDeterministicClusteringFallback(error: unknown): boolean {
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

export function buildDeterministicClusteringFallback(params: {
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

export async function runKeywordClustering(
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

export function appendKeywordClusteringOutputGuardrails(prompt: string): string {
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

export function parseKeywordClusteringJson(responseText: string): any {
  const jsonCandidate = extractFirstJsonObject(responseText)
  if (!jsonCandidate) {
    throw new Error('AI 返回的数据格式无效：未找到JSON对象')
  }

  const cleanedJson = repairJsonText(jsonCandidate)
  return JSON.parse(cleanedJson)
}

export function isLikelyKeywordClusteringTruncated(response: GeminiGenerateResult): boolean {
  const outputTokens = response.usage?.outputTokens || 0
  if (outputTokens <= 0) return false
  return outputTokens >= KEYWORD_CLUSTERING_MAX_OUTPUT_TOKENS - KEYWORD_CLUSTERING_TRUNCATION_MARGIN
}

export function splitKeywordsForRetry(keywords: string[]): [string[], string[]] {
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
    if (isPureBrandKeyword(kw.keyword, pureBrandKeywords)) {
      brandKeywords.push(kw)
    } else {
      nonBrandKeywords.push(kw)
    }
  }

  if (brandKeywords.length === 0 || nonBrandKeywords.length === 0) return keywords
  return [...brandKeywords, ...nonBrandKeywords]
}
