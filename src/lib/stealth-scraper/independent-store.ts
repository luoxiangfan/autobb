/**
 * Independent Store Scraper
 *
 * Scrapes independent e-commerce sites (Shopify, WooCommerce, BigCommerce, etc.)
 * Extracts brand info and product listings for AI creative generation
 *
 * 🔥 增强版（2025-12-08）：
 * - 支持深度抓取热门商品详情（与Amazon Store一致）
 * - 支持评论抓取和评分提取
 * - 支持hotInsights计算
 */

import { Page } from 'playwright'
import { getPlaywrightPool } from '../playwright-pool'
import { normalizeBrandName } from '../offer-utils'
import { smartWaitForLoad, recordWaitOptimization } from '../smart-wait-strategy'
import {
  createStealthBrowser,
  releaseBrowser,
  configureStealthPage,
  randomDelay,
  getDynamicTimeout,
} from './browser-stealth'
import { isProxyConnectionError } from './proxy-utils'
import type { IndependentStoreData, IndependentProductData } from './types'
import { maskProxyUrl } from '../proxy/validate-url'
import {
  extractLandingDescription,
  extractLandingImages,
  extractLandingPrice,
  extractLandingProductName,
  isPresellStyleUrl,
  getRegistrableDomainLabelFromUrl,
  refineBrandNameForLandingPage,
} from '../landing-page-scrape-utils'
import { isLikelyNavigationLabel, normalizeScrapedTextLine } from '../scrape-text-filters'

const PROXY_URL = process.env.PROXY_URL || ''

function isLikelyBlockedTitle(title: unknown): boolean {
  if (typeof title !== 'string') return false
  const trimmed = title.trim()
  if (!trimmed) return false
  return /access\s+denied|forbidden|attention\s+required|just\s+a\s+moment|verify\s+you\s+are\s+human|captcha|enable\s+cookies/i.test(trimmed)
}

function shouldRetryWithNewProxy(error: any): boolean {
  if (!error) return false
  const message = String(error.message || error)
  if (isProxyConnectionError(error)) return true
  if (message.includes('HTTP 401') || message.includes('HTTP 403') || message.includes('HTTP 407') || message.includes('HTTP 429')) return true
  if (message.includes('Access Denied') || message.includes('Forbidden')) return true
  return false
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[\u00A0\u200B]/g, ' ').trim()
}

