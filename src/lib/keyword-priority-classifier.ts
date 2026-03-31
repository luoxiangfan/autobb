/**
 * 关键词优先级分类器
 *
 * 将关键词分类为4种优先级：Brand、Core、Intent、LongTail
 * 验证20-30个关键词是否满足优先级分布要求
 */

import type { Offer } from './offers'

export type KeywordPriority = 'Brand' | 'Core' | 'Intent' | 'LongTail'

export interface KeywordPriorityClassification {
  keyword: string
  priority: KeywordPriority
  confidence: number
  reasoning: string
  searchVolume?: number
}

export interface PriorityDistributionReport {
  distribution: Record<KeywordPriority, number>
  expected: Record<KeywordPriority, [number, number]>  // [min, max]
  isSatisfied: boolean
  missing: KeywordPriority[]
  excess: KeywordPriority[]
  recommendations: string[]
  details: KeywordPriorityClassification[]
}

/**
 * 优先级分布要求
 */
const PRIORITY_REQUIREMENTS: Record<KeywordPriority, [number, number]> = {
  Brand: [8, 10],
  Core: [6, 8],
  Intent: [3, 5],
  LongTail: [3, 7]
}

/**
 * 关键词优先级分类规则
 */
const PRIORITY_PATTERNS: Record<KeywordPriority, { keywords: string[]; patterns: RegExp[] }> = {
  Brand: {
    keywords: ['brand', 'official', 'store', 'shop', 'amazon', 'ebay'],
    patterns: [
      /^[a-z]+\s+brand$/i,
      /^[a-z]+\s+official$/i,
      /^[a-z]+\s+store$/i,
      /^[a-z]+\s+shop$/i
    ]
  },
  Core: {
    keywords: ['product', 'category', 'type', 'model', 'version'],
    patterns: [
      /^[a-z]+\s+[a-z]+$/i,  // 两个单词
      /^[a-z]+\s+[a-z]+\s+[a-z]+$/i  // 三个单词
    ]
  },
  Intent: {
    keywords: ['best', 'cheap', 'affordable', 'buy', 'price', 'sale', 'discount', 'deal', 'compare', 'vs'],
    patterns: [
      /best\s+\w+/i,
      /cheap\s+\w+/i,
      /affordable\s+\w+/i,
      /\w+\s+for\s+\w+/i,
      /\w+\s+vs\s+\w+/i
    ]
  },
  LongTail: {
    keywords: ['specific', 'detailed', 'long', 'phrase', 'question'],
    patterns: [
      /\w+\s+\w+\s+\w+\s+\w+/i,  // 4个或更多单词
      /\w+\s+with\s+\w+/i,
      /\w+\s+for\s+\w+\s+\w+/i,
      /how\s+to\s+\w+/i,
      /best\s+\w+\s+for\s+\w+/i
    ]
  }
}

/**
 * 分类单个关键词
 */
export function classifyKeywordPriority(
  keyword: string,
  offer?: Offer
): KeywordPriorityClassification {
  const lowerKeyword = keyword.toLowerCase().trim()
  const wordCount = lowerKeyword.split(/\s+/).length

  let bestPriority: KeywordPriority = 'LongTail'
  let maxScore = 0
  let reasoning = ''

  // 首先检查是否是品牌词
  if (offer?.brand) {
    const brandLower = offer.brand.toLowerCase()
    if (lowerKeyword.includes(brandLower)) {
      return {
        keyword,
        priority: 'Brand',
        confidence: 0.95,
        reasoning: `Contains brand name: ${offer.brand}`
      }
    }
  }

  // 然后按优先级分类
  for (const [priority, { keywords, patterns }] of Object.entries(PRIORITY_PATTERNS)) {
    let priorityScore = 0
    let priorityReasoning = ''

    // 检查关键词匹配
    const matchedKeywords = keywords.filter(kw =>
      lowerKeyword.includes(kw.toLowerCase())
    )
    if (matchedKeywords.length > 0) {
      priorityScore += matchedKeywords.length * 0.2
      priorityReasoning += `Keywords: ${matchedKeywords.join(', ')}. `
    }

    // 检查模式匹配
    const matchedPatterns = patterns.filter(pattern => pattern.test(keyword))
    if (matchedPatterns.length > 0) {
      priorityScore += matchedPatterns.length * 0.3
      priorityReasoning += `Patterns: ${matchedPatterns.length} matched. `
    }

    // 基于单词数的启发式规则
    if (priority === 'Core' && wordCount === 2) {
      priorityScore += 0.3
      priorityReasoning += 'Two-word keyword (Core pattern). '
    } else if (priority === 'Intent' && wordCount === 3) {
      priorityScore += 0.2
      priorityReasoning += 'Three-word keyword (Intent pattern). '
    } else if (priority === 'LongTail' && wordCount >= 5) {
      // LongTail 需要5+个词才加分，避免与4词Intent冲突
      priorityScore += 0.3
      priorityReasoning += 'Long-tail keyword (5+ words). '
    }

    if (priorityScore > maxScore) {
      maxScore = priorityScore
      bestPriority = priority as KeywordPriority
      reasoning = priorityReasoning
    }
  }

  const confidence = Math.min(1, maxScore)

  return {
    keyword,
    priority: bestPriority,
    confidence,
    reasoning: reasoning || 'Default classification'
  }
}

