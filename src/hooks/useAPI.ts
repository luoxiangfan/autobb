/**
 * ⚡ P0性能优化: SWR统一数据获取hooks
 *
 * 优势：
 * - 自动请求去重：同一资源的并发请求只发起一次
 * - 跨组件缓存：不同组件共享相同数据，减少API调用
 * - 自动重新验证：切换标签页返回时自动刷新
 * - 乐观UI更新：配合mutate实现即时反馈
 *
 * 预期收益：减少50% API调用
 */
import useSWR, { type SWRConfiguration } from 'swr'

// 通用fetcher
const fetcher = async (url: string) => {
  const res = await fetch(url)

  if (!res.ok) {
    const error: any = new Error('API request failed')
    error.status = res.status
    error.info = await res.json()
    throw error
  }

  return res.json()
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 分层SWR配置 - 根据数据更新频率选择合适的配置
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 静态数据配置 - 数据很少变化
 * 适用：用户信息、配置项、字典数据
 */
const staticConfig: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  dedupingInterval: 300000,      // 5分钟内去重
  errorRetryCount: 2,
  errorRetryInterval: 2000,
  refreshInterval: 0,            // 不自动刷新
}

/**
 * 低频更新配置 - 数据变化较慢
 * 适用：Offer列表、账户列表
 */
const lowFreqConfig: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  dedupingInterval: 60000,       // 60秒内去重
  errorRetryCount: 3,
  errorRetryInterval: 1000,
  refreshInterval: 0,
}

/**
 * 中频更新配置 - 数据定期更新
 * 适用：Dashboard KPI、广告系列数据
 */
const mediumFreqConfig: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  dedupingInterval: 30000,       // 30秒内去重
  errorRetryCount: 3,
  errorRetryInterval: 1000,
  refreshInterval: 5 * 60 * 1000, // 每5分钟刷新
}

/**
 * 高频更新配置 - 数据实时变化
 * 适用：同步状态、队列任务
 */
const highFreqConfig: SWRConfiguration = {
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  dedupingInterval: 10000,       // 10秒内去重
  errorRetryCount: 2,
  errorRetryInterval: 500,
  refreshInterval: 30 * 1000,   // 每30秒刷新
}

/**
 * 默认配置 - 平衡性能和实时性
 */
const defaultConfig: SWRConfiguration = lowFreqConfig

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据获取Hooks
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Offers数据获取
 */
export function useOffers(options?: {
  summary?: boolean
  limit?: number
  offset?: number
  isActive?: boolean
  targetCountry?: string
}) {
  const params = new URLSearchParams()
  if (options?.summary !== undefined) params.append('summary', String(options.summary))
  if (options?.limit) params.append('limit', String(options.limit))
  if (options?.offset) params.append('offset', String(options.offset))
  if (options?.isActive !== undefined) params.append('isActive', String(options.isActive))
  if (options?.targetCountry) params.append('targetCountry', options.targetCountry)

  const url = `/api/offers${params.toString() ? `?${params}` : ''}`

  const { data, error, isLoading, mutate } = useSWR(url, fetcher, defaultConfig)

  return {
    offers: data?.data,
    total: data?.total,
    isLoading,
    isError: error,
    refresh: mutate,
  }
}

/**
 * 单个Offer详情
 */
export function useOffer(offerId: number | string) {
  const { data, error, isLoading, mutate } = useSWR(
    offerId ? `/api/offers/${offerId}` : null,
    fetcher,
    defaultConfig
  )

  return {
    offer: data?.data,
    isLoading,
    isError: error,
    refresh: mutate,
  }
}

/**
 * Dashboard KPI数据
 */
export function useDashboardKPIs(days: number = 30) {
  const { data, error, isLoading, mutate } = useSWR(
    `/api/dashboard/kpis?days=${days}`,
    fetcher,
    mediumFreqConfig  // 使用中频更新配置
  )

  return {
    kpis: data?.data,
    isLoading,
    isError: error,
    refresh: mutate,
  }
}

/**
 * Dashboard摘要数据（聚合API）
 */
export function useDashboardSummary(days: number = 30) {
  const { data, error, isLoading, mutate } = useSWR(
    `/api/dashboard/summary?days=${days}`,
    fetcher,
    mediumFreqConfig  // 使用中频更新配置
  )

  return {
    kpis: data?.kpis,
    riskAlerts: data?.riskAlerts,
    topOffers: data?.topOffers,
    cached: data?.cached,
    isLoading,
    isError: error,
    refresh: mutate,
  }
}

/**
 * Campaigns列表
 */
export function useCampaigns(options?: {
  offerId?: number
  accountId?: number
  status?: string
}) {
  const params = new URLSearchParams()
  if (options?.offerId) params.append('offerId', String(options.offerId))
  if (options?.accountId) params.append('accountId', String(options.accountId))
  if (options?.status) params.append('status', options.status)

  const url = `/api/campaigns${params.toString() ? `?${params}` : ''}`

  const { data, error, isLoading, mutate } = useSWR(url, fetcher, defaultConfig)

  return {
    campaigns: data?.data,
    total: data?.total,
    isLoading,
    isError: error,
    refresh: mutate,
  }
}

/**
 * Google Ads账号列表
 */
export function useGoogleAdsAccounts(includeIdle?: boolean) {
  const url = `/api/ads-accounts${includeIdle ? '/idle' : ''}`

  const { data, error, isLoading, mutate } = useSWR(url, fetcher, defaultConfig)

  return {
    accounts: data?.data || data?.accounts,
    total: data?.total,
    isLoading,
    isError: error,
    refresh: mutate,
  }
}

/**
 * Creative列表
 */
export function useCreatives(offerId?: number) {
  const url = offerId ? `/api/creatives?offerId=${offerId}` : '/api/creatives'

  const { data, error, isLoading, mutate } = useSWR(url, fetcher, defaultConfig)

  return {
    creatives: data?.data,
    total: data?.total,
    isLoading,
    isError: error,
    refresh: mutate,
  }
}

/**
 * AB测试列表
 */
export function useABTests() {
  const { data, error, isLoading, mutate } = useSWR(
    '/api/ab-tests',
    fetcher,
    defaultConfig
  )

  return {
    tests: data?.data,
    isLoading,
    isError: error,
    refresh: mutate,
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 导出配置供外部使用
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export { staticConfig, lowFreqConfig, mediumFreqConfig, highFreqConfig }