function normalizeForCompare(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function splitStoreTitleSegments(value: string): string[] {
  return value
    .split(/[|\u2013\u2014\-:·•]+/)
    .map(segment => cleanText(segment))
    .filter(Boolean)
}

function isReasonableStoreName(candidate: string): boolean {
  if (!candidate) return false
  if (candidate.length < 2 || candidate.length > 80) return false
  if (!/[A-Za-z]/.test(candidate)) return false
  const words = candidate.split(/\s+/).filter(Boolean)
  if (words.length > 8) return false
  if (isLikelyBlockedTitle(candidate)) return false
  return true
}

function containsGenericStoreToken(candidate: string): boolean {
  const lower = candidate.toLowerCase()
  const tokens = lower.split(/\s+/).filter(Boolean)
  const genericTokens = new Set(['official', 'store', 'shop', 'online', 'website', 'site'])
  return tokens.some(token => genericTokens.has(token))
}

function extractLeadingBrandToken(text: string): string | null {
  const cleaned = cleanText(text)
  if (!cleaned) return null

  const firstTokenRaw = cleaned.split(/\s+/).find(Boolean) || ''
  const firstToken = firstTokenRaw
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/[^A-Za-z0-9&'’\.\-]+$/, '')
    .trim()

  if (!firstToken) return null
  if (firstToken.length < 2) return null
  if (!/[A-Za-z]/.test(firstToken)) return null

  // Reject obvious boilerplate tokens that show up on store/home titles.
  const lower = firstToken.toLowerCase().replace(/\.$/, '')
  const rejected = new Set(['the', 'a', 'an', 'home', 'shop', 'store', 'official', 'website', 'online'])
  if (rejected.has(lower)) return null

  return firstToken
}

function normalizeBrandToken(token: string): string {
  // Normalize apostrophes and remove possessive `'s` so "Boscov’s" -> "Boscovs"
  const normalizedApostrophe = token.replace(/’/g, '\'')
  return normalizedApostrophe
    .replace(/'s\b/gi, 's')
    .replace(/[™®©]/g, '')
    .trim()
}

type CommentApiSummary = {
  total?: number
  score?: number
}

type CommentApiReviewItem = {
  title?: string | null
  content?: string | null
  nickname?: string | null
  score?: number | null
  time?: number | null
  imageList?: string[] | null
}

type CommentApiMessageItem = {
  content?: string | null
  replyList?: Array<{ content?: string | null }>
}

type CapturedCommentApiData = {
  summary?: CommentApiSummary
  reviewList?: CommentApiReviewItem[]
  messageList?: CommentApiMessageItem[]
}

function normalizeCommentApiResponse(payload: any): any | null {
  if (!payload || typeof payload !== 'object') return null
  return payload?.data && typeof payload.data === 'object' ? payload.data : payload
}

function buildCommentApiReviewHighlights(reviews: CommentApiReviewItem[]): string[] {
  const highlights: string[] = []
  for (const review of reviews) {
    const title = cleanText(review.title || '')
    const content = cleanText(review.content || '')
    const line = title && content ? `${title}: ${content}` : (title || content)
    if (!line || line.length < 12) continue
    if (!highlights.includes(line)) highlights.push(line)
    if (highlights.length >= 5) break
  }
  return highlights
}

function mergeCapturedCommentApiData(
  productData: IndependentProductData,
  captured: CapturedCommentApiData
): IndependentProductData {
  const summary = captured.summary
  const reviewList = Array.isArray(captured.reviewList) ? captured.reviewList : []
  const messageList = Array.isArray(captured.messageList) ? captured.messageList : []

  const structuredReviews = reviewList
    .map((item) => {
      const body = cleanText(item.content || '')
      const title = cleanText(item.title || '')
      const author = cleanText(item.nickname || '')
      const rating = Number(item.score || 0)
      if (!body && !title) return null
      return {
        rating: Number.isFinite(rating) && rating > 0 ? rating : 0,
        date: typeof item.time === 'number' && Number.isFinite(item.time)
          ? new Date(item.time).toISOString().slice(0, 10)
          : '',
        author: author || 'Anonymous',
        title,
        body,
        verifiedBuyer: false,
        images: Array.isArray(item.imageList) ? item.imageList.filter(Boolean) : undefined,
      }
    })
    .filter((item): item is NonNullable<typeof item> => !!item && (item.body.length > 0 || item.title.length > 0))

  const reviewTexts = structuredReviews
    .map((review) => cleanText(review.body || review.title || ''))
    .filter(Boolean)

  const topReviews = structuredReviews
    .map((review) => {
      const body = cleanText(review.body)
      const title = cleanText(review.title)
      return title && body ? `${title}: ${body}` : (title || body)
    })
    .filter(Boolean)
    .slice(0, 10)

  const qaPairs = messageList
    .map((item) => {
      const question = cleanText(item.content || '')
      const answer = cleanText(item.replyList?.[0]?.content || '')
      if (!question || !answer) return null
      return { question, answer }
    })
    .filter((item): item is NonNullable<typeof item> => !!item)
    .slice(0, 10)

  const socialProof = [...(productData.socialProof || [])]
  if (typeof summary?.score === 'number' && Number.isFinite(summary.score) && summary.score > 0) {
    socialProof.push({ metric: 'rating', value: String(summary.score) })
  }
  if (typeof summary?.total === 'number' && Number.isFinite(summary.total) && summary.total > 0) {
    socialProof.push({ metric: 'reviews', value: String(summary.total) })
  }
  if (qaPairs.length > 0) {
    socialProof.push({ metric: 'questions', value: String(qaPairs.length) })
  }

  const reviewHighlights = buildCommentApiReviewHighlights(reviewList)

  return {
    ...productData,
    rating: productData.rating || (typeof summary?.score === 'number' && summary.score > 0 ? String(summary.score) : null),
    reviewCount: productData.reviewCount || (typeof summary?.total === 'number' && summary.total >= 0 ? String(summary.total) : null),
    reviews: productData.reviews.length > 0 ? productData.reviews : reviewTexts.slice(0, 15),
    topReviews: (productData.topReviews && productData.topReviews.length > 0) ? productData.topReviews : topReviews,
    reviewHighlights: (productData.reviewHighlights && productData.reviewHighlights.length > 0)
      ? productData.reviewHighlights
      : reviewHighlights,
    structuredReviews: structuredReviews.length > 0 ? structuredReviews : productData.structuredReviews,
    qaPairs: qaPairs.length > 0 ? qaPairs : productData.qaPairs,
    socialProof: socialProof.length > 0 ? socialProof : productData.socialProof,
  }
}

/**
 * Scrape independent e-commerce store page
 * Extracts brand info and product listings for AI creative generation
 * P0优化: 使用连接池减少启动时间
 * P1优化: 代理失败时自动换新代理重试
 * 🌍 支持根据目标国家动态配置语言
 */
export async function scrapeIndependentStore(
  url: string,
  customProxyUrl?: string,
  targetCountry?: string,
  maxProxyRetries: number = 2
): Promise<IndependentStoreData> {
  console.log(`🏪 抓取独立站店铺: ${url}${targetCountry ? ` (国家: ${targetCountry})` : ''}`)

  let lastError: Error | undefined
  const effectiveProxyUrl = customProxyUrl || PROXY_URL

  for (let proxyAttempt = 0; proxyAttempt <= maxProxyRetries; proxyAttempt++) {
    try {
      if (proxyAttempt > 0) {
        console.log(`🔄 独立站抓取 - 代理重试 ${proxyAttempt}/${maxProxyRetries}，清理连接池并获取新代理...`)
        const pool = getPlaywrightPool()
        await pool.clearIdleInstances()
        // 🔥 清理代理IP缓存，强制获取新IP
        const { clearProxyCache } = await import('../proxy/fetch-proxy-ip')
        clearProxyCache(effectiveProxyUrl)
        console.log(`🧹 已清理代理IP缓存: ${maskProxyUrl(effectiveProxyUrl)}`)
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

      const browserResult = await createStealthBrowser(effectiveProxyUrl, targetCountry)
      let page: Page | null = null

      try {
        page = await browserResult.context.newPage()
        await configureStealthPage(page, targetCountry)

        console.log(`🌐 访问URL: ${url}`)
        await randomDelay(500, 1500)

        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: getDynamicTimeout(url),
        })

        if (!response) throw new Error('No response received')
        const httpStatus = response.status()
        console.log(`📊 HTTP状态: ${httpStatus}`)

        // 🔥 FIX: 处理429限流
        if (httpStatus === 429) {
          throw new Error('HTTP 429: Rate limit, need retry with new proxy')
        }

        // 🔥 防御：403/401等常见阻断，必须换代理重试，避免把阻断页<title>当作店铺名
        if (httpStatus === 401 || httpStatus === 403 || httpStatus === 407) {
          throw new Error(`HTTP ${httpStatus}: Access denied, need retry with new proxy`)
        }

        // Wait for content to load with smart wait strategy
        const waitResult = await smartWaitForLoad(page, url, { maxWaitTime: 15000 }).catch(() => ({
          waited: 15000,
          loadComplete: false,
          signals: [] as string[],
        }))

        console.log(`⏱️ 独立站页面等待: ${waitResult.waited}ms, 信号: ${waitResult.signals.join(', ')}`)
        recordWaitOptimization(15000, waitResult.waited)

        // Scroll down to trigger lazy loading of products
        console.log('🔄 滚动页面加载更多产品...')
        for (let i = 0; i < 5; i++) {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight))
          await randomDelay(600, 1000)
        }

        // Scroll back to top
        await page.evaluate(() => window.scrollTo(0, 0))
        await randomDelay(500, 800)

        const finalUrl = page.url()
        console.log(`✅ 最终URL: ${finalUrl}`)

        const title = await page.title().catch(() => '')
        if (isLikelyBlockedTitle(title)) {
          throw new Error(`Blocked page title detected: ${title}`)
        }

        const html = await page.content()

        // Parse store data from HTML
        const storeData = await parseIndependentStoreHtml(html, finalUrl)

        console.log(`✅ 独立站抓取成功: ${storeData.storeName}`)
        console.log(`📊 发现 ${storeData.products.length} 个产品`)

        // 进一步防御：解析出的店铺名仍然像阻断页时，直接重试换代理
        if (isLikelyBlockedTitle(storeData.storeName)) {
          throw new Error(`Blocked storeName detected: ${storeData.storeName}`)
        }

        return storeData
      } finally {
        // 🔥 2025-12-12 内存优化：确保Page在finally中关闭，防止内存泄漏
        if (page) {
          await page.close().catch((e) => {
            console.warn(`⚠️ [独立站] Page关闭失败: ${e.message}`)
          })
        }
        await releaseBrowser(browserResult)
      }

    } catch (error: any) {
      lastError = error
      console.error(`❌ 独立站抓取尝试 ${proxyAttempt + 1}/${maxProxyRetries + 1} 失败: ${error.message?.substring(0, 100)}`)

      // 如果是代理连接错误，尝试换新代理
      if (shouldRetryWithNewProxy(error)) {
        if (proxyAttempt < maxProxyRetries) {
          console.log(`🔄 检测到代理连接问题，准备换新代理重试...`)
          await new Promise(resolve => setTimeout(resolve, 2000))
          continue
        } else {
          console.error(`❌ 已用尽所有代理重试次数 (${maxProxyRetries + 1}次)`)
        }
      } else {
        // 🔥 非代理错误：立即失败，不继续重试
        console.error(`❌ 非代理错误，停止重试: ${error.message?.substring(0, 100)}`)
        throw error
      }
    }
  }

  // 所有代理重试都失败
  throw lastError || new Error('独立站抓取失败：已用尽所有代理重试')
}

/**
 * 🔥 新增：独立站店铺深度抓取 - 对热销商品进入详情页获取评价和竞品数据
 * 与Amazon Store的scrapeAmazonStoreDeep保持一致
 */
