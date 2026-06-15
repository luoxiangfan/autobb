/**
 * Public Ad Strength evaluation types.
 */

/**
 * Ad Strength评级标准
 */
export type AdStrengthRating = 'PENDING' | 'POOR' | 'AVERAGE' | 'GOOD' | 'EXCELLENT'

/**
 * 完整评估结果
 */
export interface AdStrengthEvaluation {
  // 总体评分
  overallScore: number // 0-100
  rating: AdStrengthRating

  // 各维度得分
  dimensions: {
    diversity: {
      score: number // 0-18
      weight: 0.18
      details: {
        typeDistribution: number // 0-7.2 资产类型分布
        lengthDistribution: number // 0-7.2 长度梯度
        textUniqueness: number // 0-3.6 文本独特性
      }
    }
    relevance: {
      score: number // 0-22
      weight: 0.22
      details: {
        keywordCoverage: number // 0-10 关键词覆盖率
        keywordEmbedding: number // 0-4 关键词嵌入率得分 (v3.3新增)
        keywordEmbeddingRate: number // 0-100 关键词嵌入率百分比 (v3.3新增)
        keywordNaturalness: number // 0-6 关键词自然度
        productFocus: number // 0-4 单品聚焦度 (v4.18新增) - 检查创意是否100%聚焦单品
      }
    }
    completeness: {
      score: number // 0-10
      weight: 0.1
      details: {
        assetCount: number // 0-8.4 资产数量
        characterCompliance: number // 0-5.6 字符合规性
      }
    }
    quality: {
      score: number // 0-14
      weight: 0.14
      details: {
        numberUsage: number // 0-3.73 数字使用
        ctaPresence: number // 0-3.73 CTA存在
        urgencyExpression: number // 0-2.8 紧迫感表达
        differentiation: number // 0-3.73 差异化表达
      }
    }
    compliance: {
      score: number // 0-8
      weight: 0.08
      details: {
        policyAdherence: number // 0-4.8 政策遵守
        noSpamWords: number // 0-3.2 无垃圾词汇
      }
    }
    brandSearchVolume: {
      score: number // 0-18
      weight: 0.18
      details: {
        brandNameSearchVolume: number // 品牌名搜索量（如 "Nike"）
        brandKeywordSearchVolume: number // 品牌关键词搜索量总和（如 "Nike运动鞋" + "Nike鞋"）
        exactBrandKeywordSearchVolume?: number // 精确品牌词搜索量（如 "Nike"）
        totalBrandSearchVolume: number // 两者之和
        volumeLevel: 'micro' | 'small' | 'medium' | 'large' | 'xlarge' // 流量级别
        dataSource: 'keyword_planner' | 'cached' | 'database' | 'unavailable' // 数据来源
        fallbackMode?: 'none' | 'brand_signal_proxy' | 'exact_brand_keyword_backfill'
        plannerUnavailableReason?: 'DEV_TOKEN_INSUFFICIENT_ACCESS' | 'DEV_TOKEN_TEST_ONLY'
        brandKeywordCount?: number
        brandKeywordCoverage?: number
      }
    }
    competitivePositioning: {
      score: number // 0-10
      weight: 0.1
      details: {
        priceAdvantage: number // 0-3 价格优势量化
        uniqueMarketPosition: number // 0-3 独特市场定位
        competitiveComparison: number // 0-2 竞品对比暗示
        valueEmphasis: number // 0-2 性价比强调
      }
    }
  }

  // 资产级别评分（可选）
  assetScores?: {
    headlines: Array<{
      text: string
      score: number
      issues: string[]
      suggestions: string[]
    }>
    descriptions: Array<{
      text: string
      score: number
      issues: string[]
      suggestions: string[]
    }>
  }

  // 非阻断指标：类型-意图对齐与文案意图覆盖（不影响总分）
  copyIntentMetrics?: {
    expectedBucket: 'A' | 'B' | 'D' | 'UNSPECIFIED'
    typeIntentAlignmentScore: number // 0-100
    copyIntentCoverage: number // 0-100
  }

  // 改进建议
  suggestions: string[]
}
