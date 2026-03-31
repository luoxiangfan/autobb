/**
 * Amazon Product Scraping
 *
 * Single Amazon product page scraping with comprehensive data extraction
 */

import { normalizeBrandName } from '../offer-utils'
import { parsePrice } from '../pricing-utils'  // 🔥 新增：统一价格解析函数
import { getPlaywrightPool } from '../playwright-pool'
import { extractAmazonBrandFromByline } from '../amazon-brand-utils'
import { isLikelyInvalidBrandName } from '../brand-name-utils'
import { isProxyConnectionError } from './proxy-utils'
import { createStealthBrowser, releaseBrowser, configureStealthPage, randomDelay } from './browser-stealth'
import { scrapeUrlWithBrowser } from './core'
import { smartWaitForLoad } from '../smart-wait-strategy'
import type { BrowserContext, Page } from 'playwright'
import type { AmazonProductData } from './types'

const PROXY_URL = process.env.PROXY_URL || ''

/**
 * 🔥 KISS优化：清理ASIN格式
 * Amazon页面数据中ASIN可能包含deal后缀如 "B0DCFNZF32:amzn1.deal.xxx"
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
 * Scrape Amazon product page with enhanced anti-bot bypass
 * Extracts comprehensive data for AI creative generation
 * 🔥 P1优化：代理失败时自动换新代理重试
 * 🌍 支持根据目标国家动态配置语言
 */
export async function scrapeAmazonProduct(
  url: string,
  customProxyUrl?: string,
  targetCountry?: string,  // 🌍 目标国家参数
  maxProxyRetries: number = 2,  // 代理失败最多重试2次
  skipCompetitorExtraction: boolean = false  // 🔥 修复：跳过竞品ASIN提取（用于竞品详情页抓取，避免二级循环）
): Promise<AmazonProductData> {
  console.log(`🛒 抓取Amazon产品: ${url}${targetCountry ? ` (国家: ${targetCountry})` : ''}`)

  let lastError: Error | undefined
  const effectiveProxyUrl = customProxyUrl || PROXY_URL

  for (let proxyAttempt = 0; proxyAttempt <= maxProxyRetries; proxyAttempt++) {
    try {
      if (proxyAttempt > 0) {
        console.log(`🔄 代理重试 ${proxyAttempt}/${maxProxyRetries}，清理连接池并获取新代理...`)
        // 🔥 关键优化：清理连接池实例，避免复用已被Amazon标记的代理IP
        const pool = getPlaywrightPool()
        await pool.clearIdleInstances()
        // 🔥 清理代理IP缓存，强制获取新IP
        const { clearProxyCache } = await import('../proxy/fetch-proxy-ip')
        clearProxyCache(effectiveProxyUrl)
        console.log(`🧹 已清理代理IP缓存: ${effectiveProxyUrl}`)
        // 🔥 额外等待，确保新代理IP被分配
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

      // 🔥 P1优化：使用更短的超时进行快速失败检测
      const quickTimeout = 30000  // 30秒快速检测，如果失败立即换代理
      let result = await scrapeUrlWithBrowser(url, effectiveProxyUrl, {
        waitForSelector: '#productTitle',
        waitForTimeout: quickTimeout,  // 🔥 优先快速失败，避免等120秒
        targetCountry,  // 🌍 传入目标国家
      })

      // ✅ 方案4修复: 如果检测到a-no-js失败，清理池并重试一次
      // 🔥 Bug修复: 使用正则表达式精确匹配<html>标签中的class属性，避免匹配JS/CSS中的字符串
      const htmlTagMatch = result.html?.match(/<html[^>]*class="([^"]*)"/)
      const htmlClasses = htmlTagMatch ? htmlTagMatch[1] : ''
      const hasRealNoJs = htmlClasses.includes('a-no-js') && !htmlClasses.includes('a-js')

      if (result.html && hasRealNoJs) {
        console.warn(`⚠️ 检测到<html>标签中有a-no-js类，页面JavaScript未正常执行`)
        console.warn(`🔍 <html>标签classes: ${htmlClasses.substring(0, 100)}...`)

        // 🔥 P1增强: 记录页面语言状态，帮助诊断语言不匹配问题
        const langMatch = result.html.match(/<html[^>]*lang="([^"]*)"/)
        const pageLang = langMatch ? langMatch[1] : '(未设置)'
        console.warn(`🌍 页面语言: ${pageLang} (目标国家: ${targetCountry})`)

        // 🔥 2025-12-11优化: 增加重试次数，a-no-js失败最多重试2次（使用不同代理IP）
        const maxNoJsRetries = 2
        for (let noJsRetry = 1; noJsRetry <= maxNoJsRetries; noJsRetry++) {
          console.warn(`🔄 a-no-js重试 ${noJsRetry}/${maxNoJsRetries}，清理代理缓存并使用新IP...`)

          // 清理代理IP缓存，强制获取新IP
          const { clearProxyCache } = await import('../proxy/fetch-proxy-ip')
          clearProxyCache(effectiveProxyUrl)
          console.log(`🧹 已清理代理IP缓存，下次将获取新IP`)

          // 清理连接池实例（确保不复用被标记的浏览器实例）
          const pool = getPlaywrightPool()
          await pool.clearIdleInstances()

          // 🔥 2025-12-11优化: 增加重试间隔，避免触发频率限制
          // 第一次重试等待3-5秒，第二次等待5-8秒
          const retryDelay = noJsRetry === 1
            ? 3000 + Math.random() * 2000
            : 5000 + Math.random() * 3000
          console.log(`⏰ 等待${Math.round(retryDelay)}ms后使用新代理IP重试...`)
          await new Promise(resolve => setTimeout(resolve, retryDelay))

          // 重新抓取（会自动获取新的代理IP）
          result = await scrapeUrlWithBrowser(url, effectiveProxyUrl, {
            waitForSelector: '#productTitle',
            waitForTimeout: quickTimeout,
            targetCountry,
          })

          // 检查重试结果
          const retryHtmlTagMatch = result.html?.match(/<html[^>]*class="([^"]*)"/)
          const retryHtmlClasses = retryHtmlTagMatch ? retryHtmlTagMatch[1] : ''
          const retryHasNoJs = retryHtmlClasses.includes('a-no-js') && !retryHtmlClasses.includes('a-js')

          // 🔥 P1增强: 记录重试后的页面语言状态
          const retryLangMatch = result.html?.match(/<html[^>]*lang="([^"]*)"/)
          const retryPageLang = retryLangMatch ? retryLangMatch[1] : '(未设置)'

          if (!retryHasNoJs) {
            console.log(`✅ a-no-js重试${noJsRetry}成功，<html>标签已正确包含a-js类`)
            console.log(`🌍 重试后页面语言: ${retryPageLang} (目标国家: ${targetCountry})`)
            break  // 成功，退出重试循环
          } else if (noJsRetry < maxNoJsRetries) {
            console.warn(`⚠️ a-no-js重试${noJsRetry}失败，继续重试...`)
            console.warn(`🔍 重试${noJsRetry}后classes: ${retryHtmlClasses.substring(0, 100)}...`)
            console.warn(`🌍 重试${noJsRetry}后语言: ${retryPageLang}`)
          } else {
            // 最后一次重试也失败
            console.error(`🚨 a-no-js重试${maxNoJsRetries}次后仍失败，Amazon反爬虫可能升级`)
            console.error(`🔍 最终classes: ${retryHtmlClasses.substring(0, 100)}...`)
            console.error(`🌍 最终语言: ${retryPageLang} (目标: ${targetCountry})`)
            console.error(`💡 建议: 检查代理IP质量，或稍后重试`)
          }
        }
      }

      // Parse HTML with cheerio
      const { load } = await import('cheerio')
      const $ = load(result.html)

      // Parse and return product data
      return parseAmazonProductHtml($, url, skipCompetitorExtraction)

    } catch (error: any) {
      lastError = error
      console.error(`❌ 抓取尝试 ${proxyAttempt + 1}/${maxProxyRetries + 1} 失败: ${error.message?.substring(0, 100)}`)

      // 如果是代理连接错误，尝试换新代理
      if (isProxyConnectionError(error)) {
        if (proxyAttempt < maxProxyRetries) {
          console.log(`🔄 检测到代理连接问题，准备换新代理重试...`)
          // 短暂延迟后重试
          await new Promise(resolve => setTimeout(resolve, 2000))
          continue  // ✅ 进入下一次代理重试循环
        } else {
          console.error(`❌ 已用尽所有代理重试次数 (${maxProxyRetries + 1}次)`)
          // ❌ 不要在这里throw，让循环自然结束，在外面统一抛出lastError
        }
      } else {
        // 🔥 非代理错误：立即失败，不继续重试
        console.error(`❌ 非代理错误，停止重试: ${error.message?.substring(0, 100)}`)
        throw error
      }
    }
  }

  // 所有代理重试都失败
  throw lastError || new Error('Amazon产品抓取失败：已用尽所有代理重试')
}

/**
 * 🔥 2025-12-12 内存优化: 复用已有BrowserContext抓取产品
 *
 * 用于深度抓取场景，避免每个商品都创建新浏览器实例
 * 内存节省: 从6个浏览器/Offer降低到1个浏览器/Offer
 *
 * @param context - 已有的BrowserContext（由调用方管理生命周期）
 * @param url - 产品URL
 * @param targetCountry - 目标国家
 * @param skipCompetitorExtraction - 是否跳过竞品提取
 */
