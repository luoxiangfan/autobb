/**
 * Offer抓取核心逻辑
 * 统一的抓取和AI分析流程，包含所有增强模块
 *
 * 被以下模块调用：
 * - offer-scraping.ts (异步后台抓取)
 * - route.ts (手动触发抓取)
 */

import { findOfferById, updateOfferScrapeStatus, updateOffer } from './offers'
import { scrapeUrl } from './scraper'
import { analyzeProductPage, ProductInfo } from './ai'
import { getProxyUrlForCountry, isProxyEnabled } from './settings'
import { SeoData } from './redis'
import { getDatabase } from './db'
import { getLanguageCodeForCountry } from './language-country-codes'
import { isCompetitorCompressionEnabled, isCompetitorCacheEnabled, FEATURE_FLAGS, logFeatureFlag } from './feature-flags'
import { normalizeBrandName } from './offer-utils'
import { scrapeSupplementalProducts, type SupplementalProductResult } from './offer-supplemental-products'

/**
 * 🔥 根据目标国家获取对应的Amazon域名
 * @param targetCountry - 国家代码（如 'US', 'DE', 'UK'）
 * @returns Amazon域名（如 'www.amazon.com', 'www.amazon.de'）
 */
function getAmazonDomain(targetCountry?: string): string {
  if (!targetCountry) return 'www.amazon.com'

  const domainMap: Record<string, string> = {
    'US': 'www.amazon.com',
    'DE': 'www.amazon.de',
    'UK': 'www.amazon.co.uk',
    'GB': 'www.amazon.co.uk',
    'FR': 'www.amazon.fr',
    'IT': 'www.amazon.it',
    'ES': 'www.amazon.es',
    'JP': 'www.amazon.co.jp',
    'CA': 'www.amazon.ca',
    'AU': 'www.amazon.com.au',
    'NL': 'www.amazon.nl',
    'SE': 'www.amazon.se',
    'PL': 'www.amazon.pl',
    'BE': 'www.amazon.com.be',
    'MX': 'www.amazon.com.mx',
    'BR': 'www.amazon.com.br',
    'IN': 'www.amazon.in',
    'SG': 'www.amazon.sg',
  }

  return domainMap[targetCountry.toUpperCase()] || 'www.amazon.com'
}

async function saveScrapedProducts(
  offerId: number,
  userId: number,
  products: any[],
  source: 'amazon_store' | 'independent_store' | 'amazon_product'
): Promise<void> {
  const db = await getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  // 软删除该Offer之前的产品数据（更新场景）- 添加用户隔离
  // 🔧 修改历史：
  // - 2025-12-29: 改为软删除，保留产品数据变化趋势
  await db.exec(`
    UPDATE scraped_products
    SET is_deleted = ${db.type === 'sqlite' ? '1' : 'TRUE'},
        deleted_at = ${db.type === 'sqlite' ? "datetime('now')" : 'NOW()'}
    WHERE offer_id = ? AND user_id = ?
  `, [offerId, userId])

  // 批量插入新的产品数据
  for (const product of products) {
    await db.exec(`
      INSERT INTO scraped_products (
        user_id, offer_id, name, asin, price, rating, review_count, image_url,
        promotion, badge, is_prime,
        hot_score, rank, is_hot, hot_label,
        product_url, scrape_source,
        sales_volume, discount, delivery_info,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ${nowFunc}, ${nowFunc}
      )
    `, [
      userId,
      offerId,
      product.name,
      product.asin || null,
      product.price || null,
      product.rating || null,
      product.reviewCount || null,
      product.imageUrl || null,
      // Phase 3 fields
      product.promotion || null,
      product.badge || null,
      product.isPrime ? 1 : 0,
      // Phase 2 fields
      product.hotScore || null,
      product.rank || null,
      product.isHot ? 1 : 0,
      product.hotLabel || null,
      // 🔥 产品URL字段（独立站和Amazon保持一致）
      product.productUrl || null,
      source,
      // 🔥 2025-12-10新增：销售热度相关字段
      product.salesVolume || null,
      product.discount || null,
      product.deliveryInfo || null
    ])
  }

  console.log(`📊 Phase 3持久化: 已保存${products.length}个产品到数据库 (user_id=${userId})`)
}

/**
 * 🔥 Phase 4: 保存深度抓取结果并执行AI分析
 *
 * 功能：
 * 1. 对每个成功抓取的商品执行评论分析
 * 2. 将深度数据（productData, reviews, competitors）保存到数据库
 * 3. 更新 has_deep_data 标记
 *
 * @param offerId - Offer ID
 * @param userId - 用户ID
 * @param deepResults - 深度抓取结果
 * @param targetCountry - 目标国家
 */
async function saveDeepScrapeResults(
  offerId: number,
  userId: number,
  deepResults: NonNullable<import('@/lib/stealth-scraper').AmazonStoreData['deepScrapeResults']>,
  targetCountry: string
): Promise<void> {
  const db = await getDatabase()
  const { getPlaywrightPool } = await import('@/lib/playwright-pool')
  const pool = getPlaywrightPool()

  for (const product of deepResults.topProducts) {
    if (product.scrapeStatus !== 'success' || !product.productData) {
      console.log(`⏭️ 跳过失败的商品: ${product.asin} (${product.scrapeStatus})`)
      continue
    }

    console.log(`🔬 处理商品深度数据: ${product.asin}`)

    // 1. AI产品分析（复用单品逻辑）
    let productInfo: ProductInfo | null = null
    try {
      const { analyzeProductPage } = await import('@/lib/ai')

      // 构建与单品一致的输入
      const pageData = {
        title: product.productData.productName || '',
        description: product.productData.productDescription || '',
        text: `
          === 产品信息 ===
          产品名称: ${product.productData.productName}
          品牌: ${product.productData.brandName}
          类目: ${product.productData.category}

          === 产品特点 ===
          ${product.productData.features?.join('\n') || ''}

          === About this item ===
          ${product.productData.aboutThisItem?.join('\n') || ''}
        `.trim()
      }

      // 🔧 修复(2025-12-24): 使用正确的Amazon域名，避免404错误
      const amazonDomain = getAmazonDomain(targetCountry)
      productInfo = await analyzeProductPage({
        url: `https://${amazonDomain}/dp/${product.asin}`,
        brand: product.productData.brandName || 'Unknown',
        title: pageData.title,
        description: pageData.description,
        text: pageData.text,
        targetCountry,
        pageType: 'product',
        technicalDetails: product.productData.technicalDetails || {},
        reviewHighlights: product.productData.reviewHighlights || []
      }, userId)

      console.log(`  ✅ AI产品分析完成`)
    } catch (aiError: any) {
      console.error(`  ⚠️ AI产品分析失败: ${aiError.message}`)
    }

    // 2. 评论分析（复用单品逻辑）
    let reviewAnalysis = null
    if (product.reviews && product.reviews.length > 0) {
      try {
        console.log(`  📝 开始评论分析: ${product.reviews.length}条评论`)
        const { analyzeReviewsWithAI } = await import('@/lib/review-analyzer')

        // 将评论字符串数组转换为评论对象数组（模拟结构）
        const reviewObjects = product.reviews.map((text, index) => ({
          author: `User ${index + 1}`,
          rating: null,
          date: null,
          title: null,
          body: text,
          helpful: null,
          verified: false
        }))

        reviewAnalysis = await analyzeReviewsWithAI(
          reviewObjects,
          product.productData.brandName || 'Unknown',
          targetCountry,
          userId,
          { enableCache: true, cacheKey: product.asin || 'unknown' }
        )
        console.log(`  ✅ 评论分析完成`)
      } catch (reviewError: any) {
        console.error(`  ⚠️ 评论分析失败: ${reviewError.message}`)
      }
    } else {
      console.log(`  ⏭️ 无评论数据，跳过评论分析`)
    }

    // 3. 竞品分析（新增，复用单品逻辑）
    let competitorAnalysis = null
    try {
      const { scrapeAmazonCompetitors, analyzeCompetitorsWithAI } = await import('@/lib/competitor-analyzer')

      // 🔥 复用Playwright连接池
      const { context, instanceId } = await pool.acquire(undefined, undefined, targetCountry)
      const page = await context.newPage()

      try {
        // 🔧 修复(2025-12-24): 使用正确的Amazon域名，避免404错误
        const amazonDomain = getAmazonDomain(targetCountry)
        const productUrl = `https://${amazonDomain}/dp/${product.asin}`
        await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })

        // 抓取竞品（5个，与单品一致）
        const competitors = await scrapeAmazonCompetitors(page, 5)

        if (competitors.length > 0) {
          console.log(`  🏆 抓取${competitors.length}个竞品，AI分析中...`)

          // 构建 ourProduct 对象
          const ourProduct = {
            name: product.productData.productName || 'Unknown',
            brand: product.productData.brandName || null,
            price: product.productData.productPrice ? parseFloat(product.productData.productPrice.replace(/[^0-9.]/g, '')) : null,
            rating: product.productData.rating ? parseFloat(product.productData.rating) : null,
            reviewCount: product.productData.reviewCount ? parseInt(product.productData.reviewCount.replace(/,/g, ''), 10) : null,
            features: product.productData.features || [],
            sellingPoints: productInfo?.uniqueSellingPoints || ''
          }

          competitorAnalysis = await analyzeCompetitorsWithAI(
            ourProduct,
            competitors,
            targetCountry,
            userId,
            {
              enableCompression: true,
              enableCache: true,
              cacheKey: `competitor_${product.asin}_${targetCountry}`
            }
          )
          console.log(`  ✅ 竞品分析完成`)
        }
      } finally {
        await page.close()
        pool.release(instanceId)  // 🔥 释放回连接池，供后续复用
      }
    } catch (competitorError: any) {
      console.error(`  ⚠️ 竞品分析失败: ${competitorError.message}`)
    }

    // 4. 保存到数据库（包含所有分析结果）
    try {
      await db.exec(`
        UPDATE scraped_products
        SET
          deep_scrape_data = ?,
          review_analysis = ?,
          competitor_analysis = ?,
          product_info = ?,
          has_deep_data = 1,
          updated_at = datetime('now')
        WHERE offer_id = ? AND user_id = ? AND asin = ?
      `, [
        JSON.stringify({
          productData: product.productData,
          scrapeStatus: product.scrapeStatus,
          scrapedAt: new Date().toISOString(),
          reviewsCount: product.reviews?.length || 0
        }),
        reviewAnalysis ? JSON.stringify(reviewAnalysis) : null,
        competitorAnalysis ? JSON.stringify(competitorAnalysis) : null,
        productInfo ? JSON.stringify(productInfo) : null,  // 🆕 新增字段
        offerId,
        userId,
        product.asin
      ])

      console.log(`  ✅ 深度数据已保存: ${product.asin}`)
    } catch (dbError: any) {
      console.error(`  ❌ 数据库更新失败: ${dbError.message}`)
    }
  }

  console.log(`📊 Phase 4深度持久化: 已处理${deepResults.topProducts.filter(p => p.scrapeStatus === 'success').length}个商品`)
}

