/**
 * 创意生成辅助：分桶查询 API
 */

import { getDatabase } from '../../db'

import { normalizeLanguageCode } from '../../common/server'

import {
  deriveCanonicalCreativeType,
  getCreativeTypeForBucketSlot,
  mapCreativeTypeToBucketSlot,
  normalizeCanonicalCreativeType,
  normalizeKeywordPoolBucketQuery,
  type CanonicalCreativeType,
  type CreativeBucketSlot,
} from '../../creatives/server'

import {
  DEFAULT_COVERAGE_KEYWORD_CONFIG,
  type BucketType,
  type CoverageKeywordConfig,
  type GetKeywordsOptions,
  type GetKeywordsResult,
  type OfferKeywordPool,
  type PoolKeywordData,
} from './types'

import { hasSearchVolumeUnavailableFlag, prioritizeBrandKeywordsFirst } from './keyword-clustering'

import {
  applyOfferContextToCanonicalKeywords,
  buildCanonicalBucketKeywords,
  getComprehensiveKeywordsForPool,
  getPoolPureBrandKeywords,
  isPureBrandPoolKeyword,
  mergeKeywordDataLists,
} from './canonical-bucket-view'

import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import { getKeywordPoolByOfferId } from './offer-pool-storage'

// 创意生成辅助

function getKeywordPoolBucketMeta(
  slot: CreativeBucketSlot,
  isStore: boolean
): { intent: string; intentEn: string } {
  if (slot === 'A') {
    return { intent: '品牌意图', intentEn: 'Brand Intent' }
  }
  if (slot === 'B') {
    return {
      intent: isStore ? '热门商品型号/产品族意图' : '商品型号/产品族意图',
      intentEn: isStore ? 'Store Model Intent' : 'Model Intent',
    }
  }
  return { intent: '商品需求意图', intentEn: 'Product Demand Intent' }
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
  const slot = normalizeKeywordPoolBucketQuery(bucket)
  if (!slot) {
    throw new Error(`Invalid bucket type: ${bucket}`)
  }

  const linkType = pool.linkType === 'store' ? 'store' : 'product'
  const isStore = linkType === 'store'
  const meta = getKeywordPoolBucketMeta(slot, isStore)

  return {
    keywords: buildCanonicalBucketKeywords(pool, slot, linkType),
    intent: meta.intent,
    intentEn: meta.intentEn,
  }
}

