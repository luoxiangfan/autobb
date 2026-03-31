/**
 * 描述焦点类型分类器
 *
 * 将描述分类为4种焦点类型：Value、Action、Feature、Proof
 * 验证4条描述是否覆盖所有焦点类型
 * 验证每条描述是否包含CTA
 */

export type DescriptionFocus = 'Value' | 'Action' | 'Feature' | 'Proof'

export interface DescriptionClassification {
  description: string
  focus: DescriptionFocus | null
  confidence: number
  hasCTA: boolean
  ctaWords: string[]
  reasoning: string
}

export interface FocusCoverageReport {
  coverage: Record<DescriptionFocus, number>
  isSatisfied: boolean
  missing: DescriptionFocus[]
  ctaValidation: Record<number, boolean>
  ctaMissing: number[]
  recommendations: string[]
  details: DescriptionClassification[]
}

/**
 * 描述焦点分类规则
 */
const FOCUS_PATTERNS: Record<DescriptionFocus, { keywords: string[]; patterns: RegExp[] }> = {
  Value: {
    keywords: ['award', 'rated', 'stars', 'customers', 'reviews', 'trusted', 'popular', 'best', 'excellent', 'quality', 'premium', 'proven', 'reliable'],
    patterns: [
      /\d+\.\d+\s*stars?/i,
      /\d+[kK]\+?\s+customers?/i,
      /\d+[kK]\+?\s+reviews?/i,
      /award.*winning/i,
      /highly\s+rated/i,
      /trusted\s+by/i
    ]
  },
  Action: {
    keywords: ['shop', 'buy', 'order', 'get', 'claim', 'discover', 'learn', 'start', 'try', 'explore', 'find', 'grab', 'secure', 'fast', 'free', 'easy', 'simple'],
    patterns: [
      /shop\s+now/i,
      /buy\s+now/i,
      /order\s+now/i,
      /get\s+\w+/i,
      /claim\s+\w+/i,
      /fast\s+delivery/i,
      /free\s+shipping/i,
      /easy\s+returns?/i
    ]
  },
  Feature: {
    keywords: ['technology', 'design', 'performance', 'quality', 'feature', 'specification', 'power', 'speed', 'capacity', 'efficiency', 'advanced', 'smart', 'intelligent', 'innovative'],
    patterns: [
      /\d+[kK]\s+resolution/i,
      /\d+\s*hour.*battery/i,
      /smart\s+\w+/i,
      /advanced\s+\w+/i,
      /\w+\s+technology/i,
      /\w+\s+performance/i,
      /weather.*resistant/i,
      /solar\s+powered/i
    ]
  },
  Proof: {
    keywords: ['trusted', 'guarantee', 'promise', 'money.*back', 'warranty', 'certified', 'verified', 'proven', 'authentic', 'official', 'authorized', 'secure', 'safe'],
    patterns: [
      /\d+.*day.*money.*back/i,
      /guarantee/i,
      /warranty/i,
      /certified/i,
      /verified/i,
      /trusted\s+by/i,
      /proven\s+\w+/i,
      /secure\s+\w+/i
    ]
  }
}

/**
 * CTA词汇列表
 */
const CTA_KEYWORDS = [
  'shop', 'buy', 'order', 'get', 'claim', 'discover', 'learn', 'start', 'try', 'explore',
  'find', 'grab', 'secure', 'purchase', 'subscribe', 'download', 'join', 'sign', 'register',
  'reserve', 'book', 'schedule', 'contact', 'call', 'visit', 'check', 'see', 'view'
]

