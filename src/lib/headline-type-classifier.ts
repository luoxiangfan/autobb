/**
 * 标题类型分类器
 *
 * 将标题分类为5种类型：Brand、Feature、Promo、CTA、Urgency
 * 验证15条标题是否覆盖所有类型
 */

export type HeadlineType = 'Brand' | 'Feature' | 'Promo' | 'CTA' | 'Urgency'

export interface HeadlineClassification {
  headline: string
  types: HeadlineType[]
  confidence: number
  reasoning: string
}

export interface TypeCoverageReport {
  coverage: Record<HeadlineType, number>
  isSatisfied: boolean
  missing: HeadlineType[]
  recommendations: string[]
  details: HeadlineClassification[]
}

/**
 * 标题类型分类规则
 */
const TYPE_PATTERNS: Record<HeadlineType, { keywords: string[]; patterns: RegExp[] }> = {
  Brand: {
    keywords: ['official', 'trusted', '#1', 'authentic', 'genuine', 'original', 'authorized', 'certified'],
    patterns: [
      /official\s+\w+/i,
      /#1\s+\w+/i,
      /trusted\s+\w+/i,
      /authentic\s+\w+/i,
      /\w+\s+store/i,
      /\w+\s+official/i
    ]
  },
  Feature: {
    keywords: ['resolution', 'battery', 'navigation', 'design', 'technology', 'performance', 'quality', 'advanced', 'smart', 'intelligent', 'power', 'speed', 'capacity', 'efficiency'],
    patterns: [
      /\d+[kK]\s+resolution/i,
      /\d+\s*hour.*battery/i,
      /smart\s+\w+/i,
      /advanced\s+\w+/i,
      /\w+\s+technology/i,
      /\w+\s+performance/i
    ]
  },
  Promo: {
    keywords: ['save', 'discount', 'offer', 'free', 'deal', 'sale', 'promotion', 'special', 'limited', 'exclusive', 'bonus', 'extra', 'reduced', 'off'],
    patterns: [
      /save\s+\d+%/i,
      /\d+%\s+off/i,
      /free\s+\w+/i,
      /special\s+offer/i,
      /limited\s+offer/i,
      /exclusive\s+deal/i
    ]
  },
  CTA: {
    keywords: ['shop', 'buy', 'get', 'claim', 'order', 'purchase', 'discover', 'learn', 'start', 'try', 'explore', 'find', 'grab', 'secure'],
    patterns: [
      /shop\s+now/i,
      /buy\s+now/i,
      /get\s+\w+/i,
      /claim\s+\w+/i,
      /order\s+now/i,
      /discover\s+\w+/i
    ]
  },
  Urgency: {
    keywords: ['limited', 'only', 'ends', 'today', 'tomorrow', 'soon', 'hurry', 'rush', 'quick', 'fast', 'last', 'final', 'remaining', 'left', 'stock'],
    patterns: [
      /only\s+\d+\s+left/i,
      /limited\s+time/i,
      /ends\s+\w+/i,
      /hurry/i,
      /\d+\s+left\s+in\s+stock/i,
      /last\s+\w+/i
    ]
  }
}

/**
 * 分类单个标题
 */
export function classifyHeadline(headline: string): HeadlineClassification {
  const types: HeadlineType[] = []
  let maxConfidence = 0
  let reasoning = ''

  for (const [type, { keywords, patterns }] of Object.entries(TYPE_PATTERNS)) {
    let typeScore = 0
    let typeReasoning = ''

    // 检查关键词匹配
    const matchedKeywords = keywords.filter(kw =>
      headline.toLowerCase().includes(kw.toLowerCase())
    )
    if (matchedKeywords.length > 0) {
      typeScore += matchedKeywords.length * 0.3
      typeReasoning += `Keywords: ${matchedKeywords.join(', ')}. `
    }

    // 检查模式匹配
    const matchedPatterns = patterns.filter(pattern => pattern.test(headline))
    if (matchedPatterns.length > 0) {
      typeScore += matchedPatterns.length * 0.4
      typeReasoning += `Patterns: ${matchedPatterns.length} matched. `
    }

    // 如果得分达到阈值，添加到类型列表
    if (typeScore >= 0.3) {  // 修复: 从 > 改为 >=，允许刚好0.3的分数
      types.push(type as HeadlineType)
      if (typeScore > maxConfidence) {
        maxConfidence = typeScore
        reasoning = typeReasoning
      }
    }
  }

  // 如果没有匹配到任何类型，返回空类型列表
  const confidence = Math.min(1, maxConfidence)

  return {
    headline,
    types: types.length > 0 ? types : [],
    confidence,
    reasoning: reasoning || 'No clear type classification'
  }
}

