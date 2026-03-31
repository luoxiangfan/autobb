import { getCustomerWithCredentials, getGoogleAdsCredentialsFromDB } from './google-ads-api'
import { getGoogleAdsCredentials } from './google-ads-oauth'
import { getLoginCustomerId, AuthType } from './google-ads-service-account'
import { trackApiUsage, ApiOperationType } from './google-ads-api-tracker'
import { getGoogleAdsLanguageCode, getGoogleAdsGeoTargetId } from './language-country-codes'

/**
 * 🔧 修复(2025-12-24): 获取 KeywordPlanIdeaService
 * OAuth 模式使用 customer.keywordPlanIdeas
 * 服务账号模式使用 customer.loadService('KeywordPlanIdeaServiceClient')
 */
function getKeywordPlanIdeaService(customer: any, authType: AuthType | undefined) {
  if (authType === 'service_account') {
    // 服务账号模式：使用 loadService 动态加载服务
    // 注意：@htdangkhoa/google-ads 库的服务名需要加上 Client 后缀
    return customer.loadService('KeywordPlanIdeaServiceClient')
  } else {
    // OAuth 模式：直接访问 keywordPlanIdeas 属性
    return customer.keywordPlanIdeas
  }
}

/**
 * 关键词建议结果
 */
export interface KeywordIdea {
  text: string
  avgMonthlySearches: number
  competition: 'LOW' | 'MEDIUM' | 'HIGH'
  competitionIndex: number // 0-100
  lowTopOfPageBidMicros: number
  highTopOfPageBidMicros: number
  keyword_annotations?: {
    concepts?: Array<{ name: string; concept_group: { name: string; type: string } }>
  }
}

/**
 * 关键词指标数据
 */
export interface KeywordMetrics {
  keyword: string
  avgMonthlySearches: number
  competition: 'LOW' | 'MEDIUM' | 'HIGH'
  competitionIndex: number
  lowTopOfPageBidMicros: number
  highTopOfPageBidMicros: number
  yearOverYearChange?: number
  threeMonthChange?: number
}

/**
 * 获取关键词建议
 * 基于种子关键词和URL生成关键词创意
 */
