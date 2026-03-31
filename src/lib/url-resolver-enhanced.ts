/**
 * 增强的URL解析模块
 * 集成：多代理池管理 + Redis缓存 + 智能重试 + 降级方案
 * 环境隔离：使用环境特定前缀，防止开发/生产缓存混淆
 */

import { getRedisClient } from './redis'
import { resolveAffiliateLinkWithPlaywright } from './url-resolver-playwright'
import type { PlaywrightResolvedUrl } from './url-resolver-playwright'
import { extractEmbeddedTargetUrl, resolveAffiliateLinkWithHttp } from './url-resolver-http'
import { getOptimalResolver, extractDomain } from './resolver-domains'
import { REDIS_PREFIX_CONFIG } from './config'
import { maskProxyUrl } from './proxy/validate-url'
import { normalizeCountryCode } from './language-country-codes'

// ==================== 类型定义 ====================

export interface ProxyConfig {
  url: string
  country: string
  failureCount: number
  lastFailureTime: number | null
  lastTemporaryFailureTime: number | null // 🔥 临时失败时间戳（timeout等）
  lastPermanentFailureTime: number | null // 🔥 永久失败时间戳（connection refused等）
  temporaryFailureCount: number // 🔥 临时失败计数
  permanentFailureCount: number // 🔥 永久失败计数
  successCount: number
  avgResponseTime: number
  isHealthy: boolean
}

export interface ResolvedUrlData {
  finalUrl: string
  finalUrlSuffix: string
  brand: string | null
  redirectChain: string[]
  redirectCount: number
  pageTitle: string | null
  statusCode: number | null
  cachedAt?: number
  resolveMethod?: 'http' | 'playwright' | 'cache'
  proxyUsed?: string
}

interface RetryConfig {
  maxRetries: number
  baseDelay: number // 初始延迟（ms）
  maxDelay: number // 最大延迟（ms）
  retryableErrors: string[] // 可重试的错误类型
}

const PROXY_COUNTRY_ALIAS_MAP: Readonly<Record<string, string[]>> = {
  GB: ['UK'],
  UK: ['GB'],
}

function getCountryCandidates(country: string): Set<string> {
  const raw = String(country || '').trim()
  if (!raw) return new Set<string>()

  const rawUpper = raw.toUpperCase()
  const normalized = normalizeCountryCode(raw)
  const candidates = new Set<string>()

  if (normalized) candidates.add(normalized)
  if (rawUpper) candidates.add(rawUpper)

  const addAliases = (code: string) => {
    const aliases = PROXY_COUNTRY_ALIAS_MAP[code]
    if (!aliases) return
    for (const alias of aliases) {
      if (alias) candidates.add(alias)
    }
  }

  if (normalized) addAliases(normalized)
  if (rawUpper && rawUpper !== normalized) addAliases(rawUpper)

  return candidates
}

function getPrimaryCountryCode(country: string): string {
  const normalized = normalizeCountryCode(String(country || '').trim())
  return normalized || String(country || '').trim().toUpperCase()
}

// ==================== 代理池管理 ====================

export class ProxyPoolManager {
  private proxies: Map<string, ProxyConfig> = new Map()
  private readonly HEALTH_CHECK_INTERVAL = 3600000 // 1小时
  private readonly MAX_FAILURES_THRESHOLD = 3 // 永久失败阈值
  private readonly TEMPORARY_FAILURE_THRESHOLD = 5 // 🔥 临时失败阈值（更宽容）
  private readonly FAILURE_RESET_TIME = 3600000 // 1小时后重置失败计数（永久失败）
  private readonly TEMPORARY_FAILURE_RESET_TIME = 300000 // 🔥 5分钟后重置临时失败
  private readonly AUTO_HEAL_THRESHOLD = 5 // 失败5次后，1小时自动恢复
  private lastHealthCheckTime: number = 0
  private isHealthCheckRunning: boolean = false

  /**
   * 从settings中加载代理配置
   */
  async loadProxies(settingsProxies: Array<{ url: string; country: string; is_default: boolean }>): Promise<void> {
    console.log(`🔍 [loadProxies] 开始加载代理，输入代理数量: ${settingsProxies.length}`)
    console.log(`🔍 [loadProxies] 输入代理详情:`, settingsProxies.map(p => ({ country: p.country, url: maskProxyUrl(p.url) })))

    this.proxies.clear()

    for (const proxy of settingsProxies) {
      const normalizedCountry = String(proxy.country || '').trim().toUpperCase()
      const config: ProxyConfig = {
        url: proxy.url,
        country: normalizedCountry,
        failureCount: 0,
        lastFailureTime: null,
        lastTemporaryFailureTime: null, // 🔥 初始化临时失败时间
        lastPermanentFailureTime: null, // 🔥 初始化永久失败时间
        temporaryFailureCount: 0, // 🔥 初始化临时失败计数
        permanentFailureCount: 0, // 🔥 初始化永久失败计数
        successCount: 0,
        avgResponseTime: 0,
        isHealthy: true,
      }

      this.proxies.set(proxy.url, config)
      console.log(`   🔹 添加代理: ${config.country}`)
    }

    console.log(`✅ [loadProxies] 代理池已加载: ${this.proxies.size}个代理`)
    if (settingsProxies.length > 0) {
      console.log(`   - 默认代理（第一个）: ${settingsProxies[0].country}`)
    }
  }

