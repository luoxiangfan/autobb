/**
 * 增强的关键词提取器 (P0优化)
 *
 * 功能：
 * 1. 5层关键词提取（品牌、核心、意图、长尾、竞争对手）
 * 2. 多维度关键词指标（搜索量、CPC、竞争度、趋势、季节性）
 * 3. 多语言变体生成
 * 4. 智能去重和排序
 *
 * 预期效果：
 * - 关键词数量：20-30 → 30-50
 * - 关键词相关性：75% → 95%
 * - 覆盖所有购买阶段
 */

import { getKeywordSearchVolumes } from './keyword-planner'
import { getUserAuthType } from './google-ads-oauth'
import { getHighIntentKeywords } from './google-suggestions'

export interface EnhancedKeyword {
  keyword: string
  searchVolume: number
  cpc: number
  competition: 'low' | 'medium' | 'high'
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
  category: 'brand' | 'core' | 'intent' | 'longtail' | 'competitor'
  source: string
  variants: string[]
  trend: 'rising' | 'stable' | 'declining'
  seasonality: number  // 0-1，季节性指数
  confidence: number   // 0-1，置信度
  estimatedCTR?: number
  estimatedConversionRate?: number
}

export interface KeywordExtractionInput {
  productName: string
  brandName: string
  category: string
  description: string
  features: string[]
  useCases: string[]
  targetAudience: string
  competitors: string[]
  targetCountry: string
  targetLanguage: string
}

function normalizeEvidencePhrase(raw: string, maxTokens = 4): string | null {
  const normalized = String(raw || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return null

  const tokens = normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token.length >= 2 || /\d/.test(token))
    .filter((token) => !/^(with|for|and|the|a|an|in|on|of|to|by|from|new|best|top|sale|deal|discount|shop|buy)$/i.test(token))
    .slice(0, maxTokens)

  if (tokens.length === 0) return null
  return tokens.join(' ')
}

/**
 * 增强的关键词提取
 */
export async function extractKeywordsEnhanced(
  input: KeywordExtractionInput,
  userId: number
): Promise<EnhancedKeyword[]> {
  const {
    productName,
    brandName,
    category,
    description,
    features,
    useCases,
    targetAudience,
    competitors,
    targetCountry,
    targetLanguage,
  } = input

  console.log('🔍 开始增强的关键词提取...')

  try {
    // 第1层：品牌关键词（8-10个）
    console.log('📌 提取品牌关键词...')
    const brandKeywords = await extractBrandKeywords(
      brandName,
      category,
      targetCountry,
      targetLanguage
    )

    // 第2层：产品核心词（6-8个）
    console.log('📌 提取产品核心词...')
    const coreKeywords = await extractCoreKeywords(
      productName,
      category,
      features,
      targetCountry,
      targetLanguage
    )

    // 第3层：购买意图词（3-5个）
    console.log('📌 提取购买意图词...')
    const intentKeywords = await extractIntentKeywords(
      category,
      targetCountry,
      targetLanguage,
      brandName
    )

    // 第4层：长尾精准词（3-7个）
    console.log('📌 提取长尾精准词...')
    const longtailKeywords = await extractLongtailKeywords(
      features,
      useCases,
      targetAudience,
      targetCountry,
      targetLanguage
    )

    // 第5层：竞争对手词（2-4个）
    console.log('📌 提取竞争对手词...')
    const competitorKeywords = await extractCompetitorKeywords(
      competitors,
      targetCountry,
      targetLanguage
    )

    // 合并所有关键词
    let allKeywords = [
      ...brandKeywords,
      ...coreKeywords,
      ...intentKeywords,
      ...longtailKeywords,
      ...competitorKeywords,
    ]

    // 去重
    console.log('🔄 执行关键词去重...')
    allKeywords = deduplicateKeywords(allKeywords)

    // 查询搜索量和竞争度
    console.log('📊 查询关键词指标...')
    const withMetrics = await enrichKeywordsWithMetrics(
      allKeywords,
      targetCountry,
      targetLanguage,
      userId
    )

    // 过滤和排序
    console.log('⚙️ 过滤和排序关键词...')
    const filtered = filterAndRankKeywords(withMetrics, {
      minSearchVolume: 100,  // 降低阈值以支持小众产品
      maxCPC: 50,
    })

    // 生成多语言变体
    console.log('🌍 生成多语言变体...')
    const withVariants = await generateKeywordVariants(
      filtered,
      targetLanguage
    )

    console.log(`✅ 关键词提取完成，共${withVariants.length}个关键词`)
    return withVariants

  } catch (error) {
    console.error('❌ 关键词提取失败:', error)
    throw error
  }
}

/**
 * 提取品牌关键词（8-10个）
 */