export async function getKeywordIdeas(params: {
  customerId: string
  refreshToken?: string  // OAuth模式需要，服务账号模式不需要
  seedKeywords?: string[]
  pageUrl?: string
  targetCountry: string
  targetLanguage: string
  accountId?: number
  userId: number
  // 认证类型（默认oauth）
  authType?: AuthType
  // 服务账号ID（当authType='service_account'时需要）
  serviceAccountId?: string
}): Promise<KeywordIdea[]> {
  if (!params.userId) {
    throw new Error('userId is required')
  }

  const authType = params.authType || 'oauth'

  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (authType === 'service_account') {
    const { getKeywordIdeasPython } = await import('./python-ads-client')

    const result = await getKeywordIdeasPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      keywords: params.seedKeywords || [],
      language: getLanguageCode(params.targetLanguage),
      geoTargetConstants: [getGeoTargetConstant(params.targetCountry)],
      pageUrl: params.pageUrl,
    })

    return result.results.map((idea: any) => ({
      text: idea.text,
      avgMonthlySearches: idea.keyword_idea_metrics?.avg_monthly_searches || 0,
      competition: mapCompetition(idea.keyword_idea_metrics?.competition),
      competitionIndex: idea.keyword_idea_metrics?.competition_index || 0,
      lowTopOfPageBidMicros: idea.keyword_idea_metrics?.low_top_of_page_bid_micros || 0,
      highTopOfPageBidMicros: idea.keyword_idea_metrics?.high_top_of_page_bid_micros || 0,
    }))
  }

  // OAuth模式：使用原有逻辑
  const creds = await getGoogleAdsCredentialsFromDB(params.userId)
  const credentials = {
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    developer_token: creds.developer_token
  }

  // OAuth模式：获取 refresh_token
  const oauthCredentials = await getGoogleAdsCredentials(params.userId)
  if (!oauthCredentials?.refresh_token) {
    throw new Error('OAuth refresh token not found')
  }

  const loginCustomerId = await getLoginCustomerId({
    authConfig: {
      authType,
      userId: params.userId,
      serviceAccountId: params.serviceAccountId
    },
    oauthCredentials: { login_customer_id: creds.login_customer_id }
  })

  // 使用统一入口获取 Customer 实例
  const customer = await getCustomerWithCredentials({
    customerId: params.customerId,
    refreshToken: oauthCredentials.refresh_token,
    userId: params.userId,
    loginCustomerId,
    authType,
    serviceAccountId: params.serviceAccountId,
  })

  // API追踪
  const startTime = Date.now()
  let success = false
  let errorMessage: string | undefined

  try {
    // 🔧 修复(2025-12-16): Google Ads API限制每次请求最多20个种子关键词
    // 需要分批处理
    const BATCH_SIZE = 20
    const allKeywordIdeas: KeywordIdea[] = []

    // 将种子词分批
    const seedBatches: string[][] = []
    if (params.seedKeywords && params.seedKeywords.length > 0) {
      for (let i = 0; i < params.seedKeywords.length; i += BATCH_SIZE) {
        seedBatches.push(params.seedKeywords.slice(i, i + BATCH_SIZE))
      }
    } else {
      // 如果没有种子词，创建一个空批次（用于URL种子）
      seedBatches.push([])
    }

    console.log(`   📦 种子词分批: ${params.seedKeywords?.length || 0} 个词 → ${seedBatches.length} 批`)

    for (let batchIndex = 0; batchIndex < seedBatches.length; batchIndex++) {
      const batch = seedBatches[batchIndex]

      // 构建Keyword Ideas请求
      const request: any = {
        customer_id: params.customerId,
        language: getLanguageCode(params.targetLanguage),
        geo_target_constants: [getGeoTargetConstant(params.targetCountry)],
        include_adult_keywords: false,
      }

      // ✅ 正确实现 Keyword Planner 的 "keywords + site filter"
      // GenerateKeywordIdeasRequest 的 seed 是 oneof：
      // - keyword_seed
      // - url_seed
      // - keyword_and_url_seed
      if (params.pageUrl) {
        if (batch.length > 0) {
          request.keyword_and_url_seed = {
            keywords: batch,
            url: params.pageUrl,
          }
        } else if (batchIndex === 0) {
          request.url_seed = { url: params.pageUrl }
        }
      } else if (batch.length > 0) {
        request.keyword_seed = { keywords: batch }
      }

      // 跳过既没有种子词也没有URL的请求
      if (!request.keyword_seed && !request.url_seed && !request.keyword_and_url_seed) {
        continue
      }

      // 调用Keyword Planner API
      // 🔧 修复(2025-12-24): 使用统一的服务访问方式
      // 🔧 修复(2025-12-26): gRPC调用需要手动传递metadata（含developer-token）
      const keywordPlanIdeas = getKeywordPlanIdeaService(customer, authType)
      const metadata = (customer as any).callMetadata
      let ideas
      if (metadata) {
        ideas = await keywordPlanIdeas.generateKeywordIdeas(request, metadata)
      } else {
        ideas = await keywordPlanIdeas.generateKeywordIdeas(request)
      }

      // 转换结果格式
      const batchIdeas: KeywordIdea[] = (ideas as any).map((idea: any) => ({
        text: idea.text,
        avgMonthlySearches: idea.keyword_idea_metrics?.avg_monthly_searches || 0,
        competition: mapCompetition(idea.keyword_idea_metrics?.competition),
        competitionIndex: idea.keyword_idea_metrics?.competition_index || 0,
        lowTopOfPageBidMicros: idea.keyword_idea_metrics?.low_top_of_page_bid_micros || 0,
        highTopOfPageBidMicros: idea.keyword_idea_metrics?.high_top_of_page_bid_micros || 0,
        keyword_annotations: idea.keyword_annotations,
      }))

      // 合并结果（去重）
      batchIdeas.forEach(idea => {
        if (!allKeywordIdeas.find(k => k.text.toLowerCase() === idea.text.toLowerCase())) {
          allKeywordIdeas.push(idea)
        }
      })

      console.log(`   📦 批次 ${batchIndex + 1}/${seedBatches.length}: 获取 ${batchIdeas.length} 个关键词，累计 ${allKeywordIdeas.length} 个`)
    }

    success = true
    return allKeywordIdeas
  } catch (error: any) {
    success = false
    errorMessage = error.message
    console.error('获取关键词建议失败:', error)
    throw new Error(`Keyword Planner API调用失败: ${error.message}`)
  } finally {
    // 记录API使用（仅在有userId时追踪）
    if (params.userId) {
      await trackApiUsage({
        userId: params.userId,
        operationType: ApiOperationType.GET_KEYWORD_IDEAS,
        endpoint: 'getKeywordIdeas',
        customerId: params.customerId,
        requestCount: 1,
        responseTimeMs: Date.now() - startTime,
        isSuccess: success,
        errorMessage
      })
    }
  }
}

