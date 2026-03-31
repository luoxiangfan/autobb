import { generateContent } from './gemini'
import { recordTokenUsage, estimateTokenCost } from './ai-token-tracker'
import { loadPrompt } from './prompt-loader'
import type { ScoreAnalysis } from './launch-scores'
import type { Offer } from './offers'
import type { AdCreative, HeadlineAsset, DescriptionAsset } from './ad-creative'
import {
  evaluateAdStrength,
  type AdStrengthEvaluation,
  type AdStrengthRating
} from './ad-strength-evaluator'
import type { CanonicalCreativeType } from './creative-type'
import {
  getAdStrength,
  validateExcellentStandard,
  type GoogleAdStrengthResponse
} from './google-ads-strength-api'

/**
 * Launch Score 4维度评分系统 v4.0
 *
 * 维度权重：
 * - 投放可行性：35分（品牌词搜索量15 + 利润空间10 + 竞争度10）
 * - 广告质量：30分（Ad Strength 15 + 标题多样性8 + 描述质量7）
 * - 关键词策略：20分（相关性8 + 匹配类型6 + 否定关键词6）
 * - 基础配置：15分（国家/语言5 + Final URL 5 + 预算5）
 */
export async function calculateLaunchScore(
  offer: Offer,
  creative: AdCreative,
  userId: number,
  campaignConfig?: {
    budgetAmount?: number
    maxCpcBid?: number
    budgetType?: string
    finalUrl?: string  // 🔧 新增：用户配置的Final URL
    targetCountry?: string  // 🔧 新增：目标国家
    targetLanguage?: string  // 🔧 新增：目标语言
  }
): Promise<{
  totalScore: number
  analysis: {
    launchViability: ScoreAnalysis['launchViability']
    adQuality: ScoreAnalysis['adQuality']
    keywordStrategy: ScoreAnalysis['keywordStrategy']
    basicConfig: ScoreAnalysis['basicConfig']
  }
  recommendations: string[]
  scoreAnalysis: ScoreAnalysis
}> {
  try {
    // 🎯 获取创意中的关键词数据
    const creativeKeywords = creative.keywords || []
    const negativeKeywords = (creative as any).negativeKeywords || []
    const keywordsWithVolume = (creative as any).keywordsWithVolume || []

    // 🔥 新增：调试日志 - 追踪否定关键词
    console.log(`[LaunchScore] 创意ID: ${(creative as any).id || 'N/A'}`)
    console.log(`[LaunchScore] 否定关键词数量: ${negativeKeywords.length}`)
    console.log(`[LaunchScore] 否定关键词示例: ${negativeKeywords.slice(0, 5).join(', ')}`)
    console.log(`[LaunchScore] creative.negativeKeywords存在: ${!!(creative as any).negativeKeywords}`)
    console.log(`[LaunchScore] creative完整字段: ${Object.keys(creative).join(', ')}`)

    // 📦 加载新版prompt模板 (v4.0)
    const promptTemplate = await loadPrompt('launch_score')

    // 🎯 计算品牌词搜索量（从keywordsWithVolume中提取品牌相关词）
    const brandKeywords = keywordsWithVolume.filter((kw: any) =>
      kw.keyword?.toLowerCase().includes(offer.brand?.toLowerCase() || '')
    )
    const brandSearchVolume = brandKeywords.length > 0
      ? Math.max(...brandKeywords.map((kw: any) => kw.searchVolume || 0))
      : 0
    const brandCompetition = brandKeywords.length > 0
      ? brandKeywords[0]?.competition || 'MEDIUM'
      : 'MEDIUM'

    // 🎯 计算投放可行性评估（基于用户配置，不依赖Offer可选字段）
    // 评估预算是否合理（CPC vs 预算比例）
    const budgetAmount = campaignConfig?.budgetAmount || 10
    const maxCpcBid = campaignConfig?.maxCpcBid || 0.17
    const dailyBudget = budgetAmount

    // 预算合理性评估：日预算应该支持足够的点击数
    const estimatedClicksPerDay = dailyBudget / maxCpcBid
    const isBudgetReasonable = estimatedClicksPerDay >= 10 // 每天至少10个点击

    // CPC合理性评估：CPC不应该超过日预算的10%
    const cpcToBudgetRatio = maxCpcBid / dailyBudget
    const isCpcReasonable = cpcToBudgetRatio <= 0.1 // CPC不超过日预算的10%

    // 🎯 计算标题多样性
    const headlines = creative.headlines || []
    const uniqueHeadlines = new Set(headlines.map((h: string) => h.toLowerCase().trim()))
    const headlineDiversity = headlines.length > 0
      ? Math.round((uniqueHeadlines.size / headlines.length) * 100)
      : 0

    // 🎯 获取Ad Strength（优先使用已有的，否则评估）
    let adStrength: AdStrengthRating = 'AVERAGE'
    if ((creative as any).ad_strength) {
      adStrength = (creative as any).ad_strength as AdStrengthRating
    } else if (headlines.length >= 3 && creative.descriptions.length >= 2) {
      // 快速评估Ad Strength（传递品牌信息）
      const headlineAssets: HeadlineAsset[] = headlines.map((h: string) => ({ text: h, length: h.length }))
      const descAssets: DescriptionAsset[] = creative.descriptions.map((d: string) => ({ text: d, length: d.length }))
      adStrength = await getQuickAdStrength(headlineAssets, descAssets, creativeKeywords, {
        brandName: offer.brand || undefined,
        targetCountry: offer.target_country || undefined,
        targetLanguage: offer.target_language || undefined,
        userId
      })
    }

    // 🎯 准备关键词搜索量文本（包含matchType信息）
    const keywordsWithVolumeText = keywordsWithVolume.length > 0
      ? keywordsWithVolume.slice(0, 15).map((kw: any) => {
          const matchType = kw.matchType || 'PHRASE'
          return `- ${kw.keyword} (${matchType}): ${kw.searchVolume || 0}/月, 竞争度:${kw.competition || '未知'}`
        }).join('\n')
      : '暂无关键词搜索量数据'

    // 🔥 新增(2025-12-18)：检查keywordsWithVolume中是否有competition数据
    const keywordsWithCompetition = keywordsWithVolume.filter((kw: any) => kw.competition)
    console.log(`[LaunchScore] 关键词competition数据检查:`)
    console.log(`   - 总关键词数: ${keywordsWithVolume.length}`)
    console.log(`   - 有competition数据的关键词: ${keywordsWithCompetition.length}`)
    if (keywordsWithVolume.length > 0) {
      console.log(`   - 第一个关键词的competition: ${keywordsWithVolume[0].competition || '(缺失)'}`)
      console.log(`   - 第一个关键词的完整字段: ${JSON.stringify(keywordsWithVolume[0])}`)
    }

    // 🎯 计算匹配类型分布
    const matchTypes: Record<string, number> = {}
    keywordsWithVolume.forEach((kw: any) => {
      const type = kw.matchType || 'PHRASE'  // 缺失matchType时按PHRASE统计，避免误判为BROAD
      matchTypes[type] = (matchTypes[type] || 0) + 1
    })
    const matchTypeDistribution = Object.entries(matchTypes)
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ') || 'Not specified'

    // 🔥 新增(2025-12-18)：调试日志 - 追踪匹配类型分布
    console.log(`[LaunchScore] 关键词匹配类型分布:`)
    console.log(`   - 总关键词数: ${keywordsWithVolume.length}`)
    console.log(`   - 分布详情: ${matchTypeDistribution}`)
    if (keywordsWithVolume.length > 0) {
      const firstKw = keywordsWithVolume[0]
      console.log(`   - 第一个关键词: ${firstKw.keyword}`)
      console.log(`   - 第一个matchType: ${firstKw.matchType || '(未设置)'}`)
    }

    // 🔥 新增：调试日志 - 追踪prompt中的否定关键词
    console.log(`[LaunchScore] 准备替换到prompt中的否定关键词数量: ${negativeKeywords.length}`)
    console.log(`[LaunchScore] 否定关键词内容: ${negativeKeywords.length > 0 ? negativeKeywords.join(', ') : 'NONE'}`)

    // 🎨 插值替换模板变量
    const prompt = promptTemplate
      // Campaign Overview - 🔧 使用用户配置数据
      .replace('{{brand}}', offer.brand || 'Unknown')
      .replace('{{productName}}', offer.brand_description || offer.brand || 'Unknown')
      .replace('{{targetCountry}}', campaignConfig?.targetCountry || offer.target_country || 'US')
      .replace('{{targetLanguage}}', campaignConfig?.targetLanguage || offer.target_language || 'English')
      // 🔧 修复(2025-12-26): 移除硬编码的美元符号，预算和CPC值是用户账号货币
      .replace('{{budget}}', campaignConfig?.budgetAmount ? `${campaignConfig.budgetAmount}/day` : '10/day')
      .replace('{{maxCpc}}', campaignConfig?.maxCpcBid ? `${campaignConfig.maxCpcBid}` : '0.17')
      // Budget Analysis - 🔧 基于用户配置评估，不依赖产品定价
      .replace('{{budgetAnalysis}}', `Daily Budget: ${dailyBudget}, Max CPC: ${maxCpcBid}, Est. Clicks/Day: ${estimatedClicksPerDay.toFixed(1)}`)
      .replace('{{budget合理性}}', isBudgetReasonable ? 'Reasonable' : 'Low')
      .replace('{{cpc合理性}}', isCpcReasonable ? 'Reasonable' : 'High')
      // Brand Search Data
      .replace('{{brandSearchVolume}}', brandSearchVolume.toString())
      .replace('{{brandCompetition}}', brandCompetition)
      // Keywords Data
      .replace('{{keywordCount}}', creativeKeywords.length.toString())
      .replace('{{matchTypeDistribution}}', matchTypeDistribution)
      .replace('{{keywordsWithVolume}}', keywordsWithVolumeText)
      .replace('{{negativeKeywordsCount}}', negativeKeywords.length.toString())
      .replace('{{negativeKeywords}}', negativeKeywords.length > 0 ? negativeKeywords.join(', ') : 'NONE (Critical Issue!)')
      // Ad Creatives
      .replace('{{headlineCount}}', headlines.length.toString())
      .replace('{{descriptionCount}}', creative.descriptions.length.toString())
      .replace('{{sampleHeadlines}}', headlines.slice(0, 5).join(', '))
      .replace('{{sampleDescriptions}}', creative.descriptions.join(', '))
      .replace('{{headlineDiversity}}', headlineDiversity.toString())
      .replace('{{adStrength}}', adStrength)
      // Landing Page
      .replace('{{finalUrl}}', creative.final_url || offer.final_url || '')
      .replace('{{pageType}}', offer.url?.includes('/stores/') || offer.url?.includes('/store/') ? 'Store Page' : 'Product Page')

    // 🤖 调用AI评分
    const aiResponse = await generateContent({
      operationType: 'launch_score_calculation',
      prompt,
      temperature: 0.5,
      maxOutputTokens: 8192,
    }, userId)

    // 记录token使用
    if (aiResponse.usage) {
      const cost = estimateTokenCost(
        aiResponse.model,
        aiResponse.usage.inputTokens,
        aiResponse.usage.outputTokens
      )
      await recordTokenUsage({
        userId,
        model: aiResponse.model,
        operationType: 'launch_score_calculation',
        inputTokens: aiResponse.usage.inputTokens,
        outputTokens: aiResponse.usage.outputTokens,
        totalTokens: aiResponse.usage.totalTokens,
        cost,
        apiType: aiResponse.apiType
      })
    }

    // 提取JSON内容
    const jsonMatch = aiResponse.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('AI返回格式错误，未找到JSON')
    }

    // 清理JSON
    let jsonString = jsonMatch[0]
      .replace(/,(\s*[}\]])/g, '$1')
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')

    const rawAnalysis = JSON.parse(jsonString) as ScoreAnalysis

    // 验证必需字段存在
    if (!rawAnalysis.launchViability || !rawAnalysis.adQuality ||
        !rawAnalysis.keywordStrategy || !rawAnalysis.basicConfig) {
      console.error('AI返回的JSON结构不完整:', JSON.stringify(rawAnalysis, null, 2))
      throw new Error(`AI返回的JSON缺少必需的分析字段。已有字段: ${Object.keys(rawAnalysis).join(', ')}`)
    }

    // 🔥 调试日志 - v4.16: 显示所有4个维度的评分（版本由prompt_loader自动确定）
    const promptVersion = promptTemplate.includes('marketPotentialScore') ? 'v4.15+' : 'v4.0'
    console.log(`[LaunchScore] ===== ${promptVersion} 四维度评分详情 =====`)
    console.log(`[LaunchScore] 1️⃣ 投放可行性: ${rawAnalysis.launchViability.score}/40`)
    console.log(`   - 品牌搜索量得分: ${rawAnalysis.launchViability.brandSearchScore}/15`)
    console.log(`   - 竞争度得分: ${rawAnalysis.launchViability.competitionScore}/15`)
    console.log(`   - 市场潜力得分: ${rawAnalysis.launchViability.marketPotentialScore}/10`)
    console.log(`   - 竞争度级别: ${rawAnalysis.launchViability.competitionLevel}`)

    console.log(`[LaunchScore] 2️⃣ 广告质量: ${rawAnalysis.adQuality.score}/30`)
    console.log(`   - Ad Strength得分: ${rawAnalysis.adQuality.adStrengthScore}/15 (${rawAnalysis.adQuality.adStrength})`)
    console.log(`   - 标题多样性得分: ${rawAnalysis.adQuality.headlineDiversityScore}/8`)
    console.log(`   - 描述质量得分: ${rawAnalysis.adQuality.descriptionQualityScore}/7`)

    console.log(`[LaunchScore] 3️⃣ 关键词策略: ${rawAnalysis.keywordStrategy.score}/20`)
    console.log(`   - 关键词相关性: ${rawAnalysis.keywordStrategy.relevanceScore}/8`)
    console.log(`   - 匹配类型策略: ${rawAnalysis.keywordStrategy.matchTypeScore}/6`)
    console.log(`   - 否定关键词: ${rawAnalysis.keywordStrategy.negativeKeywordsScore}/6`)

    console.log(`[LaunchScore] 4️⃣ 基础配置: ${rawAnalysis.basicConfig.score}/10`)
    console.log(`   - 国家/语言得分: ${rawAnalysis.basicConfig.countryLanguageScore}/5`)
    console.log(`   - Final URL得分: ${rawAnalysis.basicConfig.finalUrlScore}/5`)
    console.log(`   - 目标国家: ${rawAnalysis.basicConfig.targetCountry}`)
    console.log(`   - 目标语言: ${rawAnalysis.basicConfig.targetLanguage}`)
    console.log(`   - Final URL: ${rawAnalysis.basicConfig.finalUrl}`)

    const calculatedTotal =
      rawAnalysis.launchViability.score +
      rawAnalysis.adQuality.score +
      rawAnalysis.keywordStrategy.score +
      rawAnalysis.basicConfig.score

    console.log(`[LaunchScore] 🎯 总分: ${calculatedTotal}/100`)
    console.log(`[LaunchScore] AI返回的overallRecommendations:`, rawAnalysis.overallRecommendations)
    console.log(`[LaunchScore] =====================================`)

    // 验证评分范围
    validateScoresV4(rawAnalysis)

    // 🎯 补充缺失数据
    rawAnalysis.launchViability.brandSearchVolume = rawAnalysis.launchViability.brandSearchVolume || brandSearchVolume
    // v4.15: 确保新增字段有默认值
    rawAnalysis.launchViability.marketPotentialScore = rawAnalysis.launchViability.marketPotentialScore ?? 0
    // 修复(2025-12-19): 如果AI返回无效值或为空，用本地计算的值覆盖
    rawAnalysis.adQuality.adStrength = (!rawAnalysis.adQuality.adStrength || !['POOR', 'AVERAGE', 'GOOD', 'EXCELLENT', 'PENDING'].includes(rawAnalysis.adQuality.adStrength)) ? adStrength as 'POOR' | 'AVERAGE' | 'GOOD' | 'EXCELLENT' : rawAnalysis.adQuality.adStrength
    rawAnalysis.launchViability.competitionLevel = (!rawAnalysis.launchViability.competitionLevel || !['LOW', 'MEDIUM', 'HIGH'].includes(rawAnalysis.launchViability.competitionLevel)) ? brandCompetition : rawAnalysis.launchViability.competitionLevel
    rawAnalysis.adQuality.headlineDiversity = rawAnalysis.adQuality.headlineDiversity || headlineDiversity
    rawAnalysis.keywordStrategy.totalKeywords = rawAnalysis.keywordStrategy.totalKeywords || creativeKeywords.length
    rawAnalysis.keywordStrategy.negativeKeywordsCount = rawAnalysis.keywordStrategy.negativeKeywordsCount || negativeKeywords.length
    rawAnalysis.basicConfig.targetCountry = rawAnalysis.basicConfig.targetCountry || offer.target_country
    rawAnalysis.basicConfig.targetLanguage = rawAnalysis.basicConfig.targetLanguage || offer.target_language || 'English'
    rawAnalysis.basicConfig.finalUrl = rawAnalysis.basicConfig.finalUrl || creative.final_url || ''
    rawAnalysis.basicConfig.dailyBudget = rawAnalysis.basicConfig.dailyBudget || campaignConfig?.budgetAmount || 10
    rawAnalysis.basicConfig.maxCpc = rawAnalysis.basicConfig.maxCpc || campaignConfig?.maxCpcBid || 0.17

    // 🎯 计算总分
    const totalScore =
      rawAnalysis.launchViability.score +
      rawAnalysis.adQuality.score +
      rawAnalysis.keywordStrategy.score +
      rawAnalysis.basicConfig.score

    return {
      totalScore,
      analysis: {
        launchViability: rawAnalysis.launchViability,
        adQuality: rawAnalysis.adQuality,
        keywordStrategy: rawAnalysis.keywordStrategy,
        basicConfig: rawAnalysis.basicConfig,
      },
      recommendations: rawAnalysis.overallRecommendations || [],
      scoreAnalysis: rawAnalysis
    }
  } catch (error: any) {
    console.error('计算Launch Score失败:', error)
    throw new Error(`计算Launch Score失败: ${error.message}`)
  }
}

