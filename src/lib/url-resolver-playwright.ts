import { Browser, BrowserContext, Page } from 'playwright'
import { getPlaywrightPool } from './playwright-pool'
import { smartWaitForLoad, assessPageComplexity, recordWaitOptimization } from './smart-wait-strategy'
import { isProxyConnectionError, withProxyRetry } from './stealth-scraper'

/**
 * User-Agent rotation pool (2024 browsers)
 */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
]

/**
 * Get random User-Agent
 */
function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

function isSameDomain(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  return a.endsWith(`.${b}`) || b.endsWith(`.${a}`)
}

const TRACKING_TARGET_PARAM_NAMES = ['url', 'redirect', 'target', 'destination', 'goto', 'link', 'new', 'r', 'u']

function extractTrackingWrapperSuffix(urlObj: URL, finalHost: string): string {
  if (!urlObj.search) return ''

  const params = new URLSearchParams(urlObj.search)
  let hasEmbeddedTargetToFinalHost = false

  for (const paramName of TRACKING_TARGET_PARAM_NAMES) {
    const paramValue = params.get(paramName)
    if (!paramValue) continue

    try {
      const targetHost = normalizeHost(new URL(paramValue).hostname)
      if (!isSameDomain(targetHost, finalHost)) continue

      hasEmbeddedTargetToFinalHost = true
      params.delete(paramName)
    } catch {
      // ignore non-URL parameter values
    }
  }

  if (!hasEmbeddedTargetToFinalHost) return ''

  return params.toString()
}

function extractSuffixFromRedirectChain(redirectChain: string[], finalUrl: string): string {
  let finalHost = ''
  try {
    finalHost = normalizeHost(new URL(finalUrl).hostname)
  } catch {
    return ''
  }

  for (let i = redirectChain.length - 1; i >= 0; i--) {
    try {
      const urlObj = new URL(redirectChain[i])
      const suffix = urlObj.search.substring(1)
      if (!suffix) continue
      const host = normalizeHost(urlObj.hostname)
      if (isSameDomain(host, finalHost)) {
        return suffix
      }
    } catch {
      // Ignore invalid URL in redirect chain.
    }
  }

  for (let i = redirectChain.length - 1; i >= 0; i--) {
    try {
      const urlObj = new URL(redirectChain[i])
      const wrapperSuffix = extractTrackingWrapperSuffix(urlObj, finalHost)
      if (wrapperSuffix) {
        return wrapperSuffix
      }
    } catch {
      // Ignore invalid URL in redirect chain.
    }
  }

  return ''
}

function isPersistableFinalUrl(value: string | null | undefined): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false

  const lower = trimmed.toLowerCase()
  if (lower === 'null' || lower === 'null/' || lower === 'undefined' || lower === 'about:blank') {
    return false
  }

  try {
    const parsed = new URL(trimmed)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname)
  } catch {
    return false
  }
}

/**
 * Configure page with stealth settings to bypass anti-bot detection
 */
async function configureStealthPage(page: Page): Promise<void> {
  const userAgent = getRandomUserAgent()

  // Set enhanced headers
  await page.setExtraHTTPHeaders({
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
  })

  // Override navigator.webdriver and other bot detection signals
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    })

    // Override plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    })

    // Override languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    })

    // Override chrome property
    ;(window as any).chrome = {
      runtime: {},
    }

    // Override permissions
    const originalQuery = window.navigator.permissions.query
    window.navigator.permissions.query = (parameters: any) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters)
  })

  // Set viewport to common desktop resolution
  await page.setViewportSize({ width: 1920, height: 1080 })
}

/**
 * Random delay for human-like behavior
 */
function randomDelay(min: number = 500, max: number = 1500): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min
  return new Promise(resolve => setTimeout(resolve, delay))
}

/**
 * 使用Playwright解析URL（适用于需要JavaScript执行的场景）
 */
export interface PlaywrightResolvedUrl {
  finalUrl: string
  finalUrlSuffix: string
  redirectChain: string[]
  redirectCount: number
  pageTitle: string | null
  statusCode: number | null
}

/**
 * 从连接池获取浏览器上下文（复用实例，减少启动时间）
 * P0优化: 集成代理IP池预热缓存
 */
async function getBrowserFromPool(proxyUrl?: string, targetCountry?: string, userId?: number): Promise<{ browser: Browser; context: BrowserContext; instanceId: string; fromPool: boolean }> {
  return getBrowserFromPoolWithProxyRefresh(proxyUrl, targetCountry, userId, false)
}

