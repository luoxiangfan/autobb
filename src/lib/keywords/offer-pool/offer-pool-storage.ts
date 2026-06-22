/**
 * 关键词池数据库操作与持久化辅助
 */

import { getDatabase } from '../../db'
import {
  generateContent,
  repairJsonText,
  loadPrompt,
  interpolateTemplate,
  recordTokenUsage,
  estimateTokenCost,
  buildUntrustedInputGuardrail,
  sanitizePromptBlockValue,
  sanitizePromptInlineValue,
  type InputReview,
} from '../../ai/server'

import { type Offer } from '../../offers/server'

import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'

import { extractVerifiedKeywordSourcePool } from '../server'
import { getPureBrandKeywords, isPureBrandKeyword } from '../server'
import { filterKeywordQuality } from '../server'
import { isInvalidKeyword } from '../planner/keyword-invalid-filter'

import { analyzeKeywordLanguageCompatibility } from '../server'

import { parseJsonField, toDbJsonArrayField } from '../../db'

import {
  DEFAULT_PRODUCT_CLUSTER_BUCKETS,
  DEFAULT_STORE_CLUSTER_BUCKETS,
  type KeywordBuckets,
  type OfferKeywordPool,
  type PoolKeywordData,
  type StoreKeywordBuckets,
} from './types'

import {
  extractFirstJsonObject,
  getKeywordSourcePriority,
  prioritizeBucketKeywords,
} from './keyword-clustering'

import { hasModelAnchorEvidence } from '../../creatives/server'