/**
 * 验证评分是否在合理范围内（v4.15 - 4维度）
 * 各维度独立评分，总分为各维度之和（范围0-100）
 */
function validateScoresV4(analysis: ScoreAnalysis): void {
  if (analysis.launchViability.score < 0 || analysis.launchViability.score > 40) {
    throw new Error('投放可行性评分超出范围(0-40)')
  }
  if (analysis.adQuality.score < 0 || analysis.adQuality.score > 30) {
    throw new Error('广告质量评分超出范围(0-30)')
  }
  if (analysis.keywordStrategy.score < 0 || analysis.keywordStrategy.score > 20) {
    throw new Error('关键词策略评分超出范围(0-20)')
  }
  if (analysis.basicConfig.score < 0 || analysis.basicConfig.score > 10) {
    throw new Error('基础配置评分超出范围(0-10)')
  }

  // v4.15: 验证总分在合理范围内（0-100）
  // 🔧 修复(2025-12-18): 总分是各维度独立评分之和，不强制等于100
  const totalScore =
    analysis.launchViability.score +
    analysis.adQuality.score +
    analysis.keywordStrategy.score +
    analysis.basicConfig.score

  if (totalScore < 0 || totalScore > 100) {
    throw new Error(`总分超出范围(0-100): ${totalScore}`)
  }
}

