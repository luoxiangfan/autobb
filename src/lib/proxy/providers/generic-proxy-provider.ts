import type { ProxyProvider } from './base-provider'
import type { ProxyCredentials } from '../types'
import type { ValidationResult } from './base-provider'

/**
 * 通用其他代理提供商
 * 处理格式: host:port:username:password
 * 支持任何符合该格式的代理，不限制特定域名
 * 优先级最低，用于兜底处理
 */
export class GenericProxyProvider implements ProxyProvider {
  name = 'Generic'

  canHandle(url: string): boolean {
    // 检查是否为冒号分隔格式且不包含其他已知格式
    const hasColonFormat = url.includes(':')
    const hasFourParts = url.split(':').length >= 4

    // 不匹配已知的其他Provider格式
    const isNotIPRocket = !url.includes('api.iprocket.io')
    const isNotOxylabs = !url.includes('oxylabs.io')
    const isNotAbcproxy = !url.includes('abcproxy.vip')

    // 必须是纯文本格式（非HTTP/HTTPS协议）
    const isNotHttpUrl = !url.startsWith('http://') && !url.startsWith('https://')

    return hasColonFormat && hasFourParts && isNotIPRocket && isNotOxylabs && isNotAbcproxy && isNotHttpUrl
  }

  validate(url: string): ValidationResult {
    const errors: string[] = []

    try {
      // 验证格式：host:port:username:password
      const parts = url.split(':')

      // 至少需要4个部分：host, port, username, password
      if (parts.length < 4) {
        errors.push('URL格式无效，应为 host:port:username:password')
        return {
          isValid: false,
          countryCode: null,
          errors,
        }
      }

      // 解析各部分
      const host = parts[0]
      const port = parts[1]
      const username = parts[2]
      const password = parts[3]

      // 验证主机名不为空且至少3个字符
      if (!host || host.length < 3) {
        errors.push('主机名无效（至少3个字符）')
      }

      // 验证端口号
      const portNum = parseInt(port)
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        errors.push(`端口号无效（有效范围: 1-65535，实际值: ${port}）`)
      }

      // 验证用户名和密码不为空
      if (!username || username.length === 0) {
        errors.push('用户名不能为空')
      }

      if (!password || password.length === 0) {
        errors.push('密码不能为空')
      }

      // 尝试提取国家代码（可选）
      const countryCode = this.extractCountryCode(url)

      return {
        isValid: errors.length === 0,
        countryCode,
        errors,
      }
    } catch (error) {
      return {
        isValid: false,
        countryCode: null,
        errors: ['URL格式无效，请检查URL是否正确'],
      }
    }
  }

  /**
   * 尝试从URL或用户名中提取国家代码
   * 支持多种格式：
   * - region-US
   * - cc-US
   * - country-US
   * - -US-
   */
  private extractCountryCode(input: string): string | null {
    // 尝试多种国家代码提取模式
    const patterns = [
      /region-([A-Z]{2})/i,
      /cc-([A-Z]{2})/i,
      /country-([A-Z]{2})/i,
      /-([A-Z]{2})-/,
      /_([A-Z]{2})_/,
    ]

    for (const pattern of patterns) {
      const match = input.match(pattern)
      if (match) {
        return match[1].toUpperCase()
      }
    }

    return null
  }

  async extractCredentials(url: string): Promise<ProxyCredentials> {
    // 验证URL
    const validation = this.validate(url)
    if (!validation.isValid) {
      throw new Error(`Generic代理URL验证失败:\n${validation.errors.join('\n')}`)
    }

    try {
      // 解析各部分
      const parts = url.split(':')
      const host = parts[0]
      const port = parts[1]
      const username = parts[2]
      const password = parts[3]

      const credentials: ProxyCredentials = {
        host,
        port: parseInt(port),
        username,
        password,
        fullAddress: `${host}:${port}`,
      }

      // 额外验证
      if (!credentials.host || credentials.host.length < 3) {
        throw new Error(`主机地址无效: ${credentials.host}`)
      }

      if (!credentials.username || credentials.username.length === 0) {
        throw new Error('用户名不能为空')
      }

      if (!credentials.password || credentials.password.length === 0) {
        throw new Error('密码不能为空')
      }

      console.log(`✅ [Generic] 解析代理凭证: ${credentials.fullAddress}`)
      if (validation.countryCode) {
        console.log(`   国家代码: ${validation.countryCode}`)
      }

      return credentials
    } catch (error) {
      throw new Error(`解析Generic代理URL失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
