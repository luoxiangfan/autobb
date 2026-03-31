/**
 * 统一的 Gemini AI 调用入口（仅 Gemini API）
 *
 * 重要：
 * - 只使用用户级配置，不回退全局
 * - AI API 调用不使用代理（代理仅用于网页爬取）
 */

import { getUserOnlySetting } from './settings'
import { getUserProModel, selectOptimalModel } from './model-selector'
import { type GeminiProvider } from './gemini-config'
import {
  GEMINI_ACTIVE_MODEL,
  normalizeGeminiModel,
  normalizeModelForProvider,
} from './gemini-models'

function normalizeProvider(value?: string | null): GeminiProvider {
  if (value === 'relay' || value === 'official') {
    return value
  }

  return 'official'
}

/**
 * JSON Schema类型定义（符合OpenAPI 3.0规范）
 */
export interface ResponseSchema {
  type?: 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ARRAY' | 'OBJECT'
  format?: string
  description?: string
  nullable?: boolean
  minItems?: number
  maxItems?: number
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  items?: ResponseSchema
  enum?: string[]
  properties?: {
    [key: string]: ResponseSchema
  }
  required?: string[]
  example?: unknown
}

/**
 * Gemini生成内容的参数接口
 */
export interface GeminiGenerateParams {
  model?: string
  prompt: string
  temperature?: number
  maxOutputTokens?: number
  thinkingBudget?: number
  timeoutMs?: number
  operationType?: string
  enableAutoModelSelection?: boolean
  responseSchema?: ResponseSchema
  responseMimeType?: string
  requireSchemaSupport?: boolean
}

/**
 * Gemini生成内容的返回结果接口
 */
export interface GeminiGenerateResult {
  text: string
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  model: string
  apiType: 'direct-api'
}

const AD_CREATIVE_EMERGENCY_RETRY_MAX_OUTPUT_TOKENS = 8192
const AD_CREATIVE_EMERGENCY_RETRY_MIN_OUTPUT_TOKENS = 4096
const AD_CREATIVE_EMERGENCY_RETRY_TEMPERATURE = 0.2

function buildAdCreativeEmergencyRetryPrompt(prompt: string): string {
  return `${prompt.trimEnd()}

## EMERGENCY OUTPUT CONTRACT (CRITICAL)
The previous attempt hit MAX_TOKENS or produced runaway output.
Return ONLY one valid JSON object with the required RSA fields and stop immediately after the final closing brace.
Do NOT append explanations, ids, timestamps, repeated numeric chains, or any trailing text.`
}

/**
 * 检查用户是否配置了 Gemini API（只检查用户级配置）
 */
async function isGeminiAPIConfigured(userId: number): Promise<boolean> {
  try {
    const providerSetting = await getUserOnlySetting('ai', 'gemini_provider', userId)
    const provider = normalizeProvider(providerSetting?.value)

    if (provider === 'relay') {
      const relayApiKey = await getUserOnlySetting('ai', 'gemini_relay_api_key', userId)
      return !!relayApiKey?.value
    }

    const apiKey = await getUserOnlySetting('ai', 'gemini_api_key', userId)
    return !!apiKey?.value
  } catch (error) {
    console.error('🔍 Gemini API配置检查失败:', error)
    return false
  }
}

/**
 * ✅ Token使用率监控：防止输出截断
 */
function checkTokenUtilization(
  outputTokens: number,
  maxOutputTokens: number,
  operationType?: string
): void {
  if (!outputTokens || !maxOutputTokens) return

  const utilization = outputTokens / maxOutputTokens
  const percentage = (utilization * 100).toFixed(1)

  if (utilization >= 1.0) {
    console.error(
      `🚨 Token截断错误: ${operationType || 'unknown'} ` +
      `输出${outputTokens}/${maxOutputTokens} tokens (${percentage}%) - 内容被截断！\n` +
      `⚠️ 必须增加maxOutputTokens配置以避免输出不完整`
    )
  } else if (utilization >= 0.8) {
    console.warn(
      `⚠️ Token高使用率警告: ${operationType || 'unknown'} ` +
      `输出${outputTokens}/${maxOutputTokens} tokens (${percentage}%) - 接近限制\n` +
      `💡 建议: 考虑适当增加maxOutputTokens配置`
    )
  } else {
    console.log(
      `✅ Token使用正常: ${operationType || 'unknown'} ` +
      `输出${outputTokens}/${maxOutputTokens} tokens (${percentage}%)`
    )
  }
}

/**
 * 统一的 Gemini 内容生成接口（仅用户级配置）
 */