/**
 * 获取评分等级和颜色
 */
export function getScoreGrade(totalScore: number): {
  grade: string
  color: string
  label: string
} {
  if (totalScore >= 85) {
    return { grade: 'A', color: 'green', label: '优秀' }
  } else if (totalScore >= 70) {
    return { grade: 'B', color: 'blue', label: '良好' }
  } else if (totalScore >= 60) {
    return { grade: 'C', color: 'yellow', label: '及格' }
  } else if (totalScore >= 50) {
    return { grade: 'D', color: 'orange', label: '需改进' }
  } else {
    return { grade: 'F', color: 'red', label: '不建议投放' }
  }
}

/**
 * ========================================
 * Ad Strength评估系统（NEW）
 * 结合本地算法 + Google Ads API验证
 * ========================================
 */

/**
 * 综合评估结果（本地 + Google API）
 */
export interface ComprehensiveAdStrengthResult {
  // 本地评估结果
  localEvaluation: AdStrengthEvaluation

  // RSA专用质量门（新增：用于发布前阻断）
  rsaQualityGate: {
    intentAlignmentScore: number // 0-100
    evidenceAlignmentScore: number // 0-100
    queryLandingAlignmentScore: number // 0-100
    passed: boolean
    reasons: string[]
  }

  // Google API验证结果（可选）
  googleValidation?: {
    adStrength: AdStrengthRating
    isExcellent: boolean
    recommendations: string[]
    assetPerformance?: {
      bestHeadlines: string[]
      bestDescriptions: string[]
      lowPerformingAssets: string[]
    }
  }

