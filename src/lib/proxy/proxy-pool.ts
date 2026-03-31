/**
 * Proxy IP Pool Manager with Preheating Cache
 *
 * Purpose: Maintain a pre-warmed pool of healthy proxy IPs to reduce latency
 * Expected Benefit: Save 3-5s per request by eliminating cold-start health checks
 */

import { HttpsProxyAgent } from 'https-proxy-agent'
import type { ProxyIP } from './types'
import { getProxyIp, fetchProxyIp } from './fetch-proxy-ip'
import { getDatabase } from '../db'
import { normalizeCountryCode } from '../language-country-codes'

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

function expandProxyUrlCountries(proxyUrls: Array<{ country: string; url: string }>): Array<{ country: string; url: string }> {
  const expanded: Array<{ country: string; url: string }> = []
  const seen = new Set<string>()

  for (const item of proxyUrls) {
    const rawCountry = String(item?.country || '').trim()
    const url = String(item?.url || '').trim()
    if (!rawCountry || !url) continue

    const countryCandidates = getCountryCandidates(rawCountry)
    const finalCandidates = countryCandidates.size > 0
      ? Array.from(countryCandidates)
      : [rawCountry.toUpperCase()]

    for (const candidate of finalCandidates) {
      const key = `${candidate}\u0000${url}`
      if (seen.has(key)) continue
      seen.add(key)
      expanded.push({ country: candidate, url })
    }
  }

  return expanded
}

// 临时实现：批量获取代理IP
async function fetchHealthyProxyIPs(country: string, count: number): Promise<ProxyIP[]> {
  try {
    // 从数据库中读取代理配置（获取最新的非空配置）
    const db = await getDatabase()
    const setting = await db.queryOne(`
      SELECT value FROM system_settings
      WHERE category = 'proxy' AND key = 'urls'
        AND value IS NOT NULL AND value <> ''
      ORDER BY updated_at DESC
      LIMIT 1
    `) as { value: string } | undefined

    if (!setting) {
      console.warn(`⚠️  未找到代理配置`)
      return []
    }

    const proxyConfigsRaw = JSON.parse(setting.value || '[]')
    const proxyConfigs = Array.isArray(proxyConfigsRaw)
      ? expandProxyUrlCountries(
          proxyConfigsRaw
            .filter((c: any) => c && typeof c.country === 'string' && typeof c.url === 'string')
            .map((c: any) => ({ country: String(c.country || '').trim(), url: String(c.url || '').trim() }))
        )
      : []
    const targetCountryCandidates = getCountryCandidates(country)
    let proxyUrl = proxyConfigs.find((c: any) =>
      Array.from(getCountryCandidates(String(c.country || '')))
        .some(code => targetCountryCandidates.has(code))
    )?.url

    // 如果没有找到对应国家的配置，使用第一个作为默认值
    if (!proxyUrl && proxyConfigs.length > 0) {
      proxyUrl = proxyConfigs[0].url
      console.log(`使用默认代理URL (${proxyConfigs[0].country})`)
    }

    if (!proxyUrl) {
      console.warn(`⚠️  未找到${country}的代理配置`)
      return []
    }

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
  } catch (error) {
    console.error(`fetchHealthyProxyIPs错误:`, error)
    return []
  }
}

interface ProxyPoolEntry {
  country: string
  healthyProxies: ProxyIP[]
  lastRefresh: Date
  refreshing: boolean
}

interface ProxyPoolConfig {
  refreshIntervalMs: number  // How often to refresh the pool
  minHealthyProxies: number  // Minimum number of healthy proxies to maintain
  maxPoolSize: number        // Maximum proxies per country
  countries: string[]        // Countries to maintain pools for
}

class ProxyPoolManager {
  private pools: Map<string, ProxyPoolEntry> = new Map()
  private refreshTimer: NodeJS.Timeout | null = null
  private config: ProxyPoolConfig

  constructor(config?: Partial<ProxyPoolConfig>) {
    this.config = {
      refreshIntervalMs: 5 * 60 * 1000,  // 5 minutes
      minHealthyProxies: 3,
      maxPoolSize: 10,
      countries: ['US', 'DE', 'GB'],  // 使用ISO 3166-1标准国家代码（GB而非UK）
      ...config,
    }

    // Initialize pools for each country
    for (const country of this.config.countries) {
      this.pools.set(country, {
        country,
        healthyProxies: [],
        lastRefresh: new Date(0), // Epoch - force initial refresh
        refreshing: false,
      })
    }
  }

  /**
   * Start the pool preheating process
   */
  async start(): Promise<void> {
    console.log('🚀 Starting Proxy Pool Manager...')
    console.log(`   Refresh interval: ${this.config.refreshIntervalMs / 1000}s`)
    console.log(`   Countries: ${this.config.countries.join(', ')}`)
    console.log(`   Min healthy proxies: ${this.config.minHealthyProxies}`)

    // Initial warm-up for all countries
    await this.warmUpAllPools()

    // Schedule periodic refresh
    this.refreshTimer = setInterval(() => {
      this.warmUpAllPools().catch((error) => {
        console.error('❌ Proxy pool refresh failed:', error.message)
      })
    }, this.config.refreshIntervalMs)

    console.log('✅ Proxy Pool Manager started')
  }