export async function generateContent(
  params: GeminiGenerateParams,
  userId: number
): Promise<GeminiGenerateResult> {
  if (!userId || typeof userId !== 'number' || userId <= 0) {
    throw new Error('AI调用失败：缺少有效的用户ID。每个AI操作必须关联到具体用户。')
  }

  const {
    model: requestedModel,
    prompt,
    temperature = 0.7,
    maxOutputTokens = 8192,
    thinkingBudget,
    timeoutMs,
    operationType,
    enableAutoModelSelection = true,
    responseSchema,
    responseMimeType,
    requireSchemaSupport = false,
  } = params

  let finalModel: string
  if (enableAutoModelSelection && operationType) {
    const selection = await selectOptimalModel(operationType, userId, {
      hasResponseSchema: !!responseSchema,
    })
    finalModel = selection.model
    console.log(`🤖 智能模型选择 (User ${userId}): ${operationType} → ${finalModel} (${selection.reason})`)
  } else if (requestedModel) {
    finalModel = normalizeGeminiModel(requestedModel)
    console.log(`📝 使用显式指定模型: ${finalModel}`)
  } else {
    finalModel = await getUserProModel(userId)
    console.log(`⚠️ 未指定operationType，默认使用用户已保存模型: ${finalModel}`)
  }

  const normalizedThinkingBudget = Number.isFinite(Number(thinkingBudget))
    ? Math.max(0, Math.floor(Number(thinkingBudget)))
    : undefined
  const shouldDisableThinkingForStructuredOutput = !!responseSchema && finalModel.includes('gemini-3')
  const effectiveThinkingBudget = normalizedThinkingBudget
    ?? (shouldDisableThinkingForStructuredOutput ? 0 : undefined)
  if (effectiveThinkingBudget === 0 && normalizedThinkingBudget === undefined && shouldDisableThinkingForStructuredOutput) {
    console.log(`🧠 结构化任务自动关闭 thinking 模式 (模型: ${finalModel})`)
  }

  const hasGeminiAPI = await isGeminiAPIConfigured(userId)
  if (!hasGeminiAPI) {
    throw new Error(
      `AI配置缺失：用户(ID=${userId})尚未配置 Gemini API。\n` +
      `请在设置页面配置服务商与 API 密钥。\n` +
      `注意：系统不支持全局AI配置，每个用户必须配置自己的AI凭证。`
    )
  }

  console.log(`🌐 使用用户(ID=${userId})的 Gemini API 配置`)
  return await callDirectAPI(
    {
      model: finalModel,
      prompt,
      temperature,
      maxOutputTokens,
      thinkingBudget: effectiveThinkingBudget,
      timeoutMs,
      operationType,
      responseSchema,
      responseMimeType,
      requireSchemaSupport,
    },
    userId
  )
}

/**
 * 调用 Gemini API（只使用用户级配置）
 */