  // 最终评级（优先使用Google API结果，否则使用本地结果）
  finalRating: AdStrengthRating
  finalScore: number

  // 综合建议
  combinedSuggestions: string[]
}

const RSA_QUALITY_THRESHOLDS = {
  intentAlignmentScore: 70,
  evidenceAlignmentScore: 75,
  queryLandingAlignmentScore: 65,
} as const

function resolveRsaQualityThresholds(localEvaluation: AdStrengthEvaluation) {
  const expectedBucket = localEvaluation.copyIntentMetrics?.expectedBucket
  if (expectedBucket === 'A') {
    return {
      ...RSA_QUALITY_THRESHOLDS,
      // Brand-intent store traffic is often navigational and less product-specific.
      queryLandingAlignmentScore: 58,
    }
  }
  return RSA_QUALITY_THRESHOLDS
}

function buildRsaQualityGate(localEvaluation: AdStrengthEvaluation): {
  intentAlignmentScore: number
  evidenceAlignmentScore: number
  queryLandingAlignmentScore: number
  passed: boolean
  reasons: string[]
} {
  const relevance = localEvaluation.dimensions.relevance
  const compliance = localEvaluation.dimensions.compliance

  const intentAlignmentScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        localEvaluation.copyIntentMetrics?.typeIntentAlignmentScore ??
          (relevance.score / 22) * 100
      )
    )
  )

  const evidenceAlignmentScore = Math.max(
    0,
    Math.min(
      100,
      Math.round((compliance.score / 8) * 100)
    )
  )

  const keywordCoveragePct = Math.max(
    0,
    Math.min(100, Math.round((relevance.details.keywordCoverage || 0) * 10))
  )
  const productFocusPct = Math.max(
    0,
    Math.min(100, Math.round(((relevance.details.productFocus || 0) / 4) * 100))
  )
  const queryLandingAlignmentScore = Math.round(keywordCoveragePct * 0.6 + productFocusPct * 0.4)

  const thresholds = resolveRsaQualityThresholds(localEvaluation)
  const reasons: string[] = []
  if (intentAlignmentScore < thresholds.intentAlignmentScore) {
    reasons.push(`intentAlignmentScore ${intentAlignmentScore} < ${thresholds.intentAlignmentScore}`)
  }
  if (evidenceAlignmentScore < thresholds.evidenceAlignmentScore) {
    reasons.push(`evidenceAlignmentScore ${evidenceAlignmentScore} < ${thresholds.evidenceAlignmentScore}`)
  }
  if (queryLandingAlignmentScore < thresholds.queryLandingAlignmentScore) {
    reasons.push(`queryLandingAlignmentScore ${queryLandingAlignmentScore} < ${thresholds.queryLandingAlignmentScore}`)
  }

  return {
    intentAlignmentScore,
    evidenceAlignmentScore,
    queryLandingAlignmentScore,
    passed: reasons.length === 0,
    reasons,
  }
}

