import { getDatabase } from './db'
import { getInsertedId } from './db-helpers'
import crypto from 'crypto'

/**
 * Launch Score 数据库记录（v4.0 - 4维度）
 */
export interface LaunchScore {
  id: number
  userId: number
  offerId: number
  totalScore: number
  // 4维度分数
  launchViabilityScore: number // 投放可行性 (35分)
  adQualityScore: number // 广告质量 (30分)
  keywordStrategyScore: number // 关键词策略 (20分)
  basicConfigScore: number // 基础配置 (15分)
  // 详细分析数据 (JSON)
  launchViabilityData: string | null
  adQualityData: string | null
  keywordStrategyData: string | null
  basicConfigData: string | null
  recommendations: string | null
  calculatedAt: string
  // v4.1 - 缓存支持字段
  adCreativeId: number | null // 关联的广告创意ID
  issues: string | null // 主要问题 (JSON array)
  suggestions: string | null // 改进建议 (JSON array)
  contentHash: string | null // 创意内容哈希（用于缓存失效）
  campaignConfigHash: string | null // 投放配置哈希（用于缓存失效）
}

/**
 * Launch Score 评分体系 v4.15
 *
 * 4维度评分系统（总分100）：
 * 1. 投放可行性 (40分) - 品牌词搜索量15 + 竞争度15 + 市场潜力10
 * 2. 广告质量 (30分) - Ad Strength 15 + 标题多样性8 + 描述质量7
 * 3. 关键词策略 (20分) - 关键词相关性8 + 匹配类型6 + 否定关键词6
 * 4. 基础配置 (10分) - 国家/语言5 + Final URL 5
 *
 * 变更说明 (v4.14 → v4.15)：
 * - 移除profitScore (10分) → 改为profitScore = 0 (已废弃)
 * - 增加竞争度评分: 10分 → 15分
 * - 新增市场潜力评分 (0-10分) = 品牌搜索量与竞争度的综合评估
 * - 移除预算合理性评分 (基础配置: 15分 → 10分)
 * - Final URL: 仅检查可访问性，满分5分
 */
export interface ScoreAnalysis {
  // 维度1：投放可行性 (40分)
  launchViability: {
    score: number // 0-40
    brandSearchVolume: number // 品牌词月搜索量
    brandSearchScore: number // 0-15
    profitMargin: number // 保留但不再评估，始终为0
    profitScore: number // 已废弃，始终为0
    competitionLevel: 'LOW' | 'MEDIUM' | 'HIGH' // 竞争度
    competitionScore: number // 0-15 (v4.15: 从0-10改为0-15)
    marketPotentialScore: number // 0-10 (v4.15新增: 基于品牌搜索量+竞争度的综合评估)
    issues?: string[]
    suggestions?: string[]
  }

  // 维度2：广告质量 (30分)
  adQuality: {
    score: number // 0-30
    adStrength: 'POOR' | 'AVERAGE' | 'GOOD' | 'EXCELLENT'
    adStrengthScore: number // 0-15 (POOR=3, AVERAGE=8, GOOD=12, EXCELLENT=15)
    headlineDiversity: number // 标题差异化程度 0-100%
    headlineDiversityScore: number // 0-8
    descriptionQuality: number // 描述质量 0-100%
    descriptionQualityScore: number // 0-7
    issues?: string[]
    suggestions?: string[]
  }

  // 维度3：关键词策略 (20分)
  keywordStrategy: {
    score: number // 0-20
    relevanceScore: number // 关键词相关性 0-8
    matchTypeScore: number // 匹配类型策略 0-6
    negativeKeywordsScore: number // 否定关键词覆盖 0-6
    totalKeywords: number
    negativeKeywordsCount: number
    matchTypeDistribution: Record<string, number>
    issues?: string[]
    suggestions?: string[]
  }

  // 维度4：基础配置 (10分)
  basicConfig: {
    score: number // 0-10 (v4.15: 从0-15改为0-10)
    countryLanguageScore: number // 国家/语言匹配 0-5
    finalUrlScore: number // Final URL可访问性 0-5 (v4.15: 仅检查可访问性)
    budgetScore: number // 已废弃，始终为0
    targetCountry: string
    targetLanguage: string
    finalUrl: string
    dailyBudget: number
    maxCpc: number
    issues?: string[]
    suggestions?: string[]
  }