/**
 * 从HTML中提取SEO信息
 */
async function extractSeoData(html: string): Promise<SeoData> {
  if (!html) {
    return {
      metaTitle: '',
      metaDescription: '',
      metaKeywords: '',
      ogTitle: '',
      ogDescription: '',
      ogImage: '',
      canonicalUrl: '',
      h1: [],
      imageAlts: [],
    }
  }

  const { load } = await import('cheerio')
  const $ = load(html)

  // 提取所有h1标签文本
  const h1: string[] = []
  $('h1').each((_, el) => {
    const text = $(el).text().trim()
    if (text && text.length > 0) {
      h1.push(text)
    }
  })

  // 提取图片alt文本（限制数量避免数据过大）
  const imageAlts: string[] = []
  $('img[alt]').each((_, el) => {
    const alt = $(el).attr('alt')?.trim()
    if (alt && alt.length > 3 && imageAlts.length < 20) {
      imageAlts.push(alt)
    }
  })

  return {
    metaTitle: $('title').text().trim(),
    metaDescription: $('meta[name="description"]').attr('content') || '',
    metaKeywords: $('meta[name="keywords"]').attr('content') || '',
    ogTitle: $('meta[property="og:title"]').attr('content') || '',
    ogDescription: $('meta[property="og:description"]').attr('content') || '',
    ogImage: $('meta[property="og:image"]').attr('content') || '',
    canonicalUrl: $('link[rel="canonical"]').attr('href') || '',
    h1,
    imageAlts,
  }
}

// 使用全局统一的国家到语言代码映射
// 通过 getLanguageCodeForCountry() 函数获取，支持69个国家

/**
 * POST /api/offers/:id/scrape
 * 触发产品信息抓取和AI分析
 */
/**
 * 检测URL是否为推广链接（需要解析重定向）
 */
function isAffiliateUrl(url: string): boolean {
  const affiliateDomains = [
    'pboost.me',
    'yeahpromos.com',  // 🔥 添加YeahPromos推广平台
    'bonusarrive.com', // 🔥 BonusArrive推广平台（部分Offer需要解析重定向以获得Final URL/Suffix）
    'fatcoupon.com',   // BonusArrive常见中间页
    'mftrking.com',    // BonusArrive/联盟常见跟踪域名
    'bit.ly',
    'geni.us',
    'amzn.to',
    'go.redirectingat.com',
    'click.linksynergy.com',
    'shareasale.com',
    'dpbolvw.net',
    'jdoqocy.com',
    'tkqlhce.com',
    'anrdoezrs.net',
    'kqzyfj.com',
  ]

  try {
    const domain = new URL(url).hostname.toLowerCase()
    return affiliateDomains.some(affiliate => domain.includes(affiliate))
  } catch {
    return false
  }
}

/**
 * 核心抓取和AI分析函数
 * 统一的抓取流程，包含所有增强模块和scraped_products持久化
 *
 * @param offerId - Offer ID
 * @param userId - User ID
 * @param url - 要抓取的URL
 * @param brand - 品牌名称
 */
