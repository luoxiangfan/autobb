import type { AffiliatePlatform, OfferProductBackfillDecisionReason } from './types'
import {
  DEFAULT_PB_COUNTRY_CODE,
  DEFAULT_PB_FULL_SYNC_COUNTRY_SEQUENCE,
  DEFAULT_YP_DELTA_PRIORITY_PAGE_CAP,
  DEFAULT_YP_MARKETPLACE_TEMPLATES,
  MAX_PB_ASINS_PER_REQUEST,
  PRODUCT_COUNTRY_FILTER_ALIAS_MAP,
  YP_DOM_INTERCEPT_KEYWORDS,
  YP_MARKETPLACE_COUNTRY_MAP,
  YP_PROXY_COUNTRY_ALIAS,
  type ParsedYeahPromosCommission,
  type PartnerboostDtcProduct,
  type PartnerboostDtcProductsResponse,
  type PartnerboostProduct,
  type PartnerboostProductsResponse,
  type YeahPromosDeltaScopePlan,
  type YeahPromosMarketplaceTemplate,
  type YeahPromosMerchant,
  type YeahPromosProxyConfigEntry,
  type YeahPromosResponse,
  type YeahPromosResponseData,
  type YeahPromosTransaction,
  type YeahPromosTransactionsResponse,
  type YeahPromosTransactionsResponseData,
} from './constants'

export function normalizeYeahPromosResultCode(code: unknown): number | null {
  if (code === null || code === undefined || code === '') {
    return null
  }

  const parsed = Number(code)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

export function normalizePartnerboostStatusCode(code: unknown): number | null {
  if (code === null || code === undefined || code === '') {
    return null
  }

  const parsed = Number(code)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

export function normalizePartnerboostProductsList(value: unknown): PartnerboostProduct[] {
  if (Array.isArray(value)) {
    return value
  }

  if (value && typeof value === 'object') {
    const candidates = Object.values(value as Record<string, unknown>)
    return candidates.filter((item) => item && typeof item === 'object') as PartnerboostProduct[]
  }

  return []
}

export function normalizePartnerboostDtcProductsList(value: unknown): PartnerboostDtcProduct[] {
  if (Array.isArray(value)) {
    return value
  }

  if (value && typeof value === 'object') {
    const candidates = Object.values(value as Record<string, unknown>)
    return candidates.filter((item) => item && typeof item === 'object') as PartnerboostDtcProduct[]
  }

  return []
}

export function normalizeBoolFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value > 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === '1' || normalized === 'true' || normalized === 'yes'
  }
  return false
}

export function parseBooleanSetting(value: string | null | undefined, fallback: boolean): boolean {
  if (value === null || value === undefined) return fallback
  const normalized = String(value).trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  return fallback
}

export function extractPartnerboostProductsPayload(payload: PartnerboostProductsResponse): {
  products: PartnerboostProduct[]
  hasMore: boolean
} {
  const products = normalizePartnerboostProductsList(payload.data?.list)
  const hasMore = normalizeBoolFlag(payload.data?.has_more ?? payload.data?.hasMore)

  return {
    products,
    hasMore,
  }
}

export function extractPartnerboostDtcProductsPayload(input: {
  payload: PartnerboostDtcProductsResponse
  page: number
  pageSize: number
}): {
  products: PartnerboostDtcProduct[]
  hasMore: boolean
} {
  const products = normalizePartnerboostDtcProductsList(input.payload.data?.list)
  if (products.length === 0) {
    return {
      products,
      hasMore: false,
    }
  }

  const total = toNumber(input.payload.data?.total)
  if (total !== null) {
    return {
      products,
      hasMore: input.page * input.pageSize < total,
    }
  }

  return {
    products,
    hasMore: products.length >= input.pageSize,
  }
}

export function parseInteger(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
}

export function parseIntegerInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = parseInteger(value, fallback)
  return Math.max(min, Math.min(parsed, max))
}

export function resolveSyncMaxPages(
  requestedMaxPages: number | undefined,
  fallbackMaxPages: number | null,
  maxAllowedPages: number
): number | null {
  const candidates: Array<number | null | undefined> = [requestedMaxPages, fallbackMaxPages]
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue
    const parsed = Math.trunc(Number(candidate))
    if (!Number.isFinite(parsed) || parsed <= 0) continue
    return Math.min(parsed, maxAllowedPages)
  }
  return null
}

export function sleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function randomIntInRange(min: number, max: number): number {
  const normalizedMin = Math.trunc(Math.min(min, max))
  const normalizedMax = Math.trunc(Math.max(min, max))
  if (normalizedMax <= normalizedMin) return normalizedMin
  return normalizedMin + Math.floor(Math.random() * (normalizedMax - normalizedMin + 1))
}

export function calculateExponentialBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  if (attempt <= 0) return 0
  const delay = baseDelayMs * Math.pow(2, attempt - 1)
  return Math.min(delay, maxDelayMs)
}

export function parseHttpStatusFromErrorMessage(message: string): number | undefined {
  const statusMatch = message.match(/\((\d{3})\):/)
  if (!statusMatch) return undefined
  const status = Number(statusMatch[1])
  return Number.isFinite(status) ? status : undefined
}

