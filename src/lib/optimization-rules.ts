/**
 * Campaign优化规则引擎
 *
 * 功能：
 * - 基于性能数据生成优化建议
 * - 可配置阈值和敏感度
 * - 支持多种优化类型
 * - 优先级评分系统
 */

export type OptimizationType =
  | 'pause_campaign'
  | 'increase_budget'
  | 'decrease_budget'
  | 'optimize_creative'
  | 'adjust_keywords'
  | 'lower_cpc'
  | 'improve_landing_page'
  | 'expand_targeting'

export type Priority = 'high' | 'medium' | 'low'

export interface RuleConfig {
  enabled: boolean
  threshold: number
  sensitivity: 'strict' | 'normal' | 'relaxed'
}

export interface CampaignMetrics {
  campaignId: number
  campaignName: string
  status: string
  impressions: number
  clicks: number
  cost: number
  conversions: number
  ctr: number
  cpc: number
  cpa: number
  conversionRate: number
  roi: number
  daysRunning: number
  // 🆕 P1-1优化：广告疲劳检测所需字段
  ctrTrend?: number  // CTR变化趋势（正值=增长，负值=下降）
  previousCtr?: number  // 上一周期的CTR
}

export interface OptimizationRecommendation {
  campaignId: number
  campaignName: string
  priority: Priority
  type: OptimizationType
  reason: string
  action: string
  expectedImpact: string
  metrics: {
    current: Record<string, number>
    target?: Record<string, number>
  }
}

export interface RulesConfig {
  ctrLow: RuleConfig
  ctrHigh: RuleConfig
  conversionRateLow: RuleConfig
  cpcHigh: RuleConfig
  costHigh: RuleConfig
  roiNegative: RuleConfig
  roiHigh: RuleConfig
  impressionsLow: RuleConfig
}

/**
 * 默认规则配置
 */
const DEFAULT_CONFIG: RulesConfig = {
  ctrLow: {
    enabled: true,
    threshold: 0.01, // 1%
    sensitivity: 'normal'
  },
  ctrHigh: {
    enabled: true,
    threshold: 0.05, // 5%
    sensitivity: 'normal'
  },
  conversionRateLow: {
    enabled: true,
    threshold: 0.01, // 1%
    sensitivity: 'normal'
  },
  cpcHigh: {
    enabled: true,
    threshold: 3.0, // $3
    sensitivity: 'normal'
  },
  costHigh: {
    enabled: true,
    threshold: 100, // $100
    sensitivity: 'normal'
  },
  roiNegative: {
    enabled: true,
    threshold: 0,
    sensitivity: 'normal'
  },
  roiHigh: {
    enabled: true,
    threshold: 1.0, // 100% ROI
    sensitivity: 'normal'
  },
  impressionsLow: {
    enabled: true,
    threshold: 100,
    sensitivity: 'normal'
  }
}

/**
 * 敏感度系数
 */
const SENSITIVITY_MULTIPLIER = {
  strict: 1.2,
  normal: 1.0,
  relaxed: 0.8
}

/**
 * 行业基准数据
 */
const INDUSTRY_BENCHMARKS = {
  avgCtr: 0.02, // 2%
  avgCpc: 1.5, // $1.5
  avgConversionRate: 0.03, // 3%
  avgRoi: 0.5 // 50%
}

/**
 * 优化规则引擎类
 */
export class OptimizationRulesEngine {
  private config: RulesConfig