/**
 * 评估广告创意的Ad Strength（支持本地评估 + Google API验证）
 *
 * @param headlines Headline资产数组（带metadata）
 * @param descriptions Description资产数组（带metadata）
 * @param keywords 关键词列表
 * @param options 可选配置
 * @returns 综合评估结果
 */
export async function evaluateCreativeAdStrength(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[],
  keywords: string[],
  options?: {
    // Google API验证配置（可选）
    googleValidation?: {
      customerId: string
      campaignId: string
      userId: number
    }
    // 品牌搜索量配置（可选）
    brandName?: string
    targetCountry?: string
    targetLanguage?: string
    bucketType?: 'A' | 'B' | 'C' | 'D' | 'S'
    creativeType?: CanonicalCreativeType
    userId?: number
    keywordsWithVolume?: Array<{
      keyword: string
      searchVolume: number
      volumeUnavailableReason?: 'DEV_TOKEN_INSUFFICIENT_ACCESS' | 'DEV_TOKEN_TEST_ONLY'
    }>
  }
): Promise<ComprehensiveAdStrengthResult> {
  console.log('🎯 开始Ad Strength评估...')

  // 1. 本地评估（快速，无需API调用）
  const localEvaluation = await evaluateAdStrength(headlines, descriptions, keywords, {
    brandName: options?.brandName,
    targetCountry: options?.targetCountry,
    targetLanguage: options?.targetLanguage,
    bucketType: options?.bucketType,
    creativeType: options?.creativeType,
    userId: options?.userId,
    keywordsWithVolume: options?.keywordsWithVolume,
  })

  console.log(`📊 本地评估: ${localEvaluation.rating} (${localEvaluation.overallScore}分)`)

  // 2. Google API验证（可选）
  let googleValidation: ComprehensiveAdStrengthResult['googleValidation'] | undefined

  if (options?.googleValidation) {
    try {
      console.log('🔍 正在调用Google Ads API验证...')

      const { customerId, campaignId, userId } = options.googleValidation

      const validationResult = await validateExcellentStandard(
        customerId,
        campaignId,
        userId
      )

      googleValidation = {
        adStrength: validationResult.currentStrength,
        isExcellent: validationResult.isExcellent,
        recommendations: validationResult.recommendations,
        assetPerformance: validationResult.assetPerformance
      }

      console.log(`✅ Google API验证: ${validationResult.currentStrength}`)
    } catch (error) {
      console.warn('⚠️ Google API验证失败，使用本地评估结果:', error)
    }
  }

  // 3. 确定最终评级（优先Google API）
  const finalRating = googleValidation?.adStrength || localEvaluation.rating
  const finalScore = localEvaluation.overallScore
  const rsaQualityGate = buildRsaQualityGate(localEvaluation)

  // 4. 合并建议
  const combinedSuggestions = [
    ...localEvaluation.suggestions,
    ...(googleValidation?.recommendations || [])
  ]

  // 去重建议
  const uniqueSuggestions = Array.from(new Set(combinedSuggestions))

  console.log(`🎯 最终评级: ${finalRating} (${finalScore}分)`)
  console.log(`💡 改进建议: ${uniqueSuggestions.length}条`)
  console.log(
    `🧪 RSA质量门: intent=${rsaQualityGate.intentAlignmentScore}, evidence=${rsaQualityGate.evidenceAlignmentScore}, queryLanding=${rsaQualityGate.queryLandingAlignmentScore}, passed=${rsaQualityGate.passed}`
  )

  return {
    localEvaluation,
    rsaQualityGate,
    googleValidation,
    finalRating,
    finalScore,
    combinedSuggestions: uniqueSuggestions
  }
}