/**
 * 获取综合桶关键词（第5个创意专用）
 *
 * 策略
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
  const brandKeywords = pool.brandKeywords.map((kw) => ({
    keyword: typeof kw === 'string' ? kw : kw.keyword,
    searchVolume: typeof kw === 'string' ? 0 : kw.searchVolume || 0,
    isBrand: true,
  }))
  console.log(`   品牌词: ${brandKeywords.length}个`)

  // 2. 使用 canonical D 视图收集 coverage 候选，避免遗漏 bucketD / 店铺 store buckets。
  const coverageCandidates = buildCanonicalBucketKeywords(pool, 'D', linkType)

  // 3. 收集所有非纯品牌词（去重）
  const allNonBrandKeywords = new Set<string>([
    ...coverageCandidates
      .filter((kw) => !isPureBrandPoolKeyword(kw, pureBrandKeywords))
      .map((kw) => kw.keyword),
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
      const { getKeywordVolumesForExisting } = await import('../server')
      const volumeData = await getKeywordVolumesForExisting({
        baseKeywords: Array.from(allNonBrandKeywords),
        country,
        language: normalizeLanguageCode(config.language || 'en'),
        userId,
        brandName: pool.brandKeywords[0]
          ? typeof pool.brandKeywords[0] === 'string'
            ? pool.brandKeywords[0]
            : pool.brandKeywords[0].keyword
          : '',
      })

      // 构建搜索量映射（保留“搜索量不可用”标记）
      const volumeMap = new Map(
        volumeData.map((v) => [
          v.keyword.toLowerCase(),
          {
            searchVolume: v.searchVolume,
            volumeUnavailableReason: v.volumeUnavailableReason,
          },
        ])
      )

      // 转换为带搜索量的格式
      nonBrandWithVolume = Array.from(allNonBrandKeywords).map((kw) => ({
        keyword: kw,
        searchVolume: Number(volumeMap.get(kw.toLowerCase())?.searchVolume || 0),
        volumeUnavailableReason: volumeMap.get(kw.toLowerCase())?.volumeUnavailableReason,
        isBrand: false,
      }))

      // 按搜索量降序排序
      nonBrandWithVolume.sort((a, b) => b.searchVolume - a.searchVolume)

      // 过滤低于阈值的关键词
      // Explorer/权限受限返回 volumeUnavailableReason 时，跳过全部搜索量过滤
      const hasAnyVolume = nonBrandWithVolume.some((kw) => kw.searchVolume > 0)
      const volumeUnavailable = hasSearchVolumeUnavailableFlag(
        nonBrandWithVolume as Array<{ volumeUnavailableReason?: unknown }>
      )
      if (hasAnyVolume && !volumeUnavailable) {
        nonBrandWithVolume = nonBrandWithVolume.filter(
          (kw) => kw.searchVolume >= config.minSearchVolume
        )
        console.log(`   获取搜索量成功，过滤后剩余: ${nonBrandWithVolume.length}个`)
      } else if (hasAnyVolume && volumeUnavailable) {
        console.log(`   ⚠️ 搜索量数据不可用（Planner 权限受限），跳过搜索量过滤`)
      } else {
        console.log(`   ⚠️ 所有关键词搜索量为0（可能是服务账号模式），跳过搜索量过滤`)
      }
    } catch (error: any) {
      console.warn(`   ⚠️ 获取搜索量失败，使用原始顺序:`, error.message)
      nonBrandWithVolume = Array.from(allNonBrandKeywords).map((kw) => ({
        keyword: kw,
        searchVolume: 0,
        isBrand: false,
      }))
    }
  } else {
    // 不需要排序，直接使用
    nonBrandWithVolume = Array.from(allNonBrandKeywords).map((kw) => ({
      keyword: kw,
      searchVolume: 0,
      isBrand: false,
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
    console.log(
      `   - 最高搜索量: ${topNonBrandKeywords[0]?.keyword} (${topNonBrandKeywords[0]?.searchVolume})`
    )
  }

  return result
}

/**
 * 获取可用的桶（未被占用的）
 *
 * @param offerId - Offer ID
 * @returns 可用桶列表
 */
export async function getAvailableBuckets(offerId: number): Promise<BucketType[]> {
  const db = await getDatabase()

  // 只查询未删除的创意，排除软删除的创意
  // 同时排除 creation_status='generating' 的占位记录（防止并发竞态）
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

  // 只查询未删除的创意，排除软删除的创意
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
} /**
 * 计算关键词重叠率
 *
 * @param keywords1 - 关键词列表 1
 * @param keywords2 - 关键词列表 2
 * @returns 重叠率 (0-1)
 */
export function calculateKeywordOverlapRate(keywords1: string[], keywords2: string[]): number {
  if (keywords1.length === 0 || keywords2.length === 0) return 0

  const set1 = new Set(keywords1.map((k) => k.toLowerCase()))
  const set2 = new Set(keywords2.map((k) => k.toLowerCase()))

  let overlap = 0
  for (const kw of set1) {
    if (set2.has(kw)) overlap++
  }

  const total = Math.max(set1.size, set2.size)
  return overlap / total
}

// KISS 统一关键词检索 API
// 替代 5 个重叠函数，简化开发者体验

type CanonicalGetKeywordsBucket = 'A' | 'B' | 'D' | 'ALL'

function resolveCanonicalGetKeywordsBucket(
  bucket: GetKeywordsOptions['bucket'],
  intent?: GetKeywordsOptions['intent'],
  creativeType?: GetKeywordsOptions['creativeType']
): CanonicalGetKeywordsBucket {
  if (bucket && bucket !== 'ALL') {
    const normalizedBucket = normalizeKeywordPoolBucketQuery(bucket)
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
    ALL: mergeKeywordDataLists([bucketA.keywords, bucketB.keywords, bucketD.keywords]),
  }
}