export function isTransientHttpStatus(responseStatus?: number): boolean {
  const status = Number(responseStatus)
  if (!Number.isFinite(status)) return false

  // 408 Request Timeout - 可重试
  if (status === 408) return true

  // 5xx 服务端错误 - 可重试
  if (status >= 500 && status <= 599) return true

  // 4xx 客户端错误 - 不可重试
  // 特别是 407 Proxy Authentication Required（代理认证失败）
  // 401 Unauthorized, 403 Forbidden, 404 Not Found 等都不应重试
  return false
}

export function isTransientNetworkErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase()

  // 代理认证错误 - 不可重试（配额用完或凭证失效）
  if (normalized.includes('407') || normalized.includes('proxy authentication required')) {
    return false
  }

  // 代理配额/余额错误 - 不可重试
  if (
    normalized.includes('business abnormality') ||
    normalized.includes('account abnormal') ||
    normalized.includes('insufficient balance') ||
    normalized.includes('no credit') ||
    normalized.includes('quota exceeded') ||
    normalized.includes('配额') ||
    normalized.includes('余额不足')
  ) {
    return false
  }

  // 临时网络错误 - 可重试
  return (
    normalized.includes('fetch failed') ||
    normalized.includes('network error') ||
    normalized.includes('socket hang up') ||
    normalized.includes('econnreset') ||
    normalized.includes('etimedout') ||
    normalized.includes('eai_again') ||
    normalized.includes('enotfound') ||
    normalized.includes('econnrefused') ||
    normalized.includes('und_err_connect_timeout') ||
    normalized.includes('bad gateway') ||
    normalized.includes('gateway timeout')
  )
}

export function isJsonParseErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('unexpected end of json input') ||
    normalized.includes('is not valid json') ||
    normalized.includes('json parse') ||
    (normalized.includes('unexpected token') && normalized.includes('json'))
  )
}

/**
 * 检测代理相关的致命错误（不应重试）
 * 包括：407认证失败、配额用完、账户异常等
 */
export function isProxyFatalError(error: unknown): boolean {
  if (!error) return false

  const message = String((error as any)?.message || '')
  const normalized = message.toLowerCase()

  // 407 Proxy Authentication Required
  if (normalized.includes('407') || normalized.includes('proxy authentication required')) {
    return true
  }

  // IPRocket 业务异常
  if (
    normalized.includes('business abnormality') ||
    normalized.includes('account abnormal') ||
    normalized.includes('risk control') ||
    normalized.includes('contact customer service')
  ) {
    return true
  }

  // 代理配额/余额不足
  if (
    normalized.includes('insufficient balance') ||
    normalized.includes('no credit') ||
    normalized.includes('quota exceeded') ||
    normalized.includes('配额用完') ||
    normalized.includes('余额不足')
  ) {
    return true
  }

  return false
}

export function isPartnerboostRateLimited(
  payloadStatusCode: number | null,
  payloadStatusMessage: string,
  responseStatus?: number
): boolean {
  if (responseStatus === 429) return true
  if (payloadStatusCode === 1002) return true

  const normalizedMessage = payloadStatusMessage.toLowerCase()
  return normalizedMessage.includes('too many request') || normalizedMessage.includes('rate limit')
}

export function isPartnerboostRateLimitError(error: unknown): boolean {
  const raw = error as {
    message?: string
    status?: {
      code?: number | string
      msg?: string
    }
  }
  const message = String(raw?.message || '')
  const responseStatus = parseHttpStatusFromErrorMessage(message)
  const payloadStatusCode = normalizePartnerboostStatusCode(raw?.status?.code)
  const payloadStatusMessage = String(raw?.status?.msg || message)

  if (isPartnerboostRateLimited(payloadStatusCode, payloadStatusMessage, responseStatus)) {
    return true
  }

  const normalizedMessage = message.toLowerCase()
  return normalizedMessage.includes('"code":1002') || normalizedMessage.includes('code:1002')
}

export function isPartnerboostTransientError(error: unknown): boolean {
  if (!error) return false

  // 代理致命错误 - 不可重试
  if (isProxyFatalError(error)) return false

  const raw = error as {
    message?: string
    status?: {
      code?: number | string
      msg?: string
    }
  }

  const message = String(raw?.message || '')
  const responseStatus = parseHttpStatusFromErrorMessage(message)
  if (isTransientHttpStatus(responseStatus)) return true

  const payloadStatusCode = normalizePartnerboostStatusCode(raw?.status?.code)
  if (payloadStatusCode !== null && payloadStatusCode >= 500) return true

  const payloadStatusMessage = String(raw?.status?.msg || message)
  return isTransientNetworkErrorMessage(payloadStatusMessage)
}

export function isYeahPromosRequestTooFastMessage(message: string): boolean {
  const normalizedMessage = message.toLowerCase()
  return (
    normalizedMessage.includes('request too fast') ||
    normalizedMessage.includes('request too frequent') ||
    normalizedMessage.includes('please request later') ||
    normalizedMessage.includes('too frequent') ||
    normalizedMessage.includes('请求过于频繁') ||
    normalizedMessage.includes('请求太快') ||
    normalizedMessage.includes('请稍后再试')
  )
}

