/**
 * 商品推荐指数计算系统
 *
 * 基于5个维度评估商品的Google Ads投放推荐指数:
 * 1. 商品吸引力 (38%权重)
 * 2. 佣金潜力 (33%权重)
 * 3. 市场适配性 (24%权重)
 * 4. 季节性加成 (10%权重) - AI分析
 * 5. 商品特征 (5%权重) - AI分析
 */

import { generateContent, type ResponseSchema } from './gemini'
import { detectAffiliateLandingPageType, type AffiliateProduct } from './affiliate-products'
import { withCache } from './ai-cache'
import { estimateTokenCost, recordTokenUsage } from './ai-token-tracker'

/**
 * 推荐指数计算结果
 */
export interface ProductRecommendationScore {
  totalScore: number // 0-100
  starRating: number // 1.0-5.0
  reasons: string[] // 5条推荐理由
  dimensions: {
    productAppeal: DimensionScore
    commissionPotential: DimensionScore
    marketFit: DimensionScore
    seasonality: DimensionScore
    productCharacteristics: DimensionScore // 新增：商品特征维度
  }
  seasonalityAnalysis?: SeasonalityAnalysis
  productAnalysis?: ProductAnalysis
}

/**
 * 维度评分
 */
export interface DimensionScore {
  score: number // 0-100
  weight: number // 权重
  weightedScore: number // 加权后的分数
  details: Record<string, any>
}

/**
 * 季节性分析结果
 */
export interface SeasonalityAnalysis {
  seasonality: 'winter' | 'summer' | 'spring' | 'fall' | 'all-year'
  holidays: string[]
  isPeakSeason: boolean
  monthsUntilPeak: number
  reasoning: string
  score: number // 0-100
  analyzedAt: string
}

/**
 * 扩展的商品AI分析结果
 */
export interface ProductAnalysis {
  category: string // 商品类别：electronics, clothing, home, sports, beauty, etc.
  targetAudience: string[] // 目标受众：male, female, kids, elderly, unisex
  pricePositioning: 'premium' | 'mid-range' | 'budget' | 'luxury' // 价格定位感知
  useScenario: string[] // 使用场景：indoor, outdoor, sports, office, travel, daily
  productFeatures: string[] // 商品特点：portable, durable, fashionable, practical, innovative
  reasoning: string // AI分析理由
  analyzedAt: string
}

interface CombinedProductScoreAnalysis {
  seasonality: Omit<SeasonalityAnalysis, 'score' | 'analyzedAt'>
  productAnalysis: Omit<ProductAnalysis, 'analyzedAt'>
}

export interface HybridProductScoreResult {
  productId: number
  score: ProductRecommendationScore | null
  usedAI: boolean
  error?: string
}

export interface HybridProductScoreSummary {
  totalProducts: number
  aiCandidates: number
  aiCompleted: number
  ruleOnly: number
}

const DEFAULT_HYBRID_RERANK_TOP_K = 10
// 推荐指数仅需紧凑结构化字段，限制输出预算避免长文本膨胀
const PRODUCT_SCORE_AI_MAX_OUTPUT_TOKENS = 640
const PRODUCT_SCORE_AI_RETRY_MAX_OUTPUT_TOKENS = 320

const SEASONALITY_VALUES = ['winter', 'summer', 'spring', 'fall', 'all-year'] as const
const PRICE_POSITIONING_VALUES = ['luxury', 'premium', 'mid-range', 'budget'] as const
const TARGET_AUDIENCE_VALUES = ['male', 'female', 'kids', 'elderly', 'unisex'] as const
const USE_SCENARIO_VALUES = ['indoor', 'outdoor', 'sports', 'office', 'travel', 'daily', 'party', 'professional'] as const
const PRODUCT_FEATURE_VALUES = ['portable', 'durable', 'fashionable', 'practical', 'innovative', 'eco-friendly', 'smart', 'luxury'] as const

function normalizeCacheText(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function normalizeCacheAsin(value: string | null | undefined): string | null {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()

  return normalized || null
}

function buildCombinedProductAnalysisCacheKey(
  userId: number,
  product: AffiliateProduct,
  currentMonth: number
): string {
  const normalizedAsin = normalizeCacheAsin(product.asin)
  if (normalizedAsin) {
    return [
      `user:${userId}`,
      `month:${currentMonth}`,
      `asin:${normalizedAsin}`,
    ].join('|')
  }

  return [
    `user:${userId}`,
    `month:${currentMonth}`,
    `name:${normalizeCacheText(product.product_name)}`,
    `brand:${normalizeCacheText(product.brand)}`,
    `price:${product.price_amount ?? 'unknown'}`,
  ].join('|')
}

function buildCombinedProductScorePrompt(
  product: AffiliateProduct,
  currentMonth: number
): string {
  return [
    'Return compact JSON only.',
    `Current month: ${currentMonth}`,
    `Product name: ${product.product_name || 'Unknown'}`,
    `Brand: ${product.brand || 'Unknown'}`,
    `Price: ${product.price_amount ? `$${product.price_amount}` : 'Unknown'}`,
    '',
    'Return exactly one JSON object with this shape:',
    '{"seasonality":{"seasonality":"","isPeakSeason":false,"monthsUntilPeak":0,"holidays":[]},"productAnalysis":{"category":"","targetAudience":[],"pricePositioning":"","useScenario":[],"productFeatures":[]}}',
    '',
    'Rules:',
    '- Base on product identity and conservative market judgment.',
    '- monthsUntilPeak must be between 0 and 12.',
    '- seasonality in: winter/summer/spring/fall/all-year.',
    '- pricePositioning in: luxury/premium/mid-range/budget.',
    '- Arrays max 2 items each.',
    '- No reasoning fields.',
    '- One-line JSON only. No markdown, no explanation.',
  ].join('\n')
}

function buildCombinedProductScoreRetryPrompt(
  product: AffiliateProduct,
  currentMonth: number
): string {
  return [
    buildCombinedProductScorePrompt(product, currentMonth),
    '',
    'The previous output was invalid JSON.',
    'Retry now and return exactly one valid JSON object only.',
    'No markdown and no text outside JSON.',
  ].join('\n')
}

function asObject(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, any>
}

function normalizeString(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim()
  return normalized || fallback
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeString(item))
    .filter(Boolean)
}

function normalizeEnumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  const normalized = normalizeString(value)
  if (allowed.includes(normalized as T)) {
    return normalized as T
  }
  return fallback
}

function normalizeEnumArray<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T[] {
  const allowedSet = new Set(allowed)
  return normalizeStringArray(value)
    .filter((item): item is T => allowedSet.has(item as T))
}

function normalizeMonthsUntilPeak(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(12, Math.round(parsed)))
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes'].includes(normalized)) return true
    if (['false', '0', 'no'].includes(normalized)) return false
  }
  return false
}

function extractCombinedProductJsonCandidates(responseText: string): string[] {
  const candidates: string[] = []
  const addCandidate = (candidate: string | null | undefined) => {
    const normalized = String(candidate || '').trim()
    if (!normalized || candidates.includes(normalized)) return
    candidates.push(normalized)
  }

  const trimmed = responseText.trim()
  addCandidate(trimmed)

  const markdownBlockRegex = /```(?:json|javascript)?\s*([\s\S]*?)```/gi
  let markdownMatch: RegExpExecArray | null = null
  while ((markdownMatch = markdownBlockRegex.exec(trimmed)) !== null) {
    addCandidate(markdownMatch[1])
  }

  const markdownStripped = trimmed
    .replace(/```json\s*/gi, '')
    .replace(/```javascript\s*/gi, '')
    .replace(/```\s*/gi, '')
    .replace(/^json\s*/i, '')
    .trim()
  addCandidate(markdownStripped)

  const firstBrace = markdownStripped.indexOf('{')
  const lastBrace = markdownStripped.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    addCandidate(markdownStripped.slice(firstBrace, lastBrace + 1))
  }

  return candidates
}

function normalizeCombinedProductScoreAnalysis(raw: unknown): CombinedProductScoreAnalysis | null {
  const root = asObject(raw)
  if (!root) return null

  const seasonality = asObject(root.seasonality)
  const productAnalysis = asObject(root.productAnalysis)
  if (!seasonality || !productAnalysis) return null

  return {
    seasonality: {
      seasonality: normalizeEnumValue(
        seasonality.seasonality,
        SEASONALITY_VALUES,
        'all-year'
      ),
      holidays: normalizeStringArray(seasonality.holidays),
      isPeakSeason: normalizeBoolean(seasonality.isPeakSeason),
      monthsUntilPeak: normalizeMonthsUntilPeak(seasonality.monthsUntilPeak),
      reasoning: normalizeString(seasonality.reasoning, 'No seasonality reasoning provided.'),
    },
    productAnalysis: {
      category: normalizeString(productAnalysis.category, 'other'),
      targetAudience: normalizeEnumArray(productAnalysis.targetAudience, TARGET_AUDIENCE_VALUES),
      pricePositioning: normalizeEnumValue(
        productAnalysis.pricePositioning,
        PRICE_POSITIONING_VALUES,
        'mid-range'
      ),
      useScenario: normalizeEnumArray(productAnalysis.useScenario, USE_SCENARIO_VALUES),
      productFeatures: normalizeEnumArray(productAnalysis.productFeatures, PRODUCT_FEATURE_VALUES),
      reasoning: normalizeString(productAnalysis.reasoning, 'No product analysis reasoning provided.'),
    },
  }
}

function parseCombinedProductScoreAnalysis(responseText: string): CombinedProductScoreAnalysis {
  if (!responseText || typeof responseText !== 'string') {
    throw new Error('Combined score response is empty or not a string')
  }

  const candidates = extractCombinedProductJsonCandidates(responseText)
  let lastParseError = 'No parsable JSON candidate found'

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      const normalized = normalizeCombinedProductScoreAnalysis(parsed)
      if (normalized) {
        return normalized
      }
      lastParseError = 'JSON parsed but missing required fields: seasonality/productAnalysis'
    } catch (error) {
      lastParseError = (error as Error).message
    }
  }

  const preview = responseText.slice(0, 240).replace(/\s+/g, ' ')
  throw new Error(`Failed to parse combined product score JSON: ${lastParseError}; preview="${preview}"`)
}

function inferFallbackCategory(product: AffiliateProduct): string {
  const text = `${product.product_name || ''} ${product.brand || ''}`.toLowerCase()
  if (/(phone|laptop|tablet|charger|headphone|camera|smart)/.test(text)) return 'electronics'
  if (/(shirt|dress|shoe|sneaker|jacket|clothing|fashion)/.test(text)) return 'clothing'
  if (/(kitchen|home|bedding|furniture|cleaning|house)/.test(text)) return 'home'
  if (/(fitness|gym|sport|outdoor|cycling|running)/.test(text)) return 'sports'
  if (/(beauty|skincare|makeup|cosmetic|hair)/.test(text)) return 'beauty'
  if (/(toy|puzzle|lego|kids)/.test(text)) return 'toys'
  if (/(book|notebook|reading)/.test(text)) return 'books'
  if (/(snack|drink|coffee|food|tea)/.test(text)) return 'food'
  if (/(car|auto|vehicle|motor)/.test(text)) return 'automotive'
  if (/(vitamin|supplement|health|wellness)/.test(text)) return 'health'
  return 'other'
}

function inferFallbackPricePositioning(priceAmount: number | null): ProductAnalysis['pricePositioning'] {
  if (!priceAmount || priceAmount <= 0) return 'mid-range'
  if (priceAmount >= 120) return 'luxury'
  if (priceAmount >= 50) return 'premium'
  if (priceAmount >= 15) return 'mid-range'
  return 'budget'
}

function buildFallbackCombinedProductScoreAnalysis(product: AffiliateProduct): CombinedProductScoreAnalysis {
  return {
    seasonality: {
      seasonality: 'all-year',
      holidays: [],
      isPeakSeason: false,
      monthsUntilPeak: 0,
      reasoning: 'Fallback analysis used due to unstable structured output.',
    },
    productAnalysis: {
      category: inferFallbackCategory(product),
      targetAudience: ['unisex'],
      pricePositioning: inferFallbackPricePositioning(product.price_amount),
      useScenario: ['daily'],
      productFeatures: ['practical'],
      reasoning: 'Fallback analysis generated from product basics.',
    },
  }
}

async function recordProductScoreTokenUsage(
  userId: number,
  operationType: string,
  result: {
    usage?: {
      inputTokens: number
      outputTokens: number
      totalTokens: number
    }
    model: string
    apiType?: string
  }
): Promise<void> {
  if (!result.usage || result.usage.totalTokens <= 0) {
    return
  }

  const cost = estimateTokenCost(
    result.model,
    result.usage.inputTokens,
    result.usage.outputTokens
  )

  await recordTokenUsage({
    userId,
    model: result.model,
    operationType,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    totalTokens: result.usage.totalTokens,
    cost,
    apiType: (result.apiType as 'direct-api') || 'direct-api',
  })
}

/**
 * 计算商品推荐指数
 */
export async function calculateProductRecommendationScore(
  product: AffiliateProduct,
  userId: number,
  options?: {
    forceRecalculate?: boolean
    includeSeasonalityAnalysis?: boolean
  }
): Promise<ProductRecommendationScore> {
  // 1. 计算各维度评分
  const productAppeal = calculateProductAppealScore(product)
  const commissionPotential = calculateCommissionPotentialScore(product)
  const marketFit = calculateMarketFitScore(product)

  // 2. 季节性分析和商品特征分析 (可选,使用AI)
  let seasonality: DimensionScore
  let productCharacteristics: DimensionScore
  let seasonalityAnalysis: SeasonalityAnalysis | undefined
  let productAnalysis: ProductAnalysis | undefined

  if (options?.includeSeasonalityAnalysis && product.product_name) {
    try {
      const combinedAnalysis = await analyzeProductScoreCombined(product, userId)

      seasonalityAnalysis = combinedAnalysis.seasonalityAnalysis
      productAnalysis = combinedAnalysis.productAnalysis

      // 季节性维度
      seasonality = {
        score: seasonalityAnalysis.score,
        weight: 0.1,
        weightedScore: seasonalityAnalysis.score * 0.1,
        details: {
          seasonality: seasonalityAnalysis.seasonality,
          holidays: seasonalityAnalysis.holidays,
          isPeakSeason: seasonalityAnalysis.isPeakSeason,
          monthsUntilPeak: seasonalityAnalysis.monthsUntilPeak
        }
      }

      // 商品特征维度（基于AI分析）
      productCharacteristics = calculateProductCharacteristicsScore(productAnalysis)
    } catch (error) {
      console.warn('AI分析失败,使用默认分数:', error)
      seasonality = getDefaultSeasonalityScore()
      productCharacteristics = getDefaultProductCharacteristicsScore()
    }
  } else {
    seasonality = getDefaultSeasonalityScore()
    productCharacteristics = getDefaultProductCharacteristicsScore()
  }

  // 3. 计算总分
  // 权重: 商品吸引力38%, 佣金潜力33%, 市场适配性24%, 季节性10%, 商品特征5%
  const totalScore =
    productAppeal.weightedScore +
    commissionPotential.weightedScore +
    marketFit.weightedScore +
    seasonality.weightedScore +
    productCharacteristics.weightedScore

  // 4. 转换为星级
  const starRating = convertScoreToStars(totalScore)

  // 5. 生成推荐理由
  const reasons = generateRecommendationReasons({
    product,
    dimensions: {
      productAppeal,
      commissionPotential,
      marketFit,
      seasonality,
      productCharacteristics
    },
    seasonalityAnalysis,
    productAnalysis
  })

  return {
    totalScore,
    starRating,
    reasons,
    dimensions: {
      productAppeal,
      commissionPotential,
      marketFit,
      seasonality,
      productCharacteristics
    },
    seasonalityAnalysis,
    productAnalysis
  }
}

/**
 * 1. 商品吸引力评分 (38%权重)
 * 包含: 价格评分(40%) + 评论数评分(40%) + 品牌独特性评分(20%)
 */
function calculateProductAppealScore(product: AffiliateProduct): DimensionScore {
  const priceScore = calculatePriceScore(product.price_amount)
  const reviewScore = calculateReviewScore(product.review_count)
  const brandScore = calculateBrandScore(product.brand)

  const score = priceScore * 0.4 + reviewScore * 0.4 + brandScore * 0.2

  return {
    score,
    weight: 0.38,
    weightedScore: score * 0.38,
    details: {
      priceScore,
      reviewScore,
      brandScore,
      priceAmount: product.price_amount,
      reviewCount: product.review_count,
      brand: product.brand
    }
  }
}

/**
 * 价格评分规则
 */
function calculatePriceScore(priceAmount: number | null): number {
  if (!priceAmount || priceAmount <= 0) return 50 // 缺失价格,中性分数

  if (priceAmount >= 15 && priceAmount <= 100) return 100 // 最优区间
  if (priceAmount >= 5 && priceAmount < 15) return 90 // 低价优势
  if (priceAmount > 100 && priceAmount <= 200) return 85 // 中高价
  if (priceAmount > 200 && priceAmount <= 500) return 70 // 高价
  if (priceAmount < 5) return 40 // 过低,佣金有限
  if (priceAmount > 500) return 50 // 过高,转化困难

  return 50
}

/**
 * 评论数评分规则
 */
function calculateReviewScore(reviewCount: number | null): number {
  if (!reviewCount || reviewCount <= 0) return 15 // 无评论

  if (reviewCount >= 5000) return 100
  if (reviewCount >= 1000) return 90
  if (reviewCount >= 500) return 80
  if (reviewCount >= 100) return 65
  if (reviewCount >= 50) return 50
  if (reviewCount >= 10) return 30

  return 15
}

/**
 * 品牌独特性评分规则
 */
function calculateBrandScore(brand: string | null): number {
  if (!brand) return 40 // 无品牌

  const brandLower = brand.toLowerCase().trim()

  // 知名品牌列表
  const famousBrands = [
    'apple', 'samsung', 'sony', 'nike', 'adidas', 'microsoft',
    'dell', 'hp', 'lenovo', 'asus', 'lg', 'panasonic', 'canon',
    'nikon', 'bose', 'jbl', 'logitech', 'razer', 'corsair'
  ]

  // 中等品牌列表
  const mediumBrands = [
    'anker', 'aukey', 'tp-link', 'netgear', 'belkin', 'sandisk',
    'western digital', 'seagate', 'crucial', 'kingston'
  ]

  if (famousBrands.some(b => brandLower.includes(b))) return 100
  if (mediumBrands.some(b => brandLower.includes(b))) return 85

  // 根据品牌名长度判断
  if (brand.length >= 8) return 70
  if (brand.length >= 5) return 60

  return 50
}

/**
 * 2. 佣金潜力评分 (33%权重)
 * 包含: 佣金比例评分(50%) + 佣金金额评分(50%)
 */
function calculateCommissionPotentialScore(product: AffiliateProduct): DimensionScore {
  const rateScore = calculateCommissionRateScore(product.commission_rate)
  const amountScore = calculateCommissionAmountScore(product.commission_amount)

  const score = rateScore * 0.5 + amountScore * 0.5

  return {
    score,
    weight: 0.33,
    weightedScore: score * 0.33,
    details: {
      rateScore,
      amountScore,
      commissionRate: product.commission_rate,
      commissionAmount: product.commission_amount
    }
  }
}

/**
 * 佣金比例评分规则
 */
function calculateCommissionRateScore(rate: number | null): number {
  if (!rate || rate <= 0) return 30 // 缺失佣金比例

  if (rate >= 15) return 100
  if (rate >= 10) return 90
  if (rate >= 7) return 75
  if (rate >= 5) return 60
  if (rate >= 3) return 45
  if (rate >= 1) return 30

  return 15
}

/**
 * 佣金金额评分规则
 */
function calculateCommissionAmountScore(amount: number | null): number {
  if (!amount || amount <= 0) return 30 // 缺失佣金金额

  if (amount >= 50) return 100
  if (amount >= 30) return 90
  if (amount >= 20) return 80
  if (amount >= 10) return 65
  if (amount >= 5) return 50
  if (amount >= 2) return 35

  return 20
}

/**
 * 3. 市场适配性评分 (24%权重)
 * 包含: 商品状态(40%) + 地理覆盖(30%) + 落地页类型(20%) + 黑名单(10%)
 */
function calculateMarketFitScore(product: AffiliateProduct): DimensionScore {
  const statusScore = calculateProductStatusScore(product)
  const geoScore = calculateGeoCoverageScore(product.allowed_countries_json)
  const landingPageScore = calculateLandingPageScore(product)
  const blacklistScore = product.is_blacklisted ? 0 : 100

  const score = statusScore * 0.4 + geoScore * 0.3 + landingPageScore * 0.2 + blacklistScore * 0.1

  return {
    score,
    weight: 0.24,
    weightedScore: score * 0.24,
    details: {
      statusScore,
      geoScore,
      landingPageScore,
      blacklistScore,
      isBlacklisted: product.is_blacklisted
    }
  }
}

/**
 * 商品状态评分
 */
function calculateProductStatusScore(product: AffiliateProduct): number {
  // 根据商品的有效性判断状态
  if (product.is_confirmed_invalid) return 0 // invalid
  if (!product.last_synced_at) return 40 // unknown
  if (product.product_url && product.promo_link) return 100 // active

  return 60 // sync_missing
}

/**
 * 地理覆盖评分
 */
function calculateGeoCoverageScore(allowedCountriesJson: string | null): number {
  if (!allowedCountriesJson) return 50 // 缺失数据

  try {
    const countries = JSON.parse(allowedCountriesJson) as string[]
    if (!Array.isArray(countries) || countries.length === 0) return 50

    // 优质市场列表
    const premiumMarkets = ['US', 'UK', 'CA', 'AU', 'DE', 'FR', 'IT', 'ES']
    const premiumCount = countries.filter(c => premiumMarkets.includes(c.toUpperCase())).length

    if (premiumCount >= 5) return 100
    if (premiumCount >= 3) return 90
    if (premiumCount >= 1) return 75

    // 非优质市场
    if (countries.length >= 10) return 60
    if (countries.length >= 5) return 50
    if (countries.length >= 1) return 40

    return 50
  } catch {
    return 50
  }
}

/**
 * 落地页类型评分
 */
function calculateLandingPageScore(product: AffiliateProduct): number {
  const landingPageType = detectAffiliateLandingPageType({
    asin: product.asin,
    productUrl: product.product_url,
    promoLink: product.promo_link,
    shortPromoLink: product.short_promo_link,
  })

  if (landingPageType === 'amazon_product') return 100
  if (landingPageType === 'amazon_store') return 85
  if (landingPageType === 'independent_product') return 60
  if (landingPageType === 'independent_store') return 45

  const candidateUrls = [product.product_url, product.short_promo_link, product.promo_link]
  for (const value of candidateUrls) {
    if (!value) continue
    try {
      const parsed = new URL(value)
      if (parsed.hostname.toLowerCase().includes('amazon.')) {
        // Amazon域名但路径不规范时，按店铺页处理，避免被误记为非Amazon落地页。
        return 85
      }
    } catch {
      continue
    }
  }

  if (!product.product_url && !product.short_promo_link && !product.promo_link) {
    return 30
  }

  return 45
}

/**
 * 商品评分合并AI分析
 * 一次请求同时产出季节性和商品特征分析，避免每个商品触发两次Gemini调用
 */
async function analyzeProductScoreCombined(
  product: AffiliateProduct,
  userId: number
): Promise<{
  seasonalityAnalysis: SeasonalityAnalysis
  productAnalysis: ProductAnalysis
}> {
  const currentMonth = new Date().getMonth() + 1

  return await withCache(
    'product_score_combined_analysis',
    buildCombinedProductAnalysisCacheKey(userId, product, currentMonth),
    async () => {
      const responseSchema: ResponseSchema = {
        type: 'OBJECT',
        properties: {
          seasonality: {
            type: 'OBJECT',
            properties: {
              seasonality: { type: 'STRING' },
              holidays: { type: 'ARRAY', items: { type: 'STRING' } },
              isPeakSeason: { type: 'BOOLEAN' },
              monthsUntilPeak: { type: 'INTEGER', minimum: 0, maximum: 12 },
            },
            required: ['seasonality', 'holidays', 'isPeakSeason', 'monthsUntilPeak']
          },
          productAnalysis: {
            type: 'OBJECT',
            properties: {
              category: { type: 'STRING' },
              targetAudience: {
                type: 'ARRAY',
                items: { type: 'STRING' }
              },
              pricePositioning: { type: 'STRING' },
              useScenario: {
                type: 'ARRAY',
                items: { type: 'STRING' }
              },
              productFeatures: {
                type: 'ARRAY',
                items: { type: 'STRING' }
              },
            },
            required: ['category', 'targetAudience', 'pricePositioning', 'useScenario', 'productFeatures']
          }
        },
        required: ['seasonality', 'productAnalysis']
      }

      const requestBase = {
        maxOutputTokens: PRODUCT_SCORE_AI_MAX_OUTPUT_TOKENS,
        operationType: 'product_score_combined_analysis' as const,
        enableAutoModelSelection: true,
        responseSchema,
        responseMimeType: 'application/json' as const,
      }

      let analysis: CombinedProductScoreAnalysis | null = null

      try {
        const firstResult = await generateContent({
          ...requestBase,
          prompt: buildCombinedProductScorePrompt(product, currentMonth),
          temperature: 0.1,
        }, userId)

        await recordProductScoreTokenUsage(userId, 'product_score_combined_analysis', firstResult)

        try {
          analysis = parseCombinedProductScoreAnalysis(firstResult.text)
        } catch (parseError) {
          console.warn(
            `⚠️ 商品评分合并分析解析失败，触发一次低成本重试: ${(parseError as Error).message}`
          )
        }
      } catch (firstCallError) {
        console.warn('⚠️ 商品评分合并分析首轮调用失败，准备回退到兜底逻辑:', firstCallError)
      }

      if (!analysis) {
        try {
          const retryResult = await generateContent({
            ...requestBase,
            maxOutputTokens: Math.min(requestBase.maxOutputTokens, PRODUCT_SCORE_AI_RETRY_MAX_OUTPUT_TOKENS),
            prompt: buildCombinedProductScoreRetryPrompt(product, currentMonth),
            temperature: 0,
          }, userId)
          await recordProductScoreTokenUsage(userId, 'product_score_combined_analysis', retryResult)
          try {
            analysis = parseCombinedProductScoreAnalysis(retryResult.text)
          } catch (retryParseError) {
            console.warn(
              `⚠️ 商品评分合并分析重试后仍解析失败，使用兜底分析: ${(retryParseError as Error).message}`
            )
          }
        } catch (retryCallError) {
          console.warn('⚠️ 商品评分合并分析重试调用失败，使用兜底分析:', retryCallError)
        }
      }

      if (!analysis) {
        analysis = buildFallbackCombinedProductScoreAnalysis(product)
      }

      const analyzedAt = new Date().toISOString()

      return {
        seasonalityAnalysis: {
          seasonality: analysis.seasonality.seasonality,
          holidays: analysis.seasonality.holidays,
          isPeakSeason: analysis.seasonality.isPeakSeason,
          monthsUntilPeak: analysis.seasonality.monthsUntilPeak,
          reasoning: analysis.seasonality.reasoning,
          score: calculateSeasonalityScore(analysis.seasonality, currentMonth),
          analyzedAt,
        },
        productAnalysis: {
          category: analysis.productAnalysis.category,
          targetAudience: analysis.productAnalysis.targetAudience,
          pricePositioning: analysis.productAnalysis.pricePositioning,
          useScenario: analysis.productAnalysis.useScenario,
          productFeatures: analysis.productAnalysis.productFeatures,
          reasoning: analysis.productAnalysis.reasoning,
          analyzedAt,
        },
      }
    },
    { version: 'v1' }
  )
}

/**
 * 计算季节性评分
 */
function calculateSeasonalityScore(
  analysis: {
    isPeakSeason: boolean
    monthsUntilPeak: number
    seasonality: string
  },
  currentMonth: number
): number {
  // 当前旺季
  if (analysis.isPeakSeason && analysis.monthsUntilPeak === 0) return 100

  // 即将旺季(1-2月内)
  if (analysis.monthsUntilPeak >= 1 && analysis.monthsUntilPeak <= 2) return 85

  // 全年通用
  if (analysis.seasonality === 'all-year') return 70

  // 淡季
  return 40
}

/**
 * 5. 商品特征评分 (5%权重)
 * 基于AI分析的商品特点评分
 */
function calculateProductCharacteristicsScore(analysis: ProductAnalysis): DimensionScore {
  let score = 50 // 基础分

  // 1. 价格定位加分 (最高+20分)
  if (analysis.pricePositioning === 'luxury') {
    score += 20 // 奢侈品定位，目标用户购买力强
  } else if (analysis.pricePositioning === 'premium') {
    score += 15 // 高端定位
  } else if (analysis.pricePositioning === 'mid-range') {
    score += 10 // 中端定位
  } else if (analysis.pricePositioning === 'budget') {
    score += 5 // 经济型，受众广
  }

  // 2. 商品特点加分 (最高+20分)
  const features = analysis.productFeatures
  if (features.includes('innovative') || features.includes('smart')) {
    score += 15 // 创新/智能特点，市场竞争力强
  }
  if (features.includes('portable')) {
    score += 10 // 便携设计，适合移动场景
  }
  if (features.includes('eco-friendly')) {
    score += 8 // 环保特点，符合趋势
  }
  if (features.includes('durable')) {
    score += 7 // 耐用特点
  }
  if (features.includes('fashionable')) {
    score += 6 // 时尚特点
  }

  // 3. 使用场景加分 (最高+15分)
  const scenarios = analysis.useScenario
  if (scenarios.length >= 4) {
    score += 15 // 适用4+场景，受众非常广泛
  } else if (scenarios.length >= 3) {
    score += 12 // 适用3个场景，受众广泛
  } else if (scenarios.length >= 2) {
    score += 8 // 适用2个场景
  } else if (scenarios.length >= 1) {
    score += 5 // 适用1个场景
  }

  // 4. 目标受众加分 (最高+10分)
  const audience = analysis.targetAudience
  if (audience.includes('unisex') || audience.length >= 3) {
    score += 10 // 通用或多受众，市场潜力大
  } else if (audience.length >= 2) {
    score += 7 // 2个受众群体
  } else if (audience.length >= 1) {
    score += 5 // 1个受众群体
  }

  // 确保分数在0-100范围内
  score = Math.min(100, Math.max(0, score))

  return {
    score,
    weight: 0.05,
    weightedScore: score * 0.05,
    details: {
      pricePositioning: analysis.pricePositioning,
      productFeatures: analysis.productFeatures,
      useScenario: analysis.useScenario,
      targetAudience: analysis.targetAudience,
      category: analysis.category
    }
  }
}

/**
 * 获取默认商品特征评分 (当AI分析未启用或失败时)
 */
function getDefaultProductCharacteristicsScore(): DimensionScore {
  return {
    score: 50, // 默认中性分数
    weight: 0.05,
    weightedScore: 50 * 0.05,
    details: {
      note: '未进行AI分析,使用默认分数'
    }
  }
}

/**
 * 获取默认季节性评分 (当AI分析失败或未启用时)
 */
function getDefaultSeasonalityScore(): DimensionScore {
  return {
    score: 70, // 默认为全年通用
    weight: 0.1,
    weightedScore: 70 * 0.1,
    details: {
      seasonality: 'all-year',
      isPeakSeason: false,
      note: '未进行AI分析,使用默认分数'
    }
  }
}

/**
 * 转换总分为星级评分
 */
function convertScoreToStars(totalScore: number): number {
  if (totalScore >= 90) return 5.0
  if (totalScore >= 85) return 4.5
  if (totalScore >= 75) return 4.0
  if (totalScore >= 65) return 3.5
  if (totalScore >= 55) return 3.0
  if (totalScore >= 45) return 2.5
  if (totalScore >= 35) return 2.0
  if (totalScore >= 25) return 1.5
  return 1.0
}

/**
 * 生成推荐理由 (3条)
 */
function generateRecommendationReasons(params: {
  product: AffiliateProduct
  dimensions: {
    productAppeal: DimensionScore
    commissionPotential: DimensionScore
    marketFit: DimensionScore
    seasonality: DimensionScore
    productCharacteristics: DimensionScore
  }
  seasonalityAnalysis?: SeasonalityAnalysis
  productAnalysis?: ProductAnalysis
}): string[] {
  const { product, dimensions, seasonalityAnalysis, productAnalysis } = params
  const reasons: Array<{ text: string; priority: number }> = []

  // 正面理由
  if (dimensions.commissionPotential.details.commissionAmount >= 30) {
    reasons.push({
      text: `高佣金收益,单笔可赚$${dimensions.commissionPotential.details.commissionAmount.toFixed(2)}`,
      priority: 100
    })
  }

  if (dimensions.productAppeal.details.reviewCount >= 1000) {
    reasons.push({
      text: `强大的社会证明,拥有${dimensions.productAppeal.details.reviewCount.toLocaleString()}条评论`,
      priority: 95
    })
  }

  if (dimensions.commissionPotential.details.commissionRate >= 10) {
    reasons.push({
      text: `高佣金比例(${dimensions.commissionPotential.details.commissionRate}%),收益潜力大`,
      priority: 90
    })
  }

  if (dimensions.productAppeal.details.brandScore >= 100) {
    reasons.push({
      text: `知名品牌(${product.brand}),用户信任度高`,
      priority: 85
    })
  }

  if (dimensions.productAppeal.details.priceScore >= 90) {
    const price = dimensions.productAppeal.details.priceAmount
    reasons.push({
      text: `价格适中($${price?.toFixed(2)}),易于转化`,
      priority: 80
    })
  }

  // 季节性正面理由
  if (seasonalityAnalysis?.isPeakSeason) {
    const holidayText = seasonalityAnalysis.holidays.length > 0
      ? `(${seasonalityAnalysis.holidays.join('/')})`
      : ''
    reasons.push({
      text: `当前正值促销旺季${holidayText},需求旺盛`,
      priority: 88
    })
  } else if (seasonalityAnalysis && seasonalityAnalysis.monthsUntilPeak >= 1 && seasonalityAnalysis.monthsUntilPeak <= 2) {
    reasons.push({
      text: `即将进入促销旺季,提前布局`,
      priority: 75
    })
  }

  // 地理覆盖
  if (dimensions.marketFit.details.geoScore >= 90) {
    reasons.push({
      text: `覆盖多个优质市场(US, UK, CA等)`,
      priority: 70
    })
  }

  // Amazon落地页
  if (dimensions.marketFit.details.landingPageScore >= 100) {
    reasons.push({
      text: `Amazon产品页,信任度和转化率高`,
      priority: 65
    })
  }

  // 基于商品特征维度的正面理由
  if (dimensions.productCharacteristics.score >= 80) {
    reasons.push({
      text: `商品特征优秀(${dimensions.productCharacteristics.score.toFixed(0)}分),市场潜力大`,
      priority: 73
    })
  }

  // 基于AI分析的正面理由
  if (productAnalysis) {
    // 高端/奢侈品定位
    if (productAnalysis.pricePositioning === 'luxury' || productAnalysis.pricePositioning === 'premium') {
      reasons.push({
        text: `${productAnalysis.pricePositioning === 'luxury' ? '奢侈品' : '高端'}定位,目标用户购买力强`,
        priority: 72
      })
    }

    // 创新/智能特点
    if (productAnalysis.productFeatures.includes('innovative') || productAnalysis.productFeatures.includes('smart')) {
      reasons.push({
        text: `具有创新/智能特点,市场竞争力强`,
        priority: 68
      })
    }

    // 多场景适用
    if (productAnalysis.useScenario.length >= 3) {
      reasons.push({
        text: `适用多个场景(${productAnalysis.useScenario.slice(0, 3).join('、')}),受众广泛`,
        priority: 66
      })
    }

    // 便携特点
    if (productAnalysis.productFeatures.includes('portable')) {
      reasons.push({
        text: `便携设计,适合移动使用场景`,
        priority: 63
      })
    }
  }

  // 负面理由
  if (product.is_blacklisted) {
    reasons.push({
      text: `商品已被黑名单,无法投放`,
      priority: 200 // 最高优先级
    })
  }

  if (dimensions.marketFit.details.statusScore === 0) {
    reasons.push({
      text: `商品状态无效,无法投放`,
      priority: 195
    })
  }

  if (seasonalityAnalysis && !seasonalityAnalysis.isPeakSeason && seasonalityAnalysis.monthsUntilPeak > 3) {
    reasons.push({
      text: `当前处于淡季,需求较低`,
      priority: 190
    })
  }

  if (dimensions.commissionPotential.details.commissionAmount < 5) {
    const amount = dimensions.commissionPotential.details.commissionAmount
    reasons.push({
      text: `佣金收益较低($${amount?.toFixed(2) || '未知'}),投入产出比不佳`,
      priority: 55
    })
  }

  if (dimensions.commissionPotential.details.commissionRate < 5) {
    const rate = dimensions.commissionPotential.details.commissionRate
    reasons.push({
      text: `佣金比例偏低(${rate}%),收益有限`,
      priority: 50
    })
  }

  if (dimensions.productAppeal.details.reviewCount < 10) {
    const count = dimensions.productAppeal.details.reviewCount || 0
    reasons.push({
      text: `评论数量较少(${count}条),社会证明不足`,
      priority: 45
    })
  }

  if (dimensions.productAppeal.details.priceAmount > 500) {
    const price = dimensions.productAppeal.details.priceAmount
    reasons.push({
      text: `价格过高($${price?.toFixed(2)}),可能影响转化`,
      priority: 40
    })
  }

  if (!product.brand || product.brand.trim().length === 0) {
    reasons.push({
      text: `无品牌信息,用户信任度低`,
      priority: 35
    })
  }

  if (dimensions.marketFit.details.geoScore < 60) {
    reasons.push({
      text: `地理覆盖有限,市场受限`,
      priority: 30
    })
  }

  if (dimensions.marketFit.details.landingPageScore < 60) {
    reasons.push({
      text: `非Amazon落地页,信任度相对较低`,
      priority: 20
    })
  }

  // 中性理由
  if (!dimensions.productAppeal.details.priceAmount) {
    reasons.push({
      text: `价格信息缺失,需要验证`,
      priority: 15
    })
  }

  if (!dimensions.commissionPotential.details.commissionAmount && !dimensions.commissionPotential.details.commissionRate) {
    reasons.push({
      text: `佣金详情未知,请查看平台`,
      priority: 10
    })
  }

  if (seasonalityAnalysis?.seasonality === 'all-year') {
    reasons.push({
      text: `全年通用商品,无明显季节性波动`,
      priority: 5
    })
  }

  // 按优先级排序,选择前5条
  reasons.sort((a, b) => b.priority - a.priority)
  return reasons.slice(0, 5).map(r => r.text)
}

function resolveHybridRerankCount(
  totalProducts: number,
  requestedTopK?: number
): number {
  if (totalProducts <= 0) return 0

  const safeTopK = Number.isFinite(requestedTopK)
    ? Math.max(0, Math.floor(requestedTopK as number))
    : DEFAULT_HYBRID_RERANK_TOP_K

  return Math.min(totalProducts, safeTopK)
}

/**
 * 混合精排：
 * 1. 所有商品先走规则粗排
 * 2. 仅对批次 Top-K 商品做 AI 精排
 */
export async function calculateHybridProductRecommendationScores(
  products: AffiliateProduct[],
  userId: number,
  options?: {
    includeSeasonalityAnalysis?: boolean
    aiRerankTopK?: number
  }
): Promise<{
  results: HybridProductScoreResult[]
  summary: HybridProductScoreSummary
}> {
  if (products.length === 0) {
    return {
      results: [],
      summary: {
        totalProducts: 0,
        aiCandidates: 0,
        aiCompleted: 0,
        ruleOnly: 0,
      }
    }
  }

  const includeSeasonalityAnalysis = options?.includeSeasonalityAnalysis !== false
  const baseScores = await Promise.all(
    products.map(async (product) => ({
      product,
      score: await calculateProductRecommendationScore(product, userId, {
        includeSeasonalityAnalysis: false,
      })
    }))
  )

  const aiCandidateCount = includeSeasonalityAnalysis
    ? resolveHybridRerankCount(products.length, options?.aiRerankTopK)
    : 0

  const aiCandidates = aiCandidateCount > 0
    ? [...baseScores]
        .sort((a, b) => b.score.totalScore - a.score.totalScore)
        .slice(0, aiCandidateCount)
    : []

  const aiScores = new Map<number, ProductRecommendationScore>()
  let aiCompleted = 0

  for (const candidate of aiCandidates) {
    try {
      const rerankedScore = await calculateProductRecommendationScore(candidate.product, userId, {
        includeSeasonalityAnalysis: true,
      })
      aiScores.set(candidate.product.id, rerankedScore)
      aiCompleted++
    } catch (error) {
      console.warn(
        `[ProductScoreCalculation] AI精排失败，回退规则分数: product=${candidate.product.id}`,
        error
      )
    }
  }

  const results = baseScores.map(({ product, score }) => ({
    productId: product.id,
    score: aiScores.get(product.id) || score,
    usedAI: aiScores.has(product.id),
    error: undefined,
  }))

  return {
    results,
    summary: {
      totalProducts: products.length,
      aiCandidates: aiCandidateCount,
      aiCompleted,
      ruleOnly: products.length - aiScores.size,
    }
  }
}

/**
 * 批量计算商品推荐指数
 */
export async function batchCalculateProductScores(
  products: AffiliateProduct[],
  userId: number,
  options?: {
    includeSeasonalityAnalysis?: boolean
    batchSize?: number
  }
): Promise<Array<{
  productId: number
  score: ProductRecommendationScore | null
  error?: string
}>> {
  const results: Array<{
    productId: number
    score: ProductRecommendationScore | null
    error?: string
  }> = []

  for (const product of products) {
    try {
      const score = await calculateProductRecommendationScore(product, userId, options)
      results.push({
        productId: product.id,
        score,
        error: undefined
      })
    } catch (error: any) {
      console.error(`计算商品${product.id}推荐指数失败:`, error)
      results.push({
        productId: product.id,
        score: null,
        error: error.message
      })
    }
  }

  return results
}
