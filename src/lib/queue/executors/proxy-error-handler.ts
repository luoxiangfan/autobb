/**
 * 统一的代理错误处理工具
 * 用于所有执行器中的代理错误检测和提示
 *
 * 使用场景：
 * - url-swap-executor（换链接任务）
 * - click-farm-executor（补点击任务）
 * - link-check-executor（链接检查任务）
 * - scrape-executor（网页抓取任务）
 */

export interface ProxyErrorAnalysis {
  isProxyError: boolean
  isIPRocketBusinessError: boolean
  enhancedMessage: string
  originalMessage: string
  suggestions: string[]
}

/**
 * 分析代理错误并生成详细的错误提示
 *
 * @param error - 捕获的错误对象
 * @returns 错误分析结果，包含增强的错误消息和建议
 *
 * @example
 * ```typescript
 * try {
 *   await fetchProxyIp(proxyUrl)
 * } catch (error) {
 *   const analysis = analyzeProxyError(error)
 *   if (analysis.isIPRocketBusinessError) {
 *     console.error(analysis.enhancedMessage)
 *     // 通知用户检查 IPRocket 账户
 *   }
 * }
 * ```
 */
export function analyzeProxyError(error: any): ProxyErrorAnalysis {
  const rawMessage = error?.message || String(error)

  // 检测 IPRocket 业务错误（最高优先级）
  const isIPRocketBusinessError =
    rawMessage.includes('IPRocket') &&
    (rawMessage.includes('Business abnormality') ||
     rawMessage.includes('business error') ||
     rawMessage.includes('contact customer service') ||
     rawMessage.includes('account abnormal') ||
     rawMessage.includes('risk control'))

  if (isIPRocketBusinessError) {
    return {
      isProxyError: true,
      isIPRocketBusinessError: true,
      enhancedMessage:
        `🔴 IPRocket 代理服务商返回业务异常\n\n` +
        `可能原因：\n` +
        `1. 账户配额已用完 - 请检查 IPRocket 账户余额和流量\n` +
        `2. 账户被暂停或限制 - 请联系 IPRocket 客服确认账户状态\n` +
        `3. 触发风控限制 - 请降低请求频率或更换代理服务商\n` +
        `4. 服务商临时故障 - 请稍后重试\n\n` +
        `建议操作：\n` +
        `✓ 登录 IPRocket 控制台检查账户状态\n` +
        `✓ 考虑更换代理服务商（Oxylabs、Bright Data 等）\n` +
        `✓ 或暂时禁用部分任务，降低请求频率\n\n` +
        `原始错误: ${rawMessage}`,
      originalMessage: rawMessage,
      suggestions: [
        '检查 IPRocket 账户状态',
        '考虑更换代理服务商',
        '降低请求频率'
      ]
    }
  }

  // 检测其他代理服务商的配额错误
  const isQuotaError =
    rawMessage.includes('quota') ||
    rawMessage.includes('limit exceeded') ||
    rawMessage.includes('insufficient balance') ||
    rawMessage.includes('no credit') ||
    rawMessage.includes('配额') ||
    rawMessage.includes('余额不足')

  if (isQuotaError) {
    return {
      isProxyError: true,
      isIPRocketBusinessError: false,
      enhancedMessage:
        `⚠️ 代理服务商配额不足\n\n` +
        `可能原因：\n` +
        `1. 代理服务配额已用完\n` +
        `2. 账户余额不足\n\n` +
        `建议操作：\n` +
        `✓ 检查代理服务商账户余额和配额\n` +
        `✓ 充值或升级套餐\n\n` +
        `原始错误: ${rawMessage}`,
      originalMessage: rawMessage,
      suggestions: ['检查代理配额', '充值账户']
    }
  }

  // 检测代理认证错误
  const isAuthError =
    rawMessage.includes('unauthorized') ||
    rawMessage.includes('authentication failed') ||
    rawMessage.includes('invalid credentials') ||
    rawMessage.includes('认证失败') ||
    rawMessage.includes('用户名或密码错误')

  if (isAuthError) {
    return {
      isProxyError: true,
      isIPRocketBusinessError: false,
      enhancedMessage:
        `⚠️ 代理服务认证失败\n\n` +
        `可能原因：\n` +
        `1. 代理用户名或密码错误\n` +
        `2. API Key 无效或过期\n\n` +
        `建议操作：\n` +
        `✓ 检查代理配置中的用户名和密码\n` +
        `✓ 确认 API Key 有效\n\n` +
        `原始错误: ${rawMessage}`,
      originalMessage: rawMessage,
      suggestions: ['检查代理认证信息', '更新 API Key']
    }
  }

  // 检测代理网络错误
  const isNetworkError =
    rawMessage.includes('timeout') ||
    rawMessage.includes('ECONNREFUSED') ||
    rawMessage.includes('ENOTFOUND') ||
    rawMessage.includes('network') ||
    rawMessage.includes('DNS') ||
    rawMessage.includes('连接超时') ||
    rawMessage.includes('网络错误')

  if (isNetworkError) {
    return {
      isProxyError: true,
      isIPRocketBusinessError: false,
      enhancedMessage:
        `⚠️ 代理网络连接失败\n\n` +
        `可能原因：\n` +
        `1. 代理服务器无法访问\n` +
        `2. 网络连接超时\n` +
        `3. DNS 解析失败\n\n` +
        `建议操作：\n` +
        `✓ 检查代理服务器状态\n` +
        `✓ 确认网络连接正常\n` +
        `✓ 稍后重试\n\n` +
        `原始错误: ${rawMessage}`,
      originalMessage: rawMessage,
      suggestions: ['检查网络连接', '稍后重试']
    }
  }

  // 检测一般代理错误
  const isProxyError =
    rawMessage.includes('proxy') ||
    rawMessage.includes('代理') ||
    rawMessage.includes('ProxyError') ||
    rawMessage.includes('获取代理IP失败') ||
    rawMessage.includes('代理IP') ||
    rawMessage.includes('Proxy')

  if (isProxyError) {
    return {
      isProxyError: true,
      isIPRocketBusinessError: false,
      enhancedMessage:
        `⚠️ 代理服务错误\n\n` +
        `建议操作：\n` +
        `✓ 检查代理配置是否正确\n` +
        `✓ 确认代理服务可用\n` +
        `✓ 查看详细错误信息\n\n` +
        `原始错误: ${rawMessage}`,
      originalMessage: rawMessage,
      suggestions: ['检查代理配置', '确认代理服务可用']
    }
  }

  // 非代理错误
  return {
    isProxyError: false,
    isIPRocketBusinessError: false,
    enhancedMessage: rawMessage,
    originalMessage: rawMessage,
    suggestions: []
  }
}

/**
 * 简化版：仅检测是否为 IPRocket 业务错误
 * 用于快速判断场景
 */
export function isIPRocketBusinessError(error: any): boolean {
  const rawMessage = error?.message || String(error)
  return (
    rawMessage.includes('IPRocket') &&
    (rawMessage.includes('Business abnormality') ||
     rawMessage.includes('business error') ||
     rawMessage.includes('contact customer service') ||
     rawMessage.includes('account abnormal') ||
     rawMessage.includes('risk control'))
  )
}

/**
 * 简化版：仅检测是否为代理相关错误
 * 用于快速判断场景
 */
export function isProxyRelatedError(error: any): boolean {
  const rawMessage = error?.message || String(error)
  return (
    rawMessage.includes('proxy') ||
    rawMessage.includes('代理') ||
    rawMessage.includes('ProxyError') ||
    rawMessage.includes('IPRocket') ||
    rawMessage.includes('Oxylabs') ||
    rawMessage.includes('获取代理IP失败')
  )
}
