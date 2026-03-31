/**
 * 🔥 创意生成器 AI 调用模块
 * 从 ad-creative-generator.ts 拆分出来
 *
 * 职责: 与 AI 模型交互、调用、解析、错误处理
 * 遵循 KISS 原则: 单一职责，清晰的错误处理
 */

import type { AIConfig, AIResponse, GenerateAdCreativeOptions } from './creative-types'
import { generateContent } from '../gemini'
import { resolveActiveAIConfig } from '../ai-runtime-config'
import { parseAIResponse as parseMainAdCreativeResponse } from '../ad-creative-generator'

/**
 * 获取 AI 配置
 * 仅使用用户级 AI 配置
 */
export async function getAIConfig(userId?: number): Promise<AIConfig> {
  if (!userId || userId <= 0) {
    return { type: null }
  }

  const resolved = await resolveActiveAIConfig(userId)

  if (resolved.type === 'gemini-api' && resolved.geminiAPI) {
    return {
      type: 'gemini-api',
      geminiAPI: {
        apiKey: resolved.geminiAPI.apiKey,
        model: resolved.geminiAPI.model,
      },
    }
  }

  return { type: null }
}

/**
 * 调用 AI 模型
 * 统一的 AI 调用接口
 */
export async function callAI(prompt: string, config: AIConfig, userId?: number): Promise<AIResponse> {
  try {
    console.log('[callAI] 开始调用 AI 模型')

    if (!userId || userId <= 0) {
      throw new Error('缺少有效 userId，无法执行用户级 AI 调用')
    }

    // 使用统一入口，模型由用户当前配置决定
    const model = config.geminiAPI?.model || 'unknown'
    const response = await generateContent({
      operationType: 'ad_creative_generation_main',
      prompt,
      temperature: 0.7,  // 🔧 从0.9降到0.7：减少输出不稳定性
      maxOutputTokens: 32768  // 保持较高值以防截断
    }, userId)

    // TODO: 追踪 token 使用（需要根据实际 API 调整）
    // if (response.usageMetadata) {
    //   await recordTokenUsage({
    //     model,
    //     promptTokens: response.usageMetadata.promptTokenCount,
    //     completionTokens: response.usageMetadata.candidatesTokenCount,
    //     totalTokens: response.usageMetadata.totalTokenCount,
    //     estimatedCost: estimateTokenCost(model, response.usageMetadata.totalTokenCount)
    //   })
    // }

    console.log('[callAI] AI 调用成功')

    return {
      success: true,
      data: response,
      model
    }
  } catch (error: any) {
    console.error('[callAI] AI 调用失败:', error)

    return {
      success: false,
      error: error.message || '未知错误'
    }
  }
}

/**
 * 解析 AI 响应
 * 将 AI 返回的数据转换为创意格式
 */
export async function parseAIResponse(
  response: any,
  options: GenerateAdCreativeOptions
): Promise<any> {
  try {
    console.log('[parseAIResponse] 开始解析 AI 响应')
    const rawText = typeof response?.text === 'string'
      ? response.text
      : Array.isArray(response?.candidates)
        ? response.candidates
          .flatMap((candidate: any) => candidate?.content?.parts || [])
          .map((part: any) => String(part?.text || ''))
          .join('\n')
        : ''

    if (!rawText.trim()) {
      throw new Error('AI 响应中缺少可解析文本')
    }

    const result = parseMainAdCreativeResponse(rawText, {
      policyGuardMode: (options as any)?.policyGuardMode,
    })

    console.log('[parseAIResponse] 解析成功')

    return result
  } catch (error: any) {
    console.error('[parseAIResponse] 解析失败:', error)
    throw new Error(`AI 响应解析失败: ${error.message}`)
  }
}

/**
 * AI 错误处理
 * 根据错误类型决定是否重试
 */
function handleAIError(error: any): { retryable: boolean; message: string } {
  // TODO: 根据具体错误类型判断是否可重试
  return {
    retryable: false,
    message: error.message || '未知错误'
  }
}

/**
 * 重试逻辑
 * 可重试的错误自动重试
 */
export async function callAIWithRetry(
  prompt: string,
  config: AIConfig,
  maxRetries: number = 3,
  userId?: number
): Promise<AIResponse> {
  let lastError: any

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await callAI(prompt, config, userId)

      if (response.success) {
        return response
      }

      lastError = response.error

      // 检查是否可重试
      const { retryable } = handleAIError(lastError)
      if (!retryable) {
        break
      }

      console.log(`[callAIWithRetry] 第 ${attempt} 次尝试失败，2秒后重试...`)
      await new Promise(resolve => setTimeout(resolve, 2000))
    } catch (error: any) {
      lastError = error
      console.error(`[callAIWithRetry] 第 ${attempt} 次尝试异常:`, error)
    }
  }

  return {
    success: false,
    error: lastError?.message || '所有重试均失败'
  }
}
