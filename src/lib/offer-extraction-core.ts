/**
 * Offer提取核心逻辑（统一真相来源）
 * 🔥 KISS优化：单一提取函数，支持SSE进度推送和批量处理
 *
 * 使用场景：
 * 1. 手动创建Offer（非SSE）：/api/offers/extract → extractOffer()
 * 2. 手动创建Offer（SSE）：/api/offers/extract/stream → extractOffer({progressCallback})
 * 3. 批量创建Offer（Worker）：batch-worker → extractOffer({batchMode: true})
 */

import { resolveAffiliateLink, BATCH_MODE_RETRY_CONFIG, getProxyPool } from '@/lib/url-resolver-enhanced'
import { extractProductInfo } from '@/lib/scraper'
import type { ScrapedProductData } from '@/lib/scraper'
import {
  scrapeAmazonStoreDeep,
  scrapeIndependentStoreDeep,  // 🔥 修改：使用深度抓取版本，与Amazon Store保持一致
  scrapeAmazonProduct,
} from '@/lib/stealth-scraper'
import { createError, AppError } from '@/lib/errors'
import {
  detectPageType,
  initializeProxyPool,
  getTargetLanguage,
  normalizeBrandName,
  PageTypeResult,
} from '@/lib/offer-utils'
import { scrapeSupplementalProducts, type SupplementalProductResult } from '@/lib/offer-supplemental-products'
import { warmupAffiliateLink } from '@/lib/proxy-warmup'
import { getProxyUrlForCountry } from '@/lib/settings'
import { fetchBrandSearchSupplement, type BrandSearchSupplement } from '@/lib/google-brand-search'
import { deriveBrandFromProductTitle, isLikelyInvalidBrandName } from '@/lib/brand-name-utils'
import type { ProgressStage } from '@/types/progress'

/**
 * 提取选项
 */
export interface ExtractOfferOptions {
  /** 推广链接 */
  affiliateLink: string
  /** 目标国家 */
  targetCountry: string
  /** 用户ID */
  userId: number
  /** 用户手动输入的品牌名（可选，独立站Google搜索补充用） */
  brandNameInput?: string
  /** 是否跳过缓存（默认true，确保获取最新URL重定向数据） */
  skipCache?: boolean
  /** 是否批量处理模式（启用快速失败策略） */
  batchMode?: boolean
  /** 是否跳过推广链接预热（默认false，启用预热以触发联盟追踪） */
  skipWarmup?: boolean
  /** 用户选择的页面类型（店铺/单品），用于覆盖自动判断 */
  pageTypeOverride?: 'store' | 'product'
  /** 店铺模式下的单品推广链接（最多3个） */
  storeProductLinks?: string[]
  /** SSE进度回调函数（可选） */
  progressCallback?: ProgressCallback
}

/**
 * 进度回调函数类型
 */
export type ProgressCallback = (
  step: ProgressStage,
  status: 'in_progress' | 'completed' | 'error',
  message: string,
  data?: any,
  duration?: number // 执行耗时（毫秒）
) => void

/**
 * 提取结果
 */
export interface ExtractOfferResult {
  success: boolean
  data?: {
    // 自动提取的数据
    finalUrl: string
    finalUrlSuffix: string
    brand: string | null
    productDescription: string | null
    targetLanguage: string

    // 单品页数据（可选）
    productName?: string
    rawProductTitle?: string
    rawAboutThisItem?: string[]
    productPrice?: string  // 🔥 统一字段名：price → productPrice
    productCategory?: string
    productFeatures?: string[]
    metaTitle?: string
    metaDescription?: string
    // 🔥 2026-01-04新增：独立站增强数据字段（与ScrapedProductData保持一致）
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

    // Amazon单品页详细数据（可选）
    // 注意：rating/reviewCount 存储为字符串，保持与 AmazonProductData 一致
    rating?: string | null
    reviewCount?: string | null
    reviewHighlights?: string[]
    // topReviews 存储为字符串数组，格式："4.5 stars - Title: Review text..."
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

    // Amazon Store专属数据（可选）
    productCount?: number
    products?: any[]
    storeName?: string
    storeDescription?: string
    hotInsights?: {
      avgRating: number
      avgReviews: number
      topProductsCount: number
    }
    // 店铺分类数据（店铺维度增强）
    productCategories?: {
      primaryCategories: Array<{
        name: string
        count: number
        url?: string
      }>
      categoryTree?: Record<string, string[]>
      totalCategories: number
    }
    // 深度抓取结果（热销商品详情页数据）
    deepScrapeResults?: {
      topProducts: Array<{
        asin: string
        productData: any
        reviews: string[]
        competitorAsins: string[]
        scrapeStatus: 'success' | 'failed' | 'skipped'
        error?: string
      }>
      totalScraped: number
      successCount: number
      failedCount: number
    }

    // 独立站专属数据（可选）
    logoUrl?: string
    platform?: string

    // 🔥 独立站增强：Google品牌词搜索补充数据（可选）
    brandSearchSupplement?: BrandSearchSupplement | null

    // 元数据
    redirectCount: number
    redirectChain: string[]
    pageTitle: string | null
    resolveMethod: string
    proxyUsed: string | null

    // 🔥 页面类型标识（用于区分店铺/单品）
    pageType: 'store' | 'product'
    pageTypeDetected?: 'store' | 'product'
    pageTypeAdjusted?: boolean
    warnings?: string[]

    supplementalSummary?: {
      requested: number
      succeeded: number
      failed: number
    }

    // 店铺模式：额外单品抓取结果（可选）
    supplementalProducts?: Array<{
      sourceAffiliateLink: string
      finalUrl: string | null
      finalUrlSuffix?: string | null
      pageType?: string | null
      productName?: string | null
      productPrice?: string | null
      productDescription?: string | null
      brandName?: string | null
      productFeatures?: string[] | null
      rating?: string | null
      reviewCount?: string | null
      reviewHighlights?: string[] | null
      topReviews?: string[] | null
      imageUrls?: string[] | null
      category?: string | null
      error?: string | null
    }>

      // 调试信息
      debug: {
        scrapedDataAvailable: boolean
        brandAutoDetected: boolean
        isAmazonStore: boolean
        isAmazonProductPage: boolean
        isIndependentStore: boolean
        pageTypeDetected?: 'store' | 'product'
        pageTypeAdjusted?: boolean
        productsExtracted: number
        scrapeMethod: string
        scrapingError?: string
        amazonProductDataExtracted?: boolean
        storeDataExtracted?: boolean
      independentStoreDataExtracted?: boolean
    }
  }
  error?: {
    code: string
    message: string
    details?: any
  }
}

