/**
 * Amazon Store Scraping
 *
 * Amazon store page scraping with product listing extraction
 */

import { load, type CheerioAPI } from 'cheerio'
import { Page } from 'playwright'
import { normalizeBrandName } from '../offer-utils'
import { getPlaywrightPool } from '../playwright-pool'
import { smartWaitForLoad, recordWaitOptimization } from '../smart-wait-strategy'
import { isProxyConnectionError } from './proxy-utils'
import {
  createStealthBrowser,
  releaseBrowser,
  configureStealthPage,
  randomDelay,
  getDynamicTimeout
} from './browser-stealth'
import { scrapeAmazonProduct, scrapeAmazonProductWithContext } from './amazon-product'
import {
  getCachedProductDetail,
  setCachedProductDetail,
  getProductCacheStats,
  checkCacheBatch
} from './product-detail-cache'
import type { AmazonStoreData, AmazonProductData } from './types'

const PROXY_URL = process.env.PROXY_URL || ''

/**
 * 🔥 KISS优化：清理ASIN格式
 * Amazon JSON数据中ASIN可能包含deal后缀如 "B0DCFNZF32:amzn1.deal.xxx"
 * 只保留标准10位ASIN部分
 */
function cleanAsin(asin: string | null | undefined): string | null {
  if (!asin) return null
  // 移除冒号及其后的所有内容（deal后缀）
  const cleaned = asin.split(':')[0]
  // 验证是否为有效的10位ASIN格式
  if (/^[A-Z0-9]{10}$/.test(cleaned)) {
    return cleaned
  }
  return null
}

/**
 * 🔥 KISS优化：根据目标国家获取对应的Amazon域名
 * 默认返回 amazon.com (美国)
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
    'AE': 'www.amazon.ae',
    'SA': 'www.amazon.sa',
    'TR': 'www.amazon.com.tr',
  }

  return domainMap[targetCountry.toUpperCase()] || 'www.amazon.com'
}

/**
 * Scrape Amazon Store page with multiple products
 * Extracts store info and product listings for AI creative generation
 * P0优化: 使用连接池减少启动时间
 * P1优化: 代理失败时自动换新代理重试
 * 🌍 支持根据目标国家动态配置语言
 */