export async function scrapeIndependentStoreDeep(
  storeUrl: string,
  topN: number = 5,
  customProxyUrl?: string,
  targetCountry?: string,
  maxConcurrency: number = 3
): Promise<IndependentStoreData> {
  console.log(`🔍 独立站店铺深度抓取开始: ${storeUrl}, 目标抓取 ${topN} 个热销商品`)

  // 1. 首先抓取店铺基本信息和产品列表
  const storeData = await scrapeIndependentStore(storeUrl, customProxyUrl, targetCountry)

  console.log(`📊 scrapeIndependentStore返回产品数: ${storeData.products.length}`)

  if (storeData.products.length === 0) {
    console.warn(`⚠️ scrapeIndependentStore未返回任何产品`)
    return storeData
  }

  // 2. 筛选有URL的产品进行深度抓取
  const productsWithUrl = storeData.products.filter(p => p.productUrl)
  const hotProducts = productsWithUrl.slice(0, topN)

  console.log(`📊 筛选出 ${hotProducts.length} 个热销商品准备深度抓取`)

  if (hotProducts.length === 0) {
    console.warn('⚠️ 未找到可抓取的产品URL，跳过深度抓取')
    return storeData
  }

  // 3. 深度抓取每个热销商品
  const deepResults: NonNullable<IndependentStoreData['deepScrapeResults']> = {
    topProducts: [],
    totalScraped: hotProducts.length,
    successCount: 0,
    failedCount: 0
  }

  const effectiveProxyUrl = customProxyUrl || PROXY_URL

  // 批量处理，控制并发
  for (let i = 0; i < hotProducts.length; i += maxConcurrency) {
    const batch = hotProducts.slice(i, i + maxConcurrency)
    console.log(`🔄 处理批次 ${Math.floor(i / maxConcurrency) + 1}: ${batch.length} 个商品`)

    const batchResults = await Promise.allSettled(
      batch.map(async (product) => {
        const productUrl = product.productUrl!
        console.log(`  🛒 抓取商品详情: ${product.name?.substring(0, 50)}...`)

        try {
          const productData = await scrapeIndependentProduct(
            productUrl,
            effectiveProxyUrl,
            targetCountry,
            2
          )

          return {
            productUrl: productUrl,
            productData: productData,
            reviews: productData.reviews || [],
            competitorUrls: [] as string[],
            scrapeStatus: 'success' as const
          }
        } catch (error: any) {
          console.error(`  ❌ 商品详情抓取失败 (${productUrl}): ${error.message}`)
          return {
            productUrl: productUrl,
            productData: null,
            reviews: [],
            competitorUrls: [],
            scrapeStatus: 'failed' as const,
            error: error.message
          }
        }
      })
    )

    // 处理批次结果
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        deepResults.topProducts.push(result.value)
        if (result.value.scrapeStatus === 'success') {
          deepResults.successCount++
          console.log(`  ✅ 成功: ${result.value.productUrl.substring(0, 60)}..., 评价数: ${result.value.reviews.length}`)
        } else {
          deepResults.failedCount++
        }
      } else {
        deepResults.failedCount++
        console.error(`  ❌ Promise失败: ${result.reason}`)
      }
    }
  }

  console.log(`📊 深度抓取完成: 成功 ${deepResults.successCount}/${deepResults.totalScraped}`)

  // 4.5. 聚合产品分类（用于Offer“产品分类”展示/筛选）
  // 说明：独立站店铺页往往缺少统一的分类结构，这里优先从深度抓取到的商品详情 category 汇总。
  const categoryCounts = new Map<string, number>()
  for (const item of deepResults.topProducts) {
    const category = item.productData?.category
    if (typeof category !== 'string') continue
    const normalized = category.trim()
    if (!normalized) continue
    categoryCounts.set(normalized, (categoryCounts.get(normalized) || 0) + 1)
  }

  const productCategories = categoryCounts.size > 0 ? {
    primaryCategories: Array.from(categoryCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, count]) => ({ name, count })),
    totalCategories: categoryCounts.size,
  } : undefined

  // 4. 更新产品列表，添加从深度抓取获取的rating和reviewCount
  const enhancedProducts = storeData.products.map((product, index) => {
    const deepProduct = deepResults.topProducts.find(dp => dp.productUrl === product.productUrl)
    if (deepProduct?.productData) {
      return {
        ...product,
        rating: deepProduct.productData.rating || product.rating,
        reviewCount: deepProduct.productData.reviewCount || product.reviewCount,
      }
    }
    return product
  })

  // 5. 计算热销分数和洞察
  const productsWithScores = calculateIndependentHotScores(enhancedProducts)

  // 6. 计算hotInsights
  const productsWithRatings = productsWithScores.filter(p => {
    const rating = p.rating ? parseFloat(p.rating) : 0
    const reviewCount = p.reviewCount ? parseInt(p.reviewCount.replace(/,/g, '')) : 0
    return rating > 0 && reviewCount > 0
  })

  const hotInsights = productsWithRatings.length > 0 ? {
    avgRating: productsWithRatings.reduce((sum, p) => sum + parseFloat(p.rating || '0'), 0) / productsWithRatings.length,
    avgReviews: Math.round(productsWithRatings.reduce((sum, p) => sum + parseInt((p.reviewCount || '0').replace(/,/g, '')), 0) / productsWithRatings.length),
    topProductsCount: productsWithScores.length
  } : undefined

  console.log(`📊 热销商品筛选: ${storeData.products.length} → ${productsWithScores.length}`)
  if (hotInsights) {
    console.log(`💡 热销洞察: 平均评分 ${hotInsights.avgRating.toFixed(1)}⭐, 平均评论 ${hotInsights.avgReviews} 条`)
  }

  return {
    ...storeData,
    products: productsWithScores,
    hotInsights,
    ...(productCategories ? { productCategories } : {}),
    deepScrapeResults: deepResults
  }
}

/**
 * 🔥 新增：抓取独立站单个产品详情页
 */