  /**
   * 根据国家获取最佳代理
   * 优先级：目标国家健康代理 > 目标国家不健康代理 > 其他国家健康代理 > 第一个代理（默认）
   */
  getBestProxyForCountry(targetCountry: string): ProxyConfig | null {
    const normalizedTargetCountry = getPrimaryCountryCode(targetCountry)
    const targetCountryCandidates = getCountryCandidates(targetCountry)
    const allProxies = Array.from(this.proxies.values())

    // 1. 优先使用目标国家的健康代理
    const countryProxies = allProxies
      .filter(p => targetCountryCandidates.has(p.country) && p.isHealthy)
      .sort((a, b) => a.failureCount - b.failureCount || a.avgResponseTime - b.avgResponseTime)

    if (countryProxies.length > 0) {
      return countryProxies[0]
    }

    // 2. 尝试使用目标国家的不健康代理（失败次数较少的）
    const unhealthyCountryProxies = allProxies
      .filter(p => targetCountryCandidates.has(p.country) && !p.isHealthy)
      .sort((a, b) => a.failureCount - b.failureCount)

    if (unhealthyCountryProxies.length > 0 && unhealthyCountryProxies[0].failureCount < 10) {
      console.log(`⚠️ [Proxy] ${normalizedTargetCountry}代理不健康，尝试使用 (failures:${unhealthyCountryProxies[0].failureCount})`)
      return unhealthyCountryProxies[0]
    }

    // 3. 使用其他国家的健康代理
    const healthyProxies = allProxies
      .filter(p => p.isHealthy)
      .sort((a, b) => a.failureCount - b.failureCount || a.avgResponseTime - b.avgResponseTime)

    if (healthyProxies.length > 0) {
      console.log(`⚠️ [Proxy] ${normalizedTargetCountry}不可用，降级使用${healthyProxies[0].country}`)
      return healthyProxies[0]
    }

    // 4. 使用第一个代理作为最后的兜底
    if (allProxies.length > 0) {
      console.log(`⚠️ [Proxy] 所有代理不健康，兜底使用${allProxies[0].country}`)
      return allProxies[0]
    }

    console.log(`❌ [Proxy] 没有可用代理`)
    return null
  }

  /**
   * 检查目标国家是否有可用的代理
   * @returns 如果目标国家有代理返回 true，否则返回 false
   */
  hasProxyForCountry(targetCountry: string): boolean {
    const targetCountryCandidates = getCountryCandidates(targetCountry)
    const allProxies = Array.from(this.proxies.values())
    return allProxies.some(p => targetCountryCandidates.has(p.country))
  }

  /**
   * 获取将被使用的代理信息（不改变代理状态）
   * @returns 代理信息，包括是否匹配目标国家
   */
  getProxyInfo(targetCountry: string): { proxy: ProxyConfig | null; isTargetCountryMatch: boolean; usedCountry: string | null } {
    const targetCountryCandidates = getCountryCandidates(targetCountry)
    const proxy = this.getBestProxyForCountry(targetCountry)
    if (!proxy) {
      return { proxy: null, isTargetCountryMatch: false, usedCountry: null }
    }
    return {
      proxy,
      isTargetCountryMatch: targetCountryCandidates.has(proxy.country),
      usedCountry: proxy.country,
    }
  }

  /**
   * 记录代理成功
   */
  recordSuccess(proxyUrl: string, responseTime: number): void {
    const proxy = this.proxies.get(proxyUrl)
    if (!proxy) return

    proxy.successCount++
    proxy.failureCount = Math.max(0, proxy.failureCount - 1) // 成功后减少失败计数
    proxy.temporaryFailureCount = Math.max(0, proxy.temporaryFailureCount - 1) // 🔥 减少临时失败计数
    proxy.permanentFailureCount = Math.max(0, proxy.permanentFailureCount - 1) // 🔥 减少永久失败计数
    proxy.avgResponseTime = (proxy.avgResponseTime + responseTime) / 2
    proxy.isHealthy = true

    console.log(`✅ 代理成功: ${maskProxyUrl(proxyUrl)} (${responseTime}ms)`)
  }

  /**
   * 判断错误是否为临时失败（网络超时等）
   */
  private isTemporaryFailure(error: string): boolean {
    // HTTP 状态码错误（4xx/5xx）通常是目标站点/中间链路策略导致，
    // 不应被当作“代理永久故障”去污染代理池健康状态。
    if (
      /状态码\s*(?:4\d\d|5\d\d)/.test(error) ||
      /status\s*code\s*(?:4\d\d|5\d\d)/i.test(error) ||
      /HTTP\s*(?:4\d\d|5\d\d)/i.test(error)
    ) {
      return true
    }

    const temporaryErrorPatterns = [
      'timeout',
      'Timeout',
      'TimeoutError',
      'ETIMEDOUT',
      'ECONNRESET',
      'ENETUNREACH',
      'EPROTO',
      'wrong version number',
      'ssl3_get_record',
      'ERR_EMPTY_RESPONSE',
      'ERR_CONNECTION_CLOSED',
      'ERR_HTTP2_PROTOCOL_ERROR',
      'net::ERR_EMPTY_RESPONSE',
      'net::ERR_HTTP2_PROTOCOL_ERROR',
      'waiting until',
    ]
    return temporaryErrorPatterns.some(pattern => error.includes(pattern))
  }

