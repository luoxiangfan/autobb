import useSWR from 'swr'
import {
  appendLaunchScoreCampaignConfigToSearchParams,
  type LaunchScoreHashCampaignConfigClient,
} from '@/lib/launch-score-campaign-config-client'

// Fetcher function for SWR
const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((res) => {
  if (!res.ok) {
    throw new Error('Failed to fetch data')
  }
  return res.json()
})

// SWR configuration
const swrConfig = {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  dedupingInterval: 5000, // 5 seconds deduplication
  refreshInterval: 0, // No automatic refresh by default
}

/**
 * Hook for ROI analytics data
 */
export function useROIAnalytics(startDate: string, endDate: string, currency?: string | null, options = {}) {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
  })
  if (currency) {
    params.set('currency', currency)
  }

  const { data, error, isLoading, mutate } = useSWR(
    `/api/analytics/roi?${params.toString()}`,
    fetcher,
    { ...swrConfig, ...options }
  )

  return {
    data: data?.data,
    currencyInfo: data?.currency && Array.isArray(data?.currencies)
      ? { currency: data.currency, currencies: data.currencies, hasMixedCurrency: Boolean(data.hasMixedCurrency) }
      : null,
    error,
    isLoading,
    refresh: mutate,
  }
}

/**
 * Hook for budget analytics data
 */
export function useBudgetAnalytics(startDate: string, endDate: string, currency?: string | null, options = {}) {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
  })
  if (currency) {
    params.set('currency', currency)
  }

  const { data, error, isLoading, mutate } = useSWR(
    `/api/analytics/budget?${params.toString()}`,
    fetcher,
    { ...swrConfig, ...options }
  )

  return {
    data: data?.data,
    currencyInfo: data?.currency && Array.isArray(data?.currencies)
      ? { currency: data.currency, currencies: data.currencies, hasMixedCurrency: Boolean(data.hasMixedCurrency) }
      : null,
    error,
    isLoading,
    refresh: mutate,
  }
}

/**
 * Hook for campaign performance data
 */
export function useCampaignPerformance(daysBack: number = 7, options = {}) {
  const params = new URLSearchParams({
    daysBack: daysBack.toString(),
  })

  const { data, error, isLoading, mutate } = useSWR(
    `/api/campaigns/performance?${params.toString()}`,
    fetcher,
    { ...swrConfig, ...options }
  )

  return {
    campaigns: data?.campaigns || [],
    summary: data?.summary,
    error,
    isLoading,
    refresh: mutate,
  }
}

/**
 * Hook for A/B test results
 */
export function useABTestResults(testId: string, options = {}) {
  const { data, error, isLoading, mutate } = useSWR(
    testId ? `/api/ab-tests/${testId}/results` : null,
    fetcher,
    { ...swrConfig, ...options }
  )

  return {
    result: data,
    error,
    isLoading,
    refresh: mutate,
  }
}

/**
 * Hook for Offer performance data
 */
export function useOfferPerformance(offerId: string, startDate: string, endDate: string, options = {}) {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
  })

  const { data, error, isLoading, mutate } = useSWR(
    offerId ? `/api/offers/${offerId}/performance?${params.toString()}` : null,
    fetcher,
    { ...swrConfig, ...options }
  )

  return {
    performance: data?.data,
    error,
    isLoading,
    refresh: mutate,
  }
}

/**
 * Hook for Campaign trends
 */
export function useCampaignTrends(startDate: string, endDate: string, options = {}) {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
  })

  const { data, error, isLoading, mutate } = useSWR(
    `/api/campaigns/trends?${params.toString()}`,
    fetcher,
    { ...swrConfig, ...options }
  )

  return {
    trends: data?.data,
    error,
    isLoading,
    refresh: mutate,
  }
}

/**
 * Hook for launch score performance (GET /api/offers/:id/launch-score/performance)
 */
export type UseLaunchScorePerformanceOptions = {
  creativeId?: number | string | null
  daysBack?: number
  avgOrderValue?: number
  campaignConfig?: LaunchScoreHashCampaignConfigClient
}

export function useLaunchScorePerformance(
  offerId: string | null | undefined,
  options: UseLaunchScorePerformanceOptions = {},
  swrOptions = {}
) {
  const params = new URLSearchParams()
  params.set('daysBack', String(options.daysBack ?? 30))
  if (options.creativeId != null && options.creativeId !== '') {
    params.set('creativeId', String(options.creativeId))
  }
  if (options.avgOrderValue != null) {
    params.set('avgOrderValue', String(options.avgOrderValue))
  }
  appendLaunchScoreCampaignConfigToSearchParams(params, options.campaignConfig)

  const query = params.toString()
  const key = offerId
    ? `/api/offers/${offerId}/launch-score/performance?${query}`
    : null

  const { data, error, isLoading, mutate } = useSWR(
    key,
    fetcher,
    { ...swrConfig, ...swrOptions }
  )

  return {
    data,
    success: data?.success === true,
    hasLaunchScore: data?.hasLaunchScore === true,
    hasPerformanceData: data?.hasPerformanceData === true,
    creativeId: data?.creativeId as number | undefined,
    launchScore: data?.launchScore,
    performanceData: data?.performanceData,
    comparisons: data?.comparisons,
    adjustedRecommendations: data?.adjustedRecommendations,
    accuracyScore: data?.accuracyScore,
    message: data?.message as string | undefined,
    stale: data?.stale === true,
    error,
    isLoading,
    refresh: mutate,
    /** @deprecated API returns flat JSON; use top-level fields or `data` */
    performance: data,
  }
}
