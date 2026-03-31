/**
 * Core Scraping Functions
 *
 * Base URL scraping and affiliate link resolution
 */

import { smartWaitForLoad, recordWaitOptimization } from '../smart-wait-strategy'
import { getPlaywrightPool } from '../playwright-pool'
import { retryWithBackoff, isProxyConnectionError } from './proxy-utils'
import {
  createStealthBrowser,
  releaseBrowser,
  configureStealthPage,
  randomDelay,
  getDynamicTimeout
} from './browser-stealth'
import type { ScrapeUrlResult, AffiliateLinkResult } from './types'

const PROXY_URL = process.env.PROXY_URL || ''

/**
 * Scrape URL with JavaScript rendering and stealth mode
 * P0优化: 使用连接池减少启动时间
 * 🌍 支持根据目标国家动态配置语言
 */
export async function scrapeUrlWithBrowser(
  url: string,
  customProxyUrl?: string,
  options: {
    waitForSelector?: string
    waitForTimeout?: number
    followRedirects?: boolean
    targetCountry?: string  // 🌍 目标国家参数
  } = {}
): Promise<ScrapeUrlResult> {
  // 🔥 P0修复: 必须传入targetCountry到createStealthBrowser
  // 之前漏传导致浏览器locale/timezone/languages使用默认en-US配置
  // 这会触发Amazon反爬虫检测（访问amazon.it但浏览器是英语配置）
  const browserResult = await createStealthBrowser(customProxyUrl, options.targetCountry)

  try {
    return await retryWithBackoff(async () => {
      // 连接池模式已有context，独立模式需要创建
      const page = await browserResult.context.newPage()

      // 🔥 2025-12-12 内存优化：使用try-finally确保Page在任何情况下都被关闭
      try {
        await configureStealthPage(page, options.targetCountry)  // 🌍 传入目标国家

        // Track redirects
        const redirectChain: string[] = [url]
        page.on('response', response => {
          const status = response.status()
          if (status >= 300 && status < 400) {
            const location = response.headers()['location']
            if (location) {
              redirectChain.push(location)
            }
          }
        })

      console.log(`🌐 访问URL: ${url}`)

      // 🔥 增强人类行为模拟：导航前随机延迟
      await randomDelay(500, 1500)

      // 🔥 P1修复: 两阶段智能等待策略
      // 阶段1: 快速提交导航，不等待完整加载（避免被第三方资源阻塞）
      let response: any
      try {
        response = await page.goto(url, {
          waitUntil: 'commit',  // 最快策略，导航提交后立即返回
          timeout: 10000,  // 10秒足够建立连接
        })
      } catch (commitError: any) {
        // 如果commit也失败，说明根本连不上，直接抛出
        console.error(`❌ 导航提交失败: ${commitError.message}`)
        throw commitError
      }

      if (!response) {
        throw new Error('No response received')
      }

      const status = response.status()
      console.log(`📊 HTTP状态: ${status}`)

      if (status === 429) {
        throw new Error('429 Too Many Requests - 触发限流，将重试')
      }

      if (status >= 400) {
        throw new Error(`HTTP ${status} error`)
      }

      // 🔥 P0修复: commit后等待DOM开始加载,否则页面可能是空壳HTML
      // Amazon反爬策略:返回200状态但HTML为空,需等待JavaScript执行渲染DOM
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 })
        console.log(`✅ DOM加载完成`)

        // ✅ 方案2修复: DOM加载后立即添加延迟，给JavaScript执行时间
        // Amazon的JavaScript可能在DOM加载后1-2秒才开始执行
        const initialWait = 1000 + Math.random() * 2000  // 1-3秒
        console.log(`⏰ DOM加载后等待: ${Math.round(initialWait)}ms`)
        await new Promise(resolve => setTimeout(resolve, initialWait))
      } catch (e) {
        console.warn(`⚠️ DOM加载超时,但继续执行`)
      }

      // 🔧 修复: Amazon 欧洲站点需要等待网络空闲才能完整渲染内容
      // 特别是 IT/DE/FR/ES 站点，JavaScript 加载较慢
      if (url.includes('amazon.it') || url.includes('amazon.de') || url.includes('amazon.fr') || url.includes('amazon.es')) {
        console.log(`🇪🇺 Amazon欧洲站点检测到 (${url.match(/amazon\.(it|de|fr|es)/)?.[1]?.toUpperCase()}), 等待网络空闲...`)
        try {
          await page.waitForLoadState('networkidle', { timeout: 15000 })
          console.log(`✅ 网络空闲等待完成`)
        } catch (networkError) {
          console.warn(`⚠️ Network idle timeout (15s), continuing...`)
        }
      }

      // 🔥 P1修复: 检测Amazon的a-no-js标记，表示JavaScript未执行完成
      // 如果检测到a-no-js，需要额外等待JavaScript渲染
      try {
        // 🔥 P0增强: 同时获取页面语言信息用于诊断
        const pageStatus = await page.evaluate(() => {
          const html = document.documentElement
          return {
            hasNoJsClass: html.classList.contains('a-no-js') || document.body?.classList.contains('a-no-js'),
            hasJsClass: html.classList.contains('a-js'),
            htmlLang: html.getAttribute('lang') || '(未设置)',
            htmlClass: html.className.substring(0, 100),
          }
        })

        console.log(`🔍 页面状态: lang=${pageStatus.htmlLang}, a-js=${pageStatus.hasJsClass}, a-no-js=${pageStatus.hasNoJsClass}`)

        if (pageStatus.hasNoJsClass) {
          console.log(`🔄 检测到a-no-js标记，等待JavaScript渲染...`)

          // 🔥 2025-12-11优化: 先尝试刷新页面（有时能绕过反爬虫）
          // Amazon的a-no-js检测有时是临时的，刷新后可能恢复正常
          try {
            console.log(`🔄 尝试刷新页面绕过a-no-js检测...`)

            // 在刷新前添加随机延迟（模拟人类犹豫）
            await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000))

            // 刷新页面
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 })

            // 刷新后等待一下
            await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 2000))

            // 重新检测a-no-js状态
            const refreshedStatus = await page.evaluate(() => {
              const html = document.documentElement
              return {
                hasNoJsClass: html.classList.contains('a-no-js'),
                hasJsClass: html.classList.contains('a-js'),
              }
            })

            if (!refreshedStatus.hasNoJsClass || refreshedStatus.hasJsClass) {
              console.log(`✅ 刷新后a-no-js已消除，页面恢复正常`)
            } else {
              console.warn(`⚠️ 刷新后仍有a-no-js，继续尝试其他方法...`)
            }
          } catch (refreshError) {
            console.warn(`⚠️ 刷新页面失败: ${(refreshError as Error).message}`)
          }

          // ✅ 修复1: 添加随机延迟（模拟人类阅读时间）
          const humanDelay = 2000 + Math.random() * 3000  // 2-5秒
          console.log(`⏰ 模拟人类行为延迟: ${Math.round(humanDelay)}ms`)
          await new Promise(resolve => setTimeout(resolve, humanDelay))

          // ✅ 修复2: 模拟更真实的鼠标移动（贝塞尔曲线路径）
          try {
            // 生成多个点模拟人类鼠标移动路径
            const startX = Math.random() * 200 + 50
            const startY = Math.random() * 200 + 50
            const endX = Math.random() * 600 + 300
            const endY = Math.random() * 400 + 200

            // 分3-5步移动（更像人类）
            const steps = 3 + Math.floor(Math.random() * 3)
            for (let i = 0; i <= steps; i++) {
              const t = i / steps
              const x = startX + (endX - startX) * t + (Math.random() - 0.5) * 20
              const y = startY + (endY - startY) * t + (Math.random() - 0.5) * 20
              await page.mouse.move(x, y)
              await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100))
            }

            // 滚动页面
            await page.mouse.wheel(0, Math.random() * 300 + 100)
            console.log(`🖱️ 已模拟人类鼠标移动路径和滚动`)
          } catch (e) {
            console.warn(`⚠️ 鼠标模拟失败，继续执行`)
          }

          // ✅ 修复3: 增加超时时间 8秒 → 15秒
          // 等待a-no-js变为a-js，或者等待networkidle
          try {
            await Promise.race([
              // 等待class变化（a-no-js → a-js）
              page.waitForFunction(() => {
                const html = document.documentElement
                return !html.classList.contains('a-no-js') || html.classList.contains('a-js')
              }, { timeout: 15000 }),  // ✅ 8秒 → 15秒
              // 或者等待网络空闲
              page.waitForLoadState('networkidle', { timeout: 15000 }),  // ✅ 8秒 → 15秒
            ])
            console.log(`✅ JavaScript渲染完成`)
          } catch (waitError) {
            console.warn(`⚠️ JavaScript渲染等待超时，继续执行`)

            // ✅ 修复4: 超时后再等待一次（给Amazon最后机会）
            console.log(`🔄 最后尝试：再等待5秒...`)
            await new Promise(resolve => setTimeout(resolve, 5000))
          }
        }

        // 🔥 P0增强: JavaScript执行后，检查页面语言是否与目标国家匹配
        // ✅ 修复: 只在JavaScript成功执行后（a-js存在）才检测语言，避免误报
        if (options.targetCountry) {
          try {
            // 重新获取JavaScript执行后的页面状态
            const finalPageStatus = await page.evaluate(() => {
              const html = document.documentElement
              return {
                htmlLang: html.getAttribute('lang') || '(未设置)',
                hasJsClass: html.classList.contains('a-js'),
                hasNoJsClass: html.classList.contains('a-no-js'),
              }
            })

            console.log(`🌍 最终页面状态: lang=${finalPageStatus.htmlLang}, a-js=${finalPageStatus.hasJsClass}, a-no-js=${finalPageStatus.hasNoJsClass}`)

            // 只有当JavaScript成功执行后（a-js=true 或 a-no-js=false）才检测语言
            if (finalPageStatus.hasJsClass || !finalPageStatus.hasNoJsClass) {
              const { getLanguageCodeForCountry } = await import('../language-country-codes')
              const expectedLangCode = getLanguageCodeForCountry(options.targetCountry)
              const actualLang = finalPageStatus.htmlLang.toLowerCase().split('-')[0]  // 'en-gb' -> 'en'

              if (expectedLangCode !== actualLang) {
                console.warn(`⚠️ 语言不匹配: 目标国家${options.targetCountry}期望语言${expectedLangCode}，但页面lang=${finalPageStatus.htmlLang}`)
                console.warn(`   可能原因: 1) 代理IP不在目标国家 2) Amazon根据浏览器指纹判断用户偏好其他语言`)
              } else {
                console.log(`✅ 语言匹配成功: 期望${expectedLangCode}，实际${actualLang}`)
              }
            } else {
              console.warn(`⚠️ JavaScript未正常执行 (a-no-js存在)，跳过语言检测以避免误报`)
            }
          } catch (langCheckError) {
            console.warn(`⚠️ 语言检测失败: ${(langCheckError as Error).message}`)
          }
        }
      } catch (evalError) {
        console.warn(`⚠️ a-no-js检测失败: ${(evalError as Error).message}`)
      }

      // 阶段2: 等待关键元素出现（Amazon产品页面的核心内容）
      if (options.waitForSelector) {
        console.log(`⏳ 等待关键元素: ${options.waitForSelector}`)

        // 🔥 多选择器容错策略：尝试多个可能的选择器（包含桌面版和移动版）
        const productSelectors = [
          // === 桌面版选择器 ===
          '#productTitle',  // 美国/英国站常用
          'span[id="productTitle"]',  // 精确匹配
          'h1[id="title"]',  // 意大利站可能的变体
          '[data-feature-name="title"]',  // 数据属性选择器
          'h1.product-title-word-break',  // 类名选择器
          // === 移动版选择器 (a-m-us页面) ===
          '#title_feature_div h1',  // 移动版标题容器
          '#title_feature_div span.a-text-bold',  // 移动版粗体标题
          '[data-hook="product-title"]',  // 移动版钩子选择器
          '#title',  // 移动版简化标题ID
          '.a-size-large.a-text-bold',  // 移动版大号粗体文本
          // === 最宽松的备选 ===
          '#dp-container',  // 产品容器
          '#ppd',  // 产品页面容器
        ]

        // 🔧 修复: Amazon IT/DE/FR/ES 需要更长的等待时间
        const isEuropeanAmazon = url.includes('amazon.it') || url.includes('amazon.de') || url.includes('amazon.fr') || url.includes('amazon.es')
        const selectorTimeout = isEuropeanAmazon ? 8000 : 3000  // 欧洲站点8秒，其他3秒

        let selectorFound = false
        let foundSelector = ''

        for (const selector of productSelectors) {
          const found = await page.waitForSelector(selector, {
            timeout: selectorTimeout,  // 🔧 根据地区动态调整超时时间
            state: 'visible'
          }).then(() => true).catch(() => false)

          if (found) {
            selectorFound = true
            foundSelector = selector
            console.log(`✅ 找到元素: ${selector}`)
            break
          }
        }

        if (!selectorFound) {
          selectorFound = false
        }

        if (!selectorFound) {
          console.warn(`⚠️ 关键元素未找到: ${options.waitForSelector}`)

          // 🔥 检测是否遇到反爬虫保护页面
          const pageTitle = await page.title().catch(() => '')
          const pageUrl = page.url()

          // Cloudflare Challenge检测
          if (pageTitle.toLowerCase().includes('just a moment') ||
              pageTitle.toLowerCase().includes('attention required') ||
              pageTitle.toLowerCase().includes('please verify') ||
              pageUrl.includes('captcha') ||
              pageUrl.includes('challenge')) {
            console.error(`🚫 检测到反爬虫保护页面: "${pageTitle}"`)
            throw new Error(`遇到反爬虫保护页面: ${pageTitle}`)
          }

          // Amazon错误页面检测
          if (pageTitle.toLowerCase().includes('page not found') ||
              pageTitle.toLowerCase().includes('404') ||
              pageTitle.toLowerCase().includes('sorry')) {
            console.error(`📭 检测到Amazon错误页面: "${pageTitle}"`)
            throw new Error(`Amazon错误页面: ${pageTitle}`)
          }

          // 🔥 P0增强调试: 提取页面中所有可能的标题元素
          try {
            const debugInfo = await page.evaluate(() => {
              const h1s = Array.from(document.querySelectorAll('h1')).map(el => ({
                tag: 'h1',
                id: el.id,
                class: el.className,
                text: el.textContent?.substring(0, 100) || ''
              }))
              const spans = Array.from(document.querySelectorAll('span[id*="title"], span[class*="title"]')).slice(0, 5).map(el => ({
                tag: 'span',
                id: el.id,
                class: el.className,
                text: el.textContent?.substring(0, 100) || ''
              }))
              const bodyClass = document.body?.className || ''
              // 🔥 检测移动版页面标识
              const isMobilePage = bodyClass.includes('a-m-') || bodyClass.includes('a-mobile')
              return { h1s, spans, bodyClass, isMobilePage }
            })

            // 🔥 移动版页面警告
            if (debugInfo.isMobilePage) {
              console.warn(`📱 检测到Amazon移动版页面 (a-m-* class)，DOM结构可能与桌面版不同`)
            }

            console.warn(`🔍 页面结构调试:`, JSON.stringify(debugInfo, null, 2))
          } catch (e) {
            console.warn('调试信息提取失败')
          }

          // 获取部分HTML用于调试（前500个字符）
          const htmlPreview = await page.content().then(html => html.substring(0, 500)).catch(() => '')
          console.warn(`📄 页面预览: ${htmlPreview}...`)

          // 如果没有明确的反爬虫特征，但选择器未找到，可能是页面结构变化
          // 🔥 P0修复: 不再抛出错误，而是继续处理（允许降级抓取）
          console.warn(`⚠️ 页面加载成功但关键选择器未找到，将尝试降级提取数据`)
        } else {
          console.log(`✅ 关键元素已加载: ${foundSelector || options.waitForSelector}`)
        }

        // 🔥 增强人类行为模拟：页面加载后模拟鼠标活动和滚动
        await page.mouse.move(
          Math.floor(Math.random() * 200) + 100,
          Math.floor(Math.random() * 200) + 100
        ).catch(() => {})

        await page.evaluate(() => {
          window.scrollTo(0, Math.floor(Math.random() * 500))
        }).catch(() => {})
      } else {
        // 🔥 P1优化: 使用智能等待策略
        const waitStart = Date.now()
        const waitResult = await smartWaitForLoad(page, url).catch(() => ({
          waited: 10000,
          loadComplete: false,
          signals: []
        }))
        const waitTime = Date.now() - waitStart

        console.log(`⏱️ 智能等待完成: ${waitResult.waited}ms, 信号: ${waitResult.signals.join(', ')}`)

        // 记录优化效果（相比固定10秒networkidle）
        recordWaitOptimization(10000, waitResult.waited)
      }

      // Additional random delay (simulate reading)
      await randomDelay(1000, 2000)

      // Simulate human scrolling
      // 🔥 2025-12-12优化：针对Amazon产品页面，滚动到feature-bullets区域触发懒加载
      const isAmazonProduct = url.includes('amazon.') && (url.includes('/dp/') || url.includes('/gp/product/'))
      if (isAmazonProduct) {
        // Amazon产品页面：滚动到feature-bullets区域
        const scrollResult = await page.evaluate(() => {
          const featureBullets = document.querySelector('#feature-bullets, #featurebullets_feature_div')
          if (featureBullets) {
            featureBullets.scrollIntoView({ behavior: 'instant', block: 'center' })
            return { found: true, selector: featureBullets.id || featureBullets.className }
          } else {
            // 如果找不到，滚动到页面中部位置
            window.scrollTo(0, window.innerHeight * 0.8)
            return { found: false, selector: null }
          }
        }).catch(() => ({ found: false, selector: null }))

        console.log(`🔍 feature-bullets滚动: found=${scrollResult.found}, selector=${scrollResult.selector}`)
        await randomDelay(800, 1200)  // 等待懒加载内容渲染

        // 等待feature-bullets元素出现
        const featureLoaded = await page.waitForSelector('#feature-bullets li, #featurebullets_feature_div li', {
          timeout: 3000,
          state: 'visible'
        }).then(() => true).catch(() => false)

        if (!featureLoaded) {
          console.warn(`⚠️ feature-bullets未加载，可能页面结构不同`)
          // 🔥 调试：检查页面中是否有其他可能的feature容器
          const featureDebug = await page.evaluate(() => {
            const selectors = [
              '#feature-bullets',
              '#featurebullets_feature_div',
              '[data-feature-name="featurebullets"]',
              '#productFactsDesktop',
              '.a-expander-content'
            ]
            const results: Record<string, number> = {}
            for (const sel of selectors) {
              results[sel] = document.querySelectorAll(sel).length
            }
            // 检查是否有"About this item"文本
            const aboutThisItem = document.body?.innerText?.includes('About this item') || false
            return { selectors: results, hasAboutThisItem: aboutThisItem }
          }).catch(() => null)

          if (featureDebug) {
            console.log(`🔍 feature容器调试: ${JSON.stringify(featureDebug)}`)
          }
        } else {
          console.log(`✅ feature-bullets已加载`)
        }

        // 滚动回顶部
        await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
      } else {
        // 非Amazon产品页面：普通随机滚动
        await page.evaluate(() => {
          window.scrollBy(0, Math.random() * 500)
        })
      }

      await randomDelay(500, 1000)

      // Get final URL after all redirects
      const finalUrl = page.url()
      if (finalUrl !== url) {
        redirectChain.push(finalUrl)
      }

      console.log(`✅ 最终URL: ${finalUrl}`)
      console.log(`🔄 重定向次数: ${redirectChain.length - 1}`)

      // Extract data
      const html = await page.content()
      const title = await page.title()

      // Take screenshot for debugging (optional)
      let screenshot: Buffer | undefined
      try {
        screenshot = await page.screenshot({
          fullPage: false,
          timeout: 30000,  // 🔥 修复: 增加到30秒超时（代理网络可能较慢）
          animations: 'disabled',  // 禁用动画加速截图
        })
      } catch (error) {
        console.warn('⚠️ 截图失败:', error)
        // 尝试第二次截图，不等待字体加载
        try {
          screenshot = await page.screenshot({
            fullPage: false,
            timeout: 15000,
            animations: 'disabled',
            // 不等待字体，直接截图
          }).catch(() => undefined)
          if (screenshot) {
            console.log('✅ 第二次尝试截图成功（未等待字体加载）')
          }
        } catch (retryError) {
          console.warn('⚠️ 第二次截图也失败，跳过截图继续执行')
        }
      }

      return {
        html,
        title,
        finalUrl,
        redirectChain: Array.from(new Set(redirectChain)), // Remove duplicates
        screenshot,
      }

      } finally {
        // 🔥 2025-12-12 内存优化：确保Page在任何情况下都被关闭
        await page.close().catch((e) => {
          console.warn(`⚠️ Page关闭失败: ${e.message}`)
        })
      }
    })
  } finally {
    await releaseBrowser(browserResult)
  }
}