async function getBrowserFromPoolWithProxyRefresh(
  proxyUrl?: string,
  targetCountry?: string,
  userId?: number,
  forceRefreshProxy = false
): Promise<{ browser: Browser; context: BrowserContext; instanceId: string; fromPool: boolean }> {
  // 🔥 P0优化: 如果有targetCountry，尝试从代理池获取预热的代理（节省3-5s）
  let proxyCredentials: { host: string; port: number; username: string; password: string } | undefined

  if (targetCountry && !proxyUrl) {
    try {
      const { getProxyPoolManager } = await import('./proxy/proxy-pool')
      const proxyPool = getProxyPoolManager()
      const cachedProxy = await proxyPool.getHealthyProxy(targetCountry)

      if (cachedProxy) {
        proxyCredentials = {
          host: cachedProxy.host,
          port: cachedProxy.port,
          username: cachedProxy.username,
          password: cachedProxy.password,
        }
        console.log(`🔥 [代理池] Cache HIT: ${cachedProxy.host}:${cachedProxy.port} (${targetCountry})`)
      }
    } catch (error: any) {
      console.warn(`⚠️ 代理池获取失败，使用默认代理: ${error.message}`)
    }
  }

  if (proxyUrl && forceRefreshProxy) {
    try {
      const { getProxyIp } = await import('./proxy/fetch-proxy-ip')
      proxyCredentials = await getProxyIp(proxyUrl, true, userId)
      console.log(`🔁 [Playwright] 重试阶段强制刷新代理IP: ${proxyCredentials.host}:${proxyCredentials.port}`)
    } catch (error: any) {
      console.warn(`⚠️ [Playwright] 强制刷新代理IP失败，回退到原有获取逻辑: ${error?.message || error}`)
      proxyCredentials = undefined
    }
  }

  const pool = getPlaywrightPool()
  // 🔥 换链接任务允许使用代理凭证缓存（allowCredentialsCache = true）
  // 因为换链接只是解析 URL，不涉及点击行为，同一个代理 IP 多次使用影响不大
  // 🔥 必须传入 userId 以确保缓存用户级别隔离
  const allowCredentialsCache = !forceRefreshProxy
  const { browser, context, instanceId } = await pool.acquire(
    proxyUrl,
    proxyCredentials,
    targetCountry,
    allowCredentialsCache,
    userId
  )

  return { browser, context, instanceId, fromPool: true }
}

/**
 * 释放浏览器回连接池
 */
function releaseBrowserToPool(instanceId: string): void {
  const pool = getPlaywrightPool()
  pool.release(instanceId)
}

/**
 * 使用Playwright解析Affiliate链接
 * 支持JavaScript重定向和动态内容
 * P0优化: 集成代理IP池预热缓存
 *
 * @param affiliateLink - Offer推广链接
 * @param proxyUrl - 可选的代理URL
 * @param waitTime - 等待页面稳定的时间（毫秒），默认5000
 * @param targetCountry - 目标国家代码，用于代理池缓存（如 'US', 'DE'）
 * @returns 解析后的URL信息
 */
