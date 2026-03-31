import type { ProxyProvider } from './base-provider'
import type { ProxyCredentials } from '../types'
import type { ValidationResult } from './base-provider'

/**
 * Abcproxy代理提供商
 * 处理格式: host:port:username:password
 * 示例:
 *   - na.02b22e116103ae77.abcproxy.vip:4950:abc4766772_6781_ds-zone-abc-region-US:Aa114524
 *   - http://na.02b22e116103ae77.abcproxy.vip:4950:abc4766772_6781_ds-zone-abc-region-US:Aa114524
 * 直接从URL解析，无需API调用
 */
export class AbcproxyProvider implements ProxyProvider {
  name = 'Abcproxy'

  canHandle(url: string): boolean {
    // 检查是否包含abcproxy.vip域名且使用冒号分隔格式
    return url.includes('abcproxy.vip') && url.includes(':')
  }

  validate(url: string): ValidationResult {
    const errors: string[] = []

    try {
      // 🔧 移除 http:// 或 https:// 前缀（如果存在）
      const cleanUrl = url.replace(/^https?:\/\//, '')

      // 验证格式：host:port:username:password
      const parts = cleanUrl.split(':')

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

      // 验证主机名包含abcproxy.vip
      if (!host.includes('abcproxy.vip')) {
        errors.push('主机名必须包含abcproxy.vip')
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

      // 提取国家代码（可选，从username中提取）
      const countryCode = this.extractCountryCode(username)

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
   * 从用户名中提取国家代码（如果有）
   * 例如: abc4766772_6781_ds-zone-abc-region-US -> US
   */
  private extractCountryCode(username: string): string | null {
    const match = username.match(/region-([A-Z]{2})/i)
    return match ? match[1].toUpperCase() : null
  }

  async extractCredentials(url: string): Promise<ProxyCredentials> {
    // 🔧 移除 http:// 或 https:// 前缀（如果存在）
    const cleanUrl = url.replace(/^https?:\/\//, '')

    // 验证URL
    const validation = this.validate(cleanUrl)
    if (!validation.isValid) {
      throw new Error(`Abcproxy URL验证失败:\n${validation.errors.join('\n')}`)
    }

    try {
      // 解析各部分
      const parts = cleanUrl.split(':')
      const host = parts[0] // 第一部分是host
      const port = parts[1] // 第二部分是port
      const username = parts[2] // 第三部分是username
      const password = parts[3] // 第四部分是password

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

      console.log(`✅ [Abcproxy] 解析代理凭证: ${credentials.fullAddress}`)
      if (validation.countryCode) {
        console.log(`   国家代码: ${validation.countryCode}`)
      }

      return credentials
    } catch (error) {
      throw new Error(`解析Abcproxy URL失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
