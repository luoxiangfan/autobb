/**
 * 质量指标计算器
 *
 * 计算标题的质量指标：
 * - 关键词密度：8+条含关键词 / 15条 ≥ 0.53
 * - 数字密度：5+条含数字 / 15条 ≥ 0.33
 * - 紧迫感：3+条含紧迫词 / 15条 ≥ 0.20
 * - 长度分布：5短 + 5中 + 5长
 */

export interface QualityMetrics {
  keywordDensity: number
  numberDensity: number
  urgencyDensity: number
  lengthDistribution: LengthDistribution
  overallScore: number
  recommendations: string[]
}

export interface LengthDistribution {
  short: number    // 10-20字符
  medium: number   // 20-25字符
  long: number     // 25-30字符
  isSatisfied: boolean
}

export interface QualityReport {
  headlines: string[]
  keywords: string[]
  metrics: QualityMetrics
  isHighQuality: boolean
  details: {
    headlinesWithKeywords: string[]
    headlinesWithNumbers: string[]
    headlinesWithUrgency: string[]
    headlinesByLength: Record<string, string[]>
  }
}

/**
 * 紧迫词列表
 */
const URGENCY_KEYWORDS = [
  'limited', 'only', 'ends', 'today', 'tomorrow', 'soon', 'hurry', 'rush',
  'quick', 'fast', 'last', 'final', 'remaining', 'left', 'stock', 'urgent',
  'now', 'immediately', 'asap', 'don\'t miss', 'act now', 'before', 'expires'
]

/**
 * 检查标题是否包含关键词
 */
export function hasKeyword(headline: string, keywords: string[]): boolean {
  const lowerHeadline = headline.toLowerCase()
  return keywords.some(kw => lowerHeadline.includes(kw.toLowerCase()))
}

/**
 * 检查标题是否包含数字
 */
export function hasNumber(headline: string): boolean {
  return /\d/.test(headline)
}

/**
 * 检查标题是否包含紧迫词
 */
export function hasUrgency(headline: string): boolean {
  const lowerHeadline = headline.toLowerCase()
  return URGENCY_KEYWORDS.some(word => lowerHeadline.includes(word))
}

/**
 * 获取标题的长度分类
 */
export function getHeadlineLengthCategory(headline: string): 'short' | 'medium' | 'long' {
  const length = headline.length
  if (length <= 20) return 'short'
  if (length <= 25) return 'medium'
  return 'long'
}

/**
 * 计算关键词密度
 * 要求：8+条含关键词 / 15条 ≥ 0.53
 */
export function calculateKeywordDensity(headlines: string[], keywords: string[]): number {
  if (headlines.length === 0) return 0

  const headlinesWithKeywords = headlines.filter(h => hasKeyword(h, keywords))
  return headlinesWithKeywords.length / headlines.length
}

/**
 * 计算数字密度
 * 要求：5+条含数字 / 15条 ≥ 0.33
 */
export function calculateNumberDensity(headlines: string[]): number {
  if (headlines.length === 0) return 0

  const headlinesWithNumbers = headlines.filter(h => hasNumber(h))
  return headlinesWithNumbers.length / headlines.length
}

/**
 * 计算紧迫感密度
 * 要求：3+条含紧迫词 / 15条 ≥ 0.20
 */
export function calculateUrgencyDensity(headlines: string[]): number {
  if (headlines.length === 0) return 0

  const headlinesWithUrgency = headlines.filter(h => hasUrgency(h))
  return headlinesWithUrgency.length / headlines.length
}

/**
 * 计算长度分布
 * 要求：5短(10-20) + 5中(20-25) + 5长(25-30)
 */
export function calculateLengthDistribution(headlines: string[]): LengthDistribution {
  const distribution = {
    short: 0,
    medium: 0,
    long: 0
  }

  for (const headline of headlines) {
    const category = getHeadlineLengthCategory(headline)
    distribution[category]++
  }

  // 检查是否满足要求（允许±1的偏差）
  const isSatisfied =
    Math.abs(distribution.short - 5) <= 1 &&
    Math.abs(distribution.medium - 5) <= 1 &&
    Math.abs(distribution.long - 5) <= 1

  return {
    ...distribution,
    isSatisfied
  }
}

