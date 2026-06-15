import type { Dispatch, SetStateAction } from 'react'

export type ReportCurrencyInfo = {
  currency: string
  currencies: string[]
  hasMixedCurrency: boolean
}

export type ReportCurrencyApiPayload = {
  currency?: string
  currencies?: string[]
  hasMixedCurrency?: boolean
}

export function isSameReportCurrencyInfo(
  prev: ReportCurrencyInfo | null,
  next: ReportCurrencyInfo
): boolean {
  return (
    prev !== null &&
    prev.currency === next.currency &&
    prev.hasMixedCurrency === next.hasMixedCurrency &&
    prev.currencies.length === next.currencies.length &&
    prev.currencies.every((currency, index) => currency === next.currencies[index])
  )
}

/**
 * Sync currency metadata from an API response without triggering redundant re-fetches.
 *
 * `reportCurrency` should only reflect a user-selected filter. This helper updates
 * `currencyInfo` for display defaults and validates an existing user selection when
 * the available currency list changes — it never auto-initializes `reportCurrency`.
 */
export function applyCurrencyFromApiResponse(
  data: ReportCurrencyApiPayload,
  setCurrencyInfo: Dispatch<SetStateAction<ReportCurrencyInfo | null>>,
  setReportCurrency: Dispatch<SetStateAction<string | null>>
): void {
  if (!data.currency || !Array.isArray(data.currencies)) return

  const nextCurrencyInfo: ReportCurrencyInfo = {
    currency: data.currency,
    currencies: data.currencies,
    hasMixedCurrency: Boolean(data.hasMixedCurrency),
  }

  setCurrencyInfo((prev) =>
    isSameReportCurrencyInfo(prev, nextCurrencyInfo) ? prev : nextCurrencyInfo
  )
  setReportCurrency((prev) => {
    if (!prev) return null
    return data.currencies!.includes(prev) ? prev : null
  })
}

export function resolveSelectedReportCurrency(
  reportCurrency: string | null,
  currencyInfo: ReportCurrencyInfo | null,
  fallback = 'USD'
): string {
  return reportCurrency || currencyInfo?.currency || fallback
}

export function buildReportCurrencyQueryParam(reportCurrency: string | null): string {
  return reportCurrency ? `&currency=${encodeURIComponent(reportCurrency)}` : ''
}
