/**
 * 智能模型选择器（V2：支持用户模型选择）
 *
 * 核心原则：
 * 1. 用户在/settings选择的"Gemini模型"决定Pro和Flash任务使用的模型
 * 2. 根据operationType智能路由到Pro或Flash操作分类
 *
 * 用户选择逻辑：
 * - 官方服务商：Gemini 3 Flash Preview
 * - 第三方中转：Gemini 3 Flash Preview / GPT-5.2
 *
 * 注意：用户选择的模型影响整个任务链的模型选择策略
 * ⚠️ Provider差异：Vertex AI 可能不支持部分 preview 模型（如 gemini-3-flash-preview），
 * 实际调用会在统一入口做降级映射。
 */

import { getUserOnlySetting } from './settings'
import {
  GEMINI_ACTIVE_MODEL,
  type AIModel,
  normalizeModelForProvider,
} from './gemini-models'

// 支持的AI模型（官方/中转）
export type ModelType = AIModel

export interface ModelSelection {
  model: ModelType
  reason: string
  testingRequired: boolean // 是否需要A/B测试验证
}

/**
 * Flash适用场景（需A/B测试验证）：
 * - 结构化JSON输出
 * - 简单评分任务
 * - 格式化提取任务
 * - 重复性模式识别
 *
 * Pro保留场景：
 * - 关键词生成（复杂语义理解）
 * - 复杂分析（评论、竞品、LaunchScore）
 * - 创意生成主流程
 */
const FLASH_OPERATIONS = new Set<string>([
  // 🟢 广告元素提取（4个函数）- Flash
  // 输出固定JSON格式：15个标题或4个描述
  'ad_headline_extraction_single',
  'ad_headline_extraction_store',
  'ad_description_extraction_single',
  'ad_description_extraction_store',

  // 🟢 否定关键词生成 - Flash
  // 简单的排除词列表
  'negative_keyword_generation',

  // 🟢 Admin优化建议 - Flash
  // 格式化的优化建议
  'admin_prompt_optimization',

  // 🟢 品牌名提取 - Flash
  // 简单的实体提取任务
  'brand_extraction',

  // 🟢 广告强度评估 - Flash
  // 结构化评分输出
  'ad_strength_evaluation',

  // 🟢 连接测试 - Flash
  // 简单的ping测试
  'connection_test',

  // 🟢 关键词聚类 - Flash
  // 结构化JSON输出，固定格式的Bucket分类
  'keyword_clustering',

  // 🟢 竞争定位分析 - Flash
  // 使用responseSchema，固定JSON格式，4个评分字段 + 置信度
  'competitive_positioning_analysis',

  // 🟢 竞品关键词推断 - Flash
  // 温度0.3，简单关键词列表，模式识别任务
  'competitor_keyword_inference',

  'product_score_combined_analysis',

  // 🟢 补词相关性打分 - Flash
  // 结构化JSON输出，批量候选词评分与筛选
  'keyword_supplement_relevance_scoring',
])

const PRO_OPERATIONS = new Set<string>([
  // 🔴 关键词生成（2个）- Pro（复杂语义理解）
  'keyword_generation', // 必须保持maxOutputTokens
  'keyword_expansion',  // 必须保持maxOutputTokens

  // 🔴 复杂分析任务 - Pro
  'review_analysis',              // 深度情感和语义分析
  'competitor_analysis',          // 复杂的对比分析
  'competitor_summary',           // 🔴 竞品摘要 - 需要Pro模型准确理解和总结
  'launch_score_calculation',     // 多维度综合评估
  'ad_creative_generation_main',  // 核心创意生成
  'product_page_analysis',        // 产品页面深度分析
  'store_highlights_synthesis',   // 🔴 店铺产品亮点整合 - 需要创造性语义理解

  // 🔴 创意生成任务 - Pro
  'headline_generation',          // 标题创意生成（需要准确性和创造力）
  'description_generation',       // 描述创意生成（需要准确性和创造力）

  // 🔴 Admin分析 - Pro
  'admin_performance_analysis',   // 复杂数据分析和洞察
  'admin_feedback_analysis',      // 多轮对话和深度分析
])