  overallRecommendations: string[]
}

/**
 * 创意内容数据（用于计算哈希）
 */
export interface CreativeContentData {
  headlines: string[]
  descriptions: string[]
  keywords: string[]
  negativeKeywords: string[]
  finalUrl: string
}

/**
 * 投放配置数据（用于计算哈希）
 */
export interface CampaignConfigData {
  targetCountry: string
  targetLanguage: string
  dailyBudget: number
  maxCpc: number
}

/**
 * 计算创意内容哈希
 * 用于检测创意内容是否发生变化
 */
export function computeContentHash(content: CreativeContentData): string {
  const normalized = {
    headlines: [...content.headlines].sort(),
    descriptions: [...content.descriptions].sort(),
    keywords: [...content.keywords].sort(),
    negativeKeywords: [...content.negativeKeywords].sort(),
    finalUrl: content.finalUrl.toLowerCase().trim(),
  }
  const str = JSON.stringify(normalized)
  return crypto.createHash('sha256').update(str).digest('hex').substring(0, 32)
}

/**
 * 计算投放配置哈希
 * 用于检测投放配置是否发生变化
 */
export function computeCampaignConfigHash(config: CampaignConfigData): string {
  const normalized = {
    targetCountry: config.targetCountry.toUpperCase().trim(),
    targetLanguage: config.targetLanguage.toLowerCase().trim(),
    dailyBudget: Math.round(config.dailyBudget * 100) / 100,
    maxCpc: Math.round(config.maxCpc * 100) / 100,
  }
  const str = JSON.stringify(normalized)
  return crypto.createHash('sha256').update(str).digest('hex').substring(0, 16)
}

/**
 * 查找缓存的Launch Score
 * 通过 creative_id + content_hash + campaign_config_hash 精确匹配
 */
export async function findCachedLaunchScore(
  creativeId: number,
  contentHash: string,
  campaignConfigHash: string,
  userId: number
): Promise<LaunchScore | null> {
  const db = await getDatabase()

  const row = await db.queryOne(`
    SELECT * FROM launch_scores
    WHERE ad_creative_id = ?
      AND content_hash = ?
      AND campaign_config_hash = ?
      AND user_id = ?
    ORDER BY calculated_at DESC
    LIMIT 1
  `, [creativeId, contentHash, campaignConfigHash, userId]) as any

  if (!row) {
    return null
  }

  return mapRowToLaunchScore(row)
}

/**
 * 通过creative_id查找最新的Launch Score
 */
export async function findLaunchScoreByCreativeId(
  creativeId: number,
  userId: number
): Promise<LaunchScore | null> {
  const db = await getDatabase()

  const row = await db.queryOne(`
    SELECT * FROM launch_scores
    WHERE ad_creative_id = ?
      AND user_id = ?
    ORDER BY calculated_at DESC
    LIMIT 1
  `, [creativeId, userId]) as any

  if (!row) {
    return null
  }

  return mapRowToLaunchScore(row)
}

/**
 * 从ScoreAnalysis中提取所有issues
 */
export function extractAllIssues(analysis: ScoreAnalysis): string[] {
  const issues: string[] = []
  if (analysis.launchViability.issues) {
    issues.push(...analysis.launchViability.issues)
  }
  if (analysis.adQuality.issues) {
    issues.push(...analysis.adQuality.issues)
  }
  if (analysis.keywordStrategy.issues) {
    issues.push(...analysis.keywordStrategy.issues)
  }
  if (analysis.basicConfig.issues) {
    issues.push(...analysis.basicConfig.issues)
  }
  return issues
}

/**
 * 从ScoreAnalysis中提取所有suggestions
 */
export function extractAllSuggestions(analysis: ScoreAnalysis): string[] {
  const suggestions: string[] = []
  if (analysis.launchViability.suggestions) {
    suggestions.push(...analysis.launchViability.suggestions)
  }
  if (analysis.adQuality.suggestions) {
    suggestions.push(...analysis.adQuality.suggestions)
  }
  if (analysis.keywordStrategy.suggestions) {
    suggestions.push(...analysis.keywordStrategy.suggestions)
  }
  if (analysis.basicConfig.suggestions) {
    suggestions.push(...analysis.basicConfig.suggestions)
  }
  // 添加总体建议
  if (analysis.overallRecommendations) {
    suggestions.push(...analysis.overallRecommendations)
  }
  return suggestions
}