/**
 * 记录阶段耗时的辅助函数
 */
function trackStageProgress(
  progressCallback: ProgressCallback | undefined,
  startTime: number,
  step: ProgressStage,
  status: 'in_progress' | 'completed' | 'error',
  message: string,
  data?: any
) {
  const duration = Date.now() - startTime
  progressCallback?.(step, status, message, data, duration)
}

function normalizeHost(input: string): string {
  return input.trim().toLowerCase().replace(/\.+$/, '')
}

function isIpLike(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')
}

function normalizeForCompare(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function deriveBrandFromFinalUrl(finalUrl: string): string | null {
  try {
    const url = new URL(finalUrl)
    const hostname = normalizeHost(url.hostname)
    if (!hostname || isIpLike(hostname)) return null

    const parts = hostname.split('.').filter(Boolean)
    if (parts.length < 2) return null

    const stripped = parts[0] === 'www' ? parts.slice(1) : parts
    if (stripped.length < 2) return null

    const tld = stripped[stripped.length - 1]
    const sld = stripped[stripped.length - 2]
    const sldIsCommonSecondLevel = new Set(['co', 'com', 'net', 'org', 'gov', 'edu'])

    const label = (tld.length === 2 && sldIsCommonSecondLevel.has(sld) && stripped.length >= 3)
      ? stripped[stripped.length - 3]
      : sld

    const candidate = label.replace(/[^a-z0-9-]/g, '').trim()
    if (!candidate) return null

    // Avoid returning hosting/platform domains as “brand”.
    const blocked = new Set(['myshopify', 'shopify', 'wixsite', 'wordpress', 'blogspot', 'github', 'pages'])
    if (blocked.has(candidate)) return null

    return candidate
  } catch {
    return null
  }
}

function extractAmazonAsinFromUrl(url: string): string | null {
  try {
    const match = new URL(url).pathname.match(/\/dp\/([A-Z0-9]{10})/i)
    return match?.[1]?.toUpperCase() || null
  } catch {
    return null
  }
}

function buildCanonicalAmazonProductUrl(url: string): string | null {
  try {
    const urlObj = new URL(url)
    if (!/(^|\.)amazon\./i.test(urlObj.hostname)) return null

    const asin = extractAmazonAsinFromUrl(url)
    if (!asin) return null

    return `${urlObj.protocol}//${urlObj.hostname}/dp/${asin}`
  } catch {
    return null
  }
}

function getAmazonProductDataQualityScore(
  data: {
    productName?: string | null
    productDescription?: string | null
    brandName?: string | null
    features?: string[] | null
    aboutThisItem?: string[] | null
    imageUrls?: string[] | null
  } | null | undefined
): number {
  if (!data) return 0

  const productNameScore = typeof data.productName === 'string' && data.productName.trim().length > 0 ? 3 : 0
  const descriptionScore = typeof data.productDescription === 'string' && data.productDescription.trim().length > 0 ? 1 : 0
  const brandScore = typeof data.brandName === 'string'
    && data.brandName.trim().length > 0
    && !isLikelyInvalidBrandName(data.brandName) ? 2 : 0
  const featuresScore = Array.isArray(data.features)
    ? Math.min(3, data.features.filter((item) => typeof item === 'string' && item.trim().length > 0).length)
    : 0
  const aboutScore = Array.isArray(data.aboutThisItem)
    ? Math.min(2, data.aboutThisItem.filter((item) => typeof item === 'string' && item.trim().length > 0).length)
    : 0
  const imageScore = Array.isArray(data.imageUrls)
    && data.imageUrls.some((item) => typeof item === 'string' && item.trim().length > 0) ? 1 : 0

  return productNameScore + descriptionScore + brandScore + featuresScore + aboutScore + imageScore
}

function isAmazonProductDataInsufficient(
  data: {
    productName?: string | null
    brandName?: string | null
    features?: string[] | null
    aboutThisItem?: string[] | null
  } | null | undefined
): boolean {
  if (!data) return true

  const hasProductName = typeof data.productName === 'string' && data.productName.trim().length > 0
  if (!hasProductName) return true

  const hasValidBrand = typeof data.brandName === 'string'
    && data.brandName.trim().length > 0
    && !isLikelyInvalidBrandName(data.brandName)
  const hasFeatures = Array.isArray(data.features)
    && data.features.some((item) => typeof item === 'string' && item.trim().length > 0)
  const hasAboutThisItem = Array.isArray(data.aboutThisItem)
    && data.aboutThisItem.some((item) => typeof item === 'string' && item.trim().length > 0)

  return !hasValidBrand && !hasFeatures && !hasAboutThisItem
}

function looksLikeIndependentProductDetailUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    if (!pathname || pathname === '/') return false
    return /\/(products?|product|item|goods)\//.test(pathname) || /\/p\/[a-z0-9]/.test(pathname)
  } catch {
    return false
  }
}