/**
 * 验证关键词优先级分布
 * 要求：Brand(8-10) + Core(6-8) + Intent(3-5) + LongTail(3-7) = 20-30个
 */
export function validatePriorityDistribution(
  keywords: Array<{ keyword: string; searchVolume?: number }>,
  offer?: Offer
): PriorityDistributionReport {
  const classifications = keywords.map(kw =>
    classifyKeywordPriority(kw.keyword, offer)
  )

  // 统计每个优先级的数量
  const distribution: Record<KeywordPriority, number> = {
    Brand: 0,
    Core: 0,
    Intent: 0,
    LongTail: 0
  }

  for (const classification of classifications) {
    distribution[classification.priority]++
  }

  // 检查是否满足要求
  const missing: KeywordPriority[] = []
  const excess: KeywordPriority[] = []

  for (const [priority, [min, max]] of Object.entries(PRIORITY_REQUIREMENTS)) {
    const count = distribution[priority as KeywordPriority]
    if (count < min) {
      missing.push(priority as KeywordPriority)
    }
    if (count > max) {
      excess.push(priority as KeywordPriority)
    }
  }

  const isSatisfied = missing.length === 0 && excess.length === 0

  // 生成建议
  const recommendations: string[] = []

  if (missing.length > 0) {
    for (const priority of missing) {
      const [min, max] = PRIORITY_REQUIREMENTS[priority]
      const current = distribution[priority]
      recommendations.push(
        `Need ${min - current} more ${priority} keyword(s). Current: ${current}, Required: ${min}-${max}`
      )
    }
  }

  if (excess.length > 0) {
    for (const priority of excess) {
      const [min, max] = PRIORITY_REQUIREMENTS[priority]
      const current = distribution[priority]
      recommendations.push(
        `Too many ${priority} keywords. Current: ${current}, Max: ${max}. Consider removing ${current - max}`
      )
    }
  }

  // 总数检查
  const totalCount = Object.values(distribution).reduce((a, b) => a + b, 0)
  if (totalCount < 20) {
    recommendations.push(`Total keywords: ${totalCount}. Need at least 20 keywords`)
  }
  if (totalCount > 30) {
    recommendations.push(`Total keywords: ${totalCount}. Should not exceed 30 keywords`)
  }

  return {
    distribution,
    expected: PRIORITY_REQUIREMENTS,
    isSatisfied,
    missing,
    excess,
    recommendations,
    details: classifications
  }
}

/**
 * 获取缺失优先级的建议关键词
 */
