/**
 * 否定关键词策略生成器
 *
 * 用途：为Phase 2投放策略测试生成不同级别的否定关键词策略
 *
 * 策略级别：
 * 1. none - 无否定关键词（基准）
 * 2. conservative - 保守策略（过滤明显无效流量）
 * 3. moderate - 适度策略（平衡覆盖和精准）
 * 4. aggressive - 激进策略（最大化精准度）
 */

export interface NegativeKeywordStrategy {
  name: string
  level: 'none' | 'conservative' | 'moderate' | 'aggressive'
  keywords: string[]
  description: string
  estimatedTrafficReduction: number  // 预估流量减少百分比
}

/**
 * 通用否定关键词词库
 */
const COMMON_NEGATIVE_KEYWORDS = {
  // 价格相关（低价值用户）
  price_sensitive: [
    'free',
    'cheap',
    'discount',
    'coupon',
    'deal',
    'sale',
    'clearance',
    'bargain',
    'wholesale',
    'bulk'
  ],

  // 信息查询（非购买意图）
  informational: [
    'how to',
    'what is',
    'why',
    'tutorial',
    'guide',
    'review',
    'comparison',
    'vs',
    'difference',
    'meaning'
  ],

  // DIY/自己动手（非服务/产品购买）
  diy: [
    'diy',
    'homemade',
    'make your own',
    'build',
    'create',
    'tutorial'
  ],

  // 二手/翻新（非新品）
  used: [
    'used',
    'second hand',
    'refurbished',
    'repair',
    'fix',
    'broken',
    'damaged'
  ],

  // 工作/职业（非客户）
  job_related: [
    'job',
    'jobs',
    'career',
    'salary',
    'hiring',
    'employment',
    'work from home'
  ],

  // 竞品（直接竞争对手品牌）
  competitors: [
    // 需要根据具体行业填充
  ],

  // 成人内容（品牌安全）
  adult: [
    // 成人相关关键词
  ],

  // 下载/盗版（非法或不道德）
  illegal: [
    'download',
    'torrent',
    'crack',
    'pirate',
    'illegal',
    'hack'
  ]
}

/**
 * 生成否定关键词策略
 */
export function generateNegativeKeywordStrategies(
  options: {
    industry?: string
    productType?: string
    customNegatives?: string[]
  } = {}
): NegativeKeywordStrategy[] {
  const strategies: NegativeKeywordStrategy[] = []

  // 策略1: 无否定关键词（基准）
  strategies.push({
    name: 'No Negatives (Baseline)',
    level: 'none',
    keywords: [],
    description: '不使用任何否定关键词，作为基准测量最大流量',
    estimatedTrafficReduction: 0
  })

  // 策略2: 保守策略
  const conservativeKeywords = [
    ...COMMON_NEGATIVE_KEYWORDS.price_sensitive.slice(0, 3),  // free, cheap, discount
    ...COMMON_NEGATIVE_KEYWORDS.illegal,
    ...COMMON_NEGATIVE_KEYWORDS.adult
  ]

  strategies.push({
    name: 'Conservative Filter',
    level: 'conservative',
    keywords: [...new Set(conservativeKeywords)],  // 去重
    description: '过滤明显无购买意图的流量（免费、盗版等）',
    estimatedTrafficReduction: 5
  })

  // 策略3: 适度策略
  const moderateKeywords = [
    ...COMMON_NEGATIVE_KEYWORDS.price_sensitive,
    ...COMMON_NEGATIVE_KEYWORDS.informational.slice(0, 5),
    ...COMMON_NEGATIVE_KEYWORDS.used,
    ...COMMON_NEGATIVE_KEYWORDS.illegal,
    ...COMMON_NEGATIVE_KEYWORDS.adult
  ]

  strategies.push({
    name: 'Moderate Filter',
    level: 'moderate',
    keywords: [...new Set(moderateKeywords)],
    description: '过滤低价值和非购买意图流量，平衡覆盖和精准',
    estimatedTrafficReduction: 15
  })

  // 策略4: 激进策略
  const aggressiveKeywords = [
    ...COMMON_NEGATIVE_KEYWORDS.price_sensitive,
    ...COMMON_NEGATIVE_KEYWORDS.informational,
    ...COMMON_NEGATIVE_KEYWORDS.diy,
    ...COMMON_NEGATIVE_KEYWORDS.used,
    ...COMMON_NEGATIVE_KEYWORDS.job_related,
    ...COMMON_NEGATIVE_KEYWORDS.illegal,
    ...COMMON_NEGATIVE_KEYWORDS.adult
  ]

  // 添加自定义否定关键词
  if (options.customNegatives && options.customNegatives.length > 0) {
    aggressiveKeywords.push(...options.customNegatives)
  }

  strategies.push({
    name: 'Aggressive Filter',
    level: 'aggressive',
    keywords: [...new Set(aggressiveKeywords)],
    description: '最大化精准度，过滤所有非高意向流量',
    estimatedTrafficReduction: 30
  })

  return strategies
}

/**
 * 生成特定行业的否定关键词策略
 */
