/**
 * AI分析服务模块
 * 封装AI产品分析、评论分析、竞品分析、广告元素提取等功能
 */

import { analyzeProductPage } from './ai'
import { analyzeReviewsWithAI, type RawReview } from './review-analyzer'
import { analyzeCompetitorsWithAI, inferCompetitorKeywords, searchCompetitorsOnAmazon, type CompetitorProduct } from './competitor-analyzer'
import { extractAdElements } from './ad-elements-extractor'
import { scrapeAmazonProduct } from './stealth-scraper/amazon-product'
import { parsePrice } from './pricing-utils'  // 🔧 新增：统一价格解析函数
import { getProxyUrlForCountry } from './settings'  // 🔥 修复（2025-12-09）：动态获取代理URL
import { normalizeGoogleAdsKeyword } from './google-ads-keyword-normalizer'
import { isInvalidKeyword } from './keyword-invalid-filter'
import {
  createCompetitorRelevanceContext,
  filterRelevantCompetitors,
  type CompetitorRelevanceContext,
} from './competitor-relevance-filter'

export interface AIAnalysisInput {
  extractResult: {
    finalUrl: string
    finalUrlSuffix?: string
    brand?: string | null
    productDescription?: string | null
    targetLanguage?: string
    redirectCount?: number
    redirectChain?: string[]
    pageTitle?: string | null
    resolveMethod?: string
    productCount?: number
    pageType?: 'store' | 'product'
    // Flattened store properties (Amazon Store & Independent Store)
    storeName?: string
    storeDescription?: string
    platform?: string
    products?: any[]
    logoUrl?: string
    hotInsights?: {
      avgRating?: number
      avgReviews?: number
      topProductsCount?: number
    }
    // 店铺分类数据（店铺维度增强）
    productCategories?: {
      primaryCategories?: Array<{
        name: string
        count: number
        url?: string
      }>
      categoryTree?: Record<string, string[]>
      totalCategories?: number
    }
    // 深度抓取结果（热销商品详情页数据）
    deepScrapeResults?: {
      topProducts?: Array<{
        asin: string
        productData?: any
        reviews?: string[]
        reviewHighlights?: string[]  // 🔥 修复（2025-12-11）：添加评论高亮
        competitorAsins?: string[]
        features?: string[]  // 🔥 修复（2025-12-11）：添加产品特性
        scrapeStatus: 'success' | 'failed' | 'skipped'
        error?: string
      }>
      totalScraped?: number
      successCount?: number
      failedCount?: number
      // 🔥 修复（2025-12-11）：添加聚合数据用于AI分析
      aggregatedReviews?: string[]
      aggregatedFeatures?: string[]
      aggregatedCompetitorAsins?: string[]
    }
    // Flattened product properties
    productName?: string
    productPrice?: string  // 🔥 统一字段名：price → productPrice
    productCategory?: string
    productFeatures?: string[]
    metaTitle?: string
    metaDescription?: string
    // 🔥 2026-01-04新增：独立站增强数据字段（用于AI分析）
    reviews?: Array<{
      rating: number
      date: string
      author: string
      title: string
      body: string
      verifiedBuyer: boolean
      images?: string[]
    }>
    faqs?: Array<{ question: string; answer: string }>
    specifications?: Record<string, string>
    packages?: Array<{ name: string; price: string | null; includes: string[] }>
    socialProof?: Array<{ metric: string; value: string }>
    coreFeatures?: string[]
    secondaryFeatures?: string[]
    // Amazon单品页详细数据
    rating?: string | null
    reviewCount?: string | null
    reviewHighlights?: string[]
    topReviews?: string[]
    features?: string[]
    aboutThisItem?: string[]
    technicalDetails?: Record<string, string>
    imageUrls?: string[]
    originalPrice?: string | null
    discount?: string | null
    salesRank?: string | null
    availability?: string | null
    primeEligible?: boolean
    asin?: string | null
    category?: string | null
    // 🔥 KISS优化：竞品候选ASIN列表（品牌过滤在详情页抓取后进行）
    relatedAsins?: string[]
    // Legacy nested data (kept for backwards compatibility)
    storeData?: {
      storeName?: string
      storeDescription?: string
      products?: any[]
      totalProducts?: number
      storeUrl?: string
      brandName?: string | null
      hotInsights?: {
        avgRating: number
        avgReviews: number
        topProductsCount: number
      }
      productCategories?: {
        primaryCategories: Array<{
          name: string
          count: number
          url?: string
        }>
        categoryTree?: Record<string, string[]>
        totalCategories: number
      }
      deepScrapeResults?: {
        topProducts: Array<{
          asin: string
          productData: any
          reviews: string[]
          reviewHighlights?: string[]  // 🔥 修复（2025-12-11）
          competitorAsins: string[]
          features?: string[]  // 🔥 修复（2025-12-11）
          scrapeStatus: 'success' | 'failed' | 'skipped'
          error?: string
        }>
        totalScraped: number
        successCount: number
        failedCount: number
        // 🔥 修复（2025-12-11）：添加聚合数据
        aggregatedReviews?: string[]
        aggregatedFeatures?: string[]
        aggregatedCompetitorAsins?: string[]
      }
    }
    amazonProductData?: {
      productName?: string
      brandName?: string
      productDescription?: string
      productPrice?: string
      imageUrls?: string[]
    }
    independentStoreData?: {
      storeName?: string
      storeDescription?: string
      products?: any[]
      totalProducts?: number
      platform?: string
      logoUrl?: string
    }
    // Debug info
    debug?: {
      isAmazonStore?: boolean
      isAmazonProductPage?: boolean
      isIndependentStore?: boolean
    }
  }
  targetCountry: string
  targetLanguage: string
  userId: number
  fallbackBrand?: string
  enableReviewAnalysis?: boolean
  enableCompetitorAnalysis?: boolean
  enableAdExtraction?: boolean
  // 🔥 新增（2025-12-08）：启用Playwright深度抓取，与手动创建流程保持一致
  // 当启用时，会使用Playwright抓取30条评论和5个竞品，而不是使用初始数据估算
  enablePlaywrightDeepScraping?: boolean
}

export interface AIAnalysisResult {
  aiAnalysisSuccess: boolean
  aiProductInfo?: {
    brandDescription?: string
    uniqueSellingPoints?: string
    productHighlights?: string
    targetAudience?: string
    category?: string
    // 🎯 P0优化（2025-12-07）：新增完整字段
    keywords?: string[]
    sellingPoints?: string[]
    productDescription?: string
    pricing?: {
      current?: string
      original?: string
      discount?: string
      competitiveness?: 'Premium' | 'Competitive' | 'Budget'
      valueAssessment?: string
    }
    reviews?: {
      rating?: number
      count?: number
      sentiment?: 'Positive' | 'Mixed' | 'Negative'
      positives?: string[]
      concerns?: string[]
      useCases?: string[]
    }
    promotions?: {
      active?: boolean
      types?: string[]
      urgency?: string | null
      freeShipping?: boolean
    }
    competitiveEdges?: {
      badges?: string[]
      primeEligible?: boolean
      stockStatus?: string
      salesRank?: string
    }
    // 🎯 v3.2优化（2025-12-08）：店铺/单品差异化分析字段
    // 店铺分析专用字段
    storeQualityLevel?: 'Premium' | 'Standard' | 'Budget' | 'Unknown'
    categoryDiversification?: {
      level: 'Focused' | 'Moderate' | 'Diverse'
      categories?: string[]
      primaryCategory?: string
    }
    hotInsights?: {
      avgRating?: number
      avgReviews?: number
      topProductsCount?: number
      bestSeller?: string
      priceRange?: { min: number; max: number }
    }
    // 单品分析专用字段
    marketFit?: {
      score: number // 0-100
      level: 'Excellent' | 'Good' | 'Average' | 'Poor'
      strengths?: string[]
      gaps?: string[]
    }
    credibilityLevel?: {
      score: number // 0-100
      level: 'High' | 'Medium' | 'Low'
      factors?: string[]
    }
    categoryPosition?: {
      rank?: string
      percentile?: number
      competitors?: number
    }
    // 页面类型标识
    pageType?: 'store' | 'product'
  }
  reviewAnalysis?: any
  reviewAnalysisSuccess?: boolean
  competitorAnalysis?: any
  competitorAnalysisSuccess?: boolean
  extractedKeywords?: string[]
  extractedHeadlines?: string[]
  extractedDescriptions?: string[]
  extractionMetadata?: any
  adExtractionSuccess?: boolean
}

/**
 * 根据国家获取Amazon域名
 */
function getAmazonDomain(country: string): string {
  const domainMap: Record<string, string> = {
    'US': 'com',
    'UK': 'co.uk',
    'DE': 'de',
    'FR': 'fr',
    'IT': 'it',
    'ES': 'es',
    'JP': 'co.jp',
    'CA': 'ca',
    'AU': 'com.au',
    'IN': 'in',
    'MX': 'com.mx',
    'BR': 'com.br',
  }
  return domainMap[country] || 'com'
}

const PLACEHOLDER_BRANDS = new Set([
  'unknown',
  'unknown brand',
  'n a',
  'na',
  'null',
  'undefined',
])

function toTrimmedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isPlaceholderBrandName(value: unknown): boolean {
  const text = toTrimmedText(value)
  if (!text) return true
  const normalized = normalizeGoogleAdsKeyword(text)
  if (!normalized) return true
  if (PLACEHOLDER_BRANDS.has(normalized)) return true
  return normalized.startsWith('unknown ') || normalized.endsWith(' unknown')
}

