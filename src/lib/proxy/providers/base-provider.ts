import type { ProxyCredentials } from '../types'

/**
 * 代理URL验证结果
 */
export interface ValidationResult {
  isValid: boolean
  countryCode: string | null
  errors: string[]
}

/**
 * 代理提供商基础接口
 */
export interface ProxyProvider {
  /**
   * 提供商名称
   */
  name: string

  /**
   * 判断是否能处理该URL格式
   * @param url - 代理URL
   * @returns true if this provider can handle the URL
   */
  canHandle(url: string): boolean

  /**
   * 验证URL格式
   * @param url - 代理URL
   * @returns 验证结果
   */
  validate(url: string): ValidationResult

  /**
   * 从URL提取代理凭证
   * @param url - 代理URL
   * @returns 代理凭证信息
   */
  extractCredentials(url: string): Promise<ProxyCredentials>
}