function shouldFallbackToRenderedIndependentProduct(
  data: ScrapedProductData | null | undefined,
  targetUrl?: string
): boolean {
  if (!data) return true

  const hasBrand = typeof data.brandName === 'string'
    && data.brandName.trim().length > 0
    && !isLikelyInvalidBrandName(data.brandName)
  const hasProductName = typeof data.productName === 'string' && data.productName.trim().length > 0
  const hasImages = Array.isArray(data.imageUrls) && data.imageUrls.some((item) => typeof item === 'string' && item.trim().length > 0)
  const hasFeatureContent = Array.isArray(data.productFeatures)
    && data.productFeatures.some((item) => typeof item === 'string' && item.trim().length > 0)
  const hasStructuredReviews = Array.isArray(data.reviews) && data.reviews.length > 0
  const ratingValue = typeof data.rating === 'string'
    ? Number.parseFloat(data.rating.replace(/[^0-9.]/g, ''))
    : Number.NaN
  const reviewCountValue = typeof data.reviewCount === 'string'
    ? Number.parseInt(data.reviewCount.replace(/[^0-9]/g, ''), 10)
    : Number.NaN
  const hasRatingSignal = Number.isFinite(ratingValue) && ratingValue > 0
  const hasReviewCountSignal = Number.isFinite(reviewCountValue) && reviewCountValue > 0
  const hasReviewSignals = hasStructuredReviews
    || hasRatingSignal
    || hasReviewCountSignal
    || !!(Array.isArray(data.topReviews) && data.topReviews.length > 0)
  const hasSpecifications = !!(data.specifications && Object.keys(data.specifications).length > 0)
  const hasDescription = typeof data.productDescription === 'string' && data.productDescription.trim().length >= 80
  const likelyProductDetailUrl = looksLikeIndependentProductDetailUrl(targetUrl)

  if (!hasProductName) return true
  if (!hasBrand) return true
  if (!hasImages) return true

  if (!hasReviewSignals && likelyProductDetailUrl) return true

  return !hasFeatureContent && !hasReviewSignals && !hasSpecifications && !hasDescription
}

/**
 * Offer提取核心函数
 *
 * @param options - 提取选项
 * @returns 提取结果
 */