/**
 * Resolve affiliate link redirects
 * P0优化: 使用连接池减少启动时间
 * P0优化: 集成代理IP池预热缓存
 * P1优化: 代理失败时自动换新代理重试
 */
export async function resolveAffiliateLink(
  affiliateLink: string,
  customProxyUrl?: string,
  targetCountry?: string,
  maxProxyRetries: number = 2  // 代理失败最多重试2次
): Promise<AffiliateLinkResult> {
  console.log(`🔗 解析推广链接: ${affiliateLink}${targetCountry ? ` (国家: ${targetCountry})` : ''}`)

  let lastError: Error | undefined
  const effectiveProxyUrl = customProxyUrl || PROXY_URL

  for (let proxyAttempt = 0; proxyAttempt <= maxProxyRetries; proxyAttempt++) {
    try {
      if (proxyAttempt > 0) {
        console.log(`🔄 链接解析 - 代理重试 ${proxyAttempt}/${maxProxyRetries}，清理连接池并获取新代理...`)
        const pool = getPlaywrightPool()
        await pool.clearIdleInstances()
        // 🔥 清理代理IP缓存，强制获取新IP
        const { clearProxyCache } = await import('../proxy/fetch-proxy-ip')
        clearProxyCache(effectiveProxyUrl)
        console.log(`🧹 已清理代理IP缓存: ${effectiveProxyUrl}`)
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

      const browserResult = await createStealthBrowser(effectiveProxyUrl, targetCountry)

      try {
        return await retryWithBackoff(async () => {
          const page = await browserResult.context.newPage()
          try {
            await configureStealthPage(page, targetCountry)  // 🌍 传入目标国家

            const redirectChain: string[] = [affiliateLink]

            // Track all redirects
            page.on('response', response => {
              const url = response.url()
              if (!redirectChain.includes(url)) {
                redirectChain.push(url)
              }
            })

            // Navigate and wait for final URL
            await randomDelay(500, 1500)

            await page.goto(affiliateLink, {
              waitUntil: 'domcontentloaded',
              timeout: getDynamicTimeout(affiliateLink), // 🔥 P1优化: 动态超时
            })

            // Wait for any JavaScript redirects
            // 🔥 P1优化: 使用智能等待策略
            const waitResult = await smartWaitForLoad(page, affiliateLink, { maxWaitTime: 15000 }).catch(() => ({
              waited: 15000,
              loadComplete: false,
              signals: []
            }))

            console.log(`⏱️ 链接解析等待: ${waitResult.waited}ms, 信号: ${waitResult.signals.join(', ')}`)
            recordWaitOptimization(15000, waitResult.waited)

            await randomDelay(1000, 2000)

            // 🔥 修复：使用page.evaluate获取完整URL，包括Cloudflare拦截页的URL
            // page.url()在某些情况下可能返回不完整的URL
            const finalUrl = await page.evaluate(() => window.location.href).catch(() => page.url())

            // Parse final URL and suffix
            const urlObj = new URL(finalUrl)
            const basePath = `${urlObj.origin}${urlObj.pathname}`
            const suffix = urlObj.search.substring(1) // Remove leading '?'

            console.log(`✅ 最终URL: ${basePath}`)
            console.log(`🔧 URL Suffix: ${suffix.substring(0, 100)}${suffix.length > 100 ? '...' : ''}`)

            // 🔥 新增：如果suffix为空但finalUrl包含查询参数，记录警告
            if (!suffix && finalUrl.includes('?')) {
              console.warn(`⚠️ URL Suffix提取警告: finalUrl包含?但suffix为空`)
              console.warn(`   finalUrl: ${finalUrl}`)
              console.warn(`   urlObj.search: ${urlObj.search}`)
            }

            return {
              finalUrl: basePath,
              finalUrlSuffix: suffix,
              redirectChain: Array.from(new Set(redirectChain)),
              redirectCount: redirectChain.length - 1,
            }
          } finally {
            // 🔥 内存优化：确保Page在任何情况下都关闭
            await page.close().catch((e) => {
              console.warn(`⚠️ [resolveAffiliateLink] Page关闭失败: ${e.message}`)
            })
          }
        })
      } finally {
        await releaseBrowser(browserResult)
      }

    } catch (error: any) {
      lastError = error
      console.error(`❌ 链接解析尝试 ${proxyAttempt + 1} 失败: ${error.message?.substring(0, 100)}`)

      // 如果是代理连接错误，尝试换新代理
      if (isProxyConnectionError(error) && proxyAttempt < maxProxyRetries) {
        console.log(`🔄 检测到代理连接问题，准备换新代理重试...`)
        continue
      }

      // 其他错误或已用尽重试次数
      throw error
    }
  }

  // 所有重试都失败
  throw lastError || new Error('推广链接解析失败：已用尽所有代理重试')
}