export async function scrapeAmazonProductWithContext(
  context: BrowserContext,
  url: string,
  targetCountry?: string,
  skipCompetitorExtraction: boolean = true
): Promise<AmazonProductData> {
  console.log(`🛒 [复用Context] 抓取Amazon产品: ${url}`)

  const page = await context.newPage()

  try {
    // 配置stealth页面
    await configureStealthPage(page, targetCountry)

    // 导航前随机延迟（模拟人类行为）
    await randomDelay(300, 800)

    // 导航到产品页面
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })

    // 等待关键元素
    const productSelectors = [
      '#productTitle',
      'span[id="productTitle"]',
      '#title_feature_div h1',
      '#dp-container',
    ]

    let selectorFound = false
    for (const selector of productSelectors) {
      const found = await page.waitForSelector(selector, {
        timeout: 5000,
        state: 'visible'
      }).then(() => true).catch(() => false)

      if (found) {
        selectorFound = true
        break
      }
    }

    if (!selectorFound) {
      console.warn(`⚠️ [复用Context] 产品选择器未找到，继续尝试解析`)
    }

    // 智能等待页面加载
    await smartWaitForLoad(page, url, { maxWaitTime: 8000 }).catch(() => {})

    // 🔥 2025-12-12优化：分段滚动触发懒加载，确保feature-bullets加载
    // Amazon产品特性(About this item)通常在页面中下部，需要滚动触发懒加载
    // KISS原则：分两次滚动，覆盖更大范围
    const scrollDebug = await page.evaluate(() => {
      const results = { scrollPositions: [] as number[], featureBulletsFound: false }

      // 第一次滚动：到页面30%位置
      const scrollHeight = document.body.scrollHeight
      const firstScroll = scrollHeight * 0.3
      window.scrollTo(0, firstScroll)
      results.scrollPositions.push(firstScroll)

      return results
    }).catch(() => ({ scrollPositions: [], featureBulletsFound: false }))

    await randomDelay(1500, 2000)  // 等待第一段懒加载

    // 第二次滚动：到feature-bullets或页面50%位置
    const scrollResult = await page.evaluate(() => {
      const featureBullets = document.querySelector('#feature-bullets, #featurebullets_feature_div')
      if (featureBullets) {
        featureBullets.scrollIntoView({ behavior: 'instant', block: 'center' })
        return { found: true, method: 'scrollIntoView' }
      } else {
        // 滚动到页面50%位置
        const scrollHeight = document.body.scrollHeight
        window.scrollTo(0, scrollHeight * 0.5)
        return { found: false, method: 'scrollTo50%' }
      }
    }).catch(() => ({ found: false, method: 'error' }))

    console.log(`🔍 [复用Context] 滚动策略: ${scrollResult.method}, featureBulletsFound=${scrollResult.found}`)
    await randomDelay(2000, 3000)  // 🔥 增加等待时间: 800-1200ms → 2000-3000ms

    // 等待feature-bullets元素出现（最多等待5秒）
    const featureLoaded = await page.waitForSelector('#feature-bullets li, #featurebullets_feature_div li', {
      timeout: 5000,  // 🔥 增加超时: 3秒 → 5秒
      state: 'visible'
    }).then(() => true).catch(() => false)

    if (!featureLoaded) {
      console.warn(`⚠️ [复用Context] feature-bullets未加载，尝试第三次滚动到70%位置...`)
      // 🔥 2025-12-13 KISS优化：第三次滚动到页面70%位置，覆盖更多懒加载区域
      await page.evaluate(() => {
        const scrollHeight = document.body.scrollHeight
        window.scrollTo(0, scrollHeight * 0.7)
      }).catch(() => {})
      await randomDelay(2000, 2500)

      // 再次检查feature-bullets
      const retryLoaded = await page.waitForSelector('#feature-bullets li, #featurebullets_feature_div li', {
        timeout: 3000,
        state: 'visible'
      }).then(() => true).catch(() => false)

      if (retryLoaded) {
        console.log(`✅ [复用Context] 第三次滚动后feature-bullets已加载`)
      } else {
        console.warn(`⚠️ [复用Context] feature-bullets仍未加载，可能页面结构不同`)
      }
    } else {
      console.log(`✅ [复用Context] feature-bullets已加载`)
    }

    // 🔥 2025-12-13修复：当需要竞品ASIN时，额外滚动到页面底部触发竞品推荐懒加载
    // 竞品推荐区域通常在页面80%-100%位置，需要滚动触发
    if (!skipCompetitorExtraction) {
      console.log(`🔍 [复用Context] 需要竞品ASIN，额外滚动触发推荐区域懒加载...`)

      // 滚动到页面底部区域（分两步，确保懒加载触发）
      await page.evaluate(() => {
        const scrollHeight = document.body.scrollHeight
        window.scrollTo(0, scrollHeight * 0.85)
      }).catch(() => {})
      await randomDelay(1000, 1500)

      // 滚动到接近页面底部
      await page.evaluate(() => {
        const scrollHeight = document.body.scrollHeight
        window.scrollTo(0, scrollHeight * 0.95)
      }).catch(() => {})

      // 🔥 关键修复：等待网络空闲，确保竞品推荐区域的AJAX请求完成
      // 这是单品链接能拿到竞品数据、店铺场景拿不到的根本原因
      console.log(`⏳ [复用Context] 等待竞品推荐区域AJAX加载...`)
      try {
        await page.waitForLoadState('networkidle', { timeout: 5000 })
        console.log(`✅ [复用Context] 网络空闲，竞品推荐AJAX加载完成`)
      } catch {
        // 超时不是错误，继续处理
        console.log(`⚠️ [复用Context] 网络空闲等待超时，继续处理`)
      }
      await randomDelay(500, 1000)

      // 检查是否有竞品推荐区域加载
      const hasCompetitorSections = await page.evaluate(() => {
        const selectors = [
          '#HLCXComparisonTable',                    // Compare with similar items
          '#sp_detail',                               // Products related to this item
          '#sims-simsContainer_feature_div_01',       // Customers who viewed this
          '#aplus table',                             // A+ comparison table
          '[data-component-type="sp_detail"]',
          '#similarities_feature_div',
        ]
        for (const sel of selectors) {
          if (document.querySelector(sel)) return sel
        }
        return null
      }).catch(() => null)

      if (hasCompetitorSections) {
        console.log(`✅ [复用Context] 发现竞品推荐区域: ${hasCompetitorSections}`)
      } else {
        console.warn(`⚠️ [复用Context] 未发现竞品推荐区域，可能页面未包含或选择器需更新`)
      }
    }

    // 🔥 2025-12-16修复：等待评论区加载，确保topReviews数据可用
    // 问题：offer 150抓取时topReviews为空，导致后续评论分析无法执行
    console.log(`📝 [复用Context] 等待评论区加载...`)
    try {
      // 先滚动到评论区位置（通常在页面中下部）
      await page.evaluate(() => {
        const reviewSection = document.querySelector('#customer-reviews_feature_div') ||
                              document.querySelector('#reviews-medley-footer') ||
                              document.querySelector('#reviewsMedley')
        if (reviewSection) {
          reviewSection.scrollIntoView({ behavior: 'instant', block: 'center' })
        } else {
          // 没找到则滚动到80%位置
          window.scrollTo(0, document.body.scrollHeight * 0.8)
        }
      }).catch(() => {})
      await randomDelay(1500, 2000)

      // 等待评论元素出现
      const reviewLoaded = await page.waitForSelector('[data-hook="review"]', {
        timeout: 5000,
        state: 'visible'
      }).then(() => true).catch(() => false)

      if (reviewLoaded) {
        // 额外等待评论内容渲染
        await randomDelay(1000, 1500)
        console.log(`✅ [复用Context] 评论区已加载`)
      } else {
        console.warn(`⚠️ [复用Context] 评论区未加载，可能产品无评论或页面结构不同`)
      }
    } catch (reviewError: any) {
      console.warn(`⚠️ [复用Context] 评论区加载失败: ${reviewError.message}`)
    }

    // 模拟人类滚动回顶部
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
    await randomDelay(300, 500)

    // 获取HTML并解析
    const html = await page.content()
    const { load } = await import('cheerio')
    const $ = load(html)

    // 解析产品数据
    const productData = parseAmazonProductHtml($, url, skipCompetitorExtraction)

    console.log(`✅ [复用Context] 抓取成功: ${productData.productName?.substring(0, 50) || 'Unknown'}...`)

    return productData

  } finally {
    // 🔥 关键：确保Page在finally中关闭，防止内存泄漏
    await page.close().catch((e) => {
      console.warn(`⚠️ [复用Context] Page关闭失败: ${e.message}`)
    })
  }
}

/**
 * 🔥 P1优化: 从JSON-LD结构化数据提取产品信息（最稳定的数据源）
 * Amazon页面通常包含Schema.org格式的JSON-LD数据，比DOM选择器更稳定
 */
interface JsonLdProductData {
  name?: string
  brand?: string
  description?: string
  price?: string
  currency?: string
  rating?: string
  reviewCount?: string
  sku?: string  // ASIN
  image?: string[]
  availability?: string
  category?: string
}

