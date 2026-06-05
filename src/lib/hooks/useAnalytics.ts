import useSWR from 'swr'

// Fetcher function for SWR
const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then((res) => {
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
export function useROIAnalytics(
  startDate: string,
  endDate: string,
  currency?: string | null,
  options = {}
) {
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
    currencyInfo:
      data?.currency && Array.isArray(data?.currencies)
        ? {
            currency: data.currency,
            currencies: data.currencies,
            hasMixedCurrency: Boolean(data.hasMixedCurrency),
          }
        : null,
    error,
    isLoading,
    refresh: mutate,
  }
}

/**
 * Hook for budget analytics data
 */
export function useBudgetAnalytics(
  startDate: string,
  endDate: string,
  currency?: string | null,
  options = {}
) {
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
    currencyInfo:
      data?.currency && Array.isArray(data?.currencies)
        ? {
            currency: data.currency,
            currencies: data.currencies,
            hasMixedCurrency: Boolean(data.hasMixedCurrency),
          }
        : null,
    error,
    isLoading,
    refresh: mutate,
  }
}
