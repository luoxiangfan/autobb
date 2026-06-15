import {
  getKeywordSearchVolumesForPlannerContext,
  loadKeywordPoolExpandCredentialsForOffer,
  type KeywordPlannerPreparedSession,
} from '@/lib/google-ads/accounts/auth/index'
import { normalizeLanguageCode } from '../../language-country-codes'

export async function calculateBrandSearchVolume(
  brandName: string | undefined,
  targetCountry: string,
  targetLanguage: string,
  userId?: number,
  keywordsWithVolume?: Array<{
    keyword: string
    searchVolume: number
    volumeUnavailableReason?: 'DEV_TOKEN_INSUFFICIENT_ACCESS' | 'DEV_TOKEN_TEST_ONLY'
  }>,
  offerId?: number,
  plannerSession?: KeywordPlannerPreparedSession,
  skipKeywordPoolExpandLoad?: boolean
) {
  const isSearchVolumeUnavailableReason = (
    reason: unknown
  ): reason is 'DEV_TOKEN_INSUFFICIENT_ACCESS' | 'DEV_TOKEN_TEST_ONLY' =>
    reason === 'DEV_TOKEN_INSUFFICIENT_ACCESS' || reason === 'DEV_TOKEN_TEST_ONLY'

  const calculateUnavailableProxyScore = (
    totalKeywords: number,
    brandKeywordsCount: number,
    hasExactBrandKeyword: boolean
  ): number => {
    if (totalKeywords <= 0) return 3
    if (brandKeywordsCount <= 0) return 2

    const coverage = brandKeywordsCount / Math.max(1, totalKeywords)
    let score = 3
    if (brandKeywordsCount >= 1) score += 2
    if (brandKeywordsCount >= 3) score += 2
    if (brandKeywordsCount >= 5) score += 1
    if (hasExactBrandKeyword) score += 2
    if (coverage >= 0.8) score += 2
    else if (coverage >= 0.5) score += 1
    return Math.min(12, Math.max(2, score))
  }

  // 如果没有品牌名称，返回0分
  if (!brandName || brandName.trim() === '') {
    console.log('⚠️ 未提供品牌名称，品牌搜索量得分为0')
    return {
      score: 0,
      weight: 0.2 as const,
      details: {
        brandNameSearchVolume: 0,
        brandKeywordSearchVolume: 0,
        totalBrandSearchVolume: 0,
        volumeLevel: 'micro' as const,
        dataSource: 'unavailable' as const,
      },
    }
  }

  try {
    const normalizedBrandName = brandName.trim().toLowerCase()
    const normalizedKeywordsWithVolume = Array.isArray(keywordsWithVolume) ? keywordsWithVolume : []
    const brandKeywords = normalizedKeywordsWithVolume.filter((kw) => {
      const keywordLower = String(kw.keyword || '').toLowerCase()
      return keywordLower.includes(normalizedBrandName) && keywordLower !== normalizedBrandName
    })
    const brandKeywordsCount = brandKeywords.length
    const brandKeywordSearchVolume = brandKeywords.reduce(
      (sum, kw) => sum + (kw.searchVolume || 0),
      0
    )
    const exactBrandKeywordSearchVolume = normalizedKeywordsWithVolume
      .filter((kw) => String(kw.keyword || '').toLowerCase() === normalizedBrandName)
      .reduce((sum, kw) => sum + (kw.searchVolume || 0), 0)
    const hasExactBrandKeyword = normalizedKeywordsWithVolume.some(
      (kw) => String(kw.keyword || '').toLowerCase() === normalizedBrandName
    )
    const keywordCoverage =
      normalizedKeywordsWithVolume.length > 0
        ? brandKeywordsCount / normalizedKeywordsWithVolume.length
        : 0
    const keywordVolumeUnavailable = normalizedKeywordsWithVolume.some((kw) =>
      isSearchVolumeUnavailableReason(kw.volumeUnavailableReason)
    )

    // ========================================
    // 1. 计算品牌名搜索量（brandNameSearchVolume）
    // ========================================
    const normalizedLanguage = normalizeLanguageCode(targetLanguage)

    const exactBrandKeywordEntry = normalizedKeywordsWithVolume.find(
      (kw) => String(kw.keyword || '').toLowerCase() === normalizedBrandName
    )
    const exactBrandVolumeMarkedUnavailable =
      exactBrandKeywordEntry != null &&
      isSearchVolumeUnavailableReason(exactBrandKeywordEntry.volumeUnavailableReason)
    const canReuseExactBrandVolume = hasExactBrandKeyword && !exactBrandVolumeMarkedUnavailable

    let resolvedPlannerSession = plannerSession
    let plannerUnavailableReason:
      | 'DEV_TOKEN_INSUFFICIENT_ACCESS'
      | 'DEV_TOKEN_TEST_ONLY'
      | undefined
    let hasPlannerData = false
    let dataSource: 'keyword_planner' | 'cached' | 'database' | 'unavailable' = 'unavailable'
    let resolvedBrandNameSearchVolume = 0
    let fallbackMode: 'none' | 'exact_brand_keyword_backfill' = 'none'

    if (canReuseExactBrandVolume) {
      resolvedBrandNameSearchVolume = exactBrandKeywordSearchVolume
      hasPlannerData = true
      dataSource = 'database'
      console.log(
        `♻️ 使用创意内精确品牌词搜索量，跳过品牌名 Planner 查询: ${exactBrandKeywordSearchVolume.toLocaleString()}/月`
      )
    } else {
      if (!resolvedPlannerSession && userId && offerId && !skipKeywordPoolExpandLoad) {
        const expandLoad = await loadKeywordPoolExpandCredentialsForOffer(userId, offerId)
        if (expandLoad.ok) {
          resolvedPlannerSession = expandLoad.plannerSession
        }
      }

      if (skipKeywordPoolExpandLoad) {
        hasPlannerData = false
        resolvedBrandNameSearchVolume = 0
        dataSource = 'unavailable'
        if (!plannerUnavailableReason) {
          const unavailableFromKeywords = normalizedKeywordsWithVolume.find((kw) =>
            isSearchVolumeUnavailableReason(kw.volumeUnavailableReason)
          )?.volumeUnavailableReason
          plannerUnavailableReason = isSearchVolumeUnavailableReason(unavailableFromKeywords)
            ? unavailableFromKeywords
            : 'DEV_TOKEN_INSUFFICIENT_ACCESS'
        }
        console.log('♻️ expand 预加载已失败，跳过品牌名 Planner 查询')
      } else if (userId) {
        const volumeResult = await getKeywordSearchVolumesForPlannerContext({
          userId,
          offerId,
          keywords: [brandName],
          country: targetCountry,
          language: normalizedLanguage,
          plannerSession: resolvedPlannerSession,
        })
        const volumeResults = volumeResult.ok
          ? volumeResult.volumes
          : [
              {
                avgMonthlySearches: 0,
                volumeUnavailableReason: 'DEV_TOKEN_INSUFFICIENT_ACCESS' as const,
              },
            ]

        const brandVolume = volumeResults[0]
        plannerUnavailableReason = isSearchVolumeUnavailableReason(
          (brandVolume as any)?.volumeUnavailableReason
        )
          ? ((brandVolume as any).volumeUnavailableReason as
              | 'DEV_TOKEN_INSUFFICIENT_ACCESS'
              | 'DEV_TOKEN_TEST_ONLY')
          : undefined
        hasPlannerData =
          typeof brandVolume?.avgMonthlySearches === 'number' && !plannerUnavailableReason
        const brandNameSearchVolume = hasPlannerData ? brandVolume?.avgMonthlySearches || 0 : 0

        dataSource = hasPlannerData ? 'keyword_planner' : 'unavailable'
        if (hasPlannerData && brandNameSearchVolume > 0) {
          dataSource = 'cached'
        }

        resolvedBrandNameSearchVolume = brandNameSearchVolume
      }

      const shouldBackfillExactBrandVolume =
        !hasPlannerData &&
        Boolean(
          plannerUnavailableReason || keywordVolumeUnavailable || skipKeywordPoolExpandLoad
        ) &&
        exactBrandKeywordSearchVolume > 0
      if (shouldBackfillExactBrandVolume) {
        resolvedBrandNameSearchVolume = exactBrandKeywordSearchVolume
        dataSource = 'database'
        fallbackMode = 'exact_brand_keyword_backfill'
        console.log(
          `♻️ Planner不可用，回填精确品牌词搜索量: ${exactBrandKeywordSearchVolume.toLocaleString()}/月`
        )
      }
    }

    if (normalizedKeywordsWithVolume.length > 0) {
      console.log(`🏷️ 品牌关键词: 发现${brandKeywordsCount}个包含"${brandName}"的关键词`)
      console.log(`   品牌关键词搜索量: ${brandKeywordSearchVolume.toLocaleString()}/月`)
    } else {
      console.log('⚠️ 未提供keywordsWithVolume，跳过品牌关键词搜索量计算')
    }

    // ========================================
    // 3. 计算总分（品牌名搜索量 + 品牌关键词搜索量）
    // ========================================
    const totalBrandSearchVolume = resolvedBrandNameSearchVolume + brandKeywordSearchVolume
    const volumeUnavailable = Boolean(
      plannerUnavailableReason || keywordVolumeUnavailable || skipKeywordPoolExpandLoad
    )
    if (volumeUnavailable && totalBrandSearchVolume <= 0) {
      const proxyScore = calculateUnavailableProxyScore(
        normalizedKeywordsWithVolume.length,
        brandKeywordsCount,
        hasExactBrandKeyword
      )
      console.log(`⚠️ 品牌搜索量不可用，使用品牌信号代理评分: ${proxyScore}分`)
      return {
        score: proxyScore,
        weight: 0.2 as const,
        details: {
          brandNameSearchVolume: 0,
          brandKeywordSearchVolume: 0,
          exactBrandKeywordSearchVolume,
          totalBrandSearchVolume: 0,
          volumeLevel: 'micro' as const,
          dataSource: 'unavailable' as const,
          fallbackMode: 'brand_signal_proxy' as const,
          plannerUnavailableReason,
          brandKeywordCount: brandKeywordsCount,
          brandKeywordCoverage: Math.round(keywordCoverage * 100) / 100,
        },
      }
    }

    console.log(`📊 品牌"${brandName}"搜索量分析:`)
    console.log(`   品牌名搜索量: ${resolvedBrandNameSearchVolume.toLocaleString()}/月`)
    console.log(`   品牌关键词搜索量: ${brandKeywordSearchVolume.toLocaleString()}/月`)
    console.log(`   总计: ${totalBrandSearchVolume.toLocaleString()}/月`)

    // 根据总搜索量确定流量级别和分数（对数缩放）
    let volumeLevel: 'micro' | 'small' | 'medium' | 'large' | 'xlarge'
    let score: number

    if (totalBrandSearchVolume >= 100001) {
      // xlarge: 100001+ → 18-20分
      volumeLevel = 'xlarge'
      if (totalBrandSearchVolume >= 1000001) {
        score = 20
      } else if (totalBrandSearchVolume >= 500001) {
        score = 19
      } else {
        score = 18
      }
    } else if (totalBrandSearchVolume >= 10001) {
      // large: 10001-100000 → 13-17分
      volumeLevel = 'large'
      const logMin = Math.log10(10001)
      const logMax = Math.log10(100000)
      const logValue = Math.log10(totalBrandSearchVolume)
      const ratio = (logValue - logMin) / (logMax - logMin)
      score = Math.round(13 + ratio * 4)
    } else if (totalBrandSearchVolume >= 1001) {
      // medium: 1001-10000 → 8-12分
      volumeLevel = 'medium'
      const logMin = Math.log10(1001)
      const logMax = Math.log10(10000)
      const logValue = Math.log10(totalBrandSearchVolume)
      const ratio = (logValue - logMin) / (logMax - logMin)
      score = Math.round(8 + ratio * 4)
    } else if (totalBrandSearchVolume >= 100) {
      // small: 100-1000 → 4-7分
      volumeLevel = 'small'
      const logMin = Math.log10(100)
      const logMax = Math.log10(1000)
      const logValue = Math.log10(totalBrandSearchVolume)
      const ratio = (logValue - logMin) / (logMax - logMin)
      score = Math.round(4 + ratio * 3)
    } else if (totalBrandSearchVolume >= 10) {
      // micro-high: 10-99 → 2-3分
      volumeLevel = 'micro'
      score = totalBrandSearchVolume >= 50 ? 3 : 2
    } else if (totalBrandSearchVolume >= 1) {
      // micro-low: 1-9 → 1分
      volumeLevel = 'micro'
      score = 1
    } else {
      // zero: 0
      // KISS: 不再默认给中等分，避免“数据不可用”误抬分
      volumeLevel = 'micro'
      score = 0
    }

    console.log(`   流量级别: ${volumeLevel}, 评分: ${score}分`)

    return {
      score,
      weight: 0.2 as const,
      details: {
        brandNameSearchVolume: resolvedBrandNameSearchVolume,
        brandKeywordSearchVolume,
        exactBrandKeywordSearchVolume,
        totalBrandSearchVolume,
        volumeLevel,
        dataSource,
        fallbackMode,
        plannerUnavailableReason,
        brandKeywordCount: brandKeywordsCount,
        brandKeywordCoverage: Math.round(keywordCoverage * 100) / 100,
      },
    }
  } catch (error) {
    console.error(`❌ 获取品牌搜索量失败:`, error)
    return {
      score: 0,
      weight: 0.2 as const,
      details: {
        brandNameSearchVolume: 0,
        brandKeywordSearchVolume: 0,
        totalBrandSearchVolume: 0,
        volumeLevel: 'micro' as const,
        dataSource: 'unavailable' as const,
      },
    }
  }
}
