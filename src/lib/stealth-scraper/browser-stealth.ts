/**
 * Browser Stealth Configuration
 *
 * Browser fingerprint spoofing and anti-detection measures
 */

import { chromium, Page } from 'playwright'
import { getProxyIp } from '../proxy/fetch-proxy-ip'
import { maskProxyUrl } from '../proxy/validate-url'
import { getProxyPoolManager } from '../proxy/proxy-pool'
import { getPlaywrightPool } from '../playwright-pool'
import { assessPageComplexity } from '../smart-wait-strategy'
import type { StealthBrowserResult } from './types'

// 标记是否使用连接池（便于测试和回退）
const USE_POOL = true

const PROXY_URL = process.env.PROXY_URL || ''

/**
 * User-Agent rotation pool (2024 browsers)
 */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
]

/**
 * Get random User-Agent
 */
export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

/**
 * Random delay between min and max milliseconds (human-like behavior)
 */
export function randomDelay(min: number = 1000, max: number = 3000): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min
  return new Promise(resolve => setTimeout(resolve, delay))
}

/**
 * 🔥 P1优化: 根据URL动态计算超时时间
 * 基于页面复杂度自动调整，避免固定超时
 */
export function getDynamicTimeout(url: string): number {
  const complexity = assessPageComplexity(url)
  console.log(`📊 页面复杂度: ${complexity.complexity}, 推荐timeout: ${complexity.recommendedTimeout}ms (URL: ${url})`)
  return complexity.recommendedTimeout
}

/**
 * Create stealth browser context
 * P0优化: 优先使用连接池，减少80-90%启动时间
 * P0优化: 集成代理IP池预热缓存，节省3-5s
 */
export async function createStealthBrowser(proxyUrl?: string, targetCountry?: string, userId?: number): Promise<StealthBrowserResult> {
  // 🔴 根据需求10：必须使用代理，不允许降级为直连访问
  const effectiveProxyUrl = proxyUrl || PROXY_URL
  if (!effectiveProxyUrl || typeof effectiveProxyUrl !== 'string') {
    throw new Error('❌ 代理配置缺失：根据需求10，必须配置代理URL(PROXY_URL环境变量或传入customProxyUrl参数)，不允许直连访问')
  }

  // 🔥 P0增强: 明确记录targetCountry配置状态
  console.log(`🌍 createStealthBrowser: targetCountry=${targetCountry || '(未指定，使用默认en-US)'}, proxyUrl=${maskProxyUrl(effectiveProxyUrl)}`)

  // 🔥 P0优化: 使用连接池获取实例（传入targetCountry支持动态语言配置）
  if (USE_POOL) {
    try {
      const pool = getPlaywrightPool()
      const { browser, context, instanceId } = await pool.acquire(effectiveProxyUrl, undefined, targetCountry, false, userId)
      console.log(`🔄 [连接池] 获取Playwright实例: ${instanceId}`)
      return { browser, context, instanceId, fromPool: true }
    } catch (poolError: any) {
      console.warn(`⚠️ 连接池获取失败，降级为独立创建: ${poolError.message}`)
      // 降级为传统方式
    }
  }

  // 传统方式：独立创建浏览器实例
  // 🔥 P0优化: 尝试使用代理IP池预热缓存（cache hit = 节省3-5s）
  let proxy: any = null

  if (targetCountry) {
    try {
      const proxyPool = getProxyPoolManager()
      const cachedProxy = await proxyPool.getHealthyProxy(targetCountry)
      if (cachedProxy) {
        proxy = {
          ...cachedProxy,
          fullAddress: `${cachedProxy.host}:${cachedProxy.port}:${cachedProxy.username || ''}:${cachedProxy.password || ''}`
        }
        console.log(`🔥 [代理池] Cache HIT: ${proxy?.host}:${proxy?.port} (${targetCountry})`)
      }
    } catch (poolError: any) {
      console.warn(`⚠️ 代理池获取失败，降级为直接fetch: ${poolError.message}`)
    }
  }

  // 如果代理池未命中，降级为传统getProxyIp（启用5分钟缓存）
  if (!proxy) {
    proxy = await getProxyIp(effectiveProxyUrl, userId ? false : true, userId)
    console.log(`🔒 [独立] 使用代理: ${proxy.host}:${proxy.port}`)
  }

  // Launch browser with stealth settings
  const browser = await chromium.launch({
    headless: true, // Use headless for production
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-setuid-sandbox',
      '--no-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
    ],
    proxy: {
      server: `http://${proxy.host}:${proxy.port}`,
      username: proxy.username,
      password: proxy.password,
    },
  })

  const context = await browser.newContext({
    userAgent: getRandomUserAgent(),
  })

  return { browser, context, proxy, fromPool: false }
}