import { inferDefaultKeywordMatchType } from './offer-pool-brand-utils'
import { buildGlobalCoreQualityFilterContext } from './offer-pool-global-core'
export function serializeKeywordArrayForDb(data: unknown): unknown {
  return toDbJsonArrayField(data, [])
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
    const isActiveCondition = 'is_active = TRUE'
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
    console.warn(
      `[resolveActivePromptVersion] Failed to resolve active version for ${promptId}:`,
      error?.message || error
    )
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
  const resolvedPromptVersion =
    promptVersion ||
    (await resolveActivePromptVersion(
      db,
      KEYWORD_CLUSTERING_PROMPT_ID,
      KEYWORD_CLUSTERING_PROMPT_VERSION_FALLBACK
    ))

  const totalKeywords =
    brandKeywords.length +
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
  const brandKwJson = serializeKeywordArrayForDb(brandKeywords)
  const bucketAJson = serializeKeywordArrayForDb(buckets.bucketA.keywords)
  const bucketBJson = serializeKeywordArrayForDb(buckets.bucketB.keywords)
  const bucketCJson = serializeKeywordArrayForDb(buckets.bucketC.keywords)
  const bucketDJson = serializeKeywordArrayForDb(buckets.bucketD.keywords)
  console.log(`📊 保存关键词池:`)
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
        updated_at = ${'NOW()'}
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
        offerId,
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
      buckets.statistics.balanceScore,
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
export async function saveKeywordPoolWithData(
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
  storeBuckets?: StoreKeywordBuckets, // 🆕 v4.16: 店铺桶数据（可选）
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

  const brandKwJson = serializeKeywordArrayForDb(brandKeywords)
  const bucketAJson = serializeKeywordArrayForDb(buckets.bucketA.keywords)
  const bucketBJson = serializeKeywordArrayForDb(buckets.bucketB.keywords)
  const bucketCJson = serializeKeywordArrayForDb(buckets.bucketC.keywords)
  const bucketDJson = serializeKeywordArrayForDb(buckets.bucketD.keywords)
  const emptyArrayJson = serializeKeywordArrayForDb([])
  // 🆕 v4.16: 店铺分桶JSON（优先保存带搜索量的数据）
  const storeBucketAJson = storeBucketData
    ? serializeKeywordArrayForDb(storeBucketData.bucketA)
    : storeBuckets
      ? serializeKeywordArrayForDb(storeBuckets.bucketA.keywords)
      : emptyArrayJson
  const storeBucketBJson = storeBucketData
    ? serializeKeywordArrayForDb(storeBucketData.bucketB)
    : storeBuckets
      ? serializeKeywordArrayForDb(storeBuckets.bucketB.keywords)
      : emptyArrayJson
  const storeBucketCJson = storeBucketData
    ? serializeKeywordArrayForDb(storeBucketData.bucketC)
    : storeBuckets
      ? serializeKeywordArrayForDb(storeBuckets.bucketC.keywords)
      : emptyArrayJson
  const storeBucketDJson = storeBucketData
    ? serializeKeywordArrayForDb(storeBucketData.bucketD)
    : storeBuckets
      ? serializeKeywordArrayForDb(storeBuckets.bucketD.keywords)
      : emptyArrayJson
  const storeBucketSJson = storeBucketData
    ? serializeKeywordArrayForDb(storeBucketData.bucketS)
    : storeBuckets
      ? serializeKeywordArrayForDb(storeBuckets.bucketS.keywords)
      : emptyArrayJson

  const totalKeywords =
    brandKeywords.length +
    buckets.bucketA.keywords.length +
    buckets.bucketB.keywords.length +
    buckets.bucketC.keywords.length +
    buckets.bucketD.keywords.length

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
      `updated_at = ${'NOW()'}`,
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
      'gemini', // model
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
      offerId,
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
    'offer_id',
    'user_id',
    'brand_keywords',
    'bucket_a_keywords',
    'bucket_b_keywords',
    'bucket_c_keywords',
    'bucket_d_keywords',
    'bucket_a_intent',
    'bucket_b_intent',
    'bucket_c_intent',
    'bucket_d_intent',
    'total_keywords',
    'clustering_model',
    'clustering_prompt_version',
    'balance_score',
    'link_type',
    'store_bucket_a_keywords',
    'store_bucket_b_keywords',
    'store_bucket_c_keywords',
    'store_bucket_d_keywords',
    'store_bucket_s_keywords',
    'store_bucket_a_intent',
    'store_bucket_b_intent',
    'store_bucket_c_intent',
    'store_bucket_d_intent',
    'store_bucket_s_intent',
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
    storeBucketSIntent,
  ]

  const placeholders = insertFields.map(() => '?').join(', ')

  const result = await db.exec(
    `INSERT INTO offer_keyword_pools (${insertFields.join(', ')}) VALUES (${placeholders})`,
    insertValues
  )

  console.log(
    `✅ 关键词池已创建: Offer #${offerId}, ID #${result.lastInsertRowid} (${pageType}链接, 店铺5桶: ${storeBuckets ? '是' : '否'})`
  )
  return getKeywordPoolByOfferId(offerId) as Promise<OfferKeywordPool>
}

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
const TARGET_LANGUAGE_TRANSLATION_MAX_BATCH_SIZE = 24
const TARGET_LANGUAGE_TRANSLATION_NEUTRAL_TOKENS = new Set([
  'nsf',
  'ansi',
  'etl',
  'ul',
  'fcc',
  'ce',
  'rohs',
  'gpd',
  'btu',
  'mah',
  'wh',
  'w',
  'kw',
  'v',
  'psi',
  'db',
  'hz',
  'khz',
  'mhz',
  'ghz',
  'mm',
  'cm',
  'inch',
  'in',
  'ft',
  'l',
  'ml',
  'kg',
  'lb',
  'lbs',
])

function parseBooleanFeatureFlag(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
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
  promptTemplate: string
  targetLanguage: string
  keywords: string[]
}): string {
  const reviewedInputs: InputReview[] = []
  const numbered = params.keywords.map((keyword, index) => `${index}. ${keyword}`).join('\n')

  const variables = {
    targetLanguage: sanitizePromptInlineValue(
      reviewedInputs,
      'keyword_translation_target_language',
      params.targetLanguage,
      40,
      'English'
    ),
    keywordsBlock: sanitizePromptBlockValue(
      reviewedInputs,
      'keyword_translation_keywords',
      numbered,
      4000,
      '0. keyword'
    ),
  }

  return interpolateTemplate(params.promptTemplate, {
    inputGuardrail: buildUntrustedInputGuardrail(reviewedInputs),
    ...variables,
  })
}