export function isYeahPromosRateLimited(
  code: number | null,
  message: string,
  responseStatus?: number
): boolean {
  if (responseStatus === 429) return true

  if (code !== null) {
    if (code === 429 || code === 100429 || code === 200429) return true
  }

  if (isYeahPromosRequestTooFastMessage(message)) return true

  const normalizedMessage = message.toLowerCase()
  return (
    normalizedMessage.includes('too many request') ||
    normalizedMessage.includes('rate limit') ||
    normalizedMessage.includes('too many requests')
  )
}

export function isYeahPromosTransientError(error: unknown): boolean {
  if (!error) return false

  // 代理致命错误 - 不可重试
  if (isProxyFatalError(error)) return false

  const raw = error as {
    message?: string
    status?: {
      code?: number | string
      msg?: string
    }
  }

  const message = String(raw?.message || '')
  const responseStatus = parseHttpStatusFromErrorMessage(message)
  if (isTransientHttpStatus(responseStatus)) return true

  const payloadStatusCode = normalizeYeahPromosResultCode(raw?.status?.code)
  if (payloadStatusCode !== null && payloadStatusCode >= 500) return true

  if (isTransientNetworkErrorMessage(message)) return true

  return isJsonParseErrorMessage(message)
}

export function parseReviewCount(value: unknown): number | null {
  if (value === null || value === undefined) return null

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return Math.max(0, Math.trunc(value))
  }

  const raw = String(value).trim()
  if (!raw) return null

  const compact = raw.toLowerCase().replace(/[，,\s]/g, '')
  const shortMatch = compact.match(/^(\d+(?:\.\d+)?)([kmb])$/i)
  if (shortMatch) {
    const base = Number(shortMatch[1])
    const unit = shortMatch[2].toLowerCase()
    const multiplier = unit === 'k' ? 1000 : unit === 'm' ? 1000000 : 1000000000
    if (Number.isFinite(base)) {
      return Math.max(0, Math.trunc(base * multiplier))
    }
  }

  const numeric = compact.replace(/[^0-9]/g, '')
  if (!numeric) return null

  const parsed = Number(numeric)
  if (!Number.isFinite(parsed)) return null

  return Math.max(0, Math.trunc(parsed))
}

