import { getGeminiEndpoint, type GeminiProvider } from './gemini-config'
import { GEMINI_ACTIVE_MODEL, type AIModel, normalizeModelForProvider } from './gemini-models'
import { getUserOnlySetting } from './settings'

export interface ResolvedAIConfig {
  type: 'gemini-api' | null
  provider: GeminiProvider
  model: AIModel
  endpoint: string
  geminiAPI?: {
    apiKey: string
    model: AIModel
    provider: 'official' | 'relay'
    endpoint: string
  }
}

function normalizeProvider(value?: string | null): GeminiProvider {
  if (value === 'official' || value === 'relay') {
    return value
  }

  return 'official'
}

/**
 * 统一解析用户当前生效的 AI 配置。
 *
 * 规则：
 * 1. 仅使用用户级配置（不回退全局）
 * 2. 严格按 provider 取 key，不跨 provider 混用 key
 * 3. 只返回“最后保存并可生效”的单一模型
 */
export async function resolveActiveAIConfig(userId: number): Promise<ResolvedAIConfig> {
  const fallbackModel = GEMINI_ACTIVE_MODEL
  const fallbackProvider: GeminiProvider = 'official'
  const fallbackEndpoint = getGeminiEndpoint(fallbackProvider, fallbackModel)

  if (!userId || userId <= 0) {
    return {
      type: null,
      provider: fallbackProvider,
      model: fallbackModel,
      endpoint: fallbackEndpoint,
    }
  }

  const [providerSetting, modelSetting, officialApiKeySetting, relayApiKeySetting] = await Promise.all([
    getUserOnlySetting('ai', 'gemini_provider', userId),
    getUserOnlySetting('ai', 'gemini_model', userId),
    getUserOnlySetting('ai', 'gemini_api_key', userId),
    getUserOnlySetting('ai', 'gemini_relay_api_key', userId),
  ])

  const rawProvider = normalizeProvider(providerSetting?.value)
  const directProvider: 'official' | 'relay' = rawProvider === 'relay' ? 'relay' : 'official'
  const directModel = normalizeModelForProvider(modelSetting?.value || fallbackModel, directProvider)

  const directApiKey = directProvider === 'relay'
    ? relayApiKeySetting?.value || ''
    : officialApiKeySetting?.value || ''
  const directEndpoint = getGeminiEndpoint(directProvider, directModel)

  if (directApiKey) {
    return {
      type: 'gemini-api',
      provider: directProvider,
      model: directModel,
      endpoint: directEndpoint,
      geminiAPI: {
        apiKey: directApiKey,
        model: directModel,
        provider: directProvider,
        endpoint: directEndpoint,
      },
    }
  }

  return {
    type: null,
    provider: directProvider,
    model: directModel,
    endpoint: directEndpoint,
  }
}