export async function performScrapeAndAnalysis(
  offerId: number,
  userId: number,
  url: string,
  brand: string
): Promise<void> {
  // 🎯 P0优化: 保存原始爬虫数据（用于后续广告创意生成）
  let rawScrapedData: any = null

  try {
    // 获取代理配置
    const offer = await findOfferById(offerId, userId)
    const targetCountry = offer?.target_country || 'US'
    const useProxy = await isProxyEnabled(userId)
    const proxyUrl = useProxy ? await getProxyUrlForCountry(targetCountry, userId) : undefined
    const pageTypeOverride: 'store' | 'product' | undefined =
      offer?.page_type === 'store' || offer?.page_type === 'product' ? offer.page_type : undefined
    const normalizedStoreProductLinks = (() => {
      if (!offer?.store_product_links) return []
      try {
        const parsed = JSON.parse(offer.store_product_links)
        if (!Array.isArray(parsed)) return []
        const cleaned = parsed
          .map((link) => (typeof link === 'string' ? link.trim() : ''))
          .filter((link) => Boolean(link))
        return Array.from(new Set(cleaned)).slice(0, 3)
      } catch {
        return []
      }
    })()

    // 自动检测并解析推广链接
    let actualUrl = url
    let resolvedFinalUrlSuffix: string | null = null  // 保存解析器返回的suffix
    const urlToResolve = offer?.affiliate_link || url  // 优先使用affiliate_link，否则检查url

    if (isAffiliateUrl(urlToResolve)) {
      console.log(`🔗 检测到推广链接，开始解析: ${urlToResolve}`)
      try {
        const { resolveAffiliateLinkWithPlaywright } = await import('@/lib/url-resolver-playwright')
        const resolved = await resolveAffiliateLinkWithPlaywright(
          urlToResolve,
          proxyUrl,
          5000,
          targetCountry,
          userId  // 🔥 用户级别代理IP缓存隔离
        )
        actualUrl = resolved.finalUrl
        resolvedFinalUrlSuffix = resolved.finalUrlSuffix  // 🔥 保存解析器返回的suffix
        console.log(`✅ 解析完成 - Final URL: ${actualUrl}`)
        console.log(`   Final URL Suffix: ${resolvedFinalUrlSuffix ? resolvedFinalUrlSuffix.substring(0, 100) + '...' : '(无)'}`)
        console.log(`   重定向次数: ${resolved.redirectCount}`)
        console.log(`   重定向链: ${resolved.redirectChain.join(' → ')}`)
      } catch (resolveError: any) {
        console.warn(`⚠️ 推广链接解析失败，尝试使用原始URL: ${resolveError.message}`)
        actualUrl = urlToResolve
      }
    } else {
      console.log(`📍 直接使用提供的URL（非推广链接）: ${actualUrl}`)
    }

    // ========== URL分割：提取Final URL和Final URL Suffix ==========
    // 用于Google Ads配置：Final URL配置在Ad层级，Final URL Suffix配置在Campaign层级
    // 🔧 修复：保存完整URL用于后续抓取，避免丢失推广参数
    let urlForScraping = actualUrl  // 保存完整URL用于抓取
    try {
      const urlObj = new URL(actualUrl)
      const finalUrl = `${urlObj.origin}${urlObj.pathname}` // 基础URL（不含查询参数）
      const extractedSuffixFromUrl = urlObj.search.substring(1)
      // 🔥 优先使用解析器返回的suffix，否则尝试从当前URL提取
      const finalUrlSuffix = resolvedFinalUrlSuffix !== null ? resolvedFinalUrlSuffix : extractedSuffixFromUrl

      // 仅当确定拿到了suffix（含空字符串的“已解析无参数”）时才写入，避免覆盖已有数据
      const existingSuffix = offer?.final_url_suffix ?? null
      const resolvedEmptyButUnknownBefore =
        resolvedFinalUrlSuffix !== null &&
        resolvedFinalUrlSuffix.length === 0 &&
        (existingSuffix === null || existingSuffix.length === 0)
      const shouldUpdateSuffix =
        (resolvedFinalUrlSuffix !== null && resolvedFinalUrlSuffix.length > 0) ||
        extractedSuffixFromUrl.length > 0 ||
        resolvedEmptyButUnknownBefore

      if (shouldUpdateSuffix) {
        console.log(`📋 提取Final URL: ${finalUrl}`)
        console.log(`📋 提取Final URL Suffix (${finalUrlSuffix.length}字符): ${finalUrlSuffix.substring(0, 100)}${finalUrlSuffix.length > 100 ? '...' : ''}`)

        // 更新Offer中的final_url和final_url_suffix字段
        if (offer) {
          await updateOffer(offerId, offer.user_id, {
            final_url: finalUrl,
            final_url_suffix: finalUrlSuffix,
            url: finalUrl  // 同时更新url为清理后的基础URL
          })
        }

        console.log(`✅ 已更新Offer ${offerId}的Final URL和Final URL Suffix`)
      } else {
        console.log(`ℹ️ URL不含查询参数，仅更新Final URL`)
        if (offer) {
          await updateOffer(offerId, offer.user_id, {
            final_url: finalUrl,
            url: finalUrl
          })
        }
      }
    } catch (urlError: any) {
      console.warn(`⚠️ URL解析失败: ${urlError.message}`)
    }

    console.log(`开始抓取Offer ${offerId}:`, urlForScraping)  // 🔧 使用完整URL进行抓取

    // 获取语言代码（使用全局统一映射）
    const language = getLanguageCodeForCountry(targetCountry)
    console.log(`目标国家: ${targetCountry}, 语言: ${language}`)

    // 提前检测URL的预期页面类型（用于缓存验证）
    const urlPath = new URL(urlForScraping).pathname
    const expectedIsStorePage = urlForScraping.includes('/stores/') ||
                                urlForScraping.includes('/store/') ||
                                urlForScraping.includes('/collections') ||
                                (urlForScraping.includes('.myshopify.com') && !urlForScraping.match(/\/products\/[^/]+$/)) ||
                                urlPath === '/' || urlPath === ''
    const detectedPageType: 'product' | 'store' = expectedIsStorePage ? 'store' : 'product'
    let expectedPageType: 'product' | 'store' = pageTypeOverride || detectedPageType
    const scrapeWarnings: string[] = []
    const pageTypeAdjusted = Boolean(pageTypeOverride && pageTypeOverride !== detectedPageType)

    if (pageTypeOverride && pageTypeOverride !== detectedPageType) {
      expectedPageType = detectedPageType
      scrapeWarnings.push(`系统识别为${detectedPageType === 'store' ? '店铺' : '单品'}页面，已自动切换为${detectedPageType === 'store' ? '店铺' : '单品'}模式`)
    }

    console.log(`🎯 预期页面类型: ${expectedPageType}${pageTypeOverride ? ' (用户选择)' : ''}`)

    // ⚠️ 缓存已禁用：根据需求，取消所有网页数据缓存，避免数据污染
    // 所有抓取任务统一使用Playwright，确保数据新鲜度
    console.log(`🚫 缓存已禁用，强制使用Playwright抓取最新数据`)
    let pageData: any

    // 检测网站类型 - 🔧 修复：使用完整URL进行类型检测
    const isAmazon = urlForScraping.includes('amazon.com') || urlForScraping.includes('amazon.')
    const isStorePage = urlForScraping.includes('/stores/') || urlForScraping.includes('/store/')

    // 检测是否为独立站店铺页面（首页或产品集合页）
    // 复用之前的urlObj和urlPath
    const isShopifyDomain = urlForScraping.includes('.myshopify.com') || urlForScraping.includes('shopify')
    const isIndependentStore = !isAmazon && (
      // 首页（根路径）
      urlPath === '/' || urlPath === '' ||
      // Shopify集合页
      urlPath.includes('/collections') ||
      // 产品列表页（但不是单个产品页）
      (urlPath.includes('/products') && !urlPath.match(/\/products\/[^/]+$/)) ||
      // Shopify域名
      isShopifyDomain
    )

    const needsJavaScript = isAmazon || isShopifyDomain || isIndependentStore

    const shouldScrapeSupplementalProducts = normalizedStoreProductLinks.length > 0
    let supplementalProductsCache: SupplementalProductResult[] | null = null

    const getSupplementalProducts = async () => {
      if (!shouldScrapeSupplementalProducts) return []
      if (supplementalProductsCache) return supplementalProductsCache
      supplementalProductsCache = await scrapeSupplementalProducts(normalizedStoreProductLinks, {
        targetCountry,
        userId,
        proxyUrl,
        maxLinks: 3,
        concurrency: 2,
      })
      return supplementalProductsCache
    }

    // 1. 抓取网页内容
    if (needsJavaScript) {
      console.log('🎭 使用Playwright Stealth模式抓取...')

      try {
          if (isAmazon && isStorePage) {
              // Amazon Store页面专用抓取 - 🔧 修复：使用完整URL
              // 🔥 新增：使用深度抓取模式（进入热销商品详情页获取评价和竞品数据）
              console.log('📦 检测到Amazon Store页面，使用深度抓取模式...')
              const { scrapeAmazonStoreDeep } = await import('@/lib/stealth-scraper')
              const storeData = await scrapeAmazonStoreDeep(
                urlForScraping,
                5,  // 抓取前5个热销商品的详情页
                proxyUrl,
                targetCountry
              )

              // 🔥 优化：构建突出热销商品的文本信息供AI分析（国际化版本）
              // 🌍 国际化文本配置
              const i18nTexts: Record<string, {
                rating: string
                reviews: string
                hotScore: string
                price: string
                promotion: string
                brandStore: string
                brand: string
                storeDesc: string
                topProducts: string
                scoringCriteria: string
                legend: string
                hotInsights: string
              }> = {
                en: {
                  rating: 'Rating',
                  reviews: 'reviews',
                  hotScore: 'Hot Score',
                  price: 'Price',
                  promotion: 'Promotion',
                  brandStore: 'Brand Store',
                  brand: 'Brand',
                  storeDesc: 'Store Description',
                  topProducts: 'Hot-Selling Products Ranking (Top',
                  scoringCriteria: 'Scoring: Rating × log(Review Count + 1)',
                  legend: 'Legend: 🔥 = TOP 5 Hot-Selling | ✅ = Best-Selling',
                  hotInsights: 'Hot Insights: Top'
                },
                zh: {
                  rating: '评分',
                  reviews: '条',
                  hotScore: '热销指数',
                  price: '价格',
                  promotion: '促销',
                  brandStore: '品牌店铺',
                  brand: '品牌',
                  storeDesc: '店铺描述',
                  topProducts: '热销商品排行榜 (Top',
                  scoringCriteria: '筛选标准: 评分 × log(评论数 + 1)',
                  legend: '说明: 🔥 = 前5名热销商品 | ✅ = 畅销商品',
                  hotInsights: '热销洞察: 本店铺前'
                },
                de: {
                  rating: 'Bewertung',
                  reviews: 'Bewertungen',
                  hotScore: 'Beliebtheitsindex',
                  price: 'Preis',
                  promotion: 'Aktion',
                  brandStore: 'Marken-Shop',
                  brand: 'Marke',
                  storeDesc: 'Shop-Beschreibung',
                  topProducts: 'Bestseller-Ranking (Top',
                  scoringCriteria: 'Bewertung: Bewertung × log(Anzahl Bewertungen + 1)',
                  legend: 'Legende: 🔥 = TOP 5 Bestseller | ✅ = Bestseller',
                  hotInsights: 'Bestseller-Einblicke: Top'
                },
                fr: {
                  rating: 'Note',
                  reviews: 'avis',
                  hotScore: 'Score de popularité',
                  price: 'Prix',
                  promotion: 'Promotion',
                  brandStore: 'Boutique de marque',
                  brand: 'Marque',
                  storeDesc: 'Description de la boutique',
                  topProducts: 'Classement des meilleures ventes (Top',
                  scoringCriteria: 'Notation: Note × log(Nombre d\'avis + 1)',
                  legend: 'Légende: 🔥 = TOP 5 Meilleures ventes | ✅ = Meilleures ventes',
                  hotInsights: 'Informations sur les meilleures ventes: Top'
                },
                es: {
                  rating: 'Calificación',
                  reviews: 'reseñas',
                  hotScore: 'Índice de popularidad',
                  price: 'Precio',
                  promotion: 'Promoción',
                  brandStore: 'Tienda de marca',
                  brand: 'Marca',
                  storeDesc: 'Descripción de la tienda',
                  topProducts: 'Ranking de productos más vendidos (Top',
                  scoringCriteria: 'Puntuación: Calificación × log(Número de reseñas + 1)',
                  legend: 'Leyenda: 🔥 = TOP 5 Más vendidos | ✅ = Más vendidos',
                  hotInsights: 'Información de más vendidos: Top'
                },
                ja: {
                  rating: '評価',
                  reviews: 'レビュー',
                  hotScore: '人気スコア',
                  price: '価格',
                  promotion: 'プロモーション',
                  brandStore: 'ブランドストア',
                  brand: 'ブランド',
                  storeDesc: 'ストア説明',
                  topProducts: '人気商品ランキング (Top',
                  scoringCriteria: 'スコアリング: 評価 × log(レビュー数 + 1)',
                  legend: '凡例: 🔥 = TOP 5 人気商品 | ✅ = 人気商品',
                  hotInsights: '人気インサイト: Top'
                },
                ko: {
                  rating: '평점',
                  reviews: '리뷰',
                  hotScore: '인기 점수',
                  price: '가격',
                  promotion: '프로모션',
                  brandStore: '브랜드 스토어',
                  brand: '브랜드',
                  storeDesc: '스토어 설명',
                  topProducts: '인기 상품 순위 (Top',
                  scoringCriteria: '평가: 평점 × log(리뷰 수 + 1)',
                  legend: '범례: 🔥 = TOP 5 인기 상품 | ✅ = 인기 상품',
                  hotInsights: '인기 인사이트: Top'
                }
              }

              const t = i18nTexts[language] || i18nTexts.en

              const productSummaries = storeData.products.map(p => {
                const parts = [
                  `${p.rank}. ${p.hotLabel} - ${p.name}`,
                  `${t.rating}: ${p.rating || 'N/A'}⭐`,
                  `${p.reviewCount || 'N/A'} ${t.reviews}`,
                ]
                if (p.hotScore) parts.push(`${t.hotScore}: ${p.hotScore.toFixed(1)}`)
                if (p.price) parts.push(`${t.price}: ${p.price}`)
                // 🎯 Phase 3: 添加促销、徽章、Prime信息
                if (p.promotion) parts.push(`💰 ${t.promotion}: ${p.promotion}`)
                if (p.badge) parts.push(`🏆 ${p.badge}`)
                if (p.isPrime) parts.push(`✓ Prime`)
                return parts.join(' | ')
              }).join('\n')

              const hotInsightsText = storeData.hotInsights
                ? language === 'zh'
                  ? `\n💡 ${t.hotInsights}${storeData.hotInsights.topProductsCount}名热销商品平均评分${storeData.hotInsights.avgRating.toFixed(1)}星，平均评论${storeData.hotInsights.avgReviews}条`
                  : `\n💡 ${t.hotInsights} ${storeData.hotInsights.topProductsCount} hot-selling products have average rating ${storeData.hotInsights.avgRating.toFixed(1)}★, average ${storeData.hotInsights.avgReviews} reviews`
                : ''

              const textContent = [
                `=== ${storeData.storeName} ${t.brandStore} ===`,
                `${t.brand}: ${storeData.brandName}`,
                `${t.storeDesc}: ${storeData.storeDescription || 'N/A'}`,
                '',
                `=== ${t.topProducts} ${storeData.totalProducts}) ===`,
                `${t.scoringCriteria}`,
                `${t.legend}`,
                '',
                productSummaries,
                hotInsightsText,
              ].join('\n')

              pageData = {
                title: storeData.storeName || brand,
                description: storeData.storeDescription || '',
                text: textContent,
                html: '',
              }

              console.log(`✅ Amazon Store抓取完成: ${storeData.storeName}, ${storeData.totalProducts}个产品`)

              // 🎯 P0优化: 保存原始爬虫数据（Store页面）
              const supplementalProducts = await getSupplementalProducts()
              if (supplementalProducts.length > 0) {
                storeData.supplementalProducts = supplementalProducts
              }
              rawScrapedData = storeData

              // 🎯 Phase 3持久化：保存产品数据到数据库
              try {
                await saveScrapedProducts(offerId, userId, storeData.products, 'amazon_store')
                console.log(`✅ 产品数据已保存到数据库: ${storeData.products.length}个产品`)
              } catch (saveError: any) {
                console.error('⚠️ 保存产品数据失败（不影响主流程）:', saveError.message)
              }

              // 🔥 Phase 4深度持久化：处理深度抓取结果（热销商品详情页数据）
              if (storeData.deepScrapeResults && storeData.deepScrapeResults.successCount > 0) {
                try {
                  console.log(`🚀 开始处理深度抓取结果: ${storeData.deepScrapeResults.successCount}/${storeData.deepScrapeResults.totalScraped} 成功`)
                  await saveDeepScrapeResults(offerId, userId, storeData.deepScrapeResults, targetCountry)
                  console.log(`✅ 深度抓取数据已保存并分析完成`)
                } catch (deepSaveError: any) {
                  console.error('⚠️ 保存深度抓取数据失败（不影响主流程）:', deepSaveError.message)
                }
              } else if (storeData.deepScrapeResults) {
                console.log(`⚠️ 深度抓取未成功获取任何商品数据 (${storeData.deepScrapeResults.failedCount}个失败)`)
              }
            } else if (isAmazon) {
              // Amazon产品页面专用抓取 - 增强版 - 🔧 修复：使用完整URL
              const { scrapeAmazonProduct } = await import('@/lib/stealth-scraper')
              const productData = await scrapeAmazonProduct(urlForScraping, proxyUrl, targetCountry)  // 🌍 传入目标国家

              // 🎯 P0优化: 保存原始爬虫数据
              rawScrapedData = productData
              console.log(`🔍 抓取数据已保存到rawScrapedData，包含${Object.keys(productData).length}个字段`)
              console.log(`   - productName: ${productData.productName || 'N/A'}`)
              console.log(`   - asin: ${productData.asin || 'N/A'}`)
              console.log(`   - productPrice: ${productData.productPrice || 'N/A'}`)
              console.log(`   - rating: ${productData.rating || 'N/A'}`)
              console.log(`   - features: ${productData.features?.length || 0}个`)
              console.log(`   - technicalDetails: ${Object.keys(productData.technicalDetails || {}).length}个`)

              // 构建全面的文本信息供AI创意生成
              const textParts = [
                `=== 产品信息 ===`,
                `产品名称: ${productData.productName}`,
                `品牌: ${productData.brandName}`,
                `ASIN: ${productData.asin}`,
                `类目: ${productData.category}`,
                '',
                `=== 价格信息 ===`,
                `当前价格: ${productData.productPrice}`,
                productData.originalPrice ? `原价: ${productData.originalPrice}` : '',
                productData.discount ? `折扣: ${productData.discount}` : '',
                productData.primeEligible ? '✓ Prime会员可享' : '',
                productData.availability || '',
                '',
                `=== 销量与评价 ===`,
                `评分: ${productData.rating || 'N/A'}⭐`,
                `评论数: ${productData.reviewCount || 'N/A'}`,
                `销量排名: ${productData.salesRank || 'N/A'}`,
                '',
                `=== 产品特点 ===`,
                productData.features.join('\n'),
                '',
              ]

              // 添加评论摘要
              if (productData.reviewHighlights.length > 0) {
                textParts.push(`=== 用户评价摘要 ===`)
                textParts.push(productData.reviewHighlights.join('\n'))
                textParts.push('')
              }

              // 添加热门评论
              if (productData.topReviews.length > 0) {
                textParts.push(`=== 热门评论 ===`)
                textParts.push(productData.topReviews.join('\n\n'))
                textParts.push('')
              }

              // 添加技术规格
              if (Object.keys(productData.technicalDetails).length > 0) {
                textParts.push(`=== 技术规格 ===`)
                for (const [key, value] of Object.entries(productData.technicalDetails)) {
                  textParts.push(`${key}: ${value}`)
                }
              }

              pageData = {
                title: productData.productName || '',
                description: productData.productDescription || '',
                text: textParts.filter(Boolean).join('\n'),
                html: '',
              }

              console.log(`✅ Amazon产品抓取完成: ${productData.productName}`)
            } else if (isIndependentStore) {
              // 独立站店铺页面抓取 - 🔥 修改（2025-12-08）：使用深度抓取版本，与Amazon Store保持一致
              console.log('🏪 检测到独立站店铺页面，使用深度抓取模式（包含热销商品详情）...')
              const { scrapeIndependentStoreDeep } = await import('@/lib/stealth-scraper')
              const storeData = await scrapeIndependentStoreDeep(
                urlForScraping,
                5,  // 抓取前5个热销商品的详情页
                proxyUrl,
                targetCountry,
                3   // 并发数
              )

              // 构建丰富的文本信息供AI分析
              const productSummaries = storeData.products.slice(0, 20).map((p, i) => {
                const parts = [`${i + 1}. ${p.name}`]
                if (p.price) parts.push(`价格: ${p.price}`)
                if (p.rating) parts.push(`评分: ${p.rating}⭐`)
                if (p.reviewCount) parts.push(`评论: ${p.reviewCount}条`)
                if (p.hotLabel) parts.push(p.hotLabel)
                return parts.join(' | ')
              }).join('\n')

              // 🔥 新增：热销洞察信息
              const hotInsightsSummary = storeData.hotInsights
                ? `\n\n=== 热销洞察 ===\n平均评分: ${storeData.hotInsights.avgRating.toFixed(1)}⭐\n平均评论数: ${storeData.hotInsights.avgReviews}条\n热销商品数: ${storeData.hotInsights.topProductsCount}`
                : ''

              const textContent = [
                `=== 独立站店铺: ${storeData.storeName} ===`,
                `品牌: ${storeData.storeName}`,
                `店铺描述: ${storeData.storeDescription || 'N/A'}`,
                `平台: ${storeData.platform || 'generic'}`,
                `产品数量: ${storeData.totalProducts}`,
                hotInsightsSummary,
                '',
                '=== 产品列表 ===',
                productSummaries,
              ].join('\n')

              pageData = {
                title: storeData.storeName || brand,
                description: storeData.storeDescription || '',
                text: textContent,
                html: '',
              }

              console.log(`✅ 独立站店铺深度抓取完成: ${storeData.storeName}, ${storeData.totalProducts}个产品, 深度抓取: ${storeData.deepScrapeResults?.successCount || 0}/${storeData.deepScrapeResults?.totalScraped || 0}`)

              // 🎯 P0优化: 保存原始爬虫数据（Independent Store页面）
              const supplementalProducts = await getSupplementalProducts()
              if (supplementalProducts.length > 0) {
                storeData.supplementalProducts = supplementalProducts
              }
              rawScrapedData = storeData

              // 🎯 Phase 3持久化：保存产品数据到数据库
              try {
                await saveScrapedProducts(offerId, userId, storeData.products, 'independent_store')
                console.log(`✅ 产品数据已保存到数据库: ${storeData.products.length}个产品`)
              } catch (saveError: any) {
                console.error('⚠️ 保存产品数据失败（不影响主流程）:', saveError.message)
              }
            } else {
              // 通用JavaScript渲染抓取 - 🔧 修复：使用完整URL
              const { scrapeUrlWithBrowser } = await import('@/lib/stealth-scraper')
              const result = await scrapeUrlWithBrowser(urlForScraping, proxyUrl, {
                waitForTimeout: 30000,
                targetCountry,  // 🌍 传入目标国家
              })

              pageData = {
                title: result.title,
                description: '',
                text: result.html.substring(0, 10000),
                html: result.html,
              }

              console.log(`✅ 页面抓取完成: ${result.title}`)
            }
          } catch (playwrightError: any) {
            // 🔧 修复：不降级到HTTP，直接抛出异常让外层retry机制处理
            console.error(`❌ Playwright抓取失败: ${playwrightError.message}`)
            throw playwrightError
          }
        } else {
          // 普通HTTP抓取 - 🔧 修复：使用完整URL
          console.log('📡 使用HTTP方式抓取...')
          pageData = await scrapeUrl(urlForScraping, proxyUrl, language)
        }

      console.log(`抓取完成，页面标题:`, pageData.title)

      // 提取SEO数据
      const seoData = await extractSeoData(pageData.html || '')
      console.log(`📊 SEO数据提取完成:`, {
        metaTitle: seoData.metaTitle ? `${seoData.metaTitle.length}字符` : '无',
        metaDesc: seoData.metaDescription ? `${seoData.metaDescription.length}字符` : '无',
        h1Count: seoData.h1.length,
        altCount: seoData.imageAlts.length,
      })

      // ⚠️ 缓存写入已禁用：根据需求，取消所有网页数据缓存
      // await setCachedPageData(urlForScraping, language, {
      //   title: pageData.title || '',
      //   description: pageData.description || '',
      //   text: pageData.text || '',
      //   seo: seoData,
      //   pageType: expectedPageType,
      // })
      console.log(`🚫 缓存写入已禁用`)

    // 2. 使用AI分析产品信息（容错机制：失败时使用默认值）
    let productInfo: ProductInfo
    let aiAnalysisSuccess = true

    // 使用之前检测的页面类型（已在缓存验证阶段完成）
    const pageType = expectedPageType
    console.log(`🔍 页面类型: ${pageType} (${pageType === 'store' ? '店铺页面' : '单品页面'})`)

    try {
      // 🎯 P1优化：从rawScrapedData提取technicalDetails和reviewHighlights供AI使用
      const technicalDetails = rawScrapedData?.technicalDetails || {}
      const reviewHighlights = rawScrapedData?.reviewHighlights || []

      console.log(`📊 传递给AI分析: ${Object.keys(technicalDetails).length}个技术规格, ${reviewHighlights.length}条评论摘要`)

      productInfo = await analyzeProductPage({
        url: urlForScraping,  // 🔧 修复：使用完整URL
        brand,
        title: pageData.title,
        description: pageData.description,
        text: pageData.text,
        targetCountry,
        pageType,  // 传递页面类型
        // 🎯 P1优化：传递技术规格和评论摘要
        technicalDetails,
        reviewHighlights,
      }, userId)  // 传递 userId 以使用用户级别的 AI 配置（优先 Vertex AI）
      console.log(`✅ AI分析完成:`, productInfo)
    } catch (aiError: any) {
      // AI分析失败时，使用默认值并记录警告（不中断抓取流程）
      aiAnalysisSuccess = false
      console.warn(`⚠️ AI分析失败（将使用默认值）:`, aiError.message)

      productInfo = {
        brandDescription: `${brand} - 品牌描述待补充（AI分析失败）`,
        uniqueSellingPoints: `产品卖点待补充（AI分析失败）`,
        productHighlights: `产品亮点待补充（AI分析失败）`,
        targetAudience: `目标受众待补充（AI分析失败）`,
        category: '未分类',
      }
    }

    // 3. 更新数据库 - 将数组/对象转为JSON字符串存储
    const formatFieldForDB = (field: unknown): string => {
      if (typeof field === 'string') return field
      if (Array.isArray(field)) return JSON.stringify(field)
      if (field && typeof field === 'object') return JSON.stringify(field)
      return ''
    }

    // ⚠️ 品牌名提取优先级：原始爬虫数据 > AI分析
    // 1. 优先使用原始爬虫数据中的品牌名（scraper-stealth.ts已经过多策略提取）
    let extractedBrand = brand // 默认使用传入的品牌名

    // 🎯 品牌提取失败检查：如果原始爬虫数据中品牌为null，表示所有提取策略均失败，立即终止
    if (rawScrapedData && rawScrapedData.brandName === null) {
      const brandError = '所有品牌提取策略均失败。品牌词对于关键词生成和广告质量至关重要，无法继续创建广告。'
      console.error(`❌ ${brandError}`)
      await updateOfferScrapeStatus(offerId, userId, 'failed', brandError)
      throw new Error(brandError)
    }

    const scrapedBrandFromData =
      (rawScrapedData && typeof rawScrapedData.brandName === 'string' && rawScrapedData.brandName) ||
      (pageType === 'store' && rawScrapedData && typeof rawScrapedData.storeName === 'string' && rawScrapedData.storeName) ||
      null

    if (scrapedBrandFromData && scrapedBrandFromData !== 'Unknown' && scrapedBrandFromData.trim() !== '') {
      extractedBrand = scrapedBrandFromData
      console.log(`✅ 使用原始爬虫数据的品牌名: ${extractedBrand}`)
    } else if (productInfo.brandDescription) {
      // 2. 降级方案：从AI的brandDescription中提取品牌名
      // 支持多语言模式：英语(positions/is/offers) + 德语(positioniert/ist/bietet) + 法语/西班牙语/意大利语
      const match = productInfo.brandDescription.match(
        /^([A-Z][A-Za-z0-9\s&üöäÜÖÄß-]+?)\s+(positions|is|offers|provides|delivers|focuses|positioniert|ist|bietet|liefert|konzentriert|se\s+positionne|est|offre|se\s+posiciona|es|ofrece|posiziona)/i
      )
      if (match && match[1]) {
        extractedBrand = match[1].trim()
        console.log(`✅ 从AI分析中提取品牌名: ${extractedBrand}`)
      } else {
        console.log(`⚠️ 无法从brandDescription提取品牌名，使用原始值: ${brand}`)
      }
    }

	    // 🎯 品牌名清理和标准化（去除冠词、型号、格式化）
	    if (extractedBrand && extractedBrand.length > 0) {
	      // 1. 去除开头的冠词 (英语: The/A/An, 德语: Der/Die/Das, 法语: Le/La/Les, 西班牙语: El/La/Los/Las)
	      extractedBrand = extractedBrand.replace(/^(The|A|An|Der|Die|Das|Le|La|Les|El|Los|Las)\s+/i, '')

      // 2. 提取品牌核心名称（第一个有效单词，去除产品型号）
      // 产品型号特征：包含连续大写字母+数字+连字符的组合，如 "RLK16-1200D8-A"
      const words = extractedBrand.split(/\s+/)
      const brandCore = words.find(word => {
        // 有效品牌名：2-20字符，主要是字母（含欧洲特殊字符），可以包含&
        const isValidBrandWord = /^[A-Z][A-Za-z&üöäÜÖÄßéèêëàâáíìîïóòôõúùûñç]{1,19}$/i.test(word)
        // 排除产品型号：包含连续的字母+数字+连字符的复杂组合
        const isProductModel = /[A-Z0-9]{2,}[-][A-Z0-9]{2,}/i.test(word)
        return isValidBrandWord && !isProductModel
      })

	      if (brandCore) {
	        extractedBrand = brandCore
	        console.log(`🔧 品牌名清理: 提取核心名称 "${extractedBrand}"`)
	      }

	      // 3. 标准化格式：使用全局统一normalizeBrandName（保留常见缩写 / 特殊品牌写法）
	      extractedBrand = normalizeBrandName(extractedBrand)
	      console.log(`✨ 品牌名标准化: "${extractedBrand}"`)
	    }

    // 🎯 新增: 品牌名智能提取fallback - 当品牌名为"提取中..."或无效时
    const isInvalidBrand = !extractedBrand ||
                          extractedBrand === '提取中...' ||
                          extractedBrand === 'Extracting...' ||
                          extractedBrand.trim().length < 2

    if (isInvalidBrand && aiAnalysisSuccess && pageData.title) {
      console.log('🔍 尝试使用AI专门提取品牌名...')
      try {
        // 使用AI从产品标题和描述中提取品牌名
        const { extractBrandFromContent } = await import('@/lib/ai')
        const aiBrand = await extractBrandFromContent({
          title: pageData.title,
          description: pageData.description || '',
          text: pageData.text?.substring(0, 2000) || '', // 限制长度以节省token
          url: urlForScraping,
        }, userId)

        if (aiBrand && aiBrand.length >= 2 && aiBrand.length <= 30) {
          extractedBrand = aiBrand
          console.log(`✅ AI品牌提取成功: "${extractedBrand}"`)
        } else {
          console.warn(`⚠️ AI品牌提取结果无效: "${aiBrand}"`)
        }
      } catch (brandExtractionError: any) {
        console.warn(`⚠️ AI品牌提取失败: ${brandExtractionError.message}`)
      }
    }

    // 最终验证：如果还是无效品牌名，从URL中尝试提取
    if (!extractedBrand || extractedBrand === '提取中...' || extractedBrand.trim().length < 2) {
      console.log('🔍 尝试从URL提取品牌名...')

      // Amazon Store URL: /stores/BrandName/...
      let urlBrand = urlForScraping.match(/amazon\.com\/stores\/([^\/]+)/)?.[1]

      // Amazon产品URL: /dp/ASIN 无法直接提取品牌，但可以尝试从标题
      if (!urlBrand && pageData.title) {
        // 从标题开头提取（Amazon产品标题通常以品牌名开头）
        const titleBrand = pageData.title.split(/[\s-,|]/)[0]?.trim()
        if (titleBrand && titleBrand.length >= 2 && titleBrand.length <= 30) {
          const isValidBrand = /^[A-Z][A-Za-z0-9&\s-]+$/.test(titleBrand) ||
                              /^[A-Z0-9]+$/.test(titleBrand)
          if (isValidBrand) {
            urlBrand = titleBrand
          }
        }
      }

      if (urlBrand) {
        extractedBrand = decodeURIComponent(urlBrand)
          .replace(/-/g, ' ')
          .replace(/\+/g, ' ')
          .replace(/\s+(Store|Shop|Official)$/i, '')
          .trim()
        console.log(`✅ 从URL/标题提取品牌: "${extractedBrand}"`)
      } else {
        // 最后的备选方案：使用ASIN作为标识符（如果是Amazon产品页）
        if (urlForScraping.includes('amazon.com/dp/')) {
          const asin = urlForScraping.match(/\/dp\/([A-Z0-9]{10})/)?.[1]
          if (asin) {
            extractedBrand = `Product_${asin.substring(0, 6)}`
            console.log(`⚠️ 使用ASIN生成临时品牌标识: "${extractedBrand}"`)
          }
        }
      }
    }

    console.log(`📦 最终品牌名: "${extractedBrand}"`)


    // 🎯🚀 P0优化v2: 并行执行评论分析和竞品分析（复用连接池，性能提升60-80%）
    let reviewAnalysis = null
    let competitorAnalysis = null

    // 初始化连接池（在条件块外，供所有分支使用）
    const { getPlaywrightPool } = await import('@/lib/playwright-pool')
    const pool = getPlaywrightPool()

    if (pageType === 'product' && urlForScraping.includes('amazon') && aiAnalysisSuccess) {
      try {
        console.log('🚀 并行执行评论+竞品分析（复用Playwright连接池）...')

        // 并行执行：评论抓取+分析 & 竞品抓取+分析（复用连接池）
        const [reviewResult, competitorResult] = await Promise.allSettled([
          // 评论分析流程（复用连接池）
          (async () => {
            console.log('📝 开始评论抓取+分析（连接池）...')
            const { scrapeAmazonReviews, analyzeReviewsWithAI } = await import('@/lib/review-analyzer')

            // 🔥 复用连接池，而非新建浏览器（节省30-40秒）
            const { context, instanceId } = await pool.acquire(undefined, undefined, targetCountry)
            const page = await context.newPage()

            try {
              await page.goto(urlForScraping, { waitUntil: 'domcontentloaded', timeout: 30000 })
              // 🎯 优化: 30条评论（原50条）
              const reviews = await scrapeAmazonReviews(page, 30)

              if (reviews.length > 0) {
                console.log(`✅ 抓取${reviews.length}条评论，AI分析中...`)
                const analysis = await analyzeReviewsWithAI(
                  reviews,
                  extractedBrand || brand,
                  targetCountry,
                  userId,
                  { enableCache: true, cacheKey: urlForScraping }
                )
                console.log('✅ 评论分析完成')
                return analysis
              } else {
                console.log('⚠️ 无评论数据')
                return null
              }
            } finally {
              await page.close()
              pool.release(instanceId)  // 🔥 释放回连接池，供后续复用
            }
          })(),

          // 竞品分析流程（复用连接池）
          (async () => {
            console.log('🏆 开始竞品抓取+分析（连接池）...')
            const { scrapeAmazonCompetitors, analyzeCompetitorsWithAI } = await import('@/lib/competitor-analyzer')

            // 🔥 复用连接池，而非新建浏览器（节省30-40秒）
            const { context, instanceId } = await pool.acquire(undefined, undefined, targetCountry)
            const page = await context.newPage()

            try {
              await page.goto(urlForScraping, { waitUntil: 'domcontentloaded', timeout: 30000 })
              // 🎯 优化: 5个竞品（原10个）
              const competitors = await scrapeAmazonCompetitors(page, 5)

              if (competitors.length > 0) {
                console.log(`✅ 抓取${competitors.length}个竞品，AI分析中...`)

                // 🔧 修复: 从 rawScrapedData 获取价格和评分（不再使用已删除的 productInfo.pricing/reviews）
                const priceStr = rawScrapedData?.productPrice
                let priceNum: number | null = null
                if (priceStr) {
                  // 导入价格解析工具（使用智能解析函数）
                  const { parsePrice } = await import('@/lib/pricing-utils')
                  priceNum = parsePrice(priceStr)
                }

                const ourProduct = {
                  name: extractedBrand || brand,
                  price: priceNum,
                  rating: rawScrapedData?.rating ? parseFloat(rawScrapedData.rating) : null,
                  reviewCount: rawScrapedData?.reviewCount ? parseInt(rawScrapedData.reviewCount, 10) : null,
                  features: productInfo.productHighlights
                    ? (Array.isArray(productInfo.productHighlights)
                        ? productInfo.productHighlights
                        : productInfo.productHighlights.split('\n')).filter((f: string) => f.trim())
                    : []
                }

                const enableCompression = isCompetitorCompressionEnabled(userId, FEATURE_FLAGS.competitorCompression.rolloutPercentage)
                const enableCache = isCompetitorCacheEnabled(userId, FEATURE_FLAGS.competitorCache.rolloutPercentage)
                logFeatureFlag('competitorCompression', userId, enableCompression)
                logFeatureFlag('competitorCache', userId, enableCache)

                const analysis = await analyzeCompetitorsWithAI(
                  ourProduct,
                  competitors,
                  targetCountry,
                  userId,
                  { enableCompression, enableCache }
                )
                console.log('✅ 竞品分析完成')
                return analysis
              } else {
                console.log('⚠️ 无竞品数据')
                return null
              }
            } finally {
              await page.close()
              pool.release(instanceId)  // 🔥 释放回连接池，供后续复用
            }
          })()
        ])

        // 处理并行结果
        if (reviewResult.status === 'fulfilled' && reviewResult.value) {
          reviewAnalysis = reviewResult.value
          console.log(`📊 评论分析结果: 正面${reviewAnalysis.sentimentDistribution.positive}% 中性${reviewAnalysis.sentimentDistribution.neutral}% 负面${reviewAnalysis.sentimentDistribution.negative}%`)
        } else if (reviewResult.status === 'rejected') {
          console.warn('⚠️ 评论分析失败（不影响主流程）:', reviewResult.reason?.message)
        }

        if (competitorResult.status === 'fulfilled' && competitorResult.value) {
          competitorAnalysis = competitorResult.value
          console.log(`📊 竞品分析结果: ${competitorAnalysis.totalCompetitors}个竞品，竞争力${competitorAnalysis.overallCompetitiveness}/100`)
        } else if (competitorResult.status === 'rejected') {
          console.warn('⚠️ 竞品分析失败（不影响主流程）:', competitorResult.reason?.message)
        }

        console.log('🎉 并行分析完成（连接池复用，比原方案节省60-80秒）')

      } catch (parallelError: any) {
        console.warn('⚠️ 并行分析失败（不影响主流程）:', parallelError.message)
      }
    } else if (pageType === 'store') {
      console.log('📦 店铺页面：跳过评论分析，执行竞品分析...')

      // 🔥 修复: Store页面也应该执行竞品分析
      try {
        const { scrapeAmazonCompetitors, analyzeCompetitorsWithAI } = await import('@/lib/competitor-analyzer')

        // 🔥 复用连接池，而非新建浏览器（节省30-40秒）
        const { context, instanceId } = await pool.acquire(undefined, undefined, targetCountry)
        const page = await context.newPage()

        try {
          await page.goto(urlForScraping, { waitUntil: 'domcontentloaded', timeout: 30000 })
          // 🎯 优化: 5个竞品（原10个）
          const competitors = await scrapeAmazonCompetitors(page, 5)

          if (competitors.length > 0) {
            console.log(`✅ Store页面抓取${competitors.length}个竞品，AI分析中...`)

            // 🔥 使用品牌信息作为"我们的产品"
            // Store页面无统一价格/评分，使用品牌名称作为产品标识
            const ourProduct = {
              name: extractedBrand || brand || 'Store Products',
              price: null,  // Store页面无统一价格
              rating: null,
              reviewCount: null,
              features: []  // Store页面无统一特性列表
            }

            const enableCompression = isCompetitorCompressionEnabled(userId, FEATURE_FLAGS.competitorCompression.rolloutPercentage)
            const enableCache = isCompetitorCacheEnabled(userId, FEATURE_FLAGS.competitorCache.rolloutPercentage)
            logFeatureFlag('competitorCompression', userId, enableCompression)
            logFeatureFlag('competitorCache', userId, enableCache)

            const analysis = await analyzeCompetitorsWithAI(
              ourProduct,
              competitors,
              targetCountry,
              userId,
              { enableCompression, enableCache }
            )

            if (analysis) {
              competitorAnalysis = analysis
              console.log(`✅ Store页面竞品分析完成: ${competitorAnalysis.totalCompetitors}个竞品，竞争力${competitorAnalysis.overallCompetitiveness}/100`)
            }
          } else {
            console.log('⚠️ Store页面未找到竞品数据')
          }
        } finally {
          await page.close()
          pool.release(instanceId)  // 🔥 释放回连接池，供后续复用
        }
      } catch (storeCompetitorError: any) {
        console.warn('⚠️ Store页面竞品分析失败（不影响主流程）:', storeCompetitorError.message)
      }
    } else if (!urlForScraping.includes('amazon')) {
      console.log('ℹ️ 非Amazon页面暂不支持评论+竞品分析')
    }

    // ❌ P1优化已下线: 视觉元素智能分析（性价比不高）
    // 用户反馈："使用统一AI入口分析5张图片"，下线图片分析功能，性价比不高
    /*
    let visualAnalysis = null
    if (pageType === 'product' && aiAnalysisSuccess) {
      try {
        console.log('📸 开始P1视觉元素智能分析...')
        const { analyzeProductVisuals } = await import('@/lib/visual-analyzer')

        // 创建临时Playwright会话进行视觉分析
        const { chromium } = await import('playwright')
        const browser = await chromium.launch({ headless: true })
        const context = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
        })

        const visualPage = await context.newPage()

        try {
          // 导航到产品页面
          await visualPage.goto(urlForScraping, { waitUntil: 'domcontentloaded', timeout: 30000 })

          // 执行视觉分析
          visualAnalysis = await analyzeProductVisuals(
            visualPage,
            extractedBrand || brand,
            targetCountry,
            userId
          )

          if (visualAnalysis) {
            console.log('✅ P1视觉元素智能分析完成')
            console.log(`   - 图片总数: ${visualAnalysis.imageQuality.totalImages}`)
            console.log(`   - 高质量图片: ${visualAnalysis.imageQuality.highQualityImages}`)
            console.log(`   - 使用场景: ${visualAnalysis.identifiedScenarios.length}个`)
            console.log(`   - 视觉亮点: ${visualAnalysis.visualHighlights.length}个`)
          } else {
            console.log('⚠️ 未生成视觉分析结果')
          }
        } finally {
          await visualPage.close()
          await browser.close()
        }

      } catch (visualError: any) {
        console.warn('⚠️ P1视觉元素智能分析失败（不影响主流程）:', visualError.message)
        // 视觉分析失败不影响主流程，继续执行
      }
    } else if (pageType === 'store') {
      console.log('ℹ️ 店铺页面跳过视觉元素分析')
    }
    */

    // 如果AI分析失败，在scrape_error中记录警告信息
    const scrapeError = aiAnalysisSuccess
      ? undefined
      : '⚠️ 网页抓取成功，但AI产品分析失败。建议检查Gemini API配置和代理设置。'

    // 🎯 需求34: 提取广告投放元素（关键字、标题、描述）
    let extractedKeywords: any[] = []
    let extractedHeadlines: string[] = []
    let extractedDescriptions: string[] = []
    let extractionMetadata: any = {}
    let extractedAt: string | undefined

    try {
      console.log('🎯 开始提取广告投放元素（关键字、标题、描述）...')
      const { extractAdElements } = await import('@/lib/ad-elements-extractor')

      // 根据页面类型准备不同的输入数据
      if (pageType === 'product') {
        // 单商品场景：从AI分析结果中提取
        // productHighlights = "About this item" 产品详细描述
        // uniqueSellingPoints = 其他特性
        const aboutItems: string[] = productInfo.productHighlights
          ? (Array.isArray(productInfo.productHighlights)
              ? productInfo.productHighlights
              : productInfo.productHighlights.split('\n')).filter((f: string) => f.trim())
          : []

        const featureItems: string[] = productInfo.uniqueSellingPoints
          ? (Array.isArray(productInfo.uniqueSellingPoints)
              ? productInfo.uniqueSellingPoints
              : productInfo.uniqueSellingPoints.split('\n')).filter((f: string) => f.trim())
          : []

        const extractionResult = await extractAdElements(
          {
            pageType: 'product',
            product: {
              productName: pageData.title || extractedBrand,
              productDescription: productInfo.brandDescription || null,
              productPrice: pageData.price || null,
              originalPrice: null,
              discount: null,
              brandName: extractedBrand,
              features: featureItems,
              aboutThisItem: aboutItems,  // Amazon "About this item" 产品详细描述
              imageUrls: pageData.imageUrls || [],
              rating: rawScrapedData?.rating || null,
              reviewCount: rawScrapedData?.reviewCount || null,
              salesRank: null,
              badge: null,  // 🎯 P3优化: 非Amazon直接抓取场景无badge
              availability: null,
              primeEligible: false,
              reviewHighlights: [],
              topReviews: [],
              technicalDetails: {},
              asin: null,
              category: productInfo.category || null,
              relatedAsins: []  // 🔥 非Amazon直接抓取场景无竞品ASIN
            }
          },
          extractedBrand,
          targetCountry,
          language,
          userId
        )

        extractedKeywords = extractionResult.keywords
        extractedHeadlines = extractionResult.headlines
        extractedDescriptions = extractionResult.descriptions
        extractionMetadata = extractionResult.sources
        extractedAt = new Date().toISOString()

        console.log(`✅ 单商品提取完成: ${extractedKeywords.length}个关键词, ${extractedHeadlines.length}个标题`)

        // 🔥 统一数据存储：单品页面也保存到scraped_products表
        // 确保单品和店铺页面的数据结构一致
        if (rawScrapedData) {
          console.log('📦 保存单品数据到scraped_products表...')

          // 计算热销分数（与店铺页面保持一致）
          const rating = parseFloat(rawScrapedData.rating || '0')
          const reviewCount = parseInt(rawScrapedData.reviewCount || '0', 10)
          const hotScore = rating > 0 && reviewCount > 0
            ? rating * Math.log10(reviewCount + 1)
            : 0

          const productData = [{
            name: rawScrapedData.productName || pageData.title || extractedBrand,
            asin: rawScrapedData.asin || null,
            price: rawScrapedData.productPrice || pageData.price || null,
            rating: rawScrapedData.rating || null,
            reviewCount: rawScrapedData.reviewCount || null,
            imageUrl: (rawScrapedData.imageUrls && rawScrapedData.imageUrls[0]) || null,
            promotion: rawScrapedData.discount || null,
            badge: rawScrapedData.badge || null,
            isPrime: rawScrapedData.primeEligible || false,
            hotScore: hotScore,
            rank: 1,  // 单品默认排名第1
            isHot: true,  // 单品默认标记为热销
            hotLabel: '🔥 主推商品'
          }]

          await saveScrapedProducts(offerId, userId, productData, 'amazon_product')
          console.log('✅ 单品数据已保存到scraped_products表')
        }
      } else if (pageType === 'store') {
        // 🔥 店铺场景：从数据库读取已保存的产品数据（包含深度数据）
        const db = await getDatabase()
        const isDeletedCheck = db.type === 'sqlite' ? 'is_deleted = 0' : 'is_deleted = FALSE'
        const products = await db.query(`
          SELECT
            name, asin, price, rating, review_count, image_url, hot_score,
            deep_scrape_data, review_analysis, competitor_analysis, product_info, has_deep_data
          FROM scraped_products
          WHERE offer_id = ? AND user_id = ? AND ${isDeletedCheck}
          ORDER BY hot_score DESC
          LIMIT 5
        `, [offerId, userId]) as Array<{
          name: string
          asin: string | null
          price: string | null
          rating: string | null
          review_count: string | null
          image_url: string | null
          hot_score: number | null
          deep_scrape_data: string | null
          review_analysis: string | null
          competitor_analysis: string | null
          product_info: string | null
          has_deep_data: number
        }>

        if (products.length > 0) {
          // 解析JSON字段，构建包含深度数据的产品对象
          const enrichedProducts = products.map(p => {
            const deepData = p.deep_scrape_data ? JSON.parse(p.deep_scrape_data) : null
            const reviewAnalysis = p.review_analysis ? JSON.parse(p.review_analysis) : null
            const competitorAnalysis = p.competitor_analysis ? JSON.parse(p.competitor_analysis) : null
            const productInfo = p.product_info ? JSON.parse(p.product_info) : null

            return {
              name: p.name,
              asin: p.asin,
              price: p.price,
              rating: p.rating,
              reviewCount: p.review_count,
              imageUrl: p.image_url,
              hotScore: p.hot_score || undefined,
              hasDeepData: p.has_deep_data === 1,
              // 🔥 深度数据字段
              productData: deepData?.productData || null,
              reviewAnalysis: reviewAnalysis,
              competitorAnalysis: competitorAnalysis,
              productInfo: productInfo  // 🆕 新增AI产品分析结果
            }
          })

          const supplementalProducts = Array.isArray(rawScrapedData?.supplementalProducts)
            ? rawScrapedData.supplementalProducts
            : []
          const supplementalEnriched = supplementalProducts
            .map((p: any) => ({
              name: typeof p?.productName === 'string' ? p.productName.trim() : '',
              price: p?.productPrice || null,
              rating: p?.rating || null,
              reviewCount: p?.reviewCount || null,
              imageUrl: Array.isArray(p?.imageUrls) ? p.imageUrls[0] : null,
              hasDeepData: false,
              productData: null,
              reviewAnalysis: null,
              competitorAnalysis: null,
              productInfo: null,
            }))
            .filter((p: any) => p.name)

          const mergedProducts = (() => {
            if (supplementalEnriched.length === 0) return enrichedProducts
            const seen = new Set(enrichedProducts.map(p => (p.name || '').toLowerCase()))
            const combined = [...enrichedProducts]
            for (const item of supplementalEnriched) {
              const key = (item.name || '').toLowerCase()
              if (!key || seen.has(key)) continue
              seen.add(key)
              combined.push(item)
            }
            return combined.slice(0, 8)
          })()

          console.log(`🔍 店铺产品数据: ${enrichedProducts.length}个, 其中${enrichedProducts.filter(p => p.hasDeepData).length}个包含深度数据`)

          const extractionResult = await extractAdElements(
            {
              pageType: 'store',
              storeProducts: mergedProducts,
              hasDeepData: mergedProducts.some(p => p.hasDeepData)  // 🔥 标记是否有深度数据
            },
            extractedBrand,
            targetCountry,
            language,
            userId
          )

          extractedKeywords = extractionResult.keywords
          extractedHeadlines = extractionResult.headlines
          extractedDescriptions = extractionResult.descriptions
          extractionMetadata = extractionResult.sources
          extractedAt = new Date().toISOString()

          console.log(`✅ 店铺提取完成: ${extractedKeywords.length}个关键词, ${extractedHeadlines.length}个标题`)
        } else {
          console.warn('⚠️ 店铺页面未找到产品数据，跳过广告元素提取')
        }
      }
    } catch (extractError: any) {
      console.warn('⚠️ 广告元素提取失败（不影响主流程）:', extractError.message)
      // 提取失败不影响主流程，继续执行
    }

    // ⚠️ 品牌验证：如果品牌提取失败，标记为失败状态，避免生成无效广告
    if (extractedBrand === 'Unknown' || !extractedBrand || extractedBrand.trim() === '') {
      const brandError = '品牌名称提取失败。品牌词对于关键词生成和广告质量至关重要，无法继续创建广告。'
      console.error(`❌ ${brandError}`)
      updateOfferScrapeStatus(offerId, userId, 'failed', brandError)
      throw new Error(brandError)
    }

    if (rawScrapedData && typeof rawScrapedData === 'object') {
      rawScrapedData.pageTypeDetected = detectedPageType
      if (pageTypeOverride) rawScrapedData.pageTypeOverride = pageTypeOverride
      if (pageTypeAdjusted) rawScrapedData.pageTypeAdjusted = true
      if (scrapeWarnings.length > 0) rawScrapedData.extractionWarnings = scrapeWarnings
      if (supplementalProductsCache) {
        const supplementalProducts: SupplementalProductResult[] = supplementalProductsCache ?? []
        rawScrapedData.supplementalSummary = {
          requested: normalizedStoreProductLinks.length,
          succeeded: supplementalProducts.filter((item: SupplementalProductResult) => !item.error).length,
          failed: supplementalProducts.filter((item: SupplementalProductResult) => item.error).length,
        }
      }
    }

    updateOfferScrapeStatus(offerId, userId, 'completed', scrapeError, {
      brand: extractedBrand,        // 更新品牌名
      url: urlForScraping,               // 更新为解析后的真实URL
      brand_description: formatFieldForDB(productInfo.brandDescription),
      unique_selling_points: formatFieldForDB(productInfo.uniqueSellingPoints),
      product_highlights: formatFieldForDB(productInfo.productHighlights),
      target_audience: formatFieldForDB(productInfo.targetAudience),
      category: productInfo.category || '',
      // 增强数据字段
      // ❌ 已删除冗余字段（2025-12-04）: pricing, reviews, competitive_edges
      promotions: formatFieldForDB(productInfo.promotions),
      // 🎯 P0优化: 用户评论深度分析结果
      review_analysis: reviewAnalysis ? formatFieldForDB(reviewAnalysis) : undefined,
      // 🎯 P0优化: 竞品对比分析结果
      competitor_analysis: competitorAnalysis ? formatFieldForDB(competitorAnalysis) : undefined,
      // ❌ P1优化已下线: 视觉元素智能分析（性价比不高）
      // visual_analysis: visualAnalysis ? formatFieldForDB(visualAnalysis) : undefined,
      // 🎯 需求34: 广告元素提取结果
      extracted_keywords: extractedKeywords.length > 0 ? formatFieldForDB(extractedKeywords) : undefined,
      extracted_headlines: extractedHeadlines.length > 0 ? formatFieldForDB(extractedHeadlines) : undefined,
      extracted_descriptions: extractedDescriptions.length > 0 ? formatFieldForDB(extractedDescriptions) : undefined,
      extraction_metadata: Object.keys(extractionMetadata).length > 0 ? formatFieldForDB(extractionMetadata) : undefined,
      extracted_at: extractedAt,
      // 🎯 P0优化: 原始爬虫数据（包含discount, salesRank, badge, primeEligible等字段）
      scraped_data: rawScrapedData ? formatFieldForDB(rawScrapedData) : undefined,
      // 🆕 Phase 2: 产品分类元数据（Store Metadata Enhancement）
      product_categories: (rawScrapedData && rawScrapedData.productCategories)
        ? formatFieldForDB(rawScrapedData.productCategories)
        : undefined,
      // 🔥 2025-12-24: v3.2 AI分析结果（包含pageType、关键词策略等）
      page_type: pageType,
      ai_analysis_v32: formatFieldForDB({
        pageType: pageType,
        brandName: extractedBrand,
        brandDescription: productInfo.brandDescription,
        uniqueSellingPoints: Array.isArray(productInfo.uniqueSellingPoints)
          ? productInfo.uniqueSellingPoints
          : (productInfo.uniqueSellingPoints || '').split('\n').filter((s: string) => s.trim()),
        productCategories: rawScrapedData?.productCategories?.primaryCategories?.map((c: any) => c.name) || [],
        productHighlights: Array.isArray(productInfo.productHighlights)
          ? productInfo.productHighlights
          : (productInfo.productHighlights || '').split('\n').filter((s: string) => s.trim()),
        targetAudience: productInfo.targetAudience,
        marketFit: productInfo.marketFit || { score: 50, factors: ['AI分析待优化'] },
        storeQualityLevel: pageType === 'store' ? (rawScrapedData?.hotInsights?.avgRating >= 4.5 ? 'high' : 'medium') : undefined,
        keywordStrategy: pageType === 'store' ? 'brand-focused' : 'product-focused',
        aiKeywords: productInfo.keywords || extractedKeywords.map((k: any) => k.keyword || k.text || k),
        aiReviews: productInfo.reviews?.rating?.toString() || rawScrapedData?.hotInsights?.avgRating?.toString(),
        aiCompetitiveEdges: competitorAnalysis?.competitorAdvantages || [],
        version: 'v3.2',
        generatedAt: new Date().toISOString()
      }),
      ai_keywords: formatFieldForDB(productInfo.keywords || extractedKeywords.map((k: any) => k.keyword || k.text || k)),
      ai_competitive_edges: formatFieldForDB(competitorAnalysis?.competitorAdvantages || []),
    })

    // 🔍 诊断日志：验证scraped_data存储
    if (rawScrapedData) {
      const dataKeys = Object.keys(rawScrapedData)
      console.log(`✅ scraped_data已保存，包含${dataKeys.length}个字段:`, dataKeys.slice(0, 10).join(', '))
      if (rawScrapedData.productName) console.log(`   产品名称: ${rawScrapedData.productName}`)
      if (rawScrapedData.productPrice) console.log(`   价格: ${rawScrapedData.productPrice}`)
      if (rawScrapedData.asin) console.log(`   ASIN: ${rawScrapedData.asin}`)
    } else {
      console.warn(`⚠️ rawScrapedData为空，未保存原始抓取数据`)
    }

    console.log(`Offer ${offerId} 抓取和分析完成`)
  } catch (error: any) {
    console.error(`Offer ${offerId} 抓取失败:`, error)
    throw error
  }
}
