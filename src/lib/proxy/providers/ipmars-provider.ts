import type { ProxyProvider } from './base-provider'
import type { ProxyCredentials } from '../types'
import type { ValidationResult } from './base-provider'

/**
 * IpMars代理提供商
 * 处理格式: host:port:username:password
 * 示例: ipmars.com:4950:username:password 或 ipmars.vip:4950:username:password
 * 直接从URL解析，无需API调用
 */
export class IpMarsProvider implements ProxyProvider {
  name = 'IpMars'

  canHandle(url: string): boolean {
    // 检查是否包含ipmars域名（.com 或 .vip）且使用冒号分隔格式
    // 支持可选 http(s):// 前缀，但不支持包含 @ 的标准URL认证格式
    const cleanUrl = url.replace(/^https?:\/\//, '')
    if (cleanUrl.includes('@')) return false

    return (cleanUrl.includes('ipmars.com') || cleanUrl.includes('ipmars.vip')) && cleanUrl.includes(':')
  }

  validate(url: string): ValidationResult {
    const errors: string[] = []

    try {
      // 验证格式：host:port:username:password
      const cleanUrl = url.replace(/^https?:\/\//, '')
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

      // 验证主机名包含ipmars.com或ipmars.vip
      if (!host.includes('ipmars.com') && !host.includes('ipmars.vip')) {
        errors.push('主机名必须包含ipmars.com或ipmars.vip')
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
   * 例如: user_zone-US -> US
   */
  private extractCountryCode(username: string): string | null {
    const match = username.match(/[-_]([A-Z]{2})$/i)
    return match ? match[1].toUpperCase() : null
  }

  async extractCredentials(url: string): Promise<ProxyCredentials> {
    // 验证URL
    const validation = this.validate(url)
    if (!validation.isValid) {
      throw new Error(`IpMars URL验证失败:\n${validation.errors.join('\n')}`)
    }

    try {
      // 解析各部分
      const cleanUrl = url.replace(/^https?:\/\//, '')
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

      console.log(`✅ [IpMars] 解析代理凭证: ${credentials.fullAddress}`)
      if (validation.countryCode) {
        console.log(`   国家代码: ${validation.countryCode}`)
      }

      return credentials
    } catch (error) {
      throw new Error(`解析IpMars URL失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