export async function scrapeIndependentProduct(
  url: string,
  customProxyUrl?: string,
  targetCountry?: string,
  maxProxyRetries: number = 2
): Promise<IndependentProductData> {
  console.log(`📦 抓取独立站产品: ${url}`)

  let lastError: Error | undefined
  const effectiveProxyUrl = customProxyUrl || PROXY_URL

  for (let proxyAttempt = 0; proxyAttempt <= maxProxyRetries; proxyAttempt++) {
    try {
      if (proxyAttempt > 0) {
        console.log(`🔄 独立站产品抓取 - 代理重试 ${proxyAttempt}/${maxProxyRetries}`)
        const pool = getPlaywrightPool()
        await pool.clearIdleInstances()
        const { clearProxyCache } = await import('../proxy/fetch-proxy-ip')
        clearProxyCache(effectiveProxyUrl)
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

      const browserResult = await createStealthBrowser(effectiveProxyUrl, targetCountry)
      let page: Page | null = null

      try {
        page = await browserResult.context.newPage()
        await configureStealthPage(page, targetCountry)

        const capturedCommentApiData: CapturedCommentApiData = {}
        page.on('response', async (res) => {
          const resUrl = res.url()
          if (!resUrl.includes('/api/gsv-comment-plugin/')) return

          try {
            const payload = normalizeCommentApiResponse(await res.json())
            if (!payload) return
            if (resUrl.includes('/comment/query/summary')) {
              capturedCommentApiData.summary = payload as CommentApiSummary
            } else if (resUrl.includes('/comment/query/list')) {
              capturedCommentApiData.reviewList = Array.isArray(payload?.list) ? payload.list : []
            } else if (resUrl.includes('/message/list')) {
              capturedCommentApiData.messageList = Array.isArray(payload?.list) ? payload.list : []
            }
          } catch (responseError: any) {
            console.warn(`⚠️ 评论接口响应解析失败: ${responseError?.message || responseError}`)
          }
        })

        await randomDelay(500, 1500)

        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: getDynamicTimeout(url),
        })

        if (!response) throw new Error('No response received')

        const httpStatus = response.status()
        // 🔥 防御：403/401等常见阻断，必须换代理重试，避免把阻断页标题/内容当作产品信息
        if (httpStatus === 429) {
          throw new Error('HTTP 429: Rate limit, need retry with new proxy')
        }
        if (httpStatus === 401 || httpStatus === 403 || httpStatus === 407) {
          throw new Error(`HTTP ${httpStatus}: Access denied, need retry with new proxy`)
        }

        // Wait for content
        await smartWaitForLoad(page, url, { maxWaitTime: 12000 }).catch(() => {})
        await randomDelay(1000, 2000)

        const title = await page.title().catch(() => '')
        if (isLikelyBlockedTitle(title)) {
          throw new Error(`Blocked page title detected: ${title}`)
        }

        // Scroll to trigger lazy loading (including reviews section)
        for (let i = 0; i < 5; i++) {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight))
          await randomDelay(400, 600)
        }

        // 🔥 等待评论组件加载（独立站评论通常由第三方插件动态加载）
        const reviewSelectors = [
          // Judge.me
          '.jdgm-rev__body', '.jdgm-review', '[class*="jdgm"]',
          // Stamped.io
          '.stamped-review', '[class*="stamped"]',
          // Loox
          '.loox-review', '[class*="loox"]',
          // Yotpo
          '.yotpo-review', '[class*="yotpo"]',
          // Okendo
          '.okendo-review', '[class*="okendo"]',
          // Rivyo
          '.rivyo-review', '[class*="rivyo"]',
          // Ali Reviews
          '.ali-review', '[class*="ali-review"]',
          // Generic review selectors
          '[class*="review-content"]', '[class*="review-text"]', '[class*="review-body"]',
          '[itemprop="reviewBody"]', '.review-item', '.customer-review',
        ]

        // 尝试等待任一评论选择器出现
        let reviewsLoaded = false
        for (const selector of reviewSelectors) {
          try {
            await page.waitForSelector(selector, { timeout: 3000 })
            console.log(`  ✅ 检测到评论组件: ${selector}`)
            reviewsLoaded = true
            // 额外等待确保评论内容完全加载
            await randomDelay(1500, 2500)
            break
          } catch {
            // 继续尝试下一个选择器
          }
        }

        if (!reviewsLoaded) {
          // 尝试点击"显示评论"按钮触发加载
          const showReviewButtons = [
            '[class*="show-review"]', '[class*="load-review"]', '[class*="view-review"]',
            'button:has-text("Reviews")', 'a:has-text("Reviews")',
            '[data-action="show-reviews"]', '#reviews-tab', '[href="#reviews"]',
          ]
          for (const btnSelector of showReviewButtons) {
            try {
              const btn = await page.$(btnSelector)
              if (btn) {
                await btn.click()
                console.log(`  🔘 点击评论按钮: ${btnSelector}`)
                await randomDelay(2000, 3000)
                break
              }
            } catch {
              // 继续
            }
          }
        }

        // 再次滚动确保所有评论加载
        await page.evaluate(() => window.scrollBy(0, 500))
        await randomDelay(500, 1000)

        const html = await page.content()

        // Parse product data
        const productData = await parseIndependentProductHtml(html, url)

        if (isLikelyBlockedTitle(productData.productName)) {
          throw new Error(`Blocked productName detected: ${productData.productName}`)
        }

        return mergeCapturedCommentApiData(productData, capturedCommentApiData)
      } finally {
        // 🔥 2025-12-12 内存优化：确保Page在finally中关闭，防止内存泄漏
        if (page) {
          await page.close().catch((e) => {
            console.warn(`⚠️ [独立站产品] Page关闭失败: ${e.message}`)
          })
        }
        await releaseBrowser(browserResult)
      }

    } catch (error: any) {
      lastError = error
      console.error(`❌ 独立站产品抓取尝试 ${proxyAttempt + 1} 失败: ${error.message?.substring(0, 100)}`)

      if (shouldRetryWithNewProxy(error) && proxyAttempt < maxProxyRetries) {
        await new Promise(resolve => setTimeout(resolve, 2000))
        continue
      }
      throw error
    }
  }

  throw lastError || new Error('独立站产品抓取失败')
}

/**
 * Parse independent product page HTML
 */
async function parseIndependentProductHtml(html: string, url: string): Promise<IndependentProductData> {
  const { load } = await import('cheerio')
  const $ = load(html)

  // Detect platform for platform-specific extraction
  const platform = detectPlatform($)

  // 🔥 2026-01-14：支持“pre/presell advertorial”独立站落地页
  // 这类页面的meta title/og:title经常是频道名，不是商品名；商品名更可能出现在CTA/强调文本中
  const baseProductName =
    $('meta[property="og:title"]').attr('content') ||
    $('h1').first().text().trim() ||
    $('[class*="product-title"], [class*="ProductTitle"]').first().text().trim() ||
    null

  const productName = isPresellStyleUrl(url)
    ? (extractLandingProductName($, url) || baseProductName)
    : baseProductName

  const productDescription =
    extractLandingDescription({ $, productName }) ||
    $('meta[property="og:description"]').attr('content') ||
    $('meta[name="description"]').attr('content') ||
    $('[class*="product-description"], [class*="ProductDescription"]').first().text().trim() ||
     null

  // Extract price
  const productPrice = extractPrice($) || extractLandingPrice($, url)

  // Extract original price (for discount calculation)
  const originalPrice = $('[class*="compare-price"], [class*="was-price"], [class*="original-price"], del')
                        .first().text().trim() || null

  // Calculate discount
  const discount = calculateDiscount(productPrice, originalPrice)

  // Extract brand name - 🔥 2025-12-24优化：增强品牌提取，防止捕获导航菜单
  // 优先级：结构化数据 > 页面meta标签 > 专用品牌字段（限定选择器） > 产品名第一词
  const brandName = refineBrandNameForLandingPage({
    url,
    $,
    productName,
    currentBrandName: extractBrandFromIndependentProduct($, url, productName),
  })

  // Extract features
  const features = extractFeatures($)
  const technicalDetails = extractTechnicalDetails($)
  const coreFeatures = features.slice(0, 5)
  const secondaryFeatures = features.slice(5, 10)

  // Extract images
  const imageUrls = (() => {
    const urls = extractImages($, url)
    if (urls.length > 0) return urls
    return extractLandingImages($, url, 5)
  })()

  // Extract rating and review count (platform-specific)
  const { rating, reviewCount } = extractRatingAndReviews($, platform)

  // Extract availability
  const availability = $('[class*="availability"], [class*="stock"]').first().text().trim() ||
                       ($('[class*="add-to-cart"], button[type="submit"]').length > 0 ? 'In Stock' : null)

  // Extract reviews
  const reviews = extractProductReviews($)

  // Extract category
  const category = $('[class*="breadcrumb"] a').last().text().trim() ||
                   $('meta[property="product:category"]').attr('content') ||
                   null

  // 🔥 2025-12-24增强：提取实用的独立站特定数据（非Amazon风格，而是真实可用的）
  // 1. 库存状态（不同平台有不同表示）
  const stockStatus = extractStockStatus($)

  // 2. 配送信息（免邮、运费、预计送达等）
  const shippingInfo = extractShippingInfo($)

  // 3. 促销标签（Limited Offer, Flash Sale, Best Seller等）
  const badge = extractProductBadge($, platform)

  const socialProof: Array<{ metric: string; value: string }> = []
  if (rating) socialProof.push({ metric: 'rating', value: rating })
  if (reviewCount) socialProof.push({ metric: 'reviews', value: reviewCount })
  if (stockStatus) socialProof.push({ metric: 'inventory', value: stockStatus })

  return {
    productName,
    rawProductTitle: productName,
    rawAboutThisItem: features.slice(0, 10),
    productDescription,
    productPrice,
    originalPrice,
    discount,
    brandName: brandName ? normalizeBrandName(brandName) : null,
    features,
    imageUrls,
    technicalDetails: Object.keys(technicalDetails).length > 0 ? technicalDetails : undefined,
    rating,
    reviewCount,
    availability,
    reviews,
    category,
    coreFeatures: coreFeatures.length > 0 ? coreFeatures : undefined,
    secondaryFeatures: secondaryFeatures.length > 0 ? secondaryFeatures : undefined,
    socialProof: socialProof.length > 0 ? socialProof : undefined,
    // 🔥 增强的可选字段（有的话提取，没有也不强求）
    ...(stockStatus && { stockStatus }),
    ...(shippingInfo && { shippingInfo }),
    ...(badge && { badge }),
  }
}