  constructor(config?: Partial<RulesConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 为单个Campaign生成优化建议
   */
  generateRecommendations(metrics: CampaignMetrics): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = []

    // 确保有足够的数据量
    if (metrics.impressions < 10) {
      return recommendations
    }

    // 规则1: CTR过低 → 暂停或优化创意
    const ctrLowRec = this.checkCtrLow(metrics)
    if (ctrLowRec) recommendations.push(ctrLowRec)

    // 规则2: 转化率低 → 优化创意和着陆页
    const conversionLowRec = this.checkConversionRateLow(metrics)
    if (conversionLowRec) recommendations.push(conversionLowRec)

    // 规则3: CPC过高 → 降低出价
    const cpcHighRec = this.checkCpcHigh(metrics)
    if (cpcHighRec) recommendations.push(cpcHighRec)

    // 规则4: 花费高无转化 → 暂停
    const costHighRec = this.checkCostHighNoConversion(metrics)
    if (costHighRec) recommendations.push(costHighRec)

    // 规则5: ROI负值 → 暂停或优化
    const roiNegativeRec = this.checkRoiNegative(metrics)
    if (roiNegativeRec) recommendations.push(roiNegativeRec)

    // 规则6: ROI高 → 增加预算
    const roiHighRec = this.checkRoiHigh(metrics)
    if (roiHighRec) recommendations.push(roiHighRec)

    // 规则7: CTR高 → 增加预算
    const ctrHighRec = this.checkCtrHigh(metrics)
    if (ctrHighRec) recommendations.push(ctrHighRec)

    // 规则8: 展示量低 → 扩大定位
    const impressionsLowRec = this.checkImpressionsLow(metrics)
    if (impressionsLowRec) recommendations.push(impressionsLowRec)

    // 规则9: 新Campaign观察期
    const newCampaignRec = this.checkNewCampaign(metrics)
    if (newCampaignRec) recommendations.push(newCampaignRec)

    // 🆕 规则10: 广告疲劳检测
    const adFatigueRec = this.checkAdFatigue(metrics)
    if (adFatigueRec) recommendations.push(adFatigueRec)

    return recommendations
  }

  /**
   * 批量为多个Campaigns生成建议
   */
  generateBatchRecommendations(campaignsList: CampaignMetrics[]): OptimizationRecommendation[] {
    const allRecommendations: OptimizationRecommendation[] = []

    for (const campaign of campaignsList) {
      const recommendations = this.generateRecommendations(campaign)
      allRecommendations.push(...recommendations)
    }

    // 按优先级排序
    return this.sortByPriority(allRecommendations)
  }

  /**
   * 规则1: CTR过低
   */
  private checkCtrLow(metrics: CampaignMetrics): OptimizationRecommendation | null {
    if (!this.config.ctrLow.enabled) return null

    const threshold = this.config.ctrLow.threshold * SENSITIVITY_MULTIPLIER[this.config.ctrLow.sensitivity]

    if (metrics.clicks >= 50 && metrics.ctr < threshold) {
      return {
        campaignId: metrics.campaignId,
        campaignName: metrics.campaignName,
        priority: 'high',
        type: metrics.ctr < threshold * 0.5 ? 'pause_campaign' : 'optimize_creative',
        reason: `CTR过低（${(metrics.ctr * 100).toFixed(2)}%），远低于行业均值（${(INDUSTRY_BENCHMARKS.avgCtr * 100).toFixed(1)}%）`,
        action: metrics.ctr < threshold * 0.5
          ? '建议暂停Campaign，重新优化创意和关键词'
          : '建议优化广告创意，测试不同的标题和描述',
        expectedImpact: '预计可提升CTR至2%以上，降低CPC',
        metrics: {
          current: { ctr: metrics.ctr, clicks: metrics.clicks },
          target: { ctr: INDUSTRY_BENCHMARKS.avgCtr }
        }
      }
    }

    return null
  }

  /**
   * 规则2: 转化率低
   */
  private checkConversionRateLow(metrics: CampaignMetrics): OptimizationRecommendation | null {
    if (!this.config.conversionRateLow.enabled) return null

    const threshold = this.config.conversionRateLow.threshold * SENSITIVITY_MULTIPLIER[this.config.conversionRateLow.sensitivity]

    if (metrics.clicks >= 20 && metrics.conversionRate < threshold) {
      return {
        campaignId: metrics.campaignId,
        campaignName: metrics.campaignName,
        priority: 'medium',
        type: 'improve_landing_page',
        reason: `转化率过低（${(metrics.conversionRate * 100).toFixed(2)}%），低于行业均值（${(INDUSTRY_BENCHMARKS.avgConversionRate * 100).toFixed(1)}%）`,
        action: '建议优化着陆页体验，改进CTA按钮，简化转化流程',
        expectedImpact: '预计可提升转化率至3%以上，降低CPA',
        metrics: {
          current: { conversionRate: metrics.conversionRate, conversions: metrics.conversions },
          target: { conversionRate: INDUSTRY_BENCHMARKS.avgConversionRate }
        }
      }
    }

    return null
  }

