import { googleAdsAccountsLogger } from '../common/logger'

const DEBUG_GOOGLE_ADS_ACCOUNTS = process.env.DEBUG_GOOGLE_ADS_ACCOUNTS === '1'

export function debugLog(...args: unknown[]) {
  if (!DEBUG_GOOGLE_ADS_ACCOUNTS) return
  const event = typeof args[0] === 'string' ? args[0] : 'accounts_debug'
  const detail = typeof args[0] === 'string' ? args.slice(1) : args
  googleAdsAccountsLogger.debug(event, { detail })
}

const CustomerStatusMap: Record<number | string, string> = {
  0: 'UNSPECIFIED',
  1: 'UNKNOWN',
  2: 'ENABLED',
  3: 'CANCELED',
  4: 'SUSPENDED',
  5: 'CLOSED',
  UNSPECIFIED: 'UNSPECIFIED',
  UNKNOWN: 'UNKNOWN',
  ENABLED: 'ENABLED',
  CANCELED: 'CANCELED',
  CANCELLED: 'CANCELED',
  SUSPENDED: 'SUSPENDED',
  CLOSED: 'CLOSED',
}

export function formatErrorMessage(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  const maybeMessage = (value as { message?: string })?.message
  if (typeof maybeMessage === 'string') return maybeMessage
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function parseStatus(status: any): string {
  if (status === undefined || status === null) {
    debugLog('[DEBUG] parseStatus: status is undefined or null')
    return 'UNKNOWN'
  }

  if (typeof status === 'object') {
    debugLog('[DEBUG] parseStatus: status is object:', JSON.stringify(status))
    if ('value' in status) {
      status = status.value
    } else if ('name' in status) {
      status = status.name
    }
  }

  debugLog('[DEBUG] parseStatus: processing status:', status, 'type:', typeof status)

  const mapped = CustomerStatusMap[status]
  if (mapped) {
    debugLog('[DEBUG] parseStatus: mapped to:', mapped)
    return mapped
  }

  const statusStr = String(status).toUpperCase()
  debugLog('[DEBUG] parseStatus: fallback to string:', statusStr)
  return statusStr
}

/* * 提取搜索结果数组（处理不同库的返回结构） */
export function extractSearchResults(searchResult: any): any[] {
  if (!searchResult) return []
  if (Array.isArray(searchResult)) return searchResult
  if (typeof searchResult === 'object') {
    if (Array.isArray(searchResult.results)) return searchResult.results
    if (Array.isArray(searchResult.data)) return searchResult.data
    const firstKey = Object.keys(searchResult)[0]
    if (firstKey && Array.isArray(searchResult[firstKey])) return searchResult[firstKey]
  }
  return []
}
