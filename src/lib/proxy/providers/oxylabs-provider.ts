import type { ProxyProvider } from './base-provider'
import type { ProxyCredentials } from '../types'
import type { ValidationResult } from './base-provider'

/**
 * Oxylabs代理提供商
 * 处理格式: https://username:password@pr.oxylabs.io:port
 * 直接从URL解析，无需API调用
 */
export class OxylabsProvider implements ProxyProvider {
  name = 'Oxylabs'

  canHandle(url: string): boolean {
    return url.includes('pr.oxylabs.io')
  }

  validate(url: string): ValidationResult {
    const errors: string[] = []

    try {
      const parsed = new URL(url)

      // 验证协议
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.push('URL必须使用HTTP或HTTPS协议')
      }

      // 验证主机名包含oxylabs
      if (!parsed.hostname.includes('oxylabs.io')) {
        errors.push('主机名必须包含oxylabs.io')
      }

      // 验证端口
      const port = parseInt(parsed.port)
      if (isNaN(port) || port < 1 || port > 65535) {
        errors.push(`端口号无效（有效范围: 1-65535）`)
      }

      // 验证认证信息
      if (!parsed.username) {
        errors.push('缺少用户名')
      }

      if (!parsed.password) {
        errors.push('缺少密码')
      }

      // 提取国家代码（可选）
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
   * 从URL中提取国家代码（如果有）
   * 例如: customer-xxrenzhe_pQhay-cc-fr -> fr
   */
  private extractCountryCode(url: string): string | null {
    const match = url.match(/cc-([a-z]{2})/i)
    return match ? match[1].toUpperCase() : null
  }

  async extractCredentials(url: string): Promise<ProxyCredentials> {
    // 验证URL
    const validation = this.validate(url)
    if (!validation.isValid) {
      throw new Error(`Oxylabs URL验证失败:\n${validation.errors.join('\n')}`)
    }

    try {
      const parsed = new URL(url)

      const credentials: ProxyCredentials = {
        host: parsed.hostname,
        port: parseInt(parsed.port),
        username: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        fullAddress: `${parsed.hostname}:${parsed.port}`,
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

      console.log(`✅ [Oxylabs] 解析代理凭证: ${credentials.fullAddress}`)
      if (validation.countryCode) {
        console.log(`   国家代码: ${validation.countryCode}`)
      }

      return credentials
    } catch (error) {
      throw new Error(`解析Oxylabs URL失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