export async function scrapeAmazonStore(
  url: string,
  customProxyUrl?: string,
  targetCountry?: string,
  maxProxyRetries: number = 2
): Promise<AmazonStoreData> {
  console.log(`📦 抓取Amazon Store: ${url}${targetCountry ? ` (国家: ${targetCountry})` : ''}`)

  let lastError: Error | undefined
  const effectiveProxyUrl = customProxyUrl || PROXY_URL

  for (let proxyAttempt = 0; proxyAttempt <= maxProxyRetries; proxyAttempt++) {
    try {
      if (proxyAttempt > 0) {
        console.log(`🔄 Amazon Store抓取 - 代理重试 ${proxyAttempt}/${maxProxyRetries}，清理连接池并获取新代理...`)
        const pool = getPlaywrightPool()
        await pool.clearIdleInstances()
        const { clearProxyCache } = await import('../proxy/fetch-proxy-ip')
        clearProxyCache(effectiveProxyUrl)
        console.log(`🧹 已清理代理IP缓存: ${effectiveProxyUrl}`)
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

      const browserResult = await createStealthBrowser(effectiveProxyUrl, targetCountry)
      let page: Page | null = null

      try {
        page = await browserResult.context.newPage()
        await configureStealthPage(page, targetCountry)

        // Navigate and scrape
        const storeData = await scrapeStorePageContent(page, url, effectiveProxyUrl, targetCountry)

        return storeData

      } finally {
        // 🔥 2025-12-12 内存优化：确保Page在finally中关闭，防止内存泄漏
        if (page) {
          await page.close().catch((e) => {
            console.warn(`⚠️ Page关闭失败: ${e.message}`)
          })
        }
        await releaseBrowser(browserResult)
      }

    } catch (error: any) {
      lastError = error
      console.error(`❌ Amazon Store抓取尝试 ${proxyAttempt + 1}/${maxProxyRetries + 1} 失败: ${error.message?.substring(0, 100)}`)

      if (isProxyConnectionError(error)) {
        if (proxyAttempt < maxProxyRetries) {
          console.log(`🔄 检测到代理连接问题，准备换新代理重试...`)
          await new Promise(resolve => setTimeout(resolve, 2000))
          continue
        } else {
          console.error(`❌ 已用尽所有代理重试次数 (${maxProxyRetries + 1}次)`)
        }
      } else {
        console.error(`❌ 非代理错误，停止重试: ${error.message?.substring(0, 100)}`)
        throw error
      }
    }
  }

  throw lastError || new Error('Amazon Store抓取失败：已用尽所有代理重试')
}

/**
 * Main store page content scraping logic
 */
async function scrapeStorePageContent(
  page: Page,
  url: string,
  effectiveProxyUrl: string,
  targetCountry?: string
): Promise<AmazonStoreData> {
  // 🔥 策略A优化：监听网络请求，提取Amazon Store API数据
  const apiProducts: Array<{
    asin: string
    name: string
    price: string | null
    rating: string | null
    reviewCount: string | null
  }> = []

  let apiRequestCount = 0
  page.on('response', async (response) => {
    try {
      const responseUrl = response.url()
      const contentType = response.headers()['content-type'] || ''

      if (contentType.includes('application/json') && response.status() === 200) {
        apiRequestCount++

        if (!responseUrl.includes('uedata') &&
            !responseUrl.includes('csm.js') &&
            !responseUrl.includes('/events/') &&
            !responseUrl.includes('rum-http-intake') &&
            !responseUrl.includes('metrics')) {
          try {
            const json = await response.json()
            const jsonStr = JSON.stringify(json)

            if (jsonStr.includes('"asin"') ||
                jsonStr.includes('"ASIN"') ||
                jsonStr.includes('"product') ||
                jsonStr.includes('"item') ||
                jsonStr.includes('"dp/')) {
              console.log(`📡 发现可能的产品API: ${responseUrl.substring(0, 100)}`)
            }
          } catch (e) {
            // JSON解析失败，跳过
          }
        }
      }
    } catch (error) {
      // 忽略响应处理错误
    }
  })

  let finalUrlWithParams = url
  page.on('response', (response) => {
    const responseUrl = response.url()
    if (responseUrl.includes('amazon.com') && responseUrl.includes('?')) {
      finalUrlWithParams = responseUrl
    }
  })

  console.log(`🌐 访问URL: ${url}`)
  await randomDelay(500, 1500)

  // Navigate with retry
  const MAX_RETRIES = 3
  let response = null
  let navigateError = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      console.log(`🔄 尝试访问 (${attempt + 1}/${MAX_RETRIES})...`)

      response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: getDynamicTimeout(url),
      })

      if (!response) throw new Error('No response received')
      const httpStatus = response.status()
      console.log(`📊 HTTP状态: ${httpStatus}`)

      // 🔥 FIX: 429 (Too Many Requests) 应该触发重试，而不是继续解析
      if (httpStatus === 429) {
        console.warn(`⚠️ 检测到429限流，触发重试...`)
        throw new Error('HTTP 429: Amazon rate limit, need retry with different proxy')
      }

      const pageTitle = await page.title().catch(() => '')
      if (pageTitle.includes('Page Not Found') || httpStatus === 404) {
        console.warn(`⚠️ 检测到404页面，尝试使用完整参数URL`)

        if (finalUrlWithParams !== url && finalUrlWithParams.includes('?')) {
          console.log(`🔄 重新访问带完整参数的URL...`)
          response = await page.goto(finalUrlWithParams, {
            waitUntil: 'domcontentloaded',
            timeout: getDynamicTimeout(finalUrlWithParams),
          })

          // 🔥 FIX: 重新访问后也检查429
          const retryStatus = response?.status()
          if (retryStatus === 429) {
            console.warn(`⚠️ 重试后仍遇到429限流`)
            throw new Error('HTTP 429: Amazon rate limit on retry')
          }
        }
      }

      navigateError = null
      break
    } catch (error: any) {
      navigateError = error
      console.error(`❌ 访问失败 (尝试 ${attempt + 1}/${MAX_RETRIES}): ${error.message}`)

      if (attempt < MAX_RETRIES - 1) {
        const waitTime = 2000 * (attempt + 1)
        console.log(`⏳ 等待 ${waitTime}ms 后重试...`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
    }
  }

  if (navigateError) {
    throw new Error(`Amazon Store访问失败（${MAX_RETRIES}次重试后）: ${navigateError.message}`)
  }

  // Wait for content to load
  const waitResult = await smartWaitForLoad(page, url, { maxWaitTime: 15000 }).catch(() => ({
    waited: 15000,
    loadComplete: false,
    signals: []
  }))

  console.log(`⏱️ Store页面等待: ${waitResult.waited}ms, 信号: ${waitResult.signals.join(', ')}`)
  recordWaitOptimization(15000, waitResult.waited)

  // Scroll to trigger lazy loading
  console.log('⏳ 等待产品内容渲染（优化版）...')
  console.log('🔄 滚动页面触发懒加载...')

  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight))
    await randomDelay(800, 1200)
  }

  await page.evaluate(() => window.scrollTo(0, 0))
  await randomDelay(1000, 1500)

  console.log('🔄 二次滚动...')
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight))
    await randomDelay(800, 1200)
  }

  // Check for lazy-loaded product grid
  console.log('🔍 检测懒加载productgrid widget...')
  const hasLazyProductGrid = await page.evaluate(() => {
    const lazyWidgets = document.querySelectorAll('.stores-widget-btf[id*=""], div[class*="productgrid"]')
    return lazyWidgets.length > 0
  })

  if (hasLazyProductGrid) {
    console.log('✅ 发现懒加载widget，滚动到widget位置并等待加载...')

    await page.evaluate(() => {
      const widget = document.querySelector('.stores-widget-btf, div[class*="productgrid"]')
      if (widget) {
        widget.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return true
      }
      return false
    })

    await randomDelay(3000, 5000)

    // 🔥 产品网格选择器 - 支持桌面版和移动版
    const productSelectors = [
      // === 通用选择器 ===
      'div[data-asin]:not([data-asin=""])',
      'a[href*="/dp/"][class*="product"]',
      // === 桌面版选择器 ===
      'div[class*="ProductCard"]',
      'div[class*="product-card"]',
      '.stores-widget-btf',
      // === 移动版选择器 (a-m-* 页面) ===
      '.a-carousel-card',
      '[data-component-type="s-search-result"]',
      '.s-result-item',
    ]

    for (const selector of productSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 8000 })
        console.log(`✅ 产品DOM已渲染: ${selector}`)
        break
      } catch (e) {
        console.log(`⏳ 选择器 ${selector} 未找到，尝试下一个...`)
      }
    }

    await randomDelay(2000, 3000)
  }

  // Wait for product images
  console.log('⏳ 等待产品图片渲染...')
  await page.waitForSelector('img[src*="images-amazon"]', { timeout: 8000 }).catch(() => {
    console.warn('⚠️ 产品图片加载超时，继续处理')
  })

  console.log('⏳ 等待JavaScript完成...')
  await randomDelay(1500, 2500)

  await page.evaluate(() => window.scrollTo(0, 0))
  await randomDelay(300, 500)

  const finalUrl = page.url()
  console.log(`✅ 最终URL: ${finalUrl}`)

  const html = await page.content()

  // 🔥 2025-12-12 内存优化：仅在开发环境保存调试文件
  const isDevMode = process.env.NODE_ENV !== 'production' && process.env.SCRAPER_DEBUG === 'true'
  if (isDevMode) {
    // Save debug files
    try {
      const fs = await import('fs')
      const path = await import('path')
      const storageDir = path.join(process.cwd(), 'storage')
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true })
      }

      const timestamp = Date.now()
      const htmlFile = path.join(storageDir, `debug-store-${timestamp}.html`)
      const screenshotFile = path.join(storageDir, `debug-store-${timestamp}.png`)

      fs.writeFileSync(htmlFile, html)
      await page.screenshot({
        path: screenshotFile,
        fullPage: true,
        timeout: 30000,
        animations: 'disabled'
      })

      console.log(`📁 调试文件已保存: HTML: ${htmlFile}`)
    } catch (error: any) {
      console.warn(`⚠️ 保存调试文件失败: ${error.message}`)
    }
  }

  // Parse HTML
  const $ = load(html)

  // Extract store metadata
  let storeName: string | null = null
  const pageTitle = $('title').text().trim()
  if (pageTitle && !pageTitle.includes('results for')) {
    storeName = pageTitle.replace(' - Amazon.com', '').replace('.com', '').trim()
  }

  if (!storeName) {
    // 🔥 支持桌面版和移动版选择器
    storeName = $('[data-testid="store-name"]').text().trim() ||
                $('.stores-heading-desktop h1').text().trim() ||
                // === 移动版选择器 (a-m-* 页面) ===
                $('.stores-heading-mobile h1').text().trim() ||
                $('[data-cel-widget="StoreFrontTopSectionTitle"] h1').text().trim() ||
                $('.a-section h1.a-text-bold').first().text().trim() ||
                $('meta[property="og:title"]').attr('content')?.replace(' - Amazon.com', '').trim() ||
                null
  }

  // 🔥 支持桌面版和移动版选择器
  const storeDescription = $('meta[name="description"]').attr('content') ||
                           $('meta[property="og:description"]').attr('content') ||
                           $('.stores-brand-description').text().trim() ||
                           // === 移动版选择器 ===
                           $('[data-cel-widget="StoreFrontTopSectionDescription"]').text().trim() ||
                           $('.a-section .a-text-normal').first().text().trim() ||
                           null

  // Extract brand name
  let brandName: string | null = null
  if (storeName) {
    brandName = storeName
      // 🔥 修复（2025-12-10）：移除所有Amazon域名前缀
      .replace(/^Amazon\.com:\s*/i, '')
      .replace(/^Amazon\.ca:\s*/i, '')
      .replace(/^Amazon\.co\.uk:\s*/i, '')
      .replace(/^Amazon\.de:\s*/i, '')
      .replace(/^Amazon\.fr:\s*/i, '')
      .replace(/^Amazon\.it:\s*/i, '')
      .replace(/^Amazon\.es:\s*/i, '')
      .replace(/^Amazon\.in:\s*/i, '')
      .replace(/^Amazon\.jp:\s*/i, '')
      .replace(/^Amazon:\s*/i, '')
      .replace(/\s+Store$/i, '')
      .replace(/\s+Official Store$/i, '')
      // 🔥 修复：移除"Best Seller"/"Best Sellers"等后缀
      .replace(/:\s*Best Sellers?$/i, '')
      .replace(/\s+-\s+Best Sellers?$/i, '')
      .replace(/\s+Best Sellers?$/i, '')
      .trim()

    // 🔥 修复（2025-12-11）：移除店铺分类/分区后缀（如 ": CLEAN", ": Electronics" 等）
    // 这些通常是店铺内的分类导航，不是品牌名称的一部分
    // 格式：品牌名: 分类名 → 只保留品牌名
    if (brandName && brandName.includes(':')) {
      // 常见的分类关键词（大小写不敏感）
      const categoryKeywords = [
        'clean', 'home', 'kitchen', 'electronics', 'tech', 'beauty',
        'fashion', 'sports', 'outdoor', 'garden', 'pet', 'pets',
        'baby', 'kids', 'toys', 'office', 'automotive', 'health',
        'food', 'grocery', 'clothing', 'accessories', 'sale', 'deals',
        'new', 'best', 'top', 'featured', 'popular', 'trending'
      ]

      const parts = brandName.split(':')
      if (parts.length >= 2) {
        const firstPart = parts[0].trim()
        const secondPart = parts[1].trim().toLowerCase()

        // 检查第二部分是否像分类名称
        const isLikelyCategory = categoryKeywords.some(keyword =>
          secondPart.includes(keyword) || secondPart === keyword
        )

        // 如果第二部分很短（<=15字符）或包含常见分类关键词，则只保留第一部分
        if (isLikelyCategory || secondPart.length <= 15) {
          console.log(`🔧 品牌名清理: "${brandName}" → "${firstPart}" (移除分类后缀: "${parts.slice(1).join(':')}")`)
          brandName = firstPart
        }
      }
    }

    // 🔥 修复（2025-12-12）：过滤无效的品牌名
    const invalidBrandNames = [
      'page not found', 'not found', 'error', '404', '429',
      'access denied', 'something went wrong', 'sorry',
      'amazon.com', 'amazon', 'page'
    ]
    if (brandName && invalidBrandNames.some(invalid =>
      brandName!.toLowerCase() === invalid ||
      brandName!.toLowerCase().includes(invalid)
    )) {
      console.warn(`⚠️ 无效品牌名过滤: "${brandName}"`)
      brandName = null
    }

    // 🔥 修复（2025-12-12）：品牌名包含产品后缀时，尝试提取核心品牌名
    // 例如: "RingConn Smart Ring" → "RingConn"
    if (brandName && brandName.split(/\s+/).length > 2) {
      const words = brandName.split(/\s+/)
      const firstWord = words[0]
      // 如果第一个单词看起来像品牌名（首字母大写，2-20字符）
      if (firstWord.length >= 2 && firstWord.length <= 20 &&
          /^[A-Z][a-zA-Z0-9]*$/.test(firstWord)) {
        // 检查后续单词是否是产品类型词
        const productTypeWords = [
          'smart', 'ring', 'watch', 'band', 'tracker', 'speaker', 'earbuds',
          'headphones', 'phone', 'tablet', 'laptop', 'camera', 'drone',
          'charger', 'cable', 'case', 'cover', 'screen', 'protector',
          'keyboard', 'mouse', 'monitor', 'light', 'lamp', 'fan'
        ]
        const hasProductType = words.slice(1).some(w =>
          productTypeWords.includes(w.toLowerCase())
        )
        if (hasProductType) {
          console.log(`🔧 品牌名精简: "${brandName}" → "${firstWord}" (移除产品类型词)`)
          brandName = firstWord
        }
      }
    }
  }

  if (!brandName) {
    const urlMatch = url.match(/\/stores\/([^\/]+)/)
    if (urlMatch && urlMatch[1] && urlMatch[1].toLowerCase() !== 'page') {
      brandName = decodeURIComponent(urlMatch[1]).replace(/-/g, ' ').trim()
    }
  }

  // Extract products
  const products: AmazonStoreData['products'] = []
  const productAsins: Set<string> = new Set()

  // Strategy A0: Extract from embedded JavaScript JSON
  console.log('📍 策略A0: 从嵌入的JavaScript JSON中提取产品数据...')
  extractProductsFromJson(html, products, productAsins)

  // 🔥 Strategy A2: Extract complete data from ProductGridItem (2025-12-10优化)
  // 这个策略可以直接从页面提取完整数据，避免访问详情页
  console.log('📍 策略A2: 从ProductGridItem提取完整数据...')
  extractFromProductGridItems($, products, productAsins)

  // Strategy A1: Extract ASINs from HTML links (补充A0和A2未覆盖的ASIN)
  console.log('📍 策略A1: 从Store页面HTML提取产品ASIN...')
  $('a[href*="/dp/"]').each((i, el) => {
    const href = $(el).attr('href') || ''
    const asinMatch = href.match(/\/dp\/([A-Z0-9]{10})/)
    if (asinMatch && asinMatch[1]) {
      const asin = asinMatch[1]
      const text = $(el).text().toLowerCase()
      const isAmazonProduct = text.includes('amazon') && (text.includes('card') || text.includes('credit'))

      if (!isAmazonProduct) {
        productAsins.add(asin)
      }
    }
  })

  console.log(`📊 策略A1结果: 找到 ${productAsins.size} 个产品ASIN`)

  // 🔥 优化：检查是否已有足够完整的数据，避免不必要的详情页抓取
  const productsWithCompleteData = products.filter(p =>
    p.rating && p.reviewCount && (p.salesVolume || p.badge)
  )
  const hasCompleteData = productsWithCompleteData.length >= 5

  console.log(`📊 数据完整性检查: ${productsWithCompleteData.length}/${products.length} 个产品有完整数据`)

  // Phase 2: Batch scrape product details if needed
  // 🔥 优化：如果已有完整数据，跳过详情页抓取
  const needPhase2 = products.length === 0 && productAsins.size > 0

  console.log(`🔍 Phase 2检查: products.length: ${products.length}, productAsins.size: ${productAsins.size}, needPhase2: ${needPhase2}${hasCompleteData ? ' (已有完整数据，跳过)' : ''}`)

  if (needPhase2) {
    console.log(`📦 阶段2: 批量抓取产品详情页`)
    await batchScrapeProductDetails(page, products, productAsins, effectiveProxyUrl)
  }

  // Phase 3: If still no products, try scraping from categories
  const needPhase3 = products.length === 0 && productAsins.size === 0
  console.log(`🔍 Phase 3检查: products.length: ${products.length}, needPhase3: ${needPhase3}`)

  if (needPhase3) {
    console.log(`📂 策略B: 从产品分类页抓取ASIN...`)

    // Try to scrape categories first if not already done
    let categoriesToScrape: Array<{ name: string; url?: string }> = []

    try {
      const productCategories = await scrapeStoreCategories(page)
      if (productCategories.totalCategories > 0) {
        categoriesToScrape = productCategories.primaryCategories.filter(c => c.url)
        console.log(`✅ 找到 ${categoriesToScrape.length} 个可访问的分类`)
      }
    } catch (error: any) {
      console.warn(`⚠️ 分类抓取失败: ${error.message}`)
    }

    if (categoriesToScrape.length > 0) {
      // Scrape products from top 3 categories
      const maxCategories = Math.min(3, categoriesToScrape.length)
      console.log(`📂 准备从前 ${maxCategories} 个分类抓取产品...`)

      await scrapeCategoryProducts(page, categoriesToScrape.slice(0, maxCategories), productAsins, effectiveProxyUrl)

      console.log(`📊 策略B结果: 从分类页找到 ${productAsins.size} 个产品ASIN`)

      if (productAsins.size > 0) {
        console.log(`📦 阶段3: 批量抓取产品详情页`)
        await batchScrapeProductDetails(page, products, productAsins, effectiveProxyUrl)
      }
    }
  }

  // Filter and enhance products
  console.log(`📊 原始产品数量: ${products.length}`)
  const validProducts = products.filter(p => {
    const isPlaceholder = /^Product [A-Z0-9]{10}$/.test(p.name)
    const hasPrice = p.price && p.price !== 'null'
    if (isPlaceholder && !hasPrice) {
      return false
    }
    return true
  })
  console.log(`📊 过滤后产品数量: ${validProducts.length}`)

  // Calculate hot scores
  const enhancedProducts = calculateHotScores(validProducts)

  // Calculate insights
  const productsWithRatings = enhancedProducts.filter(p => {
    const rating = p.rating ? parseFloat(p.rating) : 0
    const reviewCount = p.reviewCount ? parseInt(p.reviewCount.replace(/,/g, '')) : 0
    return rating > 0 && reviewCount > 0
  })

  const hotInsights = productsWithRatings.length > 0 ? {
    avgRating: productsWithRatings.reduce((sum, p) => sum + parseFloat(p.rating || '0'), 0) / productsWithRatings.length,
    avgReviews: Math.round(productsWithRatings.reduce((sum, p) => sum + parseInt((p.reviewCount || '0').replace(/,/g, '')), 0) / productsWithRatings.length),
    topProductsCount: enhancedProducts.length
  } : undefined

  const storeData: AmazonStoreData = {
    storeName,
    storeDescription,
    brandName: brandName ? normalizeBrandName(brandName) : null,
    products: enhancedProducts,
    totalProducts: enhancedProducts.length,
    storeUrl: finalUrl,
    hotInsights,
  }

  // Try to scrape categories
  try {
    const productCategories = await scrapeStoreCategories(page)
    if (productCategories.totalCategories > 0) {
      storeData.productCategories = productCategories
      console.log(`✅ 成功抓取 ${productCategories.totalCategories} 个产品分类`)
    }
  } catch (error: any) {
    console.warn(`⚠️ 类别抓取失败（非致命错误）: ${error.message}`)
  }

  console.log(`✅ Store抓取成功: ${storeName}`)
  console.log(`📊 热销商品筛选: ${products.length} → ${enhancedProducts.length}`)
  if (hotInsights) {
    console.log(`💡 热销洞察: 平均评分 ${hotInsights.avgRating.toFixed(1)}⭐, 平均评论 ${hotInsights.avgReviews} 条`)
  }

  return storeData
}

