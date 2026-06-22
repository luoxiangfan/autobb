/**
 * Unified keyword service — shared types.
 */
import type { KeywordPlannerPreparedSession } from '@/lib/google-ads/accounts/auth/index'

export type KeywordPlannerSessionAuth = KeywordPlannerPreparedSession

export type KeywordPlannerSessionAuthResult =
  | { ok: true; session: KeywordPlannerSessionAuth }
  | { ok: false; message: string }

export interface UnifiedKeywordData {
  keyword: string
  searchVolume: number
  competition: string
  competitionIndex: number
  lowTopPageBid: number
  highTopPageBid: number
  source: 'BRAND' | 'CATEGORY' | 'FEATURE' | 'EXPANSION'
  matchType: 'EXACT' | 'PHRASE' | 'BROAD'
  volumeUnavailableReason?: 'DEV_TOKEN_INSUFFICIENT_ACCESS'
}

/**
 * 白名单过滤结果（P0-2优化：包含竞品品牌提取）
 */
export interface WhitelistFilterResult<T> {
  /** 过滤后的关键词 */
  filtered: T[]
  /** 识别到的竞品品牌（可用作否定关键词） */
  competitorBrands: string[]
  /** 统计信息 */
  stats: {
    brandKept: number // 品牌词保留数
    genericKept: number // 通用词保留数
    competitorFiltered: number // 竞品词过滤数
    misspellingFiltered?: number // 🔥 新增(2025-12-16): 拼写错误过滤数
  }
}

/**
 * 统一关键词服务返回结果（P0-2优化：包含竞品品牌）
 */
export interface UnifiedKeywordResult {
  /** 关键词列表 */
  keywords: UnifiedKeywordData[]
  /** 识别到的竞品品牌（建议用作否定关键词） */
  competitorBrands: string[]
}

export interface OfferData {
  brand: string
  category?: string | null
  /** 可选：用于 Keyword Planner 的站点过滤（origin级别会在调用处做归一化） */
  url?: string | null
  /** 可选：最终落地页URL（优先用于站点过滤） */
  final_url?: string | null
  /** 可选：camelCase 兼容字段 */
  finalUrl?: string | null
  productTitle?: string
  productFeatures?: string
  storeProductNames?: string[]
  scrapedData?: string
  reviewAnalysis?: string
  brandAnalysis?: string
}

export interface VerifiedKeywordSourcePool {
  titleKeywords: string[]
  aboutKeywords: string[]
  paramKeywords: string[]
  hotProductKeywords: string[]
  pageKeywords: string[]
  hotProductNames: string[]
  evidenceTerms: string[]
}

export interface KeywordServiceParams {
  offer: OfferData
  country: string
  language: string
  customerId?: string
  refreshToken?: string
  accountId?: number
  userId?: number
  // 认证类型（支持服务账号模式；日志用，API 认证以 prepare 结果为准）
  authType?: 'oauth' | 'service_account'
  /** Offer ID：用于解析 linked service_account_id */
  offerId?: number
  /** 显式 linked SA；未传且提供 offerId 时自动解析 */
  linkedServiceAccountId?: string | null
  /** @deprecated 请用 linkedServiceAccountId；未传 linked 时作为显式 SA */
  serviceAccountId?: string
  /** 已由 loadKeywordPoolExpandCredentialsForOffer prepare 时传入，避免重复 heal */
  plannerSession?: KeywordPlannerSessionAuth
  // 可选配置
  minSearchVolume?: number
  maxKeywords?: number
}

export interface IntentAwareSeedPool {
  /** 品牌商品锚点种子词 (legacy 桶A) */
  brandOrientedSeeds: string[]
  /** 商品需求场景种子词 (legacy 桶B) */
  scenarioOrientedSeeds: string[]
  /** 功能规格/需求扩展种子词 (legacy 桶C) */
  featureOrientedSeeds: string[]
  /** 所有种子词（合并去重） */
  allSeeds: string[]
}