function resolveBrandForAdExtraction(candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    const text = toTrimmedText(candidate)
    if (!text) continue
    if (isPlaceholderBrandName(text)) continue
    return text
  }
  return null
}

function sanitizeExtractedKeywordList(
  keywords: Array<{ keyword?: string }>
): { cleaned: string[]; removedInvalid: number; removedDuplicate: number } {
  const seen = new Set<string>()
  const cleaned: string[] = []
  let removedInvalid = 0
  let removedDuplicate = 0

  for (const item of keywords) {
    const rawKeyword = toTrimmedText(item?.keyword)
    if (!rawKeyword || isInvalidKeyword(rawKeyword)) {
      removedInvalid += 1
      continue
    }

    const normalized = normalizeGoogleAdsKeyword(rawKeyword)
    if (!normalized) {
      removedInvalid += 1
      continue
    }

    if (seen.has(normalized)) {
      removedDuplicate += 1
      continue
    }

    seen.add(normalized)
    cleaned.push(rawKeyword)
  }

  return { cleaned, removedInvalid, removedDuplicate }
}

// 🔥 新增（2025-12-09）：竞品详情缓存（24小时有效期）
interface CachedCompetitor {
  data: CompetitorProduct
  timestamp: number
}

const competitorCache = new Map<string, CachedCompetitor>()
const CACHE_TTL = 24 * 60 * 60 * 1000  // 24小时

/**
 * 从缓存获取竞品详情
 * 🔧 2025-12-11修复：为旧缓存数据补充productUrl字段
 */
function getCachedCompetitor(asin: string, targetCountry?: string): CompetitorProduct | null {
  const cached = competitorCache.get(asin)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`  📦 缓存命中: ${asin}`)
    // 🔧 修复：如果缓存数据没有productUrl，根据国家代码生成
    if (!cached.data.productUrl && targetCountry) {
      const amazonDomain = getAmazonDomain(targetCountry)
      cached.data.productUrl = `https://www.amazon.${amazonDomain}/dp/${asin}`
    }
    return cached.data
  }
  if (cached) {
    competitorCache.delete(asin)  // 清理过期缓存
  }
  return null
}

/**
 * 保存竞品详情到缓存
 */
function setCachedCompetitor(asin: string, data: CompetitorProduct): void {
  competitorCache.set(asin, {
    data,
    timestamp: Date.now()
  })
}

/**
 * 获取缓存统计
 */
function getCacheStats(): { size: number, hitRate: string } {
  return {
    size: competitorCache.size,
    hitRate: `${competitorCache.size} items cached`
  }
}

/**
 * 🔥 KISS优化（2025-12-09）：简单选择前N个ASIN
 * 品牌过滤将在详情页抓取后进行（更准确）
 */
function selectAsins(asins: string[], limit: number = 3): string[] {
  return asins.slice(0, limit)
}

/**
 * 批量抓取竞品详情
 * 🔥 KISS优化（2025-12-09）：
 * - 输入简化为纯ASIN数组
 * - 品牌过滤在详情页抓取后进行（更准确）
 * - 复用 scrapeAmazonProduct 获取完整产品信息（价格、品牌、评分等）
 *
 * @param candidateAsins - 候选竞品ASIN列表
 * @param targetCountry - 目标国家
 * @param mainBrand - 主产品品牌（用于过滤同品牌产品）
 * @param customProxyUrl - 自定义代理URL（可选）
 * @param limit - 最多抓取数量（默认3个）
 * @param skipBrandFilter - 跳过品牌过滤（针对单商品页面，保留同品牌竞品用于差异化分析）
 * @returns 竞品产品详情列表（已过滤同品牌）
 */
async function batchScrapeCompetitorDetails(
  candidateAsins: string[],
  targetCountry: string,
  mainBrand: string | null,
  customProxyUrl?: string,
  limit: number = 3,
  skipBrandFilter: boolean = false,
  relevanceContext?: CompetitorRelevanceContext
): Promise<CompetitorProduct[]> {
  console.log(`🔍 批量抓取竞品详情 (最多${limit}个)...`)
  console.log(`📊 缓存状态: ${getCacheStats().hitRate}`)
  if (skipBrandFilter) {
    console.log(`🏷️ 主产品品牌: ${mainBrand || '未知'}（单商品页面：保留同品牌竞品用于差异化分析）`)
  } else {
    console.log(`🏷️ 主产品品牌: ${mainBrand || '未知'}（将过滤同品牌竞品）`)
  }

  // Step 1: 选择候选ASIN（多选一些以备品牌过滤和失败重试）
  const selectedAsins = selectAsins(candidateAsins, Math.min(limit + 5, candidateAsins.length))
  console.log(`📋 已选择${selectedAsins.length}个候选ASIN: ${selectedAsins.join(', ')}`)

  // Step 2: 检查缓存，分离已缓存和需抓取的ASIN
  const cachedCompetitors: CompetitorProduct[] = []
  const asinsToScrape: string[] = []

  for (const asin of selectedAsins) {
    const cached = getCachedCompetitor(asin, targetCountry)  // 🔧 传入targetCountry以补充productUrl
    if (cached) {
      cachedCompetitors.push(cached)
    } else {
      asinsToScrape.push(asin)
    }
  }

  console.log(`📦 缓存: ${cachedCompetitors.length}个命中, ${asinsToScrape.length}个需抓取`)

  // Step 3: 构建竞品URL列表（只抓取未缓存的）
  if (asinsToScrape.length === 0) {
    console.log(`✅ 全部命中缓存，无需抓取`)
    return cachedCompetitors
  }

  const amazonDomain = getAmazonDomain(targetCountry)
  const competitorUrls = asinsToScrape.map(asin => ({
    asin,
    url: `https://www.amazon.${amazonDomain}/dp/${asin}`
  }))

  // Step 4: 分批抓取详情（限制并发数为5，平衡速度和成功率）
  // 🔥 优化（2025-12-10）：从3提升到5，配合代理IP轮换可安全并发
  // 连接池支持10实例，每代理最多3实例，5并发是安全阈值
  const CONCURRENCY_LIMIT = 5
  const allResults: PromiseSettledResult<CompetitorProduct | null>[] = []

  for (let i = 0; i < competitorUrls.length; i += CONCURRENCY_LIMIT) {
    const batch = competitorUrls.slice(i, i + CONCURRENCY_LIMIT)
    console.log(`  📦 抓取批次 ${Math.floor(i / CONCURRENCY_LIMIT) + 1}/${Math.ceil(competitorUrls.length / CONCURRENCY_LIMIT)} (${batch.length}个)`)

    const batchResults = await Promise.allSettled(
      batch.map(async ({ asin, url }) => {
      try {
        console.log(`  🔄 正在抓取竞品: ${asin}`)

        // 🔥 复用现有的 scrapeAmazonProduct 函数
        // 优势：自动包含代理重试、反爬虫、品牌过滤等逻辑
        // 🔥 修复（2025-12-09）：传入skipCompetitorExtraction=true，避免"竞品的竞品"二级循环抓取
        const productData = await scrapeAmazonProduct(
          url,
          customProxyUrl,
          targetCountry,
          1,  // 竞品抓取只重试1次（避免过长等待）
          true  // 🛡️ 跳过竞品ASIN提取，避免二级循环
        )

        // 转换为 CompetitorProduct 格式
        const competitor: CompetitorProduct = {
          asin,
          name: productData.productName || `Product ${asin}`,
          brand: productData.brandName || 'Unknown',
          price: parsePrice(productData.productPrice),  // 🔧 修复：使用统一价格解析函数
          priceText: productData.productPrice || null,
          rating: productData.rating
            ? parseFloat(productData.rating)
            : null,
          reviewCount: productData.reviewCount
            ? parseInt(productData.reviewCount.replace(/[^0-9]/g, ''), 10)
            : null,
          imageUrl: productData.imageUrls?.[0] || null,
          source: 'related_products' as const,
          features: productData.features || productData.aboutThisItem || [],
          // 🔥 新增：商品链接（用于前端展示可点击链接）
          productUrl: url,
        }

        // 🔥 保存到缓存
        setCachedCompetitor(asin, competitor)

        console.log(`  ✅ 成功抓取: ${asin} - ${competitor.name} (${competitor.brand})`)
        return competitor
      } catch (error: any) {
        console.warn(`  ❌ 竞品详情抓取失败 (${asin}):`, error.message)
        return null
      }
    })
    )

    // 收集本批次结果
    allResults.push(...batchResults)
  }

  // Step 5: 过滤成功的结果
  const scrapedCompetitors = allResults
    .filter((r): r is PromiseFulfilledResult<CompetitorProduct | null> =>
      r.status === 'fulfilled' && r.value !== null
    )
    .map(r => r.value!)

  // Step 6: 合并缓存和新抓取的结果
  const allCompetitors = [...cachedCompetitors, ...scrapedCompetitors]

  // 🔥 KISS优化：在详情页抓取后进行品牌过滤（更准确）
  const mainBrandNormalized = mainBrand?.toLowerCase().trim() || null

  // Step 7: 过滤同品牌产品（支持跳过过滤）
  // 🔥 新增（2025-12-17）：针对单商品页面，保留同品牌竞品用于差异化分析
  const afterMainBrandFilter = skipBrandFilter
    ? allCompetitors  // 跳过过滤，保留所有竞品（包括同品牌）
    : mainBrandNormalized
      ? allCompetitors.filter(c => {
          const competitorBrand = c.brand?.toLowerCase().trim() || ''
          const isSameBrand = competitorBrand === mainBrandNormalized ||
                             competitorBrand.includes(mainBrandNormalized) ||
                             mainBrandNormalized.includes(competitorBrand)
          if (isSameBrand) {
            console.log(`🛡️ 过滤同品牌竞品: ${c.asin} - ${c.brand}`)
          }
          return !isSameBrand
        })
      : allCompetitors

  // Step 8: 品类相关性过滤（排除配件/跨品类商品）
  const { kept: relevanceFilteredCompetitors, removed: relevanceRemovedCompetitors } = relevanceContext
    ? filterRelevantCompetitors(afterMainBrandFilter, relevanceContext)
    : { kept: afterMainBrandFilter, removed: [] as CompetitorProduct[] }

  if (relevanceContext) {
    console.log(`🎯 相关性过滤: ${afterMainBrandFilter.length}个 → ${relevanceFilteredCompetitors.length}个`)
    if (relevanceRemovedCompetitors.length > 0) {
      const preview = relevanceRemovedCompetitors
        .slice(0, 3)
        .map((c) => `${c.asin || 'N/A'}:${(c.name || 'Unknown').slice(0, 28)}`)
        .join(', ')
      console.log(`🧹 已剔除疑似非竞品: ${preview}${relevanceRemovedCompetitors.length > 3 ? ' ...' : ''}`)
    }
  }

  // Step 9: 保证品牌多样性（每个品牌最多1个产品）
  // 🔥 修复（2025-12-17）：单商品页面也跳过品牌多样性过滤，保留同品牌的所有竞品
  const diverseCompetitors = skipBrandFilter
    ? relevanceFilteredCompetitors  // 跳过品牌多样性过滤，保留所有同品牌竞品
    : (() => {
        const seenBrands = new Set<string>()
        return relevanceFilteredCompetitors.filter(c => {
          const brand = c.brand?.toLowerCase().trim() || `unknown_${c.asin}`
          if (seenBrands.has(brand)) {
            console.log(`🔄 跳过重复品牌: ${c.asin} - ${c.brand}`)
            return false
          }
          seenBrands.add(brand)
          return true
        })
      })()

  console.log(`✅ 批量抓取完成: 缓存${cachedCompetitors.length}个 + 新抓取${scrapedCompetitors.length}/${asinsToScrape.length}个`)
  if (skipBrandFilter) {
    console.log(`🔄 品牌过滤: 已跳过（单商品页面保留所有同品牌竞品）- ${allCompetitors.length}个可用`)
  } else {
    console.log(`🛡️ 品牌过滤: ${allCompetitors.length}个 → ${afterMainBrandFilter.length}个(排除主品牌) → ${diverseCompetitors.length}个(品牌多样化)`)
  }

  return diverseCompetitors.slice(0, limit)
}