export function parseCsvValues(value: string): string[] {
  return value
    .split(/[\n,;\s]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function normalizeAsin(value: unknown): string | null {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
  return normalized || null
}

export function normalizeBrand(value: unknown): string | null {
  const text = String(value || '').trim()
  if (!text) return null
  return text.toLowerCase()
}

export function isPartnerboostShortLink(value: string | null): boolean {
  if (!value) return false

  try {
    const parsed = new URL(value)
    const hostname = parsed.hostname.toLowerCase()
    return hostname === 'pboost.me' || hostname.endsWith('.pboost.me')
  } catch {
    return /:\/\/(?:www\.)?pboost\.me\//i.test(value)
  }
}

export function resolvePartnerboostPromoLinks(input: {
  productIdLink?: string | null
  asinLink?: string | null
  asinPartnerboostLink?: string | null
}): {
  promoLink: string | null
  shortPromoLink: string | null
} {
  const productIdLink = normalizeUrl(input.productIdLink)
  const shortPromoLink =
    normalizeUrl(input.asinPartnerboostLink) ||
    (isPartnerboostShortLink(productIdLink) ? productIdLink : null)
  const promoLink = shortPromoLink || normalizeUrl(input.asinLink) || productIdLink || null

  return {
    promoLink,
    shortPromoLink,
  }
}

export function resolvePartnerboostCountryCode(
  value: unknown,
  fallback: unknown = DEFAULT_PB_COUNTRY_CODE
): string {
  const primary = normalizeCountryCode(String(value || ''))
  if (primary) return primary

  const backup = normalizeCountryCode(String(fallback || ''))
  if (backup) return backup

  return DEFAULT_PB_COUNTRY_CODE
}

export function resolvePartnerboostFullSyncCountrySequence(): string[] {
  const deduped: string[] = []
  const seen = new Set<string>()

  for (const country of DEFAULT_PB_FULL_SYNC_COUNTRY_SEQUENCE) {
    const normalized = normalizeCountryCode(country)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    deduped.push(normalized)
  }

  if (deduped.length === 0) {
    return [DEFAULT_PB_COUNTRY_CODE]
  }

  return deduped
}

export function assertPartnerboostAsinRequestLimit(asins: string[]): void {
  if (asins.length <= MAX_PB_ASINS_PER_REQUEST) return
  throw new Error(
    `PartnerBoost 商品拉取失败: The asins parameter can contain a maximum of ${MAX_PB_ASINS_PER_REQUEST} elements`
  )
}

export function normalizeYeahPromosMerchants(value: unknown): YeahPromosMerchant[] {
  if (Array.isArray(value)) {
    return value
  }

  if (value && typeof value === 'object') {
    const candidates = Object.values(value as Record<string, unknown>)
    return candidates.filter((item) => item && typeof item === 'object') as YeahPromosMerchant[]
  }

  return []
}

export function normalizeYeahPromosTransactions(value: unknown): YeahPromosTransaction[] {
  if (Array.isArray(value)) {
    return value
  }

  if (value && typeof value === 'object') {
    const candidates = Object.values(value as Record<string, unknown>)
    return candidates.filter((item) => item && typeof item === 'object') as YeahPromosTransaction[]
  }

  return []
}

export function extractYeahPromosPayload(payload: YeahPromosResponse): {
  merchants: YeahPromosMerchant[]
  pageTotal: number | null
  pageNow: number | null
} {
  const nested =
    payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? (payload.data as YeahPromosResponseData)
      : null

  const merchants = normalizeYeahPromosMerchants(
    payload.Data ??
      (Array.isArray(payload.data) ? payload.data : undefined) ??
      nested?.Data ??
      nested?.data
  )

  const pageTotal = toNumber(
    payload.PageTotal ?? payload.pageTotal ?? nested?.PageTotal ?? nested?.pageTotal
  )
  const pageNow = toNumber(payload.PageNow ?? payload.pageNow ?? nested?.PageNow ?? nested?.pageNow)

  return {
    merchants,
    pageTotal,
    pageNow,
  }
}

export function extractYeahPromosTransactionsPayload(payload: YeahPromosTransactionsResponse): {
  transactions: YeahPromosTransaction[]
  pageTotal: number | null
  pageNow: number | null
} {
  const nested =
    payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? (payload.data as YeahPromosTransactionsResponseData)
      : null

  const transactions = normalizeYeahPromosTransactions(
    payload.Data ??
      (Array.isArray(payload.data) ? payload.data : undefined) ??
      nested?.Data ??
      nested?.data
  )

  const pageTotal = toNumber(
    payload.PageTotal ?? payload.pageTotal ?? nested?.PageTotal ?? nested?.pageTotal
  )
  const pageNow = toNumber(payload.PageNow ?? payload.pageNow ?? nested?.PageNow ?? nested?.pageNow)

  return {
    transactions,
    pageTotal,
    pageNow,
  }
}

export function normalizeUrl(value?: string | null): string | null {
  if (!value) return null
  const trimmed = String(value).trim()
  return trimmed || null
}

export function extractAsinFromUrlLike(value: unknown): string | null {
  const raw = normalizeUrl(typeof value === 'string' ? value : String(value || ''))
  if (!raw) return null

  const candidates = [raw]
  if (/%[0-9A-Fa-f]{2}/.test(raw)) {
    try {
      const decoded = decodeURIComponent(raw)
      if (decoded && decoded !== raw) {
        candidates.push(decoded)
      }
    } catch {
      // ignore malformed percent-encoding
    }
  }

  const patterns = [
    /\/dp\/([A-Za-z0-9]{10})(?=[/?#&]|$)/i,
    /\/gp\/product\/([A-Za-z0-9]{10})(?=[/?#&]|$)/i,
    /[?&#]asin=([A-Za-z0-9]{10})(?=[&#]|$)/i,
  ]

  for (const candidate of candidates) {
    for (const pattern of patterns) {
      const matched = candidate.match(pattern)
      if (!matched?.[1]) continue
      const asin = normalizeAsin(matched[1])
      if (asin) return asin
    }
  }

  return null
}

export function extractPartnerboostLinkId(value: unknown): string | null {
  const raw = normalizeUrl(typeof value === 'string' ? value : String(value || ''))
  if (!raw) return null

  const candidates = [raw]
  if (/%[0-9A-Fa-f]{2}/.test(raw)) {
    try {
      const decoded = decodeURIComponent(raw)
      if (decoded && decoded !== raw) {
        candidates.push(decoded)
      }
    } catch {
      // ignore malformed percent-encoding
    }
  }

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate)
      const key = Array.from(url.searchParams.keys()).find(
        (item) => item.toLowerCase() === 'aa_adgroupid'
      )
      if (key) {
        const value = normalizeUrl(url.searchParams.get(key))
        if (value) return value
      }
    } catch {
      // ignore invalid url
    }

    const matched = candidate.match(/[?&#]aa_adgroupid=([^&#]+)/i)
    if (matched?.[1]) {
      const value = normalizeUrl(matched[1])
      if (value) return value
    }
  }

  return null
}

export function buildComparableUrlTokens(value: unknown): string[] {
  const raw = normalizeUrl(typeof value === 'string' ? value : String(value || ''))
  if (!raw) return []

  const queue: string[] = [raw]
  const seen = new Set<string>()
  const tokens: string[] = []

  while (queue.length > 0) {
    const current = queue.shift() as string
    const normalizedCurrent = normalizeUrl(current)
    if (!normalizedCurrent || seen.has(normalizedCurrent)) continue

    seen.add(normalizedCurrent)
    tokens.push(normalizedCurrent)

    if (/%[0-9A-Fa-f]{2}/.test(normalizedCurrent)) {
      try {
        const decoded = decodeURIComponent(normalizedCurrent)
        const normalizedDecoded = normalizeUrl(decoded)
        if (normalizedDecoded && !seen.has(normalizedDecoded)) {
          queue.push(normalizedDecoded)
        }
      } catch {
        // ignore malformed percent-encoding
      }
    }

    try {
      const parsed = new URL(normalizedCurrent)
      const protocol = parsed.protocol.toLowerCase()
      const hostname = parsed.hostname.toLowerCase()
      const pathname = parsed.pathname ? parsed.pathname.replace(/\/+$/, '') : ''
      const normalizedPathname = pathname || '/'

      const queryEntries = Array.from(parsed.searchParams.entries())
      queryEntries.sort((a, b) => {
        if (a[0] === b[0]) return a[1].localeCompare(b[1])
        return a[0].localeCompare(b[0])
      })
      const sortedParams = new URLSearchParams()
      for (const [key, val] of queryEntries) {
        sortedParams.append(key, val)
      }
      const sortedQuery = sortedParams.toString()
      const canonical = `${protocol}//${hostname}${normalizedPathname}${sortedQuery ? `?${sortedQuery}` : ''}`
      if (!seen.has(canonical)) {
        queue.push(canonical)
      }
    } catch {
      // ignore invalid url
    }
  }

  return tokens
}

export function dedupePositiveIds(ids: number[]): number[] {
  const result: number[] = []
  const seen = new Set<number>()
  for (const raw of ids) {
    const id = Number(raw)
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

export function resolveOfferProductBackfillDecision(params: {
  exactUrlProductIds: number[]
  linkIdProductIds: number[]
  asinProductIds: number[]
  brandProductIds: number[]
}): {
  productId: number | null
  reason: OfferProductBackfillDecisionReason
  exactUrlProductIds: number[]
  linkIdProductIds: number[]
  asinProductIds: number[]
  brandProductIds: number[]
} {
  const exactUrlProductIds = dedupePositiveIds(params.exactUrlProductIds ?? [])
  const linkIdProductIds = dedupePositiveIds(params.linkIdProductIds ?? [])
  const asinProductIds = dedupePositiveIds(params.asinProductIds ?? [])
  const brandProductIds = dedupePositiveIds(params.brandProductIds ?? [])

  if (exactUrlProductIds.length === 1) {
    return {
      productId: exactUrlProductIds[0],
      reason: 'exact_url',
      exactUrlProductIds,
      linkIdProductIds,
      asinProductIds,
      brandProductIds,
    }
  }

  if (exactUrlProductIds.length > 1) {
    return {
      productId: null,
      reason: 'ambiguous_exact_url',
      exactUrlProductIds,
      linkIdProductIds,
      asinProductIds,
      brandProductIds,
    }
  }

  if (linkIdProductIds.length > 0 && asinProductIds.length > 0) {
    const asinSet = new Set(asinProductIds)
    const intersection = linkIdProductIds.filter((productId) => asinSet.has(productId))
    if (intersection.length === 1) {
      return {
        productId: intersection[0],
        reason: 'link_id_asin_intersection',
        exactUrlProductIds,
        linkIdProductIds,
        asinProductIds,
        brandProductIds,
      }
    }

    if (intersection.length > 1) {
      return {
        productId: null,
        reason: 'ambiguous_link_id_asin_intersection',
        exactUrlProductIds,
        linkIdProductIds,
        asinProductIds,
        brandProductIds,
      }
    }

    return {
      productId: null,
      reason: 'conflicting_link_id_asin',
      exactUrlProductIds,
      linkIdProductIds,
      asinProductIds,
      brandProductIds,
    }
  }

  if (linkIdProductIds.length === 1) {
    return {
      productId: linkIdProductIds[0],
      reason: 'link_id',
      exactUrlProductIds,
      linkIdProductIds,
      asinProductIds,
      brandProductIds,
    }
  }

  if (linkIdProductIds.length > 1) {
    return {
      productId: null,
      reason: 'ambiguous_link_id',
      exactUrlProductIds,
      linkIdProductIds,
      asinProductIds,
      brandProductIds,
    }
  }

  if (asinProductIds.length === 1) {
    return {
      productId: asinProductIds[0],
      reason: 'asin',
      exactUrlProductIds,
      linkIdProductIds,
      asinProductIds,
      brandProductIds,
    }
  }

  if (asinProductIds.length > 1) {
    return {
      productId: null,
      reason: 'ambiguous_asin',
      exactUrlProductIds,
      linkIdProductIds,
      asinProductIds,
      brandProductIds,
    }
  }

  // Brand matching as fallback
  if (brandProductIds.length === 1) {
    return {
      productId: brandProductIds[0],
      reason: 'brand',
      exactUrlProductIds,
      linkIdProductIds,
      asinProductIds,
      brandProductIds,
    }
  }

  if (brandProductIds.length > 1) {
    return {
      productId: null,
      reason: 'ambiguous_brand',
      exactUrlProductIds,
      linkIdProductIds,
      asinProductIds,
      brandProductIds,
    }
  }

  return {
    productId: null,
    reason: 'no_match',
    exactUrlProductIds,
    linkIdProductIds,
    asinProductIds,
    brandProductIds,
  }
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function parsePercentage(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    if (value >= 0 && value <= 1) return value * 100
    return value
  }

  const raw = String(value).trim()
  if (!raw) return null
  const normalized = raw.replace('%', '')
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  if (raw.includes('%')) return parsed
  if (parsed >= 0 && parsed <= 1) return parsed * 100
  return parsed
}

export function parsePriceAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null

  const raw = String(value).trim()
  if (!raw) return null
  const numeric = raw.replace(/[^0-9.-]+/g, '')
  if (!numeric) return null
  const parsed = Number(numeric)
  return Number.isFinite(parsed) ? parsed : null
}

export function hasCurrencySymbol(value: string): boolean {
  return /[$€£¥₴₽₩₹]/.test(value)
}

export function looksLikeCurrencyUnit(value: string): boolean {
  const raw = value.trim()
  if (!raw) return false
  if (raw.includes('%')) return false
  if (hasCurrencySymbol(raw)) return true

  const upper = raw.toUpperCase()
  if (/^[A-Z]{3}$/.test(upper)) return true
  return false
}

export function normalizeCurrencyUnit(value: unknown): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  if (/^[A-Za-z]{3}$/.test(raw)) {
    return raw.toUpperCase()
  }

  // 只接受纯货币符号（不含数字），拒绝 "$49.99" 这类价格字符串误存为货币单位的脏数据
  if (hasCurrencySymbol(raw) && !/\d/.test(raw)) {
    return raw
  }

  return null
}

export function extractCurrencyUnitFromText(value: unknown): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  const symbolMatch = raw.match(/[$€£¥₴₽₩₹]/)
  if (symbolMatch) {
    return symbolMatch[0]
  }

  const codeMatch = raw.match(/\b([A-Za-z]{3})\b/)
  if (codeMatch) {
    return codeMatch[1].toUpperCase()
  }

  return null
}

export function parsePartnerboostCommission(
  value: unknown,
  fallbackCurrency: string | null
): {
  mode: 'percent' | 'amount'
  rate: number | null
  amount: number | null
  currency: string | null
} {
  const raw = String(value || '').trim()
  if (!raw) {
    return {
      mode: 'percent',
      rate: null,
      amount: null,
      currency: fallbackCurrency,
    }
  }

  if (raw.includes('%')) {
    return {
      mode: 'percent',
      rate: parsePercentage(value),
      amount: null,
      currency: fallbackCurrency,
    }
  }

  const extractedCurrency = extractCurrencyUnitFromText(raw)
  if (extractedCurrency) {
    return {
      mode: 'amount',
      rate: null,
      amount: parsePriceAmount(value),
      currency: extractedCurrency,
    }
  }

  return {
    mode: 'percent',
    rate: parsePercentage(value),
    amount: null,
    currency: fallbackCurrency,
  }
}

export function parseYeahPromosMerchantCommission(
  avgPayout: unknown,
  payoutUnit: unknown
): ParsedYeahPromosCommission {
  const avgText = String(avgPayout || '').trim()
  const unitText = String(payoutUnit || '').trim()

  const isRate = avgText.includes('%') || unitText.includes('%')
  if (isRate) {
    return {
      mode: 'rate',
      rate: parsePercentage(avgPayout),
      amount: null,
    }
  }

  const isAmount = hasCurrencySymbol(avgText) || looksLikeCurrencyUnit(unitText)
  if (isAmount) {
    return {
      mode: 'amount',
      rate: null,
      amount: parsePriceAmount(avgPayout),
    }
  }

  return {
    mode: 'rate',
    rate: parsePercentage(avgPayout),
    amount: null,
  }
}

export function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

export function computeCommissionAmount(
  priceAmount: number | null,
  commissionRate: number | null
): number | null {
  if (priceAmount === null || commissionRate === null) return null
  return roundTo2(priceAmount * (commissionRate / 100))
}

export function normalizeCountryCode(value: string): string | null {
  const code = value.trim().toUpperCase()
  if (!code) return null
  if (code.length === 2 || code.length === 3) return code
  return code
}

export function normalizeProductTargetCountryFilter(value: unknown): string | null {
  const normalized = normalizeCountryCode(String(value || ''))
  if (!normalized || normalized === 'ALL') return null
  if (!/^[A-Z]{2,3}$/.test(normalized)) return null
  return normalized
}

export function resolveProductCountryFilterCandidates(value: unknown): string[] {
  const normalized = normalizeProductTargetCountryFilter(value)
  if (!normalized) return []

  const deduped = new Set<string>([normalized])
  for (const alias of PRODUCT_COUNTRY_FILTER_ALIAS_MAP[normalized] || []) {
    const aliasCode = normalizeCountryCode(alias)
    if (!aliasCode) continue
    deduped.add(aliasCode)
  }

  return Array.from(deduped)
}

export function normalizeCountries(input: unknown): string[] {
  if (!input) return []

  const fromArray = (arr: unknown[]): string[] => {
    const deduped = new Set<string>()
    for (const value of arr) {
      if (value === null || value === undefined) continue
      const code = normalizeCountryCode(String(value))
      if (code) deduped.add(code)
    }
    return Array.from(deduped)
  }

  if (Array.isArray(input)) {
    return fromArray(input)
  }

  const text = String(input).trim()
  if (!text) return []
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) {
        return fromArray(parsed)
      }
    } catch {
      // ignore
    }
  }

  return fromArray(text.split(/[;,|/\s]+/g).filter(Boolean))
}

export function normalizeProxyCountryCode(value: string): string | null {
  const normalized = normalizeCountryCode(value)
  if (!normalized) return null
  return YP_PROXY_COUNTRY_ALIAS[normalized] || normalized
}

export function resolveProxyCountryCandidates(country: string): string[] {
  const normalized = normalizeProxyCountryCode(country)
  if (!normalized) return []
  const candidates = new Set<string>([normalized])
  for (const [alias, canonical] of Object.entries(YP_PROXY_COUNTRY_ALIAS)) {
    if (canonical === normalized) {
      candidates.add(alias)
    }
  }
  return Array.from(candidates)
}

export function normalizeYeahPromosMarketplace(value: unknown): string | null {
  const text = String(value || '')
    .trim()
    .toLowerCase()
  if (!text) return null
  if (!text.startsWith('amazon.')) return null
  return text
}

export function resolveYeahPromosMarketplaceCountry(marketplace: string | null): string | null {
  if (!marketplace) return null
  return YP_MARKETPLACE_COUNTRY_MAP[marketplace] || null
}

export function normalizeYeahPromosMarketplaceTemplateEntry(
  value: unknown
): YeahPromosMarketplaceTemplate | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const rawUrl = normalizeUrl(String(record.url ?? record.template_url ?? record.templateUrl ?? ''))
  if (!rawUrl) return null

  let parsedUrl: URL
  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    return null
  }

  if (!/^https?:$/i.test(parsedUrl.protocol)) return null
  if (!/yeahpromos\.com$/i.test(parsedUrl.hostname)) return null
  if (parsedUrl.pathname !== '/index/offer/products') return null

  const marketplaceFromUrl = normalizeYeahPromosMarketplace(
    parsedUrl.searchParams.get('market_place') || ''
  )
  const marketplace = normalizeYeahPromosMarketplace(
    record.marketplace ?? record.market_place ?? record.marketPlace ?? marketplaceFromUrl ?? ''
  )
  if (!marketplace) return null

  const country = normalizeProxyCountryCode(
    String(
      record.country ??
        record.country_code ??
        record.countryCode ??
        resolveYeahPromosMarketplaceCountry(marketplace) ??
        ''
    )
  )
  if (!country) return null

  if (!parsedUrl.searchParams.has('page')) {
    parsedUrl.searchParams.set('page', '1')
  }

  const scope = normalizeYeahPromosMarketplace(String(record.scope ?? marketplace)) || marketplace

  return {
    scope,
    marketplace,
    country,
    url: parsedUrl.toString(),
  }
}

