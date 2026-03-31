/**
 * AI Token使用统计工具
 * 用于记录AI模型调用的token使用情况到数据库
 */

import { getDatabase } from './db'

const USD_TO_CNY_EXCHANGE_RATE = 7.2

interface ModelPricing {
  inputUsdPerMillion: number
  outputUsdPerMillion: number
}

/**
 * Token使用记录参数
 */
export interface RecordTokenUsageParams {
  userId: number
  model: string
  operationType: string // 例如: 'product_analysis', 'ad_creative_generation', 'brand_extraction'
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  apiType: 'direct-api'
}

/**
 * 记录AI token使用到数据库
 *
 * @param params - Token使用参数
 * @returns Promise<void>
 */
export async function recordTokenUsage(params: RecordTokenUsageParams): Promise<void> {
  const {
    userId,
    model,
    operationType,
    inputTokens,
    outputTokens,
    totalTokens,
    cost,
    apiType
  } = params

  try {
    const db = await getDatabase()
    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD格式

    await db.exec(
      `INSERT INTO ai_token_usage (
        user_id,
        model,
        operation_type,
        input_tokens,
        output_tokens,
        total_tokens,
        cost,
        api_type,
        date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, model, operationType, inputTokens, outputTokens, totalTokens, cost, apiType, today]
    )

    console.log(`✓ Token使用已记录: user=${userId}, model=${model}, tokens=${totalTokens}, cost=¥${cost.toFixed(4)}`)
  } catch (error) {
    console.error('记录token使用失败:', error)
    // 不抛出错误，避免影响主业务流程
  }
}

/**
 * 估算token成本（基于Google AI定价）
 *
 * 模型定价（USD per 1M tokens）：
 * - gpt-5.2*: Input $1.75, Output $14.00
 * - gemini-3-flash-preview: Input $0.50, Output $3.00
 * - 其他 flash/pro 模型：沿用历史默认单价
 *
 * @param model - 模型名称
 * @param inputTokens - 输入token数
 * @param outputTokens - 输出token数
 * @returns 估算成本（人民币）
 */
export function estimateTokenCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const normalizedModel = String(model || '').toLowerCase()

  // NOTE: prices are USD per 1M tokens.
  let pricing: ModelPricing
  if (normalizedModel.startsWith('gpt-5.2')) {
    pricing = { inputUsdPerMillion: 1.75, outputUsdPerMillion: 14.0 }
  } else if (normalizedModel.includes('gemini-3-flash-preview')) {
    pricing = { inputUsdPerMillion: 0.5, outputUsdPerMillion: 3.0 }
  } else if (normalizedModel.includes('flash')) {
    pricing = { inputUsdPerMillion: 0.075, outputUsdPerMillion: 0.3 }
  } else {
    pricing = { inputUsdPerMillion: 1.25, outputUsdPerMillion: 5.0 }
  }

  const safeInputTokens = Number(inputTokens) || 0
  const safeOutputTokens = Number(outputTokens) || 0
  const inputCostUsd = (safeInputTokens / 1_000_000) * pricing.inputUsdPerMillion
  const outputCostUsd = (safeOutputTokens / 1_000_000) * pricing.outputUsdPerMillion
  const totalCostUsd = inputCostUsd + outputCostUsd

  return totalCostUsd * USD_TO_CNY_EXCHANGE_RATE
}
