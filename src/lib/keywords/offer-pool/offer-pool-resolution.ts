/**
 * 关键词池获取、解析与晋升
 */

import { logger } from '@/lib/common/server'
import { getDatabase } from '../../db'

import { findOfferById, type Offer } from '../../offers/server'

import {
  loadKeywordPoolExpandCredentialsForOffer,
  type KeywordPoolExpandLoadResult,
  type KeywordPoolPreparedExpand,
  type KeywordPlannerPreparedSession,
} from '@/lib/google-ads/accounts/auth/index'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'

import { containsPureBrand, getPureBrandKeywords, isPureBrandKeyword } from '../server'

import { isInvalidKeyword } from '../planner/keyword-invalid-filter'

import {
  DEFAULT_PRODUCT_CLUSTER_BUCKETS,
  DEFAULT_STORE_CLUSTER_BUCKETS,
  type KeywordPoolProgressReporter,
  type OfferKeywordPool,
  type PoolKeywordData,
  type StoreKeywordBuckets,
} from './types'

import { calculateBalanceScore, resolveOfferPageType } from './keyword-clustering'

import { mergeKeywordDataLists } from './canonical-bucket-view'

import { inferDefaultKeywordMatchType } from './offer-pool-brand-utils'
import {
  getKeywordPoolByOfferId,
  saveKeywordPoolWithData,
  serializeKeywordArrayForDb,
} from './offer-pool-storage'
import { generateOfferKeywordPool } from './offer-pool-generator'
import { selectBucketForProduct, selectBucketForStore } from './offer-pool-global-core'
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
  progress?: KeywordPoolProgressReporter,
  preparedExpand?: KeywordPoolExpandLoadResult
): Promise<OfferKeywordPool> {
  // 检查现有池
  if (!forceRegenerate) {
    const existing = await getKeywordPoolByOfferId(offerId)
    if (existing) {
      logger.debug(`✅ 使用现有关键词池: Offer #${offerId}`)
      return existing
    }
  }

  // 生成新池
  return generateOfferKeywordPool(offerId, userId, undefined, progress, preparedExpand)
}

/**
 * 创意生成前解析关键词池：单次 prepare，建池时复用；池已存在则不再在池内 prepare。
 */
export async function resolveKeywordPoolForCreativeGeneration(
  offerId: number,
  userId: number,
  options?: {
    forceRegenerate?: boolean
    progress?: KeywordPoolProgressReporter
  }
): Promise<{
  pool: OfferKeywordPool
  plannerSession?: KeywordPlannerPreparedSession
  preparedExpand?: KeywordPoolPreparedExpand
}> {
  const expandLoad = await loadKeywordPoolExpandCredentialsForOffer(userId, offerId)
  const preparedExpand = expandLoad.ok ? expandLoad : undefined
  const plannerSession = preparedExpand?.plannerSession

  if (!options?.forceRegenerate) {
    const existing = await getKeywordPoolByOfferId(offerId)
    if (existing) {
      return { pool: existing, plannerSession, preparedExpand }
    }
  }

  const pool = await generateOfferKeywordPool(
    offerId,
    userId,
    undefined,
    options?.progress,
    preparedExpand
  )
  return { pool, plannerSession, preparedExpand }
}

type PromoteKeywordInput = {
  text?: string
  keyword?: string
  matchType?: string
  searchVolume?: number
}

type PromoteKeywordsToOfferKeywordPoolResult = {
  promotedCount: number
  skippedCount: number
  poolCreated: boolean
  poolUpdated: boolean
}

const PROMOTED_KEYWORD_PLATFORM_PATTERN = /\b(amazon|walmart|ebay|etsy|aliexpress|temu|shopee)\b/i
const PROMOTED_KEYWORD_INFO_QUERY_PATTERN =
  /\b(what is|meaning|tutorial|guide|manual|how to|instructions?)\b/i
const PROMOTED_KEYWORD_COMPARE_PATTERN = /\b(review|reviews|comparison|compare|vs|versus)\b/i

function normalizePromotionKeywordMatchType(
  rawMatchType: unknown,
  keyword: string,
  pureBrandKeywords: string[]
): 'EXACT' | 'PHRASE' | 'BROAD' {
  const normalized = String(rawMatchType || '')
    .trim()
    .toUpperCase()
  if (normalized === 'EXACT' || normalized === 'PHRASE' || normalized === 'BROAD') {
    return normalized as 'EXACT' | 'PHRASE' | 'BROAD'
  }
  return inferDefaultKeywordMatchType(keyword, pureBrandKeywords)
}

