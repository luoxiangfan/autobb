/**
 * LaunchScore相关类型定义
 * v4.0 - 4维度评分系统
 */

export interface LaunchScoreModalProps {
  isOpen: boolean
  onClose: () => void
  offer: {
    id: number
    offerName: string
    brand: string
  }
}

export interface Creative {
  id: number
  version: number
  headline1: string
  headline2: string | null
  headline3: string | null
  description1: string
  description2: string | null
  finalUrl: string
  qualityScore: number | null
  isApproved: boolean
  createdAt: string
}

export interface ScoreDimension {
  score: number
  issues?: string[]
  suggestions?: string[]
}

/**
 * Launch Score v4.0 - 4维度评分数据
 */
export interface LaunchScoreData {
  totalScore: number
  // 维度1: 投放可行性 (35分)
  launchViability: ScoreDimension & {
    brandSearchVolume: number      // 品牌词月搜索量
    brandSearchScore: number       // 0-15
    profitMargin: number           // 利润空间
    profitScore: number            // 0-10
    competitionLevel: 'LOW' | 'MEDIUM' | 'HIGH'
    competitionScore: number       // 0-10
  }
  // 维度2: 广告质量 (30分)
  adQuality: ScoreDimension & {
    adStrength: 'POOR' | 'AVERAGE' | 'GOOD' | 'EXCELLENT'
    adStrengthScore: number        // 0-15
    headlineDiversity: number      // 0-100%
    headlineDiversityScore: number // 0-8
    descriptionQuality: number     // 0-100%
    descriptionQualityScore: number // 0-7
  }
  // 维度3: 关键词策略 (20分)
  keywordStrategy: ScoreDimension & {
    relevanceScore: number         // 0-8
    matchTypeScore: number         // 0-6
    negativeKeywordsScore: number  // 0-6
    totalKeywords: number
    negativeKeywordsCount: number
    matchTypeDistribution: Record<string, number>
  }
  // 维度4: 基础配置 (15分)
  basicConfig: ScoreDimension & {
    countryLanguageScore: number   // 0-5
    finalUrlScore: number          // 0-5
    budgetScore: number            // 0-5
    targetCountry: string
    targetLanguage: string
    finalUrl: string
    dailyBudget: number
    maxCpc: number
  }
  overallRecommendations: string[]
}

export interface ScoreHistoryItem {
  id: number
  creative_id: number
  total_score: number
  launch_viability_data: string
  ad_quality_data: string
  keyword_strategy_data: string
  basic_config_data: string
  recommendations: string
  created_at: string
}

export interface CompareDataItem {
  creativeId: number
  version: number
  headline: string
  score: LaunchScoreData | null
  createdAt: string
}

export interface PerformanceData {
  success: boolean
  data: {
    totalScore: number
    metricsUsed: string[]
    performanceGrade: string
    correlationInsights: string[]
    creativePerformance?: {
      impressions: number
      clicks: number
      cost: number
      conversions: number
      ctr: number
      avgCpc: number
      conversionRate: number
    }
  }
}

export type LaunchScoreTab = 'current' | 'history' | 'compare' | 'performance'

/**
 * v4.0 - 4维度配置
 */
export const DIMENSION_CONFIG = {
  launchViability: {
    key: 'launchViability',
    name: '投放可行性',
    maxScore: 35,
    color: 'from-emerald-500 to-emerald-600',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    description: '品牌词搜索量、利润空间、竞争度'
  },
  adQuality: {
    key: 'adQuality',
    name: '广告质量',
    maxScore: 30,
    color: 'from-blue-500 to-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    description: 'Ad Strength、标题多样性、描述质量'
  },
  keywordStrategy: {
    key: 'keywordStrategy',
    name: '关键词策略',
    maxScore: 20,
    color: 'from-violet-500 to-violet-600',
    bgColor: 'bg-violet-50',
    borderColor: 'border-violet-200',
    description: '相关性、匹配类型、否定关键词'
  },
  basicConfig: {
    key: 'basicConfig',
    name: '基础配置',
    maxScore: 15,
    color: 'from-amber-500 to-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    description: '国家/语言、Final URL、预算'
  },
} as const