/**
 * Extract products from embedded JavaScript JSON
 */
function extractProductsFromJson(
  html: string,
  products: AmazonStoreData['products'],
  productAsins: Set<string>
): void {
  try {
    const jsonMatch = html.match(/liveFlagshipStates\["amazonlive-react-shopping-carousel-data"\]\s*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\)/)

    if (jsonMatch && jsonMatch[1]) {
      const jsonStr = JSON.parse(jsonMatch[1])
      const carouselData = jsonStr

      console.log(`📊 找到嵌入的产品数据对象`)

      const preloadProducts = carouselData.preloadProducts || {}

      for (const [rawAsin, productData] of Object.entries(preloadProducts) as [string, any][]) {
        const asin = cleanAsin(rawAsin)
        if (!asin) continue  // 跳过无效ASIN

        products.push({
          name: productData.title || '',
          price: productData.formattedPriceV2 || null,
          rating: productData.ratingValue ? String(productData.ratingValue) : null,
          reviewCount: productData.totalReviewCount ? String(productData.totalReviewCount) : null,
          asin: asin,
          promotion: productData.dealBadge?.messageText || null,
          badge: productData.dealBadge?.labelText || null,
          isPrime: productData.eligibleForPrimeShipping || false
        })

        productAsins.add(asin)
      }

      console.log(`📊 策略A0成功: 从preloadProducts提取 ${products.length} 个产品`)

      // Extract from segments
      const segments = carouselData.segments || []
      let segmentAsinCount = 0
      for (const segment of segments) {
        const segmentItems = segment.segmentItems || []
        for (const item of segmentItems) {
          if (item.type === 'PRODUCT' && item.asin) {
            const asin = cleanAsin(item.asin)
            if (!asin) continue  // 跳过无效ASIN
            if (!productAsins.has(asin)) {
              // 尝试从preloadProducts获取，注意原始key可能也需要清理
              const productData = preloadProducts[item.asin] || preloadProducts[asin]
              if (productData) {
                products.push({
                  name: productData.title || '',
                  price: productData.formattedPriceV2 || null,
                  rating: productData.ratingValue ? String(productData.ratingValue) : null,
                  reviewCount: productData.totalReviewCount ? String(productData.totalReviewCount) : null,
                  asin: asin,
                  promotion: productData.dealBadge?.messageText || null,
                  badge: productData.dealBadge?.labelText || null,
                  isPrime: productData.eligibleForPrimeShipping || false
                })
                productAsins.add(asin)
                segmentAsinCount++
              }
            }
          }
        }
      }

      if (segmentAsinCount > 0) {
        console.log(`📊 A0c成功: 从segments补充 ${segmentAsinCount} 个产品`)
      }
    } else {
      console.log('⚠️ 未找到嵌入的JavaScript产品数据')
    }
  } catch (error: any) {
    console.error(`❌ 解析JavaScript JSON失败: ${error.message}`)
  }
}