const CTA_REGEX = new RegExp(CTA_KEYWORDS.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')

/**
 * 检查描述是否包含CTA
 */
export function hasCTA(description: string): { hasCTA: boolean; ctaWords: string[] } {
  const lowerDesc = description.toLowerCase()
  const matches = lowerDesc.match(CTA_REGEX)
  const foundCTAs = matches ? Array.from(new Set(matches)) : []

  return {
    hasCTA: foundCTAs.length > 0,
    ctaWords: foundCTAs
  }
}

/**
 * 分类单个描述
 */
export function classifyDescription(description: string): DescriptionClassification {
  let bestFocus: DescriptionFocus | null = null
  let maxScore = 0
  let reasoning = ''

  for (const [focus, { keywords, patterns }] of Object.entries(FOCUS_PATTERNS)) {
    let focusScore = 0
    let focusReasoning = ''

    // 检查关键词匹配
    const matchedKeywords = keywords.filter(kw =>
      description.toLowerCase().includes(kw.toLowerCase())
    )
    if (matchedKeywords.length > 0) {
      focusScore += matchedKeywords.length * 0.3
      focusReasoning += `Keywords: ${matchedKeywords.join(', ')}. `
    }

    // 检查模式匹配
    const matchedPatterns = patterns.filter(pattern => pattern.test(description))
    if (matchedPatterns.length > 0) {
      focusScore += matchedPatterns.length * 0.4
      focusReasoning += `Patterns: ${matchedPatterns.length} matched. `
    }

    // 更新最佳焦点
    if (focusScore > maxScore) {
      maxScore = focusScore
      bestFocus = focus as DescriptionFocus
      reasoning = focusReasoning
    }
  }

  const { hasCTA: ctaPresent, ctaWords } = hasCTA(description)
  const confidence = Math.min(1, maxScore)

  return {
    description,
    focus: bestFocus,
    confidence,
    hasCTA: ctaPresent,
    ctaWords,
    reasoning: reasoning || 'No clear focus classification'
  }
}

/**
 * 验证描述焦点覆盖
 * 要求：Value(1) + Action(1) + Feature(1) + Proof(1) = 4条
 * 同时验证每条都有CTA
 */
export function validateFocusCoverage(descriptions: string[]): FocusCoverageReport {
  const classifications = descriptions.map(classifyDescription)

  // 统计每种焦点的数量
  const coverage: Record<DescriptionFocus, number> = {
    Value: 0,
    Action: 0,
    Feature: 0,
    Proof: 0
  }

  for (const classification of classifications) {
    if (classification.focus) {
      coverage[classification.focus]++
    }
  }

  // 检查是否满足焦点覆盖要求
  const focusRequirements: Record<DescriptionFocus, number> = {
    Value: 1,
    Action: 1,
    Feature: 1,
    Proof: 1
  }

  const missing: DescriptionFocus[] = []
  for (const [focus, required] of Object.entries(focusRequirements)) {
    if (coverage[focus as DescriptionFocus] < required) {
      missing.push(focus as DescriptionFocus)
    }
  }

  // 检查CTA覆盖
  const ctaValidation: Record<number, boolean> = {}
  const ctaMissing: number[] = []

  for (let i = 0; i < classifications.length; i++) {
    ctaValidation[i] = classifications[i].hasCTA
    if (!classifications[i].hasCTA) {
      ctaMissing.push(i)
    }
  }

  const isSatisfied = missing.length === 0 && ctaMissing.length === 0

  // 生成建议
  const recommendations: string[] = []

  if (missing.length > 0) {
    for (const focus of missing) {
      recommendations.push(`Missing ${focus} focus description`)
    }
  }

  if (ctaMissing.length > 0) {
    for (const idx of ctaMissing) {
      recommendations.push(`Description ${idx + 1} is missing CTA`)
    }
  }

  return {
    coverage,
    isSatisfied,
    missing,
    ctaValidation,
    ctaMissing,
    recommendations,
    details: classifications
  }
}

/**
 * 获取缺失焦点的建议描述
 */
export function suggestDescriptionsForMissingFocus(
  missingFocus: DescriptionFocus[],
  brandName: string,
  productFeatures: string[] = [],
  socialProof?: { rating: number; reviewCount: number }
): Record<DescriptionFocus, string[]> {
  const suggestions: Record<DescriptionFocus, string[]> = {
    Value: [],
    Action: [],
    Feature: [],
    Proof: []
  }

  for (const focus of missingFocus) {
    switch (focus) {
      case 'Value':
        if (socialProof) {
          suggestions.Value = [
            `Award-Winning ${brandName}. Rated ${socialProof.rating} stars by ${socialProof.reviewCount}+ customers. Shop Now`,
            `Trusted by ${socialProof.reviewCount}+ Happy Customers. ${socialProof.rating}/5 Stars. Get Yours Today`,
            `Premium Quality. ${socialProof.reviewCount}+ Positive Reviews. Discover More`
          ]
        } else {
          suggestions.Value = [
            `Premium Quality ${brandName}. Highly Rated by Customers. Shop Now`,
            `Trusted Brand. Excellent Customer Reviews. Get Yours Today`,
            `Award-Winning Design. Customer Favorite. Discover More`
          ]
        }
        break

      case 'Action':
        suggestions.Action = [
          `Shop Now for Fast, Free Delivery. Easy Returns Guaranteed. Order Today`,
          `Get ${brandName} Today. Quick Checkout. Free Shipping Available. Buy Now`,
          `Claim Your ${brandName} Now. Simple Process. Start Using Today`
        ]
        break

      case 'Feature':
        if (productFeatures.length > 0) {
          suggestions.Feature = [
            `${productFeatures[0]}. ${productFeatures[1] || 'Premium Quality'}. Advanced Technology. Learn More`,
            `Featuring ${productFeatures[0]}. Smart Design. Innovative Features. Discover More`,
            `${productFeatures[0]}. ${productFeatures[1] || 'Eco-Friendly'}. Built to Last. Explore More`
          ]
        } else {
          suggestions.Feature = [
            `Advanced Technology. Premium Design. Smart Features. Learn More`,
            `Innovative Solution. High Performance. Quality Crafted. Discover More`,
            `Cutting-Edge Features. Reliable Performance. Built to Last. Explore More`
          ]
        }
        break

      case 'Proof':
        suggestions.Proof = [
          `Trusted by Thousands. 30-Day Money-Back Guarantee. Secure Your Purchase Today`,
          `Certified Quality. Verified by Customers. 100% Satisfaction Promise. Order Now`,
          `Official ${brandName} Product. Authentic Guarantee. Secure Checkout. Buy Today`
        ]
        break
    }
  }

  return suggestions
}

/**
 * 生成焦点覆盖报告的摘要
 */
export function generateFocusCoverageSummary(report: FocusCoverageReport): string {
  const lines: string[] = []

  lines.push('=== Description Focus Coverage Report ===')
  lines.push('')

  lines.push('Focus Coverage:')
  for (const [focus, count] of Object.entries(report.coverage)) {
    const required = 1
    const status = count >= required ? '✅' : '❌'
    lines.push(`  ${status} ${focus}: ${count}/${required}`)
  }

  lines.push('')
  lines.push('CTA Validation:')
  for (let i = 0; i < Object.keys(report.ctaValidation).length; i++) {
    const hasCTA = report.ctaValidation[i]
    const status = hasCTA ? '✅' : '❌'
    lines.push(`  ${status} Description ${i + 1}: ${hasCTA ? 'Has CTA' : 'Missing CTA'}`)
  }

  lines.push('')
  lines.push(`Status: ${report.isSatisfied ? '✅ SATISFIED' : '❌ NOT SATISFIED'}`)

  if (report.missing.length > 0) {
    lines.push('')
    lines.push('Missing Focus Types:')
    for (const focus of report.missing) {
      lines.push(`  - ${focus}`)
    }
  }

  if (report.ctaMissing.length > 0) {
    lines.push('')
    lines.push('Descriptions Missing CTA:')
    for (const idx of report.ctaMissing) {
      lines.push(`  - Description ${idx + 1}`)
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