function extractJsonLdData($: any): JsonLdProductData | null {
  const result: JsonLdProductData = {}
  let foundProduct = false

  try {
    // 遍历所有JSON-LD脚本标签
    $('script[type="application/ld+json"]').each((_i: number, el: any) => {
      try {
        const jsonText = $(el).html()
        if (!jsonText) return

        const data = JSON.parse(jsonText)

        // 处理数组格式（Amazon有时用@graph数组）
        const items = Array.isArray(data) ? data : (data['@graph'] || [data])

        for (const item of items) {
          // 检查是否是Product类型
          const itemType = item['@type']
          if (itemType === 'Product' || (Array.isArray(itemType) && itemType.includes('Product'))) {
            foundProduct = true

            // 提取产品名称
            if (item.name && !result.name) {
              result.name = item.name
            }

            // 提取品牌
            if (item.brand && !result.brand) {
              if (typeof item.brand === 'string') {
                result.brand = item.brand
              } else if (item.brand.name) {
                result.brand = item.brand.name
              }
            }

            // 提取描述
            if (item.description && !result.description) {
              result.description = item.description
            }

            // 提取SKU/ASIN
            if (item.sku && !result.sku) {
              result.sku = item.sku
            }
            if (item.productID && !result.sku) {
              result.sku = item.productID
            }

            // 提取图片
            if (item.image && !result.image) {
              if (Array.isArray(item.image)) {
                result.image = item.image.slice(0, 5)
              } else if (typeof item.image === 'string') {
                result.image = [item.image]
              }
            }

            // 提取类别
            if (item.category && !result.category) {
              result.category = item.category
            }

            // 提取价格（Offers结构）
            if (item.offers && !result.price) {
              const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers
              if (offers.price) {
                result.price = String(offers.price)
                result.currency = offers.priceCurrency || 'USD'
              }
              if (offers.availability) {
                // 简化availability URL为可读状态
                const availUrl = offers.availability
                if (availUrl.includes('InStock')) {
                  result.availability = 'In Stock'
                } else if (availUrl.includes('OutOfStock')) {
                  result.availability = 'Out of Stock'
                } else if (availUrl.includes('LimitedAvailability')) {
                  result.availability = 'Limited Availability'
                } else {
                  result.availability = availUrl.split('/').pop() || 'Unknown'
                }
              }
            }

            // 提取评分（AggregateRating结构）
            if (item.aggregateRating && !result.rating) {
              const aggRating = item.aggregateRating
              if (aggRating.ratingValue) {
                result.rating = String(aggRating.ratingValue)
              }
              if (aggRating.reviewCount) {
                result.reviewCount = String(aggRating.reviewCount)
              } else if (aggRating.ratingCount) {
                result.reviewCount = String(aggRating.ratingCount)
              }
            }
          }
        }
      } catch (parseError) {
        // 单个JSON-LD解析失败，继续处理其他标签
        console.warn(`⚠️ JSON-LD解析警告: ${(parseError as Error).message?.substring(0, 50)}`)
      }
    })

    if (foundProduct) {
      console.log(`✅ JSON-LD提取成功: ${result.name?.substring(0, 50) || 'Unknown'}...`)
      console.log(`   品牌: ${result.brand || 'N/A'}, 价格: ${result.price || 'N/A'} ${result.currency || ''}`)
      console.log(`   评分: ${result.rating || 'N/A'}, 评论数: ${result.reviewCount || 'N/A'}`)
      return result
    }
  } catch (error) {
    console.warn(`⚠️ JSON-LD整体提取失败: ${(error as Error).message?.substring(0, 100)}`)
  }

  return null
}

/**
 * Parse Amazon product HTML and extract data
 * @param skipCompetitorExtraction 跳过竞品ASIN提取（用于竞品详情页抓取，避免二级循环）
 */