/**
 * 简化版：仅返回Ad Strength评级（用于快速评估）
 *
 * @param headlines Headline资产数组
 * @param descriptions Description资产数组
 * @param keywords 关键词列表
 * @param brandOptions 品牌搜索量配置（可选）
 * @returns Ad Strength评级
 */
export async function getQuickAdStrength(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[],
  keywords: string[],
  brandOptions?: {
    brandName?: string
    targetCountry?: string
    targetLanguage?: string
    userId?: number
  }
): Promise<AdStrengthRating> {
  const evaluation = await evaluateAdStrength(headlines, descriptions, keywords, brandOptions)
  return evaluation.rating
}

/**
 * 转换旧格式创意为新格式（向后兼容）
 *
 * @param creative 旧格式创意
 * @returns 新格式的headlines和descriptions
 */
export function convertLegacyCreativeFormat(creative: {
  headline1: string
  headline2: string
  headline3: string
  description1: string
  description2: string
}): {
  headlines: HeadlineAsset[]
  descriptions: DescriptionAsset[]
} {
  const headlines: HeadlineAsset[] = [
    { text: creative.headline1, length: creative.headline1.length },
    { text: creative.headline2, length: creative.headline2.length },
    { text: creative.headline3, length: creative.headline3.length }
  ]

  const descriptions: DescriptionAsset[] = [
    { text: creative.description1, length: creative.description1.length },
    { text: creative.description2, length: creative.description2.length }
  ]

  return { headlines, descriptions }
}

