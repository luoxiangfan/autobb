import type { ProxyProvider } from './base-provider'
import { IPRocketProvider } from './iprocket-provider'
import { OxylabsProvider } from './oxylabs-provider'
import { KookeeyProvider } from './kookeey-provider'
import { CliproxyProvider } from './cliproxy-provider'

/**
 * 代理提供商注册表
 * 自动检测URL格式并选择合适的Provider
 *
 * 🔧 修复(2025-12-26): 移除 GenericProxyProvider，不再支持"其他通用代理"
 */
export class ProxyProviderRegistry {
  private static providers: ProxyProvider[] = [
    new IPRocketProvider(),
    new OxylabsProvider(),
    new KookeeyProvider(),
    new CliproxyProvider(),
  ]

  /**
   * 注册新的Provider
   * @param provider - 代理提供商实例
   */
  static register(provider: ProxyProvider): void {
    this.providers.push(provider)
    console.log(`✅ 已注册代理Provider: ${provider.name}`)
  }

  /**
   * 根据URL获取合适的Provider
   * @param url - 代理URL
   * @returns 匹配的Provider实例
   * @throws 如果没有找到匹配的Provider
   */
  static getProvider(url: string): ProxyProvider {
    const provider = this.providers.find(p => p.canHandle(url))

    if (!provider) {
      const supportedFormats = this.providers.map(p => p.name).join(', ')
      throw new Error(
        `不支持的代理URL格式。当前仅支持以下格式：${supportedFormats}。\n` +
        `请使用对应的代理服务商URL格式。`
      )
    }

    return provider
  }

  /**
   * 获取所有已注册的Provider
   * @returns Provider列表
   */
  static getAllProviders(): ProxyProvider[] {
    return [...this.providers]
  }

  /**
   * 检查URL是否被支持
   * @param url - 代理URL
   * @returns true if URL format is supported
   */
  static isSupported(url: string): boolean {
    return this.providers.some(p => p.canHandle(url))
  }
}