/**
 * Extract price from product page
 */
function extractPrice($: ReturnType<typeof import('cheerio').load>): string | null {
  const priceSelectors = [
    '[class*="product-price"]:not([class*="compare"]):not([class*="was"])',
    '[class*="ProductPrice"]:not([class*="compare"])',
    '[class*="sale-price"]',
    '[class*="current-price"]',
    '.price:not(.was-price)',
    '[data-product-price]',
    '.money:first',
  ]

  for (const selector of priceSelectors) {
    const priceText = $(selector).first().text().trim()
    if (priceText && /[\d.,]+/.test(priceText)) {
      return priceText
    }
  }

  return null
}

/**
 * Calculate discount percentage
 */
function calculateDiscount(currentPrice: string | null, originalPrice: string | null): string | null {
  if (!currentPrice || !originalPrice) return null

  const current = parseFloat(currentPrice.replace(/[^0-9.]/g, ''))
  const original = parseFloat(originalPrice.replace(/[^0-9.]/g, ''))

  if (current && original && original > current) {
    const discount = Math.round((1 - current / original) * 100)
    return `${discount}% off`
  }

  return null
}

/**
 * Extract product features
 */
function extractFeatures($: ReturnType<typeof import('cheerio').load>): string[] {
  const features: string[] = []

  const isInNavigationContext = (el: any): boolean => {
    try {
      const $el = $(el)
      return $el.closest(
        [
          'nav',
          'header',
          'footer',
          '.my-account-details',
          '.sign-in-dropdown',
          '[class*="account"]',
          '[id*="account"]',
          '[class*="utilitynav"]',
          '[class*="breadcrumb"]',
          '[class*="navbar"]',
        ].join(', ')
      ).length > 0
    } catch {
      return false
    }
  }

  // Try different feature selectors
  const featureSelectors = [
    '[class*="product-feature"] li',
    '[class*="features"] li',
    '[class*="specification"] li',
    '[class*="detail"] li',
    '.product-description ul li',
  ]

  for (const selector of featureSelectors) {
    $(selector).each((i, el) => {
      const text = normalizeScrapedTextLine($(el).text())
      if (!text) return
      if (text.length <= 5 || text.length >= 500) return
      if (isLikelyNavigationLabel(text)) return
      if (isInNavigationContext(el)) return

      // Case-insensitive dedupe
      const key = text.toLowerCase()
      if (features.some((f) => f.toLowerCase() === key)) return
      features.push(text)
    })
    if (features.length >= 10) break
  }

  return features.slice(0, 10)
}

/**
 * Extract product images
 */
function extractImages($: ReturnType<typeof import('cheerio').load>, baseUrl: string): string[] {
  const images: string[] = []

  // Try different image selectors
  const imageSelectors = [
    '[class*="product-image"] img',
    '[class*="ProductImage"] img',
    '[class*="gallery"] img',
    '[class*="swiper"] img',
    '[class*="thumb"] img',
    'figure img',
    '.product img',
    '[data-product-image]',
    'img[src*="/image/store/"]',
  ]

  for (const selector of imageSelectors) {
    $(selector).each((i, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src')
      const alt = cleanText($(el).attr('alt') || '')
      if (!src || src.startsWith('data:image')) return
      if (alt && /logo|icon|payment|facebook|instagram|youtube/i.test(alt)) return
      if (!images.includes(src)) {
        const fullUrl = src.startsWith('http') ? src : new URL(src, baseUrl).href
        images.push(fullUrl)
      }
    })
    if (images.length >= 5) break
  }

  return images.slice(0, 5)
}

/**
 * Extract rating and review count (platform-specific)
 */
function extractRatingAndReviews($: ReturnType<typeof import('cheerio').load>, platform: string | null): { rating: string | null, reviewCount: string | null } {
  let rating: string | null = null
  let reviewCount: string | null = null

  // Shopify-specific (using common review apps like Judge.me, Stamped, Loox)
  if (platform === 'shopify' || platform === 'myshopline') {
    // Judge.me
    rating = $('[class*="jdgm-prev-badge"]').attr('data-average-rating') ||
             $('[class*="jdgm"] [class*="rating"]').first().text().match(/[\d.]+/)?.[0] || null

    reviewCount = $('[class*="jdgm-prev-badge"]').attr('data-number-of-reviews') ||
                  $('[class*="jdgm"] [class*="count"]').first().text().match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null

    // Stamped
    if (!rating) {
      rating = $('[class*="stamped-badge"]').attr('data-rating') ||
               $('[class*="stamped"] [class*="rating"]').first().text().match(/[\d.]+/)?.[0] || null
    }
    if (!reviewCount) {
      reviewCount = $('[class*="stamped-badge"]').attr('data-count') ||
                    $('[class*="stamped"] [class*="count"]').first().text().match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null
    }

    // Loox
    if (!rating) {
      rating = $('[class*="loox"] [class*="rating"]').first().text().match(/[\d.]+/)?.[0] || null
    }
    if (!reviewCount) {
      reviewCount = $('[class*="loox"] [class*="count"]').first().text().match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null
    }
  }

  // WooCommerce
  if (platform === 'woocommerce') {
    rating = $('.woocommerce-product-rating .rating').first().text().match(/[\d.]+/)?.[0] ||
             $('[class*="star-rating"]').attr('title')?.match(/[\d.]+/)?.[0] || null

    reviewCount = $('.woocommerce-review-link').first().text().match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null
  }

  // Generic selectors
  if (!rating) {
    rating = $('[class*="rating-value"], [class*="average-rating"]').first().text().match(/[\d.]+/)?.[0] ||
             $('[itemprop="ratingValue"]').attr('content') ||
             $('[class*="star"] [class*="rating"]').first().text().match(/[\d.]+/)?.[0] || null
  }

  if (!reviewCount) {
    reviewCount = $('[class*="review-count"], [class*="reviews-count"]').first().text().match(/[\d,]+/)?.[0]?.replace(/,/g, '') ||
                  $('[itemprop="reviewCount"]').attr('content') ||
                  $('a[href*="review"]').first().text().match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null
  }

  return { rating, reviewCount }
}