export async function resolveAffiliateLinkWithPlaywright(
  affiliateLink: string,
  proxyUrl?: string,
  waitTime = 5000,
  targetCountry?: string,
  userId?: number,
  forceRefreshProxy = false
): Promise<PlaywrightResolvedUrl> {
  let page: Page | null = null
  let instanceId: string | null = null
  let fromPool = false

  try {
    // 从连接池获取浏览器（复用实例，减少启动时间50%）
    // P0优化: 如果有targetCountry，尝试使用代理IP池预热缓存（节省3-5s）
    const result = await getBrowserFromPoolWithProxyRefresh(
      proxyUrl,
      targetCountry,
      userId,
      forceRefreshProxy
    )
    const { context } = result
    instanceId = result.instanceId
    fromPool = result.fromPool

    // 创建页面
    page = await context.newPage()

    // Apply stealth configuration to bypass anti-bot detection
    await configureStealthPage(page)
    console.log('✅ Stealth配置已应用')

    // Add random delay before navigation (human-like behavior)
    await randomDelay(500, 1500)

    // 记录重定向链
    const redirectChain: string[] = [affiliateLink]

    // 监听页面导航事件
    page.on('framenavigated', (frame) => {
      if (frame === page!.mainFrame()) {
        const url = frame.url()
        if (url !== redirectChain[redirectChain.length - 1]) {
          redirectChain.push(url)
        }
      }
    })

    // 访问推广链接
    console.log(`Playwright访问: ${affiliateLink}`)

    // 使用智能等待策略评估页面复杂度
    const complexity = assessPageComplexity(affiliateLink)
    console.log(`页面复杂度: ${complexity.complexity}, 推荐timeout: ${complexity.recommendedTimeout}ms`)

    const gotoStartTime = Date.now()

    // 基础导航（使用domcontentloaded而不是networkidle，更快）
    const response = await page.goto(affiliateLink, {
      waitUntil: 'domcontentloaded',  // 更快的等待策略
      timeout: complexity.recommendedTimeout,
    })

    // 🔧 检查导航响应
    if (!response) {
      console.error(`❌ Playwright导航失败: 无响应`)
      throw new Error(`Playwright导航失败: 页面无响应，可能是推广链接失效或被拦截`)
    }

    const statusCode = response.status()
    console.log(`   - 响应状态码: ${statusCode}`)

    // 🔥 关键：URL解析阶段不应把4xx当作“无法解析”
    // 例如最终站点对代理/爬虫返回403，但finalUrl仍然是有效落地页URL，后续抓取阶段可用更强手段处理
    if (statusCode >= 400) {
      console.warn(`⚠️ Playwright导航返回HTTP ${statusCode}，将继续返回解析结果（不作为解析失败）`)
    }

    // 只有在非4xx情况下才做额外“页面稳定”等待，避免403/404等错误页浪费等待时间
    const smartWait = statusCode < 400
      ? await smartWaitForLoad(page, affiliateLink, {
        maxWaitTime: waitTime > 0 ? waitTime : complexity.recommendedWaitTime,
      })
      : { waited: 0, signals: ['http_error_skip_wait'] }

    if (statusCode < 400) {
      // Simulate human behavior: scrolling and reading
      await randomDelay(800, 1500)
      await page.evaluate(() => {
        window.scrollBy(0, Math.random() * 500)
      }).catch(() => {})
      await randomDelay(500, 1000)
    }

    const totalWaitTime = Date.now() - gotoStartTime

    console.log(`智能等待完成: ${smartWait.waited}ms, 信号: ${smartWait.signals.join(', ')}`)

    if (statusCode < 400) {
      // 给JS重定向一点额外时间（部分追踪域名会在短延迟后跳转）
      const initialHost = (() => {
        try {
          return normalizeHost(new URL(affiliateLink).hostname)
        } catch {
          return ''
        }
      })()
      const maxRedirectWaitMs = redirectChain.length <= 1 ? 5000 : 2000
      const redirectDeadline = Date.now() + maxRedirectWaitMs
      while (Date.now() < redirectDeadline) {
        const currentUrl = page.url()
        const currentHost = (() => {
          try {
            return normalizeHost(new URL(currentUrl).hostname)
          } catch {
            return ''
          }
        })()
        if (currentUrl !== affiliateLink && currentHost && currentHost !== initialHost) {
          break
        }
        await page.waitForTimeout(200)
      }
    }

    // 记录优化效果（相比固定等待networkidle + waitTime）
    const traditionalWaitTime = 60000  // 传统方式固定60秒
    recordWaitOptimization(traditionalWaitTime, totalWaitTime)

    // 获取最终URL
    const finalFullUrl = page.url()
    const pageTitle = await page.title()

    // 🔧 防御性检查：仅允许可持久化的HTTP(S) URL，避免 chrome-error://... 被写成 null/
    if (!isPersistableFinalUrl(finalFullUrl)) {
      console.error(`❌ Playwright解析失败: 页面URL无效`)
      console.error(`   - page.url(): ${finalFullUrl}`)
      console.error(`   - response.status: ${statusCode}`)
      console.error(`   - redirectChain: ${redirectChain.join(' → ')}`)
      throw new Error(`Playwright解析失败: 页面导航后URL无效 (${finalFullUrl})，可能是推广链接失效或被拦截`)
    }

    // 分离Final URL和Final URL suffix
    const urlObj = new URL(finalFullUrl)
    const finalUrl = `${urlObj.origin}${urlObj.pathname}`
    const finalUrlSuffix = urlObj.search.substring(1)
    const fallbackSuffix = finalUrlSuffix ? '' : extractSuffixFromRedirectChain(redirectChain, finalUrl)
    const resolvedSuffix = finalUrlSuffix || fallbackSuffix

    const redirectCount = redirectChain.length - 1

    console.log(`Playwright解析完成: ${redirectCount}次重定向`)
    console.log(`Final URL: ${finalUrl}`)
    if (!finalUrlSuffix && fallbackSuffix) {
      console.log(`Final URL Suffix(redirect): ${fallbackSuffix.substring(0, 100)}${fallbackSuffix.length > 100 ? '...' : ''}`)
    }

    return {
      finalUrl,
      finalUrlSuffix: resolvedSuffix,
      redirectChain,
      redirectCount,
      pageTitle,
      statusCode,
    }
  } catch (error: any) {
    // 🔥 P1优化：检测代理连接错误，提供更清晰的错误信息
    if (isProxyConnectionError(error)) {
      console.error('❌ Playwright解析失败 - 代理连接问题:', error.message?.substring(0, 100))

      // 🔧 修复(2025-12-25): 代理连接问题时，销毁实例而不是释放回连接池
      // 这样下次重试时会创建新实例，获取新的代理IP
      if (fromPool && instanceId) {
        console.log(`🗑️ 销毁失败的Playwright实例: ${instanceId}`)
        const pool = getPlaywrightPool()
        await pool.invalidate(instanceId)
        fromPool = false  // 标记为已销毁，避免finally块再次处理
      }

      throw new Error(`Playwright解析失败（代理连接问题，建议重试）: ${error.message}`)
    }
    console.error('Playwright解析失败:', error)
    throw new Error(`Playwright解析失败: ${error.message}`)
  } finally {
    // 清理页面资源
    if (page) await page.close().catch(() => {})

    // 释放浏览器回连接池（而不是关闭）
    if (fromPool && instanceId) {
      releaseBrowserToPool(instanceId)
    }
  }
}