/**
 * 🔥 2025-12-10优化：策略A2 - 从ProductGridItem直接提取完整数据
 *
 * 新版Amazon店铺页面使用ProductGridItem组件展示产品
 * 可以直接提取：ASIN、标题、价格、评分、评论数、销售热度、Prime状态等
 *
 * 关键选择器：
 * - 产品项: li[data-testid="product-grid-item"]
 * - ASIN: data-csa-c-item-id="amzn1.asin.XXXXXXXXXX"
 * - 评分: [class*="rating--short"]
 * - 价格: 从文本中正则匹配
 * - 销售热度: "1K+ bought in past month" 等
 */
function extractFromProductGridItems(
  $: CheerioAPI,
  products: AmazonStoreData['products'],
  productAsins: Set<string>
): void {
  console.log('📍 策略A2: 从ProductGridItem提取完整数据...')

  let extractedCount = 0

  // 选择器优先级：data-testid > class名 > menuitem
  const productSelectors = [
    'li[data-testid="product-grid-item"]',
    '[class*="ProductGridItem__itemOuter"]',
    'li[data-csa-c-item-type="asin"]',
    'menuitem[description*="view product"]'  // 🔥 Dreame等店铺使用menuitem展示产品
  ]

  for (const selector of productSelectors) {
    const items = $(selector)
    if (items.length === 0) continue

    console.log(`  ✓ 选择器 "${selector}" 匹配到 ${items.length} 个产品项`)

    items.each((i, el) => {
      const $item = $(el)

      // 1. 提取ASIN - 优先使用data-csa-c-item-id属性
      let asin: string | null = null
      const csaItemId = $item.attr('data-csa-c-item-id')
      if (csaItemId && csaItemId.startsWith('amzn1.asin.')) {
        asin = cleanAsin(csaItemId.replace('amzn1.asin.', ''))
      }

      // 备选1：从description属性提取ASIN（menuitem专用）
      if (!asin) {
        const description = $item.attr('description')
        if (description) {
          const match = description.match(/([A-Z0-9]{10})/)
          if (match) asin = cleanAsin(match[1])
        }
      }

      // 备选2：从链接提取ASIN
      if (!asin) {
        const href = $item.find('a[href*="/dp/"]').attr('href')
        if (href) {
          const match = href.match(/\/dp\/([A-Z0-9]{10})/)
          if (match) asin = match[1]
        }
      }

      // 跳过无效或重复的ASIN
      if (!asin || productAsins.has(asin)) return

      // 2. 提取产品标题
      const titleEl = $item.find('a[title]').first()
      const title = titleEl.attr('title') ||
                   $item.attr('description') ||  // 🔥 menuitem的description包含完整标题
                   $item.find('[class*="title"]').text().trim() ||
                   $item.find('img').attr('alt')?.replace('Image of ', '') ||
                   `Product ${asin}`

      // 3. 提取评分 - 从rating--short类获取
      let rating: string | null = null
      const ratingShort = $item.find('[class*="rating--short"]').text().trim()
      if (ratingShort && /^\d+\.?\d*$/.test(ratingShort)) {
        rating = ratingShort
      }

      // 4. 提取评论数 - 从rating容器解析
      let reviewCount: string | null = null
      const ratingContainer = $item.find('[class*="rating__"]').text()
      if (ratingContainer) {
        // 格式："4.24.2 out of 5 stars2574.2 out of 5 stars. 257 customer reviews"
        const reviewMatch = ratingContainer.match(/(\d{1,3}(?:,\d{3})*)\s*(?:customer reviews|ratings)/i)
        if (reviewMatch) {
          reviewCount = reviewMatch[1]
        } else {
          // 备选：查找纯数字（评论数）
          const numbersInRating = ratingContainer.match(/\d{1,3}(?:,\d{3})*/g)
          if (numbersInRating && numbersInRating.length >= 2) {
            // 评论数通常是较大的那个数字
            const nums = numbersInRating.map(n => parseInt(n.replace(/,/g, '')))
            const maxNum = Math.max(...nums)
            if (maxNum > 10) {
              reviewCount = maxNum.toLocaleString()
            }
          }
        }
      }

      // 5. 提取价格
      let price: string | null = null
      const itemText = $item.text()
      const priceMatch = itemText.match(/\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/)
      if (priceMatch) {
        price = '$' + priceMatch[1]
      }

      // 6. 🔥 提取销售热度 (关键优化点!)
      let salesVolume: string | null = null
      const salesMatch = itemText.match(/(\d+[KM]?\+?)\s*bought in past month/i)
      if (salesMatch) {
        salesVolume = salesMatch[1] + ' bought in past month'
      }

      // 7. 提取折扣信息
      let discount: string | null = null
      const discountMatch = itemText.match(/(-\d+%)/i)
      if (discountMatch) {
        discount = discountMatch[1]
      }

      // 8. 提取促销标签
      let promotion: string | null = null
      if (itemText.includes('Limited time deal')) {
        promotion = 'Limited time deal'
      } else if (itemText.includes('Deal')) {
        promotion = 'Deal'
      }

      // 9. 检查Prime
      const isPrime = $item.find('img[alt*="Prime"]').length > 0

      // 10. 提取配送信息
      let deliveryInfo: string | null = null
      const deliveryMatch = itemText.match(/(Get it by [A-Za-z]+,\s*[A-Za-z]+\s*\d+)/i)
      if (deliveryMatch) {
        deliveryInfo = deliveryMatch[1]
      }

      // 11. 提取图片URL
      let imageUrl: string | null = null
      const imgSrc = $item.find('img[src*="images-amazon"]').attr('src')
      if (imgSrc) {
        imageUrl = imgSrc
      }

      // 12. 提取Badge (Best Seller, Amazon's Choice等)
      let badge: string | null = null
      if (itemText.toLowerCase().includes('best seller')) {
        badge = 'Best Seller'
      } else if (itemText.toLowerCase().includes("amazon's choice")) {
        badge = "Amazon's Choice"
      } else if (itemText.includes('Climate Pledge')) {
        badge = 'Climate Pledge Friendly'
      }

      // 添加到产品列表
      products.push({
        name: title.substring(0, 300),
        price,
        rating,
        reviewCount,
        asin,
        promotion,
        badge,
        isPrime,
        salesVolume,
        discount,
        deliveryInfo,
        imageUrl
      })

      productAsins.add(asin)
      extractedCount++
    })

    // 如果已成功提取产品，跳出循环
    if (extractedCount > 0) {
      console.log(`📊 策略A2成功: 从ProductGridItem提取 ${extractedCount} 个产品（含完整数据）`)
      break
    }
  }

  if (extractedCount === 0) {
    console.log('⚠️ 策略A2未找到ProductGridItem产品')
  }
}