/**
 * 获取用户选择的Pro模型
 *
 * @param userId - 用户ID
 * @returns 用户选择的模型
 */
export async function getUserProModel(userId?: number): Promise<ModelType> {
  if (!userId) {
    return GEMINI_ACTIVE_MODEL
  }

  try {
    const [modelSetting, providerSetting] = await Promise.all([
      getUserOnlySetting('ai', 'gemini_model', userId),
      getUserOnlySetting('ai', 'gemini_provider', userId),
    ])
    const provider = providerSetting?.value || 'official'
    return normalizeModelForProvider(modelSetting?.value, provider)
  } catch (error) {
    console.warn('⚠️ 获取用户Pro模型失败，使用默认:', error)
    return GEMINI_ACTIVE_MODEL
  }
}

/**
 * 选择最优模型（V3：根据用户选择和操作类型路由）
 *
 * @param operationType - 操作类型（来自recordTokenUsage）
 * @param userId - 用户ID（用于获取用户模型偏好）
 * @param options - 可选配置
 * @param options.forceProForTesting - 强制使用Pro（用于A/B测试）
 * @returns 模型选择结果
 */
export async function selectOptimalModel(
  operationType: string,
  userId?: number,
  options: {
    forceProForTesting?: boolean
    hasResponseSchema?: boolean
  } = {}
): Promise<ModelSelection> {
  const { forceProForTesting = false } = options
  const userProModel = await getUserProModel(userId)

  // A/B测试期间：强制使用用户的Pro模型作为对照组
  if (forceProForTesting) {
    return {
      model: userProModel,
      reason: 'A/B测试对照组',
      testingRequired: true,
    }
  }

  // Flash适用场景：简单任务使用Flash版本
  if (FLASH_OPERATIONS.has(operationType)) {
    return {
      model: userProModel,
      reason: `结构化输出任务，使用用户模型: ${userProModel}`,
      testingRequired: false,
    }
  }

  // Pro保留场景：复杂任务使用用户选择的Pro模型
  if (PRO_OPERATIONS.has(operationType)) {
    return {
      model: userProModel,
      reason: `复杂分析任务，使用用户选择的模型: ${userProModel}`,
      testingRequired: false,
    }
  }

  // 未知operationType：默认使用用户的Pro模型（安全第一）
  console.warn(`⚠️ Unknown operationType: ${operationType}, defaulting to user's model: ${userProModel}`)
  return {
    model: userProModel,
    reason: '未知操作类型，使用用户选择的模型确保质量',
    testingRequired: false,
  }
}

/**
 * 获取Flash适用的操作列表（用于文档和监控）
 */
export function getFlashOperations(): string[] {
  return Array.from(FLASH_OPERATIONS)
}

/**
 * 获取Pro保留的操作列表（用于文档和监控）
 */
export function getProOperations(): string[] {
  return Array.from(PRO_OPERATIONS)
}

/**
 * 检查操作类型是否可以使用Flash
 */
export function canUseFlash(operationType: string): boolean {
  return FLASH_OPERATIONS.has(operationType)
}

/**
 * A/B测试配置
 */
export interface ABTestConfig {
  enabled: boolean
  operationType: string
  flashPercentage: number // 0-100, Flash流量百分比
}

/**
 * 判断当前请求是否应使用Flash（灰度发布）
 *
 * @param operationType - 操作类型
 * @param userId - 用户ID（用于流量分割）
 * @param config - A/B测试配置
 * @returns 是否使用Flash
 */
export function shouldUseFlashForABTest(
  operationType: string,
  userId: number,
  config: ABTestConfig
): boolean {
  if (!config.enabled || config.operationType !== operationType) {
    return false
  }

  // 基于用户ID的稳定哈希分流
  const hash = userId % 100
  return hash < config.flashPercentage
}

/**
 * 获取模型成本倍数（相对于Flash）
 */
export function getModelCostMultiplier(model: ModelType): number {
  void model
  // 当前仅保留一个模型，按基准成本返回
  return 1.0
}