export async function extractOffer(options: ExtractOfferOptions): Promise<ExtractOfferResult> {
  const {
    affiliateLink,
    targetCountry,
    userId,
    brandNameInput,
    skipCache = true,
    batchMode = false,
    skipWarmup = false,
    pageTypeOverride,
    storeProductLinks,
    progressCallback,
  } = options

  // 🔥 2025-12-12调试：记录targetCountry参数
  console.log(`📍 extractOffer: targetCountry="${targetCountry}", userId=${userId}, affiliateLink=${affiliateLink?.substring(0, 50)}...`)

  try {
    // ========== 步骤0: 初始化代理池（必须在预热之前） ==========
    const fetchingProxyStartTime = Date.now()
    progressCallback?.('fetching_proxy', 'in_progress', '正在初始化代理池...', undefined, 0)

    try {
      await initializeProxyPool(userId, targetCountry)

      // 🔥 检查代理国家是否匹配目标国家
      const proxyPool = getProxyPool(userId)
      const proxyInfo = proxyPool.getProxyInfo(targetCountry)

      const proxyCountryMismatch = proxyInfo.proxy && !proxyInfo.isTargetCountryMatch
      const completedMessage = proxyCountryMismatch
        ? `代理池初始化完成（使用${proxyInfo.usedCountry}代理）`
        : '代理池初始化完成'

      trackStageProgress(
        progressCallback,
        fetchingProxyStartTime,
        'fetching_proxy',
        'completed',
        completedMessage,
        proxyCountryMismatch ? {
          proxyCountryMismatch: true,
          targetCountry: targetCountry,
          usedProxyCountry: proxyInfo.usedCountry || undefined,
        } : undefined
      )
    } catch (error: any) {
      const errorMessage = error instanceof AppError ? error.message : (error.message || '代理池初始化失败')
      const errorCode = error.code || (error instanceof AppError ? error.code : 'PROXY_POOL_INIT_FAILED')
      trackStageProgress(progressCallback, fetchingProxyStartTime, 'fetching_proxy', 'error', errorMessage)

      return {
        success: false,
        error: {
          code: errorCode,
          message: errorMessage,
          details: error.details,
        },
      }
    }

    // ========== 步骤1: 推广链接预热（可选） ==========
    const proxyWarmupStartTime = Date.now()
    if (!skipWarmup) {
      progressCallback?.('proxy_warmup', 'in_progress', '正在进行推广链接预热...', undefined, 0)

      try {
        const targetProxyUrl = await getProxyUrlForCountry(targetCountry, userId)

        if (!targetProxyUrl) {
          console.warn('⚠️ 未配置代理URL，跳过预热步骤')
          trackStageProgress(progressCallback, proxyWarmupStartTime, 'proxy_warmup', 'completed', '未配置代理URL，跳过预热')
        } else {
          const warmupSuccess = await warmupAffiliateLink(targetProxyUrl, affiliateLink)

          if (!warmupSuccess) {
            // 预热失败不中断流程，只记录警告
            console.warn('⚠️ 推广链接预热失败，继续后续流程')
            trackStageProgress(progressCallback, proxyWarmupStartTime, 'proxy_warmup', 'completed', '推广链接预热失败，继续后续流程')
          } else {
            console.log('✅ 推广链接预热已触发（12个代理IP访问中）')
            trackStageProgress(progressCallback, proxyWarmupStartTime, 'proxy_warmup', 'completed', '推广链接预热已触发')
          }
        }
      } catch (error: any) {
        // 预热异常不中断流程，只记录警告
        console.warn('⚠️ 推广链接预热异常:', error.message)
        trackStageProgress(progressCallback, proxyWarmupStartTime, 'proxy_warmup', 'completed', `推广链接预热异常: ${error.message}`)
      }
    } else {
      console.log('⏩ 跳过推广链接预热（skipWarmup=true）')
    }

    // ========== 步骤2: 检测页面类型（URL解析前） ==========
    const pageTypeByUrl = detectPageType(affiliateLink)
    const isAmazonStoreByUrl = pageTypeByUrl.isAmazonStore

    // ========== 步骤3: 解析推广链接 ==========
    const resolvingLinkStartTime = Date.now()
    progressCallback?.('resolving_link', 'in_progress', '正在解析推广链接...', undefined, 0)

    let resolvedData

    // 如果是Amazon Store页面，跳过URL解析，直接使用原始链接
    if (isAmazonStoreByUrl) {
      console.log('🏪 检测到Amazon Store页面，跳过URL解析...')
      resolvedData = {
        finalUrl: affiliateLink,
        finalUrlSuffix: '',
        redirectCount: 0,
        redirectChain: [affiliateLink],
        pageTitle: null,
        resolveMethod: 'direct',
        proxyUsed: null,
      }
      trackStageProgress(progressCallback, resolvingLinkStartTime, 'resolving_link', 'completed', '推广链接解析完成（直接使用）', {
        currentUrl: affiliateLink,
        redirectCount: 0,
      })
    } else {
      try {
        resolvedData = await resolveAffiliateLink(affiliateLink, {
          targetCountry: targetCountry,
          userId: userId,
          skipCache: skipCache,
          // 批量处理模式：使用快速失败策略
          ...(batchMode ? {
            retryConfig: BATCH_MODE_RETRY_CONFIG,  // 减少重试次数（1次）
            timeout: 3000                           // 减少超时时间（3秒）
          } : {}),
        })

        trackStageProgress(progressCallback, resolvingLinkStartTime, 'resolving_link', 'completed', '推广链接解析完成', {
          currentUrl: resolvedData.finalUrl,
          redirectCount: resolvedData.redirectCount,
        })
      } catch (error: any) {
        console.error('URL解析失败:', error)
        const errorMessage = error instanceof AppError ? error.message : '推广链接解析失败'
        trackStageProgress(progressCallback, resolvingLinkStartTime, 'resolving_link', 'error', errorMessage)

        return {
          success: false,
          error: {
            code: error instanceof AppError ? error.code : 'URL_RESOLVE_FAILED',
            message: errorMessage,
            details: { originalError: error.message },
          },
        }
      }
    }

    // ========== 步骤4: 检测页面类型（URL解析后） ==========
    const pageTypeByFinalUrl = detectPageType(resolvedData.finalUrl)

    // 🔥 修复：优先使用finalUrl的页面类型检测结果
    // 因为推广链接可能通过多次重定向，finalUrl才是真正的目标页面
    const isAmazonStore = pageTypeByFinalUrl.isAmazonStore
    const isAmazonProductPage = pageTypeByFinalUrl.isAmazonProductPage

    console.log('🔍 页面类型检测:')
    console.log('  - finalUrl:', resolvedData.finalUrl)
    console.log('  - 页面类型:', pageTypeByFinalUrl.pageType)
    console.log('  - isAmazonStore:', isAmazonStore)
    console.log('  - isAmazonProductPage:', isAmazonProductPage)

    // ========== 步骤5: 访问目标页面 ==========
    const accessingPageStartTime = Date.now()
    progressCallback?.('accessing_page', 'in_progress', '正在访问目标页面...', {
      currentUrl: resolvedData.finalUrl,
    }, 0)

    let brandName = null
    let productDescription = null
    let scrapedData: import('./scraper').ScrapedProductData | null = null
    let storeData = null
    let independentStoreData = null
    let amazonProductData = null
    let productCount = 0
    let scrapingError: string | null = null  // 🔥 新增：记录抓取错误
    let proxyApiUrl: string | null = null
    let brandSearchSupplement: BrandSearchSupplement | null = null
    let isIndependentStore = false
    let supplementalProducts: SupplementalProductResult[] = []
    const extractionWarnings: string[] = []
    let detectedPageType: 'store' | 'product' = 'product'
    let pageTypeAdjusted = false
    let supplementalRequested = 0
    let effectivePageType: 'store' | 'product' =
      pageTypeOverride === 'store' || pageTypeOverride === 'product'
        ? pageTypeOverride
        : 'product'

    try {
      // 🔥 验证finalUrl有效性
      if (!resolvedData.finalUrl || resolvedData.finalUrl === 'null/' || resolvedData.finalUrl === 'null') {
        throw new Error('Invalid finalUrl: URL解析返回了无效的URL')
      }

	      // 检测是否为独立站店铺首页
      isIndependentStore = !isAmazonStore && !isAmazonProductPage && (() => {
        try {
          const urlObj = new URL(resolvedData.finalUrl)
          const pathname = urlObj.pathname

        // 排除明确的单品页面路径
        const isSingleProductPage =
          pathname.includes('/products/') ||
          pathname.includes('/product/') ||
          pathname.includes('/p/') ||
          pathname.includes('/dp/') ||
          pathname.includes('/item/')

        // 店铺首页特征：根路径、collections、shop等
        // 注意：不要用“仅1段路径”作为店铺判断（例如 /impact_special 这类落地页会被误判为 store）
        const isStorePage =
          pathname === '/' ||
          pathname === '' ||
          !!pathname.match(/^\/(collections|shop|store|category|catalogue)(\/|$)/i)

        return !isSingleProductPage && isStorePage
        } catch (urlError) {
          console.warn('⚠️ URL解析失败，默认判断为非独立站:', urlError)
          return false
        }
      })()

      if (pageTypeOverride !== 'store' && pageTypeOverride !== 'product') {
        effectivePageType = (isAmazonStore || isIndependentStore) ? 'store' : 'product'
      }

        // 🔥 防御：即使后续抓取失败，也至少用主域名提供一个稳定的品牌fallback
        // 避免被阻断/403/超时时 brandName 为空或被阻断页文本污染
        if (!isAmazonStore && !isAmazonProductPage && !brandName) {
          const brandFromUrlFallback = deriveBrandFromFinalUrl(resolvedData.finalUrl)
          if (brandFromUrlFallback && !isLikelyInvalidBrandName(brandFromUrlFallback)) {
            brandName = normalizeBrandName(brandFromUrlFallback)
          }
        }

      // 获取用户代理配置
      proxyApiUrl = (await getProxyUrlForCountry(targetCountry, userId)) || null
      if (!proxyApiUrl) {
        trackStageProgress(progressCallback, accessingPageStartTime, 'accessing_page', 'error', `用户 ${userId} 未配置${targetCountry}国家的代理URL`)
        throw new Error(`用户 ${userId} 未配置${targetCountry}国家的代理URL`)
      }

      detectedPageType = (isAmazonStore || isIndependentStore) ? 'store' : 'product'
      const userSelectedPageType = pageTypeOverride === 'store' || pageTypeOverride === 'product'
        ? pageTypeOverride
        : null

      if (userSelectedPageType && userSelectedPageType !== detectedPageType) {
        extractionWarnings.push(`系统识别为${detectedPageType === 'store' ? '店铺' : '单品'}页面，已自动切换为${detectedPageType === 'store' ? '店铺' : '单品'}模式`)
        effectivePageType = detectedPageType
        pageTypeAdjusted = true
      }

      // 🔥 修复：拼接完整URL（包含追踪参数），避免Amazon 404拦截
      const fullTargetUrl = resolvedData.finalUrlSuffix
        ? `${resolvedData.finalUrl}?${resolvedData.finalUrlSuffix}`
        : resolvedData.finalUrl

      console.log('🔗 完整目标URL:', fullTargetUrl)
      console.log('  - Final URL:', resolvedData.finalUrl)
      console.log('  - URL Suffix:', resolvedData.finalUrlSuffix || '(无)')

      // 访问目标页面完成
      trackStageProgress(progressCallback, accessingPageStartTime, 'accessing_page', 'completed', '目标页面访问成功', {
        currentUrl: fullTargetUrl,
        pageType: isAmazonStore ? 'Amazon Store' : isAmazonProductPage ? 'Amazon Product' : isIndependentStore ? '独立站首页' : '单品页面',
      })

      // ========== 步骤6: 抓取产品数据 ==========
      const scrapingProductsStartTime = Date.now()
      progressCallback?.('scraping_products', 'in_progress', '正在抓取产品数据...', undefined, 0)

      if (isAmazonStore) {
        console.log('🏪 检测到Amazon Store页面，使用深度抓取模式（包含热销商品详情）...')
        // 🔥 方案A：前置深度抓取
        // 进入前5个热销商品详情页，获取详细评论和竞品数据
        storeData = await scrapeAmazonStoreDeep(
          fullTargetUrl,
          5,  // 抓取前5个热销商品的详情页
          proxyApiUrl,
          targetCountry,
          3   // 并发数：最多同时抓取3个商品
        )
        brandName = storeData.brandName || storeData.storeName
        productDescription = storeData.storeDescription
        productCount = storeData.totalProducts
        console.log(`✅ Amazon Store深度识别成功: ${brandName}, 产品数: ${productCount}, 深度抓取: ${storeData.deepScrapeResults?.successCount || 0}/${storeData.deepScrapeResults?.totalScraped || 0}`)
      } else if (isAmazonProductPage) {
        console.log('📦 检测到Amazon单品页面，使用非Crawlee方案抓取...')
        amazonProductData = await scrapeAmazonProduct(fullTargetUrl, proxyApiUrl, targetCountry)

        // 通用兜底：若“带追踪参数URL”抓取数据质量不足，则回退到 canonical /dp/ASIN URL 再抓取一次
        const canonicalAmazonProductUrl = buildCanonicalAmazonProductUrl(resolvedData.finalUrl)
        const canRetryWithCanonical = !!canonicalAmazonProductUrl && canonicalAmazonProductUrl !== fullTargetUrl

        if (canRetryWithCanonical && isAmazonProductDataInsufficient(amazonProductData)) {
          const primaryScore = getAmazonProductDataQualityScore(amazonProductData)
          console.warn(`⚠️ Amazon单品抓取结果质量不足（score=${primaryScore}），尝试canonical回退: ${canonicalAmazonProductUrl}`)

          try {
            const canonicalProductData = await scrapeAmazonProduct(canonicalAmazonProductUrl, proxyApiUrl, targetCountry)
            const canonicalScore = getAmazonProductDataQualityScore(canonicalProductData)

            if (canonicalScore >= primaryScore) {
              amazonProductData = canonicalProductData
              console.log(`✅ Amazon canonical回退成功（score ${primaryScore} -> ${canonicalScore}）`)
            } else {
              console.warn(`⚠️ Amazon canonical回退未提升质量（score ${primaryScore} -> ${canonicalScore}），保留原结果`)
            }
          } catch (canonicalError: any) {
            console.warn(`⚠️ Amazon canonical回退抓取失败，保留原结果: ${canonicalError?.message || canonicalError}`)
          }
        }

        brandName = amazonProductData.brandName
        if (isLikelyInvalidBrandName(brandName) && amazonProductData.productName) {
          const derived = deriveBrandFromProductTitle(amazonProductData.productName)
          if (derived) {
            brandName = derived
          }
        }
        if (brandName && !isLikelyInvalidBrandName(brandName)) {
          brandName = normalizeBrandName(brandName)
        }
        productDescription = amazonProductData.productDescription
        scrapedData = {
          productName: amazonProductData.productName,
          rawProductTitle: amazonProductData.rawProductTitle || amazonProductData.productName,
          rawAboutThisItem: Array.isArray(amazonProductData.rawAboutThisItem)
            ? amazonProductData.rawAboutThisItem
            : (Array.isArray(amazonProductData.aboutThisItem) ? amazonProductData.aboutThisItem : []),
          productDescription: amazonProductData.productDescription,
          productPrice: amazonProductData.productPrice,
          productCategory: amazonProductData.category || null,
          productFeatures: amazonProductData.features || [],
          brandName: brandName,
          imageUrls: amazonProductData.imageUrls || [],
          metaTitle: null,
          metaDescription: null,
        }
        console.log(`✅ Amazon单品识别成功: ${brandName || 'Unknown'}`)
      } else if (isIndependentStore) {
        console.log('🏬 检测到独立站首页，使用深度抓取模式（包含热销商品详情）...')
        // 🔥 修改（2025-12-08）：使用深度抓取版本，与Amazon Store保持一致
        // 进入前5个热销商品详情页，获取详细评论和竞品数据
        // 🔥 修复：店铺抓取不需要追踪query，优先使用finalUrl避免触发风控/403（例如 IHG/CJ 链路）
        const storeScrapeUrl = resolvedData.finalUrl
        independentStoreData = await scrapeIndependentStoreDeep(
          storeScrapeUrl,
          5,  // 抓取前5个热销商品的详情页
          proxyApiUrl,
          targetCountry,
          3   // 并发数：最多同时抓取3个商品
        )
        // 🔥 品牌名归一：独立站主域名更稳定，避免 “Brand + 国家/语言” 作为品牌名
        // 例：kaspersky.es 页面标题/店铺名为 “Kaspersky España”，但品牌应为 “kaspersky”
        const brandFromUrl = deriveBrandFromFinalUrl(resolvedData.finalUrl)
        const storeName = typeof independentStoreData.storeName === 'string' ? independentStoreData.storeName.trim() : ''
        const storeNorm = storeName ? normalizeForCompare(storeName) : ''
        const urlNorm = brandFromUrl ? normalizeForCompare(brandFromUrl) : ''
        let brandCandidate: string | null = null
        if (brandFromUrl && storeName) {
          if (storeNorm && urlNorm && storeNorm === urlNorm) {
            brandCandidate = storeName
          } else if (storeNorm && urlNorm && storeNorm.includes(urlNorm)) {
            brandCandidate = brandFromUrl
          } else {
            brandCandidate = storeName || brandFromUrl
          }
        } else {
          brandCandidate = storeName || brandFromUrl
        }
        // 🔥 修复：过滤阻断页标题（如 “Access Denied”）被写入品牌名
        if (isLikelyInvalidBrandName(brandCandidate)) {
          brandCandidate = brandFromUrl || null
        }
        brandName = brandCandidate
        productDescription = independentStoreData.storeDescription
        productCount = independentStoreData.totalProducts
        console.log(`✅ 独立站深度识别成功: ${brandName}, 产品数: ${productCount}, 深度抓取: ${independentStoreData.deepScrapeResults?.successCount || 0}/${independentStoreData.deepScrapeResults?.totalScraped || 0}`)
      } else {
        // 🔥 2025-12-24优化：独立站单品页面抓取
        // 尝试轻量级axios-cheerio抓取，如果失败则回退到Playwright渲染
        console.log('📦 检测到独立站单品页面，尝试使用轻量级scraper...')

        // 🔥 必须使用包含suffix的完整URL，否则会丢失追踪参数导致落地页不正确（例如 partnermatic/awin 链路）
        // 🔥 修复：独立站单品axios抓取也需要走代理（否则容易被风控/超时，导致品牌词为空）
        try {
          scrapedData = await extractProductInfo(fullTargetUrl, targetCountry, proxyApiUrl, 30000, userId)
        } catch (lightScrapeError: any) {
          console.warn(`⚠️ 轻量级scraper失败: ${lightScrapeError?.message || lightScrapeError}`)
          scrapedData = null
        }

        // 🔥 检测是否需要JavaScript渲染：独立站单品若仅抓到浅层字段，继续走Playwright拿完整内容
        if (shouldFallbackToRenderedIndependentProduct(scrapedData, fullTargetUrl)) {
          console.warn('⚠️ 轻量级scraper丰富度不足，尝试使用Playwright进行JavaScript渲染...')

          try {
            // 导入独立站产品scraper（Playwright版本）
            const { scrapeIndependentProduct } = await import('@/lib/stealth-scraper')

            const independentProductData = await scrapeIndependentProduct(
              fullTargetUrl,
              proxyApiUrl,
              targetCountry,
              2  // 代理重试次数
            )

            // 使用Playwright获取的数据更新
            scrapedData = {
              productName: independentProductData.productName,
              rawProductTitle: independentProductData.rawProductTitle || independentProductData.productName,
              rawAboutThisItem: Array.isArray(independentProductData.rawAboutThisItem)
                ? independentProductData.rawAboutThisItem
                : (Array.isArray(independentProductData.features) ? independentProductData.features : []),
              productDescription: independentProductData.productDescription,
              productPrice: independentProductData.productPrice,
              productCategory: independentProductData.category,
              productFeatures: independentProductData.features || [],
              brandName: independentProductData.brandName,
              imageUrls: independentProductData.imageUrls || [],
              metaTitle: independentProductData.productName,
              metaDescription: independentProductData.productDescription,
              rating: independentProductData.rating,
              reviewCount: independentProductData.reviewCount,
              reviewHighlights: independentProductData.reviewHighlights,
              topReviews: independentProductData.topReviews,
              reviews: independentProductData.structuredReviews,
              faqs: independentProductData.qaPairs,
              specifications: independentProductData.technicalDetails,
              socialProof: independentProductData.socialProof,
              coreFeatures: independentProductData.coreFeatures,
              secondaryFeatures: independentProductData.secondaryFeatures,
            }

            console.log(`✅ Playwright渲染成功: ${independentProductData.brandName || 'Unknown'}`)
          } catch (playwrightError: any) {
            console.warn(`⚠️ Playwright回退失败: ${playwrightError.message}, 继续使用轻量级scraper结果`)
            // 继续使用之前的scrapedData，即使数据不完整
          }
        }

        if (scrapedData?.brandName) {
          brandName = scrapedData.brandName
        }
        // Cross-check: avoid locale boilerplate being saved as brand (e.g. "Besuchen").
        if (isLikelyInvalidBrandName(brandName) && scrapedData?.productName) {
          const derived = deriveBrandFromProductTitle(scrapedData.productName)
          if (derived) {
            brandName = derived
          }
        }
        if (scrapedData?.productDescription) {
          productDescription = scrapedData.productDescription
        }
        // 🔥 单品页面：productCount应为1
        productCount = scrapedData ? 1 : 0
        console.log(`✅ 独立站单品识别成功: ${brandName || '未知品牌'}, 产品数: ${productCount}`)
      }

      // 店铺模式：补充抓取最多3个单品推广链接
      const normalizedStoreLinks = Array.isArray(storeProductLinks)
        ? Array.from(new Set(storeProductLinks.map((link) => (typeof link === 'string' ? link.trim() : '')).filter(Boolean))).slice(0, 3)
        : []
      supplementalRequested = normalizedStoreLinks.length

      if (normalizedStoreLinks.length > 0) {
        progressCallback?.('scraping_products', 'in_progress', `正在抓取${normalizedStoreLinks.length}个单品推广链接...`, {
          count: normalizedStoreLinks.length,
        }, 0)

        supplementalProducts = await scrapeSupplementalProducts(normalizedStoreLinks, {
          targetCountry,
          userId,
          proxyUrl: proxyApiUrl,
          maxLinks: 3,
          concurrency: 2,
          onItem: ({ index, total, link }) => {
            progressCallback?.('scraping_products', 'in_progress', `抓取单品链接 ${index + 1}/${total}...`, {
              index: index + 1,
              link,
            }, 0)
          },
        })

        const failedCount = supplementalProducts.filter((item) => item.error).length
        if (failedCount > 0) {
          extractionWarnings.push(`有${failedCount}个单品推广链接抓取失败，可在Offer详情中补充或调整`)
        }
      }

      // 抓取产品数据完成
      trackStageProgress(progressCallback, scrapingProductsStartTime, 'scraping_products', 'completed', '产品数据抓取完成', {
        productCount: productCount || (scrapedData ? 1 : 0),
      })

      // ========== 步骤7: 提取品牌信息 ==========
      const extractingBrandStartTime = Date.now()
      progressCallback?.('extracting_brand', 'in_progress', '正在提取品牌信息...', undefined, 0)

      // 🔥 如果用户已手动输入品牌名：独立站场景下优先使用用户输入
      const brandNameTrimmed = typeof brandNameInput === 'string' ? brandNameInput.trim() : ''
      if (!isAmazonStore && !isAmazonProductPage && brandNameTrimmed) {
        brandName = brandNameTrimmed
      }

      trackStageProgress(progressCallback, extractingBrandStartTime, 'extracting_brand', 'completed', '品牌信息提取完成', {
        brandName: brandName ?? undefined,
      })
    } catch (error: any) {
      // 🔥 改进：详细记录错误信息，方便诊断
      scrapingError = `${error?.constructor?.name || 'Error'}: ${error?.message || String(error)}`  // 保存错误信息

      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      console.error('❌ [Playwright] 品牌识别失败')
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      console.error('错误类型:', error?.constructor?.name || 'Unknown')
      console.error('错误消息:', error?.message || String(error))
      console.error('Final URL:', resolvedData?.finalUrl)
      console.error('页面类型:', {
        isAmazonStore,
        isAmazonProductPage,
        isIndependentStore: !isAmazonStore && !isAmazonProductPage
      })
      console.error('堆栈跟踪:', error?.stack)
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

      // 品牌识别失败不中断流程，用户可以手动填写
      // 标记当前阶段为完成（即使有错误）
      const errorTime = Date.now()
      trackStageProgress(progressCallback, accessingPageStartTime, 'accessing_page', 'completed', '目标页面访问完成')
      progressCallback?.('scraping_products', 'completed', `产品数据抓取失败: ${error?.message || '未知错误'}`, undefined, errorTime - accessingPageStartTime)
      progressCallback?.('extracting_brand', 'completed', `品牌信息提取失败: ${error?.message || '未知错误'}`, undefined, 0)
    }

    // ========== 步骤8: 处理数据 ==========
    const processingDataStartTime = Date.now()
    progressCallback?.('processing_data', 'in_progress', '正在处理数据...', undefined, 0)

    // 🔥 独立站增强：使用用户填写的品牌名进行Google搜索，补充广告元素与官网信息（best-effort）
    const brandNameTrimmed = typeof brandNameInput === 'string' ? brandNameInput.trim() : ''
    if (!isAmazonStore && !isAmazonProductPage && brandNameTrimmed && proxyApiUrl) {
      try {
        progressCallback?.('processing_data', 'in_progress', '正在通过Google搜索补充品牌信息...', undefined, 0)
        brandSearchSupplement = await fetchBrandSearchSupplement({
          brandName: brandNameTrimmed,
          targetCountry,
          proxyApiUrl,
        })
        if (brandSearchSupplement) {
          const headlinesCount = brandSearchSupplement.extracted.headlines.length
          const descriptionsCount = brandSearchSupplement.extracted.descriptions.length
          const errorHint = (headlinesCount === 0 && descriptionsCount === 0 && brandSearchSupplement.errors?.length)
            ? `, errors=${brandSearchSupplement.errors.slice(0, 2).join(' | ')}`
            : ''
          console.log(`🔎 Google品牌词补充完成: "${brandNameTrimmed}", headlines=${headlinesCount}, descriptions=${descriptionsCount}${errorHint}`)
        }
      } catch (serpError: any) {
        console.warn(`⚠️ Google品牌词补充失败（不影响主流程）: ${serpError?.message || serpError}`)
      }
    }

    // ========== 步骤9: 确定推广语言 ==========
    const targetLanguage = getTargetLanguage(targetCountry)

    const fallbackRawAboutFromDescription = (description: string | null | undefined): string[] => {
      if (typeof description !== 'string' || !description.trim()) return []
      const lines = description
        .split(/[\n.;!?]+/)
        .map(line => line.replace(/\s+/g, ' ').trim())
        .filter(line => line.length >= 12)
      return Array.from(new Set(lines)).slice(0, 6)
    }

    const resolvedRawProductTitle =
      (typeof scrapedData?.rawProductTitle === 'string' && scrapedData.rawProductTitle.trim())
        ? scrapedData.rawProductTitle.trim()
        : (typeof scrapedData?.productName === 'string' && scrapedData.productName.trim())
          ? scrapedData.productName.trim()
          : (typeof amazonProductData?.rawProductTitle === 'string' && amazonProductData.rawProductTitle.trim())
            ? amazonProductData.rawProductTitle.trim()
            : (typeof amazonProductData?.productName === 'string' && amazonProductData.productName.trim())
              ? amazonProductData.productName.trim()
              : undefined

    const resolvedRawAboutThisItem = (() => {
      if (Array.isArray(scrapedData?.rawAboutThisItem) && scrapedData.rawAboutThisItem.length > 0) {
        return scrapedData.rawAboutThisItem
          .map(item => String(item || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, 8)
      }
      if (Array.isArray(amazonProductData?.rawAboutThisItem) && amazonProductData.rawAboutThisItem.length > 0) {
        return amazonProductData.rawAboutThisItem
          .map(item => String(item || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, 8)
      }
      if (Array.isArray(amazonProductData?.aboutThisItem) && amazonProductData.aboutThisItem.length > 0) {
        return amazonProductData.aboutThisItem
          .map(item => String(item || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, 8)
      }
      if (Array.isArray(scrapedData?.productFeatures) && scrapedData.productFeatures.length > 0) {
        return scrapedData.productFeatures
          .map(item => String(item || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, 8)
      }
      return fallbackRawAboutFromDescription(scrapedData?.productDescription || productDescription)
    })()

    trackStageProgress(progressCallback, processingDataStartTime, 'processing_data', 'completed', '数据处理完成')

    // ========== 步骤10: 返回提取结果 ==========
    return {
      success: true,
      data: {
        // 自动提取的数据
        finalUrl: resolvedData.finalUrl,
        finalUrlSuffix: resolvedData.finalUrlSuffix || '',
        brand: brandName,
        productDescription,
        targetLanguage,

        // 单品页数据（可选）
        // 🔥 2026-01-04修复：保存完整的scrapedData（包含reviews、faqs、specifications等字段）
        ...(scrapedData && {
          productName: scrapedData.productName,
          rawProductTitle: resolvedRawProductTitle,
          rawAboutThisItem: resolvedRawAboutThisItem,
          productPrice: scrapedData.productPrice,
          // 独立站增强数据字段
          reviews: scrapedData.reviews,
          faqs: scrapedData.faqs,
          specifications: scrapedData.specifications,
          packages: scrapedData.packages,
          socialProof: scrapedData.socialProof,
          coreFeatures: scrapedData.coreFeatures,
          secondaryFeatures: scrapedData.secondaryFeatures,
          rating: scrapedData.rating,
          reviewCount: scrapedData.reviewCount,
          reviewHighlights: scrapedData.reviewHighlights,
          topReviews: scrapedData.topReviews,
          technicalDetails: scrapedData.specifications,
          // 基础字段
          productFeatures: scrapedData.productFeatures,
          imageUrls: scrapedData.imageUrls,
          metaTitle: scrapedData.metaTitle,
          metaDescription: scrapedData.metaDescription,
          productCategory: scrapedData.productCategory,
        }),

        // Amazon单品页评论数据（复用已抓取数据，避免重复请求）
        ...(amazonProductData && {
          rawProductTitle: resolvedRawProductTitle,
          rawAboutThisItem: resolvedRawAboutThisItem,
          rating: amazonProductData.rating,
          reviewCount: amazonProductData.reviewCount,
          reviewHighlights: amazonProductData.reviewHighlights,
          topReviews: amazonProductData.topReviews,
          // 🆕 补充缺失的重要字段
          features: amazonProductData.features,
          aboutThisItem: amazonProductData.aboutThisItem,
          technicalDetails: amazonProductData.technicalDetails,
          imageUrls: amazonProductData.imageUrls,
          originalPrice: amazonProductData.originalPrice,
          discount: amazonProductData.discount,
          salesRank: amazonProductData.salesRank,
          availability: amazonProductData.availability,
          primeEligible: amazonProductData.primeEligible,
          asin: amazonProductData.asin,
          category: amazonProductData.category,
          relatedAsins: amazonProductData.relatedAsins,  // 🔥 新增：竞品ASIN列表（已过滤同品牌产品）
        }),

        // Amazon Store专属数据（可选）
        ...(storeData && {
          productCount,
          products: storeData.products,
          storeName: storeData.storeName,
          storeDescription: storeData.storeDescription,
          hotInsights: storeData.hotInsights,
          productCategories: storeData.productCategories,
          deepScrapeResults: storeData.deepScrapeResults,
        }),

        // 独立站专属数据（可选）
        // 🔥 修改（2025-12-08）：添加hotInsights和deepScrapeResults，与Amazon Store保持一致
        ...(independentStoreData && {
          productCount,
          products: independentStoreData.products,
          storeName: independentStoreData.storeName,
          storeDescription: independentStoreData.storeDescription,
          logoUrl: independentStoreData.logoUrl,
          platform: independentStoreData.platform,
          hotInsights: independentStoreData.hotInsights,  // 🔥 新增：热销洞察
          productCategories: (independentStoreData as any).productCategories,
          deepScrapeResults: independentStoreData.deepScrapeResults,  // 🔥 新增：深度抓取结果
        }),

        // 🔥 独立站增强：Google品牌词搜索补充数据
        brandSearchSupplement,

        // 元数据
        redirectCount: resolvedData.redirectCount,
        redirectChain: resolvedData.redirectChain,
        pageTitle: resolvedData.pageTitle,
        resolveMethod: resolvedData.resolveMethod || 'unknown',
        proxyUsed: resolvedData.proxyUsed || null,

        // 🔥 页面类型标识（尊重用户选择）
        pageType: effectivePageType,
        pageTypeDetected: detectedPageType,
        pageTypeAdjusted: pageTypeAdjusted || undefined,
        warnings: extractionWarnings.length > 0 ? extractionWarnings : undefined,
        ...(supplementalRequested > 0 && {
          supplementalSummary: {
            requested: supplementalRequested,
            succeeded: supplementalProducts.filter((item) => !item.error).length,
            failed: supplementalProducts.filter((item) => item.error).length,
          },
        }),

        // 店铺模式：补充单品抓取结果
        ...(supplementalProducts.length > 0 && { supplementalProducts }),

        // 调试信息
        debug: {
          scrapedDataAvailable: !!scrapedData,
          brandAutoDetected: !!brandName,
          isAmazonStore: pageTypeByFinalUrl.isAmazonStore,  // ✅ 修复：基于URL模式判断
          isAmazonProductPage: pageTypeByFinalUrl.isAmazonProductPage,  // ✅ 修复：基于URL模式判断
          isIndependentStore,  // ✅ 修复：区分独立站店铺/单品
          pageTypeDetected: detectedPageType,
          pageTypeAdjusted: pageTypeAdjusted || undefined,
          productsExtracted: productCount,
          scrapeMethod: isAmazonStore ? 'playwright-store' :
                        amazonProductData ? 'playwright-product' :
                        independentStoreData ? 'playwright-independent' : 'axios-cheerio',
          scrapingError: scrapingError || undefined,  // 🔥 新增：包含抓取错误信息
          // 🆕 新增：数据抓取成功标志（用于诊断）
          amazonProductDataExtracted: !!amazonProductData,
          storeDataExtracted: !!storeData,
          independentStoreDataExtracted: !!independentStoreData,
        },
      } as ExtractOfferResult['data'],
    }
  } catch (error: any) {
    console.error('Offer提取失败:', error)

    return {
      success: false,
      error: {
        code: error instanceof AppError ? error.code : 'EXTRACTION_FAILED',
        message: error instanceof AppError ? error.message : '系统内部错误',
        details: { originalError: error.message },
      },
    }
  }
}