/**
 * Batch scrape product details
 */
/**
 * Scrape products from category pages
 */
async function scrapeCategoryProducts(
  page: Page,
  categories: Array<{ name: string; url?: string }>,
  productAsins: Set<string>,
  effectiveProxyUrl: string
): Promise<void> {
  for (const category of categories) {
    if (!category.url) continue

    try {
      console.log(`📂 访问分类: ${category.name}`)

      // Build full category URL
      const categoryUrl = category.url.startsWith('http')
        ? category.url
        : `https://www.amazon.com${category.url}`

      await page.goto(categoryUrl, {
        waitUntil: 'domcontentloaded',
        timeout: getDynamicTimeout(categoryUrl),
      })

      await randomDelay(2000, 3000)

      // Wait for product grid to load
      await page.waitForSelector('[data-asin]:not([data-asin=""]), .s-result-item[data-asin]', {
        timeout: 10000
      }).catch(() => {
        console.log('  ⚠️ 未找到产品网格，尝试其他选择器...')
      })

      await randomDelay(1000, 2000)

      const html = await page.content()
      const $ = load(html)

      // Extract ASINs from category page
      const foundAsins = new Set<string>()

      // Strategy 1: data-asin attributes
      $('[data-asin]').each((i, el) => {
        const asin = $(el).attr('data-asin')
        if (asin && asin.length === 10 && /^[A-Z0-9]{10}$/.test(asin)) {
          foundAsins.add(asin)
        }
      })

      // Strategy 2: /dp/ links
      $('a[href*="/dp/"]').each((i, el) => {
        const href = $(el).attr('href') || ''
        const asinMatch = href.match(/\/dp\/([A-Z0-9]{10})/)
        if (asinMatch && asinMatch[1]) {
          foundAsins.add(asinMatch[1])
        }
      })

      console.log(`  ✅ 从 "${category.name}" 提取到 ${foundAsins.size} 个ASIN`)

      // Add to main ASIN set (limit to first 20 per category)
      let count = 0
      for (const asin of foundAsins) {
        if (count >= 20) break
        productAsins.add(asin)
        count++
      }

      await randomDelay(2000, 3000)

    } catch (error: any) {
      console.error(`  ❌ 分类 "${category.name}" 抓取失败: ${error.message}`)
      continue
    }
  }
}

