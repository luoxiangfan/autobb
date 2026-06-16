import type { CanonicalCreativeType } from '../creatives/server'

/**
 * 关键词池生成进度回调
 */
export type KeywordPoolProgressReporter = (info: {
  phase?:
    | 'seed-volume'
    | 'expand-round'
    | 'volume-batch'
    | 'service-step'
    | 'filter'
    | 'cluster'
    | 'save'
  message: string
  current?: number
  total?: number
}) => Promise<void> | void

/**
 * 关键词池数据结构 - 包含完整元数据
 */
export interface PoolKeywordData {
  keyword: string
  searchVolume: number
  competition?: string
  competitionIndex?: number
  lowTopPageBid?: number
  highTopPageBid?: number
  source: string
  matchType?: 'EXACT' | 'PHRASE' | 'BROAD'
  isPureBrand?: boolean
  volumeUnavailableReason?: 'DEV_TOKEN_INSUFFICIENT_ACCESS'
  relevanceScore?: number
  qualityTier?: 'HIGH' | 'MEDIUM' | 'LOW'
  sourceType?: string
  sourceSubtype?: string
  rawSource?: string
  derivedTags?: string[]
}

/**
 * Offer 级关键词池
 */
export interface OfferKeywordPool {
  id: number
  offerId: number
  userId: number
  brandKeywords: PoolKeywordData[]
  bucketAKeywords: PoolKeywordData[]
  bucketBKeywords: PoolKeywordData[]
  bucketCKeywords: PoolKeywordData[]
  bucketDKeywords: PoolKeywordData[]
  bucketAIntent: string
  bucketBIntent: string
  bucketCIntent: string
  bucketDIntent: string
  storeBucketAKeywords: PoolKeywordData[]
  storeBucketBKeywords: PoolKeywordData[]
  storeBucketCKeywords: PoolKeywordData[]
  storeBucketDKeywords: PoolKeywordData[]
  storeBucketSKeywords: PoolKeywordData[]
  storeBucketAIntent: string
  storeBucketBIntent: string
  storeBucketCIntent: string
  storeBucketDIntent: string
  storeBucketSIntent: string
  linkType: 'product' | 'store' | 'both'
  totalKeywords: number
  clusteringModel: string | null
  clusteringPromptVersion: string | null
  balanceScore: number | null
  createdAt: string
  updatedAt: string
}

/**
 * 关键词桶（AI 聚类结果）
 */
export interface KeywordBuckets {
  bucketA: {
    intent: string
    intentEn: string
    description: string
    keywords: string[]
  }
  bucketB: {
    intent: string
    intentEn: string
    description: string
    keywords: string[]
  }
  bucketC: {
    intent: string
    intentEn: string
    description: string
    keywords: string[]
  }
  bucketD: {
    intent: string
    intentEn: string
    description: string
    keywords: string[]
  }
  bucketS?: {
    intent: string
    intentEn: string
    description: string
    keywords: string[]
  }
  statistics: {
    totalKeywords: number
    bucketACount: number
    bucketBCount: number
    bucketCCount: number
    bucketDCount: number
    bucketSCount?: number
    balanceScore: number
  }
}

/**
 * 店铺链接关键词桶（5个桶）
 */
export interface StoreKeywordBuckets {
  bucketA: {
    intent: string
    intentEn: string
    description: string
    keywords: string[]
  }
  bucketB: {
    intent: string
    intentEn: string
    description: string
    keywords: string[]
  }
  bucketC: {
    intent: string
    intentEn: string
    description: string
    keywords: string[]
  }
  bucketD: {
    intent: string
    intentEn: string
    description: string
    keywords: string[]
  }
  bucketS: {
    intent: string
    intentEn: string
    description: string
    keywords: string[]
  }
  statistics: {
    totalKeywords: number
    bucketACount: number
    bucketBCount: number
    bucketCCount: number
    bucketDCount: number
    bucketSCount: number
    balanceScore: number
  }
}

/**
 * 桶类型
 */
export type BucketType = 'A' | 'B' | 'C' | 'D' | 'S'

export const DEFAULT_PRODUCT_CLUSTER_BUCKETS = {
  A: {
    intent: '品牌商品锚点',
    intentEn: 'Brand Product Anchor',
    description: '品牌词与商品/型号锚点明确的候选词',
  },
  B: {
    intent: '商品需求场景',
    intentEn: 'Demand Scenario',
    description: '用户有明确商品需求或使用场景的候选词',
  },
  C: {
    intent: '功能规格特性',
    intentEn: 'Feature / Spec',
    description: '用户关注功能、参数或规格的候选词',
  },
  D: {
    intent: '商品需求扩展',
    intentEn: 'Demand Expansion',
    description: '用于补足商品需求覆盖的高相关候选词',
  },
} as const

export const DEFAULT_STORE_CLUSTER_BUCKETS = {
  A: {
    intent: '品牌商品集合',
    intentEn: 'Brand Collection',
    description: '用户认可品牌，想了解品牌下的核心商品集合',
  },
  B: {
    intent: '商品需求场景',
    intentEn: 'Demand Scenario',
    description: '用户有明确商品需求或使用场景',
  },
  C: {
    intent: '热门商品线',
    intentEn: 'Hot Product Line',
    description: '用户想了解店铺热销商品线、系列或热门型号',
  },
  D: {
    intent: '信任服务信号',
    intentEn: 'Trust Service',
    description: '用户关注店铺服务、保障和可信信号',
  },
  S: {
    intent: '店铺全量覆盖',
    intentEn: 'Store Coverage',
    description: '用户想全面了解店铺商品与产品线',
  },
} as const

export interface CoverageKeywordConfig {
  maxNonBrandKeywords: number
  sortByVolume: boolean
  minSearchVolume: number
  language?: string
}

export type SyntheticKeywordConfig = CoverageKeywordConfig

export const DEFAULT_COVERAGE_KEYWORD_CONFIG: CoverageKeywordConfig = {
  maxNonBrandKeywords: 15,
  sortByVolume: true,
  minSearchVolume: 100,
}

export interface BucketCreativeOptions {
  bucket: BucketType
  theme: string
  keywords: string[]
  bucketIntent: string
}

export interface ClusteringStrategy {
  bucketCount: 1 | 2 | 3
  strategy: 'single' | 'dual' | 'full'
  message: string
}

export interface GetKeywordsOptions {
  bucket?: 'A' | 'B' | 'C' | 'D' | 'S' | 'ALL'
  intent?: 'brand' | 'scenario' | 'feature' | 'demand' | CanonicalCreativeType
  creativeType?: CanonicalCreativeType | 'brand_focus' | 'model_focus' | 'brand_product'
  minSearchVolume?: number
  maxKeywords?: number
}

export interface GetKeywordsResult {
  keywords: PoolKeywordData[]
  buckets?: {
    A?: { intent: string; keywords: PoolKeywordData[] }
    B?: { intent: string; keywords: PoolKeywordData[] }
    C?: { intent: string; keywords: PoolKeywordData[] }
    D?: { intent: string; keywords: PoolKeywordData[] }
  }
  stats: {
    totalCount: number
    bucketACount?: number
    bucketBCount?: number
    bucketCCount?: number
    bucketDCount?: number
    searchVolumeRange?: { min: number; max: number }
  }
  meta: {
    offerId: number
    createdAt?: string
    updatedAt?: string
    hasMultipleRounds?: boolean
  }
}
