/**
 * Gemini API 服务商配置
 *
 * 职责：统一管理 Gemini API 的服务商端点和配置信息
 *
 * 支持的服务商：
 * - official: Google Gemini 官方 API
 * - relay: 第三方中转服务
 */

/**
 * Gemini API 服务商配置
 */
export const GEMINI_PROVIDERS = {
  official: {
    name: 'Gemini 官方',
    endpoint: 'https://generativelanguage.googleapis.com',
    apiKeyUrl: 'https://aistudio.google.com/app/api-keys',
    description: '直接连接 Google Gemini API',
    icon: '🌐',
  },
  relay: {
    name: '第三方中转',
    endpoint: 'https://aicode.cat/v1/messages',
    apiKeyUrl: 'https://aicode.cat/register?ref=T6S73C2U',
    description: '通过国内中转服务访问（更快更稳定）',
    icon: '⚡',
  },
} as const

/**
 * Gemini 服务商类型
 */
export type GeminiProvider = keyof typeof GEMINI_PROVIDERS

/**
 * 根据服务商获取端点 URL
 *
 * @param provider - 服务商类型
 * @param model - 模型名称（可选，relay 下会根据模型选择 messages / responses）
 * @returns 端点 URL
 *
 * @example
 * getGeminiEndpoint('official') // 'https://generativelanguage.googleapis.com'
 * getGeminiEndpoint('relay') // 'https://aicode.cat/v1/messages'
 * getGeminiEndpoint('relay', 'gpt-5.2') // 'https://aicode.cat/v1/responses'
 */
export function getGeminiEndpoint(provider: GeminiProvider, model?: string | null): string {
  const endpoint = GEMINI_PROVIDERS[provider]?.endpoint || GEMINI_PROVIDERS.official.endpoint

  // relay 下 GPT 模型走 /v1/responses，Gemini 模型走 /v1/messages
  if (provider === 'relay' && model && /^gpt-/i.test(model)) {
    return endpoint.replace(/\/messages\/?$/, '/responses')
  }

  return endpoint
}

/**
 * 根据服务商获取 API Key 获取地址
 *
 * @param provider - 服务商类型
 * @returns API Key 获取地址
 *
 * @example
 * getGeminiApiKeyUrl('official') // 'https://aistudio.google.com/app/api-keys'
 * getGeminiApiKeyUrl('relay') // 'https://aicode.cat/register?ref=T6S73C2U'
 */
export function getGeminiApiKeyUrl(provider: GeminiProvider): string | null {
  return GEMINI_PROVIDERS[provider]?.apiKeyUrl || null
}

/**
 * 验证服务商类型是否有效
 *
 * @param provider - 要验证的服务商类型
 * @returns 是否有效
 */
export function isValidProvider(provider: string): provider is GeminiProvider {
  return provider in GEMINI_PROVIDERS
}