/**
 * 🔥 优化版：批量抓取产品详情
 * 使用统一的 scrapeAmazonProduct 获取完整数据
 * 支持24小时缓存，避免重复抓取
 *
 * @param productAsins - 待抓取的ASIN列表
 * @param effectiveProxyUrl - 代理URL
 * @param targetCountry - 目标国家
 * @param maxCount - 最大抓取数量（默认10）
 * @returns 完整的产品详情数组
 */
async function batchScrapeProductDetailsComplete(
  productAsins: Set<string>,
  effectiveProxyUrl: string,
  targetCountry?: string,
  maxCount: number = 10
): Promise<AmazonProductData[]> {
  const asinsToProcess = Array.from(productAsins).slice(0, maxCount)
  console.log(`📦 批量抓取产品详情 (最多${maxCount}个)...`)
  console.log(`📊 缓存状态: ${JSON.stringify(getProductCacheStats())}`)

  // Step 1: 检查缓存 - 🔥 2025-12-12修复：启用质量检查，要求features不为空
  const { cached, uncached } = checkCacheBatch(asinsToProcess, true)
  console.log(`📦 缓存: ${cached.length}个命中(质量合格), ${uncached.length}个需抓取`)

  const results: AmazonProductData[] = cached.map(c => c.data)

  // Step 2: 抓取未缓存的产品
  if (uncached.length === 0) {
    console.log(`✅ 全部命中缓存，无需抓取`)
    return results
  }

  // 并行抓取（但限制并发数为3，避免过多请求）
  const batchSize = 3
  for (let i = 0; i < uncached.length; i += batchSize) {
    const batch = uncached.slice(i, i + batchSize)
    console.log(`🔄 处理批次 ${Math.floor(i / batchSize) + 1}: ${batch.length} 个商品`)

    const batchResults = await Promise.allSettled(
      batch.map(async (asin) => {
        const amazonDomain = getAmazonDomain(targetCountry)
        const productUrl = `https://${amazonDomain}/dp/${asin}`
        console.log(`  🛒 抓取产品: ${asin} (${amazonDomain})`)

        try {
          // 使用完整的 scrapeAmazonProduct 获取所有数据
          const productData = await scrapeAmazonProduct(
            productUrl,
            effectiveProxyUrl,
            targetCountry,
            1,  // 热销商品抓取只重试1次
            true  // 跳过竞品ASIN提取（避免嵌套抓取）
          )

          // 保存到缓存
          if (productData.asin) {
            setCachedProductDetail(productData.asin, productData)
          }

          console.log(`  ✅ 成功: ${productData.productName?.substring(0, 50)}... (${productData.rating || 'N/A'}⭐, ${productData.reviewCount || '0'} 评论, Badge: ${productData.badge || 'None'})`)
          return productData
        } catch (error: any) {
          console.error(`  ❌ 抓取失败 (${asin}): ${error.message}`)
          return null
        }
      })
    )

    // 收集成功的结果
    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value)
      }
    }

    // 批次间延迟
    if (i + batchSize < uncached.length) {
      await randomDelay(2000, 3000)
    }
  }

  console.log(`✅ 批量抓取完成: 缓存${cached.length}个 + 新抓取${results.length - cached.length}/${uncached.length}个`)
  return results
}

/**
 * @deprecated 旧版轻量级抓取函数，已被 batchScrapeProductDetailsComplete 替代
 * 保留以兼容旧代码，但建议使用新函数
 */
async function batchScrapeProductDetails(
  page: Page,
  products: AmazonStoreData['products'],
  productAsins: Set<string>,
  effectiveProxyUrl: string,
  targetCountry?: string
): Promise<void> {
  // 调用新的完整抓取函数
  const completeProducts = await batchScrapeProductDetailsComplete(
    productAsins,
    effectiveProxyUrl,
    targetCountry,
    10
  )

  // 转换为旧格式并添加到products数组
  for (const p of completeProducts) {
    products.push({
      name: p.productName || `Product ${p.asin}`,
      price: p.productPrice || null,
      rating: p.rating || null,
      reviewCount: p.reviewCount || null,
      asin: p.asin || '',
      promotion: null,
      badge: p.badge || null,
      isPrime: p.primeEligible || false,
      // 🔥 新增：保留完整数据用于hotScore计算
      salesRank: p.salesRank || null,
      features: p.features || [],
    })
  }
}

/**
 * 🔥 优化版：计算热销分数
 * 基于完整详情页数据：rating + reviewCount + badge + salesRank + salesVolume
 *
 * 2025-12-10优化：新增salesVolume加权
 * salesVolume格式："1K+ bought in past month", "4K+ bought in past month"
 * 这是Amazon官方的销售热度指标，权重应该较高
 */