/**
 * ========================================
 * Pre-Generation Keyword Gap Analysis
 * ========================================
 */

/**
 * 从评分建议中提取关键词
 * 支持多种格式：'keyword', "keyword", 「keyword」, (keyword)
 */
function extractKeywordsFromSuggestion(suggestion: string): string[] {
  const keywords: string[] = []

  // Pattern 1: Single quotes 'keyword'
  const singleQuoteMatches = suggestion.match(/'([^']+)'/g)
  if (singleQuoteMatches) {
    singleQuoteMatches.forEach(match => {
      const keyword = match.replace(/'/g, '').trim()
      if (keyword) keywords.push(keyword)
    })
  }

  // Pattern 2: Double quotes "keyword"
  const doubleQuoteMatches = suggestion.match(/"([^"]+)"/g)
  if (doubleQuoteMatches) {
    doubleQuoteMatches.forEach(match => {
      const keyword = match.replace(/"/g, '').trim()
      if (keyword) keywords.push(keyword)
    })
  }

  // Pattern 3: Chinese quotes 「keyword」
  const chineseQuoteMatches = suggestion.match(/「([^」]+)」/g)
  if (chineseQuoteMatches) {
    chineseQuoteMatches.forEach(match => {
      const keyword = match.replace(/[「」]/g, '').trim()
      if (keyword) keywords.push(keyword)
    })
  }

  // Pattern 4: Parentheses (keyword) - but only if it looks like a keyword (2-6 words)
  const parenMatches = suggestion.match(/\(([^)]+)\)/g)
  if (parenMatches) {
    parenMatches.forEach(match => {
      const keyword = match.replace(/[()]/g, '').trim()
      const wordCount = keyword.split(/\s+/).length
      if (keyword && wordCount >= 2 && wordCount <= 6) {
        keywords.push(keyword)
      }
    })
  }

  return keywords
}

/**
 * 验证提取的关键词是否有效
 *
 * 🔥 2026-03-13优化：动态词数限制，根据上下文放宽规则
 * - 高搜索量关键词：1-8词（允许单词和长尾词）
 * - 品牌词：1-8词
 * - 行业通用词（SCORING_SUGGESTION）：1-8词
 * - 默认：2-6词
 */
function isValidExtractedKeyword(
  keyword: string,
  context?: {
    searchVolume?: number
    source?: string
    brandName?: string
  }
): boolean {
  if (!keyword || keyword.length < 3) return false

  const wordCount = keyword.split(/\s+/).filter(Boolean).length

  // 动态词数限制
  let minWords = 2
  let maxWords = 6

  if (context) {
    // 高搜索量关键词放宽限制（允许单词和长尾词）
    if (context.searchVolume && context.searchVolume > 100000) {
      minWords = 1
      maxWords = 8
    }

    // 品牌词放宽限制
    if (context.brandName && keyword.toLowerCase().includes(context.brandName.toLowerCase())) {
      minWords = 1
      maxWords = 8
    }

    // 行业通用词放宽限制
    if (context.source === 'SCORING_SUGGESTION') {
      minWords = 1
      maxWords = 8
    }
  }

  if (wordCount < minWords || wordCount > maxWords) return false

  // No special characters (except spaces and hyphens)
  if (!/^[a-zA-Z0-9\s-]+$/.test(keyword)) return false

  return true
}

/**
 * 在创意生成前分析关键词缺口
 *
 * @param params 分析参数
 * @returns 建议的关键词列表
 */
