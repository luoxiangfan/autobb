/**
 * User-Isolated Proxy Pool Manager
 *
 * Purpose: Maintain pre-warmed proxy pools with strict user isolation
 * Key Features:
 * - Each user has independent proxy pools (userId → country → proxies)
 * - Users only use their own configured proxy URLs
 * - Dynamic resource-based concurrency adjustment
 * - Auto-refresh and health monitoring
 */

import { HttpsProxyAgent } from 'https-proxy-agent'
import os from 'os'
import type { ProxyIP } from './types'
import { fetchProxyIp } from './fetch-proxy-ip'
import { getUserOnlySetting } from '../settings'
import { normalizeCountryCode } from '../language-country-codes'

// ============ Types ============

interface ProxyConfig {
  country: string
  url: string
}

interface UserProxyPoolEntry {
  country: string
  healthyProxies: ProxyIP[]
  lastRefresh: Date
  refreshing: boolean
  proxyUrl: string  // 该用户配置的代理URL
}

interface UserPoolData {
  userId: number
  pools: Map<string, UserProxyPoolEntry>
  proxyConfigs: ProxyConfig[]  // 该用户的代理配置
}

interface ProxyPoolConfig {
  refreshIntervalMs: number  // 刷新间隔
  minHealthyProxies: number  // 最少保持健康代理数
  maxPoolSize: number        // 每个country最多缓存代理数
  maxConcurrentRefreshes: number  // 最大并发刷新数
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

function expandProxyConfigs(proxyConfigs: ProxyConfig[]): ProxyConfig[] {
  const expanded: ProxyConfig[] = []
  const seen = new Set<string>()

  for (const config of proxyConfigs) {
    const rawCountry = String(config?.country || '').trim()
    const url = String(config?.url || '').trim()
    if (!rawCountry || !url) continue

    const countryCandidates = getCountryCandidates(rawCountry)
    const finalCandidates = countryCandidates.size > 0
      ? Array.from(countryCandidates)
      : [rawCountry.toUpperCase()]

    for (const country of finalCandidates) {
      const key = `${country}\u0000${url}`
      if (seen.has(key)) continue
      seen.add(key)
      expanded.push({ country, url })
    }
  }

  return expanded
}

// ============ Resource Monitor ============

/**
 * 动态监控系统资源并调整并发数
 */
class ResourceMonitor {
  getConcurrencyLimit(): number {
    const cpuUsage = this.getCPUUsage()
    const memoryUsage = this.getMemoryUsage()

    // 根据资源使用率动态调整并发数
    if (cpuUsage > 80 || memoryUsage > 85) {
      return 2  // 资源紧张，降低并发
    } else if (cpuUsage > 60 || memoryUsage > 70) {
      return 3  // 中等负载
    } else if (cpuUsage > 40 || memoryUsage > 50) {
      return 5  // 较低负载
    } else {
      return 8  // 资源充足，最大并发
    }
  }

  private getCPUUsage(): number {
    const cpus = os.cpus()
    let totalIdle = 0
    let totalTick = 0

    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times]
      }
      totalIdle += cpu.times.idle
    }

    const idle = totalIdle / cpus.length
    const total = totalTick / cpus.length
    const usage = 100 - ~~(100 * idle / total)

    return usage
  }

  private getMemoryUsage(): number {
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const usage = ((totalMem - freeMem) / totalMem) * 100

    return usage
  }

  getResourceStats() {
    return {
      cpuUsage: this.getCPUUsage(),
      memoryUsage: this.getMemoryUsage(),
      recommendedConcurrency: this.getConcurrencyLimit()
    }
  }
}

// ============ User-Isolated Proxy Pool Manager ============

class UserIsolatedProxyPoolManager {
  private userPools: Map<number, UserPoolData> = new Map()
  private refreshTimer: NodeJS.Timeout | null = null
  private config: ProxyPoolConfig
  private resourceMonitor: ResourceMonitor

  constructor(config?: Partial<ProxyPoolConfig>) {
    this.config = {
      refreshIntervalMs: 5 * 60 * 1000,  // 5分钟
      minHealthyProxies: 3,
      maxPoolSize: 10,
      maxConcurrentRefreshes: 5,
      ...config,
    }

    this.resourceMonitor = new ResourceMonitor()
  }