/**
 * 执行AI分析
 * 包括产品分析、评论分析、竞品分析、广告元素提取
 */
export async function executeAIAnalysis(input: AIAnalysisInput): Promise<AIAnalysisResult> {
  const {
    extractResult,
    targetCountry,
    targetLanguage,
    userId,
  } = input

  const result: AIAnalysisResult = {
    aiAnalysisSuccess: false,
    reviewAnalysisSuccess: false,
    competitorAnalysisSuccess: false,
    adExtractionSuccess: false,
    extractedKeywords: [],
    extractedHeadlines: [],
    extractedDescriptions: [],
  }

  try {
    // 🔥 修复：构建页面数据（适配扁平化的extractResult结构）
    const debug = extractResult.debug || {}
    const isAmazonStore = debug.isAmazonStore || false
    const isAmazonProductPage = debug.isAmazonProductPage || false
    const isIndependentStore = debug.isIndependentStore || false

    let pageType: 'product' | 'store' = 'product'
    let pageData: { title: string; description: string; text: string }

    if (isAmazonStore && extractResult.products) {
      pageType = 'store'
      const products = extractResult.products || []
      const productSummaries = products
        .slice(0, 15)
        .map((p: any, i: number) => {
          const hotMarker = i < 5 ? '🔥 ' : '✅ '
          return `${hotMarker}${p.name} - ${p.price || 'N/A'} (Rating: ${p.rating || 'N/A'}, Reviews: ${p.reviews || 0})`
        })
        .join('\n')

      // 🎯 P1优化：增强店铺数据，添加分类和热销洞察
      const textParts = [
        `Store Name: ${extractResult.storeName || extractResult.brand || 'Unknown'}`,
        `Total Products: ${extractResult.productCount || 0}`,
        extractResult.productDescription ? `Description: ${extractResult.productDescription}` : '',
      ]

      // 添加热销洞察
      if (extractResult.hotInsights) {
        textParts.push(
          `\n=== HOT-SELLING INSIGHTS ===`,
          `Average Rating: ${extractResult.hotInsights.avgRating?.toFixed(1) || 'N/A'}`,
          `Average Reviews: ${extractResult.hotInsights.avgReviews?.toFixed(0) || 'N/A'}`,
          `Top Products Count: ${extractResult.hotInsights.topProductsCount || 0}`
        )
      }

      // 添加产品分类信息
      if (extractResult.productCategories?.primaryCategories && extractResult.productCategories.primaryCategories.length > 0) {
        const categories = extractResult.productCategories.primaryCategories
          .slice(0, 5)
          .map(c => `${c.name} (${c.count} products)`)
          .join(', ')
        textParts.push(
          `\n=== PRODUCT CATEGORIES ===`,
          categories
        )
      }

      // 添加热销产品列表
      textParts.push('\n=== HOT-SELLING PRODUCTS (Top 15) ===', productSummaries)

      // 🔥 2025-12-13诊断：追踪deepScrapeResults数据流
      const dsr = extractResult.deepScrapeResults
      console.log(`🔍 [STORE] deepScrapeResults诊断:`)
      console.log(`  - deepScrapeResults存在: ${!!dsr}`)
      if (dsr) {
        console.log(`  - aggregatedFeatures数量: ${dsr.aggregatedFeatures?.length ?? '(undefined)'}`)
        console.log(`  - aggregatedReviews数量: ${dsr.aggregatedReviews?.length ?? '(undefined)'}`)
        console.log(`  - aggregatedCompetitorAsins数量: ${dsr.aggregatedCompetitorAsins?.length ?? '(undefined)'}`)
        console.log(`  - topProducts数量: ${dsr.topProducts?.length ?? '(undefined)'}`)
        console.log(`  - successCount: ${dsr.successCount ?? '(undefined)'}`)
        if (dsr.aggregatedFeatures && dsr.aggregatedFeatures.length > 0) {
          console.log(`  - 首条feature: ${dsr.aggregatedFeatures[0]?.substring(0, 60)}...`)
        }
      }

      // 🔥 修复（2025-12-11）：添加深度抓取的聚合特性数据，用于生成"产品亮点"
      if (extractResult.deepScrapeResults?.aggregatedFeatures &&
          extractResult.deepScrapeResults.aggregatedFeatures.length > 0) {
        const features = extractResult.deepScrapeResults.aggregatedFeatures
          .slice(0, 15)  // 限制最多15条特性
          .map((f: string) => `- ${f}`)
          .join('\n')
        textParts.push(
          `\n=== PRODUCT FEATURES (Aggregated from Hot-Selling Products) ===`,
          features
        )
        console.log(`📊 [STORE] 添加聚合特性到AI分析输入: ${extractResult.deepScrapeResults.aggregatedFeatures.length}条`)
      }

      // 🔥 修复（2025-12-11）：添加深度抓取的评论摘要，用于生成"评论分析"
      if (extractResult.deepScrapeResults?.aggregatedReviews &&
          extractResult.deepScrapeResults.aggregatedReviews.length > 0) {
        const reviewSummaries = extractResult.deepScrapeResults.aggregatedReviews
          .slice(0, 10)  // 限制最多10条评论摘要
          .map((r: string) => `- ${r.substring(0, 200)}${r.length > 200 ? '...' : ''}`)
          .join('\n')
        textParts.push(
          `\n=== REVIEW HIGHLIGHTS (Aggregated from Hot-Selling Products) ===`,
          reviewSummaries
        )
        console.log(`📊 [STORE] 添加聚合评论到AI分析输入: ${extractResult.deepScrapeResults.aggregatedReviews.length}条`)
      }

      pageData = {
        title: extractResult.storeName || extractResult.brand || 'Unknown Store',
        description: extractResult.productDescription || extractResult.storeDescription || '',
        text: textParts.filter(Boolean).join('\n'),
      }
    } else if (isIndependentStore && extractResult.products) {
      pageType = 'store'
      const products = extractResult.products || []
      const productSummaries = products
        .slice(0, 15)
        .map((p: any, i: number) => `${i + 1}. ${p.name} - ${p.price || 'N/A'}`)
        .join('\n')

      // 🔥 修复（2025-12-11）：独立站也支持深度抓取数据
      const textParts = [
        `Store Name: ${extractResult.storeName}`,
        `Platform: ${extractResult.platform || 'Unknown'}`,
        `Total Products: ${extractResult.productCount}`,
        extractResult.productDescription ? `Description: ${extractResult.productDescription}` : '',
        '\n=== PRODUCTS ===',
        productSummaries,
      ]

      // 添加聚合特性（如果有）
      if (extractResult.deepScrapeResults?.aggregatedFeatures &&
          extractResult.deepScrapeResults.aggregatedFeatures.length > 0) {
        const features = extractResult.deepScrapeResults.aggregatedFeatures
          .slice(0, 15)
          .map((f: string) => `- ${f}`)
          .join('\n')
        textParts.push(
          `\n=== PRODUCT FEATURES ===`,
          features
        )
      }

      // 添加聚合评论（如果有）
      if (extractResult.deepScrapeResults?.aggregatedReviews &&
          extractResult.deepScrapeResults.aggregatedReviews.length > 0) {
        const reviewSummaries = extractResult.deepScrapeResults.aggregatedReviews
          .slice(0, 10)
          .map((r: string) => `- ${r.substring(0, 200)}${r.length > 200 ? '...' : ''}`)
          .join('\n')
        textParts.push(
          `\n=== REVIEW HIGHLIGHTS ===`,
          reviewSummaries
        )
      }

      pageData = {
        title: extractResult.storeName || extractResult.brand || 'Unknown Store',
        description: extractResult.productDescription || '',
        text: textParts.filter(Boolean).join('\n'),
      }
    } else if (isAmazonProductPage && extractResult.productName) {
      pageType = 'product'
      // 🎯 P1优化：添加未使用的数据字段（rating, reviewCount, category）
      const textParts = [
        `Product: ${extractResult.productName || 'Unknown'}`,
        `Brand: ${extractResult.brand || 'Unknown'}`,
        `Category: ${extractResult.category || 'General'}`,
        `Price: ${extractResult.productPrice || 'N/A'}`,
      ]

      // 添加评分和评论数
      if (extractResult.rating || extractResult.reviewCount) {
        textParts.push(
          `Rating: ${extractResult.rating || 'N/A'}`,
          `Reviews: ${extractResult.reviewCount || 'N/A'}`
        )
      }

      // 添加产品描述
      if (extractResult.productDescription) {
        textParts.push(`\nDescription:\n${extractResult.productDescription}`)
      }

      pageData = {
        title: extractResult.productName || extractResult.brand || 'Unknown Product',
        description: extractResult.productDescription || '',
        text: textParts.filter(Boolean).join('\n'),
      }
    } else {
      // 通用产品页面
      pageType = 'product'
      pageData = {
        title: extractResult.brand || 'Unknown Product',
        description: extractResult.productDescription || '',
        text: [
          extractResult.brand ? `Brand: ${extractResult.brand}` : '',
          extractResult.productDescription ? `\nDescription:\n${extractResult.productDescription}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      }
    }

    // 调用AI分析
    console.log(`🤖 开始AI产品分析 (页面类型: ${pageType})...`)
    const aiProductInfo = await analyzeProductPage(
      {
        url: extractResult.finalUrl,
        brand: extractResult.brand || 'Unknown',
        title: pageData.title,
        description: pageData.description,
        text: pageData.text,
        targetCountry,
        pageType,
        // 🔥 2026-01-04新增：传递独立站增强数据字段到AI分析
        reviews: extractResult.reviews,
        faqs: extractResult.faqs,
        specifications: extractResult.specifications,
        packages: extractResult.packages,
        socialProof: extractResult.socialProof,
        coreFeatures: extractResult.coreFeatures,
        secondaryFeatures: extractResult.secondaryFeatures,
        // P1优化字段
        technicalDetails: extractResult.technicalDetails,
        reviewHighlights: extractResult.reviewHighlights,
      },
      userId
    )

    result.aiAnalysisSuccess = true
    result.aiProductInfo = aiProductInfo
    console.log('✅ AI产品分析完成')

    // ========== P0评论深度分析 ==========
    if (input.enableReviewAnalysis) {
      try {
        console.log(`🔍 开始评论分析...`)

        // 🔥 修复：从扁平化的extractResult中提取评论数据
        const reviews: RawReview[] = []
        const debug = extractResult.debug || {}
        const isAmazonProductPage = debug.isAmazonProductPage || false
        const isAmazonStore = debug.isAmazonStore || false

        // 🔍 诊断日志：验证数据传递 (UPDATED: 2025-12-08 13:50)
        console.log(`🔍 [FIX-V2] 评论分析上下文:`)
        console.log(`  - isAmazonStore: ${isAmazonStore}`)
        console.log(`  - isAmazonProductPage: ${isAmazonProductPage}`)
        console.log(`  - products: ${extractResult.products?.length || 0}个`)
        console.log(`  - pageType: ${extractResult.pageType || 'unknown'}`)
        console.log(`  - enablePlaywrightDeepScraping: ${input.enablePlaywrightDeepScraping || false}`)
        console.log(`  - debug存在: ${!!debug}`)
        console.log(`  - debug内容:`, JSON.stringify(debug, null, 2))

        // 🔥 新增（2025-12-08）：Playwright深度评论抓取（与手动创建流程一致）
        // 当 enablePlaywrightDeepScraping=true 且是Amazon单品页面时，使用Playwright抓取30条真实评论
        if (isAmazonProductPage && input.enablePlaywrightDeepScraping && extractResult.finalUrl) {
          console.log(`🚀 [DEEP SCRAPE] 启用Playwright深度评论抓取（30条评论）...`)

          try {
            const { getPlaywrightPool } = await import('@/lib/playwright-pool')
            const { scrapeAmazonReviews } = await import('@/lib/review-analyzer')
            const pool = getPlaywrightPool()

            let deepScrapeProxyUrl: string | undefined
            try {
              deepScrapeProxyUrl = await getProxyUrlForCountry(targetCountry, userId) || undefined
            } catch {
              deepScrapeProxyUrl = undefined
            }
            console.log(`🔧 [DEEP SCRAPE] 评论抓取代理: ${deepScrapeProxyUrl ? '已配置' : '未配置'}`)

            const { context, instanceId } = await pool.acquire(deepScrapeProxyUrl, undefined, targetCountry)
            const page = await context.newPage()

            try {
              await page.goto(extractResult.finalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
              const scrapedReviews = await scrapeAmazonReviews(page, 30)

              if (scrapedReviews.length > 0) {
                console.log(`✅ Playwright抓取${scrapedReviews.length}条评论，执行AI分析...`)
                const reviewAnalysis = await analyzeReviewsWithAI(
                  scrapedReviews,
                  extractResult.brand || extractResult.productName || 'Unknown Product',
                  targetCountry,
                  userId,
                  { enableCompression: true, enableCache: true, cacheKey: extractResult.finalUrl }
                )

                result.reviewAnalysis = reviewAnalysis
                result.reviewAnalysisSuccess = true
                console.log(`✅ [DEEP SCRAPE] 评论深度分析完成 (${scrapedReviews.length}条真实评论)`)
              } else {
                console.log('⚠️ [DEEP SCRAPE] Playwright未抓取到评论，使用备用数据')
                // 降级到使用已抓取的topReviews数据
              }
            } finally {
              await page.close()
              pool.release(instanceId)
            }
          } catch (playwrightError: any) {
            console.warn(`⚠️ [DEEP SCRAPE] Playwright评论抓取失败，降级使用已抓取数据:`, playwrightError.message)
            // 降级逻辑会在下面的else分支处理
          }
        }

        // 🔥 原有逻辑：单品页面使用已抓取的 topReviews 数据进行评论分析（作为备用方案）
        // 只有在 Playwright 深度抓取未执行或失败时才使用
        if (isAmazonProductPage && !result.reviewAnalysisSuccess) {
          // 检查是否有已抓取的评论数据
          const topReviews = extractResult.topReviews || []
          const reviewHighlights = extractResult.reviewHighlights || []

          if (topReviews.length > 0 || reviewHighlights.length > 0) {
            console.log(`📊 单品页面：使用已抓取的评论数据 (${topReviews.length}条评论, ${reviewHighlights.length}条高亮)...`)

            // 将 topReviews（string[]）转换为 RawReview[] 格式
            // topReviews 格式："4.5 stars - Title: Review text..."
            topReviews.forEach((reviewStr: string) => {
              // 解析评论字符串
              const ratingMatch = reviewStr.match(/^([\d.]+)\s*(?:out of 5\s*)?stars?\s*-?\s*/i)
              const rating = ratingMatch ? `${ratingMatch[1]} out of 5 stars` : null
              const textWithoutRating = ratingMatch ? reviewStr.replace(ratingMatch[0], '') : reviewStr

              // 尝试分离标题和正文
              const titleMatch = textWithoutRating.match(/^([^:]+):\s*(.+)$/)
              const title = titleMatch ? titleMatch[1].trim() : null
              const body = titleMatch ? titleMatch[2].trim() : textWithoutRating.trim()

              reviews.push({
                rating,
                title,
                body,
                helpful: null,
                verified: false,
                date: new Date().toISOString(),
                author: 'Amazon Reviewer',
              })
            })

            // 添加评论高亮作为摘要评论
            reviewHighlights.forEach((highlight: string) => {
              reviews.push({
                rating: extractResult.rating || null,
                title: 'Review Highlight',
                body: highlight,
                helpful: null,
                verified: true,
                date: new Date().toISOString(),
                author: 'Multiple Reviewers',
              })
            })

            if (reviews.length > 0) {
              const reviewAnalysis = await analyzeReviewsWithAI(
                reviews,
                extractResult.brand || extractResult.productName || 'Unknown Product',
                targetCountry,
                userId,
                { enableCompression: true, enableCache: true, cacheKey: extractResult.finalUrl }
              )

              result.reviewAnalysis = reviewAnalysis
              result.reviewAnalysisSuccess = true
              console.log(`✅ 单品页面评论分析完成 (${reviews.length}条评论)`)
            } else {
              console.log('⚠️ 单品页面未找到有效评论数据')
              result.reviewAnalysisSuccess = true  // 不视为失败
            }
          } else {
            console.log('ℹ️ 单品页面无评论数据可分析')
            result.reviewAnalysisSuccess = true  // 不视为失败
          }
        }
        // 🔥 修复（2025-12-11）：店铺页面评论分析优化
        // 问题：之前只使用 products[].rating/reviewCount，数据质量差
        // 修复：优先使用 deepScrapeResults.aggregatedReviews（真实评论数据）
        else if (isAmazonStore) {
          // 🔥 优先使用深度抓取的聚合评论数据
          const deepResults = extractResult.deepScrapeResults
          const aggregatedReviews = deepResults?.aggregatedReviews || []
          const aggregatedFeatures = deepResults?.aggregatedFeatures || []

          console.log(`🔍 [STORE] deepScrapeResults检查:`)
          console.log(`  - aggregatedReviews: ${aggregatedReviews.length}条`)
          console.log(`  - aggregatedFeatures: ${aggregatedFeatures.length}条`)
          console.log(`  - products: ${extractResult.products?.length || 0}个`)

          // 策略1: 使用深度抓取的真实评论数据（最优）
          if (aggregatedReviews.length > 0) {
            console.log(`📊 [STORE] 使用深度抓取的聚合评论数据 (${aggregatedReviews.length}条真实评论)...`)

            // 将聚合评论数据转换为RawReview格式
            aggregatedReviews.forEach((reviewStr: string) => {
              // 解析评论字符串（格式同单品页面）
              const ratingMatch = reviewStr.match(/^([\d.]+)\s*(?:out of 5\s*)?stars?\s*-?\s*/i)
              const rating = ratingMatch ? `${ratingMatch[1]} out of 5 stars` : null
              const textWithoutRating = ratingMatch ? reviewStr.replace(ratingMatch[0], '') : reviewStr

              // 尝试分离标题和正文
              const titleMatch = textWithoutRating.match(/^([^:]+):\s*(.+)$/)
              const title = titleMatch ? titleMatch[1].trim() : null
              const body = titleMatch ? titleMatch[2].trim() : textWithoutRating.trim()

              reviews.push({
                rating,
                title,
                body,
                helpful: null,
                verified: false,
                date: new Date().toISOString(),
                author: 'Amazon Reviewer',
              })
            })

            if (reviews.length > 0) {
              const reviewAnalysis = await analyzeReviewsWithAI(
                reviews,
                extractResult.brand || extractResult.storeName || 'Unknown Store',
                targetCountry,
                userId,
                { enableCompression: true, enableCache: true, cacheKey: extractResult.finalUrl }
              )

              result.reviewAnalysis = reviewAnalysis
              result.reviewAnalysisSuccess = true
              console.log(`✅ [STORE] 评论分析完成 (${reviews.length}条深度抓取评论)`)
            }
          }
          // 策略2: 从topProducts的reviews中提取（备用）
          else if (deepResults?.topProducts && deepResults.topProducts.length > 0) {
            console.log(`📊 [STORE] 从topProducts提取评论数据...`)

            for (const topProduct of deepResults.topProducts) {
              const productReviews = topProduct.reviews || []
              const productHighlights = topProduct.reviewHighlights || []

              productReviews.forEach((reviewStr: string) => {
                const ratingMatch = reviewStr.match(/^([\d.]+)\s*(?:out of 5\s*)?stars?\s*-?\s*/i)
                const rating = ratingMatch ? `${ratingMatch[1]} out of 5 stars` : null
                const textWithoutRating = ratingMatch ? reviewStr.replace(ratingMatch[0], '') : reviewStr

                reviews.push({
                  rating,
                  title: null,
                  body: textWithoutRating.trim(),
                  helpful: null,
                  verified: false,
                  date: new Date().toISOString(),
                  author: 'Amazon Reviewer',
                })
              })

              productHighlights.forEach((highlight: string) => {
                reviews.push({
                  rating: null,
                  title: 'Review Highlight',
                  body: highlight,
                  helpful: null,
                  verified: true,
                  date: new Date().toISOString(),
                  author: 'Multiple Reviewers',
                })
              })
            }

            if (reviews.length > 0) {
              const reviewAnalysis = await analyzeReviewsWithAI(
                reviews,
                extractResult.brand || extractResult.storeName || 'Unknown Store',
                targetCountry,
                userId,
                { enableCompression: true, enableCache: true, cacheKey: extractResult.finalUrl }
              )

              result.reviewAnalysis = reviewAnalysis
              result.reviewAnalysisSuccess = true
              console.log(`✅ [STORE] 评论分析完成 (${reviews.length}条topProducts评论)`)
            }
          }
          // 策略3: 无深度数据，标记成功但跳过分析（避免阻塞）
          else if (!extractResult.products || extractResult.products.length === 0) {
            console.log(`⚠️ [STORE] 无深度抓取数据且无产品列表，跳过评论分析`)
            result.reviewAnalysisSuccess = true
          }
          // 策略4: 降级使用产品列表基础数据（最后方案）
          else {
            console.log(`📊 [STORE] 降级：从产品列表提取基础评论信息 (${extractResult.products.length}个产品)...`)
            extractResult.products.forEach((product: any) => {
              if (product.rating && product.reviews > 0) {
                reviews.push({
                  rating: typeof product.rating === 'number'
                    ? `${product.rating} out of 5 stars`
                    : product.rating,
                  title: product.name || null,
                  body: product.name || null,
                  helpful: null,
                  verified: false,
                  date: new Date().toISOString(),
                  author: 'Unknown',
                })
              }
            })

            if (reviews.length > 0) {
              const reviewAnalysis = await analyzeReviewsWithAI(
                reviews,
                extractResult.brand || 'Unknown Product',
                targetCountry,
                userId,
                { enableCompression: true, enableCache: true, cacheKey: extractResult.finalUrl }
              )

              result.reviewAnalysis = reviewAnalysis
              result.reviewAnalysisSuccess = true
              console.log(`✅ [STORE] 评论分析完成 (${reviews.length}条基础评论)`)
            } else {
              console.log('⚠️ [STORE] 产品中未找到评论数据')
              result.reviewAnalysisSuccess = true
            }
          }
        }
        // 非Amazon店铺，但有产品数据（独立站等）
        else if (extractResult.products && extractResult.products.length > 0) {
          console.log(`📊 从店铺产品中提取评论信息 (${extractResult.products.length}个产品)...`)
          extractResult.products.forEach((product: any) => {
            if (product.rating && product.reviews > 0) {
              reviews.push({
                rating: typeof product.rating === 'number'
                  ? `${product.rating} out of 5 stars`
                  : product.rating,
                title: product.name || null,
                body: product.name || null,
                helpful: null,
                verified: false,
                date: new Date().toISOString(),
                author: 'Unknown',
              })
            }
          })

          if (reviews.length > 0) {
            const reviewAnalysis = await analyzeReviewsWithAI(
              reviews,
              extractResult.brand || 'Unknown Product',
              targetCountry,
              userId,
              { enableCompression: true, enableCache: true, cacheKey: extractResult.finalUrl }
            )

            result.reviewAnalysis = reviewAnalysis
            result.reviewAnalysisSuccess = true
            console.log(`✅ 评论分析完成 (${reviews.length}条评论)`)
          } else {
            console.log('⚠️ 店铺产品中未找到评论数据')
            result.reviewAnalysisSuccess = true  // 不视为失败
          }
        }
        // 🔥 修复（2026-01-04）：独立站单品页面评论分析
        // 问题：独立站单品页面的extractResult.reviews数组有评论数据，但之前的代码没有使用
        // 修复：检查extractResult.reviews数组，如果有数据则执行评论分析
        else if (extractResult.reviews && extractResult.reviews.length > 0 && !result.reviewAnalysisSuccess) {
          console.log(`📊 独立站单品页面：使用已抓取的评论数据 (${extractResult.reviews.length}条评论)...`)

          // 将独立站评论数据转换为RawReview格式
          extractResult.reviews.forEach((review: any) => {
            reviews.push({
              rating: review.rating ? `${review.rating} out of 5 stars` : null,
              title: review.title || null,
              body: review.body || '',
              helpful: null,
              verified: review.verifiedBuyer || false,
              date: review.date || new Date().toISOString(),
              author: review.author || 'Reviewer',
            })
          })

          if (reviews.length > 0) {
            const reviewAnalysis = await analyzeReviewsWithAI(
              reviews,
              extractResult.brand || extractResult.productName || 'Unknown Product',
              targetCountry,
              userId,
              { enableCompression: true, enableCache: true, cacheKey: extractResult.finalUrl }
            )

            result.reviewAnalysis = reviewAnalysis
            result.reviewAnalysisSuccess = true
            console.log(`✅ 独立站单品页面评论分析完成 (${reviews.length}条评论)`)
          } else {
            console.log('⚠️ 独立站单品页面评论数据转换后为空')
            result.reviewAnalysisSuccess = true
          }
        } else {
          console.log('ℹ️ 非店铺页面，评论分析将由后续流程处理')
          result.reviewAnalysisSuccess = true  // 标记为成功，让后续流程继续
        }
      } catch (error: any) {
        console.error('⚠️ 评论分析失败（不影响流程）:', error.message)
        result.reviewAnalysisSuccess = false
      }
    }

    // ========== P0竞品对比分析 ==========
    if (input.enableCompetitorAnalysis) {
      try {
        console.log(`🔍 开始竞品分析...`)

        // 🔥 修复：从扁平化的extractResult中构建竞品数据
        const competitors: CompetitorProduct[] = []
        const debug = extractResult.debug || {}
        const isAmazonProductPage = debug.isAmazonProductPage || false
        const isAmazonStore = debug.isAmazonStore || false

        // 🔍 诊断日志：验证数据传递
        console.log(`🔍 竞品分析上下文:`)
        console.log(`  - isAmazonStore: ${isAmazonStore}`)
        console.log(`  - isAmazonProductPage: ${isAmazonProductPage}`)
        console.log(`  - products: ${extractResult.products?.length || 0}个`)
        console.log(`  - pageType: ${extractResult.pageType || 'unknown'}`)
        console.log(`  - enablePlaywrightDeepScraping: ${input.enablePlaywrightDeepScraping || false}`)
        console.log(`  - debug存在: ${!!debug}`)
        console.log(`  - debug内容:`, JSON.stringify(debug, null, 2))

        // 🔥 新增（2025-12-08）：Playwright深度竞品抓取（与手动创建流程一致）
        // 优先使用已提取的relatedAsins，避免重复抓取
        // 只有在没有relatedAsins或数量不足时，才启用Playwright深度抓取
        const competitorRelevanceContext = createCompetitorRelevanceContext({
          productName: extractResult.productName || null,
          category: extractResult.category || extractResult.productCategory || null,
          productCategory: extractResult.productCategory || null,
          features: extractResult.features || [],
          aboutThisItem: extractResult.aboutThisItem || [],
        })
        console.log(
          `🎯 竞品相关性模式: ${competitorRelevanceContext.mode}, 信号词: ${competitorRelevanceContext.requiredSignals.slice(0, 5).join(', ')}`
        )

        const hasRelatedAsins = extractResult.relatedAsins && extractResult.relatedAsins.length > 0

        if (isAmazonProductPage && !hasRelatedAsins && input.enablePlaywrightDeepScraping && extractResult.finalUrl) {
          console.log(`🚀 [DEEP SCRAPE] 未找到已提取的竞品ASIN，启用Playwright深度抓取（5个竞品）...`)

          try {
            const { getPlaywrightPool } = await import('@/lib/playwright-pool')
            const { scrapeAmazonCompetitors } = await import('@/lib/competitor-analyzer')
            const pool = getPlaywrightPool()

            let deepScrapeProxyUrl: string | undefined
            try {
              deepScrapeProxyUrl = await getProxyUrlForCountry(targetCountry, userId) || undefined
            } catch {
              deepScrapeProxyUrl = undefined
            }
            console.log(`🔧 [DEEP SCRAPE] 竞品抓取代理: ${deepScrapeProxyUrl ? '已配置' : '未配置'}`)

            const { context, instanceId } = await pool.acquire(deepScrapeProxyUrl, undefined, targetCountry)
            const page = await context.newPage()

            try {
              await page.goto(extractResult.finalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
              const scrapedCompetitors = await scrapeAmazonCompetitors(page, 5)
              const { kept: relevantScrapedCompetitors, removed: removedScrapedCompetitors } =
                filterRelevantCompetitors(scrapedCompetitors, competitorRelevanceContext)

              if (removedScrapedCompetitors.length > 0) {
                console.log(`🧹 [DEEP SCRAPE] 相关性过滤移除${removedScrapedCompetitors.length}个非竞品`)
              }

              if (relevantScrapedCompetitors.length > 0) {
                console.log(`✅ Playwright抓取${relevantScrapedCompetitors.length}个竞品，执行AI分析...`)

                // 从产品数据构建"我们的产品"对象
                // 🔧 修复：使用统一价格解析函数处理欧洲/美国格式
                const priceNum = parsePrice(extractResult.productPrice)

                const ourProduct = {
                  name: extractResult.productName || extractResult.brand || 'Unknown Product',
                  brand: extractResult.brand || null,
                  price: priceNum,
                  rating: extractResult.rating ? parseFloat(extractResult.rating) : null,
                  reviewCount: extractResult.reviewCount ? parseInt(extractResult.reviewCount.replace(/[^0-9]/g, ''), 10) : null,
                  features: extractResult.features || extractResult.aboutThisItem || [],
                }

                const competitorAnalysis = await analyzeCompetitorsWithAI(
                  ourProduct,
                  relevantScrapedCompetitors,
                  targetCountry,
                  userId,
                  { enableCompression: true, enableCache: true }
                )

                result.competitorAnalysis = competitorAnalysis
                result.competitorAnalysisSuccess = true
                console.log(`✅ [DEEP SCRAPE] 竞品深度分析完成 (${relevantScrapedCompetitors.length}个真实竞品)`)
              } else {
                // 🔥 修复（2025-12-10）：Playwright深度抓取失败时，尝试搜索补充策略
                console.log('⚠️ [DEEP SCRAPE] Playwright未抓取到竞品，尝试搜索补充策略...')

                // 尝试使用搜索策略获取竞品
                try {
                  const competitorProxyUrl = await getProxyUrlForCountry(targetCountry, userId)
                  const priceNum = parsePrice(extractResult.productPrice)

                  const ourProduct = {
                    name: extractResult.productName || extractResult.brand || 'Unknown Product',
                    brand: extractResult.brand || null,
                    price: priceNum,
                    rating: extractResult.rating ? parseFloat(extractResult.rating) : null,
                    reviewCount: extractResult.reviewCount ? parseInt(extractResult.reviewCount.replace(/[^0-9]/g, ''), 10) : null,
                    features: extractResult.features || extractResult.aboutThisItem || [],
                  }

                  // AI推断搜索关键词
                  const searchTerms = await inferCompetitorKeywords({
                    name: extractResult.productName || 'Unknown Product',
                    brand: extractResult.brand || null,
                    category: extractResult.category || extractResult.productCategory || 'Unknown',
                    price: ourProduct.price,
                    targetCountry,
                    features: extractResult.features || [],
                    aboutThisItem: extractResult.aboutThisItem || [],
                  }, userId)

                  if (searchTerms.length > 0) {
                    console.log(`🔍 [搜索策略] 搜索关键词: ${searchTerms.slice(0, 3).join(', ')}`)

                    const { getPlaywrightPool } = await import('@/lib/playwright-pool')
                    const searchPool = getPlaywrightPool()
                    const searchInstance = await searchPool.acquire(competitorProxyUrl, undefined, targetCountry)

                    try {
                      const searchPage = await searchInstance.context.newPage()

                      try {
                        const searchCompetitors = await searchCompetitorsOnAmazon(
                          searchTerms.slice(0, 3),
                          searchPage,
                          targetCountry,
                          2
                        )

                        // 过滤同品牌产品
                        const mainBrandLower = (extractResult.brand || '').toLowerCase()
                        const filteredCompetitors = searchCompetitors.filter(c => {
                          const cBrand = (c.brand || '').toLowerCase()
                          return !cBrand.includes(mainBrandLower) && !mainBrandLower.includes(cBrand)
                        })
                        const { kept: relevantFilteredCompetitors, removed: removedFilteredCompetitors } =
                          filterRelevantCompetitors(filteredCompetitors, competitorRelevanceContext)

                        if (removedFilteredCompetitors.length > 0) {
                          console.log(`🧹 [搜索策略] 相关性过滤移除${removedFilteredCompetitors.length}个非竞品`)
                        }

                        if (relevantFilteredCompetitors.length > 0) {
                          console.log(`✅ [搜索策略] 获取${relevantFilteredCompetitors.length}个有效竞品`)

                          const competitorAnalysis = await analyzeCompetitorsWithAI(
                            ourProduct,
                            relevantFilteredCompetitors,
                            targetCountry,
                            userId,
                            { enableCompression: true, enableCache: true }
                          )

                          result.competitorAnalysis = competitorAnalysis
                          result.competitorAnalysisSuccess = true
                          console.log(`✅ [搜索策略] 竞品分析完成 (${relevantFilteredCompetitors.length}个真实竞品)`)
                        } else {
                          console.log('⚠️ [搜索策略] 未获取到有效竞品，降级到市场定位分析')
                        }
                      } finally {
                        await searchPage.close()
                      }
                    } finally {
                      searchPool.release(searchInstance.instanceId)
                    }
                  } else {
                    console.log('⚠️ [搜索策略] 无法生成搜索关键词，降级到市场定位分析')
                  }
                } catch (searchError: any) {
                  console.warn(`⚠️ [搜索策略] 搜索补充失败: ${searchError.message}`)
                }
              }
            } finally {
              await page.close()
              pool.release(instanceId)
            }
          } catch (playwrightError: any) {
            console.warn(`⚠️ [DEEP SCRAPE] Playwright竞品抓取失败，降级使用市场定位分析:`, playwrightError.message)
            // 降级逻辑会在下面的else分支处理
          }
        } else if (isAmazonProductPage && hasRelatedAsins) {
          // 🔥 新增（2025-12-09）：使用已提取的竞品ASIN，避免重复抓取
          console.log(`✅ 复用已提取的${extractResult.relatedAsins!.length}个竞品ASIN（已过滤同品牌产品）`)

          try {
            // 🔥 修复（2025-12-09）：动态获取代理URL（与商品抓取保持一致）
            const competitorProxyUrl = await getProxyUrlForCountry(targetCountry, userId)
            console.log(`🔧 竞品抓取代理: ${competitorProxyUrl ? '已配置' : '未配置'}`)

            // 构建"我们的产品"对象
            // 🔧 修复：使用统一价格解析函数处理欧洲/美国格式
            const priceNum = parsePrice(extractResult.productPrice)

            const ourProduct = {
              name: extractResult.productName || extractResult.brand || 'Unknown Product',
              brand: extractResult.brand || null,
              price: priceNum,
              rating: extractResult.rating ? parseFloat(extractResult.rating) : null,
              reviewCount: extractResult.reviewCount ? parseInt(extractResult.reviewCount.replace(/[^0-9]/g, ''), 10) : null,
              features: extractResult.features || extractResult.aboutThisItem || [],
            }

            // 🔥 KISS优化（2025-12-10）：双重策略获取竞品
            // 策略1：优先使用relatedAsins（推荐区域，速度快）
            // 策略2：如果竞品不足，使用搜索结果补充（更准确）
            const MIN_COMPETITORS = 3  // 最少需要3个有效竞品
            const TARGET_COMPETITORS = 5  // 目标5个竞品

            // 🔥 修复（2025-12-17）：单商品页面保留同品牌竞品用于差异化分析
            let competitors = await batchScrapeCompetitorDetails(
              extractResult.relatedAsins!,
              targetCountry,
              extractResult.brand || null,
              competitorProxyUrl,
              TARGET_COMPETITORS,
              isAmazonProductPage,  // 单商品页面跳过品牌过滤
              competitorRelevanceContext
            )

            console.log(`📊 [策略1] relatedAsins获取: ${competitors.length}个有效竞品`)

            // 🔥 策略2：如果竞品不足，使用Amazon搜索补充
            if (competitors.length < MIN_COMPETITORS) {
              console.log(`⚠️ relatedAsins竞品不足(${competitors.length}<${MIN_COMPETITORS})，启用搜索补充...`)

              try {
                // Step 1: AI推断搜索关键词
                const searchTerms = await inferCompetitorKeywords({
                  name: extractResult.productName || 'Unknown Product',
                  brand: extractResult.brand || null,
                  category: extractResult.category || extractResult.productCategory || 'Unknown',
                  price: ourProduct.price,
                  targetCountry,
                  features: extractResult.features || [],
                  aboutThisItem: extractResult.aboutThisItem || [],
                }, userId)

                if (searchTerms.length > 0) {
                  console.log(`🔍 [策略2] 搜索关键词: ${searchTerms.slice(0, 3).join(', ')}`)

                  // Step 2: 使用Playwright执行搜索
                  const { getPlaywrightPool } = await import('@/lib/playwright-pool')
                  const pool = getPlaywrightPool()
                  // 🔥 修复：acquire() 返回 { browser, context, instanceId }
                  const instance = await pool.acquire(competitorProxyUrl, undefined, targetCountry)

                  try {
                    // 从 context 创建新页面
                    const page = await instance.context.newPage()

                    try {
                      // Step 3: 执行Amazon搜索
                      const searchCompetitors = await searchCompetitorsOnAmazon(
                        searchTerms.slice(0, 3),  // 最多搜索3个词
                        page,
                        targetCountry,
                        2  // 每个词取2个结果
                      )

                      // Step 4: 过滤同品牌产品
                      const mainBrandLower = (extractResult.brand || '').toLowerCase()
                      const filteredSearchCompetitors = searchCompetitors.filter(c => {
                        const cBrand = (c.brand || '').toLowerCase()
                        return !cBrand.includes(mainBrandLower) && !mainBrandLower.includes(cBrand)
                      })
                      const { kept: relevantSearchCompetitors, removed: removedSearchCompetitors } =
                        filterRelevantCompetitors(filteredSearchCompetitors, competitorRelevanceContext)

                      if (removedSearchCompetitors.length > 0) {
                        console.log(`🧹 [策略2] 相关性过滤移除${removedSearchCompetitors.length}个非竞品`)
                      }

                      console.log(`✅ [策略2] 搜索获取: ${relevantSearchCompetitors.length}个有效竞品`)

                      // Step 5: 合并两个来源，去重
                      const existingAsins = new Set(competitors.map(c => c.asin))
                      for (const sc of relevantSearchCompetitors) {
                        if (!existingAsins.has(sc.asin) && competitors.length < TARGET_COMPETITORS) {
                          competitors.push(sc)
                          existingAsins.add(sc.asin)
                        }
                      }

                      console.log(`📊 [合并] 最终竞品数量: ${competitors.length}个`)
                    } finally {
                      await page.close()
                    }
                  } finally {
                    pool.release(instance.instanceId)
                  }
                }
              } catch (searchError: any) {
                console.warn(`⚠️ 搜索补充失败: ${searchError.message}`)
                // 继续使用已有的competitors
              }
            }

            if (competitors.length > 0) {
              // 使用完整的竞品数据进行分析
              const competitorAnalysis = await analyzeCompetitorsWithAI(
                ourProduct,
                competitors,
                targetCountry,
                userId,
                { enableCompression: true, enableCache: true }
              )

              result.competitorAnalysis = competitorAnalysis
              result.competitorAnalysisSuccess = true
              console.log(`✅ [DETAILED COMPETITORS] 竞品详细分析完成 (${competitors.length}个完整竞品数据)`)
            } else {
              // 降级：使用简化的ASIN列表（无详情）
              console.warn(`⚠️ 竞品详情抓取全部失败，使用简化ASIN分析`)

              const simplifiedCompetitors: CompetitorProduct[] = extractResult.relatedAsins!.slice(0, 5).map(asin => ({
                asin,
                name: `Competitor Product ${asin}`,
                brand: 'Unknown',
                price: null,
                priceText: null,
                rating: null,
                reviewCount: null,
                imageUrl: null,
                source: 'same_category' as const,
                features: [],
              }))

              const competitorAnalysis = await analyzeCompetitorsWithAI(
                ourProduct,
                simplifiedCompetitors,
                targetCountry,
                userId,
                { enableCompression: true, enableCache: true }
              )

              result.competitorAnalysis = competitorAnalysis
              result.competitorAnalysisSuccess = true
              console.log(`✅ [SIMPLIFIED ASINS] 竞品简化分析完成 (${simplifiedCompetitors.length}个ASIN)`)
            }
          } catch (error: any) {
            console.warn(`⚠️ [REUSE ASINS] 竞品分析失败:`, error.message)
            // 降级到市场定位分析
          }
        }

        // 🔥 原有逻辑：单品页面使用市场定位分析（作为备用方案）
        // 只有在 Playwright 深度抓取未执行或失败时才使用
        if (isAmazonProductPage && !result.competitorAnalysisSuccess) {
          // 检查是否有足够的产品数据进行分析
          const hasProductData = extractResult.productPrice || extractResult.rating || extractResult.category

          if (hasProductData) {
            console.log(`📊 单品页面：使用产品数据进行竞品市场定位分析...`)

            // 从产品数据构建"我们的产品"对象
            // 🔧 修复：使用统一价格解析函数处理欧洲/美国格式
            const priceNum = parsePrice(extractResult.productPrice)

            const ourProduct = {
              name: extractResult.productName || extractResult.brand || 'Unknown Product',
              brand: extractResult.brand || null,
              price: priceNum,
              rating: extractResult.rating ? parseFloat(extractResult.rating) : null,
              reviewCount: extractResult.reviewCount ? parseInt(extractResult.reviewCount.replace(/[^0-9]/g, ''), 10) : null,
              features: extractResult.features || extractResult.aboutThisItem || [],
            }

            // 基于产品类别和salesRank推断竞争环境（无需实际抓取竞品）
            // 创建虚拟竞品数据用于AI分析（基于品类平均值）
            const categoryCompetitors: CompetitorProduct[] = []

            // 如果有salesRank，可以推断竞争强度
            if (extractResult.salesRank) {
              const rankMatch = extractResult.salesRank.match(/#?([\d,]+)/i)
              const rank = rankMatch ? parseInt(rankMatch[1].replace(/,/g, ''), 10) : null

              // 🔥 修复（2025-12-12）：不再创建虚假竞品数据
              // 原来的代码会创建 "category-avg"、"category-leader"、"market-benchmark" 等假数据
              // 这会导致AI生成关于虚假竞品的错误分析结果
              // 正确做法：只使用真实竞品数据，没有竞品时跳过竞品分析
              if (rank) {
                console.log(`📊 产品排名: #${rank}，但没有真实竞品数据`)
              }
            }

            // 🔥 修复（2025-12-12）：只有当有真实竞品时才进行分析
            // 删除了虚假的 "Market Benchmark" 竞品创建
            if (categoryCompetitors.length >= 1) {
              const competitorAnalysis = await analyzeCompetitorsWithAI(
                ourProduct,
                categoryCompetitors,
                targetCountry,
                userId
              )

              result.competitorAnalysis = competitorAnalysis
              result.competitorAnalysisSuccess = true
              console.log(`✅ 单品页面竞品分析完成 (${categoryCompetitors.length}个真实竞品)`)
            } else {
              // 🔥 修复（2025-12-12）：没有真实竞品时，明确标注而不是创建虚假数据
              console.log('ℹ️ 单品页面无真实竞品数据，跳过竞品分析（不会生成虚假数据）')
              result.competitorAnalysisSuccess = true  // 不视为失败，但不生成竞品分析
            }
          } else {
            console.log('ℹ️ 单品页面无足够产品数据进行竞品分析')
            result.competitorAnalysisSuccess = true  // 不视为失败
          }
        }
        // 🔥 修复（2025-12-13）：店铺场景跳过竞品分析
        // 原因：店铺链接的推荐区域主要是同品牌产品，过滤后竞品不足
        // 决策：店铺场景的核心价值是产品亮点分析，不是竞品对比
        else if (isAmazonStore) {
          console.log(`ℹ️ [STORE] 店铺场景跳过竞品分析（核心价值是产品亮点，不是竞品对比）`)
          result.competitorAnalysisSuccess = true  // 不视为失败

          if (!extractResult.products || extractResult.products.length === 0) {
            console.log(`⚠️ Amazon Store页面未提取到产品数据，跳过竞品分析`)
            result.competitorAnalysisSuccess = true  // 标记为成功，不阻塞流程
          } else {
            // 🔥 没有聚合竞品ASIN时的降级策略：记录日志但不使用自家产品作为竞品
            console.log(`ℹ️ [STORE] 未找到聚合竞品ASIN，店铺页面跳过竞品分析（避免将自家产品误判为竞品）`)
            result.competitorAnalysisSuccess = true  // 不视为失败
          }
        }
        // 非Amazon店铺，但有产品数据（独立站等）
        else if (extractResult.products && extractResult.products.length > 0) {
          console.log(`📊 从店铺产品中提取竞品数据 (${extractResult.products.length}个产品)...`)
          // 将店铺中的其他产品视为竞品
          extractResult.products.slice(0, 10).forEach((product: any) => {
            const priceNum = parsePrice(product.price)  // 🔧 修复：使用统一价格解析函数
            const ratingNum = product.rating ? parseFloat(product.rating) : null
            competitors.push({
              asin: product.asin || null,
              name: product.name || 'Unknown',
              brand: extractResult.brand || null,
              price: priceNum,
              priceText: product.price || null,
              rating: ratingNum,
              reviewCount: product.reviews || null,
              imageUrl: product.imageUrl || null,
              source: 'same_category',
              features: [],
            })
          })

          if (competitors.length >= 2) {
            // 🔧 修复：使用统一价格解析函数处理欧洲/美国格式
            const productPrice = parsePrice(extractResult.productPrice)

            const ourProduct = {
              name: extractResult.productName || extractResult.brand || 'Unknown',
              brand: extractResult.brand || null,
              price: productPrice,
              rating: null,
              reviewCount: null,
              features: [],
            }

            const competitorAnalysis = await analyzeCompetitorsWithAI(
              ourProduct,
              competitors,
              targetCountry,
              userId
            )

            result.competitorAnalysis = competitorAnalysis
            result.competitorAnalysisSuccess = true
            console.log(`✅ 竞品分析完成 (对比${competitors.length}个竞品)`)
          } else {
            console.log('⚠️ 店铺产品数据不足（需要>=2个产品）')
            result.competitorAnalysisSuccess = true  // 不视为失败
          }
        }
        // 🔥 修复（2026-01-04）：独立站单品页面竞品分析
        // 独立站单品页面通常没有竞品数据（不像Amazon有relatedAsins）
        // 标记为成功但跳过分析，避免阻塞流程
        else if (debug.isIndependentStore && !result.competitorAnalysisSuccess) {
          console.log('ℹ️ 独立站单品页面：无竞品数据源，跳过竞品分析')
          result.competitorAnalysisSuccess = true  // 不视为失败
        } else {
          console.log('ℹ️ 非店铺页面，竞品分析将由后续流程处理')
          result.competitorAnalysisSuccess = true  // 标记为成功，让后续流程继续
        }
      } catch (error: any) {
        console.error('⚠️ 竞品分析失败（不影响流程）:', error.message)
        result.competitorAnalysisSuccess = false
      }
    }

    // ========== 广告元素提取 ==========
    if (input.enableAdExtraction) {
      try {
        console.log(`🔍 开始广告元素提取...`)

        // 🔥 修复：重构数据结构以适配extractAdElements期望的格式
        // extractResult现在是扁平结构，需要根据debug标志重新组装
        const debug = extractResult.debug || {}
        const isAmazonStore = debug.isAmazonStore || false
        const isIndependentStore = debug.isIndependentStore || false

        // 🔥 2026-01-04修复：独立站/非Amazon页面也需要提供product数据
        // 否则extractAdElements会抛错，导致extractedKeywords为空，进而阻断关键词池/创意生成。
        const adPageType: 'product' | 'store' | 'unknown' =
          (extractResult as any).pageType === 'store' || (extractResult as any).pageType === 'product'
            ? ((extractResult as any).pageType as 'store' | 'product')
            : (isAmazonStore || isIndependentStore ? 'store' : 'product')

        // 产品页：无论Amazon还是独立站，只要有基础商品字段就组装成AmazonProductData兼容结构
        const productData = adPageType === 'product' ? {
          productName: extractResult.productName ?? null,
          productDescription: extractResult.productDescription ?? null,
          productPrice: extractResult.productPrice ?? null,
          originalPrice: extractResult.originalPrice ?? null,
          discount: extractResult.discount ?? null,
          brandName: extractResult.brand ?? null,
          features: Array.isArray(extractResult.features) ? extractResult.features : [],
          aboutThisItem: Array.isArray(extractResult.aboutThisItem) ? extractResult.aboutThisItem : [],
          imageUrls: Array.isArray(extractResult.imageUrls) ? extractResult.imageUrls : [],
          rating: extractResult.rating ?? null,
          reviewCount: extractResult.reviewCount ?? null,
          salesRank: extractResult.salesRank ?? null,
          badge: (extractResult as any).badge ?? null,
          availability: extractResult.availability ?? null,
          primeEligible: Boolean((extractResult as any).primeEligible),
          reviewHighlights: Array.isArray(extractResult.reviewHighlights) ? extractResult.reviewHighlights : [],
          topReviews: Array.isArray(extractResult.topReviews) ? extractResult.topReviews : [],
          technicalDetails: (extractResult.technicalDetails && typeof extractResult.technicalDetails === 'object')
            ? extractResult.technicalDetails
            : {},
          asin: extractResult.asin ?? null,
          category: extractResult.category ?? null,
          relatedAsins: Array.isArray((extractResult as any).relatedAsins) ? (extractResult as any).relatedAsins : [],
          reviewKeywords: Array.isArray((extractResult as any).reviewKeywords) ? (extractResult as any).reviewKeywords : undefined,
        } : undefined

        // 重构店铺产品数据（如果是Amazon Store或独立站）
        const storeProducts = adPageType === 'store' ? (extractResult.products || undefined) : undefined

        const scraped = {
          pageType: adPageType,
          product: productData as any,
          storeProducts: storeProducts as any,
          hasDeepData: !!(productData || storeProducts),
        }

        const extractedBrand = toTrimmedText(extractResult.brand)
        const fallbackBrand = toTrimmedText(input.fallbackBrand)
        const brandForAdExtraction = resolveBrandForAdExtraction([
          extractedBrand,
          fallbackBrand,
        ])

        if (!brandForAdExtraction && extractedBrand) {
          console.warn(`⚠️ 广告元素提取品牌异常，检测到占位品牌: "${extractedBrand}"`)
        } else if (!extractedBrand && brandForAdExtraction) {
          console.log(`ℹ️ 广告元素提取使用兜底品牌: "${brandForAdExtraction}"`)
        }

        const adElements = await extractAdElements(
          scraped,
          brandForAdExtraction || 'Unknown',
          targetCountry,
          targetLanguage,
          userId
        )

        // 转换keywords为string[]并清洗无效项（unknown/test/null等）
        const sanitizedKeywordResult = sanitizeExtractedKeywordList(adElements.keywords)
        if (sanitizedKeywordResult.removedInvalid > 0 || sanitizedKeywordResult.removedDuplicate > 0) {
          console.warn(
            `⚠️ 广告关键词清洗: 移除无效${sanitizedKeywordResult.removedInvalid}个，去重${sanitizedKeywordResult.removedDuplicate}个`
          )
        }
        result.extractedKeywords = sanitizedKeywordResult.cleaned
        result.extractedHeadlines = adElements.headlines
        result.extractedDescriptions = adElements.descriptions
        result.extractionMetadata = adElements.sources
        result.adExtractionSuccess = true
        console.log(`✅ 广告元素提取完成 (${result.extractedKeywords?.length || 0}个关键词)`)
      } catch (error: any) {
        console.error('⚠️ 广告元素提取失败（不影响流程）:', error.message)
        result.adExtractionSuccess = false
      }
    }

  } catch (error: any) {
    console.error('⚠️ AI产品分析失败（不影响流程）:', error.message)
    result.aiAnalysisSuccess = false
  }

  console.log('🎉 AI分析全流程完成')
  return result
}
