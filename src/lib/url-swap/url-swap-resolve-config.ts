import { resolveAffiliateLink } from '@/lib/scraping'

const URL_SWAP_PROXY_RETRY_ATTEMPTS = (() => {
  const raw = parseInt(process.env.URL_SWAP_PROXY_RETRY_ATTEMPTS || '3', 10)
  return Number.isFinite(raw) && raw >= 1 ? raw : 3
})()

const URL_SWAP_PROXY_RETRY_BASE_DELAY_MS = (() => {
  const raw = parseInt(process.env.URL_SWAP_PROXY_RETRY_BASE_DELAY_MS || '1200', 10)
  return Number.isFinite(raw) && raw >= 0 ? raw : 1200
})()

const URL_SWAP_PROXY_RETRY_MAX_DELAY_MS = (() => {
  const raw = parseInt(process.env.URL_SWAP_PROXY_RETRY_MAX_DELAY_MS || '6000', 10)
  const normalized = Number.isFinite(raw) && raw >= 0 ? raw : 6000
  return Math.max(URL_SWAP_PROXY_RETRY_BASE_DELAY_MS, normalized)
})()

const URL_SWAP_PROXY_RETRYABLE_ERRORS = [
  'timeout',
  'Timeout',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENETUNREACH',
  '状态码 5',
  'HTTP 5',
  'EPROTO',
  'wrong version number',
  'ssl3_get_record',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_EMPTY_RESPONSE',
  'ERR_CONNECTION_CLOSED',
  'ERR_HTTP2_PROTOCOL_ERROR',
  'ERR_PROXY_CONNECTION_FAILED',
  'net::ERR_EMPTY_RESPONSE',
  'net::ERR_HTTP2_PROTOCOL_ERROR',
  'TimeoutError',
  'waiting until',
  'IPRocket API business error',
  'Business abnormality',
  'business abnormality',
  '业务异常',
  'contact customer service',
  '联系客服',
]

export function buildUrlSwapResolveRetryConfig() {
  return {
    maxRetries: Math.max(0, URL_SWAP_PROXY_RETRY_ATTEMPTS - 1),
    baseDelay: URL_SWAP_PROXY_RETRY_BASE_DELAY_MS,
    maxDelay: URL_SWAP_PROXY_RETRY_MAX_DELAY_MS,
    retryableErrors: URL_SWAP_PROXY_RETRYABLE_ERRORS,
  }
}

export async function resolveAffiliateLinkForUrlSwap(params: {
  affiliateLink: string
  targetCountry: string
  userId: number
}): Promise<Awaited<ReturnType<typeof resolveAffiliateLink>>> {
  return resolveAffiliateLink(params.affiliateLink, {
    targetCountry: params.targetCountry,
    userId: params.userId,
    skipCache: true,
    retryConfig: buildUrlSwapResolveRetryConfig(),
  })
}

export function shouldRetryUrlSwapTargetOnSameSuffix(target: {
  last_error?: string | null
  consecutive_failures?: number | null
}): boolean {
  return Boolean(target.last_error) || (target.consecutive_failures ?? 0) > 0
}