/**
 * 释放浏览器实例（连接池模式返回池，独立模式关闭）
 */
export async function releaseBrowser(result: StealthBrowserResult): Promise<void> {
  if (result.fromPool && result.instanceId) {
    const pool = getPlaywrightPool()
    pool.release(result.instanceId)
    console.log(`✅ [连接池] 释放实例: ${result.instanceId}`)
  } else {
    await result.context?.close().catch(() => {})
    await result.browser?.close().catch(() => {})
    console.log(`✅ [独立] 关闭浏览器实例`)
  }
}

/**
 * Configure page with stealth settings
 * 🔥 增强反爬虫规避：更多浏览器指纹伪装和行为模拟
 * 🌍 支持根据目标国家动态配置语言
 */
export async function configureStealthPage(page: Page, targetCountry?: string): Promise<void> {
  const userAgent = getRandomUserAgent()

  // 🌍 根据目标国家动态生成 Accept-Language
  let acceptLanguage = 'en-US,en;q=0.9'  // 默认英语
  let navigatorLanguages = ['en-US', 'en']  // 默认语言列表

  if (targetCountry) {
    const { getLanguageCodeForCountry, getAcceptLanguageHeader } = await import('../language-country-codes')
    const langCode = getLanguageCodeForCountry(targetCountry)
    acceptLanguage = getAcceptLanguageHeader(langCode)

    // 从 Accept-Language 解析出语言列表
    navigatorLanguages = acceptLanguage.split(',').map(lang => lang.split(';')[0].trim())

    console.log(`🌍 目标国家: ${targetCountry}, Accept-Language: ${acceptLanguage}`)
  }

  // 🔥 2025-12-11优化: 根据User-Agent生成匹配的Sec-CH-UA头部
  // 避免UA和Sec-CH-UA不匹配被检测
  let secChUa = '"Chromium";v="131", "Not_A Brand";v="24"'
  let secChUaPlatform = '"Windows"'

  if (userAgent.includes('Macintosh')) {
    secChUaPlatform = '"macOS"'
  } else if (userAgent.includes('Linux')) {
    secChUaPlatform = '"Linux"'
  }

  if (userAgent.includes('Chrome/131')) {
    secChUa = '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"'
  } else if (userAgent.includes('Chrome/130')) {
    secChUa = '"Google Chrome";v="130", "Chromium";v="130", "Not_A Brand";v="24"'
  } else if (userAgent.includes('Firefox')) {
    // Firefox不发送Sec-CH-UA
    secChUa = ''
  } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
    // Safari也不发送Sec-CH-UA
    secChUa = ''
  } else if (userAgent.includes('Edg/')) {
    secChUa = '"Microsoft Edge";v="130", "Chromium";v="130", "Not_A Brand";v="24"'
  }

  // Set user agent with realistic headers
  const headers: Record<string, string> = {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': acceptLanguage,  // 🌍 动态语言支持
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    // 🔥 添加DNT
    'DNT': '1',
  }

  // 只有Chrome/Edge才发送Sec-CH-UA头部
  if (secChUa) {
    headers['Sec-CH-UA'] = secChUa
    headers['Sec-CH-UA-Mobile'] = '?0'
    headers['Sec-CH-UA-Platform'] = secChUaPlatform
  }

  await page.setExtraHTTPHeaders(headers)

  // 🎲 P0优化: 随机化硬件参数（避免所有请求使用相同值）
  const hardwareConcurrency = [4, 8, 16][Math.floor(Math.random() * 3)]
  const deviceMemory = [4, 8, 16][Math.floor(Math.random() * 3)]

  // 🔥 增强浏览器指纹伪装（需要将动态语言传入脚本）
  const languagesForScript = navigatorLanguages
  await page.addInitScript(({ langs, hwConcurrency, devMemory }: { langs: string[], hwConcurrency: number, devMemory: number }) => {
    // ===== P0优化: Canvas指纹混淆 =====
    const getImageData = HTMLCanvasElement.prototype.toDataURL
    HTMLCanvasElement.prototype.toDataURL = function(type?: string) {
      const context = this.getContext('2d')
      if (context) {
        const originalImageData = context.getImageData(0, 0, this.width, this.height)
        // 在随机像素点添加微小噪声（人眼不可见）
        for (let i = 0; i < originalImageData.data.length; i += Math.floor(Math.random() * 10) + 1) {
          originalImageData.data[i] = Math.min(255, originalImageData.data[i] + Math.floor(Math.random() * 5) - 2)
        }
        context.putImageData(originalImageData, 0, 0)
      }
      return getImageData.call(this, type)
    }

    // ===== P0优化: WebGL指纹混淆 =====
    const getParameter = WebGLRenderingContext.prototype.getParameter
    WebGLRenderingContext.prototype.getParameter = function(parameter: number) {
      // 伪装GPU供应商和渲染器（最常见的检测点）
      if (parameter === 37445) return 'Intel Inc.'  // UNMASKED_VENDOR_WEBGL
      if (parameter === 37446) return 'Intel Iris OpenGL Engine'  // UNMASKED_RENDERER_WEBGL
      return getParameter.call(this, parameter)
    }

    // WebGL2也需要处理
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const getParameter2 = WebGL2RenderingContext.prototype.getParameter
      WebGL2RenderingContext.prototype.getParameter = function(parameter: number) {
        if (parameter === 37445) return 'Intel Inc.'
        if (parameter === 37446) return 'Intel Iris OpenGL Engine'
        return getParameter2.call(this, parameter)
      }
    }

    // ===== P0优化: AudioContext指纹混淆 =====
    const AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext
    if (AudioContext) {
      const originalCreateAnalyser = AudioContext.prototype.createAnalyser
      AudioContext.prototype.createAnalyser = function() {
        const analyser = originalCreateAnalyser.call(this)
        const originalGetFloatFrequencyData = analyser.getFloatFrequencyData
        analyser.getFloatFrequencyData = function(array: Float32Array) {
          originalGetFloatFrequencyData.call(this, array)
          // 添加微小随机噪声混淆音频指纹
          for (let i = 0; i < array.length; i++) {
            array[i] += (Math.random() - 0.5) * 0.0001
          }
          return array
        }
        return analyser
      }
    }

    // Override navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    })

    // 🔥 伪装Chrome运行时
    const win = window as any
    win.chrome = {
      runtime: {},
      loadTimes: function() {},
      csi: function() {},
      app: {}
    }

    // Override plugins with realistic values
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
      ],
    })

    // 🌍 动态语言列表（根据目标国家）
    Object.defineProperty(navigator, 'languages', {
      get: () => langs,
    })

    // ===== P1优化: 完善Screen对象 =====
    Object.defineProperty(screen, 'width', { get: () => 1920 })
    Object.defineProperty(screen, 'height', { get: () => 1080 })
    Object.defineProperty(screen, 'availWidth', { get: () => 1920 })
    Object.defineProperty(screen, 'availHeight', { get: () => 1040 })  // 减去任务栏
    Object.defineProperty(screen, 'colorDepth', { get: () => 24 })
    Object.defineProperty(screen, 'pixelDepth', { get: () => 24 })

    // ===== P1优化: 主动屏蔽WebRTC =====
    Object.defineProperty(navigator, 'mediaDevices', { get: () => undefined })

    // ===== P0优化: 随机化硬件参数 =====
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => hwConcurrency })
    Object.defineProperty(navigator, 'deviceMemory', { get: () => devMemory })

    // Override permissions
    const originalQuery = window.navigator.permissions.query
    window.navigator.permissions.query = (parameters: any) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters)

    // 🔥 伪装Battery API
    Object.defineProperty(navigator, 'getBattery', {
      value: () => Promise.resolve({
        charging: true,
        chargingTime: 0,
        dischargingTime: Infinity,
        level: 1.0,
      })
    })

    // 🔥 伪装Connection API
    Object.defineProperty(navigator, 'connection', {
      get: () => ({
        effectiveType: '4g',
        downlink: 10,
        rtt: 50,
        saveData: false,
      })
    })

    // ===== P2优化: 隐藏iframe contentWindow =====
    try {
      const originalContentWindowGetter = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')?.get
      if (originalContentWindowGetter) {
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
          get: function() {
            const win = originalContentWindowGetter.call(this)
            if (win) {
              try {
                win.navigator.webdriver = undefined
              } catch (e) {}
            }
            return win
          }
        })
      }
    } catch (e) {}

    // ===== P2优化: 隐藏console.debug =====
    const consoleDebug = console.debug
    console.debug = function() {
      return null
    }
  }, { langs: languagesForScript, hwConcurrency: hardwareConcurrency, devMemory: deviceMemory })

  // 🔥 设置真实的viewport和屏幕分辨率
  await page.setViewportSize({ width: 1920, height: 1080 })

  // 🔥 模拟鼠标移动（人类行为）
  await page.mouse.move(Math.random() * 100, Math.random() * 100)
}
