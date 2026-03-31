import { NextRequest, NextResponse } from 'next/server'
import { findOfferById } from '@/lib/offers'
import { findEnabledGoogleAdsAccounts } from '@/lib/google-ads-accounts'
import { getGoogleAdsCredentials, getUserAuthType } from '@/lib/google-ads-oauth'
import {
  getKeywordIdeas,
  filterHighQualityKeywords,
  rankKeywordsByRelevance,
  groupKeywordsByTheme,
  formatCpcMicros,
  formatSearchVolume,
  getKeywordMetrics,
} from '@/lib/google-ads-keyword-planner'
import {
  getBrandSearchSuggestions,
  filterMismatchedGeoKeywords,
} from '@/lib/google-suggestions'
import { classifyKeywordIntent, recommendMatchTypeForKeyword } from '@/lib/keyword-intent'
import { getKeywordPlannerSiteFilterUrlForOffer } from '@/lib/keyword-planner-site-filter'
import { ensureOfferBrandOfficialSite } from '@/lib/offer-official-site'
import { normalizeLanguageCode } from '@/lib/language-country-codes'

/**
 * POST /api/offers/:id/keyword-ideas
 * 获取关键词建议
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }
    const numericUserId = parseInt(userId, 10)

    const body = await request.json()
    const {
      seedKeywords = [],
      useUrl = true,
      filterOptions = {},
    } = body

    // 验证Offer存在且属于当前用户
    const offer = await findOfferById(parseInt(id, 10), numericUserId)

    if (!offer) {
      return NextResponse.json(
        { error: 'Offer不存在或无权访问' },
        { status: 404 }
      )
    }

    // 获取用户可用的Google Ads账号（ENABLED状态，非Manager账号）
    const googleAdsAccounts = await findEnabledGoogleAdsAccounts(numericUserId)

    if (googleAdsAccounts.length === 0) {
      return NextResponse.json(
        {
          error: '未找到已连接的Google Ads账号，请先连接您的Google Ads账号',
          needsConnection: true,
        },
        { status: 400 }
      )
    }

    const googleAdsAccount = googleAdsAccounts[0]

    // 注意：生产环境 OAuth refresh_token 存储在 google_ads_credentials，
    // google_ads_accounts.refresh_token 可能为空，不能据此判断授权过期。
    const auth = await getUserAuthType(numericUserId)
    if (auth.authType === 'oauth') {
      const oauthCredentials = await getGoogleAdsCredentials(numericUserId)
      if (!oauthCredentials?.refresh_token) {
        return NextResponse.json(
          {
            error: 'Google Ads账号授权已过期，请重新连接或配置服务账号',
            needsReauth: true,
          },
          { status: 400 }
        )
      }
    }

    // 准备种子关键词
    let finalSeedKeywords = [...seedKeywords]

    // 如果没有提供种子关键词，使用品牌名称
    if (finalSeedKeywords.length === 0) {
      const brandWords = offer.brand.split(/\s+/)
      const firstWord = brandWords[0]

      finalSeedKeywords = [
        offer.brand,
        `${offer.brand} official`,
        `${offer.brand} store`,
      ]

      // 如果品牌名有多个词，添加第一个词的变体
      if (brandWords.length > 1) {
        finalSeedKeywords.push(
          firstWord,
          `${firstWord} professional`,
          `${firstWord} products`
        )
      }
    }

    console.log(`获取关键词建议: seeds=${finalSeedKeywords.join(', ')}, url=${useUrl ? offer.url : 'none'}`)

    // 🔧 修复(2025-12-25): 支持OAuth和服务账号两种认证方式
    const { getGoogleAdsConfig } = await import('@/lib/keyword-planner')
    const config = await getGoogleAdsConfig(numericUserId, auth.authType, auth.serviceAccountId)

    if (!config) {
      return NextResponse.json({ error: 'Google Ads凭证未配置' }, { status: 400 })
    }

    // 需求11：并行获取Google搜索下拉词和Keyword Planner建议
    let siteFilterUrl = useUrl ? getKeywordPlannerSiteFilterUrlForOffer(offer) : undefined
    if (useUrl && !siteFilterUrl) {
      const official = await ensureOfferBrandOfficialSite({
        offerId: offer.id,
        userId: numericUserId,
        brand: offer.brand,
        targetCountry: offer.target_country,
        finalUrl: offer.final_url,
        url: offer.url,
        category: offer.category,
        productName: offer.product_name,
        extractionMetadata: offer.extraction_metadata,
      }).catch(() => null)

      if (official?.origin) {
        siteFilterUrl = official.origin
      }
    }

    const normalizedLanguageCode = normalizeLanguageCode(offer.target_language || 'English')

    console.log(`Keyword Planner siteFilterUrl: ${siteFilterUrl || '(none)'}`)
    const [googleSuggestKeywords, keywordPlannerIdeas] = await Promise.all([
      // 1. 获取Google搜索下拉词（保留原始建议，后续按意图分类）
      getBrandSearchSuggestions({
        brand: offer.brand,
        country: offer.target_country,
        language: normalizedLanguageCode,
        useProxy: true,
        productName: offer.product_name || undefined,
        category: offer.category || undefined,
      }).catch((err) => {
        console.warn('获取Google搜索建议失败，继续使用Keyword Planner:', err)
        return []
      }),

      // 2. 调用Keyword Planner API
      getKeywordIdeas({
        customerId: googleAdsAccount.customerId,
        seedKeywords: finalSeedKeywords,
        pageUrl: siteFilterUrl,
        targetCountry: offer.target_country,
        targetLanguage: offer.target_language || 'English',
        accountId: googleAdsAccount.id,
        userId: numericUserId,
        authType: auth.authType,
        serviceAccountId: auth.serviceAccountId,
      }),
    ])

    console.log(
      `✓ Google下拉词: ${googleSuggestKeywords.length}个, Keyword Planner: ${keywordPlannerIdeas.length}个`
    )

    // 合并下拉词和Keyword Planner结果
    let keywordIdeas = keywordPlannerIdeas

    // 如果有Google下拉词，查询它们的搜索量数据
    if (googleSuggestKeywords.length > 0) {
      try {
        const suggestMetrics = await getKeywordMetrics({
          customerId: googleAdsAccount.customerId,
          keywords: googleSuggestKeywords.map((item) => item.keyword),
          targetCountry: offer.target_country,
          targetLanguage: offer.target_language || 'English',
          accountId: googleAdsAccount.id,
          userId: numericUserId,
          authType: auth.authType,
          serviceAccountId: auth.serviceAccountId,
        })

        // 转换为KeywordIdea格式
        const suggestIdeas = suggestMetrics.map((metric) => ({
          text: metric.keyword,
          avgMonthlySearches: metric.avgMonthlySearches,
          competition: metric.competition,
          competitionIndex: metric.competitionIndex,
          lowTopOfPageBidMicros: metric.lowTopOfPageBidMicros,
          highTopOfPageBidMicros: metric.highTopOfPageBidMicros,
        }))

        // 合并并去重
        const existingKeywords = new Set(
          keywordPlannerIdeas.map((kw) => kw.text.toLowerCase())
        )
        const newSuggestions = suggestIdeas.filter(
          (kw) => !existingKeywords.has(kw.text.toLowerCase())
        )

        keywordIdeas = [...keywordPlannerIdeas, ...newSuggestions]

        console.log(`✓ 合并后共${keywordIdeas.length}个关键词（新增${newSuggestions.length}个下拉词）`)
      } catch (err) {
        console.warn('查询Google下拉词搜索量失败，忽略下拉词:', err)
      }
    }

    const intentByKeyword = new Map<string, ReturnType<typeof classifyKeywordIntent>>()
    const excludedKeywordMap = new Map<
      string,
      {
        text: string
        intent: string
        hardNegative: boolean
        reasons: string[]
        stage: 'intent_hard_negative' | 'geo_mismatch'
      }
    >()

    let hardNegativeFilteredCount = 0
    const nonHardIntentKeywords = keywordIdeas.filter((kw) => {
      const key = kw.text.toLowerCase()
      const intentInfo = classifyKeywordIntent(kw.text, {
        language: offer.target_language || normalizedLanguageCode,
      })
      intentByKeyword.set(key, intentInfo)

      if (!intentInfo.hardNegative) return true
      hardNegativeFilteredCount++

      if (!excludedKeywordMap.has(key)) {
        excludedKeywordMap.set(key, {
          text: kw.text,
          intent: intentInfo.intent,
          hardNegative: true,
          reasons: intentInfo.reasons,
          stage: 'intent_hard_negative',
        })
      }

      return false
    })

    console.log(
      `✓ 意图分层过滤: 硬否词剔除${hardNegativeFilteredCount}个, 剩余${nonHardIntentKeywords.length}个 (原始${keywordIdeas.length}个)`
    )

    // 用户问题1：过滤地理不匹配的关键词
    const geoAllowedKeywordSet = new Set(
      filterMismatchedGeoKeywords(
        nonHardIntentKeywords.map((kw) => kw.text),
        offer.target_country
      )
    )
    let geoFilteredOutCount = 0
    const geoMatchedKeywords = nonHardIntentKeywords.filter((kw) => {
      if (geoAllowedKeywordSet.has(kw.text)) return true
      geoFilteredOutCount++
      const key = kw.text.toLowerCase()
      const intentInfo = intentByKeyword.get(key) || classifyKeywordIntent(kw.text, {
        language: offer.target_language || normalizedLanguageCode,
      })
      if (!excludedKeywordMap.has(key)) {
        excludedKeywordMap.set(key, {
          text: kw.text,
          intent: intentInfo.intent,
          hardNegative: intentInfo.hardNegative,
          reasons: intentInfo.reasons,
          stage: 'geo_mismatch',
        })
      }
      return false
    })

    console.log(
      `✓ 过滤地理不匹配后剩余${geoMatchedKeywords.length}个关键词（过滤${geoFilteredOutCount}个）`
    )

    // 过滤高质量关键词
    const filteredKeywords = filterHighQualityKeywords(geoMatchedKeywords, {
      minMonthlySearches: filterOptions.minMonthlySearches || 100,
      maxCompetitionIndex: filterOptions.maxCompetitionIndex || 80,
      maxCpcMicros: filterOptions.maxCpcMicros,
      excludeCompetition: filterOptions.excludeCompetition || [],
    })

    console.log(`✓ 过滤后剩余${filteredKeywords.length}个高质量关键词`)

    // 按相关性排序
    const rankedKeywords = rankKeywordsByRelevance(filteredKeywords, {
      brand: offer.brand,
      category: offer.category,
      productName: offer.product_name,
    })

    const intentPriority: Record<string, number> = {
      TRANSACTIONAL: 4,
      COMMERCIAL: 3,
      OTHER: 2,
      SUPPORT: 1,
      DOWNLOAD: 1,
      JOBS: 1,
      PIRACY: 1,
    }

    const rankedKeywordsByIntent = rankedKeywords
      .map((keyword, index) => {
        const intentInfo = intentByKeyword.get(keyword.text.toLowerCase()) || classifyKeywordIntent(keyword.text, {
          language: offer.target_language || normalizedLanguageCode,
        })
        intentByKeyword.set(keyword.text.toLowerCase(), intentInfo)
        return { keyword, index, intentInfo }
      })
      .sort((a, b) => {
        const priorityDiff = (intentPriority[b.intentInfo.intent] || 0) - (intentPriority[a.intentInfo.intent] || 0)
        if (priorityDiff !== 0) return priorityDiff
        return a.index - b.index
      })
      .map((item) => item.keyword)

    // 按主题分组
    const groupedKeywords = groupKeywordsByTheme(rankedKeywordsByIntent)

    // 格式化返回数据
    const currency = offer.target_country === 'CN' ? 'CNY' : 'USD'

    const formattedKeywords = rankedKeywordsByIntent.slice(0, 50).map(kw => {
      const intentInfo = intentByKeyword.get(kw.text.toLowerCase()) || classifyKeywordIntent(kw.text, {
        language: offer.target_language || normalizedLanguageCode,
      })
      return {
      text: kw.text,
      avgMonthlySearches: kw.avgMonthlySearches,
      avgMonthlySearchesFormatted: formatSearchVolume(kw.avgMonthlySearches),
      competition: kw.competition,
      competitionIndex: kw.competitionIndex,
      lowTopOfPageBid: formatCpcMicros(kw.lowTopOfPageBidMicros, currency),
      highTopOfPageBid: formatCpcMicros(kw.highTopOfPageBidMicros, currency),
      avgTopOfPageBid: formatCpcMicros(
        (kw.lowTopOfPageBidMicros + kw.highTopOfPageBidMicros) / 2,
        currency
      ),
      lowTopOfPageBidMicros: kw.lowTopOfPageBidMicros,
      highTopOfPageBidMicros: kw.highTopOfPageBidMicros,
        intent: intentInfo.intent,
        hardNegative: intentInfo.hardNegative,
        intentReasons: intentInfo.reasons,
        recommendedMatchType: recommendMatchTypeForKeyword({
          keyword: kw.text,
          brandName: offer.brand,
          intent: intentInfo.intent,
        }),
      }
    })

    // 分组统计
    const groupStats = Object.entries(groupedKeywords).map(([theme, keywords]) => ({
      theme,
      count: keywords.length,
      topKeywords: keywords.slice(0, 3).map(kw => kw.text),
    }))

    return NextResponse.json({
      success: true,
      keywords: formattedKeywords,
      total: rankedKeywordsByIntent.length,
      filtered: filteredKeywords.length,
      original: keywordIdeas.length,
      hardNegativeFiltered: hardNegativeFilteredCount,
      geoFiltered: geoFilteredOutCount,
      excludedKeywords: Array.from(excludedKeywordMap.values()),
      groupStats,
      offer: {
        id: offer.id,
        brand: offer.brand,
        targetCountry: offer.target_country,
        targetLanguage: offer.target_language,
      },
      filterOptions: {
        minMonthlySearches: filterOptions.minMonthlySearches || 100,
        maxCompetitionIndex: filterOptions.maxCompetitionIndex || 80,
      },
      googleSuggestCount: googleSuggestKeywords.length,
    })
  } catch (error: any) {
    console.error('获取关键词建议失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取关键词建议失败',
        details: error.stack || '',
      },
      { status: 500 }
    )
  }
}