export async function promoteKeywordsToOfferKeywordPool(params: {
  offerId: number
  userId: number
  keywords: PromoteKeywordInput[]
  source?: string
  sourceType?: string
  sourceSubtype?: string
  rawSource?: string
  reason?: string
}): Promise<PromoteKeywordsToOfferKeywordPoolResult> {
  const source =
    String(params.source || 'SEARCH_TERM')
      .trim()
      .toUpperCase() || 'SEARCH_TERM'
  const sourceType =
    String(params.sourceType || source)
      .trim()
      .toUpperCase() || source
  const sourceSubtype =
    String(params.sourceSubtype || sourceType)
      .trim()
      .toUpperCase() || sourceType
  const rawSource =
    String(params.rawSource || source)
      .trim()
      .toUpperCase() || source

  if (!Array.isArray(params.keywords) || params.keywords.length === 0) {
    return { promotedCount: 0, skippedCount: 0, poolCreated: false, poolUpdated: false }
  }

  const offer = await findOfferById(params.offerId, params.userId)
  if (!offer) {
    return {
      promotedCount: 0,
      skippedCount: params.keywords.length,
      poolCreated: false,
      poolUpdated: false,
    }
  }

  const pageType = resolveOfferPageType(offer)
  const pureBrandKeywords = getPureBrandKeywords(offer.brand || '')
  const seen = new Set<string>()
  const promotedCandidates: PoolKeywordData[] = []
  let skippedCount = 0

  for (const item of params.keywords) {
    const rawText = String(item?.text || item?.keyword || '').trim()
    const normalizedKeyword = normalizeGoogleAdsKeyword(rawText)
    if (!normalizedKeyword) {
      skippedCount += 1
      continue
    }
    if (seen.has(normalizedKeyword)) continue
    seen.add(normalizedKeyword)

    if (normalizedKeyword.length < 2 || normalizedKeyword.length > 80) {
      skippedCount += 1
      continue
    }
    if (isInvalidKeyword(normalizedKeyword)) {
      skippedCount += 1
      continue
    }
    if (PROMOTED_KEYWORD_PLATFORM_PATTERN.test(normalizedKeyword)) {
      skippedCount += 1
      continue
    }
    if (PROMOTED_KEYWORD_INFO_QUERY_PATTERN.test(normalizedKeyword)) {
      skippedCount += 1
      continue
    }
    if (PROMOTED_KEYWORD_COMPARE_PATTERN.test(normalizedKeyword)) {
      skippedCount += 1
      continue
    }
    if (pureBrandKeywords.length > 0 && !containsPureBrand(normalizedKeyword, pureBrandKeywords)) {
      skippedCount += 1
      continue
    }

    promotedCandidates.push({
      keyword: normalizedKeyword,
      searchVolume: Math.max(0, Number(item?.searchVolume || 0) || 0),
      source,
      sourceType,
      sourceSubtype,
      rawSource,
      matchType: normalizePromotionKeywordMatchType(
        item?.matchType,
        normalizedKeyword,
        pureBrandKeywords
      ),
      isPureBrand: isPureBrandKeyword(normalizedKeyword, pureBrandKeywords),
      derivedTags: ['STRATEGY_PROMOTED'],
    })
  }

  if (promotedCandidates.length === 0) {
    return { promotedCount: 0, skippedCount, poolCreated: false, poolUpdated: false }
  }

  const bucketAdds = {
    brand: [] as PoolKeywordData[],
    productA: [] as PoolKeywordData[],
    productB: [] as PoolKeywordData[],
    productC: [] as PoolKeywordData[],
    productD: [] as PoolKeywordData[],
    storeA: [] as PoolKeywordData[],
    storeB: [] as PoolKeywordData[],
    storeC: [] as PoolKeywordData[],
    storeD: [] as PoolKeywordData[],
    storeS: [] as PoolKeywordData[],
  }

  for (const candidate of promotedCandidates) {
    if (candidate.isPureBrand) {
      bucketAdds.brand.push(candidate)
      continue
    }

    const productBucket = selectBucketForProduct(candidate.keyword)
    if (productBucket === 'A') bucketAdds.productA.push(candidate)
    else if (productBucket === 'B') bucketAdds.productB.push(candidate)
    else if (productBucket === 'C') bucketAdds.productC.push(candidate)
    else bucketAdds.productD.push(candidate)

    const storeBucket = selectBucketForStore(candidate.keyword)
    if (storeBucket === 'A') bucketAdds.storeA.push(candidate)
    else if (storeBucket === 'B') bucketAdds.storeB.push(candidate)
    else if (storeBucket === 'C') bucketAdds.storeC.push(candidate)
    else if (storeBucket === 'D') bucketAdds.storeD.push(candidate)
    else bucketAdds.storeS.push(candidate)
  }

  const existing = await getKeywordPoolByOfferId(params.offerId)
  if (!existing) {
    const brandKeywords = mergeKeywordDataLists([bucketAdds.brand])
    const bucketAKeywords = mergeKeywordDataLists([bucketAdds.productA])
    const bucketBKeywords = mergeKeywordDataLists([bucketAdds.productB])
    const bucketCKeywords = mergeKeywordDataLists([bucketAdds.productC])
    const bucketDKeywords = mergeKeywordDataLists([bucketAdds.productD])

    const storeBucketAKeywords = mergeKeywordDataLists([bucketAdds.storeA])
    const storeBucketBKeywords = mergeKeywordDataLists([bucketAdds.storeB])
    const storeBucketCKeywords = mergeKeywordDataLists([bucketAdds.storeC])
    const storeBucketDKeywords = mergeKeywordDataLists([bucketAdds.storeD])
    const storeBucketSKeywords = mergeKeywordDataLists([bucketAdds.storeS])

    const storeBuckets: StoreKeywordBuckets = {
      bucketA: {
        ...DEFAULT_STORE_CLUSTER_BUCKETS.A,
        keywords: storeBucketAKeywords.map((item) => item.keyword),
      },
      bucketB: {
        ...DEFAULT_STORE_CLUSTER_BUCKETS.B,
        keywords: storeBucketBKeywords.map((item) => item.keyword),
      },
      bucketC: {
        ...DEFAULT_STORE_CLUSTER_BUCKETS.C,
        keywords: storeBucketCKeywords.map((item) => item.keyword),
      },
      bucketD: {
        ...DEFAULT_STORE_CLUSTER_BUCKETS.D,
        keywords: storeBucketDKeywords.map((item) => item.keyword),
      },
      bucketS: {
        ...DEFAULT_STORE_CLUSTER_BUCKETS.S,
        keywords: storeBucketSKeywords.map((item) => item.keyword),
      },
      statistics: {
        totalKeywords:
          storeBucketAKeywords.length +
          storeBucketBKeywords.length +
          storeBucketCKeywords.length +
          storeBucketDKeywords.length +
          storeBucketSKeywords.length,
        bucketACount: storeBucketAKeywords.length,
        bucketBCount: storeBucketBKeywords.length,
        bucketCCount: storeBucketCKeywords.length,
        bucketDCount: storeBucketDKeywords.length,
        bucketSCount: storeBucketSKeywords.length,
        balanceScore: calculateBalanceScore([
          storeBucketAKeywords.length,
          storeBucketBKeywords.length,
          storeBucketCKeywords.length,
          storeBucketDKeywords.length,
          storeBucketSKeywords.length,
        ]),
      },
    }

    await saveKeywordPoolWithData(
      params.offerId,
      params.userId,
      brandKeywords,
      {
        bucketA: { intent: DEFAULT_PRODUCT_CLUSTER_BUCKETS.A.intent, keywords: bucketAKeywords },
        bucketB: { intent: DEFAULT_PRODUCT_CLUSTER_BUCKETS.B.intent, keywords: bucketBKeywords },
        bucketC: { intent: DEFAULT_PRODUCT_CLUSTER_BUCKETS.C.intent, keywords: bucketCKeywords },
        bucketD: { intent: DEFAULT_PRODUCT_CLUSTER_BUCKETS.D.intent, keywords: bucketDKeywords },
        statistics: {
          totalKeywords:
            brandKeywords.length +
            bucketAKeywords.length +
            bucketBKeywords.length +
            bucketCKeywords.length +
            bucketDKeywords.length,
          balanceScore: calculateBalanceScore([
            bucketAKeywords.length,
            bucketBKeywords.length,
            bucketCKeywords.length,
            bucketDKeywords.length,
          ]),
        },
      },
      pageType,
      storeBuckets,
      {
        bucketA: storeBucketAKeywords,
        bucketB: storeBucketBKeywords,
        bucketC: storeBucketCKeywords,
        bucketD: storeBucketDKeywords,
        bucketS: storeBucketSKeywords,
      }
    )

    logger.debug(
      `[KeywordPoolPromotion] offer=${params.offerId} created=true promoted=${promotedCandidates.length} skipped=${skippedCount} reason=${params.reason || 'campaign_keywords_add'}`
    )
    return {
      promotedCount: promotedCandidates.length,
      skippedCount,
      poolCreated: true,
      poolUpdated: false,
    }
  }

  const nextBrandKeywords = mergeKeywordDataLists([existing.brandKeywords, bucketAdds.brand])
  const nextBucketAKeywords = mergeKeywordDataLists([existing.bucketAKeywords, bucketAdds.productA])
  const nextBucketBKeywords = mergeKeywordDataLists([existing.bucketBKeywords, bucketAdds.productB])
  const nextBucketCKeywords = mergeKeywordDataLists([existing.bucketCKeywords, bucketAdds.productC])
  const nextBucketDKeywords = mergeKeywordDataLists([existing.bucketDKeywords, bucketAdds.productD])
  const nextStoreBucketAKeywords = mergeKeywordDataLists([
    existing.storeBucketAKeywords,
    bucketAdds.storeA,
  ])
  const nextStoreBucketBKeywords = mergeKeywordDataLists([
    existing.storeBucketBKeywords,
    bucketAdds.storeB,
  ])
  const nextStoreBucketCKeywords = mergeKeywordDataLists([
    existing.storeBucketCKeywords,
    bucketAdds.storeC,
  ])
  const nextStoreBucketDKeywords = mergeKeywordDataLists([
    existing.storeBucketDKeywords,
    bucketAdds.storeD,
  ])
  const nextStoreBucketSKeywords = mergeKeywordDataLists([
    existing.storeBucketSKeywords,
    bucketAdds.storeS,
  ])
  const nextTotalKeywords =
    nextBrandKeywords.length +
    nextBucketAKeywords.length +
    nextBucketBKeywords.length +
    nextBucketCKeywords.length +
    nextBucketDKeywords.length
  const nextBalanceScore = calculateBalanceScore([
    nextBucketAKeywords.length,
    nextBucketBKeywords.length,
    nextBucketCKeywords.length,
    nextBucketDKeywords.length,
  ])

  const db = await getDatabase()
  await db.exec(
    `
      UPDATE offer_keyword_pools
      SET brand_keywords = ?,
          bucket_a_keywords = ?,
          bucket_b_keywords = ?,
          bucket_c_keywords = ?,
          bucket_d_keywords = ?,
          store_bucket_a_keywords = ?,
          store_bucket_b_keywords = ?,
          store_bucket_c_keywords = ?,
          store_bucket_d_keywords = ?,
          store_bucket_s_keywords = ?,
          total_keywords = ?,
          balance_score = ?,
          updated_at = ${'NOW()'}
      WHERE offer_id = ?
        AND user_id = ?
    `,
    [
      serializeKeywordArrayForDb(nextBrandKeywords),
      serializeKeywordArrayForDb(nextBucketAKeywords),
      serializeKeywordArrayForDb(nextBucketBKeywords),
      serializeKeywordArrayForDb(nextBucketCKeywords),
      serializeKeywordArrayForDb(nextBucketDKeywords),
      serializeKeywordArrayForDb(nextStoreBucketAKeywords),
      serializeKeywordArrayForDb(nextStoreBucketBKeywords),
      serializeKeywordArrayForDb(nextStoreBucketCKeywords),
      serializeKeywordArrayForDb(nextStoreBucketDKeywords),
      serializeKeywordArrayForDb(nextStoreBucketSKeywords),
      nextTotalKeywords,
      nextBalanceScore,
      params.offerId,
      params.userId,
    ]
  )

  logger.debug(
    `[KeywordPoolPromotion] offer=${params.offerId} created=false promoted=${promotedCandidates.length} skipped=${skippedCount} reason=${params.reason || 'campaign_keywords_add'}`
  )
  return {
    promotedCount: promotedCandidates.length,
    skippedCount,
    poolCreated: false,
    poolUpdated: true,
  }
}