/**
 * 计算总体质量分数（0-100）
 */
export function calculateOverallQualityScore(metrics: Omit<QualityMetrics, 'overallScore' | 'recommendations'>): number {
  let score = 0

  // 关键词密度：最多30分
  // 要求：≥0.53，满足得30分，每低0.1扣5分
  const keywordScore = Math.max(0, Math.min(30, (metrics.keywordDensity / 0.53) * 30))
  score += keywordScore

  // 数字密度：最多20分
  // 要求：≥0.33，满足得20分，每低0.1扣5分
  const numberScore = Math.max(0, Math.min(20, (metrics.numberDensity / 0.33) * 20))
  score += numberScore

  // 紧迫感：最多20分
  // 要求：≥0.20，满足得20分，每低0.05扣5分
  const urgencyScore = Math.max(0, Math.min(20, (metrics.urgencyDensity / 0.20) * 20))
  score += urgencyScore

  // 长度分布：最多30分
  // 完全满足得30分，每个偏差1扣5分
  const lengthDeviation =
    Math.abs(metrics.lengthDistribution.short - 5) +
    Math.abs(metrics.lengthDistribution.medium - 5) +
    Math.abs(metrics.lengthDistribution.long - 5)
  const lengthScore = Math.max(0, 30 - lengthDeviation * 5)
  score += lengthScore

  return Math.round(score)
}

/**
 * 生成质量改进建议
 */
export function generateQualityRecommendations(metrics: QualityMetrics): string[] {
  const recommendations: string[] = []

  // 关键词密度建议
  if (metrics.keywordDensity < 0.53) {
    const needed = Math.ceil(15 * 0.53) - Math.floor(15 * metrics.keywordDensity)
    recommendations.push(`Add keywords to ${needed} more headlines (current: ${Math.floor(15 * metrics.keywordDensity)}/8)`)
  }

  // 数字密度建议
  if (metrics.numberDensity < 0.33) {
    const needed = Math.ceil(15 * 0.33) - Math.floor(15 * metrics.numberDensity)
    recommendations.push(`Add numbers to ${needed} more headlines (current: ${Math.floor(15 * metrics.numberDensity)}/5)`)
  }

  // 紧迫感建议
  if (metrics.urgencyDensity < 0.20) {
    const needed = Math.ceil(15 * 0.20) - Math.floor(15 * metrics.urgencyDensity)
    recommendations.push(`Add urgency words to ${needed} more headlines (current: ${Math.floor(15 * metrics.urgencyDensity)}/3)`)
  }

  // 长度分布建议
  if (!metrics.lengthDistribution.isSatisfied) {
    const { short, medium, long } = metrics.lengthDistribution
    if (short < 4) {
      recommendations.push(`Add ${5 - short} more short headlines (10-20 chars)`)
    }
    if (medium < 4) {
      recommendations.push(`Add ${5 - medium} more medium headlines (20-25 chars)`)
    }
    if (long < 4) {
      recommendations.push(`Add ${5 - long} more long headlines (25-30 chars)`)
    }
  }

  return recommendations
}

/**
 * 计算完整的质量指标
 */
export function calculateQualityMetrics(
  headlines: string[],
  keywords: string[]
): QualityMetrics {
  const keywordDensity = calculateKeywordDensity(headlines, keywords)
  const numberDensity = calculateNumberDensity(headlines)
  const urgencyDensity = calculateUrgencyDensity(headlines)
  const lengthDistribution = calculateLengthDistribution(headlines)

  const metricsWithoutScore = {
    keywordDensity,
    numberDensity,
    urgencyDensity,
    lengthDistribution
  }

  const overallScore = calculateOverallQualityScore(metricsWithoutScore)
  const recommendations = generateQualityRecommendations({
    ...metricsWithoutScore,
    overallScore,
    recommendations: []
  })

  return {
    keywordDensity,
    numberDensity,
    urgencyDensity,
    lengthDistribution,
    overallScore,
    recommendations
  }
}