  /**
   * Stop the pool manager
   */
  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
      console.log('🛑 Proxy Pool Manager stopped')
    }
  }

  /**
   * Get a healthy proxy from the pool (instant if cache hit)
   */
  async getHealthyProxy(country: string): Promise<ProxyIP | null> {
    const pool = this.pools.get(country)

    if (!pool) {
      console.warn(`⚠️ No pool configured for country: ${country}`)
      // Fallback to direct fetch
      const proxies = await fetchHealthyProxyIPs(country, 1)
      return proxies[0] || null
    }

    // If pool has healthy proxies, return immediately (cache hit)
    if (pool.healthyProxies.length > 0) {
      const proxy = pool.healthyProxies[Math.floor(Math.random() * pool.healthyProxies.length)]
      console.log(`✅ Proxy pool cache HIT for ${country} (${pool.healthyProxies.length} available)`)
      return proxy
    }

    // Cache miss - need to fetch
    console.warn(`⚠️ Proxy pool cache MISS for ${country}, fetching...`)

    // If already refreshing, wait for it
    if (pool.refreshing) {
      await this.waitForRefresh(country)
      return this.getHealthyProxy(country) // Retry after refresh
    }

    // Trigger immediate refresh
    await this.refreshPool(country)
    return this.getHealthyProxy(country) // Retry after refresh
  }

  /**
   * Get multiple healthy proxies from the pool
   */
  async getHealthyProxies(country: string, count: number): Promise<ProxyIP[]> {
    const pool = this.pools.get(country)

    if (!pool) {
      console.warn(`⚠️ No pool configured for country: ${country}`)
      return await fetchHealthyProxyIPs(country, count)
    }

    // If pool has enough proxies, return from cache
    if (pool.healthyProxies.length >= count) {
      const proxies = pool.healthyProxies.slice(0, count)
      console.log(`✅ Proxy pool cache HIT for ${country} (requested ${count}, available ${pool.healthyProxies.length})`)
      return proxies
    }

    // Not enough in cache, trigger refresh
    console.warn(`⚠️ Proxy pool has insufficient proxies for ${country} (need ${count}, have ${pool.healthyProxies.length})`)
    await this.refreshPool(country)

    // Return what we have after refresh
    const proxies = pool.healthyProxies.slice(0, count)
    return proxies
  }

  /**
   * Get pool statistics
   */
  getStats(): Record<string, any> {
    const stats: Record<string, any> = {}

    for (const [country, pool] of this.pools) {
      stats[country] = {
        healthyCount: pool.healthyProxies.length,
        lastRefresh: pool.lastRefresh.toISOString(),
        refreshing: pool.refreshing,
        cacheAge: Date.now() - pool.lastRefresh.getTime(),
      }
    }

    return stats
  }

  /**
   * Force refresh a specific country pool
   */
  async forceRefresh(country: string): Promise<void> {
    await this.refreshPool(country)
  }

  // ============ Private Methods ============

  /**
   * Warm up all country pools in parallel
   */
  private async warmUpAllPools(): Promise<void> {
    console.log('🔥 Warming up proxy pools...')

    const refreshPromises = this.config.countries.map((country) =>
      this.refreshPool(country).catch((error) => {
        console.error(`❌ Failed to refresh pool for ${country}:`, error.message)
      })
    )

    await Promise.allSettled(refreshPromises)

    console.log('✅ Proxy pools warmed up')
    console.log('📊 Pool stats:', this.getStats())
  }

  /**
   * Refresh a single country pool
   */
  private async refreshPool(country: string): Promise<void> {
    const pool = this.pools.get(country)
    if (!pool) return

    // Prevent duplicate refreshes
    if (pool.refreshing) {
      console.log(`⏳ Pool refresh already in progress for ${country}, skipping...`)
      return
    }

    pool.refreshing = true

    try {
      console.log(`🔄 Refreshing proxy pool for ${country}...`)

      // Fetch healthy proxies
      const proxies = await fetchHealthyProxyIPs(country, this.config.maxPoolSize)

      // Update pool
      pool.healthyProxies = proxies
      pool.lastRefresh = new Date()

      console.log(`✅ Proxy pool refreshed for ${country}: ${proxies.length} healthy proxies`)
    } catch (error: any) {
      console.error(`❌ Failed to refresh proxy pool for ${country}:`, error.message)
    } finally {
      pool.refreshing = false
    }
  }

  /**
   * Wait for a pool refresh to complete
   */
  private async waitForRefresh(country: string, maxWaitMs: number = 30000): Promise<void> {
    const pool = this.pools.get(country)
    if (!pool) return

    const startTime = Date.now()

    while (pool.refreshing && Date.now() - startTime < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
}

// ============ Singleton Instance ============

// 使用 global 对象防止热重载时重置
declare global {
  var __proxyPoolManagerInstance: ProxyPoolManager | undefined
}

/**
 * Get or create the global proxy pool manager instance
 */
export function getProxyPoolManager(): ProxyPoolManager {
  if (!global.__proxyPoolManagerInstance) {
    global.__proxyPoolManagerInstance = new ProxyPoolManager()
  }
  return global.__proxyPoolManagerInstance
}

/**
 * Initialize and start the proxy pool manager
 */
export async function initProxyPool(config?: Partial<ProxyPoolConfig>): Promise<ProxyPoolManager> {
  if (global.__proxyPoolManagerInstance) {
    console.warn('⚠️ Proxy pool already initialized, returning existing instance')
    return global.__proxyPoolManagerInstance
  }

  global.__proxyPoolManagerInstance = new ProxyPoolManager(config)
  await global.__proxyPoolManagerInstance.start()

  return global.__proxyPoolManagerInstance
}

/**
 * Stop the proxy pool manager
 */
export function stopProxyPool(): void {
  if (global.__proxyPoolManagerInstance) {
    global.__proxyPoolManagerInstance.stop()
    global.__proxyPoolManagerInstance = undefined
  }
}

export { ProxyPoolManager }
export type { ProxyPoolConfig, ProxyPoolEntry }