export function cloneDefaultYeahPromosMarketplaceTemplates(): YeahPromosMarketplaceTemplate[] {
  return DEFAULT_YP_MARKETPLACE_TEMPLATES.map((item) => ({ ...item }))
}

export function buildYeahPromosDeltaScopePlan(params: {
  templates: YeahPromosMarketplaceTemplate[]
  activeScopes: string[]
  maxPages: number
}): YeahPromosDeltaScopePlan {
  const orderedTemplates = params.templates.filter(
    (template, index, arr) => arr.findIndex((item) => item.scope === template.scope) === index
  )
  if (orderedTemplates.length === 0) {
    return {
      templates: [],
      scopePageBudgets: {},
    }
  }

  const normalizedMaxPages = Math.max(1, Math.trunc(params.maxPages))
  const templateByScope = new Map(
    orderedTemplates.map((template) => [template.scope, template] as const)
  )
  const normalizedActiveScopes = params.activeScopes
    .map((scope) => normalizeYeahPromosMarketplace(scope))
    .filter((scope): scope is string => Boolean(scope))
  const priorityTemplates = Array.from(new Set(normalizedActiveScopes))
    .map((scope) => templateByScope.get(scope) || null)
    .filter((template): template is YeahPromosMarketplaceTemplate => Boolean(template))
  const priorityScopeSet = new Set(priorityTemplates.map((template) => template.scope))
  const fallbackTemplates = orderedTemplates.filter(
    (template) => !priorityScopeSet.has(template.scope)
  )
  const scopeBudgets = new Map<string, number>()
  let remainingPages = normalizedMaxPages

  const allocatePages = (
    templates: YeahPromosMarketplaceTemplate[],
    maxPagesPerScope: number
  ): void => {
    if (templates.length === 0 || remainingPages <= 0) return

    let madeProgress = true
    while (remainingPages > 0 && madeProgress) {
      madeProgress = false
      for (const template of templates) {
        if (remainingPages <= 0) break
        const currentBudget = scopeBudgets.get(template.scope) || 0
        if (currentBudget >= maxPagesPerScope) {
          continue
        }
        scopeBudgets.set(template.scope, currentBudget + 1)
        remainingPages -= 1
        madeProgress = true
      }
    }
  }

  if (priorityTemplates.length > 0) {
    allocatePages(priorityTemplates, 1)
    allocatePages(priorityTemplates, DEFAULT_YP_DELTA_PRIORITY_PAGE_CAP)
  }
  allocatePages(fallbackTemplates, 1)

  const allTemplates = [...priorityTemplates, ...fallbackTemplates]
  allocatePages(allTemplates, Number.MAX_SAFE_INTEGER)

  const plannedTemplates = allTemplates.filter(
    (template) => (scopeBudgets.get(template.scope) || 0) > 0
  )

  return {
    templates: plannedTemplates,
    scopePageBudgets: Object.fromEntries(scopeBudgets.entries()),
  }
}