/**
 * 验证Final URL是否包含预期的品牌信息
 *
 * @param finalUrl - Final URL
 * @param expectedBrand - 预期的品牌名称
 * @param proxyUrl - 可选的代理URL
 * @returns 验证结果
 */
export async function verifyBrandInFinalUrl(
  finalUrl: string,
  expectedBrand: string,
  proxyUrl?: string
): Promise<{ found: boolean; score: number; matches: string[] }> {
  let page: Page | null = null
  let instanceId: string | null = null
  let fromPool = false

  try {
    const result = await getBrowserFromPool(proxyUrl)
    const { context } = result
    instanceId = result.instanceId
    fromPool = result.fromPool
    page = await context.newPage()

    await page.goto(finalUrl, {
      waitUntil: 'networkidle',
      timeout: 60000, // 增加到60秒
    })

    // 提取页面文本
    const pageText = await page.evaluate(() => document.body.innerText)
    const pageTitle = await page.title()
    const metaDescription =
      (await page.getAttribute('meta[name="description"]', 'content')) || ''

    // 品牌匹配检测
    const brandLower = expectedBrand.toLowerCase()
    const matches: string[] = []

    // 检查URL
    if (finalUrl.toLowerCase().includes(brandLower)) {
      matches.push('URL包含品牌名')
    }

    // 检查标题
    if (pageTitle.toLowerCase().includes(brandLower)) {
      matches.push('页面标题包含品牌名')
    }

    // 检查meta描述
    if (metaDescription.toLowerCase().includes(brandLower)) {
      matches.push('Meta描述包含品牌名')
    }

    // 检查页面内容
    if (pageText.toLowerCase().includes(brandLower)) {
      matches.push('页面内容包含品牌名')
    }

    const found = matches.length > 0
    const score = matches.length / 4 // 最多4个匹配项，满分1.0

    return { found, score, matches }
  } catch (error: any) {
    // 🔥 P1优化：检测代理连接错误
    if (isProxyConnectionError(error)) {
      console.error('❌ 品牌验证失败 - 代理连接问题:', error.message?.substring(0, 100))
    } else {
      console.error('品牌验证失败:', error)
    }
    return { found: false, score: 0, matches: [] }
  } finally {
    if (page) await page.close().catch(() => {})
    if (fromPool && instanceId) {
      releaseBrowserToPool(instanceId)
    }
  }
}

/**
 * 截取Final URL的截图（用于调试和风险检测）
 *
 * @param finalUrl - Final URL
 * @param outputPath - 截图保存路径
 * @param proxyUrl - 可选的代理URL
 */
export async function captureScreenshot(
  finalUrl: string,
  outputPath: string,
  proxyUrl?: string
): Promise<void> {
  let page: Page | null = null
  let instanceId: string | null = null
  let fromPool = false

  try {
    const result = await getBrowserFromPool(proxyUrl)
    const { context } = result
    instanceId = result.instanceId
    fromPool = result.fromPool
    page = await context.newPage()

    await page.goto(finalUrl, {
      waitUntil: 'networkidle',
      timeout: 60000, // 增加到60秒
    })

    await page.screenshot({
      path: outputPath,
      fullPage: true,
    })

    console.log(`截图已保存: ${outputPath}`)
  } catch (error: any) {
    // 🔥 P1优化：检测代理连接错误
    if (isProxyConnectionError(error)) {
      console.error('❌ 截图失败 - 代理连接问题:', error.message?.substring(0, 100))
      throw new Error(`截图失败（代理连接问题）: ${error.message}`)
    }
    console.error('截图失败:', error)
    throw new Error(`截图失败: ${error.message}`)
  } finally {
    if (page) await page.close().catch(() => {})
    if (fromPool && instanceId) {
      releaseBrowserToPool(instanceId)
    }
  }
}
