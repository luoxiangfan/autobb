import type { Offer } from './offers'
import type { CampaignConfigData } from './launch-scores'
import type { LaunchScoreCampaignConfig } from './scoring'

/** 与 contentHash 缓存查询一致的投放配置（Step3：预算/国家/语言/关键词） */
export type LaunchScoreHashCampaignConfig = {
  budgetAmount?: number
  maxCpcBid?: number
  targetCountry?: string
  targetLanguage?: string
  /** Step3 用户配置关键词（优先于创意 DB 的 keywords_with_volume） */
  keywords?: unknown[]
}

export const DEFAULT_LAUNCH_SCORE_DAILY_BUDGET = 10
export const DEFAULT_LAUNCH_SCORE_MAX_CPC = 0.17

function parseOptionalPositiveNumber(value: unknown): number | undefined {
  if (value == null || value === '') {
    return undefined
  }
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed || undefined
}

/**
 * 从 JSON 字符串或对象解析 API 传入的 campaignConfig（用于 hash 与计分）。
 */
export function parseLaunchScoreHashCampaignConfig(
  input: unknown
): LaunchScoreHashCampaignConfig | undefined {
  if (input == null) {
    return undefined
  }

  let source: Record<string, unknown>
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input) as unknown
      if (!parsed || typeof parsed !== 'object') {
        return undefined
      }
      source = parsed as Record<string, unknown>
    } catch {
      return undefined
    }
  } else if (typeof input === 'object') {
    source = input as Record<string, unknown>
  } else {
    return undefined
  }

  const budgetAmount = parseOptionalPositiveNumber(source.budgetAmount)
  const maxCpcBid = parseOptionalPositiveNumber(source.maxCpcBid)
  const targetCountry = parseOptionalString(source.targetCountry)
  const targetLanguage = parseOptionalString(source.targetLanguage)
  const keywords = Array.isArray(source.keywords) ? source.keywords : undefined

  if (
    budgetAmount == null
    && maxCpcBid == null
    && !targetCountry
    && !targetLanguage
    && !keywords?.length
  ) {
    return undefined
  }

  return {
    budgetAmount,
    maxCpcBid,
    targetCountry,
    targetLanguage,
    ...(keywords?.length ? { keywords } : {}),
  }
}

/** 从 GET query 解析 campaignConfig（支持 JSON 或独立字段） */
export function parseLaunchScoreHashCampaignConfigFromSearchParams(
  searchParams: URLSearchParams
): LaunchScoreHashCampaignConfig | undefined {
  const embedded = searchParams.get('campaignConfig')
  if (embedded) {
    const fromJson = parseLaunchScoreHashCampaignConfig(embedded)
    if (fromJson) {
      return fromJson
    }
  }

  return parseLaunchScoreHashCampaignConfig({
    budgetAmount: searchParams.get('budgetAmount'),
    maxCpcBid: searchParams.get('maxCpcBid'),
    targetCountry: searchParams.get('targetCountry'),
    targetLanguage: searchParams.get('targetLanguage'),
  })
}

export function toCampaignConfigHashData(
  config: LaunchScoreHashCampaignConfig | undefined,
  offer: Offer,
  options?: { useZeroBudgetFallback?: boolean }
): CampaignConfigData {
  const budgetFallback = options?.useZeroBudgetFallback ? 0 : DEFAULT_LAUNCH_SCORE_DAILY_BUDGET
  const cpcFallback = options?.useZeroBudgetFallback ? 0 : DEFAULT_LAUNCH_SCORE_MAX_CPC

  return {
    targetCountry: config?.targetCountry || offer.target_country || 'US',
    targetLanguage: config?.targetLanguage || offer.target_language || 'en',
    dailyBudget: config?.budgetAmount ?? budgetFallback,
    maxCpc: config?.maxCpcBid ?? cpcFallback,
  }
}

export function toLaunchScoreScoringCampaignConfig(
  config: LaunchScoreHashCampaignConfig | undefined,
  offer: Offer
): LaunchScoreCampaignConfig | undefined {
  if (!config) {
    return undefined
  }

  return {
    budgetAmount: config.budgetAmount,
    maxCpcBid: config.maxCpcBid,
    targetCountry: config.targetCountry || offer.target_country || undefined,
    targetLanguage: config.targetLanguage || offer.target_language || undefined,
  }
}

/** 发布路径：将 API campaignConfig 转为 hash 用结构（0 表示未配置，与发布逻辑一致） */
export function launchScoreHashConfigFromPublishCampaignConfig(config: {
  targetCountry?: string
  targetLanguage?: string
  budgetAmount?: number
  maxCpcBid?: number
  keywords?: unknown[]
}): LaunchScoreHashCampaignConfig {
  return {
    targetCountry: config.targetCountry || '',
    targetLanguage: config.targetLanguage || '',
    budgetAmount: config.budgetAmount ?? 0,
    maxCpcBid: config.maxCpcBid ?? 0,
    ...(config.keywords?.length ? { keywords: config.keywords } : {}),
  }
}