/**
 * 创建Launch Score记录参数
 */
export interface CreateLaunchScoreParams {
  userId: number
  offerId: number
  analysis: ScoreAnalysis
  adCreativeId?: number
  contentHash?: string
  campaignConfigHash?: string
}

/**
 * 创建Launch Score记录（v4.1 - 支持缓存）
 */
export async function createLaunchScore(
  userId: number,
  offerId: number,
  analysis: ScoreAnalysis,
  options?: {
    adCreativeId?: number
    contentHash?: string
    campaignConfigHash?: string
  }
): Promise<LaunchScore> {
  const db = await getDatabase()

  const totalScore =
    analysis.launchViability.score +
    analysis.adQuality.score +
    analysis.keywordStrategy.score +
    analysis.basicConfig.score

  // 提取所有issues和suggestions
  const allIssues = extractAllIssues(analysis)
  const allSuggestions = extractAllSuggestions(analysis)

  // 🔧 修复(2025-12-17): 为兼容旧版本字段提供默认值（v3.0字段为NOT NULL）
  // v3.0字段：keyword_score, market_fit_score, landing_page_score, budget_score, content_score
  // v4.16字段：launch_viability_score, ad_quality_score, keyword_strategy_score, basic_config_score
  const legacyKeywordScore = analysis.keywordStrategy.score || 0
  const legacyMarketFitScore = analysis.launchViability.score || 0
  const legacyLandingPageScore = analysis.basicConfig.finalUrl ? 5 : 0  // 基于Final URL存在性评估
  const legacyBudgetScore = analysis.basicConfig.budgetScore || 0
  const legacyContentScore = analysis.adQuality.score || 0

  const info = await db.exec(`
    INSERT INTO launch_scores (
      user_id, offer_id, total_score,
      keyword_score, market_fit_score, landing_page_score, budget_score, content_score,
      keyword_analysis_data, market_analysis_data, landing_page_analysis_data, budget_analysis_data, content_analysis_data,
      recommendations, calculated_at,
      launch_viability_score, ad_quality_score, keyword_strategy_score, basic_config_score,
      launch_viability_data, ad_quality_data, keyword_strategy_data, basic_config_data,
      ad_creative_id, issues, suggestions, content_hash, campaign_config_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    userId,
    offerId,
    totalScore,
    legacyKeywordScore,
    legacyMarketFitScore,
    legacyLandingPageScore,
    legacyBudgetScore,
    legacyContentScore,
    JSON.stringify(analysis.keywordStrategy),
    JSON.stringify(analysis.launchViability),
    JSON.stringify(analysis.basicConfig),
    JSON.stringify(analysis.basicConfig),
    JSON.stringify(analysis.adQuality),
    JSON.stringify(analysis.overallRecommendations),
    new Date().toISOString(),
    analysis.launchViability.score,
    analysis.adQuality.score,
    analysis.keywordStrategy.score,
    analysis.basicConfig.score,
    JSON.stringify(analysis.launchViability),
    JSON.stringify(analysis.adQuality),
    JSON.stringify(analysis.keywordStrategy),
    JSON.stringify(analysis.basicConfig),
    options?.adCreativeId || null,
    JSON.stringify(allIssues),
    JSON.stringify(allSuggestions),
    options?.contentHash || null,
    options?.campaignConfigHash || null
  ])

  const insertedId = getInsertedId(info, db.type)
  return (await findLaunchScoreById(insertedId, userId))!
}

/**
 * 查找Launch Score（带权限验证）
 */
export async function findLaunchScoreById(id: number, userId: number): Promise<LaunchScore | null> {
  const db = await getDatabase()

  const row = await db.queryOne(`
    SELECT * FROM launch_scores
    WHERE id = ? AND user_id = ?
  `, [id, userId]) as any

  if (!row) {
    return null
  }

  return mapRowToLaunchScore(row)
}

/**
 * 查找Offer的所有Launch Scores
 */
export async function findLaunchScoresByOfferId(offerId: number, userId: number): Promise<LaunchScore[]> {
  const db = await getDatabase()

  const rows = await db.query(`
    SELECT * FROM launch_scores
    WHERE offer_id = ? AND user_id = ?
    ORDER BY calculated_at DESC
  `, [offerId, userId]) as any[]

  return rows.map(mapRowToLaunchScore)
}

/**
 * 查找Offer的最新Launch Score
 */
export async function findLatestLaunchScore(offerId: number, userId: number): Promise<LaunchScore | null> {
  const db = await getDatabase()

  const row = await db.queryOne(`
    SELECT * FROM launch_scores
    WHERE offer_id = ? AND user_id = ?
    ORDER BY calculated_at DESC
    LIMIT 1
  `, [offerId, userId]) as any

  if (!row) {
    return null
  }

  return mapRowToLaunchScore(row)
}

/**
 * 删除Launch Score
 */
export async function deleteLaunchScore(id: number, userId: number): Promise<boolean> {
  const db = await getDatabase()

  const info = await db.exec(`
    DELETE FROM launch_scores
    WHERE id = ? AND user_id = ?
  `, [id, userId])

  return info.changes > 0
}

/**
 * 数据库行映射为LaunchScore对象（v4.1 - 支持缓存）
 */
function mapRowToLaunchScore(row: any): LaunchScore {
  return {
    id: row.id,
    userId: row.user_id,
    offerId: row.offer_id,
    totalScore: row.total_score,
    // 4维度
    launchViabilityScore: row.launch_viability_score || 0,
    adQualityScore: row.ad_quality_score || 0,
    keywordStrategyScore: row.keyword_strategy_score || 0,
    basicConfigScore: row.basic_config_score || 0,
    launchViabilityData: row.launch_viability_data,
    adQualityData: row.ad_quality_data,
    keywordStrategyData: row.keyword_strategy_data,
    basicConfigData: row.basic_config_data,
    recommendations: row.recommendations,
    calculatedAt: row.calculated_at,
    // v4.1 缓存字段
    adCreativeId: row.ad_creative_id || null,
    issues: row.issues || null,
    suggestions: row.suggestions || null,
    contentHash: row.content_hash || null,
    campaignConfigHash: row.campaign_config_hash || null,
  }
}

/**
 * 解析Launch Score的详细分析数据（v4.0 - 4维度）
 */
export function parseLaunchScoreAnalysis(score: LaunchScore): ScoreAnalysis {
  return {
    launchViability: score.launchViabilityData ? JSON.parse(score.launchViabilityData) : getDefaultLaunchViability(),
    adQuality: score.adQualityData ? JSON.parse(score.adQualityData) : getDefaultAdQuality(),
    keywordStrategy: score.keywordStrategyData ? JSON.parse(score.keywordStrategyData) : getDefaultKeywordStrategy(),
    basicConfig: score.basicConfigData ? JSON.parse(score.basicConfigData) : getDefaultBasicConfig(),
    overallRecommendations: score.recommendations ? JSON.parse(score.recommendations) : [],
  }
}

// 默认值生成函数
function getDefaultLaunchViability(): ScoreAnalysis['launchViability'] {
  return {
    score: 0,
    brandSearchVolume: 0,
    brandSearchScore: 0,
    profitMargin: 0,
    profitScore: 0,
    competitionLevel: 'MEDIUM',
    competitionScore: 0,
    marketPotentialScore: 0, // v4.15新增
  }
}

function getDefaultAdQuality(): ScoreAnalysis['adQuality'] {
  return {
    score: 0,
    adStrength: 'POOR',
    adStrengthScore: 0,
    headlineDiversity: 0,
    headlineDiversityScore: 0,
    descriptionQuality: 0,
    descriptionQualityScore: 0,
  }
}

function getDefaultKeywordStrategy(): ScoreAnalysis['keywordStrategy'] {
  return {
    score: 0,
    relevanceScore: 0,
    matchTypeScore: 0,
    negativeKeywordsScore: 0,
    totalKeywords: 0,
    negativeKeywordsCount: 0,
    matchTypeDistribution: {},
  }
}

function getDefaultBasicConfig(): ScoreAnalysis['basicConfig'] {
  return {
    score: 0,
    countryLanguageScore: 0,
    finalUrlScore: 0,
    budgetScore: 0,
    targetCountry: '',
    targetLanguage: '',
    finalUrl: '',
    dailyBudget: 0,
    maxCpc: 0,
  }
}