/**
 * 获取关键词历史指标
 * 用于已知关键词列表的数据分析
 */
export async function getKeywordMetrics(params: {
  customerId: string
  refreshToken?: string  // OAuth模式需要，服务账号模式不需要
  keywords: string[]
  targetCountry: string
  targetLanguage: string
  accountId?: number
  userId: number
  // 认证类型（默认oauth）
  authType?: AuthType
  // 服务账号ID（当authType='service_account'时需要）
  serviceAccountId?: string
}): Promise<KeywordMetrics[]> {
  if (!params.userId) {
    throw new Error('userId is required')
  }

  const authType = params.authType || 'oauth'

  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (authType === 'service_account') {
    const { getKeywordHistoricalMetricsPython } = await import('./python-ads-client')

    const result = await getKeywordHistoricalMetricsPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      keywords: params.keywords,
      language: getLanguageCode(params.targetLanguage),
      geoTargetConstants: [getGeoTargetConstant(params.targetCountry)],
    })

    return result.results.map((metric: any) => ({
      keyword: metric.text,
      avgMonthlySearches: metric.keyword_metrics?.avg_monthly_searches || 0,
      competition: mapCompetition(metric.keyword_metrics?.competition),
      competitionIndex: metric.keyword_metrics?.competition_index || 0,
      lowTopOfPageBidMicros: metric.keyword_metrics?.low_top_of_page_bid_micros || 0,
      highTopOfPageBidMicros: metric.keyword_metrics?.high_top_of_page_bid_micros || 0,
    }))
  }

  // OAuth模式：使用统一入口
  const oauthCredentials = await getGoogleAdsCredentials(params.userId)
  if (!oauthCredentials?.refresh_token) {
    throw new Error('OAuth refresh token not found')
  }

  const customer = await getCustomerWithCredentials({
    customerId: params.customerId,
    refreshToken: oauthCredentials.refresh_token,
    userId: params.userId,
    authType,
    serviceAccountId: params.serviceAccountId,
  })

  // API追踪
  const startTime = Date.now()
  let success = false
  let errorMessage: string | undefined

  try {
    // 构建历史指标请求
    const request = {
      customer_id: params.customerId,
      keywords: params.keywords,
      language: getLanguageCode(params.targetLanguage),
      geo_target_constants: [getGeoTargetConstant(params.targetCountry)],
      include_adult_keywords: false,
    }

    // 调用Historical Metrics API
    // 🔧 修复(2025-12-24): 使用统一的服务访问方式
    // 🔧 修复(2025-12-26): gRPC调用需要手动传递metadata（含developer-token）
    const keywordPlanIdeas = getKeywordPlanIdeaService(customer, authType)
    const metadata = (customer as any).callMetadata
    let metrics
    if (metadata) {
      metrics = await keywordPlanIdeas.generateKeywordHistoricalMetrics(request as any, metadata)
    } else {
      metrics = await keywordPlanIdeas.generateKeywordHistoricalMetrics(request as any)
    }

    // 转换结果格式
    const keywordMetrics: KeywordMetrics[] = (metrics as any).map((metric: any) => ({
      keyword: metric.text,
      avgMonthlySearches: metric.keyword_metrics?.avg_monthly_searches || 0,
      competition: mapCompetition(metric.keyword_metrics?.competition),
      competitionIndex: metric.keyword_metrics?.competition_index || 0,
      lowTopOfPageBidMicros: metric.keyword_metrics?.low_top_of_page_bid_micros || 0,
      highTopOfPageBidMicros: metric.keyword_metrics?.high_top_of_page_bid_micros || 0,
      yearOverYearChange: metric.keyword_metrics?.year_over_year_change,
      threeMonthChange: metric.keyword_metrics?.three_month_change,
    }))

    success = true
    return keywordMetrics
  } catch (error: any) {
    success = false
    errorMessage = error.message
    console.error('获取关键词指标失败:', error)
    throw new Error(`Keyword Metrics API调用失败: ${error.message}`)
  } finally {
    // 记录API使用（仅在有userId时追踪）
    if (params.userId) {
      await trackApiUsage({
        userId: params.userId,
        operationType: ApiOperationType.GET_KEYWORD_IDEAS,
        endpoint: 'getKeywordMetrics',
        customerId: params.customerId,
        requestCount: 1,
        responseTimeMs: Date.now() - startTime,
        isSuccess: success,
        errorMessage
      })
    }
  }
}