/**
 * 验证标题类型覆盖
 * 要求：Brand(2) + Feature(4) + Promo(3) + CTA(3) + Urgency(2) = 15条
 */
export function validateTypeCoverage(headlines: string[]): TypeCoverageReport {
  const classifications = headlines.map(classifyHeadline)

  // 统计每种类型的数量
  const coverage: Record<HeadlineType, number> = {
    Brand: 0,
    Feature: 0,
    Promo: 0,
    CTA: 0,
    Urgency: 0
  }

  for (const classification of classifications) {
    for (const type of classification.types) {
      coverage[type]++
    }
  }

  // 检查是否满足要求
  const requirements: Record<HeadlineType, number> = {
    Brand: 2,
    Feature: 4,
    Promo: 3,
    CTA: 3,
    Urgency: 2
  }

  const missing: HeadlineType[] = []
  for (const [type, required] of Object.entries(requirements)) {
    if (coverage[type as HeadlineType] < required) {
      missing.push(type as HeadlineType)
    }
  }

  const isSatisfied = missing.length === 0

  // 生成建议
  const recommendations: string[] = []
  if (!isSatisfied) {
    for (const type of missing) {
      const current = coverage[type]
      const required = requirements[type]
      recommendations.push(
        `Missing ${required - current} ${type} headline(s). Current: ${current}, Required: ${required}`
      )
    }
  }

  return {
    coverage,
    isSatisfied,
    missing,
    recommendations,
    details: classifications
  }
}

/**
 * 获取缺失类型的建议标题
 */
export function suggestHeadlinesForMissingTypes(
  missingTypes: HeadlineType[],
  brandName: string,
  productFeatures: string[] = []
): Record<HeadlineType, string[]> {
  const suggestions: Record<HeadlineType, string[]> = {
    Brand: [],
    Feature: [],
    Promo: [],
    CTA: [],
    Urgency: []
  }

  for (const type of missingTypes) {
    switch (type) {
      case 'Brand':
        suggestions.Brand = [
          `Official ${brandName} Store`,
          `#1 Trusted ${brandName}`,
          `Authentic ${brandName} Products`
        ]
        break

      case 'Feature':
        if (productFeatures.length > 0) {
          suggestions.Feature = productFeatures.slice(0, 3).map(feature =>
            `${feature} Technology`
          )
        } else {
          suggestions.Feature = [
            'Advanced Technology',
            'Premium Quality',
            'Smart Design'
          ]
        }
        break

      case 'Promo':
        suggestions.Promo = [
          'Special Offer Today',
          'Limited Time Deal',
          'Exclusive Discount'
        ]
        break

      case 'CTA':
        suggestions.CTA = [
          'Shop Now',
          'Get Yours Today',
          'Claim Your Deal'
        ]
        break

      case 'Urgency':
        suggestions.Urgency = [
          'Limited Stock Available',
          'Ends Tomorrow'
        ]
        break
    }
  }

  return suggestions
}

/**
 * 生成类型覆盖报告的摘要
 */
export function generateTypeCoverageSummary(report: TypeCoverageReport): string {
  const lines: string[] = []

  lines.push('=== Headline Type Coverage Report ===')
  lines.push('')

  lines.push('Coverage:')
  for (const [type, count] of Object.entries(report.coverage)) {
    const required = { Brand: 2, Feature: 4, Promo: 3, CTA: 3, Urgency: 2 }[type as HeadlineType]
    const status = count >= required ? '✅' : '❌'
    lines.push(`  ${status} ${type}: ${count}/${required}`)
  }

  lines.push('')
  lines.push(`Status: ${report.isSatisfied ? '✅ SATISFIED' : '❌ NOT SATISFIED'}`)

  if (report.missing.length > 0) {
    lines.push('')
    lines.push('Missing Types:')
    for (const type of report.missing) {
      lines.push(`  - ${type}`)
    }
  }

  if (report.recommendations.length > 0) {
    lines.push('')
    lines.push('Recommendations:')
    for (const rec of report.recommendations) {
      lines.push(`  - ${rec}`)
    }
  }

  return lines.join('\n')
}