export async function analyzeKeywordGapsPreGeneration(params: {
  offer: Offer
  existingKeywords: Array<{ keyword: string; searchVolume?: number }>
  brandName: string
  userId: number
  targetCountry?: string
  targetLanguage?: string
}): Promise<{
  suggestedKeywords: string[]
  analysisUsed: boolean
  error?: string
}> {
  try {
    console.log('[Gap Analysis] 开始关键词缺口分析...')
    console.log(`[Gap Analysis] 现有关键词数量: ${params.existingKeywords.length}`)

    // 🆕 优化：使用专门的 AI prompt 直接提取关键词，而不是依赖评分系统
    const { generateContent } = await import('./gemini')
    const { repairJsonText } = await import('./ai-json')

    // 构建关键词缺口分析 prompt
    const existingKeywordsList = params.existingKeywords
      .map(kw => `- ${kw.keyword}${kw.searchVolume ? ` (${kw.searchVolume} 搜索量)` : ''}`)
      .join('\n')

    const prompt = `你是一个 Google Ads 关键词专家。请分析以下品牌的现有关键词，识别缺失的高价值行业标准关键词。

品牌: ${params.brandName}
产品类别: ${params.offer.category || '未知'}
产品名称: ${params.offer.product_name || params.offer.brand || ''}
目标国家: ${params.targetCountry || params.offer.target_country || 'US'}
目标语言: ${params.targetLanguage || params.offer.target_language || 'en'}

现有关键词:
${existingKeywordsList}

请识别缺失的高价值关键词，要求：
1. 关键词必须是行业标准词（不包含品牌名）
2. 关键词应该有较高的搜索量和购买意图
3. 关键词应该与产品高度相关
4. 每个关键词 2-6 个单词
5. 最多返回 15 个关键词

请以 JSON 格式返回，格式如下：
{
  "missing_keywords": [
    {
      "keyword": "recumbent bike",
      "reason": "高搜索量行业通用词，与产品直接相关",
      "estimated_volume": "high",
      "priority": "high"
    }
  ]
}

只返回 JSON，不要其他文字。`

    console.log('[Gap Analysis] 调用 AI 提取关键词...')
    const response = await generateContent({
      operationType: 'keyword_gap_analysis',
      prompt,
      temperature: 0.3,
      maxOutputTokens: 2048
    }, params.userId)

    if (response.usage) {
      const cost = estimateTokenCost(
        response.model,
        response.usage.inputTokens,
        response.usage.outputTokens
      )
      await recordTokenUsage({
        userId: params.userId,
        model: response.model,
        operationType: 'keyword_gap_analysis',
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        totalTokens: response.usage.totalTokens,
        cost,
        apiType: response.apiType,
      })
    }

    if (!response.text) {
      throw new Error('AI 未返回有效响应')
    }

    // 解析 JSON 响应
    let parsedResponse: { missing_keywords: Array<{ keyword: string; priority: string }> }
    try {
      const repairedJson = repairJsonText(response.text)
      parsedResponse = JSON.parse(repairedJson)
    } catch (parseError) {
      console.warn('[Gap Analysis] JSON 解析失败，回退到引号匹配:', parseError)
      // 回退到原有的引号匹配逻辑
      const keywords = extractKeywordsFromSuggestion(response.text)
      return {
        suggestedKeywords: keywords.slice(0, 10),
        analysisUsed: true
      }
    }

    // 提取高优先级和中优先级的关键词
    const extractedKeywords = new Set<string>()
    const existingKeywordsLower = new Set(
      params.existingKeywords.map(kw => kw.keyword.toLowerCase().trim())
    )

    if (parsedResponse.missing_keywords && Array.isArray(parsedResponse.missing_keywords)) {
      for (const item of parsedResponse.missing_keywords) {
        if (!item.keyword) continue

        const keyword = item.keyword.trim()
        const normalizedKeyword = keyword.toLowerCase()

        // 验证关键词（传入上下文以放宽限制）
        if (!isValidExtractedKeyword(keyword, {
          source: 'SCORING_SUGGESTION',
          brandName: params.brandName
        })) {
          console.log(`[Gap Analysis] 跳过无效关键词: ${keyword}`)
          continue
        }

        // 去重
        if (existingKeywordsLower.has(normalizedKeyword)) {
          console.log(`[Gap Analysis] 跳过重复关键词: ${keyword}`)
          continue
        }

        // 只保留高优先级和中优先级的关键词
        if (item.priority === 'high' || item.priority === 'medium') {
          extractedKeywords.add(keyword)
          console.log(`[Gap Analysis] ✅ 提取关键词: ${keyword} (${item.priority})`)
        }
      }
    }

    const suggestedKeywords = Array.from(extractedKeywords)

    // 🎯 限制数量：最多10个行业通用核心词
    const MAX_GAP_KEYWORDS = 10
    const limitedKeywords = suggestedKeywords.slice(0, MAX_GAP_KEYWORDS)

    if (suggestedKeywords.length > MAX_GAP_KEYWORDS) {
      console.log(`[Gap Analysis] 提取了 ${suggestedKeywords.length} 个关键词，限制为前 ${MAX_GAP_KEYWORDS} 个`)
    } else {
      console.log(`[Gap Analysis] 完成，提取 ${limitedKeywords.length} 个建议关键词`)
    }

    return {
      suggestedKeywords: limitedKeywords,
      analysisUsed: true
    }
  } catch (error: any) {
    console.error('[Gap Analysis] 分析失败:', error)
    return {
      suggestedKeywords: [],
      analysisUsed: false,
      error: error.message
    }
  }
}