  /**
   * 记录代理失败
   * 区分临时失败（timeout）和永久失败（connection refused）
   */
  recordFailure(proxyUrl: string, error: string): void {
    const proxy = this.proxies.get(proxyUrl)
    if (!proxy) return

    const now = Date.now()
    const isTemporary = this.isTemporaryFailure(error)

    // 更新总失败计数和时间
    proxy.failureCount++
    proxy.lastFailureTime = now

    if (isTemporary) {
      // 🔥 临时失败：更宽容的处理
      proxy.temporaryFailureCount++
      proxy.lastTemporaryFailureTime = now

      // 仅在临时失败次数过多时才标记为不健康
      if (proxy.temporaryFailureCount >= this.TEMPORARY_FAILURE_THRESHOLD) {
        proxy.isHealthy = false
        console.warn(`⚠️ 代理标记为不健康（临时失败过多）: ${maskProxyUrl(proxyUrl)} (${proxy.temporaryFailureCount}次临时失败)`)
      } else {
        console.warn(`⚠️ 代理临时失败: ${maskProxyUrl(proxyUrl)} (${proxy.temporaryFailureCount}/${this.TEMPORARY_FAILURE_THRESHOLD})`)
      }
    } else {
      // 🔥 永久失败：严格处理
      proxy.permanentFailureCount++
      proxy.lastPermanentFailureTime = now

      // 永久失败次数达到阈值立即标记为不健康
      if (proxy.permanentFailureCount >= this.MAX_FAILURES_THRESHOLD) {
        proxy.isHealthy = false
        console.warn(`⚠️ 代理标记为不健康（永久失败）: ${maskProxyUrl(proxyUrl)} (${proxy.permanentFailureCount}次永久失败)`)
      } else {
        console.warn(`⚠️ 代理永久失败: ${maskProxyUrl(proxyUrl)} (${proxy.permanentFailureCount}/${this.MAX_FAILURES_THRESHOLD})`)
      }
    }

    console.error(`❌ 代理失败: ${maskProxyUrl(proxyUrl)}, 错误: ${error}`)
  }

  /**
   * 重置长时间未失败的代理健康状态
   * 区分临时失败和永久失败的恢复时间
   */
  resetOldFailures(): void {
    const now = Date.now()
    for (const proxy of this.proxies.values()) {
      let shouldRecover = false
      let recoveryReason = ''

      // 🔥 策略1: 临时失败5分钟后自动恢复
      if (
        !proxy.isHealthy &&
        proxy.lastTemporaryFailureTime &&
        proxy.temporaryFailureCount > 0 &&
        now - proxy.lastTemporaryFailureTime > this.TEMPORARY_FAILURE_RESET_TIME
      ) {
        shouldRecover = true
        recoveryReason = `临时失败${proxy.temporaryFailureCount}次，5分钟后自动恢复`
        proxy.temporaryFailureCount = 0
        proxy.lastTemporaryFailureTime = null
      }

      // 🔥 策略2: 永久失败1小时后自动恢复（仅当失败次数<阈值）
      if (
        !proxy.isHealthy &&
        proxy.lastPermanentFailureTime &&
        proxy.permanentFailureCount < this.AUTO_HEAL_THRESHOLD &&
        now - proxy.lastPermanentFailureTime > this.FAILURE_RESET_TIME
      ) {
        shouldRecover = true
        recoveryReason = `永久失败${proxy.permanentFailureCount}次，1小时后自动恢复`
        proxy.permanentFailureCount = 0
        proxy.lastPermanentFailureTime = null
      }

      // 执行恢复
      if (shouldRecover) {
        proxy.isHealthy = true
        proxy.failureCount = 0
        proxy.lastFailureTime = null
        console.log(`♻️ 代理已自动恢复: ${proxy.country} (${recoveryReason})`)
      }

      // 🔥 策略3: 逐步衰减失败计数（即使代理仍不健康）
      if (proxy.lastTemporaryFailureTime && now - proxy.lastTemporaryFailureTime > this.TEMPORARY_FAILURE_RESET_TIME) {
        if (proxy.temporaryFailureCount > 0) {
          proxy.temporaryFailureCount = Math.max(0, proxy.temporaryFailureCount - 1)
        }
      }

      if (proxy.lastPermanentFailureTime && now - proxy.lastPermanentFailureTime > this.FAILURE_RESET_TIME) {
        if (proxy.permanentFailureCount > 0) {
          proxy.permanentFailureCount = Math.max(0, proxy.permanentFailureCount - 1)
        }
      }
    }
  }

  /**
   * 获取所有代理的健康状态
   */
  getProxyHealth(): Array<{ url: string; country: string; isHealthy: boolean; failureCount: number; successCount: number }> {
    return Array.from(this.proxies.values()).map(p => ({
      url: p.url,
      country: p.country,
      isHealthy: p.isHealthy,
      failureCount: p.failureCount,
      successCount: p.successCount,
    }))
  }

  /**
   * 主动健康检测：ping测试代理是否可用
   */
  async checkProxyHealth(proxyUrl: string, timeout: number = 5000): Promise<boolean> {
    try {
      const axios = (await import('axios')).default
      const { HttpsProxyAgent } = await import('https-proxy-agent')
      const { ProxyProviderRegistry } = await import('./proxy/providers/provider-registry')

      // 支持”代理provider URL”（如 IPRocket API URL），先解析成真实代理IP再创建 agent
      // 健康检查不属于用户请求路径，强制刷新（不走缓存）
      let effectiveProxyUrl = proxyUrl
      if (ProxyProviderRegistry.isSupported(proxyUrl)) {
        const { getProxyIp } = await import('./proxy/fetch-proxy-ip')
        const creds = await getProxyIp(proxyUrl, true) // forceRefresh=true，不走缓存
        effectiveProxyUrl = `http://${creds.username}:${creds.password}@${creds.host}:${creds.port}`
      }

      const agent = new HttpsProxyAgent(effectiveProxyUrl)
      const testUrl = 'https://www.amazon.com' // 使用Amazon作为测试目标

      const startTime = Date.now()
      await axios.head(testUrl, {
        httpsAgent: agent,
        httpAgent: agent as any,
        timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      })
      const responseTime = Date.now() - startTime

      console.log(`✅ 代理健康检测通过: ${maskProxyUrl(proxyUrl)} (${responseTime}ms)`)
      return true
    } catch (error: any) {
      console.error(`❌ 代理健康检测失败: ${maskProxyUrl(proxyUrl)}, 错误: ${error.message}`)
      return false
    }
  }

