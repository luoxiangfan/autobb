/**
 * 浏览器端：Launch Score API 的 campaignConfig 传递（与 Step3 / 发布 hash 对齐）
 */

export type LaunchScoreHashCampaignConfigClient = {
  budgetAmount?: number
  maxCpcBid?: number
  targetCountry?: string
  targetLanguage?: string
  keywords?: unknown[]
}

const STORAGE_PREFIX = 'launch-score-campaign-config:'

function parseOptionalNumber(value: string | null): number | undefined {
  if (value == null || value === '') {
    return undefined
  }
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

export function storageKeyForLaunchScoreCampaignConfig(offerId: number): string {
  return `${STORAGE_PREFIX}${offerId}`
}

export function pickLaunchScoreHashCampaignConfigFromStep3(config: {
  budgetAmount?: number
  maxCpcBid?: number
  targetCountry?: string
  targetLanguage?: string
  keywords?: unknown[]
} | null | undefined): LaunchScoreHashCampaignConfigClient | undefined {
  if (!config) {
    return undefined
  }

  const picked: LaunchScoreHashCampaignConfigClient = {}
  if (typeof config.budgetAmount === 'number' && Number.isFinite(config.budgetAmount)) {
    picked.budgetAmount = config.budgetAmount
  }
  if (typeof config.maxCpcBid === 'number' && Number.isFinite(config.maxCpcBid)) {
    picked.maxCpcBid = config.maxCpcBid
  }
  if (typeof config.targetCountry === 'string' && config.targetCountry.trim()) {
    picked.targetCountry = config.targetCountry.trim()
  }
  if (typeof config.targetLanguage === 'string' && config.targetLanguage.trim()) {
    picked.targetLanguage = config.targetLanguage.trim()
  }
  if (Array.isArray(config.keywords) && config.keywords.length > 0) {
    picked.keywords = config.keywords
  }

  if (
    picked.budgetAmount == null
    && picked.maxCpcBid == null
    && !picked.targetCountry
    && !picked.targetLanguage
    && !picked.keywords?.length
  ) {
    return undefined
  }

  return picked
}

export function saveLaunchScoreCampaignConfigForOffer(
  offerId: number,
  config: LaunchScoreHashCampaignConfigClient
): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    sessionStorage.setItem(
      storageKeyForLaunchScoreCampaignConfig(offerId),
      JSON.stringify(config)
    )
  } catch {
    // sessionStorage 不可用时静默降级
  }
}

export function loadLaunchScoreCampaignConfigForOffer(
  offerId: number
): LaunchScoreHashCampaignConfigClient | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }
  try {
    const raw = sessionStorage.getItem(storageKeyForLaunchScoreCampaignConfig(offerId))
    if (!raw) {
      return undefined
    }
    const parsed = JSON.parse(raw) as LaunchScoreHashCampaignConfigClient
    return pickLaunchScoreHashCampaignConfigFromStep3(parsed)
  } catch {
    return undefined
  }
}

/** 从 Launch Score 页 URL 查询参数解析（与 API parseLaunchScoreHashCampaignConfigFromSearchParams 一致） */
type SearchParamsLike = Pick<URLSearchParams, 'get'>

export function parseLaunchScoreHashCampaignConfigFromSearchParamsClient(
  searchParams: SearchParamsLike
): LaunchScoreHashCampaignConfigClient | undefined {
  const embedded = searchParams.get('campaignConfig')
  if (embedded) {
    try {
      const parsed = JSON.parse(embedded) as LaunchScoreHashCampaignConfigClient
      const picked = pickLaunchScoreHashCampaignConfigFromStep3(parsed)
      if (picked) {
        return picked
      }
    } catch {
      // fall through
    }
  }

  const budgetAmount = parseOptionalNumber(searchParams.get('budgetAmount'))
  const maxCpcBid = parseOptionalNumber(searchParams.get('maxCpcBid'))
  const targetCountry = searchParams.get('targetCountry')?.trim() || undefined
  const targetLanguage = searchParams.get('targetLanguage')?.trim() || undefined

  if (
    budgetAmount == null
    && maxCpcBid == null
    && !targetCountry
    && !targetLanguage
  ) {
    return undefined
  }

  return {
    budgetAmount,
    maxCpcBid,
    targetCountry,
    targetLanguage,
  }
}