/**
 * Extract product reviews - 🔥 增强版：支持主流评论插件
 */
function extractProductReviews($: ReturnType<typeof import('cheerio').load>): string[] {
  const reviews: string[] = []

  // 🔥 增强：支持主流Shopify评论插件
  const reviewSelectors = [
    // Judge.me (最流行的Shopify评论插件)
    '.jdgm-rev__body',
    '.jdgm-rev-widg__body',
    '[class*="jdgm"] .jdgm-rev__body',
    // Stamped.io
    '.stamped-review-content',
    '.stamped-review-body',
    '[class*="stamped"] .review-content',
    // Loox
    '.loox-review-content',
    '.loox__review-content',
    '[class*="loox"] .review-text',
    // Yotpo
    '.yotpo-review-content',
    '.content-review',
    '[class*="yotpo"] .review-content',
    // Okendo
    '.okendo-review-content',
    '[class*="okendo"] .review-text',
    // Rivyo
    '.rivyo-review-content',
    // Ali Reviews
    '.ali-review-content',
    // Shopify Product Reviews (官方)
    '.spr-review-content',
    '.spr-review-content-body',
    // WooCommerce
    '.woocommerce-review__content',
    '.comment-text p',
    // Generic selectors
    '[class*="review-content"]',
    '[class*="review-text"]',
    '[class*="review-body"]',
    '[class*="ReviewContent"]',
    '[class*="customer-review"] p',
    '.review p',
    '[itemprop="reviewBody"]',
    '[data-review-content]',
    '.review-message',
    '.review-description',
  ]

  for (const selector of reviewSelectors) {
    $(selector).each((i, el) => {
      const text = $(el).text().trim()
      // 过滤太短或太长的文本，以及重复内容
      if (text && text.length > 20 && text.length < 3000 && !reviews.includes(text)) {
        // 过滤掉明显不是评论的内容
        const lowerText = text.toLowerCase()
        if (!lowerText.includes('write a review') &&
            !lowerText.includes('be the first') &&
            !lowerText.includes('no reviews yet') &&
            !lowerText.includes('loading')) {
          reviews.push(text)
        }
      }
    })
    if (reviews.length >= 15) break
  }

  return reviews.slice(0, 15)
}

function extractTechnicalDetails($: ReturnType<typeof import('cheerio').load>): Record<string, string> {
  const technicalDetails: Record<string, string> = {}

  $('table tr').each((_i, row) => {
    const cells = $(row).find('th, td')
    if (cells.length < 2) return
    const key = cleanText($(cells[0]).text())
    const value = cleanText($(cells[1]).text())
    if (!key || !value) return
    if (key.length > 80 || value.length > 240) return
    technicalDetails[key] = value
  })

  $('p, li, div').each((_i, el) => {
    const text = cleanText($(el).text())
    if (!text || text.length > 260) return
    const match = text.match(/^([^:]{2,50}):\s+(.{2,200})$/)
    if (!match) return
    const key = cleanText(match[1])
    const value = cleanText(match[2])
    if (!key || !value) return
    if (isLikelyNavigationLabel(key) || isLikelyNavigationLabel(value)) return
    technicalDetails[key] = value
  })

  return technicalDetails
}

/**
 * 🔥 新增：计算独立站产品热销分数
 */
function calculateIndependentHotScores(products: IndependentStoreData['products']): IndependentStoreData['products'] {
  const productsWithScores = products.map(p => {
    const rating = p.rating ? parseFloat(p.rating) : 0
    const reviewCount = p.reviewCount ? parseInt(p.reviewCount.replace(/,/g, '')) : 0

    // 热销分数计算：评分 * log(评论数+1)
    // 对于独立站，如果没有评论数据，给一个基础分数
    const hotScore = rating > 0 && reviewCount > 0
      ? rating * Math.log10(reviewCount + 1)
      : (rating > 0 ? rating * 0.5 : 0)

    return { ...p, hotScore, ratingNum: rating, reviewCountNum: reviewCount }
  })

  // 按热销分数排序
  productsWithScores.sort((a, b) => b.hotScore - a.hotScore)

  // 取前15个热销商品
  const topCount = Math.min(15, productsWithScores.length)
  const topProducts = productsWithScores.slice(0, topCount)

  return topProducts.map((p, index) => ({
    name: p.name,
    price: p.price,
    productUrl: p.productUrl,
    rating: p.rating,
    reviewCount: p.reviewCount,
    imageUrl: p.imageUrl,
    hotScore: p.hotScore,
    rank: index + 1,
    isHot: index < 5,
    hotLabel: index < 5 ? '🔥 热销商品' : '✅ 畅销商品'
  }))
}

/**
 * Parse independent store HTML to extract store data
 */
async function parseIndependentStoreHtml(html: string, finalUrl: string): Promise<IndependentStoreData> {
  const { load } = await import('cheerio')
  const $ = load(html)

  // Detect platform
  const platform = detectPlatform($)
  console.log(`🔍 检测到平台: ${platform || 'generic'}`)

  // Extract store name
  const domainLabel = getRegistrableDomainLabelFromUrl(finalUrl)
  const domainBrand = domainLabel ? normalizeBrandName(domainLabel) : null

  const storeNameCandidates = [
    $('meta[property="og:site_name"]').attr('content'),
    $('meta[name="application-name"]').attr('content'),
    $('meta[property="og:title"]').attr('content'),
    $('title').text(),
    $('h1').first().text(),
  ]
    .map((v) => (typeof v === 'string' ? cleanText(v) : ''))
    .filter(Boolean)

  const resolvedStoreName = (() => {
    const domainNorm = domainBrand ? normalizeForCompare(domainBrand) : ''

    for (const rawCandidate of storeNameCandidates) {
      if (!rawCandidate) continue
      const candidate = cleanText(rawCandidate)
      if (!isReasonableStoreName(candidate)) continue

      const segments = splitStoreTitleSegments(candidate)
      const preferredSegment = domainNorm
        ? segments.find(part => normalizeForCompare(part).includes(domainNorm))
        : null
      const picked = cleanText(preferredSegment || segments[0] || candidate)
      if (!isReasonableStoreName(picked)) continue

      if (domainNorm && normalizeForCompare(picked).includes(domainNorm)) {
        if (domainBrand && containsGenericStoreToken(picked)) {
          return domainBrand
        }
        return normalizeBrandName(picked)
      }

      const words = picked.split(/\s+/).filter(Boolean)
      if (words.length >= 2 && words.length <= 5) {
        return normalizeBrandName(picked)
      }

      const token = extractLeadingBrandToken(picked)
      if (!token) continue

      const normalized = normalizeBrandToken(token)
      if (!normalized) continue

      if (domainBrand && normalizeBrandName(normalized) === domainBrand) {
        return domainBrand
      }

      return normalizeBrandName(normalized)
    }

    return domainBrand
  })()

  // Extract store description
  const storeDescription = $('meta[property="og:description"]').attr('content') ||
                           $('meta[name="description"]').attr('content') ||
                           null

  // Extract logo
  const logoUrl = $('meta[property="og:image"]').attr('content') ||
                  $('link[rel="icon"]').attr('href') ||
                  $('img[class*="logo"], img[alt*="logo" i], header img').first().attr('src') ||
                  null

  // Extract products with enhanced data
  const products = extractProducts($, finalUrl, platform)

  return {
    storeName: resolvedStoreName || null,
    storeDescription,
    logoUrl,
    products,
    totalProducts: products.length,
    storeUrl: finalUrl,
    platform,
  }
}

