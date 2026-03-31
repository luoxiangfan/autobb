import type { ProxyConfig, ProxyManager } from './types'

/**
 * 代理IP池管理器
 *
 * 功能:
 * - 代理IP轮换
 * - 失败代理自动禁用
 * - 代理健康度追踪
 */
export class SimpleProxyManager implements ProxyManager {
  private proxyPool: ProxyConfig[] = []
  private currentIndex: number = 0
  private failedProxies: Set<string> = new Set()
  private proxyStats: Map<string, { success: number; failed: number }> = new Map()
  private maxFailures: number = 3 // 连续失败3次后禁用

  constructor(proxies: ProxyConfig[] = []) {
    this.proxyPool = proxies
    this.initStats()
  }

  private initStats(): void {
    this.proxyPool.forEach((proxy) => {
      const key = this.getProxyKey(proxy)
      this.proxyStats.set(key, { success: 0, failed: 0 })
    })
  }

  private getProxyKey(proxy: ProxyConfig): string {
    return `${proxy.protocol || 'http'}://${proxy.host}:${proxy.port}`
  }

  getProxy(): ProxyConfig | null {
    if (this.proxyPool.length === 0) return null

    const availableProxies = this.getAvailableProxies()
    if (availableProxies.length === 0) {
      // 所有代理都失败了，重置失败计数
      console.warn('⚠️ 所有代理IP已失败，重置失败计数')
      this.failedProxies.clear()
      return this.proxyPool[0]
    }

    // 轮换到下一个可用代理
    const proxy = availableProxies[this.currentIndex % availableProxies.length]
    this.currentIndex++

    return proxy
  }

  markProxyFailed(proxy: ProxyConfig): void {
    const key = this.getProxyKey(proxy)
    const stats = this.proxyStats.get(key)

    if (stats) {
      stats.failed++

      // 连续失败次数达到阈值，标记为不可用
      if (stats.failed >= this.maxFailures) {
        this.failedProxies.add(key)
        console.warn(`🚫 代理IP已禁用 (失败${stats.failed}次): ${key}`)
      }
    }
  }

  markProxySuccess(proxy: ProxyConfig): void {
    const key = this.getProxyKey(proxy)
    const stats = this.proxyStats.get(key)

    if (stats) {
      stats.success++

      // 成功后重置失败计数（允许恢复）
      if (stats.failed > 0) {
        stats.failed = Math.max(0, stats.failed - 1)
      }

      // 如果之前被禁用，成功后可以恢复
      if (this.failedProxies.has(key)) {
        this.failedProxies.delete(key)
        console.log(`✅ 代理IP已恢复: ${key}`)
      }
    }
  }

  addProxy(proxy: ProxyConfig): void {
    const key = this.getProxyKey(proxy)

    // 避免重复添加
    const exists = this.proxyPool.some((p) => this.getProxyKey(p) === key)
    if (exists) return

    this.proxyPool.push(proxy)
    this.proxyStats.set(key, { success: 0, failed: 0 })
  }

  removeProxy(proxy: ProxyConfig): void {
    const key = this.getProxyKey(proxy)

    this.proxyPool = this.proxyPool.filter((p) => this.getProxyKey(p) !== key)
    this.proxyStats.delete(key)
    this.failedProxies.delete(key)
  }

  getAvailableProxies(): ProxyConfig[] {
    return this.proxyPool.filter((proxy) => {
      const key = this.getProxyKey(proxy)
      return !this.failedProxies.has(key)
    })
  }

  getStats(): {
    total: number
    available: number
    failed: number
  } {
    return {
      total: this.proxyPool.length,
      available: this.getAvailableProxies().length,
      failed: this.failedProxies.size
    }
  }

  /**
   * 获取代理详细统计
   */
  getDetailedStats(): Array<{
    proxy: string
    success: number
    failed: number
    available: boolean
  }> {
    return this.proxyPool.map((proxy) => {
      const key = this.getProxyKey(proxy)
      const stats = this.proxyStats.get(key) || { success: 0, failed: 0 }
      return {
        proxy: key,
        success: stats.success,
        failed: stats.failed,
        available: !this.failedProxies.has(key)
      }
    })
  }

  /**
   * 重置所有代理状态
   */
  resetAll(): void {
    this.failedProxies.clear()
    this.proxyStats.forEach((stats) => {
      stats.success = 0
      stats.failed = 0
    })
    console.log('🔄 所有代理IP状态已重置')
  }
}