function parseAmazonProductHtml($: any, url: string, skipCompetitorExtraction: boolean = false): AmazonProductData {
  // 🎯 核心优化：限定选择器范围到核心产品区域，避免抓取推荐商品

  // 检查元素是否在推荐区域
  // 🔥 2025-12-13修复：限制检查深度，避免检查到body/html等大容器导致误判
  // 问题：之前检查所有父元素的text，body包含整个页面文字，会误判所有元素都在推荐区域
  const isInRecommendationArea = (el: any): boolean => {
    const $el = $(el)
    const parents = $el.parents().toArray()

    // 🔥 关键修复：只检查最近的5层父元素，避免检查到body等大容器
    const maxDepth = Math.min(parents.length, 5)

    for (let i = 0; i < maxDepth; i++) {
      const parent = parents[i]
      const $parent = $(parent)
      const id = ($parent.attr('id') || '').toLowerCase()
      const className = ($parent.attr('class') || '').toLowerCase()

      // 🔥 修复：如果到达核心产品区域的已知安全容器，停止检查
      if (id === 'feature-bullets' || id === 'featurebullets_feature_div' ||
          id === 'centerCol' || id === 'ppd' || id === 'dp-container') {
        return false  // 在安全区域内，不是推荐区域
      }

      // 只检查ID和类名，不再检查整个text（text太大会误判）
      if (id.includes('sims') || id.includes('related') || id.includes('sponsored') ||
          id.includes('also-viewed') || id.includes('also-bought') ||
          className.includes('sims') || className.includes('related') || className.includes('sponsored') ||
          className.includes('also-viewed') || className.includes('also-bought')) {
        return true
      }
    }
    return false
  }

  // 🔥 P1优化: 首先提取JSON-LD结构化数据作为可靠的备份数据源
  const jsonLdData = extractJsonLdData($)

  // Extract product features - 限定在核心产品区域
  // 🔥 2025-12-12优化：增加移动版选择器支持
  const features: string[] = []
  const featureSelectors = [
    // === 桌面版选择器 ===
    '#ppd #feature-bullets li',
    '#centerCol #feature-bullets li',
    '#dp-container #feature-bullets li',
    '#feature-bullets li:not([id*="sims"]):not([class*="sims"])',  // 排除sims相关
    '#featurebullets_feature_div li',
    // === 移动版选择器 (a-m-* 页面) ===
    '[data-feature-name="featurebullets"] li',
    '.a-unordered-list.a-vertical.a-spacing-mini li',
    '#feature-bullets ul li',
    // === About this item 专用选择器 ===
    '[data-cel-widget*="feature-bullets"] li',
    '#productFactsDesktop ul li',
    '[data-csa-c-slot-id="productDetails_feature_div"] li',
  ]

  // 检查feature-bullets元素
  const featureBulletsExists = $('#feature-bullets').length > 0
  const featureBulletsLiCount = $('#feature-bullets li').length
  const featureBulletsDivExists = $('#featurebullets_feature_div').length > 0

  // 仅在异常情况下输出调试信息
  if (featureBulletsExists && featureBulletsLiCount === 0) {
    console.log(`⚠️ feature-bullets元素存在但li为空，可能需要检查页面结构`)
  }

  for (const selector of featureSelectors) {
    if (features.length >= 10) break  // 限制最多10个特点

    $(selector).each((i: number, el: any) => {
      if (features.length >= 10) return false

      // 跳过推荐区域
      if (isInRecommendationArea(el)) {
        return
      }

      const text = $(el).text().trim()
      // 过滤短文本和重复文本
      if (text && text.length <= 10) {
        return
      }
      if (text && features.includes(text)) {
        return
      }
      if (text && text.length > 10) {
        features.push(text)
      }
    })
  }

  // 记录features提取结果
  if (features.length > 0) {
    console.log(`📝 产品特性提取成功: ${features.length} 条 (前50字: ${features[0]?.substring(0, 50)}...)`)
  } else {
    console.warn(`⚠️ 产品特性提取为空，可能页面结构变化或懒加载未完成`)
  }

  // ========== 图片提取已移除 ==========
  // 📝 说明：Google Search Ads仅显示文本（标题、描述、链接、附加信息），不展示图片
  // 因此移除了imageUrls提取逻辑，降低抓取复杂度和数据冗余
  const imageUrls: string[] = [] // 保留空数组以维持接口兼容性

  // Extract rating and review count - 支持桌面版和移动版
  const ratingText = $('#acrPopover').attr('title') ||
                     $('span[data-hook="rating-out-of-text"]').text().trim() ||
                     $('.a-icon-star span').first().text().trim() ||
                     // === 移动版选择器 (a-m-* 页面) ===
                     $('[data-hook="cr-state-object"]').attr('data-state')?.match(/"averageStarRating":([\d.]+)/)?.[1] ||
                     $('.a-icon-alt').first().text().trim() ||
                     $('i.a-icon-star-medium + span').text().trim()
  const rating = ratingText ? ratingText.match(/[\d.]+/)?.[0] || null : null

  const reviewCountText = $('#acrCustomerReviewText').text().trim() ||
                          $('span[data-hook="total-review-count"]').text().trim() ||
                          // === 移动版选择器 (a-m-* 页面) ===
                          $('[data-hook="cr-state-object"]').attr('data-state')?.match(/"totalReviewCount":(\d+)/)?.[1] ||
                          $('a[href*="customerReviews"]').text().trim() ||
                          $('.a-link-normal[href*="reviews"]').first().text().trim()
  const reviewCount = reviewCountText ? reviewCountText.match(/[\d,]+/)?.[0]?.replace(/,/g, '') || null : null

  // Extract sales rank
  const salesRankText = $('#productDetails_detailBullets_sections1 tr:contains("Best Sellers Rank")').text().trim() ||
                        $('#SalesRank').text().trim() ||
                        $('th:contains("Best Sellers Rank")').next().text().trim()
  const salesRank = salesRankText ? salesRankText.match(/#[\d,]+/)?.[0] || null : null

  // 🎯 P3优化: Extract badge (Amazon's Choice, Best Seller, etc.) - 支持桌面版和移动版
  let badge: string | null = null

  // Strategy 1: Amazon's Choice badge (最常见)
  const amazonChoiceBadge = $('.ac-badge-wrapper .ac-badge-text-primary').text().trim() ||
                            $('span.a-badge-text:contains("Amazon\'s Choice")').text().trim() ||
                            $('[data-a-badge-color="sx-gulfstream"] span.a-badge-text').text().trim() ||
                            // === 移动版选择器 (a-m-* 页面) ===
                            $('[data-feature-name="acBadge"] .a-badge-text').text().trim() ||
                            $('i.a-icon-ac').parent().text().trim()

  // Strategy 2: Best Seller badge (从多个位置检测)
  const bestSellerBadge = $('#zeitgeist-module .a-badge-text').text().trim() ||
                          $('.badge-wrapper .badge-text:contains("Best Seller")').text().trim() ||
                          $('span:contains("#1 Best Seller")').first().text().trim() ||
                          // === 移动版选择器 (a-m-* 页面) ===
                          $('[data-feature-name="zeitgeist"] .a-badge-text').text().trim() ||
                          $('i.a-icon-bestseller').parent().text().trim()

  // Strategy 3: Generic badge detection (捕获其他badge)
  const genericBadge = $('.a-badge-text').first().text().trim() ||
                       $('i.a-icon-addon-badge').parent().text().trim() ||
                       // === 移动版选择器 (a-m-* 页面) ===
                       $('[data-component-type="badge"]').text().trim()

  // 优先级: Amazon's Choice > Best Seller > Generic
  if (amazonChoiceBadge) {
    badge = amazonChoiceBadge.includes("Amazon's Choice") ? "Amazon's Choice" : amazonChoiceBadge
  } else if (bestSellerBadge) {
    // 规范化Best Seller badge文本
    if (bestSellerBadge.match(/#\d+\s+Best Seller/i)) {
      const match = bestSellerBadge.match(/(#\d+\s+Best Seller)/i)
      badge = match ? match[1] : "Best Seller"
    } else if (bestSellerBadge.toLowerCase().includes('best seller')) {
      badge = "Best Seller"
    }
  } else if (genericBadge && genericBadge.length > 0 && genericBadge.length <= 25) {
    // Generic badge限制长度≤25字符（符合Google Ads Callouts要求）
    badge = genericBadge
  }

  // 验证badge质量（移除噪音）
  if (badge) {
    badge = badge.trim()
    // 移除category信息（如"Amazon's Choice for security cameras" → "Amazon's Choice"）
    if (badge.includes(' for ') || badge.includes(' in ')) {
      badge = badge.split(' for ')[0].split(' in ')[0].trim()
    }
    // 最终长度验证
    if (badge.length > 25 || badge.length === 0) {
      badge = null
    }
  }

  // Extract availability - 支持桌面版和移动版
  // 🔥 2025-12-10优化：避免#availability包含JavaScript代码污染的问题
  // 优先使用更精确的选择器，按可靠性顺序排列
  const availability = (() => {
    // 策略1: 使用颜色类选择器（最可靠，避免JS代码）
    const colorPrice = $('#availability .a-color-price').first().text().trim()
    if (colorPrice && colorPrice.length < 200) return colorPrice

    const colorSuccess = $('#availability .a-color-success').first().text().trim()
    if (colorSuccess && colorSuccess.length < 200) return colorSuccess

    const colorState = $('#availability .a-color-state').first().text().trim()
    if (colorState && colorState.length < 200) return colorState

    // 策略2: #outOfStock 区域（缺货商品）
    const outOfStock = $('#outOfStock').first().text().trim()
    if (outOfStock && outOfStock.length > 5 && outOfStock.length < 200) {
      // 清理多余空白和换行
      return outOfStock.replace(/\s+/g, ' ').split('Deliver to')[0].trim()
    }

    // 策略3: 直接子span（过滤掉script标签的文本）
    const directSpan = $('#availability > span').first().text().trim()
    if (directSpan && directSpan.length > 5 && directSpan.length < 200 && !directSpan.includes('function')) {
      return directSpan
    }

    // === 移动版选择器 (a-m-* 页面) ===
    const deliveryMsg = $('#deliveryMessage_feature_div').text().trim()
    if (deliveryMsg && deliveryMsg.length < 200) return deliveryMsg

    const deliveryPrice = $('[data-csa-c-delivery-price]').text().trim()
    if (deliveryPrice && deliveryPrice.length < 200) return deliveryPrice

    const mirLayout = $('#mir-layout-DELIVERY_BLOCK').text().trim()
    if (mirLayout && mirLayout.length < 200) return mirLayout

    return null
  })()

  // Check Prime eligibility - 支持桌面版和移动版
  const primeEligible = $('#primeEligibilityMessage').length > 0 ||
                        $('.a-icon-prime').length > 0 ||
                        $('[data-feature-name="primeEligible"]').length > 0 ||
                        // === 移动版选择器 (a-m-* 页面) ===
                        $('i.a-icon-prime-m').length > 0 ||
                        $('[data-action="show-prime-delivery"]').length > 0 ||
                        $('span:contains("FREE Prime")').length > 0

  // Extract review highlights
  const reviewHighlights: string[] = []
  $('[data-hook="lighthut-term"]').each((i: number, el: any) => {
    const text = $(el).text().trim()
    if (text) reviewHighlights.push(text)
  })
  // Also try to get from review summary
  $('p[data-hook="review-collapsed"], span[data-hook="review-body"]').slice(0, 3).each((i: number, el: any) => {
    const text = $(el).text().trim().substring(0, 200)
    if (text && text.length > 20) reviewHighlights.push(text)
  })

  // Extract top reviews
  // 🔥 2025-12-16修复：过滤掉未渲染的JavaScript代码
  const topReviews: string[] = []
  $('[data-hook="review"]').slice(0, 5).each((i: number, el: any) => {
    let reviewText = $(el).find('[data-hook="review-body"]').text().trim().substring(0, 300)
    const reviewTitle = $(el).find('[data-hook="review-title"]').text().trim()
    const reviewRating = $(el).find('.a-icon-star').text().trim()

    // 过滤掉包含JavaScript代码的无效评论内容
    if (reviewText && reviewText.includes('function()') || reviewText.includes('P.when(')) {
      console.log(`⚠️ 跳过未渲染的评论: ${reviewText.substring(0, 50)}...`)
      reviewText = ''  // 清空无效内容
    }

    // 清理评论标题中的重复评分信息
    let cleanTitle = reviewTitle
    if (cleanTitle.includes('out of 5 stars')) {
      // 移除标题开头的评分信息（如 "5.0 out of 5 stars\n\n\n\n..."）
      cleanTitle = cleanTitle.replace(/^[\d.]+\s*out of 5 stars[\s\n]*/, '').trim()
    }

    if (reviewText && !reviewText.includes('function')) {
      topReviews.push(`${reviewRating} - ${cleanTitle}: ${reviewText}`)
    }
  })

  // 🔥 P2优化: 提取评论关键词/主题（Amazon Review Topics，用于广告创意）
  const reviewKeywords: string[] = []

  // 策略1: 从"Read reviews that mention"部分提取
  $('[data-hook="lighthut-term"], .cr-lighthouse-term, [data-hook="review-filter-tag"]').each((_i: number, el: any) => {
    const keyword = $(el).text().trim().toLowerCase()
    if (keyword && keyword.length >= 2 && keyword.length <= 30 && !reviewKeywords.includes(keyword)) {
      reviewKeywords.push(keyword)
    }
  })

  // 策略2: 从评论标签/过滤器提取
  if (reviewKeywords.length === 0) {
    $('.cr-vote-buttons + span, [data-hook="review-filter"], .a-declarative[data-action="reviews:filter"]').each((_i: number, el: any) => {
      const keyword = $(el).text().trim().toLowerCase()
      if (keyword && keyword.length >= 2 && keyword.length <= 30 && !reviewKeywords.includes(keyword)) {
        reviewKeywords.push(keyword)
      }
    })
  }

  // 策略3: 从AI评论摘要中提取关键特征（如果有）
  const aiSummary = $('[data-hook="cr-product-feedback"], #cr-product-feedback').text().trim()
  if (aiSummary && aiSummary.length > 20) {
    // 提取常见的产品属性关键词
    const attributePatterns = [
      /quality/gi, /value/gi, /price/gi, /easy to use/gi, /setup/gi,
      /durable/gi, /performance/gi, /design/gi, /size/gi, /comfort/gi,
      /noise/gi, /battery/gi, /speed/gi, /material/gi, /sturdy/gi,
    ]
    for (const pattern of attributePatterns) {
      if (pattern.test(aiSummary)) {
        const keyword = pattern.source.replace(/\\s/g, ' ').toLowerCase()
        if (!reviewKeywords.includes(keyword)) {
          reviewKeywords.push(keyword)
        }
      }
    }
  }

  if (reviewKeywords.length > 0) {
    console.log(`🏷️ 评论关键词: ${reviewKeywords.slice(0, 5).join(', ')}${reviewKeywords.length > 5 ? '...' : ''}`)
  }

  // Extract technical details - 支持桌面版和移动版
  const technicalDetails: Record<string, string> = {}
  // === 桌面版选择器 ===
  $('#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr').each((i: number, el: any) => {
    const key = $(el).find('th').text().trim()
    const value = $(el).find('td').text().trim()
    if (key && value && key !== 'Customer Reviews' && key !== 'Best Sellers Rank') {
      technicalDetails[key] = value
    }
  })
  // Also try detail bullets format
  $('#detailBullets_feature_div li').each((i: number, el: any) => {
    const text = $(el).text().trim()
    const match = text.match(/^([^:]+):\s*(.+)$/)
    if (match) {
      technicalDetails[match[1].trim()] = match[2].trim()
    }
  })
  // === 移动版选择器 (a-m-* 页面) ===
  $('#productDetails_feature_div tr, #tech-specs-desktop tr').each((i: number, el: any) => {
    const key = $(el).find('th, .a-text-bold').first().text().trim()
    const value = $(el).find('td, .a-text-normal').last().text().trim()
    if (key && value && !technicalDetails[key]) {
      technicalDetails[key] = value
    }
  })
  // 🔥 2025-12-10优化：Product Overview表格提取（包含带图标的属性）
  // 使用.a-text-bold和.po-break-word精确分离label和value
  $('#productOverview_feature_div tr, #poExpander tr').each((i: number, el: any) => {
    // 跳过嵌套表格的父行（cellCount > 2 表示是包含嵌套表格的容器行）
    const directCells = $(el).children('td')
    if (directCells.length > 2) return  // 跳过容器行，让内部的tr处理

    // 使用.first()确保只获取第一个匹配元素
    const keyEl = $(el).find('.a-text-bold').first()
    const valueEl = $(el).find('.po-break-word').first()

    const key = keyEl.text().trim()
    const value = valueEl.text().trim()

    // 验证key和value是有效的（避免重复和空值）
    if (key && value && key !== value && !technicalDetails[key] && key.length < 50) {
      technicalDetails[key] = value
    }
  })

  // Extract ASIN - 使用cleanAsin确保格式正确
  const rawAsin = url.match(/\/dp\/([A-Z0-9]+)/)?.[1] ||
               $('input[name="ASIN"]').val()?.toString() ||
               $('th:contains("ASIN")').next().text().trim() ||
               null
  const asin = cleanAsin(rawAsin)

  // Extract category/breadcrumb - 支持桌面版和移动版
  const categoryParts: string[] = []
  // === 桌面版选择器 ===
  $('#wayfinding-breadcrumbs_feature_div li a').each((i: number, el: any) => {
    const text = $(el).text().trim()
    if (text) categoryParts.push(text)
  })
  // === 移动版选择器 (a-m-* 页面) ===
  if (categoryParts.length === 0) {
    $('[data-feature-name="wayfinding-breadcrumbs"] a, .a-breadcrumb a').each((i: number, el: any) => {
      const text = $(el).text().trim()
      if (text) categoryParts.push(text)
    })
  }
  const category = categoryParts.join(' > ') || null

  // 🎯 优化品牌名提取 - 多源策略应对反爬虫（提前提取用于竞品过滤）
  let brandName: string | null = extractBrandName($, url, null, technicalDetails)

  // 🔥 KISS优化（2025-12-09）：只提取候选ASIN，品牌过滤移到详情页抓取后进行
  // 原因：列表页的品牌提取不可靠（颜色/尺寸词被误识别为品牌）
  const relatedAsins: string[] = []

  // 🛡️ 如果是竞品详情页抓取，跳过竞品ASIN提取（避免"竞品的竞品"循环）
  if (skipCompetitorExtraction) {
    console.log(`⏭️ 跳过竞品ASIN提取（skipCompetitorExtraction=true）`)
  } else {
    // 🔥 2025-12-12优化：精确竞品提取策略
    // 核心原则：只提取真正的竞品，排除配件/耗材/经常一起购买
    console.log(`🔍 开始精确竞品ASIN提取...`)

    // ========== 🎯 优先级0（最高）: A+内容比较表格 ==========
    // 品牌官方的竞品对比，最具参考价值
    const aplusCompetitors: string[] = []
    $('#aplus table [data-asin], #aplus [data-csa-c-item-id]').each((_i: number, el: any) => {
      if (aplusCompetitors.length >= 5) return false
      const dataAsin = $(el).attr('data-asin')
      const csaItemId = $(el).attr('data-csa-c-item-id')
      let competitorAsin: string | null = null

      // 使用cleanAsin确保ASIN格式正确（防止deal后缀等问题）
      if (dataAsin) {
        competitorAsin = cleanAsin(dataAsin)
      } else if (csaItemId && csaItemId.startsWith('amzn1.asin.')) {
        competitorAsin = cleanAsin(csaItemId.replace('amzn1.asin.', ''))
      }

      if (competitorAsin && competitorAsin !== asin && !aplusCompetitors.includes(competitorAsin)) {
        aplusCompetitors.push(competitorAsin)
        console.log(`  📊 A+比较表格竞品: ${competitorAsin}`)
      }
    })
    relatedAsins.push(...aplusCompetitors)
    if (aplusCompetitors.length > 0) {
      console.log(`✅ A+比较表格: 找到 ${aplusCompetitors.length} 个官方竞品`)
    }

    // ========== 🎯 优先级1: "Compare with similar items" 官方对比表格 ==========
    if (relatedAsins.length < 10) {
      $('#HLCXComparisonTable [data-asin], [data-feature-name="comparison"] [data-asin]').each((_i: number, el: any) => {
        if (relatedAsins.length >= 10) return false
        const dataAsin = $(el).attr('data-asin')
        const cleanedAsin = cleanAsin(dataAsin)
        if (cleanedAsin && cleanedAsin !== asin && !relatedAsins.includes(cleanedAsin)) {
          relatedAsins.push(cleanedAsin)
        }
      })
    }

    // ========== 🎯 优先级2: "Products related to this item" ==========
    if (relatedAsins.length < 10) {
      const relatedSelectors = [
        '#sp_detail .a-carousel-card a[href*="/dp/"]',
        '[data-component-type="sp_detail"] .a-carousel-card a[href*="/dp/"]',
        '#similarities_feature_div a[href*="/dp/"]',
        '[data-feature-name="similarities"] a[href*="/dp/"]',
        // 🔥 2025-12-13新增：更多Amazon推荐区域选择器
        '#sp_detail2 a[href*="/dp/"]',                            // 第二个推荐区域
        '[data-component-type="sp_detail2"] a[href*="/dp/"]',
        '#sponsored-products-detail a[href*="/dp/"]',             // 赞助商品
        '.a-carousel-container a[href*="/dp/"]',                  // 通用轮播
      ]
      for (const selector of relatedSelectors) {
        $(selector).each((_i: number, el: any) => {
          if (relatedAsins.length >= 10) return false
          const href = $(el).attr('href') || ''
          const asinMatch = href.match(/\/dp\/([A-Z0-9]{10})/)
          if (asinMatch && asinMatch[1] !== asin && !relatedAsins.includes(asinMatch[1])) {
            relatedAsins.push(asinMatch[1])
          }
        })
        if (relatedAsins.length >= 10) break
      }
    }

    // ========== 🎯 优先级3: "Customers who viewed this item also viewed" ==========
    if (relatedAsins.length < 10) {
      const viewedSelectors = [
        '#sims-simsContainer_feature_div_01 a[href*="/dp/"]',
        '[data-csa-c-slot-id="sims_viewed"] a[href*="/dp/"]',
        '#sims-simsContainer_feature_div_11 a[href*="/dp/"]',
        // 🔥 2025-12-13新增：更多浏览历史相关选择器
        '#sims-consolidated-1_feature_div a[href*="/dp/"]',       // 合并的推荐区域
        '#sims-consolidated-2_feature_div a[href*="/dp/"]',
        '[data-component-type="s-product-image"] a[href*="/dp/"]', // 产品图片链接
        '#rhf-container a[href*="/dp/"]',                          // 相关历史记录
        '#day0-sims-feature a[href*="/dp/"]',                      // 当日推荐
      ]
      for (const selector of viewedSelectors) {
        $(selector).each((_i: number, el: any) => {
          if (relatedAsins.length >= 10) return false
          const href = $(el).attr('href') || ''
          const asinMatch = href.match(/\/dp\/([A-Z0-9]{10})/)
          if (asinMatch && asinMatch[1] !== asin && !relatedAsins.includes(asinMatch[1])) {
            relatedAsins.push(asinMatch[1])
          }
        })
        if (relatedAsins.length >= 10) break
      }
    }

    // ========== 🚫 排除非竞品区域 ==========
    // 不从以下区域提取：配件、耗材、经常一起购买
    const excludedContainers = [
      '#sims-fbt',                    // "Frequently bought together" - 配件/耗材
      '#purchase-sims-feature',        // "Customers who bought this also bought" - 可能是配件
      '#session-sims-feature',
      '[data-component-type="sp_accessory"]',  // 配件推荐
      '#warranties_and_support',       // 保修服务
      '#addon-selector',               // 加购选项
    ]

    // ========== 🔄 Fallback: data-asin全局搜索（排除非竞品区域）==========
    if (relatedAsins.length < 5) {
      console.log(`🔄 精确提取不足（${relatedAsins.length}个），启用Fallback策略...`)

      // 构建排除选择器
      const excludeSelector = excludedContainers.join(', ')
      const excludeElements = $(excludeSelector).find('[data-asin]')
      const excludedAsins = new Set<string>()
      excludeElements.each((_i: number, el: any) => {
        const exAsin = $(el).attr('data-asin')
        if (exAsin) excludedAsins.add(exAsin)
      })

      // 从推荐区域提取（排除核心商品区域和非竞品区域）
      const coreProductSelectors = '#ppd, #dp-container, #centerCol, #rightCol, #buybox'
      $('[data-asin]')
        .not($(coreProductSelectors).find('[data-asin]'))
        .not($(excludeSelector).find('[data-asin]'))
        .each((_i: number, el: any) => {
          if (relatedAsins.length >= 10) return false
          const dataAsin = $(el).attr('data-asin')
          const cleanedAsin = cleanAsin(dataAsin)
          if (cleanedAsin && cleanedAsin !== asin && !relatedAsins.includes(cleanedAsin) && !excludedAsins.has(dataAsin || '')) {
            relatedAsins.push(cleanedAsin)
          }
        })
    }

    console.log(`🔥 精确竞品提取完成: ${relatedAsins.length} 个候选（A+:${aplusCompetitors.length}）`)
  }

  // Extract prices - 支持桌面版和移动版
  // 🔧 修复（2026-02-21）：
  // 1) 避免误抓分期/月供价格（如 "$37.95/mo"）
  // 2) 当DOM价格与JSON-LD价格明显冲突时，优先结构化JSON-LD价格
  const installmentContextPattern = /(\/\s*(mo|month)\b|per\s*month|monthly|installment|affirm|klarna|afterpay|payment plan)/i
  const installmentContainerSelector = [
    '[id*="installment" i]',
    '[class*="installment" i]',
    '[data-cel-widget*="installment" i]',
    '#twisterPlusPriceSavingsStylePoi_feature_div',
    '#installmentCalculator_feature_div',
  ].join(', ')

  const currentPriceSelectors = [
    '#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen',
    '#corePrice_feature_div .priceToPay .a-offscreen',
    '#priceblock_dealprice',
    '#priceblock_ourprice',
    '#price_inside_buybox',
    '#corePrice_feature_div .a-price .a-offscreen',
    '#apex_offerDisplay_mobile .priceToPay .a-offscreen',
    '#apex_offerDisplay_mobile .a-price .a-offscreen',
    '[data-a-color="price"] .a-offscreen',
    '.priceToPay .a-offscreen',
    '.a-price .a-offscreen',
  ]

  const priceCandidates: Array<{ selector: string; value: string; isInstallment: boolean }> = []
  for (const selector of currentPriceSelectors) {
    let foundNonInstallment = false
    $(selector).each((_i: number, el: any) => {
      const value = $(el).text().trim()
      if (!value) return
      const contextText = [
        value,
        $(el).parent().text(),
        $(el).closest('[id], [class]').first().text(),
      ].join(' ').replace(/\s+/g, ' ')
      const hasInstallmentContainer = $(el).closest(installmentContainerSelector).length > 0
      const isInstallment = hasInstallmentContainer || installmentContextPattern.test(contextText)
      priceCandidates.push({ selector, value, isInstallment })
      if (!isInstallment) {
        foundNonInstallment = true
        return false
      }
      return
    })
    if (foundNonInstallment) break
  }

  const currentPrice = priceCandidates.find((c) => !c.isInstallment)?.value ||
    priceCandidates[0]?.value ||
    null

  const originalPrice = $('.a-price[data-a-strike="true"] .a-offscreen').text().trim() ||
                        $('.priceBlockStrikePriceString').text().trim() ||
                        // === 移动版选择器 (a-m-* 页面) ===
                        $('.basisPrice .a-offscreen').text().trim() ||
                        $('[data-a-strike="true"] .a-offscreen').first().text().trim() ||
                        null

  const discount = $('.savingsPercentage').text().trim() ||
                   $('[data-hook="price-above-strike"] span').text().trim() ||
                   // === 移动版选择器 (a-m-* 页面) ===
                   $('.savingPriceOverride').text().trim() ||
                   $('[data-a-color="price"] .a-text-price').text().trim() ||
                   null

  // 🎯 优化产品名称提取 - 按优先级尝试核心产品区域（包含桌面版和移动版）
  const titleSelectors = [
    // === 桌面版选择器 ===
    '#ppd #productTitle',
    '#centerCol #productTitle',
    '#dp-container #productTitle',
    '#productTitle',
    // === 移动版选择器 (a-m-us页面) ===
    '#title_feature_div h1 span',
    '#title_feature_div span.a-text-bold',
    '#title span.a-text-bold',
    '#title',
    '[data-hook="product-title"]',
    '.a-size-large.a-text-bold',
  ]
  let productName: string | null = null
  for (const selector of titleSelectors) {
    const title = $(selector).text().trim()
    if (title && title.length > 5) {
      productName = title
      break
    }
  }

  // Fallback: some Amazon variants omit #productTitle but still provide SEO title metadata.
  if (!productName) {
    const rawDocTitle =
      $('meta[name="title"]').attr('content')?.trim() ||
      $('title').first().text().trim() ||
      ''

    if (rawDocTitle) {
      const normalizedTitle = rawDocTitle
        .replace(/^Amazon\.[^:]+:\s*/i, '')
        .replace(/\s*:\s*[^:]+$/, '')
        .trim()

      if (normalizedTitle.length > 5) {
        productName = normalizedTitle
      }
    }
  }

  // 🎯 优化产品描述提取 - 限定在核心产品区域（包含桌面版和移动版）
  const descriptionSelectors = [
    // === 桌面版选择器 ===
    '#ppd #feature-bullets',
    '#centerCol #feature-bullets',
    '#dp-container #feature-bullets',
    '#ppd .a-expander-content',
    '#centerCol .a-expander-content',
    '#dp-container .a-expander-content',
    '#feature-bullets',
    '#productDescription',
    '[data-feature-name="featurebullets"]',
    // === 移动版选择器 (a-m-us页面) ===
    '#featurebullets_feature_div',
    '[data-hook="product-description"]',
    '#aplus_feature_div',
  ]
  let productDescription: string | null = null
  for (const selector of descriptionSelectors) {
    const $el = $(selector)
    if ($el.length > 0 && !isInRecommendationArea($el[0])) {
      const desc = $el.text().trim()
      if (desc && desc.length > 20) {
        productDescription = desc
        break
      }
    }
  }

  // Fallback: prefer metadata description instead of unrelated recommendation blocks.
  if (!productDescription) {
    const metaDescription =
      $('meta[name="description"]').attr('content')?.trim() ||
      $('meta[property="og:description"]').attr('content')?.trim() ||
      null

    if (metaDescription && metaDescription.length > 20) {
      productDescription = metaDescription
    }
  }

  // 品牌名已在前面提取（用于竞品过滤），这里可以使用productName进一步验证
  if (!brandName) {
    brandName = extractBrandName($, url, productName, technicalDetails)
  }

  // 🔥 P1优化: 使用JSON-LD数据作为备份（当DOM选择器失败时）
  const finalProductName = productName || jsonLdData?.name || null
  const finalBrandName = brandName || jsonLdData?.brand || null
  const finalRating = rating || jsonLdData?.rating || null
  const finalReviewCount = reviewCount || jsonLdData?.reviewCount || null
  const finalAvailability = availability || jsonLdData?.availability || null
  const finalCategory = category || jsonLdData?.category || null
  const finalAsin = asin || jsonLdData?.sku || null

  const jsonLdPrice = jsonLdData?.price
    ? (jsonLdData.currency ? `${jsonLdData.currency} ${jsonLdData.price}` : jsonLdData.price)
    : null

  let finalPrice = currentPrice || jsonLdPrice
  const selectedDomCandidate = priceCandidates.find((c) => c.value === currentPrice) || null
  const domPriceAmount = parsePrice(currentPrice)
  const jsonLdPriceAmount = parsePrice(jsonLdPrice)

  if (selectedDomCandidate?.isInstallment && jsonLdPrice) {
    console.warn(`⚠️ 检测到疑似分期价格候选 (${currentPrice})，回退到JSON-LD价格 (${jsonLdPrice})`)
    finalPrice = jsonLdPrice
  } else if (
    currentPrice &&
    jsonLdPrice &&
    domPriceAmount !== null &&
    jsonLdPriceAmount !== null &&
    jsonLdPriceAmount > 0
  ) {
    const deviationRatio = Math.abs(domPriceAmount - jsonLdPriceAmount) / jsonLdPriceAmount
    if (deviationRatio > 0.35) {
      const deviationPercent = Math.round(deviationRatio * 100)
      console.warn(`⚠️ DOM价格与JSON-LD价格偏差过大 (${deviationPercent}%)，回退到JSON-LD价格。DOM=${currentPrice}, JSON-LD=${jsonLdPrice}`)
      finalPrice = jsonLdPrice
    }
  }

  // 记录JSON-LD备份使用情况
  const jsonLdFallbacks: string[] = []
  if (!productName && jsonLdData?.name) jsonLdFallbacks.push('name')
  if (!brandName && jsonLdData?.brand) jsonLdFallbacks.push('brand')
  if (!rating && jsonLdData?.rating) jsonLdFallbacks.push('rating')
  if (!reviewCount && jsonLdData?.reviewCount) jsonLdFallbacks.push('reviewCount')
  if (!availability && jsonLdData?.availability) jsonLdFallbacks.push('availability')
  if (!currentPrice && jsonLdData?.price) jsonLdFallbacks.push('price')
  if (selectedDomCandidate?.isInstallment && jsonLdData?.price) jsonLdFallbacks.push('price-installment-guard')

  if (jsonLdFallbacks.length > 0) {
    console.log(`📋 JSON-LD备份字段: ${jsonLdFallbacks.join(', ')}`)
  }

  const productData: AmazonProductData = {
    productName: finalProductName,
    rawProductTitle: finalProductName,
    rawAboutThisItem: features.slice(0, 10),
    productDescription,
    productPrice: finalPrice,
    originalPrice,
    discount,
    brandName: finalBrandName ? normalizeBrandName(finalBrandName) : null,
    features,
    aboutThisItem: features,  // Amazon #feature-bullets 就是 "About this item"
    imageUrls: Array.from(new Set(imageUrls)).slice(0, 5),
    rating: finalRating,
    reviewCount: finalReviewCount,
    salesRank,
    badge,  // 🎯 P3优化: Amazon trust badge
    availability: finalAvailability,
    primeEligible,
    reviewHighlights: reviewHighlights.slice(0, 10),
    topReviews: topReviews.slice(0, 5),
    technicalDetails,
    asin: finalAsin,
    category: finalCategory,
    relatedAsins,  // 🔥 新增：竞品ASIN列表
    // 🔥 P2优化: 评论关键词（用于广告创意）
    reviewKeywords: reviewKeywords.slice(0, 15),  // 最多15个关键词
  }

  console.log(`✅ 抓取成功: ${productData.productName || 'Unknown'}`)
  console.log(`⭐ 评分: ${finalRating || 'N/A'}, 评论数: ${finalReviewCount || 'N/A'}, 销量排名: ${salesRank || 'N/A'}`)
  console.log(`🎯 P3 Badge: ${badge || 'None'}`)  // P3优化: 显示badge提取结果

  return productData
}

/**
 * Extract brand name using multiple strategies with cross-validation
 * 🔥 2025-12-12重构：多渠道交叉验证，提高品牌提取准确性
 */
function extractBrandName(
  $: any,
  url: string,
  productName: string | null,
  technicalDetails: Record<string, string>
): string | null {
  // 🔥 多渠道收集品牌名候选
  interface BrandCandidate {
    value: string
    source: string
    confidence: number  // 1-5, 5 = 最高置信度
  }
  const candidates: BrandCandidate[] = []

  // 检查元素是否在推荐区域
  // 🔥 2025-12-13修复：限制检查深度，避免检查到body/html等大容器导致误判
  const isInRecommendationArea = (el: any): boolean => {
    const $el = $(el)
    const parents = $el.parents().toArray()

    // 🔥 关键修复：只检查最近的5层父元素，避免检查到body等大容器
    const maxDepth = Math.min(parents.length, 5)

    for (let i = 0; i < maxDepth; i++) {
      const parent = parents[i]
      const $parent = $(parent)
      const id = ($parent.attr('id') || '').toLowerCase()
      const className = ($parent.attr('class') || '').toLowerCase()

      // 🔥 修复：如果到达核心产品区域的已知安全容器，停止检查
      if (id === 'feature-bullets' || id === 'featurebullets_feature_div' ||
          id === 'centerCol' || id === 'ppd' || id === 'dp-container' ||
          id === 'productoverview_feature_div' || id === 'bylineinfo') {
        return false  // 在安全区域内，不是推荐区域
      }

      // 只检查ID和类名，不再检查整个text（text太大会误判）
      if (id.includes('sims') || id.includes('related') || id.includes('sponsored') ||
          id.includes('also-viewed') || id.includes('also-bought') ||
          className.includes('sims') || className.includes('related') || className.includes('sponsored') ||
          className.includes('also-viewed') || className.includes('also-bought')) {
        return true
      }
    }
    return false
  }

  // ========== 渠道1: Product Overview表格 (置信度: 5) ==========
  $('#productOverview_feature_div tr, #poExpander tr').each((i: number, el: any) => {
    const label = $(el).find('td.a-span3, td:first-child').text().trim().toLowerCase()
    if (label === 'brand' || label.includes('brand') || label === 'marke' || label.includes('marke')) {
      const value = $(el).find('td.a-span9, td:last-child').text().trim()
      if (value && value.length > 1 && value.length < 50) {
        candidates.push({ value, source: 'product-overview', confidence: 5 })
      }
    }
  })

  // 直接查找包含Brand的表格行
  $('tr').each((i: number, el: any) => {
    const labelText = $(el).find('td:first-child, th').text().trim().toLowerCase()
    if (labelText === 'brand' || labelText === 'marke') {
      const value = $(el).find('td:last-child').text().trim()
      if (value && value.length > 1 && value.length < 50 && !isInRecommendationArea(el)) {
        candidates.push({ value, source: 'table-row', confidence: 5 })
      }
    }
  })

  // ========== 渠道2: bylineInfo品牌链接 (置信度: 4) ==========
  const brandSelectors = [
    '#ppd #bylineInfo',
    '#centerCol #bylineInfo',
    '#dp-container #bylineInfo',
    '#bylineInfo',
    'a#bylineInfo',
    '[data-feature-name="bylineInfo"]',
  ]

  for (const selector of brandSelectors) {
    const $el = $(selector)
    if ($el.length > 0 && !isInRecommendationArea($el[0])) {
      const bylineText = $el.text().trim()
      const bylineHref = $el.attr('href') || null
      const extracted = extractAmazonBrandFromByline({ bylineText, bylineHref })
      if (extracted && extracted.length > 1 && extracted.length < 50) {
        candidates.push({ value: extracted, source: 'bylineInfo', confidence: 4 })
        break
      }
    }
  }

  // ========== 渠道3: data-brand属性 (置信度: 5) ==========
  const dataBrand = $('[data-brand]').attr('data-brand')
  if (dataBrand && dataBrand.length > 1 && dataBrand.length < 50) {
    candidates.push({ value: dataBrand, source: 'data-brand', confidence: 5 })
  }

  // ========== 渠道4: technicalDetails.Brand / Marke / Manufacturer / etc. (置信度: 5) ==========
  // 🔥 2025-01-19修复：添加 Manufacturer 作为备选，解决 offer 1929 品牌名错误识别问题
  // Amazon 部分商品页面没有 Brand 字段，但有 Manufacturer 字段（如 HIKMICRO）
  const technicalBrand =
    technicalDetails.Brand ??
    technicalDetails.Marke ??
    technicalDetails.Marca ??
    technicalDetails.Marque ??
    technicalDetails.Merk ??
    technicalDetails.Marka ??
    technicalDetails.Manufacturer  // 🔥 新增：Manufacturer 作为最后备选

  if (technicalBrand) {
    const techBrand = technicalBrand.toString().trim()
      .replace(/^‎/, '')
      .replace(/^Brand:\s*/i, '')
      .replace(/^Manufacturer:\s*/i, '')  // 🔥 新增：清理 Manufacturer 前缀
    if (techBrand && techBrand.length > 1 && techBrand.length < 50) {
      candidates.push({ value: techBrand, source: 'technical-details', confidence: 5 })
    }
  }

  // ========== 渠道5: 产品标题首单词 (置信度: 2) ==========
  if (productName) {
    const titleParts = productName.split(/[\s-,|]+/)
    if (titleParts.length > 0) {
      const potentialBrand = titleParts[0].trim()
      if (potentialBrand.length >= 2 && potentialBrand.length <= 20) {
        const isValidBrand = /^[A-Za-z][A-Za-z0-9&\s-]*$/.test(potentialBrand) ||
                            /^[A-Z0-9]+$/.test(potentialBrand)
        if (isValidBrand) {
          candidates.push({ value: potentialBrand, source: 'product-title', confidence: 2 })
        }
      }
    }
  }

  // ========== 渠道6: 推广链接域名中的品牌 (置信度: 3) ==========
  // 从affiliate链接域名提取品牌，如: jackeryamazonseller.pxf.io → Jackery
  const affiliateDomainMatch = url.match(/https?:\/\/([a-z0-9]+)(?:seller|shop|store)?(?:\.amazon)?\.(?:pxf\.io|dpbolvw|linksynergy|amazon)/i)
  if (affiliateDomainMatch && affiliateDomainMatch[1]) {
    const domainBrand = affiliateDomainMatch[1]
      .replace(/seller|shop|store|amazon/i, '')
      .trim()
    if (domainBrand.length >= 2 && domainBrand.length <= 30 && domainBrand !== 'www') {
      // 将驼峰或下划线分割的单词大小写规范化
      const normalizedBrand = domainBrand
        .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase分割
        .replace(/_/g, ' ')
        .replace(/([a-z])-([a-z])/g, '$1 $2') // hyphen to space
        .split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
        .trim()
      if (normalizedBrand.length >= 2) {
        candidates.push({ value: normalizedBrand, source: 'affiliate-domain', confidence: 3 })
      }
    }
  }

  // ========== 渠道7: URL中的Amazon品牌 (置信度: 3) ==========
  const urlBrandMatch = url.match(/amazon\.[a-z.]+\/stores\/([^\/]+)/) ||
                        url.match(/amazon\.[a-z.]+\/([A-Z][A-Za-z0-9-]+)\/s\?/)
  if (urlBrandMatch && urlBrandMatch[1]) {
    const urlBrand = decodeURIComponent(urlBrandMatch[1])
      .replace(/-/g, ' ')
      .replace(/\+/g, ' ')
      .trim()
    if (urlBrand.length >= 2 && urlBrand.length <= 30 && !urlBrand.includes('page')) {
      candidates.push({ value: urlBrand, source: 'url', confidence: 3 })
    }
  }

  // ========== 渠道7: meta标签 (置信度: 4) ==========
  const metaBrand = $('meta[property="og:brand"]').attr('content') ||
                   $('meta[name="brand"]').attr('content')
  if (metaBrand && metaBrand.length > 1 && metaBrand.length < 50) {
    candidates.push({ value: metaBrand, source: 'meta-tag', confidence: 4 })
  }

  // ========== 渠道8: A+ Brand模块 (置信度: 5) ==========
  const aPlusBrand = $('#aplusBrandAplusModule .a-expander-content, [data-feature-name="aplusBrand"]').text().trim()
  if (aPlusBrand && aPlusBrand.length > 1 && aPlusBrand.length < 50) {
    candidates.push({ value: aPlusBrand, source: 'aplus-brand', confidence: 5 })
  }

  // ========== 渠道9: 产品描述中的品牌提及 (置信度: 3) ==========
  const productDescription = $('#productDescription, #aplus, [data-feature-name="productDescription"]').text()
  if (productDescription) {
    const brandMatch = productDescription.match(/\b(Brand|Marke|Marque|Marca|Merk)\s*[:：]\s*([A-Z][A-Za-z0-9&\-\s]+)/i)
    if (brandMatch && brandMatch[2]) {
      const descBrand = brandMatch[2].trim()
      if (descBrand.length > 1 && descBrand.length < 30) {
        candidates.push({ value: descBrand, source: 'description', confidence: 3 })
      }
    }
  }

  // ========== 渠道11: 品牌链接文本 (置信度: 4) ==========
  $('a[href*="/stores/"], a[href*="/brand/"]').each((i: number, el: any) => {
    const $el = $(el)
    const text = $el.text().trim()
    if (text && text.length > 1 && text.length < 50 && !isInRecommendationArea(el)) {
      // 🔍 调试：输出原始品牌链接文本
      console.log(`🔍 [品牌链接 #${i}] 原始文本: "${text}"`)

      // 排除纯"Store"、"Shop"等店铺关键词
      if (/^(Store|Shop|Boutique|Tienda|Negozio|Loja|Winkel|Sklep|Shoppen|Mağaza|店铺|Läden)$/i.test(text)) {
        return // 跳过纯店铺关键词
      }
      const cleanText = cleanBrandText(text)
      console.log(`🔍 [品牌链接 #${i}] 清洗后: "${cleanText}"`)

      // 验证清洗后的文本是否有效
      const isValid = cleanText &&
                     cleanText.length > 2 &&
                     cleanText !== text &&
                     // 排除纯定冠词、介词等无意义词（多语言）
                     !/^(lo|il|la|le|i|gli|di|de|of|du|da|von|van|den|die|das|el|a|the)$/i.test(cleanText)

      if (isValid) {
        candidates.push({ value: cleanText, source: 'brand-link', confidence: 4 })
        console.log(`✅ [品牌链接 #${i}] 已添加到候选: "${cleanText}"`)
      } else {
        console.log(`⚠️ [品牌链接 #${i}] 跳过: cleanText="${cleanText}", length=${cleanText?.length}, same=${cleanText === text}`)
      }
    }
  })

  // ========== 交叉验证逻辑 ==========
  const validCandidates = candidates.filter((c) => !isLikelyInvalidBrandName(c.value))

  if (validCandidates.length === 0) {
    console.warn('⚠️ 所有品牌提取渠道均无结果')
    return null
  }

  // 规范化函数：统一大小写，去除后缀
  const normalizeBrand = (brand: string): string => {
    return brand
      .toLowerCase()
      .replace(/\s+(official|store|shop|brand)$/i, '')
      .replace(/-(shop|store)$/i, '')
      .trim()
  }

  // 计算每个规范化品牌的总分（置信度 × 出现次数）
  const brandScores = new Map<string, { originalValue: string, totalScore: number, sources: string[] }>()

  for (const candidate of validCandidates) {
    const normalized = normalizeBrand(candidate.value)
    const existing = brandScores.get(normalized)

    if (existing) {
      existing.totalScore += candidate.confidence
      existing.sources.push(candidate.source)
      // 保留原始值中最长的（通常更完整）
      if (candidate.value.length > existing.originalValue.length) {
        existing.originalValue = candidate.value
      }
    } else {
      brandScores.set(normalized, {
        originalValue: candidate.value,
        totalScore: candidate.confidence,
        sources: [candidate.source]
      })
    }
  }

  // 选择得分最高的品牌
  let bestBrand: { normalized: string, data: { originalValue: string, totalScore: number, sources: string[] } } | null = null
  for (const [normalized, data] of brandScores) {
    if (!bestBrand || data.totalScore > bestBrand.data.totalScore) {
      bestBrand = { normalized, data }
    }
  }

  if (!bestBrand) {
    console.warn('⚠️ 品牌交叉验证失败')
    return null
  }

  // 输出交叉验证结果
  const verificationStatus = bestBrand.data.sources.length >= 2 ? '✅ 多渠道验证' : '⚠️ 单渠道'
  console.log(`${verificationStatus} 品牌名: "${bestBrand.data.originalValue}" (得分: ${bestBrand.data.totalScore}, 来源: ${bestBrand.data.sources.join(', ')})`)

  // 最终清洗 - 增强多语言清洗规则
  let finalBrand = bestBrand.data.originalValue

  // 再次应用cleanBrandText进行深度清洗
  finalBrand = cleanBrandText(finalBrand)

  // 额外的通用清洗规则
  finalBrand = finalBrand
    // 去除各种"商店"后缀（多语言）
    .replace(/\s+(Store|Shop|Boutique|Tienda|Negozio|Loja|Winkel|Sklep|Shoppen|Mağaza)$/i, '')
    // 去除"de"、"di"、"of"、"du"等介词开头的品牌名
    .replace(/^(de|di|of|du|da|von|van|of)\s+/i, '')
    // 去除"Visit"、"Visita"、"Visiter"等动词开头的残留
    .replace(/^(Visit|Visita|Visiter|Besuchen|Besuche|Odwiedź|Bezoek|Visite)(?:\s+|$)/i, '')
    // 去除"Brand"、"Official"等后缀
    .replace(/\s+(Brand|Official|Store|Shop)$/i, '')
    .trim()

  // 🔥 最终检查：排除纯"Store"等店铺关键词
  if (/^(Store|Shop|Boutique|Tienda|Negozio|Loja|Winkel|Sklep|Shoppen|Mağaza|店铺|Läden)$/i.test(finalBrand)) {
    finalBrand = ''
  }

  // 如果清洗后为空或太短，回退到产品标题首词
  if (!finalBrand || finalBrand.length < 2) {
    console.warn('⚠️ 品牌清洗后结果无效，回退到产品标题首词')
    if (productName) {
      const titleParts = productName.split(/[\s-,|]+/)
      if (titleParts.length > 0) {
        finalBrand = titleParts[0].trim()
      }
    }
  }

  console.log(`🔍 最终品牌提取结果: "${finalBrand}"`)
  return finalBrand
}

/**
 * Clean brand text by removing store visit prefixes in multiple languages
 * 🔥 2025-12-10优化：增强意大利站和欧洲站的品牌清洗
 */
function cleanBrandText(brand: string): string {
  brand = (brand || '').trim()
  // Guard: avoid locale boilerplate fragments being treated as brands (e.g. "Besuchen").
  if (isLikelyInvalidBrandName(brand)) return ''

  // English (US, CA, AU, GB, IN, SG): "Visit the Brand Store"
  brand = brand.replace(/^Visit\s+the\s+/i, '').replace(/\s+Store$/i, '')

  // 🔥 增强：处理纯"Store"或仅有前缀的情况
  if (/^(Store|Shop|Boutique)$/i.test(brand)) {
    return ''
  }

  // Italian (IT): 通用清洗策略 - 分步移除各种组合
  brand = brand.replace(/^Visita\s+(lo|il|la|le|i|gli)\s*/i, '')
  brand = brand.replace(/^(lo|il|la|le|i|gli)\s+/i, '')
  brand = brand.replace(/^(Store|Negozio)\s+di\s+/i, '')
  brand = brand.replace(/^(Store|Negozio)\s*/i, '')
  brand = brand.replace(/\s+(Store|Negozio)$/i, '')
  brand = brand.replace(/^di\s+/i, '')
  brand = brand.replace(/\s+di$/i, '')
  if (/^(lo|il|la|le|i|gli)$/i.test(brand.trim())) brand = ''

  // French (FR, BE, CA-FR): 通用清洗策略
  brand = brand.replace(/^Visitez\s+(la|le|les)\s*/i, '')
  brand = brand.replace(/^Visiter\s+(la|le|les)\s*/i, '')
  brand = brand.replace(/^(la|le|les)\s+/i, '')
  brand = brand.replace(/^Boutique\s+de\s+/i, '')
  brand = brand.replace(/^Boutique\s*/i, '')
  brand = brand.replace(/\s+Boutique$/i, '')
  brand = brand.replace(/^de\s+/i, '')
  brand = brand.replace(/\s+de$/i, '')
  if (/^(la|le|les|de)$/i.test(brand.trim())) brand = ''

  // German (DE, AT, CH): 通用清洗策略
  brand = brand.replace(/^Besuchen\s+Sie\s+(den|die|das)\s*/i, '')
  brand = brand.replace(/^Besuche\s+(den|die|das)\s*/i, '')
  brand = brand.replace(/^(den|die|das)\s+/i, '')
  brand = brand.replace(/-(Shop|Store)$/i, '')
  brand = brand.replace(/\s+(Shop|Store)$/i, '')
  brand = brand.replace(/^(Shop|Store)\s*/i, '')
  if (/^(den|die|das)$/i.test(brand.trim())) brand = ''

  // Spanish (ES, MX, AR, CL, CO, PE): 通用清洗策略
  brand = brand.replace(/^Visita\s+(la|el)\s*/i, '')
  brand = brand.replace(/^(la|el)\s+/i, '')
  brand = brand.replace(/^Tienda\s+de\s+/i, '')
  brand = brand.replace(/^Tienda\s*/i, '')
  brand = brand.replace(/\s+Tienda$/i, '')
  brand = brand.replace(/^de\s+/i, '')
  brand = brand.replace(/\s+de$/i, '')
  if (/^(la|el|de)$/i.test(brand.trim())) brand = ''

  // Portuguese (BR, PT): 通用清洗策略
  brand = brand.replace(/^Visite\s+a\s*/i, '')
  brand = brand.replace(/^a\s+/i, '')
  brand = brand.replace(/^Loja\s+da\s+/i, '')
  brand = brand.replace(/^Loja\s*/i, '')
  brand = brand.replace(/\s+Loja$/i, '')
  brand = brand.replace(/^da\s+/i, '')
  brand = brand.replace(/\s+da$/i, '')
  if (/^(a|da)$/i.test(brand.trim())) brand = ''

  // Dutch (NL, BE-NL): 通用清洗策略
  brand = brand.replace(/^Bezoek\s+de\s*/i, '')
  brand = brand.replace(/^de\s+/i, '')
  brand = brand.replace(/-winkel$/i, '')
  brand = brand.replace(/\s+winkel$/i, '')
  if (/^de$/i.test(brand.trim())) brand = ''

  // Other languages (simplified)
  brand = brand.replace(/^Odwiedź\s+/i, '').replace(/^Sklep\s+/i, '')
  brand = brand.replace(/\s+Mağazasını\s+ziyaret\s+edin$/i, '')
  brand = brand.replace(/^Besök\s+/i, '').replace(/-butiken$/i, '')
  brand = brand.replace(/زيارة\s+متجر\s+/i, '').replace(/\s+متجر$/i, '')
  brand = brand.replace(/^访问\s+/i, '').replace(/\s+店铺$/i, '').replace(/^查看\s+/i, '').replace(/\s+品牌店$/i, '')
  brand = brand.replace(/\s+스토어\s+방문하기$/i, '')
  brand = brand.replace(/\s+स्टोर\s+पर\s+जाएं$/i, '')
  brand = brand.replace(/\s*出品者のストアにアクセス$/i, '').replace(/のストアを表示$/i, '')

  // General cleanup
  brand = brand.replace(/^Brand:\s*/i, '')
    .replace(/^品牌:\s*/i, '')
    .replace(/^Marca:\s*/i, '')
    .replace(/^Marque:\s*/i, '')
    .replace(/^Marke:\s*/i, '')
    .replace(/^Merk:\s*/i, '')
    .replace(/^Marka:\s*/i, '')
    .replace(/^Märke:\s*/i, '')
    .replace(/^ブランド:\s*/i, '')
    .replace(/^브랜드:\s*/i, '')
    .replace(/^العلامة التجارية:\s*/i, '')

  return brand.trim()
}