/**
 * 🔥 2025-12-24新增：从独立站产品页提取品牌名
 *
 * 多渠道提取策略，防止捕获导航菜单和页脚内容：
 * 1. JSON-LD结构化数据（最可靠）
 * 2. 页面meta标签（og:brand, twitter:brand）
 * 3. 产品详情meta标签（og:site_name, application-name）
 * 4. 限定范围的品牌字段选择器（仅主要内容区域）
 * 5. 从产品名第一词提取（备选方案）
 */
function extractBrandFromIndependentProduct(
  $: ReturnType<typeof import('cheerio').load>,
  url: string,
  productName: string | null
): string | null {
  // 渠道1: JSON-LD结构化数据（最可靠）
  try {
    const jsonLdScripts = $('script[type="application/ld+json"]')
    for (let i = 0; i < jsonLdScripts.length; i++) {
      const text = jsonLdScripts.eq(i).html()
      if (!text) continue

      try {
        const data = JSON.parse(text)
        // 检查是否包含brand字段
        if (data.brand?.name) {
          return data.brand.name
        } else if (data.brand && typeof data.brand === 'string') {
          return data.brand
        }

        // 检查@graph格式
        if (data['@graph']) {
          for (const item of data['@graph']) {
            if (item.brand?.name) return item.brand.name
            if (item.brand && typeof item.brand === 'string') return item.brand
          }
        }
      } catch {
        // JSON解析失败，继续下一个
      }
    }
  } catch {
    // 忽略JSON-LD提取错误
  }

  // 渠道2: Meta标签（og:brand, twitter:brand）
  const metaBrand = $('meta[property="og:brand"]').attr('content') ||
                   $('meta[name="brand"]').attr('content')
  if (metaBrand && metaBrand.length > 1 && metaBrand.length < 50) {
    return metaBrand
  }

  // 渠道3: og:site_name（网站名称，但品牌不同）
  const siteName = $('meta[property="og:site_name"]').attr('content')
  if (siteName && siteName.length > 1 && siteName.length < 50) {
    // 确保不是通用网站名称
    if (!/^(shop|store|website|site)$/i.test(siteName)) {
      return siteName
    }
  }

  // 渠道4: 限定范围的品牌字段提取（仅主要内容区域，不从导航/页脚）
  // 🔥 关键优化：只在主要内容区域搜索，排除header/footer/nav
  const mainContent = $('main, [class*="content"], [class*="product-details"], [class*="product-main"]').first()
  const searchInMain = mainContent.length > 0 ? mainContent : $('body')

  // 精确选择器：匹配 brand: 或 vendor: 标签
  const brandLabel = searchInMain.find('[class*="brand"], [class*="vendor"]').filter((i, el) => {
    const text = $(el).text().trim().toLowerCase()
    const isLabel = /^(brand|vendor|maker|manufacturer)/.test(text)
    const length = text.length
    // 过滤：排除导航菜单、footer、长文本
    return isLabel && length > 2 && length < 50 && !text.includes('select') && !text.includes('menu')
  }).first().text().trim()

  if (brandLabel && brandLabel.length > 1 && brandLabel.length < 50) {
    // 清理"Brand: " 或 "Vendor: "前缀
    const cleaned = brandLabel
      .replace(/^(Brand|Vendor|Maker|Manufacturer):\s*/i, '')
      .trim()
    if (cleaned.length > 1 && cleaned.length < 50) {
      return cleaned
    }
  }

  // 渠道5: 从产品名提取（备选）
  if (productName) {
    const parts = productName.split(/[\s\-–—|,]+/)
    if (parts.length > 0) {
      const potentialBrand = parts[0].trim()
      // 验证是否看起来像品牌名（2-25字符，不是纯数字/特殊符号）
      if (potentialBrand.length >= 2 && potentialBrand.length <= 25 &&
          /^[A-Za-z0-9&\-\.'\s]+$/.test(potentialBrand) &&
          !/^\d+/.test(potentialBrand)) {
        return potentialBrand
      }
    }
  }

  // 渠道6: 从URL域名提取
  const domainLabel = getRegistrableDomainLabelFromUrl(url)
  if (domainLabel) {
    const normalized = domainLabel.replace(/[-_]+/g, ' ').trim()
    if (normalized.length >= 2 && normalized.length <= 40) return normalized
  }

  return null
}

/**
 * Detect e-commerce platform from HTML
 */
function detectPlatform($: ReturnType<typeof import('cheerio').load>): string | null {
  if (
    $('script[src*="myshopline.com"]').length > 0 ||
    $('script[src*="front.myshopline.com"]').length > 0 ||
    $('script[src*="plugin-product-comment"]').length > 0 ||
    $('meta[property="og:site_name"]').attr('content')?.toLowerCase().includes('myshopline')
  ) {
    return 'myshopline'
  }
  if ($('script[src*="cdn.shopify.com"]').length > 0 || $('[data-shopify]').length > 0) {
    return 'shopify'
  }
  if ($('script[src*="woocommerce"]').length > 0 || $('body.woocommerce').length > 0) {
    return 'woocommerce'
  }
  if ($('[class*="bigcommerce"]').length > 0) {
    return 'bigcommerce'
  }
  return null
}

/**
 * Extract products from store page HTML (增强版)
 */
function extractProducts(
  $: ReturnType<typeof import('cheerio').load>,
  finalUrl: string,
  platform: string | null
): IndependentStoreData['products'] {
  const products: IndependentStoreData['products'] = []

  // Common product container selectors
  const productSelectors = [
    // Shopify
    '.product-card',
    '.product-item',
    '[class*="ProductItem"]',
    '[class*="product-grid"] > *',
    '.collection-product',
    // WooCommerce
    '.product',
    '.woocommerce-LoopProduct-link',
    // Generic
    '[class*="product"]',
    '[data-product-id]',
    '[data-product]',
    '.item',
    '.card',
    // Grid items
    '.grid-item',
    '[class*="grid"] > div',
    '[class*="collection"] > div',
  ]

  for (const selector of productSelectors) {
    if (products.length >= 5) break

    $(selector).each((i, el) => {
      if (products.length >= 30) return false

      const $el = $(el)

      // Extract product name
      const name = $el.find('h2, h3, h4, [class*="title"], [class*="name"]').first().text().trim() ||
                   $el.find('a').first().text().trim() ||
                   $el.find('img').first().attr('alt') ||
                   ''

      // Extract price
      const priceText = $el.find('[class*="price"]:not([class*="compare"]):not([class*="was"]), .money, [data-price]').first().text().trim()
      const price = priceText || null

      // Extract product link
      const productUrl = $el.find('a').first().attr('href') ||
                        $el.attr('href') ||
                        null

      // 🔥 新增：提取图片URL
      const imageUrl = $el.find('img').first().attr('src') ||
                       $el.find('img').first().attr('data-src') ||
                       null

      // 🔥 新增：尝试提取评分和评论数（平台特定）
      const { rating, reviewCount } = extractProductCardRating($el, platform)

      // Add product if we have a valid name
      if (name && name.length > 3 && name.length < 200 && !products.some(p => p.name === name)) {
        products.push({
          name,
          price,
          productUrl: productUrl ? (productUrl.startsWith('http') ? productUrl : new URL(productUrl, finalUrl).href) : null,
          imageUrl: imageUrl ? (imageUrl.startsWith('http') ? imageUrl : new URL(imageUrl, finalUrl).href) : null,
          rating,
          reviewCount,
        })
      }
    })
  }

  // Fallback: Extract from images with product-like alt text
  if (products.length < 5) {
    console.log('🔍 尝试从图片提取产品...')
    extractProductsFromImages($, finalUrl, products)
  }

  return products
}

/**
 * 🔥 新增：从产品卡片提取评分信息
 */
function extractProductCardRating(
  $el: ReturnType<ReturnType<typeof import('cheerio').load>>,
  platform: string | null
): { rating: string | null, reviewCount: string | null } {
  let rating: string | null = null
  let reviewCount: string | null = null

  // Shopify review apps (Judge.me, Stamped, Loox)
  if (platform === 'shopify') {
    rating = $el.find('[class*="jdgm"]').attr('data-average-rating') ||
             $el.find('[class*="stamped"]').attr('data-rating') ||
             $el.find('[class*="loox"] [class*="rating"]').text().match(/[\d.]+/)?.[0] || null

    reviewCount = $el.find('[class*="jdgm"]').attr('data-number-of-reviews') ||
                  $el.find('[class*="stamped"]').attr('data-count') ||
                  $el.find('[class*="review-count"]').text().match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null
  }

  // WooCommerce
  if (platform === 'woocommerce') {
    rating = $el.find('[class*="star-rating"]').attr('title')?.match(/[\d.]+/)?.[0] || null
    reviewCount = $el.find('[class*="review-count"]').text().match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null
  }

  // Generic fallback
  if (!rating) {
    rating = $el.find('[class*="rating"]').text().match(/[\d.]+/)?.[0] || null
  }
  if (!reviewCount) {
    reviewCount = $el.find('[class*="review"]').text().match(/\((\d+)\)/)?.[1] || null
  }

  return { rating, reviewCount }
}

/**
 * Extract products from image alt text (fallback method)
 */
function extractProductsFromImages(
  $: ReturnType<typeof import('cheerio').load>,
  finalUrl: string,
  products: IndependentStoreData['products']
): void {
  $('img[alt]').each((i, el) => {
    if (products.length >= 30) return false

    const alt = $(el).attr('alt')?.trim() || ''
    const src = $(el).attr('src') || $(el).attr('data-src') || ''

    // Filter for likely product images
    if (alt && alt.length > 5 && alt.length < 150 &&
        !alt.toLowerCase().includes('logo') &&
        !alt.toLowerCase().includes('banner') &&
        !alt.toLowerCase().includes('icon') &&
        src &&
        !products.some(p => p.name === alt)) {

      // Try to find price near image
      const $parent = $(el).closest('div, li, article').first()
      const nearbyPrice = $parent.find('[class*="price"], .money').first().text().trim() || null
      const nearbyLink = $parent.find('a[href*="/product"], a[href*="/collections"]').first().attr('href') || null

      products.push({
        name: alt,
        price: nearbyPrice,
        productUrl: nearbyLink ? (nearbyLink.startsWith('http') ? nearbyLink : new URL(nearbyLink, finalUrl).href) : null,
        imageUrl: src.startsWith('http') ? src : new URL(src, finalUrl).href,
      })
    }
  })
}

/**
 * 🔥 2025-12-24新增：提取库存状态
 * 支持多个平台的库存表示方式（Out of Stock, Sold Out, Limited Stock等）
 */
function extractStockStatus($: ReturnType<typeof import('cheerio').load>): string | null {
  const stockSelectors = [
    // Shopify
    '[class*="stock"] [class*="status"]',
    '[class*="availability"]',
    // WooCommerce
    '.stock.in-stock',
    '.stock.out-of-stock',
    '[class*="stock-status"]',
    // Generic
    '[class*="in-stock"]',
    '[class*="out-of-stock"]',
    '[class*="limited-stock"]',
    '[data-stock-status]',
  ]

  for (const selector of stockSelectors) {
    const text = $(selector).first().text().trim()
    if (text && text.length > 0 && text.length < 100) {
      // 过滤掉明显不是库存信息的内容
      if (!/^(select|choose|pick|click)$/i.test(text)) {
        return text
      }
    }
  }

  // 从data属性提取
  const dataStock = $('[data-stock-status]').attr('data-stock-status')
  if (dataStock) return dataStock

  return null
}

/**
 * 🔥 2025-12-24新增：提取配送信息
 * 包括：免邮、运费、预计送达时间、配送限制等
 */
function extractShippingInfo($: ReturnType<typeof import('cheerio').load>): string | null {
  const shippingSelectors = [
    // 配送信息容器
    '[class*="shipping"]',
    '[class*="delivery"]',
    '[class*="fulfillment"]',
    // 特定平台
    '[class*="ShippingOptions"]',
    '[class*="DeliveryInfo"]',
    // 通用标签
    '[data-shipping]',
    '[data-delivery]',
  ]

  for (const selector of shippingSelectors) {
    const text = $(selector).first().text().trim()
    if (text && text.length > 0 && text.length < 300) {
      // 过滤掉不是配送信息的内容
      if (!/^(choose|select|click|loading)$/i.test(text)) {
        // 清理多余空白
        return text.replace(/\s+/g, ' ').substring(0, 200)
      }
    }
  }

  // 尝试从图标或标签提取信息
  const freeShipping = $('[class*="free"], [class*="shipping"]').filter((i, el) => {
    const text = $(el).text().toLowerCase()
    return text.includes('free') && text.includes('ship')
  }).first().text().trim()

  if (freeShipping && freeShipping.length < 100) {
    return freeShipping
  }

  return null
}

/**
 * 🔥 2025-12-24新增：提取产品徽章/标签
 * 如：Best Seller, Limited Offer, Flash Sale, Featured等
 */
function extractProductBadge($: ReturnType<typeof import('cheerio').load>, platform: string | null): string | null {
  const badgeSelectors = [
    // Badge/Label容器
    '[class*="badge"]',
    '[class*="label"]',
    '[class*="tag"]',
    '[class*="ribbon"]',
    '[class*="promotion"]',
    '[class*="offer"]',
    // Shopify特定
    '[class*="product-badge"]',
    '[class*="BestSeller"]',
    '[data-badge]',
    // WooCommerce
    '.product-label',
    '[class*="hot-label"]',
  ]

  // 按优先级检查
  const priorityBadges = ['best', 'hot', 'limited', 'flash', 'new', 'sale', 'exclusive', 'featured']

  for (const selector of badgeSelectors) {
    const elements = $(selector)

    // 首先尝试找高优先级的徽章
    for (const badge of priorityBadges) {
      const found = elements.filter((i, el) => {
        const text = $(el).text().toLowerCase()
        return text.includes(badge) && text.length < 50
      }).first().text().trim()

      if (found && found.length > 0 && found.length < 50) {
        return found
      }
    }

    // 如果没找到高优先级徽章，返回找到的第一个
    const badge = elements.first().text().trim()
    if (badge && badge.length > 0 && badge.length < 50 && !/^(select|choose|click|loading)$/i.test(badge)) {
      return badge
    }
  }

  return null
}
