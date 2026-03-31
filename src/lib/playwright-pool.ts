/**
 * Playwright浏览器连接池 v2
 *
 * 目标: 支持更高并发抓取
 * 优化:
 * - 扩容到10个实例
 * - 支持同一代理多实例（并发抓取）
 * - 添加等待队列机制
 * - 预热功能
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright'
import { maskProxyUrl } from './proxy/validate-url'

/**
 * 连接池配置
 * 🔥 2025-12-12 内存优化：
 * - 减少最大实例数：10 → 5（配合深度抓取复用Context优化）
 * - 缩短空闲时间：5分钟 → 1分钟（更快释放内存）
 * - 减少每代理实例数：5 → 2（避免同一代理过多实例）
 */
const POOL_CONFIG = {
  maxInstances: 8,              // 调整：从5提升到8，减少高并发等待
  maxInstancesPerProxy: 3,      // 🔥 放宽：避免高并发场景频繁等待超时
  maxIdleTime: 60 * 1000,       // 🔥 内存优化：从5分钟减到1分钟
  launchTimeout: 30000,         // 启动超时30秒
  acquireTimeout: 180000,       // 获取实例超时（短链/慢代理可能占用更久）
  warmupCount: 1,               // 🔥 内存优化：从2减到1
}

function formatProxyKeyForLog(proxyKey: string): string {
  if (!proxyKey) return proxyKey
  return proxyKey.includes('://') ? maskProxyUrl(proxyKey) : proxyKey
}

/**
 * 浏览器实例信息
 */
interface BrowserInstance {
  id: string                    // 实例唯一ID
  browser: Browser
  context: BrowserContext
  contextOptions: any           // 保存context配置供复用
  proxyKey: string              // 代理配置的唯一标识
  createdAt: number
  lastUsedAt: number
  inUse: boolean
}

/**
 * 等待队列项
 */
interface WaitingRequest {
  proxyKey: string
  targetCountry?: string  // 🌍 增加目标国家字段
  resolve: (result: { browser: Browser; context: BrowserContext; instanceId: string }) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

/**
 * 连接池 v2
 */
class PlaywrightPool {
  private instances: Map<string, BrowserInstance> = new Map()
  private waitingQueue: WaitingRequest[] = []
  private cleanupInterval: NodeJS.Timeout | null = null
  private instanceCounter = 0

  // 🔥 User-Agent池，供contextOptions生成使用
  private static readonly USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  ]

  // 🌍 国家配置映射
  private static readonly COUNTRY_CONFIG: Record<string, { locale: string; timezone: string }> = {
    'US': { locale: 'en-US', timezone: 'America/New_York' },
    'GB': { locale: 'en-GB', timezone: 'Europe/London' },
    'UK': { locale: 'en-GB', timezone: 'Europe/London' },
    'DE': { locale: 'de-DE', timezone: 'Europe/Berlin' },
    'FR': { locale: 'fr-FR', timezone: 'Europe/Paris' },
    'IT': { locale: 'it-IT', timezone: 'Europe/Rome' },
    'ES': { locale: 'es-ES', timezone: 'Europe/Madrid' },
    'JP': { locale: 'ja-JP', timezone: 'Asia/Tokyo' },
    'CA': { locale: 'en-CA', timezone: 'America/Toronto' },
    'AU': { locale: 'en-AU', timezone: 'Australia/Sydney' },
    'NL': { locale: 'nl-NL', timezone: 'Europe/Amsterdam' },
    'BR': { locale: 'pt-BR', timezone: 'America/Sao_Paulo' },
    'MX': { locale: 'es-MX', timezone: 'America/Mexico_City' },
    'IN': { locale: 'en-IN', timezone: 'Asia/Kolkata' },
    'PL': { locale: 'pl-PL', timezone: 'Europe/Warsaw' },
    'SE': { locale: 'sv-SE', timezone: 'Europe/Stockholm' },
    'BE': { locale: 'nl-BE', timezone: 'Europe/Brussels' },
    'AT': { locale: 'de-AT', timezone: 'Europe/Vienna' },
    'CH': { locale: 'de-CH', timezone: 'Europe/Zurich' },
  }