  /**
   * 启动代理池管理器
   */
  async start(): Promise<void> {
    console.log('🚀 启动用户隔离代理池管理器...')
    console.log(`   刷新间隔: ${this.config.refreshIntervalMs / 1000}秒`)
    console.log(`   最少健康代理: ${this.config.minHealthyProxies}个`)
    console.log(`   最大池大小: ${this.config.maxPoolSize}个`)

    // 定期刷新所有用户的代理池
    this.refreshTimer = setInterval(() => {
      this.refreshAllUserPools().catch((error) => {
        console.error('❌ 代理池刷新失败:', error.message)
      })
    }, this.config.refreshIntervalMs)

    console.log('✅ 用户隔离代理池管理器已启动')
  }

  /**
   * 停止代理池管理器
   */
  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
      console.log('🛑 用户隔离代理池管理器已停止')
    }
  }

  /**
   * 获取用户的健康代理（单个）
   */
  async getHealthyProxy(userId: number, country: string): Promise<ProxyIP | null> {
    const targetCountry = getPrimaryCountryCode(country)
    // 确保用户池已初始化
    await this.ensureUserPool(userId)

    const userPool = this.userPools.get(userId)
    if (!userPool) {
      console.warn(`⚠️  用户${userId}没有代理配置`)
      return null
    }

    const countryPool = userPool.pools.get(targetCountry)

    // 如果该国家没有池，尝试创建
    if (!countryPool) {
      await this.initializeCountryPool(userId, targetCountry)
      return this.getHealthyProxy(userId, targetCountry)  // 重试
    }

    // 缓存命中：返回健康代理
    if (countryPool.healthyProxies.length > 0) {
      const proxy = countryPool.healthyProxies[Math.floor(Math.random() * countryPool.healthyProxies.length)]
      console.log(`✅ 用户${userId}代理池缓存命中 ${targetCountry} (${countryPool.healthyProxies.length}个可用)`)
      return proxy
    }

    // 缓存未命中：刷新池
    console.warn(`⚠️  用户${userId}代理池缓存未命中 ${targetCountry}，正在获取...`)

    // 如果正在刷新，等待
    if (countryPool.refreshing) {
      await this.waitForRefresh(userId, targetCountry)
      return this.getHealthyProxy(userId, targetCountry)
    }

    // 立即刷新
    await this.refreshCountryPool(userId, targetCountry)
    return this.getHealthyProxy(userId, targetCountry)
  }

  /**
   * 获取用户的多个健康代理
   */
  async getHealthyProxies(userId: number, country: string, count: number): Promise<ProxyIP[]> {
    const targetCountry = getPrimaryCountryCode(country)
    await this.ensureUserPool(userId)

    const userPool = this.userPools.get(userId)
    if (!userPool) {
      console.warn(`⚠️  用户${userId}没有代理配置`)
      return []
    }

    const countryPool = userPool.pools.get(targetCountry)

    if (!countryPool) {
      await this.initializeCountryPool(userId, targetCountry)
      return this.getHealthyProxies(userId, targetCountry, count)
    }

    // 如果缓存足够，直接返回
    if (countryPool.healthyProxies.length >= count) {
      const proxies = countryPool.healthyProxies.slice(0, count)
      console.log(`✅ 用户${userId}代理池缓存命中 ${targetCountry} (需要${count}个, 可用${countryPool.healthyProxies.length}个)`)
      return proxies
    }

    // 缓存不足，刷新
    console.warn(`⚠️  用户${userId}代理池代理不足 ${targetCountry} (需要${count}个, 仅有${countryPool.healthyProxies.length}个)`)
    await this.refreshCountryPool(userId, targetCountry)

    // 返回刷新后的代理
    const proxies = countryPool.healthyProxies.slice(0, count)
    return proxies
  }

  /**
   * 获取池统计信息
   */
  getStats(): Record<string, any> {
    const stats: Record<string, any> = {}
    const resourceStats = this.resourceMonitor.getResourceStats()

    stats['system'] = resourceStats

    for (const [userId, userData] of this.userPools) {
      const userStats: Record<string, any> = {}

      for (const [country, pool] of userData.pools) {
        userStats[country] = {
          healthyCount: pool.healthyProxies.length,
          lastRefresh: pool.lastRefresh.toISOString(),
          refreshing: pool.refreshing,
          cacheAge: Date.now() - pool.lastRefresh.getTime(),
        }
      }

      stats[`user_${userId}`] = userStats
    }

    return stats
  }

  /**
   * 强制刷新用户的国家池
   */
  async forceRefresh(userId: number, country: string): Promise<void> {
    const targetCountry = getPrimaryCountryCode(country)
    await this.refreshCountryPool(userId, targetCountry)
  }

  // ============ Private Methods ============

  /**
   * 确保用户池已初始化
   */
  private async ensureUserPool(userId: number): Promise<void> {
    if (this.userPools.has(userId)) {
      return
    }

    // 从数据库读取用户的代理配置
    const proxyConfigs = await this.getUserProxyConfigs(userId)

    if (!proxyConfigs || proxyConfigs.length === 0) {
      console.warn(`⚠️  用户${userId}没有配置代理URL`)
      return
    }

    // 初始化用户池
    this.userPools.set(userId, {
      userId,
      pools: new Map(),
      proxyConfigs,
    })

    console.log(`✅ 用户${userId}代理池已初始化 (${proxyConfigs.length}个国家配置)`)
  }

  /**
   * 从数据库读取用户的代理配置
   */
  private async getUserProxyConfigs(userId: number): Promise<ProxyConfig[]> {
    try {
      const setting = await getUserOnlySetting('proxy', 'urls', userId)

      if (!setting || !setting.value) {
        console.warn(`⚠️  用户${userId}没有代理配置`)
        return []
      }

      const configs = JSON.parse(setting.value) as ProxyConfig[]
      if (!Array.isArray(configs)) return []
      return expandProxyConfigs(configs)
    } catch (error: any) {
      console.error(`❌ 读取用户${userId}代理配置失败:`, error.message)
      return []
    }
  }

  /**
   * 初始化用户的国家代理池
   */
  private async initializeCountryPool(userId: number, country: string): Promise<void> {
    const targetCountry = getPrimaryCountryCode(country)
    const userPool = this.userPools.get(userId)
    if (!userPool) return

    // 查找该国家的代理URL
    const targetCountryCandidates = getCountryCandidates(targetCountry)
    const proxyConfig = userPool.proxyConfigs.find((c) => {
      const proxyCountryCandidates = getCountryCandidates(c.country)
      return Array.from(proxyCountryCandidates).some(code => targetCountryCandidates.has(code))
    })
    if (!proxyConfig) {
      console.warn(`⚠️  用户${userId}没有配置${targetCountry}的代理URL`)
      return
    }

    // 创建国家池
    userPool.pools.set(targetCountry, {
      country: targetCountry,
      healthyProxies: [],
      lastRefresh: new Date(0),
      refreshing: false,
      proxyUrl: proxyConfig.url,
    })

    console.log(`✅ 用户${userId}的${targetCountry}代理池已初始化`)

    // 立即刷新
    await this.refreshCountryPool(userId, targetCountry)
  }

  /**
   * 刷新用户的国家代理池
   */
  private async refreshCountryPool(userId: number, country: string): Promise<void> {
    const userPool = this.userPools.get(userId)
    if (!userPool) return

    const countryPool = userPool.pools.get(country)
    if (!countryPool) return

    // 防止重复刷新
    if (countryPool.refreshing) {
      console.log(`⏳ 用户${userId}的${country}代理池正在刷新，跳过...`)
      return
    }

    countryPool.refreshing = true

    try {
      console.log(`🔄 刷新用户${userId}的${country}代理池...`)

      // 批量获取健康代理
      const proxies = await this.fetchHealthyProxyIPs(countryPool.proxyUrl, country, this.config.maxPoolSize)

      // 更新池
      countryPool.healthyProxies = proxies
      countryPool.lastRefresh = new Date()

      console.log(`✅ 用户${userId}的${country}代理池已刷新: ${proxies.length}个健康代理`)
    } catch (error: any) {
      console.error(`❌ 刷新用户${userId}的${country}代理池失败:`, error.message)
    } finally {
      countryPool.refreshing = false
    }
  }

  /**
   * 批量获取健康代理IP
   */
  private async fetchHealthyProxyIPs(proxyUrl: string, country: string, count: number): Promise<ProxyIP[]> {
    const proxies: ProxyIP[] = []

    for (let i = 0; i < count; i++) {
      try {
        const proxyCredentials = await fetchProxyIp(proxyUrl)
        if (proxyCredentials) {
          proxies.push({
            host: proxyCredentials.host,
            port: proxyCredentials.port,
            username: proxyCredentials.username,
            password: proxyCredentials.password,
            country,
            health: { healthy: true, lastCheck: new Date() }
          })
        }
      } catch (error) {
        console.warn(`获取代理IP失败:`, error)
      }
    }

    return proxies
  }

  /**
   * 刷新所有用户的代理池
   */
  private async refreshAllUserPools(): Promise<void> {
    console.log('🔥 刷新所有用户的代理池...')

    const refreshPromises: Promise<void>[] = []

    // 根据资源使用率动态调整并发数
    const concurrencyLimit = this.resourceMonitor.getConcurrencyLimit()
    console.log(`📊 资源状态: CPU=${this.resourceMonitor.getResourceStats().cpuUsage.toFixed(1)}%, ` +
                `Memory=${this.resourceMonitor.getResourceStats().memoryUsage.toFixed(1)}%, ` +
                `并发数=${concurrencyLimit}`)

    let activeRefreshes = 0

    for (const [userId, userPool] of this.userPools) {
      for (const [country] of userPool.pools) {
        const refreshPromise = (async () => {
          // 等待直到有可用的并发槽
          while (activeRefreshes >= concurrencyLimit) {
            await new Promise(resolve => setTimeout(resolve, 100))
          }

          activeRefreshes++
          try {
            await this.refreshCountryPool(userId, country)
          } finally {
            activeRefreshes--
          }
        })()

        refreshPromises.push(refreshPromise)
      }
    }

    await Promise.allSettled(refreshPromises)

    console.log('✅ 所有用户代理池已刷新')
    console.log('📊 池统计:', this.getStats())
  }

  /**
   * 等待代理池刷新完成
   */
  private async waitForRefresh(userId: number, country: string, maxWaitMs: number = 30000): Promise<void> {
    const userPool = this.userPools.get(userId)
    if (!userPool) return

    const countryPool = userPool.pools.get(country)
    if (!countryPool) return

    const startTime = Date.now()

    while (countryPool.refreshing && Date.now() - startTime < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
}

// ============ Singleton Instance ============

// 使用 global 对象防止热重载时重置
declare global {
  var __userIsolatedProxyPoolInstance: UserIsolatedProxyPoolManager | undefined
}

/**
 * 获取或创建用户隔离代理池管理器实例
 */
export function getUserIsolatedProxyPoolManager(): UserIsolatedProxyPoolManager {
  if (!global.__userIsolatedProxyPoolInstance) {
    global.__userIsolatedProxyPoolInstance = new UserIsolatedProxyPoolManager()
  }
  return global.__userIsolatedProxyPoolInstance
}

/**
 * 初始化并启动用户隔离代理池管理器
 */
export async function initUserIsolatedProxyPool(config?: Partial<ProxyPoolConfig>): Promise<UserIsolatedProxyPoolManager> {
  if (global.__userIsolatedProxyPoolInstance) {
    console.warn('⚠️  用户隔离代理池已初始化，返回现有实例')
    return global.__userIsolatedProxyPoolInstance
  }

  global.__userIsolatedProxyPoolInstance = new UserIsolatedProxyPoolManager(config)
  await global.__userIsolatedProxyPoolInstance.start()

  return global.__userIsolatedProxyPoolInstance
}

/**
 * 停止用户隔离代理池管理器
 */
export function stopUserIsolatedProxyPool(): void {
  if (global.__userIsolatedProxyPoolInstance) {
    global.__userIsolatedProxyPoolInstance.stop()
    global.__userIsolatedProxyPoolInstance = undefined
  }
}

export { UserIsolatedProxyPoolManager, ResourceMonitor }
export type { ProxyPoolConfig, UserProxyPoolEntry, ProxyConfig }