export function resolveYeahPromosMarketplaceTemplates(
  rawValue: string | null | undefined
): YeahPromosMarketplaceTemplate[] {
  const raw = String(rawValue || '').trim()
  if (!raw) return cloneDefaultYeahPromosMarketplaceTemplates()

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return cloneDefaultYeahPromosMarketplaceTemplates()
    }

    const items: YeahPromosMarketplaceTemplate[] = []
    const seenScopes = new Set<string>()
    for (const candidate of parsed) {
      const normalized = normalizeYeahPromosMarketplaceTemplateEntry(candidate)
      if (!normalized) continue
      if (seenScopes.has(normalized.scope)) continue
      seenScopes.add(normalized.scope)
      items.push(normalized)
    }

    return items.length > 0 ? items : cloneDefaultYeahPromosMarketplaceTemplates()
  } catch {
    return cloneDefaultYeahPromosMarketplaceTemplates()
  }
}

export function buildYeahPromosProductsPageUrl(templateUrl: string, page: number): string {
  const url = new URL(templateUrl)
  url.searchParams.set('page', String(Math.max(1, Math.trunc(page))))
  return url.toString()
}

export function applyYeahPromosTemplateSiteId(
  templates: YeahPromosMarketplaceTemplate[],
  siteId: string | null | undefined
): YeahPromosMarketplaceTemplate[] {
  const normalizedSiteId = String(siteId || '').trim()
  if (!normalizedSiteId) {
    return templates.map((template) => ({ ...template }))
  }

  return templates.map((template) => {
    try {
      const url = new URL(template.url)
      url.searchParams.set('site_id', normalizedSiteId)
      return {
        ...template,
        url: normalizeUrl(url.toString()) || url.toString(),
      }
    } catch {
      return { ...template }
    }
  })
}