async function callDirectAPI(
  params: GeminiGenerateParams,
  userId: number
): Promise<GeminiGenerateResult> {
  const {
    model,
    prompt,
    temperature,
    maxOutputTokens,
    thinkingBudget,
    timeoutMs,
    operationType,
    responseSchema,
    responseMimeType,
    requireSchemaSupport = false,
  } = params

  const providerSetting = await getUserOnlySetting('ai', 'gemini_provider', userId)
  const preferredProvider = normalizeProvider(providerSetting?.value)
  let provider = preferredProvider
  let forcedProviderConfig: { provider: GeminiProvider; apiKey: string } | undefined

  if (requireSchemaSupport && responseSchema && preferredProvider === 'relay') {
    const officialApiKeySetting = await getUserOnlySetting('ai', 'gemini_api_key', userId)
    if (officialApiKeySetting?.value) {
      provider = 'official'
      forcedProviderConfig = {
        provider: 'official',
        apiKey: officialApiKeySetting.value,
      }
      console.log(`🌐 结构化输出任务强制使用 Gemini 官方链路以确保 responseSchema 生效`)
    } else {
      console.warn(
        `⚠️ 结构化输出任务需要 schema 约束，但用户未配置官方 Gemini key，继续使用 relay（schema 可能不生效）`
      )
    }
  }

  let apiKey: string

  if (provider === 'relay') {
    const relayApiKey = await getUserOnlySetting('ai', 'gemini_relay_api_key', userId)
    if (!relayApiKey?.value) {
      throw new Error(
        `用户(ID=${userId})未配置第三方中转 API 密钥。请在设置页面配置您自己的 relay API 密钥。`
      )
    }
    apiKey = relayApiKey.value
    console.log(`🌐 使用用户(ID=${userId})的第三方中转 API`)
  } else {
    if (forcedProviderConfig?.apiKey) {
      apiKey = forcedProviderConfig.apiKey
    } else {
      const apiKeySetting = await getUserOnlySetting('ai', 'gemini_api_key', userId)
      if (!apiKeySetting?.value) {
        throw new Error(
          `用户(ID=${userId})未配置 Gemini 官方 API 密钥。请在设置页面配置您自己的 Gemini API 密钥。`
        )
      }
      apiKey = apiKeySetting.value
    }
    console.log(`🌐 使用用户(ID=${userId})的 Gemini 官方 API`)
  }

  const { generateContent: axiosGenerate } = await import('./gemini-axios')

  let effectiveModel = normalizeModelForProvider(model, provider)
  if (model && effectiveModel !== model) {
    console.warn(`⚠️ 服务商 ${provider} 不支持模型 ${model}，自动切换为 ${effectiveModel}`)
  }

  // relay 模式强制锁定用户保存模型，避免链路混用
  if (provider === 'relay') {
    const savedModelSetting = await getUserOnlySetting('ai', 'gemini_model', userId)
    const lockedRelayModel = normalizeModelForProvider(savedModelSetting?.value, provider)
    if (effectiveModel !== lockedRelayModel) {
      console.warn(`⚠️ relay 模型锁定生效：忽略临时模型 ${effectiveModel}，使用用户最后保存模型 ${lockedRelayModel}`)
      effectiveModel = lockedRelayModel
    }
  }

  const baseParams = {
    model: effectiveModel,
    prompt,
    temperature,
    maxOutputTokens,
    thinkingBudget,
    timeoutMs,
    responseSchema,
    responseMimeType,
  }

  let result
  try {
    result = await axiosGenerate(baseParams, userId, forcedProviderConfig)
  } catch (error: any) {
    const message = String(error?.message || '')
    const isMaxTokens = error?.code === 'MAX_TOKENS' || message.includes('MAX_TOKENS') || message.includes('token限制')
    const isRunawayCandidate = Boolean(error?.isRunawayCandidate)
    const suggestedRetryMaxOutputTokens = Number(error?.retryMaxOutputTokens || 0)
    const shouldFallbackModel = isMaxTokens &&
      !isRunawayCandidate &&
      effectiveModel === GEMINI_ACTIVE_MODEL &&
      operationType === 'ad_creative_generation_main'

    const shouldEmergencyRetry = (candidateError: any): boolean => {
      const candidateMessage = String(candidateError?.message || '')
      const candidateIsMaxTokens =
        candidateError?.code === 'MAX_TOKENS' ||
        candidateMessage.includes('MAX_TOKENS') ||
        candidateMessage.includes('token限制')
      return candidateIsMaxTokens &&
        provider === 'relay' &&
        operationType === 'ad_creative_generation_main' &&
        !!responseSchema
    }

    let retryError: any = error
    if (shouldFallbackModel) {
      const bumpedMaxOutputTokens = suggestedRetryMaxOutputTokens > (maxOutputTokens || 0)
        ? suggestedRetryMaxOutputTokens
        : maxOutputTokens
      console.warn(
        `⚠️ ad_creative_generation_main MAX_TOKENS in ${GEMINI_ACTIVE_MODEL}, ` +
        `retry same model with upstream bump (${maxOutputTokens || 0} → ${bumpedMaxOutputTokens || 0})`
      )
      try {
        result = await axiosGenerate({
          ...baseParams,
          model: GEMINI_ACTIVE_MODEL,
          maxOutputTokens: bumpedMaxOutputTokens,
        }, userId, forcedProviderConfig)
        retryError = null
      } catch (fallbackError: any) {
        retryError = fallbackError
      }
    }

    if (!result && shouldEmergencyRetry(retryError)) {
      const emergencyMaxOutputTokens = Math.max(
        AD_CREATIVE_EMERGENCY_RETRY_MIN_OUTPUT_TOKENS,
        Math.min(
          AD_CREATIVE_EMERGENCY_RETRY_MAX_OUTPUT_TOKENS,
          Number(maxOutputTokens || AD_CREATIVE_EMERGENCY_RETRY_MAX_OUTPUT_TOKENS)
        )
      )
      const emergencyPrompt = buildAdCreativeEmergencyRetryPrompt(prompt)

      console.warn(
        `⚠️ ad_creative_generation_main relay MAX_TOKENS，启用紧急收敛重试 ` +
        `(maxOutputTokens=${emergencyMaxOutputTokens}, temperature<=${AD_CREATIVE_EMERGENCY_RETRY_TEMPERATURE})`
      )

      result = await axiosGenerate({
        ...baseParams,
        prompt: emergencyPrompt,
        maxOutputTokens: emergencyMaxOutputTokens,
        temperature: Math.min(temperature || 0.7, AD_CREATIVE_EMERGENCY_RETRY_TEMPERATURE),
      }, userId, forcedProviderConfig)
    }

    if (!result) {
      throw retryError
    }
  }

  if (result.usage?.outputTokens) {
    checkTokenUtilization(result.usage.outputTokens, maxOutputTokens || 8192, operationType)
  }

  return {
    text: result.text,
    usage: result.usage,
    model: result.model || effectiveModel,
    apiType: 'direct-api',
  }
}

/**
 * 检查用户的 Gemini 连接状态
 */
export async function checkGeminiConnection(userId: number): Promise<boolean> {
  try {
    await generateContent(
      {
        prompt: 'Hello',
        maxOutputTokens: 10,
      },
      userId
    )
    return true
  } catch (error) {
    console.error(`用户(ID=${userId})的Gemini连接检查失败:`, error)
    return false
  }
}

/**
 * 获取用户当前 Gemini 模式
 */
export async function getGeminiMode(userId: number): Promise<'direct-api' | 'none'> {
  if (await isGeminiAPIConfigured(userId)) {
    return 'direct-api'
  }
  return 'none'
}