function parseTranslationResponse(text: string): Array<{ index: number; keyword: string }> {
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
  const translations = Array.isArray((parsed as any).translations)
    ? (parsed as any).translations
    : []

  return translations
    .map((item: any) => ({
      index: Number(item?.index),
      keyword: String(item?.keyword || '').trim(),
    }))
    .filter(
      (item: { index: number; keyword: string }) =>
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
  if (isPureBrandKeyword(normalized, params.pureBrandKeywords)) return false

  const neutralTokens = buildTranslationNeutralTokenSet(params.pureBrandKeywords)
  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return false

  const hasNonNeutralToken = tokens.some(
    (token) => !isNeutralTokenForTranslation(token, neutralTokens)
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
  const promptTemplate = await loadPrompt('keyword_translation_normalization')

  for (const chunk of splitIntoChunks(
    params.keywords,
    TARGET_LANGUAGE_TRANSLATION_MAX_BATCH_SIZE
  )) {
    const uniqueChunkKeywords = Array.from(
      new Set(chunk.map((keyword) => String(keyword || '').trim()).filter(Boolean))
    )
    if (uniqueChunkKeywords.length === 0) continue

    try {
      const aiResponse = await generateContent(
        {
          operationType: 'keyword_translation_normalization',
          prompt: buildTranslationPrompt({
            promptTemplate,
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
        },
        userId
      )

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
      if (
        shouldAttemptTranslationForKeyword({
          keyword: raw,
          pureBrandKeywords: params.pureBrandKeywords,
        })
      ) {
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

/**
 * 🆕 解析关键词数组（向后兼容）
 * 处理新格式 PoolKeywordData[] 和旧格式 string[]
 */
function normalizeParsedPoolKeywordItem(raw: unknown): PoolKeywordData | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const partialItem = item as Partial<PoolKeywordData>
  const keyword = String(item.keyword || '').trim()
  if (!keyword) return null

  const rawSource = String(item.source || '').trim()
  const rawSourceType = String(item.sourceType || '').trim()
  const rawSourceSubtype = String(item.sourceSubtype || '').trim()
  const numericSearchVolume = Number(item.searchVolume || 0)
  const searchVolume = Number.isFinite(numericSearchVolume) ? numericSearchVolume : 0
  const matchType = String(item.matchType || '')
    .trim()
    .toUpperCase()
  const normalizedMatchType =
    matchType === 'EXACT' || matchType === 'PHRASE' || matchType === 'BROAD'
      ? (matchType as 'EXACT' | 'PHRASE' | 'BROAD')
      : 'PHRASE'
  const hasExplicitSourceMetadata = Boolean(rawSource || rawSourceType || rawSourceSubtype)
  if (hasExplicitSourceMetadata) {
    const source = rawSource || 'KEYWORD_POOL'
    const sourceType = rawSourceType || rawSourceSubtype || source
    const sourceSubtype = rawSourceSubtype || rawSourceType || sourceType
    return {
      ...partialItem,
      keyword,
      searchVolume,
      source,
      sourceType,
      sourceSubtype,
      matchType: normalizedMatchType,
    }
  }

  const source = 'KEYWORD_POOL'
  const sourceType = 'KEYWORD_POOL'
  const sourceSubtype = 'KEYWORD_POOL'

  return {
    ...partialItem,
    keyword,
    searchVolume,
    source,
    sourceType,
    sourceSubtype,
    matchType: normalizedMatchType,
  }
}

function parseKeywordArray(data: unknown): PoolKeywordData[] {
  const parsed = parseKeywordArrayFromDb(data)

  if (!Array.isArray(parsed) || parsed.length === 0) return []

  // 新格式：PoolKeywordData[]
  if (typeof parsed[0] === 'object' && parsed[0] !== null && 'keyword' in parsed[0]) {
    return parsed
      .map((item) => normalizeParsedPoolKeywordItem(item))
      .filter((item): item is PoolKeywordData => Boolean(item))
  }

  // 旧格式：string[] - 转换为 PoolKeywordData[]
  return parsed
    .map((kw: unknown) => (typeof kw === 'string' ? kw : ''))
    .filter((kw) => kw.length > 0)
    .map((kw) => ({
      keyword: kw,
      searchVolume: 0,
      source: 'LEGACY',
      matchType: 'PHRASE',
    }))
}

/**
 * 根据 Offer ID 获取关键词池
 * 🆕 v4.16: 添加店铺分桶字段解析
 */
export async function getKeywordPoolByOfferId(offerId: number): Promise<OfferKeywordPool | null> {
  const db = await getDatabase()

  const row = await db.queryOne<any>('SELECT * FROM offer_keyword_pools WHERE offer_id = ?', [
    offerId,
  ])

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
    updatedAt: row.updated_at,
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