async function extractBrandKeywords(
  brandName: string,
  category: string,
  targetCountry: string,
  targetLanguage: string
): Promise<Partial<EnhancedKeyword>[]> {
  const normalizedBrand = normalizeEvidencePhrase(brandName, 3)
  if (!normalizedBrand) return []

  const output: Partial<EnhancedKeyword>[] = [
    {
      keyword: normalizedBrand,
      category: 'brand',
      source: 'brand_name',
      priority: 'HIGH',
    },
  ]

  const categoryPhrase = normalizeEvidencePhrase(category, 3)
  if (categoryPhrase && categoryPhrase !== normalizedBrand) {
    output.push({
      keyword: `${normalizedBrand} ${categoryPhrase}`,
      category: 'brand',
      source: 'brand_category',
      priority: 'HIGH',
    })
  }

  return output
}

/**
 * 提取产品核心词（6-8个）
 */
async function extractCoreKeywords(
  productName: string,
  category: string,
  features: string[],
  targetCountry: string,
  targetLanguage: string
): Promise<Partial<EnhancedKeyword>[]> {
  const keywords: Partial<EnhancedKeyword>[] = []
  const categoryPhrase = normalizeEvidencePhrase(category, 4)
  if (categoryPhrase) {
    keywords.push({
      keyword: categoryPhrase,
      category: 'core',
      source: 'category',
      priority: 'HIGH',
    })
  }
  const productPhrase = normalizeEvidencePhrase(productName, 5)
  if (productPhrase) {
    keywords.push({
      keyword: productPhrase,
      category: 'core',
      source: 'product_name',
      priority: 'HIGH',
    })
  }

  // 仅从证据文本提取，不做模板拼接
  const featurePhrase = normalizeEvidencePhrase(features?.[0] || '', 4)
  if (featurePhrase) {
    keywords.push({
      keyword: featurePhrase,
      category: 'core',
      source: 'feature_phrase',
      priority: 'MEDIUM',
    })
  }

  return keywords
}

/**
 * 提取购买意图词（3-5个）
 */
async function extractIntentKeywords(
  category: string,
  targetCountry: string,
  targetLanguage: string,
  brandName?: string
): Promise<Partial<EnhancedKeyword>[]> {
  const normalizedBrand = normalizeEvidencePhrase(brandName || '', 3)
  if (!normalizedBrand) return []

  const categoryTokens = new Set(
    (normalizeEvidencePhrase(category, 3) || '')
      .split(/\s+/)
      .filter(Boolean)
  )
  const brandTokenSet = new Set(normalizedBrand.split(/\s+/).filter(Boolean))

  try {
    const candidates = await getHighIntentKeywords({
      brand: normalizedBrand,
      country: targetCountry,
      language: targetLanguage,
      useProxy: true,
    })

    const results = new Map<string, Partial<EnhancedKeyword>>()
    for (const rawKeyword of candidates) {
      const normalized = normalizeEvidencePhrase(rawKeyword, 6)
      if (!normalized) continue
      const tokens = normalized.split(/\s+/).filter(Boolean)
      const hasBrandAnchor = tokens.some((token) => brandTokenSet.has(token))
      const hasCategoryAnchor = tokens.some((token) => categoryTokens.has(token))
      if (!hasBrandAnchor && !hasCategoryAnchor) continue

      results.set(normalized, {
        keyword: normalized,
        category: 'intent',
        source: 'intent_google_suggest',
        priority: hasBrandAnchor ? 'HIGH' : 'MEDIUM',
      })
    }

    return Array.from(results.values()).slice(0, 8)
  } catch (error) {
    console.warn('⚠️ 意图词扩展失败，跳过建议词:', error)
    return []
  }
}

/**
 * 提取长尾精准词（3-7个）
 */
async function extractLongtailKeywords(
  features: string[],
  useCases: string[],
  targetAudience: string,
  targetCountry: string,
  targetLanguage: string
): Promise<Partial<EnhancedKeyword>[]> {
  const keywords: Partial<EnhancedKeyword>[] = []

  const featurePhrase = normalizeEvidencePhrase(features?.[0] || '', 5)
  if (featurePhrase) {
    keywords.push({
      keyword: featurePhrase,
      category: 'longtail',
      source: 'feature_longtail_phrase',
      priority: 'LOW',
    })
  }

  const useCasePhrase = normalizeEvidencePhrase(useCases?.[0] || '', 5)
  if (useCasePhrase) {
    keywords.push({
      keyword: useCasePhrase,
      category: 'longtail',
      source: 'usecase_phrase',
      priority: 'LOW',
    })
  }

  const audiencePhrase = normalizeEvidencePhrase(targetAudience || '', 5)
  if (audiencePhrase) {
    keywords.push({
      keyword: audiencePhrase,
      category: 'longtail',
      source: 'audience_phrase',
      priority: 'LOW',
    })
  }

  return keywords
}

/**
 * 提取竞争对手词（2-4个）
 */
async function extractCompetitorKeywords(
  competitors: string[],
  targetCountry: string,
  targetLanguage: string
): Promise<Partial<EnhancedKeyword>[]> {
  if (!competitors || competitors.length === 0) {
    return []
  }

  return competitors
    .map((competitor) => normalizeEvidencePhrase(competitor, 4))
    .filter((keyword): keyword is string => Boolean(keyword))
    .slice(0, 3)
    .map((keyword) => ({
      keyword,
      category: 'competitor' as const,
      source: 'competitor_name',
      priority: 'LOW' as const,
    }))
}