/**
 * 生成完整的质量报告
 */
export function generateQualityReport(
  headlines: string[],
  keywords: string[]
): QualityReport {
  const metrics = calculateQualityMetrics(headlines, keywords)

  // 收集详细信息
  const headlinesWithKeywords = headlines.filter(h => hasKeyword(h, keywords))
  const headlinesWithNumbers = headlines.filter(h => hasNumber(h))
  const headlinesWithUrgency = headlines.filter(h => hasUrgency(h))

  const headlinesByLength: Record<string, string[]> = {
    short: [],
    medium: [],
    long: []
  }

  for (const headline of headlines) {
    const category = getHeadlineLengthCategory(headline)
    headlinesByLength[category].push(headline)
  }

  // 判断是否高质量（总分≥70）
  const isHighQuality = metrics.overallScore >= 70

  return {
    headlines,
    keywords,
    metrics,
    isHighQuality,
    details: {
      headlinesWithKeywords,
      headlinesWithNumbers,
      headlinesWithUrgency,
      headlinesByLength
    }
  }
}

/**
 * 生成质量报告的摘要
 */
export function generateQualityReportSummary(report: QualityReport): string {
  const lines: string[] = []

  lines.push('=== Quality Metrics Report ===')
  lines.push('')

  lines.push(`Overall Score: ${report.metrics.overallScore}/100 ${report.isHighQuality ? '✅' : '⚠️'}`)
  lines.push('')

  lines.push('Metrics:')
  lines.push(`  Keyword Density: ${(report.metrics.keywordDensity * 100).toFixed(1)}% (target: ≥53%)`)
  lines.push(`    ${report.details.headlinesWithKeywords.length}/15 headlines contain keywords`)

  lines.push(`  Number Density: ${(report.metrics.numberDensity * 100).toFixed(1)}% (target: ≥33%)`)
  lines.push(`    ${report.details.headlinesWithNumbers.length}/15 headlines contain numbers`)

  lines.push(`  Urgency Density: ${(report.metrics.urgencyDensity * 100).toFixed(1)}% (target: ≥20%)`)
  lines.push(`    ${report.details.headlinesWithUrgency.length}/15 headlines contain urgency words`)

  lines.push(`  Length Distribution: ${report.metrics.lengthDistribution.isSatisfied ? '✅' : '⚠️'}`)
  lines.push(`    Short (10-20): ${report.metrics.lengthDistribution.short}/5`)
  lines.push(`    Medium (20-25): ${report.metrics.lengthDistribution.medium}/5`)
  lines.push(`    Long (25-30): ${report.metrics.lengthDistribution.long}/5`)

  if (report.metrics.recommendations.length > 0) {
    lines.push('')
    lines.push('Recommendations:')
    for (const rec of report.metrics.recommendations) {
      lines.push(`  - ${rec}`)
    }
  }

  lines.push('')
  lines.push('Headlines by Length:')
  lines.push(`  Short: ${report.details.headlinesByLength.short.join(', ')}`)
  lines.push(`  Medium: ${report.details.headlinesByLength.medium.join(', ')}`)
  lines.push(`  Long: ${report.details.headlinesByLength.long.join(', ')}`)

  return lines.join('\n')
}

/**
 * 检查质量是否满足最低要求
 */
export function meetsMinimumQualityStandard(report: QualityReport): boolean {
  // 最低要求：
  // - 关键词密度 ≥ 0.40（宽松要求）
  // - 数字密度 ≥ 0.20（宽松要求）
  // - 紧迫感 ≥ 0.13（宽松要求）
  // - 总分 ≥ 50

  return (
    report.metrics.keywordDensity >= 0.40 &&
    report.metrics.numberDensity >= 0.20 &&
    report.metrics.urgencyDensity >= 0.13 &&
    report.metrics.overallScore >= 50
  )
}