function calculateHotScores(products: AmazonStoreData['products']): AmazonStoreData['products'] {
  const productsWithScores = products.map(p => {
    const rating = p.rating ? parseFloat(p.rating) : 0
    const reviewCount = p.reviewCount ? parseInt(p.reviewCount.replace(/,/g, '')) : 0

    // 基础热度分 = 评分 × log10(评论数 + 1)
    let hotScore = rating > 0 && reviewCount > 0
      ? rating * Math.log10(reviewCount + 1)
      : 0

    // 🔥 2025-12-10优化：SalesVolume加权（从店铺页直接获取的销售热度）
    // 这是最直接的热销指标，权重最高
    if (p.salesVolume) {
      const salesVolumeNum = parseSalesVolume(p.salesVolume)
      if (salesVolumeNum > 0) {
        // 使用对数缩放，避免极端值主导
        const salesFactor = Math.log10(salesVolumeNum + 1)
        hotScore += salesFactor * 2  // 销售热度贡献额外分数

        // 销售量分级加权
        if (salesVolumeNum >= 10000) {
          hotScore *= 1.6  // 10K+ 销售加权60%
        } else if (salesVolumeNum >= 4000) {
          hotScore *= 1.4  // 4K+ 销售加权40%
        } else if (salesVolumeNum >= 1000) {
          hotScore *= 1.2  // 1K+ 销售加权20%
        } else if (salesVolumeNum >= 500) {
          hotScore *= 1.1  // 500+ 销售加权10%
        }
      }
    }

    // 🔥 Badge加权（Amazon官方认证更可信）
    if (p.badge) {
      const badgeLower = p.badge.toLowerCase()
      if (badgeLower.includes('best seller') || badgeLower.includes('#1')) {
        hotScore *= 1.5  // Best Seller 加权50%
      } else if (badgeLower.includes("amazon's choice")) {
        hotScore *= 1.3  // Amazon's Choice 加权30%
      } else if (badgeLower.includes('climate pledge')) {
        hotScore *= 1.05  // Climate Pledge 小幅加权
      } else {
        hotScore *= 1.1  // 其他badge 加权10%
      }
    }

    // 🔥 SalesRank加权（排名越低越热销）
    if (p.salesRank) {
      const rankMatch = p.salesRank.match(/[\d,]+/)
      if (rankMatch) {
        const rank = parseInt(rankMatch[0].replace(/,/g, ''))
        if (rank > 0) {
          if (rank < 100) hotScore *= 1.4       // Top 100
          else if (rank < 1000) hotScore *= 1.2  // Top 1000
          else if (rank < 10000) hotScore *= 1.1 // Top 10000
        }
      }
    }

    // 🔥 折扣加权（有折扣的商品可能更热销）
    if (p.discount) {
      const discountMatch = p.discount.match(/-?(\d+)%/)
      if (discountMatch) {
        const discountPercent = parseInt(discountMatch[1])
        if (discountPercent >= 20) {
          hotScore *= 1.1  // 20%以上折扣加权10%
        }
      }
    }

    // 🔥 促销标签加权
    if (p.promotion) {
      const promoLower = p.promotion.toLowerCase()
      if (promoLower.includes('limited time')) {
        hotScore *= 1.15  // 限时优惠加权15%
      } else if (promoLower.includes('deal')) {
        hotScore *= 1.1   // 普通deal加权10%
      }
    }

    return { ...p, hotScore, ratingNum: rating, reviewCountNum: reviewCount }
  })

  productsWithScores.sort((a, b) => b.hotScore - a.hotScore)

  const topCount = Math.min(15, productsWithScores.length)
  const topProducts = productsWithScores.slice(0, topCount)

  return topProducts.map((p, index) => ({
    name: p.name,
    price: p.price,
    rating: p.rating,
    reviewCount: p.reviewCount,
    asin: p.asin,
    hotScore: p.hotScore,
    rank: index + 1,
    isHot: index < 5,
    promotion: p.promotion,
    badge: p.badge,
    isPrime: p.isPrime,
    hotLabel: index < 5 ? '🔥 热销商品' : '✅ 畅销商品',
    // 🔥 新增：保留完整数据供AI分析
    salesRank: p.salesRank,
    features: p.features,
    // 🔥 2025-12-10优化：保留从店铺页直接提取的数据
    salesVolume: p.salesVolume,
    discount: p.discount,
    deliveryInfo: p.deliveryInfo,
    imageUrl: p.imageUrl,
  }))
}

/**
 * 🔥 2025-12-10新增：解析销售热度字符串
 *
 * 输入格式：
 * - "1K+ bought in past month" → 1000
 * - "4K+ bought in past month" → 4000
 * - "10K+ bought in past month" → 10000
 * - "500+ bought in past month" → 500
 * - "1M+ bought in past month" → 1000000
 *
 * @param salesVolume - 销售热度字符串
 * @returns 解析后的数值
 */
function parseSalesVolume(salesVolume: string): number {
  if (!salesVolume) return 0

  // 提取数字和单位
  const match = salesVolume.match(/(\d+(?:\.\d+)?)\s*([KMkm])?/)
  if (!match) return 0

  let value = parseFloat(match[1])
  const unit = match[2]?.toUpperCase()

  // 应用单位乘数
  if (unit === 'K') {
    value *= 1000
  } else if (unit === 'M') {
    value *= 1000000
  }

  return Math.round(value)
}

/**
 * Scrape store categories
 */
async function scrapeStoreCategories(
  page: Page
): Promise<NonNullable<AmazonStoreData['productCategories']>> {
  console.log('🔍 开始抓取店铺产品分类...')

  const categories: Array<{ name: string; count: number; url?: string }> = []

  const categorySelectors = [
    // 🔥 优先级1: 店铺专属导航选择器（最精确）
    'nav[aria-label*="categor"] a, nav[aria-label*="Categor"] a',
    'nav a[href*="/stores/page/"]',  // 🆕 店铺页面导航（Dreame等现代店铺）
    '#nav-subnav a[href*="/s?"]',
    '.store-nav-category a, .store-categories a',
    '[class*="StoreNav"] a, [class*="store-nav"] a',
    '[data-component-type="category-link"]',
    // 🔥 优先级2: 店铺内容区域的分类链接（排除全局导航）
    'main a[href*="node="], main a[href*="rh="]',
    '#storeContent a[href*="node="], #storeContent a[href*="rh="]',
    '[id*="store"] a[href*="node="], [id*="store"] a[href*="rh="]',
    // 🔥 优先级3: 通用分类链接（最后备选，但会被过滤）
    'a[href*="node="], a[href*="rh="]'
  ]

  for (const selector of categorySelectors) {
    try {
      const elements = await page.$$(selector)

      if (elements.length === 0) continue

      console.log(`  ✓ 选择器 "${selector}" 匹配到 ${elements.length} 个元素`)

      for (const el of elements) {
        try {
          const name = await el.textContent()
          const href = await el.getAttribute('href')

          if (!name || name.trim().length === 0) continue
          const trimmedName = name.trim()

          const skipKeywords = ['all products', 'shop now', 'view all', 'see more', 'home', 'back']
          if (skipKeywords.some(keyword => trimmedName.toLowerCase().includes(keyword))) {
            continue
          }

          if (categories.some(c => c.name.toLowerCase() === trimmedName.toLowerCase())) {
            continue
          }

          categories.push({
            name: trimmedName,
            count: 0,
            url: href || undefined
          })
        } catch (err) {
          continue
        }
      }

      if (categories.length > 0) {
        console.log(`✅ 成功抓取 ${categories.length} 个产品类别`)
        break
      }
    } catch (error: any) {
      continue
    }
  }

  if (categories.length === 0) {
    console.warn('⚠️ 未能识别到店铺产品分类')
  }

  return {
    primaryCategories: categories,
    totalCategories: categories.length
  }
}

/**
 * 🔥 增强版：店铺深度抓取
 * - 对热销商品进入详情页获取完整数据
 * - 聚合评论数据用于AI评论分析
 * - 聚合竞品ASIN用于竞品分析
 * - 使用统一缓存避免重复抓取
 *
 * 🔥 2025-12-12 内存优化：
 * - 创建单个浏览器实例，复用Context抓取所有商品详情
 * - 从每个Offer 6个浏览器降低到1个浏览器
 * - 预计内存节省80%+
 */
