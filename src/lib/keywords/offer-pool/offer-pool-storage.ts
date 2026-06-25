/**
 * 关键词池数据库操作与持久化
 */
import { getDatabase, parseJsonField, toDbJsonArrayField } from '../../db'

import {
  DEFAULT_PRODUCT_CLUSTER_BUCKETS,
  DEFAULT_STORE_CLUSTER_BUCKETS,
  type KeywordBuckets,
  type OfferKeywordPool,
  type PoolKeywordData,
  type StoreKeywordBuckets,
} from './types'

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

  // 使用统一的JSON序列化函数
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
 * 保存关键词池（PoolKeywordData[] 版本）
 * 添加bucketD支持
 * v4.16: 支持店铺链接的5桶存储
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
  storeBuckets?: StoreKeywordBuckets, // v4.16: 店铺桶数据（可选）
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
  // v4.16: 店铺分桶JSON（优先保存带搜索量的数据）
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

  // v4.16: 店铺分桶意图
  const storeBucketAIntent = storeBuckets?.bucketA.intent || DEFAULT_STORE_CLUSTER_BUCKETS.A.intent
  const storeBucketBIntent = storeBuckets?.bucketB.intent || DEFAULT_STORE_CLUSTER_BUCKETS.B.intent
  const storeBucketCIntent = storeBuckets?.bucketC.intent || DEFAULT_STORE_CLUSTER_BUCKETS.C.intent
  const storeBucketDIntent = storeBuckets?.bucketD.intent || DEFAULT_STORE_CLUSTER_BUCKETS.D.intent
  const storeBucketSIntent = storeBuckets?.bucketS.intent || DEFAULT_STORE_CLUSTER_BUCKETS.S.intent

  if (existing) {
    // v4.16: 更新现有记录（包含店铺分桶）
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

  // v4.16: 创建新记录（包含店铺分桶）
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

/**
 * 解析关键词数组（向后兼容）
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
 * v4.16: 添加店铺分桶字段解析
 */
export async function getKeywordPoolByOfferId(offerId: number): Promise<OfferKeywordPool | null> {
  const db = await getDatabase()

  const row = await db.queryOne<any>('SELECT * FROM offer_keyword_pools WHERE offer_id = ?', [
    offerId,
  ])

  if (!row) return null

  // 使用parseKeywordArray处理新旧格式
  // 添加bucketDKeywords和bucketDIntent
  // 添加店铺分桶字段
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
    // v4.16: 店铺分桶字段
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