export function generateIndustrySpecificStrategies(
  industry: string,
  customNegatives: string[] = []
): NegativeKeywordStrategy[] {
  // 基础策略
  const baseStrategies = generateNegativeKeywordStrategies({ customNegatives })

  // 行业特定关键词
  const industryNegatives: Record<string, string[]> = {
    'ecommerce': [
      'wholesale',
      'supplier',
      'manufacturer',
      'bulk order',
      'trade'
    ],
    'saas': [
      'open source',
      'self hosted',
      'lifetime deal',
      'one time payment'
    ],
    'education': [
      'free course',
      'pirated',
      'torrent',
      'crack'
    ],
    'real_estate': [
      'rent',
      'rental',
      'lease',
      'apartment'
    ],
    'automotive': [
      'part',
      'parts',
      'repair',
      'manual',
      'diagram'
    ]
  }

  const industryKeywords = industryNegatives[industry.toLowerCase()] || []

  // 为moderate和aggressive策略添加行业特定关键词
  return baseStrategies.map(strategy => {
    if (strategy.level === 'moderate' || strategy.level === 'aggressive') {
      return {
        ...strategy,
        keywords: [...new Set([...strategy.keywords, ...industryKeywords])],
        description: `${strategy.description}（含${industry}行业特定过滤）`
      }
    }
    return strategy
  })
}

/**
 * 根据现有Campaign生成优化建议
 */
export function suggestNegativeKeywordsFromPerformance(
  campaignPerformance: {
    searchTerms: Array<{
      term: string
      impressions: number
      clicks: number
      conversions: number
      cost: number
    }>
  }
): {
  suggested: string[]
  reasoning: Array<{ keyword: string; reason: string; metrics: any }>
} {
  const suggested: string[] = []
  const reasoning: Array<{ keyword: string; reason: string; metrics: any }> = []

  // 分析搜索词性能
  for (const term of campaignPerformance.searchTerms) {
    const ctr = term.clicks / term.impressions
    const cpa = term.conversions > 0 ? term.cost / term.conversions : Infinity

    // 规则1: 高曝光但无点击（CTR极低）
    if (term.impressions > 100 && ctr < 0.001) {
      suggested.push(term.term)
      reasoning.push({
        keyword: term.term,
        reason: `高曝光(${term.impressions})但无点击，CTR极低(${(ctr * 100).toFixed(3)}%)`,
        metrics: { impressions: term.impressions, ctr }
      })
      continue
    }

    // 规则2: 有点击但无转化且成本高
    if (term.clicks > 10 && term.conversions === 0 && term.cost > 50) {
      suggested.push(term.term)
      reasoning.push({
        keyword: term.term,
        reason: `${term.clicks}次点击但0转化，浪费$${term.cost}`,
        metrics: { clicks: term.clicks, cost: term.cost, conversions: 0 }
      })
      continue
    }

    // 规则3: CPA过高（超过平均3倍）
    // 这个需要知道平均CPA，这里简化处理
    if (term.conversions > 0 && cpa > 100) {
      suggested.push(term.term)
      reasoning.push({
        keyword: term.term,
        reason: `CPA过高($${cpa.toFixed(2)})，远超可接受范围`,
        metrics: { cpa, conversions: term.conversions }
      })
    }
  }

  return {
    suggested: [...new Set(suggested)],  // 去重
    reasoning
  }
}

/**
 * 生成CPC优化测试策略
 */
export interface CPCStrategy {
  name: string
  cpcBid: number
  description: string
  expectedImpact: string
}

export function generateCPCOptimizationStrategies(
  currentCPC: number,
  recommendedCPC?: number
): CPCStrategy[] {
  const strategies: CPCStrategy[] = []

  // 策略1: 当前CPC（基准）
  strategies.push({
    name: 'Current CPC (Baseline)',
    cpcBid: currentCPC,
    description: '当前CPC，作为基准',
    expectedImpact: '保持现有流量和成本'
  })

  // 策略2: 降低10%
  strategies.push({
    name: 'CPC -10%',
    cpcBid: currentCPC * 0.9,
    description: '降低10% CPC',
    expectedImpact: '预计流量减少5-10%，成本降低10%'
  })

  // 策略3: 降低20%
  strategies.push({
    name: 'CPC -20%',
    cpcBid: currentCPC * 0.8,
    description: '降低20% CPC',
    expectedImpact: '预计流量减少15-25%，成本降低20%'
  })

  // 策略4: 提高10%（如果有推荐CPC且当前低于推荐）
  if (recommendedCPC && currentCPC < recommendedCPC) {
    strategies.push({
      name: 'CPC +10%',
      cpcBid: currentCPC * 1.1,
      description: '提高10% CPC',
      expectedImpact: '预计流量增加10-20%，成本增加10%'
    })
  }

  return strategies
}

/**
 * 生成出价策略测试配置
 */
export interface BiddingStrategyConfig {
  name: string
  strategyType: string
  description: string
  pros: string[]
  cons: string[]
}

export function generateBiddingStrategyTests(): BiddingStrategyConfig[] {
  return [
    {
      name: 'Manual CPC (Current)',
      strategyType: 'MANUAL_CPC',
      description: '手动CPC出价，完全控制每次点击成本',
      pros: ['完全控制', '可预测成本', '适合小预算'],
      cons: ['需要持续优化', '可能错过机会', '需要人工监控']
    },
    {
      name: 'Maximize Clicks',
      strategyType: 'MAXIMIZE_CLICKS',
      description: '在预算内最大化点击次数',
      pros: ['自动优化', '最大化流量', '省时间'],
      cons: ['点击质量可能降低', '不保证转化', 'CPC可能升高']
    },
    {
      name: 'Target CPA',
      strategyType: 'TARGET_CPA',
      description: '目标CPA出价，优化转化成本',
      pros: ['优化转化', '成本可预测', '自动调整'],
      cons: ['需要转化数据', '学习期长', '可能限制流量']
    },
    {
      name: 'Maximize Conversions',
      strategyType: 'MAXIMIZE_CONVERSIONS',
      description: '在预算内最大化转化次数',
      pros: ['优化转化量', '自动优化', '适合有数据的账户'],
      cons: ['需要转化数据', 'CPA可能不稳定', '需要足够预算']
    }
  ]
}