function buildPureBrandSetFromPoolKeywords(keywords: PoolKeywordData[]): Set<string> {
  return new Set(
    keywords
      .map((item) => normalizeGoogleAdsKeyword(item.keyword))
      .filter((item): item is string => Boolean(item))
  )
}

function isPoolKeywordPureBrand(item: PoolKeywordData, pureBrandSet: Set<string>): boolean {
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

  const nonPure = params.keywords.filter(
    (item) => !isPoolKeywordPureBrand(item, params.pureBrandSet)
  )
  const existingFallback = params.keywords.find((item) =>
    isPoolKeywordPureBrand(item, params.pureBrandSet)
  )

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
 * 核心 API：统一关键词检索
 *
 * 示例用法
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
    maxKeywords = 5000,
  } = options

  // 1. 获取关键词池
  const keywordPool = await getKeywordPoolByOfferId(offerId)

  // 2. 如果没有，返回空结果
  if (!keywordPool) {
    return {
      keywords: [],
      stats: { totalCount: 0 },
      meta: { offerId },
    }
  }
  const pureBrandSet = buildPureBrandSetFromPoolKeywords(keywordPool.brandKeywords)

  // 3. 使用 canonical 视图选择关键词（兼容旧 bucket / intent 参数）
  const canonicalView = buildCanonicalKeywordView(keywordPool)
  const effectiveBucket = resolveCanonicalGetKeywordsBucket(bucket, intent, creativeType)
  let keywords =
    effectiveBucket === 'ALL'
      ? [...canonicalView.ALL]
      : [...canonicalView[effectiveBucket].keywords]
  const effectiveCreativeType =
    effectiveBucket === 'ALL' ? null : getCreativeTypeForBucketSlot(effectiveBucket)
  const keywordPoolLinkType = keywordPool.linkType === 'store' ? 'store' : 'product'
  const comprehensivePoolKeywords = getComprehensiveKeywordsForPool(
    keywordPool,
    keywordPoolLinkType
  )
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
  // 服务账号模式下无法获取搜索量，跳过过滤
  const hasAnyVolume = keywords.some((kw) => kw.searchVolume > 0)
  const volumeUnavailable = hasSearchVolumeUnavailableFlag(keywords)
  if (hasAnyVolume && !volumeUnavailable) {
    keywords = keywords.filter((kw) => {
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
      keywordPool.brandKeywords.map((kw) => kw.keyword)
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
      searchVolumeRange:
        keywords.length > 0
          ? {
              min: Math.min(...keywords.map((k) => k.searchVolume)),
              max: Math.max(...keywords.map((k) => k.searchVolume)),
            }
          : undefined,
    },
    meta: {
      offerId,
      createdAt: keywordPool.createdAt,
      updatedAt: keywordPool.updatedAt,
    },
  }

  // 7. 如果需要，返回桶信息
  if (effectiveBucket === 'ALL') {
    result.buckets = {
      A: { intent: canonicalView.A.intent, keywords: canonicalView.A.keywords },
      B: { intent: canonicalView.B.intent, keywords: canonicalView.B.keywords },
      C: { intent: canonicalView.C.intent, keywords: canonicalView.C.keywords },
      D: { intent: canonicalView.D.intent, keywords: canonicalView.D.keywords },
    }
  }

  console.log(
    `[getKeywords] 完成: offerId=${offerId}, bucket=${bucket}, effectiveBucket=${effectiveBucket}, 返回${keywords.length}个关键词`
  )
  return result
}

/**
 * v4.16: 根据链接类型和创意桶获取关键词
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

  const effectivePool =
    keywordPool.linkType === linkType ? keywordPool : { ...keywordPool, linkType }
  const bucketInfo = getBucketInfo(effectivePool as OfferKeywordPool, bucket)
  const effectiveBucket = normalizeKeywordPoolBucketQuery(bucket)
  if (!effectiveBucket) {
    throw new Error(`Invalid bucket type: ${bucket}`)
  }
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