  /**
   * 批量检测所有代理的健康状态
   * @param force 是否强制检测（忽略时间间隔限制）
   */
  async performHealthCheck(force: boolean = false): Promise<void> {
    const now = Date.now()

    // 检查是否需要执行健康检测
    if (!force && this.isHealthCheckRunning) {
      console.log('⏳ 健康检测正在进行中，跳过...')
      return
    }

    if (!force && now - this.lastHealthCheckTime < this.HEALTH_CHECK_INTERVAL) {
      const remainingTime = Math.floor((this.HEALTH_CHECK_INTERVAL - (now - this.lastHealthCheckTime)) / 1000 / 60)
      console.log(`⏳ 距离下次健康检测还有 ${remainingTime} 分钟`)
      return
    }

    this.isHealthCheckRunning = true
    this.lastHealthCheckTime = now

    console.log(`🔍 开始批量健康检测 (${this.proxies.size}个代理)...`)

    // 并行检测所有代理
    const healthCheckPromises = Array.from(this.proxies.entries()).map(async ([url, proxy]) => {
      const isHealthy = await this.checkProxyHealth(url, 10000)

      if (isHealthy) {
        // 健康检测通过，重置失败计数
        proxy.failureCount = Math.max(0, proxy.failureCount - 1)
        proxy.isHealthy = true
        proxy.lastFailureTime = null
      } else {
        // 健康检测失败，增加失败计数
        proxy.failureCount++
        proxy.lastFailureTime = Date.now()

        if (proxy.failureCount >= this.MAX_FAILURES_THRESHOLD) {
          proxy.isHealthy = false
          console.warn(`⚠️ 代理标记为不健康: ${maskProxyUrl(url)} (健康检测失败)`)
        }
      }
    })

    await Promise.all(healthCheckPromises)

    this.isHealthCheckRunning = false

    // 统计结果
    const healthyCount = Array.from(this.proxies.values()).filter(p => p.isHealthy).length
    const unhealthyCount = this.proxies.size - healthyCount

    console.log(`✅ 健康检测完成: ${healthyCount}个健康, ${unhealthyCount}个不健康`)
  }

  /**
   * 获取最佳可用代理（优先健康代理，必要时触发健康检测）
   */
  async getBestProxyWithHealthCheck(targetCountry: string): Promise<ProxyConfig | null> {
    // 检查是否需要健康检测
    const now = Date.now()
    if (now - this.lastHealthCheckTime > this.HEALTH_CHECK_INTERVAL && !this.isHealthCheckRunning) {
      // 后台异步执行健康检测（不阻塞当前请求）
      this.performHealthCheck().catch(err => {
        console.error('后台健康检测失败:', err)
      })
    }

    // 返回当前最佳代理
    return this.getBestProxyForCountry(targetCountry)
  }
}

// 按用户隔离的代理池实例 - 使用 global 对象防止热重载时重置
// key: userId，value: ProxyPoolManager 实例
declare global {
  var __proxyPoolInstances: Map<number, ProxyPoolManager> | undefined
  var __proxyPoolInstance: ProxyPoolManager | undefined // 保留兼容性
}

/**
 * 获取指定用户的代理池实例（用户级别隔离）
 * @param userId - 用户ID，不传则返回全局兜底实例（仅用于非用户请求场景）
 */
export function getProxyPool(userId?: number): ProxyPoolManager {
  if (!global.__proxyPoolInstances) {
    global.__proxyPoolInstances = new Map()
  }

  if (userId) {
    if (!global.__proxyPoolInstances.has(userId)) {
      global.__proxyPoolInstances.set(userId, new ProxyPoolManager())
    }
    return global.__proxyPoolInstances.get(userId)!
  }

  // 无 userId 时使用全局兜底实例（健康检查、调度器等非用户请求场景）
  if (!global.__proxyPoolInstance) {
    global.__proxyPoolInstance = new ProxyPoolManager()
  }
  return global.__proxyPoolInstance
}

/**
 * 清除代理池实例
 * @param userId - 指定用户ID则只清除该用户的实例，不传则清除所有
 */
export function clearProxyPool(userId?: number): void {
  if (userId) {
    if (global.__proxyPoolInstances?.has(userId)) {
      global.__proxyPoolInstances.delete(userId)
      console.log(`🗑️ 清除用户 ${userId} 的代理池缓存`)
    }
  } else {
    global.__proxyPoolInstances?.clear()
    global.__proxyPoolInstance = undefined
    console.log('🗑️ 清除所有代理池缓存')
  }
}

// ==================== Redis缓存管理 ====================

const CACHE_TTL = 7 * 24 * 60 * 60 // 7天（秒）

/**
 * 生成缓存键
 * 格式：{cache_prefix}redirect:{targetCountry}:{affiliateLink}
 * 例如：autoads:development:cache:redirect:US:https://...
 */