/**
 * 过滤高质量关键词
 * 根据搜索量和竞争度筛选
 */
export function filterHighQualityKeywords(
  keywords: KeywordIdea[],
  options: {
    minMonthlySearches?: number
    maxCompetitionIndex?: number
    maxCpcMicros?: number
    excludeCompetition?: Array<'LOW' | 'MEDIUM' | 'HIGH'>
  } = {}
): KeywordIdea[] {
  const {
    minMonthlySearches = 100,
    maxCompetitionIndex = 80,
    maxCpcMicros,
    excludeCompetition = [],
  } = options

  return keywords.filter(kw => {
    // 过滤低搜索量
    if (kw.avgMonthlySearches < minMonthlySearches) {
      return false
    }

    // 过滤高竞争度
    if (kw.competitionIndex > maxCompetitionIndex) {
      return false
    }

    // 过滤指定竞争等级
    if (excludeCompetition.includes(kw.competition)) {
      return false
    }

    // 过滤高CPC
    if (maxCpcMicros && kw.highTopOfPageBidMicros > maxCpcMicros) {
      return false
    }

    return true
  })
}

/**
 * 计算关键词相关性得分
 */
function normalizeTokens(input: string): string[] {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return []

  const stop = new Set([
    'the', 'a', 'an', 'and', 'or', 'for', 'with', 'to', 'of', 'in', 'on', 'by',
    'official', 'store', 'shop', 'website', 'site', 'online',
  ])
  return Array.from(
    new Set(
      cleaned
        .split(' ')
        .map(t => t.trim())
        .filter(Boolean)
        .filter(t => t.length >= 3)
        .filter(t => !stop.has(t))
    )
  )
}

function buildRelevanceContext(context?: { brand?: string; category?: string | null; productName?: string | null }): {
  brand: string
  brandCore: string
  tokens: string[]
} | null {
  const brand = (context?.brand || '').trim()
  if (!brand) return null

  const brandCore = brand.split(/\s+/)[0]?.toLowerCase() || brand.toLowerCase()
  const brandTokens = new Set(normalizeTokens(brand))
  const tokens = Array.from(
    new Set([
      ...normalizeTokens(context?.category || ''),
      ...normalizeTokens(context?.productName || ''),
    ])
  ).filter(t => !brandTokens.has(t))

  return { brand, brandCore, tokens }
}

export function rankKeywordsByRelevance(
  keywords: KeywordIdea[],
  context?: { brand?: string; category?: string | null; productName?: string | null }
): KeywordIdea[] {
  const ctx = buildRelevanceContext(context)
  return keywords.sort((a, b) => {
    const scoreA = calculateRelevanceScore(a, ctx)
    const scoreB = calculateRelevanceScore(b, ctx)
    return scoreB - scoreA
  })
}

