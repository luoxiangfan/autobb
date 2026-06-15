/**
 * Ad Strength评估器 - 本地评估算法
 *
 * 基于Google Ads Ad Strength标准的7维度评分系统（优化版）：
 * 1. Diversity (18%) - 资产多样性
 * 2. Relevance (22%) - 关键词相关性
 * 3. Brand Search Volume (18%) - 品牌搜索量
 * 4. Completeness (10%) - 资产完整性
 * 5. Quality (14%) - 内容质量
 * 6. Compliance (8%) - 政策合规性
 * 7. Competitive Positioning (10%) - 竞争定位
 *
 * 输出：0-100分 + POOR/AVERAGE/GOOD/EXCELLENT评级
 */

export type { AdStrengthRating, AdStrengthEvaluation } from './ad-strength/types'
export { parseCompetitivePositioningAiScores } from './ad-strength/competitive-positioning-ai-parse'
export { evaluateAdStrength, __testOnly } from './ad-strength/evaluate'