function getCacheKey(affiliateLink: string, targetCountry: string): string {
  return `${REDIS_PREFIX_CONFIG.cache}redirect:${targetCountry}:${affiliateLink}`
}

/**
 * 从Redis获取缓存的重定向结果
 */
export async function getCachedRedirect(
  affiliateLink: string,
  targetCountry: string
): Promise<ResolvedUrlData | null> {
  try {
    const redis = getRedisClient()
    const cacheKey = getCacheKey(affiliateLink, targetCountry)
    const cached = await redis.get(cacheKey)

    if (cached) {
      const data = JSON.parse(cached) as ResolvedUrlData
      console.log(`✅ 缓存命中: ${affiliateLink}`)
      return { ...data, resolveMethod: 'cache' }
    }

    return null
  } catch (error) {
    console.error('Redis缓存读取失败:', error)
    return null
  }
}

/**
 * 将重定向结果存入Redis缓存
 */
export async function setCachedRedirect(
  affiliateLink: string,
  targetCountry: string,
  data: ResolvedUrlData
): Promise<void> {
  try {
    const redis = getRedisClient()
    const cacheKey = getCacheKey(affiliateLink, targetCountry)
    const cacheData = { ...data, cachedAt: Date.now() }

    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(cacheData))
    console.log(`✅ 缓存已保存: ${affiliateLink} (TTL: ${CACHE_TTL}s)`)
  } catch (error) {
    console.error('Redis缓存写入失败:', error)
  }
}

// ==================== 智能重试策略 ====================

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 2000, // 2秒
  maxDelay: 16000, // 16秒
  retryableErrors: [
    'timeout',
    'Timeout',  // 🔥 P0修复：Playwright超时错误应该可以重试
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'ENETUNREACH',
    '状态码 5',
    'HTTP 5',
    'EPROTO',
    'wrong version number',
    'ssl3_get_record',
    'ERR_NAME_NOT_RESOLVED',
    'ERR_EMPTY_RESPONSE',     // 服务器无响应（可能是代理IP被封）
    'ERR_CONNECTION_CLOSED',  // 连接被关闭
    'ERR_HTTP2_PROTOCOL_ERROR', // HTTP2协议错误（代理/中间链路常见）
    'ERR_PROXY_CONNECTION_FAILED', // 代理连接失败
    'net::ERR_EMPTY_RESPONSE', // Playwright格式的空响应错误
    'net::ERR_HTTP2_PROTOCOL_ERROR', // Playwright格式的HTTP2协议错误
    'TimeoutError',  // 🔥 P0修复：Playwright TimeoutError应该可以重试
    'waiting until',  // 🔥 P0修复：Playwright waiting until错误应该可以重试
  ],
}

/**
 * 批量模式重试配置（快速失败策略）
 */
export const BATCH_MODE_RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: 1, // 减少重试次数
  baseDelay: 1000, // 1秒
  maxDelay: 5000, // 5秒
}

/**
 * 指数退避计算延迟时间
 */
function calculateBackoffDelay(attempt: number, config: RetryConfig): number {
  const delay = Math.min(config.baseDelay * Math.pow(2, attempt), config.maxDelay)
  // 添加随机抖动（±20%）避免雷鸣羊群效应
  const jitter = delay * (0.8 + Math.random() * 0.4)
  return Math.floor(jitter)
}

/**
 * 判断错误是否可重试
 */
function isRetryableError(error: any, config: RetryConfig): boolean {
  const errorMessage = error.message || String(error)
  return config.retryableErrors.some(err => errorMessage.includes(err))
}

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ==================== HTTP请求方式（Level 1） ====================

async function resolveWithHttp(
  affiliateLink: string,
  proxyUrl: string,
  userId: number,
  forceRefreshProxy = false
): Promise<ResolvedUrlData> {
  const result = await resolveAffiliateLinkWithHttp(affiliateLink, proxyUrl, 10, userId, forceRefreshProxy)

  return {
    finalUrl: result.finalUrl,
    finalUrlSuffix: result.finalUrlSuffix,
    brand: null, // 需要后续AI识别
    redirectChain: result.redirectChain,
    redirectCount: result.redirectCount,
    pageTitle: null, // HTTP方式无法获取页面标题
    statusCode: result.statusCode,
    resolveMethod: 'http',
    proxyUsed: proxyUrl,
  }
}

function buildFullUrl(finalUrl: string, finalUrlSuffix: string | null | undefined): string {
  const suffix = (finalUrlSuffix || '').trim()
  if (!suffix) return finalUrl
  return finalUrl.includes('?') ? `${finalUrl}&${suffix}` : `${finalUrl}?${suffix}`
}

function isBlockedHttpResolution(result: ResolvedUrlData): boolean {
  const statusCode = typeof result.statusCode === 'number' ? result.statusCode : 0
  if (statusCode < 400) return false

  try {
    const fullResolvedUrl = buildFullUrl(result.finalUrl, result.finalUrlSuffix)
    const urlObj = new URL(result.finalUrl)
    const path = urlObj.pathname.toLowerCase()

    // 已解析到tracking/中间页时，仍需降级Playwright继续追踪
    const isTrackingUrl = /\/track|\/click|\/redirect|\/go|\/out|partnermatic|tradedoubler|awin|impact|cj\.com|[?&](?:url|redirect|target|destination|goto|link|new)=/i.test(fullResolvedUrl)
    if (isTrackingUrl) return true

    // 明显错误页路径仍视为阻断
    const blockedPath = /\/(?:403|404|blocked|error)(?:\/|$)/i.test(path)
    if (blockedPath) return true

    // 非tracking落地页即使4xx，也视为已解析成功（避免不必要降级）
    return false
  } catch {
    // URL解析失败时，保守认为需要降级
    return true
  }
}