function calculateRelevanceScore(
  keyword: KeywordIdea,
  ctx: { brand: string; brandCore: string; tokens: string[] } | null = null
): number {
  // 搜索量得分 (0-40分，归一化到10000月搜索为满分)
  const searchScore = Math.min((keyword.avgMonthlySearches / 10000) * 40, 40)

  // 竞争度得分 (0-30分，竞争度越低分数越高)
  const competitionScore = (100 - keyword.competitionIndex) * 0.3

  // CPC得分 (0-30分，CPC越低分数越高，归一化到$5为基准)
  const avgCpcMicros = (keyword.lowTopOfPageBidMicros + keyword.highTopOfPageBidMicros) / 2
  const cpcScore = Math.max(30 - (avgCpcMicros / 5000000) * 30, 0)

  let relevanceBonus = 0
  if (ctx) {
    const text = keyword.text.toLowerCase()
    const hasBrand = text.includes(ctx.brandCore)
    const hasToken = ctx.tokens.length === 0 ? true : ctx.tokens.some(t => text.includes(t))

    if (hasBrand) relevanceBonus += 8
    if (hasToken) relevanceBonus += 3
    if (!hasBrand && ctx.tokens.length > 0 && !hasToken) relevanceBonus -= 6
  }

  return searchScore + competitionScore + cpcScore + relevanceBonus
}

/**
 * 分组关键词
 * 按主题或意图分组
 */
export function groupKeywordsByTheme(keywords: KeywordIdea[]): {
  [theme: string]: KeywordIdea[]
} {
  const groups: { [theme: string]: KeywordIdea[] } = {
    brand: [],
    product: [],
    comparison: [],
    informational: [],
    transactional: [],
    other: [],
  }

  keywords.forEach(kw => {
    const text = kw.text.toLowerCase()

    // 品牌词
    if (text.includes('official') || text.includes('store') || text.includes('shop')) {
      groups.brand.push(kw)
    }
    // 产品词
    else if (text.includes('buy') || text.includes('price') || text.includes('deal')) {
      groups.product.push(kw)
    }
    // 对比词
    else if (text.includes('vs') || text.includes('compare') || text.includes('alternative')) {
      groups.comparison.push(kw)
    }
    // 信息词
    else if (text.includes('how') || text.includes('what') || text.includes('review')) {
      groups.informational.push(kw)
    }
    // 交易词
    else if (
      text.includes('discount') ||
      text.includes('coupon') ||
      text.includes('sale') ||
      text.includes('free shipping')
    ) {
      groups.transactional.push(kw)
    }
    // 其他
    else {
      groups.other.push(kw)
    }
  })

  return groups
}

/**
 * 获取语言代码
 * 使用全局统一映射，支持40+种语言
 */
function getLanguageCode(language: string): string {
  const languageId = getGoogleAdsLanguageCode(language)
  return `languageConstants/${languageId}`
}

/**
 * 获取地理位置常量
 * 使用全局统一映射，支持60+个国家
 */
function getGeoTargetConstant(country: string): string {
  const geoTargetId = getGoogleAdsGeoTargetId(country)
  return `geoTargetConstants/${geoTargetId}`
}

/**
 * 映射竞争等级
 */
function mapCompetition(competition: string | undefined): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (!competition) return 'LOW'

  const competitionUpper = competition.toUpperCase()
  if (competitionUpper.includes('LOW')) return 'LOW'
  if (competitionUpper.includes('MEDIUM')) return 'MEDIUM'
  if (competitionUpper.includes('HIGH')) return 'HIGH'

  return 'LOW'
}

/**
 * 格式化CPC金额
 */
export function formatCpcMicros(micros: number, currency: 'USD' | 'CNY' = 'USD'): string {
  const amount = micros / 1000000
  const symbol = currency === 'CNY' ? '¥' : '$'
  return `${symbol}${amount.toFixed(2)}`
}

/**
 * 格式化搜索量
 */
export function formatSearchVolume(searches: number): string {
  if (searches >= 1000000) {
    return `${(searches / 1000000).toFixed(1)}M`
  } else if (searches >= 1000) {
    return `${(searches / 1000).toFixed(1)}K`
  } else {
    return searches.toString()
  }
}
