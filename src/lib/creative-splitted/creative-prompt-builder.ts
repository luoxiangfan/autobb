/**
 * 🔥 创意生成器提示构建模块
 * 从 ad-creative-generator.ts 拆分出来
 *
 * 职责: 构建 AI 提示、格式化关键词、变量注入
 * 遵循 KISS 原则: 清晰的结构，易于维护
 */

import type { PromptVariables, GenerateAdCreativeOptions } from './creative-types'
import { loadPrompt } from '../prompt-loader'

/**
 * 加载提示模板
 * 从数据库或文件加载提示模板
 */
async function loadPromptTemplate(): Promise<string> {
  try {
    // 尝试从数据库加载
    const template = await loadPrompt('ad_creative_generation')
    return template
  } catch (error) {
    console.warn('[loadPromptTemplate] 从数据库加载失败，使用默认模板')

    // 返回默认模板
    return `
你是一个专业的广告创意生成专家。请根据以下信息生成吸引人的广告创意。

产品信息：
- 产品名称：{offer_title}
- 产品类别：{offer_category}
- 产品特性：{product_features}
- 目标受众：{target_audience}
- 品牌名称：{brand_name}

关键词信息：
{extracted_keywords_section}
{ai_keywords_section}

请生成：
1. 5个吸引人的标题（每个不超过30个字符）
2. 2个详细的描述（每个90-100个字符）

要求：
- 突出产品优势和卖点
- 包含相关关键词
- 语言生动有吸引力
- 符合广告政策
    `.trim()
  }
}

/**
 * 注入变量到模板
 * 将变量值替换到模板中
 */
function injectVariables(template: string, variables: PromptVariables): string {
  let result = template

  // 替换所有变量
  Object.entries(variables).forEach(([key, value]) => {
    const placeholder = `{${key}}`
    result = result.replace(new RegExp(placeholder, 'g'), value || '')
  })

  return result
}

/**
 * 格式化关键词为文本
 * 将关键词数组转换为提示文本
 */
function formatKeywordsSection(title: string, keywords: string[]): string {
  if (!keywords || keywords.length === 0) {
    return ''
  }

  return `\n**${title}**:\n${keywords.slice(0, 20).join(', ')}\n`
}

/**
 * 🎯 构建完整提示
 * 整合所有数据源生成 AI 提示
 */
export async function buildPrompt(
  variables: PromptVariables,
  options: GenerateAdCreativeOptions
): Promise<string> {
  console.log('[buildPrompt] 开始构建提示')

  // 1. 加载模板
  const template = await loadPromptTemplate()
  console.log('[buildPrompt] 模板加载完成')

  // 2. 注入变量
  let prompt = injectVariables(template, variables)
  console.log('[buildPrompt] 变量注入完成')

  // 🎯 Intent-driven optimization: 注入场景数据sections
  if (variables.user_scenarios_section) {
    prompt += '\n' + variables.user_scenarios_section
  }
  if (variables.user_questions_section) {
    prompt += '\n' + variables.user_questions_section
  }
  if (variables.pain_points_section) {
    prompt += '\n' + variables.pain_points_section
  }
  if (variables.quantitative_highlights_section) {
    prompt += '\n' + variables.quantitative_highlights_section
  }
  if (variables.intent_strategy_section) {
    prompt += '\n' + variables.intent_strategy_section
    console.log('[buildPrompt] 🎯 Intent-driven策略已注入')
  }

  // 3. 添加多样性约束（批量生成时）
  if (options.excludeHeadlines && options.excludeHeadlines.length > 0) {
    const diversitySection = `

## 🔥 多样性约束 (CRITICAL)

**⚠️ 已生成的Headlines（必须避免重复）**:
${options.excludeHeadlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}

**强制要求**:
1. 新生成的15个headlines必须与上述已有headlines完全不同
2. 不得使用相同的核心词组或表达方式
3. 必须从不同角度切入（如：价格优惠 vs 功能特性 vs 用户评价）
4. 相似度必须<30%（避免仅改动1-2个词）
`
    prompt += diversitySection
    console.log(`[buildPrompt] 添加多样性约束: ${options.excludeHeadlines.length}个已有headlines`)
  }

  // 4. 添加差异化主题指导
  if (options.diversityTheme) {
    const themeSection = `

**🎯 本轮创意主题**: ${options.diversityTheme}
请确保所有headlines围绕此主题展开，与其他主题的创意形成差异。
`
    prompt += themeSection
    console.log(`[buildPrompt] 添加差异化主题: ${options.diversityTheme}`)
  }

  // 5. 添加主题特定指导（如果有）
  if (options.theme) {
    const themeSection = `

**主题指导**: ${options.theme}
请确保创意符合此主题。`
    console.log(`[buildPrompt] 添加主题指导: ${options.theme}`)
    prompt += themeSection
  }

  console.log('[buildPrompt] 提示构建完成')
  return prompt
}

/**
 * 🎯 构建批量生成提示
 * 为批量生成创建优化的提示
 */
export async function buildBatchPrompt(
  variables: PromptVariables,
  count: number,
  options: GenerateAdCreativeOptions
): Promise<string> {
  const basePrompt = await buildPrompt(variables, options)

  const batchSection = `\n\n**批量生成要求**:
- 请生成 ${count} 个不同的创意变化
- 每个创意应该有独特的角度和卖点
- 避免使用相同的词汇和表达
- 保持整体风格一致但内容多样化

请为每个创意编号（1-${count}）并分别生成标题和描述。`

  return basePrompt + batchSection
}

/**
 * 🎯 构建综合创意提示
 * 为内部 coverage 模式生成提示
 */
export async function buildSyntheticPrompt(
  variables: PromptVariables,
  options: GenerateAdCreativeOptions
): Promise<string> {
  const basePrompt = await buildPrompt(variables, options)

  const syntheticSection = `\n\n**综合创意要求**:
- 这不是第4种创意类型，而是内部 coverage 生成模式
- 请按商品需求覆盖导向组织文案，对齐 product_intent
- 结合品牌、商品、功能、场景、产品线等已验证信息
- 不要再拆成“品牌/场景/功能”三种创意，也不要发明额外类型
- 关键词应该自然融入文案中，并始终回到真实商品需求

请生成一个综合性但完整的广告创意。`

  return basePrompt + syntheticSection
}