export function parseYeahPromosProxyCountryUrlMap(
  rawValue: string | null | undefined
): Map<string, string> {
  const map = new Map<string, string>()
  const raw = String(rawValue || '').trim()
  if (!raw) return map

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return map
    }

    for (const item of parsed as YeahPromosProxyConfigEntry[]) {
      const country = normalizeProxyCountryCode(String(item?.country || ''))
      const url = normalizeUrl(String(item?.url || ''))
      if (!country || !url) continue
      map.set(country, url)
    }
  } catch {
    return map
  }

  return map
}

export function resolveYeahPromosProxyProviderUrl(
  countryProxyMap: Map<string, string>,
  country: string
): string | null {
  const candidates = resolveProxyCountryCandidates(country)
  for (const candidate of candidates) {
    const matched = normalizeUrl(countryProxyMap.get(candidate) || '')
    if (matched) return matched
  }
  return null
}

export function detectYeahPromosHttpIntercept(input: { status: number; html: string }): {
  blocked: boolean
  reason: string | null
} {
  const status = Number(input.status)
  const rawHtml = String(input.html || '')
  const html = rawHtml.toLowerCase()

  if (status === 403) return { blocked: true, reason: 'http_403' }
  if (status === 429) return { blocked: true, reason: 'http_429' }
  if (status >= 500 && status <= 599) return { blocked: true, reason: `http_${status}` }

  if (!rawHtml.trim()) {
    return { blocked: true, reason: 'empty_html' }
  }

  if (YP_DOM_INTERCEPT_KEYWORDS.some((keyword) => html.includes(keyword))) {
    return { blocked: true, reason: 'dom_keyword' }
  }

  const hasProductCards = html.includes('adv-content')
  const hasNoProductsHint = html.includes('no products found')
  const hasPageList = html.includes('id="pagelist"') || html.includes("id='pagelist'")
  if (!hasProductCards && !hasNoProductsHint && !hasPageList) {
    return { blocked: true, reason: 'dom_abnormal' }
  }

  return { blocked: false, reason: null }
}

export function normalizeYmdDate(value: unknown): string | null {
  const text = String(value || '').trim()
  if (!text) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  return text
}

export function parseAllowedCountries(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return normalizeCountries(parsed)
  } catch {
    return normalizeCountries(value)
  }
}

export function normalizePlatformValue(value: unknown): AffiliatePlatform | null {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
  if (!raw) return null
  if (raw === 'yp' || raw === 'yeahpromos') return 'yeahpromos'
  if (raw === 'pb' || raw === 'partnerboost') return 'partnerboost'
  return null
}