export function suggestKeywordsForMissingPriority(
  missingPriorities: KeywordPriority[],
  brandName: string,
  productCategory: string,
  productFeatures: string[] = []
): Record<KeywordPriority, string[]> {
  const suggestions: Record<KeywordPriority, string[]> = {
    Brand: [],
    Core: [],
    Intent: [],
    LongTail: []
  }

  for (const priority of missingPriorities) {
    switch (priority) {
      case 'Brand':
        suggestions.Brand = [
          brandName.toLowerCase(),
          `${brandName.toLowerCase()} official`,
          `${brandName.toLowerCase()} store`,
          `${brandName.toLowerCase()} shop`,
          `buy ${brandName.toLowerCase()}`,
          `${brandName.toLowerCase()} online`,
          `${brandName.toLowerCase()} amazon`,
          `${brandName.toLowerCase()} authentic`
        ]
        break

      case 'Core':
        suggestions.Core = [
          productCategory.toLowerCase(),
          `${productCategory.toLowerCase()} online`,
          `buy ${productCategory.toLowerCase()}`,
          `${productCategory.toLowerCase()} store`,
          `best ${productCategory.toLowerCase()}`,
          `${productCategory.toLowerCase()} shop`,
          `${productCategory.toLowerCase()} price`,
          `${productCategory.toLowerCase()} sale`
        ]
        break

      case 'Intent':
        suggestions.Intent = [
          `best ${productCategory}`,
          `cheap ${productCategory}`,
          `affordable ${productCategory}`,
          `${productCategory} for sale`,
          `${productCategory} discount`,
          `${productCategory} deal`,
          `${productCategory} vs`,
          `${productCategory} comparison`
        ]
        break

      case 'LongTail':
        if (productFeatures.length > 0) {
          suggestions.LongTail = [
            `${productCategory} with ${productFeatures[0]}`,
            `best ${productCategory} for ${productFeatures[0]}`,
            `${productCategory} for ${productFeatures[0]} users`,
            `affordable ${productCategory} with ${productFeatures[0]}`,
            `${productCategory} ${productFeatures[0]} online`,
            `buy ${productCategory} with ${productFeatures[0]}`,
            `${productCategory} ${productFeatures[0]} sale`
          ]
        } else {
          suggestions.LongTail = [
            `${productCategory} for home use`,
            `${productCategory} for professionals`,
            `${productCategory} for beginners`,
            `${productCategory} for small spaces`,
            `${productCategory} with warranty`,
            `${productCategory} with free shipping`,
            `${productCategory} easy to use`
          ]
        }
        break
    }
  }

  return suggestions
}

/**
 * 生成优先级分布报告的摘要
 */
