import type { PlannerNonBrandPolicy } from './planner/planner-non-brand-policy'

export interface KeywordQualityFilterOptions {
  brandName: string
  category?: string
  productName?: string
  targetCountry?: string
  targetLanguage?: string
  minWordCount?: number // 最少单词数
  maxWordCount?: number // 最多单词数
  productUrl?: string // 🔥 新增：产品URL，用于平台冲突检测
  /**
   * 是否必须包含纯品牌词
   * @default true
   */
  mustContainBrand?: boolean
  /**
   * 允许来自 Keyword Planner 的非品牌词通过品牌门禁
   * 仅在品牌词过于宽泛或店铺页需要更广泛覆盖时使用
   * @default false
   */
  allowNonBrandFromPlanner?: boolean | PlannerNonBrandPolicy
  /**
   * 与商品/品类相关性过滤（防歧义品牌误入无关主题）
   * - 当品牌词有歧义（如 "Rove"）时，Keyword Planner 可能返回包含品牌但主题无关的关键词（如 rove beetle, rove concept）。
   * - 启用后：除“纯品牌词”/“型号词”外，关键词必须命中至少 N 个来自 category/productName 的 token 才保留。
   *
   * @default 0 (关闭)
   */
  minContextTokenMatches?: number
  /**
   * 相关性不匹配处理方式
   * hard: 直接过滤
   * soft: 不直接过滤，只在评分中降级
   *
   * @default 'hard'
   */
  contextMismatchMode?: 'hard' | 'soft'
}
export type RelevanceMode =
  | 'disabled'
  | 'pure_brand'
  | 'model_like'
  | 'insufficient_context'
  | 'context_match'
  | 'context_mismatch'
