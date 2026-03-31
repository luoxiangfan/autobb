/**
 * Prompt优化器
 * 基于实际投放数据和反馈，动态优化AI创意生成的Prompt
 */

interface OptimizationRule {
  id: string
  type: 'enhance' | 'avoid' | 'adjust'
  category: 'headline' | 'description' | 'callout' | 'general'
  rule: string
  reason: string
  impact: 'high' | 'medium' | 'low'
  source: 'performance_data' | 'user_feedback' | 'ab_test'
  createdAt: string
  enabled: boolean
}

interface PerformanceInsight {
  pattern: string
  avgCtr: number
  avgConversionRate: number
  sampleSize: number
  confidence: 'high' | 'medium' | 'low'
}

// 内存中的优化规则存储（实际应该存到数据库）
let optimizationRules: OptimizationRule[] = []
let performanceInsights: PerformanceInsight[] = []

/**
 * 添加优化规则
 */
export function addOptimizationRule(rule: Omit<OptimizationRule, 'id' | 'createdAt'>): OptimizationRule {
  const newRule: OptimizationRule = {
    ...rule,
    id: `opt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    createdAt: new Date().toISOString()
  }

  optimizationRules.push(newRule)
  return newRule
}

/**
 * 获取所有启用的优化规则
 */
export function getActiveOptimizationRules(): OptimizationRule[] {
  return optimizationRules.filter(rule => rule.enabled)
}

/**
 * 应用优化规则到基础Prompt
 */
export function applyOptimizationsToPrompt(
  basePrompt: string,
  orientation: 'brand' | 'product' | 'promo'
): string {
  const activeRules = getActiveOptimizationRules()

  if (activeRules.length === 0) {
    return basePrompt
  }

  // 构建优化增强部分
  let optimizedPrompt = basePrompt

  // 添加优化规则部分
  optimizedPrompt += '\n\n## 🎯 数据驱动的优化规则（基于实际投放表现）\n'

  // 应该增强的要素
  const enhanceRules = activeRules.filter(r => r.type === 'enhance' && r.impact === 'high')
  if (enhanceRules.length > 0) {
    optimizedPrompt += '\n### ✅ 已验证的高效要素（必须包含）\n'
    enhanceRules.forEach(rule => {
      optimizedPrompt += `- ${rule.rule} （原因：${rule.reason}）\n`
    })
  }

  // 应该避免的要素
  const avoidRules = activeRules.filter(r => r.type === 'avoid')
  if (avoidRules.length > 0) {
    optimizedPrompt += '\n### ❌ 低效要素（必须避免）\n'
    avoidRules.forEach(rule => {
      optimizedPrompt += `- ${rule.rule} （原因：${rule.reason}）\n`
    })
  }

  // 调整建议
  const adjustRules = activeRules.filter(r => r.type === 'adjust')
  if (adjustRules.length > 0) {
    optimizedPrompt += '\n### ⚙️ 优化调整建议\n'
    adjustRules.forEach(rule => {
      optimizedPrompt += `- ${rule.rule} （原因：${rule.reason}）\n`
    })
  }

  // 添加性能洞察
  if (performanceInsights.length > 0) {
    optimizedPrompt += '\n### 📊 性能数据洞察\n'
    const relevantInsights = performanceInsights
      .filter(insight => insight.confidence === 'high')
      .slice(0, 5)

    relevantInsights.forEach(insight => {
      optimizedPrompt += `- "${insight.pattern}" - CTR ${(insight.avgCtr * 100).toFixed(2)}%, 转化率 ${(insight.avgConversionRate * 100).toFixed(2)}% (${insight.sampleSize}个样本)\n`
    })
  }

  optimizedPrompt += '\n**重要**: 严格遵守以上数据驱动的优化规则，这些规则来自实际投放数据验证。\n'

  return optimizedPrompt
}

/**
 * 从投放数据中学习并生成优化规则
 */
export function learnFromPerformanceData(performanceData: any[]): OptimizationRule[] {
  const newRules: OptimizationRule[] = []

  if (performanceData.length < 3) {
    console.warn('数据样本不足，无法生成优化规则')
    return newRules
  }

  // 按综合表现排序
  const sorted = [...performanceData].sort((a, b) => {
    const scoreA = (a.ctr || 0) * 0.4 + (a.conversionRate || 0) * 0.4 + ((a.qualityScore || 0) / 10) * 0.2
    const scoreB = (b.ctr || 0) * 0.4 + (b.conversionRate || 0) * 0.4 + ((b.qualityScore || 0) / 10) * 0.2
    return scoreB - scoreA
  })

  const topThird = sorted.slice(0, Math.ceil(sorted.length / 3))
  const bottomThird = sorted.slice(-Math.ceil(sorted.length / 3))

  // 分析高表现创意的共同特征
  const topOrientations = topThird.map(ad => ad.orientation)
  const dominantOrientation = getMostFrequent(topOrientations)

  if (dominantOrientation) {
    const orientationCount = topOrientations.filter(o => o === dominantOrientation).length
    const confidence = orientationCount / topThird.length

    if (confidence > 0.6) {
      newRules.push({
        id: `opt_${Date.now()}_orientation`,
        type: 'adjust',
        category: 'general',
        rule: `优先使用${dominantOrientation === 'brand' ? '品牌导向' : dominantOrientation === 'product' ? '产品导向' : '促销导向'}的创意策略`,
        reason: `该导向的创意在${topThird.length}个高表现样本中占比${(confidence * 100).toFixed(0)}%`,
        impact: 'high',
        source: 'performance_data',
        createdAt: new Date().toISOString(),
        enabled: true
      })
    }
  }

  // 分析标题长度
  const topHeadlineLengths = topThird.map(ad => ad.headline1?.length || 0)
  const avgTopLength = topHeadlineLengths.reduce((a, b) => a + b, 0) / topHeadlineLengths.length

  const bottomHeadlineLengths = bottomThird.map(ad => ad.headline1?.length || 0)
  const avgBottomLength = bottomHeadlineLengths.reduce((a, b) => a + b, 0) / bottomHeadlineLengths.length

  if (Math.abs(avgTopLength - avgBottomLength) > 5) {
    newRules.push({
      id: `opt_${Date.now()}_headline_length`,
      type: 'adjust',
      category: 'headline',
      rule: `标题长度控制在${Math.round(avgTopLength - 2)}-${Math.round(avgTopLength + 2)}个字符`,
      reason: `高表现创意平均标题长度为${avgTopLength.toFixed(0)}字符，明显${avgTopLength > avgBottomLength ? '长于' : '短于'}低表现创意的${avgBottomLength.toFixed(0)}字符`,
      impact: 'medium',
      source: 'performance_data',
      createdAt: new Date().toISOString(),
      enabled: true
    })
  }

  // 存储新规则
  newRules.forEach(rule => {
    // 检查是否已存在类似规则
    const existingRule = optimizationRules.find(r =>
      r.category === rule.category && r.rule.includes(rule.rule.split(' ')[0])
    )

    if (existingRule) {
      // 更新现有规则
      existingRule.reason = rule.reason
      existingRule.impact = rule.impact
    } else {
      // 添加新规则
      optimizationRules.push(rule)
    }
  })

  return newRules
}

/**
 * 从A/B测试结果中学习
 */
export function learnFromABTest(
  variantA: any,
  variantB: any,
  performanceA: any,
  performanceB: any
): OptimizationRule[] {
  const newRules: OptimizationRule[] = []

  // 计算综合得分
  const scoreA = (performanceA.ctr || 0) * 0.4 + (performanceA.conversionRate || 0) * 0.4 + ((performanceA.qualityScore || 0) / 10) * 0.2
  const scoreB = (performanceB.ctr || 0) * 0.4 + (performanceB.conversionRate || 0) * 0.4 + ((performanceB.qualityScore || 0) / 10) * 0.2

  const improvement = ((scoreB - scoreA) / scoreA) * 100

  if (Math.abs(improvement) > 10) { // 10%以上的差异才认为显著
    const winner = improvement > 0 ? variantB : variantA
    const loser = improvement > 0 ? variantA : variantB

    // 识别差异点并生成规则
    if (winner.headline1 !== loser.headline1) {
      newRules.push({
        id: `opt_${Date.now()}_ab_headline`,
        type: 'enhance',
        category: 'headline',
        rule: `参考使用类似"${winner.headline1}"的标题结构`,
        reason: `A/B测试显示该标题结构比"${loser.headline1}"表现好${Math.abs(improvement).toFixed(1)}%`,
        impact: 'high',
        source: 'ab_test',
        createdAt: new Date().toISOString(),
        enabled: true
      })
    }
  }

  return newRules
}

/**
 * 获取最频繁出现的值
 */
function getMostFrequent<T>(arr: T[]): T | null {
  if (arr.length === 0) return null

  const frequency: Record<string, number> = {}
  let maxFreq = 0
  let result: T | null = null

  arr.forEach(item => {
    const key = String(item)
    frequency[key] = (frequency[key] || 0) + 1
    if (frequency[key] > maxFreq) {
      maxFreq = frequency[key]
      result = item
    }
  })

  return result
}

/**
 * 导出所有优化规则（用于数据库持久化）
 */
export function exportOptimizationRules(): OptimizationRule[] {
  return optimizationRules
}

/**
 * 导入优化规则（从数据库恢复）
 */
export function importOptimizationRules(rules: OptimizationRule[]): void {
  optimizationRules = rules
}

/**
 * 清除所有优化规则
 */
export function clearOptimizationRules(): void {
  optimizationRules = []
  performanceInsights = []
}

/**
 * 添加性能洞察
 */
export function addPerformanceInsight(insight: PerformanceInsight): void {
  performanceInsights.push(insight)

  // 保留最新的50条洞察
  if (performanceInsights.length > 50) {
    performanceInsights = performanceInsights.slice(-50)
  }
}
