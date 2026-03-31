/**
 * 代理IP预热池
 *
 * 批量预先验证代理IP，使用时直接取用健康的代理
 * 减少请求时的等待时间
 */

import { fetchProxyIp } from './fetch-proxy-ip'
import type { ProxyCredentials } from './types'
import { maskProxyUrl } from './validate-url'

interface WarmProxy {
  credentials: ProxyCredentials
  validatedAt: number
  responseTime: number
}

interface ProxyPool {
  proxyUrl: string
  warmProxies: WarmProxy[]
  lastRefreshAt: number
  isRefreshing: boolean
}

// 预热池配置
const POOL_CONFIG = {
  minPoolSize: 3,       // 池中最小代理数量
  maxPoolSize: 10,      // 池中最大代理数量
  refreshInterval: 2 * 60 * 1000,  // 2分钟刷新一次
  proxyTTL: 5 * 60 * 1000,         // 代理有效期5分钟
  warmupBatchSize: 5,   // 每次预热数量
}

// 按proxyUrl分组的预热池
const warmPools = new Map<string, ProxyPool>()

/**
 * 从预热池获取健康的代理IP
 * 如果池为空，则同步获取新代理
 */
export async function getWarmProxy(proxyUrl: string): Promise<ProxyCredentials> {
  const pool = warmPools.get(proxyUrl)
  const now = Date.now()

  // 尝试从池中获取有效代理
  if (pool && pool.warmProxies.length > 0) {
    // 过滤掉过期的代理
    pool.warmProxies = pool.warmProxies.filter(p => now - p.validatedAt < POOL_CONFIG.proxyTTL)

    if (pool.warmProxies.length > 0) {
      // 按响应时间排序，取最快的
      pool.warmProxies.sort((a, b) => a.responseTime - b.responseTime)
      const warmProxy = pool.warmProxies.shift()!

      console.log(`🚀 从预热池获取代理: ${warmProxy.credentials.fullAddress} (${warmProxy.responseTime}ms)`)

      // 触发后台补充
      if (pool.warmProxies.length < POOL_CONFIG.minPoolSize && !pool.isRefreshing) {
        refreshPoolBackground(proxyUrl)
      }

      return warmProxy.credentials
    }
  }

  // 池为空，同步获取新代理
  console.log('📭 预热池为空，同步获取代理IP...')
  return fetchProxyIp(proxyUrl, 3, false)
}

/**
 * 后台刷新预热池
 */
async function refreshPoolBackground(proxyUrl: string): Promise<void> {
  let pool = warmPools.get(proxyUrl)

  if (!pool) {
    pool = {
      proxyUrl,
      warmProxies: [],
      lastRefreshAt: 0,
      isRefreshing: false,
    }
    warmPools.set(proxyUrl, pool)
  }

  if (pool.isRefreshing) {
    return
  }

  pool.isRefreshing = true
  console.log(`🔄 开始后台预热代理池: ${maskProxyUrl(proxyUrl)}`)

  try {
    const batchSize = Math.min(
      POOL_CONFIG.warmupBatchSize,
      POOL_CONFIG.maxPoolSize - pool.warmProxies.length
    )

    const promises: Promise<WarmProxy | null>[] = []

    for (let i = 0; i < batchSize; i++) {
      promises.push(warmupSingleProxy(proxyUrl))
    }

    const results = await Promise.all(promises)
    const successfulProxies = results.filter((p): p is WarmProxy => p !== null)

    pool.warmProxies.push(...successfulProxies)
    pool.lastRefreshAt = Date.now()

    console.log(`✅ 预热完成: ${successfulProxies.length}/${batchSize} 个代理可用，池大小: ${pool.warmProxies.length}`)
  } catch (error) {
    console.error('❌ 预热池刷新失败:', error)
  } finally {
    pool.isRefreshing = false
  }
}

/**
 * 预热单个代理
 */
async function warmupSingleProxy(proxyUrl: string): Promise<WarmProxy | null> {
  try {
    const startTime = Date.now()
    const credentials = await fetchProxyIp(proxyUrl, 1, false) // 只尝试1次，启用健康检查
    const responseTime = Date.now() - startTime

    return {
      credentials,
      validatedAt: Date.now(),
      responseTime,
    }
  } catch (error) {
    return null
  }
}

/**
 * 初始化预热池（在应用启动时调用）
 */
export async function initWarmPool(proxyUrls: string[]): Promise<void> {
  console.log(`🔥 初始化代理预热池，共 ${proxyUrls.length} 个代理URL...`)

  const promises = proxyUrls.map(url => refreshPoolBackground(url))
  await Promise.all(promises)

  console.log('✅ 代理预热池初始化完成')
}

/**
 * 获取预热池状态
 */
export function getWarmPoolStats(): Record<string, { poolSize: number; isRefreshing: boolean; lastRefreshAt: number }> {
  const stats: Record<string, { poolSize: number; isRefreshing: boolean; lastRefreshAt: number }> = {}

  warmPools.forEach((pool, url) => {
    // 使用URL的hash作为key（避免暴露完整URL）
    const urlHash = url.substring(0, 30) + '...'
    stats[urlHash] = {
      poolSize: pool.warmProxies.length,
      isRefreshing: pool.isRefreshing,
      lastRefreshAt: pool.lastRefreshAt,
    }
  })

  return stats
}

/**
 * 清空预热池
 */
export function clearWarmPool(proxyUrl?: string): void {
  if (proxyUrl) {
    warmPools.delete(proxyUrl)
    console.log(`🗑️ 已清空预热池: ${proxyUrl.substring(0, 30)}...`)
  } else {
    warmPools.clear()
    console.log('🗑️ 已清空所有预热池')
  }
}

/**
 * 定时刷新预热池（可选：在应用中设置定时器）
 */
export function startPeriodicRefresh(proxyUrls: string[]): NodeJS.Timeout {
  return setInterval(() => {
    proxyUrls.forEach(url => {
      const pool = warmPools.get(url)
      if (!pool || pool.warmProxies.length < POOL_CONFIG.minPoolSize) {
        refreshPoolBackground(url)
      }
    })
  }, POOL_CONFIG.refreshInterval)
}