function applyEmbeddedTargetFallback(result: ResolvedUrlData): ResolvedUrlData {
  const fullResolvedUrl = buildFullUrl(result.finalUrl, result.finalUrlSuffix)
  const embeddedTarget = extractEmbeddedTargetUrl(fullResolvedUrl)
  if (!embeddedTarget) return result

  try {
    const urlObj = new URL(embeddedTarget)
    const finalUrl = `${urlObj.origin}${urlObj.pathname}`
    const finalUrlSuffix = urlObj.search.substring(1)

    if (finalUrl === result.finalUrl && finalUrlSuffix === result.finalUrlSuffix) {
      return result
    }

    console.log(`   📎 tracking URL包含嵌入目标，改用目标URL: ${finalUrl}`)

    return {
      ...result,
      finalUrl,
      finalUrlSuffix,
      redirectChain: [...result.redirectChain, urlObj.toString()],
      redirectCount: result.redirectCount + 1,
    }
  } catch {
    return result
  }
}

function shouldRetryHttpInsteadOfFallbackToPlaywright(error: unknown): boolean {
  const msg = (error as any)?.message ? String((error as any).message) : String(error)

  // HTTP 5xx：大概率是代理/中间链路瞬态问题，优先换代理重试，而不是降级到Playwright（同代理多半也会失败/更慢）
  if (/状态码\s*5\d\d/.test(msg) || /HTTP\s*5\d\d/i.test(msg)) return true

  // 典型网络/代理握手问题：应换代理重试
  const transientPatterns = [
    'timeout',
    'Timeout',
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'ENETUNREACH',
    'EPROTO',
    'wrong version number',
    'ssl3_get_record',
    'ERR_HTTP2_PROTOCOL_ERROR',
    'ERR_EMPTY_RESPONSE',
    'ERR_CONNECTION_CLOSED',
  ]
  return transientPatterns.some(p => msg.includes(p))
}

function shouldFailFastWithoutPlaywrightFallback(error: unknown): boolean {
  const msg = (error as any)?.message ? String((error as any).message) : String(error)
  const lower = msg.toLowerCase()

  // Provider业务错误（账户/风控/客服介入）不可通过Playwright降级恢复，
  // 继续降级只会重复请求同一provider并放大错误风暴。
  return (
    lower.includes('iprocket api business error') ||
    lower.includes('business abnormality') ||
    lower.includes('contact customer service')
  )
}

// ==================== Playwright方式（Level 2） ====================

async function resolveWithPlaywright(
  affiliateLink: string,
  proxyUrl: string,
  targetCountry?: string,
  userId?: number,
  forceRefreshProxy = false
): Promise<ResolvedUrlData> {
  const result = await resolveAffiliateLinkWithPlaywright(
    affiliateLink,
    proxyUrl,
    5000,
    targetCountry,
    userId,
    forceRefreshProxy
  )

  return {
    finalUrl: result.finalUrl,
    finalUrlSuffix: result.finalUrlSuffix,
    brand: null, // 需要后续AI识别
    redirectChain: result.redirectChain,
    redirectCount: result.redirectCount,
    pageTitle: result.pageTitle,
    statusCode: result.statusCode,
    resolveMethod: 'playwright',
    proxyUsed: proxyUrl,
  }
}

// ==================== 核心解析函数（集成所有优化） ====================

export interface ResolveOptions {
  targetCountry: string
  userId: number // 用户ID（用于代理IP缓存隔离）
  skipCache?: boolean // 默认为true，禁用缓存以确保获取最新数据
  retryConfig?: Partial<RetryConfig>
}

/**
 * 增强的URL解析函数
 * 集成：缓存 → 多代理池 → 智能重试 → 降级方案
 */