/** URL 优先，其次 sessionStorage（Launch Step3 写入） */
export function resolveLaunchScoreHashCampaignConfigForClient(
  offerId: number,
  searchParams: SearchParamsLike
): LaunchScoreHashCampaignConfigClient | undefined {
  const fromUrl = parseLaunchScoreHashCampaignConfigFromSearchParamsClient(searchParams)
  if (fromUrl) {
    return fromUrl
  }
  return loadLaunchScoreCampaignConfigForOffer(offerId)
}

export function appendLaunchScoreCampaignConfigToSearchParams(
  params: URLSearchParams,
  config?: LaunchScoreHashCampaignConfigClient
): void {
  if (!config) {
    return
  }

  const hasKeywords = Array.isArray(config.keywords) && config.keywords.length > 0

  // 含关键词时用 JSON，便于新标签页/分享链接与发布 hash 对齐（服务端无法读 sessionStorage）
  if (hasKeywords) {
    const payload: LaunchScoreHashCampaignConfigClient = {}
    if (config.budgetAmount != null) {
      payload.budgetAmount = config.budgetAmount
    }
    if (config.maxCpcBid != null) {
      payload.maxCpcBid = config.maxCpcBid
    }
    if (config.targetCountry) {
      payload.targetCountry = config.targetCountry
    }
    if (config.targetLanguage) {
      payload.targetLanguage = config.targetLanguage
    }
    payload.keywords = config.keywords
    params.set('campaignConfig', JSON.stringify(payload))
    return
  }

  if (config.budgetAmount != null) {
    params.set('budgetAmount', String(config.budgetAmount))
  }
  if (config.maxCpcBid != null) {
    params.set('maxCpcBid', String(config.maxCpcBid))
  }
  if (config.targetCountry) {
    params.set('targetCountry', config.targetCountry)
  }
  if (config.targetLanguage) {
    params.set('targetLanguage', config.targetLanguage)
  }
}

export function buildLaunchScoreApiQueryString(
  creativeId: string | null | undefined,
  config?: LaunchScoreHashCampaignConfigClient,
  options?: { includePerformance?: boolean; daysBack?: number }
): string {
  const params = new URLSearchParams()
  if (creativeId) {
    params.set('creativeId', creativeId)
  }
  appendLaunchScoreCampaignConfigToSearchParams(params, config)
  if (options?.includePerformance) {
    params.set('includePerformance', 'true')
    if (options.daysBack != null) {
      params.set('daysBack', String(options.daysBack))
    }
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

/** Launch Score 独立页路径（含 offerId / creativeId / Step3 投放配置） */
export function buildLaunchScorePagePath(input: {
  offerId: number
  creativeId?: number | null
  campaignConfig?: LaunchScoreHashCampaignConfigClient
}): string {
  const params = new URLSearchParams()
  params.set('offerId', String(input.offerId))
  if (input.creativeId != null) {
    params.set('creativeId', String(input.creativeId))
  }
  appendLaunchScoreCampaignConfigToSearchParams(params, input.campaignConfig)
  return `/launch-score?${params.toString()}`
}

export function clearLaunchScoreCampaignConfigForOffer(offerId: number): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    sessionStorage.removeItem(storageKeyForLaunchScoreCampaignConfig(offerId))
  } catch {
    // ignore
  }
}

/** 稳定序列化 URL 查询中的 campaignConfig 字段（用于 React 依赖） */
export function serializeLaunchScoreCampaignConfigQueryKey(
  searchParams: SearchParamsLike
): string {
  return [
    searchParams.get('budgetAmount') ?? '',
    searchParams.get('maxCpcBid') ?? '',
    searchParams.get('targetCountry') ?? '',
    searchParams.get('targetLanguage') ?? '',
    searchParams.get('campaignConfig') ?? '',
  ].join('|')
}