/**
 * 关键词去重
 */
function deduplicateKeywords(
  keywords: Partial<EnhancedKeyword>[]
): Partial<EnhancedKeyword>[] {
  const seen = new Set<string>()
  return keywords.filter((kw) => {
    const lower = (kw.keyword || '').toLowerCase()
    if (seen.has(lower)) {
      return false
    }
    seen.add(lower)
    return true
  })
}

/**
 * 使用关键词指标丰富关键词
 * 利用 getKeywordSearchVolumes 返回的完整 KeywordVolume 数据
 */
async function enrichKeywordsWithMetrics(
  keywords: Partial<EnhancedKeyword>[],
  targetCountry: string,
  targetLanguage: string,  // 添加语言参数
  userId: number
): Promise<EnhancedKeyword[]> {
  const keywordTexts = keywords.map((kw) => kw.keyword || '').filter(Boolean)

  try {
    // 🔧 修复(2025-12-26): 支持服务账号模式
    const auth = await getUserAuthType(userId)
    const volumes = await getKeywordSearchVolumes(
      keywordTexts,
      targetCountry,
      targetLanguage,
      userId,
      auth.authType,
      auth.serviceAccountId
    )

    // 创建keyword到volume的映射
    const volumeMap = new Map(volumes.map(v => [v.keyword.toLowerCase(), v]))

    return keywords.map((kw) => {
      const kwLower = (kw.keyword || '').toLowerCase()
      const volumeData = volumeMap.get(kwLower)

      // 从 KeywordVolume 数据中提取指标
      const avgCpc = volumeData
        ? (volumeData.lowTopPageBid + volumeData.highTopPageBid) / 2 / 1000000 // 转换为美元
        : 1.0

      // 将competition字符串转换为我们的格式
      const competitionLevel = volumeData?.competition?.toLowerCase() || 'medium'
      const competition = competitionLevel === 'low' || competitionLevel === 'high'
        ? competitionLevel as 'low' | 'high'
        : 'medium' as const

      return {
        keyword: kw.keyword || '',
        searchVolume: volumeData?.avgMonthlySearches || 0,
        cpc: avgCpc,
        competition,
        priority: kw.priority || 'MEDIUM',
        category: kw.category || 'core',
        source: kw.source || 'unknown',
        variants: [],
        trend: 'stable' as const,
        seasonality: 0.5,
        confidence: volumeData ? 0.9 : 0.5,
        estimatedCTR: undefined,
        estimatedConversionRate: undefined,
      }
    })
  } catch (error) {
    console.warn('⚠️ 查询关键词指标失败，使用默认值:', error)
    return keywords.map((kw) => ({
      keyword: kw.keyword || '',
      searchVolume: 1000,
      cpc: 1.0,
      competition: 'medium' as const,
      priority: kw.priority || 'MEDIUM',
      category: kw.category || 'core',
      source: kw.source || 'unknown',
      variants: [],
      trend: 'stable' as const,
      seasonality: 0.5,
      confidence: 0.5,
    }))
  }
}

/**
 * 过滤和排序关键词
 */
function filterAndRankKeywords(
  keywords: EnhancedKeyword[],
  options: {
    minSearchVolume?: number
    maxCPC?: number
  }
): EnhancedKeyword[] {
  const { minSearchVolume = 100, maxCPC = 50 } = options

  // 🔧 修复(2025-12-26): 服务账号模式下无法获取搜索量，跳过过滤
  const hasAnyVolume = keywords.some(kw => kw.searchVolume > 0)

  return keywords
    .filter((kw) => {
      // 如果没有搜索量数据，跳过搜索量过滤
      if (!hasAnyVolume) return kw.cpc <= maxCPC
      return kw.searchVolume >= minSearchVolume && kw.cpc <= maxCPC
    })
    .sort((a, b) => {
      // 按优先级排序
      const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 }
      const priorityDiff =
        (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2)
      if (priorityDiff !== 0) return priorityDiff

      // 按搜索量排序
      return b.searchVolume - a.searchVolume
    })
}

/**
 * 生成多语言变体
 */
async function generateKeywordVariants(
  keywords: EnhancedKeyword[],
  targetLanguage: string
): Promise<EnhancedKeyword[]> {
  // 如果是英文，不需要生成变体
  if (targetLanguage === 'en') {
    return keywords
  }

  // 对于其他语言，可以生成变体
  // 这里简化处理，实际应该调用翻译API
  return keywords.map((kw) => ({
    ...kw,
    variants: [kw.keyword], // 简化处理
  }))
}

export {
  extractBrandKeywords,
  extractCoreKeywords,
  extractIntentKeywords,
  extractLongtailKeywords,
  extractCompetitorKeywords,
}
