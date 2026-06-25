import { getDatabase } from '../../db'
import {
  getKeywordSearchVolumesForPlannerContext,
  type KeywordPlannerPreparedSession,
} from '@/lib/google-ads/accounts/auth/index'
import { getPureBrandKeywords } from '../server'
import { isInvalidKeyword } from '../planner/keyword-invalid-filter'
import { type KeywordPoolProgressReporter, type PoolKeywordData } from './types'
import { resolveOfferPageType } from './keyword-clustering'
import { inferDefaultKeywordMatchType } from './offer-pool-brand-utils'

/**
 * 从 Offer 现有数据提取关键词
 * 返回 PoolKeywordData[]，保留完整元数据
 */
export async function extractKeywordsFromOffer(
  offerId: number,
  userId: number,
  progress?: KeywordPoolProgressReporter,
  plannerSession?: KeywordPlannerPreparedSession
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
    const normalized = typeof rawMatchType === 'string' ? rawMatchType.trim().toUpperCase() : ''
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
    // � 关键词质量校验：过滤无效关键词
    if (isInvalidKeyword(normalized)) {
      console.warn(
        `[extractKeywordsFromOffer] ⚠️ 过滤无效关键词: "${normalized}" (source: ${source})`
      )
      return
    }
    addKeywordData({
      keyword: normalized,
      searchVolume: 0,
      source,
      matchType: inferDefaultKeywordMatchType(normalized, pureBrandKeywords),
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
          // � 关键词质量校验
          if (isInvalidKeyword(keyword)) {
            console.warn(
              `[extractKeywordsFromOffer] ⚠️ 过滤无效关键词: "${keyword}" (source: ${source})`
            )
            continue
          }
          addKeywordData({
            keyword,
            searchVolume: Number((item as any).searchVolume || (item as any).volume || 0) || 0,
            competition:
              typeof (item as any).competition === 'string' ? (item as any).competition : undefined,
            competitionIndex:
              typeof (item as any).competitionIndex === 'number'
                ? (item as any).competitionIndex
                : undefined,
            lowTopPageBid:
              typeof (item as any).lowTopPageBid === 'number'
                ? (item as any).lowTopPageBid
                : undefined,
            highTopPageBid:
              typeof (item as any).highTopPageBid === 'number'
                ? (item as any).highTopPageBid
                : undefined,
            source,
            matchType: normalizeKeywordMatchType((item as any).matchType, keyword),
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
                searchVolume: typeof kw === 'object' ? kw.searchVolume || 0 : 0,
                competition: typeof kw === 'object' ? kw.competition : undefined,
                competitionIndex: typeof kw === 'object' ? kw.competitionIndex : undefined,
                lowTopPageBid: typeof kw === 'object' ? kw.lowTopPageBid : undefined,
                highTopPageBid: typeof kw === 'object' ? kw.highTopPageBid : undefined,
                source: 'CREATIVE',
                matchType: normalizeKeywordMatchType(
                  typeof kw === 'object' ? kw.matchType : undefined,
                  kwStr
                ),
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
      console.warn(
        `[extractKeywordsFromOffer] Offer #${offerId} 无AI/提取关键词，使用兜底种子词生成 (pageType=${resolveOfferPageType(offer)})`
      )

      // 1) 品牌词（保证至少有一个关键词）
      addKeywordString(offer.brand, 'FALLBACK_BRAND')

      // 2) 产品名 / 品类（来自抓取结果）
      if (offer.product_name && offer.product_name !== offer.brand) {
        addKeywordString(
          `${offer.brand} ${offer.product_name}`.slice(0, 80),
          'FALLBACK_PRODUCT_NAME'
        )
      }
      if (offer.category) {
        addKeywordString(`${offer.brand} ${offer.category}`.slice(0, 80), 'FALLBACK_CATEGORY')
      }

      // 3) 尝试复用统一关键词服务的“意图感知种子词”构建逻辑（仅在兜底路径加载）
      try {
        const { buildIntentAwareSeedPool } = await import('../server')
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
          .forEach((seed) => addKeywordString(seed, 'FALLBACK_INTENT_SEEDS'))
      } catch (seedError: any) {
        console.warn(
          `[extractKeywordsFromOffer] 兜底种子词构建失败: ${seedError?.message || seedError}`
        )
      }
    }
  }

  const keywords = Array.from(keywordMap.values())

  // 查询提取关键词的搜索量
  if (keywords.length > 0) {
    console.log(`📊 查询 ${keywords.length} 个提取关键词的搜索量...`)
    await progress?.({ phase: 'seed-volume', message: `初始关键词搜索量查询中` })

    try {
      // 获取 offer 信息（用于获取 target_country 和 target_language）
      const offer = await db.queryOne<{
        target_country: string
        target_language: string | null
      }>('SELECT target_country, target_language FROM offers WHERE id = ? AND user_id = ?', [
        offerId,
        userId,
      ])

      if (offer) {
        const volumeProgress = progress
          ? (info: { message: string; current?: number; total?: number }) =>
              progress({
                phase: 'seed-volume',
                current: info.current,
                total: info.total,
                message: `初始关键词搜索量 ${info.current ?? 0}/${info.total ?? 0}`,
              })
          : undefined

        const volumeResult = await getKeywordSearchVolumesForPlannerContext({
          userId,
          offerId,
          keywords: keywords.map((k) => k.keyword),
          country: offer.target_country,
          language: offer.target_language || 'en',
          plannerSession,
          onProgress: volumeProgress,
        })
        if (!volumeResult.ok) {
          throw new Error(volumeResult.message)
        }
        const volumes = volumeResult.volumes

        // 更新搜索量
        const volumeMap = new Map(volumes.map((v) => [v.keyword.toLowerCase(), v]))
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

        const withVolume = keywords.filter((k) => k.searchVolume > 0).length
        console.log(`✅ 搜索量查询完成: ${withVolume}/${keywords.length} 个关键词有搜索量`)
      }
    } catch (error) {
      console.warn(`⚠️ 查询搜索量失败: ${error}`)
      // 降级处理：保留原有的 searchVolume: 0
    }
  }

  return keywords
}