export function generatePriorityDistributionSummary(report: PriorityDistributionReport): string {
  const lines: string[] = []

  lines.push('=== Keyword Priority Distribution Report ===')
  lines.push('')

  lines.push('Distribution:')
  for (const [priority, [min, max]] of Object.entries(report.expected)) {
    const count = report.distribution[priority as KeywordPriority]
    const status = count >= min && count <= max ? '✅' : '❌'
    lines.push(`  ${status} ${priority}: ${count}/${min}-${max}`)
  }

  lines.push('')
  const totalCount = Object.values(report.distribution).reduce((a, b) => a + b, 0)
  const totalStatus = totalCount >= 20 && totalCount <= 30 ? '✅' : '❌'
  lines.push(`${totalStatus} Total: ${totalCount}/20-30`)

  lines.push('')
  lines.push(`Status: ${report.isSatisfied ? '✅ SATISFIED' : '❌ NOT SATISFIED'}`)

  if (report.missing.length > 0) {
    lines.push('')
    lines.push('Missing Priorities:')
    for (const priority of report.missing) {
      lines.push(`  - ${priority}`)
    }
  }

  if (report.excess.length > 0) {
    lines.push('')
    lines.push('Excess Priorities:')
    for (const priority of report.excess) {
      lines.push(`  - ${priority}`)
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

// ============================================
// 🆕 P1-2优化：关键词购买意图强度评分
// ============================================

/**
 * 购买意图信号词及对应分数
 * 分数范围: 0-100
 * - 高购买意图 (80-100): buy, purchase, order, shop, get, need
 * - 中等购买意图 (50-79): price, cost, deal, discount, best, top, cheap, affordable
 * - 低购买意图 (20-49): review, compare, vs, alternative
 * - 信息查询意图 (0-19): how to, what is, tutorial, guide
 */
const INTENT_SIGNALS: Record<string, number> = {
  // 高购买意图 (80-100)
  'buy': 95,
  'purchase': 95,
  'order': 90,
  'shop': 85,
  'get': 80,
  'need': 80,

  // 中等购买意图 (50-79)
  'price': 70,
  'cost': 70,
  'deal': 65,
  'discount': 60,
  'coupon': 60,
  'promo': 55,
  'best': 55,
  'top': 55,
  'cheap': 50,
  'affordable': 50,
  'sale': 50,

  // 低购买意图 (20-49)
  'review': 35,
  'reviews': 35,
  'compare': 30,
  'comparison': 30,
  'vs': 25,
  'versus': 25,
  'alternative': 25,
  'alternatives': 25,
  'rating': 25,
  'ratings': 25,

  // 信息查询意图 (0-19)
  'how to': 10,
  'what is': 5,
  'tutorial': 5,
  'guide': 5,
  'learn': 5,
  'help': 5,
  'setup': 10,
  'install': 10
}

/**
 * 计算关键词的购买意图强度
 *
 * @param keyword - 关键词
 * @param brandName - 品牌名称（可选，用于品牌词检测）
 * @returns 0-100的意图分数
 *
 * @example
 * calculateIntentScore('buy reolink camera') // → 95 (高购买意图)
 * calculateIntentScore('reolink camera', 'Reolink') // → 85 (品牌+产品词)
 * calculateIntentScore('reolink', 'Reolink') // → 75 (品牌词)
 * calculateIntentScore('security camera') // → 55 (通用产品词)
 * calculateIntentScore('best security camera') // → 55 (中等意图)
 * calculateIntentScore('reolink camera review') // → 35 (低意图)
 * calculateIntentScore('how to install camera') // → 10 (信息查询)
 */
export function calculateIntentScore(keyword: string, brandName?: string): number {
  const kwLower = keyword.toLowerCase()
  let maxScore = 40  // 默认中等意图

  // 🔥 优化(2025-12-17): 品牌词和产品词隐性购买意图识别
  // 问题：品牌词"reolink"和产品词"security camera"都被评为40分（低购买意图）
  // 真实情况：品牌词本身就是高购买意图（用户已认品牌），产品词是中等购买意图

  // 1. 品牌词检测（高购买意图 75-85分）
  if (brandName) {
    const brandLower = brandName.toLowerCase()
    if (kwLower.includes(brandLower)) {
      maxScore = 75  // 品牌词基础分（高购买意图）

      // 品牌+产品组合词（更高购买意图 85分）
      const productIndicators = [
        'camera', 'security', 'system', 'doorbell', 'nvr', 'monitor',
        'sensor', 'alarm', 'detector', 'device', 'kit', 'set'
      ]
      if (productIndicators.some(p => kwLower.includes(p))) {
        maxScore = 85  // 品牌+产品词（明确购买目标）
      }
    }
  }

  // 2. 通用产品名词检测（中等购买意图 55分）
  // 用户搜索具体产品，表明有购买需求，但未定品牌
  const productNouns = [
    'camera', 'doorbell', 'system', 'monitor', 'sensor', 'alarm',
    'detector', 'nvr', 'dvr', 'recorder', 'security', 'surveillance'
  ]
  if (productNouns.some(p => kwLower.includes(p))) {
    maxScore = Math.max(maxScore, 55)  // 通用产品词（中等购买意图）
  }

  // 3. 显性购买信号词检测（原有逻辑）
  for (const [signal, score] of Object.entries(INTENT_SIGNALS)) {
    if (kwLower.includes(signal)) {
      maxScore = Math.max(maxScore, score)
    }
  }

  return maxScore
}

/**
 * 批量计算关键词意图分数并排序
 *
 * 排序规则：意图分数 * log10(搜索量+1)
 * 这样既考虑购买意图，也考虑搜索量
 *
 * @param keywords - 关键词数组（带搜索量）
 * @param brandName - 品牌名称（品牌词优先）
 * @returns 排序后的关键词数组（带意图分数）
 */
export function sortKeywordsByIntent<T extends { keyword: string; searchVolume?: number }>(
  keywords: T[],
  brandName?: string
): Array<T & { intentScore: number }> {
  const brandLower = brandName?.toLowerCase()

  const keywordsWithIntent = keywords.map(kw => ({
    ...kw,
    intentScore: calculateIntentScore(kw.keyword, brandName)  // 🔧 修复：传入brandName
  }))

  keywordsWithIntent.sort((a, b) => {
    // 1. 品牌词优先
    if (brandLower) {
      const aIsBrand = a.keyword.toLowerCase().includes(brandLower) ? 1 : 0
      const bIsBrand = b.keyword.toLowerCase().includes(brandLower) ? 1 : 0
      if (aIsBrand !== bIsBrand) {
        return bIsBrand - aIsBrand
      }
    }

    // 2. 意图强度 * log10(搜索量+1) 综合评分
    const aScore = a.intentScore * Math.log10((a.searchVolume || 0) + 1)
    const bScore = b.intentScore * Math.log10((b.searchVolume || 0) + 1)
    return bScore - aScore
  })

  return keywordsWithIntent
}

/**
 * 获取意图强度等级描述
 */
export function getIntentLevel(score: number): {
  level: 'high' | 'medium' | 'low' | 'informational'
  label: string
  color: string
} {
  if (score >= 80) {
    return { level: 'high', label: '高购买意图', color: 'green' }
  } else if (score >= 50) {
    return { level: 'medium', label: '中等意图', color: 'amber' }
  } else if (score >= 20) {
    return { level: 'low', label: '低购买意图', color: 'orange' }
  } else {
    return { level: 'informational', label: '信息查询', color: 'gray' }
  }
}