  /**
   * 规则3: CPC过高
   */
  private checkCpcHigh(metrics: CampaignMetrics): OptimizationRecommendation | null {
    if (!this.config.cpcHigh.enabled) return null

    const threshold = this.config.cpcHigh.threshold * SENSITIVITY_MULTIPLIER[this.config.cpcHigh.sensitivity]

    if (metrics.clicks >= 10 && metrics.cpc > threshold) {
      return {
        campaignId: metrics.campaignId,
        campaignName: metrics.campaignName,
        priority: 'medium',
        type: 'lower_cpc',
        reason: `CPC过高（$${metrics.cpc.toFixed(2)}），高于行业均值（$${INDUSTRY_BENCHMARKS.avgCpc.toFixed(2)}）`,
        action: '建议降低最高CPC出价，或调整关键词匹配类型为PHRASE/EXACT',
        expectedImpact: `预计可降低CPC至$${INDUSTRY_BENCHMARKS.avgCpc.toFixed(2)}，节省${((metrics.cpc - INDUSTRY_BENCHMARKS.avgCpc) / metrics.cpc * 100).toFixed(0)}%成本`,
        metrics: {
          current: { cpc: metrics.cpc, cost: metrics.cost },
          target: { cpc: INDUSTRY_BENCHMARKS.avgCpc }
        }
      }
    }

    return null
  }

  /**
   * 规则4: 花费高无转化
   */
  private checkCostHighNoConversion(metrics: CampaignMetrics): OptimizationRecommendation | null {
    if (!this.config.costHigh.enabled) return null

    const threshold = this.config.costHigh.threshold * SENSITIVITY_MULTIPLIER[this.config.costHigh.sensitivity]

    if (metrics.cost > threshold && metrics.conversions === 0) {
      return {
        campaignId: metrics.campaignId,
        campaignName: metrics.campaignName,
        priority: 'high',
        type: 'pause_campaign',
        reason: `已花费$${metrics.cost.toFixed(2)}但无任何转化`,
        action: '建议立即暂停，重新评估关键词定位、受众匹配和着陆页质量',
        expectedImpact: '避免继续浪费预算，重新优化后再启动',
        metrics: {
          current: { cost: metrics.cost, conversions: metrics.conversions }
        }
      }
    }

    return null
  }

  /**
   * 规则5: ROI负值
   */
  private checkRoiNegative(metrics: CampaignMetrics): OptimizationRecommendation | null {
    if (!this.config.roiNegative.enabled) return null

    if (metrics.conversions > 0 && metrics.roi < 0) {
      return {
        campaignId: metrics.campaignId,
        campaignName: metrics.campaignName,
        priority: 'high',
        type: 'decrease_budget',
        reason: `ROI为负值（${(metrics.roi * 100).toFixed(0)}%），投入产出比不合理`,
        action: '建议降低预算50%，同时优化转化率和降低CPC',
        expectedImpact: '减少亏损，调整后预计可达到正ROI',
        metrics: {
          current: { roi: metrics.roi, cost: metrics.cost, conversions: metrics.conversions }
        }
      }
    }

    return null
  }

  /**
   * 规则6: ROI高
   */
  private checkRoiHigh(metrics: CampaignMetrics): OptimizationRecommendation | null {
    if (!this.config.roiHigh.enabled) return null

    const threshold = this.config.roiHigh.threshold * SENSITIVITY_MULTIPLIER[this.config.roiHigh.sensitivity]

    if (metrics.conversions >= 5 && metrics.roi > threshold) {
      return {
        campaignId: metrics.campaignId,
        campaignName: metrics.campaignName,
        priority: 'low',
        type: 'increase_budget',
        reason: `ROI表现优异（${(metrics.roi * 100).toFixed(0)}%），高于行业均值`,
        action: '建议增加预算至150%，扩大优质流量获取',
        expectedImpact: `预计可增加${(metrics.conversions * 0.5).toFixed(0)}个转化，保持高ROI`,
        metrics: {
          current: { roi: metrics.roi, cost: metrics.cost, conversions: metrics.conversions },
          target: { cost: metrics.cost * 1.5 }
        }
      }
    }

    return null
  }