export async function scrapeAmazonStoreDeep(
  storeUrl: string,
  topN: number = 5,
  customProxyUrl?: string,
  targetCountry?: string,
  maxConcurrency: number = 2  // 🔥 降低并发，因为复用同一个Context
): Promise<AmazonStoreData> {
  console.log(`🔍 店铺深度抓取开始: ${storeUrl}, 目标抓取 ${topN} 个热销商品`)
  console.log(`📊 产品缓存状态: ${JSON.stringify(getProductCacheStats())}`)

  const storeData = await scrapeAmazonStore(storeUrl, customProxyUrl, targetCountry)

  console.log(`📊 scrapeAmazonStore返回产品数: ${storeData.products.length}`)

  if (storeData.products.length === 0) {
    console.warn(`⚠️ scrapeAmazonStore未返回任何产品`)
    return storeData
  }

  const hotProducts = storeData.products
    .filter(p => p.asin)
    .filter(p => p.isHot || (p.rank && p.rank <= topN))
    .slice(0, topN)

  console.log(`📊 筛选出 ${hotProducts.length} 个热销商品准备深度抓取`)

  if (hotProducts.length === 0) {
    console.warn('⚠️ 未找到热销商品，跳过深度抓取')
    return storeData
  }

  const deepResults: NonNullable<AmazonStoreData['deepScrapeResults']> = {
    topProducts: [],
    totalScraped: hotProducts.length,
    successCount: 0,
    failedCount: 0,
    // 🔥 新增：聚合数据用于AI分析
    aggregatedReviews: [],
    aggregatedCompetitorAsins: [],
    aggregatedFeatures: [],
  }

  // 用于去重的Set
  const seenCompetitorAsins = new Set<string>()
  const seenFeatures = new Set<string>()

  // 🔥 2025-12-12 内存优化：创建单个浏览器实例，复用Context
  const effectiveProxyUrl = customProxyUrl || PROXY_URL
  let browserResult: Awaited<ReturnType<typeof createStealthBrowser>> | null = null

  try {
    // 创建浏览器实例用于所有商品详情抓取
    browserResult = await createStealthBrowser(effectiveProxyUrl, targetCountry)
    console.log(`🔄 [内存优化] 创建单个浏览器实例，将复用Context抓取 ${hotProducts.length} 个商品`)

    // 🔥 串行处理，避免同一Context并发过多Page导致不稳定
    for (let i = 0; i < hotProducts.length; i++) {
      const product = hotProducts[i]
      const asin = cleanAsin(product.asin) // 防御性清理，确保ASIN格式正确
      if (!asin) {
        console.warn(`  ⚠️ 跳过无效ASIN: ${product.asin}`)
        continue
      }
      const amazonDomain = getAmazonDomain(targetCountry)
      const productUrl = `https://${amazonDomain}/dp/${asin}`

      console.log(`  🛒 [${i + 1}/${hotProducts.length}] 抓取商品详情: ${product.name?.substring(0, 50)}... (${asin}) [${amazonDomain}]`)

      // 🔥 2025-12-12修复：优先检查缓存，启用质量检查（要求features不为空）
      // getCachedProductDetail 现在支持质量检查，统一日志输出
      const cached = getCachedProductDetail(asin, true)  // requireFeatures = true
      if (cached) {
        // 缓存有效且质量合格（features不为空）
        const cachedResult = {
          asin: asin,
          productData: cached,
          reviews: cached.topReviews || [],
          reviewHighlights: cached.reviewHighlights || [],
          competitorAsins: cached.relatedAsins || [],
          features: cached.features || [],
          scrapeStatus: 'success' as const
        }
        deepResults.topProducts.push(cachedResult)
        deepResults.successCount++
        aggregateProductData(cachedResult, deepResults, seenCompetitorAsins, seenFeatures)
        continue
      }
      // 缓存未命中或质量不合格，需要重新抓取

      try {
        // 🔥 修复（2025-12-13）：店铺场景跳过竞品提取
        // 原因：店铺场景不需要竞品分析，跳过竞品ASIN提取可节省大量时间
        const productData = await scrapeAmazonProductWithContext(
          browserResult.context,
          productUrl,
          targetCountry,
          true  // 跳过竞品提取，店铺场景只需要产品特性和评论
        )

        // 保存到缓存
        if (productData.asin) {
          setCachedProductDetail(productData.asin, productData)
        }

        const successResult = {
          asin: asin,
          productData: productData,
          reviews: productData.topReviews || [],
          reviewHighlights: productData.reviewHighlights || [],
          competitorAsins: productData.relatedAsins || [],
          features: productData.features || [],
          scrapeStatus: 'success' as const
        }
        deepResults.topProducts.push(successResult)
        deepResults.successCount++
        aggregateProductData(successResult, deepResults, seenCompetitorAsins, seenFeatures)

        // 🔥 2025-12-12调试：记录每个商品的features提取结果
        console.log(`  ✅ 成功: ${asin}, 评价数: ${successResult.reviews.length}, 竞品数: ${successResult.competitorAsins.length}, features: ${successResult.features.length}条`)

        // 🔥 商品间添加随机延迟，模拟人类行为
        if (i < hotProducts.length - 1) {
          const delay = 1000 + Math.random() * 2000
          console.log(`  ⏰ 等待 ${Math.round(delay)}ms 后继续...`)
          await new Promise(resolve => setTimeout(resolve, delay))
        }

      } catch (error: any) {
        console.error(`  ❌ 商品详情抓取失败 (${asin}): ${error.message}`)
        deepResults.topProducts.push({
          asin: asin,
          productData: null,
          reviews: [],
          reviewHighlights: [],
          competitorAsins: [],
          features: [],
          scrapeStatus: 'failed' as const,
          error: error.message
        })
        deepResults.failedCount++

        // 🔥 失败后等待更长时间，可能是反爬虫触发
        await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 2000))
      }
    }

  } finally {
    // 🔥 确保浏览器实例被释放
    if (browserResult) {
      await releaseBrowser(browserResult)
      console.log(`🔄 [内存优化] 浏览器实例已释放`)
    }
  }

  console.log(`📊 深度抓取完成: 成功 ${deepResults.successCount}/${deepResults.totalScraped}`)
  console.log(`📊 聚合数据: 评论 ${deepResults.aggregatedReviews?.length || 0} 条, 竞品ASIN ${deepResults.aggregatedCompetitorAsins?.length || 0} 个, 特性 ${deepResults.aggregatedFeatures?.length || 0} 条`)

  return {
    ...storeData,
    deepScrapeResults: deepResults
  }
}

/**
 * 🔥 辅助函数：聚合产品数据到深度抓取结果
 */
function aggregateProductData(
  result: {
    asin: string
    reviews: string[]
    reviewHighlights: string[]
    competitorAsins: string[]
    features: string[]
  },
  deepResults: NonNullable<AmazonStoreData['deepScrapeResults']>,
  seenCompetitorAsins: Set<string>,
  seenFeatures: Set<string>
): void {
  // 聚合评论数据
  if (result.reviews && result.reviews.length > 0) {
    deepResults.aggregatedReviews!.push(...result.reviews)
  }
  if (result.reviewHighlights && result.reviewHighlights.length > 0) {
    deepResults.aggregatedReviews!.push(...result.reviewHighlights)
  }

  // 聚合竞品ASIN（去重）
  for (const competitorAsin of result.competitorAsins) {
    if (!seenCompetitorAsins.has(competitorAsin) && competitorAsin !== result.asin) {
      seenCompetitorAsins.add(competitorAsin)
      deepResults.aggregatedCompetitorAsins!.push(competitorAsin)
    }
  }

  // 聚合产品特性（去重）
  for (const feature of result.features) {
    const featureKey = feature.substring(0, 50).toLowerCase()
    if (!seenFeatures.has(featureKey)) {
      seenFeatures.add(featureKey)
      deepResults.aggregatedFeatures!.push(feature)
    }
  }
}
