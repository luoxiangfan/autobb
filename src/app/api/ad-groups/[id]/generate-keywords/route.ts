import { NextRequest, NextResponse } from 'next/server'
import { findAdGroupById } from '@/lib/ad-groups'
import { findCampaignById } from '@/lib/campaigns'
import { findOfferById } from '@/lib/offers'
import { generateNegativeKeywords } from '@/lib/keyword-generator'
import { getUnifiedKeywordData } from '@/lib/unified-keyword-service'
import { createKeywordsBatch, CreateKeywordInput } from '@/lib/keywords'
import { inferNegativeKeywordMatchType } from '@/lib/campaign-publish/negative-keyword-match-type'

/**
 * POST /api/ad-groups/:id/generate-keywords
 * 使用Keyword Planner API + 白名单过滤为Ad Group生成关键词
 *
 * @deprecated 此API将被废弃，推荐使用创意生成流程中的关键词生成
 * 保留仅为向后兼容
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const body = await request.json()
    const { includeNegativeKeywords = false } = body

    // 查找Ad Group
    const adGroup = await findAdGroupById(parseInt(id, 10), parseInt(userId, 10))
    if (!adGroup) {
      return NextResponse.json(
        {
          error: 'Ad Group不存在或无权访问',
        },
        { status: 404 }
      )
    }

    // 查找Campaign
    const campaign = await findCampaignById(adGroup.campaignId, parseInt(userId, 10))
    if (!campaign) {
      return NextResponse.json(
        {
          error: 'Campaign不存在',
        },
        { status: 404 }
      )
    }

    // 查找Offer
    const offer = await findOfferById(campaign.offerId, parseInt(userId, 10))
    if (!offer) {
      return NextResponse.json(
        {
          error: 'Offer不存在',
        },
        { status: 404 }
      )
    }

    // 检查Offer是否已完成抓取
    if (offer.scrape_status !== 'completed') {
      return NextResponse.json(
        {
          error: '请先完成产品信息抓取后再生成关键词',
        },
        { status: 400 }
      )
    }

    // 使用统一关键词服务生成关键词
    const userIdNum = parseInt(userId, 10)

    // 从 scraped_data 提取产品信息（如果有的话）
    let productTitle: string | undefined
    let productFeatures: string | undefined
    let storeProductNames: string[] | undefined

    if (offer.scraped_data) {
      try {
        const scrapedData = JSON.parse(offer.scraped_data as string)
        productTitle = scrapedData.title || scrapedData.product_name || scrapedData.name
        productFeatures = scrapedData.features ? JSON.stringify(scrapedData.features) : undefined
        // 店铺产品列表
        if (scrapedData.products && Array.isArray(scrapedData.products)) {
          storeProductNames = scrapedData.products.map((p: any) => p.name || p.title).filter(Boolean)
        }
      } catch {
        // scraped_data解析失败，继续使用基本信息
      }
    }

    // 转换 Offer 为 OfferData
    const offerData = {
      brand: offer.brand,
      category: offer.category,
      productTitle,
      productFeatures,
      storeProductNames,
      scrapedData: offer.scraped_data || undefined
    }

    // 🆕 P0-2优化：获取关键词和竞品品牌
    const { keywords: unifiedKeywords, competitorBrands } = await getUnifiedKeywordData({
      offer: offerData,
      country: offer.target_country,
      language: offer.target_language || 'English',
      userId: userIdNum,
      minSearchVolume: 10  // 默认最低搜索量
    })

    // 生成否定关键词（如果需要）
    let negativeKeywords: string[] = []
    if (includeNegativeKeywords) {
      const aiNegativeKeywords = await generateNegativeKeywords(offer, userIdNum)
      // 🆕 P0-2优化：将竞品品牌添加为否定关键词
      negativeKeywords = [...aiNegativeKeywords, ...competitorBrands]
    } else if (competitorBrands.length > 0) {
      // 即使不包含AI生成的否定词，也添加竞品品牌作为否定词
      negativeKeywords = competitorBrands
    }

    // 将生成的关键词保存到数据库
    const keywordsToCreate: CreateKeywordInput[] = unifiedKeywords.map(kw => ({
      userId: parseInt(userId, 10),
      adGroupId: adGroup.id,
      keywordText: kw.keyword,
      matchType: kw.matchType,
      status: 'PAUSED', // 默认暂停状态
      aiGenerated: false,  // Keyword Planner 生成，非AI生成
      generationSource: 'keyword-planner',
    }))

    // 如果有否定关键词，也添加到列表
    if (negativeKeywords.length > 0) {
      negativeKeywords.forEach(negKw => {
        keywordsToCreate.push({
          userId: parseInt(userId, 10),
          adGroupId: adGroup.id,
          keywordText: negKw,
          matchType: inferNegativeKeywordMatchType(negKw),
          status: 'PAUSED',
          isNegative: true,
          aiGenerated: true,  // 否定关键词仍然由AI生成
          generationSource: 'gemini-negative',
        })
      })
    }

    // 批量创建关键词
    const createdKeywords = await createKeywordsBatch(keywordsToCreate)

    // 提取关键词类别统计
    const categoryStats = unifiedKeywords.reduce((acc, kw) => {
      const source = kw.source || 'UNKNOWN'
      acc[source] = (acc[source] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    return NextResponse.json({
      success: true,
      keywords: createdKeywords,
      count: createdKeywords.length,
      positiveCount: unifiedKeywords.length,
      negativeCount: negativeKeywords.length,
      competitorBrands,  // 🆕 P0-2优化：返回识别的竞品品牌
      categories: Object.keys(categoryStats),
      categoryStats,
      recommendations: [
        '关键词已通过品牌白名单过滤，确保相关性',
        '关键词按搜索量降序排列，优先展示高价值词',
        competitorBrands.length > 0
          ? `已识别${competitorBrands.length}个竞品品牌并添加为否定关键词: ${competitorBrands.join(', ')}`
          : '未检测到竞品品牌词',
        '建议定期监控关键词表现并优化'
      ],
    })
  } catch (error: any) {
    console.error('生成关键词失败:', error)

    return NextResponse.json(
      {
        error: error.message || '生成关键词失败',
      },
      { status: 500 }
    )
  }
}