  constructor() {
    // 启动定期清理任务
    this.startCleanupTask()
  }

  /**
   * 🔥 根据目标国家动态生成contextOptions
   * P0修复: 复用实例时必须使用当前targetCountry生成新的配置
   */
  private generateContextOptions(targetCountry?: string): any {
    const randomUserAgent = PlaywrightPool.USER_AGENTS[Math.floor(Math.random() * PlaywrightPool.USER_AGENTS.length)]

    let locale = 'en-US'
    let timezoneId = 'America/New_York'

    if (targetCountry) {
      const config = PlaywrightPool.COUNTRY_CONFIG[targetCountry.toUpperCase()]
      if (config) {
        locale = config.locale
        timezoneId = config.timezone
        console.log(`🌍 [contextOptions] 目标国家: ${targetCountry}, locale: ${locale}, timezone: ${timezoneId}`)
      }
    }

    return {
      userAgent: randomUserAgent,
      viewport: { width: 1920, height: 1080 },
      locale: locale,
      timezoneId: timezoneId,
    }
  }

  /**
   * 生成唯一实例ID
   */
  private generateInstanceId(): string {
    return `instance_${++this.instanceCounter}_${Date.now()}`
  }

  /**
   * 🔥 为context添加stealth脚本（增强版：Canvas/WebGL指纹混淆）
   * P0修复: 之前的plugins=[1,2,3,4,5]是严重错误，导致Amazon检测到机器人
   * P0增强: 添加Canvas/WebGL/AudioContext指纹混淆，防止高级反爬虫检测
   */
  private async addStealthScripts(context: BrowserContext, targetCountry?: string): Promise<void> {
    // 🌍 根据目标国家动态生成语言配置
    let navigatorLanguages = ['en-US', 'en']  // 默认英语

    if (targetCountry) {
      const countryLanguageMap: Record<string, string[]> = {
        'US': ['en-US', 'en'],
        'GB': ['en-GB', 'en'],
        'UK': ['en-GB', 'en'],
        'DE': ['de-DE', 'de', 'en'],
        'FR': ['fr-FR', 'fr', 'en'],
        'IT': ['it-IT', 'it', 'en'],
        'ES': ['es-ES', 'es', 'en'],
        'JP': ['ja-JP', 'ja', 'en'],
        'CA': ['en-CA', 'en', 'fr'],
        'AU': ['en-AU', 'en'],
        'NL': ['nl-NL', 'nl', 'en'],
        'BR': ['pt-BR', 'pt', 'en'],
        'MX': ['es-MX', 'es', 'en'],
        'IN': ['en-IN', 'en', 'hi'],
        'PL': ['pl-PL', 'pl', 'en'],
        'SE': ['sv-SE', 'sv', 'en'],
        'BE': ['nl-BE', 'fr-BE', 'nl', 'fr', 'en'],
        'AT': ['de-AT', 'de', 'en'],
        'CH': ['de-CH', 'fr-CH', 'it-CH', 'de', 'fr', 'it', 'en'],
      }
      navigatorLanguages = countryLanguageMap[targetCountry.toUpperCase()] || ['en-US', 'en']
    }

    // 🎲 P0优化: 随机化硬件参数（避免所有请求使用相同值）
    const hardwareConcurrency = [4, 8, 16][Math.floor(Math.random() * 3)]
    const deviceMemory = [4, 8, 16][Math.floor(Math.random() * 3)]

    const languagesForScript = navigatorLanguages

    await context.addInitScript(({ langs, hwConcurrency, devMemory }: { langs: string[], hwConcurrency: number, devMemory: number }) => {
      // ===== 基础反检测 =====

      // Override navigator.webdriver
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      })

      // 🔥 伪装Chrome运行时（关键！）
      const win = window as any
      win.chrome = {
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
        app: {}
      }

      // 🔥 P0修复: 使用真实的plugins对象结构（之前是[1,2,3,4,5]是严重错误）
      // 🔥 P0增强: 添加完整的Plugin对象属性、length、item()、namedItem()方法
      const pluginsArray: any[] = [
        {
          0: { type: "application/pdf", suffixes: "pdf", description: "Portable Document Format" },
          description: "Portable Document Format",
          filename: "internal-pdf-viewer",
          length: 1,
          name: "Chrome PDF Plugin",
          item: function(index: number) { return index === 0 ? this[0] : null; },
        },
        {
          0: { type: "application/x-google-chrome-pdf", suffixes: "pdf", description: "Portable Document Format" },
          description: "Portable Document Format",
          filename: "internal-pdf-viewer",
          length: 1,
          name: "Chrome PDF Viewer",
          item: function(index: number) { return index === 0 ? this[0] : null; },
        },
        {
          0: { type: "application/x-nacl", suffixes: "", description: "Native Client Executable" },
          1: { type: "application/x-pnacl", suffixes: "", description: "Portable Native Client Executable" },
          description: "Native Client",
          filename: "internal-nacl-plugin",
          length: 2,
          name: "Native Client",
          item: function(index: number) {
            if (index === 0) return this[0];
            if (index === 1) return this[1];
            return null;
          },
        },
      ];

      // 添加PluginArray的length属性
      Object.defineProperty(pluginsArray, 'length', {
        get: () => 3,
        configurable: true,
      });

      // 添加PluginArray的item()方法
      Object.defineProperty(pluginsArray, 'item', {
        value: function(index: number) {
          return this[index] || null;
        },
        configurable: true,
      });

      // 添加PluginArray的namedItem()方法
      Object.defineProperty(pluginsArray, 'namedItem', {
        value: function(name: string) {
          return this.find((p: any) => p.name === name) || null;
        },
        configurable: true,
      });

      // 添加PluginArray的refresh()方法（兼容性）
      Object.defineProperty(pluginsArray, 'refresh', {
        value: function() {
          // 空实现，保持兼容性
        },
        configurable: true,
      });

      Object.defineProperty(navigator, 'plugins', {
        get: () => pluginsArray,
        configurable: true,
      })

      // 🌍 动态语言列表（根据目标国家）
      Object.defineProperty(navigator, 'languages', {
        get: () => langs,
      })

      // ===== 硬件参数伪装 =====

      // 🔥 伪装真实屏幕分辨率和颜色深度
      Object.defineProperty(screen, 'colorDepth', {
        get: () => 24,
      })
      Object.defineProperty(screen, 'pixelDepth', {
        get: () => 24,
      })

      // 🎲 P0优化: 随机化硬件并发数（4/8/16核）
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => hwConcurrency,
      })

      // 🎲 P0优化: 随机化设备内存（4/8/16GB）
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => devMemory,
      })

      // ===== P1增强: 完善Screen对象 =====

      Object.defineProperty(screen, 'width', {
        get: () => 1920,
      })
      Object.defineProperty(screen, 'height', {
        get: () => 1080,
      })
      Object.defineProperty(screen, 'availWidth', {
        get: () => 1920,
      })
      Object.defineProperty(screen, 'availHeight', {
        get: () => 1040,  // 减去任务栏高度
      })

      // ===== Permissions API =====

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

      // ===== P1增强: 主动屏蔽WebRTC =====

      Object.defineProperty(navigator, 'mediaDevices', {
        get: () => undefined,
      })

      // ===== P0增强: Canvas指纹混淆 =====

      const getImageData = HTMLCanvasElement.prototype.toDataURL
      HTMLCanvasElement.prototype.toDataURL = function(type?: string) {
        // 🎲 添加随机噪声混淆Canvas指纹
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

      // ===== P0增强: WebGL指纹混淆 =====

      const getParameter = WebGLRenderingContext.prototype.getParameter
      WebGLRenderingContext.prototype.getParameter = function(parameter: number) {
        // 🎭 伪装关键WebGL参数
        if (parameter === 37445) {  // UNMASKED_VENDOR_WEBGL
          return 'Intel Inc.'
        }
        if (parameter === 37446) {  // UNMASKED_RENDERER_WEBGL
          return 'Intel Iris OpenGL Engine'
        }
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

      // ===== P0增强: AudioContext指纹混淆 =====

      const AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext
      if (AudioContext) {
        const originalCreateAnalyser = AudioContext.prototype.createAnalyser
        AudioContext.prototype.createAnalyser = function() {
          const analyser = originalCreateAnalyser.call(this)
          const originalGetFloatFrequencyData = analyser.getFloatFrequencyData
          analyser.getFloatFrequencyData = function(array: Float32Array) {
            originalGetFloatFrequencyData.call(this, array)
            // 🎲 添加微小噪声混淆AudioContext指纹
            for (let i = 0; i < array.length; i++) {
              array[i] += (Math.random() - 0.5) * 0.0001
            }
            return array
          }
          return analyser
        }
      }

      // ===== P2增强: 其他反检测措施 =====

      // 隐藏iframe contentWindow检测
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        get: function() {
          const win = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')
          return win ? win.get?.call(this) : null
        }
      })

      // 隐藏console.debug特征
      const originalDebug = console.debug
      console.debug = function() {
        // 静默处理，不输出
      }

    }, { langs: languagesForScript, hwConcurrency: hardwareConcurrency, devMemory: deviceMemory })
  }

  /**
   * 统计指定代理的实例数
   */
  private countInstancesForProxy(proxyKey: string): number {
    let count = 0
    for (const instance of this.instances.values()) {
      if (instance.proxyKey === proxyKey) {
        count++
      }
    }
    return count
  }

  /**
   * 查找可复用的空闲实例
   */
  private findIdleInstance(proxyKey: string): BrowserInstance | null {
    for (const instance of this.instances.values()) {
      if (instance.proxyKey === proxyKey && !instance.inUse) {
        return instance
      }
    }
    return null
  }

  /**
   * 获取或创建浏览器实例
   * @param proxyUrl - 代理API URL（会调用getProxyIp获取凭证）
   * @param proxyCredentials - 直接传入的代理凭证（来自代理池缓存，跳过API调用）
   * @param targetCountry - 目标国家（用于动态语言配置）
   * @param allowCredentialsCache - 是否允许使用代理凭证缓存（默认 false，确保每次获取新 IP）
   * @param userId - 用户ID（用于代理IP缓存隔离）
   */
  async acquire(
    proxyUrl?: string,
    proxyCredentials?: { host: string; port: number; username: string; password: string },
    targetCountry?: string,
    allowCredentialsCache: boolean = false,
    userId?: number
  ): Promise<{ browser: Browser; context: BrowserContext; instanceId: string }> {
    // 生成proxyKey用于实例匹配
    const proxyKey = proxyCredentials
      ? `${proxyCredentials.host}:${proxyCredentials.port}`
      : (proxyUrl || 'no-proxy')

    // 1. 尝试复用现有空闲实例
    const existing = this.findIdleInstance(proxyKey)
    if (existing) {
      // 🔒 先标记为占用，避免并发获取同一实例导致context被重复关闭
      existing.inUse = true
      existing.lastUsedAt = Date.now()
      try {
        // 验证实例是否仍然有效
        const isConnected = existing.browser.isConnected()
        if (isConnected) {
          // 🔥 P0修复: 复用实例时，必须根据当前targetCountry动态生成contextOptions
          // 不能使用existing.contextOptions，因为它可能包含旧的locale/timezone配置
          const dynamicContextOptions = this.generateContextOptions(targetCountry)

          // 关闭旧context，创建新context（避免状态污染）
          await existing.context.close().catch(() => {})
          const newContext = await existing.browser.newContext(dynamicContextOptions)

          // 🔥 关键：为复用的context添加stealth脚本（传入targetCountry）
          await this.addStealthScripts(newContext, targetCountry)

          existing.context = newContext
          existing.inUse = true
          existing.lastUsedAt = Date.now()
          console.log(`🔄 复用Playwright实例: ${existing.id} (${formatProxyKeyForLog(proxyKey)})`)
          return { browser: existing.browser, context: newContext, instanceId: existing.id }
        } else {
          // 实例已断开，清理
          console.log(`❌ 实例已断开，清理: ${existing.id}`)
          await existing.context?.close().catch(() => {})
          await existing.browser?.close().catch(() => {})
          this.instances.delete(existing.id)
        }
      } catch (error) {
        console.warn('实例验证失败，清理:', error)
        await existing.context?.close().catch(() => {})
        await existing.browser?.close().catch(() => {})
        this.instances.delete(existing.id)
        existing.inUse = false
      }
    }

    // 2. 检查是否可以创建新实例
    const proxyInstanceCount = this.countInstancesForProxy(proxyKey)
    const canCreateForProxy = proxyInstanceCount < POOL_CONFIG.maxInstancesPerProxy
    const canCreateGlobal = this.instances.size < POOL_CONFIG.maxInstances

    if (canCreateForProxy && canCreateGlobal) {
      // 直接创建新实例
      return await this.createAndRegisterInstance(proxyUrl, proxyCredentials, targetCountry, allowCredentialsCache, userId)
    }

    // 3. 尝试清理空闲实例腾出空间
    if (!canCreateGlobal) {
      await this.cleanupIdleInstances()

      if (this.instances.size < POOL_CONFIG.maxInstances) {
        return await this.createAndRegisterInstance(proxyUrl, undefined, targetCountry, allowCredentialsCache, userId)
      }

      // 清理最旧的实例
      await this.cleanupOldestInstance()
      if (this.instances.size < POOL_CONFIG.maxInstances) {
        return await this.createAndRegisterInstance(proxyUrl, undefined, targetCountry, allowCredentialsCache, userId)
      }
    }

    // 4. 加入等待队列
    console.log(`⏳ 实例池已满，加入等待队列: ${formatProxyKeyForLog(proxyKey)}`)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waitingQueue.findIndex(w => w.resolve === resolve)
        if (index !== -1) {
          this.waitingQueue.splice(index, 1)
        }
        reject(new Error(`获取Playwright实例超时 (${POOL_CONFIG.acquireTimeout}ms)`))
      }, POOL_CONFIG.acquireTimeout)

      this.waitingQueue.push({
        proxyKey,
        targetCountry,  // 🌍 保存目标国家信息
        resolve,
        reject,
        timeout,
      })
    })
  }

  /**
   * 创建并注册新实例
   */
  private async createAndRegisterInstance(
    proxyUrl?: string,
    proxyCredentials?: { host: string; port: number; username: string; password: string },
    targetCountry?: string,
    allowCredentialsCache: boolean = false,
    userId?: number
  ): Promise<{ browser: Browser; context: BrowserContext; instanceId: string }> {
    const proxyKey = proxyCredentials
      ? `${proxyCredentials.host}:${proxyCredentials.port}`
      : (proxyUrl || 'no-proxy')
    const instanceId = this.generateInstanceId()

    console.log(`🚀 创建新Playwright实例: ${instanceId} (${formatProxyKeyForLog(proxyKey)})`)
    const { browser, context, contextOptions } = await this.createInstance(proxyUrl, proxyCredentials, targetCountry, allowCredentialsCache, userId)

    const instance: BrowserInstance = {
      id: instanceId,
      browser,
      context,
      contextOptions,
      proxyKey,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      inUse: true,
    }

    this.instances.set(instanceId, instance)
    console.log(`📊 连接池状态: ${this.instances.size}/${POOL_CONFIG.maxInstances} 实例`)

    return { browser, context, instanceId }
  }

  /**
   * 释放浏览器实例（标记为可复用）
   */
  release(instanceId: string): void {
    const instance = this.instances.get(instanceId)

    if (instance) {
      instance.inUse = false
      instance.lastUsedAt = Date.now()
      console.log(`✅ 释放Playwright实例: ${instanceId}`)

      // 检查等待队列，唤醒等待的请求
      this.processWaitingQueue()
    }
  }

  /**
   * 🔥 P1优化：作废并关闭指定实例（用于代理失效场景）
   * 当检测到代理连接问题时调用此方法，强制关闭失效实例
   */
  async invalidate(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId)
    if (instance) {
      console.log(`🗑️ 作废并关闭失效实例: ${instanceId}`)
      try {
        await instance.context?.close().catch(() => {})
        await instance.browser?.close().catch(() => {})
      } catch (e) {
        // 忽略关闭错误
      }
      this.instances.delete(instanceId)
    }
  }

  /**
   * 🔥 P1优化：清理所有空闲实例（public方法，用于代理重试场景）
   */
  async clearIdleInstances(): Promise<number> {
    let clearedCount = 0
    const idleInstances = Array.from(this.instances.entries())
      .filter(([_, instance]) => !instance.inUse)

    for (const [key, instance] of idleInstances) {
      try {
        await instance.context?.close().catch(() => {})
        await instance.browser?.close().catch(() => {})
        this.instances.delete(key)
        clearedCount++
      } catch (e) {
        // 忽略关闭错误
      }
    }

    if (clearedCount > 0) {
      console.log(`🧹 清理了 ${clearedCount} 个空闲实例`)
    }
    return clearedCount
  }

  /**
   * 处理等待队列
   */
  private async processWaitingQueue(): Promise<void> {
    if (this.waitingQueue.length === 0) return

    // 查找可以服务的等待请求
    for (let i = 0; i < this.waitingQueue.length; i++) {
      const waiting = this.waitingQueue[i]
      const idleInstance = this.findIdleInstance(waiting.proxyKey)

      if (idleInstance) {
        // 🔒 先标记为占用，避免并发复用同一实例
        idleInstance.inUse = true
        idleInstance.lastUsedAt = Date.now()
        // 移除等待请求
        this.waitingQueue.splice(i, 1)
        clearTimeout(waiting.timeout)

        try {
          // 复用实例
          await idleInstance.context.close().catch(() => {})
          const newContext = await idleInstance.browser.newContext(idleInstance.contextOptions)

          // 🔥 关键：为复用的context添加stealth脚本（传入targetCountry）
          await this.addStealthScripts(newContext, waiting.targetCountry)

          idleInstance.context = newContext
          idleInstance.inUse = true
          idleInstance.lastUsedAt = Date.now()

          console.log(`🔄 从队列唤醒，复用实例: ${idleInstance.id}`)
          waiting.resolve({ browser: idleInstance.browser, context: newContext, instanceId: idleInstance.id })
        } catch (error) {
          idleInstance.inUse = false
          waiting.reject(error as Error)
        }
        return
      }
    }
  }

  /**
   * 创建新的浏览器实例
   */
  private async createInstance(
    proxyUrl?: string,
    proxyCredentials?: { host: string; port: number; username: string; password: string },
    targetCountry?: string,
    allowCredentialsCache: boolean = false,
    userId?: number
  ): Promise<{ browser: Browser; context: BrowserContext; contextOptions: any }> {
    // 🔥 代理必须在browser.launch时配置，无法在newContext时动态配置
    let launchOptions: any = {
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled', // 🔥 反爬虫关键参数
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--no-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
      ],
      timeout: POOL_CONFIG.launchTimeout,
    }

    // 如果提供了直接的代理凭证（来自代理池缓存），直接使用
    let proxy: any = null
    if (proxyCredentials) {
      proxy = proxyCredentials
      console.log(`🔒 [代理池] 使用代理: ${proxy.host}:${proxy.port}`)
    } else if (proxyUrl) {
      // 🔥 根据 allowCredentialsCache 和 userId 决定是否使用缓存
      // - 换链接任务: allowCredentialsCache = true + userId，启用用户级别缓存
      // - 补点击任务: allowCredentialsCache = false，每次获取新 IP
      const { getProxyIp } = await import('./proxy/fetch-proxy-ip')
      if (allowCredentialsCache && userId) {
        proxy = await getProxyIp(proxyUrl, false, userId) // 启用用户级别缓存
        console.log(`🔒 [API+缓存] 使用代理: ${proxy.host}:${proxy.port}`)
      } else {
        proxy = await getProxyIp(proxyUrl, true) // 强制刷新，不走缓存
        console.log(`🔒 [API独立] 使用代理: ${proxy.host}:${proxy.port} (不缓存)`)
      }
    }

    if (proxy) {
      launchOptions.proxy = {
        server: `http://${proxy.host}:${proxy.port}`,
        username: proxy.username,
        password: proxy.password,
      }

      // 🔥 代理链路上 Chromium 的 HTTP/2 更容易触发 PROTOCOL_ERROR（部分中转域名/代理不兼容）
      // 强制降级为更兼容的 HTTP/1.1 以提高解析成功率。
      launchOptions.args.push('--disable-http2')
      launchOptions.args.push('--disable-quic')

      const proxySource = proxyCredentials ? '[缓存]' : '[独立]'
      console.log(`✅ Playwright实例使用代理 ${proxySource}: ${proxy.host}:${proxy.port}`)
    }

    const browser = await chromium.launch(launchOptions)

    // 🔥 使用统一的方法生成contextOptions（复用与首次创建保持一致）
    const contextOptions = this.generateContextOptions(targetCountry)

    const context = await browser.newContext(contextOptions)

    // 🔥 关键：添加stealth脚本到context（传入targetCountry支持动态语言）
    await this.addStealthScripts(context, targetCountry)

    return { browser, context, contextOptions }
  }

  /**
   * 清理空闲实例
   */
  private async cleanupIdleInstances(): Promise<void> {
    const now = Date.now()
    const instancesToClean: string[] = []

    for (const [key, instance] of this.instances.entries()) {
      if (!instance.inUse && now - instance.lastUsedAt > POOL_CONFIG.maxIdleTime) {
        instancesToClean.push(key)
      }
    }

    for (const key of instancesToClean) {
      await this.closeInstance(key)
    }

    if (instancesToClean.length > 0) {
      console.log(`清理${instancesToClean.length}个空闲Playwright实例`)
    }
  }

  /**
   * 清理最旧的实例
   */
  private async cleanupOldestInstance(): Promise<void> {
    let oldestKey: string | null = null
    let oldestTime = Infinity

    for (const [key, instance] of this.instances.entries()) {
      if (!instance.inUse && instance.lastUsedAt < oldestTime) {
        oldestKey = key
        oldestTime = instance.lastUsedAt
      }
    }

    if (oldestKey) {
      console.log(`清理最旧的Playwright实例: ${oldestKey}`)
      await this.closeInstance(oldestKey)
    }
  }

  /**
   * 关闭指定实例
   */
  private async closeInstance(key: string): Promise<void> {
    const instance = this.instances.get(key)
    if (!instance) return

    try {
      await instance.context.close().catch(() => {})
      await instance.browser.close().catch(() => {})
    } catch (error) {
      console.warn(`关闭实例失败: ${key}`, error)
    }

    this.instances.delete(key)
  }

  /**
   * 启动定期清理任务
   */
  private startCleanupTask(): void {
    // 每分钟清理一次
    this.cleanupInterval = setInterval(async () => {
      await this.cleanupIdleInstances()

      // 🔥 P2优化: 定期检测泄露
      const leaks = this.detectLeaks()
      if (leaks.hasLeaks) {
        console.warn(`⚠️ 连接池泄露检测报告:`)
        leaks.warnings.forEach(w => console.warn(`   - ${w}`))

        // 自动强制释放泄露实例
        await this.forceReleaseLeaks()
      } else if (leaks.warnings.length > 0) {
        // 即使没有泄露，也打印警告
        leaks.warnings.forEach(w => console.warn(`⚠️ ${w}`))
      }
    }, 60 * 1000)
  }

  /**
   * 停止清理任务
   */
  private stopCleanupTask(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  /**
   * 关闭连接池，清理所有实例
   */
  async closeAll(): Promise<void> {
    this.stopCleanupTask()

    console.log(`关闭Playwright连接池，共${this.instances.size}个实例`)

    const closePromises = Array.from(this.instances.keys()).map((key) =>
      this.closeInstance(key)
    )

    await Promise.all(closePromises)

    this.instances.clear()
  }

  /**
   * 获取连接池统计信息
   */
  getStats(): {
    totalInstances: number
    inUseInstances: number
    idleInstances: number
    instances: Array<{
      proxyKey: string
      inUse: boolean
      ageSeconds: number
      idleSeconds: number
    }>
  } {
    const now = Date.now()
    const instances = Array.from(this.instances.entries()).map(([key, instance]) => ({
      proxyKey: key,
      inUse: instance.inUse,
      ageSeconds: Math.floor((now - instance.createdAt) / 1000),
      idleSeconds: Math.floor((now - instance.lastUsedAt) / 1000),
    }))

    return {
      totalInstances: this.instances.size,
      inUseInstances: instances.filter((i) => i.inUse).length,
      idleInstances: instances.filter((i) => !i.inUse).length,
      instances,
    }
  }

  /**
   * 🔥 P2优化: 资源泄露检测
   * 检测长时间inUse的实例（可能忘记release）
   */
  detectLeaks(): {
    hasLeaks: boolean
    leakedInstances: Array<{
      id: string
      proxyKey: string
      inUseDuration: number  // 使用中的时长（秒）
      ageSeconds: number     // 实例年龄（秒）
    }>
    warnings: string[]
  } {
    const now = Date.now()
    const leakedInstances: Array<{
      id: string
      proxyKey: string
      inUseDuration: number
      ageSeconds: number
    }> = []
    const warnings: string[] = []

    // 检测1: 长时间inUse的实例（超过10分钟）
    const LEAK_THRESHOLD = 10 * 60 * 1000  // 10分钟

    for (const [key, instance] of this.instances.entries()) {
      if (instance.inUse) {
        const inUseDuration = now - instance.lastUsedAt

        if (inUseDuration > LEAK_THRESHOLD) {
          leakedInstances.push({
            id: instance.id,
            proxyKey: instance.proxyKey,
            inUseDuration: Math.floor(inUseDuration / 1000),
            ageSeconds: Math.floor((now - instance.createdAt) / 1000),
          })
          warnings.push(`实例 ${instance.id} 已使用 ${Math.floor(inUseDuration / 60000)} 分钟，可能未正确释放`)
        }
      }
    }

    // 检测2: 实例总数接近上限
    if (this.instances.size >= POOL_CONFIG.maxInstances * 0.8) {
      warnings.push(`连接池使用率达到 ${Math.round((this.instances.size / POOL_CONFIG.maxInstances) * 100)}%，接近上限`)
    }

    // 检测3: 等待队列过长
    if (this.waitingQueue.length > 5) {
      warnings.push(`等待队列有 ${this.waitingQueue.length} 个请求等待，可能需要扩容`)
    }

    return {
      hasLeaks: leakedInstances.length > 0,
      leakedInstances,
      warnings,
    }
  }

  /**
   * 🔥 P2优化: 强制释放泄露的实例
   */
  async forceReleaseLeaks(): Promise<number> {
    const leaks = this.detectLeaks()

    if (!leaks.hasLeaks) {
      return 0
    }

    console.warn(`⚠️ 检测到 ${leaks.leakedInstances.length} 个泄露实例，强制释放...`)

    for (const leak of leaks.leakedInstances) {
      const instance = Array.from(this.instances.values()).find(i => i.id === leak.id)
      if (instance) {
        console.warn(`⚠️ 强制释放: ${leak.id} (使用时长: ${leak.inUseDuration}秒)`)

        // 强制标记为空闲
        instance.inUse = false
        instance.lastUsedAt = Date.now()

        // 重新创建context（清理可能的页面资源）
        try {
          await instance.context.close().catch(() => {})
          instance.context = await instance.browser.newContext(instance.contextOptions)
        } catch (error) {
          console.error(`⚠️ 重建context失败: ${leak.id}`, error)
          // 如果重建失败，直接关闭实例
          await this.closeInstance(leak.id)
        }
      }
    }

    return leaks.leakedInstances.length
  }
}

// 全局单例连接池
let globalPool: PlaywrightPool | null = null

/**
 * 获取全局连接池实例
 */
export function getPlaywrightPool(): PlaywrightPool {
  if (!globalPool) {
    globalPool = new PlaywrightPool()
  }
  return globalPool
}

/**
 * 关闭全局连接池（用于测试或应用关闭）
 */
export async function closePlaywrightPool(): Promise<void> {
  if (globalPool) {
    await globalPool.closeAll()
    globalPool = null
  }
}

/**
 * 获取连接池统计信息
 */
export function getPlaywrightPoolStats() {
  if (!globalPool) {
    return {
      totalInstances: 0,
      inUseInstances: 0,
      idleInstances: 0,
      instances: [],
    }
  }
  return globalPool.getStats()
}
