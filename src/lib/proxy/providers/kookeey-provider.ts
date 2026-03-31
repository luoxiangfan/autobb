import type { ProxyProvider, ValidationResult } from './base-provider'
import type { ProxyCredentials } from '../types'

/**
 * Kookeey 代理提供商
 * 处理格式: host:port:username:password
 * 示例: host:port:username:passowrd
 * 直接从URL解析，无需API调用
 */
export class KookeeyProvider implements ProxyProvider {
  name = 'Kookeey'

  canHandle(url: string): boolean {
    const cleanUrl = url.replace(/^https?:\/\//, '')
    if (cleanUrl.includes('@')) return false
    return cleanUrl.includes('kookeey.info') && cleanUrl.includes(':')
  }

  validate(url: string): ValidationResult {
    const errors: string[] = []

    try {
      const cleanUrl = url.replace(/^https?:\/\//, '')
      const parts = cleanUrl.split(':')

      if (parts.length < 4) {
        errors.push('URL格式无效，应为 host:port:username:password')
        return {
          isValid: false,
          countryCode: null,
          errors,
        }
      }

      const host = parts[0]
      const port = parts[1]
      const username = parts[2]
      const password = parts[3]

      if (!host.includes('kookeey.info')) {
        errors.push('主机名必须包含 kookeey.info')
      }

      const portNum = parseInt(port, 10)
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        errors.push(`端口号无效（有效范围: 1-65535，实际值: ${port}）`)
      }

      if (!username || username.length === 0) {
        errors.push('用户名不能为空')
      }

      if (!password || password.length === 0) {
        errors.push('密码不能为空')
      }

      const countryCode = this.extractCountryCode(password)

      return {
        isValid: errors.length === 0,
        countryCode,
        errors,
      }
    } catch {
      return {
        isValid: false,
        countryCode: null,
        errors: ['URL格式无效，请检查URL是否正确'],
      }
    }
  }

  private extractCountryCode(password: string): string | null {
    const match = password.match(/-([A-Z]{2})$/i)
    return match ? match[1].toUpperCase() : null
  }

  async extractCredentials(url: string): Promise<ProxyCredentials> {
    const validation = this.validate(url)
    if (!validation.isValid) {
      throw new Error(`Kookeey URL验证失败:\n${validation.errors.join('\n')}`)
    }

    try {
      const cleanUrl = url.replace(/^https?:\/\//, '')
      const parts = cleanUrl.split(':')
      const host = parts[0]
      const port = parts[1]
      const username = parts[2]
      const password = parts[3]

      const credentials: ProxyCredentials = {
        host,
        port: parseInt(port, 10),
        username,
        password,
        fullAddress: `${host}:${port}`,
      }

      if (!credentials.host || credentials.host.length < 3) {
        throw new Error(`主机地址无效: ${credentials.host}`)
      }

      if (!credentials.username || credentials.username.length === 0) {
        throw new Error('用户名不能为空')
      }

      if (!credentials.password || credentials.password.length === 0) {
        throw new Error('密码不能为空')
      }

      console.log(`✅ [Kookeey] 解析代理凭证: ${credentials.fullAddress}`)
      if (validation.countryCode) {
        console.log(`   国家代码: ${validation.countryCode}`)
      }

      return credentials
    } catch (error) {
      throw new Error(`解析Kookeey URL失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