  /**
   * 规则7: CTR高
   */
  private checkCtrHigh(metrics: CampaignMetrics): OptimizationRecommendation | null {
    if (!this.config.ctrHigh.enabled) return null

    const threshold = this.config.ctrHigh.threshold * SENSITIVITY_MULTIPLIER[this.config.ctrHigh.sensitivity]

    if (metrics.clicks >= 50 && metrics.ctr > threshold && metrics.conversions > 0) {
      return {
        campaignId: metrics.campaignId,
        campaignName: metrics.campaignName,
        priority: 'low',
        type: 'increase_budget',
        reason: `CTR表现优异（${(metrics.ctr * 100).toFixed(2)}%），远高于行业均值`,
        action: '建议增加预算，同时优化转化率以提升整体ROI',
        expectedImpact: '预计可增加展示和点击量，扩大品牌曝光',
        metrics: {
          current: { ctr: metrics.ctr, clicks: metrics.clicks }
        }
      }
    }

    return null
  }

  /**
   * 规则8: 展示量低
   */
  private checkImpressionsLow(metrics: CampaignMetrics): OptimizationRecommendation | null {
    if (!this.config.impressionsLow.enabled) return null

    const threshold = this.config.impressionsLow.threshold * SENSITIVITY_MULTIPLIER[this.config.impressionsLow.sensitivity]

    if (metrics.daysRunning >= 3 && metrics.impressions < threshold) {
      return {
        campaignId: metrics.campaignId,
        campaignName: metrics.campaignName,
        priority: 'medium',
        type: 'expand_targeting',
        reason: `展示量过低（${metrics.impressions}次），运行${metrics.daysRunning}天`,
        action: '建议扩大关键词列表、增加匹配类型为BROAD、或提高出价',
        expectedImpact: '预计可提升展示量至1000+/天',
        metrics: {
          current: { impressions: metrics.impressions, daysRunning: metrics.daysRunning }
        }
      }
    }

    return null
  }

  /**
   * 规则9: 新Campaign观察期
   */
  private checkNewCampaign(metrics: CampaignMetrics): OptimizationRecommendation | null {
    if (metrics.daysRunning <= 3 && metrics.impressions >= 10) {
      return {
        campaignId: metrics.campaignId,
        campaignName: metrics.campaignName,
        priority: 'low',
        type: 'optimize_creative',
        reason: `新Campaign处于观察期（运行${metrics.daysRunning}天）`,
        action: '建议继续观察3-7天，收集更多数据后再优化',
        expectedImpact: '获取充足数据后可做出更准确的优化决策',
        metrics: {
          current: { daysRunning: metrics.daysRunning, impressions: metrics.impressions }
        }
      }
    }

    return null
  }

  /**
   * 🆕 规则10: 广告疲劳检测 (P1-1优化)
   *
   * 检测条件：
   * - 运行超过30天
   * - CTR下降超过15%
   *
   * 广告疲劳现象：长期投放同一创意导致用户审美疲劳，点击率持续下降
   */
  private checkAdFatigue(metrics: CampaignMetrics): OptimizationRecommendation | null {
    // 需要ctrTrend数据才能检测疲劳
    if (metrics.ctrTrend === undefined) return null

    // 条件：运行>30天 且 CTR下降>15%
    if (metrics.daysRunning > 30 && metrics.ctrTrend < -0.15) {
      const ctrDecreasePercent = Math.abs(metrics.ctrTrend * 100).toFixed(1)

      return {
        campaignId: metrics.campaignId,
        campaignName: metrics.campaignName,
        priority: 'medium',
        type: 'optimize_creative',
        reason: `广告疲劳：运行${metrics.daysRunning}天，CTR下降${ctrDecreasePercent}%`,
        action: '建议更新广告创意，测试新的标题和描述组合，刷新视觉元素',
        expectedImpact: '预计可恢复CTR至正常水平（+3~8%）',
        metrics: {
          current: {
            daysRunning: metrics.daysRunning,
            ctrTrend: metrics.ctrTrend,
            ctr: metrics.ctr,
            previousCtr: metrics.previousCtr || 0
          }
        }
      }
    }

    return null
  }

  /**
   * 按优先级排序
   */
  private sortByPriority(recommendations: OptimizationRecommendation[]): OptimizationRecommendation[] {
    const priorityOrder: Record<Priority, number> = {
      high: 0,
      medium: 1,
      low: 2
    }

    return recommendations.sort((a, b) => {
      return priorityOrder[a.priority] - priorityOrder[b.priority]
    })
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<RulesConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * 获取当前配置
   */
  getConfig(): RulesConfig {
    return { ...this.config }
  }
}

/**
 * 创建默认规则引擎实例
 */
export function createOptimizationEngine(config?: Partial<RulesConfig>): OptimizationRulesEngine {
  return new OptimizationRulesEngine(config)
}