export async function resolveAffiliateLink(
  affiliateLink: string,
  options: ResolveOptions
): Promise<ResolvedUrlData> {
  const { targetCountry, userId, skipCache = true, retryConfig: customRetryConfig } = options // 默认禁用缓存

  // 🔥 P0优化：检测短链接服务，使用更激进的重试策略
  const isShortLink = /bit\.ly|tinyurl|ow\.ly|rebrand\.ly|pboost\.me|short\.link|is\.gd|buff\.ly|t\.co|goo\.gl|clk\.|fbuy\.me|amzn\.to|flip\.it|linktr\.ee|soo\.gd|click-ecom\.com/i.test(affiliateLink)

  const retryConfig = {
    ...DEFAULT_RETRY_CONFIG,
    ...(isShortLink ? { maxRetries: 5 } : {}),  // 🔥 短链接服务增加重试次数到5次
    ...customRetryConfig
  }

  if (isShortLink) {
    console.log(`🔗 检测到短链接服务，增加重试次数到${retryConfig.maxRetries}次`)
  }

  // ========== 步骤1: 检查Redis缓存（默认禁用，确保获取最新追踪参数） ==========
  if (!skipCache) {
    const cached = await getCachedRedirect(affiliateLink, targetCountry)
    if (cached) {
      console.log(`⚠️ 使用缓存数据（注意：追踪参数可能已过期）`)
      return applyEmbeddedTargetFallback(cached)
    }
  } else {
    console.log(`🔄 跳过缓存，直接解析URL（确保获取最新追踪参数）`)
  }

  // ========== 步骤2: 获取代理池 ==========
  const proxyPool = getProxyPool(userId)
  proxyPool.resetOldFailures() // 重置长时间未失败的代理

  let lastError: Error | null = null
  let attempt = 0
  let usedProxyForAttempt: ProxyConfig | null = null

  // ========== 步骤3: 智能重试循环 ==========
  while (attempt <= retryConfig.maxRetries) {
    usedProxyForAttempt = null
    try {
      // 获取最佳代理
      const proxy = proxyPool.getBestProxyForCountry(targetCountry)
      if (!proxy) {
        throw new Error('没有可用的代理')
      }
      usedProxyForAttempt = proxy

      console.log(`🔄 尝试解析 (${attempt + 1}/${retryConfig.maxRetries + 1}): ${affiliateLink}`)
      console.log(`   使用代理: ${proxy.country}`)

      const startTime = Date.now()

      // ========== 步骤4: 智能路由降级方案 ==========
      let result: ResolvedUrlData

      // 使用智能路由决策
      const resolverMethod = getOptimalResolver(affiliateLink)
      const domain = extractDomain(affiliateLink)
      console.log(`   智能路由决策: ${domain} → ${resolverMethod}`)

      if (resolverMethod === 'playwright') {
        // 已知JavaScript重定向域名，直接使用Playwright
        console.log(`   直接使用Playwright（已知需要JavaScript）`)
        result = await resolveWithPlaywright(affiliateLink, proxy.url, targetCountry, userId, attempt > 0)
      } else if (resolverMethod === 'http') {
        // 已知HTTP重定向域名（包括Meta Refresh），先使用HTTP
        try {
          console.log(`   尝试HTTP解析（已知HTTP/Meta Refresh重定向）`)
          // 🔥 重试时强制刷新代理IP，避免复用失败的IP
          result = await resolveWithHttp(affiliateLink, proxy.url, userId, attempt > 0)

          const blocked = isBlockedHttpResolution(result)
          if (blocked) {
            const fullResolvedUrl = buildFullUrl(result.finalUrl, result.finalUrlSuffix)
            console.log(`   ⚠️ HTTP解析命中拦截/错误页，改用Playwright（解析结果）`)
            const playwrightResult = await resolveWithPlaywright(
              fullResolvedUrl,
              proxy.url,
              targetCountry,
              userId,
              attempt > 0
            )
            result = {
              ...playwrightResult,
              redirectChain: [...result.redirectChain, ...playwrightResult.redirectChain.slice(1)],
              redirectCount: result.redirectCount + playwrightResult.redirectCount,
            }
          } else {
            // KISS降级策略：检查是否停在了tracking URL
            const fullResolvedUrl = buildFullUrl(result.finalUrl, result.finalUrlSuffix)
            const isTrackingUrl = /\/track|\/click|\/redirect|\/go|\/out|partnermatic|tradedoubler|awin|impact|cj\.com|[?&](?:url|redirect|target|destination|goto|link|new)=/i.test(fullResolvedUrl)

            if (isTrackingUrl) {
              console.log(`   ⚠️ 检测到tracking URL，可能需要继续追踪`)
              console.log(`   降级到Playwright完成后续重定向...`)
              // 🔥 必须带上HTTP解析得到的suffix，否则会丢失关键追踪参数（例如 partnermatic 的 ?url=...）
              const fullTrackingUrl = buildFullUrl(result.finalUrl, result.finalUrlSuffix)
              const playwrightResult = await resolveWithPlaywright(
                fullTrackingUrl,
                proxy.url,
                targetCountry,
                userId,
                attempt > 0
              )

              // 合并重定向链
              result = {
                ...playwrightResult,
                redirectChain: [...result.redirectChain, ...playwrightResult.redirectChain.slice(1)],
                redirectCount: result.redirectCount + playwrightResult.redirectCount,
              }
            }
          }
        } catch (httpError: any) {
          // 🔥 修复：HTTP失败时降级到Playwright
          console.log(`   HTTP失败: ${httpError.message}`)
          if (shouldFailFastWithoutPlaywrightFallback(httpError)) {
            console.log(`   HTTP命中代理业务错误（不可恢复），终止当前尝试`)
            throw httpError
          }
          if (shouldRetryHttpInsteadOfFallbackToPlaywright(httpError)) {
            console.log(`   HTTP临时失败（优先换代理重试），不降级到Playwright`)
            throw httpError
          }
          console.log(`   降级到Playwright...`)
          result = await resolveWithPlaywright(affiliateLink, proxy.url, targetCountry, userId, attempt > 0)
        }
      } else {
        // 未知域名，先尝试HTTP，失败则降级到Playwright
        try {
          console.log(`   尝试HTTP解析（未知域名）...`)
          // 🔥 重试时强制刷新代理IP，避免复用失败的IP
          result = await resolveWithHttp(affiliateLink, proxy.url, userId, attempt > 0)

          const blocked = isBlockedHttpResolution(result)
          if (blocked) {
            const fullResolvedUrl = buildFullUrl(result.finalUrl, result.finalUrlSuffix)
            console.log(`   ⚠️ HTTP解析命中拦截/错误页，改用Playwright（解析结果）`)
            const playwrightResult = await resolveWithPlaywright(
              fullResolvedUrl,
              proxy.url,
              targetCountry,
              userId,
              attempt > 0
            )
            result = {
              ...playwrightResult,
              redirectChain: [...result.redirectChain, ...playwrightResult.redirectChain.slice(1)],
              redirectCount: result.redirectCount + playwrightResult.redirectCount,
            }
          } else {
            // 🔥 重要：即使HTTP有重定向，也可能停在 tracking 中间页（例如 partnermatic track），需要继续用Playwright追踪
            const fullResolvedUrl = buildFullUrl(result.finalUrl, result.finalUrlSuffix)
            const isTrackingUrl = /\/track|\/click|\/redirect|\/go|\/out|partnermatic|tradedoubler|awin|impact|cj\.com|[?&](?:url|redirect|target|destination|goto|link|new)=/i.test(fullResolvedUrl)
            if (isTrackingUrl) {
              console.log(`   ⚠️ 检测到tracking URL（未知域名路径），降级到Playwright继续解析...`)
              const fullTrackingUrl = buildFullUrl(result.finalUrl, result.finalUrlSuffix)
              const playwrightResult = await resolveWithPlaywright(
                fullTrackingUrl,
                proxy.url,
                targetCountry,
                userId,
                attempt > 0
              )
              result = {
                ...playwrightResult,
                redirectChain: [...result.redirectChain, ...playwrightResult.redirectChain.slice(1)],
                redirectCount: result.redirectCount + playwrightResult.redirectCount,
              }
            }

            // 检查是否真的有重定向（如果redirectCount=0可能需要Playwright）
            if (result.redirectCount === 0 && affiliateLink !== result.finalUrl) {
              // URL改变了但redirectCount为0，可能是JavaScript重定向
              console.log(`   检测到可能的JavaScript重定向，降级到Playwright`)
              result = await resolveWithPlaywright(affiliateLink, proxy.url, targetCountry, userId, attempt > 0)
            } else if (result.redirectCount === 0) {
              // URL没变且无重定向，可能是短链接服务
              console.log(`   ⚠️ 无重定向检测到，尝试Playwright验证`)
              const playwrightResult = await resolveWithPlaywright(
                affiliateLink,
                proxy.url,
                targetCountry,
                userId,
                attempt > 0
              )
              // 如果Playwright获得了不同的结果，使用Playwright结果
              if (playwrightResult.finalUrl !== result.finalUrl || playwrightResult.redirectCount > 0) {
                console.log(`   ✅ Playwright发现了额外的重定向`)
                result = playwrightResult
              }
            }
          }
        } catch (httpError: any) {
          console.log(`   HTTP失败: ${httpError.message}`)
          if (shouldFailFastWithoutPlaywrightFallback(httpError)) {
            console.log(`   HTTP命中代理业务错误（不可恢复），终止当前尝试`)
            throw httpError
          }
          if (shouldRetryHttpInsteadOfFallbackToPlaywright(httpError)) {
            console.log(`   HTTP临时失败（优先换代理重试），不降级到Playwright`)
            throw httpError
          }
          console.log(`   降级到Playwright...`)
          result = await resolveWithPlaywright(affiliateLink, proxy.url, targetCountry, userId, attempt > 0)
        }
      }

      const responseTime = Date.now() - startTime

      // 🔥 兜底：tracking URL仍未解析时，尝试提取嵌入的目标URL
      result = applyEmbeddedTargetFallback(result)

      // 记录代理成功
      proxyPool.recordSuccess(proxy.url, responseTime)

      // ========== 步骤5: 不再保存到缓存（确保每次获取最新追踪参数） ==========
      // 注释掉缓存保存逻辑
      // await setCachedRedirect(affiliateLink, targetCountry, result)

      console.log(`✅ 解析成功: ${result.finalUrl} (${responseTime}ms)`)
      return result
    } catch (error: any) {
      lastError = error
      console.error(`❌ 解析失败 (尝试 ${attempt + 1}):`, error.message)

      // 获取当前使用的代理并记录失败
      if (usedProxyForAttempt) {
        proxyPool.recordFailure(usedProxyForAttempt.url, error.message)
      }

      // 判断是否可重试
      if (!isRetryableError(error, retryConfig)) {
        console.error(`❌ 不可重试的错误，终止重试`)
        break
      }

      // 最后一次尝试失败，不再延迟
      if (attempt >= retryConfig.maxRetries) {
        break
      }

      // 计算延迟并等待
      const backoffDelay = calculateBackoffDelay(attempt, retryConfig)
      console.log(`⏳ 等待 ${backoffDelay}ms 后重试...`)
      await delay(backoffDelay)

      attempt++
    }
  }

  // ========== 所有重试都失败 ==========
  throw new Error(
    `URL解析失败（${retryConfig.maxRetries + 1}次尝试后）: ${lastError?.message || '未知错误'}`
  )
}

// ==================== 代理健康监控 ====================

/**
 * 获取代理池健康状态（供管理员页面使用）
 */
export function getProxyPoolHealth() {
  const proxyPool = getProxyPool()
  return proxyPool.getProxyHealth()
}

/**
 * 手动禁用不健康的代理
 */
export function disableProxy(proxyUrl: string): void {
  const proxyPool = getProxyPool()
  const proxies = (proxyPool as any).proxies as Map<string, ProxyConfig>
  const proxy = proxies.get(proxyUrl)
  if (proxy) {
    proxy.isHealthy = false
    console.log(`⚠️ 代理已手动禁用: ${proxyUrl}`)
  }
}

/**
 * 手动启用代理
 */
export function enableProxy(proxyUrl: string): void {
  const proxyPool = getProxyPool()
  const proxies = (proxyPool as any).proxies as Map<string, ProxyConfig>
  const proxy = proxies.get(proxyUrl)
  if (proxy) {
    proxy.isHealthy = true
    proxy.failureCount = 0
    proxy.lastFailureTime = null
    console.log(`✅ 代理已手动启用: ${proxyUrl}`)
  }
}
